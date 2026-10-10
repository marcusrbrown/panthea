// Seasons and the gods' domain troubles: derived from the tick, drawn from the persisted PRNG, held to a floor.
// Everything runs on world ticks: no clock, no timers.

import { expect, test } from "bun:test";
import type { ContentPack, EventId, WorldEvent } from "@panthea/contracts";
import { applyEvent, applyEvents, runTick } from "./actions";
import { decode, encode } from "./codec";
import { planDirectorStep } from "./director";
import { planFireStep } from "./fire";
import { petitionBalanceOf, prayableCauses, routePetition } from "./petitions";
import { planSeasonTurn, planTroubleStep, seasonAt } from "./seasons";
import {
  createInitialWorldState,
  createPrng,
  getActor,
  type PrngState,
  toEntityId,
  type WorldState,
  withActor,
} from "./state";
import { planWrongStep } from "./wrongs";

const id = toEntityId;

type Spec = {
  effect: "resource" | "building";
  resources?: string[];
  buildings?: string[];
  seasons: Record<string, number>;
};

interface Options {
  troubles?: Record<string, Spec>;
  kinds?: Record<string, string>;
  balance?: Record<string, number>;
  mortals?: readonly string[];
  patrons?: Record<string, string>;
  goods?: [string, number][];
}

const TROUBLES: Record<string, Spec> = {
  heat: { effect: "resource", resources: ["food"], seasons: { summer: 1000 } },
  frost: { effect: "building", buildings: ["shop"], seasons: { winter: 1000 } },
  rust: { effect: "resource", resources: ["currency"], seasons: {} },
};
const KINDS = { heat: "zeus", frost: "hera", rust: "athena" };

/** A square, an altar, three gods in a hall, a shop the first mortal owns, and mortals who each hold goods. */
function content(options: Options = {}): ContentPack {
  const god = (name: string) => ({
    id: name,
    sprite: `placeholder-${name}`,
    name,
    locationId: "hall",
    deity: true as const,
    startingInventory: [{ resource: "divinity", amount: 20 }],
  });
  const mortals = options.mortals ?? ["a", "b", "c"];
  return {
    schemaVersion: 1,
    realms: ["mortal", "olympus"],
    resources: [],
    locations: [
      {
        id: "square",
        realm: "mortal",
        name: "Square",
        edges: [{ to: "altar", transport: "path", bidirectional: true }],
      },
      { id: "altar", realm: "mortal", name: "Altar", edges: [] },
      {
        id: "hall",
        realm: "olympus",
        name: "Hall",
        edges: [
          { to: "altar", transport: "divine-transport", bidirectional: true },
        ],
      },
    ],
    buildings: [
      {
        id: "shop",
        locationId: "square",
        name: "Shop",
        material: "wood",
        combustible: false,
        services: [],
        inventory: [],
        owner: mortals[0],
      },
    ],
    inhabitants: [
      god("zeus"),
      god("hera"),
      god("athena"),
      ...mortals.map((name) => ({
        id: name,
        sprite: `placeholder-${name}`,
        name,
        locationId: "square",
        drives: { thrift: 0, appetite: 0, greed: 0, piety: 0 },
        startingInventory: (
          options.goods ?? [
            ["food", 20],
            ["currency", 20],
          ]
        ).map(([resource, amount]) => ({ resource, amount })),
        devotion: { god: options.patrons?.[name] ?? "zeus", affinity: 3 },
      })),
    ],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: {},
      economyBalance: { consumeAmount: 1, value_food: 3, value_currency: 1 },
      petitionBalance: {
        directorIntervalTicks: 100000,
        seasonTicks: 10,
        troubleFloorTicks: 100000,
        troubleLossCap: 2,
        ...options.balance,
      },
      troubles: options.troubles ?? TROUBLES,
      troubleKinds: options.kinds ?? KINDS,
    },
    recipes: {},
  } as unknown as ContentPack;
}

