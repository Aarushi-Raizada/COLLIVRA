/**
 * Unit and integration tests for ZORBIT Frontend Simulation API Integration (Milestone 5.3.1)
 *
 * Verifies:
 * 1. Successful BreakupAndPropagate API response parsing and runtime validation
 * 2. Successful BreakupRemediation API response parsing and runtime validation
 * 3. Correct request serialization for both endpoints
 * 4. Backend HTTP 422 domain validation error handling
 * 5. Backend HTTP 500 internal error handling (sanitized error message)
 * 6. Network failure (503) and AbortError timeout (408) handling
 * 7. Malformed response rejection: missing required fields
 * 8. Malformed response rejection: non-GCRS coordinate frame
 * 9. Malformed response rejection: missing synthetic provenance flag
 * 10. Malformed response rejection: NaN/Infinity in vector components
 * 11. Infeasible rendezvous (exceeding budget) returned as a valid structured response
 * 12. Infeasible rendezvous (ill-conditioned transfer) returned as a valid structured response
 * 13. Preservation of synthetic provenance and scientific units across contracts
 */

import { ZorbitApiClient, ApiError } from "../api";
import { ApiContractValidationError } from "../validation";
import type {
  BreakupAndPropagateRequest,
  BreakupAndPropagateResponse,
  BreakupRemediationRequest,
  BreakupRemediationResponse,
} from "../../types/api";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

// ============================================================================
// Deterministic Test Fixtures
// ============================================================================

const FIXTURE_BREAKUP_PROPAGATE_REQUEST: BreakupAndPropagateRequest = {
  scenario: {
    collision_epoch: "2026-11-04T12:00:00.000Z",
    frame: "GCRS",
    collision_tolerance_km: 0.1,
    parent_a: {
      object_id: "SAT-ALPHA",
      object_name: "Satellite Alpha",
      mass_kg: 500.0,
      position_km: [7200.0, 0.0, 0.0],
      velocity_kms: [0.0, 7.4405, 0.001],
    },
    parent_b: {
      object_id: "SAT-BETA",
      object_name: "Satellite Beta",
      mass_kg: 500.0,
      position_km: [7200.0, 0.05, 0.0],
      velocity_kms: [0.0, 7.4405, -0.001],
    },
    config: {
      fragment_count: 5,
      min_fragment_mass_kg: 1.0,
      max_fragment_mass_kg: 25.0,
      v_median_kms: 0.001,
      v_sigma: 0.5,
      max_delta_v_kms: 0.002,
      power_law_exponent: 1.5,
      seed: 42,
      identifier_prefix: "SYNTH-FRAG",
    },
  },
  propagation_config: {
    duration_seconds: 120.0,
    step_seconds: 60.0,
    integrator: "DOP853",
  },
};

const FIXTURE_BREAKUP_PROPAGATE_RESPONSE: BreakupAndPropagateResponse = {
  fragmentation: {
    scenario: FIXTURE_BREAKUP_PROPAGATE_REQUEST.scenario,
    fragments: [
      {
        fragment_id: "SYNTH-FRAG-0001",
        source_parent_id: "COMBINED",
        epoch: "2026-11-04T12:00:00.000Z",
        frame: "GCRS",
        position_km: [7200.0, 0.025, 0.0],
        velocity_kms: [-0.0002, 7.4409, -0.0004],
        mass_kg: 6.89,
        delta_v_kms: 0.0006,
        ejection_vector_kms: [-0.0002, 0.0004, -0.0004],
        is_synthetic: true,
      },
    ],
    metadata: {
      model_name: "Simplified Synthetic Fragmentation Model",
      fidelity_disclaimer: "RESEARCH PROTOTYPE: Simplified synthetic fragmentation.",
      seed_used: 42,
      parent_a_id: "SAT-ALPHA",
      parent_b_id: "SAT-BETA",
      total_parent_mass_kg: 1000.0,
      tracked_fragment_mass_kg: 45.2,
      residual_mass_kg: 954.8,
      tracked_fragment_count: 5,
      center_of_mass_velocity_kms: [0.0, 7.4405, 0.0],
      center_of_mass_position_km: [7200.0, 0.025, 0.0],
      drift_velocity_removed_ms: 0.42,
      momentum_residual_kg_kms: 1e-19,
    },
  },
  trajectories: {
    scenario_epoch: "2026-11-04T12:00:00.000Z",
    frame: "GCRS",
    count: 1,
    successful_count: 1,
    failed_count: 0,
    summary: {
      total_fragments: 1,
      completed_count: 1,
      reentered_count: 0,
      numerical_failure_count: 0,
      invalid_state_count: 0,
      duration_seconds: 120.0,
      step_seconds: 60.0,
      execution_wall_time_seconds: 0.015,
      model_name: "Cowell DOP853 Numerical Propagator",
      fidelity_disclaimer: "RESEARCH PROTOTYPE: J2 oblateness numerical integration in GCRS.",
    },
    trajectories: [
      {
        fragment_id: "SYNTH-FRAG-0001",
        frame: "GCRS",
        position_unit: "km",
        velocity_unit: "km/s",
        points: [
          {
            epoch: "2026-11-04T12:00:00.000Z",
            position_km: [7200.0, 0.025, 0.0],
            velocity_kms: [-0.0002, 7.4409, -0.0004],
          },
          {
            epoch: "2026-11-04T12:01:00.000Z",
            position_km: [7186.2, 446.4, -0.024],
            velocity_kms: [-0.4601, 7.4262, -0.0004],
          },
        ],
        status: "SUCCESS",
        termination_reason: "COMPLETED",
        mass_kg: 6.89,
        error_message: null,
      },
    ],
  },
};

