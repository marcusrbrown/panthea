// The render audit: what publishing a rendered asset checks again, offline and without Blender.
// `auditDerivation` passes trivially for a rendered asset (it has no derived steps), so this is a
// separate audit. It stands on what is committed now and what the studio stored:
//
//   - the revision recipe hash is recomputed from the current profile, camera, kit files, stamp
//     set, script, post-step version, Blender pin and the palette digest on disk, and must equal
//     the recorded one (a field-by-field comparison names which input moved);
//   - every slot's recipe hash is recomputed from the revision hash and its state, clip, facing
//     and seed, and every slot was rendered under the one revision hash;
//   - every slot is backed by a succeeded render job in the ledger whose raw-frame blobs are all
//     in the store and hash to their names;
//   - the post step is run again from those raw frames, and each cell's decoded-pixel hash must be
//     the cell in the atlas (a hand-edited slot keeps its hand pixels and is only held to the
//     rest); with no hand edits the atlas is rebuilt from the cells and must be the stored one.
//
// It returns the first reason it refuses, or undefined when everything holds.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AssetManifest,
  RenderedProvenance,
  RenderedSlot,
  Sha256,
} from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { sha256Hex } from "../hash";
import { type PaletteSet, paletteDigest } from "../palette";
import { encodeRgbaPng } from "../placeholder";
import { decodePng } from "../studio/png/decode";
import type { JobRecord } from "../studio/store";
import { cameraHash } from "./camera";
import { BLENDER_PIN, RENDER_SCRIPT_SHA256 } from "./engine";
import { parseRenderJobManifest } from "./job-manifest";
import { loadRenderInputs } from "./load";
import {
  cellPixelHash,
  POST_STEP_VERSION,
  postProcessSlot,
  type RawFrame,
} from "./post";
import { postPaletteFrom } from "./post-palette";
import { profileHash } from "./profile";
import {
  type BlenderBinaryPin,
  effectiveCamera,
  kitHash,
  NO_STAMPS_HASH,
  postSettingsFor,
  postStepSettings,
  revisionRecipe,
  shadowRampOf,
  slotRecipeHash,
  stampSetHash,
} from "./recipe";
import {
  type LoadedStampSet,
  loadStampSet,
  parseStampManifest,
} from "./stamps";

/** What the studio hands a publish so a rendered asset can be audited: where the committed render inputs are, and what this build pins. */
export interface RenderAuditConfig {
  /** `tools/render`: the committed profile, camera, kits and stamps. */
  readonly renderRoot: string;
  readonly current?: RenderAudit["current"];
}

export interface RenderAudit {
  readonly manifest: AssetManifest;
  readonly atlas: Uint8Array;
  /** Every palette as it is on disk now. */
  readonly palettes: PaletteSet;
  /** `tools/render`: the committed profile, camera, kits and stamps. */
  readonly renderRoot: string;
  readonly readBlob: (hash: Sha256) => Uint8Array | undefined;
  /** The job ledger. */
  readonly jobs: readonly JobRecord[];
  /** Slot keys whose pixels a hand edit replaced. */
  readonly handEdited: ReadonlySet<string>;
  /**
   * What the code pins now: the script's hash, the Blender pin and the post-step version. They
   * default to this build's own; a test says what a changed build would pin.
   */
  readonly current?: {
    readonly script?: Sha256;
    readonly blender?: BlenderBinaryPin;
    readonly postStepVersion?: number;
  };
}

function crop(
  image: RgbaImage,
  x: number,
  y: number,
  w: number,
  h: number,
): RgbaImage {
  const rgba = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row += 1)
    rgba.set(
      image.rgba.subarray(
        ((y + row) * image.width + x) * 4,
        ((y + row) * image.width + x + w) * 4,
      ),
      row * w * 4,
    );
  return { rgba, width: w, height: h };
}

