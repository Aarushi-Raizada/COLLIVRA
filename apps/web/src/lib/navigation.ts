/**
 * COLLIVRA Navigation & URL Synchronization Engine
 *
 * Implements the approved Milestone 6.2 (v2.2.0) Architecture Specification:
 * - Browser URL query parameters are the single authoritative source of truth.
 * - Zustand navigation slice is a downstream in-memory hydrated projection.
 * - Loop-breaker guarantee: checks whether target URL differs from current URL before pushing history.
 * - Strict canonical identity validation: leverages M6.3.1 URN resolver (resolveToCanonicalUrn).
 * - Zero silent guessing: invalid parameters are stripped safely without assigning default entities.
 *
 * Supported query parameters:
 * 1. `tab`: Active application view ('overview' | 'radar' | 'conjunctions' | 'simulation' | 'system')
 * 2. `objectId`: Canonical orbital object or synthetic fragment URN (or resolvable alias)
 * 3. `subtab`: Simulation mode ('breakup' | 'remediation')
 * 4. `eventId`: Canonical conjunction encounter URN (or resolvable EVT ID)
 * 5. `scenarioId`: Canonical simulation scenario URN (or resolvable scenario slug)
 */

import { NavigationTab } from "../types/orbital";
import {
  CatalogUrn,
  SyntheticFragmentUrn,
  ScenarioUrn,
  ConjunctionUrn,
} from "../types/shared_state";
import {
  resolveToCanonicalUrn,
  isCatalogUrn,
  isSyntheticFragmentUrn,
  isScenarioUrn,
  isConjunctionUrn,
} from "./urn";
import { useZorbitStore } from "../store/useZorbitStore";

// ============================================================================
// 1. Constants & Validation Types
// ============================================================================

export const VALID_TABS: readonly NavigationTab[] = [
  "overview",
  "radar",
  "conjunctions",
  "simulation",
  "system",
] as const;

export const VALID_SUBTABS = ["breakup", "remediation"] as const;
export type SimulationSubtab = (typeof VALID_SUBTABS)[number];

export interface NavigationalState {
  tab: NavigationTab;
  objectId: CatalogUrn | SyntheticFragmentUrn | null;
  subtab: SimulationSubtab | null;
  eventId: ConjunctionUrn | null;
  scenarioId: ScenarioUrn | null;
}

export interface NavigationRequest {
  tab?: NavigationTab | string;
  objectId?: string | null;
  subtab?: string | null;
  eventId?: string | null;
  scenarioId?: string | null;
}

export interface InvalidNavParam {
  param: "tab" | "objectId" | "subtab" | "eventId" | "scenarioId" | "unknown";
  rawValue: string;
  reason: string;
}

export interface ParsedUrlNavigation {
  state: NavigationalState;
  invalidParams: InvalidNavParam[];
  isNormalized: boolean;
  queryString: string;
}

// ============================================================================
// 2. Pure Validation Functions
// ============================================================================

export function isValidTab(val: unknown): val is NavigationTab {
  return typeof val === "string" && VALID_TABS.includes(val as NavigationTab);
}

export function isValidSubtab(val: unknown): val is SimulationSubtab {
  return typeof val === "string" && VALID_SUBTABS.includes(val as SimulationSubtab);
}

// ============================================================================
// 3. URL Parameter Parser & Deserializer
// ============================================================================

/**
 * Parses, validates, and normalizes URL query parameters according to COLLIVRA contracts.
 * Strips unknown or malformed parameters safely without mutating valid independent state.
 */
