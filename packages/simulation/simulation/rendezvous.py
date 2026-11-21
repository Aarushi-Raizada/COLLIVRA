"""
Clohessy-Wiltshire (CW) Relative Motion & Two-Impulse Rendezvous Mechanics.

Provides linearized relative motion propagation, coordinate frame transformations
(GCRS, instantaneous Hill/LVLH, and uniformly rotating CW), and two-impulse
rendezvous planning for space debris remediation.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Optional, Tuple

import numpy as np

from simulation.constants import MAX_TARGETING_KNOT_STEP_SECONDS
from simulation.schemas import (
    FragmentTrajectory,
    RendezvousConfig,
    RendezvousContract,
    RendezvousResult,
    TargetingMode,
)

# Standard Astrodynamical & Planetary Constants (WGS-84)
MU_EARTH_KM3_S2: float = 398600.4418
EARTH_EQUATORIAL_RADIUS_KM: float = 6378.137
MIN_PERIGEE_RADIUS_KM: float = 6478.137  # R_earth + 100 km (Kármán line perigee clearance)
ATMOSPHERIC_BOUNDARY_KM: float = MIN_PERIGEE_RADIUS_KM  # Backward-compatible alias
ECCENTRICITY_THRESHOLD: float = 0.005
DEFAULT_MAX_CONDITION_NUMBER: float = 1e7
DEFAULT_POSITION_TOLERANCE_KM: float = 1e-3
DEFAULT_VELOCITY_TOLERANCE_KMS: float = 1e-4

SCIENTIFIC_DISCLAIMER: str = (
    "RESEARCH PROTOTYPE: Clohessy-Wiltshire linearized relative motion model assumes "
    "an unperturbed circular reference orbit. Standoff targets represent nominal "
    "relative positions and do not guarantee collision avoidance. "
    "Not certified for flight operations."
)


def _validate_vector_3d(v: Any, name: str) -> np.ndarray:
    """
    Validate that an input sequence is a real, finite 3D vector.

    Rejects complex types, strings, booleans, objects, malformed shapes (2D or len != 3),
    NaNs, and infinities with informative ValueError exceptions.
    """
    if isinstance(v, (complex, np.complexfloating)):
        raise ValueError(f"{name} must contain real numeric values; complex input is prohibited.")
    if hasattr(v, "dtype") and (np.iscomplexobj(v) or v.dtype.kind not in ("i", "u", "f")):
        raise ValueError(f"{name} must have numeric real dtype, got {v.dtype}.")

    # Reject booleans or strings in sequences before numpy conversion
    if isinstance(v, (str, bytes, bool)):
        raise ValueError(f"{name} must be a 3D numeric vector, got {type(v).__name__}.")
    if isinstance(v, (list, tuple)):
        for i, elem in enumerate(v):
            if isinstance(elem, (str, bytes, bool)) or elem is None:
                raise ValueError(
                    f"{name}[{i}] has invalid non-numeric type {type(elem).__name__}; "
                    "real float is required."
                )
            if isinstance(elem, (complex, np.complexfloating)):
                raise ValueError(f"{name}[{i}] is complex; complex values are prohibited.")

    try:
        arr = np.asarray(v)
    except Exception as exc:
        raise ValueError(f"Could not convert {name} to array: {exc}") from exc

    if np.iscomplexobj(arr):
        raise ValueError(f"{name} contains complex numbers; complex input is prohibited.")
    if arr.dtype.kind not in ("i", "u", "f"):
        raise ValueError(f"{name} must have numeric real dtype, got {arr.dtype}.")
    if arr.shape != (3,):
        raise ValueError(f"{name} must have shape (3,), got {arr.shape}.")

    arr = arr.astype(np.float64)
    if not np.all(np.isfinite(arr)):
        raise ValueError(f"{name} must contain finite real numbers (no NaN or Inf).")

    return arr


def _validate_scalar_positive(val: Any, name: str) -> float:
    """Validate that a scalar value is a finite, strictly positive real float (> 0.0)."""
    if isinstance(val, (complex, np.complexfloating)):
        raise ValueError(f"{name} must be real; complex input is prohibited.")
    if isinstance(val, (str, bytes, bool)) or val is None:
        raise ValueError(f"{name} must be a numeric real scalar, got {type(val).__name__}.")

    try:
        arr = np.asarray(val)
    except Exception as exc:
        raise ValueError(f"Could not convert {name} to scalar: {exc}") from exc

    if np.iscomplexobj(arr) or arr.dtype.kind not in ("i", "u", "f"):
        raise ValueError(f"{name} must have numeric real dtype.")
    if arr.ndim != 0:
        raise ValueError(f"{name} must be a scalar, got ndim={arr.ndim}.")

    s = float(arr)
    if not math.isfinite(s) or s <= 0.0:
        raise ValueError(f"{name} must be finite and strictly positive (> 0.0), got {s}.")

    return s


def _validate_coordinate_3d(v: Any, point_idx: int, field_name: str) -> tuple[float, float, float]:
    """Validate that a trajectory point 3D coordinate contains real, finite float64 values."""
    if not isinstance(v, (list, tuple, np.ndarray)) or len(v) != 3:
        raise ValueError(f"Trajectory point {point_idx} {field_name} must be a 3-element sequence.")
    if hasattr(v, "dtype") and (np.iscomplexobj(v) or v.dtype.kind not in ("i", "u", "f")):
        raise ValueError(
            f"Trajectory point {point_idx} {field_name} has invalid dtype '{v.dtype}'; "
            "real numeric float64 is required."
        )

    validated = []
    for coord_idx, elem in enumerate(v):
        if isinstance(elem, (complex, np.complexfloating)):
            raise ValueError(
                f"Trajectory point {point_idx} {field_name}[{coord_idx}] is complex ({elem}); "
                "complex values are prohibited."
            )
        if isinstance(elem, (str, bytes, bool)) or elem is None:
            raise ValueError(
                f"Trajectory point {point_idx} {field_name}[{coord_idx}] has non-numeric type "
                f"{type(elem).__name__}; real float is required."
            )
        try:
            val_f = float(elem)
        except (ValueError, TypeError) as exc:
            raise ValueError(
                f"Trajectory point {point_idx} {field_name}[{coord_idx}] could not be "
                f"converted to float: {exc}."
            ) from exc
        if not math.isfinite(val_f):
            raise ValueError(
                f"Trajectory point {point_idx} {field_name}[{coord_idx}] must be finite, "
                f"got {val_f}."
            )
        validated.append(val_f)

    return (validated[0], validated[1], validated[2])


def validate_trajectory_knot_spacing(
    trajectory: FragmentTrajectory,
    max_permitted_knot_step_s: float = MAX_TARGETING_KNOT_STEP_SECONDS,
) -> float:
    """Validate that the maximum interval between adjacent trajectory knots does not exceed threshold.

    Parameters
    ----------
    trajectory : FragmentTrajectory
        Trajectory to inspect.
    max_permitted_knot_step_s : float, default=MAX_TARGETING_KNOT_STEP_SECONDS (60.0)
        Maximum allowable step between adjacent points in seconds.

    Returns
    -------
    float
        The maximum observed knot interval in seconds.

    Raises
    ------
    ValueError
        If the maximum observed knot interval strictly exceeds max_permitted_knot_step_s.
    """
    if len(trajectory.points) < 2:
        return 0.0

    max_observed_knot_step_s = 0.0
    for i in range(len(trajectory.points) - 1):
        pt_curr = trajectory.points[i]
        pt_next = trajectory.points[i + 1]

        t_curr = pt_curr.epoch if pt_curr.epoch.tzinfo is not None else pt_curr.epoch.replace(tzinfo=timezone.utc)
        t_next = pt_next.epoch if pt_next.epoch.tzinfo is not None else pt_next.epoch.replace(tzinfo=timezone.utc)

        dt_s = (t_next.astimezone(timezone.utc) - t_curr.astimezone(timezone.utc)).total_seconds()
        if dt_s == 0.0:
            raise ValueError(
                f"Trajectory points {i} and {i + 1} have duplicate timestamp "
                f"({t_curr.astimezone(timezone.utc).isoformat()}). Knot intervals must be strictly positive."
            )
        if dt_s < 0.0:
            raise ValueError(
                f"Trajectory timestamps are non-monotonic: point {i + 1} "
                f"({t_next.astimezone(timezone.utc).isoformat()}) precedes point {i} "
                f"({t_curr.astimezone(timezone.utc).isoformat()}) with non-positive interval {dt_s:.3f} s."
            )

        if dt_s > max_observed_knot_step_s:
            max_observed_knot_step_s = dt_s

    if max_observed_knot_step_s > max_permitted_knot_step_s:
        raise ValueError(
            f"Trajectory maximum knot interval ({max_observed_knot_step_s:.1f} s) "
            f"exceeds permitted maximum ({max_permitted_knot_step_s:.1f} s) for rendezvous targeting. "
            "Coarse propagation sampling induces O(h^4) cubic Hermite interpolation error in orbital "
            "curvature that risks exceeding the 1.0 m position cross-check tolerance. "
            "This 60-second limit is a conservative engineering guardrail for near-circular LEO targeting, "
            "not a universal physical boundary. Re-propagate target with step_seconds <= 60.0 s."
        )

    return max_observed_knot_step_s


def _validate_fragment_trajectory(
    trajectory: FragmentTrajectory,
    target_id: str,
    t0: datetime,
    t_target: datetime,
    max_permitted_knot_step_s: float = MAX_TARGETING_KNOT_STEP_SECONDS,
) -> None:
    """
    Validate the complete integrity of a synthetic target FragmentTrajectory.

    Enforces identity, frame, units, point-level strict monotonicity, real coordinates,
    property consistency, closed-bracket coverage, and lifecycle termination reason rules.
    """
    # 1. Identity & Provenance
    if trajectory.fragment_id != target_id:
        raise ValueError(
            f"FragmentTrajectory.fragment_id '{trajectory.fragment_id}' does not match "
            f"contract.target_id '{target_id}'."
        )
    if trajectory.frame != "GCRS":
        raise ValueError(f"FragmentTrajectory.frame must be 'GCRS', got '{trajectory.frame}'.")
    if trajectory.position_unit != "km" or trajectory.velocity_unit != "km/s":
        raise ValueError(
            f"FragmentTrajectory units must be 'km' and 'km/s', got "
            f"position_unit='{trajectory.position_unit}', "
            f"velocity_unit='{trajectory.velocity_unit}'."
        )
    if trajectory.status == "FAILED":
        err_msg = trajectory.error_message or "no error message"
        raise ValueError(
            f"FragmentTrajectory status is 'FAILED' ({err_msg}). "
            "Cannot synchronize from a failed trajectory."
        )
    if len(trajectory.points) == 0:
        raise ValueError("FragmentTrajectory contains no trajectory points (empty trajectory).")
    if len(trajectory.points) < 2:
        raise ValueError(
            "FragmentTrajectory requires at least 2 points for spline interpolation, "
            f"got {len(trajectory.points)}."
        )

    # 2. Point-Level Validation & Monotonicity
    prev_epoch: Optional[datetime] = None

    for i, pt in enumerate(trajectory.points):
        if (
            pt.epoch is None
            or pt.epoch.tzinfo is None
            or pt.epoch.tzinfo.utcoffset(pt.epoch) is None
        ):
            raise ValueError(f"Trajectory point {i} timestamp must be timezone-aware.")
        pt_epoch_utc = pt.epoch.astimezone(timezone.utc)

        if prev_epoch is not None:
            if pt_epoch_utc == prev_epoch:
                raise ValueError(
                    f"Trajectory point {i} has duplicate timestamp {pt_epoch_utc.isoformat()} "
                    f"equal to point {i - 1}."
                )
            if pt_epoch_utc < prev_epoch:
                raise ValueError(
                    f"Trajectory timestamps are non-monotonic: point {i} "
                    f"({pt_epoch_utc.isoformat()}) precedes point {i - 1} "
                    f"({prev_epoch.isoformat()})."
                )



        prev_epoch = pt_epoch_utc

        # Validate coordinates are real, finite floats
        _validate_coordinate_3d(pt.position_km, i, "position_km")
        _validate_coordinate_3d(pt.velocity_kms, i, "velocity_kms")

    # Knot spacing guardrail check for rendezvous targeting (Tier 2)
    validate_trajectory_knot_spacing(trajectory, max_permitted_knot_step_s)

    # 3. Property Consistency Check
    first_pt_utc = trajectory.points[0].epoch.astimezone(timezone.utc)
    last_pt_utc = trajectory.points[-1].epoch.astimezone(timezone.utc)
    if (
        trajectory.start_epoch is None
        or trajectory.start_epoch.astimezone(timezone.utc) != first_pt_utc
    ):
        raise ValueError(
            f"start_epoch ({trajectory.start_epoch}) does not match first point ({first_pt_utc})."
        )
    if trajectory.end_epoch is None or trajectory.end_epoch.astimezone(timezone.utc) != last_pt_utc:
        raise ValueError(
            f"end_epoch ({trajectory.end_epoch}) does not match last point ({last_pt_utc})."
        )

    # 4. Closed Interval Bracket Check (within or at the endpoints)
    if t0 < first_pt_utc or t0 > last_pt_utc:
        raise ValueError(
            f"Chaser epoch t0={t0.isoformat()} lies outside trajectory closed interval "
            f"[{first_pt_utc.isoformat()}, {last_pt_utc.isoformat()}]. "
            "Extrapolation is prohibited."
        )
    if t_target < first_pt_utc or t_target > last_pt_utc:
        raise ValueError(
            f"Target contract epoch t_target={t_target.isoformat()} lies outside trajectory "
            f"closed interval [{first_pt_utc.isoformat()}, {last_pt_utc.isoformat()}]. "
            "Extrapolation is prohibited."
        )

    # 5. Lifecycle & Atmospheric Interface Checks
    if trajectory.termination_reason == "NUMERICAL_FAILURE":
        raise ValueError(
            "target_trajectory terminated with NUMERICAL_FAILURE; "
            "cannot use contaminated ephemeris."
        )
    if trajectory.termination_reason == "INVALID_INITIAL_STATE":
        raise ValueError("target_trajectory terminated with INVALID_INITIAL_STATE.")
    if trajectory.termination_reason == "ATMOSPHERIC_INTERFACE":
        reentry = trajectory.reentry_epoch
        if reentry is not None:
            reentry_utc = reentry.astimezone(timezone.utc)
            if t0 >= reentry_utc:
                raise ValueError(
                    f"Chaser epoch t0={t0.isoformat()} is at or post-reentry "
                    f"({reentry_utc.isoformat()})."
                )
            if t_target >= reentry_utc:
                raise ValueError(
                    f"Target epoch t_target={t_target.isoformat()} is at or post-reentry "
                    f"({reentry_utc.isoformat()})."
                )


def _interpolate_trajectory_hermite(
    trajectory: FragmentTrajectory,
    target_dt: datetime,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Interpolate GCRS Cartesian position and velocity from FragmentTrajectory at target_dt
    using C^1 cubic Hermite spline with analytical velocity evaluation.
    """
    t_req = target_dt.astimezone(timezone.utc).timestamp()
    epochs = [pt.epoch.astimezone(timezone.utc).timestamp() for pt in trajectory.points]

    # Find bounding knot interval [k, k+1]
    if t_req <= epochs[0]:
        k = 0
    elif t_req >= epochs[-1]:
        k = len(epochs) - 2
    else:
        k = 0
        for i in range(len(epochs) - 1):
            if epochs[i] <= t_req <= epochs[i + 1]:
                k = i
                break

    t_k = epochs[k]
    t_k1 = epochs[k + 1]
    h = t_k1 - t_k
    if h <= 0.0:
        raise ValueError(f"Non-positive knot step size h={h} in trajectory interpolation.")

    u = (t_req - t_k) / h
    u = max(0.0, min(1.0, u))

    p_k = np.array(trajectory.points[k].position_km, dtype=np.float64)
    v_k = np.array(trajectory.points[k].velocity_kms, dtype=np.float64)
    p_k1 = np.array(trajectory.points[k + 1].position_km, dtype=np.float64)
    v_k1 = np.array(trajectory.points[k + 1].velocity_kms, dtype=np.float64)

    # Hermite basis functions
    u2 = u * u
    u3 = u2 * u
    h00 = 2.0 * u3 - 3.0 * u2 + 1.0
    h10 = u3 - 2.0 * u2 + u
    h01 = -2.0 * u3 + 3.0 * u2
    h11 = u3 - u2

    # Interpolated position (km)
    r_interp = h00 * p_k + h10 * h * v_k + h01 * p_k1 + h11 * h * v_k1

    # Analytical velocity derivative (km/s): d/dt = (1/h) * d/du
    dh00 = 6.0 * u2 - 6.0 * u
    dh10 = 3.0 * u2 - 4.0 * u + 1.0
    dh01 = -6.0 * u2 + 6.0 * u
    dh11 = 3.0 * u2 - 2.0 * u

    v_interp = (1.0 / h) * (dh00 * p_k + dh01 * p_k1) + dh10 * v_k + dh11 * v_k1

    return r_interp, v_interp


