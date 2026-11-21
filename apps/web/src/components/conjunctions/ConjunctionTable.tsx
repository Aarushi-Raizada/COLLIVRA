"use client";

import React, { useState, useMemo } from "react";
import { ConjunctionEvent, RiskAssessment, ScreeningCategory } from "@/types/api";
import { formatUtcDateTime, formatDistanceKm, formatVelocityKms } from "@/lib/utils";
import {
  SortField,
  SortDirection,
  sortConjunctionEvents,
  filterConjunctionEvents,
  isSyntheticObject,
} from "@/lib/screening";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import {
  Search,
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Layers,
  ShieldAlert,
  RotateCcw,
  AlertTriangle,
  Radio,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";

export type { SortField, SortDirection };
export { sortConjunctionEvents, filterConjunctionEvents };

export interface ConjunctionTableProps {
  events: ConjunctionEvent[];
  riskAssessments?: Record<string, RiskAssessment>;
  isAssessingRisk?: boolean;
  selectedEventId: string | null;
  onSelectEvent: (event: ConjunctionEvent) => void;
  className?: string;
}

export const ConjunctionTable: React.FC<ConjunctionTableProps> = ({
  events,
  riskAssessments,
  isAssessingRisk = false,
  selectedEventId,
  onSelectEvent,
  className = "",
}) => {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<SortField>("miss_distance_km");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Handle column sort toggle
  const handleSortToggle = (field: SortField) => {
    if (sortBy === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDirection("asc");
    }
  };

  // Filter and sort events
  const filteredEvents = useMemo(() => {
    return filterConjunctionEvents(events, severityFilter, searchQuery);
  }, [events, severityFilter, searchQuery]);

  const sortedEvents = useMemo(() => {
    return sortConjunctionEvents(filteredEvents, sortBy, sortDirection, riskAssessments);
  }, [filteredEvents, sortBy, sortDirection, riskAssessments]);

  const hasActiveFilters = searchQuery.trim().length > 0 || severityFilter !== "ALL";

  const renderSortIcon = (field: SortField) => {
    if (sortBy !== field) {
      return <ArrowUpDown className="h-3 w-3 text-slate-500 opacity-60" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="h-3 w-3 text-cyan font-bold" />
    ) : (
      <ArrowDown className="h-3 w-3 text-cyan font-bold" />
    );
  };

  const getSeverityBadge = (category: ScreeningCategory) => {
    switch (category) {
      case "CRITICAL":
        return (
          <Badge variant="rose" size="sm" className="font-bold tracking-wide uppercase px-2 py-0.5">
            CRITICAL (&lt;1 km)
          </Badge>
        );
      case "HIGH":
        return (
          <Badge variant="amber" size="sm" className="font-bold tracking-wide uppercase px-2 py-0.5">
            HIGH (1–5 km)
          </Badge>
        );
      case "MODERATE":
        return (
          <Badge variant="warning" size="sm" className="font-bold tracking-wide uppercase px-2 py-0.5">
            MODERATE (5–10 km)
          </Badge>
        );
      case "LOW":
        return (
          <Badge variant="emerald" size="sm" className="font-bold tracking-wide uppercase px-2 py-0.5">
            LOW (≥10 km)
          </Badge>
        );
      default:
        return (
          <Badge variant="slate" size="sm">
            {category}
          </Badge>
        );
    }
  };

  const getRowSeverityStyles = (category: ScreeningCategory, isSelected: boolean) => {
    if (isSelected) {
      return "bg-cyan/15 border-l-4 border-l-cyan ring-1 ring-cyan/60 shadow-lg shadow-cyan/10";
    }

    switch (category) {
      case "CRITICAL":
        return "border-l-4 border-l-rose-500 bg-rose-950/20 hover:bg-rose-950/30";
      case "HIGH":
        return "border-l-4 border-l-amber-500 bg-amber-950/15 hover:bg-amber-950/25";
      case "MODERATE":
        return "border-l-4 border-l-yellow-500/80 bg-yellow-950/10 hover:bg-yellow-950/20";
      case "LOW":
        return "border-l-4 border-l-emerald-500/60 bg-emerald-950/5 hover:bg-emerald-950/15";
      default:
        return "border-l-4 border-l-slate-700 bg-space-surface/50 hover:bg-space-surface/80";
    }
  };

  return (
    <Card className={`border-space-border bg-space-surface/90 p-3.5 sm:p-4 2xl:p-5 space-y-3 2xl:space-y-4 shadow-panel ${className}`}>
      {/* Table Header: Title & Counts */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2.5 border-b border-space-border/80">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-cyan" />
          <h3 className="text-xs 2xl:text-sm font-space font-bold uppercase tracking-wider text-slate-100">
            Conjunction Events Queue
          </h3>
          <Badge variant="cyan" size="sm" className="font-mono">
            {sortedEvents.length} / {events.length}
          </Badge>
        </div>

        <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Select any event to load 3D encounter geometry</span>
        </div>
      </div>

      {/* Table Control Bar: Search & Severity Filters */}
      <div className="flex flex-col 2xl:flex-row items-stretch 2xl:items-center justify-between gap-2 pb-2.5 border-b border-space-border/60">
        {/* Left: Search Input */}
        <div className="relative w-full 2xl:w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search NORAD, object, or event ID..."
            className="w-full rounded-md border border-space-border bg-space-panel/90 pl-8 pr-3 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan"
          />
        </div>

        {/* Right: Severity Filter Buttons */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-mono text-slate-400 mr-1 flex items-center gap-1 shrink-0">
            <Filter className="h-3 w-3" /> Filter:
          </span>
          {(["ALL", "CRITICAL", "HIGH", "MODERATE", "LOW"] as const).map((cat) => {
            const isActive = severityFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSeverityFilter(cat)}
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-colors cursor-pointer ${
                  isActive
                    ? "bg-cyan text-space-bg font-bold shadow-glow-cyan"
                    : "bg-space-panel text-slate-400 hover:text-slate-200 hover:bg-space-surface"
                }`}
              >
                {cat}
              </button>
            );
          })}

          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setSeverityFilter("ALL");
              }}
              className="ml-1 inline-flex items-center gap-1 text-[11px] font-mono text-cyan hover:text-cyan-300 hover:underline px-1 py-0.5 cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Events Table Container with Scrollable Body */}
      <div className="overflow-x-auto rounded-lg border border-space-border bg-space-panel/40 max-h-[680px] overflow-y-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-space-panel/95 text-slate-400 uppercase text-[10px] tracking-wider border-b border-space-border sticky top-0 z-10 backdrop-blur-md">
            <tr>
              <th className="py-2.5 px-3 min-w-[200px]">Encounter & Participants</th>
              <th
                className="py-2.5 px-3 cursor-pointer hover:text-slate-200 transition-colors select-none whitespace-nowrap"
                onClick={() => handleSortToggle("tca")}
              >
                <div className="flex items-center gap-1">
                  <span>TCA (UTC)</span>
                  {renderSortIcon("tca")}
                </div>
              </th>
              <th
                className="py-2.5 px-3 cursor-pointer hover:text-slate-200 transition-colors select-none whitespace-nowrap"
                onClick={() => handleSortToggle("miss_distance_km")}
              >
                <div className="flex items-center gap-1">
                  <span>Miss Dist (km)</span>
                  {renderSortIcon("miss_distance_km")}
                </div>
              </th>
              <th
                className="py-2.5 px-3 cursor-pointer hover:text-slate-200 transition-colors select-none whitespace-nowrap"
                onClick={() => handleSortToggle("relative_speed_kms")}
              >
                <div className="flex items-center gap-1">
                  <span>Rel Speed (km/s)</span>
                  {renderSortIcon("relative_speed_kms")}
                </div>
              </th>
              <th
                className="py-2.5 px-3 cursor-pointer hover:text-slate-200 transition-colors select-none whitespace-nowrap"
                onClick={() => handleSortToggle("category")}
              >
                <div className="flex items-center gap-1">
                  <span>Severity</span>
                  {renderSortIcon("category")}
                </div>
              </th>
              <th
                className="py-2.5 px-3 cursor-pointer hover:text-slate-200 transition-colors select-none whitespace-nowrap"
                onClick={() => handleSortToggle("risk")}
              >
                <div className="flex items-center gap-1">
                  <span>Heuristic Risk [0-100]</span>
                  {renderSortIcon("risk")}
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-space-border/60">
            {sortedEvents.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <ShieldAlert className="h-6 w-6 text-slate-600" />
                    <span>No conjunction events match the active search and filters.</span>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery("");
                          setSeverityFilter("ALL");
                        }}
                        className="text-cyan hover:underline text-xs mt-1 cursor-pointer"
                      >
                        Clear Filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              sortedEvents.map((ev) => {
                const isSelected = ev.event_id === selectedEventId;
                const risk = riskAssessments?.[ev.event_id];

                return (
                  <tr
                    key={ev.event_id}
                    onClick={() => onSelectEvent(ev)}
                    className={`cursor-pointer transition-all duration-150 ${getRowSeverityStyles(
                      ev.category,
                      isSelected
                    )}`}
                  >
                    {/* Encounter ID & Participants */}
                    <td className="py-2.5 px-3">
                      <div className="flex flex-col gap-1">
                        {/* Event Identifier Header */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-[11px] font-bold text-cyan">
                            {ev.event_id}
                          </span>
                          {isSelected && (
                            <span className="text-[10px] uppercase font-bold text-cyan bg-cyan/20 px-1.5 py-0.2 rounded border border-cyan/40">
                              ACTIVE
                            </span>
                          )}
                        </div>

                        {/* Primary Object Row */}
                        <div className="flex items-center gap-1.5 flex-wrap text-xs">
                          <span className="text-[10px] uppercase font-bold text-cyan shrink-0">PRI:</span>
                          <span className="font-semibold text-slate-100">
                            {ev.object_1_name || `Object ${ev.object_1_id}`}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono shrink-0">
                            [{ev.object_1_id}]
                          </span>
                          {isSyntheticObject(ev.object_1_id, ev.object_1_is_synthetic) && (
                            <Badge variant="amber" size="sm" className="text-[9px] py-0 px-1 font-mono shrink-0">
                              SYNTH
                            </Badge>
                          )}
                        </div>

                        {/* Secondary Object Row */}
                        <div className="flex items-center gap-1.5 flex-wrap text-xs">
                          <span className="text-[10px] uppercase font-bold text-rose-400 shrink-0">SEC:</span>
                          <span className="font-semibold text-slate-300">
                            {ev.object_2_name || `Object ${ev.object_2_id}`}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono shrink-0">
                            [{ev.object_2_id}]
                          </span>
                          {isSyntheticObject(
                            ev.object_2_id,
                            ev.object_2_is_synthetic ?? ev.is_synthetic
                          ) && (
                            <Badge variant="amber" size="sm" className="text-[9px] py-0 px-1 font-mono shrink-0">
                              SYNTH
                            </Badge>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* TCA (UTC) */}
                    <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap tabular-nums">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-100">
                          {formatUtcDateTime(ev.tca).split(" ")[1] || ""} UTC
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {formatUtcDateTime(ev.tca).split(" ")[0] || ""}
                        </span>
                      </div>
                    </td>

                    {/* Miss Distance & Threat Meter */}
                    <td className="py-2.5 px-3 whitespace-nowrap tabular-nums">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`font-mono text-xs font-bold ${
                            ev.miss_distance_km < 1.0
                              ? "text-rose-400"
                              : ev.miss_distance_km < 5.0
                              ? "text-amber-400"
                              : ev.miss_distance_km < 10.0
                              ? "text-yellow-400"
                              : "text-emerald-400"
                          }`}
                        >
                          {formatDistanceKm(ev.miss_distance_km, 3)}
                        </span>
                        {/* Mini Visual Proximity Meter */}
                        <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden flex">
                          <div
                            className={`h-full transition-all ${
                              ev.miss_distance_km < 1.0
                                ? "bg-rose-500 w-full animate-pulse"
                                : ev.miss_distance_km < 5.0
                                ? "bg-amber-500 w-3/4"
                                : ev.miss_distance_km < 10.0
                                ? "bg-yellow-400 w-1/2"
                                : "bg-emerald-500 w-1/4"
                            }`}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Relative Speed */}
                    <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap tabular-nums">
                      <span className="font-semibold text-slate-200">
                        {formatVelocityKms(ev.relative_speed_kms, 3)}
                      </span>
                    </td>

                    {/* Geometric Severity */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {getSeverityBadge(ev.category)}
                    </td>

                    {/* Separate Heuristic Risk Score */}
                    <td className="py-2.5 px-3 whitespace-nowrap tabular-nums">
                      {risk ? (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-bold font-mono text-xs ${
                              risk.risk_category === "CRITICAL"
                                ? "text-rose-400"
                                : risk.risk_category === "HIGH"
                                ? "text-amber-400"
                                : risk.risk_category === "MODERATE"
                                ? "text-yellow-400"
                                : "text-blue-400"
                            }`}
                          >
                            {risk.risk_score.toFixed(1)}
                          </span>
                          <span className="text-[10px] text-slate-400 uppercase font-mono">
                            / 100
                          </span>
                        </div>
                      ) : isAssessingRisk ? (
                        <span className="text-[10px] text-slate-500 font-mono animate-pulse flex items-center gap-1">
                          <Radio className="h-2.5 w-2.5 text-cyan animate-spin" />
                          Evaluating...
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-500 font-mono">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
