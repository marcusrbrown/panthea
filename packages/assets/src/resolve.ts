// Pure lookup: a registry snapshot plus a request resolves to canon frames or
// a deterministic placeholder. No filesystem here; the snapshot is built by
// the registry subpath.

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
import {
  type PlaceholderAsset,
  type PlaceholderInput,
  renderPlaceholder,
} from "./placeholder";

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

export type Resolution =
  | {
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
  | {
      readonly source: "placeholder";
      readonly reason: "missing-id" | "missing-state" | "wrong-kind";
      readonly uri: string;
      readonly placeholder: PlaceholderAsset;
    };

export const DEFAULT_PLACEHOLDER: PlaceholderInput = { palette: [], parts: {} };

export function resolveAsset(
  snapshot: RegistrySnapshot,
  query: ResolveQuery,
  placeholder: PlaceholderInput = DEFAULT_PLACEHOLDER,
): Resolution {
  const fallback = (
    reason: "missing-id" | "missing-state" | "wrong-kind",
  ): Resolution => {
    const asset = renderPlaceholder(placeholder);
    return {
      source: "placeholder",
      reason,
      uri: asset.uri,
      placeholder: asset,
    };
  };
  const entry = snapshot.entries.get(query.spriteId);
  if (entry === undefined) return fallback("missing-id");
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
    if (manifest.kind !== "portrait") return fallback("wrong-kind");
    const found = manifest.expressions.find(
      (e) => e.expression === query.expression,
    );
    if (found === undefined) return fallback("missing-state");
    return { ...canon, kind: "portrait", frames: [found.frame] };
  }
  if (manifest.kind !== "sprite") return fallback("wrong-kind");
  const state = query.state ?? "idle";
  const direction = query.direction ?? "south";
  const animation = manifest.animations.find(
    (a) =>
      a.state === state &&
      a.direction === direction &&
      a.ability === query.ability,
  );
  if (animation === undefined) return fallback("missing-state");
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
