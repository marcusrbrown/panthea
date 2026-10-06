import { expect, test } from "bun:test";
import {
  affinityLimitOf,
  DEFAULT_AFFINITY_LIMIT,
  parseContentPack,
} from "./content";

function validRules(): Record<string, unknown> {
  return {
    catchUpCapMs: 3_600_000,
    catchUpChunkMs: 60_000,
    checkpointIntervalMs: 60_000,
    maxProposalsPerTick: 50,
    fireBalance: { spreadChancePerTick: 0.1 },
    economyBalance: { priceFloor: 1, priceCeiling: 100 },
  };
}

function validPack(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    realms: ["mortal", "olympus", "underworld"],
    resources: [{ resource: "currency", amount: 1000 }],
    locations: [
      {
        id: "agora",
        realm: "mortal",
        name: "The Agora",
        edges: [{ to: "market-road", transport: "path", bidirectional: true }],
      },
      {
        id: "market-road",
        realm: "mortal",
        name: "Market Road",
        edges: [],
      },
    ],
    buildings: [
      {
        id: "tavern",
        locationId: "agora",
        name: "The Tavern",
        material: "wood",
        combustible: true,
        services: ["lodging"],
        inventory: [{ resource: "wine", amount: 10 }],
        owner: "npc-1",
      },
    ],
    inhabitants: [
      {
        id: "npc-1",
        name: "Tavernkeeper",
        locationId: "agora",
        drives: { thrift: 0.5, appetite: 0.2, greed: 0.1, piety: 0.3 },
        devotion: { god: "athena", affinity: 2 },
      },
      { id: "athena", name: "Athena", locationId: "agora", deity: true },
    ],
    rules: validRules(),
  };
}

test("a valid minimal content pack parses", () => {
  const result = parseContentPack(validPack());
  expect(result.ok).toBe(true);
});

test("a location referencing an unknown realm fails to load", () => {
  const pack = validPack();
  (pack.locations as Record<string, unknown>[])[0].realm = "atlantis";
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe("locations[0].realm");
  }
});

test("a location may declare a required capability to enter it", () => {
  const pack = validPack();
  (pack.locations as Record<string, unknown>[])[0].requiredCapability =
    "divine";
  const result = parseContentPack(pack);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.locations[0]).toMatchObject({
      requiredCapability: "divine",
    });
  }
});

test("a location without a required capability parses with it absent", () => {
  const result = parseContentPack(validPack());
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.locations[0].requiredCapability).toBeUndefined();
  }
});

test("a location with a non-string required capability is rejected", () => {
  const pack = validPack();
  (pack.locations as Record<string, unknown>[])[0].requiredCapability = 42;
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
});

test("a building declares whether it can catch fire", () => {
  const result = parseContentPack(validPack());
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.buildings[0]).toMatchObject({ combustible: true });
  }
});

test("a building with a non-boolean combustible field is rejected", () => {
  const pack = validPack();
  (pack.buildings as Record<string, unknown>[])[0].combustible = "yes";
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
});

test("an inhabitant without drives parses with them absent -- a fixture-only actor never runs a routine", () => {
  const pack = validPack();
  delete (pack.inhabitants as Record<string, unknown>[])[0].drives;
  const result = parseContentPack(pack);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.inhabitants[0].drives).toBeUndefined();
  }
});

test("a building with a negative inventory amount is rejected", () => {
  const pack = validPack();
  (pack.buildings as Record<string, unknown>[])[0].inventory = [
    { resource: "wine", amount: -1 },
  ];
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
});

test("an unsupported content schema version is rejected", () => {
  const pack = validPack();
  pack.schemaVersion = 99;
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unsupported-version");
  }
});

test("rules with a non-numeric balance value are rejected", () => {
  const pack = validPack();
  (pack.rules as Record<string, unknown>).fireBalance = {
    spreadChancePerTick: "high",
  };
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
});

test("an edge referencing an unknown location fails referential integrity", () => {
  const pack = validPack();
  (pack.locations as Record<string, unknown>[])[0].edges = [
    { to: "nowhere", transport: "path", bidirectional: true },
  ];
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("malformed");
    expect(result.path).toBe("locations[0].edges[0].to");
  }
});

