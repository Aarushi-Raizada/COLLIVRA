import React from "react";
import { cn } from "@/lib/utils";

export interface StatusIndicatorProps {
  status: "connected" | "disconnected" | "error" | "connecting";
  label?: string;
  latencyMs?: number;
  className?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  label,
  latencyMs,
  className,
}) => {
  const statusConfig = {
    connected: {
      dot: "bg-status-success shadow-[0_0_8px_#22c55e]",
      badge: "border-status-success/40 bg-status-success/10 text-emerald-300",
      defaultLabel: "System Operational",
    },
    disconnected: {
      dot: "bg-slate-500",
      badge: "border-slate-700 bg-space-panel text-slate-400",
      defaultLabel: "Offline Mode",
    },
    connecting: {
      dot: "bg-cyan animate-pulse shadow-[0_0_8px_#06b6d4]",
      badge: "border-cyan/40 bg-cyan/10 text-cyan",
      defaultLabel: "Connecting...",
    },
    error: {
      dot: "bg-status-critical animate-pulse shadow-[0_0_8px_#ef4444]",
      badge: "border-status-critical/40 bg-status-critical/10 text-rose-300",
      defaultLabel: "API Disconnected",
    },
  };

  const current = statusConfig[status];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-sans font-semibold backdrop-blur-md transition-colors select-none",
        current.badge,
        className
      )}
    >
      <span className={cn("h-2 w-2 rounded-full shrink-0", current.dot)} />
      <span className="tracking-wide uppercase text-[11px] sm:text-xs">{label || current.defaultLabel}</span>
      {latencyMs !== undefined && latencyMs !== null && (
        <span className="text-[10px] font-mono tabular-nums text-slate-400 border-l border-slate-700 pl-2">
          {latencyMs}ms
        </span>
      )}
    </div>
  );
};
