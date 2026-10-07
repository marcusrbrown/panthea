import { expect, test } from "bun:test";
import type { ContentPack, EventId } from "@panthea/contracts";
import {
  activeFavors,
  type BuildingState,
  buildingBase,
  createInitialWorldState,
  createPrng,
  effectiveServices,
  getBuilding,
  getEntityRevision,
  isFavorActive,
  nextPrngValue,
  toEntityId,
  withActor,
  withBuilding,
} from "./state";

test("the same PRNG seed produces the same sequence of values", () => {
  let a = createPrng(42);
  let b = createPrng(42);
  const valuesA: number[] = [];
  const valuesB: number[] = [];
  for (let i = 0; i < 5; i++) {
    const drawA = nextPrngValue(a);
    const drawB = nextPrngValue(b);
    valuesA.push(drawA.value);
    valuesB.push(drawB.value);
    a = drawA.state;
    b = drawB.state;
  }
  expect(valuesA).toEqual(valuesB);
  // Every draw is in [0, 1) and the sequence isn't degenerate (constant).
  for (const value of valuesA) {
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  }
  expect(new Set(valuesA).size).toBeGreaterThan(1);
});

test("different seeds produce different sequences", () => {
  const drawA = nextPrngValue(createPrng(1));
  const drawB = nextPrngValue(createPrng(2));
  expect(drawA.value).not.toBe(drawB.value);
});

test("getEntityRevision looks up both actors and locations by id", () => {
  const pack = {
    schemaVersion: 1 as const,
    realms: ["mortal"] as const,
    resources: [],
    locations: [
      { id: "agora", realm: "mortal" as const, name: "Agora", edges: [] },
    ],
    buildings: [],
    inhabitants: [],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 100,
      fireBalance: {},
      economyBalance: {},
    },
    recipes: {},
  };
  let state = createInitialWorldState(pack);
  state = withActor(state, {
    id: toEntityId("npc-1"),
    locationId: toEntityId("agora"),
    alive: true,
    capabilities: [],
    inventory: new Map(),
    revision: 3,
  });
  state = withBuilding(state, {
    id: toEntityId("shed"),
    locationId: toEntityId("agora"),
    name: "Shed",
    material: "wood",
    combustible: true,
    services: [],
    inventory: new Map(),
    status: "operational",
    revision: 7,
  });
  expect(getEntityRevision(state, toEntityId("npc-1"))).toBe(3);
  expect(getEntityRevision(state, toEntityId("agora"))).toBe(0);
  expect(getEntityRevision(state, toEntityId("shed"))).toBe(7);
  expect(getEntityRevision(state, toEntityId("unknown"))).toBeUndefined();
});

function minimalRules(
  economyBalance: Record<string, number> = {},
): ContentPack["rules"] {
  return {
    catchUpCapMs: 0,
    catchUpChunkMs: 0,
    checkpointIntervalMs: 0,
    maxProposalsPerTick: 100,
    fireBalance: {},
    economyBalance,
  };
}

test("createInitialWorldState seeds actors from authored inhabitants, with their inventory and drives", () => {
  const pack: ContentPack = {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [{ id: "square", realm: "mortal", name: "Square", edges: [] }],
    buildings: [],
    inhabitants: [
      {
        id: "woodcutter",
        name: "The Woodcutter",
        locationId: "square",
        drives: { thrift: 0.6, appetite: 0.3, greed: 0.4, piety: 0.1 },
        gathers: "wood",
        startingInventory: [{ resource: "currency", amount: 5 }],
      },
    ],
    rules: minimalRules(),
    recipes: {},
  };
  const state = createInitialWorldState(pack);
  const actor = state.actors.get(toEntityId("woodcutter"));
  expect(actor).toMatchObject({
    locationId: "square",
    alive: true,
    revision: 0,
    drives: { thrift: 0.6, appetite: 0.3, greed: 0.4, piety: 0.1 },
    gathers: "wood",
  });
  expect(actor?.inventory.get("currency")).toBe(5);
});

test("createInitialWorldState seeds buildings from authored content, with their inventory and owner", () => {
  const pack: ContentPack = {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [{ id: "shop", realm: "mortal", name: "Shop", edges: [] }],
    buildings: [
      {
        id: "agora-shop",
        locationId: "shop",
        name: "The Agora Shop",
        material: "stone",
        combustible: false,
        services: ["trade"],
        inventory: [{ resource: "food", amount: 5 }],
        owner: "farmer",
      },
    ],
    inhabitants: [
      {
        id: "farmer",
        name: "The Farmer",
        locationId: "shop",
        drives: { thrift: 0.2, appetite: 0.5, greed: 0.2, piety: 0.1 },
      },
    ],
    rules: minimalRules(),
    recipes: {},
  };
  const state = createInitialWorldState(pack);
  const building = getBuilding(state, toEntityId("agora-shop"));
  expect(building).toMatchObject({
    locationId: "shop",
    name: "The Agora Shop",
    material: "stone",
    combustible: false,
    services: ["trade"],
    owner: "farmer",
    status: "operational",
    revision: 0,
  });
  expect(building?.inventory.get("food")).toBe(5);
});

