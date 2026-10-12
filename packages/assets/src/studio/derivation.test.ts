// Derived slots through the real session: derive -> pack -> approve -> publish,
// every publish into an isolated registry root (never the committed canon).

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AssetManifest,
  type AssetVocabulary,
  canonicalJson,
  canonicalManifestText,
  type LicenceRecord,
  type Sha256,
} from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { sha256Hex } from "../hash";
import { encodeRgbaPng } from "../placeholder";
import { readRevision } from "../registry";
import {
  type AssetRig,
  assetRig,
  finishSheet,
  loadContent,
  paintFigure,
  removeTempRoots,
  runSlots,
} from "./_test-fixtures";
import { rampIndex, recomputeStep } from "./derivation";
import { swapImage } from "./derive";
import { type PackInput, packAsset } from "./packing";
import { decodePng } from "./png/decode";
import type { ApproveOptions } from "./publish";
import type { StudioContent } from "./request";
import { readStudioStatus } from "./store";
import { parseWorkingSetRecord } from "./working-set";
import { type LicenceAssessment, studioPaths } from "./workspace";

afterEach(removeTempRoots);

const cell = { w: 64, h: 80 };
const ASSET = "zeus-sprite";

/** The real content with Zeus's declared asymmetry taken off: a subject whose west is its east flipped. */
function symmetric(content: StudioContent): StudioContent {
  return {
    ...content,
    visuals: content.visuals.map((v) => {
      const { asymmetry: _declared, ...rest } = v;
      return rest;
    }),
  };
}

const packInput = (over: Partial<PackInput> = {}): PackInput => ({
  id: "pack",
  workingSetId: "w",
  assetId: ASSET,
  styleTag: "draft",
  footprint: { w: 1, h: 1 },
  originalWork: { licence: "MIT", attribution: "the owner" },
  ...over,
});

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
}

/** The owner's assessment of every licence record the studio cannot decide. */
function assessments(licences: readonly LicenceRecord[]): LicenceAssessment[] {
  const seen = new Set<string>();
  return licences.flatMap((record) => {
    const key = JSON.stringify(record);
    if (
      seen.has(key) ||
      ["MIT", "Apache-2.0", "CC0-1.0"].includes(record.licence)
    )
      return [];
    seen.add(key);
    return [
      {
        record,
        disposition: "mit-compatible" as const,
        reason: "the owner read these terms",
      },
    ];
  });
}

/** Approves draft `id` the way the owner would: every unclear licence assessed. */
function approveDraft(
  rig: AssetRig,
  content: StudioContent,
  id: string,
  extra: Partial<ApproveOptions> = {},
) {
  const found = rig.session.store.readAsset(id);
  if (found.kind !== "found") throw new Error(`no asset ${id}`);
  return rig.session.approveAsset(
    id,
    {
      assessments: assessments(found.value.record.manifest.provenance.licences),
      ...extra,
    },
    content,
    rig.palette,
  );
}

/** Packs, approves and publishes working set `setId` as `id`; returns the published revision. */
function release(
  rig: AssetRig,
  content: StudioContent,
  setId: string,
  id: string,
  over: Partial<PackInput> = {},
): Sha256 {
  const { session, registryRoot, palette } = rig;
  const packed = must(
    session.pack(
      packInput({ id, workingSetId: setId, ...over }),
      content,
      palette,
      registryRoot,
    ),
  );
  must(approveDraft(rig, content, id));
  const published = must(
    session.publishAsset(id, content, palette, registryRoot),
  );
  expect(published.asset.published?.revision).toBe(
    packed.asset.manifestRevision,
  );
  return packed.asset.manifestRevision;
}

/** Publishes an idle/east asset: the source every mirror test derives from. */
/** A rig whose content carries the committed master palette, for the swaps that need its real ramps. */
function realPaletteRig(): AssetRig {
  const rig = assetRig();
  const content = loadContent();
  return { ...rig, content, palette: content.palette };
}

function publishEast(rig: AssetRig, content: StudioContent): Sha256 {
  const { session } = rig;
  const [jobId] = runSlots(rig, "zeus-east", "sprite", [
    { state: "idle", direction: "east" },
  ]);
  must(session.openWorkingSet("east", "zeus-east", content));
  must(session.pick("east", jobId as string));
  const frames = [0, 1, 2, 3].map((i) => paintFigure(content, cell, i));
  finishSheet(rig, "east-edit", "east", cell, [
    { slot: "idle/east", frames, durations: [167, 167, 167, 167] },
  ]);
  return release(rig, content, "east", "east-pack");
}

function published(rig: AssetRig, revision: Sha256): AssetManifest {
  const read = readRevision(
    rig.registryRoot,
    ASSET as never,
    revision,
    rig.content.vocabulary as AssetVocabulary,
  );
  if (!read.ok) throw new Error(read.message);
  return read.value.manifest;
}