test("a location realm not declared in the pack's realms list fails referential integrity", () => {
  const pack = validPack();
  pack.realms = ["mortal"];
  (pack.locations as Record<string, unknown>[]).push({
    id: "underworld-entry",
    realm: "underworld",
    name: "Underworld Entry",
    edges: [],
  });
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("malformed");
    expect(result.path).toBe("locations[2].realm");
  }
});

test("a building referencing an unknown location fails referential integrity", () => {
  const pack = validPack();
  (pack.buildings as Record<string, unknown>[])[0].locationId = "nowhere";
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("malformed");
    expect(result.path).toBe("buildings[0].locationId");
  }
});

test("an inhabitant referencing an unknown location fails referential integrity", () => {
  const pack = validPack();
  (pack.inhabitants as Record<string, unknown>[])[0].locationId = "nowhere";
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("malformed");
    expect(result.path).toBe("inhabitants[0].locationId");
  }
});

test("an inhabitant may declare a gathered resource and a starting inventory", () => {
  const pack = validPack();
  (pack.inhabitants as Record<string, unknown>[])[0].gathers = "wine";
  (pack.inhabitants as Record<string, unknown>[])[0].startingInventory = [
    { resource: "currency", amount: 5 },
  ];
  const result = parseContentPack(pack);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.inhabitants[0]).toMatchObject({
      gathers: "wine",
      startingInventory: [{ resource: "currency", amount: 5 }],
    });
  }
});

test("an inhabitant without gathers, wants, deity, or startingInventory parses with them absent", () => {
  const result = parseContentPack(validPack());
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.inhabitants[0].gathers).toBeUndefined();
    expect(result.value.inhabitants[0].wants).toBeUndefined();
    expect(result.value.inhabitants[0].deity).toBeUndefined();
    expect(result.value.inhabitants[0].startingInventory).toBeUndefined();
  }
});

test("an inhabitant may be authored as a deity", () => {
  const pack = validPack();
  const first = (pack.inhabitants as Record<string, unknown>[])[0];
  first.deity = true;
  delete first.devotion;
  const result = parseContentPack(pack);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.inhabitants[0]).toMatchObject({ deity: true });
  }
});

test("an inhabitant with a non-boolean deity field is rejected", () => {
  const pack = validPack();
  (pack.inhabitants as Record<string, unknown>[])[0].deity = "yes";
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
});

test("an inhabitant may declare a wanted resource to buy", () => {
  const pack = validPack();
  (pack.inhabitants as Record<string, unknown>[])[0].wants = "planks";
  const result = parseContentPack(pack);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.inhabitants[0]).toMatchObject({ wants: "planks" });
  }
});

test("a building owner referencing an unknown inhabitant fails referential integrity", () => {
  const pack = validPack();
  (pack.buildings as Record<string, unknown>[])[0].owner = "nobody";
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("malformed");
    expect(result.path).toBe("buildings[0].owner");
  }
});

/** A pack with a goddess and a mortal who reveres her, for the devotion tests. */
function packWithDevotion(devotion: unknown): Record<string, unknown> {
  const pack = validPack();
  const inhabitants = pack.inhabitants as Record<string, unknown>[];
  inhabitants[0] = { ...inhabitants[0], devotion };
  return pack;
}

test("an inhabitant may revere one god: the god it prays to first, with the starting affinity that routes its prayers there", () => {
  const result = parseContentPack(
    packWithDevotion({ god: "athena", affinity: 3 }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.inhabitants[0]).toMatchObject({
      devotion: { god: "athena", affinity: 3 },
    });
  }
  expect(parseContentPack(validPack()).ok).toBe(true);
});

test("every mortal needs an authored devotion, its patron: a mortal without one fails parse, and a god needs none", () => {
  const pack = validPack();
  const inhabitants = pack.inhabitants as Record<string, unknown>[];
  const { devotion: _patron, ...stateless } = inhabitants[0] as Record<
    string,
    unknown
  >;
  inhabitants[0] = stateless;
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe("inhabitants[0].devotion");
    expect(result.message).toContain("patron");
  }
  // Control: with its devotion back it parses, and the god beside it has none.
  expect(parseContentPack(validPack()).ok).toBe(true);
});

