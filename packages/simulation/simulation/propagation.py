"""
Numerical orbital propagation engine for synthetic collision fragments in GCRS.

Implements independent 8th-order explicit Runge-Kutta DOP853 numerical integration
with Earth point-mass gravity and J2 oblateness perturbation. Uses a fixed-epoch
Celestial Intermediate Pole (CIP) Earth-orientation model and continuous root-finding
for atmospheric interface (100 km) reentry detection.

Scientific Guardrails & Mathematical Foundation (AGENTS.md §3.1, §3.3):
- Trajectories and state vectors are defined strictly in the Geocentric Celestial
  Reference System (GCRS). SGP4 mean elements are NEVER mixed with Cartesian states.
- The J2 perturbation uses the Instantaneous/Fixed-Epoch Celestial Intermediate Pole
  (CIP) unit vector in GCRS, derived via IAU 2006/2000A bias-precession-nutation (ERFA pnm06a).
- Independent per-fragment integrations guarantee strict lifecycle isolation:
  reentry or solver divergence for one fragment cannot alter or corrupt another.
- Continuous root-found event detection terminates descending trajectories at 100 km
  altitude, ensuring physical realism and preventing non-physical surface collisions.
- Numerical solver failures are explicitly distinguished from physical atmospheric decay.
"""

from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timedelta
from typing import Sequence

import erfa
import numpy as np
from astropy.time import Time
from orbital_core.schemas import TrajectoryPoint, normalize_datetime_utc
from scipy.integrate import solve_ivp

from .constants import (
    ATMOSPHERIC_INTERFACE_ALTITUDE_KM,
    ENDPOINT_TIME_TOLERANCE_SECONDS,
    J2_EARTH,
    MODEL_NAME,
    MU_EARTH_KM3_S2,
    PROPAGATION_DISCLAIMER,
    R_EARTH_EQUATORIAL_KM,
    R_REENTRY_KM,
)
from .schemas import (
    FragmentationResult,
    FragmentPropagationSummary,
    FragmentTrajectory,
    FragmentTrajectoryBatch,
    NumericalPropagationConfig,
    SyntheticFragmentRecord,
)

logger = logging.getLogger("simulation.propagation")


# ============================================================================
# Earth Orientation & CIP Pole Vector
# ============================================================================


def get_cip_unit_vector(epoch: datetime) -> np.ndarray:
    """
    Compute the Celestial Intermediate Pole (CIP) unit vector in GCRS coordinates.

    Uses ERFA's IAU 2006/2000A bias-precession-nutation routine (pnm06a).
    Because Q transforms vectors from GCRS to date (CIRS), the inverse transformation
    is Q^T. The CIP unit vector [0, 0, 1] in CIRS corresponds to the third row of Q:
    n_CIP = Q^T @ [0, 0, 1] = Q[2, :].

    Args:
        epoch: Timezone-aware UTC datetime.

    Returns:
        np.ndarray of shape (3,) representing the normalized CIP unit vector in GCRS.
    """
    utc_epoch = normalize_datetime_utc(epoch)
    t_astropy = Time(utc_epoch, scale="utc")
    jd1_tt, jd2_tt = erfa.taitt(*erfa.utctai(t_astropy.jd1, t_astropy.jd2))

    # Q is the 3x3 bias-precession-nutation matrix
    q_mat = erfa.pnm06a(jd1_tt, jd2_tt)
    pole = q_mat[2, :].copy().astype(np.float64)

    norm = np.linalg.norm(pole)
    if norm == 0.0 or not np.isfinite(norm):
        raise ValueError("Failed to compute valid CIP unit vector from ERFA pnm06a.")

    return pole / norm


# ============================================================================
# Equations of Motion (GCRS Two-Body + J2)
# ============================================================================


