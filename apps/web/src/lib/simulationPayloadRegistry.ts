/**
 * COLLIVRA Simulation Payload Registry (Tier 3: Unreactive In-Memory Heap)
 *
 * Implements the approved Milestone 6.3.4 (Architecture v2.1.0) Payload Storage Specification
 * with DEF-634-1 Request-Generation Freshness Guard.
 *
 * Architectural Invariants:
 * 1. Tier 3 Unreactive Isolation:
 *    - Heavy numerical data (50-fragment x 1,000-point DOP853 trajectories, fragment coordinate
 *      matrices, raw backend responses) are STRICTLY EXCLUDED from the reactive Zustand store.
 *    - Cached here in memory heap as an unreactive Map<ScenarioUrn, ScenarioPayloadRecord>.
 * 2. Multi-Workflow Scenario Records (ScenarioUrn -> ScenarioPayloadRecord):
 *    - Breakup simulation results and Clohessy-Wiltshire (CW) remediation solutions are stored
 *      in separate, independently managed slots within the same scenario record.
 *    - Registering a remediation burn solution does NOT overwrite or delete the underlying breakup debris cloud.
 * 3. Independent Workflow Invalidation:
 *    - Invalidating breakup results preserves remediation results (and vice-versa).
 * 4. Stale-Result Protection & Asynchronous Freshness Guard (DEF-634-1):
 *    - Request-generation tracking via `beginWorkflowRequest`, `isWorkflowRequestCurrent`, and
 *      `commitWorkflowResult`.
 *    - A newer request invalidates older in-flight requests for the same scenario and workflow.
 *    - Stale or superseded responses are rejected without modifying records or incrementing versions.
 *    - Monotonically increasing `version: number` on every successful state mutation.
 * 5. Strict Canonical Identity:
 *    - Keyed strictly by canonical ScenarioUrn (`scenario:SIM-<uuid>` or registered benchmark slugs).
 *    - Returns `undefined` for unknown or missing scenarios. Never silently guesses or loads defaults.
 */

import type {
  ScenarioUrn,
  ScenarioPayloadRecord,
  BreakupResultPayload,
  RemediationResultPayload,
  CompositeSimulationPayload,
} from "../types/shared_state";
import { isScenarioUrn, buildScenarioUrn, generateUuid } from "./urn";
import {
  adaptCanonicalCwFixtureToPayload,
  adaptBreakupResponseToPayload,
} from "./simulationAdapters";
import { CANONICAL_CW_FIXTURE } from "../data/canonicalCwFixture";
import { DEMO_BREAKUP_RESPONSE } from "../data/simulationFixtures";
import type { BreakupAndPropagateResponse } from "../types/simulation";

export type SimulationWorkflowType = "breakup" | "remediation";

export type RegistryMutationType =
  | "UPSERT"
  | "INVALIDATE_WORKFLOW"
  | "DELETE_SCENARIO"
  | "CLEAR_ALL"
  | "PRELOAD_BENCHMARKS";

export interface RegistryMutationEvent {
  type: RegistryMutationType;
  scenarioUrn?: ScenarioUrn;
  workflow?: SimulationWorkflowType | "composite";
  record?: ScenarioPayloadRecord;
}

export type RegistryMutationListener = (event: RegistryMutationEvent) => void;

export interface WorkflowCommitResult {
  success: boolean;
  record?: ScenarioPayloadRecord;
  error?: string;
  isStale?: boolean;
}

interface WorkflowTokenBucket {
  generation: number;
  token: string | null;
  issuedAtUtc: string | null;
}

interface ScenarioTokenState {
  breakup: WorkflowTokenBucket;
  remediation: WorkflowTokenBucket;
}

/**
 * Creates a new collision-resistant canonical ScenarioUrn for dynamic simulation runs.
 * Uses the established M6.3.1 format: `scenario:SIM-<uuid-v4>`.
 */
export function createDynamicScenarioUrn(): ScenarioUrn {
  return buildScenarioUrn();
}

/**
 * Generates an RFC 4122 v4 UUID string for payload identification.
 */
export function generatePayloadId(): string {
  return generateUuid();
}

/**
 * In-memory unreactive cache for heavy astrodynamical simulation payloads.
 */
