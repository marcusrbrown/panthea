// Rendered entries through the studio session: render with the fake engine, read each job back as a
// rendered candidate, pick, pack, approve and publish a `god-tall` asset on an explicitly built
// registry; and every refusal of pack and of the publish-time render audit, each beside a control
// that passes.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AssetManifest,
  RenderedProvenance,
  Sha256,
} from "@panthea/contracts";
import {
  approvedPalettes,
  closeRigs,
  content,
  copyRenderRoot,
  corruptKitFile,
  draftPalettes,
  jobsById,
  openRig,
  PACK_INPUT,
  packSet,
  pickAll,
  RENDER_ROOT,
  type Rig,
  registryOf,
  renderCandidates,
  renderTile,
  TILE_PACK_INPUT,
} from "../../test/render/rig";
import { sheetOf } from "../../test/studio/fixtures";
import { manualClock } from "../../test/studio/preview";
import { sha256Hex } from "../hash";
import { paletteDigest } from "../palette";
import { encodeRgbaPng } from "../placeholder";
import { readRevision } from "../registry";
import { decodePng } from "../studio/png/decode";
import { createPreviewSource } from "../studio/preview-source";
import { auditRendered } from "./audit";
import { groundCrop } from "./ground";
import { loadRenderInputs } from "./load";
import { cellPixelHash, POST_STEP_VERSION } from "./post";
import { slotRecipeHash } from "./recipe";

afterEach(closeRigs);

const T = 280_000;
const west = (state: string) => ({ state, direction: "west" });

type Packed = Extract<ReturnType<Rig["session"]["pack"]>, { ok: true }>;

function packOk(rig: Rig, setId: string): Packed {
  const result = packSet(rig, setId);
  if (!result.ok) throw new Error(result.message);
  return result;
}

const manifestOf = (asset: Packed["asset"]): AssetManifest =>
  asset.record.manifest;

/** One idle/west slot rendered, picked, packed. */
async function oneSlot(over: Parameters<typeof openRig>[0] = {}) {
  const rig = await openRig({ launches: [{}], ...over });
  const ids = await renderCandidates(
    rig,
    "zeus-retro",
    [west("idle")],
    "zeus-set",
  );
  pickAll(rig, "zeus-set", ids);
  return { rig, ids };
}

/** What publish is given for the audit: the render root, and the Blender the fake engine pinned (the real one's hash is the code's). */
const cfg = (rig: Rig, renderRoot = RENDER_ROOT) => ({
  renderRoot,
  current: { blender: rig.blender.pin as never },
});

function approveAndPublish(
  rig: Rig,
  palettes = approvedPalettes(),
  renderRoot: string | undefined = RENDER_ROOT,
) {
  const approved = rig.session.approveAsset(
    PACK_INPUT.id,
    {},
    content,
    palettes,
  );
  if (!approved.ok) return approved;
  return rig.session.publishAsset(
    PACK_INPUT.id,
    content,
    palettes,
    registryOf(rig),
    cfg(rig, renderRoot),
  );
}

describe("render, pick, pack, approve and publish", () => {
  test(
    "a god-tall asset goes through the session on an explicitly built registry",
    async () => {
      const { rig, ids } = await oneSlot();
      const status = rig.session.store.readWorkingSet("zeus-set");
      if (status.kind !== "found") throw new Error("no set");
      expect(status.value.status).toBe("complete");
      expect(Object.keys(status.value.rendered ?? {})).toEqual(["idle/west"]);

      const packed = packOk(rig, "zeus-set");
      const manifest = manifestOf(packed.asset);
      expect(manifest).toMatchObject({
        kind: "sprite",
        cell: { w: 112, h: 96 },
        pivot: { x: 56, y: 78 },
        paletteId: "greek-retro",
      });
      if (manifest.kind !== "sprite") throw new Error("not a sprite");
      expect(manifest.animations).toHaveLength(1);
      const idle = manifest.animations[0];
      expect(idle?.frames).toHaveLength(10);
      expect(idle?.loopStart).toBe(0);
      // Manifest timing: the profile's own, idle 10 frames of 250 ms.
      expect(idle?.frames.every((f) => f.durationMs === 250)).toBe(true);

      const provenance = manifest.provenance as RenderedProvenance;
      expect(provenance.method).toBe("rendered");
      expect(provenance.slots).toHaveLength(1);
      const job = jobsById(rig)[ids[0] as string];
      expect(provenance.slots[0]?.recipeHash).toBe(
        job?.engine?.settings.slotRecipeHash as never,
      );
      expect(provenance.revisionRecipe.hash).toBe(
        job?.engine?.settings.revisionRecipeHash as never,
      );
      expect(provenance.revisionRecipe).toMatchObject({
        profile: { id: "zeus" },
        palette: { id: "greek-retro" },
        pivot: { x: 56, y: 78 },
        postStep: POST_STEP_VERSION,
        blender: { version: "5.2.2", build: "d13f752e3b9c" },
      });
      expect(provenance.slots[0]?.raw.colour).toHaveLength(10);
      // The kit licences are recorded; no generation is.
      expect(
        provenance.licences.map((l) => `${l.subject}:${l.licence}`).sort(),
      ).toEqual(
        [
          "universal-animation-library:CC0-1.0",
          "universal-base-characters:CC0-1.0",
          "zeus-retro:MIT",
        ].filter((_, i) => i < 2 || provenance.handEdits.length > 0),
      );
      expect(provenance.relatedJobs).toEqual([
        {
          jobId: ids[0] as string,
          status: "succeeded",
          outputs: (job?.job.status === "succeeded" ? job.job.outputs : []).map(
            (o) => o.hash,
          ),
        },
      ]);
      expect(provenance.handEdits).toEqual([]);

      // No cell fails the palette check: the contact shadow is a shade of the olympus family.
      const checks = (
        packed.asset.record as unknown as {
          report: {
            status: string;
            checks: { check: string; status: string; message?: string }[];
          };
        }
      ).report;
      expect(checks.checks.filter((c) => c.status === "fail")).toEqual([]);
      expect(
        checks.checks.filter((c) => c.check.endsWith(":palette")),
      ).toHaveLength(10);
      expect(checks.status).toBe("pass");
      // Approval refuses a draft palette (positive control: the approved one passes, with no
      // exception, in approveAndPublish below).
      const draft = rig.session.approveAsset(
        PACK_INPUT.id,
        {},
        content,
        draftPalettes(),
      );
      expect(draft.ok).toBe(false);
      const published = approveAndPublish(rig);
      if (!published.ok) throw new Error(published.message);
      expect(published.asset.record.state).toBe("canon");
      const read = readRevision(
        registryOf(rig),
        published.asset.assetId,
        published.asset.manifestRevision,
        content.vocabulary,
      );
      expect(read.ok).toBe(true);
    },
    T,
  );
});

