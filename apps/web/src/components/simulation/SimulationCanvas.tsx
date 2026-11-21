"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls as DreiOrbitControls, Html } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  FragmentTrajectory,
  SyntheticFragmentRecord,
  RendezvousContract,
  CollisionScenario,
  RendezvousResult,
  TargetingMode,
} from "@/types/simulation";
import {
  gcrsToThreePosition,
  EARTH_RADIUS_DISPLAY,
  calculateAltitudeKm,
  calculateArrivalPosition,
  computeCwDepartureVelocity,
  computeCwTrajectoryPoints,
} from "@/lib/coordinates";
import { EarthMesh } from "../visualization/EarthMesh";
import { AtmosphereShell } from "../visualization/AtmosphereShell";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import {
  RotateCcw,
  Orbit,
  Layers,
  Compass,
  Grid,
} from "lucide-react";

export interface SimulationCanvasProps {
  trajectories?: FragmentTrajectory[];
  fragments?: SyntheticFragmentRecord[];
  contract?: RendezvousContract | null;
  selectedFragmentId?: string | null;
  onSelectFragment?: (fragmentId: string) => void;
  className?: string;
  showChaser?: boolean;
  scenario?: CollisionScenario | null;
  initialBreakupMode?: "before" | "after";
  rendezvousResult?: RendezvousResult | null;
  initialViewScale?: "global" | "local";
  targetingMode?: TargetingMode;
  standoffDistanceM?: number;
}

// ============================================================================
// Astrodynamics Helpers: Hill (RIC) Basis & Coordinate Transformations
// ============================================================================

export interface HillBasis {
  rHat: [number, number, number];
  iHat: [number, number, number];
  cHat: [number, number, number];
}

/**
 * Computes unit basis vectors of the Hill (RIC: Radial, In-Track, Cross-Track) frame
 * from reference geocentric Cartesian position (km) and velocity (km/s) in GCRS.
 */
export function computeHillBasis(
  posKm: [number, number, number],
  velKms: [number, number, number]
): HillBasis | null {
  const [rx, ry, rz] = posKm;
  const [vx, vy, vz] = velKms;

  const rMag = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (rMag < 1e-6) return null;

  // Radial unit vector: r_hat = r / |r| (points outward from Earth center)
  const rHat: [number, number, number] = [rx / rMag, ry / rMag, rz / rMag];

  // Angular momentum vector: h = r x v
  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const hMag = Math.sqrt(hx * hx + hy * hy + hz * hz);
  if (hMag < 1e-6) return null;

  // Cross-track unit vector: c_hat = h / |h| (normal to orbital plane)
  const cHat: [number, number, number] = [hx / hMag, hy / hMag, hz / hMag];

  // In-track unit vector: i_hat = c_hat x r_hat (completes right-handed system, along velocity for circular)
  const ix = cHat[1] * rHat[2] - cHat[2] * rHat[1];
  const iy = cHat[2] * rHat[0] - cHat[0] * rHat[2];
  const iz = cHat[0] * rHat[1] - cHat[1] * rHat[0];
  const iHat: [number, number, number] = [ix, iy, iz];

  return { rHat, iHat, cHat };
}

/**
 * Projects a physical GCRS relative displacement vector (km) into local Hill coordinates in meters.
 * Returns [I, R, C] mapped to Three.js display space:
 * - X_Three = In-Track (I, meters)
 * - Y_Three = Radial (R, meters, pointing upward)
 * - Z_Three = Cross-Track (C, meters, pointing out-of-plane)
 */
export function projectGcrsToHillLocalMeters(
  deltaGcrsKm: [number, number, number],
  basis: HillBasis
): [number, number, number] {
  const dxM = deltaGcrsKm[0] * 1000.0;
  const dyM = deltaGcrsKm[1] * 1000.0;
  const dzM = deltaGcrsKm[2] * 1000.0;

  const R = dxM * basis.rHat[0] + dyM * basis.rHat[1] + dzM * basis.rHat[2];
  const I = dxM * basis.iHat[0] + dyM * basis.iHat[1] + dzM * basis.iHat[2];
  const C = dxM * basis.cHat[0] + dyM * basis.cHat[1] + dzM * basis.cHat[2];

  // Three.js local display convention: X = In-Track (I), Y = Radial (R), Z = Cross-Track (C)
  return [I, R, C];
}

export { computeCwTrajectoryPoints, computeCwDepartureVelocity, calculateArrivalPosition };



// ============================================================================
// ArrowAxis: 3D Directional Vector with Tip Cone and Tag
// ============================================================================
interface ArrowAxisProps {
  origin: [number, number, number];
  direction: [number, number, number];
  color: string;
  label: string;
  coneSize?: [number, number];
}

const ArrowAxis: React.FC<ArrowAxisProps> = ({
  origin,
  direction,
  color,
  label,
  coneSize = [0.04, 0.12],
}) => {
  const lineGeom = useMemo(() => {
    const end: [number, number, number] = [
      origin[0] + direction[0],
      origin[1] + direction[1],
      origin[2] + direction[2],
    ];
    return new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...origin),
      new THREE.Vector3(...end),
    ]);
  }, [origin, direction]);

  const lineMat = useMemo(
    () => new THREE.LineBasicMaterial({ color, linewidth: 2 }),
    [color]
  );

  const coneProps = useMemo(() => {
    const dir = new THREE.Vector3(...direction);
    dir.normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const tipPos: [number, number, number] = [
      origin[0] + direction[0],
      origin[1] + direction[1],
      origin[2] + direction[2],
    ];
    return { quat, tipPos };
  }, [origin, direction]);

  useEffect(() => {
    return () => {
      lineGeom.dispose();
      lineMat.dispose();
    };
  }, [lineGeom, lineMat]);

  return (
    <group>
      <primitive object={new THREE.Line(lineGeom, lineMat)} />
      <mesh position={coneProps.tipPos} quaternion={coneProps.quat}>
        <coneGeometry args={[coneSize[0], coneSize[1], 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html
        position={[
          coneProps.tipPos[0] + direction[0] * 0.08,
          coneProps.tipPos[1] + direction[1] * 0.08,
          coneProps.tipPos[2] + direction[2] * 0.08,
        ]}
        center
        distanceFactor={30}
        className="pointer-events-none select-none z-10"
      >
        <span
          className="text-[9px] font-mono font-bold px-1 py-0.5 rounded shadow whitespace-nowrap"
          style={{ backgroundColor: "rgba(10, 15, 29, 0.9)", color }}
        >
          {label}
        </span>
      </Html>
    </group>
  );
};

// ============================================================================
// Concentric Range Ring for Local Distance Calibration
// ============================================================================
interface RangeRingProps {
  radius: number;
  label: string;
  color?: string;
}

const RangeRing: React.FC<RangeRingProps> = ({
  radius,
  label,
  color = "#334155",
}) => {
  const lineObj = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * 2 * Math.PI;
      // In the orbital plane: X = in-track, Z = cross-track, Y = radial = 0
      points.push(
        new THREE.Vector3(radius * Math.cos(theta), 0, radius * Math.sin(theta))
      );
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineDashedMaterial({
      color,
      dashSize: 2.5,
      gapSize: 2.0,
      transparent: true,
      opacity: 0.6,
    });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    return line;
  }, [radius, color]);

  useEffect(() => {
    return () => {
      lineObj.geometry.dispose();
      if (Array.isArray(lineObj.material)) {
        lineObj.material.forEach((m) => m.dispose());
      } else {
        lineObj.material.dispose();
      }
    };
  }, [lineObj]);

  return (
    <group>
      <primitive object={lineObj} />
      <Html
        position={[radius, 0, 0]}
        center
        distanceFactor={40}
        className="pointer-events-none select-none z-10"
      >
        <span className="text-[9px] font-mono text-slate-400 bg-space-dark/85 px-1 py-0.2 rounded border border-slate-700/60 shadow">
          {label}
        </span>
      </Html>
    </group>
  );
};

