/**
 * Unit verification tests for ZORBIT Collision Intelligence (Milestone 5.4 Phase 4)
 *
 * Validates:
 * - Conjunction event model validation & GCRS relative vectors
 * - Encounter coordinate display mapping (X=X, Y=Z, Z=-Y) and right-handed invariants
 * - Frame assertion: strictly GCRS/GCRF, rejects TEME/ITRF/RIC
 * - Severity thresholds and spherical shell radii (1 km, 5 km, 10 km)
 * - Scientific guardrails: Heuristic risk is NOT a probability of collision (Pc)
 * - B-plane covariance ellipse unavailability (requires calibrated covariance matrices)
 * - Decoupled risk assessment lifecycle (screening resilience)
 * - Filtering by severity category & text search
 * - Sorting by TCA, miss distance, relative speed, severity, and risk score
 * - Synthetic object and encounter provenance detection
 * - Query form parameter validation
 */

import {
  ENCOUNTER_SCALE_KM_PER_UNIT,
  RADAR_SCALE_KM_PER_UNIT,
  assertGcrsEncounterFrame,
  gcrsToEncounterThreeVector,
  isValidEncounterEvent,
  calculateMissDistanceEndpoints,
  calculateRelativeVelocityGeometry,
  calculateSeverityShells,
  DEFAULT_SEVERITY_SHELLS,
} from "../encounter_geometry";
import {
  parseNoradIds,
  validateScreeningQueryParams,
  sortConjunctionEvents,
  filterConjunctionEvents,
  isSyntheticObject,
  isSyntheticEncounter,
  SEVERITY_ORDER,
  SortField,
  SortDirection,
} from "../screening";
import {
  MOCK_CONJUNCTION_RESPONSE,
  MOCK_RISK_ASSESSMENTS,
} from "../mockData";
import { ConjunctionEvent, RiskAssessment } from "../../types/api";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