def compute_two_body_j2_acceleration(
    r_vec: np.ndarray,
    pole_cip: np.ndarray,
    mu: float = MU_EARTH_KM3_S2,
    r_earth: float = R_EARTH_EQUATORIAL_KM,
    j2: float = J2_EARTH,
) -> np.ndarray:
    """
    Compute total gravitational acceleration in GCRS including point-mass and J2.

    a = a_point_mass + a_J2
    a_point_mass = -mu / r^3 * r
    a_J2 = -1.5 * J2 * mu * R_E^2 / r^5 * [ (1 - 5*(r.n_cip)^2/r^2)*r + 2*(r.n_cip)*n_cip ]

    Args:
        r_vec: Position vector [x, y, z] in km in GCRS.
        pole_cip: Unit vector of Celestial Intermediate Pole in GCRS.
        mu: Earth standard gravitational parameter in km^3/s^2.
        r_earth: Earth equatorial radius in km.
        j2: Earth second zonal harmonic coefficient.

    Returns:
        np.ndarray of shape (3,) representing acceleration in km/s^2 in GCRS.
    """
    r2 = float(r_vec[0] * r_vec[0] + r_vec[1] * r_vec[1] + r_vec[2] * r_vec[2])
    r = math.sqrt(r2)
    if r == 0.0:
        raise ZeroDivisionError("Gravitational acceleration undefined at r = 0.")

    r5 = r2 * r2 * r

    # Point-mass acceleration
    a_pm = -(mu / (r * r2)) * r_vec

    # J2 perturbation
    proj = float(r_vec[0] * pole_cip[0] + r_vec[1] * pole_cip[1] + r_vec[2] * pole_cip[2])
    factor = 1.5 * j2 * mu * (r_earth**2) / r5
    term = 1.0 - 5.0 * (proj * proj) / r2
    a_j2 = -factor * (term * r_vec + 2.0 * proj * pole_cip)

    return a_pm + a_j2


def make_equations_of_motion(pole_cip: np.ndarray):
    """
    Create a callable right-hand-side function for SciPy solve_ivp.

    Args:
        pole_cip: Fixed-epoch CIP unit vector in GCRS.

    Returns:
        Callable rhs(t, y) mapping state [r, v] to derivative [v, a].
    """

    def rhs(t: float, y: np.ndarray) -> np.ndarray:
        r_vec = y[:3]
        v_vec = y[3:]
        a_vec = compute_two_body_j2_acceleration(r_vec, pole_cip)
        return np.concatenate([v_vec, a_vec])

    return rhs


# ============================================================================
# Event Detection & Grid Safeguards
# ============================================================================


def create_atmospheric_interface_event(
    altitude_km: float = ATMOSPHERIC_INTERFACE_ALTITUDE_KM,
    r_earth: float = R_EARTH_EQUATORIAL_KM,
):
    """
    Create a SciPy solve_ivp terminal event function for atmospheric interface crossing.

    The event triggers when radial distance decreases to R_earth + altitude_km (100 km).
    direction = -1 ensures it triggers only when descending through the boundary.
    """
    r_reentry = r_earth + altitude_km

    def reentry_event(t: float, y: np.ndarray) -> float:
        r = math.sqrt(y[0] * y[0] + y[1] * y[1] + y[2] * y[2])
        return r - r_reentry

    reentry_event.terminal = True
    reentry_event.direction = -1.0
    return reentry_event


