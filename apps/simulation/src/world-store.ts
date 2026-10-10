// Composition root bridging packages/world's pure engine to
// packages/persistence's storage. apps/simulation depends on both
// packages; everything here is thin glue -- no domain logic, just wiring
// world's registries and codec into persistence's `ProjectionReducers<T>`
// injection points.
//
// packages/persistence never imports packages/world; this file is the
// only place both are imported together.

import { type LabeledProfileInput, withGodSprites } from "@panthea/content";
import type {
  ClockRow,
  ProjectionCodec,
  ProjectionReducers,
  Store,
} from "@panthea/persistence";
import { getEventRow } from "@panthea/persistence";
import type { EventSource } from "@panthea/telemetry";
import {
  applyEvent,
  createInitialWorldState,
  decode as decodeWorldState,
  encode as encodeWorldState,
  type PrngState,
  type WorldState,
} from "@panthea/world";
import {
  EMBEDDED_GOD_PROFILE_FILES,
  loadEmbeddedGreekGodProfiles,
  loadEmbeddedGreekWorldPack,
} from "./greek-world-pack";

/**
 * Loads the embedded authored Greek content pack (see
 * greek-world-pack.ts) and builds its initial `WorldState` (no actors --
 * see packages/world/src/state.ts). Needs no filesystem access, so it
 * works identically whether running from source or inside a compiled
 * `bun build --compile` sidecar binary. The embedded god profiles are
 * parsed against the pack too, so a profile that no longer matches a deity
 * inhabitant stops startup.
 */
export function loadGreekWorldState(
  godProfileFiles: readonly LabeledProfileInput[] = EMBEDDED_GOD_PROFILE_FILES,
): WorldState {
  const result = loadEmbeddedGreekWorldPack();
  if (!result.ok) {
    throw new Error(
      `world-store: failed to parse the embedded Greek content pack (${result.path}): ${result.message}`,
    );
  }
  const gods = loadEmbeddedGreekGodProfiles(result.value, godProfileFiles);
  if (!gods.ok) {
    throw new Error(
      `world-store: failed to parse the embedded Greek god profiles (${gods.path}): ${gods.message}`,
    );
  }
  // A deity's sprite id is its profile's alone: fold it into the pack, so genesis keeps its signature.
  const folded = withGodSprites(result.value, gods.value);
  if (!folded.ok) {
    throw new Error(
      `world-store: failed to fold the god profiles' sprites into the embedded Greek content pack (${folded.path}): ${folded.message}`,
    );
  }
  return createInitialWorldState(folded.value);
}

/**
 * Bridges `WorldState`'s `Map`-backed shape to packages/persistence's
 * JSON-safe storage via packages/world's own `encode`/`decode`. Persistence
 * calls `encode` once per `commitTick`/`exportArchive` and `decode` once
 * per `readLiveProjections`/`rebuildProjections`/store-reopen -- never per
 * event -- so `applyEvent` below operates on the real, `Map`-backed
 * `WorldState` throughout a transaction, not on the encoded form.
 */
export const worldProjectionCodec: ProjectionCodec<WorldState> = {
  encode: (state) => encodeWorldState(state),
  decode: (value) => decodeWorldState(value),
};

/**
 * What archive import needs of the world: the codec that validates a stored
 * projection and the reducer that rebuilds one from the event log, so an
 * imported archive's projection is checked against its own history.
 */
export const worldImportReducers: Pick<
  ProjectionReducers<unknown>,
  "applyEvent" | "codec"
> = {
  applyEvent: (projections, event) =>
    applyEvent(projections as WorldState, event),
  codec: worldProjectionCodec,
};

/**
 * Builds the `ProjectionReducers<WorldState>` packages/persistence's
 * `commitTick`/`rebuildProjections`/`readLiveProjections` inject into:
 * `applyEvent` is packages/world's own plain event-application function --
 * the single place event-to-state logic lives -- and `codec` is
 * `worldProjectionCodec`.
 */
export function createWorldProjectionReducers(
  initialState: WorldState,
): ProjectionReducers<WorldState> {
  return {
    initial: initialState,
    applyEvent,
    codec: worldProjectionCodec,
  };
}

/**
 * Restores `WorldState.tick`/`simTime` from the store's clock row: the
 * projection-replay path can never reconstruct them (no event or reducer
 * carries them), so the clock row committed atomically with each tick is
 * their authoritative source after a reopen or rebuild.
 */
export function restoreWorldTime(
  state: WorldState,
  clock: Pick<ClockRow, "tick" | "simTimeMs">,
): WorldState {
  return { ...state, tick: clock.tick, simTime: clock.simTimeMs };
}

/**
 * Serializes packages/world's `PrngState` for `TickInput.prngState`
 * (persistence stores it as an opaque string; packages/world owns the
 * algorithm and its own serialization).
 */
export function serializePrngState(prng: PrngState): string {
  return JSON.stringify(prng);
}

/** Inverse of `serializePrngState`; the empty string (a brand-new store's seed row) has no PRNG history to restore. */
export function deserializePrngState(raw: string): PrngState | undefined {
  if (raw === "") {
    return undefined;
  }
  return JSON.parse(raw) as PrngState;
}

/**
 * Bridges persistence's `getEventRow` to packages/telemetry's `EventSource`
 * injection seam, so a trace query can resolve committed events without
 * telemetry depending on `@panthea/persistence`'s `Store` type directly.
 */
export function createEventSource(store: Pick<Store, "db">): EventSource {
  return {
    getEvent: (id) => getEventRow(store.db, id),
  };
}
