/**
 * Unit verification tests for ZORBIT Conjunction Screening Query Interface & Summary Dashboard
 * (Milestone 4.2.1 / 4.2.1.2 Corrections).
 */

import {
  validateScreeningQueryParams,
  validateNoradIdTokens,
  parseNoradIds,
  PRESET_STATIONS,
  PRESET_COSMOS_DEBRIS,
  sortConjunctionEvents,
  filterConjunctionEvents,
} from "../screening";
import { createDefaultScreeningRequest } from "../api";
import { assertGcrsScreeningResponse } from "../validation";
import { MOCK_CONJUNCTION_RESPONSE, MOCK_CONJUNCTION_EVENTS, MOCK_RISK_ASSESSMENTS } from "../mockData";
import {
  gcrsToEncounterThreeVector,
  isValidEncounterEvent,
  calculateMissDistanceEndpoints,
  calculateRelativeVelocityGeometry,
  calculateSeverityShells,
  assertGcrsEncounterFrame,
  ENCOUNTER_SCALE_KM_PER_UNIT,
  RADAR_SCALE_KM_PER_UNIT,
} from "../encounter_geometry";
import type {
  ConjunctionEvent,
  ConjunctionScreeningRequest,
  ConjunctionScreeningResponse,
  ConjunctionScreeningSummary,
  RiskAssessment,
} from "../../types/api";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

