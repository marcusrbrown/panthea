// The master palette: a strict parser over the three files that carry it, and
// the digest an owner approval binds to. Pure over text and JSON values; the
// files are read elsewhere (tools/content).
//
//   master.gpl    GIMP palette, the swatch file an artist loads
//   master.hex    one lowercase rrggbb per line, the plain list
//   palette.json  id, approval and the families of 4-5 shade ramps
//
// The GPL and HEX lists name the same colours in the same order. Every ramp
// shade is one of them. GPL colour names are cosmetic and not part of the
// digest. Size limits per kind (16 sprite, 32 portrait) belong to conformance,
// not to the master.

import {
  ASSET_SCHEMA_VERSIONS,
  canonicalJson,
  fail,
  ok,
  type ParseResult,
  parseArray,
  parseSchemaVersion,
  parseSha256,
  parseSlug,
  parseStrictRecord,
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

export interface Palette {
  readonly id: string;
  readonly approval: PaletteApproval;
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

const MAX_COLOURS = 64;
const MIN_SHADES = 4;
const MAX_SHADES = 5;

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

/** Digest of what an approval covers: id, master list and ramps. GPL names are not part of it. */
export function paletteDigest(
  palette: Pick<Palette, "id" | "colours" | "families">,
): Sha256 {
  return sha256Hex(
    new TextEncoder().encode(
      canonicalJson({
        id: palette.id,
        colours: palette.colours.map(hashed),
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
    if (shades.value.length < MIN_SHADES || shades.value.length > MAX_SHADES) {
      return fail(
        `${path}.shades`,
        `expected ${MIN_SHADES} or ${MAX_SHADES} shades, got ${shades.value.length}`,
      );
    }
    return ok({ id: id.value, shades: shades.value });
  });
}

function parseFamily(
  value: unknown,
  path: string,
  master: ReadonlySet<string>,
): ParseResult<PaletteFamily> {
  return parseStrictRecord(value, path, ["id", "ramps"], (record) => {
    const id = parseSlug(record.id, `${path}.id`);
    if (!id.ok) return id;
    const ramps = parseArray(record.ramps, `${path}.ramps`, (ramp, rampPath) =>
      parseRamp(ramp, rampPath, master),
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
    ["schemaVersion", "id", "approval", "families"],
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
      const families = parseArray(
        record.families,
        `${JSON_FILE}.families`,
        (family, path) => parseFamily(family, path, keys),
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
        colours: master.value,
        families: families.value,
      };
      if (
        palette.approval.status === "approved" &&
        palette.approval.digest !== paletteDigest(palette)
      ) {
        return fail(
          `${JSON_FILE}.approval.digest`,
          "does not match this palette's id, colours and ramps",
        );
      }
      return ok(palette);
    },
  );
}
