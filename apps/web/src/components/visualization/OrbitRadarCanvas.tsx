"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { EarthMesh } from "./EarthMesh";
import { AtmosphereShell } from "./AtmosphereShell";
import { OrbitPath } from "./OrbitPath";
import { SatelliteMarker } from "./SatelliteMarker";
import { FragmentCloud } from "./FragmentCloud";
import { CameraController } from "./CameraController";
import { SceneControls } from "./SceneControls";
import { TimeScrubber } from "./TimeScrubber";
import { ObjectInspector } from "./ObjectInspector";
import {
  CATALOG_SATELLITES,
  SYNTHETIC_DEBRIS_CLOUD,
} from "../../lib/orbitFixtures";
import {
  VisualSatellite,
  VisualFragment,
  SceneVisibilityState,
  SelectedObjectInfo,
  ObjectFilterMode,
  AltitudeRegime,
} from "../../types/visualization";
import {
  DEFAULT_ALTITUDE_REGIMES,
  filterObjectsByRegimeAndType,
} from "../../lib/altitudeRegimes";
import { useZorbitStore } from "../../store/useZorbitStore";
import {
  interpolateGcrsPosition,
  gcrsToThreePosition,
} from "../../lib/coordinates";
import { Badge } from "../ui/Badge";
import { Radio, ShieldAlert } from "lucide-react";

export interface OrbitRadarCanvasProps {
  selectedObjectId?: string | null;
  onSelectObject?: (objectId: string | null) => void;
  onNavigateTab?: (
    tab: "overview" | "radar" | "conjunctions" | "simulation" | "system",
    objectId?: string | null,
    subtab?: string | null
  ) => void;
}

