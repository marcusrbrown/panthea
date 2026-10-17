import { expect, test } from "bun:test";
import { parseSyncFrame } from "@panthea/contracts";
import { decode, type WorldState } from "@panthea/world";
import {
  atTick,
  baseState,
  deadActor,
  framePayload,
  movedActor,
  withoutActor,
} from "./fixtures";
import { createObserver, followedPlace, listTargets } from "./observer";
import { toViewModel, type WorldViewModel } from "./store";

function view(state: WorldState, sequence = 1): WorldViewModel {
  const parsed = parseSyncFrame(framePayload(state, { sequence }));
  if (!parsed.ok) throw new Error(parsed.message);
  return toViewModel(parsed.value, decode(parsed.value.state));
}

test("the target list is grouped by realm, with locations and actors in each", () => {
  const groups = listTargets(view(baseState()));

  expect(groups.map((group) => group.realm)).toEqual([
    "mortal",
    "olympus",
    "underworld",
  ]);
  const mortal = groups[0];
  expect(mortal?.locations.map((location) => location.id)).toEqual([
    "agora",
    "town-square",
  ]);
  expect(mortal?.actors.map((actor) => actor.id)).toEqual([
    "farmer",
    "woodcutter",
  ]);
  expect(groups[1]?.actors.map((actor) => actor.id)).toEqual(["zeus"]);
  expect(groups[2]?.actors).toEqual([]);
});

test("with nothing picked the observer is idle", () => {
  const observer = createObserver();
  expect(observer.update(view(baseState()))).toEqual({ kind: "idle" });
});

test("picking a location shows that location's realm", () => {
  const observer = createObserver();
  observer.pick({ kind: "location", id: "underworld-gate" });

  expect(observer.update(view(baseState()))).toEqual({
    kind: "following",
    target: { kind: "location", id: "underworld-gate" },
    locationId: "underworld-gate",
    realm: "underworld",
  });
});

test("following an actor tracks its location and realm from state alone", () => {
  const observer = createObserver();
  observer.pick({ kind: "actor", id: "woodcutter" });

  expect(observer.update(view(baseState()))).toMatchObject({
    kind: "following",
    locationId: "town-square",
    realm: "mortal",
  });

  const moved = observer.update(
    view(movedActor(baseState(), "woodcutter", "agora"), 2),
  );
  expect(moved).toMatchObject({
    kind: "following",
    locationId: "agora",
    realm: "mortal",
  });
});

test("following an actor through the Underworld transition switches the rendered realm", () => {
  const observer = createObserver();
  observer.pick({ kind: "actor", id: "woodcutter" });
  expect(observer.update(view(baseState()))).toMatchObject({ realm: "mortal" });

  const crossed = movedActor(baseState(), "woodcutter", "underworld-gate");
  expect(observer.update(view(atTick(crossed, 4), 2))).toEqual({
    kind: "following",
    target: { kind: "actor", id: "woodcutter" },
    locationId: "underworld-gate",
    realm: "underworld",
  });
});

test("a followed actor that dies holds its last location with the reason died", () => {
  const observer = createObserver();
  observer.pick({ kind: "actor", id: "woodcutter" });
  observer.update(view(movedActor(baseState(), "woodcutter", "agora")));

  const held = observer.update(
    view(
      deadActor(movedActor(baseState(), "woodcutter", "agora"), "woodcutter"),
      2,
    ),
  );

  expect(held).toEqual({
    kind: "held",
    target: { kind: "actor", id: "woodcutter" },
    reason: "died",
    lastKnown: { locationId: "agora", realm: "mortal" },
  });
});

test("a followed actor that leaves the world holds its last location with the reason removed", () => {
  const observer = createObserver();
  observer.pick({ kind: "actor", id: "woodcutter" });
  observer.update(view(baseState()));

  const held = observer.update(
    view(withoutActor(baseState(), "woodcutter"), 2),
  );

  expect(held).toEqual({
    kind: "held",
    target: { kind: "actor", id: "woodcutter" },
    reason: "removed",
    lastKnown: { locationId: "town-square", realm: "mortal" },
  });
});

