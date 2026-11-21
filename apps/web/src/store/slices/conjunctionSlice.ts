/**
 * Conjunction Slice for ZORBIT Global Domain Store
 *
 * Manages screening events and active close-approach encounter context.
 */

import type { StateCreator } from "zustand";
import type {
  CanonicalConjunctionEventReference,
  ConjunctionEventContext,
} from "../../types/shared_state";
import type { ZorbitStoreState } from "../useZorbitStore";

export interface ConjunctionSlice {
  screeningEvents: CanonicalConjunctionEventReference[];
  activeEncounter: ConjunctionEventContext | null;

  // Actions
  setScreeningEvents: (events: CanonicalConjunctionEventReference[]) => void;
  setActiveEncounter: (encounter: ConjunctionEventContext | null) => void;
  clearScreeningEvents: () => void;
}

export const createConjunctionSlice: StateCreator<
  ZorbitStoreState,
  [],
  [],
  ConjunctionSlice
> = (set) => ({
  screeningEvents: [],
  activeEncounter: null,

  setScreeningEvents: (events: CanonicalConjunctionEventReference[]) => {
    set({ screeningEvents: events });
  },

  setActiveEncounter: (encounter: ConjunctionEventContext | null) => {
    set({ activeEncounter: encounter });
  },

  clearScreeningEvents: () => {
    set({ screeningEvents: [], activeEncounter: null });
  },
});

