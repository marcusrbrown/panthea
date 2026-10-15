// The followed place's ground: its authored 8x8 terrain grid drawn as the 9x9 lattice of tiles round it. Each tile
// is the atlas cell its corner mask and its offset in the set's period name (the shared `tileMaskAt` and
// `tileOffsetAt`; a lattice point off the grid takes the nearest grid cell), placed by the shared `composeScene` at
// its lattice point and moved to the layout's anchor. The tiles are always the lowest thing drawn.

import {
  type RegistrySnapshot,
  resolveAssetPixels,
  tileMaskAt,
  tileOffsetAt,
} from "@panthea/assets/browser";
import type { Atlas } from "@panthea/contracts";
import {
  composeScene,
  type Instance,
  type SceneEntity,
} from "@panthea/renderer";

import type { ViewLocation } from "../store";
import { GROUND_ORIGIN, GROUND_POINTS } from "./layout";

export type GroundPlan =
  | {
      readonly ok: true;
      /** Every tile, in the target's pixel space (y down), lowest first. */
      readonly instances: readonly Instance[];
      /** The one atlas every tile is cut from. */
      readonly atlas: Atlas;
    }
  | {
      readonly ok: false;
      /** Why the place's ground cannot be drawn: the set is not a published tile set, or its tiles do not compose. */
      readonly reason: string;
    };

/** The tiles of `place`'s ground; undefined for a place with no terrain, which is drawn on bare background. */
export function planGround(
  place: ViewLocation | undefined,
  snapshot: RegistrySnapshot,
): GroundPlan | undefined {
  const terrain = place?.terrain;
  if (place === undefined || terrain === undefined) return undefined;
  const { set } = terrain;

  const entry = snapshot.entries.get(set);
  if (entry === undefined || entry.manifest.kind !== "tile")
    return {
      ok: false,
      reason: `the terrain set "${set}" is ${entry === undefined ? "not published" : `published as a ${entry.manifest.kind}, not a tile set`}`,
    };
  const { period } = entry.manifest;

  const grid = terrain.rows.map((row) =>
    [...row].map((code) => (code === "f" ? 1 : 0)),
  );
  const entities: SceneEntity[] = [];
  let atlas: Atlas | undefined;
  for (const { x, y } of GROUND_POINTS) {
    const resolution = resolveAssetPixels(snapshot, {
      spriteId: set,
      tile: {
        mask: tileMaskAt(grid, x, y),
        offset: tileOffsetAt(x, y, period),
      },
    });
    if (resolution.source !== "canon")
      return {
        ok: false,
        reason: `the terrain set "${set}" has no tile for lattice point (${x}, ${y}): ${resolution.reason}`,
      };
    atlas = resolution.atlas;
    entities.push({
      kind: "tile",
      id: `ground:${x}-${y}`,
      point: { x, y },
      resolution,
    });
  }
  const composed = composeScene(entities);
  if (composed.refused.length > 0 || atlas === undefined)
    return {
      ok: false,
      reason: `the terrain set "${set}" does not compose: ${composed.refused.map((r) => `${r.id} ${r.reason}`).join(", ")}`,
    };

  // The lattice origin puts lattice point (0, 0) at the middle of the target's own origin; the layout moves it.
  return {
    ok: true,
    atlas,
    instances: composed.instances.map((instance) => ({
      ...instance,
      x: instance.x + GROUND_ORIGIN.x,
      y: instance.y - GROUND_ORIGIN.y,
    })),
  };
}
