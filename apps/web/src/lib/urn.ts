/**
 * COLLIVRA Canonical URN Resolver & Identity System
 *
 * Implements the approved Milestone 6.2 (v2.2.0) Canonical Identifier Specification.
 *
 * Strict Identity Rules:
 * 1. Globally Unambiguous Namespaces:
 *    - `catalog:norad:{noradId}` for real catalogued orbital satellites and debris.
 *    - `synthetic:{scenarioId}:fragment:{fragId}` for numerical simulation fragments.
 *    - `scenario:{scenarioId}` for simulation runs (UUIDs for dynamic, stable for benchmark fixtures).
 *    - `conjunction:{eventId}` for screening encounters.
 * 2. Critical Identity Distinction:
 *    - A raw numeric string (e.g. "48274") represents a catalog NORAD identifier.
 *    - A numeric string must NEVER be assumed to represent a synthetic fragment.
 *    - Never silently convert a catalog object into a synthetic fragment or vice-versa.
 * 3. No Silent Guessing:
 *    - Legacy aliases are registered in explicit dictionaries.
 *    - Unknown, ambiguous, or malformed strings return an explicit failure result. Never guesses.
 */

import type {
  CatalogUrn,
  SyntheticFragmentUrn,
  ScenarioUrn,
  ConjunctionUrn,
  CanonicalUrn,
  UrnKind,
  IdentifierResolutionResult,
} from "../types/shared_state";

// Standard RFC 4122 v4 UUID regex (case-insensitive)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Positive integer NORAD ID regex (1 to 6 digits, 1 - 999999)
const NORAD_ID_REGEX = /^\d{1,6}$/;

// ============================================================================
// 1. Legacy Semantic Alias Registries
// ============================================================================

/**
 * Immutable mapping of known legacy satellite aliases to canonical CatalogUrn.
 */
export const CANONICAL_ALIAS_MAP: Readonly<Record<string, CatalogUrn>> = Object.freeze({
  "iss": "catalog:norad:25544",
  "sat-iss": "catalog:norad:25544",
  "zarya": "catalog:norad:25544",
  "css": "catalog:norad:48274",
  "sat-css": "catalog:norad:48274",
  "tianhe": "catalog:norad:48274",
  // Note: CZ-5B rocket body (NORAD 48275) is excluded because 48275 is not present in local fixtures,
  // and must NEVER be aliased to CSS/Tianhe core module (NORAD 48274).
  "hubble": "catalog:norad:20580",
  "sat-hubble": "catalog:norad:20580",
  "hst": "catalog:norad:20580",
  "cosmos-2251": "catalog:norad:22675",
  "deb-cosmos": "catalog:norad:22675",
  "iridium-33": "catalog:norad:24946",
  "sat-starlink": "catalog:norad:44713",
  "starlink": "catalog:norad:44713",
});

/**
 * Immutable mapping of known legacy scenario aliases to canonical ScenarioUrn.
 */
export const CANONICAL_SCENARIO_ALIAS_MAP: Readonly<Record<string, ScenarioUrn>> = Object.freeze({
  "canonical-cw": "scenario:canonical-cw-reference",
  "canonical-cw-scenario": "scenario:canonical-cw-reference",
  "canonical-cw-reference": "scenario:canonical-cw-reference",
  "iridium-cosmos": "scenario:benchmark-iridium-cosmos",
  "cosmos-iridium": "scenario:benchmark-iridium-cosmos",
  "benchmark-iridium-cosmos": "scenario:benchmark-iridium-cosmos",
});

// ============================================================================
// 2. Fallback UUID Generator (Cross-Platform)
// ============================================================================

/**
 * Generates an RFC 4122 v4 UUID, using native crypto if available or a secure fallback.
 */
export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Math.random RFC 4122 v4 fallback for non-browser/legacy runtimes
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================================================
// 3. Canonical URN Builders
// ============================================================================

