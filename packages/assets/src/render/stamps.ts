// The authored stamp set (R4): small PNGs drawn on top of a rendered figure where the render
// cannot show a detail, composited by the post step with part-id and depth occlusion. A bolt
// stamp exists at the eight 45-degree orientations of the held thunderbolt; a face stamp is the
// eye pixel and brow of one facing, placed by the projected eye locator.
//
// `tools/render/stamps/stamps.json` lists every file with its size, anchor and sha256;
// `validate:assets` runs `checkStamps` against it. Files on disk and entries must match both
// ways. Everything fails closed: a missing file, a changed byte, a size or anchor that is not
// what the manifest says, or a stamp with nothing in it is a problem, never a skipped stamp.
//
// Node/Bun module: it reads the stamp files from disk.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  fail,
  isRecord,
  ok,
  type ParseResult,
  parseArray,
  parseEnum,
  parseSchemaVersion,
  parseSha256,
  parseSlug,
  parseString,
  type Sha256,
} from "@panthea/contracts";
import type { Rgb } from "../conformance";
import { sha256Hex } from "../hash";
import { decodePng } from "../studio/png/decode";

const SUPPORTED_SCHEMA_VERSIONS = [1] as const;
const HEX_COLOUR = /^#[0-9a-f]{6}$/;

/** The eight orientations of the bolt stamp: degrees counter-clockwise from screen right. */
export const BOLT_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const;
export type BoltAngle = (typeof BOLT_ANGLES)[number];

/** The facings that carry a face stamp, and the eye slots each one draws. North shows no face. */
export const FACE_SLOTS = {
  south: ["l", "r"],
  east: ["near"],
  west: ["near"],
} as const;
export type FaceFacing = keyof typeof FACE_SLOTS;
const FACE_FACINGS = Object.keys(FACE_SLOTS) as FaceFacing[];

interface VariantFile {
  /** POSIX path relative to the stamps directory. */
  readonly file: string;
  readonly sha256: Sha256;
  /** Width and height in pixels. */
  readonly size: readonly [number, number];
  /** The pixel of the stamp that sits on the locator. */
  readonly anchor: readonly [number, number];
}

export interface BoltVariant extends VariantFile {
  readonly angle: BoltAngle;
}

export interface FaceVariant extends VariantFile {
  readonly facing: FaceFacing;
  readonly slot: string;
}

export interface StampSet {
  readonly id: string;
  /** The palette whose colours the stamps are authored in. */
  readonly palette: string;
  readonly bolt?: {
    /** The stamp's own darkest outline colour: its pixels of this colour are the bolt's rim. */
    readonly outline: Rgb;
    readonly variants: readonly BoltVariant[];
  };
  readonly face?: { readonly variants: readonly FaceVariant[] };
}

export interface StampManifest {
  readonly schemaVersion: 1;
  readonly sets: readonly StampSet[];
}

export interface StampPixel {
  readonly x: number;
  readonly y: number;
  readonly rgb: Rgb;
}

export interface LoadedStamp {
  readonly anchor: readonly [number, number];
  readonly pixels: readonly StampPixel[];
}

export interface LoadedBoltStamp {
  readonly anchor: readonly [number, number];
  /** Pixels that are not the rim colour. */
  readonly core: readonly StampPixel[];
  /** Pixels of the rim colour: drawn only where they lie on the body. */
  readonly outline: readonly StampPixel[];
}

export interface LoadedStampSet {
  readonly id: string;
  /** By orientation in degrees. */
  readonly bolt?: ReadonlyMap<number, LoadedBoltStamp>;
  /** By `facing/slot`. */
  readonly face?: ReadonlyMap<string, LoadedStamp>;
}

export interface StampProblem {
  /** `stamps/stamps.json`, or a path under the render root. */
  readonly file: string;
  readonly message: string;
}

export interface StampCheck {
  readonly problems: readonly StampProblem[];
}

// --- Parsing -------------------------------------------------------------------

