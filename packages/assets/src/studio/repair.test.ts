// The repair route: a masked edit whose base is one frame of a published
// revision. The frame is resolved from the registry in Node, checked against
// its recorded hash, and recorded in provenance with the mask, strength and
// cue. Every publish goes into an isolated registry root, never the canon.

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AssetVocabulary,
  type EditBase,
  type GenerationEdit,
  parseAssetManifest,
  type Sha256,
} from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { readRevision } from "../registry";
import {
  type AssetRig,
  assetRig,
  finishSheet,
  PROVISIONAL_TEST_PARAMS,
  paintFigure,
  pngOf,
  publishIdleEast,
  removeTempRoots,
  SPRITE_CELL,
  succeedWithImage,
  upscale,
} from "./_test-fixtures";
import { editSettings, resolveEdit } from "./edit";
import { cutFrame, frameHashOf, registryFrameReader } from "./frame-ref";
import type { PackInput } from "./packing";
import { decodePng } from "./png/decode";
import { newRequestRecord } from "./request";

afterEach(removeTempRoots);

const SIZE = { w: 512, h: 640 };
type Published = Extract<EditBase, { kind: "published" }>;

/** A mask of the request's size: white in one rectangle, black elsewhere. */
function mask(): RgbaImage {
  const rgba = new Uint8Array(SIZE.w * SIZE.h * 4);
  for (let at = 0; at < rgba.length; at += 4) rgba[at + 3] = 255;
  for (let y = 200; y < 260; y += 1)
    for (let x = 220; x < 300; x += 1)
      rgba.fill(255, (y * SIZE.w + x) * 4, (y * SIZE.w + x) * 4 + 3);
  return { rgba, width: SIZE.w, height: SIZE.h };
}

function published(rig: AssetRig) {
  const revision = publishIdleEast(rig);
  const vocabulary = rig.content.vocabulary as AssetVocabulary;
  return {
    revision,
    vocabulary,
    read: registryFrameReader(rig.registryRoot, vocabulary),
  };
}

function baseOf(rig: AssetRig, frameIndex = 1) {
  const { revision, vocabulary, read } = published(rig);
  const ref = (over: Partial<Published> = {}): Published => ({
    kind: "published",
    assetId: "zeus-sprite" as never,
    revision,
    slotKey: "idle/east",
    frameIndex,
    frameHash: "0".repeat(64) as Sha256,
    ...over,
  });
  // The frame's own bytes, so its hash can be named.
  const first = read(ref());
  if (
    first.ok ||
    first.reason !== "frame-hash-mismatch" ||
    first.actual === undefined
  )
    throw new Error("the reader did not name the frame's hash");
  return { revision, vocabulary, read, ref, frameHash: first.actual };
}

function readRevisionOf(rig: AssetRig, revision: Sha256) {
  const read = readRevision(
    rig.registryRoot,
    "zeus-sprite" as never,
    revision,
    rig.content.vocabulary as AssetVocabulary,
  );
  if (!read.ok) throw new Error(read.message);
  return read.value;
}

const sourcesOf = (
  rig: AssetRig,
  read?: ReturnType<typeof registryFrameReader>,
) => ({
  readJob: rig.session.store.readJob,
  readBlob: rig.session.store.readBlob,
  ...(read === undefined ? {} : { readFrame: read }),
});

function editOf(rig: AssetRig, base: Published): GenerationEdit {
  return {
    base,
    mask: rig.session.store.putBlob(pngOf(mask())),
    strength: 0.6,
    cue: "right hand lifted, bolt held high",
  };
}

const refusal = (result: ReturnType<typeof resolveEdit>) =>
  result.ok ? undefined : result.error;

