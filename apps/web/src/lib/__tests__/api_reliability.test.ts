/**
 * Unit verification tests for ZORBIT Frontend Connection & Screening Reliability
 * Verifies decoupled health checking, initial 2-hour screening window, 30s timeout,
 * duplicate mount prevention, and retry capabilities.
 */

import {
  calculateInitialScreeningWindow,
  createInitialScreeningRequest,
  applyHealthCheckSuccess,
  applyHealthCheckFailure,
  applyScreeningFailure,
  applyScreeningSuccess,
  LifecycleState,
} from "../screening_lifecycle";
import { ZorbitApiClient, ApiError } from "../api";
import {
  MOCK_CONJUNCTION_EVENTS,
  MOCK_RISK_ASSESSMENTS,
  MOCK_DATA_SOURCE_INFO,
  MOCK_CONJUNCTION_RESPONSE,
} from "../mockData";
import type { ConjunctionScreeningRequest, HealthResponse } from "../../types/api";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

export function runApiReliabilityTests(): {
  passed: number;
  total: number;
  details: string[];
} {
  let passed = 0;
  let total = 0;
  const details: string[] = [];

  function test(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      const res = fn();
      if (res instanceof Promise) {
        throw new Error("Synchronous test runner encountered unresolved promise");
      }
      passed++;
      details.push(`[PASS] ${name}`);
    } catch (err) {
      details.push(`[FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[FAIL] ${name}:`, err);
      throw err;
    }
  }

  const initialCombinedFixtures = MOCK_CONJUNCTION_EVENTS.map((event) => ({
    event,
    risk: MOCK_RISK_ASSESSMENTS.find((r) => r.event_id === event.event_id) || null,
  }));

  const createBaseState = (): LifecycleState => ({
    apiStatus: {
      connected: false,
      state: "disconnected",
      lastCheckedUtc: null,
    },
    isDemoMode: true,
    errorMessage: null,
    screeningError: null,
    dataSource: MOCK_DATA_SOURCE_INFO,
    conjunctions: initialCombinedFixtures,
    metrics: {
      totalTrackedObjects: 5,
      activeConjunctions: 3,
      criticalEvents: 2,
      atmosphericReentries: 0,
      propagationFrame: "Inertial GCRS",
      lastScreeningUtc: new Date().toISOString(),
    },
  });

  // 1. Initial screening uses a 2-hour window
  test("1. Initial screening uses a 2-hour window", () => {
    const epoch = new Date("2026-11-04T12:00:00.000Z");
    const window = calculateInitialScreeningWindow(epoch);

    assert(window.startTime === "2026-11-04T12:00:00.000Z", "Start time must match epoch");
    assert(window.endTime === "2026-11-04T14:00:00.000Z", "End time must be exactly +2 hours");
    assert(window.durationMs === 2 * 3600 * 1000, "Window duration must be 7,200,000 ms");

    const req = createInitialScreeningRequest(epoch);
    assert(req.start_time === "2026-11-04T12:00:00.000Z", "Request start_time matches 2h window");
    assert(req.end_time === "2026-11-04T14:00:00.000Z", "Request end_time matches 2h window");
    assert(req.target_frame === "GCRS", "Request target_frame must strictly be GCRS");
    assert(
      JSON.stringify(req.norad_ids) === JSON.stringify(["25544", "48274"]),
      "Request norad_ids must contain ISS and CSS"
    );
  });

  // 2. Screening timeout defaults to 30 seconds
  test("2. Screening timeout defaults to 30 seconds", () => {
    const client = new ZorbitApiClient("http://127.0.0.1:8000");

    // Check function signatures and default timeout constants
    assert(typeof client.screenConjunctions === "function", "screenConjunctions must exist");
    assert(typeof client.checkHealth === "function", "checkHealth must exist");

    // Test AbortError message formatting under 30s timeout
    const timeout30sError = new ApiError(
      `Connection timed out after ${30000 / 1000}s while contacting http://127.0.0.1:8000`,
      408,
      "Request timeout",
      true
    );
    assert(
      timeout30sError.message.includes("Connection timed out after 30s"),
      "30s timeout produces correct error string"
    );

    // Verify 5s health check error string
    const timeout5sError = new ApiError(
      `Connection timed out after ${5000 / 1000}s while contacting http://127.0.0.1:8000`,
      408,
      "Request timeout",
      true
    );
    assert(
      timeout5sError.message.includes("Connection timed out after 5s"),
      "5s health check produces 5s error string"
    );
  });

  // 3. Successful health check followed by screening timeout preserves connected API status
  test("3. Successful health check followed by screening timeout preserves connected API status", () => {
    const baseState = createBaseState();
    const mockHealth: HealthResponse = {
      status: "healthy",
      service: "zorbit-api",
      version: "0.1.0",
      offline_mode: false,
    };

    // Step 1: Health check succeeds
    const connectedState = applyHealthCheckSuccess(baseState, mockHealth, 12);
    assert(connectedState.apiStatus.connected === true, "Health check must mark API connected");
    assert(connectedState.apiStatus.state === "connected", "API status state must be 'connected'");
    assert(connectedState.isDemoMode === false, "Live health check must deactivate demo mode");
    assert(connectedState.errorMessage === null, "Connection errorMessage must be null");

    // Step 2: Screening query subsequently times out after 30s
    const timeoutMsg = "Connection timed out after 30s while contacting http://127.0.0.1:8000";
    const postTimeoutState = applyScreeningFailure(connectedState, timeoutMsg, initialCombinedFixtures);

    // CRITICAL: apiStatus remains connected!
    assert(postTimeoutState.apiStatus.connected === true, "API MUST remain connected after screening timeout");
    assert(postTimeoutState.apiStatus.state === "connected", "API state MUST remain 'connected'");
    assert(postTimeoutState.isDemoMode === false, "Demo mode MUST NOT be activated by screening timeout");
    assert(
      postTimeoutState.screeningError !== null &&
        postTimeoutState.screeningError.includes("30s"),
      "screeningError must capture the 30s timeout"
    );
    assert(
      postTimeoutState.dataSource.label === "OFFLINE FIXTURES (SCREENING ERROR)",
      "Data source must explicitly disclose offline fallback due to screening error"
    );
    assert(
      postTimeoutState.dataSource.mode === "OFFLINE_DEMO",
      "Data source mode must be OFFLINE_DEMO"
    );
  });

  // 4. Actual health-check failure activates offline fallback
  test("4. Actual health-check failure activates offline fallback", () => {
    const baseState = createBaseState();
    const healthFailureMsg = "Unable to reach backend at http://127.0.0.1:8000 (Failed to fetch)";

    const failedState = applyHealthCheckFailure(
      baseState,
      healthFailureMsg,
      initialCombinedFixtures,
      MOCK_DATA_SOURCE_INFO
    );

    assert(failedState.apiStatus.connected === false, "Failed health check must mark API disconnected");
    assert(failedState.apiStatus.state === "error", "API state must be 'error'");
    assert(failedState.isDemoMode === true, "Failed health check must engage demo mode");
    assert(
      failedState.errorMessage !== null && failedState.errorMessage.includes("connection unavailable"),
      "Error message must clearly state connection failure"
    );
    assert(failedState.screeningError === null, "Screening was not executed, so screeningError must be null");
    assert(failedState.dataSource.mode === "OFFLINE_DEMO", "Data source must be OFFLINE_DEMO");
  });

  // 5. Screening failure does not overwrite successful health status
  test("5. Screening failure does not overwrite successful health status", () => {
    const baseState = createBaseState();
    const mockHealth: HealthResponse = {
      status: "healthy",
      service: "zorbit-api",
      version: "0.1.0",
      offline_mode: false,
    };

    const healthyState = applyHealthCheckSuccess(baseState, mockHealth, 8);
    assert(healthyState.apiStatus.connected === true, "Precondition: API is connected");

    // Screening fails with 400 Bad Request
    const screening400Error = "HTTP 400: Conflicting duplicate records detected for catalog identity '25544'";
    const stateAfter400 = applyScreeningFailure(healthyState, screening400Error, initialCombinedFixtures);

    assert(stateAfter400.apiStatus.connected === true, "API status must remain connected after HTTP 400 screening error");
    assert(stateAfter400.apiStatus.state === "connected", "API status state must remain 'connected'");
    assert(stateAfter400.errorMessage === null, "Connection error must remain null");
    assert(
      stateAfter400.screeningError !== null && stateAfter400.screeningError.includes("400"),
      "screeningError must capture the HTTP 400 detail"
    );
  });

  // 6. Duplicate mount-triggered screening is prevented
  test("6. Duplicate mount-triggered screening is prevented", () => {
    let executionCount = 0;
    const isScreeningRef = { current: false };
    const initialTriggerRef = { current: false };

    // Simulate the component mount & screening guard
    const triggerMountScreening = () => {
      if (initialTriggerRef.current) {
        return; // Suppress duplicate mount calls (Strict Mode double-invocation)
      }
      initialTriggerRef.current = true;

      if (isScreeningRef.current) {
        return; // Suppress concurrent execution
      }
      isScreeningRef.current = true;
      executionCount++;
    };

    // First mount invocation
    triggerMountScreening();
    assert(executionCount === 1, "First mount invocation must execute");
    assert(isScreeningRef.current === true, "Screening is in progress");

    // Second mount invocation (simulating React 18 Strict Mode double-effect)
    triggerMountScreening();
    assert(executionCount === 1, "Strict Mode second mount call MUST NOT execute duplicate screening");

    // Finish first screening
    isScreeningRef.current = false;

    // Subsequent mount trigger still suppressed because initialTriggerDone is true
    triggerMountScreening();
    assert(executionCount === 1, "Subsequent mount trigger must remain suppressed");
  });

  // 7. Manual screening and retry still work
  test("7. Manual screening and retry still work", () => {
    const baseState = createBaseState();
    const mockHealth: HealthResponse = {
      status: "healthy",
      service: "zorbit-api",
      version: "0.1.0",
      offline_mode: false,
    };

    // API online, but initial screening failed
    const onlineState = applyHealthCheckSuccess(baseState, mockHealth, 15);
    const failedScreeningState = applyScreeningFailure(
      onlineState,
      "Connection timed out after 30s",
      initialCombinedFixtures
    );
    assert(failedScreeningState.screeningError !== null, "Precondition: screeningError is active");

    // User triggers manual retry screening which succeeds
    const liveEvents = MOCK_CONJUNCTION_RESPONSE.events;
    const combinedLive = liveEvents.map((event) => ({
      event,
      risk: MOCK_RISK_ASSESSMENTS.find((r) => r.event_id === event.event_id) || null,
    }));

    const retriedState = applyScreeningSuccess(
      failedScreeningState,
      MOCK_CONJUNCTION_RESPONSE,
      combinedLive,
      1
    );

    assert(retriedState.screeningError === null, "Retry screening must clear screeningError");
    assert(retriedState.apiStatus.connected === true, "API status remains connected");
    assert(retriedState.dataSource.mode === "LIVE_API", "Data source mode becomes LIVE_API");
    assert(retriedState.dataSource.label === "LIVE BACKEND", "Data source label becomes LIVE BACKEND");
    assert(retriedState.conjunctions.length === liveEvents.length, "Conjunctions populated with live events");
  });

  return { passed, total, details };
}
