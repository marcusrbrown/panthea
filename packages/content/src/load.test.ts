import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContentPack, loadGodProfiles } from "./load";

const GREEK_WORLD_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "content",
  "greek",
  "world",
);

const GREEK_GODS_DIR = join(GREEK_WORLD_DIR, "..", "gods");

function withTempDir(build: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "panthea-content-test-"));
  build(dir);
  return dir;
}

function validLocations(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    realms: ["mortal", "olympus", "underworld"],
    locations: [
      {
        id: "agora",
        realm: "mortal",
        name: "The Agora",
        edges: [{ to: "tavern", transport: "path", bidirectional: true }],
      },
      { id: "tavern", realm: "mortal", name: "The Tavern", edges: [] },
    ],
  };
}

function validRules(): Record<string, unknown> {
  return {
    resources: [{ resource: "currency", amount: 0 }],
    rules: {
      catchUpCapMs: 3_600_000,
      catchUpChunkMs: 60_000,
      checkpointIntervalMs: 60_000,
      maxProposalsPerTick: 50,
      fireBalance: { spreadChancePerTick: 0.1 },
      economyBalance: { priceFloor: 1, priceCeiling: 100 },
    },
  };
}

test("a valid minimal content pack loads from locations.json and rules.json alone", () => {
  const dir = withTempDir((d) => {
    writeFileSync(join(d, "locations.json"), JSON.stringify(validLocations()));
    writeFileSync(join(d, "rules.json"), JSON.stringify(validRules()));
  });
  const result = loadContentPack(dir);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.locations).toHaveLength(2);
    expect(result.value.buildings).toEqual([]);
    expect(result.value.inhabitants).toEqual([]);
  }
  rmSync(dir, { recursive: true, force: true });
});

test("optional buildings.json and inhabitants.json are picked up when present", () => {
  const dir = withTempDir((d) => {
    writeFileSync(join(d, "locations.json"), JSON.stringify(validLocations()));
    writeFileSync(join(d, "rules.json"), JSON.stringify(validRules()));
    writeFileSync(
      join(d, "buildings.json"),
      JSON.stringify({
        buildings: [
          {
            id: "tavern-bldg",
            locationId: "tavern",
            name: "The Tavern",
            material: "wood",
            combustible: true,
            services: ["lodging"],
            inventory: [],
          },
        ],
      }),
    );
    writeFileSync(
      join(d, "inhabitants.json"),
      JSON.stringify({
        inhabitants: [
          {
            id: "npc-1",
            name: "Tavernkeeper",
            locationId: "tavern",
            drives: { thrift: 0.5, appetite: 0.2, greed: 0.1, piety: 0.3 },
            devotion: { god: "zeus", affinity: 2 },
          },
          { id: "zeus", name: "Zeus", locationId: "tavern", deity: true },
        ],
      }),
    );
  });
  const result = loadContentPack(dir);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.buildings).toHaveLength(1);
    expect(result.value.inhabitants).toHaveLength(2);
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a missing locations.json fails loudly and distinctly from a parse failure", () => {
  const dir = withTempDir((d) => {
    writeFileSync(join(d, "rules.json"), JSON.stringify(validRules()));
  });
  const result = loadContentPack(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.message).toContain("locations.json");
    expect(result.message).toContain("missing");
  }
  rmSync(dir, { recursive: true, force: true });
});

test("malformed JSON syntax fails loudly with a clear message", () => {
  const dir = withTempDir((d) => {
    writeFileSync(join(d, "locations.json"), "{ not valid json");
    writeFileSync(join(d, "rules.json"), JSON.stringify(validRules()));
  });
  const result = loadContentPack(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.message).toContain("not valid JSON");
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a location referencing an unknown realm fails to load with a clear message", () => {
  const dir = withTempDir((d) => {
    const locations = validLocations();
    (locations.locations as Record<string, unknown>[])[0].realm = "atlantis";
    writeFileSync(join(d, "locations.json"), JSON.stringify(locations));
    writeFileSync(join(d, "rules.json"), JSON.stringify(validRules()));
  });
  const result = loadContentPack(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe("locations[0].realm");
  }
  rmSync(dir, { recursive: true, force: true });
});

