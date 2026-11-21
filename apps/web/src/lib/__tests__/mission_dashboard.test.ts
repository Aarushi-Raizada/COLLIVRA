/**
 * Unit verification tests for ZORBIT Mission Dashboard (Milestone 5.4 Phase 2)
 *
 * Validates:
 * - Threat intelligence KPI calculations
 * - Real vs synthetic data distinction
 * - Scientific honesty enforcement (no invented satellite counts, no false Pc)
 * - Empty event states and API error recovery
 * - Composite conjunction construction
 * - 3D scene coordinate invariants
 */

import {
  buildCompositeConjunctions,
  calculateThreatMetrics,
} from "../../hooks/useMissionDashboard";
import {
  MOCK_CONJUNCTION_EVENTS,
  MOCK_RISK_ASSESSMENTS,
} from "../mockData";
import {
  EARTH_RADIUS_DISPLAY,
  gcrsToThreePosition,
} from "../coordinates";
import {
  ISS_TRAJECTORY,
  CSS_TRAJECTORY,
  SYNTHETIC_DEBRIS_CLOUD,
} from "../orbitFixtures";
import { ConjunctionEvent, RiskAssessment } from "../../types/api";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

export function runMissionDashboardTests(): {
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
      details.push(
        `[FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`
      );
      console.error(`[FAIL] ${name}:`, err);
      throw err;
    }
  }

  // 1. KPI metrics calculation from offline demo fixtures
  test("1. KPI metrics calculation from offline demo fixtures", () => {
    const composite = buildCompositeConjunctions(
      MOCK_CONJUNCTION_EVENTS,
      MOCK_RISK_ASSESSMENTS
    );
    const metrics = calculateThreatMetrics(
      2,
      MOCK_CONJUNCTION_EVENTS,
      composite,
      true
    );

    assert(metrics.objectsScreened === 2, "Objects screened must equal 2 for stations fixture");
    assert(metrics.conjunctionsDetected === 3, "Conjunction events detected must equal 3");
    assert(metrics.highRiskCount === 2, "High-risk count must equal 2 (CRITICAL + HIGH)");
    assert(metrics.syntheticScenariosCount === 1, "Synthetic scenarios count must be 1 for demo mode");
    assert(metrics.syntheticScenariosDisplay === "1 Loaded", "Synthetic scenarios display must be '1 Loaded'");
    assert(metrics.isSyntheticData === true, "isSyntheticData must be true for demo mode");
    assert(
      metrics.dataSourceLabel === "OFFLINE DEMO FIXTURE",
      "Data source label must reflect offline demo fixture"
    );
  });

  // 2. KPI metrics calculation from hypothetical live API response
  test("2. KPI metrics calculation from live screening API response", () => {
    const mockLiveEvents: ConjunctionEvent[] = [
      {
        event_id: "CONJ-25544-48274-20261105T120000Z",
        object_1_id: "25544",
        object_1_name: "ISS (ZARYA)",
        object_2_id: "48274",
        object_2_name: "CSS (TIANHE)",
        tca: "2026-11-05T12:00:00.000Z",
        miss_distance_km: 12.4,
        relative_position_km: [5.0, -10.0, 5.0],
        relative_velocity_kms: [-7.0, 5.0, 5.0],
        relative_speed_kms: 10.0,
        category: "MODERATE",
        screening_threshold_km: 50.0,
        frame: "GCRS",
        step_seconds: 60.0,
        method: "NUMERICAL_OPTIMIZATION",
        disclaimer: "Scientific Disclaimer: Heuristic triage index.",
      },
    ];

    const mockLiveRisks: RiskAssessment[] = [
      {
        event_id: "CONJ-25544-48274-20261105T120000Z",
        primary_object_id: "25544",
        primary_object_name: "ISS (ZARYA)",
        secondary_object_id: "48274",
        secondary_object_name: "CSS (TIANHE)",
        tca: "2026-11-05T12:00:00.000Z",
        miss_distance_km: 12.4,
        relative_speed_kms: 10.0,
        risk_score: 28.5,
        risk_category: "LOW",
        evaluation_time: "2026-11-05T12:00:00.000Z",
        factors: [],
        data_quality: "COMPLETE",
        warnings: [],
        scientific_disclaimer: "Heuristic Risk Score [0.0 - 100.0]",
      },
    ];

    const composite = buildCompositeConjunctions(mockLiveEvents, mockLiveRisks);
    const metrics = calculateThreatMetrics(14, mockLiveEvents, composite, false);

    assert(metrics.objectsScreened === 14, "Objects screened must match backend total_objects (14)");
    assert(metrics.conjunctionsDetected === 1, "Conjunction events detected must be 1");
    assert(metrics.highRiskCount === 0, "High-risk count must be 0 for LOW risk event");
    assert(metrics.syntheticScenariosCount === 0, "Synthetic scenarios count must be 0 for nominal screening");
    assert(metrics.syntheticScenariosDisplay === "0 Configured", "Synthetic scenarios display must be '0 Configured'");
    assert(metrics.isSyntheticData === false, "isSyntheticData must be false for live response");
    assert(
      metrics.dataSourceLabel === "FASTAPI SGP4 ENGINE",
      "Data source label must reflect live FastAPI SGP4 engine"
    );
  });

  // 3. Scientific honesty: never claim unverified satellite counts
  test("3. Scientific honesty: total objects reflects actual screened count, not invented catalog", () => {
    const composite = buildCompositeConjunctions([], []);
    const metrics = calculateThreatMetrics(2, [], composite, true);

    assert(metrics.objectsScreened === 2, "Must show exactly 2 stations screened, not 36,842");
    assert(
      metrics.provenanceNote.includes("data/fixtures/stations_omm.json"),
      "Must explicitly document the local fixture file provenance"
    );
  });

  // 4. Empty event states
  test("4. Empty screening state produces 0 conjunctions and 0 high-risk events", () => {
    const composite = buildCompositeConjunctions([], []);
    const metrics = calculateThreatMetrics(5, [], composite, false);

    assert(composite.length === 0, "Composite list must be empty");
    assert(metrics.conjunctionsDetected === 0, "Detected count must be 0");
    assert(metrics.highRiskCount === 0, "High risk count must be 0");
  });

  // 5. Synthetic vs live data tagging
  test("5. Synthetic provenance correctly tags fragments without false positives on catalog satellites", () => {
    const composite = buildCompositeConjunctions(
      MOCK_CONJUNCTION_EVENTS,
      MOCK_RISK_ASSESSMENTS
    );

    const synthItem1 = composite.find(
      (c) => c.event.object_2_id === "SYNTH-FRAG-0042"
    );
    const synthItem2 = composite.find(
      (c) => c.event.object_2_id === "SYNTH-FRAG-0006"
    );
    const catalogItem = composite.find((c) => c.event.object_2_id === "48274");

    assert(synthItem1?.isSynthetic === true, "SYNTH-FRAG-0042 must be tagged synthetic");
    assert(synthItem2?.isSynthetic === true, "SYNTH-FRAG-0006 must be tagged synthetic");
    assert(catalogItem?.isSynthetic === false, "CSS (TIANHE) must NOT be tagged synthetic");
  });

  // 6. Scientific honesty: heuristic risk labeling and disclaimer preservation
  test("6. Heuristic risk scores preserve factor breakdown and disclaimer", () => {
    const composite = buildCompositeConjunctions(
      MOCK_CONJUNCTION_EVENTS,
      MOCK_RISK_ASSESSMENTS
    );
    const primaryEvent = composite[0];

    assert(primaryEvent.risk !== null, "Risk assessment must be present");
    assert(
      primaryEvent.risk!.risk_score > 70.0,
      "Critical encounter risk score must be > 70.0"
    );
    assert(
      primaryEvent.risk!.scientific_disclaimer.includes("Heuristic risk scores"),
      "Must include heuristic risk scientific disclaimer"
    );
    assert(
      !primaryEvent.risk!.scientific_disclaimer.includes("certified Pc"),
      "Must never claim certified probability of collision"
    );
  });

  // 7. 3D Preview: Earth model dimensions and GCRS frame invariants
  test("7. 3D Earth preview adheres to GCRS display scale (1 unit = 1000 km)", () => {
    assert(
      Math.abs(EARTH_RADIUS_DISPLAY - 6.378137) < 1e-4,
      "Earth display radius must equal 6.378 units"
    );

    // GCRS to Three.js mapping preserves Right-Handed convention
    const [xThree, yThree, zThree] = gcrsToThreePosition(6800, 1000, 2000, "GCRS");
    assert(xThree === 6.8, "X_Three must equal x_GCRS / 1000");
    assert(yThree === 2.0, "Y_Three must equal z_GCRS / 1000 (polar axis)");
    assert(zThree === -1.0, "Z_Three must equal -y_GCRS / 1000");
  });

  // 8. 3D Preview: Trajectories and debris cloud fixtures
  test("8. 3D Preview fixtures provide ISS, CSS trajectories and 520 synthetic debris fragments", () => {
    assert(ISS_TRAJECTORY.samples.length > 50, "ISS trajectory must have valid sample count");
    assert(CSS_TRAJECTORY.samples.length > 50, "CSS trajectory must have valid sample count");
    assert(
      SYNTHETIC_DEBRIS_CLOUD.length === 520,
      "Synthetic debris cloud must contain exactly 520 fragments"
    );
    assert(
      SYNTHETIC_DEBRIS_CLOUD[0].id.startsWith("SYNTH-FRAG-"),
      "Fragments must use SYNTH-FRAG- prefix"
    );
    assert(
      SYNTHETIC_DEBRIS_CLOUD[0].isSynthetic === true,
      "Fragments must be explicitly marked isSynthetic=true"
    );
  });

  // 9. Verified KPI semantic correction: 4th KPI card is labeled Synthetic Scenarios
  test("9. Verified KPI semantic correction: 4th card represents static synthetic scenario, not active execution", () => {
    const composite = buildCompositeConjunctions(
      MOCK_CONJUNCTION_EVENTS,
      MOCK_RISK_ASSESSMENTS
    );
    const demoMetrics = calculateThreatMetrics(2, MOCK_CONJUNCTION_EVENTS, composite, true);
    assert(demoMetrics.syntheticScenariosDisplay === "1 Loaded", "Demo scenario value must be '1 Loaded'");
    assert(demoMetrics.syntheticScenariosCount === 1, "Demo count must be 1");

    const liveMetrics = calculateThreatMetrics(0, [], [], false);
    assert(liveMetrics.syntheticScenariosDisplay === "0 Configured", "Live nominal value must be '0 Configured'");
    assert(liveMetrics.syntheticScenariosCount === 0, "Live nominal count must be 0");
  });

  return { passed, total, details };
}

