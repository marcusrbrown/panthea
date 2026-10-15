import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import canonPortrait from "../../../content/greek/assets/registry/manifests/7cbaf7aa67a604b70b9c721dd0b31123d984c1e3034f10cba70c84e277c09c2d.json";
import vocabularyJson from "../../../content/greek/assets/vocabulary.json";
import {
  type AssetVocabulary,
  canonicalManifestText,
  parseAssetManifest,
  parseAssetVocabulary,
  parseGenerationRequest,
  parseProvenance,
  tileAtlasRect,
} from "./assets";

const vocab = (() => {
  const parsed = parseAssetVocabulary(vocabularyJson);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value as AssetVocabulary;
})();

const H = (c: string) => c.repeat(64);

function frames(count: number, w: number, h: number, durationMs: number) {
  return Array.from({ length: count }, (_, i) => ({
    rect: { x: i * w, y: 0, w, h },
    durationMs,
  }));
}

const request = {
  schemaVersion: 1,
  subject: "zeus",
  kind: "sprite",
  slots: [{ state: "idle", direction: "south" }],
  batch: 4,
};

const narrowed = {
  schemaVersion: 1,
  subject: "zeus",
  kind: "sprite",
  slots: [{ state: "idle", direction: "south" }],
  batch: 1,
  seed: 20261003,
};

function generation() {
  return {
    jobId: "job-1",
    request: JSON.parse(JSON.stringify(narrowed)),
    runtime: { name: "stable-diffusion.cpp", version: "master-929-3f8527a" },
    model: { id: "z-image-turbo", sha256: H("a") },
    loras: [{ id: "pixel-lora", sha256: H("b") }],
    encoder: { id: "qwen3-4b", sha256: H("1") },
    vae: { id: "z-image-ae", sha256: H("2") },
    seed: 20261003,
    settings: { sample_method: "euler", sample_steps: 8, guidance: 1 },
    used: [H("c")],
  };
}

function generated() {
  return {
    method: "generated",
    generations: [generation()],
    licences: [
      { subject: "stable-diffusion.cpp", role: "runtime", licence: "MIT" },
      { subject: "z-image-turbo", role: "model", licence: "Apache-2.0" },
      { subject: "pixel-lora", role: "lora", licence: "Apache-2.0" },
      { subject: "qwen3-4b", role: "encoder", licence: "Apache-2.0" },
      { subject: "z-image-ae", role: "vae", licence: "Apache-2.0" },
    ],
    relatedJobs: [
      { jobId: "job-1", status: "succeeded", outputs: [H("c"), H("8")] },
      { jobId: "job-0", status: "cancelled" },
    ],
    handEdits: [],
    sourceAssets: [],
  };
}

function realmVariant() {
  return {
    paletteFamily: "underworld",
    paletteId: "provisional",
    atlas: { blob: H("9"), width: 256, height: 160 },
    map: [
      {
        source: { ramp: "marble", index: 0 },
        target: { ramp: "ash", index: 0 },
      },
      {
        source: { ramp: "marble", index: 1 },
        target: { ramp: "ash", index: 1 },
      },
    ],
  };
}

function derivedStep(outputSlot: string, resultHash = H("f")) {
  return {
    recipe: "mirror",
    version: 1,
    params: { from: "east", to: "west" },
    source: {
      assetId: "placeholder-zeus",
      revision: H("e"),
      slotKey: outputSlot.replace("west", "east"),
      slotHash: H("a"),
    },
    outputSlot,
    resultHash,
  };
}

function derived(steps: unknown[] = [derivedStep("idle/south")]) {
  return {
    method: "derived",
    operation: "mirror",
    runtime: { name: "panthea-derive", version: "mirror@1+png@1" },
    steps,
    sourceAssets: [{ assetId: "placeholder-zeus", revision: H("e") }],
    resultHashes: [H("f")],
    licences: [{ subject: "studio", role: "original-work", licence: "MIT" }],
    relatedJobs: [],
    handEdits: [],
  };
}

function sprite() {
  return {
    schemaVersion: 1,
    kind: "sprite",
    id: "placeholder-zeus",
    cell: { w: 64, h: 80 },
    pixelScale: 1,
    paletteFamily: "olympus",
    paletteId: "provisional",
    styleTag: "draft",
    atlas: { blob: H("d"), width: 256, height: 160 },
    pivot: { x: 32, y: 80 },
    footprint: { w: 1, h: 1 },
    directions: ["south"],
    realmVariants: [realmVariant()],
    animations: [
      { state: "idle", direction: "south", frames: frames(4, 64, 80, 167) },
      { state: "seated", direction: "south", frames: frames(2, 64, 80, 200) },
      {
        state: "act",
        direction: "south",
        ability: "thunderbolt",
        loopStart: 1,
        frames: frames(4, 64, 80, 90),
      },
    ],
    provenance: generated(),
  };
}

function portrait() {
  return {
    schemaVersion: 1,
    kind: "portrait",
    id: "zeus-portrait",
    cell: { w: 96, h: 96 },
    pixelScale: 1,
    paletteFamily: "olympus",
    paletteId: "provisional",
    styleTag: "draft",
    atlas: { blob: H("d"), width: 192, height: 96 },
    characterId: "zeus",
    expressions: [
      { expression: "neutral", frame: frames(1, 96, 96, 1000)[0] },
      { expression: "awed", frame: { ...frames(2, 96, 96, 1000)[1] } },
    ],
    provenance: generated(),
  };
}

function effect() {
  return {
    schemaVersion: 1,
    kind: "effect",
    id: "lightning-strike",
    cell: { w: 64, h: 128 },
    pixelScale: 1,
    paletteFamily: "olympus",
    paletteId: "provisional",
    styleTag: "draft",
    atlas: { blob: H("d"), width: 256, height: 128 },
    pivot: { x: 32, y: 128 },
    footprint: { w: 1, h: 1 },
    glowColours: ["#ffffcc"],
    animations: [{ name: "strike", frames: frames(3, 64, 128, 80) }],
    provenance: {
      method: "hand",
      handEdits: [{ description: "drawn in the editor" }],
      licences: [{ subject: "studio", role: "original-work", licence: "MIT" }],
      relatedJobs: [],
      sourceAssets: [],
    },
  };
}

function procedural(over: Mutable = {}) {
  return {
    method: "procedural",
    generator: { id: "effects", version: 1 },
    seed: 7,
    params: { effect: "lightning", segments: 9 },
    palette: { id: "provisional", digest: H("5") },
    frameHashes: { strike: [H("1"), H("2"), H("3")] },
    licences: [
      { subject: "lightning-strike", role: "original-work", licence: "MIT" },
    ],
    relatedJobs: [],
    handEdits: [],
    sourceAssets: [],
    ...over,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: mutation helper edits arbitrary depths
type Mutable = Record<string, any>;

function rejects(
  label: string,
  build: () => Mutable,
  mutate: (value: Mutable) => void,
  path: RegExp,
  reason?: string,
) {
  it(`rejects ${label}`, () => {
    const value = build();
    mutate(value);
    const result = parseAssetManifest(value, vocab);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(`${result.path} ${result.message}`).toMatch(path);
      if (reason) expect<string>(result.reason).toBe(reason);
    }
  });
}

describe("asset manifests: valid shapes", () => {
  for (const [name, build] of [
    ["sprite", sprite],
    ["portrait", portrait],
    ["effect", effect],
  ] as const) {
    it(`parses a ${name} manifest and stores it canonically`, () => {
      const parsed = parseAssetManifest(build(), vocab);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.kind).toBe(name);
      const text = canonicalManifestText(parsed.value);
      expect(text.endsWith("\n")).toBe(true);
      const again = parseAssetManifest(JSON.parse(text), vocab);
      expect(again.ok && canonicalManifestText(again.value)).toBe(text);
    });
  }
});

describe("asset manifests: common metadata", () => {
  rejects(
    "an unknown top-level key",
    sprite,
    (v) => {
      v.extra = 1;
    },
    /extra/,
  );
  rejects(
    "an unsupported schema version",
    sprite,
    (v) => {
      v.schemaVersion = 2;
    },
    /schemaVersion/,
    "unsupported-version",
  );
  rejects(
    "an unknown kind",
    sprite,
    (v) => {
      v.kind = "banana";
    },
    /kind/,
    "unknown-kind",
  );
  rejects(
    "the reserved sound kind",
    sprite,
    (v) => {
      v.kind = "sound";
    },
    /kind/,
    "unknown-kind",
  );
  rejects(
    "an uppercase id",
    sprite,
    (v) => {
      v.id = "Zeus";
    },
    /id/,
  );
  rejects(
    "a zero pixel scale",
    sprite,
    (v) => {
      v.pixelScale = 0;
    },
    /pixelScale/,
  );
  rejects(
    "an unknown palette family",
    sprite,
    (v) => {
      v.paletteFamily = "elysium";
    },
    /paletteFamily/,
  );
  rejects(
    "a missing atlas",
    sprite,
    (v) => {
      delete v.atlas;
    },
    /atlas/,
  );
  rejects(
    "a malformed atlas hash",
    sprite,
    (v) => {
      v.atlas.blob = "xyz";
    },
    /atlas\.blob/,
  );
  rejects(
    "a cell that is no declared class",
    sprite,
    (v) => {
      v.cell = { w: 63, h: 80 };
    },
    /cell/,
  );
  rejects(
    "a sprite on the portrait cell class",
    sprite,
    (v) => {
      v.cell = { w: 96, h: 96 };
    },
    /cell/,
  );
});

