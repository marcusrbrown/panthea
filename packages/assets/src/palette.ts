// The master palette: a strict parser over the three files that carry it, and
// the digest an owner approval binds to. Pure over text and JSON values; the
// files are read elsewhere (tools/content).
//
//   master.gpl    GIMP palette, the swatch file an artist loads
//   master.hex    one lowercase rrggbb per line, the plain list
//   palette.json  id, approval, optional limits and the families of ramps
//
// The GPL and HEX lists name the same colours in the same order. Every ramp
// shade is one of them. GPL colour names are cosmetic and not part of the
// digest.
//
// A palette is one version of the art direction and may declare its own limits
// (`limits`: the shade bounds of a ramp and the most colours a sprite or
// portrait keeps). Declared limits are part of the digest an approval binds
// to. A palette that declares none keeps the legacy rules, 4-5 shades, 16
// colours per sprite and 32 per portrait, and its digest is computed as it
// always was. A palette lives in a directory named by its id; `greek-master`
// is the palette root and any other id a subdirectory of it.

import {
  ASSET_SCHEMA_VERSIONS,
  canonicalJson,
  fail,
  ok,
  type ParseResult,
  parseArray,
  parseIntegerAtLeast,
  parseSchemaVersion,
  parseSha256,
  parseSlug,
  parseStrictRecord,
  type Range,
  type Sha256,
} from "@panthea/contracts";
import type { Rgb } from "./conformance";
import { sha256Hex } from "./hash";

export type PaletteApproval =
  | { readonly status: "draft" }
  | { readonly status: "approved"; readonly digest: Sha256 };

export interface PaletteRamp {
  readonly id: string;
  readonly shades: readonly Rgb[];
}

export interface PaletteFamily {
  readonly id: string;
  readonly ramps: readonly PaletteRamp[];
}

/** What a palette version allows: ramp length, and the most colours one sprite or portrait keeps. */
export interface PaletteLimits {
  readonly shades: Range;
  readonly colours: {
    readonly sprite: number;
    /** Absent means the legacy portrait limit. */
    readonly portrait?: number;
  };
}

export interface Palette {
  readonly id: string;
  readonly approval: PaletteApproval;
  /** Declared limits; absent means the legacy rules (`LEGACY_PALETTE_LIMITS`). */
  readonly limits?: PaletteLimits;
  /** The master list, in file order. */
  readonly colours: readonly Rgb[];
  readonly families: readonly PaletteFamily[];
}

export interface PaletteSource {
  /** Parsed palette.json. */
  readonly json: unknown;
  readonly gpl: string;
  readonly hex: string;
}

/** The id of the first palette; its files are the palette root. */
export const MASTER_PALETTE_ID = "greek-master";

/** The directory under the palette root that holds a palette's files: none for `greek-master`, the id for any other. */
export const paletteSubdirectory = (id: string): string =>
  id === MASTER_PALETTE_ID ? "" : id;

/** The palettes of a content root by id. */
export type PaletteSet = ReadonlyMap<string, Palette>;

const MAX_COLOURS = 64;
/** Bounds on what a palette may declare for ramp length. */
const DECLARABLE_MIN_SHADES = 2;
const DECLARABLE_MAX_SHADES = 8;

/** The rules a palette that declares no limits has always had. */
export const LEGACY_PALETTE_LIMITS = {
  shades: { min: 4, max: 5 },
  colours: { sprite: 16, portrait: 32 },
} as const;

/** Fewest and most shades a ramp of this palette takes. */
export const shadeBounds = (palette: Pick<Palette, "limits">): Range =>
  palette.limits?.shades ?? LEGACY_PALETTE_LIMITS.shades;

/** Most colours one sprite or portrait may keep under this palette. */
export const colourLimit = (
  palette: Pick<Palette, "limits">,
  kind: "sprite" | "portrait",
): number =>
  kind === "sprite"
    ? (palette.limits?.colours.sprite ?? LEGACY_PALETTE_LIMITS.colours.sprite)
    : (palette.limits?.colours.portrait ??
      LEGACY_PALETTE_LIMITS.colours.portrait);

const JSON_FILE = "palette.json";
const GPL_FILE = "master.gpl";
const HEX_FILE = "master.hex";