/** The raw frames of one recorded slot, decoded; or why one cannot be. */
function rawFrames(
  slot: RenderedSlot,
  readBlob: RenderAudit["readBlob"],
):
  | { ok: true; frames: Record<"colour" | "id" | "depth", RgbaImage[]> }
  | { ok: false; message: string } {
  const frames = { colour: [], id: [], depth: [] } as Record<
    "colour" | "id" | "depth",
    RgbaImage[]
  >;
  for (const role of ["colour", "id", "depth"] as const) {
    for (const [index, hash] of slot.raw[role].entries()) {
      const bytes = readBlob(hash);
      if (bytes === undefined)
        return {
          ok: false,
          message: `slot ${slot.slotKey}: the raw ${role} frame ${index} (${hash}) is missing from the store`,
        };
      if (sha256Hex(bytes) !== hash)
        return {
          ok: false,
          message: `slot ${slot.slotKey}: the raw ${role} frame ${index} does not match its hash ${hash}`,
        };
      const decoded = decodePng(bytes);
      if (!decoded.ok)
        return {
          ok: false,
          message: `slot ${slot.slotKey}: the raw ${role} frame ${index} cannot be decoded (${decoded.code})`,
        };
      frames[role].push(decoded.image);
    }
  }
  return { ok: true, frames };
}

