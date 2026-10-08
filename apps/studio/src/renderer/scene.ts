// Scene composition: resolver results and tile coordinates in, drawable
// instances out. Pure. It takes the output of `resolveAsset` rather than
// calling it, so no node-only code from @panthea/assets reaches the browser
// bundle: everything imported from there is a type.

import type { Resolution } from "@panthea/assets";
import {
  type Cell,
  depthOf,
  depthZ,
  diamondOrigin,
  ENTITY_SLOTS,
  type Footprint,
  type Layer,
  type Point,
  type RefusalReason,
  spriteOrigin,
  TILE_H,
  TILE_W,
} from "./iso";

type Canon = Extract<Resolution, { source: "canon" }>;
type Placeholder = Extract<Resolution, { source: "placeholder" }>;

/** What placement needs of a placeholder; the resolver's PlaceholderAsset satisfies it. */
export interface PlaceholderSize {
  readonly width: number;
  readonly height: number;
}

/** A resolver result, or the same shape rebuilt from what the bridge sends. */
export type SceneResolution =
  | Canon
  | {
      readonly source: "placeholder";
      readonly reason: Placeholder["reason"];
      readonly uri: string;
      readonly placeholder: PlaceholderSize;
    };

export type SceneEntity =
  | {
      readonly kind: "diamond";
      readonly id: string;
      readonly cell: Cell;
    }
  | {
      readonly kind: "sprite";
      readonly id: string;
      readonly layer: Layer;
      /** The footprint's origin cell: its smallest x and y. */
      readonly cell: Cell;
      readonly resolution: SceneResolution;
    };

export type InstanceArt =
  | {
      readonly source: "canon";
      readonly assetId: Canon["assetId"];
      readonly revision: Canon["revision"];
      readonly uri: string;
      readonly atlas: Canon["atlas"];
      readonly frames: Canon["frames"];
      readonly loopStart?: number;
    }
  | {
      readonly source: "placeholder";
      readonly reason: Placeholder["reason"];
      readonly uri: string;
      readonly placeholder: PlaceholderSize;
    }
  | { readonly source: "diamond" };

export interface Instance {
  readonly id: string;
  readonly layer: Layer;
  readonly cell: Cell;
  readonly footprint: Footprint;
  /** Top-left in logical screen pixels, y down, relative to the scene origin. */
  readonly x: number;
  readonly y: number;
  /** Drawn size in logical pixels: the cell for canon art, the PNG for a placeholder. */
  readonly w: number;
  readonly h: number;
  /** `x + y - z` of the footprint's bottom-vertex cell. */
  readonly depth: number;
  /** The depth key as a sprite z; a larger z draws in front. */
  readonly z: number;
  readonly art: InstanceArt;
}

export type SceneRefusalReason =
  | RefusalReason
  | "duplicate-id"
  | "not-placeable"
  | "too-many-at-depth";

export interface SceneRefusal {
  readonly id: string;
  readonly reason: SceneRefusalReason;
  readonly detail: string;
}

export interface Composition {
  /** Back to front: ascending z, which is unique per instance. */
  readonly instances: readonly Instance[];
  readonly refused: readonly SceneRefusal[];
}

const SINGLE_TILE: Footprint = { w: 1, h: 1 };

interface Placed {
  readonly id: string;
  readonly layer: Layer;
  readonly cell: Cell;
  readonly footprint: Footprint;
  readonly origin: Point;
  readonly w: number;
  readonly h: number;
  readonly depth: number;
  readonly art: InstanceArt;
}

type Attempt =
  | { readonly ok: true; readonly placed: Placed }
  | { readonly ok: false; readonly refusal: SceneRefusal };

