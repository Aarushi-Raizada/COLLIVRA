/**
 * Simulation Clock Slice for COLLIVRA Global Domain Store
 *
 * Implements authoritative global simulation clock synchronization:
 * - Single source of truth for simulation epoch across Mission Overview, Radar, and Solvers.
 * - Explicit UTC handling with millisecond epoch representation.
 * - Bounded propagation window: loops or pauses safely without extrapolating outside sample horizon.
 * - Strict no-extrapolation flag if epoch is set beyond valid bounds.
 */

import type { StateCreator } from "zustand";
import type { ZorbitStoreState } from "../useZorbitStore";

export const DEFAULT_START_EPOCH_MS = new Date("2026-11-02T12:00:00.000Z").getTime();
export const DEFAULT_END_EPOCH_MS = new Date("2026-11-02T13:35:00.000Z").getTime(); // 95 min horizon

export interface SimulationClockSlice {
  currentEpochMs: number;
  startEpochMs: number;
  endEpochMs: number;
  isPlaying: boolean;
  playbackSpeed: number; // 1, 5, 10, 30, 60
  isOutOfBounds: boolean;

  // Actions
  setSimulationEpochMs: (epochMs: number) => void;
  setSimulationIsPlaying: (isPlaying: boolean) => void;
  setSimulationPlaybackSpeed: (speed: number) => void;
  resetSimulationClock: () => void;
  stepSimulationClock: (deltaSeconds: number) => void;
}

export const createSimulationClockSlice: StateCreator<
  ZorbitStoreState,
  [],
  [],
  SimulationClockSlice
> = (set, get) => ({
  currentEpochMs: DEFAULT_START_EPOCH_MS,
  startEpochMs: DEFAULT_START_EPOCH_MS,
  endEpochMs: DEFAULT_END_EPOCH_MS,
  isPlaying: true,
  playbackSpeed: 5,
  isOutOfBounds: false,

  setSimulationEpochMs: (epochMs: number) => {
    const { startEpochMs, endEpochMs } = get();
    const outOfBounds = epochMs < startEpochMs || epochMs > endEpochMs;
    set({
      currentEpochMs: epochMs,
      isOutOfBounds: outOfBounds,
    });
  },

  setSimulationIsPlaying: (isPlaying: boolean) => {
    set({ isPlaying });
  },

  setSimulationPlaybackSpeed: (speed: number) => {
    set({ playbackSpeed: speed });
  },

  resetSimulationClock: () => {
    set({
      currentEpochMs: get().startEpochMs,
      isOutOfBounds: false,
    });
  },

  stepSimulationClock: (deltaSeconds: number) => {
    const state = get();
    if (!state.isPlaying) return;

    const deltaMs = deltaSeconds * 1000 * state.playbackSpeed;
    const nextEpoch = state.currentEpochMs + deltaMs;

    // Loop cleanly when reaching end of trajectory horizon
    if (nextEpoch > state.endEpochMs) {
      set({
        currentEpochMs: state.startEpochMs,
        isOutOfBounds: false,
      });
    } else {
      set({
        currentEpochMs: nextEpoch,
        isOutOfBounds: false,
      });
    }
  },
});
