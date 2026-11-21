"use client";

import React, { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  Orbit,
  ShieldAlert,
  Flame,
  Radio,
  ArrowRight,
  Globe,
  RefreshCw,
  Clock,
  Cpu,
  Layers,
  Crosshair,
  Play,
  Sparkles,
  Route,
  CheckCircle2,
  Compass,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { MetricCard } from "../ui/MetricCard";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DisclaimerBanner } from "../ui/DisclaimerBanner";
import { EmptyState } from "../ui/EmptyState";
import { NavigationTab, ApiConnectionStatus } from "../../types/orbital";
import { useMissionDashboard } from "../../hooks/useMissionDashboard";
import { resolveToCanonicalUrn } from "../../lib/urn";
import { useZorbitStore } from "../../store/useZorbitStore";
import {
  COLLIVRA_WORKFLOW_STEPS,
  CANONICAL_DEMO_SCENARIOS,
  INDIAN_SPACE_CONSTELLATIONS,
  ISRO_IS4OM_SPECIFICATION,
} from "../../lib/workflow";

// Lazy-load 3D WebGL Canvas to prevent SSR hydration mismatch and ensure clean static prerendering
const EarthPreviewCanvas = dynamic(
  () =>
    import("../visualization/EarthPreviewCanvas").then(
      (mod) => mod.EarthPreviewCanvas
    ),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[360px] rounded-xl border border-space-border/80 bg-space-bg flex flex-col items-center justify-center space-y-3 relative overflow-hidden">
        <div className="h-10 w-10 rounded-full border-2 border-cyan/40 border-t-cyan animate-spin" />
        <span className="font-mono text-xs text-slate-400 uppercase tracking-wider">
          Initializing 3D WebGL Canvas...
        </span>
      </div>
    ),
  }
);

export interface MissionDashboardViewProps {
  onNavigateTab: (
    tab: NavigationTab,
    objectId?: string | null,
    subtab?: string | null,
    eventId?: string | null,
    scenarioId?: string | null
  ) => void;
  apiStatus: ApiConnectionStatus;
  isDemoMode: boolean;
}

