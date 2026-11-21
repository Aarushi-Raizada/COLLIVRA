/**
 * COLLIVRA Error Hierarchy
 *
 * Centralized error classes for API, network, and contract validation errors.
 */

export class ApiError extends Error {
  public status: number;
  public detail: string;
  public isNetworkError: boolean;

  constructor(message: string, status = 500, detail?: string, isNetworkError = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail || message;
    this.isNetworkError = isNetworkError;
  }
}

/**
 * Structured API error thrown when the backend rejects a calculation
 * violating the active Earth orientation parameter (IERS) policy.
 * Corresponds to HTTP 422 with code "EARTH_ORIENTATION_POLICY_VIOLATION".
 */
export class EarthOrientationPolicyApiError extends ApiError {
  public code: "EARTH_ORIENTATION_POLICY_VIOLATION";
  public epoch: string | null;
  public dataSource: string;
  public policyDetails: Record<string, unknown>;

  constructor(payload: {
    detail: string;
    epoch?: string | null;
    data_source: string;
    details?: Record<string, unknown>;
  }) {
    super(
      `Earth Orientation Policy Violation: ${payload.detail} (epoch: ${payload.epoch || "null"}, data_source: ${payload.data_source})`,
      422,
      payload.detail,
      false
    );
    this.name = "EarthOrientationPolicyApiError";
    this.code = "EARTH_ORIENTATION_POLICY_VIOLATION";
    this.epoch = payload.epoch ?? null;
    this.dataSource = payload.data_source;
    this.policyDetails = payload.details || {};
  }
}

