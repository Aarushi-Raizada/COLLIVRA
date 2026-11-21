"use client";

import React, { useState, useMemo } from "react";
import {
  BreakupAndPropagateResponse,
  FragmentTrajectory,
  SyntheticFragmentRecord,
} from "@/types/simulation";
import type { ScenarioUrn } from "@/types/shared_state";
import { Card, CardHeader, CardTitle } from "../ui/Card";
import { MetricCard } from "../ui/MetricCard";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DisclaimerBanner } from "../ui/DisclaimerBanner";
import {
  Layers,
  Activity,
  ShieldAlert,
  Search,
  Filter,
  Eye,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Compass,
  Sparkles,
  Cpu,
  Scale,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Crosshair,
  ArrowRight,
} from "lucide-react";

export interface BreakupResultsViewProps {
  response: BreakupAndPropagateResponse;
  selectedFragmentId?: string | null;
  onSelectFragment: (fragmentId: string) => void;
  isDemo?: boolean;
  scenarioUrn?: ScenarioUrn | null;
  onPlanRemediation?: (fragmentId: string) => void;
}

type SortField = "fragment_id" | "mass_kg" | "delta_v" | "points" | "status";
type SortDirection = "asc" | "desc";

export const BreakupResultsView: React.FC<BreakupResultsViewProps> = ({
  response,
  selectedFragmentId,
  onSelectFragment,
  isDemo = false,
  scenarioUrn,
  onPlanRemediation,
}) => {
  const { fragmentation, trajectories } = response;
  const { metadata, fragments } = fragmentation;
  const { summary } = trajectories;

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [sortField, setSortField] = useState<SortField>("fragment_id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Map trajectories by ID for fast lookup
  const trajectoryMap = useMemo(() => {
    const map = new Map<string, FragmentTrajectory>();
    trajectories.trajectories.forEach((t) => map.set(t.fragment_id, t));
    return map;
  }, [trajectories]);

  // Mass calculations
  const totalParentMass =
    metadata.total_parent_mass_kg ??
    metadata.tracked_fragment_mass_kg + metadata.residual_mass_kg;
  const trackedMass = metadata.tracked_fragment_mass_kg;
  const residualMass = metadata.residual_mass_kg;

  const pctTracked = totalParentMass > 0 ? (trackedMass / totalParentMass) * 100 : 0;
  const pctResidual = totalParentMass > 0 ? (residualMass / totalParentMass) * 100 : 0;

  // Sorting handler
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const isReentered = (traj?: FragmentTrajectory | null) => {
    if (!traj) return false;
    return (
      traj.termination_reason === "ATMOSPHERIC_INTERFACE" ||
      traj.termination_reason?.toLowerCase().includes("atmospheric") ||
      traj.termination_reason?.toLowerCase().includes("reenter") ||
      traj.termination_reason?.toLowerCase().includes("reentry")
    );
  };

  // Filtered and sorted fragment list
  const filteredAndSortedFragments = useMemo(() => {
    const filtered = fragments.filter((frag) => {
      const traj = trajectoryMap.get(frag.fragment_id);
      const matchesSearch =
        searchQuery === "" ||
        frag.fragment_id.toLowerCase().includes(searchQuery.toLowerCase());

      const status = traj?.status ?? "UNKNOWN";
      const reentered = isReentered(traj);
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "REENTERED" && reentered) ||
        (statusFilter === "SUCCESS" && status === "SUCCESS" && !reentered) ||
        (statusFilter === "PARTIAL" && status === "PARTIAL") ||
        (statusFilter === "FAILED" && status === "FAILED");

      return matchesSearch && matchesStatus;
    });

    return [...filtered].sort((a, b) => {
      const trajA = trajectoryMap.get(a.fragment_id);
      const trajB = trajectoryMap.get(b.fragment_id);
      let comparison = 0;

      switch (sortField) {
        case "fragment_id":
          comparison = a.fragment_id.localeCompare(b.fragment_id, undefined, { numeric: true });
          break;
        case "mass_kg":
          comparison = a.mass_kg - b.mass_kg;
          break;
        case "delta_v":
          comparison = a.delta_v_kms - b.delta_v_kms;
          break;
        case "points":
          comparison = (trajA?.points.length ?? 0) - (trajB?.points.length ?? 0);
          break;
        case "status":
          comparison = (trajA?.status ?? "").localeCompare(trajB?.status ?? "");
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [fragments, trajectoryMap, searchQuery, statusFilter, sortField, sortDirection]);

  const selectedFragment = useMemo(() => {
    if (!selectedFragmentId) return null;
    return fragments.find((f) => f.fragment_id === selectedFragmentId) || null;
  }, [fragments, selectedFragmentId]);

  const selectedTrajectory = useMemo(() => {
    if (!selectedFragmentId) return null;
    return trajectoryMap.get(selectedFragmentId) || null;
  }, [trajectoryMap, selectedFragmentId]);

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-3 w-3 text-slate-500 inline-block ml-1 opacity-60" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="h-3 w-3 text-cyan inline-block ml-1" />
    ) : (
      <ArrowDown className="h-3 w-3 text-cyan inline-block ml-1" />
    );
  };


  return (
    <div className="space-y-4">
      {/* 1. Explicit Data Provenance Indicator */}
      {isDemo ? (
        <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-950/30 text-amber-200 text-xs font-mono flex items-center justify-between shadow-panel">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
            <span>
              <strong>SYNTHETIC DEMONSTRATION RESULTS:</strong> Numerical metrics displayed below are from precomputed illustrative demonstration fixtures, NOT live backend measurements.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scenarioUrn && (
              <div
                data-testid="breakup-scenario-badge"
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
              <strong>LIVE BACKEND RESULTS:</strong> Numerically evaluated via FastAPI Cowell DOP853 J2 solver in GCRS.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scenarioUrn && (
              <div
                data-testid="breakup-scenario-badge"
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

      {/* Top Scientific Disclaimer */}
      {metadata.fidelity_disclaimer && (
        <DisclaimerBanner
          title="SIMPLIFIED SYNTHETIC BREAKUP MODEL DISCLAIMER"
          disclaimer={metadata.fidelity_disclaimer}
          variant="warning"
        />
      )}

      {/* 2. Physics & Conservation Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Tracked Fragments"
          value={metadata.tracked_fragment_count}
          sublabel="Explicitly propagated fragments"
          icon={<Layers className="h-4 w-4" />}
          variant="cyan"
        />
        <MetricCard
          label="Tracked Fragment Mass"
          value={`${trackedMass.toFixed(2)} kg`}
          sublabel={`${pctTracked.toFixed(1)}% of ${totalParentMass.toFixed(0)} kg parent mass`}
          icon={<Scale className="h-4 w-4" />}
          variant="cyan"
        />
        <MetricCard
          label="Untracked Residual Mass"
          value={`${residualMass.toFixed(2)} kg`}
          sublabel={`${pctResidual.toFixed(1)}% unmodeled mass balance`}
          icon={<Activity className="h-4 w-4" />}
          variant="default"
        />
        <MetricCard
          label="Momentum Residual"
          value={`${metadata.momentum_residual_kg_kms.toExponential(3)}`}
          sublabel="kg·km/s (|Δv_cm| < 1e-12 m/s roundoff)"
          icon={<Compass className="h-4 w-4" />}
          variant="default"
        />
      </div>

      {/* 3. Explicit Dual-Bar Mass-Budget Visualization */}
      <Card className="bg-space-surface/90 border-space-border p-4 shadow-panel space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-space-border/60 pb-2.5">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-cyan" />
            <span className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wider">
              Mass-Budget & Conservation Balance
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            Combined Parent Mass: <strong className="text-slate-100">{totalParentMass.toFixed(2)} kg</strong> (100.0%)
          </div>
        </div>

        {/* Dual-Bar Graphic */}
        <div className="space-y-2">
          <div className="h-4 w-full rounded-full bg-space-dark border border-space-border flex overflow-hidden shadow-inner p-0.5">
            <div
              style={{ width: `${pctTracked}%` }}
              className="h-full bg-gradient-to-r from-cyan-600 to-cyan rounded-l-full transition-all"
              title={`Tracked Fragments: ${trackedMass.toFixed(2)} kg (${pctTracked.toFixed(1)}%)`}
            />
            <div
              style={{ width: `${pctResidual}%` }}
              className="h-full bg-slate-600 hover:bg-slate-500 rounded-r-full transition-all"
              title={`Untracked Residual Mass: ${residualMass.toFixed(2)} kg (${pctResidual.toFixed(1)}%)`}
            />
          </div>

          {/* Dual-Bar Legend */}
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs font-mono pt-0.5">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-cyan shrink-0" />
              <span className="text-slate-300">Tracked Fragments:</span>
              <span className="text-cyan font-bold">{trackedMass.toFixed(2)} kg</span>
              <span className="text-slate-400 text-[11px]">({pctTracked.toFixed(1)}%)</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-slate-600 shrink-0" />
              <span className="text-slate-300">Untracked Residual Mass:</span>
              <span className="text-slate-200 font-bold">{residualMass.toFixed(2)} kg</span>
              <span className="text-slate-400 text-[11px]">({pctResidual.toFixed(1)}%)</span>
            </div>
          </div>
        </div>

        {/* Scientific Mass Accounting Callout */}
        <div className="mt-2 pt-2.5 border-t border-space-border/60 text-[11px] font-mono text-slate-400 leading-relaxed">
          <strong className="text-slate-300">Mass Accounting Note: </strong>
          Untracked residual mass ({residualMass.toFixed(2)} kg) represents the portion of the combined parent mass ({totalParentMass.toFixed(2)} kg) not represented by explicitly tracked fragments under the selected synthetic fragmentation model. It is an unmodeled mass-budget balance, not a physically generated or propagated fine-dust population.
        </div>
      </Card>

      {/* 4. Momentum Conservation Modeling Note */}
      <div className="p-3 rounded-lg bg-space-dark border border-space-border/80 text-[11px] font-mono text-slate-400 leading-relaxed">
        <span className="text-slate-300 font-bold block mb-0.5">Momentum Conservation Modeling Note:</span>
        Zero net fragment ejection momentum is algorithmically enforced via mass-weighted ensemble drift subtraction (&Sigma; m_i &Delta;v_i &equiv; 0). The reported momentum residual represents double-precision floating-point roundoff (IEEE 754 precision limit) from the resulting sum and is not independent empirical validation of physical accuracy.
      </div>

      {/* 5. Trajectory Outcome Summary Bar */}
      <div className="p-3.5 rounded-xl bg-space-surface/90 border border-space-border flex flex-wrap items-center justify-between gap-4 text-xs font-mono shadow-panel">
        <div className="flex items-center gap-4">
          <span className="text-slate-400 font-bold uppercase tracking-wider">
            Trajectory Integrations:
          </span>
          <span className="flex items-center gap-1.5 text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            {summary.completed_count} Completed
          </span>
          <span className="flex items-center gap-1.5 text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            {summary.reentered_count} Reentered (Alt &lt; 100 km)
          </span>
          <span className="flex items-center gap-1.5 text-rose-300">
            <XCircle className="h-3.5 w-3.5 text-rose-400" />
            {summary.numerical_failure_count} Failed
          </span>
        </div>
        <div className="text-slate-400 text-[11px]">
          Integrator: <span className="text-cyan font-bold">Cowell DOP853</span> (Output Knot Step: {summary.step_seconds}s, Duration: {summary.duration_seconds}s)
        </div>
      </div>

      {/* 6. Selected Fragment Detail Inspector */}
      {selectedFragment && selectedTrajectory && (
        <Card className="bg-space-surface/90 border-cyan/40 p-4 shadow-panel">
          <div className="flex items-center justify-between border-b border-space-border pb-3 mb-3">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-cyan" />
              <span className="text-xs font-bold font-mono text-cyan uppercase tracking-wider">
                Fragment Detail Inspector: {selectedFragment.fragment_id}
              </span>
              <Badge variant="cyan" size="sm">SYNTHETIC</Badge>
            </div>
            <Badge
              variant={
                isReentered(selectedTrajectory)
                  ? "amber"
                  : selectedTrajectory.status === "SUCCESS"
                  ? "emerald"
                  : "rose"
              }
              size="sm"
            >
              {isReentered(selectedTrajectory)
                ? "REENTRY INTERFACE CROSSED — Alt < 100 km (rp < 6,478.1 km)"
                : selectedTrajectory.status === "SUCCESS"
                ? "COMPLETED — Nominal Orbit"
                : `${selectedTrajectory.status} — ${selectedTrajectory.termination_reason}`}
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs font-mono">
            <div className="p-2.5 rounded bg-space-dark/80 border border-space-border/60">
              <span className="text-[10px] text-slate-400 block font-sans">Fragment Mass</span>
              <span className="text-slate-100 font-bold text-sm">{selectedFragment.mass_kg.toFixed(3)} kg</span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {((selectedFragment.mass_kg / trackedMass) * 100).toFixed(1)}% of tracked
              </span>
            </div>

            <div className="p-2.5 rounded bg-space-dark/80 border border-space-border/60">
              <span className="text-[10px] text-slate-400 block font-sans">Ejection Δv</span>
              <span className="text-cyan font-bold text-sm">
                {(selectedFragment.delta_v_kms * 1000).toFixed(2)} m/s
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {selectedFragment.delta_v_kms.toFixed(4)} km/s
              </span>
            </div>

            <div className="p-2.5 rounded bg-space-dark/80 border border-space-border/60">
              <span className="text-[10px] text-slate-400 block font-sans">Trajectory Knots</span>
              <span className="text-slate-100 font-bold text-sm">
                {selectedTrajectory.points.length} points
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                step = {summary.step_seconds}s
              </span>
            </div>

            <div className="p-2.5 rounded bg-space-dark/80 border border-space-border/60 col-span-2 sm:col-span-1 lg:col-span-1">
              <span className="text-[10px] text-slate-400 block font-sans">GCRS Initial Pos</span>
              <span className="text-slate-200 text-[11px] block truncate font-mono" title={selectedFragment.position_km.join(", ")}>
                [{selectedFragment.position_km.map((v) => v.toFixed(0)).join(", ")}] km
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                r = {Math.sqrt(selectedFragment.position_km.reduce((a, b) => a + b * b, 0)).toFixed(1)} km
              </span>
            </div>

            <div className="p-2.5 rounded bg-space-dark/80 border border-space-border/60 col-span-2 sm:col-span-2 lg:col-span-2">
              <span className="text-[10px] text-slate-400 block font-sans">Termination Reason</span>
              <span className="text-slate-200 text-xs block leading-tight mt-0.5">
                {selectedTrajectory.termination_reason || "Nominal numerical completion"}
              </span>
            </div>

            {onPlanRemediation && (
              <div className="p-3 rounded-lg bg-cyan-950/30 border border-cyan/40 col-span-2 sm:col-span-4 lg:col-span-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 text-xs text-cyan-200">
                  <Crosshair className="h-4 w-4 text-cyan shrink-0" />
                  <span>
                    <strong>Pillar 05 Transfer:</strong> Configure Active Debris Removal (ADR) rendezvous for {selectedFragment.fragment_id}.
                  </span>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  data-testid="target-fragment-cw-btn"
                  onClick={() => onPlanRemediation(selectedFragment.fragment_id)}
                  className="gap-1.5 text-xs font-mono shrink-0"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  <span>TARGET IN CW REMEDIATION</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* 7. Generated Synthetic Fragments Table with Multi-Column Sorting */}
      <Card className="bg-space-surface border-space-border shadow-panel">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-space-border pb-3 mb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-cyan" />
            <CardTitle className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Generated Synthetic Fragments ({filteredAndSortedFragments.length} / {fragments.length})
            </CardTitle>
          </div>

          <div className="flex items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="h-3 w-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1 text-xs font-mono bg-space-dark border border-space-border rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan/50"
              />
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2 py-1 text-xs font-mono bg-space-dark border border-space-border rounded-lg text-slate-300 focus:outline-none focus:border-cyan/50"
            >
              <option value="ALL">All Status</option>
              <option value="SUCCESS">COMPLETED</option>
              <option value="REENTERED">REENTERED</option>
              <option value="PARTIAL">PARTIAL</option>
              <option value="FAILED">FAILED</option>
            </select>
          </div>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-space-panel text-slate-400 border-b border-space-border uppercase text-[10px] tracking-wider select-none">
              <tr>
                <th
                  onClick={() => handleSort("fragment_id")}
                  className="py-2.5 px-3 cursor-pointer hover:text-cyan transition-colors"
                  title="Sort by Fragment ID"
                >
                  Fragment ID {getSortIcon("fragment_id")}
                </th>
                <th
                  onClick={() => handleSort("mass_kg")}
                  className="py-2.5 px-3 cursor-pointer hover:text-cyan transition-colors"
                  title="Sort by Fragment Mass"
                >
                  Mass (kg) {getSortIcon("mass_kg")}
                </th>
                <th
                  onClick={() => handleSort("delta_v")}
                  className="py-2.5 px-3 cursor-pointer hover:text-cyan transition-colors"
                  title="Sort by Ejection Delta-V"
                >
                  Ejection Δv {getSortIcon("delta_v")}
                </th>
                <th
                  onClick={() => handleSort("points")}
                  className="py-2.5 px-3 cursor-pointer hover:text-cyan transition-colors"
                  title="Sort by Trajectory Points"
                >
                  Knots {getSortIcon("points")}
                </th>
                <th
                  onClick={() => handleSort("status")}
                  className="py-2.5 px-3 cursor-pointer hover:text-cyan transition-colors"
                  title="Sort by Status"
                >
                  Status {getSortIcon("status")}
                </th>
                <th className="py-2.5 px-3">Termination Reason</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-space-border/60">
              {filteredAndSortedFragments.map((frag) => {
                const traj = trajectoryMap.get(frag.fragment_id);
                const isSelected = selectedFragmentId === frag.fragment_id;
                const reentered = isReentered(traj);

                return (
                  <tr
                    key={frag.fragment_id}
                    onClick={() => onSelectFragment(frag.fragment_id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-cyan/15 text-cyan-200"
                        : "hover:bg-space-panel/60 text-slate-300"
                    }`}
                  >
                    <td className="py-2 px-3 font-bold text-cyan flex items-center gap-1.5">
                      {frag.fragment_id}
                      <Badge variant="cyan" size="sm">SYNTHETIC</Badge>
                    </td>
                    <td className="py-2 px-3 font-medium text-slate-200">{frag.mass_kg.toFixed(3)}</td>
                    <td className="py-2 px-3 text-cyan">{(frag.delta_v_kms * 1000).toFixed(1)} m/s</td>
                    <td className="py-2 px-3 text-slate-400">{traj?.points.length ?? "-"}</td>
                    <td className="py-2 px-3">
                      <Badge
                        variant={
                          reentered
                            ? "amber"
                            : traj?.status === "SUCCESS"
                            ? "emerald"
                            : traj?.status === "PARTIAL"
                            ? "amber"
                            : "rose"
                        }
                        size="sm"
                      >
                        {reentered
                          ? "REENTERED"
                          : traj?.status === "SUCCESS"
                          ? "COMPLETED"
                          : traj?.status || "UNKNOWN"}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-slate-400 text-[11px] max-w-[200px] truncate" title={traj?.termination_reason || ""}>
                      {traj?.termination_reason || "-"}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {onPlanRemediation && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPlanRemediation(frag.fragment_id);
                            }}
                            className="text-[10px] py-0.5 px-2 text-cyan border-cyan/40 hover:bg-cyan/10"
                            title={`Target ${frag.fragment_id} in CW Remediation`}
                          >
                            TARGET
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant={isSelected ? "primary" : "ghost"}
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectFragment(frag.fragment_id);
                          }}
                          className="text-[10px] py-0.5 px-2"
                        >
                          {isSelected ? "VIEWING" : "SELECT"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
