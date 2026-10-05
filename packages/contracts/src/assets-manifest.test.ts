import { describe, expect, it } from "bun:test";
import vocabularyJson from "../../../content/greek/assets/vocabulary.json";
import {
  type AssetVocabulary,
  canonicalManifestText,
  parseAssetManifest,
  parseAssetVocabulary,
  parseGenerationRequest,
  parseProvenance,
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

function generated() {
  return {
    method: "generated",
    jobId: "job-1",
    request,
    runtime: { name: "stable-diffusion.cpp", version: "master-929-3f8527a" },
    model: { id: "z-image-turbo", sha256: H("a") },
    loras: [{ id: "pixel-lora", sha256: H("b") }],
    seed: 20261003,
    settings: { sample_method: "euler", sample_steps: 8, guidance: 1 },
    resultHashes: [H("c")],
    licences: [
      { subject: "z-image-turbo", role: "model", licence: "Apache-2.0" },
      { subject: "pixel-lora", role: "lora", licence: "Apache-2.0" },
    ],
    relatedJobs: [
      { jobId: "job-1", status: "succeeded", outputs: [H("c")] },
      { jobId: "job-0", status: "cancelled" },
    ],
    handEdits: [],
    sourceAssets: [],
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
    realmVariants: [{ paletteFamily: "underworld", paletteId: "provisional" }],
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
    tier: 1,
    emissiveAccents: ["#ffffcc"],
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
    "the reserved tile kind",
    sprite,
    (v) => {
      v.kind = "tile";
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
    "an effect tier outside the vocabulary",
    effect,
    (v) => {
      v.tier = 4;
    },
    /tier/,
  );
  rejects(
    "more emissive accents than allowed",
    effect,
    (v) => {
      v.emissiveAccents = [
        "#111111",
        "#222222",
        "#333333",
        "#444444",
        "#555555",
      ];
    },
    /emissiveAccents/,
  );
  rejects(
    "a malformed emissive accent",
    effect,
    (v) => {
      v.emissiveAccents = ["red"];
    },
    /emissiveAccents\[0\]/,
  );
  rejects(
    "a tier-one effect over the reduced-effects bound",
    effect,
    (v) => {
      v.animations[0].frames = frames(3, 64, 128, 120);
    },
    /tier/,
  );
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
  it("allows a longer animation at tier two", () => {
    const value = effect();
    value.tier = 2;
    value.animations[0].frames = frames(3, 64, 128, 200);
    expect(parseAssetManifest(value, vocab).ok).toBe(true);
  });
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
    "a model with no licence record",
    generated,
    (v) => {
      v.licences = [v.licences[1]];
    },
    /licences.*z-image-turbo/,
  );
  provenanceRejects(
    "a LoRA with no licence record",
    generated,
    (v) => {
      v.licences = [v.licences[0]];
    },
    /licences.*pixel-lora/,
  );
  provenanceRejects(
    "a source job missing from the job refs",
    generated,
    (v) => {
      v.jobId = "job-9";
    },
    /jobId/,
  );
  provenanceRejects(
    "a cancelled source job",
    generated,
    (v) => {
      v.jobId = "job-0";
    },
    /jobId/,
  );
  provenanceRejects(
    "result hashes that differ from the job outputs",
    generated,
    (v) => {
      v.resultHashes = [H("9")];
    },
    /resultHashes/,
  );
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
      v.settings.apiKey = "abc";
    },
    /settings\.apiKey/,
  );
  provenanceRejects(
    "an endpoint in a setting value",
    generated,
    (v) => {
      v.settings.server = "http://127.0.0.1:8080";
    },
    /settings\.server/,
  );
  provenanceRejects(
    "a non-scalar setting",
    generated,
    (v) => {
      v.settings.nested = { a: 1 };
    },
    /settings\.nested/,
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
});
