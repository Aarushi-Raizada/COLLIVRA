"use client";

import React, { useState } from "react";
import {
  BreakupAndPropagateRequest,
  CollisionScenario,
  FragmentationConfig,
  NumericalPropagationConfig,
} from "@/types/simulation";
import {
  DEFAULT_COLLISION_SCENARIO,
  DEFAULT_PROPAGATION_CONFIG,
  createDefaultBreakupRequest,
} from "@/lib/simulation_presets";
import { Card, CardHeader, CardTitle } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import {
  RotateCcw,
  Sparkles,
  AlertTriangle,
  Flame,
  Clock,
  Layers,
  Activity,
  Play,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Sliders,
  Database,
  Crosshair,
} from "lucide-react";

export interface BreakupSimulationFormProps {
  isLoading: boolean;
  onSubmit: (request: BreakupAndPropagateRequest) => Promise<void>;
  isDemoMode?: boolean;
}

export const BreakupSimulationForm: React.FC<BreakupSimulationFormProps> = ({
  isLoading,
  onSubmit,
  isDemoMode = false,
}) => {
  // Scenario state
  const [epoch, setEpoch] = useState<string>(DEFAULT_COLLISION_SCENARIO.collision_epoch);
  const [toleranceKm, setToleranceKm] = useState<number>(
    DEFAULT_COLLISION_SCENARIO.collision_tolerance_km || 0.1
  );

  // Parent A state
  const [parentAId, setParentAId] = useState<string>(DEFAULT_COLLISION_SCENARIO.parent_a.object_id);
  const [parentAName, setParentAName] = useState<string>(
    DEFAULT_COLLISION_SCENARIO.parent_a.object_name || ""
  );
  const [parentAMass, setParentAMass] = useState<number>(DEFAULT_COLLISION_SCENARIO.parent_a.mass_kg);
  const [parentAPos, setParentAPos] = useState<[number, number, number]>([
    ...DEFAULT_COLLISION_SCENARIO.parent_a.position_km,
  ]);
  const [parentAVel, setParentAVel] = useState<[number, number, number]>([
    ...DEFAULT_COLLISION_SCENARIO.parent_a.velocity_kms,
  ]);

  // Parent B state
  const [parentBId, setParentBId] = useState<string>(DEFAULT_COLLISION_SCENARIO.parent_b.object_id);
  const [parentBName, setParentBName] = useState<string>(
    DEFAULT_COLLISION_SCENARIO.parent_b.object_name || ""
  );
  const [parentBMass, setParentBMass] = useState<number>(DEFAULT_COLLISION_SCENARIO.parent_b.mass_kg);
  const [parentBPos, setParentBPos] = useState<[number, number, number]>([
    ...DEFAULT_COLLISION_SCENARIO.parent_b.position_km,
  ]);
  const [parentBVel, setParentBVel] = useState<[number, number, number]>([
    ...DEFAULT_COLLISION_SCENARIO.parent_b.velocity_kms,
  ]);

  // Fragmentation config state
  const [fragCount, setFragCount] = useState<number>(
    DEFAULT_COLLISION_SCENARIO.config?.fragment_count || 10
  );
  const [minMass, setMinMass] = useState<number>(
    DEFAULT_COLLISION_SCENARIO.config?.min_fragment_mass_kg || 1.0
  );
  const [maxMass, setMaxMass] = useState<number>(
    DEFAULT_COLLISION_SCENARIO.config?.max_fragment_mass_kg || 20.0
  );
  const [maxDvKms, setMaxDvKms] = useState<number>(
    DEFAULT_COLLISION_SCENARIO.config?.max_delta_v_kms || 0.002
  );
  const [seed, setSeed] = useState<number | "">(
    DEFAULT_COLLISION_SCENARIO.config?.seed ?? 42
  );

  // Propagation config state
  const [durationSec, setDurationSec] = useState<number>(
    DEFAULT_PROPAGATION_CONFIG.duration_seconds || 60.0
  );
  const [stepSec, setStepSec] = useState<number>(
    DEFAULT_PROPAGATION_CONFIG.step_seconds || 10.0
  );

  // Collapsible section states (default: Spacecraft bodies open)
  const [sections, setSections] = useState({
    bodies: true,
    fragmentation: false,
    integrator: false,
  });

  const toggleSection = (key: keyof typeof sections) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const [validationError, setValidationError] = useState<string | null>(null);

  const handleResetToPreset = () => {
    const defaultReq = createDefaultBreakupRequest();
    setEpoch(defaultReq.scenario.collision_epoch);
    setToleranceKm(defaultReq.scenario.collision_tolerance_km || 0.1);

    setParentAId(defaultReq.scenario.parent_a.object_id);
    setParentAName(defaultReq.scenario.parent_a.object_name || "");
    setParentAMass(defaultReq.scenario.parent_a.mass_kg);
    setParentAPos([...defaultReq.scenario.parent_a.position_km]);
    setParentAVel([...defaultReq.scenario.parent_a.velocity_kms]);

    setParentBId(defaultReq.scenario.parent_b.object_id);
    setParentBName(defaultReq.scenario.parent_b.object_name || "");
    setParentBMass(defaultReq.scenario.parent_b.mass_kg);
    setParentBPos([...defaultReq.scenario.parent_b.position_km]);
    setParentBVel([...defaultReq.scenario.parent_b.velocity_kms]);

    setFragCount(defaultReq.scenario.config?.fragment_count || 10);
    setMinMass(defaultReq.scenario.config?.min_fragment_mass_kg || 1.0);
    setMaxMass(defaultReq.scenario.config?.max_fragment_mass_kg || 20.0);
    setMaxDvKms(defaultReq.scenario.config?.max_delta_v_kms || 0.002);
    setSeed(defaultReq.scenario.config?.seed ?? 42);

    setDurationSec(defaultReq.propagation_config?.duration_seconds || 60.0);
    setStepSec(defaultReq.propagation_config?.step_seconds || 10.0);
    setValidationError(null);
  };

  const updateParentAPos = (index: 0 | 1 | 2, val: number) => {
    setParentAPos((prev) => {
      const next: [number, number, number] = [...prev];
      next[index] = val;
      return next;
    });
  };

  const updateParentAVel = (index: 0 | 1 | 2, val: number) => {
    setParentAVel((prev) => {
      const next: [number, number, number] = [...prev];
      next[index] = val;
      return next;
    });
  };

  const updateParentBPos = (index: 0 | 1 | 2, val: number) => {
    setParentBPos((prev) => {
      const next: [number, number, number] = [...prev];
      next[index] = val;
      return next;
    });
  };

  const updateParentBVel = (index: 0 | 1 | 2, val: number) => {
    setParentBVel((prev) => {
      const next: [number, number, number] = [...prev];
      next[index] = val;
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    // Validation
    if (parentAMass <= 0 || !isFinite(parentAMass) || parentBMass <= 0 || !isFinite(parentBMass)) {
      setValidationError("Parent spacecraft mass must be positive (> 0 kg).");
      return;
    }
    const allCoordsFinite = [...parentAPos, ...parentAVel, ...parentBPos, ...parentBVel].every(
      (v) => typeof v === "number" && isFinite(v)
    );
    if (!allCoordsFinite) {
      setValidationError(
        "All parent spacecraft position and velocity coordinates must be finite numerical values (no NaN or Infinity)."
      );
      return;
    }
    if (fragCount < 2 || !isFinite(fragCount)) {
      setValidationError("Fragment count must be at least 2.");
      return;
    }
    if (fragCount > 5000) {
      setValidationError("Fragment count cannot exceed 5000.");
      return;
    }
    if (minMass <= 0 || !isFinite(minMass) || maxMass < minMass || !isFinite(maxMass)) {
      setValidationError("Fragment mass range is invalid (0 < min <= max).");
      return;
    }
    if (maxDvKms <= 0 || !isFinite(maxDvKms)) {
      setValidationError("Max ejection Δv must be positive (> 0 km/s).");
      return;
    }
    if (durationSec <= 0 || !isFinite(durationSec) || stepSec <= 0 || !isFinite(stepSec)) {
      setValidationError("Propagation duration and step seconds must be positive.");
      return;
    }
    if (stepSec > durationSec) {
      setValidationError("Step seconds cannot exceed total duration.");
      return;
    }
    if (stepSec > 60.0) {
      setValidationError(
        "Output trajectory knot interval cannot exceed 60.0s. This 60-second limit is enforced as a rendezvous-targeting interpolation knot guardrail, not as a universal DOP853 integrator step limit."
      );
      return;
    }

    const request: BreakupAndPropagateRequest = {
      scenario: {
        collision_epoch: epoch,
        frame: "GCRS",
        collision_tolerance_km: toleranceKm,
        parent_a: {
          object_id: parentAId,
          object_name: parentAName || undefined,
          mass_kg: parentAMass,
          position_km: parentAPos,
          velocity_kms: parentAVel,
        },
        parent_b: {
          object_id: parentBId,
          object_name: parentBName || undefined,
          mass_kg: parentBMass,
          position_km: parentBPos,
          velocity_kms: parentBVel,
        },
        config: {
          fragment_count: fragCount,
          min_fragment_mass_kg: minMass,
          max_fragment_mass_kg: maxMass,
          v_median_kms: 0.001,
          v_sigma: 0.5,
          max_delta_v_kms: maxDvKms,
          power_law_exponent: 1.5,
          seed: seed === "" ? null : Number(seed),
          identifier_prefix: "SYNTH-FRAG",
        },
      },
      propagation_config: {
        duration_seconds: durationSec,
        step_seconds: stepSec,
        integrator: "DOP853",
      },
    };

    await onSubmit(request);
  };

  return (
    <Card className="bg-space-surface/90 border-space-border shadow-panel flex flex-col">
      {/* Header */}
      <CardHeader className="flex flex-row items-center justify-between border-b border-space-border/80 pb-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-status-warning" />
            <CardTitle className="text-sm font-bold text-slate-100 tracking-wide uppercase font-mono">
              Breakup & Numerical Propagation
            </CardTitle>
          </div>
          <p className="text-[11px] text-slate-400 font-mono mt-0.5">
            Synthetic collision model with Cowell DOP853 J2 batch numerical integration
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isLoading ? (
            <Badge variant="cyan" size="sm" className="font-mono animate-pulse">
              STATE: SUBMITTING
            </Badge>
          ) : validationError ? (
            <Badge variant="rose" size="sm" className="font-mono">
              STATE: VALIDATION FAILED
            </Badge>
          ) : (
            <Badge variant="outline" size="sm" className="font-mono text-emerald-400 border-emerald-500/40">
              STATE: READY
            </Badge>
          )}
          <Badge variant="cyan" size="sm">
            FRAME: GCRS
          </Badge>
          {isDemoMode && (
            <Badge variant="amber" size="sm">
              DEMO
            </Badge>
          )}
        </div>
      </CardHeader>

      <form onSubmit={handleSubmit} className="px-4 sm:px-5 pb-4 space-y-3 flex-1 flex flex-col justify-between">
        <div className="space-y-3">
          {/* Quick-Access Top Preset & Run Action Bar (Eliminates below-fold scrolling on 1366x768) */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-space-dark border border-space-border/80">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] font-mono uppercase text-slate-400 font-bold shrink-0">
                Preset:
              </span>
              <span className="text-xs font-mono text-cyan truncate" title="Cosmos-2251 & Iridium-33 LEO Proximity">
                Cosmos-2251 & Iridium-33 LEO Proximity
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={handleResetToPreset}
                className="font-mono text-xs gap-1 py-1"
                title="Reset all fields to nominal scenario defaults"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset</span>
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="xs"
                isLoading={isLoading}
                disabled={isLoading}
                className="gap-1.5 font-mono text-xs py-1 px-3 shadow-glow-cyan"
                title="Execute synthetic breakup and Cowell DOP853 orbital propagation"
              >
                <Play className="h-3 w-3 fill-current" />
                <span>RUN SIMULATION</span>
              </Button>
            </div>
          </div>

          {/* Validation Error Alert */}
          {validationError && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs font-mono flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{validationError}</span>
            </div>
          )}

          {/* SECTION 1: Collapsible Spacecraft Bodies */}
          <div className="rounded-lg border border-space-border bg-space-panel/60 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection("bodies")}
              className="w-full px-3.5 py-2.5 flex items-center justify-between bg-space-dark/80 hover:bg-space-dark transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                {sections.bodies ? (
                  <ChevronDown className="h-3.5 w-3.5 text-cyan shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                )}
                <span className="text-xs font-sans font-bold uppercase tracking-wider text-slate-200">
                  1. Colliding Spacecraft Bodies (GCRS)
                </span>
              </div>
              <Badge variant="outline" size="sm" className="font-mono text-[10px] text-slate-300">
                {parentAMass + parentBMass} kg Combined
              </Badge>
            </button>

            {sections.bodies && (
              <div className="p-3 space-y-3 border-t border-space-border/60">
                {/* Body A */}
                <div className="p-3 rounded-md bg-space-surface border border-space-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-sans uppercase text-cyan font-bold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-cyan inline-block" />
                      Body A (Target) — {parentAId}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs font-mono">
                      <span className="text-slate-400 text-[10px]">Mass:</span>
                      <input
                        type="number"
                        step="10"
                        min="1"
                        value={parentAMass}
                        onChange={(e) => setParentAMass(Number(e.target.value))}
                        className="w-20 bg-space-dark border border-space-border rounded px-2 py-0.5 text-slate-100 text-xs font-mono text-right focus:outline-none focus:border-cyan"
                      />
                      <span className="text-slate-400 text-[10px]">kg</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 font-mono">
                      Object Designation (Full Name):
                    </label>
                    <input
                      type="text"
                      value={parentAName}
                      onChange={(e) => setParentAName(e.target.value)}
                      placeholder="Parent A Name"
                      title={parentAName}
                      className="w-full bg-space-dark border border-space-border rounded px-2.5 py-1 text-slate-100 text-xs font-mono focus:outline-none focus:border-cyan"
                    />
                  </div>

                  {/* Cartesian Coordinates Micro-Grid */}
                  <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] font-mono">
                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400 block font-sans">
                        Position [X, Y, Z] (km):
                      </span>
                      <div className="grid grid-cols-3 gap-1">
                        <input
                          type="number"
                          step="10"
                          value={parentAPos[0]}
                          onChange={(e) => updateParentAPos(0, Number(e.target.value))}
                          title="Position X (km)"
                          className="w-full bg-space-dark border border-space-border rounded px-1.5 py-0.5 text-slate-200 text-center focus:outline-none focus:border-cyan text-[11px]"
                        />
                        <input
                          type="number"
                          step="1"
                          value={parentAPos[1]}
                          onChange={(e) => updateParentAPos(1, Number(e.target.value))}
                          title="Position Y (km)"
                          className="w-full bg-space-dark border border-space-border rounded px-1.5 py-0.5 text-slate-200 text-center focus:outline-none focus:border-cyan text-[11px]"
                        />
                        <input
                          type="number"
                          step="1"
                          value={parentAPos[2]}
                          onChange={(e) => updateParentAPos(2, Number(e.target.value))}
                          title="Position Z (km)"
                          className="w-full bg-space-dark border border-space-border rounded px-1.5 py-0.5 text-slate-200 text-center focus:outline-none focus:border-cyan text-[11px]"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400 block font-sans">
                        Velocity [Vx, Vy, Vz] (km/s):
                      </span>
                      <div className="grid grid-cols-3 gap-1">
                        <input
                          type="number"
                          step="0.001"
                          value={parentAVel[0]}
                          onChange={(e) => updateParentAVel(0, Number(e.target.value))}
                          title="Velocity Vx (km/s)"
                          className="w-full bg-space-dark border border-space-border rounded px-1.5 py-0.5 text-slate-200 text-center focus:outline-none focus:border-cyan text-[11px]"
                        />
                        <input
                          type="number"
                          step="0.001"
                          value={parentAVel[1]}
                          onChange={(e) => updateParentAVel(1, Number(e.target.value))}
                          title="Velocity Vy (km/s)"
                          className="w-full bg-space-dark border border-space-border rounded px-1.5 py-0.5 text-slate-200 text-center focus:outline-none focus:border-cyan text-[11px]"
                        />
                        <input
                          type="number"
                          step="0.0001"
                          value={parentAVel[2]}
                          onChange={(e) => updateParentAVel(2, Number(e.target.value))}
                          title="Velocity Vz (km/s)"
                          className="w-full bg-space-dark border border-space-border rounded px-1.5 py-0.5 text-slate-200 text-center focus:outline-none focus:border-cyan text-[11px]"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Body B */}
                <div className="p-3 rounded-md bg-space-surface border border-space-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-sans uppercase text-rose-400 font-bold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-rose-400 inline-block" />
                      Body B (Impactor) — {parentBId}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs font-mono">
                      <span className="text-slate-400 text-[10px]">Mass:</span>
                      <input
                        type="number"
                        step="10"
                        min="1"
                        value={parentBMass}
                        onChange={(e) => setParentBMass(Number(e.target.value))}
                        className="w-20 bg-space-dark border border-space-border rounded px-2 py-0.5 text-slate-100 text-xs font-mono text-right focus:outline-none focus:border-rose-400"
                      />
                      <span className="text-slate-400 text-[10px]">kg</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 font-mono">
                      Object Designation (Full Name):
                    </label>
                    <input
                      type="text"
                      value={parentBName}
                      onChange={(e) => setParentBName(e.target.value)}
                      placeholder="Parent B Name"
                      title={parentBName}
                      className="w-full bg-space-dark border border-space-border rounded px-2.5 py-1 text-slate-100 text-xs font-mono focus:outline-none focus:border-rose-400"
                    />
                  </div>

                  {/* Cartesian Coordinates Micro-Grid */}
                  <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] font-mono">
                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400 block font-sans">
                        Position [X, Y, Z] (km):
                      </span>
                      <div className="grid grid-cols-3 gap-1">
                        <input
                          type="number"
                          step="10"
                          value={parentBPos[0]}
                          onChange={(e) => updateParentBPos(0, Number(e.target.value))}
                          title="Position X (km)"
                          className="w-full bg-space-dark border border-space-border rounded px-1.5 py-0.5 text-slate-200 text-center focus:outline-none focus:border-rose-400 text-[11px]"
                        />
                        <input
                          type="number"
                          step="0.01"
                          value={parentBPos[1]}
                          onChange={(e) => updateParentBPos(1, Number(e.target.value))}
                          title="Position Y (km)"
                          className="w-full bg-space-dark border border-space-border rounded px-1.5 py-0.5 text-slate-200 text-center focus:outline-none focus:border-rose-400 text-[11px]"
                        />
                        <input
                          type="number"
                          step="1"
                          value={parentBPos[2]}
                          onChange={(e) => updateParentBPos(2, Number(e.target.value))}
                          title="Position Z (km)"
                          className="w-full bg-space-dark border border-space-border rounded px-1.5 py-0.5 text-slate-200 text-center focus:outline-none focus:border-rose-400 text-[11px]"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400 block font-sans">
                        Velocity [Vx, Vy, Vz] (km/s):
                      </span>
                      <div className="grid grid-cols-3 gap-1">
                        <input
                          type="number"
                          step="0.001"
                          value={parentBVel[0]}
                          onChange={(e) => updateParentBVel(0, Number(e.target.value))}
                          title="Velocity Vx (km/s)"
                          className="w-full bg-space-dark border border-space-border rounded px-1.5 py-0.5 text-slate-200 text-center focus:outline-none focus:border-rose-400 text-[11px]"
                        />
                        <input
                          type="number"
                          step="0.001"
                          value={parentBVel[1]}
                          onChange={(e) => updateParentBVel(1, Number(e.target.value))}
                          title="Velocity Vy (km/s)"
                          className="w-full bg-space-dark border border-space-border rounded px-1.5 py-0.5 text-slate-200 text-center focus:outline-none focus:border-rose-400 text-[11px]"
                        />
                        <input
                          type="number"
                          step="0.0001"
                          value={parentBVel[2]}
                          onChange={(e) => updateParentBVel(2, Number(e.target.value))}
                          title="Velocity Vz (km/s)"
                          className="w-full bg-space-dark border border-space-border rounded px-1.5 py-0.5 text-slate-200 text-center focus:outline-none focus:border-rose-400 text-[11px]"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SECTION 2: Collapsible Fragmentation Model Parameters */}
          <div className="rounded-lg border border-space-border bg-space-panel/60 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection("fragmentation")}
              className="w-full px-3.5 py-2.5 flex items-center justify-between bg-space-dark/80 hover:bg-space-dark transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                {sections.fragmentation ? (
                  <ChevronDown className="h-3.5 w-3.5 text-cyan shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                )}
                <span className="text-xs font-sans font-bold uppercase tracking-wider text-slate-200">
                  2. Fragmentation Model Parameters
                </span>
              </div>
              <Badge variant="outline" size="sm" className="font-mono text-[10px] text-slate-300">
                {fragCount} Frags | {(maxDvKms * 1000).toFixed(0)} m/s Max Δv
              </Badge>
            </button>

            {sections.fragmentation && (
              <div className="p-3 border-t border-space-border/60">
                <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
                  <div className="space-y-1">
                    <span className="text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider block">
                      Fragment Count
                    </span>
                    <input
                      type="number"
                      min="2"
                      max="500"
                      value={fragCount}
                      onChange={(e) => setFragCount(Number(e.target.value))}
                      className="w-full bg-space-dark border border-space-border rounded px-2.5 py-1 text-slate-100 text-xs font-mono focus:outline-none focus:border-cyan"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider block">
                      Max Ejection Δv (km/s)
                    </span>
                    <input
                      type="number"
                      step="0.001"
                      min="0.0001"
                      max="0.05"
                      value={maxDvKms}
                      onChange={(e) => setMaxDvKms(Number(e.target.value))}
                      className="w-full bg-space-dark border border-space-border rounded px-2.5 py-1 text-slate-100 text-xs font-mono focus:outline-none focus:border-cyan"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider block">
                      Mass Bounds (Min / Max kg)
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="number"
                        step="0.5"
                        min="0.1"
                        value={minMass}
                        onChange={(e) => setMinMass(Number(e.target.value))}
                        title="Min Fragment Mass (kg)"
                        placeholder="Min"
                        className="w-full bg-space-dark border border-space-border rounded px-2 py-1 text-slate-100 text-xs font-mono focus:outline-none focus:border-cyan"
                      />
                      <input
                        type="number"
                        step="1.0"
                        min="1.0"
                        value={maxMass}
                        onChange={(e) => setMaxMass(Number(e.target.value))}
                        title="Max Fragment Mass (kg)"
                        placeholder="Max"
                        className="w-full bg-space-dark border border-space-border rounded px-2 py-1 text-slate-100 text-xs font-mono focus:outline-none focus:border-cyan"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider block">
                      PRNG Seed (Reproducibility)
                    </span>
                    <input
                      type="number"
                      value={seed}
                      onChange={(e) => setSeed(e.target.value === "" ? "" : Number(e.target.value))}
                      placeholder="Unseeded (None)"
                      className="w-full bg-space-dark border border-space-border rounded px-2.5 py-1 text-slate-100 text-xs font-mono focus:outline-none focus:border-cyan"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SECTION 3: Collapsible Numerical Integrator & Output Knot Guardrail */}
          <div className="rounded-lg border border-space-border bg-space-panel/60 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection("integrator")}
              className="w-full px-3.5 py-2.5 flex items-center justify-between bg-space-dark/80 hover:bg-space-dark transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                {sections.integrator ? (
                  <ChevronDown className="h-3.5 w-3.5 text-cyan shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                )}
                <span className="text-xs font-sans font-bold uppercase tracking-wider text-slate-200">
                  3. Integrator & Knot Sampling
                </span>
              </div>
              <Badge variant="outline" size="sm" className="font-mono text-[10px] text-slate-300">
                Step {stepSec}s | Duration {durationSec}s
              </Badge>
            </button>

            {sections.integrator && (
              <div className="p-3 border-t border-space-border/60 space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
                  <div className="space-y-1">
                    <span className="text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider block">
                      Duration (Seconds)
                    </span>
                    <input
                      type="number"
                      step="10"
                      min="10"
                      max="3600"
                      value={durationSec}
                      onChange={(e) => setDurationSec(Number(e.target.value))}
                      className="w-full bg-space-dark border border-space-border rounded px-2.5 py-1 text-slate-100 text-xs font-mono focus:outline-none focus:border-cyan"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider">
                        Output Knot Step (s)
                      </span>
                      <span className="text-[9px] text-cyan font-bold font-mono">
                        &le; 60s Guardrail
                      </span>
                    </div>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="60"
                      value={stepSec}
                      onChange={(e) => setStepSec(Number(e.target.value))}
                      className="w-full bg-space-dark border border-space-border rounded px-2.5 py-1 text-slate-100 text-xs font-mono focus:outline-none focus:border-cyan"
                    />
                  </div>
                </div>

                <p className="text-[10px] text-slate-400 font-mono leading-tight bg-space-dark/80 p-2 rounded border border-space-border/60">
                  <strong className="text-slate-300">Targeting Knot Guardrail:</strong> Output trajectory knot interval (step_seconds). A maximum interval of 60.0s is enforced as a rendezvous-targeting interpolation knot guardrail, not as a universal DOP853 integrator step limit.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Viewport-Aware Bottom Action Bar */}
        <div className="pt-3 border-t border-space-border/60 flex items-center justify-between gap-3">
          <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
            Solver: Cowell DOP853 (J2) • Knot &le; 60s
          </span>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={isLoading}
            disabled={isLoading}
            className="gap-2 font-mono text-xs w-full sm:w-auto shadow-glow-cyan"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>RUN SIMULATION</span>
          </Button>
        </div>
      </form>
    </Card>
  );
};