describe("a rendered draft in the studio preview source", () => {
  test(
    "resolves as a 112x96 sprite with its (56, 78) pivot and its 10 frames at manifest timing, and a rewrite of the record reloads it",
    async () => {
      const { rig } = await oneSlot();
      packOk(rig, "zeus-set");
      const clock = manualClock();
      const events: unknown[] = [];
      const source = createPreviewSource({
        registryRoot: registryOf(rig),
        studioRoot: rig.root,
        vocabulary: { ok: true, vocabulary: content.vocabulary },
        watch: clock.watch,
        schedule: clock.schedule,
        emit: (change) => events.push(change),
      });
      const resolved = source.resolve({
        source: "draft",
        id: PACK_INPUT.id,
        state: "idle",
        direction: "west",
      });
      if (resolved.kind !== "frames")
        throw new Error(`expected frames, got ${resolved.kind}`);
      expect(resolved.asset.frames).toHaveLength(10);
      expect(resolved.asset.frames.every((f) => f.durationMs === 250)).toBe(
        true,
      );
      expect(resolved.asset.loopStart).toBe(0);
      expect(resolved.asset).toMatchObject({
        cell: { w: 112, h: 96 },
        pivot: { x: 56, y: 78 },
      });
      source.close();
    },
    T,
  );
});

describe("pack refuses", () => {
  test(
    "a working set mixing revision recipe hashes (a mixed-recipe fixture), and a single recipe packs",
    async () => {
      const rig = await openRig({ launches: [{}] });
      // Request A renders both slots and opens the set; request B renders walk again under another
      // pivot, which is part of the recipe, and the set's sheet moves to it.
      const a = await renderCandidates(
        rig,
        "zeus-a",
        [west("idle"), west("walk")],
        "zeus-set",
      );
      expect(rig.session.pick("zeus-set", a[0] as string).ok).toBe(true);
      const b = await renderCandidates(
        rig,
        "zeus-b",
        [west("walk")],
        undefined,
        {
          pivot: { x: 56, y: 77 },
        },
      );
      expect(rig.session.replaceSheet("zeus-set", "zeus-b").ok).toBe(true);
      expect(rig.session.pick("zeus-set", b[0] as string).ok).toBe(true);
      const result = packSet(rig, "zeus-set");
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.message).toMatch(/2 different revision recipe hashes/);
    },
    T,
  );

  test(
    "a generated image-model pick inside a rendered revision",
    async () => {
      const { rig } = await oneSlot();
      const set = rig.session.store.readWorkingSet("zeus-set");
      if (set.kind !== "found") throw new Error("no set");
      const base = set.value;
      const keyframe = {
        candidateId: "an-image-job-0000",
        source: { requestId: "an-image", slotKey: "walk/west", ordinal: 0 },
        inputHash: "1".repeat(64) as Sha256,
        decodedSha256: "2".repeat(64),
        imageHash: "3".repeat(64) as Sha256,
        params: {
          background: { type: "alpha" as const },
          alphaCutoff: 128,
          grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
          scale: null,
        },
        palette: {
          id: "greek-master",
          family: "olympus",
          digest: null,
          colours: ["#000000"],
        },
        report: {
          schemaVersion: 1 as const,
          status: "pass" as const,
          checks: [],
        },
      };
      const authored = {
        editId: "an-edit",
        basis: {
          kind: "keyframe" as const,
          candidateId: keyframe.candidateId,
          imageHash: keyframe.imageHash,
        },
        sheetHash: "4".repeat(64) as Sha256,
        frames: Array.from({ length: 16 }, () => ({
          hash: "5".repeat(64) as Sha256,
          durationMs: 50,
        })),
        pivot: null,
        handEdits: [],
      };
      rig.session.store.putWorkingSet({
        ...base,
        required: ["idle/west", "walk/west"],
        limits: { ...base.limits, "walk/west": { min: 16, max: 16 } },
        picks: { "walk/west": keyframe },
        frames: { "walk/west": authored },
        status: "complete",
      });
      const result = packSet(rig, "zeus-set");
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.message).toMatch(/generated image-model pick/);

      // Control: the same working set without the generated pick packs.
      rig.session.store.putWorkingSet(base);
      expect(packSet(rig, "zeus-set").ok).toBe(true);
    },
    T,
  );

  test(
    "a slot whose recorded cells are not its job manifest's cells",
    async () => {
      const { rig } = await oneSlot();
      const set = rig.session.store.readWorkingSet("zeus-set");
      if (set.kind !== "found") throw new Error("no set");
      const entry = set.value.rendered?.["idle/west"];
      if (entry === undefined) throw new Error("no entry");
      const swapped = [
        { ...entry.frames[0], hash: entry.frames[1]?.hash as Sha256 },
        ...entry.frames.slice(1),
      ];
      rig.session.store.putWorkingSet({
        ...set.value,
        rendered: { "idle/west": { ...entry, frames: swapped as never } },
      });
      const result = packSet(rig, "zeus-set");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/not the cells of job/);
    },
    T,
  );
});

