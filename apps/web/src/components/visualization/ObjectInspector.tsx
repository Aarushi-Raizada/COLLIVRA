"use client";

import React from "react";
import {
  X,
  Crosshair,
  Satellite,
  Flame,
  ShieldCheck,
  ShieldAlert,
  Orbit,
  Compass,
  EyeOff,
} from "lucide-react";
import { SelectedObjectInfo } from "../../types/visualization";
import {
  calculateAltitudeKm,
  calculateSpeedKms,
  isAtmosphericReentry,
} from "../../lib/coordinates";
import { classifyAltitudeRegime } from "../../lib/altitudeRegimes";
import { formatDistanceKm, formatVelocityKms } from "../../lib/utils";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

interface ObjectInspectorProps {
  selectedObject: SelectedObjectInfo;
  onClose: () => void;
  onFocusCamera: () => void;
  isHiddenByFilter?: boolean;
  onRevealObject?: () => void;
  onNavigateTab?: (
    tab: "overview" | "radar" | "conjunctions" | "simulation" | "system",
    objectId?: string | null,
    subtab?: string | null
  ) => void;
}

export const ObjectInspector: React.FC<ObjectInspectorProps> = ({
  selectedObject,
  onClose,
  onFocusCamera,
  isHiddenByFilter = false,
  onRevealObject,
  onNavigateTab,
}) => {
  if (!selectedObject) return null;

  const isSatellite = selectedObject.type === "satellite";
  const sat = isSatellite ? selectedObject.satellite : null;
  const frag = !isSatellite ? selectedObject.fragment : null;

  const posKm = isSatellite ? sat!.currentPositionKm : frag!.positionGcrsKm;
  const velKms = isSatellite ? sat!.currentVelocityKms : frag!.velocityGcrsKms;

  const altitudeKm = calculateAltitudeKm(posKm[0], posKm[1], posKm[2]);
  const speedKms = calculateSpeedKms(velKms[0], velKms[1], velKms[2]);
  const isReentry = isAtmosphericReentry(posKm[0], posKm[1], posKm[2]);
  const regime = classifyAltitudeRegime(altitudeKm);

  return (
    <div className="absolute top-4 right-4 z-20 w-84 sm:w-[350px] rounded-xl border border-space-border bg-space-bg/95 backdrop-blur-md p-4 text-xs font-mono text-slate-300 shadow-2xl space-y-3">
      {/* Header bar */}
      <div className="flex items-start justify-between pb-2 border-b border-space-border">
        <div>
          <div className="flex items-center space-x-2">
            {isSatellite ? (
              <Satellite className="h-4 w-4 text-cyan" />
            ) : (
              <Flame className="h-4 w-4 text-status-critical" />
            )}
            <h3 className="font-heading font-bold text-slate-100 tracking-wide truncate max-w-[220px]">
              {isSatellite ? sat!.name : frag!.name}
            </h3>
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {isSatellite ? `NORAD CAT ID: ${sat!.noradCatId}` : `SYNTHETIC ID: ${frag!.id}`}
          </p>
        </div>

        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={onFocusCamera}
            className="p-1 rounded text-slate-400 hover:text-cyan hover:bg-space-surface transition-colors"
            title="Center Camera on Object"
          >
            <Crosshair className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-space-surface transition-colors"
            title="Close Inspector"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={isSatellite ? "cyan" : "critical"}>
          {isSatellite ? sat!.classification : "SYNTHETIC DEBRIS"}
        </Badge>
        <Badge
          variant={
            regime === "LEO"
              ? "cyan"
              : regime === "MEO"
              ? "blue"
              : regime === "GEO"
              ? "emerald"
              : "warning"
          }
        >
          {regime}
        </Badge>
        <Badge variant="outline">GCRS INERTIAL</Badge>
      </div>

      {/* Hidden by active filters alert */}
      {isHiddenByFilter && (
        <div className="p-2 rounded bg-amber-500/15 border border-amber-500/40 text-amber-200 text-[10px] font-mono flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <EyeOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span>HIDDEN BY ACTIVE FILTERS ({regime})</span>
          </div>
          {onRevealObject && (
            <button
              type="button"
              onClick={onRevealObject}
              className="text-[10px] text-amber-300 hover:text-white font-bold underline shrink-0 ml-2"
            >
              REVEAL
            </button>
          )}
        </div>
      )}

      {/* Primary Kinematics */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-lg border border-space-border/80 bg-space-surface/50">
          <span className="text-[10px] text-slate-400 block uppercase font-sans font-medium">Altitude</span>
          <span className={`font-bold tabular-nums text-sm ${isReentry ? "text-status-critical" : "text-cyan"}`}>
            {formatDistanceKm(altitudeKm, 1)}
          </span>
        </div>
        <div className="p-2.5 rounded-lg border border-space-border/80 bg-space-surface/50">
          <span className="text-[10px] text-slate-400 block uppercase font-sans font-medium">Orbital Speed</span>
          <span className="font-bold tabular-nums text-sm text-status-success">
            {formatVelocityKms(speedKms, 2)}
          </span>
        </div>
      </div>

      {/* Detailed Position & Velocity Components */}
      <div className="p-2.5 rounded-lg border border-space-border/60 bg-space-panel/40 space-y-1.5 text-[10px]">
        <div className="text-slate-400 font-sans font-semibold uppercase tracking-wider mb-1 flex items-center justify-between">
          <span>GCRS State Vectors</span>
          <span className="text-[9px] text-slate-500 font-mono">km, km/s</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">X:</span>
            <span className="text-slate-200 tabular-nums">{posKm[0].toFixed(1)} km</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Vx:</span>
            <span className="text-cyan tabular-nums">{velKms[0].toFixed(2)} km/s</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Y:</span>
            <span className="text-slate-200 tabular-nums">{posKm[1].toFixed(1)} km</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Vy:</span>
            <span className="text-cyan tabular-nums">{velKms[1].toFixed(2)} km/s</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Z:</span>
            <span className="text-slate-200 tabular-nums">{posKm[2].toFixed(1)} km</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Vz:</span>
            <span className="text-cyan tabular-nums">{velKms[2].toFixed(2)} km/s</span>
          </div>
        </div>
      </div>

      {/* Atmospheric Interface Safety Status */}
      <div className="flex items-center justify-between p-2 rounded-lg border border-space-border/60 bg-space-surface/40 text-[10px]">
        <span className="text-slate-400 font-sans font-medium">Atmosphere (6,478 km):</span>
        {isReentry ? (
          <span className="flex items-center gap-1 text-status-critical font-bold font-mono">
            <ShieldAlert className="h-3 w-3 shrink-0" />
            <span>BELOW INTERFACE</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-status-success font-bold font-mono">
            <ShieldCheck className="h-3 w-3 shrink-0" />
            <span>ORBITAL SAFE</span>
          </span>
        )}
      </div>

      {/* Mass for fragment */}
      {!isSatellite && frag && (
        <div className="flex justify-between items-center text-[10px] text-slate-300 px-2 py-1.5 rounded bg-space-panel/30 border border-space-border/40">
          <span className="text-slate-400">Fragment Mass:</span>
          <span className="text-status-warning font-bold tabular-nums">{frag.massKg} kg</span>
        </div>
      )}

      {/* Orbit parameters if satellite */}
      {isSatellite && sat?.trajectory?.periodMinutes && (
        <div className="flex justify-between items-center text-[10px] text-slate-300 px-2 py-1.5 rounded bg-space-panel/30 border border-space-border/40">
          <span className="text-slate-400">Orbital Period:</span>
          <span className="text-cyan font-bold tabular-nums">
            {sat.trajectory.periodMinutes.toFixed(2)} min
          </span>
        </div>
      )}

      {/* Focus / Action Buttons */}
      <div className="pt-1 space-y-1.5">
        <Button
          size="xs"
          variant="secondary"
          className="w-full gap-1.5"
          onClick={onFocusCamera}
        >
          <Crosshair className="h-3.5 w-3.5 text-cyan" />
          <span>FOCUS CAMERA ON OBJECT</span>
        </Button>

        {onNavigateTab && (
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            {isSatellite ? (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  className="w-full text-[10px] font-mono border-space-border hover:border-cyan/40"
                  onClick={() => onNavigateTab("conjunctions", sat!.noradCatId)}
                >
                  <Orbit className="h-3 w-3 text-cyan mr-1" />
                  Screen Threats
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  className="w-full text-[10px] font-mono border-space-border hover:border-rose-500/40"
                  onClick={() => onNavigateTab("simulation", sat!.noradCatId, "breakup")}
                >
                  <Flame className="h-3 w-3 text-rose-400 mr-1" />
                  Breakup Sim
                </Button>
              </>
            ) : (
              <Button
                size="xs"
                variant="outline"
                className="col-span-2 w-full text-[10px] font-mono border-space-border hover:border-cyan/40"
                onClick={() => onNavigateTab("simulation", frag!.id, "remediation")}
              >
                <Crosshair className="h-3 w-3 text-cyan mr-1" />
                Target in CW Remediation
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Provenance note */}
      <div className="pt-2 border-t border-space-border/60 text-[9px] text-slate-500 leading-tight">
        <span className="text-slate-400 font-bold">Provenance:</span>{" "}
        {isSatellite ? sat!.provenance : frag!.provenance}
      </div>
    </div>
  );
};