class Town {
  state: WorldState;
  prng: PrngState;
  readonly log: WorldEvent[] = [];
  readonly initial: WorldState;
  constructor(options: Options = {}, seed = 1) {
    this.state = createInitialWorldState(content(options));
    this.initial = this.state;
    this.prng = createPrng(seed);
  }
  tick() {
    const ran = runTick(this.state, this.prng, []);
    this.state = ran.state;
    this.prng = ran.prng;
    this.log.push(...ran.events);
    return ran;
  }
  run(ticks: number) {
    for (let n = 0; n < ticks; n += 1) this.tick();
  }
  troubles() {
    return this.log.filter(
      (e): e is Extract<WorldEvent, { kind: "trouble" }> =>
        e.kind === "trouble",
    );
  }
  turns() {
    return this.log.filter(
      (e): e is Extract<WorldEvent, { kind: "season-turned" }> =>
        e.kind === "season-turned",
    );
  }
}

test("the season is the tick's: spring at tick 0, then summer, autumn, winter, and round again", () => {
  const state = createInitialWorldState(content());
  const at = (tick: number) => seasonAt(state, tick);
  expect([0, 9, 10, 19, 20, 29, 30, 39, 40, 49, 50, 400].map(at)).toEqual([
    "spring",
    "spring",
    "summer",
    "summer",
    "autumn",
    "autumn",
    "winter",
    "winter",
    "spring",
    "spring",
    "summer",
    "spring",
  ]);
  // A season's length is a tunable, at its smallest too.
  const one = createInitialWorldState(content({ balance: { seasonTicks: 1 } }));
  expect([0, 1, 2, 3, 4, 5].map((tick) => seasonAt(one, tick))).toEqual([
    "spring",
    "summer",
    "autumn",
    "winter",
    "spring",
    "summer",
  ]);
});

test("a season-turned event fires on each boundary tick, naming the season it turns into and the one it leaves, and on no other tick (AE7)", () => {
  const town = new Town();
  town.run(45);
  expect(town.turns().map((e) => [e.tick, e.previous, e.season])).toEqual([
    [10, "spring", "summer"],
    [20, "summer", "autumn"],
    [30, "autumn", "winter"],
    [40, "winter", "spring"],
  ]);
  // Never at tick 0, and a pack with no trouble table has no seasons to turn.
  expect(planSeasonTurn({ ...town.initial, tick: 0 })).toEqual([]);
  const bare = createInitialWorldState({
    ...content(),
    rules: { ...content().rules, troubles: undefined, troubleKinds: undefined },
  });
  expect(planSeasonTurn({ ...bare, tick: 10 })).toEqual([]);
});

test("the odds change with the season (AE7): a trouble certain in summer never comes in autumn, and comes again the next summer", () => {
  const town = new Town({
    troubles: { heat: TROUBLES.heat as Spec },
    kinds: { heat: "zeus" },
  });
  town.run(65);
  const heat = town.troubles().filter((e) => e.source === "season");
  const ticks = [...new Set(heat.map((e) => e.tick))];
  // Summer is ticks 10 to 19 and 50 to 59: it comes in every tick of them (while the mortals hold food) and in no other.
  expect(
    ticks.every(
      (tick) => (tick >= 10 && tick < 20) || (tick >= 50 && tick < 60),
    ),
  ).toBe(true);
  expect(ticks).toContain(10);
  expect(ticks).toContain(50);
  expect(ticks.filter((tick) => tick >= 20 && tick < 50)).toEqual([]);
  for (const event of heat) expect(event.season).toBe("summer");
});

test("a building trouble damages one of its buildings, once: the shop is damaged in winter and a damaged building is not damaged again", () => {
  const town = new Town({
    troubles: { frost: TROUBLES.frost as Spec },
    kinds: { frost: "hera" },
  });
  town.run(45);
  const frost = town.troubles();
  expect(frost).toHaveLength(1);
  expect(frost[0]).toMatchObject({
    entityId: "a",
    trouble: "frost",
    god: "hera",
    season: "winter",
    source: "season",
    loss: { kind: "building", building: "shop" },
  });
  expect(frost[0]?.tick).toBe(30);
  expect(town.state.buildings.get(id("shop"))?.status).toBe("damaged");
});

