"use client";

import React, { useMemo } from "react";
import { BreakupRemediationResponse } from "@/types/simulation";
import type { ScenarioUrn } from "@/types/shared_state";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { MetricCard } from "../ui/MetricCard";
import { Badge } from "../ui/Badge";
import {
  Crosshair,
  Target,
  Zap,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  XCircle,
  Clock,
  Activity,
  Sparkles,
  Cpu,
  Gauge,
} from "lucide-react";

export interface RemediationResultsViewProps {
  response: BreakupRemediationResponse;
  isDemo?: boolean;
  deltaVBudgetMs?: number;
  scenarioUrn?: ScenarioUrn | null;
}

export interface DeltaVBudgetAnalysis {
  requiredDeltaVMs: number;
  budgetDeltaVMs: number;
  utilizationPercent: number;
  remainingMarginMs: number;
  isBudgetExceeded: boolean;
}

/**
 * Pure calculation helper to evaluate Delta-V budget utilization and margin.
 * Strictly adheres to astrodynamics guardrails:
 * - budgetDeltaVMs must be finite and strictly greater than zero (> 0).
 * - totalDeltaVMs must be finite and greater than or equal to zero (>= 0).
 * - A required delta-v of exactly zero returns utilization: 0%, margin: budgetDeltaVMs, isBudgetExceeded: false.
 * - Negative, missing, or non-finite required delta-v returns null.
 * - Missing, zero, negative, or non-finite budget returns null.
 * - Does not invent missing budget data.
 * - Labels remaining capacity as delta-v margin, never propellant margin.
 */
export function calculateDeltaVBudgetMetrics(
  totalDeltaVMs: number | null | undefined,
  budgetDeltaVMs: number | null | undefined
): DeltaVBudgetAnalysis | null {
  if (
    typeof totalDeltaVMs !== "number" ||
    typeof budgetDeltaVMs !== "number" ||
    !Number.isFinite(totalDeltaVMs) ||
    !Number.isFinite(budgetDeltaVMs) ||
    totalDeltaVMs < 0 ||
    budgetDeltaVMs <= 0
  ) {
    return null;
  }

  const utilizationPercent =
    totalDeltaVMs === 0 ? 0 : (totalDeltaVMs / budgetDeltaVMs) * 100;
  const remainingMarginMs = budgetDeltaVMs - totalDeltaVMs;
  const isBudgetExceeded = totalDeltaVMs > budgetDeltaVMs;

  return {
    requiredDeltaVMs: totalDeltaVMs,
    budgetDeltaVMs,
    utilizationPercent,
    remainingMarginMs,
    isBudgetExceeded,
  };
}

export type DeltaVBudgetStatusTier = "healthy" | "marginal" | "exceeded";

export interface DeltaVGaugeState {
  statusTier: DeltaVBudgetStatusTier;
  statusLabel: string;
  badgeVariant: "emerald" | "amber" | "rose";
  barColorClass: string;
  textColorClass: string;
  borderColorClass: string;
  bgGlowClass: string;
  visualBarWidthPercent: number;
  formattedUtilization: string;
  formattedMargin: string;
  formattedRequired: string;
  formattedBudget: string;
}

/**
 * Pure evaluation helper to determine visual styling, tier classification,
 * formatted values, and capped progress bar width for the Delta-V Budget Gauge.
 * Adheres strictly to guardrails:
 * - <80%: emerald / healthy
 * - 80% through 100%: amber / marginal
 * - >100%: rose / exceeded
 * - Visual bar width capped at 100% while actual utilization remains uncapped
 * - Returns null if budget analysis is missing or unavailable
 */
export function getDeltaVGaugeState(
  analysis: DeltaVBudgetAnalysis | null
): DeltaVGaugeState | null {
  if (!analysis) return null;

  const { utilizationPercent, remainingMarginMs, requiredDeltaVMs, budgetDeltaVMs } =
    analysis;

  let statusTier: DeltaVBudgetStatusTier;
  let statusLabel: string;
  let badgeVariant: "emerald" | "amber" | "rose";
  let barColorClass: string;
  let textColorClass: string;
  let borderColorClass: string;
  let bgGlowClass: string;

  if (utilizationPercent < 80.0) {
    statusTier = "healthy";
    statusLabel = "HEALTHY (WITHIN BUDGET)";
    badgeVariant = "emerald";
    barColorClass = "bg-emerald-500";
    textColorClass = "text-emerald-400";
    borderColorClass = "border-emerald-500/30";
    bgGlowClass = "bg-emerald-950/20";
  } else if (utilizationPercent <= 100.0) {
    statusTier = "marginal";
    statusLabel = "MARGINAL (HIGH UTILIZATION)";
    badgeVariant = "amber";
    barColorClass = "bg-amber-500";
    textColorClass = "text-amber-400";
    borderColorClass = "border-amber-500/30";
    bgGlowClass = "bg-amber-950/20";
  } else {
    statusTier = "exceeded";
    statusLabel = "BUDGET EXCEEDED";
    badgeVariant = "rose";
    barColorClass = "bg-rose-500";
    textColorClass = "text-rose-400";
    borderColorClass = "border-rose-500/30";
    bgGlowClass = "bg-rose-950/20";
  }

  // Visual progress bar width is capped at 100% for exceeded scenarios
  const visualBarWidthPercent = Math.min(100, Math.max(0, utilizationPercent));

  // Actual utilization percentage is displayed without capping
  const formattedUtilization =
    utilizationPercent >= 1000
      ? `${Math.round(utilizationPercent).toLocaleString("en-US")}%`
      : `${utilizationPercent.toFixed(2)}%`;

  const marginSign = remainingMarginMs > 0 ? "+" : "";
  const formattedMargin = `${marginSign}${remainingMarginMs.toFixed(3)} m/s`;
  const formattedRequired = `${requiredDeltaVMs.toFixed(3)} m/s`;
  const formattedBudget = `${budgetDeltaVMs.toFixed(3)} m/s`;

  return {
    statusTier,
    statusLabel,
    badgeVariant,
    barColorClass,
    textColorClass,
    borderColorClass,
    bgGlowClass,
    visualBarWidthPercent,
    formattedUtilization,
    formattedMargin,
    formattedRequired,
    formattedBudget,
  };
}

