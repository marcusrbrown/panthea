// Wrongs between mortals: temperament and need set the odds, the persisted PRNG decides, a credit trade fails
// two ways, and revenge is damped. Everything runs on world ticks: no clock, no timers.

import { expect, test } from "bun:test";
import type { ContentPack, EventId, WorldEvent } from "@panthea/contracts";
import { applyEvent, applyEvents, runTick, submitProposal } from "./actions";
import { decode, encode } from "./codec";
import { planDirectorStep } from "./director";
import { planFireStep } from "./fire";
import { decideRoutineProposal } from "./routines";
import {
  createInitialWorldState,
  createPrng,
  getActor,
  nextPrngValue,
  type PrngState,
  toEntityId,
  type WorldState,
  withActor,
} from "./state";
import { planWrongStep } from "./wrongs";

const id = toEntityId;

type Odds = Record<string, Record<string, number>>;
interface Mortal {
  name: string;
  patron: string;
  temperament?: string;
  location?: string;
  gathers?: string;
  goods?: [string, number][];
}

const NONE: Odds = {};

/** A square and an altar, three gods in a hall that reaches the altar, and the mortals asked for. */
function content(options: {
  mortals: readonly Mortal[];
  odds?: Odds;
  balance?: Record<string, number>;
}): ContentPack {
  const god = (name: string) => ({
    id: name,
    name,
    locationId: "hall",
    deity: true as const,
    startingInventory: [{ resource: "divinity", amount: 20 }],
  });
  return {
    schemaVersion: 1,
    realms: ["mortal", "olympus"],
    resources: [],
    locations: [
      {
        id: "square",
        realm: "mortal",
        name: "Square",
        edges: [
          { to: "altar", transport: "path", bidirectional: true },
          { to: "lane", transport: "path", bidirectional: true },
        ],
      },
      { id: "lane", realm: "mortal", name: "Lane", edges: [] },
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
    buildings: [],
    inhabitants: [
      god("zeus"),
      god("hera"),
      god("hermes"),
      ...options.mortals.map((m) => ({
        id: m.name,
        name: m.name,
        locationId: m.location ?? "square",
        drives: { thrift: 0, appetite: 0, greed: 0, piety: 0 },
        startingInventory: (
          m.goods ?? [
            ["food", 300],
            ["currency", 20],
          ]
        ).map(([resource, amount]) => ({ resource, amount })),
        devotion: { god: m.patron, affinity: 3 },
        ...(m.gathers === undefined ? {} : { gathers: m.gathers }),
        ...(m.temperament === undefined ? {} : { temperament: m.temperament }),
      })),
    ],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: {},
      economyBalance: { consumeAmount: 1, value_food: 3, value_currency: 1 },
      petitionBalance: { directorQuietTicks: 100000, ...options.balance },
      temperamentOdds: options.odds ?? NONE,
      troubleKinds: { spoilage: "hera" },
    },
    recipes: {},
  } as unknown as ContentPack;
}

