"""
ZORBIT - Simulation Integration Unit Tests.

Validates end-to-end integration workflows between Day 8 synthetic collision
fragmentation, Day 9 Cowell/DOP853 numerical propagation, and Day 10
Clohessy-Wiltshire two-impulse rendezvous planning.
"""

from datetime import datetime, timedelta, timezone
import math
import numpy as np
import pytest
from pydantic import ValidationError

from simulation.constants import (
    MU_EARTH_KM3_S2,
    R_REENTRY_KM,
)
from simulation.fragmentation import generate_fragments
from simulation.integration import (
    plan_breakup_remediation,
    prepare_fragment_rendezvous_contract,
    select_highest_mass_cw_compliant_fragment,
    simulate_breakup_and_propagate,
)
from simulation.propagation import get_cip_unit_vector, propagate_fragment
from simulation.rendezvous import plan_debris_rendezvous
from simulation.schemas import (
    BreakupRemediationRequest,
    BreakupRemediationResponse,
    CollisionScenario,
    FragmentationConfig,
    FragmentationResult,
    FragmentPropagationSummary,
    FragmentTrajectory,
    FragmentTrajectoryBatch,
    NumericalPropagationConfig,
    ParentBodyState,
    RendezvousConfig,
    RendezvousContract,
    RendezvousResult,
    SyntheticFragmentRecord,
    TargetingMode,
    TrajectoryPoint,
    TrajectoryStatus,
    TerminationReason,
)


# ============================================================================
# Test Fixtures and Helpers
# ============================================================================


@pytest.fixture
def base_epoch() -> datetime:
    return datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def controlled_collision_scenario(base_epoch: datetime) -> CollisionScenario:
    """Co-orbital proximity collision between two 500 kg satellites at 7200 km."""
    r0 = 7200.0
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / r0)

    parent_a = ParentBodyState(
        object_id="SAT-ALPHA",
        object_name="Satellite Alpha",
        mass_kg=500.0,
        position_km=(r0, 0.0, 0.0),
        velocity_kms=(0.0, v_circ, 0.001),
    )
    parent_b = ParentBodyState(
        object_id="SAT-BETA",
        object_name="Satellite Beta",
        mass_kg=500.0,
        position_km=(r0, 0.05, 0.0),  # 50 m separation <= 100 m limit
        velocity_kms=(0.0, v_circ, -0.001),
    )
    frag_cfg = FragmentationConfig(
        fragment_count=10,
        min_fragment_mass_kg=1.0,
        max_fragment_mass_kg=20.0,
        max_delta_v_kms=0.002,  # 2 m/s bound guarantees 100% CW compliance
        v_median_kms=0.001,
        seed=42,
    )
    return CollisionScenario(
        collision_epoch=base_epoch,
        frame="GCRS",
        parent_a=parent_a,
        parent_b=parent_b,
        config=frag_cfg,
    )


def make_trajectory_point(base_epoch: datetime, offset_s: float, r: float = 7200.0, v: float = 7.440621) -> TrajectoryPoint:
    """Helper creating discrete TrajectoryPoint along a circular arc."""
    dt = offset_s
    t = base_epoch + timedelta(seconds=dt)
    n = math.sqrt(MU_EARTH_KM3_S2 / (r**3))
    theta = n * dt
    pos = (r * math.cos(theta), r * math.sin(theta), 0.0)
    vel = (-v * math.sin(theta), v * math.cos(theta), 0.0)
    return TrajectoryPoint(epoch=t, position_km=pos, velocity_kms=vel)


# ============================================================================
# Section A: Breakup and Propagation Pipeline
# ============================================================================


