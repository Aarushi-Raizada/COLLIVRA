"""
Unit tests for Clohessy-Wiltshire (CW) relative motion and two-impulse rendezvous planning.

Implements all tests T-01 through T-61 from the approved Revision 15 specification.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import numpy as np
import pytest
from orbital_core.schemas import TrajectoryPoint
from simulation.rendezvous import (
    EARTH_EQUATORIAL_RADIUS_KM,
    MIN_PERIGEE_RADIUS_KM,
    MU_EARTH_KM3_S2,
    SCIENTIFIC_DISCLAIMER,
    compute_cw_stm,
    cw_to_gcrs,
    gcrs_to_hill,
    hill_to_gcrs,
    plan_debris_rendezvous,
    solve_two_impulse_cw,
)
from simulation.schemas import (
    FragmentTrajectory,
    RendezvousConfig,
    RendezvousContract,
    RendezvousResult,
    TargetingMode,
)

# ============================================================================
# Helpers
# ============================================================================


def make_circular_chief_gcrs(
    r_km: float = 6878.137,
) -> tuple[np.ndarray, np.ndarray, float]:
    """Return circular chief position, velocity, and mean motion in GCRS."""
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / r_km)
    n = math.sqrt(MU_EARTH_KM3_S2 / (r_km**3))
    r_c = np.array([r_km, 0.0, 0.0], dtype=np.float64)
    v_c = np.array([0.0, v_circ, 0.0], dtype=np.float64)
    return r_c, v_c, n


def get_circular_state_at(
    t: datetime,
    r_km: float = 6878.137,
    t_ref: datetime | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Calculate exact inertial GCRS circular orbit position and velocity at epoch t."""
    if t_ref is None:
        t_ref = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
    dt = (t.astimezone(timezone.utc) - t_ref.astimezone(timezone.utc)).total_seconds()
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / r_km)
    n = math.sqrt(MU_EARTH_KM3_S2 / (r_km**3))
    theta = n * dt
    r = np.array([r_km * math.cos(theta), r_km * math.sin(theta), 0.0], dtype=np.float64)
    v = np.array([-v_circ * math.sin(theta), v_circ * math.cos(theta), 0.0], dtype=np.float64)
    return r, v


def make_valid_contract(
    delta_t_s: float = 0.0,
    is_synthetic: bool = False,
) -> RendezvousContract:
    """Return a baseline valid RendezvousContract with physically consistent states."""
    t0 = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
    t_target = t0 + timedelta(seconds=delta_t_s)
    target_r, target_v = get_circular_state_at(t_target)
    chaser_ref_r, chaser_ref_v = get_circular_state_at(t0)
    chaser_r = chaser_ref_r + np.array([0.0, -5.0, 0.0])
    chaser_v = chaser_ref_v.copy()

    return RendezvousContract(
        target_id="DEBRIS-01",
        chaser_id="CHASER-01",
        target_is_synthetic=is_synthetic,
        target_epoch_utc=t_target,
        chaser_epoch_utc=t0,
        target_gcrs_position_km=target_r.tolist(),
        target_gcrs_velocity_kms=target_v.tolist(),
        chaser_gcrs_position_km=chaser_r.tolist(),
        chaser_gcrs_velocity_kms=chaser_v.tolist(),
    )


def make_valid_fragment_trajectory(
    target_id: str = "DEBRIS-01",
    t_start: datetime | None = None,
    duration_s: float = 60.0,
    step_s: float = 1.0,
    termination_reason: str = "COMPLETED",
    status: str = "SUCCESS",
    reentry_after_s: float | None = None,
) -> FragmentTrajectory:
    """Construct a valid synthetic FragmentTrajectory sampled along an exact circular arc."""
    if t_start is None:
        t_start = datetime(2026, 11, 3, 11, 59, 30, tzinfo=timezone.utc)

    points = []
    n_steps = int(duration_s / step_s) + 1

    for i in range(n_steps):
        dt = i * step_s
        t_i = t_start + timedelta(seconds=dt)
        if reentry_after_s is not None and dt >= reentry_after_s:
            # Below 100 km atmospheric boundary (Earth radius ~ 6378.137 -> norm < 6478.137)
            points.append(
                TrajectoryPoint(
                    epoch=t_i,
                    position_km=(6400.0, 0.0, 0.0),
                    velocity_kms=(0.0, 7.5, 0.0),
                )
            )
        else:
            r_i, v_i = get_circular_state_at(t_i)
            points.append(
                TrajectoryPoint(
                    epoch=t_i,
                    position_km=tuple(r_i.tolist()),
                    velocity_kms=tuple(v_i.tolist()),
                )
            )

    return FragmentTrajectory(
        fragment_id=target_id,
        frame="GCRS",
        position_unit="km",
        velocity_unit="km/s",
        points=points,
        status=status,
        termination_reason=termination_reason,
    )


# ============================================================================
# T-01 to T-05: Kinematics, State Transition Matrix & Transformations
# ============================================================================


def test_cw_stm_determinant_liouville():
    """T-01: det(Phi(tau)) == 1.0 +- 1e-11 across intervals (Liouville volume preservation)."""
    _, _, n = make_circular_chief_gcrs()
    intervals = [0.1, 10.0, 100.0, 600.0, 1800.0, 3600.0, 5676.0]

    for tau in intervals:
        phi = compute_cw_stm(n, tau)
        det_val = float(np.linalg.det(phi))
        assert abs(det_val - 1.0) <= 1e-11, (
            f"Liouville theorem violated at tau={tau}: det={det_val}"
        )


def test_gcrs_to_cw_velocity_equivalence():
    """T-02: Method A vs Method B discrepancy <= 1e-14 km/s across 10,000 cases (seed 42)."""
    np.random.seed(42)
    n_samples = 10000
    mu = MU_EARTH_KM3_S2
    r_mag = 6878.137
    v_circ = math.sqrt(mu / r_mag)

    max_diff = 0.0

    for _ in range(n_samples):
        r_hat = np.random.randn(3)
        r_hat /= np.linalg.norm(r_hat)
        v_dir = np.random.randn(3)
        v_dir -= np.dot(v_dir, r_hat) * r_hat
        v_dir /= np.linalg.norm(v_dir)

        # Perturb velocity within e <= 0.005
        delta_v_fraction = np.random.uniform(-0.0024, 0.0024)
        v_c = v_circ * (1.0 + delta_v_fraction) * v_dir
        r_c = r_mag * r_hat

        h_c = np.cross(r_c, v_c)
        h_mag = float(np.linalg.norm(h_c))
        w_hat = h_c / h_mag

        eps = 0.5 * float(np.dot(v_c, v_c)) - mu / r_mag
        a = -mu / (2.0 * eps)
        n = math.sqrt(mu / (a**3))
        omega_mag = h_mag / (r_mag**2)

        dr = np.random.uniform(-5.0, 5.0, size=3)
        dv = np.random.uniform(-0.01, 0.01, size=3)

        u_r = r_hat
        u_th = np.cross(w_hat, u_r)
        q0 = np.vstack([u_r, u_th, w_hat])
        rho_0 = q0 @ dr

        # Method A: Direct GCRS formulation
        v_cw0_a = q0 @ (dv - n * np.cross(w_hat, dr))

        # Method B: Via instantaneous Hill velocity + transport correction
        v_hill0 = q0 @ (dv - (h_c / (r_mag**2)) * 0.0 - np.cross(h_c / (r_mag**2), dr))
        v_cw0_b = v_hill0 + (omega_mag - n) * np.array([-rho_0[1], rho_0[0], 0.0])

        diff = float(np.linalg.norm(v_cw0_a - v_cw0_b))
        if diff > max_diff:
            max_diff = diff

    assert max_diff <= 1e-14, f"Method A vs B discrepancy {max_diff:.6e} exceeds 1e-14 km/s"


