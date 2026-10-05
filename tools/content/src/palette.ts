// Reads the master palette files under a content root:
//
//   <root>/palette/palette.json   id, approval, families and ramps
//   <root>/palette/master.gpl     GIMP palette
//   <root>/palette/master.hex     one rrggbb per line
//
// Parsing is @panthea/assets' parsePalette; this adds the filesystem and turns
// a parse failure into a diagnostic located in the file that has the problem.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Palette, parsePalette } from "@panthea/assets";

export interface PaletteDiagnostic {
  /** Path relative to the content root. */
  readonly file: string;
  readonly message: string;
}

export type PaletteRead =
  | { readonly ok: true; readonly palette: Palette }
  | { readonly ok: false; readonly diagnostics: readonly PaletteDiagnostic[] };

const FILES = ["palette.json", "master.gpl", "master.hex"] as const;

/** `master.hex:3` -> "line 3: ..."; `palette.json.families[0]` -> "families[0]: ...". */
function located(path: string, message: string): PaletteDiagnostic {
  const name = FILES.find((file) => path.startsWith(file)) ?? FILES[0];
  const rest = path.slice(name.length);
  const where = rest.startsWith(":")
    ? `line ${rest.slice(1)}: `
    : rest === ""
      ? ""
      : `${rest.replace(/^\./, "")}: `;
  return { file: `palette/${name}`, message: `${where}${message}` };
}

export function readPalette(
  contentRoot: string,
  familyIds: readonly string[],
): PaletteRead {
  const diagnostics: PaletteDiagnostic[] = [];
  const text = new Map<string, string>();
  for (const name of FILES) {
    const path = join(contentRoot, "palette", name);
    if (existsSync(path)) text.set(name, readFileSync(path, "utf8"));
    else
      diagnostics.push({ file: `palette/${name}`, message: "file is missing" });
  }
  let json: unknown;
  if (text.has("palette.json")) {
    try {
      json = JSON.parse(text.get("palette.json") as string);
    } catch {
      diagnostics.push({
        file: "palette/palette.json",
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
  return parsed.ok
    ? { ok: true, palette: parsed.value }
    : { ok: false, diagnostics: [located(parsed.path, parsed.message)] };
}