class TestBreakupAndPropagationPipeline:
    """Tests for simulate_breakup_and_propagate()."""

    def test_valid_breakup_and_propagation_pipeline(self, controlled_collision_scenario: CollisionScenario):
        """Verify complete pipeline execution: fragments, trajectories, counts, and conservation."""
        prop_cfg = NumericalPropagationConfig(duration_seconds=60.0, step_seconds=10.0)
        frag_res, traj_batch = simulate_breakup_and_propagate(controlled_collision_scenario, prop_cfg)

        assert isinstance(frag_res, FragmentationResult)
        assert isinstance(traj_batch, FragmentTrajectoryBatch)

        # Check counts
        assert len(frag_res.fragments) == 10
        assert traj_batch.count == 10
        assert len(traj_batch.trajectories) == 10

        # Exact 1:1 ID match
        frag_ids = [f.fragment_id for f in frag_res.fragments]
        traj_ids = [t.fragment_id for t in traj_batch.trajectories]
        assert frag_ids == traj_ids

        # Mass conservation
        total_frag_mass = sum(f.mass_kg for f in frag_res.fragments)
        assert abs(total_frag_mass + frag_res.metadata.residual_mass_kg - 1000.0) < 1e-6

        # Check trajectory statuses
        for traj in traj_batch.trajectories:
            assert traj.status in ("SUCCESS", "PARTIAL")
            assert len(traj.points) >= 2

    def test_breakup_and_propagation_deterministic_reproducibility(self, controlled_collision_scenario: CollisionScenario):
        """Verify identical outputs across independent seeded runs."""
        prop_cfg = NumericalPropagationConfig(duration_seconds=60.0, step_seconds=10.0)
        frag_res_1, traj_batch_1 = simulate_breakup_and_propagate(controlled_collision_scenario, prop_cfg)
        frag_res_2, traj_batch_2 = simulate_breakup_and_propagate(controlled_collision_scenario, prop_cfg)

        for f1, f2 in zip(frag_res_1.fragments, frag_res_2.fragments):
            assert f1.fragment_id == f2.fragment_id
            assert f1.mass_kg == f2.mass_kg
            assert f1.position_km == f2.position_km
            assert f1.velocity_kms == f2.velocity_kms

        for t1, t2 in zip(traj_batch_1.trajectories, traj_batch_2.trajectories):
            assert t1.fragment_id == t2.fragment_id
            assert len(t1.points) == len(t2.points)
            assert t1.points[-1].position_km == t2.points[-1].position_km

    def test_breakup_and_propagation_accounting_with_failure(self, base_epoch: datetime):
        """Verify that invalid fragment states fail gracefully and are accounted for in batch summary."""
        # Initial radius inside dense atmosphere (< 6478.137 km) fails initial state validation
        invalid_frag = SyntheticFragmentRecord(
            fragment_id="SYNTH-FRAG-INVALID",
            source_parent_id="COMBINED",
            epoch=base_epoch,
            frame="GCRS",
            position_km=(6400.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.8, 0.0),
            mass_kg=10.0,
            delta_v_kms=0.0,
            ejection_vector_kms=(0.0, 0.0, 0.0),
            is_synthetic=True,
        )
        valid_frag = SyntheticFragmentRecord(
            fragment_id="SYNTH-FRAG-VALID",
            source_parent_id="COMBINED",
            epoch=base_epoch,
            frame="GCRS",
            position_km=(7200.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.440621, 0.0),
            mass_kg=15.0,
            delta_v_kms=0.0,
            ejection_vector_kms=(0.0, 0.0, 0.0),
            is_synthetic=True,
        )
        from simulation.propagation import propagate_fragment_batch
        cfg = NumericalPropagationConfig(duration_seconds=30.0, step_seconds=10.0)
        batch = propagate_fragment_batch([invalid_frag, valid_frag], config=cfg)

        assert batch.count == 2
        assert batch.failed_count == 1
        assert batch.summary.invalid_state_count == 1
        assert batch.trajectories[0].status == "FAILED"
        assert batch.trajectories[1].status == "SUCCESS"

    def test_breakup_and_propagation_invalid_input_types(self):
        """Verify rejection of non-CollisionScenario and non-NumericalPropagationConfig inputs."""
        with pytest.raises(TypeError, match="scenario must be a CollisionScenario"):
            simulate_breakup_and_propagate(scenario={"invalid": "dict"})  # type: ignore

        with pytest.raises(TypeError, match="propagation_config must be a NumericalPropagationConfig"):
            parent = ParentBodyState(object_id="A", mass_kg=100.0, position_km=(7000.0, 0.0, 0.0), velocity_kms=(0.0, 7.5, 0.0))
            scen = CollisionScenario(
                collision_epoch=datetime.now(timezone.utc),
                parent_a=parent,
                parent_b=parent,
            )
            simulate_breakup_and_propagate(scenario=scen, propagation_config={"invalid": "cfg"})  # type: ignore


# ============================================================================
# Section B: Fragment Identity and Selection
# ============================================================================


