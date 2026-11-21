"use client";

import React, { useRef, useMemo, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  EARTH_RADIUS_DISPLAY,
  EARTH_ROTATION_RATE_RAD_PER_SEC,
} from "../../lib/coordinates";
import { useEarthTextures } from "../../hooks/useEarthTextures";

export interface EarthMeshProps {
  showLatLongGrid?: boolean;
  playbackSpeed?: number;
  isPlaying?: boolean;
  sunDirection?: [number, number, number];
}

/**
 * Procedural fallback Earth texture via HTML5 canvas.
 * Used during SSR or if high-resolution textures fail to load.
 */
function createProceduralFallbackTexture(): THREE.CanvasTexture {
  if (typeof document === "undefined") {
    return new THREE.CanvasTexture({} as HTMLCanvasElement);
  }

  const width = 1024;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

  const oceanGrad = ctx.createLinearGradient(0, 0, 0, height);
  oceanGrad.addColorStop(0, "#081b33");
  oceanGrad.addColorStop(0.5, "#0b2545");
  oceanGrad.addColorStop(1, "#081b33");
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#1e392a";
  ctx.strokeStyle = "#2e5c44";
  ctx.lineWidth = 2;

  // Continents approximation
  ctx.beginPath();
  ctx.ellipse(260, 150, 110, 80, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(320, 330, 60, 100, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(650, 140, 170, 75, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(540, 270, 85, 110, 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(840, 360, 65, 45, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#dbeafe";
  ctx.fillRect(0, 0, width, 30);
  ctx.fillRect(0, height - 35, width, 35);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * Photorealistic Planetary Earth & Cloud Mesh Engine (Phase 3)
 *
 * Scientific & Astrodynamical Conventions:
 * - Rotational Spin Axis: Approximated along Three.js +Y [0, 1, 0] = GCRS +Z.
 * - Inertial Fixity: Satellites, orbital tracks, and debris remain fixed in GCRS.
 *   The Earth surface rotates independently beneath them without double rotation.
 * - Solar Illumination Disclosure:
 *   Solar illumination uses a fixed illustrative inertial direction (default normalize([25, 15, 20])).
 *   Day/night rendering is visually representative, not epoch-accurate, and no operational
 *   solar ephemeris is currently connected.
 * - Cloud Rotation Disclosure:
 *   The cloud layer's +15% differential rotation rate is an illustrative visual approximation
 *   for aesthetic depth and is not a validated meteorological or atmospheric wind model.
 * - Planetary Layering:
 *   1. Planetary Surface (Day map + Night city lights + Specular ocean glint).
 *   2. Cloud Layer (Transparent multi-layer sphere with independent wind velocity).
 *   3. Coordinate Reference Grid & Polar Orientation Pin.
 */
export const EarthMesh: React.FC<EarthMeshProps> = ({
  showLatLongGrid = true,
  playbackSpeed = 1,
  isPlaying = true,
  sunDirection = [25, 15, 20],
}) => {
  const earthPolarGroupRef = useRef<THREE.Group>(null);
  const cloudSphereRef = useRef<THREE.Mesh>(null);

  // Load high-resolution NASA / Solar System Scope texture maps
  const { dayMap, nightMap, cloudsMap, specularMap, isLoaded } = useEarthTextures();

  // Normalized Sun Direction in world space
  const sunDirVector = useMemo(() => {
    return new THREE.Vector3(...sunDirection).normalize();
  }, [sunDirection]);

  // Procedural Fallback Texture
  const fallbackTexture = useMemo(() => createProceduralFallbackTexture(), []);
  useEffect(() => {
    return () => {
      fallbackTexture.dispose();
    };
  }, [fallbackTexture]);

  // 1. Photorealistic Earth Surface Shader Material
  const earthSurfaceMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uDayMap: { value: null },
        uNightMap: { value: null },
        uSpecularMap: { value: null },
        uSunDirection: { value: sunDirVector },
        uTerminatorSmoothness: { value: 0.12 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewPosition;

        void main() {
          vUv = uv;
          // Transform normal to world space for accurate Sun vector dot product
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = -mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D uDayMap;
        uniform sampler2D uNightMap;
        uniform sampler2D uSpecularMap;
        uniform vec3 uSunDirection;
        uniform float uTerminatorSmoothness;

        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewPosition;

        void main() {
          vec3 normal = normalize(vNormal);
          vec3 sunDir = normalize(uSunDirection);
          vec3 viewDir = normalize(vViewPosition);

          // Dot product between surface normal and sun direction
          float dotNL = dot(normal, sunDir);

          // Smooth terminator transition across twilight horizon
          float dayFactor = smoothstep(-uTerminatorSmoothness, uTerminatorSmoothness, dotNL);
          float nightFactor = 1.0 - dayFactor;

          // 1. Day Surface Color (NASA Blue Marble)
          vec3 dayColor = texture2D(uDayMap, vUv).rgb;
          vec3 ambient = vec3(0.04, 0.06, 0.10) * dayColor;
          vec3 diffuse = max(dotNL, 0.0) * vec3(1.10, 1.06, 0.98) * dayColor;

          // 2. Ocean Specular Reflection (Sun glint over bodies of water)
          float specMask = texture2D(uSpecularMap, vUv).r;
          vec3 halfVector = normalize(sunDir + viewDir);
          float nDotH = max(dot(normal, halfVector), 0.0);
          float specIntensity = pow(nDotH, 24.0) * specMask * dayFactor;
          vec3 specular = specIntensity * vec3(0.70, 0.85, 1.0);

          // 3. Night City Lights (NASA Black Marble)
          // Golden urban luminescence strictly masked to the unilluminated hemisphere
          vec3 nightLights = texture2D(uNightMap, vUv).rgb;
          vec3 nightColor = nightLights * 1.6 * nightFactor;

          vec3 finalColor = ambient + diffuse + specular + nightColor;

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
    });
  }, [sunDirVector]);

  // Update uniforms when textures finish loading
  useEffect(() => {
    if (earthSurfaceMaterial) {
      earthSurfaceMaterial.uniforms.uDayMap.value = isLoaded && dayMap ? dayMap : fallbackTexture;
      earthSurfaceMaterial.uniforms.uNightMap.value = isLoaded && nightMap ? nightMap : fallbackTexture;
      earthSurfaceMaterial.uniforms.uSpecularMap.value = isLoaded && specularMap ? specularMap : fallbackTexture;
      earthSurfaceMaterial.uniforms.uSunDirection.value = sunDirVector;
      earthSurfaceMaterial.needsUpdate = true;
    }
  }, [earthSurfaceMaterial, isLoaded, dayMap, nightMap, specularMap, fallbackTexture, sunDirVector]);

  useEffect(() => {
    return () => {
      earthSurfaceMaterial.dispose();
    };
  }, [earthSurfaceMaterial]);

  // 2. Transparent Cloud Layer Shader Material
  const cloudMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uCloudMap: { value: null },
        uSunDirection: { value: sunDirVector },
        uOpacity: { value: 0.65 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;

        void main() {
          vUv = uv;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uCloudMap;
        uniform vec3 uSunDirection;
        uniform float uOpacity;

        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;

        void main() {
          vec3 normal = normalize(vNormal);
          vec3 sunDir = normalize(uSunDirection);

          float dotNL = dot(normal, sunDir);
          float dayFactor = smoothstep(-0.15, 0.25, dotNL);

          float cloudDensity = texture2D(uCloudMap, vUv).r;
          if (cloudDensity < 0.04) {
            discard;
          }

          // Illumination on clouds
          vec3 dayCloud = vec3(1.0, 1.0, 1.0) * (0.35 + 0.65 * max(dotNL, 0.0));
          vec3 nightCloud = vec3(0.02, 0.03, 0.06);
          vec3 cloudColor = mix(nightCloud, dayCloud, dayFactor);

          // Attenuate nocturnal opacity so city lights shine through clouds
          float alpha = cloudDensity * uOpacity * (0.35 + 0.65 * dayFactor);

          gl_FragColor = vec4(cloudColor, alpha);
        }
      `,
    });
  }, [sunDirVector]);

  useEffect(() => {
    if (cloudMaterial) {
      cloudMaterial.uniforms.uCloudMap.value = isLoaded && cloudsMap ? cloudsMap : fallbackTexture;
      cloudMaterial.uniforms.uSunDirection.value = sunDirVector;
      cloudMaterial.needsUpdate = true;
    }
  }, [cloudMaterial, isLoaded, cloudsMap, fallbackTexture, sunDirVector]);

  useEffect(() => {
    return () => {
      cloudMaterial.dispose();
    };
  }, [cloudMaterial]);

  // 3. Latitude & Longitude Coordinate Grid Geometry
  const gridGeometry = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const radius = EARTH_RADIUS_DISPLAY + 0.025; // Sits cleanly above clouds

    // Equator circle
    for (let a = 0; a <= 64; a++) {
      const theta = (a / 64) * Math.PI * 2;
      points.push(new THREE.Vector3(radius * Math.cos(theta), 0, radius * Math.sin(theta)));
    }

    // Parallels at +/- 30 deg and +/- 60 deg
    const latitudes = [30, -30, 60, -60];
    latitudes.forEach((latDeg) => {
      const phi = (latDeg * Math.PI) / 180;
      const rRing = radius * Math.cos(phi);
      const yRing = radius * Math.sin(phi);
      for (let a = 0; a <= 64; a++) {
        const theta = (a / 64) * Math.PI * 2;
        points.push(new THREE.Vector3(rRing * Math.cos(theta), yRing, rRing * Math.sin(theta)));
      }
    });

    // Meridians every 45 deg (8 meridians)
    for (let m = 0; m < 8; m++) {
      const lambda = (m / 8) * Math.PI * 2;
      for (let a = 0; a <= 64; a++) {
        const phi = -Math.PI / 2 + (a / 64) * Math.PI;
        const x = radius * Math.cos(phi) * Math.cos(lambda);
        const y = radius * Math.sin(phi);
        const z = radius * Math.cos(phi) * Math.sin(lambda);
        points.push(new THREE.Vector3(x, y, z));
      }
    }

    return new THREE.BufferGeometry().setFromPoints(points);
  }, []);

  useEffect(() => {
    return () => {
      gridGeometry.dispose();
    };
  }, [gridGeometry]);

  // 4. Polar Axis Indicator Pin Geometry
  const polarAxisGeometry = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -(EARTH_RADIUS_DISPLAY + 0.8), 0),
      new THREE.Vector3(0, EARTH_RADIUS_DISPLAY + 0.8, 0),
    ]);
  }, []);

  useEffect(() => {
    return () => {
      polarAxisGeometry.dispose();
    };
  }, [polarAxisGeometry]);

  // Independent rotation of Earth surface and atmospheric winds
  useFrame((_, delta) => {
    if (earthPolarGroupRef.current && isPlaying) {
      // Surface rotation
      earthPolarGroupRef.current.rotation.y +=
        delta * EARTH_ROTATION_RATE_RAD_PER_SEC * playbackSpeed * 100;
    }
    if (cloudSphereRef.current && isPlaying) {
      // Clouds rotate slightly faster (differential atmospheric wind drift: +15%)
      cloudSphereRef.current.rotation.y +=
        delta * EARTH_ROTATION_RATE_RAD_PER_SEC * playbackSpeed * 115;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Rotating Earth Group */}
      <group ref={earthPolarGroupRef}>
        {/* Layer 1: Photorealistic Daytime + Night Lights + Specular Ocean Surface */}
        <mesh material={earthSurfaceMaterial}>
          <sphereGeometry args={[EARTH_RADIUS_DISPLAY, 64, 64]} />
        </mesh>

        {/* Layer 2: Independent Dynamic Cloud Sphere */}
        {isLoaded && cloudsMap && (
          <mesh
            ref={cloudSphereRef}
            material={cloudMaterial}
          >
            <sphereGeometry args={[EARTH_RADIUS_DISPLAY + 0.015, 64, 64]} />
          </mesh>
        )}

        {/* Layer 3: Latitude & Longitude Coordinate Grid */}
        {showLatLongGrid && (
          <lineSegments geometry={gridGeometry}>
            <lineBasicMaterial
              color="#06b6d4"
              transparent
              opacity={0.25}
              depthWrite={false}
            />
          </lineSegments>
        )}

        {/* Layer 4: Polar Axis Indicator Pin (Three.js +Y = GCRS +Z approximation) */}
        <lineSegments geometry={polarAxisGeometry}>
          <lineBasicMaterial color="#38bdf8" transparent opacity={0.6} />
        </lineSegments>
      </group>
    </group>
  );
};
