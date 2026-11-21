"use client";

import React from "react";
import {
  Orbit,
  LayoutDashboard,
  Radar,
  ShieldAlert,
  Flame,
  Activity,
  Server,
  Crosshair,
} from "lucide-react";
import { NavigationTab, ApiConnectionStatus } from "@/types/orbital";
import { Badge } from "../ui/Badge";

export interface SidebarProps {
  activeTab: NavigationTab;
  activeSubtab?: string | null;
  onTabChange: (tab: NavigationTab, subtab?: string | null) => void;
  apiStatus: ApiConnectionStatus;
  apiBaseUrl: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  activeSubtab,
  onTabChange,
  apiStatus,
  apiBaseUrl,
}) => {
  const navigationItems = [
    {
      id: "overview" as NavigationTab,
      subtab: null,
      pillarNumber: "01",
      label: "Mission Overview",
      icon: LayoutDashboard,
      badge: "LIVE",
      badgeVariant: "emerald" as const,
      description: "Pillar 1 · Executive SSA & Threat Overview",
    },
    {
      id: "radar" as NavigationTab,
      subtab: null,
      pillarNumber: "02",
      label: "Orbital Explorer",
      icon: Radar,
      badge: "3D GCRS",
      badgeVariant: "cyan" as const,
      description: "Pillar 2 · 3D Environment & Object Telemetry",
    },
    {
      id: "conjunctions" as NavigationTab,
      subtab: null,
      pillarNumber: "03",
      label: "Collision Intelligence",
      icon: ShieldAlert,
      badge: "SGP4",
      badgeVariant: "rose" as const,
      description: "Pillar 3 · Close-Approach Triage & Geometry",
    },
    {
      id: "simulation" as NavigationTab,
      subtab: "breakup",
      pillarNumber: "04",
      label: "Debris Evolution Lab",
      icon: Flame,
      badge: "DOP853",
      badgeVariant: "amber" as const,
      description: "Pillar 4 · Fragmentation & Numerical Batch Propagation",
    },
    {
      id: "simulation" as NavigationTab,
      subtab: "remediation",
      pillarNumber: "05",
      label: "Mitigation & Planning",
      icon: Crosshair,
      badge: "CW HILL",
      badgeVariant: "cyan" as const,
      description: "Pillar 5 · Clohessy-Wiltshire 2-Impulse Rendezvous",
    },
    {
      id: "system" as NavigationTab,
      subtab: null,
      pillarNumber: "06",
      label: "System Integrity",
      icon: Activity,
      badge: "HEALTH",
      badgeVariant: "emerald" as const,
      description: "Pillar 6 · Operational Status & Telemetry",
    },
  ];

  const isItemActive = (item: (typeof navigationItems)[0]) => {
    if (activeTab !== item.id) return false;
    if (item.id === "simulation") {
      if (item.subtab === "remediation") {
        return activeSubtab === "remediation";
      }
      return activeSubtab !== "remediation";
    }
    return true;
  };

  return (
    <aside className="hidden md:flex flex-col w-72 xl:w-80 border-r border-space-border bg-space-surface shrink-0 select-none overflow-hidden">
      {/* Brand Header */}
      <div className="flex items-center gap-3 h-14 sm:h-16 px-5 border-b border-space-border bg-space-surface/60">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan/10 border border-cyan/30 text-cyan shadow-[0_0_12px_rgba(6,182,212,0.2)] shrink-0">
          <Orbit className="h-5 w-5 animate-pulse" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-heading text-lg font-black tracking-widest text-white truncate">
              COLLIVRA
            </span>
            <Badge variant="cyan" size="sm">
              SSA
            </Badge>
          </div>
          <p className="text-[10px] font-sans font-medium text-slate-400 truncate">
            See the risk. Secure the orbit.
          </p>
        </div>
      </div>

      {/* Six-Pillar Navigation Menu */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="flex items-center justify-between px-3 mb-2">
          <span className="text-[10px] font-sans font-semibold uppercase tracking-widest text-slate-400">
            OPERATIONAL PILLARS
          </span>
          <span className="text-[9px] font-mono text-cyan/80 font-bold">
            6 PILLARS
          </span>
        </div>

        {navigationItems.map((item) => {
          const isActive = isItemActive(item);
          const Icon = item.icon;

          return (
            <button
              key={`${item.id}-${item.subtab || "default"}`}
              type="button"
              onClick={() => onTabChange(item.id, item.subtab)}
              title={item.description}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-sans font-medium tracking-normal transition-all group cursor-pointer ${
                isActive
                  ? "bg-cyan/10 text-cyan border border-cyan/40 shadow-[0_0_12px_rgba(6,182,212,0.15)] font-semibold"
                  : "text-slate-400 hover:text-slate-100 hover:bg-space-panel/50 border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                <span
                  className={`text-[9px] font-mono font-bold px-1 py-0.5 rounded ${
                    isActive
                      ? "text-cyan bg-cyan/20"
                      : "text-slate-400 bg-space-panel group-hover:text-slate-300"
                  }`}
                >
                  {item.pillarNumber}
                </span>
                <Icon
                  className={`h-4 w-4 shrink-0 transition-transform group-hover:scale-105 ${
                    isActive ? "text-cyan" : "text-slate-400 group-hover:text-slate-200"
                  }`}
                />
                <span className="whitespace-nowrap text-xs font-sans tracking-tight truncate">
                  {item.label}
                </span>
              </div>

              {item.badge && (
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wider shrink-0 ${
                    isActive
                      ? "border-cyan/50 bg-cyan/20 text-cyan-200"
                      : "border-space-border bg-space-panel text-slate-400"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Domain Relevance Indicator */}
      <div className="px-3 pb-1 pt-1 border-t border-space-border/60">
        <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-950/20 text-[10px] font-mono text-emerald-300 space-y-1">
          <div className="flex items-center justify-between font-bold">
            <span>DOMAIN 06 / DOMAIN 01</span>
            <Badge variant="emerald" size="sm">IS4OM READY</Badge>
          </div>
          <p className="text-slate-400 font-sans text-[10px] leading-tight">
            Sustainable Space Environment & Indian Space Missions
          </p>
        </div>
      </div>

      {/* Bottom Compact Environment Telemetry */}
      <div className="p-3 m-3 rounded-lg border border-space-border/80 bg-space-panel/40 backdrop-blur-md space-y-2">
        <div className="flex items-center justify-between text-[11px] font-sans text-slate-400">
          <span className="flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5 text-cyan" />
            <span className="font-medium text-slate-300">COLLIVRA CORE</span>
          </span>
          <span
            className={`font-mono text-[10px] font-bold ${
              apiStatus.connected ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            {apiStatus.connected ? "ONLINE" : "STANDBY"}
          </span>
        </div>

        <div className="text-[10px] font-mono text-slate-400 truncate">
          NODE: <span className="text-slate-300">{apiBaseUrl}</span>
        </div>

        <div className="flex items-center justify-between text-[10px] font-sans text-slate-400 pt-1.5 border-t border-space-border/50">
          <span>TEAM</span>
          <span className="text-cyan font-mono font-bold text-[10px]">ERRORISTS · ASTRA 2026</span>
        </div>
      </div>
    </aside>
  );
};
