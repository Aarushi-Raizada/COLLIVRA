/**
 * COLLIVRA Precomputed Simulation & Remediation Demonstration Fixtures
 *
 * Provides scientifically consistent, type-safe demonstration fixtures for:
 * 1. Low Earth Orbit (LEO) synthetic breakup and DOP853 numerical propagation.
 * 2. Feasible Clohessy-Wiltshire (CW) two-impulse rendezvous planning.
 * 3. Budget-infeasible Clohessy-Wiltshire rendezvous planning.
 *
 * PROVENANCE & MODELING SPECIFICATION:
 * - Numerical metrics in these fixtures (e.g. momentum residual 1.24e-12 kg*km/s,
 *   CW condition number 142.8, terminal position error 0.025 m) are precomputed
 *   illustrative snapshots for offline UI demonstration, NOT measured live solver outputs.
 * - Zero net fragment ejection momentum is algorithmically enforced in the fragmentation
 *   model via mass-weighted ensemble drift subtraction (sum(m_i * dv_i) = 0). Observed
 *   residuals represent double-precision floating-point roundoff (IEEE 754 epsilon).
 * - All fragments carry strict synthetic provenance:
 *   - is_synthetic: true
 *   - identifier_prefix: "SYNTH-FRAG"
 *   - frame: "GCRS"
 */

import {
  BreakupAndPropagateResponse,
  BreakupRemediationResponse,
  SyntheticFragmentRecord,
  FragmentTrajectory,
} from "../types/simulation";
import { DEFAULT_COLLISION_SCENARIO } from "../lib/simulation_presets";

const BASE_EPOCH = "2026-11-04T12:00:00.000Z";
const R0 = 7200.0;
const V0 = 7.4405;

/** Generates realistic sample trajectory points in GCRS for a fragment */
function generateTrajectoryPoints(
  fragId: string,
  posOffset: [number, number, number],
  velOffset: [number, number, number],
  durationSec = 60,
  stepSec = 10
) {
  const points = [];
  const numSteps = Math.floor(durationSec / stepSec);
  const omega = V0 / R0; // approx orbital angular rate ~ 0.001033 rad/s

  for (let i = 0; i <= numSteps; i++) {
    const t = i * stepSec;
    const angle = omega * t;
    const epochDate = new Date(new Date(BASE_EPOCH).getTime() + t * 1000).toISOString();

    const x = (R0 + posOffset[0]) * Math.cos(angle) - posOffset[1] * Math.sin(angle);
    const y = (R0 + posOffset[0]) * Math.sin(angle) + (V0 + posOffset[1]) * Math.cos(angle) * (t / 1000);
    const z = posOffset[2] + velOffset[2] * t;

    const vx = -V0 * Math.sin(angle) + velOffset[0];
    const vy = V0 * Math.cos(angle) + velOffset[1];
    const vz = velOffset[2];

    points.push({
      epoch: epochDate,
      position_km: [parseFloat(x.toFixed(3)), parseFloat(y.toFixed(3)), parseFloat(z.toFixed(3))] as [number, number, number],
      velocity_kms: [parseFloat(vx.toFixed(5)), parseFloat(vy.toFixed(5)), parseFloat(vz.toFixed(5))] as [number, number, number],
    });
  }
  return points;
}

