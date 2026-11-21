/**
 * COLLIVRA Runtime API Contract Validation
 *
 * Implements strict runtime boundary validation for incoming HTTP responses.
 * Treats external JSON as `unknown` and verifies:
 * - Structural integrity and non-null object constraints
 * - Strict GCRS coordinate frame policy (`summary.target_frame === 'GCRS'` and `event.frame === 'GCRS'`)
 * - Rejection of TEME, GCRF, ITRF, ITRS, RIC_LVLH without silent reinterpretation
 * - Finite kinematic values (no NaN or Infinity)
 * - Valid 3-tuples for relative position and velocity vectors
 * - Correct ISO 8601 UTC timestamps
 * - Precise diagnostic error reporting preserving field paths and received values
 */

import { ApiError } from "./errors";
import type {
  BreakupAndPropagateResponse,
  BreakupRemediationResponse,
  ConjunctionEvent,
  ConjunctionScreeningResponse,
  ConjunctionScreeningSummary,
  CoordinateFrame,
  EarthOrientationDataSource,
  EarthOrientationPolicyViolationPayload,
  EarthOrientationProvenanceTier,
  EarthOrientationQuality,
  ScreeningCategory,
} from "../types/api";

export interface ValidationErrorDetail {
  field: string;
  message: string;
  received: unknown;
}

export class ApiContractValidationError extends ApiError {
  public entity: string;
  public validationErrors: ValidationErrorDetail[];

