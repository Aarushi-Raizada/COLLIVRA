/**
 * COLLIVRA Conjunction Screening Domain Utilities & Form Validation
 *
 * Provides pure domain utilities for:
 * - Parsing and deduplicating NORAD catalog IDs from user input
 * - Validating conjunction screening query parameters before API dispatch
 * - Validating individual NORAD catalog ID tokens (positive integers)
 * - Fixture-backed presets for benchmark SSA tracking scenarios
 * - Pure sorting and filtering functions for conjunction events table
 */

import type { ConjunctionEvent, RiskAssessment, ScreeningCategory } from "../types/api";
export {
  calculateInitialScreeningWindow,
  createInitialScreeningRequest,
} from "./screening_lifecycle";

export const PRESET_STATIONS = "25544, 48274";
export const PRESET_COSMOS_DEBRIS = "22675, 33757, 33758, 33760, 33761";

export interface ScreeningFormValidationErrors {
  startTime?: string;
  endTime?: string;
  thresholdKm?: string;
  stepSeconds?: string;
  noradIds?: string;
}

export type SortField = "tca" | "miss_distance_km" | "relative_speed_kms" | "category" | "risk";
export type SortDirection = "asc" | "desc";

export const SEVERITY_ORDER: Record<ScreeningCategory, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MODERATE: 2,
  LOW: 3,
};

/**
 * Parses comma- or whitespace-separated NORAD IDs into clean strings.
 * Ignores empty tokens and surrounding whitespace, and deduplicates while preserving order.
 */
export function parseNoradIds(input: string): string[] {
  if (!input || !input.trim()) return [];
  const rawTokens = input
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const seen = new Set<string>();
  const deduplicated: string[] = [];
  for (const token of rawTokens) {
    if (!seen.has(token)) {
      seen.add(token);
      deduplicated.push(token);
    }
  }
  return deduplicated;
}

/**
 * Validates an array of NORAD ID tokens.
 * Each token must be a valid positive integer string (> 0).
 * Rejects zero, negative numbers, decimal numbers, and non-numeric strings.
 * An empty array is valid (signifying full catalog screening).
 */
export function validateNoradIdTokens(tokens: string[]): {
  isValid: boolean;
  invalidTokens: string[];
  error?: string;
} {
  const invalidTokens: string[] = [];

  for (const token of tokens) {
    // Must consist solely of digits and parse to an integer > 0
    if (!/^\d+$/.test(token)) {
      invalidTokens.push(token);
    } else {
      const val = parseInt(token, 10);
      if (val <= 0) {
        invalidTokens.push(token);
      }
    }
  }

  if (invalidTokens.length > 0) {
    const error =
      invalidTokens.length === 1
        ? `Invalid NORAD catalog ID: "${invalidTokens[0]}". Identifiers must be positive integers.`
        : `Invalid NORAD catalog IDs: ${invalidTokens.map((t) => `"${t}"`).join(", ")}. Identifiers must be positive integers.`;
    return { isValid: false, invalidTokens, error };
  }

  return { isValid: true, invalidTokens: [] };
}

/**
 * Validates conjunction screening form parameters prior to API dispatch.
 * Checks start time, end time, miss distance threshold, coarse step size,
 * and validates all parsed NORAD IDs (if provided).
 */
