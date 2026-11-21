/**
 * ZORBIT Simulation Payload Registry & Adapters — Unit Test Suite
 *
 * Validates Milestone 6.3.4 Stage 1 requirements:
 * 1. Independent payload registration (Breakup, CW Remediation, Composite).
 * 2. Cross-workflow preservation (non-destructive multi-payload storage under same ScenarioUrn).
 * 3. Independent invalidation of individual workflows.
 * 4. Composite payload handling and workflow slot population.
 * 5. Missing payload behavior and unknown scenario queries (zero silent guessing).
 * 6. Scenario deletion and dynamic scenario clearing while preserving benchmark fixtures.
 * 7. Versioning and stale-result protection.
 * 8. Canonical ScenarioUrn UUID-v4 convention (scenario:SIM-<uuid>).
 * 9. Adapter normalization for Breakup, Remediation, and Canonical CW Fixture.
 * 10. Strict scientific validation (no fabricated parent bodies for CW benchmark, finite vector enforcement).
 * 11. Rejection of malformed responses, non-finite numbers, and invalid coordinate vectors.
 * 12. Lightweight summary extraction (Tier 3 -> Tier 2 bridge).
 */

import fs from "fs";
import path from "path";
import {
  SimulationPayloadRegistry,
  createDynamicScenarioUrn,
  generatePayloadId,
} from "../simulationPayloadRegistry";
import {
  adaptBreakupResponseToPayload,
  adaptRemediationResponseToPayload,
  adaptCanonicalCwFixtureToPayload,
  adaptCompositePayload,
  extractSimulationSummary,
  validateVector3,
  validateFiniteNumber,
  validatePositiveNumber,
  validateNonNegativeNumber,
  isBreakupResultPayload,
  isRemediationResultPayload,
  isCompositeSimulationPayload,
  isScenarioPayloadRecord,
} from "../simulationAdapters";
import {
  DEMO_BREAKUP_RESPONSE,
  DEMO_REMEDIATION_RESPONSE,
} from "../../data/simulationFixtures";
import type {
  ScenarioUrn,
  BreakupResultPayload,
  RemediationResultPayload,
  CompositeSimulationPayload,
} from "../../types/shared_state";
import { isScenarioUrn } from "../urn";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

