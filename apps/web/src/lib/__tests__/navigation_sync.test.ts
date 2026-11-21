/**
 * ZORBIT URL Synchronization & Browser History — Unit & Integration Test Suite
 *
 * Implements and verifies Milestone 6.3.2 acceptance criteria:
 * 1. Initial URL hydration.
 * 2. Valid tab selection.
 * 3. Valid canonical object selection.
 * 4. Valid conjunction event selection.
 * 5. Valid scenario identifier parsing.
 * 6. Invalid and malformed identifiers.
 * 7. Optional parameter handling.
 * 8. URL serialization.
 * 9. `pushState` navigation.
 * 10. `replaceState` normalization.
 * 11. Browser back navigation.
 * 12. Browser forward navigation.
 * 13. Repeated URL updates without duplicate history entries (Loop Breaker).
 * 14. URL/store loop prevention.
 * 15. Invalid URL parameters not corrupting valid independent state.
 */

import {
  parseUrlNavigationalState,
  buildNavigationalQueryString,
  buildNavigationalUrl,
  navigateToUrl,
  syncFromBrowserUrl,
  VALID_TABS,
  VALID_SUBTABS,
  isValidTab,
  isValidSubtab,
} from "../navigation";
import { useZorbitStore } from "../../store/useZorbitStore";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// ============================================================================
// Virtual Browser Window & History Mock
// ============================================================================

interface MockHistoryEntry {
  state: any;
  title: string;
  url: string;
}

class VirtualWindow {
  location: {
    pathname: string;
    search: string;
  };
  history: {
    entries: MockHistoryEntry[];
    currentIndex: number;
    pushCallCount: number;
    replaceCallCount: number;
    pushState(state: any, title: string, url: string): void;
    replaceState(state: any, title: string, url: string): void;
    back(): void;
    forward(): void;
  };
  private listeners: Record<string, ((event: any) => void)[]> = {};

  constructor(initialPath = "/", initialSearch = "") {
    this.location = {
      pathname: initialPath,
      search: initialSearch,
    };

    const self = this;
    this.history = {
      entries: [{ state: null, title: "", url: initialSearch ? `${initialPath}${initialSearch}` : initialPath }],
      currentIndex: 0,
      pushCallCount: 0,
      replaceCallCount: 0,

      pushState(state: any, title: string, url: string) {
        this.pushCallCount++;
        // Truncate any forward history when pushing new state
        this.entries = this.entries.slice(0, this.currentIndex + 1);
        this.entries.push({ state, title, url });
        this.currentIndex++;
        self.updateLocationFromUrl(url);
      },

      replaceState(state: any, title: string, url: string) {
        this.replaceCallCount++;
        this.entries[this.currentIndex] = { state, title, url };
        self.updateLocationFromUrl(url);
      },

      back() {
        if (this.currentIndex > 0) {
          this.currentIndex--;
          const entry = this.entries[this.currentIndex];
          self.updateLocationFromUrl(entry.url);
          self.dispatchPopState(entry.state);
        }
      },

      forward() {
        if (this.currentIndex < this.entries.length - 1) {
          this.currentIndex++;
          const entry = this.entries[this.currentIndex];
          self.updateLocationFromUrl(entry.url);
          self.dispatchPopState(entry.state);
        }
      },
    };
  }

  private updateLocationFromUrl(fullUrl: string) {
    const qIndex = fullUrl.indexOf("?");
    if (qIndex >= 0) {
      this.location.pathname = fullUrl.slice(0, qIndex);
      this.location.search = fullUrl.slice(qIndex);
    } else {
      this.location.pathname = fullUrl;
      this.location.search = "";
    }
  }

