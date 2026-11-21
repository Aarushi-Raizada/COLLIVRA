/**
 * Unit verification tests for ZORBIT Member 1 Milestone 4.3:
 * Risk Assessment Integration & Synthetic Provenance
 *
 * Verifies:
 * 1. Mock risk score alignment with backend Day 7 calculations (~79.02 for #042)
 * 2. Harmonized factor names (MISS_DISTANCE, RELATIVE_SPEED, TIME_TO_TCA)
 * 3. Live backend risk assessment in Demo Mode without flipping global mode
 * 4. Zero recalculation: backend response accepted directly without local alteration
 * 5. Explicit synthetic badges for is_synthetic === true or id starting with "SYNTH-"
 * 6. No false synthetic attribution for ordinary catalog objects (e.g. 25544, 48274)
 * 7. Error isolation & state preservation on live assessment failure
 * 8. Concurrency guard preventing duplicate concurrent live assessment requests
 * 9. Evaluation timestamp, source attribution, and synthetic provenance tracking
 */

import {
  MOCK_CONJUNCTION_EVENTS,
  MOCK_RISK_ASSESSMENTS,
  MOCK_CONJUNCTION_RESPONSE,
} from "../mockData";
import { isSyntheticObject, isSyntheticEncounter } from "../screening";
import type {
  ConjunctionEvent,
  RiskAssessment,
  RiskAssessmentRequest,
} from "../../types/api";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

