/**
 * COLLIVRA Encounter-Centered Relative GCRS Geometry
 *
 * Implements relative state vector transformations and display mapping
 * for close-approach conjunction visualization centered on Object 1.
 *
 * Scientific Coordinate Contract (Milestone 4.2.3):
 * 1. Encounter-Centered Origin:
 *    Object 1 is defined as the relative coordinate origin [0, 0, 0].
 * 2. Relative Position Vector (r_rel = r_2 - r_1):
 *    Object 2 is positioned at r_rel in the Geocentric Celestial Reference System (GCRS).
 * 3. Relative Velocity Vector (v_rel = v_2 - v_1):
 *    Originates at Object 2, oriented along v_rel in GCRS.
 * 4. Three.js Right-Handed Display Coordinate Mapping:
 *    X_Three =  x_GCRS / scaleKmPerUnit
 *    Y_Three =  z_GCRS / scaleKmPerUnit  (celestial pole direction)
 *    Z_Three = -y_GCRS / scaleKmPerUnit  (completes right-handed system)
 *    Preserves right-handedness: [1, 0, 0] x [0, 0, -1] = [0, 1, 0]
 * 5. Scale Handling:
 *    - Encounter Scale: 1 unit = 1.0 km (1000x visual magnification vs global radar scale).
 *      Allows legible inspection of 1 km, 5 km, and 10 km encounter shells.
 *    - Radar Scale: 1 unit = 1000.0 km (global radar scene convention).
 *    Under all scale modes, underlying numerical vector coordinates and backend-provided
 *    miss distance remain strictly unaltered and exact.
 * 6. Scientific Prohibitions:
 *    - Strictly NO Earth rotation or Earth obliquity applied.
 *    - Strictly NO Hill-frame, LVLH, or RIC transformations.
 *    - Coordinate axes are strictly GCRS +X, GCRS +Y, GCRS +Z (never labeled equinox, radial, along-track, cross-track, or orbital plane).
 */

import { ConjunctionEvent, CoordinateFrame } from "../types/api";

export const ENCOUNTER_SCALE_KM_PER_UNIT = 1.0;
export const RADAR_SCALE_KM_PER_UNIT = 1000.0;

export interface SeverityShellDefinition {
  tier: "CRITICAL" | "HIGH" | "MODERATE";
  radiusKm: number;
  displayRadius: number;
  color: string;
  label: string;
}

export const DEFAULT_SEVERITY_SHELLS: {
  tier: "CRITICAL" | "HIGH" | "MODERATE";
  radiusKm: number;
  color: string;
  label: string;
}[] = [
  { tier: "CRITICAL", radiusKm: 1.0, color: "#f43f5e", label: "Critical (<1.0 km)" },
  { tier: "HIGH", radiusKm: 5.0, color: "#f59e0b", label: "High (1.0–5.0 km)" },
  { tier: "MODERATE", radiusKm: 10.0, color: "#eab308", label: "Moderate (5.0–10.0 km)" },
];

/**
 * Validates that input coordinate frame is strictly GCRS or GCRF.
 * Prohibits Hill, LVLH, RIC, TEME, and terrestrial frames.
 */
export function assertGcrsEncounterFrame(frame: CoordinateFrame | string): void {
  if (frame !== "GCRS" && frame !== "GCRF") {
    throw new Error(
      `Invalid encounter coordinate frame: '${frame}'. Encounter visualization strictly requires inertial GCRS/GCRF. ` +
      `Hill/LVLH/RIC, TEME, and terrestrial transformations are strictly prohibited.`
    );
  }
}

/**
 * Maps a GCRS Cartesian vector [x, y, z] (km) to Three.js display coordinates [X, Y, Z] (units).
 * Preserves right-handedness: X_Three = x, Y_Three = z, Z_Three = -y.
 */