export const MissionDashboardView: React.FC<MissionDashboardViewProps> = ({
  onNavigateTab,
  apiStatus,
  isDemoMode,
}) => {
  const {
    metrics,
    conjunctions,
    isLoading,
    isRefreshing,
    lastRefreshed,
    error,
    refresh,
  } = useMissionDashboard(isDemoMode, apiStatus);

  // Live UTC ticker
  const [currentUtc, setCurrentUtc] = useState<string>("");

  // Synchronized Global Simulation Clock
  const simEpochMs = useZorbitStore((s) => s.currentEpochMs);
  const simIsPlaying = useZorbitStore((s) => s.isPlaying);
  const simPlaybackSpeed = useZorbitStore((s) => s.playbackSpeed);

  const simTimeIso = useMemo(() => {
    return new Date(simEpochMs).toISOString().replace("T", " ").substring(0, 19) + " UTC";
  }, [simEpochMs]);

  // Tier 2 lightweight scenario summaries (synchronized via SimulationStoreBridge)
  const scenarioSummaries = useZorbitStore((s) => s.scenarioSummaries);
  const activeSummaries = useMemo(() => Object.values(scenarioSummaries), [scenarioSummaries]);
  const activeScenarioCount = activeSummaries.length;
  const totalSimulatedFragments = useMemo(
    () => activeSummaries.reduce((sum, s) => sum + s.fragmentCount, 0),
    [activeSummaries]
  );

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentUtc(now.toISOString().replace("T", " ").substring(0, 19) + " UTC");
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Scientific Disclaimer Banner (Rule 3.1 & Rule 3.2 Guardrails) */}
      <DisclaimerBanner
        variant="info"
        title="SCIENTIFIC DISCLOSURE — HEURISTIC TRIAGE CONVENTIONS"
        disclaimer="COLLIVRA provides decision-support orbital intelligence. In accordance with project scientific rules (AGENTS.md), heuristic risk scores [0.0 - 100.0] represent analytical close-approach triage indices, NOT formal probability of collision (Pc). Public TLE/OMM elements do not provide calibrated covariance matrices."
      />

      {/* Mission Overview Telemetry Header */}
      <Card className="p-4 bg-space-surface border-space-border/80">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-lg bg-cyan/10 border border-cyan/30 flex items-center justify-center">
              <Radio className="h-5 w-5 text-cyan animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-heading font-bold text-sm tracking-wide text-white whitespace-nowrap">
                  COLLIVRA MISSION CONTROL
                </span>
                <Badge
                  variant={isDemoMode ? "warning" : "success"}
                  size="sm"
                  pulseDot
                  className="shrink-0"
                >
                  {isDemoMode ? "OFFLINE FIXTURE (DEGRADED)" : "LIVE SGP4 ACTIVE"}
                </Badge>
              </div>
              <p className="text-xs text-slate-400 font-mono flex items-center gap-2 mt-0.5 min-w-0">
                <span className="shrink-0">{metrics.dataSourceLabel}</span>
                <span className="shrink-0">•</span>
                <span className="truncate max-w-sm xl:max-w-xl">{metrics.provenanceNote}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 shrink-0 text-xs font-mono">
            {/* Simulation Clock Sync Pill */}
            <div className="flex items-center gap-1.5 text-slate-300 bg-space-panel/60 px-2.5 py-1.5 rounded border border-space-border/60 shrink-0" title="Synchronized Global Simulation Epoch">
              <Orbit className="h-3.5 w-3.5 text-cyan shrink-0 animate-spin" />
              <span className="whitespace-nowrap font-bold text-cyan">
                SIM: {simTimeIso} ({simPlaybackSpeed}x)
              </span>
            </div>

            {/* Live Wall UTC Clock */}
            <div className="flex items-center gap-1.5 text-slate-400 bg-space-panel/60 px-2.5 py-1.5 rounded border border-space-border/60 shrink-0" title="Host System Wall Clock (UTC)">
              <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="whitespace-nowrap">WALL: {currentUtc || "SYNCING..."}</span>
            </div>

            {/* Connection Status Pill */}
            <div className="flex items-center gap-1.5 text-slate-300 bg-space-panel/60 px-2.5 py-1.5 rounded border border-space-border/60 shrink-0">
              <Cpu className="h-3.5 w-3.5 text-blue shrink-0" />
              <span className="whitespace-nowrap">
                {apiStatus.connected
                  ? `NODE ONLINE (${apiStatus.latencyMs || 0}ms)`
                  : "STANDALONE"}
              </span>
            </div>

            {/* Refresh Button */}
            <Button
              size="sm"
              variant="secondary"
              onClick={refresh}
              disabled={isRefreshing || isLoading}
              className="gap-1.5 shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${isRefreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">REFRESH</span>
            </Button>
          </div>
        </div>

        {/* Warning banner if live fetch had an error and fell back */}
        {error && (
          <div className="mt-3 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono flex items-center justify-between">
            <span>{error}</span>
          </div>
        )}
      </Card>

      {/* End-to-End SSA Operational Workflow Ribbon */}
      <Card className="p-4 bg-space-surface border-space-border/80 shadow-panel space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-space-border/60 pb-2.5">
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-cyan" />
            <h3 className="font-heading font-bold text-xs uppercase tracking-wider text-slate-200">
              Unified SSA Operational Workflow Pipeline
            </h3>
            <Badge variant="cyan" size="sm">
              7 STEPS
            </Badge>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Click any step to transition directly between pillars
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {COLLIVRA_WORKFLOW_STEPS.map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => onNavigateTab(step.tab, null, step.subtab || null)}
              className="p-2.5 rounded-lg border border-space-border/80 bg-space-panel/40 hover:bg-space-panel hover:border-cyan/50 text-left transition-all cursor-pointer group flex flex-col justify-between"
              title={`${step.name} (Pillar ${step.pillarNumber}): ${step.operationalOutcome}`}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="font-mono text-[10px] font-bold text-cyan group-hover:underline">
                  Step 0{step.stepNumber}
                </span>
                <span className="text-[9px] font-mono px-1 py-0.2 rounded border border-space-border/80 text-slate-400">
                  P{step.pillarNumber}
                </span>
              </div>
              <div className="font-sans text-xs font-semibold text-slate-200 group-hover:text-cyan truncate">
                {step.name.split(" ")[0]}
              </div>
              <div className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                {step.shortLabel.replace(/^\d+\s*/, "")}
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Threat Intelligence KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
        <MetricCard
          label="Objects Screened"
          value={metrics.objectsScreened.toString()}
          sublabel={isDemoMode ? "Benchmark Stations Snapshot" : "Active Ingested Ephemerides"}
          icon={<Globe className="h-5 w-5 text-cyan" />}
          variant="cyan"
          className="h-full"
          onClick={() => onNavigateTab("radar")}
        />
        <MetricCard
          label="Conjunction Events"
          value={metrics.conjunctionsDetected.toString()}
          sublabel="Multi-stage SGP4 Screen (<= 50 km)"
          icon={<Orbit className="h-5 w-5 text-blue" />}
          variant="blue"
          className="h-full"
          onClick={() => onNavigateTab("conjunctions")}
        />
        <MetricCard
          label="High-Risk Encounters"
          value={metrics.highRiskCount.toString()}
          sublabel="Miss Distance <= 5.0 km in GCRS"
          icon={<ShieldAlert className="h-5 w-5 text-rose-400" />}
          variant="rose"
          className="h-full"
          onClick={() => onNavigateTab("conjunctions")}
        />
        <MetricCard
          label="Synthetic Scenarios"
          value={
            activeScenarioCount > 0
              ? `${activeScenarioCount} Registered`
              : metrics.syntheticScenariosDisplay
          }
          sublabel={
            activeScenarioCount > 0
              ? `${totalSimulatedFragments} tracked synthetic fragments`
              : metrics.syntheticScenariosCount > 0
              ? "520 synthetic breakup fragments"
              : "No custom scenario loaded"
          }
          icon={<Flame className="h-5 w-5 text-amber-400" />}
          variant="amber"
          className="h-full"
          onClick={() => onNavigateTab("simulation", null, "breakup")}
        />
      </div>

      {/* Canonical Benchmark Quick Launch Bar */}
      <div className="p-3 rounded-lg border border-cyan/30 bg-cyan-950/20 text-xs font-mono flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-panel">
        <div className="flex items-center gap-2 text-cyan-200">
          <Crosshair className="h-4 w-4 text-cyan shrink-0" />
          <span>
            <strong>CANONICAL BENCHMARK:</strong> Validated Clohessy-Wiltshire rendezvous scenario (near-circular chief orbit, two-impulse transfer).
          </span>
        </div>
        <Button
          size="xs"
          variant="secondary"
          data-testid="launch-cw-benchmark-btn"
          onClick={() =>
            onNavigateTab(
              "simulation",
              null,
              "remediation",
              null,
              "scenario:canonical-cw-reference"
            )
          }
          className="gap-1.5 font-mono text-cyan hover:bg-cyan/10 border-cyan/40 shrink-0"
        >
          <span>LAUNCH CANONICAL CW BENCHMARK</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Hackathon Demonstration Scenarios Quick Launcher */}
      <div className="p-3.5 rounded-lg border border-purple-500/30 bg-purple-950/20 text-xs font-mono shadow-panel space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-purple-200">
            <Sparkles className="h-4 w-4 text-purple-400 shrink-0" />
            <span className="font-bold uppercase tracking-wider">
              Hackathon Demonstration Scenarios (Deterministic Verification Suite):
            </span>
          </div>
          <span className="text-[10px] text-purple-300">5 Canonical Scenarios</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {CANONICAL_DEMO_SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() =>
                onNavigateTab(
                  s.targetTab,
                  s.targetObjectId || null,
                  s.targetSubtab || null,
                  s.targetEventId || null,
                  s.targetScenarioId || null
                )
              }
              className="p-2.5 rounded-lg border border-purple-500/40 bg-space-dark/80 hover:bg-purple-950/50 hover:border-purple-400 text-left transition-all cursor-pointer group flex flex-col justify-between"
              title={`${s.name}: ${s.description}`}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="font-mono text-[10px] font-bold text-purple-300 group-hover:underline">
                  {s.scenarioCode}
                </span>
                <Play className="h-3 w-3 text-purple-400 fill-current opacity-70 group-hover:opacity-100" />
              </div>
              <span className="text-xs font-sans font-semibold text-slate-200 group-hover:text-purple-200 truncate">
                {s.name}
              </span>
              <span className="text-[9px] font-mono text-slate-400 truncate mt-0.5">
                {s.category}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Grid: 3D Earth Preview (Left) + Recent Events Feed (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left 7 Cols: Interactive 3D Earth Preview Panel */}
        <Card className="xl:col-span-7 p-6 flex flex-col justify-between bg-space-surface border-space-border relative overflow-hidden group">
          <div className="space-y-2 z-10 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-cyan animate-pulse" />
                <CardTitle className="text-base">Inertial GCRS Orbital Environment</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="cyan" size="sm">
                  FRAME: GCRS
                </Badge>
                <Badge variant="blue" size="sm">
                  INTERACTIVE 3D
                </Badge>
              </div>
            </div>
            <p className="text-xs text-slate-400 max-w-xl leading-relaxed font-sans">
              Real-time WebGL rendering of space situational awareness. Earth rotates independently about its polar axis (+Y in Three.js = GCRS +Z). Satellite trajectories and debris clouds remain fixed in the inertial frame.
            </p>
          </div>

          {/* Interactive 3D Canvas Preview */}
          <div className="relative mb-4">
            <EarthPreviewCanvas isDemoMode={isDemoMode} className="w-full h-[380px] 2xl:h-[420px]" />
          </div>

          {/* Canvas Footer Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-4 border-t border-space-border/60 z-10">
            <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
              <button
                type="button"
                onClick={() => {
                  const res = resolveToCanonicalUrn("25544");
                  onNavigateTab("radar", res.success ? res.urn : "25544");
                }}
                className="flex items-center gap-1.5 hover:text-cyan transition-colors cursor-pointer group"
                title="Inspect ISS (Zarya) in Orbital Radar"
              >
                <span className="h-2 w-2 rounded-full bg-cyan group-hover:shadow-[0_0_8px_#06b6d4]" />
                <span className="group-hover:underline">ISS (ZARYA)</span>
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => {
                  const res = resolveToCanonicalUrn("48274");
                  onNavigateTab("radar", res.success ? res.urn : "48274");
                }}
                className="flex items-center gap-1.5 hover:text-emerald-400 transition-colors cursor-pointer group"
                title="Inspect CSS (Tianhe) in Orbital Radar"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400 group-hover:shadow-[0_0_8px_#34d399]" />
                <span className="group-hover:underline">CSS (TIANHE)</span>
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => {
                  const res = resolveToCanonicalUrn("SYNTH-FRAG-0001");
                  onNavigateTab("radar", res.success ? res.urn : "SYNTH-FRAG-0001");
                }}
                className="flex items-center gap-1.5 hover:text-amber-400 transition-colors cursor-pointer group"
                title="Inspect Synthetic Debris Cloud in Orbital Radar"
              >
                <span className="h-2 w-2 rounded-full bg-amber-400 group-hover:shadow-[0_0_8px_#fbbf24]" />
                <span className="group-hover:underline">520 SYNTHETIC FRAGMENTS</span>
              </button>
            </div>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onNavigateTab("radar")}
              className="gap-2"
            >
              <span>OPEN FULL ORBITAL RADAR</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>

        {/* Right 5 Cols: Recent Conjunction Events Feed */}
        <Card className="xl:col-span-5 p-5 flex flex-col justify-between bg-space-surface border-space-border">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-space-border/80">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-status-critical" />
                <CardTitle className="text-sm">Recent Conjunctions</CardTitle>
              </div>
              <Badge variant="critical" size="sm">
                {metrics.highRiskCount} HIGH RISK
              </Badge>
            </div>

            {/* List of screening events or empty state */}
            {conjunctions.length === 0 ? (
              <EmptyState
                title="No Conjunctions Detected"
                description="Zero close approaches detected within the screening threshold (50.0 km)."
                actionLabel="Configure Screening"
                onAction={() => onNavigateTab("conjunctions")}
              />
            ) : (
              <div className="space-y-2.5 max-h-[420px] 2xl:max-h-[480px] overflow-y-auto pr-1">
                {conjunctions.map((item) => {
                  const event = item.event;
                  const risk = item.risk;
                  const category = risk?.risk_category || event.category || "MODERATE";
                  const score = risk ? risk.risk_score.toFixed(1) : "—";
                  
                  const isHighRisk =
                    category === "CRITICAL" ||
                    category === "HIGH" ||
                    event.miss_distance_km <= 5.0;

                  return (
                    <div
                      key={event.event_id}
                      onClick={() => {
                        const evtRes = resolveToCanonicalUrn(event.event_id);
                        onNavigateTab(
                          "conjunctions",
                          null,
                          null,
                          evtRes.success ? evtRes.urn : event.event_id
                        );
                      }}
                      className="p-3.5 rounded-lg border border-space-border/80 bg-space-panel/40 hover:bg-space-panel hover:border-cyan/40 transition-all cursor-pointer space-y-2 group/item"
                      title={`Conjunction ${event.event_id} (Click to inspect encounter)`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span 
                          className="font-mono text-xs font-bold text-slate-200 group-hover/item:text-cyan transition-colors"
                          title={event.event_id}
                        >
                          {event.event_id.replace(/^CONJ-/, "")}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.isSynthetic && (
                            <Badge variant="blue" size="sm">
                              SYNTH
                            </Badge>
                          )}
                          <Badge
                            variant={
                              category === "CRITICAL"
                                ? "critical"
                                : category === "HIGH"
                                ? "critical"
                                : category === "MODERATE"
                                ? "warning"
                                : "success"
                            }
                            size="sm"
                          >
                            {category} ({score})
                          </Badge>
                        </div>
                      </div>

                      {/* Participant Encounter Blocks */}
                      <div className="flex flex-col gap-1.5 text-[11px] font-mono bg-space-surface/50 p-2.5 rounded border border-space-border/40">
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5" title={`Primary: ${event.object_1_name || event.object_1_id}`}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-sans font-semibold text-slate-500 uppercase shrink-0">PRI:</span>
                            <span className="text-slate-200 font-medium">{event.object_1_name || event.object_1_id}</span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">NORAD {event.object_1_id}</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5" title={`Secondary: ${event.object_2_name || event.object_2_id}`}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-sans font-semibold text-slate-500 uppercase shrink-0">SEC:</span>
                            <span className="text-slate-400">{event.object_2_name || event.object_2_id}</span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">NORAD {event.object_2_id}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1.5 border-t border-space-border/40">
                        <span className="text-cyan font-semibold">
                          MISS: {event.miss_distance_km.toFixed(3)} km
                        </span>
                        <span>
                          {event.tca
                            ? new Date(event.tca)
                                .toISOString()
                                .replace("T", " ")
                                .substring(5, 16) + " UTC"
                            : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-space-border/60">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-between"
              onClick={() => onNavigateTab("conjunctions")}
            >
              <span>VIEW ALL CONJUNCTION THREATS</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      </div>

      {/* Indian Space Ecosystem Relevance & IS4OM Strategic Panel */}
      <Card className="p-5 bg-space-surface border-space-border shadow-panel space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-space-border pb-3">
          <div className="flex items-center gap-2.5">
            <Globe className="h-5 w-5 text-emerald-400 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm">Indian Space Missions & Space Data Relevance (ISRO / IS4OM)</CardTitle>
                <Badge variant="emerald" size="sm">DOMAIN 01 & 06</Badge>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Alignment with ISRO System for Safe & Sustainable Space Operations Management (IS4OM)
              </p>
            </div>
          </div>
          <Badge variant="cyan" size="sm">
            INTEGRATION READY
          </Badge>
        </div>

        <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-950/20 text-xs font-mono text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5 text-[11px]">
            <span className="font-bold uppercase tracking-wider block">SCIENTIFIC INTEGRITY SPECIFICATION:</span>
            <p className="text-slate-300 leading-relaxed">
              {ISRO_IS4OM_SPECIFICATION.disclaimer} In accordance with project scientific rules (AGENTS.md), orbital elements are never fabricated. COLLIVRA&apos;s data schemas are fully configured to consume live or cached CelesTrak OMM records for Indian satellite groups.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {INDIAN_SPACE_CONSTELLATIONS.map((c) => (
            <div
              key={c.acronym}
              className="p-3.5 rounded-xl border border-space-border/80 bg-space-panel/30 space-y-2 flex flex-col justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono text-xs font-bold text-cyan">{c.acronym}</span>
                  <Badge variant="outline" size="sm">{c.regime}</Badge>
                </div>
                <h4 className="font-heading text-xs font-bold text-white tracking-wide truncate" title={c.name}>
                  {c.name}
                </h4>
                <p className="text-[11px] text-slate-300 font-sans line-clamp-2">
                  {c.description}
                </p>
              </div>
              <div className="pt-2 border-t border-space-border/60 text-[10px] font-mono space-y-0.5">
                <div className="text-slate-400 truncate">
                  <span className="text-slate-500">Missions:</span> {c.representativeMissions.slice(0, 2).join(", ")}
                </div>
                <div className="text-emerald-400 truncate">
                  <span className="text-slate-500">Source:</span> {c.ingestionSource}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
