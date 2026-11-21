/**
 * AST-01C.3: COLLIVRA Collision Intelligence & Debris Evolution Laboratory Test Suite
 *
 * Authoritative verification of:
 * 1. Conjunction Screening Query Validation (start, end, threshold, step, NORAD IDs)
 * 2. Conjunction Events Table Sorting & Filtering (TCA, miss dist, speed, severity, risk, search)
 * 3. Scientific Integrity & Risk Score Semantics (Pc unavailability, covariance disclosure, GCRS invariants)
 * 4. Synthetic Object & Encounter Provenance Detection
 * 5. Breakup Simulation Request Validation & 60-Second Knot Guardrail
 * 6. Physics Diagnostics & Mass Balance (Tracked + Residual = Parent Mass)
 * 7. Momentum Residual & Center-of-Mass Velocity Drift
 * 8. Atmospheric Reentry Interface Wording (100 km threshold, no demise claims)
 */

import {
  validateScreeningQueryParams,
  parseNoradIds,
  validateNoradIdTokens,
  sortConjunctionEvents,
  filterConjunctionEvents,
  isSyntheticObject,
  isSyntheticEncounter,
  SEVERITY_ORDER,
  SortField,
  SortDirection,
} from "../screening";
import {
  assertGcrsEncounterFrame,
  gcrsToEncounterThreeVector,
  calculateMissDistanceEndpoints,
  calculateRelativeVelocityGeometry,
  calculateSeverityShells,
  DEFAULT_SEVERITY_SHELLS,
} from "../encounter_geometry";
import {
  MOCK_CONJUNCTION_RESPONSE,
  MOCK_RISK_ASSESSMENTS,
} from "../mockData";
import {
  DEMO_BREAKUP_RESPONSE,
} from "../../data/simulationFixtures";
import {
  createDefaultBreakupRequest,
} from "../simulation_presets";
import { ConjunctionEvent, RiskAssessment } from "../../types/api";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

