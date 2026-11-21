"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  BreakupAndPropagateRequest,
  BreakupAndPropagateResponse,
  BreakupRemediationRequest,
  BreakupRemediationResponse,
} from "@/types/simulation";
import { ApiConnectionStatus, NavigationTab } from "@/types/orbital";
import type { ScenarioUrn } from "@/types/shared_state";
import { apiClient } from "@/lib/api";
import {
  DEMO_BREAKUP_RESPONSE,
  DEMO_REMEDIATION_RESPONSE,
  DEMO_INFEASIBLE_REMEDIATION_RESPONSE,
} from "@/data/simulationFixtures";
import {
  DEFAULT_COLLISION_SCENARIO,
  DEFAULT_RENDEZVOUS_CONFIG,
  BUDGET_INFEASIBLE_RENDEZVOUS_CONFIG,
} from "@/lib/simulation_presets";
import {
  SimulationPayloadRegistry,
  createDynamicScenarioUrn,
} from "@/lib/simulationPayloadRegistry";
import {
  adaptBreakupResponseToPayload,
  adaptRemediationResponseToPayload,
  payloadToRemediationResponse,
} from "@/lib/simulationAdapters";
import { SimulationCanvas } from "./SimulationCanvas";
import { BreakupSimulationForm } from "./BreakupSimulationForm";
import { RemediationPlannerForm } from "./RemediationPlannerForm";
import { BreakupResultsView } from "./BreakupResultsView";
import { RemediationResultsView } from "./RemediationResultsView";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import {
  Flame,
  Crosshair,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Layers,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";

export interface SimulationDashboardViewProps {
  apiStatus: ApiConnectionStatus;
  isDemoMode?: boolean;
  onNavigateTab?: (
    tab: NavigationTab,
    objectId?: string | null,
    subtab?: string | null,
    eventId?: string | null,
    scenarioId?: string | null
  ) => void;
  initialSubtab?: string | null;
  initialObjectId?: string | null;
  activeScenarioUrn?: ScenarioUrn | null;
  initialScenarioId?: ScenarioUrn | string | null;
}

export type SimulationTab = "breakup" | "remediation";

export const SimulationDashboardView: React.FC<SimulationDashboardViewProps> = ({
  apiStatus,
  isDemoMode = false,
  onNavigateTab,
  initialSubtab,
  initialObjectId,
  activeScenarioUrn = null,
  initialScenarioId,
}) => {
  // Pure reactive projection of canonical scenario identity from prop.
  // Avoid duplicate local state (useState) to ensure strict single source of truth.
  const currentScenarioUrn: ScenarioUrn | null = useMemo(() => {
    if (activeScenarioUrn) return activeScenarioUrn;
    if (
      initialScenarioId &&
      typeof initialScenarioId === "string" &&
      initialScenarioId.trim().length > 0
    ) {
      return initialScenarioId as ScenarioUrn;
    }
    return null;
  }, [activeScenarioUrn, initialScenarioId]);

  // Registry singleton and subscription tick for reactive Tier 3 cache binding
  const registry = useMemo(() => SimulationPayloadRegistry.getInstance(), []);
  const [registryTick, setRegistryTick] = useState<number>(0);

  useEffect(() => {
    return registry.subscribe(() => {
      setRegistryTick((t) => t + 1);
    });
  }, [registry]);

  // Preload version-controlled benchmark fixtures if active scenario references a known benchmark
  useEffect(() => {
    if (
      (currentScenarioUrn === "scenario:canonical-cw-reference" ||
        currentScenarioUrn === "scenario:benchmark-iridium-cosmos") &&
      !registry.hasRecord(currentScenarioUrn)
    ) {
      registry.preloadBenchmarkFixtures();
    }
  }, [currentScenarioUrn, registry]);

  // Active subtab state
  const [activeTab, setActiveTab] = useState<SimulationTab>(() => {
    if (initialSubtab === "remediation") return "remediation";
    if (initialSubtab === "breakup") return "breakup";
    if (currentScenarioUrn === "scenario:canonical-cw-reference") return "remediation";
    return "breakup";
  });

  // Automatically route pure CW benchmark to remediation subtab if subtab was omitted
  useEffect(() => {
    if (
      currentScenarioUrn === "scenario:canonical-cw-reference" &&
      !initialSubtab &&
      activeTab !== "remediation"
    ) {
      setActiveTab("remediation");
    }
  }, [currentScenarioUrn, initialSubtab, activeTab]);

  // Synchronize incoming subtab prop
  useEffect(() => {
    if (initialSubtab === "breakup" || initialSubtab === "remediation") {
      setActiveTab(initialSubtab);
    }
  }, [initialSubtab]);

  // Synchronize incoming URL search params if in browser
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const sub = params.get("subtab");
      if (sub === "breakup" || sub === "remediation") {
        setActiveTab(sub);
      }
      const bMode = params.get("breakupMode");
      if (bMode === "before" || bMode === "after") {
        setBreakupModeParam(bMode);
      }
      const vScale = params.get("viewScale");
      if (vScale === "global" || vScale === "local") {
        setViewScaleParam(vScale);
      }
    }
  }, []);

  // Resolve active scenario record from Tier 3 registry
  const activeRecord = useMemo(() => {
    // Reference registryTick so reactive cache mutations trigger recalculation
    if (!currentScenarioUrn || registryTick < 0) return undefined;
    // Idempotent preload safeguard
    if (
      (currentScenarioUrn === "scenario:canonical-cw-reference" ||
        currentScenarioUrn === "scenario:benchmark-iridium-cosmos") &&
      !registry.hasRecord(currentScenarioUrn)
    ) {
      registry.preloadBenchmarkFixtures();
    }
    return registry.getRecord(currentScenarioUrn);
  }, [currentScenarioUrn, registryTick, registry]);

  // Authoritative Breakup Response: derived strictly from resolved registry payload
  const breakupResponse: BreakupAndPropagateResponse | null = useMemo(() => {
    if (activeRecord) {
      return activeRecord.breakupPayload?.breakupResponse ?? null;
    }
    return null;
  }, [activeRecord]);

  // Authoritative Remediation Response: derived strictly from resolved registry payload
  const remediationResponse: BreakupRemediationResponse | null = useMemo(() => {
    if (activeRecord?.remediationPayload) {
      return payloadToRemediationResponse(activeRecord.remediationPayload);
    }
    return null;
  }, [activeRecord]);

  // UI state for transient form interaction & execution progress
  const [isSimulatingBreakup, setIsSimulatingBreakup] = useState<boolean>(false);
  const [breakupError, setBreakupError] = useState<string | null>(null);
  const [selectedFragmentId, setSelectedFragmentId] = useState<string | null>(
    initialObjectId || null
  );
  const [breakupModeParam, setBreakupModeParam] = useState<"before" | "after">("after");
  const [viewScaleParam, setViewScaleParam] = useState<"global" | "local">("global");

  const [remediationBudgetMs, setRemediationBudgetMs] = useState<number | undefined>(
    isDemoMode ? DEFAULT_RENDEZVOUS_CONFIG.delta_v_budget_max_ms : undefined
  );
  const [isPlanningRemediation, setIsPlanningRemediation] = useState<boolean>(false);
  const [remediationError, setRemediationError] = useState<string | null>(null);

  // Provenance flag
  const [isUsingDemoData, setIsUsingDemoData] = useState<boolean>(isDemoMode);

  useEffect(() => {
    if (initialObjectId) {
      setSelectedFragmentId(initialObjectId);
    }
  }, [initialObjectId]);

  // Automatically select first fragment when breakup response resolves
  useEffect(() => {
    if (breakupResponse?.fragmentation?.fragments && breakupResponse.fragmentation.fragments.length > 0) {
      if (!selectedFragmentId) {
        setSelectedFragmentId(breakupResponse.fragmentation.fragments[0].fragment_id);
      }
    }
  }, [breakupResponse, selectedFragmentId]);

  // Derive targeted fragment for CW remediation planning
  const targetedFragment = useMemo(() => {
    if (selectedFragmentId && breakupResponse?.fragmentation?.fragments) {
      const match = breakupResponse.fragmentation.fragments.find(
        (f) => f.fragment_id === selectedFragmentId
      );
      if (match) return match;
    }
    if (remediationResponse?.selected_target) {
      return remediationResponse.selected_target;
    }
    return null;
  }, [selectedFragmentId, breakupResponse, remediationResponse]);

  // Load Demo Benchmark Handler
  const handleLoadDemo = useCallback(() => {
    registry.preloadBenchmarkFixtures();
    if (onNavigateTab) {
      onNavigateTab(
        "simulation",
        null,
        "remediation",
        null,
        "scenario:canonical-cw-reference"
      );
    } else {
      setActiveTab("remediation");
      setRemediationBudgetMs(DEFAULT_RENDEZVOUS_CONFIG.delta_v_budget_max_ms);
      setIsUsingDemoData(true);
    }
    setBreakupError(null);
    setRemediationError(null);
  }, [registry, onNavigateTab]);

  // Handle direct transfer of selected fragment to Pillar 05 Remediation Planner
  const handlePlanRemediation = useCallback(
    (fragmentId: string) => {
      setSelectedFragmentId(fragmentId);
      setActiveTab("remediation");
      onNavigateTab?.(
        "simulation",
        fragmentId,
        "remediation",
        null,
        currentScenarioUrn
      );
    },
    [currentScenarioUrn, onNavigateTab]
  );

  // Handle Breakup Simulation Submission with DEF-634-1 Request-Generation Guard
  const handleBreakupSubmit = useCallback(
    async (request: BreakupAndPropagateRequest) => {
      setIsSimulatingBreakup(true);
      setBreakupError(null);

      // Target scenario URN: reuse current if dynamic, or generate fresh collision-resistant UUID
      const targetUrn: ScenarioUrn =
        currentScenarioUrn && currentScenarioUrn.startsWith("scenario:SIM-")
          ? currentScenarioUrn
          : createDynamicScenarioUrn();

      const requestToken = registry.beginWorkflowRequest(targetUrn, "breakup");

      // If user is explicitly in demo mode and backend is offline, simulate using precomputed fixture
      if (isDemoMode && !apiStatus.connected) {
        setTimeout(() => {
          const payload = adaptBreakupResponseToPayload(DEMO_BREAKUP_RESPONSE);
          const commit = registry.commitWorkflowResult(targetUrn, "breakup", requestToken, payload);
          if (commit.success) {
            setIsUsingDemoData(true);
            if (payload.fragments.length > 0) {
              setSelectedFragmentId(payload.fragments[0].fragment_id);
            }
            onNavigateTab?.("simulation", null, "breakup", null, targetUrn);
          }
          setIsSimulatingBreakup(false);
        }, 500);
        return;
      }

      try {
        const response = await apiClient.simulateBreakupAndPropagate(request, 30000);
        const payload = adaptBreakupResponseToPayload(response);
        const commit = registry.commitWorkflowResult(targetUrn, "breakup", requestToken, payload);
        if (commit.success) {
          setIsUsingDemoData(false);
          if (payload.fragments.length > 0) {
            setSelectedFragmentId(payload.fragments[0].fragment_id);
          }
          onNavigateTab?.("simulation", null, "breakup", null, targetUrn);
        } else if (commit.isStale) {
          console.warn(`[DEF-634-1] Discarding stale breakup simulation result for ${targetUrn}`);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Synthetic breakup simulation failed unexpectedly.";
        setBreakupError(message);
      } finally {
        setIsSimulatingBreakup(false);
      }
    },
    [currentScenarioUrn, registry, isDemoMode, apiStatus.connected, onNavigateTab]
  );

  // Handle Remediation Planning Submission with DEF-634-1 Request-Generation Guard
  const handleRemediationSubmit = useCallback(
    async (request: BreakupRemediationRequest) => {
      setIsPlanningRemediation(true);
      setRemediationError(null);

      const targetUrn: ScenarioUrn =
        currentScenarioUrn && currentScenarioUrn.startsWith("scenario:SIM-")
          ? currentScenarioUrn
          : createDynamicScenarioUrn();

      const requestToken = registry.beginWorkflowRequest(targetUrn, "remediation");

      // If in demo mode and offline, return the appropriate demo fixture based on budget
      if (isDemoMode && !apiStatus.connected) {
        setTimeout(() => {
          const isBudgetLow =
            (request.rendezvous_config?.delta_v_budget_max_ms ?? 25.0) < 0.01;
          const fixture = isBudgetLow
            ? DEMO_INFEASIBLE_REMEDIATION_RESPONSE
            : DEMO_REMEDIATION_RESPONSE;
          const payload = adaptRemediationResponseToPayload(fixture);
          const commit = registry.commitWorkflowResult(targetUrn, "remediation", requestToken, payload);
          if (commit.success) {
            const configuredBudget =
              request.rendezvous_config?.delta_v_budget_max_ms !== undefined
                ? request.rendezvous_config.delta_v_budget_max_ms
                : isBudgetLow
                ? BUDGET_INFEASIBLE_RENDEZVOUS_CONFIG.delta_v_budget_max_ms
                : DEFAULT_RENDEZVOUS_CONFIG.delta_v_budget_max_ms;
            setRemediationBudgetMs(configuredBudget);
            setSelectedFragmentId(fixture.selected_target.fragment_id);
            setIsUsingDemoData(true);
            onNavigateTab?.(
              "simulation",
              fixture.selected_target.fragment_id,
              "remediation",
              null,
              targetUrn
            );
          }
          setIsPlanningRemediation(false);
        }, 500);
        return;
      }

      try {
        const response = await apiClient.planBreakupRemediation(request, 30000);
        const payload = adaptRemediationResponseToPayload(response);
        const commit = registry.commitWorkflowResult(targetUrn, "remediation", requestToken, payload);
        if (commit.success) {
          setRemediationBudgetMs(request.rendezvous_config?.delta_v_budget_max_ms);
          setIsUsingDemoData(false);
          setSelectedFragmentId(response.selected_target.fragment_id);
          onNavigateTab?.(
            "simulation",
            response.selected_target.fragment_id,
            "remediation",
            null,
            targetUrn
          );
        } else if (commit.isStale) {
          console.warn(`[DEF-634-1] Discarding stale remediation result for ${targetUrn}`);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Clohessy-Wiltshire remediation planning failed unexpectedly.";
        setRemediationError(message);
      } finally {
        setIsPlanningRemediation(false);
      }
    },
    [currentScenarioUrn, registry, isDemoMode, apiStatus.connected, onNavigateTab]
  );

  // Active scenario for pre-breakup orbital visualization
  const activeScenario = useMemo(
    () => breakupResponse?.fragmentation?.scenario || DEFAULT_COLLISION_SCENARIO,
    [breakupResponse?.fragmentation?.scenario]
  );

  return (
    <div className="space-y-6">
      {/* Navigation & Status Header */}
      <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-4 border-b border-space-border pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg xl:text-xl font-bold font-mono tracking-tight text-slate-100 uppercase whitespace-nowrap">
              COLLIVRA Debris Evolution & Remediation Laboratory
            </h1>
            <Badge variant="cyan" size="sm" className="font-mono font-bold">
              PILLAR 04
            </Badge>
            <Badge variant="outline" size="sm" className="font-mono text-cyan border-cyan/40">
              RESEARCH PROTOTYPE
            </Badge>
            <Badge variant="outline" size="sm" className="font-mono text-slate-300 border-slate-700">
              COWELL DOP853 + J2
            </Badge>
            <Badge variant="outline" size="sm" className="font-mono text-slate-300 border-slate-700">
              CW (e &le; 0.005)
            </Badge>
            {isUsingDemoData && !activeRecord?.isBenchmarkFixture && (
              <Badge variant="amber" size="sm">
                DEMO SCENARIO
              </Badge>
            )}
            {activeRecord?.isBenchmarkFixture && (
              <Badge variant="cyan" size="sm" data-testid="benchmark-badge">
                BENCHMARK FIXTURE
              </Badge>
            )}
            {currentScenarioUrn && (
              <Badge
                variant="outline"
                size="sm"
                className="font-mono text-cyan border-cyan/40"
                data-testid="active-scenario-badge"
              >
                SCENARIO: {currentScenarioUrn}
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1 font-mono">
            Synthetic breakup fragmentation, DOP853 Cowell numerical propagation, and Clohessy-Wiltshire rendezvous planning
          </p>
        </div>

        {/* Right Action Bar: Demo Preset + Workflow Tab Selector */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleLoadDemo}
            className="text-xs font-mono text-cyan border-cyan/40 hover:bg-cyan/10 gap-1.5"
            title="Load calibrated synthetic breakup & remediation scenario"
          >
            <Sparkles className="h-3.5 w-3.5 text-cyan" />
            <span>Load Demo Scenario</span>
          </Button>

          {/* Workflow Tab Selector */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-space-dark border border-space-border self-start sm:self-auto font-mono text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("breakup")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                activeTab === "breakup"
                  ? "bg-cyan text-space-bg shadow-glow-cyan"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Flame className="h-3.5 w-3.5" />
              Breakup & Propagation
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("remediation")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                activeTab === "remediation"
                  ? "bg-cyan text-space-bg shadow-glow-cyan"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Crosshair className="h-3.5 w-3.5" />
              CW Remediation
            </button>
          </div>
        </div>
      </div>

      {/* Backend API Connection Warning */}
      {!apiStatus.connected && (
        <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-600/40 text-amber-300 text-xs font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Backend API is currently disconnected ({apiClient.getBaseUrl()}). Use &quot;Load Demo Scenario&quot; to inspect precomputed simulation and remediation scenarios offline.
            </span>
          </div>
          <Badge variant="amber" size="sm">
            OFFLINE
          </Badge>
        </div>
      )}

      {/* Explicit Missing / Expired Scenario Notice Card */}
      {currentScenarioUrn && !activeRecord && (
        <div
          data-testid="scenario-unavailable-card"
          className="p-6 rounded-2xl bg-amber-950/20 border border-amber-600/40 text-slate-200 font-mono space-y-4 shadow-panel"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-amber-300 uppercase tracking-wide">
                [SCENARIO PAYLOAD UNAVAILABLE OR EXPIRED]
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                No in-memory simulation payload was found for active scenario{" "}
                <span className="text-amber-200 font-semibold">{currentScenarioUrn}</span>.
                In accordance with COLLIVRA&apos;s Tier 3 architecture, heavy numerical trajectories and fragment matrices
                reside in client heap memory and do not persist across hard reloads unless recomputed.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                registry.preloadBenchmarkFixtures();
                onNavigateTab?.(
                  "simulation",
                  null,
                  "remediation",
                  null,
                  "scenario:canonical-cw-reference"
                );
              }}
              className="text-xs font-mono text-cyan border-cyan/40 hover:bg-cyan/10"
            >
              Load Canonical CW Benchmark
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                registry.preloadBenchmarkFixtures();
                onNavigateTab?.(
                  "simulation",
                  null,
                  "breakup",
                  null,
                  "scenario:benchmark-iridium-cosmos"
                );
              }}
              className="text-xs font-mono text-cyan border-cyan/40 hover:bg-cyan/10"
            >
              Load Iridium-Cosmos Breakup Benchmark
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onNavigateTab?.("simulation", null, "breakup", null, null);
              }}
              className="text-xs font-mono text-slate-300 border-slate-700 hover:bg-slate-800"
            >
              Create New Simulation
            </Button>
          </div>
        </div>
      )}

      {/* Breakup Workflow Tab */}
      {activeTab === "breakup" && (
        <div className="space-y-6">
          {/* Pure CW Benchmark Notice in Breakup Subtab */}
          {currentScenarioUrn === "scenario:canonical-cw-reference" && (
            <div
              data-testid="pure-cw-notice-card"
              className="p-5 rounded-2xl bg-cyan-950/20 border border-cyan-500/40 text-slate-200 font-mono space-y-3"
            >
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-cyan shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-cyan uppercase tracking-wide">
                    [CLOHESSY-WILTSHIRE RENDEZVOUS BENCHMARK]
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    This scenario is a canonical Clohessy-Wiltshire (CW) rendezvous benchmark representing Active Debris Removal (ADR)
                    guidance in a near-circular chief orbit (e &le; 0.005). It does not contain collision fragmentation data or colliding parent bodies.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setActiveTab("remediation")}
                  className="text-xs font-mono bg-cyan text-space-bg hover:bg-cyan/90 font-bold"
                >
                  Go to CW Remediation Solution
                </Button>
              </div>
            </div>
          )}

          {/* Active Error Alert */}
          {breakupError && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 text-xs font-mono flex items-start justify-between gap-3 shadow-panel">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-bold text-rose-300 uppercase block">
                    [BREAKUP SIMULATION FAILED]
                  </span>
                  <p className="leading-relaxed">{breakupError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBreakupError(null)}
                className="px-2 py-1 text-slate-400 hover:text-slate-200 font-bold shrink-0"
              >
                DISMISS
              </button>
            </div>
          )}

          {/* Form & 3D Visualization Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <div className="lg:col-span-5">
              <BreakupSimulationForm
                isLoading={isSimulatingBreakup}
                onSubmit={handleBreakupSubmit}
              />
            </div>

            <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
              <SimulationCanvas
                trajectories={breakupResponse?.trajectories.trajectories || []}
                fragments={breakupResponse?.fragmentation.fragments || []}
                selectedFragmentId={selectedFragmentId}
                onSelectFragment={(id) => setSelectedFragmentId(id)}
                scenario={activeScenario}
                initialBreakupMode={breakupModeParam}
                initialViewScale={viewScaleParam}
                className="w-full h-[380px] xl:h-[440px] 2xl:h-[540px]"
              />

              {/* Integrated Simulation Environment Summary Banner */}
              <div className="p-3.5 rounded-xl border border-space-border/80 bg-space-surface/90 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-cyan shadow-[0_0_8px_#06b6d4]" />
                  <span className="text-slate-300 font-bold">SOLVER:</span>
                  <span className="text-cyan font-semibold">Cowell DOP853 + Earth J2</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-slate-400">GCRS Frame</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-400">
                  <span>Knot Guardrail: <strong className="text-slate-200">&le; 60s</strong></span>
                  <span>•</span>
                  <span>Re-entry: <strong className="text-amber-400">6,478.1 km</strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* Results View */}
          {breakupResponse && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold font-mono text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <Layers className="h-4 w-4 text-cyan" />
                  Breakup Fragmentation & Propagation Results
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab("remediation")}
                  className="text-xs font-mono text-cyan border-cyan/40 hover:bg-cyan/10 gap-1.5"
                >
                  <span>Plan Remediation for Selected Fragment</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>

              <BreakupResultsView
                response={breakupResponse}
                selectedFragmentId={selectedFragmentId}
                onSelectFragment={(id) => setSelectedFragmentId(id)}
                isDemo={isUsingDemoData}
                scenarioUrn={currentScenarioUrn}
                onPlanRemediation={handlePlanRemediation}
              />
            </div>
          )}
        </div>
      )}

      {/* Remediation Workflow Tab */}
      {activeTab === "remediation" && (
        <div className="space-y-6">
          {/* Remediation Not Yet Planned Notice for Breakup-Only Scenarios */}
          {activeRecord && !activeRecord.remediationPayload && (
            <div
              data-testid="remediation-not-computed-card"
              className="p-5 rounded-2xl bg-slate-900/40 border border-space-border text-slate-200 font-mono space-y-3"
            >
              <div className="flex items-start gap-3">
                <Crosshair className="h-5 w-5 text-cyan shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wide">
                    [REMEDIATION PLAN NOT YET COMPUTED]
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    No rendezvous remediation plan has been computed for this breakup scenario yet.
                    Select a debris fragment from the Breakup results tab and submit the Remediation Planner form to compute an impulse burn solution.
                  </p>
                </div>
              </div>
              {breakupResponse && (
                <div className="flex items-center gap-3 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setActiveTab("breakup")}
                    className="text-xs font-mono bg-cyan text-space-bg hover:bg-cyan/90 font-bold"
                  >
                    View Breakup Results & Select Target
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Active Error Alert */}
          {remediationError && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 text-xs font-mono flex items-start justify-between gap-3 shadow-panel">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-bold text-rose-300 uppercase block">
                    [REMEDIATION PLANNING FAILED]
                  </span>
                  <p className="leading-relaxed">{remediationError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRemediationError(null)}
                className="px-2 py-1 text-slate-400 hover:text-slate-200 font-bold shrink-0"
              >
                DISMISS
              </button>
            </div>
          )}

          {/* Form & 3D Visualization Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <div className="lg:col-span-5">
              <RemediationPlannerForm
                isLoading={isPlanningRemediation}
                onSubmit={handleRemediationSubmit}
                targetedFragment={targetedFragment}
                initialObjectId={initialObjectId}
              />
            </div>

            <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
              <SimulationCanvas
                contract={remediationResponse?.contract || null}
                rendezvousResult={remediationResponse?.rendezvous || null}
                selectedFragmentId={selectedFragmentId}
                onSelectFragment={(id) => setSelectedFragmentId(id)}
                showChaser={true}
                scenario={activeScenario}
                initialViewScale={viewScaleParam}
                className="w-full h-[380px] xl:h-[440px] 2xl:h-[540px]"
              />

              {/* Integrated Remediation Solver Summary Banner */}
              <div className="p-3.5 rounded-xl border border-space-border/80 bg-space-surface/90 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-cyan shadow-[0_0_8px_#06b6d4]" />
                  <span className="text-slate-300 font-bold">SOLVER:</span>
                  <span className="text-cyan font-semibold">Clohessy-Wiltshire (CW) 2-Impulse</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-slate-400">Hill (RIC) Frame</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-400">
                  <span>Precondition: <strong className="text-slate-200">e &le; 0.005</strong></span>
                  <span>•</span>
                  <span>2-Impulse BVP (Discrete arc knots not computed)</span>
                  <span>•</span>
                  <span>Transfer: 120s (t₀ &rarr; t_f)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Remediation Results View */}
          {remediationResponse && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold font-mono text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Crosshair className="h-4 w-4 text-cyan" />
                Clohessy-Wiltshire Impulsive Burn Solution
              </h3>
              <RemediationResultsView
                response={remediationResponse}
                isDemo={isUsingDemoData}
                deltaVBudgetMs={remediationBudgetMs}
                scenarioUrn={currentScenarioUrn}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