test("an inhabitant with no authored drives seeds an actor with drives absent", () => {
  const pack: ContentPack = {
    schemaVersion: 1,
    realms: ["olympus"],
    resources: [],
    locations: [
      { id: "great-hall", realm: "olympus", name: "Great Hall", edges: [] },
    ],
    buildings: [],
    inhabitants: [
      {
        id: "zeus",
        name: "Zeus",
        locationId: "great-hall",
        startingInventory: [{ resource: "divinity", amount: 10 }],
      },
    ],
    rules: minimalRules(),
    recipes: {},
  };
  const state = createInitialWorldState(pack);
  const actor = state.actors.get(toEntityId("zeus"));
  expect(actor?.drives).toBeUndefined();
  expect(actor?.inventory.get("divinity")).toBe(10);
});

test("withBuilding adds or replaces a building without touching others", () => {
  const pack: ContentPack = {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [{ id: "square", realm: "mortal", name: "Square", edges: [] }],
    buildings: [],
    inhabitants: [],
    rules: minimalRules(),
    recipes: {},
  };
  let state = createInitialWorldState(pack);
  state = withBuilding(state, {
    id: toEntityId("shed"),
    locationId: toEntityId("square"),
    name: "Shed",
    material: "wood",
    combustible: true,
    services: [],
    inventory: new Map(),
    status: "operational",
    revision: 0,
  });
  expect(getBuilding(state, toEntityId("shed"))).toMatchObject({
    name: "Shed",
  });
});

test("isFavorActive is true strictly before the expiry tick, and false at or after it", () => {
  const favor = {
    source: toEntityId("zeus"),
    effect: "divine-favor",
    expiresAtTick: 10,
  };
  expect(isFavorActive(favor, 9)).toBe(true);
  expect(isFavorActive(favor, 10)).toBe(false);
  expect(isFavorActive(favor, 11)).toBe(false);
});

test("activeFavors filters out expired favors without mutating the actor", () => {
  const actor = {
    id: toEntityId("farmer"),
    locationId: toEntityId("town-square"),
    alive: true,
    capabilities: [],
    inventory: new Map(),
    favors: [
      { source: toEntityId("zeus"), effect: "divine-favor", expiresAtTick: 5 },
      { source: toEntityId("zeus"), effect: "divine-favor", expiresAtTick: 20 },
    ],
    revision: 0,
  };
  expect(activeFavors(actor, 10)).toEqual([
    { source: toEntityId("zeus"), effect: "divine-favor", expiresAtTick: 20 },
  ]);
  expect(actor.favors).toHaveLength(2);
});

test("effectiveServices exposes the authored list only while operational", () => {
  const operational: BuildingState = {
    id: toEntityId("the-tavern"),
    locationId: toEntityId("tavern"),
    name: "The Tavern",
    material: "wood",
    combustible: true,
    services: ["drink"],
    inventory: new Map(),
    status: "operational" as const,
    revision: 0,
  };
  expect(effectiveServices(operational)).toEqual(["drink"]);
  const base = buildingBase(operational);
  const elsewhere: BuildingState[] = [
    { ...base, status: "damaged" },
    {
      ...base,
      status: "burning",
      fireIntensity: 0,
      ticksBurning: 0,
      ignition: { eventId: "evt-1" as EventId, actor: toEntityId("zeus") },
    },
    { ...base, status: "destroyed" },
    { ...base, status: "repairing", repairProgress: 1 },
  ];
  for (const building of elsewhere) {
    expect(effectiveServices(building)).toEqual([]);
  }
});

test("createInitialWorldState seeds every building as operational with no fire or repair state", () => {
  const pack: ContentPack = {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [
      { id: "town-square", realm: "mortal", name: "Town Square", edges: [] },
    ],
    buildings: [
      {
        id: "the-tavern",
        locationId: "town-square",
        name: "The Tavern",
        material: "wood",
        combustible: true,
        services: ["drink"],
        inventory: [],
      },
    ],
    inhabitants: [],
    rules: minimalRules(),
    recipes: {},
  };
  const state = createInitialWorldState(pack);
  const building = getBuilding(state, toEntityId("the-tavern"));
  expect(building?.status).toBe("operational");
  expect(building?.fireIntensity).toBeUndefined();
  expect(building?.ticksBurning).toBeUndefined();
  expect(building?.repairProgress).toBeUndefined();
});