class Town {
  state: WorldState;
  prng: PrngState;
  readonly log: WorldEvent[] = [];
  readonly initial: WorldState;
  constructor(options: Parameters<typeof content>[0], seed = 1) {
    this.state = createInitialWorldState(content(options));
    this.initial = this.state;
    this.prng = createPrng(seed);
    this.mortals = options.mortals.map((m) => m.name);
  }
  private readonly mortals: readonly string[];
  tick(...extra: Record<string, unknown>[]) {
    const proposals = [
      ...extra.map((raw, index) => {
        const submitted = submitProposal({
          schemaVersion: 1,
          targets: [],
          expectedRevisions: [],
          source: "model",
          observationId: `obs-${this.state.tick}-${index}`,
          ...raw,
        });
        if (!submitted.ok) throw new Error(submitted.rejection.message);
        return submitted.proposal;
      }),
      ...this.mortals.flatMap((mortal) => {
        const decision = decideRoutineProposal(this.state, id(mortal));
        return decision ? [decision.proposal] : [];
      }),
    ];
    const ran = runTick(this.state, this.prng, proposals);
    this.state = ran.state;
    this.prng = ran.prng;
    this.log.push(...ran.events);
    return ran;
  }
  until(done: () => boolean, limit = 400) {
    for (let n = 0; n < limit && !done(); n += 1) this.tick();
    expect(done()).toBe(true);
  }
  run(ticks: number) {
    for (let n = 0; n < ticks; n += 1) this.tick();
  }
  apply(overrides: Record<string, unknown>): WorldEvent {
    const event = {
      schemaVersion: 1,
      id: `evt-${this.state.tick}-${1000 + this.log.length}`,
      sequence: this.state.lastSequence + 1,
      simTime: 0,
      tick: this.state.tick,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      ...overrides,
    } as unknown as WorldEvent;
    this.state = applyEvent(
      { ...this.state, lastSequence: event.sequence },
      event,
    );
    this.log.push(event);
    return event;
  }
  act(raw: Record<string, unknown>) {
    const submitted = submitProposal({
      schemaVersion: 1,
      targets: [],
      expectedRevisions: [],
      source: "model",
      observationId: `obs-god-${this.log.length}`,
      ...raw,
    });
    if (!submitted.ok) throw new Error(submitted.rejection.message);
    const ran = runTick(this.state, this.prng, [submitted.proposal]);
    this.state = ran.state;
    this.prng = ran.prng;
    this.log.push(...ran.events);
    return ran;
  }
  wrongs() {
    return this.log.filter(
      (e): e is Extract<WorldEvent, { kind: "wrong" }> => e.kind === "wrong",
    );
  }
  petitionBy(mortal: string, cause: EventId) {
    return [...this.state.petitions.values()].find(
      (p) => p.petitioner === id(mortal) && p.cause === cause,
    );
  }
  prayer(mortal: string, cause: EventId) {
    this.until(() => this.petitionBy(mortal, cause) !== undefined);
    const petition = this.petitionBy(mortal, cause);
    if (petition === undefined) throw new Error("no petition");
    return petition;
  }
  held(mortal: string, resource: string) {
    return getActor(this.state, id(mortal))?.inventory.get(resource) ?? 0;
  }
  move(mortal: string, to: string) {
    const held = getActor(this.state, id(mortal));
    if (!held) throw new Error(mortal);
    this.state = withActor(this.state, { ...held, locationId: id(to) });
  }
}

const CERTAIN = (kind: string, temperament = "greedy"): Odds => ({
  [temperament]: { [kind]: 1000 },
});

test("a greedy trader steals from the fisher beside it at the draw; the fisher prays to its own patron next, naming the trader", () => {
  const town = new Town({
    mortals: [
      { name: "trader", patron: "hermes", temperament: "greedy" },
      { name: "fisher", patron: "zeus", temperament: "honest" },
    ],
    odds: CERTAIN("theft"),
  });
  town.until(() => town.wrongs().length > 0);
  const [wrong] = town.wrongs();
  expect(wrong).toMatchObject({
    entityId: "trader",
    victim: "fisher",
    wrong: "theft",
    temperament: "greedy",
  });
  // The loss moves from the victim to the wrongdoer, up to the cap, and is on the record.
  expect(wrong?.amount).toBeGreaterThan(0);
  expect(town.held("fisher", String(wrong?.resource))).toBeLessThan(
    town.initial.actors
      .get(id("fisher"))
      ?.inventory.get(String(wrong?.resource)) ?? 0,
  );
  const prayer = town.prayer("fisher", wrong?.id as EventId);
  expect(prayer).toMatchObject({
    god: "zeus",
    about: { kind: "wrong", offender: "trader" },
    request: { kind: "punish", offender: "trader" },
  });
});

