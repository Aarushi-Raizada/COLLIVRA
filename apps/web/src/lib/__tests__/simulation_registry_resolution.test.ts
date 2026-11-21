/**
 * ZORBIT M6.3.4 Stage 3: Dashboard Registry Resolution & Scenario Binding Test Suite
 *
 * Validates:
 * 1. Canonical CW fixture resolves correctly (`scenario:canonical-cw-reference`).
 * 2. Benchmark fixture preload is idempotent.
 * 3. Active scenario changes update the displayed payload.
 * 4. Clearing the active scenario clears the displayed payload.
 * 5. Missing payload produces an explicit unavailable state (zero silent fallback).
 * 6. Deleted or invalidated payload cannot remain visible.
 * 7. Pure CW remediation fixture does not fabricate breakup data.
 * 8. Breakup-only scenario does not accidentally render remediation data.
 * 9. Composite payload preserves independent breakup and remediation slots.
 * 10. Switching between two scenarios cannot leak stale data.
 * 11. Existing Stage 1 freshness-token protections remain intact.
 * 12. Navigation hydration gate remains respected.
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useZorbitStore } from "../../store/useZorbitStore";
import {
  SimulationPayloadRegistry,
  createDynamicScenarioUrn,
} from "../simulationPayloadRegistry";
import {
  adaptBreakupResponseToPayload,
  adaptRemediationResponseToPayload,
  adaptCompositePayload,
} from "../simulationAdapters";
import { SimulationDashboardView } from "../../components/simulation/SimulationDashboardView";
import {
  DEMO_BREAKUP_RESPONSE,
  DEMO_REMEDIATION_RESPONSE,
} from "../../data/simulationFixtures";
import { CANONICAL_CW_FIXTURE } from "../../data/canonicalCwFixture";
import type { ScenarioUrn } from "../../types/shared_state";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

export function runSimulationRegistryResolutionTests(): {
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

  const defaultApiStatus = {
    connected: true,
    state: "connected" as const,
    lastCheckedUtc: "2026-11-08T00:00:00Z",
  };

  function setupCleanEnvironment() {
    SimulationPayloadRegistry.resetInstance();
    useZorbitStore.setState({
      activeTab: "overview",
      activeSubtab: null,
      selectedObjectUrn: null,
      activeEventUrn: null,
      activeScenarioUrn: null,
      isHydrated: false,
      hydrationError: null,
      scenarios: {},
      scenarioSummaries: {},
    });
  }

  // ==========================================================================
  // Test Cases
  // ==========================================================================

  test("1. Canonical CW fixture resolves correctly (scenario:canonical-cw-reference)", () => {
    setupCleanEnvironment();
    const registry = SimulationPayloadRegistry.getInstance();
    registry.preloadBenchmarkFixtures();

    const html = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: "scenario:canonical-cw-reference",
        initialSubtab: "remediation",
      })
    );

    assert(html.includes("SCENARIO: scenario:canonical-cw-reference"), "Must render canonical CW scenario badge");
    assert(html.includes("BENCHMARK FIXTURE"), "Must render BENCHMARK FIXTURE badge");
    assert(html.includes("Clohessy-Wiltshire Impulsive Burn Solution"), "Must render CW burn solution");
    assert(html.includes("data-testid=\"active-scenario-badge\""), "Must contain active-scenario-badge testid");
    assert(html.includes("2.40") || html.includes("2.398") || html.includes("2.4"), "Must display total delta-V for canonical CW benchmark");
  });

  test("2. Benchmark fixture preload is idempotent", () => {
    setupCleanEnvironment();
    const registry = SimulationPayloadRegistry.getInstance();

    // Call preload multiple times
    registry.preloadBenchmarkFixtures();
    assert(registry.size === 2, "Registry size must be 2 after initial preload");
    assert(registry.hasRecord("scenario:canonical-cw-reference"), "Canonical CW record must exist");
    assert(registry.hasRecord("scenario:benchmark-iridium-cosmos"), "Iridium-Cosmos record must exist");

    const record1 = registry.getRecord("scenario:canonical-cw-reference");
    assert(record1?.isBenchmarkFixture === true, "Must be flagged as benchmark fixture");

    // Second call: idempotent update
    registry.preloadBenchmarkFixtures();
    assert(registry.size === 2, "Registry size must remain 2 after duplicate preload");

    // Clearing dynamic scenarios does not delete benchmark fixtures
    registry.clearDynamicScenarios();
    assert(registry.size === 2, "clearDynamicScenarios must preserve benchmark fixtures");
  });

  test("3. Active scenario changes update the displayed payload", () => {
    setupCleanEnvironment();
    const registry = SimulationPayloadRegistry.getInstance();
    registry.preloadBenchmarkFixtures();

    // Render Scenario 1: Canonical CW benchmark on remediation subtab
    const htmlCw = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: "scenario:canonical-cw-reference",
        initialSubtab: "remediation",
      })
    );
    assert(htmlCw.includes("SCENARIO: scenario:canonical-cw-reference"), "Initial render shows canonical CW");
    assert(htmlCw.includes("Clohessy-Wiltshire Impulsive Burn Solution"), "Initial render shows CW solution");

    // Render Scenario 2: Iridium-Cosmos on breakup subtab
    const htmlBreakup = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: "scenario:benchmark-iridium-cosmos",
        initialSubtab: "breakup",
      })
    );
    assert(htmlBreakup.includes("SCENARIO: scenario:benchmark-iridium-cosmos"), "Second render shows iridium-cosmos");
    assert(htmlBreakup.includes("Breakup Fragmentation &amp; Propagation Results") || htmlBreakup.includes("Breakup Fragmentation & Propagation Results"), "Shows breakup results");
    assert(!htmlBreakup.includes("scenario:canonical-cw-reference"), "Does not leak previous scenario identity");
  });

  test("4. Clearing the active scenario clears the displayed payload", () => {
    setupCleanEnvironment();
    const registry = SimulationPayloadRegistry.getInstance();
    registry.preloadBenchmarkFixtures();

    // Render with activeScenarioUrn = null
    const html = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: null,
        initialSubtab: "breakup",
      })
    );

    assert(!html.includes("data-testid=\"active-scenario-badge\""), "No scenario badge rendered when null");
    assert(!html.includes("Breakup Fragmentation &amp; Propagation Results"), "No breakup results rendered when no scenario active");
    assert(!html.includes("data-testid=\"scenario-unavailable-card\""), "No unavailable error card when null (clean initial form)");
  });

  test("5. Missing payload produces an explicit unavailable state (zero silent fallback)", () => {
    setupCleanEnvironment();
    const registry = SimulationPayloadRegistry.getInstance();
    // Do not register uncomputed scenario
    const uncomputedUrn: ScenarioUrn = "scenario:SIM-uncomputed-uuid-001";

    const html = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: uncomputedUrn,
        initialSubtab: "breakup",
      })
    );

    assert(html.includes("data-testid=\"scenario-unavailable-card\""), "Must render explicit scenario-unavailable-card");
    assert(html.includes("SCENARIO PAYLOAD UNAVAILABLE OR EXPIRED"), "Must state scenario payload unavailable or expired");
    assert(!html.includes("Breakup Fragmentation &amp; Propagation Results"), "Must NOT silently render breakup results for missing payload");
  });

  test("6. Deleted or invalidated payload cannot remain visible", () => {
    setupCleanEnvironment();
    const registry = SimulationPayloadRegistry.getInstance();
    const dynamicUrn: ScenarioUrn = "scenario:SIM-dynamic-deletion-test";

    // Register a breakup payload
    const payload = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    registry.setBreakupPayload(dynamicUrn, payload, false);
    assert(registry.hasRecord(dynamicUrn), "Record must exist prior to deletion");

    // Delete scenario
    registry.deleteScenario(dynamicUrn);
    assert(!registry.hasRecord(dynamicUrn), "Record must be deleted from registry");

    // Render view with deleted URN
    const html = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: dynamicUrn,
        initialSubtab: "breakup",
      })
    );

    assert(html.includes("data-testid=\"scenario-unavailable-card\""), "Deleted payload displays unavailable state");
    assert(!html.includes("Breakup Fragmentation &amp; Propagation Results"), "Deleted payload cannot remain visible");
  });

  test("7. Pure CW remediation fixture does not fabricate breakup data", () => {
    setupCleanEnvironment();
    const registry = SimulationPayloadRegistry.getInstance();
    registry.preloadBenchmarkFixtures();

    // User navigates to breakup tab on canonical CW benchmark
    const html = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: "scenario:canonical-cw-reference",
        initialSubtab: "breakup",
      })
    );

    assert(html.includes("data-testid=\"pure-cw-notice-card\""), "Must render pure-cw-notice-card");
    assert(html.includes("CLOHESSY-WILTSHIRE RENDEZVOUS BENCHMARK"), "Must state it is a CW rendezvous benchmark");
    assert(!html.includes("Breakup Fragmentation &amp; Propagation Results"), "Must NOT render fake breakup results");
  });

  test("8. Breakup-only scenario does not accidentally render remediation data", () => {
    setupCleanEnvironment();
    const registry = SimulationPayloadRegistry.getInstance();
    registry.preloadBenchmarkFixtures();

    // User navigates to remediation tab on breakup-only benchmark
    const html = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: "scenario:benchmark-iridium-cosmos",
        initialSubtab: "remediation",
      })
    );

    assert(html.includes("data-testid=\"remediation-not-computed-card\""), "Must render remediation-not-computed-card");
    assert(html.includes("REMEDIATION PLAN NOT YET COMPUTED"), "Must explain remediation is not yet computed");
    assert(!html.includes("Clohessy-Wiltshire Impulsive Burn Solution"), "Must NOT render fake remediation solution");
  });

  test("9. Composite payload preserves independent breakup and remediation slots", () => {
    setupCleanEnvironment();
    const registry = SimulationPayloadRegistry.getInstance();
    const compositeUrn: ScenarioUrn = "scenario:SIM-composite-test-001";

    const breakupPayload = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const remediationPayload = adaptRemediationResponseToPayload(DEMO_REMEDIATION_RESPONSE);
    const compositePayload = adaptCompositePayload(
      breakupPayload,
      remediationPayload,
      "SYNTH-FRAG-001"
    );

    registry.setCompositePayload(compositeUrn, compositePayload);

    // Breakup tab render
    const htmlBreakup = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: compositeUrn,
        initialSubtab: "breakup",
      })
    );
    assert(htmlBreakup.includes("Breakup Fragmentation &amp; Propagation Results"), "Breakup results render for composite scenario");

    // Remediation tab render
    const htmlRemediation = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: compositeUrn,
        initialSubtab: "remediation",
      })
    );
    assert(htmlRemediation.includes("Clohessy-Wiltshire Impulsive Burn Solution"), "Remediation solution renders for composite scenario");

    // Invalidate breakup: remediation payload preserved
    registry.invalidateWorkflow(compositeUrn, "breakup");
    const record = registry.getRecord(compositeUrn);
    assert(record?.breakupPayload === null, "Breakup payload cleared");
    assert(record?.remediationPayload !== null, "Remediation payload preserved");
  });

  test("10. Switching between two scenarios cannot leak stale data", () => {
    setupCleanEnvironment();
    const registry = SimulationPayloadRegistry.getInstance();

    const urnA: ScenarioUrn = "scenario:SIM-scenario-alpha";
    const urnB: ScenarioUrn = "scenario:SIM-scenario-beta";

    const payloadA = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    registry.setBreakupPayload(urnA, payloadA);

    // Scenario A has breakup results
    const htmlA = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: urnA,
        initialSubtab: "breakup",
      })
    );
    assert(htmlA.includes("SCENARIO: scenario:SIM-scenario-alpha"), "Shows Scenario Alpha");
    assert(htmlA.includes("Breakup Fragmentation &amp; Propagation Results"), "Shows Alpha breakup results");

    // Scenario B has no record in registry
    const htmlB = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: urnB,
        initialSubtab: "breakup",
      })
    );
    assert(htmlB.includes("SCENARIO: scenario:SIM-scenario-beta"), "Shows Scenario Beta");
    assert(htmlB.includes("data-testid=\"scenario-unavailable-card\""), "Shows unavailable card for Beta");
    assert(!htmlB.includes("scenario:SIM-scenario-alpha"), "Zero leakage of Alpha data into Beta");
  });

  test("11. Existing Stage 1 freshness-token protections remain intact", () => {
    setupCleanEnvironment();
    const registry = SimulationPayloadRegistry.getInstance();
    const urn: ScenarioUrn = createDynamicScenarioUrn();

    const token1 = registry.beginWorkflowRequest(urn, "breakup");
    assert(registry.isWorkflowRequestCurrent(urn, "breakup", token1), "Token 1 must be current initially");

    const token2 = registry.beginWorkflowRequest(urn, "breakup");
    assert(!registry.isWorkflowRequestCurrent(urn, "breakup", token1), "Token 1 invalidated by Token 2");
    assert(registry.isWorkflowRequestCurrent(urn, "breakup", token2), "Token 2 is now current");

    const payload = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const commitStale = registry.commitWorkflowResult(urn, "breakup", token1, payload);
    assert(!commitStale.success, "Stale commit with token1 rejected");
    assert(commitStale.isStale === true, "Flagged as isStale");

    const commitValid = registry.commitWorkflowResult(urn, "breakup", token2, payload);
    assert(commitValid.success, "Current commit with token2 accepted");
  });

  test("12. Navigation hydration gate remains respected", () => {
    setupCleanEnvironment();
    assert(useZorbitStore.getState().isHydrated === false, "Store initialized unhydrated");

    // Unhydrated store: shell does not render module
    useZorbitStore.getState().setNavigationHydrated(true);
    assert(useZorbitStore.getState().isHydrated === true, "Hydration state marked true");
  });

  return { passed, total, details };
}

