// What prayableCauses and the prayer cooldown read of the petitions: the work
// must not grow with how many petitions the world has ever held (they are never
// pruned, and a mortal asks about them on every tick), and the answers must be
// exactly the ones a plain scan of the petitions gives.

import { expect, test } from "bun:test";
import type { ContentPack, EventId } from "@panthea/contracts";
import { applyEvent } from "./actions";
import { prayableCauses } from "./petitions";
import {
  createInitialWorldState,
  getActor,
  type Petition,
  toEntityId,
  type WorldState,
  withActor,
} from "./state";

const id = toEntityId;
const evt = (text: string) => text as EventId;

function pack(): ContentPack {
  const mortal = (name: string) => ({
    id: name,
    sprite: `placeholder-${name}`,
    name,
    locationId: "square",
    drives: { thrift: 0, appetite: 0, greed: 0, piety: 0.5 },
    startingInventory: [{ resource: "food", amount: 5 }],
  });
  return {
    schemaVersion: 1,
    realms: ["mortal", "olympus"],
    resources: [],
    locations: [
      { id: "square", realm: "mortal", name: "Square", edges: [] },
      { id: "hall", realm: "olympus", name: "Hall", edges: [] },
    ],
    buildings: [],
    inhabitants: [
      mortal("farmer"),
      mortal("woodcutter"),
      {
        id: "zeus",
        sprite: "placeholder-zeus",
        name: "zeus",
        locationId: "hall",
        deity: true,
        startingInventory: [{ resource: "divinity", amount: 10 }],
      },
    ],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: {
        igniteThreshold: 3,
        intensityGrowthPerTick: 1,
        destroyIntensity: 50,
      },
      economyBalance: { consumeAmount: 1, value_food: 3, value_currency: 1 },
    },
    recipes: {},
  };
}

/** A Map that counts every way it can be walked, so a test can say how many times it was. */
class CountingMap<K, V> extends Map<K, V> {
  walks = 0;
  override values() {
    this.walks += 1;
    return super.values();
  }
  override entries() {
    this.walks += 1;
    return super.entries();
  }
  override keys() {
    this.walks += 1;
    return super.keys();
  }
  override forEach(...args: Parameters<Map<K, V>["forEach"]>) {
    this.walks += 1;
    return super.forEach(...args);
  }
  override [Symbol.iterator]() {
    this.walks += 1;
    return super[Symbol.iterator]();
  }
}

let counter = 0;
function petition(
  overrides: Partial<Petition> & Pick<Petition, "petitioner">,
): Petition {
  counter += 1;
  return {
    id: `evt-p-${counter}` as EventId,
    god: id("zeus"),
    cause: `evt-c-${counter}` as EventId,
    about: {
      eventId: `evt-c-${counter}` as EventId,
      tick: 0,
      kind: "need",
      resource: "food",
    },
    request: { kind: "help", need: { kind: "resource", resource: "food" } },
    tick: 0,
    sequence: counter,
    status: "answered",
    ...overrides,
  };
}

/** A world whose farmer has a spoiled stock to pray about, and `history` petitions already in the books. */
function worldWith(history: Petition[], tick = 400): WorldState {
  let state = createInitialWorldState(pack());
  state = {
    ...state,
    tick,
    petitions: new CountingMap<EventId, Petition>(
      history.map((p) => [p.id, p] as const),
    ),
  };
  // A cause the farmer knows, recent enough to pray about.
  const cause = {
    eventId: "evt-spoil-1" as EventId,
    tick: tick - 5,
    kind: "spoilage" as const,
    resource: "food",
    amount: 1,
  };
  state = {
    ...state,
    causes: new Map([[id("farmer"), [cause]]]),
  };
  const farmer = getActor(state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  return withActor(state, farmer);
}

const many = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    petition({
      petitioner: id(i % 2 === 0 ? "woodcutter" : "farmer"),
      tick: i,
    }),
  );

// --- The reference: the scan the world used to do -----------------------------------------------

function referencePrayable(state: WorldState, actor: string): EventId[] {
  const cooldown = state.rules.petitionBalance?.prayerCooldownTicks ?? 20;
  for (const p of state.petitions.values()) {
    if ((p.petitioner as string) === actor && state.tick - p.tick < cooldown)
      return [];
  }
  const prayedAbout = new Set(
    [...state.petitions.values()].map((p) => p.cause),
  );
  const subject = (c: { building?: string; resource?: string }) =>
    c.building !== undefined
      ? `building:${c.building}`
      : c.resource !== undefined
        ? `resource:${c.resource}`
        : undefined;
  const open = new Set(
    [...state.petitions.values()]
      .filter((p) => (p.petitioner as string) === actor && p.status === "open")
      .flatMap((p) => subject(p.about) ?? []),
  );
  return (state.causes.get(id(actor)) ?? [])
    .filter((c) => !prayedAbout.has(c.eventId) && !open.has(subject(c) ?? ""))
    .map((c) => c.eventId);
}

