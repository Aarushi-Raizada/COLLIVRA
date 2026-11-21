"use client";

import React, { useMemo, useEffect } from "react";
import * as THREE from "three";
import { VisualTrajectory } from "../../types/visualization";
import { gcrsToThreePosition } from "../../lib/coordinates";

interface OrbitPathProps {
  trajectory: VisualTrajectory;
  isSelected?: boolean;
  visible?: boolean;
}

export const OrbitPath: React.FC<OrbitPathProps> = ({
  trajectory,
  isSelected = false,
  visible = true,
}) => {
  const lineGeometry = useMemo(() => {
    if (!trajectory.samples || trajectory.samples.length === 0) {
      return new THREE.BufferGeometry();
    }

    const points: THREE.Vector3[] = trajectory.samples.map((sample) => {
      const [x, y, z] = sample.positionGcrsKm;
      const [X, Y, Z] = gcrsToThreePosition(x, y, z, trajectory.frame);
      return new THREE.Vector3(X, Y, Z);
    });

    return new THREE.BufferGeometry().setFromPoints(points);
  }, [trajectory]);

  useEffect(() => {
    return () => {
      lineGeometry.dispose();
    };
  }, [lineGeometry]);

  if (!visible || !trajectory.samples || trajectory.samples.length === 0) {
    return null;
  }

  const lineColor = isSelected ? "#38bdf8" : trajectory.color || "#06b6d4";
  const opacity = isSelected ? 0.95 : 0.55;

  return (
    <group>
      {/* Primary Orbit Line */}
      <lineLoop geometry={lineGeometry}>
        <lineBasicMaterial
          color={lineColor}
          transparent
          opacity={opacity}
          depthWrite={false}
        />
      </lineLoop>

      {/* Outer Glow Pass when Selected */}
      {isSelected && (
        <lineLoop geometry={lineGeometry}>
          <lineBasicMaterial
            color="#06b6d4"
            transparent
            opacity={0.3}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineLoop>
      )}
    </group>
  );
};

