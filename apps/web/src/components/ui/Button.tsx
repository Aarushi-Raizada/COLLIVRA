import React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "xs" | "sm" | "md" | "lg";
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  className,
  variant = "primary",
  size = "md",
  isLoading = false,
  disabled,
  children,
  ...props
}) => {
  const variantStyles = {
    primary:
      "bg-cyan hover:bg-cyan-400 text-slate-950 font-semibold border border-cyan-300/80 shadow-[0_0_12px_rgba(6,182,212,0.25)] hover:shadow-[0_0_18px_rgba(6,182,212,0.4)] active:scale-[0.99]",
    secondary:
      "bg-space-surface hover:bg-space-panel text-slate-200 border border-space-border hover:border-space-border-light active:scale-[0.99]",
    outline:
      "bg-transparent hover:bg-cyan/10 text-cyan hover:text-cyan-300 border border-cyan/40 hover:border-cyan active:scale-[0.99]",
    ghost:
      "bg-transparent hover:bg-space-surface text-slate-400 hover:text-slate-100 border border-transparent",
    danger:
      "bg-status-critical/15 hover:bg-status-critical/25 text-rose-200 border border-status-critical/50 hover:border-status-critical shadow-[0_0_12px_rgba(239,68,68,0.2)] active:scale-[0.99]",
  };

  const sizeStyles = {
    xs: "px-2 py-0.5 text-[11px] rounded font-medium",
    sm: "px-2.5 py-1 text-xs rounded-md font-medium",
    md: "px-3.5 py-1.5 text-xs sm:text-sm rounded-lg font-medium",
    lg: "px-4.5 py-2 text-sm sm:text-base rounded-lg font-semibold",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-sans transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan/40 disabled:opacity-50 disabled:pointer-events-none cursor-pointer tracking-wide select-none",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent shrink-0" />
      ) : null}
      {children}
    </button>
  );
};
