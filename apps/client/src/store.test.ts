import { expect, test } from "bun:test";
import { parseSyncFrame, type SyncFrame } from "@panthea/contracts";
import { decode, type WorldState } from "@panthea/world";
import {
  atTick,
  baseState,
  deadActor,
  framePayload,
  movedActor,
  repairingTavern,
} from "./fixtures";
import { createWorldStore, toViewModel } from "./store";

function connected(
  state: WorldState,
  options: Parameters<typeof framePayload>[1] = {},
): { frame: SyncFrame; state: WorldState } {
  const parsed = parseSyncFrame(framePayload(state, options));
  if (!parsed.ok) throw new Error(parsed.message);
  return { frame: parsed.value, state: decode(parsed.value.state) };
}

test("a committed frame produces the expected view model", () => {
  const { frame, state } = connected(baseState(), {
    sequence: 9,
    recentEvents: [
      {
        id: "evt-3-9" as never,
        sequence: 9,
        tick: 3,
        kind: "building-ignited",
        subjects: ["the-tavern" as never],
      },
    ],
  });

  const view = toViewModel(frame, state);

  expect(view.sequence).toBe(9);
  expect(view.sessionId).toBe("session-1");
  expect(view.tick).toBe(3);
  expect(view.status).toBe("running");
  expect(view.degradedReason).toBeUndefined();
  expect(view.catchUpSummary).toBeUndefined();

  expect(view.realms.mortal.map((location) => location.id)).toEqual([
    "agora",
    "town-square",
  ]);
  expect(view.realms.olympus.map((location) => location.id)).toEqual([
    "olympus-hall",
  ]);
  expect(view.realms.underworld.map((location) => location.id)).toEqual([
    "underworld-gate",
  ]);

  const square = view.realms.mortal.find(
    (location) => location.id === "town-square",
  );
  expect(square?.name).toBe("Town Square");
  expect(square?.actors).toEqual([
    {
      id: "woodcutter",
      locationId: "town-square",
      alive: true,
      sprite: "placeholder-woodcutter",
      isDeity: false,
      inventory: [
        { resource: "currency", amount: 5 },
        { resource: "wood", amount: 2 },
      ],
    },
  ]);
  expect(square?.buildings).toEqual([
    {
      id: "the-tavern",
      name: "The Tavern",
      locationId: "town-square",
      status: "burning",
      inventory: [],
      fire: { intensity: 2, ticksBurning: 2, destroyAt: 3 },
    },
  ]);

  const agora = view.realms.mortal.find((location) => location.id === "agora");
  expect(agora?.buildings[0]).toMatchObject({
    id: "agora-shop",
    status: "operational",
    inventory: [{ resource: "planks", amount: 1 }],
  });
  expect(agora?.buildings[0]?.fire).toBeUndefined();
  expect(agora?.buildings[0]?.repair).toBeUndefined();

  const hall = view.realms.olympus[0];
  expect(hall?.actors.map((actor) => [actor.id, actor.isDeity])).toEqual([
    ["zeus", true],
  ]);

  expect(view.recentEvents).toEqual(frame.recentEvents);
});

test("a repairing building reports its repair progress against the authored cost", () => {
  const { frame, state } = connected(repairingTavern(baseState(), 1));

  const view = toViewModel(frame, state);

  const square = view.realms.mortal.find(
    (location) => location.id === "town-square",
  );
  expect(square?.buildings[0]).toMatchObject({
    status: "repairing",
    repair: { progress: 1, required: 3 },
  });
  expect(square?.buildings[0]?.fire).toBeUndefined();
});