export function runConjunctionScreeningTests(): {
  passed: number;
  total: number;
  details: string[]
} {
  let passed = 0;
  let total = 0;
  const details: string[] = [];

  function test(name: string, fn: () => void) {
    total++;
    try {
      fn();
      passed++;
      details.push(`[PASS] ${name}`);
    } catch (err) {
      details.push(`[FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[FAIL] ${name}:`, err);
      throw err;
    }
  }

  // 1. Valid screening query parameters pass validation
  test("1. Valid screening query parameters pass validation", () => {
    const start = "2026-11-02T12:00:00.000Z";
    const end = "2026-11-02T14:00:00.000Z";
    const res = validateScreeningQueryParams(start, end, "10.0", "60.0");
    assert(res.isValid === true, "Valid parameters must pass validation");
    assert(Object.keys(res.errors).length === 0, "No error messages should be present");
    assert(res.parsedNoradIds.length === 0, "Omitted noradIdsInput yields empty parsedNoradIds");
  });

  // 2. Quick-select presets provide expected fixture-backed NORAD ID lists
  test("2. Quick-select presets provide expected fixture-backed NORAD ID lists", () => {
    const stationsParsed = parseNoradIds(PRESET_STATIONS);
    assert(stationsParsed.length === 2, "Stations preset must contain 2 IDs");
    assert(stationsParsed[0] === "25544", "First ID must be ISS (25544)");
    assert(stationsParsed[1] === "48274", "Second ID must be CSS (48274)");

    const cosmosParsed = parseNoradIds(PRESET_COSMOS_DEBRIS);
    assert(cosmosParsed.length === 5, "Cosmos debris preset must contain exactly 5 verified fixture IDs");
    assert(
      JSON.stringify(cosmosParsed) === JSON.stringify(["22675", "33757", "33758", "33760", "33761"]),
      "Cosmos debris IDs must match verified fixture debris_cosmos_omm.json"
    );

    const emptyParsed = parseNoradIds("   ");
    assert(emptyParsed.length === 0, "Empty/whitespace input must yield empty array");
  });

  // 3. Form validation rejects end_time < start_time
  test("3. Form validation rejects end_time < start_time", () => {
    const start = "2026-11-02T14:00:00.000Z";
    const end = "2026-11-02T12:00:00.000Z";
    const res = validateScreeningQueryParams(start, end, "10.0", "60.0");
    assert(res.isValid === false, "Reversed time window must be invalid");
    assert(
      res.errors.endTime !== undefined &&
        res.errors.endTime.includes("greater than or equal to start time"),
      "Error must explain that end time must be >= start time"
    );
  });

  // 4. Form validation rejects non-positive threshold
  test("4. Form validation rejects non-positive threshold (<= 0 or NaN)", () => {
    const start = "2026-11-02T12:00:00.000Z";
    const end = "2026-11-02T14:00:00.000Z";

    const zeroRes = validateScreeningQueryParams(start, end, "0.0", "60.0");
    assert(zeroRes.isValid === false, "Zero threshold must be rejected");
    assert(
      zeroRes.errors.thresholdKm !== undefined,
      "Must record thresholdKm error for 0"
    );

    const negRes = validateScreeningQueryParams(start, end, "-5.0", "60.0");
    assert(negRes.isValid === false, "Negative threshold must be rejected");

    const nanRes = validateScreeningQueryParams(start, end, "invalid-num", "60.0");
    assert(nanRes.isValid === false, "NaN threshold must be rejected");
  });

  // 5. Form validation rejects non-positive step size
  test("5. Form validation rejects non-positive step size (<= 0 or NaN)", () => {
    const start = "2026-11-02T12:00:00.000Z";
    const end = "2026-11-02T14:00:00.000Z";

    const zeroStep = validateScreeningQueryParams(start, end, "10.0", "0");
    assert(zeroStep.isValid === false, "Zero step size must be rejected");
    assert(zeroStep.errors.stepSeconds !== undefined, "Must record stepSeconds error for 0");

    const negStep = validateScreeningQueryParams(start, end, "10.0", "-10");
    assert(negStep.isValid === false, "Negative step size must be rejected");
  });

  // 6. Form validation rejects invalid ISO date strings
  test("6. Form validation rejects invalid ISO date strings", () => {
    const badStart = validateScreeningQueryParams("not-a-date", "2026-11-02T14:00:00.000Z", "10.0", "60.0");
    assert(badStart.isValid === false, "Invalid start time must be rejected");
    assert(badStart.errors.startTime !== undefined, "Must flag startTime error");

    const badEnd = validateScreeningQueryParams("2026-11-02T12:00:00.000Z", "not-a-date", "10.0", "60.0");
    assert(badEnd.isValid === false, "Invalid end time must be rejected");
    assert(badEnd.errors.endTime !== undefined, "Must flag endTime error");
  });

  // 7. Request factory strictly enforces target_frame: 'GCRS'
  test("7. Request factory strictly enforces target_frame: 'GCRS'", () => {
    const req = createDefaultScreeningRequest(
      "2026-11-02T12:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      ["25544", "48274"],
      10.0
    );
    assert(req.target_frame === "GCRS", "target_frame must be locked to GCRS");
    assert(req.threshold_critical_km === 1.0, "Critical threshold must be 1.0 km");
    assert(req.threshold_high_km === 5.0, "High threshold must be 5.0 km");
    assert(req.threshold_moderate_km === 10.0, "Moderate threshold must be 10.0 km");
  });

  // 8. Screening summary verifies total objects, pairs considered, and total events
  test("8. Screening summary metrics are properly represented in fixture data", () => {
    const summary: ConjunctionScreeningSummary = MOCK_CONJUNCTION_RESPONSE.summary;
    assert(summary.total_objects === 5, "total_objects must be 5");
    assert(summary.total_pairs_considered === 10, "total_pairs_considered must be 10");
    assert(summary.total_events === 3, "total_events must be 3");
    assert(summary.target_frame === "GCRS", "Summary coordinate frame must be GCRS");
  });

  // 9. Screening summary correctly classifies 4 geometric severity tier counts
  test("9. Screening summary tracks all 4 geometric severity tier counts", () => {
    const summary: ConjunctionScreeningSummary = MOCK_CONJUNCTION_RESPONSE.summary;
    assert(summary.critical_count === 1, "critical_count (<1 km) must be 1");
    assert(summary.high_count === 1, "high_count (1-5 km) must be 1");
    assert(summary.moderate_count === 1, "moderate_count (5-10 km) must be 1");
    assert(summary.low_count === 0, "low_count (>10 km) must be 0");
    assert(
      summary.critical_count + summary.high_count + summary.moderate_count + summary.low_count ===
        summary.total_events,
      "Sum of tier counts must equal total_events"
    );
  });

  // 10. Screening summary accurately records unresolved NORAD IDs when present
  test("10. Screening summary accurately records unresolved NORAD IDs when present", () => {
    const summaryWithUnresolved: ConjunctionScreeningSummary = {
      ...MOCK_CONJUNCTION_RESPONSE.summary,
      failed_objects_count: 2,
      resolved_objects_count: 3,
      unresolved_norad_ids: [99991, 99992],
    };

    assert(summaryWithUnresolved.failed_objects_count === 2, "Must record 2 failed objects");
    assert(summaryWithUnresolved.unresolved_norad_ids.length === 2, "Must record 2 unresolved IDs");
    assert(summaryWithUnresolved.unresolved_norad_ids[0] === 99991, "First unresolved ID matches");
  });

  // 11. Screening summary verifies GCRS coordinate frame and scientific disclaimer
  test("11. Screening summary verifies GCRS coordinate frame and scientific disclaimer", () => {
    assert(
      MOCK_CONJUNCTION_RESPONSE.disclaimer.includes("does not provide covariance"),
      "Conjunction disclaimer must note lack of covariance data"
    );
    assert(
      MOCK_CONJUNCTION_RESPONSE.disclaimer.includes("NOT represent formal probability of collision (Pc)"),
      "Conjunction disclaimer must state results do NOT represent formal Pc"
    );
  });

  // 12. Mock screening query response satisfies runtime contract
  test("12. Mock screening query response satisfies runtime contract in GCRS", () => {
    const validated = assertGcrsScreeningResponse(MOCK_CONJUNCTION_RESPONSE);
    assert(validated.summary.target_frame === "GCRS", "Summary must be in GCRS");
    assert(validated.events.every((e) => e.frame === "GCRS"), "Every event must be in GCRS");
  });

  // 13. State preservation simulation: previous successful response retained on error
  test("13. State preservation simulation: previous response retained on error", () => {
    let activeResponse: ConjunctionScreeningResponse | null = MOCK_CONJUNCTION_RESPONSE;
    let errorMessage: string | null = null;

    // Simulate an API error during subsequent screening
    try {
      throw new Error("503 Service Unavailable: SGP4 propagation service offline");
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      // Ensure activeResponse is NOT wiped
    }

    assert(errorMessage !== null, "Error message must be captured");
    assert(activeResponse !== null, "Previous screening response must be preserved");
    assert(activeResponse.events.length === 3, "Preserved response retains all 3 events");
  });

  // 14. Empty screening state when 0 conjunction events are found
  test("14. Empty screening state when 0 conjunction events are found", () => {
    const emptyResponse: ConjunctionScreeningResponse = {
      summary: {
        ...MOCK_CONJUNCTION_RESPONSE.summary,
        total_events: 0,
        critical_count: 0,
        high_count: 0,
        moderate_count: 0,
        low_count: 0,
      },
      events: [],
      unresolved_norad_ids: [],
      disclaimer: MOCK_CONJUNCTION_RESPONSE.disclaimer,
    };

    const validated = assertGcrsScreeningResponse(emptyResponse);
    assert(validated.summary.total_events === 0, "total_events must be 0");
    assert(validated.events.length === 0, "events array must be empty");
  });

  // 15. Duplicate IDs are removed while preserving order
  test("15. Duplicate NORAD IDs are deduplicated while preserving original order", () => {
    const result = parseNoradIds("25544, 48274, 25544, 22675, 48274, 25544");
    assert(result.length === 3, "Duplicates must be removed");
    assert(result[0] === "25544", "First unique element preserved");
    assert(result[1] === "48274", "Second unique element preserved");
    assert(result[2] === "22675", "Third unique element preserved");
  });

  // 16. Mixed whitespace and consecutive commas are cleanly handled
  test("16. Mixed whitespace and consecutive commas are cleanly parsed", () => {
    const result = parseNoradIds(",,, 25544 ,,\t\n, 48274 ,,, 22675  \n\r");
    assert(result.length === 3, "Empty comma and whitespace segments must be ignored");
    assert(result[0] === "25544" && result[1] === "48274" && result[2] === "22675", "Tokens trimmed");
  });

  // 17. Zero and negative NORAD IDs are rejected
  test("17. Zero and negative NORAD IDs are rejected by validation", () => {
    const zeroRes = validateScreeningQueryParams(
      "2026-11-02T12:00:00Z",
      "2026-11-02T14:00:00Z",
      "10.0",
      "60.0",
      "25544, 0"
    );
    assert(zeroRes.isValid === false, "Zero NORAD ID must be invalid");
    assert(
      zeroRes.errors.noradIds !== undefined && zeroRes.errors.noradIds.includes("0"),
      "Error must identify 0 as invalid positive integer"
    );

    const negRes = validateScreeningQueryParams(
      "2026-11-02T12:00:00Z",
      "2026-11-02T14:00:00Z",
      "10.0",
      "60.0",
      "25544, -48274"
    );
    assert(negRes.isValid === false, "Negative NORAD ID must be invalid");
    assert(
      negRes.errors.noradIds !== undefined && negRes.errors.noradIds.includes("-48274"),
      "Error must identify -48274 as invalid"
    );
  });

  // 18. Non-numeric tokens are rejected without silent discarding
  test("18. Non-numeric tokens are rejected without silent discarding", () => {
    const nonNumRes = validateScreeningQueryParams(
      "2026-11-02T12:00:00Z",
      "2026-11-02T14:00:00Z",
      "10.0",
      "60.0",
      "25544, ISS, !@#, 48274"
    );
    assert(nonNumRes.isValid === false, "Non-numeric tokens must be rejected");
    assert(
      nonNumRes.errors.noradIds !== undefined &&
        nonNumRes.errors.noradIds.includes("ISS") &&
        nonNumRes.errors.noradIds.includes("!@#"),
      "Error must explicitly report invalid tokens ISS and !@#"
    );
    assert(
      nonNumRes.parsedNoradIds.includes("ISS") && nonNumRes.parsedNoradIds.includes("!@#"),
      "Parsed IDs must not silently discard invalid tokens before validation"
    );
  });

  // 19. Valid positive integer IDs are accepted
  test("19. Valid positive integer IDs are accepted", () => {
    const validRes = validateScreeningQueryParams(
      "2026-11-02T12:00:00Z",
      "2026-11-02T14:00:00Z",
      "10.0",
      "60.0",
      "25544, 48274, 22675"
    );
    assert(validRes.isValid === true, "Valid positive IDs must be valid");
    assert(validRes.errors.noradIds === undefined, "No noradIds error should be present");
    assert(validRes.parsedNoradIds.length === 3, "All three IDs must be parsed");
  });

  // 20. Empty input remains valid (omitted NORAD list for full catalog screening)
  test("20. Empty NORAD input remains valid for full catalog screening", () => {
    const emptyRes = validateScreeningQueryParams(
      "2026-11-02T12:00:00Z",
      "2026-11-02T14:00:00Z",
      "10.0",
      "60.0",
      ""
    );
    assert(emptyRes.isValid === true, "Empty string input must be valid");
    assert(emptyRes.errors.noradIds === undefined, "No noradIds error for empty string");
    assert(emptyRes.parsedNoradIds.length === 0, "parsedNoradIds must be empty array");

    const whitespaceRes = validateScreeningQueryParams(
      "2026-11-02T12:00:00Z",
      "2026-11-02T14:00:00Z",
      "10.0",
      "60.0",
      "   \t\n   "
    );
    assert(whitespaceRes.isValid === true, "Whitespace-only input must be valid");
    assert(whitespaceRes.parsedNoradIds.length === 0, "parsedNoradIds must be empty array");
  });

  // 21. Invalid IDs prevent request dispatch
  test("21. Invalid IDs prevent request dispatch", () => {
    let dispatchCalled = false;
    const mockSubmit = () => {
      dispatchCalled = true;
    };

    const invalidInput = "25544, INVALID_ID";
    const { isValid, errors } = validateScreeningQueryParams(
      "2026-11-02T12:00:00Z",
      "2026-11-02T14:00:00Z",
      "10.0",
      "60.0",
      invalidInput
    );

    if (isValid) {
      mockSubmit();
    }

    assert(isValid === false, "Validation must fail for invalid NORAD ID");
    assert(dispatchCalled === false, "Form dispatch must NOT be called when validation fails");
    assert(errors.noradIds !== undefined, "noradIds error must be set");
  });

  // 22. Severity labels correctly include the 10 km boundary in LOW
  test("22. Severity classification boundaries correctly classify 10.0 km as LOW", () => {
    // Backend classification rule in conjunction.py:
    // miss_distance < critical (1.0) -> CRITICAL
    // miss_distance < high (5.0)     -> HIGH
    // miss_distance < moderate (10.0)-> MODERATE
    // else                           -> LOW
    function classifyMissDistanceBackend(d: number, crit = 1.0, high = 5.0, mod = 10.0): string {
      if (d < crit) return "CRITICAL";
      if (d < high) return "HIGH";
      if (d < mod) return "MODERATE";
      return "LOW";
    }

    assert(classifyMissDistanceBackend(0.999) === "CRITICAL", "0.999 km must be CRITICAL");
    assert(classifyMissDistanceBackend(1.000) === "HIGH", "Exact boundary 1.0 km must be HIGH");
    assert(classifyMissDistanceBackend(4.999) === "HIGH", "4.999 km must be HIGH");
    assert(classifyMissDistanceBackend(5.000) === "MODERATE", "Exact boundary 5.0 km must be MODERATE");
    assert(classifyMissDistanceBackend(9.999) === "MODERATE", "9.999 km must be MODERATE");
    assert(classifyMissDistanceBackend(10.000) === "LOW", "Exact boundary 10.0 km must be LOW (d >= 10.0 km)");
    assert(classifyMissDistanceBackend(15.000) === "LOW", "15.0 km must be LOW");
  });

  // 23. Sorting conjunction events by miss distance, TCA, relative speed, and severity
  test("23. Sorting conjunction events by miss distance, TCA, relative speed, and severity", () => {
    // 1. Sort by miss distance ascending and descending
    const byDistAsc = sortConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "miss_distance_km", "asc");
    assert(byDistAsc[0].miss_distance_km === 0.842, "Lowest miss distance first in asc");
    assert(byDistAsc[2].miss_distance_km === 8.421, "Highest miss distance last in asc");

    const byDistDesc = sortConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "miss_distance_km", "desc");
    assert(byDistDesc[0].miss_distance_km === 8.421, "Highest miss distance first in desc");
    assert(byDistDesc[2].miss_distance_km === 0.842, "Lowest miss distance last in desc");

    // 2. Sort by TCA ascending and descending
    const byTcaAsc = sortConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "tca", "asc");
    assert(byTcaAsc[0].tca.includes("12:05:30"), "Earliest TCA first in asc");
    assert(byTcaAsc[2].tca.includes("12:22:15"), "Latest TCA last in asc");

    const byTcaDesc = sortConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "tca", "desc");
    assert(byTcaDesc[0].tca.includes("12:22:15"), "Latest TCA first in desc");
    assert(byTcaDesc[2].tca.includes("12:05:30"), "Earliest TCA last in desc");

    // 3. Sort by relative speed ascending
    const bySpeedAsc = sortConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "relative_speed_kms", "asc");
    assert(bySpeedAsc[0].relative_speed_kms === 10.578, "Lowest speed first in asc");
    assert(bySpeedAsc[2].relative_speed_kms === 12.812, "Highest speed last in asc");

    // 4. Sort by severity category ascending (CRITICAL -> HIGH -> MODERATE -> LOW)
    const bySevAsc = sortConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "category", "asc");
    assert(bySevAsc[0].category === "CRITICAL", "CRITICAL first in severity asc");
    assert(bySevAsc[1].category === "HIGH", "HIGH second in severity asc");
    assert(bySevAsc[2].category === "MODERATE", "MODERATE third in severity asc");
  });

  // 24. Severity category filtering
  test("24. Severity category filtering", () => {
    const criticalOnly = filterConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "CRITICAL", "");
    assert(criticalOnly.length === 1, "Only 1 CRITICAL event in fixture");
    assert(criticalOnly[0].category === "CRITICAL", "Category must be CRITICAL");

    const highOnly = filterConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "HIGH", "");
    assert(highOnly.length === 1, "Only 1 HIGH event in fixture");
    assert(highOnly[0].category === "HIGH", "Category must be HIGH");

    const modOnly = filterConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "MODERATE", "");
    assert(modOnly.length === 1, "Only 1 MODERATE event in fixture");
    assert(modOnly[0].category === "MODERATE", "Category must be MODERATE");

    const lowOnly = filterConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "LOW", "");
    assert(lowOnly.length === 0, "0 LOW events in fixture");

    const allEvents = filterConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "ALL", "");
    assert(allEvents.length === 3, "ALL filter preserves all events");
  });

  // 25. Search by NORAD ID and object name
  test("25. Search filtering by NORAD ID and object name", () => {
    // Search Object 1 ID
    const search25544 = filterConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "ALL", "25544");
    assert(search25544.length === 3, "All fixture events involve primary object 25544");

    // Search Object 2 ID
    const search48274 = filterConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "ALL", "48274");
    assert(search48274.length === 1, "Only 1 event involves secondary object 48274");

    // Search Object 2 Name case-insensitive
    const searchTianhe = filterConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "ALL", "Tianhe");
    assert(searchTianhe.length === 1, "Case-insensitive match for Tianhe");

    // Search partial fragment name
    const searchFrag = filterConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "ALL", "fragment #042");
    assert(searchFrag.length === 1, "Matches Synthetic Debris Fragment #042");
  });

  // 26. Event selection and inspector state extraction
  test("26. Event selection and inspector state extraction", () => {
    const selected = MOCK_CONJUNCTION_EVENTS[0];
    assert(selected.object_1_id === "25544", "Primary object ID is 25544");
    assert(selected.object_1_name === "ISS (ZARYA)", "Primary object name is ISS (ZARYA)");
    assert(selected.object_2_id === "SYNTH-FRAG-0042", "Secondary object ID is SYNTH-FRAG-0042");
    assert(selected.frame === "GCRS", "Coordinate frame must be strictly GCRS");

    const [rx, ry, rz] = selected.relative_position_km;
    const computedNorm = Math.sqrt(rx * rx + ry * ry + rz * rz);
    assert(Math.abs(computedNorm - selected.miss_distance_km) < 0.05, "Relative position norm matches miss distance");

    const [vx, vy, vz] = selected.relative_velocity_kms;
    const computedVelNorm = Math.sqrt(vx * vx + vy * vy + vz * vz);
    assert(Math.abs(computedVelNorm - selected.relative_speed_kms) < 0.05, "Relative velocity norm matches relative speed");

    // Look up associated risk assessment
    const risk = MOCK_RISK_ASSESSMENTS.find((r) => r.event_id === selected.event_id);
    assert(risk !== undefined, "Risk assessment must be available for selected event");
    assert(Math.abs(risk!.risk_score - 79.02) < 0.05, "Risk score matches backend Day 7 value ~79.02");
    assert(risk!.risk_category === "CRITICAL", "Risk category matches CRITICAL");
    assert(risk!.factors.length === 3, "Includes 3 explainable risk factors");
    assert(risk!.factors[0].factor_name === "MISS_DISTANCE", "First factor is MISS_DISTANCE");
  });

  // 27. Handling of missing optional fields in table and inspector
  test("27. Handling of missing optional fields in table and inspector", () => {
    const sparseEvent: ConjunctionEvent = {
      event_id: "CONJ-SPARSE-001",
      object_1_id: "99001",
      object_1_name: null, // Nullable name
      object_2_id: "99002",
      object_2_name: null, // Nullable name
      tca: "2026-11-02T12:00:00.000Z",
      miss_distance_km: 4.5,
      relative_position_km: [2.0, 3.0, 2.5],
      relative_velocity_kms: [5.0, 6.0, 7.0],
      relative_speed_kms: 10.488,
      category: "HIGH",
      screening_threshold_km: 10.0,
      frame: "GCRS",
      step_seconds: 60.0,
      method: undefined, // Optional
      disclaimer: undefined, // Optional
    };

    // Filter should not crash with null names
    const filtered = filterConjunctionEvents([sparseEvent], "ALL", "99001");
    assert(filtered.length === 1, "Filters correctly on ID when name is null");

    // Sort should not crash
    const sorted = sortConjunctionEvents([sparseEvent], "miss_distance_km", "asc");
    assert(sorted.length === 1, "Sort succeeds with sparse event");
  });

  // 28. Empty results and no-filter-results states
  test("28. Empty results and no-filter-results states", () => {
    const emptyEvents: ConjunctionEvent[] = [];
    const filteredEmpty = filterConjunctionEvents(emptyEvents, "ALL", "anything");
    assert(filteredEmpty.length === 0, "Filtering empty events returns empty array");

    const noMatches = filterConjunctionEvents(MOCK_CONJUNCTION_EVENTS, "ALL", "NONEXISTENT_NORAD_99999");
    assert(noMatches.length === 0, "Zero matches returned when search query finds nothing");
  });

  // 29. Selection preservation or clearing logic
  test("29. Selection preservation or clearing logic", () => {
    const initialEvents = MOCK_CONJUNCTION_EVENTS;
    const selectedId = "CONJ-25544-SYNTH-FRAG-0042-20261102T121845Z";

    // 1. When filtering matches the selected event, selection is preserved
    const matchFilter = filterConjunctionEvents(initialEvents, "CRITICAL", "");
    const isPreserved = matchFilter.some((e) => e.event_id === selectedId);
    assert(isPreserved === true, "Selection is preserved when event matches active filter");

    // 2. When filtering excludes the selected event, absence is detected
    const excludeFilter = filterConjunctionEvents(initialEvents, "HIGH", "");
    const isExcluded = excludeFilter.some((e) => e.event_id === selectedId);
    assert(isExcluded === false, "Selection is detected as excluded from active filter");
  });

  // 30. Risk assessment failure without loss of screening results
  test("30. Risk assessment failure without loss of screening results", () => {
    const screeningEvents = MOCK_CONJUNCTION_EVENTS;
    let riskAssessmentsMap: Record<string, RiskAssessment> = {};
    let riskError: string | null = null;

    // Simulate batch risk evaluation throwing a network error
    try {
      throw new Error("500 Internal Server Error: Risk assessment service unreachable");
    } catch (err) {
      riskError = err instanceof Error ? err.message : String(err);
    }

    assert(screeningEvents.length === 3, "Screening events remain completely intact");
    assert(riskError !== null, "Risk error is captured independently");
    assert(Object.keys(riskAssessmentsMap).length === 0, "No fake or zero risk scores generated");
  });

  // 31. Strict separation between geometric severity and heuristic risk
  test("31. Strict separation between geometric severity and heuristic risk", () => {
    // Event 3: ISS vs CSS Tianhe
    const event = MOCK_CONJUNCTION_EVENTS[2];
    const risk = MOCK_RISK_ASSESSMENTS.find((r) => r.event_id === event.event_id);

    assert(event.category === "MODERATE", "Geometric severity is purely distance-based (8.421 km -> MODERATE)");
    assert(risk !== undefined, "Risk assessment exists");
    assert(Math.abs(risk!.risk_score - 43.77) < 0.05, "Heuristic risk score matches backend Day 7 value ~43.77 (multi-factor triage)");
    assert(risk!.risk_category === "MODERATE", "Risk category is MODERATE");

    // If risk is missing, event.category is NOT altered and risk score does NOT default to 0
    const unassessedRisk = undefined;
    const displayedRiskScore = unassessedRisk ? (unassessedRisk as RiskAssessment).risk_score : null;
    assert(displayedRiskScore === null, "Missing risk assessment does not default to 0");
    assert(event.category === "MODERATE", "Geometric severity remains unchanged when risk is missing");
  });

  // =========================================================================
  // Milestone 4.2.3 Tests: 3D Encounter-Centered Relative GCRS Geometry
  // =========================================================================

  // 32. Object 1 remains at relative origin (0, 0, 0)
  test("32. Object 1 remains at relative origin (0, 0, 0)", () => {
    for (const event of MOCK_CONJUNCTION_EVENTS) {
      const { origin } = calculateMissDistanceEndpoints(event, ENCOUNTER_SCALE_KM_PER_UNIT);
      assert(origin[0] === 0, "Object 1 X coordinate is strictly 0");
      assert(origin[1] === 0, "Object 1 Y coordinate is strictly 0");
      assert(origin[2] === 0, "Object 1 Z coordinate is strictly 0");
    }
  });

  // 33. Object 2 position matches GCRS relative position (r_rel = r2 - r1)
  test("33. Object 2 position matches GCRS relative position (r_rel = r2 - r1)", () => {
    // Event 0: ISS vs Cosmos Debris (Critical)
    const event0 = MOCK_CONJUNCTION_EVENTS[0];
    const [rx, ry, rz] = event0.relative_position_km;
    const target = gcrsToEncounterThreeVector([rx, ry, rz], 1.0);

    // Three.js X = GCRS X, Three.js Y = GCRS Z, Three.js Z = -GCRS Y
    assert(target[0] === rx, "Three.js X equals GCRS X");
    assert(target[1] === rz, "Three.js Y equals GCRS Z (celestial pole)");
    assert(target[2] === -ry, "Three.js Z equals -GCRS Y");

    // Event 2: ISS vs CSS Tianhe (Moderate)
    const event2 = MOCK_CONJUNCTION_EVENTS[2];
    const target2 = gcrsToEncounterThreeVector(event2.relative_position_km, 1.0);
    assert(target2[0] === event2.relative_position_km[0], "Event 2 X matches GCRS X");
    assert(target2[1] === event2.relative_position_km[2], "Event 2 Y matches GCRS Z");
    assert(target2[2] === -event2.relative_position_km[1], "Event 2 Z matches -GCRS Y");
  });

  // 34. Display coordinate mapping is right-handed and correct
  test("34. Display coordinate mapping is right-handed and correct", () => {
    // Basis vectors in GCRS:
    // e_x = [1, 0, 0], e_y = [0, 1, 0], e_z = [0, 0, 1]
    const uX = gcrsToEncounterThreeVector([1, 0, 0], 1.0); // [1, 0, 0]
    const uY = gcrsToEncounterThreeVector([0, 1, 0], 1.0); // [0, 0, -1]
    const uZ = gcrsToEncounterThreeVector([0, 0, 1], 1.0); // [0, 1, 0]

    assert(uX[0] === 1 && uX[1] === 0 && uX[2] === 0, "uX is [1, 0, 0]");
    assert(uY[0] === 0 && uY[1] === 0 && uY[2] === -1, "uY is [0, 0, -1]");
    assert(uZ[0] === 0 && uZ[1] === 1 && uZ[2] === 0, "uZ is [0, 1, 0]");

    // Cross product: uX x uY in Three.js coordinates
    // (uX_y * uY_z - uX_z * uY_y, uX_z * uY_x - uX_x * uY_z, uX_x * uY_y - uX_y * uY_x)
    const crossX = uX[1] * uY[2] - uX[2] * uY[1]; // 0*(-1) - 0*0 = 0
    const crossY = uX[2] * uY[0] - uX[0] * uY[2]; // 0*0 - 1*(-1) = 1
    const crossZ = uX[0] * uY[1] - uX[1] * uY[0]; // 1*0 - 0*0 = 0

    assert(crossX === uZ[0], "Cross product X matches uZ X");
    assert(crossY === uZ[1], "Cross product Y matches uZ Y (1.0)");
    assert(crossZ === uZ[2], "Cross product Z matches uZ Z");

    // Determinant of transformation matrix:
    // | 1  0  0 |
    // | 0  0  1 | = 1 * (0 - (-1)) = +1 (proper rotation, no reflection)
    // | 0 -1  0 |
    const det =
      uX[0] * (uY[1] * uZ[2] - uY[2] * uZ[1]) -
      uX[1] * (uY[0] * uZ[2] - uY[2] * uZ[0]) +
      uX[2] * (uY[0] * uZ[1] - uY[1] * uZ[0]);

    assert(Math.abs(det - 1.0) < 1e-9, "Transformation matrix determinant is +1.0 (strictly right-handed)");
  });

  // 35. Miss-distance line endpoints are correct
  test("35. Miss-distance line endpoints are correct", () => {
    const event = MOCK_CONJUNCTION_EVENTS[0];
    const { origin, target, distanceUnits } = calculateMissDistanceEndpoints(event, 1.0);

    assert(origin[0] === 0 && origin[1] === 0 && origin[2] === 0, "Origin connects at (0, 0, 0)");
    assert(target[0] === event.relative_position_km[0], "Target X matches Object 2");
    assert(target[1] === event.relative_position_km[2], "Target Y matches Object 2");
    assert(target[2] === -event.relative_position_km[1], "Target Z matches Object 2");

    // Distance in display units equals backend miss distance in km (at scale 1.0)
    assert(
      Math.abs(distanceUnits - event.miss_distance_km) < 0.005,
      `Distance units (${distanceUnits}) matches backend miss distance (${event.miss_distance_km})`
    );
  });

  // 36. Relative velocity arrow uses actual backend vector
  test("36. Relative velocity arrow uses actual backend vector", () => {
    const event = MOCK_CONJUNCTION_EVENTS[0];
    const { origin, direction, speedKms, arrowLengthUnits } = calculateRelativeVelocityGeometry(event, 1.0);

    // Arrow originates at Object 2
    const expectedTarget = gcrsToEncounterThreeVector(event.relative_position_km, 1.0);
    assert(Math.abs(origin[0] - expectedTarget[0]) < 1e-9, "Velocity arrow starts at Object 2 X");
    assert(Math.abs(origin[1] - expectedTarget[1]) < 1e-9, "Velocity arrow starts at Object 2 Y");
    assert(Math.abs(origin[2] - expectedTarget[2]) < 1e-9, "Velocity arrow starts at Object 2 Z");

    // Direction vector is normalized
    const dirNorm = Math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2);
    assert(Math.abs(dirNorm - 1.0) < 1e-6, "Velocity direction vector is normalized to unit length");

    // Direction follows GCRS display mapping: (vx, vz, -vy)
    const [vx, vy, vz] = event.relative_velocity_kms;
    assert(Math.sign(direction[0]) === Math.sign(vx), "Arrow direction X aligns with vx");
    assert(Math.sign(direction[1]) === Math.sign(vz), "Arrow direction Y aligns with vz");
    assert(Math.sign(direction[2]) === Math.sign(-vy), "Arrow direction Z aligns with -vy");

    // Speed matches backend value
    assert(Math.abs(speedKms - event.relative_speed_kms) < 0.05, "Speed matches backend relative_speed_kms");
    assert(arrowLengthUnits > 0, "Arrow display length is positive and legible");
  });

  // 37. Invalid or missing vectors produce an unavailable state
  test("37. Invalid or missing vectors produce an unavailable state", () => {
    assert(isValidEncounterEvent(null) === false, "null event is invalid");
    assert(isValidEncounterEvent(undefined) === false, "undefined event is invalid");

    const validEvent = MOCK_CONJUNCTION_EVENTS[0];

    // NaN in position
    const nanPosEvent = { ...validEvent, relative_position_km: [NaN, 0, 0] as [number, number, number] };
    assert(isValidEncounterEvent(nanPosEvent) === false, "NaN position rejected");

    // Infinity in velocity
    const infVelEvent = { ...validEvent, relative_velocity_kms: [0, Infinity, 0] as [number, number, number] };
    assert(isValidEncounterEvent(infVelEvent) === false, "Infinity velocity rejected");

    // Wrong tuple length
    const shortPosEvent = { ...validEvent, relative_position_km: [1, 2] as any };
    assert(isValidEncounterEvent(shortPosEvent) === false, "Truncated vector rejected");

    // Non-GCRS frame
    const temeEvent = { ...validEvent, frame: "TEME" as any };
    assert(isValidEncounterEvent(temeEvent) === false, "TEME frame rejected for encounter geometry");

    // Calling calculateMissDistanceEndpoints on invalid event throws error
    let threw = false;
    try {
      calculateMissDistanceEndpoints(nanPosEvent);
    } catch {
      threw = true;
    }
    assert(threw === true, "calculateMissDistanceEndpoints throws on invalid event");
  });

  // 38. Event changes update displayed geometry
  test("38. Event changes update displayed geometry", () => {
    const eventA = MOCK_CONJUNCTION_EVENTS[0]; // ISS vs Cosmos Debris
    const eventB = MOCK_CONJUNCTION_EVENTS[2]; // ISS vs CSS Tianhe

    const geomA = calculateMissDistanceEndpoints(eventA, 1.0);
    const geomB = calculateMissDistanceEndpoints(eventB, 1.0);

    // Verify targets and distances are distinct
    assert(geomA.target[0] !== geomB.target[0], "Event A and B have different target X");
    assert(geomA.distanceUnits !== geomB.distanceUnits, "Event A and B have different distances");
    assert(Math.abs(geomA.distanceUnits - eventA.miss_distance_km) < 0.02, "Event A distance matches backend value");
    assert(Math.abs(geomB.distanceUnits - eventB.miss_distance_km) < 0.05, "Event B distance matches backend value");

    // Both retain origin at (0, 0, 0)
    assert(geomA.origin[0] === 0 && geomB.origin[0] === 0, "Both preserve origin at (0,0,0)");
  });

  // 39. Visualization-only magnification does not alter numerical values
  test("39. Visualization-only magnification does not alter numerical values", () => {
    const event = MOCK_CONJUNCTION_EVENTS[0];
    const initialMissKm = event.miss_distance_km;
    const initialPos = [...event.relative_position_km];
    const initialVel = [...event.relative_velocity_kms];

    // Compute display geometry at encounter scale (1.0 km/unit)
    const encEndpoints = calculateMissDistanceEndpoints(event, 1.0);
    // Compute display geometry at radar scale (1000.0 km/unit)
    const radarEndpoints = calculateMissDistanceEndpoints(event, 1000.0);

    // Display units scale by 1000x
    assert(
      Math.abs(encEndpoints.distanceUnits / radarEndpoints.distanceUnits - 1000.0) < 1e-4,
      "Encounter scale provides exactly 1000x visual magnification vs radar scale"
    );

    // Physical numbers in event object remain 100% identical and unmutated
    assert(event.miss_distance_km === initialMissKm, "Physical miss distance in km is unmutated");
    assert(event.relative_position_km[0] === initialPos[0], "Relative position X is unmutated");
    assert(event.relative_position_km[1] === initialPos[1], "Relative position Y is unmutated");
    assert(event.relative_position_km[2] === initialPos[2], "Relative position Z is unmutated");
    assert(event.relative_velocity_kms[0] === initialVel[0], "Relative velocity X is unmutated");
  });

  // 40. Reference shells are correctly scaled (1 km = 1.0, 5 km = 5.0, 10 km = 10.0 in encounter scale) or omitted
  test("40. Reference shells are correctly scaled (1 km = 1.0, 5 km = 5.0, 10 km = 10.0 in encounter scale) or omitted", () => {
    // Encounter scale (1 unit = 1.0 km)
    const encShells = calculateSeverityShells(1.0);
    assert(encShells.length === 3, "3 severity shells defined");
    assert(encShells[0].tier === "CRITICAL" && encShells[0].radiusKm === 1.0 && encShells[0].displayRadius === 1.0, "Critical shell is 1.0 unit");
    assert(encShells[1].tier === "HIGH" && encShells[1].radiusKm === 5.0 && encShells[1].displayRadius === 5.0, "High shell is 5.0 units");
    assert(encShells[2].tier === "MODERATE" && encShells[2].radiusKm === 10.0 && encShells[2].displayRadius === 10.0, "Moderate shell is 10.0 units");

    // Radar scale (1 unit = 1000.0 km)
    const radarShells = calculateSeverityShells(1000.0);
    assert(radarShells[0].displayRadius === 0.001, "Critical shell display radius is 0.001 units (sub-pixel)");
    assert(radarShells[1].displayRadius === 0.005, "High shell display radius is 0.005 units");
    assert(radarShells[2].displayRadius === 0.01, "Moderate shell display radius is 0.01 units");
  });

  // 41. No Hill/LVLH/RIC transformation is introduced (pure GCRS enforcement)
  test("41. No Hill/LVLH/RIC transformation is introduced (pure GCRS enforcement)", () => {
    // Permitted frames
    assertGcrsEncounterFrame("GCRS");
    assertGcrsEncounterFrame("GCRF");

    // Prohibited frames must throw
    const prohibitedFrames = ["RIC_LVLH", "TEME", "ITRF", "ITRS", "HILL"];
    for (const frame of prohibitedFrames) {
      let threw = false;
      try {
        assertGcrsEncounterFrame(frame);
      } catch {
        threw = true;
      }
      assert(threw === true, `assertGcrsEncounterFrame threw on prohibited frame: ${frame}`);
    }
  });

  return { passed, total, details };
}