class TestFragmentIdentityAndSelection:
    """Tests for select_highest_mass_cw_compliant_fragment()."""

    def test_selection_duplicate_fragment_ids_rejected(self, base_epoch: datetime):
        """Verify duplicate fragment IDs in input fragments list raise ValueError."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.44, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1 = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 10)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)
        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=1, successful_count=1, failed_count=0, summary=FragmentPropagationSummary(total_fragments=1, completed_count=1, reentered_count=0, numerical_failure_count=0, invalid_state_count=0, duration_seconds=10.0, step_seconds=10.0, execution_wall_time_seconds=0.1), trajectories=[t1])

        with pytest.raises(ValueError, match="Duplicate fragment ID encountered in fragments list"):
            select_highest_mass_cw_compliant_fragment([f1, f1], batch)

    def test_selection_duplicate_trajectory_ids_rejected(self, base_epoch: datetime):
        """Verify duplicate fragment IDs in trajectory batch raise ValueError."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.44, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1 = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 10)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)
        batch_dup = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=2, successful_count=2, failed_count=0, summary=FragmentPropagationSummary(total_fragments=2, completed_count=2, reentered_count=0, numerical_failure_count=0, invalid_state_count=0, duration_seconds=10.0, step_seconds=10.0, execution_wall_time_seconds=0.1), trajectories=[t1, t1])

        with pytest.raises(ValueError, match="Duplicate fragment ID encountered in trajectory batch"):
            select_highest_mass_cw_compliant_fragment([f1], batch_dup)

    def test_selection_missing_trajectory_id_rejected(self, base_epoch: datetime):
        """Verify missing trajectory for a fragment raises ValueError."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.44, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        f2 = SyntheticFragmentRecord(fragment_id="F2", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.44, 0.0), mass_kg=20.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1 = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 10)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)
        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=1, successful_count=1, failed_count=0, summary=FragmentPropagationSummary(total_fragments=1, completed_count=1, reentered_count=0, numerical_failure_count=0, invalid_state_count=0, duration_seconds=10.0, step_seconds=10.0, execution_wall_time_seconds=0.1), trajectories=[t1])

        with pytest.raises(ValueError, match="Mismatched fragment IDs between fragments and trajectories"):
            select_highest_mass_cw_compliant_fragment([f1, f2], batch)

    def test_selection_extra_trajectory_id_rejected(self, base_epoch: datetime):
        """Verify extra trajectory without corresponding fragment raises ValueError."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.44, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1 = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 10)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)
        t2 = FragmentTrajectory(fragment_id="F2", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 10)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=20.0)
        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=2, successful_count=2, failed_count=0, summary=FragmentPropagationSummary(total_fragments=2, completed_count=2, reentered_count=0, numerical_failure_count=0, invalid_state_count=0, duration_seconds=10.0, step_seconds=10.0, execution_wall_time_seconds=0.1), trajectories=[t1, t2])

        with pytest.raises(ValueError, match="Mismatched fragment IDs between fragments and trajectories"):
            select_highest_mass_cw_compliant_fragment([f1], batch)

    def test_selection_excludes_failed_trajectories(self, base_epoch: datetime):
        """Verify trajectories with status='FAILED' are disqualified."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=100.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        f2 = SyntheticFragmentRecord(fragment_id="F2", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1_fail = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[], status="FAILED", termination_reason="NUMERICAL_FAILURE", mass_kg=100.0)
        t2_ok = FragmentTrajectory(fragment_id="F2", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 10)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)
        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=2, successful_count=1, failed_count=1, summary=FragmentPropagationSummary(total_fragments=2, completed_count=1, reentered_count=0, numerical_failure_count=1, invalid_state_count=0, duration_seconds=10.0, step_seconds=10.0, execution_wall_time_seconds=0.1), trajectories=[t1_fail, t2_ok])

        sel_frag, sel_traj = select_highest_mass_cw_compliant_fragment([f1, f2], batch)
        assert sel_frag.fragment_id == "F2"
        assert sel_frag.mass_kg == 10.0

    def test_selection_excludes_fewer_than_two_points(self, base_epoch: datetime):
        """Verify trajectories with fewer than 2 points are disqualified."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1_1pt = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)
        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=1, successful_count=1, failed_count=0, summary=FragmentPropagationSummary(total_fragments=1, completed_count=1, reentered_count=0, numerical_failure_count=0, invalid_state_count=0, duration_seconds=10.0, step_seconds=10.0, execution_wall_time_seconds=0.1), trajectories=[t1_1pt])

        with pytest.raises(ValueError, match="No CW-compliant, lifecycle-valid fragments found in batch"):
            select_highest_mass_cw_compliant_fragment([f1], batch)

    def test_selection_no_eligible_fragments_raises(self, base_epoch: datetime):
        """Verify ValueError is raised when all fragments are non-compliant."""
        # Orbit with eccentricity e > 0.005 (v = 8.0 km/s at 7200 km -> e ~ 0.15)
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 8.0, 0.0), mass_kg=50.0, delta_v_kms=0.5, ejection_vector_kms=(0.0, 0.5, 0.0), is_synthetic=True)
        t1 = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 10)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=50.0)
        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=1, successful_count=1, failed_count=0, summary=FragmentPropagationSummary(total_fragments=1, completed_count=1, reentered_count=0, numerical_failure_count=0, invalid_state_count=0, duration_seconds=10.0, step_seconds=10.0, execution_wall_time_seconds=0.1), trajectories=[t1])

        with pytest.raises(ValueError, match="No CW-compliant, lifecycle-valid fragments found in batch"):
            select_highest_mass_cw_compliant_fragment([f1], batch)

    def test_selection_highest_mass_among_eligible_not_all(self, base_epoch: datetime):
        """Verify an ineligible heavy fragment does not defeat a lower-mass eligible fragment."""
        v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7200.0)
        # Frag 1: 100 kg, but eccentric (e ~ 0.08 > 0.005)
        f1_heavy = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, v_circ + 0.3, 0.0), mass_kg=100.0, delta_v_kms=0.3, ejection_vector_kms=(0.0, 0.3, 0.0), is_synthetic=True)
        t1 = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 10)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=100.0)

        # Frag 2: 40 kg, compliant (e ~ 0.00027 <= 0.005)
        f2_med = SyntheticFragmentRecord(fragment_id="F2", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, v_circ + 0.001, 0.0), mass_kg=40.0, delta_v_kms=0.001, ejection_vector_kms=(0.0, 0.001, 0.0), is_synthetic=True)
        t2 = FragmentTrajectory(fragment_id="F2", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 10)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=40.0)

        # Frag 3: 10 kg, compliant
        f3_light = SyntheticFragmentRecord(fragment_id="F3", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, v_circ, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t3 = FragmentTrajectory(fragment_id="F3", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 10)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)

        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=3, successful_count=3, failed_count=0, summary=FragmentPropagationSummary(total_fragments=3, completed_count=3, reentered_count=0, numerical_failure_count=0, invalid_state_count=0, duration_seconds=10.0, step_seconds=10.0, execution_wall_time_seconds=0.1), trajectories=[t1, t2, t3])

        sel_frag, sel_traj = select_highest_mass_cw_compliant_fragment([f1_heavy, f2_med, f3_light], batch)
        assert sel_frag.fragment_id == "F2"
        assert sel_frag.mass_kg == 40.0

    def test_selection_equal_mass_deterministic_tie_breaking(self, base_epoch: datetime):
        """Verify deterministic tie-breaking by fragment_id ascending when masses are equal."""
        v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7200.0)
        f_b = SyntheticFragmentRecord(fragment_id="SYNTH-FRAG-B", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, v_circ, 0.0), mass_kg=25.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        f_a = SyntheticFragmentRecord(fragment_id="SYNTH-FRAG-A", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, v_circ, 0.0), mass_kg=25.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t_b = FragmentTrajectory(fragment_id="SYNTH-FRAG-B", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 10)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=25.0)
        t_a = FragmentTrajectory(fragment_id="SYNTH-FRAG-A", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 10)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=25.0)

        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=2, successful_count=2, failed_count=0, summary=FragmentPropagationSummary(total_fragments=2, completed_count=2, reentered_count=0, numerical_failure_count=0, invalid_state_count=0, duration_seconds=10.0, step_seconds=10.0, execution_wall_time_seconds=0.1), trajectories=[t_b, t_a])

        # Regardless of input list order, SYNTH-FRAG-A must win tie-break
        sel_frag_1, _ = select_highest_mass_cw_compliant_fragment([f_b, f_a], batch)
        assert sel_frag_1.fragment_id == "SYNTH-FRAG-A"

        sel_frag_2, _ = select_highest_mass_cw_compliant_fragment([f_a, f_b], batch)
        assert sel_frag_2.fragment_id == "SYNTH-FRAG-A"


