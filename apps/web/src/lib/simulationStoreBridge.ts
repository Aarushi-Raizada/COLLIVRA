/**
 * COLLIVRA Simulation Store Bridge (Tier 3 -> Tier 2 Integration Bridge)
 *
 * Implements M6.3.4 Refinement 1: Dedicated Summary Synchronization Ownership.
 *
 * Architectural Invariants:
 * 1. Dedicated Integration Bridge Ownership:
 *    - `SimulationDashboardView` does NOT own summary synchronization.
 *    - This dedicated bridge synchronizes summaries whenever registry records are
 *      committed, preloaded, invalidated, or deleted.
 * 2. Mission Overview Availability:
 *    - Mission Overview and other consumers receive updated summaries reactively even when
 *      `SimulationDashboardView` is not mounted.
 * 3. Strict Lightweight Segregation (< 2 kB):
 *    - Summary extraction strictly uses `extractSimulationSummary(record)`.
 *    - ONLY lightweight metadata and numerical summaries (scalar mass balances, delta-V,
 *      fragment counts, and boolean feasibility flags) enter the Zustand store.
 *    - Heavy trajectories, 50,000-point DOP853 position matrices, and raw backend responses
 *      are STRICTLY EXCLUDED from Zustand.
 * 4. Freshness-Token & Stale-Result Protection:
 *    - Listens directly to registry mutation events. Since the registry only accepts commits
 *      with valid, unexpired request tokens (DEF-634-1), stale commits never reach Zustand.
 * 5. Safe Invalidation and Deletion:
 *    - Deleting or invalidating a scenario clears or updates the corresponding summary in Zustand,
 *      preventing misleading stale summaries.
 * 6. Zero Circular Dependencies:
 *    - Registry does NOT import Zustand; bridge imports both and attaches cleanly.
 */

import {
  SimulationPayloadRegistry,
  RegistryMutationEvent,
} from "./simulationPayloadRegistry";
import { extractSimulationSummary } from "./simulationAdapters";
import { useZorbitStore } from "../store/useZorbitStore";
import type { CanonicalScenarioMetadata } from "../types/shared_state";

export class SimulationStoreBridge {
  private static instance: SimulationStoreBridge | null = null;
  private unsubscribe: (() => void) | null = null;
  private registry: SimulationPayloadRegistry;

  constructor(registry?: SimulationPayloadRegistry) {
    this.registry = registry || SimulationPayloadRegistry.getInstance();
  }

  public static getInstance(registry?: SimulationPayloadRegistry): SimulationStoreBridge {
    if (!SimulationStoreBridge.instance) {
      SimulationStoreBridge.instance = new SimulationStoreBridge(registry);
      SimulationStoreBridge.instance.connect();
    }
    return SimulationStoreBridge.instance;
  }

  public static resetInstance(): void {
    if (SimulationStoreBridge.instance) {
      SimulationStoreBridge.instance.disconnect();
      SimulationStoreBridge.instance = null;
    }
  }

  /**
   * Connects the bridge to registry mutation events.
   */
  public connect(): void {
    if (this.unsubscribe) return;

    this.unsubscribe = this.registry.addMutationListener(this.handleMutation.bind(this));

    // Initial sync of any already preloaded benchmark fixtures
    this.syncAllRecords();
  }

  /**
   * Disconnects the bridge from the registry.
   */
  public disconnect(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Synchronizes all currently cached scenarios in the registry to Zustand.
   */
  public syncAllRecords(): void {
    const urns = this.registry.getAllScenarioUrns();
    urns.forEach((urn) => {
      const record = this.registry.getRecord(urn);
      if (record) {
        this.syncRecordToStore(record);
      }
    });
  }

  private handleMutation(event: RegistryMutationEvent): void {
    switch (event.type) {
      case "UPSERT": {
        if (event.record) {
          this.syncRecordToStore(event.record);
        }
        break;
      }

      case "PRELOAD_BENCHMARKS": {
        this.syncAllRecords();
        break;
      }

      case "INVALIDATE_WORKFLOW": {
        if (!event.scenarioUrn) return;
        const currentRecord = this.registry.getRecord(event.scenarioUrn);
        if (currentRecord && (currentRecord.breakupPayload || currentRecord.remediationPayload)) {
          // Record still has at least one active workflow, re-extract lightweight summary
          this.syncRecordToStore(currentRecord);
        } else {
          // No active workflows remain for this scenario, invalidate in store
          useZorbitStore.getState().invalidateScenario(event.scenarioUrn);
        }
        break;
      }

      case "DELETE_SCENARIO": {
        if (event.scenarioUrn) {
          useZorbitStore.getState().removeScenario(event.scenarioUrn);
        }
        break;
      }

      case "CLEAR_ALL": {
        const state = useZorbitStore.getState();
        const currentUrns = Object.keys(state.scenarioSummaries);
        currentUrns.forEach((urn) => {
          state.removeScenario(urn);
        });
        break;
      }
    }
  }

  /**
   * Derives a lightweight CanonicalSimulationSummary and synchronizes it into Zustand.
   */
  public syncRecordToStore(record: Parameters<typeof extractSimulationSummary>[0]): void {
    const urn = record.scenarioUrn;

    // 1. Ensure scenario metadata is registered in Zustand
    const store = useZorbitStore.getState();
    const existingMeta = store.scenarios[urn];
    if (!existingMeta) {
      const metadata: CanonicalScenarioMetadata = {
        scenarioUrn: urn,
        createdAtUtc: record.createdAtUtc,
        displayName: record.isBenchmarkFixture
          ? urn.replace("scenario:", "").replace(/-/g, " ").toUpperCase()
          : `Scenario ${urn.replace("scenario:", "")}`,
        description: record.isBenchmarkFixture ? "Canonical Benchmark Fixture" : "Synthetic Simulation Scenario",
        isBenchmarkFixture: record.isBenchmarkFixture,
      };
      store.registerScenario(metadata);
    }

    // 2. Extract strictly lightweight numerical summary (< 2 kB)
    const summary = extractSimulationSummary(record);

    // 3. Update store
    store.setScenarioSummary(urn, summary);
  }
}

// Automatically initialize default bridge singleton
export const simulationStoreBridge = SimulationStoreBridge.getInstance();
