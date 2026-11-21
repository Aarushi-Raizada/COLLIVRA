/**
 * COLLIVRA Active Debris Remediation & Simulation TypeScript API Contracts
 *
 * Strict TypeScript mirror of FastAPI Pydantic v2 domain schemas defined in:
 * packages/simulation/simulation/schemas.py
 *
 * Standard Astrodynamical Units & Constraints:
 * - Position: kilometers (km) in GCRS (inertial)
 * - Velocity: kilometers per second (km/s) in GCRS (inertial)
 * - Impulsive Delta-V: meters per second (m/s) in CW Hill frame [radial, along-track, cross-track]
 * - Total Delta-V Budget: meters per second (m/s)
 * - Mass: kilograms (kg)
 * - Timestamps: ISO 8601 UTC strings
 * - Relative Orbit Limits: Near-circular CW reference orbit (e <= 0.005, rp > 6478.137 km)
 * - Synthetic Provenance: Strictly labeled with is_synthetic = true
 */

// ============================================================================
// Enums & Literal Discriminators
// ============================================================================

export type TargetingMode = "STANDOFF_HOLD" | "CONTACT_INTERCEPT";

export type TrajectoryStatus = "SUCCESS" | "PARTIAL" | "FAILED";

export type TerminationReason =
  | "COMPLETED"
  | "ATMOSPHERIC_INTERFACE"
  | "NUMERICAL_FAILURE"
  | "INVALID_INITIAL_STATE";

export type IntegratorMethod = "DOP853";

// ============================================================================
// Day 8: Synthetic Fragmentation Models
// ============================================================================

export interface FragmentationConfig {
  fragment_count?: number;
  min_fragment_mass_kg?: number;
  max_fragment_mass_kg?: number;
  v_median_kms?: number;
  v_sigma?: number;
  max_delta_v_kms?: number;
  power_law_exponent?: number;
  seed?: number | null;
  identifier_prefix?: string;
}

export interface ParentBodyState {
  object_id: string;
  object_name?: string | null;
  mass_kg: number;
  position_km: [number, number, number];
  velocity_kms: [number, number, number];
}

export interface CollisionScenario {
  collision_epoch: string;
  frame?: "GCRS";
  collision_tolerance_km?: number;
  parent_a: ParentBodyState;
  parent_b: ParentBodyState;
  config?: FragmentationConfig;
}

export interface SyntheticFragmentRecord {
  fragment_id: string;
  source_parent_id: "COMBINED";
  epoch: string;
  frame: "GCRS";
  position_km: [number, number, number];
  velocity_kms: [number, number, number];
  mass_kg: number;
  delta_v_kms: number;
  ejection_vector_kms: [number, number, number];
  is_synthetic: true;
}

export interface FragmentationMetadata {
  model_name: string;
  fidelity_disclaimer: string;
  seed_used: number | null;
  parent_a_id: string;
  parent_b_id: string;
  total_parent_mass_kg: number;
  tracked_fragment_mass_kg: number;
  residual_mass_kg: number;
  tracked_fragment_count: number;
  center_of_mass_velocity_kms: [number, number, number];
  center_of_mass_position_km: [number, number, number];
  drift_velocity_removed_ms: number;
  momentum_residual_kg_kms: number;
}

export interface FragmentationResult {
  scenario: CollisionScenario;
  fragments: SyntheticFragmentRecord[];
  metadata: FragmentationMetadata;
}

// ============================================================================
// Day 9: Cowell/DOP853 Numerical Propagation Models
// ============================================================================

export interface NumericalPropagationConfig {
  duration_seconds?: number;
  step_seconds?: number;
  integrator?: IntegratorMethod;
  rtol?: number;
  atol_position_km?: number;
  atol_velocity_kms?: number;
  max_step_seconds?: number;
  max_points_per_trajectory?: number;
  max_batch_points?: number;
}

export interface TrajectoryPoint {
  epoch: string;
  position_km: [number, number, number];
  velocity_kms: [number, number, number];
}

export interface FragmentTrajectory {
  fragment_id: string;
  frame: "GCRS";
  position_unit: string;
  velocity_unit: string;
  points: TrajectoryPoint[];
  status: TrajectoryStatus;
  termination_reason: TerminationReason;
  mass_kg?: number | null;
  error_message?: string | null;
}

export interface FragmentPropagationSummary {
  total_fragments: number;
  completed_count: number;
  reentered_count: number;
  numerical_failure_count: number;
  invalid_state_count: number;
  duration_seconds: number;
  step_seconds: number;
  execution_wall_time_seconds: number;
  model_name: string;
  fidelity_disclaimer: string;
}

export interface FragmentTrajectoryBatch {
  scenario_epoch: string;
  frame: "GCRS";
  count: number;
  successful_count: number;
  failed_count: number;
  summary: FragmentPropagationSummary;
  trajectories: FragmentTrajectory[];
}

// ============================================================================
// Day 10: Clohessy-Wiltshire (CW) Relative Motion & Rendezvous Models
// ============================================================================

export interface RendezvousConfig {
  targeting_mode?: TargetingMode;
  standoff_distance_m?: number;
  delta_v_budget_max_ms?: number;
  transfer_time_s?: number;
  epoch_tolerance_s?: number;
  max_condition_number?: number;
  target_cross_check_position_tol_km?: number;
  target_cross_check_velocity_tol_kms?: number;
}

export interface RendezvousContract {
  target_id: string;
  chaser_id: string;
  target_is_synthetic?: boolean;
  target_epoch_utc: string;
  chaser_epoch_utc: string;
  target_gcrs_position_km: [number, number, number];
  target_gcrs_velocity_kms: [number, number, number];
  chaser_gcrs_position_km: [number, number, number];
  chaser_gcrs_velocity_kms: [number, number, number];
}

export interface RendezvousResult {
  burn_1_dv_cw_ms: [number, number, number];
  burn_2_dv_cw_ms: [number, number, number];
  total_delta_v_ms: number;
  transfer_time_s: number;
  is_mathematically_solvable: boolean;
  is_budget_feasible?: boolean | null;
  is_feasible: boolean;
  terminal_position_residual_km: [number, number, number];
  terminal_position_error_m: number;
  terminal_velocity_residual_kms: [number, number, number];
  terminal_velocity_error_ms: number;
  condition_number: number;
  epoch_synchronization_applied?: boolean;
  scientific_disclaimer?: string;
}

// ============================================================================
// Day 11: Top-Level Integration Request & Response Contracts
// ============================================================================

export interface BreakupAndPropagateRequest {
  scenario: CollisionScenario;
  propagation_config?: NumericalPropagationConfig;
}

export interface BreakupAndPropagateResponse {
  fragmentation: FragmentationResult;
  trajectories: FragmentTrajectoryBatch;
}

export interface BreakupRemediationRequest {
  scenario: CollisionScenario;
  chaser_id: string;
  chaser_epoch_utc: string;
  chaser_gcrs_position_km: [number, number, number];
  chaser_gcrs_velocity_kms: [number, number, number];
  target_epoch_utc?: string | null;
  propagation_config?: NumericalPropagationConfig;
  rendezvous_config?: RendezvousConfig;
  max_target_eccentricity?: number;
  min_target_perigee_km?: number;
}

export interface BreakupRemediationResponse {
  fragmentation: FragmentationResult;
  trajectories_summary: FragmentPropagationSummary;
  selected_target: SyntheticFragmentRecord;
  contract: RendezvousContract;
  rendezvous: RendezvousResult;
  execution_wall_time_s: number;
  scientific_disclaimer: string;
}

