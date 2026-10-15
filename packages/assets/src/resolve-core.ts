// The one canon lookup, shared by the Node resolver (./resolve) and the
// browser-safe one (./browser). It decides canon-or-miss and nothing else;
// each caller turns a miss into its own placeholder shape. No platform
// imports: the browser bundle check walks this file.

import {
  type AssetId,
  type AssetManifest,
  type Atlas,
  assetUri,
  type Footprint,
  type Frame,
  type Point,
  type Sha256,
  TILE_MASKS,
  tileAtlasRect,
} from "@panthea/contracts";
import type { PlaceholderInput } from "./placeholder-pixels";

export interface SnapshotEntry {
  readonly assetId: AssetId;
  readonly revision: Sha256;
  readonly manifest: AssetManifest;
}

export interface RegistrySnapshot {
  readonly entries: ReadonlyMap<string, SnapshotEntry>;
}

export const EMPTY_SNAPSHOT: RegistrySnapshot = { entries: new Map() };

export interface ResolveQuery {
  /** Stable sprite id, e.g. a god's `sprite`. */
  readonly spriteId: string;
  /** Defaults to idle. */
  readonly state?: string;
  /** Defaults to south. */
  readonly direction?: string;
  readonly ability?: string;
  /** When set, the id must resolve to a portrait. */
  readonly expression?: string;
  /** When set, the id must resolve to an effect, and this is the animation of it. */
  readonly animation?: string;
  /** When set, the id must resolve to a tile set, and this is the cell of it: the corner mask and the offset in the period. */
  readonly tile?: { readonly mask: number; readonly offset: number };
}

export type PlaceholderReason = "missing-id" | "missing-state" | "wrong-kind";

export interface CanonResolution {
  readonly source: "canon";
  readonly kind: "sprite" | "portrait" | "effect" | "tile";
  readonly assetId: AssetId;
  readonly revision: Sha256;
  readonly uri: string;
  readonly atlas: Atlas;
  readonly cell: { readonly w: number; readonly h: number };
  readonly frames: readonly Frame[];
  readonly loopStart?: number;
  readonly pivot?: Point;
  readonly footprint?: Footprint;
}

export type CanonLookup =
  | CanonResolution
  | { readonly source: "miss"; readonly reason: PlaceholderReason };

/** How long a tile's one still frame is shown; a tile does not animate. */
const TILE_FRAME_MS = 1000;

export const DEFAULT_PLACEHOLDER: PlaceholderInput = { palette: [], parts: {} };

export function lookupCanon(
  snapshot: RegistrySnapshot,
  query: ResolveQuery,
): CanonLookup {
  const miss = (reason: PlaceholderReason): CanonLookup => ({
    source: "miss",
    reason,
  });
  const entry = snapshot.entries.get(query.spriteId);
  if (entry === undefined) return miss("missing-id");
  const { manifest } = entry;
  const canon = {
    source: "canon" as const,
    assetId: entry.assetId,
    revision: entry.revision,
    uri: assetUri(entry.assetId),
    atlas: manifest.atlas,
    cell: manifest.cell,
  };

  if (query.expression !== undefined) {
    if (manifest.kind !== "portrait") return miss("wrong-kind");
    const found = manifest.expressions.find(
      (e) => e.expression === query.expression,
    );
    if (found === undefined) return miss("missing-state");
    return { ...canon, kind: "portrait", frames: [found.frame] };
  }
  if (query.tile !== undefined) {
    if (manifest.kind !== "tile") return miss("wrong-kind");
    const { mask, offset } = query.tile;
    if (
      !Number.isInteger(mask) ||
      mask < 0 ||
      mask >= TILE_MASKS ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset >= manifest.period * manifest.period
    )
      return miss("missing-state");
    return {
      ...canon,
      kind: "tile",
      frames: [
        {
          rect: tileAtlasRect(mask, offset, manifest.period),
          durationMs: TILE_FRAME_MS,
        },
      ],
    };
  }
  if (query.animation !== undefined) {
    if (manifest.kind !== "effect") return miss("wrong-kind");
    const found = manifest.animations.find((a) => a.name === query.animation);
    if (found === undefined) return miss("missing-state");
    return {
      ...canon,
      kind: "effect",
      frames: found.frames,
      ...(found.loopStart === undefined ? {} : { loopStart: found.loopStart }),
      pivot: manifest.pivot,
      footprint: manifest.footprint,
    };
  }
  if (manifest.kind !== "sprite") return miss("wrong-kind");
  const state = query.state ?? "idle";
  const direction = query.direction ?? "south";
  const animation = manifest.animations.find(
    (a) =>
      a.state === state &&
      a.direction === direction &&
      a.ability === query.ability,
  );
  if (animation === undefined) return miss("missing-state");
  return {
    ...canon,
    kind: "sprite",
    frames: animation.frames,
    ...(animation.loopStart === undefined
      ? {}
      : { loopStart: animation.loopStart }),
    pivot: manifest.pivot,
    footprint: manifest.footprint,
  };
}