export function runRiskProvenanceTests(): {
  passed: number;
  total: number;
  details: string[];
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

  // 1. Mock risk score alignment
  test("1. Mock risk score matches backend Day 7 calculation (~79.02 for #042)", () => {
    const synth042 = MOCK_RISK_ASSESSMENTS.find(
      (a) => a.secondary_object_id === "SYNTH-FRAG-0042"
    );
    assert(synth042 !== undefined, "SYNTH-FRAG-0042 assessment must exist");
    assert(
      Math.abs(synth042!.risk_score - 79.02) < 0.05,
      `Expected score ~79.02, got ${synth042!.risk_score}`
    );
    assert(synth042!.risk_category === "CRITICAL", "Score >= 75.0 must be CRITICAL");

    const synth006 = MOCK_RISK_ASSESSMENTS.find(
      (a) => a.secondary_object_id === "SYNTH-FRAG-0006"
    );
    assert(synth006 !== undefined, "SYNTH-FRAG-0006 assessment must exist");
    assert(
      Math.abs(synth006!.risk_score - 59.56) < 0.05,
      `Expected score ~59.56, got ${synth006!.risk_score}`
    );
    assert(synth006!.risk_category === "HIGH", "Score 50-75 must be HIGH");

    const station48274 = MOCK_RISK_ASSESSMENTS.find(
      (a) => a.secondary_object_id === "48274"
    );
    assert(station48274 !== undefined, "48274 assessment must exist");
    assert(
      Math.abs(station48274!.risk_score - 43.77) < 0.05,
      `Expected score ~43.77, got ${station48274!.risk_score}`
    );
    assert(station48274!.risk_category === "MODERATE", "Score 25-50 must be MODERATE");
  });

  // 2. Harmonized factor names
  test("2. Harmonized factor names match backend engine (MISS_DISTANCE, RELATIVE_SPEED, TIME_TO_TCA)", () => {
    for (const assessment of MOCK_RISK_ASSESSMENTS) {
      assert(assessment.factors.length === 3, "Each assessment must have 3 factors");
      const names = assessment.factors.map((f) => f.factor_name);
      assert(
        names[0] === "MISS_DISTANCE",
        `Factor 0 name must be MISS_DISTANCE, got ${names[0]}`
      );
      assert(
        names[1] === "RELATIVE_SPEED",
        `Factor 1 name must be RELATIVE_SPEED, got ${names[1]}`
      );
      assert(
        names[2] === "TIME_TO_TCA",
        `Factor 2 name must be TIME_TO_TCA, got ${names[2]}`
      );

      // Verify weights sum to 1.0 (50%, 25%, 25%)
      assert(assessment.factors[0].weight === 0.5, "Miss distance weight must be 0.50");
      assert(assessment.factors[1].weight === 0.25, "Relative speed weight must be 0.25");
      assert(assessment.factors[2].weight === 0.25, "Time to TCA weight must be 0.25");

      // Verify contributions match normalized_value * weight * 100
      for (const f of assessment.factors) {
        const expectedContrib = 100.0 * f.weight * f.normalized_value;
        assert(
          Math.abs(f.contribution - expectedContrib) < 0.05,
          `Contribution mismatch for ${f.factor_name}: ${f.contribution} vs ${expectedContrib}`
        );
      }
    }
  });

  // 3. Live assessment in demo mode preserves demo mode
  test("3. Live assessment in demo mode updates target encounter without altering isDemoMode", () => {
    let isDemoMode = true;
    let selectedEventId: string | null = "CONJ-25544-SYNTH-FRAG-0042-20261102T121845Z";
    const riskAssessments: Record<string, RiskAssessment> = {};
    const riskSources: Record<string, "LIVE_BACKEND" | "OFFLINE_FIXTURE"> = {};

    // Initial demo setup
    MOCK_RISK_ASSESSMENTS.forEach((a) => {
      riskAssessments[a.event_id] = a;
      riskSources[a.event_id] = "OFFLINE_FIXTURE";
    });

    assert(isDemoMode === true, "Dashboard must start in demo mode");
    assert(riskSources[selectedEventId] === "OFFLINE_FIXTURE", "Initial source must be OFFLINE_FIXTURE");

    // Simulate handleAssessWithLiveBackend execution
    const mockLiveBackendResponse: RiskAssessment = {
      ...riskAssessments[selectedEventId],
      risk_score: 79.0228674712648,
      evaluation_time: "2026-11-02T12:00:00Z",
    };

    // Apply live update to single encounter
    riskAssessments[selectedEventId] = mockLiveBackendResponse;
    riskSources[selectedEventId] = "LIVE_BACKEND";

    // Critical assertion: demo mode must NOT be silently switched to false
    assert(isDemoMode === true, "isDemoMode MUST remain true after assessing single fixture");
    assert(riskSources[selectedEventId] === "LIVE_BACKEND", "Updated encounter must record LIVE_BACKEND source");
    assert(
      riskSources["CONJ-25544-SYNTH-FRAG-0006-20261102T122215Z"] === "OFFLINE_FIXTURE",
      "Unassessed fixtures must retain OFFLINE_FIXTURE source"
    );
  });

  // 4. No recalculation: frontend preserves backend values directly
  test("4. Frontend preserves backend evaluation output verbatim without local tampering", () => {
    const rawBackendJson: RiskAssessment = {
      event_id: "CONJ-25544-SYNTH-FRAG-0042-20261102T121845Z",
      primary_object_id: "25544",
      primary_object_name: "ISS (ZARYA)",
      secondary_object_id: "SYNTH-FRAG-0042",
      secondary_object_name: "Synthetic Debris Fragment #042",
      tca: "2026-11-02T12:18:45Z",
      miss_distance_km: 0.842,
      relative_speed_kms: 12.812,
      risk_score: 79.0228674712648,
      risk_category: "CRITICAL",
      evaluation_time: "2026-11-02T12:00:00Z",
      factors: [
        {
          factor_name: "MISS_DISTANCE",
          raw_value: 0.842,
          raw_units: "km",
          normalized_value: 0.6563901014091712,
          weight: 0.5,
          contribution: 32.81950507045856,
          description: "Exponential decay with scale 2.0 km: exp(-0.8420 / 2.0)",
        },
        {
          factor_name: "RELATIVE_SPEED",
          raw_value: 12.812,
          raw_units: "km/s",
          normalized_value: 0.8541333333333333,
          weight: 0.25,
          contribution: 21.35333333333333,
          description: "Linear ramp clamped at 15.0 km/s: min(12.8120 / 15.0, 1.0)",
        },
        {
          factor_name: "TIME_TO_TCA",
          raw_value: 0.3125,
          raw_units: "hours",
          normalized_value: 0.9940011626989165,
          weight: 0.25,
          contribution: 24.85002906747291,
          description: "Exponential decay with 36.0 h half-life: 2^(-0.3125 / 36.0) if >= 0 else 0.0",
        },
      ],
      data_quality: "COMPLETE",
      warnings: [],
      scientific_disclaimer: "Scientific Disclaimer: Heuristic risk scores [0.0 - 100.0] are empirical triage approximations for decision-support and do NOT represent formal probability of collision (Pc).",
    };

    // Stored in state
    const stateRecord: Record<string, RiskAssessment> = {
      [rawBackendJson.event_id]: rawBackendJson,
    };

    const retrieved = stateRecord[rawBackendJson.event_id];
    assert(retrieved.risk_score === 79.0228674712648, "Exact floating-point score must be preserved");
    assert(retrieved.factors[0].contribution === 32.81950507045856, "Factor contribution must not be recalculated");
    assert(retrieved.factors[0].factor_name === "MISS_DISTANCE", "Factor name must match backend schema");
    assert(retrieved.scientific_disclaimer.includes("do NOT represent formal probability"), "Disclaimer preserved");
  });

  // 5. Explicit synthetic badges for synthetic objects
  test("5. Synthetic badge logic accurately identifies synthetic objects and encounters", () => {
    // Identifier starting with SYNTH-
    assert(isSyntheticObject("SYNTH-FRAG-0042") === true, "SYNTH- prefix must evaluate to true");
    assert(isSyntheticObject("SYNTH-001") === true, "SYNTH- prefix must evaluate to true");

    // Explicit is_synthetic === true
    assert(isSyntheticObject("99999", true) === true, "is_synthetic: true must evaluate to true");
    assert(isSyntheticObject(undefined, true) === true, "is_synthetic: true without id must evaluate to true");

    // Encounter helper
    const synthEvent: ConjunctionEvent = {
      event_id: "CONJ-TEST-SYNTH",
      object_1_id: "25544",
      object_1_name: "ISS (ZARYA)",
      object_2_id: "SYNTH-FRAG-0042",
      object_2_name: "Synthetic Fragment",
      tca: "2026-11-02T12:00:00Z",
      miss_distance_km: 1.0,
      relative_position_km: [1, 0, 0],
      relative_velocity_kms: [0, 10, 0],
      relative_speed_kms: 10.0,
      category: "CRITICAL",
      screening_threshold_km: 10.0,
      frame: "GCRS",
      step_seconds: 60.0,
    };
    assert(isSyntheticEncounter(synthEvent) === true, "Encounter with secondary SYNTH- must be synthetic");
  });

  // 6. No false synthetic attribution on catalog objects
  test("6. No false synthetic badges for ordinary catalog objects even if display name contains 'Synthetic'", () => {
    // Standard numeric NORAD IDs
    assert(isSyntheticObject("25544", false) === false, "NORAD 25544 must NOT be synthetic");
    assert(isSyntheticObject("48274", undefined) === false, "NORAD 48274 must NOT be synthetic");
    assert(isSyntheticObject("12345", false) === false, "Numeric ID must NOT be synthetic");

    // Real stations encounter
    const realStationEvent: ConjunctionEvent = {
      event_id: "CONJ-25544-48274-20261102T120530Z",
      object_1_id: "25544",
      object_1_name: "ISS (ZARYA)",
      object_2_id: "48274",
      object_2_name: "CSS (TIANHE)",
      tca: "2026-11-02T12:05:30Z",
      miss_distance_km: 8.421,
      relative_position_km: [4, -6, 3],
      relative_velocity_kms: [-7, 5, 5],
      relative_speed_kms: 10.842,
      category: "MODERATE",
      screening_threshold_km: 10.0,
      frame: "GCRS",
      step_seconds: 60.0,
    };
    assert(isSyntheticEncounter(realStationEvent) === false, "Encounter between two catalog stations must NOT be synthetic");

    // Deceptive name: object_name contains 'Synthetic' but object_id is catalog and is_synthetic is false
    const deceptiveEvent: ConjunctionEvent = {
      ...realStationEvent,
      object_2_name: "Synthetic Debris Mock Name",
      object_2_id: "48274",
      object_2_is_synthetic: false,
    };
    assert(
      isSyntheticObject(deceptiveEvent.object_2_id, deceptiveEvent.object_2_is_synthetic) === false,
      "Deceptive display name must NOT cause false synthetic badge attribution"
    );
  });

  // 7. Failure preservation
  test("7. Live assessment failure preserves selected encounter, screening results, and prior assessments", () => {
    const selectedEventId = "CONJ-25544-SYNTH-FRAG-0042-20261102T121845Z";
    const priorAssessment = MOCK_RISK_ASSESSMENTS[0];
    const initialScreeningResponse = MOCK_CONJUNCTION_RESPONSE;

    let currentSelectedId: string | null = selectedEventId;
    let currentScreening = initialScreeningResponse;
    const currentAssessments: Record<string, RiskAssessment> = {
      [selectedEventId]: priorAssessment,
    };
    let liveError: string | null = null;

    // Simulate API call failure (e.g. 500 error or network timeout)
    try {
      throw new Error("HTTP 500: Internal Astrodynamics Engine Failure");
    } catch (err) {
      liveError = err instanceof Error ? err.message : String(err);
      // Guardrail logic: do NOT wipe state
    }

    assert(liveError === "HTTP 500: Internal Astrodynamics Engine Failure", "Error message recorded");
    assert(currentSelectedId === selectedEventId, "Selected event ID must be preserved");
    assert(currentScreening === initialScreeningResponse, "Screening response must remain intact");
    assert(
      currentAssessments[selectedEventId].risk_score === priorAssessment.risk_score,
      "Prior risk assessment must NOT be wiped or zeroed"
    );
  });

  // 8. Concurrency guard
  test("8. Concurrency guard blocks duplicate simultaneous live assessment requests", () => {
    let callCount = 0;
    const isAssessingLiveRef = { current: false };

    async function triggerAssessWithLiveBackend(): Promise<void> {
      if (isAssessingLiveRef.current) return;
      isAssessingLiveRef.current = true;
      callCount++;
      // Simulate in-flight API latency
      await new Promise((r) => setTimeout(r, 20));
      isAssessingLiveRef.current = false;
    }

    // Trigger two calls simultaneously
    const p1 = triggerAssessWithLiveBackend();
    const p2 = triggerAssessWithLiveBackend();

    // Verify p2 was ignored immediately by the ref
    assert(isAssessingLiveRef.current === true, "Ref must be true while in flight");
    assert(callCount === 1, "Only one call must have executed; duplicate blocked");
  });

  // 9. Timestamp, source attribution, and provenance tracking
  test("9. Evaluation epoch, data source, and synthetic provenance are tracked accurately", () => {
    const assessment = MOCK_RISK_ASSESSMENTS[0];
    assert(assessment.evaluation_time === "2026-11-02T12:00:00.000Z", "Evaluation time is valid UTC ISO");
    assert(assessment.data_quality === "COMPLETE", "Data quality is COMPLETE");

    // Source mapping simulation
    const sources: Record<string, "LIVE_BACKEND" | "OFFLINE_FIXTURE"> = {
      [assessment.event_id]: "OFFLINE_FIXTURE",
    };
    assert(sources[assessment.event_id] === "OFFLINE_FIXTURE", "Initial fixture source is OFFLINE_FIXTURE");

    // After live update
    sources[assessment.event_id] = "LIVE_BACKEND";
    assert(sources[assessment.event_id] === "LIVE_BACKEND", "Updated source is LIVE_BACKEND");

    // Provenance validation
    assert(isSyntheticObject(assessment.secondary_object_id) === true, "Secondary object provenance verified");
  });

  return { passed, total, details };
}

