// Which god takes the next turn. The picking function is pure: it is given the
// gods that may take a turn, what the world says each one is waiting on, and the
// rotation's memory (who was served last and how many times each god has been
// passed over), and it says who goes next and what the memory becomes. Nothing
// here reads a clock, a store, or a prompt.

import { expect, test } from "bun:test";
import { toEntityId } from "@panthea/world";
import {
  type GodSignals,
  type Pick,
  pickGod,
  type Rotation,
  SKIP_CAP,
  START_OF_ROTATION,
} from "./scheduler";

const id = toEntityId;

const GODS = [
  "athena",
  "hades",
  "hephaestus",
  "hera",
  "hermes",
  "poseidon",
  "zeus",
] as const;

/** A god with nothing waiting on it. */
const idle = (god: string): GodSignals => ({
  god: id(god),
  obligationDeadline: undefined,
  awaited: false,
});
/** A god that owes something accepted, due at `deadline`. */
const owing = (god: string, deadline: number): GodSignals => ({
  god: id(god),
  obligationDeadline: deadline,
  awaited: false,
});
/** A god a thread is waiting on for an answer. */
const awaited = (god: string): GodSignals => ({
  god: id(god),
  obligationDeadline: undefined,
  awaited: true,
});

const everyone = (...overrides: GodSignals[]): GodSignals[] =>
  GODS.map(
    (god) => overrides.find((signal) => signal.god === god) ?? idle(god),
  );

function picked(pick: Pick | undefined): string {
  if (pick === undefined) throw new Error("expected a god to be picked");
  return pick.god;
}

// --- The tiers ---------------------------------------------------------------------------------------

test("a god that owes something goes ahead of an idle god that comes earlier in id order", () => {
  const pick = pickGod(
    [idle("athena"), idle("hera"), owing("zeus", 500)],
    START_OF_ROTATION,
  );
  expect(picked(pick)).toBe("zeus");
  expect(pick?.why).toBe("obligation");
  // Control: with the debt gone, the same gods go in id order.
  expect(
    picked(
      pickGod([idle("athena"), idle("hera"), idle("zeus")], START_OF_ROTATION),
    ),
  ).toBe("athena");
});

test("whatever its deadline, an accepted obligation outranks everything below it: a debt due in a thousand ticks goes ahead of a thread waiting on an answer", () => {
  const pick = pickGod(
    [awaited("athena"), owing("zeus", 100_000), idle("hera")],
    START_OF_ROTATION,
  );
  expect(picked(pick)).toBe("zeus");
});

test("of two gods who owe, the earlier deadline goes first, whichever comes first in id order or after the cursor", () => {
  const signals = [owing("athena", 400), owing("zeus", 150), idle("hera")];
  expect(picked(pickGod(signals, START_OF_ROTATION))).toBe("zeus");
  // The cursor does not decide it: it sits just before athena, and zeus still goes first.
  expect(
    picked(pickGod(signals, { lastServed: id("aaa"), skips: new Map() })),
  ).toBe("zeus");
  // And the other way round.
  expect(
    picked(
      pickGod([owing("athena", 150), owing("zeus", 400)], START_OF_ROTATION),
    ),
  ).toBe("athena");
});

test("owing gods with the same deadline go by id order from the cursor", () => {
  const signals = [
    owing("athena", 300),
    owing("hera", 300),
    owing("zeus", 300),
  ];
  expect(picked(pickGod(signals, START_OF_ROTATION))).toBe("athena");
  expect(
    picked(pickGod(signals, { lastServed: id("athena"), skips: new Map() })),
  ).toBe("hera");
  expect(
    picked(pickGod(signals, { lastServed: id("hera"), skips: new Map() })),
  ).toBe("zeus");
  // After the last in id order the cursor wraps.
  expect(
    picked(pickGod(signals, { lastServed: id("zeus"), skips: new Map() })),
  ).toBe("athena");
});

test("a god a thread is waiting on goes ahead of an idle god, and after a god that owes", () => {
  expect(
    picked(
      pickGod(
        [idle("athena"), awaited("hera"), idle("zeus")],
        START_OF_ROTATION,
      ),
    ),
  ).toBe("hera");
  const both = pickGod(
    [idle("athena"), awaited("hera"), owing("zeus", 900)],
    START_OF_ROTATION,
  );
  expect(picked(both)).toBe("zeus");
  expect(both?.why).toBe("obligation");
  const second = pickGod([idle("athena"), awaited("hera")], START_OF_ROTATION);
  expect(second?.why).toBe("awaiting");
});

test("a god that both owes and is awaited is in the higher tier", () => {
  const pick = pickGod(
    [
      awaited("athena"),
      { god: id("hera"), obligationDeadline: 800, awaited: true },
    ],
    START_OF_ROTATION,
  );
  expect(picked(pick)).toBe("hera");
  expect(pick?.why).toBe("obligation");
});