/** Packs, approves and returns what the publish-time audit stands on. */
async function approved() {
  const { rig } = await oneSlot();
  const packed = packOk(rig, "zeus-set");
  const manifest = manifestOf(packed.asset);
  const approvedAsset = rig.session.approveAsset(
    PACK_INPUT.id,
    {},
    content,
    approvedPalettes(),
  );
  if (!approvedAsset.ok) throw new Error(approvedAsset.message);
  const atlas = rig.session.store.readBlob(manifest.atlas.blob) as Uint8Array;
  return { rig, manifest: approvedAsset.asset.record.manifest, atlas };
}

const auditOf = (
  rig: Rig,
  manifest: AssetManifest,
  atlas: Uint8Array,
  over: Partial<Parameters<typeof auditRendered>[0]> = {},
) =>
  auditRendered({
    manifest,
    atlas,
    palettes: approvedPalettes(),
    renderRoot: RENDER_ROOT,
    current: { blender: rig.blender.pin as never },
    readBlob: (hash) => rig.session.store.readBlob(hash),
    jobs: rig.session.store.status().jobs,
    handEdited: new Set(),
    ...over,
  });

const rawHash = (
  manifest: AssetManifest,
  role: "colour" | "id" | "depth",
  index = 0,
) =>
  (manifest.provenance as RenderedProvenance).slots[0]?.raw[role][
    index
  ] as Sha256;

describe("the contact shadow's palette", () => {
  test(
    "a shadow from a town ramp (the old olive) fails the palette check on every frame; the profile's olympus ramp passes",
    async () => {
      const failing = async (mutate?: (root: string) => void) => {
        const rig = await openRig({
          launches: [{}],
          ...(mutate === undefined ? {} : { mutateRenderRoot: mutate }),
        });
        const ids = await renderCandidates(
          rig,
          "zeus-retro",
          [west("idle")],
          "zeus-set",
        );
        pickAll(rig, "zeus-set", ids);
        const packed = packOk(rig, "zeus-set");
        return (
          packed.asset.record as unknown as {
            report: { checks: { check: string; status: string }[] };
          }
        ).report.checks.filter((c) => c.status === "fail");
      };
      expect(await failing()).toEqual([]);
      const olive = await failing((root) => {
        const path = join(root, "profiles", "zeus.json");
        const profile = JSON.parse(readFileSync(path, "utf8"));
        profile.shadow = { ramp: "olive" };
        writeFileSync(path, JSON.stringify(profile, null, 2));
      });
      expect(olive).toHaveLength(10);
      expect(olive.every((c) => c.check.endsWith(":palette"))).toBe(true);
    },
    T,
  );
});

