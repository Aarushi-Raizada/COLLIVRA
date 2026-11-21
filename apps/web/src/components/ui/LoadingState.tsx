import React from "react";
import { cn } from "@/lib/utils";
import { Radio } from "lucide-react";

export interface LoadingStateProps {
  message?: string;
  submessage?: string;
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = "PROCESSING ORBITAL TELEMETRY...",
  submessage,
  className,
}) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-12 text-center rounded-xl border border-space-border/60 bg-space-surface/40 backdrop-blur-md space-y-3 font-mono",
        className
      )}
    >
      <div className="relative flex items-center justify-center">
        <span className="absolute h-10 w-10 animate-ping rounded-full bg-cyan/20 duration-1000" />
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-space-panel border border-cyan/40 text-cyan">
          <Radio className="h-5 w-5 animate-pulse" />
        </div>
      </div>
      <div className="text-xs font-bold text-slate-200 tracking-wider">
        {message}
      </div>
      {submessage && (
        <p className="text-[11px] text-slate-400 font-sans max-w-sm">
          {submessage}
        </p>
      )}
    </div>
  );
};

