/**
 * COLLIVRA Simulation & Remediation Presets and Request Factories
 *
 * Provides calibrated, scientifically validated presets for:
 * 1. Low Earth Orbit (LEO) co-orbital synthetic collision fragmentation and DOP853 propagation.
 * 2. Clohessy-Wiltshire (CW) debris remediation burn planning (feasible and budget-infeasible variants).
 *
 * Frame & Units:
 * - Physical positions: kilometers (km) in GCRS (inertial).
 * - Physical velocities: kilometers per second (km/s) in GCRS (inertial).
 * - Impulsive Delta-V: meters per second (m/s) in CW Hill frame [radial, along-track, cross-track].
 * - Masses: kilograms (kg).
 * - Reference Orbit Limits: Near-circular CW reference orbit (e <= 0.005, rp > 6478.137 km).
 */

import {
  BreakupAndPropagateRequest,
  BreakupRemediationRequest,
  CollisionScenario,
  FragmentationConfig,
  NumericalPropagationConfig,
  RendezvousConfig,
} from "@/types/simulation";

/**
 * Standard co-orbital proximity collision scenario at 7,200 km geocentric radius (~822 km altitude).
 * Parent bodies have 500 kg mass and are separated by 50 meters (<= 100 m limit).
 * Low maximum ejection delta-v (2 m/s = 0.002 km/s) ensures fragments remain in near-circular orbits (e < 0.005)
 * compatible with the Clohessy-Wiltshire linearized relative motion equations.
 */
export const DEFAULT_COLLISION_SCENARIO: CollisionScenario = {
  collision_epoch: "2026-11-04T12:00:00.000Z",
  frame: "GCRS",
  collision_tolerance_km: 0.1,
  parent_a: {
    object_id: "SAT-ALPHA",
    object_name: "Satellite Alpha (Cosmos-2251 Analog)",
    mass_kg: 500.0,
    position_km: [7200.0, 0.0, 0.0],
    velocity_kms: [0.0, 7.4405, 0.001],
  },
  parent_b: {
    object_id: "SAT-BETA",
    object_name: "Satellite Beta (Iridium-33 Analog)",
    mass_kg: 500.0,
    position_km: [7200.0, 0.05, 0.0],
    velocity_kms: [0.0, 7.4405, -0.001],
  },
  config: {
    fragment_count: 10,
    min_fragment_mass_kg: 1.0,
    max_fragment_mass_kg: 20.0,
    v_median_kms: 0.001,
    v_sigma: 0.5,
    max_delta_v_kms: 0.002,
    power_law_exponent: 1.5,
    seed: 42,
    identifier_prefix: "SYNTH-FRAG",
  },
};

/** Default DOP853 numerical propagation config for rapid frontend visualization */
export const DEFAULT_PROPAGATION_CONFIG: NumericalPropagationConfig = {
  duration_seconds: 60.0,
  step_seconds: 10.0,
  integrator: "DOP853",
  rtol: 1e-9,
  atol_position_km: 1e-6,
  atol_velocity_kms: 1e-9,
};

/** Default Active Debris Removal (ADR) chaser spacecraft state in co-orbital pursuit */
export const DEFAULT_CHASER_STATE = {
  chaser_id: "CHASER-01",
  chaser_epoch_utc: "2026-11-04T12:00:00.000Z",
  chaser_gcrs_position_km: [7200.0, 0.1, 0.0] as [number, number, number],
  chaser_gcrs_velocity_kms: [0.0, 7.4405, 0.0] as [number, number, number],
};

/** Default nominal Clohessy-Wiltshire rendezvous planning configuration (feasible) */
export const DEFAULT_RENDEZVOUS_CONFIG: RendezvousConfig = {
  targeting_mode: "STANDOFF_HOLD",
  standoff_distance_m: 50.0,
  delta_v_budget_max_ms: 25.0,
  transfer_time_s: 120.0,
  epoch_tolerance_s: 1.0,
  max_condition_number: 100000000.0,
};

