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
  stateIds,
  stateRuleFor,
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
      ["god-tall", 112, 96],
      ["portrait", 96, 96],
    ]);
    expect(parsed.value.cells.find((c) => c.id === "god-tall")?.kinds).toEqual([
      "sprite",
    ]);
    const act = stateRuleFor(parsed.value, "act", "god");
    expect(act).toMatchObject({
      frames: { min: 4, max: 6 },
      fps: { min: 10, max: 12 },
      perAbility: true,
    });
    expect(stateRuleFor(parsed.value, "idle", "god")?.perAbility).toBe(false);
  });

  describe("state rules keyed by cell class", () => {
    const committed = () => {
      const parsed = parseAssetVocabulary(vocabularyJson);
      if (!parsed.ok) throw new Error(parsed.message);
      return parsed.value;
    };

    it("looks a state up by (state, cell class)", () => {
      const vocabulary = committed();
      // The legacy rules are unchanged for every legacy sprite class.
      for (const cell of ["mortal", "god", "large"]) {
        expect(stateRuleFor(vocabulary, "walk", cell)).toMatchObject({
          frames: { min: 6, max: 6 },
          fps: { min: 10, max: 10 },
        });
        expect(stateRuleFor(vocabulary, "idle", cell)).toMatchObject({
          frames: { min: 4, max: 4 },
          fps: { min: 3, max: 6 },
        });
        expect(stateRuleFor(vocabulary, "hurt", cell)?.frames).toEqual({
          min: 2,
          max: 2,
        });
        expect(stateRuleFor(vocabulary, "down", cell)?.frames).toEqual({
          min: 1,
          max: 1,
        });
      }
      expect(stateRuleFor(vocabulary, "seated", "god")?.frames).toEqual({
        min: 2,
        max: 2,
      });
      expect(stateRuleFor(vocabulary, "act", "mortal")).toMatchObject({
        frames: { min: 4, max: 6 },
        fps: { min: 10, max: 12 },
        perAbility: true,
      });
      // god-tall carries its own rules for the four retro states.
      expect(stateRuleFor(vocabulary, "walk", "god-tall")).toMatchObject({
        frames: { min: 16, max: 16 },
        fps: { min: 20, max: 20 },
      });
      expect(stateRuleFor(vocabulary, "seated", "god-tall")?.frames.max).toBe(
        16,
      );
      expect(stateRuleFor(vocabulary, "idle", "god-tall")?.frames.max).toBe(16);
      expect(stateRuleFor(vocabulary, "act", "god-tall")?.perAbility).toBe(
        true,
      );
    });

    it("finds nothing where a class does not draw the state, or the state is unknown", () => {
      const vocabulary = committed();
      expect(stateRuleFor(vocabulary, "seated", "mortal")).toBeUndefined();
      expect(stateRuleFor(vocabulary, "seated", "large")).toBeUndefined();
      expect(stateRuleFor(vocabulary, "hurt", "god-tall")).toBeUndefined();
      expect(stateRuleFor(vocabulary, "fly", "god")).toBeUndefined();
      expect(stateRuleFor(vocabulary, "idle", undefined)).toBeUndefined();
    });

    it("lists each state id once, in first-named order", () => {
      expect(stateIds(committed())).toEqual([
        "idle",
        "seated",
        "act",
        "walk",
        "hurt",
        "down",
      ]);
    });

    // biome-ignore lint/suspicious/noExplicitAny: mutation helper edits arbitrary depths
    const parseWith = (mutate: (v: any) => void) => {
      const value = clone(vocabularyJson);
      mutate(value);
      return parseAssetVocabulary(value);
    };
    const indexOfRule = (
      // biome-ignore lint/suspicious/noExplicitAny: mutation helper edits arbitrary depths
      v: any,
      id: string,
      cell: string,
    ): number =>
      v.states.findIndex(
        // biome-ignore lint/suspicious/noExplicitAny: mutation helper edits arbitrary depths
        (s: any) => s.id === id && s.cellClasses?.includes(cell),
      );

    it("parses one state id under different cell classes (positive control for the refusals below)", () => {
      expect(parseWith(() => {}).ok).toBe(true);
    });

    it("refuses a duplicate (state, cell class)", () => {
      const result = parseWith((v) => {
        const at = indexOfRule(v, "walk", "god-tall");
        v.states[at].cellClasses = ["god-tall", "god"];
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.path).toMatch(/states\[\d+\]/);
        expect(result.message).toContain('"god"');
      }
    });

    it("refuses a rule that names no class beside another rule of its state, in either order", () => {
      const unrestricted = parseWith((v) => {
        const at = indexOfRule(v, "walk", "god");
        delete v.states[at].cellClasses;
      });
      expect(unrestricted.ok).toBe(false);
      const after = parseWith((v) => {
        const at = indexOfRule(v, "walk", "god-tall");
        delete v.states[at].cellClasses;
      });
      expect(after.ok).toBe(false);
    });

    it("refuses a state id repeated for the same class by a plain duplicate", () => {
      const result = parseWith((v) => {
        v.states.push({ ...v.states[0] });
      });
      expect(result.ok).toBe(false);
    });
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
        "duplicate state id on the same cell class",
        (v) => {
          v.states[2].id = "idle";
          v.states[2].cellClasses = ["god"];
        },
        /states\[2\]/,
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