describe("the publish-time render audit", () => {
  test(
    "passes on the packed asset (control), and publishing with it succeeds",
    async () => {
      const { rig, manifest, atlas } = await approved();
      expect(auditOf(rig, manifest, atlas)).toBeUndefined();
      const published = rig.session.publishAsset(
        PACK_INPUT.id,
        content,
        approvedPalettes(),
        registryOf(rig),
        cfg(rig),
      );
      expect(published.ok).toBe(true);
    },
    T,
  );

  test(
    "refuses a raw blob that is missing, and one whose bytes are not its hash",
    async () => {
      const { rig, manifest, atlas } = await approved();
      const hash = rawHash(manifest, "depth", 3);
      const path = join(rig.root, "blobs", `${hash}.png`);
      const original = readFileSync(path);
      rmSync(path);
      expect(auditOf(rig, manifest, atlas)).toMatch(
        /raw depth frame 3 .* is missing from the store/,
      );
      const publish = rig.session.publishAsset(
        PACK_INPUT.id,
        content,
        approvedPalettes(),
        registryOf(rig),
        cfg(rig),
      );
      expect(publish.ok).toBe(false);
      if (!publish.ok)
        expect(publish.message).toMatch(
          /render audit: slot idle\/west: the raw depth frame 3/,
        );

      writeFileSync(
        path,
        readFileSync(
          join(rig.root, "blobs", `${rawHash(manifest, "depth", 4)}.png`),
        ),
      );
      expect(auditOf(rig, manifest, atlas)).toMatch(
        /raw depth frame 3 does not match its hash/,
      );
      writeFileSync(path, original);
      expect(auditOf(rig, manifest, atlas)).toBeUndefined();
    },
    T,
  );

  test(
    "refuses a cell in the atlas that is not the post step recomputed from the raw frames",
    async () => {
      const { rig, manifest, atlas } = await approved();
      if (manifest.kind !== "sprite") throw new Error("not a sprite");
      const decoded = decodePng(atlas);
      if (!decoded.ok) throw new Error("atlas");
      const rgba = new Uint8Array(decoded.image.rgba);
      // One opaque pixel of the sixth cell takes another colour: the atlas is consistent, the cell is not the recompute.
      const frame = manifest.animations[0]?.frames[5];
      if (frame === undefined) throw new Error("no frame");
      let changed = false;
      for (let y = 0; y < 96 && !changed; y += 1)
        for (let x = 0; x < 112 && !changed; x += 1) {
          const at = (y * decoded.image.width + frame.rect.x + x) * 4;
          if (rgba[at + 3] === 255) {
            rgba[at] = 255 - (rgba[at] as number);
            changed = true;
          }
        }
      const tampered = encodeRgbaPng(
        rgba,
        decoded.image.width,
        decoded.image.height,
      );
      const tamperedManifest = {
        ...manifest,
        atlas: { ...manifest.atlas, blob: sha256Hex(tampered) },
      } as AssetManifest;
      expect(auditOf(rig, tamperedManifest, tampered)).toMatch(
        /frame 5: the cell in the atlas differs/,
      );
      expect(auditOf(rig, manifest, atlas)).toBeUndefined();
    },
    T,
  );

  const changes: [string, (root: string) => void, RegExp][] = [
    [
      "a kit file whose bytes changed",
      (root) => void corruptKitFile(root),
      /kit file .*Superhero_Male_FullBody\.bin differs from its pinned hash/,
    ],
    [
      "a profile that changed",
      (root) => {
        const path = join(root, "profiles", "zeus.json");
        const profile = JSON.parse(readFileSync(path, "utf8"));
        profile.body.headScale += 0.01;
        writeFileSync(path, JSON.stringify(profile, null, 2));
      },
      /profile hash differs/,
    ],
    [
      "a camera that changed",
      (root) => {
        const path = join(root, "camera.json");
        const camera = JSON.parse(readFileSync(path, "utf8"));
        camera.light.sunStrength += 0.1;
        writeFileSync(path, JSON.stringify(camera, null, 2));
      },
      /camera hash differs/,
    ],
    [
      "a stamp set that changed",
      (root) => {
        const path = join(root, "stamps", "stamps.json");
        const stamps = JSON.parse(readFileSync(path, "utf8"));
        const variant = stamps.sets[0].face.variants[0];
        variant.anchor = [variant.anchor[0] + 1, variant.anchor[1]];
        writeFileSync(path, JSON.stringify(stamps, null, 2));
      },
      /stamp hash differs/,
    ],
  ];
  for (const [name, change, reason] of changes)
    test(
      `refuses ${name}`,
      async () => {
        const { rig, manifest, atlas } = await approved();
        const root = copyRenderRoot(rig.base);
        change(root);
        expect(auditOf(rig, manifest, atlas, { renderRoot: root })).toMatch(
          reason,
        );
        const publish = rig.session.publishAsset(
          PACK_INPUT.id,
          content,
          approvedPalettes(),
          registryOf(rig),
          cfg(rig, root),
        );
        expect(publish.ok).toBe(false);
        // The control is the same audit on the committed render root.
        expect(auditOf(rig, manifest, atlas)).toBeUndefined();
      },
      T,
    );

  test(
    "refuses a changed script, post-step version and Blender pin, as each would pin them",
    async () => {
      const { rig, manifest, atlas } = await approved();
      expect(
        auditOf(rig, manifest, atlas, {
          current: { script: "9".repeat(64) as Sha256 },
        }),
      ).toMatch(/script hash differs/);
      // A v1-recorded revision checked under the current (v3) post step.
      const v1 = structuredClone(manifest) as typeof manifest;
      (
        v1.provenance as { revisionRecipe: { postStep: number } }
      ).revisionRecipe.postStep = 1;
      expect(auditOf(rig, v1, atlas)).toMatch(/post-step version differs/);
      expect(
        auditOf(rig, manifest, atlas, {
          current: { postStepVersion: POST_STEP_VERSION + 1 },
        }),
      ).toMatch(/post-step version differs/);
      expect(
        auditOf(rig, manifest, atlas, {
          current: {
            blender: {
              version: "5.2.2",
              buildHash: "d13f752e3b9c",
              binarySha256: "8".repeat(64) as Sha256,
            },
          },
        }),
      ).toMatch(/Blender binary hash differs/);
    },
    T,
  );

  test(
    "refuses a stale palette digest, and publish refuses a palette changed since the report",
    async () => {
      const { rig, manifest, atlas } = await approved();
      const retro = content.palettes.get("greek-retro");
      if (retro === undefined) throw new Error("no palette");
      const edited = {
        ...retro,
        limits: {
          ...(retro.limits as NonNullable<typeof retro.limits>),
          colours: { sprite: 40 },
        },
      };
      const palettes = new Map([
        ...content.palettes,
        [
          "greek-retro",
          {
            ...edited,
            approval: {
              status: "approved" as const,
              digest: paletteDigest(edited),
            },
          },
        ],
      ]);
      expect(paletteDigest(edited)).not.toBe(paletteDigest(retro));
      expect(auditOf(rig, manifest, atlas, { palettes })).toMatch(
        /palette digest is stale/,
      );
      const publish = rig.session.publishAsset(
        PACK_INPUT.id,
        content,
        palettes,
        registryOf(rig),
        cfg(rig),
      );
      expect(publish.ok).toBe(false);
    },
    T,
  );

  test(
    "refuses slots of one revision whose recorded recipe hashes differ, and a slot recipe hash that is not its inputs'",
    async () => {
      const { rig, manifest, atlas } = await approved();
      const provenance = manifest.provenance as RenderedProvenance;
      const slot = provenance.slots[0];
      if (slot === undefined) throw new Error("no slot");
      const wrongSlot = {
        ...slot,
        recipeHash: slotRecipeHash("7".repeat(64) as Sha256, {
          state: "idle",
          clip: "idle10",
          facing: "west",
          seed: 0,
        }),
      };
      const bad = {
        ...manifest,
        provenance: { ...provenance, slots: [wrongSlot] },
      } as AssetManifest;
      expect(auditOf(rig, bad, atlas)).toMatch(
        /recipe hash .* is not the hash of its inputs/,
      );
      const mixed = {
        ...manifest,
        provenance: {
          ...provenance,
          slots: [{ ...slot, revisionRecipeHash: "6".repeat(64) as Sha256 }],
        },
      } as AssetManifest;
      expect(auditOf(rig, mixed, atlas)).toMatch(/revision mixes recipes/);
    },
    T,
  );

  test(
    "refuses a slot with no succeeded ledger job behind it",
    async () => {
      const { rig, manifest, atlas } = await approved();
      expect(auditOf(rig, manifest, atlas, { jobs: [] })).toMatch(
        /no succeeded job in the ledger/,
      );
    },
    T,
  );

  test(
    "a rendered asset does not publish without the render root",
    async () => {
      const { rig } = await approved();
      const publish = rig.session.publishAsset(
        PACK_INPUT.id,
        content,
        approvedPalettes(),
        registryOf(rig),
      );
      expect(publish.ok).toBe(false);
      if (!publish.ok) expect(publish.message).toMatch(/render root/);
    },
    T,
  );
});

