// Reads the palettes under a content root. A palette is three files, in a
// directory named by its id: `greek-master` is the palette root itself, any
// other palette a subdirectory.
//
//   <root>/palette/palette.json                 greek-master: id, approval, limits, families
//   <root>/palette/master.gpl                   GIMP palette
//   <root>/palette/master.hex                   one rrggbb per line
//   <root>/palette/<id>/{palette.json,master.gpl,master.hex}   any other palette
//
// Parsing is @panthea/assets' parsePalette; this adds the filesystem and turns
// a parse failure into a diagnostic located in the file that has the problem.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MASTER_PALETTE_ID,
  type Palette,
  type PaletteSet,
  paletteSubdirectory,
  parsePalette,
} from "@panthea/assets";

export interface PaletteDiagnostic {
  /** Path relative to the content root. */
  readonly file: string;
  readonly message: string;
}

export type PaletteRead =
  | { readonly ok: true; readonly palette: Palette }
  | { readonly ok: false; readonly diagnostics: readonly PaletteDiagnostic[] };

export type PaletteSetRead =
  | { readonly ok: true; readonly palettes: PaletteSet }
  | { readonly ok: false; readonly diagnostics: readonly PaletteDiagnostic[] };

const FILES = ["palette.json", "master.gpl", "master.hex"] as const;

/** `master.hex:3` -> "line 3: ..."; `palette.json.families[0]` -> "families[0]: ...". */
function located(
  dir: string,
  path: string,
  message: string,
): PaletteDiagnostic {
  const name = FILES.find((file) => path.startsWith(file)) ?? FILES[0];
  const rest = path.slice(name.length);
  const where = rest.startsWith(":")
    ? `line ${rest.slice(1)}: `
    : rest === ""
      ? ""
      : `${rest.replace(/^\./, "")}: `;
  return { file: `${dir}${name}`, message: `${where}${message}` };
}

/**
 * Reads the palette in `<root>/palette/<subdirectory>` ("" is the palette
 * root). A palette in a subdirectory must declare the directory's name as its
 * id; the root palette is keyed by whatever id it declares.
 */
function readIn(
  contentRoot: string,
  subdirectory: string,
  familyIds: readonly string[],
): PaletteRead {
  const dir = subdirectory === "" ? "palette/" : `palette/${subdirectory}/`;
  const diagnostics: PaletteDiagnostic[] = [];
  const text = new Map<string, string>();
  for (const name of FILES) {
    const path = join(contentRoot, dir, name);
    if (existsSync(path)) text.set(name, readFileSync(path, "utf8"));
    else
      diagnostics.push({ file: `${dir}${name}`, message: "file is missing" });
  }
  let json: unknown;
  if (text.has("palette.json")) {
    try {
      json = JSON.parse(text.get("palette.json") as string);
    } catch {
      diagnostics.push({
        file: `${dir}palette.json`,
        message: "not valid JSON",
      });
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const parsed = parsePalette(
    {
      json,
      gpl: text.get("master.gpl") as string,
      hex: text.get("master.hex") as string,
    },
    familyIds,
  );
  if (!parsed.ok)
    return {
      ok: false,
      diagnostics: [located(dir, parsed.path, parsed.message)],
    };
  if (subdirectory !== "" && parsed.value.id !== subdirectory)
    return {
      ok: false,
      diagnostics: [
        {
          file: `${dir}palette.json`,
          message: `id: the palette in ${dir} declares "${parsed.value.id}", not "${subdirectory}"`,
        },
      ],
    };
  return { ok: true, palette: parsed.value };
}

/** One palette by id: `greek-master` from the palette root, any other id from its subdirectory. */
export function readPalette(
  contentRoot: string,
  familyIds: readonly string[],
  id: string = MASTER_PALETTE_ID,
): PaletteRead {
  return readIn(contentRoot, paletteSubdirectory(id), familyIds);
}

/** The subdirectories of the palette root, each a palette named by its directory. */
function paletteDirectories(contentRoot: string): string[] {
  const root = join(contentRoot, "palette");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .sort();
}

/** Every palette under a content root, by id: the root palette first, then each subdirectory. All problems are reported together. */
export function readPalettes(
  contentRoot: string,
  familyIds: readonly string[],
): PaletteSetRead {
  const diagnostics: PaletteDiagnostic[] = [];
  const palettes = new Map<string, Palette>();
  for (const subdirectory of ["", ...paletteDirectories(contentRoot)]) {
    const read = readIn(contentRoot, subdirectory, familyIds);
    if (read.ok) palettes.set(read.palette.id, read.palette);
    else diagnostics.push(...read.diagnostics);
  }
  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : { ok: true, palettes };
}
