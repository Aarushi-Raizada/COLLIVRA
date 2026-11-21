/**
 * COLLIVRA Operational Workflow & Demonstration Scenarios (AST-01C.5)
 *
 * Defines:
 * 1. The 7-Step Unified Operational Workflow connecting all six pillars:
 *    Asset Identification -> Orbital Explorer -> Conjunction Screening ->
 *    Risk Triage -> Debris Evolution Lab -> Remediation Planning -> System Integrity.
 * 2. The 5 Canonical Demonstration Scenarios for hackathon evaluators.
 * 3. The Indian Space Ecosystem (ISRO / Domain 01) technical metadata and ingestion contracts.
 *
 * Scientific Guardrails (AGENTS.md):
 * - Zero unverified orbital parameters or fabricated NORAD IDs for Indian assets.
 * - Integration-ready contracts documenting official CelesTrak group endpoints.
 * - Deterministic scenario execution using validated fixtures.
 */

import { NavigationTab } from "@/types/orbital";

// ============================================================================
// 1. Seven-Step Connected Operational Workflow
// ============================================================================

export interface WorkflowStep {
  stepNumber: number;
  id: string;
  name: string;
  shortLabel: string;
  pillar: string;
  pillarNumber: string;
  tab: NavigationTab;
  subtab?: string | null;
  description: string;
  operationalOutcome: string;
  scientificContext: string;
}

export const COLLIVRA_WORKFLOW_STEPS: readonly WorkflowStep[] = [
  {
    stepNumber: 1,
    id: "mission-selection",
    name: "Asset Identification & Strategic Overview",
    shortLabel: "01 Asset ID",
    pillar: "Mission & Strategic Overview",
    pillarNumber: "01",
    tab: "overview",
    description: "Inspect operational satellite catalog, constellation status, orbital regimes, and live SSA metrics.",
    operationalOutcome: "Select primary target asset (e.g. ISS / CSS) for environment and threat evaluation.",
    scientificContext: "Aggregates ingested CelesTrak OMM records with disk cache and offline fallback.",
  },
  {
    stepNumber: 2,
    id: "orbital-inspection",
    name: "Orbital Environment & Kinematics Inspection",
    shortLabel: "02 Orbital 3D",
    pillar: "Orbital Environment Explorer",
    pillarNumber: "02",
    tab: "radar",
    description: "Inspect target asset in inertial GCRS space with independent polar Earth rotation and 520 synthetic debris markers.",
    operationalOutcome: "Verify altitude regime (LEO/MEO/GEO), orbital speed, and atmospheric interface clearance (6,478 km).",
    scientificContext: "GCRS world alignment. Atmospheric reentry boundary explicitly highlighted at 100 km.",
  },
  {
    stepNumber: 3,
    id: "collision-screening",
    name: "Conjunction Screening & Close-Approach Triage",
    shortLabel: "03 Screening",
    pillar: "Collision Intelligence",
    pillarNumber: "03",
    tab: "conjunctions",
    description: "Execute multi-stage analytical SGP4 screening to detect close encounters within threshold (<= 50.0 km).",
    operationalOutcome: "Identify critical close-approach events and precise Time of Closest Approach (TCA).",
    scientificContext: "Numerical TCA optimization in GCRS. Identifies geometric miss distance.",
  },
  {
    stepNumber: 4,
    id: "risk-inspection",
    name: "Multi-Factor Heuristic Risk Assessment",
    shortLabel: "04 Risk Triage",
    pillar: "Collision Intelligence",
    pillarNumber: "03",
    tab: "conjunctions",
    description: "Triage encounter geometry, relative velocity vector, miss distance, and explainable risk breakdown [0-100].",
    operationalOutcome: "Quantify encounter severity without confusing heuristic proxies with formal collision probability.",
    scientificContext: "Public TLE/OMMs lack covariance matrices; formal Pc is never claimed.",
  },
  {
    stepNumber: 5,
    id: "debris-evolution",
    name: "Debris Evolution & Numerical Fragmentation",
    shortLabel: "05 Breakup Lab",
    pillar: "Debris Evolution Laboratory",
    pillarNumber: "04",
    tab: "simulation",
    subtab: "breakup",
    description: "Model kinetic breakup into synthetic fragments and propagate via Cowell DOP853 with Earth J2 perturbation.",
    operationalOutcome: "Analyze fragment dispersion, mass distribution, and atmospheric interface re-entry crossings.",
    scientificContext: "Zero net momentum residual enforced. Fragments labeled with strict synthetic provenance.",
  },
  {
    stepNumber: 6,
    id: "remediation-planning",
    name: "Mitigation & Clohessy-Wiltshire Rendezvous",
    shortLabel: "06 Remediation",
    pillar: "Mitigation & Sustainability",
    pillarNumber: "05",
    tab: "simulation",
    subtab: "remediation",
    description: "Plan Active Debris Removal (ADR) two-impulse rendezvous in Hill (RIC) frame to intercept target debris.",
    operationalOutcome: "Determine Delta-V budget feasibility, impulse burn vectors (dv1, dv2), and standoff hold positions.",
    scientificContext: "Linearized CW equations enforce near-circular chief orbit precondition (e <= 0.005).",
  },
  {
    stepNumber: 7,
    id: "system-integrity",
    name: "System Telemetry, Provenance & Data Integrity",
    shortLabel: "07 Integrity",
    pillar: "System & Data Integrity",
    pillarNumber: "06",
    tab: "system",
    description: "Verify Earth Orientation Parameters (EOP) quality, IERS policy modes, and subsystem operational status.",
    operationalOutcome: "Ensure strict policy rejections for uncalibrated epochs and transparent degradation badges.",
    scientificContext: "Validates <= 30d prediction horizon. OFFLINE_STRICT rejects unmaintained predictions via HTTP 422.",
  },
] as const;

