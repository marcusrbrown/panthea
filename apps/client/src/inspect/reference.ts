// The shape of the committed reference digests (the file the scenario
// generator writes and the inspection checks read) and the key that names a
// selection in it. Types and one pure function only: the generator imports
// this too, so it must not import the digests file itself.

import type { PixelRect } from "./digest";

export type SelectionQuery =
  | {
      readonly state: string;
      readonly direction: string;
      readonly ability?: string;
    }
  | { readonly expression: string };

/** `state/direction[/ability]` for a sprite, `expression:<name>` for a portrait. */
export function selectionKey(query: SelectionQuery): string {
  if ("expression" in query) return `expression:${query.expression}`;
  return query.ability === undefined
    ? `${query.state}/${query.direction}`
    : `${query.state}/${query.direction}/${query.ability}`;
}

export interface ReferenceFrame {
  readonly rect: PixelRect;
  /** The digest of this frame's pixels at each integer zoom, keyed by the zoom. */
  readonly digests: Readonly<Record<string, string>>;
}

export interface ReferenceSelection {
  readonly key: string;
  readonly query: SelectionQuery;
  readonly frames: readonly ReferenceFrame[];
}

export interface ReferenceAsset {
  readonly assetId: string;
  readonly kind: "sprite" | "portrait";
  /** The atlas blob the frames were taken from, as the committed registry names it. */
  readonly atlas: {
    readonly blob: string;
    readonly width: number;
    readonly height: number;
  };
  readonly selections: readonly ReferenceSelection[];
}

export interface Reference {
  readonly schemaVersion: 1;
  readonly algorithm: string;
  /** What alpha-0 pixels show: the target's clear colour. */
  readonly background: readonly number[];
  readonly zooms: readonly number[];
  readonly assets: readonly ReferenceAsset[];
}