/** Budget-infeasible rendezvous configuration: mathematically solvable, but exceeds low Delta-V limit */
export const BUDGET_INFEASIBLE_RENDEZVOUS_CONFIG: RendezvousConfig = {
  targeting_mode: "STANDOFF_HOLD",
  standoff_distance_m: 50.0,
  delta_v_budget_max_ms: 0.005, // 5 mm/s budget guarantees budget infeasibility while maintaining mathematical solvability
  transfer_time_s: 120.0,
  epoch_tolerance_s: 1.0,
  max_condition_number: 100000000.0,
};

/** Factory for valid BreakupAndPropagateRequest */
export function createDefaultBreakupRequest(
  overrides?: Partial<BreakupAndPropagateRequest>
): BreakupAndPropagateRequest {
  return {
    scenario: {
      ...DEFAULT_COLLISION_SCENARIO,
      ...(overrides?.scenario || {}),
      parent_a: {
        ...DEFAULT_COLLISION_SCENARIO.parent_a,
        ...(overrides?.scenario?.parent_a || {}),
      },
      parent_b: {
        ...DEFAULT_COLLISION_SCENARIO.parent_b,
        ...(overrides?.scenario?.parent_b || {}),
      },
      config: {
        ...DEFAULT_COLLISION_SCENARIO.config,
        ...(overrides?.scenario?.config || {}),
      },
    },
    propagation_config: {
      ...DEFAULT_PROPAGATION_CONFIG,
      ...(overrides?.propagation_config || {}),
    },
  };
}

/** Factory for valid BreakupRemediationRequest (Nominal / Feasible) */
export function createDefaultRemediationRequest(
  overrides?: Partial<BreakupRemediationRequest>
): BreakupRemediationRequest {
  return {
    scenario: {
      ...DEFAULT_COLLISION_SCENARIO,
      ...(overrides?.scenario || {}),
      parent_a: {
        ...DEFAULT_COLLISION_SCENARIO.parent_a,
        ...(overrides?.scenario?.parent_a || {}),
      },
      parent_b: {
        ...DEFAULT_COLLISION_SCENARIO.parent_b,
        ...(overrides?.scenario?.parent_b || {}),
      },
      config: {
        ...DEFAULT_COLLISION_SCENARIO.config,
        ...(overrides?.scenario?.config || {}),
      },
    },
    chaser_id: overrides?.chaser_id || DEFAULT_CHASER_STATE.chaser_id,
    chaser_epoch_utc: overrides?.chaser_epoch_utc || DEFAULT_CHASER_STATE.chaser_epoch_utc,
    chaser_gcrs_position_km: overrides?.chaser_gcrs_position_km || [
      ...DEFAULT_CHASER_STATE.chaser_gcrs_position_km,
    ],
    chaser_gcrs_velocity_kms: overrides?.chaser_gcrs_velocity_kms || [
      ...DEFAULT_CHASER_STATE.chaser_gcrs_velocity_kms,
    ],
    target_epoch_utc: overrides?.target_epoch_utc ?? null,
    propagation_config: {
      ...DEFAULT_PROPAGATION_CONFIG,
      duration_seconds: 120.0,
      step_seconds: 10.0,
      ...(overrides?.propagation_config || {}),
    },
    rendezvous_config: {
      ...DEFAULT_RENDEZVOUS_CONFIG,
      ...(overrides?.rendezvous_config || {}),
    },
    max_target_eccentricity: overrides?.max_target_eccentricity ?? 0.005,
    min_target_perigee_km: overrides?.min_target_perigee_km ?? 6478.137,
  };
}

/** Factory for Budget-Infeasible BreakupRemediationRequest */
export function createBudgetInfeasibleRemediationRequest(
  overrides?: Partial<BreakupRemediationRequest>
): BreakupRemediationRequest {
  return createDefaultRemediationRequest({
    ...overrides,
    rendezvous_config: {
      ...BUDGET_INFEASIBLE_RENDEZVOUS_CONFIG,
      ...(overrides?.rendezvous_config || {}),
    },
  });
}