const DEMO_FRAGMENTS_DATA: {
  id: string;
  mass: number;
  dv: number;
  pos: [number, number, number];
  vel: [number, number, number];
}[] = [
  { id: "SYNTH-FRAG-001", mass: 24.85, dv: 0.00085, pos: [7200.012, 0.021, 0.005], vel: [-0.0001, 7.4406, 0.0004] },
  { id: "SYNTH-FRAG-002", mass: 18.32, dv: 0.00112, pos: [7199.985, -0.018, -0.004], vel: [0.0002, 7.4403, -0.0005] },
  { id: "SYNTH-FRAG-003", mass: 14.50, dv: 0.00135, pos: [7200.035, 0.042, 0.008], vel: [-0.0003, 7.4407, 0.0007] },
  { id: "SYNTH-FRAG-004", mass: 11.20, dv: 0.00148, pos: [7199.960, -0.035, -0.007], vel: [0.0004, 7.4402, -0.0008] },
  { id: "SYNTH-FRAG-005", mass: 8.75, dv: 0.00162, pos: [7200.052, 0.058, 0.011], vel: [-0.0005, 7.4408, 0.0009] },
  { id: "SYNTH-FRAG-006", mass: 6.40, dv: 0.00175, pos: [7199.940, -0.052, -0.010], vel: [0.0005, 7.4401, -0.0011] },
  { id: "SYNTH-FRAG-007", mass: 4.80, dv: 0.00184, pos: [7200.068, 0.071, 0.013], vel: [-0.0006, 7.4409, 0.0012] },
  { id: "SYNTH-FRAG-008", mass: 3.50, dv: 0.00191, pos: [7199.922, -0.068, -0.012], vel: [0.0006, 7.4400, -0.0013] },
  { id: "SYNTH-FRAG-009", mass: 2.30, dv: 0.00196, pos: [7200.081, 0.084, 0.015], vel: [-0.0007, 7.4410, 0.0014] },
  { id: "SYNTH-FRAG-010", mass: 1.45, dv: 0.00199, pos: [7199.905, -0.080, -0.014], vel: [0.0007, 7.4399, -0.0015] },
];

const DEMO_FRAGMENTS: SyntheticFragmentRecord[] = DEMO_FRAGMENTS_DATA.map((f) => ({
  fragment_id: f.id,
  source_parent_id: "COMBINED",
  epoch: BASE_EPOCH,
  frame: "GCRS",
  position_km: f.pos,
  velocity_kms: f.vel,
  mass_kg: f.mass,
  delta_v_kms: f.dv,
  ejection_vector_kms: [
    f.vel[0] - DEFAULT_COLLISION_SCENARIO.parent_a.velocity_kms[0],
    f.vel[1] - DEFAULT_COLLISION_SCENARIO.parent_a.velocity_kms[1],
    f.vel[2] - DEFAULT_COLLISION_SCENARIO.parent_a.velocity_kms[2],
  ],
  is_synthetic: true,
}));

const DEMO_TRAJECTORIES: FragmentTrajectory[] = DEMO_FRAGMENTS_DATA.map((f, idx) => ({
  fragment_id: f.id,
  frame: "GCRS",
  position_unit: "km",
  velocity_unit: "km/s",
  points: generateTrajectoryPoints(
    f.id,
    [f.pos[0] - R0, f.pos[1], f.pos[2]],
    [f.vel[0], f.vel[1] - V0, f.vel[2]],
    60,
    10
  ),
  status: "SUCCESS",
  termination_reason: "COMPLETED",
  mass_kg: f.mass,
  error_message: null,
}));

export const DEMO_BREAKUP_RESPONSE: BreakupAndPropagateResponse = {
  fragmentation: {
    scenario: DEFAULT_COLLISION_SCENARIO,
    fragments: DEMO_FRAGMENTS,
    metadata: {
      model_name: "ZORBIT Simplified Synthetic Fragmentation Model",
      fidelity_disclaimer:
        "SIMPLIFIED SYNTHETIC MODEL: Precomputed illustrative scenario for offline demonstration. Simulated using isotropic power-law fragment mass partitioning and max ejection delta-v bounds (2 m/s). Zero net fragment ejection momentum is algorithmically enforced via mass-weighted ensemble drift subtraction; numerical residuals represent floating-point roundoff, not independent physical proof. It does not represent full NASA Standard Breakup Model fidelity.",
      seed_used: 42,
      parent_a_id: "SAT-ALPHA",
      parent_b_id: "SAT-BETA",
      total_parent_mass_kg: 1000.0,
      tracked_fragment_mass_kg: 96.07,
      residual_mass_kg: 903.93,
      tracked_fragment_count: 10,
      center_of_mass_velocity_kms: [0.0, 7.4405, 0.0],
      center_of_mass_position_km: [7200.0, 0.025, 0.0],
      drift_velocity_removed_ms: 0.0,
      momentum_residual_kg_kms: 1.24e-12,
    },
  },
  trajectories: {
    scenario_epoch: BASE_EPOCH,
    frame: "GCRS",
    count: 10,
    successful_count: 10,
    failed_count: 0,
    summary: {
      total_fragments: 10,
      completed_count: 10,
      reentered_count: 0,
      numerical_failure_count: 0,
      invalid_state_count: 0,
      duration_seconds: 60.0,
      step_seconds: 10.0,
      execution_wall_time_seconds: 0.048,
      model_name: "Cowell Numerical Propagator (DOP853 J2)",
      fidelity_disclaimer:
        "Numerical batch propagation using SciPy DOP853 in GCRS with Earth two-body gravity and J2 oblateness harmonic.",
    },
    trajectories: DEMO_TRAJECTORIES,
  },
};