function parseRelativePath(value: unknown, path: string): ParseResult<string> {
  const text = parseString(value, path);
  if (!text.ok) return text;
  const segments = text.value.split("/");
  if (
    text.value.includes("\\") ||
    segments.some((s) => s === "" || s === "." || s === "..")
  ) {
    return fail(
      path,
      "expected a relative POSIX path without empty, . or .. segments",
    );
  }
  return text;
}

function parsePair(
  value: unknown,
  path: string,
  min: number,
): ParseResult<readonly [number, number]> {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((v) => Number.isInteger(v) && v >= min)
  ) {
    return fail(path, `expected two integers, each at least ${min}`);
  }
  return ok([value[0], value[1]] as const);
}

function parseVariantFile(
  value: Record<string, unknown>,
  path: string,
): ParseResult<VariantFile> {
  const file = parseRelativePath(value.file, `${path}.file`);
  if (!file.ok) return file;
  const sha256 = parseSha256(value.sha256, `${path}.sha256`);
  if (!sha256.ok) return sha256;
  const size = parsePair(value.size, `${path}.size`, 1);
  if (!size.ok) return size;
  const anchor = parsePair(value.anchor, `${path}.anchor`, 0);
  if (!anchor.ok) return anchor;
  if (anchor.value[0] >= size.value[0] || anchor.value[1] >= size.value[1]) {
    return fail(`${path}.anchor`, "expected an anchor inside the stamp");
  }
  return ok({
    file: file.value,
    sha256: sha256.value,
    size: size.value,
    anchor: anchor.value,
  });
}

function parseBoltVariant(
  value: unknown,
  path: string,
): ParseResult<BoltVariant> {
  if (!isRecord(value)) return fail(path, "expected a bolt variant");
  const angle = value.angle;
  if (!BOLT_ANGLES.includes(angle as BoltAngle)) {
    return fail(`${path}.angle`, `expected one of ${BOLT_ANGLES.join(", ")}`);
  }
  const file = parseVariantFile(value, path);
  if (!file.ok) return file;
  return ok({ ...file.value, angle: angle as BoltAngle });
}

function parseFaceVariant(
  value: unknown,
  path: string,
): ParseResult<FaceVariant> {
  if (!isRecord(value)) return fail(path, "expected a face variant");
  const facing = parseEnum(value.facing, `${path}.facing`, FACE_FACINGS);
  if (!facing.ok) return facing;
  const slot = parseEnum(value.slot, `${path}.slot`, [
    ...FACE_SLOTS[facing.value],
  ] as readonly string[]);
  if (!slot.ok) return slot;
  const file = parseVariantFile(value, path);
  if (!file.ok) return file;
  return ok({ ...file.value, facing: facing.value, slot: slot.value });
}

function parseHexColour(value: unknown, path: string): ParseResult<Rgb> {
  if (typeof value !== "string" || !HEX_COLOUR.test(value)) {
    return fail(path, "expected a lowercase #rrggbb colour");
  }
  return ok([
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ] as const);
}

function parseSet(value: unknown, path: string): ParseResult<StampSet> {
  if (!isRecord(value)) return fail(path, "expected a stamp set");
  const id = parseSlug(value.id, `${path}.id`);
  if (!id.ok) return id;
  const palette = parseSlug(value.palette, `${path}.palette`);
  if (!palette.ok) return palette;

  let bolt: StampSet["bolt"];
  if (value.bolt !== undefined) {
    if (!isRecord(value.bolt))
      return fail(`${path}.bolt`, "expected an object");
    const outline = parseHexColour(value.bolt.outline, `${path}.bolt.outline`);
    if (!outline.ok) return outline;
    const variants = parseArray(
      value.bolt.variants,
      `${path}.bolt.variants`,
      parseBoltVariant,
    );
    if (!variants.ok) return variants;
    const present = new Set(variants.value.map((v) => v.angle));
    if (present.size !== variants.value.length) {
      return fail(`${path}.bolt.variants`, "expected one variant per angle");
    }
    const absent = BOLT_ANGLES.filter((a) => !present.has(a));
    if (absent.length > 0) {
      return fail(
        `${path}.bolt.variants`,
        `expected all eight orientations; missing ${absent.join(", ")}`,
      );
    }
    bolt = { outline: outline.value, variants: variants.value };
  }

  let face: StampSet["face"];
  if (value.face !== undefined) {
    if (!isRecord(value.face))
      return fail(`${path}.face`, "expected an object");
    const variants = parseArray(
      value.face.variants,
      `${path}.face.variants`,
      parseFaceVariant,
    );
    if (!variants.ok) return variants;
    const keys = variants.value.map((v) => `${v.facing}/${v.slot}`);
    if (new Set(keys).size !== keys.length) {
      return fail(
        `${path}.face.variants`,
        "expected one variant per facing and slot",
      );
    }
    const wanted = FACE_FACINGS.flatMap((f) =>
      FACE_SLOTS[f].map((s) => `${f}/${s}`),
    );
    const absent = wanted.filter((k) => !keys.includes(k));
    if (absent.length > 0) {
      return fail(
        `${path}.face.variants`,
        `expected every facing and slot; missing ${absent.join(", ")}`,
      );
    }
    face = { variants: variants.value };
  }

  return ok({
    id: id.value,
    palette: palette.value,
    ...(bolt === undefined ? {} : { bolt }),
    ...(face === undefined ? {} : { face }),
  });
}

