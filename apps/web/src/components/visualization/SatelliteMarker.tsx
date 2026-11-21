"use client";

import React, { useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { VisualSatellite } from "../../types/visualization";
import { gcrsToThreePosition, calculateAltitudeKm } from "../../lib/coordinates";

interface SatelliteMarkerProps {
  satellite: VisualSatellite;
  positionKm: [number, number, number];
  isSelected?: boolean;
  onSelect?: (satellite: VisualSatellite) => void;
  visible?: boolean;
  labelOffset?: [number, number, number];
}

export const SatelliteMarker: React.FC<SatelliteMarkerProps> = ({
  satellite,
  positionKm,
  isSelected = false,
  onSelect,
  visible = true,
  labelOffset,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const [isHovered, setIsHovered] = useState(false);

  // Convert GCRS position to Three.js coordinates
  const [xThree, yThree, zThree] = gcrsToThreePosition(
    positionKm[0],
    positionKm[1],
    positionKm[2],
    satellite.frame
  );

  const altitudeKm = Math.round(calculateAltitudeKm(positionKm[0], positionKm[1], positionKm[2]));

  // Pulse animation on selection ring
  useFrame((state) => {
    if (ringRef.current && isSelected) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 4) * 0.2;
      ringRef.current.scale.set(scale, scale, scale);
    }
  });

  if (!visible) return null;

  const baseColor = isSelected ? "#38bdf8" : isHovered ? "#67e8f9" : "#06b6d4";

  return (
    <group position={[xThree, yThree, zThree]}>
      {/* Interactive Core Mesh */}
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(satellite);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setIsHovered(true);
        }}
        onPointerOut={() => {
          setIsHovered(false);
        }}
      >
        <octahedronGeometry args={[0.2, 0]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={new THREE.Color(baseColor)}
          emissiveIntensity={isSelected ? 1.0 : 0.7}
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>

      {/* Selected Indicator Ring */}
      {isSelected && (
        <mesh ref={ringRef}>
          <ringGeometry args={[0.32, 0.4, 32]} />
          <meshBasicMaterial
            color="#38bdf8"
            side={THREE.DoubleSide}
            transparent
            opacity={0.8}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Billboard Overlay Tag */}
      <Html
        position={labelOffset || [0, 0.45, 0]}
        center
        distanceFactor={22}
        className="pointer-events-none select-none z-10"
      >
        <div className="flex flex-col items-center whitespace-nowrap">
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded backdrop-blur-md shadow-xl transition-all ${
              isSelected
                ? "bg-cyan/25 border border-cyan text-cyan font-bold shadow-[0_0_12px_rgba(6,182,212,0.4)] ring-1 ring-cyan/50"
                : isHovered
                ? "bg-space-surface/95 border border-cyan/60 text-cyan font-semibold"
                : "bg-space-surface/90 border border-space-border/80 text-slate-200"
            }`}
          >
            <span className="text-[10px] font-mono font-bold tracking-tight">
              {satellite.name}
            </span>
            <span className="text-[9px] font-mono text-slate-400">
              ({altitudeKm} km)
            </span>
          </div>
        </div>
      </Html>
    </group>
  );
};

