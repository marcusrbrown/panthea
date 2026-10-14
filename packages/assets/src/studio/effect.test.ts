import { afterEach, describe, expect, test } from "bun:test";
import {
  type AssetManifest,
  canonicalManifestText,
  parseAssetManifest,
  type Sha256,
} from "@panthea/contracts";
import {
  type AssetRig,
  assetRig,
  loadContent,
  removeTempRoots,
} from "../../test/studio/fixtures";
import {
  defaultRecipe,
  EFFECT_GENERATOR,
  recipeParams,
} from "../effects/generate";
import { sha256Hex } from "../hash";
import { paletteDigest } from "../palette";
import { encodeRgbaPng } from "../placeholder";
import { loadRegistry } from "../registry";
import type { EditFailure } from "./edit-session";
import type { EffectInput } from "./effect";
import { readStudioStatus } from "./store";

afterEach(removeTempRoots);

/** A rig over the committed content: its palettes include the approved greek-retro, and the registry is a scratch directory. */
function rig(): AssetRig {
  const content = loadContent();
  return { ...assetRig(), content, palettes: content.palettes };
}

const input = (over: Partial<EffectInput> = {}): EffectInput => ({
  id: "lightning-draft",
  assetId: "lightning-strike",
  effect: "lightning",
  seed: 7,
  palette: "greek-retro",
  styleTag: "retro",
  ...over,
});

const make = (r: AssetRig, over: Partial<EffectInput> = {}) =>
  r.session.effect(input(over), r.content, r.palettes);

function made(r: AssetRig, over: Partial<EffectInput> = {}) {
  const result = make(r, over);
  if (!result.ok) throw new Error(result.message);
  return result.asset;
}

const approved = (r: AssetRig, id = "lightning-draft") => {
  const result = r.session.approveAsset(id, {}, r.content, r.palettes);
  if (!result.ok) throw new Error(result.message);
  return result.asset;
};

const publish = (r: AssetRig, id = "lightning-draft") =>
  r.session.publishAsset(id, r.content, r.palettes, r.registryRoot);

