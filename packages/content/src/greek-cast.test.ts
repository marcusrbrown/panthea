import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROPOSAL_KINDS } from "@panthea/contracts";
import { parseGodProfiles } from "./god-profile";
import { loadContentPack, loadGodProfiles } from "./load";

const GREEK = join(import.meta.dir, "..", "..", "..", "content", "greek");
const WORLD = join(GREEK, "world");
const GODS = join(GREEK, "gods");

const GOD_IDS = [
  "athena",
  "hades",
  "hephaestus",
  "hera",
  "hermes",
  "poseidon",
  "zeus",
];

/** The world actions a god's ability may name: each is a rule the validator already enforces. */
const WORLD_RULE_ACTIONS = [
  "move",
  "realm-transition",
  "strike",
  "legend",
  "report",
  "bless",
  "practice",
] as const;

function loaded() {
  const pack = loadContentPack(WORLD);
  if (!pack.ok) throw new Error(`${pack.path}: ${pack.message}`);
  const profiles = loadGodProfiles(GODS, pack.value);
  if (!profiles.ok) throw new Error(`${profiles.path}: ${profiles.message}`);
  return { pack: pack.value, profiles: profiles.value };
}

test("the full Greek pack parses with seven gods, each with a sourced profile, and twenty mortals (R20, R21)", () => {
  const { pack, profiles } = loaded();
  const deities = pack.inhabitants.filter((i) => i.deity === true);
  expect(deities.map((d) => d.id).sort()).toEqual(GOD_IDS);
  expect(profiles.map((p) => p.id).sort()).toEqual(GOD_IDS);
  const mortals = pack.inhabitants.filter((i) => i.deity !== true);
  expect(mortals).toHaveLength(20);
  // Every mortal runs a routine: drives, and a livelihood or a want.
  for (const mortal of mortals) {
    expect(mortal.drives).toBeDefined();
    expect(mortal.gathers !== undefined || mortal.wants !== undefined).toBe(
      true,
    );
  }
  // Mortals are named uniquely.
  expect(new Set(pack.inhabitants.map((i) => i.id)).size).toBe(
    pack.inhabitants.length,
  );
});

test("every profile cites its sources and labels what the game invented, apart from lore (W01)", () => {
  const { profiles } = loaded();
  for (const profile of profiles) {
    expect(profile.lore.length).toBeGreaterThan(0);
    for (const line of profile.lore) {
      expect(line.cites.length).toBeGreaterThan(0);
    }
    for (const source of profile.sources) {
      // A source says when it was checked, and where it was read (the first two profiles predate the url convention for Apollodorus).
      expect(source.accessed).toBeDefined();
      if (profile.id !== "zeus" && profile.id !== "hera") {
        expect(source.url).toBeDefined();
      }
    }
    // Drives, starting dispositions, and any ability mapping are the game's, and say so.
    expect(profile.inventions.map((i) => i.id)).toContain("authored-tuning");
    expect(profile.inventions.length).toBeGreaterThan(0);
    // Each source is used.
    const cited = new Set(
      [...profile.lore, ...profile.variants, ...profile.troubles].flatMap(
        (entry) => entry.cites.map((cite) => cite.source),
      ),
    );
    for (const source of profile.sources) {
      expect(cited.has(source.id)).toBe(true);
    }
  }
});

test("every ability resolves to a world rule: an action the validator enforces, paid in divinity", () => {
  const { profiles } = loaded();
  for (const profile of profiles) {
    expect(profile.abilities.length).toBeGreaterThan(0);
    for (const ability of profile.abilities) {
      expect(PROPOSAL_KINDS as readonly string[]).toContain(ability.action);
      expect(WORLD_RULE_ACTIONS as readonly string[]).toContain(ability.action);
      if (ability.cost !== undefined) {
        expect(ability.cost.resource).toBe("divinity");
      }
      if (ability.action === "strike") {
        expect(ability.parameters?.power).toBeGreaterThan(0);
      }
    }
  }
});

test("a rivalry naming an unknown god fails to parse (R20)", () => {
  const { pack } = loaded();
  const raw = JSON.parse(readFileSync(join(GODS, "athena.json"), "utf8"));
  raw.relationships.push({
    target: "nike",
    kind: "rival",
    disposition: -0.5,
  });
  const result = parseGodProfiles(
    [{ label: "athena.json", value: raw }],
    pack.inhabitants,
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe(
      `athena.json.relationships[${raw.relationships.length - 1}].target`,
    );
  }
});