export function runSimulationPayloadRegistryTests(): {
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

  // Load canonical CW fixture safely from disk
  const fixturePath = path.resolve(
    __dirname,
    "../../../../../data/fixtures/cw_rendezvous_canonical_scenario.json"
  );
  let canonicalCwFixtureJson: any;
  try {
    canonicalCwFixtureJson = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
  } catch (err) {
    throw new Error(`Failed to read canonical CW fixture from ${fixturePath}: ${err}`);
  }

  // ==========================================================================
  // Test Suite
  // ==========================================================================

  test("1. Registry initializes as empty singleton and supports resetInstance", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    assert(registry.size === 0, "Registry must start with size 0");
    assert(registry.listScenarioUrns().length === 0, "listScenarioUrns must return empty array");
  });

  test("2. Canonical dynamic ScenarioUrn follows scenario:SIM-<uuid-v4> convention", () => {
    const urn1 = createDynamicScenarioUrn();
    const urn2 = createDynamicScenarioUrn();
    assert(urn1 !== urn2, "Generated URNs must be unique");
    assert(urn1.startsWith("scenario:SIM-"), "URN must start with 'scenario:SIM-'");
    assert(isScenarioUrn(urn1), "URN must pass isScenarioUrn validator");
    assert(isScenarioUrn(urn2), "Second URN must pass isScenarioUrn validator");

    const payloadId = generatePayloadId();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert(uuidRegex.test(payloadId), "Payload ID must be valid RFC 4122 v4 UUID");
  });

  test("3. Independent breakup payload registration creates record with version 1", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const breakupPayload = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    assert(isBreakupResultPayload(breakupPayload), "Must be valid BreakupResultPayload");
    assert(breakupPayload.kind === "BREAKUP_PROPAGATION", "Kind must be BREAKUP_PROPAGATION");

    const record = registry.setBreakupPayload(urn, breakupPayload);
    assert(record.scenarioUrn === urn, "Record URN must match input");
    assert(record.version === 1, "Initial version must be 1");
    assert(record.breakupPayload === breakupPayload, "Breakup payload must be stored");
    assert(record.remediationPayload === null, "Remediation payload must be null");
    assert(record.compositePayload === null, "Composite payload must be null");
    assert(record.isBenchmarkFixture === false, "Dynamic scenario is not benchmark");

    assert(registry.hasRecord(urn), "hasRecord must return true");
    assert(registry.getBreakupPayload(urn) === breakupPayload, "getBreakupPayload must return payload");
    assert(registry.getRemediationPayload(urn) === undefined, "getRemediationPayload must return undefined");
  });

  test("4. Independent CW remediation payload registration creates record with version 1", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = "scenario:canonical-cw-reference" as ScenarioUrn;

    const remediationPayload = adaptCanonicalCwFixtureToPayload(canonicalCwFixtureJson);
    assert(isRemediationResultPayload(remediationPayload), "Must be valid RemediationResultPayload");
    assert(remediationPayload.kind === "CW_REMEDIATION", "Kind must be CW_REMEDIATION");
    assert(remediationPayload.remediationResponse === null, "Pure CW benchmark must have null remediationResponse (scientific honesty)");

    const record = registry.setRemediationPayload(urn, remediationPayload, true);
    assert(record.version === 1, "Initial version must be 1");
    assert(record.breakupPayload === null, "Breakup payload must be null");
    assert(record.remediationPayload === remediationPayload, "Remediation payload must be stored");
    assert(record.isBenchmarkFixture === true, "Fixture must be flagged as benchmark");

    assert(registry.getRemediationPayload(urn) === remediationPayload, "getRemediationPayload must return payload");
    assert(registry.getBreakupPayload(urn) === undefined, "getBreakupPayload must return undefined");
  });

  test("5. Cross-workflow preservation: registering remediation preserves existing breakup payload", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    // Step 1: Register breakup
    const breakupPayload = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    registry.setBreakupPayload(urn, breakupPayload);

    // Step 2: Register remediation on SAME scenario
    const remediationPayload = adaptRemediationResponseToPayload(DEMO_REMEDIATION_RESPONSE);
    const updatedRecord = registry.setRemediationPayload(urn, remediationPayload);

    // Assertions: BOTH exist simultaneously!
    assert(updatedRecord.version === 2, "Version must increment to 2 on second workflow registration");
    assert(updatedRecord.breakupPayload === breakupPayload, "Breakup payload must be preserved without loss");
    assert(updatedRecord.remediationPayload === remediationPayload, "Remediation payload must be stored");
    assert(registry.getBreakupPayload(urn) === breakupPayload, "getBreakupPayload must return breakup");
    assert(registry.getRemediationPayload(urn) === remediationPayload, "getRemediationPayload must return remediation");
  });

  test("6. Updating one workflow preserves the other and increments version", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const breakupPayload1 = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const remediationPayload1 = adaptRemediationResponseToPayload(DEMO_REMEDIATION_RESPONSE);

    registry.setBreakupPayload(urn, breakupPayload1);
    registry.setRemediationPayload(urn, remediationPayload1);

    // Create updated breakup payload
    const breakupPayload2: BreakupResultPayload = {
      ...breakupPayload1,
      payloadId: generatePayloadId(),
      computedAtUtc: new Date().toISOString(),
    };

    const recordAfterBreakupUpdate = registry.setBreakupPayload(urn, breakupPayload2);
    assert(recordAfterBreakupUpdate.version === 3, "Version must increment to 3");
    assert(recordAfterBreakupUpdate.breakupPayload === breakupPayload2, "Breakup payload must be updated");
    assert(recordAfterBreakupUpdate.remediationPayload === remediationPayload1, "Remediation payload must remain intact");
  });

  test("7. Independent invalidation: invalidating remediation clears only remediation payload", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const breakup = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const remediation = adaptRemediationResponseToPayload(DEMO_REMEDIATION_RESPONSE);

    registry.setBreakupPayload(urn, breakup);
    registry.setRemediationPayload(urn, remediation);

    // Invalidate remediation
    const invalidatedRemediation = registry.invalidateWorkflow(urn, "remediation");
    assert(invalidatedRemediation === true, "Invalidate remediation must return true");

    const record = registry.getRecord(urn)!;
    assert(record.version === 3, "Version must increment to 3 on invalidation");
    assert(record.remediationPayload === null, "Remediation payload must now be null");
    assert(record.breakupPayload === breakup, "Breakup payload must remain completely intact!");

    // Redundant invalidation should be a no-op
    const redundant = registry.invalidateWorkflow(urn, "remediation");
    assert(redundant === false, "Redundant invalidation must return false");
    assert(record.version === 3, "Version must not increment on redundant invalidation");
  });

  test("8. Independent invalidation: invalidating breakup clears only breakup payload", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const breakup = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const remediation = adaptRemediationResponseToPayload(DEMO_REMEDIATION_RESPONSE);

    registry.setBreakupPayload(urn, breakup);
    registry.setRemediationPayload(urn, remediation);

    // Invalidate breakup
    const invalidatedBreakup = registry.invalidateWorkflow(urn, "breakup");
    assert(invalidatedBreakup === true, "Invalidate breakup must return true");

    const record = registry.getRecord(urn)!;
    assert(record.version === 3, "Version must increment to 3");
    assert(record.breakupPayload === null, "Breakup payload must now be null");
    assert(record.remediationPayload === remediation, "Remediation payload must remain completely intact!");
  });

  test("9. Composite payload combines workflows and populates individual slots", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const breakup = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const remediation = adaptRemediationResponseToPayload(DEMO_REMEDIATION_RESPONSE);

    const composite = adaptCompositePayload(breakup, remediation, "SYNTH-FRAG-001");
    assert(isCompositeSimulationPayload(composite), "Must be valid CompositeSimulationPayload");
    assert(composite.kind === "COMPOSITE_BREAKUP_REMEDIATION", "Kind must be COMPOSITE_BREAKUP_REMEDIATION");
    assert(composite.selectedFragmentId === "SYNTH-FRAG-001", "Selected fragment ID must match");

    const record = registry.setCompositePayload(urn, composite);
    assert(record.compositePayload === composite, "Composite payload must be stored");
    assert(record.breakupPayload === breakup, "Individual breakup slot must be populated");
    assert(record.remediationPayload === remediation, "Individual remediation slot must be populated");

    // Invalidate composite only
    registry.invalidateWorkflow(urn, "composite");
    assert(record.compositePayload === null, "Composite link cleared");
    assert(record.breakupPayload === breakup, "Breakup payload remains intact");
    assert(record.remediationPayload === remediation, "Remediation payload remains intact");
  });

  test("10. Missing payload queries return undefined safely (zero silent guessing)", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();

    const unknownUrn = "scenario:SIM-00000000-0000-4000-8000-000000000000" as ScenarioUrn;
    assert(registry.getRecord(unknownUrn) === undefined, "getRecord on unknown URN must return undefined");
    assert(registry.getBreakupPayload(unknownUrn) === undefined, "getBreakupPayload on unknown URN must return undefined");
    assert(registry.getRemediationPayload(unknownUrn) === undefined, "getRemediationPayload on unknown URN must return undefined");
    assert(registry.getCompositePayload(unknownUrn) === undefined, "getCompositePayload on unknown URN must return undefined");
    assert(registry.hasRecord(unknownUrn) === false, "hasRecord on unknown URN must return false");

    // Invalid URN types
    assert(registry.getRecord("" as any) === undefined, "Empty string URN returns undefined");
    assert(registry.getRecord("not-a-scenario-urn" as any) === undefined, "Malformed string returns undefined");
    assert(registry.getRecord(null as any) === undefined, "Null URN returns undefined");
  });

  test("11. Scenario removal and dynamic clearing", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();

    const dynamicUrn1 = createDynamicScenarioUrn();
    const dynamicUrn2 = createDynamicScenarioUrn();
    const benchmarkUrn = "scenario:canonical-cw-reference" as ScenarioUrn;

    const breakup = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const remediation = adaptCanonicalCwFixtureToPayload(canonicalCwFixtureJson);

    registry.setBreakupPayload(dynamicUrn1, breakup, false);
    registry.setBreakupPayload(dynamicUrn2, breakup, false);
    registry.setRemediationPayload(benchmarkUrn, remediation, true);

    assert(registry.size === 3, "Registry size must be 3");

    // Delete dynamicUrn1
    const deleted = registry.deleteScenario(dynamicUrn1);
    assert(deleted === true, "deleteScenario must return true");
    assert(registry.hasRecord(dynamicUrn1) === false, "dynamicUrn1 must be gone");
    assert(registry.size === 2, "Registry size must be 2");

    // Deleting non-existent scenario returns false
    assert(registry.deleteScenario(dynamicUrn1) === false, "Deleting already-deleted scenario returns false");

    // Clear dynamic scenarios
    registry.clearDynamicScenarios();
    assert(registry.size === 1, "Only benchmark fixture should remain");
    assert(registry.hasRecord(dynamicUrn2) === false, "dynamicUrn2 was cleared");
    assert(registry.hasRecord(benchmarkUrn) === true, "benchmarkUrn must be preserved");
  });

  test("12. Preload benchmark fixtures registers canonical CW benchmark", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();

    registry.preloadBenchmarkFixtures({
      cwFixture: canonicalCwFixtureJson,
      breakupFixture: DEMO_BREAKUP_RESPONSE,
    });

    assert(registry.hasRecord("scenario:canonical-cw-reference"), "Canonical CW reference must be preloaded");
    assert(registry.hasRecord("scenario:benchmark-iridium-cosmos"), "Iridium-Cosmos benchmark must be preloaded");

    const cwRecord = registry.getRecord("scenario:canonical-cw-reference")!;
    assert(cwRecord.isBenchmarkFixture === true, "CW benchmark must have isBenchmarkFixture = true");
    assert(cwRecord.remediationPayload !== null, "CW remediation payload must exist");
    assert(cwRecord.breakupPayload === null, "CW benchmark must have null breakupPayload");
  });

  test("13. Adapter validation: adaptBreakupResponseToPayload normalizes DEMO_BREAKUP_RESPONSE", () => {
    const payload = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    assert(payload.fragments.length === 10, "Must have 10 fragments");
    assert(payload.trajectories.length === 10, "Must have 10 trajectories");
    assert(payload.metadata.model_name === "ZORBIT Simplified Synthetic Fragmentation Model", "Model name preserved");
    assert(payload.metadata.total_parent_mass_kg === 1000, "Parent mass preserved");
    assert(payload.executionWallTimeMs === 48, "Execution wall time normalized to ms (0.048 s * 1000)");
  });

  test("14. Adapter validation: adaptRemediationResponseToPayload derives near-circular chief orbit", () => {
    const payload = adaptRemediationResponseToPayload(DEMO_REMEDIATION_RESPONSE);
    assert(payload.kind === "CW_REMEDIATION", "Kind is CW_REMEDIATION");
    assert(payload.chiefOrbit.semi_major_axis_km > 6500, "Semi-major axis must be realistic LEO (> 6500 km)");
    assert(payload.chiefOrbit.mean_motion_rad_s > 0.001, "Mean motion must be ~0.00103 rad/s");
    assert(payload.rendezvous.total_delta_v_ms === 11.63, "Total delta-V preserved");
    assert(payload.rendezvous.is_feasible === true, "Feasibility flag preserved");
  });

  test("15. Adapter validation: adaptCanonicalCwFixtureToPayload adheres to AGENTS.md scientific integrity", () => {
    const payload = adaptCanonicalCwFixtureToPayload(canonicalCwFixtureJson);
    assert(payload.remediationResponse === null, "Scientific honesty: no fake parent bodies fabricated");
    assert(payload.chiefOrbit.chief_gcrs_position_km[0] === 7200.012, "Chief position X preserved");
    assert(payload.chiefOrbit.semi_major_axis_km === 7199.813308893886, "Semi-major axis preserved");
    assert(payload.chiefOrbit.mean_motion_rad_s === 0.0010334442063453571, "Mean motion preserved");
    assert(payload.rendezvous.burn_1_dv_cw_ms[0] === 0.25218453794428525, "Burn 1 Radial dv preserved");
    assert(payload.rendezvous.burn_1_dv_cw_ms[1] === -1.1703533119604062, "Burn 1 In-Track dv preserved");
    assert(payload.rendezvous.burn_1_dv_cw_ms[2] === 0.5421004211114259, "Burn 1 Cross-Track dv preserved");
    assert(payload.rendezvous.total_delta_v_ms === 2.398387074731806, "Total delta-V preserved");
  });

  test("16. Adapter validation: extracts lightweight simulation summary (Tier 3 -> Tier 2 bridge)", () => {
    const urn = createDynamicScenarioUrn();
    const breakup = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const remediation = adaptRemediationResponseToPayload(DEMO_REMEDIATION_RESPONSE);

    // Composite summary
    const record: any = {
      scenarioUrn: urn,
      version: 2,
      createdAtUtc: new Date().toISOString(),
      updatedAtUtc: new Date().toISOString(),
      isBenchmarkFixture: false,
      breakupPayload: breakup,
      remediationPayload: remediation,
      compositePayload: adaptCompositePayload(breakup, remediation, "SYNTH-FRAG-001"),
    };

    const summary = extractSimulationSummary(record);
    assert(summary.scenarioUrn === urn, "Summary URN matches");
    assert(summary.status === "SUCCESS", "Status is SUCCESS");
    assert(summary.fragmentCount === 10, "Fragment count is 10");
    assert(summary.massBalance.totalParentMassKg === 1000, "Parent mass is 1000");
    assert(summary.remediationSummary !== undefined, "Remediation summary is present");
    assert(summary.remediationSummary?.totalDeltaVMs === 11.63, "Remediation delta-V matches");

    // Pure CW summary
    const pureCwRecord: any = {
      scenarioUrn: "scenario:canonical-cw-reference",
      version: 1,
      createdAtUtc: new Date().toISOString(),
      updatedAtUtc: new Date().toISOString(),
      isBenchmarkFixture: true,
      breakupPayload: null,
      remediationPayload: adaptCanonicalCwFixtureToPayload(canonicalCwFixtureJson),
      compositePayload: null,
    };

    const cwSummary = extractSimulationSummary(pureCwRecord);
    assert(cwSummary.fragmentCount === 0, "Pure CW summary has 0 fragments (no fake fragmentation)");
    assert(cwSummary.remediationSummary?.totalDeltaVMs === 2.398387074731806, "CW total delta-V matches 2.40 m/s");
  });

  test("17. Strict vector validation rejects NaN, Infinity, null, and non-3D vectors", () => {
    // Valid 3D vector passes
    const valid = validateVector3([1.0, 2.0, 3.0], "testVector");
    assert(valid[0] === 1.0 && valid[1] === 2.0 && valid[2] === 3.0, "Valid vector must pass");

    // NaN rejected
    let threwNaN = false;
    try {
      validateVector3([1.0, NaN, 3.0], "nanVector");
    } catch (e) {
      threwNaN = true;
    }
    assert(threwNaN, "Vector with NaN must throw TypeError");

    // Infinity rejected
    let threwInf = false;
    try {
      validateVector3([1.0, Infinity, 3.0], "infVector");
    } catch (e) {
      threwInf = true;
    }
    assert(threwInf, "Vector with Infinity must throw TypeError");

    // Length 2 rejected
    let threwLen2 = false;
    try {
      validateVector3([1.0, 2.0], "len2Vector");
    } catch (e) {
      threwLen2 = true;
    }
    assert(threwLen2, "Vector of length 2 must throw TypeError");

    // Non-array rejected
    let threwNonArray = false;
    try {
      validateVector3("not-an-array", "strVector");
    } catch (e) {
      threwNonArray = true;
    }
    assert(threwNonArray, "Non-array vector must throw TypeError");
  });

  test("18. Scalar validation rejects negative numbers where positive or non-negative is required", () => {
    assert(validatePositiveNumber(10, "pos") === 10, "Positive number passes");
    assert(validateNonNegativeNumber(0, "nonNeg") === 0, "Zero passes non-negative check");

    let threwZeroPos = false;
    try {
      validatePositiveNumber(0, "zeroPos");
    } catch (e) {
      threwZeroPos = true;
    }
    assert(threwZeroPos, "Zero must fail strictly positive check");

    let threwNeg = false;
    try {
      validateNonNegativeNumber(-1, "neg");
    } catch (e) {
      threwNeg = true;
    }
    assert(threwNeg, "Negative number must fail non-negative check");
  });

  test("19. Rejection of malformed simulation responses without silent guessing", () => {
    // Malformed breakup response
    let threwMalformedBreakup = false;
    try {
      adaptBreakupResponseToPayload({} as any);
    } catch (e) {
      threwMalformedBreakup = true;
    }
    assert(threwMalformedBreakup, "Empty breakup response must throw TypeError");

    // Malformed CW fixture
    let threwMalformedCw = false;
    try {
      adaptCanonicalCwFixtureToPayload({ chief_orbit: null } as any);
    } catch (e) {
      threwMalformedCw = true;
    }
    assert(threwMalformedCw, "Malformed CW fixture must throw TypeError");

    // Malformed composite parameters
    let threwMalformedComposite = false;
    try {
      adaptCompositePayload({ kind: "BREAKUP_PROPAGATION" } as any, { kind: "BREAKUP_PROPAGATION" } as any, "");
    } catch (e) {
      threwMalformedComposite = true;
    }
    assert(threwMalformedComposite, "Incompatible composite kinds must throw TypeError");
  });

  test("20. Rejection of invalid ScenarioUrn when registering payloads", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const breakup = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);

    let threwInvalidUrn = false;
    try {
      registry.setBreakupPayload("invalid-urn" as any, breakup);
    } catch (e) {
      threwInvalidUrn = true;
    }
    assert(threwInvalidUrn, "Registering with invalid URN must throw TypeError");
  });

  // ==========================================================================
  // Concurrency & Freshness Guard Tests (DEF-634-1)
  // ==========================================================================

  test("21. Request A starts, then B starts, B completes first, A completes last -> A rejected", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    // 1. Start Request A
    const tokenA = registry.beginWorkflowRequest(urn, "breakup");
    assert(typeof tokenA === "string" && tokenA.length > 0, "tokenA must be valid string");
    assert(registry.isWorkflowRequestCurrent(urn, "breakup", tokenA) === true, "tokenA must be active initially");

    // 2. Start newer Request B for same scenario and workflow
    const tokenB = registry.beginWorkflowRequest(urn, "breakup");
    assert(tokenB !== tokenA, "tokenB must be distinct from tokenA");
    assert(registry.isWorkflowRequestCurrent(urn, "breakup", tokenA) === false, "tokenA must be invalidated by tokenB");
    assert(registry.isWorkflowRequestCurrent(urn, "breakup", tokenB) === true, "tokenB must be active");

    // 3. Complete B first
    const payloadB = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const commitB = registry.commitWorkflowResult(urn, "breakup", tokenB, payloadB);
    assert(commitB.success === true, "commitB must succeed");
    assert(commitB.record?.version === 1, "Record version must be 1");
    assert(registry.getBreakupPayload(urn) === payloadB, "Payload B must be committed in registry");

    // 4. Complete A afterward (out-of-order delayed response)
    const payloadA: BreakupResultPayload = {
      ...payloadB,
      payloadId: generatePayloadId(),
      metadata: { ...payloadB.metadata, total_parent_mass_kg: 9999 },
    };
    const commitA = registry.commitWorkflowResult(urn, "breakup", tokenA, payloadA);
    assert(commitA.success === false, "commitA must be rejected");
    assert(commitA.isStale === true, "commitA must be flagged as stale");

    // Verify Payload B was NOT overwritten!
    const activePayload = registry.getBreakupPayload(urn)!;
    assert(activePayload === payloadB, "Payload B must NOT be overwritten by stale Request A");
    assert(activePayload.metadata.total_parent_mass_kg === 1000, "Parent mass must remain 1000 (from B)");
    assert(registry.getRecord(urn)?.version === 1, "Record version must remain 1 (no mutation by stale A)");
  });

  test("22. Older breakup response is rejected without modifying record or version", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const token1 = registry.beginWorkflowRequest(urn, "breakup");
    const token2 = registry.beginWorkflowRequest(urn, "breakup");

    const payload1 = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const res1 = registry.commitWorkflowResult(urn, "breakup", token1, payload1);
    assert(res1.success === false, "Older breakup response must fail commit");
    assert(res1.isStale === true, "isStale must be true");
    assert(registry.hasRecord(urn) === false, "No record should be created by rejected stale commit");
  });

  test("23. Older remediation response is rejected without modifying record or version", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const tokenA = registry.beginWorkflowRequest(urn, "remediation");
    const tokenB = registry.beginWorkflowRequest(urn, "remediation");

    const payloadB = adaptRemediationResponseToPayload(DEMO_REMEDIATION_RESPONSE);
    const commitB = registry.commitWorkflowResult(urn, "remediation", tokenB, payloadB);
    assert(commitB.success === true, "Newer remediation commit must succeed");
    assert(registry.getRecord(urn)?.version === 1, "Version is 1");

    const payloadA: RemediationResultPayload = {
      ...payloadB,
      payloadId: generatePayloadId(),
      rendezvous: { ...payloadB.rendezvous, total_delta_v_ms: 999.0 },
    };
    const commitA = registry.commitWorkflowResult(urn, "remediation", tokenA, payloadA);
    assert(commitA.success === false, "Older remediation commit must be rejected");
    assert(commitA.isStale === true, "isStale must be true");

    const activeRemediation = registry.getRemediationPayload(urn)!;
    assert(activeRemediation.rendezvous.total_delta_v_ms === 11.63, "Delta-V remains from B (11.63, not 999.0)");
    assert(registry.getRecord(urn)?.version === 1, "Version remains 1");
  });

  test("24. Newer response is accepted when matching current request token", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const token = registry.beginWorkflowRequest(urn, "breakup");
    const payload = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);

    const res = registry.commitWorkflowResult(urn, "breakup", token, payload);
    assert(res.success === true, "Commit with active token must succeed");
    assert(res.record?.scenarioUrn === urn, "Committed record URN matches");
    assert(registry.getBreakupPayload(urn) === payload, "Payload is retrievable");
  });

  test("25. Breakup and remediation requests do not invalidate one another", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const breakupToken = registry.beginWorkflowRequest(urn, "breakup");
    const remediationToken = registry.beginWorkflowRequest(urn, "remediation");

    // Assert both are active concurrently
    assert(registry.isWorkflowRequestCurrent(urn, "breakup", breakupToken) === true, "Breakup token must be active");
    assert(registry.isWorkflowRequestCurrent(urn, "remediation", remediationToken) === true, "Remediation token must be active");

    // Starting a second breakup request supersedes breakupToken, but leaves remediationToken intact
    const breakupToken2 = registry.beginWorkflowRequest(urn, "breakup");
    assert(registry.isWorkflowRequestCurrent(urn, "breakup", breakupToken) === false, "First breakup token superseded");
    assert(registry.isWorkflowRequestCurrent(urn, "breakup", breakupToken2) === true, "Second breakup token active");
    assert(registry.isWorkflowRequestCurrent(urn, "remediation", remediationToken) === true, "Remediation token remains untouched!");
  });

  test("26. Scenario deletion invalidates outstanding tokens", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const breakupToken = registry.beginWorkflowRequest(urn, "breakup");
    const remediationToken = registry.beginWorkflowRequest(urn, "remediation");

    registry.deleteScenario(urn);

    assert(registry.isWorkflowRequestCurrent(urn, "breakup", breakupToken) === false, "Breakup token invalidated on delete");
    assert(registry.isWorkflowRequestCurrent(urn, "remediation", remediationToken) === false, "Remediation token invalidated on delete");

    const payload = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const commit = registry.commitWorkflowResult(urn, "breakup", breakupToken, payload);
    assert(commit.success === false, "Commit must fail after scenario deletion");
  });

  test("27. Registry reset invalidates outstanding tokens", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const token = registry.beginWorkflowRequest(urn, "breakup");
    SimulationPayloadRegistry.resetInstance();

    const newRegistry = SimulationPayloadRegistry.getInstance();
    assert(newRegistry.isWorkflowRequestCurrent(urn, "breakup", token) === false, "Token must be invalid after resetInstance");
  });

  test("28. Stale commits do not increment payload versions or update timestamps", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const token1 = registry.beginWorkflowRequest(urn, "breakup");
    const token2 = registry.beginWorkflowRequest(urn, "breakup");

    const payload2 = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    registry.commitWorkflowResult(urn, "breakup", token2, payload2);
    const recordBefore = registry.getRecord(urn)!;
    const versionBefore = recordBefore.version;
    const updatedAtBefore = recordBefore.updatedAtUtc;

    // Attempt stale commit with token1
    const payload1 = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const staleCommit = registry.commitWorkflowResult(urn, "breakup", token1, payload1);
    assert(staleCommit.success === false, "Stale commit rejected");

    const recordAfter = registry.getRecord(urn)!;
    assert(recordAfter.version === versionBefore, "Version must not change on rejected commit");
    assert(recordAfter.updatedAtUtc === updatedAtBefore, "UpdatedAt must not change on rejected commit");
  });

  test("29. Composite results cannot be restored from stale workflow generations", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    const breakupToken1 = registry.beginWorkflowRequest(urn, "breakup");
    const remediationToken1 = registry.beginWorkflowRequest(urn, "remediation");

    const breakup = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const remediation = adaptRemediationResponseToPayload(DEMO_REMEDIATION_RESPONSE);

    registry.commitWorkflowResult(urn, "breakup", breakupToken1, breakup);
    registry.commitWorkflowResult(urn, "remediation", remediationToken1, remediation);

    // Composite commit with valid tokens succeeds
    const composite = adaptCompositePayload(breakup, remediation, "SYNTH-FRAG-001");
    const compCommit = registry.commitCompositePayload(urn, breakupToken1, remediationToken1, composite);
    assert(compCommit.success === true, "Composite commit with active tokens succeeds");
    assert(registry.getCompositePayload(urn) === composite, "Composite payload stored");

    // Invalidate breakup
    registry.invalidateWorkflow(urn, "breakup");
    assert(registry.getCompositePayload(urn) === undefined, "Composite payload cleared on breakup invalidation");

    // Attempt to re-commit composite using old breakupToken1
    const reCommit = registry.commitCompositePayload(urn, breakupToken1, remediationToken1, composite);
    assert(reCommit.success === false, "Cannot commit composite with invalidated breakup token");
    assert(reCommit.isStale === true, "Flagged as stale");
    assert(registry.getCompositePayload(urn) === undefined, "Composite remains unavailable");
  });

  test("30. A current request can successfully commit after an earlier request was invalidated", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn = createDynamicScenarioUrn();

    // 1. Token 1 issued and then invalidated
    const token1 = registry.beginWorkflowRequest(urn, "breakup");
    registry.invalidateWorkflow(urn, "breakup");
    assert(registry.isWorkflowRequestCurrent(urn, "breakup", token1) === false, "token1 is invalidated");

    // 2. Token 2 issued
    const token2 = registry.beginWorkflowRequest(urn, "breakup");
    assert(registry.isWorkflowRequestCurrent(urn, "breakup", token2) === true, "token2 is active");

    // 3. Stale token 1 cannot commit
    const payload = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const commit1 = registry.commitWorkflowResult(urn, "breakup", token1, payload);
    assert(commit1.success === false, "token1 commit rejected");

    // 4. Current token 2 commits successfully!
    const commit2 = registry.commitWorkflowResult(urn, "breakup", token2, payload);
    assert(commit2.success === true, "token2 commit succeeds");
    assert(registry.getBreakupPayload(urn) === payload, "Payload stored");
    assert(registry.getRecord(urn)?.version === 1, "Record version is 1");
  });

  return { passed, total, details };
}
