"""
ZORBIT - Tests for Rendezvous Sampling Guardrails (Milestone 5.3.4.4).

Verifies the two-tier sampling guardrail:
Tier 1: Early validation in BreakupRemediationRequest rejecting propagation step_seconds > 60.0s.
Tier 2: Defense-in-depth trajectory knot interval validation in:
        - prepare_fragment_rendezvous_contract()
        - plan_debris_rendezvous() via _validate_fragment_trajectory()
Also confirms standalone propagation workflows remain unrestricted and nominal/infeasible presets pass.
"""

from datetime import datetime, timedelta, timezone
import math
import numpy as np
import pytest
from pydantic import ValidationError

from simulation.constants import (
    MAX_TARGETING_KNOT_STEP_SECONDS,
    MU_EARTH_KM3_S2,
)
from simulation.integration import (
    plan_breakup_remediation,
    prepare_fragment_rendezvous_contract,
    simulate_breakup_and_propagate,
)
from simulation.rendezvous import plan_debris_rendezvous, validate_trajectory_knot_spacing
from simulation.schemas import (
    BreakupAndPropagateRequest,
    BreakupRemediationRequest,
    BreakupRemediationResponse,
    CollisionScenario,
    FragmentationConfig,
    FragmentTrajectory,
    NumericalPropagationConfig,
    ParentBodyState,
    RendezvousConfig,
    RendezvousContract,
    SyntheticFragmentRecord,
    TrajectoryPoint,
)


@pytest.fixture
def base_scenario() -> CollisionScenario:
    """Fixture providing a physically valid near-circular LEO collision scenario."""
    epoch = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7000.0)
    parent_a = ParentBodyState(
        object_id="SAT-01",
        mass_kg=500.0,
        position_km=(7000.0, 0.0, 0.0),
        velocity_kms=(0.0, v_circ, 0.0),
    )
    parent_b = ParentBodyState(
        object_id="DEB-01",
        mass_kg=200.0,
        position_km=(7000.0, 0.02, 0.0),
        velocity_kms=(0.0, v_circ + 0.005, 0.0),
    )
    cfg = FragmentationConfig(
        fragment_count=10,
        min_fragment_mass_kg=1.0,
        max_fragment_mass_kg=25.0,
        max_delta_v_kms=0.05,
        v_median_kms=0.01,
        seed=42,
    )
    return CollisionScenario(
        collision_epoch=epoch,
        parent_a=parent_a,
        parent_b=parent_b,
        config=cfg,
    )


@pytest.fixture
def chaser_state(base_scenario: CollisionScenario):
    """Fixture providing a valid near-circular LEO chaser state."""
    epoch = base_scenario.collision_epoch
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7000.0)
    return {
        "chaser_id": "CHASER-ADR-01",
        "chaser_epoch_utc": epoch,
        "chaser_gcrs_position_km": [7000.0, 0.1, 0.0],
        "chaser_gcrs_velocity_kms": [0.0, v_circ, 0.0],
    }


# ============================================================================
# Tier 1 Tests: BreakupRemediationRequest Validation
# ============================================================================


def test_remediation_request_rejects_coarse_sampling_120s(base_scenario, chaser_state):
    """Test 1: Breakup remediation request with 120-second sampling returns validation failure."""
    with pytest.raises(ValidationError) as exc_info:
        BreakupRemediationRequest(
            scenario=base_scenario,
            **chaser_state,
            propagation_config=NumericalPropagationConfig(
                duration_seconds=3600.0,
                step_seconds=120.0,
            ),
            rendezvous_config=RendezvousConfig(transfer_time_s=1800.0),
        )

    err_msg = str(exc_info.value)
    assert "exceeds the recommended maximum knot step (60.0 s)" in err_msg
    assert "conservative engineering guardrail" in err_msg
    assert "step_seconds <= 60.0 s" in err_msg


@pytest.mark.parametrize("step_sec", [60.0, 30.0, 10.0])
def test_remediation_requests_with_compliant_sampling_pass(base_scenario, chaser_state, step_sec):
    """Test 2: Remediation requests with 60, 30, and 10-second sampling pass the guardrail."""
    req = BreakupRemediationRequest(
        scenario=base_scenario,
        **chaser_state,
        propagation_config=NumericalPropagationConfig(
            duration_seconds=3600.0,
            step_seconds=step_sec,
        ),
        rendezvous_config=RendezvousConfig(transfer_time_s=1800.0),
    )
    assert req.propagation_config.step_seconds == step_sec


# ============================================================================
# Tier 2 Tests: Trajectory Knot Validation
# ============================================================================


