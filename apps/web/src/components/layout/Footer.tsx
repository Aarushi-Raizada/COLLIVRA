import React from "react";
import { ShieldCheck, Globe, Compass } from "lucide-react";

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-space-border bg-space-surface/90 backdrop-blur-md px-4 sm:px-6 py-2 text-xs font-sans text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-2 select-none shrink-0">
      <div className="flex items-center space-x-2 text-center sm:text-left min-w-0">
        <ShieldCheck className="h-3.5 w-3.5 text-cyan shrink-0" />
        <span className="text-[11px] sm:text-xs">
          <strong className="text-slate-200 font-semibold">COLLIVRA:</strong> See the risk. Secure the orbit. · Heuristic risk scores [0.0 - 100.0] are analytical triage indices, NOT formal collision probabilities ($P_c$).
        </span>
      </div>

      <div className="flex items-center space-x-3 shrink-0 text-[10px] font-mono tabular-nums text-slate-400">
        <span className="hidden lg:inline text-slate-400">TEAM ERRORISTS · ASTRA 2026</span>
        <div className="flex items-center space-x-1.5 border-l border-space-border/60 pl-3">
          <Globe className="h-3 w-3 text-cyan" />
          <span>INERTIAL GCRS (IAU 2000)</span>
        </div>
        <div className="hidden md:flex items-center space-x-1.5 border-l border-space-border/60 pl-3">
          <Compass className="h-3 w-3 text-emerald-400" />
          <span>RE-ENTRY: 6,478.137 KM</span>
        </div>
      </div>
    </footer>
  );
};
