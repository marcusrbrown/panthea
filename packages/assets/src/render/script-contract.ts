// The script contract: one definition shared by the Blender render script (render.py), the
// runner's parsers and U7's test fake.
//
//   - the recipe input the runner writes and the script reads,
//   - the per-slot `done.json` sentinel the script writes last, and the runner ingests only
//     when it matches (never the exit code),
//   - the exit-code table and the status each outcome maps to.
//
// The sentinel's per-file sha256 values check transport integrity only. Blender writes date and
// render-time chunks into every PNG, so frame identity is always the decoded pixels (U1).
//
// Pure module: no filesystem.

import {
  fail,
  isRecord,
  ok,
  type ParseResult,
  parseArray,
  parseFiniteNumber,
  parseNonNegativeInteger,
  parseSchemaVersion,
  parseSha256,
  parseString,
  type Sha256,
} from "@panthea/contracts";
import { type Camera, parseCamera, parseVec2, type Vec2 } from "./camera";
import {
  FACINGS,
  type Facing,
  type ModelProfile,
  parseProfile,
} from "./profile";

const SUPPORTED_SCHEMA_VERSIONS = [1] as const;
const SLOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HEX_COLOUR = /^#[0-9a-f]{6}$/;

/** The file the script writes last into a slot directory. */
export const SENTINEL_NAME = "done.json";

/** The script's first output line starts with this; a process that dies before it died before the script ran. */
export const FIRST_LINE_MARKER = "RENDER start";

/** The passes rendered per frame, in the order the sentinel lists them. */
export const RENDER_ROLES = ["colour", "id", "depth"] as const;
export type RenderRole = (typeof RENDER_ROLES)[number];

/** Part-ID names. A part's ID byte is `ID_BASE + ID_STEP * index`. Shared with the post step. */
export const PART_IDS = [
  "head",
  "torso",
  "arm_l",
  "hand_l",
  "arm_r",
  "hand_r",
  "leg_l",
  "leg_r",
  "robe_upper",
  "robe_skirt",
  "belt",
  "beard",
  "hair",
  "tunic",
  "tunic_skirt",
  "bolt",
  "trunk",
  "foliage",
  "stylobate",
  "column",
  "entablature",
  "pediment",
  "cella",
  "roof",
  "wall",
  "door",
  "prop",
  "ground",
  "animal",
] as const;
export const ID_BASE = 16;
export const ID_STEP = 8;

// --- Exit codes and statuses ---------------------------------------------------------

export const EXIT_CODES = {
  ok: 0,
  /** An uncaught exception in the script (`--python-exit-code 1`). */
  scriptError: 1,
  noGpuContext: 10,
  versionMismatch: 11,
  inputError: 12,
} as const;

/** What a finished (or terminated) render means for the job. */
export type RenderStatus = "ok" | "unavailable" | "failed";
export type TerminationStatus = RenderStatus | "aborted";

/**
 * Exit code to status. No GPU context and a version or build mismatch are `unavailable`; an input
 * error and a script error are `failed`. `ok` is only the process outcome: the runner still
 * checks the sentinel and counts the expected files. An unknown code is refused.
 */
export function classifyExit(code: number): ParseResult<RenderStatus> {
  switch (code) {
    case EXIT_CODES.ok:
      return ok("ok");
    case EXIT_CODES.noGpuContext:
    case EXIT_CODES.versionMismatch:
      return ok("unavailable");
    case EXIT_CODES.inputError:
    case EXIT_CODES.scriptError:
      return ok("failed");
    default:
      return fail("exitCode", `unknown exit code ${code}`);
  }
}

export interface Termination {
  readonly signal: string;
  /** Whether the script's first line (`FIRST_LINE_MARKER`) reached the runner. */
  readonly sawFirstLine: boolean;
  /** The runner stopped the process itself (abort or quit). */
  readonly aborted: boolean;
}

/**
 * Death by signal. The runner's own abort reads as aborted. Otherwise death before the script's
 * first line is `unavailable` (U1: denying the GPU crashes Blender with SIGSEGV before any
 * script runs, so the no-GPU exit code is not reachable that way); after it, `failed`.
 */
