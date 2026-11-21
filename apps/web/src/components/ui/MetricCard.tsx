import React from "react";
import { cn } from "@/lib/utils";
import { Card } from "./Card";

export interface MetricCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: React.ReactNode;
  variant?: "cyan" | "emerald" | "amber" | "rose" | "blue" | "default";
  trend?: {
    value: string;
    isPositive?: boolean;
  };
  className?: string;
  onClick?: () => void;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  sublabel,
  icon,
  variant = "default",
  trend,
  className,
  onClick,
}) => {
  const iconBorderStyles = {
    default: "border-space-border bg-space-panel text-slate-300",
    cyan: "border-cyan/30 bg-cyan/10 text-cyan shadow-[0_0_12px_rgba(6,182,212,0.15)]",
    emerald: "border-status-success/30 bg-status-success/10 text-emerald-400 shadow-[0_0_12px_rgba(34,197,94,0.15)]",
    amber: "border-status-warning/30 bg-status-warning/10 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.15)]",
    rose: "border-status-critical/30 bg-status-critical/10 text-rose-400 shadow-[0_0_12px_rgba(239,68,68,0.15)]",
    blue: "border-blue/30 bg-blue/10 text-blue shadow-[0_0_12px_rgba(59,130,246,0.15)]",
  };

  const valueGlowStyles = {
    default: "text-slate-100",
    cyan: "text-slate-100 group-hover:text-cyan transition-colors",
    emerald: "text-slate-100",
    amber: "text-amber-300",
    rose: "text-rose-300",
    blue: "text-blue-300",
  };

  return (
    <Card
      className={cn(
        "p-4 sm:p-5 relative overflow-hidden group border-space-border/80 hover:border-space-border-light transition-all flex flex-col justify-between h-full min-h-[105px]",
        onClick && "cursor-pointer hover:border-cyan/40",
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-sans font-medium uppercase tracking-wider text-slate-400">
            {label}
          </p>
          <div className="flex items-baseline gap-2">
            <h4
              className={cn(
                "text-2xl sm:text-3xl font-heading font-black tabular-nums tracking-tight",
                valueGlowStyles[variant]
              )}
            >
              {value}
            </h4>
            {trend && (
              <span
                className={cn(
                  "text-xs font-sans font-bold",
                  trend.isPositive ? "text-emerald-400" : "text-rose-400"
                )}
              >
                {trend.value}
              </span>
            )}
          </div>
          {sublabel && (
            <p className="text-xs text-slate-400 font-sans leading-tight">
              {sublabel}
            </p>
          )}
        </div>

        {icon && (
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
              iconBorderStyles[variant]
            )}
          >
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
};
