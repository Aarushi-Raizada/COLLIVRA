"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { ConjunctionEvent, RiskAssessment, RiskFactor } from "@/types/api";
import { NavigationTab } from "@/types/orbital";
import { formatUtcDateTime, formatDistanceKm, formatVelocityKms } from "@/lib/utils";
import { isSyntheticObject, isSyntheticEncounter } from "@/lib/screening";
import { resolveToCanonicalUrn } from "@/lib/urn";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Compass,
  Layers,
  Activity,
  AlertTriangle,
  Clock,
  ShieldAlert,
  HelpCircle,
  BarChart3,
  CheckCircle2,
  AlertCircle,
  Eye,
  Radio,
  ArrowRight,
  Download,
  Copy,
  ExternalLink,
  Flame,
  Crosshair,
  ShieldX,
  Gauge,
  Zap,
} from "lucide-react";

// Dynamic import with SSR disabled to guarantee zero server-side WebGL errors in Next.js
const EncounterGeometryCanvas = dynamic(
  () =>
    import("./EncounterGeometryCanvas").then((mod) => mod.EncounterGeometryCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[360px] rounded-xl border border-space-border bg-space-bg flex flex-col items-center justify-center font-mono text-xs text-slate-400 space-y-2">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan border-t-transparent" />
        <div className="text-xs font-bold text-slate-300">
          INITIALIZING 3D ENCOUNTER GEOMETRY...
        </div>
        <p className="text-[11px] text-slate-500">
          Mounting GCRS relative coordinate frame and encounter kinematics
        </p>
      </div>
    ),
  }
);

export interface CloseApproachInspectorProps {
  event: ConjunctionEvent | null;
  risk?: RiskAssessment | null;
  isAssessingRisk?: boolean;
  onAssessRisk?: (event: ConjunctionEvent) => void;
  onAssessWithLiveBackend?: (event: ConjunctionEvent) => void;
  isAssessingLive?: boolean;
  liveAssessmentError?: string | null;
  riskSource?: "LIVE_BACKEND" | "OFFLINE_FIXTURE" | null;
  isDemoMode?: boolean;
  onNavigateTab?: (
    tab: NavigationTab,
    objectId?: string | null,
    subtab?: string | null,
    eventId?: string | null,
    scenarioId?: string | null
  ) => void;
  className?: string;
}

