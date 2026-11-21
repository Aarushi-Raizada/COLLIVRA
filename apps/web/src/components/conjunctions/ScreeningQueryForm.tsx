"use client";

import React, { useState, useId } from "react";
import { ConjunctionScreeningRequest } from "@/types/api";
import { createDefaultScreeningRequest } from "@/lib/api";
import {
  validateScreeningQueryParams,
  parseNoradIds,
  PRESET_STATIONS,
  PRESET_COSMOS_DEBRIS,
  ScreeningFormValidationErrors,
} from "@/lib/screening";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Sliders, Play, RotateCcw, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";

export {
  validateScreeningQueryParams,
  parseNoradIds,
  PRESET_STATIONS,
  PRESET_COSMOS_DEBRIS,
};
export type { ScreeningFormValidationErrors };

export interface ScreeningQueryFormProps {
  onSubmit: (request: ConjunctionScreeningRequest) => Promise<void> | void;
  isLoading: boolean;
  isDemoMode?: boolean;
  initialValues?: Partial<ConjunctionScreeningRequest>;
}

export const ScreeningQueryForm: React.FC<ScreeningQueryFormProps> = ({
  onSubmit,
  isLoading,
  isDemoMode = false,
  initialValues,
}) => {
  const startTimeId = useId();
  const endTimeId = useId();
  const noradIdsId = useId();
  const thresholdKmId = useId();
  const stepSecondsId = useId();

  const [isOpen, setIsOpen] = useState<boolean>(false);

  // Initialize default window: now -> now + 2 hours
  const getDefaultStartTime = () => {
    if (initialValues?.start_time) return initialValues.start_time;
    const now = new Date();
    return now.toISOString();
  };

  const getDefaultEndTime = () => {
    if (initialValues?.end_time) return initialValues.end_time;
    const now = new Date();
    const future = new Date(now.getTime() + 2 * 3600 * 1000);
    return future.toISOString();
  };

  const [startTime, setStartTime] = useState<string>(getDefaultStartTime);
  const [endTime, setEndTime] = useState<string>(getDefaultEndTime);
  const [noradIdsInput, setNoradIdsInput] = useState<string>(() => {
    if (initialValues?.norad_ids && initialValues.norad_ids.length > 0) {
      return initialValues.norad_ids.join(", ");
    }
    return PRESET_STATIONS;
  });
  const [thresholdKm, setThresholdKm] = useState<string>(() =>
    initialValues?.threshold_km != null ? String(initialValues.threshold_km) : "10.0"
  );
  const [stepSeconds, setStepSeconds] = useState<string>(() =>
    initialValues?.step_seconds != null ? String(initialValues.step_seconds) : "60.0"
  );
  const [validationErrors, setValidationErrors] = useState<ScreeningFormValidationErrors>({});

  const handleResetToNow = () => {
    const now = new Date();
    const future = new Date(now.getTime() + 2 * 3600 * 1000);
    setStartTime(now.toISOString());
    setEndTime(future.toISOString());
    setThresholdKm("10.0");
    setStepSeconds("60.0");
    setValidationErrors({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const { isValid, errors, parsedNoradIds: validatedNoradIds } = validateScreeningQueryParams(
      startTime,
      endTime,
      thresholdKm,
      stepSeconds,
      noradIdsInput
    );

    if (!isValid) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors({});

    const parsedThreshold = parseFloat(thresholdKm);
    const parsedStep = parseFloat(stepSeconds);

    const requestPayload: ConjunctionScreeningRequest = {
      ...createDefaultScreeningRequest(
        startTime,
        endTime,
        validatedNoradIds.length > 0 ? validatedNoradIds : undefined,
        parsedThreshold
      ),
      step_seconds: parsedStep,
      target_frame: "GCRS",
    };

    await onSubmit(requestPayload);
  };

  return (
    <Card className="border-space-border bg-space-surface/90 shadow-panel">
      <CardHeader className="border-b border-space-border/80 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-2 text-left focus:outline-none group cursor-pointer"
          >
            <Sliders className="h-4 w-4 text-cyan group-hover:rotate-45 transition-transform" />
            <CardTitle className="text-slate-200 group-hover:text-cyan transition-colors">
              Conjunction Screening Query Parameters
            </CardTitle>
            {isOpen ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </button>

          <div className="flex items-center gap-2">
            <Badge variant="cyan" size="sm" className="font-semibold tracking-wider">
              <ShieldCheck className="h-3 w-3 inline mr-1 text-cyan" />
              Target Frame: Inertial GCRS [Locked]
            </Badge>
            {isDemoMode && (
              <Badge variant="amber" size="sm">
                OFFLINE DEMO MODE
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {isOpen && (
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Start Time */}
            <div className="space-y-1.5">
              <label
                htmlFor={startTimeId}
                className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300"
              >
                Screening Window Start (UTC)
              </label>
              <input
                id={startTimeId}
                type="text"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="YYYY-MM-DDTHH:MM:SSZ"
                className={`w-full rounded-lg border bg-space-panel/90 px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 ${
                  validationErrors.startTime
                    ? "border-rose-500 focus:ring-rose-500"
                    : "border-space-border focus:ring-cyan"
                }`}
              />
              {validationErrors.startTime && (
                <span className="text-[11px] font-mono text-rose-400 block">
                  {validationErrors.startTime}
                </span>
              )}
            </div>

            {/* End Time */}
            <div className="space-y-1.5">
              <label
                htmlFor={endTimeId}
                className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300"
              >
                Screening Window End (UTC)
              </label>
              <input
                id={endTimeId}
                type="text"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="YYYY-MM-DDTHH:MM:SSZ"
                className={`w-full rounded-lg border bg-space-panel/90 px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 ${
                  validationErrors.endTime
                    ? "border-rose-500 focus:ring-rose-500"
                    : "border-space-border focus:ring-cyan"
                }`}
              />
              {validationErrors.endTime && (
                <span className="text-[11px] font-mono text-rose-400 block">
                  {validationErrors.endTime}
                </span>
              )}
            </div>

            {/* NORAD Catalog IDs */}
            <div className="space-y-1.5 md:col-span-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={noradIdsId}
                  className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300"
                >
                  Tracked Objects / NORAD Catalog IDs
                </label>
                <div className="flex items-center gap-2 text-[11px] font-mono">
                  <span className="text-slate-400">Presets:</span>
                  <button
                    type="button"
                    onClick={() => setNoradIdsInput(PRESET_STATIONS)}
                    className="text-cyan hover:underline cursor-pointer"
                  >
                    ISS & CSS
                  </button>
                  <span className="text-slate-600">|</span>
                  <button
                    type="button"
                    onClick={() => setNoradIdsInput(PRESET_COSMOS_DEBRIS)}
                    className="text-cyan hover:underline cursor-pointer"
                  >
                    Cosmos 2251 Debris
                  </button>
                </div>
              </div>
              <input
                id={noradIdsId}
                type="text"
                value={noradIdsInput}
                onChange={(e) => setNoradIdsInput(e.target.value)}
                placeholder="e.g. 25544, 48274 (comma or space separated)"
                className={`w-full rounded-lg border bg-space-panel/90 px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 ${
                  validationErrors.noradIds
                    ? "border-rose-500 focus:ring-rose-500"
                    : "border-space-border focus:ring-cyan"
                }`}
              />
              {validationErrors.noradIds && (
                <span className="text-[11px] font-mono text-rose-400 block">
                  {validationErrors.noradIds}
                </span>
              )}
            </div>

            {/* Threshold & Step */}
            <div className="space-y-1.5">
              <label
                htmlFor={thresholdKmId}
                className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300"
              >
                Alert Miss Distance Threshold (km)
              </label>
              <input
                id={thresholdKmId}
                type="number"
                step="0.5"
                min="0.1"
                max="50.0"
                value={thresholdKm}
                onChange={(e) => setThresholdKm(e.target.value)}
                className={`w-full rounded-lg border bg-space-panel/90 px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 ${
                  validationErrors.thresholdKm
                    ? "border-rose-500 focus:ring-rose-500"
                    : "border-space-border focus:ring-cyan"
                }`}
              />
              {validationErrors.thresholdKm && (
                <span className="text-[11px] font-mono text-rose-400 block">
                  {validationErrors.thresholdKm}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={stepSecondsId}
                className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300"
              >
                Coarse Search Step Interval (seconds)
              </label>
              <input
                id={stepSecondsId}
                type="number"
                step="10.0"
                min="10.0"
                max="300.0"
                value={stepSeconds}
                onChange={(e) => setStepSeconds(e.target.value)}
                className={`w-full rounded-lg border bg-space-panel/90 px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 ${
                  validationErrors.stepSeconds
                    ? "border-rose-500 focus:ring-rose-500"
                    : "border-space-border focus:ring-cyan"
                }`}
              />
              {validationErrors.stepSeconds && (
                <span className="text-[11px] font-mono text-rose-400 block">
                  {validationErrors.stepSeconds}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-space-border/60">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleResetToNow}
              disabled={isLoading}
              className="font-mono text-xs gap-1.5"
            >
              <RotateCcw className="h-3 w-3" />
              Reset Window (Now + 2h)
            </Button>

            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isLoading}
              disabled={isLoading}
              className="font-mono text-xs gap-1.5"
            >
              <Play className="h-3.5 w-3.5" />
              Execute Conjunction Screening
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
};

