// Client-local observer selection: which actor or location the view is
// showing. Picking a target changes only this module's state; nothing here
// sends anything to the shell or the sidecar. Where a followed actor is,
// and so which realm to render, comes only from the committed state in the
// view model, never from anything the client assumes.

import type { Realm } from "@panthea/contracts";
import type { WorldViewModel } from "./store";

export type ObserverTarget =
  | { readonly kind: "actor"; readonly id: string }
  | { readonly kind: "location"; readonly id: string };

export type HoldReason = "died" | "removed" | "unreachable";

export interface LastKnownLocation {
  readonly locationId: string;
  readonly realm: Realm;
}

export type ObserverView =
  | { readonly kind: "idle" }
  | {
      readonly kind: "following";
      readonly target: ObserverTarget;
      readonly locationId: string;
      readonly realm: Realm;
    }
  | {
      readonly kind: "held";
      readonly target: ObserverTarget;
      readonly reason: HoldReason;
      readonly lastKnown?: LastKnownLocation;
    };

/**
 * The place the observer is looking at: the followed location, or the followed
 * actor's current one; a held observer's last known place; none while idle or
 * when no place was ever known. The scene draws this place and the
 * "Current location" label names it.
 */
export function followedPlace(
  observation: ObserverView,
): LastKnownLocation | undefined {
  if (observation.kind === "following") {
    return { locationId: observation.locationId, realm: observation.realm };
  }
  return observation.kind === "held" ? observation.lastKnown : undefined;
}

export interface TargetGroup {
  readonly realm: Realm;
  readonly locations: readonly { readonly id: string; readonly name: string }[];
  readonly actors: readonly {
    readonly id: string;
    readonly locationId: string;
    readonly alive: boolean;
  }[];
}

/** Every location and actor the observer can pick, grouped by realm in the view model's realm order. */
export function listTargets(view: WorldViewModel): readonly TargetGroup[] {
  return (Object.keys(view.realms) as Realm[]).map((realm) => {
    const locations = view.realms[realm];
    return {
      realm,
      locations: locations.map(({ id, name }) => ({ id, name })),
      actors: locations
        .flatMap((location) => location.actors)
        .map(({ id, locationId, alive }) => ({ id, locationId, alive }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    };
  });
}

function findLocation(
  view: WorldViewModel,
  locationId: string,
): LastKnownLocation | undefined {
  for (const [realm, locations] of Object.entries(view.realms)) {
    if (locations.some((location) => location.id === locationId)) {
      return { locationId, realm: realm as Realm };
    }
  }
  return undefined;
}

function findActor(view: WorldViewModel, actorId: string) {
  for (const locations of Object.values(view.realms)) {
    for (const location of locations) {
      const actor = location.actors.find(
        (candidate) => candidate.id === actorId,
      );
      if (actor) return actor;
    }
  }
  return undefined;
}

function lastKnownOf(previous: ObserverView): LastKnownLocation | undefined {
  if (previous.kind === "following") {
    return { locationId: previous.locationId, realm: previous.realm };
  }
  return previous.kind === "held" ? previous.lastKnown : undefined;
}

function held(
  target: ObserverTarget,
  reason: HoldReason,
  lastKnown: LastKnownLocation | undefined,
): ObserverView {
  return {
    kind: "held",
    target,
    reason,
    ...(lastKnown === undefined ? {} : { lastKnown }),
  };
}

/**
 * Resolves what the observer shows for `target` in `view`. A target the
 * state no longer supports holds with the reason: a dead actor at the
 * location the state reports for it, and any other lost target at the last
 * location this observer knew. Recomputed from state on every update, so a target the state
 * shows alive and placed again is followed again.
 */
function resolve(
  target: ObserverTarget | undefined,
  previous: ObserverView,
  view: WorldViewModel,
): ObserverView {
  if (target === undefined) {
    return { kind: "idle" };
  }
  const fallback = lastKnownOf(previous);

  if (target.kind === "location") {
    const location = findLocation(view, target.id);
    return location
      ? {
          kind: "following",
          target,
          locationId: location.locationId,
          realm: location.realm,
        }
      : held(target, "removed", fallback);
  }

  const actor = findActor(view, target.id);
  if (actor === undefined) {
    return held(target, "removed", fallback);
  }
  const location = findLocation(view, actor.locationId);
  if (actor.alive === false) {
    return held(target, "died", location ?? fallback);
  }
  if (location === undefined) {
    return held(target, "unreachable", fallback);
  }
  return {
    kind: "following",
    target,
    locationId: location.locationId,
    realm: location.realm,
  };
}

export interface Observer {
  /** Selects what to follow; takes effect at the next `update`. */
  pick(target: ObserverTarget): void;
  /** Recomputes the observer's view from the latest view model. */
  update(view: WorldViewModel): ObserverView;
  /** The view as of the last `update`. */
  view(): ObserverView;
}

export function createObserver(): Observer {
  let target: ObserverTarget | undefined;
  let current: ObserverView = { kind: "idle" };

  return {
    pick(next) {
      target = next;
    },
    update(view) {
      current = resolve(target, current, view);
      return current;
    },
    view: () => current,
  };
}
