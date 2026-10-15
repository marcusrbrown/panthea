// Actors as sprites. Each actor resolves, by the sprite id the world set for
// it, to canon idle-south or to the shared placeholder pixels, and becomes a
// layer instance positioned by its foot. There is no state selection here:
// normal play shows idle, whatever happens in the world. Seated, act and
// portrait expressions belong to the packaged inspection fixture. The same
// instance builder lays out structures and effects (./structures, ./scene).
//
// This stays out of `composeScene`: that places iso tile cells, and the
// client keeps its own place layout. It builds the same `Instance` shape,
// with the depth key from the shared core, so the layer draws it unchanged.

import {
  type CanonResolution,
  EMPTY_SNAPSHOT,
  type PixelResolution,
  type RegistrySnapshot,
  resolveAssetPixels,
} from "@panthea/assets/browser";
import {
  depthZ,
  ENTITY_SLOTS,
  type Instance,
  type InstanceArt,
  type Layer,
} from "@panthea/renderer";

import type { ViewActor, ViewLocation } from "../store";
import { actorFoot, PLACE_ORIGIN, type WorldPoint } from "./layout";

/** Normal play shows idle facing south. */
export const ACTOR_QUERY = { state: "idle", direction: "south" } as const;

export type ActorArt =
  | { readonly source: "canon"; readonly resolution: CanonResolution }
  | Extract<PixelResolution, { source: "placeholder" }>;

/** What the layer draws: a foot, the art that stands on it, and the point whose screen row sorts it. */
export interface SpriteItem {
  /** The layer instance id. */
  readonly id: string;
  /** The foot, in world space (y up): where the art's pivot sits. */
  readonly foot: WorldPoint;
  /** Where the depth key is read from, when that is not the foot: a fire sorts by the building it burns on. */
  readonly depthFoot?: WorldPoint;
  readonly art: ActorArt;
}

export interface ActorItem extends SpriteItem {
  readonly actor: ViewActor;
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

export function planActors(
  place: ViewLocation | undefined,
  snapshot: RegistrySnapshot,
): ActorItem[] {
  return (place?.actors ?? []).map((actor, index) => ({
    id: `actor:${actor.id}`,
    actor,
    foot: actorFoot(PLACE_ORIGIN, index),
    art: resolveActor(snapshot, actor.sprite),
  }));
}

/** Screen rows per depth step: coarse enough that the ring's rows stay inside the depth key's range. */
const DEPTH_ROW = 4;
const DEPTH_LIMIT = 130;

const byCodePoint = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

function artOf(item: SpriteItem): {
  art: InstanceArt;
  w: number;
  h: number;
  pivot: WorldPoint;
} {
  if (item.art.source === "placeholder") {
    const { width, height } = item.art.pixels;
    return {
      art: {
        source: "placeholder",
        reason: item.art.reason,
        placeholder: { width, height },
      },
      w: width,
      h: height,
      pivot: { x: Math.floor(width / 2), y: height },
    };
  }
  const { resolution } = item.art;
  return {
    art: {
      source: "canon",
      assetId: resolution.assetId,
      revision: resolution.revision,
      uri: resolution.uri,
      atlas: resolution.atlas,
      frames: resolution.frames,
      ...(resolution.loopStart === undefined
        ? {}
        : { loopStart: resolution.loopStart }),
    },
    w: resolution.cell.w,
    h: resolution.cell.h,
    pivot: resolution.pivot ?? {
      x: Math.floor(resolution.cell.w / 2),
      y: resolution.cell.h,
    },
  };
}

export interface ActorInstances {
  /** Back to front. */
  readonly instances: readonly Instance[];
  /** Items with no depth slot left; they are not drawn. */
  readonly dropped: readonly string[];
}

/**
 * Layer instances for `items` on `layer`. The depth key is the screen row of
 * the item's foot (or its depth foot), so one lower on the screen draws in
 * front; at one depth the layers order structures behind actors behind
 * effects, and items on one layer at one depth are ordered by id, so the
 * result does not depend on the order they are given in.
 */
export function spriteInstances(
  items: readonly SpriteItem[],
  layer: Layer,
): ActorInstances {
  const groups = new Map<number, SpriteItem[]>();
  for (const item of items) {
    const row = (item.depthFoot ?? item.foot).y;
    const depth =
      Math.max(
        -DEPTH_LIMIT,
        Math.min(DEPTH_LIMIT, Math.round(-row / DEPTH_ROW)),
      ) + 0;
    const group = groups.get(depth);
    if (group === undefined) groups.set(depth, [item]);
    else group.push(item);
  }

  const instances: Instance[] = [];
  const dropped: string[] = [];
  for (const [depth, group] of groups) {
    group.sort((a, b) => byCodePoint(a.id, b.id));
    for (const [order, item] of group.entries()) {
      const z =
        order < ENTITY_SLOTS ? depthZ({ depth, layer, order }) : undefined;
      if (z === undefined || !z.ok) {
        dropped.push(item.id);
        continue;
      }
      const { art, w, h, pivot } = artOf(item);
      instances.push({
        id: item.id,
        layer,
        cell: { x: 0, y: 0, z: 0 },
        footprint: { w: 1, h: 1 },
        x: item.foot.x - pivot.x,
        y: -item.foot.y - pivot.y,
        w,
        h,
        depth,
        z: z.value,
        art,
      });
    }
  }
  instances.sort((a, b) => a.z - b.z);
  return { instances, dropped };
}

/** Layer instances for the actors: `spriteInstances` on the actor layer. */
export function actorInstances(items: readonly ActorItem[]): ActorInstances {
  return spriteInstances(items, "actor");
}
