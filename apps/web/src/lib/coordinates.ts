/**
 * COLLIVRA Astrodynamics & Three.js Coordinate Transformations
 *
 * Implements display-axis mapping between the Inertial Geocentric Celestial
 * Reference System (GCRS) and Three.js right-handed display coordinates.
 *
 * Mathematical Transformation:
 * Physical GCRS Cartesian coordinates (km): (x, y, z)
 * Display coordinates (Three.js units, where 1 unit = 1000 km):
 *   X_Three =  x / 1000   (points toward the vernal equinox)
 *   Y_Three =  z / 1000   (points along GCRS +Z, approximating the celestial rotation axis)
 *   Z_Three = -y / 1000   (completes the right-handed Cartesian display system)
 *
 * Scientific & Reference Frame Principles (AGENTS.md & Milestones 3.1 - 3.2):
 * - GCRS is an EQUATORIAL inertial reference system (IAU 2000). Its fundamental reference
 *   plane is the mean celestial equator at J2000.0, and +Z_GCRS is the ICRS/GCRS reference pole.
 * - Earth's rotational spin axis is simplified to align with +Z_GCRS (Three.js +Y: [0, 1, 0])
 *   as an approximation for 3D visualization.
 * - This visualization does NOT claim that GCRS +Z is exactly aligned with the instantaneous
 *   Celestial Intermediate Pole (CIP). Rigorous, time-dependent precession, nutation, polar motion
 *   (xp, yp), and CIP celestial motion corrections are NOT implemented in this frontend visualizer.
 * - Earth rotation in the 3D scene is driven by a simplified constant-rate angular velocity
 *   (nominal WGS-84 rate). It does NOT calculate precise Greenwich Apparent/Mean Sidereal Time
 *   (GAST/GMST) or UT1-based Earth Rotation Angle (ERA(UT1)), nor does it apply delta UT1 corrections.
 * - Ecliptic obliquity (approx. 23.439°) is the angle between the equatorial plane and the
 *   ecliptic plane (Earth's heliocentric orbital plane). In an equatorial frame like GCRS,
 *   obliquity is NOT an axis tilt relative to the celestial equator and is not applied to the spin axis.
 * - Earth rotates independently about its polar axis (+Y in Three.js, +Z in GCRS).
 * - Inertial satellite orbits, trajectories, and debris remain fixed in GCRS and DO NOT
 *   rotate with Earth.
 * - Units: km for physics, Three.js world units for rendering (1 unit = 1000 km).
 */

import type { CoordinateFrame } from "../types/api";

/** Standard Astrodynamical Constants (WGS-84) */
export const EARTH_RADIUS_KM = 6378.137;
export const SCALE_KM_PER_UNIT = 1000.0;
export const EARTH_RADIUS_DISPLAY = EARTH_RADIUS_KM / SCALE_KM_PER_UNIT; // ~6.378137 units

/** Atmospheric interface threshold: 100 km above WGS-84 equatorial radius */
export const ATMOSPHERE_INTERFACE_KM = 6478.137;
export const ATMOSPHERE_INTERFACE_DISPLAY = ATMOSPHERE_INTERFACE_KM / SCALE_KM_PER_UNIT; // ~6.478137 units

/**
 * Earth celestial rotational pole in Inertial GCRS coordinates (Visualization Approximation).
 *
 * Scientific Modeling Clarification (Milestone 3.2):
 * - Simplified alignment vector pointing along the GCRS +Z unit vector [0, 0, 1].
 * - This alignment is an approximation for 3D visualization. GCRS +Z is the ICRS/GCRS
 *   reference pole at J2000.0, not the instantaneous Celestial Intermediate Pole (CIP).
 * - Time-dependent precession, nutation, and polar motion corrections are not implemented.
 */
export const GCRS_CELESTIAL_POLE_VECTOR: [number, number, number] = [0, 0, 1];

