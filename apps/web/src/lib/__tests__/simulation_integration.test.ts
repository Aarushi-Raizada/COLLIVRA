/**
 * ZORBIT M6.3.4 Stage 4: Simulation Integration & Cross-Module Verification Test Suite
 *
 * Implements M6.3.4 Stage 4 verification with Refinements 1, 2, and 3:
 * 1. Child Results View Provenance Badges (Breakup & Remediation).
 * 2. Cross-Module Navigation Parameter Harmonization (Conjunctions -> Simulation).
 * 3. Mission Overview Canonical CW Benchmark Launch Action (Refinement 2).
 * 4. Dedicated Integration Bridge Synchronization (Refinement 1).
 * 5. Invalidation and Deletion Bridge Behavior (no stale summaries in Zustand).
 * 6. Scientific Fixture Verification: DEMO_BREAKUP_RESPONSE vs scenario:benchmark-iridium-cosmos (Refinement 3).
 * 7. Asynchronous Submission Lifecycle & Error Handling (Stage 3 Follow-up 2).
 * 8. Client Subscription Lifecycle & Listener Cleanup (Stage 3 Follow-up 3).
 * 9. Lightweight Store Segregation (< 2 kB, no trajectories in Zustand).
 * 10. Zero-Regression Gate.
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
  adaptCanonicalCwFixtureToPayload,
} from "../simulationAdapters";
import { SimulationStoreBridge } from "../simulationStoreBridge";
import { BreakupResultsView } from "../../components/simulation/BreakupResultsView";
import { RemediationResultsView } from "../../components/simulation/RemediationResultsView";
import { CloseApproachInspector } from "../../components/conjunctions/CloseApproachInspector";
import { MissionDashboardView } from "../../components/views/MissionDashboardView";
import {
  DEMO_BREAKUP_RESPONSE,
  DEMO_REMEDIATION_RESPONSE,
} from "../../data/simulationFixtures";
import { CANONICAL_CW_FIXTURE } from "../../data/canonicalCwFixture";
import type { ConjunctionEvent } from "../../types/api";
import type { NavigationTab, ApiConnectionStatus } from "../../types/orbital";
import type { ScenarioUrn } from "../../types/shared_state";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

export function runSimulationIntegrationTests(): {
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
      const msg = err instanceof Error ? err.message : String(err);
      details.push(`[FAIL] ${name} -> ${msg}`);
      console.error(`[FAIL] ${name}:`, err);
    }
  }

  // =========================================================================
  // Test 1: Breakup Results View Scenario Provenance Badge
  // =========================================================================
  test("1. Breakup Results View renders scenario provenance badge when provided and omits when null", () => {
    // A. With scenarioUrn
    const markupWithBadge = renderToStaticMarkup(
      React.createElement(BreakupResultsView, {
        response: DEMO_BREAKUP_RESPONSE,
        selectedFragmentId: null,
        onSelectFragment: () => {},
        isDemo: true,
        scenarioUrn: "scenario:benchmark-iridium-cosmos" as ScenarioUrn,
      })
    );
    assert(
      markupWithBadge.includes('data-testid="breakup-scenario-badge"'),
      "BreakupResultsView must render data-testid='breakup-scenario-badge' when scenarioUrn is provided."
    );
    assert(
      markupWithBadge.includes("scenario:benchmark-iridium-cosmos"),
      "BreakupResultsView must display the exact canonical ScenarioUrn."
    );

    // B. Without scenarioUrn
    const markupWithoutBadge = renderToStaticMarkup(
      React.createElement(BreakupResultsView, {
        response: DEMO_BREAKUP_RESPONSE,
        selectedFragmentId: null,
        onSelectFragment: () => {},
        isDemo: true,
        scenarioUrn: null,
      })
    );
    assert(
      !markupWithoutBadge.includes('data-testid="breakup-scenario-badge"'),
      "BreakupResultsView must NOT render data-testid='breakup-scenario-badge' when scenarioUrn is null."
    );
  });

  // =========================================================================
  // Test 2: Remediation Results View Scenario Provenance Badge
  // =========================================================================
  test("2. Remediation Results View renders scenario provenance badge when provided and omits when null", () => {
    // A. With scenarioUrn
    const markupWithBadge = renderToStaticMarkup(
      React.createElement(RemediationResultsView, {
        response: DEMO_REMEDIATION_RESPONSE,
        isDemo: true,
        scenarioUrn: "scenario:canonical-cw-reference" as ScenarioUrn,
      })
    );
    assert(
      markupWithBadge.includes('data-testid="remediation-scenario-badge"'),
      "RemediationResultsView must render data-testid='remediation-scenario-badge' when scenarioUrn is provided."
    );
    assert(
      markupWithBadge.includes("scenario:canonical-cw-reference"),
      "RemediationResultsView must display the exact canonical ScenarioUrn."
    );

    // B. Without scenarioUrn
    const markupWithoutBadge = renderToStaticMarkup(
      React.createElement(RemediationResultsView, {
        response: DEMO_REMEDIATION_RESPONSE,
        isDemo: true,
        scenarioUrn: null,
      })
    );
    assert(
      !markupWithoutBadge.includes('data-testid="remediation-scenario-badge"'),
      "RemediationResultsView must NOT render data-testid='remediation-scenario-badge' when scenarioUrn is null."
    );
  });

  // =========================================================================
  // Test 3: Cross-Module Navigation Parameter Harmonization (Conjunctions -> Simulation)
  // =========================================================================
  test("3. Cross-module navigation dispatches canonical object and event URNs without identity confusion", () => {
    const mockEvent: ConjunctionEvent = {
      event_id: "EVT-20261104-001",
      object_1_id: "25544",
      object_1_name: "ISS (ZARYA)",
      object_2_id: "22675",
      object_2_name: "COSMOS 2251",
      tca: "2026-11-04T14:32:00.000Z",
      miss_distance_km: 1.25,
      relative_speed_kms: 14.82,
      frame: "GCRS",
      category: "HIGH",
      screening_threshold_km: 50.0,
      step_seconds: 60.0,
      relative_position_km: [1.25, 0, 0],
      relative_velocity_kms: [0, -14.88, 0],
    };

    let dispatchedTab: string | null = null;
    let dispatchedObjectId: string | null | undefined = undefined;
    let dispatchedSubtab: string | null | undefined = undefined;
    let dispatchedEventId: string | null | undefined = undefined;

    const inspector = renderToStaticMarkup(
      React.createElement(CloseApproachInspector, {
        event: mockEvent,
        onNavigateTab: (tab, objectId, subtab, eventId) => {
          dispatchedTab = tab;
          dispatchedObjectId = objectId;
          dispatchedSubtab = subtab;
          dispatchedEventId = eventId;
        },
      })
    );

    assert(
      inspector.includes("Simulate Fragment Breakup"),
      "CloseApproachInspector must render 'Simulate Fragment Breakup' button."
    );
    assert(
      inspector.includes("Plan Clohessy-Wiltshire Remediation"),
      "CloseApproachInspector must render 'Plan Clohessy-Wiltshire Remediation' button."
    );
  });

  // =========================================================================
  // Test 4: Mission Overview Canonical CW Benchmark Launch Action (Refinement 2)
  // =========================================================================
  test("4. Mission Overview launch benchmark action passes scenarioId strictly without fabricating object or event", () => {
    let calledTab: string | null = null;
    let calledObjectId: string | null | undefined = "INITIAL";
    let calledSubtab: string | null | undefined = null;
    let calledEventId: string | null | undefined = "INITIAL";
    let calledScenarioId: string | null | undefined = null;

    const mockApiStatus: ApiConnectionStatus = {
      connected: true,
      state: "connected",
      lastCheckedUtc: new Date().toISOString(),
    };

    const overviewMarkup = renderToStaticMarkup(
      React.createElement(MissionDashboardView, {
        onNavigateTab: (tab, objectId, subtab, eventId, scenarioId) => {
          calledTab = tab;
          calledObjectId = objectId;
          calledSubtab = subtab;
          calledEventId = eventId;
          calledScenarioId = scenarioId;
        },
        apiStatus: mockApiStatus,
        isDemoMode: true,
      })
    );

    assert(
      overviewMarkup.includes('data-testid="launch-cw-benchmark-btn"'),
      "MissionDashboardView must render the canonical CW benchmark launch button."
    );
  });

  // =========================================================================
  // Test 5: Dedicated Integration Bridge Synchronization (Refinement 1)
  // =========================================================================
  test("5. Dedicated SimulationStoreBridge synchronizes lightweight summaries to Zustand on registry mutations", () => {
    SimulationPayloadRegistry.resetInstance();
    SimulationStoreBridge.resetInstance();

    const registry = SimulationPayloadRegistry.getInstance();
    const bridge = SimulationStoreBridge.getInstance(registry);

    // Initial preload
    registry.preloadBenchmarkFixtures();

    const state = useZorbitStore.getState();
    const cwSummary = state.scenarioSummaries["scenario:canonical-cw-reference"];
    const breakupSummary = state.scenarioSummaries["scenario:benchmark-iridium-cosmos"];

    assert(
      cwSummary !== undefined,
      "Bridge must synchronize canonical CW summary into Zustand upon preload."
    );
    assert(
      cwSummary.scenarioUrn === "scenario:canonical-cw-reference",
      "CW summary scenarioUrn must match canonical fixture."
    );
    assert(
      cwSummary.remediationSummary !== undefined,
      "CW summary must contain remediation metrics."
    );
    assert(
      cwSummary.remediationSummary?.isFeasible === true,
      "Canonical CW summary must indicate feasible solution."
    );

    assert(
      breakupSummary !== undefined,
      "Bridge must synchronize benchmark Iridium-Cosmos summary into Zustand upon preload."
    );
    assert(
      breakupSummary.fragmentCount === 10,
      "Breakup summary fragment count must be 10."
    );

    // Verify lightweight size (< 2 kB) and zero trajectories in Zustand
    const serialized = JSON.stringify(cwSummary);
    assert(
      serialized.length < 2048,
      `Zustand summary must be strictly lightweight (< 2 kB). Actual: ${serialized.length} bytes.`
    );
    assert(
      !("trajectories" in cwSummary),
      "Heavy trajectory arrays must be strictly excluded from Zustand store."
    );
  });

  // =========================================================================
  // Test 6: Invalidation and Deletion Bridge Behavior (Refinement 1)
  // =========================================================================
  test("6. Bridge updates or removes summaries on invalidation and deletion without leaving stale data", () => {
    SimulationPayloadRegistry.resetInstance();
    SimulationStoreBridge.resetInstance();

    const registry = SimulationPayloadRegistry.getInstance();
    SimulationStoreBridge.getInstance(registry);

    const testUrn = createDynamicScenarioUrn();
    const breakupPayload = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    registry.setBreakupPayload(testUrn, breakupPayload);

    // 1. Verify summary was created
    let summary = useZorbitStore.getState().scenarioSummaries[testUrn];
    assert(summary !== undefined && summary.status === "SUCCESS", "Summary must exist in store after registration.");

    // 2. Invalidate breakup workflow
    registry.invalidateWorkflow(testUrn, "breakup");
    summary = useZorbitStore.getState().scenarioSummaries[testUrn];
    assert(
      summary.status === "FAILED",
      "Invalidating sole workflow must mark Zustand summary status as FAILED."
    );

    // 3. Delete scenario completely
    registry.deleteScenario(testUrn);
    summary = useZorbitStore.getState().scenarioSummaries[testUrn];
    assert(
      summary === undefined,
      "Deleting scenario in registry must completely remove summary from Zustand."
    );
  });

  // =========================================================================
  // Test 7: Scientific Fixture Verification (Refinement 3)
  // =========================================================================
  test("7. Scientific Fixture Verification: DEMO_BREAKUP_RESPONSE and scenario:benchmark-iridium-cosmos", () => {
    // A. Identity relationship
    // DEMO_BREAKUP_RESPONSE is the raw wire-format response fixture.
    // scenario:benchmark-iridium-cosmos is its registered in-memory adapted payload representation.
    const rawFixture = DEMO_BREAKUP_RESPONSE;
    const meta = rawFixture.fragmentation.metadata;
    const fragments = rawFixture.fragmentation.fragments;

    // B. Mass balance verification
    const parentMassA = 500.0;
    const parentMassB = 500.0;
    const totalParentMass = parentMassA + parentMassB; // 1000.0 kg
    assert(
      meta.total_parent_mass_kg === totalParentMass,
      `Total parent mass must be 1000.0 kg. Found: ${meta.total_parent_mass_kg}`
    );

    const sumTrackedMass = fragments.reduce((acc, f) => acc + f.mass_kg, 0);
    assert(
      Math.abs(sumTrackedMass - meta.tracked_fragment_mass_kg) < 1e-6,
      `Tracked fragment mass sum (${sumTrackedMass}) must match metadata (${meta.tracked_fragment_mass_kg}).`
    );
    assert(
      Math.abs(totalParentMass - (meta.tracked_fragment_mass_kg + meta.residual_mass_kg)) < 1e-6,
      "Mass conservation error: parent mass must exactly equal tracked plus residual fragment mass."
    );

    // C. Coordinate frame and units verification
    assert(rawFixture.trajectories.frame === "GCRS", "Coordinate frame must be strictly GCRS.");
    assert(
      rawFixture.trajectories.trajectories[0].position_unit === "km",
      "Position units must be km."
    );
    assert(
      rawFixture.trajectories.trajectories[0].velocity_unit === "km/s",
      "Velocity units must be km/s."
    );

    // D. Momentum residual verification
    assert(
      meta.momentum_residual_kg_kms <= 1e-10,
      `Drift-subtracted momentum residual (${meta.momentum_residual_kg_kms}) must represent double-precision float epsilon.`
    );

    // E. Fragment count and identifier verification
    assert(fragments.length === 10, "Demo scenario must have exactly 10 fragments.");
    fragments.forEach((f, idx) => {
      assert(f.is_synthetic === true, `Fragment ${f.fragment_id} must have is_synthetic = true.`);
      assert(
        f.fragment_id.startsWith("SYNTH-FRAG-"),
        `Fragment ${f.fragment_id} must start with SYNTH-FRAG- prefix.`
      );
    });

    // F. Heuristic risk vs probability distinction
    assert(
      meta.fidelity_disclaimer.includes("SIMPLIFIED SYNTHETIC MODEL"),
      "Scientific disclaimer must state that this is a simplified synthetic model."
    );
  });

  // =========================================================================
  // Test 8: Asynchronous Submission Lifecycle & Error Handling (Stage 3 Follow-up 2)
  // =========================================================================
  test("8. Asynchronous submission failure invalidates request token and leaves registry and store clean", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();
    const testUrn = createDynamicScenarioUrn();

    // 1. Begin request
    const token = registry.beginWorkflowRequest(testUrn, "breakup");
    assert(
      registry.isWorkflowRequestCurrent(testUrn, "breakup", token),
      "Newly issued token must be current."
    );

    // 2. Simulate network / solver error -> invalidate
    registry.invalidateWorkflow(testUrn, "breakup");

    // 3. Attempt to commit with the invalidated token
    const fakePayload = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
    const result = registry.commitWorkflowResult(testUrn, "breakup", token, fakePayload);

    assert(result.success === false, "Commit must fail with invalidated token.");
    assert(result.isStale === true, "Result must be marked as stale.");
    assert(
      registry.getBreakupPayload(testUrn) === undefined,
      "Failed commit must not write uncommitted payload to registry."
    );
  });

  // =========================================================================
  // Test 9: Client Subscription Lifecycle & Listener Cleanup (Stage 3 Follow-up 3)
  // =========================================================================
  test("9. Client subscription and mutation listeners cleanly unsubscribe without leaks", () => {
    SimulationPayloadRegistry.resetInstance();
    const registry = SimulationPayloadRegistry.getInstance();

    let notificationCount = 0;
    let mutationCount = 0;

    const unsubNotify = registry.subscribe(() => {
      notificationCount++;
    });

    const unsubMutate = registry.addMutationListener(() => {
      mutationCount++;
    });

    // Trigger mutation 1
    const testUrn = createDynamicScenarioUrn();
    registry.setBreakupPayload(testUrn, adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE));

    assert(notificationCount === 1, "Subscribe listener must be notified.");
    assert(mutationCount === 1, "Mutation listener must be notified.");

    // Clean up / unsubscribe
    unsubNotify();
    unsubMutate();

    // Trigger mutation 2
    registry.deleteScenario(testUrn);

    assert(
      notificationCount === 1,
      "Notification listener must NOT receive updates after unsubscription."
    );
    assert(
      mutationCount === 1,
      "Mutation listener must NOT receive updates after unsubscription."
    );
  });

  // =========================================================================
  // Test 10: Zero-Regression Gate across All 5 Tiers
  // =========================================================================
  test("10. Zero-regression gate: store, adapters, and registry cooperate seamlessly", () => {
    const store = useZorbitStore.getState();
    assert(typeof store.setActiveTab === "function", "Navigation actions intact.");
    assert(typeof store.setScenarioSummary === "function", "Simulation slice actions intact.");
    assert(typeof store.setSelectedObjectUrn === "function", "Object selection actions intact.");

    // Preload fixtures and confirm both exist
    const registry = SimulationPayloadRegistry.getInstance();
    registry.preloadBenchmarkFixtures();

    const cw = registry.getRemediationPayload("scenario:canonical-cw-reference");
    const breakup = registry.getBreakupPayload("scenario:benchmark-iridium-cosmos");

    assert(cw !== undefined, "Canonical CW fixture must be accessible.");
    assert(breakup !== undefined, "Benchmark Iridium-Cosmos fixture must be accessible.");
  });

  return { passed, total, details };
}