  addEventListener(type: string, handler: (event: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  removeEventListener(type: string, handler: (event: any) => void) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((h) => h !== handler);
  }

  dispatchPopState(state: any) {
    if (this.listeners["popstate"]) {
      const event = { state, type: "popstate" };
      this.listeners["popstate"].forEach((h) => h(event));
    }
  }
}

// Reset store before tests
function resetStore() {
  useZorbitStore.setState({
    activeTab: "overview",
    activeSubtab: null,
    selectedObjectUrn: null,
    activeEventUrn: null,
    activeScenarioUrn: null,
    isHydrated: false,
    hydrationError: null,
  });
}

// ============================================================================
// Test Suite Runner
// ============================================================================

export function runNavigationSyncTests(): { passed: number; total: number; details: string[] } {
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

  // =========================================================================
  // 1. Initial URL Hydration & Valid Selections
  // =========================================================================

  test("1. Initial URL hydration parses search params and updates Zustand store", () => {
    resetStore();
    const mockWin = new VirtualWindow("/", "?tab=radar&objectId=catalog:norad:25544");
    const parsed = syncFromBrowserUrl({ normalize: false, targetWindow: mockWin as any });

    assert(parsed.state.tab === "radar", "Tab must hydrate as radar");
    assert(parsed.state.objectId === "catalog:norad:25544", "ObjectId must hydrate as ISS URN");

    const store = useZorbitStore.getState();
    assert(store.isHydrated === true, "Store isHydrated must be true after initial sync");
    assert(store.activeTab === "radar", "Store activeTab must mirror URL");
    assert(store.selectedObjectUrn === "catalog:norad:25544", "Store selectedObjectUrn must mirror URL");
  });

  test("2. Valid tab selection validates all five core application tabs", () => {
    assert(isValidTab("overview"), "overview is valid");
    assert(isValidTab("radar"), "radar is valid");
    assert(isValidTab("conjunctions"), "conjunctions is valid");
    assert(isValidTab("simulation"), "simulation is valid");
    assert(isValidTab("system"), "system is valid");
    assert(!isValidTab("unknown_tab"), "unknown_tab is invalid");

    for (const tab of VALID_TABS) {
      const parsed = parseUrlNavigationalState(`?tab=${tab}`);
      assert(parsed.state.tab === tab, `Must parse valid tab '${tab}'`);
    }
  });

  test("3. Valid canonical object selection handles catalog URNs, fragments, and aliases", () => {
    // Exact catalog URN
    const p1 = parseUrlNavigationalState("?tab=radar&objectId=catalog:norad:25544");
    assert(p1.state.objectId === "catalog:norad:25544", "Exact catalog URN parsed");
    assert(p1.isNormalized === true, "Already canonical URN is normalized");

    // Synthetic fragment URN
    const p2 = parseUrlNavigationalState("?tab=radar&objectId=synthetic:SIM-001:fragment:042");
    assert(p2.state.objectId === "synthetic:SIM-001:fragment:042", "Synthetic fragment URN parsed");

    // Resolvable numeric NORAD ID (resolves to catalog URN)
    const p3 = parseUrlNavigationalState("?tab=radar&objectId=48274");
    assert(p3.state.objectId === "catalog:norad:48274", "Numeric string resolves to catalog URN");
    assert(p3.isNormalized === false, "Bare numeric string requires normalization");

    // Resolvable legacy alias (iss -> catalog:norad:25544)
    const p4 = parseUrlNavigationalState("?tab=radar&objectId=sat-iss");
    assert(p4.state.objectId === "catalog:norad:25544", "sat-iss resolves to catalog URN");
    assert(p4.isNormalized === false, "Legacy alias requires normalization");
  });

  test("4. Valid conjunction event selection parses canonical encounter URNs", () => {
    // Canonical event URN
    const p1 = parseUrlNavigationalState("?tab=conjunctions&eventId=conjunction:EVT-2026-001");
    assert(p1.state.eventId === "conjunction:EVT-2026-001", "Canonical event URN parsed");

    // Legacy EVT prefix
    const p2 = parseUrlNavigationalState("?tab=conjunctions&eventId=EVT-2026-001");
    assert(p2.state.eventId === "conjunction:EVT-2026-001", "Legacy EVT prefix resolved");
    assert(p2.isNormalized === false, "Legacy EVT prefix requires normalization");
  });

  test("5. Valid scenario identifier parsing parses canonical scenario URNs and aliases", () => {
    // Canonical scenario URN
    const p1 = parseUrlNavigationalState("?tab=simulation&scenarioId=scenario:canonical-cw-reference");
    assert(p1.state.scenarioId === "scenario:canonical-cw-reference", "Canonical scenario URN parsed");

    // Legacy scenario alias
    const p2 = parseUrlNavigationalState("?tab=simulation&scenarioId=canonical-cw");
    assert(p2.state.scenarioId === "scenario:canonical-cw-reference", "Legacy alias resolved");
    assert(p2.isNormalized === false, "Legacy alias requires normalization");
  });

  // =========================================================================
  // 2. Malformed Identifiers & Safe Fallbacks
  // =========================================================================

  test("6. Invalid and malformed identifiers are safely rejected without silent guessing", () => {
    // Malformed objectId
    const pBadObj = parseUrlNavigationalState("?tab=radar&objectId=invalid-satellite-xyz");
    assert(pBadObj.state.objectId === null, "Invalid objectId must be null (no silent default)");
    assert(pBadObj.invalidParams.some((p) => p.param === "objectId"), "Invalid param recorded");

    // Malformed eventId
    const pBadEvt = parseUrlNavigationalState("?tab=conjunctions&eventId=invalid-event-123");
    assert(pBadEvt.state.eventId === null, "Invalid eventId must be null");

    // Malformed scenarioId
    const pBadSim = parseUrlNavigationalState("?tab=simulation&scenarioId=unknown-scenario");
    assert(pBadSim.state.scenarioId === null, "Invalid scenarioId must be null");

    // Malformed tab name defaults to overview
    const pBadTab = parseUrlNavigationalState("?tab=unknown_view");
    assert(pBadTab.state.tab === "overview", "Invalid tab defaults to overview");
    assert(pBadTab.invalidParams.some((p) => p.param === "tab"), "Invalid tab recorded");
  });

  test("7. Optional parameter handling handles missing parameters cleanly", () => {
    // Empty search string
    const pEmpty = parseUrlNavigationalState("");
    assert(pEmpty.state.tab === "overview", "Empty query defaults to overview");
    assert(pEmpty.state.objectId === null, "objectId is null");
    assert(pEmpty.state.subtab === null, "subtab is null");
    assert(pEmpty.state.eventId === null, "eventId is null");
    assert(pEmpty.state.scenarioId === null, "scenarioId is null");

    // Query with only tab
    const pTabOnly = parseUrlNavigationalState("?tab=system");
    assert(pTabOnly.state.tab === "system", "Tab parsed as system");
    assert(pTabOnly.state.objectId === null, "objectId is null");
  });

  test("8. URL serialization formats query strings and full URLs in canonical order", () => {
    const qs = buildNavigationalQueryString({
      tab: "radar",
      objectId: "catalog:norad:25544",
    });
    assert(qs.includes("tab=radar"), "Contains tab=radar");
    assert(qs.includes("objectId=catalog%3Anorad%3A25544"), "Contains canonical objectId URN");

    const fullUrl = buildNavigationalUrl("/", {
      tab: "simulation",
      subtab: "breakup",
      scenarioId: "scenario:canonical-cw-reference",
    });
    assert(
      fullUrl.startsWith("/?tab=simulation&subtab=breakup&scenarioId="),
      "Full URL formatted correctly"
    );
  });

  // =========================================================================
  // 3. Browser History & Synchronization Integration
  // =========================================================================

  test("9. pushState navigation pushes a new history entry and updates Zustand store", () => {
    resetStore();
    const mockWin = new VirtualWindow("/", "?tab=overview");

    const res = navigateToUrl(
      { tab: "radar", objectId: "catalog:norad:25544" },
      { targetWindow: mockWin as any }
    );

    assert(res.success === true, "Navigation must succeed");
    assert(res.hasChanged === true, "History state changed");
    assert(mockWin.history.entries.length === 2, "New history entry pushed");
    assert(mockWin.location.search.includes("tab=radar"), "Window search updated");

    const store = useZorbitStore.getState();
    assert(store.activeTab === "radar", "Store activeTab updated");
    assert(store.selectedObjectUrn === "catalog:norad:25544", "Store selectedObjectUrn updated");
  });

  test("10. replaceState normalization normalizes legacy aliases in place", () => {
    resetStore();
    // Start window with legacy unnormalized alias
    const mockWin = new VirtualWindow("/", "?tab=radar&objectId=sat-iss");
    assert(mockWin.history.entries.length === 1, "Initial entry count 1");

    // Hydrate with normalization enabled
    const parsed = syncFromBrowserUrl({ normalize: true, targetWindow: mockWin as any });

    assert(parsed.isNormalized === false, "Initial URL was unnormalized");
    assert(mockWin.history.replaceCallCount === 1, "replaceState invoked for normalization");
    assert(mockWin.history.entries.length === 1, "No new history entry created");
    assert(
      mockWin.location.search.includes("objectId=catalog%3Anorad%3A25544"),
      "URL bar normalized to canonical URN in place"
    );
  });

  test("11. Browser back navigation restores previous state on popstate", () => {
    resetStore();
    const mockWin = new VirtualWindow("/", "?tab=overview");

    // Setup two-step navigation: overview -> radar
    navigateToUrl({ tab: "radar", objectId: "catalog:norad:25544" }, { targetWindow: mockWin as any });
    assert(mockWin.history.currentIndex === 1, "Current index 1");

    // Register popstate listener on mock window
    mockWin.addEventListener("popstate", () => {
      syncFromBrowserUrl({ normalize: false, targetWindow: mockWin as any });
    });

    // Simulate clicking browser back button
    mockWin.history.back();
    assert(mockWin.history.currentIndex === 0, "Index returned to 0");

    const store = useZorbitStore.getState();
    assert(store.activeTab === "overview", "Back navigation restored activeTab to overview");
    assert(store.selectedObjectUrn === null, "Back navigation cleared selectedObjectUrn");
  });

  test("12. Browser forward navigation restores forward state on popstate", () => {
    resetStore();
    const mockWin = new VirtualWindow("/", "?tab=overview");

    navigateToUrl({ tab: "radar", objectId: "catalog:norad:25544" }, { targetWindow: mockWin as any });

    mockWin.addEventListener("popstate", () => {
      syncFromBrowserUrl({ normalize: false, targetWindow: mockWin as any });
    });

    // Back to overview
    mockWin.history.back();
    assert(useZorbitStore.getState().activeTab === "overview", "At overview");

    // Forward to radar
    mockWin.history.forward();
    assert(mockWin.history.currentIndex === 1, "Index advanced to 1");

    const store = useZorbitStore.getState();
    assert(store.activeTab === "radar", "Forward navigation restored activeTab to radar");
    assert(store.selectedObjectUrn === "catalog:norad:25544", "Forward navigation restored selectedObjectUrn");
  });

  test("13. Repeated URL updates without duplicate history entries (Loop Breaker)", () => {
    resetStore();
    const mockWin = new VirtualWindow("/", "?tab=radar&objectId=catalog%3Anorad%3A25544");
    const initialPushCount = mockWin.history.pushCallCount;

    // Navigate to the exact same destination
    const res = navigateToUrl(
      { tab: "radar", objectId: "catalog:norad:25544" },
      { targetWindow: mockWin as any }
    );

    assert(res.hasChanged === false, "Navigation recognized as no-op");
    assert(
      mockWin.history.pushCallCount === initialPushCount,
      "pushState must NOT be called for identical target"
    );
    assert(mockWin.history.entries.length === 1, "History length remains unchanged");
  });

  test("14. URL/store loop prevention skips redundant store updates", () => {
    resetStore();
    useZorbitStore.setState({
      activeTab: "system",
      selectedObjectUrn: null,
      activeSubtab: null,
      activeEventUrn: null,
      activeScenarioUrn: null,
      isHydrated: true,
    });

    const mockWin = new VirtualWindow("/", "?tab=system");

    // Track state mutations
    let mutationCount = 0;
    const unsub = useZorbitStore.subscribe(() => {
      mutationCount++;
    });

    syncFromBrowserUrl({ normalize: false, targetWindow: mockWin as any });
    unsub();

    assert(mutationCount === 0, "No redundant store mutations when URL matches existing store state");
  });

  test("15. Invalid URL parameters do not corrupt valid independent state", () => {
    resetStore();
    // URL with a valid tab ('conjunctions') and an invalid objectId ('corrupted-id')
    const parsed = parseUrlNavigationalState("?tab=conjunctions&objectId=corrupted-id");

    assert(parsed.state.tab === "conjunctions", "Valid tab 'conjunctions' is safely preserved");
    assert(parsed.state.objectId === null, "Invalid objectId is safely nullified");
    assert(parsed.invalidParams.length === 1, "Exactly one invalid parameter recorded");
    assert(parsed.invalidParams[0].param === "objectId", "Identified invalid parameter as objectId");
  });

  // =========================================================================
  // 6. Navigation Hydration Gate & Deep-Link Lifecycle Tests (M6.3.3)
  // =========================================================================

  test("16. Navigation hydration gate initial state is false and blocks module rendering", () => {
    resetStore();
    const store = useZorbitStore.getState();

    // Prior to browser URL synchronization, isHydrated must be false
    assert(store.isHydrated === false, "Initial isHydrated state must strictly be false");
    assert(store.hydrationError === null, "Initial hydration error must be null");

    // Lifecycle simulation: Verify that a rendering gate protects navigation-dependent modules
    const simulateAppRender = (isHydrated: boolean, activeTab: string) => {
      if (!isHydrated) {
        return "SKELETON_SHELL";
      }
      return `MODULE_${activeTab.toUpperCase()}`;
    };

    const initialRender = simulateAppRender(store.isHydrated, store.activeTab);
    assert(initialRender === "SKELETON_SHELL", "Initial render prior to hydration must be the neutral skeleton shell");
  });

  test("17. Deep-link Case 1 (Radar + ISS): hydrates directly to radar without rendering overview", () => {
    resetStore();
    const mockWin = new VirtualWindow("/", "?tab=radar&objectId=catalog:norad:25544");

    // Before hydration: store.isHydrated is false
    assert(useZorbitStore.getState().isHydrated === false, "Store is unhydrated before sync");

    // Hydrate from browser URL
    const parsed = syncFromBrowserUrl({ normalize: true, targetWindow: mockWin as any });
    const store = useZorbitStore.getState();

    // After hydration: isHydrated is true, activeTab is radar, selectedObjectUrn is catalog:norad:25544
    assert(store.isHydrated === true, "Store must be hydrated");
    assert(store.activeTab === "radar", "Active tab must be radar");
    assert(store.selectedObjectUrn === "catalog:norad:25544", "Selected object must be ISS URN");
    assert(parsed.isNormalized === true, "URL was already normalized");

    // Module render evaluation
    const renderedModule = store.isHydrated ? store.activeTab : "skeleton";
    assert(renderedModule === "radar", "First navigation-dependent module mounted must be radar");
  });

  test("18. Deep-link Case 2 (Conjunctions + Event): event URN is available on first module render", () => {
    resetStore();
    const mockWin = new VirtualWindow("/", "?tab=conjunctions&eventId=conjunction:example-event");

    assert(useZorbitStore.getState().isHydrated === false, "Store is unhydrated before sync");

    const parsed = syncFromBrowserUrl({ normalize: true, targetWindow: mockWin as any });
    const store = useZorbitStore.getState();

    assert(store.isHydrated === true, "Store must be hydrated");
    assert(store.activeTab === "conjunctions", "Active tab must be conjunctions");
    assert(store.activeEventUrn === "conjunction:example-event", "Active event must be conjunction:example-event");

    const renderedModule = store.isHydrated ? store.activeTab : "skeleton";
    assert(renderedModule === "conjunctions", "First navigation-dependent module mounted must be conjunctions");
  });

  test("19. Deep-link Case 3 (Simulation + Scenario): scenario URN is preserved in Zustand", () => {
    resetStore();
    const mockWin = new VirtualWindow("/", "?tab=simulation&scenarioId=scenario:canonical-cw-reference");

    assert(useZorbitStore.getState().isHydrated === false, "Store is unhydrated before sync");

    const parsed = syncFromBrowserUrl({ normalize: true, targetWindow: mockWin as any });
    const store = useZorbitStore.getState();

    assert(store.isHydrated === true, "Store must be hydrated");
    assert(store.activeTab === "simulation", "Active tab must be simulation");
    assert(store.activeScenarioUrn === "scenario:canonical-cw-reference", "Active scenario must be canonical CW reference");

    // Verify simulation placeholder contract: activeScenarioUrn is in Zustand projection
    const renderedModule = store.isHydrated ? store.activeTab : "skeleton";
    assert(renderedModule === "simulation", "First navigation-dependent module mounted must be simulation");
  });

  test("20. Overview-side effects suppression on deep-link navigation", () => {
    resetStore();
    const mockWin = new VirtualWindow("/", "?tab=radar&objectId=catalog:norad:25544");

    // Track whether Overview data fetching occurs
    let overviewFetchCount = 0;
    const triggerOverviewFetch = () => {
      overviewFetchCount++;
    };

    // Simulate mounting HomePage:
    // Before hydration effect runs:
    const storeBefore = useZorbitStore.getState();
    if (storeBefore.isHydrated && storeBefore.activeTab === "overview") {
      triggerOverviewFetch();
    }
    assert(overviewFetchCount === 0, "Overview data-fetching MUST NOT execute before hydration");

    // Hydration executes:
    syncFromBrowserUrl({ normalize: true, targetWindow: mockWin as any });
    const storeAfter = useZorbitStore.getState();

    if (storeAfter.isHydrated && storeAfter.activeTab === "overview") {
      triggerOverviewFetch();
    }
    assert(overviewFetchCount === 0, "Overview data-fetching MUST NOT execute on deep link to radar");
    assert(storeAfter.activeTab === "radar", "Target tab is radar");
  });

  test("21. Failed synchronization has a safe fallback to overview with error recorded", () => {
    resetStore();
    // Simulate a corrupted window whose location throws an exception
    const faultyWindow = {
      location: {
        pathname: "/",
        get search(): string {
          throw new Error("Simulated DOMSecurityException / URI Malformation");
        },
      },
      history: {
        pushState() {},
        replaceState() {},
      },
    };

    const parsed = syncFromBrowserUrl({ normalize: true, targetWindow: faultyWindow as any });
    const store = useZorbitStore.getState();

    // Must not leave the app unhydrated or blank:
    assert(store.isHydrated === true, "Store must be marked hydrated even on sync failure");
    assert(store.activeTab === "overview", "Safe fallback must default to overview");
    assert(store.hydrationError !== null, "Hydration error must be recorded");
    assert(Boolean(store.hydrationError && store.hydrationError.includes("Simulated DOMSecurityException")), "Error message preserved");
    assert(parsed.state.tab === "overview", "Parsed state safely defaults to overview");
  });

  test("22. React Strict Mode simulation preserves idempotent hydration state without history mutation", () => {
    resetStore();
    const mockWin = new VirtualWindow("/", "?tab=radar&objectId=catalog:norad:25544");

    // Mount 1
    syncFromBrowserUrl({ normalize: true, targetWindow: mockWin as any });
    const store1 = { ...useZorbitStore.getState() };
    const pushCount1 = mockWin.history.pushCallCount;
    const replaceCount1 = mockWin.history.replaceCallCount;

    // Strict Mode Mount 2 (effect executed again)
    syncFromBrowserUrl({ normalize: true, targetWindow: mockWin as any });
    const store2 = { ...useZorbitStore.getState() };
    const pushCount2 = mockWin.history.pushCallCount;
    const replaceCount2 = mockWin.history.replaceCallCount;

    assert(store1.isHydrated === true && store2.isHydrated === true, "isHydrated remains true");
    assert(store1.activeTab === store2.activeTab, "activeTab remains unchanged");
    assert(store1.selectedObjectUrn === store2.selectedObjectUrn, "selectedObjectUrn remains unchanged");
    assert(pushCount2 === pushCount1, "Zero duplicate pushState calls in Strict Mode");
    assert(replaceCount2 === replaceCount1, "Zero duplicate replaceState calls in Strict Mode");
  });

  return { passed, total, details };
}
