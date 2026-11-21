/**
 * COLLIVRA Deterministic 3D Orbital Trajectory & Debris Fixtures
 *
 * Provides deterministic GCRS orbit ephemerides and 520 synthetic debris fragments
 * for 3D visualization.
 *
 * Guardrails (AGENTS.md):
 * - Frame is strictly Inertial GCRS (km, km/s).
 * - Trajectory samples are explicitly timestamped across a 90-minute reference window.
 * - Debris fragments are labeled with unique IDs (`SYNTH-FRAG-0001` - `SYNTH-FRAG-0520`)
 *   and explicit synthetic provenance.
 */

import type {
  VisualOrbitSample,
  VisualTrajectory,
  VisualSatellite,
  VisualFragment,
} from "../types/visualization";

const EARTH_MU_KM3_S2 = 398600.4418; // WGS-84 gravitational parameter

/**
 * Deterministic pseudo-random number generator (Linear Congruential Generator)
 * Ensures 100% reproducible fixtures across platforms without Math.random() jitter.
 */
class DeterministicRng {
  private state: number;

  constructor(seed = 1998067) {
    this.state = seed;
  }

  public next(): number {
    this.state = (this.state * 1664525 + 1013904223) % 4294967296;
    return this.state / 4294967296;
  }

  public nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

/**
 * Generates an analytical circular orbit trajectory in inertial GCRS coordinates.
 */
function generateCircularOrbitSamples(
  semiMajorAxisKm: number,
  inclinationDeg: number,
  raanDeg: number,
  argPerigeeDeg: number,
  startEpochMs: number,
  durationMinutes: number,
  stepSeconds: number
): VisualOrbitSample[] {
  const iRad = (inclinationDeg * Math.PI) / 180;
  const oRad = (raanDeg * Math.PI) / 180;
  const wRad = (argPerigeeDeg * Math.PI) / 180;

  // Unit vector P (towards periapsis)
  const Px = Math.cos(oRad) * Math.cos(wRad) - Math.sin(oRad) * Math.sin(wRad) * Math.cos(iRad);
  const Py = Math.sin(oRad) * Math.cos(wRad) + Math.cos(oRad) * Math.sin(wRad) * Math.cos(iRad);
  const Pz = Math.sin(wRad) * Math.sin(iRad);

  // Unit vector Q (in orbital plane, 90 deg ahead of periapsis)
  const Qx = -Math.cos(oRad) * Math.sin(wRad) - Math.sin(oRad) * Math.cos(wRad) * Math.cos(iRad);
  const Qy = -Math.sin(oRad) * Math.sin(wRad) + Math.cos(oRad) * Math.cos(wRad) * Math.cos(iRad);
  const Qz = Math.cos(wRad) * Math.sin(iRad);

  // Mean motion (rad/s)
  const n = Math.sqrt(EARTH_MU_KM3_S2 / Math.pow(semiMajorAxisKm, 3));

  const totalSteps = Math.floor((durationMinutes * 60) / stepSeconds);
  const samples: VisualOrbitSample[] = [];

  for (let step = 0; step <= totalSteps; step++) {
    const tSeconds = step * stepSeconds;
    const epochMs = startEpochMs + tSeconds * 1000;
    const theta = n * tSeconds;

    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // Position in GCRS (km)
    const x = semiMajorAxisKm * (cosT * Px + sinT * Qx);
    const y = semiMajorAxisKm * (cosT * Py + sinT * Qy);
    const z = semiMajorAxisKm * (cosT * Pz + sinT * Qz);

    // Velocity in GCRS (km/s)
    const vMag = semiMajorAxisKm * n;
    const vx = vMag * (-sinT * Px + cosT * Qx);
    const vy = vMag * (-sinT * Py + cosT * Qy);
    const vz = vMag * (-sinT * Pz + cosT * Qz);

    samples.push({
      timestampUtc: new Date(epochMs).toISOString(),
      epochSeconds: epochMs / 1000,
      positionGcrsKm: [x, y, z],
      velocityGcrsKms: [vx, vy, vz],
    });
  }

  return samples;
}

const START_EPOCH_ISO = "2026-11-02T12:00:00.000Z";
const START_EPOCH_MS = new Date(START_EPOCH_ISO).getTime();
const TRAJECTORY_DURATION_MIN = 95; // Full orbit revolution (~92.9 min)
const TRAJECTORY_STEP_SEC = 60;

// 1. ISS (ZARYA) - NORAD 25544 Trajectory
const issSamples = generateCircularOrbitSamples(
  6797.35, // a = 6797.35 km (~419 km altitude)
  51.64,   // i = 51.64 deg
  339.47,  // RAAN
  334.82,  // Arg of perigee
  START_EPOCH_MS,
  TRAJECTORY_DURATION_MIN,
  TRAJECTORY_STEP_SEC
);

export const ISS_TRAJECTORY: VisualTrajectory = {
  id: "TRAJ-25544",
  name: "ISS (ZARYA) Demo Orbit Track",
  frame: "GCRS",
  isIllustrative: true,
  provenance: "Deterministic Circular Keplerian Ephemeris Fixture (Demo trajectory; not live SGP4 output)",
  color: "#06b6d4", // Cyan
  periodMinutes: 92.95,
  samples: issSamples,
};

export const ISS_SATELLITE: VisualSatellite = {
  id: "25544",
  noradCatId: "25544",
  name: "ISS (ZARYA)",
  classification: "Space Station (LEO)",
  epoch: START_EPOCH_ISO,
  frame: "GCRS",
  currentPositionKm: issSamples[0].positionGcrsKm,
  currentVelocityKms: issSamples[0].velocityGcrsKms || [0, 0, 0],
  isSynthetic: false,
  provenance: "CelesTrak Stations Snapshot Fixture (Demo telemetry)",
  trajectory: ISS_TRAJECTORY,
};

// 2. CSS (TIANHE) - NORAD 48274 Trajectory
const cssSamples = generateCircularOrbitSamples(
  6762.15, // a = 6762.15 km (~384 km altitude)
  41.47,   // i = 41.47 deg
  112.55,  // RAAN
  215.34,  // Arg of perigee
  START_EPOCH_MS,
  TRAJECTORY_DURATION_MIN,
  TRAJECTORY_STEP_SEC
);

export const CSS_TRAJECTORY: VisualTrajectory = {
  id: "TRAJ-48274",
  name: "CSS (TIANHE) Demo Orbit Track",
  frame: "GCRS",
  isIllustrative: true,
  provenance: "Deterministic Circular Keplerian Ephemeris Fixture (Demo trajectory; not live SGP4 output)",
  color: "#10b981", // Emerald
  periodMinutes: 92.23,
  samples: cssSamples,
};

export const CSS_SATELLITE: VisualSatellite = {
  id: "48274",
  noradCatId: "48274",
  name: "CSS (TIANHE)",
  classification: "Space Station (LEO)",
  epoch: START_EPOCH_ISO,
  frame: "GCRS",
  currentPositionKm: cssSamples[0].positionGcrsKm,
  currentVelocityKms: cssSamples[0].velocityGcrsKms || [0, 0, 0],
  isSynthetic: false,
  provenance: "CelesTrak Stations Snapshot Fixture (Demo telemetry)",
  trajectory: CSS_TRAJECTORY,
};

export const CATALOG_SATELLITES: VisualSatellite[] = [ISS_SATELLITE, CSS_SATELLITE];

// 3. Synthetic Debris Cloud (520 fragments)
// Deterministically dispersed in an orbital torus around a breakup event near ISS orbit
function generateSyntheticDebrisCloud(count = 520): VisualFragment[] {
  const rng = new DeterministicRng(4206911);
  const fragments: VisualFragment[] = [];

  const basePos = issSamples[18].positionGcrsKm; // Encounter location at t = 18 mins
  const baseVel = issSamples[18].velocityGcrsKms || [0, 7.67, 0];

  for (let i = 1; i <= count; i++) {
    const pad = String(i).padStart(4, "0");
    const fragId = `SYNTH-FRAG-${pad}`;

    // Disperse position in a realistic fragmentation ellipsoid (sigma ~ 15-45 km)
    const u = rng.next();
    const v = rng.next();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const rSpreadKm = rng.nextRange(2.0, 48.0);

    const dx = rSpreadKm * Math.sin(phi) * Math.cos(theta);
    const dy = rSpreadKm * Math.sin(phi) * Math.sin(theta);
    const dz = rSpreadKm * Math.cos(phi);

    // Delta-V spread (10 m/s to 450 m/s -> 0.01 to 0.45 km/s)
    const dvMag = rng.nextRange(0.01, 0.45);
    const dvx = dvMag * Math.sin(phi) * Math.cos(theta);
    const dvy = dvMag * Math.sin(phi) * Math.sin(theta);
    const dvz = dvMag * Math.cos(phi);

    // Fragment mass (power-law distribution, 0.05 kg to 38.0 kg)
    const massKg = Math.round((0.05 + Math.pow(rng.next(), 3) * 38.0) * 100) / 100;

    fragments.push({
      id: fragId,
      name: `Illustrative Debris Marker #${pad}`,
      positionGcrsKm: [basePos[0] + dx, basePos[1] + dy, basePos[2] + dz],
      velocityGcrsKms: [baseVel[0] + dvx, baseVel[1] + dvy, baseVel[2] + dvz],
      massKg,
      isSynthetic: true,
      provenance: "Visual Demonstration Debris Cloud (520 markers; illustrative demo, not Day 8/Day 9 simulation output)",
    });
  }

  return fragments;
}

export const SYNTHETIC_DEBRIS_CLOUD: VisualFragment[] = generateSyntheticDebrisCloud(520);