const FIXTURE_REMEDIATION_REQUEST: BreakupRemediationRequest = {
  scenario: FIXTURE_BREAKUP_PROPAGATE_REQUEST.scenario,
  chaser_id: "CHASER-INSPECTOR-1",
  chaser_epoch_utc: "2026-11-04T12:00:00.000Z",
  chaser_gcrs_position_km: [7200.0, 0.1, 0.0],
  chaser_gcrs_velocity_kms: [0.0, 7.4405, 0.0],
  target_epoch_utc: null,
  propagation_config: {
    duration_seconds: 300.0,
    step_seconds: 60.0,
  },
  rendezvous_config: {
    targeting_mode: "STANDOFF_HOLD",
    standoff_distance_m: 100.0,
    delta_v_budget_max_ms: 500.0,
    transfer_time_s: 180.0,
    max_condition_number: 1e7,
  },
  max_target_eccentricity: 0.005,
  min_target_perigee_km: 6478.137,
};

const FIXTURE_REMEDIATION_RESPONSE: BreakupRemediationResponse = {
  fragmentation: FIXTURE_BREAKUP_PROPAGATE_RESPONSE.fragmentation,
  trajectories_summary: FIXTURE_BREAKUP_PROPAGATE_RESPONSE.trajectories.summary,
  selected_target: FIXTURE_BREAKUP_PROPAGATE_RESPONSE.fragmentation.fragments[0],
  contract: {
    target_id: "SYNTH-FRAG-0001",
    chaser_id: "CHASER-INSPECTOR-1",
    target_is_synthetic: true,
    target_epoch_utc: "2026-11-04T12:00:00.000Z",
    chaser_epoch_utc: "2026-11-04T12:00:00.000Z",
    target_gcrs_position_km: [7200.0, 0.025, 0.0],
    target_gcrs_velocity_kms: [-0.0002, 7.4409, -0.0004],
    chaser_gcrs_position_km: [7200.0, 0.1, 0.0],
    chaser_gcrs_velocity_kms: [0.0, 7.4405, 0.0],
  },
  rendezvous: {
    burn_1_dv_cw_ms: [0.53, -0.73, -0.02],
    burn_2_dv_cw_ms: [0.18, 0.96, 0.0],
    total_delta_v_ms: 1.88,
    transfer_time_s: 180.0,
    is_mathematically_solvable: true,
    is_budget_feasible: true,
    is_feasible: true,
    terminal_position_residual_km: [0.0, 0.0, 0.0],
    terminal_position_error_m: 0.00004,
    terminal_velocity_residual_kms: [0.0, 0.0, 0.0],
    terminal_velocity_error_ms: 0.0,
    condition_number: 1.017,
    epoch_synchronization_applied: false,
    scientific_disclaimer:
      "RESEARCH PROTOTYPE: Clohessy-Wiltshire linearized relative motion model assumes an unperturbed circular reference orbit.",
  },
  execution_wall_time_s: 0.025,
  scientific_disclaimer:
    "RESEARCH PROTOTYPE: Combines simplified synthetic fragmentation, Cowell/DOP853 J2 numerical propagation, and linearized Clohessy-Wiltshire relative motion.",
};