test("an honest temperament, and a mortal with none authored, never wrong anyone, even needy and beside a victim", () => {
  const town = new Town({
    mortals: [
      { name: "saint", patron: "zeus", temperament: "honest" },
      { name: "plain", patron: "hera" },
      { name: "victim", patron: "hermes", temperament: "honest" },
    ],
    // The table offers every temperament certain odds of everything, except the honest and the unauthored.
    odds: {
      greedy: { theft: 1000, cheating: 1000, feud: 1000 },
      honest: { theft: 0 },
    },
  });
  for (const mortal of ["saint", "plain"]) {
    town.apply({
      kind: "unmet-need",
      entityId: mortal,
      resource: "wine",
      reason: "no-seller",
    });
  }
  town.run(200);
  expect(town.wrongs()).toEqual([]);
  // Control: the same town with one greedy mortal wrongs at once.
  const control = new Town({
    mortals: [
      { name: "saint", patron: "zeus", temperament: "honest" },
      { name: "rogue", patron: "hera", temperament: "greedy" },
    ],
    odds: { greedy: { theft: 1000 } },
  });
  control.run(5);
  expect(control.wrongs().length).toBeGreaterThan(0);
});

test("the same seed and state do the same wrongs, and a replay of the log rebuilds the state they made", () => {
  const options = {
    mortals: [
      { name: "a", patron: "zeus", temperament: "greedy" },
      { name: "b", patron: "hera", temperament: "quarrelsome" },
      { name: "c", patron: "hermes", temperament: "proud" },
    ],
    odds: {
      greedy: { theft: 40, cheating: 30 },
      quarrelsome: { feud: 50, theft: 10 },
      proud: { feud: 30, revenge: 100 },
    },
    balance: { wrongCooldownTicks: 5 },
  };
  const first = new Town(options, 7);
  first.run(250);
  const again = new Town(options, 7);
  again.run(250);
  const shape = (town: Town) =>
    town
      .wrongs()
      .map((w) => [
        w.tick,
        w.entityId,
        w.victim,
        w.wrong,
        w.resource,
        w.amount,
      ]);
  expect(first.wrongs().length).toBeGreaterThan(2);
  expect(shape(again)).toEqual(shape(first));
  expect(again.state).toEqual(first.state);
  // Another seed does other wrongs.
  const other = new Town(options, 8);
  other.run(250);
  expect(shape(other)).not.toEqual(shape(first));
  // The log alone rebuilds the state, and the codec carries it.
  expect({
    ...applyEvents(first.initial, first.log),
    tick: first.state.tick,
    simTime: first.state.simTime,
  }).toEqual(first.state);
  expect(decode(JSON.parse(JSON.stringify(encode(first.state))))).toEqual(
    first.state,
  );
});

test("the PRNG is spent in a fixed order: wrongs, then fire, then the director, so a tick's new state is what drawing them in that order gives", () => {
  const town = new Town(
    {
      mortals: [
        { name: "a", patron: "zeus", temperament: "greedy" },
        { name: "b", patron: "hera", temperament: "honest" },
      ],
      odds: { greedy: { theft: 500 } },
    },
    3,
  );
  for (let n = 0; n < 40; n += 1) {
    const before = { ...town.state, tick: town.state.tick + 1 };
    const wrongs = planWrongStep(before, town.prng);
    const fire = planFireStep(before, wrongs.prng);
    const director = planDirectorStep(before, fire.prng, before.tick);
    const ran = town.tick();
    expect(ran.prng).toEqual(director.prng);
  }
  // The wrongs did draw: a world where they draw nothing leaves the generator where it was.
  const quiet = new Town(
    { mortals: [{ name: "a", patron: "zeus" }], odds: CERTAIN("theft") },
    3,
  );
  quiet.run(10);
  expect(quiet.prng).toEqual(createPrng(3));
  expect(nextPrngValue(town.prng).value).not.toBe(
    nextPrngValue(createPrng(3)).value,
  );
});

