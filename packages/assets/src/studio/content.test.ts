import { afterEach, describe, expect, test } from "bun:test";
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
import { type ContentDiagnostic, loadStudioContent } from "./content";

const REAL = join(import.meta.dir, "..", "..", "..", "..", "content", "greek");
const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A copy of the real content's loadable parts, to damage one file at a time. */
function copyOfContent(): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-content-"));
  roots.push(dir);
  for (const part of ["gods", "assets/subjects", "palette"])
    cpSync(join(REAL, part), join(dir, part), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  cpSync(
    join(REAL, "assets", "vocabulary.json"),
    join(dir, "assets", "vocabulary.json"),
  );
  return dir;
}

const failures = (root: string): readonly ContentDiagnostic[] => {
  const result = loadStudioContent(root);
  if (result.ok) throw new Error("expected the content to be refused");
  return result.diagnostics;
};
const files = (root: string) => failures(root).map((d) => d.file);
// biome-ignore lint/suspicious/noExplicitAny: the tests edit parsed JSON in place
type Json = Record<string, any>;
const edit = (root: string, file: string, change: (json: Json) => void) => {
  const path = join(root, file);
  const json = JSON.parse(readFileSync(path, "utf8"));
  change(json);
  writeFileSync(path, JSON.stringify(json));
};

describe("the committed Greek content", () => {
  test("loads through the production parsers into one joined content value", () => {
    const result = loadStudioContent(REAL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { content } = result;
    expect(content.vocabulary.expressions).toHaveLength(6);
    expect(content.gods.map((g) => g.id)).toContain("zeus");
    expect(content.visuals.map((v) => v.godId)).toContain("zeus");
    expect(content.palette.approval.status).toBe(
      JSON.parse(readFileSync(join(REAL, "palette", "palette.json"), "utf8"))
        .approval.status,
    );
    expect(content.palette.families.map((f) => f.id)).toEqual(
      expect.arrayContaining([...content.vocabulary.paletteFamilies]),
    );
    expect(JSON.stringify(content)).toBe(
      JSON.stringify(
        loadStudioContent(REAL).ok
          ? (loadStudioContent(REAL) as { content: unknown }).content
          : null,
      ),
    );
  });

  test("a copy of it loads to the same content, so the root is explicit and nothing else is read", () => {
    const copy = copyOfContent();
    const a = loadStudioContent(REAL);
    const b = loadStudioContent(copy);

    expect(a.ok && b.ok).toBe(true);
    expect(JSON.stringify(b.ok ? b.content : null)).toBe(
      JSON.stringify(a.ok ? a.content : null),
    );
  });
});

describe("content that cannot load is refused with diagnostics, never an exception", () => {
  test("a root that does not exist, is empty or is not a directory", () => {
    const empty = mkdtempSync(join(tmpdir(), "studio-content-"));
    roots.push(empty);
    const file = join(empty, "file.txt");
    writeFileSync(file, "x");

    for (const root of [join(empty, "missing"), empty, file, ""])
      expect(() => loadStudioContent(root)).not.toThrow();
    expect(files(join(empty, "missing"))).toContain("assets/vocabulary.json");
    expect(files(empty)).toEqual(
      expect.arrayContaining([
        "assets/vocabulary.json",
        "palette/palette.json",
      ]),
    );
    expect(failures("")).toEqual([
      { file: ".", message: "no content root was given" },
    ]);
  });

  test("a missing vocabulary is reported and the files that need it are not guessed at", () => {
    const root = copyOfContent();
    rmSync(join(root, "assets", "vocabulary.json"));

    expect(files(root)).toEqual(["assets/vocabulary.json"]);
  });

  test("a malformed or invalid vocabulary", () => {
    const root = copyOfContent();
    writeFileSync(join(root, "assets", "vocabulary.json"), "{");
    expect(files(root)).toEqual(["assets/vocabulary.json"]);

    const invalid = copyOfContent();
    edit(invalid, "assets/vocabulary.json", (v) => {
      v.expressions = [];
    });
    expect(files(invalid)).toEqual(["assets/vocabulary.json"]);
  });

  test("a malformed god and an invalid god are each reported by file, and the others still load", () => {
    const root = copyOfContent();
    writeFileSync(join(root, "gods", "zeus.json"), "not json");
    edit(root, "gods/hera.json", (g) => {
      delete g.name;
    });

    const diagnostics = failures(root);

    expect(diagnostics.map((d) => d.file)).toEqual(
      expect.arrayContaining(["gods/zeus.json", "gods/hera.json"]),
    );
    expect(diagnostics.every((d) => d.message.length > 0)).toBe(true);
  });

  test("a visual profile of a god that does not exist, and one with an unknown palette family", () => {
    const orphan = copyOfContent();
    edit(orphan, "assets/subjects/zeus.json", (p) => {
      p.godId = "nobody";
    });
    expect(files(orphan).some((f) => f.startsWith("assets/subjects"))).toBe(
      true,
    );

    const family = copyOfContent();
    edit(family, "assets/subjects/zeus.json", (p) => {
      p.paletteFamily = "atlantis";
    });
    expect(files(family).some((f) => f.startsWith("assets/subjects"))).toBe(
      true,
    );
  });

  test("a missing, malformed or inconsistent palette", () => {
    const missing = copyOfContent();
    rmSync(join(missing, "palette", "master.gpl"));
    expect(files(missing)).toEqual(
      expect.arrayContaining(["palette/master.gpl"]),
    );

    const broken = copyOfContent();
    writeFileSync(join(broken, "palette", "palette.json"), "{");
    expect(files(broken)).toEqual(["palette/palette.json"]);

    const hex = copyOfContent();
    writeFileSync(join(hex, "palette", "master.hex"), "000000\n");
    expect(failures(hex).length).toBeGreaterThan(0);
  });

  test("an approved palette whose data no longer matches its digest is refused", () => {
    const root = copyOfContent();
    const path = join(root, "palette", "master.hex");
    const lines = readFileSync(path, "utf8").split("\n");
    lines[0] = lines[0] === "000000" ? "000001" : "000000";
    writeFileSync(path, lines.join("\n"));

    expect(failures(root).length).toBeGreaterThan(0);
  });

  test("diagnostics never carry a file's contents", () => {
    const root = copyOfContent();
    writeFileSync(
      join(root, "gods", "zeus.json"),
      'SECRET_TOKEN_9f3a {"api_key": "SECRET_TOKEN_9f3a"',
    );
    writeFileSync(join(root, "palette", "master.gpl"), "SECRET_TOKEN_9f3a");

    const text = JSON.stringify(failures(root));

    expect(text).not.toContain("SECRET_TOKEN_9f3a");
    expect(text).toContain("gods/zeus.json");
  });

  test("every diagnostic names its file relative to the root and carries a bounded message", () => {
    const root = copyOfContent();
    writeFileSync(join(root, "gods", "zeus.json"), "{");
    rmSync(join(root, "palette", "palette.json"));

    for (const d of failures(root)) {
      expect(d.file.startsWith("/")).toBe(false);
      expect(d.file).not.toContain(root);
      expect(d.message.length).toBeLessThanOrEqual(240);
    }
  });
});
