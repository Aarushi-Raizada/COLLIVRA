import React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "critical"
  | "warning"
  | "success"
  | "cyan"
  | "blue"
  | "slate"
  | "default"
  | "outline"
  | "amber"
  | "emerald"
  | "rose";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: "sm" | "md";
  dot?: boolean;
  pulseDot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = "cyan",
  size = "md",
  dot = false,
  pulseDot = false,
  children,
  ...props
}) => {
  const showDot = dot || pulseDot;
  const variantStyles: Record<BadgeVariant, string> = {
    critical:
      "bg-status-critical/15 text-rose-300 border-status-critical/40 shadow-[0_0_8px_rgba(239,68,68,0.15)]",
    rose:
      "bg-status-critical/15 text-rose-300 border-status-critical/40 shadow-[0_0_8px_rgba(239,68,68,0.15)]",
    warning:
      "bg-status-warning/15 text-amber-300 border-status-warning/40 shadow-[0_0_8px_rgba(245,158,11,0.15)]",
    amber:
      "bg-status-warning/15 text-amber-300 border-status-warning/40 shadow-[0_0_8px_rgba(245,158,11,0.15)]",
    success:
      "bg-status-success/15 text-emerald-300 border-status-success/40 shadow-[0_0_8px_rgba(34,197,94,0.15)]",
    emerald:
      "bg-status-success/15 text-emerald-300 border-status-success/40 shadow-[0_0_8px_rgba(34,197,94,0.15)]",
    cyan: "bg-cyan/15 text-cyan-300 border-cyan/40 shadow-[0_0_8px_rgba(6,182,212,0.15)]",
    blue: "bg-blue/15 text-blue-300 border-blue/40 shadow-[0_0_8px_rgba(59,130,246,0.15)]",
    slate: "bg-space-panel text-slate-300 border-space-border",
    default: "bg-space-panel text-slate-300 border-space-border",
    outline: "bg-transparent text-slate-300 border-space-border",
  };

  const dotColors: Record<BadgeVariant, string> = {
    critical: "bg-status-critical shadow-[0_0_6px_#ef4444]",
    rose: "bg-status-critical shadow-[0_0_6px_#ef4444]",
    warning: "bg-status-warning shadow-[0_0_6px_#f59e0b]",
    amber: "bg-status-warning shadow-[0_0_6px_#f59e0b]",
    success: "bg-status-success shadow-[0_0_6px_#22c55e]",
    emerald: "bg-status-success shadow-[0_0_6px_#22c55e]",
    cyan: "bg-cyan shadow-[0_0_6px_#06b6d4]",
    blue: "bg-blue shadow-[0_0_6px_#3b82f6]",
    slate: "bg-slate-400",
    default: "bg-slate-400",
    outline: "bg-slate-400",
  };

  const sizeStyles = {
    sm: "px-1.5 py-0.5 text-[10px] tracking-wider",
    md: "px-2.5 py-1 text-xs tracking-wide",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-sans font-semibold uppercase transition-colors shrink-0 select-none",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {showDot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full shrink-0 animate-pulse", dotColors[variant])}
        />
      )}
      {children}
    </span>
  );
};