test("need multiplies the odds: a draw that misses a settled mortal hits a needy one, and a multiplier of 1 changes nothing", () => {
  const options = {
    mortals: [
      { name: "a", patron: "zeus", temperament: "greedy" },
      { name: "b", patron: "hera", temperament: "honest" },
    ],
    odds: { greedy: { theft: 100 } },
    balance: { wrongNeedMultiplier: 3 },
  };
  // A seed whose first draw lies between the base odds (10%) and the multiplied (30%).
  const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((s) => {
    const value = nextPrngValue(createPrng(s)).value;
    return value >= 0.1 && value < 0.3;
  });
  if (seed === undefined) throw new Error("no seed");
  // The step alone, on the first tick, with a open need or none: nobody has walked off to pray.
  const wrongsOf = (town: Town) =>
    planWrongStep({ ...town.state, tick: 1 }, town.prng).events.filter(
      (event) => event.kind === "wrong",
    );
  const needing = (town: Town) =>
    town.apply({
      kind: "unmet-need",
      entityId: "a",
      resource: "food",
      reason: "no-funds",
    });
  const settled = new Town(options, seed);
  expect(wrongsOf(settled)).toEqual([]);
  const needy = new Town(options, seed);
  needing(needy);
  expect(wrongsOf(needy)).toMatchObject([{ entityId: "a", needy: true }]);
  const flat = new Town(
    { ...options, balance: { wrongNeedMultiplier: 1 } },
    seed,
  );
  needing(flat);
  expect(wrongsOf(flat)).toEqual([]);
  // The odds cap at certain: a multiplier cannot make more than 1000 per mille.
  const huge = new Town(
    {
      ...options,
      odds: { greedy: { theft: 600 } },
      balance: { wrongNeedMultiplier: 10 },
    },
    seed,
  );
  needing(huge);
  expect(wrongsOf(huge)).toHaveLength(1);
});

test("a wrongdoer wrongs at most once per cooldown, and takes no more than the loss cap", () => {
  const town = new Town({
    mortals: [
      { name: "a", patron: "zeus", temperament: "greedy" },
      { name: "b", patron: "hera", temperament: "honest" },
    ],
    odds: CERTAIN("theft"),
    balance: { wrongCooldownTicks: 30, wrongLossCap: 2 },
  });
  town.run(100);
  const ticks = town.wrongs().map((w) => w.tick);
  expect(ticks.length).toBeGreaterThan(2);
  for (let i = 1; i < ticks.length; i += 1) {
    expect((ticks[i] ?? 0) - (ticks[i - 1] ?? 0)).toBeGreaterThanOrEqual(30);
  }
  expect(Math.max(...town.wrongs().map((w) => w.amount))).toBeLessThanOrEqual(
    2,
  );
});

test("a wrong needs a victim beside the wrongdoer: in another place there is no one to wrong", () => {
  const town = new Town({
    mortals: [
      { name: "a", patron: "zeus", temperament: "greedy" },
      { name: "b", patron: "hera", temperament: "honest", location: "lane" },
    ],
    odds: CERTAIN("theft"),
  });
  town.run(50);
  expect(town.wrongs()).toEqual([]);
});

// --- Credit ---------------------------------------------------------------------------------------

function credit(
  town: Town,
  deferred: "payment" | "delivery",
  deadline: number,
) {
  return town.apply({
    kind: "credit-extended",
    entityId: "seller",
    buyer: "buyer",
    goods: { resource: "food", amount: 2 },
    price: { resource: "currency", amount: 6 },
    deferred,
    deadline,
  });
}

const creditTown = (odds: Odds = NONE, buyerCoin = 0) =>
  new Town({
    mortals: [
      {
        name: "seller",
        patron: "zeus",
        temperament: "honest",
        goods: [["food", 300]],
      },
      {
        name: "buyer",
        patron: "hera",
        temperament: "greedy",
        goods: [
          ["food", 300],
          ...(buyerCoin > 0
            ? [["currency", buyerCoin] as [string, number]]
            : []),
        ],
      },
    ],
    odds,
  });

test("a credit sale hands over the goods now: the buyer holds them and the seller waits for the price", () => {
  const town = creditTown(NONE, 10);
  credit(town, "payment", 40);
  expect(town.held("buyer", "food")).toBe(302);
  expect(town.held("seller", "food")).toBe(298);
  expect([...town.state.credits.values()]).toMatchObject([
    {
      seller: "seller",
      buyer: "buyer",
      deferred: "payment",
      status: "open",
      deadline: 40,
    },
  ]);
  // Paying in advance is the other direction: the price moves now and the goods are owed.
  const prepaid = creditTown(NONE, 10);
  credit(prepaid, "delivery", 40);
  expect(prepaid.held("seller", "currency")).toBe(6);
  expect(prepaid.held("buyer", "currency")).toBe(4);
  expect(prepaid.held("buyer", "food")).toBe(300);
});