export const DEMO_REMEDIATION_RESPONSE: BreakupRemediationResponse = {
  fragmentation: DEMO_BREAKUP_RESPONSE.fragmentation,
  trajectories_summary: DEMO_BREAKUP_RESPONSE.trajectories.summary,
  selected_target: DEMO_FRAGMENTS[0], // SYNTH-FRAG-001 (highest mass: 24.85 kg)
  contract: {
    target_id: "SYNTH-FRAG-001",
    chaser_id: "CHASER-01",
    target_is_synthetic: true,
    target_epoch_utc: BASE_EPOCH,
    chaser_epoch_utc: BASE_EPOCH,
    target_gcrs_position_km: DEMO_FRAGMENTS[0].position_km,
    target_gcrs_velocity_kms: DEMO_FRAGMENTS[0].velocity_kms,
    chaser_gcrs_position_km: [7200.0, 0.1, 0.0],
    chaser_gcrs_velocity_kms: [0.0, 7.4405, 0.0],
  },
  rendezvous: {
    burn_1_dv_cw_ms: [-3.421, 5.184, 0.812],
    burn_2_dv_cw_ms: [2.105, -4.892, -0.654],
    total_delta_v_ms: 11.630,
    transfer_time_s: 120.0,
    is_mathematically_solvable: true,
    is_budget_feasible: true,
    is_feasible: true,
    terminal_position_residual_km: [0.000012, 0.000021, -0.000008],
    terminal_position_error_m: 0.025,
    terminal_velocity_residual_kms: [0.000001, -0.000002, 0.000001],
    terminal_velocity_error_ms: 0.0024,
    condition_number: 142.8,
    epoch_synchronization_applied: true,
    scientific_disclaimer:
      "Clohessy-Wiltshire (Hill's) equations assume a linearized gravity field in a near-circular reference orbit (e < 0.005). Impulsive burns are modeled as instantaneous velocity increments in the Hill frame without accounting for non-spherical Earth oblateness (J2), atmospheric drag, solar radiation pressure, attitude slew dynamics, or finite burn duration.",
  },
  execution_wall_time_s: 0.038,
  scientific_disclaimer:
    "Clohessy-Wiltshire (Hill's) equations assume a linearized gravity field in a near-circular reference orbit (e < 0.005). Precomputed illustrative scenario for offline preview (condition number and terminal error are illustrative fixture values, not live backend outputs). Impulsive burns are modeled as instantaneous velocity increments in the Hill frame without accounting for non-spherical Earth oblateness (J2), atmospheric drag, solar radiation pressure, attitude slew dynamics, or finite burn duration.",
};

export const DEMO_INFEASIBLE_REMEDIATION_RESPONSE: BreakupRemediationResponse = {
  ...DEMO_REMEDIATION_RESPONSE,
  rendezvous: {
    ...DEMO_REMEDIATION_RESPONSE.rendezvous,
    is_budget_feasible: false,
    is_feasible: false,
  },
};

