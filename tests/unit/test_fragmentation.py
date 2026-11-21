"""
Unit tests for packages/simulation synthetic collision fragmentation engine.

Validates:
- CollisionScenario coordinate frame restriction (GCRS only) and epoch normalization.
- Parent body proximity validation (collision_tolerance_km).
- Mass allocation feasibility, soft target preference, and minimum mass floor guarantee.
- Near-zero mass excess guard handling without division-by-zero.
- Mass conservation across tracked fragments and residual cloud.
- Mass-weighted drift cancellation and zero net tracked ejection momentum.
- Total system linear momentum conservation within numerical tolerance.
- Maximum ejection velocity cap enforcement.
- Deterministic reproducibility with random seeds.
- Combined-source attribution and parent provenance preservation.
- StateVectorRecord converter mapping and compatibility.
- Scientific fidelity disclaimers and kinetic energy non-conservation.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import sqrt

import numpy as np
import pytest
from pydantic import ValidationError
from simulation import (
    MASS_CONSERVATION_TOLERANCE_KG,
    MODEL_NAME,
    MOMENTUM_CONSERVATION_TOLERANCE_KG_KMS,
    SIMULATION_DISCLAIMER,
    CollisionScenario,
    FragmentationConfig,
    ParentBodyState,
    fragment_to_state_vector,
    fragments_to_state_vectors,
    generate_fragments,
    sample_bounded_power_law,
)


@pytest.fixture
def base_collision_scenario() -> CollisionScenario:
    """Standard head-on / close-proximity collision scenario in GCRS."""
    epoch = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
    parent_a = ParentBodyState(
        object_id="ISS",
        object_name="ISS (ZARYA)",
        mass_kg=420000.0,
        position_km=(6778.0, 0.0, 0.0),
        velocity_kms=(0.0, 7.67, 0.0),
    )
    # Parent B positioned 0.05 km away (within 0.10 km default tolerance)
    parent_b = ParentBodyState(
        object_id="COSMOS-2251-DEB",
        object_name="COSMOS 2251 DEBRIS",
        mass_kg=850.0,
        position_km=(6778.03, 0.04, 0.0),
        velocity_kms=(0.0, -7.50, 1.20),
    )
    return CollisionScenario(
        collision_epoch=epoch,
        frame="GCRS",
        collision_tolerance_km=0.10,
        parent_a=parent_a,
        parent_b=parent_b,
        config=FragmentationConfig(
            fragment_count=500,
            min_fragment_mass_kg=0.01,
            max_fragment_mass_kg=50.0,
            max_delta_v_kms=1.0,
            seed=42,
        ),
    )


class TestCollisionScenarioValidation:
    def test_parent_proximity_within_tolerance(self, base_collision_scenario: CollisionScenario):
        """Verify scenario validates when separation is within tolerance."""
        xa, ya, za = base_collision_scenario.parent_a.position_km
        xb, yb, zb = base_collision_scenario.parent_b.position_km
        sep = sqrt((xa - xb) ** 2 + (ya - yb) ** 2 + (za - zb) ** 2)
        assert sep <= base_collision_scenario.collision_tolerance_km
        assert base_collision_scenario.frame == "GCRS"

    def test_parent_separation_exceeding_tolerance_rejected(self):
        """Verify separation exceeding collision_tolerance_km raises ValidationError."""
        epoch = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
        parent_a = ParentBodyState(
            object_id="SAT_A",
            mass_kg=1000.0,
            position_km=(7000.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
        )
        parent_b = ParentBodyState(
            object_id="SAT_B",
            mass_kg=500.0,
            position_km=(7005.0, 0.0, 0.0),  # 5 km separation
            velocity_kms=(0.0, -7.5, 0.0),
        )
        with pytest.raises(ValidationError, match="exceeding collision_tolerance_km"):
            CollisionScenario(
                collision_epoch=epoch,
                frame="GCRS",
                collision_tolerance_km=0.10,
                parent_a=parent_a,
                parent_b=parent_b,
            )

    def test_frame_restriction_gcrs_only(self):
        """Verify non-GCRS frames (TEME, ITRS, etc.) are strictly rejected in v1."""
        epoch = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
        parent_a = ParentBodyState(
            object_id="SAT_A",
            mass_kg=1000.0,
            position_km=(7000.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
        )
        parent_b = ParentBodyState(
            object_id="SAT_B",
            mass_kg=500.0,
            position_km=(7000.05, 0.0, 0.0),
            velocity_kms=(0.0, -7.5, 0.0),
        )
        # Attempting TEME should fail
        with pytest.raises(ValidationError, match="strictly restricted to 'GCRS'"):
            CollisionScenario(
                collision_epoch=epoch,
                frame="TEME",  # type: ignore[arg-type]
                parent_a=parent_a,
                parent_b=parent_b,
            )

        # Attempting ITRS should fail
        with pytest.raises(ValidationError, match="strictly restricted to 'GCRS'"):
            CollisionScenario(
                collision_epoch=epoch,
                frame="ITRS",  # type: ignore[arg-type]
                parent_a=parent_a,
                parent_b=parent_b,
            )

    def test_collision_epoch_utc_normalization(self):
        """Verify collision epoch normalizes timezone offsets to UTC and rejects naive datetimes."""
        parent_a = ParentBodyState(
            object_id="SAT_A",
            mass_kg=1000.0,
            position_km=(7000.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
        )
        parent_b = ParentBodyState(
            object_id="SAT_B",
            mass_kg=500.0,
            position_km=(7000.02, 0.0, 0.0),
            velocity_kms=(0.0, -7.5, 0.0),
        )

        # Timezone with +05:30 offset
        tz_offset = timezone(timedelta(hours=5, minutes=30))
        epoch_offset = datetime(2026, 11, 3, 17, 30, 0, tzinfo=tz_offset)
        scenario = CollisionScenario(
            collision_epoch=epoch_offset,
            parent_a=parent_a,
            parent_b=parent_b,
        )
        assert scenario.collision_epoch.tzinfo == timezone.utc
        assert scenario.collision_epoch == datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)

        # Naive datetime must be rejected
        with pytest.raises(ValidationError, match="must be timezone-aware"):
            CollisionScenario(
                collision_epoch=datetime(2026, 11, 3, 12, 0, 0),
                parent_a=parent_a,
                parent_b=parent_b,
            )


class TestMassAllocationAndAccounting:
    def test_infeasible_mass_bounds_rejected(self):
        """Verify N * m_min > M_total raises ValueError prior to sampling."""
        epoch = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
        parent_a = ParentBodyState(
            object_id="A",
            mass_kg=10.0,
            position_km=(7000.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
        )
        parent_b = ParentBodyState(
            object_id="B",
            mass_kg=10.0,
            position_km=(7000.01, 0.0, 0.0),
            velocity_kms=(0.0, -7.5, 0.0),
        )
        # N=500, m_min=1.0 kg -> min required is 500 kg > 20 kg total
        scenario = CollisionScenario(
            collision_epoch=epoch,
            parent_a=parent_a,
            parent_b=parent_b,
            config=FragmentationConfig(fragment_count=500, min_fragment_mass_kg=1.0),
        )
        with pytest.raises(ValueError, match="Infeasible mass allocation"):
            generate_fragments(scenario)

    def test_soft_cap_override_at_boundary(self):
        """
        Verify worked example: M_total = 5.0 kg, N = 500, m_min = 0.01 kg.
        N * m_min = 5.0 kg.
        0.90 * M_total = 4.5 kg < 5.0 kg.
        M_target must equal 5.0 kg, preserving m_i >= m_min and leaving 0 residual mass.
        """
        epoch = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
        parent_a = ParentBodyState(
            object_id="CUBESAT_1",
            mass_kg=3.0,
            position_km=(7000.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
        )
        parent_b = ParentBodyState(
            object_id="CUBESAT_2",
            mass_kg=2.0,
            position_km=(7000.02, 0.0, 0.0),
            velocity_kms=(0.0, -7.5, 0.0),
        )
        scenario = CollisionScenario(
            collision_epoch=epoch,
            parent_a=parent_a,
            parent_b=parent_b,
            config=FragmentationConfig(
                fragment_count=500,
                min_fragment_mass_kg=0.01,
                max_fragment_mass_kg=0.50,
                seed=42,
            ),
        )
        result = generate_fragments(scenario)

        # Every fragment must have mass >= 0.01 kg
        for frag in result.fragments:
            assert frag.mass_kg >= 0.01 - 1e-12

        # Tracked mass must equal 5.0 kg
        assert abs(result.metadata.tracked_fragment_mass_kg - 5.0) < MASS_CONSERVATION_TOLERANCE_KG
        assert abs(result.metadata.residual_mass_kg - 0.0) < MASS_CONSERVATION_TOLERANCE_KG
        total_accounted = (
            result.metadata.tracked_fragment_mass_kg + result.metadata.residual_mass_kg
        )
        assert abs(total_accounted - 5.0) < MASS_CONSERVATION_TOLERANCE_KG

    def test_small_nonzero_raw_excess_allocation(self):
        """
        Verify that near-zero raw excess (E_raw <= 1e-12) allocates target excess
        without division by zero, preserving bounds [m_min, m_max] and exact total.
        """
        epoch = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
        parent_a = ParentBodyState(
            object_id="A", mass_kg=5.0, position_km=(7000.0, 0.0, 0.0), velocity_kms=(0.0, 7.5, 0.0)
        )
        parent_b = ParentBodyState(
            object_id="B",
            mass_kg=5.0,
            position_km=(7000.02, 0.0, 0.0),
            velocity_kms=(0.0, -7.5, 0.0),
        )
        # Configure min_mass = max_mass = 0.01 kg (forces all sampled masses to equal m_min,
        # so E_raw = 0)
        scenario = CollisionScenario(
            collision_epoch=epoch,
            parent_a=parent_a,
            parent_b=parent_b,
            config=FragmentationConfig(
                fragment_count=500,
                min_fragment_mass_kg=0.01,
                max_fragment_mass_kg=0.01,
                seed=42,
            ),
        )
        result = generate_fragments(scenario)

        for frag in result.fragments:
            assert 0.01 <= frag.mass_kg <= 0.01 + 1e-12
        assert abs(result.metadata.tracked_fragment_mass_kg - 5.0) < MASS_CONSERVATION_TOLERANCE_KG
        assert abs(result.metadata.residual_mass_kg - 5.0) < MASS_CONSERVATION_TOLERANCE_KG

    def test_near_zero_excess_close_bounds_regression(self):
        """
        Regression test: max_fragment_mass_kg extremely close to min_fragment_mass_kg
        (m_max = m_min + 1e-15 kg), exercising the near-zero excess branch (E_raw <= 1e-12).

        Verifies:
        - Every final mass remains strictly within configured bounds [m_min, m_max].
        - Total tracked mass matches M_target within floating-point tolerance (1e-9 kg).
        - No unintended clipping changes the intended mass allocation.
        """
        epoch = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
        parent_a = ParentBodyState(
            object_id="A",
            mass_kg=10.0,
            position_km=(7000.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
        )
        parent_b = ParentBodyState(
            object_id="B",
            mass_kg=10.0,
            position_km=(7000.02, 0.0, 0.0),
            velocity_kms=(0.0, -7.5, 0.0),
        )
        m_min = 0.01
        m_max = m_min + 1e-15  # Extremely close bounds
        n_fragments = 500

        scenario = CollisionScenario(
            collision_epoch=epoch,
            parent_a=parent_a,
            parent_b=parent_b,
            config=FragmentationConfig(
                fragment_count=n_fragments,
                min_fragment_mass_kg=m_min,
                max_fragment_mass_kg=m_max,
                seed=42,
            ),
        )
        result = generate_fragments(scenario)

        # 1. Verify every final mass remains strictly within configured bounds
        for frag in result.fragments:
            assert m_min <= frag.mass_kg <= m_max, (
                f"Fragment mass {frag.mass_kg} violated bounds [{m_min}, {m_max}]"
            )

        # 2. Independently compute M_target using the raw sampling function and approved formula
        rng_indep = np.random.default_rng(42)
        raw_masses_indep = sample_bounded_power_law(
            rng=rng_indep,
            n=n_fragments,
            m_min=m_min,
            m_max=m_max,
            alpha=scenario.config.power_law_exponent,
        )
        raw_sum_indep = float(np.sum(raw_masses_indep))
        m_total_indep = parent_a.mass_kg + parent_b.mass_kg
        min_possible_mass = n_fragments * m_min
        preferred_cap = 0.90 * m_total_indep
        independent_m_target = max(min_possible_mass, min(raw_sum_indep, preferred_cap))

        # Compare sum of generated fragment masses against this independently calculated M_target
        actual_tracked_mass = sum(f.mass_kg for f in result.fragments)
        assert abs(actual_tracked_mass - independent_m_target) < MASS_CONSERVATION_TOLERANCE_KG
        assert (
            abs(result.metadata.tracked_fragment_mass_kg - independent_m_target)
            < MASS_CONSERVATION_TOLERANCE_KG
        )

        # 3. Verify no unintended clipping: all fragments received equal allocation
        # m_min + E_target / N without being clamped away from their analytical value
        first_mass = result.fragments[0].mass_kg
        for frag in result.fragments:
            assert abs(frag.mass_kg - first_mass) < 1e-18

    def test_mass_conservation_within_tolerance(self, base_collision_scenario: CollisionScenario):
        """Verify mass accounting: M_tracked + M_residual == M_total within 1e-9 kg."""
        result = generate_fragments(base_collision_scenario)
        meta = result.metadata

        m_total = (
            base_collision_scenario.parent_a.mass_kg + base_collision_scenario.parent_b.mass_kg
        )
        assert abs(meta.total_parent_mass_kg - m_total) < 1e-9

        accounted = meta.tracked_fragment_mass_kg + meta.residual_mass_kg
        discrepancy = abs(accounted - m_total)
        assert discrepancy < MASS_CONSERVATION_TOLERANCE_KG

        # Verify individual fragment mass bounds
        min_m = base_collision_scenario.config.min_fragment_mass_kg
        max_m = base_collision_scenario.config.max_fragment_mass_kg
        for frag in result.fragments:
            assert min_m <= frag.mass_kg <= max_m


class TestKinematicsAndConservation:
    def test_tracked_momentum_zero_drift(self, base_collision_scenario: CollisionScenario):
        """Verify tracked ensemble ejection momentum sum is numerically zero (< 1e-7 kg*km/s)."""
        result = generate_fragments(base_collision_scenario)

        ejection_momentum = np.zeros(3, dtype=float)
        for frag in result.fragments:
            dv = np.array(frag.ejection_vector_kms, dtype=float)
            ejection_momentum += frag.mass_kg * dv

        residual_norm = float(np.linalg.norm(ejection_momentum))
        assert residual_norm < MOMENTUM_CONSERVATION_TOLERANCE_KG_KMS

    def test_total_system_momentum_conservation(self, base_collision_scenario: CollisionScenario):
        """Verify total system linear momentum is conserved within 1e-7 kg*km/s."""
        result = generate_fragments(base_collision_scenario)
        meta = result.metadata

        # Initial total momentum
        pa = base_collision_scenario.parent_a.mass_kg * np.array(
            base_collision_scenario.parent_a.velocity_kms
        )
        pb = base_collision_scenario.parent_b.mass_kg * np.array(
            base_collision_scenario.parent_b.velocity_kms
        )
        p_initial = pa + pb

        # Tracked momentum
        p_tracked = np.zeros(3, dtype=float)
        for frag in result.fragments:
            p_tracked += frag.mass_kg * np.array(frag.velocity_kms)

        # Residual momentum under simplifying model assumption (bulk at v_cm)
        v_cm = np.array(meta.center_of_mass_velocity_kms)
        p_residual = meta.residual_mass_kg * v_cm

        p_final = p_tracked + p_residual
        momentum_error = float(np.linalg.norm(p_initial - p_final))

        assert momentum_error < MOMENTUM_CONSERVATION_TOLERANCE_KG_KMS
        assert meta.momentum_residual_kg_kms < MOMENTUM_CONSERVATION_TOLERANCE_KG_KMS

    def test_max_velocity_ceiling_preserved(self, base_collision_scenario: CollisionScenario):
        """Verify all fragments strictly respect max_delta_v_kms ceiling."""
        result = generate_fragments(base_collision_scenario)
        max_ceiling = base_collision_scenario.config.max_delta_v_kms

        for frag in result.fragments:
            assert frag.delta_v_kms <= max_ceiling + 1e-9
            speed_from_vec = float(np.linalg.norm(frag.ejection_vector_kms))
            assert speed_from_vec <= max_ceiling + 1e-9

    def test_kinetic_energy_not_conserved(self, base_collision_scenario: CollisionScenario):
        """Verify kinetic energy is not conserved (Delta E_k != 0) between parents and fragments."""
        result = generate_fragments(base_collision_scenario)
        pa = base_collision_scenario.parent_a
        pb = base_collision_scenario.parent_b

        ke_initial = 0.5 * pa.mass_kg * float(
            np.dot(pa.velocity_kms, pa.velocity_kms)
        ) + 0.5 * pb.mass_kg * float(np.dot(pb.velocity_kms, pb.velocity_kms))

        ke_tracked = sum(
            0.5 * frag.mass_kg * float(np.dot(frag.velocity_kms, frag.velocity_kms))
            for frag in result.fragments
        )
        v_cm = result.metadata.center_of_mass_velocity_kms
        ke_residual = 0.5 * result.metadata.residual_mass_kg * float(np.dot(v_cm, v_cm))
        ke_final = ke_tracked + ke_residual

        # Breakup does not conserve kinetic energy (dissipation & ejection alter total KE)
        ke_discrepancy = abs(ke_final - ke_initial)
        assert ke_discrepancy > 1.0  # Demonstrable energy non-conservation (MJ)


class TestReproducibilityAndProvenance:
    def test_seed_reproducibility(self, base_collision_scenario: CollisionScenario):
        """Verify bitwise identical fragments with identical seed, distinct with different seed."""
        res_a = generate_fragments(base_collision_scenario)
        res_b = generate_fragments(base_collision_scenario)

        assert len(res_a.fragments) == len(res_b.fragments)
        for fa, fb in zip(res_a.fragments, res_b.fragments):
            assert fa.fragment_id == fb.fragment_id
            assert fa.mass_kg == fb.mass_kg
            assert fa.position_km == fb.position_km
            assert fa.velocity_kms == fb.velocity_kms
            assert fa.ejection_vector_kms == fb.ejection_vector_kms

        # Different seed
        scenario_other = base_collision_scenario.model_copy(deep=True)
        scenario_other.config.seed = 999
        res_other = generate_fragments(scenario_other)
        assert res_a.fragments[0].velocity_kms != res_other.fragments[0].velocity_kms

    def test_combined_source_attribution(self, base_collision_scenario: CollisionScenario):
        """Verify all fragments have source_parent_id='COMBINED' and parents are in metadata."""
        result = generate_fragments(base_collision_scenario)
        for frag in result.fragments:
            assert frag.source_parent_id == "COMBINED"
            assert frag.is_synthetic is True

        assert result.metadata.parent_a_id == "ISS"
        assert result.metadata.parent_b_id == "COSMOS-2251-DEB"
        assert result.metadata.model_name == MODEL_NAME
        assert result.metadata.fidelity_disclaimer == SIMULATION_DISCLAIMER

    def test_state_vector_record_converter(self, base_collision_scenario: CollisionScenario):
        """Verify domain fragment conversion to StateVectorRecord."""
        result = generate_fragments(base_collision_scenario)
        frag = result.fragments[0]

        record = fragment_to_state_vector(frag)
        assert record.norad_cat_id is None
        assert record.object_id == frag.fragment_id
        assert record.object_name == f"Synthetic Fragment {frag.fragment_id}"
        assert record.epoch == frag.epoch
        assert record.frame == "GCRS"
        assert record.position_km == frag.position_km
        assert record.velocity_kms == frag.velocity_kms
        assert record.status == "OK"
        assert record.sgp4_error_code == 0

        # Batch converter
        records = fragments_to_state_vectors(result.fragments[:10])
        assert len(records) == 10
        assert all(r.norad_cat_id is None for r in records)
        assert all(r.frame == "GCRS" for r in records)


class TestConfigBoundsValidation:
    def test_max_less_than_min_mass_rejected(self):
        """Verify max_fragment_mass_kg < min_fragment_mass_kg raises ValidationError."""
        with pytest.raises(ValidationError, match="cannot be less than min_fragment_mass_kg"):
            FragmentationConfig(min_fragment_mass_kg=5.0, max_fragment_mass_kg=1.0)

    def test_fragment_count_bounds(self):
        """Verify fragment_count ge=1 and le=5000 bounds."""
        with pytest.raises(ValidationError):
            FragmentationConfig(fragment_count=0)

        with pytest.raises(ValidationError):
            FragmentationConfig(fragment_count=10000)