def test_direct_contract_construction_rejects_90s_knot_spacing():
    """Test 3: Direct contract construction with 90-second knot spacing is rejected."""
    epoch_0 = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7000.0)

    # 3 points spaced by 90.0 seconds
    pts = [
        TrajectoryPoint(
            epoch=epoch_0,
            position_km=(7000.0, 0.0, 0.0),
            velocity_kms=(0.0, v_circ, 0.0),
        ),
        TrajectoryPoint(
            epoch=epoch_0 + timedelta(seconds=90.0),
            position_km=(7000.0, 50.0, 0.0),
            velocity_kms=(0.0, v_circ, 0.0),
        ),
        TrajectoryPoint(
            epoch=epoch_0 + timedelta(seconds=180.0),
            position_km=(7000.0, 100.0, 0.0),
            velocity_kms=(0.0, v_circ, 0.0),
        ),
    ]
    traj = FragmentTrajectory(
        fragment_id="SYNTH-FRAG-TEST",
        frame="GCRS",
        position_unit="km",
        velocity_unit="km/s",
        points=pts,
        status="SUCCESS",
        termination_reason="COMPLETED",
    )
    frag = SyntheticFragmentRecord(
        fragment_id="SYNTH-FRAG-TEST",
        source_parent_id="COMBINED",
        epoch=epoch_0,
        frame="GCRS",
        position_km=(7000.0, 0.0, 0.0),
        velocity_kms=(0.0, v_circ, 0.0),
        mass_kg=10.0,
        delta_v_kms=0.01,
        ejection_vector_kms=(0.0, 0.01, 0.0),
        is_synthetic=True,
    )

    with pytest.raises(ValueError) as exc_info:
        prepare_fragment_rendezvous_contract(
            fragment=frag,
            trajectory=traj,
            chaser_id="CHASER-01",
            chaser_epoch_utc=epoch_0,
            chaser_gcrs_position_km=[7000.0, 0.1, 0.0],
            chaser_gcrs_velocity_kms=[0.0, v_circ, 0.0],
            target_epoch_utc=epoch_0 + timedelta(seconds=45.0),
        )

    err_msg = str(exc_info.value)
    assert "Trajectory maximum knot interval (90.0 s) exceeds permitted maximum (60.0 s)" in err_msg
    assert "conservative engineering guardrail" in err_msg


def test_direct_solver_invocation_rejects_excessive_knot_spacing():
    """Test 4: Direct solver invocation with excessive knot spacing is rejected."""
    epoch_0 = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7000.0)

    # 3 points spaced by 90.0 seconds
    pts = [
        TrajectoryPoint(
            epoch=epoch_0,
            position_km=(7000.0, 0.0, 0.0),
            velocity_kms=(0.0, v_circ, 0.0),
        ),
        TrajectoryPoint(
            epoch=epoch_0 + timedelta(seconds=90.0),
            position_km=(7000.0, 50.0, 0.0),
            velocity_kms=(0.0, v_circ, 0.0),
        ),
        TrajectoryPoint(
            epoch=epoch_0 + timedelta(seconds=180.0),
            position_km=(7000.0, 100.0, 0.0),
            velocity_kms=(0.0, v_circ, 0.0),
        ),
    ]
    traj = FragmentTrajectory(
        fragment_id="SYNTH-FRAG-TEST",
        frame="GCRS",
        position_unit="km",
        velocity_unit="km/s",
        points=pts,
        status="SUCCESS",
        termination_reason="COMPLETED",
    )
    contract = RendezvousContract(
        target_id="SYNTH-FRAG-TEST",
        chaser_id="CHASER-01",
        target_is_synthetic=True,
        target_epoch_utc=epoch_0 + timedelta(seconds=5.0),
        chaser_epoch_utc=epoch_0,
        target_gcrs_position_km=[7000.0, 0.0, 0.0],
        target_gcrs_velocity_kms=[0.0, v_circ, 0.0],
        chaser_gcrs_position_km=[7000.0, 0.1, 0.0],
        chaser_gcrs_velocity_kms=[0.0, v_circ, 0.0],
    )

    with pytest.raises(ValueError) as exc_info:
        plan_debris_rendezvous(
            contract=contract,
            config=RendezvousConfig(transfer_time_s=600.0),
            target_trajectory=traj,
        )

    err_msg = str(exc_info.value)
    assert "Trajectory maximum knot interval (90.0 s) exceeds permitted maximum (60.0 s)" in err_msg


# ============================================================================
# General Propagation & Presets Tests
# ============================================================================