def compute_time_grid(
    duration_seconds: float,
    step_seconds: float,
) -> tuple[np.ndarray, int]:
    """
    Compute output sampling timestamps in seconds, rigorously handling the final endpoint.

    If duration is an exact integer multiple of step_seconds, returns [0, dt, 2dt, ..., duration].
    If duration is not an exact multiple, appends the exact duration endpoint.

    Args:
        duration_seconds: Propagation window duration in seconds (> 0).
        step_seconds: Sampling step size in seconds (> 0).

    Returns:
        tuple of (t_eval array, number of evaluation points).
    """
    if duration_seconds <= 0.0 or step_seconds <= 0.0:
        raise ValueError("duration_seconds and step_seconds must be strictly positive.")

    n_steps = int(duration_seconds // step_seconds)
    remainder = duration_seconds - (n_steps * step_seconds)
    eps = step_seconds * 1e-9

    if remainder < eps or (step_seconds - remainder) < eps:
        # Exact integer multiple
        t_eval = np.linspace(0.0, duration_seconds, n_steps + 1)
    else:
        # Step grid with appended endpoint
        base_grid = np.arange(0.0, duration_seconds, step_seconds)
        t_eval = np.append(base_grid, duration_seconds)

    return t_eval, len(t_eval)


def validate_output_safeguards(
    n_fragments: int,
    points_per_traj: int,
    config: NumericalPropagationConfig,
) -> None:
    """
    Validate requested output point counts against configured safety limits.

    Prevents out-of-memory exhaustion before ODE integration or array allocations begin.
    """
    if points_per_traj > config.max_points_per_trajectory:
        raise ValueError(
            f"Requested trajectory points ({points_per_traj}) exceeds "
            f"max_points_per_trajectory ({config.max_points_per_trajectory}). "
            "Increase sampling step_seconds or decrease duration_seconds."
        )

    total_batch_points = n_fragments * points_per_traj
    if total_batch_points > config.max_batch_points:
        raise ValueError(
            f"Requested batch output points ({total_batch_points} = {n_fragments} frags x "
            f"{points_per_traj} points) exceeds max_batch_points ({config.max_batch_points}). "
            "Reduce fragment count, increase sampling step_seconds, or decrease duration_seconds."
        )


def validate_initial_fragment_state(
    position_km: tuple[float, float, float] | np.ndarray,
    velocity_kms: tuple[float, float, float] | np.ndarray,
    r_reentry_km: float = R_REENTRY_KM,
) -> tuple[bool, str | None]:
    """
    Validate that an initial Cartesian state vector is physically admissible.

    Checks:
    1. All 6 coordinates are finite numbers (not NaN or Inf).
    2. Initial radial distance strictly exceeds the 100 km atmospheric interface radius.

    Returns:
        tuple of (is_valid: bool, error_message: str | None).
    """
    pos = tuple(position_km)
    vel = tuple(velocity_kms)

    for val in (*pos, *vel):
        if not math.isfinite(val):
            return False, f"Non-finite coordinate encountered in initial state: {val}"

    r0 = math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2])
    if r0 <= r_reentry_km:
        return (
            False,
            f"Initial radius ({r0:.3f} km) is at or below the 100 km atmospheric interface "
            f"({r_reentry_km:.3f} km). Fragment cannot start inside the dense atmosphere.",
        )

    return True, None


# ============================================================================
# Single-Fragment Propagation
# ============================================================================