test("an unpaid credit sale becomes an unpaid-debt wrong at its deadline tick, and the seller prays about it naming the buyer", () => {
  const town = creditTown();
  const sale = credit(town, "payment", 40);
  town.until(() => town.state.tick >= 40);
  const [wrong] = town.wrongs();
  expect(wrong).toMatchObject({
    kind: "wrong",
    wrong: "unpaid-debt",
    entityId: "buyer",
    victim: "seller",
    credit: sale.id,
    resource: "currency",
    amount: 6,
    tick: 40,
  });
  expect(town.state.credits.get(sale.id as EventId)?.status).toBe("defaulted");
  expect(town.prayer("seller", wrong?.id as EventId)).toMatchObject({
    god: "zeus",
    about: { kind: "wrong", offender: "buyer" },
  });
});

test("goods paid for and never delivered become a broken-agreement wrong at the deadline: the seller kept the price", () => {
  const town = new Town({
    mortals: [
      { name: "seller", patron: "zeus", temperament: "honest", goods: [] },
      {
        name: "buyer",
        patron: "hera",
        temperament: "honest",
        goods: [["currency", 10]],
      },
    ],
  });
  const sale = credit(town, "delivery", 30);
  town.until(() => town.state.tick >= 30);
  expect(town.wrongs()).toMatchObject([
    {
      wrong: "broken-agreement",
      entityId: "seller",
      victim: "buyer",
      credit: sale.id,
      tick: 30,
    },
  ]);
  expect(town.held("seller", "currency")).toBe(6);
});

/** A buyer with an open `no-funds` food need and no coin or food, beside a mortal that holds food to sell on credit. */
function needyTown(gathers?: string) {
  const town = new Town({
    mortals: [
      { name: "seller", patron: "zeus", goods: [["food", 300]] },
      {
        name: "buyer",
        patron: "hera",
        goods: [],
        ...(gathers === undefined ? {} : { gathers }),
      },
    ],
    odds: NONE,
  });
  town.apply({
    kind: "unmet-need",
    entityId: "buyer",
    resource: "food",
    reason: "no-funds",
  });
  return town;
}

const credits = (town: Town) =>
  town.log.filter((e) => e.kind === "credit-extended");

/** One tick in which only the seller acts (it eats), so the buyer stays where it stands for the credit step. */
const sellerEats = (town: Town) =>
  town.act({ actor: "seller", kind: "consume", resource: "food", amount: 1 });

test("a genuinely unmet need is sold food on credit: the buyer holds it now and owes the price at the deadline", () => {
  const town = needyTown();
  sellerEats(town);
  expect(credits(town)).toMatchObject([
    {
      entityId: "seller",
      buyer: "buyer",
      deferred: "payment",
      goods: { resource: "food", amount: 1 },
      price: { resource: "currency", amount: 3 },
    },
  ]);
  expect(town.held("buyer", "food")).toBe(1);
});

test("a need a proposal met earlier in the same tick is sold nothing on credit: the persisted need is only closed after the credit step", () => {
  const town = needyTown("food");
  const ran = town.act({
    actor: "buyer",
    kind: "gather",
    resource: "food",
    amount: 1,
  });
  expect(ran.rejected).toEqual([]);
  expect(town.held("buyer", "food")).toBe(1);
  expect(credits(town)).toEqual([]);
  expect(town.held("seller", "food")).toBe(300);
  expect(town.state.credits.size).toBe(0);
});

test("a no-funds need whose buyer has funds again is sold nothing on credit", () => {
  const town = needyTown();
  town.apply({ kind: "income-earned", entityId: "buyer", amount: 10 });
  sellerEats(town);
  expect(credits(town)).toEqual([]);
  expect(town.state.credits.size).toBe(0);
});

