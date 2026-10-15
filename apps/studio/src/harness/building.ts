// The states the studio lets the owner set a structure to, and the published
// art each draws.

import type { StructureState } from "@panthea/renderer";

/** What the owner can set the building to. Burning is the damaged art with the fire loop over it. */
export const BUILDING_STATES = [
  "intact",
  "damaged",
  "burning",
  "ruin",
] as const;
export type BuildingState = (typeof BUILDING_STATES)[number];

export interface StructureLook {
  /** The published state the structure draws. */
  readonly state: StructureState;
  /** The fire loop is drawn over it. */
  readonly fire: boolean;
}

/** Exhaustive: a new building state is a compile error here. */
export function lookOf(state: BuildingState): StructureLook {
  switch (state) {
    case "intact":
      return { state: "intact", fire: false };
    case "damaged":
      return { state: "damaged", fire: false };
    case "burning":
      return { state: "damaged", fire: true };
    case "ruin":
      return { state: "ruin", fire: false };
  }
}