test("a devotion must name a deity in the pack, and an affinity that is a whole number from 1 to 10", () => {
  for (const [devotion, path] of [
    [{ god: "poseidon", affinity: 3 }, "inhabitants[0].devotion.god"],
    // A mortal is not a god to revere.
    [{ god: "npc-1", affinity: 3 }, "inhabitants[0].devotion.god"],
    [{ god: "athena", affinity: 0 }, "inhabitants[0].devotion.affinity"],
    [{ god: "athena", affinity: 11 }, "inhabitants[0].devotion.affinity"],
    [{ god: "athena", affinity: 2.5 }, "inhabitants[0].devotion.affinity"],
    [{ god: "athena", affinity: "high" }, "inhabitants[0].devotion.affinity"],
    [{ god: "athena" }, "inhabitants[0].devotion.affinity"],
    [{ affinity: 3 }, "inhabitants[0].devotion.god"],
    ["athena", "inhabitants[0].devotion"],
  ] as const) {
    const result = parseContentPack(packWithDevotion(devotion));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe(path);
  }
  // A god revering a god is not a thing: only a mortal prays.
  const pack = packWithDevotion({ god: "athena", affinity: 3 });
  const inhabitants = pack.inhabitants as Record<string, unknown>[];
  inhabitants[1] = {
    ...inhabitants[1],
    devotion: { god: "athena", affinity: 3 },
  };
  const godly = parseContentPack(pack);
  expect(godly.ok).toBe(false);
  if (!godly.ok) expect(godly.path).toBe("inhabitants[1].devotion");
});

/** `packWithDevotion` under a pack whose own rules set the affinity limit. */
function packWithLimit(limit: number | undefined, affinity: number) {
  const pack = packWithDevotion({ god: "athena", affinity });
  const rules = pack.rules as Record<string, unknown>;
  if (limit !== undefined) rules.memoryBalance = { affinityLimit: limit };
  return pack;
}

test("a devotion is held to the pack's own affinity limit, not a fixed 10: a limit of 3 refuses a devotion of 4, naming the mortal and the limit", () => {
  const refused = parseContentPack(packWithLimit(3, 4));
  expect(refused.ok).toBe(false);
  if (!refused.ok) {
    expect(refused.path).toBe("inhabitants[0].devotion.affinity");
    expect(refused.message).toContain(
      (
        (packWithLimit(3, 4).inhabitants as { id: string }[])[0] as {
          id: string;
        }
      ).id,
    );
    expect(refused.message).toContain("limit of 3");
  }
  // At or under the limit parses, and the limit's default is the world's: 10.
  expect(parseContentPack(packWithLimit(3, 3)).ok).toBe(true);
  expect(parseContentPack(packWithLimit(3, 1)).ok).toBe(true);
  expect(parseContentPack(packWithLimit(undefined, 10)).ok).toBe(true);
  expect(parseContentPack(packWithLimit(undefined, 11)).ok).toBe(false);
  // A pack that raises the limit may state a larger devotion than the default allows.
  expect(parseContentPack(packWithLimit(20, 15)).ok).toBe(true);
  // A devotion of zero is never a devotion, whatever the limit.
  expect(parseContentPack(packWithLimit(3, 0)).ok).toBe(false);
});

test("the effective affinity limit is one rule: the pack's own value, else the default the world uses", () => {
  expect(affinityLimitOf({})).toBe(DEFAULT_AFFINITY_LIMIT);
  expect(affinityLimitOf({ memoryBalance: { affinityLimit: 4 } })).toBe(4);
  expect(affinityLimitOf({ memoryBalance: { capacity: 9 } })).toBe(
    DEFAULT_AFFINITY_LIMIT,
  );
  expect(DEFAULT_AFFINITY_LIMIT).toBe(10);
});

/** A pack with two gods, for the rivalry tests; `rivals` goes on the first. */
function packWithRivals(
  rivals: unknown,
  extra: Record<string, unknown>[] = [],
) {
  const pack = validPack();
  const inhabitants = pack.inhabitants as Record<string, unknown>[];
  inhabitants[1] = { ...inhabitants[1], rivals };
  inhabitants.push(
    { id: "poseidon", name: "Poseidon", locationId: "agora", deity: true },
    ...extra,
  );
  return pack;
}

