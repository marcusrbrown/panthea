// The benchmark's world: the immutable Unit 7 content pack (7 gods, 20
// mortals) read from `fixtures/unit7-pack.json`, its hash checked on every
// load so a changed fixture is a loud error and not a quietly different
// benchmark. `mortals` keeps the first N mortals in file order, for the
// 4-versus-20 comparison; the gods are always all seven.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ContentPack, parseContentPack } from "@panthea/contracts";

/** sha256 of `fixtures/unit7-pack.json`, written when the fixture was cut from main d566975. */
export const PACK_SHA256 =
  "3d26995b7201ccc4ece377c2f253e4e8e0d1f7ef5b5a95beca5917cf1ea34399";

const FIXTURE = join(import.meta.dir, "../fixtures/unit7-pack.json");

/** The fixture's text, after checking its hash. */
export function readPackText(path = FIXTURE): string {
  const text = readFileSync(path, "utf8");
  const actual = createHash("sha256").update(text).digest("hex");
  if (actual !== PACK_SHA256) {
    throw new Error(
      `the benchmark fixture ${path} has sha256 ${actual}, not ${PACK_SHA256}: it is immutable, so a change to it is a different benchmark`,
    );
  }
  return text;
}

/** The pack, with every god and the first `mortals` mortals (all of them when omitted), and the buildings of the mortals kept. */
export function loadPack(mortals?: number): ContentPack {
  const raw = JSON.parse(readPackText()) as {
    inhabitants: { id: string; deity?: boolean; sprite?: string }[];
    buildings: { owner?: string }[];
    rules: { petitionBalance?: Record<string, number> };
  };
  // The fixture is immutable and predates the director's own clock: its quiet window is that clock's interval now.
  const balance = raw.rules.petitionBalance;
  if (balance !== undefined && "directorQuietTicks" in balance) {
    balance.directorIntervalTicks = balance.directorQuietTicks as number;
    delete balance.directorQuietTicks;
  }
  if (mortals !== undefined) {
    let kept = 0;
    raw.inhabitants = raw.inhabitants.filter((inhabitant) => {
      if (inhabitant.deity === true) return true;
      kept += 1;
      return kept <= mortals;
    });
    // A building whose owner was dropped goes with them.
    const present = new Set(raw.inhabitants.map((inhabitant) => inhabitant.id));
    raw.buildings = raw.buildings.filter(
      (building) => building.owner === undefined || present.has(building.owner),
    );
  }
  // The fixture predates the sprite id and is immutable. A mortal gets the `placeholder-<id>` it is authored with
  // now, and a deity (whose profile supplies its sprite everywhere else) the same: the benchmark draws nothing.
  for (const inhabitant of raw.inhabitants) {
    if (inhabitant.deity !== true)
      inhabitant.sprite = `placeholder-${inhabitant.id}`;
  }
  const parsed = parseContentPack(raw);
  if (!parsed.ok) {
    throw new Error(`${parsed.path}: ${parsed.message}`);
  }
  return {
    ...parsed.value,
    inhabitants: parsed.value.inhabitants.map((inhabitant) => ({
      ...inhabitant,
      sprite: inhabitant.sprite ?? `placeholder-${inhabitant.id}`,
    })),
  };
}