export function parseUrlNavigationalState(
  searchOrParams: string | URLSearchParams
): ParsedUrlNavigation {
  const params =
    typeof searchOrParams === "string"
      ? new URLSearchParams(
          searchOrParams.startsWith("?") ? searchOrParams.slice(1) : searchOrParams
        )
      : searchOrParams;

  const invalidParams: InvalidNavParam[] = [];
  let isNormalized = true;

  // Track raw query keys to detect unrecognized parameters
  const recognizedKeys = new Set(["tab", "objectId", "subtab", "eventId", "scenarioId"]);
  params.forEach((value, key) => {
    if (!recognizedKeys.has(key)) {
      invalidParams.push({
        param: "unknown",
        rawValue: `${key}=${value}`,
        reason: `Unsupported query parameter '${key}' was stripped.`,
      });
      isNormalized = false;
    }
  });

  // 1. Tab validation
  let tab: NavigationTab = "overview";
  const rawTab = params.get("tab");
  if (rawTab !== null && rawTab.trim() !== "") {
    const cleanTab = rawTab.trim().toLowerCase();
    if (isValidTab(cleanTab)) {
      tab = cleanTab;
      if (rawTab !== cleanTab) isNormalized = false;
    } else {
      invalidParams.push({
        param: "tab",
        rawValue: rawTab,
        reason: `Invalid tab '${rawTab}'. Defaulting to 'overview'.`,
      });
      isNormalized = false;
    }
  }

  // 2. ObjectId validation
  let objectId: CatalogUrn | SyntheticFragmentUrn | null = null;
  const rawObjectId = params.get("objectId");
  if (rawObjectId !== null && rawObjectId.trim() !== "") {
    const res = resolveToCanonicalUrn(rawObjectId);
    if (res.success && (isCatalogUrn(res.urn) || isSyntheticFragmentUrn(res.urn))) {
      objectId = res.urn;
      if (rawObjectId.trim() !== res.urn) {
        isNormalized = false; // Legacy alias or unnamespaced numeric ID needs normalization
      }
    } else {
      invalidParams.push({
        param: "objectId",
        rawValue: rawObjectId,
        reason: res.success
          ? `Identifier '${rawObjectId}' resolved to '${res.kind}', but objectId requires CATALOG or SYNTHETIC.`
          : res.error,
      });
      isNormalized = false;
    }
  }

  // 3. Subtab validation
  let subtab: SimulationSubtab | null = null;
  const rawSubtab = params.get("subtab");
  if (rawSubtab !== null && rawSubtab.trim() !== "") {
    const cleanSubtab = rawSubtab.trim().toLowerCase();
    if (isValidSubtab(cleanSubtab)) {
      subtab = cleanSubtab;
      if (rawSubtab !== cleanSubtab) isNormalized = false;
    } else {
      invalidParams.push({
        param: "subtab",
        rawValue: rawSubtab,
        reason: `Invalid subtab '${rawSubtab}'. Subtab must be 'breakup' or 'remediation'.`,
      });
      isNormalized = false;
    }
  }

  // 4. EventId validation
  let eventId: ConjunctionUrn | null = null;
  const rawEventId = params.get("eventId");
  if (rawEventId !== null && rawEventId.trim() !== "") {
    const res = resolveToCanonicalUrn(rawEventId, "CONJUNCTION");
    if (res.success && isConjunctionUrn(res.urn)) {
      eventId = res.urn;
      if (rawEventId.trim() !== res.urn) {
        isNormalized = false;
      }
    } else {
      invalidParams.push({
        param: "eventId",
        rawValue: rawEventId,
        reason: res.success ? `Identifier '${rawEventId}' is not a conjunction encounter.` : res.error,
      });
      isNormalized = false;
    }
  }

  // 5. ScenarioId validation
  let scenarioId: ScenarioUrn | null = null;
  const rawScenarioId = params.get("scenarioId");
  if (rawScenarioId !== null && rawScenarioId.trim() !== "") {
    const res = resolveToCanonicalUrn(rawScenarioId, "SCENARIO");
    if (res.success && isScenarioUrn(res.urn)) {
      scenarioId = res.urn;
      if (rawScenarioId.trim() !== res.urn) {
        isNormalized = false;
      }
    } else {
      invalidParams.push({
        param: "scenarioId",
        rawValue: rawScenarioId,
        reason: res.success ? `Identifier '${rawScenarioId}' is not a valid scenario.` : res.error,
      });
      isNormalized = false;
    }
  }

  const state: NavigationalState = {
    tab,
    objectId,
    subtab,
    eventId,
    scenarioId,
  };

  const queryString = buildNavigationalQueryString(state);

  return {
    state,
    invalidParams,
    isNormalized: isNormalized && invalidParams.length === 0,
    queryString,
  };
}

