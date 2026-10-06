import { expect, test } from "bun:test";
import type { ContentPack, WorldEvent } from "@panthea/contracts";
import { applyEvent, applyEvents, runTick } from "./actions";
import { decode, encode } from "./codec";
import { getResourceAmount } from "./economy";
import { decideRoutineProposal } from "./routines";
import {
  createInitialWorldState,
  createPrng,
  getActor,
  toEntityId,
  type WorldState,
} from "./state";

const id = toEntityId;

/** A square with a farmer who wants planks, a woodcutter, and a seller's counter that can be switched on. */
function pack(): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [
      { id: "square", realm: "mortal", name: "Square", edges: [] },
      { id: "yard", realm: "mortal", name: "Yard", edges: [] },
    ],
    buildings: [],
    inhabitants: [
      {
        id: "farmer",
        name: "Farmer",
        locationId: "square",
        drives: { thrift: 0.2, appetite: 0.5, greed: 0.2, piety: 0.1 },
        gathers: "food",
        wants: "planks",
        startingInventory: [
          { resource: "currency", amount: 10 },
          { resource: "food", amount: 1 },
        ],
      },
      {
        id: "woodcutter",
        name: "Woodcutter",
        locationId: "yard",
        drives: { thrift: 0.6, appetite: 0.3, greed: 0.4, piety: 0.1 },
        gathers: "wood",
        startingInventory: [
          { resource: "currency", amount: 5 },
          { resource: "food", amount: 1 },
        ],
      },
    ],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: {},
      economyBalance: {
        gatherAmount: 2,
        consumeAmount: 1,
        value_food: 3,
        value_planks: 2,
        value_wood: 1,
        value_currency: 1,
      },
    },
    recipes: {},
  };
}

class World {
  state: WorldState = createInitialWorldState(pack());
  readonly initial = this.state;
  prng = createPrng(1);
  readonly log: WorldEvent[] = [];
  tick(): WorldEvent[] {
    const result = runTick(this.state, this.prng, []);
    this.state = result.state;
    this.prng = result.prng;
    this.log.push(...result.events);
    return [...result.events];
  }
  /** Gives `actor` goods outside any rule, as a fixture. */
  give(actor: string, resource: string, amount: number) {
    const held = getActor(this.state, id(actor));
    if (!held) throw new Error(actor);
    const inventory = new Map(held.inventory);
    inventory.set(
      resource,
      getResourceAmount(held.inventory, resource) + amount,
    );
    const actors = new Map(this.state.actors);
    actors.set(id(actor), { ...held, inventory });
    this.state = { ...this.state, actors };
  }
}

const needsOf = (events: readonly WorldEvent[], kind = "unmet-need") =>
  events.filter((e) => e.kind === kind);

test("the farmer wants planks and no one sells them: one unmet need is recorded, with its reason; the next ticks record nothing more", () => {
  const world = new World();
  const first = needsOf(world.tick());
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({
    kind: "unmet-need",
    entityId: "farmer",
    resource: "planks",
    reason: "no-seller",
  });
  // The need stays open and is not recorded again.
  expect(needsOf(world.tick())).toEqual([]);
  expect(needsOf(world.tick())).toEqual([]);
  expect(world.state.needs.size).toBe(1);
  expect(world.state.needs.get("farmer|planks")).toMatchObject({
    actor: "farmer",
    resource: "planks",
    reason: "no-seller",
    tick: 1,
  });
});

