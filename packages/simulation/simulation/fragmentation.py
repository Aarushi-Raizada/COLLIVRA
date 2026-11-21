"""
Synthetic collision fragmentation engine for ZORBIT.

Implements a simplified synthetic fragmentation model generating reproducible,
mass- and momentum-conserved synthetic debris clouds from orbital collision scenarios.
"""

from math import log, pi

import numpy as np

from .constants import (
    DEFAULT_MASS_ALLOCATION_FRACTION,
    DEFAULT_POWER_LAW_EXPONENT,
    MODEL_NAME,
    NUMERICAL_ZERO_TOLERANCE_MASS_KG,
    SIMULATION_DISCLAIMER,
)
from .schemas import (
    CollisionScenario,
    FragmentationMetadata,
    FragmentationResult,
    SyntheticFragmentRecord,
)


def sample_bounded_power_law(
    rng: np.random.Generator,
    n: int,
    m_min: float,
    m_max: float,
    alpha: float = DEFAULT_POWER_LAW_EXPONENT,
) -> np.ndarray:
    """
    Sample N masses from a bounded power-law probability density function:
    f(m) ~ m^(-alpha), for m in [m_min, m_max].

    Uses the closed-form inverse cumulative distribution function (CDF):
    m(u) = [ m_min^(1-alpha) + u * (m_max^(1-alpha) - m_min^(1-alpha)) ] ^ (1 / (1-alpha))
    """
    u = rng.uniform(0.0, 1.0, size=n)
    if abs(alpha - 1.0) < 1e-9:
        # Special case alpha = 1.0: f(m) ~ 1/m yields log-uniform distribution
        return m_min * (m_max / m_min) ** u

    p = 1.0 - alpha
    inv_p = 1.0 / p
    m_min_p = m_min**p
    m_max_p = m_max**p
    return (m_min_p + u * (m_max_p - m_min_p)) ** inv_p


def sample_log_normal_speeds(
    rng: np.random.Generator,
    n: int,
    v_median_kms: float,
    v_sigma: float,
    max_delta_v_kms: float,
) -> np.ndarray:
    """
    Sample N ejection speed magnitudes from a Log-Normal distribution:
    X ~ Normal(mu, sigma^2), where mu = ln(v_median_kms).
    Speeds are capped at max_delta_v_kms.
    """
    mu = log(v_median_kms)
    raw_speeds = np.exp(rng.normal(loc=mu, scale=v_sigma, size=n))
    return np.minimum(raw_speeds, max_delta_v_kms)


def sample_isotropic_directions(
    rng: np.random.Generator,
    n: int,
) -> np.ndarray:
    """
    Sample N uniformly distributed unit vectors on the 2-sphere S^2
    using Marsaglia's sphere picking method.
    """
    z = rng.uniform(-1.0, 1.0, size=n)
    phi = rng.uniform(0.0, 2.0 * pi, size=n)
    r_perp = np.sqrt(np.maximum(0.0, 1.0 - z**2))
    x = r_perp * np.cos(phi)
    y = r_perp * np.sin(phi)
    return np.column_stack((x, y, z))


