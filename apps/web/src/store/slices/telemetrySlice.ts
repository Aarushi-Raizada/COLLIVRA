/**
 * Telemetry Slice for ZORBIT Global Domain Store
 *
 * Manages API connectivity status and demo/live mode flag.
 */

import type { StateCreator } from "zustand";
import type { ApiConnectionStatus } from "../../types/orbital";
import type { ZorbitStoreState } from "../useZorbitStore";

export interface TelemetrySlice {
  apiStatus: ApiConnectionStatus;
  isDemoMode: boolean;

  // Actions
  setApiStatus: (status: ApiConnectionStatus) => void;
  setDemoMode: (isDemo: boolean) => void;
}

export const createTelemetrySlice: StateCreator<
  ZorbitStoreState,
  [],
  [],
  TelemetrySlice
> = (set) => ({
  apiStatus: {
    connected: false,
    state: "disconnected",
    lastCheckedUtc: null,
  },
  isDemoMode: true,

  setApiStatus: (status: ApiConnectionStatus) => {
    set({ apiStatus: status });
  },

  setDemoMode: (isDemo: boolean) => {
    set({ isDemoMode: isDemo });
  },
});

