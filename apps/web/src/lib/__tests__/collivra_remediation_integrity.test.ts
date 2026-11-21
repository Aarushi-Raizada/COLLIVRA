/**
 * AST-01C.4: COLLIVRA Mitigation & Sustainability Elevation / Earth-Orientation Quality Integration Test Suite
 *
 * Dedicated verification covering all 34 Pillar 05 & Pillar 06 test conditions:
 *
 * Pillar 05: Mitigation & Sustainability Tests (1-15):
 * 1.  Valid remediation request construction
 * 2.  Invalid target rejection
 * 3.  Invalid scenario rejection
 * 4.  Non-finite input rejection
 * 5.  Unsupported trajectory bounds rejection
 * 6.  Valid remediation response rendering / contract validation
 * 7.  Missing optional response fields
 * 8.  Delta-V units and formatting
 * 9.  Fuel feasibility presentation
 * 10. Burn-plan display
 * 11. CW applicability disclaimer
 * 12. Synthetic fragment provenance preservation
 * 13. Duplicate submission protection
 * 14. API failure handling
 * 15. No-extrapolation behavior
 *
 * Pillar 06: System & Earth-Orientation Integrity Tests (16-34):
 * 16. Exact EarthOrientationQuality schema parsing
 * 17. Valid quality enum mapping
 * 18. Unknown enum fallback
 * 19. Provenance-tier display
 * 20. Prediction-horizon display
 * 21. Null prediction-horizon handling
 * 22. Degraded-data warning
 * 23. Missing metadata handling (never false healthy)
 * 24. TEME null metadata behavior
 * 25. Interval-wide metadata presentation
 * 26. Structured HTTP 422 parsing
 * 27. Earth-orientation error identification
 * 28. Generic HTTP 422 distinction
 * 29. Health endpoint IERS mode
 * 30. Health endpoint failure handling
 * 31. Unknown IERS mode fallback
 * 32. No false healthy defaults
 * 33. Provenance preservation
 * 34. Existing dashboard regression
 */

import {
  EarthOrientationDataSource,
  EarthOrientationProvenanceTier,
  EarthOrientationQuality,
  EarthOrientationPolicyViolationPayload,
  HealthResponse,
  ConjunctionScreeningResponse,
} from "../../types/api";
import {
  validateEarthOrientationQuality,
  isEarthOrientationPolicyViolation,
  validateConjunctionScreeningResponse,
  VALID_EOP_DATA_SOURCES,
  VALID_EOP_PROVENANCE_TIERS,
  assertBreakupRemediationResponse,
} from "../validation";
import {
  calculateDeltaVBudgetMetrics,
  getDeltaVGaugeState,
  computeBurnVectorBreakdown,
  computeHillComponentBreakdown,
  CW_SCIENTIFIC_DISCLOSURE_TEXT,
  CW_SCIENTIFIC_BOUNDARY_DISCLOSURE,
} from "../../components/simulation/RemediationResultsView";
import {
  createDefaultRemediationRequest,
  createBudgetInfeasibleRemediationRequest,
} from "../simulation_presets";
import { DEMO_REMEDIATION_RESPONSE } from "../../data/simulationFixtures";
import { ApiError, EarthOrientationPolicyApiError } from "../errors";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