// ============================================================================
// 4. URL Builder & Serializer
// ============================================================================

/**
 * Builds a canonical URL query string from navigation request parameters.
 * Validates identifiers through M6.3.1 resolvers and ignores invalid properties.
 */
export function buildNavigationalQueryString(
  request: NavigationRequest | Partial<NavigationalState>
): string {
  const params = new URLSearchParams();

  // Tab (Defaults to overview)
  if (request.tab) {
    const cleanTab = String(request.tab).trim().toLowerCase();
    if (isValidTab(cleanTab)) {
      params.set("tab", cleanTab);
    } else {
      params.set("tab", "overview");
    }
  } else {
    params.set("tab", "overview");
  }

  // ObjectId
  if (request.objectId) {
    const res = resolveToCanonicalUrn(request.objectId);
    if (res.success && (isCatalogUrn(res.urn) || isSyntheticFragmentUrn(res.urn))) {
      params.set("objectId", res.urn);
    }
  }

  // Subtab
  if (request.subtab) {
    const cleanSubtab = String(request.subtab).trim().toLowerCase();
    if (isValidSubtab(cleanSubtab)) {
      params.set("subtab", cleanSubtab);
    }
  }

  // EventId
  if (request.eventId) {
    const res = resolveToCanonicalUrn(request.eventId, "CONJUNCTION");
    if (res.success && isConjunctionUrn(res.urn)) {
      params.set("eventId", res.urn);
    }
  }

  // ScenarioId
  if (request.scenarioId) {
    const res = resolveToCanonicalUrn(request.scenarioId, "SCENARIO");
    if (res.success && isScenarioUrn(res.urn)) {
      params.set("scenarioId", res.urn);
    }
  }

  return params.toString();
}

/**
 * Builds a full navigational URL (e.g. `/?tab=radar&objectId=catalog:norad:25544`).
 */
export function buildNavigationalUrl(
  pathname: string,
  request: NavigationRequest | Partial<NavigationalState>
): string {
  const cleanPath = pathname || "/";
  const qs = buildNavigationalQueryString(request);
  return qs ? `${cleanPath}?${qs}` : cleanPath;
}

/**
 * Normalizes a search query string for robust loop-breaking comparison.
 */
export function normalizeSearchString(search: string): string {
  const clean = search.startsWith("?") ? search.slice(1) : search;
  if (!clean || clean.trim() === "") return "";
  try {
    const params = new URLSearchParams(clean);
    params.sort();
    return decodeURIComponent(params.toString());
  } catch {
    return clean;
  }
}

// ============================================================================
// 5. Authoritative Navigation Dispatcher (Single Synchronization Mechanism)
// ============================================================================

export interface NavigateToUrlResult {
  success: boolean;
  targetUrl: string;
  hasChanged: boolean;
  state: NavigationalState;
}

/**
 * Programmatically navigates to a new application view, updating browser history
 * and synchronizing the Zustand store atomically.
 *
 * Implements the Loop-Breaker Guarantee:
 * Compares target query against current window search before invoking pushState.
 */
