"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "../components/layout/Header";
import { Sidebar } from "../components/layout/Sidebar";
import { Footer } from "../components/layout/Footer";
import { MissionDashboardView } from "../components/views/MissionDashboardView";
import { OrbitalRadarView } from "../components/views/OrbitalRadarView";
import { CollisionIntelligenceView } from "../components/views/CollisionIntelligenceView";
import { SimulationRemediationPlaceholder } from "../components/views/SimulationRemediationPlaceholder";
import { SystemTelemetryView } from "../components/views/SystemTelemetryView";
import { NavigationHydrationSkeleton } from "../components/layout/NavigationHydrationSkeleton";
import { NavigationTab, ApiConnectionStatus } from "../types/orbital";
import { apiClient } from "../lib/api";
import {
  useActiveTab,
  useActiveSubtab,
  useSelectedObjectUrn,
  useActiveEventUrn,
  useActiveScenarioUrn,
  useIsNavigationHydrated,
  useNavigationHydrationError,
} from "../store/useZorbitStore";
import { navigateToUrl, syncFromBrowserUrl } from "../lib/navigation";
import "../lib/simulationStoreBridge";
import { useSimulationClockTicker } from "../hooks/useSimulationClockTicker";

export default function HomePage() {
  // Authoritative global simulation clock ticker
  useSimulationClockTicker();

  // Navigation state from Zustand store (Authoritative projection of URL state)
  const isHydrated = useIsNavigationHydrated();
  const hydrationError = useNavigationHydrationError();
  const activeTab = useActiveTab();
  const activeSubtab = useActiveSubtab();
  const selectedObjectUrn = useSelectedObjectUrn();
  const activeEventUrn = useActiveEventUrn();
  const activeScenarioUrn = useActiveScenarioUrn();

  const [isDemoMode, setIsDemoMode] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const initialFetchRef = useRef<boolean>(false);
  const isCheckingHealthRef = useRef<boolean>(false);

  const [apiStatus, setApiStatus] = useState<ApiConnectionStatus>({
    connected: false,
    state: "disconnected",
    lastCheckedUtc: null,
  });

  // Synchronized cross-module navigation with loop-breaking and canonical URN resolution
  const navigateToTab = useCallback(
    (
      tab: NavigationTab,
      objectId?: string | null,
      subtab?: string | null,
      eventId?: string | null,
      scenarioId?: string | null
    ) => {
      navigateToUrl({
        tab,
        objectId: objectId !== undefined ? objectId : null,
        subtab: subtab !== undefined ? subtab : null,
        eventId: eventId !== undefined ? eventId : null,
        scenarioId: scenarioId !== undefined ? scenarioId : null,
      });
    },
    []
  );

  // Check Backend Health & Latency independently
  const checkHealth = useCallback(async () => {
    if (isCheckingHealthRef.current) return;
    isCheckingHealthRef.current = true;
    setIsRefreshing(true);
    setErrorMessage(null);

    const startTime = performance.now();
    try {
      const health = await apiClient.checkHealth(4000);
      const latency = Math.round(performance.now() - startTime);

      setApiStatus({
        connected: true,
        state: "connected",
        latencyMs: latency,
        lastCheckedUtc: new Date().toISOString(),
        version: health.version,
      });
      setIsDemoMode(false);
    } catch (healthErr: unknown) {
      // Backend unreachable or offline: gracefully switch to demo mode
      const errStr =
        healthErr instanceof Error ? healthErr.message : String(healthErr);
      setApiStatus({
        connected: false,
        state: "error",
        lastCheckedUtc: new Date().toISOString(),
        errorMessage: errStr,
      });
      setIsDemoMode(true);
    } finally {
      isCheckingHealthRef.current = false;
      setIsRefreshing(false);
    }
  }, []);

  // Single Authoritative URL Synchronization Owner
  useEffect(() => {
    // 1. Initial hydration: parse URL, validate, and hydrate store before child renders
    syncFromBrowserUrl({ normalize: true });

    // 2. Browser history popstate handler (Back/Forward navigation)
    const handlePopState = () => {
      syncFromBrowserUrl({ normalize: false });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Initial backend health check
  useEffect(() => {
    if (!initialFetchRef.current) {
      initialFetchRef.current = true;
      checkHealth();
    }
  }, [checkHealth]);

  const handleToggleDemoMode = () => {
    const nextMode = !isDemoMode;
    setIsDemoMode(nextMode);
    if (!nextMode) {
      checkHealth();
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-space-bg text-slate-100 select-none overflow-x-hidden">
      {/* Top Application Header */}
      <Header
        activeTab={activeTab}
        activeSubtab={activeSubtab}
        onTabChange={(tab, subtab) => navigateToTab(tab, undefined, subtab)}
        onNavigateTab={navigateToTab}
        isDemoMode={isDemoMode}
        onToggleDemoMode={handleToggleDemoMode}
        apiStatus={apiStatus}
        onRefresh={checkHealth}
        isRefreshing={isRefreshing}
      />

      {/* Main Layout Area: Sidebar (Left) + Content (Right) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Navigation Sidebar */}
        <Sidebar
          activeTab={activeTab}
          activeSubtab={activeSubtab}
          onTabChange={(tab, subtab) => navigateToTab(tab, undefined, subtab)}
          apiStatus={apiStatus}
          apiBaseUrl={apiClient.getBaseUrl()}
        />

        {/* Center Main Content Area */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 2xl:p-6 space-y-3 2xl:space-y-5">
          {/* Active Backend Connection Alert if error occurred and not in pure demo */}
          {errorMessage && (
            <div className="flex items-center justify-between p-3 rounded-xl border border-status-warning/40 bg-status-warning/10 text-amber-200 text-xs font-sans">
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-amber-400 hover:text-amber-100 ml-4 font-semibold text-xs"
              >
                DISMISS
              </button>
            </div>
          )}

          {/* Navigation Hydration Fallback Alert */}
          {hydrationError && (
            <div className="flex items-center justify-between p-3 rounded-xl border border-status-critical/40 bg-status-critical/10 text-rose-200 text-xs font-sans">
              <span>Navigation synchronization error: {hydrationError}. Fallback to Overview module active.</span>
            </div>
          )}

          {/* Navigation Hydration Gate: Protect all navigation-dependent modules */}
          {!isHydrated ? (
            <NavigationHydrationSkeleton />
          ) : (
            <>
              {/* Active Tab Experience View */}
              {activeTab === "overview" && (
                <MissionDashboardView
                  onNavigateTab={navigateToTab}
                  apiStatus={apiStatus}
                  isDemoMode={isDemoMode}
                />
              )}

              {activeTab === "radar" && (
                <OrbitalRadarView
                  selectedObjectId={selectedObjectUrn}
                  onSelectObject={(id) => navigateToTab("radar", id)}
                  onNavigateTab={navigateToTab}
                />
              )}

              {activeTab === "conjunctions" && (
                <CollisionIntelligenceView
                  onNavigateTab={navigateToTab}
                  isDemoMode={isDemoMode}
                  apiStatus={apiStatus}
                  initialEventId={activeEventUrn}
                />
              )}

              {activeTab === "simulation" && (
                <SimulationRemediationPlaceholder
                  apiStatus={apiStatus}
                  isDemoMode={isDemoMode}
                  onNavigateTab={navigateToTab}
                  initialSubtab={activeSubtab}
                  initialObjectId={selectedObjectUrn}
                  activeScenarioUrn={activeScenarioUrn}
                  initialScenarioId={activeScenarioUrn}
                />
              )}

              {activeTab === "system" && (
                <SystemTelemetryView
                  apiStatus={apiStatus}
                  isDemoMode={isDemoMode}
                  onRefresh={checkHealth}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Persistent Bottom Status Bar & Disclaimer */}
      <Footer />
    </div>
  );
}
