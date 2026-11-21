/**
 * COLLIVRA Design System & Application Shell — Unit & Integration Test Suite
 *
 * Implements and verifies Milestone AST-01C.1 acceptance criteria:
 * 1. Brand identity, tagline, team attribution, and platform description.
 * 2. Six-pillar navigation structure and pillar-to-route mappings.
 * 3. Subtab routing integration for Debris Evolution (breakup) vs Mitigation & Sustainability (remediation).
 * 4. URL query parameter serialization and deserialization for all six pillars.
 * 5. Preservation of deep linking (objectId, eventId, scenarioId) across pillar navigation.
 * 6. Responsive design token alignment (Deep Space #050816 theme tokens).
 */

import { COLLIVRA_BRAND } from "../brand";
import {
  parseUrlNavigationalState,
  buildNavigationalQueryString,
  buildNavigationalUrl,
  VALID_TABS,
  VALID_SUBTABS,
} from "../navigation";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

export function runCollivraShellTests(): { passed: number; total: number; details: string[] } {
  let passed = 0;
  let total = 0;
  const details: string[] = [];

  function test(name: string, fn: () => void) {
    total++;
    try {
      fn();
      passed++;
      details.push(`  ✓ ${name}`);
    } catch (e: any) {
      details.push(`  ✗ ${name}: ${e.message}`);
    }
  }

  // ============================================================================
  // Test Suite 1: Brand Identity & Attribution Constants
  // ============================================================================

  test("1. Brand constants strictly reflect COLLIVRA identity", () => {
    assert(COLLIVRA_BRAND.name === "COLLIVRA", "Product name must be COLLIVRA");
    assert(
      COLLIVRA_BRAND.tagline === "See the risk. Secure the orbit.",
      "Tagline must match 'See the risk. Secure the orbit.'"
    );
    assert(COLLIVRA_BRAND.team === "Team Errorists", "Team must be Team Errorists");
    assert(COLLIVRA_BRAND.hackathon === "ASTRA 2026", "Hackathon must be ASTRA 2026");
    assert(COLLIVRA_BRAND.institution === "VIT Bhopal", "Institution must be VIT Bhopal");
    assert(
      COLLIVRA_BRAND.fullAttribution.includes("Team Errorists") &&
      COLLIVRA_BRAND.fullAttribution.includes("ASTRA 2026") &&
      COLLIVRA_BRAND.fullAttribution.includes("VIT Bhopal"),
      "Full attribution must include team, hackathon, and institution"
    );
  });

  test("2. Deep Space color theme tokens match aerospace design requirements", () => {
    assert(COLLIVRA_BRAND.theme.spaceBg === "#050816", "spaceBg must be #050816");
    assert(COLLIVRA_BRAND.theme.surfaceCard === "#0b112c", "surfaceCard must be #0b112c");
    assert(COLLIVRA_BRAND.theme.borderSubtle === "#1e293b", "borderSubtle must be #1e293b");
  });

  // ============================================================================
  // Test Suite 2: Six Product Pillars Architecture
  // ============================================================================

  test("3. Exactly six product pillars are defined in sequential order", () => {
    assert(COLLIVRA_BRAND.pillars.length === 6, "Must define exactly 6 product pillars");
    const numbers = COLLIVRA_BRAND.pillars.map((p) => p.number);
    assert(
      JSON.stringify(numbers) === JSON.stringify(["01", "02", "03", "04", "05", "06"]),
      "Pillars must be numbered 01 through 06 sequentially"
    );
  });

  test("4. Pillar 01: Mission & Orbital Overview routes to tab='overview'", () => {
    const p1 = COLLIVRA_BRAND.pillars[0];
    assert(p1.tab === "overview", "Pillar 01 tab must be overview");
    assert(p1.subtab === null, "Pillar 01 subtab must be null");
    assert(p1.title === "Mission & Orbital Overview", "Pillar 01 title matches");
    assert(VALID_TABS.includes(p1.tab), "Pillar 01 tab must be a valid NavigationTab");
  });

  test("5. Pillar 02: Orbital Environment Explorer routes to tab='radar'", () => {
    const p2 = COLLIVRA_BRAND.pillars[1];
    assert(p2.tab === "radar", "Pillar 02 tab must be radar");
    assert(p2.subtab === null, "Pillar 02 subtab must be null");
    assert(p2.title === "Orbital Environment Explorer", "Pillar 02 title matches");
    assert(VALID_TABS.includes(p2.tab), "Pillar 02 tab must be a valid NavigationTab");
  });

  test("6. Pillar 03: Collision Intelligence routes to tab='conjunctions'", () => {
    const p3 = COLLIVRA_BRAND.pillars[2];
    assert(p3.tab === "conjunctions", "Pillar 03 tab must be conjunctions");
    assert(p3.subtab === null, "Pillar 03 subtab must be null");
    assert(p3.title === "Collision Intelligence", "Pillar 03 title matches");
    assert(VALID_TABS.includes(p3.tab), "Pillar 03 tab must be a valid NavigationTab");
  });

  test("7. Pillar 04: Debris Evolution Laboratory routes to tab='simulation' & subtab='breakup'", () => {
    const p4 = COLLIVRA_BRAND.pillars[3];
    assert(p4.tab === "simulation", "Pillar 04 tab must be simulation");
    assert(p4.subtab === "breakup", "Pillar 04 subtab must be breakup");
    assert(p4.title === "Debris Evolution Laboratory", "Pillar 04 title matches");
    assert(VALID_SUBTABS.includes("breakup"), "breakup must be a valid SimulationSubtab");
  });

  test("8. Pillar 05: Mitigation & Sustainability routes to tab='simulation' & subtab='remediation'", () => {
    const p5 = COLLIVRA_BRAND.pillars[4];
    assert(p5.tab === "simulation", "Pillar 05 tab must be simulation");
    assert(p5.subtab === "remediation", "Pillar 05 subtab must be remediation");
    assert(p5.title === "Mitigation & Sustainability", "Pillar 05 title matches");
    assert(VALID_SUBTABS.includes("remediation"), "remediation must be a valid SimulationSubtab");
  });

  test("9. Pillar 06: System & Data Integrity routes to tab='system'", () => {
    const p6 = COLLIVRA_BRAND.pillars[5];
    assert(p6.tab === "system", "Pillar 06 tab must be system");
    assert(p6.subtab === null, "Pillar 06 subtab must be null");
    assert(p6.title === "System & Data Integrity", "Pillar 06 title matches");
    assert(VALID_TABS.includes(p6.tab), "Pillar 06 tab must be a valid NavigationTab");
  });

  // ============================================================================
  // Test Suite 3: URL Serialization & Deep Linking for All Six Pillars
  // ============================================================================

  test("10. URL generation produces canonical search queries for all six pillars", () => {
    for (const pillar of COLLIVRA_BRAND.pillars) {
      const url = buildNavigationalUrl("/", {
        tab: pillar.tab,
        subtab: pillar.subtab,
      });

      assert(url.startsWith("/?tab=" + pillar.tab), `URL for ${pillar.title} must have tab=${pillar.tab}`);
      if (pillar.subtab) {
        assert(
          url.includes(`subtab=${pillar.subtab}`),
          `URL for ${pillar.title} must include subtab=${pillar.subtab}`
        );
      } else {
        assert(
          !url.includes("subtab="),
          `URL for ${pillar.title} must not include subtab when subtab is null`
        );
      }
    }
  });

  test("11. URL parsing reconstructs exact pillar state from query string", () => {
    for (const pillar of COLLIVRA_BRAND.pillars) {
      const query = buildNavigationalQueryString({
        tab: pillar.tab,
        subtab: pillar.subtab,
      });

      const parsed = parseUrlNavigationalState(query);
      assert(parsed.invalidParams.length === 0, `Query '${query}' must have 0 invalid params`);
      assert(parsed.state.tab === pillar.tab, `Parsed tab must match pillar.tab (${pillar.tab})`);
      assert(parsed.state.subtab === pillar.subtab, `Parsed subtab must match pillar.subtab (${pillar.subtab})`);
    }
  });

  test("12. Subtab switching between Pillar 04 and Pillar 05 preserves deep link context", () => {
    // When in Pillar 04 with a selected scenario
    const queryPillar4 = buildNavigationalQueryString({
      tab: "simulation",
      subtab: "breakup",
      scenarioId: "scenario:canonical-cw-reference",
    });
    const parsed4 = parseUrlNavigationalState(queryPillar4);
    assert(parsed4.state.tab === "simulation", "Tab is simulation");
    assert(parsed4.state.subtab === "breakup", "Subtab is breakup");
    assert(parsed4.state.scenarioId === "scenario:canonical-cw-reference", "Scenario preserved");

    // When switching to Pillar 05 (remediation)
    const queryPillar5 = buildNavigationalQueryString({
      tab: "simulation",
      subtab: "remediation",
      scenarioId: "scenario:canonical-cw-reference",
    });
    const parsed5 = parseUrlNavigationalState(queryPillar5);
    assert(parsed5.state.tab === "simulation", "Tab remains simulation");
    assert(parsed5.state.subtab === "remediation", "Subtab updated to remediation");
    assert(parsed5.state.scenarioId === "scenario:canonical-cw-reference", "Scenario preserved across subtab switch");
  });

  test("13. Invalid subtab gracefully drops while retaining valid simulation tab", () => {
    const parsed = parseUrlNavigationalState("?tab=simulation&subtab=nonexistent");
    assert(parsed.invalidParams.length === 1, "One invalid param recorded for nonexistent subtab");
    assert(parsed.invalidParams[0].param === "subtab", "Invalid param identified as subtab");
    assert(parsed.state.tab === "simulation", "Tab remains simulation");
    assert(parsed.state.subtab === null, "Invalid subtab safely falls back to null");
  });

  return { passed, total, details };
}
