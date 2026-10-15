import { expect, test } from "bun:test";
import { parseSyncFrame } from "@panthea/contracts";
import { decode } from "@panthea/world";

import { baseState, type FixtureEvent, framePayload } from "../fixtures";
import { createObserver } from "../observer";
import { createReceiptEmitter } from "../receipts";
import { createRecovery } from "../recovery";
import { createWorldStore, toViewModel, type WorldViewModel } from "../store";
import {
  drawableEvents,
  eventsInRealm,
  placeEvents,
  receiptDrawnEvents,
} from "./presentation";
import { rebuildAfterDeviceLoss } from "./recovery";

function event(
  id: string,
  kind: string,
  subjects: readonly string[],
  sequence = 1,
): FixtureEvent {
  return { id, sequence, tick: 2, kind, subjects };
}

function viewWith(events: readonly FixtureEvent[]): WorldViewModel {
  const parsed = parseSyncFrame(
    framePayload(baseState(), { recentEvents: events }),
  );
  if (!parsed.ok) throw new Error(parsed.message);
  return toViewModel(parsed.value, decode(parsed.value.state));
}

function emitterInto(sent: string[]) {
  return createReceiptEmitter({
    presentEvent: async (id) => {
      sent.push(id);
    },
    onError: () => {},
  });
}

test("a strike on a building is placed with the fire tone", () => {
  const view = viewWith([
    event("strike-1", "building-damaged", ["the-tavern"]),
  ]);

  const placed = placeEvents(view, "mortal");

  expect(placed.map((entry) => [String(entry.event.id), entry.tone])).toEqual([
    ["strike-1", "fire"],
  ]);
});

test("an event on a building names that building, wherever in the event's subjects it stands", () => {
  const view = viewWith([
    event("strike-1", "building-damaged", ["the-tavern", "zeus"], 1),
    event("strike-2", "building-damaged", ["woodcutter", "the-tavern"], 2),
  ]);

  expect(
    placeEvents(view, "mortal").map((entry) => [
      String(entry.event.id),
      entry.buildingId,
    ]),
  ).toEqual([
    ["strike-1", "the-tavern"],
    ["strike-2", "the-tavern"],
  ]);
});

test("an event on an actor or a location names no building, and a strike seen from a realm without the building names none", () => {
  const view = viewWith([
    event("trade-1", "resource-traded", ["woodcutter", "farmer"], 1),
    event("fire-2", "building-ignited", ["agora"], 2),
    event("strike-3", "building-damaged", ["the-tavern", "zeus"], 3),
  ]);

  expect(
    placeEvents(view, "mortal").map((entry) => [
      String(entry.event.id),
      entry.buildingId,
    ]),
  ).toEqual([
    ["trade-1", undefined],
    ["fire-2", undefined],
    ["strike-3", "the-tavern"],
  ]);
  // Zeus is on Olympus: the same strike is placed there, where the tavern is not.
  expect(
    placeEvents(view, "olympus").map((entry) => [
      String(entry.event.id),
      entry.locationId,
      entry.buildingId,
    ]),
  ).toEqual([["strike-3", "olympus-hall", undefined]]);
});

test("each drawn kind is placed with its tone", () => {
  const view = viewWith([
    event("ignite-1", "building-ignited", ["the-tavern"], 1),
    event("destroy-1", "building-destroyed", ["the-tavern"], 2),
    event("worship-1", "worship-performed", ["woodcutter"], 3),
    event("trade-1", "resource-traded", ["woodcutter", "farmer"], 4),
    event("repair-1", "building-repaired", ["the-tavern"], 5),
  ]);

  const tones = placeEvents(view, "mortal").map((entry) => [
    String(entry.event.id),
    entry.tone,
  ]);

  expect(tones).toEqual([
    ["ignite-1", "fire"],
    ["destroy-1", "fire"],
    ["worship-1", "worship"],
    ["trade-1", "neutral"],
    ["repair-1", "neutral"],
  ]);
});

test("per-tick noise is not placed, drawn, or receipted", async () => {
  const noise = [
    "building-burn-ticked",
    "repair-progressed",
    "income-earned",
    "entity-moved",
    "resource-gathered",
    "resource-produced",
    "resource-consumed",
  ];
  const view = viewWith(
    noise.map((kind, index) =>
      event(`noise-${index}`, kind, ["the-tavern", "woodcutter"], index + 1),
    ),
  );
  const sent: string[] = [];

  const drawn = drawableEvents(view, "mortal");
  await receiptDrawnEvents(view.sessionId, drawn, emitterInto(sent));

  expect(placeEvents(view, "mortal")).toEqual([]);
  expect(sent).toEqual([]);
});

test("an event on a building in the viewed realm is drawn at that building's location", () => {
  const view = viewWith([event("fire-1", "building-ignited", ["the-tavern"])]);

  const placed = placeEvents(view, "mortal");

  expect(placed.map((entry) => [entry.event.id, entry.locationId])).toEqual([
    ["fire-1", "town-square"],
  ]);
});

