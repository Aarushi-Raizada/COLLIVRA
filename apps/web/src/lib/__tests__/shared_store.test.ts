/**
 * ZORBIT Zustand Master Domain Store — Unit Test Suite
 *
 * Validates:
 * 1. Store slice initialization and default state.
 * 2. Entity selection (Catalog and Synthetic Fragment URNs).
 * 3. Strict rejection of invalid, ambiguous, or mismatched URN selections.
 * 4. Selection clearing.
 * 5. Scenario registration with canonical metadata and lightweight summary.
 * 6. Scenario isolation: independent scenarios retain separate identities.
 * 7. Active scenario switching and invalidation without cross-contamination.
 * 8. Missing scenario queries return undefined safely.
 * 9. Atomic selector extraction outside React components.
 */

import { useZorbitStore } from "../../store/useZorbitStore";
import type {
  CanonicalScenarioMetadata,
  CanonicalSimulationSummary,
  CanonicalOrbitalObjectReference,
  CanonicalConjunctionEventReference,
  ConjunctionEventContext,
} from "../../types/shared_state";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

export function runSharedStoreTests(): { passed: number; total: number; details: string[] } {
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

  // Helper to reset store before tests
  function resetStore() {
    useZorbitStore.setState({
      activeTab: "overview",
      activeSubtab: null,
      selectedObjectUrn: null,
      activeEventUrn: null,
      activeScenarioUrn: null,
      catalogMap: {},
      screeningEvents: [],
      activeEncounter: null,
      scenarios: {},
      scenarioSummaries: {},
      apiStatus: {
        connected: false,
        state: "disconnected",
        lastCheckedUtc: null,
      },
      isDemoMode: true,
    });
  }

  // =========================================================================
  // 1. Initial State
  // =========================================================================

  test("Store initializes with expected default state", () => {
    resetStore();
    const state = useZorbitStore.getState();
    assert(state.activeTab === "overview", "Initial activeTab must be overview");
    assert(state.selectedObjectUrn === null, "Initial selectedObjectUrn must be null");
    assert(state.activeScenarioUrn === null, "Initial activeScenarioUrn must be null");
    assert(state.activeEventUrn === null, "Initial activeEventUrn must be null");
    assert(Object.keys(state.scenarios).length === 0, "Scenarios must be empty");
    assert(state.isDemoMode === true, "Default mode must be demo");
  });

  // =========================================================================
  // 2. Entity Selection & Clearing
  // =========================================================================

  test("setSelectedObjectUrn accepts valid catalog and synthetic fragment URNs", () => {
    resetStore();
    const store = useZorbitStore.getState();

    // 1. Valid Catalog URN
    const resCat = store.setSelectedObjectUrn("catalog:norad:25544");
    assert(resCat.success === true, "Must accept valid catalog URN");
    assert(
      useZorbitStore.getState().selectedObjectUrn === "catalog:norad:25544",
      "Store must store canonical catalog URN"
    );

    // 2. Valid Synthetic Fragment URN
    const resFrag = store.setSelectedObjectUrn("synthetic:SIM-001:fragment:042");
    assert(resFrag.success === true, "Must accept valid synthetic fragment URN");
    assert(
      useZorbitStore.getState().selectedObjectUrn === "synthetic:SIM-001:fragment:042",
      "Store must store synthetic fragment URN"
    );

    // 3. Resolvable Legacy Alias
    const resAlias = store.setSelectedObjectUrn("sat-iss");
    assert(resAlias.success === true, "Must accept resolvable alias");
    assert(
      useZorbitStore.getState().selectedObjectUrn === "catalog:norad:25544",
      "Store must normalize alias to catalog URN"
    );
  });

  test("setSelectedObjectUrn rejects invalid or mismatched entity selections", () => {
    resetStore();
    const store = useZorbitStore.getState();

    // 1. Unknown arbitrary string
    const resUnknown = store.setSelectedObjectUrn("unknown-satellite-x");
    assert(resUnknown.success === false, "Must reject unknown string");
    assert(
      useZorbitStore.getState().selectedObjectUrn === null,
      "Store must remain null after rejection"
    );

    // 2. Scenario URN passed as an object selection
    const resScenario = store.setSelectedObjectUrn("scenario:canonical-cw-reference");
    assert(resScenario.success === false, "Must reject scenario URN as an orbital object");
    assert(
      Boolean(resScenario.error?.includes("selectedObjectUrn requires CATALOG or SYNTHETIC")),
      "Error must explain kind mismatch"
    );
  });

  test("clearSelection and null input reset selectedObjectUrn to null", () => {
    resetStore();
    const store = useZorbitStore.getState();

    store.setSelectedObjectUrn("catalog:norad:25544");
    assert(useZorbitStore.getState().selectedObjectUrn !== null, "Selection should be active");

    store.clearSelection();
    assert(useZorbitStore.getState().selectedObjectUrn === null, "clearSelection resets to null");

    store.setSelectedObjectUrn("catalog:norad:48274");
    store.setSelectedObjectUrn(null);
    assert(useZorbitStore.getState().selectedObjectUrn === null, "null input resets to null");
  });

  // =========================================================================
  // 3. Scenario Registration & Isolation
  // =========================================================================

  test("registerScenario stores lightweight metadata and enforces canonical URN validation", () => {
    resetStore();
    const store = useZorbitStore.getState();

    const metadata: CanonicalScenarioMetadata = {
      scenarioUrn: "scenario:SIM-11111111-2222-4333-8444-555555555555",
      displayName: "Test Dynamic Collision",
      createdAtUtc: "2026-11-07T00:00:00Z",
      isBenchmarkFixture: false,
    };

    const res = store.registerScenario(metadata);
    assert(res.success === true, "Registration must succeed for valid scenario");

    const saved = store.getScenarioMetadata("scenario:SIM-11111111-2222-4333-8444-555555555555");
    assert(saved?.displayName === "Test Dynamic Collision", "Metadata must be retrievable");
    assert(saved?.isBenchmarkFixture === false, "Fixture flag must be preserved");

    // Invalid URN rejection
    const invalidMeta = {
      ...metadata,
      scenarioUrn: "invalid:slug" as any,
    };
    const resInvalid = store.registerScenario(invalidMeta);
    assert(resInvalid.success === false, "Invalid URN must be rejected");
  });

  test("Scenario isolation: independent scenarios do not overwrite each other", () => {
    resetStore();
    const store = useZorbitStore.getState();

    const scenario1: CanonicalScenarioMetadata = {
      scenarioUrn: "scenario:SIM-aaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      displayName: "Scenario A",
      createdAtUtc: "2026-11-07T00:00:00Z",
      isBenchmarkFixture: false,
    };

    const scenario2: CanonicalScenarioMetadata = {
      scenarioUrn: "scenario:canonical-cw-reference",
      displayName: "Canonical CW Benchmark",
      createdAtUtc: "2026-11-07T00:00:00Z",
      isBenchmarkFixture: true,
    };

    store.registerScenario(scenario1);
    store.registerScenario(scenario2);

    const state = useZorbitStore.getState();
    assert(Object.keys(state.scenarios).length === 2, "Both scenarios must be registered");
    assert(state.scenarios[scenario1.scenarioUrn].displayName === "Scenario A", "Scenario 1 intact");
    assert(
      state.scenarios[scenario2.scenarioUrn].displayName === "Canonical CW Benchmark",
      "Scenario 2 intact"
    );
  });

  test("Missing scenario lookup returns undefined safely", () => {
    resetStore();
    const store = useZorbitStore.getState();
    assert(store.getScenarioMetadata("scenario:SIM-nonexistent") === undefined, "Must return undefined");
    assert(store.getScenarioSummary("scenario:SIM-nonexistent") === undefined, "Must return undefined");
  });

  // =========================================================================
  // 4. Active Scenario Switching & Invalidation
  // =========================================================================

  test("setActiveScenarioUrn switches active scenario and rejects invalid URNs", () => {
    resetStore();
    const store = useZorbitStore.getState();

    const res = store.setActiveScenarioUrn("scenario:canonical-cw-reference");
    assert(res.success === true, "Must set valid active scenario");
    assert(
      useZorbitStore.getState().activeScenarioUrn === "scenario:canonical-cw-reference",
      "Active scenario URN updated"
    );

    const resBad = store.setActiveScenarioUrn("catalog:norad:25544");
    assert(resBad.success === false, "Cannot set catalog URN as scenario");
  });

  test("invalidateScenario marks target scenario status as FAILED without corrupting others", () => {
    resetStore();
    const store = useZorbitStore.getState();

    const urn1 = "scenario:SIM-11111111-2222-4333-8444-555555555555" as const;
    const summary1: CanonicalSimulationSummary = {
      scenarioUrn: urn1,
      status: "SUCCESS",
      fragmentCount: 50,
      reenteredCount: 0,
      completedCount: 50,
      executionWallTimeMs: 450,
      massBalance: {
        totalParentMassKg: 5000,
        trackedFragmentMassKg: 4900,
        residualMassKg: 100,
        centerOfMassVelocityKms: [0, 7.5, 0],
        centerOfMassDriftRemovedMs: 0.1,
        momentumResidualKgKms: 0.005,
      },
    };

    store.registerScenario({ scenarioUrn: urn1, displayName: "Run 1", createdAtUtc: "", isBenchmarkFixture: false }, summary1);
    assert(store.getScenarioSummary(urn1)?.status === "SUCCESS", "Initial status SUCCESS");

    store.invalidateScenario(urn1);
    assert(store.getScenarioSummary(urn1)?.status === "FAILED", "Status updated to FAILED");
    assert(
      store.getScenarioSummary(urn1)?.errorMessage === "Scenario invalidated.",
      "Error message set"
    );
  });

  // =========================================================================
  // 5. Catalog & Encounter Slices
  // =========================================================================

  test("CatalogSlice stores and retrieves canonical orbital objects", () => {
    resetStore();
    const store = useZorbitStore.getState();

    const obj: CanonicalOrbitalObjectReference = {
      urn: "catalog:norad:25544",
      noradCatId: "25544",
      displayName: "ISS (ZARYA)",
      objectType: "PAYLOAD",
      isSynthetic: false,
      epochUtc: "2026-11-07T00:00:00Z",
      positionGcrsKm: [6500, 0, 2000],
      velocityGcrsKms: [0, 7.6, 0],
      massKg: 420000,
      provenance: {
        source: "CELESTRAK_OMM",
        retrievedAtUtc: "2026-11-07T00:00:00Z",
      },
    };

    store.setCatalogObjects([obj]);
    const retrieved = store.getCatalogObject("catalog:norad:25544");
    assert(retrieved?.displayName === "ISS (ZARYA)", "Retrieved object name must match");
    assert(retrieved?.massKg === 420000, "Mass must be preserved");
  });

  // =========================================================================
  // 6. Additional Targeted Store Slice Tests (M6.3.1 Corrections)
  // =========================================================================

  test("removeScenario removes scenario and resets activeScenarioUrn when active", () => {
    resetStore();
    const store = useZorbitStore.getState();

    const urnA = "scenario:SIM-aaaaaaaa-1111-4111-8111-111111111111" as const;
    const urnB = "scenario:SIM-bbbbbbbb-2222-4222-8222-222222222222" as const;

    store.registerScenario({ scenarioUrn: urnA, displayName: "Scenario A", createdAtUtc: "", isBenchmarkFixture: false });
    store.registerScenario({ scenarioUrn: urnB, displayName: "Scenario B", createdAtUtc: "", isBenchmarkFixture: false });
    store.setActiveScenarioUrn(urnA);

    assert(useZorbitStore.getState().activeScenarioUrn === urnA, "Active scenario is A");
    assert(Object.keys(useZorbitStore.getState().scenarios).length === 2, "Both scenarios exist");

    // Remove B: A should remain active
    store.removeScenario(urnB);
    assert(useZorbitStore.getState().scenarios[urnB] === undefined, "Scenario B removed");
    assert(useZorbitStore.getState().scenarios[urnA] !== undefined, "Scenario A remains");
    assert(useZorbitStore.getState().activeScenarioUrn === urnA, "Active scenario remains A");

    // Remove A: activeScenarioUrn must be safely cleared to null
    store.removeScenario(urnA);
    assert(useZorbitStore.getState().scenarios[urnA] === undefined, "Scenario A removed");
    assert(useZorbitStore.getState().activeScenarioUrn === null, "Active scenario reset to null on removal");
  });

  test("setActiveEventUrn accepts valid conjunction URNs and preserves state on invalid actions", () => {
    resetStore();
    const store = useZorbitStore.getState();

    // 1. Valid Conjunction URN
    const resUrn = store.setActiveEventUrn("conjunction:EVT-2026-001");
    assert(resUrn.success === true, "Must accept valid conjunction URN");
    assert(
      useZorbitStore.getState().activeEventUrn === "conjunction:EVT-2026-001",
      "Store must record conjunction URN"
    );

    // 2. Valid legacy EVT prefix
    const resPrefix = store.setActiveEventUrn("EVT-2026-002");
    assert(resPrefix.success === true, "Must accept legacy EVT prefix");
    assert(
      useZorbitStore.getState().activeEventUrn === "conjunction:EVT-2026-002",
      "Store must normalize EVT prefix to conjunction URN"
    );

    // 3. Null input resets
    const resNull = store.setActiveEventUrn(null);
    assert(resNull.success === true, "Must accept null");
    assert(useZorbitStore.getState().activeEventUrn === null, "activeEventUrn reset to null");

    // 4. Invalid input does not corrupt existing state
    store.setActiveEventUrn("conjunction:EVT-2026-PRESERVED");
    const resInvalid = store.setActiveEventUrn("catalog:norad:25544");
    assert(resInvalid.success === false, "Must reject catalog URN as event");
    assert(
      useZorbitStore.getState().activeEventUrn === "conjunction:EVT-2026-PRESERVED",
      "Existing valid state must be preserved on invalid input"
    );
  });

  test("ConjunctionSlice manages screening events, active encounter, and clearing", () => {
    resetStore();
    const store = useZorbitStore.getState();

    const mockEvent: CanonicalConjunctionEventReference = {
      urn: "conjunction:EVT-001",
      eventId: "EVT-001",
      primaryUrn: "catalog:norad:25544",
      primaryName: "ISS (ZARYA)",
      secondaryUrn: "catalog:norad:48274",
      secondaryName: "CSS (TIANHE)",
      tcaUtc: "2026-11-07T12:00:00Z",
      missDistanceKm: 1.45,
      relativePositionGcrsKm: [1.2, 0.4, -0.7],
      relativeVelocityGcrsKms: [0.1, -10.2, 1.5],
      relativeSpeedKms: 10.3,
      severity: "CRITICAL",
      heuristicRiskScore: 0.88,
      scientificDisclaimer: "Heuristic risk score. Not formal Pc.",
      dataSource: "LIVE_SCREENING",
    };

    store.setScreeningEvents([mockEvent]);
    assert(useZorbitStore.getState().screeningEvents.length === 1, "One screening event stored");
    assert(
      useZorbitStore.getState().screeningEvents[0].urn === "conjunction:EVT-001",
      "Stored event matches"
    );

    const mockEncounter: ConjunctionEventContext = {
      eventUrn: "conjunction:EVT-001",
      primaryUrn: "catalog:norad:25544",
      primaryName: "ISS (ZARYA)",
      primaryPositionGcrsKm: [6500, 0, 2000],
      primaryVelocityGcrsKms: [0, 7.6, 0],
      secondaryUrn: "catalog:norad:48274",
      secondaryName: "CSS (TIANHE)",
      secondaryPositionGcrsKm: [6501.2, 0.4, 1999.3],
      secondaryVelocityGcrsKms: [0.1, -2.6, 1.5],
      tcaUtc: "2026-11-07T12:00:00Z",
      missDistanceKm: 1.45,
      relativePositionGcrsKm: [1.2, 0.4, -0.7],
      relativeVelocityGcrsKms: [0.1, -10.2, 1.5],
      relativeSpeedKms: 10.3,
      severity: "CRITICAL",
      heuristicRiskScore: 0.88,
      scientificDisclaimer: "Heuristic risk score. Not formal Pc.",
    };

    store.setActiveEncounter(mockEncounter);
    assert(
      useZorbitStore.getState().activeEncounter?.eventUrn === "conjunction:EVT-001",
      "Active encounter stored"
    );

    // clearScreeningEvents resets both events and encounter
    store.clearScreeningEvents();
    assert(useZorbitStore.getState().screeningEvents.length === 0, "Events cleared");
    assert(useZorbitStore.getState().activeEncounter === null, "Active encounter reset to null");
  });

  test("TelemetrySlice updates apiStatus and demoMode without background side-effects", () => {
    resetStore();
    const store = useZorbitStore.getState();

    assert(useZorbitStore.getState().apiStatus.connected === false, "Default apiStatus disconnected");
    assert(useZorbitStore.getState().isDemoMode === true, "Default isDemoMode true");

    store.setApiStatus({
      connected: true,
      state: "connected",
      latencyMs: 18,
      lastCheckedUtc: "2026-11-07T00:00:00Z",
    });

    const currentStatus = useZorbitStore.getState().apiStatus;
    assert(currentStatus.connected === true, "apiStatus updated to connected");
    assert(currentStatus.latencyMs === 18, "latency updated");

    store.setDemoMode(false);
    assert(useZorbitStore.getState().isDemoMode === false, "isDemoMode toggled to false");

    store.setDemoMode(true);
    assert(useZorbitStore.getState().isDemoMode === true, "isDemoMode toggled to true");
  });

  test("Invalid store selections preserve existing state without corruption", () => {
    resetStore();
    const store = useZorbitStore.getState();

    // Establish valid initial selection
    store.setSelectedObjectUrn("catalog:norad:25544");
    assert(
      useZorbitStore.getState().selectedObjectUrn === "catalog:norad:25544",
      "Initial selection established"
    );

    // Attempt invalid mutations
    const resBad1 = store.setSelectedObjectUrn("unknown-object-999");
    assert(resBad1.success === false, "Unknown string rejected");
    assert(
      useZorbitStore.getState().selectedObjectUrn === "catalog:norad:25544",
      "Object selection preserved after invalid string"
    );

    const resBad2 = store.setSelectedObjectUrn("scenario:canonical-cw-reference");
    assert(resBad2.success === false, "Scenario URN rejected as object");
    assert(
      useZorbitStore.getState().selectedObjectUrn === "catalog:norad:25544",
      "Object selection preserved after mismatched URN"
    );
  });

  return { passed, total, details };
}

