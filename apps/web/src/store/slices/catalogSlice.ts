/**
 * Catalog Slice for ZORBIT Global Domain Store
 *
 * Manages indexed catalog objects and active object references.
 */

import type { StateCreator } from "zustand";
import type {
  CanonicalOrbitalObjectReference,
  CatalogUrn,
  SyntheticFragmentUrn,
} from "../../types/shared_state";
import type { ZorbitStoreState } from "../useZorbitStore";

export interface CatalogSlice {
  catalogMap: Record<string, CanonicalOrbitalObjectReference>;

  // Actions
  setCatalogObjects: (objects: CanonicalOrbitalObjectReference[]) => void;
  upsertCatalogObject: (object: CanonicalOrbitalObjectReference) => void;
  getCatalogObject: (urn: string) => CanonicalOrbitalObjectReference | undefined;
}

export const createCatalogSlice: StateCreator<
  ZorbitStoreState,
  [],
  [],
  CatalogSlice
> = (set, get) => ({
  catalogMap: {},

  setCatalogObjects: (objects: CanonicalOrbitalObjectReference[]) => {
    const map: Record<string, CanonicalOrbitalObjectReference> = {};
    for (const obj of objects) {
      map[obj.urn] = obj;
    }
    set({ catalogMap: map });
  },

  upsertCatalogObject: (object: CanonicalOrbitalObjectReference) => {
    set((state) => ({
      catalogMap: {
        ...state.catalogMap,
        [object.urn]: object,
      },
    }));
  },

  getCatalogObject: (urn: string) => {
    return get().catalogMap[urn];
  },
});

