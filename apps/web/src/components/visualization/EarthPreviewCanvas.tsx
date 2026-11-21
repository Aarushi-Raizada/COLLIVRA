"use client";

import React, { useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { EarthMesh } from "./EarthMesh";
import { AtmosphereShell } from "./AtmosphereShell";
import { OrbitPath } from "./OrbitPath";
import { SatelliteMarker } from "./SatelliteMarker";
import { FragmentCloud } from "./FragmentCloud";
import { CameraController } from "./CameraController";
import {
  ISS_TRAJECTORY,
  CSS_TRAJECTORY,
  ISS_SATELLITE,
  CSS_SATELLITE,
  SYNTHETIC_DEBRIS_CLOUD,
} from "../../lib/orbitFixtures";
import { RotateCcw, Eye, Layers } from "lucide-react";
import { Badge } from "../ui/Badge";

interface EarthPreviewCanvasProps {
  isDemoMode?: boolean;
  className?: string;
}

export const EarthPreviewCanvas: React.FC<EarthPreviewCanvasProps> = ({
  isDemoMode = true,
  className = "w-full h-[360px]",
}) => {
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>("25544");
  const [showDebris, setShowDebris] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [resetCameraTrigger, setResetCameraTrigger] = useState<number>(0);

  const handleResetCamera = useCallback(() => {
    setResetCameraTrigger((prev) => prev + 1);
  }, []);

  return (
    <div className={`relative rounded-xl overflow-hidden bg-space-bg border border-space-border/80 ${className}`}>
      {/* 3D WebGL Canvas */}
      <Canvas
        camera={{ position: [12, 8.5, 13.5], fov: 45, near: 0.1, far: 500 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      >
        {/* Aerospace Lighting Model */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[25, 15, 20]} intensity={1.8} />
        <pointLight position={[-20, -10, -25]} intensity={0.3} color="#06b6d4" />

        {/* Inertial Earth Mesh with photorealistic textures */}
        <EarthMesh showLatLongGrid={showGrid} playbackSpeed={1} />

        {/* Photorealistic Atmospheric Limb Glow */}
        <AtmosphereShell showAtmosphereGlow={true} showAtmosphereInterface={false} />

        {/* Orbit Tracks */}
        <OrbitPath
          trajectory={ISS_TRAJECTORY}
          isSelected={selectedObjectId === "25544"}
        />
        <OrbitPath
          trajectory={CSS_TRAJECTORY}
          isSelected={selectedObjectId === "48274"}
        />

        {/* Satellite Position Markers */}
        <SatelliteMarker
          satellite={ISS_SATELLITE}
          positionKm={ISS_SATELLITE.currentPositionKm}
          isSelected={selectedObjectId === "25544"}
          onSelect={(sat) => setSelectedObjectId(sat.id)}
          labelOffset={[-0.4, 0.65, 0]}
        />
        <SatelliteMarker
          satellite={CSS_SATELLITE}
          positionKm={CSS_SATELLITE.currentPositionKm}
          isSelected={selectedObjectId === "48274"}
          onSelect={(sat) => setSelectedObjectId(sat.id)}
          labelOffset={[0.55, -0.45, 0]}
        />

        {/* 520 Synthetic Debris Fragments */}
        <FragmentCloud
          fragments={SYNTHETIC_DEBRIS_CLOUD}
          visible={showDebris}
          onSelectFragment={(frag) => setSelectedObjectId(frag.id)}
        />

        {/* Smooth Orbit Camera Controller */}
        <CameraController
          resetTrigger={resetCameraTrigger}
          defaultPosition={[12, 8.5, 13.5]}
          defaultTarget={[0, 0, 0]}
        />
      </Canvas>

      {/* Viewport Top Left: Telemetry & Orientation HUD */}
      <div className="absolute top-3 left-3 flex flex-col gap-1.5 pointer-events-none select-none z-10">
        <div className="flex items-center gap-2">
          <Badge variant="cyan" size="sm" pulseDot>
            GCRS INERTIAL
          </Badge>
          <span className="text-[10px] font-mono text-slate-400 bg-space-surface/80 px-2 py-0.5 rounded border border-space-border/50">
            1 unit = 1000 km
          </span>
        </div>
        <div className="text-[10px] font-mono text-slate-400">
          Earth Axis: Three.js +Y (GCRS +Z)
        </div>
      </div>

      {/* Viewport Top Right: Data Provenance Pill */}
      <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
        <Badge
          variant={isDemoMode ? "warning" : "success"}
          size="sm"
        >
          {isDemoMode ? "SYNTHETIC DEMO DATA" : "LIVE BACKEND DATA"}
        </Badge>
      </div>

      {/* Viewport Bottom Left: Frame Convention Legend */}
      <div className="absolute bottom-3 left-3 text-[10px] font-mono text-slate-400 bg-space-surface/80 px-2.5 py-1 rounded border border-space-border/50 pointer-events-none select-none z-10">
        <span>X=Vernal Eq. • Y=GCRS +Z (Polar) • Z=-Y</span>
      </div>

      {/* Viewport Bottom Right: Interactive View Controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-2 z-10">
        <button
          type="button"
          onClick={() => setShowDebris(!showDebris)}
          title="Toggle synthetic debris markers"
          className={`p-1.5 rounded border text-[11px] font-mono flex items-center gap-1 transition-colors ${
            showDebris
              ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
              : "bg-space-surface/80 text-slate-400 border-space-border hover:text-slate-200"
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>520 FRAGMENTS</span>
        </button>

        <button
          type="button"
          onClick={() => setShowGrid(!showGrid)}
          title="Toggle lat/long coordinate grid"
          className={`p-1.5 rounded border text-[11px] font-mono flex items-center gap-1 transition-colors ${
            showGrid
              ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
              : "bg-space-surface/80 text-slate-400 border-space-border hover:text-slate-200"
          }`}
        >
          <Eye className="h-3.5 w-3.5" />
          <span>GRID</span>
        </button>

        <button
          type="button"
          onClick={handleResetCamera}
          title="Reset camera viewpoint"
          className="p-1.5 rounded border border-space-border bg-space-surface/80 text-slate-300 hover:text-white hover:border-cyan/50 text-[11px] font-mono flex items-center gap-1 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>RESET</span>
        </button>
      </div>
    </div>
  );
};

