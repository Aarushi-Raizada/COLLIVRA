"use client";

import React, { useState } from "react";
import {
  Layers,
  Globe,
  Orbit,
  Flame,
  Compass,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Filter,
} from "lucide-react";
import { SceneVisibilityState, ObjectFilterMode, AltitudeRegime } from "../../types/visualization";

export interface RegimeCounts {
  leo: number;
  meo: number;
  geo: number;
  totalVisible: number;
}

interface SceneControlsProps {
  visibility: SceneVisibilityState;
  onToggleVisibility: (key: keyof SceneVisibilityState) => void;
  onResetCamera: () => void;
  debrisCount: number;
  catalogCount: number;
  filterMode?: ObjectFilterMode;
  onSetFilterMode?: (mode: ObjectFilterMode) => void;
  activeRegimes?: Record<AltitudeRegime, boolean>;
  onToggleRegime?: (regime: AltitudeRegime) => void;
  onResetRegimes?: () => void;
  regimeCounts?: RegimeCounts;
}

export const SceneControls: React.FC<SceneControlsProps> = ({
  visibility,
  onToggleVisibility,
  onResetCamera,
  debrisCount,
  catalogCount,
  filterMode = "all",
  onSetFilterMode,
  activeRegimes = { LEO: true, MEO: true, GEO: true },
  onToggleRegime,
  onResetRegimes,
  regimeCounts = { leo: 0, meo: 0, geo: 0, totalVisible: 0 },
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasAnyRegime = activeRegimes.LEO || activeRegimes.MEO || activeRegimes.GEO;

  return (
    <div className="absolute top-4 left-4 z-20 w-64 rounded-xl border border-space-border bg-space-bg/90 backdrop-blur-md shadow-2xl text-xs font-mono text-slate-300">
      {/* Header bar */}
      <div className="flex items-center justify-between p-3 border-b border-space-border">
        <div className="flex items-center space-x-2">
          <Layers className="h-4 w-4 text-cyan" />
          <span className="font-heading font-bold tracking-wider uppercase text-slate-100">
            SCENE LAYERS
          </span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={onResetCamera}
            className="p-1 rounded text-slate-400 hover:text-cyan hover:bg-space-surface transition-colors"
            title="Reset Camera Position"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-space-surface transition-colors"
          >
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="p-3 space-y-3">
          {/* Quick Filter Selector */}
          {onSetFilterMode && (
            <div className="space-y-1.5 pb-2 border-b border-space-border/60">
              <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                <span className="flex items-center gap-1">
                  <Filter className="h-3 w-3 text-cyan" />
                  <span>FILTER OBJECTS</span>
                </span>
                <span className="text-cyan">{filterMode.toUpperCase()}</span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {(["all", "satellites", "debris", "selected"] as ObjectFilterMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onSetFilterMode(mode)}
                    className={`py-1 rounded text-[10px] text-center font-bold uppercase transition-all ${
                      filterMode === mode
                        ? "bg-cyan/20 text-cyan border border-cyan/50 shadow-[0_0_8px_rgba(6,182,212,0.3)]"
                        : "bg-space-surface/60 text-slate-400 hover:text-slate-200 hover:bg-space-surface border border-space-border/40"
                    }`}
                  >
                    {mode === "satellites" ? "Sats" : mode === "selected" ? "Sel" : mode}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Altitude Regime Filters (LEO / MEO / GEO) */}
          {onToggleRegime && (
            <div className="space-y-1.5 pb-2 border-b border-space-border/60">
              <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                <span className="flex items-center gap-1">
                  <Compass className="h-3 w-3 text-cyan" />
                  <span>ALTITUDE REGIMES</span>
                </span>
                {onResetRegimes && (
                  <button
                    type="button"
                    onClick={onResetRegimes}
                    className="text-[9px] text-cyan hover:underline uppercase font-bold"
                    title="Reset all regimes to active"
                  >
                    RESET
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(["LEO", "MEO", "GEO"] as AltitudeRegime[]).map((regime) => {
                  const active = activeRegimes[regime];
                  const count =
                    regime === "LEO"
                      ? regimeCounts.leo
                      : regime === "MEO"
                      ? regimeCounts.meo
                      : regimeCounts.geo;
                  return (
                    <button
                      key={regime}
                      type="button"
                      onClick={() => onToggleRegime(regime)}
                      className={`py-1 px-1 rounded text-[10px] flex flex-col items-center justify-center font-bold uppercase transition-all ${
                        active
                          ? "bg-cyan/20 text-cyan border border-cyan/50 shadow-[0_0_8px_rgba(6,182,212,0.3)]"
                          : "bg-space-surface/40 text-slate-500 border border-space-border/30 hover:text-slate-300"
                      }`}
                      title={`${regime} band (${
                        regime === "LEO"
                          ? "160 - 2,000 km"
                          : regime === "MEO"
                          ? "2,000 - 35,786 km"
                          : "35,786 - 40,000 km"
                      })`}
                    >
                      <span>{regime}</span>
                      <span className="text-[8px] font-mono opacity-80">({count})</span>
                    </button>
                  );
                })}
              </div>
              {!hasAnyRegime && (
                <div className="text-[9px] text-amber-400 font-mono bg-amber-500/10 border border-amber-500/30 px-1.5 py-1 rounded text-center">
                  Zero regimes active (All orbits hidden)
                </div>
              )}
            </div>
          )}

          {/* Layer Toggles */}
          <div className="space-y-2">
            {/* Earth Body */}
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="flex items-center space-x-2 text-slate-300 group-hover:text-slate-100">
                <Globe className="h-3.5 w-3.5 text-cyan" />
                <span>Earth Surface</span>
              </span>
              <input
                type="checkbox"
                checked={visibility.earth}
                onChange={() => onToggleVisibility("earth")}
                className="accent-cyan rounded cursor-pointer"
              />
            </label>

            {/* Atmosphere Optical Glow */}
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="flex items-center space-x-2 text-slate-300 group-hover:text-slate-100">
                <span className="h-2 w-2 rounded-full bg-cyan/60" />
                <span>Atmospheric Glow</span>
              </span>
              <input
                type="checkbox"
                checked={visibility.atmosphere}
                onChange={() => onToggleVisibility("atmosphere")}
                className="accent-cyan rounded cursor-pointer"
              />
            </label>

            {/* Atmospheric Interface Shell (6478.137 km) */}
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="flex items-center space-x-2 text-slate-300 group-hover:text-slate-100">
                <span className="h-2 w-2 rounded-full bg-status-warning" />
                <span>Re-entry Shell (6478 km)</span>
              </span>
              <input
                type="checkbox"
                checked={visibility.atmosphericInterface}
                onChange={() => onToggleVisibility("atmosphericInterface")}
                className="accent-amber-500 rounded cursor-pointer"
              />
            </label>

            {/* Coordinate Lat/Long Grid */}
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="flex items-center space-x-2 text-slate-300 group-hover:text-slate-100">
                <Compass className="h-3.5 w-3.5 text-slate-400" />
                <span>Lat/Long Grid</span>
              </span>
              <input
                type="checkbox"
                checked={visibility.latLongGrid}
                onChange={() => onToggleVisibility("latLongGrid")}
                className="accent-cyan rounded cursor-pointer"
              />
            </label>

            {/* Orbit Trajectories */}
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="flex items-center space-x-2 text-slate-300 group-hover:text-slate-100">
                <Orbit className="h-3.5 w-3.5 text-cyan" />
                <span>Orbit Trajectories</span>
              </span>
              <input
                type="checkbox"
                checked={visibility.orbits}
                onChange={() => onToggleVisibility("orbits")}
                className="accent-cyan rounded cursor-pointer"
              />
            </label>

            {/* Catalog Satellites */}
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="flex items-center space-x-2 text-slate-300 group-hover:text-slate-100">
                <span className="h-2 w-2 rounded-full bg-cyan animate-pulse" />
                <span>Catalog Objects ({catalogCount})</span>
              </span>
              <input
                type="checkbox"
                checked={visibility.catalogObjects}
                onChange={() => onToggleVisibility("catalogObjects")}
                className="accent-cyan rounded cursor-pointer"
              />
            </label>

            {/* Synthetic Debris Cloud */}
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="flex items-center space-x-2 text-slate-300 group-hover:text-slate-100">
                <Flame className="h-3.5 w-3.5 text-status-critical" />
                <span>Debris Cloud ({debrisCount})</span>
              </span>
              <input
                type="checkbox"
                checked={visibility.debrisCloud}
                onChange={() => onToggleVisibility("debrisCloud")}
                className="accent-rose-500 rounded cursor-pointer"
              />
            </label>
          </div>

          {/* Telemetry info summary */}
          <div className="pt-2 border-t border-space-border/60 text-[10px] text-slate-500 space-y-0.5">
            <div className="flex justify-between">
              <span>Display Scale:</span>
              <span className="text-slate-300 font-bold">1 unit = 1,000 km</span>
            </div>
            <div className="flex justify-between">
              <span>World Frame:</span>
              <span className="text-cyan font-bold">Inertial GCRS</span>
            </div>
            <div className="flex justify-between">
              <span>Earth Rotation:</span>
              <span className="text-slate-400">Independent (No double rot)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