test("a god may name the gods it contests for a place's people; the pack carries the rivalry the world judges", () => {
  const ok = parseContentPack(packWithRivals(["poseidon"]));
  expect(ok.ok).toBe(true);
  if (ok.ok) {
    const athena = ok.value.inhabitants.find((i) => i.id === "athena");
    expect(athena?.rivals).toEqual(["poseidon"]);
  }
  expect(parseContentPack(packWithRivals(undefined)).ok).toBe(true);
  expect(parseContentPack(packWithRivals([])).ok).toBe(true);
});

test("a rival must be another god in the pack, named once; a mortal has no rivals", () => {
  for (const [rivals, path] of [
    [["nike"], "inhabitants[1].rivals[0]"],
    [["athena"], "inhabitants[1].rivals[0]"],
    [["poseidon", "poseidon"], "inhabitants[1].rivals[1]"],
    // a mortal is not a god to contest for
    [["npc-1"], "inhabitants[1].rivals[0]"],
    ["poseidon", "inhabitants[1].rivals"],
    [[7], "inhabitants[1].rivals[0]"],
  ] as const) {
    const result = parseContentPack(packWithRivals(rivals));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe(path);
  }
  const pack = validPack();
  const inhabitants = pack.inhabitants as Record<string, unknown>[];
  inhabitants[0] = { ...inhabitants[0], rivals: ["athena"] };
  const mortal = parseContentPack(pack);
  expect(mortal.ok).toBe(false);
  if (!mortal.ok) expect(mortal.path).toBe("inhabitants[0].rivals");
});

test("the contest tunables are practice tunables: positive whole numbers, and no others", () => {
  for (const key of [
    "contestWindowTicks",
    "contestActTicks",
    "contestLedgerMax",
    "contestStanding",
  ]) {
    const pack = validPack();
    (pack.rules as Record<string, unknown>).practiceBalance = { [key]: 5 };
    expect(parseContentPack(pack).ok).toBe(true);
    (pack.rules as Record<string, unknown>).practiceBalance = { [key]: 0 };
    expect(parseContentPack(pack).ok).toBe(false);
  }
});

test("a valid recipe converting inputs to outputs parses", () => {
  const pack = validPack();
  pack.recipes = {
    planks: {
      inputs: [{ resource: "wood", amount: 2 }],
      outputs: [{ resource: "planks", amount: 1 }],
    },
  };
  const result = parseContentPack(pack);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.recipes.planks).toMatchObject({
      inputs: [{ resource: "wood", amount: 2 }],
      outputs: [{ resource: "planks", amount: 1 }],
    });
  }
});

test("a pack with no recipes key parses with an empty recipes record", () => {
  const result = parseContentPack(validPack());
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.recipes).toEqual({});
  }
});

test("a recipe with a malformed input is rejected", () => {
  const pack = validPack();
  pack.recipes = {
    planks: {
      inputs: [{ resource: "wood", amount: -1 }],
      outputs: [{ resource: "planks", amount: 1 }],
    },
  };
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
});

test("duplicate location ids fail referential integrity", () => {
  const pack = validPack();
  (pack.locations as Record<string, unknown>[]).push({
    id: "agora",
    realm: "mortal",
    name: "Duplicate Agora",
    edges: [],
  });
  const result = parseContentPack(pack);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("malformed");
    expect(result.path).toBe("locations[2].id");
  }
});

function packWithMemoryBalance(
  memoryBalance: unknown,
): Record<string, unknown> {
  const pack = validPack();
  (pack.rules as Record<string, unknown>).memoryBalance = memoryBalance;
  return pack;
}