# ============================================================================
# Section C: Lifecycle and Atmospheric Re-entry
# ============================================================================


class TestLifecycleAndAtmosphericReentry:
    """Tests for trajectory lifecycle and atmospheric interface boundary conditions."""

    def test_lifecycle_completed_trajectory_accepted(self, base_epoch: datetime):
        """Verify standard SUCCESS/COMPLETED trajectory is eligible."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1 = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 60)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)
        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=1, successful_count=1, failed_count=0, summary=FragmentPropagationSummary(total_fragments=1, completed_count=1, reentered_count=0, numerical_failure_count=0, invalid_state_count=0, duration_seconds=60.0, step_seconds=60.0, execution_wall_time_seconds=0.1), trajectories=[t1])

        sel, _ = select_highest_mass_cw_compliant_fragment([f1], batch, t0=base_epoch, t_target=base_epoch + timedelta(seconds=30))
        assert sel.fragment_id == "F1"

    def test_lifecycle_atmospheric_interface_valid_prefix_accepted(self, base_epoch: datetime):
        """Verify PARTIAL trajectory terminated at ATMOSPHERIC_INTERFACE is accepted before re-entry."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        # Re-entry occurs at +500s
        t1_reentry = FragmentTrajectory(
            fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s",
            points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 250), make_trajectory_point(base_epoch, 500)],
            status="PARTIAL", termination_reason="ATMOSPHERIC_INTERFACE", mass_kg=10.0,
        )
        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=1, successful_count=0, failed_count=1, summary=FragmentPropagationSummary(total_fragments=1, completed_count=0, reentered_count=1, numerical_failure_count=0, invalid_state_count=0, duration_seconds=500.0, step_seconds=250.0, execution_wall_time_seconds=0.1), trajectories=[t1_reentry])

        # t0 at +10s, t_target at +200s (both well before +500s)
        sel, _ = select_highest_mass_cw_compliant_fragment([f1], batch, t0=base_epoch + timedelta(seconds=10), t_target=base_epoch + timedelta(seconds=200))
        assert sel.fragment_id == "F1"

    @pytest.mark.parametrize("t0_offset, tt_offset, desc", [
        (600, 700, "reentry_before_t0"),
        (100, 600, "reentry_between_t0_and_ttarget"),
        (0, 500, "reentry_exactly_at_ttarget"),
    ])
    def test_lifecycle_reentry_boundary_disqualifications(self, base_epoch: datetime, t0_offset: float, tt_offset: float, desc: str):
        """Verify disqualification when re-entry occurs before t0, between t0 and t_target, or exactly at t_target."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        # Trajectory re-enters at +500s
        t1_reentry = FragmentTrajectory(
            fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s",
            points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 250), make_trajectory_point(base_epoch, 500)],
            status="PARTIAL", termination_reason="ATMOSPHERIC_INTERFACE", mass_kg=10.0,
        )
        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=1, successful_count=0, failed_count=1, summary=FragmentPropagationSummary(total_fragments=1, completed_count=0, reentered_count=1, numerical_failure_count=0, invalid_state_count=0, duration_seconds=500.0, step_seconds=250.0, execution_wall_time_seconds=0.1), trajectories=[t1_reentry])

        with pytest.raises(ValueError, match="No CW-compliant, lifecycle-valid fragments found in batch"):
            select_highest_mass_cw_compliant_fragment([f1], batch, t0=base_epoch + timedelta(seconds=t0_offset), t_target=base_epoch + timedelta(seconds=tt_offset))

    def test_lifecycle_invalid_partial_termination_reasons_disqualified(self, base_epoch: datetime):
        """Verify PARTIAL trajectories with reasons other than ATMOSPHERIC_INTERFACE are disqualified."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1_num_fail = FragmentTrajectory(
            fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s",
            points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 50)],
            status="PARTIAL", termination_reason="NUMERICAL_FAILURE", mass_kg=10.0,
        )
        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=1, successful_count=0, failed_count=1, summary=FragmentPropagationSummary(total_fragments=1, completed_count=0, reentered_count=0, numerical_failure_count=1, invalid_state_count=0, duration_seconds=50.0, step_seconds=50.0, execution_wall_time_seconds=0.1), trajectories=[t1_num_fail])

        with pytest.raises(ValueError, match="No CW-compliant, lifecycle-valid fragments found in batch"):
            select_highest_mass_cw_compliant_fragment([f1], batch)

    def test_lifecycle_extrapolation_outside_bounds_disqualified(self, base_epoch: datetime):
        """Verify request epochs outside [t_start, t_end] are disqualified."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        # Trajectory spans [0s, 100s]
        t1 = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 50)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)
        batch = FragmentTrajectoryBatch(scenario_epoch=base_epoch, count=1, successful_count=1, failed_count=0, summary=FragmentPropagationSummary(total_fragments=1, completed_count=1, reentered_count=0, numerical_failure_count=0, invalid_state_count=0, duration_seconds=100.0, step_seconds=100.0, execution_wall_time_seconds=0.1), trajectories=[t1])

        # Case A: t0 before trajectory start
        with pytest.raises(ValueError, match="No CW-compliant, lifecycle-valid fragments found in batch"):
            select_highest_mass_cw_compliant_fragment([f1], batch, t0=base_epoch - timedelta(seconds=10), t_target=base_epoch + timedelta(seconds=50))

        # Case B: t_target after trajectory end
        with pytest.raises(ValueError, match="No CW-compliant, lifecycle-valid fragments found in batch"):
            select_highest_mass_cw_compliant_fragment([f1], batch, t0=base_epoch + timedelta(seconds=10), t_target=base_epoch + timedelta(seconds=150))


# ============================================================================
# Section D: Rendezvous Contract Preparation
# ============================================================================


class TestRendezvousContractPreparation:
    """Tests for prepare_fragment_rendezvous_contract()."""

    def test_prepare_contract_valid(self, base_epoch: datetime):
        """Verify contract fields, GCRS frame, synthetic provenance, and float coordinates."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1 = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 50)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)

        contract = prepare_fragment_rendezvous_contract(
            fragment=f1,
            trajectory=t1,
            chaser_id="CHASER-ALPHA",
            chaser_epoch_utc=base_epoch + timedelta(seconds=10),
            chaser_gcrs_position_km=[7200.0, 0.05, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.440621, 0.0],
            target_epoch_utc=base_epoch + timedelta(seconds=12),
        )

        assert contract.target_id == "F1"
        assert contract.chaser_id == "CHASER-ALPHA"
        assert contract.target_is_synthetic is True
        assert len(contract.target_gcrs_position_km) == 3
        assert len(contract.target_gcrs_velocity_kms) == 3
        assert len(contract.chaser_gcrs_position_km) == 3
        assert len(contract.chaser_gcrs_velocity_kms) == 3

    def test_prepare_contract_target_epoch_default(self, base_epoch: datetime):
        """Verify target_epoch_utc defaults to chaser_epoch_utc when omitted."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1 = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 50)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)

        t_chaser = base_epoch + timedelta(seconds=20)
        contract = prepare_fragment_rendezvous_contract(
            fragment=f1, trajectory=t1, chaser_id="C1",
            chaser_epoch_utc=t_chaser,
            chaser_gcrs_position_km=[7200.0, 0.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.44, 0.0],
            target_epoch_utc=None,
        )
        assert contract.target_epoch_utc == t_chaser

    def test_prepare_contract_naive_datetime_normalization(self, base_epoch: datetime):
        """Verify naive datetimes are normalized to timezone-aware UTC."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1 = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 50)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)

        naive_chaser = datetime(2026, 11, 4, 12, 0, 10)  # naive
        contract = prepare_fragment_rendezvous_contract(
            fragment=f1, trajectory=t1, chaser_id="C1",
            chaser_epoch_utc=naive_chaser,
            chaser_gcrs_position_km=[7200.0, 0.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.44, 0.0],
        )
        assert contract.chaser_epoch_utc.tzinfo is not None
        assert contract.target_epoch_utc.tzinfo is not None

    def test_prepare_contract_identity_mismatch_raises(self, base_epoch: datetime):
        """Verify mismatch between fragment ID and trajectory ID raises ValueError."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t2 = FragmentTrajectory(fragment_id="F2", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 100)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)

        with pytest.raises(ValueError, match="does not match trajectory ID"):
            prepare_fragment_rendezvous_contract(
                fragment=f1, trajectory=t2, chaser_id="C1",
                chaser_epoch_utc=base_epoch,
                chaser_gcrs_position_km=[7200.0, 0.0, 0.0],
                chaser_gcrs_velocity_kms=[0.0, 7.44, 0.0],
            )

    def test_prepare_contract_extrapolation_raises(self, base_epoch: datetime):
        """Verify target_epoch outside trajectory span raises ValueError."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1 = FragmentTrajectory(fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s", points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 50)], status="SUCCESS", termination_reason="COMPLETED", mass_kg=10.0)

        with pytest.raises(ValueError, match="Extrapolation is prohibited"):
            prepare_fragment_rendezvous_contract(
                fragment=f1, trajectory=t1, chaser_id="C1",
                chaser_epoch_utc=base_epoch + timedelta(seconds=10),
                chaser_gcrs_position_km=[7200.0, 0.0, 0.0],
                chaser_gcrs_velocity_kms=[0.0, 7.44, 0.0],
                target_epoch_utc=base_epoch + timedelta(seconds=200),  # after +100s
            )

    def test_prepare_contract_reentry_boundary_rejections(self, base_epoch: datetime):
        """Verify rejection when target or chaser epoch is at or after atmospheric interface entry."""
        f1 = SyntheticFragmentRecord(fragment_id="F1", source_parent_id="COMBINED", epoch=base_epoch, frame="GCRS", position_km=(7200.0, 0.0, 0.0), velocity_kms=(0.0, 7.440621, 0.0), mass_kg=10.0, delta_v_kms=0.0, ejection_vector_kms=(0.0, 0.0, 0.0), is_synthetic=True)
        t1_reentry = FragmentTrajectory(
            fragment_id="F1", frame="GCRS", position_unit="km", velocity_unit="km/s",
            points=[make_trajectory_point(base_epoch, 0), make_trajectory_point(base_epoch, 100)],
            status="PARTIAL", termination_reason="ATMOSPHERIC_INTERFACE", mass_kg=10.0,
        )

        # Chaser at or after re-entry (+100s)
        with pytest.raises(ValueError, match="at or after atmospheric re-entry"):
            prepare_fragment_rendezvous_contract(
                fragment=f1, trajectory=t1_reentry, chaser_id="C1",
                chaser_epoch_utc=base_epoch + timedelta(seconds=100),
                chaser_gcrs_position_km=[7200.0, 0.0, 0.0],
                chaser_gcrs_velocity_kms=[0.0, 7.44, 0.0],
            )


