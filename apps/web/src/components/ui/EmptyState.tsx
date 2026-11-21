import React from "react";
import { cn } from "@/lib/utils";
import { FolderSearch } from "lucide-react";
import { Button } from "./Button";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-xl border border-space-border/80 bg-space-surface/50 backdrop-blur-md",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-space-panel border border-space-border text-cyan mb-4">
        {icon || <FolderSearch className="h-6 w-6" />}
      </div>
      <h4 className="font-heading text-sm sm:text-base font-bold text-slate-200 tracking-wide uppercase">
        {title}
      </h4>
      {description && (
        <p className="mt-1.5 text-xs text-slate-400 max-w-sm font-sans leading-relaxed">
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <div className="mt-5">
          <Button size="sm" variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
};