// ============================================================================
// Local Hill/RIC Triad for Magnified Views
// ============================================================================
interface LocalHillAxesProps {
  axisLength?: number;
}

const LocalHillAxes: React.FC<LocalHillAxesProps> = ({ axisLength = 35 }) => {
  // Negative dashed axes
  const negAxes = useMemo(() => {
    const lines: THREE.Line[] = [];
    const negLength = axisLength * 0.6;
    const dirs: [number, number, number][] = [
      [-negLength, 0, 0], // -I
      [0, -negLength, 0], // -R
      [0, 0, -negLength], // -C
    ];

    dirs.forEach((dir) => {
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(...dir),
      ]);
      const mat = new THREE.LineDashedMaterial({
        color: 0x475569,
        dashSize: 2,
        gapSize: 2,
        transparent: true,
        opacity: 0.4,
      });
      const l = new THREE.Line(geom, mat);
      l.computeLineDistances();
      lines.push(l);
    });

    return lines;
  }, [axisLength]);

  useEffect(() => {
    return () => {
      negAxes.forEach((l) => {
        l.geometry.dispose();
        if (Array.isArray(l.material)) {
          l.material.forEach((m) => m.dispose());
        } else {
          l.material.dispose();
        }
      });
    };
  }, [negAxes]);

  return (
    <group>
      {/* Negative dashed reference axes */}
      {negAxes.map((l, i) => (
        <primitive key={i} object={l} />
      ))}

      {/* +I In-Track Axis (Green along +X) */}
      <ArrowAxis
        origin={[0, 0, 0]}
        direction={[axisLength, 0, 0]}
        color="#10b981"
        label="+I (In-Track)"
        coneSize={[1.2, 3.5]}
      />

      {/* +R Radial Axis (Red along +Y) */}
      <ArrowAxis
        origin={[0, 0, 0]}
        direction={[0, axisLength, 0]}
        color="#ef4444"
        label="+R (Radial)"
        coneSize={[1.2, 3.5]}
      />

      {/* +C Cross-Track Axis (Blue along +Z) */}
      <ArrowAxis
        origin={[0, 0, 0]}
        direction={[0, 0, axisLength]}
        color="#3b82f6"
        label="+C (Cross-Track)"
        coneSize={[1.2, 3.5]}
      />
    </group>
  );
};

// ============================================================================
// GLOBAL SCENE: TrajectoryLine in Global GCRS Display Space
// ============================================================================
interface TrajectoryLineProps {
  trajectory: FragmentTrajectory;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const TrajectoryLine: React.FC<TrajectoryLineProps> = ({
  trajectory,
  isSelected,
  onSelect,
}) => {
  const lineObject = useMemo(() => {
    if (!trajectory.points || trajectory.points.length === 0) return null;

    const points = trajectory.points.map((pt) => {
      const [x, y, z] = gcrsToThreePosition(
        pt.position_km[0],
        pt.position_km[1],
        pt.position_km[2],
        trajectory.frame
      );
      return new THREE.Vector3(x, y, z);
    });

    const geom = new THREE.BufferGeometry().setFromPoints(points);

    let color = 0x10b981; // Emerald for SUCCESS
    if (trajectory.status === "PARTIAL") color = 0xf59e0b; // Amber
    if (trajectory.status === "FAILED") color = 0xf43f5e; // Rose

    if (isSelected) color = 0x06b6d4; // Cyan when selected

    const mat = new THREE.LineBasicMaterial({
      color,
      linewidth: isSelected ? 3 : 1,
      transparent: true,
      opacity: isSelected ? 1.0 : 0.65,
    });

    return new THREE.Line(geom, mat);
  }, [trajectory, isSelected]);

  useEffect(() => {
    return () => {
      if (lineObject) {
        lineObject.geometry.dispose();
        if (Array.isArray(lineObject.material)) {
          lineObject.material.forEach((m) => m.dispose());
        } else {
          lineObject.material.dispose();
        }
      }
    };
  }, [lineObject]);

  if (!lineObject) return null;

  // Endpoint marker
  const lastPoint = trajectory.points[trajectory.points.length - 1];
  const [lastX, lastY, lastZ] = gcrsToThreePosition(
    lastPoint.position_km[0],
    lastPoint.position_km[1],
    lastPoint.position_km[2],
    trajectory.frame
  );

  return (
    <group>
      <primitive object={lineObject} />
      <mesh
        position={[lastX, lastY, lastZ]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(trajectory.fragment_id);
        }}
      >
        <sphereGeometry args={[isSelected ? 0.12 : 0.07, 16, 16]} />
        <meshBasicMaterial
          color={
            isSelected
              ? "#06b6d4"
              : trajectory.status === "SUCCESS"
                ? "#10b981"
                : trajectory.status === "PARTIAL"
                  ? "#f59e0b"
                  : "#f43f5e"
          }
        />
      </mesh>
    </group>
  );
};

// ============================================================================
// GLOBAL SCENE: Chaser & Target Markers in Global GCRS Display Space
// ============================================================================
interface ChaserTargetMarkersProps {
  contract: RendezvousContract;
  showHillAxes?: boolean;
}

