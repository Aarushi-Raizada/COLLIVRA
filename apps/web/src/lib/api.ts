/**
 * COLLIVRA FastAPI Client
 *
 * Strongly typed HTTP client connecting `apps/web` to the COLLIVRA backend API (`apps/api`).
 * Supports strictly the six currently mounted endpoints in FastAPI:
 * 1. GET  /health
 * 2. POST /api/v1/conjunctions/screen
 * 3. POST /api/v1/risk/assess
 * 4. POST /api/v1/risk/assess-batch
 * 5. POST /api/v1/simulation/breakup-and-propagate
 * 6. POST /api/v1/remediation/breakup-and-rendezvous
 */

import {
  BreakupAndPropagateRequest,
  BreakupAndPropagateResponse,
  BreakupRemediationRequest,
  BreakupRemediationResponse,
  ConjunctionScreeningRequest,
  ConjunctionScreeningResponse,
  HealthResponse,
  RiskAssessment,
  RiskAssessmentBatchRequest,
  RiskAssessmentBatchResponse,
  RiskAssessmentRequest,
} from "@/types/api";
import {
  assertBreakupAndPropagateResponse,
  assertBreakupRemediationResponse,
  assertGcrsScreeningResponse,
} from "./validation";

/**
 * Factory creating a valid ConjunctionScreeningRequest explicitly locked to GCRS.
 *
 * Ensures all outgoing conjunction screening requests enforce target_frame = "GCRS",
 * matching the approved Milestone 4.0.2 / 4.1 engineering specification.
 * Satisfies the backend ordering constraint:
 * 0 < threshold_critical_km < threshold_high_km <= threshold_moderate_km.
 */
export function createDefaultScreeningRequest(
  startTimeUtc: string,
  endTimeUtc: string,
  noradIds?: (string | number)[],
  thresholdKm = 10.0
): ConjunctionScreeningRequest {
  return {
    start_time: startTimeUtc,
    end_time: endTimeUtc,
    norad_ids: noradIds,
    step_seconds: 60.0,
    threshold_km: thresholdKm,
    target_frame: "GCRS", // Explicitly locked to GCRS for Milestone 4
    threshold_critical_km: 1.0,
    threshold_high_km: 5.0,
    threshold_moderate_km: 10.0,
  };
}

import { ApiError, EarthOrientationPolicyApiError } from "./errors";
export { ApiError, EarthOrientationPolicyApiError } from "./errors";

export class ZorbitApiClient {
  private baseUrl: string;
  private defaultTimeoutMs: number;

