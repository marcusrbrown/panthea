// The followed place's ground: its authored 8x8 terrain grid drawn as the 9x9 lattice of tiles round it. Each tile
// is the atlas cell its corner mask and its offset in the set's period name (the shared `tileMaskAt` and
// `tileOffsetAt`; a lattice point off the grid takes the nearest grid cell), a scene entity at its lattice point.
// `composeScene` places them (./world) at the depth that is always the lowest drawn.

import {
  type RegistrySnapshot,
  resolveAssetPixels,
  tileMaskAt,
  tileOffsetAt,
} from "@panthea/assets/browser";
import type { Atlas } from "@panthea/contracts";
import type { SceneEntity } from "@panthea/renderer";

import type { ViewLocation } from "../store";
import { GROUND_POINTS } from "./layout";

export type GroundPlan =
  | {
      readonly ok: true;
      /** One entity per lattice point, row by row. */
      readonly entities: readonly SceneEntity[];
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
  if (atlas === undefined)
    return { ok: false, reason: `the terrain set "${set}" draws no tiles` };
  return { ok: true, atlas, entities };
}
