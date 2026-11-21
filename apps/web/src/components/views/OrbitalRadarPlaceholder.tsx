"use client";

import React from "react";
import { OrbitalRadarView } from "./OrbitalRadarView";

/**
 * Backward-compatibility wrapper for OrbitalRadarPlaceholder.
 * Re-exports the fully implemented OrbitalRadarView from Phase 3.
 */
export const OrbitalRadarPlaceholder: React.FC = () => {
  return <OrbitalRadarView />;
};
