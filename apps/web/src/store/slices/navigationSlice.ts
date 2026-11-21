/**
 * Navigation Slice for ZORBIT Global Domain Store
 *
 * Manages active tab, subtab, and canonical entity selections.
 * Enforces canonical URN resolution before accepting selection updates.
 * Does not implement URL history pushState (reserved for M6.3.2).
 */

import type { StateCreator } from "zustand";
import type { NavigationTab } from "../../types/orbital";
import type {
  CatalogUrn,
  SyntheticFragmentUrn,
  ScenarioUrn,
  ConjunctionUrn,
} from "../../types/shared_state";
import { resolveToCanonicalUrn, isCatalogUrn, isSyntheticFragmentUrn, isScenarioUrn, isConjunctionUrn } from "../../lib/urn";
import type { ZorbitStoreState } from "../useZorbitStore";

export interface NavigationalStateUpdate {
  activeTab?: NavigationTab;
  activeSubtab?: "breakup" | "remediation" | null;
  selectedObjectUrn?: CatalogUrn | SyntheticFragmentUrn | null;
  activeEventUrn?: ConjunctionUrn | null;
  activeScenarioUrn?: ScenarioUrn | null;
  isHydrated?: boolean;
}

export interface NavigationSlice {
  activeTab: NavigationTab;
  activeSubtab: "breakup" | "remediation" | null;
  selectedObjectUrn: CatalogUrn | SyntheticFragmentUrn | null;
  activeEventUrn: ConjunctionUrn | null;
  activeScenarioUrn: ScenarioUrn | null;
  isHydrated: boolean;
  hydrationError: string | null;

  // Actions
  setActiveTab: (tab: NavigationTab) => void;
  setActiveSubtab: (subtab: "breakup" | "remediation" | null) => void;
  setSelectedObjectUrn: (rawInput: string | null) => { success: boolean; error?: string };
  setActiveEventUrn: (rawInput: string | null) => { success: boolean; error?: string };
  setActiveScenarioUrn: (rawInput: string | null) => { success: boolean; error?: string };
  syncNavFromUrl: (update: NavigationalStateUpdate) => void;
  setNavigationHydrated: (hydrated: boolean, error?: string | null) => void;
  clearSelection: () => void;
}

export const createNavigationSlice: StateCreator<
  ZorbitStoreState,
  [],
  [],
  NavigationSlice
> = (set, get) => ({
  activeTab: "overview",
  activeSubtab: null,
  selectedObjectUrn: null,
  activeEventUrn: null,
  activeScenarioUrn: null,
  isHydrated: false,
  hydrationError: null,

  setActiveTab: (tab: NavigationTab) => {
    set({ activeTab: tab });
  },

  setActiveSubtab: (subtab: "breakup" | "remediation" | null) => {
    set({ activeSubtab: subtab });
  },

  setSelectedObjectUrn: (rawInput: string | null) => {
    if (rawInput === null || rawInput === undefined || rawInput === "") {
      set({ selectedObjectUrn: null });
      return { success: true };
    }

    const res = resolveToCanonicalUrn(rawInput);
    if (!res.success) {
      return { success: false, error: res.error };
    }

    if (!isCatalogUrn(res.urn) && !isSyntheticFragmentUrn(res.urn)) {
      return {
        success: false,
        error: `Invalid entity selection: '${rawInput}' resolved to '${res.kind}', but selectedObjectUrn requires CATALOG or SYNTHETIC fragment.`,
      };
    }

    set({ selectedObjectUrn: res.urn });
    return { success: true };
  },

  setActiveEventUrn: (rawInput: string | null) => {
    if (rawInput === null || rawInput === undefined || rawInput === "") {
      set({ activeEventUrn: null });
      return { success: true };
    }

    const res = resolveToCanonicalUrn(rawInput, "CONJUNCTION");
    if (!res.success) {
      return { success: false, error: res.error };
    }

    if (!isConjunctionUrn(res.urn)) {
      return {
        success: false,
        error: `Expected conjunction encounter URN, received '${res.urn}'.`,
      };
    }

    set({ activeEventUrn: res.urn });
    return { success: true };
  },

  setActiveScenarioUrn: (rawInput: string | null) => {
    if (rawInput === null || rawInput === undefined || rawInput === "") {
      set({ activeScenarioUrn: null });
      return { success: true };
    }

    const res = resolveToCanonicalUrn(rawInput, "SCENARIO");
    if (!res.success) {
      return { success: false, error: res.error };
    }

    if (!isScenarioUrn(res.urn)) {
      return {
        success: false,
        error: `Expected scenario URN, received '${res.urn}'.`,
      };
    }

    set({ activeScenarioUrn: res.urn });
    return { success: true };
  },

  syncNavFromUrl: (update: NavigationalStateUpdate) => {
    set((state) => ({
      activeTab: update.activeTab !== undefined ? update.activeTab : state.activeTab,
      activeSubtab: update.activeSubtab !== undefined ? update.activeSubtab : state.activeSubtab,
      selectedObjectUrn:
        update.selectedObjectUrn !== undefined ? update.selectedObjectUrn : state.selectedObjectUrn,
      activeEventUrn:
        update.activeEventUrn !== undefined ? update.activeEventUrn : state.activeEventUrn,
      activeScenarioUrn:
        update.activeScenarioUrn !== undefined ? update.activeScenarioUrn : state.activeScenarioUrn,
      isHydrated: update.isHydrated !== undefined ? update.isHydrated : state.isHydrated,
    }));
  },

  setNavigationHydrated: (hydrated: boolean, error: string | null = null) => {
    set({ isHydrated: hydrated, hydrationError: error });
  },

  clearSelection: () => {
    set({ selectedObjectUrn: null });
  },
});