test("memory tunables are checked key by key: whole non-negative numbers where a count is meant, a non-negative fraction only for toldShare", () => {
  expect(
    parseContentPack(
      packWithMemoryBalance({
        capacity: 24,
        "salience_building-ignited": 8,
        salience_told: 4,
        harmAffinity: 2,
        kindnessAffinity: 1,
        toldShare: 0.5,
        affinityLimit: 10,
        grudgeLimit: 10,
        refusalAffinity: 1,
        "salience_practice-ended": 7,
        // Retired, and still accepted: affinity no longer makes an alliance.
        allianceAffinity: 5,
      }),
    ).ok,
  ).toBe(true);
  // Capacity zero is a legal, if forgetful, world.
  expect(parseContentPack(packWithMemoryBalance({ capacity: 0 })).ok).toBe(
    true,
  );
  expect(parseContentPack(packWithMemoryBalance({ toldShare: 1.5 })).ok).toBe(
    true,
  );

  const rejected: Record<string, unknown>[] = [
    { capacity: -1 },
    { capacity: 2.5 },
    { capacity: "many" },
    { "salience_building-ignited": 1.5 },
    { "salience_building-ignited": -1 },
    { harmAffinity: 1.5 },
    { harmAffinity: -2 },
    { kindnessAffinity: 0.5 },
    { affinityLimit: -1 },
    { affinityLimit: 2.5 },
    { grudgeLimit: -1 },
    { allianceAffinity: 1.5 },
    { toldShare: -0.1 },
    { toldShare: Number.POSITIVE_INFINITY },
    // A typo would silently leave the default in force.
    { capcity: 24 },
    { "salience_building-ignitd": 8 },
    // No one can witness these, so a salience for them means nothing.
    { "salience_report-told": 4 },
    { "salience_memory-recorded": 4 },
    { "salience_relationship-changed": 4 },
  ];
  for (const memoryBalance of rejected) {
    expect(parseContentPack(packWithMemoryBalance(memoryBalance)).ok).toBe(
      false,
    );
  }
  expect(parseContentPack(packWithMemoryBalance(["capacity"])).ok).toBe(false);
});

function packWithPetitionBalance(
  petitionBalance: unknown,
): Record<string, unknown> {
  const pack = validPack();
  (pack.rules as Record<string, unknown>).petitionBalance = petitionBalance;
  return pack;
}

test("petition tunables are strict: each a positive whole number, unknown keys refused, a missing record means the features are off", () => {
  const good = {
    answerWindowTicks: 250,
    causePrayableTicks: 150,
    prayerCooldownTicks: 20,
    blessDivinityCost: 2,
    blessPlanks: 3,
    blessResourceAmount: 2,
    blessResourceCap: 4,
    directorQuietTicks: 120,
    goalLockTicks: 40,
    strikeGoodsCap: 2,
  };
  const parsed = parseContentPack(packWithPetitionBalance(good));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value.rules.petitionBalance).toEqual(good);
  // A partial record is fine: the rest take their defaults. The cap's smallest value parses.
  expect(
    parseContentPack(packWithPetitionBalance({ goalLockTicks: 10 })).ok,
  ).toBe(true);
  expect(
    parseContentPack(packWithPetitionBalance({ strikeGoodsCap: 1 })).ok,
  ).toBe(true);
  // Without one, nothing changes for packs that never had it.
  const plain = parseContentPack(validPack());
  expect(plain.ok && plain.value.rules.petitionBalance === undefined).toBe(
    true,
  );

  for (const bad of [
    { answerWindowTicks: 0 },
    // A strike takes at least one unit: a cap of 0, or one that is not a whole number, is no cap.
    { strikeGoodsCap: 0 },
    { strikeGoodsCap: -1 },
    { strikeGoodsCap: 1.5 },
    { strikeGoodsCap: "2" },
    { answerWindowTicks: -5 },
    { answerWindowTicks: 2.5 },
    { directorQuietTicks: "soon" },
    { blessPlanks: Number.POSITIVE_INFINITY },
    { goalLockTicks: null },
    { answerWindow: 250 },
  ]) {
    expect(parseContentPack(packWithPetitionBalance(bad)).ok).toBe(false);
  }
  expect(parseContentPack(packWithPetitionBalance([250])).ok).toBe(false);
});

function packWithPracticeBalance(
  practiceBalance: unknown,
): Record<string, unknown> {
  const pack = validPack();
  (pack.rules as Record<string, unknown>).practiceBalance = practiceBalance;
  return pack;
}