export type HillAxis = "R" | "I" | "C";

export interface HillComponentBreakdown {
  axis: HillAxis;
  axisName: string;
  axisSymbol: string;
  valueMs: number;
  formattedValue: string;
  directionSymbol: "+R" | "−R" | "0R" | "+I" | "−I" | "0I" | "+C" | "−C" | "0C";
  directionLabel: string;
  directionDescription: string;
  barPercent: number; // 0 to 50% relative to center 50%
  barSide: "left" | "right" | "center";
  colorClass: string;
  textColorClass: string;
  badgeVariant: "cyan" | "emerald" | "amber" | "slate";
  isZero: boolean;
  isValid: boolean;
}

export interface BurnVectorBreakdown {
  burnName: string;
  burnType: "Departure" | "Arrival";
  magnitudeMs: number;
  formattedMagnitude: string;
  components: [HillComponentBreakdown, HillComponentBreakdown, HillComponentBreakdown];
  isValid: boolean;
}

/**
 * Pure helper to compute Hill/RIC directional component breakdown for a burn vector.
 * Mandatory coordinate convention: [0] = Radial (R), [1] = In-Track (I), [2] = Cross-Track (C).
 * Scales bars symmetrically around 0 against maxScaleMs.
 */
export function computeHillComponentBreakdown(
  axis: HillAxis,
  rawValue: number | null | undefined,
  maxScaleMs: number
): HillComponentBreakdown {
  const isValid = typeof rawValue === "number" && Number.isFinite(rawValue);
  const value = isValid ? rawValue : 0;
  const isZero = isValid && Math.abs(value) < 1e-5;

  let axisName: string;
  let colorClass: string;
  let textColorClass: string;
  let badgeVariant: "cyan" | "emerald" | "amber" | "slate";

  switch (axis) {
    case "R":
      axisName = "Radial";
      colorClass = "bg-cyan";
      textColorClass = "text-cyan";
      badgeVariant = "cyan";
      break;
    case "I":
      axisName = "In-Track";
      colorClass = "bg-emerald-500";
      textColorClass = "text-emerald-400";
      badgeVariant = "emerald";
      break;
    case "C":
      axisName = "Cross-Track";
      colorClass = "bg-amber-500";
      textColorClass = "text-amber-400";
      badgeVariant = "amber";
      break;
  }

  if (!isValid) {
    return {
      axis,
      axisName,
      axisSymbol: axis,
      valueMs: 0,
      formattedValue: "Invalid",
      directionSymbol: `0${axis}` as any,
      directionLabel: "UNAVAILABLE",
      directionDescription: `${axisName} component unavailable`,
      barPercent: 0,
      barSide: "center",
      colorClass: "bg-slate-600",
      textColorClass: "text-slate-500",
      badgeVariant: "slate",
      isZero: true,
      isValid: false,
    };
  }

  let directionSymbol: "+R" | "−R" | "0R" | "+I" | "−I" | "0I" | "+C" | "−C" | "0C";
  let directionLabel: string;
  let directionDescription: string;
  let barSide: "left" | "right" | "center";

  if (isZero) {
    directionSymbol = `0${axis}` as any;
    directionLabel = "NEAR ZERO";
    directionDescription = `Zero ${axisName} (0 m/s)`;
    barSide = "center";
  } else if (axis === "R") {
    if (value > 0) {
      directionSymbol = "+R";
      directionLabel = "+R Outward";
      directionDescription = "Outward Radial (+R)";
      barSide = "right";
    } else {
      directionSymbol = "−R";
      directionLabel = "−R Inward";
      directionDescription = "Inward Radial (−R)";
      barSide = "left";
    }
  } else if (axis === "I") {
    if (value > 0) {
      directionSymbol = "+I";
      directionLabel = "+I Prograde";
      directionDescription = "Prograde / Along-Track (+I)";
      barSide = "right";
    } else {
      directionSymbol = "−I";
      directionLabel = "−I Retrograde";
      directionDescription = "Retrograde / Against-Track (−I)";
      barSide = "left";
    }
  } else {
    // Cross-Track (C)
    if (value > 0) {
      directionSymbol = "+C";
      directionLabel = "+C Positive Orbit Normal";
      directionDescription = "Positive Cross-Track (+C)";
      barSide = "right";
    } else {
      directionSymbol = "−C";
      directionLabel = "−C Negative Orbit Normal";
      directionDescription = "Negative Cross-Track (−C)";
      barSide = "left";
    }
  }

  // Format signed numerical value in m/s with 4 decimal places
  const sign = value > 0 ? "+" : "";
  const formattedValue = isZero ? "0.0000 m/s" : `${sign}${value.toFixed(4)} m/s`;

  // Symmetric bar scaling: 0% to 50% relative to center line (50%)
  const scale = maxScaleMs > 1e-4 ? maxScaleMs : 1.0;
  const barPercent = isZero ? 0 : Math.min(50, (Math.abs(value) / scale) * 50);

  return {
    axis,
    axisName,
    axisSymbol: axis,
    valueMs: value,
    formattedValue,
    directionSymbol,
    directionLabel,
    directionDescription,
    barPercent,
    barSide,
    colorClass,
    textColorClass,
    badgeVariant,
    isZero,
    isValid: true,
  };
}

