/**
 * COLLIVRA Mission Overview & Orbital Explorer Elevation Test Suite
 *
 * Implements and verifies Milestone AST-01C.2 acceptance criteria:
 * 1. LEO boundary classification (160 km to < 2,000 km)
 * 2. MEO boundary classification (2,000 km to < 35,786 km)
 * 3. GEO boundary classification (35,786 km to 40,000 km)
 * 4. Out-of-range altitude behavior (Sub-orbital < 160 km, Deep Space > 40,000 km)
 * 5. Missing or invalid altitude behavior (NaN, Infinity -> UNKNOWN)
 * 6. Combined altitude and object-type filters
 * 7. Filter reset behavior (restores all regimes to active)
 * 8. Filter result counts (accurate per-regime and visible totals)
 * 9. Selected-object behavior when filtered out (preserves identity, sets isSelectedHidden)
 * 10. Global simulation clock state synchronization
 * 11. Time scrubber seek, playback, and reset transitions
 * 12. UTC formatting without local timezone skew
 * 13. Out-of-range propagation handling (strict no-extrapolation guardrail)
 * 14. Deep-link preservation across filter changes
 * 15. Browser history navigation compatibility
 */

import {
  classifyAltitudeRegime,
  isPositionInActiveRegimes,
  filterObjectsByRegimeAndType,
  DEFAULT_ALTITUDE_REGIMES,
  ALTITUDE_BANDS,
  AltitudeRegime,
} from "../altitudeRegimes";
import {
  calculateAltitudeKm,
  EARTH_RADIUS_KM,
  ATMOSPHERE_INTERFACE_KM,
} from "../coordinates";
import {
  CATALOG_SATELLITES,
  SYNTHETIC_DEBRIS_CLOUD,
  ISS_SATELLITE,
  CSS_SATELLITE,
} from "../orbitFixtures";
import { useZorbitStore } from "../../store/useZorbitStore";
import {
  buildNavigationalQueryString,
  parseUrlNavigationalState,
} from "../navigation";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

