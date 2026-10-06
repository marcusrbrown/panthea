import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadContentPack, loadGodProfiles } from "@panthea/content";
import {
  createInitialWorldState,
  DEFAULT_MEMORY_BALANCE,
  DEFAULT_PETITION_BALANCE,
  DEFAULT_PRACTICE_BALANCE,
} from "@panthea/world";
import {
  loadEmbeddedGreekGodProfiles,
  loadEmbeddedGreekWorldPack,
} from "./greek-world-pack";

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

test("the embedded Greek pack parses to the same content pack as loading content/greek/world from disk", () => {
  const embedded = loadEmbeddedGreekWorldPack();
  expect(embedded.ok).toBe(true);

  const fromDisk = loadContentPack(GREEK_WORLD_DIR);
  expect(fromDisk.ok).toBe(true);

  if (!embedded.ok || !fromDisk.ok) {
    return;
  }
  expect(embedded.value).toEqual(fromDisk.value);
});

test("the embedded pack carries the seven gods' profiles, identical to content/greek/gods on disk", () => {
  const pack = loadEmbeddedGreekWorldPack();
  if (!pack.ok) throw new Error(pack.message);

  const embedded = loadEmbeddedGreekGodProfiles(pack.value);
  const fromDisk = loadGodProfiles(GREEK_GODS_DIR, pack.value);
  if (!embedded.ok) throw new Error(`${embedded.path}: ${embedded.message}`);
  if (!fromDisk.ok) throw new Error(`${fromDisk.path}: ${fromDisk.message}`);

  expect(embedded.value.map((god) => god.id).sort()).toEqual([
    "athena",
    "hades",
    "hephaestus",
    "hera",
    "hermes",
    "poseidon",
    "zeus",
  ]);
  expect(embedded.value).toEqual(fromDisk.value);
});

test("the embedded Greek pack builds the same initial WorldState as loading content/greek/world from disk", () => {
  const embedded = loadEmbeddedGreekWorldPack();
  const fromDisk = loadContentPack(GREEK_WORLD_DIR);
  if (!embedded.ok || !fromDisk.ok) {
    throw new Error("expected both loads to succeed");
  }

  const embeddedState = createInitialWorldState(embedded.value);
  const fromDiskState = createInitialWorldState(fromDisk.value);
  expect(embeddedState).toEqual(fromDiskState);
});

test("the Greek pack states the memory tunables the world rules default to, so a retune edits one place and shows in both", () => {
  const pack = loadEmbeddedGreekWorldPack();
  if (!pack.ok) throw new Error(pack.message);
  expect(pack.value.rules.memoryBalance).toEqual(DEFAULT_MEMORY_BALANCE);
});

test("the Greek pack gives the woodcutter a woodshed at the square, so a theft by him can be punished, and carries strict petition tunables", () => {
  const pack = loadEmbeddedGreekWorldPack();
  if (!pack.ok) throw new Error(pack.message);
  const shed = pack.value.buildings.find((b) => b.id === "woodshed");
  expect(shed).toMatchObject({
    owner: "woodcutter",
    locationId: "town-square",
    combustible: true,
  });
  // The woodcutter is the only owner of it, and the farmer's buildings are unchanged.
  expect(
    pack.value.buildings.filter((b) => b.owner === "farmer").map((b) => b.id),
  ).toEqual(["agora-shop", "the-tavern"]);
  expect(Object.keys(pack.value.rules.petitionBalance ?? {}).sort()).toEqual(
    [
      "answerWindowTicks",
      "blessDivinityCost",
      "blessPlanks",
      "blessResourceAmount",
      "blessResourceCap",
      "causePrayableTicks",
      "directorIntervalTicks",
      "goalLockTicks",
      "prayerCooldownTicks",
      "revengeWindowTicks",
      "seasonTicks",
      "strikeGoodsCap",
      "troubleFloorTicks",
      "troubleLossCap",
      "wrongCooldownTicks",
      "wrongLossCap",
      "wrongNeedMultiplier",
      "creditDeadlineTicks",
      "defectionAffinity",
    ].sort(),
  );
});