test("a need is closed when it is met, and a later shortfall opens a new one", () => {
  const world = new World();
  const opened = needsOf(world.tick())[0];
  expect(opened).toBeDefined();
  world.give("farmer", "planks", 1);
  const met = needsOf(world.tick(), "need-met");
  expect(met).toHaveLength(1);
  expect(met[0]).toMatchObject({
    entityId: "farmer",
    resource: "planks",
    needEventId: opened?.id,
  });
  expect(world.state.needs.size).toBe(0);
  // Nothing more while it stays met.
  expect(needsOf(world.tick(), "need-met")).toEqual([]);
  expect(needsOf(world.tick())).toEqual([]);
  // The planks are used up: a new need, from a new event.
  const held = getActor(world.state, id("farmer"));
  if (!held) throw new Error("farmer");
  const inventory = new Map(held.inventory);
  inventory.set("planks", 0);
  world.state = {
    ...world.state,
    actors: new Map(world.state.actors).set(id("farmer"), {
      ...held,
      inventory,
    }),
  };
  const again = needsOf(world.tick());
  expect(again).toHaveLength(1);
  expect(again[0]?.id).not.toBe(opened?.id);
});

test("the reason follows the shortfall: no funds when the mortal cannot pay, and no buyer when a surplus cannot be sold", () => {
  const poor = new World();
  poor.give("farmer", "currency", -10);
  expect(needsOf(poor.tick())[0]).toMatchObject({
    resource: "planks",
    reason: "no-funds",
  });

  // The woodcutter holds a gathered surplus, and the only other mortal has no money to buy it.
  const stuck = new World();
  stuck.give("farmer", "currency", -10);
  stuck.give("woodcutter", "wood", 4);
  const events = needsOf(stuck.tick());
  expect(
    events
      .map((e) => (e as { entityId: string; resource: string }).resource)
      .sort(),
  ).toEqual(["planks", "wood"]);
  expect(
    events.find((e) => (e as { resource: string }).resource === "wood"),
  ).toMatchObject({
    entityId: "woodcutter",
    reason: "no-buyer",
  });
});

test("a mortal with everything it needs has no unmet need; a dead mortal records none", () => {
  const fed = new World();
  fed.give("farmer", "planks", 1);
  expect(needsOf(fed.tick())).toEqual([]);

  // Hungry and alone, the farmer's food is a need too (control for the fed case).
  const hungry = new World();
  hungry.give("farmer", "planks", 1);
  hungry.give("farmer", "food", -1);
  expect(needsOf(hungry.tick())).toMatchObject([
    { entityId: "farmer", resource: "food", reason: "no-seller" },
  ]);

  const dead = new World();
  const farmer = getActor(dead.state, id("farmer"));
  if (!farmer) throw new Error("farmer");
  dead.state = {
    ...dead.state,
    actors: new Map(dead.state.actors).set(id("farmer"), {
      ...farmer,
      alive: false,
    }),
  };
  expect(
    needsOf(dead.tick()).filter(
      (e) => (e as { entityId: string }).entityId === "farmer",
    ),
  ).toEqual([]);
});

test("a hungry mortal buys from a stocked producer at its place and records no need; with the producer gone, the shortfall is recorded", () => {
  const base = pack();
  const together: ContentPack = {
    ...base,
    inhabitants: base.inhabitants.map((inhabitant) =>
      // The woodcutter has eaten its food and stands with the farmer, a food producer holding some.
      inhabitant.id === "woodcutter"
        ? {
            ...inhabitant,
            locationId: "square",
            startingInventory: [{ resource: "currency", amount: 5 }],
          }
        : inhabitant.id === "farmer"
          ? {
              ...inhabitant,
              startingInventory: [
                { resource: "currency", amount: 10 },
                { resource: "planks", amount: 1 },
                { resource: "food", amount: 4 },
              ],
            }
          : inhabitant,
    ),
  };
  const foodNeeds = (state: WorldState) =>
    needsOf(runTick(state, createPrng(1), []).events).filter(
      (e) =>
        (e as { entityId: string; resource: string }).entityId ===
          "woodcutter" && (e as { resource: string }).resource === "food",
    );

  expect(foodNeeds(createInitialWorldState(together))).toEqual([]);

  // The farmer is gone: nobody sells, and the woodcutter's hunger is a recorded need.
  const alone = createInitialWorldState(together);
  const farmer = getActor(alone, id("farmer"));
  if (!farmer) throw new Error("farmer");
  const stranded: WorldState = {
    ...alone,
    actors: new Map(alone.actors).set(id("farmer"), {
      ...farmer,
      alive: false,
    }),
  };
  expect(foodNeeds(stranded)).toMatchObject([
    { entityId: "woodcutter", resource: "food", reason: "no-seller" },
  ]);
});