/**
 * Earth rotational axis in Three.js display coordinates (Visualization Approximation).
 * Under the display mapping (Y_Three = Z_GCRS / 1000), Earth's rotational axis
 * is mapped to the Three.js +Y unit vector [0, 1, 0].
 */
export const THREE_EARTH_ROTATION_AXIS: [number, number, number] = [0, 1, 0];

/**
 * Earth rotational axis tilt relative to GCRS +Z in the simplified visualization model.
 * In this simplified equatorial model, Earth's rotational axis is approximated as having
 * zero tilt (0.0 rad, 0.0 deg) relative to GCRS +Z.
 *
 * Scientific Note on Ecliptic Obliquity:
 * Ecliptic obliquity (approx. 23.439°) is the angle between Earth's equatorial plane
 * and the ecliptic plane. In an equatorial system like GCRS, this obliquity is NOT
 * applied to Earth's rotational axis. Time-dependent obliquity, precession, and nutation
 * are not modeled here.
 */
export const GCRS_EARTH_AXIS_TILT_RAD = 0.0;
export const GCRS_EARTH_AXIS_TILT_DEG = 0.0;

/**
 * Nominal Earth rotation rate for illustrative visualization (rad/s, WGS-84 nominal).
 *
 * Scientific Modeling Clarification (Milestone 3.2):
 * - This constant angular velocity (7.2921159e-5 rad/s) is used solely for smooth
 *   illustrative visual rotation in the 3D scene.
 * - It does NOT calculate precise Greenwich Apparent/Mean Sidereal Time (GAST/GMST)
 *   or Earth Rotation Angle (ERA).
 * - UT1-based Earth Rotation Angle (ERA(UT1)), delta UT1 (UT1 - UTC) corrections,
 *   and full IERS Earth-orientation parameters are NOT implemented in this frontend visualizer.
 */
export const EARTH_ROTATION_RATE_RAD_PER_SEC = 7.2921159e-5;

export interface CartesianVector3 {
  x: number;
  y: number;
  z: number;
}

export interface ThreeVector3Tuple {
  0: number;
  1: number;
  2: number;
}

/**
 * Validates that coordinate numbers are finite and not NaN.
 */
export function assertFiniteCoordinates(x: number, y: number, z: number, context = "coordinates"): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(
      `Invalid ${context}: [${x}, ${y}, ${z}] contains non-finite or NaN components.`
    );
  }
}

/**
 * Validates that input frame is Inertial GCRS/GCRF.
 * Throws an explicit error if a non-inertial or TEME frame is supplied.
 */
export function assertInertialGcrsFrame(frame: CoordinateFrame): void {
  if (frame !== "GCRS" && frame !== "GCRF") {
    throw new Error(
      `Invalid coordinate frame: '${frame}'. Three.js display mapping strictly requires inertial GCRS/GCRF. ` +
      `Raw SGP4 TEME or terrestrial ITRS must first be converted via centralized astrodynamics routines.`
    );
  }
}

/**
 * Maps a GCRS position vector (km) to Three.js display coordinates (units).
 *
 * Three.js convention:
 * X_three = x_gcrs / 1000
 * Y_three = z_gcrs / 1000  (celestial north pole)
 * Z_three = -y_gcrs / 1000
 */
export function gcrsToThreePosition(
  xKm: number,
  yKm: number,
  zKm: number,
  frame: CoordinateFrame = "GCRS"
): [number, number, number] {
  assertInertialGcrsFrame(frame);
  assertFiniteCoordinates(xKm, yKm, zKm, "GCRS position");

  return [
    xKm / SCALE_KM_PER_UNIT,
    zKm / SCALE_KM_PER_UNIT,
    -yKm / SCALE_KM_PER_UNIT,
  ];
}

/**
 * Maps a Three.js display coordinate back to physical GCRS coordinates (km).
 */
export function threeToGcrsPosition(
  xThree: number,
  yThree: number,
  zThree: number
): [number, number, number] {
  assertFiniteCoordinates(xThree, yThree, zThree, "Three.js position");

  return [
    xThree * SCALE_KM_PER_UNIT,
    -zThree * SCALE_KM_PER_UNIT,
    yThree * SCALE_KM_PER_UNIT,
  ];
}