test("gods waited on for an answer go by id order from the cursor", () => {
  const signals = [awaited("athena"), awaited("hera"), awaited("zeus")];
  expect(
    picked(pickGod(signals, { lastServed: id("athena"), skips: new Map() })),
  ).toBe("hera");
});

// --- With nothing urgent, today's round-robin --------------------------------------------------------

/** The rule the runner used before this: the next eligible god after the one served last, in id order, wrapping. */
function roundRobin(
  eligible: readonly string[],
  lastServed: string | undefined,
): string | undefined {
  const sorted = [...eligible].sort();
  return (
    sorted.find((god) => lastServed === undefined || god > lastServed) ??
    sorted[0]
  );
}

test("with nothing urgent the order is the round-robin it replaces, over many turns", () => {
  let rotation: Rotation = START_OF_ROTATION;
  let reference: string | undefined;
  const order: string[] = [];
  for (let turn = 0; turn < 30; turn += 1) {
    const pick = pickGod(everyone(), rotation);
    const want = roundRobin(GODS, reference);
    expect([turn, picked(pick)]).toEqual([turn, want as string]);
    order.push(picked(pick));
    rotation = (pick as Pick).rotation;
    reference = want;
  }
  expect(order.slice(0, 8)).toEqual([...GODS, "athena"]);
});

test("with nothing urgent it is still that round-robin when gods come and go (a pending proposal, a death), over a long random run", () => {
  const random = lcg(7);
  let rotation: Rotation = START_OF_ROTATION;
  let reference: string | undefined;
  for (let turn = 0; turn < 500; turn += 1) {
    const here = GODS.filter(() => random() > 0.3);
    if (here.length === 0) continue;
    const pick = pickGod(here.map(idle), rotation);
    const want = roundRobin(here, reference);
    expect([turn, picked(pick)]).toEqual([turn, want as string]);
    expect(pick?.forced).toBe(false);
    rotation = (pick as Pick).rotation;
    reference = want;
  }
});

// --- Eligibility ----------------------------------------------------------------------------------------

test("only a god that was offered can be picked, and nobody is picked when nobody is offered", () => {
  expect(pickGod([], START_OF_ROTATION)).toBeUndefined();
  const eligible = [idle("hera"), owing("zeus", 10)];
  for (let turn = 0; turn < 20; turn += 1) {
    const pick = pickGod(eligible, START_OF_ROTATION);
    expect(["hera", "zeus"]).toContain(picked(pick));
  }
  // A god the caller left out (it has a pending proposal) is not in the answer, owing or not.
  const without = pickGod([idle("athena"), idle("hera")], START_OF_ROTATION);
  expect(picked(without)).not.toBe("zeus");
});

// --- The skip cap -------------------------------------------------------------------------------------------

/** A small deterministic random source. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

/** Runs `turns` picks over signals chosen by `signalsAt`, and returns, for each god, the longest run of picks it was eligible for and not served in. */
function longestSkips(
  turns: number,
  signalsAt: (turn: number) => GodSignals[],
): { runs: Map<string, number>; served: string[] } {
  let rotation: Rotation = START_OF_ROTATION;
  const run = new Map<string, number>();
  const worst = new Map<string, number>();
  const served: string[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    const eligible = signalsAt(turn);
    if (eligible.length === 0) continue;
    const pick = pickGod(eligible, rotation);
    rotation = (pick as Pick).rotation;
    served.push(picked(pick));
    for (const signal of eligible) {
      if (signal.god === picked(pick)) {
        run.set(signal.god, 0);
      } else {
        const next = (run.get(signal.god) ?? 0) + 1;
        run.set(signal.god, next);
        worst.set(signal.god, Math.max(worst.get(signal.god) ?? 0, next));
      }
    }
    // A god that was not offered has no streak.
    for (const god of [...run.keys()]) {
      if (!eligible.some((signal) => signal.god === god)) run.delete(god);
    }
  }
  return { runs: worst, served };
}

test("the cap is seven: one full round of seven", () => {
  expect(SKIP_CAP).toBe(7);
});

test("a starved idle god is served by its eighth chance at the latest, even with a god that owes always present", () => {
  // Athena is idle and first in id order, and zeus owes something every single turn.
  const { served, runs } = longestSkips(60, () => [
    idle("athena"),
    idle("hera"),
    owing("zeus", 5),
  ]);
  expect(runs.get("athena")).toBeLessThanOrEqual(SKIP_CAP);
  expect(runs.get("hera")).toBeLessThanOrEqual(SKIP_CAP);
  // Zeus is served more often than the others, since it is the urgent one.
  const count = (god: string) => served.filter((s) => s === god).length;
  expect(count("zeus")).toBeGreaterThan(count("athena"));
  expect(count("athena")).toBeGreaterThan(0);
});

