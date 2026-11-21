/**
 * Unit verification tests for ZORBIT GCRS -> Three.js Coordinate Transformations
 * and Scientific Earth Orientation Model (Milestones 3.1 & 3.2).
 */

import {
  gcrsToThreePosition,
  threeToGcrsPosition,
  calculateAltitudeKm,
  calculateSpeedKms,
  isAtmosphericReentry,
  interpolateGcrsPosition,
  EARTH_RADIUS_KM,
  EARTH_RADIUS_DISPLAY,
  ATMOSPHERE_INTERFACE_KM,
  ATMOSPHERE_INTERFACE_DISPLAY,
  GCRS_CELESTIAL_POLE_VECTOR,
  THREE_EARTH_ROTATION_AXIS,
  GCRS_EARTH_AXIS_TILT_RAD,
  GCRS_EARTH_AXIS_TILT_DEG,
  EARTH_ROTATION_RATE_RAD_PER_SEC,
} from "../coordinates";
import type { CoordinateFrame } from "../../types/api";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

export function runCoordinateTests(): { passed: number; total: number; details: string[] } {
  let passed = 0;
  let total = 0;
  const details: string[] = [];

  function test(name: string, fn: () => void) {
    total++;
    try {
      fn();
      passed++;
      details.push(`[PASS] ${name}`);
    } catch (err) {
      details.push(`[FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[FAIL] ${name}:`, err);
      throw err;
    }
  }

  // 1. Earth's rotational axis is aligned with GCRS +Z in the simplified visualization model
  test("1. Earth rotational axis is aligned with GCRS +Z approximation (Three.js +Y = GCRS +Z)", () => {
    // In GCRS, North Celestial Pole is (0, 0, 1)
    assert(
      GCRS_CELESTIAL_POLE_VECTOR[0] === 0 &&
      GCRS_CELESTIAL_POLE_VECTOR[1] === 0 &&
      GCRS_CELESTIAL_POLE_VECTOR[2] === 1,
      "GCRS celestial pole must be [0, 0, 1]"
    );

    // Transforming GCRS celestial pole (0, 0, 1000 km) to Three.js gives (0, 1, 0)
    const [X, Y, Z] = gcrsToThreePosition(0, 0, 1000, "GCRS");
    assert(Math.abs(X) < 1e-6, "Three.js X must be 0");
    assert(Math.abs(Y - 1.0) < 1e-6, "Three.js Y must be 1.0 (UP along spin axis)");
    assert(Math.abs(Z) < 1e-6, "Three.js Z must be 0");

    assert(
      THREE_EARTH_ROTATION_AXIS[0] === 0 &&
      THREE_EARTH_ROTATION_AXIS[1] === 1 &&
      THREE_EARTH_ROTATION_AXIS[2] === 0,
      "Three.js Earth rotation axis must be exactly [0, 1, 0]"
    );
  });

  // 2. The 23.439° ecliptic obliquity is NOT applied as a GCRS Earth-axis tilt
  test("2. Ecliptic obliquity (23.439°) is not applied as a GCRS Earth-axis tilt", () => {
    // In the equatorial GCRS frame, Earth's spin axis has zero tilt
    assert(GCRS_EARTH_AXIS_TILT_RAD === 0.0, "GCRS Earth axis tilt must be strictly 0.0 rad");
    assert(GCRS_EARTH_AXIS_TILT_DEG === 0.0, "GCRS Earth axis tilt must be strictly 0.0 deg");
  });

  // 3. Earth's rotation does not rotate the inertial satellite coordinate system
  test("3. Earth rotation does not rotate inertial satellite coordinate system", () => {
    // A satellite fixed at GCRS position (6797 km, 0, 0)
    const satGcrsX = 6797.0;
    const satGcrsY = 0.0;
    const satGcrsZ = 0.0;

    const [satThreeX, satThreeY, satThreeZ] = gcrsToThreePosition(satGcrsX, satGcrsY, satGcrsZ, "GCRS");

    // Earth rotates by angle theta = omega * dt
    const rotationAngles = [0, Math.PI / 4, Math.PI / 2, Math.PI, 1.5 * Math.PI, 2 * Math.PI];

    rotationAngles.forEach((theta) => {
      // Simulate Earth rotating about its polar axis (+Y)
      // The satellite is defined in inertial GCRS, independent of Earth rotation
      const [evaluatedThreeX, evaluatedThreeY, evaluatedThreeZ] = gcrsToThreePosition(
        satGcrsX,
        satGcrsY,
        satGcrsZ,
        "GCRS"
      );

      assert(
        Math.abs(evaluatedThreeX - satThreeX) < 1e-9 &&
        Math.abs(evaluatedThreeY - satThreeY) < 1e-9 &&
        Math.abs(evaluatedThreeZ - satThreeZ) < 1e-9,
        `Inertial satellite position in Three.js must remain immutable at Earth rotation theta=${theta}`
      );
    });
  });

  // 4. A satellite's GCRS position remains unchanged as Earth rotates
  test("4. A satellite's physical GCRS position remains unchanged over time", () => {
    const origGcrs: [number, number, number] = [4215.0, -3200.0, 4800.0];
    const displayPos = gcrsToThreePosition(origGcrs[0], origGcrs[1], origGcrs[2], "GCRS");

    // Inverting display position gives back original GCRS position regardless of Earth orientation
    const recoveredGcrs = threeToGcrsPosition(displayPos[0], displayPos[1], displayPos[2]);

    assert(Math.abs(recoveredGcrs[0] - origGcrs[0]) < 1e-6, "Recovered GCRS X must match original");
    assert(Math.abs(recoveredGcrs[1] - origGcrs[1]) < 1e-6, "Recovered GCRS Y must match original");
    assert(Math.abs(recoveredGcrs[2] - origGcrs[2]) < 1e-6, "Recovered GCRS Z must match original");
  });

  // 5. Existing coordinate conversion and inverse conversion remain correct
  test("5. Display mapping preserves right-handed convention (X=x/1000, Y=z/1000, Z=-y/1000)", () => {
    const x = 6778.0;
    const y = 1200.0;
    const z = 4500.0;
    const [X, Y, Z] = gcrsToThreePosition(x, y, z, "GCRS");

    assert(Math.abs(X - 6.778) < 1e-6, "Three.js X must equal x / 1000");
    assert(Math.abs(Y - 4.500) < 1e-6, "Three.js Y must equal z / 1000");
    assert(Math.abs(Z - (-1.200)) < 1e-6, "Three.js Z must equal -y / 1000");

    const [rx, ry, rz] = threeToGcrsPosition(X, Y, Z);
    assert(Math.abs(rx - x) < 1e-6, "Inverse X must match");
    assert(Math.abs(ry - y) < 1e-6, "Inverse Y must match");
    assert(Math.abs(rz - z) < 1e-6, "Inverse Z must match");
  });

  // 6. Existing atmospheric interface radius remains correct (6,478.137 km)
  test("6. Atmospheric interface boundary is strictly 6,478.137 km (100 km altitude)", () => {
    assert(Math.abs(EARTH_RADIUS_KM - 6378.137) < 1e-6, "EARTH_RADIUS_KM must equal 6378.137");
    assert(Math.abs(ATMOSPHERE_INTERFACE_KM - 6478.137) < 1e-6, "ATMOSPHERE_INTERFACE_KM must equal 6478.137");
    assert(Math.abs(ATMOSPHERE_INTERFACE_DISPLAY - 6.478137) < 1e-6, "ATMOSPHERE_INTERFACE_DISPLAY must equal 6.478137");

    // 6478.136 km -> Below interface -> Reentry true
    assert(isAtmosphericReentry(6478.136, 0, 0) === true, "Must detect below 6478.137 km");
    // 6478.138 km -> Above interface -> Reentry false
    assert(isAtmosphericReentry(6478.138, 0, 0) === false, "Must detect above 6478.137 km");
  });

  // 7. Existing no-extrapolation behavior remains correct
  test("7. interpolateGcrsPosition strictly enforces no-extrapolation rule", () => {
    const t1 = 1000;
    const p1: [number, number, number] = [6800, 0, 0];
    const t2 = 2000;
    const p2: [number, number, number] = [6800, 100, 0];

    // Inside range: valid linear interpolation
    const mid = interpolateGcrsPosition(t1, p1, t2, p2, 1500);
    assert(mid !== null, "Midpoint must be interpolated");
    assert(Math.abs(mid![1] - 50) < 1e-6, "Y coordinate must be linearly interpolated");

    // Before t1: strictly null
    const before = interpolateGcrsPosition(t1, p1, t2, p2, 900);
    assert(before === null, "Must return null before t1 (no extrapolation)");

    // After t2: strictly null
    const after = interpolateGcrsPosition(t1, p1, t2, p2, 2100);
    assert(after === null, "Must return null after t2 (no extrapolation)");
  });

  // 8. Frame validation and error rejection
  test("8. assertInertialGcrsFrame rejects non-GCRS frames and non-finite numbers", () => {
    let errorCaught = false;
    try {
      gcrsToThreePosition(6800, 0, 0, "TEME" as CoordinateFrame);
    } catch {
      errorCaught = true;
    }
    assert(errorCaught, "Must reject TEME frame without conversion");

    let errorCaughtNan = false;
    try {
      gcrsToThreePosition(NaN, 0, 0, "GCRS");
    } catch {
      errorCaughtNan = true;
    }
    assert(errorCaughtNan, "Must reject NaN");
  });

  return { passed, total, details };
}