test("a resource trouble takes what the afflicted holds, up to the loss cap, and nothing goes negative: at cap 1, 2, and more than a mortal holds", () => {
  const taken = (cap: number, held: number) => {
    const town = new Town(
      {
        troubles: { heat: TROUBLES.heat as Spec },
        kinds: { heat: "zeus" },
        balance: { troubleLossCap: cap },
        mortals: ["a"],
        goods: [["food", held]],
      },
      1,
    );
    town.run(10);
    const [first] = town.troubles();
    expect(first).toBeDefined();
    const left = town.state.actors.get(id("a"))?.inventory.get("food") ?? 0;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(
      left + (first?.loss.kind === "resource" ? first.loss.amount : 0),
    ).toBe(
      held -
        town
          .troubles()
          .slice(1)
          .reduce(
            (sum, e) => sum + (e.loss.kind === "resource" ? e.loss.amount : 0),
            0,
          ),
    );
    return first?.loss.kind === "resource" ? first.loss.amount : -1;
  };
  expect([
    taken(1, 5),
    taken(2, 5),
    taken(9, 5),
    taken(2, 1),
    taken(5, 1),
  ]).toEqual([1, 2, 5, 1, 1]);
});

test("two troubles in one tick never take the same goods twice: one unit held, two troubles certain, one is taken", () => {
  const town = new Town({
    troubles: {
      heat: TROUBLES.heat as Spec,
      scorch: {
        effect: "resource",
        resources: ["food"],
        seasons: { summer: 1000 },
      },
    },
    kinds: { heat: "zeus", scorch: "hera" },
    mortals: ["a"],
    goods: [["food", 1]],
  });
  town.run(10);
  expect(town.troubles()).toHaveLength(1);
  expect(town.state.actors.get(id("a"))?.inventory.get("food") ?? 0).toBe(0);
});

test("the floor: every god's trouble fires at least once in every window, at a tick the persisted PRNG picks, on every seed (SC2)", () => {
  const window = 20;
  const slots = new Set<number>();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const town = new Town(
      {
        troubles: {
          rust: TROUBLES.rust as Spec,
          heat: { ...(TROUBLES.heat as Spec), seasons: {} },
          frost: { ...(TROUBLES.frost as Spec), seasons: {} },
        },
        balance: { troubleFloorTicks: window },
      },
      seed,
    );
    town.run(5 * window - 1);
    for (const god of ["athena", "hera", "zeus"]) {
      for (let w = 0; w < 5; w += 1) {
        const inWindow = town
          .troubles()
          .filter(
            (e) =>
              e.god === god &&
              e.tick >= w * window &&
              e.tick < (w + 1) * window,
          );
        // Frost damages the one shop, so Hera has exactly one trouble that can happen: once, in the first window she can.
        if (god === "hera" && w > 0) continue;
        expect([seed, god, w, inWindow.length >= 1]).toEqual([
          seed,
          god,
          w,
          true,
        ]);
        for (const event of inWindow) expect(event.source).toBe("floor");
        if (god === "athena" && w === 1)
          slots.add((inWindow[0]?.tick ?? 0) - w * window);
      }
    }
  }
  // The slot is the PRNG's: it varies over seeds and stays inside the window.
  expect(slots.size).toBeGreaterThan(4);
  for (const slot of slots) {
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(window);
  }
});

test("the floor's slot is the same for the same seed and different for another", () => {
  const options = {
    troubles: { rust: TROUBLES.rust as Spec },
    kinds: { rust: "athena" },
    balance: { troubleFloorTicks: 50 },
  };
  const ticksOf = (seed: number) => {
    const town = new Town(options, seed);
    town.run(149);
    return town.troubles().map((e) => e.tick);
  };
  expect(ticksOf(3)).toEqual(ticksOf(3));
  expect(ticksOf(3)).not.toEqual(ticksOf(4));
});

test("the floor's last tick is certain: with a window of one tick, every god has a trouble every tick", () => {
  const town = new Town({
    troubles: { rust: TROUBLES.rust as Spec },
    kinds: { rust: "athena" },
    balance: { troubleFloorTicks: 1 },
  });
  town.run(12);
  expect(town.troubles().map((e) => e.tick)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  ]);
});