export function gcrsToEncounterThreeVector(
  gcrsVec: [number, number, number],
  scaleKmPerUnit: number = ENCOUNTER_SCALE_KM_PER_UNIT
): [number, number, number] {
  if (
    !Array.isArray(gcrsVec) ||
    gcrsVec.length !== 3 ||
    !Number.isFinite(gcrsVec[0]) ||
    !Number.isFinite(gcrsVec[1]) ||
    !Number.isFinite(gcrsVec[2]) ||
    !Number.isFinite(scaleKmPerUnit) ||
    scaleKmPerUnit <= 0
  ) {
    throw new Error(
      `Invalid GCRS vector or scale: vector=${JSON.stringify(gcrsVec)}, scale=${scaleKmPerUnit}`
    );
  }

  return [
    gcrsVec[0] / scaleKmPerUnit,
    gcrsVec[2] / scaleKmPerUnit,
    -gcrsVec[1] / scaleKmPerUnit,
  ];
}

/**
 * Validates whether a conjunction event has valid, finite GCRS relative state vectors.
 */
export function isValidEncounterEvent(
  event: ConjunctionEvent | null | undefined
): event is ConjunctionEvent {
  if (!event) return false;
  if (event.frame !== "GCRS" && event.frame !== "GCRF") return false;

  const p = event.relative_position_km;
  const v = event.relative_velocity_kms;

  if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) return false;
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) return false;
  if (!Number.isFinite(event.miss_distance_km) || event.miss_distance_km < 0) return false;
  if (!Number.isFinite(event.relative_speed_kms) || event.relative_speed_kms < 0) return false;

  return true;
}

/**
 * Computes miss-distance vector endpoints and Euclidean distance in Three.js display units.
 */
export function calculateMissDistanceEndpoints(
  event: ConjunctionEvent,
  scaleKmPerUnit: number = ENCOUNTER_SCALE_KM_PER_UNIT
): {
  origin: [number, number, number];
  target: [number, number, number];
  distanceUnits: number;
} {
  if (!isValidEncounterEvent(event)) {
    throw new Error(`Cannot compute miss-distance endpoints for invalid encounter event`);
  }

  const origin: [number, number, number] = [0, 0, 0];
  const target = gcrsToEncounterThreeVector(event.relative_position_km, scaleKmPerUnit);
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const dz = target[2] - origin[2];
  const distanceUnits = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return { origin, target, distanceUnits };
}

/**
 * Computes relative velocity vector geometry for display.
 * Originates at Object 2 position, oriented along v_rel in GCRS display mapping.
 */
export function calculateRelativeVelocityGeometry(
  event: ConjunctionEvent,
  scaleKmPerUnit: number = ENCOUNTER_SCALE_KM_PER_UNIT
): {
  origin: [number, number, number];
  direction: [number, number, number];
  speedKms: number;
  arrowLengthUnits: number;
} {
  if (!isValidEncounterEvent(event)) {
    throw new Error(`Cannot compute relative velocity geometry for invalid encounter event`);
  }

  const origin = gcrsToEncounterThreeVector(event.relative_position_km, scaleKmPerUnit);
  const vx = event.relative_velocity_kms[0];
  const vy = event.relative_velocity_kms[1];
  const vz = event.relative_velocity_kms[2];
  const speedKms = Math.sqrt(vx * vx + vy * vy + vz * vz);

  // Direction in Three.js coordinates
  let direction: [number, number, number];
  if (speedKms > 1e-9) {
    direction = [vx / speedKms, vz / speedKms, -vy / speedKms];
  } else {
    direction = [0, 1, 0];
  }

  // Arrow length in Three.js units, clamped to legible bounds
  const baseScale = scaleKmPerUnit === ENCOUNTER_SCALE_KM_PER_UNIT ? 1.0 : 1.0 / 1000.0;
  const arrowLengthUnits = Math.min(
    Math.max(speedKms * 0.3 * baseScale, 1.5 * baseScale),
    4.5 * baseScale
  );

  return { origin, direction, speedKms, arrowLengthUnits };
}

/**
 * Calculates severity shell radii for the current display scale.
 */
export function calculateSeverityShells(
  scaleKmPerUnit: number = ENCOUNTER_SCALE_KM_PER_UNIT
): SeverityShellDefinition[] {
  return DEFAULT_SEVERITY_SHELLS.map((shell) => ({
    ...shell,
    displayRadius: shell.radiusKm / scaleKmPerUnit,
  }));
}