export const OrbitRadarCanvas: React.FC<OrbitRadarCanvasProps> = ({
  selectedObjectId,
  onSelectObject,
  onNavigateTab,
}) => {
  // WebGL support detection
  const [hasWebGL, setHasWebGL] = useState<boolean | null>(null);

  // Scene visibility state
  const [visibility, setVisibility] = useState<SceneVisibilityState>({
    earth: true,
    atmosphere: true,
    atmosphericInterface: true,
    latLongGrid: true,
    orbits: true,
    catalogObjects: true,
    debrisCloud: true,
  });

  // Object filter mode: all | satellites | debris | selected
  const [filterMode, setFilterMode] = useState<ObjectFilterMode>("all");

  // Synchronized Global Simulation Clock (authoritative store state)
  const currentEpochMs = useZorbitStore((s) => s.currentEpochMs);
  const startEpochMs = useZorbitStore((s) => s.startEpochMs);
  const endEpochMs = useZorbitStore((s) => s.endEpochMs);
  const isPlaying = useZorbitStore((s) => s.isPlaying);
  const playbackSpeed = useZorbitStore((s) => s.playbackSpeed);
  const isOutOfBounds = useZorbitStore((s) => s.isOutOfBounds);

  const setSimulationEpochMs = useZorbitStore((s) => s.setSimulationEpochMs);
  const setSimulationIsPlaying = useZorbitStore((s) => s.setSimulationIsPlaying);
  const setSimulationPlaybackSpeed = useZorbitStore((s) => s.setSimulationPlaybackSpeed);
  const resetSimulationClock = useZorbitStore((s) => s.resetSimulationClock);

  // Altitude Regime Filter State (LEO, MEO, GEO)
  const [activeRegimes, setActiveRegimes] = useState<Record<AltitudeRegime, boolean>>(
    DEFAULT_ALTITUDE_REGIMES
  );

  const handleToggleRegime = useCallback((regime: AltitudeRegime) => {
    setActiveRegimes((prev) => ({ ...prev, [regime]: !prev[regime] }));
  }, []);

  const handleResetRegimes = useCallback(() => {
    setActiveRegimes(DEFAULT_ALTITUDE_REGIMES);
    setFilterMode("all");
  }, []);

  // Selection & Camera Focus State
  const [selectedObject, setSelectedObject] = useState<SelectedObjectInfo>({
    type: "satellite",
    satellite: CATALOG_SATELLITES[0], // Default select ISS (ZARYA) matching KESSLER-OS spec
  });
  const [cameraFocusTarget, setCameraFocusTarget] = useState<[number, number, number] | null>(null);
  const [resetCameraTrigger, setResetCameraTrigger] = useState<number>(0);

  // Check WebGL availability once mounted in browser
  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      setHasWebGL(Boolean(gl));
    } catch {
      setHasWebGL(false);
    }
  }, []);

  // Compute interpolated satellite positions for the active epoch
  const interpolatedSatellites = useMemo(() => {
    return CATALOG_SATELLITES.map((sat) => {
      if (!sat.trajectory || sat.trajectory.samples.length < 2) {
        return { ...sat, currentPositionKm: sat.currentPositionKm };
      }

      const samples = sat.trajectory.samples;
      const targetTimeSec = currentEpochMs / 1000;

      // Find bounding interval
      let p1 = samples[0];
      let p2 = samples[samples.length - 1];

      for (let i = 0; i < samples.length - 1; i++) {
        if (
          targetTimeSec >= samples[i].epochSeconds &&
          targetTimeSec <= samples[i + 1].epochSeconds
        ) {
          p1 = samples[i];
          p2 = samples[i + 1];
          break;
        }
      }

      const interp = interpolateGcrsPosition(
        p1.epochSeconds * 1000,
        p1.positionGcrsKm,
        p2.epochSeconds * 1000,
        p2.positionGcrsKm,
        currentEpochMs
      );

      return {
        ...sat,
        currentPositionKm: interp || p1.positionGcrsKm,
        currentVelocityKms: p1.velocityGcrsKms || sat.currentVelocityKms,
      };
    });
  }, [currentEpochMs]);

  // React to incoming selectedObjectId prop (from cross-module navigation or URL params)
  useEffect(() => {
    if (!selectedObjectId) return;

    // Check catalog satellites by NORAD ID or string ID
    const sat = CATALOG_SATELLITES.find(
      (s) => s.id === selectedObjectId || s.noradCatId === selectedObjectId
    );
    if (sat) {
      setSelectedObject({ type: "satellite", satellite: sat });
      return;
    }

    // Check synthetic debris fragments by ID
    const frag = SYNTHETIC_DEBRIS_CLOUD.find((d) => d.id === selectedObjectId);
    if (frag) {
      setSelectedObject({ type: "fragment", fragment: frag });
      return;
    }
  }, [selectedObjectId]);

  // Handle object selection
  const handleSelectSatellite = useCallback(
    (satellite: VisualSatellite) => {
      setSelectedObject({ type: "satellite", satellite });
      onSelectObject?.(satellite.noradCatId);
    },
    [onSelectObject]
  );

  const handleSelectFragment = useCallback(
    (fragment: VisualFragment) => {
      setSelectedObject({ type: "fragment", fragment });
      onSelectObject?.(fragment.id);
    },
    [onSelectObject]
  );

  const handleCloseInspector = useCallback(() => {
    setSelectedObject(null);
    onSelectObject?.(null);
    setCameraFocusTarget(null);
  }, [onSelectObject]);

  const handleResetCamera = useCallback(() => {
    setResetCameraTrigger((prev) => prev + 1);
    setCameraFocusTarget(null);
  }, []);

  const handleToggleVisibility = useCallback((key: keyof SceneVisibilityState) => {
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Active selected object ID (from props or local selection)
  const activeSelectedId =
    selectedObjectId ||
    (selectedObject?.type === "satellite"
      ? selectedObject.satellite.noradCatId || selectedObject.satellite.id
      : selectedObject?.type === "fragment"
      ? selectedObject.fragment.id
      : null);

  // Filtered objects based on both object-type filterMode and altitude regimes
  const {
    visibleSatellites,
    visibleFragments,
    counts,
    isSelectedHidden,
  } = useMemo(() => {
    return filterObjectsByRegimeAndType(
      interpolatedSatellites,
      SYNTHETIC_DEBRIS_CLOUD,
      activeRegimes,
      filterMode,
      activeSelectedId
    );
  }, [interpolatedSatellites, activeRegimes, filterMode, activeSelectedId]);

  // Filter-applied visibility flags
  const showCatalogSatellites = visibility.catalogObjects && visibleSatellites.length > 0;
  const showDebrisCloud = visibility.debrisCloud && visibleFragments.length > 0;
  const showOrbitPaths = visibility.orbits && visibleSatellites.length > 0;

  // WebGL Fallback View if client device cannot initialize WebGL
  if (hasWebGL === false) {
    return (
      <div className="flex flex-col items-center justify-center p-12 rounded-xl border border-space-border bg-space-surface/60 text-center font-mono">
        <ShieldAlert className="h-10 w-10 text-status-warning mb-3" />
        <h3 className="text-sm font-bold uppercase text-slate-100 tracking-wider">
          WebGL Hardware Acceleration Unavailable
        </h3>
        <p className="mt-2 text-xs text-slate-400 max-w-md">
          The 3D orbital canvas requires WebGL support. Please verify that hardware
          acceleration is enabled in your browser settings.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[440px] xl:h-[450px] 2xl:h-[720px] rounded-2xl border border-space-border bg-space-bg overflow-hidden shadow-2xl select-none">
      {/* Top Telemetry Header Bar (Displayed on ultra-wide / 2xl viewports where space between HUD panels permits) */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 hidden 2xl:flex items-center gap-3 pointer-events-none">
        <div className="flex items-center space-x-3 pointer-events-auto bg-space-bg/90 backdrop-blur-md px-4 py-1.5 rounded-lg border border-space-border/80 text-xs font-mono shadow-lg whitespace-nowrap">
          <div className="flex items-center space-x-1.5 text-cyan font-bold">
            <Radio className="h-3.5 w-3.5 animate-pulse text-cyan" />
            <span>3D INERTIAL RADAR</span>
          </div>
          <span className="text-slate-600">•</span>
          <div className="text-[11px] text-slate-300">
            FRAME: <span className="text-cyan font-bold">GCRS</span> (1 unit = 1000 km)
          </div>
          <span className="hidden xl:inline text-slate-600">•</span>
          <div className="hidden xl:inline text-[11px] text-slate-300">
            RE-ENTRY: <span className="text-status-warning font-bold">6,478.1 km</span>
          </div>
        </div>
      </div>

      {/* 3D WebGL Canvas Viewport */}
      <Canvas
        camera={{ position: [18, 8, 20], fov: 45, near: 0.1, far: 500 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      >
        {/* Aerospace Lighting Model */}
        <ambientLight intensity={0.5} />
        <directionalLight position={[25, 15, 20]} intensity={1.8} />
        <pointLight position={[-20, -10, -25]} intensity={0.3} color="#06b6d4" />

        {/* Smooth Orbit Camera Controls */}
        <CameraController
          targetPosition={cameraFocusTarget}
          resetTrigger={resetCameraTrigger}
          defaultPosition={[18, 8, 20]}
          defaultTarget={[0, -0.7, 0]}
        />

        {/* 1. Earth Body Mesh (Procedural Surface & Lat/Long Grid) */}
        {visibility.earth && (
          <EarthMesh
            showLatLongGrid={visibility.latLongGrid}
            playbackSpeed={playbackSpeed}
            isPlaying={isPlaying}
          />
        )}

        {/* 2. Atmospheric Optical Glow & 6478.137 km Re-entry Interface Shell */}
        <AtmosphereShell
          showAtmosphereGlow={visibility.atmosphere}
          showAtmosphereInterface={visibility.atmosphericInterface}
        />

        {/* 3. Orbital Trajectories (GCRS Line Paths) */}
        {showOrbitPaths &&
          visibleSatellites.map((sat) =>
            sat.trajectory ? (
              <OrbitPath
                key={sat.trajectory.id}
                trajectory={sat.trajectory}
                isSelected={selectedObject?.type === "satellite" && selectedObject.satellite.id === sat.id}
                visible={showOrbitPaths}
              />
            ) : null
          )}

        {/* 4. Catalog Satellites (ISS & Tianhe) */}
        {showCatalogSatellites &&
          visibleSatellites.map((sat, idx) => {
            const isSelected = selectedObject?.type === "satellite" && selectedObject.satellite.id === sat.id;

            // Collision-aware label offset: stagger proximity conflicts so labels never overlap
            let labelOffset: [number, number, number] = [0, 0.45, 0];
            const otherSat = visibleSatellites.find((s) => s.id !== sat.id);
            if (otherSat) {
              const dx = sat.currentPositionKm[0] - otherSat.currentPositionKm[0];
              const dy = sat.currentPositionKm[1] - otherSat.currentPositionKm[1];
              const dz = sat.currentPositionKm[2] - otherSat.currentPositionKm[2];
              const distKm = Math.hypot(dx, dy, dz);
              if (distKm < 1500) {
                // When in proximity (< 1500 km), stagger: ISS moves up-left, CSS moves down-right
                labelOffset = idx === 0 ? [-0.4, 0.65, 0] : [0.55, -0.45, 0];
              }
            }

            return (
              <SatelliteMarker
                key={sat.id}
                satellite={sat}
                positionKm={sat.currentPositionKm}
                isSelected={isSelected}
                onSelect={handleSelectSatellite}
                visible={showCatalogSatellites}
                labelOffset={labelOffset}
              />
            );
          })}

        {/* 5. Synthetic Debris Cloud (InstancedMesh: filtered fragments) */}
        <FragmentCloud
          fragments={visibleFragments}
          selectedFragmentId={selectedObject?.type === "fragment" ? selectedObject.fragment.id : null}
          onSelectFragment={handleSelectFragment}
          visible={showDebrisCloud}
        />
      </Canvas>

      {/* Out of bounds simulation horizon guardrail banner */}
      {isOutOfBounds && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-lg bg-rose-950/90 border border-rose-500/60 text-rose-200 text-xs font-mono shadow-2xl flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0" />
          <span>SIMULATION TIME OUTSIDE SUPPORTED TRAJECTORY HORIZON — NO EXTRAPOLATION</span>
        </div>
      )}

      {/* Bottom Scene Legend (Matches Screen 2 Reference) */}
      <div className="absolute bottom-16 2xl:bottom-20 left-1/2 -translate-x-1/2 z-10 hidden sm:flex items-center space-x-6 px-4 py-1.5 rounded-full bg-space-bg/85 backdrop-blur-md border border-space-border text-[11px] font-mono text-slate-300">
        <span className="flex items-center space-x-1.5">
          <span className="h-2 w-2 rounded-full bg-cyan shadow-[0_0_6px_#06b6d4]" />
          <span>Active Satellite ({counts.visible > 0 ? visibleSatellites.length : 0})</span>
        </span>
        <span className="flex items-center space-x-1.5">
          <span className="h-2 w-2 rounded-full bg-status-warning shadow-[0_0_6px_#f59e0b]" />
          <span>Debris ({counts.visible > 0 ? visibleFragments.length : 0})</span>
        </span>
        <span className="flex items-center space-x-1.5">
          <span className="h-2 w-2 rounded-full bg-status-critical shadow-[0_0_6px_#ef4444]" />
          <span>Selected Object</span>
        </span>
      </div>

      {/* Floating Left HUD: Scene Layer Visibility & Filtering Controls */}
      <SceneControls
        visibility={visibility}
        onToggleVisibility={handleToggleVisibility}
        onResetCamera={handleResetCamera}
        debrisCount={visibleFragments.length}
        catalogCount={visibleSatellites.length}
        filterMode={filterMode}
        onSetFilterMode={setFilterMode}
        activeRegimes={activeRegimes}
        onToggleRegime={handleToggleRegime}
        onResetRegimes={handleResetRegimes}
        regimeCounts={{
          leo: counts.leoCount,
          meo: counts.meoCount,
          geo: counts.geoCount,
          totalVisible: counts.visible,
        }}
      />

      {/* Floating Right HUD: Selected Object Telemetry Inspector */}
      <ObjectInspector
        selectedObject={selectedObject}
        onClose={handleCloseInspector}
        onNavigateTab={onNavigateTab}
        isHiddenByFilter={isSelectedHidden}
        onRevealObject={handleResetRegimes}
        onFocusCamera={() => {
          if (selectedObject) {
            const pos =
              selectedObject.type === "satellite"
                ? selectedObject.satellite.currentPositionKm
                : selectedObject.fragment.positionGcrsKm;
            const [X, Y, Z] = gcrsToThreePosition(pos[0], pos[1], pos[2], "GCRS");
            setCameraFocusTarget([X, Y, Z]);
          }
        }}
      />

      {/* Floating Bottom HUD: Time Scrubber & Playback Controls */}
      <TimeScrubber
        currentEpochMs={currentEpochMs}
        startEpochMs={startEpochMs}
        endEpochMs={endEpochMs}
        isPlaying={isPlaying}
        playbackSpeed={playbackSpeed}
        isOutOfBounds={isOutOfBounds}
        onTogglePlay={() => setSimulationIsPlaying(!isPlaying)}
        onSetSpeed={(s) => setSimulationPlaybackSpeed(s)}
        onSeek={(ms) => setSimulationEpochMs(ms)}
        onReset={() => resetSimulationClock()}
      />
    </div>
  );
};