test("the Greek pack states the petition tunables the world rules default to, so a retune edits one place and shows in both", () => {
  const pack = loadEmbeddedGreekWorldPack();
  if (!pack.ok) throw new Error(pack.message);
  expect(pack.value.rules.petitionBalance).toEqual(DEFAULT_PETITION_BALANCE);
});

test("the Greek pack states the practice tunables the world rules default to, strictly parsed", () => {
  const pack = loadEmbeddedGreekWorldPack();
  if (!pack.ok) throw new Error(pack.message);
  expect(pack.value.rules.practiceBalance).toEqual(DEFAULT_PRACTICE_BALANCE);
});

test("PANTHEA_PRACTICE_BALANCE overrides practice tunables over the authored ones (a scenario shortens a contest's window), and anything invalid is refused", () => {
  const authored = loadEmbeddedGreekWorldPack({});
  if (!authored.ok) throw new Error(authored.message);
  const short = loadEmbeddedGreekWorldPack({
    PANTHEA_PRACTICE_BALANCE: JSON.stringify({ contestWindowTicks: 25 }),
  });
  if (!short.ok) throw new Error(short.message);
  expect(short.value.rules.practiceBalance).toEqual({
    ...authored.value.rules.practiceBalance,
    contestWindowTicks: 25,
  });
  // The petition tunables are untouched by it, and the two overrides combine.
  const both = loadEmbeddedGreekWorldPack({
    PANTHEA_PRACTICE_BALANCE: JSON.stringify({ contestWindowTicks: 25 }),
    PANTHEA_PETITION_BALANCE: JSON.stringify({ directorIntervalTicks: 100000 }),
  });
  if (!both.ok) throw new Error(both.message);
  expect(both.value.rules.practiceBalance?.contestWindowTicks).toBe(25);
  expect(both.value.rules.petitionBalance?.directorIntervalTicks).toBe(100000);
  // Without it, or empty, the authored tunables stand.
  const unset = loadEmbeddedGreekWorldPack({ PANTHEA_PRACTICE_BALANCE: "" });
  expect(unset.ok && unset.value.rules.practiceBalance).toEqual(
    authored.value.rules.practiceBalance,
  );
  for (const bad of [
    '{"contestWindow": 5}',
    '{"contestWindowTicks": 0}',
    "not json",
    "[1]",
  ]) {
    const result = loadEmbeddedGreekWorldPack({
      PANTHEA_PRACTICE_BALANCE: bad,
    });
    expect(result.ok).toBe(false);
  }
});

test("PANTHEA_PETITION_BALANCE overrides petition tunables over the authored ones, and anything invalid is refused", () => {
  const authored = loadEmbeddedGreekWorldPack({});
  if (!authored.ok) throw new Error(authored.message);
  const quiet = loadEmbeddedGreekWorldPack({
    PANTHEA_PETITION_BALANCE: JSON.stringify({ directorIntervalTicks: 100000 }),
  });
  if (!quiet.ok) throw new Error(quiet.message);
  expect(quiet.value.rules.petitionBalance).toEqual({
    ...authored.value.rules.petitionBalance,
    directorIntervalTicks: 100000,
  });
  // Without it, or empty, the authored tunables stand.
  const unset = loadEmbeddedGreekWorldPack({ PANTHEA_PETITION_BALANCE: "" });
  expect(unset.ok && unset.value.rules.petitionBalance).toEqual(
    authored.value.rules.petitionBalance,
  );
  // Control: a tunable that does not exist, a non-positive value, and text that is not JSON are refused.
  for (const bad of [
    '{"directorQuiet": 5}',
    '{"directorIntervalTicks": 0}',
    "not json",
    "[1]",
  ]) {
    const result = loadEmbeddedGreekWorldPack({
      PANTHEA_PETITION_BALANCE: bad,
    });
    expect(result.ok).toBe(false);
  }
});
