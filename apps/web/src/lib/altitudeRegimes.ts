/**
 * COLLIVRA Altitude Regime Classification & Spatial Filtering
 *
 * Implements Milestone AST-01C.2 Display & Filtering Specifications:
 * - LEO: 160 km to below 2,000 km
 * - MEO: 2,000 km to below 35,786 km
 * - GEO: 35,786 km to 40,000 km
 *
 * Scientific Basis:
 * Geocentric altitude is calculated relative to the WGS-84 equatorial spherical radius (6,378.137 km)
 * from Cartesian GCRS coordinates: altitude = sqrt(x^2 + y^2 + z^2) - 6,378.137 km.
 * These bands represent operational display categories for space situational awareness.
 */

import { calculateAltitudeKm } from "./coordinates";
import type {
  VisualSatellite,
  VisualFragment,
  ObjectFilterMode,
} from "../types/visualization";

export type AltitudeRegime = "LEO" | "MEO" | "GEO";

export type RegimeClassification =
  | "LEO"
  | "MEO"
  | "GEO"
  | "SUB_ORBITAL"
  | "DEEP_SPACE"
  | "UNKNOWN";

export interface AltitudeBandDefinition {
  readonly minKm: number;
  readonly maxKm: number;
  readonly label: string;
  readonly description: string;
}

export const ALTITUDE_BANDS: Readonly<Record<AltitudeRegime, AltitudeBandDefinition>> = {
  LEO: {
    minKm: 160.0,
    maxKm: 2000.0,
    label: "Low Earth Orbit (LEO)",
    description: "160 km to below 2,000 km",
  },
  MEO: {
    minKm: 2000.0,
    maxKm: 35786.0,
    label: "Medium Earth Orbit (MEO)",
    description: "2,000 km to below 35,786 km",
  },
  GEO: {
    minKm: 35786.0,
    maxKm: 40000.0,
    label: "Geostationary Orbit (GEO)",
    description: "35,786 km to 40,000 km",
  },
} as const;

export const DEFAULT_ALTITUDE_REGIMES: Readonly<Record<AltitudeRegime, boolean>> = {
  LEO: true,
  MEO: true,
  GEO: true,
} as const;

/**
 * Classifies an instantaneous geocentric altitude (km) into an altitude regime.
 * Strict boundary conditions:
 * - alt < 160 km: SUB_ORBITAL
 * - 160 <= alt < 2,000 km: LEO
 * - 2,000 <= alt < 35,786 km: MEO
 * - 35,786 <= alt <= 40,000 km: GEO
 * - alt > 40,000 km: DEEP_SPACE
 * - non-finite / NaN: UNKNOWN
 */
export function classifyAltitudeRegime(altitudeKm: number): RegimeClassification {
  if (!Number.isFinite(altitudeKm)) {
    return "UNKNOWN";
  }
  if (altitudeKm < 160.0) {
    return "SUB_ORBITAL";
  }
  if (altitudeKm < 2000.0) {
    return "LEO";
  }
  if (altitudeKm < 35786.0) {
    return "MEO";
  }
  if (altitudeKm <= 40000.0) {
    return "GEO";
  }
  return "DEEP_SPACE";
}

/**
 * Checks whether an object at a given Cartesian position belongs to one of the active regimes.
 */
export function isPositionInActiveRegimes(
  xKm: number,
  yKm: number,
  zKm: number,
  activeRegimes: Record<AltitudeRegime, boolean>
): boolean {
  if (!Number.isFinite(xKm) || !Number.isFinite(yKm) || !Number.isFinite(zKm)) {
    return false;
  }
  const altKm = calculateAltitudeKm(xKm, yKm, zKm);
  const regime = classifyAltitudeRegime(altKm);
  if (regime === "LEO" || regime === "MEO" || regime === "GEO") {
    return Boolean(activeRegimes[regime]);
  }
  return false;
}