# ============================================================================
# Section E: Day 10 Planner Integration
# ============================================================================


class TestDay10PlannerIntegration:
    """End-to-end integration tests using genuine numerical propagation ephemerides."""

    def test_planner_integration_genuine_propagated_trajectory(self, controlled_collision_scenario: CollisionScenario, base_epoch: datetime):
        """Verify genuine numerical ephemeris feeds smoothly into plan_debris_rendezvous."""
        prop_cfg = NumericalPropagationConfig(duration_seconds=300.0, step_seconds=5.0)
        frag_res, traj_batch = simulate_breakup_and_propagate(controlled_collision_scenario, prop_cfg)

        sel_frag, sel_traj = select_highest_mass_cw_compliant_fragment(
            frag_res.fragments, traj_batch, t0=base_epoch, t_target=base_epoch + timedelta(seconds=60)
        )

        t0 = base_epoch + timedelta(seconds=10.0)
        # Position chaser 50m trailing along V-bar
        target_pt_10 = sel_traj.points[2]
        chaser_pos = [target_pt_10.position_km[0], target_pt_10.position_km[1] - 0.05, target_pt_10.position_km[2]]
        chaser_vel = list(target_pt_10.velocity_kms)

        contract = prepare_fragment_rendezvous_contract(
            fragment=sel_frag,
            trajectory=sel_traj,
            chaser_id="CHASER-INTEGRATION",
            chaser_epoch_utc=t0,
            chaser_gcrs_position_km=chaser_pos,
            chaser_gcrs_velocity_kms=chaser_vel,
            target_epoch_utc=t0,
        )

        cfg = RendezvousConfig(
            targeting_mode=TargetingMode.STANDOFF_HOLD,
            standoff_distance_m=10.0,
            transfer_time_s=120.0,
            delta_v_budget_max_ms=10.0,
        )

        result = plan_debris_rendezvous(contract, config=cfg, target_trajectory=sel_traj)

        assert isinstance(result, RendezvousResult)
        assert result.is_mathematically_solvable is True
        assert result.is_budget_feasible is True
        assert result.is_feasible is True
        assert result.total_delta_v_ms <= cfg.delta_v_budget_max_ms
        assert result.condition_number <= cfg.max_condition_number
        assert result.terminal_position_error_m < 1e-3
        assert result.terminal_velocity_error_ms < 1e-3
        assert result.scientific_disclaimer != ""

    def test_planner_integration_genuine_j2_reentry_and_rejection(self, base_epoch: datetime):
        """Verify genuine J2 atmospheric interface crossing: accepted before, rejected at/after."""
        # 6482 km circular orbit descends to 6478.137 km under J2 oblateness
        r0 = 6482.0
        v_circ = math.sqrt(MU_EARTH_KM3_S2 / r0)
        frag = SyntheticFragmentRecord(
            fragment_id="SYNTH-FRAG-J2-REENTRY",
            source_parent_id="COMBINED",
            epoch=base_epoch,
            frame="GCRS",
            position_km=(r0, 0.0, 0.0),
            velocity_kms=(0.0, v_circ, 0.0),
            mass_kg=10.0,
            delta_v_kms=0.0,
            ejection_vector_kms=(0.0, 0.0, 0.0),
            is_synthetic=True,
        )
        pole_cip = get_cip_unit_vector(base_epoch)
        prop_cfg = NumericalPropagationConfig(duration_seconds=3600.0, step_seconds=5.0)
        traj = propagate_fragment(frag, prop_cfg, pole_cip)

        assert traj.status == "PARTIAL"
        assert traj.termination_reason == "ATMOSPHERIC_INTERFACE"
        assert traj.reentry_epoch is not None

        # 1. Before re-entry: planning succeeds
        t0 = base_epoch + timedelta(seconds=10.0)
        p10 = traj.points[2]
        chaser_pos = [p10.position_km[0], p10.position_km[1] - 0.05, p10.position_km[2]]
        contract_valid = prepare_fragment_rendezvous_contract(
            fragment=frag, trajectory=traj, chaser_id="CHASER-01",
            chaser_epoch_utc=t0, chaser_gcrs_position_km=chaser_pos, chaser_gcrs_velocity_kms=list(p10.velocity_kms),
        )
        cfg = RendezvousConfig(transfer_time_s=120.0, delta_v_budget_max_ms=10.0)
        res_valid = plan_debris_rendezvous(contract_valid, config=cfg, target_trajectory=traj)
        assert res_valid.is_mathematically_solvable is True
        assert res_valid.is_feasible is True

        # 2. At re-entry: planning rejected with atmospheric boundary violation
        contract_reentry = RendezvousContract(
            target_id=frag.fragment_id, chaser_id="CHASER-01", target_is_synthetic=True,
            target_epoch_utc=traj.reentry_epoch, chaser_epoch_utc=traj.reentry_epoch,
            target_gcrs_position_km=traj.points[-1].position_km,
            target_gcrs_velocity_kms=traj.points[-1].velocity_kms,
            chaser_gcrs_position_km=chaser_pos, chaser_gcrs_velocity_kms=list(p10.velocity_kms),
        )
        with pytest.raises(ValueError, match="violates atmospheric entry boundary|at or after target atmospheric re-entry"):
            plan_debris_rendezvous(contract_reentry, config=cfg, target_trajectory=traj)


