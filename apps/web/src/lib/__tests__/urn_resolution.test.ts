/**
 * ZORBIT Canonical URN Resolver & Identity System — Unit Test Suite
 *
 * Validates:
 * 1. Canonical URN builders (Catalog, Synthetic Fragment, Scenario, Conjunction).
 * 2. Canonical URN validators & type predicates.
 * 3. Registered legacy semantic alias dictionary mapping.
 * 4. Critical identity rule: numeric strings are catalog IDs, NEVER synthetic fragments.
 * 5. Strict rejection of unknown, ambiguous, malformed, or empty tokens (zero silent guessing).
 * 6. Dynamic UUID scenario URN generation and stable benchmark fixture URN validation.
 */

import {
  buildCatalogUrn,
  buildSyntheticFragmentUrn,
  buildScenarioUrn,
  buildConjunctionUrn,
  isCatalogUrn,
  isSyntheticFragmentUrn,
  isScenarioUrn,
  isConjunctionUrn,
  isCanonicalUrn,
  parseUrn,
  resolveToCanonicalUrn,
  CANONICAL_ALIAS_MAP,
  CANONICAL_SCENARIO_ALIAS_MAP,
} from "../urn";
import type {
  CanonicalUrn,
  UrnKind,
  IdentifierResolutionResult,
} from "../../types/shared_state";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function assertSuccess(
  res: IdentifierResolutionResult,
  msg?: string
): asserts res is { success: true; urn: CanonicalUrn; kind: UrnKind; originalInput: string } {
  if (!res.success) {
    throw new Error(msg || `Expected success, received error: ${res.error}`);
  }
}

function assertFailure(
  res: IdentifierResolutionResult,
  msg?: string
): asserts res is { success: false; error: string; originalInput: string } {
  if (res.success) {
    throw new Error(msg || `Expected failure, received urn: ${res.urn}`);
  }
}

function expectUrn(rawInput: string, hint?: "CATALOG" | "SYNTHETIC" | "SCENARIO" | "CONJUNCTION"): CanonicalUrn {
  const res = resolveToCanonicalUrn(rawInput, hint);
  assertSuccess(res);
  return res.urn;
}

