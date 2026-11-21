"use client";

import React, { useRef, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { VisualFragment } from "../../types/visualization";
import { gcrsToThreePosition } from "../../lib/coordinates";

interface FragmentCloudProps {
  fragments: VisualFragment[];
  selectedFragmentId?: string | null;
  onSelectFragment?: (fragment: VisualFragment) => void;
  visible?: boolean;
}

export const FragmentCloud: React.FC<FragmentCloudProps> = ({
  fragments,
  selectedFragmentId,
  onSelectFragment,
  visible = true,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = fragments.length;

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const normalColor = useMemo(() => new THREE.Color("#f59e0b"), []); // Amber
  const selectedColor = useMemo(() => new THREE.Color("#ef4444"), []); // Critical Red

  useLayoutEffect(() => {
    if (!meshRef.current) return;

    fragments.forEach((frag, index) => {
      const [X, Y, Z] = gcrsToThreePosition(
        frag.positionGcrsKm[0],
        frag.positionGcrsKm[1],
        frag.positionGcrsKm[2],
        "GCRS"
      );

      dummy.position.set(X, Y, Z);
      const scale = Math.min(0.08, Math.max(0.035, 0.035 + (frag.massKg / 40) * 0.04));
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();

      meshRef.current!.setMatrixAt(index, dummy.matrix);

      const isSelected = selectedFragmentId === frag.id;
      meshRef.current!.setColorAt(index, isSelected ? selectedColor : normalColor);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  }, [fragments, selectedFragmentId, dummy, normalColor, selectedColor]);

  if (!visible || count === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      onClick={(e) => {
        e.stopPropagation();
        const instanceId = e.instanceId;
        if (instanceId !== undefined && instanceId < fragments.length) {
          onSelectFragment?.(fragments[instanceId]);
        }
      }}
    >
      <octahedronGeometry args={[0.2, 0]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
};