const rrggbb = (rgb: Rgb): string =>
  rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
const hashed = (rgb: Rgb): string => `#${rrggbb(rgb)}`;

const HEX_LINE = /^[0-9a-f]{6}$/;
const SHADE = /^#[0-9a-f]{6}$/;
const GPL_ENTRY = /^\s*(\d+)\s+(\d+)\s+(\d+)(?:\s.*)?$/;
const GPL_SKIPPED = /^(\s*|#.*|Name:.*|Columns:.*)$/;

function parseHexList(text: string): ParseResult<readonly Rgb[]> {
  const lines = text.split("\n");
  if (lines.pop() !== "") {
    return fail(HEX_FILE, "expected the last line to end with a newline");
  }
  if (lines.length === 0) return fail(HEX_FILE, "expected at least one colour");
  const colours: Rgb[] = [];
  for (const [index, line] of lines.entries()) {
    if (!HEX_LINE.test(line)) {
      return fail(
        `${HEX_FILE}:${index + 1}`,
        "expected six lowercase hex digits with no #, and no blank line",
      );
    }
    colours.push([
      Number.parseInt(line.slice(0, 2), 16),
      Number.parseInt(line.slice(2, 4), 16),
      Number.parseInt(line.slice(4, 6), 16),
    ]);
  }
  return ok(colours);
}

function parseGplList(text: string): ParseResult<readonly Rgb[]> {
  const lines = text.split("\n");
  if (lines[0] !== "GIMP Palette") {
    return fail(`${GPL_FILE}:1`, 'expected the first line "GIMP Palette"');
  }
  const colours: Rgb[] = [];
  for (const [index, line] of lines.entries()) {
    if (index === 0 || GPL_SKIPPED.test(line)) continue;
    const match = GPL_ENTRY.exec(line);
    if (match === null) {
      return fail(`${GPL_FILE}:${index + 1}`, "expected R G B and a name");
    }
    const channels = [match[1], match[2], match[3]].map(Number);
    if (channels.some((v) => v > 255)) {
      return fail(`${GPL_FILE}:${index + 1}`, "channels are 0-255");
    }
    colours.push(channels as unknown as Rgb);
  }
  return ok(colours);
}

/** The master list: HEX and GPL agree, 1-64 colours, none repeated. */
function parseMaster(source: PaletteSource): ParseResult<readonly Rgb[]> {
  const hex = parseHexList(source.hex);
  if (!hex.ok) return hex;
  const gpl = parseGplList(source.gpl);
  if (!gpl.ok) return gpl;
  if (hex.value.length > MAX_COLOURS) {
    return fail(
      HEX_FILE,
      `${hex.value.length} colours; a master palette has at most ${MAX_COLOURS}`,
    );
  }
  const seen = new Set<string>();
  for (const [index, colour] of hex.value.entries()) {
    const key = rrggbb(colour);
    if (seen.has(key)) {
      return fail(`${HEX_FILE}:${index + 1}`, `duplicate colour ${key}`);
    }
    seen.add(key);
  }
  if (gpl.value.length !== hex.value.length) {
    return fail(
      GPL_FILE,
      `${gpl.value.length} colours, but ${HEX_FILE} has ${hex.value.length}`,
    );
  }
  for (const [index, colour] of hex.value.entries()) {
    if (rrggbb(gpl.value[index] as Rgb) !== rrggbb(colour)) {
      return fail(
        `${GPL_FILE}[${index}]`,
        `${hashed(gpl.value[index] as Rgb)} where ${HEX_FILE} has ${hashed(colour)}`,
      );
    }
  }
  return ok(hex.value);
}

/**
 * Digest of what an approval covers: id, master list, ramps and, when the
 * palette declares them, its limits. GPL names are not part of it. A palette
 * without declared limits digests exactly as it did before limits existed.
 */
export function paletteDigest(
  palette: Pick<Palette, "id" | "colours" | "families" | "limits">,
): Sha256 {
  return sha256Hex(
    new TextEncoder().encode(
      canonicalJson({
        id: palette.id,
        colours: palette.colours.map(hashed),
        ...(palette.limits === undefined
          ? {}
          : {
              limits: {
                shades: palette.limits.shades,
                colours: palette.limits.colours,
              },
            }),
        families: palette.families.map((family) => ({
          id: family.id,
          ramps: family.ramps.map((ramp) => ({
            id: ramp.id,
            shades: ramp.shades.map(hashed),
          })),
        })),
      }),
    ),
  );
}

function parseApproval(
  value: unknown,
  path: string,
): ParseResult<PaletteApproval> {
  return parseStrictRecord(
    value,
    path,
    ["status", "digest"],
    (record): ParseResult<PaletteApproval> => {
      if (record.status === "draft") {
        return "digest" in record
          ? fail(`${path}.digest`, "a draft has no digest")
          : ok({ status: "draft" });
      }
      if (record.status === "approved") {
        const digest = parseSha256(record.digest, `${path}.digest`);
        return digest.ok
          ? ok({ status: "approved", digest: digest.value })
          : digest;
      }
      return fail(`${path}.status`, 'expected "draft" or "approved"');
    },
  );
}

function parseRamp(
  value: unknown,
  path: string,
  master: ReadonlySet<string>,
  bounds: Range,
): ParseResult<PaletteRamp> {
  return parseStrictRecord(value, path, ["id", "shades"], (record) => {
    const id = parseSlug(record.id, `${path}.id`);
    if (!id.ok) return id;
    const shades = parseArray(
      record.shades,
      `${path}.shades`,
      (shade, shadePath): ParseResult<Rgb> => {
        if (typeof shade !== "string" || !SHADE.test(shade)) {
          return fail(shadePath, "expected #rrggbb in lowercase hex");
        }
        if (!master.has(shade.slice(1))) {
          return fail(shadePath, `${shade} is not in the master list`);
        }
        return ok([
          Number.parseInt(shade.slice(1, 3), 16),
          Number.parseInt(shade.slice(3, 5), 16),
          Number.parseInt(shade.slice(5, 7), 16),
        ]);
      },
    );
    if (!shades.ok) return shades;
    if (shades.value.length < bounds.min || shades.value.length > bounds.max) {
      return fail(
        `${path}.shades`,
        bounds.max === bounds.min
          ? `expected ${bounds.min} shades, got ${shades.value.length}`
          : `expected ${bounds.min} to ${bounds.max} shades, got ${shades.value.length}`,
      );
    }
    return ok({ id: id.value, shades: shades.value });
  });
}

function parseFamily(
  value: unknown,
  path: string,
  master: ReadonlySet<string>,
  bounds: Range,
): ParseResult<PaletteFamily> {
  return parseStrictRecord(value, path, ["id", "ramps"], (record) => {
    const id = parseSlug(record.id, `${path}.id`);
    if (!id.ok) return id;
    const ramps = parseArray(record.ramps, `${path}.ramps`, (ramp, rampPath) =>
      parseRamp(ramp, rampPath, master, bounds),
    );
    if (!ramps.ok) return ramps;
    if (ramps.value.length === 0) {
      return fail(`${path}.ramps`, "expected at least one ramp");
    }
    // A colour may serve several families but appear once within one.
    const rampIds = new Set<string>();
    const colours = new Set<string>();
    for (const [r, ramp] of ramps.value.entries()) {
      if (rampIds.has(ramp.id)) {
        return fail(`${path}.ramps[${r}]`, `duplicate ramp id "${ramp.id}"`);
      }
      rampIds.add(ramp.id);
      for (const [s, shade] of ramp.shades.entries()) {
        const key = hashed(shade);
        if (colours.has(key)) {
          return fail(
            `${path}.ramps[${r}].shades[${s}]`,
            `duplicate colour ${key} in family "${id.value}"`,
          );
        }
        colours.add(key);
      }
    }
    return ok({ id: id.value, ramps: ramps.value });
  });
}

function parseShadeBounds(value: unknown, path: string): ParseResult<Range> {
  return parseStrictRecord(value, path, ["min", "max"], (record) => {
    const min = parseIntegerAtLeast(
      record.min,
      `${path}.min`,
      DECLARABLE_MIN_SHADES,
    );
    if (!min.ok) return min;
    const max = parseIntegerAtLeast(record.max, `${path}.max`, min.value);
    if (!max.ok) return max;
    if (max.value > DECLARABLE_MAX_SHADES)
      return fail(
        `${path}.max`,
        `expected at most ${DECLARABLE_MAX_SHADES} shades`,
      );
    return ok({ min: min.value, max: max.value });
  });
}

function parseColourBudget(value: unknown, path: string): ParseResult<number> {
  const budget = parseIntegerAtLeast(value, path, 1);
  if (!budget.ok) return budget;
  if (budget.value > MAX_COLOURS)
    return fail(path, `expected at most the ${MAX_COLOURS}-colour master cap`);
  return budget;
}

function parseLimits(value: unknown, path: string): ParseResult<PaletteLimits> {
  return parseStrictRecord(value, path, ["shades", "colours"], (record) => {
    const shades = parseShadeBounds(record.shades, `${path}.shades`);
    if (!shades.ok) return shades;
    const colours = parseStrictRecord(
      record.colours,
      `${path}.colours`,
      ["sprite", "portrait"],
      (c): ParseResult<PaletteLimits["colours"]> => {
        const sprite = parseColourBudget(c.sprite, `${path}.colours.sprite`);
        if (!sprite.ok) return sprite;
        if (c.portrait === undefined) return ok({ sprite: sprite.value });
        const portrait = parseColourBudget(
          c.portrait,
          `${path}.colours.portrait`,
        );
        return portrait.ok
          ? ok({ sprite: sprite.value, portrait: portrait.value })
          : portrait;
      },
    );
    if (!colours.ok) return colours;
    return ok({ shades: shades.value, colours: colours.value });
  });
}

/**
 * Parses the three palette files into a palette whose families are exactly
 * `familyIds`. An approved palette must carry the digest of its own current
 * data, so editing a colour or ramp after approval fails the parse.
 */
export function parsePalette(
  source: PaletteSource,
  familyIds: readonly string[],
): ParseResult<Palette> {
  const master = parseMaster(source);
  if (!master.ok) return master;
  const keys = new Set(master.value.map(rrggbb));
  return parseStrictRecord(
    source.json,
    JSON_FILE,
    ["schemaVersion", "id", "approval", "limits", "families"],
    (record) => {
      const version = parseSchemaVersion(
        record.schemaVersion,
        ASSET_SCHEMA_VERSIONS,
        `${JSON_FILE}.schemaVersion`,
      );
      if (!version.ok) return version;
      const id = parseSlug(record.id, `${JSON_FILE}.id`);
      if (!id.ok) return id;
      const approval = parseApproval(record.approval, `${JSON_FILE}.approval`);
      if (!approval.ok) return approval;
      let limits: PaletteLimits | undefined;
      if (record.limits !== undefined) {
        const parsed = parseLimits(record.limits, `${JSON_FILE}.limits`);
        if (!parsed.ok) return parsed;
        limits = parsed.value;
      }
      const families = parseArray(
        record.families,
        `${JSON_FILE}.families`,
        (family, path) =>
          parseFamily(family, path, keys, shadeBounds({ limits })),
      );
      if (!families.ok) return families;
      const seen = new Set<string>();
      for (const [index, family] of families.value.entries()) {
        const path = `${JSON_FILE}.families[${index}]`;
        if (seen.has(family.id)) {
          return fail(path, `duplicate family "${family.id}"`);
        }
        if (!familyIds.includes(family.id)) {
          return fail(path, `unknown family "${family.id}"`);
        }
        seen.add(family.id);
      }
      for (const family of familyIds) {
        if (!seen.has(family)) {
          return fail(`${JSON_FILE}.families`, `missing family "${family}"`);
        }
      }
      const palette: Palette = {
        id: id.value,
        approval: approval.value,
        ...(limits === undefined ? {} : { limits }),
        colours: master.value,
        families: families.value,
      };
      if (
        palette.approval.status === "approved" &&
        palette.approval.digest !== paletteDigest(palette)
      ) {
        return fail(
          `${JSON_FILE}.approval.digest`,
          "does not match this palette's id, colours, ramps and limits",
        );
      }
      return ok(palette);
    },
  );
}
