import { expect, test } from "bun:test";
import type { ContentPack, EventId } from "@panthea/contracts";
import { applyEvent, runTick, submitProposal } from "./actions";
import { decode, encode } from "./codec";
import {
  createInitialWorldState,
  createPrng,
  toEntityId,
  toLegendId,
  withActor,
  withLegend,
} from "./state";

function minimalRules(): ContentPack["rules"] {
  return {
    catchUpCapMs: 3_600_000,
    catchUpChunkMs: 60_000,
    checkpointIntervalMs: 60_000,
    maxProposalsPerTick: 100,
    fireBalance: {},
    economyBalance: {},
  };
}

function walkPack(): ContentPack {
  return {
    schemaVersion: 1,
    realms: ["mortal"],
    resources: [],
    locations: [
      {
        id: "grove",
        realm: "mortal",
        name: "Grove",
        edges: [{ to: "square", transport: "path", bidirectional: true }],
      },
      { id: "square", realm: "mortal", name: "Square", edges: [] },
    ],
    buildings: [],
    inhabitants: [],
    rules: minimalRules(),
    recipes: {},
  };
}

function seededState() {
  const state = createInitialWorldState(walkPack());
  return withActor(state, {
    id: toEntityId("wanderer"),
    locationId: toEntityId("grove"),
    alive: true,
    capabilities: ["divine"],
    inventory: new Map([["wood", 3]]),
    revision: 2,
  });
}

test("encode -> JSON round-trip -> decode reproduces the original state", () => {
  const original = seededState();
  const roundTripped = decode(JSON.parse(JSON.stringify(encode(original))));
  expect(roundTripped).toEqual(original);
});

test("the encoded form is JSON-safe (no Maps survive JSON.stringify without the codec)", () => {
  const original = seededState();
  const encoded = encode(original);
  // A plain JSON.stringify of the raw WorldState drops Map contents; the
  // encoded form must not, since it is arrays of entries, not Maps.
  const json = JSON.stringify(encoded);
  const reparsed = JSON.parse(json);
  expect(reparsed.actors).toHaveLength(1);
  expect(reparsed.locations).toHaveLength(2);
});

test("decode rejects a non-object top-level value", () => {
  expect(() => decode(null)).toThrow();
  expect(() => decode("not an object")).toThrow();
  expect(() => decode([])).toThrow();
  expect(() => decode(42)).toThrow();
});

test("decode rejects a non-integer or negative tick or lastSequence, and a negative simTime", () => {
  const base = encode(seededState());
  expect(() => decode({ ...base, tick: -1 })).toThrow();
  expect(() => decode({ ...base, tick: 1.5 })).toThrow();
  expect(() => decode({ ...base, lastSequence: -1 })).toThrow();
  expect(() => decode({ ...base, lastSequence: 1.5 })).toThrow();
  expect(() => decode({ ...base, simTime: -1 })).toThrow();
});

test("decode rejects a location entry that is not [id, object] with the required fields and types", () => {
  const base = encode(seededState());
  expect(() =>
    decode({ ...base, locations: [...base.locations, "not-a-tuple"] }),
  ).toThrow();
  expect(() =>
    decode({ ...base, locations: [...base.locations, ["grove-2", null]] }),
  ).toThrow();
  expect(() =>
    decode({
      ...base,
      locations: [...base.locations, ["grove-2", { id: "grove-2" }]],
    }),
  ).toThrow();
});

test("decode rejects an actor entry that is not [id, object] with the required fields and types", () => {
  const base = encode(seededState());
  expect(() => decode({ ...base, actors: [["wanderer", null]] })).toThrow();
  expect(() =>
    decode({ ...base, actors: [["wanderer", { id: "wanderer" }]] }),
  ).toThrow();
});

test("decode rejects an actor whose locationId is not a known location", () => {
  const base = encode(seededState());
  const [id, actor] = base.actors[0] as unknown as [
    string,
    Record<string, unknown>,
  ];
  expect(() =>
    decode({
      ...base,
      actors: [[id, { ...actor, locationId: "nowhere" }]],
    }),
  ).toThrow();
});

test("decode rejects a location whose realm is not a known realm", () => {
  const base = encode(seededState());
  const [id, location] = base.locations[0] as unknown as [
    string,
    Record<string, unknown>,
  ];
  expect(() =>
    decode({
      ...base,
      locations: [[id, { ...location, realm: "narnia" }], base.locations[1]],
    }),
  ).toThrow();
});

