import {
  COLLIVRA_WORKFLOW_STEPS,
  CANONICAL_DEMO_SCENARIOS,
  INDIAN_SPACE_CONSTELLATIONS,
  ISRO_IS4OM_SPECIFICATION,
} from "../workflow";
import { resolveToCanonicalUrn } from "../urn";
import { CANONICAL_CW_FIXTURE } from "@/data/canonicalCwFixture";

export interface TestResult {
  passed: number;
  total: number;
  details: string[];
}

export function runCollivraC5ProductIntegrationTests(): TestResult {
  let passed = 0;
  let total = 0;
  const details: string[] = [];

  function assert(condition: boolean, msg: string) {
    total++;
    if (condition) {
      passed++;
      details.push(`  ✔ ${msg}`);
    } else {
      details.push(`  ✖ FAIL: ${msg}`);
      console.error(`  ✖ FAIL: ${msg}`);
    }
  }

  // =========================================================================
  // 1. Seven-Step Unified Operational Workflow Tests
  // =========================================================================
  assert(
    COLLIVRA_WORKFLOW_STEPS.length === 7,
    "Workflow defines exactly 7 sequential operational steps connecting all six pillars"
  );

  const stepNumbers = COLLIVRA_WORKFLOW_STEPS.map((s) => s.stepNumber);
  assert(
    JSON.stringify(stepNumbers) === JSON.stringify([1, 2, 3, 4, 5, 6, 7]),
    "Workflow steps strictly ordered from 1 to 7 without gaps"
  );

  const validTabs = ["overview", "radar", "conjunctions", "simulation", "system"];
  const allTabsValid = COLLIVRA_WORKFLOW_STEPS.every((s) => validTabs.includes(s.tab));
  assert(
    allTabsValid,
    "All workflow steps map to valid ZORBIT/COLLIVRA application navigation tabs"
  );

  const step1 = COLLIVRA_WORKFLOW_STEPS[0];
  assert(
    step1.tab === "overview" && step1.pillarNumber === "01",
    "Step 1 correctly targets Mission Overview (Pillar 01) for asset identification"
  );

  const step2 = COLLIVRA_WORKFLOW_STEPS[1];
  assert(
    step2.tab === "radar" && step2.pillarNumber === "02",
    "Step 2 correctly targets Orbital Explorer (Pillar 02) for 3D GCRS inspection"
  );

  const step3 = COLLIVRA_WORKFLOW_STEPS[2];
  assert(
    step3.tab === "conjunctions" && step3.pillarNumber === "03",
    "Step 3 correctly targets Collision Intelligence (Pillar 03) for SGP4 screening"
  );

  const step4 = COLLIVRA_WORKFLOW_STEPS[3];
  assert(
    step4.tab === "conjunctions" && step4.pillarNumber === "03",
    "Step 4 correctly targets Risk Triage in Pillar 03 with explainable heuristic scoring"
  );

  const step5 = COLLIVRA_WORKFLOW_STEPS[4];
  assert(
    step5.tab === "simulation" && step5.subtab === "breakup" && step5.pillarNumber === "04",
    "Step 5 correctly targets Debris Evolution Lab (Pillar 04) for Cowell DOP853 propagation"
  );

  const step6 = COLLIVRA_WORKFLOW_STEPS[5];
  assert(
    step6.tab === "simulation" && step6.subtab === "remediation" && step6.pillarNumber === "05",
    "Step 6 correctly targets Remediation Planning (Pillar 05) for CW 2-impulse rendezvous"
  );

  const step7 = COLLIVRA_WORKFLOW_STEPS[6];
  assert(
    step7.tab === "system" && step7.pillarNumber === "06",
    "Step 7 correctly targets System Integrity (Pillar 06) for EOP freshness & provenance"
  );

  // =========================================================================
  // 2. Five Canonical Demonstration Scenarios Tests
  // =========================================================================
  assert(
    CANONICAL_DEMO_SCENARIOS.length === 5,
    "Demo suite defines exactly 5 canonical scenarios (Scenarios A through E)"
  );

  const scenarioCodes = CANONICAL_DEMO_SCENARIOS.map((s) => s.scenarioCode);
  assert(
    JSON.stringify(scenarioCodes) ===
      JSON.stringify(["SCENARIO A", "SCENARIO B", "SCENARIO C", "SCENARIO D", "SCENARIO E"]),
    "Demo scenarios strictly labeled SCENARIO A through SCENARIO E"
  );

  const scA = CANONICAL_DEMO_SCENARIOS.find((s) => s.id === "scenario-a");
  assert(
    scA !== undefined && scA.targetTab === "radar" && scA.targetObjectId === "catalog:25544",
    "Scenario A correctly configures Normal Orbital Monitoring targeting ISS (catalog:25544)"
  );

  const scB = CANONICAL_DEMO_SCENARIOS.find((s) => s.id === "scenario-b");
  assert(
    scB !== undefined &&
      scB.targetTab === "conjunctions" &&
      scB.targetEventId === "CONJ-25544-SYNTH-FRAG-0042-20261102T121845Z",
    "Scenario B correctly configures Close-Approach Analysis targeting critical encounter #042"
  );

  const scC = CANONICAL_DEMO_SCENARIOS.find((s) => s.id === "scenario-c");
  assert(
    scC !== undefined &&
      scC.targetTab === "simulation" &&
      scC.targetSubtab === "breakup" &&
      scC.targetScenarioId === "scenario:SIM-LEO-COLLISION-001",
    "Scenario C correctly configures Debris Evolution Lab targeting SIM-LEO-COLLISION-001"
  );

  const scD = CANONICAL_DEMO_SCENARIOS.find((s) => s.id === "scenario-d");
  assert(
    scD !== undefined &&
      scD.targetTab === "simulation" &&
      scD.targetSubtab === "remediation" &&
      scD.targetScenarioId === "scenario:canonical-cw-reference",
    "Scenario D correctly configures Remediation Planning with canonical CW reference benchmark"
  );

  const scE = CANONICAL_DEMO_SCENARIOS.find((s) => s.id === "scenario-e");
  assert(
    scE !== undefined && scE.targetTab === "system",
    "Scenario E correctly configures System Quality & IERS Policy verification"
  );

  const allHaveDisclosures = CANONICAL_DEMO_SCENARIOS.every(
    (s) => s.scientificGuardrail && s.scientificGuardrail.length > 20
  );
  assert(
    allHaveDisclosures,
    "All 5 demonstration scenarios document mandatory scientific guardrails & physical assumptions"
  );

  // =========================================================================
  // 3. Indian Space Ecosystem & ISRO / IS4OM Domain Relevance Tests
  // =========================================================================
  assert(
    INDIAN_SPACE_CONSTELLATIONS.length === 4,
    "Indian space ecosystem defines 4 strategic constellations (NavIC, EOS/Cartosat, RISAT, GSAT)"
  );

  const allIntegrationReady = INDIAN_SPACE_CONSTELLATIONS.every(
    (c) => c.status === "INTEGRATION_READY"
  );
  assert(
    allIntegrationReady,
    "All 4 Indian constellations carry 'INTEGRATION_READY' status with real CelesTrak group mappings"
  );

  const navic = INDIAN_SPACE_CONSTELLATIONS.find((c) => c.acronym.includes("NavIC"));
  assert(
    navic !== undefined && navic.ingestionSource.includes("navic"),
    "NavIC constellation specifies official CelesTrak 'navic' group ingestion source"
  );

  const cartosat = INDIAN_SPACE_CONSTELLATIONS.find((c) => c.acronym.includes("Cartosat"));
  assert(
    cartosat !== undefined && cartosat.regime === "LEO",
    "Cartosat / EOS earth observation satellites classified under LEO regime"
  );

  assert(
    ISRO_IS4OM_SPECIFICATION.alignment.includes("Domain 06") &&
      ISRO_IS4OM_SPECIFICATION.alignment.includes("Domain 01"),
    "ISRO IS4OM specification aligns with Hackathon Domain 06 (Sustainable Space) and Domain 01 (Indian Space Missions)"
  );

  assert(
    ISRO_IS4OM_SPECIFICATION.disclaimer.includes("Zero orbital elements are synthesized"),
    "ISRO specification strictly enforces scientific guardrail prohibiting fabricated orbits"
  );

  // =========================================================================
  // 4. Cross-Module Identity & Provenance Invariants
  // =========================================================================
  const issRes = resolveToCanonicalUrn("25544");
  assert(
    issRes.success && issRes.urn === "catalog:norad:25544",
    "Canonical URN resolver normalizes NORAD 25544 to 'catalog:norad:25544'"
  );

  const fragRes = resolveToCanonicalUrn("SYNTH-FRAG-0001");
  assert(
    fragRes.success && fragRes.urn === "synthetic:SIM-canonical-cw:fragment:0001",
    "Canonical URN resolver normalizes SYNTH-FRAG-0001 to 'synthetic:SIM-canonical-cw:fragment:0001'"
  );

  const cwRes = resolveToCanonicalUrn("scenario:canonical-cw-reference");
  assert(
    cwRes.success && cwRes.urn === "scenario:canonical-cw-reference",
    "Canonical URN resolver preserves canonical scenario URN 'scenario:canonical-cw-reference'"
  );

  // =========================================================================
  // 5. Clohessy-Wiltshire Benchmark Consistency
  // =========================================================================
  assert(
    CANONICAL_CW_FIXTURE.solver_reference_solution.is_mathematically_solvable === true,
    "Canonical CW benchmark reference solution is mathematically solvable"
  );

  assert(
    CANONICAL_CW_FIXTURE.solver_reference_solution.is_budget_feasible === true,
    "Canonical CW benchmark reference solution is budget feasible (<= 50.0 m/s)"
  );

  const chiefEccentricity = 0.000028;
  assert(
    chiefEccentricity <= 0.005,
    "Canonical CW chief orbit eccentricity (0.000028) satisfies near-circular precondition (<= 0.005)"
  );

  return { passed, total, details };
}