test("an event is placed at the location of its first subject that resolves in the realm", () => {
  const view = viewWith([
    event("trade-1", "resource-traded", ["zeus", "farmer", "woodcutter"]),
  ]);

  const placed = placeEvents(view, "mortal");

  expect(placed.map((entry) => entry.locationId)).toEqual(["agora"]);
});

test("a location subject resolves to itself", () => {
  const view = viewWith([event("fire-2", "building-ignited", ["agora"])]);

  expect(placeEvents(view, "mortal").map((entry) => entry.locationId)).toEqual([
    "agora",
  ]);
});

test("recent activity includes every kind with any subject in the viewed realm", () => {
  const view = viewWith([
    event("move-1", "entity-moved", ["zeus", "farmer"], 1),
    event("burn-tick-1", "building-burn-ticked", ["the-tavern"], 2),
    event("legend-1", "legend-recorded", ["town-square"], 3),
    event("worship-1", "worship-performed", ["zeus"], 4),
    event("orphan-1", "resource-traded", ["missing-subject"], 5),
  ]);

  expect(
    eventsInRealm(view, "mortal").map((entry) => String(entry.id)),
  ).toEqual(["move-1", "burn-tick-1", "legend-1"]);
});

test("an event whose subjects are all in another realm is neither drawn nor receipted", async () => {
  const view = viewWith([
    event("worship-1", "worship-performed", ["zeus", "olympus-hall"]),
  ]);
  const sent: string[] = [];

  const drawn = drawableEvents(view, "mortal");
  await receiptDrawnEvents(view.sessionId, drawn, emitterInto(sent));

  expect(drawn).toEqual([]);
  expect(sent).toEqual([]);
});

test("the same event is drawn and receipted when its own realm is viewed", async () => {
  const view = viewWith([
    event("worship-1", "worship-performed", ["zeus", "olympus-hall"]),
  ]);
  const sent: string[] = [];

  const drawn = drawableEvents(view, "olympus");
  await receiptDrawnEvents(view.sessionId, drawn, emitterInto(sent));

  expect(placeEvents(view, "olympus")[0]?.locationId).toBe("olympus-hall");
  expect(sent).toEqual(["worship-1"]);
});

test("an event whose subjects resolve to nothing is not drawn", () => {
  const view = viewWith([
    event("fire-3", "building-ignited", ["a-building-that-is-gone"]),
    event("fire-4", "building-ignited", []),
  ]);

  expect(drawableEvents(view, "mortal")).toEqual([]);
});

test("an event kind the scene has no effect for is not drawn even when its subject is in the realm", () => {
  const view = viewWith([event("move-1", "entity-moved", ["woodcutter"])]);

  expect(drawableEvents(view, "mortal")).toEqual([]);
});

test("only drawable recent effects are handed to presentation receipts, once each", async () => {
  const view = viewWith([
    event("fire-1", "building-ignited", ["the-tavern"], 1),
    event("trade-1", "resource-traded", ["woodcutter", "farmer"], 2),
    event("move-1", "entity-moved", ["woodcutter"], 3),
    event("worship-1", "worship-performed", ["zeus"], 4),
  ]);
  const sent: string[] = [];
  const emitter = emitterInto(sent);
  const drawn = drawableEvents(view, "mortal");

  await receiptDrawnEvents(view.sessionId, drawn, emitter);
  await receiptDrawnEvents(view.sessionId, drawn, emitter);

  expect(drawn.map((entry) => String(entry.id))).toEqual(["fire-1", "trade-1"]);
  expect(sent).toEqual(["fire-1", "trade-1"]);
});

test("device loss rebuilds the current view before a fresh renderer resumes", () => {
  const actions: string[] = [];
  const rebuilt = { ...viewWith([]), sequence: 5 };

  const result = rebuildAfterDeviceLoss(
    () => {
      actions.push("rebuild");
      return rebuilt;
    },
    (next) => {
      actions.push(`replace:${next.sequence}`);
    },
  );

  expect(result).toBe(rebuilt);
  expect(actions).toEqual(["rebuild", "replace:5"]);
});

test("device loss before any frame replaces nothing, never reaches the observer, and leaves the view idle", () => {
  const store = createWorldStore();
  const observer = createObserver();
  observer.pick({ kind: "actor", id: "woodcutter" });
  const replaced: WorldViewModel[] = [];

  const lose = () =>
    rebuildAfterDeviceLoss(
      () => createRecovery(store).rebuild(),
      (rebuilt) => {
        replaced.push(rebuilt);
        observer.update(rebuilt);
      },
    );

  expect(lose).not.toThrow();
  expect(lose()).toBeUndefined();
  expect(replaced).toHaveLength(0);
  expect(observer.view()).toEqual({ kind: "idle" });
  expect(store.viewModel()).toBeUndefined();
});