test("decode rejects a location whose edge points to an unknown location id", () => {
  const base = encode(seededState());
  const [id, grove] = base.locations[0] as unknown as [
    string,
    Record<string, unknown>,
  ];
  expect(() =>
    decode({
      ...base,
      locations: [
        [
          id,
          {
            ...grove,
            edges: [{ to: "nowhere", transport: "path", bidirectional: true }],
          },
        ],
        base.locations[1],
      ],
    }),
  ).toThrow();
});

test("decode rejects a duplicate key among the location entries", () => {
  const base = encode(seededState());
  const [id, location] = base.locations[0] as unknown as [
    string,
    Record<string, unknown>,
  ];
  expect(() =>
    decode({
      ...base,
      locations: [...base.locations, [id, { ...location }]],
    }),
  ).toThrow();
});

test("decode rejects a duplicate key among the actor entries", () => {
  const base = encode(seededState());
  const [id, actor] = base.actors[0] as unknown as [
    string,
    Record<string, unknown>,
  ];
  expect(() =>
    decode({
      ...base,
      actors: [...base.actors, [id, { ...actor }]],
    }),
  ).toThrow();
});

test("decode rejects a location entry whose array key does not equal its own id field", () => {
  const base = encode(seededState());
  // "square" (locations[1]) is not the actor's own location and nothing
  // else references it by id, so this isolates the key-vs-id check from
  // the unrelated "unknown location" referential check that a mismatched
  // "grove" key would otherwise trip instead.
  const [, square] = base.locations[1] as unknown as [
    string,
    Record<string, unknown>,
  ];
  expect(() =>
    decode({
      ...base,
      locations: [base.locations[0], ["mismatched-key", square]],
    }),
  ).toThrow();
});

test("decode rejects an actor entry whose array key does not equal its own id field", () => {
  const base = encode(seededState());
  const [, actor] = base.actors[0] as unknown as [
    string,
    Record<string, unknown>,
  ];
  expect(() =>
    decode({
      ...base,
      actors: [["mismatched-key", actor]],
    }),
  ).toThrow();
});

test("applying events to a decoded state equals applying them to the original", () => {
  const original = seededState();
  const submitted = submitProposal({
    schemaVersion: 1,
    actor: "wanderer",
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-1",
    kind: "move",
    to: "square",
  });
  if (!submitted.ok) throw new Error("test fixture proposal failed to parse");

  const tick = runTick(original, createPrng(1), [submitted.proposal]);
  const event = tick.committed[0]?.events[0];
  if (!event) throw new Error("expected a committed event");

  const viaOriginal = applyEvent(original, event);
  const roundTripped = decode(JSON.parse(JSON.stringify(encode(original))));
  const viaDecoded = applyEvent(roundTripped, event);

  expect(viaDecoded).toEqual(viaOriginal);
});

function economyPack(): ContentPack {
  return {
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
        wants: "planks",
        startingInventory: [{ resource: "currency", amount: 10 }],
      },
      {
        id: "zeus",
        name: "Zeus",
        locationId: "shop",
        deity: true,
        startingInventory: [{ resource: "divinity", amount: 10 }],
      },
    ],
    rules: {
      catchUpCapMs: 1,
      catchUpChunkMs: 2,
      checkpointIntervalMs: 3,
      maxProposalsPerTick: 4,
      fireBalance: { spreadChancePerTick: 0.1 },
      economyBalance: { value_food: 3 },
    },
    recipes: {
      planks: {
        inputs: [{ resource: "wood", amount: 2 }],
        outputs: [{ resource: "planks", amount: 1 }],
      },
    },
  };
}

test("encode -> JSON round-trip -> decode reproduces buildings, rules, recipes, and actor inventory/drives", () => {
  const original = createInitialWorldState(economyPack());
  const roundTripped = decode(JSON.parse(JSON.stringify(encode(original))));
  expect(roundTripped).toEqual(original);
  const farmer = roundTripped.actors.get(toEntityId("farmer"));
  expect(farmer?.inventory.get("currency")).toBe(10);
  expect(farmer?.wants).toBe("planks");
  expect(farmer?.isDeity).toBeUndefined();
  expect(farmer?.drives).toEqual({
    thrift: 0.2,
    appetite: 0.5,
    greed: 0.2,
    piety: 0.1,
  });
  const zeus = roundTripped.actors.get(toEntityId("zeus"));
  expect(zeus?.isDeity).toBe(true);
  const shop = roundTripped.buildings.get(toEntityId("agora-shop"));
  expect(shop?.inventory.get("food")).toBe(5);
  expect(shop?.owner).toBe(toEntityId("farmer"));
  expect(roundTripped.rules).toEqual(original.rules);
  expect(roundTripped.recipes).toEqual(original.recipes);
});