test("a debtor that can pay and is honest pays at the deadline, and nothing is wronged; a greedy one with certain odds defaults though it could pay", () => {
  const honest = new Town({
    mortals: [
      {
        name: "seller",
        patron: "zeus",
        temperament: "honest",
        goods: [["food", 300]],
      },
      {
        name: "buyer",
        patron: "hera",
        temperament: "honest",
        goods: [
          ["currency", 10],
          ["food", 300],
        ],
      },
    ],
    odds: CERTAIN("unpaid-debt"),
  });
  const sale = credit(honest, "payment", 20);
  honest.until(() => honest.state.tick >= 20);
  expect(honest.wrongs()).toEqual([]);
  expect(honest.state.credits.get(sale.id as EventId)?.status).toBe("settled");
  expect(honest.held("seller", "currency")).toBe(6);
  expect(honest.log.filter((e) => e.kind === "credit-settled")).toHaveLength(1);

  const greedy = creditTown(CERTAIN("unpaid-debt"), 10);
  const owed = credit(greedy, "payment", 20);
  greedy.until(() => greedy.state.tick >= 20);
  expect(greedy.wrongs()).toMatchObject([
    { wrong: "unpaid-debt", credit: owed.id },
  ]);
  expect(greedy.held("buyer", "currency")).toBe(10);
});

test("a credit is judged once, and nothing is judged before its deadline", () => {
  const town = creditTown();
  credit(town, "payment", 40);
  town.run(39);
  expect(town.wrongs()).toEqual([]);
  town.run(60);
  expect(town.wrongs()).toHaveLength(1);
});

// --- Revenge --------------------------------------------------------------------------------------

const feudTown = (odds: Odds = { quarrelsome: { revenge: 1000 } }, seed = 1) =>
  new Town(
    {
      mortals: [
        { name: "a", patron: "zeus", temperament: "quarrelsome" },
        { name: "b", patron: "hera", temperament: "quarrelsome" },
      ],
      odds,
    },
    seed,
  );

/** A wrongs B (a fixture event), B prays to Hera, and Hera refuses or lets it lapse. */
function wronged(town: Town) {
  const w = town.apply({
    kind: "wrong",
    entityId: "a",
    victim: "b",
    wrong: "theft",
    resource: "food",
    amount: 2,
    temperament: "quarrelsome",
    needy: false,
  });
  return { w, prayer: town.prayer("b", w.id as EventId) };
}

test("after a refused prayer about a wrong the victim takes one revenge: a feud that names its cause", () => {
  const town = feudTown();
  const { w, prayer } = wronged(town);
  // Nothing happens while its prayer is open.
  town.run(10);
  expect(town.wrongs().filter((x) => x.entityId === id("b"))).toEqual([]);
  town.act({ actor: "hera", kind: "refuse", petition: prayer.id });
  town.until(() => town.wrongs().some((x) => x.entityId === id("b")));
  const revenge = town.wrongs().find((x) => x.entityId === id("b"));
  expect(revenge).toMatchObject({ wrong: "feud", victim: "a", revenge: w.id });
  expect(town.state.wrongs.get(w.id as EventId)?.avenged).toBe(revenge?.id);
});

test("a lapsed prayer makes the victim eligible the same as a refusal", () => {
  const town = feudTown();
  const { w, prayer } = wronged(town);
  town.until(() => town.state.petitions.get(prayer.id)?.status === "lapsed");
  town.until(() => town.wrongs().some((x) => x.revenge === w.id));
  expect(town.wrongs().filter((x) => x.revenge === w.id)).toHaveLength(1);
});

test("an answered prayer leaves no revenge", () => {
  const town = feudTown();
  const { prayer } = wronged(town);
  town.act({ actor: "hera", kind: "strike", target: "a", power: 1 });
  expect(town.state.petitions.get(prayer.id)?.status).toBe("answered");
  town.run(150);
  expect(town.wrongs().filter((x) => x.entityId === id("b"))).toEqual([]);
});

test("revenge is damped (AE5): one retaliation per wrong, and none for a revenge, however often both pray and both are quarrelsome", () => {
  const town = feudTown();
  const { w, prayer } = wronged(town);
  town.act({ actor: "hera", kind: "refuse", petition: prayer.id });
  town.until(() => town.wrongs().some((x) => x.revenge === w.id));
  const revenge = town.wrongs().find((x) => x.revenge === w.id) as Extract<
    WorldEvent,
    { kind: "wrong" }
  >;
  // A may pray about it, to its own patron, and it is refused too: it never retaliates.
  const answer = town.prayer("a", revenge.id);
  expect(answer).toMatchObject({
    god: "zeus",
    about: { kind: "wrong", offender: "b" },
  });
  town.act({ actor: "zeus", kind: "refuse", petition: answer.id });
  town.run(300);
  expect(
    town.wrongs().filter((x) => x.entityId === id("a") && x.id !== w.id),
  ).toEqual([]);
  // And B took only the one revenge.
  expect(town.wrongs().filter((x) => x.entityId === id("b"))).toHaveLength(1);
});

