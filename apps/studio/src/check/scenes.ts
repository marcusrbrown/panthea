// Known scenes for the in-page checks. They draw on the bare background so
// the expected image can be computed exactly from the decoded atlases.

import { MISSING_SPRITE, PORTRAIT_PANEL_AT } from "../harness/layout";
import type { PreviewItem } from "../renderer/preview";
import type { Selection } from "../source/port";

export const FRAME_SUBJECT_ID = "frame-subject";
export const FRAME_PORTRAIT_ID = "frame-portrait";

/** A portrait panel and a sprite that do not overlap. */
export function frameScene(
  sprite: Selection,
  portrait: Selection,
): PreviewItem[] {
  return [
    {
      kind: "sprite",
      id: FRAME_SUBJECT_ID,
      layer: "actor",
      cell: { x: 2, y: 2, z: 0 },
      request: { ...sprite, state: "idle", direction: "south" },
    },
    {
      kind: "flat",
      id: FRAME_PORTRAIT_ID,
      at: PORTRAIT_PANEL_AT,
      request: { ...portrait, expression: "neutral" },
    },
  ];
}

export interface OcclusionCase {
  readonly name: string;
  readonly items: PreviewItem[];
  /** Id of the item that must show where the two overlap. */
  readonly front: string;
  readonly back: string;
}

/**
 * The tall sprite (its own texture) against a 2x2 placeholder structure (a
 * second texture). A sprite's screen y is 16 x depth + 31, so a 16 px
 * placeholder can only overlap a taller sprite that is in front of it, or one
 * at the same depth; the cases cover both.
 */
export function occlusionCases(sprite: Selection): OcclusionCase[] {
  const tall = (layer: "actor" | "structure"): PreviewItem => ({
    kind: "sprite",
    id: "tall",
    layer,
    cell: { x: 2, y: 2, z: 0 },
    request: { ...sprite, state: "idle", direction: "south" },
  });
  const hall = (
    layer: "actor" | "structure",
    origin: { x: number; y: number },
  ): PreviewItem => ({
    kind: "sprite",
    id: "hall",
    layer,
    cell: { x: origin.x, y: origin.y, z: 0 },
    footprint: { w: 2, h: 2 },
    request: MISSING_SPRITE,
  });
  return [
    {
      name: "behind by depth",
      items: [tall("actor"), hall("structure", { x: 0, y: 0 })],
      front: "tall",
      back: "hall",
    },
    {
      name: "same depth, structure before actor",
      items: [tall("actor"), hall("structure", { x: 1, y: 1 })],
      front: "tall",
      back: "hall",
    },
    {
      name: "same depth, layers swapped",
      items: [tall("structure"), hall("actor", { x: 1, y: 1 })],
      front: "hall",
      back: "tall",
    },
  ];
}