const ChaserTargetMarkers: React.FC<ChaserTargetMarkersProps> = ({
  contract,
  showHillAxes = true,
}) => {
  const [chaserX, chaserY, chaserZ] = useMemo(
    () =>
      gcrsToThreePosition(
        contract.chaser_gcrs_position_km[0],
        contract.chaser_gcrs_position_km[1],
        contract.chaser_gcrs_position_km[2],
        "GCRS"
      ),
    [contract.chaser_gcrs_position_km]
  );

  const [targetX, targetY, targetZ] = useMemo(
    () =>
      gcrsToThreePosition(
        contract.target_gcrs_position_km[0],
        contract.target_gcrs_position_km[1],
        contract.target_gcrs_position_km[2],
        "GCRS"
      ),
    [contract.target_gcrs_position_km]
  );

  // Separation distance in physical kilometers
  const separationDistKm = useMemo(() => {
    const dx =
      contract.target_gcrs_position_km[0] - contract.chaser_gcrs_position_km[0];
    const dy =
      contract.target_gcrs_position_km[1] - contract.chaser_gcrs_position_km[1];
    const dz =
      contract.target_gcrs_position_km[2] - contract.chaser_gcrs_position_km[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }, [contract.target_gcrs_position_km, contract.chaser_gcrs_position_km]);

  // Straight line connection (relative line-of-sight vector)
  const linkLine = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(chaserX, chaserY, chaserZ),
      new THREE.Vector3(targetX, targetY, targetZ),
    ]);
    const mat = new THREE.LineDashedMaterial({
      color: 0xf59e0b,
      dashSize: 0.12,
      gapSize: 0.06,
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    return line;
  }, [chaserX, chaserY, chaserZ, targetX, targetY, targetZ]);

  // Compute Hill (RIC) coordinate triad unit vectors at Target
  const ricVectors = useMemo(() => {
    const basis = computeHillBasis(
      contract.target_gcrs_position_km,
      contract.target_gcrs_velocity_kms
    );
    if (!basis) return null;

    const axisLen = 1.0;
    // GCRS to Three.js orientation: (dx_three, dy_three, dz_three) = (dx_gcrs, dz_gcrs, -dy_gcrs)
    const rThree: [number, number, number] = [
      basis.rHat[0] * axisLen,
      basis.rHat[2] * axisLen,
      -basis.rHat[1] * axisLen,
    ];
    const iThree: [number, number, number] = [
      basis.iHat[0] * axisLen,
      basis.iHat[2] * axisLen,
      -basis.iHat[1] * axisLen,
    ];
    const cThree: [number, number, number] = [
      basis.cHat[0] * axisLen,
      basis.cHat[2] * axisLen,
      -basis.cHat[1] * axisLen,
    ];

    return { rThree, iThree, cThree };
  }, [contract.target_gcrs_position_km, contract.target_gcrs_velocity_kms]);

  useEffect(() => {
    return () => {
      linkLine.geometry.dispose();
      linkLine.material.dispose();
    };
  }, [linkLine]);

  const midX = (chaserX + targetX) / 2;
  const midY = (chaserY + targetY) / 2;
  const midZ = (chaserZ + targetZ) / 2;

  return (
    <group>
      {/* Chaser Spacecraft Marker (Cyan Octahedron) */}
      <mesh position={[chaserX, chaserY, chaserZ]}>
        <octahedronGeometry args={[0.2, 0]} />
        <meshStandardMaterial
          color="#06b6d4"
          emissive="#0891b2"
          emissiveIntensity={0.8}
          roughness={0.2}
        />
      </mesh>
      <Html
        position={[chaserX, chaserY + 0.4, chaserZ]}
        center
        distanceFactor={22}
        className="pointer-events-none select-none z-10"
      >
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-space-surface/90 border border-cyan/70 text-cyan backdrop-blur-md shadow-lg text-[10px] font-mono font-bold whitespace-nowrap">
          <span>CHASER: {contract.chaser_id}</span>
          <span className="text-[9px] text-cyan/70 font-normal">
            (t₀ DEPARTURE)
          </span>
        </div>
      </Html>

      {/* Target Fragment Marker (Rose Sphere) */}
      <mesh position={[targetX, targetY, targetZ]}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial
          color="#f43f5e"
          emissive="#e11d48"
          emissiveIntensity={0.8}
        />
      </mesh>
      <Html
        position={[targetX, targetY + 0.4, targetZ]}
        center
        distanceFactor={22}
        className="pointer-events-none select-none z-10"
      >
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-space-surface/90 border border-rose-500/70 text-rose-300 backdrop-blur-md shadow-lg text-[10px] font-mono font-bold whitespace-nowrap">
          <span>TARGET: {contract.target_id}</span>
          <span className="text-[9px] text-rose-400/80 font-normal">
            (t₀ TARGET STATE)
          </span>
        </div>
      </Html>

      {/* Straight-line separation vector between Chaser & Target at t0 */}
      <primitive object={linkLine} />

      {/* Separation tag at midpoint */}
      <Html
        position={[midX, midY - 0.25, midZ]}
        center
        distanceFactor={22}
        className="pointer-events-none select-none z-10"
      >
        <div className="px-1.5 py-0.5 rounded bg-amber-950/90 border border-amber-500/60 text-amber-300 text-[9px] font-mono whitespace-nowrap backdrop-blur-md shadow">
          INITIAL RELATIVE VECTOR (t₀):{" "}
          {separationDistKm < 1
            ? `${(separationDistKm * 1000).toFixed(1)} m`
            : `${separationDistKm.toFixed(2)} km`}
        </div>
      </Html>

      {/* Hill (RIC) Coordinate Triad at Target */}
      {showHillAxes && ricVectors && (
        <group>
          <ArrowAxis
            origin={[targetX, targetY, targetZ]}
            direction={ricVectors.rThree}
            color="#ef4444"
            label="+R"
          />
          <ArrowAxis
            origin={[targetX, targetY, targetZ]}
            direction={ricVectors.iThree}
            color="#10b981"
            label="+I"
          />
          <ArrowAxis
            origin={[targetX, targetY, targetZ]}
            direction={ricVectors.cThree}
            color="#3b82f6"
            label="+C"
          />
        </group>
      )}
    </group>
  );
};

// ============================================================================
// GLOBAL SCENE: Parent Bodies & Pre-Collision Orbits ("Before Breakup" Mode)
// ============================================================================
interface ParentOrbitsProps {
  scenario: CollisionScenario;
}

const generateOrbitPoints = (
  positionKm: [number, number, number],
  velocityKms: [number, number, number],
  numPoints: number = 128
): THREE.Vector3[] => {
  const [rx, ry, rz] = positionKm;
  const [vx, vy, vz] = velocityKms;

  const rMag = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (rMag < 1e-6) return [];

  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const hMag = Math.sqrt(hx * hx + hy * hy + hz * hz);
  if (hMag < 1e-6) return [];

  const ur: [number, number, number] = [rx / rMag, ry / rMag, rz / rMag];
  const uh: [number, number, number] = [hx / hMag, hy / hMag, hz / hMag];
  const utx = uh[1] * ur[2] - uh[2] * ur[1];
  const uty = uh[2] * ur[0] - uh[0] * ur[2];
  const utz = uh[0] * ur[1] - uh[1] * ur[0];

  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const theta = (i / numPoints) * 2 * Math.PI;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const px = rMag * (cosT * ur[0] + sinT * utx);
    const py = rMag * (cosT * ur[1] + sinT * uty);
    const pz = rMag * (cosT * ur[2] + sinT * utz);

    const [x3, y3, z3] = gcrsToThreePosition(px, py, pz, "GCRS");
    points.push(new THREE.Vector3(x3, y3, z3));
  }
  return points;
};

const ParentOrbits: React.FC<ParentOrbitsProps> = ({ scenario }) => {
  const [pAX, pAY, pAZ] = useMemo(
    () =>
      gcrsToThreePosition(
        scenario.parent_a.position_km[0],
        scenario.parent_a.position_km[1],
        scenario.parent_a.position_km[2],
        "GCRS"
      ),
    [scenario.parent_a.position_km]
  );

  const [pBX, pBY, pBZ] = useMemo(
    () =>
      gcrsToThreePosition(
        scenario.parent_b.position_km[0],
        scenario.parent_b.position_km[1],
        scenario.parent_b.position_km[2],
        "GCRS"
      ),
    [scenario.parent_b.position_km]
  );

  const orbitLineA = useMemo(() => {
    const pts = generateOrbitPoints(
      scenario.parent_a.position_km,
      scenario.parent_a.velocity_kms
    );
    if (pts.length === 0) return null;
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.75,
      linewidth: 1.5,
    });
    return new THREE.Line(geom, mat);
  }, [scenario.parent_a.position_km, scenario.parent_a.velocity_kms]);

  const orbitLineB = useMemo(() => {
    const pts = generateOrbitPoints(
      scenario.parent_b.position_km,
      scenario.parent_b.velocity_kms
    );
    if (pts.length === 0) return null;
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.75,
      linewidth: 1.5,
    });
    return new THREE.Line(geom, mat);
  }, [scenario.parent_b.position_km, scenario.parent_b.velocity_kms]);

  useEffect(() => {
    return () => {
      if (orbitLineA) {
        orbitLineA.geometry.dispose();
        orbitLineA.material.dispose();
      }
      if (orbitLineB) {
        orbitLineB.geometry.dispose();
        orbitLineB.material.dispose();
      }
    };
  }, [orbitLineA, orbitLineB]);

  const altA = Math.round(
    calculateAltitudeKm(
      scenario.parent_a.position_km[0],
      scenario.parent_a.position_km[1],
      scenario.parent_a.position_km[2]
    )
  );
  const altB = Math.round(
    calculateAltitudeKm(
      scenario.parent_b.position_km[0],
      scenario.parent_b.position_km[1],
      scenario.parent_b.position_km[2]
    )
  );

  const midX = (pAX + pBX) / 2;
  const midY = (pAY + pBY) / 2;
  const midZ = (pAZ + pBZ) / 2;

  return (
    <group>
      {/* Parent A Orbit Line */}
      {orbitLineA && <primitive object={orbitLineA} />}

      {/* Parent B Orbit Line */}
      {orbitLineB && <primitive object={orbitLineB} />}

      {/* Parent A Marker (Cyan Octahedron) */}
      <mesh position={[pAX, pAY, pAZ]}>
        <octahedronGeometry args={[0.18, 0]} />
        <meshStandardMaterial
          color="#06b6d4"
          emissive="#0891b2"
          emissiveIntensity={0.8}
          roughness={0.2}
        />
      </mesh>
      <Html
        position={[pAX, pAY + 0.45, pAZ]}
        center
        distanceFactor={22}
        className="pointer-events-none select-none z-10"
      >
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-space-surface/90 border border-cyan/70 text-cyan backdrop-blur-md shadow-lg text-[10px] font-mono font-bold whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan animate-ping" />
          <span>PARENT A: {scenario.parent_a.object_id}</span>
          <span className="text-[9px] text-slate-400 font-normal">
            ({altA} km)
          </span>
        </div>
      </Html>

      {/* Parent B Marker (Amber Octahedron) */}
      <mesh position={[pBX, pBY, pBZ]}>
        <octahedronGeometry args={[0.18, 0]} />
        <meshStandardMaterial
          color="#f59e0b"
          emissive="#d97706"
          emissiveIntensity={0.8}
          roughness={0.2}
        />
      </mesh>
      <Html
        position={[pBX, pBY + 0.45, pBZ]}
        center
        distanceFactor={22}
        className="pointer-events-none select-none z-10"
      >
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-space-surface/90 border border-amber-500/70 text-amber-300 backdrop-blur-md shadow-lg text-[10px] font-mono font-bold whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
          <span>PARENT B: {scenario.parent_b.object_id}</span>
          <span className="text-[9px] text-slate-400 font-normal">
            ({altB} km)
          </span>
        </div>
      </Html>

      {/* Collision Point Marker */}
      <mesh position={[midX, midY, midZ]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color="#f43f5e" />
      </mesh>
      <Html
        position={[midX, midY - 0.35, midZ]}
        center
        distanceFactor={22}
        className="pointer-events-none select-none z-10"
      >
        <div className="px-1.5 py-0.5 rounded bg-rose-950/90 border border-rose-500/70 text-rose-300 backdrop-blur-md shadow text-[9px] font-mono font-bold whitespace-nowrap">
          COLLISION POINT
        </div>
      </Html>
    </group>
  );
};