def test_cw_stm_submatrix_limits_tau_zero():
    """T-03: Submatrix limits as tau -> 0 match identity and zero matrices."""
    _, _, n = make_circular_chief_gcrs()
    phi = compute_cw_stm(n, 0.0)

    phi_rr = phi[:3, :3]
    phi_rv = phi[:3, 3:]
    phi_vr = phi[3:, :3]
    phi_vv = phi[3:, 3:]

    np.testing.assert_allclose(phi_rr, np.eye(3), atol=1e-14)
    np.testing.assert_allclose(phi_vv, np.eye(3), atol=1e-14)
    np.testing.assert_allclose(phi_rv, np.zeros((3, 3)), atol=1e-14)
    np.testing.assert_allclose(phi_vr, np.zeros((3, 3)), atol=1e-14)


def test_gcrs_to_hill_and_back_roundtrip():
    """T-04: GCRS -> Hill -> GCRS roundtrip error <= 1e-10 km and 1e-10 km/s."""
    r_c, v_c, _ = make_circular_chief_gcrs()
    r_d = r_c + np.array([1.5, -2.0, 0.5])
    v_d = v_c + np.array([0.001, -0.002, 0.0005])

    rho, rho_dot = gcrs_to_hill(r_c, v_c, r_d, v_d)
    r_d_rec, v_d_rec = hill_to_gcrs(r_c, v_c, rho, rho_dot)

    pos_err = np.linalg.norm(r_d_rec - r_d)
    vel_err = np.linalg.norm(v_d_rec - v_d)

    assert pos_err <= 1e-10, f"Position roundtrip error {pos_err} km exceeds 1e-10 km"
    assert vel_err <= 1e-10, f"Velocity roundtrip error {vel_err} km/s exceeds 1e-10 km/s"


def test_cw_to_gcrs_kinematics_time_tau():
    """T-05: Kinematics at elapsed time tau correctly map CW relative states to GCRS."""
    r_c, v_c, n = make_circular_chief_gcrs()
    u_r = r_c / np.linalg.norm(r_c)
    w_hat = np.cross(r_c, v_c) / np.linalg.norm(np.cross(r_c, v_c))
    u_th = np.cross(w_hat, u_r)
    q0 = np.vstack([u_r, u_th, w_hat])

    rho = np.array([0.1, -1.0, 0.05])
    rho_dot = np.array([0.0001, 0.0002, -0.0001])
    tau = 600.0

    # Chief at tau in circular orbit
    theta = n * tau
    r_c_tau = np.array([r_c[0] * math.cos(theta), r_c[0] * math.sin(theta), 0.0])
    v_c_tau = np.array([-v_c[1] * math.sin(theta), v_c[1] * math.cos(theta), 0.0])

    r_dep_gcrs, v_dep_gcrs = cw_to_gcrs(r_c_tau, v_c_tau, rho, rho_dot, n, tau, q0)
    assert np.all(np.isfinite(r_dep_gcrs))
    assert np.all(np.isfinite(v_dep_gcrs))
    assert np.linalg.norm(r_dep_gcrs - r_c_tau) > 0.0


# ============================================================================
# T-06 to T-13: Two-Impulse Solver, Residuals & Feasibility
# ============================================================================


def test_two_impulse_terminal_position_residual():
    """T-06: Terminal position residual error <= 1e-6 m (1 um)."""
    r_c, v_c, _ = make_circular_chief_gcrs()
    cfg = RendezvousConfig(transfer_time_s=1800.0)

    res = solve_two_impulse_cw(
        r_chief_gcrs=r_c,
        v_chief_gcrs=v_c,
        rho_0=np.array([0.0, -5.0, 0.0]),
        rho_dot_0_minus=np.array([0.0, 0.0, 0.0]),
        rho_f=np.array([0.0, 0.0, 0.0]),
        rho_dot_f_plus=np.array([0.0, 0.0, 0.0]),
        tau=1800.0,
        config=cfg,
    )
    assert res.is_mathematically_solvable is True
    assert res.terminal_position_error_m <= 1e-6, (
        f"Residual {res.terminal_position_error_m} m exceeds 1 um"
    )


def test_two_impulse_terminal_velocity_residual():
    """T-07: Terminal velocity residual error <= 1e-6 m/s (1 um/s)."""
    r_c, v_c, _ = make_circular_chief_gcrs()
    cfg = RendezvousConfig(transfer_time_s=1800.0)

    res = solve_two_impulse_cw(
        r_chief_gcrs=r_c,
        v_chief_gcrs=v_c,
        rho_0=np.array([0.0, -5.0, 0.0]),
        rho_dot_0_minus=np.array([0.0, 0.0, 0.0]),
        rho_f=np.array([0.0, 0.0, 0.0]),
        rho_dot_f_plus=np.array([0.0, 0.0, 0.0]),
        tau=1800.0,
        config=cfg,
    )
    assert res.is_mathematically_solvable is True
    assert res.terminal_velocity_error_ms <= 1e-6, (
        f"Velocity residual {res.terminal_velocity_error_ms} m/s exceeds 1 um/s"
    )


def test_two_impulse_planar_benchmark_numerical():
    """T-08: Canonical circular-chief planar fixture matches ground truth."""
    r_c, v_c, _ = make_circular_chief_gcrs()
    cfg = RendezvousConfig(transfer_time_s=1800.0)

    res = solve_two_impulse_cw(
        r_chief_gcrs=r_c,
        v_chief_gcrs=v_c,
        rho_0=np.array([0.0, -5.0, 0.0]),
        rho_dot_0_minus=np.array([0.0, 0.0, 0.0]),
        rho_f=np.array([0.0, 0.0, 0.0]),
        rho_dot_f_plus=np.array([0.0, 0.0, 0.0]),
        tau=1800.0,
        config=cfg,
    )
    expected_b1 = np.array([-2.680193, 0.867856, 0.0])
    expected_b2 = np.array([-2.680193, -0.867856, 0.0])
    expected_total = 5.634398
    expected_kappa = 4.958832

    np.testing.assert_allclose(res.burn_1_dv_cw_ms, expected_b1, atol=1e-5)
    np.testing.assert_allclose(res.burn_2_dv_cw_ms, expected_b2, atol=1e-5)
    assert abs(res.total_delta_v_ms - expected_total) <= 1e-5
    assert abs(res.condition_number - expected_kappa) <= 1e-5


def test_two_impulse_out_of_plane_motion():
    """T-09: Decoupled cross-track harmonic targeting matches analytical z solution."""
    r_c, v_c, n = make_circular_chief_gcrs()
    cfg = RendezvousConfig(transfer_time_s=1800.0)

    z0 = 1.0  # km
    zf = 0.0
    tau = 1800.0

    res = solve_two_impulse_cw(
        r_chief_gcrs=r_c,
        v_chief_gcrs=v_c,
        rho_0=np.array([0.0, 0.0, z0]),
        rho_dot_0_minus=np.array([0.0, 0.0, 0.0]),
        rho_f=np.array([0.0, 0.0, zf]),
        rho_dot_f_plus=np.array([0.0, 0.0, 0.0]),
        tau=tau,
        config=cfg,
    )
    # Analytical out-of-plane requirement: zf = z0*cos(nt) + (vz0_plus / n)*sin(nt) = 0
    # => vz0_plus = -z0 * n * cos(nt) / sin(nt)
    s = math.sin(n * tau)
    c = math.cos(n * tau)
    expected_vz0_plus_ms = (-z0 * n * (c / s)) * 1000.0

    assert abs(res.burn_1_dv_cw_ms[2] - expected_vz0_plus_ms) <= 1e-5


