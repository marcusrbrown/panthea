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
}

export type PlaceholderReason = "missing-id" | "missing-state" | "wrong-kind";

export interface CanonResolution {
  readonly source: "canon";
  readonly kind: "sprite" | "portrait";
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
