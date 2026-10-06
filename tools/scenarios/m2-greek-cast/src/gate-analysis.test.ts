import { expect, test } from "bun:test";
import type { StoredEvent } from "./checks";
import {
  crossPatronWrongs,
  episodeMetrics,
  foodChecks,
  foodFailureLines,
  type GateEpisode,
  gateChecks,
  godThreadOverHarmCheck,
  initiativeChecks,
  MAX_FOOD_FAILURE_LINES,
  mortalWrongCheck,
  ownThreads,
} from "./gate-analysis";
import type { RealProposal } from "./real-analysis";

let n = 0;
/** A stored event of `kind` at `sequence`, with its fields. */
const event = (
  kind: string,
  sequence: number,
  fields: Record<string, unknown> = {},
  tick = sequence,
): StoredEvent => ({
  id: `evt-${tick}-${++n}`,
  sequence,
  tick,
  kind,
  ...fields,
});

const GODS = ["zeus", "hera", "athena", "poseidon"];
const AUTHORED = new Map([
  ["lykos", "hermes"],
  ["doris", "poseidon"],
  ["ismene", "poseidon"],
]);
const episode = (
  events: readonly StoredEvent[],
  proposals: readonly RealProposal[] = [],
  index = 1,
): GateEpisode => ({ index, events, proposals });

// --- Food (SC1) --------------------------------------------------------------------------

const hungry = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    event("unmet-need", i + 1, { entityId: "farmer", resource: "food" }),
  );

const prayer = (sequence: number, resource: string, god = "zeus") =>
  event("petition-opened", sequence, {
    entityId: "farmer",
    god,
    cause: "evt-0-0",
    request: { kind: "help", need: { kind: "resource", resource } },
  });

test("food failure lines: 250 pass and 251 fail, and only food counts", () => {
  const lines = (count: number) =>
    foodChecks(hungry(count)).find((c) => c.name === "food failure lines");
  expect(MAX_FOOD_FAILURE_LINES).toBe(250);
  expect(lines(250)?.ok).toBe(true);
  expect(lines(251)?.ok).toBe(false);
  expect(lines(251)?.detail).toContain("251");
  // A need for something else is no food failure line.
  const other = [
    ...hungry(3),
    event("unmet-need", 9, { entityId: "farmer", resource: "wine" }),
  ];
  expect(foodFailureLines(other)).toBe(3);
});

test("food prayer share: fewer than half of all prayers pass, exactly half fails, none at all is not a failure, and a prayer for goods a strike took counts as food", () => {
  const share = (food: number, other: number) =>
    foodChecks([
      ...Array.from({ length: food }, (_, i) => prayer(i + 1, "food")),
      ...Array.from({ length: other }, (_, i) => prayer(i + 50, "planks")),
    ]).find((c) => c.name === "food prayer share");
  expect(share(2, 3)?.ok).toBe(true);
  expect(share(3, 3)?.ok).toBe(false);
  expect(share(4, 1)?.ok).toBe(false);
  expect(share(0, 4)?.ok).toBe(true);
  expect(share(0, 0)?.ok).toBe(true);
  expect(share(3, 3)?.detail).toBe(
    "3 of 6 prayers are about food (fewer than half)",
  );
  // A punish prayer is not about food.
  const punish = event("petition-opened", 1, {
    request: { kind: "punish", offender: "lykos", buildings: [] },
  });
  expect(
    foodChecks([punish]).find((c) => c.name === "food prayer share")?.ok,
  ).toBe(true);
});

// --- A wrong between mortals (SC3) -----------------------------------------------------

const wrong = (sequence: number, fields: Record<string, unknown> = {}) =>
  event("wrong", sequence, {
    entityId: "lykos",
    victim: "doris",
    wrong: "theft",
    ...fields,
  });

