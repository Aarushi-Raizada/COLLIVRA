"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls as DreiOrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ConjunctionEvent } from "@/types/api";
import {
  ENCOUNTER_SCALE_KM_PER_UNIT,
  RADAR_SCALE_KM_PER_UNIT,
  isValidEncounterEvent,
  calculateMissDistanceEndpoints,
  calculateRelativeVelocityGeometry,
  calculateSeverityShells,
} from "@/lib/encounter_geometry";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Compass,
  RotateCcw,
  Layers,
  ShieldAlert,
  HelpCircle,
  Eye,
  Activity,
  Maximize2,
  Crosshair,
  Radio,
} from "lucide-react";

export interface EncounterGeometryCanvasProps {
  event: ConjunctionEvent | null;
  className?: string;
}

interface SceneObjectsProps {
  event: ConjunctionEvent;
  scaleKmPerUnit: number;
  showShells: boolean;
  scaleMode: "encounter" | "radar";
}

/**
 * R3F Scene inner component containing meshes, lines, arrows, coordinate axes, and polar range grids.
 */
const EncounterScene: React.FC<SceneObjectsProps> = ({
  event,
  scaleKmPerUnit,
  showShells,
  scaleMode,
}) => {
  const { origin, target, distanceUnits } = useMemo(
    () => calculateMissDistanceEndpoints(event, scaleKmPerUnit),
    [event, scaleKmPerUnit]
  );

  const { direction, arrowLengthUnits } = useMemo(
    () => calculateRelativeVelocityGeometry(event, scaleKmPerUnit),
    [event, scaleKmPerUnit]
  );

  const shells = useMemo(
    () => calculateSeverityShells(scaleKmPerUnit),
    [scaleKmPerUnit]
  );

  // Miss-distance line object
  const lineObject = useMemo(() => {
    const points = [
      new THREE.Vector3(origin[0], origin[1], origin[2]),
      new THREE.Vector3(target[0], target[1], target[2]),
    ];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineDashedMaterial({
      color: 0x06b6d4, // Cyan
      linewidth: 2,
      scale: 1,
      dashSize: scaleMode === "encounter" ? 0.3 : 0.0003,
      gapSize: scaleMode === "encounter" ? 0.15 : 0.00015,
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    return line;
  }, [origin, target, scaleMode]);

  useEffect(() => {
    return () => {
      lineObject.geometry.dispose();
      if (Array.isArray(lineObject.material)) {
        lineObject.material.forEach((m) => m.dispose());
      } else {
        lineObject.material.dispose();
      }
    };
  }, [lineObject]);

  // Relative velocity vector arrow originating at Object 2
  const velocityArrow = useMemo(() => {
    const dir = new THREE.Vector3(direction[0], direction[1], direction[2]).normalize();
    const orig = new THREE.Vector3(target[0], target[1], target[2]);
    const headLength = arrowLengthUnits * 0.28;
    const headWidth = arrowLengthUnits * 0.16;
    return new THREE.ArrowHelper(dir, orig, arrowLengthUnits, 0xf59e0b, headLength, headWidth);
  }, [direction, target, arrowLengthUnits]);

  useEffect(() => {
    return () => {
      velocityArrow.dispose();
    };
  }, [velocityArrow]);

  // GCRS Coordinate Axes at origin
  // Three.js X = GCRS X (Red: 0xef4444)
  // Three.js Y = GCRS Z (Green: 0x22c55e)
  // Three.js Z = -GCRS Y (Blue: 0x3b82f6)
  const axesGroup = useMemo(() => {
    const group = new THREE.Group();
    const orig = new THREE.Vector3(0, 0, 0);
    const axisLen = scaleMode === "encounter" ? 4.0 : 0.004;
    const headLen = axisLen * 0.15;
    const headWid = axisLen * 0.08;

    const xArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      orig,
      axisLen,
      0xef4444,
      headLen,
      headWid
    );
    const yArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      orig,
      axisLen,
      0x3b82f6,
      headLen,
      headWid
    );
    const zArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      orig,
      axisLen,
      0x22c55e,
      headLen,
      headWid
    );

    group.add(xArrow);
    group.add(yArrow);
    group.add(zArrow);

    return { group, xArrow, yArrow, zArrow };
  }, [scaleMode]);

  useEffect(() => {
    return () => {
      axesGroup.xArrow.dispose();
      axesGroup.yArrow.dispose();
      axesGroup.zArrow.dispose();
    };
  }, [axesGroup]);

  // Object sphere radius proportional to scale
  const objectRadius = scaleMode === "encounter" ? 0.24 : 0.00024;

  return (
    <>
      {/* 1. Object 1 (Encounter Origin [0, 0, 0] — Primary Reference Asset) */}
      <group position={[0, 0, 0]}>
        <mesh>
          <sphereGeometry args={[objectRadius, 32, 32]} />
          <meshStandardMaterial
            color="#06b6d4"
            emissive="#0891b2"
            emissiveIntensity={0.8}
            roughness={0.2}
          />
        </mesh>
        {/* Horizontal Equatorial Targeting Ring */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[objectRadius * 1.3, objectRadius * 1.5, 32]} />
          <meshBasicMaterial color="#06b6d4" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
        {/* Subtle ground plane grid at origin */}
        {scaleMode === "encounter" && (
          <gridHelper
            args={[20, 20, 0x0e7490, 0x1e293b]}
            position={[0, -objectRadius * 0.5, 0]}
          />
        )}
      </group>

      {/* 2. Object 2 (Placed at GCRS relative position r_rel — Approaching Target) */}
      <group position={[target[0], target[1], target[2]]}>
        <mesh>
          <sphereGeometry args={[objectRadius, 32, 32]} />
          <meshStandardMaterial
            color="#f43f5e"
            emissive="#e11d48"
            emissiveIntensity={0.8}
            roughness={0.2}
          />
        </mesh>
        {/* Pulsed Targeting Reticle Ring */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[objectRadius * 1.3, objectRadius * 1.6, 32]} />
          <meshBasicMaterial color="#f43f5e" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* 3. Miss-Distance Vector Line */}
      <primitive object={lineObject} />

      {/* 4. Relative Velocity Vector Arrow (starts at Object 2) */}
      <primitive object={velocityArrow} />

      {/* 5. GCRS Coordinate Axes (+X Red, +Y Blue, +Z Green) */}
      <primitive object={axesGroup.group} />

      {/* 6. Spherical Severity Shells (1 km, 5 km, 10 km) */}
      {showShells && scaleMode === "encounter" && (
        <group position={[0, 0, 0]}>
          {shells.map((shell) => (
            <mesh key={shell.tier}>
              <sphereGeometry args={[shell.displayRadius, 36, 18]} />
              <meshBasicMaterial
                color={shell.color}
                wireframe
                transparent
                opacity={shell.tier === "CRITICAL" ? 0.25 : shell.tier === "HIGH" ? 0.16 : 0.09}
              />
            </mesh>
          ))}
        </group>
      )}
    </>
  );
};