describe("resolving a published frame as an edit base", () => {
  test("the frame is the registry's own cell, scaled by the generation factor with nearest pixels", () => {
    const rig = assetRig();
    const b = baseOf(rig);
    const edit = editOf(rig, b.ref({ frameHash: b.frameHash }));

    const result = resolveEdit(edit, SIZE, sourcesOf(rig, b.read));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decoded = decodePng(result.value.base);
    if (!decoded.ok) throw new Error(decoded.message);
    expect(decoded.image.width).toBe(SIZE.w);
    expect(decoded.image.height).toBe(SIZE.h);
    // The frame as published: the same figure the fixture drew for frame 1.
    const drawn = paintFigure(rig.content, SPRITE_CELL, 1);
    const expected = upscale(drawn, 8);
    for (let at = 0; at < expected.rgba.length; at += 4) {
      const e = expected.rgba.subarray(at, at + 4);
      const g = decoded.image.rgba.subarray(at, at + 4);
      expect(g[3]).toBe(e[3] as number);
      if (e[3] !== 0) expect([...g]).toEqual([...e]);
    }
  });

  test("a wrong frame hash is refused, naming the reason and the hash the frame really has", () => {
    const rig = assetRig();
    const b = baseOf(rig);
    const wrong = "1".repeat(64) as Sha256;

    const error = refusal(
      resolveEdit(
        editOf(rig, b.ref({ frameHash: wrong })),
        SIZE,
        sourcesOf(rig, b.read),
      ),
    );

    expect(error).toMatchObject({ kind: "invalid-edit", field: "base" });
    if (error?.kind !== "invalid-edit") return;
    expect(error.message).toContain("frame-hash-mismatch");
    expect(error.message).toContain(b.frameHash);
  });

  test("a missing revision, slot or frame is refused with its own reason", () => {
    const rig = assetRig();
    const b = baseOf(rig);
    const cases: [Partial<Published>, string][] = [
      [{ revision: "2".repeat(64) as Sha256 }, "missing-revision"],
      [{ assetId: "no-such-asset" as never }, "missing-revision"],
      [{ slotKey: "walk/east" }, "missing-slot"],
      [{ frameIndex: 9 }, "missing-frame"],
    ];
    for (const [over, reason] of cases) {
      const error = refusal(
        resolveEdit(
          editOf(rig, b.ref({ frameHash: b.frameHash, ...over })),
          SIZE,
          sourcesOf(rig, b.read),
        ),
      );
      expect(error?.kind, reason).toBe("invalid-edit");
      if (error?.kind === "invalid-edit")
        expect(error.message, reason).toContain(reason);
    }
  });

  test("a tampered atlas blob is refused as unreadable and names the hash mismatch, not a missing revision", () => {
    const rig = assetRig();
    const b = baseOf(rig);
    const atlas = readRevisionOf(rig, b.revision).manifest.atlas.blob;
    writeFileSync(
      join(rig.registryRoot, "blobs", `${atlas}.png`),
      new Uint8Array([1, 2, 3]),
    );

    const read = b.read(b.ref({ frameHash: b.frameHash }));

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe("unreadable-revision");
    expect(read.message).toContain("bytes do not hash to");
    expect(read.message).toContain(atlas);
  });

  test("with no registry reader wired a published base is refused, never guessed", () => {
    const rig = assetRig();
    const b = baseOf(rig);

    const error = refusal(
      resolveEdit(
        editOf(rig, b.ref({ frameHash: b.frameHash })),
        SIZE,
        sourcesOf(rig),
      ),
    );

    expect(error).toMatchObject({ kind: "invalid-edit", field: "base" });
  });

  test("a request size that is not a whole multiple of the frame is refused", () => {
    const rig = assetRig();
    const b = baseOf(rig);

    const error = refusal(
      resolveEdit(
        editOf(rig, b.ref({ frameHash: b.frameHash })),
        { w: 768, h: 768 },
        sourcesOf(rig, b.read),
      ),
    );

    expect(error).toMatchObject({ kind: "invalid-edit", field: "base" });
  });

  test("a frame's hash is that of its cell PNG, and the colour hidden under alpha 0 does not change it", () => {
    const rig = assetRig();
    const b = baseOf(rig);
    const image = paintFigure(rig.content, SPRITE_CELL, 1);
    const noisy = { ...image, rgba: Uint8Array.from(image.rgba) };
    for (let at = 0; at < noisy.rgba.length; at += 4)
      if (noisy.rgba[at + 3] === 0) noisy.rgba.set([9, 8, 7], at);

    expect(frameHashOf(noisy)).toBe(frameHashOf(image));
    expect(frameHashOf(image)).toBe(b.frameHash);
  });

  test("cutFrame names a missing slot or frame on a manifest it is given", () => {
    const rig = assetRig();
    const b = baseOf(rig);
    const read = readRevisionOf(rig, b.revision);

    expect(cutFrame(read.manifest, read.atlas, "idle/east", 0).ok).toBe(true);
    expect(cutFrame(read.manifest, read.atlas, "act/east", 0)).toMatchObject({
      ok: false,
      reason: "missing-slot",
    });
    expect(cutFrame(read.manifest, read.atlas, "idle/east", 4)).toMatchObject({
      ok: false,
      reason: "missing-frame",
    });
  });
});