describe("derive through pack and publish", () => {
  test("a mirrored west packs, approves and publishes with steps[], and deriving again returns the same working set", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    const eastRevision = publishEast(rig, content);

    const input = { asset: ASSET, op: "mirror", from: "idle/east" } as const;
    const first = must(rig.session.derive(input, content, rig.registryRoot));
    expect(first.created).toBe(true);
    expect(first.slots).toEqual(["idle/west"]);
    const again = must(rig.session.derive(input, content, rig.registryRoot));
    expect(again.created).toBe(false);
    expect(again.workingSetId).toBe(first.workingSetId);

    const revision = release(rig, content, first.workingSetId, "west-pack");
    const manifest = published(rig, revision);
    expect(manifest.provenance.method).toBe("derived");
    if (manifest.provenance.method !== "derived") return;
    expect(manifest.provenance.steps).toHaveLength(1);
    expect(manifest.provenance.steps[0]).toMatchObject({
      recipe: "mirror",
      outputSlot: "idle/west",
      source: { assetId: ASSET, revision: eastRevision, slotKey: "idle/east" },
    });
    expect(manifest.provenance.sourceAssets).toEqual([
      { assetId: ASSET as never, revision: eastRevision },
    ]);
    if (manifest.kind !== "sprite") throw new Error("not a sprite");
    expect(manifest.animations.map((a) => `${a.state}/${a.direction}`)).toEqual(
      ["idle/east", "idle/west"],
    );
    expect(manifest.asymmetry).toBeUndefined();

    // The west frames are the east frames flipped, read back from the registry's atlas.
    const atlas = decodePng(
      new Uint8Array(
        readFileSync(
          join(rig.registryRoot, "blobs", `${manifest.atlas.blob}.png`),
        ),
      ),
    );
    if (!atlas.ok) throw new Error(atlas.message);
    const [east, west] = manifest.animations;
    for (const [i, frame] of (west?.frames ?? []).entries()) {
      const e = east?.frames[i]?.rect;
      for (let y = 0; y < cell.h; y += 1)
        for (let x = 0; x < cell.w; x += 1) {
          const from =
            (y * atlas.image.width + (e?.x ?? 0) + (cell.w - 1 - x)) * 4;
          const to = (y * atlas.image.width + frame.rect.x + x) * 4;
          const a = atlas.image.rgba.subarray(from, from + 4);
          const b = atlas.image.rgba.subarray(to, to + 4);
          expect(a[3] === 0 ? [0] : [...a]).toEqual(b[3] === 0 ? [0] : [...b]);
        }
    }
  });

  test("the packed draft holds each derived west cell to its east cell, flipped, and records the check", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const made = must(
      rig.session.derive(
        { asset: ASSET, op: "mirror", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    const packed = must(
      rig.session.pack(
        packInput({ id: "west-pack", workingSetId: made.workingSetId }),
        content,
        rig.palette,
        rig.registryRoot,
      ),
    );
    const record = packed.asset.record;
    if (record.state !== "draft") throw new Error("not a draft");
    expect(record.report?.status).toBe("pass");
    const mirrors = (record.report?.checks ?? []).filter((c) =>
      c.check.endsWith(":mirror"),
    );
    expect(mirrors.map((c) => c.check)).toEqual([
      "idle/west#0:mirror",
      "idle/west#1:mirror",
      "idle/west#2:mirror",
      "idle/west#3:mirror",
    ]);
    expect(mirrors.every((c) => c.status === "pass")).toBe(true);
  });

  test("R15: with the derived blobs deleted, every step regenerates from the manifest and its published source to the same bytes", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    const eastRevision = publishEast(rig, content);
    const made = must(
      rig.session.derive(
        { asset: ASSET, op: "mirror", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    const set = rig.session.store.readWorkingSet(made.workingSetId);
    if (set.kind !== "found") throw new Error("no set");
    const hashes = Object.values(set.value.derived ?? {}).flatMap((entry) =>
      entry.frames.map((f) => f.hash),
    );
    expect(hashes.length).toBe(4);
    const revision = release(rig, content, made.workingSetId, "west-pack");

    for (const hash of hashes)
      rmSync(join(studioPaths(rig.root).blobs, `${hash}.png`));
    expect(rig.session.store.readBlob(hashes[0] as Sha256)).toBeUndefined();

    const manifest = published(rig, revision);
    if (manifest.provenance.method !== "derived")
      throw new Error("not derived");
    const source = readRevision(
      rig.registryRoot,
      ASSET as never,
      eastRevision,
      rig.content.vocabulary as AssetVocabulary,
    );
    if (!source.ok) throw new Error(source.message);
    for (const step of manifest.provenance.steps) {
      const again = recomputeStep(step, {
        source: source.value,
        content,
        subject: "zeus",
      });
      if (!again.ok) throw new Error(again.message);
      expect(again.steps).toEqual([step]);
      expect(again.slots[0]?.resultHash).toBe(step.resultHash);
      // The bytes: re-encoding the recomputed frames gives the PNGs the deleted blobs held.
      expect(again.slots[0]?.frames.map((f) => sha256Hex(f.png))).toEqual(
        hashes,
      );
    }
  });

  test("an in-place bob on a single-animation idle asset packs against the prior revision as its source", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    const eastRevision = publishEast(rig, content);
    const made = must(
      rig.session.derive(
        { asset: ASSET, op: "bob", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    expect(made.slots).toEqual(["idle/east"]);
    const revision = release(rig, content, made.workingSetId, "bob-pack");
    const manifest = published(rig, revision);
    expect(manifest.provenance.method).toBe("derived");
    expect(manifest.provenance.sourceAssets).toEqual([
      { assetId: ASSET as never, revision: eastRevision },
    ]);
    if (manifest.provenance.method !== "derived") return;
    expect(manifest.provenance.steps.map((s) => s.recipe)).toEqual(["bob"]);
    expect(manifest.provenance.runtime.version).toBe("bob@1+encodeRgbaPng@1");
    if (manifest.kind !== "sprite") throw new Error("not a sprite");
    expect(manifest.animations).toHaveLength(1);
    expect(manifest.animations[0]?.frames.map((f) => f.durationMs)).toEqual([
      333, 167, 333, 167,
    ]);
  });

  test("a mirror of Zeus is refused: the subject declares a bolt hand", () => {
    const rig = assetRig();
    publishEast(rig, rig.content);
    const refused = rig.session.derive(
      { asset: ASSET, op: "mirror", from: "idle/east" },
      rig.content,
      rig.registryRoot,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("asymmetric");
    expect(refused.message).toContain("bolt hand");
    // The asymmetry was written into the east asset's own manifest at pack.
    const found = rig.session.store.readAsset("east-pack");
    if (found.kind !== "found") throw new Error("no asset");
    const manifest = found.value.record.manifest;
    expect(manifest.kind === "sprite" && manifest.asymmetry).toEqual({
      feature: "bolt hand",
    });
  });

  test("a corrupt working-set or edit record behind the published source refuses the derive instead of falling back to defaults", () => {
    for (const corrupt of ["working-sets/east.json", "edits/east-edit.json"]) {
      const rig = assetRig();
      const content = symmetric(rig.content);
      publishEast(rig, content);
      writeFileSync(join(rig.root, corrupt), "{not json");

      const refused = rig.session.derive(
        { asset: ASSET, op: "mirror", from: "idle/east" },
        content,
        rig.registryRoot,
      );

      expect(refused.ok, corrupt).toBe(false);
      if (refused.ok) continue;
      expect(refused.reason, corrupt).toBe("wrong-state");
      expect(refused.message, corrupt).toContain(
        corrupt.split("/")[1]?.replace(".json", "") as string,
      );
    }
  });

  test("a published source with no record in this studio falls back to the default conformance", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    rmSync(join(rig.root, "working-sets", "east.json"));

    const made = rig.session.derive(
      { asset: ASSET, op: "mirror", from: "idle/east" },
      content,
      rig.registryRoot,
    );

    expect(made.ok).toBe(true);
  });

  test("a west cell with no east partner gets a failing mirror verdict, so a longer west cannot slip past the check", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    const slots = [
      { state: "act", direction: "east", ability: "thunderbolt" },
      { state: "act", direction: "west", ability: "thunderbolt" },
    ];
    const jobs = runSlots(rig, "zeus-act", "sprite", slots as never);
    must(rig.session.openWorkingSet("act", "zeus-act", content));
    for (const job of jobs) must(rig.session.pick("act", job));
    const east = [0, 1, 2, 3].map((i) => paintFigure(content, cell, i));
    const flipped = (image: RgbaImage): RgbaImage => {
      const rgba = new Uint8Array(image.rgba.length);
      for (let y = 0; y < image.height; y += 1)
        for (let x = 0; x < image.width; x += 1)
          rgba.set(
            image.rgba.subarray(
              (y * image.width + (image.width - 1 - x)) * 4,
              (y * image.width + (image.width - x)) * 4,
            ),
            (y * image.width + x) * 4,
          );
      return { ...image, rgba };
    };
    const west = [...east.map(flipped), flipped(paintFigure(content, cell, 9))];
    finishSheet(rig, "act-edit", "act", cell, [
      {
        slot: "act/east/thunderbolt",
        frames: east,
        durations: [83, 100, 83, 100],
      },
      {
        slot: "act/west/thunderbolt",
        frames: west,
        durations: [83, 100, 83, 100, 83],
      },
    ]);

    const packed = must(
      rig.session.pack(
        packInput({ id: "act-pack", workingSetId: "act" }),
        content,
        rig.palette,
        rig.registryRoot,
      ),
    );

    const record = packed.asset.record;
    if (record.state !== "draft") throw new Error("not a draft");
    const mirrors = (record.report?.checks ?? []).filter((c) =>
      c.check.endsWith(":mirror"),
    );
    expect(mirrors.map((c) => c.check)).toEqual([
      "act/west/thunderbolt#0:mirror",
      "act/west/thunderbolt#1:mirror",
      "act/west/thunderbolt#2:mirror",
      "act/west/thunderbolt#3:mirror",
      "act/west/thunderbolt#4:mirror",
    ]);
    expect(mirrors.slice(0, 4).every((c) => c.status === "pass")).toBe(true);
    expect(mirrors[4]).toMatchObject({ status: "fail" });
    expect(mirrors[4]?.message).toContain("no east frame");
    expect(record.report?.status).toBe("fail");
  });

  test("bob on east while a mirror west is carried: the stale mirror fails the check, and with an exception both steps are recorded and audited", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    const r0 = publishEast(rig, content);
    const mirror = must(
      rig.session.derive(
        { asset: ASSET, op: "mirror", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    const r1 = release(rig, content, mirror.workingSetId, "west-pack");
    const bob = must(
      rig.session.derive(
        { asset: ASSET, op: "bob", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );

    const packed = must(
      rig.session.pack(
        packInput({ id: "bob-pack", workingSetId: bob.workingSetId }),
        content,
        rig.palette,
        rig.registryRoot,
      ),
    );

    const record = packed.asset.record;
    if (record.state !== "draft") throw new Error("not a draft");
    expect(record.report?.status).toBe("fail");
    const failed = (record.report?.checks ?? []).filter(
      (c) => c.check.endsWith(":mirror") && c.status === "fail",
    );
    expect(failed.map((c) => c.check)).toContain("idle/west#2:mirror");
    expect(approveDraft(rig, content, "bob-pack").ok).toBe(false);
    must(
      approveDraft(rig, content, "bob-pack", {
        exception: { reason: "the owner accepts a stale mirror for this test" },
      }),
    );
    const out = must(
      rig.session.publishAsset(
        "bob-pack",
        content,
        rig.palette,
        rig.registryRoot,
      ),
    );

    const manifest = published(rig, out.asset.published?.revision as Sha256);
    expect(manifest.provenance.method).toBe("derived");
    if (manifest.provenance.method !== "derived") return;
    expect(
      manifest.provenance.steps.map((s) => `${s.recipe}:${s.outputSlot}`),
    ).toEqual(["bob:idle/east", "mirror:idle/west"]);
    expect(
      manifest.provenance.steps.find((s) => s.recipe === "mirror")?.source
        .revision,
    ).toBe(r0);
    expect(manifest.provenance.sourceAssets).toContainEqual({
      assetId: ASSET as never,
      revision: r0,
    });
    expect(manifest.provenance.sourceAssets).toContainEqual({
      assetId: ASSET as never,
      revision: r1,
    });
  });

  test("a mirror approved before the subject declared an asymmetry is refused at publish, naming the step", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const made = must(
      rig.session.derive(
        { asset: ASSET, op: "mirror", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    must(
      rig.session.pack(
        packInput({ id: "west-pack", workingSetId: made.workingSetId }),
        content,
        rig.palette,
        rig.registryRoot,
      ),
    );
    must(approveDraft(rig, content, "west-pack"));
    // The declaration arrives: the real content, with Zeus's bolt hand.
    const refused = rig.session.publishAsset(
      "west-pack",
      rig.content,
      rig.palette,
      rig.registryRoot,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("derived step mirror -> idle/west");
    expect(refused.message).toContain("bolt hand");
  });

  test("a derived slot that fails conformance blocks plain approve, and an owner exception approves it", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    // A bob that leaves the cells it vacates empty tears the figure in two.
    const base = {
      region: { x: 0, y: 16, w: 64, h: 26 },
      exclude: [],
      dy: [0, 0, -1, 0],
      durationsMs: [333, 167, 333, 167],
      repairs: [],
    };
    const made = must(
      rig.session.derive(
        {
          asset: ASSET,
          op: "bob",
          from: "idle/east",
          params: { ...base, seam: "none" },
        },
        content,
        rig.registryRoot,
      ),
    );
    const packed = must(
      rig.session.pack(
        packInput({ id: "bob-pack", workingSetId: made.workingSetId }),
        content,
        rig.palette,
        rig.registryRoot,
      ),
    );
    const record = packed.asset.record;
    if (record.state !== "draft") throw new Error("not a draft");
    expect(record.report?.status).toBe("fail");
    expect(
      record.report?.checks.some(
        (c) =>
          c.check.startsWith("idle/east#2:silhouette") && c.status === "fail",
      ),
    ).toBe(true);

    const plain = approveDraft(rig, content, "bob-pack");
    expect(plain.ok).toBe(false);
    const excepted = approveDraft(rig, content, "bob-pack", {
      exception: { reason: "the owner accepts a torn figure for this test" },
    });
    expect(excepted.ok).toBe(true);
  });

  test("a derived slot hand-edited and finished is a hand step: its recipe and source stay as history, and publish does not recompute it", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    const eastRevision = publishEast(rig, content);
    const made = must(
      rig.session.derive(
        { asset: ASSET, op: "mirror", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    // The owner retimes the west cell by hand: the pixels stay the mirror's (a
    // west is still held to its east), the durations are not the recipe's.
    const set = rig.session.store.readWorkingSet(made.workingSetId);
    if (set.kind !== "found") throw new Error("no set");
    const frames = (set.value.derived?.["idle/west"]?.frames ?? []).map(
      (frame) => {
        const bytes = rig.session.store.readBlob(frame.hash);
        const decoded = bytes === undefined ? undefined : decodePng(bytes);
        if (decoded?.ok !== true) throw new Error("a derived frame is gone");
        return decoded.image;
      },
    );
    finishSheet(rig, "west-edit", made.workingSetId, cell, [
      { slot: "idle/west", frames, durations: [200, 200, 200, 200] },
    ]);
    const edited = rig.session.store.readWorkingSet(made.workingSetId);
    if (edited.kind !== "found") throw new Error("no set");
    expect(edited.value.derived).toBeUndefined();
    expect(
      edited.value.frames["idle/west"]?.handEdits[0]?.description,
    ).toContain("idle/west was derived by mirror v1 from zeus-sprite");

    const revision = release(rig, content, made.workingSetId, "west-pack");
    const manifest = published(rig, revision);
    expect(manifest.provenance.method).toBe("hand");
    expect(manifest.provenance.handEdits).toHaveLength(1);
    const step = manifest.provenance.handEdits[0];
    expect(step?.description).toContain("hand edit west-edit");
    expect(step?.description).toContain(
      `mirror v1 from ${ASSET} ${eastRevision} idle/east`,
    );
    expect(manifest.provenance.sourceAssets).toEqual([
      { assetId: ASSET as never, revision: eastRevision },
    ]);
  });

  test("a hand-finished bob keeps its full step in the hand step's history: params, source slot hash and result hash", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const made = must(
      rig.session.derive(
        { asset: ASSET, op: "bob", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    const set = rig.session.store.readWorkingSet(made.workingSetId);
    if (set.kind !== "found") throw new Error("no set");
    const step = set.value.derived?.["idle/east"]?.step;
    if (step === undefined) throw new Error("no step");
    const frames = (set.value.derived?.["idle/east"]?.frames ?? []).map(
      (frame) => {
        const decoded = decodePng(
          rig.session.store.readBlob(frame.hash) as Uint8Array,
        );
        if (!decoded.ok) throw new Error("a derived frame is gone");
        return decoded.image;
      },
    );
    finishSheet(rig, "bob-edit", made.workingSetId, cell, [
      { slot: "idle/east", frames, durations: [250, 250, 250, 250] },
    ]);

    const revision = release(rig, content, made.workingSetId, "bob-pack");

    const manifest = published(rig, revision);
    const description = manifest.provenance.handEdits[0]?.description ?? "";
    expect(description).toContain("bob v1");
    expect(description).toContain(canonicalJson(step.params));
    expect(description).toContain(step.source.slotHash);
    expect(description).toContain(step.resultHash);
  });

  test("a working set with a new derived slot and a new generated slot is refused at pack", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const made = must(
      rig.session.derive(
        { asset: ASSET, op: "mirror", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    const derived = rig.session.store.readWorkingSet(made.workingSetId);
    if (derived.kind !== "found") throw new Error("no derived set");
    // A drawn slot beside the derived one, in one set.
    const [jobId] = runSlots(rig, "zeus-north", "sprite", [
      { state: "idle", direction: "north" },
    ]);
    must(rig.session.openWorkingSet("drawn", "zeus-north", content));
    must(rig.session.pick("drawn", jobId as string));
    finishSheet(rig, "north-edit", "drawn", cell, [
      {
        slot: "idle/north",
        frames: [0, 1, 2, 3].map((i) => paintFigure(content, cell, i)),
        durations: [167, 167, 167, 167],
      },
    ]);
    const drawn = rig.session.store.readWorkingSet("drawn");
    if (drawn.kind !== "found") throw new Error("no drawn set");
    rig.session.store.putWorkingSet({
      ...drawn.value,
      id: "mixed",
      required: [...drawn.value.required, "idle/west"],
      limits: { ...drawn.value.limits, ...derived.value.limits },
      derived: derived.value.derived as never,
    });

    const refused = rig.session.pack(
      packInput({ id: "mixed-pack", workingSetId: "mixed" }),
      content,
      rig.palette,
      rig.registryRoot,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("mixes derived slots");
  });

  test("a derivation made from a revision that is no longer published is refused at pack: derive again", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const made = must(
      rig.session.derive(
        { asset: ASSET, op: "mirror", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    // Another revision lands first.
    const bob = must(
      rig.session.derive(
        { asset: ASSET, op: "bob", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    release(rig, content, bob.workingSetId, "bob-pack");

    const refused = rig.session.pack(
      packInput({ id: "west-pack", workingSetId: made.workingSetId }),
      content,
      rig.palette,
      rig.registryRoot,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("no longer the published revision");
  });

  test("pack writes the subject's asymmetry and does not carry the prior revision's forward", () => {
    const rig = assetRig();
    publishEast(rig, rig.content);
    const east = rig.session.store.readAsset("east-pack");
    if (east.kind !== "found") throw new Error("no asset");
    const first = east.value.record.manifest;
    expect(first.kind === "sprite" && first.asymmetry?.feature).toBe(
      "bolt hand",
    );

    // The subject no longer declares it: the next revision says so too.
    const content = symmetric(rig.content);
    const bob = must(
      rig.session.derive(
        { asset: ASSET, op: "bob", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    const revision = release(rig, content, bob.workingSetId, "bob-pack");
    const next = published(rig, revision);
    expect(next.kind === "sprite" && next.asymmetry).toBeUndefined();
  });

  test("a stored working set that disagrees about a derived slot does not parse", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const made = must(
      rig.session.derive(
        { asset: ASSET, op: "mirror", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    const found = rig.session.store.readWorkingSet(made.workingSetId);
    if (found.kind !== "found") throw new Error("no set");
    const raw = JSON.parse(JSON.stringify(found.value));
    expect(parseWorkingSetRecord(raw).ok).toBe(true);

    // biome-ignore lint/suspicious/noExplicitAny: mutation helper edits arbitrary depths
    type Mutable = Record<string, any>;
    const cases: [string, (value: Mutable) => void, RegExp][] = [
      [
        "a step that outputs another slot",
        (v) => {
          v.derived["idle/west"].step.outputSlot = "idle/east";
        },
        /outputSlot/,
      ],
      [
        "a derived slot that is not required",
        (v) => {
          v.derived["idle/east"] = v.derived["idle/west"];
        },
        /not required/,
      ],
      [
        "derived frames outside the state's frame limits",
        (v) => {
          v.derived["idle/west"].frames.pop();
        },
        /frames/,
      ],
      [
        "a set with no slot and no variant",
        (v) => {
          v.required = [];
          v.limits = {};
          v.derived = {};
        },
        /required/,
      ],
    ];
    for (const [label, change, path] of cases) {
      const copy = JSON.parse(JSON.stringify(raw));
      change(copy);
      const parsed = parseWorkingSetRecord(copy);
      expect(parsed.ok, label).toBe(false);
      if (!parsed.ok) expect(`${parsed.path} ${parsed.message}`).toMatch(path);
    }
  });

  test("a palette swap becomes a realm variant with its own atlas in the registry; a later revision regenerates it from the new atlas", () => {
    const rig = realPaletteRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const swap = must(
      rig.session.derive(
        { asset: ASSET, op: "palette-swap", from: "olympus", to: "underworld" },
        content,
        rig.registryRoot,
      ),
    );
    expect(swap.slots).toEqual(["underworld"]);
    const first = release(rig, content, swap.workingSetId, "swap-pack");
    const swapped = published(rig, first);
    if (swapped.kind !== "sprite") throw new Error("not a sprite");
    expect(swapped.provenance.method).toBe("derived");
    expect(swapped.realmVariants.map((v) => v.paletteFamily)).toEqual([
      "underworld",
    ]);
    const variant = swapped.realmVariants[0];
    expect(variant?.map).toHaveLength(16);
    const stored = readRevision(
      rig.registryRoot,
      ASSET as never,
      first,
      rig.content.vocabulary as AssetVocabulary,
    );
    if (!stored.ok) throw new Error(stored.message);
    expect(stored.value.variantAtlases.size).toBe(1);
    expect(stored.value.variantAtlases.has(variant?.atlas.blob as Sha256)).toBe(
      true,
    );
    expect(variant?.atlas.blob).not.toBe(swapped.atlas.blob);
    // The variant atlas is, pixel for pixel, the source atlas under the recorded map.
    const sourceAtlas = stored.value.atlas;
    const sourceRead = readRevision(
      rig.registryRoot,
      ASSET as never,
      swapped.provenance.sourceAssets[0]?.revision as Sha256,
      rig.content.vocabulary as AssetVocabulary,
    );
    if (!sourceRead.ok) throw new Error(sourceRead.message);
    const sourcePixels = decodePng(sourceRead.value.atlas);
    const variantPixels = decodePng(
      stored.value.variantAtlases.get(
        variant?.atlas.blob as Sha256,
      ) as Uint8Array,
    );
    if (!sourcePixels.ok || !variantPixels.ok) throw new Error("decode");
    const recoloured = swapImage(
      sourcePixels.image,
      variant?.map ?? [],
      rampIndex(rig.content.palette),
    );
    if (!recoloured.ok) throw new Error(recoloured.message);
    expect(variantPixels.image.width).toBe(recoloured.image.width);
    for (let at = 0; at < recoloured.image.rgba.length; at += 4) {
      const want = recoloured.image.rgba.subarray(at, at + 4);
      const got = variantPixels.image.rgba.subarray(at, at + 4);
      expect([...got], `pixel ${at / 4}`).toEqual([...want]);
    }
    expect(sourceAtlas.length).toBeGreaterThan(0);

    // A later source revision: a bob moves pixels, and the variant follows the new atlas.
    const bob = must(
      rig.session.derive(
        { asset: ASSET, op: "bob", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    const second = release(rig, content, bob.workingSetId, "bob-pack");
    const bobbed = published(rig, second);
    if (bobbed.kind !== "sprite") throw new Error("not a sprite");
    const later = bobbed.realmVariants[0];
    expect(bobbed.realmVariants).toHaveLength(1);
    expect(later?.atlas.blob).not.toBe(variant?.atlas.blob);
    expect(later?.map).toEqual(variant?.map);
    // The carried variant keeps the swap step that made it, beside the bob.
    if (bobbed.provenance.method !== "derived") throw new Error("not derived");
    expect(
      bobbed.provenance.steps.map((s) => `${s.recipe}:${s.outputSlot}`),
    ).toEqual(["bob:idle/east", "palette-swap:idle/east"]);
    expect(
      bobbed.provenance.steps.find((s) => s.recipe === "palette-swap")?.params
        .targetFamily,
    ).toBe("underworld");
  });

  test("a swap draft's report measures the recoloured variant against the target realm's palette, so it is never an empty pass", () => {
    const rig = realPaletteRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const swap = must(
      rig.session.derive(
        { asset: ASSET, op: "palette-swap", from: "olympus", to: "underworld" },
        content,
        rig.registryRoot,
      ),
    );
    const packed = must(
      rig.session.pack(
        packInput({ id: "swap-pack", workingSetId: swap.workingSetId }),
        content,
        rig.palette,
        rig.registryRoot,
      ),
    );
    const record = packed.asset.record;
    if (record.state !== "draft") throw new Error("not a draft");
    const palette = (record.report?.checks ?? []).filter((c) =>
      c.check.endsWith(":palette"),
    );
    expect(palette.length).toBeGreaterThan(0);
    expect(palette.some((c) => c.check.startsWith("underworld:"))).toBe(true);
    expect(palette.every((c) => c.status === "pass")).toBe(true);
    expect(record.report?.status).toBe("pass");
  });

  test("a variant that fails the target realm's palette blocks plain approve", () => {
    const rig = realPaletteRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const swap = must(
      rig.session.derive(
        { asset: ASSET, op: "palette-swap", from: "olympus", to: "underworld" },
        content,
        rig.registryRoot,
      ),
    );
    // The variant is made to recolour into the source's own ramps: olympus colours, labelled underworld.
    const found = rig.session.store.readWorkingSet(swap.workingSetId);
    if (found.kind !== "found") throw new Error("no set");
    const request = found.value.variants?.underworld;
    if (request === undefined) throw new Error("no variant request");
    rig.session.store.putWorkingSet({
      ...found.value,
      variants: {
        underworld: {
          ...request,
          map: request.map.map((m) => ({ source: m.source, target: m.source })),
        },
      },
    });

    const packed = must(
      rig.session.pack(
        packInput({ id: "swap-pack", workingSetId: swap.workingSetId }),
        content,
        rig.palette,
        rig.registryRoot,
      ),
    );

    const record = packed.asset.record;
    if (record.state !== "draft") throw new Error("not a draft");
    expect(record.report?.status).toBe("fail");
    expect(
      (record.report?.checks ?? []).some(
        (c) => c.check.startsWith("underworld:") && c.status === "fail",
      ),
    ).toBe(true);
    expect(approveDraft(rig, content, "swap-pack").ok).toBe(false);
  });

  test("a forged extra entry in a realm variant's colour map is refused at publish", () => {
    const rig = realPaletteRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const swap = must(
      rig.session.derive(
        { asset: ASSET, op: "palette-swap", from: "olympus", to: "underworld" },
        content,
        rig.registryRoot,
      ),
    );
    must(
      rig.session.pack(
        packInput({ id: "swap-pack", workingSetId: swap.workingSetId }),
        content,
        rig.palette,
        rig.registryRoot,
      ),
    );
    const approved = must(approveDraft(rig, content, "swap-pack")).asset;
    const manifest = approved.record.manifest;
    if (manifest.kind !== "sprite") throw new Error("not a sprite");
    const variant = manifest.realmVariants[0];
    if (variant === undefined) throw new Error("no variant");
    const first = variant.map[0];
    if (first === undefined) throw new Error("map");
    // The extra entry maps a shade no pixel uses (a target ramp's own), so the recolour is unchanged.
    const extra = { source: first.target, target: first.target };
    const tampered: AssetManifest = {
      ...manifest,
      realmVariants: [
        {
          ...variant,
          map: [...variant.map, extra],
        },
      ],
    };
    const revision = sha256Hex(
      new TextEncoder().encode(canonicalManifestText(tampered)),
    );
    rig.session.store.putAsset({
      ...approved,
      record: { ...approved.record, manifest: tampered },
      manifestRevision: revision,
      licenceReview: { ...approved.licenceReview, manifestRevision: revision },
    });

    const refused = rig.session.publishAsset(
      "swap-pack",
      content,
      rig.palette,
      rig.registryRoot,
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("underworld realm variant");
    expect(refused.message).toContain("palette-swap step records");
  });

  test("a carried realm variant with no swap step recording it, or a map that is not its step's, is refused at pack", () => {
    const rig = realPaletteRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const swap = must(
      rig.session.derive(
        { asset: ASSET, op: "palette-swap", from: "olympus", to: "underworld" },
        content,
        rig.registryRoot,
      ),
    );
    const first = release(rig, content, swap.workingSetId, "swap-pack");
    const bob = must(
      rig.session.derive(
        { asset: ASSET, op: "bob", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    const read = readRevision(
      rig.registryRoot,
      ASSET as never,
      first,
      rig.content.vocabulary as AssetVocabulary,
    );
    if (!read.ok) throw new Error(read.message);
    const { manifest } = read.value;
    if (manifest.kind !== "sprite" || manifest.provenance.method !== "derived")
      throw new Error("not a derived sprite");
    const status = readStudioStatus(rig.root);
    const packWith = (prior: AssetManifest) =>
      packAsset(packInput({ id: "bob-pack", workingSetId: bob.workingSetId }), {
        set: status.workingSets.find((w) => w.id === bob.workingSetId) as never,
        edits: new Map(status.edits.map((e) => [e.id, e])),
        jobs: new Map(status.jobs.map((j) => [j.job.id, j])),
        requests: new Map(status.requests.map((r) => [r.id, r])),
        commands: status.commands,
        readBlob: (hash) => rig.session.store.readBlob(hash),
        content,
        palette: rig.palette,
        prior: { revision: first, manifest: prior, atlas: read.value.atlas },
      });

    expect(packWith(manifest).ok).toBe(true);
    const noStep = packWith({
      ...manifest,
      provenance: {
        ...manifest.provenance,
        steps: manifest.provenance.steps.filter(
          (step) => step.recipe !== "palette-swap",
        ),
      },
    });
    expect(noStep.ok).toBe(false);
    if (!noStep.ok) expect(noStep.message).toContain("no palette-swap step");
    const variant = manifest.realmVariants[0];
    if (variant === undefined) throw new Error("no variant");
    const [head, ...rest] = variant.map;
    const reordered = packWith({
      ...manifest,
      realmVariants: [{ ...variant, map: [...rest, head as never] }],
    });
    expect(reordered.ok).toBe(false);
    if (!reordered.ok)
      expect(reordered.message).toContain("not the map its palette-swap step");
  });

  test("a mirror canonized before an asymmetry declaration is refused at the next publish when it arrives by a palette swap", () => {
    const rig = realPaletteRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const mirror = must(
      rig.session.derive(
        { asset: ASSET, op: "mirror", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    release(rig, content, mirror.workingSetId, "west-pack");
    const swap = must(
      rig.session.derive(
        { asset: ASSET, op: "palette-swap", from: "olympus", to: "underworld" },
        content,
        rig.registryRoot,
      ),
    );
    must(
      rig.session.pack(
        packInput({ id: "swap-pack", workingSetId: swap.workingSetId }),
        content,
        rig.palette,
        rig.registryRoot,
      ),
    );
    must(approveDraft(rig, content, "swap-pack"));

    // The declaration arrives: the real content, with Zeus's bolt hand.
    const refused = rig.session.publishAsset(
      "swap-pack",
      { ...rig.content, palette: content.palette },
      rig.palette,
      rig.registryRoot,
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("derived step mirror -> idle/west");
    expect(refused.message).toContain("bolt hand");
  });

  test("a mirror canonized before an asymmetry declaration is refused at the next publish when it arrives by a carry", () => {
    const rig = assetRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const mirror = must(
      rig.session.derive(
        { asset: ASSET, op: "mirror", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    release(rig, content, mirror.workingSetId, "west-pack");
    const bob = must(
      rig.session.derive(
        { asset: ASSET, op: "bob", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    must(
      rig.session.pack(
        packInput({ id: "bob-pack", workingSetId: bob.workingSetId }),
        content,
        rig.palette,
        rig.registryRoot,
      ),
    );
    must(
      approveDraft(rig, content, "bob-pack", {
        exception: { reason: "the stale mirror is accepted for this test" },
      }),
    );

    const refused = rig.session.publishAsset(
      "bob-pack",
      rig.content,
      rig.palette,
      rig.registryRoot,
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("derived step mirror -> idle/west");
    expect(refused.message).toContain("bolt hand");
  });

  test("a tampered variant atlas is refused at publish, whether forged to match its hash or overwritten", () => {
    const rig = realPaletteRig();
    const content = symmetric(rig.content);
    publishEast(rig, content);
    const swap = must(
      rig.session.derive(
        { asset: ASSET, op: "palette-swap", from: "olympus", to: "underworld" },
        content,
        rig.registryRoot,
      ),
    );
    release(rig, content, swap.workingSetId, "swap-pack");
    // The next revision carries the variant, regenerated: that is what is forged.
    const bob = must(
      rig.session.derive(
        { asset: ASSET, op: "bob", from: "idle/east" },
        content,
        rig.registryRoot,
      ),
    );
    must(
      rig.session.pack(
        packInput({ id: "bob-pack", workingSetId: bob.workingSetId }),
        content,
        rig.palette,
        rig.registryRoot,
      ),
    );
    const approved = must(approveDraft(rig, content, "bob-pack")).asset;
    const manifest = approved.record.manifest;
    if (manifest.kind !== "sprite") throw new Error("not a sprite");
    const variant = manifest.realmVariants[0];
    if (variant === undefined) throw new Error("no variant");

    // A forged atlas that is a well-formed PNG of the right size, but not the recolour.
    const forged = encodeRgbaPng(
      new Uint8Array(variant.atlas.width * variant.atlas.height * 4).fill(7),
      variant.atlas.width,
      variant.atlas.height,
    );
    const forgedHash = rig.session.store.putBlob(forged);
    const tampered: AssetManifest = {
      ...manifest,
      realmVariants: [
        { ...variant, atlas: { ...variant.atlas, blob: forgedHash } },
      ],
    };
    const revision = sha256Hex(
      new TextEncoder().encode(canonicalManifestText(tampered)),
    );
    rig.session.store.putAsset({
      ...approved,
      record: { ...approved.record, manifest: tampered },
      manifestRevision: revision,
      licenceReview: { ...approved.licenceReview, manifestRevision: revision },
    });
    const refused = rig.session.publishAsset(
      "bob-pack",
      content,
      rig.palette,
      rig.registryRoot,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("underworld realm variant");
    expect(refused.message).toContain("recoloured");

    // A blob overwritten on disk no longer matches its hash: also refused.
    rig.session.store.putAsset(approved);
    writeFileSync(
      join(studioPaths(rig.root).blobs, `${variant.atlas.blob}.png`),
      forged,
    );
    const overwritten = rig.session.publishAsset(
      "bob-pack",
      content,
      rig.palette,
      rig.registryRoot,
    );
    expect(overwritten.ok).toBe(false);
    if (overwritten.ok) return;
    expect(overwritten.message).toContain("does not match its hash");
  });
});