/**
 * Computes altitude in kilometers above WGS-84 equatorial radius from GCRS position.
 */
export function calculateAltitudeKm(xKm: number, yKm: number, zKm: number): number {
  assertFiniteCoordinates(xKm, yKm, zKm, "position for altitude");
  const r = Math.sqrt(xKm * xKm + yKm * yKm + zKm * zKm);
  return r - EARTH_RADIUS_KM;
}

/**
 * Computes speed in kilometers per second from Cartesian velocity.
 */
export function calculateSpeedKms(vx: number, vy: number, vz: number): number {
  assertFiniteCoordinates(vx, vy, vz, "velocity for speed");
  return Math.sqrt(vx * vx + vy * vy + vz * vz);
}

/**
 * Checks whether an orbital position is inside the atmospheric interface boundary (< 6478.137 km).
 */
export function isAtmosphericReentry(xKm: number, yKm: number, zKm: number): boolean {
  assertFiniteCoordinates(xKm, yKm, zKm, "position for reentry check");
  const r = Math.sqrt(xKm * xKm + yKm * yKm + zKm * zKm);
  return r < ATMOSPHERE_INTERFACE_KM;
}

/**
 * Interpolates position between two timestamped GCRS samples.
 * Strict guardrail: Does NOT extrapolate if targetTime is outside [t1, t2].
 */
export function interpolateGcrsPosition(
  t1Ms: number,
  pos1Km: [number, number, number],
  t2Ms: number,
  pos2Km: [number, number, number],
  targetTimeMs: number
): [number, number, number] | null {
  if (t2Ms <= t1Ms) {
    return pos1Km;
  }

  // Strict no-extrapolation rule
  if (targetTimeMs < t1Ms || targetTimeMs > t2Ms) {
    return null;
  }

  const alpha = (targetTimeMs - t1Ms) / (t2Ms - t1Ms);

  return [
    pos1Km[0] + alpha * (pos2Km[0] - pos1Km[0]),
    pos1Km[1] + alpha * (pos2Km[1] - pos1Km[1]),
    pos1Km[2] + alpha * (pos2Km[2] - pos1Km[2]),
  ];
}

/**
 * Calculates the terminal chaser arrival position in Three.js display space [I, R, C] meters.
 *
 * For STANDOFF_HOLD: V-bar trailing standoff along negative In-Track (X_Three).
 * For CONTACT_INTERCEPT: Terminal contact position at target origin [0, 0, 0].
 */
export function calculateArrivalPosition(
  targetingMode?: string,
  standoffDistanceM?: number
): [number, number, number] {
  if (targetingMode === "CONTACT_INTERCEPT") {
    return [0, 0, 0];
  }
  const dist = standoffDistanceM ?? 50.0;
  return [-dist, 0, 0];
}

/**
 * Analytical Clohessy-Wiltshire (Hill/RIC) initial departure velocity solver.
 *
 * Computes the post-Burn-1 relative velocity \dot{\rho}_0^+ = [v_I, v_R, v_C]
 * required to transfer from initialDisplayPos to terminalDisplayPos in transferTimeS
 * seconds under chief mean motion meanMotionRadS.
 *
 * Mapped to Three.js display space:
 * - X_Three = In-Track velocity (v_I, m/s)
 * - Y_Three = Radial velocity (v_R, m/s)
 * - Z_Three = Cross-Track velocity (v_C, m/s)
 */