test("decode rejects a building whose owner references an unknown actor", () => {
  const base = encode(createInitialWorldState(economyPack()));
  const [id, building] = base.buildings[0] as unknown as [
    string,
    Record<string, unknown>,
  ];
  expect(() =>
    decode({
      ...base,
      buildings: [[id, { ...building, owner: "nobody" }]],
    }),
  ).toThrow();
});

test("decode rejects a building whose locationId is not a known location", () => {
  const base = encode(createInitialWorldState(economyPack()));
  const [id, building] = base.buildings[0] as unknown as [
    string,
    Record<string, unknown>,
  ];
  expect(() =>
    decode({
      ...base,
      buildings: [[id, { ...building, locationId: "nowhere" }]],
    }),
  ).toThrow();
});

test("decode rejects a duplicate key among the building entries", () => {
  const base = encode(createInitialWorldState(economyPack()));
  const [id, building] = base.buildings[0] as unknown as [
    string,
    Record<string, unknown>,
  ];
  expect(() =>
    decode({
      ...base,
      buildings: [...base.buildings, [id, building]],
    }),
  ).toThrow();
});

test("decode rejects an inventory entry with a negative amount", () => {
  const base = encode(createInitialWorldState(economyPack()));
  const [id, building] = base.buildings[0] as unknown as [
    string,
    Record<string, unknown>,
  ];
  expect(() =>
    decode({
      ...base,
      buildings: [[id, { ...building, inventory: [["food", -1]] }]],
    }),
  ).toThrow();
});

test("decode rejects a duplicate resource within one inventory", () => {
  const base = encode(createInitialWorldState(economyPack()));
  const [id, building] = base.buildings[0] as unknown as [
    string,
    Record<string, unknown>,
  ];
  expect(() =>
    decode({
      ...base,
      buildings: [
        [
          id,
          {
            ...building,
            inventory: [
              ["food", 1],
              ["food", 2],
            ],
          },
        ],
      ],
    }),
  ).toThrow();
});

test("decode rejects a malformed recipes record", () => {
  const base = encode(createInitialWorldState(economyPack()));
  expect(() =>
    decode({ ...base, recipes: { planks: { inputs: "not-an-array" } } }),
  ).toThrow();
});

test("decode rejects a rules object missing a required numeric field", () => {
  const base = encode(createInitialWorldState(economyPack()));
  const { catchUpCapMs: _omit, ...incompleteRules } = base.rules;
  expect(() => decode({ ...base, rules: incompleteRules })).toThrow();
});

test("encode -> JSON round-trip -> decode reproduces an unlinked legend and an event-linked one, neither carrying a truth flag", () => {
  let original = createInitialWorldState(economyPack());
  original = withLegend(original, {
    id: toLegendId("legend-unlinked"),
    narrator: toEntityId("farmer"),
    assertion: "Zeus struck down the old oak",
  });
  original = withLegend(original, {
    id: toLegendId("legend-linked"),
    narrator: toEntityId("farmer"),
    assertion: "Zeus struck down the old oak",
    linkedEventId: "evt-9" as EventId,
  });
  const roundTripped = decode(JSON.parse(JSON.stringify(encode(original))));
  expect(roundTripped).toEqual(original);
  const unlinked = roundTripped.legends.get(toLegendId("legend-unlinked"));
  expect(unlinked).not.toHaveProperty("linkedEventId");
  expect(unlinked).not.toHaveProperty("verified");
  const linked = roundTripped.legends.get(toLegendId("legend-linked"));
  expect(linked).toMatchObject({ linkedEventId: "evt-9" });
  expect(linked).not.toHaveProperty("verified");
});

test("decode rejects a legend whose linkedEventId is not a string", () => {
  const base = encode(createInitialWorldState(economyPack()));
  expect(() =>
    decode({
      ...base,
      legends: [
        [
          "legend-1",
          {
            id: "legend-1",
            narrator: "farmer",
            assertion: "Zeus struck down the old oak",
            linkedEventId: 9,
          },
        ],
      ],
    }),
  ).toThrow();
});

test("decode holds a stored world's petition tunables to the same strict rule as content", () => {
  const state = createInitialWorldState(walkPack());
  const encoded = JSON.parse(JSON.stringify(encode(state)));
  expect(() => decode(encoded)).not.toThrow();
  const withBalance = (petitionBalance: unknown) => ({
    ...encoded,
    rules: { ...encoded.rules, petitionBalance },
  });
  expect(() => decode(withBalance({ answerWindowTicks: 250 }))).not.toThrow();
  for (const bad of [
    { answerWindowTicks: 0 },
    { goalLockTicks: 1.5 },
    { typo: 3 },
  ]) {
    expect(() => decode(withBalance(bad))).toThrow();
  }
});

