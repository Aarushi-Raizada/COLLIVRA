"use client";

import React from "react";
import {
  X,
  Play,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Radar,
  ShieldAlert,
  Flame,
  Crosshair,
  Activity,
} from "lucide-react";
import { NavigationTab } from "@/types/orbital";
import { CANONICAL_DEMO_SCENARIOS, DemonstrationScenario } from "@/lib/workflow";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

export interface ScenarioLauncherModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab: (
    tab: NavigationTab,
    objectId?: string | null,
    subtab?: string | null,
    eventId?: string | null,
    scenarioId?: string | null
  ) => void;
}

export const ScenarioLauncherModal: React.FC<ScenarioLauncherModalProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
}) => {
  if (!isOpen) return null;

  const handleLaunchScenario = (scenario: DemonstrationScenario) => {
    onNavigateTab(
      scenario.targetTab,
      scenario.targetObjectId || null,
      scenario.targetSubtab || null,
      scenario.targetEventId || null,
      scenario.targetScenarioId || null
    );
    onClose();
  };

  const getScenarioIcon = (id: string) => {
    switch (id) {
      case "scenario-a":
        return <Radar className="h-4 w-4 text-cyan" />;
      case "scenario-b":
        return <ShieldAlert className="h-4 w-4 text-rose-400" />;
      case "scenario-c":
        return <Flame className="h-4 w-4 text-amber-400" />;
      case "scenario-d":
        return <Crosshair className="h-4 w-4 text-cyan" />;
      case "scenario-e":
        return <Activity className="h-4 w-4 text-emerald-400" />;
      default:
        return <Sparkles className="h-4 w-4 text-cyan" />;
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
              <Sparkles className="h-5 w-5 text-cyan animate-pulse" />
              <h2 className="text-lg font-heading font-black tracking-wider text-white uppercase">
                Hackathon Demonstration Scenarios
              </h2>
              <Badge variant="cyan" size="sm">
                5 SCENARIOS
              </Badge>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-1">
              Deterministic, benchmark-verified scenarios designed for evaluation and presentation
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-space-panel transition-colors"
            title="Close Launcher"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scenarios Grid */}
        <div className="space-y-3">
          {CANONICAL_DEMO_SCENARIOS.map((scenario) => (
            <div
              key={scenario.id}
              className="p-4 rounded-xl border border-space-border/80 bg-space-panel/40 hover:bg-space-panel/80 hover:border-cyan/40 transition-all space-y-2.5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-xl bg-space-dark border border-space-border flex items-center justify-center shrink-0">
                    {getScenarioIcon(scenario.id)}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-cyan">
                        {scenario.scenarioCode}
                      </span>
                      <span className="text-slate-600">•</span>
                      <h3 className="font-heading text-xs font-bold text-white tracking-wide">
                        {scenario.name}
                      </h3>
                      <Badge variant="outline" size="sm">
                        {scenario.category}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-300 font-sans leading-relaxed">
                      {scenario.description}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 text-[11px] font-mono">
                      <div className="text-cyan-300">
                        <strong className="text-slate-400">Target Metric:</strong> {scenario.primaryMetric}
                      </div>
                      <div className="text-slate-400">
                        <strong className="text-slate-500">Guardrail:</strong> {scenario.scientificGuardrail}
                      </div>
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => handleLaunchScenario(scenario)}
                  className="shrink-0 font-mono text-xs gap-1.5 self-end sm:self-center"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>LAUNCH SCENARIO</span>
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-space-border/80 flex items-center justify-between text-xs font-mono text-slate-400">
          <span>Deterministic offline verification suite · Guaranteed zero network dependency</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
};
