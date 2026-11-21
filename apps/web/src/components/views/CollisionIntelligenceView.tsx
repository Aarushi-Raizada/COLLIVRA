"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ConjunctionEvent,
  ConjunctionScreeningRequest,
  ConjunctionScreeningResponse,
  RiskAssessment,
} from "@/types/api";
import { ApiConnectionStatus, NavigationTab } from "@/types/orbital";
import { apiClient } from "@/lib/api";
import { MOCK_CONJUNCTION_RESPONSE, MOCK_RISK_ASSESSMENTS } from "@/lib/mockData";
import { DisclaimerBanner } from "@/components/ui/DisclaimerBanner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ScreeningQueryForm } from "../conjunctions/ScreeningQueryForm";
import { ScreeningSummaryCards } from "../conjunctions/ScreeningSummaryCards";
import { ConjunctionTable } from "../conjunctions/ConjunctionTable";
import { CloseApproachInspector } from "../conjunctions/CloseApproachInspector";
import { calculateInitialScreeningWindow } from "@/lib/screening_lifecycle";
import {
  AlertTriangle,
  RotateCcw,
  Compass,
  Radio,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";

export interface CollisionIntelligenceViewProps {
  isDemoMode?: boolean;
  apiStatus?: ApiConnectionStatus;
  autoScreenOnMount?: boolean;
  onNavigateTab?: (
    tab: NavigationTab,
    objectId?: string | null,
    subtab?: string | null,
    eventId?: string | null,
    scenarioId?: string | null
  ) => void;
  initialEventId?: string | null;
}

const SCIENTIFIC_DISCLAIMER_TEXT =
  "Conjunction screening identifies preliminary geometric close approaches between " +
  "orbital objects using analytical SGP4 propagation in the inertial GCRS frame. " +
  "Results represent geometric miss-distance thresholds and do NOT represent formal " +
  "probability of collision (Pc). Formal collision risk assessment requires calibrated " +
  "covariance matrices, which are not provided in public TLE/OMM records.";

export const CollisionIntelligenceView: React.FC<CollisionIntelligenceViewProps> = ({
  isDemoMode = false,
  apiStatus,
  autoScreenOnMount = true,
  onNavigateTab,
  initialEventId,
}) => {
  const [screeningResponse, setScreeningResponse] =
    useState<ConjunctionScreeningResponse | null>(null);
  const [isScreening, setIsScreening] = useState<boolean>(false);
  const [screeningError, setScreeningError] = useState<string | null>(null);
  const [hasExecuted, setHasExecuted] = useState<boolean>(false);
  const [lastExecutedRequest, setLastExecutedRequest] =
    useState<ConjunctionScreeningRequest | null>(null);

  // Event Selection & Decoupled Risk Assessments
  const [selectedEventId, setSelectedEventId] = useState<string | null>(initialEventId || null);
  const [riskAssessments, setRiskAssessments] = useState<Record<string, RiskAssessment>>({});
  const [isAssessingRisk, setIsAssessingRisk] = useState<boolean>(false);
  const [riskAssessmentError, setRiskAssessmentError] = useState<string | null>(null);

  // Live Backend Evaluation of Synthetic Encounter Fixtures in Demo Mode
  const [isAssessingLive, setIsAssessingLive] = useState<boolean>(false);
  const [liveAssessmentError, setLiveAssessmentError] = useState<string | null>(null);
  const [riskAssessmentSources, setRiskAssessmentSources] = useState<
    Record<string, "LIVE_BACKEND" | "OFFLINE_FIXTURE">
  >({});

  const mountedRef = useRef<boolean>(false);
  const isScreeningRef = useRef<boolean>(false);
  const isAssessingLiveRef = useRef<boolean>(false);

  // Batch assess risk for events independently from screening
  const fetchRiskAssessments = useCallback(
    async (events: ConjunctionEvent[], demo: boolean) => {
      if (!events || events.length === 0) return;
      setIsAssessingRisk(true);
      setRiskAssessmentError(null);

      try {
        if (demo) {
          // Offline mock risk assessments simulation
          await new Promise((r) => setTimeout(r, 100));
          const map: Record<string, RiskAssessment> = {};
          const sources: Record<string, "LIVE_BACKEND" | "OFFLINE_FIXTURE"> = {};
          MOCK_RISK_ASSESSMENTS.forEach((a) => {
            map[a.event_id] = a;
            sources[a.event_id] = "OFFLINE_FIXTURE";
          });
          setRiskAssessments(map);
          setRiskAssessmentSources(sources);
        } else {
          // Live API batch risk evaluation
          const batchResponse = await apiClient.assessRiskBatch({
            events,
          });
          const map: Record<string, RiskAssessment> = {};
          const sources: Record<string, "LIVE_BACKEND" | "OFFLINE_FIXTURE"> = {};
          batchResponse.assessments.forEach((a) => {
            map[a.event_id] = a;
            sources[a.event_id] = "LIVE_BACKEND";
          });
          setRiskAssessments(map);
          setRiskAssessmentSources(sources);
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Heuristic risk evaluation failed.";
        setRiskAssessmentError(msg);
        // Important: risk evaluation failure does NOT wipe or degrade screening results
      } finally {
        setIsAssessingRisk(false);
      }
    },
    []
  );

  // Single event risk evaluation fallback
  const handleAssessRiskForEvent = useCallback(
    async (event: ConjunctionEvent) => {
      setIsAssessingRisk(true);
      setRiskAssessmentError(null);

      try {
        if (isDemoMode) {
          const match = MOCK_RISK_ASSESSMENTS.find((a) => a.event_id === event.event_id);
          if (match) {
            setRiskAssessments((prev) => ({ ...prev, [event.event_id]: match }));
            setRiskAssessmentSources((prev) => ({ ...prev, [event.event_id]: "OFFLINE_FIXTURE" }));
          }
        } else {
          const assessment = await apiClient.assessRisk({ event });
          setRiskAssessments((prev) => ({ ...prev, [event.event_id]: assessment }));
          setRiskAssessmentSources((prev) => ({ ...prev, [event.event_id]: "LIVE_BACKEND" }));
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Single event risk evaluation failed.";
        setRiskAssessmentError(msg);
      } finally {
        setIsAssessingRisk(false);
      }
    },
    [isDemoMode]
  );

  // Live Backend Risk Evaluation for Loaded Synthetic Encounter Fixtures
  const handleAssessWithLiveBackend = useCallback(
    async (event: ConjunctionEvent) => {
      if (isAssessingLiveRef.current) return;
      isAssessingLiveRef.current = true;
      setIsAssessingLive(true);
      setLiveAssessmentError(null);

      try {
        const evalTime =
          riskAssessments[event.event_id]?.evaluation_time ||
          "2026-11-02T12:00:00.000Z";

        const liveAssessment = await apiClient.assessRisk({
          event,
          evaluation_time: evalTime,
        });

        setRiskAssessments((prev) => ({
          ...prev,
          [event.event_id]: liveAssessment,
        }));
        setRiskAssessmentSources((prev) => ({
          ...prev,
          [event.event_id]: "LIVE_BACKEND",
        }));
        setLiveAssessmentError(null);
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Live backend risk evaluation failed.";
        setLiveAssessmentError(msg);
      } finally {
        isAssessingLiveRef.current = false;
        setIsAssessingLive(false);
      }
    },
    [riskAssessments]
  );

  const handleExecuteScreening = useCallback(
    async (request: ConjunctionScreeningRequest) => {
      if (isScreeningRef.current) return;
      isScreeningRef.current = true;
      setIsScreening(true);
      setScreeningError(null);
      setLastExecutedRequest(request);

      try {
        let currentEvents: ConjunctionEvent[] = [];

        if (isDemoMode) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          setScreeningResponse(MOCK_CONJUNCTION_RESPONSE);
          setHasExecuted(true);
          currentEvents = MOCK_CONJUNCTION_RESPONSE.events;
        } else {
          const response = await apiClient.screenConjunctions(request);
          setScreeningResponse(response);
          setHasExecuted(true);
          currentEvents = response.events;
        }

        // Selection management
        if (currentEvents.length > 0) {
          setSelectedEventId((prev) => {
            if (prev && currentEvents.some((e) => e.event_id === prev)) {
              return prev;
            }
            return currentEvents[0].event_id;
          });
          // Dispatch decoupled risk assessment
          fetchRiskAssessments(currentEvents, isDemoMode);
        } else {
          setSelectedEventId(null);
        }
      } catch (err: unknown) {
        const errorMsg =
          err instanceof Error
            ? err.message
            : "An unexpected error occurred during conjunction screening.";
        setScreeningError(errorMsg);
      } finally {
        isScreeningRef.current = false;
        setIsScreening(false);
      }
    },
    [isDemoMode, fetchRiskAssessments]
  );

  // Auto-execution on initial mount
  useEffect(() => {
    if (!mountedRef.current && autoScreenOnMount && !hasExecuted) {
      mountedRef.current = true;
      const window = calculateInitialScreeningWindow();
      handleExecuteScreening({
        start_time: window.startTime,
        end_time: window.endTime,
        norad_ids: ["25544", "48274"],
        step_seconds: 60.0,
        threshold_km: 10.0,
        target_frame: "GCRS",
      });
    }
  }, [autoScreenOnMount, hasExecuted, handleExecuteScreening]);

  // Derive the currently selected event object
  const selectedEvent = useMemo(() => {
    if (!screeningResponse || !selectedEventId) return null;
    return screeningResponse.events.find((e) => e.event_id === selectedEventId) || null;
  }, [screeningResponse, selectedEventId]);

  return (
    <div className="space-y-4 2xl:space-y-6">
      {/* 0. Module Header & Brand Identity */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-space-border/80">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-base sm:text-lg 2xl:text-xl font-space font-bold uppercase tracking-wider text-slate-100">
              COLLIVRA Collision Intelligence
            </h1>
            <Badge variant="cyan" size="sm" className="font-mono font-bold">
              PILLAR 03
            </Badge>
            <Badge variant="outline" size="sm" className="font-mono text-cyan border-cyan/40">
              INERTIAL GCRS
            </Badge>
            <Badge variant="outline" size="sm" className="font-mono text-slate-300 border-slate-700">
              ANALYTICAL SGP4
            </Badge>
            <Badge variant="rose" size="sm" className="font-mono font-bold">
              Pc: UNAVAILABLE (NO COVARIANCE)
            </Badge>
          </div>
          <p className="text-xs font-mono text-slate-400 mt-0.5">
            Real-time orbital conjunction screening, golden-section TCA search, and multi-factor analytical risk triage.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isDemoMode ? (
            <Badge variant="amber" size="sm" className="font-mono font-bold">
              OFFLINE DEMO MODE
            </Badge>
          ) : (
            <Badge variant="emerald" size="sm" className="font-mono font-bold">
              LIVE FASTAPI BACKEND
            </Badge>
          )}
        </div>
      </div>

      {/* 1. Scientific & Operational Boundary Disclaimer */}
      <DisclaimerBanner
        title="Scientific & Operational Boundary Disclaimer"
        disclaimer={SCIENTIFIC_DISCLAIMER_TEXT}
        variant="info"
      />

      {/* 2. Conjunction Screening Query Form */}
      <ScreeningQueryForm
        onSubmit={handleExecuteScreening}
        isLoading={isScreening}
        isDemoMode={isDemoMode}
        initialValues={lastExecutedRequest ?? undefined}
      />

      {/* 3. Screening Error Banner with Retry (if screening failed) */}
      {screeningError && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl border border-rose-500/50 bg-rose-950/30 text-rose-200">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-rose-300">
                Conjunction Screening Failed
              </h4>
              <p className="mt-0.5 text-xs font-mono text-rose-200/90 leading-relaxed">
                {screeningError}
              </p>
              {screeningResponse && (
                <p className="mt-1 text-[11px] font-mono text-slate-400">
                  Preserved previously successful screening results.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {lastExecutedRequest && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleExecuteScreening(lastExecutedRequest)}
                disabled={isScreening}
                className="font-mono text-xs"
              >
                <RotateCcw className="h-3 w-3" />
                Retry Screening
              </Button>
            )}
            <button
              type="button"
              onClick={() => setScreeningError(null)}
              className="text-xs font-mono text-slate-400 hover:text-slate-200 px-2 py-1 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* 4. Active Screening Spinner */}
      {isScreening && (
        <Card className="border-cyan/30 bg-space-surface/90 p-8 text-center shadow-panel">
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="relative">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan border-t-transparent" />
              <Radio className="absolute inset-0 m-auto h-4 w-4 text-cyan animate-pulse" />
            </div>
            <div>
              <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan">
                Propagating Orbital Ephemeris & Screening In GCRS
              </h4>
              <p className="mt-1 text-[11px] font-mono text-slate-400 max-w-md">
                Computing analytical SGP4 ephemeris, applying apogee/perigee filters, and executing
                golden-section TCA search...
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* 5. Summary Results, Events Table & Inspector */}
      {!isScreening && hasExecuted && screeningResponse && (
        <div className="space-y-4 2xl:space-y-6">
          {/* Summary Metric Cards */}
          <ScreeningSummaryCards
            summary={screeningResponse.summary}
            sourceBadge={isDemoMode ? "OFFLINE DEMO" : "LIVE BACKEND"}
          />

          {/* Independent Risk Assessment Error Alert (if risk evaluation failed) */}
          {riskAssessmentError && (
            <div className="flex items-center justify-between p-3.5 rounded-lg border border-amber-600/50 bg-amber-950/30 text-xs font-mono text-amber-200">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                <span>
                  <strong>Heuristic Risk Evaluation Notice:</strong> {riskAssessmentError} (Screening
                  results remain valid and interactive).
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchRiskAssessments(screeningResponse.events, isDemoMode)}
                disabled={isAssessingRisk}
                className="font-mono text-xs"
              >
                <RotateCcw className="h-3 w-3" />
                Retry Risk Evaluation
              </Button>
            </div>
          )}

          {/* Empty State vs Results Table + Inspector */}
          {screeningResponse.events.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-6 w-6 text-emerald-400" />}
              title="No Conjunction Events Detected"
              description={`Zero close-approach encounters found within the ${screeningResponse.summary.threshold_km} km screening threshold for the specified time window. Try increasing the miss-distance threshold or expanding the query time window.`}
            />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 2xl:gap-6 items-start">
              {/* Conjunction Events Table (5 cols on wide displays, sticky) */}
              <div className="xl:col-span-5 space-y-4 xl:sticky xl:top-3 2xl:top-4">
                <ConjunctionTable
                  events={screeningResponse.events}
                  riskAssessments={riskAssessments}
                  isAssessingRisk={isAssessingRisk}
                  selectedEventId={selectedEventId}
                  onSelectEvent={(ev) => setSelectedEventId(ev.event_id)}
                />
              </div>

              {/* Close Approach Inspector (7 cols on wide displays) */}
              <div className="xl:col-span-7 space-y-4 min-w-0">
                <CloseApproachInspector
                  event={selectedEvent}
                  risk={selectedEvent ? riskAssessments[selectedEvent.event_id] : null}
                  isAssessingRisk={isAssessingRisk}
                  onAssessRisk={handleAssessRiskForEvent}
                  onAssessWithLiveBackend={handleAssessWithLiveBackend}
                  isAssessingLive={isAssessingLive}
                  liveAssessmentError={liveAssessmentError}
                  riskSource={
                    selectedEvent
                      ? riskAssessmentSources[selectedEvent.event_id] ||
                        (isDemoMode ? "OFFLINE_FIXTURE" : "LIVE_BACKEND")
                      : null
                  }
                  isDemoMode={isDemoMode}
                  onNavigateTab={onNavigateTab}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6. Initial Unexecuted State (if autoScreenOnMount is disabled) */}
      {!isScreening && !hasExecuted && (
        <EmptyState
          icon={<Compass className="h-6 w-6 text-cyan" />}
          title="Conjunction Screening Standby"
          description="Configure the screening time window, NORAD catalog identifiers, and alert threshold in the form above, then click 'Execute Screening' to run orbital close-approach analysis."
          actionLabel="Screen Default Stations (ISS & CSS)"
          onAction={() => {
            const now = new Date();
            const future = new Date(now.getTime() + 2 * 3600 * 1000);
            handleExecuteScreening({
              start_time: now.toISOString(),
              end_time: future.toISOString(),
              norad_ids: ["25544", "48274"],
              step_seconds: 60.0,
              threshold_km: 10.0,
              target_frame: "GCRS",
            });
          }}
        />
      )}
    </div>
  );
};