export function runUrnTests(): { passed: number; total: number; details: string[] } {
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

  // =========================================================================
  // 1. URN Builders
  // =========================================================================

  test("buildCatalogUrn creates valid catalog URN from numeric and string input", () => {
    assert(buildCatalogUrn(25544) === "catalog:norad:25544", "Should format number to URN");
    assert(buildCatalogUrn("25544") === "catalog:norad:25544", "Should format string to URN");
    assert(buildCatalogUrn(" 48274 ") === "catalog:norad:48274", "Should trim whitespace");
  });

  test("buildCatalogUrn rejects zero, negative, and non-numeric inputs", () => {
    let err0 = false;
    try { buildCatalogUrn(0); } catch { err0 = true; }
    assert(err0, "Zero NORAD ID must be rejected");

    let errNeg = false;
    try { buildCatalogUrn(-100); } catch { errNeg = true; }
    assert(errNeg, "Negative NORAD ID must be rejected");

    let errStr = false;
    try { buildCatalogUrn("invalid"); } catch { errStr = true; }
    assert(errStr, "Non-numeric string must be rejected");
  });

  test("buildSyntheticFragmentUrn creates properly namespaced fragment URN", () => {
    const urn = buildSyntheticFragmentUrn("SIM-001", "042");
    assert(urn === "synthetic:SIM-001:fragment:042", "Must match synthetic:{scenario}:fragment:{id}");

    const urnWithPrefix = buildSyntheticFragmentUrn("scenario:SIM-001", "FRAG-7");
    assert(urnWithPrefix === "synthetic:SIM-001:fragment:FRAG-7", "Must strip duplicate scenario: prefix");
  });

  test("buildScenarioUrn generates collision-resistant UUID URN when no ID is provided", () => {
    const urn1 = buildScenarioUrn();
    const urn2 = buildScenarioUrn();
    assert(urn1.startsWith("scenario:SIM-"), "Must start with scenario:SIM-");
    assert(urn2.startsWith("scenario:SIM-"), "Must start with scenario:SIM-");
    assert(urn1 !== urn2, "Generated UUID scenario URNs must be unique");
  });

  test("buildScenarioUrn preserves provided scenario identifier", () => {
    const urn = buildScenarioUrn("canonical-cw-reference");
    assert(urn === "scenario:canonical-cw-reference", "Should format provided slug");

    const urnAlreadyPrefixed = buildScenarioUrn("scenario:benchmark-iridium-cosmos");
    assert(urnAlreadyPrefixed === "scenario:benchmark-iridium-cosmos", "Should preserve existing prefix");
  });

  test("buildConjunctionUrn creates properly formatted event URN", () => {
    const urn = buildConjunctionUrn("EVT-2026-001");
    assert(urn === "conjunction:EVT-2026-001", "Must match conjunction:{eventId}");
  });

  // =========================================================================
  // 2. Type Predicates & Parsing
  // =========================================================================

  test("isCatalogUrn strictly validates catalog URN syntax", () => {
    assert(isCatalogUrn("catalog:norad:25544") === true, "Valid catalog URN must pass");
    assert(isCatalogUrn("catalog:norad:0") === false, "Zero NORAD must fail");
    assert(isCatalogUrn("catalog:norad:abc") === false, "Non-numeric NORAD must fail");
    assert(isCatalogUrn("synthetic:SIM-001:fragment:001") === false, "Fragment URN is not catalog URN");
  });

  test("isSyntheticFragmentUrn validates 4-part fragment URN syntax", () => {
    assert(isSyntheticFragmentUrn("synthetic:SIM-001:fragment:042") === true, "Valid fragment URN must pass");
    assert(isSyntheticFragmentUrn("synthetic:SIM-001:042") === false, "Missing fragment segment must fail");
    assert(isSyntheticFragmentUrn("catalog:norad:25544") === false, "Catalog URN is not fragment URN");
  });

  test("isScenarioUrn validates UUID and canonical benchmark fixtures", () => {
    assert(isScenarioUrn("scenario:canonical-cw-reference") === true, "Canonical fixture must pass");
    assert(isScenarioUrn("scenario:SIM-123e4567-e89b-12d3-a456-426614174000") === true, "UUID scenario must pass");
    assert(isScenarioUrn("scenario:") === false, "Empty scenario ID must fail");
  });

  test("isConjunctionUrn validates encounter URN syntax", () => {
    assert(isConjunctionUrn("conjunction:EVT-2026-001") === true, "Valid conjunction URN must pass");
    assert(isConjunctionUrn("conjunction:") === false, "Empty event ID must fail");
  });

  test("parseUrn correctly extracts structural components", () => {
    const parsedCat = parseUrn("catalog:norad:25544");
    assert(parsedCat?.kind === "CATALOG", "Kind must be CATALOG");
    assert(parsedCat?.noradId === "25544", "noradId must be 25544");

    const parsedFrag = parseUrn("synthetic:SIM-001:fragment:42");
    assert(parsedFrag?.kind === "SYNTHETIC", "Kind must be SYNTHETIC");
    assert(parsedFrag?.scenarioId === "SIM-001", "scenarioId must match");
    assert(parsedFrag?.fragmentId === "42", "fragmentId must match");

    const parsedInvalid = parseUrn("invalid:foo:bar");
    assert(parsedInvalid === null, "Invalid URN must return null");
  });

  // =========================================================================
  // 3. Resolver: Exact Canonical URNs
  // =========================================================================

  test("resolveToCanonicalUrn resolves exact canonical URNs immediately", () => {
    const r1 = resolveToCanonicalUrn("catalog:norad:25544");
    assertSuccess(r1);
    assert(r1.urn === "catalog:norad:25544", "Direct catalog URN");

    const r2 = resolveToCanonicalUrn("synthetic:SIM-001:fragment:12");
    assertSuccess(r2);
    assert(r2.urn === "synthetic:SIM-001:fragment:12", "Direct fragment URN");

    const r3 = resolveToCanonicalUrn("scenario:canonical-cw-reference");
    assertSuccess(r3);
    assert(r3.urn === "scenario:canonical-cw-reference", "Direct scenario URN");

    const r4 = resolveToCanonicalUrn("conjunction:EVT-2026-001");
    assertSuccess(r4);
    assert(r4.urn === "conjunction:EVT-2026-001", "Direct conjunction URN");
  });

  // =========================================================================
  // 4. Critical Identity Rule: Numeric String vs. Synthetic Fragment
  // =========================================================================

  test("Critical Identity Rule: numeric string is catalog NORAD ID, NEVER synthetic fragment", () => {
    // Pure numeric string resolves to CatalogUrn
    const r = resolveToCanonicalUrn("48274");
    assertSuccess(r, "Numeric string must resolve");
    assert(r.kind === "CATALOG", "Numeric string MUST be classified as CATALOG");
    assert(r.urn === "catalog:norad:48274", "Numeric string MUST format as catalog:norad:48274");

    // Critical guardrail: attempting to resolve a numeric string under SYNTHETIC hint MUST fail explicitly!
    const rSynth = resolveToCanonicalUrn("48274", "SYNTHETIC");
    assertFailure(rSynth, "Numeric string cannot be converted into synthetic fragment");
    assert(
      rSynth.error.includes("Critical Identity Violation"),
      "Error must explicitly cite identity violation"
    );
  });

  // =========================================================================
  // 5. Legacy Semantic Alias Resolution
  // =========================================================================

  test("resolveToCanonicalUrn resolves known catalog aliases", () => {
    assert(expectUrn("sat-iss") === "catalog:norad:25544", "sat-iss -> ISS");
    assert(expectUrn("iss") === "catalog:norad:25544", "iss -> ISS");
    assert(expectUrn("sat-css") === "catalog:norad:48274", "sat-css -> CSS");
    assert(expectUrn("css") === "catalog:norad:48274", "css -> CSS");
    assert(expectUrn("tianhe") === "catalog:norad:48274", "tianhe -> CSS");
    assert(expectUrn("hubble") === "catalog:norad:20580", "hubble -> HST");
    assert(expectUrn("sat-hubble") === "catalog:norad:20580", "sat-hubble -> HST");
    assert(expectUrn("cosmos-2251") === "catalog:norad:22675", "cosmos-2251 -> Cosmos");
    assert(expectUrn("deb-cosmos") === "catalog:norad:22675", "deb-cosmos -> Cosmos");
  });

  test("Regression: CZ-5B cannot resolve to CSS/Tianhe and bare tiangong remains unresolved", () => {
    // CZ-5B rocket body is NORAD 48275, NOT 48274. Since 48275 is absent from fixtures, it must fail safely.
    const rCz5b = resolveToCanonicalUrn("cz-5b");
    assertFailure(rCz5b, "cz-5b must not resolve successfully without catalog record");
    assert(rCz5b.error.includes("Ambiguous or unresolvable"), "cz-5b reports unresolvable");

    const rSatCz5b = resolveToCanonicalUrn("sat-cz5b");
    assertFailure(rSatCz5b, "sat-cz5b must not resolve successfully");
    assert(rSatCz5b.error.includes("Ambiguous or unresolvable"), "sat-cz5b reports unresolvable");

    // Bare "tiangong" is historically polysemous (Tiangong-1, 2, CSS) and must remain unresolved without explicit qualifier
    const rTiangong = resolveToCanonicalUrn("tiangong");
    assertFailure(rTiangong, "bare tiangong must remain unresolved to prevent historic ambiguity");
    assert(rTiangong.error.includes("Ambiguous or unresolvable"), "tiangong reports unresolvable");

    // Valid CSS aliases continue to resolve strictly to NORAD 48274
    assert(expectUrn("css") === "catalog:norad:48274", "css resolves to 48274");
    assert(expectUrn("tianhe") === "catalog:norad:48274", "tianhe resolves to 48274");
  });

  test("resolveToCanonicalUrn handles uppercase and mixed-case aliases cleanly", () => {
    assert(expectUrn("ISS") === "catalog:norad:25544", "Uppercase ISS");
    assert(expectUrn("Sat-ISS") === "catalog:norad:25544", "Mixed-case Sat-ISS");
    assert(expectUrn("CSS") === "catalog:norad:48274", "Uppercase CSS");
    assert(expectUrn("TianHe") === "catalog:norad:48274", "Mixed-case TianHe");
    assert(expectUrn("HuBBlE") === "catalog:norad:20580", "Mixed-case HuBBlE");
    assert(
      expectUrn("CANONICAL-CW") === "scenario:canonical-cw-reference",
      "Uppercase CANONICAL-CW"
    );
    assert(
      expectUrn("Iridium-Cosmos") === "scenario:benchmark-iridium-cosmos",
      "Mixed-case Iridium-Cosmos"
    );
  });

  test("resolveToCanonicalUrn resolves known scenario aliases", () => {
    assert(
      expectUrn("canonical-cw") === "scenario:canonical-cw-reference",
      "canonical-cw -> scenario:canonical-cw-reference"
    );
    assert(
      expectUrn("iridium-cosmos") === "scenario:benchmark-iridium-cosmos",
      "iridium-cosmos -> scenario:benchmark-iridium-cosmos"
    );
  });

  test("resolveToCanonicalUrn resolves legacy SYNTH-FRAG-xxx prefix with default scenario namespace", () => {
    const r = resolveToCanonicalUrn("SYNTH-FRAG-001");
    assertSuccess(r, "Legacy synthetic prefix must resolve");
    assert(r.kind === "SYNTHETIC", "Kind must be SYNTHETIC");
    assert(r.urn === "synthetic:SIM-canonical-cw:fragment:001", "Should map to canonical CW scenario namespace");
  });

  // =========================================================================
  // 6. Zero Silent Guessing: Strict Rejection of Ambiguous / Unknown Inputs
  // =========================================================================

  test("resolveToCanonicalUrn rejects empty, null, and undefined inputs safely", () => {
    assert(resolveToCanonicalUrn(null).success === false, "null rejected");
    assert(resolveToCanonicalUrn(undefined).success === false, "undefined rejected");
    assert(resolveToCanonicalUrn("").success === false, "empty string rejected");
    assert(resolveToCanonicalUrn("   ").success === false, "whitespace rejected");
  });

  test("resolveToCanonicalUrn rejects unknown and ambiguous tokens without guessing", () => {
    const rUnknown = resolveToCanonicalUrn("unknown-spacecraft-999");
    assertFailure(rUnknown, "Unknown satellite string must fail");
    assert(rUnknown.error.includes("Ambiguous or unresolvable"), "Must report unresolvable error");

    const rAmbiguous = resolveToCanonicalUrn("satellite");
    assertFailure(rAmbiguous, "Ambiguous generic word must fail");

    const rMalformed = resolveToCanonicalUrn("catalog:norad:-55");
    assertFailure(rMalformed, "Negative NORAD URN must fail");
  });

  return { passed, total, details };
}