test("relationships name only sourced ties between gods in the pack, and the rivalries over a place's people are felt both ways", () => {
  const { pack, profiles } = loaded();
  const gods = new Set(
    pack.inhabitants.filter((i) => i.deity).map((i) => i.id),
  );
  const rivals = new Set<string>();
  for (const profile of profiles) {
    for (const tie of profile.relationships) {
      expect(gods.has(tie.target)).toBe(true);
      expect(tie.target).not.toBe(profile.id);
      // A tie is explained by the profile's own lore or variants, never bare tuning.
      const mentioned = [...profile.lore, ...profile.variants].some((entry) =>
        ("statement" in entry ? entry.statement : entry.note)
          .toLowerCase()
          .includes(tie.target),
      );
      expect(mentioned).toBe(true);
      if (tie.kind.includes("rival")) rivals.add(`${profile.id}>${tie.target}`);
    }
  }
  // Athena and Poseidon contest Athens; Poseidon and Hera contest Argos.
  expect(rivals.has("athena>poseidon")).toBe(true);
  expect(rivals.has("poseidon>athena")).toBe(true);
  expect(rivals.has("poseidon>hera")).toBe(true);
});

test("the rivalries the world judges are the ones the profiles source: a contest opens only between gods whose profile names a rivalry, read both ways (R16)", () => {
  const { pack, profiles } = loaded();
  const pairs = (list: [string, string][]) =>
    [...new Set(list.map(([a, b]) => [a, b].sort().join("|")))].sort();
  const fromProfiles: [string, string][] = profiles.flatMap((profile) =>
    profile.relationships
      .filter((tie) => tie.kind.includes("rival"))
      .map((tie): [string, string] => [profile.id, tie.target]),
  );
  const fromPack: [string, string][] = pack.inhabitants.flatMap((inhabitant) =>
    (inhabitant.rivals ?? []).map((rival): [string, string] => [
      inhabitant.id,
      rival,
    ]),
  );
  expect(pairs(fromPack)).toEqual(pairs(fromProfiles));
  // The two contests over a place's people: Athens (Athena, Poseidon) and Argos (Poseidon, Hera).
  expect(pairs(fromPack)).toEqual(["athena|poseidon", "hera|poseidon"]);
  // Only gods have rivals.
  for (const inhabitant of pack.inhabitants) {
    if (inhabitant.rivals !== undefined) expect(inhabitant.deity).toBe(true);
  }
});

test("each god starts where its stakes are, and the places the pack already had are kept", () => {
  const { pack } = loaded();
  const at = (id: string) =>
    pack.inhabitants.find((i) => i.id === id)?.locationId;
  expect(at("zeus")).toBe("great-hall");
  expect(at("hera")).toBe("great-hall");
  expect(at("athena")).toBe("ancient-olive-tree");
  expect(at("hermes")).toBe("ferry-dock");
  expect(at("poseidon")).toBe("ferry-dock");
  expect(at("hephaestus")).toBe("forge");
  expect(at("hades")).toBe("underworld-shore");
  const places = new Set(pack.locations.map((l) => l.id));
  for (const kept of [
    "wilderness-grove",
    "ancient-olive-tree",
    "wilderness-path",
    "town-square",
    "tavern",
    "inn",
    "shop",
    "altar",
    "ferry-dock",
    "mountain-path",
    "underworld-shore",
    "asphodel-meadow",
    "judgment-hall",
    "olympus-gate",
    "great-hall",
    "forge",
  ]) {
    expect(places.has(kept)).toBe(true);
  }
});

test("every livelihood gives at least two gods a stake the town can feel: its people revere different gods (R21)", () => {
  const { pack } = loaded();
  const gods = new Set(
    pack.inhabitants.filter((i) => i.deity).map((i) => i.id),
  );
  const mortals = pack.inhabitants.filter((i) => i.deity !== true);
  for (const mortal of mortals) {
    expect(mortal.devotion).toBeDefined();
    expect(gods.has(mortal.devotion?.god ?? "")).toBe(true);
  }
  const byPlace = new Map<string, Set<string>>();
  for (const mortal of mortals) {
    const set = byPlace.get(mortal.locationId) ?? new Set<string>();
    set.add(mortal.devotion?.god ?? "");
    byPlace.set(mortal.locationId, set);
  }
  for (const place of ["ferry-dock", "ancient-olive-tree", "forge"]) {
    expect(byPlace.get(place)?.size).toBeGreaterThanOrEqual(2);
  }
  // The domain fits: fishers pray to Poseidon, smiths to Hephaestus, olive growers and weavers to Athena, traders to Hermes.
  const devotedTo = (id: string) =>
    mortals.find((m) => m.id === id)?.devotion?.god;
  const fisher = mortals.find((m) => m.id.startsWith("fisher-"));
  expect(fisher?.gathers).toBe("fish");
  const devotees = (god: string) =>
    mortals.filter((m) => m.devotion?.god === god);
  for (const god of ["athena", "hephaestus", "hermes", "poseidon"]) {
    expect(devotees(god).length).toBeGreaterThanOrEqual(2);
  }
  expect(devotees("poseidon").every((m) => m.locationId !== "forge")).toBe(
    true,
  );
  expect(devotedTo("farmer")).toBe("hera");
  expect(devotedTo("woodcutter")).toBe("zeus");
});

