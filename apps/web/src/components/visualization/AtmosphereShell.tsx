"use client";

import React, { useMemo, useEffect } from "react";
import * as THREE from "three";
import {
  EARTH_RADIUS_DISPLAY,
  ATMOSPHERE_INTERFACE_DISPLAY,
} from "../../lib/coordinates";

export interface AtmosphereShellProps {
  showAtmosphereGlow?: boolean;
  showAtmosphereInterface?: boolean;
  sunDirection?: [number, number, number];
}

/**
 * Photorealistic Atmospheric Scattering & Karman Interface Engine (Phase 3)
 *
 * Implements:
 * 1. Rayleigh & Mie scattering optical limb glow via a Fresnel rim shader.
 *    - Sun-aligned illumination: brighter on daytime limb, softer on nocturnal rim.
 *    - Delicate aerospace cyan-blue hue with subtle amber twilight sunset scattering.
 * 2. Karman Line / Atmospheric Interface Shell strictly at 6,478.137 km (100 km altitude).
 *    - Preserves established scientific boundary with amber boundary sphere and equatorial perimeter ring.
 */
export const AtmosphereShell: React.FC<AtmosphereShellProps> = ({
  showAtmosphereGlow = true,
  showAtmosphereInterface = true,
  sunDirection = [25, 15, 20],
}) => {
  // Normalized Sun Direction in world space
  const sunDirVector = useMemo(() => {
    return new THREE.Vector3(...sunDirection).normalize();
  }, [sunDirection]);

  // 1. Rayleigh Scattering Optical Limb Glow Shader Material
  const atmosphereGlowMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSunDirection: { value: sunDirVector },
        uGlowColor: { value: new THREE.Color("#0ea5e9") }, // Electric aerospace sky blue
        uSunsetColor: { value: new THREE.Color("#f97316") }, // Soft amber sunset tint
        uGlowIntensity: { value: 0.85 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPosition;

        void main() {
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDirection;
        uniform vec3 uGlowColor;
        uniform vec3 uSunsetColor;
        uniform float uGlowIntensity;

        varying vec3 vNormal;
        varying vec3 vWorldPosition;

        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          vec3 normal = normalize(vNormal);
          vec3 sunDir = normalize(uSunDirection);

          // BackSide rim factor: viewDir . normal gives grazing limb intensity
          float edgeDot = dot(viewDir, normal);
          float fresnel = pow(clamp(edgeDot, 0.0, 1.0), 3.2);

          // Sunlight scattering: stronger on sunlit hemisphere
          float sunDot = dot(normal, sunDir);
          float sunScatter = smoothstep(-0.35, 0.65, sunDot);

          // Rayleigh scattering color transition (amber sunset near terminator, cyan elsewhere)
          vec3 scatterColor = mix(uSunsetColor, uGlowColor, smoothstep(-0.25, 0.25, sunDot));

          // Atmosphere alpha falloff
          float alpha = fresnel * uGlowIntensity * (0.25 + 0.75 * sunScatter);

          gl_FragColor = vec4(scatterColor, alpha);
        }
      `,
    });
  }, [sunDirVector]);

  useEffect(() => {
    if (atmosphereGlowMaterial) {
      atmosphereGlowMaterial.uniforms.uSunDirection.value = sunDirVector;
      atmosphereGlowMaterial.needsUpdate = true;
    }
  }, [atmosphereGlowMaterial, sunDirVector]);

  useEffect(() => {
    return () => {
      atmosphereGlowMaterial.dispose();
    };
  }, [atmosphereGlowMaterial]);

  // 2. Equatorial Perimeter Ring Geometry for Karman boundary
  const ringGeometry = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const theta = (i / 64) * Math.PI * 2;
      points.push(
        new THREE.Vector3(
          ATMOSPHERE_INTERFACE_DISPLAY * Math.cos(theta),
          0,
          ATMOSPHERE_INTERFACE_DISPLAY * Math.sin(theta)
        )
      );
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, []);

  useEffect(() => {
    return () => {
      ringGeometry.dispose();
    };
  }, [ringGeometry]);

  return (
    <group position={[0, 0, 0]}>
      {/* 1. Atmospheric Optical Glow Rim (0 to 70 km altitude) */}
      {showAtmosphereGlow && (
        <mesh material={atmosphereGlowMaterial}>
          <sphereGeometry args={[EARTH_RADIUS_DISPLAY + 0.070, 64, 64]} />
        </mesh>
      )}

      {/* 2. Karman Line / Atmospheric Interface Shell strictly at 6,478.137 km (100 km altitude) */}
      {showAtmosphereInterface && (
        <group>
          {/* Translucent Boundary Sphere */}
          <mesh>
            <sphereGeometry args={[ATMOSPHERE_INTERFACE_DISPLAY, 48, 48]} />
            <meshBasicMaterial
              color="#f59e0b" // Amber alert boundary
              transparent
              opacity={0.07}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>

          {/* Equatorial Perimeter Ring Indicator */}
          <lineLoop geometry={ringGeometry}>
            <lineBasicMaterial
              color="#f59e0b"
              transparent
              opacity={0.5}
              depthWrite={false}
            />
          </lineLoop>
        </group>
      )}
    </group>
  );
};