test("with seven gods and only one of them idle, that god is served within eight picks of the start, whatever the others owe", () => {
  const signals = everyone(
    ...GODS.filter((god) => god !== "hades").map((god, i) =>
      owing(god, 100 + i),
    ),
  );
  let rotation: Rotation = START_OF_ROTATION;
  let turns = 0;
  for (; turns < 20; turns += 1) {
    const pick = pickGod(signals, rotation);
    rotation = (pick as Pick).rotation;
    if (picked(pick) === "hades") break;
  }
  // The eighth chance at the latest: seven passes, then served.
  expect(turns + 1).toBeLessThanOrEqual(SKIP_CAP + 1);
});

test("several starved gods at once all keep to the cap: two that always owe, one awaited, four idle, over a long run", () => {
  const { runs, served } = longestSkips(400, () =>
    everyone(owing("zeus", 10), owing("poseidon", 20), awaited("hera")),
  );
  for (const god of GODS) {
    expect(runs.get(god) ?? 0).toBeLessThanOrEqual(SKIP_CAP);
  }
  // Everyone was served, and the urgent gods more than their share.
  for (const god of GODS) expect(served).toContain(god);
  const count = (god: string) => served.filter((s) => s === god).length;
  expect(count("zeus")).toBeGreaterThan(count("hades"));
  expect(count("hera")).toBeGreaterThanOrEqual(count("hades"));
});

test("no god, urgent or idle, is ever passed over more than seven times in a row, however the urgency flips from turn to turn: a long random run of gods that owe, are awaited, come and go", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const random = lcg(seed);
    const { runs } = longestSkips(600, () => {
      // Between five and seven gods are offered each turn, with random urgency.
      const here = GODS.filter(() => random() > 0.15);
      return here.map((god) => {
        const roll = random();
        return roll < 0.35
          ? owing(god, Math.floor(random() * 500))
          : roll < 0.6
            ? awaited(god)
            : idle(god);
      });
    });
    for (const [god, worst] of runs) {
      expect([seed, god, worst <= SKIP_CAP]).toEqual([seed, god, true]);
    }
  }
});

test("a god served is passed over again from nothing: its count restarts, and a god not offered for a turn loses its streak", () => {
  const first = pickGod([idle("athena"), idle("hera")], START_OF_ROTATION);
  expect(first?.rotation.skips.get(id("hera"))).toBe(1);
  expect(first?.rotation.skips.has(id("athena"))).toBe(false);
  const second = pickGod(
    [idle("athena"), idle("hera")],
    (first as Pick).rotation,
  );
  expect(picked(second)).toBe("hera");
  expect(second?.rotation.skips.get(id("athena"))).toBe(1);
  // Hera is not offered next time (a pending proposal): its streak is gone, and so is any count for a god never seen.
  const third = pickGod([idle("athena")], (second as Pick).rotation);
  expect(third?.rotation.skips.size).toBe(0);
  expect(third?.rotation.skips.has(id("hera"))).toBe(false);
});

test("a god already at the cap goes first, ahead of every tier, and is marked as forced", () => {
  const rotation: Rotation = {
    lastServed: id("athena"),
    skips: new Map([[id("hera"), SKIP_CAP]]),
  };
  const pick = pickGod(
    [idle("hera"), owing("zeus", 1), awaited("hades")],
    rotation,
  );
  expect(picked(pick)).toBe("hera");
  expect(pick?.forced).toBe(true);
  // One short of the cap, the tiers still decide.
  const nearly: Rotation = {
    lastServed: id("athena"),
    skips: new Map([[id("hera"), SKIP_CAP - 1]]),
  };
  expect(picked(pickGod([idle("hera"), owing("zeus", 1)], nearly))).toBe(
    "zeus",
  );
});

test("more gods than a round of seven can hold: the pick is still the god passed over most, and nothing throws", () => {
  // Nine gods that are always offered cannot all be served within eight picks; the god waited longest goes first.
  const nine = [...GODS, "iris", "nike"].map(idle);
  let rotation: Rotation = START_OF_ROTATION;
  const served: string[] = [];
  for (let turn = 0; turn < 27; turn += 1) {
    const pick = pickGod(nine, rotation);
    served.push(picked(pick));
    rotation = (pick as Pick).rotation;
  }
  // Each of the nine is served three times in 27 picks.
  for (const signal of nine) {
    expect(served.filter((god) => god === signal.god)).toHaveLength(3);
  }
});

test("the memory is not changed by a pick: the rotation passed in is as it was", () => {
  const rotation: Rotation = {
    lastServed: id("hades"),
    skips: new Map([[id("hera"), 3]]),
  };
  pickGod(everyone(owing("zeus", 5)), rotation);
  expect(rotation.lastServed).toBe(id("hades"));
  expect([...rotation.skips]).toEqual([[id("hera"), 3]]);
});

test("a restart is a fresh rotation: the start has no one served and no one passed over", () => {
  expect(START_OF_ROTATION.lastServed).toBeUndefined();
  expect(START_OF_ROTATION.skips.size).toBe(0);
  // From it the first god in id order goes, whoever owes nothing.
  expect(picked(pickGod(everyone(), START_OF_ROTATION))).toBe("athena");
});