export function classifyTermination(
  termination: Termination,
): TerminationStatus {
  if (termination.aborted) return "aborted";
  return termination.sawFirstLine ? "failed" : "unavailable";
}

// --- Recipe input ------------------------------------------------------------------------

export interface BlenderPin {
  /** `bpy.app.version_string` without the release suffix, e.g. `5.2.2`. */
  readonly version: string;
  readonly buildHash: string;
}

export interface PaletteRamp {
  readonly id: string;
  /** `#rrggbb`, shade 0 (the outline's) first. */
  readonly shades: readonly string[];
}

export interface RecipePalette {
  readonly id: string;
  readonly digest: Sha256;
  /** At least the ramps the profile's materials use. */
  readonly ramps: readonly PaletteRamp[];
}

export interface RecipeSlot {
  /** Names the slot in the sentinel and the log. */
  readonly id: string;
  /** A semantic state of the profile's clip map. */
  readonly state: string;
  readonly facing: Facing;
  readonly frames: number;
  /** Where the script commits the slot: frames are rendered beside it, then moved here. */
  readonly outDir: string;
}

export interface RenderRecipe {
  readonly schemaVersion: 1;
  readonly blender: BlenderPin;
  /** Holds only the kit files the recipe needs, as `<kit>/<path>`. */
  readonly stagingRoot: string;
  readonly camera: Camera;
  readonly profile: ModelProfile;
  readonly palette: RecipePalette;
  readonly slots: readonly RecipeSlot[];
}

function strict(
  value: unknown,
  path: string,
  keys: readonly string[],
): ParseResult<Record<string, unknown>> {
  if (!isRecord(value)) return fail(path, "expected an object");
  for (const key of Object.keys(value)) {
    if (!keys.includes(key))
      return fail(`${path}.${key}`, `unknown key "${key}"`);
  }
  for (const key of keys) {
    if (!(key in value)) return fail(`${path}.${key}`, "is required");
  }
  return ok(value);
}

function parsePin(value: unknown, path: string): ParseResult<BlenderPin> {
  const record = strict(value, path, ["version", "buildHash"]);
  if (!record.ok) return record;
  const version = parseString(record.value.version, `${path}.version`);
  if (!version.ok) return version;
  const buildHash = parseString(record.value.buildHash, `${path}.buildHash`);
  if (!buildHash.ok) return buildHash;
  return ok({ version: version.value, buildHash: buildHash.value });
}

function parseRamp(value: unknown, path: string): ParseResult<PaletteRamp> {
  const record = strict(value, path, ["id", "shades"]);
  if (!record.ok) return record;
  const id = parseString(record.value.id, `${path}.id`);
  if (!id.ok) return id;
  const shades = parseArray(
    record.value.shades,
    `${path}.shades`,
    (item, itemPath) => {
      const text = parseString(item, itemPath);
      if (!text.ok) return text;
      return HEX_COLOUR.test(text.value)
        ? text
        : fail(itemPath, "expected a lowercase #rrggbb colour");
    },
  );
  if (!shades.ok) return shades;
  return ok({ id: id.value, shades: shades.value });
}

function parseSlot(value: unknown, path: string): ParseResult<RecipeSlot> {
  const record = strict(value, path, [
    "id",
    "state",
    "facing",
    "frames",
    "outDir",
  ]);
  if (!record.ok) return record;
  const id = parseString(record.value.id, `${path}.id`);
  if (!id.ok) return id;
  if (!SLOT_ID.test(id.value))
    return fail(`${path}.id`, "expected a plain slot id");
  const state = parseString(record.value.state, `${path}.state`);
  if (!state.ok) return state;
  if (
    typeof record.value.facing !== "string" ||
    !(FACINGS as readonly string[]).includes(record.value.facing)
  ) {
    return fail(`${path}.facing`, `expected one of: ${FACINGS.join(", ")}`);
  }
  const frames = parseNonNegativeInteger(record.value.frames, `${path}.frames`);
  if (!frames.ok) return frames;
  if (frames.value < 1)
    return fail(`${path}.frames`, "expected at least one frame");
  const outDir = parseString(record.value.outDir, `${path}.outDir`);
  if (!outDir.ok) return outDir;
  return ok({
    id: id.value,
    state: state.value,
    facing: record.value.facing as Facing,
    frames: frames.value,
    outDir: outDir.value,
  });
}