export function validateScreeningQueryParams(
  startTimeStr: string,
  endTimeStr: string,
  thresholdKmStr: string | number,
  stepSecondsStr: string | number,
  noradIdsInput?: string
): {
  isValid: boolean;
  errors: ScreeningFormValidationErrors;
  parsedNoradIds: string[];
} {
  const errors: ScreeningFormValidationErrors = {};

  // 1. Start time validation
  const startDate = new Date(startTimeStr);
  if (!startTimeStr || isNaN(startDate.getTime())) {
    errors.startTime = "Start time must be a valid ISO 8601 UTC timestamp.";
  }

  // 2. End time validation
  const endDate = new Date(endTimeStr);
  if (!endTimeStr || isNaN(endDate.getTime())) {
    errors.endTime = "End time must be a valid ISO 8601 UTC timestamp.";
  } else if (!errors.startTime && endDate.getTime() < startDate.getTime()) {
    errors.endTime = "End time must be greater than or equal to start time.";
  }

  // 3. Threshold validation
  const threshold =
    typeof thresholdKmStr === "number" ? thresholdKmStr : parseFloat(thresholdKmStr);
  if (isNaN(threshold) || !isFinite(threshold) || threshold <= 0) {
    errors.thresholdKm = "Screening threshold must be a positive number (> 0 km).";
  } else if (threshold > 500.0) {
    errors.thresholdKm = "Screening threshold must not exceed 500.0 km.";
  }

  // 4. Step seconds validation
  const step =
    typeof stepSecondsStr === "number" ? stepSecondsStr : parseFloat(stepSecondsStr);
  if (isNaN(step) || !isFinite(step) || step <= 0) {
    errors.stepSeconds = "Coarse step size must be a positive number (> 0 s).";
  } else if (step > 3600.0) {
    errors.stepSeconds = "Coarse step size must not exceed 3600.0 s.";
  } else if (
    !errors.startTime &&
    !errors.endTime &&
    step > (endDate.getTime() - startDate.getTime()) / 1000
  ) {
    errors.stepSeconds = "Coarse step size cannot exceed screening window duration.";
  }

  // 5. NORAD IDs validation (if provided)
  const parsedNoradIds = noradIdsInput ? parseNoradIds(noradIdsInput) : [];
  if (noradIdsInput && noradIdsInput.trim().length > 0) {
    const noradValidation = validateNoradIdTokens(parsedNoradIds);
    if (!noradValidation.isValid && noradValidation.error) {
      errors.noradIds = noradValidation.error;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    parsedNoradIds,
  };
}

/**
 * Pure function to sort conjunction events.
 * Preserves original objects and falls back to stable event_id.
 */
export function sortConjunctionEvents(
  events: ConjunctionEvent[],
  sortBy: SortField,
  direction: SortDirection,
  riskAssessments?: Record<string, RiskAssessment>
): ConjunctionEvent[] {
  return [...events].sort((a, b) => {
    let cmp = 0;
    if (sortBy === "tca") {
      cmp = new Date(a.tca).getTime() - new Date(b.tca).getTime();
    } else if (sortBy === "miss_distance_km") {
      cmp = a.miss_distance_km - b.miss_distance_km;
    } else if (sortBy === "relative_speed_kms") {
      cmp = a.relative_speed_kms - b.relative_speed_kms;
    } else if (sortBy === "category") {
      cmp = (SEVERITY_ORDER[a.category] ?? 99) - (SEVERITY_ORDER[b.category] ?? 99);
    } else if (sortBy === "risk") {
      const riskA = riskAssessments?.[a.event_id]?.risk_score ?? -1;
      const riskB = riskAssessments?.[b.event_id]?.risk_score ?? -1;
      cmp = riskA - riskB;
    }

    if (cmp === 0) {
      cmp = a.event_id.localeCompare(b.event_id);
    }

    return direction === "asc" ? cmp : -cmp;
  });
}

/**
 * Pure function to filter conjunction events by search term and severity category.
 */
export function filterConjunctionEvents(
  events: ConjunctionEvent[],
  severityFilter: string,
  searchQuery: string
): ConjunctionEvent[] {
  const query = searchQuery.trim().toLowerCase();

  return events.filter((ev) => {
    // 1. Severity filter check
    if (severityFilter && severityFilter !== "ALL") {
      if (ev.category !== severityFilter) {
        return false;
      }
    }

    // 2. Search query check
    if (query) {
      const o1Id = (ev.object_1_id || "").toLowerCase();
      const o1Name = (ev.object_1_name || "").toLowerCase();
      const o2Id = (ev.object_2_id || "").toLowerCase();
      const o2Name = (ev.object_2_name || "").toLowerCase();
      const eventId = (ev.event_id || "").toLowerCase();

      const matches =
        o1Id.includes(query) ||
        o1Name.includes(query) ||
        o2Id.includes(query) ||
        o2Name.includes(query) ||
        eventId.includes(query);

      if (!matches) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Strict synthetic object provenance check (AGENTS.md Section 3.3).
 * Evaluates to true if isSynthetic === true OR if objectId starts with "SYNTH-".
 *
 * CRITICAL SCIENTIFIC INTEGRITY GUARDRAIL:
 * Does NOT inspect display names to avoid false positive attribution.
 * Ordinary catalog objects (e.g. numeric NORAD IDs "25544", "48274") must NEVER receive
 * a synthetic badge unless explicitly marked with is_synthetic === true.
 */
export function isSyntheticObject(
  objectId?: string | null,
  isSynthetic?: boolean
): boolean {
  if (isSynthetic === true) return true;
  if (typeof objectId === "string" && objectId.startsWith("SYNTH-")) return true;
  return false;
}

/**
 * Determine if a conjunction encounter involves any synthetic debris or objects.
 */
export function isSyntheticEncounter(
  event?: ConjunctionEvent | null,
  isSyntheticPrimary?: boolean,
  isSyntheticSecondary?: boolean
): boolean {
  if (!event) return false;
  return (
    isSyntheticObject(event.object_1_id, isSyntheticPrimary ?? event.object_1_is_synthetic ?? event.is_synthetic) ||
    isSyntheticObject(event.object_2_id, isSyntheticSecondary ?? event.object_2_is_synthetic ?? event.is_synthetic)
  );
}