test("the authored Greek world content loads with the expected geography and rule values", () => {
  const result = loadContentPack(GREEK_WORLD_DIR);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(
      `Greek world content failed to load: ${result.path}: ${result.message}`,
    );
  }
  const pack = result.value;

  expect(pack.realms).toEqual(
    expect.arrayContaining(["mortal", "olympus", "underworld"]),
  );

  const locationIds = pack.locations.map((location) => location.id).sort();
  expect(locationIds).toEqual(
    [
      "altar",
      "ancient-olive-tree",
      "asphodel-meadow",
      "ferry-dock",
      "forge",
      "great-hall",
      "inn",
      "judgment-hall",
      "mountain-path",
      "olympus-gate",
      "shop",
      "tavern",
      "town-square",
      "underworld-shore",
      "wilderness-grove",
      "wilderness-path",
    ].sort(),
  );

  // One authored transport edge into each divine realm, not just any edge.
  const ferryDock = pack.locations.find(
    (location) => location.id === "ferry-dock",
  );
  expect(ferryDock?.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        to: "underworld-shore",
        transport: "divine-transport",
        bidirectional: true,
      }),
    ]),
  );

  const mountainPath = pack.locations.find(
    (location) => location.id === "mountain-path",
  );
  expect(mountainPath?.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        to: "olympus-gate",
        transport: "divine-transport",
        bidirectional: true,
      }),
    ]),
  );

  // Representative rule values from rules.json, not just "rules exist".
  expect(pack.rules.catchUpCapMs).toBe(3_600_000);
  expect(pack.rules.fireBalance).toMatchObject({ spreadChancePerTick: 0.1 });
  expect(pack.rules.economyBalance).toMatchObject({
    priceFloor: 1,
    priceCeiling: 100,
  });

  // The authored town: the woodcutter and the farmer it began with, eighteen
  // more mortals who live by the harbour, the grove, the forge, and the square,
  // and seven gods (greek-cast.test.ts reads the cast closely).
  const inhabitantIds = pack.inhabitants.map((i) => i.id);
  expect(inhabitantIds).toHaveLength(27);
  for (const id of ["farmer", "woodcutter", "zeus", "hera"]) {
    expect(inhabitantIds).toContain(id);
  }

  for (const id of ["zeus", "hera"]) {
    const god = pack.inhabitants.find((i) => i.id === id);
    expect(god?.deity).toBe(true);
    expect(god?.drives).toBeUndefined();
  }

  const buildingIds = pack.buildings.map((b) => b.id).sort();
  expect(buildingIds).toEqual([
    "agora-shop",
    "fish-landing",
    "loom-house",
    "old-oak",
    "olive-press",
    "the-forge",
    "the-tavern",
    "woodshed",
  ]);
  const shop = pack.buildings.find((b) => b.id === "agora-shop");
  expect(shop).toMatchObject({
    owner: "farmer",
    locationId: "shop",
    combustible: false,
  });
  const tavern = pack.buildings.find((b) => b.id === "the-tavern");
  expect(tavern).toMatchObject({
    owner: "farmer",
    locationId: "tavern",
    combustible: true,
  });

  // The woodcutter's recipe: wood converts into planks.
  expect(pack.recipes.planks).toMatchObject({
    inputs: [{ resource: "wood", amount: 2 }],
    outputs: [{ resource: "planks", amount: 1 }],
  });
});

test("the Greek pack parses with the seven gods' profiles", () => {
  const packResult = loadContentPack(GREEK_WORLD_DIR);
  if (!packResult.ok) {
    throw new Error(`${packResult.path}: ${packResult.message}`);
  }
  const result = loadGodProfiles(GREEK_GODS_DIR, packResult.value);
  if (!result.ok) {
    throw new Error(`${result.path}: ${result.message}`);
  }
  const gods = result.value;
  expect(gods.map((god) => god.id).sort()).toEqual([
    "athena",
    "hades",
    "hephaestus",
    "hera",
    "hermes",
    "poseidon",
    "zeus",
  ]);

  for (const god of gods) {
    expect(god.lore.length).toBeGreaterThan(0);
    expect(god.abilities.length).toBeGreaterThan(0);
    expect(god.variants.length).toBeGreaterThan(0);
    expect(god.sprite.length).toBeGreaterThan(0);
    for (const line of god.lore) {
      expect(line.cites.length).toBeGreaterThan(0);
    }
  }

  const zeus = gods.find((god) => god.id === "zeus");
  expect(zeus?.abilities.map((ability) => ability.action)).toContain("strike");
  const hera = gods.find((god) => god.id === "hera");
  expect(hera?.relationships).toEqual(
    expect.arrayContaining([expect.objectContaining({ target: "zeus" })]),
  );
});

test("a missing gods directory yields no profiles", () => {
  const dir = withTempDir(() => {});
  const packResult = loadContentPack(GREEK_WORLD_DIR);
  if (!packResult.ok) throw new Error(packResult.message);
  const result = loadGodProfiles(join(dir, "gods"), packResult.value);
  expect(result).toEqual({ ok: true, value: [] });
  rmSync(dir, { recursive: true, force: true });
});

test("a malformed profile file is reported by file name", () => {
  const dir = withTempDir((d) => {
    writeFileSync(join(d, "zeus.json"), "{ not valid json");
  });
  const packResult = loadContentPack(GREEK_WORLD_DIR);
  if (!packResult.ok) throw new Error(packResult.message);
  const result = loadGodProfiles(dir, packResult.value);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe("zeus.json");
    expect(result.message).toContain("not valid JSON");
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a recipes key in rules.json is merged into the parsed content pack", () => {
  const dir = withTempDir((d) => {
    writeFileSync(join(d, "locations.json"), JSON.stringify(validLocations()));
    const rules = validRules();
    (rules as Record<string, unknown>).recipes = {
      planks: {
        inputs: [{ resource: "wood", amount: 2 }],
        outputs: [{ resource: "planks", amount: 1 }],
      },
    };
    writeFileSync(join(d, "rules.json"), JSON.stringify(rules));
  });
  const result = loadContentPack(dir);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.recipes.planks).toMatchObject({
      inputs: [{ resource: "wood", amount: 2 }],
      outputs: [{ resource: "planks", amount: 1 }],
    });
  }
  rmSync(dir, { recursive: true, force: true });
});
