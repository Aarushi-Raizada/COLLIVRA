"""
Multi-Satellite Trajectory Propagation Engine for ZORBIT.

Generates timestamped ephemeris trajectories for multiple orbital objects across
a configurable time window and transforms state vectors into the requested
coordinate reference frame (TEME, ITRS, GCRS).

Scientific & Architectural Guardrails (AGENTS.md):
- Raw SGP4 propagation produces state vectors strictly in TEME.
- Centralized coordinate transformations in frames.py handle conversions to ITRS and GCRS.
- Position coordinates are in kilometers (km); velocity coordinates are in km/s.
- SGP4 models analytical perturbation effects; it does not represent observational ground truth.
- Offline IERS safety is guaranteed at the application level; this module avoids runtime
  configuration mutations.
- Multi-satellite failure isolation: failure of one satellite (e.g. decayed orbit or invalid OMM)
  does not invalidate, corrupt, or abort propagation of other satellites in the batch.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Sequence

from sgp4.api import SGP4_ERRORS, WGS72, Satrec, jday

from orbital_core.frames import (
    FrameTransformationError,
    transform_state_vectors,
)
from orbital_core.propagation import (
    PropagationError,
    SGP4PropagationError,
    normalize_utc_datetime,
    record_to_satrec,
)
from orbital_core.schemas import (
    CoordinateFrame,
    OrbitalObjectRecord,
    SatelliteTrajectory,
    StateVectorRecord,
    TrajectoryBatchResponse,
    TrajectoryPoint,
)

logger = logging.getLogger("orbital_core.trajectory")

SUPPORTED_TARGET_FRAMES = ("TEME", "ITRS", "ITRF", "GCRS", "GCRF")


def generate_time_grid(
    start_time: datetime | str,
    end_time: datetime | str,
    step_seconds: float = 60.0,
) -> list[datetime]:
    """
    Generate an ordered sequence of timezone-aware UTC timestamps spanning [start_time, end_time].

    Sampling Rules:
    1. Grid points start exactly at start_time: t_i = start_time + i * step_seconds.
    2. For a single-point time window (start_time == end_time), exactly one timestamp is returned.
    3. If the duration (end_time - start_time) is not an exact integer multiple of step_seconds,
       the final endpoint end_time is appended to ensure the propagation window is fully spanned.

    Args:
        start_time: Start of the propagation window (UTC datetime or ISO string).
        end_time: End of the propagation window (UTC datetime or ISO string).
        step_seconds: Sampling step size in seconds (> 0.0).

    Returns:
        List of timezone-aware UTC datetimes strictly ordered in time.

    Raises:
        ValueError: If step_seconds <= 0.0, end_time < start_time, or timestamps are invalid/naive.
    """
    start_dt = normalize_utc_datetime(start_time)
    end_dt = normalize_utc_datetime(end_time)

    if not math.isfinite(step_seconds) or step_seconds <= 0.0:
        raise ValueError(
            f"step_seconds must be a finite, strictly positive number (> 0.0), got {step_seconds}"
        )

    if end_dt < start_dt:
        raise ValueError(
            f"end_time ({end_dt.isoformat()}) must be >= start_time ({start_dt.isoformat()})"
        )

    # Single-point time window
    if start_dt == end_dt:
        return [start_dt]

    step_delta = timedelta(seconds=step_seconds)
    total_seconds = (end_dt - start_dt).total_seconds()
    num_steps = int(total_seconds // step_seconds)

    time_grid: list[datetime] = []
    for i in range(num_steps + 1):
        t = start_dt + i * step_delta
        if t > end_dt:
            break
        time_grid.append(t)

    # Explicit endpoint inclusion if window was not an exact multiple of step_seconds
    if time_grid and time_grid[-1] < end_dt:
        time_grid.append(end_dt)

    return time_grid


def _precompute_jdays(time_grid: list[datetime]) -> list[tuple[float, float]]:
    """
    Precompute SGP4 Julian Date pairs (jd, fr) for a shared time grid.
    Separates integer base days and fractional days to preserve 64-bit numerical precision.
    """
    jdays: list[tuple[float, float]] = []
    for dt in time_grid:
        second_float = dt.second + dt.microsecond / 1_000_000.0
        jd, fr = jday(
            dt.year,
            dt.month,
            dt.day,
            dt.hour,
            dt.minute,
            second_float,
        )
        jdays.append((jd, fr))
    return jdays


def propagate_satellite_trajectory(
    record_or_satrec: OrbitalObjectRecord | dict[str, Any] | Satrec,
    start_time: datetime | str,
    end_time: datetime | str,
    step_seconds: float = 60.0,
    target_frame: CoordinateFrame | str = "TEME",
    gravconst: int = WGS72,
    raise_on_error: bool = False,
    time_grid: list[datetime] | None = None,
    precomputed_jday: list[tuple[float, float]] | None = None,
) -> SatelliteTrajectory:
    """
    Propagate an individual orbital object over a time window into the target reference frame.

    Args:
        record_or_satrec: OrbitalObjectRecord, raw OMM dictionary, or initialized Satrec object.
        start_time: Start of propagation window (UTC).
        end_time: End of propagation window (UTC).
        step_seconds: Sampling step size in seconds (> 0.0).
        target_frame: Output coordinate frame ('TEME', 'ITRS', 'ITRF', 'GCRS', 'GCRF').
        gravconst: SGP4 gravity model (default WGS72).
        raise_on_error: If True, raises SGP4PropagationError on the first failure.
                        If False, captures the error and returns a trajectory with status
                        and failure details.
        time_grid: Optional precomputed list of UTC datetimes (for batch reuse).
        precomputed_jday: Optional precomputed list of (jd, fr) Julian Date pairs.

    Returns:
        SatelliteTrajectory containing ordered TrajectoryPoints in the target coordinate frame.

    Raises:
        FrameTransformationError: If target_frame is unsupported.
        ValueError: If time parameters are invalid.
        PropagationError: If raise_on_error is True and satellite initialization/propagation fails.
    """
    frame_str = str(target_frame).strip().upper()
    if frame_str not in SUPPORTED_TARGET_FRAMES:
        raise FrameTransformationError(
            f"Unsupported target frame '{target_frame}'. "
            f"Supported frames: {', '.join(SUPPORTED_TARGET_FRAMES)}."
        )

    # Generate or reuse shared time grid and precomputed Julian dates
    if time_grid is None:
        time_grid = generate_time_grid(start_time, end_time, step_seconds)
    if precomputed_jday is None:
        precomputed_jday = _precompute_jdays(time_grid)

    # 1. Resolve identifiers and initialize SGP4 Satrec
    try:
        if isinstance(record_or_satrec, Satrec):
            sat = record_or_satrec
            norad_id = getattr(sat, "satnum_str", None) or str(sat.satnum)
            object_name = None
            object_id = norad_id
        elif isinstance(record_or_satrec, OrbitalObjectRecord):
            sat = record_to_satrec(record_or_satrec, gravconst=gravconst)
            norad_id = record_or_satrec.norad_cat_id
            object_name = record_or_satrec.object_name
            object_id = record_or_satrec.object_id
        elif isinstance(record_or_satrec, dict):
            try:
                rec_model = OrbitalObjectRecord.from_omm_dict(record_or_satrec)
                sat = record_to_satrec(rec_model, gravconst=gravconst)
                norad_id = rec_model.norad_cat_id
                object_name = rec_model.object_name
                object_id = rec_model.object_id
            except Exception:
                sat = record_to_satrec(record_or_satrec, gravconst=gravconst)
                norad_id = str(
                    record_or_satrec.get("NORAD_CAT_ID", getattr(sat, "satnum", "UNKNOWN"))
                )
                object_name = record_or_satrec.get("OBJECT_NAME")
                object_id = str(record_or_satrec.get("OBJECT_ID", norad_id))
        else:
            raise TypeError(
                f"Expected Satrec, OrbitalObjectRecord, or dict, got {type(record_or_satrec)}"
            )
    except Exception as err:
        logger.warning("Failed to initialize Satrec for satellite: %s", err)
        if raise_on_error:
            if isinstance(err, PropagationError):
                raise
            raise PropagationError(f"Failed to initialize satellite: {err}") from err

        # Extract fallback identifier if possible
        fallback_id = "UNKNOWN"
        fallback_name = None
        if isinstance(record_or_satrec, dict):
            fallback_id = str(record_or_satrec.get("NORAD_CAT_ID", "UNKNOWN"))
            fallback_name = record_or_satrec.get("OBJECT_NAME")
        elif isinstance(record_or_satrec, OrbitalObjectRecord):
            fallback_id = record_or_satrec.norad_cat_id
            fallback_name = record_or_satrec.object_name

        return SatelliteTrajectory(
            norad_cat_id=fallback_id if fallback_id != "UNKNOWN" else None,
            object_id=fallback_id,
            object_name=fallback_name,
            frame=frame_str,  # type: ignore[arg-type]
            position_unit="km",
            velocity_unit="km/s",
            points=[],
            status="FAILED",
            error_message=str(err),
        )

    # 2. Propagate across the time grid in native TEME
    teme_states: list[StateVectorRecord] = []
    error_encountered: str | None = None

    for dt, (jd, fr) in zip(time_grid, precomputed_jday):
        error_code, r, v = sat.sgp4(jd, fr)

        if error_code != 0:
            err_msg = SGP4_ERRORS.get(error_code, f"Unknown SGP4 error {error_code}")
            error_encountered = (
                f"SGP4 error {error_code} ({err_msg}) for object {norad_id} at {dt.isoformat()}"
            )
            logger.warning(error_encountered)

            if raise_on_error:
                raise SGP4PropagationError(
                    error_encountered,
                    error_code=error_code,
                    epoch=dt,
                )
            # Break on fatal error (e.g. decayed orbit), preserving all preceding valid points
            break

        rec = StateVectorRecord(
            norad_cat_id=norad_id,
            object_id=object_id,
            object_name=object_name,
            epoch=dt,
            frame="TEME",
            position_km=(float(r[0]), float(r[1]), float(r[2])),
            velocity_kms=(float(v[0]), float(v[1]), float(v[2])),
            status="OK",
            sgp4_error_code=0,
        )
        teme_states.append(rec)

    # 3. Coordinate reference frame transformation
    if not teme_states:
        return SatelliteTrajectory(
            norad_cat_id=norad_id,
            object_id=object_id,
            object_name=object_name,
            frame=frame_str,  # type: ignore[arg-type]
            position_unit="km",
            velocity_unit="km/s",
            points=[],
            status="FAILED",
            error_message=error_encountered or "No points generated",
        )

    if frame_str == "TEME":
        final_states = teme_states
        actual_frame = "TEME"
    else:
        # Use vectorized Astropy frame transformations
        final_states = transform_state_vectors(teme_states, frame_str)
        actual_frame = final_states[0].frame

    # 4. Construct trajectory points
    points = [
        TrajectoryPoint(
            epoch=s.epoch,
            position_km=s.position_km,
            velocity_kms=s.velocity_kms,
        )
        for s in final_states
    ]

    status_val: Literal["SUCCESS", "PARTIAL", "FAILED"] = (
        "PARTIAL" if error_encountered else "SUCCESS"
    )

    return SatelliteTrajectory(
        norad_cat_id=norad_id,
        object_id=object_id,
        object_name=object_name,
        frame=actual_frame,  # type: ignore[arg-type]
        position_unit="km",
        velocity_unit="km/s",
        points=points,
        status=status_val,
        error_message=error_encountered,
    )


def propagate_trajectories(
    satellites: Sequence[OrbitalObjectRecord | dict[str, Any] | Satrec],
    start_time: datetime | str,
    end_time: datetime | str,
    step_seconds: float = 60.0,
    target_frame: CoordinateFrame | str = "TEME",
    gravconst: int = WGS72,
    raise_on_error: bool = False,
) -> TrajectoryBatchResponse:
    """
    Propagate multiple satellites across a common time window into the target reference frame.

    Execution Pipeline & Performance Optimizations:
    1. Validates time window parameters and target reference frame upfront.
    2. Precomputes the common time grid and Julian dates (jd, fr) once for all satellites.
    3. Initializes SGP4 Satrec records once per satellite.
    4. Propagates each satellite along the precomputed Julian date grid.
    5. Applies vectorized Astropy transformations to map TEME state vectors to target_frame.
    6. Ensures strict failure isolation: an individual satellite failure (e.g. decayed orbit
       or corrupt OMM) is isolated to its trajectory record and does not fail the batch.

    Args:
        satellites: Sequence of OrbitalObjectRecord, raw OMM dicts, or Satrec instances.
        start_time: Start of propagation window (UTC datetime or ISO string).
        end_time: End of propagation window (UTC datetime or ISO string).
        step_seconds: Sampling step size in seconds (> 0.0).
        target_frame: Output coordinate frame ('TEME', 'ITRS', 'ITRF', 'GCRS', 'GCRF').
        gravconst: SGP4 gravity constant (default WGS72).
        raise_on_error: If True, raises exception on first failure.
                        If False, captures per-satellite errors.

    Returns:
        TrajectoryBatchResponse containing all satellite trajectories and summary metrics.

    Raises:
        ValueError: If time parameters or step_seconds are invalid.
        FrameTransformationError: If target_frame is unsupported.
        PropagationError / SGP4PropagationError: If raise_on_error is True and any satellite fails.
    """
    start_dt = normalize_utc_datetime(start_time)
    end_dt = normalize_utc_datetime(end_time)

    frame_str = str(target_frame).strip().upper()
    if frame_str not in SUPPORTED_TARGET_FRAMES:
        raise FrameTransformationError(
            f"Unsupported target frame '{target_frame}'. "
            f"Supported frames: {', '.join(SUPPORTED_TARGET_FRAMES)}."
        )

    # Empty satellite collection handling
    if not satellites:
        return TrajectoryBatchResponse(
            count=0,
            successful_count=0,
            failed_count=0,
            target_frame=frame_str,  # type: ignore[arg-type]
            start_time=start_dt,
            end_time=end_dt,
            step_seconds=step_seconds,
            generated_at=datetime.now(timezone.utc),
            trajectories=[],
        )

    # Generate shared time grid and precompute Julian dates once for all satellites
    time_grid = generate_time_grid(start_dt, end_dt, step_seconds)
    precomputed_jday = _precompute_jdays(time_grid)

    trajectories: list[SatelliteTrajectory] = []
    successful_count = 0
    failed_count = 0

    for sat_item in satellites:
        traj = propagate_satellite_trajectory(
            record_or_satrec=sat_item,
            start_time=start_dt,
            end_time=end_dt,
            step_seconds=step_seconds,
            target_frame=frame_str,
            gravconst=gravconst,
            raise_on_error=raise_on_error,
            time_grid=time_grid,
            precomputed_jday=precomputed_jday,
        )
        trajectories.append(traj)
        if traj.status == "SUCCESS":
            successful_count += 1
        else:
            failed_count += 1

    return TrajectoryBatchResponse(
        count=len(trajectories),
        successful_count=successful_count,
        failed_count=failed_count,
        target_frame=frame_str,  # type: ignore[arg-type]
        start_time=start_dt,
        end_time=end_dt,
        step_seconds=step_seconds,
        generated_at=datetime.now(timezone.utc),
        trajectories=trajectories,
    )