describe("the effect op", () => {
  test("makes a draft effect with procedural provenance, a stored atlas, a passing report and one ledger entry", () => {
    const r = rig();
    const asset = made(r);

    expect(asset.id).toBe("lightning-draft");
    expect(asset.workingSetId).toBeNull();
    expect(asset.prior).toBeNull();
    expect(asset.published).toBeNull();
    expect(asset.record.state).toBe("draft");
    expect(asset.record.state === "draft" && asset.record.report?.status).toBe(
      "pass",
    );
    const manifest = asset.record.manifest;
    expect(manifest.kind).toBe("effect");
    if (manifest.kind !== "effect") return;
    expect(manifest.animations.map((a) => a.name)).toEqual(["full", "calm"]);
    expect(manifest.glowColours).toHaveLength(3);
    const palette = r.palettes.get("greek-retro");
    const provenance = manifest.provenance;
    expect(provenance.method).toBe("procedural");
    if (provenance.method !== "procedural") return;
    expect(provenance.generator).toEqual(EFFECT_GENERATOR);
    expect(provenance.seed).toBe(7);
    expect(provenance.params).toEqual(
      recipeParams(defaultRecipe("lightning", 7)),
    );
    expect(provenance.palette).toEqual({
      id: "greek-retro",
      digest: paletteDigest(palette as NonNullable<typeof palette>),
    });
    expect(Object.keys(provenance.frameHashes)).toEqual(["full", "calm"]);
    expect(provenance.frameHashes.full).toHaveLength(8);
    // The atlas the manifest names is stored, and is what its hash says.
    const atlas = r.session.store.readBlob(manifest.atlas.blob);
    expect(atlas === undefined ? "" : sha256Hex(atlas)).toBe(
      manifest.atlas.blob,
    );
    expect(
      readStudioStatus(r.root).commands.map((c) => `${c.type}:${c.jobId}`),
    ).toEqual(["effect:lightning-draft"]);
  });

  test("makes the same revision from the same input", () => {
    const one = made(rig());
    const two = made(rig());
    expect(two.manifestRevision).toBe(one.manifestRevision);
    expect(canonicalManifestText(two.record.manifest)).toBe(
      canonicalManifestText(one.record.manifest),
    );
  });

  test("makes the fire loop as one animation", () => {
    const r = rig();
    const asset = made(r, {
      id: "fire-draft",
      assetId: "fire-loop",
      effect: "fire",
    });
    const manifest = asset.record.manifest;
    expect(
      manifest.kind === "effect" && manifest.animations.map((a) => a.name),
    ).toEqual(["burn"]);
    expect(manifest.kind === "effect" && manifest.glowColours).toHaveLength(5);
  });

  test("applies parameter overrides over the defaults", () => {
    const r = rig();
    const asset = made(r, { params: { depth: 4 } });
    const provenance = asset.record.manifest.provenance;
    expect(provenance.method === "procedural" && provenance.params.depth).toBe(
      4,
    );
  });

  test("refuses bad input and writes nothing", () => {
    const r = rig();
    const cases: [Partial<EffectInput>, EditFailure][] = [
      [{ id: "Bad Id" }, "invalid-params"],
      [{ assetId: "Bad" }, "invalid-params"],
      [{ effect: "smoke" as never }, "invalid-params"],
      [{ seed: -1 }, "invalid-params"],
      [{ params: { depth: 99 } }, "invalid-params"],
      [{ params: { extra: 1 } }, "invalid-params"],
      [{ palette: "no-such-palette" }, "not-found"],
    ];
    for (const [over, reason] of cases) {
      const result = make(r, over);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(reason);
    }
    expect(readStudioStatus(r.root).commands).toEqual([]);
    expect(readStudioStatus(r.root).assets).toEqual([]);
  });

  test("refuses to reuse a record id", () => {
    const r = rig();
    made(r);
    const again = make(r);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("wrong-state");
  });

  test("refuses on a closed session", () => {
    const r = rig();
    r.session.close();
    const result = make(r);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("closed");
  });
});