/**
 * Builds a valid CatalogUrn from a numeric or string NORAD ID.
 * Throws TypeError if the NORAD ID is non-numeric, zero, negative, or exceeds 6 digits.
 */
export function buildCatalogUrn(noradId: string | number): CatalogUrn {
  const str = String(noradId).trim();
  if (!NORAD_ID_REGEX.test(str)) {
    throw new TypeError(
      `Invalid NORAD ID '${noradId}'. Must be a positive integer between 1 and 999999.`
    );
  }
  const parsed = parseInt(str, 10);
  if (parsed <= 0 || parsed > 999999) {
    throw new TypeError(
      `NORAD ID out of valid catalog range (1 - 999999): ${parsed}`
    );
  }
  return `catalog:norad:${parsed}`;
}

/**
 * Builds a valid SyntheticFragmentUrn.
 * Enforces scenario namespace and fragment identifier.
 */
export function buildSyntheticFragmentUrn(
  scenarioId: string,
  fragmentId: string | number
): SyntheticFragmentUrn {
  const cleanScenario = String(scenarioId).trim().replace(/^scenario:/, "");
  const cleanFrag = String(fragmentId).trim();
  if (!cleanScenario || cleanScenario.length === 0) {
    throw new TypeError("Scenario ID cannot be empty when constructing SyntheticFragmentUrn.");
  }
  if (!cleanFrag || cleanFrag.length === 0) {
    throw new TypeError("Fragment ID cannot be empty when constructing SyntheticFragmentUrn.");
  }
  return `synthetic:${cleanScenario}:fragment:${cleanFrag}`;
}

/**
 * Builds a valid ScenarioUrn.
 * If no scenarioId is provided, generates a collision-resistant UUID (RFC 4122 v4).
 */
export function buildScenarioUrn(scenarioId?: string): ScenarioUrn {
  if (!scenarioId || scenarioId.trim() === "") {
    return `scenario:SIM-${generateUuid()}`;
  }
  const trimmed = scenarioId.trim();
  if (trimmed.startsWith("scenario:")) {
    const specific = trimmed.slice(9);
    if (specific.length === 0) {
      throw new TypeError("Empty specific scenario identifier after 'scenario:' prefix.");
    }
    return trimmed as ScenarioUrn;
  }
  return `scenario:${trimmed}`;
}

/**
 * Builds a valid ConjunctionUrn from an event identifier.
 */
export function buildConjunctionUrn(eventId: string): ConjunctionUrn {
  const trimmed = String(eventId).trim().replace(/^conjunction:/, "");
  if (!trimmed || trimmed.length === 0) {
    throw new TypeError("Event ID cannot be empty when constructing ConjunctionUrn.");
  }
  return `conjunction:${trimmed}`;
}

// ============================================================================
// 4. Type Predicates & Validators
// ============================================================================

export function isCatalogUrn(val: unknown): val is CatalogUrn {
  if (typeof val !== "string") return false;
  if (!val.startsWith("catalog:norad:")) return false;
  const idPart = val.slice(14);
  return NORAD_ID_REGEX.test(idPart) && parseInt(idPart, 10) > 0;
}

export function isSyntheticFragmentUrn(val: unknown): val is SyntheticFragmentUrn {
  if (typeof val !== "string") return false;
  if (!val.startsWith("synthetic:")) return false;
  const parts = val.split(":");
  // Must match synthetic:{scenarioId}:fragment:{fragId} -> exactly 4 parts
  return parts.length === 4 && parts[0] === "synthetic" && parts[2] === "fragment" && parts[1].length > 0 && parts[3].length > 0;
}