export function parseStampManifest(value: unknown): ParseResult<StampManifest> {
  if (!isRecord(value)) return fail("stamps.json", "expected an object");
  const version = parseSchemaVersion(
    value.schemaVersion,
    SUPPORTED_SCHEMA_VERSIONS,
    "stamps.json.schemaVersion",
  );
  if (!version.ok) return version;
  const sets = parseArray(value.sets, "stamps.json.sets", parseSet);
  if (!sets.ok) return sets;
  const ids = sets.value.map((s) => s.id);
  if (new Set(ids).size !== ids.length) {
    return fail("stamps.json.sets", "expected unique set ids");
  }
  const files = sets.value.flatMap((s) => [
    ...(s.bolt?.variants ?? []).map((v) => v.file),
    ...(s.face?.variants ?? []).map((v) => v.file),
  ]);
  if (new Set(files).size !== files.length) {
    return fail("stamps.json.sets", "expected each stamp file listed once");
  }
  return ok({ schemaVersion: 1, sets: sets.value });
}

// --- Reading -------------------------------------------------------------------

const MANIFEST_FILE = "stamps.json";

/** Every file under `dir`, as POSIX paths relative to it. Symlinks are not followed. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(dir, relative), {
      withFileTypes: true,
    })) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  if (existsSync(dir)) walk("");
  return found.sort();
}

type ManifestRead =
  | { readonly ok: true; readonly manifest: StampManifest }
  | { readonly ok: false; readonly problem: StampProblem };

function readManifest(renderRoot: string): ManifestRead {
  const file = `stamps/${MANIFEST_FILE}`;
  const path = join(renderRoot, "stamps", MANIFEST_FILE);
  if (!existsSync(path)) {
    return { ok: false, problem: { file, message: "stamps.json is missing" } };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {
      ok: false,
      problem: { file, message: "stamps.json is not valid JSON" },
    };
  }
  const parsed = parseStampManifest(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      problem: { file, message: `${parsed.path}: ${parsed.message}` },
    };
  }
  return { ok: true, manifest: parsed.value };
}

type VariantRead =
  | {
      readonly ok: true;
      readonly width: number;
      readonly height: number;
      readonly pixels: readonly StampPixel[];
    }
  | { readonly ok: false; readonly problem: StampProblem };

/** One stamp file against its manifest entry: present, hashed, a PNG of the declared size, not empty. */
function readVariant(renderRoot: string, entry: VariantFile): VariantRead {
  const file = `stamps/${entry.file}`;
  const path = join(renderRoot, "stamps", entry.file);
  if (!existsSync(path) || !statSync(path).isFile()) {
    return {
      ok: false,
      problem: {
        file,
        message: "is listed in stamps.json but missing on disk",
      },
    };
  }
  const bytes = readFileSync(path);
  if (sha256Hex(bytes) !== entry.sha256) {
    return {
      ok: false,
      problem: { file, message: "sha256 differs from stamps.json" },
    };
  }
  const decoded = decodePng(new Uint8Array(bytes));
  if (!decoded.ok) {
    return { ok: false, problem: { file, message: decoded.message } };
  }
  const { width, height, rgba } = decoded.image;
  if (width !== entry.size[0] || height !== entry.size[1]) {
    return {
      ok: false,
      problem: {
        file,
        message: `is ${width}x${height}, but stamps.json declares ${entry.size[0]}x${entry.size[1]}`,
      },
    };
  }
  const pixels: StampPixel[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      if (rgba[at + 3] !== 0) {
        pixels.push({
          x,
          y,
          rgb: [
            rgba[at] as number,
            rgba[at + 1] as number,
            rgba[at + 2] as number,
          ],
        });
      }
    }
  }
  if (pixels.length === 0) {
    return { ok: false, problem: { file, message: "has no opaque pixels" } };
  }
  return { ok: true, width, height, pixels };
}

