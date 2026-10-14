// The palette reader against real files: the committed master draft, and temp
// content roots written from the fixture palette.

import { afterEach, describe, expect, it } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paletteDigest } from "@panthea/assets";
import { committedVocabulary, paletteFixture } from "@panthea/assets/fixtures";
import { readPalette, readPalettes } from "./palette";

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

describe("reading the palette set", () => {
  /** A content root holding the committed palette tree, copied so each test edits its own. */
  function committedCopy(): string {
    const dir = mkdtempSync(join(tmpdir(), "palette-set-"));
    dirs.push(dir);
    cpSync(join(COMMITTED, "palette"), join(dir, "palette"), {
      recursive: true,
    });
    return dir;
  }
  const setDiagnostics = (root: string) => {
    const read = readPalettes(root, FAMILIES);
    if (read.ok) throw new Error("expected diagnostics");
    return read.diagnostics;
  };

  it("loads greek-master from the palette root and greek-retro from its subdirectory, keyed by id", () => {
    const read = readPalettes(COMMITTED, FAMILIES);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect([...read.palettes.keys()]).toEqual(["greek-master", "greek-retro"]);
    const master = read.palettes.get("greek-master");
    expect(master?.colours).toHaveLength(48);
    expect(String(paletteDigest(master as never))).toBe(
      "faa637b2ce7bd3493f20a7a1b191554640b9a801a6e8fc42f8a985bb07073209",
    );
    const retro = read.palettes.get("greek-retro");
    expect(retro?.colours).toHaveLength(54);
    // Approved on 2026-10-12 against the digest of its id, colours, ramps and limits.
    expect(retro?.approval).toEqual({
      status: "approved",
      digest:
        "40f059ffae86409cd87d776492fd797f5efc6ad970114810fd97102e83e9c686",
    } as never);
  });

  it("loads a root with no subdirectory as a set of one", () => {
    const read = readPalettes(fixtureRoot(), FAMILIES);
    expect(read.ok && [...read.palettes.keys()]).toEqual(["fixture-master"]);
  });

  it("agrees with readPalette on the root palette", () => {
    const single = readPalette(COMMITTED, FAMILIES);
    const set = readPalettes(COMMITTED, FAMILIES);
    expect(single.ok && set.ok && set.palettes.get("greek-master")).toEqual(
      single.ok ? single.palette : undefined,
    );
  });

  it("names a missing file of a subdirectory palette by its path", () => {
    const root = committedCopy();
    rmSync(join(root, "palette", "greek-retro", "master.hex"));
    expect(setDiagnostics(root)).toEqual([
      { file: "palette/greek-retro/master.hex", message: "file is missing" },
    ]);
  });

  it("locates a problem in a subdirectory palette inside its own files", () => {
    const root = committedCopy();
    const file = join(root, "palette", "greek-retro", "master.hex");
    writeFileSync(file, readFileSync(file, "utf8").replace("\n", "\n\n"));
    expect(setDiagnostics(root)).toEqual([
      {
        file: "palette/greek-retro/master.hex",
        message: expect.stringContaining("line 2"),
      },
    ]);
  });

  it("refuses a subdirectory whose palette id is not its name", () => {
    const root = committedCopy();
    const file = join(root, "palette", "greek-retro", "palette.json");
    const json = JSON.parse(readFileSync(file, "utf8"));
    // The approved palette's digest covers its id, so the copy is an explicit draft: the id
    // mismatch is then the only problem.
    writeFileSync(
      file,
      JSON.stringify({
        ...json,
        id: "greek-other",
        approval: { status: "draft" },
      }),
    );
    expect(setDiagnostics(root)).toEqual([
      {
        file: "palette/greek-retro/palette.json",
        message: expect.stringContaining('"greek-other"'),
      },
    ]);
  });

  it("holds each palette to its own limits: greek-retro's 6-shade ramps fail once its declared limits are gone", () => {
    const root = committedCopy();
    const file = join(root, "palette", "greek-retro", "palette.json");
    const { limits: _limits, ...undeclared } = JSON.parse(
      readFileSync(file, "utf8"),
    );
    writeFileSync(file, JSON.stringify(undeclared));
    expect(setDiagnostics(root)).toEqual([
      {
        file: "palette/greek-retro/palette.json",
        message: expect.stringContaining("shades"),
      },
    ]);
    // Positive control: the committed greek-retro holds its 6-shade ramps under its declared limits.
    expect(readPalettes(COMMITTED, FAMILIES).ok).toBe(true);
  });

  it("reports problems in the root and in a subdirectory together", () => {
    const root = committedCopy();
    rmSync(join(root, "palette", "master.gpl"));
    rmSync(join(root, "palette", "greek-retro", "master.gpl"));
    expect(setDiagnostics(root).map((d) => d.file)).toEqual([
      "palette/master.gpl",
      "palette/greek-retro/master.gpl",
    ]);
  });

  it("reads each palette of a set as a single palette too, by id", () => {
    const retro = readPalette(COMMITTED, FAMILIES, "greek-retro");
    expect(retro.ok && retro.palette.id).toBe("greek-retro");
  });
});