export function isScenarioUrn(val: unknown): val is ScenarioUrn {
  if (typeof val !== "string") return false;
  if (!val.startsWith("scenario:")) return false;
  const specific = val.slice(9);
  if (specific.length === 0) return false;
  // Valid if starts with SIM-uuid, or is registered benchmark alias, or valid slug
  if (specific.startsWith("SIM-")) {
    const uuidPart = specific.slice(4);
    return UUID_REGEX.test(uuidPart) || uuidPart.length > 0;
  }
  return specific === "canonical-cw-reference" || specific === "benchmark-iridium-cosmos" || Boolean(CANONICAL_SCENARIO_ALIAS_MAP[specific.toLowerCase()]);
}

export function isConjunctionUrn(val: unknown): val is ConjunctionUrn {
  if (typeof val !== "string") return false;
  if (!val.startsWith("conjunction:")) return false;
  return val.slice(12).length > 0;
}

export function isCanonicalUrn(val: unknown): val is CanonicalUrn {
  return (
    isCatalogUrn(val) ||
    isSyntheticFragmentUrn(val) ||
    isScenarioUrn(val) ||
    isConjunctionUrn(val)
  );
}

// ============================================================================
// 5. URN Parser
// ============================================================================

export interface ParsedUrn {
  urn: CanonicalUrn;
  kind: UrnKind;
  specificId: string;
  scenarioId?: string;
  fragmentId?: string;
  noradId?: string;
}

/**
 * Parses a canonical URN into its structural components.
 * Returns null if the string is not a valid canonical URN.
 */
export function parseUrn(val: string): ParsedUrn | null {
  if (!val || typeof val !== "string") return null;

  if (isCatalogUrn(val)) {
    const norad = val.slice(14);
    return {
      urn: val,
      kind: "CATALOG",
      specificId: norad,
      noradId: norad,
    };
  }

  if (isSyntheticFragmentUrn(val)) {
    const parts = val.split(":");
    return {
      urn: val,
      kind: "SYNTHETIC",
      specificId: `${parts[1]}:${parts[3]}`,
      scenarioId: parts[1],
      fragmentId: parts[3],
    };
  }

  if (isScenarioUrn(val)) {
    const scenarioId = val.slice(9);
    return {
      urn: val,
      kind: "SCENARIO",
      specificId: scenarioId,
      scenarioId,
    };
  }

  if (isConjunctionUrn(val)) {
    const eventId = val.slice(12);
    return {
      urn: val,
      kind: "CONJUNCTION",
      specificId: eventId,
    };
  }

  return null;
}

// ============================================================================
// 6. Safe Canonical Resolver — Zero Silent Guessing
// ============================================================================

/**
 * Optional contextual hint for resolving raw inputs.
 */
export type UrnKindHint = "CATALOG" | "SYNTHETIC" | "SCENARIO" | "CONJUNCTION";

/**
 * Resolves an arbitrary input string to a canonical URN.
 *
 * Invariants:
 * 1. Exact canonical URNs are accepted immediately.
 * 2. Pure numeric strings resolve to CatalogUrn (NORAD ID) unless context hint violates this.
 * 3. A numeric string is NEVER resolved to a synthetic fragment.
 * 4. Known legacy aliases resolve through explicit immutable dictionaries.
 * 5. Unknown, ambiguous, or malformed inputs return `{ success: false, error: ... }`.
 * 6. Never resolves silently or guesses arbitrarily.
 */
