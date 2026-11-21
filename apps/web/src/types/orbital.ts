
/**
 * COLLIVRA Frontend UI & Orbital Domain Types
 */

import { ConjunctionEvent, HealthResponse, RiskAssessment, RiskCategory } from "./api";

export type NavigationTab =
  | "overview"
  | "radar"
  | "conjunctions"
  | "simulation"
  | "system";

export interface ApiConnectionStatus {
  connected: boolean;
  state: "connected" | "connecting" | "disconnected" | "error";
  latencyMs?: number;
  lastCheckedUtc: string | null;
  version?: string;
  errorMessage?: string;
}

export interface DataSourceInfo {
  mode: "LIVE_API" | "OFFLINE_DEMO";
  label: string;
  provenance: string;
  epoch: string;
  offlineIers: boolean;
  objectCount?: number;
}

export interface DashboardMetrics {
  totalTrackedObjects: number;
  activeConjunctions: number;
  criticalEvents: number;
  atmosphericReentries: number;
  propagationFrame: string;
  lastScreeningUtc: string;
}

export interface ScreenedConjunctionWithRisk {
  event: ConjunctionEvent;
  risk?: RiskAssessment | null;
  isSynthetic?: boolean;
}