test("a wrong between mortals of different patrons that reaches the victim's patron and is answered is a consequence (SC3)", () => {
  const w = wrong(1);
  const prayed = event("petition-opened", 2, {
    entityId: "doris",
    god: "poseidon",
    cause: w.id,
  });
  const answered = event("petition-answered", 3, {
    entityId: "doris",
    god: "poseidon",
    petitionId: prayed.id,
  });
  const ep = episode([w, prayed, answered]);
  expect(crossPatronWrongs(ep, AUTHORED)).toMatchObject([
    {
      wrong: w.id,
      victimPatron: "poseidon",
      wrongdoerPatron: "hermes",
      prayer: prayed.id,
      consequences: ["punished"],
    },
  ]);
  expect(mortalWrongCheck([ep], AUTHORED).ok).toBe(true);
  expect(mortalWrongCheck([ep], AUTHORED).detail).toContain(
    "1 with a consequence",
  );
});

test("SC3 holds on revenge or a defection too, and fails on a wrong nobody prayed about, one between worshippers of the same patron, one whose prayer went nowhere, or a prayer to another god", () => {
  const w = wrong(1);
  const prayed = event("petition-opened", 2, {
    entityId: "doris",
    god: "poseidon",
    cause: w.id,
  });
  const revenge = event("wrong", 3, {
    entityId: "doris",
    victim: "lykos",
    wrong: "feud",
    revenge: w.id,
  });
  expect(mortalWrongCheck([episode([w, prayed, revenge])], AUTHORED).ok).toBe(
    true,
  );
  const defected = event("patron-changed", 4, {
    entityId: "doris",
    from: "poseidon",
    to: "athena",
  });
  expect(mortalWrongCheck([episode([w, prayed, defected])], AUTHORED).ok).toBe(
    true,
  );
  // A defection before the wrong is no consequence of it: by then the victim's patron is the god it went to.
  const early = event("patron-changed", 0, {
    entityId: "doris",
    from: "poseidon",
    to: "athena",
  });
  const toAthena = event("petition-opened", 2, {
    entityId: "doris",
    god: "athena",
    cause: w.id,
  });
  expect(
    crossPatronWrongs(episode([early, w, toAthena]), AUTHORED),
  ).toMatchObject([
    { victimPatron: "athena", prayer: toAthena.id, consequences: [] },
  ]);
  // Reached with nothing after it: the check fails, naming the counts.
  const silent = mortalWrongCheck([episode([w, prayed])], AUTHORED);
  expect(silent.ok).toBe(false);
  expect(silent.detail).toContain(
    "1 prayed to the victim's patron, 0 with a consequence",
  );
  // Never prayed about.
  expect(mortalWrongCheck([episode([w])], AUTHORED).ok).toBe(false);
  // The prayer went to a god that is not the victim's patron.
  const astray = event("petition-opened", 2, {
    entityId: "doris",
    god: "zeus",
    cause: w.id,
  });
  expect(mortalWrongCheck([episode([w, astray, revenge])], AUTHORED).ok).toBe(
    false,
  );
  // Two worshippers of one patron: no cross-patron wrong at all.
  const same = wrong(1, { entityId: "ismene", victim: "doris" });
  expect(crossPatronWrongs(episode([same, prayed]), AUTHORED)).toEqual([]);
});

// --- A thread between gods over a worshipper's harm or a defection (SC4) ---------------

test("a demand citing a strike's harm, or a contest citing a defection, counts; a demand over another cause does not", () => {
  const struck = event("mortal-struck", 1, {
    entityId: "lykos",
    actor: "poseidon",
  });
  const changed = event("patron-changed", 2, { entityId: "doris" });
  const demand = event("practice-opened", 3, {
    entityId: "hermes",
    counterparty: "poseidon",
    causes: [struck.id],
  });
  const contest = event("contest-opened", 4, {
    entityId: "poseidon",
    rival: "athena",
    cause: changed.id,
  });
  const otherDemand = event("practice-opened", 5, {
    entityId: "zeus",
    counterparty: "hera",
    causes: ["evt-9-9"],
  });
  expect(godThreadOverHarmCheck([episode([struck, demand])]).ok).toBe(true);
  expect(godThreadOverHarmCheck([episode([changed, contest])]).ok).toBe(true);
  expect(godThreadOverHarmCheck([episode([struck, otherDemand])]).ok).toBe(
    false,
  );
  expect(godThreadOverHarmCheck([episode([struck])]).detail).toContain(
    "0 demands",
  );
});