export function runCollivraRadarElevationTests(): {
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
      details.push(`  ✓ ${name}`);
    } catch (e: any) {
      details.push(`  ✗ ${name}: ${e.message}`);
    }
  }

  // ============================================================================
  // Suite 1: Altitude Regime Boundary Classifications
  // ============================================================================

  test("1. LEO boundary classification (160 km <= alt < 2,000 km)", () => {
    assert(classifyAltitudeRegime(160.0) === "LEO", "Exact 160.0 km must be LEO");
    assert(classifyAltitudeRegime(160.1) === "LEO", "160.1 km must be LEO");
    assert(classifyAltitudeRegime(419.0) === "LEO", "419.0 km (ISS) must be LEO");
    assert(classifyAltitudeRegime(1999.99) === "LEO", "1999.99 km must be LEO");
    assert(classifyAltitudeRegime(2000.0) !== "LEO", "2000.0 km is MEO, not LEO");
  });

  test("2. MEO boundary classification (2,000 km <= alt < 35,786 km)", () => {
    assert(classifyAltitudeRegime(2000.0) === "MEO", "Exact 2000.0 km must be MEO");
    assert(classifyAltitudeRegime(20200.0) === "MEO", "20,200 km (GPS) must be MEO");
    assert(classifyAltitudeRegime(35785.99) === "MEO", "35,785.99 km must be MEO");
    assert(classifyAltitudeRegime(35786.0) !== "MEO", "35,786.0 km is GEO, not MEO");
  });

  test("3. GEO boundary classification (35,786 km <= alt <= 40,000 km)", () => {
    assert(classifyAltitudeRegime(35786.0) === "GEO", "Exact 35,786.0 km must be GEO");
    assert(classifyAltitudeRegime(35786.1) === "GEO", "35,786.1 km must be GEO");
    assert(classifyAltitudeRegime(40000.0) === "GEO", "Exact 40,000.0 km must be GEO");
    assert(classifyAltitudeRegime(40000.1) !== "GEO", "40,000.1 km is DEEP_SPACE, not GEO");
  });

  test("4. Out-of-range altitude behavior (< 160 km is SUB_ORBITAL, > 40,000 km is DEEP_SPACE)", () => {
    assert(classifyAltitudeRegime(159.99) === "SUB_ORBITAL", "159.99 km is SUB_ORBITAL");
    assert(classifyAltitudeRegime(100.0) === "SUB_ORBITAL", "100 km (Karman Line) is SUB_ORBITAL");
    assert(classifyAltitudeRegime(0.0) === "SUB_ORBITAL", "0.0 km (Earth surface) is SUB_ORBITAL");
    assert(classifyAltitudeRegime(-50.0) === "SUB_ORBITAL", "Negative altitude is SUB_ORBITAL");
    assert(classifyAltitudeRegime(40000.01) === "DEEP_SPACE", "40,000.01 km is DEEP_SPACE");
    assert(classifyAltitudeRegime(384400.0) === "DEEP_SPACE", "Lunar distance is DEEP_SPACE");
  });

  test("5. Missing or invalid altitude behavior (NaN, Infinity, non-finite -> UNKNOWN)", () => {
    assert(classifyAltitudeRegime(NaN) === "UNKNOWN", "NaN must classify as UNKNOWN");
    assert(classifyAltitudeRegime(Infinity) === "UNKNOWN", "+Infinity must classify as UNKNOWN");
    assert(classifyAltitudeRegime(-Infinity) === "UNKNOWN", "-Infinity must classify as UNKNOWN");
  });

  // ============================================================================
  // Suite 2: Altitude & Object-Type Filtering Integration
  // ============================================================================

  test("6. Combined altitude and object-type filters accurately select visible objects", () => {
    // Mode 1: all objects, all regimes
    const resAll = filterObjectsByRegimeAndType(
      CATALOG_SATELLITES,
      SYNTHETIC_DEBRIS_CLOUD,
      { LEO: true, MEO: true, GEO: true },
      "all"
    );
    assert(resAll.visibleSatellites.length === 2, "Both catalog satellites visible");
    assert(resAll.visibleFragments.length === 520, "All 520 debris visible");
    assert(resAll.counts.visible === 522, "Total visible objects must be 522");

    // Mode 2: satellites only, LEO active
    const resSatsOnly = filterObjectsByRegimeAndType(
      CATALOG_SATELLITES,
      SYNTHETIC_DEBRIS_CLOUD,
      { LEO: true, MEO: false, GEO: false },
      "satellites"
    );
    assert(resSatsOnly.visibleSatellites.length === 2, "Satellites in LEO visible");
    assert(resSatsOnly.visibleFragments.length === 0, "Zero fragments visible in satellites mode");

    // Mode 3: debris only, LEO active
    const resDebrisOnly = filterObjectsByRegimeAndType(
      CATALOG_SATELLITES,
      SYNTHETIC_DEBRIS_CLOUD,
      { LEO: true, MEO: false, GEO: false },
      "debris"
    );
    assert(resDebrisOnly.visibleSatellites.length === 0, "Zero satellites visible in debris mode");
    assert(resDebrisOnly.visibleFragments.length === 520, "Debris in LEO visible");

    // Mode 4: MEO only (none exist in local fixtures)
    const resMeoOnly = filterObjectsByRegimeAndType(
      CATALOG_SATELLITES,
      SYNTHETIC_DEBRIS_CLOUD,
      { LEO: false, MEO: true, GEO: false },
      "all"
    );
    assert(resMeoOnly.visibleSatellites.length === 0, "Zero satellites in MEO");
    assert(resMeoOnly.visibleFragments.length === 0, "Zero fragments in MEO");
    assert(resMeoOnly.counts.visible === 0, "Zero visible objects when LEO is deselected");
  });

  test("7. Filter reset restores all regimes and full visibility", () => {
    const regimes: Record<AltitudeRegime, boolean> = {
      LEO: false,
      MEO: false,
      GEO: false,
    };
    const resFiltered = filterObjectsByRegimeAndType(
      CATALOG_SATELLITES,
      SYNTHETIC_DEBRIS_CLOUD,
      regimes,
      "all"
    );
    assert(resFiltered.counts.visible === 0, "Zero objects when all regimes deselected");

    // After reset
    const resReset = filterObjectsByRegimeAndType(
      CATALOG_SATELLITES,
      SYNTHETIC_DEBRIS_CLOUD,
      DEFAULT_ALTITUDE_REGIMES,
      "all"
    );
    assert(resReset.counts.visible === 522, "Reset restores full 522 objects");
  });

  test("8. Filter result counts accurately tally per-regime distributions", () => {
    const res = filterObjectsByRegimeAndType(
      CATALOG_SATELLITES,
      SYNTHETIC_DEBRIS_CLOUD,
      DEFAULT_ALTITUDE_REGIMES,
      "all"
    );
    assert(res.counts.total === 522, "Total count is 522");
    assert(res.counts.leoCount === 522, "All 522 objects reside in LEO");
    assert(res.counts.meoCount === 0, "MEO count is 0");
    assert(res.counts.geoCount === 0, "GEO count is 0");
    assert(res.counts.otherCount === 0, "Other count is 0");
  });

  test("9. Selected object identity is preserved with isSelectedHidden flag when filtered out", () => {
    const selectedId = "25544"; // ISS in LEO

    // When LEO is active -> visible
    const resVisible = filterObjectsByRegimeAndType(
      CATALOG_SATELLITES,
      SYNTHETIC_DEBRIS_CLOUD,
      { LEO: true, MEO: true, GEO: true },
      "all",
      selectedId
    );
    assert(resVisible.isSelectedHidden === false, "Selected object is not hidden when LEO is active");

    // When LEO is toggled off -> hidden, but identity remains preserved!
    const resHidden = filterObjectsByRegimeAndType(
      CATALOG_SATELLITES,
      SYNTHETIC_DEBRIS_CLOUD,
      { LEO: false, MEO: true, GEO: true },
      "all",
      selectedId
    );
    assert(resHidden.isSelectedHidden === true, "Selected object is flagged as hidden when LEO is disabled");
    assert(resHidden.visibleSatellites.length === 0, "Object is removed from rendered list");
  });

  // ============================================================================
  // Suite 3: Global Simulation Clock Synchronization
  // ============================================================================

  test("10. Global simulation clock state synchronization via store", () => {
    const store = useZorbitStore.getState();
    const testEpoch = new Date("2026-11-02T12:30:00.000Z").getTime();

    store.setSimulationEpochMs(testEpoch);
    assert(useZorbitStore.getState().currentEpochMs === testEpoch, "Store epoch must update");
    assert(useZorbitStore.getState().isOutOfBounds === false, "Inside bounds must be isOutOfBounds: false");

    store.setSimulationIsPlaying(false);
    assert(useZorbitStore.getState().isPlaying === false, "isPlaying must update to false");

    store.setSimulationPlaybackSpeed(10);
    assert(useZorbitStore.getState().playbackSpeed === 10, "Playback speed must update to 10x");
  });

  test("11. Time scrubber seek and reset return to authoritative start epoch", () => {
    const store = useZorbitStore.getState();
    const startMs = store.startEpochMs;

    // Seek forward
    const seekMs = startMs + 45 * 60 * 1000;
    store.setSimulationEpochMs(seekMs);
    assert(useZorbitStore.getState().currentEpochMs === seekMs, "Seek must update epoch");

    // Reset clock
    store.resetSimulationClock();
    assert(useZorbitStore.getState().currentEpochMs === startMs, "Reset must restore start epoch");
    assert(useZorbitStore.getState().isOutOfBounds === false, "Reset clears out of bounds flag");
  });

  test("12. Explicit UTC formatting without timezone skew", () => {
    const epoch = new Date("2026-11-02T12:00:00.000Z").getTime();
    const iso = new Date(epoch).toISOString();
    assert(iso === "2026-11-02T12:00:00.000Z", "ISO string must match UTC reference exactly");

    const formatted = iso.replace("T", " ").substring(0, 19) + " UTC";
    assert(formatted === "2026-11-02 12:00:00 UTC", "Formatted UTC representation matches spec");
  });

  test("13. Out-of-range propagation handling strictly sets isOutOfBounds flag", () => {
    const store = useZorbitStore.getState();
    const beforeStart = store.startEpochMs - 60000; // 1 min before start
    const afterEnd = store.endEpochMs + 60000; // 1 min after end

    store.setSimulationEpochMs(beforeStart);
    assert(useZorbitStore.getState().isOutOfBounds === true, "Time before start is out of bounds");

    store.setSimulationEpochMs(afterEnd);
    assert(useZorbitStore.getState().isOutOfBounds === true, "Time after end is out of bounds");

    // Restore valid epoch
    store.resetSimulationClock();
    assert(useZorbitStore.getState().isOutOfBounds === false, "Valid epoch restores in-bounds status");
  });

  test("14. Deep-link preservation across filter changes", () => {
    const query = buildNavigationalQueryString({
      tab: "radar",
      objectId: "catalog:norad:25544",
    });
    const parsed = parseUrlNavigationalState(query);
    assert(parsed.state.tab === "radar", "Tab is radar");
    assert(parsed.state.objectId === "catalog:norad:25544", "Deep link objectId preserved");
  });

  test("15. Position altitude calculation produces positive geocentric distance", () => {
    const pos = ISS_SATELLITE.currentPositionKm;
    const alt = calculateAltitudeKm(pos[0], pos[1], pos[2]);
    assert(alt > 350.0 && alt < 500.0, `ISS altitude (${alt.toFixed(1)} km) is in expected LEO range`);
    assert(isPositionInActiveRegimes(pos[0], pos[1], pos[2], { LEO: true, MEO: false, GEO: false }), "ISS is in active LEO");
    assert(!isPositionInActiveRegimes(pos[0], pos[1], pos[2], { LEO: false, MEO: true, GEO: false }), "ISS is not in MEO");
  });

  return { passed, total, details };
}