  constructor(entity: string, errors: ValidationErrorDetail[]) {
    const summary = errors
      .map((e) => `${e.field} (${e.message}; received: ${JSON.stringify(e.received)})`)
      .join("; ");
    super(`API Contract Validation Failed for ${entity}: ${summary}`, 422, summary, false);
    this.name = "ApiContractValidationError";
    this.entity = entity;
    this.validationErrors = errors;
  }
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function isFiniteNumber(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val);
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function isValidIsoTimestamp(val: unknown): boolean {
  if (typeof val !== "string" || val.trim().length === 0) return false;
  const timestamp = Date.parse(val);
  return !Number.isNaN(timestamp);
}

function isValidVector3(val: unknown): val is [number, number, number] {
  return (
    Array.isArray(val) &&
    val.length === 3 &&
    isFiniteNumber(val[0]) &&
    isFiniteNumber(val[1]) &&
    isFiniteNumber(val[2])
  );
}

const VALID_CATEGORIES: ReadonlySet<string> = new Set<ScreeningCategory>([
  "CRITICAL",
  "HIGH",
  "MODERATE",
  "LOW",
]);

export const VALID_EOP_DATA_SOURCES: ReadonlySet<string> = new Set<EarthOrientationDataSource>([
  "DEFINITIVE",
  "RAPID",
  "PREDICTIVE_FRESH",
  "PREDICTIVE_STALE",
  "OUT_OF_RANGE",
  "HISTORICAL_FALLBACK",
  "UNAVAILABLE",
]);

export const VALID_EOP_PROVENANCE_TIERS: ReadonlySet<string> = new Set<EarthOrientationProvenanceTier>([
  "OBSERVED_EOP",
  "FORWARD_PREDICTION",
  "UNMAINTAINED_PREDICTION",
  "BOUNDARY_FALLBACK",
  "HISTORICAL_FALLBACK",
  "UNCALIBRATED_FALLBACK",
]);

/**
 * Validates an EarthOrientationQuality metadata object at runtime.
 */
export function validateEarthOrientationQuality(
  data: unknown,
  pathPrefix = "earth_orientation"
): { quality?: EarthOrientationQuality; errors: ValidationErrorDetail[] } {
  const errors: ValidationErrorDetail[] = [];

  if (!isObject(data)) {
    errors.push({
      field: pathPrefix,
      message: "EarthOrientationQuality must be a non-null object",
      received: data,
    });
    return { errors };
  }

  // 1. Data source
  if (typeof data.data_source !== "string" || !VALID_EOP_DATA_SOURCES.has(data.data_source)) {
    errors.push({
      field: `${pathPrefix}.data_source`,
      message: `data_source must be one of: ${Array.from(VALID_EOP_DATA_SOURCES).join(", ")}`,
      received: data.data_source,
    });
  }

  // 2. is_degraded
  if (typeof data.is_degraded !== "boolean") {
    errors.push({
      field: `${pathPrefix}.is_degraded`,
      message: "is_degraded must be a boolean",
      received: data.is_degraded,
    });
  }

  // 3. provenance_tier
  if (typeof data.provenance_tier !== "string" || !VALID_EOP_PROVENANCE_TIERS.has(data.provenance_tier)) {
    errors.push({
      field: `${pathPrefix}.provenance_tier`,
      message: `provenance_tier must be one of: ${Array.from(VALID_EOP_PROVENANCE_TIERS).join(", ")}`,
      received: data.provenance_tier,
    });
  }

  // 4. prediction_horizon_days (null or finite number)
  if (
    data.prediction_horizon_days !== null &&
    data.prediction_horizon_days !== undefined &&
    !isFiniteNumber(data.prediction_horizon_days)
  ) {
    errors.push({
      field: `${pathPrefix}.prediction_horizon_days`,
      message: "prediction_horizon_days must be a finite number or null",
      received: data.prediction_horizon_days,
    });
  }

  // 5. table_publication_age_days (null or finite number)
  if (
    data.table_publication_age_days !== null &&
    data.table_publication_age_days !== undefined &&
    !isFiniteNumber(data.table_publication_age_days)
  ) {
    errors.push({
      field: `${pathPrefix}.table_publication_age_days`,
      message: "table_publication_age_days must be a finite number or null",
      received: data.table_publication_age_days,
    });
  }

  // 6. local_cache_age_days (null or finite number)
  if (
    data.local_cache_age_days !== null &&
    data.local_cache_age_days !== undefined &&
    !isFiniteNumber(data.local_cache_age_days)
  ) {
    errors.push({
      field: `${pathPrefix}.local_cache_age_days`,
      message: "local_cache_age_days must be a finite number or null",
      received: data.local_cache_age_days,
    });
  }

  // 7. Status codes
  if (!isFiniteNumber(data.ut1_status) || !Number.isInteger(data.ut1_status)) {
    errors.push({
      field: `${pathPrefix}.ut1_status`,
      message: "ut1_status must be a finite integer",
      received: data.ut1_status,
    });
  }

  if (!isFiniteNumber(data.pm_status) || !Number.isInteger(data.pm_status)) {
    errors.push({
      field: `${pathPrefix}.pm_status`,
      message: "pm_status must be a finite integer",
      received: data.pm_status,
    });
  }

  // 8. Disclaimer
  if (!isNonEmptyString(data.earth_orientation_disclaimer)) {
    errors.push({
      field: `${pathPrefix}.earth_orientation_disclaimer`,
      message: "earth_orientation_disclaimer must be a non-empty string",
      received: data.earth_orientation_disclaimer,
    });
  }

  if (errors.length > 0) {
    return { errors };
  }

  return { quality: data as unknown as EarthOrientationQuality, errors: [] };
}

/**
 * Type guard for structured Earth Orientation Policy Violation payloads (HTTP 422).
 */
export function isEarthOrientationPolicyViolation(
  data: unknown
): data is EarthOrientationPolicyViolationPayload {
  if (!isObject(data)) return false;
  return (
    data.code === "EARTH_ORIENTATION_POLICY_VIOLATION" &&
    typeof data.detail === "string" &&
    typeof data.data_source === "string"
  );
}

/**
 * Validates a ConjunctionScreeningSummary object at runtime.
 */
export function validateConjunctionSummary(
  data: unknown,
  pathPrefix = "summary"
): { summary?: ConjunctionScreeningSummary; errors: ValidationErrorDetail[] } {
  const errors: ValidationErrorDetail[] = [];

  if (!isObject(data)) {
    errors.push({
      field: pathPrefix,
      message: "Summary must be a non-null object",
      received: data,
    });
    return { errors };
  }

  // 1. Mandatory GCRS Coordinate Frame Check
  if (data.target_frame !== "GCRS") {
    errors.push({
      field: `${pathPrefix}.target_frame`,
      message: `Expected coordinate frame 'GCRS', but received '${data.target_frame}'. Non-GCRS summary frames are rejected.`,
      received: data.target_frame,
    });
  }

  // 2. Count metrics
  const integerFields = [
    "total_objects",
    "total_pairs_considered",
    "total_events",
    "critical_count",
    "high_count",
    "moderate_count",
    "low_count",
  ];

  for (const field of integerFields) {
    const val = data[field];
    if (!isFiniteNumber(val) || val < 0) {
      errors.push({
        field: `${pathPrefix}.${field}`,
        message: `Field '${field}' must be a non-negative finite number`,
        received: val,
      });
    }
  }

  // 3. Timestamps
  for (const field of ["start_time", "end_time", "processed_at"]) {
    const val = data[field];
    if (!isValidIsoTimestamp(val)) {
      errors.push({
        field: `${pathPrefix}.${field}`,
        message: `Field '${field}' must be a valid ISO 8601 timestamp`,
        received: val,
      });
    }
  }

  // 4. Physical screening parameters
  if (!isFiniteNumber(data.step_seconds) || (data.step_seconds as number) <= 0) {
    errors.push({
      field: `${pathPrefix}.step_seconds`,
      message: "step_seconds must be a positive finite number",
      received: data.step_seconds,
    });
  }

  if (!isFiniteNumber(data.threshold_km) || (data.threshold_km as number) <= 0) {
    errors.push({
      field: `${pathPrefix}.threshold_km`,
      message: "threshold_km must be a positive finite number",
      received: data.threshold_km,
    });
  }

  if (!isFiniteNumber(data.execution_time_seconds) || (data.execution_time_seconds as number) < 0) {
    errors.push({
      field: `${pathPrefix}.execution_time_seconds`,
      message: "execution_time_seconds must be a non-negative finite number",
      received: data.execution_time_seconds,
    });
  }

  if (errors.length > 0) {
    return { errors };
  }

  return { summary: data as unknown as ConjunctionScreeningSummary, errors: [] };
}

/**
 * Validates a single ConjunctionEvent object at runtime.
 */
export function validateConjunctionEvent(
  data: unknown,
  index = 0,
  pathPrefix = `events[${index}]`
): { event?: ConjunctionEvent; errors: ValidationErrorDetail[] } {
  const errors: ValidationErrorDetail[] = [];

  if (!isObject(data)) {
    errors.push({
      field: pathPrefix,
      message: "Conjunction event must be a non-null object",
      received: data,
    });
    return { errors };
  }

  // 1. Mandatory GCRS Coordinate Frame Check
  if (data.frame !== "GCRS") {
    errors.push({
      field: `${pathPrefix}.frame`,
      message: `Event '${data.event_id || `index_${index}`}' has incompatible coordinate frame '${data.frame}'. Relative geometry visualization strictly requires 'GCRS'. Silent reinterpretation of non-GCRS frames is prohibited.`,
      received: data.frame,
    });
  }

  // 2. Identifiers
  if (!isNonEmptyString(data.event_id)) {
    errors.push({
      field: `${pathPrefix}.event_id`,
      message: "event_id must be a non-empty string",
      received: data.event_id,
    });
  }

  if (!isNonEmptyString(data.object_1_id)) {
    errors.push({
      field: `${pathPrefix}.object_1_id`,
      message: "object_1_id must be a non-empty string",
      received: data.object_1_id,
    });
  }

  if (!isNonEmptyString(data.object_2_id)) {
    errors.push({
      field: `${pathPrefix}.object_2_id`,
      message: "object_2_id must be a non-empty string",
      received: data.object_2_id,
    });
  }

  // Object names may be null or string
  if (
    data.object_1_name !== null &&
    data.object_1_name !== undefined &&
    typeof data.object_1_name !== "string"
  ) {
    errors.push({
      field: `${pathPrefix}.object_1_name`,
      message: "object_1_name must be a string or null",
      received: data.object_1_name,
    });
  }

  if (
    data.object_2_name !== null &&
    data.object_2_name !== undefined &&
    typeof data.object_2_name !== "string"
  ) {
    errors.push({
      field: `${pathPrefix}.object_2_name`,
      message: "object_2_name must be a string or null",
      received: data.object_2_name,
    });
  }

  // 3. TCA Timestamp
  if (!isValidIsoTimestamp(data.tca)) {
    errors.push({
      field: `${pathPrefix}.tca`,
      message: "tca must be a valid ISO 8601 UTC timestamp",
      received: data.tca,
    });
  }

  // 4. Scalar Kinematics
  if (!isFiniteNumber(data.miss_distance_km) || (data.miss_distance_km as number) < 0) {
    errors.push({
      field: `${pathPrefix}.miss_distance_km`,
      message: "miss_distance_km must be a non-negative finite number",
      received: data.miss_distance_km,
    });
  }

  if (!isFiniteNumber(data.relative_speed_kms) || (data.relative_speed_kms as number) < 0) {
    errors.push({
      field: `${pathPrefix}.relative_speed_kms`,
      message: "relative_speed_kms must be a non-negative finite number",
      received: data.relative_speed_kms,
    });
  }

  // 5. Kinematic 3-Vectors (Relative Position & Relative Velocity in GCRS)
  if (!isValidVector3(data.relative_position_km)) {
    errors.push({
      field: `${pathPrefix}.relative_position_km`,
      message: "relative_position_km must be an array of exactly three finite numbers [x, y, z]",
      received: data.relative_position_km,
    });
  }

  if (!isValidVector3(data.relative_velocity_kms)) {
    errors.push({
      field: `${pathPrefix}.relative_velocity_kms`,
      message: "relative_velocity_kms must be an array of exactly three finite numbers [vx, vy, vz]",
      received: data.relative_velocity_kms,
    });
  }

  // 6. Screening Category
  if (typeof data.category !== "string" || !VALID_CATEGORIES.has(data.category)) {
    errors.push({
      field: `${pathPrefix}.category`,
      message: `category must be one of: ${Array.from(VALID_CATEGORIES).join(", ")}`,
      received: data.category,
    });
  }

  // 7. Numerical Parameters
  if (!isFiniteNumber(data.screening_threshold_km) || (data.screening_threshold_km as number) <= 0) {
    errors.push({
      field: `${pathPrefix}.screening_threshold_km`,
      message: "screening_threshold_km must be a positive finite number",
      received: data.screening_threshold_km,
    });
  }

  if (!isFiniteNumber(data.step_seconds) || (data.step_seconds as number) <= 0) {
    errors.push({
      field: `${pathPrefix}.step_seconds`,
      message: "step_seconds must be a positive finite number",
      received: data.step_seconds,
    });
  }

  if (errors.length > 0) {
    return { errors };
  }

  return { event: data as unknown as ConjunctionEvent, errors: [] };
}

/**
 * Validates a complete ConjunctionScreeningResponse payload at runtime.
 * Throws ApiContractValidationError if any field is invalid or if coordinate frame is non-GCRS.
 */
export function validateConjunctionScreeningResponse(
  data: unknown
): ConjunctionScreeningResponse {
  const allErrors: ValidationErrorDetail[] = [];

  if (!isObject(data)) {
    throw new ApiContractValidationError("ConjunctionScreeningResponse", [
      {
        field: "root",
        message: "Response must be a non-null JSON object",
        received: data,
      },
    ]);
  }

  // 1. Validate Summary
  if (!data.summary) {
    allErrors.push({
      field: "summary",
      message: "Required 'summary' object is missing from screening response",
      received: undefined,
    });
  } else {
    const { errors } = validateConjunctionSummary(data.summary, "summary");
    allErrors.push(...errors);
  }

  // 2. Validate Events Array
  if (!Array.isArray(data.events)) {
    allErrors.push({
      field: "events",
      message: "Required 'events' field must be an array",
      received: data.events,
    });
  } else {
    data.events.forEach((ev, idx) => {
      const { errors } = validateConjunctionEvent(ev, idx, `events[${idx}]`);
      allErrors.push(...errors);
    });
  }

  // 3. Validate Optional Earth Orientation Quality Metadata
  if (data.earth_orientation !== undefined && data.earth_orientation !== null) {
    const { errors } = validateEarthOrientationQuality(
      data.earth_orientation,
      "earth_orientation"
    );
    allErrors.push(...errors);
  }

  if (allErrors.length > 0) {
    throw new ApiContractValidationError("ConjunctionScreeningResponse", allErrors);
  }

  return data as unknown as ConjunctionScreeningResponse;
}

/**
 * Asserts that the response is a valid ConjunctionScreeningResponse explicitly in GCRS.
 */
export function assertGcrsScreeningResponse(
  data: unknown
): ConjunctionScreeningResponse {
  return validateConjunctionScreeningResponse(data);
}

/**
 * Validates a BreakupAndPropagateResponse at runtime.
 */
export function validateBreakupAndPropagateResponse(
  data: unknown
): BreakupAndPropagateResponse {
  const errors: ValidationErrorDetail[] = [];

  if (!isObject(data)) {
    throw new ApiContractValidationError("BreakupAndPropagateResponse", [
      {
        field: "root",
        message: "Response must be a non-null JSON object",
        received: data,
      },
    ]);
  }

  // 1. Validate fragmentation
  if (!isObject(data.fragmentation)) {
    errors.push({
      field: "fragmentation",
      message: "Required 'fragmentation' object is missing",
      received: data.fragmentation,
    });
  } else {
    const frag = data.fragmentation;
    if (!Array.isArray(frag.fragments)) {
      errors.push({
        field: "fragmentation.fragments",
        message: "Required 'fragments' must be an array",
        received: frag.fragments,
      });
    } else {
      frag.fragments.forEach((f: unknown, idx: number) => {
        const path = `fragmentation.fragments[${idx}]`;
        if (!isObject(f)) {
          errors.push({ field: path, message: "Fragment must be an object", received: f });
          return;
        }
        if (!isNonEmptyString(f.fragment_id)) {
          errors.push({ field: `${path}.fragment_id`, message: "Missing fragment_id", received: f.fragment_id });
        }
        if (f.is_synthetic !== true) {
          errors.push({
            field: `${path}.is_synthetic`,
            message: "Fragment must have is_synthetic = true",
            received: f.is_synthetic,
          });
        }
        if (f.frame !== "GCRS") {
          errors.push({
            field: `${path}.frame`,
            message: "Fragment frame must be GCRS",
            received: f.frame,
          });
        }
        if (!isValidVector3(f.position_km)) {
          errors.push({ field: `${path}.position_km`, message: "Invalid position vector", received: f.position_km });
        }
        if (!isValidVector3(f.velocity_kms)) {
          errors.push({ field: `${path}.velocity_kms`, message: "Invalid velocity vector", received: f.velocity_kms });
        }
      });
    }
  }

  // 2. Validate trajectories
  if (!isObject(data.trajectories)) {
    errors.push({
      field: "trajectories",
      message: "Required 'trajectories' object is missing",
      received: data.trajectories,
    });
  } else {
    const trajBatch = data.trajectories;
    if (trajBatch.frame !== "GCRS") {
      errors.push({
        field: "trajectories.frame",
        message: "Batch frame must be strictly GCRS",
        received: trajBatch.frame,
      });
    }
    if (!isObject(trajBatch.summary)) {
      errors.push({
        field: "trajectories.summary",
        message: "Batch summary must be an object",
        received: trajBatch.summary,
      });
    }
    if (!Array.isArray(trajBatch.trajectories)) {
      errors.push({
        field: "trajectories.trajectories",
        message: "Batch trajectories must be an array",
        received: trajBatch.trajectories,
      });
    }
  }

  if (errors.length > 0) {
    throw new ApiContractValidationError("BreakupAndPropagateResponse", errors);
  }

  return data as unknown as BreakupAndPropagateResponse;
}

export function assertBreakupAndPropagateResponse(
  data: unknown
): BreakupAndPropagateResponse {
  return validateBreakupAndPropagateResponse(data);
}

/**
 * Validates a BreakupRemediationResponse at runtime.
 */
export function validateBreakupRemediationResponse(
  data: unknown
): BreakupRemediationResponse {
  const errors: ValidationErrorDetail[] = [];

  if (!isObject(data)) {
    throw new ApiContractValidationError("BreakupRemediationResponse", [
      {
        field: "root",
        message: "Response must be a non-null JSON object",
        received: data,
      },
    ]);
  }

  // 1. Validate fragmentation & summary
  if (!isObject(data.fragmentation)) {
    errors.push({
      field: "fragmentation",
      message: "Required 'fragmentation' object is missing",
      received: data.fragmentation,
    });
  }
  if (!isObject(data.trajectories_summary)) {
    errors.push({
      field: "trajectories_summary",
      message: "Required 'trajectories_summary' object is missing",
      received: data.trajectories_summary,
    });
  }

  // 2. Validate selected_target
  if (!isObject(data.selected_target)) {
    errors.push({
      field: "selected_target",
      message: "Required 'selected_target' object is missing",
      received: data.selected_target,
    });
  } else {
    const tgt = data.selected_target;
    if (!isNonEmptyString(tgt.fragment_id)) {
      errors.push({ field: "selected_target.fragment_id", message: "Missing fragment_id", received: tgt.fragment_id });
    }
    if (tgt.is_synthetic !== true) {
      errors.push({
        field: "selected_target.is_synthetic",
        message: "Target must have is_synthetic = true",
        received: tgt.is_synthetic,
      });
    }
    if (tgt.frame !== "GCRS") {
      errors.push({
        field: "selected_target.frame",
        message: "Target frame must be strictly GCRS",
        received: tgt.frame,
      });
    }
    if (!isValidVector3(tgt.position_km)) {
      errors.push({ field: "selected_target.position_km", message: "Invalid position vector", received: tgt.position_km });
    }
    if (!isValidVector3(tgt.velocity_kms)) {
      errors.push({ field: "selected_target.velocity_kms", message: "Invalid velocity vector", received: tgt.velocity_kms });
    }
  }

  // 3. Validate contract
  if (!isObject(data.contract)) {
    errors.push({
      field: "contract",
      message: "Required 'contract' object is missing",
      received: data.contract,
    });
  } else {
    const c = data.contract;
    if (!isNonEmptyString(c.chaser_id)) {
      errors.push({ field: "contract.chaser_id", message: "Missing chaser_id", received: c.chaser_id });
    }
    if (c.target_is_synthetic !== true) {
      errors.push({
        field: "contract.target_is_synthetic",
        message: "Contract target_is_synthetic must be true",
        received: c.target_is_synthetic,
      });
    }
    if (!isValidVector3(c.chaser_gcrs_position_km)) {
      errors.push({ field: "contract.chaser_gcrs_position_km", message: "Invalid chaser position", received: c.chaser_gcrs_position_km });
    }
    if (!isValidVector3(c.target_gcrs_position_km)) {
      errors.push({ field: "contract.target_gcrs_position_km", message: "Invalid target position", received: c.target_gcrs_position_km });
    }
  }

  // 4. Validate rendezvous
  if (!isObject(data.rendezvous)) {
    errors.push({
      field: "rendezvous",
      message: "Required 'rendezvous' object is missing",
      received: data.rendezvous,
    });
  } else {
    const r = data.rendezvous;
    if (typeof r.is_mathematically_solvable !== "boolean") {
      errors.push({
        field: "rendezvous.is_mathematically_solvable",
        message: "is_mathematically_solvable must be boolean",
        received: r.is_mathematically_solvable,
      });
    }
    if (typeof r.is_feasible !== "boolean") {
      errors.push({
        field: "rendezvous.is_feasible",
        message: "is_feasible must be boolean",
        received: r.is_feasible,
      });
    }
    if (!isValidVector3(r.burn_1_dv_cw_ms)) {
      errors.push({ field: "rendezvous.burn_1_dv_cw_ms", message: "Invalid burn 1 vector", received: r.burn_1_dv_cw_ms });
    }
    if (!isValidVector3(r.burn_2_dv_cw_ms)) {
      errors.push({ field: "rendezvous.burn_2_dv_cw_ms", message: "Invalid burn 2 vector", received: r.burn_2_dv_cw_ms });
    }
    if (!isFiniteNumber(r.total_delta_v_ms)) {
      errors.push({ field: "rendezvous.total_delta_v_ms", message: "Invalid total delta v", received: r.total_delta_v_ms });
    }
  }

  // 5. Validate execution time & disclaimer
  if (!isFiniteNumber(data.execution_wall_time_s) || (data.execution_wall_time_s as number) < 0) {
    errors.push({
      field: "execution_wall_time_s",
      message: "execution_wall_time_s must be a non-negative finite number",
      received: data.execution_wall_time_s,
    });
  }
  if (!isNonEmptyString(data.scientific_disclaimer)) {
    errors.push({
      field: "scientific_disclaimer",
      message: "scientific_disclaimer must be a non-empty string",
      received: data.scientific_disclaimer,
    });
  }

  if (errors.length > 0) {
    throw new ApiContractValidationError("BreakupRemediationResponse", errors);
  }

  return data as unknown as BreakupRemediationResponse;
}

export function assertBreakupRemediationResponse(
  data: unknown
): BreakupRemediationResponse {
  return validateBreakupRemediationResponse(data);
}