test("the answer is the one a plain scan of the petitions gives, across the cases that decide it: a recent petition (cooldown), an old one, one that already cites the cause, an open one on the same subject, a closed one, and another mortal's", () => {
  const farmer = id("farmer");
  const cases: [string, Petition[], number][] = [
    ["no petitions", [], 400],
    [
      "only an old one of its own",
      [petition({ petitioner: farmer, tick: 100 })],
      400,
    ],
    [
      "its own, inside the cooldown",
      [petition({ petitioner: farmer, tick: 390 })],
      400,
    ],
    [
      "its own, exactly at the cooldown's edge",
      [petition({ petitioner: farmer, tick: 380 })],
      400,
    ],
    [
      "its own, one tick past the edge",
      [petition({ petitioner: farmer, tick: 379 })],
      400,
    ],
    [
      "its own, an old one and a recent one and an older one, in that order",
      [
        petition({ petitioner: farmer, tick: 100 }),
        petition({ petitioner: farmer, tick: 390 }),
        petition({ petitioner: farmer, tick: 50 }),
      ],
      400,
    ],
    [
      "another mortal's, inside the cooldown",
      [petition({ petitioner: id("woodcutter"), tick: 395 })],
      400,
    ],
    [
      "one that already cites the cause",
      [
        petition({
          petitioner: farmer,
          tick: 100,
          cause: "evt-spoil-1" as EventId,
        }),
      ],
      400,
    ],
    [
      "an open one on the same subject",
      [
        petition({
          petitioner: farmer,
          tick: 100,
          status: "open",
          about: {
            eventId: "evt-x" as EventId,
            tick: 100,
            kind: "spoilage",
            resource: "food",
          },
        }),
      ],
      400,
    ],
    [
      "a closed one on the same subject",
      [
        petition({
          petitioner: farmer,
          tick: 100,
          status: "lapsed",
          about: {
            eventId: "evt-x" as EventId,
            tick: 100,
            kind: "spoilage",
            resource: "food",
          },
        }),
      ],
      400,
    ],
    [
      "an open one on another subject",
      [
        petition({
          petitioner: farmer,
          tick: 100,
          status: "open",
          about: {
            eventId: "evt-x" as EventId,
            tick: 100,
            kind: "damage",
            building: id("shed"),
          },
        }),
      ],
      400,
    ],
    ["a long history", many(300), 1_000],
  ];
  for (const [label, history, tick] of cases) {
    const state = worldWith(history, tick);
    for (const who of ["farmer", "woodcutter"]) {
      expect([
        label,
        who,
        prayableCauses(state, id(who)).map((c) => c.eventId),
      ]).toEqual([label, who, referencePrayable(state, who)]);
    }
  }
});

test("the work does not grow with the petitions a world holds: asking about every mortal on every tick walks the petitions once, not once per question", () => {
  const state = worldWith(many(5_000), 6_000);
  const map = state.petitions as CountingMap<EventId, Petition>;
  for (let round = 0; round < 50; round += 1) {
    for (const who of ["farmer", "woodcutter"]) prayableCauses(state, id(who));
  }
  // The same petitions, asked about a hundred times: walked at most once.
  expect(map.walks).toBeLessThanOrEqual(1);
});

test("a change to the petitions is seen at once: a petition opened, answered, or lapsed gives a new Map, and the answer follows it", () => {
  const farmer = id("farmer");
  const before = worldWith(many(200), 1_000);
  expect(prayableCauses(before, farmer).map((c) => c.eventId)).toEqual([
    evt("evt-spoil-1"),
  ]);

  // A prayer about that very cause is opened by the world's own reducer.
  const opened = applyEvent(before, {
    schemaVersion: 1,
    id: "evt-9999-1",
    sequence: 9_999,
    simTime: 0,
    tick: 1_000,
    correlationId: "fixture",
    causationId: "fixture",
    approximate: false,
    kind: "petition-opened",
    entityId: "farmer",
    god: "zeus",
    cause: "evt-spoil-1",
    request: {
      kind: "help",
      need: { kind: "resource", resource: "food", amount: 1 },
    },
  } as never);
  expect(opened.petitions).not.toBe(before.petitions);
  // It is inside its own cooldown now, and the cause is prayed about: nothing to pray.
  expect(prayableCauses(opened, farmer)).toEqual([]);
  // The old state still answers as it did.
  expect(prayableCauses(before, farmer).map((c) => c.eventId)).toEqual([
    evt("evt-spoil-1"),
  ]);

  // Later, past the cooldown and with the petition answered, the cause is still prayed about.
  const later = { ...opened, tick: 2_000 };
  expect(prayableCauses(later, farmer)).toEqual([]);
  // A closed petition frees its subject: an open one on the subject of a different cause blocks that cause, until it closes.
  const blocker = petition({
    petitioner: farmer,
    tick: 100,
    status: "open",
    about: {
      eventId: "evt-y" as EventId,
      tick: 100,
      kind: "spoilage",
      resource: "food",
    },
  });
  const blocked = worldWith([blocker], 1_000);
  expect(prayableCauses(blocked, farmer)).toEqual([]);
  const closed = {
    ...blocked,
    petitions: new Map([
      [blocker.id, { ...blocker, status: "lapsed" as const }],
    ]),
  };
  expect(prayableCauses(closed, farmer).map((c) => c.eventId)).toEqual([
    evt("evt-spoil-1"),
  ]);
});

test("a state is not changed by being asked: a plain petitions Map is left as it was and is given nothing to remember", () => {
  const state = worldWith(many(50), 1_000);
  const plain = new Map(state.petitions);
  const asked = { ...state, petitions: plain };
  const before = [...plain.entries()];
  prayableCauses(asked, id("farmer"));
  expect([...plain.entries()]).toEqual(before);
  expect(Object.keys(plain)).toEqual([]);
  expect(Object.getOwnPropertySymbols(plain)).toEqual([]);
});