def compute_cw_stm(n: float, tau: float) -> np.ndarray:
    """
    Compute analytical 6x6 Clohessy-Wiltshire State Transition Matrix Phi(tau).

    Args:
        n: Chief mean motion in rad/s (n > 0).
        tau: Elapsed transfer time in seconds (tau >= 0).

    Returns:
        6x6 State Transition Matrix with det(Phi) == 1.0.
    """
    n_val = _validate_scalar_positive(n, "mean motion n")
    if not math.isfinite(tau) or tau < 0.0:
        raise ValueError(f"tau must be finite and non-negative, got {tau}.")

    s = math.sin(n_val * tau)
    c = math.cos(n_val * tau)
    nt = n_val * tau

    phi_rr = np.array(
        [
            [4.0 - 3.0 * c, 0.0, 0.0],
            [6.0 * (s - nt), 1.0, 0.0],
            [0.0, 0.0, c],
        ],
        dtype=np.float64,
    )

    phi_rv = np.array(
        [
            [s / n_val, 2.0 * (1.0 - c) / n_val, 0.0],
            [2.0 * (c - 1.0) / n_val, (4.0 * s - 3.0 * nt) / n_val, 0.0],
            [0.0, 0.0, s / n_val],
        ],
        dtype=np.float64,
    )

    phi_vr = np.array(
        [
            [3.0 * n_val * s, 0.0, 0.0],
            [6.0 * n_val * (c - 1.0), 0.0, 0.0],
            [0.0, 0.0, -n_val * s],
        ],
        dtype=np.float64,
    )

    phi_vv = np.array(
        [
            [c, 2.0 * s, 0.0],
            [-2.0 * s, 4.0 * c - 3.0, 0.0],
            [0.0, 0.0, c],
        ],
        dtype=np.float64,
    )

    phi = np.block(
        [
            [phi_rr, phi_rv],
            [phi_vr, phi_vv],
        ]
    )

    return phi


