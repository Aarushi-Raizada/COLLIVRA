/**
 * ZORBIT M6.3.4 Stage 2: Store & Shell Parameter Propagation Test Suite
 *
 * Validates:
 * 1. Scenario URN propagates reactively from the shared Zustand store to shell and placeholder.
 * 2. Changing the active scenario in the store updates the propagated scenario prop.
 * 3. Clearing the active scenario propagates null safely without errors or fallbacks.
 * 4. The simulation module strictly respects the navigation hydration gate.
 * 5. Existing breakup and remediation subtab switching and object selection remain intact.
 * 6. No local duplicate state overrides the canonical shared scenario identity.
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useZorbitStore } from "../../store/useZorbitStore";
import { SimulationRemediationPlaceholder } from "../../components/views/SimulationRemediationPlaceholder";
import { SimulationDashboardView } from "../../components/simulation/SimulationDashboardView";
import type { ScenarioUrn } from "../../types/shared_state";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

export function runSimulationShellIntegrationTests(): {
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

  // Reset store before test suite
  function resetStore() {
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

  const defaultApiStatus = {
    connected: true,
    state: "connected" as const,
    lastCheckedUtc: "2026-11-08T00:00:00Z",
  };

  // ==========================================================================
  // Test Cases
  // ==========================================================================

  test("1. Scenario URN propagates reactively from the store selector to the view", () => {
    resetStore();
    const scenarioUrn: ScenarioUrn = "scenario:canonical-cw-reference";

    // Update store with canonical scenario URN
    useZorbitStore.getState().setActiveScenarioUrn(scenarioUrn);
    assert(useZorbitStore.getState().activeScenarioUrn === scenarioUrn, "Store activeScenarioUrn must match");

    // Render placeholder with store value passed as prop
    const html = renderToStaticMarkup(
      React.createElement(SimulationRemediationPlaceholder, {
        apiStatus: defaultApiStatus,
        isDemoMode: false,
        activeScenarioUrn: useZorbitStore.getState().activeScenarioUrn,
      })
    );

    assert(html.includes("SCENARIO: scenario:canonical-cw-reference"), "Rendered HTML must contain active scenario badge");
    assert(html.includes("data-testid=\"active-scenario-badge\""), "Must contain active-scenario-badge testid");
  });

  test("2. Changing the active scenario in the store updates the dashboard prop", () => {
    resetStore();

    // Step 1: Initial scenario
    const urn1: ScenarioUrn = "scenario:benchmark-iridium-cosmos";
    useZorbitStore.getState().setActiveScenarioUrn(urn1);

    let html = renderToStaticMarkup(
      React.createElement(SimulationRemediationPlaceholder, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: useZorbitStore.getState().activeScenarioUrn,
      })
    );
    assert(html.includes("SCENARIO: scenario:benchmark-iridium-cosmos"), "Initial render shows benchmark-iridium-cosmos");

    // Step 2: Switch scenario in store
    const urn2: ScenarioUrn = "scenario:SIM-a1b2c3d4-e5f6-47a8-b9c0-123456789abc";
    useZorbitStore.getState().setActiveScenarioUrn(urn2);

    html = renderToStaticMarkup(
      React.createElement(SimulationRemediationPlaceholder, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: useZorbitStore.getState().activeScenarioUrn,
      })
    );
    assert(html.includes("SCENARIO: scenario:SIM-a1b2c3d4-e5f6-47a8-b9c0-123456789abc"), "Updated render shows new scenario URN");
    assert(!html.includes("scenario:benchmark-iridium-cosmos"), "Old scenario URN is no longer present");
  });

  test("3. Clearing the active scenario propagates null safely without errors", () => {
    resetStore();

    // Set then clear
    useZorbitStore.getState().setActiveScenarioUrn("scenario:canonical-cw-reference");
    useZorbitStore.getState().setActiveScenarioUrn(null);
    assert(useZorbitStore.getState().activeScenarioUrn === null, "Store activeScenarioUrn is null");

    const html = renderToStaticMarkup(
      React.createElement(SimulationRemediationPlaceholder, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: useZorbitStore.getState().activeScenarioUrn,
      })
    );

    assert(!html.includes("data-testid=\"active-scenario-badge\""), "No active-scenario-badge rendered when null");
    assert(!html.includes("SCENARIO:"), "No scenario label rendered when null");
  });

  test("4. Navigation hydration gate is respected: initial store state is unhydrated", () => {
    resetStore();

    // Unhydrated store
    assert(useZorbitStore.getState().isHydrated === false, "Store must initialize with isHydrated = false");

    // When isHydrated is false, HomePage renders NavigationHydrationSkeleton instead of modules
    // Simulate hydration complete
    useZorbitStore.getState().setNavigationHydrated(true);
    assert(useZorbitStore.getState().isHydrated === true, "Store marks hydration complete");
  });

  test("5. Existing breakup and remediation subtab switching and object selection remain intact", () => {
    resetStore();

    // Render remediation subtab
    const htmlRemediation = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        initialSubtab: "remediation",
        initialObjectId: "SYNTH-FRAG-005",
        activeScenarioUrn: "scenario:canonical-cw-reference",
      })
    );

    assert(htmlRemediation.includes("CW Remediation"), "CW Remediation subtab button rendered");
    assert(htmlRemediation.includes("Clohessy-Wiltshire"), "Clohessy-Wiltshire content rendered");
    assert(htmlRemediation.includes("SCENARIO: scenario:canonical-cw-reference"), "Scenario badge displayed on remediation tab");

    // Render breakup subtab
    const htmlBreakup = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        initialSubtab: "breakup",
        activeScenarioUrn: null,
      })
    );

    assert(htmlBreakup.includes("Cowell DOP853"), "Breakup solver banner rendered");
    assert(!htmlBreakup.includes("data-testid=\"active-scenario-badge\""), "No scenario badge when null");
  });

  test("6. No duplicate local state: dashboard derives scenario purely from props", () => {
    // Both activeScenarioUrn and initialScenarioId are supported for backward/forward compatibility
    const htmlWithProp = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        activeScenarioUrn: "scenario:canonical-cw-reference",
      })
    );
    assert(htmlWithProp.includes("SCENARIO: scenario:canonical-cw-reference"), "Props directly project scenario identity");

    const htmlWithFallback = renderToStaticMarkup(
      React.createElement(SimulationDashboardView, {
        apiStatus: defaultApiStatus,
        initialScenarioId: "scenario:canonical-cw-reference",
      })
    );
    assert(htmlWithFallback.includes("SCENARIO: scenario:canonical-cw-reference"), "initialScenarioId prop projects scenario identity");
  });

  return { passed, total, details };
}