/**
 * Pure helper to compute complete breakdown for Burn 1 or Burn 2.
 * Adheres strictly to backend array ordering: [0] = Radial, [1] = In-Track, [2] = Cross-Track.
 */
export function computeBurnVectorBreakdown(
  burnName: string,
  burnType: "Departure" | "Arrival",
  vector: [number, number, number] | number[] | null | undefined,
  maxScaleMs: number
): BurnVectorBreakdown {
  if (!vector || !Array.isArray(vector) || vector.length < 3) {
    const defaultComp = (a: HillAxis) => computeHillComponentBreakdown(a, null, maxScaleMs);
    return {
      burnName,
      burnType,
      magnitudeMs: 0,
      formattedMagnitude: "Unavailable",
      components: [defaultComp("R"), defaultComp("I"), defaultComp("C")],
      isValid: false,
    };
  }

  const [r, i, c] = vector;
  const isValid =
    Number.isFinite(r) && Number.isFinite(i) && Number.isFinite(c);
  const magnitudeMs = isValid ? Math.sqrt(r * r + i * i + c * c) : 0;
  const formattedMagnitude = isValid ? `${magnitudeMs.toFixed(4)} m/s` : "Invalid";

  return {
    burnName,
    burnType,
    magnitudeMs,
    formattedMagnitude,
    components: [
      computeHillComponentBreakdown("R", r, maxScaleMs),
      computeHillComponentBreakdown("I", i, maxScaleMs),
      computeHillComponentBreakdown("C", c, maxScaleMs),
    ],
    isValid,
  };
}

export interface ScientificBoundaryPoint {
  id: string;
  category: string;
  summary: string;
  detail: string;
}

export const CW_SCIENTIFIC_BOUNDARY_DISCLOSURE = {
  headline:
    "Idealized instantaneous open-loop velocity impulses, not verified closed-loop spacecraft guidance commands.",
  intro:
    "Clohessy-Wiltshire (Hill's) equations model linearized relative-motion dynamics in a near-circular reference orbit (e ≤ 0.005). The computed two-impulse trajectory provides analytical decision-support and delta-v budget estimation under the following explicit boundary assumptions:",
  points: [
    {
      id: "instantaneous-impulses",
      category: "Instantaneous Impulses",
      summary: "Zero-duration Δv velocity increments",
      detail:
        "Burns are modelled as instantaneous changes in velocity. Finite engine burn duration and thrust profiles are not modelled.",
    },
    {
      id: "attitude-pointing",
      category: "Attitude & Pointing",
      summary: "Actuator and slew dynamics unmodelled",
      detail:
        "Spacecraft attitude slew, pointing constraints and actuator dynamics are not modelled.",
    },
    {
      id: "closed-loop-guidance",
      category: "Closed-Loop Guidance",
      summary: "Open-loop relative targeting",
      detail:
        "No onboard navigation feedback, guidance corrections, or closed-loop tracking errors are simulated.",
    },
    {
      id: "linearized-perturbations",
      category: "Perturbations",
      summary: "Linearized Hill relative frame",
      detail:
        "The CW model relies on linearized relative-motion dynamics in a near-circular reference orbit (e ≤ 0.005) and does not represent all real orbital perturbations (e.g. Earth oblateness J₂, atmospheric drag, or solar radiation pressure).",
    },
    {
      id: "operational-qualification",
      category: "Operational Qualification",
      summary: "Research decision-support only",
      detail:
        "A mathematically feasible solution is not proof of flight readiness, safe execution, or successful rendezvous.",
    },
  ] as ScientificBoundaryPoint[],
};

