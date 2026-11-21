"""
Centralized Coordinate Reference Frame Transformations for ZORBIT.

Implements rigorous astrodynamic frame conversions between:
1. TEME (True Equator, Mean Equinox of date) — standard SGP4/TLE output frame.
2. ITRS / ITRF (International Terrestrial Reference System / Frame) — Earth-centred, Earth-fixed.
3. GCRS / GCRF (Geocentric Celestial Reference System / Frame) — Earth-centred inertial frame.

Scientific Guardrails & Mathematical Foundation (AGENTS.md §3.1):
- TEME, ITRS, and GCRS are physically distinct frames. TEME must NEVER be silently
  treated as GCRS, J2000, or ITRS/ITRF.
- Transforms both position and velocity simultaneously using Astropy's coordinate
  representations and kinematic differentials. Velocity transformations between inertial
  and rotating frames (TEME -> ITRS) rigorously account for Earth rotation transport velocity
  (v_transport = omega x r) and Coriolis effects.
- Units are strictly preserved: position in kilometers (km), velocity in
  kilometers per second (km/s).
- Application-Level IERS Policy: Transformation functions execute using the currently active
  Astropy IERS configuration without injecting runtime locks or mutating process-wide state.
  When deployed within the ZORBIT backend, offline safety (auto_download=False) is enforced
  once at application startup via the FastAPI lifespan mechanism. Standalone library callers
  must configure their own IERS policy when running in air-gapped environments.
- Scientific Disclaimer: SGP4-derived states transformed via this module represent analytical
  model trajectories with empirical EOP reductions. They are decision-support estimates and do
  not represent observational ground truth or certified flight-control ephemerides.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime
from typing import Sequence

import astropy.units as u
import numpy as np
from astropy.coordinates import (
    GCRS,
    ITRS,
    TEME,
    CartesianDifferential,
    CartesianRepresentation,
)
from astropy.time import Time

from orbital_core.iers_policy import (
    check_earth_orientation_policy,
    get_earth_orientation_quality,
)
from orbital_core.schemas import CoordinateFrame, EarthOrientationQuality, StateVectorRecord

logger = logging.getLogger("orbital_core.frames")


class FrameTransformationError(ValueError):
    """Raised when coordinate frame transformation fails or receives invalid input."""


def _validate_teme_state(state: StateVectorRecord) -> None:
    """Validate that input StateVectorRecord is in TEME frame with finite coordinates."""
    if not isinstance(state, StateVectorRecord):
        raise TypeError(f"Expected StateVectorRecord, got {type(state).__name__}")

    if state.frame != "TEME":
        raise FrameTransformationError(
            f"Input state must be in 'TEME' frame to be transformed, got '{state.frame}'."
        )

    coords = (*state.position_km, *state.velocity_kms)
    if not all(math.isfinite(c) for c in coords):
        raise FrameTransformationError(
            f"Input state contains non-finite position or velocity coordinates: "
            f"position={state.position_km}, velocity={state.velocity_kms}"
        )


def _validate_cartesian_input(
    position_km: tuple[float, float, float],
    velocity_kms: tuple[float, float, float],
) -> None:
    """Validate tuple dimensions and ensure all values are finite numbers."""
    if len(position_km) != 3:
        raise FrameTransformationError(
            f"position_km must be a 3-tuple (x, y, z), got length {len(position_km)}"
        )
    if len(velocity_kms) != 3:
        raise FrameTransformationError(
            f"velocity_kms must be a 3-tuple (vx, vy, vz), got length {len(velocity_kms)}"
        )
    coords = (*position_km, *velocity_kms)
    if not all(math.isfinite(c) for c in coords):
        raise FrameTransformationError(
            f"Cartesian inputs contain non-finite coordinates: "
            f"position={position_km}, velocity={velocity_kms}"
        )


def teme_to_itrs_cartesian(
    position_km: tuple[float, float, float],
    velocity_kms: tuple[float, float, float],
    epoch: datetime | Time,
) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """
    Transform raw Cartesian position and velocity from TEME to ITRS (Earth-fixed).

    Rigorous kinematic conversion accounting for Earth rotation (GAST/ERA)
    and transport velocity.

    Args:
        position_km: (x, y, z) in kilometers in TEME.
        velocity_kms: (vx, vy, vz) in kilometers per second in TEME.
        epoch: Timezone-aware UTC datetime or astropy.time.Time.

    Returns:
        ((x_itrs, y_itrs, z_itrs), (vx_itrs, vy_itrs, vz_itrs)) in (km, km/s).
    """
    _validate_cartesian_input(position_km, velocity_kms)
    obstime = epoch if isinstance(epoch, Time) else Time(epoch)

    p = CartesianRepresentation(
        position_km[0] * u.km,
        position_km[1] * u.km,
        position_km[2] * u.km,
    )
    v = CartesianDifferential(
        velocity_kms[0] * u.km / u.s,
        velocity_kms[1] * u.km / u.s,
        velocity_kms[2] * u.km / u.s,
    )
    teme_coord = TEME(p.with_differentials(v), obstime=obstime)
    itrs_coord = teme_coord.transform_to(ITRS(obstime=obstime))

    pos_out = (
        float(itrs_coord.cartesian.x.to_value(u.km)),
        float(itrs_coord.cartesian.y.to_value(u.km)),
        float(itrs_coord.cartesian.z.to_value(u.km)),
    )
    vel_out = (
        float(itrs_coord.velocity.d_x.to_value(u.km / u.s)),
        float(itrs_coord.velocity.d_y.to_value(u.km / u.s)),
        float(itrs_coord.velocity.d_z.to_value(u.km / u.s)),
    )
    return pos_out, vel_out


def teme_to_gcrs_cartesian(
    position_km: tuple[float, float, float],
    velocity_kms: tuple[float, float, float],
    epoch: datetime | Time,
) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """
    Transform raw Cartesian position and velocity from TEME to GCRS (Geocentric Celestial).

    Rigorous transformation accounting for equinox precession and nutation between
    the mean equinox of date (TEME) and the standard J2000.0/ICRS orientation (GCRS).

    Args:
        position_km: (x, y, z) in kilometers in TEME.
        velocity_kms: (vx, vy, vz) in kilometers per second in TEME.
        epoch: Timezone-aware UTC datetime or astropy.time.Time.

    Returns:
        ((x_gcrs, y_gcrs, z_gcrs), (vx_gcrs, vy_gcrs, vz_gcrs)) in (km, km/s).
    """
    _validate_cartesian_input(position_km, velocity_kms)
    obstime = epoch if isinstance(epoch, Time) else Time(epoch)

    p = CartesianRepresentation(
        position_km[0] * u.km,
        position_km[1] * u.km,
        position_km[2] * u.km,
    )
    v = CartesianDifferential(
        velocity_kms[0] * u.km / u.s,
        velocity_kms[1] * u.km / u.s,
        velocity_kms[2] * u.km / u.s,
    )
    teme_coord = TEME(p.with_differentials(v), obstime=obstime)
    gcrs_coord = teme_coord.transform_to(GCRS(obstime=obstime))

    pos_out = (
        float(gcrs_coord.cartesian.x.to_value(u.km)),
        float(gcrs_coord.cartesian.y.to_value(u.km)),
        float(gcrs_coord.cartesian.z.to_value(u.km)),
    )
    vel_out = (
        float(gcrs_coord.velocity.d_x.to_value(u.km / u.s)),
        float(gcrs_coord.velocity.d_y.to_value(u.km / u.s)),
        float(gcrs_coord.velocity.d_z.to_value(u.km / u.s)),
    )
    return pos_out, vel_out


def teme_to_itrs(state: StateVectorRecord) -> StateVectorRecord:
    """
    Transform a StateVectorRecord from TEME to ITRS (Earth-centred, Earth-fixed).

    Preserves object metadata, timestamp, error codes, and units (km, km/s).

    Args:
        state: StateVectorRecord in TEME frame.

    Returns:
        New StateVectorRecord in ITRS frame.
    """
    _validate_teme_state(state)
    pos_itrs, vel_itrs = teme_to_itrs_cartesian(
        state.position_km,
        state.velocity_kms,
        state.epoch,
    )
    return StateVectorRecord(
        norad_cat_id=state.norad_cat_id,
        object_id=state.object_id,
        object_name=state.object_name,
        epoch=state.epoch,
        frame="ITRS",
        position_km=pos_itrs,
        velocity_kms=vel_itrs,
        status=state.status,
        sgp4_error_code=state.sgp4_error_code,
    )


def teme_to_gcrs(state: StateVectorRecord) -> StateVectorRecord:
    """
    Transform a StateVectorRecord from TEME to GCRS (Geocentric Celestial Reference System).

    Preserves object metadata, timestamp, error codes, and units (km, km/s).

    Args:
        state: StateVectorRecord in TEME frame.

    Returns:
        New StateVectorRecord in GCRS frame.
    """
    _validate_teme_state(state)
    pos_gcrs, vel_gcrs = teme_to_gcrs_cartesian(
        state.position_km,
        state.velocity_kms,
        state.epoch,
    )
    return StateVectorRecord(
        norad_cat_id=state.norad_cat_id,
        object_id=state.object_id,
        object_name=state.object_name,
        epoch=state.epoch,
        frame="GCRS",
        position_km=pos_gcrs,
        velocity_kms=vel_gcrs,
        status=state.status,
        sgp4_error_code=state.sgp4_error_code,
    )


def get_frame_transformation_quality(epoch: datetime | Time) -> EarthOrientationQuality:
    """
    Evaluate Earth orientation parameter quality and provenance for a given epoch.

    Args:
        epoch: Target epoch as datetime or Astropy Time.

    Returns:
        EarthOrientationQuality record.
    """
    return get_earth_orientation_quality(epoch)


def transform_state_vector(
    state: StateVectorRecord,
    target_frame: CoordinateFrame | str,
    iers_mode: str | None = None,
) -> StateVectorRecord:
    """
    Transform a StateVectorRecord from TEME to a specified target reference frame.

    Supported target frames:
    - 'ITRS' or 'ITRF': Earth-centred, Earth-fixed frame.
    - 'GCRS' or 'GCRF': Geocentric Celestial Reference System (inertial).
    - 'TEME': Identity transformation (returns new record in TEME).

    Args:
        state: StateVectorRecord in TEME frame.
        target_frame: Target coordinate frame identifier.
        iers_mode: Optional IERS policy mode ('OFFLINE_PREDICTIVE' or 'OFFLINE_STRICT').
            If specified, validates state.epoch against the policy before transforming.

    Returns:
        Transformed StateVectorRecord with frame set to target_frame.

    Raises:
        FrameTransformationError: If state is not TEME or target_frame is unsupported.
        EarthOrientationPolicyError: If iers_mode requires strict validation and orientation is degraded.
    """
    if iers_mode is not None:
        check_earth_orientation_policy(state.epoch, mode=iers_mode)
    _validate_teme_state(state)
    frame_str = str(target_frame).strip().upper()

    if frame_str in ("ITRS", "ITRF"):
        pos, vel = teme_to_itrs_cartesian(state.position_km, state.velocity_kms, state.epoch)
        target_label = "ITRS" if frame_str == "ITRS" else "ITRF"
        return StateVectorRecord(
            norad_cat_id=state.norad_cat_id,
            object_id=state.object_id,
            object_name=state.object_name,
            epoch=state.epoch,
            frame=target_label,  # type: ignore[arg-type]
            position_km=pos,
            velocity_kms=vel,
            status=state.status,
            sgp4_error_code=state.sgp4_error_code,
        )
    elif frame_str in ("GCRS", "GCRF"):
        pos, vel = teme_to_gcrs_cartesian(state.position_km, state.velocity_kms, state.epoch)
        target_label = "GCRS" if frame_str == "GCRS" else "GCRF"
        return StateVectorRecord(
            norad_cat_id=state.norad_cat_id,
            object_id=state.object_id,
            object_name=state.object_name,
            epoch=state.epoch,
            frame=target_label,  # type: ignore[arg-type]
            position_km=pos,
            velocity_kms=vel,
            status=state.status,
            sgp4_error_code=state.sgp4_error_code,
        )
    elif frame_str == "TEME":
        return state.model_copy()
    else:
        raise FrameTransformationError(
            f"Unsupported target frame '{target_frame}'. "
            f"Supported destination frames: 'ITRS', 'ITRF', 'GCRS', 'GCRF', 'TEME'."
        )


def transform_state_vectors(
    states: Sequence[StateVectorRecord],
    target_frame: CoordinateFrame | str,
    iers_mode: str | None = None,
) -> list[StateVectorRecord]:
    """
    Transform a sequence of StateVectorRecords from TEME to a specified target frame.

    Leverages vectorized Astropy coordinate transformations for optimal numerical efficiency
    when transforming ephemeris trajectories or multi-satellite constellations.

    Args:
        states: Sequence of StateVectorRecord items, all in TEME frame.
        target_frame: Target coordinate frame ('ITRS', 'ITRF', 'GCRS', 'GCRF', 'TEME').
        iers_mode: Optional IERS policy mode ('OFFLINE_PREDICTIVE' or 'OFFLINE_STRICT').
            If specified, validates epochs against policy before transforming.

    Returns:
        List of transformed StateVectorRecord instances.

    Raises:
        FrameTransformationError: If any state is invalid or target_frame is unsupported.
        EarthOrientationPolicyError: If iers_mode requires strict validation and orientation is degraded.
    """
    if not states:
        return []

    if iers_mode is not None:
        for s in states:
            check_earth_orientation_policy(s.epoch, mode=iers_mode)

    frame_str = str(target_frame).strip().upper()
    if frame_str == "TEME":
        return [s.model_copy() for s in states]

    if frame_str in ("ITRS", "ITRF"):
        target_cls = ITRS
        target_label = "ITRS" if frame_str == "ITRS" else "ITRF"
    elif frame_str in ("GCRS", "GCRF"):
        target_cls = GCRS
        target_label = "GCRS" if frame_str == "GCRS" else "GCRF"
    else:
        raise FrameTransformationError(
            f"Unsupported target frame '{target_frame}'. "
            f"Supported destination frames: 'ITRS', 'ITRF', 'GCRS', 'GCRF', 'TEME'."
        )

    # Validate all input states upfront
    for s in states:
        _validate_teme_state(s)

    n_states = len(states)
    epochs = [s.epoch for s in states]
    obstime = Time(epochs)

    x_arr = np.fromiter((s.position_km[0] for s in states), dtype=np.float64, count=n_states)
    y_arr = np.fromiter((s.position_km[1] for s in states), dtype=np.float64, count=n_states)
    z_arr = np.fromiter((s.position_km[2] for s in states), dtype=np.float64, count=n_states)

    vx_arr = np.fromiter((s.velocity_kms[0] for s in states), dtype=np.float64, count=n_states)
    vy_arr = np.fromiter((s.velocity_kms[1] for s in states), dtype=np.float64, count=n_states)
    vz_arr = np.fromiter((s.velocity_kms[2] for s in states), dtype=np.float64, count=n_states)

    p = CartesianRepresentation(x_arr * u.km, y_arr * u.km, z_arr * u.km)
    v = CartesianDifferential(vx_arr * u.km / u.s, vy_arr * u.km / u.s, vz_arr * u.km / u.s)
    teme_coords = TEME(p.with_differentials(v), obstime=obstime)

    target_coords = teme_coords.transform_to(target_cls(obstime=obstime))

    out_x = target_coords.cartesian.x.to_value(u.km)
    out_y = target_coords.cartesian.y.to_value(u.km)
    out_z = target_coords.cartesian.z.to_value(u.km)

    out_vx = target_coords.velocity.d_x.to_value(u.km / u.s)
    out_vy = target_coords.velocity.d_y.to_value(u.km / u.s)
    out_vz = target_coords.velocity.d_z.to_value(u.km / u.s)

    # Handle scalar return if single-element array
    if n_states == 1:
        out_x = np.atleast_1d(out_x)
        out_y = np.atleast_1d(out_y)
        out_z = np.atleast_1d(out_z)
        out_vx = np.atleast_1d(out_vx)
        out_vy = np.atleast_1d(out_vy)
        out_vz = np.atleast_1d(out_vz)

    transformed: list[StateVectorRecord] = []
    for i, s in enumerate(states):
        rec = StateVectorRecord(
            norad_cat_id=s.norad_cat_id,
            object_id=s.object_id,
            object_name=s.object_name,
            epoch=s.epoch,
            frame=target_label,  # type: ignore[arg-type]
            position_km=(float(out_x[i]), float(out_y[i]), float(out_z[i])),
            velocity_kms=(float(out_vx[i]), float(out_vy[i]), float(out_vz[i])),
            status=s.status,
            sgp4_error_code=s.sgp4_error_code,
        )
        transformed.append(rec)

    return transformed