// --- Initiative (R19, SC5) -------------------------------------------------------------

const demandBy = (god: string, toward: string, sequence: number) =>
  event("practice-opened", sequence, {
    entityId: god,
    counterparty: toward,
    practice: "demand",
    causes: ["evt-0-1"],
  });

const contestBy = (god: string, rival: string, sequence: number) =>
  event("contest-opened", sequence, { entityId: god, rival, cause: "evt-0-1" });

const everyGod = [
  demandBy("zeus", "hera", 1),
  demandBy("hera", "zeus", 2),
  contestBy("athena", "poseidon", 3),
  contestBy("poseidon", "athena", 4),
];

test("every god opens a demand or a contest toward another god: all four pass, naming what each opened", () => {
  const checks = initiativeChecks([episode(everyGod)], GODS);
  expect(checks.map((c) => [c.name, c.ok])).toEqual([
    ["initiative: zeus", true],
    ["initiative: hera", true],
    ["initiative: athena", true],
    ["initiative: poseidon", true],
  ]);
  expect(checks[2]?.detail).toContain("1 contests");
});

test("initiative is counted across the episodes, not in each: a god that opened its one thread in one of three episodes meets it", () => {
  const checks = initiativeChecks(
    [
      episode(
        [
          everyGod[0] as StoredEvent,
          everyGod[2] as StoredEvent,
          everyGod[3] as StoredEvent,
        ],
        [],
        1,
      ),
      episode([], [], 2),
      episode([everyGod[1] as StoredEvent], [], 3),
    ],
    GODS,
  );
  expect(checks.every((c) => c.ok)).toBe(true);
  expect(checks[1]?.detail).toContain("episode 3");
});

test("the positive control: with a god's threads removed the initiative check fails for that god and no other", () => {
  const sabotaged = everyGod.filter((e) => e.entityId !== "athena");
  const checks = initiativeChecks([episode(sabotaged)], GODS);
  expect(checks.map((c) => [c.name, c.ok])).toEqual([
    ["initiative: zeus", true],
    ["initiative: hera", true],
    ["initiative: athena", false],
    ["initiative: poseidon", true],
  ]);
  expect(checks[2]?.detail).toContain(
    "no demand or contest toward another god",
  );
});

test("answering a prayer is not initiative: a god whose only thread is a prayer answer, a blessing, or terms offered to a mortal fails", () => {
  const prayed = event("petition-opened", 1, {
    entityId: "farmer",
    god: "athena",
  });
  const answer = event("petition-answered", 2, {
    entityId: "farmer",
    god: "athena",
    petitionId: prayed.id,
  });
  const blessing = event("blessing-granted", 3, {
    entityId: "athena",
    recipient: "farmer",
  });
  // Terms offered to the mortal who prayed: a supplication, its counterparty a mortal.
  const terms = event("practice-opened", 4, {
    entityId: "athena",
    counterparty: "farmer",
    practice: "supplication",
    petition: prayed.id,
    causes: [],
  });
  const checks = initiativeChecks(
    [episode([prayed, answer, blessing, terms])],
    ["athena"],
  );
  expect(checks[0]?.ok).toBe(false);
  expect(
    ownThreads([episode([prayed, answer, blessing, terms])], GODS),
  ).toEqual([]);
  // A demand of a mortal's patron, or a contest against a mortal, is not toward another god either.
  expect(
    ownThreads(
      [
        episode([
          demandBy("athena", "farmer", 5),
          contestBy("athena", "farmer", 6),
        ]),
      ],
      GODS,
    ),
  ).toEqual([]);
});