test("status, degraded reason, and catch-up summary are exposed in the view model", () => {
  const { frame, state } = connected(baseState(), {
    status: "degraded",
    degradedReason: "disk-full",
    catchUpSummary: {
      id: "summary-9",
      appliedMs: 3_600_000,
      skippedMs: 120_000,
      majorOutcomes: ["tavern fire spread"],
      atSequence: 9,
    },
  });

  const view = toViewModel(frame, state);

  expect(view.status).toBe("degraded");
  expect(view.degradedReason).toBe("disk-full");
  expect(view.catchUpSummary).toEqual({
    id: "summary-9",
    appliedMs: 3_600_000,
    skippedMs: 120_000,
    majorOutcomes: ["tavern fire spread"],
    atSequence: 9,
  });
});

test("degraded status stays in the view model until a frame clears it", () => {
  const store = createWorldStore();
  const degraded = connected(baseState(), {
    sequence: 10,
    status: "degraded",
    degradedReason: "store-error",
  });
  store.apply(degraded.frame, degraded.state);
  expect(store.viewModel()?.status).toBe("degraded");
  expect(store.viewModel()?.degradedReason).toBe("store-error");

  const stillDegraded = connected(baseState(), {
    sequence: 10,
    status: "degraded",
    degradedReason: "store-error",
  });
  store.apply(stillDegraded.frame, stillDegraded.state);
  expect(store.viewModel()?.status).toBe("degraded");

  const cleared = connected(baseState(), { sequence: 11 });
  store.apply(cleared.frame, cleared.state);
  expect(store.viewModel()?.status).toBe("running");
  expect(store.viewModel()?.degradedReason).toBeUndefined();
});

test("a fresh frame on reconnect replaces prior state entirely", () => {
  const store = createWorldStore();
  const before = connected(baseState(), {
    sequence: 9,
    sessionId: "session-1",
    catchUpSummary: {
      id: "summary-old",
      appliedMs: 1000,
      skippedMs: 0,
      majorOutcomes: ["old outcome"],
      atSequence: 9,
    },
    recentEvents: [
      {
        id: "evt-3-9" as never,
        sequence: 9,
        tick: 3,
        kind: "building-ignited",
        subjects: ["the-tavern" as never],
      },
    ],
  });
  store.apply(before.frame, before.state);
  expect(store.viewModel()?.recentEvents).toHaveLength(1);
  expect(store.viewModel()?.catchUpSummary).toBeDefined();

  const smaller = movedActor(baseState(), "woodcutter", "agora");
  const after = connected(atTick(smaller, 1), {
    sequence: 2,
    sessionId: "session-2",
  });
  store.apply(after.frame, after.state);

  const view = store.viewModel();
  expect(view?.sessionId).toBe("session-2");
  expect(view?.sequence).toBe(2);
  expect(view?.tick).toBe(1);
  expect(view?.recentEvents).toEqual([]);
  expect(view?.catchUpSummary).toBeUndefined();
  expect(store.snapshot()?.frame.sessionId as string | undefined).toBe(
    "session-2",
  );
  const agora = view?.realms.mortal.find((location) => location.id === "agora");
  expect(agora?.actors.map((actor) => actor.id)).toEqual([
    "farmer",
    "woodcutter",
  ]);
});

test("the store notifies listeners on every applied frame, and an unsubscribed listener stops hearing them", () => {
  const store = createWorldStore();
  const heard: number[] = [];
  const stop = store.onChange((view) => heard.push(view.sequence));

  const first = connected(baseState(), { sequence: 1 });
  store.apply(first.frame, first.state);
  stop();
  const second = connected(baseState(), { sequence: 2 });
  store.apply(second.frame, second.state);

  expect(heard).toEqual([1]);
});

test("an empty store has no snapshot or view model", () => {
  const store = createWorldStore();
  expect(store.snapshot()).toBeUndefined();
  expect(store.viewModel()).toBeUndefined();
});

test("a dead actor stays in the view model, marked not alive", () => {
  const { frame, state } = connected(deadActor(baseState(), "woodcutter"));
  const view = toViewModel(frame, state);
  const square = view.realms.mortal.find(
    (location) => location.id === "town-square",
  );
  expect(square?.actors[0]).toMatchObject({ id: "woodcutter", alive: false });
});
