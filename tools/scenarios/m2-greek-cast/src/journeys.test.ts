import { expect, test } from "bun:test";
import type { StoredEvent } from "./checks";
import { journeysOf, renderJourneyCounts, renderJourneys } from "./journeys";

/** An event as the store holds it, with the envelope the world gives every event. */
function event(
  id: string,
  sequence: number,
  tick: number,
  correlationId: string,
  fields: Record<string, unknown>,
): StoredEvent {
  return {
    schemaVersion: 1,
    id,
    sequence,
    simTime: tick * 1000,
    tick,
    correlationId,
    causationId: correlationId,
    approximate: false,
    ...fields,
  };
}

const started = (
  id: string,
  sequence: number,
  tick: number,
  god: string,
  to: string,
) =>
  event(id, sequence, tick, `obs-${id}`, {
    kind: "journey-started",
    entityId: god,
    to,
  });

/** A hop of the journey `journey`, caused by it the way the world records it. */
const hop = (
  id: string,
  sequence: number,
  tick: number,
  journey: string,
  god: string,
  to: string,
  via?: string,
) =>
  event(id, sequence, tick, journey, {
    kind: via === undefined ? "entity-moved" : "realm-transitioned",
    entityId: god,
    to,
    ...(via === undefined ? {} : { via }),
  });

const ended = (
  id: string,
  sequence: number,
  tick: number,
  journey: string,
  god: string,
  ending: string,
  reason?: string,
) =>
  event(id, sequence, tick, journey, {
    kind: "journey-ended",
    entityId: god,
    journeyEventId: journey,
    ending,
    ...(reason === undefined ? {} : { reason }),
  });

const STARTS = { zeus: "great-hall", hera: "great-hall" };

test("a journey shows the god, where it started, where it went, its start tick, each hop, and how it ended and when", () => {
  const events = [
    started("evt-5-1", 1, 5, "zeus", "tavern"),
    hop("evt-5-2", 2, 5, "evt-5-1", "zeus", "olympus-gate"),
    hop("evt-6-3", 3, 6, "evt-5-1", "zeus", "mountain-path", "olympus-gate"),
    hop("evt-7-4", 4, 7, "evt-5-1", "zeus", "town-square"),
    hop("evt-8-5", 5, 8, "evt-5-1", "zeus", "tavern"),
    ended("evt-8-6", 6, 8, "evt-5-1", "zeus", "arrived"),
  ];
  const [journey] = journeysOf(events, STARTS);
  expect(journey).toEqual({
    id: "evt-5-1",
    god: "zeus",
    from: "great-hall",
    to: "tavern",
    startTick: 5,
    hops: [
      { tick: 5, kind: "entity-moved", to: "olympus-gate" },
      {
        tick: 6,
        kind: "realm-transitioned",
        to: "mountain-path",
        via: "olympus-gate",
      },
      { tick: 7, kind: "entity-moved", to: "town-square" },
      { tick: 8, kind: "entity-moved", to: "tavern" },
    ],
    ending: { kind: "arrived", tick: 8 },
  });
});

test("a hop belongs to the journey it is correlated with: a god's other moves, another god's journey, and mortals' moves are not its hops", () => {
  const events = [
    started("evt-5-1", 1, 5, "zeus", "tavern"),
    started("evt-5-2", 2, 5, "hera", "forge"),
    hop("evt-5-3", 3, 5, "evt-5-1", "zeus", "olympus-gate"),
    hop("evt-5-4", 4, 5, "evt-5-2", "hera", "olympus-gate"),
    // A mortal's routine move and a god's move that no journey caused.
    event("evt-5-5", 5, 5, "tick-5", {
      kind: "entity-moved",
      entityId: "farmer",
      to: "tavern",
    }),
    event("evt-5-6", 6, 5, "obs-x", {
      kind: "entity-moved",
      entityId: "zeus",
      to: "altar",
    }),
  ];
  const journeys = journeysOf(events, STARTS);
  expect(journeys.map((j) => [j.god, j.hops.map((h) => h.to)])).toEqual([
    ["zeus", ["olympus-gate"]],
    ["hera", ["olympus-gate"]],
  ]);
});