describe("a hand edit on a rendered slot", () => {
  test(
    "is traced as a hand step over the rendered basis and survives publish",
    async () => {
      const { rig, ids } = await oneSlot();
      const candidate = rig.session.store.readRenderedCandidate(
        ids[0] as string,
      );
      if (candidate.kind !== "found") throw new Error("no candidate");
      const frames = candidate.value.frames.map((f) => {
        const decoded = decodePng(
          rig.session.store.readBlob(f.hash) as Uint8Array,
        );
        if (!decoded.ok) throw new Error("cell");
        return {
          rgba: new Uint8Array(decoded.image.rgba),
          width: 112,
          height: 96,
        };
      });
      // One opaque pixel of frame 0 takes the colour of another opaque pixel: still the palette.
      const first = frames[0];
      if (first === undefined) throw new Error("no frame");
      const opaque: number[] = [];
      for (let at = 0; at < first.rgba.length; at += 4)
        if (first.rgba[at + 3] === 255) opaque.push(at);
      const a = opaque[0] as number;
      const b = opaque.find(
        (at) =>
          first.rgba[at] !== first.rgba[a] ||
          first.rgba[at + 1] !== first.rgba[a + 1],
      ) as number;
      first.rgba.set(first.rgba.subarray(b, b + 3), a);
      const sheet = sheetOf({ w: 112, h: 96 }, [
        {
          slot: "idle/west",
          frames,
          durations: frames.map(() => 50),
          pivot: null,
        },
      ]);
      const opened = rig.session.openEdit(
        "hand-fix",
        "zeus-set",
        ["idle/west"],
        content,
      );
      if (!opened.ok) throw new Error(opened.message);
      const finished = rig.session.finishEdit(
        "hand-fix",
        sheet.png,
        sheet.json,
        content,
      );
      if (!finished.ok) throw new Error(finished.message);

      const set = rig.session.store.readWorkingSet("zeus-set");
      if (set.kind !== "found") throw new Error("no set");
      expect(set.value.rendered).toBeUndefined();
      expect(set.value.picks).toEqual({});
      expect(set.value.frames["idle/west"]?.basis).toEqual({
        kind: "rendered",
        jobId: ids[0] as string,
        manifest: candidate.value.manifest,
      });

      const packed = packOk(rig, "zeus-set");
      const manifest = manifestOf(packed.asset);
      const provenance = manifest.provenance as RenderedProvenance;
      expect(provenance.method).toBe("rendered");
      // The raw frames are still recorded: the hand step is over the rendered basis.
      expect(provenance.slots).toHaveLength(1);
      expect(provenance.handEdits).toHaveLength(1);
      expect(provenance.handEdits[0]?.description).toMatch(
        new RegExp(`idle/west was rendered by job ${ids[0]}`),
      );
      expect(provenance.licences.some((l) => l.role === "original-work")).toBe(
        true,
      );
      expect("generations" in provenance).toBe(false);

      const published = approveAndPublish(rig);
      if (!published.ok) throw new Error(published.message);
      expect(published.asset.record.state).toBe("canon");
      // The published atlas keeps the hand pixel, not the recompute.
      const atlas = decodePng(
        rig.session.store.readBlob(manifest.atlas.blob) as Uint8Array,
      );
      if (!atlas.ok || manifest.kind !== "sprite") throw new Error("atlas");
      const cell0 = manifest.animations[0]?.frames[0]?.rect.x as number;
      const stored = new Uint8Array(112 * 96 * 4);
      for (let row = 0; row < 96; row += 1)
        stored.set(
          atlas.image.rgba.subarray(
            (row * atlas.image.width + cell0) * 4,
            (row * atlas.image.width + cell0 + 112) * 4,
          ),
          row * 112 * 4,
        );
      expect(cellPixelHash({ rgba: stored, width: 112, height: 96 })).toBe(
        cellPixelHash(first),
      );
    },
    T,
  );
});

