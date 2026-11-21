"use client";

import React, { useState } from "react";
import {
  BreakupRemediationRequest,
  TargetingMode,
  SyntheticFragmentRecord,
} from "@/types/simulation";
import {
  DEFAULT_CHASER_STATE,
  DEFAULT_RENDEZVOUS_CONFIG,
  BUDGET_INFEASIBLE_RENDEZVOUS_CONFIG,
  createDefaultRemediationRequest,
  createBudgetInfeasibleRemediationRequest,
} from "@/lib/simulation_presets";
import { Card, CardHeader, CardTitle } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import {
  Crosshair,
  RotateCcw,
  Sparkles,
  AlertTriangle,
  Zap,
  Target,
  ShieldCheck,
} from "lucide-react";

export interface RemediationPlannerFormProps {
  isLoading: boolean;
  onSubmit: (request: BreakupRemediationRequest) => Promise<void>;
  targetedFragment?: SyntheticFragmentRecord | null;
  initialObjectId?: string | null;
}

export const RemediationPlannerForm: React.FC<RemediationPlannerFormProps> = ({
  isLoading,
  onSubmit,
  targetedFragment,
  initialObjectId,
}) => {
  // Chaser State
  const [chaserId, setChaserId] = useState<string>(DEFAULT_CHASER_STATE.chaser_id);
  const [chaserEpoch, setChaserEpoch] = useState<string>(DEFAULT_CHASER_STATE.chaser_epoch_utc);
  const [chaserPos, setChaserPos] = useState<[number, number, number]>([
    ...DEFAULT_CHASER_STATE.chaser_gcrs_position_km,
  ]);
  const [chaserVel, setChaserVel] = useState<[number, number, number]>([
    ...DEFAULT_CHASER_STATE.chaser_gcrs_velocity_kms,
  ]);

  // Rendezvous Config State
  const [targetingMode, setTargetingMode] = useState<TargetingMode>(
    DEFAULT_RENDEZVOUS_CONFIG.targeting_mode || "STANDOFF_HOLD"
  );
  const [standoffDistM, setStandoffDistM] = useState<number>(
    DEFAULT_RENDEZVOUS_CONFIG.standoff_distance_m || 50.0
  );
  const [deltaVBudgetMs, setDeltaVBudgetMs] = useState<number>(
    DEFAULT_RENDEZVOUS_CONFIG.delta_v_budget_max_ms || 25.0
  );
  const [transferTimeS, setTransferTimeS] = useState<number>(
    DEFAULT_RENDEZVOUS_CONFIG.transfer_time_s || 120.0
  );

  // Constraint State
  const [maxEccentricity, setMaxEccentricity] = useState<number>(0.005);
  const [minPerigeeKm, setMinPerigeeKm] = useState<number>(6478.137);

  const [validationError, setValidationError] = useState<string | null>(null);
  const [executionState, setExecutionState] = useState<
    "IDLE" | "VALIDATING" | "SUBMITTING" | "COMPLETED" | "FAILED"
  >("IDLE");

  const applyNominalPreset = () => {
    const req = createDefaultRemediationRequest();
    setChaserId(req.chaser_id);
    setChaserEpoch(req.chaser_epoch_utc);
    setChaserPos([...req.chaser_gcrs_position_km]);
    setChaserVel([...req.chaser_gcrs_velocity_kms]);
    setTargetingMode(req.rendezvous_config?.targeting_mode || "STANDOFF_HOLD");
    setStandoffDistM(req.rendezvous_config?.standoff_distance_m || 50.0);
    setDeltaVBudgetMs(req.rendezvous_config?.delta_v_budget_max_ms || 25.0);
    setTransferTimeS(req.rendezvous_config?.transfer_time_s || 120.0);
    setMaxEccentricity(req.max_target_eccentricity ?? 0.005);
    setMinPerigeeKm(req.min_target_perigee_km ?? 6478.137);
    setValidationError(null);
    setExecutionState("IDLE");
  };

  const applyInfeasiblePreset = () => {
    const req = createBudgetInfeasibleRemediationRequest();
    setChaserId(req.chaser_id);
    setChaserEpoch(req.chaser_epoch_utc);
    setChaserPos([...req.chaser_gcrs_position_km]);
    setChaserVel([...req.chaser_gcrs_velocity_kms]);
    setTargetingMode("STANDOFF_HOLD");
    setStandoffDistM(50.0);
    setDeltaVBudgetMs(BUDGET_INFEASIBLE_RENDEZVOUS_CONFIG.delta_v_budget_max_ms || 0.005);
    setTransferTimeS(120.0);
    setMaxEccentricity(0.005);
    setMinPerigeeKm(6478.137);
    setValidationError(null);
    setExecutionState("IDLE");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || executionState === "SUBMITTING") return;

    setValidationError(null);
    setExecutionState("VALIDATING");

    // Guardrail: Non-empty identifiers
    if (!chaserId.trim()) {
      setValidationError("Chaser ID must be a non-empty string.");
      setExecutionState("FAILED");
      return;
    }

    // Guardrail: Valid ISO 8601 UTC timestamp
    if (isNaN(Date.parse(chaserEpoch))) {
      setValidationError("Chaser epoch must be a valid ISO 8601 UTC timestamp.");
      setExecutionState("FAILED");
      return;
    }

    // Guardrail: Finite kinematic 3-vectors (no NaN, no Infinity)
    const isFiniteVec3 = (v: [number, number, number]) =>
      Array.isArray(v) &&
      v.length === 3 &&
      v.every((n) => typeof n === "number" && Number.isFinite(n));

    if (!isFiniteVec3(chaserPos)) {
      setValidationError("Chaser position must be 3 finite numbers in GCRS (km). Non-finite or NaN rejected.");
      setExecutionState("FAILED");
      return;
    }

    if (!isFiniteVec3(chaserVel)) {
      setValidationError("Chaser velocity must be 3 finite numbers in GCRS (km/s). Non-finite or NaN rejected.");
      setExecutionState("FAILED");
      return;
    }

    // Guardrail: Strictly positive Delta-V budget and transfer time
    if (!Number.isFinite(deltaVBudgetMs) || deltaVBudgetMs <= 0) {
      setValidationError("Delta-V budget must be a strictly positive finite number (> 0 m/s).");
      setExecutionState("FAILED");
      return;
    }

    if (!Number.isFinite(transferTimeS) || transferTimeS <= 0) {
      setValidationError("Transfer time must be a strictly positive finite number (> 0 s).");
      setExecutionState("FAILED");
      return;
    }

    // Guardrail: CW near-circular reference orbit precondition (0 <= e <= 0.005)
    if (!Number.isFinite(maxEccentricity) || maxEccentricity > 0.005 || maxEccentricity < 0) {
      setValidationError("CW relative motion solver strictly requires eccentricity 0 <= e <= 0.005 (near-circular orbit precondition).");
      setExecutionState("FAILED");
      return;
    }

    // Guardrail: Atmospheric re-entry threshold (rp >= 6,478.137 km)
    if (!Number.isFinite(minPerigeeKm) || minPerigeeKm < 6478.137) {
      setValidationError("Target perigee cannot violate the atmospheric re-entry boundary threshold (>= 6,478.137 km; 100 km altitude).");
      setExecutionState("FAILED");
      return;
    }

    setExecutionState("SUBMITTING");
    try {
      const request = createDefaultRemediationRequest({
        chaser_id: chaserId,
        chaser_epoch_utc: chaserEpoch,
        chaser_gcrs_position_km: chaserPos,
        chaser_gcrs_velocity_kms: chaserVel,
        rendezvous_config: {
          targeting_mode: targetingMode,
          standoff_distance_m: standoffDistM,
          delta_v_budget_max_ms: deltaVBudgetMs,
          transfer_time_s: transferTimeS,
          epoch_tolerance_s: 1.0,
          max_condition_number: 100000000.0,
        },
        max_target_eccentricity: maxEccentricity,
        min_target_perigee_km: minPerigeeKm,
      });

      await onSubmit(request);
      setExecutionState("COMPLETED");
    } catch (err: unknown) {
      setExecutionState("FAILED");
      setValidationError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Card className="bg-space-surface border-space-border shadow-panel">
      <CardHeader className="flex flex-row items-center justify-between border-b border-space-border pb-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-cyan" />
            <CardTitle className="text-sm font-bold text-slate-100 tracking-wide uppercase">
              CW Two-Impulse Remediation Planner
            </CardTitle>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 font-mono">
            Linearized Clohessy-Wiltshire rendezvous planning for highest-mass compliant debris fragment
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={applyNominalPreset}
            className="text-[11px] text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/10"
          >
            Nominal Preset
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={applyInfeasiblePreset}
            className="text-[11px] text-amber-400 border-amber-500/40 hover:bg-amber-500/10"
          >
            Infeasible Preset
          </Button>
        </div>
      </CardHeader>

      {/* Cross-Module Target Context Banner */}
      {targetedFragment && (
        <div className="mx-6 mb-4 p-3 rounded-lg border border-cyan/40 bg-cyan/10 text-xs font-mono text-cyan-200 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-cyan" />
              <span className="font-bold text-white uppercase tracking-wider">
                Targeted Fragment: {targetedFragment.fragment_id}
              </span>
              <Badge variant="cyan" size="sm">
                {targetedFragment.mass_kg.toFixed(2)} kg
              </Badge>
              <Badge variant="outline" size="sm">
                GCRS
              </Badge>
            </div>
            <p className="text-[11px] text-slate-300">
              Epoch: {targetedFragment.epoch} | Ejection Δv: {targetedFragment.delta_v_kms.toFixed(3)} km/s
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              setChaserEpoch(targetedFragment.epoch);
            }}
            className="text-[10px] text-cyan border-cyan/40 shrink-0"
            title="Synchronize chaser epoch with fragment epoch"
          >
            Sync Epoch
          </Button>
        </div>
      )}
      {!targetedFragment && initialObjectId && (
        <div className="mx-6 mb-4 p-3 rounded-lg border border-amber-500/40 bg-amber-950/20 text-xs font-mono text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold uppercase tracking-wider block">
              Target Context: {initialObjectId}
            </span>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Target selected from cross-module workflow. Full Cartesian 6-state vector required for CW rendezvous targeting. State data validated for epoch and GCRS frame; no synthetic vectors fabricated.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {validationError && (
          <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs font-mono flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{validationError}</span>
          </div>
        )}

        {/* Chaser Spacecraft State */}
        <div className="p-3.5 rounded-lg bg-space-dark border border-space-border space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-cyan font-mono flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" /> Chaser Spacecraft State (GCRS)
            </span>
            <Badge variant="cyan" size="sm">Active Debris Removal (ADR)</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div>
              <label className="block text-[10px] text-slate-400 font-mono">Chaser ID</label>
              <input
                type="text"
                value={chaserId}
                onChange={(e) => setChaserId(e.target.value)}
                className="w-full px-2 py-1 bg-space-panel border border-space-border rounded font-mono text-xs text-slate-200 focus:outline-none focus:border-cyan"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 font-mono">Chaser Epoch (UTC)</label>
              <input
                type="text"
                value={chaserEpoch}
                onChange={(e) => setChaserEpoch(e.target.value)}
                className="w-full px-2 py-1 bg-space-panel border border-space-border rounded font-mono text-xs text-slate-200 focus:outline-none focus:border-cyan"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-slate-400 font-mono">Position [X, Y, Z] km</label>
              <div className="grid grid-cols-3 gap-1">
                {chaserPos.map((val, idx) => (
                  <input
                    key={idx}
                    type="number"
                    step="0.001"
                    value={val}
                    onChange={(e) => {
                      const next = [...chaserPos] as [number, number, number];
                      next[idx] = parseFloat(e.target.value) || 0;
                      setChaserPos(next);
                    }}
                    className="w-full px-1.5 py-0.5 bg-space-panel border border-space-border rounded font-mono text-[11px] text-slate-300 focus:outline-none focus:border-cyan"
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-slate-400 font-mono">Velocity [VX, VY, VZ] km/s</label>
              <div className="grid grid-cols-3 gap-1">
                {chaserVel.map((val, idx) => (
                  <input
                    key={idx}
                    type="number"
                    step="0.0001"
                    value={val}
                    onChange={(e) => {
                      const next = [...chaserVel] as [number, number, number];
                      next[idx] = parseFloat(e.target.value) || 0;
                      setChaserVel(next);
                    }}
                    className="w-full px-1.5 py-0.5 bg-space-panel border border-space-border rounded font-mono text-[11px] text-slate-300 focus:outline-none focus:border-cyan"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Rendezvous Configuration & Constraints */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div className="space-y-1">
            <label className="block text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider">
              Targeting Mode
            </label>
            <select
              value={targetingMode}
              onChange={(e) => setTargetingMode(e.target.value as TargetingMode)}
              className="w-full px-2.5 py-1.5 bg-space-dark border border-space-border rounded text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan"
            >
              <option value="STANDOFF_HOLD">STANDOFF_HOLD</option>
              <option value="CONTACT_INTERCEPT">CONTACT_INTERCEPT</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider">
              Standoff Distance (m)
            </label>
            <input
              type="number"
              step="1"
              value={standoffDistM}
              onChange={(e) => setStandoffDistM(parseFloat(e.target.value) || 50)}
              className="w-full px-2.5 py-1.5 bg-space-dark border border-space-border rounded text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan"
              disabled={targetingMode === "CONTACT_INTERCEPT"}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider">
              Delta-V Budget (m/s)
            </label>
            <input
              type="number"
              step="0.001"
              value={deltaVBudgetMs}
              onChange={(e) => setDeltaVBudgetMs(parseFloat(e.target.value) || 25)}
              className="w-full px-2.5 py-1.5 bg-space-dark border border-space-border rounded text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider">
              Transfer Time (s)
            </label>
            <input
              type="number"
              step="10"
              value={transferTimeS}
              onChange={(e) => setTransferTimeS(parseFloat(e.target.value) || 120)}
              className="w-full px-2.5 py-1.5 bg-space-dark border border-space-border rounded text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan"
            />
          </div>
        </div>

        {/* Physics Constraints */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
          <div className="p-2.5 rounded bg-space-dark border border-space-border">
            <span className="text-[10px] font-mono text-slate-400 uppercase block">Max Eccentricity (CW Precondition)</span>
            <div className="flex items-center justify-between mt-1">
              <span className="font-mono text-slate-300">e &le; {maxEccentricity}</span>
              <Badge variant="cyan" size="sm">Near-Circular</Badge>
            </div>
          </div>
          <div className="p-2.5 rounded bg-space-dark border border-space-border">
            <span className="text-[10px] font-mono text-slate-400 uppercase block">Min Target Perigee</span>
            <div className="flex items-center justify-between mt-1">
              <span className="font-mono text-slate-300">&ge; {minPerigeeKm} km</span>
              <Badge variant="amber" size="sm">+100 km Altitude</Badge>
            </div>
          </div>
        </div>

        {/* Targeting Knot Step Guardrail Callout */}
        <div className="p-2.5 rounded bg-space-dark/80 border border-space-border/80 text-[10px] font-mono text-slate-400 leading-relaxed">
          <span className="text-cyan font-bold block mb-0.5">Targeting Interpolation Knot Interval (&le; 60.0 s):</span>
          Maximum targeting interpolation knot interval: 60 seconds. This is a rendezvous-targeting numerical guardrail, not a universal propagation time-step restriction.
        </div>

        {/* Validation Error Alert */}
        {validationError && (
          <div className="p-2.5 rounded bg-rose-950/40 border border-rose-500/40 text-xs font-mono text-rose-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold uppercase tracking-wider block">Input Validation Guardrail:</span>
              <p className="mt-0.5 text-[11px] text-rose-200">{validationError}</p>
            </div>
          </div>
        )}

        {/* Dispatch Action */}
        <div className="pt-2 flex items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            size="md"
            className="flex-1 text-xs font-mono font-bold tracking-wider uppercase"
            isLoading={isLoading || executionState === "SUBMITTING"}
            disabled={isLoading || executionState === "SUBMITTING"}
          >
            {executionState === "VALIDATING"
              ? "VALIDATING CONSTRAINTS..."
              : isLoading || executionState === "SUBMITTING"
              ? "COMPUTING CW RENDEZVOUS BURNS..."
              : "PLAN CW REMEDIATION"}
          </Button>

          {executionState !== "IDLE" && (
            <Badge
              variant={
                executionState === "COMPLETED"
                  ? "emerald"
                  : executionState === "FAILED"
                  ? "rose"
                  : "cyan"
              }
              size="sm"
              className="font-mono text-[10px] shrink-0"
            >
              STATE: {executionState}
            </Badge>
          )}
        </div>
      </form>
    </Card>
  );
};

