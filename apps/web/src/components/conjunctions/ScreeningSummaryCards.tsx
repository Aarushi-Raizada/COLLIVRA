import React from "react";
import { ConjunctionScreeningSummary, EarthOrientationQuality } from "@/types/api";
import { formatUtcDateTime } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { EarthOrientationQualityBadge } from "@/components/ui/EarthOrientationQualityBadge";
import {
  Activity,
  Layers,
  AlertTriangle,
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ShieldAlert,
  Cpu,
  Database,
  Radio,
} from "lucide-react";

export interface ScreeningSummaryCardsProps {
  summary: ConjunctionScreeningSummary;
  sourceBadge?: string;
  className?: string;
  earthOrientation?: EarthOrientationQuality | null;
}

export const ScreeningSummaryCards: React.FC<ScreeningSummaryCardsProps> = ({
  summary,
  sourceBadge,
  className = "",
  earthOrientation,
}) => {
  return (
    <div className={`space-y-3 2xl:space-y-4 ${className}`}>
      {/* Top 4 Threat Intelligence KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 2xl:gap-4 items-stretch">
        <MetricCard
          label="Total Screened Events"
          value={summary.total_events}
          sublabel={`TCA Window: ${summary.start_time ? "Active Horizon" : "72 Hours"}`}
          icon={<ShieldAlert className="h-5 w-5 text-cyan" />}
          variant="cyan"
          className="h-full min-h-[105px]"
        />

        <MetricCard
          label="Critical Severity (< 1 km)"
          value={summary.critical_count}
          sublabel="Immediate Collision Alert Shell"
          icon={<AlertTriangle className="h-5 w-5 text-rose-400" />}
          variant="rose"
          className="h-full min-h-[105px]"
        />

        <MetricCard
          label="High & Moderate (1–10 km)"
          value={summary.high_count + summary.moderate_count}
          sublabel={`${summary.high_count} High (1–5 km) · ${summary.moderate_count} Mod (5–10 km)`}
          icon={<ShieldAlert className="h-5 w-5 text-amber-400" />}
          variant="amber"
          className="h-full min-h-[105px]"
        />

        <MetricCard
          label="Low Severity (≥ 10 km)"
          value={summary.low_count}
          sublabel={`Threshold: ≤ ${summary.threshold_km} km`}
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-400" />}
          variant="emerald"
          className="h-full min-h-[105px]"
        />
      </div>

      {/* Execution Diagnostics & Provenance Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg border border-space-border bg-space-surface/90 backdrop-blur-md text-xs font-mono">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-cyan">
            <Radio className="h-3.5 w-3.5 animate-pulse text-cyan" />
            <span className="font-semibold uppercase tracking-wider text-slate-200">
              Screening Engine Status:
            </span>
          </div>

          <Badge variant="cyan" size="sm" className="font-bold">
            {summary.target_frame || "GCRS"} Inertial
          </Badge>

          <EarthOrientationQualityBadge
            quality={earthOrientation}
            targetFrame={summary.target_frame}
          />

          {sourceBadge && (
            <Badge
              variant={sourceBadge.includes("DEMO") ? "amber" : "emerald"}
              size="sm"
              className="font-bold"
            >
              {sourceBadge}
            </Badge>
          )}

          <span className="text-slate-600 hidden md:inline">•</span>

          <span className="text-slate-400">
            Catalog: <strong className="text-slate-200">{summary.resolved_objects_count}</strong> / {summary.total_objects} Objects
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-400">
          <span>
            Pairs: <strong className="text-slate-200">{summary.total_pairs_considered}</strong>
          </span>
          <span className="text-slate-600 hidden sm:inline">•</span>
          <span>
            Compute: <strong className="text-cyan font-bold">{summary.execution_time_seconds.toFixed(3)}s</strong>
          </span>
          <span className="text-slate-600 hidden sm:inline">•</span>
          <span className="text-slate-400">
            Processed: {formatUtcDateTime(summary.processed_at)}
          </span>
        </div>
      </div>
    </div>
  );
};
