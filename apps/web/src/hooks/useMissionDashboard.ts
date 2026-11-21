"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ScreenedConjunctionWithRisk,
  ApiConnectionStatus,
} from "../types/orbital";
import { ConjunctionEvent, RiskAssessment } from "../types/api";
import { apiClient } from "../lib/api";
import {
  MOCK_CONJUNCTION_EVENTS,
  MOCK_RISK_ASSESSMENTS,
} from "../lib/mockData";

export interface DashboardThreatMetrics {
  objectsScreened: number;
  conjunctionsDetected: number;
  highRiskCount: number;
  syntheticScenariosCount: number;
  syntheticScenariosDisplay: string;
  isSyntheticData: boolean;
  dataSourceLabel: string;
  provenanceNote: string;
}

export interface UseMissionDashboardResult {
  metrics: DashboardThreatMetrics;
  conjunctions: ScreenedConjunctionWithRisk[];
  isLoading: boolean;
  isRefreshing: boolean;
  lastRefreshed: Date | null;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Builds composite screened conjunction items with risk assessments.
 */
export function buildCompositeConjunctions(
  events: ConjunctionEvent[],
  riskAssessments: RiskAssessment[]
): ScreenedConjunctionWithRisk[] {
  const riskMap = new Map<string, RiskAssessment>();
  riskAssessments.forEach((r) => {
    riskMap.set(r.event_id, r);
  });

  return events.map((event) => ({
    event,
    risk: riskMap.get(event.event_id) || null,
    isSynthetic:
      event.object_1_id.startsWith("SYNTH-") ||
      event.object_2_id.startsWith("SYNTH-") ||
      (event.object_1_name?.toLowerCase().includes("synthetic") ?? false) ||
      (event.object_2_name?.toLowerCase().includes("synthetic") ?? false),
  }));
}

/**
 * Calculates threat metrics from screening events and risk assessments.
 * Strictly adheres to scientific honesty: counts reflect actual screened objects.
 */
export function calculateThreatMetrics(
  totalObjects: number,
  events: ConjunctionEvent[],
  conjunctionsWithRisk: ScreenedConjunctionWithRisk[],
  isDemo: boolean
): DashboardThreatMetrics {
  const highRiskCount = conjunctionsWithRisk.filter((c) => {
    const cat = c.risk?.risk_category?.toUpperCase() || c.event.category?.toUpperCase();
    return cat === "CRITICAL" || cat === "HIGH" || c.event.miss_distance_km <= 5.0;
  }).length;

  return {
    objectsScreened: totalObjects,
    conjunctionsDetected: events.length,
    highRiskCount,
    syntheticScenariosCount: isDemo ? 1 : 0,
    syntheticScenariosDisplay: isDemo ? "1 Loaded" : "0 Configured",
    isSyntheticData: isDemo,
    dataSourceLabel: isDemo ? "OFFLINE DEMO FIXTURE" : "FASTAPI SGP4 ENGINE",
    provenanceNote: isDemo
      ? "Benchmark Stations Snapshot (data/fixtures/stations_omm.json)"
      : "Live GCRS SGP4 Screening Window",
  };
}

export function useMissionDashboard(
  isDemoMode: boolean,
  apiStatus: ApiConnectionStatus
): UseMissionDashboardResult {
  const [conjunctions, setConjunctions] = useState<ScreenedConjunctionWithRisk[]>([]);
  const [metrics, setMetrics] = useState<DashboardThreatMetrics>({
    objectsScreened: 2,
    conjunctionsDetected: 3,
    highRiskCount: 2,
    syntheticScenariosCount: 1,
    syntheticScenariosDisplay: "1 Loaded",
    isSyntheticData: true,
    dataSourceLabel: "OFFLINE DEMO FIXTURE",
    provenanceNote: "Benchmark Stations Snapshot (data/fixtures/stations_omm.json)",
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isFetchingRef = useRef<boolean>(false);

  // Load offline demo fixtures
  const loadDemoFixtures = useCallback(() => {
    const composite = buildCompositeConjunctions(
      MOCK_CONJUNCTION_EVENTS,
      MOCK_RISK_ASSESSMENTS
    );
    const calculatedMetrics = calculateThreatMetrics(
      2, // 2 Stations Screened in demo fixture
      MOCK_CONJUNCTION_EVENTS,
      composite,
      true
    );
    setConjunctions(composite);
    setMetrics(calculatedMetrics);
    setLastRefreshed(new Date());
    setError(null);
    setIsLoading(false);
  }, []);

  // Fetch live screening data from FastAPI
  const fetchLiveScreening = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsRefreshing(true);
    setError(null);

    try {
      // 2-hour window screening query for catalog stations
      const now = new Date();
      const twoHoursLater = new Date(now.getTime() + 2 * 3600 * 1000);

      const screeningResponse = await apiClient.screenConjunctions(
        {
          start_time: now.toISOString(),
          end_time: twoHoursLater.toISOString(),
          threshold_km: 50.0,
          step_seconds: 60.0,
          target_frame: "GCRS",
        },
        15000
      );

      let riskAssessments: RiskAssessment[] = [];
      if (screeningResponse.events && screeningResponse.events.length > 0) {
        try {
          const batchRes = await apiClient.assessRiskBatch({
            events: screeningResponse.events,
            evaluation_time: now.toISOString(),
          });
          riskAssessments = batchRes.assessments;
        } catch {
          // If batch risk fails, proceed with geometric events
        }
      }

      const composite = buildCompositeConjunctions(
        screeningResponse.events,
        riskAssessments
      );

      const calculatedMetrics = calculateThreatMetrics(
        screeningResponse.summary?.total_objects || 2,
        screeningResponse.events,
        composite,
        false
      );

      setConjunctions(composite);
      setMetrics(calculatedMetrics);
      setLastRefreshed(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Live screening unavailable: ${msg}. Displaying offline fixtures.`);
      loadDemoFixtures();
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [loadDemoFixtures]);

  // Handle mode or connection changes
  useEffect(() => {
    if (isDemoMode || !apiStatus.connected) {
      loadDemoFixtures();
    } else {
      fetchLiveScreening();
    }
  }, [isDemoMode, apiStatus.connected, loadDemoFixtures, fetchLiveScreening]);

  const refresh = useCallback(async () => {
    if (isDemoMode || !apiStatus.connected) {
      setIsRefreshing(true);
      setTimeout(() => {
        loadDemoFixtures();
        setIsRefreshing(false);
      }, 300);
    } else {
      await fetchLiveScreening();
    }
  }, [isDemoMode, apiStatus.connected, loadDemoFixtures, fetchLiveScreening]);

  return {
    metrics,
    conjunctions,
    isLoading,
    isRefreshing,
    lastRefreshed,
    error,
    refresh,
  };
}