function place(entity: SceneEntity): Attempt {
  const refuse = (reason: SceneRefusalReason, detail: string): Attempt => ({
    ok: false,
    refusal: { id: entity.id, reason, detail },
  });

  if (entity.kind === "diamond") {
    const origin = diamondOrigin(entity.cell);
    if (!origin.ok) return refuse(origin.reason, origin.detail);
    const depth = depthOf(entity.cell, SINGLE_TILE);
    if (!depth.ok) return refuse(depth.reason, depth.detail);
    return {
      ok: true,
      placed: {
        id: entity.id,
        layer: "ground",
        cell: entity.cell,
        footprint: SINGLE_TILE,
        origin: origin.value,
        w: TILE_W,
        h: TILE_H,
        depth: depth.value,
        art: { source: "diamond" },
      },
    };
  }

  const { resolution } = entity;
  let footprint: Footprint;
  let pivot: Point;
  let w: number;
  let h: number;
  let art: InstanceArt;
  if (resolution.source === "placeholder") {
    const { placeholder } = resolution;
    footprint = SINGLE_TILE;
    w = placeholder.width;
    h = placeholder.height;
    pivot = { x: Math.floor(w / 2), y: h };
    art = {
      source: "placeholder",
      reason: resolution.reason,
      uri: resolution.uri,
      placeholder,
    };
  } else {
    if (
      resolution.kind !== "sprite" ||
      resolution.pivot === undefined ||
      resolution.footprint === undefined
    ) {
      return refuse(
        "not-placeable",
        `${resolution.assetId} is a ${resolution.kind} without a pivot and footprint; it previews flat, outside the scene`,
      );
    }
    footprint = resolution.footprint;
    pivot = resolution.pivot;
    w = resolution.cell.w;
    h = resolution.cell.h;
    art = {
      source: "canon",
      assetId: resolution.assetId,
      revision: resolution.revision,
      uri: resolution.uri,
      atlas: resolution.atlas,
      frames: resolution.frames,
      ...(resolution.loopStart === undefined
        ? {}
        : { loopStart: resolution.loopStart }),
    };
  }

  const origin = spriteOrigin(entity.cell, footprint, pivot);
  if (!origin.ok) return refuse(origin.reason, origin.detail);
  const depth = depthOf(entity.cell, footprint);
  if (!depth.ok) return refuse(depth.reason, depth.detail);
  return {
    ok: true,
    placed: {
      id: entity.id,
      layer: entity.layer,
      cell: entity.cell,
      footprint,
      origin: origin.value,
      w,
      h,
      depth: depth.value,
      art,
    },
  };
}

const byCodePoint = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * Places every entity, then orders ties within a (depth, layer) group by
 * entity id so the result does not depend on input order. An entity that
 * cannot be placed is reported in `refused` and the rest still compose.
 */
export function composeScene(entities: readonly SceneEntity[]): Composition {
  const refused: SceneRefusal[] = [];
  const seen = new Set<string>();
  const groups = new Map<string, Placed[]>();

  for (const entity of entities) {
    if (seen.has(entity.id)) {
      refused.push({
        id: entity.id,
        reason: "duplicate-id",
        detail: `entity id "${entity.id}" is already in the scene`,
      });
      continue;
    }
    seen.add(entity.id);
    const attempt = place(entity);
    if (!attempt.ok) {
      refused.push(attempt.refusal);
      continue;
    }
    const key = `${attempt.placed.depth}|${attempt.placed.layer}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [attempt.placed]);
    else group.push(attempt.placed);
  }

  const instances: Instance[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => byCodePoint(a.id, b.id));
    for (const [order, placed] of group.entries()) {
      if (order >= ENTITY_SLOTS) {
        refused.push({
          id: placed.id,
          reason: "too-many-at-depth",
          detail: `more than ${ENTITY_SLOTS} entities on layer ${placed.layer} at depth ${placed.depth}`,
        });
        continue;
      }
      const z = depthZ({ depth: placed.depth, layer: placed.layer, order });
      if (!z.ok) {
        refused.push({ id: placed.id, reason: z.reason, detail: z.detail });
        continue;
      }
      instances.push({
        id: placed.id,
        layer: placed.layer,
        cell: placed.cell,
        footprint: placed.footprint,
        x: placed.origin.x,
        y: placed.origin.y,
        w: placed.w,
        h: placed.h,
        depth: placed.depth,
        z: z.value,
        art: placed.art,
      });
    }
  }
  instances.sort((a, b) => a.z - b.z);
  return { instances, refused };
}
