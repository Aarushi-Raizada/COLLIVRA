/**
 * COLLIVRA Orbital Intelligence Platform - Frontend TypeScript API Contracts
 *
 * Strict TypeScript mirror of FastAPI Pydantic v2 domain schemas defined in:
 * packages/orbital_core/orbital_core/schemas.py
 *
 * Standard Units:
 * - Position: kilometers (km) in GCRS
 * - Velocity: kilometers per second (km/s) in GCRS
 * - Distance: kilometers (km)
 * - Risk Score: [0.0 - 100.0] (Heuristic triage index, NOT a probability Pc)
 * - Timestamps: ISO 8601 UTC strings
 */

export type CoordinateFrame = "TEME" | "GCRF" | "GCRS" | "ITRF" | "ITRS" | "RIC_LVLH";

export type ScreeningCategory = "CRITICAL" | "HIGH" | "MODERATE" | "LOW";

export type RiskCategory = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "NEGLIGIBLE";

export type DataQualityLevel = "COMPLETE" | "INCOMPLETE";

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  offline_mode: boolean;
  iers_mode?: "OFFLINE_PREDICTIVE" | "OFFLINE_STRICT" | string;
}

export type EarthOrientationDataSource =
  | "DEFINITIVE"
  | "RAPID"
  | "PREDICTIVE_FRESH"
  | "PREDICTIVE_STALE"
  | "OUT_OF_RANGE"
  | "HISTORICAL_FALLBACK"
  | "UNAVAILABLE";

export type EarthOrientationProvenanceTier =
  | "OBSERVED_EOP"
  | "FORWARD_PREDICTION"
  | "UNMAINTAINED_PREDICTION"
  | "BOUNDARY_FALLBACK"
  | "HISTORICAL_FALLBACK"
  | "UNCALIBRATED_FALLBACK";

export interface EarthOrientationQuality {
  data_source: EarthOrientationDataSource;
  is_degraded: boolean;
  provenance_tier: EarthOrientationProvenanceTier;
  prediction_horizon_days: number | null;
  table_publication_age_days: number | null;
  local_cache_age_days: number | null;
  ut1_status: number;
  pm_status: number;
  earth_orientation_disclaimer: string;
}

export interface EarthOrientationPolicyViolationPayload {
  code: "EARTH_ORIENTATION_POLICY_VIOLATION";
  detail: string;
  epoch: string | null;
  data_source: string;
  details?: Record<string, unknown>;
}

export interface OrbitalObjectRecord {
  norad_cat_id: string;
  object_name: string;
  object_id: string;
  classification_type: string;
  epoch: string;
  mean_motion: number;
  eccentricity: number;
  inclination: number;
  ra_of_asc_node: number;
  arg_of_pericenter: number;
  mean_anomaly: number;
  bstar: number;
  mean_motion_dot: number;
  mean_motion_ddot: number;
  semi_major_axis_km: number;
  period_minutes: number;
  periapsis_altitude_km: number;
  apoapsis_altitude_km: number;
  is_synthetic?: boolean;
  data_source?: "LIVE" | "CACHE" | "OFFLINE_FIXTURE";
  retrieved_at?: string;
  raw_omm?: Record<string, unknown>;
}

export interface ConjunctionEvent {
  event_id: string;
  object_1_id: string;
  object_1_name: string | null;
  object_2_id: string;
  object_2_name: string | null;
  tca: string;
  miss_distance_km: number;
  relative_position_km: [number, number, number];
  relative_velocity_kms: [number, number, number];
  relative_speed_kms: number;
  category: ScreeningCategory;
  screening_threshold_km: number;
  frame: CoordinateFrame;
  step_seconds: number;
  method?: string;
  disclaimer?: string;
  is_synthetic?: boolean;
  object_1_is_synthetic?: boolean;
  object_2_is_synthetic?: boolean;
}

export interface ConjunctionScreeningSummary {
  total_objects: number;
  total_pairs_considered: number;
  total_events: number;
  critical_count: number;
  high_count: number;
  moderate_count: number;
  low_count: number;
  start_time: string;
  end_time: string;
  step_seconds: number;
  threshold_km: number;
  target_frame: CoordinateFrame;
  processed_at: string;
  execution_time_seconds: number;
  failed_objects_count: number;
  resolved_objects_count: number;
  unresolved_norad_ids: number[];
}

export interface ConjunctionScreeningRequest {
  objects?: (OrbitalObjectRecord | Record<string, unknown>)[];
  norad_ids?: (string | number)[];
  start_time: string;
  end_time: string;
  step_seconds?: number;
  threshold_km?: number;
  target_frame?: CoordinateFrame;
  threshold_critical_km?: number;
  threshold_high_km?: number;
  threshold_moderate_km?: number;
}

export interface ConjunctionScreeningResponse {
  summary: ConjunctionScreeningSummary;
  events: ConjunctionEvent[];
  unresolved_norad_ids: number[];
  disclaimer: string;
  earth_orientation?: EarthOrientationQuality | null;
}

export interface RiskWeights {
  weight_distance: number;
  weight_speed: number;
  weight_time: number;
}

export interface RiskFactor {
  factor_name: string;
  raw_value: number;
  raw_units: string;
  normalized_value: number;
  weight: number;
  contribution: number;
  description: string;
}

export interface RiskAssessment {
  event_id: string;
  primary_object_id: string;
  primary_object_name: string | null;
  secondary_object_id: string;
  secondary_object_name: string | null;
  tca: string;
  miss_distance_km: number;
  relative_speed_kms: number;
  risk_score: number;
  risk_category: RiskCategory;
  evaluation_time: string;
  factors: RiskFactor[];
  data_quality: DataQualityLevel;
  warnings: string[];
  scientific_disclaimer: string;
}

export interface RiskAssessmentRequest {
  event: ConjunctionEvent;
  evaluation_time?: string;
  custom_weights?: RiskWeights;
}

export interface RiskAssessmentBatchRequest {
  events: ConjunctionEvent[];
  evaluation_time?: string;
  custom_weights?: RiskWeights;
}

export interface RiskAssessmentBatchResponse {
  total_assessed: number;
  critical_count: number;
  high_count: number;
  moderate_count: number;
  low_count: number;
  negligible_count: number;
  evaluation_time: string;
  assessments: RiskAssessment[];
}

export * from "./simulation";

