"use client";

import React from "react";
import { CollisionIntelligenceView, CollisionIntelligenceViewProps } from "./CollisionIntelligenceView";

export type CollisionIntelligencePlaceholderProps = CollisionIntelligenceViewProps;

export const CollisionIntelligencePlaceholder: React.FC<CollisionIntelligencePlaceholderProps> = (
  props
) => {
  return <CollisionIntelligenceView {...props} />;
};

export { CollisionIntelligenceView };