export function navigateToUrl(
  request: NavigationRequest,
  options?: {
    replace?: boolean;
    pathname?: string;
    targetWindow?: Window;
  }
): NavigateToUrlResult {
  const win = options?.targetWindow ?? (typeof window !== "undefined" ? window : undefined);
  const currentPath = win ? win.location.pathname : "/";
  const currentSearch = win ? win.location.search : "";
  const targetPath = options?.pathname ?? currentPath;

  const queryString = buildNavigationalQueryString(request);
  const targetUrl = queryString ? `${targetPath}?${queryString}` : targetPath;

  const targetSearch = queryString ? `?${queryString}` : "";
  const hasChanged =
    normalizeSearchString(targetSearch) !== normalizeSearchString(currentSearch) ||
    targetPath !== currentPath;

  const parsed = parseUrlNavigationalState(queryString);

  if (win && hasChanged) {
    if (options?.replace) {
      win.history.replaceState({ ...parsed.state }, "", targetUrl);
    } else {
      win.history.pushState({ ...parsed.state }, "", targetUrl);
    }
  }

  // Synchronize store atomically
  useZorbitStore.getState().syncNavFromUrl({
    activeTab: parsed.state.tab,
    activeSubtab: parsed.state.subtab,
    selectedObjectUrn: parsed.state.objectId,
    activeEventUrn: parsed.state.eventId,
    activeScenarioUrn: parsed.state.scenarioId,
    isHydrated: true,
  });

  if (useZorbitStore.getState().hydrationError !== null) {
    useZorbitStore.getState().setNavigationHydrated(true, null);
  }

  return {
    success: true,
    targetUrl,
    hasChanged,
    state: parsed.state,
  };
}

/**
 * Synchronizes the Zustand store from the current browser URL.
 * Used during initial mount hydration and popstate (browser back/forward) handling.
 */
export function syncFromBrowserUrl(options?: {
  normalize?: boolean;
  targetWindow?: Window;
}): ParsedUrlNavigation {
  const win = options?.targetWindow ?? (typeof window !== "undefined" ? window : undefined);
  const store = useZorbitStore.getState();

  if (!win) {
    if (!store.isHydrated) {
      store.syncNavFromUrl({
        activeTab: "overview",
        activeSubtab: null,
        selectedObjectUrn: null,
        activeEventUrn: null,
        activeScenarioUrn: null,
        isHydrated: true,
      });
      store.setNavigationHydrated(true, null);
    }
    return {
      state: {
        tab: "overview",
        objectId: null,
        subtab: null,
        eventId: null,
        scenarioId: null,
      },
      invalidParams: [],
      isNormalized: true,
      queryString: "tab=overview",
    };
  }

  let rawSearch = "";
  try {
    rawSearch = win.location.search;
    const parsed = parseUrlNavigationalState(rawSearch);

    // Check if store already matches to avoid redundant store updates
    const storeMatches =
      store.isHydrated &&
      store.activeTab === parsed.state.tab &&
      store.activeSubtab === parsed.state.subtab &&
      store.selectedObjectUrn === parsed.state.objectId &&
      store.activeEventUrn === parsed.state.eventId &&
      store.activeScenarioUrn === parsed.state.scenarioId;

    if (!storeMatches) {
      store.syncNavFromUrl({
        activeTab: parsed.state.tab,
        activeSubtab: parsed.state.subtab,
        selectedObjectUrn: parsed.state.objectId,
        activeEventUrn: parsed.state.eventId,
        activeScenarioUrn: parsed.state.scenarioId,
        isHydrated: true,
      });
    }

    // If normalization is requested (e.g. on initial mount) and the URL was not normalized:
    if (options?.normalize && !parsed.isNormalized) {
      const normalizedUrl = parsed.queryString
        ? `${win.location.pathname}?${parsed.queryString}`
        : win.location.pathname;
      win.history.replaceState({ ...parsed.state }, "", normalizedUrl);
    }

    // Mark hydration complete in store
    if (!store.isHydrated || store.hydrationError !== null) {
      store.setNavigationHydrated(true, null);
    }

    return parsed;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Safe error fallback: ensure store is hydrated with default overview to avoid permanent blank screen
    store.syncNavFromUrl({
      activeTab: "overview",
      activeSubtab: null,
      selectedObjectUrn: null,
      activeEventUrn: null,
      activeScenarioUrn: null,
      isHydrated: true,
    });
    store.setNavigationHydrated(true, errorMsg);

    return {
      state: {
        tab: "overview",
        objectId: null,
        subtab: null,
        eventId: null,
        scenarioId: null,
      },
      invalidParams: [
        {
          param: "unknown",
          rawValue: rawSearch,
          reason: `URL synchronization failed: ${errorMsg}`,
        },
      ],
      isNormalized: false,
      queryString: "tab=overview",
    };
  }
}