describe("asset manifests: sprites", () => {
  rejects(
    "a pivot outside the cell",
    sprite,
    (v) => {
      v.pivot = { x: 65, y: 10 };
    },
    /pivot/,
  );
  rejects(
    "a zero footprint",
    sprite,
    (v) => {
      v.footprint = { w: 0, h: 1 };
    },
    /footprint/,
  );
  rejects(
    "an unknown direction",
    sprite,
    (v) => {
      v.directions = ["up"];
    },
    /directions/,
  );
  rejects(
    "a duplicate direction",
    sprite,
    (v) => {
      v.directions = ["south", "south"];
    },
    /directions/,
  );
  rejects(
    "an animation in an undeclared direction",
    sprite,
    (v) => {
      v.animations[0].direction = "north";
    },
    /animations\[0\]\.direction/,
  );
  rejects(
    "an unknown state",
    sprite,
    (v) => {
      v.animations[0].state = "dance";
    },
    /animations\[0\]\.state/,
  );
  rejects(
    "a duplicate state/direction/ability animation",
    sprite,
    (v) => {
      v.animations.push({ ...v.animations[0] });
    },
    /animations\[3\]/,
  );
  rejects(
    "too few frames for the state",
    sprite,
    (v) => {
      v.animations[0].frames = frames(3, 64, 80, 167);
    },
    /animations\[0\]\.frames/,
  );
  rejects(
    "a frame duration outside the state's frame rate",
    sprite,
    (v) => {
      v.animations[0].frames[1].durationMs = 500;
    },
    /durationMs/,
  );
  it("takes a held idle at 3-6 fps: 333/167/333/167 ms parses, 165 and 335 ms do not", () => {
    const timed = (durations: number[]) => {
      const value = sprite();
      durations.forEach((ms, index) => {
        value.animations[0].frames[index].durationMs = ms;
      });
      return parseAssetManifest(value, vocab);
    };
    expect(timed([333, 167, 333, 167]).ok).toBe(true);
    expect(timed([166, 334, 166, 334]).ok).toBe(true);
    for (const bad of [165, 335]) {
      const result = timed([333, bad, 333, 167]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.path).toContain("animations[0].frames[1].durationMs");
        expect(result.message).toContain("expected 166-334 ms");
      }
    }
  });
  rejects(
    "a frame outside the atlas",
    sprite,
    (v) => {
      v.animations[0].frames[3].rect.x = 400;
    },
    /rect/,
  );
  rejects(
    "a frame that is not the cell size",
    sprite,
    (v) => {
      v.animations[0].frames[0].rect.w = 32;
    },
    /rect/,
  );
  rejects(
    "a gods-only state on a mortal cell",
    sprite,
    (v) => {
      v.cell = { w: 64, h: 64 };
      v.pivot = { x: 32, y: 64 };
      v.atlas.height = 64;
      v.realmVariants[0].atlas.height = 64;
      for (const a of v.animations) for (const f of a.frames) f.rect.h = 64;
    },
    /seated/,
  );
  rejects(
    "a per-ability state without an ability",
    sprite,
    (v) => {
      delete v.animations[2].ability;
    },
    /ability/,
  );
  rejects(
    "an ability on a state that has none",
    sprite,
    (v) => {
      v.animations[0].ability = "thunderbolt";
    },
    /ability/,
  );
  rejects(
    "a loop start past the last frame",
    sprite,
    (v) => {
      v.animations[2].loopStart = 4;
    },
    /loopStart/,
  );
  rejects(
    "an unknown realm variant family",
    sprite,
    (v) => {
      v.realmVariants[0].paletteFamily = "elysium";
    },
    /realmVariants\[0\]/,
  );
  for (const [label, key] of [
    ["an atlas", "atlas"],
    ["a colour map", "map"],
  ] as const) {
    rejects(
      `a realm variant without ${label}`,
      sprite,
      (v) => {
        delete v.realmVariants[0][key];
      },
      new RegExp(`realmVariants\\[0\\]\\.${key}`),
    );
  }
  rejects(
    "a realm variant atlas of another size",
    sprite,
    (v) => {
      v.realmVariants[0].atlas.width = 128;
    },
    /realmVariants\[0\]\.atlas/,
  );
  rejects(
    "an empty realm colour map",
    sprite,
    (v) => {
      v.realmVariants[0].map = [];
    },
    /realmVariants\[0\]\.map/,
  );
  rejects(
    "a realm colour map that maps one source colour twice",
    sprite,
    (v) => {
      v.realmVariants[0].map.push({ ...v.realmVariants[0].map[0] });
    },
    /realmVariants\[0\]\.map\[2\]/,
  );
  rejects(
    "a realm colour map entry with a negative index",
    sprite,
    (v) => {
      v.realmVariants[0].map[0].target.index = -1;
    },
    /realmVariants\[0\]\.map\[0\]\.target\.index/,
  );
  rejects(
    "a duplicate realm variant",
    sprite,
    (v) => {
      v.realmVariants.push({ ...v.realmVariants[0] });
    },
    /realmVariants\[1\]/,
  );
  rejects(
    "an empty animation list",
    sprite,
    (v) => {
      v.animations = [];
    },
    /animations/,
  );
  rejects(
    "an unknown key inside a frame",
    sprite,
    (v) => {
      v.animations[0].frames[0].extra = 1;
    },
    /extra/,
  );
  it("accepts a declared asymmetry", () => {
    const value = sprite();
    (value as Mutable).asymmetry = { feature: "bolt hand" };
    expect(parseAssetManifest(value, vocab).ok).toBe(true);
  });
});

describe("asset manifests: portraits and effects", () => {
  rejects(
    "a portrait without a character",
    portrait,
    (v) => {
      delete v.characterId;
    },
    /characterId/,
  );
  rejects(
    "a portrait on a sprite cell",
    portrait,
    (v) => {
      v.cell = { w: 64, h: 64 };
    },
    /cell/,
  );
  rejects(
    "an unknown expression",
    portrait,
    (v) => {
      v.expressions[0].expression = "bored";
    },
    /expressions\[0\]\.expression/,
  );
  rejects(
    "a duplicate expression",
    portrait,
    (v) => {
      v.expressions[1].expression = "neutral";
    },
    /expressions\[1\]/,
  );
  rejects(
    "a portrait with no expressions",
    portrait,
    (v) => {
      v.expressions = [];
    },
    /expressions/,
  );
  rejects(
    "an effect with a tier key",
    effect,
    (v) => {
      v.tier = 1;
    },
    /tier/,
  );
  rejects(
    "the removed emissiveAccents key",
    effect,
    (v) => {
      v.emissiveAccents = ["#ffffcc"];
    },
    /emissiveAccents/,
  );
  rejects(
    "a malformed glow colour",
    effect,
    (v) => {
      v.glowColours = ["red"];
    },
    /glowColours\[0\]/,
  );
  rejects(
    "a duplicate glow colour",
    effect,
    (v) => {
      v.glowColours = ["#ffffcc", "#ffffcc"];
    },
    /glowColours\[1\]/,
  );
  it("puts no count or duration limit on an effect", () => {
    const value = effect();
    value.glowColours = ["#111111", "#222222", "#333333", "#444444", "#555555"];
    value.animations[0].frames = frames(3, 64, 128, 2000);
    expect(parseAssetManifest(value, vocab).ok).toBe(true);
  });
  rejects(
    "an effect animation without a name",
    effect,
    (v) => {
      delete v.animations[0].name;
    },
    /name/,
  );
  rejects(
    "a duplicate effect animation name",
    effect,
    (v) => {
      v.animations.push({ ...v.animations[0] });
    },
    /animations\[1\]/,
  );
});

