"use client";

import React from "react";
import {
  X,
  ArrowRight,
  CheckCircle2,
  Compass,
  Layers,
  Activity,
  ShieldAlert,
  Flame,
  Crosshair,
  Orbit,
} from "lucide-react";
import { NavigationTab } from "@/types/orbital";
import { COLLIVRA_WORKFLOW_STEPS, WorkflowStep } from "@/lib/workflow";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

export interface WorkflowGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab: (
    tab: NavigationTab,
    objectId?: string | null,
    subtab?: string | null,
    eventId?: string | null,
    scenarioId?: string | null
  ) => void;
  activeTab: NavigationTab;
  activeSubtab?: string | null;
}

export const WorkflowGuideModal: React.FC<WorkflowGuideModalProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
  activeTab,
  activeSubtab,
}) => {
  if (!isOpen) return null;

  const isStepActive = (step: WorkflowStep) => {
    if (activeTab !== step.tab) return false;
    if (step.tab === "simulation") {
      if (step.subtab === "remediation") {
        return activeSubtab === "remediation";
      }
      return activeSubtab !== "remediation";
    }
    return true;
  };

  const getStepIcon = (num: number) => {
    switch (num) {
      case 1:
        return <Orbit className="h-4 w-4 text-cyan" />;
      case 2:
        return <Compass className="h-4 w-4 text-emerald-400" />;
      case 3:
        return <ShieldAlert className="h-4 w-4 text-blue" />;
      case 4:
        return <Activity className="h-4 w-4 text-rose-400" />;
      case 5:
        return <Flame className="h-4 w-4 text-amber-400" />;
      case 6:
        return <Crosshair className="h-4 w-4 text-cyan" />;
      case 7:
        return <Layers className="h-4 w-4 text-emerald-400" />;
      default:
        return <CheckCircle2 className="h-4 w-4 text-slate-400" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-space-bg/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-cyan/40 bg-space-surface p-6 shadow-2xl text-slate-200 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-space-border/80">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan animate-pulse" />
              <h2 className="text-lg font-heading font-black tracking-wider text-white uppercase">
                COLLIVRA Unified Operational Workflow
              </h2>
              <Badge variant="cyan" size="sm">
                7 STEPS
              </Badge>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-1">
              End-to-End Space Situational Awareness & Orbital Sustainability Operational Cycle
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-space-panel transition-colors"
            title="Close Guide"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Workflow Concept Banner */}
        <div className="p-3.5 rounded-xl border border-cyan/30 bg-cyan-950/20 text-xs font-mono text-cyan-200 flex items-center justify-between gap-3">
          <span>
            <strong>OPERATIONAL PRINCIPLE:</strong> COLLIVRA connects six specialized pillars into a unified operational pipeline: from asset identification to threat screening, numerical debris propagation, active remediation, and calibrated data provenance.
          </span>
        </div>

        {/* Steps List */}
        <div className="space-y-3">
          {COLLIVRA_WORKFLOW_STEPS.map((step) => {
            const isActive = isStepActive(step);

            return (
              <div
                key={step.id}
                className={`p-4 rounded-xl border transition-all ${
                  isActive
                    ? "border-cyan bg-cyan-950/30 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                    : "border-space-border/80 bg-space-panel/40 hover:bg-space-panel/80 hover:border-space-border"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 border ${
                        isActive
                          ? "bg-cyan/20 border-cyan text-cyan"
                          : "bg-space-dark border-space-border text-slate-400"
                      }`}
                    >
                      {getStepIcon(step.stepNumber)}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-heading text-xs font-bold text-white tracking-wide">
                          Step 0{step.stepNumber} · {step.name}
                        </span>
                        <Badge
                          variant={isActive ? "cyan" : "outline"}
                          size="sm"
                        >
                          Pillar {step.pillarNumber}
                        </Badge>
                        {isActive && (
                          <Badge variant="emerald" size="sm">
                            CURRENT ACTIVE VIEW
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-300 font-sans leading-relaxed">
                        {step.description}
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 text-[11px] font-mono">
                        <div className="text-cyan-300">
                          <strong className="text-slate-400">Action:</strong> {step.operationalOutcome}
                        </div>
                        <div className="text-slate-400">
                          <strong className="text-slate-500">Guardrail:</strong> {step.scientificContext}
                        </div>
                      </div>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant={isActive ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => {
                      onNavigateTab(step.tab, null, step.subtab || null);
                      onClose();
                    }}
                    className="shrink-0 font-mono text-xs gap-1.5 self-end sm:self-center"
                  >
                    <span>{isActive ? "VIEWING" : "JUMP TO STEP"}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-space-border/80 flex items-center justify-between text-xs font-mono text-slate-400">
          <span>Project COLLIVRA · Team Errorists · ASTRA 2026</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close Guide
          </Button>
        </div>
      </div>
    </div>
  );
};