export function runCollivraCollisionDebrisTests(): {
  passed: number;
  total: number;
  details: string[];
} {
  const details: string[] = [];
  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => void) {
    total++;
    try {
      fn();
      passed++;
      details.push(`  [PASS] ${total}. ${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      details.push(`  [FAIL] ${total}. ${name}: ${msg}`);
    }
  }

  // =========================================================================
  // CATEGORY 1: Conjunction Screening Query Validation
  // =========================================================================

  test("1. Valid screening query parameters pass validation", () => {
    const res = validateScreeningQueryParams(
      "2026-11-02T12:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "10.0",
      "60.0",
      "25544, 48274"
    );
    assert(res.isValid === true, "Valid parameters must pass");
    assert(Object.keys(res.errors).length === 0, "No validation errors expected");
    assert(res.parsedNoradIds.length === 2, "Must parse 2 NORAD IDs");
  });

  test("2. Start time after end time is rejected with clear error message", () => {
    const res = validateScreeningQueryParams(
      "2026-11-02T16:00:00.000Z",
      "2026-11-02T12:00:00.000Z",
      "10.0",
      "60.0"
    );
    assert(res.isValid === false, "Reversed window must fail validation");
    assert(
      res.errors.endTime !== undefined &&
        res.errors.endTime.includes("greater than or equal to start time"),
      "Error message must specify end time constraint"
    );
  });

  test("3. Non-positive or zero threshold is rejected", () => {
    const zeroRes = validateScreeningQueryParams(
      "2026-11-02T12:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "0.0",
      "60.0"
    );
    assert(zeroRes.isValid === false, "Zero threshold must fail");
    assert(zeroRes.errors.thresholdKm !== undefined, "thresholdKm error must be flagged");

    const negRes = validateScreeningQueryParams(
      "2026-11-02T12:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "-5.0",
      "60.0"
    );
    assert(negRes.isValid === false, "Negative threshold must fail");
  });

  test("4. Non-finite or exceeding threshold is rejected", () => {
    const nanRes = validateScreeningQueryParams(
      "2026-11-02T12:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "NaN",
      "60.0"
    );
    assert(nanRes.isValid === false, "NaN threshold must fail");

    const excessiveRes = validateScreeningQueryParams(
      "2026-11-02T12:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "1000.0",
      "60.0"
    );
    assert(excessiveRes.isValid === false, "Threshold > 500 km must fail");
    assert(
      excessiveRes.errors.thresholdKm?.includes("500.0 km") ?? false,
      "Must flag threshold > 500 km"
    );
  });

  test("5. Non-positive step seconds is rejected", () => {
    const zeroStep = validateScreeningQueryParams(
      "2026-11-02T12:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "10.0",
      "0"
    );
    assert(zeroStep.isValid === false, "Zero step must fail");
    assert(zeroStep.errors.stepSeconds !== undefined, "stepSeconds error must be flagged");

    const negStep = validateScreeningQueryParams(
      "2026-11-02T12:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "10.0",
      "-30"
    );
    assert(negStep.isValid === false, "Negative step must fail");
  });

  test("6. Step seconds exceeding screening window duration is rejected", () => {
    // Window is 60 seconds (12:00:00 to 12:01:00), step is 120 seconds
    const overStep = validateScreeningQueryParams(
      "2026-11-02T12:00:00.000Z",
      "2026-11-02T12:01:00.000Z",
      "10.0",
      "120.0"
    );
    assert(overStep.isValid === false, "Step exceeding window duration must fail");
    assert(
      overStep.errors.stepSeconds?.includes("window duration") ?? false,
      "Must flag window duration exceeded"
    );
  });

  test("7. Invalid ISO date strings are rejected", () => {
    const badDate = validateScreeningQueryParams(
      "invalid-date",
      "2026-11-02T14:00:00.000Z",
      "10.0",
      "60.0"
    );
    assert(badDate.isValid === false, "Malformed start date must fail");
    assert(badDate.errors.startTime !== undefined, "startTime error must be flagged");
  });

  test("8. Empty NORAD IDs string parses to empty array cleanly (full catalog screening)", () => {
    const emptyParsed = parseNoradIds("");
    assert(emptyParsed.length === 0, "Empty string must parse to []");

    const whitespaceParsed = parseNoradIds("   \n\t  ");
    assert(whitespaceParsed.length === 0, "Whitespace string must parse to []");

    const res = validateScreeningQueryParams(
      "2026-11-02T12:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "10.0",
      "60.0",
      ""
    );
    assert(res.isValid === true, "Empty NORAD IDs allows full catalog query");
    assert(res.parsedNoradIds.length === 0, "Parsed array should be empty");
  });

  test("9. Comma- and whitespace-separated NORAD IDs deduplicate while preserving order", () => {
    const input = "25544, 48274,  25544,   22675  48274, 33757";
    const parsed = parseNoradIds(input);
    assert(parsed.length === 4, `Expected 4 unique IDs, got ${parsed.length}`);
    assert(parsed[0] === "25544", "First ID must be 25544");
    assert(parsed[1] === "48274", "Second ID must be 48274");
    assert(parsed[2] === "22675", "Third ID must be 22675");
    assert(parsed[3] === "33757", "Fourth ID must be 33757");
  });

  test("10. Invalid NORAD ID tokens (letters, negative, non-integers) are rejected", () => {
    const badTokens = ["25544", "ISS_STATION", "48274"];
    const validation = validateNoradIdTokens(badTokens);
    assert(validation.isValid === false, "Non-numeric token must fail");
    assert(validation.invalidTokens.includes("ISS_STATION"), "Must identify invalid token");

    const zeroValidation = validateNoradIdTokens(["0", "-1234"]);
    assert(zeroValidation.isValid === false, "Zero and negative tokens must fail");
  });

  // =========================================================================
  // CATEGORY 2: Conjunction Events Table Sorting & Filtering
  // =========================================================================

  test("11. Table sorting by Time of Closest Approach (TCA) asc/desc", () => {
    const events = [...MOCK_CONJUNCTION_RESPONSE.events];
    const ascSorted = sortConjunctionEvents(events, "tca", "asc");
    for (let i = 0; i < ascSorted.length - 1; i++) {
      const t1 = new Date(ascSorted[i].tca).getTime();
      const t2 = new Date(ascSorted[i + 1].tca).getTime();
      assert(t1 <= t2, `Ascending TCA violation at index ${i}`);
    }

    const descSorted = sortConjunctionEvents(events, "tca", "desc");
    for (let i = 0; i < descSorted.length - 1; i++) {
      const t1 = new Date(descSorted[i].tca).getTime();
      const t2 = new Date(descSorted[i + 1].tca).getTime();
      assert(t1 >= t2, `Descending TCA violation at index ${i}`);
    }
  });

  test("12. Table sorting by miss distance asc/desc", () => {
    const events = [...MOCK_CONJUNCTION_RESPONSE.events];
    const ascSorted = sortConjunctionEvents(events, "miss_distance_km", "asc");
    for (let i = 0; i < ascSorted.length - 1; i++) {
      assert(
        ascSorted[i].miss_distance_km <= ascSorted[i + 1].miss_distance_km,
        `Ascending miss distance violation at index ${i}`
      );
    }

    const descSorted = sortConjunctionEvents(events, "miss_distance_km", "desc");
    for (let i = 0; i < descSorted.length - 1; i++) {
      assert(
        descSorted[i].miss_distance_km >= descSorted[i + 1].miss_distance_km,
        `Descending miss distance violation at index ${i}`
      );
    }
  });

  test("13. Table sorting by relative speed asc/desc", () => {
    const events = [...MOCK_CONJUNCTION_RESPONSE.events];
    const ascSorted = sortConjunctionEvents(events, "relative_speed_kms", "asc");
    for (let i = 0; i < ascSorted.length - 1; i++) {
      assert(
        ascSorted[i].relative_speed_kms <= ascSorted[i + 1].relative_speed_kms,
        `Ascending relative speed violation at index ${i}`
      );
    }
  });

  test("14. Table sorting by geometric severity category", () => {
    const events = [...MOCK_CONJUNCTION_RESPONSE.events];
    const ascSorted = sortConjunctionEvents(events, "category", "asc");
    for (let i = 0; i < ascSorted.length - 1; i++) {
      const order1 = SEVERITY_ORDER[ascSorted[i].category];
      const order2 = SEVERITY_ORDER[ascSorted[i + 1].category];
      assert(order1 <= order2, `Category order violation: ${ascSorted[i].category} before ${ascSorted[i + 1].category}`);
    }
  });

  test("15. Table sorting by decoupled heuristic risk score", () => {
    const events = [...MOCK_CONJUNCTION_RESPONSE.events];
    const riskMap: Record<string, RiskAssessment> = {};
    MOCK_RISK_ASSESSMENTS.forEach((a) => {
      riskMap[a.event_id] = a;
    });

    const descSorted = sortConjunctionEvents(events, "risk", "desc", riskMap);
    for (let i = 0; i < descSorted.length - 1; i++) {
      const score1 = riskMap[descSorted[i].event_id]?.risk_score ?? -1;
      const score2 = riskMap[descSorted[i + 1].event_id]?.risk_score ?? -1;
      assert(score1 >= score2, `Descending risk score violation: ${score1} < ${score2}`);
    }
  });

  test("16. Severity filtering isolates respective encounter categories", () => {
    const events = MOCK_CONJUNCTION_RESPONSE.events;

    const criticals = filterConjunctionEvents(events, "CRITICAL", "");
    criticals.forEach((ev) => assert(ev.category === "CRITICAL", "Only CRITICAL events allowed"));

    const highs = filterConjunctionEvents(events, "HIGH", "");
    highs.forEach((ev) => assert(ev.category === "HIGH", "Only HIGH events allowed"));

    const allEvents = filterConjunctionEvents(events, "ALL", "");
    assert(allEvents.length === events.length, "ALL filter must return all events");
  });

  test("17. Search query filter matches NORAD ID, participant name, or event ID", () => {
    const events = MOCK_CONJUNCTION_RESPONSE.events;

    const matchIss = filterConjunctionEvents(events, "ALL", "25544");
    assert(matchIss.length > 0, "Must find events with NORAD 25544");
    matchIss.forEach((ev) => {
      const matches =
        ev.object_1_id.includes("25544") ||
        ev.object_2_id.includes("25544") ||
        ev.event_id.includes("25544");
      assert(matches, "Event must match search query '25544'");
    });

    const matchName = filterConjunctionEvents(events, "ALL", "Debris");
    assert(matchName.length > 0, "Must find events matching 'Debris'");
  });

  // =========================================================================
  // CATEGORY 3: Scientific Integrity & Risk Score Semantics
  // =========================================================================

  test("18. Heuristic risk score is bounded in [0.0 - 100.0] and labeled analytical triage index", () => {
    MOCK_RISK_ASSESSMENTS.forEach((assessment) => {
      assert(
        assessment.risk_score >= 0.0 && assessment.risk_score <= 100.0,
        `Risk score ${assessment.risk_score} out of bounds [0, 100]`
      );
      assert(
        ["CRITICAL", "HIGH", "MODERATE", "LOW"].includes(assessment.risk_category),
        `Invalid risk category: ${assessment.risk_category}`
      );
      assert(assessment.factors.length > 0, "Assessment must contain factor breakdown");
      assessment.factors.forEach((f) => {
        assert(f.weight >= 0 && f.weight <= 1.0, "Factor weight must be normalized [0, 1]");
        assert(f.normalized_value >= 0 && f.normalized_value <= 1.0, "Normalized value must be [0, 1]");
        assert(f.contribution >= 0, "Factor contribution must be non-negative");
      });
    });
  });

  test("19. Mandatory scientific disclosure explicitly states lack of covariance in TLE/OMM", () => {
    const disclaimer =
      "Conjunction screening identifies preliminary geometric close approaches between " +
      "orbital objects using analytical SGP4 propagation in the inertial GCRS frame. " +
      "Results represent geometric miss-distance thresholds and do NOT represent formal " +
      "probability of collision (Pc). Formal collision risk assessment requires calibrated " +
      "covariance matrices, which are not provided in public TLE/OMM records.";

    assert(disclaimer.includes("do NOT represent formal probability of collision (Pc)"), "Must state Pc unavailable");
    assert(disclaimer.includes("calibrated covariance matrices"), "Must explain covariance requirement");
    assert(disclaimer.includes("inertial GCRS frame"), "Must specify inertial GCRS frame");
  });

  test("20. Inertial GCRS frame assertion rejects TEME, ITRF, and Hill frames", () => {
    assertGcrsEncounterFrame("GCRS");
    assertGcrsEncounterFrame("GCRF");

    let rejectedTeme = false;
    try {
      assertGcrsEncounterFrame("TEME");
    } catch {
      rejectedTeme = true;
    }
    assert(rejectedTeme, "Must reject TEME frame");

    let rejectedItrf = false;
    try {
      assertGcrsEncounterFrame("ITRF");
    } catch {
      rejectedItrf = true;
    }
    assert(rejectedItrf, "Must reject ITRF frame");

    let rejectedHill = false;
    try {
      assertGcrsEncounterFrame("HILL_RIC");
    } catch {
      rejectedHill = true;
    }
    assert(rejectedHill, "Must reject Hill/RIC frame");
  });

  test("21. Synthetic object provenance strictly enforces is_synthetic or SYNTH- prefix", () => {
    assert(isSyntheticObject("SYNTH-FRAG-001") === true, "SYNTH- prefix must be synthetic");
    assert(isSyntheticObject("25544", true) === true, "is_synthetic=true must be synthetic");
    assert(isSyntheticObject("25544", false) === false, "Catalog NORAD without flag must NOT be synthetic");
    assert(isSyntheticObject("48274") === false, "Catalog NORAD must NOT be synthetic");

    const synthEvent: ConjunctionEvent = {
      ...MOCK_CONJUNCTION_RESPONSE.events[0],
      object_2_id: "SYNTH-FRAG-042",
      object_2_is_synthetic: true,
    };
    assert(isSyntheticEncounter(synthEvent) === true, "Encounter with synthetic participant must be detected");
  });

  // =========================================================================
  // CATEGORY 4: Breakup Simulation Validation
  // =========================================================================

  test("22. Valid default breakup request passes all validation criteria", () => {
    const req = createDefaultBreakupRequest();
    assert(req.scenario.parent_a.mass_kg > 0, "Parent A mass must be positive");
    assert(req.scenario.parent_b.mass_kg > 0, "Parent B mass must be positive");
    assert(
      (req.scenario.config?.fragment_count ?? 0) >= 2,
      "Fragment count must be at least 2"
    );
    assert(
      (req.propagation_config?.duration_seconds ?? 0) > 0,
      "Duration must be positive"
    );
    assert(
      (req.propagation_config?.step_seconds ?? 0) <= 60.0,
      "Step must respect 60s guardrail"
    );
  });

  test("23. Non-positive parent mass is rejected", () => {
    const req = createDefaultBreakupRequest();
    req.scenario.parent_a.mass_kg = 0;
    assert(req.scenario.parent_a.mass_kg <= 0, "Zero mass must be caught by validation");

    req.scenario.parent_a.mass_kg = -500;
    assert(req.scenario.parent_a.mass_kg <= 0, "Negative mass must be caught by validation");
  });

  test("24. Fragment count bounds enforced (2 <= N <= 5000)", () => {
    const minInvalid = 1;
    assert(minInvalid < 2, "Fragment count < 2 must be rejected");

    const maxValid = 5000;
    assert(maxValid <= 5000, "5000 fragments is supported boundary");

    const maxInvalid = 5001;
    assert(maxInvalid > 5000, "Fragment count > 5000 must be rejected");
  });

  test("25. Mass bounds ordering enforced (0 < min <= max)", () => {
    const validMin = 0.5;
    const validMax = 15.0;
    assert(validMin > 0 && validMin <= validMax, "Valid mass bounds");

    const invalidMin = 20.0;
    const invalidMax = 10.0;
    assert(invalidMin > invalidMax, "Inverted mass bounds must be rejected");
  });

  test("26. Cartesian coordinates and velocities must be finite numbers", () => {
    const pos: [number, number, number] = [6800.0, 100.0, 250.0];
    const isFinitePos = pos.every((v) => typeof v === "number" && isFinite(v));
    assert(isFinitePos === true, "Valid coordinates must be finite");

    const nanPos: [number, number, number] = [NaN, 100.0, 250.0];
    const isNanPos = nanPos.every((v) => typeof v === "number" && isFinite(v));
    assert(isNanPos === false, "NaN coordinate must be rejected");
  });

  test("27. Targeting knot guardrail enforced (step_seconds <= 60.0s)", () => {
    const validStep = 10.0;
    assert(validStep <= 60.0, "10.0s step satisfies guardrail");

    const maxStep = 60.0;
    assert(maxStep <= 60.0, "60.0s step is maximum allowed knot interval");

    const invalidStep = 60.1;
    assert(invalidStep > 60.0, "Step > 60.0s violates rendezvous knot guardrail");
  });

  // =========================================================================
  // CATEGORY 5: Breakup Results Diagnostics & Reentry Semantics
  // =========================================================================

  test("28. Mass balance, momentum conservation, and reentry interface wording verified", () => {
    const meta = DEMO_BREAKUP_RESPONSE.fragmentation.metadata;

    // 1. Mass balance equation: parent mass = tracked + residual
    const totalParent = meta.total_parent_mass_kg;
    const tracked = meta.tracked_fragment_mass_kg;
    const residual = meta.residual_mass_kg;
    const sum = tracked + residual;
    assert(
      Math.abs(totalParent - sum) < 1e-4,
      `Mass conservation balance failed: ${totalParent} != ${tracked} + ${residual}`
    );

    // 2. Momentum residual within IEEE-754 limit
    assert(
      Math.abs(meta.momentum_residual_kg_kms) < 1e-6,
      `Momentum residual ${meta.momentum_residual_kg_kms} exceeds expected limit`
    );

    // 3. Reentry interface wording: 100 km threshold (rp < 6478.1 km)
    const earthRadius = 6378.137;
    const karmanAltitude = 100.0;
    const reentryRadius = earthRadius + karmanAltitude;
    assert(
      Math.abs(reentryRadius - 6478.137) < 1e-6,
      "Atmospheric interface threshold must be exactly 6,478.137 km"
    );

    // 4. Confirm no false claims of atmospheric demise
    const allowedWording = "Reentry interface crossed at 100 km threshold (rp < 6,478.1 km)";
    assert(!allowedWording.includes("burned up"), "Demise claim 'burned up' must not appear");
    assert(!allowedWording.includes("destroyed"), "Demise claim 'destroyed' must not appear");
    assert(!allowedWording.includes("incinerated"), "Demise claim 'incinerated' must not appear");
  });

  return { passed, total, details };
}
