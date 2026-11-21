import React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "panel" | "elevated" | "outline";
}

export const Card: React.FC<CardProps> = ({
  className,
  variant = "default",
  children,
  ...props
}) => {
  const variantStyles = {
    default: "bg-space-surface/90 border-space-border backdrop-blur-md shadow-panel",
    panel: "bg-space-panel/90 border-space-border backdrop-blur-md shadow-panel",
    elevated: "glass-panel-elevated",
    outline: "bg-transparent border-space-border hover:border-space-border-light",
  };

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => <div className={cn("p-4 sm:p-5 pb-2", className)} {...props} />;

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className,
  ...props
}) => (
  <h3
    className={cn(
      "font-heading text-sm sm:text-base font-bold text-slate-100 tracking-wide uppercase",
      className
    )}
    {...props}
  />
);

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  className,
  ...props
}) => (
  <p
    className={cn("text-xs text-slate-400 mt-0.5 leading-relaxed font-sans", className)}
    {...props}
  />
);

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => <div className={cn("p-4 sm:p-5 pt-2", className)} {...props} />;

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div
    className={cn(
      "p-4 sm:p-5 pt-0 border-t border-space-border/60 flex items-center justify-between",
      className
    )}
    {...props}
  />
);
