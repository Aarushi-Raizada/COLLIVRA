/**
 * Simulation Slice for ZORBIT Global Domain Store
 *
 * Manages lightweight scenario metadata and simulation summaries.
 *
 * Invariants:
 * - Scenarios are keyed strictly by canonical ScenarioUrn.
 * - Heavy trajectory batches (50,000 points) are STRICTLY EXCLUDED (reside in SimulationPayloadRegistry).
 * - Enforces scenario isolation: independent runs never cross-contaminate.
 * - Invalidation clears or marks summaries without corrupting independent scenarios.
 */

import type { StateCreator } from "zustand";
import type {
  ScenarioUrn,
  CanonicalScenarioMetadata,
  CanonicalSimulationSummary,
} from "../../types/shared_state";
import { isScenarioUrn } from "../../lib/urn";
import type { ZorbitStoreState } from "../useZorbitStore";

export interface SimulationSlice {
  scenarios: Record<string, CanonicalScenarioMetadata>;
  scenarioSummaries: Record<string, CanonicalSimulationSummary>;

  // Actions
  registerScenario: (
    metadata: CanonicalScenarioMetadata,
    summary?: CanonicalSimulationSummary
  ) => { success: boolean; error?: string };

  setScenarioSummary: (
    scenarioUrn: string,
    summary: CanonicalSimulationSummary
  ) => { success: boolean; error?: string };

  invalidateScenario: (scenarioUrn: string) => void;
  removeScenario: (scenarioUrn: string) => void;
  getScenarioMetadata: (scenarioUrn: string) => CanonicalScenarioMetadata | undefined;
  getScenarioSummary: (scenarioUrn: string) => CanonicalSimulationSummary | undefined;
}

export const createSimulationSlice: StateCreator<
  ZorbitStoreState,
  [],
  [],
  SimulationSlice
> = (set, get) => ({
  scenarios: {},
  scenarioSummaries: {},

  registerScenario: (
    metadata: CanonicalScenarioMetadata,
    summary?: CanonicalSimulationSummary
  ) => {
    if (!metadata || !isScenarioUrn(metadata.scenarioUrn)) {
      return {
        success: false,
        error: `Invalid scenario registration: '${metadata?.scenarioUrn}' is not a valid ScenarioUrn.`,
      };
    }

    if (summary && summary.scenarioUrn !== metadata.scenarioUrn) {
      return {
        success: false,
        error: `Scenario summary URN mismatch: summary has '${summary.scenarioUrn}', but metadata has '${metadata.scenarioUrn}'.`,
      };
    }

    set((state) => {
      const nextScenarios = {
        ...state.scenarios,
        [metadata.scenarioUrn]: metadata,
      };
      const nextSummaries = summary
        ? {
            ...state.scenarioSummaries,
            [metadata.scenarioUrn]: summary,
          }
        : state.scenarioSummaries;

      return {
        scenarios: nextScenarios,
        scenarioSummaries: nextSummaries,
      };
    });

    return { success: true };
  },

  setScenarioSummary: (
    scenarioUrn: string,
    summary: CanonicalSimulationSummary
  ) => {
    if (!isScenarioUrn(scenarioUrn)) {
      return {
        success: false,
        error: `Invalid scenario URN '${scenarioUrn}'.`,
      };
    }

    if (summary.scenarioUrn !== scenarioUrn) {
      return {
        success: false,
        error: `Mismatched scenario summary URN: expected '${scenarioUrn}', received '${summary.scenarioUrn}'.`,
      };
    }

    set((state) => ({
      scenarioSummaries: {
        ...state.scenarioSummaries,
        [scenarioUrn]: summary,
      },
    }));

    return { success: true };
  },

  invalidateScenario: (scenarioUrn: string) => {
    set((state) => {
      const current = state.scenarioSummaries[scenarioUrn];
      if (!current) return state;

      return {
        scenarioSummaries: {
          ...state.scenarioSummaries,
          [scenarioUrn]: {
            ...current,
            status: "FAILED",
            errorMessage: "Scenario invalidated.",
          },
        },
      };
    });
  },

  removeScenario: (scenarioUrn: string) => {
    set((state) => {
      const nextScenarios = { ...state.scenarios };
      const nextSummaries = { ...state.scenarioSummaries };
      delete nextScenarios[scenarioUrn];
      delete nextSummaries[scenarioUrn];

      // If active scenario was deleted, clear active pointer
      const nextActiveScenario =
        state.activeScenarioUrn === scenarioUrn ? null : state.activeScenarioUrn;

      return {
        scenarios: nextScenarios,
        scenarioSummaries: nextSummaries,
        activeScenarioUrn: nextActiveScenario,
      };
    });
  },

  getScenarioMetadata: (scenarioUrn: string) => {
    return get().scenarios[scenarioUrn];
  },

  getScenarioSummary: (scenarioUrn: string) => {
    return get().scenarioSummaries[scenarioUrn];
  },
});