export function parseRenderRecipe(
  value: unknown,
  path = "recipe",
): ParseResult<RenderRecipe> {
  const record = strict(value, path, [
    "schemaVersion",
    "blender",
    "stagingRoot",
    "camera",
    "profile",
    "palette",
    "slots",
  ]);
  if (!record.ok) return record;
  const version = parseSchemaVersion(
    record.value.schemaVersion,
    SUPPORTED_SCHEMA_VERSIONS,
    `${path}.schemaVersion`,
  );
  if (!version.ok) return version;
  const blender = parsePin(record.value.blender, `${path}.blender`);
  if (!blender.ok) return blender;
  const stagingRoot = parseString(
    record.value.stagingRoot,
    `${path}.stagingRoot`,
  );
  if (!stagingRoot.ok) return stagingRoot;
  const camera = parseCamera(record.value.camera, `${path}.camera`);
  if (!camera.ok) return camera;
  const profile = parseProfile(record.value.profile, `${path}.profile`);
  if (!profile.ok) return profile;

  const paletteRecord = strict(record.value.palette, `${path}.palette`, [
    "id",
    "digest",
    "ramps",
  ]);
  if (!paletteRecord.ok) return paletteRecord;
  const paletteId = parseString(paletteRecord.value.id, `${path}.palette.id`);
  if (!paletteId.ok) return paletteId;
  const digest = parseSha256(
    paletteRecord.value.digest,
    `${path}.palette.digest`,
  );
  if (!digest.ok) return digest;
  const ramps = parseArray(
    paletteRecord.value.ramps,
    `${path}.palette.ramps`,
    parseRamp,
  );
  if (!ramps.ok) return ramps;
  const needed = Math.max(...camera.value.shading.bandShades) + 1;
  for (const [role, material] of Object.entries(profile.value.materials)) {
    const ramp = ramps.value.find((r) => r.id === material.ramp);
    if (ramp === undefined) {
      return fail(
        `${path}.palette.ramps`,
        `the palette has no ramp "${material.ramp}", which material "${role}" uses`,
      );
    }
    if (ramp.shades.length < needed) {
      return fail(
        `${path}.palette.ramps`,
        `ramp "${ramp.id}" has ${ramp.shades.length} shades, the camera's bands need ${needed}`,
      );
    }
  }

  const slots = parseArray(record.value.slots, `${path}.slots`, parseSlot);
  if (!slots.ok) return slots;
  if (slots.value.length === 0)
    return fail(`${path}.slots`, "expected at least one slot");
  const seen = new Set<string>();
  for (const [index, slot] of slots.value.entries()) {
    if (seen.has(slot.id))
      return fail(`${path}.slots[${index}].id`, `duplicate slot "${slot.id}"`);
    seen.add(slot.id);
    if (profile.value.clips[slot.state] === undefined) {
      return fail(
        `${path}.slots[${index}].state`,
        `"${slot.state}" is not a semantic state of profile "${profile.value.id}"`,
      );
    }
  }
  return ok({
    schemaVersion: 1,
    blender: blender.value,
    stagingRoot: stagingRoot.value,
    camera: camera.value,
    profile: profile.value,
    palette: { id: paletteId.value, digest: digest.value, ramps: ramps.value },
    slots: slots.value,
  });
}

/** The recipe as the script reads it. */
export function renderRecipeJson(recipe: RenderRecipe): string {
  return `${JSON.stringify(recipe)}\n`;
}

// --- done.json ---------------------------------------------------------------------------------

export interface SentinelFile {
  /** POSIX path relative to the slot directory. */
  readonly name: string;
  readonly sha256: Sha256;
}