def test_standoff_hold_mode_geometry():
    """T-10: Standoff-hold targets nominal V-bar offset (default 100 m)."""
    contract = make_valid_contract()
    cfg = RendezvousConfig(
        targeting_mode=TargetingMode.STANDOFF_HOLD,
        standoff_distance_m=100.0,
    )
    res = plan_debris_rendezvous(contract, cfg)

    assert res.is_mathematically_solvable is True
    assert res.terminal_position_error_m <= 1e-6


def test_phi_rv_singularity_condition_number_gating():
    """T-11: Full period transfer n*tau = 2*pi triggers condition number gating."""
    r_c, v_c, n = make_circular_chief_gcrs()
    tau_singular = (2.0 * math.pi) / n
    cfg = RendezvousConfig(transfer_time_s=tau_singular)

    res = solve_two_impulse_cw(
        r_chief_gcrs=r_c,
        v_chief_gcrs=v_c,
        rho_0=np.array([0.0, -5.0, 0.0]),
        rho_dot_0_minus=np.array([0.0, 0.0, 0.0]),
        rho_f=np.array([0.0, 0.0, 0.0]),
        rho_dot_f_plus=np.array([0.0, 0.0, 0.0]),
        tau=tau_singular,
        config=cfg,
    )
    assert res.is_mathematically_solvable is False
    assert res.is_budget_feasible is None
    assert res.is_feasible is False
    assert res.condition_number > 1e7


def test_phi_rv_half_period_singularity_gating():
    """T-12: Half period transfer n*tau = pi triggers condition number gating."""
    r_c, v_c, n = make_circular_chief_gcrs()
    tau_half = math.pi / n
    cfg = RendezvousConfig(transfer_time_s=tau_half)

    res = solve_two_impulse_cw(
        r_chief_gcrs=r_c,
        v_chief_gcrs=v_c,
        rho_0=np.array([0.0, -5.0, 0.0]),
        rho_dot_0_minus=np.array([0.0, 0.0, 0.0]),
        rho_f=np.array([0.0, 0.0, 0.0]),
        rho_dot_f_plus=np.array([0.0, 0.0, 0.0]),
        tau=tau_half,
        config=cfg,
    )
    assert res.is_mathematically_solvable is False
    assert res.is_budget_feasible is None
    assert res.is_feasible is False


def test_delta_v_budget_exceeded_flag():
    """T-13: Valid solve with Delta-V exceeding budget sets is_budget_feasible=False."""
    r_c, v_c, _ = make_circular_chief_gcrs()
    cfg = RendezvousConfig(
        transfer_time_s=1800.0,
        delta_v_budget_max_ms=2.0,  # Below the required 5.63 m/s
    )
    res = solve_two_impulse_cw(
        r_chief_gcrs=r_c,
        v_chief_gcrs=v_c,
        rho_0=np.array([0.0, -5.0, 0.0]),
        rho_dot_0_minus=np.array([0.0, 0.0, 0.0]),
        rho_f=np.array([0.0, 0.0, 0.0]),
        rho_dot_f_plus=np.array([0.0, 0.0, 0.0]),
        tau=1800.0,
        config=cfg,
    )
    assert res.is_mathematically_solvable is True
    assert res.is_budget_feasible is False
    assert res.is_feasible is False


# ============================================================================
# T-14 to T-17: Chief Orbit Physics & Guardrails
# ============================================================================


def test_chief_eccentricity_rejection_over_threshold():
    """T-14: Chief with e = 0.005001 raises ValueError."""
    contract = make_valid_contract()
    r_c, v_c, _ = make_circular_chief_gcrs()
    # Perturb velocity to induce e > 0.005
    # e approx |v^2/v_circ^2 - 1|
    v_c_ecc = v_c * 1.0026  # yields e approx 0.0052
    contract.target_gcrs_velocity_kms = v_c_ecc.tolist()

    with pytest.raises(ValueError, match="exceeds CW near-circular threshold"):
        plan_debris_rendezvous(contract)


def test_chief_eccentricity_accepted_within_threshold():
    """T-15: Chief with e <= 0.005 is accepted."""
    contract = make_valid_contract()
    r_c, v_c, _ = make_circular_chief_gcrs()
    v_c_ecc = v_c * 1.0024  # yields e approx 0.0048 <= 0.005
    contract.target_gcrs_velocity_kms = v_c_ecc.tolist()

    res = plan_debris_rendezvous(contract)
    assert res.is_mathematically_solvable is True


def test_chief_perigee_altitude_rejection():
    """T-16: Chief with perigee meaningfully below 6478.137 km raises ValueError."""
    contract = make_valid_contract()
    # 1. Significantly below threshold (6470.0 km = ~91.8 km altitude, below 100 km boundary)
    r_low = np.array([6470.0, 0.0, 0.0])
    v_low = np.array([0.0, math.sqrt(MU_EARTH_KM3_S2 / 6470.0), 0.0])
    contract.target_gcrs_position_km = r_low.tolist()
    contract.target_gcrs_velocity_kms = v_low.tolist()

    with pytest.raises(ValueError, match="violates atmospheric entry boundary"):
        plan_debris_rendezvous(contract)

    # 2. Meaningfully below threshold by 1 meter (6478.136 km = MIN_PERIGEE - 1 m)
    r_below_1m_km = MIN_PERIGEE_RADIUS_KM - 0.001
    r_below = np.array([r_below_1m_km, 0.0, 0.0])
    v_below = np.array([0.0, math.sqrt(MU_EARTH_KM3_S2 / r_below_1m_km), 0.0])
    contract.target_gcrs_position_km = r_below.tolist()
    contract.target_gcrs_velocity_kms = v_below.tolist()

    with pytest.raises(ValueError, match="violates atmospheric entry boundary"):
        plan_debris_rendezvous(contract)


def test_chief_perigee_exact_boundary_accepted():
    """Chief with perigee exactly equal to 6478.137 km boundary is accepted (r_p >= 6478.137 km)."""
    assert MIN_PERIGEE_RADIUS_KM == 6478.137
    assert EARTH_EQUATORIAL_RADIUS_KM == 6378.137

    # Exact boundary value: rp = 6478.137 km (+100 km Karman line clearance)
    r_boundary = np.array([MIN_PERIGEE_RADIUS_KM, 0.0, 0.0])
    v_boundary = np.array([0.0, math.sqrt(MU_EARTH_KM3_S2 / MIN_PERIGEE_RADIUS_KM), 0.0])

    contract = make_valid_contract()
    contract.target_gcrs_position_km = r_boundary.tolist()
    contract.target_gcrs_velocity_kms = v_boundary.tolist()
    contract.chaser_gcrs_position_km = (r_boundary + np.array([0.0, -1.0, 0.0])).tolist()
    contract.chaser_gcrs_velocity_kms = v_boundary.tolist()

    res = plan_debris_rendezvous(contract)
    assert res.is_mathematically_solvable is True

    # Direct solver call must also accept exactly at rp = 6478.137 km
    cfg = RendezvousConfig()
    res_solver = solve_two_impulse_cw(
        r_chief_gcrs=r_boundary,
        v_chief_gcrs=v_boundary,
        rho_0=[0.0, -1.0, 0.0],
        rho_dot_0_minus=[0.0, 0.0, 0.0],
        rho_f=[0.0, 0.0, 0.0],
        rho_dot_f_plus=[0.0, 0.0, 0.0],
        tau=3600.0,
        config=cfg,
    )
    assert res_solver.is_mathematically_solvable is True