# ============================================================================
# SECTION F: Composite Request / Response Schemas Validation
# ============================================================================


def test_breakup_remediation_request_valid_construction(controlled_collision_scenario):
    """Test valid construction of BreakupRemediationRequest with defaults."""
    epoch = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7200.0)

    req = BreakupRemediationRequest(
        scenario=controlled_collision_scenario,
        chaser_id="CHASER-01",
        chaser_epoch_utc=epoch,
        chaser_gcrs_position_km=[7200.0, 0.1, 0.0],
        chaser_gcrs_velocity_kms=[0.0, v_circ, 0.0],
    )
    assert req.chaser_id == "CHASER-01"
    assert req.target_epoch_utc is None
    assert req.propagation_config.duration_seconds >= 7200.0
    assert req.rendezvous_config.transfer_time_s == 3600.0
    assert req.max_target_eccentricity == 0.005
    assert req.min_target_perigee_km == 6478.137


def test_breakup_remediation_request_rejects_extra_fields(controlled_collision_scenario):
    """Test that BreakupRemediationRequest forbids extra arbitrary fields."""
    epoch = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7200.0)

    with pytest.raises(ValidationError):
        BreakupRemediationRequest(
            scenario=controlled_collision_scenario,
            chaser_id="CHASER-01",
            chaser_epoch_utc=epoch,
            chaser_gcrs_position_km=[7200.0, 0.1, 0.0],
            chaser_gcrs_velocity_kms=[0.0, v_circ, 0.0],
            unknown_extra_param="disallowed",
        )


