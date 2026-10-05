import { describe, expect, it } from "bun:test";
import vocabularyJson from "../../../content/greek/assets/vocabulary.json";
import {
  type AssetId,
  assetUri,
  parseAssetId,
  parseAssetUri,
  parseAssetVocabulary,
  parseRegistryIndex,
  parseSha256,
  placeholderUri,
  type Sha256,
} from "./assets";

const SHA = "a".repeat(64);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("asset ids and logical URIs", () => {
  it("accepts lowercase hyphenated ids and rejects everything else", () => {
    for (const good of ["placeholder-zeus", "a1", "tree-02"]) {
      expect(parseAssetId(good, "id")).toEqual({
        ok: true,
        value: good as AssetId,
      });
    }
    for (const bad of ["Zeus", "a--b", "-a", "a-", "a_b", "", "a b", 5, null]) {
      const result = parseAssetId(bad, "id");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.path).toBe("id");
    }
  });

  it("accepts only lowercase 64-hex sha256", () => {
    expect(parseSha256(SHA, "h").ok).toBe(true);
    for (const bad of ["A".repeat(64), "a".repeat(63), "g".repeat(64), 1]) {
      expect(parseSha256(bad, "h").ok).toBe(false);
    }
  });

  it("builds and parses panthea-asset URIs, never the Tauri asset: scheme", () => {
    const id = "placeholder-zeus" as AssetId;
    expect(assetUri(id)).toBe("panthea-asset://asset/placeholder-zeus");
    expect(placeholderUri(SHA as Sha256)).toBe(
      `panthea-asset://placeholder/${SHA}`,
    );
    expect(parseAssetUri(assetUri(id), "u")).toEqual({
      ok: true,
      value: { kind: "asset", id },
    });
    expect(parseAssetUri(placeholderUri(SHA as Sha256), "u")).toEqual({
      ok: true,
      value: { kind: "placeholder", sha256: SHA as Sha256 },
    });
    for (const bad of [
      "asset://asset/placeholder-zeus",
      `asset://placeholder/${SHA}`,
      "panthea-asset://other/x",
      "panthea-asset://asset/Bad",
      "panthea-asset://placeholder/short",
      "panthea-asset://asset/x/y",
      42,
    ]) {
      expect(parseAssetUri(bad, "u").ok).toBe(false);
    }
  });
});

describe("asset vocabulary", () => {
  it("parses the committed vocabulary", () => {
    const parsed = parseAssetVocabulary(vocabularyJson);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.directions).toEqual(["south", "north", "east", "west"]);
    expect(parsed.value.expressions).toHaveLength(6);
    expect(parsed.value.paletteFamilies).toEqual([
      "town",
      "olympus",
      "underworld",
    ]);
    expect(parsed.value.tiers).toEqual({ min: 1, max: 3 });
    expect(parsed.value.cells.map((c) => [c.id, c.w, c.h])).toEqual([
      ["mortal", 64, 64],
      ["god", 64, 80],
      ["large", 128, 128],
      ["portrait", 96, 96],
    ]);
    const act = parsed.value.states.find((s) => s.id === "act");
    expect(act).toMatchObject({
      frames: { min: 4, max: 6 },
      fps: { min: 10, max: 12 },
      perAbility: true,
    });
    expect(parsed.value.states.find((s) => s.id === "idle")?.perAbility).toBe(
      false,
    );
  });

  it("rejects unknown keys, unsupported versions and malformed data with a path", () => {
    // biome-ignore lint/suspicious/noExplicitAny: mutation helper edits arbitrary depths
    const cases: [string, (v: any) => void, RegExp][] = [
      [
        "unknown top-level key",
        (v) => {
          v.extra = 1;
        },
        /extra/,
      ],
      [
        "unsupported schema version",
        (v) => {
          v.schemaVersion = 2;
        },
        /schemaVersion/,
      ],
      [
        "non-positive data version",
        (v) => {
          v.version = 0;
        },
        /version/,
      ],
      [
        "empty directions",
        (v) => {
          v.directions = [];
        },
        /directions/,
      ],
      [
        "duplicate direction",
        (v) => {
          v.directions = ["south", "south"];
        },
        /directions/,
      ],
      [
        "uppercase expression",
        (v) => {
          v.expressions = ["Neutral"];
        },
        /expressions/,
      ],
      [
        "inverted tiers",
        (v) => {
          v.tiers = { min: 3, max: 1 };
        },
        /tiers/,
      ],
      [
        "zero cell width",
        (v) => {
          v.cells[0].w = 0;
        },
        /cells\[0\]\.w/,
      ],
      [
        "unknown cell kind",
        (v) => {
          v.cells[0].kinds = ["tile"];
        },
        /cells\[0\]\.kinds/,
      ],
      [
        "duplicate cell id",
        (v) => {
          v.cells[1].id = "mortal";
        },
        /cells\[1\]/,
      ],
      [
        "inverted frame range",
        (v) => {
          v.states[0].frames = { min: 5, max: 4 };
        },
        /states\[0\]\.frames/,
      ],
      [
        "inverted fps range",
        (v) => {
          v.states[0].fps = { min: 12, max: 6 };
        },
        /states\[0\]\.fps/,
      ],
      [
        "state naming an unknown cell class",
        (v) => {
          v.states[1].cellClasses = ["giant"];
        },
        /states\[1\]\.cellClasses/,
      ],
      [
        "duplicate state id",
        (v) => {
          v.states[1].id = "idle";
        },
        /states\[1\]/,
      ],
      [
        "state key typo",
        (v) => {
          v.states[0].fpss = {};
        },
        /states\[0\]/,
      ],
      [
        "too many emissive accents allowed",
        (v) => {
          v.effect.maxEmissiveAccents = -1;
        },
        /effect/,
      ],
    ];
    for (const [name, mutate, path] of cases) {
      const value = clone(vocabularyJson);
      mutate(value);
      const result = parseAssetVocabulary(value);
      expect(result.ok, name).toBe(false);
      if (!result.ok) expect(result.path + result.message, name).toMatch(path);
    }
    expect(parseAssetVocabulary("nope").ok).toBe(false);
  });
});

describe("registry index", () => {
  const entry = (assetId: string) => ({ assetId, revision: SHA });
  const index = (entries: object[], extra: object = {}) => ({
    schemaVersion: 1,
    entries,
    ...extra,
  });

  it("parses an empty and a sorted index", () => {
    expect(parseRegistryIndex(index([])).ok).toBe(true);
    expect(parseRegistryIndex(index([entry("a-one"), entry("b-two")])).ok).toBe(
      true,
    );
  });

  it("rejects unsorted or duplicate ids, unknown keys, bad versions and bad hashes", () => {
    expect(parseRegistryIndex(index([entry("b-two"), entry("a-one")])).ok).toBe(
      false,
    );
    expect(parseRegistryIndex(index([entry("a-one"), entry("a-one")])).ok).toBe(
      false,
    );
    expect(parseRegistryIndex(index([], { extra: 1 })).ok).toBe(false);
    expect(parseRegistryIndex({ schemaVersion: 2, entries: [] }).ok).toBe(
      false,
    );
    expect(
      parseRegistryIndex(index([{ assetId: "a-one", revision: "nope" }])).ok,
    ).toBe(false);
    expect(
      parseRegistryIndex(index([{ ...entry("a-one"), extra: 1 }])).ok,
    ).toBe(false);
  });
});