export function auditRendered(audit: RenderAudit): string | undefined {
  const { manifest } = audit;
  const scriptNow = audit.current?.script ?? RENDER_SCRIPT_SHA256;
  const blenderNow = audit.current?.blender ?? BLENDER_PIN;
  const postStepNow = audit.current?.postStepVersion ?? POST_STEP_VERSION;
  if (manifest.provenance.method !== "rendered") return undefined;
  if (manifest.kind !== "sprite") return "a rendered asset is a sprite";
  const provenance: RenderedProvenance = manifest.provenance;
  const recorded = provenance.revisionRecipe;

  // --- the committed inputs ---
  const inputs = loadRenderInputs(audit.renderRoot);
  const profile = inputs.profiles.find((p) => p.id === recorded.profile.id);
  if (profile === undefined)
    return `the render profile "${recorded.profile.id}" is not among the committed profiles (${inputs.problems.map((p) => `${p.file}: ${p.message}`).join("; ") || "none"})`;
  const profileProblems = inputs.problems.filter(
    (p) => p.file === `profiles/${profile.id}.json`,
  );
  if (profileProblems.length > 0)
    return `the render profile ${profile.id}: ${profileProblems.map((p) => p.message).join("; ")}`;
  if (inputs.camera === undefined) return "camera.json is missing or unusable";
  const camera = effectiveCamera(profile, inputs.camera);

  for (const ref of profile.kitFiles) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(
        readFileSync(join(audit.renderRoot, "kits", ref.kit, ref.path)),
      );
    } catch {
      return `the kit file ${ref.kit}/${ref.path} is missing`;
    }
    if (sha256Hex(bytes) !== ref.sha256)
      return `the kit file ${ref.kit}/${ref.path} differs from its pinned hash`;
  }
  // A figure's face stamps; a structure has none.
  let stampsHash: Sha256 = NO_STAMPS_HASH;
  let stamps: LoadedStampSet | undefined;
  if (profile.kind !== "structure") {
    let stampsJson: unknown;
    try {
      stampsJson = JSON.parse(
        readFileSync(join(audit.renderRoot, "stamps", "stamps.json"), "utf8"),
      );
    } catch {
      return "stamps.json is missing or not valid JSON";
    }
    const stampManifest = parseStampManifest(stampsJson);
    if (!stampManifest.ok) return `stamps.json: ${stampManifest.message}`;
    const stampSet = stampManifest.value.sets.find(
      (s) => s.id === profile.stampSet,
    );
    if (stampSet === undefined)
      return `the stamp set "${profile.stampSet}" is not in stamps.json`;
    const loadedStamps = loadStampSet(audit.renderRoot, profile.stampSet);
    if (!loadedStamps.ok)
      return `the stamp set ${profile.stampSet}: ${loadedStamps.problems.map((p) => `${p.file}: ${p.message}`).join("; ")}`;
    stampsHash = stampSetHash(stampSet);
    stamps = loadedStamps.set;
  }
  const palette = audit.palettes.get(recorded.palette.id);
  if (palette === undefined)
    return `the palette "${recorded.palette.id}" is not among the palettes on disk`;

  // --- the revision recipe, field by field, then as a whole ---
  const named: [string, unknown, unknown][] = [
    ["profile hash", profileHash(profile), recorded.profile.hash],
    ["camera hash", cameraHash(camera), recorded.camera],
    ["kit hash", kitHash(profile.kitFiles), recorded.kit],
    ["stamp hash", stampsHash, recorded.stamps],
    ["script hash", scriptNow, recorded.script],
    ["post-step version", postStepNow, recorded.postStep],
    ["Blender version", blenderNow.version, recorded.blender.version],
    ["Blender build", blenderNow.buildHash, recorded.blender.build],
    ["Blender binary hash", blenderNow.binarySha256, recorded.blender.sha256],
  ];
  for (const [name, now, then] of named)
    if (now !== then)
      return `the ${name} differs: the recipe recorded ${String(then)}, the committed input is ${String(now)}`;
  if (paletteDigest(palette) !== recorded.palette.digest)
    return `the palette digest is stale: the recipe recorded ${recorded.palette.digest} for ${recorded.palette.id}, the palette on disk is ${paletteDigest(palette)}`;
  const recomputed = revisionRecipe({
    profile: profileHash(profile),
    camera: cameraHash(camera),
    palette: { id: recorded.palette.id, digest: paletteDigest(palette) },
    pivot: recorded.pivot,
    script: scriptNow,
    postStep: {
      version: postStepNow,
      settings: postSettingsFor(shadowRampOf(profile)),
    },
    blender: blenderNow,
    kit: kitHash(profile.kitFiles),
    stamps: stampsHash,
  }).hash;
  if (recomputed !== recorded.hash)
    return `the revision recipe hash ${recorded.hash} is not the hash of the committed inputs (${recomputed})`;

  // --- the slots ---
  const mixed = provenance.slots.filter(
    (slot) => slot.revisionRecipeHash !== recorded.hash,
  );
  if (mixed.length > 0)
    return `slots ${mixed.map((s) => s.slotKey).join(", ")} were not rendered under the revision recipe hash ${recorded.hash}: the revision mixes recipes`;

  const related = new Set(provenance.relatedJobs.map((j) => j.jobId));
  const settings = postStepSettings(
    camera,
    recorded.pivot,
    postSettingsFor(shadowRampOf(profile)),
  );
  const postPalette = postPaletteFrom(audit.palettes, recorded.palette.id);
  if (!postPalette.ok) return postPalette.message;
  const cell = manifest.cell;
  const atlas = decodePng(audit.atlas);
  if (!atlas.ok) return "the atlas cannot be decoded";
  const rebuilt = new Uint8Array(atlas.image.rgba.length);
  let rebuiltCells = 0;

  for (const slot of provenance.slots) {
    const expectedHash = slotRecipeHash(recorded.hash, {
      state: slot.state,
      clip: slot.clip,
      facing: slot.facing,
      seed: slot.seed,
    });
    if (expectedHash !== slot.recipeHash)
      return `slot ${slot.slotKey}: its recipe hash ${slot.recipeHash} is not the hash of its inputs (${expectedHash})`;

    // The ledger job that produced these raw frames.
    let job: JobRecord | undefined;
    let jobManifest: ReturnType<typeof parseRenderJobManifest> | undefined;
    for (const record of audit.jobs) {
      if (!related.has(record.job.id) || record.source.slotKey !== slot.slotKey)
        continue;
      if (record.job.status !== "succeeded" || record.engine === undefined)
        continue;
      const hash = record.engine.settings.manifest;
      const bytes =
        typeof hash === "string" ? audit.readBlob(hash as Sha256) : undefined;
      if (bytes === undefined) continue;
      const parsed = parseRenderJobManifest(bytes);
      if (!parsed.ok) continue;
      if (
        JSON.stringify(parsed.value.frames.map((f) => f.raw.colour)) ===
        JSON.stringify(slot.raw.colour)
      ) {
        job = record;
        jobManifest = parsed;
        break;
      }
    }
    if (job === undefined || jobManifest === undefined || !jobManifest.ok)
      return `slot ${slot.slotKey}: no succeeded job in the ledger rendered its raw frames`;
    const m = jobManifest.value;
    if (m.revisionRecipeHash !== recorded.hash)
      return `slot ${slot.slotKey}: its job ${job.job.id} rendered under the revision recipe hash ${m.revisionRecipeHash}, not ${recorded.hash}: the revision mixes recipes`;
    if (m.slotRecipeHash !== slot.recipeHash)
      return `slot ${slot.slotKey}: its job ${job.job.id} records the slot recipe hash ${m.slotRecipeHash}, not ${slot.recipeHash}`;

    const raw = rawFrames(slot, audit.readBlob);
    if (!raw.ok) return raw.message;
    const frames: RawFrame[] = m.frames.map((frame, index) => ({
      name: `${slot.slotKey.replaceAll("/", "_")}_${String(index).padStart(2, "0")}`,
      facing: slot.facing as RawFrame["facing"],
      colour: raw.frames.colour[index],
      id: raw.frames.id[index],
      depth: raw.frames.depth[index],
      locators: frame.locators,
    }));
    const post = postProcessSlot({
      slot: slot.slotKey,
      settings,
      palette: postPalette.value,
      ...(stamps === undefined ? {} : { stamps }),
      frames,
    });
    if (!post.ok)
      return `slot ${slot.slotKey}: the post step cannot be run again from its raw frames: ${post.message}`;

    const animation = manifest.animations.find(
      (a) =>
        a.state === slot.state &&
        a.direction === slot.facing &&
        a.ability === slot.ability,
    );
    if (animation === undefined)
      return `slot ${slot.slotKey} is not in the manifest's animations`;
    for (const [index, made] of post.cells.entries()) {
      const hash = cellPixelHash(made.image);
      if (hash !== m.frames[index]?.cellPixels)
        return `slot ${slot.slotKey} frame ${index}: the post step recomputed from the raw frames gives ${hash}, not the ${m.frames[index]?.cellPixels} its job recorded`;
      const frame = animation.frames[index];
      if (frame === undefined) continue;
      const stored = crop(
        atlas.image,
        frame.rect.x,
        frame.rect.y,
        cell.w,
        cell.h,
      );
      if (!audit.handEdited.has(slot.slotKey) && cellPixelHash(stored) !== hash)
        return `slot ${slot.slotKey} frame ${index}: the cell in the atlas differs from the post step recomputed from its raw frames`;
      if (!audit.handEdited.has(slot.slotKey)) {
        for (let row = 0; row < cell.h; row += 1)
          rebuilt.set(
            made.image.rgba.subarray(row * cell.w * 4, (row + 1) * cell.w * 4),
            ((frame.rect.y + row) * atlas.image.width + frame.rect.x) * 4,
          );
        rebuiltCells += 1;
      }
    }
  }

  // With no hand edit and every cell recomputed, the atlas is exactly the recomputed cells.
  const total = manifest.animations.reduce((n, a) => n + a.frames.length, 0);
  if (
    audit.handEdited.size === 0 &&
    rebuiltCells === total &&
    sha256Hex(encodeRgbaPng(rebuilt, atlas.image.width, atlas.image.height)) !==
      manifest.atlas.blob
  )
    return "the atlas differs from the cells recomputed from the raw frames";
  return undefined;
}