test("every god has at least one devotee, Hades included: a god no mortal prays to never enters a practice (R20)", () => {
  const { pack } = loaded();
  const gods = pack.inhabitants
    .filter((i) => i.deity === true)
    .map((i) => i.id);
  const mortals = pack.inhabitants.filter((i) => i.deity !== true);
  for (const god of gods) {
    expect(
      mortals.filter((m) => m.devotion?.god === god).length,
    ).toBeGreaterThanOrEqual(1);
  }
  // The ferryman, whose ferry is the road to the dead, keeps Hades's rites; Hermes keeps others.
  expect(mortals.find((m) => m.id === "ferryman")?.devotion?.god).toBe("hades");
  expect(
    mortals.filter((m) => m.devotion?.god === "hermes").length,
  ).toBeGreaterThanOrEqual(2);
  // The twenty mortals are still twenty.
  expect(mortals).toHaveLength(20);
});

test("the profile says the ferryman's rites are the game's, not the sources': Hades's sources name no ferryman", () => {
  const { profiles } = loaded();
  const hades = profiles.find((p) => p.id === "hades");
  const invention = hades?.inventions.find((i) => i.id === "ferryman-rites");
  expect(invention).toBeDefined();
  expect(invention?.statement).toContain("ferryman");
  // Nothing in his lore or variants cites a ferryman: the claim is labeled invention, not lore.
  const lore = [...(hades?.lore ?? []), ...(hades?.variants ?? [])].map(
    (entry) => ("statement" in entry ? entry.statement : entry.note),
  );
  expect(lore.some((text) => text.toLowerCase().includes("ferry"))).toBe(false);
});

test("every resource a livelihood gathers, wants, or makes is declared and priced", () => {
  const { pack } = loaded();
  const declared = new Set(pack.resources.map((r) => r.resource));
  const resources = new Set<string>();
  for (const mortal of pack.inhabitants) {
    if (mortal.gathers) resources.add(mortal.gathers);
    if (mortal.wants) resources.add(mortal.wants);
  }
  for (const recipe of Object.values(pack.recipes ?? {})) {
    for (const line of [...recipe.inputs, ...recipe.outputs]) {
      resources.add(line.resource);
    }
  }
  for (const resource of resources) {
    expect(declared.has(resource)).toBe(true);
    expect(pack.rules.economyBalance[`value_${resource}`]).toBeGreaterThan(0);
  }
});

test("every mortal of the Greek town is authored a temperament, the odds table covers each, and the honest have none", () => {
  const { pack } = loaded();
  const mortals = pack.inhabitants.filter((i) => i.deity !== true);
  for (const mortal of mortals) {
    expect([mortal.id, mortal.temperament !== undefined]).toEqual([
      mortal.id,
      true,
    ]);
  }
  // The town has each temperament, so each row of the table is used.
  expect(new Set(mortals.map((m) => m.temperament))).toEqual(
    new Set(["greedy", "quarrelsome", "proud", "honest"]),
  );
  const odds = pack.rules.temperamentOdds ?? {};
  expect(Object.keys(odds).sort()).toEqual([
    "greedy",
    "honest",
    "proud",
    "quarrelsome",
  ]);
  expect(Object.values(odds.honest ?? {}).every((value) => value === 0)).toBe(
    true,
  );
  // Gods have none.
  expect(
    pack.inhabitants.filter(
      (i) => i.deity === true && i.temperament !== undefined,
    ),
  ).toEqual([]);
});