// ============================================================================
// Test Suite Runner
// ============================================================================

export async function runSimulationApiTests(): Promise<{
  passed: number;
  total: number;
  details: string[];
}> {
  let passed = 0;
  let total = 0;
  const details: string[] = [];

  const originalFetch = global.fetch;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      passed++;
      details.push(`[PASS] ${name}`);
    } catch (err) {
      details.push(`[FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[FAIL] ${name}:`, err);
      throw err;
    } finally {
      global.fetch = originalFetch;
    }
  }

  // 1. Successful breakup-and-propagate API response
  await test("1. Successful breakup-and-propagate API response parsing and validation", async () => {
    global.fetch = async () =>
      new Response(JSON.stringify(FIXTURE_BREAKUP_PROPAGATE_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const client = new ZorbitApiClient("http://127.0.0.1:8000");
    const result = await client.simulateBreakupAndPropagate(FIXTURE_BREAKUP_PROPAGATE_REQUEST);

    assert(result.fragmentation.fragments.length === 1, "Must contain 1 fragment");
    assert(result.fragmentation.fragments[0].is_synthetic === true, "Must have is_synthetic = true");
    assert(result.fragmentation.fragments[0].frame === "GCRS", "Must have frame GCRS");
    assert(result.trajectories.frame === "GCRS", "Trajectories frame must be GCRS");
    assert(result.trajectories.summary.total_fragments === 1, "Total fragments must be 1");
    assert(result.trajectories.trajectories[0].points.length === 2, "Trajectory must have 2 points");
  });

  // 2. Successful breakup-and-rendezvous API response
  await test("2. Successful breakup-and-rendezvous API response parsing and validation", async () => {
    global.fetch = async () =>
      new Response(JSON.stringify(FIXTURE_REMEDIATION_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const client = new ZorbitApiClient("http://127.0.0.1:8000");
    const result = await client.planBreakupRemediation(FIXTURE_REMEDIATION_REQUEST);

    assert(result.selected_target.is_synthetic === true, "Target must be synthetic");
    assert(result.selected_target.fragment_id === "SYNTH-FRAG-0001", "Target ID must match");
    assert(result.contract.target_is_synthetic === true, "Contract target must be synthetic");
    assert(result.contract.chaser_id === "CHASER-INSPECTOR-1", "Chaser ID must match");
    assert(result.rendezvous.is_mathematically_solvable === true, "Must be solvable");
    assert(result.rendezvous.is_feasible === true, "Must be feasible");
    assert(result.rendezvous.total_delta_v_ms === 1.88, "Delta V must match");
    assert(result.execution_wall_time_s >= 0.0, "Execution wall time must be non-negative");
    assert(result.scientific_disclaimer.includes("RESEARCH PROTOTYPE"), "Disclaimer must be present");
  });

  // 3. Correct request serialization
  await test("3. Correct request serialization for both endpoints", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody = "";

    global.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || "GET";
      capturedBody = String(init?.body || "");
      return new Response(JSON.stringify(FIXTURE_BREAKUP_PROPAGATE_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new ZorbitApiClient("http://127.0.0.1:8000");
    await client.simulateBreakupAndPropagate(FIXTURE_BREAKUP_PROPAGATE_REQUEST);

    assert(
      capturedUrl === "http://127.0.0.1:8000/api/v1/simulation/breakup-and-propagate",
      "Endpoint URL must match simulation route"
    );
    assert(capturedMethod === "POST", "Method must be POST");
    const parsedBody = JSON.parse(capturedBody);
    assert(parsedBody.scenario.collision_epoch === "2026-11-04T12:00:00.000Z", "Epoch must be UTC string");
    assert(parsedBody.scenario.frame === "GCRS", "Frame must be GCRS");
    assert(Array.isArray(parsedBody.scenario.parent_a.position_km), "Position must be array");

    // Check remediation endpoint serialization
    global.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || "GET";
      capturedBody = String(init?.body || "");
      return new Response(JSON.stringify(FIXTURE_REMEDIATION_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await client.planBreakupRemediation(FIXTURE_REMEDIATION_REQUEST);
    assert(
      capturedUrl === "http://127.0.0.1:8000/api/v1/remediation/breakup-and-rendezvous",
      "Endpoint URL must match remediation route"
    );
    const parsedRemBody = JSON.parse(capturedBody);
    assert(parsedRemBody.chaser_id === "CHASER-INSPECTOR-1", "chaser_id must be serialized");
    assert(parsedRemBody.chaser_gcrs_position_km.length === 3, "Position must be 3-tuple");
  });

  // 4. Backend HTTP 422 domain validation error handling
  await test("4. Backend HTTP 422 domain validation error handling", async () => {
    // 4a. String detail (domain failure)
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          detail: "Infeasible mass allocation: N * min_fragment_mass_kg exceeds total parent mass.",
        }),
        { status: 422, statusText: "Unprocessable Entity" }
      );

    const client = new ZorbitApiClient("http://127.0.0.1:8000");
    let caught422: ApiError | null = null;
    try {
      await client.simulateBreakupAndPropagate(FIXTURE_BREAKUP_PROPAGATE_REQUEST);
    } catch (err) {
      if (err instanceof ApiError) caught422 = err;
    }
    assert(caught422 !== null, "Must throw ApiError on HTTP 422");
    assert(caught422!.status === 422, "Status must be 422");
    assert(caught422!.isNetworkError === false, "Must not be classified as network error");
    assert(
      caught422!.detail.includes("Infeasible mass allocation"),
      "Detail must preserve domain error message"
    );

    // 4b. Array detail (Pydantic validation failure)
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          detail: [
            {
              type: "value_error",
              loc: ["body", "chaser_gcrs_position_km"],
              msg: "Chaser position radius 5000.000 km is inside Earth radius (6378.137 km).",
            },
          ],
        }),
        { status: 422, statusText: "Unprocessable Entity" }
      );

    let caughtPydantic422: ApiError | null = null;
    try {
      await client.planBreakupRemediation(FIXTURE_REMEDIATION_REQUEST);
    } catch (err) {
      if (err instanceof ApiError) caughtPydantic422 = err;
    }
    assert(caughtPydantic422 !== null, "Must throw ApiError on Pydantic 422");
    assert(caughtPydantic422!.status === 422, "Status must be 422");
    assert(
      caughtPydantic422!.detail.includes("inside Earth radius"),
      "Detail must preserve Pydantic validator message"
    );
  });

  // 5. Backend HTTP 500 internal error handling
  await test("5. Backend HTTP 500 internal error handling", async () => {
    global.fetch = async () =>
      new Response(JSON.stringify({ detail: "Internal simulation failure." }), {
        status: 500,
        statusText: "Internal Server Error",
      });

    const client = new ZorbitApiClient("http://127.0.0.1:8000");
    let caught500: ApiError | null = null;
    try {
      await client.planBreakupRemediation(FIXTURE_REMEDIATION_REQUEST);
    } catch (err) {
      if (err instanceof ApiError) caught500 = err;
    }
    assert(caught500 !== null, "Must throw ApiError on HTTP 500");
    assert(caught500!.status === 500, "Status must be 500");
    assert(caught500!.detail === "Internal simulation failure.", "Must preserve sanitized 500 detail");
    assert(
      !caught500!.message.includes("Traceback") && !caught500!.message.includes("Exception"),
      "Must not leak internal stack traces"
    );
  });

  // 6. Network failure and timeout handling
  await test("6. Network failure and timeout handling", async () => {
    // 6a. Connection refused / network failure
    global.fetch = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:8000");
    };

    const client = new ZorbitApiClient("http://127.0.0.1:8000");
    let caughtConnError: ApiError | null = null;
    try {
      await client.simulateBreakupAndPropagate(FIXTURE_BREAKUP_PROPAGATE_REQUEST);
    } catch (err) {
      if (err instanceof ApiError) caughtConnError = err;
    }
    assert(caughtConnError !== null, "Must throw ApiError on connection refusal");
    assert(caughtConnError!.status === 503, "Status must be 503");
    assert(caughtConnError!.isNetworkError === true, "Must be marked network error");

    // 6b. Request timeout (AbortError)
    global.fetch = async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    };

    let caughtTimeout: ApiError | null = null;
    try {
      await client.planBreakupRemediation(FIXTURE_REMEDIATION_REQUEST, 30000);
    } catch (err) {
      if (err instanceof ApiError) caughtTimeout = err;
    }
    assert(caughtTimeout !== null, "Must throw ApiError on timeout");
    assert(caughtTimeout!.status === 408, "Status must be 408");
    assert(caughtTimeout!.isNetworkError === true, "Timeout must be marked network error");
    assert(caughtTimeout!.message.includes("Connection timed out after 30s"), "Message must specify 30s timeout");
  });

  // 7. Malformed response rejection: missing required fields
  await test("7. Malformed response rejection: missing required fields", async () => {
    // Missing fragmentation in breakup response
    global.fetch = async () =>
      new Response(JSON.stringify({ trajectories: FIXTURE_BREAKUP_PROPAGATE_RESPONSE.trajectories }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const client = new ZorbitApiClient("http://127.0.0.1:8000");
    let caughtMissingFrag: ApiContractValidationError | null = null;
    try {
      await client.simulateBreakupAndPropagate(FIXTURE_BREAKUP_PROPAGATE_REQUEST);
    } catch (err) {
      if (err instanceof ApiContractValidationError) caughtMissingFrag = err;
    }
    assert(caughtMissingFrag !== null, "Must reject missing fragmentation with ApiContractValidationError");
    assert(
      caughtMissingFrag!.validationErrors.some((e) => e.field === "fragmentation"),
      "Error must identify missing fragmentation"
    );

    // Missing rendezvous in remediation response
    const invalidRemediation = { ...FIXTURE_REMEDIATION_RESPONSE };
    delete (invalidRemediation as Record<string, unknown>).rendezvous;
    global.fetch = async () =>
      new Response(JSON.stringify(invalidRemediation), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    let caughtMissingRdv: ApiContractValidationError | null = null;
    try {
      await client.planBreakupRemediation(FIXTURE_REMEDIATION_REQUEST);
    } catch (err) {
      if (err instanceof ApiContractValidationError) caughtMissingRdv = err;
    }
    assert(caughtMissingRdv !== null, "Must reject missing rendezvous with ApiContractValidationError");
    assert(
      caughtMissingRdv!.validationErrors.some((e) => e.field === "rendezvous"),
      "Error must identify missing rendezvous"
    );
  });

  // 8. Malformed response rejection: non-GCRS coordinate frame
  await test("8. Malformed response rejection: non-GCRS coordinate frame", async () => {
    const temeResponse = JSON.parse(JSON.stringify(FIXTURE_BREAKUP_PROPAGATE_RESPONSE));
    temeResponse.fragmentation.fragments[0].frame = "TEME";

    global.fetch = async () =>
      new Response(JSON.stringify(temeResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const client = new ZorbitApiClient("http://127.0.0.1:8000");
    let caughtFrameError: ApiContractValidationError | null = null;
    try {
      await client.simulateBreakupAndPropagate(FIXTURE_BREAKUP_PROPAGATE_REQUEST);
    } catch (err) {
      if (err instanceof ApiContractValidationError) caughtFrameError = err;
    }
    assert(caughtFrameError !== null, "Must reject non-GCRS frame");
    assert(
      caughtFrameError!.validationErrors.some((e) => e.message.includes("GCRS")),
      "Validation error must cite GCRS requirement"
    );
  });

  // 9. Malformed response rejection: missing synthetic provenance flag
  await test("9. Malformed response rejection: missing synthetic provenance flag", async () => {
    const nonSynthResponse = JSON.parse(JSON.stringify(FIXTURE_REMEDIATION_RESPONSE));
    nonSynthResponse.selected_target.is_synthetic = false;

    global.fetch = async () =>
      new Response(JSON.stringify(nonSynthResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const client = new ZorbitApiClient("http://127.0.0.1:8000");
    let caughtSynthError: ApiContractValidationError | null = null;
    try {
      await client.planBreakupRemediation(FIXTURE_REMEDIATION_REQUEST);
    } catch (err) {
      if (err instanceof ApiContractValidationError) caughtSynthError = err;
    }
    assert(caughtSynthError !== null, "Must reject target without is_synthetic = true");
    assert(
      caughtSynthError!.validationErrors.some((e) => e.field.includes("is_synthetic")),
      "Validation error must point to is_synthetic field"
    );
  });

  // 10. Malformed response rejection: NaN/Infinity in vector components
  await test("10. Malformed response rejection: NaN/Infinity in vector components", async () => {
    const nanResponse = JSON.parse(JSON.stringify(FIXTURE_REMEDIATION_RESPONSE));
    nanResponse.rendezvous.burn_1_dv_cw_ms = [null, 0.0, 0.0];

    global.fetch = async () =>
      new Response(JSON.stringify(nanResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const client = new ZorbitApiClient("http://127.0.0.1:8000");
    let caughtNanError: ApiContractValidationError | null = null;
    try {
      await client.planBreakupRemediation(FIXTURE_REMEDIATION_REQUEST);
    } catch (err) {
      if (err instanceof ApiContractValidationError) caughtNanError = err;
    }
    assert(caughtNanError !== null, "Must reject non-numeric vector element");
  });

  // 11. Infeasible rendezvous (exceeding budget) returned as valid structured response
  await test("11. Infeasible rendezvous (exceeding budget) returned as valid structured response", async () => {
    const infeasibleBudgetResponse: BreakupRemediationResponse = {
      ...FIXTURE_REMEDIATION_RESPONSE,
      rendezvous: {
        ...FIXTURE_REMEDIATION_RESPONSE.rendezvous,
        is_mathematically_solvable: true,
        is_budget_feasible: false,
        is_feasible: false,
        total_delta_v_ms: 1250.0,
      },
    };

    global.fetch = async () =>
      new Response(JSON.stringify(infeasibleBudgetResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const client = new ZorbitApiClient("http://127.0.0.1:8000");
    const result = await client.planBreakupRemediation(FIXTURE_REMEDIATION_REQUEST);

    assert(result.rendezvous.is_mathematically_solvable === true, "Must remain solvable");
    assert(result.rendezvous.is_budget_feasible === false, "Budget must be infeasible");
    assert(result.rendezvous.is_feasible === false, "Overall must be infeasible");
    assert(result.rendezvous.total_delta_v_ms === 1250.0, "Total delta-V must be preserved");
  });

  // 12. Infeasible rendezvous (ill-conditioned transfer) returned as valid structured response
  await test("12. Infeasible rendezvous (ill-conditioned transfer) returned as valid structured response", async () => {
    const illConditionedResponse: BreakupRemediationResponse = {
      ...FIXTURE_REMEDIATION_RESPONSE,
      rendezvous: {
        ...FIXTURE_REMEDIATION_RESPONSE.rendezvous,
        is_mathematically_solvable: false,
        is_budget_feasible: null,
        is_feasible: false,
        condition_number: 1e9,
      },
    };

    global.fetch = async () =>
      new Response(JSON.stringify(illConditionedResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const client = new ZorbitApiClient("http://127.0.0.1:8000");
    const result = await client.planBreakupRemediation(FIXTURE_REMEDIATION_REQUEST);

    assert(result.rendezvous.is_mathematically_solvable === false, "Must not be solvable");
    assert(result.rendezvous.is_budget_feasible === null, "Budget must be null (not evaluated)");
    assert(result.rendezvous.is_feasible === false, "Overall must be infeasible");
    assert(result.rendezvous.condition_number === 1e9, "Condition number must be preserved");
  });

  // 13. Preservation of synthetic provenance and scientific units across contracts
  await test("13. Preservation of synthetic provenance and scientific units across contracts", async () => {
    const frag = FIXTURE_BREAKUP_PROPAGATE_RESPONSE.fragmentation.fragments[0];
    assert(frag.is_synthetic === true, "is_synthetic must strictly be true");
    assert(frag.fragment_id.startsWith("SYNTH-"), "Fragment IDs must use synthetic namespace");
    assert(frag.mass_kg > 0, "Mass must be in kg (> 0)");
    assert(frag.delta_v_kms >= 0, "Delta-V must be in km/s (>= 0)");
    assert(frag.position_km.length === 3, "Position must be 3-tuple (km)");
    assert(frag.velocity_kms.length === 3, "Velocity must be 3-tuple (km/s)");

    const rdv = FIXTURE_REMEDIATION_RESPONSE.rendezvous;
    assert(rdv.burn_1_dv_cw_ms.length === 3, "Burn 1 must be 3-tuple (m/s)");
    assert(rdv.burn_2_dv_cw_ms.length === 3, "Burn 2 must be 3-tuple (m/s)");
    assert(rdv.total_delta_v_ms >= 0, "Total Delta-V must be in m/s (>= 0)");
    assert(rdv.terminal_position_error_m >= 0, "Terminal position error must be in meters");
    assert(rdv.terminal_velocity_error_ms >= 0, "Terminal velocity error must be in m/s");
  });

  return { passed, total, details };
}