describe("procedural effects", () => {
  const made = (provenance: unknown = procedural()) => ({
    ...effect(),
    provenance,
  });

  it("parses a procedural effect and stores it canonically", () => {
    const parsed = parseAssetManifest(made(), vocab);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.provenance.method).toBe("procedural");
    const text = canonicalManifestText(parsed.value);
    const again = parseAssetManifest(JSON.parse(text), vocab);
    expect(again.ok && canonicalManifestText(again.value)).toBe(text);
  });
  it("parses it through parseProvenance", () => {
    expect(parseProvenance(procedural()).ok).toBe(true);
  });
  rejects(
    "a procedural sprite",
    () => ({ ...sprite(), realmVariants: [], provenance: procedural() }),
    () => {},
    /procedural/,
  );
  rejects(
    "a procedural effect whose frame hashes miss an animation",
    () => made(),
    (v) => {
      v.animations.push({ name: "calm", frames: frames(3, 64, 128, 80) });
    },
    /frameHashes/,
  );
  rejects(
    "a procedural effect with a frame hash count that is not its frame count",
    () => made(procedural({ frameHashes: { strike: [H("1")] } })),
    () => {},
    /frameHashes\.strike/,
  );
  rejects(
    "frame hashes for an animation the effect does not have",
    () =>
      made(
        procedural({
          frameHashes: {
            strike: [H("1"), H("2"), H("3")],
            extra: [H("4")],
          },
        }),
      ),
    () => {},
    /frameHashes/,
  );
  const badProvenance: [string, Mutable, RegExp][] = [
    ["a missing generator", { generator: undefined }, /generator/],
    [
      "a zero generator version",
      { generator: { id: "effects", version: 0 } },
      /version/,
    ],
    ["a negative seed", { seed: -1 }, /seed/],
    ["a fractional param", { params: { segments: 1.5 } }, /params/],
    [
      "a palette digest that is not a hash",
      { palette: { id: "p", digest: "x" } },
      /digest/,
    ],
    ["an unknown key", { extra: 1 }, /extra/],
  ];
  for (const [name, over, path] of badProvenance) {
    it(`rejects ${name}`, () => {
      const parsed = parseProvenance(procedural(over));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(`${parsed.path} ${parsed.message}`).toMatch(path);
    });
  }
});

describe("derived manifests", () => {
  const withProvenance = (provenance: unknown) => ({
    ...sprite(),
    realmVariants: [],
    provenance,
  });

  it("parses a derived manifest with two steps", () => {
    const value = withProvenance(
      derived([
        derivedStep("idle/south", H("f")),
        derivedStep("seated/south", H("c")),
      ]),
    );
    const parsed = parseAssetManifest(value, vocab);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.provenance.method !== "derived") return;
    expect(parsed.value.provenance.steps.map((s) => s.outputSlot)).toEqual([
      "idle/south",
      "seated/south",
    ]);
    const text = canonicalManifestText(parsed.value);
    const again = parseAssetManifest(JSON.parse(text), vocab);
    expect(again.ok && canonicalManifestText(again.value)).toBe(text);
  });

  it("parses a derived manifest whose other slots are carried, with a per-ability step", () => {
    const one = parseAssetManifest(withProvenance(derived()), vocab);
    expect(one.ok).toBe(true);
    const act = parseAssetManifest(
      withProvenance(derived([derivedStep("act/south/thunderbolt")])),
      vocab,
    );
    expect(act.ok).toBe(true);
  });

  it("parses a derived portrait and a derived effect by their slot names", () => {
    const portraitValue = {
      ...portrait(),
      provenance: derived([derivedStep("awed")]),
    };
    expect(parseAssetManifest(portraitValue, vocab).ok).toBe(true);
    const effectValue = {
      ...effect(),
      provenance: derived([derivedStep("strike")]),
    };
    expect(parseAssetManifest(effectValue, vocab).ok).toBe(true);
  });

  const derivedRejects = (
    label: string,
    mutate: (provenance: Mutable) => void,
    path: RegExp,
  ) =>
    rejects(
      label,
      () => withProvenance(derived()),
      (v) => mutate(v.provenance),
      path,
    );

  derivedRejects(
    "a step whose output slot is not in the manifest's animations",
    (p) => {
      p.steps[0].outputSlot = "walk/south";
    },
    /provenance\.steps\[0\]\.outputSlot/,
  );
  derivedRejects(
    "empty steps",
    (p) => {
      p.steps = [];
    },
    /provenance\.steps/,
  );
  derivedRejects(
    "missing steps",
    (p) => {
      delete p.steps;
    },
    /provenance\.steps/,
  );
  derivedRejects(
    "a malformed source slot hash",
    (p) => {
      p.steps[0].source.slotHash = "abc";
    },
    /steps\[0\]\.source\.slotHash/,
  );
  derivedRejects(
    "a malformed source revision",
    (p) => {
      p.steps[0].source.revision = "XYZ";
    },
    /steps\[0\]\.source\.revision/,
  );
  derivedRejects(
    "a malformed result hash",
    (p) => {
      p.steps[0].resultHash = H("G");
    },
    /steps\[0\]\.resultHash/,
  );
  derivedRejects(
    "a step with no recipe",
    (p) => {
      p.steps[0].recipe = "";
    },
    /steps\[0\]\.recipe/,
  );
  derivedRejects(
    "a step version that is not a positive integer",
    (p) => {
      p.steps[0].version = 0;
    },
    /steps\[0\]\.version/,
  );
  derivedRejects(
    "fractional params",
    (p) => {
      p.steps[0].params = { dy: 0.5 };
    },
    /steps\[0\]\.params\.dy/,
  );
  derivedRejects(
    "an unknown key inside a step",
    (p) => {
      p.steps[0].note = "x";
    },
    /steps\[0\]\.note/,
  );
  derivedRejects(
    "two steps that output one slot",
    (p) => {
      p.steps.push(derivedStep("idle/south", H("c")));
    },
    /steps\[1\]/,
  );
  const swapStep = (family: string, slot = "idle/south") => ({
    recipe: "palette-swap",
    version: 1,
    params: { sourceFamily: "olympus", targetFamily: family, ramps: [] },
    source: {
      assetId: "placeholder-zeus",
      revision: H("e"),
      slotKey: slot,
      slotHash: H("a"),
    },
    outputSlot: slot,
    resultHash: H("b"),
  });
  it("lets a palette swap step share its slot with another recipe's step and with swaps into other realms", () => {
    const provenance = derived([
      derivedStep("idle/south"),
      swapStep("underworld"),
      swapStep("town"),
    ]);

    expect(parseAssetManifest(withProvenance(provenance), vocab).ok).toBe(true);
  });
  derivedRejects(
    "two palette swap steps for one realm and one slot",
    (p) => {
      p.steps.push(swapStep("underworld"), swapStep("underworld"));
    },
    /steps\[2\]/,
  );
  describe("a generated manifest that carries derived cells", () => {
    const carrying = (steps: unknown[] = [derivedStep("idle/south")]) => ({
      ...generated(),
      steps,
      sourceAssets: [{ assetId: "placeholder-zeus", revision: H("e") }],
    });
    const carriedRejects = (
      label: string,
      mutate: (provenance: Mutable) => void,
      path: RegExp,
    ) =>
      rejects(
        label,
        () => withProvenance(carrying()),
        (v) => mutate(v.provenance),
        path,
      );

    it("parses with steps, keeps method generated, and round-trips canonically", () => {
      const parsed = parseAssetManifest(withProvenance(carrying()), vocab);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || parsed.value.provenance.method !== "generated") return;
      expect(parsed.value.provenance.steps?.map((s) => s.outputSlot)).toEqual([
        "idle/south",
      ]);
      const text = canonicalManifestText(parsed.value);
      const again = parseAssetManifest(JSON.parse(text), vocab);
      expect(again.ok && canonicalManifestText(again.value)).toBe(text);
    });

    it("parses without steps exactly as before, and writes no steps key", () => {
      const parsed = parseAssetManifest(withProvenance(generated()), vocab);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(canonicalManifestText(parsed.value)).not.toContain('"steps"');
    });

    carriedRejects(
      "an empty steps list",
      (p) => {
        p.steps = [];
      },
      /steps/,
    );
    carriedRejects(
      "two steps for one slot",
      (p) => {
        p.steps.push(derivedStep("idle/south", H("c")));
      },
      /steps\[1\]/,
    );
    carriedRejects(
      "a step whose source is not among the source assets",
      (p) => {
        p.steps[0].source.revision = H("d");
      },
      /steps\[0\]\.source/,
    );
    carriedRejects(
      "a __proto__ key in a step's params",
      (p) => {
        p.steps[0].params = JSON.parse('{"__proto__": {"dy": 1}}');
      },
      /steps\[0\]\.params\.__proto__/,
    );
    carriedRejects(
      "a step for a slot the manifest does not hold",
      (p) => {
        p.steps = [derivedStep("walk/south")];
      },
      /steps\[0\]\.outputSlot/,
    );
  });

  derivedRejects(
    "a source asset that is absent",
    (p) => {
      p.sourceAssets = [];
    },
    /sourceAssets/,
  );
  derivedRejects(
    "a step whose source revision is not among the source assets",
    (p) => {
      p.steps[0].source.revision = H("d");
    },
    /steps\[0\]\.source/,
  );
  derivedRejects(
    "a step whose source asset is not among the source assets",
    (p) => {
      p.steps[0].source.assetId = "placeholder-hera";
    },
    /steps\[0\]\.source/,
  );
  derivedRejects(
    "a __proto__ key in a step's params",
    (p) => {
      p.steps[0].params = JSON.parse(
        '{"__proto__": {"dy": 1}, "from": "east"}',
      );
    },
    /steps\[0\]\.params\.__proto__/,
  );
  derivedRejects(
    "a __proto__ key nested in a step's params",
    (p) => {
      p.steps[0].params = JSON.parse('{"ramps": [{"__proto__": {"x": 1}}]}');
    },
    /steps\[0\]\.params\.ramps\[0\]\.__proto__/,
  );
});