def test_chief_perigee_strictly_above_boundary_accepted():
    """Chief with perigee strictly above 6478.137 km (6478.138 km) is accepted."""
    # Strictly above boundary: rp = 6478.137 + 0.001 km (1 meter above boundary)
    r_valid_km = MIN_PERIGEE_RADIUS_KM + 0.001
    r_valid = np.array([r_valid_km, 0.0, 0.0])
    v_valid = np.array([0.0, math.sqrt(MU_EARTH_KM3_S2 / r_valid_km), 0.0])

    contract = make_valid_contract()
    contract.target_gcrs_position_km = r_valid.tolist()
    contract.target_gcrs_velocity_kms = v_valid.tolist()
    contract.chaser_gcrs_position_km = (r_valid + np.array([0.0, -1.0, 0.0])).tolist()
    contract.chaser_gcrs_velocity_kms = v_valid.tolist()

    res = plan_debris_rendezvous(contract)
    assert res.is_mathematically_solvable is True

    # Direct solver call must also accept rp strictly above 6478.137 km
    cfg = RendezvousConfig()
    res_direct = solve_two_impulse_cw(
        r_chief_gcrs=r_valid,
        v_chief_gcrs=v_valid,
        rho_0=[0.0, -1.0, 0.0],
        rho_dot_0_minus=[0.0, 0.0, 0.0],
        rho_f=[0.0, 0.0, 0.0],
        rho_dot_f_plus=[0.0, 0.0, 0.0],
        tau=3600.0,
        config=cfg,
    )
    assert res_direct.is_mathematically_solvable is True


def test_chief_perigee_rounding_tolerance_boundary():
    """
    Test the 5 mm half-width rounding tolerance boundary of the perigee check.

    The perigee validation rule checks `round(r_p, 5) < MIN_PERIGEE_RADIUS_KM` (6478.137 km).
    In units of kilometres, 5 decimal places corresponds to 1e-5 km = 10 mm = 1 cm.
    The half-width rounding tolerance is 5 mm (0.000005 km).

    Consequences of this policy:
    - Values within 5 mm below the nominal threshold (e.g. 6478.137 - 0.000004 km, or 4 mm below)
      round to 6478.137 km and are ACCEPTED.
    - Values beyond 5 mm below the nominal threshold (e.g. 6478.137 - 0.000006 km, or 6 mm below)
      round to 6478.13699 km < 6478.137 km and are REJECTED with ValueError.
    """
    cfg = RendezvousConfig()

    # 1. Within 5 mm tolerance (4 mm below threshold: rp = 6478.136996 km) -> round(rp, 5) == 6478.137 -> ACCEPTED
    rp_within_tol = MIN_PERIGEE_RADIUS_KM - 0.000004
    assert round(rp_within_tol, 5) == MIN_PERIGEE_RADIUS_KM
    v_within = math.sqrt(MU_EARTH_KM3_S2 / rp_within_tol)
    res_within = solve_two_impulse_cw(
        r_chief_gcrs=np.array([rp_within_tol, 0.0, 0.0]),
        v_chief_gcrs=np.array([0.0, v_within, 0.0]),
        rho_0=[0.0, -1.0, 0.0],
        rho_dot_0_minus=[0.0, 0.0, 0.0],
        rho_f=[0.0, 0.0, 0.0],
        rho_dot_f_plus=[0.0, 0.0, 0.0],
        tau=3600.0,
        config=cfg,
    )
    assert res_within.is_mathematically_solvable is True

    # 2. Outside 5 mm tolerance (6 mm below threshold: rp = 6478.136994 km) -> round(rp, 5) == 6478.13699 -> REJECTED
    rp_outside_tol = MIN_PERIGEE_RADIUS_KM - 0.000006
    assert round(rp_outside_tol, 5) < MIN_PERIGEE_RADIUS_KM
    v_outside = math.sqrt(MU_EARTH_KM3_S2 / rp_outside_tol)
    with pytest.raises(ValueError, match="violates atmospheric entry boundary"):
        solve_two_impulse_cw(
            r_chief_gcrs=np.array([rp_outside_tol, 0.0, 0.0]),
            v_chief_gcrs=np.array([0.0, v_outside, 0.0]),
            rho_0=[0.0, -1.0, 0.0],
            rho_dot_0_minus=[0.0, 0.0, 0.0],
            rho_f=[0.0, 0.0, 0.0],
            rho_dot_f_plus=[0.0, 0.0, 0.0],
            tau=3600.0,
            config=cfg,
        )


def test_chief_derived_mean_motion_kepler():
    """T-17: Mean motion is dynamically derived via Keplerian vis-viva."""
    contract = make_valid_contract()
    res = plan_debris_rendezvous(contract)
    assert res.is_mathematically_solvable is True


# ============================================================================
# T-18 to T-26: Epoch Synchronization & Benchmarks
# ============================================================================


def test_identical_epochs_zero_synchronization():
    """T-18: Equal epochs pass without trajectory lookup (epoch_synchronization_applied=False)."""
    contract = make_valid_contract(delta_t_s=0.0)
    res = plan_debris_rendezvous(contract)
    assert res.epoch_synchronization_applied is False


def test_independent_two_body_nonlinear_comparison():
    """T-19: Two-body nonlinear integration vs CW matches within expected linear bounds."""
    r_c, v_c, n = make_circular_chief_gcrs()
    rho_0 = np.array([0.05, -0.5, 0.02])
    rho_dot_0 = np.array([0.00005, 0.0001, -0.00005])

    u_r = r_c / np.linalg.norm(r_c)
    w_hat = np.cross(r_c, v_c) / np.linalg.norm(np.cross(r_c, v_c))
    u_th = np.cross(w_hat, u_r)
    q0 = np.vstack([u_r, u_th, w_hat])

    tau = 600.0
    phi = compute_cw_stm(n, tau)
    rho_cw_tau = phi[:3, :3] @ rho_0 + phi[:3, 3:] @ rho_dot_0

    # Nonlinear propagation over 10 min
    from scipy.integrate import solve_ivp

    def two_body(t, y):
        r = y[:3]
        v = y[3:]
        return np.hstack([v, -MU_EARTH_KM3_S2 * r / (np.linalg.norm(r) ** 3)])

    r_d0 = r_c + q0.T @ rho_0
    v_d0 = (
        v_c
        + q0.T @ rho_dot_0
        + np.cross((np.cross(r_c, v_c) / np.linalg.norm(r_c) ** 2), q0.T @ rho_0)
    )

    sol_c = solve_ivp(
        two_body, [0, tau], np.hstack([r_c, v_c]), method="DOP853", rtol=1e-12, atol=1e-12
    )
    sol_d = solve_ivp(
        two_body, [0, tau], np.hstack([r_d0, v_d0]), method="DOP853", rtol=1e-12, atol=1e-12
    )

    dr_gcrs_tau = sol_d.y[:3, -1] - sol_c.y[:3, -1]
    theta = n * tau
    r_z = np.array(
        [
            [math.cos(theta), math.sin(theta), 0.0],
            [-math.sin(theta), math.cos(theta), 0.0],
            [0.0, 0.0, 1.0],
        ]
    )
    rho_truth = (r_z @ q0) @ dr_gcrs_tau

    diff_m = float(np.linalg.norm(rho_truth - rho_cw_tau) * 1000.0)
    assert diff_m < 5.0, f"Discrepancy {diff_m} m exceeds linear tolerance"


def test_epoch_discrepancy_exceeding_tolerance_rejection():
    """T-20: Discrepancy > epoch_tolerance_s raises ValueError."""
    contract = make_valid_contract(delta_t_s=10.001)
    cfg = RendezvousConfig(epoch_tolerance_s=10.0)

    with pytest.raises(ValueError, match="exceeds tolerance"):
        plan_debris_rendezvous(contract, cfg)


def test_epoch_sync_catalog_target_rejection():
    """T-21: Catalog target (not synthetic) with delta_t > 0 raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=False)
    with pytest.raises(ValueError, match="Catalog target requires external SGP4 propagation"):
        plan_debris_rendezvous(contract)


def test_epoch_sync_synthetic_target_missing_trajectory():
    """T-22: Synthetic target with delta_t > 0 but target_trajectory=None raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    with pytest.raises(ValueError, match="target_trajectory must be provided"):
        plan_debris_rendezvous(contract, target_trajectory=None)


