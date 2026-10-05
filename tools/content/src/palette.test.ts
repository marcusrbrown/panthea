// The palette reader against real files: the committed master draft, and temp
// content roots written from the fixture palette.

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { committedVocabulary, paletteFixture } from "@panthea/assets/fixtures";
import { readPalette } from "./palette";

const COMMITTED = join(import.meta.dir, "..", "..", "..", "content", "greek");
const FAMILIES = committedVocabulary().paletteFamilies;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

type Files = ReturnType<typeof paletteFixture>["files"];

/** A content root whose palette/ holds the given file texts. */
function rootWith(files: Files): string {
  const dir = mkdtempSync(join(tmpdir(), "palette-reader-"));
  dirs.push(dir);
  mkdirSync(join(dir, "palette"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, "palette", name), text);
  }
  return dir;
}
const fixtureRoot = (status: "draft" | "approved" = "approved") =>
  rootWith(paletteFixture(status).files);

const diagnostics = (root: string) => {
  const read = readPalette(root, FAMILIES);
  if (read.ok) throw new Error("expected diagnostics");
  return read.diagnostics;
};

describe("reading the palette files", () => {
  it("reads the committed master palette", () => {
    const read = readPalette(COMMITTED, FAMILIES);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.palette.id).toBe("greek-master");
    expect(read.palette.colours).toHaveLength(48);
    expect(read.palette.families.map((f) => f.id)).toEqual([...FAMILIES]);
  });

  it("reads a draft and an approved palette with their status", () => {
    for (const status of ["draft", "approved"] as const) {
      const read = readPalette(fixtureRoot(status), FAMILIES);
      expect(read.ok && read.palette.approval.status).toBe(status);
    }
  });

  it("names each missing file", () => {
    for (const name of ["palette.json", "master.gpl", "master.hex"] as const) {
      const root = fixtureRoot();
      rmSync(join(root, "palette", name));
      expect(diagnostics(root)).toEqual([
        { file: `palette/${name}`, message: "file is missing" },
      ]);
    }
    const none = mkdtempSync(join(tmpdir(), "palette-reader-"));
    dirs.push(none);
    expect(diagnostics(none).map((d) => d.file)).toEqual([
      "palette/palette.json",
      "palette/master.gpl",
      "palette/master.hex",
    ]);
  });

  it("reports JSON that does not parse", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "palette", "palette.json"), "{ nope");
    expect(diagnostics(root)).toEqual([
      { file: "palette/palette.json", message: "not valid JSON" },
    ]);
  });

  it("locates a list problem in the file that has it", () => {
    const files = paletteFixture().files;
    const hex = rootWith({
      ...files,
      "master.hex": files["master.hex"].replace("\n", "\n\n"),
    });
    expect(diagnostics(hex)).toEqual([
      {
        file: "palette/master.hex",
        message: expect.stringContaining("line 2"),
      },
    ]);
    const gpl = rootWith({
      ...files,
      "master.gpl": files["master.gpl"].replace("GIMP Palette", "GIMP palette"),
    });
    expect(diagnostics(gpl)).toEqual([
      {
        file: "palette/master.gpl",
        message: expect.stringContaining("GIMP Palette"),
      },
    ]);
  });

  it("locates a JSON problem with its path inside the file", () => {
    const files = paletteFixture().files;
    const json = JSON.parse(files["palette.json"]);
    json.families[1].id = "elysium";
    const unknown = rootWith({
      ...files,
      "palette.json": JSON.stringify(json),
    });
    expect(diagnostics(unknown)).toEqual([
      {
        file: "palette/palette.json",
        message: 'families[1]: unknown family "elysium"',
      },
    ]);

    const edited = JSON.parse(files["palette.json"]);
    edited.families[0].ramps[0].shades[0] =
      edited.families[0].ramps[0].shades[1];
    const tampered = rootWith({
      ...files,
      "palette.json": JSON.stringify(edited),
    });
    expect(diagnostics(tampered)[0]).toMatchObject({
      file: "palette/palette.json",
      message: expect.stringContaining("duplicate colour"),
    });
  });

  it("refuses an approved palette whose data changed after approval", () => {
    const files = paletteFixture().files;
    const json = JSON.parse(files["palette.json"]);
    json.id = "renamed-master";
    const root = rootWith({ ...files, "palette.json": JSON.stringify(json) });
    expect(diagnostics(root)[0]).toMatchObject({
      file: "palette/palette.json",
      message: expect.stringContaining("approval.digest"),
    });
  });
});