/** A view model the world codec would never decode (it enforces that every actor's location exists), for the defensive paths. */
function viewWithActorAt(
  source: WorldViewModel,
  actorId: string,
  locationId: string,
): WorldViewModel {
  const realms = Object.fromEntries(
    Object.entries(source.realms).map(([realm, locations]) => [
      realm,
      locations.map((location) => ({
        ...location,
        actors: location.actors.map((actor) =>
          actor.id === actorId ? { ...actor, locationId } : actor,
        ),
      })),
    ]),
  ) as unknown as WorldViewModel["realms"];
  return { ...source, realms };
}

function viewWithoutLocation(
  source: WorldViewModel,
  locationId: string,
): WorldViewModel {
  const realms = Object.fromEntries(
    Object.entries(source.realms).map(([realm, locations]) => [
      realm,
      locations.filter((location) => location.id !== locationId),
    ]),
  ) as unknown as WorldViewModel["realms"];
  return { ...source, realms };
}

test("a followed actor whose location is not in the view holds the reason unreachable", () => {
  const observer = createObserver();
  observer.pick({ kind: "actor", id: "woodcutter" });
  observer.update(view(baseState()));

  const stranded = viewWithActorAt(
    view(baseState(), 2),
    "woodcutter",
    "nowhere",
  );
  const held = observer.update(stranded);

  expect(held).toEqual({
    kind: "held",
    target: { kind: "actor", id: "woodcutter" },
    reason: "unreachable",
    lastKnown: { locationId: "town-square", realm: "mortal" },
  });
});

test("a followed location that leaves the world holds with the reason removed", () => {
  const observer = createObserver();
  observer.pick({ kind: "location", id: "agora" });
  observer.update(view(baseState()));

  const held = observer.update(
    viewWithoutLocation(view(baseState(), 2), "agora"),
  );

  expect(held).toMatchObject({
    kind: "held",
    reason: "removed",
    lastKnown: { locationId: "agora", realm: "mortal" },
  });
});

test("picking a new target after a hold resumes following", () => {
  const observer = createObserver();
  observer.pick({ kind: "actor", id: "woodcutter" });
  observer.update(view(baseState()));
  const dead = view(deadActor(baseState(), "woodcutter"), 2);
  expect(observer.update(dead)).toMatchObject({ kind: "held", reason: "died" });

  observer.pick({ kind: "actor", id: "zeus" });

  expect(observer.update(dead)).toEqual({
    kind: "following",
    target: { kind: "actor", id: "zeus" },
    locationId: "olympus-hall",
    realm: "olympus",
  });
});

test("a held target that the state shows alive again is followed again", () => {
  const observer = createObserver();
  observer.pick({ kind: "actor", id: "woodcutter" });
  observer.update(view(baseState()));
  observer.update(view(withoutActor(baseState(), "woodcutter"), 2));

  expect(observer.update(view(baseState(), 3))).toMatchObject({
    kind: "following",
    locationId: "town-square",
  });
});

test("a held actor that reappears dead somewhere new holds at the new location", () => {
  const observer = createObserver();
  observer.pick({ kind: "actor", id: "woodcutter" });
  observer.update(view(baseState()));
  observer.update(view(withoutActor(baseState(), "woodcutter"), 2));

  const heldElsewhere = observer.update(
    view(
      deadActor(movedActor(baseState(), "woodcutter", "agora"), "woodcutter"),
      3,
    ),
  );

  expect(heldElsewhere).toEqual({
    kind: "held",
    target: { kind: "actor", id: "woodcutter" },
    reason: "died",
    lastKnown: { locationId: "agora", realm: "mortal" },
  });
});

test("picking an actor that is already dead holds at the location state reports", () => {
  const observer = createObserver();
  observer.pick({ kind: "actor", id: "woodcutter" });

  expect(observer.update(view(deadActor(baseState(), "woodcutter")))).toEqual({
    kind: "held",
    target: { kind: "actor", id: "woodcutter" },
    reason: "died",
    lastKnown: { locationId: "town-square", realm: "mortal" },
  });
});

