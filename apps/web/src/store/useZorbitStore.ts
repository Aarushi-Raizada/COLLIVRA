/**
 * ZORBIT Master Global Domain Store
 *
 * Implements the approved Milestone 6.2 (v2.2.0) Architecture Specification.
 *
 * Responsibilities:
 * - Centralizes lightweight cross-module domain state.
 * - Composes modular slices: Navigation, Catalog, Conjunctions, Simulation, Telemetry.
 * - Provides fine-grained atomic selectors to prevent React re-rendering cascades.
 *
 * Strict Boundaries:
 * - Heavy trajectory points (50,000 Cartesian tuples) are NOT stored here (reside in SimulationPayloadRegistry).
 * - Per-frame 60 FPS Three.js animation clock is NOT stored here (resides in Three.js refs).
 */

import { create } from "zustand";
import { createNavigationSlice, type NavigationSlice } from "./slices/navigationSlice";
import { createCatalogSlice, type CatalogSlice } from "./slices/catalogSlice";
import { createConjunctionSlice, type ConjunctionSlice } from "./slices/conjunctionSlice";
import { createSimulationSlice, type SimulationSlice } from "./slices/simulationSlice";
import { createTelemetrySlice, type TelemetrySlice } from "./slices/telemetrySlice";
import { createSimulationClockSlice, type SimulationClockSlice } from "./slices/simulationClockSlice";

export type ZorbitStoreState =
  & NavigationSlice
  & CatalogSlice
  & ConjunctionSlice
  & SimulationSlice
  & TelemetrySlice
  & SimulationClockSlice;

export const useZorbitStore = create<ZorbitStoreState>()((...a) => ({
  ...createNavigationSlice(...a),
  ...createCatalogSlice(...a),
  ...createConjunctionSlice(...a),
  ...createSimulationSlice(...a),
  ...createTelemetrySlice(...a),
  ...createSimulationClockSlice(...a),
}));

// ============================================================================
// Fine-Grained Atomic Selectors (Prevents React Re-Render Cascades)
// ============================================================================

export const useActiveTab = () => useZorbitStore((s) => s.activeTab);
export const useActiveSubtab = () => useZorbitStore((s) => s.activeSubtab);
export const useSelectedObjectUrn = () => useZorbitStore((s) => s.selectedObjectUrn);
export const useActiveEventUrn = () => useZorbitStore((s) => s.activeEventUrn);
export const useActiveScenarioUrn = () => useZorbitStore((s) => s.activeScenarioUrn);
export const useIsNavigationHydrated = () => useZorbitStore((s) => s.isHydrated);
export const useNavigationHydrationError = () => useZorbitStore((s) => s.hydrationError);

export const useCatalogMap = () => useZorbitStore((s) => s.catalogMap);
export const useScreeningEvents = () => useZorbitStore((s) => s.screeningEvents);
export const useActiveEncounter = () => useZorbitStore((s) => s.activeEncounter);

export const useScenarios = () => useZorbitStore((s) => s.scenarios);
export const useScenarioSummaries = () => useZorbitStore((s) => s.scenarioSummaries);

export const useActiveScenarioSummary = () =>
  useZorbitStore((s) => {
    if (!s.activeScenarioUrn) return undefined;
    return s.scenarioSummaries[s.activeScenarioUrn];
  });

export const useApiStatus = () => useZorbitStore((s) => s.apiStatus);
export const useIsDemoMode = () => useZorbitStore((s) => s.isDemoMode);

// Simulation Clock Selectors
export const useSimulationEpochMs = () => useZorbitStore((s) => s.currentEpochMs);
export const useSimulationIsPlaying = () => useZorbitStore((s) => s.isPlaying);
export const useSimulationPlaybackSpeed = () => useZorbitStore((s) => s.playbackSpeed);
export const useIsSimulationOutOfBounds = () => useZorbitStore((s) => s.isOutOfBounds);
export const useSimulationClockActions = () =>
  useZorbitStore((s) => ({
    setEpochMs: s.setSimulationEpochMs,
    setIsPlaying: s.setSimulationIsPlaying,
    setPlaybackSpeed: s.setSimulationPlaybackSpeed,
    resetClock: s.resetSimulationClock,
    stepClock: s.stepSimulationClock,
  }));