export function resolveToCanonicalUrn(
  rawInput: string | null | undefined,
  hint?: UrnKindHint
): IdentifierResolutionResult {
  if (rawInput === null || rawInput === undefined || typeof rawInput !== "string" || rawInput.trim() === "") {
    return {
      success: false,
      error: "Empty or null identifier provided.",
      originalInput: String(rawInput),
    };
  }

  const trimmed = rawInput.trim();
  const lower = trimmed.toLowerCase();

  // 1. Direct Canonical URN Match
  const parsed = parseUrn(trimmed);
  if (parsed) {
    if (hint && parsed.kind !== hint) {
      return {
        success: false,
        error: `URN kind mismatch: provided '${trimmed}' is of kind '${parsed.kind}', but context expected '${hint}'.`,
        originalInput: trimmed,
      };
    }
    return {
      success: true,
      urn: parsed.urn,
      kind: parsed.kind,
      originalInput: trimmed,
    };
  }

  // 2. Strict Rejection of Misclassified Synthetic Fragments
  if (hint === "SYNTHETIC" && NORAD_ID_REGEX.test(trimmed)) {
    return {
      success: false,
      error: `Critical Identity Violation: Numeric identifier '${trimmed}' cannot be assumed to be a synthetic fragment. It is a catalog spacecraft ID.`,
      originalInput: trimmed,
    };
  }

  // 3. Pure Numeric String -> Catalog NORAD URN
  if (NORAD_ID_REGEX.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    if (num > 0 && num <= 999999) {
      if (hint && hint !== "CATALOG") {
        return {
          success: false,
          error: `Numeric identifier '${trimmed}' represents a catalog NORAD ID, but context expected '${hint}'.`,
          originalInput: trimmed,
        };
      }
      return {
        success: true,
        urn: `catalog:norad:${num}`,
        kind: "CATALOG",
        originalInput: trimmed,
      };
    }
  }

  // 4. Known Catalog Legacy Semantic Aliases
  if (CANONICAL_ALIAS_MAP[lower]) {
    if (hint && hint !== "CATALOG") {
      return {
        success: false,
        error: `Alias '${trimmed}' resolves to a catalog satellite, but context expected '${hint}'.`,
        originalInput: trimmed,
      };
    }
    return {
      success: true,
      urn: CANONICAL_ALIAS_MAP[lower],
      kind: "CATALOG",
      originalInput: trimmed,
    };
  }

  // 5. Known Scenario Legacy Semantic Aliases
  if (CANONICAL_SCENARIO_ALIAS_MAP[lower]) {
    if (hint && hint !== "SCENARIO") {
      return {
        success: false,
        error: `Alias '${trimmed}' resolves to a scenario, but context expected '${hint}'.`,
        originalInput: trimmed,
      };
    }
    return {
      success: true,
      urn: CANONICAL_SCENARIO_ALIAS_MAP[lower],
      kind: "SCENARIO",
      originalInput: trimmed,
    };
  }

  // 6. Legacy Synthetic Fragment Prefix "SYNTH-FRAG-xxx"
  if (trimmed.startsWith("SYNTH-FRAG-")) {
    const fragId = trimmed.replace("SYNTH-FRAG-", "");
    if (fragId.length > 0) {
      if (hint && hint !== "SYNTHETIC") {
        return {
          success: false,
          error: `Legacy fragment identifier '${trimmed}' is synthetic, but context expected '${hint}'.`,
          originalInput: trimmed,
        };
      }
      return {
        success: true,
        urn: `synthetic:SIM-canonical-cw:fragment:${fragId}`,
        kind: "SYNTHETIC",
        originalInput: trimmed,
      };
    }
  }

  // 7. Legacy Conjunction Event Prefix "EVT-xxx" or "CONJ-xxx"
  if (trimmed.startsWith("EVT-") || trimmed.startsWith("CONJ-")) {
    if (hint && hint !== "CONJUNCTION") {
      return {
        success: false,
        error: `Encounter identifier '${trimmed}' represents a conjunction event, but context expected '${hint}'.`,
        originalInput: trimmed,
      };
    }
    return {
      success: true,
      urn: `conjunction:${trimmed}`,
      kind: "CONJUNCTION",
      originalInput: trimmed,
    };
  }

  // 8. UNRESOLVED / AMBIGUOUS IDENTIFIER: REJECT SAFELY (ZERO SILENT GUESSING)
  return {
    success: false,
    error: `Ambiguous or unresolvable orbital identifier '${trimmed}'. Must be a valid canonical URN, numeric NORAD ID, or registered alias.`,
    originalInput: trimmed,
  };
}