def generate_fragments(scenario: CollisionScenario) -> FragmentationResult:
    """
    Generate reproducible synthetic debris fragments from a two-body collision scenario.

    Adheres strictly to ZORBIT AGENTS.md Section 3.3 and Day 8 Phase 1 specification:
    - Authoritative inertial frame: GCRS.
    - Differential power-law mass distribution with bounded excess allocation.
    - Bounded Log-Normal ejection velocity distribution with isotropic orientation.
    - Mass-weighted drift cancellation ensuring zero net tracked ejection momentum.
    - Uniform ensemble ceiling rescaling preserving maximum ejection delta-V ceiling.
    - Linear momentum and mass accounting for both tracked ensemble and unmodeled residual.
    - Deterministic reproducibility when seeded.
    """
    config = scenario.config
    parent_a = scenario.parent_a
    parent_b = scenario.parent_b

    # 1. Total System Mass & Center-of-Mass Kinematics
    m_a = parent_a.mass_kg
    m_b = parent_b.mass_kg
    m_total = m_a + m_b

    r_a = np.array(parent_a.position_km, dtype=float)
    r_b = np.array(parent_b.position_km, dtype=float)
    v_a = np.array(parent_a.velocity_kms, dtype=float)
    v_b = np.array(parent_b.velocity_kms, dtype=float)

    # Initial system linear momentum and center-of-mass state
    p_total = m_a * v_a + m_b * v_b
    r_cm = (m_a * r_a + m_b * r_b) / m_total
    v_cm = p_total / m_total

    # 2. Feasibility Validation
    n_fragments = config.fragment_count
    m_min = config.min_fragment_mass_kg
    m_max = config.max_fragment_mass_kg

    min_possible_mass = n_fragments * m_min
    if min_possible_mass > m_total:
        raise ValueError(
            f"Infeasible mass allocation: N * min_fragment_mass_kg ({min_possible_mass:.4f} kg) "
            f"exceeds total parent mass ({m_total:.4f} kg)."
        )

    # 3. Seeded Random Number Generator
    rng = np.random.default_rng(config.seed)

    # 4. Mass Sampling and Bounded Allocation
    raw_masses = sample_bounded_power_law(
        rng=rng,
        n=n_fragments,
        m_min=m_min,
        m_max=m_max,
        alpha=config.power_law_exponent,
    )
    raw_mass_sum = float(np.sum(raw_masses))

    # Approved target mass formula: max(N * m_min, min(raw_sum, 0.90 * M_total))
    preferred_cap = DEFAULT_MASS_ALLOCATION_FRACTION * m_total
    m_target = max(min_possible_mass, min(raw_mass_sum, preferred_cap))

    # Excess mass distribution
    raw_excesses = raw_masses - m_min
    e_raw = float(np.sum(raw_excesses))
    e_target = m_target - min_possible_mass

    if e_raw > NUMERICAL_ZERO_TOLERANCE_MASS_KG:
        s = e_target / e_raw
        masses = m_min + s * raw_excesses
    else:
        # Near-zero excess numerical guard: distribute excess equally
        masses = np.full(n_fragments, m_min + (e_target / n_fragments), dtype=float)

    # Numerical clip to strict bounds to eliminate floating-point roundoff seepage
    masses = np.clip(masses, m_min, m_max)
    m_tracked = float(np.sum(masses))
    m_residual = max(0.0, m_total - m_tracked)

    # 5. Velocity Sampling: Log-Normal Magnitude & Isotropic Direction
    raw_speeds = sample_log_normal_speeds(
        rng=rng,
        n=n_fragments,
        v_median_kms=config.v_median_kms,
        v_sigma=config.v_sigma,
        max_delta_v_kms=config.max_delta_v_kms,
    )
    directions = sample_isotropic_directions(rng=rng, n=n_fragments)
    raw_ejection_vectors = raw_speeds[:, np.newaxis] * directions

    # 6. Mass-Weighted Drift Cancellation
    # Ensemble drift: delta_v_cm_raw = sum(m_i * delta_v_i) / sum(m_i)
    drift_vector = np.sum(masses[:, np.newaxis] * raw_ejection_vectors, axis=0) / m_tracked
    drift_removed_ms = float(np.linalg.norm(drift_vector) * 1000.0)

    # Subtract drift to guarantee zero net tracked ejection momentum
    stage1_ejections = raw_ejection_vectors - drift_vector
    stage1_speeds = np.linalg.norm(stage1_ejections, axis=1)
    v_peak = float(np.max(stage1_speeds))

    # 7. Uniform Ensemble Rescaling (Ceiling Protection)
    if v_peak > config.max_delta_v_kms:
        gamma = config.max_delta_v_kms / v_peak
        final_ejections = gamma * stage1_ejections
        final_speeds = gamma * stage1_speeds
    else:
        final_ejections = stage1_ejections
        final_speeds = stage1_speeds

    # 8. Final Fragment Kinematic States in GCRS
    # All fragments originate at collision position r_cm at collision_epoch
    fragment_velocities = v_cm + final_ejections

    # 9. Momentum Accounting & Numerical Verification Metrics
    p_tracked = np.sum(masses[:, np.newaxis] * fragment_velocities, axis=0)
    # Simplifying model assumption: residual cloud travels at bulk center-of-mass velocity
    p_residual = m_residual * v_cm
    p_system_after = p_tracked + p_residual
    momentum_residual_kg_kms = float(np.linalg.norm(p_total - p_system_after))

    # 10. Construct Domain Records
    prefix = config.identifier_prefix
    epoch = scenario.collision_epoch
    frame = scenario.frame

    fragments: list[SyntheticFragmentRecord] = []
    r_cm_tuple = (float(r_cm[0]), float(r_cm[1]), float(r_cm[2]))

    for i in range(n_fragments):
        frag_id = f"{prefix}-{i + 1:04d}"
        v_i = fragment_velocities[i]
        dv_i = final_ejections[i]

        fragments.append(
            SyntheticFragmentRecord(
                fragment_id=frag_id,
                source_parent_id="COMBINED",
                epoch=epoch,
                frame=frame,
                position_km=r_cm_tuple,
                velocity_kms=(float(v_i[0]), float(v_i[1]), float(v_i[2])),
                mass_kg=float(masses[i]),
                delta_v_kms=float(final_speeds[i]),
                ejection_vector_kms=(float(dv_i[0]), float(dv_i[1]), float(dv_i[2])),
                is_synthetic=True,
            )
        )

    metadata = FragmentationMetadata(
        model_name=MODEL_NAME,
        fidelity_disclaimer=SIMULATION_DISCLAIMER,
        seed_used=config.seed,
        parent_a_id=parent_a.object_id,
        parent_b_id=parent_b.object_id,
        total_parent_mass_kg=float(m_total),
        tracked_fragment_mass_kg=m_tracked,
        residual_mass_kg=m_residual,
        tracked_fragment_count=n_fragments,
        center_of_mass_velocity_kms=(float(v_cm[0]), float(v_cm[1]), float(v_cm[2])),
        center_of_mass_position_km=r_cm_tuple,
        drift_velocity_removed_ms=drift_removed_ms,
        momentum_residual_kg_kms=momentum_residual_kg_kms,
    )

    return FragmentationResult(
        scenario=scenario,
        fragments=fragments,
        metadata=metadata,
    )