def test_standalone_breakup_and_propagate_unrestricted_300s(base_scenario):
    """Test 5: Standalone breakup-and-propagate with 300-second sampling remains unrestricted."""
    req = BreakupAndPropagateRequest(
        scenario=base_scenario,
        propagation_config=NumericalPropagationConfig(
            duration_seconds=600.0,
            step_seconds=300.0,
        ),
    )
    assert req.propagation_config.step_seconds == 300.0

    frag_result, batch = simulate_breakup_and_propagate(
        scenario=req.scenario,
        propagation_config=req.propagation_config,
    )
    assert len(frag_result.fragments) == 10
    assert batch.summary.step_seconds == 300.0
    assert batch.summary.completed_count == 10


def test_nominal_remediation_preset_continues_to_pass(base_scenario, chaser_state):
    """Test 6: Existing nominal remediation preset (30s step) continues to pass end-to-end."""
    req = BreakupRemediationRequest(
        scenario=base_scenario,
        **chaser_state,
        propagation_config=NumericalPropagationConfig(
            duration_seconds=3600.0,
            step_seconds=30.0,
        ),
        rendezvous_config=RendezvousConfig(
            transfer_time_s=1800.0,
            delta_v_budget_max_ms=100.0,
        ),
    )
    res = plan_breakup_remediation(req)
    assert isinstance(res, BreakupRemediationResponse)
    assert res.rendezvous.is_mathematically_solvable is True
    assert res.rendezvous.is_feasible is True
    assert res.rendezvous.total_delta_v_ms <= 100.0


def test_infeasible_budget_preset_returns_structured_infeasible_result(base_scenario, chaser_state):
    """Test 7: Infeasible-budget preset returns structured result rather than validation error."""
    req = BreakupRemediationRequest(
        scenario=base_scenario,
        **chaser_state,
        propagation_config=NumericalPropagationConfig(
            duration_seconds=3600.0,
            step_seconds=30.0,
        ),
        rendezvous_config=RendezvousConfig(
            transfer_time_s=1800.0,
            delta_v_budget_max_ms=0.01,  # 0.01 m/s (insufficient for 1800s transfer)
        ),
    )
    res = plan_breakup_remediation(req)
    assert isinstance(res, BreakupRemediationResponse)
    assert res.rendezvous.is_mathematically_solvable is True
    assert res.rendezvous.is_budget_feasible is False
    assert res.rendezvous.is_feasible is False

# ============================================================================
# Edge Case & Boundary Tests (Milestone 5.3.4.4 Code Review)
# ============================================================================


def test_remediation_request_boundary_conditions(base_scenario, chaser_state):
    """Test 8: Exact 60.0s boundary passes Tier 1, while 60.1s strictly fails."""
    # Exactly 60.0 seconds must pass
    req_60 = BreakupRemediationRequest(
        scenario=base_scenario,
        **chaser_state,
        propagation_config=NumericalPropagationConfig(
            duration_seconds=3600.0,
            step_seconds=60.0,
        ),
        rendezvous_config=RendezvousConfig(transfer_time_s=1800.0),
    )
    assert req_60.propagation_config.step_seconds == 60.0

    # 60.1 seconds must fail
    with pytest.raises(ValidationError) as exc_info:
        BreakupRemediationRequest(
            scenario=base_scenario,
            **chaser_state,
            propagation_config=NumericalPropagationConfig(
                duration_seconds=3600.0,
                step_seconds=60.1,
            ),
            rendezvous_config=RendezvousConfig(transfer_time_s=1800.0),
        )
    assert "exceeds the recommended maximum knot step (60.0 s)" in str(exc_info.value)