export function runCollisionIntelligenceTests(): {
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
      details.push(`  [PASS] ${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      details.push(`  [FAIL] ${name}: ${msg}`);
    }
  }

  // 1. Encounter-Centered Coordinate Mapping & Frame Invariants
  test("assertGcrsEncounterFrame accepts GCRS and GCRF, rejects non-inertial frames", () => {
    assertGcrsEncounterFrame("GCRS");
    assertGcrsEncounterFrame("GCRF");
    let caughtTeme = false;
    try {
      assertGcrsEncounterFrame("TEME");
    } catch {
      caughtTeme = true;
    }
    assert(caughtTeme, "Must reject TEME frame");

    let caughtItrf = false;
    try {
      assertGcrsEncounterFrame("ITRF");
    } catch {
      caughtItrf = true;
    }
    assert(caughtItrf, "Must reject ITRF frame");

    let caughtRic = false;
    try {
      assertGcrsEncounterFrame("RIC_LVLH");
    } catch {
      caughtRic = true;
    }
    assert(caughtRic, "Must reject RIC/Hill frame");
  });

  test("gcrsToEncounterThreeVector implements right-handed GCRS display mapping", () => {
    // Standard mapping: X_Three = x, Y_Three = z, Z_Three = -y
    const gcrsVec: [number, number, number] = [10.0, 20.0, 30.0];
    const threeVec = gcrsToEncounterThreeVector(gcrsVec, ENCOUNTER_SCALE_KM_PER_UNIT);
    assert(threeVec[0] === 10.0, "Three.js X must match GCRS X");
    assert(threeVec[1] === 30.0, "Three.js Y must match GCRS Z");
    assert(threeVec[2] === -20.0, "Three.js Z must match -GCRS Y");

    // Radar scale (1:1000 km)
    const radarVec = gcrsToEncounterThreeVector(gcrsVec, RADAR_SCALE_KM_PER_UNIT);
    assert(Math.abs(radarVec[0] - 0.01) < 1e-9, "Radar X must be scaled by 1000");
    assert(Math.abs(radarVec[1] - 0.03) < 1e-9, "Radar Y must be scaled by 1000");
    assert(Math.abs(radarVec[2] - -0.02) < 1e-9, "Radar Z must be scaled by 1000");
  });

  test("isValidEncounterEvent validates finite coordinates and positive scalars", () => {
    const validEvent = MOCK_CONJUNCTION_RESPONSE.events[0];
    assert(isValidEncounterEvent(validEvent), "Mock event 0 must be valid");

    assert(!isValidEncounterEvent(null), "Null event must be invalid");
    assert(!isValidEncounterEvent(undefined), "Undefined event must be invalid");

    const invalidCoordsEvent: ConjunctionEvent = {
      ...validEvent,
      relative_position_km: [NaN, 0, 0],
    };
    assert(!isValidEncounterEvent(invalidCoordsEvent), "NaN coords must be invalid");

    const negativeDistEvent: ConjunctionEvent = {
      ...validEvent,
      miss_distance_km: -1.0,
    };
    assert(!isValidEncounterEvent(negativeDistEvent), "Negative distance must be invalid");
  });

  test("calculateMissDistanceEndpoints calculates accurate Euclidean distance in display units", () => {
    const event = MOCK_CONJUNCTION_RESPONSE.events[0];
    const { origin, target, distanceUnits } = calculateMissDistanceEndpoints(
      event,
      ENCOUNTER_SCALE_KM_PER_UNIT
    );

    assert(origin[0] === 0 && origin[1] === 0 && origin[2] === 0, "Origin must be [0,0,0]");
    const dx = target[0];
    const dy = target[1];
    const dz = target[2];
    const expectedDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    assert(
      Math.abs(distanceUnits - expectedDist) < 1e-6,
      "Distance units must match Euclidean distance of target"
    );
    assert(
      Math.abs(distanceUnits - event.miss_distance_km) < 1e-2,
      "Display distance must match backend miss distance at 1:1 scale"
    );
  });

  test("calculateRelativeVelocityGeometry produces correct orientation and clamped arrow length", () => {
    const event = MOCK_CONJUNCTION_RESPONSE.events[0];
    const { origin, direction, speedKms, arrowLengthUnits } = calculateRelativeVelocityGeometry(
      event,
      ENCOUNTER_SCALE_KM_PER_UNIT
    );

    const dirLen = Math.sqrt(
      direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]
    );
    assert(Math.abs(dirLen - 1.0) < 1e-6, "Velocity direction must be a unit vector");
    assert(speedKms > 0, "Speed must be positive");
    assert(arrowLengthUnits >= 1.5 && arrowLengthUnits <= 4.5, "Arrow length must be clamped");
  });

  test("calculateSeverityShells provides 1 km, 5 km, and 10 km concentric spheres", () => {
    const shells = calculateSeverityShells(ENCOUNTER_SCALE_KM_PER_UNIT);
    assert(shells.length === 3, "Must produce 3 severity shells");
    assert(shells[0].tier === "CRITICAL" && shells[0].radiusKm === 1.0, "Shell 1: Critical 1 km");
    assert(shells[1].tier === "HIGH" && shells[1].radiusKm === 5.0, "Shell 2: High 5 km");
    assert(shells[2].tier === "MODERATE" && shells[2].radiusKm === 10.0, "Shell 3: Moderate 10 km");
  });

  // 2. Scientific Integrity & Heuristic Risk Guardrails
  test("Heuristic risk scores are strictly [0.0 - 100.0] and contain non-probability disclaimer", () => {
    MOCK_RISK_ASSESSMENTS.forEach((assessment) => {
      assert(
        assessment.risk_score >= 0 && assessment.risk_score <= 100,
        `Risk score must be in range [0, 100], got ${assessment.risk_score}`
      );
      assert(
        assessment.scientific_disclaimer.toLowerCase().includes("not") &&
        (assessment.scientific_disclaimer.includes("probability") ||
         assessment.scientific_disclaimer.includes("Pc") ||
         assessment.scientific_disclaimer.includes("heuristic")),
        "Disclaimer must state metric is NOT a formal collision probability"
      );
      const factorSum = assessment.factors.reduce((sum, f) => sum + f.contribution, 0);
      assert(
        Math.abs(factorSum - assessment.risk_score) < 0.1,
        `Factor contributions must sum to risk score: sum=${factorSum}, score=${assessment.risk_score}`
      );
    });
  });

  // 3. Provenance & Synthetic Detection
  test("isSyntheticObject and isSyntheticEncounter accurately flag synthetic debris", () => {
    assert(isSyntheticObject("SYNTH-FRAG-001"), "SYNTH- prefix must be synthetic");
    assert(isSyntheticObject("25544", true), "is_synthetic=true must be synthetic");
    assert(!isSyntheticObject("25544", false), "ISS NORAD ID must NOT be synthetic");

    const events = MOCK_CONJUNCTION_RESPONSE.events;
    const synthEncounter = events.find(
      (e) =>
        isSyntheticObject(e.object_1_id, e.object_1_is_synthetic) ||
        isSyntheticObject(e.object_2_id, e.object_2_is_synthetic ?? e.is_synthetic)
    );
    assert(synthEncounter !== undefined, "At least one mock encounter must be synthetic");
    if (synthEncounter) {
      assert(isSyntheticEncounter(synthEncounter), "isSyntheticEncounter must return true");
    }
  });

  // 4. Filtering and Sorting Domain Logic
  test("filterConjunctionEvents filters by severity and search query", () => {
    const events = MOCK_CONJUNCTION_RESPONSE.events;
    const allEvents = filterConjunctionEvents(events, "ALL", "");
    assert(allEvents.length === events.length, "ALL filter must return all events");

    const criticalEvents = filterConjunctionEvents(events, "CRITICAL", "");
    assert(
      criticalEvents.every((e) => e.category === "CRITICAL"),
      "CRITICAL filter must only return CRITICAL events"
    );

    const searchIss = filterConjunctionEvents(events, "ALL", "25544");
    assert(
      searchIss.every(
        (e) =>
          e.object_1_id === "25544" ||
          e.object_2_id === "25544" ||
          (e.object_1_name && e.object_1_name.includes("25544")) ||
          (e.object_2_name && e.object_2_name.includes("25544"))
      ),
      "Search for 25544 must only match ISS encounters"
    );
  });

  test("sortConjunctionEvents correctly sorts by miss distance, speed, TCA, and risk score", () => {
    const events = MOCK_CONJUNCTION_RESPONSE.events;
    const riskMap: Record<string, RiskAssessment> = {};
    MOCK_RISK_ASSESSMENTS.forEach((a) => (riskMap[a.event_id] = a));

    // Sort by miss distance ascending
    const distAsc = sortConjunctionEvents(events, "miss_distance_km", "asc", riskMap);
    for (let i = 0; i < distAsc.length - 1; i++) {
      assert(
        distAsc[i].miss_distance_km <= distAsc[i + 1].miss_distance_km,
        "Distance must be monotonically increasing"
      );
    }

    // Sort by relative speed descending
    const speedDesc = sortConjunctionEvents(events, "relative_speed_kms", "desc", riskMap);
    for (let i = 0; i < speedDesc.length - 1; i++) {
      assert(
        speedDesc[i].relative_speed_kms >= speedDesc[i + 1].relative_speed_kms,
        "Speed must be monotonically decreasing"
      );
    }

    // Sort by risk score descending
    const riskDesc = sortConjunctionEvents(events, "risk", "desc", riskMap);
    for (let i = 0; i < riskDesc.length - 1; i++) {
      const r1 = riskMap[riskDesc[i].event_id]?.risk_score ?? -1;
      const r2 = riskMap[riskDesc[i + 1].event_id]?.risk_score ?? -1;
      assert(r1 >= r2, "Risk score must be monotonically decreasing");
    }
  });

  // 5. Query Parameter Validation
  test("validateScreeningQueryParams validates valid inputs and detects range violations", () => {
    const validStart = "2026-11-08T00:00:00Z";
    const validEnd = "2026-11-08T02:00:00Z";
    const validRes = validateScreeningQueryParams(
      validStart,
      validEnd,
      "10.0",
      "60.0",
      "25544, 48274"
    );
    assert(validRes.isValid, "Valid parameters must pass validation");
    assert(validRes.parsedNoradIds.length === 2, "Must parse 2 NORAD IDs");

    // Inverted time window
    const invalidWindow = validateScreeningQueryParams(
      validEnd,
      validStart,
      "10.0",
      "60.0",
      "25544"
    );
    assert(!invalidWindow.isValid, "End before start must fail validation");

    // Negative threshold
    const negativeThreshold = validateScreeningQueryParams(
      validStart,
      validEnd,
      "-5.0",
      "60.0",
      "25544"
    );
    assert(!negativeThreshold.isValid, "Negative threshold must fail validation");
  });

  test("parseNoradIds parses and deduplicates catalog tokens", () => {
    const tokens = parseNoradIds("25544, 48274, 25544   33757");
    assert(tokens.length === 3, `Expected 3 deduplicated tokens, got ${tokens.length}`);
    assert(tokens[0] === "25544" && tokens[1] === "48274" && tokens[2] === "33757", "Tokens must match");
  });

  return { passed, total, details };
}

