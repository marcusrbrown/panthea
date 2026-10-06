import { expect, test } from "bun:test";
import type { WorldEvent } from "@panthea/contracts";
import {
  createPrng,
  decideRoutineProposal,
  runTick,
  type WorldState,
} from "@panthea/world";
import { loadGreekWorldState } from "./world-store";

type Wrong = Extract<WorldEvent, { kind: "wrong" }>;

/**
 * The authored Greek town on its own routines for `ticks` world ticks, no gods acting. `fed` gives every mortal
 * more food and coin than it can spend, so no hunger and no credit arise: the odds with hunger out of the picture.
 */
function town(
  ticks: number,
  seed: number,
  options: { multiplier?: number; fed?: boolean } = {},
) {
  let state: WorldState = loadGreekWorldState();
  if (options.multiplier !== undefined) {
    state = {
      ...state,
      rules: {
        ...state.rules,
        petitionBalance: {
          ...state.rules.petitionBalance,
          wrongNeedMultiplier: options.multiplier,
        },
      },
    };
  }
  if (options.fed === true) {
    const actors = new Map(state.actors);
    for (const [id, actor] of actors) {
      if (actor.isDeity === true) continue;
      actors.set(id, {
        ...actor,
        inventory: new Map([
          ...actor.inventory,
          ["food", 1000],
          ["currency", 1000],
        ]),
      });
    }
    state = { ...state, actors };
  }
  const start = state;
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
  const wrongs = events.filter((e): e is Wrong => e.kind === "wrong");
  const crossPatron = wrongs.filter(
    (w) => start.patrons.get(w.entityId) !== start.patrons.get(w.victim),
  );
  return { state, events, wrongs, crossPatron, start };
}

const SEEDS = [1, 2, 3, 4, 5];

test("a scripted 300-tick day gives at least three wrongs between mortals with different patrons, on every seed tried", () => {
  for (const seed of SEEDS) {
    const day = town(300, seed);
    expect([seed, day.crossPatron.length >= 3]).toEqual([seed, true]);
    // Each is a mortal wronging another of a different god: both are known, and the loss is on the record.
    for (const w of day.crossPatron) {
      expect(w.entityId).not.toBe(w.victim);
      expect(w.amount).toBeGreaterThan(0);
    }
  }
});

test("the guarantee does not rest on hunger: with every mortal fed, so no credit is struck, there are still at least three cross-patron wrongs on every seed", () => {
  for (const seed of SEEDS) {
    const day = town(300, seed, { fed: true });
    expect(day.events.some((e) => e.kind === "credit-extended")).toBe(false);
    expect(
      day.wrongs.some(
        (w) => w.wrong === "unpaid-debt" || w.wrong === "broken-agreement",
      ),
    ).toBe(false);
    expect([seed, day.crossPatron.length >= 3]).toEqual([seed, true]);
  }
});

test("hunger raises the count: with the need multiplier at 1 the same seeds wrong less, in total over the seeds", () => {
  const total = (options: { multiplier?: number }) =>
    SEEDS.reduce(
      (sum, seed) => sum + town(300, seed, options).wrongs.length,
      0,
    );
  expect(total({ multiplier: 1 })).toBeLessThan(total({}));
});

test("the same seed does the same wrongs, event for event, and a different seed does others", () => {
  const first = town(300, 1);
  const again = town(300, 1);
  const shape = (day: ReturnType<typeof town>) =>
    day.wrongs.map((w) => [w.tick, w.entityId, w.victim, w.wrong, w.amount]);
  expect(shape(again)).toEqual(shape(first));
  expect(again.state).toEqual(first.state);
  expect(shape(town(300, 2))).not.toEqual(shape(first));
});
