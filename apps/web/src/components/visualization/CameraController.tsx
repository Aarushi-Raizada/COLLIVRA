"use client";

import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls as DreiOrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

interface CameraControllerProps {
  targetPosition?: [number, number, number] | null;
  resetTrigger?: number;
  defaultPosition?: [number, number, number];
  defaultTarget?: [number, number, number];
  minDistance?: number;
  maxDistance?: number;
}

export const CameraController: React.FC<CameraControllerProps> = ({
  targetPosition,
  resetTrigger = 0,
  defaultPosition = [18, 8, 20],
  defaultTarget = [0, -0.7, 0],
  minDistance = 7.2,
  maxDistance = 60.0,
}) => {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();

  const [defX, defY, defZ] = defaultPosition;
  const [tgtX, tgtY, tgtZ] = defaultTarget;

  const desiredTargetRef = useRef<THREE.Vector3>(new THREE.Vector3(tgtX, tgtY, tgtZ));
  const isTransitioningRef = useRef(false);

  // Default camera perspective setup on mount
  useEffect(() => {
    camera.position.set(defX, defY, defZ);
    camera.lookAt(tgtX, tgtY, tgtZ);
    if (controlsRef.current) {
      controlsRef.current.target.set(tgtX, tgtY, tgtZ);
      controlsRef.current.update();
    }
  }, [camera, defX, defY, defZ, tgtX, tgtY, tgtZ]);

  // Handle camera reset
  useEffect(() => {
    if (resetTrigger > 0 && controlsRef.current) {
      desiredTargetRef.current.set(tgtX, tgtY, tgtZ);
      camera.position.set(defX, defY, defZ);
      controlsRef.current.target.set(tgtX, tgtY, tgtZ);
      controlsRef.current.update();
    }
  }, [resetTrigger, camera, defX, defY, defZ, tgtX, tgtY, tgtZ]);

  // Handle target focus change
  const targetX = targetPosition ? targetPosition[0] : null;
  const targetY = targetPosition ? targetPosition[1] : null;
  const targetZ = targetPosition ? targetPosition[2] : null;

  useEffect(() => {
    if (targetX !== null && targetY !== null && targetZ !== null) {
      desiredTargetRef.current.set(targetX, targetY, targetZ);
      isTransitioningRef.current = true;
    } else {
      desiredTargetRef.current.set(tgtX, tgtY, tgtZ);
      isTransitioningRef.current = true;
    }
  }, [targetX, targetY, targetZ, tgtX, tgtY, tgtZ]);

  // Smooth lerp to target
  useFrame(() => {
    if (controlsRef.current && isTransitioningRef.current) {
      controlsRef.current.target.lerp(desiredTargetRef.current, 0.08);
      controlsRef.current.update();

      if (controlsRef.current.target.distanceTo(desiredTargetRef.current) < 0.01) {
        controlsRef.current.target.copy(desiredTargetRef.current);
        isTransitioningRef.current = false;
      }
    }
  });

  return (
    <DreiOrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.05}
      minDistance={minDistance} // Prevents clipping through Earth radius (~6.378)
      maxDistance={maxDistance}
      rotateSpeed={0.8}
      zoomSpeed={1.0}
      panSpeed={0.8}
    />
  );
};