test("a god that had a trouble in a window on the season's odds has no floor trouble in it", () => {
  const town = new Town({
    // Certain in spring, which is when this one window opens: the season's draw comes first, every tick the god has food.
    troubles: {
      heat: { ...(TROUBLES.heat as Spec), seasons: { spring: 1000 } },
    },
    kinds: { heat: "zeus" },
    balance: { seasonTicks: 100, troubleFloorTicks: 40 },
  });
  town.run(39);
  expect(town.troubles().length).toBeGreaterThan(0);
  expect(town.troubles().every((e) => e.source === "season")).toBe(true);
  // Control: with no season odds, the same window has exactly one trouble, and it is the floor's.
  const floorOnly = new Town({
    troubles: { heat: { ...(TROUBLES.heat as Spec), seasons: {} } },
    kinds: { heat: "zeus" },
    balance: { seasonTicks: 100, troubleFloorTicks: 40 },
  });
  floorOnly.run(39);
  expect(floorOnly.troubles().map((e) => e.source)).toEqual(["floor"]);
});

test("the floor falls on whatever can happen: a god whose first trouble has no victim has its other, and with none it has none and nothing breaks", () => {
  const options = (extra: Partial<Options> = {}): Options => ({
    troubles: {
      // Sorts first and weighs most, but nobody carries amber.
      amber: {
        effect: "resource",
        resources: ["amber"],
        seasons: { spring: 900 },
      },
      rust: { effect: "resource", resources: ["currency"], seasons: {} },
    },
    kinds: { amber: "athena", rust: "athena" },
    balance: { troubleFloorTicks: 5 },
    ...extra,
  });
  const town = new Town(options());
  town.run(20);
  expect(town.troubles().length).toBeGreaterThanOrEqual(3);
  expect(new Set(town.troubles().map((e) => e.trouble))).toEqual(
    new Set(["rust"]),
  );
  // Nobody carries what any of its troubles takes: no trouble, and no failure.
  const none = new Town(options({ goods: [["wine", 4]] }));
  none.run(20);
  expect(none.troubles()).toEqual([]);
});

test("a dead god has no trouble, and a trouble never lands on a god or on the dead", () => {
  const town = new Town({ balance: { troubleFloorTicks: 1 } });
  const athena = getActor(town.state, id("athena"));
  if (!athena) throw new Error("athena");
  town.state = withActor(town.state, { ...athena, alive: false });
  const a = getActor(town.state, id("a"));
  if (!a) throw new Error("a");
  town.state = withActor(town.state, { ...a, alive: false });
  town.run(15);
  const events = town.troubles();
  expect(events.some((e) => e.god === "athena")).toBe(false);
  expect(events.some((e) => e.entityId === "a")).toBe(false);
  expect(events.length).toBeGreaterThan(0);
});

test("a pack with no trouble table draws nothing: no seasons, no troubles, and the generator stays where it was", () => {
  const bare = createInitialWorldState({
    ...content(),
    rules: { ...content().rules, troubles: undefined, troubleKinds: undefined },
  });
  const prng = createPrng(5);
  const step = planTroubleStep({ ...bare, tick: 10 }, prng);
  expect(step).toEqual({ events: [], prng });
});

// --- What the afflicted does -----------------------------------------------------------------------------

test("a trouble is a loss its victim prays about, and the prayer goes to the trouble's god, not to the victim's patron", () => {
  const town = new Town({
    troubles: { heat: TROUBLES.heat as Spec, frost: TROUBLES.frost as Spec },
    kinds: { heat: "zeus", frost: "hera" },
    mortals: ["a", "b"],
    patrons: { a: "athena", b: "athena" },
    balance: { seasonTicks: 10 },
  });
  town.run(12);
  const heat = town.troubles().find((e) => e.trouble === "heat");
  expect(heat).toBeDefined();
  const victim = heat?.entityId as string;
  const [cause] = prayableCauses(town.state, id(victim)).filter(
    (c) => c.eventId === heat?.id,
  );
  expect(cause).toMatchObject({
    kind: "spoilage",
    trouble: "heat",
    resource: "food",
  });
  expect(cause?.offender).toBeUndefined();
  // Its patron is Athena; the cause is Zeus's.
  expect(town.state.patrons.get(id(victim))).toBe(id("athena"));
  expect(routePetition(town.state, id(victim), cause)).toBe(id("zeus"));
  // Control: a need, which is no trouble, goes to the patron.
  expect(
    routePetition(town.state, id(victim), {
      eventId: "evt-1-1" as EventId,
      tick: 1,
      kind: "need",
      resource: "food",
    }),
  ).toBe(id("athena"));
});