def gcrs_to_hill(
    r_chief: Any,
    v_chief: Any,
    r_deputy: Any,
    v_deputy: Any,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Transform deputy inertial GCRS state to target-centered instantaneous Hill (LVLH) frame.

    Args:
        r_chief: Chief position in GCRS (km).
        v_chief: Chief velocity in GCRS (km/s).
        r_deputy: Deputy position in GCRS (km).
        v_deputy: Deputy velocity in GCRS (km/s).

    Returns:
        tuple (rho_hill, rho_dot_hill) in km and km/s.
    """
    rc = _validate_vector_3d(r_chief, "r_chief")
    vc = _validate_vector_3d(v_chief, "v_chief")
    rd = _validate_vector_3d(r_deputy, "r_deputy")
    vd = _validate_vector_3d(v_deputy, "v_deputy")

    rc_mag = float(np.linalg.norm(rc))
    if rc_mag <= 0.0:
        raise ValueError("Chief position norm must be strictly positive.")

    h_vec = np.cross(rc, vc)
    h_mag = float(np.linalg.norm(h_vec))
    if h_mag <= 0.0:
        raise ValueError("Chief specific angular momentum is zero (degenerate radial trajectory).")

    u_r = rc / rc_mag
    w_hat = h_vec / h_mag
    u_th = np.cross(w_hat, u_r)

    q0 = np.vstack([u_r, u_th, w_hat])  # GCRS to Hill DCM

    dr = rd - rc
    dv = vd - vc

    omega_inst = h_vec / (rc_mag * rc_mag)

    rho = q0 @ dr
    rho_dot = q0 @ (dv - np.cross(omega_inst, dr))

    return rho, rho_dot


def hill_to_gcrs(
    r_chief: Any,
    v_chief: Any,
    rho: Any,
    rho_dot: Any,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Transform deputy relative state from instantaneous Hill (LVLH) frame to inertial GCRS.

    Args:
        r_chief: Chief position in GCRS (km).
        v_chief: Chief velocity in GCRS (km/s).
        rho: Deputy relative position in Hill frame (km).
        rho_dot: Deputy relative velocity in Hill frame (km/s).

    Returns:
        tuple (r_deputy_gcrs, v_deputy_gcrs) in km and km/s.
    """
    rc = _validate_vector_3d(r_chief, "r_chief")
    vc = _validate_vector_3d(v_chief, "v_chief")
    r_hill = _validate_vector_3d(rho, "rho")
    v_hill = _validate_vector_3d(rho_dot, "rho_dot")

    rc_mag = float(np.linalg.norm(rc))
    if rc_mag <= 0.0:
        raise ValueError("Chief position norm must be strictly positive.")

    h_vec = np.cross(rc, vc)
    h_mag = float(np.linalg.norm(h_vec))
    if h_mag <= 0.0:
        raise ValueError("Chief specific angular momentum is zero.")

    u_r = rc / rc_mag
    w_hat = h_vec / h_mag
    u_th = np.cross(w_hat, u_r)

    q0 = np.vstack([u_r, u_th, w_hat])

    omega_inst = h_vec / (rc_mag * rc_mag)

    dr_gcrs = q0.T @ r_hill
    r_deputy = rc + dr_gcrs

    # Kinematic transport velocity inversion:
    # v_dep = v_c + Q0^T @ v_hill + omega_inst x dr_gcrs
    v_deputy = vc + q0.T @ v_hill + np.cross(omega_inst, dr_gcrs)

    return r_deputy, v_deputy


def gcrs_to_cw(
    r_chief: Any,
    v_chief: Any,
    r_deputy: Any,
    v_deputy: Any,
    n: float,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Transform deputy inertial GCRS state to initial CW-compatible relative state at t0.

    Args:
        r_chief: Chief position in GCRS (km).
        v_chief: Chief velocity in GCRS (km/s).
        r_deputy: Deputy position in GCRS (km).
        v_deputy: Deputy velocity in GCRS (km/s).
        n: Chief mean motion in rad/s.

    Returns:
        tuple (rho_0, rho_dot_cw_0) in km and km/s.
    """
    rc = _validate_vector_3d(r_chief, "r_chief")
    vc = _validate_vector_3d(v_chief, "v_chief")
    rd = _validate_vector_3d(r_deputy, "r_deputy")
    vd = _validate_vector_3d(v_deputy, "v_deputy")
    n_val = _validate_scalar_positive(n, "n")

    rc_mag = float(np.linalg.norm(rc))
    if rc_mag <= 0.0:
        raise ValueError("Chief position norm must be strictly positive.")

    h_vec = np.cross(rc, vc)
    h_mag = float(np.linalg.norm(h_vec))
    if h_mag <= 0.0:
        raise ValueError("Chief specific angular momentum is zero.")

    u_r = rc / rc_mag
    w_hat = h_vec / h_mag
    u_th = np.cross(w_hat, u_r)

    q0 = np.vstack([u_r, u_th, w_hat])

    dr = rd - rc
    dv = vd - vc

    rho_0 = q0 @ dr
    # Method A: Direct formulation with CW constant mean motion frame rotation
    rho_dot_cw_0 = q0 @ (dv - n_val * np.cross(w_hat, dr))

    return rho_0, rho_dot_cw_0


def cw_to_gcrs(
    r_chief: Any,
    v_chief: Any,
    rho: Any,
    rho_dot: Any,
    n: float,
    tau: float,
    Q0: Any,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Transform deputy relative state in CW frame at elapsed time tau to inertial GCRS.

    Args:
        r_chief: Chief position in GCRS at time tau (km).
        v_chief: Chief velocity in GCRS at time tau (km/s).
        rho: Deputy relative position in CW frame (km).
        rho_dot: Deputy relative velocity in CW frame (km/s).
        n: Chief mean motion in rad/s.
        tau: Elapsed transfer time in seconds.
        Q0: Direction cosine matrix at t0 (GCRS to Hill/CW at t0).

    Returns:
        tuple (r_deputy_gcrs, v_deputy_gcrs) in km and km/s.
    """
    rc = _validate_vector_3d(r_chief, "r_chief")
    vc = _validate_vector_3d(v_chief, "v_chief")
    r_cw = _validate_vector_3d(rho, "rho")
    v_cw = _validate_vector_3d(rho_dot, "rho_dot")
    n_val = _validate_scalar_positive(n, "n")

    if not math.isfinite(tau) or tau < 0.0:
        raise ValueError(f"tau must be finite and non-negative, got {tau}.")

    try:
        q0 = np.asarray(Q0, dtype=np.float64)
    except Exception as exc:
        raise ValueError(f"Invalid Q0 matrix: {exc}") from exc
    if q0.shape != (3, 3):
        raise ValueError(f"Q0 must have shape (3, 3), got {q0.shape}.")

    theta = n_val * tau
    cos_th = math.cos(theta)
    sin_th = math.sin(theta)

    r_z = np.array(
        [
            [cos_th, sin_th, 0.0],
            [-sin_th, cos_th, 0.0],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )

    # Q_CW(tau) = R_z(n * tau) @ Q0
    q_cw_tau = r_z @ q0

    dr_gcrs = q_cw_tau.T @ r_cw
    r_deputy = rc + dr_gcrs

    # CW angular velocity relative to inertial space is n * z_hat in CW coordinates
    v_transport_cw = np.array([-r_cw[1] * n_val, r_cw[0] * n_val, 0.0], dtype=np.float64)
    v_deputy = vc + q_cw_tau.T @ (v_cw + v_transport_cw)

    return r_deputy, v_deputy


def solve_two_impulse_cw(
    r_chief_gcrs: Any,
    v_chief_gcrs: Any,
    rho_0: Any,
    rho_dot_0_minus: Any,
    rho_f: Any,
    rho_dot_f_plus: Any,
    tau: Any,
    config: RendezvousConfig,
) -> RendezvousResult:
    """
    Solve two-impulse Clohessy-Wiltshire rendezvous targeting in the uniformly rotating CW frame.

    Args:
        r_chief_gcrs: Target/chief position vector in GCRS (km).
        v_chief_gcrs: Target/chief velocity vector in GCRS (km/s).
        rho_0: Initial relative position in CW frame (km).
        rho_dot_0_minus: Initial relative velocity in CW frame before burn (km/s).
        rho_f: Targeted relative position in CW frame (km).
        rho_dot_f_plus: Targeted relative velocity in CW frame after arrival burn (km/s).
        tau: Transfer duration in seconds (> 0.0).
        config: Rendezvous configuration and gating thresholds.

    Returns:
        RendezvousResult containing Delta-V burns, residuals, condition number,
        and feasibility flags.
    """
    # 1. Pre-Validate Numeric Inputs
    rc = _validate_vector_3d(r_chief_gcrs, "r_chief_gcrs")
    vc = _validate_vector_3d(v_chief_gcrs, "v_chief_gcrs")
    r0 = _validate_vector_3d(rho_0, "rho_0")
    v0_minus = _validate_vector_3d(rho_dot_0_minus, "rho_dot_0_minus")
    rf = _validate_vector_3d(rho_f, "rho_f")
    vf_plus = _validate_vector_3d(rho_dot_f_plus, "rho_dot_f_plus")
    tau_val = _validate_scalar_positive(tau, "tau")

    # 2. Enforce Chief Orbit Physical Guardrails
    rc_mag = float(np.linalg.norm(rc))
    if rc_mag <= 0.0:
        raise ValueError("Chief position norm must be strictly positive.")

    h_vec = np.cross(rc, vc)
    h_mag = float(np.linalg.norm(h_vec))
    if h_mag == 0.0:
        raise ValueError("Chief specific angular momentum is zero (degenerate radial trajectory).")

    v_sq = float(np.dot(vc, vc))
    energy = 0.5 * v_sq - MU_EARTH_KM3_S2 / rc_mag
    if energy >= 0.0:
        raise ValueError(
            f"Chief orbit is unbound or parabolic (specific energy E={energy:.6f} >= 0). "
            "CW relative motion requires a bound elliptic orbit."
        )

    a_km = -MU_EARTH_KM3_S2 / (2.0 * energy)

    e_vec = np.cross(vc, h_vec) / MU_EARTH_KM3_S2 - rc / rc_mag
    e_mag = float(np.linalg.norm(e_vec))
    if e_mag > ECCENTRICITY_THRESHOLD:
        raise ValueError(
            f"Chief eccentricity e={e_mag:.6f} exceeds CW near-circular threshold "
            f"e_max={ECCENTRICITY_THRESHOLD}."
        )

    r_p = a_km * (1.0 - e_mag)
    if round(r_p, 5) < MIN_PERIGEE_RADIUS_KM:
        raise ValueError(
            f"Chief perigee radius rp={r_p:.3f} km violates atmospheric entry boundary "
            f"(min {MIN_PERIGEE_RADIUS_KM} km)."
        )

    n_val = math.sqrt(MU_EARTH_KM3_S2 / (a_km**3))

    # 3. Compute State Transition Matrix
    phi = compute_cw_stm(n_val, tau_val)
    phi_rr = phi[:3, :3]
    phi_rv = phi[:3, 3:]
    phi_vr = phi[3:, :3]
    phi_vv = phi[3:, 3:]

    # 4. Condition Number Gate
    kappa = float(np.linalg.cond(phi_rv))

    if kappa > config.max_condition_number:
        # Transfer is singular or ill-conditioned
        return RendezvousResult(
            burn_1_dv_cw_ms=[0.0, 0.0, 0.0],
            burn_2_dv_cw_ms=[0.0, 0.0, 0.0],
            total_delta_v_ms=0.0,
            transfer_time_s=tau_val,
            is_mathematically_solvable=False,
            is_budget_feasible=None,  # Not evaluated
            is_feasible=False,
            terminal_position_residual_km=[0.0, 0.0, 0.0],
            terminal_position_error_m=0.0,
            terminal_velocity_residual_kms=[0.0, 0.0, 0.0],
            terminal_velocity_error_ms=0.0,
            condition_number=kappa,
            epoch_synchronization_applied=False,
            scientific_disclaimer=SCIENTIFIC_DISCLAIMER,
        )

    # 5. Invert Linear System: Phi_rv @ rho_dot_0_plus = rho_f - Phi_rr @ rho_0
    rhs = rf - phi_rr @ r0
    try:
        rho_dot_0_plus = np.linalg.solve(phi_rv, rhs)
    except np.linalg.LinAlgError:
        return RendezvousResult(
            burn_1_dv_cw_ms=[0.0, 0.0, 0.0],
            burn_2_dv_cw_ms=[0.0, 0.0, 0.0],
            total_delta_v_ms=0.0,
            transfer_time_s=tau_val,
            is_mathematically_solvable=False,
            is_budget_feasible=None,  # Not evaluated
            is_feasible=False,
            terminal_position_residual_km=[0.0, 0.0, 0.0],
            terminal_position_error_m=0.0,
            terminal_velocity_residual_kms=[0.0, 0.0, 0.0],
            terminal_velocity_error_ms=0.0,
            condition_number=kappa,
            epoch_synchronization_applied=False,
            scientific_disclaimer=SCIENTIFIC_DISCLAIMER,
        )

    # 6. Calculate Delta-V Burns in CW Frame
    delta_v1_cw = rho_dot_0_plus - v0_minus
    rho_dot_f_minus = phi_vr @ r0 + phi_vv @ rho_dot_0_plus
    delta_v2_cw = vf_plus - rho_dot_f_minus

    burn_1_ms = delta_v1_cw * 1000.0
    burn_2_ms = delta_v2_cw * 1000.0
    mag1_ms = float(np.linalg.norm(burn_1_ms))
    mag2_ms = float(np.linalg.norm(burn_2_ms))
    total_dv_ms = mag1_ms + mag2_ms

    # 7. Evaluate Residuals
    rho_actual = phi_rr @ r0 + phi_rv @ rho_dot_0_plus
    delta_r = rho_actual - rf
    pos_err_m = float(np.linalg.norm(delta_r) * 1000.0)

    rho_dot_actual_plus = rho_dot_f_minus + delta_v2_cw
    delta_v = rho_dot_actual_plus - vf_plus
    vel_err_ms = float(np.linalg.norm(delta_v) * 1000.0)

    # 8. Feasibility Logic
    is_math_solvable = True
    is_budget_ok = bool(total_dv_ms <= config.delta_v_budget_max_ms)
    is_overall_feasible = bool(is_math_solvable and is_budget_ok)

    return RendezvousResult(
        burn_1_dv_cw_ms=burn_1_ms.tolist(),
        burn_2_dv_cw_ms=burn_2_ms.tolist(),
        total_delta_v_ms=total_dv_ms,
        transfer_time_s=tau_val,
        is_mathematically_solvable=is_math_solvable,
        is_budget_feasible=is_budget_ok,
        is_feasible=is_overall_feasible,
        terminal_position_residual_km=delta_r.tolist(),
        terminal_position_error_m=pos_err_m,
        terminal_velocity_residual_kms=delta_v.tolist(),
        terminal_velocity_error_ms=vel_err_ms,
        condition_number=kappa,
        epoch_synchronization_applied=False,
        scientific_disclaimer=SCIENTIFIC_DISCLAIMER,
    )


def plan_debris_rendezvous(
    contract: RendezvousContract,
    config: Optional[RendezvousConfig] = None,
    target_trajectory: Optional[FragmentTrajectory] = None,
) -> RendezvousResult:
    """
    Orchestrate high-level two-impulse rendezvous planning between chaser and target.

    Args:
        contract: Input contract containing target and chaser initial GCRS states.
        config: Optional solver configuration. Defaults to RendezvousConfig().
        target_trajectory: Optional Day 9 FragmentTrajectory for synthetic target synchronization.

    Returns:
        RendezvousResult with maneuver burns, diagnostics, and feasibility flags.
    """
    cfg = config if config is not None else RendezvousConfig()

    t0 = contract.chaser_epoch_utc.astimezone(timezone.utc)
    t_target = contract.target_epoch_utc.astimezone(timezone.utc)
    delta_t = abs((t_target - t0).total_seconds())

    epoch_sync_applied = False

    # Step 1: Validate Epoch Discrepancy & Closed-Bracket Policy
    if delta_t == 0.0:
        target_r_t0 = np.array(contract.target_gcrs_position_km, dtype=np.float64)
        target_v_t0 = np.array(contract.target_gcrs_velocity_kms, dtype=np.float64)
    elif delta_t > cfg.epoch_tolerance_s:
        raise ValueError(
            f"Epoch discrepancy {delta_t:.3f} s exceeds tolerance {cfg.epoch_tolerance_s:.3f} s."
        )
    else:
        # Discrepancy within tolerance (0 < delta_t <= epoch_tolerance_s)
        if not contract.target_is_synthetic:
            raise ValueError(
                "Catalog target requires external SGP4 propagation; "
                "FragmentTrajectory is prohibited."
            )
        if target_trajectory is None:
            raise ValueError(
                "target_trajectory must be provided for synthetic target epoch synchronization."
            )

        # Validate FragmentTrajectory
        _validate_fragment_trajectory(target_trajectory, contract.target_id, t0, t_target)

        # Dual-Epoch Cross-Check at t_target
        r_cross, v_cross = _interpolate_trajectory_hermite(target_trajectory, t_target)
        dr_km = float(
            np.linalg.norm(r_cross - np.array(contract.target_gcrs_position_km, dtype=np.float64))
        )
        dv_kms = float(
            np.linalg.norm(v_cross - np.array(contract.target_gcrs_velocity_kms, dtype=np.float64))
        )

        if dr_km > cfg.target_cross_check_position_tol_km:
            raise ValueError(
                f"Trajectory position mismatch {dr_km * 1000.0:.3f} m exceeds tolerance "
                f"{cfg.target_cross_check_position_tol_km * 1000.0:.3f} m at target_epoch."
            )
        if dv_kms > cfg.target_cross_check_velocity_tol_kms:
            raise ValueError(
                f"Trajectory velocity mismatch {dv_kms * 1000.0:.3f} m/s exceeds tolerance "
                f"{cfg.target_cross_check_velocity_tol_kms * 1000.0:.3f} m/s at target_epoch."
            )

        # Synchronize target state at t0 via Hermite spline
        target_r_t0, target_v_t0 = _interpolate_trajectory_hermite(target_trajectory, t0)
        epoch_sync_applied = True

    # Step 2: Validate Chief Orbit (Target is Chief)
    rc_mag = float(np.linalg.norm(target_r_t0))
    if rc_mag <= 0.0:
        raise ValueError("Chief position norm must be strictly positive.")

    h_vec = np.cross(target_r_t0, target_v_t0)
    h_mag = float(np.linalg.norm(h_vec))
    if h_mag == 0.0:
        raise ValueError("Chief specific angular momentum is zero (degenerate radial trajectory).")

    v_sq = float(np.dot(target_v_t0, target_v_t0))
    energy = 0.5 * v_sq - MU_EARTH_KM3_S2 / rc_mag
    if energy >= 0.0:
        raise ValueError(
            f"Chief orbit is unbound or parabolic (specific energy E={energy:.6f} >= 0). "
            "CW relative motion requires a bound elliptic orbit."
        )

    a_km = -MU_EARTH_KM3_S2 / (2.0 * energy)
    e_vec = np.cross(target_v_t0, h_vec) / MU_EARTH_KM3_S2 - target_r_t0 / rc_mag
    e_mag = float(np.linalg.norm(e_vec))
    if e_mag > ECCENTRICITY_THRESHOLD:
        raise ValueError(
            f"Chief eccentricity e={e_mag:.6f} exceeds CW near-circular threshold "
            f"e_max={ECCENTRICITY_THRESHOLD}."
        )

    r_p = a_km * (1.0 - e_mag)
    if round(r_p, 5) < MIN_PERIGEE_RADIUS_KM:
        raise ValueError(
            f"Chief perigee radius rp={r_p:.3f} km violates atmospheric entry boundary "
            f"(min {MIN_PERIGEE_RADIUS_KM} km)."
        )

    n_val = math.sqrt(MU_EARTH_KM3_S2 / (a_km**3))

    # Step 3: Construct CW Initial Relative State at t0
    u_r = target_r_t0 / rc_mag
    w_hat = h_vec / h_mag
    u_th = np.cross(w_hat, u_r)
    q0 = np.vstack([u_r, u_th, w_hat])  # GCRS to Hill/CW at t0

    chaser_r = np.array(contract.chaser_gcrs_position_km, dtype=np.float64)
    chaser_v = np.array(contract.chaser_gcrs_velocity_kms, dtype=np.float64)

    delta_r_0 = chaser_r - target_r_t0
    delta_v_0 = chaser_v - target_v_t0

    rho_0 = q0 @ delta_r_0
    rho_dot_cw_0 = q0 @ (delta_v_0 - n_val * np.cross(w_hat, delta_r_0))

    # Step 4: Define Final Target Relative State in CW Frame
    if cfg.targeting_mode == TargetingMode.STANDOFF_HOLD:
        # Negative along-track (trailing V-bar) nominal standoff hold
        rho_f = np.array([0.0, -cfg.standoff_distance_m / 1000.0, 0.0], dtype=np.float64)
        rho_dot_f_plus = np.array([0.0, 0.0, 0.0], dtype=np.float64)
    else:  # CONTACT_INTERCEPT
        rho_f = np.array([0.0, 0.0, 0.0], dtype=np.float64)
        rho_dot_f_plus = np.array([0.0, 0.0, 0.0], dtype=np.float64)

    # Steps 5-8: Solve Two-Impulse Problem via solve_two_impulse_cw
    result = solve_two_impulse_cw(
        r_chief_gcrs=target_r_t0,
        v_chief_gcrs=target_v_t0,
        rho_0=rho_0,
        rho_dot_0_minus=rho_dot_cw_0,
        rho_f=rho_f,
        rho_dot_f_plus=rho_dot_f_plus,
        tau=cfg.transfer_time_s,
        config=cfg,
    )

    result.epoch_synchronization_applied = epoch_sync_applied
    return result