test("practice tunables are strict: each a positive whole number, unknown keys refused, a missing record means every default", () => {
  const good = {
    negotiationTicks: 200,
    counterBudget: 3,
    minTermTicks: 25,
    maxTermTicks: 500,
    oathDivinityLoss: 3,
    oathAccessTicks: 100,
    standingDelta: 1,
  };
  const parsed = parseContentPack(packWithPracticeBalance(good));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value.rules.practiceBalance).toEqual(good);
  expect(
    parseContentPack(packWithPracticeBalance({ counterBudget: 2 })).ok,
  ).toBe(true);
  const plain = parseContentPack(validPack());
  expect(plain.ok && plain.value.rules.practiceBalance === undefined).toBe(
    true,
  );

  for (const bad of [
    { negotiationTicks: 0 },
    { counterBudget: -1 },
    { counterBudget: 2.5 },
    { minTermTicks: "soon" },
    { maxTermTicks: Number.POSITIVE_INFINITY },
    { oathDivinityLoss: 0 },
    { oathAccessTicks: 1.5 },
    { standingDelta: -1 },
    { oathPenalty: 3 },
    { counterBudgt: 3 },
    { answerWindowTicks: 250 },
    ["counterBudget"],
  ]) {
    expect(parseContentPack(packWithPracticeBalance(bad)).ok).toBe(false);
  }
});

test("practice tunables include how pious a mortal must be to take terms and how near a deadline is urgent; both positive whole numbers", () => {
  const good = { acceptPietyPercent: 10, urgentTicks: 50 };
  const parsed = parseContentPack(packWithPracticeBalance(good));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value.rules.practiceBalance).toEqual(good);
  for (const bad of [
    { acceptPietyPercent: 0 },
    { urgentTicks: 2.5 },
    { urgentTicks: "soon" },
  ]) {
    expect(parseContentPack(packWithPracticeBalance(bad)).ok).toBe(false);
  }
});

function packWithStakes(practiceStakes: unknown): Record<string, unknown> {
  const pack = validPack();
  (pack.rules as Record<string, unknown>).practiceStakes = practiceStakes;
  return pack;
}

test("the stakes a god may set on terms are authored in the rules and parsed strictly: an id for each, a form, and the capabilities it gains and loses", () => {
  const wolf = {
    form: "wolf",
    capabilitiesGained: ["beast-form"],
    capabilitiesLost: [],
  };
  const parsed = parseContentPack(packWithStakes({ wolf }));
  expect(parsed.ok).toBe(true);
  if (parsed.ok)
    expect(parsed.value.rules.practiceStakes).toEqual({ wolf } as never);
  // Without any, no stake can be set, and nothing else changes.
  const plain = parseContentPack(validPack());
  expect(plain.ok && plain.value.rules.practiceStakes === undefined).toBe(true);
  for (const bad of [
    ["wolf"],
    { wolf: "a wolf" },
    { wolf: { ...wolf, form: "" } },
    {
      wolf: {
        form: "wolf",
        capabilitiesGained: "beast-form",
        capabilitiesLost: [],
      },
    },
    { wolf: { form: "wolf", capabilitiesGained: [] } },
    { wolf: { ...wolf, name: "extra" } },
    { "": wolf },
  ]) {
    expect([
      JSON.stringify(bad),
      parseContentPack(packWithStakes(bad)).ok,
    ]).toEqual([JSON.stringify(bad), false]);
  }
});

test("the trouble-kind table names a god of the pack for each known kind: a typo'd kind, a mortal, or an unknown god is refused", () => {
  const withTable = (table: unknown) => {
    const pack = validPack();
    (pack.rules as Record<string, unknown>).troubleKinds = table;
    return parseContentPack(pack);
  };
  const good = withTable({ fire: "athena", theft: "athena" });
  expect(good.ok).toBe(true);
  if (good.ok) {
    expect(good.value.rules.troubleKinds).toEqual({
      fire: "athena",
      theft: "athena",
    });
  }
  const plain = parseContentPack(validPack());
  expect(plain.ok && plain.value.rules.troubleKinds === undefined).toBe(true);
  for (const [bad, path] of [
    [{ fyre: "athena" }, "rules.troubleKinds.fyre"],
    [{ fire: "npc-1" }, "rules.troubleKinds.fire"],
    [{ fire: "nike" }, "rules.troubleKinds.fire"],
    [{ fire: 3 }, "rules.troubleKinds.fire"],
    [["athena"], "rules.troubleKinds"],
  ] as const) {
    const result = withTable(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe(path);
  }
});