def test_validate_trajectory_knot_spacing_exact_60s_boundary():
    """Test 9: Trajectory with exact 60.0s knot spacing passes Tier 2 validation."""
    epoch_0 = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    pts = [
        TrajectoryPoint(
            epoch=epoch_0,
            position_km=(7000.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
        ),
        TrajectoryPoint(
            epoch=epoch_0 + timedelta(seconds=60.0),
            position_km=(7000.0, 450.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
        ),
    ]
    traj = FragmentTrajectory(
        fragment_id="SYNTH-TEST-60",
        frame="GCRS",
        position_unit="km",
        velocity_unit="km/s",
        points=pts,
        status="SUCCESS",
        termination_reason="COMPLETED",
    )
    max_dt = validate_trajectory_knot_spacing(traj, max_permitted_knot_step_s=60.0)
    assert max_dt == 60.0


def test_validate_trajectory_knot_spacing_60_point_1s_boundary_fails():
    """Test 10: Trajectory with 60.1s knot spacing strictly fails Tier 2 validation."""
    epoch_0 = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    pts = [
        TrajectoryPoint(
            epoch=epoch_0,
            position_km=(7000.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
        ),
        TrajectoryPoint(
            epoch=epoch_0 + timedelta(seconds=60.1),
            position_km=(7000.0, 450.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
        ),
    ]
    traj = FragmentTrajectory(
        fragment_id="SYNTH-TEST-60-1",
        frame="GCRS",
        position_unit="km",
        velocity_unit="km/s",
        points=pts,
        status="SUCCESS",
        termination_reason="COMPLETED",
    )
    with pytest.raises(ValueError) as exc_info:
        validate_trajectory_knot_spacing(traj, max_permitted_knot_step_s=60.0)

    err = str(exc_info.value)
    assert "Trajectory maximum knot interval (60.1 s) exceeds permitted maximum (60.0 s)" in err
    assert "Coarse propagation sampling induces O(h^4) cubic Hermite interpolation error" in err


def test_validate_trajectory_knot_spacing_non_uniform_intervals():
    """Test 11: Non-uniform knot spacing triggers guardrail if any single interval exceeds 60s."""
    epoch_0 = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    # Intervals: 20s, 30s, 65s (exceeds), 10s -> max interval is 65s
    pts = [
        TrajectoryPoint(epoch=epoch_0, position_km=(7000.0, 0.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
        TrajectoryPoint(epoch=epoch_0 + timedelta(seconds=20.0), position_km=(7000.0, 150.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
        TrajectoryPoint(epoch=epoch_0 + timedelta(seconds=50.0), position_km=(7000.0, 375.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
        TrajectoryPoint(epoch=epoch_0 + timedelta(seconds=115.0), position_km=(7000.0, 862.5, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
        TrajectoryPoint(epoch=epoch_0 + timedelta(seconds=125.0), position_km=(7000.0, 937.5, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
    ]
    traj = FragmentTrajectory(
        fragment_id="SYNTH-TEST-NONUNIFORM",
        frame="GCRS",
        position_unit="km",
        velocity_unit="km/s",
        points=pts,
        status="SUCCESS",
        termination_reason="COMPLETED",
    )
    with pytest.raises(ValueError) as exc_info:
        validate_trajectory_knot_spacing(traj, max_permitted_knot_step_s=60.0)

    assert "Trajectory maximum knot interval (65.0 s) exceeds permitted maximum (60.0 s)" in str(exc_info.value)


def test_validate_trajectory_knot_spacing_timezone_normalization():
    """Test 12: Mixed timezones (UTC vs non-UTC offset vs naive) are correctly normalized and compared."""
    from datetime import timezone as dt_tz
    tz_ist = dt_tz(timedelta(hours=5, minutes=30))  # UTC+5:30
    
    # 12:00:00 UTC == 17:30:00 IST
    t0_utc = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    t1_ist = datetime(2026, 11, 4, 17, 30, 45, tzinfo=tz_ist)  # 45 seconds later in UTC
    
    pts = [
        TrajectoryPoint(epoch=t0_utc, position_km=(7000.0, 0.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
        TrajectoryPoint(epoch=t1_ist, position_km=(7000.0, 337.5, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
    ]
    traj = FragmentTrajectory(
        fragment_id="SYNTH-TEST-TZ",
        frame="GCRS",
        position_unit="km",
        velocity_unit="km/s",
        points=pts,
        status="SUCCESS",
        termination_reason="COMPLETED",
    )
    max_dt = validate_trajectory_knot_spacing(traj, max_permitted_knot_step_s=60.0)
    assert max_dt == 45.0

def test_validate_trajectory_knot_spacing_rejects_duplicate_timestamps():
    """Test 13: Trajectory with duplicate timestamps strictly raises ValueError."""
    epoch_0 = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    pts = [
        TrajectoryPoint(epoch=epoch_0, position_km=(7000.0, 0.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
        TrajectoryPoint(epoch=epoch_0, position_km=(7000.0, 10.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
    ]
    traj = FragmentTrajectory(
        fragment_id="SYNTH-TEST-DUP",
        frame="GCRS",
        position_unit="km",
        velocity_unit="km/s",
        points=pts,
        status="SUCCESS",
        termination_reason="COMPLETED",
    )
    with pytest.raises(ValueError) as exc_info:
        validate_trajectory_knot_spacing(traj)
    assert "duplicate timestamp" in str(exc_info.value)
    assert "strictly positive" in str(exc_info.value)


def test_validate_trajectory_knot_spacing_rejects_inverted_timestamps():
    """Test 14: Trajectory with inverted/non-monotonic timestamps strictly raises ValueError."""
    epoch_0 = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    pts = [
        TrajectoryPoint(epoch=epoch_0 + timedelta(seconds=30.0), position_km=(7000.0, 0.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
        TrajectoryPoint(epoch=epoch_0, position_km=(7000.0, 10.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
    ]
    traj = FragmentTrajectory(
        fragment_id="SYNTH-TEST-INV",
        frame="GCRS",
        position_unit="km",
        velocity_unit="km/s",
        points=pts,
        status="SUCCESS",
        termination_reason="COMPLETED",
    )
    with pytest.raises(ValueError) as exc_info:
        validate_trajectory_knot_spacing(traj)
    assert "non-monotonic" in str(exc_info.value)
    assert "non-positive interval" in str(exc_info.value)


def test_prepare_contract_rejects_duplicate_and_inverted_timestamps():
    """Test 15: prepare_fragment_rendezvous_contract() rejects duplicate and inverted timestamps."""
    epoch_0 = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    frag = SyntheticFragmentRecord(
        fragment_id="SYNTH-FRAG-ORDER",
        source_parent_id="COMBINED",
        epoch=epoch_0,
        frame="GCRS",
        position_km=(7000.0, 0.0, 0.0),
        velocity_kms=(0.0, 7.5, 0.0),
        mass_kg=10.0,
        delta_v_kms=0.01,
        ejection_vector_kms=(0.0, 0.01, 0.0),
        is_synthetic=True,
    )

    # 1. Duplicate timestamps
    traj_dup = FragmentTrajectory(
        fragment_id="SYNTH-FRAG-ORDER",
        frame="GCRS",
        position_unit="km",
        velocity_unit="km/s",
        points=[
            TrajectoryPoint(epoch=epoch_0, position_km=(7000.0, 0.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
            TrajectoryPoint(epoch=epoch_0, position_km=(7000.0, 10.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
        ],
        status="SUCCESS",
        termination_reason="COMPLETED",
    )
    with pytest.raises(ValueError, match="duplicate timestamp"):
        prepare_fragment_rendezvous_contract(
            fragment=frag,
            trajectory=traj_dup,
            chaser_id="CHASER-01",
            chaser_epoch_utc=epoch_0,
            chaser_gcrs_position_km=[7000.0, 0.1, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            target_epoch_utc=epoch_0,
        )

    # 2. Inverted timestamps (interior non-monotonic step within valid start/end span)
    traj_inv = FragmentTrajectory(
        fragment_id="SYNTH-FRAG-ORDER",
        frame="GCRS",
        position_unit="km",
        velocity_unit="km/s",
        points=[
            TrajectoryPoint(epoch=epoch_0, position_km=(7000.0, 0.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
            TrajectoryPoint(epoch=epoch_0 + timedelta(seconds=30.0), position_km=(7000.0, 10.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
            TrajectoryPoint(epoch=epoch_0 + timedelta(seconds=15.0), position_km=(7000.0, 20.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
            TrajectoryPoint(epoch=epoch_0 + timedelta(seconds=50.0), position_km=(7000.0, 30.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)),
        ],
        status="SUCCESS",
        termination_reason="COMPLETED",
    )
    with pytest.raises(ValueError, match="non-monotonic"):
        prepare_fragment_rendezvous_contract(
            fragment=frag,
            trajectory=traj_inv,
            chaser_id="CHASER-01",
            chaser_epoch_utc=epoch_0,
            chaser_gcrs_position_km=[7000.0, 0.1, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
            target_epoch_utc=epoch_0 + timedelta(seconds=20.0),
        )


# ============================================================================
# Phase 6D.1: Perigee Boundary Consistency Unit Tests
# ============================================================================

def test_cw_solver_perigee_boundary_three_way():
    """Verify solve_two_impulse_cw handles below, exactly at, and above the 6478.137 km perigee threshold."""
    from simulation.rendezvous import solve_two_impulse_cw
    # 1. Below threshold: rp = 6478.136 km -> rejected with informative ValueError
    rp_below = 6478.136
    v_circ_below = math.sqrt(MU_EARTH_KM3_S2 / rp_below)
    cfg = RendezvousConfig(transfer_time_s=120.0, delta_v_budget_max_ms=25.0)
    with pytest.raises(ValueError, match="violates atmospheric entry boundary"):
        solve_two_impulse_cw(
            r_chief_gcrs=np.array([rp_below, 0.0, 0.0]),
            v_chief_gcrs=np.array([0.0, v_circ_below, 0.0]),
            rho_0=np.array([0.0, 0.08, 0.0]),
            rho_dot_0_minus=np.array([0.0, 0.0, 0.0]),
            rho_f=np.array([0.0, -0.05, 0.0]),
            rho_dot_f_plus=np.array([0.0, 0.0, 0.0]),
            tau=120.0,
            config=cfg,
        )

    # 2. Exactly at threshold: rp = 6478.137 km -> accepted (not inside atmosphere)
    rp_exact = 6478.137
    v_circ_exact = math.sqrt(MU_EARTH_KM3_S2 / rp_exact)
    res_exact = solve_two_impulse_cw(
        r_chief_gcrs=np.array([rp_exact, 0.0, 0.0]),
        v_chief_gcrs=np.array([0.0, v_circ_exact, 0.0]),
        rho_0=np.array([0.0, 0.08, 0.0]),
        rho_dot_0_minus=np.array([0.0, 0.0, 0.0]),
        rho_f=np.array([0.0, -0.05, 0.0]),
        rho_dot_f_plus=np.array([0.0, 0.0, 0.0]),
        tau=120.0,
        config=cfg,
    )
    assert res_exact.is_mathematically_solvable is True
    assert res_exact.is_feasible is True

    # 3. Safely above threshold: rp = 6500.0 km -> accepted
    rp_above = 6500.0
    v_circ_above = math.sqrt(MU_EARTH_KM3_S2 / rp_above)
    res_above = solve_two_impulse_cw(
        r_chief_gcrs=np.array([rp_above, 0.0, 0.0]),
        v_chief_gcrs=np.array([0.0, v_circ_above, 0.0]),
        rho_0=np.array([0.0, 0.08, 0.0]),
        rho_dot_0_minus=np.array([0.0, 0.0, 0.0]),
        rho_f=np.array([0.0, -0.05, 0.0]),
        rho_dot_f_plus=np.array([0.0, 0.0, 0.0]),
        tau=120.0,
        config=cfg,
    )
    assert res_above.is_mathematically_solvable is True
    assert res_above.is_feasible is True


def test_remediation_request_chaser_perigee_boundary_three_way(base_scenario: CollisionScenario):
    """Verify BreakupRemediationRequest chaser perigee validation across below, at, and above 6478.137 km."""
    epoch = base_scenario.collision_epoch

    # 1. Below threshold: rp = 6478.136 km -> rejected with ValueError
    rp_below = 6478.136
    v_circ_below = math.sqrt(MU_EARTH_KM3_S2 / rp_below)
    with pytest.raises(ValueError, match="violates atmospheric entry boundary"):
        BreakupRemediationRequest(
            scenario=base_scenario,
            chaser_id="CHASER-01",
            chaser_epoch_utc=epoch,
            chaser_gcrs_position_km=[rp_below, 0.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, v_circ_below, 0.0],
            target_epoch_utc=epoch,
            rendezvous_config=RendezvousConfig(transfer_time_s=60.0), propagation_config=NumericalPropagationConfig(duration_seconds=120.0, step_seconds=10.0),
        )

    # 2. Exactly at threshold: rp = 6478.137 km -> accepted
    rp_exact = 6478.137
    v_circ_exact = math.sqrt(MU_EARTH_KM3_S2 / rp_exact)
    req_exact = BreakupRemediationRequest(
        scenario=base_scenario,
        chaser_id="CHASER-01",
        chaser_epoch_utc=epoch,
        chaser_gcrs_position_km=[rp_exact, 0.0, 0.0],
        chaser_gcrs_velocity_kms=[0.0, v_circ_exact, 0.0],
        target_epoch_utc=epoch,
        rendezvous_config=RendezvousConfig(transfer_time_s=60.0), propagation_config=NumericalPropagationConfig(duration_seconds=120.0, step_seconds=10.0),
    )
    assert req_exact.chaser_id == "CHASER-01"

    # 3. Safely above threshold: rp = 6500.0 km -> accepted
    rp_above = 6500.0
    v_circ_above = math.sqrt(MU_EARTH_KM3_S2 / rp_above)
    req_above = BreakupRemediationRequest(
        scenario=base_scenario,
        chaser_id="CHASER-01",
        chaser_epoch_utc=epoch,
        chaser_gcrs_position_km=[rp_above, 0.0, 0.0],
        chaser_gcrs_velocity_kms=[0.0, v_circ_above, 0.0],
        target_epoch_utc=epoch,
        rendezvous_config=RendezvousConfig(transfer_time_s=60.0), propagation_config=NumericalPropagationConfig(duration_seconds=120.0, step_seconds=10.0),
    )
    assert req_above.chaser_id == "CHASER-01"


def test_fragment_selection_perigee_boundary_three_way():
    """Verify select_highest_mass_cw_compliant_fragment filters below 6478.137 km and accepts at/above."""
    from simulation.integration import select_highest_mass_cw_compliant_fragment
    from simulation.schemas import FragmentTrajectoryBatch, FragmentPropagationSummary
    epoch = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)

    def make_frag_and_traj(frag_id: str, radius_km: float, mass: float):
        v = math.sqrt(MU_EARTH_KM3_S2 / radius_km)
        frag = SyntheticFragmentRecord(
            fragment_id=frag_id,
            source_parent_id="COMBINED",
            epoch=epoch,
            frame="GCRS",
            position_km=(radius_km, 0.0, 0.0),
            velocity_kms=(0.0, v, 0.0),
            mass_kg=mass,
            delta_v_kms=0.001,
            ejection_vector_kms=(0.0, 0.001, 0.0),
            is_synthetic=True,
        )
        traj = FragmentTrajectory(
            fragment_id=frag_id,
            frame="GCRS",
            position_unit="km",
            velocity_unit="km/s",
            points=[
                TrajectoryPoint(epoch=epoch, position_km=(radius_km, 0.0, 0.0), velocity_kms=(0.0, v, 0.0)),
                TrajectoryPoint(epoch=epoch + timedelta(seconds=120.0), position_km=(radius_km, 10.0, 0.0), velocity_kms=(0.0, v, 0.0)),
            ],
            status="SUCCESS",
            termination_reason="COMPLETED",
        )
        return frag, traj

    f_below, t_below = make_frag_and_traj("FRAG-BELOW", 6478.136, 100.0)
    f_exact, t_exact = make_frag_and_traj("FRAG-EXACT", 6478.137, 50.0)

    batch_only_below = FragmentTrajectoryBatch(
        scenario_epoch=epoch, count=1, successful_count=1, failed_count=0,
        summary=FragmentPropagationSummary(total_fragments=1, completed_count=1, reentered_count=0, numerical_failure_count=0, invalid_state_count=0, duration_seconds=120.0, step_seconds=120.0, execution_wall_time_seconds=0.01),
        trajectories=[t_below]
    )
    with pytest.raises(ValueError, match="No CW-compliant"):
        select_highest_mass_cw_compliant_fragment(
            fragments=[f_below],
            trajectory_batch=batch_only_below,
            max_eccentricity=0.005,
            min_perigee_km=6478.137,
            t0=epoch,
            t_target=epoch + timedelta(seconds=120.0),
        )

    batch_exact = FragmentTrajectoryBatch(
        scenario_epoch=epoch, count=1, successful_count=1, failed_count=0,
        summary=FragmentPropagationSummary(total_fragments=1, completed_count=1, reentered_count=0, numerical_failure_count=0, invalid_state_count=0, duration_seconds=120.0, step_seconds=120.0, execution_wall_time_seconds=0.01),
        trajectories=[t_exact]
    )
    sel_frag, _ = select_highest_mass_cw_compliant_fragment(
        fragments=[f_exact],
        trajectory_batch=batch_exact,
        max_eccentricity=0.005,
        min_perigee_km=6478.137,
        t0=epoch,
        t_target=epoch + timedelta(seconds=120.0),
    )
    assert sel_frag.fragment_id == "FRAG-EXACT"


def test_cw_solver_post_burn_1_departure_velocity_equivalence():
    """Verify that backend post-Burn-1 velocity rho_dot_0_plus equals rho_dot_0_minus + delta_v1,
    matches the shared canonical fixture (data/fixtures/cw_rendezvous_canonical_scenario.json),
    and strictly satisfies independent closed-form 2x2/1x1 CW STM inversion to machine precision.
    """
    import json
    from pathlib import Path
    from simulation.rendezvous import gcrs_to_hill, solve_two_impulse_cw
    from simulation.schemas import TargetingMode

    # 1. Load canonical scenario fixture shared across frontend & backend test suites
    fixture_path = Path(__file__).resolve().parents[4] / "data" / "fixtures" / "cw_rendezvous_canonical_scenario.json"
    if not fixture_path.exists():
        fixture_path = Path("data/fixtures/cw_rendezvous_canonical_scenario.json")
    with open(fixture_path, "r", encoding="utf-8") as f:
        fixture = json.load(f)

    rc = np.array(fixture["chief_orbit"]["chief_gcrs_position_km"], dtype=np.float64)
    vc = np.array(fixture["chief_orbit"]["chief_gcrs_velocity_kms"], dtype=np.float64)
    r_chaser = np.array(fixture["chaser_state"]["chaser_gcrs_position_km"], dtype=np.float64)
    v_chaser = np.array(fixture["chaser_state"]["chaser_gcrs_velocity_kms"], dtype=np.float64)

    # Transform to Hill frame and verify against fixture
    rho_0, v0_minus = gcrs_to_hill(rc, vc, r_chaser, v_chaser)
    expected_rho_0_km = np.array(fixture["relative_states_hill_frame"]["initial_position_km"], dtype=np.float64)
    expected_v0_minus_kms = np.array(fixture["relative_states_hill_frame"]["initial_velocity_kms"], dtype=np.float64)
    np.testing.assert_allclose(rho_0, expected_rho_0_km, atol=1e-12)
    np.testing.assert_allclose(v0_minus, expected_v0_minus_kms, atol=1e-12)

    rho_f = np.array(fixture["relative_states_hill_frame"]["terminal_position_km"], dtype=np.float64)
    vf_plus = np.array(fixture["relative_states_hill_frame"]["terminal_velocity_kms"], dtype=np.float64)
    tau = float(fixture["rendezvous_parameters"]["transfer_time_s"])
    cfg = RendezvousConfig(
        targeting_mode=TargetingMode(fixture["rendezvous_parameters"]["targeting_mode"]),
        standoff_distance_m=float(fixture["rendezvous_parameters"]["standoff_distance_m"]),
        transfer_time_s=tau,
    )

    # 2. Run actual backend CW solver
    res = solve_two_impulse_cw(rc, vc, rho_0, v0_minus, rho_f, vf_plus, tau, cfg)
    assert res.is_mathematically_solvable is True
    assert res.is_feasible is True

    # 3. Backend post-burn-1 velocity in km/s and m/s: rho_dot_0_plus = v0_minus + delta_v1
    delta_v1_kms = np.array(res.burn_1_dv_cw_ms) / 1000.0
    rho_dot_0_plus_kms = v0_minus + delta_v1_kms
    rho_dot_0_plus_ms = rho_dot_0_plus_kms * 1000.0

    # Compare solver output against canonical fixture reference values
    ref_hill_vel_ms = np.array(fixture["solver_reference_solution"]["post_burn_1_velocity_hill_ms"], dtype=np.float64)
    np.testing.assert_allclose(rho_dot_0_plus_ms, ref_hill_vel_ms, atol=1e-12)
    np.testing.assert_allclose(res.burn_1_dv_cw_ms, fixture["solver_reference_solution"]["burn_1_dv_cw_ms"], atol=1e-12)

    # 4. Preserve independent closed-form 2x2 in-plane and 1D out-of-plane STM mathematical verification
    rc_mag = float(np.linalg.norm(rc))
    vc_sq = float(np.dot(vc, vc))
    energy = 0.5 * vc_sq - MU_EARTH_KM3_S2 / rc_mag
    a_km = -MU_EARTH_KM3_S2 / (2.0 * energy)
    n = math.sqrt(MU_EARTH_KM3_S2 / (a_km**3))
    assert abs(n - fixture["chief_orbit"]["mean_motion_rad_s"]) < 1e-12

    R0, I0, C0 = rho_0
    Rf, If, Cf = rho_f
    sf = math.sin(n * tau)
    cf = math.cos(n * tau)
    af = n * tau

    bR = Rf - (4.0 - 3.0 * cf) * R0
    bI = If - 6.0 * (sf - af) * R0 - I0

    M00 = sf / n
    M01 = (2.0 * (1.0 - cf)) / n
    M10 = (2.0 * (cf - 1.0)) / n
    M11 = (4.0 * sf - 3.0 * af) / n

    det = M00 * M11 - M01 * M10
    vR0 = (M11 * bR - M01 * bI) / det
    vI0 = (-M10 * bR + M00 * bI) / det
    vC0 = (Cf - cf * C0) / (sf / n)

    closed_form_rho_dot_0_plus_kms = np.array([vR0, vI0, vC0])

    # Assert machine precision equivalence (< 1e-12 km/s = 1e-9 m/s)
    max_err = float(np.max(np.abs(rho_dot_0_plus_kms - closed_form_rho_dot_0_plus_kms)))
    assert max_err < 1e-12, f"Discrepancy between solver and closed-form inversion: {max_err}"