export function computeCwDepartureVelocity(
  initialDisplayPos: [number, number, number],
  terminalDisplayPos: [number, number, number],
  meanMotionRadS: number,
  transferTimeS: number
): [number, number, number] {
  if (transferTimeS <= 0 || meanMotionRadS <= 0) {
    return [0, 0, 0];
  }

  // Display space is [I, R, C]
  const I0 = initialDisplayPos[0];
  const R0 = initialDisplayPos[1];
  const C0 = initialDisplayPos[2];

  const If = terminalDisplayPos[0];
  const Rf = terminalDisplayPos[1];
  const Cf = terminalDisplayPos[2];

  const n = meanMotionRadS;
  const tau_f = transferTimeS;

  const sf = Math.sin(n * tau_f);
  const cf = Math.cos(n * tau_f);
  const af = n * tau_f;

  // Invert 2x2 in-plane Phi_rv submatrix:
  // [ R(tau) ] = [ 4 - 3c       0 ] [ R0 ] + [ s/n             2(1-c)/n           ] [ vR0 ]
  // [ I(tau) ]   [ 6(s - nt)    1 ] [ I0 ]   [ 2(c-1)/n        (4s - 3nt)/n       ] [ vI0 ]
  const bR = Rf - (4.0 - 3.0 * cf) * R0;
  const bI = If - 6.0 * (sf - af) * R0 - I0;

  const M00 = sf / n;
  const M01 = (2.0 * (1.0 - cf)) / n;
  const M10 = (2.0 * (cf - 1.0)) / n;
  const M11 = (4.0 * sf - 3.0 * af) / n;

  const det = M00 * M11 - M01 * M10;

  let vR0 = 0.0;
  let vI0 = 0.0;
  if (Math.abs(det) > 1e-12) {
    vR0 = (M11 * bR - M01 * bI) / det;
    vI0 = (-M10 * bR + M00 * bI) / det;
  }

  // Out-of-plane cross-track inversion:
  // C(tau) = c * C0 + (s/n) * vC0
  let vC0 = 0.0;
  if (Math.abs(sf) > 1e-12) {
    vC0 = (Cf - cf * C0) / (sf / n);
  }

  return [vI0, vR0, vC0];
}

/**
 * Analytical Clohessy-Wiltshire (Hill/RIC) relative motion trajectory generator.
 *
 * Evaluates the analytical state transition matrix Phi(tau) for N intermediate
 * samples between departure (t0) and arrival (tf).
 *
 * Mapped to Three.js display space:
 * - X_Three = In-Track (I, meters)
 * - Y_Three = Radial (R, meters)
 * - Z_Three = Cross-Track (C, meters)
 */
export function computeCwTrajectoryPoints(
  initialDisplayPos: [number, number, number],
  terminalDisplayPos: [number, number, number],
  meanMotionRadS: number,
  transferTimeS: number,
  numSamples: number = 50
): [number, number, number][] {
  if (numSamples < 2 || transferTimeS <= 0 || meanMotionRadS <= 0) {
    return [initialDisplayPos, terminalDisplayPos];
  }

  // Display space is [I, R, C]
  const I0 = initialDisplayPos[0];
  const R0 = initialDisplayPos[1];
  const C0 = initialDisplayPos[2];

  const n = meanMotionRadS;
  const tau_f = transferTimeS;

  const [vI0, vR0, vC0] = computeCwDepartureVelocity(
    initialDisplayPos,
    terminalDisplayPos,
    meanMotionRadS,
    transferTimeS
  );

  const points: [number, number, number][] = [];
  for (let k = 0; k < numSamples; k++) {
    const tau = (k / (numSamples - 1)) * tau_f;
    const s = Math.sin(n * tau);
    const c = Math.cos(n * tau);
    const a = n * tau;

    const R = (4.0 - 3.0 * c) * R0 + (s / n) * vR0 + ((2.0 * (1.0 - c)) / n) * vI0;
    const I = 6.0 * (s - a) * R0 + I0 + ((2.0 * (c - 1.0)) / n) * vR0 + ((4.0 * s - 3.0 * a) / n) * vI0;
    const C = c * C0 + (s / n) * vC0;

    points.push([I, R, C]);
  }

  points[0] = [...initialDisplayPos];
  points[points.length - 1] = [...terminalDisplayPos];

  return points;
}
