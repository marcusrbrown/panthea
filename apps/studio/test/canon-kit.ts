// Test support: the committed canon registry as a resolver snapshot, so a
// scene test composes the real published structures and effects. Test-only.

import { type RegistrySnapshot, resolveAsset } from "@panthea/assets";
import { committedVocabulary } from "@panthea/assets/fixtures";
import { loadRegistry } from "@panthea/assets/registry";
import type { SceneResolution } from "@panthea/renderer";

const REGISTRY = new URL(
  "../../../content/greek/assets/registry",
  import.meta.url,
).pathname;

let loaded: RegistrySnapshot | undefined;

/** Every committed canon asset, loaded once. */
export function canonSnapshot(): RegistrySnapshot {
  if (loaded === undefined) {
    const registry = loadRegistry(REGISTRY, committedVocabulary());
    if (registry.problems.length > 0) {
      throw new Error(
        registry.problems.map((problem) => problem.message).join("; "),
      );
    }
    loaded = registry.snapshot;
  }
  return loaded;
}

/** The resolution of a published asset, as the scene composer takes it. */
export function canon(query: {
  readonly spriteId: string;
  readonly state?: string;
  readonly direction?: string;
  readonly animation?: string;
}): SceneResolution {
  const resolved = resolveAsset(canonSnapshot(), query);
  if (resolved.source !== "canon") {
    throw new Error(`${query.spriteId} did not resolve to canon art`);
  }
  return resolved;
}
