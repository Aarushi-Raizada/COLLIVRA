"use client";

import React from "react";
import { Radio } from "lucide-react";

export const NavigationHydrationSkeleton: React.FC = () => {
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-4 2xl:space-y-6 animate-pulse"
      data-testid="navigation-hydration-skeleton"
    >
      {/* Top Neutral Status Header */}
      <div className="p-4 rounded-xl border border-space-border/80 bg-space-surface/60 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-cyan/10 border border-cyan/30 flex items-center justify-center">
            <Radio className="h-5 w-5 text-cyan animate-pulse" />
          </div>
          <div>
            <div className="font-mono text-xs font-bold text-slate-200 tracking-wider">
              SYNCHRONIZING ORBITAL STATE &amp; URL CONTEXT
            </div>
            <div className="text-[11px] text-slate-400 font-sans">
              Resolving canonical identifiers and projecting authoritative navigation state...
            </div>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 font-mono text-[11px] text-slate-500">
          <span className="inline-block h-2 w-2 rounded-full bg-cyan animate-ping" />
          <span>HYDRATING</span>
        </div>
      </div>

      {/* KPI Skeleton Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-24 rounded-xl border border-space-border/60 bg-space-surface/40 p-4 flex flex-col justify-between"
          >
            <div className="h-3 w-20 bg-slate-800/80 rounded" />
            <div className="h-6 w-32 bg-slate-700/60 rounded" />
            <div className="h-2 w-24 bg-slate-800/80 rounded" />
          </div>
        ))}
      </div>

      {/* Main Viewport Skeleton */}
      <div className="w-full h-[380px] xl:h-[460px] 2xl:h-[600px] rounded-2xl border border-space-border/60 bg-space-surface/30 flex flex-col items-center justify-center space-y-3">
        <div className="h-8 w-8 rounded-full border-2 border-cyan/40 border-t-cyan animate-spin" />
        <span className="font-mono text-xs text-slate-400 uppercase tracking-wider">
          Initializing Orbital Intelligence Viewport...
        </span>
      </div>
    </div>
  );
};

