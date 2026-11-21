"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Server,
  Activity,
  ShieldCheck,
  Database,
  Cpu,
  Wifi,
  RefreshCw,
  Clock,
  Layers,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Orbit,
  Crosshair,
  Compass,
  Globe,
  FileCode,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { MetricCard } from "../ui/MetricCard";
import { DisclaimerBanner } from "../ui/DisclaimerBanner";
import { ApiConnectionStatus } from "@/types/orbital";
import { HealthResponse } from "@/types/api";
import { apiClient } from "@/lib/api";
import { formatUtcDateTime } from "@/lib/utils";

export interface SystemTelemetryViewProps {
  apiStatus: ApiConnectionStatus;
  isDemoMode: boolean;
  onRefresh?: () => void;
}

export const SystemTelemetryView: React.FC<SystemTelemetryViewProps> = ({
  apiStatus,
  isDemoMode,
  onRefresh,
}) => {
  const [isManualProbing, setIsManualProbing] = useState<boolean>(false);
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await apiClient.checkHealth(4000);
      setHealthData(res);
      setHealthError(null);
    } catch (err: unknown) {
      setHealthData(null);
      setHealthError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth, apiStatus.lastCheckedUtc]);

  const handleManualRefresh = async () => {
    setIsManualProbing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      }
      await fetchHealth();
    } finally {
      setTimeout(() => setIsManualProbing(false), 500);
    }
  };

  const iersMode = healthData?.iers_mode;

  const SUBSYSTEMS = [
    {
      name: "SGP4 Ephemeris Ingestion & Centralized Frame Transforms",
      module: "packages/orbital_core/frames.py",
      status: apiStatus.connected ? "OPERATIONAL" : "OFFLINE CACHE",
      desc: "Raw SGP4 TEME propagation strictly transformed to inertial GCRS via standard ERFA/Vallado benchmarks. Prevents silent frame mixing.",
      icon: <Orbit className="h-4 w-4 text-cyan" />,
    },
    {
      name: "Geometric Conjunction Screening Engine",
      module: "apps/api/routers/conjunctions.py",
      status: apiStatus.connected ? "OPERATIONAL" : "OFFLINE CACHE",
      desc: "Analytical multi-satellite coarse/fine B-plane filter evaluating closest approach (TCA) and miss distance in inertial GCRS.",
      icon: <Compass className="h-4 w-4 text-emerald-400" />,
    },
    {
      name: "Decoupled Heuristic Risk Assessment",
      module: "apps/api/routers/risk.py",
      status: apiStatus.connected ? "OPERATIONAL" : "OFFLINE CACHE",
      desc: "Normalized multi-factor threat index [0.0 - 100.0]. Discloses that public TLEs lack covariance matrices and do not yield formal Pc.",
      icon: <Activity className="h-4 w-4 text-cyan" />,
    },
    {
      name: "Simplified Synthetic Breakup Model",
      module: "packages/simulation/simulation/breakup.py",
      status: apiStatus.connected ? "OPERATIONAL" : "OFFLINE CACHE",
      desc: "Isotropic ejection velocity distribution, strict mass conservation, and ensemble center-of-mass momentum drift compensation.",
      icon: <Flame className="h-4 w-4 text-rose-400" />,
    },
    {
      name: "Cowell Numerical Batch Propagator (DOP853 + J2)",
      module: "packages/simulation/simulation/numerical.py",
      status: apiStatus.connected ? "OPERATIONAL" : "OFFLINE CACHE",
      desc: "8th-order explicit Runge-Kutta numerical integration with Earth oblateness J2. Enforces <= 60s knot sampling guardrail.",
      icon: <Layers className="h-4 w-4 text-amber-400" />,
    },
    {
      name: "Clohessy-Wiltshire (CW) 2-Impulse Rendezvous Planner",
      module: "packages/simulation/simulation/remediation.py",
      status: apiStatus.connected ? "OPERATIONAL" : "OFFLINE CACHE",
      desc: "Linearized Hill (RIC) frame relative motion solver with near-circular reference orbit precondition (e <= 0.005, rp >= 6478.137 km).",
      icon: <Crosshair className="h-4 w-4 text-cyan" />,
    },
    {
      name: "Earth Orientation Parameters & IERS Cache Policy",
      module: "packages/orbital_core/iers_policy.py",
      status: apiStatus.connected ? (iersMode || "OPERATIONAL") : "OFFLINE CACHE",
      desc: "Deterministic IERS Bulletin A/B evaluation, 30d predictive stale threshold, auto_download=False, and HTTP 422 policy exception mapping.",
      icon: <Database className="h-4 w-4 text-emerald-400" />,
    },
  ];

  const ENDPOINTS = [
    {
      method: "GET",
      path: "/health",
      desc: "Backend health check, latency monitoring, and IERS operational mode probe",
      active: true,
    },
    {
      method: "POST",
      path: "/api/v1/conjunctions/screen",
      desc: "Multi-satellite analytical SGP4 close-approach screening strictly in GCRS with interval EOP validation",
      active: true,
    },
    {
      method: "POST",
      path: "/api/v1/risk/assess",
      desc: "Explainable heuristic risk scoring with scientific non-Pc disclaimer",
      active: true,
    },
    {
      method: "POST",
      path: "/api/v1/risk/assess-batch",
      desc: "Decoupled batch evaluation of screened orbital conjunction events",
      active: true,
    },
    {
      method: "POST",
      path: "/api/v1/simulation/breakup-and-propagate",
      desc: "Synthetic breakup model + DOP853 Cowell J2 batch numerical propagator",
      active: true,
    },
    {
      method: "POST",
      path: "/api/v1/remediation/breakup-and-rendezvous",
      desc: "Breakup + DOP853 J2 + CW two-impulse rendezvous remediation planning",
      active: true,
    },
  ];

  // Helper to render IERS badge without false defaults
  const renderIersModeBadge = () => {
    if (!healthData) {
      if (healthError) {
        return (
          <Badge variant="slate" size="sm" className="font-mono">
            IERS: UNREACHABLE
          </Badge>
        );
      }
      return (
        <Badge variant="slate" size="sm" className="font-mono">
          IERS: PROBING...
        </Badge>
      );
    }

    if (iersMode === "OFFLINE_PREDICTIVE") {
      return (
        <Badge variant="emerald" size="sm" className="font-mono font-bold flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 text-emerald-400" />
          <span>OFFLINE_PREDICTIVE (≤30d Extrapolation)</span>
        </Badge>
      );
    }

    if (iersMode === "OFFLINE_STRICT") {
      return (
        <Badge variant="amber" size="sm" className="font-mono font-bold flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 text-amber-400" />
          <span>OFFLINE_STRICT (Zero Extrapolation Allowed)</span>
        </Badge>
      );
    }

    // Unknown/unsupported IERS mode: display verbatim without silent promotion to healthy
    return (
      <Badge variant="warning" size="sm" className="font-mono font-bold">
        UNKNOWN MODE: {String(iersMode)}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Scientific Disclaimer Banner */}
      <DisclaimerBanner
        variant="info"
        title="COLLIVRA SYSTEM ARCHITECTURE & ASTRODYNAMICAL VERIFICATION STANDARDS"
        disclaimer="COLLIVRA operates as an orbital research, space situational awareness (SSA), and rendezvous remediation decision-support prototype. Coordinate transformations, orbital numerical propagators, and relative motion solvers are centralized and validated against published astrodynamics test suites (David Vallado, AIAA-2006-6753). Raw SGP4 TEME coordinates are converted to GCRS prior to analysis or visualization."
      />

      {/* Header Overview Card */}
      <Card className="p-4 bg-space-surface border-space-border/80">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-cyan/10 border border-cyan/30 flex items-center justify-center">
              <Server className="h-5 w-5 text-cyan animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-heading font-bold text-sm tracking-wide text-white">
                  COLLIVRA SYSTEM & DATA INTEGRITY
                </span>
                <Badge
                  variant={apiStatus.connected ? "cyan" : "warning"}
                  size="sm"
                  pulseDot
                >
                  {apiStatus.connected ? "CONNECTED (LIVE NODE)" : "STANDBY (DEMO MODE)"}
                </Badge>
                {renderIersModeBadge()}
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Node Base URL: <span className="text-slate-300 font-bold">{apiClient.getBaseUrl()}</span>
                {apiStatus.version && (
                  <span className="ml-2 text-cyan font-bold">• v{apiStatus.version}</span>
                )}
                <span className="ml-2 text-slate-500">• Team Errorists · ASTRA 2026</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono">
            <div className="flex items-center gap-1.5 text-slate-300 bg-space-panel/60 px-2.5 py-1.5 rounded border border-space-border/60">
              <Clock className="h-3.5 w-3.5 text-cyan" />
              <span>
                {apiStatus.lastCheckedUtc
                  ? `CHECKED: ${formatUtcDateTime(apiStatus.lastCheckedUtc)}`
                  : "NOT YET PROBED"}
              </span>
            </div>

            <Button
              size="sm"
              variant="secondary"
              onClick={handleManualRefresh}
              disabled={isManualProbing}
              className="gap-1.5 font-mono text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isManualProbing ? "animate-spin" : ""}`} />
              <span>PROBE NODE</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="FastAPI Node"
          value={apiStatus.connected ? "ONLINE" : "STANDBY"}
          sublabel={apiClient.getBaseUrl()}
          icon={<Server className="h-5 w-5 text-cyan" />}
          variant={apiStatus.connected ? "cyan" : "amber"}
        />
        <MetricCard
          label="Roundtrip Latency"
          value={apiStatus.latencyMs !== undefined ? `${apiStatus.latencyMs} ms` : "N/A"}
          sublabel="HTTP GET /health latency"
          icon={<Activity className="h-5 w-5 text-emerald-400" />}
          variant="emerald"
        />
        <MetricCard
          label="IERS Operating Mode"
          value={iersMode ? iersMode.replace("OFFLINE_", "") : (apiStatus.connected ? "OFFLINE" : "STANDBY")}
          sublabel={
            iersMode === "OFFLINE_STRICT"
              ? "Strict observation cutoff"
              : iersMode === "OFFLINE_PREDICTIVE"
              ? "Max 30d forward prediction"
              : "IERS policy status"
          }
          icon={<Globe className="h-5 w-5 text-cyan" />}
          variant={iersMode === "OFFLINE_STRICT" ? "amber" : "cyan"}
        />
        <MetricCard
          label="Reference Frame"
          value="GCRS (Inertial)"
          sublabel="IAU 2000 Mean Equator & Equinox"
          icon={<ShieldCheck className="h-5 w-5 text-cyan" />}
          variant="cyan"
        />
      </div>

      {/* Dedicated Earth Orientation Parameters & IERS Policy Architecture Card */}
      <Card className="p-6 bg-space-surface border-space-border space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-space-border/80">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-cyan" />
            <CardTitle className="text-sm">Earth Orientation Parameter (EOP) Policy Architecture</CardTitle>
          </div>
          <Badge variant="cyan" size="sm" className="font-mono">
            AST-01B / AST-01B.2 ALIGNED
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
          <div className="p-3.5 rounded-lg border border-space-border/80 bg-space-panel/60 space-y-2">
            <span className="text-slate-400 uppercase text-[10px] font-bold tracking-wider">
              1. IERS Table & Definitive Epoch
            </span>
            <p className="text-slate-200 font-semibold">
              Finals2000A.all (Bundled Package Table)
            </p>
            <p className="text-slate-400 text-[11px] font-sans">
              Last definitive observation: <strong className="text-cyan">MJD 61321.0</strong> (2026-10-08 00:00:00 UTC). Calibrated UT1-UTC and polar motion observations.
            </p>
          </div>

          <div className="p-3.5 rounded-lg border border-space-border/80 bg-space-panel/60 space-y-2">
            <span className="text-slate-400 uppercase text-[10px] font-bold tracking-wider">
              2. Astropy Network Decoupling
            </span>
            <p className="text-emerald-400 font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              auto_download = False
            </p>
            <p className="text-slate-400 text-[11px] font-sans">
              Astropy auto-download and wall-clock auto_max_age heuristics are strictly disabled to prevent unexpected network requests and offline test failures.
            </p>
          </div>

          <div className="p-3.5 rounded-lg border border-space-border/80 bg-space-panel/60 space-y-2">
            <span className="text-slate-400 uppercase text-[10px] font-bold tracking-wider">
              3. Policy Violations & HTTP 422
            </span>
            <p className="text-amber-300 font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              EARTH_ORIENTATION_POLICY_VIOLATION
            </p>
            <p className="text-slate-400 text-[11px] font-sans">
              Calculations violating active policy bounds (e.g. predictions exceeding 30 days under strict mode) raise structured HTTP 422 errors before propagation.
            </p>
          </div>
        </div>
      </Card>

      {/* Subsystems Status Table */}
      <Card className="p-6 bg-space-surface border-space-border space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-space-border/80">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan" />
            <CardTitle className="text-sm">Astrodynamic & Computational Subsystems</CardTitle>
          </div>
          <Badge variant="cyan" size="sm">
            7 ACTIVE COMPONENTS
          </Badge>
        </div>

        <div className="overflow-x-auto rounded-lg border border-space-border bg-space-panel/40">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-space-panel/90 text-slate-400 text-[10px] uppercase border-b border-space-border">
              <tr>
                <th className="py-2.5 px-3">Subsystem</th>
                <th className="py-2.5 px-3">Module</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Specifications & Architectural Guardrails</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-space-border/60">
              {SUBSYSTEMS.map((sub, idx) => (
                <tr key={idx} className="hover:bg-space-surface/60">
                  <td className="py-3 px-3 font-semibold text-slate-200">
                    <div className="flex items-center gap-2">
                      {sub.icon}
                      <span>{sub.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-cyan text-[11px] whitespace-nowrap">
                    {sub.module}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <Badge
                      variant={
                        sub.status === "OPERATIONAL" || sub.status === "VALIDATED" || sub.status === "OFFLINE_PREDICTIVE"
                          ? "emerald"
                          : "amber"
                      }
                      size="sm"
                    >
                      {sub.status}
                    </Badge>
                  </td>
                  <td className="py-3 px-3 text-[11px] text-slate-400 max-w-md">
                    {sub.desc}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* API Endpoints Directory Card */}
      <Card className="p-6 bg-space-surface border-space-border space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-space-border/80">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-cyan animate-pulse" />
            <CardTitle className="text-sm">Mounted FastAPI Endpoints Directory</CardTitle>
          </div>
          <Badge variant="blue" size="sm">
            6 ENDPOINTS
          </Badge>
        </div>

        <div className="space-y-2 text-xs font-mono">
          {ENDPOINTS.map((ep) => (
            <div
              key={ep.path}
              className="flex items-center justify-between p-3 rounded-lg border border-space-border/60 bg-space-panel/40 hover:bg-space-panel transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 rounded bg-cyan/10 border border-cyan/30 text-cyan font-bold text-[10px]">
                  {ep.method}
                </span>
                <span className="text-slate-200 font-bold">{ep.path}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-[11px] font-sans hidden md:inline">
                  {ep.desc}
                </span>
                <Badge variant={apiStatus.connected ? "emerald" : "slate"} size="sm">
                  {apiStatus.connected ? "READY" : "STANDBY"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
