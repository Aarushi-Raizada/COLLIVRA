import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { ShieldAlert, Info, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

export interface DisclaimerBannerProps {
  title?: string;
  disclaimer: string;
  variant?: "info" | "warning" | "critical";
  className?: string;
  defaultExpanded?: boolean;
  onDismiss?: () => void;
}

export const DisclaimerBanner: React.FC<DisclaimerBannerProps> = ({
  title,
  disclaimer,
  variant = "info",
  className,
  defaultExpanded = false,
  onDismiss,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);

  const variantStyles = {
    info: {
      container: "border-cyan/30 bg-space-surface/90 text-cyan-200",
      icon: <Info className="h-4 w-4 text-cyan shrink-0" />,
      titleColor: "text-cyan font-bold",
      accentBadge: "border-cyan/40 bg-cyan/10 text-cyan",
    },
    warning: {
      container: "border-status-warning/40 bg-space-surface/90 text-amber-200",
      icon: <AlertTriangle className="h-4 w-4 text-status-warning shrink-0" />,
      titleColor: "text-status-warning font-bold",
      accentBadge: "border-status-warning/40 bg-status-warning/10 text-amber-300",
    },
    critical: {
      container: "border-status-critical/40 bg-space-surface/90 text-rose-200",
      icon: <ShieldAlert className="h-4 w-4 text-status-critical shrink-0" />,
      titleColor: "text-status-critical font-bold",
      accentBadge: "border-status-critical/40 bg-status-critical/10 text-rose-300",
    },
  };

  const style = variantStyles[variant];

  return (
    <div
      className={cn(
        "rounded-xl border backdrop-blur-md transition-all shadow-panel overflow-hidden",
        style.container,
        className
      )}
    >
      {/* Compact Aerospace HUD Header Strip */}
      <div className="flex items-center justify-between px-3.5 py-2.5 sm:px-4 text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          {style.icon}
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {title && (
              <span className={cn("text-xs font-heading font-bold uppercase tracking-wider shrink-0", style.titleColor)}>
                {title}
              </span>
            )}
            <span className="text-slate-400 font-sans text-xs hidden md:inline truncate">
              {isExpanded ? "" : "— Analytical decision-support conventions (Click to inspect full qualifications)"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-space-border bg-space-panel/60 hover:bg-space-panel text-slate-300 hover:text-white text-[11px] font-sans font-medium transition-colors"
          >
            <span>{isExpanded ? "Collapse" : "Details"}</span>
            {isExpanded ? (
              <ChevronUp className="h-3 w-3 text-cyan" />
            ) : (
              <ChevronDown className="h-3 w-3 text-cyan" />
            )}
          </button>

          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-slate-400 hover:text-white p-1 text-xs font-sans font-semibold transition-colors"
              title="Dismiss banner"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Expanded Full Qualification Body */}
      {isExpanded && (
        <div className="px-3.5 pb-3 sm:px-4 sm:pb-3.5 pt-1 border-t border-space-border/50 bg-space-bg/50">
          <p className="text-slate-300 font-sans leading-relaxed text-xs">
            {disclaimer}
          </p>
        </div>
      )}
    </div>
  );
};
