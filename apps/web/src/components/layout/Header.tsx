"use client";

import React, { useState, useEffect } from "react";
import {
  Clock,
  RefreshCw,
  Database,
  Menu,
  X,
  Orbit,
  Sparkles,
  Route,
  Globe,
} from "lucide-react";
import { NavigationTab, ApiConnectionStatus } from "@/types/orbital";
import { Button } from "../ui/Button";
import { StatusIndicator } from "../ui/StatusIndicator";
import { WorkflowGuideModal } from "./WorkflowGuideModal";
import { ScenarioLauncherModal } from "./ScenarioLauncherModal";
import { IndianSpaceModal } from "./IndianSpaceModal";

export interface HeaderProps {
  activeTab: NavigationTab;
  activeSubtab?: string | null;
  onTabChange: (tab: NavigationTab, subtab?: string | null) => void;
  onNavigateTab?: (
    tab: NavigationTab,
    objectId?: string | null,
    subtab?: string | null,
    eventId?: string | null,
    scenarioId?: string | null
  ) => void;
  isDemoMode: boolean;
  onToggleDemoMode: () => void;
  apiStatus: ApiConnectionStatus;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  activeSubtab,
  onTabChange,
  onNavigateTab,
  isDemoMode,
  onToggleDemoMode,
  apiStatus,
  onRefresh,
  isRefreshing = false,
}) => {
  const [currentUtc, setCurrentUtc] = useState<string>("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const [indianSpaceOpen, setIndianSpaceOpen] = useState(false);

  const handleNavigate = (
    tab: NavigationTab,
    objectId?: string | null,
    subtab?: string | null,
    eventId?: string | null,
    scenarioId?: string | null
  ) => {
    if (onNavigateTab) {
      onNavigateTab(tab, objectId, subtab, eventId, scenarioId);
    } else {
      onTabChange(tab, subtab);
    }
  };

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const ms = String(now.getUTCMilliseconds()).padStart(3, "0");
      setCurrentUtc(
        `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}.${ms} UTC`
      );
    };

    updateClock();
    const interval = setInterval(updateClock, 100);
    return () => clearInterval(interval);
  }, []);

  const getPillarTitle = (tab: NavigationTab, subtab?: string | null): string => {
    switch (tab) {
      case "overview":
        return "Pillar 01 · Mission Overview";
      case "radar":
        return "Pillar 02 · Orbital Environment Explorer";
      case "conjunctions":
        return "Pillar 03 · Collision Intelligence";
      case "simulation":
        return subtab === "remediation"
          ? "Pillar 05 · Mitigation & Sustainability"
          : "Pillar 04 · Debris Evolution Laboratory";
      case "system":
        return "Pillar 06 · System & Data Integrity";
      default:
        return "Mission Control";
    }
  };

  const mobileNavItems: {
    tab: NavigationTab;
    subtab: string | null;
    pillarNumber: string;
    label: string;
  }[] = [
    { tab: "overview", subtab: null, pillarNumber: "01", label: "Mission Overview" },
    { tab: "radar", subtab: null, pillarNumber: "02", label: "Orbital Explorer" },
    { tab: "conjunctions", subtab: null, pillarNumber: "03", label: "Collision Intelligence" },
    { tab: "simulation", subtab: "breakup", pillarNumber: "04", label: "Debris Evolution Lab" },
    { tab: "simulation", subtab: "remediation", pillarNumber: "05", label: "Mitigation & Planning" },
    { tab: "system", subtab: null, pillarNumber: "06", label: "System Integrity" },
  ];

  const isMobileItemActive = (item: (typeof mobileNavItems)[0]) => {
    if (activeTab !== item.tab) return false;
    if (item.tab === "simulation") {
      if (item.subtab === "remediation") {
        return activeSubtab === "remediation";
      }
      return activeSubtab !== "remediation";
    }
    return true;
  };

  return (
    <header className="sticky top-0 z-40 border-b border-space-border bg-space-surface/90 backdrop-blur-md select-none">
      <div className="flex h-14 sm:h-16 items-center justify-between px-4 sm:px-6">
        {/* Left: Mobile hamburger & breadcrumb title */}
        <div className="flex items-center space-x-3 min-w-0">
          <button
            type="button"
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-space-panel transition-colors shrink-0"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle Navigation"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="md:hidden flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 border border-cyan/30 text-cyan shrink-0">
              <Orbit className="h-4 w-4" />
            </div>
            <span className="font-heading font-black tracking-widest text-white text-sm sm:text-base shrink-0">
              COLLIVRA
            </span>
            <span className="hidden sm:inline-block text-slate-600">/</span>
            <span className="hidden sm:inline-block text-[11px] font-sans font-bold text-slate-400 uppercase tracking-widest shrink-0">
              MISSION CONTROL
            </span>
            <span className="hidden sm:inline-block text-slate-600">/</span>
            <h1 className="text-xs sm:text-sm font-sans font-bold tracking-normal text-cyan uppercase truncate">
              {getPillarTitle(activeTab, activeSubtab)}
            </h1>
          </div>
        </div>

        {/* Right: Clock, Status Indicator, Demo Toggle, Refresh */}
        <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
          {/* Quick Operational Modals Trigger */}
          <div className="hidden lg:flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => setWorkflowOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-cyan/40 bg-cyan-950/20 text-cyan hover:bg-cyan/10 transition-colors text-xs font-mono font-medium cursor-pointer"
              title="Open 7-Step Operational SSA Workflow Guide"
            >
              <Route className="h-3.5 w-3.5" />
              <span>Workflow</span>
            </button>
            <button
              type="button"
              onClick={() => setScenariosOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-purple-500/40 bg-purple-950/20 text-purple-300 hover:bg-purple-900/30 transition-colors text-xs font-mono font-medium cursor-pointer"
              title="Launch 5 Canonical Hackathon Demonstration Scenarios"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Scenarios</span>
            </button>
            <button
              type="button"
              onClick={() => setIndianSpaceOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/40 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-900/30 transition-colors text-xs font-mono font-medium cursor-pointer"
              title="Inspect Indian Space Ecosystem & IS4OM Relevance (Domain 01)"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>ISRO / India</span>
            </button>
          </div>

          {/* Live UTC Clock */}
          <div className="hidden lg:flex items-center space-x-2 px-3 py-1 rounded-full border border-space-border bg-space-panel/60 text-xs font-mono tabular-nums text-cyan">
            <Clock className="h-3.5 w-3.5 text-cyan animate-pulse shrink-0" />
            <span className="font-semibold tracking-wider">{currentUtc || "00:00:00.000 UTC"}</span>
          </div>

          {/* Backend Connection Status Pill */}
          <StatusIndicator
            status={
              isDemoMode
                ? "disconnected"
                : apiStatus.connected
                ? "connected"
                : apiStatus.state
            }
            label={
              isDemoMode
                ? "DEMO FIXTURES"
                : apiStatus.connected
                ? "OPERATIONAL"
                : "OFFLINE"
            }
            latencyMs={isDemoMode ? undefined : apiStatus.latencyMs}
          />

          {/* Demo Mode Toggle */}
          <button
            type="button"
            onClick={onToggleDemoMode}
            className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-sans font-semibold uppercase tracking-wider transition-all cursor-pointer select-none ${
              isDemoMode
                ? "border-status-warning/40 bg-status-warning/10 text-amber-300 hover:bg-status-warning/20 shadow-[0_0_10px_rgba(245,158,11,0.15)]"
                : "border-space-border bg-space-panel text-slate-300 hover:text-white hover:border-space-border-light"
            }`}
            title="Toggle between Live FastAPI backend and offline fixtures"
          >
            <Database className="h-3.5 w-3.5" />
            <span>{isDemoMode ? "DEMO ACTIVE" : "LIVE BACKEND"}</span>
          </button>

          {/* Manual Refresh */}
          {onRefresh && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1.5 h-8 w-8 sm:h-auto sm:w-auto text-xs"
              title="Refresh telemetry and screening"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-slate-300 ${isRefreshing ? "animate-spin text-cyan" : ""}`}
              />
              <span className="hidden sm:inline">SYNC</span>
            </Button>
          )}
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-space-border bg-space-surface p-4 space-y-2 max-h-[calc(100vh-4rem)] overflow-y-auto">
          <div className="text-[10px] font-sans font-semibold uppercase tracking-widest text-slate-400 px-1 mb-2">
            SIX OPERATIONAL PILLARS
          </div>
          {mobileNavItems.map((item) => {
            const isActive = isMobileItemActive(item);
            return (
              <button
                key={`${item.tab}-${item.subtab || "default"}`}
                type="button"
                onClick={() => {
                  onTabChange(item.tab, item.subtab);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-sans font-semibold uppercase tracking-wide transition-colors ${
                  isActive
                    ? "bg-cyan/15 border border-cyan/40 text-cyan"
                    : "text-slate-400 hover:text-white hover:bg-space-panel"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono font-bold text-cyan/70">
                    {item.pillarNumber}
                  </span>
                  <span>{item.label}</span>
                </div>
                {item.subtab && (
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded border border-space-border text-slate-400">
                    {item.subtab}
                  </span>
                )}
              </button>
            );
          })}

          {/* Quick Operational Tools for Mobile */}
          <div className="pt-3 mt-2 border-t border-space-border/60 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setWorkflowOpen(true);
              }}
              className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-cyan/40 bg-cyan-950/20 text-cyan text-xs font-mono font-medium"
            >
              <Route className="h-3.5 w-3.5" />
              <span>Workflow</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setScenariosOpen(true);
              }}
              className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-purple-500/40 bg-purple-950/20 text-purple-300 text-xs font-mono font-medium"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Scenarios</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setIndianSpaceOpen(true);
              }}
              className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-emerald-500/40 bg-emerald-950/20 text-emerald-300 text-xs font-mono font-medium"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>ISRO</span>
            </button>
          </div>
        </div>
      )}

      {/* Persistent Guidance & Demonstration Modals */}
      <WorkflowGuideModal
        isOpen={workflowOpen}
        onClose={() => setWorkflowOpen(false)}
        onNavigateTab={handleNavigate}
        activeTab={activeTab}
        activeSubtab={activeSubtab}
      />

      <ScenarioLauncherModal
        isOpen={scenariosOpen}
        onClose={() => setScenariosOpen(false)}
        onNavigateTab={handleNavigate}
      />

      <IndianSpaceModal
        isOpen={indianSpaceOpen}
        onClose={() => setIndianSpaceOpen(false)}
      />
    </header>
  );
};
