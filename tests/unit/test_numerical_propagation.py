"""
Unit and validation test suite for Day 9: Synthetic Fragment Numerical Propagation.

Validates:
1. Celestial Intermediate Pole (CIP) orientation and IAU 2006/2000A bias-precession-nutation.
2. Two-body and J2 gravitational acceleration field equations.
3. Analytical nodal precession rate (nodal regression) consistency.
4. Time grid generation, endpoint handling, and output point safeguards.
5. Physical admissibility checks and input domain validation.
6. Continuous atmospheric interface (100 km) reentry detection and exact event state recording.
7. Failure isolation and strict decoupling of solver failure from atmospheric decay.
8. End-to-end integration with Day 8 synthetic collision fragmentation engine.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

import astropy.units as u
import numpy as np
import pytest
from astropy.coordinates import CIRS, GCRS, CartesianRepresentation
from astropy.time import Time
from orbital_core.schemas import SatelliteTrajectory, TrajectoryBatchResponse
from simulation import (
    DEFAULT_MAX_BATCH_POINTS,
    DEFAULT_MAX_POINTS_PER_TRAJECTORY,
    J2_EARTH,
    MU_EARTH_KM3_S2,
    R_EARTH_EQUATORIAL_KM,
    R_REENTRY_KM,
    CollisionScenario,
    FragmentationConfig,
    NumericalPropagationConfig,
    ParentBodyState,
    SyntheticFragmentRecord,
    compute_time_grid,
    compute_two_body_j2_acceleration,
    generate_fragments,
    get_cip_unit_vector,
    propagate_fragment,
    propagate_fragment_batch,
    validate_initial_fragment_state,
    validate_output_safeguards,
)

# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def ref_epoch_utc() -> datetime:
    """Standard simulation reference epoch in UTC."""
    return datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def nominal_leo_fragment(ref_epoch_utc: datetime) -> SyntheticFragmentRecord:
    """A realistic non-decaying LEO fragment (circular orbit at 7000 km, ~7.546 km/s)."""
    # Circular velocity v = sqrt(mu / r) = sqrt(398600.4418 / 7000) ~ 7.54605 km/s
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7000.0)
    return SyntheticFragmentRecord(
        fragment_id="SYNTH-FRAG-TEST-0001",
        source_parent_id="COMBINED",
        epoch=ref_epoch_utc,
        frame="GCRS",
        position_km=(7000.0, 0.0, 0.0),
        velocity_kms=(0.0, v_circ, 0.0),
        mass_kg=12.5,
        delta_v_kms=0.05,
        ejection_vector_kms=(0.0, 0.05, 0.0),
        is_synthetic=True,
    )


@pytest.fixture
def decaying_leo_fragment(ref_epoch_utc: datetime) -> SyntheticFragmentRecord:
    """A retrograde fragment whose perigee drops deeply into the upper atmosphere."""
    # Strong retrograde delta-V (dropping velocity from 7.546 to 7.0 km/s)
    # At r = 7000 km, v = 7.0 km/s:
    # energy = 7.0^2 / 2 - 398600.4418 / 7000 = 24.5 - 56.9429 = -32.4429 km^2/s^2
    # a = mu / (-2 * energy) = 398600.4418 / 64.8858 ~ 6143 km
    # r_perigee = 2*a - r_apogee = 12286 - 7000 = 5286 km < 6478.137 km (well below 100 km!)
    return SyntheticFragmentRecord(
        fragment_id="SYNTH-FRAG-REENTRY-0001",
        source_parent_id="COMBINED",
        epoch=ref_epoch_utc,
        frame="GCRS",
        position_km=(7000.0, 0.0, 0.0),
        velocity_kms=(0.0, 7.0, 0.0),
        mass_kg=5.0,
        delta_v_kms=0.546,
        ejection_vector_kms=(0.0, -0.546, 0.0),
        is_synthetic=True,
    )


# ============================================================================
# 1. CIP Orientation & Precession Tests
# ============================================================================


class TestCIPOrientation:
    """Verify ERFA-based CIP unit vector calculation in GCRS."""

    def test_cip_unit_vector_norm(self, ref_epoch_utc: datetime):
        """CIP vector must be normalized to unity within float precision."""
        pole = get_cip_unit_vector(ref_epoch_utc)
        assert isinstance(pole, np.ndarray)
        assert pole.shape == (3,)
        norm = np.linalg.norm(pole)
        assert abs(norm - 1.0) < 1e-15

    def test_cip_matches_astropy_cirs_to_gcrs(self, ref_epoch_utc: datetime):
        """ERFA pnm06a derivation must match Astropy CIRS->GCRS pole transformation."""
        pole_erfa = get_cip_unit_vector(ref_epoch_utc)

        t_astro = Time(ref_epoch_utc, scale="utc")
        cirs_z = CIRS(
            CartesianRepresentation(0.0 * u.one, 0.0 * u.one, 1.0 * u.one),
            obstime=t_astro,
        )
        gcrs_z = cirs_z.transform_to(GCRS(obstime=t_astro))
        pole_astropy = np.array(
            [
                gcrs_z.cartesian.x.value,
                gcrs_z.cartesian.y.value,
                gcrs_z.cartesian.z.value,
            ],
            dtype=np.float64,
        )
        pole_astropy /= np.linalg.norm(pole_astropy)

        residual = np.linalg.norm(pole_erfa - pole_astropy)
        assert residual < 1e-14, f"ERFA and Astropy CIP vectors disagree by {residual}"

    def test_cip_tilt_angle_bounds(self, ref_epoch_utc: datetime):
        """Angular separation of CIP from GCRS +Z in 2026 must reflect physical precession."""
        pole = get_cip_unit_vector(ref_epoch_utc)
        # Separation from [0, 0, 1]
        theta_rad = math.atan2(math.hypot(pole[0], pole[1]), pole[2])
        theta_deg = math.degrees(theta_rad)

        # In 2026 (~26.8 years past J2000), polar precession (speed of pole ~20 arcsec/yr)
        # produces an accumulated tilt of ~540 arcsec (~0.15 deg).
        assert 0.14 <= theta_deg <= 0.16, (
            f"Calculated tilt {theta_deg:.4f} deg is outside physical bounds"
        )

    def test_cip_precession_rate_over_years(self):
        """CIP vector must shift across decades at approximately 20 arcseconds/year."""
        t1 = datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        t2 = datetime(2020, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

        p1 = get_cip_unit_vector(t1)
        p2 = get_cip_unit_vector(t2)

        dot = float(np.clip(np.dot(p1, p2), -1.0, 1.0))
        angle_arcsec = math.degrees(math.acos(dot)) * 3600.0
        rate_arcsec_yr = angle_arcsec / 20.0

        # General precession projected onto pole is ~20.0 arcsec/yr (with nutation oscillations)
        assert 18.0 <= rate_arcsec_yr <= 22.0

    def test_fixed_cip_24h_drift_bound(self, ref_epoch_utc: datetime):
        """24-hour fixed-epoch CIP drift against time-varying CIP is below 0.10 m for LEO."""
        import erfa
        from scipy.integrate import solve_ivp

        t_astropy = Time(ref_epoch_utc, scale="utc")
        jd1_tt, jd2_tt = erfa.taitt(*erfa.utctai(t_astropy.jd1, t_astropy.jd2))

        # Fixed CIP at reference epoch
        pole_fixed = get_cip_unit_vector(ref_epoch_utc)

        def get_dynamic_cip(t_sec: float) -> np.ndarray:
            dt_days = t_sec / 86400.0
            q_mat = erfa.pnm06a(jd1_tt, jd2_tt + dt_days)
            pole_dyn = q_mat[2, :].copy().astype(np.float64)
            return pole_dyn / np.linalg.norm(pole_dyn)

        def rhs_fixed(t: float, y: np.ndarray) -> np.ndarray:
            r_vec = y[:3]
            v_vec = y[3:]
            a_vec = compute_two_body_j2_acceleration(r_vec, pole_fixed)
            return np.concatenate([v_vec, a_vec])

        def rhs_dynamic(t: float, y: np.ndarray) -> np.ndarray:
            r_vec = y[:3]
            v_vec = y[3:]
            pole_dyn = get_dynamic_cip(t)
            a_vec = compute_two_body_j2_acceleration(r_vec, pole_dyn)
            return np.concatenate([v_vec, a_vec])

        atol = np.array([1e-9, 1e-9, 1e-9, 1e-10, 1e-10, 1e-10])
        rtol = 1e-8
        t_span = (0.0, 86400.0)
        t_eval = np.linspace(0.0, 86400.0, 145)  # 10-minute sampling grid

        for inc_deg in (51.6, 90.0):
            inc = math.radians(inc_deg)
            r_mag = 6800.0
            v_mag = math.sqrt(MU_EARTH_KM3_S2 / r_mag)
            r0 = np.array([r_mag, 0.0, 0.0])
            v0 = np.array([0.0, v_mag * math.cos(inc), v_mag * math.sin(inc)])
            y0 = np.concatenate([r0, v0])

            sol_fixed = solve_ivp(
                rhs_fixed, t_span, y0, method="DOP853", t_eval=t_eval, rtol=rtol, atol=atol
            )
            sol_dyn = solve_ivp(
                rhs_dynamic, t_span, y0, method="DOP853", t_eval=t_eval, rtol=rtol, atol=atol
            )

            assert sol_fixed.status == 0
            assert sol_dyn.status == 0

            pos_diff_km = np.linalg.norm(sol_fixed.y[:3, :] - sol_dyn.y[:3, :], axis=0)
            max_pos_diff_m = float(np.max(pos_diff_km) * 1000.0)

            # Maximum drift must be strictly below 0.10 metres (10 cm) over 24 hours
            assert max_pos_diff_m < 0.10, (
                f"Fixed-CIP drift {max_pos_diff_m:.4f} m exceeds 0.10 m bound at inc={inc_deg} deg"
            )


# ============================================================================
# 2. Force Model & Acceleration Equations
# ============================================================================


class TestForceModel:
    """Verify two-body gravity and J2 perturbation acceleration computations."""

    def test_acceleration_magnitudes_and_scaling(self, ref_epoch_utc: datetime):
        """Point mass scales as 1/r^2; J2 scales as 1/r^4."""
        pole = get_cip_unit_vector(ref_epoch_utc)
        r1 = np.array([7000.0, 0.0, 0.0], dtype=np.float64)
        r2 = np.array([14000.0, 0.0, 0.0], dtype=np.float64)

        a1 = compute_two_body_j2_acceleration(r1, pole)
        a2 = compute_two_body_j2_acceleration(r2, pole)

        # At double the distance, point-mass acceleration drops by factor of ~4
        norm1 = np.linalg.norm(a1)
        norm2 = np.linalg.norm(a2)
        ratio = norm1 / norm2
        assert 3.9 <= ratio <= 4.1

    def test_j2_equatorial_vs_polar_symmetry(self):
        """J2 perturbation direction has opposite sign at equator vs pole."""
        pole = np.array([0.0, 0.0, 1.0], dtype=np.float64)

        # Equator: r = [7000, 0, 0] -> r . pole = 0
        r_eq = np.array([7000.0, 0.0, 0.0], dtype=np.float64)
        a_eq = compute_two_body_j2_acceleration(r_eq, pole)
        a_pm_eq = -(MU_EARTH_KM3_S2 / (7000.0**3)) * r_eq
        j2_pert_eq = a_eq - a_pm_eq

        # Pole: r = [0, 0, 7000] -> r . pole = 7000
        r_pol = np.array([0.0, 0.0, 7000.0], dtype=np.float64)
        a_pol = compute_two_body_j2_acceleration(r_pol, pole)
        a_pm_pol = -(MU_EARTH_KM3_S2 / (7000.0**3)) * r_pol
        j2_pert_pol = a_pol - a_pm_pol

        # At equator, J2 perturbation reinforces inward acceleration (negative radial component)
        # At pole, J2 perturbation opposes inward acceleration (positive radial component)
        # Ratio of polar to equatorial perturbation magnitude is exactly 2.0 (Legendre P2 property)
        assert j2_pert_eq[0] < 0.0
        assert j2_pert_pol[2] > 0.0
        assert abs(abs(j2_pert_pol[2]) / abs(j2_pert_eq[0]) - 2.0) < 1e-12

    def test_pure_two_body_energy_conservation(self):
        """When J2=0, specific orbital energy is rigorously conserved."""
        r0 = np.array([7000.0, 0.0, 0.0])
        v0 = np.array([0.0, math.sqrt(MU_EARTH_KM3_S2 / 7000.0), 0.0])
        y0 = np.concatenate([r0, v0])

        e0 = 0.5 * np.dot(v0, v0) - MU_EARTH_KM3_S2 / np.linalg.norm(r0)

        def rhs_kepler(t, y):
            r = y[:3]
            v = y[3:]
            r_mag = np.linalg.norm(r)
            a = -(MU_EARTH_KM3_S2 / (r_mag**3)) * r
            return np.concatenate([v, a])

        from scipy.integrate import solve_ivp

        sol = solve_ivp(
            rhs_kepler,
            (0.0, 86400.0),
            y0,
            method="DOP853",
            rtol=1e-10,
            atol=1e-12,
        )
        assert sol.status == 0

        # Energy at each step
        energies = 0.5 * np.sum(sol.y[3:, :] ** 2, axis=0) - MU_EARTH_KM3_S2 / np.linalg.norm(
            sol.y[:3, :], axis=0
        )
        rel_diff = np.max(np.abs((energies - e0) / e0))
        assert rel_diff < 1e-8

    def test_j2_analytical_nodal_precession_rate(self):
        """Analytical nodal precession rate matches numerical drift over 24 hours within 1%."""
        pole = np.array([0.0, 0.0, 1.0])
        a = 6800.0
        inc = math.radians(51.6)
        v_mag = math.sqrt(MU_EARTH_KM3_S2 / a)

        r0 = np.array([a, 0.0, 0.0])
        v0 = np.array([0.0, v_mag * math.cos(inc), v_mag * math.sin(inc)])
        y0 = np.concatenate([r0, v0])

        def rhs(t, y):
            r = y[:3]
            v = y[3:]
            acc = compute_two_body_j2_acceleration(r, pole)
            return np.concatenate([v, acc])

        from scipy.integrate import solve_ivp

        sol = solve_ivp(rhs, (0.0, 86400.0), y0, method="DOP853", rtol=1e-9, atol=1e-11)
        assert sol.status == 0

        # Specific angular momentum vector h = r x v
        h0 = np.cross(r0, v0)
        h_end = np.cross(sol.y[:3, -1], sol.y[3:, -1])

        # Node line vector n = z x h
        n0 = np.cross(pole, h0)
        n0 /= np.linalg.norm(n0)
        n_end = np.cross(pole, h_end)
        n_end /= np.linalg.norm(n_end)

        raan0 = math.atan2(n0[1], n0[0])
        raan_end = math.atan2(n_end[1], n_end[0])
        delta_raan_deg = math.degrees(raan_end - raan0)

        # Analytical prediction: dOmega/dt = -1.5 * J2 * R_E^2 * sqrt(mu) / a^3.5 * cos(i)
        analytical_rate_deg_day = (
            math.degrees(
                -1.5
                * J2_EARTH
                * (R_EARTH_EQUATORIAL_KM**2)
                * math.sqrt(MU_EARTH_KM3_S2)
                / (a**3.5)
                * math.cos(inc)
            )
            * 86400.0
        )

        # Discrepancy is under 1% (small periodic oscilations)
        assert abs(delta_raan_deg - analytical_rate_deg_day) / abs(analytical_rate_deg_day) < 0.01


# ============================================================================
# 3. Time Grid & Output Safeguards Tests
# ============================================================================


class TestTimeGridAndSafeguards:
    """Verify sampling time grid construction and memory limit safeguards."""

    def test_exact_integer_multiple_grid(self):
        """When duration is an exact multiple of step, endpoints match exactly."""
        t_eval, count = compute_time_grid(duration_seconds=3600.0, step_seconds=60.0)
        assert count == 61
        assert len(t_eval) == 61
        assert t_eval[0] == 0.0
        assert t_eval[-1] == 3600.0
        assert t_eval[1] == 60.0

    def test_non_multiple_duration_appends_endpoint(self):
        """When duration is not an integer multiple, the final endpoint is appended."""
        t_eval, count = compute_time_grid(duration_seconds=100.0, step_seconds=60.0)
        assert count == 3
        assert np.allclose(t_eval, [0.0, 60.0, 100.0])

    def test_safeguards_allow_default_500_fragment_scenario(self):
        """The default 500-fragment, 24-hour scenario strictly passes safeguards."""
        cfg = NumericalPropagationConfig(
            duration_seconds=86400.0,
            step_seconds=60.0,
            max_points_per_trajectory=DEFAULT_MAX_POINTS_PER_TRAJECTORY,
            max_batch_points=DEFAULT_MAX_BATCH_POINTS,
        )
        _, p_traj = compute_time_grid(cfg.duration_seconds, cfg.step_seconds)
        assert p_traj == 1441
        # 500 * 1441 = 720,500 <= 750,000
        validate_output_safeguards(500, p_traj, cfg)

    def test_safeguards_reject_excessive_trajectory_points(self):
        """Rejects request when single trajectory points exceed limit."""
        cfg = NumericalPropagationConfig(max_points_per_trajectory=1000)
        with pytest.raises(ValueError, match="exceeds max_points_per_trajectory"):
            validate_output_safeguards(1, 1001, cfg)

    def test_safeguards_reject_excessive_batch_points(self):
        """Rejects request when total aggregate batch points exceed limit."""
        cfg = NumericalPropagationConfig(max_batch_points=50000)
        with pytest.raises(ValueError, match="exceeds max_batch_points"):
            validate_output_safeguards(100, 600, cfg)


# ============================================================================
# 4. Input Admissibility Tests
# ============================================================================


class TestInputAdmissibility:
    """Verify physical state validation prior to numerical propagation."""

    def test_valid_state_passes(self):
        is_val, err = validate_initial_fragment_state((7000.0, 0.0, 0.0), (0.0, 7.5, 0.0))
        assert is_val is True
        assert err is None

    def test_non_finite_coordinate_rejected(self):
        is_val, err = validate_initial_fragment_state((float("nan"), 0.0, 0.0), (0.0, 7.5, 0.0))
        assert is_val is False
        assert "Non-finite" in str(err)

        is_val_inf, err_inf = validate_initial_fragment_state(
            (7000.0, 0.0, 0.0), (0.0, float("inf"), 0.0)
        )
        assert is_val_inf is False
        assert "Non-finite" in str(err_inf)

    def test_sub_atmospheric_radius_rejected(self):
        """State below 100 km altitude (r <= 6478.137 km) is immediately rejected."""
        # 6400 km radius is ~22 km above sea level (inside dense atmosphere)
        is_val, err = validate_initial_fragment_state((6400.0, 0.0, 0.0), (0.0, 7.5, 0.0))
        assert is_val is False
        assert "dense atmosphere" in str(err)

    @pytest.mark.parametrize(
        ("v_r", "label"),
        [
            (-2.0, "descending"),
            (0.0, "tangential"),
            (2.0, "ascending"),
        ],
    )
    def test_below_interface_radial_velocity_directions_rejected(
        self, v_r: float, label: str, ref_epoch_utc: datetime
    ):
        """Initial states at r=6400 km are rejected regardless of radial velocity direction."""
        pos = (6400.0, 0.0, 0.0)
        vel = (v_r, 7.5, 0.0)

        # 1. Validation check
        is_val, err = validate_initial_fragment_state(pos, vel)
        assert is_val is False, f"Failed for {label} state"
        assert "dense atmosphere" in str(err)

        # 2. Propagation check
        frag = SyntheticFragmentRecord(
            fragment_id=f"SYNTH-BELOW-{label.upper()}",
            source_parent_id="COMBINED",
            epoch=ref_epoch_utc,
            frame="GCRS",
            position_km=pos,
            velocity_kms=vel,
            mass_kg=2.0,
            delta_v_kms=0.1,
            ejection_vector_kms=(v_r, 0.1, 0.0),
            is_synthetic=True,
        )
        pole = get_cip_unit_vector(ref_epoch_utc)
        cfg = NumericalPropagationConfig(duration_seconds=3600.0, step_seconds=60.0)

        traj = propagate_fragment(frag, cfg, pole)
        assert traj.status == "FAILED"
        assert traj.termination_reason == "INVALID_INITIAL_STATE"
        assert traj.is_empty
        assert "dense atmosphere" in str(traj.error_message)


# ============================================================================
# 5. Propagation & Continuous Event Detection Tests
# ============================================================================


class TestPropagationAndLifecycle:
    """Verify single-fragment and batch propagation, reentry detection, and failure isolation."""

    def test_nominal_fragment_completes_with_success(
        self, nominal_leo_fragment: SyntheticFragmentRecord, ref_epoch_utc: datetime
    ):
        """Nominal LEO orbit completes 24h propagation with SUCCESS and COMPLETED."""
        pole = get_cip_unit_vector(ref_epoch_utc)
        cfg = NumericalPropagationConfig(duration_seconds=3600.0, step_seconds=300.0)

        traj = propagate_fragment(nominal_leo_fragment, cfg, pole)

        assert traj.status == "SUCCESS"
        assert traj.termination_reason == "COMPLETED"
        assert traj.error_message is None
        assert traj.point_count == 13  # 0 to 3600 at 300s step
        assert traj.start_epoch == ref_epoch_utc
        assert traj.reentry_epoch is None

        # Exact initial state preserved as point 0
        p0 = traj.points[0]
        assert np.allclose(p0.position_km, nominal_leo_fragment.position_km)
        assert np.allclose(p0.velocity_kms, nominal_leo_fragment.velocity_kms)

    def test_decaying_fragment_terminates_at_atmospheric_interface(
        self, decaying_leo_fragment: SyntheticFragmentRecord, ref_epoch_utc: datetime
    ):
        """Descending fragment terminates at 100 km boundary with ATMOSPHERIC_INTERFACE."""
        pole = get_cip_unit_vector(ref_epoch_utc)
        cfg = NumericalPropagationConfig(duration_seconds=86400.0, step_seconds=60.0)

        traj = propagate_fragment(decaying_leo_fragment, cfg, pole)

        assert traj.status == "PARTIAL"
        assert traj.termination_reason == "ATMOSPHERIC_INTERFACE"
        assert traj.error_message is None
        assert traj.reentry_epoch is not None
        assert traj.reentry_epoch > ref_epoch_utc
        assert traj.point_count > 1

        # The final trajectory point must equal the exact root-found 100 km altitude boundary
        final_pt = traj.points[-1]
        final_radius = math.sqrt(sum(c * c for c in final_pt.position_km))
        assert abs(final_radius - R_REENTRY_KM) < 1e-3  # within 1 meter of 6478.137 km

    def test_failure_isolation_in_batch(
        self,
        nominal_leo_fragment: SyntheticFragmentRecord,
        decaying_leo_fragment: SyntheticFragmentRecord,
        ref_epoch_utc: datetime,
    ):
        """Batch containing nominal, reentered, and invalid states handles each independently."""
        invalid_fragment = SyntheticFragmentRecord(
            fragment_id="SYNTH-FRAG-INVALID",
            source_parent_id="COMBINED",
            epoch=ref_epoch_utc,
            frame="GCRS",
            position_km=(6200.0, 0.0, 0.0),  # inside Earth!
            velocity_kms=(0.0, 7.5, 0.0),
            mass_kg=1.0,
            delta_v_kms=0.1,
            ejection_vector_kms=(0.0, 0.1, 0.0),
            is_synthetic=True,
        )

        fragments = [nominal_leo_fragment, decaying_leo_fragment, invalid_fragment]
        cfg = NumericalPropagationConfig(duration_seconds=7200.0, step_seconds=60.0)

        batch = propagate_fragment_batch(fragments, cfg)

        assert batch.count == 3
        # Nominal is SUCCESS; decaying is PARTIAL; invalid is FAILED
        assert batch.successful_count == 1
        assert batch.failed_count == 2

        # Detailed scientific counters
        assert batch.summary.completed_count == 1
        assert batch.summary.reentered_count == 1
        assert batch.summary.invalid_state_count == 1
        assert batch.summary.numerical_failure_count == 0

        # Check individual statuses
        t_nom = next(
            t for t in batch.trajectories if t.fragment_id == nominal_leo_fragment.fragment_id
        )
        assert t_nom.status == "SUCCESS"
        assert t_nom.termination_reason == "COMPLETED"

        t_dec = next(
            t for t in batch.trajectories if t.fragment_id == decaying_leo_fragment.fragment_id
        )
        assert t_dec.status == "PARTIAL"
        assert t_dec.termination_reason == "ATMOSPHERIC_INTERFACE"

        t_inv = next(t for t in batch.trajectories if t.fragment_id == invalid_fragment.fragment_id)
        assert t_inv.status == "FAILED"
        assert t_inv.termination_reason == "INVALID_INITIAL_STATE"
        assert t_inv.is_empty

    def test_batch_epoch_consistency_enforced(self, ref_epoch_utc: datetime):
        """Mismatched epochs across fragments in a batch raise ValueError."""
        f1 = SyntheticFragmentRecord(
            fragment_id="SYNTH-1",
            source_parent_id="COMBINED",
            epoch=ref_epoch_utc,
            frame="GCRS",
            position_km=(7000.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
            mass_kg=1.0,
            delta_v_kms=0.1,
            ejection_vector_kms=(0.0, 0.1, 0.0),
            is_synthetic=True,
        )
        f2 = SyntheticFragmentRecord(
            fragment_id="SYNTH-2",
            source_parent_id="COMBINED",
            epoch=datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc),  # 1 day later!
            frame="GCRS",
            position_km=(7000.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
            mass_kg=1.0,
            delta_v_kms=0.1,
            ejection_vector_kms=(0.0, 0.1, 0.0),
            is_synthetic=True,
        )

        with pytest.raises(ValueError, match="Inconsistent fragment epochs in batch"):
            propagate_fragment_batch([f1, f2])

    def test_duplicate_fragment_ids_rejected(self, nominal_leo_fragment: SyntheticFragmentRecord):
        """Duplicate fragment IDs raise ValueError."""
        with pytest.raises(ValueError, match="Duplicate fragment_id encountered in batch"):
            propagate_fragment_batch([nominal_leo_fragment, nominal_leo_fragment])


# ============================================================================
# 6. End-to-End Integration with Day 8 Fragmentation Engine
# ============================================================================


class TestEndToEndFragmentationAndPropagation:
    """Validate full workflow: CollisionScenario -> Fragmentation -> Propagation."""

    def test_full_pipeline_execution(self, ref_epoch_utc: datetime):
        scenario = CollisionScenario(
            collision_epoch=ref_epoch_utc,
            frame="GCRS",
            collision_tolerance_km=0.10,
            parent_a=ParentBodyState(
                object_id="COSMOS-2251",
                mass_kg=900.0,
                position_km=(7100.0, 0.0, 0.0),
                velocity_kms=(0.0, 7.49, 0.0),
            ),
            parent_b=ParentBodyState(
                object_id="IRIDIUM-33",
                mass_kg=560.0,
                position_km=(7100.05, 0.0, 0.0),
                velocity_kms=(0.0, 0.0, 7.49),
            ),
            config=FragmentationConfig(
                fragment_count=20,
                seed=42,
            ),
        )

        # 1. Generate fragments (Day 8)
        frag_res = generate_fragments(scenario)
        assert len(frag_res.fragments) == 20

        # 2. Propagate fragments (Day 9)
        cfg = NumericalPropagationConfig(
            duration_seconds=1800.0,  # 30 minutes
            step_seconds=300.0,  # 5 minutes
        )
        batch = propagate_fragment_batch(frag_res, cfg)

        assert batch.count == 20
        assert len(batch.trajectories) == 20
        assert batch.summary.completed_count + batch.summary.reentered_count == 20
        assert batch.summary.numerical_failure_count == 0

        # 3. Export to standard orbital_core data contract
        batch_resp = batch.to_trajectory_batch_response()
        assert isinstance(batch_resp, TrajectoryBatchResponse)
        assert batch_resp.count == 20
        assert batch_resp.target_frame == "GCRS"
        assert len(batch_resp.trajectories) == 20

        # Check trajectory conversion
        sat_traj = batch.trajectories[0].to_satellite_trajectory()
        assert isinstance(sat_traj, SatelliteTrajectory)
        assert sat_traj.object_id == batch.trajectories[0].fragment_id
        assert sat_traj.frame == "GCRS"
        assert len(sat_traj.points) == len(batch.trajectories[0].points)
        assert sat_traj.termination_reason == batch.trajectories[0].termination_reason
        assert sat_traj.is_synthetic is True
        assert sat_traj.mass_kg == batch.trajectories[0].mass_kg
        assert sat_traj.norad_cat_id is None

    def test_converted_satellite_trajectory_distinguishes_reentry_from_completed(
        self,
        nominal_leo_fragment: SyntheticFragmentRecord,
        decaying_leo_fragment: SyntheticFragmentRecord,
        ref_epoch_utc: datetime,
    ):
        """Converted SatelliteTrajectory preserves termination_reason, mass, and provenance."""
        pole = get_cip_unit_vector(ref_epoch_utc)
        cfg = NumericalPropagationConfig(duration_seconds=86400.0, step_seconds=60.0)

        traj_nominal = propagate_fragment(nominal_leo_fragment, cfg, pole)
        traj_decaying = propagate_fragment(decaying_leo_fragment, cfg, pole)

        sat_nominal = traj_nominal.to_satellite_trajectory()
        sat_decaying = traj_decaying.to_satellite_trajectory()

        assert isinstance(sat_nominal, SatelliteTrajectory)
        assert isinstance(sat_decaying, SatelliteTrajectory)

        # 1. Structured termination_reason is preserved and distinguishes re-entry from completed
        assert sat_nominal.status == "SUCCESS"
        assert sat_nominal.termination_reason == "COMPLETED"
        assert sat_nominal.error_message is None

        assert sat_decaying.status == "PARTIAL"
        assert sat_decaying.termination_reason == "ATMOSPHERIC_INTERFACE"
        assert sat_nominal.termination_reason != sat_decaying.termination_reason

        # 2. Synthetic provenance & mass are strictly preserved
        assert sat_nominal.is_synthetic is True
        assert sat_decaying.is_synthetic is True
        assert sat_nominal.mass_kg == nominal_leo_fragment.mass_kg
        assert sat_decaying.mass_kg == decaying_leo_fragment.mass_kg

        # 3. Not described as SGP4: norad_cat_id is None, frame is GCRS
        assert sat_nominal.norad_cat_id is None
        assert sat_decaying.norad_cat_id is None
        assert sat_nominal.frame == "GCRS"
        assert sat_decaying.frame == "GCRS"
