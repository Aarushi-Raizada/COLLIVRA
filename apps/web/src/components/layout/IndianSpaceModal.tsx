"use client";

import React from "react";
import {
  X,
  Globe,
  Radio,
  ShieldCheck,
  ExternalLink,
  Layers,
  Database,
  AlertTriangle,
  Info,
} from "lucide-react";
import {
  INDIAN_SPACE_CONSTELLATIONS,
  ISRO_IS4OM_SPECIFICATION,
  IndianConstellationSpec,
} from "@/lib/workflow";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

export interface IndianSpaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IndianSpaceModal: React.FC<IndianSpaceModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-space-bg/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-cyan/40 bg-space-surface p-6 shadow-2xl text-slate-200 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-space-border/80">
          <div>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-cyan animate-pulse" />
              <h2 className="text-lg font-heading font-black tracking-wider text-white uppercase">
                Indian Space Ecosystem Relevance (ISRO / IS4OM)
              </h2>
              <Badge variant="cyan" size="sm">
                DOMAIN 01 & 06
              </Badge>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-1">
              Alignment with ISRO System for Safe & Sustainable Space Operations Management (IS4OM)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-space-panel transition-colors"
            title="Close Dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scientific Integrity Guardrail Banner */}
        <div className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-950/20 text-xs font-mono text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold uppercase tracking-wider block">
              SCIENTIFIC INTEGRITY NOTICE — ZERO FABRICATED ORBITAL DATA
            </span>
            <p className="text-slate-300 leading-relaxed text-[11px]">
              {ISRO_IS4OM_SPECIFICATION.disclaimer} Operational ISRO orbital records require authorized IS4OM data feeds or verified CelesTrak OMM ingestion. COLLIVRA&apos;s data models are 100% integration-ready to ingest Indian mission records as verified data becomes available.
            </p>
          </div>
        </div>

        {/* ISRO IS4OM Strategic Alignment Card */}
        <div className="p-4 rounded-xl border border-space-border/80 bg-space-panel/40 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <h3 className="font-heading text-xs font-bold text-white uppercase tracking-wider">
                {ISRO_IS4OM_SPECIFICATION.initiative}
              </h3>
            </div>
            <Badge variant="emerald" size="sm">
              IADC COMPLIANT
            </Badge>
          </div>
          <p className="text-xs text-slate-300 font-sans leading-relaxed">
            COLLIVRA aligns directly with ISRO&apos;s national mandate for space situational awareness, protecting critical space assets, and mitigating orbital collision hazards. The platform&apos;s multi-stage SGP4 screening, synthetic fragmentation modeling, and Clohessy-Wiltshire remediation solvers directly address the analytical requirements of IS4OM research workflows.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 text-[11px] font-mono border-t border-space-border/60">
            <div>
              <span className="text-slate-500">Agency: </span>
              <span className="text-slate-300">{ISRO_IS4OM_SPECIFICATION.agency}</span>
            </div>
            <div>
              <span className="text-slate-500">Ingestion Protocol: </span>
              <span className="text-cyan">{ISRO_IS4OM_SPECIFICATION.ingestionProtocol}</span>
            </div>
          </div>
        </div>

        {/* Indian Constellation Target Architecture Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-slate-300 uppercase tracking-wider">
              Target Indian Satellite Constellations (Integration Architecture)
            </span>
            <span className="text-[10px] font-mono text-cyan">4 CONSTELLATIONS DEFINED</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {INDIAN_SPACE_CONSTELLATIONS.map((c) => (
              <div
                key={c.acronym}
                className="p-4 rounded-xl border border-space-border/80 bg-space-panel/30 hover:border-cyan/40 transition-all space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-heading text-xs font-bold text-white tracking-wide">
                      {c.name}
                    </h4>
                    <span className="text-[11px] font-mono text-cyan font-semibold">
                      {c.acronym}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" size="sm">
                      {c.regime}
                    </Badge>
                    <Badge variant="cyan" size="sm">
                      {c.status}
                    </Badge>
                  </div>
                </div>

                <p className="text-xs text-slate-300 font-sans leading-relaxed">
                  {c.description}
                </p>

                <div className="pt-2 border-t border-space-border/60 text-[10px] font-mono space-y-1">
                  <div>
                    <span className="text-slate-500">Representative Missions: </span>
                    <span className="text-slate-300">{c.representativeMissions.join(", ")}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">CelesTrak Ingestion Source: </span>
                    <span className="text-emerald-400">{c.ingestionSource}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-space-border/80 flex items-center justify-between text-xs font-mono text-slate-400">
          <span>Domain 01: Indian Space Missions & Space Data · ASTRA 2026</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