describe("provenance", () => {
  const provenanceRejects = (
    label: string,
    build: () => Mutable,
    mutate: (value: Mutable) => void,
    path: RegExp,
    reason?: string,
  ) =>
    it(`rejects ${label}`, () => {
      const value = build();
      mutate(value);
      const result = parseProvenance(value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(`${result.path} ${result.message}`).toMatch(path);
        if (reason) expect<string>(result.reason).toBe(reason);
      }
    });

  it("parses generated, hand and derived records", () => {
    expect(parseProvenance(generated()).ok).toBe(true);
    expect(parseProvenance(effect().provenance).ok).toBe(true);
    expect(
      parseProvenance({
        method: "derived",
        operation: "mirror",
        runtime: { name: "panthea", version: "1" },
        steps: [derivedStep("idle/south")],
        sourceAssets: [{ assetId: "placeholder-zeus", revision: H("e") }],
        resultHashes: [H("f")],
        licences: [
          { subject: "studio", role: "original-work", licence: "MIT" },
        ],
        relatedJobs: [],
        handEdits: [],
      }).ok,
    ).toBe(true);
  });

  it("takes a hand step, a script step and the canon portrait's old-form steps", () => {
    const withSteps = (handEdits: unknown[]) => ({ ...generated(), handEdits });
    const hash = H("e");
    const parsed = parseProvenance(
      withSteps([
        { description: "hand edit e1", hash },
        {
          description:
            "scripted outline recolour (tools/probes/art-edit/sprite_cleanup_c2c.py)",
          method: "script",
          hash,
        },
        { description: "redrew the hands", method: "hand" },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.handEdits.map((s) => s.method)).toEqual([
      undefined,
      "script",
      "hand",
    ]);
    expect("method" in (parsed.value.handEdits[0] ?? {})).toBe(false);

    const canon = parseAssetManifest(canonPortrait, vocab);
    expect(canon.ok).toBe(true);
    if (!canon.ok) return;
    expect(canon.value.provenance.handEdits.length).toBeGreaterThan(0);
    expect(canon.value.provenance.handEdits.some((s) => "method" in s)).toBe(
      false,
    );
  });

  for (const [label, step, path] of [
    [
      "an empty description",
      { description: "", method: "script" },
      /description/,
    ],
    ["a missing description", { method: "script" }, /description/],
    ["an unknown method", { description: "x", method: "magic" }, /method/],
    ["a non-string method", { description: "x", method: 1 }, /method/],
  ] as const) {
    it(`rejects a hand-edit step with ${label}`, () => {
      const result = parseProvenance({ ...generated(), handEdits: [step] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(`${result.path} ${result.message}`).toMatch(path);
    });
  }

  provenanceRejects(
    "an unknown method",
    generated,
    (v) => {
      v.method = "found";
    },
    /method/,
    "unknown-kind",
  );
  provenanceRejects(
    "an unknown key",
    generated,
    (v) => {
      v.apiKey = "x";
    },
    /apiKey/,
  );
  provenanceRejects(
    "a record without licences",
    generated,
    (v) => {
      v.licences = [];
    },
    /licences/,
  );
  provenanceRejects(
    "no generations",
    generated,
    (v) => {
      v.generations = [];
    },
    /generations/,
  );
  provenanceRejects(
    "the old single-job fields",
    generated,
    (v) => {
      v.jobId = "job-1";
    },
    /jobId/,
  );
  provenanceRejects(
    "old result hashes beside generations",
    generated,
    (v) => {
      v.resultHashes = [H("c")];
    },
    /resultHashes/,
  );
  provenanceRejects(
    "a duplicate generation job id",
    generated,
    (v) => {
      v.generations.push(JSON.parse(JSON.stringify(v.generations[0])));
    },
    /generations\[1\].*duplicate/,
  );
  provenanceRejects(
    "a generation whose job is missing from the job refs",
    generated,
    (v) => {
      v.generations[0].jobId = "job-9";
    },
    /generations\[0\]\.jobId/,
  );
  provenanceRejects(
    "a generation whose job was cancelled",
    generated,
    (v) => {
      v.generations[0].jobId = "job-0";
    },
    /generations\[0\]\.jobId/,
  );
  provenanceRejects(
    "a generation that uses no outputs",
    generated,
    (v) => {
      v.generations[0].used = [];
    },
    /generations\[0\]\.used/,
  );
  provenanceRejects(
    "a generation that lists a used hash twice",
    generated,
    (v) => {
      v.generations[0].used = [H("c"), H("c")];
    },
    /generations\[0\]\.used/,
  );
  provenanceRejects(
    "a used hash the job never output",
    generated,
    (v) => {
      v.generations[0].used = [H("9")];
    },
    /generations\[0\]\.used/,
  );
  provenanceRejects(
    "a request with two slots",
    generated,
    (v) => {
      v.generations[0].request.slots.push({
        state: "idle",
        direction: "north",
      });
    },
    /generations\[0\]\.request/,
  );
  provenanceRejects(
    "a request that asks for a batch",
    generated,
    (v) => {
      v.generations[0].request.batch = 4;
    },
    /generations\[0\]\.request/,
  );
  provenanceRejects(
    "a request without a seed",
    generated,
    (v) => {
      delete v.generations[0].request.seed;
    },
    /generations\[0\]\.request/,
  );
  provenanceRejects(
    "a seed that is not the request's seed",
    generated,
    (v) => {
      v.generations[0].seed = 1;
    },
    /generations\[0\]\.seed/,
  );
  for (const [label, role, subject, change] of [
    ["the runtime", "runtime", "stable-diffusion.cpp", undefined],
    ["the model", "model", "z-image-turbo", undefined],
    ["a LoRA", "lora", "pixel-lora", undefined],
    ["the text encoder", "encoder", "qwen3-4b", undefined],
    ["the VAE", "vae", "z-image-ae", undefined],
  ] as const) {
    void change;
    provenanceRejects(
      `${label} with no licence record`,
      generated,
      (v) => {
        v.licences = v.licences.filter(
          (licence: { subject: string }) => licence.subject !== subject,
        );
      },
      new RegExp(`licences.*${subject.replace(".", "\\.")}`),
    );
    provenanceRejects(
      `${label} licensed under the wrong role`,
      generated,
      (v) => {
        for (const licence of v.licences)
          if (licence.subject === subject)
            licence.role = role === "runtime" ? "model" : "runtime";
      },
      new RegExp(
        `licences.*${role} licence record for "${subject.replace(".", "\\.")}"`,
      ),
    );
  }
  provenanceRejects(
    "a runtime licensed by its version instead of its name",
    generated,
    (v) => {
      v.licences[0].subject = "master-929-3f8527a";
    },
    /licences.*stable-diffusion\.cpp/,
  );

  it("accepts a generation without an encoder or a VAE, and several generations", () => {
    const bare = generated();
    bare.generations[0].encoder = null as never;
    bare.generations[0].vae = null as never;
    bare.licences = bare.licences.filter(
      (l) => l.role !== "encoder" && l.role !== "vae",
    );
    expect(parseProvenance(bare).ok).toBe(true);

    const two = generated();
    const second = generation();
    second.jobId = "job-2";
    second.request = { ...narrowed, seed: 20261004 };
    second.seed = 20261004;
    second.used = [H("d")];
    two.generations.push(second);
    two.relatedJobs.push({
      jobId: "job-2",
      status: "succeeded",
      outputs: [H("d")],
    });
    const parsed = parseProvenance(two);
    expect(
      parsed.ok &&
        parsed.value.method === "generated" &&
        parsed.value.generations.map((g) => g.jobId),
    ).toEqual(["job-1", "job-2"]);
  });

  provenanceRejects(
    "a cancelled job that carries outputs",
    generated,
    (v) => {
      v.relatedJobs[1].outputs = [H("c")];
    },
    /relatedJobs\[1\]\.outputs/,
  );
  provenanceRejects(
    "a succeeded job with no outputs",
    generated,
    (v) => {
      delete v.relatedJobs[0].outputs;
    },
    /relatedJobs\[0\]\.outputs/,
  );
  provenanceRejects(
    "a duplicate job ref",
    generated,
    (v) => {
      v.relatedJobs.push({ jobId: "job-0", status: "cancelled" });
    },
    /relatedJobs\[2\]/,
  );
  provenanceRejects(
    "an unknown job status",
    generated,
    (v) => {
      v.relatedJobs[1].status = "paused";
    },
    /relatedJobs\[1\]\.status/,
  );
  provenanceRejects(
    "a credential-looking setting key",
    generated,
    (v) => {
      v.generations[0].settings.apiKey = "abc";
    },
    /generations\[0\]\.settings\.apiKey/,
  );
  provenanceRejects(
    "an endpoint in a setting value",
    generated,
    (v) => {
      v.generations[0].settings.server = "http://127.0.0.1:8080";
    },
    /generations\[0\]\.settings\.server/,
  );
  provenanceRejects(
    "a non-scalar setting",
    generated,
    (v) => {
      v.generations[0].settings.nested = { a: 1 };
    },
    /generations\[0\]\.settings\.nested/,
  );
  provenanceRejects(
    "a hand record without edit steps",
    () => effect().provenance,
    (v) => {
      v.handEdits = [];
    },
    /handEdits/,
  );
  provenanceRejects(
    "a derived record without source assets",
    () => ({
      method: "derived",
      operation: "mirror",
      runtime: { name: "p", version: "1" },
      steps: [derivedStep("idle/south")],
      sourceAssets: [],
      resultHashes: [H("f")],
      licences: [{ subject: "studio", role: "original-work", licence: "MIT" }],
      relatedJobs: [],
      handEdits: [],
    }),
    () => {},
    /sourceAssets/,
  );
  provenanceRejects(
    "an owner exception with no reason",
    generated,
    (v) => {
      v.ownerException = { reason: "" };
    },
    /ownerException\.reason/,
  );

  it("keeps an owner exception reason", () => {
    const value = generated() as Mutable;
    value.ownerException = { reason: "owner accepted two stray pixels" };
    const parsed = parseProvenance(value);
    expect(parsed.ok && parsed.value.ownerException?.reason).toBe(
      "owner accepted two stray pixels",
    );
  });
});

describe("generation requests", () => {
  it("parses a request and rejects malformed ones", () => {
    expect(parseGenerationRequest(request).ok).toBe(true);
    const bad = (mutate: (v: Mutable) => void) => {
      const value = JSON.parse(JSON.stringify(request)) as Mutable;
      mutate(value);
      return parseGenerationRequest(value).ok;
    };
    expect(
      bad((v) => {
        v.batch = 0;
      }),
    ).toBe(false);
    expect(
      bad((v) => {
        v.slots = [];
      }),
    ).toBe(false);
    expect(
      bad((v) => {
        v.slots = [{}];
      }),
    ).toBe(false);
    expect(
      bad((v) => {
        v.slots = [{ state: "idle" }, { state: "idle" }];
      }),
    ).toBe(false);
    expect(
      bad((v) => {
        v.kind = "banana";
      }),
    ).toBe(false);
    expect(
      bad((v) => {
        v.subject = "Zeus";
      }),
    ).toBe(false);
    expect(
      bad((v) => {
        v.endpoint = "http://x";
      }),
    ).toBe(false);
    expect(
      bad((v) => {
        v.schemaVersion = 3;
      }),
    ).toBe(false);
  });

  describe("a published edit base", () => {
    const published = {
      kind: "published",
      assetId: "zeus-sprite",
      revision: H("1"),
      slotKey: "idle/south",
      frameIndex: 2,
      frameHash: H("2"),
    };
    const withBase = (base: unknown) =>
      parseGenerationRequest({
        ...request,
        edit: { base, mask: H("3"), strength: 0.5, cue: "turn east" },
      });

    it("parses and keeps every field", () => {
      const parsed = withBase(published);
      expect(parsed.ok).toBe(true);
      if (parsed.ok)
        expect(parsed.value.edit?.base).toEqual(published as never);
    });

    for (const [label, change, path] of [
      ["a malformed frame hash", { frameHash: "abc" }, /base\.frameHash/],
      ["a malformed revision", { revision: H("Z") }, /base\.revision/],
      ["a negative frame index", { frameIndex: -1 }, /base\.frameIndex/],
      ["a fractional frame index", { frameIndex: 1.5 }, /base\.frameIndex/],
      ["an invalid asset id", { assetId: "Zeus Sprite" }, /base\.assetId/],
      ["an empty slot key", { slotKey: "" }, /base\.slotKey/],
      ["an unknown key", { extra: 1 }, /extra/],
    ] as const) {
      it(`rejects ${label}`, () => {
        const result = withBase({ ...published, ...change });
        expect(result.ok).toBe(false);
        if (!result.ok)
          expect(`${result.path} ${result.message}`).toMatch(path);
      });
    }

    it("rejects a published base with a field missing", () => {
      const { frameHash: _frameHash, ...rest } = published;
      expect(withBase(rest).ok).toBe(false);
    });
  });
});

// --- Retro: god-tall cell, recipe requests, rendered provenance ---------------------

const hashOf = (n: number) => n.toString(16).padStart(64, "0");

function handProvenance() {
  return {
    method: "hand",
    handEdits: [{ description: "drawn in the editor" }],
    licences: [{ subject: "studio", role: "original-work", licence: "MIT" }],
    relatedJobs: [],
    sourceAssets: [],
  };
}

const FACINGS = ["south", "north", "east", "west"] as const;

function godTallSprite(
  animations: Mutable[] = [
    { state: "walk", direction: "south", frames: frames(16, 112, 96, 50) },
  ],
) {
  return {
    schemaVersion: 1,
    kind: "sprite",
    id: "zeus-retro",
    cell: { w: 112, h: 96 },
    pixelScale: 1,
    paletteFamily: "olympus",
    paletteId: "greek-retro",
    styleTag: "retro",
    atlas: { blob: H("d"), width: 112 * 16, height: 96 },
    pivot: { x: 56, y: 78 },
    footprint: { w: 1, h: 1 },
    directions: ["south", "north", "east", "west"],
    realmVariants: [],
    animations,
    provenance: handProvenance(),
  };
}

const parsesAs = (value: Mutable) => parseAssetManifest(value, vocab);

describe("asset manifests: the god-tall cell", () => {
  it("parses a 112x96 manifest with pivot (56,78) and a 16-frame walk at 50 ms per frame", () => {
    const parsed = parsesAs(godTallSprite());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind === "sprite" && parsed.value.pivot).toEqual({
      x: 56,
      y: 78,
    });
    const text = canonicalManifestText(parsed.value);
    const again = parseAssetManifest(JSON.parse(text), vocab);
    expect(again.ok && canonicalManifestText(again.value)).toBe(text);
  });

  it("refuses a god-tall walk that is the legacy 6 frames, or 51 ms, or 15 frames", () => {
    for (const [label, count, ms] of [
      ["6 frames", 6, 50],
      ["15 frames", 15, 50],
      ["51 ms", 16, 51],
      ["49 ms", 16, 49],
    ] as const) {
      const result = parsesAs(
        godTallSprite([
          {
            state: "walk",
            direction: "south",
            frames: frames(count, 112, 96, ms),
          },
        ]),
      );
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.path, label).toMatch(/animations\[0\]/);
    }
  });

  it("keeps the legacy god walk: 6 frames at 10 fps applies to 64x80, and a 16-frame walk on god is refused", () => {
    const godWalk = (count: number, ms: number) => {
      const value = sprite();
      value.animations = [
        {
          state: "walk",
          direction: "south",
          frames: frames(count, 64, 80, ms),
        },
      ];
      value.atlas = { blob: H("d"), width: 64 * 16, height: 80 };
      value.realmVariants[0].atlas = {
        blob: H("9"),
        width: 64 * 16,
        height: 80,
      };
      return value;
    };
    expect(parsesAs(godWalk(6, 100)).ok).toBe(true);
    const sixteen = parsesAs(godWalk(16, 50));
    expect(sixteen.ok).toBe(false);
    if (!sixteen.ok) expect(sixteen.path).toMatch(/animations\[0\]\.frames/);
    // The legacy rule is not loosened to the retro timing either.
    expect(parsesAs(godWalk(6, 50)).ok).toBe(false);
  });

  it("takes seated on god-tall and still refuses it on mortal", () => {
    const seated = godTallSprite([
      { state: "seated", direction: "south", frames: frames(8, 112, 96, 100) },
    ]);
    expect(parsesAs(seated).ok).toBe(true);
    const mortal = sprite();
    mortal.cell = { w: 64, h: 64 };
    mortal.pivot = { x: 32, y: 64 };
    mortal.atlas.height = 64;
    mortal.realmVariants[0].atlas.height = 64;
    for (const a of mortal.animations) for (const f of a.frames) f.rect.h = 64;
    const refused = parsesAs(mortal);
    expect(refused.ok).toBe(false);
    if (!refused.ok)
      expect(`${refused.path} ${refused.message}`).toMatch(/seated/);
  });

  it("takes idle and act (per ability) on god-tall within the retro ranges", () => {
    const value = godTallSprite([
      { state: "idle", direction: "south", frames: frames(8, 112, 96, 167) },
      {
        state: "act",
        direction: "south",
        ability: "thunderbolt",
        frames: frames(12, 112, 96, 60),
      },
    ]);
    expect(parsesAs(value).ok).toBe(true);
    const noAbility = godTallSprite([
      { state: "act", direction: "south", frames: frames(12, 112, 96, 60) },
    ]);
    expect(parsesAs(noAbility).ok).toBe(false);
  });

  it("refuses a state god-tall has no rule for", () => {
    const hurt = godTallSprite([
      { state: "hurt", direction: "south", frames: frames(2, 112, 96, 100) },
    ]);
    const result = parsesAs(hurt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toMatch(/animations\[0\]\.state/);
  });

  it("keeps a pivot inside the 112x96 cell", () => {
    for (const [pivot, accepted] of [
      [{ x: 56, y: 78 }, true],
      [{ x: 112, y: 96 }, true],
      [{ x: 113, y: 78 }, false],
      [{ x: 56, y: 97 }, false],
      [{ x: -1, y: 78 }, false],
    ] as const) {
      const value = godTallSprite();
      value.pivot = pivot;
      const result = parsesAs(value);
      expect(result.ok, JSON.stringify(pivot)).toBe(accepted);
      if (!result.ok) expect(result.path).toMatch(/pivot/);
    }
  });

  it("refuses frames that are the god cell size on a god-tall manifest", () => {
    const value = godTallSprite([
      { state: "walk", direction: "south", frames: frames(16, 64, 80, 50) },
    ]);
    expect(parsesAs(value).ok).toBe(false);
  });
});

describe("recipe requests", () => {
  const recipe = {
    schemaVersion: 1,
    subject: "zeus",
    kind: "sprite",
    slots: [{ state: "walk", direction: "south" }],
    recipe: {
      profile: "zeus",
      palette: "greek-retro",
      pivot: { x: 56, y: 78 },
    },
  };
  const parseWith = (mutate: (v: Mutable) => void) => {
    const value = JSON.parse(JSON.stringify(recipe)) as Mutable;
    mutate(value);
    return parseGenerationRequest(value);
  };

  it("parses, storing batch 1 and seed 0 and no camera", () => {
    const parsed = parseGenerationRequest(recipe);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.batch).toBe(1);
    expect(parsed.value.seed).toBe(0);
    expect(parsed.value.recipe).toEqual({
      profile: "zeus",
      palette: "greek-retro",
      pivot: { x: 56, y: 78 },
    });
    expect(JSON.stringify(parsed.value)).not.toContain("camera");
    // The stored form parses again unchanged.
    expect(
      parseGenerationRequest(JSON.parse(JSON.stringify(parsed.value))),
    ).toEqual(parsed);
  });

  it("refuses a seed other than 0 and a batch above 1 (positive control: seed 0 and batch 1 parse)", () => {
    expect(
      parseWith((v) => {
        v.seed = 0;
      }).ok,
    ).toBe(true);
    expect(
      parseWith((v) => {
        v.batch = 1;
      }).ok,
    ).toBe(true);
    for (const [label, mutate] of [
      [
        "seed 1",
        (v: Mutable) => {
          v.seed = 1;
        },
      ],
      [
        "seed 20261003",
        (v: Mutable) => {
          v.seed = 20261003;
        },
      ],
      [
        "batch 2",
        (v: Mutable) => {
          v.batch = 2;
        },
      ],
      [
        "batch 4",
        (v: Mutable) => {
          v.batch = 4;
        },
      ],
    ] as const) {
      const result = parseWith(mutate);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.path, label).toMatch(/seed|batch/);
    }
  });

  it("refuses a style note, an edit, a camera id, a portrait and a malformed recipe", () => {
    for (const [label, mutate] of [
      [
        "styleNote",
        (v: Mutable) => {
          v.styleNote = "dusk";
        },
      ],
      [
        "edit",
        (v: Mutable) => {
          v.edit = {
            base: { kind: "hand", image: H("1"), description: "x" },
            mask: H("2"),
            strength: 0.5,
            cue: "turn",
          };
        },
      ],
      [
        "camera",
        (v: Mutable) => {
          v.recipe.camera = "iso-2-1";
        },
      ],
      [
        "portrait kind",
        (v: Mutable) => {
          v.kind = "portrait";
          v.slots = [{ expression: "neutral" }];
        },
      ],
      [
        "empty profile",
        (v: Mutable) => {
          v.recipe.profile = "";
        },
      ],
      [
        "missing palette",
        (v: Mutable) => {
          delete v.recipe.palette;
        },
      ],
      [
        "fractional pivot",
        (v: Mutable) => {
          v.recipe.pivot = { x: 56.5, y: 78 };
        },
      ],
      [
        "negative pivot",
        (v: Mutable) => {
          v.recipe.pivot = { x: -1, y: 78 };
        },
      ],
      [
        "missing pivot",
        (v: Mutable) => {
          delete v.recipe.pivot;
        },
      ],
    ] as const) {
      expect(parseWith(mutate).ok, label).toBe(false);
    }
  });

  it("leaves image requests as they were: batch is required and a seed is free", () => {
    expect(parseGenerationRequest(request).ok).toBe(true);
    const { batch: _batch, ...noBatch } = request;
    expect(parseGenerationRequest(noBatch).ok).toBe(false);
    expect(parseGenerationRequest({ ...request, seed: 7 }).ok).toBe(true);
  });
});

describe("rendered provenance", () => {
  const revisionHash = hashOf(0xaaa);

  function pin() {
    return { version: "5.2.2", build: "d13f752e3b9c", sha256: H("a") };
  }

  function revisionRecipe() {
    return {
      hash: revisionHash,
      profile: { id: "zeus", hash: H("1") },
      camera: H("2"),
      palette: { id: "greek-retro", digest: H("3") },
      pivot: { x: 56, y: 78 },
      script: H("4"),
      postStep: 1,
      blender: pin(),
      kit: H("5"),
      stamps: H("6"),
    };
  }

  function renderedSlot(
    state: string,
    facing: string,
    frameCount: number,
    ability?: string,
    at = 0,
  ) {
    const roleHashes = (role: number) =>
      Array.from({ length: frameCount }, (_, i) =>
        hashOf(role * 1000 + at * 100 + i + 1),
      );
    return {
      slotKey: [state, facing, ability]
        .filter((p) => p !== undefined)
        .join("/"),
      recipeHash: hashOf(0xb00 + at),
      revisionRecipeHash: revisionHash,
      state,
      clip: state === "act" ? "Spell_Simple_Shoot" : "Walking_A",
      facing,
      ...(ability === undefined ? {} : { ability }),
      seed: 0,
      frameCount,
      raw: { colour: roleHashes(1), id: roleHashes(2), depth: roleHashes(3) },
    };
  }

  function rendered(
    slots: Mutable[] = [renderedSlot("walk", "south", 16)],
  ): Mutable {
    return {
      method: "rendered",
      revisionRecipe: revisionRecipe(),
      slots,
      licences: [
        { subject: "quaternius-kit", role: "input", licence: "CC0-1.0" },
        { subject: "blender", role: "runtime", licence: "GPL-3.0-or-later" },
      ],
      relatedJobs: [
        { jobId: "zeus-retro-0000", status: "succeeded", outputs: [H("7")] },
      ],
      handEdits: [],
      sourceAssets: [],
    };
  }

  const renderedManifest = (provenance: Mutable = rendered()) => ({
    ...godTallSprite(),
    provenance,
  });

  it("round-trips through the provenance parser and the manifest, canonically", () => {
    const parsed = parseProvenance(rendered());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.method).toBe("rendered");
    const again = parseProvenance(JSON.parse(JSON.stringify(parsed.value)));
    expect(again).toEqual(parsed);
    const manifest = parsesAs(renderedManifest());
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    const text = canonicalManifestText(manifest.value);
    const reparsed = parseAssetManifest(JSON.parse(text), vocab);
    expect(reparsed.ok && canonicalManifestText(reparsed.value)).toBe(text);
  });

  it("keeps every recorded field", () => {
    const parsed = parseProvenance(rendered());
    if (!parsed.ok || parsed.value.method !== "rendered")
      throw new Error("expected rendered provenance");
    expect(parsed.value.revisionRecipe).toEqual(revisionRecipe() as never);
    expect(parsed.value.slots[0]).toEqual(
      renderedSlot("walk", "south", 16) as never,
    );
  });

  it("covers an ability slot and all four facings", () => {
    const slots = FACINGS.map((facing, at) =>
      renderedSlot("act", facing, 12, "thunderbolt", at),
    );
    expect(parseProvenance(rendered(slots)).ok).toBe(true);
  });

  const missing = (label: string, mutate: (v: Mutable) => void, path: RegExp) =>
    it(`refuses ${label}`, () => {
      const value = rendered();
      mutate(value);
      const result = parseProvenance(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(`${result.path} ${result.message}`).toMatch(path);
    });

  for (const field of ["version", "build", "sha256"] as const) {
    missing(
      `a Blender pin with no ${field}`,
      (v) => {
        delete v.revisionRecipe.blender[field];
      },
      new RegExp(`blender\\.${field}`),
    );
  }
  for (const field of [
    "hash",
    "profile",
    "camera",
    "palette",
    "pivot",
    "script",
    "postStep",
    "blender",
    "kit",
    "stamps",
  ] as const) {
    missing(
      `a revision recipe with no ${field}`,
      (v) => {
        delete v.revisionRecipe[field];
      },
      new RegExp(`revisionRecipe\\.${field}`),
    );
  }
  missing(
    "a profile with no hash",
    (v) => {
      delete v.revisionRecipe.profile.hash;
    },
    /profile\.hash/,
  );
  missing(
    "a palette with no digest",
    (v) => {
      delete v.revisionRecipe.palette.digest;
    },
    /palette\.digest/,
  );
  missing(
    "a malformed pin hash",
    (v) => {
      v.revisionRecipe.blender.sha256 = "abc";
    },
    /blender\.sha256/,
  );
  missing(
    "a non-hex Blender build",
    (v) => {
      v.revisionRecipe.blender.build = "not a hash";
    },
    /blender\.build/,
  );
  missing(
    "a camera id on the recipe",
    (v) => {
      v.revisionRecipe.cameraId = "iso";
    },
    /cameraId/,
  );
  missing(
    "no slots",
    (v) => {
      v.slots = [];
    },
    /slots/,
  );
  missing(
    "a slot with a seed other than 0",
    (v) => {
      v.slots[0].seed = 1;
    },
    /slots\[0\]\.seed/,
  );
  missing(
    "a slot whose key is not state/facing",
    (v) => {
      v.slots[0].slotKey = "walk/north";
    },
    /slots\[0\]\.slotKey/,
  );
  missing(
    "a slot with no recipe hash",
    (v) => {
      delete v.slots[0].recipeHash;
    },
    /slots\[0\]\.recipeHash/,
  );
  missing(
    "a slot with no clip",
    (v) => {
      delete v.slots[0].clip;
    },
    /slots\[0\]\.clip/,
  );
  missing(
    "a slot with no raw depth hashes",
    (v) => {
      delete v.slots[0].raw.depth;
    },
    /raw\.depth/,
  );
  missing(
    "raw hashes that disagree with the frame count",
    (v) => {
      v.slots[0].raw.id.pop();
    },
    /raw\.id/,
  );
  missing(
    "a zero frame count",
    (v) => {
      v.slots[0].frameCount = 0;
      v.slots[0].raw = { colour: [], id: [], depth: [] };
    },
    /frameCount/,
  );
  missing(
    "a duplicate slot key",
    (v) => {
      v.slots.push({ ...v.slots[0] });
    },
    /slots\[1\]/,
  );
  missing(
    "a slot rendered under another revision recipe hash",
    (v) => {
      v.slots[0].revisionRecipeHash = hashOf(0xccc);
    },
    /slots\[0\]\.revisionRecipeHash/,
  );
  missing(
    "no licence record",
    (v) => {
      v.licences = [];
    },
    /licences/,
  );
  missing(
    "an unknown key",
    (v) => {
      v.generations = [];
    },
    /generations/,
  );

  it("refuses slots that differ in revision recipe hash, whichever slot differs", () => {
    const slots = [
      renderedSlot("walk", "south", 16, undefined, 0),
      renderedSlot("walk", "north", 16, undefined, 1),
    ];
    expect(parseProvenance(rendered(slots)).ok).toBe(true);
    const odd = JSON.parse(JSON.stringify(slots)) as Mutable[];
    (odd[1] as Mutable).revisionRecipeHash = hashOf(0xddd);
    const result = parseProvenance(rendered(odd));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.path).toMatch(/slots\[1\]\.revisionRecipeHash/);
  });

  it("refuses a rendered slot absent from the manifest, a different frame count, and a different pivot", () => {
    expect(parsesAs(renderedManifest()).ok).toBe(true);
    const absent = parsesAs(
      renderedManifest(rendered([renderedSlot("walk", "north", 16)])),
    );
    expect(absent.ok).toBe(false);
    if (!absent.ok) expect(absent.path).toMatch(/provenance\.slots\[0\]/);
    const shorter = parsesAs(
      renderedManifest(rendered([renderedSlot("walk", "south", 15)])),
    );
    expect(shorter.ok).toBe(false);
    if (!shorter.ok)
      expect(shorter.path).toMatch(/provenance\.slots\[0\]\.frameCount/);
    const provenance = rendered();
    provenance.revisionRecipe.pivot = { x: 50, y: 78 };
    const moved = parsesAs(renderedManifest(provenance));
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.path).toMatch(/revisionRecipe\.pivot/);
  });

  it("is a sprite method: a portrait or an effect cannot be rendered", () => {
    const asPortrait = { ...portrait(), provenance: rendered() };
    expect(parsesAs(asPortrait).ok).toBe(false);
    const asEffect = { ...effect(), provenance: rendered() };
    expect(parsesAs(asEffect).ok).toBe(false);
  });

  it("keeps GenerationRef.model non-null, and a generation never records a recipe request", () => {
    expect(parseProvenance(generated()).ok).toBe(true);
    const noModel: Mutable = generated();
    noModel.generations[0].model = null;
    const refusedModel = parseProvenance(noModel);
    expect(refusedModel.ok).toBe(false);
    if (!refusedModel.ok)
      expect(refusedModel.path).toMatch(/generations\[0\]\.model/);
    const recipeRef: Mutable = generated();
    recipeRef.generations[0].request.recipe = {
      profile: "zeus",
      palette: "greek-retro",
      pivot: { x: 56, y: 78 },
    };
    const refusedRecipe = parseProvenance(recipeRef);
    expect(refusedRecipe.ok).toBe(false);
    if (!refusedRecipe.ok)
      expect(refusedRecipe.path).toMatch(/generations\[0\]\.request/);
  });
});