  constructor(
    baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000",
    timeoutMs = 10000
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.defaultTimeoutMs = timeoutMs;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    timeoutMs = this.defaultTimeoutMs
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(options.headers || {}),
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errJson = await response.json();
          if (errJson && typeof errJson === "object") {
            // Check for structured Earth Orientation Policy Violation (HTTP 422)
            if (
              response.status === 422 &&
              (errJson as { code?: unknown }).code === "EARTH_ORIENTATION_POLICY_VIOLATION"
            ) {
              const p = errJson as {
                detail?: unknown;
                epoch?: unknown;
                data_source?: unknown;
                details?: unknown;
              };
              throw new EarthOrientationPolicyApiError({
                detail: typeof p.detail === "string" ? p.detail : "Earth orientation policy violation",
                epoch: typeof p.epoch === "string" ? p.epoch : null,
                data_source: typeof p.data_source === "string" ? p.data_source : "UNKNOWN",
                details:
                  typeof p.details === "object" && p.details !== null
                    ? (p.details as Record<string, unknown>)
                    : {},
              });
            }

            const detailField = (errJson as { detail?: unknown }).detail;
            if (typeof detailField === "string") {
              errorDetail = detailField;
            } else if (Array.isArray(detailField)) {
              errorDetail = detailField
                .map((d: unknown) =>
                  typeof d === "object" && d !== null && "msg" in d
                    ? String((d as { msg: unknown }).msg)
                    : JSON.stringify(d)
                )
                .join("; ");
            } else {
              errorDetail = JSON.stringify(errJson);
            }
          }
        } catch (parseOrPolicyErr) {
          if (parseOrPolicyErr instanceof EarthOrientationPolicyApiError) {
            throw parseOrPolicyErr;
          }
          // Response body was not JSON, retain HTTP statusText
        }
        throw new ApiError(
          `API request failed: ${errorDetail}`,
          response.status,
          errorDetail,
          false
        );
      }

      const data = (await response.json()) as T;
      return data;
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (err instanceof ApiError) {
        throw err;
      }

      if (err instanceof Error) {
        if (err.name === "AbortError") {
          throw new ApiError(
            `Connection timed out after ${timeoutMs / 1000}s while contacting ${this.baseUrl}`,
            408,
            "Request timeout",
            true
          );
        }
        throw new ApiError(
          `Network connection failed: Unable to reach backend at ${this.baseUrl} (${err.message})`,
          503,
          err.message,
          true
        );
      }

      throw new ApiError("Unknown network or client error occurred", 500, String(err), true);
    }
  }

  /**
   * Check backend application health and offline IERS status.
   * GET /health
   */
  public async checkHealth(timeoutMs = 5000): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health", { method: "GET" }, timeoutMs);
  }

  /**
   * Screen orbital objects for close approaches across a time window.
   * POST /api/v1/conjunctions/screen
   *
   * Enforces target_frame: "GCRS" and validates the raw JSON response
   * at runtime using assertGcrsScreeningResponse().
   * Defaults to a 30-second request timeout (30000 ms).
   */
  public async screenConjunctions(
    request: ConjunctionScreeningRequest,
    timeoutMs = 30000
  ): Promise<ConjunctionScreeningResponse> {
    // Explicitly enforce target_frame is GCRS
    const payload: ConjunctionScreeningRequest = {
      ...request,
      target_frame: "GCRS",
    };
    const rawData = await this.request<unknown>(
      "/api/v1/conjunctions/screen",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      timeoutMs
    );
    return assertGcrsScreeningResponse(rawData);
  }

  /**
   * Compute explainable heuristic risk score for a single screened conjunction event.
   * POST /api/v1/risk/assess
   */
  public async assessRisk(
    request: RiskAssessmentRequest,
    timeoutMs = 10000
  ): Promise<RiskAssessment> {
    return this.request<RiskAssessment>(
      "/api/v1/risk/assess",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
      timeoutMs
    );
  }

  /**
   * Batch evaluate multiple screened conjunction events under a unified evaluation epoch.
   * POST /api/v1/risk/assess-batch
   */
  public async assessRiskBatch(
    request: RiskAssessmentBatchRequest,
    timeoutMs = 10000
  ): Promise<RiskAssessmentBatchResponse> {
    return this.request<RiskAssessmentBatchResponse>(
      "/api/v1/risk/assess-batch",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
      timeoutMs
    );
  }

  /**
   * Simulate synthetic collision breakup and numerically propagate fragment trajectories.
   * POST /api/v1/simulation/breakup-and-propagate
   *
   * Validates the raw JSON response at runtime using assertBreakupAndPropagateResponse().
   * Defaults to a 30-second request timeout (30000 ms).
   */
  public async simulateBreakupAndPropagate(
    request: BreakupAndPropagateRequest,
    timeoutMs = 30000
  ): Promise<BreakupAndPropagateResponse> {
    const rawData = await this.request<unknown>(
      "/api/v1/simulation/breakup-and-propagate",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
      timeoutMs
    );
    return assertBreakupAndPropagateResponse(rawData);
  }

  /**
   * Simulate breakup, propagate fragments, select highest-mass CW-compliant target,
   * and compute a two-impulse Clohessy-Wiltshire rendezvous burn solution.
   * POST /api/v1/remediation/breakup-and-rendezvous
   *
   * Validates the raw JSON response at runtime using assertBreakupRemediationResponse().
   * Defaults to a 30-second request timeout (30000 ms).
   */
  public async planBreakupRemediation(
    request: BreakupRemediationRequest,
    timeoutMs = 30000
  ): Promise<BreakupRemediationResponse> {
    const rawData = await this.request<unknown>(
      "/api/v1/remediation/breakup-and-rendezvous",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
      timeoutMs
    );
    return assertBreakupRemediationResponse(rawData);
  }
}

// Global singleton instance configured for client-side consumption
export const apiClient = new ZorbitApiClient();