test("every god has at least one sourced domain trouble the pack's table draws, and the table draws only sourced ones (R14)", () => {
  const { pack, profiles } = loaded();
  const troubles = pack.rules.troubles ?? {};
  for (const profile of profiles) {
    expect(profile.troubles.length).toBeGreaterThan(0);
    for (const trouble of profile.troubles) {
      expect(trouble.cites.length).toBeGreaterThan(0);
      // The trouble is the game's own and says so.
      expect(profile.inventions.map((i) => i.id)).toContain(trouble.invention);
      expect(pack.rules.troubleKinds?.[trouble.id]).toBe(profile.id);
      expect(troubles[trouble.id]).toBeDefined();
    }
  }
  const listed = profiles.flatMap((p) => p.troubles.map((t) => t.id)).sort();
  expect(listed).toEqual(Object.keys(troubles).sort());
});

test("hades's troubles need no death: each takes goods, never a life, and no trouble names a mortal's death", () => {
  const { pack } = loaded();
  const hades = Object.entries(pack.rules.troubles ?? {}).filter(
    ([id]) => pack.rules.troubleKinds?.[id] === "hades",
  );
  expect(hades.length).toBeGreaterThan(0);
  for (const [, trouble] of hades) expect(trouble.effect).toBe("resource");
});

test("a trouble in a profile with no source, a trouble no pack table has, one that belongs to another god, or one the table draws that no profile sources, each fails to parse", () => {
  const { pack } = loaded();
  const read = (god: string) =>
    JSON.parse(readFileSync(join(GODS, `${god}.json`), "utf8"));
  const parse = (athena: unknown, rules = pack.rules) =>
    parseGodProfiles(
      [{ label: "athena.json", value: athena }],
      pack.inhabitants,
      rules,
    );
  expect(parse(read("athena")).ok).toBe(true);

  const noCite = read("athena");
  noCite.troubles[0].cites = [];
  expect(parse(noCite)).toMatchObject({
    ok: false,
    path: "athena.json.troubles[0].cites",
  });

  const unknownSource = read("athena");
  unknownSource.troubles[0].cites = [{ source: "nowhere", locator: "1" }];
  expect(parse(unknownSource).ok).toBe(false);

  const noInvention = read("athena");
  noInvention.troubles[0].invention = "not-an-invention";
  expect(parse(noInvention)).toMatchObject({
    ok: false,
    path: "athena.json.troubles[0].invention",
  });

  const unlabelled = read("athena");
  delete unlabelled.troubles[0].invention;
  expect(parse(unlabelled).ok).toBe(false);

  const unknownTrouble = read("athena");
  unknownTrouble.troubles.push({ ...unknownTrouble.troubles[0], id: "plague" });
  expect(parse(unknownTrouble)).toMatchObject({
    ok: false,
    path: "athena.json.troubles[2].id",
  });

  // A trouble the table gives to another god fails in the profile that claims it.
  const stolen = read("athena");
  stolen.troubles.push({ ...stolen.troubles[0], id: "squall" });
  expect(parse(stolen)).toMatchObject({
    ok: false,
    path: "athena.json.troubles[2].id",
  });

  // A trouble the table draws that its god's profile does not source.
  const unsourced = read("athena");
  unsourced.troubles.pop();
  expect(parse(unsourced)).toMatchObject({
    ok: false,
    path: "athena.troubles",
  });

  // A duplicate in one profile.
  const twice = read("athena");
  twice.troubles.push(twice.troubles[0]);
  expect(parse(twice).ok).toBe(false);
});

test("the trouble table gives each kind one god: household spoilage to Hera, the director's no-thief theft to Hermes, forge fire to Hephaestus, sky to Zeus, sea and quakes to Poseidon (R2)", () => {
  const { pack } = loaded();
  const kinds = pack.rules.troubleKinds ?? {};
  expect(kinds.spoilage).toBe("hera");
  expect(kinds.theft).toBe("hermes");
  expect(kinds.fire).toBe("hephaestus");
  for (const id of ["squall", "lightning-fire"]) expect(kinds[id]).toBe("zeus");
  for (const id of ["harbour-surge", "quake"])
    expect(kinds[id]).toBe("poseidon");
  // Every kind names a god in the cast, and a god exactly once per kind (a record has one value per key).
  const gods = new Set(GOD_IDS);
  for (const god of Object.values(kinds)) expect(gods.has(god)).toBe(true);
  // Each trouble's loss is the world's own substrate: goods taken, or a building damaged.
  for (const trouble of Object.values(pack.rules.troubles ?? {})) {
    expect(["resource", "building"]).toContain(trouble.effect);
  }
  // Every season has a trouble that can come in it, so no season is quiet.
  for (const season of ["spring", "summer", "autumn", "winter"] as const) {
    expect(
      Object.values(pack.rules.troubles ?? {}).some(
        (t) => (t.seasons[season] ?? 0) > 0,
      ),
    ).toBe(true);
  }
});
