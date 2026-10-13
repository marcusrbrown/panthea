// Pure lookup: a registry snapshot plus a request resolves to canon frames or
// a deterministic placeholder. No filesystem here; the snapshot is built by
// the registry subpath. The canon lookup itself is ./resolve-core, shared with
// the browser-safe resolver; this one adds the placeholder PNG and its URI.

import type { PlaceholderAsset } from "./placeholder";
import { renderPlaceholder } from "./placeholder";
import type { PlaceholderInput } from "./placeholder-pixels";
import {
  type CanonResolution,
  DEFAULT_PLACEHOLDER,
  lookupCanon,
  type PlaceholderReason,
  type RegistrySnapshot,
  type ResolveQuery,
} from "./resolve-core";

export {
  DEFAULT_PLACEHOLDER,
  EMPTY_SNAPSHOT,
  type RegistrySnapshot,
  type ResolveQuery,
  type SnapshotEntry,
} from "./resolve-core";

export type Resolution =
  | CanonResolution
  | {
      readonly source: "placeholder";
      readonly reason: PlaceholderReason;
      readonly uri: string;
      readonly placeholder: PlaceholderAsset;
    };

export function resolveAsset(
  snapshot: RegistrySnapshot,
  query: ResolveQuery,
  placeholder: PlaceholderInput = DEFAULT_PLACEHOLDER,
): Resolution {
  const found = lookupCanon(snapshot, query);
  if (found.source === "canon") return found;
  const asset = renderPlaceholder(placeholder);
  return {
    source: "placeholder",
    reason: found.reason,
    uri: asset.uri,
    placeholder: asset,
  };
}
