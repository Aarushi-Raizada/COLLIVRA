/**
 * Unit verification tests for ZORBIT GCRS API Contract Enforcement & Runtime Validation
 * (Milestone 4.1).
 */

import {
  validateConjunctionScreeningResponse,
  assertGcrsScreeningResponse,
  ApiContractValidationError,
} from "../validation";
import { createDefaultScreeningRequest } from "../api";
import type { ConjunctionScreeningResponse } from "../../types/api";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

export function runValidationTests(): { passed: number; total: number; details: string[] } {
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

  const createValidResponse = (): ConjunctionScreeningResponse => ({
    summary: {
      total_objects: 2,
      total_pairs_considered: 1,
      total_events: 1,
      critical_count: 1,
      high_count: 0,
      moderate_count: 0,
      low_count: 0,
      start_time: "2026-11-02T12:00:00.000Z",
      end_time: "2026-11-02T14:00:00.000Z",
      step_seconds: 60.0,
      threshold_km: 10.0,
      target_frame: "GCRS",
      processed_at: "2026-11-02T12:01:00.000Z",
      execution_time_seconds: 0.125,
      failed_objects_count: 0,
      resolved_objects_count: 2,
      unresolved_norad_ids: [],
    },
    events: [
      {
        event_id: "CONJ-25544-48274-20261102T120530Z",
        object_1_id: "25544",
        object_1_name: "ISS (ZARYA)",
        object_2_id: "48274",
        object_2_name: "CSS (TIANHE)",
        tca: "2026-11-02T12:05:30.412Z",
        miss_distance_km: 0.842,
        relative_position_km: [0.412, -0.618, 0.389],
        relative_velocity_kms: [-10.412, 6.128, 4.312],
        relative_speed_kms: 12.812,
        category: "CRITICAL",
        screening_threshold_km: 10.0,
        frame: "GCRS",
        step_seconds: 60.0,
        method: "NUMERICAL_OPTIMIZATION",
        disclaimer: "Scientific Disclaimer: Conjunction screening results are preliminary.",
      },
    ],
    unresolved_norad_ids: [],
    disclaimer: "Scientific Disclaimer",
  });

  // 1. Valid GCRS response is accepted
  test("1. Valid GCRS response is accepted", () => {
    const raw = createValidResponse();
    const validated = assertGcrsScreeningResponse(raw);
    assert(validated.summary.target_frame === "GCRS", "Summary target_frame must be GCRS");
    assert(validated.events.length === 1, "Must contain 1 event");
    assert(validated.events[0].frame === "GCRS", "Event frame must be GCRS");
  });

  // 2. TEME event is rejected, with events[0].frame and actual received value preserved
  test("2. TEME event is rejected, with events[0].frame and actual received value preserved", () => {
    const raw = createValidResponse();
    (raw.events[0] as unknown as { frame: string }).frame = "TEME";

    let caught: ApiContractValidationError | null = null;
    try {
      assertGcrsScreeningResponse(raw);
    } catch (err) {
      if (err instanceof ApiContractValidationError) {
        caught = err;
      }
    }

    assert(caught !== null, "Must throw ApiContractValidationError for TEME event");
    const frameError = caught!.validationErrors.find((e) => e.field === "events[0].frame");
    assert(frameError !== undefined, "Error must record field 'events[0].frame'");
    assert(frameError!.received === "TEME", "Error must preserve received value 'TEME'");
    assert(
      frameError!.message.includes("Relative geometry visualization strictly requires 'GCRS'"),
      "Error message must state that non-GCRS frames are prohibited"
    );
  });

  // 3. ITRS event is rejected, with actual received value preserved
  test("3. ITRS event is rejected, with actual received value preserved", () => {
    const raw = createValidResponse();
    (raw.events[0] as unknown as { frame: string }).frame = "ITRS";

    let caught: ApiContractValidationError | null = null;
    try {
      assertGcrsScreeningResponse(raw);
    } catch (err) {
      if (err instanceof ApiContractValidationError) {
        caught = err;
      }
    }

    assert(caught !== null, "Must throw ApiContractValidationError for ITRS event");
    const frameError = caught!.validationErrors.find((e) => e.field === "events[0].frame");
    assert(frameError !== undefined, "Error must record field 'events[0].frame'");
    assert(frameError!.received === "ITRS", "Error must preserve received value 'ITRS'");
  });

  // 4. Non-GCRS summary frame is rejected
  test("4. Non-GCRS summary frame is rejected", () => {
    const raw = createValidResponse();
    (raw.summary as unknown as { target_frame: string }).target_frame = "GCRF";

    let caught: ApiContractValidationError | null = null;
    try {
      assertGcrsScreeningResponse(raw);
    } catch (err) {
      if (err instanceof ApiContractValidationError) {
        caught = err;
      }
    }

    assert(caught !== null, "Must throw ApiContractValidationError for non-GCRS summary frame");
    const summaryError = caught!.validationErrors.find((e) => e.field === "summary.target_frame");
    assert(summaryError !== undefined, "Error must record field 'summary.target_frame'");
    assert(summaryError!.received === "GCRF", "Error must preserve received value 'GCRF'");
  });

  // 5. Request factory always produces target_frame: "GCRS"
  test("5. Request factory always produces target_frame: 'GCRS'", () => {
    const req = createDefaultScreeningRequest(
      "2026-11-02T12:00:00Z",
      "2026-11-02T14:00:00Z",
      ["25544", "48274"],
      25.0
    );

    assert(req.target_frame === "GCRS", "target_frame must strictly be 'GCRS'");
    assert(req.threshold_km === 25.0, "threshold_km must match argument");
    assert(req.step_seconds === 60.0, "step_seconds must be default 60.0");
    assert(
      req.threshold_critical_km !== undefined &&
      req.threshold_high_km !== undefined &&
      req.threshold_moderate_km !== undefined &&
      0 < req.threshold_critical_km &&
      req.threshold_critical_km < req.threshold_high_km &&
      req.threshold_high_km <= req.threshold_moderate_km,
      "Threshold ordering constraint (0 < crit < high <= mod) must be satisfied"
    );
  });

  // 6. Missing summary is rejected
  test("6. Missing summary is rejected", () => {
    const raw = createValidResponse();
    delete (raw as unknown as { summary?: unknown }).summary;

    let caught: ApiContractValidationError | null = null;
    try {
      assertGcrsScreeningResponse(raw);
    } catch (err) {
      if (err instanceof ApiContractValidationError) {
        caught = err;
      }
    }

    assert(caught !== null, "Must throw when summary is missing");
    assert(
      caught!.validationErrors.some((e) => e.field === "summary"),
      "Must record missing summary error"
    );
  });

  // 7. Missing events array is rejected
  test("7. Missing events array is rejected", () => {
    const raw = createValidResponse();
    delete (raw as unknown as { events?: unknown }).events;

    let caught: ApiContractValidationError | null = null;
    try {
      assertGcrsScreeningResponse(raw);
    } catch (err) {
      if (err instanceof ApiContractValidationError) {
        caught = err;
      }
    }

    assert(caught !== null, "Must throw when events is missing or not an array");
    assert(
      caught!.validationErrors.some((e) => e.field === "events"),
      "Must record missing events error"
    );
  });

  // 8. Invalid vector length is rejected
  test("8. Invalid vector length is rejected", () => {
    const raw = createValidResponse();
    // Supply 2D vector instead of 3D
    (raw.events[0] as unknown as { relative_position_km: number[] }).relative_position_km = [1.0, 2.0];

    let caught: ApiContractValidationError | null = null;
    try {
      assertGcrsScreeningResponse(raw);
    } catch (err) {
      if (err instanceof ApiContractValidationError) {
        caught = err;
      }
    }

    assert(caught !== null, "Must throw when relative vector has length != 3");
    const vecError = caught!.validationErrors.find(
      (e) => e.field === "events[0].relative_position_km"
    );
    assert(vecError !== undefined, "Must record error on relative_position_km");
  });

  // 9. NaN or Infinity in a vector is rejected
  test("9. NaN or Infinity in a vector is rejected", () => {
    const rawNan = createValidResponse();
    (rawNan.events[0] as unknown as { relative_velocity_kms: number[] }).relative_velocity_kms = [
      -10.4,
      Number.NaN,
      4.3,
    ];

    let caughtNan: ApiContractValidationError | null = null;
    try {
      assertGcrsScreeningResponse(rawNan);
    } catch (err) {
      if (err instanceof ApiContractValidationError) {
        caughtNan = err;
      }
    }

    assert(caughtNan !== null, "Must reject vector containing NaN");
    assert(
      caughtNan!.validationErrors.some((e) => e.field === "events[0].relative_velocity_kms"),
      "Must record error on relative_velocity_kms containing NaN"
    );

    const rawInf = createValidResponse();
    (rawInf.events[0] as unknown as { relative_velocity_kms: number[] }).relative_velocity_kms = [
      Number.POSITIVE_INFINITY,
      2.0,
      1.0,
    ];

    let caughtInf: ApiContractValidationError | null = null;
    try {
      assertGcrsScreeningResponse(rawInf);
    } catch (err) {
      if (err instanceof ApiContractValidationError) {
        caughtInf = err;
      }
    }

    assert(caughtInf !== null, "Must reject vector containing Infinity");
  });

  // 10. Invalid timestamp or malformed response is rejected
  test("10. Invalid timestamp or malformed response is rejected", () => {
    const rawDate = createValidResponse();
    (rawDate.events[0] as unknown as { tca: string }).tca = "invalid-epoch-string";

    let caughtDate: ApiContractValidationError | null = null;
    try {
      assertGcrsScreeningResponse(rawDate);
    } catch (err) {
      if (err instanceof ApiContractValidationError) {
        caughtDate = err;
      }
    }

    assert(caughtDate !== null, "Must throw for invalid date string");
    assert(
      caughtDate!.validationErrors.some((e) => e.field === "events[0].tca"),
      "Must record error on invalid tca"
    );

    // Malformed root (null, primitives)
    let caughtNull: ApiContractValidationError | null = null;
    try {
      assertGcrsScreeningResponse(null);
    } catch (err) {
      if (err instanceof ApiContractValidationError) {
        caughtNull = err;
      }
    }
    assert(caughtNull !== null, "Must throw for null response");
  });

  // 11. Nullable object names are accepted
  test("11. Nullable object names are accepted without error", () => {
    const raw = createValidResponse();
    raw.events[0].object_1_name = null;
    raw.events[0].object_2_name = null;

    const validated = assertGcrsScreeningResponse(raw);
    assert(validated.events[0].object_1_name === null, "object_1_name must be null");
    assert(validated.events[0].object_2_name === null, "object_2_name must be null");
  });

  return { passed, total, details };
}