def propagate_fragment(
    fragment: SyntheticFragmentRecord,
    config: NumericalPropagationConfig,
    pole_cip: np.ndarray,
) -> FragmentTrajectory:
    """
    Propagate a single synthetic fragment numerically in GCRS using DOP853.

    Args:
        fragment: Synthetic fragment domain record.
        config: Propagation configuration parameters.
        pole_cip: Fixed-epoch CIP unit vector in GCRS.

    Returns:
        FragmentTrajectory containing ephemeris points and termination status.
    """
    # 1. Validate initial state
    is_valid, validation_err = validate_initial_fragment_state(
        fragment.position_km, fragment.velocity_kms
    )
    if not is_valid:
        return FragmentTrajectory(
            fragment_id=fragment.fragment_id,
            frame="GCRS",
            position_unit="km",
            velocity_unit="km/s",
            points=[],
            status="FAILED",
            termination_reason="INVALID_INITIAL_STATE",
            mass_kg=fragment.mass_kg,
            error_message=validation_err,
        )

    t_eval, _ = compute_time_grid(config.duration_seconds, config.step_seconds)
    y0 = np.array([*fragment.position_km, *fragment.velocity_kms], dtype=np.float64)
    t_span = (0.0, float(config.duration_seconds))

    # Vector absolute tolerances: 3 for position, 3 for velocity
    atol = np.array(
        [
            config.atol_position_km,
            config.atol_position_km,
            config.atol_position_km,
            config.atol_velocity_kms,
            config.atol_velocity_kms,
            config.atol_velocity_kms,
        ],
        dtype=np.float64,
    )

    rhs = make_equations_of_motion(pole_cip)
    reentry_ev = create_atmospheric_interface_event()

    try:
        sol = solve_ivp(
            fun=rhs,
            t_span=t_span,
            y0=y0,
            method=config.integrator,
            t_eval=t_eval,
            events=reentry_ev,
            rtol=config.rtol,
            atol=atol,
            max_step=config.max_step_seconds,
        )
    except Exception as exc:
        logger.warning(
            "Numerical integrator exception for fragment %s: %s", fragment.fragment_id, exc
        )
        return FragmentTrajectory(
            fragment_id=fragment.fragment_id,
            frame="GCRS",
            position_unit="km",
            velocity_unit="km/s",
            points=[],
            status="FAILED",
            termination_reason="NUMERICAL_FAILURE",
            mass_kg=fragment.mass_kg,
            error_message=f"Integrator exception: {exc}",
        )

    # 2. Check for atmospheric interface termination event
    has_reentered = (
        sol.status == 1
        and len(sol.t_events) > 0
        and len(sol.t_events[0]) > 0
        and len(sol.y_events[0]) > 0
    )

    trajectory_points: list[TrajectoryPoint] = []
    base_epoch = fragment.epoch

    if has_reentered:
        t_event = float(sol.t_events[0][0])
        y_event = sol.y_events[0][0]

        # Collect discrete sample points that strictly occurred prior to t_event
        for i in range(len(sol.t)):
            t_i = float(sol.t[i])
            if t_i < t_event - ENDPOINT_TIME_TOLERANCE_SECONDS:
                pt_epoch = base_epoch + timedelta(seconds=t_i)
                pos = (float(sol.y[0, i]), float(sol.y[1, i]), float(sol.y[2, i]))
                vel = (float(sol.y[3, i]), float(sol.y[4, i]), float(sol.y[5, i]))
                trajectory_points.append(
                    TrajectoryPoint(epoch=pt_epoch, position_km=pos, velocity_kms=vel)
                )

        # Append exact root-found event crossing state
        event_epoch = base_epoch + timedelta(seconds=t_event)
        event_pos = (float(y_event[0]), float(y_event[1]), float(y_event[2]))
        event_vel = (float(y_event[3]), float(y_event[4]), float(y_event[5]))
        trajectory_points.append(
            TrajectoryPoint(epoch=event_epoch, position_km=event_pos, velocity_kms=event_vel)
        )

        return FragmentTrajectory(
            fragment_id=fragment.fragment_id,
            frame="GCRS",
            position_unit="km",
            velocity_unit="km/s",
            points=trajectory_points,
            status="PARTIAL",
            termination_reason="ATMOSPHERIC_INTERFACE",
            mass_kg=fragment.mass_kg,
            error_message=None,
        )

    # 3. Solver completed nominal duration
    if sol.status == 0:
        for i in range(len(sol.t)):
            t_i = float(sol.t[i])
            pt_epoch = base_epoch + timedelta(seconds=t_i)
            pos = (float(sol.y[0, i]), float(sol.y[1, i]), float(sol.y[2, i]))
            vel = (float(sol.y[3, i]), float(sol.y[4, i]), float(sol.y[5, i]))
            trajectory_points.append(
                TrajectoryPoint(epoch=pt_epoch, position_km=pos, velocity_kms=vel)
            )

        return FragmentTrajectory(
            fragment_id=fragment.fragment_id,
            frame="GCRS",
            position_unit="km",
            velocity_unit="km/s",
            points=trajectory_points,
            status="SUCCESS",
            termination_reason="COMPLETED",
            mass_kg=fragment.mass_kg,
            error_message=None,
        )

    # 4. Solver encountered numerical failure (status < 0)
    for i in range(len(sol.t)):
        t_i = float(sol.t[i])
        pt_epoch = base_epoch + timedelta(seconds=t_i)
        pos = (float(sol.y[0, i]), float(sol.y[1, i]), float(sol.y[2, i]))
        vel = (float(sol.y[3, i]), float(sol.y[4, i]), float(sol.y[5, i]))
        trajectory_points.append(TrajectoryPoint(epoch=pt_epoch, position_km=pos, velocity_kms=vel))

    status_code = "PARTIAL" if len(trajectory_points) > 0 else "FAILED"
    return FragmentTrajectory(
        fragment_id=fragment.fragment_id,
        frame="GCRS",
        position_unit="km",
        velocity_unit="km/s",
        points=trajectory_points,
        status=status_code,
        termination_reason="NUMERICAL_FAILURE",
        mass_kg=fragment.mass_kg,
        error_message=f"Numerical solver failure: {sol.message} (status={sol.status})",
    )