test("revenge against a wrongdoer that is not beside the victim does nothing and records nothing; it comes when the wrongdoer is", () => {
  const town = feudTown();
  const { prayer } = wronged(town);
  town.act({ actor: "hera", kind: "refuse", petition: prayer.id });
  town.move("a", "lane");
  town.run(60);
  expect(town.wrongs().filter((x) => x.entityId === id("b"))).toEqual([]);
  const quiet = town.log.length;
  town.move("a", "square");
  town.until(() => town.wrongs().some((x) => x.entityId === id("b")));
  expect(town.log.length).toBeGreaterThan(quiet);
  // A dead wrongdoer is never reached either.
  const dead = feudTown();
  const { prayer: p } = wronged(dead);
  dead.act({ actor: "hera", kind: "refuse", petition: p.id });
  const a = getActor(dead.state, id("a"));
  if (!a) throw new Error("a");
  dead.state = withActor(dead.state, { ...a, alive: false });
  dead.run(100);
  expect(dead.wrongs().filter((x) => x.entityId === id("b"))).toEqual([]);
});

test("an honest victim never takes revenge, and a revenge window that has passed is closed", () => {
  const honest = new Town({
    mortals: [
      { name: "a", patron: "zeus", temperament: "quarrelsome" },
      { name: "b", patron: "hera", temperament: "honest" },
    ],
    odds: { quarrelsome: { revenge: 1000 } },
  });
  const { prayer } = wronged(honest);
  honest.act({ actor: "hera", kind: "refuse", petition: prayer.id });
  honest.run(150);
  expect(honest.wrongs().filter((x) => x.entityId === id("b"))).toEqual([]);

  const late = new Town(
    {
      mortals: [
        { name: "a", patron: "zeus", temperament: "quarrelsome" },
        { name: "b", patron: "hera", temperament: "quarrelsome" },
      ],
      odds: { quarrelsome: { revenge: 1000 } },
      balance: { revengeWindowTicks: 30 },
    },
    1,
  );
  const wrongNow = late.apply({
    kind: "wrong",
    entityId: "a",
    victim: "b",
    wrong: "theft",
    resource: "food",
    amount: 1,
    temperament: "quarrelsome",
    needy: false,
  });
  const lateOne = late.prayer("b", wrongNow.id as EventId);
  late.run(60);
  late.act({ actor: "hera", kind: "refuse", petition: lateOne.id });
  late.run(60);
  expect(late.wrongs().filter((x) => x.entityId === id("b"))).toEqual([]);
});

test("a wrong is a cause the victim always knows, and the grudge it leaves is not a second prayer", () => {
  const town = new Town({
    mortals: [
      { name: "a", patron: "zeus", temperament: "greedy" },
      { name: "b", patron: "hera", temperament: "honest" },
    ],
    odds: CERTAIN("theft"),
    balance: { wrongCooldownTicks: 1000 },
  });
  town.until(() => town.wrongs().length > 0);
  const [w] = town.wrongs();
  // b saw it and remembers a harm by a, which moved its feeling and left a grudge.
  town.run(3);
  const causes = town.state.causes.get(id("b")) ?? [];
  expect(causes.map((c) => c.kind)).toEqual(["wrong"]);
  expect(causes[0]).toMatchObject({
    eventId: w?.id,
    offender: "a",
    wrong: "theft",
  });
  expect(town.state.relationships.get("b>a")).toMatchObject({ grudge: 1 });
  const prayers = () =>
    [...town.state.petitions.values()].filter(
      (p) => p.petitioner === id("b") && p.about.kind !== "need",
    );
  town.run(60);
  expect(prayers().map((p) => p.cause)).toEqual([w?.id]);
});