test("a journey starts where the god's last move left it, and from its authored place before it has moved", () => {
  const events = [
    started("evt-5-1", 1, 5, "zeus", "olympus-gate"),
    hop("evt-5-2", 2, 5, "evt-5-1", "zeus", "olympus-gate"),
    ended("evt-5-3", 3, 5, "evt-5-1", "zeus", "arrived"),
    started("evt-20-4", 4, 20, "zeus", "great-hall"),
    hop("evt-20-5", 5, 20, "evt-20-4", "zeus", "great-hall"),
    ended("evt-20-6", 6, 20, "evt-20-4", "zeus", "arrived"),
  ];
  expect(journeysOf(events, STARTS).map((j) => [j.from, j.to])).toEqual([
    ["great-hall", "olympus-gate"],
    ["olympus-gate", "great-hall"],
  ]);
  // Without the authored places the first start is not known, and says so.
  expect(journeysOf(events, undefined)[0]?.from).toBeUndefined();
  expect(journeysOf(events, undefined)[1]?.from).toBe("olympus-gate");
});

test("a refused journey keeps the world's reason and moves nothing, a replaced one says so, and one with no ending is still travelling", () => {
  const events = [
    started("evt-5-1", 1, 5, "zeus", "pit"),
    ended("evt-5-2", 2, 5, "evt-5-1", "zeus", "refused", "restricted-realm"),
    started("evt-9-3", 3, 9, "hera", "tavern"),
    hop("evt-9-4", 4, 9, "evt-9-3", "hera", "olympus-gate"),
    ended("evt-10-5", 5, 10, "evt-9-3", "hera", "replaced"),
    started("evt-12-6", 6, 12, "hera", "forge"),
    hop("evt-12-7", 7, 12, "evt-12-6", "hera", "olympus-gate"),
  ];
  const journeys = journeysOf(events, STARTS);
  expect(journeys.map((j) => j.ending)).toEqual([
    { kind: "refused", reason: "restricted-realm", tick: 5 },
    { kind: "replaced", tick: 10 },
    undefined,
  ]);
  expect(journeys[0]?.hops).toEqual([]);
});

test("the counts say how many journeys started and how they ended, by kind, with each refusal's reason", () => {
  const events = [
    started("evt-5-1", 1, 5, "zeus", "pit"),
    ended("evt-5-2", 2, 5, "evt-5-1", "zeus", "refused", "restricted-realm"),
    started("evt-6-3", 3, 6, "hera", "tavern"),
    ended("evt-6-4", 4, 6, "evt-6-3", "hera", "arrived"),
    started("evt-7-5", 5, 7, "hera", "forge"),
    ended("evt-7-6", 6, 7, "evt-7-5", "hera", "arrived"),
    started("evt-9-7", 7, 9, "zeus", "forge"),
  ];
  const journeys = journeysOf(events, STARTS);
  expect(renderJourneyCounts(journeys)).toBe(
    "4 started: 2 arrived, 1 refused (restricted-realm), 0 replaced, 1 still travelling",
  );
  expect(renderJourneyCounts([])).toBe("none started");
});

test("the rendering lists each journey with its hops and ending, and says plainly when none was started", () => {
  const events = [
    started("evt-5-1", 1, 5, "zeus", "mountain-path"),
    hop("evt-5-2", 2, 5, "evt-5-1", "zeus", "olympus-gate"),
    hop("evt-6-3", 3, 6, "evt-5-1", "zeus", "mountain-path", "olympus-gate"),
    ended("evt-6-4", 4, 6, "evt-5-1", "zeus", "arrived"),
    started("evt-9-5", 5, 9, "hera", "pit"),
    ended("evt-9-6", 6, 9, "evt-9-5", "hera", "refused", "restricted-realm"),
  ];
  const text = renderJourneys(journeysOf(events, STARTS), (god) =>
    god === "zeus" ? "Zeus" : "Hera",
  );
  expect(text).toContain(
    "1. Zeus: great-hall → mountain-path, set out at tick 5, 2 hops, arrived at tick 6",
  );
  expect(text).toContain("   - tick 5: moved to olympus-gate");
  expect(text).toContain(
    "   - tick 6: crossed from olympus-gate to mountain-path",
  );
  expect(text).toContain(
    "2. Hera: great-hall → pit, set out at tick 9, 0 hops, refused at tick 9 (restricted-realm)",
  );
  expect(renderJourneys([], (god) => god)).toBe("No god set out on a journey.");
});