// ============================================================================
// LOCAL SCENE: Magnified Fragment Cloud Relative Geometry (Breakup Mode)
// ============================================================================
interface LocalFragmentCloudProps {
  trajectories: FragmentTrajectory[];
  fragments?: SyntheticFragmentRecord[];
  scenario?: CollisionScenario | null;
  selectedFragmentId?: string | null;
  onSelectFragment?: (id: string) => void;
  showGrid?: boolean;
}

const LocalFragmentCloud: React.FC<LocalFragmentCloudProps> = ({
  trajectories,
  fragments = [],
  scenario,
  selectedFragmentId,
  onSelectFragment,
  showGrid = true,
}) => {
  // Reference state: Collision origin / Center of Mass
  const refState = useMemo(() => {
    if (scenario?.parent_a) {
      return {
        posKm: scenario.parent_a.position_km,
        velKms: scenario.parent_a.velocity_kms,
      };
    }
    if (fragments.length > 0) {
      return {
        posKm: fragments[0].position_km,
        velKms: fragments[0].velocity_kms,
      };
    }
    return {
      posKm: [7200.0, 0.0, 0.0] as [number, number, number],
      velKms: [0.0, 7.4405, 0.0] as [number, number, number],
    };
  }, [scenario, fragments]);

  // Compute Hill frame basis vectors at the reference orbit
  const basis = useMemo(
    () => computeHillBasis(refState.posKm, refState.velKms),
    [refState]
  );

  // Convert each fragment's trajectory points into local meters [I, R, C] relative to the translationally centered cloud geometric centroid.
  // NOTE: Fragment masses are unequal (ranging from 1.45 kg to 24.85 kg); this centering computes the unweighted geometric centroid
  // r_centroid(t_k) = (1/N) * sum(r_i(t_k)) rather than a physical mass-weighted center of mass.
  // Coordinate axes are projected onto the fixed initial Hill basis triad (rHat, iHat, cHat) computed at t=0 and do not dynamically rotate.
  const localTrajLines = useMemo(() => {
    if (!basis || trajectories.length === 0) return [];

    // Calculate instantaneous geometric centroid of the cloud at each time step k
    const maxPoints = Math.max(...trajectories.map((t) => t.points?.length || 0));
    if (maxPoints === 0) return [];

    const centroidTrajectory: [number, number, number][] = [];
    for (let k = 0; k < maxPoints; k++) {
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let count = 0;
      trajectories.forEach((t) => {
        if (t.points && t.points[k]) {
          sumX += t.points[k].position_km[0];
          sumY += t.points[k].position_km[1];
          sumZ += t.points[k].position_km[2];
          count++;
        }
      });
      if (count > 0) {
        centroidTrajectory.push([sumX / count, sumY / count, sumZ / count]);
      } else {
        centroidTrajectory.push(refState.posKm);
      }
    }

    return trajectories.map((traj) => {
      const isSelected = traj.fragment_id === selectedFragmentId;
      const pts = (traj.points || []).map((pt, k) => {
        const centroidPos = centroidTrajectory[k] || refState.posKm;
        const deltaKm: [number, number, number] = [
          pt.position_km[0] - centroidPos[0],
          pt.position_km[1] - centroidPos[1],
          pt.position_km[2] - centroidPos[2],
        ];
        const [I, R, C] = projectGcrsToHillLocalMeters(deltaKm, basis);
        return new THREE.Vector3(I, R, C);
      });

      const geom = new THREE.BufferGeometry().setFromPoints(pts);

      let color = 0x10b981; // Emerald for SUCCESS
      if (traj.status === "PARTIAL") color = 0xf59e0b; // Amber
      if (traj.status === "FAILED") color = 0xf43f5e; // Rose
      if (isSelected) color = 0x06b6d4; // Cyan

      const mat = new THREE.LineBasicMaterial({
        color,
        linewidth: isSelected ? 3 : 1.5,
        transparent: true,
        opacity: isSelected ? 1.0 : 0.75,
      });

      const line = new THREE.Line(geom, mat);

      // Endpoint in meters
      const lastPt = pts[pts.length - 1] || new THREE.Vector3(0, 0, 0);
      const distM = Math.sqrt(
        lastPt.x * lastPt.x + lastPt.y * lastPt.y + lastPt.z * lastPt.z
      );

      return {
        fragment_id: traj.fragment_id,
        status: traj.status,
        line,
        endpoint: lastPt,
        distM,
        isSelected,
      };
    });
  }, [trajectories, basis, refState, selectedFragmentId]);

  useEffect(() => {
    return () => {
      localTrajLines.forEach((item) => {
        item.line.geometry.dispose();
        if (Array.isArray(item.line.material)) {
          item.line.material.forEach((m) => m.dispose());
        } else {
          item.line.material.dispose();
        }
      });
    };
  }, [localTrajLines]);

  return (
    <group>
      {/* Concentric Calibration Range Rings in Meters (50m, 100m, 150m, 200m) */}
      {showGrid && (
        <group>
          <RangeRing radius={50} label="50 m" color="#334155" />
          <RangeRing radius={100} label="100 m" color="#475569" />
          <RangeRing radius={150} label="150 m" color="#334155" />
          <RangeRing radius={200} label="200 m" color="#1e293b" />
          <LocalHillAxes axisLength={40} />
        </group>
      )}

      {/* Collision Origin Marker at [0, 0, 0] */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[1.5, 16, 16]} />
        <meshStandardMaterial
          color="#f43f5e"
          emissive="#e11d48"
          emissiveIntensity={0.8}
        />
      </mesh>
      <Html
        position={[0, -3.0, 0]}
        center
        distanceFactor={35}
        className="pointer-events-none select-none z-10"
      >
        <div className="px-1.5 py-0.5 rounded bg-rose-950/90 border border-rose-500/80 text-rose-300 text-[9px] font-mono font-bold whitespace-nowrap shadow backdrop-blur-md">
          COLLISION ORIGIN (t = 0s)
        </div>
      </Html>

      {/* Actual Propagated Trajectory Arcs in Relative Space */}
      {localTrajLines.map((item) => (
        <group key={item.fragment_id}>
          <primitive object={item.line} />
          {/* Fragment Endpoint Mesh */}
          <mesh
            position={[item.endpoint.x, item.endpoint.y, item.endpoint.z]}
            onClick={(e) => {
              e.stopPropagation();
              onSelectFragment?.(item.fragment_id);
            }}
          >
            <octahedronGeometry args={[item.isSelected ? 2.5 : 1.6, 0]} />
            <meshStandardMaterial
              color={item.isSelected ? "#06b6d4" : "#10b981"}
              emissive={item.isSelected ? "#0891b2" : "#059669"}
              emissiveIntensity={item.isSelected ? 1.0 : 0.6}
            />
          </mesh>
          {/* Fragment Tag */}
          <Html
            position={[
              item.endpoint.x,
              item.endpoint.y + 2.5,
              item.endpoint.z,
            ]}
            center
            distanceFactor={35}
            className="pointer-events-none select-none z-10"
          >
            <div
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono whitespace-nowrap shadow backdrop-blur-md transition-all ${item.isSelected
                  ? "bg-cyan/95 border border-cyan text-space-dark font-bold ring-1 ring-cyan"
                  : "bg-space-surface/90 border border-space-border/80 text-slate-300"
                }`}
            >
              <span>{item.fragment_id.replace("SYNTH-", "")}</span>
              <span className="text-[8px] text-slate-400 ml-1">
                ({item.distM.toFixed(0)}m)
              </span>
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
};

// ============================================================================
// LOCAL SCENE: Magnified Clohessy-Wiltshire Hill (RIC) Rendezvous Geometry
// ============================================================================
interface LocalHillRemediationProps {
  contract: RendezvousContract;
  rendezvousResult?: RendezvousResult | null;
  showGrid?: boolean;
  targetingMode?: TargetingMode;
  standoffDistanceM?: number;
}

const TARGET_HILL_ORIGIN: [number, number, number] = [0, 0, 0];

const LocalHillRemediation: React.FC<LocalHillRemediationProps> = ({
  contract,
  rendezvousResult,
  showGrid = true,
  targetingMode = "STANDOFF_HOLD",
  standoffDistanceM = 50.0,
}) => {
  // Compute Hill frame basis vectors at Target state
  const basis = useMemo(
    () =>
      computeHillBasis(
        contract.target_gcrs_position_km,
        contract.target_gcrs_velocity_kms
      ),
    [contract.target_gcrs_position_km, contract.target_gcrs_velocity_kms]
  );

  // Target is strictly at the origin of its own Hill relative frame: [0, 0, 0]
  const targetPos = TARGET_HILL_ORIGIN;

  // Actual terminal arrival position in Three.js display space [I, R, C]
  const arrivalPos = useMemo(
    () => calculateArrivalPosition(targetingMode, standoffDistanceM),
    [targetingMode, standoffDistanceM]
  );

  // Target chief mean motion n (rad/s) computed from GCRS state
  const meanMotion = useMemo(() => {
    const rx = contract.target_gcrs_position_km[0];
    const ry = contract.target_gcrs_position_km[1];
    const rz = contract.target_gcrs_position_km[2];
    const rMag = Math.sqrt(rx * rx + ry * ry + rz * rz);

    const vx = contract.target_gcrs_velocity_kms[0];
    const vy = contract.target_gcrs_velocity_kms[1];
    const vz = contract.target_gcrs_velocity_kms[2];
    const vSq = vx * vx + vy * vy + vz * vz;

    const mu = 398600.4418;
    const energy = 0.5 * vSq - mu / rMag;
    if (energy >= 0) return 0.0010334;
    const a = -mu / (2.0 * energy);
    return Math.sqrt(mu / (a * a * a));
  }, [contract.target_gcrs_position_km, contract.target_gcrs_velocity_kms]);

  // Transfer duration in seconds
  const transferTimeS = rendezvousResult?.transfer_time_s ?? 120.0;

  // Chaser relative displacement in Hill frame [I, R, C] meters
  const chaserPos = useMemo((): [number, number, number] => {
    if (!basis) return [0, 0, 0];
    const deltaKm: [number, number, number] = [
      contract.chaser_gcrs_position_km[0] - contract.target_gcrs_position_km[0],
      contract.chaser_gcrs_position_km[1] - contract.target_gcrs_position_km[1],
      contract.chaser_gcrs_position_km[2] - contract.target_gcrs_position_km[2],
    ];
    return projectGcrsToHillLocalMeters(deltaKm, basis);
  }, [contract, basis]);

  // Euclidean separation distance in physical meters
  const separationM = useMemo(() => {
    return Math.sqrt(
      chaserPos[0] * chaserPos[0] +
      chaserPos[1] * chaserPos[1] +
      chaserPos[2] * chaserPos[2]
    );
  }, [chaserPos]);

// CW analytical relative trajectory sampled across 50 points
  const cwPoints = useMemo(() => {
    return computeCwTrajectoryPoints(
      chaserPos,
      arrivalPos,
      meanMotion,
      transferTimeS,
      50
    );
  }, [chaserPos, arrivalPos, meanMotion, transferTimeS]);

  // CW trajectory Three.js line object
  const cwTrajectoryLine = useMemo(() => {
    if (cwPoints.length < 2) return null;
    const geom = new THREE.BufferGeometry().setFromPoints(
      cwPoints.map((p) => new THREE.Vector3(...p))
    );
    const mat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      linewidth: 2,
      transparent: true,
      opacity: 0.95,
    });
    return new THREE.Line(geom, mat);
  }, [cwPoints]);

  useEffect(() => {
    return () => {
      if (cwTrajectoryLine) {
        cwTrajectoryLine.geometry.dispose();
        (cwTrajectoryLine.material as THREE.Material).dispose();
      }
    };
  }, [cwTrajectoryLine]);

  // Straight line connection (relative line-of-sight vector)
  const linkLine = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...chaserPos),
      new THREE.Vector3(...targetPos),
    ]);
    const mat = new THREE.LineDashedMaterial({
      color: 0xf59e0b,
      dashSize: 3,
      gapSize: 2,
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    return line;
  }, [chaserPos, targetPos]);

  useEffect(() => {
    return () => {
      linkLine.geometry.dispose();
      linkLine.material.dispose();
    };
  }, [linkLine]);

  // Midpoint of line of sight
  const midPos: [number, number, number] = [
    chaserPos[0] / 2,
    chaserPos[1] / 2,
    chaserPos[2] / 2,
  ];

  // Burn 1 impulsive delta-v vector at Chaser [I, R, C] display space
  const burn1Arrow = useMemo(() => {
    if (!rendezvousResult?.burn_1_dv_cw_ms) return null;
    const [dvR, dvI, dvC] = rendezvousResult.burn_1_dv_cw_ms;
    const mag = Math.sqrt(dvR * dvR + dvI * dvI + dvC * dvC);
    if (mag < 1e-6) return null;

    // Display scale: 16 meters visual length
    const arrowLen = 16.0;
    const dir: [number, number, number] = [
      (dvI / mag) * arrowLen,
      (dvR / mag) * arrowLen,
      (dvC / mag) * arrowLen,
    ];
    return { dir, mag };
  }, [rendezvousResult?.burn_1_dv_cw_ms]);

  // Burn 2 impulsive delta-v vector at Target [I, R, C] display space
  const burn2Arrow = useMemo(() => {
    if (!rendezvousResult?.burn_2_dv_cw_ms) return null;
    const [dvR, dvI, dvC] = rendezvousResult.burn_2_dv_cw_ms;
    const mag = Math.sqrt(dvR * dvR + dvI * dvI + dvC * dvC);
    if (mag < 1e-6) return null;

    // Display scale: 14 meters visual length
    const arrowLen = 14.0;
    const dir: [number, number, number] = [
      (dvI / mag) * arrowLen,
      (dvR / mag) * arrowLen,
      (dvC / mag) * arrowLen,
    ];
    return { dir, mag };
  }, [rendezvousResult?.burn_2_dv_cw_ms]);

  return (
    <group>
      {/* Concentric Calibration Range Rings in Meters (25m, 50m, 75m, 100m) */}
      {showGrid && (
        <group>
          <RangeRing radius={25} label="25 m" color="#334155" />
          <RangeRing radius={50} label="50 m" color="#475569" />
          <RangeRing radius={75} label="75 m" color="#334155" />
          <RangeRing radius={100} label="100 m" color="#1e293b" />
          <LocalHillAxes axisLength={35} />
        </group>
      )}

      {/* Target Marker at Hill Frame Origin [0, 0, 0] */}
      <mesh position={targetPos}>
        <sphereGeometry args={[2.0, 16, 16]} />
        <meshStandardMaterial
          color="#f43f5e"
          emissive="#e11d48"
          emissiveIntensity={0.8}
        />
      </mesh>
      <Html
        position={[targetPos[0], targetPos[1] + 3.5, targetPos[2]]}
        center
        distanceFactor={35}
        className="pointer-events-none select-none z-10"
      >
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-space-surface/95 border border-rose-500/80 text-rose-300 text-[9px] font-mono font-bold whitespace-nowrap shadow backdrop-blur-md">
          <span>TARGET: {contract.target_id}</span>
          <span className="text-[8px] text-rose-400/80 font-normal">
            (t₀ INITIAL STATE • HILL ORIGIN)
          </span>
        </div>
      </Html>

      {/* Chaser Marker at Local Position */}
      <mesh position={chaserPos}>
        <octahedronGeometry args={[2.5, 0]} />
        <meshStandardMaterial
          color="#06b6d4"
          emissive="#0891b2"
          emissiveIntensity={0.8}
          roughness={0.2}
        />
      </mesh>
      <Html
        position={[chaserPos[0], chaserPos[1] + 4.0, chaserPos[2]]}
        center
        distanceFactor={35}
        className="pointer-events-none select-none z-10"
      >
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-space-surface/95 border border-cyan/80 text-cyan text-[9px] font-mono font-bold whitespace-nowrap shadow backdrop-blur-md">
          <span>CHASER: {contract.chaser_id}</span>
          <span className="text-[8px] text-cyan/70 font-normal">
            (t₀ INITIAL STATE)
          </span>
        </div>
      </Html>

      {/* Line-of-sight Relative Separation Line at t0 */}
      <primitive object={linkLine} />

      {/* Initial relative displacement tag at midpoint */}
      <Html
        position={[midPos[0], midPos[1] - 2.5, midPos[2]]}
        center
        distanceFactor={35}
        className="pointer-events-none select-none z-10"
      >
        <div className="px-2 py-0.5 rounded bg-amber-950/90 border border-amber-500/70 text-amber-300 text-[9px] font-mono font-bold whitespace-nowrap shadow backdrop-blur-md">
          INITIAL RELATIVE VECTOR (t₀): {separationM.toFixed(1)} m
        </div>
      </Html>

      {/* Burn 1 Thrust Vector at Chaser */}
      {burn1Arrow && (
        <ArrowAxis
          origin={chaserPos}
          direction={burn1Arrow.dir}
          color="#38bdf8"
          label={`Δv₁ Departure (t₀): ${burn1Arrow.mag.toFixed(2)} m/s`}
          coneSize={[0.9, 2.5]}
        />
      )}

      {/* Analytical CW Transfer Trajectory Arc (50 samples connecting t0 to tf) */}
      {cwTrajectoryLine && <primitive object={cwTrajectoryLine} />}

      {/* Terminal Chaser Arrival Position Marker at tf */}
      <mesh position={arrivalPos}>
        <octahedronGeometry args={[2.0, 0]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#0284c7"
          emissiveIntensity={0.8}
          wireframe
        />
      </mesh>
      <Html
        position={[arrivalPos[0], arrivalPos[1] + 3.5, arrivalPos[2]]}
        center
        distanceFactor={35}
        className="pointer-events-none select-none z-10"
      >
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-space-surface/95 border border-sky-500/80 text-sky-300 text-[9px] font-mono font-bold whitespace-nowrap shadow backdrop-blur-md">
          <span>CHASER ARRIVAL (tf)</span>
          <span className="text-[8px] text-sky-400/80 font-normal">
            ({targetingMode === "CONTACT_INTERCEPT" ? "CONTACT" : `${standoffDistanceM ?? 50}m STANDOFF`})
          </span>
        </div>
      </Html>

      {/* Burn 2 Braking Vector at Chaser Terminal Arrival Position */}
      {burn2Arrow && (
        <ArrowAxis
          origin={arrivalPos}
          direction={burn2Arrow.dir}
          color="#f43f5e"
          label={`Δv₂ Arrival (tf): ${burn2Arrow.mag.toFixed(2)} m/s`}
          coneSize={[0.9, 2.5]}
        />
      )}
    </group>
  );
};

// ============================================================================
// Camera View Switcher: Manages Camera & Controls Transitions
// ============================================================================
interface CameraTransitionProps {
  viewScale: "global" | "local";
  isRemediation: boolean;
  controlsRef: React.RefObject<OrbitControlsImpl>;
}

const CameraTransition: React.FC<CameraTransitionProps> = ({
  viewScale,
  isRemediation,
  controlsRef,
}) => {
  const { camera } = useThree();
  const prevScaleRef = useRef<"global" | "local">(viewScale);

  useEffect(() => {
    if (prevScaleRef.current !== viewScale) {
      prevScaleRef.current = viewScale;
      if (controlsRef.current) {
        if (viewScale === "global") {
          camera.position.set(18, 10, 20);
          controlsRef.current.target.set(0, -0.6, 0);
          controlsRef.current.minDistance = EARTH_RADIUS_DISPLAY + 0.5;
          controlsRef.current.maxDistance = 80;
        } else if (isRemediation) {
          camera.position.set(15, 55, 145);
          controlsRef.current.target.set(15, -4, 0);
          controlsRef.current.minDistance = 5;
          controlsRef.current.maxDistance = 400;
        } else {
          camera.position.set(0, 80, 160);
          controlsRef.current.target.set(0, 0, 0);
          controlsRef.current.minDistance = 5;
          controlsRef.current.maxDistance = 500;
        }
        camera.updateProjectionMatrix();
        controlsRef.current.update();
      }
    }
  }, [viewScale, isRemediation, camera, controlsRef]);

  return null;
};

// ============================================================================
// SimulationCanvas: Primary 3D Visualization Component
// ============================================================================
export const SimulationCanvas: React.FC<SimulationCanvasProps> = ({
  trajectories = [],
  fragments = [],
  contract = null,
  selectedFragmentId = null,
  onSelectFragment,
  className = "",
  showChaser = true,
  scenario = null,
  initialBreakupMode = "after",
  rendezvousResult = null,
  initialViewScale = "global",
  targetingMode = "STANDOFF_HOLD",
  standoffDistanceM = 50.0,
}) => {
  const [hasWebGL, setHasWebGL] = useState<boolean | null>(null);
  const [showEarth, setShowEarth] = useState<boolean>(true);
  const [showAtmosphere, setShowAtmosphere] = useState<boolean>(true);
  const [showHillAxes, setShowHillAxes] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [viewScale, setViewScale] = useState<"global" | "local">(
    initialViewScale
  );
  const [breakupViewMode, setBreakupViewMode] = useState<"before" | "after">(
    initialBreakupMode
  );
  const controlsRef = useRef<OrbitControlsImpl>(null);

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

  useEffect(() => {
    if (initialBreakupMode) {
      setBreakupViewMode(initialBreakupMode);
    }
  }, [initialBreakupMode]);

  useEffect(() => {
    if (initialViewScale) {
      setViewScale(initialViewScale);
    }
  }, [initialViewScale]);

  const isRemediationMode = Boolean(contract);

  const handleResetCamera = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.reset();
      if (viewScale === "global") {
        controlsRef.current.object.position.set(18, 10, 20);
        controlsRef.current.target.set(0, -0.6, 0);
        controlsRef.current.minDistance = EARTH_RADIUS_DISPLAY + 0.5;
        controlsRef.current.maxDistance = 80;
      } else if (isRemediationMode) {
        controlsRef.current.object.position.set(40, 50, 110);
        controlsRef.current.target.set(40, -6, 0);
        controlsRef.current.minDistance = 5;
        controlsRef.current.maxDistance = 400;
      } else {
        controlsRef.current.object.position.set(0, 80, 160);
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.minDistance = 5;
        controlsRef.current.maxDistance = 500;
      }
      controlsRef.current.update();
    }
  }, [viewScale, isRemediationMode]);

  const handleSelect = (id: string) => {
    if (onSelectFragment) {
      onSelectFragment(id);
    }
  };

  // Fallback for non-WebGL environments
  if (hasWebGL === false) {
    return (
      <Card
        className={`flex flex-col items-center justify-center p-8 bg-space-dark border-space-border ${className}`}
      >
        <Orbit className="h-12 w-12 text-slate-600 mb-3 animate-pulse" />
        <p className="text-sm font-semibold text-slate-300 font-mono">
          WebGL Acceleration Unavailable
        </p>
        <p className="text-xs text-slate-400 text-center max-w-sm mt-1 font-mono">
          3D orbital canvas could not be initialized in this browser environment.
          Tabular telemetry and trajectory metrics remain fully functional.
        </p>
      </Card>
    );
  }

  const trajectoryCount = trajectories.length;

  return (
    <div
      className={`relative w-full h-[380px] xl:h-[440px] 2xl:h-[540px] rounded-xl overflow-hidden border border-space-border bg-space-dark shadow-panel ${className}`}
    >
      {/* 3D Canvas */}
      <Canvas
        camera={{
          position:
            viewScale === "local"
              ? isRemediationMode
                ? [15, 55, 145]
                : [0, 80, 160]
              : [18, 10, 20],
          fov: 45,
          near: 0.1,
          far: 2000,
        }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 10]} intensity={1.2} />
        <directionalLight
          position={[-10, -5, -10]}
          intensity={0.3}
          color="#06b6d4"
        />

        {/* Global vs Local Camera Position Transition Controller */}
        <CameraTransition
          viewScale={viewScale}
          isRemediation={isRemediationMode}
          controlsRef={controlsRef}
        />

        {/* ============================================================ */}
        {/* VIEW SCALE 1: GLOBAL EARTH-SCALE INERTIAL SCENE              */}
        {/* ============================================================ */}
        {viewScale === "global" && (
          <group>
            {/* Central Planetary Body: Earth in Inertial GCRS */}
            {showEarth && (
              <EarthMesh
                isPlaying={true}
                playbackSpeed={1}
                showLatLongGrid={true}
              />
            )}

            {/* Atmospheric Interface Shell at 6,478.137 km (100 km altitude) */}
            {showAtmosphere && (
              <AtmosphereShell
                showAtmosphereGlow={true}
                showAtmosphereInterface={true}
              />
            )}

            {/* Breakup Mode: Before Breakup Parent Spacecraft & Orbits */}
            {!isRemediationMode && breakupViewMode === "before" && scenario && (
              <ParentOrbits scenario={scenario} />
            )}

            {/* Breakup Mode: After Breakup Propagated Fragment Trajectories */}
            {!isRemediationMode &&
              breakupViewMode === "after" &&
              trajectories.map((traj) => (
                <TrajectoryLine
                  key={traj.fragment_id}
                  trajectory={traj}
                  isSelected={selectedFragmentId === traj.fragment_id}
                  onSelect={handleSelect}
                />
              ))}

            {/* Remediation Mode: Global Chaser, Target, Separation Line, and Hill Triad */}
            {isRemediationMode && contract && (
              <ChaserTargetMarkers
                contract={contract}
                showHillAxes={showHillAxes}
              />
            )}
          </group>
        )}

        {/* ============================================================ */}
        {/* VIEW SCALE 2: LOCAL MAGNIFIED RELATIVE GEOMETRY SCENE        */}
        {/* ============================================================ */}
        {viewScale === "local" && (
          <group>
            {/* Breakup Mode: Local Fragment Cloud View */}
            {!isRemediationMode && (
              <LocalFragmentCloud
                trajectories={trajectories}
                fragments={fragments}
                scenario={scenario}
                selectedFragmentId={selectedFragmentId}
                onSelectFragment={handleSelect}
                showGrid={showGrid}
              />
            )}

            {/* Remediation Mode: Local Hill (RIC) Relative View */}
            {isRemediationMode && contract && (
              <LocalHillRemediation
                contract={contract}
                rendezvousResult={rendezvousResult}
                showGrid={showGrid}
                targetingMode={targetingMode}
                standoffDistanceM={standoffDistanceM}
              />
            )}
          </group>
        )}

        {/* Interactive Camera Controls */}
        <DreiOrbitControls
          ref={controlsRef}
          target={
            viewScale === "local"
              ? isRemediationMode
                ? [15, -4, 0]
                : [0, 0, 0]
              : [0, -0.6, 0]
          }
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          dampingFactor={0.08}
          minDistance={
            viewScale === "local" ? 5 : EARTH_RADIUS_DISPLAY + 0.5
          }
          maxDistance={viewScale === "local" ? 500 : 80}
        />
      </Canvas>

      {/* Top Left Canvas HUD Overlays */}
      <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5 pointer-events-none z-20 max-w-[calc(100%-380px)]">
        {viewScale === "global" ? (
          <>
            {isRemediationMode && contract ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="cyan" size="sm">
                    GCRS INERTIAL SCENE
                  </Badge>
                  <Badge variant="amber" size="sm">
                    CW HILL (RIC)
                  </Badge>
                </div>
                <Badge
                  variant="outline"
                  size="sm"
                  className="font-mono text-[10px]"
                >
                  {contract.chaser_id} &rarr; {contract.target_id}
                </Badge>
              </>
            ) : breakupViewMode === "before" ? (
              <>
                <Badge variant="cyan" size="sm">
                  GCRS INERTIAL
                </Badge>
                <Badge
                  variant="outline"
                  size="sm"
                  className="font-mono text-[10px]"
                >
                  PRE-COLLISION: 2 PARENTS
                </Badge>
              </>
            ) : (
              <>
                <Badge variant="cyan" size="sm">
                  GCRS INERTIAL
                </Badge>
                <Badge
                  variant="emerald"
                  size="sm"
                  className="font-mono text-[10px]"
                >
                  POST-BREAKUP ({trajectoryCount} FRAGS)
                </Badge>
              </>
            )}
          </>
        ) : (
          /* LOCAL MAGNIFIED VIEW HUD */
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="cyan" size="sm">
                LOCAL RELATIVE VIEW
              </Badge>
              {isRemediationMode ? (
                <Badge variant="amber" size="sm">
                  HILL (RIC) FRAME
                </Badge>
              ) : (
                <Badge variant="emerald" size="sm">
                  CENTROID-CENTERED CLOUD
                </Badge>
              )}
            </div>
            <Badge
              variant="outline"
              size="sm"
              className="font-mono text-[9px]"
            >
              {isRemediationMode
                ? "25m RINGS • LINEARIZED CW (t₀ → tf)"
                : `Δt = 60s • ${trajectoryCount} FRAGS • CENTROID-CENTERED (50m RINGS)`}
            </Badge>
          </>
        )}
      </div>

      {/* Top Right Controls Toolbar */}
      <div className="absolute top-3 right-3 flex items-center gap-2 z-20">
        {/* Scale Segmented Control: [GLOBAL VIEW] | [LOCAL MAGNIFIED] */}
        <div className="flex items-center p-0.5 rounded-lg bg-space-surface/90 border border-space-border backdrop-blur-md font-mono text-[10px] xl:text-[11px] shadow-panel">
          <button
            type="button"
            onClick={() => setViewScale("global")}
            className={`px-2 xl:px-2.5 py-1 rounded transition-colors font-bold ${viewScale === "global"
                ? "bg-cyan text-space-bg shadow-sm"
                : "text-slate-400 hover:text-slate-200"
              }`}
            title="Global Earth-scale orbital visualization"
          >
            GLOBAL VIEW
          </button>
          <button
            type="button"
            onClick={() => setViewScale("local")}
            className={`px-2 xl:px-2.5 py-1 rounded transition-colors font-bold ${viewScale === "local"
                ? "bg-cyan text-space-bg shadow-sm"
                : "text-slate-400 hover:text-slate-200"
              }`}
            title={
              isRemediationMode
                ? "Local Hill (RIC) relative motion view"
                : "Local relative fragment cloud view"
            }
          >
            {isRemediationMode ? "LOCAL HILL (RIC)" : "LOCAL CLOUD"}
          </button>
        </div>

        {/* Before / After Breakup Comparison Toggle (Only in Global Breakup mode) */}
        {!isRemediationMode && viewScale === "global" && scenario && (
          <div className="flex items-center p-0.5 rounded-lg bg-space-surface/90 border border-space-border backdrop-blur-md font-mono text-[11px] shadow-panel">
            <button
              type="button"
              onClick={() => setBreakupViewMode("before")}
              className={`px-2 py-1 rounded transition-colors font-bold ${breakupViewMode === "before"
                  ? "bg-cyan text-space-bg shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
                }`}
              title="View pre-collision parent spacecraft and orbits"
            >
              BEFORE
            </button>
            <button
              type="button"
              onClick={() => setBreakupViewMode("after")}
              className={`px-2 py-1 rounded transition-colors font-bold ${breakupViewMode === "after"
                  ? "bg-cyan text-space-bg shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
                }`}
              title="View propagated synthetic fragment debris cloud"
            >
              AFTER
            </button>
          </div>
        )}

        {/* Scene Layer & Tool Controls */}
        <div className="flex items-center gap-1 bg-space-surface/90 p-1 rounded-lg border border-space-border backdrop-blur-md shadow-panel">
          {/* Local Scale Ring/Grid Toggle (Only in Local view) */}
          {viewScale === "local" && (
            <button
              type="button"
              onClick={() => setShowGrid(!showGrid)}
              title="Toggle Distance Calibration Rings & Grid"
              className={`p-1.5 rounded text-xs transition-colors ${showGrid
                  ? "bg-cyan/20 text-cyan"
                  : "text-slate-400 hover:text-slate-200"
                }`}
            >
              <Grid className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Hill (RIC) Axes Toggle */}
          {isRemediationMode && (
            <button
              type="button"
              onClick={() => setShowHillAxes(!showHillAxes)}
              title="Toggle Hill (RIC) Coordinate Triad"
              className={`p-1.5 rounded text-xs transition-colors ${showHillAxes
                  ? "bg-cyan/20 text-cyan"
                  : "text-slate-400 hover:text-slate-200"
                }`}
            >
              <Compass className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Atmospheric Boundary Shell Toggle (Global mode only) */}
          {viewScale === "global" && (
            <button
              type="button"
              onClick={() => setShowAtmosphere(!showAtmosphere)}
              title="Toggle Atmospheric Boundary Shell (100 km altitude)"
              className={`p-1.5 rounded text-xs transition-colors ${showAtmosphere
                  ? "bg-amber-500/20 text-amber-300"
                  : "text-slate-400 hover:text-slate-200"
                }`}
            >
              <Layers className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Earth Mesh Toggle (Global mode only) */}
          {viewScale === "global" && (
            <button
              type="button"
              onClick={() => setShowEarth(!showEarth)}
              title="Toggle Earth Planetary Mesh"
              className={`p-1.5 rounded text-xs transition-colors ${showEarth
                  ? "bg-cyan/20 text-cyan"
                  : "text-slate-400 hover:text-slate-200"
                }`}
            >
              <Orbit className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Camera Reset */}
          <button
            type="button"
            onClick={handleResetCamera}
            title="Reset Camera Framing"
            className="p-1.5 rounded text-xs text-slate-400 hover:text-slate-200 hover:bg-space-panel transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Bottom Center Legend */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[calc(100%-1.5rem)] flex flex-wrap items-center justify-center gap-x-2.5 sm:gap-x-3 gap-y-1 px-3 py-1 sm:py-1.5 rounded-xl sm:rounded-full bg-space-surface/90 border border-space-border text-[9px] sm:text-[10px] font-mono text-slate-400 backdrop-blur-md shadow-panel z-20">
        {viewScale === "global" ? (
          /* GLOBAL LEGEND */
          isRemediationMode ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 bg-cyan rotate-45" /> Chaser (t₀)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-500 ring-2 ring-rose-400/50" />{" "}
                Target (t₀)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 bg-amber-400" /> Initial Rel. Vector (t₀)
              </span>
              {showHillAxes && (
                <span className="hidden md:flex items-center gap-2 pl-2 border-l border-space-border">
                  <span className="text-rose-400 font-bold">+R</span>
                  <span className="text-emerald-400 font-bold">+I</span>
                  <span className="text-blue-400 font-bold">+C</span>
                </span>
              )}
            </>
          ) : breakupViewMode === "before" ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 bg-cyan rotate-45" /> Parent A (Alpha)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 bg-amber-400 rotate-45" /> Parent B
                (Beta)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-500" /> Collision
                Point
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Success
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" /> Partial
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-400" /> Reentered
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-cyan ring-2 ring-cyan/50" />{" "}
                Selected
              </span>
            </>
          )
        ) : (
          /* LOCAL MAGNIFIED LEGEND */
          isRemediationMode ? (
            <>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-2 w-2 rounded-full bg-rose-500 ring-2 ring-rose-400/50" />{" "}
                Target [0,0,0] (t₀)
              </span>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-2 w-2 bg-cyan rotate-45" /> Chaser (t₀)
              </span>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-2 w-2 bg-sky-400 rotate-45 border border-sky-300" /> Chaser Arrival (tf)
              </span>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-0.5 w-3 bg-amber-400" /> Initial Rel. Vector (t₀)
              </span>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-0.5 w-3 bg-sky-400" /> CW Transfer Trajectory
              </span>
              <span className="flex items-center gap-2 pl-2 border-l border-space-border whitespace-nowrap">
                <span className="text-rose-400 font-bold">+R</span>
                <span className="text-emerald-400 font-bold">+I</span>
                <span className="text-blue-400 font-bold">+C</span>
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-500" /> Collision
                Origin (t=0)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 bg-emerald-400 rotate-45" /> Fragment
                (t=60s)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 bg-emerald-400/70" /> Relative
                Trajectory
              </span>
              <span className="hidden sm:inline text-slate-500 pl-2 border-l border-space-border">
                Scale: 50m rings
              </span>
            </>
          )
        )}
      </div>
    </div>
  );
};