// --- Provenance and pack ------------------------------------------------------------------------

const packInput = (over: Partial<PackInput> = {}): PackInput => ({
  id: "repair-pack",
  workingSetId: "repair",
  assetId: "zeus-sprite",
  styleTag: "draft",
  footprint: { w: 1, h: 1 },
  originalWork: { licence: "MIT", attribution: "the owner" },
  ...over,
});

/** A repair candidate for idle/east: the edit job succeeded, was picked and finished by hand. */
function repaired(rig: AssetRig, over: Partial<Published> = {}) {
  const b = baseOf(rig);
  const edit = editOf(rig, b.ref({ frameHash: b.frameHash, ...over }));
  const built = newRequestRecord(
    rig.content,
    {
      id: "zeus-repair",
      subject: "zeus",
      kind: "sprite",
      slots: [{ state: "idle", direction: "east" }],
      batch: 1,
      seed: 20261011,
      edit,
    },
    () => 0,
  );
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  const submitted = rig.session.submitRequest(built.value.record);
  if (!submitted.ok) throw new Error(submitted.message);
  const [job] = submitted.jobIds as [string];
  succeedWithImage(
    rig.session,
    job,
    pngOf(upscale(paintFigure(rig.content, SPRITE_CELL, 5), 8)),
    SIZE,
    {
      ...rig.engine,
      settings: { ...rig.engine.settings, ...editSettings(edit) },
    },
  );
  if (!rig.session.conform(job, rig.content, PROVISIONAL_TEST_PARAMS).ok)
    throw new Error("conform");
  if (!rig.session.openWorkingSet("repair", "zeus-repair", rig.content).ok)
    throw new Error("open repair");
  if (!rig.session.pick("repair", job).ok) throw new Error("pick repair");
  finishSheet(rig, "repair-edit", "repair", SPRITE_CELL, [
    {
      slot: "idle/east",
      frames: [0, 1, 2, 3].map((i) => paintFigure(rig.content, SPRITE_CELL, i)),
      durations: [167, 167, 167, 167],
    },
  ]);
  return { ...b, edit, job };
}

function packRepair(rig: AssetRig, over: Partial<PackInput> = {}) {
  return rig.session.pack(
    packInput(over),
    rig.content,
    rig.palettes,
    rig.registryRoot,
  );
}