test("a building trouble is a damage cause its owner prays about to the trouble's god, and the same trouble kind names one god", () => {
  const town = new Town({
    troubles: { frost: TROUBLES.frost as Spec },
    kinds: { frost: "hera" },
    patrons: { a: "zeus" },
  });
  town.run(32);
  const frost = town.troubles()[0];
  const [cause] = prayableCauses(town.state, id("a")).filter(
    (c) => c.eventId === frost?.id,
  );
  expect(cause).toMatchObject({
    kind: "damage",
    building: "shop",
    trouble: "frost",
  });
  expect(routePetition(town.state, id("a"), cause)).toBe(id("hera"));
  // A trouble whose god is not alive goes to the patron instead.
  const hera = getActor(town.state, id("hera"));
  if (!hera) throw new Error("hera");
  const dead = withActor(town.state, { ...hera, alive: false });
  expect(routePetition(dead, id("a"), cause)).toBe(id("zeus"));
});

test("a trouble's prayer waits behind no open prayer about the same good: it goes to another god, so a mortal praying to its patron about hunger still prays to the domain god about the food a trouble took", () => {
  const town = new Town({ patrons: { a: "athena" }, mortals: ["a", "b"] });
  const fixture = (overrides: Record<string, unknown>) => {
    const event = {
      schemaVersion: 1,
      id: `evt-${town.state.tick}-${7000 + town.log.length}`,
      sequence: town.state.lastSequence + 1,
      simTime: 0,
      tick: town.state.tick,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      ...overrides,
    } as unknown as WorldEvent;
    town.state = applyEvent(
      { ...town.state, lastSequence: event.sequence },
      event,
    );
    town.log.push(event);
    return event;
  };
  const need = fixture({
    kind: "unmet-need",
    entityId: "a",
    resource: "food",
    reason: "no-funds",
  });
  fixture({
    kind: "petition-opened",
    entityId: "a",
    god: "athena",
    cause: need.id,
    request: { kind: "help", need: { kind: "resource", resource: "food" } },
  });
  // Past its prayer cooldown, with its food prayer still open.
  town.state = { ...town.state, tick: town.state.tick + 25 };
  const trouble = fixture({
    kind: "trouble",
    entityId: "a",
    trouble: "heat",
    god: "zeus",
    season: "summer",
    source: "season",
    loss: { kind: "resource", resource: "food", amount: 2 },
  });
  const theft = fixture({
    kind: "theft",
    entityId: "b",
    victim: "a",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  const causes = prayableCauses(town.state, id("a")).map((c) => c.eventId);
  expect(causes).toContain(trouble.id);
  // Control: a theft of the same good, which the patron would hear, still waits behind the open prayer.
  expect(causes).not.toContain(theft.id);
});

// --- Draw order, replay ----------------------------------------------------------------------------------

test("the PRNG is spent in a fixed order: wrongs, then the gods' troubles, then fire, then the director, so a tick's new state is what drawing them in that order gives", () => {
  const town = new Town({
    troubles: {
      heat: {
        ...(TROUBLES.heat as Spec),
        seasons: { spring: 400, summer: 400, autumn: 400, winter: 400 },
      },
      rust: TROUBLES.rust as Spec,
    },
    kinds: { heat: "zeus", rust: "athena" },
    balance: { troubleFloorTicks: 7, directorIntervalTicks: 3 },
  });
  let drew = 0;
  for (let n = 0; n < 40; n += 1) {
    const before = { ...town.state, tick: town.state.tick + 1 };
    const wrongs = planWrongStep(before, town.prng);
    const troubles = planTroubleStep(before, wrongs.prng);
    const fire = planFireStep(before, troubles.prng);
    const director = planDirectorStep(before, fire.prng, before.tick);
    if (troubles.prng.seed !== wrongs.prng.seed) drew += 1;
    const ran = town.tick();
    expect(ran.prng).toEqual(director.prng);
  }
  // The troubles did draw, and the director did too: the order is not vacuous.
  expect(drew).toBeGreaterThan(10);
  expect(
    town.log.some((e) => e.kind === "stock-spoiled" || e.kind === "theft"),
  ).toBe(true);
});

test("the same seed does the same troubles and a replay of the log rebuilds the state they made; another seed does others", () => {
  const options = {
    troubles: {
      heat: {
        ...(TROUBLES.heat as Spec),
        seasons: { summer: 300, winter: 300 },
      },
      frost: { ...(TROUBLES.frost as Spec), seasons: { winter: 100 } },
      rust: TROUBLES.rust as Spec,
    },
    balance: { troubleFloorTicks: 30 },
  };
  const shape = (town: Town) =>
    town
      .troubles()
      .map((e) => [e.tick, e.trouble, e.entityId, JSON.stringify(e.loss)]);
  const first = new Town(options, 4);
  first.run(200);
  const again = new Town(options, 4);
  again.run(200);
  expect(first.troubles().length).toBeGreaterThan(8);
  expect(shape(again)).toEqual(shape(first));
  expect(again.state).toEqual(first.state);
  const other = new Town(options, 5);
  other.run(200);
  expect(shape(other)).not.toEqual(shape(first));
  expect({
    ...applyEvents(first.initial, first.log),
    tick: first.state.tick,
    simTime: first.state.simTime,
  }).toEqual(first.state);
  expect([...first.state.lastTrouble.keys()].map(String).sort()).toEqual([
    "athena",
    "hera",
    "zeus",
  ]);
  const decoded = decode(JSON.parse(JSON.stringify(encode(first.state))));
  expect(decoded).toEqual(first.state);
  expect(decoded.lastTrouble).toEqual(first.state.lastTrouble);
});

test("a catch-up that spans a boundary emits exactly one season-turned, at the right tick, and is the run it would have been: chunks carried through the codec change nothing", () => {
  const whole = new Town({}, 2);
  whole.run(24);
  const chunked = new Town({}, 2);
  chunked.run(8);
  // A restart in the middle of the gap to the boundary: the state and generator come back from storage.
  chunked.state = decode(JSON.parse(JSON.stringify(encode(chunked.state))));
  chunked.prng = JSON.parse(JSON.stringify(chunked.prng));
  chunked.run(16);
  expect(chunked.turns().map((e) => [e.tick, e.season])).toEqual([
    [10, "summer"],
    [20, "autumn"],
  ]);
  expect(chunked.state).toEqual(whole.state);
  expect(chunked.log.map((e) => [e.kind, e.tick])).toEqual(
    whole.log.map((e) => [e.kind, e.tick]),
  );
});

test("the authored defaults: a season is at most a 5-minute episode and the hour's 3,600 ticks turn it 18 times (R13)", () => {
  const state = createInitialWorldState(content({ balance: {} }));
  const defaults = {
    ...state,
    rules: { ...state.rules, petitionBalance: {} },
  };
  const length = petitionBalanceOf(defaults.rules, "seasonTicks");
  expect(length).toBe(200);
  expect(length).toBeLessThanOrEqual(300);
  let turns = 0;
  for (let tick = 1; tick <= 3600; tick += 1) {
    turns += planSeasonTurn({ ...defaults, tick }).length;
  }
  expect(turns).toBe(18);
  // Any 300 ticks hold a turn.
  for (let from = 0; from < 1000; from += 7) {
    const held = Array.from({ length: 300 }, (_, i) => from + i + 1).some(
      (tick) => planSeasonTurn({ ...defaults, tick }).length > 0,
    );
    expect([from, held]).toEqual([from, true]);
  }
  expect(petitionBalanceOf(defaults.rules, "troubleFloorTicks")).toBeLessThan(
    300,
  );
});
