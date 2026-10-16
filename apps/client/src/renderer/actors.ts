// Actors as sprites. Each actor resolves, by the sprite id the world set for
// it, to canon idle-south or to the shared placeholder pixels, and stands on
// its own grid cell (./layout, ACTOR_CELLS); `composeScene` places it by the
// shared projection and depth key. There is no state selection here: normal
// play shows idle, whatever happens in the world. Seated, act and portrait
// expressions belong to the packaged inspection fixture. Structures and effects
// are items of the same shape (./structures, ./scene).

import {
  type CanonResolution,
  EMPTY_SNAPSHOT,
  type PixelResolution,
  type RegistrySnapshot,
  resolveAssetPixels,
} from "@panthea/assets/browser";
import type { SceneEntity, SceneResolution } from "@panthea/renderer";

import type { ViewActor, ViewLocation } from "../store";
import { actorCell, type GridCell } from "./layout";

/** Normal play shows idle facing south. */
export const ACTOR_QUERY = { state: "idle", direction: "south" } as const;

export type ActorArt =
  | { readonly source: "canon"; readonly resolution: CanonResolution }
  | Extract<PixelResolution, { source: "placeholder" }>;

/** What the scene draws: an id, and the art that stands on its cell. */
export interface SpriteItem {
  /** The scene entity id. */
  readonly id: string;
  readonly art: ActorArt;
}

export interface ActorItem extends SpriteItem {
  readonly actor: ViewActor;
  /** The cell the actor stands on. */
  readonly cell: GridCell;
}

/** The `uri` the placeholder carries in a scene: it names no published asset. */
const PLACEHOLDER_URI = "placeholder:default";

/** The art as the shared scene takes it: canon as resolved, the placeholder by its size. */
export function sceneResolutionOf(art: ActorArt): SceneResolution {
  if (art.source === "canon") return art.resolution;
  return {
    source: "placeholder",
    reason: art.reason,
    uri: PLACEHOLDER_URI,
    placeholder: { width: art.pixels.width, height: art.pixels.height },
  };
}

export function resolveActor(
  snapshot: RegistrySnapshot,
  sprite: string,
): ActorArt {
  const resolved = resolveAssetPixels(snapshot, {
    spriteId: sprite,
    ...ACTOR_QUERY,
  });
  return resolved.source === "canon"
    ? { source: "canon", resolution: resolved }
    : resolved;
}

/** The placeholder for an actor whose canon art cannot be drawn: nothing is published for it, as far as the scene can tell. */
export function fallbackActor(
  sprite: string,
): Extract<ActorArt, { source: "placeholder" }> {
  const art = resolveActor(EMPTY_SNAPSHOT, sprite);
  if (art.source !== "placeholder") {
    throw new Error("an empty snapshot resolved to canon art");
  }
  return art;
}

/** The actors of `place` that have a cell, by index; one past the table is not drawn. */
export function planActors(
  place: ViewLocation | undefined,
  snapshot: RegistrySnapshot,
): ActorItem[] {
  return (place?.actors ?? []).flatMap((actor, index) => {
    const cell = actorCell(index);
    if (cell === undefined) return [];
    return [
      {
        id: `actor:${actor.id}`,
        actor,
        cell,
        art: resolveActor(snapshot, actor.sprite),
      },
    ];
  });
}

/** The actor as a scene entity: a sprite on the actor layer, one cell, standing on its cell's bottom vertex. */
export function actorEntity(item: ActorItem): SceneEntity {
  return {
    kind: "sprite",
    id: item.id,
    layer: "actor",
    cell: { ...item.cell, z: 0 },
    resolution: sceneResolutionOf(item.art),
  };
}