test("decode holds a stored world's practice tunables to the same strict rule as content, and a world with no threads decodes to none", () => {
  const state = createInitialWorldState(walkPack());
  const encoded = JSON.parse(JSON.stringify(encode(state)));
  expect(decode(encoded).threads.size).toBe(0);
  const withBalance = (practiceBalance: unknown) => ({
    ...encoded,
    rules: { ...encoded.rules, practiceBalance },
  });
  expect(() => decode(withBalance({ counterBudget: 2 }))).not.toThrow();
  for (const bad of [
    { counterBudget: 0 },
    { negotiationTicks: 1.5 },
    { counterBudgt: 3 },
  ]) {
    expect(() => decode(withBalance(bad))).toThrow();
  }
});

test("decode holds a stored actor's form and withheld capabilities to their shape, and an actor with neither decodes to neither", () => {
  const state = seededState();
  const plain = JSON.parse(JSON.stringify(encode(state)));
  const decodedPlain = decode(plain);
  for (const actor of decodedPlain.actors.values()) {
    expect(actor.form).toBeUndefined();
    expect(actor.withheld).toBeUndefined();
  }

  const stored = JSON.parse(JSON.stringify(encode(state)));
  const actor = stored.actors[0][1];
  actor.form = "stag";
  actor.withheld = [{ capability: "divine", restoreAt: 150, eventId: "evt-3" }];
  const decoded = decode(stored);
  const first = [...decoded.actors.values()][0];
  expect(first?.form).toBe("stag");
  expect(first?.withheld).toMatchObject([
    { capability: "divine", restoreAt: 150, eventId: "evt-3" },
  ]);
  expect(encode(decoded)).toEqual(stored);

  for (const corrupt of [
    { form: 7 },
    { withheld: "divine" },
    { withheld: [] },
    { withheld: [{ capability: "divine", restoreAt: -1, eventId: "evt-3" }] },
    { withheld: [{ capability: "divine", restoreAt: 1.5, eventId: "evt-3" }] },
    { withheld: [{ capability: 7, restoreAt: 150, eventId: "evt-3" }] },
    { withheld: [{ capability: "divine", restoreAt: 150 }] },
  ]) {
    const copy = JSON.parse(JSON.stringify(stored));
    Object.assign(copy.actors[0][1], corrupt);
    expect(() => decode(copy)).toThrow();
  }
});

function patronPack(): ContentPack {
  const base = walkPack();
  return {
    ...base,
    inhabitants: [
      { id: "zeus", name: "Zeus", locationId: "grove", deity: true },
      { id: "hera", name: "Hera", locationId: "grove", deity: true },
      {
        id: "farmer",
        name: "Farmer",
        locationId: "grove",
        devotion: { god: "hera", affinity: 3 },
      },
    ],
    rules: { ...minimalRules(), troubleKinds: { fire: "zeus" } },
  };
}

test("a mortal's patron and the trouble-kind table round-trip through the codec, and decode holds both to the world's actors", () => {
  const state = createInitialWorldState(patronPack());
  const encoded = JSON.parse(JSON.stringify(encode(state)));
  expect(encoded.patrons).toEqual([["farmer", "hera"]]);
  const decoded = decode(encoded);
  expect(decoded).toEqual(state);
  expect(decoded.patrons.get(toEntityId("farmer"))).toBe(toEntityId("hera"));
  expect(decoded.rules.troubleKinds).toEqual({ fire: "zeus" });

  const refused = (patch: Record<string, unknown>) =>
    expect(() => decode({ ...encoded, ...patch })).toThrow();
  // A patron is a god; a god has none; both must be actors; one patron each.
  refused({ patrons: [["farmer", "farmer"]] });
  refused({ patrons: [["zeus", "hera"]] });
  refused({ patrons: [["nobody", "hera"]] });
  refused({ patrons: [["farmer", "nike"]] });
  refused({
    patrons: [
      ["farmer", "hera"],
      ["farmer", "zeus"],
    ],
  });
  refused({ patrons: "hera" });
  // The table's god must be a god of this world, and its kinds are the known ones.
  refused({ rules: { ...encoded.rules, troubleKinds: { fire: "farmer" } } });
  refused({ rules: { ...encoded.rules, troubleKinds: { fire: "nike" } } });
  refused({ rules: { ...encoded.rules, troubleKinds: { blight: "zeus" } } });
  // Control: the same stored world, untouched, decodes.
  expect(() => decode(encoded)).not.toThrow();
});