test("a deity inhabitant starts with the divine capability; a mortal starts with none", () => {
  const pack: ContentPack = {
    schemaVersion: 1,
    realms: ["mortal", "olympus"],
    resources: [],
    locations: [
      { id: "great-hall", realm: "olympus", name: "Great Hall", edges: [] },
      { id: "square", realm: "mortal", name: "Square", edges: [] },
    ],
    buildings: [],
    inhabitants: [
      { id: "zeus", name: "Zeus", locationId: "great-hall", deity: true },
      { id: "farmer", name: "The Farmer", locationId: "square" },
      {
        id: "pretender",
        name: "Pretender",
        locationId: "square",
        deity: false,
      },
    ],
    rules: minimalRules(),
    recipes: {},
  };
  const state = createInitialWorldState(pack);
  expect(state.actors.get(toEntityId("zeus"))?.capabilities).toEqual([
    "divine",
  ]);
  expect(state.actors.get(toEntityId("farmer"))?.capabilities).toEqual([]);
  expect(state.actors.get(toEntityId("pretender"))?.capabilities).toEqual([]);
});

// --- Devotion: who a mortal prays to first -------------------------------------------------------

function devotionPack(): ContentPack {
  const deity = (id: string) => ({
    id,
    name: id,
    locationId: "altar",
    deity: true,
  });
  return {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [{ id: "altar", realm: "mortal", name: "Altar", edges: [] }],
    buildings: [],
    inhabitants: [
      deity("athena"),
      deity("poseidon"),
      {
        id: "fisher",
        name: "The Fisher",
        locationId: "altar",
        drives: { thrift: 0.2, appetite: 0.3, greed: 0.3, piety: 0.5 },
        devotion: { god: "poseidon", affinity: 3 },
      },
      {
        id: "idler",
        name: "The Idler",
        locationId: "altar",
        drives: { thrift: 0.2, appetite: 0.3, greed: 0.3, piety: 0.5 },
      },
    ],
    rules: {
      catchUpCapMs: 0,
      catchUpChunkMs: 0,
      checkpointIntervalMs: 0,
      maxProposalsPerTick: 10,
      fireBalance: {},
      economyBalance: {},
    },
    recipes: {},
  } as ContentPack;
}

test("a devotion seeds the mortal's affinity toward its god and nothing else, so its prayers go there first", async () => {
  const { getRelationship } = await import("./memory");
  const { routePetition } = await import("./petitions");
  const state = createInitialWorldState(devotionPack());
  expect(
    getRelationship(state, toEntityId("fisher"), toEntityId("poseidon")),
  ).toMatchObject({
    from: "fisher",
    toward: "poseidon",
    affinity: 3,
    grudge: 0,
    allied: false,
  });
  expect(state.relationships.size).toBe(1);
  expect(routePetition(state, toEntityId("fisher"))).toBe(
    toEntityId("poseidon"),
  );
  // A mortal built outside a content pack has no patron, and the old tie-break holds: the god with the fewest petitions, then the first id.
  expect(routePetition(state, toEntityId("idler"))).toBe(toEntityId("athena"));
});

test("the authored devotion is the stored patron: a devotion to Hera makes Hera the patron, and a pack mortal with none (a fixture) has no patron entry", () => {
  const state = createInitialWorldState(devotionPack());
  expect([...state.patrons]).toEqual([
    [toEntityId("fisher"), toEntityId("poseidon")],
  ]);
  const hera = devotionPack();
  const swapped = {
    ...hera,
    inhabitants: [
      ...hera.inhabitants.map((i) =>
        i.id === "athena" ? { ...i, id: "hera" } : i,
      ),
    ].map((i) =>
      i.id === "fisher" ? { ...i, devotion: { god: "hera", affinity: 2 } } : i,
    ),
  } as ContentPack;
  expect(
    createInitialWorldState(swapped).patrons.get(toEntityId("fisher")),
  ).toBe(toEntityId("hera"));
});

test("a pack that parses always yields an initial world that decodes: a devotion at the pack's own affinity limit round-trips through JSON, and the world's limit is the contract's", async () => {
  const { memoryBalanceOf } = await import("./memory");
  const { decode, encode } = await import("./codec");
  const { affinityLimitOf, parseContentPack } = await import(
    "@panthea/contracts"
  );
  for (const [limit, affinity] of [
    [3, 3],
    [3, 1],
    [undefined, 10],
    [20, 15],
  ] as const) {
    const source = devotionPack();
    const raw = JSON.parse(JSON.stringify(source));
    raw.rules.memoryBalance =
      limit === undefined ? undefined : { affinityLimit: limit };
    raw.inhabitants.find((i: { id: string }) => i.id === "fisher").devotion = {
      god: "poseidon",
      affinity,
    };
    raw.inhabitants.find((i: { id: string }) => i.id === "idler").devotion = {
      god: "athena",
      affinity: 1,
    };
    const parsed = parseContentPack(raw);
    if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
    const state = createInitialWorldState(parsed.value);
    // One rule: what the pack parser enforces is what the world's rules and codec enforce.
    expect(memoryBalanceOf(state.rules, "affinityLimit")).toBe(
      affinityLimitOf(parsed.value.rules),
    );
    const decoded = decode(JSON.parse(JSON.stringify(encode(state))));
    expect(encode(decoded)).toEqual(encode(state));
  }
});
