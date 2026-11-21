"use client";

import React from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Clock,
  ShieldCheck,
  FastForward,
} from "lucide-react";

interface TimeScrubberProps {
  currentEpochMs: number;
  startEpochMs: number;
  endEpochMs: number;
  isPlaying: boolean;
  playbackSpeed: number;
  isOutOfBounds?: boolean;
  onTogglePlay: () => void;
  onSetSpeed: (speed: number) => void;
  onSeek: (epochMs: number) => void;
  onReset: () => void;
}

export const TimeScrubber: React.FC<TimeScrubberProps> = ({
  currentEpochMs,
  startEpochMs,
  endEpochMs,
  isPlaying,
  playbackSpeed,
  isOutOfBounds = false,
  onTogglePlay,
  onSetSpeed,
  onSeek,
  onReset,
}) => {
  const currentIso = new Date(currentEpochMs).toISOString();
  const totalDurationMs = Math.max(1, endEpochMs - startEpochMs);
  const elapsedMinutes = ((currentEpochMs - startEpochMs) / 60000).toFixed(1);
  const totalMinutes = (totalDurationMs / 60000).toFixed(1);

  const speeds = [1, 5, 10, 30, 60];

  return (
    <div className="absolute bottom-3 2xl:bottom-4 left-3 2xl:left-4 right-3 2xl:right-4 z-20 max-w-4xl mx-auto rounded-xl border border-space-border bg-space-bg/90 backdrop-blur-md p-2.5 2xl:p-3 text-xs font-mono text-slate-300 shadow-2xl">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-2">
        {/* Left: Playback & Reset Buttons & Quick Seek */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={onTogglePlay}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
              isPlaying
                ? "bg-status-warning/20 text-status-warning border border-status-warning/40 hover:bg-status-warning/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]"
                : "bg-cyan/20 text-cyan border border-cyan/40 hover:bg-cyan/30 shadow-[0_0_10px_rgba(6,182,212,0.2)]"
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                <span>PAUSE</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>PLAY</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onReset}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-space-border bg-space-surface text-slate-400 hover:text-slate-200 hover:bg-space-panel transition-colors"
            title="Reset to Start Epoch"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">RESET</span>
          </button>

          {/* Quick Jump Buttons (Visual spec: Now, +24h, +72h) */}
          <div className="hidden lg:flex items-center space-x-1 pl-2 border-l border-space-border">
            <button
              type="button"
              onClick={() => onSeek(startEpochMs)}
              className="px-2 py-1 rounded text-[10px] font-bold bg-space-surface border border-space-border text-slate-300 hover:text-cyan hover:border-cyan/40 transition-colors"
            >
              NOW
            </button>
            <button
              type="button"
              onClick={() => onSeek(Math.min(endEpochMs, startEpochMs + 24 * 60 * 1000))}
              className="px-2 py-1 rounded text-[10px] font-bold bg-space-surface border border-space-border text-slate-300 hover:text-cyan hover:border-cyan/40 transition-colors"
              title="Jump forward (within sample window)"
            >
              +24M
            </button>
            <button
              type="button"
              onClick={() => onSeek(Math.min(endEpochMs, startEpochMs + 72 * 60 * 1000))}
              className="px-2 py-1 rounded text-[10px] font-bold bg-space-surface border border-space-border text-slate-300 hover:text-cyan hover:border-cyan/40 transition-colors"
              title="Jump forward (within sample window)"
            >
              +72M
            </button>
          </div>

          {/* Speed Selectors */}
          <div className="flex items-center space-x-1 pl-2 border-l border-space-border">
            {speeds.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSetSpeed(s)}
                className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${
                  playbackSpeed === s
                    ? "bg-cyan/25 text-cyan border border-cyan/50 font-bold shadow-[0_0_8px_rgba(6,182,212,0.3)]"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Center: Live UTC Clock & Time Progress */}
        <div className="flex items-center space-x-3 text-[11px]">
          <div className="flex items-center space-x-1.5 text-cyan">
            <Clock className="h-3.5 w-3.5 text-cyan animate-pulse" />
            <span className="font-bold tabular-nums">
              {currentIso.replace("T", " ").replace("Z", " UTC")}
            </span>
          </div>
          <span className="text-slate-600">•</span>
          <div className="text-slate-400 text-[10px] tabular-nums">
            T+{elapsedMinutes}m / {totalMinutes}m
          </div>
        </div>

        {/* Right: Guardrail Notice */}
        <div className="hidden md:flex items-center space-x-1 text-[10px]">
          {isOutOfBounds ? (
            <span className="text-status-critical font-bold flex items-center gap-1">
              <span>OUT OF BOUNDS (NO EXTRAPOLATION)</span>
            </span>
          ) : (
            <span className="text-status-success flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-status-success" />
              <span>STRICT NO-EXTRAPOLATION</span>
            </span>
          )}
        </div>
      </div>

      {/* Scrub Slider */}
      <div className="flex items-center space-x-2">
        <input
          type="range"
          min={startEpochMs}
          max={endEpochMs}
          step={1000} // 1 second scrubbing granularity
          value={currentEpochMs}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="w-full h-1.5 bg-space-panel rounded-lg appearance-none cursor-pointer accent-cyan"
        />
      </div>
    </div>
  );
};

