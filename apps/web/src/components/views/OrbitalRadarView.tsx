"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { Radar, Orbit, Globe, Flame, Activity, Layers, AlertTriangle } from "lucide-react";
import { Card } from "../ui/Card";
import { MetricCard } from "../ui/MetricCard";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { DisclaimerBanner } from "../ui/DisclaimerBanner";
import { IndianSpaceModal } from "../layout/IndianSpaceModal";
import {
  CATALOG_SATELLITES,
  SYNTHETIC_DEBRIS_CLOUD,
} from "../../lib/orbitFixtures";
import { NavigationTab } from "../../types/orbital";

// Dynamic import with SSR disabled to guarantee zero server-side WebGL errors in Next.js
const OrbitRadarCanvas = dynamic(
  () =>
    import("../visualization/OrbitRadarCanvas").then(
      (mod) => mod.OrbitRadarCanvas
    ),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[440px] xl:h-[450px] 2xl:h-[720px] rounded-2xl border border-space-border bg-space-bg flex flex-col items-center justify-center font-mono text-xs text-slate-400 space-y-3">
        <Radar className="h-8 w-8 text-cyan animate-spin" />
        <div className="text-sm font-bold text-slate-200">
          INITIALIZING WEBGL 3D ORBITAL ENVIRONMENT...
        </div>
        <p className="text-[11px] text-slate-500">
          Mounting GCRS coordinate space and instanced debris cloud (520 fragments)
        </p>
      </div>
    ),
  }
);

export interface OrbitalRadarViewProps {
  selectedObjectId?: string | null;
  onSelectObject?: (objectId: string | null) => void;
  onNavigateTab?: (
    tab: NavigationTab,
    objectId?: string | null,
    subtab?: string | null
  ) => void;
}

export const OrbitalRadarView: React.FC<OrbitalRadarViewProps> = ({
  selectedObjectId,
  onSelectObject,
  onNavigateTab,
}) => {
  const [indianModalOpen, setIndianModalOpen] = useState(false);

  return (
    <div className="space-y-3 2xl:space-y-6">
      {/* Top Scientific Disclaimer Banner */}
      <DisclaimerBanner
        variant="info"
        title="3D INERTIAL GCRS VISUALIZATION — COORDINATE & ASTRODYNAMICS SPECIFICATIONS"
        disclaimer="Three.js world frame is aligned with Inertial GCRS (X_Three = X_GCRS/1000, Y_Three = Z_GCRS/1000, Z_Three = -Y_GCRS/1000). Earth's rotational axis is simplified to align with GCRS +Z with constant-rate rotation; time-dependent precession, nutation, and UT1-based Earth Rotation Angle (ERA) are not implemented. Solar illumination uses a fixed illustrative inertial direction (day/night rendering is visually representative, not epoch-accurate; no operational solar ephemeris is connected). Cloud rotation (+15% differential) is a visual approximation, not a validated atmospheric wind model. The atmospheric interface boundary is strictly highlighted at radius 6,478.137 km (100 km altitude)."
      />

      {/* Indian Space Ecosystem (ISRO / Domain 01) Status Ribbon */}
      <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-xs font-mono flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-panel">
        <div className="flex items-center gap-2.5 text-emerald-300">
          <Globe className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>
            <strong>INDIAN SPACE ASSETS (DOMAIN 01):</strong> Integration-ready for CelesTrak <code className="text-cyan">isro</code> & <code className="text-cyan">navic</code> groups. Per scientific honesty rules, unverified orbits are strictly omitted from 3D visualization.
          </span>
        </div>
        <Button
          size="xs"
          variant="secondary"
          onClick={() => setIndianModalOpen(true)}
          className="text-xs font-mono text-emerald-300 border-emerald-500/40 hover:bg-emerald-900/30 shrink-0"
        >
          <span>VIEW ISRO ARCHITECTURE</span>
        </Button>
      </div>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Orbital Objects"
          value={`${CATALOG_SATELLITES.length + SYNTHETIC_DEBRIS_CLOUD.length}`}
          sublabel="520 Debris + 2 Stations (LEO Regime)"
          icon={<Orbit className="h-5 w-5 text-cyan" />}
          variant="cyan"
        />
        <MetricCard
          label="Catalog Spacecraft"
          value={`${CATALOG_SATELLITES.length}`}
          sublabel="ISS & CSS (CelesTrak Snapshot)"
          icon={<Globe className="h-5 w-5 text-status-success" />}
          variant="emerald"
        />
        <MetricCard
          label="Synthetic Debris Cloud"
          value={`${SYNTHETIC_DEBRIS_CLOUD.length}`}
          sublabel="Single GPU Draw Call (InstancedMesh)"
          icon={<Flame className="h-5 w-5 text-status-critical" />}
          variant="rose"
        />
        <MetricCard
          label="Atmospheric Interface"
          value="6,478.1 km"
          sublabel="Karman Line Boundary (100 km alt)"
          icon={<Activity className="h-5 w-5 text-status-warning" />}
          variant="amber"
        />
      </div>

      {/* Main 3D Canvas Card Viewport */}
      <Card className="p-2 sm:p-3 bg-space-bg border-space-border shadow-2xl">
        <OrbitRadarCanvas
          selectedObjectId={selectedObjectId}
          onSelectObject={onSelectObject}
          onNavigateTab={onNavigateTab}
        />
      </Card>

      <IndianSpaceModal
        isOpen={indianModalOpen}
        onClose={() => setIndianModalOpen(false)}
      />
    </div>
  );
};
