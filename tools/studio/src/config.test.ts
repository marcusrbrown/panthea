import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, parseConfig, parseConformParams } from "./config";

// biome-ignore lint/suspicious/noExplicitAny: the tests edit parsed JSON in place
type Json = any;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const params = {
  background: { type: "alpha" },
  alphaCutoff: 128,
  grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
};
const full = () => ({
  studioRoot: "work/.studio",
  contentRoot: "/abs/content",
  registryRoot: "registry",
  artifactRoot: "artifacts",
  runtime: {
    port: 8190,
    pollMs: 100,
    deadlines: {
      httpMs: 10,
      startupMs: 20,
      generationMs: 30,
      termGraceMs: 4,
      killMs: 5,
    },
  },
  editor: {
    executable: "bin/aseprite",
    timeoutMs: 30000,
    tempParent: "tmp",
    editPollMs: 500,
  },
  conform: { standard: params },
});

describe("conform parameters", () => {
  test("a complete alpha or key background set parses to exactly its fields", () => {
    expect<unknown>(parseConformParams(params, "p")).toEqual({
      ok: true,
      value: params,
    });
    const key = {
      background: { type: "key", rgb: [0, 255, 0], tolerance: 12 },
      alphaCutoff: 1,
      grid: { edgeTolerance: 0, minConfidence: 1, minEdges: 1 },
      scale: 8,
    };
    expect<unknown>(parseConformParams(key, "p")).toEqual({
      ok: true,
      value: key,
    });
  });

  const bad: [string, (p: Json) => void][] = [
    [
      "an unknown key",
      (p) => {
        p.extra = 1;
      },
    ],
    [
      "no background",
      (p) => {
        delete p.background;
      },
    ],
    [
      "an unknown background type",
      (p) => {
        p.background = { type: "auto" };
      },
    ],
    [
      "an alpha background with extra fields",
      (p) => {
        p.background.rgb = [0, 0, 0];
      },
    ],
    [
      "a key background without tolerance",
      (p) => {
        p.background = { type: "key", rgb: [0, 0, 0] };
      },
    ],
    [
      "a key colour channel above 255",
      (p) => {
        p.background = { type: "key", rgb: [0, 0, 256], tolerance: 1 };
      },
    ],
    [
      "a key colour with two channels",
      (p) => {
        p.background = { type: "key", rgb: [0, 0], tolerance: 1 };
      },
    ],
    [
      "a tolerance above 255",
      (p) => {
        p.background = { type: "key", rgb: [0, 0, 0], tolerance: 256 };
      },
    ],
    [
      "no alpha cutoff",
      (p) => {
        delete p.alphaCutoff;
      },
    ],
    [
      "an alpha cutoff of 0",
      (p) => {
        p.alphaCutoff = 0;
      },
    ],
    [
      "an alpha cutoff above 255",
      (p) => {
        p.alphaCutoff = 256;
      },
    ],
    [
      "a fractional alpha cutoff",
      (p) => {
        p.alphaCutoff = 1.5;
      },
    ],
    [
      "no grid",
      (p) => {
        delete p.grid;
      },
    ],
    [
      "a missing grid field",
      (p) => {
        delete p.grid.minEdges;
      },
    ],
    [
      "an unknown grid field",
      (p) => {
        p.grid.x = 1;
      },
    ],
    [
      "an edge tolerance below 0",
      (p) => {
        p.grid.edgeTolerance = -1;
      },
    ],
    [
      "an edge tolerance above 255",
      (p) => {
        p.grid.edgeTolerance = 256;
      },
    ],
    [
      "a confidence of 0",
      (p) => {
        p.grid.minConfidence = 0;
      },
    ],
    [
      "a confidence above 1",
      (p) => {
        p.grid.minConfidence = 1.1;
      },
    ],
    [
      "a fractional edge count",
      (p) => {
        p.grid.minEdges = 2.5;
      },
    ],
    [
      "an edge count of 0",
      (p) => {
        p.grid.minEdges = 0;
      },
    ],
    [
      "a scale of 0",
      (p) => {
        p.scale = 0;
      },
    ],
    [
      "a fractional scale",
      (p) => {
        p.scale = 1.5;
      },
    ],
  ];
  for (const [name, change] of bad)
    test(`${name} is refused`, () => {
      const p = JSON.parse(JSON.stringify(params));
      change(p);
      expect(parseConformParams(p, "conform").ok).toBe(false);
    });

  test("non-objects are refused", () => {
    for (const v of [null, 1, "x", [], undefined])
      expect(parseConformParams(v, "p").ok).toBe(false);
  });
});