export interface FilteredObjectsResult {
  visibleSatellites: VisualSatellite[];
  visibleFragments: VisualFragment[];
  counts: {
    total: number;
    visible: number;
    leoCount: number;
    meoCount: number;
    geoCount: number;
    otherCount: number;
  };
  isSelectedHidden: boolean;
}

/**
 * Filters visual orbital objects according to active altitude regimes and object-type filter mode.
 * Preserves the identity of the selected object, returning whether it is currently hidden by filters.
 */
export function filterObjectsByRegimeAndType(
  satellites: VisualSatellite[],
  fragments: VisualFragment[],
  activeRegimes: Record<AltitudeRegime, boolean>,
  filterMode: ObjectFilterMode,
  selectedObjectId?: string | null
): FilteredObjectsResult {
  let leoCount = 0;
  let meoCount = 0;
  let geoCount = 0;
  let otherCount = 0;

  const total = satellites.length + fragments.length;

  // 1. Classify every satellite
  const classifiedSats = satellites.map((sat) => {
    const pos = sat.currentPositionKm;
    const alt = calculateAltitudeKm(pos[0], pos[1], pos[2]);
    const regime = classifyAltitudeRegime(alt);
    if (regime === "LEO") leoCount++;
    else if (regime === "MEO") meoCount++;
    else if (regime === "GEO") geoCount++;
    else otherCount++;
    return { sat, regime };
  });

  // 2. Classify every debris fragment
  const classifiedFrags = fragments.map((frag) => {
    const pos = frag.positionGcrsKm;
    const alt = calculateAltitudeKm(pos[0], pos[1], pos[2]);
    const regime = classifyAltitudeRegime(alt);
    if (regime === "LEO") leoCount++;
    else if (regime === "MEO") meoCount++;
    else if (regime === "GEO") geoCount++;
    else otherCount++;
    return { frag, regime };
  });

  // 3. Filter satellites
  const visibleSatellites: VisualSatellite[] = [];
  if (filterMode === "all" || filterMode === "satellites" || filterMode === "selected") {
    for (const item of classifiedSats) {
      const isSelected = Boolean(
        selectedObjectId &&
        (item.sat.id === selectedObjectId || item.sat.noradCatId === selectedObjectId)
      );

      if (filterMode === "selected" && !isSelected) {
        continue;
      }

      // Check altitude regime filter
      if (
        (item.regime === "LEO" && activeRegimes.LEO) ||
        (item.regime === "MEO" && activeRegimes.MEO) ||
        (item.regime === "GEO" && activeRegimes.GEO)
      ) {
        visibleSatellites.push(item.sat);
      }
    }
  }

  // 4. Filter debris fragments
  const visibleFragments: VisualFragment[] = [];
  if (filterMode === "all" || filterMode === "debris" || filterMode === "selected") {
    for (const item of classifiedFrags) {
      const isSelected = Boolean(selectedObjectId && item.frag.id === selectedObjectId);

      if (filterMode === "selected" && !isSelected) {
        continue;
      }

      if (
        (item.regime === "LEO" && activeRegimes.LEO) ||
        (item.regime === "MEO" && activeRegimes.MEO) ||
        (item.regime === "GEO" && activeRegimes.GEO)
      ) {
        visibleFragments.push(item.frag);
      }
    }
  }

  // 5. Determine whether the selected object is hidden by active filters
  let isSelectedHidden = false;
  if (selectedObjectId) {
    const sat = satellites.find(
      (s) => s.id === selectedObjectId || s.noradCatId === selectedObjectId
    );
    if (sat) {
      const isVisible = visibleSatellites.some((s) => s.id === sat.id);
      isSelectedHidden = !isVisible;
    } else {
      const frag = fragments.find((f) => f.id === selectedObjectId);
      if (frag) {
        const isVisible = visibleFragments.some((f) => f.id === frag.id);
        isSelectedHidden = !isVisible;
      }
    }
  }

  return {
    visibleSatellites,
    visibleFragments,
    counts: {
      total,
      visible: visibleSatellites.length + visibleFragments.length,
      leoCount,
      meoCount,
      geoCount,
      otherCount,
    },
    isSelectedHidden,
  };
}
