// The harness scene as data: a ground patch, the subject at a fixed tile, a
// seated companion that shows the placeholder fallback, a placeholder mortal
// for scale, a placeholder 2x2 structure two depth steps behind the subject on its column, so the subject covers part of it, and a flat
// portrait panel. Coordinates assume HARNESS_CAMERA.

import type { Point } from "../renderer/iso";
import type { PreviewItem } from "../renderer/preview";
import type { Selection } from "../source/port";

/** Top-left of the 480x270 viewport in screen space. */
export const HARNESS_CAMERA: Point = { x: -240, y: -80 };

/** Screen position of the portrait panel, right of the ground patch. */
export const PORTRAIT_PANEL_AT: Point = { x: 138, y: -70 };

/** An id no source holds, so every source answers with its placeholder. */
export const MISSING_SPRITE: Selection = {
  source: "canon",
  id: "missing-placeholder",
};

const PATCH = 4;

/**
 * Which of the subject and the placeholder structure draws in front where
 * they overlap. A sprite's screen y is 16 x depth + 31, so a 16 px structure
 * can only overlap the taller subject behind it or at its own depth, where
 * the layer decides: "subject-front" puts the structure two depth steps
 * behind, "structure-front" shares the subject's bottom cell and swaps their
 * layers.
 */
export type OcclusionPair = "subject-front" | "structure-front";

export interface HarnessSelection {
  readonly subject: Selection | undefined;
  readonly portrait: Selection | undefined;
  readonly state: string;
  readonly direction: string;
  readonly expression: string;
  readonly companion: boolean;
  readonly occlusion?: OcclusionPair;
}

export function harnessItems(selection: HarnessSelection): PreviewItem[] {
  const items: PreviewItem[] = [];
  for (let x = 0; x < PATCH; x += 1) {
    for (let y = 0; y < PATCH; y += 1) {
      items.push({
        kind: "diamond",
        id: `ground-${x}-${y}`,
        cell: { x, y, z: 0 },
      });
    }
  }
  const subject = selection.subject ?? MISSING_SPRITE;
  const structureFront = selection.occlusion === "structure-front";
  items.push({
    kind: "sprite",
    id: "structure",
    layer: structureFront ? "actor" : "structure",
    cell: structureFront ? { x: 1, y: 1, z: 0 } : { x: 0, y: 0, z: 0 },
    footprint: { w: 2, h: 2 },
    request: MISSING_SPRITE,
  });
  items.push({
    kind: "sprite",
    id: "mortal",
    layer: "actor",
    cell: { x: 0, y: 2, z: 0 },
    request: MISSING_SPRITE,
  });
  items.push({
    kind: "sprite",
    id: "subject",
    layer: structureFront ? "structure" : "actor",
    cell: { x: 2, y: 2, z: 0 },
    request: {
      ...subject,
      state: selection.state,
      direction: selection.direction,
    },
  });
  if (selection.companion) {
    items.push({
      kind: "sprite",
      id: "seated",
      layer: "actor",
      cell: { x: 3, y: 1, z: 0 },
      request: { ...subject, state: "seated", direction: "south" },
    });
  }
  if (selection.portrait !== undefined) {
    items.push({
      kind: "flat",
      id: "portrait",
      at: PORTRAIT_PANEL_AT,
      request: { ...selection.portrait, expression: selection.expression },
    });
  }
  return items;
}