test("a demand or contest the world refused is logged and never counted: the detail names why", () => {
  const refused: RealProposal = {
    proposalId: "p1",
    actor: "athena",
    kind: "practice",
    observationId: "obs-1",
    proposal: { kind: "practice", move: "contest", cause: "evt-1-1" },
    outcome: "rejected",
    reason: "no-progress",
  };
  const [check] = initiativeChecks([episode([], [refused])], ["athena"]);
  expect(check?.ok).toBe(false);
  expect(check?.detail).toContain("1 proposed and not committed (no-progress)");
  // A committed one is not logged as refused, and a god's other proposals are not either.
  const other = { ...refused, kind: "bless", proposal: { kind: "bless" } };
  expect(
    initiativeChecks([episode([], [other])], ["athena"])[0]?.detail,
  ).toContain("0 proposed and not committed");
});

test("the gate's checks run across the episodes: wrongs, threads over harm, and each god's initiative", () => {
  const checks = gateChecks([episode(everyGod)], GODS, AUTHORED);
  expect(checks.map((c) => c.name)).toEqual([
    "mortal wrong",
    "god thread over harm or defection",
    "initiative: zeus",
    "initiative: hera",
    "initiative: athena",
    "initiative: poseidon",
  ]);
  // Nothing happened between mortals, and no thread cites a harm: those two fail, initiative holds.
  expect(checks.map((c) => c.ok)).toEqual([
    false,
    false,
    true,
    true,
    true,
    true,
  ]);
});

// --- What the transcripts report ----------------------------------------------------------

test("the episode metrics: food, troubles by god, defections, wrongs, and the ticks from a cause to its prayer's closing", () => {
  const cause = event("stock-spoiled", 1, { entityId: "doris" }, 10);
  const opened = event(
    "petition-opened",
    2,
    {
      entityId: "doris",
      god: "hera",
      cause: cause.id,
      request: { kind: "help", need: { kind: "resource", resource: "food" } },
    },
    15,
  );
  const lapsed = event(
    "petition-lapsed",
    3,
    { entityId: "doris", god: "hera", petitionId: opened.id },
    165,
  );
  const cause2 = event("trouble", 4, { entityId: "ismene", god: "athena" }, 20);
  const opened2 = event(
    "petition-opened",
    5,
    {
      entityId: "ismene",
      god: "athena",
      cause: cause2.id,
      request: { kind: "help", need: { kind: "resource", resource: "planks" } },
    },
    22,
  );
  const answered = event(
    "petition-answered",
    6,
    { entityId: "ismene", god: "athena", petitionId: opened2.id },
    40,
  );
  const metrics = episodeMetrics(
    episode([
      cause,
      opened,
      lapsed,
      cause2,
      opened2,
      answered,
      event("trouble", 7, { god: "athena" }),
      event("trouble", 8, { god: "zeus" }),
      event("patron-changed", 9, {
        entityId: "doris",
        from: "poseidon",
        to: "athena",
      }),
      ...hungry(2).map((e, i) => ({ ...e, sequence: 20 + i })),
    ]),
    AUTHORED,
  );
  expect(metrics).toMatchObject({
    foodFailureLines: 2,
    prayers: 2,
    foodPrayers: 1,
    troublesByGod: { athena: 2, zeus: 1 },
    defections: 1,
    wrongs: 0,
    causeToAnswer: { closed: 2, byOutcome: { lapsed: 1, answered: 1 } },
  });
  // Ticks from cause to closing: 155 (lapsed) and 20 (answered).
  expect(metrics.causeToAnswer.medianTicks).toBe(155);
  expect(metrics.causeToAnswer.p95Ticks).toBe(155);
  // A prayer still open at the end has no closing and no wait.
  expect(
    episodeMetrics(episode([cause, opened]), AUTHORED).causeToAnswer,
  ).toMatchObject({ closed: 0, medianTicks: undefined });
});
