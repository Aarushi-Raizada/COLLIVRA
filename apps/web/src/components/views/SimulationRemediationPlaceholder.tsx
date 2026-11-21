"use client";

import React from "react";
import {
  SimulationDashboardView,
  SimulationDashboardViewProps,
} from "../simulation/SimulationDashboardView";
import { ApiConnectionStatus, NavigationTab } from "@/types/orbital";
import type { ScenarioUrn } from "@/types/shared_state";

export interface SimulationRemediationPlaceholderProps {
  apiStatus?: ApiConnectionStatus;
  isDemoMode?: boolean;
  onNavigateTab?: (
    tab: NavigationTab,
    objectId?: string | null,
    subtab?: string | null,
    eventId?: string | null,
    scenarioId?: string | null
  ) => void;
  initialSubtab?: string | null;
  initialObjectId?: string | null;
  activeScenarioUrn?: ScenarioUrn | null;
  initialScenarioId?: ScenarioUrn | string | null;
}

export const SimulationRemediationPlaceholder: React.FC<SimulationRemediationPlaceholderProps> = ({
  apiStatus = {
    connected: false,
    state: "disconnected",
    lastCheckedUtc: null,
  },
  isDemoMode = false,
  onNavigateTab,
  initialSubtab,
  initialObjectId,
  activeScenarioUrn = null,
  initialScenarioId,
}) => {
  const effectiveScenarioUrn = activeScenarioUrn ?? (initialScenarioId as ScenarioUrn | null) ?? null;

  return (
    <SimulationDashboardView
      apiStatus={apiStatus}
      isDemoMode={isDemoMode}
      onNavigateTab={onNavigateTab}
      initialSubtab={initialSubtab}
      initialObjectId={initialObjectId}
      activeScenarioUrn={effectiveScenarioUrn}
      initialScenarioId={effectiveScenarioUrn}
    />
  );
};

export { SimulationDashboardView };
