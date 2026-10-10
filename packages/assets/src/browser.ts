// Browser-safe subpath (`@panthea/assets/browser`): the same canon lookup and
// the same placeholder pixels as the Node resolver, with no `node:` module in
// its import graph. Its placeholder variant is pixel-only: no logical URI and
// no PNG bytes. The Node root keeps `uri` and `bytes`.
//
// Keep this file and everything it imports free of platform modules;
// browser-bundle.test.ts bundles it for a browser target and fails otherwise.

import {
  type PlaceholderInput,
  type PlaceholderPixels,
  renderPlaceholderPixels,
} from "./placeholder-pixels";
import {
  type CanonResolution,
  DEFAULT_PLACEHOLDER,
  lookupCanon,
  type PlaceholderReason,
  type RegistrySnapshot,
  type ResolveQuery,
} from "./resolve-core";

export {
  type PlaceholderInput,
  type PlaceholderParts,
  type PlaceholderPixels,
  renderPlaceholderPixels,
} from "./placeholder-pixels";
export {
  type CanonResolution,
  DEFAULT_PLACEHOLDER,
  EMPTY_SNAPSHOT,
  type PlaceholderReason,
  type RegistrySnapshot,
  type ResolveQuery,
  type SnapshotEntry,
} from "./resolve-core";

export type PixelResolution =
  | CanonResolution
  | {
      readonly source: "placeholder";
      readonly reason: PlaceholderReason;
      readonly pixels: PlaceholderPixels;
    };

export function resolveAssetPixels(
  snapshot: RegistrySnapshot,
  query: ResolveQuery,
  placeholder: PlaceholderInput = DEFAULT_PLACEHOLDER,
): PixelResolution {
  const found = lookupCanon(snapshot, query);
  if (found.source === "canon") return found;
  return {
    source: "placeholder",
    reason: found.reason,
    pixels: renderPlaceholderPixels(placeholder),
  };
}