def test_breakup_remediation_request_rejects_chaser_preceding_collision(controlled_collision_scenario):
    """Test rejection when chaser epoch is earlier than collision epoch."""
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7200.0)
    pre_collision_epoch = controlled_collision_scenario.collision_epoch - timedelta(seconds=60)

    with pytest.raises(ValueError, match="chaser_epoch_utc .* cannot precede"):
        BreakupRemediationRequest(
            scenario=controlled_collision_scenario,
            chaser_id="CHASER-01",
            chaser_epoch_utc=pre_collision_epoch,
            chaser_gcrs_position_km=[7200.0, 0.1, 0.0],
            chaser_gcrs_velocity_kms=[0.0, v_circ, 0.0],
        )


def test_breakup_remediation_request_rejects_transfer_exceeding_propagation(controlled_collision_scenario):
    """Test rejection when transfer window extends beyond propagation duration."""
    epoch = controlled_collision_scenario.collision_epoch
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7200.0)

    with pytest.raises(ValueError, match="extends beyond propagation duration"):
        BreakupRemediationRequest(
            scenario=controlled_collision_scenario,
            chaser_id="CHASER-01",
            chaser_epoch_utc=epoch,
            chaser_gcrs_position_km=[7200.0, 0.1, 0.0],
            chaser_gcrs_velocity_kms=[0.0, v_circ, 0.0],
            propagation_config=NumericalPropagationConfig(duration_seconds=1800.0),
            rendezvous_config=RendezvousConfig(transfer_time_s=3600.0),
        )


def test_breakup_remediation_request_rejects_unphysical_chaser(controlled_collision_scenario):
    """Test rejection when chaser orbit is inside Earth or non-circular."""
    epoch = controlled_collision_scenario.collision_epoch

    # 1. Chaser inside Earth radius
    with pytest.raises(ValueError, match="inside Earth radius"):
        BreakupRemediationRequest(
            scenario=controlled_collision_scenario,
            chaser_id="CHASER-01",
            chaser_epoch_utc=epoch,
            chaser_gcrs_position_km=[6000.0, 0.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 7.5, 0.0],
        )

    # 2. Chaser eccentric orbit e > 0.005
    with pytest.raises(ValueError, match="exceeds near-circular limit"):
        BreakupRemediationRequest(
            scenario=controlled_collision_scenario,
            chaser_id="CHASER-01",
            chaser_epoch_utc=epoch,
            chaser_gcrs_position_km=[7200.0, 0.0, 0.0],
            chaser_gcrs_velocity_kms=[0.0, 9.0, 0.0],
        )


# ============================================================================
# SECTION G: End-to-End Orchestrator (plan_breakup_remediation)
# ============================================================================


def test_plan_breakup_remediation_success(controlled_collision_scenario):
    """Test full end-to-end execution of plan_breakup_remediation."""
    epoch = controlled_collision_scenario.collision_epoch
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7200.0)

    req = BreakupRemediationRequest(
        scenario=controlled_collision_scenario,
        chaser_id="CHASER-HERMES",
        chaser_epoch_utc=epoch,
        chaser_gcrs_position_km=[7200.0, 0.1, 0.0],
        chaser_gcrs_velocity_kms=[0.0, v_circ, 0.0],
        rendezvous_config=RendezvousConfig(
            targeting_mode=TargetingMode.STANDOFF_HOLD,
            standoff_distance_m=100.0,
            transfer_time_s=3600.0,
            delta_v_budget_max_ms=100.0,
        ),
    )

    response = plan_breakup_remediation(req)
    assert isinstance(response, BreakupRemediationResponse)
    expected_count = controlled_collision_scenario.config.fragment_count
    assert len(response.fragmentation.fragments) == expected_count
    assert response.trajectories_summary.total_fragments == expected_count
    assert response.selected_target.fragment_id is not None
    assert response.selected_target.mass_kg > 0.0
    assert response.contract.target_id == response.selected_target.fragment_id
    assert response.contract.chaser_id == "CHASER-HERMES"
    assert response.rendezvous.is_mathematically_solvable is True
    assert response.rendezvous.is_budget_feasible is True
    assert response.rendezvous.is_feasible is True
    assert response.rendezvous.total_delta_v_ms > 0.0
    assert response.rendezvous.terminal_position_error_m < 1e-3
    assert response.execution_wall_time_s > 0.0
    assert "RESEARCH PROTOTYPE" in response.scientific_disclaimer