test("picking a target that never existed holds as removed with no last location", () => {
  const observer = createObserver();
  observer.pick({ kind: "actor", id: "nobody" });

  expect(observer.update(view(baseState()))).toEqual({
    kind: "held",
    target: { kind: "actor", id: "nobody" },
    reason: "removed",
  });
});

test("the observer's only inputs are picks and view models, so selecting a target reaches nothing outside the client", () => {
  const observer = createObserver();
  observer.pick({ kind: "actor", id: "woodcutter" });
  observer.update(view(baseState()));
  observer.pick({ kind: "location", id: "agora" });
  observer.update(view(baseState(), 2));

  expect(Object.keys(observer).sort()).toEqual(["pick", "update", "view"]);
  expect(observer.view()).toMatchObject({
    kind: "following",
    target: { kind: "location", id: "agora" },
  });
});

test("an idle observer looks at the town square: the place the game opens on, until a target is picked", () => {
  const observer = createObserver();
  const state = baseState();
  const idle = view(state);

  expect(observer.update(idle).kind).toBe("idle");
  expect(followedPlace(observer.update(idle), idle)).toEqual({
    realm: "mortal",
    locationId: "town-square",
  });
  // Picking a target overrides it, and clearing nothing else brings it back: idle is only idle before a pick.
  observer.pick({ kind: "location", id: "agora" });
  expect(followedPlace(observer.update(idle), idle)).toEqual({
    realm: "mortal",
    locationId: "agora",
  });
});

test("when the view has no town square, an idle observer looks at the first mortal place it has; with no mortal place or no view it has none", () => {
  const state = baseState();
  const full = view(state);
  const withoutSquare = viewWithoutLocation(full, "town-square");
  const idle = createObserver().update(full);

  expect(followedPlace(idle, withoutSquare)).toEqual({
    realm: "mortal",
    locationId: "agora",
  });
  expect(
    followedPlace(idle, {
      ...full,
      realms: { ...full.realms, mortal: [] },
    }),
  ).toBeUndefined();
  expect(followedPlace(idle, undefined)).toBeUndefined();
  expect(followedPlace(idle)).toBeUndefined();
});

test("the followed place is the followed location, or the followed actor's current location", () => {
  const observer = createObserver();
  const state = baseState();

  observer.pick({ kind: "location", id: "agora" });
  expect(followedPlace(observer.update(view(state)))).toEqual({
    realm: "mortal",
    locationId: "agora",
  });

  observer.pick({ kind: "actor", id: "woodcutter" });
  expect(followedPlace(observer.update(view(state)))).toEqual({
    realm: "mortal",
    locationId: "town-square",
  });
  // The actor walks: the place follows it, from state alone.
  expect(
    followedPlace(
      observer.update(view(movedActor(state, "woodcutter", "agora"))),
    ),
  ).toEqual({ realm: "mortal", locationId: "agora" });
  // And across realms.
  observer.pick({ kind: "actor", id: "zeus" });
  expect(followedPlace(observer.update(view(state)))?.realm).toBe("olympus");
});

test("a held observer keeps the last place it knew, and one that never knew one has none", () => {
  const observer = createObserver();
  const state = baseState();
  observer.pick({ kind: "actor", id: "woodcutter" });
  observer.update(view(state));

  // A dead actor is held where the state reports it.
  expect(
    followedPlace(observer.update(view(deadActor(state, "woodcutter")))),
  ).toEqual({ realm: "mortal", locationId: "town-square" });
  // A removed one is held at the last place it was followed.
  expect(
    followedPlace(observer.update(view(withoutActor(state, "woodcutter")))),
  ).toEqual({ realm: "mortal", locationId: "town-square" });

  // The default is for an observer that has picked nothing. One that picked an actor it never found has no place, and
  // keeps none: its target is a choice, and a different place would not be the one it asked for.
  const never = createObserver();
  never.pick({ kind: "actor", id: "nobody" });
  expect(followedPlace(never.update(view(state)), view(state))).toBeUndefined();
});