describe("the config file", () => {
  test("relative paths resolve against the config's own directory, absolute ones stay", () => {
    const parsed = parseConfig(JSON.stringify(full()), "/base/dir");

    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.studioRoot).toBe("/base/dir/work/.studio");
    expect(parsed.value.contentRoot).toBe("/abs/content");
    expect(parsed.value.registryRoot).toBe("/base/dir/registry");
    expect(parsed.value.artifactRoot).toBe("/base/dir/artifacts");
    expect(parsed.value.editor).toEqual({
      executable: "/base/dir/bin/aseprite",
      timeoutMs: 30000,
      tempParent: "/base/dir/tmp",
      editPollMs: 500,
    });
    expect(parsed.value.runtime?.port).toBe(8190);
    expect<unknown>(parsed.value.conform).toEqual({ standard: params });
  });

  test("every group is optional so a read-only command needs no config beyond a root", () => {
    expect(parseConfig("{}", "/b")).toEqual({ ok: true, value: {} });
    expect(parseConfig('{"studioRoot":"r"}', "/b")).toEqual({
      ok: true,
      value: { studioRoot: "/b/r" },
    });
  });

  const bad: [string, (c: Json) => void][] = [
    [
      "an unknown top-level key",
      (c) => {
        c.profile = {};
      },
    ],
    [
      "an env key",
      (c) => {
        c.env = { SECRET: "x" };
      },
    ],
    [
      "an empty path",
      (c) => {
        c.studioRoot = "";
      },
    ],
    [
      "a non-string path",
      (c) => {
        c.contentRoot = 3;
      },
    ],
    [
      "a port of 0",
      (c) => {
        c.runtime.port = 0;
      },
    ],
    [
      "a port above 65535",
      (c) => {
        c.runtime.port = 65536;
      },
    ],
    [
      "a fractional port",
      (c) => {
        c.runtime.port = 80.5;
      },
    ],
    [
      "a runtime without pollMs",
      (c) => {
        delete c.runtime.pollMs;
      },
    ],
    [
      "a runtime without deadlines",
      (c) => {
        delete c.runtime.deadlines;
      },
    ],
    [
      "a missing deadline",
      (c) => {
        delete c.runtime.deadlines.killMs;
      },
    ],
    [
      "a zero deadline",
      (c) => {
        c.runtime.deadlines.httpMs = 0;
      },
    ],
    [
      "a negative poll",
      (c) => {
        c.runtime.pollMs = -1;
      },
    ],
    [
      "an unknown deadline",
      (c) => {
        c.runtime.deadlines.idleMs = 1;
      },
    ],
    [
      "an unknown runtime key",
      (c) => {
        c.runtime.platform = "linux";
      },
    ],
    [
      "an editor without a timeout",
      (c) => {
        delete c.editor.timeoutMs;
      },
    ],
    [
      "an editor without an edit poll",
      (c) => {
        delete c.editor.editPollMs;
      },
    ],
    [
      "a zero editor timeout",
      (c) => {
        c.editor.timeoutMs = 0;
      },
    ],
    [
      "an editor platform override",
      (c) => {
        c.editor.platform = "darwin";
      },
    ],
    [
      "an editor bundle override",
      (c) => {
        c.editor.bundleExecutable = "/x";
      },
    ],
    [
      "a conform set that is not complete",
      (c) => {
        delete c.conform.standard.grid;
      },
    ],
    [
      "an empty conform set name",
      (c) => {
        c.conform[""] = c.conform.standard;
      },
    ],
  ];
  for (const [name, change] of bad)
    test(`${name} is refused with a message naming the field`, () => {
      const c = full();
      change(c);
      const parsed = parseConfig(JSON.stringify(c), "/b");
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.message.length).toBeGreaterThan(0);
    });

  test("malformed JSON and non-objects are refused without echoing the text", () => {
    for (const text of ["", "{", "[]", "null", '"SECRET_9f"']) {
      const parsed = parseConfig(text, "/b");
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.message).not.toContain("SECRET_9f");
    }
  });

  test("loadConfig reads a file relative to its own directory and reports a missing or unreadable one", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-cfg-"));
    dirs.push(dir);
    const file = join(dir, "studio.json");
    writeFileSync(file, JSON.stringify({ studioRoot: "s" }));

    expect<unknown>(loadConfig(file)).toEqual({
      ok: true,
      value: { studioRoot: join(dir, "s") },
    });
    expect(loadConfig(join(dir, "missing.json")).ok).toBe(false);
    expect(loadConfig(dir).ok).toBe(false);
  });
});