describe("approving and publishing an effect", () => {
  test("a drafted effect approves and publishes into a registry, which loads it", () => {
    const r = rig();
    made(r);
    expect(approved(r).record.state).toBe("approved");
    const result = publish(r);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.record.state).toBe("canon");
    const loaded = loadRegistry(r.registryRoot, r.content.vocabulary);
    expect(loaded.problems).toEqual([]);
    const entry = loaded.snapshot.entries.get("lightning-strike");
    expect(entry?.revision).toBe(result.asset.published?.revision as Sha256);
    expect(entry?.manifest.kind).toBe("effect");
  });

  test("a published effect is not published twice", () => {
    const r = rig();
    made(r);
    approved(r);
    expect(publish(r).ok).toBe(true);
    expect(publish(r).ok).toBe(false);
  });

  test("publish regenerates the effect and accepts the bytes it made", () => {
    const r = rig();
    made(r, { id: "fire-draft", assetId: "fire-loop", effect: "fire" });
    approved(r, "fire-draft");
    expect(publish(r, "fire-draft").ok).toBe(true);
  });

  /** Rewrites an approved draft's stored manifest and atlas the way a hand edit would, keeping every hash consistent. */
  function tamper(
    r: AssetRig,
    change: (manifest: AssetManifest, atlas: Uint8Array) => AssetManifest,
    atlasEdit?: (rgba: Uint8Array) => void,
  ) {
    const found = r.session.store.readAsset("lightning-draft");
    if (found.kind !== "found") throw new Error("no asset");
    const asset = found.value;
    const old = asset.record.manifest;
    let atlas = r.session.store.readBlob(old.atlas.blob) as Uint8Array;
    if (atlasEdit !== undefined) {
      const decoded = decodeAtlas(atlas);
      atlasEdit(decoded.rgba);
      atlas = encodeRgbaPng(decoded.rgba, decoded.width, decoded.height);
    }
    const blob = r.session.store.putBlob(atlas);
    const next = change(
      { ...old, atlas: { ...old.atlas, blob } } as AssetManifest,
      atlas,
    );
    const parsed = parseAssetManifest(
      JSON.parse(JSON.stringify(next)),
      r.content.vocabulary,
    );
    if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
    const revision = sha256Hex(
      new TextEncoder().encode(canonicalManifestText(parsed.value)),
    );
    r.session.store.putAsset({
      ...asset,
      record: {
        ...asset.record,
        manifest: parsed.value,
      } as typeof asset.record,
      manifestRevision: revision,
      reportBasis: { ...asset.reportBasis, atlasHash: blob },
      licenceReview: { ...asset.licenceReview, manifestRevision: revision },
    });
  }

  function decodeAtlas(png: Uint8Array) {
    const { decodePng } =
      require("./png/decode") as typeof import("./png/decode");
    const out = decodePng(png);
    if (!out.ok) throw new Error("atlas");
    return {
      rgba: Uint8Array.from(out.image.rgba),
      width: out.image.width,
      height: out.image.height,
    };
  }

  const registryEmpty = (r: AssetRig) =>
    loadRegistry(r.registryRoot, r.content.vocabulary).snapshot.entries.size ===
    0;

  test("publish refuses an effect whose atlas bytes are not what its recipe generates", () => {
    const r = rig();
    made(r);
    approved(r);
    tamper(
      r,
      (m) => m,
      (rgba) => {
        // Recolour the first opaque pixel of the first frame.
        for (let p = 0; p < rgba.length; p += 4)
          if (rgba[p + 3] === 255) {
            rgba[p] = rgba[p] === 0 ? 1 : 0;
            break;
          }
      },
    );
    const result = publish(r);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("wrong-state");
      expect(result.message).toMatch(/recipe/);
    }
    expect(registryEmpty(r)).toBe(true);
  });

  test("publish refuses an effect whose recorded seed is not the one that made its pixels", () => {
    const r = rig();
    made(r);
    approved(r);
    tamper(r, (m) =>
      m.provenance.method === "procedural"
        ? ({ ...m, provenance: { ...m.provenance, seed: 8 } } as AssetManifest)
        : m,
    );
    const result = publish(r);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/recipe/);
    expect(registryEmpty(r)).toBe(true);
  });

  test("publish refuses an effect made by another generator version", () => {
    const r = rig();
    made(r);
    approved(r);
    tamper(r, (m) =>
      m.provenance.method === "procedural"
        ? ({
            ...m,
            provenance: {
              ...m.provenance,
              generator: { ...m.provenance.generator, version: 99 },
            },
          } as AssetManifest)
        : m,
    );
    const result = publish(r);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/generator/);
    expect(registryEmpty(r)).toBe(true);
  });

  test("publish refuses an effect whose palette changed since it was generated", () => {
    const r = rig();
    made(r);
    approved(r);
    tamper(r, (m) =>
      m.provenance.method === "procedural"
        ? ({
            ...m,
            provenance: {
              ...m.provenance,
              palette: {
                ...m.provenance.palette,
                digest: "0".repeat(64) as Sha256,
              },
            },
          } as AssetManifest)
        : m,
    );
    const result = publish(r);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/palette/);
  });

  test("publish refuses an effect whose manifest is not the one its recipe makes", () => {
    const r = rig();
    made(r);
    approved(r);
    tamper(r, (m) =>
      m.kind === "effect"
        ? ({ ...m, pivot: { x: 1, y: 1 } } as AssetManifest)
        : m,
    );
    const result = publish(r);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/recipe/);
    expect(registryEmpty(r)).toBe(true);
  });
});

describe("the ledger and the store", () => {
  test("an effect draft is stored with no working set and reads back", () => {
    const r = rig();
    made(r);
    const status = readStudioStatus(r.root);
    expect(status.invalid).toEqual([]);
    expect(status.assets.map((a) => a.workingSetId)).toEqual([null]);
  });
});
