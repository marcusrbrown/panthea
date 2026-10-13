// The GPL/MIT boundary: Python that imports a Blender module carries the GPL header and
// stays free of dynamic code. Fixtures are built explicitly in temp directories; the last
// scenario runs the scan over the real repository.

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkLicenceBoundary, checkPythonSource } from "./licence-boundary";

const HEADER = "# SPDX-License-Identifier: GPL-3.0-or-later";
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "licence-boundary-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe("checkPythonSource", () => {
  it("refuses a bpy_extras import without the header (the prefix rule)", () => {
    const result = checkPythonSource("import bpy_extras.io_utils\n");
    expect(result.violations.map((v) => v.message).join("\n")).toContain(
      "bpy_extras",
    );
  });

  it("accepts the same import under the header (positive control)", () => {
    const result = checkPythonSource(`${HEADER}\nimport bpy_extras.io_utils\n`);
    expect(result.violations).toEqual([]);
    expect(result.hasHeader).toBe(true);
  });

  it.each([
    "bpy",
    "bmesh",
    "mathutils",
    "gpu",
    "bl_math",
    "bgl",
    "freestyle",
    "idprop",
    "aud",
    "bpy.types",
  ])(
    "refuses `import %s` and `from %s import x` without the header",
    (name) => {
      expect(checkPythonSource(`import ${name}\n`).violations).toHaveLength(1);
      expect(
        checkPythonSource(`from ${name} import x\n`).violations,
      ).toHaveLength(1);
    },
  );

  it("finds imports that are indented, aliased, listed or after a semicolon", () => {
    const source = [
      "def f():",
      "    import os, mathutils as m",
      "import json; import aud",
      "from bgl import (",
      "    GL_ALL,",
      ")",
    ].join("\n");
    expect(checkPythonSource(source).violations.map((v) => v.line)).toEqual([
      2, 3, 4,
    ]);
  });

  it("accepts ordinary imports and names that only resemble Blender modules", () => {
    const source = [
      "import json",
      "from pathlib import Path",
      "import gpuutils",
      "import audio",
      "from . import bpy",
      "import bpyx_not_it as ok",
    ].join("\n");
    // `bpyx_not_it` starts with `bpy`: the prefix rule refuses it. The rest pass.
    expect(checkPythonSource(source).violations.map((v) => v.line)).toEqual([
      6,
    ]);
  });

  it("ignores import text inside comments and strings", () => {
    const source = [
      '"""Docs: run `import bpy` in Blender.',
      "import mathutils",
      '"""',
      "# import bmesh",
      "text = 'import gpu'",
      'also = "from aud import x"',
    ].join("\n");
    expect(checkPythonSource(source).violations).toEqual([]);
  });

  it("accepts the header on line 1 or on line 2 after a shebang, nowhere else", () => {
    expect(checkPythonSource(`${HEADER}\nimport bpy\n`).hasHeader).toBe(true);
    expect(
      checkPythonSource(`#!/usr/bin/env python3\n${HEADER}\nimport bpy\n`)
        .hasHeader,
    ).toBe(true);
    expect(
      checkPythonSource(`"""doc"""\n${HEADER}\nimport bpy\n`).hasHeader,
    ).toBe(false);
    expect(
      checkPythonSource(`# SPDX-License-Identifier: MIT\nimport bpy\n`)
        .hasHeader,
    ).toBe(false);
  });

  it.each([
    ["importlib", "import importlib\n"],
    ["importlib", "from importlib import util\n"],
    ["__import__", "m = __import__('os')\n"],
    ["exec(", "exec(code)\n"],
    ["eval(", "x = eval( s )\n"],
  ])("refuses %s in a header-carrying file", (name, body) => {
    const result = checkPythonSource(`${HEADER}\nimport bpy\n${body}`);
    expect(result.violations.map((v) => v.message).join("\n")).toContain(name);
  });

  it("allows dynamic code in a file that has no header and imports no Blender module", () => {
    expect(
      checkPythonSource("import importlib\nexec(code)\neval(x)\n").violations,
    ).toEqual([]);
  });

  it("does not mistake identifiers that contain `eval` or `exec` for calls", () => {
    expect(
      checkPythonSource(`${HEADER}\nimport bpy\nevaluate(x)\nexecute(y)\n`)
        .violations,
    ).toEqual([]);
  });
});

describe("checkLicenceBoundary", () => {
  it("fails a temp .py importing bpy_extras without the header, naming the file and line", () => {
    const root = repoWith({
      "tools/x/tool.py": "import os\nimport bpy_extras\n",
    });
    const violations = checkLicenceBoundary(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("tools/x/tool.py");
    expect(violations[0]?.line).toBe(2);
  });

  it("passes the same file with the header (positive control)", () => {
    const root = repoWith({
      "tools/x/tool.py": `${HEADER}\nimport os\nimport bpy_extras\n`,
    });
    expect(checkLicenceBoundary(root)).toEqual([]);
  });

  it("fails importlib in a header file", () => {
    const root = repoWith({
      "tools/x/tool.py": `${HEADER}\nimport bpy\nimport importlib\n`,
    });
    const violations = checkLicenceBoundary(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("importlib");
  });

  it("skips node_modules, .git, scratch and models directories", () => {
    const root = repoWith({
      "node_modules/pkg/a.py": "import bpy\n",
      ".git/hooks/b.py": "import bpy\n",
      "tools/probes/p/scratch/c.py": "import bpy\n",
      "tools/probes/p/models/d.py": "import bpy\n",
      "tools/ok.py": "import json\n",
    });
    expect(checkLicenceBoundary(root)).toEqual([]);
  });

  it("scans a directory that looks similar to an excluded one (positive control)", () => {
    const root = repoWith({ "tools/models_extra/e.py": "import bpy\n" });
    expect(checkLicenceBoundary(root)).toHaveLength(1);
  });

  it("skips gitignored directories when the root is a git repository", () => {
    const root = repoWith({
      ".gitignore": "ignored-dir/\n",
      "ignored-dir/f.py": "import bpy\n",
      "kept/g.py": "import bpy\n",
    });
    const init = Bun.spawnSync(["git", "init", "-q"], { cwd: root });
    expect(init.exitCode).toBe(0);
    const violations = checkLicenceBoundary(root);
    expect(violations.map((v) => v.file)).toEqual(["kept/g.py"]);
  });

  it("passes every real repository file", () => {
    expect(checkLicenceBoundary(REPO_ROOT)).toEqual([]);
  });
});