# ============================================================================
# Batch Propagation
# ============================================================================


def propagate_fragment_batch(
    fragments_or_result: Sequence[SyntheticFragmentRecord] | FragmentationResult,
    config: NumericalPropagationConfig | None = None,
) -> FragmentTrajectoryBatch:
    """
    Numerically propagate a batch of synthetic collision fragments in GCRS.

    Applies the fixed-epoch CIP approximation evaluated at the common collision epoch.
    Executes independent DOP853 integrations per fragment to ensure complete lifecycle
    isolation and failure confinement.

    Args:
        fragments_or_result: Sequence of SyntheticFragmentRecord or FragmentationResult.
        config: Optional propagation configuration (defaults to NumericalPropagationConfig()).

    Returns:
        FragmentTrajectoryBatch containing all propagated trajectories and summary metrics.
    """
    start_wall_time = time.perf_counter()

    if isinstance(fragments_or_result, FragmentationResult):
        fragment_list = list(fragments_or_result.fragments)
    else:
        fragment_list = list(fragments_or_result)

    if not fragment_list:
        raise ValueError("Cannot propagate an empty fragment list.")

    cfg = config or NumericalPropagationConfig()

    # 1. Validate epoch consistency
    first_epoch = normalize_datetime_utc(fragment_list[0].epoch)
    for frag in fragment_list[1:]:
        frag_epoch = normalize_datetime_utc(frag.epoch)
        if frag_epoch != first_epoch:
            raise ValueError(
                f"Inconsistent fragment epochs in batch: '{frag.fragment_id}' has epoch "
                f"{frag_epoch.isoformat()}, but first fragment has {first_epoch.isoformat()}. "
                "All fragments in a collision batch must share the exact same collision epoch."
            )

    # 2. Validate unique fragment IDs
    seen_ids: set[str] = set()
    for frag in fragment_list:
        if frag.fragment_id in seen_ids:
            raise ValueError(f"Duplicate fragment_id encountered in batch: '{frag.fragment_id}'")
        seen_ids.add(frag.fragment_id)

    # 3. Validate output safeguards
    _, points_per_traj = compute_time_grid(cfg.duration_seconds, cfg.step_seconds)
    validate_output_safeguards(len(fragment_list), points_per_traj, cfg)

    # 4. Compute fixed-epoch CIP unit vector at batch reference epoch
    pole_cip = get_cip_unit_vector(first_epoch)

    # 5. Propagate fragments independently
    trajectories: list[FragmentTrajectory] = []
    completed_count = 0
    reentered_count = 0
    numerical_failure_count = 0
    invalid_state_count = 0

    for frag in fragment_list:
        traj = propagate_fragment(frag, cfg, pole_cip)
        trajectories.append(traj)

        if traj.termination_reason == "COMPLETED":
            completed_count += 1
        elif traj.termination_reason == "ATMOSPHERIC_INTERFACE":
            reentered_count += 1
        elif traj.termination_reason == "NUMERICAL_FAILURE":
            numerical_failure_count += 1
        elif traj.termination_reason == "INVALID_INITIAL_STATE":
            invalid_state_count += 1

    elapsed_wall_time = time.perf_counter() - start_wall_time

    # Standard status counts (SUCCESS = completed full duration)
    successful_count = sum(1 for t in trajectories if t.status == "SUCCESS")
    failed_count = sum(1 for t in trajectories if t.status != "SUCCESS")

    summary = FragmentPropagationSummary(
        total_fragments=len(trajectories),
        completed_count=completed_count,
        reentered_count=reentered_count,
        numerical_failure_count=numerical_failure_count,
        invalid_state_count=invalid_state_count,
        duration_seconds=cfg.duration_seconds,
        step_seconds=cfg.step_seconds,
        execution_wall_time_seconds=elapsed_wall_time,
        model_name=MODEL_NAME,
        fidelity_disclaimer=PROPAGATION_DISCLAIMER,
    )

    return FragmentTrajectoryBatch(
        scenario_epoch=first_epoch,
        frame="GCRS",
        count=len(trajectories),
        successful_count=successful_count,
        failed_count=failed_count,
        summary=summary,
        trajectories=trajectories,
    )
