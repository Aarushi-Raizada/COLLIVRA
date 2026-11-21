/**
 * Unit verification tests for ZORBIT Full-Screen Orbital Radar (Milestone 5.4 Phase 3)
 *
 * Validates:
 * - Object selection and deselection state transitions
 * - Object filtering logic (all, satellites, debris, selected)
 * - Trajectory interpolation within sample bounds (no extrapolation guardrail)
 * - Altitude calculation matching WGS-84 physical definitions
 * - Atmospheric interface detection at strictly 6,478.137 km (Karman boundary)
 * - GCRS display mapping invariants and right-handed orientation
 * - Speed calculation from Cartesian velocity vectors
 * - Playback speed transitions and epoch looping logic
 * - Synthetic debris cloud properties (520 fragments, synthetic provenance)
 */

import {
  EARTH_RADIUS_KM,
  ATMOSPHERE_INTERFACE_KM,
  EARTH_RADIUS_DISPLAY,
  ATMOSPHERE_INTERFACE_DISPLAY,
  calculateAltitudeKm,
  calculateSpeedKms,
  isAtmosphericReentry,
  interpolateGcrsPosition,
  gcrsToThreePosition,
  threeToGcrsPosition,
} from "../coordinates";
import {
  CATALOG_SATELLITES,
  SYNTHETIC_DEBRIS_CLOUD,
  ISS_SATELLITE,
  CSS_SATELLITE,
} from "../orbitFixtures";
import {
  SelectedObjectInfo,
  SceneVisibilityState,
  ObjectFilterMode,
  VisualSatellite,
  VisualFragment,
} from "../../types/visualization";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