const variantsOf = (set: StampSet): readonly VariantFile[] => [
  ...(set.bolt?.variants ?? []),
  ...(set.face?.variants ?? []),
];

/**
 * Checks the stamp set under `renderRoot` (the `tools/render` directory): the manifest parses,
 * every listed file is present with its hash, size and a pixel, and no unlisted file is on disk.
 * Never throws on bad data; every failure is a problem.
 */
export function checkStamps(renderRoot: string): StampCheck {
  const read = readManifest(renderRoot);
  if (!read.ok) return { problems: [read.problem] };
  const problems: StampProblem[] = [];
  const listed = new Set<string>([MANIFEST_FILE]);
  for (const set of read.manifest.sets) {
    for (const entry of variantsOf(set)) {
      listed.add(entry.file);
      const result = readVariant(renderRoot, entry);
      if (!result.ok) problems.push(result.problem);
    }
  }
  for (const onDisk of filesUnder(join(renderRoot, "stamps"))) {
    if (!listed.has(onDisk)) {
      problems.push({
        file: `stamps/${onDisk}`,
        message: "is on disk but not in stamps.json",
      });
    }
  }
  return { problems };
}

const sameColour = (a: Rgb, b: Rgb): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Loads one stamp set's pixels, checking each file against the manifest as it goes. */
export function loadStampSet(
  renderRoot: string,
  id: string,
):
  | { readonly ok: true; readonly set: LoadedStampSet }
  | { readonly ok: false; readonly problems: readonly StampProblem[] } {
  const read = readManifest(renderRoot);
  if (!read.ok) return { ok: false, problems: [read.problem] };
  const set = read.manifest.sets.find((s) => s.id === id);
  if (set === undefined) {
    return {
      ok: false,
      problems: [
        {
          file: `stamps/${MANIFEST_FILE}`,
          message: `no stamp set "${id}" in stamps.json`,
        },
      ],
    };
  }
  const problems: StampProblem[] = [];
  let bolt: Map<number, LoadedBoltStamp> | undefined;
  if (set.bolt !== undefined) {
    bolt = new Map();
    for (const variant of set.bolt.variants) {
      const result = readVariant(renderRoot, variant);
      if (!result.ok) {
        problems.push(result.problem);
        continue;
      }
      const rim = set.bolt.outline;
      bolt.set(variant.angle, {
        anchor: variant.anchor,
        core: result.pixels.filter((p) => !sameColour(p.rgb, rim)),
        outline: result.pixels.filter((p) => sameColour(p.rgb, rim)),
      });
    }
  }
  let face: Map<string, LoadedStamp> | undefined;
  if (set.face !== undefined) {
    face = new Map();
    for (const variant of set.face.variants) {
      const result = readVariant(renderRoot, variant);
      if (!result.ok) {
        problems.push(result.problem);
        continue;
      }
      face.set(`${variant.facing}/${variant.slot}`, {
        anchor: variant.anchor,
        pixels: result.pixels,
      });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    set: {
      id: set.id,
      ...(bolt === undefined ? {} : { bolt }),
      ...(face === undefined ? {} : { face }),
    },
  };
}