export const CW_SCIENTIFIC_DISCLOSURE_TEXT =
  "SCIENTIFIC BOUNDARY & OPERATIONAL LIMITATIONS DISCLOSURE: Planned CW burns are idealized instantaneous open-loop velocity impulses, not verified closed-loop spacecraft guidance commands. " +
  "Precondition: Near-circular reference orbit (e ≤ 0.005). " +
  "(1) Instantaneous Impulses: Burns are modelled as instantaneous changes in velocity. Finite engine burn duration and thrust profiles are not modelled. " +
  "(2) Attitude & Pointing: Spacecraft attitude slew, pointing constraints and actuator dynamics are not modelled. " +
  "(3) Closed-Loop Guidance: No onboard navigation feedback, guidance corrections, or closed-loop tracking errors are simulated. " +
  "(4) Perturbations: The CW model relies on linearized relative-motion dynamics and does not represent all real orbital perturbations. " +
  "(5) Operational Qualification: A mathematically feasible solution is not proof of flight readiness, safe execution, or successful rendezvous.";

export const RemediationResultsView: React.FC<RemediationResultsViewProps> = ({
  response,
  isDemo = false,
  deltaVBudgetMs,
  scenarioUrn,
}) => {
  const {
    selected_target,
    contract,
    rendezvous,
    execution_wall_time_s,
    scientific_disclaimer,
  } = response;

  const budgetAnalysis = useMemo(
    () => calculateDeltaVBudgetMetrics(rendezvous?.total_delta_v_ms, deltaVBudgetMs),
    [rendezvous?.total_delta_v_ms, deltaVBudgetMs]
  );

  const gaugeState = useMemo(
    () => getDeltaVGaugeState(budgetAnalysis),
    [budgetAnalysis]
  );

  const burn1Mag = useMemo(() => {
    const [r, t, n] = rendezvous.burn_1_dv_cw_ms;
    return Math.sqrt(r * r + t * t + n * n);
  }, [rendezvous.burn_1_dv_cw_ms]);

  const burn2Mag = useMemo(() => {
    const [r, t, n] = rendezvous.burn_2_dv_cw_ms;
    return Math.sqrt(r * r + t * t + n * n);
  }, [rendezvous.burn_2_dv_cw_ms]);

  const maxBurnComponentMs = useMemo(() => {
    const b1 = rendezvous.burn_1_dv_cw_ms;
    const b2 = rendezvous.burn_2_dv_cw_ms;
    const c1 = Array.isArray(b1) ? b1.map(Math.abs).filter(Number.isFinite) : [];
    const c2 = Array.isArray(b2) ? b2.map(Math.abs).filter(Number.isFinite) : [];
    const maxVal = Math.max(0.1, ...c1, ...c2);
    return maxVal;
  }, [rendezvous.burn_1_dv_cw_ms, rendezvous.burn_2_dv_cw_ms]);

  const burn1Breakdown = useMemo(
    () =>
      computeBurnVectorBreakdown(
        "Burn 1 — Departure (Injection Burn at t₀)",
        "Departure",
        rendezvous.burn_1_dv_cw_ms,
        maxBurnComponentMs
      ),
    [rendezvous.burn_1_dv_cw_ms, maxBurnComponentMs]
  );

  const burn2Breakdown = useMemo(
    () =>
      computeBurnVectorBreakdown(
        "Burn 2 — Arrival / Terminal Correction",
        "Arrival",
        rendezvous.burn_2_dv_cw_ms,
        maxBurnComponentMs
      ),
    [rendezvous.burn_2_dv_cw_ms, maxBurnComponentMs]
  );

  const isSolvable = rendezvous.is_mathematically_solvable;
  const isBudgetFeasible = rendezvous.is_budget_feasible;
  const isOverallFeasible = rendezvous.is_feasible;

  return (
    <div className="space-y-5">
      {/* Explicit Data Provenance Indicator */}
      {isDemo ? (
        <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-950/30 text-amber-200 text-xs font-mono flex items-center justify-between shadow-panel">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
            <span>
              <strong>SYNTHETIC DEMONSTRATION SCENARIO:</strong> Numerical metrics displayed below (CW condition number {rendezvous.condition_number.toExponential(2)}, terminal error {(rendezvous.terminal_position_error_m).toFixed(3)} m) are precomputed illustrative values for offline preview, NOT live backend outputs.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scenarioUrn && (
              <div
                data-testid="remediation-scenario-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-amber-500/10 border border-amber-500/30 text-amber-300"
              >
                <span className="text-slate-400">SCENARIO:</span>
                <span className="font-semibold">{scenarioUrn}</span>
              </div>
            )}
            <Badge variant="amber" size="sm">DEMO FIXTURE</Badge>
          </div>
        </div>
      ) : (
        <div className="p-2.5 rounded-lg border border-cyan/40 bg-cyan-950/20 text-cyan-200 text-xs font-mono flex items-center justify-between shadow-panel">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan shrink-0" />
            <span>
              <strong>LIVE BACKEND EVALUATION:</strong> Evaluated by FastAPI Clohessy-Wiltshire solver in GCRS/Hill frame.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scenarioUrn && (
              <div
                data-testid="remediation-scenario-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-cyan/10 border border-cyan/30 text-cyan"
              >
                <span className="text-slate-400">SCENARIO:</span>
                <span className="font-semibold text-cyan-300">{scenarioUrn}</span>
              </div>
            )}
            <Badge variant="cyan" size="sm">LIVE EVALUATION</Badge>
          </div>
        </div>
      )}
      {/* 1. Dual Feasibility Status Banner */}
      {isOverallFeasible ? (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-emerald-200 flex items-start gap-3.5 shadow-panel">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-wide font-mono uppercase text-emerald-300">
                Remediation Plan Feasible — Within Delta-V Budget
              </span>
              <Badge variant="emerald" size="sm">FEASIBLE</Badge>
            </div>
            <p className="text-xs text-emerald-300/80 leading-relaxed font-sans">
              Two-impulse Clohessy-Wiltshire rendezvous burns satisfy linear relative dynamics and remain strictly within the allotted Delta-V fuel budget ({rendezvous.total_delta_v_ms.toFixed(3)} m/s total).
            </p>
          </div>
        </div>
      ) : isSolvable && isBudgetFeasible === false ? (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/50 text-amber-200 flex items-start gap-3.5 shadow-panel">
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-wide font-mono uppercase text-amber-300">
                Mathematically Solvable but Budget Infeasible
              </span>
              <Badge variant="amber" size="sm">BUDGET INFEASIBLE</Badge>
            </div>
            <p className="text-xs text-amber-300/80 leading-relaxed font-sans">
              The orbital transfer is mathematically well-conditioned and solvable, but the required Delta-V ({rendezvous.total_delta_v_ms.toFixed(3)} m/s) exceeds the active chaser propulsion budget. This is an evaluated trajectory solution, not an algorithmic failure.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/50 text-rose-200 flex items-start gap-3.5 shadow-panel">
          <XCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-wide font-mono uppercase text-rose-300">
                Unsolvable Relative Motion Transfer
              </span>
              <Badge variant="rose" size="sm">ILL-CONDITIONED</Badge>
            </div>
            <p className="text-xs text-rose-300/80 leading-relaxed font-sans">
              The Clohessy-Wiltshire fundamental state transition matrix is ill-conditioned or singular (condition number: {rendezvous.condition_number.toExponential(2)}). Transfer cannot be achieved with two impulses at the requested transfer duration.
            </p>
          </div>
        </div>
      )}

      {/* 2. Delta-V Propulsion Budget Gauge */}
      <Card className="bg-space-surface border-space-border shadow-panel">
        <CardHeader className="flex items-center justify-between border-b border-space-border pb-3 mb-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-cyan" />
            <CardTitle className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Delta-V Propulsion Budget Gauge
            </CardTitle>
          </div>
          {gaugeState ? (
            <Badge variant={gaugeState.badgeVariant} size="sm">
              {gaugeState.statusLabel}
            </Badge>
          ) : (
            <Badge variant="slate" size="sm">
              BUDGET UNAVAILABLE
            </Badge>
          )}
        </CardHeader>

        {gaugeState && budgetAnalysis ? (
          <div className="space-y-4">
            {/* Metric Overview Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 font-mono text-xs">
              <div className="p-2.5 rounded bg-space-dark border border-space-border">
                <span className="text-[10px] text-slate-400 block uppercase">Required ΔV</span>
                <span className="text-slate-100 font-bold text-sm block mt-0.5">
                  {gaugeState.formattedRequired}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Maneuver total</span>
              </div>

              <div className="p-2.5 rounded bg-space-dark border border-space-border">
                <span className="text-[10px] text-slate-400 block uppercase">Configured Budget</span>
                <span className="text-cyan font-bold text-sm block mt-0.5">
                  {gaugeState.formattedBudget}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Mission allocation</span>
              </div>

              <div className="p-2.5 rounded bg-space-dark border border-space-border">
                <span className="text-[10px] text-slate-400 block uppercase">Utilization</span>
                <span className={`font-bold text-sm block mt-0.5 ${gaugeState.textColorClass}`}>
                  {gaugeState.formattedUtilization}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Capacity used</span>
              </div>

              <div className="p-2.5 rounded bg-space-dark border border-space-border">
                <span className="text-[10px] text-slate-400 block uppercase">Remaining Margin</span>
                <span className={`font-bold text-sm block mt-0.5 ${gaugeState.textColorClass}`}>
                  {gaugeState.formattedMargin}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Delta-V margin</span>
              </div>
            </div>

            {/* Visual Gauge Bar */}
            <div className="p-3.5 rounded-lg bg-space-dark border border-space-border space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Budget Consumption:</span>
                  <span className={`font-bold ${gaugeState.textColorClass}`}>
                    {gaugeState.formattedUtilization}
                  </span>
                  {budgetAnalysis.isBudgetExceeded && (
                    <span className="text-[10px] text-rose-400 font-sans">
                      (Exceeds budget by {Math.abs(budgetAnalysis.remainingMarginMs).toFixed(3)} m/s)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    <span>&lt;80% Healthy</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                    <span>80–100% Marginal</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-rose-500" />
                    <span>&gt;100% Exceeded</span>
                  </span>
                </div>
              </div>

              {/* Progress Bar Container */}
              <div className="relative h-3 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                {/* 80% Warning Marker */}
                <div
                  className="absolute top-0 bottom-0 left-[80%] w-px bg-amber-500/40 z-10"
                  title="80% Warning Threshold"
                />
                {/* 100% Budget Limit Marker */}
                <div
                  className="absolute top-0 bottom-0 left-[100%] w-0.5 bg-rose-500/80 z-10 -ml-0.5"
                  title="100% Limit"
                />
                {/* Active Fill Bar (Capped at 100%) */}
                <div
                  className={`h-full transition-all duration-300 ${gaugeState.barColorClass}`}
                  style={{ width: `${gaugeState.visualBarWidthPercent}%` }}
                />
              </div>

              {/* Bar Axis Labels */}
              <div className="flex justify-between text-[10px] font-mono text-slate-500 px-0.5">
                <span>0.000 m/s (0%)</span>
                <span>80% Threshold</span>
                <span>Limit ({gaugeState.formattedBudget})</span>
              </div>
            </div>
          </div>
        ) : (
          /* Missing or Invalid Budget State */
          <div className="p-4 rounded-lg bg-space-dark border border-space-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-4 w-4 text-slate-400 shrink-0" />
              <div className="space-y-0.5">
                <span className="text-xs font-mono font-bold text-slate-300 block uppercase">
                  Delta-V Budget Unavailable
                </span>
                <p className="text-xs text-slate-400 font-sans">
                  No configured Delta-V budget was provided for this evaluation. Required maneuver impulse is{" "}
                  <span className="font-mono text-cyan font-bold">{rendezvous.total_delta_v_ms.toFixed(3)} m/s</span>.
                </p>
              </div>
            </div>
            <Badge variant="slate" size="sm">NOT SPECIFIED</Badge>
          </div>
        )}
      </Card>

      {/* 3. Top Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Total Delta-V"
          value={`${rendezvous.total_delta_v_ms.toFixed(3)} m/s`}
          sublabel={`Burn 1: ${burn1Mag.toFixed(3)} m/s | Burn 2: ${burn2Mag.toFixed(3)} m/s`}
          icon={<Zap className="h-4 w-4" />}
          variant={isOverallFeasible ? "emerald" : "amber"}
        />
        <MetricCard
          label="Transfer Time"
          value={`${rendezvous.transfer_time_s.toFixed(0)}s`}
          sublabel="Two-impulse flight duration"
          icon={<Clock className="h-4 w-4" />}
          variant="cyan"
        />
        <MetricCard
          label="Terminal Error"
          value={`${(rendezvous.terminal_position_error_m).toFixed(3)} m`}
          sublabel={`Velocity: ${(rendezvous.terminal_velocity_error_ms * 1000).toFixed(2)} mm/s`}
          icon={<Target className="h-4 w-4" />}
          variant="default"
        />
        <MetricCard
          label="CW Condition Number"
          value={rendezvous.condition_number.toExponential(2)}
          sublabel={`Solver wall time: ${execution_wall_time_s.toFixed(3)}s`}
          icon={<Activity className="h-4 w-4" />}
          variant="cyan"
        />
      </div>

      {/* 4. Selected Target Debris Object & Chaser Contract */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Selected Target Card */}
        <Card className="bg-space-surface border-space-border shadow-panel">
          <CardHeader className="flex items-center justify-between border-b border-space-border pb-3 mb-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-rose-400" />
              <CardTitle className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Selected Remediation Target
              </CardTitle>
            </div>
            <Badge variant="cyan" size="sm">SYNTHETIC</Badge>
          </CardHeader>

          <div className="space-y-3 text-xs font-mono">
            <div className="flex items-center justify-between p-2.5 rounded bg-space-dark border border-space-border">
              <span className="text-slate-400">Target Identifier:</span>
              <span className="text-cyan font-bold">{selected_target.fragment_id}</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded bg-space-dark border border-space-border">
              <span className="text-slate-400">Mass (Highest Compliant):</span>
              <span className="text-slate-100 font-bold">{selected_target.mass_kg.toFixed(3)} kg</span>
            </div>

            <div className="p-2.5 rounded bg-space-dark border border-space-border space-y-1">
              <span className="text-slate-400 block text-[10px]">Target GCRS Position (km):</span>
              <span className="text-slate-200 text-[11px] block">
                [{contract.target_gcrs_position_km.map((v) => v.toFixed(3)).join(", ")}]
              </span>
            </div>

            <div className="p-2.5 rounded bg-space-dark border border-space-border space-y-1">
              <span className="text-slate-400 block text-[10px]">Target GCRS Velocity (km/s):</span>
              <span className="text-slate-200 text-[11px] block">
                [{contract.target_gcrs_velocity_kms.map((v) => v.toFixed(5)).join(", ")}]
              </span>
            </div>
          </div>
        </Card>

        {/* Chaser Spacecraft & Rendezvous Contract Card */}
        <Card className="bg-space-surface border-space-border shadow-panel">
          <CardHeader className="flex items-center justify-between border-b border-space-border pb-3 mb-3">
            <div className="flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-cyan" />
              <CardTitle className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Chaser Rendezvous Contract
              </CardTitle>
            </div>
            <Badge variant="amber" size="sm">ADR CHASER</Badge>
          </CardHeader>

          <div className="space-y-3 text-xs font-mono">
            <div className="flex items-center justify-between p-2.5 rounded bg-space-dark border border-space-border">
              <span className="text-slate-400">Chaser Identifier:</span>
              <span className="text-amber-400 font-bold">{contract.chaser_id}</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded bg-space-dark border border-space-border">
              <span className="text-slate-400">Targeting Mode:</span>
              <span className="text-cyan font-bold">STANDOFF_HOLD (50.0 m)</span>
            </div>

            <div className="p-2.5 rounded bg-space-dark border border-space-border space-y-1">
              <span className="text-slate-400 block text-[10px]">Chaser GCRS Position (km):</span>
              <span className="text-slate-200 text-[11px] block">
                [{contract.chaser_gcrs_position_km.map((v) => v.toFixed(3)).join(", ")}]
              </span>
            </div>

            <div className="p-2.5 rounded bg-space-dark border border-space-border space-y-1">
              <span className="text-slate-400 block text-[10px]">Chaser GCRS Velocity (km/s):</span>
              <span className="text-slate-200 text-[11px] block">
                [{contract.chaser_gcrs_velocity_kms.map((v) => v.toFixed(5)).join(", ")}]
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* 5. Clohessy-Wiltshire Impulsive Burn Vectors (Hill / LVLH Frame) */}
      <Card className="bg-space-surface border-space-border shadow-panel">
        <CardHeader className="border-b border-space-border pb-3 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-cyan" />
              <CardTitle className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Two-Impulse Delta-V Burn Solution in Hill (RIC / LVLH) Frame
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="cyan" size="sm">Radial (R)</Badge>
              <Badge variant="emerald" size="sm">In-Track (I)</Badge>
              <Badge variant="amber" size="sm">Cross-Track (C)</Badge>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-1 font-mono">
            Target-centered Hill/RIC directional decomposition [Radial, Along-Track, Cross-Track]. Symmetric proportional scaling around zero reference (±{maxBurnComponentMs.toFixed(3)} m/s full-scale).
          </p>
        </CardHeader>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* Burn 1 — Departure */}
          <div className="p-4 rounded-xl bg-space-dark border border-space-border space-y-3.5">
            <div className="flex items-center justify-between border-b border-space-border pb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-cyan font-mono uppercase tracking-wide">
                  Burn 1 — Departure (Injection Burn at t₀)
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs">
                <span className="text-slate-400 text-[11px]">|Δv₁|:</span>
                <Badge variant="cyan" size="sm">
                  {burn1Breakdown.formattedMagnitude}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {burn1Breakdown.components.map((comp) => (
                <div
                  key={`burn1-${comp.axis}`}
                  className="p-3 rounded-lg bg-space-panel/90 border border-space-border space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={comp.badgeVariant} size="sm">
                        {comp.axis}
                      </Badge>
                      <span className="text-xs font-mono font-bold text-slate-200">
                        {comp.axisName}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                        comp.barSide === "right"
                          ? `${comp.textColorClass} bg-slate-900 border-current/30`
                          : comp.barSide === "left"
                          ? `${comp.textColorClass} bg-slate-900 border-current/30`
                          : "text-slate-400 bg-slate-900 border-slate-700"
                      }`}
                    >
                      {comp.directionLabel}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between font-mono">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      {comp.directionDescription}
                    </span>
                    <span className={`text-sm font-bold ${comp.textColorClass}`}>
                      {comp.formattedValue}
                    </span>
                  </div>

                  {/* Proportional Magnitude Bar with Center Zero Reference */}
                  <div className="space-y-1 pt-0.5">
                    <div className="relative h-2.5 w-full bg-slate-900 rounded overflow-hidden border border-slate-800">
                      {/* Center Zero Reference Line */}
                      <div
                        className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-slate-500 z-10 -ml-px"
                        title="0 m/s Reference"
                      />
                      {/* Active Directional Fill Bar */}
                      {comp.barSide === "right" && (
                        <div
                          className={`absolute top-0 bottom-0 ${comp.colorClass} transition-all duration-300`}
                          style={{ left: "50%", width: `${comp.barPercent}%` }}
                        />
                      )}
                      {comp.barSide === "left" && (
                        <div
                          className={`absolute top-0 bottom-0 ${comp.colorClass} opacity-85 transition-all duration-300`}
                          style={{
                            left: `${50 - comp.barPercent}%`,
                            width: `${comp.barPercent}%`,
                          }}
                        />
                      )}
                    </div>
                    <div className="flex justify-between text-[9px] font-mono text-slate-500 px-0.5">
                      <span>−{maxBurnComponentMs.toFixed(2)}</span>
                      <span className="text-slate-400 font-bold">0</span>
                      <span>+{maxBurnComponentMs.toFixed(2)} m/s</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Burn 2 — Arrival / Terminal Correction */}
          <div className="p-4 rounded-xl bg-space-dark border border-space-border space-y-3.5">
            <div className="flex items-center justify-between border-b border-space-border pb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-400 font-mono uppercase tracking-wide">
                  Burn 2 — Arrival / Terminal Correction
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs">
                <span className="text-slate-400 text-[11px]">|Δv₂|:</span>
                <Badge variant="amber" size="sm">
                  {burn2Breakdown.formattedMagnitude}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {burn2Breakdown.components.map((comp) => (
                <div
                  key={`burn2-${comp.axis}`}
                  className="p-3 rounded-lg bg-space-panel/90 border border-space-border space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={comp.badgeVariant} size="sm">
                        {comp.axis}
                      </Badge>
                      <span className="text-xs font-mono font-bold text-slate-200">
                        {comp.axisName}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                        comp.barSide === "right"
                          ? `${comp.textColorClass} bg-slate-900 border-current/30`
                          : comp.barSide === "left"
                          ? `${comp.textColorClass} bg-slate-900 border-current/30`
                          : "text-slate-400 bg-slate-900 border-slate-700"
                      }`}
                    >
                      {comp.directionLabel}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between font-mono">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      {comp.directionDescription}
                    </span>
                    <span className={`text-sm font-bold ${comp.textColorClass}`}>
                      {comp.formattedValue}
                    </span>
                  </div>

                  {/* Proportional Magnitude Bar with Center Zero Reference */}
                  <div className="space-y-1 pt-0.5">
                    <div className="relative h-2.5 w-full bg-slate-900 rounded overflow-hidden border border-slate-800">
                      {/* Center Zero Reference Line */}
                      <div
                        className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-slate-500 z-10 -ml-px"
                        title="0 m/s Reference"
                      />
                      {/* Active Directional Fill Bar */}
                      {comp.barSide === "right" && (
                        <div
                          className={`absolute top-0 bottom-0 ${comp.colorClass} transition-all duration-300`}
                          style={{ left: "50%", width: `${comp.barPercent}%` }}
                        />
                      )}
                      {comp.barSide === "left" && (
                        <div
                          className={`absolute top-0 bottom-0 ${comp.colorClass} opacity-85 transition-all duration-300`}
                          style={{
                            left: `${50 - comp.barPercent}%`,
                            width: `${comp.barPercent}%`,
                          }}
                        />
                      )}
                    </div>
                    <div className="flex justify-between text-[9px] font-mono text-slate-500 px-0.5">
                      <span>−{maxBurnComponentMs.toFixed(2)}</span>
                      <span className="text-slate-400 font-bold">0</span>
                      <span>+{maxBurnComponentMs.toFixed(2)} m/s</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* 6. Scientific Limitations & Operational Boundary Disclosure */}
      <Card className="bg-space-surface border-space-border shadow-panel overflow-hidden">
        <CardHeader className="border-b border-space-border pb-3 bg-space-panel/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              <CardTitle className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Scientific Boundary & Operational Limitations Disclosure
              </CardTitle>
            </div>
            <Badge variant="amber" size="sm">RESEARCH & DECISION-SUPPORT ONLY</Badge>
          </div>
        </CardHeader>

        <CardContent className="p-4 space-y-3.5">
          {/* Prominent Lead Statement Callout */}
          <div className="p-3.5 rounded-lg bg-amber-950/20 border border-amber-500/30 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-mono font-bold text-amber-300">
                Planned CW burns are {CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.headline.toLowerCase()}
              </p>
              <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
                {CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.intro}
              </p>
            </div>
          </div>

          {/* 5 Structural Limitation Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.points.map((pt, idx) => (
              <div
                key={pt.id}
                className="p-3 rounded-lg bg-space-dark/80 border border-space-border space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold text-cyan">
                    0{idx + 1}. {pt.category.toUpperCase()}
                  </span>
                  <span className="text-[9px] font-mono text-slate-500 px-1 py-0.5 rounded bg-slate-900 border border-slate-800">
                    {pt.summary}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 font-sans leading-relaxed">
                  {pt.detail}
                </p>
              </div>
            ))}
          </div>

          {/* Server Context / Offline fixture notice if provided */}
          {scientific_disclaimer && (
            <div className="pt-2 border-t border-space-border/60 text-[10px] text-slate-500 font-mono flex items-center justify-between">
              <span className="truncate">
                Server Context: {scientific_disclaimer}
              </span>
              <span className="shrink-0 text-slate-600 ml-2">COLLIVRA SSA v1.0</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