// ============================================================================
// 2. Five Canonical Demonstration Scenarios
// ============================================================================

export interface DemonstrationScenario {
  id: string;
  scenarioCode: string;
  name: string;
  category: string;
  targetTab: NavigationTab;
  targetSubtab?: string | null;
  targetObjectId?: string | null;
  targetEventId?: string | null;
  targetScenarioId?: string | null;
  description: string;
  primaryMetric: string;
  scientificGuardrail: string;
}

export const CANONICAL_DEMO_SCENARIOS: readonly DemonstrationScenario[] = [
  {
    id: "scenario-a",
    scenarioCode: "SCENARIO A",
    name: "Normal Orbital Monitoring",
    category: "Baseline SSA Operations",
    targetTab: "radar",
    targetObjectId: "catalog:25544",
    description: "Inspect the ISS (Zarya) in 3D inertial GCRS space with full orbital elements, Keplerian ephemeris, and altitude regime verification.",
    primaryMetric: "ISS Altitude ~419 km (LEO Regime, Speed 7.66 km/s)",
    scientificGuardrail: "Illustrative Keplerian ephemeris fixture; Earth polar axis rotation decoupled from inertial orbits.",
  },
  {
    id: "scenario-b",
    scenarioCode: "SCENARIO B",
    name: "Close-Approach Analysis",
    category: "Collision Intelligence",
    targetTab: "conjunctions",
    targetEventId: "CONJ-25544-SYNTH-FRAG-0042-20261102T121845Z",
    description: "Evaluate a critical conjunction encounter between ISS and synthetic fragment #042 with 3D encounter geometry and factor breakdown.",
    primaryMetric: "Miss Distance: 0.842 km, Heuristic Score: 79.0/100 (CRITICAL)",
    scientificGuardrail: "Empirical heuristic triage score; explicitly discloses that public TLEs lack error covariance.",
  },
  {
    id: "scenario-c",
    scenarioCode: "SCENARIO C",
    name: "Debris Evolution Simulation",
    category: "Orbital Fragmentation",
    targetTab: "simulation",
    targetSubtab: "breakup",
    targetScenarioId: "scenario:SIM-LEO-COLLISION-001",
    description: "Model a synthetic hypervelocity kinetic collision in LEO and propagate fragments with Cowell DOP853 and Earth J2 oblateness.",
    primaryMetric: "10 Fragments Propagated, Momentum Residual: 1.24e-12 kg*km/s",
    scientificGuardrail: "Simplified synthetic model (not NASA SBM). 100 km crossing is atmospheric entry, not destruction.",
  },
  {
    id: "scenario-d",
    scenarioCode: "SCENARIO D",
    name: "Remediation Planning (CW Benchmark)",
    category: "Active Debris Removal",
    targetTab: "simulation",
    targetSubtab: "remediation",
    targetScenarioId: "scenario:canonical-cw-reference",
    description: "Execute a validated Clohessy-Wiltshire two-impulse rendezvous trajectory in Hill frame to intercept debris at a 50m standoff hold.",
    primaryMetric: "Total Delta-V: 2.40 m/s (Budget Feasible <= 50.0 m/s)",
    scientificGuardrail: "Chief orbit eccentricity e = 0.000028 <= 0.005 guardrail enforced; idealized impulse burns.",
  },
  {
    id: "scenario-e",
    scenarioCode: "SCENARIO E",
    name: "System Quality & IERS Policy",
    category: "Data Integrity & Telemetry",
    targetTab: "system",
    description: "Inspect Earth Orientation Parameter freshness, IERS policy enforcement, and live backend health telemetry.",
    primaryMetric: "IERS Mode: OFFLINE_PREDICTIVE (Horizon <= 30.0d Fresh)",
    scientificGuardrail: "Stale forward predictions (> 30d) rejected under OFFLINE_STRICT with structured HTTP 422.",
  },
] as const;

