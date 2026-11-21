/**
 * COLLIVRA 3D Orbital Visualization Types
 */

import { CoordinateFrame } from "./api";

export interface VisualOrbitSample {
  timestampUtc: string;
  epochSeconds: number;
  positionGcrsKm: [number, number, number];
  velocityGcrsKms?: [number, number, number];
}

export interface VisualTrajectory {
  id: string;
  name: string;
  frame: CoordinateFrame; // Strictly GCRS
  isIllustrative: boolean;
  provenance: string;
  color: string;
  periodMinutes?: number;
  samples: VisualOrbitSample[];
}

export interface VisualSatellite {
  id: string;
  noradCatId: string;
  name: string;
  classification: string;
  epoch: string;
  frame: CoordinateFrame; // Strictly GCRS
  currentPositionKm: [number, number, number];
  currentVelocityKms: [number, number, number];
  isSynthetic: boolean;
  provenance: string;
  trajectory?: VisualTrajectory;
}

export interface VisualFragment {
  id: string;
  name: string;
  positionGcrsKm: [number, number, number];
  velocityGcrsKms: [number, number, number];
  massKg: number;
  isSynthetic: true;
  provenance: string;
}

export interface SceneVisibilityState {
  earth: boolean;
  atmosphere: boolean;
  atmosphericInterface: boolean;
  latLongGrid: boolean;
  orbits: boolean;
  catalogObjects: boolean;
  debrisCloud: boolean;
}

export interface TimeScrubberState {
  currentTimeUtc: string;
  timeRangeStartUtc: string;
  timeRangeEndUtc: string;
  isPlaying: boolean;
  playbackSpeed: number; // 1, 5, 10, 30, 60
}

export type SelectedObjectInfo =
  | {
      type: "satellite";
      satellite: VisualSatellite;
    }
  | {
      type: "fragment";
      fragment: VisualFragment;
    }
  | null;

export type ObjectFilterMode = "all" | "satellites" | "debris" | "selected";

export type AltitudeRegime = "LEO" | "MEO" | "GEO";

export type AltitudeFilterState = Record<AltitudeRegime, boolean>;



