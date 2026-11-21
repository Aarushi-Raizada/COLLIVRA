"""
SGP4 Orbital Propagation Engine for ZORBIT.

Wraps the python sgp4 library to propagate Orbit Mean-Elements Messages (OMM)
or TLE orbital elements into SGP4-propagated modelled analytical Cartesian state vectors
expressed in the TEME reference frame.

Scientific Guardrails (AGENTS.md):
- SGP4 output resides strictly in the True Equator, Mean Equinox (TEME) frame of date.
- Coordinates are never silently relabeled as GCRF, J2000, or ITRF.
- Position units are kilometers (km); velocity units are kilometers per second (km/s).
- SGP4 reconstructs periodic perturbations within its analytical model but does not
  provide observational ground truth.
- Uses the canonical WGS-72 gravitational constant (WGS72) matching standard SGP4/SDP4
  operational ephemeris generation.
- Rejects feeding synthetic Cartesian states directly into SGP4 without osculating-to-mean
  conversion.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sgp4 import omm
from sgp4.api import SGP4_ERRORS, WGS72, Satrec, jday

from orbital_core.schemas import OrbitalObjectRecord, StateVectorRecord

logger = logging.getLogger("orbital_core.propagation")


class PropagationError(Exception):
    """Base exception for orbital propagation errors."""


class SGP4PropagationError(PropagationError):
    """Raised when SGP4 propagation engine encounters an error (e.g., decayed orbit)."""

    def __init__(self, message: str, error_code: int, epoch: datetime) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.epoch = epoch


def normalize_utc_datetime(dt: datetime | str) -> datetime:
    """
    Ensure input is a timezone-aware UTC datetime.
    Rejects naive datetimes to eliminate ambiguous local machine timezone assumptions.
    """
    if isinstance(dt, str):
        parsed = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError(f"Ambiguous naive datetime string '{dt}'; explicit timezone required.")
        return parsed.astimezone(timezone.utc)
    elif isinstance(dt, datetime):
        if dt.tzinfo is None:
            raise ValueError(f"Ambiguous naive datetime '{dt}'; explicit timezone (UTC) required.")
        return dt.astimezone(timezone.utc)
    else:
        raise TypeError(f"Expected datetime or ISO string, got {type(dt)}")


def record_to_satrec(
    record: OrbitalObjectRecord | dict[str, Any],
    gravconst: int = WGS72,
) -> Satrec:
    """
    Convert an OrbitalObjectRecord or raw OMM dictionary into an initialized SGP4 Satrec object.

    Uses WGS-72 gravitational constant (sgp4.api.WGS72) by default, matching
    the operational standard of NORAD/Spacetrack SGP4 ephemeris generation.

    Raises:
        PropagationError: If input is invalid, contains synthetic data without an integer ID,
                         or lacks required OMM elements.
    """
    if isinstance(record, OrbitalObjectRecord):
        if record.is_synthetic:
            # Check if NORAD ID can be cast to int. If not, reject per AGENTS.md §3.3
            try:
                int(record.norad_cat_id)
            except ValueError as err:
                raise PropagationError(
                    f"Cannot initialize SGP4 directly from synthetic Cartesian fragment "
                    f"'{record.norad_cat_id}' without osculating-to-mean conversion "
                    f"(per AGENTS.md §3.3)."
                ) from err

        # Format ISO epoch specifically for sgp4.omm.initialize (%Y-%m-%dT%H:%M:%S.%f)
        epoch_str = record.epoch.strftime("%Y-%m-%dT%H:%M:%S.%f")

        fields = {
            "CLASSIFICATION_TYPE": record.classification_type,
            "OBJECT_ID": record.object_id,
            "EPHEMERIS_TYPE": record.ephemeris_type,
            "ELEMENT_SET_NO": record.element_set_no,
            "REV_AT_EPOCH": record.rev_at_epoch,
            "EPOCH": epoch_str,
            "ARG_OF_PERICENTER": record.arg_of_pericenter,
            "BSTAR": record.bstar,
            "ECCENTRICITY": record.eccentricity,
            "INCLINATION": record.inclination,
            "MEAN_ANOMALY": record.mean_anomaly,
            "MEAN_MOTION_DDOT": record.mean_motion_ddot,
            "MEAN_MOTION_DOT": record.mean_motion_dot,
            "MEAN_MOTION": record.mean_motion,
            "RA_OF_ASC_NODE": record.ra_of_asc_node,
            "NORAD_CAT_ID": int(record.norad_cat_id),
        }
    elif isinstance(record, dict):
        if "NORAD_CAT_ID" not in record or record["NORAD_CAT_ID"] is None:
            raise PropagationError("OMM dictionary missing required 'NORAD_CAT_ID'")

        try:
            norad_int = int(record["NORAD_CAT_ID"])
        except ValueError as err:
            raise PropagationError(
                f"Cannot initialize SGP4: invalid NORAD_CAT_ID '{record['NORAD_CAT_ID']}': {err}"
            ) from err

        # Normalize epoch string for sgp4.omm.initialize
        epoch_val = record.get("EPOCH")
        if not epoch_val:
            raise PropagationError("OMM dictionary missing required 'EPOCH'")
        epoch_dt = normalize_utc_datetime(epoch_val)
        epoch_str = epoch_dt.strftime("%Y-%m-%dT%H:%M:%S.%f")

        fields = dict(record)
        fields["EPOCH"] = epoch_str
        fields["NORAD_CAT_ID"] = norad_int
    else:
        raise TypeError(f"Expected OrbitalObjectRecord or dict, got {type(record)}")

    sat = Satrec()
    try:
        omm.initialize(sat, fields, gravconst)
    except Exception as err:
        raise PropagationError(f"Failed to initialize Satrec from OMM data: {err}") from err

    return sat


def propagate_satrec(
    sat: Satrec,
    target_time: datetime | str,
    norad_cat_id: str | None = None,
    object_name: str | None = None,
    object_id: str | None = None,
    raise_on_error: bool = False,
) -> StateVectorRecord:
    """
    Propagate an initialized Satrec object to a single UTC timestamp.

    Computes Julian Date preserving maximum numerical precision using sgp4.api.jday.
    Returns a validated StateVectorRecord in the TEME frame.

    Args:
        sat: Initialized sgp4.api.Satrec instance.
        target_time: Target propagation epoch (timezone-aware UTC datetime or ISO string).
        norad_cat_id: Optional NORAD ID override.
        object_name: Optional object name override.
        object_id: Optional object identifier override.
        raise_on_error: If True, raises SGP4PropagationError on non-zero SGP4 error code.
                        If False, populates status and sgp4_error_code on the record.

    Returns:
        StateVectorRecord in TEME frame with position (km) and velocity (km/s).
    """
    dt_utc = normalize_utc_datetime(target_time)

    # Compute Julian Date with separate integer and fractional day components
    second_float = dt_utc.second + dt_utc.microsecond / 1_000_000.0
    jd, fr = jday(
        dt_utc.year,
        dt_utc.month,
        dt_utc.day,
        dt_utc.hour,
        dt_utc.minute,
        second_float,
    )

    error_code, r, v = sat.sgp4(jd, fr)

    # Resolve object identifiers from arguments or Satrec satnum
    final_norad = norad_cat_id or getattr(sat, "satnum_str", None) or str(sat.satnum)
    final_name = object_name
    final_obj_id = object_id or final_norad or "UNKNOWN"

    if error_code != 0:
        err_msg = SGP4_ERRORS.get(error_code, f"Unknown SGP4 error {error_code}")
        status_str = f"ERROR: {err_msg}"
        logger.warning(
            "SGP4 propagation error %d for object %s at %s: %s",
            error_code,
            final_norad,
            dt_utc.isoformat(),
            err_msg,
        )

        if raise_on_error:
            raise SGP4PropagationError(
                f"SGP4 error {error_code} ({err_msg}) for object {final_norad} "
                f"at {dt_utc.isoformat()}",
                error_code=error_code,
                epoch=dt_utc,
            )

        return StateVectorRecord(
            norad_cat_id=final_norad,
            object_id=final_obj_id,
            object_name=final_name,
            epoch=dt_utc,
            frame="TEME",
            position_km=(float(r[0]), float(r[1]), float(r[2])),
            velocity_kms=(float(v[0]), float(v[1]), float(v[2])),
            status=status_str,
            sgp4_error_code=error_code,
        )

    return StateVectorRecord(
        norad_cat_id=final_norad,
        object_id=final_obj_id,
        object_name=final_name,
        epoch=dt_utc,
        frame="TEME",
        position_km=(float(r[0]), float(r[1]), float(r[2])),
        velocity_kms=(float(v[0]), float(v[1]), float(v[2])),
        status="OK",
        sgp4_error_code=0,
    )


def propagate_orbit(
    record: OrbitalObjectRecord | dict[str, Any],
    target_time: datetime | str,
    gravconst: int = WGS72,
    raise_on_error: bool = False,
) -> StateVectorRecord:
    """
    Convenience function: initializes Satrec from an OMM record and propagates to target_time.
    """
    sat = record_to_satrec(record, gravconst=gravconst)

    if isinstance(record, OrbitalObjectRecord):
        norad_id = record.norad_cat_id
        name = record.object_name
        obj_id = record.object_id
    elif isinstance(record, dict):
        norad_id = str(record.get("NORAD_CAT_ID", sat.satnum))
        name = record.get("OBJECT_NAME")
        obj_id = str(record.get("OBJECT_ID", norad_id))
    else:
        norad_id = str(sat.satnum)
        name = None
        obj_id = norad_id

    return propagate_satrec(
        sat,
        target_time,
        norad_cat_id=norad_id,
        object_name=name,
        object_id=obj_id,
        raise_on_error=raise_on_error,
    )


def propagate_range(
    record_or_satrec: OrbitalObjectRecord | dict[str, Any] | Satrec,
    start_time: datetime | str,
    end_time: datetime | str,
    step_seconds: float = 60.0,
    gravconst: int = WGS72,
    raise_on_error: bool = False,
) -> list[StateVectorRecord]:
    """
    Propagate an orbital object over a time window [start_time, end_time] at
    fixed step_seconds intervals.

    Reuses a single Satrec instance across all time steps for maximum numerical efficiency.

    Args:
        record_or_satrec: OrbitalObjectRecord, raw OMM dictionary, or pre-initialized Satrec.
        start_time: Start of propagation window (UTC).
        end_time: End of propagation window (UTC).
        step_seconds: Step size between ephemeris points in seconds (> 0.0).
        gravconst: SGP4 gravity model (default WGS72).
        raise_on_error: If True, raises SGP4PropagationError on the first failure.
                        If False, includes the error StateVectorRecord in the returned list.

    Returns:
        List of StateVectorRecord items in the TEME frame.
    """
    start_dt = normalize_utc_datetime(start_time)
    end_dt = normalize_utc_datetime(end_time)

    if step_seconds <= 0.0:
        raise ValueError(f"step_seconds must be strictly positive (> 0.0), got {step_seconds}")

    if end_dt < start_dt:
        raise ValueError(
            f"end_time ({end_dt.isoformat()}) must be >= start_time ({start_dt.isoformat()})"
        )

    if isinstance(record_or_satrec, Satrec):
        sat = record_or_satrec
        norad_id = getattr(sat, "satnum_str", str(sat.satnum))
        name = None
        obj_id = norad_id
    elif isinstance(record_or_satrec, OrbitalObjectRecord):
        sat = record_to_satrec(record_or_satrec, gravconst=gravconst)
        norad_id = record_or_satrec.norad_cat_id
        name = record_or_satrec.object_name
        obj_id = record_or_satrec.object_id
    elif isinstance(record_or_satrec, dict):
        sat = record_to_satrec(record_or_satrec, gravconst=gravconst)
        norad_id = str(record_or_satrec.get("NORAD_CAT_ID", sat.satnum))
        name = record_or_satrec.get("OBJECT_NAME")
        obj_id = str(record_or_satrec.get("OBJECT_ID", norad_id))
    else:
        raise TypeError(
            f"Expected Satrec, OrbitalObjectRecord, or dict, got {type(record_or_satrec)}"
        )

    step_delta = timedelta(seconds=step_seconds)
    total_seconds = (end_dt - start_dt).total_seconds()
    num_steps = int(total_seconds // step_seconds)

    records: list[StateVectorRecord] = []

    for i in range(num_steps + 1):
        step_dt = start_dt + i * step_delta
        if step_dt > end_dt:
            break
        rec = propagate_satrec(
            sat,
            step_dt,
            norad_cat_id=norad_id,
            object_name=name,
            object_id=obj_id,
            raise_on_error=raise_on_error,
        )
        records.append(rec)

    # Ensure end_dt is included if window was not an exact multiple of step_seconds
    if records and records[-1].epoch < end_dt:
        rec_end = propagate_satrec(
            sat,
            end_dt,
            norad_cat_id=norad_id,
            object_name=name,
            object_id=obj_id,
            raise_on_error=raise_on_error,
        )
        records.append(rec_end)

    return records