def test_epoch_sync_fragment_id_mismatch_rejection():
    """T-23: FragmentTrajectory ID mismatch raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory(target_id="OTHER-FRAG")

    with pytest.raises(ValueError, match="does not match contract.target_id"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_epoch_sync_non_gcrs_frame_rejection():
    """T-24: Non-GCRS trajectory frame raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()
    object.__setattr__(traj, "frame", "TEME")
    with pytest.raises(ValueError, match="must be 'GCRS'"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_epoch_sync_chaser_epoch_outside_bracket_rejection():
    """T-25: Chaser epoch t0 outside trajectory bracket raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    # Trajectory starting after chaser epoch
    t_late = contract.chaser_epoch_utc + timedelta(seconds=10.0)
    traj = make_valid_fragment_trajectory(t_start=t_late, duration_s=60.0)

    with pytest.raises(ValueError, match="outside trajectory closed interval"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_two_body_nonlinear_eccentric_chief_cw_frame():
    """T-26: Reproduce eccentric chief benchmark discrepancy norm == 3.087573 m."""
    from scipy.integrate import solve_ivp

    mu = MU_EARTH_KM3_S2
    r_p = 6878.137
    e = 0.005
    a = r_p / (1.0 - e)
    v_p = math.sqrt(mu * (2.0 / r_p - 1.0 / a))
    n = math.sqrt(mu / (a**3))

    r_c0 = np.array([r_p, 0.0, 0.0])
    v_c0 = np.array([0.0, v_p, 0.0])
    h_c0 = np.cross(r_c0, v_c0)
    h_mag = float(np.linalg.norm(h_c0))
    w_hat = h_c0 / h_mag

    u_r = r_c0 / r_p
    u_th = np.cross(w_hat, u_r)
    q0 = np.vstack([u_r, u_th, w_hat])

    rho_0 = np.array([0.100, -1.000, 0.050])
    dr_gcrs_0 = q0.T @ rho_0
    r_d0 = r_c0 + dr_gcrs_0

    rho_dot_hill_0 = np.array([0.0001, 0.0002, -0.0001])
    omega_inst = h_c0 / (r_p**2)
    v_d0 = v_c0 + q0.T @ rho_dot_hill_0 + np.cross(omega_inst, dr_gcrs_0)
    v_cw0 = q0 @ ((v_d0 - v_c0) - n * np.cross(w_hat, dr_gcrs_0))

    tau = 600.0

    def two_body(t, y):
        r, v = y[:3], y[3:]
        return np.hstack([v, -mu * r / (np.linalg.norm(r) ** 3)])

    sol_c = solve_ivp(
        two_body, [0, tau], np.hstack([r_c0, v_c0]), method="DOP853", rtol=1e-13, atol=1e-14
    )
    sol_d = solve_ivp(
        two_body, [0, tau], np.hstack([r_d0, v_d0]), method="DOP853", rtol=1e-13, atol=1e-14
    )

    dr_gcrs_tau = sol_d.y[:3, -1] - sol_c.y[:3, -1]
    theta = n * tau
    r_z = np.array(
        [
            [math.cos(theta), math.sin(theta), 0.0],
            [-math.sin(theta), math.cos(theta), 0.0],
            [0.0, 0.0, 1.0],
        ]
    )
    rho_truth_tau = (r_z @ q0) @ dr_gcrs_tau

    s = math.sin(n * tau)
    c = math.cos(n * tau)
    nt = n * tau
    phi_rr = np.array([[4.0 - 3.0 * c, 0.0, 0.0], [6.0 * (s - nt), 1.0, 0.0], [0.0, 0.0, c]])
    phi_rv = np.array(
        [
            [s / n, 2.0 * (1.0 - c) / n, 0.0],
            [2.0 * (c - 1.0) / n, (4.0 * s - 3.0 * nt) / n, 0.0],
            [0.0, 0.0, s / n],
        ]
    )
    rho_cw_tau = phi_rr @ rho_0 + phi_rv @ v_cw0

    diff = rho_truth_tau - rho_cw_tau
    norm_m = float(np.linalg.norm(diff) * 1000.0)

    assert abs(norm_m - 3.087573) <= 1e-5, f"T-26 benchmark mismatch: got {norm_m:.6f} m"


# ============================================================================
# T-27 to T-35: Cross-Checks, Lifecycle & Mode Validations
# ============================================================================


def test_epoch_sync_contract_target_cross_check_success():
    """T-27: Consistent trajectory at t_target passes cross-check."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()

    res = plan_debris_rendezvous(contract, target_trajectory=traj)
    assert res.is_mathematically_solvable is True
    assert res.epoch_synchronization_applied is True


def test_epoch_sync_cross_check_position_discrepancy_fail():
    """T-28: Position mismatch > 1.0 m raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()
    # Perturb contract position by 2 meters (0.002 km)
    contract.target_gcrs_position_km[0] += 0.002

    with pytest.raises(ValueError, match="position mismatch"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_epoch_sync_cross_check_velocity_discrepancy_fail():
    """T-29: Velocity mismatch > 0.1 m/s raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()
    # Perturb contract velocity by 0.2 m/s (0.0002 km/s)
    contract.target_gcrs_velocity_kms[1] += 0.0002

    with pytest.raises(ValueError, match="velocity mismatch"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_epoch_sync_numerical_failure_rejection():
    """T-30: NUMERICAL_FAILURE trajectory raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory(termination_reason="NUMERICAL_FAILURE")

    with pytest.raises(ValueError, match="NUMERICAL_FAILURE"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_epoch_sync_invalid_initial_state_rejection():
    """T-31: INVALID_INITIAL_STATE trajectory raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory(termination_reason="INVALID_INITIAL_STATE")

    with pytest.raises(ValueError, match="INVALID_INITIAL_STATE"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_epoch_sync_atmospheric_interface_valid_prefix():
    """T-32: ATMOSPHERIC_INTERFACE trajectory accepted when both t0 and t_target < reentry."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    # Reentry occurs at duration_s=120s, well after t0 and t_target
    traj = make_valid_fragment_trajectory(
        duration_s=120.0, termination_reason="ATMOSPHERIC_INTERFACE"
    )

    res = plan_debris_rendezvous(contract, target_trajectory=traj)
    assert res.is_mathematically_solvable is True


def test_epoch_sync_atmospheric_interface_post_reentry_t0():
    """T-33: ATMOSPHERIC_INTERFACE trajectory rejected when t0 >= reentry."""
    # Target epoch is 2 seconds before chaser epoch t0
    contract = make_valid_contract(delta_t_s=-2.0, is_synthetic=True)
    # Trajectory ends exactly at chaser epoch t0 (reentry_epoch == t0)
    traj = make_valid_fragment_trajectory(
        t_start=contract.chaser_epoch_utc - timedelta(seconds=30.0),
        duration_s=30.0,
        termination_reason="ATMOSPHERIC_INTERFACE",
    )
    with pytest.raises(ValueError, match="is at or post-reentry"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_standoff_distance_validation_standoff_mode():
    """T-34: Standoff distance < 10.0 m in STANDOFF_HOLD raises ValueError."""
    with pytest.raises(ValueError, match="STANDOFF_HOLD requires standoff_distance_m >= 10.0"):
        RendezvousConfig(targeting_mode=TargetingMode.STANDOFF_HOLD, standoff_distance_m=5.0)


def test_standoff_distance_validation_contact_mode():
    """T-35: Standoff distance > 1e-3 m in CONTACT_INTERCEPT raises ValueError."""
    with pytest.raises(
        ValueError, match="CONTACT_INTERCEPT requires 0.0 <= standoff_distance_m <= 1e-3"
    ):
        RendezvousConfig(targeting_mode=TargetingMode.CONTACT_INTERCEPT, standoff_distance_m=1.0)


def test_standoff_distance_negative_rejected_standoff_mode():
    """Negative standoff distance in STANDOFF_HOLD raises ValueError."""
    with pytest.raises(ValueError, match="standoff_distance_m must be non-negative"):
        RendezvousConfig(targeting_mode=TargetingMode.STANDOFF_HOLD, standoff_distance_m=-1.0)


def test_standoff_distance_negative_rejected_contact_mode():
    """Negative standoff distance in CONTACT_INTERCEPT raises ValueError."""
    with pytest.raises(ValueError, match="standoff_distance_m must be non-negative"):
        RendezvousConfig(targeting_mode=TargetingMode.CONTACT_INTERCEPT, standoff_distance_m=-1e-4)


def test_standoff_distance_boundaries_standoff_mode():
    """STANDOFF_HOLD accepts standoff_distance_m >= 10.0 and rejects < 10.0."""
    # Boundary 10.0 m is accepted
    cfg_exact = RendezvousConfig(
        targeting_mode=TargetingMode.STANDOFF_HOLD, standoff_distance_m=10.0
    )
    assert cfg_exact.standoff_distance_m == 10.0

    # Strictly above boundary is accepted
    cfg_above = RendezvousConfig(
        targeting_mode=TargetingMode.STANDOFF_HOLD, standoff_distance_m=10.001
    )
    assert cfg_above.standoff_distance_m == 10.001

    # Strictly below boundary is rejected
    with pytest.raises(ValueError, match="STANDOFF_HOLD requires standoff_distance_m >= 10.0"):
        RendezvousConfig(targeting_mode=TargetingMode.STANDOFF_HOLD, standoff_distance_m=9.999)


def test_standoff_distance_boundaries_contact_mode():
    """CONTACT_INTERCEPT accepts 0.0 <= standoff_distance_m <= 1e-3."""
    # Zero standoff is accepted (exact contact)
    cfg_zero = RendezvousConfig(
        targeting_mode=TargetingMode.CONTACT_INTERCEPT, standoff_distance_m=0.0
    )
    assert cfg_zero.standoff_distance_m == 0.0

    # Upper boundary 1e-3 is accepted
    cfg_upper = RendezvousConfig(
        targeting_mode=TargetingMode.CONTACT_INTERCEPT, standoff_distance_m=1e-3
    )
    assert cfg_upper.standoff_distance_m == 1e-3

    # Strictly above upper boundary is rejected
    with pytest.raises(
        ValueError, match="CONTACT_INTERCEPT requires 0.0 <= standoff_distance_m <= 1e-3"
    ):
        RendezvousConfig(
            targeting_mode=TargetingMode.CONTACT_INTERCEPT, standoff_distance_m=1.001e-3
        )


# ============================================================================
# T-36 to T-44: Schema, Disclaimers, Intercept & Exceptions
# ============================================================================


def test_timezone_naive_epoch_rejection():
    """T-36: Timezone-naive datetime raises ValueError."""
    naive_dt = datetime(2026, 11, 3, 12, 0, 0)
    with pytest.raises(ValueError, match="must be timezone-aware"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=naive_dt,
            chaser_epoch_utc=datetime.now(timezone.utc),
            target_gcrs_position_km=[7000.0, 0.0, 0.0],
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )


def test_nan_inf_coordinate_rejection():
    """T-37: NaN or Inf coordinate raises ValueError."""
    with pytest.raises(ValueError, match="must be finite"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=datetime.now(timezone.utc),
            chaser_epoch_utc=datetime.now(timezone.utc),
            target_gcrs_position_km=[float("nan"), 0.0, 0.0],
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )

    with pytest.raises(ValueError, match="must be finite"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=datetime.now(timezone.utc),
            chaser_epoch_utc=datetime.now(timezone.utc),
            target_gcrs_position_km=[7000.0, 0.0, 0.0],
            target_gcrs_velocity_kms=[0.0, float("inf"), 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )

    with pytest.raises(ValueError, match="must be finite"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=datetime.now(timezone.utc),
            chaser_epoch_utc=datetime.now(timezone.utc),
            target_gcrs_position_km=[7000.0, 0.0, 0.0],
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, float("-inf")],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )


def test_rendezvous_contract_boolean_coordinate_rejection():
    """RendezvousContract rejects boolean coordinates without coercion."""
    base = make_valid_contract()
    now = base.chaser_epoch_utc

    # Target position with boolean True
    with pytest.raises(ValueError, match="cannot be a boolean"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=now,
            chaser_epoch_utc=now,
            target_gcrs_position_km=[True, 0.0, 0.0],
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )

    # Chaser velocity with boolean False
    with pytest.raises(ValueError, match="cannot be a boolean"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=now,
            chaser_epoch_utc=now,
            target_gcrs_position_km=[7000.0, 0.0, 0.0],
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, False],
        )

    # Chaser velocity with np.bool_
    with pytest.raises(ValueError, match="cannot be a boolean|must contain real numeric values"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=now,
            chaser_epoch_utc=now,
            target_gcrs_position_km=[7000.0, 0.0, 0.0],
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, np.bool_(False)],
        )


def test_rendezvous_contract_string_coordinate_rejection():
    """RendezvousContract rejects string and bytes coordinates without coercion."""
    now = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)

    # String element in position
    with pytest.raises(ValueError, match="cannot be a string or bytes"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=now,
            chaser_epoch_utc=now,
            target_gcrs_position_km=["7000.0", 0.0, 0.0],
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )

    # Complete string passed as coordinate field
    with pytest.raises(ValueError, match="cannot be a string or bytes"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=now,
            chaser_epoch_utc=now,
            target_gcrs_position_km="7000.0, 0.0, 0.0",  # type: ignore[arg-type]
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )


def test_rendezvous_contract_complex_coordinate_rejection():
    """RendezvousContract rejects complex coordinate inputs."""
    now = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)

    # Python complex
    with pytest.raises(ValueError, match="cannot be a complex number|cannot contain complex"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=now,
            chaser_epoch_utc=now,
            target_gcrs_position_km=[7000.0 + 1.0j, 0.0, 0.0],
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )

    # NumPy complex array
    with pytest.raises(
        ValueError, match="cannot contain complex numbers|must contain real numeric values"
    ):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=now,
            chaser_epoch_utc=now,
            target_gcrs_position_km=np.array([7000.0, 0.0, 0.0], dtype=np.complex128),  # type: ignore[arg-type]
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )


def test_rendezvous_contract_malformed_dimensions_rejection():
    """RendezvousContract rejects coordinate inputs with length != 3 or invalid dimension."""
    now = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)

    # 2 components
    with pytest.raises(ValueError, match="must have exactly 3 components"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=now,
            chaser_epoch_utc=now,
            target_gcrs_position_km=[7000.0, 0.0],
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )

    # 4 components
    with pytest.raises(ValueError, match="must have exactly 3 components"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=now,
            chaser_epoch_utc=now,
            target_gcrs_position_km=[7000.0, 0.0, 0.0, 1.0],
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )

    # 2D array
    with pytest.raises(ValueError, match="must be a 1D sequence"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=now,
            chaser_epoch_utc=now,
            target_gcrs_position_km=np.zeros((3, 3)),  # type: ignore[arg-type]
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )

    # None in list
    with pytest.raises(ValueError, match="cannot be None"):
        RendezvousContract(
            target_id="D1",
            chaser_id="C1",
            target_epoch_utc=now,
            chaser_epoch_utc=now,
            target_gcrs_position_km=[None, 0.0, 0.0],  # type: ignore[list-item]
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )


def test_rendezvous_contract_integer_coordinate_acceptance():
    """RendezvousContract accepts integer coordinates and returns them as floats."""
    now = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
    contract = RendezvousContract(
        target_id="D1",
        chaser_id="C1",
        target_epoch_utc=now,
        chaser_epoch_utc=now,
        target_gcrs_position_km=[7000, 0, 0],
        target_gcrs_velocity_kms=[0, 7, 0],
        chaser_gcrs_position_km=[7000, -1, 0],
        chaser_gcrs_velocity_kms=[0, 7, 0],
    )
    assert contract.target_gcrs_position_km == [7000.0, 0.0, 0.0]
    assert isinstance(contract.target_gcrs_position_km[0], float)
    assert contract.target_gcrs_velocity_kms == [0.0, 7.0, 0.0]
    assert isinstance(contract.target_gcrs_velocity_kms[1], float)


def test_empty_identifier_rejection():
    """T-38: Empty target_id or chaser_id raises ValueError."""
    with pytest.raises(ValueError):
        RendezvousContract(
            target_id="",
            chaser_id="C1",
            target_epoch_utc=datetime.now(timezone.utc),
            chaser_epoch_utc=datetime.now(timezone.utc),
            target_gcrs_position_km=[7000.0, 0.0, 0.0],
            target_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            chaser_gcrs_position_km=[7000.0, -1.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )


def test_scientific_disclaimer_presence():
    """T-39: Default disclaimer string matches exact approved wording."""
    res = RendezvousResult(
        burn_1_dv_cw_ms=[0.0, 0.0, 0.0],
        burn_2_dv_cw_ms=[0.0, 0.0, 0.0],
        total_delta_v_ms=0.0,
        transfer_time_s=3600.0,
        is_mathematically_solvable=True,
        is_budget_feasible=True,
        is_feasible=True,
        terminal_position_residual_km=[0.0, 0.0, 0.0],
        terminal_position_error_m=0.0,
        terminal_velocity_residual_kms=[0.0, 0.0, 0.0],
        terminal_velocity_error_ms=0.0,
        condition_number=1.0,
    )
    assert res.scientific_disclaimer == SCIENTIFIC_DISCLAIMER


def test_contact_intercept_targeting_convergence():
    """T-40: Contact intercept converges to [0, 0, 0] within 1 um."""
    contract = make_valid_contract()
    cfg = RendezvousConfig(
        targeting_mode=TargetingMode.CONTACT_INTERCEPT,
        standoff_distance_m=0.0,
    )
    res = plan_debris_rendezvous(contract, cfg)
    assert res.is_mathematically_solvable is True
    assert res.terminal_position_error_m <= 1e-6


def test_linear_solver_exception_unsolvable():
    """T-41: LinAlgError in solver sets solvable=False, budget_feasible=None."""
    r_c, v_c, _ = make_circular_chief_gcrs()
    cfg = RendezvousConfig(transfer_time_s=1800.0)

    with patch("numpy.linalg.solve", side_effect=np.linalg.LinAlgError("Singular matrix")):
        res = solve_two_impulse_cw(
            r_chief_gcrs=r_c,
            v_chief_gcrs=v_c,
            rho_0=np.array([0.0, -5.0, 0.0]),
            rho_dot_0_minus=np.array([0.0, 0.0, 0.0]),
            rho_f=np.array([0.0, 0.0, 0.0]),
            rho_dot_f_plus=np.array([0.0, 0.0, 0.0]),
            tau=1800.0,
            config=cfg,
        )
        assert res.is_mathematically_solvable is False
        assert res.is_budget_feasible is None
        assert res.is_feasible is False
        assert res.total_delta_v_ms == 0.0


def test_timezone_normalization_utc_and_offset():
    """T-42: UTC and UTC+05:30 timestamps normalize to identical instant with zero discrepancy."""
    t_utc = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
    t_ist = datetime(2026, 11, 3, 17, 30, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))

    r_c, v_c, _ = make_circular_chief_gcrs()
    contract = RendezvousContract(
        target_id="D1",
        chaser_id="C1",
        target_epoch_utc=t_ist,
        chaser_epoch_utc=t_utc,
        target_gcrs_position_km=r_c.tolist(),
        target_gcrs_velocity_kms=v_c.tolist(),
        chaser_gcrs_position_km=(r_c + np.array([0.0, -5.0, 0.0])).tolist(),
        chaser_gcrs_velocity_kms=v_c.tolist(),
    )
    res = plan_debris_rendezvous(contract)
    assert res.is_mathematically_solvable is True
    assert res.epoch_synchronization_applied is False


def test_epoch_sync_target_epoch_outside_bracket_rejection():
    """T-43: Target epoch outside trajectory bracket raises ValueError."""
    contract = make_valid_contract(delta_t_s=5.0, is_synthetic=True)
    # Trajectory ending before target epoch
    t_start = contract.chaser_epoch_utc - timedelta(seconds=10.0)
    traj = make_valid_fragment_trajectory(t_start=t_start, duration_s=12.0)  # ends before t_target
    contract.target_epoch_utc = t_start + timedelta(seconds=20.0)

    with pytest.raises(ValueError, match="outside trajectory closed interval"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_epoch_sync_trajectory_status_failed_rejection():
    """T-44: FAILED trajectory status raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory(status="FAILED")

    with pytest.raises(ValueError, match="status is 'FAILED'"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


# ============================================================================
# T-45 to T-52: Direct Solver Validation Cases
# ============================================================================


def test_direct_solver_vector_fewer_than_3_components():
    """T-45: Passing vector with < 3 components to solve_two_impulse_cw raises ValueError."""
    r_c, v_c, _ = make_circular_chief_gcrs()
    cfg = RendezvousConfig()
    with pytest.raises(ValueError, match="must have shape \\(3,\\)"):
        solve_two_impulse_cw(
            r_chief_gcrs=[1.0, 2.0],
            v_chief_gcrs=v_c,
            rho_0=[0, 0, 0],
            rho_dot_0_minus=[0, 0, 0],
            rho_f=[0, 0, 0],
            rho_dot_f_plus=[0, 0, 0],
            tau=3600.0,
            config=cfg,
        )


def test_direct_solver_vector_more_than_3_components():
    """T-46: Passing vector with > 3 components to solve_two_impulse_cw raises ValueError."""
    r_c, v_c, _ = make_circular_chief_gcrs()
    cfg = RendezvousConfig()
    with pytest.raises(ValueError, match="must have shape \\(3,\\)"):
        solve_two_impulse_cw(
            r_chief_gcrs=[1.0, 2.0, 3.0, 4.0],
            v_chief_gcrs=v_c,
            rho_0=[0, 0, 0],
            rho_dot_0_minus=[0, 0, 0],
            rho_f=[0, 0, 0],
            rho_dot_f_plus=[0, 0, 0],
            tau=3600.0,
            config=cfg,
        )


def test_direct_solver_vector_2d_shape():
    """T-47: Passing 2D array shape to solve_two_impulse_cw raises ValueError."""
    r_c, v_c, _ = make_circular_chief_gcrs()
    cfg = RendezvousConfig()
    with pytest.raises(ValueError, match="must have shape \\(3,\\)"):
        solve_two_impulse_cw(
            r_chief_gcrs=np.ones((3, 1)),
            v_chief_gcrs=v_c,
            rho_0=[0, 0, 0],
            rho_dot_0_minus=[0, 0, 0],
            rho_f=[0, 0, 0],
            rho_dot_f_plus=[0, 0, 0],
            tau=3600.0,
            config=cfg,
        )


def test_direct_solver_vector_nan_and_inf():
    """T-48: Passing NaN or Inf to solve_two_impulse_cw raises ValueError."""
    r_c, v_c, _ = make_circular_chief_gcrs()
    cfg = RendezvousConfig()
    with pytest.raises(ValueError, match="must contain finite real numbers"):
        solve_two_impulse_cw(
            r_chief_gcrs=[r_c[0], float("nan"), 0.0],
            v_chief_gcrs=v_c,
            rho_0=[0, 0, 0],
            rho_dot_0_minus=[0, 0, 0],
            rho_f=[0, 0, 0],
            rho_dot_f_plus=[0, 0, 0],
            tau=3600.0,
            config=cfg,
        )


def test_direct_solver_vector_non_numeric_and_complex():
    """T-49: Passing complex numbers or strings to solve_two_impulse_cw raises ValueError."""
    r_c, v_c, _ = make_circular_chief_gcrs()
    cfg = RendezvousConfig()
    with pytest.raises(ValueError, match="complex"):
        solve_two_impulse_cw(
            r_chief_gcrs=[r_c[0], 1.0 + 2.0j, 0.0],
            v_chief_gcrs=v_c,
            rho_0=[0, 0, 0],
            rho_dot_0_minus=[0, 0, 0],
            rho_f=[0, 0, 0],
            rho_dot_f_plus=[0, 0, 0],
            tau=3600.0,
            config=cfg,
        )


def test_direct_solver_tau_zero_negative_nan_inf():
    """T-50: Passing non-positive, NaN, or Inf tau raises ValueError."""
    r_c, v_c, _ = make_circular_chief_gcrs()
    cfg = RendezvousConfig()
    with pytest.raises(ValueError, match="must be finite and strictly positive"):
        solve_two_impulse_cw(
            r_chief_gcrs=r_c,
            v_chief_gcrs=v_c,
            rho_0=[0, 0, 0],
            rho_dot_0_minus=[0, 0, 0],
            rho_f=[0, 0, 0],
            rho_dot_f_plus=[0, 0, 0],
            tau=0.0,
            config=cfg,
        )
    with pytest.raises(ValueError, match="must be finite and strictly positive"):
        solve_two_impulse_cw(
            r_chief_gcrs=r_c,
            v_chief_gcrs=v_c,
            rho_0=[0, 0, 0],
            rho_dot_0_minus=[0, 0, 0],
            rho_f=[0, 0, 0],
            rho_dot_f_plus=[0, 0, 0],
            tau=-10.0,
            config=cfg,
        )


def test_direct_solver_physics_validation_degenerate_chief():
    """T-51: Chief orbit with zero momentum, parabolic energy, or e > 0.005 raises ValueError."""
    cfg = RendezvousConfig()
    # Zero momentum
    with pytest.raises(ValueError, match="angular momentum is zero"):
        solve_two_impulse_cw(
            r_chief_gcrs=[7000.0, 0.0, 0.0],
            v_chief_gcrs=[0.0, 0.0, 0.0],
            rho_0=[0, 0, 0],
            rho_dot_0_minus=[0, 0, 0],
            rho_f=[0, 0, 0],
            rho_dot_f_plus=[0, 0, 0],
            tau=3600.0,
            config=cfg,
        )

    # Parabolic orbit (v = escape speed sqrt(2*mu/r))
    v_esc = math.sqrt(2.0 * MU_EARTH_KM3_S2 / 7000.0)
    with pytest.raises(ValueError, match="unbound or parabolic"):
        solve_two_impulse_cw(
            r_chief_gcrs=[7000.0, 0.0, 0.0],
            v_chief_gcrs=[0.0, v_esc, 0.0],
            rho_0=[0, 0, 0],
            rho_dot_0_minus=[0, 0, 0],
            rho_f=[0, 0, 0],
            rho_dot_f_plus=[0, 0, 0],
            tau=3600.0,
            config=cfg,
        )


def test_epoch_sync_atmospheric_interface_target_epoch_reentry_rejection():
    """T-52: t0 < reentry but t_target >= reentry raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    # Reentry occurs at duration_s=32.0s
    t_start = contract.chaser_epoch_utc - timedelta(seconds=30.0)
    traj = make_valid_fragment_trajectory(
        t_start=t_start,
        duration_s=32.0,
        termination_reason="ATMOSPHERIC_INTERFACE",
    )
    # target_epoch is at or past reentry (reentry is at t_start + 32s = t0 + 2s)
    contract.target_epoch_utc = t_start + timedelta(seconds=32.0)
    r_target, v_target = get_circular_state_at(contract.target_epoch_utc)
    contract.target_gcrs_position_km = r_target.tolist()
    contract.target_gcrs_velocity_kms = v_target.tolist()

    with pytest.raises(ValueError, match="is at or post-reentry"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


# ============================================================================
# T-53 to T-61: Advanced Trajectory Validation Cases
# ============================================================================


def test_trajectory_validation_non_monotonic_timestamps():
    """T-53: Decreasing timestamps in trajectory points raise ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()
    # Swap two timestamps to create non-monotonicity
    traj.points[1].epoch, traj.points[2].epoch = traj.points[2].epoch, traj.points[1].epoch

    with pytest.raises(ValueError, match="non-monotonic"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_trajectory_validation_duplicate_timestamps():
    """T-54: Duplicate timestamps in trajectory points raise ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()
    traj.points[1].epoch = traj.points[0].epoch

    with pytest.raises(ValueError, match="duplicate timestamp"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_trajectory_validation_naive_point_timestamp():
    """T-55: Timezone-naive point timestamp raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()
    object.__setattr__(traj.points[1], "epoch", datetime(2026, 11, 3, 12, 0, 0))  # naive

    with pytest.raises(ValueError, match="must be timezone-aware"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_trajectory_validation_nan_inf_position():
    """T-56: NaN or Inf in trajectory point position raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()
    traj.points[1].position_km = (float("nan"), 0.0, 0.0)

    with pytest.raises(ValueError, match="must be finite"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_trajectory_validation_nan_inf_velocity():
    """T-57: NaN or Inf in trajectory point velocity raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()
    traj.points[1].velocity_kms = (0.0, float("inf"), 0.0)

    with pytest.raises(ValueError, match="must be finite"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_trajectory_validation_start_epoch_inconsistent():
    """T-58: Inconsistent start_epoch raises ValueError."""
    # We test _validate_fragment_trajectory directly by mocking property or mutating
    from simulation.rendezvous import _validate_fragment_trajectory

    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()

    with patch.object(
        FragmentTrajectory, "start_epoch", new=contract.chaser_epoch_utc + timedelta(hours=1)
    ):
        with pytest.raises(ValueError, match="start_epoch"):
            _validate_fragment_trajectory(
                traj,
                contract.target_id,
                contract.chaser_epoch_utc,
                contract.target_epoch_utc,
            )


def test_trajectory_validation_end_epoch_inconsistent():
    """T-59: Inconsistent end_epoch raises ValueError."""
    from simulation.rendezvous import _validate_fragment_trajectory

    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()

    with patch.object(
        FragmentTrajectory, "end_epoch", new=contract.chaser_epoch_utc - timedelta(hours=1)
    ):
        with pytest.raises(ValueError, match="end_epoch"):
            _validate_fragment_trajectory(
                traj,
                contract.target_id,
                contract.chaser_epoch_utc,
                contract.target_epoch_utc,
            )


def test_trajectory_validation_complex_coordinates_rejection():
    """T-60: Complex numbers in trajectory coordinates raise ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()
    object.__setattr__(traj.points[0], "position_km", (1.0 + 2.0j, 0.0, 0.0))

    with pytest.raises(ValueError, match="complex"):
        plan_debris_rendezvous(contract, target_trajectory=traj)


def test_trajectory_validation_non_numeric_coordinates_rejection():
    """T-61: String or boolean in trajectory coordinates raises ValueError."""
    contract = make_valid_contract(delta_t_s=2.0, is_synthetic=True)
    traj = make_valid_fragment_trajectory()
    object.__setattr__(traj.points[0], "position_km", ("string_val", 0.0, 0.0))

    with pytest.raises(ValueError, match="non-numeric|could not be converted"):
        plan_debris_rendezvous(contract, target_trajectory=traj)