export class SimulationPayloadRegistry {
  private static instance: SimulationPayloadRegistry | null = null;
  private cache: Map<ScenarioUrn, ScenarioPayloadRecord> = new Map();
  private tokenState: Map<ScenarioUrn, ScenarioTokenState> = new Map();
  private listeners: Set<() => void> = new Set();
  private mutationListeners: Set<RegistryMutationListener> = new Set();

  /**
   * Singleton accessor for global client application lifecycle.
   */
  public static getInstance(): SimulationPayloadRegistry {
    if (!SimulationPayloadRegistry.instance) {
      SimulationPayloadRegistry.instance = new SimulationPayloadRegistry();
    }
    return SimulationPayloadRegistry.instance;
  }

  /**
   * Resets the singleton instance (strictly for test isolation).
   */
  public static resetInstance(): void {
    if (SimulationPayloadRegistry.instance) {
      SimulationPayloadRegistry.instance.clearAll();
      SimulationPayloadRegistry.instance.mutationListeners.clear();
      SimulationPayloadRegistry.instance.listeners.clear();
      SimulationPayloadRegistry.instance = null;
    }
  }

  /**
   * Subscribes a listener to registry cache mutations.
   * Returns an unsubscribe cleanup function.
   */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Subscribes a listener to rich registry mutation events.
   * Used by dedicated integration bridges (e.g. SimulationStoreBridge).
   */
  public addMutationListener(listener: RegistryMutationListener): () => void {
    this.mutationListeners.add(listener);
    return () => {
      this.mutationListeners.delete(listener);
    };
  }

