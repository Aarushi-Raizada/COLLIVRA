/**
 * COLLIVRA Brand Constants & Architectural Specification
 *
 * Space Situational Awareness & Orbital Sustainability Platform
 * Team Errorists · ASTRA 2026 · VIT Bhopal
 * "See the risk. Secure the orbit."
 */

import { NavigationTab } from "../types/orbital";
import { SimulationSubtab } from "./navigation";

export interface CollivraPillar {
  readonly number: string;
  readonly tab: NavigationTab;
  readonly subtab: SimulationSubtab | null;
  readonly title: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly badge: string;
}

export const COLLIVRA_BRAND = {
  name: "COLLIVRA",
  tagline: "See the risk. Secure the orbit.",
  description: "Space Situational Awareness & Orbital Sustainability Platform",
  team: "Team Errorists",
  hackathon: "ASTRA 2026",
  institution: "VIT Bhopal",
  fullAttribution: "Team Errorists · ASTRA 2026 · VIT Bhopal",
  theme: {
    spaceBg: "#050816",
    surfaceCard: "#0b112c",
    borderSubtle: "#1e293b",
  },
  pillars: [
    {
      number: "01",
      tab: "overview",
      subtab: null,
      title: "Mission & Orbital Overview",
      shortLabel: "Mission Overview",
      description: "Fleet status, high-level conjunction alerts, activity timelines, risk gauges",
      badge: "LIVE",
    },
    {
      number: "02",
      tab: "radar",
      subtab: null,
      title: "Orbital Environment Explorer",
      shortLabel: "Orbital Radar",
      description: "Interactive 3D Three.js Earth canvas, satellite catalog, orbit propagation",
      badge: "3D",
    },
    {
      number: "03",
      tab: "conjunctions",
      subtab: null,
      title: "Collision Intelligence",
      shortLabel: "Conjunctions",
      description: "Conjunction event screening, heuristic risk scoring, TCA analysis, miss distance",
      badge: "SCREEN",
    },
    {
      number: "04",
      tab: "simulation",
      subtab: "breakup",
      title: "Debris Evolution Laboratory",
      shortLabel: "Fragmentation",
      description: "Synthetic breakup simulation, fragment cloud generation, Gabbard diagram",
      badge: "SYNTH",
    },
    {
      number: "05",
      tab: "simulation",
      subtab: "remediation",
      title: "Mitigation & Sustainability",
      shortLabel: "Remediation",
      description: "Clohessy-Wiltshire (CW) rendezvous burn planning, delta-v budgeting",
      badge: "CW",
    },
    {
      number: "06",
      tab: "system",
      subtab: null,
      title: "System & Data Integrity",
      shortLabel: "System Integrity",
      description: "Telemetry, API status, IERS Earth-orientation quality, data provenance",
      badge: "TELEMETRY",
    },
  ] as const satisfies readonly CollivraPillar[],
} as const;
