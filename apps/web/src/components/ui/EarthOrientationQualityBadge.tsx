import React, { useState } from "react";
import { EarthOrientationQuality, EarthOrientationProvenanceTier } from "@/types/api";
import { Badge } from "./Badge";
import { ShieldCheck, AlertTriangle, AlertCircle, Info, HelpCircle } from "lucide-react";

export interface EarthOrientationQualityBadgeProps {
  quality?: EarthOrientationQuality | null;
  targetFrame?: string;
  showDetails?: boolean;
  className?: string;
}

const KNOWN_PROVENANCE_TIERS: ReadonlySet<string> = new Set<EarthOrientationProvenanceTier>([
  "OBSERVED_EOP",
  "FORWARD_PREDICTION",
  "UNMAINTAINED_PREDICTION",
  "BOUNDARY_FALLBACK",
  "HISTORICAL_FALLBACK",
  "UNCALIBRATED_FALLBACK",
]);

/**
 * Reusable Earth Orientation Parameter (IERS) Quality & Provenance Badge.
 *
 * Implements strict scientific integrity guardrails:
 * - Never converts missing metadata into a false healthy status.
 * - Distinctly displays TEME null frames without false EOP validation.
 * - Displays exact backend provenance tiers and prediction horizons.
 * - Highlights degraded predictions (>30 days or boundary fallbacks).
 * - Safely handles unknown future enum variants without silent promotion to healthy.
 */
export const EarthOrientationQualityBadge: React.FC<EarthOrientationQualityBadgeProps> = ({
  quality,
  targetFrame,
  showDetails = false,
  className = "",
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // 1. Missing or Null Metadata
  if (!quality) {
    if (targetFrame === "TEME") {
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono border border-slate-700 bg-slate-900/60 text-slate-400 ${className}`}
          title="Raw SGP4 ephemeris operates in TEME. Coordinate transformations to GCRF/ITRF not applied; no EOP parameters needed."
        >
          <Info className="h-3 w-3 text-slate-500" />
          <span>TEME · EOP N/A (Inertial Base)</span>
        </span>
      );
    }

    // Non-TEME or missing metadata: never substitute with a false healthy badge!
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono border border-slate-700/80 bg-slate-900/60 text-slate-400 ${className}`}
        title="No Earth orientation parameter quality metadata provided by backend."
      >
        <HelpCircle className="h-3 w-3 text-slate-500" />
        <span>EOP: Not Provided</span>
      </span>
    );
  }

  // 2. Safe mapping for unknown/unsupported future enum tiers
  const isKnownTier = KNOWN_PROVENANCE_TIERS.has(quality.provenance_tier);
  const isDegraded = quality.is_degraded;

  // Determine badge styling and label
  let badgeVariant: "emerald" | "amber" | "rose" | "cyan" = "emerald";
  let icon = <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />;
  let label = "";

  if (!isKnownTier) {
    badgeVariant = "amber";
    icon = <AlertCircle className="h-3.5 w-3.5 text-amber-400" />;
    label = `Unknown Provenance: ${quality.provenance_tier}`;
  } else if (isDegraded) {
    if (quality.data_source === "OUT_OF_RANGE" || quality.data_source === "UNAVAILABLE") {
      badgeVariant = "rose";
      icon = <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />;
    } else {
      badgeVariant = "amber";
      icon = <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />;
    }

    switch (quality.provenance_tier) {
      case "FORWARD_PREDICTION":
        label = `Predicted EOP (${quality.prediction_horizon_days !== null ? `+${quality.prediction_horizon_days.toFixed(1)}d` : ">30d"} · Degraded)`;
        break;
      case "UNMAINTAINED_PREDICTION":
        label = "Unmaintained Prediction (Degraded)";
        break;
      case "BOUNDARY_FALLBACK":
        label = "Boundary Fallback (Degraded)";
        break;
      case "HISTORICAL_FALLBACK":
        label = "Historical Fallback (Degraded)";
        break;
      case "UNCALIBRATED_FALLBACK":
        label = "Uncalibrated Fallback (Degraded)";
        break;
      default:
        label = `${quality.provenance_tier} (Degraded)`;
    }
  } else {
    // Healthy / Calibrated EOP
    badgeVariant = "emerald";
    icon = <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />;

    switch (quality.provenance_tier) {
      case "OBSERVED_EOP":
        label = "Observed EOP (Calibrated)";
        break;
      case "FORWARD_PREDICTION":
        label = `Predicted EOP (${quality.prediction_horizon_days !== null ? `${quality.prediction_horizon_days.toFixed(1)}d` : "≤30d"})`;
        break;
      default:
        label = quality.provenance_tier;
    }
  }

  const horizonText =
    quality.prediction_horizon_days !== null
      ? `${quality.prediction_horizon_days.toFixed(1)} days`
      : "Not provided (definitive epoch)";

  return (
    <div className={`inline-flex flex-col ${className}`}>
      <div
        className="inline-flex items-center gap-1.5 cursor-pointer group"
        onClick={() => setIsExpanded(!isExpanded)}
        title="Click to toggle Earth orientation quality & IERS provenance details"
      >
        <Badge variant={badgeVariant} size="sm" className="font-mono flex items-center gap-1 font-semibold">
          {icon}
          <span>{label}</span>
        </Badge>
      </div>

      {(showDetails || isExpanded) && (
        <div className="mt-1.5 p-2 rounded border border-space-border bg-space-surface/95 backdrop-blur-md text-[10px] font-mono text-slate-300 space-y-1 shadow-lg max-w-sm">
          <div className="flex justify-between border-b border-space-border/60 pb-1">
            <span className="text-slate-400">Data Source Tier:</span>
            <span className="text-cyan font-bold">{quality.data_source}</span>
          </div>
          <div className="flex justify-between border-b border-space-border/60 pb-1">
            <span className="text-slate-400">Provenance Tier:</span>
            <span className="text-slate-200">{quality.provenance_tier}</span>
          </div>
          <div className="flex justify-between border-b border-space-border/60 pb-1">
            <span className="text-slate-400">Prediction Horizon:</span>
            <span className={quality.is_degraded ? "text-amber-300 font-bold" : "text-emerald-300"}>
              {horizonText}
            </span>
          </div>
          <div className="flex justify-between border-b border-space-border/60 pb-1">
            <span className="text-slate-400">Degraded Flag:</span>
            <span className={quality.is_degraded ? "text-amber-400 font-bold" : "text-emerald-400"}>
              {quality.is_degraded ? "TRUE (Stale / Fallback)" : "FALSE (Nominal)"}
            </span>
          </div>
          <div className="flex justify-between border-b border-space-border/60 pb-1">
            <span className="text-slate-400">Raw Astropy Status:</span>
            <span className="text-slate-400">UT1: {quality.ut1_status} · PM: {quality.pm_status}</span>
          </div>
          {quality.table_publication_age_days !== null && (
            <div className="flex justify-between border-b border-space-border/60 pb-1">
              <span className="text-slate-400">Table Age:</span>
              <span className="text-slate-300">{quality.table_publication_age_days.toFixed(1)} days</span>
            </div>
          )}
          <p className="text-[9px] text-slate-400 pt-1 italic leading-tight">
            {quality.earth_orientation_disclaimer}
          </p>
        </div>
      )}
    </div>
  );
};
