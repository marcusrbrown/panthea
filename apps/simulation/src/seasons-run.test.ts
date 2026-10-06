import { expect, test } from "bun:test";
import type { WorldEvent } from "@panthea/contracts";
import {
  createPrng,
  decideRoutineProposal,
  runTick,
  seasonAt,
  type WorldState,
} from "@panthea/world";
import { loadGreekWorldState } from "./world-store";

type Trouble = Extract<WorldEvent, { kind: "trouble" }>;

/** The authored Greek town on its own routines for `ticks` world ticks, no gods acting. */
function town(ticks: number, seed: number) {
  let state: WorldState = loadGreekWorldState();
  let prng = createPrng(seed);
  const mortals = [...state.actors.values()]
    .filter((actor) => actor.isDeity !== true)
    .map((actor) => actor.id);
  const events: WorldEvent[] = [];
  for (let n = 0; n < ticks; n += 1) {
    const proposals = mortals.flatMap((mortal) => {
      const decision = decideRoutineProposal(state, mortal);
      return decision ? [decision.proposal] : [];
    });
    const ran = runTick(state, prng, proposals);
    state = ran.state;
    prng = ran.prng;
    events.push(...ran.events);
  }
  return {
    state,
    events,
    troubles: events.filter((e): e is Trouble => e.kind === "trouble"),
  };
}

const SEEDS = [1, 2, 3, 4, 5];
const GODS = [
  "athena",
  "hades",
  "hephaestus",
  "hera",
  "hermes",
  "poseidon",
  "zeus",
];

test("every god's domain trouble occurs in every 150-tick floor window of a 300-tick episode, on every seed tried (SC2)", () => {
  for (const seed of SEEDS) {
    const day = town(299, seed);
    for (const god of GODS) {
      for (const [from, to] of [
        [0, 150],
        [150, 300],
      ] as const) {
        const held = day.troubles.filter(
          (e) => e.god === god && e.tick >= from && e.tick < to,
        );
        expect([seed, god, from, held.length >= 1]).toEqual([
          seed,
          god,
          from,
          true,
        ]);
      }
    }
  }
});

test("a trouble is a loss the afflicted prays about to the domain god: over five 300-tick episodes every god is prayed to about a trouble of its own, and most troubles are prayed about", () => {
  // Per episode a god can miss: a late trouble is still unprayed when the episode ends, and a mortal prays about its
  // newest cause first, behind a cooldown. The sum over the seeds is what holds, untuned.
  const prayed = new Map<string, number>(GODS.map((god) => [god, 0]));
  let troubles = 0;
  let prayers = 0;
  for (const seed of SEEDS) {
    const day = town(300, seed);
    const ids = new Map(day.troubles.map((e) => [e.id, e]));
    troubles += day.troubles.length;
    for (const petition of day.state.petitions.values()) {
      const trouble = ids.get(petition.cause);
      if (trouble === undefined) continue;
      prayers += 1;
      // The prayer goes to the trouble's god, whoever the afflicted's patron is.
      expect(petition.god).toBe(trouble.god);
      prayed.set(trouble.god, (prayed.get(trouble.god) ?? 0) + 1);
    }
  }
  for (const god of GODS) {
    expect([god, (prayed.get(god) ?? 0) >= 1]).toEqual([god, true]);
  }
  expect(prayers / troubles).toBeGreaterThan(0.5);
});

test("a season turns inside a 300-tick episode, from the authored defaults: summer at tick 200", () => {
  for (const seed of SEEDS) {
    const day = town(300, seed);
    const turns = day.events.filter((e) => e.kind === "season-turned");
    expect(
      turns.map((e) => [e.tick, e.kind === "season-turned" ? e.season : ""]),
    ).toEqual([[200, "summer"]]);
    // The season's odds are in play: a trouble records the season it fell in.
    for (const trouble of day.troubles) {
      expect(trouble.season).toBe(
        seasonAt(loadGreekWorldState(), trouble.tick),
      );
    }
  }
});

test("the director fires on its own clock, once every interval, whatever else happens", () => {
  const day = town(300, 1);
  const own = day.events.filter(
    (e) =>
      ((e.kind === "theft" || e.kind === "stock-spoiled") &&
        e.cause === "director") ||
      (e.kind === "building-ignited" && e.cause.kind === "director"),
  );
  expect(own.map((e) => e.tick)).toEqual([120, 240]);
});

test("the season's odds add troubles on top of the floor, and the floor is most of them: over five 300-tick episodes, some troubles come by season and more by floor", () => {
  const all = SEEDS.flatMap((seed) => town(300, seed).troubles);
  const bySeason = all.filter((e) => e.source === "season").length;
  const byFloor = all.filter((e) => e.source === "floor").length;
  expect(bySeason).toBeGreaterThanOrEqual(10);
  expect(byFloor).toBeGreaterThan(bySeason);
  // Season-sourced troubles fall in more than one season: the odds change as the season does.
  const seasons = new Set(
    all.filter((e) => e.source === "season").map((e) => e.season),
  );
  expect(seasons.size).toBeGreaterThanOrEqual(2);
});