describe("a rendered slot hand-edited to another frame count", () => {
  test(
    "when no slot is still rendered, the revision packs, approves and publishes as hand work with the render job kept in relatedJobs",
    async () => {
      const { rig, ids } = await oneSlot();
      const candidate = rig.session.store.readRenderedCandidate(
        ids[0] as string,
      );
      if (candidate.kind !== "found") throw new Error("no candidate");
      const frames = candidate.value.frames.slice(0, 4).map((f) => {
        const decoded = decodePng(
          rig.session.store.readBlob(f.hash) as Uint8Array,
        );
        if (!decoded.ok) throw new Error("cell");
        return {
          rgba: new Uint8Array(decoded.image.rgba),
          width: 112,
          height: 96,
        };
      });
      const sheet = sheetOf({ w: 112, h: 96 }, [
        {
          slot: "idle/west",
          frames,
          durations: frames.map(() => 200),
          pivot: null,
        },
      ]);
      const opened = rig.session.openEdit(
        "hand-four",
        "zeus-set",
        ["idle/west"],
        content,
      );
      if (!opened.ok) throw new Error(opened.message);
      const finished = rig.session.finishEdit(
        "hand-four",
        sheet.png,
        sheet.json,
        content,
      );
      if (!finished.ok) throw new Error(finished.message);

      const packed = packOk(rig, "zeus-set");
      const manifest = manifestOf(packed.asset);
      if (manifest.kind !== "sprite") throw new Error("not a sprite");
      expect(manifest.animations[0]?.frames).toHaveLength(4);
      expect(manifest.animations[0]?.frames.map((f) => f.durationMs)).toEqual([
        200, 200, 200, 200,
      ]);
      const provenance = manifest.provenance as unknown as {
        method: string;
        relatedJobs: { jobId: string }[];
        handEdits: { description: string }[];
        generations?: unknown;
        slots?: unknown;
      };
      expect(provenance.method).toBe("hand");
      expect(provenance.relatedJobs.map((j) => j.jobId)).toEqual([
        ids[0] as string,
      ]);
      expect(provenance.handEdits).toHaveLength(1);
      expect(provenance.handEdits[0]?.description).toMatch(
        new RegExp(`idle/west was rendered by job ${ids[0]}`),
      );
      expect(provenance.generations).toBeUndefined();
      expect(provenance.slots).toBeUndefined();

      // No rendered slot remains, so publish runs no render audit (and needs no render root).
      const published = approveAndPublish(rig, approvedPalettes(), undefined);
      if (!published.ok) throw new Error(published.message);
      expect(published.asset.record.state).toBe("canon");
    },
    T,
  );
});