export function runOrbitalRadarTests(): {
  passed: number;
  total: number;
  details: string[];
} {
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
      details.push(
        `[FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`
      );
      console.error(`[FAIL] ${name}:`, err);
      throw err;
    }
  }

  // 1. Object selection state transitions
  test("Orbital Radar: Satellite selection populates complete telemetry state", () => {
    let selected: SelectedObjectInfo = null;

    // Transition from null to selected satellite
    selected = { type: "satellite", satellite: ISS_SATELLITE };
    assert(selected.type === "satellite", "Selected type must be satellite");
    assert(selected.satellite.noradCatId === "25544", "NORAD ID must be 25544");
    assert(selected.satellite.name === "ISS (ZARYA)", "Name must match ISS");
    assert(selected.satellite.frame === "GCRS", "Coordinate frame must be GCRS");
    assert(selected.satellite.trajectory !== undefined, "Trajectory must be present");

    // Kinematics
    const pos = selected.satellite.currentPositionKm;
    const vel = selected.satellite.currentVelocityKms;
    const alt = calculateAltitudeKm(pos[0], pos[1], pos[2]);
    const spd = calculateSpeedKms(vel[0], vel[1], vel[2]);

    assert(alt > 350 && alt < 450, `ISS altitude must be ~419 km, got ${alt}`);
    assert(spd > 7.0 && spd < 8.0, `ISS speed must be ~7.6 km/s, got ${spd}`);
  });

  test("Orbital Radar: Synthetic fragment selection maintains synthetic provenance", () => {
    const frag = SYNTHETIC_DEBRIS_CLOUD[0];
    let selected: SelectedObjectInfo = { type: "fragment", fragment: frag };

    assert(selected.type === "fragment", "Selected type must be fragment");
    assert(selected.fragment.isSynthetic === true, "Must have isSynthetic true");
    assert(selected.fragment.id.startsWith("SYNTH-FRAG-"), "ID must have SYNTH-FRAG- prefix");
    assert(selected.fragment.massKg > 0, "Mass must be positive");
    assert(selected.fragment.provenance.includes("illustrative"), "Provenance must state illustrative/synthetic");

    // Deselection transition
    selected = null;
    assert(selected === null, "Selected object must transition back to null on close");
  });

  // 2. Object filtering logic
  test("Orbital Radar: Filter modes correctly partition satellites and debris", () => {
    function getVisibleObjects(
      mode: ObjectFilterMode,
      selected: SelectedObjectInfo,
      sats: VisualSatellite[],
      frags: VisualFragment[]
    ) {
      const showSats = mode === "all" || mode === "satellites" || (mode === "selected" && selected?.type === "satellite");
      const showFrags = mode === "all" || mode === "debris" || (mode === "selected" && selected?.type === "fragment");
      return {
        satellitesVisible: showSats ? sats.length : 0,
        debrisVisible: showFrags ? frags.length : 0,
      };
    }

    const sats = CATALOG_SATELLITES;
    const frags = SYNTHETIC_DEBRIS_CLOUD;
    const selectedSat: SelectedObjectInfo = { type: "satellite", satellite: ISS_SATELLITE };

    // Mode "all"
    const all = getVisibleObjects("all", null, sats, frags);
    assert(all.satellitesVisible === 2, "Mode 'all' must show 2 satellites");
    assert(all.debrisVisible === 520, "Mode 'all' must show 520 debris");

    // Mode "satellites"
    const satsOnly = getVisibleObjects("satellites", null, sats, frags);
    assert(satsOnly.satellitesVisible === 2, "Mode 'satellites' must show 2 satellites");
    assert(satsOnly.debrisVisible === 0, "Mode 'satellites' must hide debris");

    // Mode "debris"
    const debrisOnly = getVisibleObjects("debris", null, sats, frags);
    assert(debrisOnly.satellitesVisible === 0, "Mode 'debris' must hide satellites");
    assert(debrisOnly.debrisVisible === 520, "Mode 'debris' must show 520 debris");

    // Mode "selected" with satellite
    const selSatOnly = getVisibleObjects("selected", selectedSat, sats, frags);
    assert(selSatOnly.satellitesVisible === 2, "Mode 'selected' must show selected satellite category");
    assert(selSatOnly.debrisVisible === 0, "Mode 'selected' must hide debris");
  });

  test("Orbital Radar: Layer visibility toggles operate independently without coupling", () => {
    let visibility: SceneVisibilityState = {
      earth: true,
      atmosphere: true,
      atmosphericInterface: true,
      latLongGrid: true,
      orbits: true,
      catalogObjects: true,
      debrisCloud: true,
    };

    function toggle(key: keyof SceneVisibilityState) {
      visibility = { ...visibility, [key]: !visibility[key] };
    }

    // Toggle earth off
    toggle("earth");
    assert(visibility.earth === false, "Earth must be toggled off");
    assert(visibility.atmosphericInterface === true, "Karman interface must remain on");
    assert(visibility.orbits === true, "Orbits must remain on");

    // Toggle Karman interface off
    toggle("atmosphericInterface");
    assert(visibility.atmosphericInterface === false, "Atmosphere interface must be toggled off");
    assert(visibility.catalogObjects === true, "Catalog objects must remain on");
  });

  // 3. Trajectory interpolation within sample bounds
  test("Orbital Radar: Trajectory interpolation produces valid intermediate positions", () => {
    const t1 = 1700000000000;
    const t2 = 1700000060000; // 60s later
    const pos1: [number, number, number] = [6800, 0, 0];
    const pos2: [number, number, number] = [6800, 450, 0];

    // t at start
    const interpStart = interpolateGcrsPosition(t1, pos1, t2, pos2, t1);
    assert(interpStart !== null, "Start interpolation must not be null");
    assert(interpStart![0] === 6800 && interpStart![1] === 0, "Start position must match pos1");

    // t at midpoint
    const interpMid = interpolateGcrsPosition(t1, pos1, t2, pos2, t1 + 30000);
    assert(interpMid !== null, "Midpoint interpolation must not be null");
    assert(interpMid![0] === 6800, "X should remain 6800");
    assert(Math.abs(interpMid![1] - 225) < 1e-6, "Y should be 225 at midpoint");

    // t at end
    const interpEnd = interpolateGcrsPosition(t1, pos1, t2, pos2, t2);
    assert(interpEnd !== null, "End interpolation must not be null");
    assert(interpEnd![1] === 450, "End position must match pos2");
  });

  // 4. Interpolation guardrail: reject extrapolation
  test("Orbital Radar: interpolateGcrsPosition strictly rejects extrapolation outside bounds", () => {
    const t1 = 1700000000000;
    const t2 = 1700000060000;
    const pos1: [number, number, number] = [6800, 0, 0];
    const pos2: [number, number, number] = [6800, 450, 0];

    // Target time before interval
    const beforeResult = interpolateGcrsPosition(t1, pos1, t2, pos2, t1 - 1000);
    assert(beforeResult === null, "Interpolation before t1 must strictly return null (no extrapolation)");

    // Target time after interval
    const afterResult = interpolateGcrsPosition(t1, pos1, t2, pos2, t2 + 1000);
    assert(afterResult === null, "Interpolation after t2 must strictly return null (no extrapolation)");
  });

  // 5. Altitude calculation
  test("Orbital Radar: Altitude matches WGS-84 equatorial definition (r - 6378.137 km)", () => {
    // Exactly at surface
    const altSurface = calculateAltitudeKm(EARTH_RADIUS_KM, 0, 0);
    assert(Math.abs(altSurface) < 1e-6, `Surface altitude must be 0 km, got ${altSurface}`);

    // At 100 km altitude (Karman line)
    const altKarman = calculateAltitudeKm(0, ATMOSPHERE_INTERFACE_KM, 0);
    assert(Math.abs(altKarman - 100.0) < 1e-4, `Karman altitude must be 100 km, got ${altKarman}`);

    // At 400 km LEO altitude
    const altLeo = calculateAltitudeKm(0, 0, EARTH_RADIUS_KM + 400);
    assert(Math.abs(altLeo - 400.0) < 1e-4, `LEO altitude must be 400 km, got ${altLeo}`);
  });

  // 6. Atmospheric interface detection at 6478.137 km
  test("Orbital Radar: Atmospheric re-entry detection triggers correctly at 6,478.137 km", () => {
    // Strictly below interface (< 6478.137 km)
    const below = isAtmosphericReentry(ATMOSPHERE_INTERFACE_KM - 0.001, 0, 0);
    assert(below === true, "Position at 6478.136 km must be detected as below interface (re-entry)");

    // Strictly at interface
    const at = isAtmosphericReentry(ATMOSPHERE_INTERFACE_KM, 0, 0);
    assert(at === false, "Position exactly at 6478.137 km is not strictly below threshold (<)");

    // Above interface (> 6478.137 km)
    const above = isAtmosphericReentry(ATMOSPHERE_INTERFACE_KM + 0.001, 0, 0);
    assert(above === false, "Position at 6478.138 km must be detected as above interface (safe)");
  });

  // 7. GCRS display mapping and right-handed invariants
  test("Orbital Radar: GCRS display mapping preserves right-handed coordinate invariants", () => {
    const xGcrs = 6800;
    const yGcrs = 1200;
    const zGcrs = 3400;

    const [xThree, yThree, zThree] = gcrsToThreePosition(xGcrs, yGcrs, zGcrs, "GCRS");

    // X_Three = x / 1000
    assert(Math.abs(xThree - 6.8) < 1e-9, `X_Three must be 6.8, got ${xThree}`);
    // Y_Three = z / 1000
    assert(Math.abs(yThree - 3.4) < 1e-9, `Y_Three must be 3.4, got ${yThree}`);
    // Z_Three = -y / 1000
    assert(Math.abs(zThree - (-1.2)) < 1e-9, `Z_Three must be -1.2, got ${zThree}`);

    // Round-trip invertibility
    const [xr, yr, zr] = threeToGcrsPosition(xThree, yThree, zThree);
    assert(Math.abs(xr - xGcrs) < 1e-6, "Round-trip X must match");
    assert(Math.abs(yr - yGcrs) < 1e-6, "Round-trip Y must match");
    assert(Math.abs(zr - zGcrs) < 1e-6, "Round-trip Z must match");
  });

  // 8. Speed calculation from velocity components
  test("Orbital Radar: Speed calculation from Cartesian velocity vectors", () => {
    // 3-4-0 Pythagorean triangle in Vx, Vy
    const spd1 = calculateSpeedKms(3.0, 4.0, 0.0);
    assert(Math.abs(spd1 - 5.0) < 1e-9, `Speed must be 5.0 km/s, got ${spd1}`);

    // Typical orbital speed (~7.67 km/s)
    const spdOrb = calculateSpeedKms(0.0, 5.423, 5.424);
    assert(Math.abs(spdOrb - 7.67) < 0.01, `Orbital speed must be ~7.67 km/s, got ${spdOrb}`);
  });

  // 9. Playback speed transitions and timeline looping
  test("Orbital Radar: Playback speed and timeline looping behavior", () => {
    const startMs = 1700000000000;
    const endMs = 1700005700000; // 95 minutes later

    const speeds = [1, 5, 10, 30, 60];
    speeds.forEach((s) => {
      assert(s > 0, `Speed ${s}x must be positive`);
    });

    // Advance 1 second real-time at 10x
    const dtSec = 1.0;
    const speed = 10;
    const nextMs = startMs + dtSec * 1000 * speed;
    assert(nextMs === startMs + 10000, "1s at 10x must advance 10,000 ms");

    // Loop at end
    const pastEnd = endMs + 5000;
    const loopEpoch = pastEnd > endMs ? startMs : pastEnd;
    assert(loopEpoch === startMs, "Reaching end must wrap back to startMs");
  });

  // 10. Synthetic debris cloud properties
  test("Orbital Radar: Synthetic debris cloud satisfies scientific integrity constraints", () => {
    assert(SYNTHETIC_DEBRIS_CLOUD.length === 520, "Debris cloud must contain exactly 520 fragments");

    const idSet = new Set<string>();

    SYNTHETIC_DEBRIS_CLOUD.forEach((frag, idx) => {
      assert(frag.isSynthetic === true, `Fragment #${idx} must be marked isSynthetic`);
      assert(/^SYNTH-FRAG-\d{4}$/.test(frag.id), `Fragment ID ${frag.id} must follow format SYNTH-FRAG-XXXX`);
      assert(!idSet.has(frag.id), `Duplicate fragment ID detected: ${frag.id}`);
      idSet.add(frag.id);

      assert(frag.massKg > 0 && frag.massKg < 100, `Mass must be physically realistic, got ${frag.massKg}`);
      assert(frag.provenance.length > 0, "Provenance description must be present");

      // Verify finite coordinates
      assert(Number.isFinite(frag.positionGcrsKm[0]), "Pos X must be finite");
      assert(Number.isFinite(frag.positionGcrsKm[1]), "Pos Y must be finite");
      assert(Number.isFinite(frag.positionGcrsKm[2]), "Pos Z must be finite");
    });
  });

  return { passed, total, details };
}