export interface FrameExtent {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface BoltLocator {
  readonly basePx: Vec2;
  readonly tipPx: Vec2;
  readonly baseDepth: number;
}

export interface PointLocator {
  readonly px: Vec2;
  readonly depth: number;
}

/** Where the post step anchors the stamps in this frame (1x cell pixels, camera depth in metres). */
export interface FrameLocators {
  readonly bolt?: BoltLocator;
  readonly points: Readonly<Record<string, PointLocator>>;
}

export interface DoneSentinel {
  readonly schemaVersion: 1;
  readonly slot: string;
  readonly blender: BlenderPin;
  readonly frames: number;
  /** Per role, one file per frame in frame order. */
  readonly files: Readonly<Record<RenderRole, readonly SentinelFile[]>>;
  /** The action frame each output frame was sampled at. */
  readonly sourceFrames: readonly number[];
  /** Screen extent of the figure in the 1x cell, per frame. */
  readonly extentPx: readonly FrameExtent[];
  readonly locators: readonly FrameLocators[];
}

function parseExtent(value: unknown, path: string): ParseResult<FrameExtent> {
  const record = strict(value, path, ["top", "bottom", "left", "right"]);
  if (!record.ok) return record;
  const numbers: Record<string, number> = {};
  for (const key of ["top", "bottom", "left", "right"] as const) {
    const parsed = parseFiniteNumber(record.value[key], `${path}.${key}`);
    if (!parsed.ok) return parsed;
    numbers[key] = parsed.value;
  }
  return ok(numbers as unknown as FrameExtent);
}

function parseLocators(
  value: unknown,
  path: string,
): ParseResult<FrameLocators> {
  if (!isRecord(value)) return fail(path, "expected a locators record");
  for (const key of Object.keys(value)) {
    if (key !== "bolt" && key !== "points")
      return fail(`${path}.${key}`, `unknown key "${key}"`);
  }
  let bolt: BoltLocator | undefined;
  if (value.bolt !== undefined) {
    const record = strict(value.bolt, `${path}.bolt`, [
      "basePx",
      "tipPx",
      "baseDepth",
    ]);
    if (!record.ok) return record;
    const basePx = parseVec2(record.value.basePx, `${path}.bolt.basePx`);
    if (!basePx.ok) return basePx;
    const tipPx = parseVec2(record.value.tipPx, `${path}.bolt.tipPx`);
    if (!tipPx.ok) return tipPx;
    const baseDepth = parseFiniteNumber(
      record.value.baseDepth,
      `${path}.bolt.baseDepth`,
    );
    if (!baseDepth.ok) return baseDepth;
    bolt = {
      basePx: basePx.value,
      tipPx: tipPx.value,
      baseDepth: baseDepth.value,
    };
  }
  if (!isRecord(value.points))
    return fail(`${path}.points`, "expected a points record");
  const points: Record<string, PointLocator> = {};
  for (const [name, entry] of Object.entries(value.points)) {
    const record = strict(entry, `${path}.points.${name}`, ["px", "depth"]);
    if (!record.ok) return record;
    const px = parseVec2(record.value.px, `${path}.points.${name}.px`);
    if (!px.ok) return px;
    const depth = parseFiniteNumber(
      record.value.depth,
      `${path}.points.${name}.depth`,
    );
    if (!depth.ok) return depth;
    points[name] = { px: px.value, depth: depth.value };
  }
  return ok({ ...(bolt === undefined ? {} : { bolt }), points });
}

function parseSentinelFile(
  value: unknown,
  path: string,
): ParseResult<SentinelFile> {
  const record = strict(value, path, ["name", "sha256"]);
  if (!record.ok) return record;
  const name = parseString(record.value.name, `${path}.name`);
  if (!name.ok) return name;
  const segments = name.value.split("/");
  if (
    name.value.includes("\\") ||
    segments.some((s) => s === "" || s === "." || s === "..")
  ) {
    return fail(
      `${path}.name`,
      "expected a relative POSIX path inside the slot directory",
    );
  }
  const sha = parseSha256(record.value.sha256, `${path}.sha256`);
  if (!sha.ok) return sha;
  return ok({ name: name.value, sha256: sha.value });
}

export interface ExpectedSlot {
  readonly slot: string;
  readonly frames: number;
}

/**
 * Parses a `done.json`. Every role must list exactly `frames` files, and the per-frame lists
 * must have `frames` entries. With `expected`, the slot id and frame count must match too.
 */
export function parseDoneSentinel(
  value: unknown,
  expected?: ExpectedSlot,
  path = SENTINEL_NAME,
): ParseResult<DoneSentinel> {
  const record = strict(value, path, [
    "schemaVersion",
    "slot",
    "blender",
    "frames",
    "files",
    "sourceFrames",
    "extentPx",
    "locators",
  ]);
  if (!record.ok) return record;
  const version = parseSchemaVersion(
    record.value.schemaVersion,
    SUPPORTED_SCHEMA_VERSIONS,
    `${path}.schemaVersion`,
  );
  if (!version.ok) return version;
  const slot = parseString(record.value.slot, `${path}.slot`);
  if (!slot.ok) return slot;
  const blender = parsePin(record.value.blender, `${path}.blender`);
  if (!blender.ok) return blender;
  const frames = parseNonNegativeInteger(record.value.frames, `${path}.frames`);
  if (!frames.ok) return frames;
  if (frames.value < 1)
    return fail(`${path}.frames`, "expected at least one frame");
  if (expected !== undefined) {
    if (slot.value !== expected.slot) {
      return fail(
        `${path}.slot`,
        `expected slot "${expected.slot}", got "${slot.value}"`,
      );
    }
    if (frames.value !== expected.frames) {
      return fail(
        `${path}.frames`,
        `expected ${expected.frames} frames, got ${frames.value}`,
      );
    }
  }

  const roles = strict(record.value.files, `${path}.files`, RENDER_ROLES);
  if (!roles.ok) return roles;
  const files = {} as Record<RenderRole, readonly SentinelFile[]>;
  const names = new Set<string>();
  for (const role of RENDER_ROLES) {
    const list = parseArray(
      roles.value[role],
      `${path}.files.${role}`,
      parseSentinelFile,
    );
    if (!list.ok) return list;
    if (list.value.length !== frames.value) {
      return fail(
        `${path}.files.${role}`,
        `lists ${list.value.length} files for ${frames.value} frames`,
      );
    }
    for (const [index, file] of list.value.entries()) {
      if (names.has(file.name)) {
        return fail(
          `${path}.files.${role}[${index}].name`,
          `duplicate file "${file.name}"`,
        );
      }
      names.add(file.name);
    }
    files[role] = list.value;
  }

  const sourceFrames = parseArray(
    record.value.sourceFrames,
    `${path}.sourceFrames`,
    parseFiniteNumber,
  );
  if (!sourceFrames.ok) return sourceFrames;
  const extentPx = parseArray(
    record.value.extentPx,
    `${path}.extentPx`,
    parseExtent,
  );
  if (!extentPx.ok) return extentPx;
  const locators = parseArray(
    record.value.locators,
    `${path}.locators`,
    parseLocators,
  );
  if (!locators.ok) return locators;
  for (const [key, list] of [
    ["sourceFrames", sourceFrames.value],
    ["extentPx", extentPx.value],
    ["locators", locators.value],
  ] as const) {
    if (list.length !== frames.value) {
      return fail(
        `${path}.${key}`,
        `lists ${list.length} entries for ${frames.value} frames`,
      );
    }
  }
  return ok({
    schemaVersion: 1,
    slot: slot.value,
    blender: blender.value,
    frames: frames.value,
    files,
    sourceFrames: sourceFrames.value,
    extentPx: extentPx.value,
    locators: locators.value,
  });
}

/** The sentinel as the script writes it. */
export function renderDoneJson(sentinel: DoneSentinel): string {
  return `${JSON.stringify(sentinel, null, 2)}\n`;
}