describe("a complete Zeus matrix", () => {
  const STATES = ["idle", "walk", "seated"] as const;
  const FACINGS = ["south", "east", "north", "west"] as const;
  const clips = (() => {
    const zeus = loadRenderInputs(RENDER_ROOT).profiles.find(
      (p) => p.id === "zeus",
    );
    if (zeus === undefined) throw new Error("no zeus profile");
    return zeus.clips;
  })();

  test("twelve slots under one revision recipe pack, approve and publish through the audit, each at the profile's frames and timing", async () => {
    const rig = await openRig({ launches: [{}] });
    const slots = STATES.flatMap((state) =>
      FACINGS.map((direction) => ({ state, direction })),
    );
    const ids = await renderCandidates(rig, "zeus-retro", slots, "zeus-set");
    expect(ids).toHaveLength(12);
    pickAll(rig, "zeus-set", ids);
    const packed = packOk(rig, "zeus-set");
    const manifest = manifestOf(packed.asset);
    const provenance = manifest.provenance as RenderedProvenance;
    expect(provenance.slots).toHaveLength(12);
    // Every slot recipe hash differs; the revision recipe hash is one.
    expect(new Set(provenance.slots.map((s) => s.recipeHash)).size).toBe(12);
    expect(new Set(provenance.slots.map((s) => s.revisionRecipeHash))).toEqual(
      new Set([provenance.revisionRecipe.hash]),
    );
    if (manifest.kind !== "sprite") throw new Error("not a sprite");
    expect(manifest.animations).toHaveLength(12);
    expect(manifest.animations.some((a) => a.state === "act")).toBe(false);
    for (const state of STATES) {
      const clip = clips[state];
      for (const animation of manifest.animations.filter(
        (a) => a.state === state,
      )) {
        expect(animation.frames).toHaveLength(clip?.frames as number);
        expect(animation.frames.map((f) => f.durationMs)).toEqual(
          clip === undefined ? [] : [...clip.frameMs],
        );
        expect(animation.loopStart).toBe(0);
      }
    }
    expect(
      manifest.animations.find((a) => a.state === "walk")?.frames,
    ).toHaveLength(16);
    expect(
      manifest.animations.find((a) => a.state === "walk")?.frames[0]
        ?.durationMs,
    ).toBe(50);
    expect(manifest.asymmetry).toEqual({ feature: "left-shoulder himation" });

    const published = approveAndPublish(rig);
    if (!published.ok) throw new Error(published.message);
    expect(published.asset.record.state).toBe("canon");
  }, 600_000);
});