test("recording a need takes no action slot: the farmer's routine still acts that tick", () => {
  const world = new World();
  const proposal = decideRoutineProposal(world.state, id("farmer"));
  // The farmer has a proposal to make while its planks need goes unmet.
  expect(proposal?.proposal.kind).toBe("consume");
  const events = world.tick();
  expect(needsOf(events)).toHaveLength(1);
  // Committing the gather on the same tick alongside the scan.
  const result = runTick(
    createInitialWorldState(pack()),
    createPrng(1),
    proposal ? [proposal.proposal] : [],
  );
  expect(result.rejected).toEqual([]);
  expect(result.events.map((e) => e.kind)).toEqual(
    expect.arrayContaining(["resource-consumed", "unmet-need"]),
  );
});

test("replaying the log reproduces the open needs, and they survive encode and decode", () => {
  const world = new World();
  world.tick();
  world.give("farmer", "planks", 1);
  world.tick();
  world.give("farmer", "currency", -10);
  world.tick();
  world.state = { ...world.state, actors: new Map(world.state.actors) };
  const rebuilt = applyEvents(world.initial, world.log);
  expect([...rebuilt.needs]).toEqual([...world.state.needs]);
  const restored = decode(JSON.parse(JSON.stringify(encode(world.state))));
  expect([...restored.needs]).toEqual([...world.state.needs]);
  // A need for someone who does not exist is refused at decode.
  const encoded = JSON.parse(JSON.stringify(encode(world.state)));
  encoded.needs = [
    [
      "ghost|planks",
      {
        actor: "ghost",
        resource: "planks",
        reason: "no-seller",
        eventId: "evt-1-1",
        tick: 1,
      },
    ],
  ];
  expect(() => decode(encoded)).toThrow(/ghost/);
});

// --- Theft and spoilage ---------------------------------------------------------------------

function event(overrides: Record<string, unknown>): WorldEvent {
  return {
    schemaVersion: 1,
    id: "evt-1-1",
    sequence: 1,
    simTime: 0,
    tick: 1,
    correlationId: "c",
    causationId: "c",
    approximate: false,
    ...overrides,
  } as unknown as WorldEvent;
}

test("theft moves goods from the victim to the offender, and spoilage removes stock; neither is undone", () => {
  const world = new World();
  const stolen = applyEvent(
    world.state,
    event({
      kind: "theft",
      entityId: "woodcutter",
      victim: "farmer",
      resource: "currency",
      amount: 4,
      cause: "director",
    }),
  );
  expect(
    getResourceAmount(
      getActor(stolen, id("farmer"))?.inventory ?? new Map(),
      "currency",
    ),
  ).toBe(6);
  expect(
    getResourceAmount(
      getActor(stolen, id("woodcutter"))?.inventory ?? new Map(),
      "currency",
    ),
  ).toBe(9);
  const spoiled = applyEvent(
    stolen,
    event({
      kind: "stock-spoiled",
      entityId: "farmer",
      resource: "currency",
      amount: 2,
      cause: "director",
    }),
  );
  expect(
    getResourceAmount(
      getActor(spoiled, id("farmer"))?.inventory ?? new Map(),
      "currency",
    ),
  ).toBe(4);
  // The goods are gone from the world: nothing credited anywhere for the spoilage.
  expect(
    getResourceAmount(
      getActor(spoiled, id("woodcutter"))?.inventory ?? new Map(),
      "currency",
    ),
  ).toBe(9);
});