  /**
   * Notifies all active subscribers that a cache mutation occurred.
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error("SimulationPayloadRegistry subscriber error:", err);
      }
    });
  }

  /**
   * Emits a rich mutation event to all registered mutation listeners.
   */
  private notifyMutationListeners(event: RegistryMutationEvent): void {
    this.mutationListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error("SimulationPayloadRegistry mutation listener error:", err);
      }
    });
  }

  /**
   * Internal helper to retrieve or initialize request token state for a scenario.
   */
  private getOrCreateTokenState(urn: ScenarioUrn): ScenarioTokenState {
    let state = this.tokenState.get(urn);
    if (!state) {
      state = {
        breakup: { generation: 0, token: null, issuedAtUtc: null },
        remediation: { generation: 0, token: null, issuedAtUtc: null },
      };
      this.tokenState.set(urn, state);
    }
    return state;
  }

  // ==========================================================================
  // Concurrency & Freshness Guard (DEF-634-1)
  // ==========================================================================

  /**
   * Begins a new asynchronous workflow request for the given scenario and workflow.
   * Increments the workflow's monotonic request generation and returns a unique request token.
   * Any previously issued request token for the same scenario and workflow is immediately invalidated.
   * Independent: A breakup request does not invalidate an outstanding remediation request.
   */
  public beginWorkflowRequest(
    urn: ScenarioUrn,
    workflow: SimulationWorkflowType
  ): string {
    if (!urn || !isScenarioUrn(urn)) {
      throw new TypeError(`Invalid ScenarioUrn: '${urn}'. Must follow canonical scenario format.`);
    }
    if (workflow !== "breakup" && workflow !== "remediation") {
      throw new TypeError(`Invalid workflow type: '${workflow}'. Expected 'breakup' or 'remediation'.`);
    }

    const state = this.getOrCreateTokenState(urn);
    const bucket = state[workflow];
    bucket.generation += 1;
    const now = new Date().toISOString();
    bucket.token = `req:${workflow}:${urn}:gen-${bucket.generation}:${generateUuid()}`;
    bucket.issuedAtUtc = now;
    return bucket.token;
  }

  /**
   * Checks whether a request token is still the active, authoritative generation
   * for the given scenario and workflow.
   * Returns false if the token is stale, unknown, superseded by a newer request,
   * invalidated, or if the scenario was deleted or reset.
   */
  public isWorkflowRequestCurrent(
    urn: ScenarioUrn,
    workflow: SimulationWorkflowType,
    requestToken: string
  ): boolean {
    if (!urn || !isScenarioUrn(urn) || !requestToken || typeof requestToken !== "string") {
      return false;
    }
    if (workflow !== "breakup" && workflow !== "remediation") {
      return false;
    }

    const state = this.tokenState.get(urn);
    if (!state) return false;
    const bucket = state[workflow];
    return bucket.token !== null && bucket.token === requestToken;
  }

  /**
   * Commits an asynchronous simulation result using its request token.
   * Rejects stale or superseded responses without modifying payloads or incrementing version.
   */
  public commitWorkflowResult(
    urn: ScenarioUrn,
    workflow: SimulationWorkflowType,
    requestToken: string,
    payload: BreakupResultPayload | RemediationResultPayload,
    isBenchmark = false
  ): WorkflowCommitResult {
    if (!urn || !isScenarioUrn(urn)) {
      return {
        success: false,
        error: `Invalid ScenarioUrn: '${urn}'.`,
      };
    }
    if (workflow !== "breakup" && workflow !== "remediation") {
      return {
        success: false,
        error: `Invalid workflow type '${workflow}'. Expected 'breakup' or 'remediation'.`,
      };
    }

    if (!this.isWorkflowRequestCurrent(urn, workflow, requestToken)) {
      return {
        success: false,
        isStale: true,
        error: `Stale or invalidated ${workflow} request token for '${urn}'. Commit rejected.`,
      };
    }

    if (workflow === "breakup") {
      if (!payload || payload.kind !== "BREAKUP_PROPAGATION") {
        return {
          success: false,
          error: `Invalid payload kind for breakup: expected 'BREAKUP_PROPAGATION', received '${payload?.kind}'.`,
        };
      }
      const record = this.setBreakupPayload(
        urn,
        payload as BreakupResultPayload,
        isBenchmark,
        requestToken
      );
      return { success: true, record };
    } else {
      if (!payload || payload.kind !== "CW_REMEDIATION") {
        return {
          success: false,
          error: `Invalid payload kind for remediation: expected 'CW_REMEDIATION', received '${payload?.kind}'.`,
        };
      }
      const record = this.setRemediationPayload(
        urn,
        payload as RemediationResultPayload,
        isBenchmark,
        requestToken
      );
      return { success: true, record };
    }
  }

  /**
   * Commits a composite simulation payload, verifying that BOTH source workflow tokens
   * are still active and authoritative.
   * If either source workflow has been superseded or invalidated, the commit is rejected
   * without modifying the scenario record.
   */
  public commitCompositePayload(
    urn: ScenarioUrn,
    breakupToken: string,
    remediationToken: string,
    payload: CompositeSimulationPayload,
    isBenchmark = false
  ): WorkflowCommitResult {
    if (!urn || !isScenarioUrn(urn)) {
      return {
        success: false,
        error: `Invalid ScenarioUrn: '${urn}'.`,
      };
    }

    if (!this.isWorkflowRequestCurrent(urn, "breakup", breakupToken)) {
      return {
        success: false,
        isStale: true,
        error: `Composite commit rejected: breakup request token is stale or invalidated.`,
      };
    }

    if (!this.isWorkflowRequestCurrent(urn, "remediation", remediationToken)) {
      return {
        success: false,
        isStale: true,
        error: `Composite commit rejected: remediation request token is stale or invalidated.`,
      };
    }

    if (!payload || payload.kind !== "COMPOSITE_BREAKUP_REMEDIATION") {
      return {
        success: false,
        error: `Invalid composite payload kind: expected 'COMPOSITE_BREAKUP_REMEDIATION', received '${payload?.kind}'.`,
      };
    }

    const record = this.setCompositePayload(urn, payload, isBenchmark);
    return { success: true, record };
  }

  // ==========================================================================
  // Record & Payload Accessors
  // ==========================================================================

  /**
   * Retrieves the full multi-workflow record for a scenario.
   * Returns undefined if the scenario is unknown, invalid, or expired.
   */
  public getRecord(urn: ScenarioUrn): ScenarioPayloadRecord | undefined {
    if (!urn || !isScenarioUrn(urn)) {
      return undefined;
    }
    return this.cache.get(urn);
  }

  /**
   * Checks whether a record exists for the given scenario URN.
   */
  public hasRecord(urn: ScenarioUrn): boolean {
    if (!urn || !isScenarioUrn(urn)) {
      return false;
    }
    return this.cache.has(urn);
  }

  /**
   * Retrieves the breakup simulation payload for a scenario.
   * Returns undefined if the scenario has no cached breakup results.
   */
  public getBreakupPayload(urn: ScenarioUrn): BreakupResultPayload | undefined {
    const record = this.getRecord(urn);
    return record?.breakupPayload ?? undefined;
  }

  /**
   * Retrieves the CW remediation payload for a scenario.
   * Returns undefined if the scenario has no cached remediation results.
   */
  public getRemediationPayload(urn: ScenarioUrn): RemediationResultPayload | undefined {
    const record = this.getRecord(urn);
    return record?.remediationPayload ?? undefined;
  }

  /**
   * Retrieves the linked composite simulation payload for a scenario.
   * Returns undefined if the scenario has no linked composite results.
   */
  public getCompositePayload(urn: ScenarioUrn): CompositeSimulationPayload | undefined {
    const record = this.getRecord(urn);
    return record?.compositePayload ?? undefined;
  }

  // ==========================================================================
  // Payload Mutators
  // ==========================================================================

  /**
   * Registers or updates a breakup simulation payload under the given scenario URN.
   * Non-destructive: preserves any existing remediation payload under the same scenario.
   * If requestToken is provided, asserts that it is currently active.
   * If requestToken is omitted, supersedes prior in-flight breakup requests.
   * Monotonically increments version for stale-result protection.
   */
  public setBreakupPayload(
    urn: ScenarioUrn,
    payload: BreakupResultPayload,
    isBenchmark = false,
    requestToken?: string
  ): ScenarioPayloadRecord {
    if (!urn || !isScenarioUrn(urn)) {
      throw new TypeError(`Invalid ScenarioUrn: '${urn}'. Must follow canonical scenario format.`);
    }
    if (!payload || payload.kind !== "BREAKUP_PROPAGATION") {
      throw new TypeError(
        `Invalid payload: expected kind 'BREAKUP_PROPAGATION', received '${payload?.kind}'.`
      );
    }

    if (requestToken !== undefined && !this.isWorkflowRequestCurrent(urn, "breakup", requestToken)) {
      throw new Error(`Cannot set breakup payload with stale or invalidated request token for '${urn}'.`);
    }

    // Direct synchronous writes without a token supersede any older in-flight request
    if (requestToken === undefined) {
      const state = this.getOrCreateTokenState(urn);
      state.breakup.generation += 1;
      state.breakup.token = null;
    }

    const now = new Date().toISOString();
    const existing = this.cache.get(urn);

    if (existing) {
      existing.breakupPayload = payload;
      existing.compositePayload = null; // Invalidate composite link since breakup changed
      existing.version += 1;
      existing.updatedAtUtc = now;
      if (isBenchmark) {
        existing.isBenchmarkFixture = true;
      }
      this.notifyMutationListeners({
        type: "UPSERT",
        scenarioUrn: urn,
        workflow: "breakup",
        record: existing,
      });
      this.notifyListeners();
      return existing;
    }

    const newRecord: ScenarioPayloadRecord = {
      scenarioUrn: urn,
      version: 1,
      createdAtUtc: now,
      updatedAtUtc: now,
      isBenchmarkFixture: isBenchmark,
      breakupPayload: payload,
      remediationPayload: null,
      compositePayload: null,
    };

    this.cache.set(urn, newRecord);
    this.notifyMutationListeners({
      type: "UPSERT",
      scenarioUrn: urn,
      workflow: "breakup",
      record: newRecord,
    });
    this.notifyListeners();
    return newRecord;
  }

  /**
   * Registers or updates a CW remediation payload under the given scenario URN.
   * Non-destructive: preserves any existing breakup debris cloud payload under the same scenario.
   * If requestToken is provided, asserts that it is currently active.
   * If requestToken is omitted, supersedes prior in-flight remediation requests.
   * Monotonically increments version for stale-result protection.
   */
  public setRemediationPayload(
    urn: ScenarioUrn,
    payload: RemediationResultPayload,
    isBenchmark = false,
    requestToken?: string
  ): ScenarioPayloadRecord {
    if (!urn || !isScenarioUrn(urn)) {
      throw new TypeError(`Invalid ScenarioUrn: '${urn}'. Must follow canonical scenario format.`);
    }
    if (!payload || payload.kind !== "CW_REMEDIATION") {
      throw new TypeError(
        `Invalid payload: expected kind 'CW_REMEDIATION', received '${payload?.kind}'.`
      );
    }

    if (requestToken !== undefined && !this.isWorkflowRequestCurrent(urn, "remediation", requestToken)) {
      throw new Error(`Cannot set remediation payload with stale or invalidated request token for '${urn}'.`);
    }

    // Direct synchronous writes without a token supersede any older in-flight request
    if (requestToken === undefined) {
      const state = this.getOrCreateTokenState(urn);
      state.remediation.generation += 1;
      state.remediation.token = null;
    }

    const now = new Date().toISOString();
    const existing = this.cache.get(urn);

    if (existing) {
      existing.remediationPayload = payload;
      existing.compositePayload = null; // Invalidate composite link since remediation changed
      existing.version += 1;
      existing.updatedAtUtc = now;
      if (isBenchmark) {
        existing.isBenchmarkFixture = true;
      }
      this.notifyMutationListeners({
        type: "UPSERT",
        scenarioUrn: urn,
        workflow: "remediation",
        record: existing,
      });
      this.notifyListeners();
      return existing;
    }

    const newRecord: ScenarioPayloadRecord = {
      scenarioUrn: urn,
      version: 1,
      createdAtUtc: now,
      updatedAtUtc: now,
      isBenchmarkFixture: isBenchmark,
      breakupPayload: null,
      remediationPayload: payload,
      compositePayload: null,
    };

    this.cache.set(urn, newRecord);
    this.notifyMutationListeners({
      type: "UPSERT",
      scenarioUrn: urn,
      workflow: "remediation",
      record: newRecord,
    });
    this.notifyListeners();
    return newRecord;
  }

  /**
   * Registers a linked composite breakup + remediation payload under the given scenario URN.
   * Automatically populates the individual breakupPayload and remediationPayload slots.
   */
  public setCompositePayload(
    urn: ScenarioUrn,
    payload: CompositeSimulationPayload,
    isBenchmark = false
  ): ScenarioPayloadRecord {
    if (!urn || !isScenarioUrn(urn)) {
      throw new TypeError(`Invalid ScenarioUrn: '${urn}'. Must follow canonical scenario format.`);
    }
    if (!payload || payload.kind !== "COMPOSITE_BREAKUP_REMEDIATION") {
      throw new TypeError(
        `Invalid payload: expected kind 'COMPOSITE_BREAKUP_REMEDIATION', received '${payload?.kind}'.`
      );
    }

    const now = new Date().toISOString();
    const existing = this.cache.get(urn);

    if (existing) {
      existing.breakupPayload = payload.breakupPayload;
      existing.remediationPayload = payload.remediationPayload;
      existing.compositePayload = payload;
      existing.version += 1;
      existing.updatedAtUtc = now;
      if (isBenchmark) {
        existing.isBenchmarkFixture = true;
      }
      this.notifyMutationListeners({
        type: "UPSERT",
        scenarioUrn: urn,
        workflow: "composite",
        record: existing,
      });
      this.notifyListeners();
      return existing;
    }

    const newRecord: ScenarioPayloadRecord = {
      scenarioUrn: urn,
      version: 1,
      createdAtUtc: now,
      updatedAtUtc: now,
      isBenchmarkFixture: isBenchmark,
      breakupPayload: payload.breakupPayload,
      remediationPayload: payload.remediationPayload,
      compositePayload: payload,
    };

    this.cache.set(urn, newRecord);
    this.notifyMutationListeners({
      type: "UPSERT",
      scenarioUrn: urn,
      workflow: "composite",
      record: newRecord,
    });
    this.notifyListeners();
    return newRecord;
  }

  /**
   * Invalidates a single workflow within a scenario independently.
   * - "breakup": Clears breakupPayload and compositePayload, leaving remediationPayload intact.
   *              Invalidates all outstanding breakup request tokens.
   * - "remediation": Clears remediationPayload and compositePayload, leaving breakupPayload intact.
   *                  Invalidates all outstanding remediation request tokens.
   * - "composite": Clears compositePayload only.
   * Monotonically increments version if modified.
   * Returns true if a payload was cleared, false if not found or already null.
   */
  public invalidateWorkflow(
    urn: ScenarioUrn,
    workflow: "breakup" | "remediation" | "composite"
  ): boolean {
    const record = this.cache.get(urn);
    const state = this.tokenState.get(urn);
    if (!record && !state) return false;

    let modified = false;
    const now = new Date().toISOString();

    if (workflow === "breakup") {
      if (record && (record.breakupPayload !== null || record.compositePayload !== null)) {
        record.breakupPayload = null;
        record.compositePayload = null;
        modified = true;
      }
      if (state && state.breakup.token !== null) {
        state.breakup.token = null;
        state.breakup.generation += 1;
        modified = true;
      }
    } else if (workflow === "remediation") {
      if (record && (record.remediationPayload !== null || record.compositePayload !== null)) {
        record.remediationPayload = null;
        record.compositePayload = null;
        modified = true;
      }
      if (state && state.remediation.token !== null) {
        state.remediation.token = null;
        state.remediation.generation += 1;
        modified = true;
      }
    } else if (workflow === "composite") {
      if (record && record.compositePayload !== null) {
        record.compositePayload = null;
        modified = true;
      }
    }

    if (record && modified) {
      record.version += 1;
      record.updatedAtUtc = now;
    }

    if (modified) {
      this.notifyMutationListeners({
        type: "INVALIDATE_WORKFLOW",
        scenarioUrn: urn,
        workflow,
        record: this.cache.get(urn),
      });
      this.notifyListeners();
    }

    return modified;
  }

  /**
   * Removes an entire scenario and all its associated payloads and active tokens from the registry.
   * Returns true if the scenario was deleted, false if it did not exist.
   */
  public deleteScenario(urn: ScenarioUrn): boolean {
    this.tokenState.delete(urn);
    const deleted = this.cache.delete(urn);
    if (deleted) {
      this.notifyMutationListeners({
        type: "DELETE_SCENARIO",
        scenarioUrn: urn,
      });
      this.notifyListeners();
    }
    return deleted;
  }

  /**
   * Clears dynamic scenarios while preserving version-controlled benchmark fixtures.
   */
  public clearDynamicScenarios(): void {
    const toDelete: ScenarioUrn[] = [];
    this.cache.forEach((record, urn) => {
      if (!record.isBenchmarkFixture) {
        toDelete.push(urn);
      }
    });
    toDelete.forEach((urn) => {
      this.cache.delete(urn);
      this.tokenState.delete(urn);
      this.notifyMutationListeners({
        type: "DELETE_SCENARIO",
        scenarioUrn: urn,
      });
    });
    if (toDelete.length > 0) {
      this.notifyListeners();
    }
  }

  /**
   * Completely clears the cache and all active request tokens.
   */
  public clearAll(): void {
    this.cache.clear();
    this.tokenState.clear();
    this.notifyMutationListeners({
      type: "CLEAR_ALL",
    });
    this.notifyListeners();
  }

  /**
   * Returns all currently cached ScenarioUrns.
   */
  public listScenarioUrns(): ScenarioUrn[] {
    const urns: ScenarioUrn[] = [];
    this.cache.forEach((_, urn) => {
      urns.push(urn);
    });
    return urns;
  }

  public getAllScenarioUrns(): ScenarioUrn[] {
    return this.listScenarioUrns();
  }

  /**
   * Preloads version-controlled benchmark fixtures into the registry.
   * Marks them with isBenchmarkFixture = true to protect against dynamic clearing.
   */
  public preloadBenchmarkFixtures(fixtures?: {
    cwFixture?: unknown;
    breakupFixture?: BreakupAndPropagateResponse;
  }): void {
    const cw = fixtures?.cwFixture ?? CANONICAL_CW_FIXTURE;
    const breakup = fixtures?.breakupFixture ?? DEMO_BREAKUP_RESPONSE;
    if (cw) {
      const payload = adaptCanonicalCwFixtureToPayload(cw);
      this.setRemediationPayload("scenario:canonical-cw-reference", payload, true);
    }
    if (breakup) {
      const payload = adaptBreakupResponseToPayload(breakup);
      this.setBreakupPayload("scenario:benchmark-iridium-cosmos", payload, true);
    }
    this.notifyMutationListeners({
      type: "PRELOAD_BENCHMARKS",
    });
    this.notifyListeners();
  }

  /**
   * Total number of scenarios currently cached in the registry.
   */
  public get size(): number {
    return this.cache.size;
  }
}