describe("a ground tile set: render, pick, pack, approve and publish", () => {
  async function tileSet(over: Parameters<typeof openRig>[0] = {}) {
    const rig = await openRig({ launches: [{}], ...over });
    const ids = await renderTile(rig, "grass-flagstone-set", "tile-set");
    pickAll(rig, "tile-set", ids);
    return { rig, ids };
  }
  const packTile = (rig: Rig) =>
    rig.session.pack(
      { ...TILE_PACK_INPUT, workingSetId: "tile-set" },
      content,
      approvedPalettes(),
      registryOf(rig),
      { renderRoot: RENDER_ROOT },
    );
  async function packedTile(over: Parameters<typeof openRig>[0] = {}) {
    const { rig, ids } = await tileSet(over);
    const packed = packTile(rig);
    if (!packed.ok) throw new Error(packed.message);
    const manifest = manifestOf(packed.asset);
    return {
      rig,
      ids,
      packed,
      manifest,
      atlas: rig.session.store.readBlob(manifest.atlas.blob) as Uint8Array,
    };
  }
  const publishTile = (rig: Rig, palettes = approvedPalettes()) =>
    rig.session.publishAsset(
      TILE_PACK_INPUT.id,
      content,
      palettes,
      registryOf(rig),
      cfg(rig),
    );

  test(
    "two rendered patches are picked and packed to a tile manifest and the 16 by 16 atlas, every atlas cell conforming",
    async () => {
      const { rig, packed, manifest } = await packedTile();
      const status = rig.session.store.readWorkingSet("tile-set");
      if (status.kind !== "found") throw new Error("no set");
      expect(status.value.status).toBe("complete");
      expect(Object.keys(status.value.rendered ?? {}).sort()).toEqual([
        "base",
        "over",
      ]);
      if (manifest.kind !== "tile") throw new Error("not a tile");
      expect(manifest).toMatchObject({
        id: "grass-flagstone",
        cell: { w: 64, h: 32 },
        paletteId: "greek-retro",
        paletteFamily: "town",
        terrain: { base: "grass", over: "flagstone" },
        period: 4,
        atlas: { width: 1024, height: 512 },
      });
      if (manifest.provenance.method !== "rendered")
        throw new Error("not rendered");
      expect(manifest.provenance.slots.map((slot) => slot.slotKey)).toEqual([
        "base",
        "over",
      ]);
      expect(manifest.provenance.revisionRecipe.pivot).toEqual({
        x: 32,
        y: 16,
      });

      // Tile conformance ran on every one of the 256 atlas cells.
      const { record } = packed.asset;
      const report = "report" in record ? record.report : undefined;
      if (report === undefined) throw new Error("no report");
      const checks = report.checks;
      expect(report.status).toBe("pass");
      for (const name of [
        "binary-alpha",
        "palette",
        "diamond-coverage",
        "outside-diamond",
        "row-31",
      ])
        expect(
          checks.filter((c: { check: string }) => c.check.endsWith(`:${name}`))
            .length,
        ).toBe(256);
      expect(checks.every((c: { status: string }) => c.status === "pass")).toBe(
        true,
      );
      expect(
        checks.some(
          (c: { check: string }) => c.check === "0/0:diamond-coverage",
        ),
      ).toBe(true);
      expect(
        checks.some((c: { check: string }) => c.check === "15/15:row-31"),
      ).toBe(true);
    },
    T,
  );

  test(
    "the atlas is the stamp of the two stored patches, and approving and publishing it passes the audit",
    async () => {
      const { rig, manifest, atlas } = await packedTile();
      const approvedAsset = rig.session.approveAsset(
        TILE_PACK_INPUT.id,
        {},
        content,
        approvedPalettes(),
      );
      if (!approvedAsset.ok) throw new Error(approvedAsset.message);
      expect(
        auditOf(rig, approvedAsset.asset.record.manifest, atlas),
      ).toBeUndefined();
      const published = publishTile(rig);
      if (!published.ok) throw new Error(published.message);
      const revision = published.asset.published?.revision;
      if (revision === undefined) throw new Error("not published");
      const loaded = readRevision(
        registryOf(rig),
        manifest.id,
        revision,
        content.vocabulary,
      );
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.value.manifest.kind).toBe("tile");
    },
    T,
  );

  test(
    "pack refuses with one patch missing, naming the slot",
    async () => {
      const rig = await openRig({ launches: [{}] });
      const ids = await renderTile(rig, "grass-flagstone-set", "tile-set");
      pickAll(rig, "tile-set", [ids[0] as string]);
      const packed = packTile(rig);
      expect(packed.ok).toBe(false);
      if (!packed.ok) expect(packed.message).toMatch(/not complete|over/);
    },
    T,
  );

  test(
    "audit refuses a changed atlas byte, naming the cell, and a changed recipe, each beside the control that passes",
    async () => {
      const { rig, manifest, atlas } = await packedTile();
      const approvedAsset = rig.session.approveAsset(
        TILE_PACK_INPUT.id,
        {},
        content,
        approvedPalettes(),
      );
      if (!approvedAsset.ok) throw new Error(approvedAsset.message);
      const approvedManifest = approvedAsset.asset.record.manifest;
      expect(auditOf(rig, approvedManifest, atlas)).toBeUndefined();

      const decoded = decodePng(atlas);
      if (!decoded.ok) throw new Error("atlas");
      const rgba = new Uint8Array(decoded.image.rgba);
      // One opaque pixel of cell (mask 6, offset 9) takes another colour.
      const at = ((9 * 32 + 15) * 1024 + 6 * 64 + 32) * 4;
      expect(rgba[at + 3]).toBe(255);
      rgba[at] = 255 - (rgba[at] as number);
      const changed = encodeRgbaPng(rgba, 1024, 512);
      const refusal = auditOf(rig, approvedManifest, changed);
      expect(refusal).toMatch(/tile atlas cell \(mask 6, offset 9\)/);
      expect(refusal).toMatch(/differs from the stamp/);

      expect(
        auditOf(rig, approvedManifest, atlas, {
          current: {
            blender: rig.blender.pin as never,
            script: "0".repeat(64) as Sha256,
          },
        }),
      ).toMatch(/script hash differs/);
      expect(
        auditOf(rig, approvedManifest, atlas, {
          current: { blender: rig.blender.pin as never, postStepVersion: 99 },
        }),
      ).toMatch(/post-step version differs/);
      expect(manifest.kind).toBe("tile");
    },
    T,
  );

  test(
    "audit refuses a render whose patches do not repeat every N, naming the gate",
    async () => {
      const { rig, atlas } = await packedTile({
        launches: [{ groundPeriod: 3 }],
      });
      const approvedAsset = rig.session.approveAsset(
        TILE_PACK_INPUT.id,
        {},
        content,
        approvedPalettes(),
      );
      if (!approvedAsset.ok) throw new Error(approvedAsset.message);
      const refusal = auditOf(rig, approvedAsset.asset.record.manifest, atlas);
      expect(refusal).toMatch(/patch gate/);
      expect(refusal).toMatch(/slot (base|over)/);
      const published = publishTile(rig);
      expect(published.ok).toBe(false);
      if (!published.ok)
        expect(published.message).toMatch(/render audit:.*patch gate/);
    },
    T,
  );

  test(
    "audit refuses a stored raw frame that is missing, as it does for a sprite",
    async () => {
      const { rig, manifest, atlas } = await packedTile();
      if (manifest.provenance.method !== "rendered") throw new Error("x");
      const hash = manifest.provenance.slots[1]?.raw.colour[0] as Sha256;
      rmSync(join(rig.root, "blobs", `${hash}.png`));
      expect(auditOf(rig, manifest, atlas)).toMatch(
        /slot over: the raw colour frame 0 .* is missing from the store/,
      );
    },
    T,
  );

  test(
    "the patch is the cropped cell: 320x192, lattice (0,0) at (160,48)",
    async () => {
      const { rig, ids } = await tileSet();
      const crop = groundCrop(4, [272, 64]);
      for (const id of ids) {
        const candidate = rig.session.store.readRenderedCandidate(id);
        if (candidate.kind !== "found") throw new Error("no candidate");
        expect(candidate.value.kind).toBe("tile");
        expect(candidate.value.frames).toHaveLength(1);
        const png = decodePng(
          rig.session.store.readBlob(
            candidate.value.frames[0]?.hash as Sha256,
          ) as Uint8Array,
        );
        if (!png.ok) throw new Error("cell");
        expect([png.image.width, png.image.height]).toEqual([crop.w, crop.h]);
      }
      expect([160, 48]).toEqual([272 - crop.x, 64 - crop.y]);
    },
    T,
  );
});