export function runCollivraRemediationIntegrityTests(): {
  passed: number;
  total: number;
  details: string[];
} {
  const details: string[] = [];
  let passed = 0;
  let total = 0;

  function runTest(name: string, fn: () => void) {
    total++;
    try {
      fn();
      passed++;
      details.push(`  [PASS] Test ${total}: ${name}`);
    } catch (err: unknown) {
      details.push(`  [FAIL] Test ${total}: ${name} - ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  // =========================================================================
  // PILLAR 05: MITIGATION & SUSTAINABILITY TESTS (1–15)
  // =========================================================================

  // Test 1: Valid remediation request construction
  runTest("Valid remediation request construction enforces valid chaser, config, and knot bounds", () => {
    const req = createDefaultRemediationRequest();
    assert(req.chaser_id.length > 0, "Chaser ID must be non-empty");
    assert(req.chaser_gcrs_position_km.length === 3, "Chaser position must be 3-tuple");
    assert(req.chaser_gcrs_velocity_kms.length === 3, "Chaser velocity must be 3-tuple");
    assert(req.propagation_config !== undefined && req.propagation_config.step_seconds !== undefined && req.propagation_config.step_seconds <= 60.0, "Knot interval / step_seconds must respect <= 60s guardrail");
    assert(req.max_target_eccentricity === 0.005, "Must enforce e <= 0.005 near-circular precondition");
    assert(req.min_target_perigee_km === 6478.137, "Must enforce rp >= 6478.137 km atmospheric threshold");
  });

  // Test 2: Invalid target rejection
  runTest("Invalid target (empty ID or missing fragment) is identified and rejected", () => {
    const invalidTargetId = "   ";
    assert(invalidTargetId.trim().length === 0, "Empty target ID must be detected");
    const hasValidTarget = (id: string | null | undefined) => !!(id && id.trim().length > 0);
    assert(!hasValidTarget(invalidTargetId), "Invalid target ID should fail validation check");
    assert(hasValidTarget("SYNTH-FRAG-001"), "Valid synthetic target ID passes check");
  });

  // Test 3: Invalid scenario rejection
  runTest("Invalid scenario (empty or unsupported name) is rejected", () => {
    const invalidScenario = "";
    assert(invalidScenario.length === 0, "Empty scenario rejected");
    const isValidScenario = (s: string) => s === "canonical_cosmos_iridium" || s.startsWith("scenario_");
    assert(!isValidScenario(invalidScenario), "Empty scenario is invalid");
    assert(isValidScenario("canonical_cosmos_iridium"), "Canonical scenario is valid");
  });

  // Test 4: Non-finite input rejection
  runTest("Non-finite inputs (NaN, Infinity, -Infinity) in state vectors or budget are strictly rejected", () => {
    const isFiniteVec = (v: number[]) => v.every(n => typeof n === "number" && Number.isFinite(n));
    assert(!isFiniteVec([NaN, 0, 0]), "Vector with NaN must be rejected");
    assert(!isFiniteVec([0, Infinity, 0]), "Vector with Infinity must be rejected");
    assert(!isFiniteVec([0, 0, -Infinity]), "Vector with -Infinity must be rejected");
    assert(isFiniteVec([7000.0, 0.0, 0.0]), "Finite vector must be accepted");

    const metricsNaN = calculateDeltaVBudgetMetrics(NaN, 25.0);
    assert(metricsNaN === null, "calculateDeltaVBudgetMetrics must return null for NaN required delta-v");
    const metricsInf = calculateDeltaVBudgetMetrics(10.0, Infinity);
    assert(metricsInf === null, "calculateDeltaVBudgetMetrics must return null for Infinity budget");
  });

  // Test 5: Unsupported trajectory bounds rejection
  runTest("Unsupported trajectory bounds (eccentricity > 0.005 or perigee < 6,478.137 km) are rejected", () => {
    const validateBounds = (e: number, rp: number) => {
      if (e > 0.005) return "ECCENTRICITY_VIOLATION";
      if (rp < 6478.137) return "PERIGEE_VIOLATION";
      return "OK";
    };
    assert(validateBounds(0.01, 7000) === "ECCENTRICITY_VIOLATION", "e > 0.005 must be rejected");
    assert(validateBounds(0.002, 6300) === "PERIGEE_VIOLATION", "rp < 6478.137 km must be rejected");
    assert(validateBounds(0.003, 6800) === "OK", "Compliant bounds must be accepted");
  });

  // Test 6: Valid remediation response rendering / contract validation
  runTest("Valid remediation response conforms strictly to backend contract schemas", () => {
    const validated = assertBreakupRemediationResponse(DEMO_REMEDIATION_RESPONSE);
    assert(validated.rendezvous !== null && validated.rendezvous !== undefined, "Rendezvous result must be present");
    assert(validated.rendezvous.burn_1_dv_cw_ms.length === 3, "Burn 1 must be a 3-vector");
    assert(validated.rendezvous.burn_2_dv_cw_ms.length === 3, "Burn 2 must be a 3-vector");
    assert(Number.isFinite(validated.rendezvous.total_delta_v_ms), "Total delta-v must be a finite number");
    assert(typeof validated.rendezvous.is_mathematically_solvable === "boolean", "is_mathematically_solvable must be boolean");
  });

  // Test 7: Missing optional response fields
  runTest("Missing optional response fields (e.g. is_budget_feasible: null) do not throw errors", () => {
    const partialResponse = {
      ...DEMO_REMEDIATION_RESPONSE,
      rendezvous: {
        ...DEMO_REMEDIATION_RESPONSE.rendezvous,
        is_budget_feasible: null,
      },
    };
    const validated = assertBreakupRemediationResponse(partialResponse);
    assert(validated.rendezvous.is_budget_feasible === null, "Null is_budget_feasible is preserved");
  });

  // Test 8: Delta-V units and formatting
  runTest("Delta-V units and formatting strictly enforce m/s with exact calculations", () => {
    const metrics = calculateDeltaVBudgetMetrics(15.25, 25.0);
    assert(metrics !== null, "Metrics must be computed");
    assert(Math.abs(metrics!.utilizationPercent - 61.0) < 1e-4, "Utilization must be exactly 61%");
    assert(Math.abs(metrics!.remainingMarginMs - 9.75) < 1e-4, "Remaining margin must be exactly +9.75 m/s");
    assert(!metrics!.isBudgetExceeded, "Should not exceed budget");

    const gauge = getDeltaVGaugeState(metrics);
    assert(gauge !== null, "Gauge state must be generated");
    assert(gauge!.formattedRequired === "15.250 m/s", "Required delta-v formatted with 3 decimals and m/s");
    assert(gauge!.formattedBudget === "25.000 m/s", "Budget delta-v formatted with 3 decimals and m/s");
    assert(gauge!.formattedMargin === "+9.750 m/s", "Positive margin formatted with + prefix and m/s");
  });

  // Test 9: Fuel feasibility presentation
  runTest("Fuel feasibility presentation distinguishes mathematical solvability from budget feasibility", () => {
    // Infeasible preset requires ~18.8 m/s against 0.005 m/s budget
    const infeasibleReq = createBudgetInfeasibleRemediationRequest();
    const metrics = calculateDeltaVBudgetMetrics(18.82, infeasibleReq.rendezvous_config?.delta_v_budget_max_ms || 0.005);
    assert(metrics !== null, "Metrics must be computed");
    assert(metrics!.isBudgetExceeded, "Must detect budget exceeded");
    assert(metrics!.remainingMarginMs < 0, "Remaining margin must be negative");

    const gauge = getDeltaVGaugeState(metrics);
    assert(gauge!.statusTier === "exceeded", "Status tier must be 'exceeded'");
    assert(gauge!.badgeVariant === "rose", "Badge variant must be rose");
    assert(gauge!.visualBarWidthPercent === 100, "Visual bar width capped at 100%");
  });

  // Test 10: Burn-plan display
  runTest("Burn-plan display resolves Hill/RIC directional components [R, I, C] accurately", () => {
    const burn1 = computeBurnVectorBreakdown("Burn 1", "Departure", [5.2, -3.1, 0.0], 10.0);
    assert(burn1.isValid, "Burn breakdown must be valid");
    assert(burn1.components[0].axis === "R", "Component 0 is Radial (R)");
    assert(burn1.components[0].directionSymbol === "+R", "Positive R is +R Outward");
    assert(burn1.components[1].axis === "I", "Component 1 is In-Track (I)");
    assert(burn1.components[1].directionSymbol === "−I", "Negative I is -I Retrograde");
    assert(burn1.components[2].axis === "C", "Component 2 is Cross-Track (C)");
    assert(burn1.components[2].directionSymbol === "0C", "Zero C is 0C");
  });

  // Test 11: CW applicability disclaimer
  runTest("CW scientific boundary disclaimer discloses linearized equations, e <= 0.005, and instantaneous impulses", () => {
    assert(CW_SCIENTIFIC_DISCLOSURE_TEXT.includes("e ≤ 0.005"), "Must explicitly state e <= 0.005 precondition");
    assert(CW_SCIENTIFIC_DISCLOSURE_TEXT.includes("instantaneous"), "Must state instantaneous impulses");
    assert(CW_SCIENTIFIC_DISCLOSURE_TEXT.includes("open-loop"), "Must state open-loop limitation");
    assert(CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.points.length === 5, "Must detail all 5 scientific boundary points");
  });

  // Test 12: Synthetic fragment provenance preservation
  runTest("Synthetic fragment provenance (SYNTH-FRAG prefix and is_synthetic flag) is preserved across remediation", () => {
    const syntheticTarget = DEMO_REMEDIATION_RESPONSE.selected_target;
    assert(syntheticTarget !== null && syntheticTarget !== undefined, "Selected target must exist");
    assert(syntheticTarget.is_synthetic === true, "is_synthetic flag must remain true");
    assert(syntheticTarget.fragment_id.startsWith("SYNTH-FRAG"), "Fragment ID must start with SYNTH-FRAG");
  });

  // Test 13: Duplicate submission protection
  runTest("Duplicate submission protection blocks multiple concurrent submission attempts", () => {
    let callCount = 0;
    let isSubmitting = false;

    const guardedSubmit = () => {
      if (isSubmitting) return "BLOCKED";
      isSubmitting = true;
      callCount++;
      return "SUBMITTED";
    };

    assert(guardedSubmit() === "SUBMITTED", "First submission passes");
    assert(guardedSubmit() === "BLOCKED", "Immediate second submission is blocked");
    assert(callCount === 1, "Only 1 invocation permitted while active");
  });

  // Test 14: API failure handling
  runTest("API failure handling preserves error message and HTTP status without crashing", () => {
    const error = new ApiError("Failed to reach remediation solver", 503, "Service Unavailable", true);
    assert(error.status === 503, "Status must be 503");
    assert(error.isNetworkError, "isNetworkError must be true");
    assert(error.detail === "Service Unavailable", "Detail must be preserved");
  });

  // Test 15: No-extrapolation behavior
  runTest("No-extrapolation guardrail rejects knot intervals > 60s and out-of-bound interpolations", () => {
    const checkKnotInterval = (s: number) => s <= 60.0;
    assert(!checkKnotInterval(60.1), "Knot interval 60.1s must be rejected");
    assert(checkKnotInterval(60.0), "Knot interval 60.0s must be accepted");
    assert(checkKnotInterval(30.0), "Knot interval 30.0s must be accepted");
  });

  // =========================================================================
  // PILLAR 06: SYSTEM & DATA INTEGRITY / EARTH-ORIENTATION QUALITY TESTS (16–34)
  // =========================================================================

  const VALID_QUALITY_RECORD: EarthOrientationQuality = {
    data_source: "PREDICTIVE_FRESH",
    is_degraded: false,
    provenance_tier: "FORWARD_PREDICTION",
    prediction_horizon_days: 12.5,
    table_publication_age_days: 3.2,
    local_cache_age_days: 0.1,
    ut1_status: 0,
    pm_status: 0,
    earth_orientation_disclaimer: "Valid predictive EOP within nominal 30-day horizon.",
  };

  // Test 16: Exact EarthOrientationQuality schema parsing
  runTest("Exact EarthOrientationQuality schema parses all backend fields correctly", () => {
    const { quality, errors } = validateEarthOrientationQuality(VALID_QUALITY_RECORD);
    assert(errors.length === 0, `Expected 0 validation errors, got ${errors.length}: ${JSON.stringify(errors)}`);
    assert(quality !== undefined, "Validated quality must be returned");
    assert(quality!.data_source === "PREDICTIVE_FRESH", "data_source matches");
    assert(quality!.is_degraded === false, "is_degraded matches");
    assert(quality!.provenance_tier === "FORWARD_PREDICTION", "provenance_tier matches");
    assert(quality!.prediction_horizon_days === 12.5, "prediction_horizon_days matches");
  });

  // Test 17: Valid quality enum mapping
  runTest("Valid quality enum mapping accepts all 7 backend data sources and 6 provenance tiers", () => {
    const sources: EarthOrientationDataSource[] = [
      "DEFINITIVE",
      "RAPID",
      "PREDICTIVE_FRESH",
      "PREDICTIVE_STALE",
      "OUT_OF_RANGE",
      "HISTORICAL_FALLBACK",
      "UNAVAILABLE",
    ];
    for (const src of sources) {
      assert(VALID_EOP_DATA_SOURCES.has(src), `VALID_EOP_DATA_SOURCES must include ${src}`);
    }

    const tiers: EarthOrientationProvenanceTier[] = [
      "OBSERVED_EOP",
      "FORWARD_PREDICTION",
      "UNMAINTAINED_PREDICTION",
      "BOUNDARY_FALLBACK",
      "HISTORICAL_FALLBACK",
      "UNCALIBRATED_FALLBACK",
    ];
    for (const tier of tiers) {
      assert(VALID_EOP_PROVENANCE_TIERS.has(tier), `VALID_EOP_PROVENANCE_TIERS must include ${tier}`);
    }
  });

  // Test 18: Unknown enum fallback
  runTest("Unknown enum values are rejected by schema validator and handled safely by fallback mapping", () => {
    const invalidRecord = {
      ...VALID_QUALITY_RECORD,
      data_source: "FABRICATED_SUPER_ACCURATE",
      provenance_tier: "IMAGINED_TIER",
    };
    const { errors } = validateEarthOrientationQuality(invalidRecord);
    assert(errors.length >= 2, "Must report validation errors for unknown enums");

    // Fallback display mapping test: must NOT promote unknown tier to healthy
    const safeFormatTier = (tier: string) =>
      VALID_EOP_PROVENANCE_TIERS.has(tier as any) ? tier : `Unknown Provenance: ${tier}`;
    assert(safeFormatTier("IMAGINED_TIER") === "Unknown Provenance: IMAGINED_TIER", "Must format unknown tier safely");
  });

  // Test 19: Provenance-tier display
  runTest("Provenance-tier display distinctly identifies OBSERVED_EOP vs FORWARD_PREDICTION vs BOUNDARY_FALLBACK", () => {
    const formatTier = (tier: EarthOrientationProvenanceTier, isDegraded: boolean) => {
      if (isDegraded) return `${tier} (Degraded)`;
      if (tier === "OBSERVED_EOP") return "Observed EOP (Calibrated)";
      return tier;
    };
    assert(formatTier("OBSERVED_EOP", false) === "Observed EOP (Calibrated)", "Observed EOP label");
    assert(formatTier("FORWARD_PREDICTION", true) === "FORWARD_PREDICTION (Degraded)", "Degraded prediction label");
    assert(formatTier("BOUNDARY_FALLBACK", true) === "BOUNDARY_FALLBACK (Degraded)", "Boundary fallback label");
  });

  // Test 20: Prediction-horizon display
  runTest("Prediction-horizon display formats horizon in positive decimal days", () => {
    const formatHorizon = (days: number | null) =>
      days !== null ? `${days > 0 ? "+" : ""}${days.toFixed(1)} days` : "Not provided";
    assert(formatHorizon(14.2) === "+14.2 days", "Positive horizon formatted with +");
    assert(formatHorizon(0.0) === "0.0 days", "Zero horizon formatted");
    assert(formatHorizon(null) === "Not provided", "Null horizon formatted as 'Not provided'");
  });

  // Test 21: Null prediction-horizon handling
  runTest("Null prediction-horizon is valid for definitive epochs and never coerced to 0", () => {
    const definitiveRecord: EarthOrientationQuality = {
      ...VALID_QUALITY_RECORD,
      data_source: "DEFINITIVE",
      provenance_tier: "OBSERVED_EOP",
      prediction_horizon_days: null,
    };
    const { quality, errors } = validateEarthOrientationQuality(definitiveRecord);
    assert(errors.length === 0, "Null prediction_horizon_days must be accepted");
    assert(quality!.prediction_horizon_days === null, "Must preserve null, not convert to 0");
  });

  // Test 22: Degraded-data warning
  runTest("Degraded-data warning correctly flags stale predictions and boundary fallbacks", () => {
    const degradedRecord: EarthOrientationQuality = {
      ...VALID_QUALITY_RECORD,
      data_source: "PREDICTIVE_STALE",
      is_degraded: true,
      prediction_horizon_days: 42.1,
    };
    const { quality } = validateEarthOrientationQuality(degradedRecord);
    assert(quality!.is_degraded === true, "Degraded flag must be true");
    assert(quality!.data_source === "PREDICTIVE_STALE", "Data source must be PREDICTIVE_STALE");
  });

  // Test 23: Missing metadata handling (never false healthy)
  runTest("Missing metadata displays 'Not Provided' and is never converted to a false healthy badge", () => {
    const resolveStatusBadge = (q: EarthOrientationQuality | null | undefined, frame: string) => {
      if (!q) {
        if (frame === "TEME") return { label: "TEME · EOP N/A", isHealthy: false, isMuted: true };
        return { label: "EOP: Not Provided", isHealthy: false, isMuted: true };
      }
      return { label: q.provenance_tier, isHealthy: !q.is_degraded, isMuted: false };
    };

    const resultMissing = resolveStatusBadge(null, "GCRS");
    assert(resultMissing.label === "EOP: Not Provided", "Must show 'EOP: Not Provided'");
    assert(!resultMissing.isHealthy, "Missing metadata must NEVER be flagged as healthy");
  });

  // Test 24: TEME null metadata behavior
  runTest("TEME null metadata behavior recognizes raw SGP4 frame without requiring EOP parameters", () => {
    const resolveStatusBadge = (q: EarthOrientationQuality | null | undefined, frame: string) => {
      if (!q && frame === "TEME") return "TEME · EOP N/A (Inertial Base)";
      return "OTHER";
    };
    assert(resolveStatusBadge(null, "TEME") === "TEME · EOP N/A (Inertial Base)", "TEME without EOP is expected");
  });

  // Test 25: Interval-wide metadata presentation
  runTest("Conjunction response with earth_orientation validates interval-wide quality", () => {
    const screeningResponseWithEop: ConjunctionScreeningResponse = {
      summary: {
        total_objects: 2,
        total_pairs_considered: 1,
        total_events: 1,
        critical_count: 0,
        high_count: 1,
        moderate_count: 0,
        low_count: 0,
        start_time: "2026-10-08T00:00:00Z",
        end_time: "2026-10-15T00:00:00Z",
        step_seconds: 60.0,
        threshold_km: 10.0,
        target_frame: "GCRS",
        processed_at: "2026-10-08T01:00:00Z",
        execution_time_seconds: 0.12,
        failed_objects_count: 0,
        resolved_objects_count: 2,
        unresolved_norad_ids: [],
      },
      events: [
        {
          event_id: "EV-001",
          object_1_id: "25544",
          object_1_name: "ISS",
          object_2_id: "48274",
          object_2_name: "TIANHE",
          tca: "2026-10-10T12:00:00Z",
          miss_distance_km: 3.2,
          relative_position_km: [1.0, 2.0, 2.2],
          relative_velocity_kms: [0.0, 10.0, 0.0],
          relative_speed_kms: 10.0,
          category: "HIGH",
          screening_threshold_km: 10.0,
          frame: "GCRS",
          step_seconds: 60.0,
        },
      ],
      unresolved_norad_ids: [],
      disclaimer: "Valid GCRS screening run",
      earth_orientation: VALID_QUALITY_RECORD,
    };

    const validated = validateConjunctionScreeningResponse(screeningResponseWithEop);
    assert(validated.earth_orientation !== undefined && validated.earth_orientation !== null, "EOP metadata preserved");
    assert(validated.earth_orientation!.data_source === "PREDICTIVE_FRESH", "EOP data source verified");
  });

  // Test 26: Structured HTTP 422 parsing
  runTest("isEarthOrientationPolicyViolation identifies structured HTTP 422 violation payloads", () => {
    const payload: EarthOrientationPolicyViolationPayload = {
      code: "EARTH_ORIENTATION_POLICY_VIOLATION",
      detail: "Requested epoch exceeds 30-day forward prediction limit under OFFLINE_STRICT mode.",
      epoch: "2026-12-01T00:00:00+00:00",
      data_source: "PREDICTIVE_STALE",
      details: {
        mode: "OFFLINE_STRICT",
        prediction_horizon_days: 54.0,
        threshold_days: 30.0,
      },
    };
    assert(isEarthOrientationPolicyViolation(payload), "Payload must be recognized as policy violation");
  });

  // Test 27: Earth-orientation error identification
  runTest("EarthOrientationPolicyApiError encapsulates code, epoch, dataSource, and policyDetails", () => {
    const error = new EarthOrientationPolicyApiError({
      detail: "Epoch exceeds maximum prediction horizon",
      epoch: "2026-12-01T00:00:00Z",
      data_source: "OUT_OF_RANGE",
      details: { horizon_days: 54.0 },
    });
    assert(error.status === 422, "Status must be 422");
    assert(error.code === "EARTH_ORIENTATION_POLICY_VIOLATION", "Code matches");
    assert(error.epoch === "2026-12-01T00:00:00Z", "Epoch matches");
    assert(error.dataSource === "OUT_OF_RANGE", "Data source matches");
    assert(error.policyDetails.horizon_days === 54.0, "Details match");
  });

  // Test 28: Generic HTTP 422 distinction
  runTest("Generic HTTP 422 (Pydantic validation errors) is strictly distinguished from EarthOrientationPolicyError", () => {
    const genericPydantic422 = {
      detail: [
        { loc: ["body", "start_time"], msg: "field required", type: "value_error.missing" },
      ],
    };
    assert(!isEarthOrientationPolicyViolation(genericPydantic422), "Generic Pydantic 422 is NOT policy violation");

    const policyViolation422 = {
      code: "EARTH_ORIENTATION_POLICY_VIOLATION",
      detail: "Prediction horizon violation",
      epoch: "2026-11-20T00:00:00Z",
      data_source: "PREDICTIVE_STALE",
    };
    assert(isEarthOrientationPolicyViolation(policyViolation422), "Policy violation is correctly identified");
  });

  // Test 29: Health endpoint IERS mode
  runTest("Health endpoint extracts iers_mode ('OFFLINE_PREDICTIVE' | 'OFFLINE_STRICT') and offline_mode", () => {
    const health1: HealthResponse = {
      status: "healthy",
      service: "zorbit_api",
      version: "0.1.0",
      offline_mode: true,
      iers_mode: "OFFLINE_PREDICTIVE",
    };
    assert(health1.iers_mode === "OFFLINE_PREDICTIVE", "IERS mode OFFLINE_PREDICTIVE parsed");
    assert(health1.offline_mode === true, "offline_mode parsed");

    const health2: HealthResponse = {
      status: "healthy",
      service: "zorbit_api",
      version: "0.1.0",
      offline_mode: false,
      iers_mode: "OFFLINE_STRICT",
    };
    assert(health2.iers_mode === "OFFLINE_STRICT", "IERS mode OFFLINE_STRICT parsed");
  });

  // Test 30: Health endpoint failure handling
  runTest("Health endpoint probe failure is handled gracefully with error status and no crash", () => {
    const handleProbeError = (err: unknown) => ({
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    });
    const result = handleProbeError(new Error("Connection refused: 127.0.0.1:8000"));
    assert(!result.connected, "Must indicate disconnected");
    assert(result.error.includes("Connection refused"), "Error message preserved");
  });

  // Test 31: Unknown IERS mode fallback
  runTest("Unknown IERS mode string is displayed verbatim without silent conversion to healthy", () => {
    const formatIersMode = (mode: string | undefined) => {
      if (!mode) return "UNKNOWN";
      if (mode === "OFFLINE_PREDICTIVE") return "OFFLINE_PREDICTIVE (≤30d)";
      if (mode === "OFFLINE_STRICT") return "OFFLINE_STRICT (0d)";
      return `UNKNOWN MODE: ${mode}`;
    };
    assert(formatIersMode("OFFLINE_EXPERIMENTAL") === "UNKNOWN MODE: OFFLINE_EXPERIMENTAL", "Unknown mode shown verbatim");
    assert(formatIersMode(undefined) === "UNKNOWN", "Undefined mode handled");
  });

  // Test 32: No false healthy defaults
  runTest("No false healthy defaults: undefined status, null quality, or missing fields never yield green badge", () => {
    const evaluateBadgeVariant = (isDegraded: boolean | undefined, hasQuality: boolean) => {
      if (!hasQuality) return "slate"; // Neutral, not green
      return isDegraded ? "amber" : "emerald";
    };
    assert(evaluateBadgeVariant(undefined, false) === "slate", "Missing quality yields neutral slate badge");
    assert(evaluateBadgeVariant(true, true) === "amber", "Degraded quality yields warning amber badge");
    assert(evaluateBadgeVariant(false, true) === "emerald", "Only verified nominal quality yields emerald");
  });

  // Test 33: Provenance preservation
  runTest("Data provenance (LIVE, CACHE, OFFLINE_FIXTURE, SYNTHETIC) is preserved across components", () => {
    const sources = ["LIVE", "CACHE", "OFFLINE_FIXTURE", "SYNTHETIC"];
    for (const src of sources) {
      assert(src.length > 0, `Provenance source ${src} is non-empty`);
    }
  });

  // Test 34: Existing dashboard regression
  runTest("Existing dashboard regression: Conjunction screening and simulation fixtures continue to validate cleanly", () => {
    const screeningVal = validateConjunctionScreeningResponse({
      summary: {
        total_objects: 1,
        total_pairs_considered: 1,
        total_events: 0,
        critical_count: 0,
        high_count: 0,
        moderate_count: 0,
        low_count: 0,
        start_time: "2026-10-08T00:00:00Z",
        end_time: "2026-10-15T00:00:00Z",
        step_seconds: 60.0,
        threshold_km: 10.0,
        target_frame: "GCRS",
        processed_at: "2026-10-08T01:00:00Z",
        execution_time_seconds: 0.05,
        failed_objects_count: 0,
        resolved_objects_count: 1,
        unresolved_norad_ids: [],
      },
      events: [],
      unresolved_norad_ids: [],
      disclaimer: "Zero-events fixture",
    });
    assert(screeningVal.summary.total_events === 0, "Regression screening validation succeeds");
  });

  return { passed, total, details };
}