describe("tile manifests", () => {
  const PERIOD = 4;
  const revisionHash = hashOf(0xaaa);

  function tileSlot(role: string, at: number) {
    return {
      slotKey: role,
      recipeHash: hashOf(0xb00 + at),
      revisionRecipeHash: revisionHash,
      role,
      seed: 0,
      frameCount: 1,
      raw: {
        colour: [hashOf(1000 + at)],
        id: [hashOf(2000 + at)],
        depth: [hashOf(3000 + at)],
      },
    };
  }

  function tileProvenance(
    slots: Mutable[] = [tileSlot("base", 0), tileSlot("over", 1)],
  ): Mutable {
    return {
      method: "rendered",
      revisionRecipe: {
        hash: revisionHash,
        profile: { id: "grass-flagstone", hash: H("1") },
        camera: H("2"),
        palette: { id: "greek-retro", digest: H("3") },
        pivot: { x: 32, y: 16 },
        script: H("4"),
        postStep: 1,
        blender: { version: "5.2.2", build: "d13f752e3b9c", sha256: H("a") },
        kit: H("5"),
        stamps: H("6"),
      },
      slots,
      licences: [
        { subject: "blender", role: "runtime", licence: "GPL-3.0-or-later" },
      ],
      relatedJobs: [
        { jobId: "grass-0000", status: "succeeded", outputs: [H("7")] },
        { jobId: "grass-0001", status: "succeeded", outputs: [H("8")] },
      ],
      handEdits: [],
      sourceAssets: [],
    };
  }

  function tile(
    period = PERIOD,
    provenance: Mutable = tileProvenance(),
  ): Mutable {
    return {
      schemaVersion: 1,
      kind: "tile",
      id: "grass-flagstone",
      cell: { w: 64, h: 32 },
      pixelScale: 1,
      paletteFamily: "town",
      paletteId: "greek-retro",
      styleTag: "retro",
      atlas: { blob: H("d"), width: 16 * 64, height: period * period * 32 },
      terrain: { base: "grass", over: "flagstone" },
      period,
      provenance,
    };
  }

  const tileRefusal = (value: Mutable) => {
    const result = parsesAs(value);
    if (result.ok) throw new Error("expected a refusal");
    return `${result.path} ${result.message}`;
  };

  it("parses an N=4 tile manifest with base and over slots and stores it byte-identical", () => {
    const parsed = parsesAs(tile());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe("tile");
    if (parsed.value.kind !== "tile") return;
    expect(parsed.value.terrain).toEqual({ base: "grass", over: "flagstone" });
    expect(parsed.value.period).toBe(4);
    expect(parsed.value.atlas).toEqual({
      blob: H("d") as never,
      width: 1024,
      height: 512,
    });
    const text = canonicalManifestText(parsed.value);
    const again = parseAssetManifest(JSON.parse(text), vocab);
    expect(again.ok && canonicalManifestText(again.value)).toBe(text);
    const slots =
      parsed.value.provenance.method === "rendered"
        ? parsed.value.provenance.slots.map((slot) => slot.slotKey)
        : [];
    expect(slots).toEqual(["base", "over"]);
  });

  it("keeps every committed manifest, sprite, portrait and effect, byte-identical through the parser", () => {
    const dir = join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "content",
      "greek",
      "assets",
      "registry",
      "manifests",
    );
    const names = readdirSync(dir).filter((name) => name.endsWith(".json"));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const text = readFileSync(join(dir, name), "utf8");
      const parsed = parseAssetManifest(JSON.parse(text), vocab);
      expect(parsed.ok, name).toBe(true);
      if (parsed.ok)
        expect(canonicalManifestText(parsed.value), name).toBe(text);
    }
  });

  it("takes any positive integer period, and sizes the atlas 16 columns by N squared rows", () => {
    for (const period of [1, 2, 3, 8]) {
      expect(parsesAs(tile(period)).ok, `N=${period}`).toBe(true);
    }
    const wrong = tile();
    wrong.atlas.height = 8 * 32;
    expect(tileRefusal(wrong)).toMatch(/atlas/);
    const narrow = tile();
    narrow.atlas.width = 15 * 64;
    expect(tileRefusal(narrow)).toMatch(/atlas/);
  });

  it("refuses a period that is not a positive integer, naming the period", () => {
    for (const period of [0, 1.5, -1, "4", null]) {
      const value = tile();
      value.period = period;
      expect(tileRefusal(value), `N=${String(period)}`).toMatch(
        /period.*positive integer/,
      );
    }
    const none = tile();
    delete none.period;
    expect(tileRefusal(none)).toMatch(/period/);
  });

  it("refuses a tile off the 64x32 cell, equal terrains, or keys that belong to another kind", () => {
    const off = tile();
    off.cell = { w: 64, h: 64 };
    expect(tileRefusal(off)).toMatch(/cell/);
    const same = tile();
    same.terrain = { base: "grass", over: "grass" };
    expect(tileRefusal(same)).toMatch(/terrain/);
    const bad = tile();
    bad.terrain = { base: "Grass", over: "flagstone" };
    expect(tileRefusal(bad)).toMatch(/terrain\.base/);
    const spriteKey = tile();
    spriteKey.pivot = { x: 0, y: 0 };
    expect(tileRefusal(spriteKey)).toMatch(/pivot/);
  });

  it("tiles take rendered provenance and refuse a slot that names a state or misses a role", () => {
    const swapped = tile(PERIOD, tileProvenance([tileSlot("base", 0)]));
    expect(tileRefusal(swapped)).toMatch(/over/);
    const unknown = tile(
      PERIOD,
      tileProvenance([tileSlot("base", 0), tileSlot("under", 1)]),
    );
    expect(tileRefusal(unknown)).toMatch(/slots\[1\]/);
    const mismatched = tileSlot("over", 1);
    mismatched.slotKey = "base";
    expect(
      tileRefusal(
        tile(PERIOD, tileProvenance([tileSlot("base", 0), mismatched])),
      ),
    ).toMatch(/slots\[1\]/);
    const doubled = tile(
      PERIOD,
      tileProvenance([tileSlot("base", 0), tileSlot("base", 1)]),
    );
    expect(tileRefusal(doubled)).toMatch(/slots\[1\]/);
    const { role: _role, ...bare } = tileSlot("over", 1);
    const spriteSlot = {
      ...bare,
      slotKey: "walk/south",
      state: "walk",
      clip: "Walking_A",
      facing: "south",
    };
    expect(
      tileRefusal(
        tile(PERIOD, tileProvenance([tileSlot("base", 0), spriteSlot])),
      ),
    ).toMatch(/slots\[1\]/);
  });

  it("a tile slot carries no state, clip or facing, and a sprite is unchanged by the tile variant", () => {
    const withState = tileSlot("base", 0) as Mutable;
    withState.state = "idle";
    expect(
      tileRefusal(
        tile(PERIOD, tileProvenance([withState, tileSlot("over", 1)])),
      ),
    ).toMatch(/state/);
    const provenance = tileProvenance();
    provenance.revisionRecipe.pivot = { x: 56, y: 78 };
    const asSprite = { ...godTallSprite(), provenance };
    expect(tileRefusal(asSprite)).toMatch(/slots\[0\]/);
  });

  it("maps (mask, offset) to the atlas cell: 16 columns by mask, one row per offset, frame index offset*16 + mask", () => {
    expect(tileAtlasRect(0, 0, 4)).toEqual({ x: 0, y: 0, w: 64, h: 32 });
    expect(tileAtlasRect(15, 0, 4)).toEqual({ x: 960, y: 0, w: 64, h: 32 });
    expect(tileAtlasRect(0, 15, 4)).toEqual({ x: 0, y: 480, w: 64, h: 32 });
    expect(tileAtlasRect(15, 15, 4)).toEqual({ x: 960, y: 480, w: 64, h: 32 });
    expect(tileAtlasRect(5, 7, 4)).toEqual({ x: 320, y: 224, w: 64, h: 32 });
    expect(tileAtlasRect(15, 0, 1)).toEqual({ x: 960, y: 0, w: 64, h: 32 });
    const seen = new Set<string>();
    for (let offset = 0; offset < 16; offset += 1) {
      for (let mask = 0; mask < 16; mask += 1) {
        const rect = tileAtlasRect(mask, offset, 4);
        expect((rect.y / 32) * 16 + rect.x / 64).toBe(offset * 16 + mask);
        expect(rect.x + rect.w).toBeLessThanOrEqual(1024);
        expect(rect.y + rect.h).toBeLessThanOrEqual(512);
        seen.add(`${rect.x},${rect.y}`);
      }
    }
    expect(seen.size).toBe(256);
  });

  it("the period bounds the offset but does not move a cell", () => {
    expect(tileAtlasRect(3, 2, 2)).toEqual(tileAtlasRect(3, 2, 4));
    expect(tileAtlasRect(3, 2, 2)).toEqual({ x: 192, y: 64, w: 64, h: 32 });
    expect(() => tileAtlasRect(0, 4, 2)).toThrow(RangeError);
    expect(() => tileAtlasRect(0, 16, 4)).toThrow(RangeError);
    expect(() => tileAtlasRect(16, 0, 4)).toThrow(RangeError);
    expect(() => tileAtlasRect(-1, 0, 4)).toThrow(RangeError);
    expect(() => tileAtlasRect(0, 1.5, 4)).toThrow(RangeError);
    expect(() => tileAtlasRect(0, 0, 0)).toThrow(RangeError);
  });

  it("accepts a tile recipe request, with state and direction gone and the role named", () => {
    const parsed = parseGenerationRequest({
      schemaVersion: 1,
      subject: "grass-flagstone",
      kind: "tile",
      slots: [{ role: "base" }, { role: "over" }],
      recipe: {
        profile: "grass-flagstone",
        palette: "greek-retro",
        pivot: { x: 32, y: 16 },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ kind: "tile", batch: 1, seed: 0 });
    expect(parsed.value.slots).toEqual([{ role: "base" }, { role: "over" }]);
    expect(
      parseGenerationRequest(JSON.parse(JSON.stringify(parsed.value))),
    ).toEqual(parsed);
  });

  it("refuses a slot role outside base and over, and still refuses a recipe request for a portrait", () => {
    const request = (slots: unknown[], kind = "tile") => ({
      schemaVersion: 1,
      subject: "grass-flagstone",
      kind,
      slots,
      recipe: {
        profile: "grass-flagstone",
        palette: "greek-retro",
        pivot: { x: 32, y: 16 },
      },
    });
    const under = parseGenerationRequest(request([{ role: "under" }]));
    expect(under.ok).toBe(false);
    if (!under.ok) expect(under.path).toMatch(/slots\[0\]\.role/);
    expect(
      parseGenerationRequest(request([{ expression: "neutral" }], "portrait"))
        .ok,
    ).toBe(false);
  });
});