export const EncounterGeometryCanvas: React.FC<EncounterGeometryCanvasProps> = ({
  event,
  className = "",
}) => {
  const [hasWebGL, setHasWebGL] = useState<boolean | null>(null);
  const [showShells, setShowShells] = useState<boolean>(true);
  const [scaleMode, setScaleMode] = useState<"encounter" | "radar">("encounter");
  const controlsRef = useRef<OrbitControlsImpl>(null);

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

  const scaleKmPerUnit =
    scaleMode === "encounter" ? ENCOUNTER_SCALE_KM_PER_UNIT : RADAR_SCALE_KM_PER_UNIT;

  // Camera reset handler
  const handleResetCamera = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      if (scaleMode === "encounter") {
        controlsRef.current.object.position.set(8, 6, 12);
      } else {
        controlsRef.current.object.position.set(0.02, 0.015, 0.03);
      }
      controlsRef.current.update();
    }
  }, [scaleMode]);

  // Adjust camera position when scale mode changes
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      if (scaleMode === "encounter") {
        controlsRef.current.object.position.set(8, 6, 12);
      } else {
        controlsRef.current.object.position.set(0.02, 0.015, 0.03);
      }
      controlsRef.current.update();
    }
  }, [scaleMode]);

  // WebGL Fallback View
  if (hasWebGL === false) {
    return (
      <Card className={`border-space-border bg-space-surface/90 p-8 text-center font-mono ${className}`}>
        <div className="flex flex-col items-center justify-center gap-3">
          <ShieldAlert className="h-8 w-8 text-amber-400" />
          <h4 className="text-xs font-bold uppercase text-slate-200 tracking-wider">
            WebGL Acceleration Unavailable
          </h4>
          <p className="text-[11px] text-slate-400 max-w-md">
            The 3D encounter-centered geometry canvas requires WebGL hardware acceleration.
            Numerical kinematics and state vectors remain fully accessible in the inspector panels.
          </p>
        </div>
      </Card>
    );
  }

  // Unavailable Event State (null, missing vectors, or NaN/non-finite)
  if (!isValidEncounterEvent(event)) {
    return (
      <Card className={`border-space-border bg-space-surface/90 p-8 text-center font-mono ${className}`}>
        <div className="flex flex-col items-center justify-center gap-3">
          <Compass className="h-8 w-8 text-slate-500" />
          <h4 className="text-xs font-bold uppercase text-slate-200 tracking-wider">
            3D Encounter Geometry Standby
          </h4>
          <p className="text-[11px] text-slate-400 max-w-md">
            {!event
              ? "Select a close-approach event from the conjunction queue to inspect encounter-centered relative GCRS geometry."
              : "Selected event lacks valid, finite GCRS relative position or velocity state vectors."}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="cyan" size="sm">
              Frame: GCRS
            </Badge>
            <Badge variant="slate" size="sm">
              Status: Incomplete State
            </Badge>
          </div>
        </div>
      </Card>
    );
  }

  // Safe coordinates for display readouts
  const [rx, ry, rz] = event.relative_position_km;
  const [vx, vy, vz] = event.relative_velocity_kms || [NaN, NaN, NaN];

  return (
    <Card className={`border-space-border bg-space-bg overflow-hidden relative shadow-panel ${className}`}>
      {/* Top Overlay HUD Bar */}
      <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Left: Frame Badge & Encounter Identity */}
        <div className="pointer-events-auto flex items-center gap-2 bg-space-surface/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-space-border text-xs font-mono">
          <Badge variant="cyan" size="sm" className="font-bold">
            GCRS · RELATIVE ENCOUNTER
          </Badge>
          <span className="text-slate-600 hidden sm:inline">•</span>
          <span className="text-[11px] text-slate-300 hidden sm:inline">
            <span className="text-cyan font-semibold">
              {event.object_1_name || `Object ${event.object_1_id}`}
            </span>{" "}
            (Origin) vs{" "}
            <span className="text-rose-400 font-semibold">
              {event.object_2_name || `Object ${event.object_2_id}`}
            </span>
          </span>
        </div>

        {/* Right: Interactive Viewport Controls */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          {/* Shells Toggle */}
          <Button
            variant="secondary"
            size="xs"
            onClick={() => setShowShells(!showShells)}
            className="font-mono text-xs bg-space-surface/90 border-space-border text-slate-300"
            title="Toggle 1 km, 5 km, 10 km severity shells"
          >
            <Layers className="h-3.5 w-3.5 mr-1 text-cyan" />
            Shells: {showShells ? "ON" : "OFF"}
          </Button>

          {/* Scale Mode Toggle */}
          <Button
            variant="secondary"
            size="xs"
            onClick={() => setScaleMode(scaleMode === "encounter" ? "radar" : "encounter")}
            className="font-mono text-xs bg-space-surface/90 border-space-border text-slate-300"
            title="Toggle between Encounter Scale (1:1 km) and Radar Scale (1:1000 km)"
          >
            <Maximize2 className="h-3.5 w-3.5 mr-1 text-amber-400" />
            {scaleMode === "encounter" ? "Scale: 1:1 km" : "Scale: 1:1000 km"}
          </Button>

          {/* Camera Reset */}
          <Button
            variant="secondary"
            size="xs"
            onClick={handleResetCamera}
            className="font-mono text-xs bg-space-surface/90 border-space-border text-slate-300"
            title="Reset camera orientation"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1 text-slate-400" />
            Reset
          </Button>
        </div>
      </div>

      {/* 3D WebGL Canvas */}
      <div className="w-full h-[340px] sm:h-[400px] 2xl:h-[440px]">
        <Canvas
          camera={{
            position: scaleMode === "encounter" ? [8, 6, 12] : [0.02, 0.015, 0.03],
            fov: 45,
            near: scaleMode === "encounter" ? 0.1 : 0.0001,
            far: scaleMode === "encounter" ? 250 : 2.5,
          }}
          gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
          className="w-full h-full bg-space-bg cursor-grab active:cursor-grabbing"
        >
          <color attach="background" args={["#050B16"]} />
          <ambientLight intensity={0.9} color="#0B1424" />
          <directionalLight position={[15, 20, 25]} intensity={2.0} color="#ffffff" />
          <pointLight position={[-15, -10, -15]} intensity={0.5} color="#06b6d4" />

          {/* Orbit Controls */}
          <DreiOrbitControls
            ref={controlsRef}
            enableDamping
            dampingFactor={0.06}
            minDistance={scaleMode === "encounter" ? 0.5 : 0.0005}
            maxDistance={scaleMode === "encounter" ? 80.0 : 0.08}
            rotateSpeed={0.8}
            zoomSpeed={1.0}
            panSpeed={0.8}
          />

          {/* Encounter 3D Scene Objects */}
          <EncounterScene
            event={event}
            scaleKmPerUnit={scaleKmPerUnit}
            showShells={showShells}
            scaleMode={scaleMode}
          />
        </Canvas>
      </div>

      {/* Bottom Floating Telemetry & Coordinate Reference Overlay */}
      <div className="absolute bottom-10 left-3 right-3 z-10 flex flex-col md:flex-row items-end md:items-center justify-between gap-2 pointer-events-none text-xs font-mono">
        {/* Left: GCRS Axis Reference Card */}
        <div className="pointer-events-auto bg-space-surface/90 backdrop-blur-md px-3 py-2 rounded-lg border border-space-border text-[11px] space-y-0.5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
              <span className="font-semibold text-slate-200">GCRS +X</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
              <span className="font-semibold text-slate-200">GCRS +Y</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
              <span className="font-semibold text-slate-200">GCRS +Z</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400">
            Right-Handed Display Mapping: X_Three = X_GCRS, Y_Three = Z_GCRS, Z_Three = -Y_GCRS
          </div>
        </div>

        {/* Right: Exact Backend Vector Readouts */}
        <div className="pointer-events-auto bg-space-surface/90 backdrop-blur-md px-3 py-2 rounded-lg border border-space-border text-[11px] text-right space-y-0.5">
          <div className="flex items-center justify-end gap-2">
            <span className="text-slate-400 text-[10px] uppercase">Miss Distance:</span>
            <span className="font-bold text-cyan">
              {event.miss_distance_km.toFixed(3)} km
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400 text-[10px] uppercase">Rel Speed:</span>
            <span className="font-bold text-slate-200">
              {event.relative_speed_kms.toFixed(3)} km/s
            </span>
          </div>
          <div className="text-[10px] text-slate-400">
            r_rel: [{rx.toFixed(2)}, {ry.toFixed(2)}, {rz.toFixed(2)}] km (GCRS)
          </div>
        </div>
      </div>

      {/* Bottom Scale Legend Banner & B-Plane Covariance Scientific Disclaimer */}
      <div className="px-3 py-2 bg-space-surface border-t border-space-border text-[11px] font-mono text-slate-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <HelpCircle className="h-3.5 w-3.5 text-cyan shrink-0" />
          <span>
            <strong className="text-slate-100">SCALE:</strong>{" "}
            {scaleMode === "encounter"
              ? "1 Unit = 1.0 km (Encounter Scale)"
              : "1 Unit = 1000.0 km (Global Radar Scale)"}
          </span>
          <span className="text-slate-600 hidden sm:inline">•</span>
          <span className="text-amber-400/90 text-[10px]">
            B-Plane Covariance Ellipse: Unavailable (Requires calibrated covariance matrices not in TLE/OMM)
          </span>
        </div>
        <div className="text-[10px] text-slate-400">
          Inertial GCRS Coordinates (Fixed to Epoch)
        </div>
      </div>
    </Card>
  );
};