def test_plan_breakup_remediation_deterministic_reproducibility(controlled_collision_scenario):
    """Test deterministic reproducibility of plan_breakup_remediation excluding execution time."""
    epoch = controlled_collision_scenario.collision_epoch
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7200.0)

    req1 = BreakupRemediationRequest(
        scenario=controlled_collision_scenario,
        chaser_id="CHASER-01",
        chaser_epoch_utc=epoch,
        chaser_gcrs_position_km=[7200.0, 0.1, 0.0],
        chaser_gcrs_velocity_kms=[0.0, v_circ, 0.0],
    )
    req2 = BreakupRemediationRequest(
        scenario=controlled_collision_scenario,
        chaser_id="CHASER-01",
        chaser_epoch_utc=epoch,
        chaser_gcrs_position_km=[7200.0, 0.1, 0.0],
        chaser_gcrs_velocity_kms=[0.0, v_circ, 0.0],
    )

    resp1 = plan_breakup_remediation(req1)
    resp2 = plan_breakup_remediation(req2)

    # Determinism assertions on physical quantities
    assert resp1.selected_target.fragment_id == resp2.selected_target.fragment_id
    assert resp1.selected_target.mass_kg == resp2.selected_target.mass_kg
    assert resp1.contract.target_gcrs_position_km == resp2.contract.target_gcrs_position_km
    assert resp1.contract.target_gcrs_velocity_kms == resp2.contract.target_gcrs_velocity_kms
    assert resp1.rendezvous.burn_1_dv_cw_ms == resp2.rendezvous.burn_1_dv_cw_ms
    assert resp1.rendezvous.burn_2_dv_cw_ms == resp2.rendezvous.burn_2_dv_cw_ms
    assert resp1.rendezvous.total_delta_v_ms == resp2.rendezvous.total_delta_v_ms

    # Both recorded positive execution time
    assert resp1.execution_wall_time_s > 0.0
    assert resp2.execution_wall_time_s > 0.0


def test_plan_breakup_remediation_differential_epochs(controlled_collision_scenario):
    """Test plan_breakup_remediation when target_epoch_utc differs from chaser_epoch_utc."""
    epoch = controlled_collision_scenario.collision_epoch
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7200.0)
    target_dt = epoch + timedelta(seconds=2.0)

    req = BreakupRemediationRequest(
        scenario=controlled_collision_scenario,
        chaser_id="CHASER-DIFF",
        chaser_epoch_utc=epoch,
        target_epoch_utc=target_dt,
        chaser_gcrs_position_km=[7200.0, 0.1, 0.0],
        chaser_gcrs_velocity_kms=[0.0, v_circ, 0.0],
        rendezvous_config=RendezvousConfig(epoch_tolerance_s=10.0),
    )

    response = plan_breakup_remediation(req)
    assert response.rendezvous.is_mathematically_solvable is True
    assert response.rendezvous.epoch_synchronization_applied is True
    assert response.contract.target_epoch_utc == target_dt
    assert response.contract.chaser_epoch_utc == epoch


def test_plan_breakup_remediation_rejects_type_error():
    """Test plan_breakup_remediation raises TypeError for invalid argument type."""
    with pytest.raises(TypeError, match="request must be a BreakupRemediationRequest"):
        plan_breakup_remediation({"invalid": "dict"})


def test_plan_breakup_remediation_reentry_window_gating():
    """Test that fragments failing CW or re-entering during transfer raise ValueError."""
    epoch = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7200.0)

    # Impactor colliding at extreme non-circular relative speed (v = 1.0 km/s -> e >> 0.005)
    parent_a = ParentBodyState(
        object_id="SAT-A",
        mass_kg=500.0,
        position_km=(7200.0, 0.0, 0.0),
        velocity_kms=(0.0, v_circ, 0.0),
    )
    parent_b = ParentBodyState(
        object_id="SAT-B",
        mass_kg=500.0,
        position_km=(7200.0, 0.05, 0.0),
        velocity_kms=(0.0, v_circ + 0.5, 0.0),  # Severe velocity discrepancy
    )
    cfg = FragmentationConfig(
        fragment_count=5,
        min_fragment_mass_kg=1.0,
        max_fragment_mass_kg=10.0,
        max_delta_v_kms=0.5,
        v_median_kms=0.4,
        seed=100,
    )
    scenario = CollisionScenario(
        collision_epoch=epoch,
        parent_a=parent_a,
        parent_b=parent_b,
        config=cfg,
    )

    req = BreakupRemediationRequest(
        scenario=scenario,
        chaser_id="CHASER-01",
        chaser_epoch_utc=epoch,
        chaser_gcrs_position_km=[7200.0, 0.1, 0.0],
        chaser_gcrs_velocity_kms=[0.0, v_circ, 0.0],
        rendezvous_config=RendezvousConfig(transfer_time_s=3600.0),
    )

    with pytest.raises(ValueError, match="No CW-compliant, lifecycle-valid fragments found in batch"):
        plan_breakup_remediation(req)