export const CloseApproachInspector: React.FC<CloseApproachInspectorProps> = ({
  event,
  risk,
  isAssessingRisk = false,
  onAssessRisk,
  onAssessWithLiveBackend,
  isAssessingLive = false,
  liveAssessmentError = null,
  riskSource = null,
  isDemoMode = false,
  onNavigateTab,
  className = "",
}) => {
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);

  if (!event) {
    return (
      <Card className={`border-space-border bg-space-surface/90 p-8 sm:p-12 text-center shadow-panel ${className}`}>
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-space-panel border border-space-border text-cyan">
            <Compass className="h-7 w-7" />
          </div>
          <h3 className="text-sm font-space font-bold text-slate-200 tracking-wide uppercase">
            No Conjunction Event Selected
          </h3>
          <p className="text-xs text-slate-400 max-w-sm font-mono leading-relaxed">
            Select a close-approach encounter from the queue to inspect inertial GCRS
            relative state vectors, 3D kinematics, and explainable heuristic risk factors.
          </p>
        </div>
      </Card>
    );
  }

  const [rx, ry, rz] = event.relative_position_km || [NaN, NaN, NaN];
  const [vx, vy, vz] = event.relative_velocity_kms || [NaN, NaN, NaN];

  const posNorm = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const velNorm = Math.sqrt(vx * vx + vy * vy + vz * vz);

  const handleExportJson = () => {
    const data = {
      event,
      riskAssessment: risk ?? null,
      exportedAt: new Date().toISOString(),
    };
    const jsonStr = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    });
  };

  return (
    <div className={`space-y-3.5 2xl:space-y-4 ${className}`}>
      {/* =========================================================================
          SECTION 1: Primary Flight Telemetry HUD & Event Identification
         ========================================================================= */}
      <Card className="border-space-border bg-space-surface/90 p-4 sm:p-5 shadow-panel space-y-4">
        {/* Top Header Row */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pb-3 border-b border-space-border/80">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Eye className="h-4 w-4 text-cyan shrink-0" />
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
                Close Approach Telemetry HUD
              </span>
              <Badge variant="cyan" size="sm" className="font-bold">
                Frame: {event.frame} (Inertial)
              </Badge>
              <Badge
                variant={
                  event.category === "CRITICAL"
                    ? "rose"
                    : event.category === "HIGH"
                    ? "amber"
                    : "warning"
                }
                size="sm"
                className="font-bold uppercase"
              >
                {event.category} SEVERITY
              </Badge>
              {isSyntheticEncounter(event) && (
                <Badge variant="amber" size="sm" className="font-bold uppercase">
                  SYNTHETIC DEBRIS ENCOUNTER
                </Badge>
              )}
            </div>

            <div className="flex items-baseline gap-2 flex-wrap pt-0.5">
              <h2 className="text-base sm:text-lg font-space font-bold text-slate-100">
                <span>{event.object_1_name || `Object ${event.object_1_id}`}</span>
                <span className="text-cyan text-sm mx-2">vs</span>
                <span className="text-slate-200">{event.object_2_name || `Object ${event.object_2_id}`}</span>
              </h2>
              <span className="font-mono text-xs font-bold text-cyan bg-cyan/10 px-2 py-0.5 rounded border border-cyan/30">
                {event.event_id}
              </span>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-1.5 flex-wrap self-end md:self-auto">
            <Button
              size="xs"
              variant="secondary"
              onClick={handleExportJson}
              className="gap-1 font-mono text-xs bg-space-panel hover:bg-space-surface border-space-border"
              title="Copy event state & telemetry JSON to clipboard"
            >
              {copyFeedback ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Copied JSON</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-slate-400" />
                  <span>Export JSON</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Primary Flight Telemetry KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 2xl:gap-3 text-xs font-mono">
          {/* Miss Distance */}
          <div className="p-3 rounded-lg border border-space-border bg-space-panel/90 flex flex-col justify-between">
            <span className="text-[10px] uppercase text-slate-400 block font-medium">Miss Distance</span>
            <div className="mt-1">
              <span
                className={`text-xl 2xl:text-2xl font-bold font-mono ${
                  event.miss_distance_km < 1.0
                    ? "text-rose-400"
                    : event.miss_distance_km < 5.0
                    ? "text-amber-400"
                    : event.miss_distance_km < 10.0
                    ? "text-yellow-400"
                    : "text-emerald-400"
                }`}
              >
                {formatDistanceKm(event.miss_distance_km, 3)}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {event.category === "CRITICAL"
                  ? "Within 1 km Alert Sphere"
                  : event.category === "HIGH"
                  ? "Within 5 km High Buffer"
                  : "Within 10 km Buffer"}
              </span>
            </div>
          </div>

          {/* Relative Speed */}
          <div className="p-3 rounded-lg border border-space-border bg-space-panel/90 flex flex-col justify-between">
            <span className="text-[10px] uppercase text-slate-400 block font-medium">Relative Speed</span>
            <div className="mt-1">
              <span className="text-xl 2xl:text-2xl font-bold font-mono text-slate-100">
                {formatVelocityKms(event.relative_speed_kms, 3)}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Kinetic Energy: {(0.5 * event.relative_speed_kms * event.relative_speed_kms).toFixed(2)} MJ/kg
              </span>
            </div>
          </div>

          {/* Time of Closest Approach (TCA) */}
          <div className="p-3 rounded-lg border border-space-border bg-space-panel/90 flex flex-col justify-between">
            <span className="text-[10px] uppercase text-slate-400 block font-medium">Time of Closest Approach</span>
            <div className="mt-1">
              <div className="flex flex-col">
                <span className="text-sm 2xl:text-base font-bold font-mono text-slate-100">
                  {formatUtcDateTime(event.tca).split(" ")[1] || ""} UTC
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  {formatUtcDateTime(event.tca).split(" ")[0] || ""}
                </span>
              </div>
              <span className="text-[10px] text-cyan block mt-0.5">
                Step: {event.step_seconds}s · {event.method || "Numerical Optimization"}
              </span>
            </div>
          </div>

          {/* Vector Norm Magnitude */}
          <div className="p-3 rounded-lg border border-space-border bg-space-panel/90 flex flex-col justify-between">
            <span className="text-[10px] uppercase text-slate-400 block font-medium">Relative Distance Norm</span>
            <div className="mt-1">
              <span className="text-xl 2xl:text-2xl font-bold font-mono text-cyan">
                {posNorm.toFixed(3)} km
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                ||r₂ - r₁|| in Inertial GCRS
              </span>
            </div>
          </div>
        </div>

        {/* Quick Operational Navigation Actions */}
        {onNavigateTab && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-space-border/60">
            <Button
              size="xs"
              variant="primary"
              onClick={() => {
                const res = resolveToCanonicalUrn(event.object_1_id);
                onNavigateTab("radar", res.success ? res.urn : event.object_1_id);
              }}
              className="gap-1.5 font-mono text-xs"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Track Primary in Radar</span>
            </Button>

            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                const objRes = resolveToCanonicalUrn(event.object_2_id);
                const evtRes = resolveToCanonicalUrn(event.event_id);
                onNavigateTab(
                  "simulation",
                  objRes.success ? objRes.urn : event.object_2_id,
                  "breakup",
                  evtRes.success ? evtRes.urn : event.event_id
                );
              }}
              className="gap-1.5 font-mono text-xs"
            >
              <Flame className="h-3.5 w-3.5 text-rose-400" />
              <span>Simulate Fragment Breakup</span>
            </Button>

            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                const objRes = resolveToCanonicalUrn(event.object_2_id);
                const evtRes = resolveToCanonicalUrn(event.event_id);
                onNavigateTab(
                  "simulation",
                  objRes.success ? objRes.urn : event.object_2_id,
                  "remediation",
                  evtRes.success ? evtRes.urn : event.event_id
                );
              }}
              className="gap-1.5 font-mono text-xs"
            >
              <Crosshair className="h-3.5 w-3.5 text-cyan" />
              <span>Plan Clohessy-Wiltshire Remediation</span>
            </Button>
          </div>
        )}
      </Card>

      {/* =========================================================================
          SECTION 2 & 3: Primary & Secondary Object Intelligence Cards
         ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 2xl:gap-4 text-xs font-mono">
        {/* Primary Asset Card (Origin) */}
        <Card className="border-space-border bg-space-surface/90 p-3.5 2xl:p-4 shadow-panel space-y-2.5">
          <div className="flex items-center justify-between pb-2 border-b border-space-border/80">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan inline-block animate-pulse" />
              <h4 className="text-xs font-space font-bold uppercase tracking-wider text-slate-200">
                Primary Asset (Origin [0,0,0])
              </h4>
            </div>
            <Badge variant="cyan" size="sm">
              PROTECTED ASSET
            </Badge>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Object Name:</span>
              <span className="font-semibold text-slate-100 text-right">
                {event.object_1_name || "Operational Satellite"}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Catalog Identifier:</span>
              <span className="font-mono text-slate-200 font-bold">
                {isSyntheticObject(event.object_1_id, event.object_1_is_synthetic)
                  ? `SYNTH-${event.object_1_id}`
                  : `NORAD ${event.object_1_id}`}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Reference Coordinate Role:</span>
              <span className="text-cyan font-semibold">Origin r₁ ≡ (0, 0, 0)</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Provenance:</span>
              <span className="text-slate-300">
                {isSyntheticObject(event.object_1_id, event.object_1_is_synthetic)
                  ? "Synthetic Target Asset"
                  : "Verified CelesTrak OMM Ephemeris"}
              </span>
            </div>
          </div>
        </Card>

        {/* Secondary Asset Card (Chaser / Target) */}
        <Card className="border-space-border bg-space-surface/90 p-3.5 2xl:p-4 shadow-panel space-y-2.5">
          <div className="flex items-center justify-between pb-2 border-b border-space-border/80">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block animate-pulse" />
              <h4 className="text-xs font-space font-bold uppercase tracking-wider text-slate-200">
                Secondary Object (Encounter Chaser)
              </h4>
            </div>
            {isSyntheticObject(event.object_2_id, event.object_2_is_synthetic ?? event.is_synthetic) ? (
              <Badge variant="amber" size="sm">
                SYNTHETIC DEBRIS
              </Badge>
            ) : (
              <Badge variant="warning" size="sm">
                CATALOG TARGET
              </Badge>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Object Name:</span>
              <span className="font-semibold text-slate-100 text-right">
                {event.object_2_name || `Object ${event.object_2_id}`}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Catalog Identifier:</span>
              <span className="font-mono text-slate-200 font-bold">
                {isSyntheticObject(event.object_2_id, event.object_2_is_synthetic ?? event.is_synthetic)
                  ? `SYNTH: ${event.object_2_id}`
                  : `NORAD ${event.object_2_id}`}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Relative Vector Role:</span>
              <span className="text-rose-400 font-semibold">Chaser r₂ = r₁ + r_rel</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Trajectory Integrity:</span>
              <span className="text-slate-300">
                {isSyntheticObject(event.object_2_id, event.object_2_is_synthetic ?? event.is_synthetic)
                  ? "Cartesian Numerical Propagation (J₂)"
                  : "Analytical SGP4 Mean Elements"}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* =========================================================================
          SECTION 4 & 5: Kinematic Vectors & 3D Relative Encounter Geometry
         ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 2xl:gap-4">
        {/* Relative Position Vector in GCRS */}
        <Card className="border-space-border bg-space-surface/90 p-3.5 2xl:p-4 shadow-panel">
          <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-space-border/80">
            <div className="flex items-center gap-2">
              <Compass className="h-4 w-4 text-cyan" />
              <h4 className="text-xs font-space font-bold uppercase tracking-wider text-slate-200">
                Relative Position Vector (r₂ - r₁)
              </h4>
            </div>
            <Badge variant="cyan" size="sm" className="font-mono">
              Inertial GCRS (km)
            </Badge>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 rounded bg-space-panel/90 border border-space-border text-center">
                <span className="text-[10px] text-rose-400 font-semibold block">GCRS +X</span>
                <span className="text-slate-100 font-bold tabular-nums">{rx.toFixed(3)} km</span>
              </div>
              <div className="p-2 rounded bg-space-panel/90 border border-space-border text-center">
                <span className="text-[10px] text-blue-400 font-semibold block">GCRS +Y</span>
                <span className="text-slate-100 font-bold tabular-nums">{ry.toFixed(3)} km</span>
              </div>
              <div className="p-2 rounded bg-space-panel/90 border border-space-border text-center">
                <span className="text-[10px] text-emerald-400 font-semibold block">GCRS +Z</span>
                <span className="text-slate-100 font-bold tabular-nums">{rz.toFixed(3)} km</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1.5 border-t border-space-border/60 text-[11px] text-slate-400">
              <span>Euclidean Magnitude ||r_rel||:</span>
              <span className="text-cyan font-bold tabular-nums">{posNorm.toFixed(3)} km</span>
            </div>
          </div>
        </Card>

        {/* Relative Velocity Vector in GCRS */}
        <Card className="border-space-border bg-space-surface/90 p-3.5 2xl:p-4 shadow-panel">
          <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-space-border/80">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-amber-400" />
              <h4 className="text-xs font-space font-bold uppercase tracking-wider text-slate-200">
                Relative Velocity Vector (v₂ - v₁)
              </h4>
            </div>
            <Badge variant="amber" size="sm" className="font-mono">
              Inertial GCRS (km/s)
            </Badge>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 rounded bg-space-panel/90 border border-space-border text-center">
                <span className="text-[10px] text-rose-400 font-semibold block">GCRS +Vx</span>
                <span className="text-slate-100 font-bold tabular-nums">{vx.toFixed(3)} km/s</span>
              </div>
              <div className="p-2 rounded bg-space-panel/90 border border-space-border text-center">
                <span className="text-[10px] text-blue-400 font-semibold block">GCRS +Vy</span>
                <span className="text-slate-100 font-bold tabular-nums">{vy.toFixed(3)} km/s</span>
              </div>
              <div className="p-2 rounded bg-space-panel/90 border border-space-border text-center">
                <span className="text-[10px] text-emerald-400 font-semibold block">GCRS +Vz</span>
                <span className="text-slate-100 font-bold tabular-nums">{vz.toFixed(3)} km/s</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1.5 border-t border-space-border/60 text-[11px] text-slate-400">
              <span>Relative Speed ||v_rel||:</span>
              <span className="text-amber-400 font-bold tabular-nums">{velNorm.toFixed(3)} km/s</span>
            </div>
          </div>
        </Card>
      </div>

      {/* 3D Encounter-Centered Relative GCRS Geometry Canvas */}
      <EncounterGeometryCanvas event={event} />

      {/* =========================================================================
          SECTION 6: Explainable Heuristic Risk Assessment (Decoupled Engine)
         ========================================================================= */}
      <Card className="border-space-border bg-space-surface/90 p-4 sm:p-5 shadow-panel space-y-4">
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-space-border/80">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-cyan" />
              <h3 className="text-xs font-space font-bold uppercase tracking-wider text-slate-100">
                Explainable Heuristic Risk Assessment
              </h3>
            </div>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              Multi-factor triage prioritization index [0.0 – 100.0]. Evaluated separately from geometric screening.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono">
            {risk && (
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block uppercase">Risk Score</span>
                  <span
                    className={`text-xl font-bold ${
                      risk.risk_category === "CRITICAL"
                        ? "text-rose-400"
                        : risk.risk_category === "HIGH"
                        ? "text-amber-400"
                        : risk.risk_category === "MODERATE"
                        ? "text-yellow-400"
                        : "text-blue-400"
                    }`}
                  >
                    {risk.risk_score.toFixed(1)} / 100
                  </span>
                </div>
                <Badge
                  variant={
                    risk.risk_category === "CRITICAL"
                      ? "rose"
                      : risk.risk_category === "HIGH"
                      ? "amber"
                      : "warning"
                  }
                  size="md"
                  className="font-bold uppercase"
                >
                  {risk.risk_category}
                </Badge>
              </div>
            )}

            {onAssessWithLiveBackend && (isSyntheticEncounter(event) || isDemoMode) && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => onAssessWithLiveBackend(event)}
                disabled={isAssessingLive || isAssessingRisk}
                className="font-mono text-xs border-cyan/50 text-cyan hover:bg-cyan/10"
              >
                {isAssessingLive ? (
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-3 animate-spin rounded-full border border-cyan border-t-transparent" />
                    <span>ASSESSING WITH FASTAPI...</span>
                  </div>
                ) : (
                  <span>ASSESS WITH LIVE BACKEND</span>
                )}
              </Button>
            )}

            {!risk && !onAssessWithLiveBackend && isAssessingRisk && (
              <Badge variant="cyan" size="sm" className="animate-pulse font-mono">
                Assessing Risk...
              </Badge>
            )}

            {!risk && !onAssessWithLiveBackend && !isAssessingRisk && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-500">Not Evaluated</span>
                {onAssessRisk && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => onAssessRisk(event)}
                    className="font-mono text-xs"
                  >
                    Assess Risk
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Live assessment error alert if occurred */}
        {liveAssessmentError && (
          <div className="p-3 rounded-lg border border-rose-500/50 bg-rose-950/30 text-xs font-mono text-rose-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold uppercase tracking-wider block">
                Live Backend Risk Assessment Failed
              </span>
              <span>{liveAssessmentError}</span>
            </div>
          </div>
        )}

        {/* Factor Breakdown */}
        {risk ? (
          <div className="space-y-3.5">
            {/* Metadata Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded bg-space-panel/90 border border-space-border text-[11px] font-mono text-slate-400">
              <div className="flex items-center gap-2 flex-wrap">
                <span>Evaluation Epoch: {formatUtcDateTime(risk.evaluation_time)}</span>
                <span className="text-slate-600">•</span>
                <span>Quality: <strong className="text-slate-200">{risk.data_quality}</strong></span>
                <span className="text-slate-600">•</span>
                <span className="flex items-center gap-1">
                  Engine:{" "}
                  {riskSource === "LIVE_BACKEND" ? (
                    <Badge variant="cyan" size="sm" className="py-0 px-1.5 text-[10px] font-bold">
                      LIVE FASTAPI BACKEND
                    </Badge>
                  ) : (
                    <Badge variant="slate" size="sm" className="py-0 px-1.5 text-[10px] font-bold">
                      OFFLINE DEMO FIXTURE
                    </Badge>
                  )}
                </span>
                {isSyntheticEncounter(event) && (
                  <>
                    <span className="text-slate-600">•</span>
                    <Badge variant="amber" size="sm" className="py-0 px-1.5 text-[10px] font-bold">
                      SYNTHETIC ENCOUNTER
                    </Badge>
                  </>
                )}
              </div>
              {risk.warnings && risk.warnings.length > 0 && (
                <div className="text-amber-300 flex items-center gap-1 font-semibold">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{risk.warnings.length} warning(s)</span>
                </div>
              )}
            </div>

            {/* Warnings list if any */}
            {risk.warnings && risk.warnings.length > 0 && (
              <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-950/20 text-xs font-mono text-amber-300 space-y-1">
                {risk.warnings.map((w, idx) => (
                  <div key={idx} className="flex items-start gap-1.5">
                    <span className="text-amber-500">•</span>
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Factor Table with Normalized Bar Visualizations */}
            <div>
              <h4 className="text-xs font-space font-bold uppercase tracking-wider text-slate-300 mb-2">
                Risk Contributing Factors Breakdown
              </h4>
              <div className="overflow-x-auto rounded-lg border border-space-border bg-space-panel/40">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-space-panel/90 text-slate-400 text-[10px] uppercase border-b border-space-border">
                    <tr>
                      <th className="py-2 px-3">Factor</th>
                      <th className="py-2 px-3">Raw Value</th>
                      <th className="py-2 px-3">Normalized Load</th>
                      <th className="py-2 px-3">Weight</th>
                      <th className="py-2 px-3">Contribution</th>
                      <th className="py-2 px-3 min-w-[160px]">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-space-border/60">
                    {risk.factors.map((f, idx) => (
                      <tr key={idx} className="hover:bg-space-surface/60">
                        <td className="py-2.5 px-3 font-semibold text-slate-200">
                          {f.factor_name}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap tabular-nums font-semibold">
                          {f.raw_value.toFixed(3)} {f.raw_units}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 min-w-[110px]">
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                              <div
                                className="h-full bg-cyan transition-all"
                                style={{ width: `${Math.min(100, Math.max(0, f.normalized_value * 100))}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-mono tabular-nums">
                              {(f.normalized_value * 100).toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 tabular-nums">
                          {(f.weight * 100).toFixed(0)}%
                        </td>
                        <td className="py-2.5 px-3 font-bold text-cyan tabular-nums">
                          +{f.contribution.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-slate-400">
                          {f.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : isAssessingRisk ? (
          <div className="py-8 text-center text-xs font-mono text-slate-400">
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan border-t-transparent" />
              <span>Evaluating explainable heuristic risk factors...</span>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-xs font-mono text-slate-500">
            No heuristic risk assessment available for this event. Risk assessment is decoupled from
            geometric screening and must be evaluated separately.
          </div>
        )}
      </Card>

      {/* =========================================================================
          SECTION 7: Analytical Qualifications & Mandatory Scientific Disclosures
         ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
        {/* Formal Pc Unavailability Callout */}
        <div className="p-3.5 rounded-lg border border-rose-500/30 bg-rose-950/20 text-rose-300 space-y-1.5">
          <div className="flex items-center gap-2 text-rose-400 font-bold uppercase text-[11px] tracking-wide">
            <ShieldX className="h-4 w-4 shrink-0" />
            <span>Formal Collision Probability (Pc): UNAVAILABLE</span>
          </div>
          <p className="text-[11px] leading-relaxed text-rose-200/80">
            Public Two-Line Element (TLE) and Orbit Mean-Elements Message (OMM) catalogs do NOT contain
            calibrated error covariance matrices (C₁, C₂). Computing formal
            collision probability (Pc) using Foster 1992 or Akella-Alfriend 2000 methods without true
            covariance matrices is physically unjustified.
          </p>
        </div>

        {/* Heuristic Index & SGP4 Qualification */}
        <div className="p-3.5 rounded-lg border border-space-border bg-space-surface/90 text-slate-300 space-y-1.5">
          <div className="flex items-center gap-2 text-cyan font-bold uppercase text-[11px] tracking-wide">
            <HelpCircle className="h-4 w-4 shrink-0" />
            <span>Analytical SGP4 Screening Qualification</span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            {event.disclaimer ||
              "Close-approach results represent preliminary geometric miss-distance thresholds derived from analytical SGP4 propagation in the inertial GCRS frame. COLLIVRA's Heuristic Risk Score [0.0–100.0] serves strictly as an operational triage priority index and must NEVER be treated as formal collision probability (Pc)."}
          </p>
        </div>
      </div>
    </div>
  );
};
