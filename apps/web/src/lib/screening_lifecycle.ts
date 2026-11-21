/**
 * COLLIVRA Frontend API Lifecycle & Connection Reliability State Management
 *
 * Implements strict separation of backend health determination from orbital
 * conjunction screening execution. Prevents screening query timeouts or heavy
 * astrodynamic computations from falsely marking the backend as offline.
 */

import {
  ApiConnectionStatus,
  DataSourceInfo,
  ScreenedConjunctionWithRisk,
  DashboardMetrics,
} from "../types/orbital";
import {
  ConjunctionScreeningRequest,
  ConjunctionScreeningResponse,
  HealthResponse,
} from "../types/api";

export interface LifecycleState {
  apiStatus: ApiConnectionStatus;
  isDemoMode: boolean;
  errorMessage: string | null;
  screeningError: string | null;
  dataSource: DataSourceInfo;
  conjunctions: ScreenedConjunctionWithRisk[];
  metrics: DashboardMetrics;
}

/**
 * Calculates a verified 2-hour initial screening window from a reference epoch.
 * Start time: now (ISO 8601 UTC string)
 * End time: now + 2 hours (ISO 8601 UTC string)
 * Strictly enforces 2-hour duration (7,200,000 ms) in inertial GCRS frame.
 */
export function calculateInitialScreeningWindow(refEpoch?: Date): {
  startTime: string;
  endTime: string;
  durationMs: number;
} {
  const start = refEpoch ? new Date(refEpoch.getTime()) : new Date();
  const durationMs = 2 * 3600 * 1000; // strictly 2 hours (7,200,000 ms)
  const end = new Date(start.getTime() + durationMs);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    durationMs,
  };
}

/**
 * Factory for the standard initial screening request:
 * - 2-hour time window (UTC)
 * - Target frame strictly locked to GCRS
 * - Default tracked stations: ISS (25544) & CSS (48274)
 * - Threshold: 50.0 km
 */
export function createInitialScreeningRequest(refEpoch?: Date): ConjunctionScreeningRequest {
  const window = calculateInitialScreeningWindow(refEpoch);
  return {
    norad_ids: ["25544", "48274"],
    start_time: window.startTime,
    end_time: window.endTime,
    step_seconds: 60.0,
    threshold_km: 50.0,
    target_frame: "GCRS",
    threshold_critical_km: 1.0,
    threshold_high_km: 5.0,
    threshold_moderate_km: 10.0,
  };
}

/**
 * Pure transition when backend /health succeeds.
 * Establishes live API connectivity without engaging demo mode.
 */
export function applyHealthCheckSuccess(
  prevState: LifecycleState,
  health: HealthResponse,
  latencyMs: number,
  checkedAtUtc: string = new Date().toISOString()
): LifecycleState {
  return {
    ...prevState,
    apiStatus: {
      connected: true,
      state: "connected",
      latencyMs,
      lastCheckedUtc: checkedAtUtc,
      version: health.version,
      errorMessage: undefined,
    },
    isDemoMode: false,
    errorMessage: null,
  };
}

/**
 * Pure transition when backend /health fails.
 * Genuinely offline: marks apiStatus as error and engages offline demo fallback.
 */
export function applyHealthCheckFailure(
  prevState: LifecycleState,
  errorMsg: string,
  offlineFixtures: ScreenedConjunctionWithRisk[],
  mockDataSource: DataSourceInfo,
  checkedAtUtc: string = new Date().toISOString()
): LifecycleState {
  return {
    ...prevState,
    apiStatus: {
      connected: false,
      state: "error",
      lastCheckedUtc: checkedAtUtc,
      errorMessage: errorMsg,
    },
    isDemoMode: true,
    errorMessage: `Backend connection unavailable: ${errorMsg}. Switched to offline fixtures.`,
    screeningError: null,
    conjunctions: offlineFixtures,
    dataSource: mockDataSource,
  };
}

/**
 * Pure transition when conjunction screening fails while backend health is connected.
 * Preserves apiStatus.connected = true and isDemoMode = false.
 * Displays explicit screening error and labels offline fallback fixtures transparently.
 */
export function applyScreeningFailure(
  prevState: LifecycleState,
  screeningErrMsg: string,
  offlineFixtures: ScreenedConjunctionWithRisk[]
): LifecycleState {
  return {
    ...prevState,
    // CRITICAL: apiStatus remains connected!
    apiStatus: {
      ...prevState.apiStatus,
      connected: true,
      state: "connected",
    },
    // CRITICAL: isDemoMode remains false!
    isDemoMode: false,
    screeningError: `Conjunction screening query failed: ${screeningErrMsg}. Backend is online.`,
    conjunctions: offlineFixtures,
    dataSource: {
      mode: "OFFLINE_DEMO",
      label: "OFFLINE FIXTURES (SCREENING ERROR)",
      provenance: "Verified offline fixtures fallback — live screening query failed. Backend connection is healthy.",
      epoch: new Date().toISOString(),
      offlineIers: false,
      objectCount: offlineFixtures.length,
    },
  };
}

/**
 * Pure transition when conjunction screening succeeds with live data.
 * Clears screening errors and updates live metrics and data source.
 */
export function applyScreeningSuccess(
  prevState: LifecycleState,
  screeningResponse: ConjunctionScreeningResponse,
  combinedEvents: ScreenedConjunctionWithRisk[],
  criticalCount: number
): LifecycleState {
  return {
    ...prevState,
    screeningError: null,
    errorMessage: null,
    conjunctions: combinedEvents,
    dataSource: {
      mode: "LIVE_API",
      label: "LIVE BACKEND",
      provenance: "FastAPI SGP4 Screening Engine (PostgreSQL / In-Memory)",
      epoch: new Date().toISOString(),
      offlineIers: false,
      objectCount: screeningResponse.summary.total_objects || combinedEvents.length,
    },
    metrics: {
      totalTrackedObjects: screeningResponse.summary.total_objects || combinedEvents.length,
      activeConjunctions: combinedEvents.length,
      criticalEvents: criticalCount,
      atmosphericReentries: 0,
      propagationFrame: "Inertial GCRS",
      lastScreeningUtc: new Date().toISOString(),
    },
  };
}