describe("a repair candidate through pack", () => {
  test("it packs on its own as a generated asset recording the base frame, mask, strength and cue", () => {
    const rig = assetRig();
    const r = repaired(rig);

    const packed = packRepair(rig, {
      originalWork: { licence: "MIT", attribution: "the repairer" },
    });

    expect(packed.ok).toBe(true);
    if (!packed.ok) return;
    const found = rig.session.store.readAsset("repair-pack");
    if (found.kind !== "found") throw new Error("no repair-pack");
    const { manifest } = found.value.record;
    expect(manifest.provenance.method).toBe("generated");
    if (manifest.provenance.method !== "generated") return;
    const [generation] = manifest.provenance.generations;
    expect(generation?.jobId).toBe(r.job);
    expect(generation?.request.edit).toEqual(r.edit);
    expect(generation?.request.edit?.base).toEqual({
      kind: "published",
      assetId: "zeus-sprite" as never,
      revision: r.revision,
      slotKey: "idle/east",
      frameIndex: 1,
      frameHash: r.frameHash,
    });
    expect(generation?.settings).toMatchObject({
      edit_strength: 0.6,
      edit_base_kind: "published",
      edit_base_sha256: r.frameHash,
      edit_mask_sha256: r.edit.mask,
    });
    expect(manifest.provenance.sourceAssets).toEqual([
      { assetId: "zeus-sprite" as never, revision: r.revision },
    ]);
    // The base revision's licence records travel with work made from its pixels. The base was
    // published with another hand-work attribution than this repair, so its record is distinct
    // from every record the repair itself adds.
    const baseLicences = readRevisionOf(rig, r.revision).manifest.provenance
      .licences;
    const baseHandWork = baseLicences.find((l) => l.role === "original-work");
    expect(baseHandWork).toMatchObject({ attribution: "the owner" });
    for (const record of baseLicences)
      expect(manifest.provenance.licences).toContainEqual(record);
    expect(manifest.provenance.licences).toContainEqual(
      expect.objectContaining({
        role: "original-work",
        attribution: "the repairer",
      }),
    );
  });

  test("the repair draft approves and publishes like any other revision", () => {
    const rig = assetRig();
    repaired(rig);
    const packed = packRepair(rig);
    if (!packed.ok) throw new Error(packed.message);
    const found = rig.session.store.readAsset("repair-pack");
    if (found.kind !== "found") throw new Error("no repair-pack");
    const assessments = [
      ...new Map(
        found.value.record.manifest.provenance.licences
          .filter((l) => !["MIT", "Apache-2.0", "CC0-1.0"].includes(l.licence))
          .map((record) => [JSON.stringify(record), record]),
      ).values(),
    ].map((record) => ({
      record,
      disposition: "mit-compatible" as const,
      reason: "the owner read these terms",
    }));

    const approved = rig.session.approveAsset(
      "repair-pack",
      { assessments },
      rig.content,
      rig.palettes,
    );
    expect(approved.ok).toBe(true);
    const out = rig.session.publishAsset(
      "repair-pack",
      rig.content,
      rig.palettes,
      rig.registryRoot,
    );
    expect(out.ok).toBe(true);
  });

  test("a base that is not the revision now published is refused at pack", () => {
    const rig = assetRig();
    repaired(rig, { revision: "3".repeat(64) as Sha256 });

    const packed = packRepair(rig);

    expect(packed.ok).toBe(false);
    if (packed.ok) return;
    expect(packed.message).toContain("no longer the published revision");
  });

  test("a base frame whose hash is not the published frame's is refused at pack", () => {
    const rig = assetRig();
    const r = repaired(rig);
    const found = rig.session.store.readJob(r.job);
    if (found.kind !== "found") throw new Error("no job");
    const { edit } = found.value.job.request;
    if (edit === undefined || edit.base.kind !== "published")
      throw new Error("not a published edit");
    const wrong = "4".repeat(64) as Sha256;
    expect(r.frameHash).not.toBe(wrong);
    // A job record that names a hash the registry's frame does not have.
    rig.session.store.putJob({
      ...found.value,
      job: {
        ...found.value.job,
        request: {
          ...found.value.job.request,
          edit: { ...edit, base: { ...edit.base, frameHash: wrong } },
        },
      },
    } as never);

    const packed = packRepair(rig);

    expect(packed.ok).toBe(false);
    if (packed.ok) return;
    expect(packed.message).toContain("frame-hash-mismatch");
  });

  test("a manifest that edits a published frame must name its asset revision among the source assets", () => {
    const rig = assetRig();
    repaired(rig);
    const packed = packRepair(rig);
    if (!packed.ok) throw new Error(packed.message);
    const found = rig.session.store.readAsset("repair-pack");
    if (found.kind !== "found") throw new Error("no repair-pack");
    const { manifest } = found.value.record;

    expect(parseAssetManifest(manifest, rig.content.vocabulary).ok).toBe(true);
    const without = parseAssetManifest(
      { ...manifest, provenance: { ...manifest.provenance, sourceAssets: [] } },
      rig.content.vocabulary,
    );
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.path).toContain("request.edit.base");
  });

  test("a repair candidate mixed with a derived slot is refused at pack", () => {
    const rig = assetRig();
    repaired(rig);
    // A subject whose west is its east flipped, so the mirror is allowed.
    const content = {
      ...rig.content,
      visuals: rig.content.visuals.map((v) => {
        const { asymmetry: _declared, ...rest } = v;
        return rest;
      }),
    };
    const made = rig.session.derive(
      { asset: "zeus-sprite", op: "mirror", from: "idle/east" },
      content,
      rig.registryRoot,
    );
    if (!made.ok) throw new Error(made.message);
    const derived = rig.session.store.readWorkingSet(made.workingSetId);
    const drawn = rig.session.store.readWorkingSet("repair");
    if (derived.kind !== "found" || drawn.kind !== "found")
      throw new Error("no sets");
    rig.session.store.putWorkingSet({
      ...drawn.value,
      id: "mixed",
      required: [...drawn.value.required, "idle/west"],
      limits: { ...drawn.value.limits, ...derived.value.limits },
      derived: derived.value.derived as never,
    });

    const refused = packRepair(rig, {
      id: "mixed-pack",
      workingSetId: "mixed",
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("mixes derived slots");
  });
});