// ============================================================================
// 3. Indian Space Ecosystem (ISRO / Domain 01) Specifications
// ============================================================================

export interface IndianConstellationSpec {
  name: string;
  acronym: string;
  regime: "LEO" | "MEO" | "GEO" | "GSO";
  missionType: string;
  representativeMissions: string[];
  ingestionSource: string;
  status: "INTEGRATION_READY" | "FIXTURE_PENDING";
  description: string;
}

export const INDIAN_SPACE_CONSTELLATIONS: readonly IndianConstellationSpec[] = [
  {
    name: "Navigation with Indian Constellation",
    acronym: "NavIC / IRNSS",
    regime: "GEO",
    missionType: "Satellite Navigation & Timing",
    representativeMissions: ["IRNSS-1A through 1I", "NVS-01"],
    ingestionSource: "CelesTrak Group: 'navic' (GP/OMM format)",
    status: "INTEGRATION_READY",
    description: "Regional navigation satellite system providing accurate position, velocity, and timing services across India and 1,500 km beyond.",
  },
  {
    name: "Earth Observation & Cartography",
    acronym: "EOS / Cartosat",
    regime: "LEO",
    missionType: "High-Resolution Earth Observation",
    representativeMissions: ["Cartosat-2/3 series", "EOS-01 through 06"],
    ingestionSource: "CelesTrak Group: 'isro' / 'resource' (GP/OMM format)",
    status: "INTEGRATION_READY",
    description: "Sun-synchronous LEO imaging platforms supporting national resource management, disaster monitoring, and urban planning.",
  },
  {
    name: "Radar Imaging Satellites",
    acronym: "RISAT",
    regime: "LEO",
    missionType: "Synthetic Aperture Radar (SAR)",
    representativeMissions: ["RISAT-1", "RISAT-2B series", "EOS-04"],
    ingestionSource: "CelesTrak Group: 'isro' (GP/OMM format)",
    status: "INTEGRATION_READY",
    description: "All-weather, day-and-night Synthetic Aperture Radar platforms providing terrain surveillance and maritime awareness.",
  },
  {
    name: "Geostationary Telecommunication",
    acronym: "GSAT / INSAT",
    regime: "GEO",
    missionType: "Broadband & Telecommunications",
    representativeMissions: ["GSAT-10", "GSAT-24", "GSAT-30"],
    ingestionSource: "CelesTrak Group: 'geo' / 'isro' (GP/OMM format)",
    status: "INTEGRATION_READY",
    description: "Geostationary communication fleet delivering nationwide telecommunications, television broadcast, and defense connectivity.",
  },
] as const;

export const ISRO_IS4OM_SPECIFICATION = {
  initiative: "ISRO System for Safe & Sustainable Space Operations Management (IS4OM)",
  agency: "Indian Space Research Organisation (ISRO)",
  headquarters: "Bengaluru, India",
  alignment: "Domain 06 — Sustainable Space & Space Environment; Domain 01 — Indian Space Missions & Space Data",
  scientificStandard: "Inter-Agency Space Debris Coordination Committee (IADC) space debris mitigation guidelines",
  ingestionProtocol: "Automated Space-Track / CelesTrak GP/OMM ingestion pipeline with offline cache fallback",
  disclaimer: "Operational ISRO orbital records require authorized IS4OM data feeds or verified CelesTrak OMM ingestion. Zero orbital elements are synthesized to prevent misleading navigation solutions.",
} as const;
