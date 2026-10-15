// What the game and the studio preview agree on for structures, fire and the
// strike: which published asset draws what, which animation the effects
// setting selects, where fire and the bolt sit on each structure, and when a
// one-shot effect is over. Presentation only: nothing here reads or changes
// the world.

import type { Point } from "./iso";

/** A structure is one of two published pieces of art: the Old Oak's tree, or the Greek building every other building draws. */
export const STRUCTURE_ASSETS = {
  tree: "oak-tree",
  building: "greek-house",
} as const;
export type StructureArt = keyof typeof STRUCTURE_ASSETS;

/** The states a structure publishes, all facing south. */
export const STRUCTURE_STATES = ["intact", "damaged", "ruin"] as const;
export type StructureState = (typeof STRUCTURE_STATES)[number];

/** The fire loop: one looping animation, drawn over a damaged structure. */
export const FIRE_ASSET = "fire";
export const FIRE_ANIMATION = "burn";

/** The lightning strike: a full and a calm animation of one effect asset. */
export const STRIKE_ASSET = "lightning-strike";

/** The player's effects setting: the full strike, or the calm one. */
export const EFFECTS_MODES = ["full", "calm"] as const;
export type EffectsMode = (typeof EFFECTS_MODES)[number];

/** The strike animation a setting selects: the animation is named for the mode. */
export function strikeAnimation(mode: EffectsMode): EffectsMode {
  return mode;
}

export interface StructureAnchors {
  /** Where the fire's pivot (the bottom centre of its flame) sits, as an offset from the structure's foot, y down. */
  readonly fire: Point;
  /** Where the bolt's pivot (its impact) sits, as an offset from the structure's foot, y down. */
  readonly strike: Point;
}

/**
 * Measured on the published cells: the strike lands on the centroid of the
 * roof (the building) or the canopy (the tree), and the fire stands on the
 * lower part of the same band, where the damaged state shows its burn. The
 * building's foot is its manifest pivot (96, 136) on a 192x192 cell, the
 * tree's (96, 164).
 */
export const STRUCTURE_ANCHORS: Readonly<
  Record<StructureArt, StructureAnchors>
> = {
  building: { fire: { x: -2, y: -57 }, strike: { x: -6, y: -75 } },
  tree: { fire: { x: -4, y: -79 }, strike: { x: -4, y: -101 } },
};

/**
 * The index of the frame a one-shot animation shows `elapsedMs` after it
 * started, or `undefined` once every frame has had its time: unlike
 * `frameIndexAt` it never loops. A clock that has not started (negative or not
 * a number) shows the first frame that has a duration; a frame with no
 * duration is never shown.
 */
export function oneShotFrameAt(
  durations: readonly number[],
  elapsedMs: number,
): number | undefined {
  const time = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  let remaining = time;
  for (const [index, duration] of durations.entries()) {
    remaining -= Math.max(0, duration);
    if (remaining < 0) return index;
  }
  return undefined;
}
