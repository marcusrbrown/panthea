// The GPL/MIT boundary, enforced in code (R6). The Blender Foundation requires that a
// script using the Blender Python API be GPL-licensed, so every Python file that imports a
// Blender module carries `SPDX-License-Identifier: GPL-3.0-or-later` (text in LICENSES/)
// and everything else stays MIT. Rendered output is not covered by the GPL.
//
// A header-carrying file is also barred from dynamic code (`importlib`, `__import__`,
// `exec(`, `eval(`): a Blender-side script that can load or run arbitrary code would turn
// the static import scan into a statement about nothing.
//
// Node/Bun module: it reads the repository from disk.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const GPL_HEADER = "# SPDX-License-Identifier: GPL-3.0-or-later";

/** Top-level module names that are Blender's, besides the `bpy` prefix. */
const BLENDER_MODULES: ReadonlySet<string> = new Set([
  "bmesh",
  "mathutils",
  "gpu",
  "bl_math",
  "bgl",
  "freestyle",
  "idprop",
  "aud",
]);

/** Directory names the scan never enters. Gitignored directories are skipped as well. */
const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "scratch",
  "models",
]);

export interface PythonViolation {
  /** 1-based physical line the statement starts on. */
  readonly line: number;
  readonly message: string;
}

export interface PythonSourceCheck {
  readonly hasHeader: boolean;
  readonly violations: readonly PythonViolation[];
}

export interface BoundaryViolation extends PythonViolation {
  /** Path relative to the scanned root, with `/` separators. */
  readonly file: string;
}

function isBlenderModule(topLevel: string): boolean {
  return topLevel.startsWith("bpy") || BLENDER_MODULES.has(topLevel);
}

/**
 * Replaces comments and the contents of string literals with spaces, keeping every newline,
 * so import-looking text in a docstring or comment is not read as code and line numbers hold.
 */
function blankCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === "#") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      const triple = source.startsWith(ch.repeat(3), i);
      const delimiter = triple ? ch.repeat(3) : ch;
      out += triple ? "   " : " ";
      i += delimiter.length;
      while (i < source.length && !source.startsWith(delimiter, i)) {
        if (!triple && source[i] === "\n") break; // an unterminated string ends with its line
        if (source[i] === "\\" && i + 1 < source.length) {
          out += source[i + 1] === "\n" ? " \n" : "  ";
          i += 2;
          continue;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      if (source.startsWith(delimiter, i)) {
        out += " ".repeat(delimiter.length);
        i += delimiter.length;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Logical lines of already-blanked source: a trailing backslash joins the next physical line. */
function logicalLines(blanked: string): { line: number; text: string }[] {
  const physical = blanked.split("\n");
  const out: { line: number; text: string }[] = [];
  for (let index = 0; index < physical.length; index += 1) {
    let text = physical[index] as string;
    const line = index + 1;
    while (text.trimEnd().endsWith("\\") && index + 1 < physical.length) {
      text = `${text.trimEnd().slice(0, -1)} ${physical[index + 1] as string}`;
      index += 1;
    }
    out.push({ line, text });
  }
  return out;
}

function hasGplHeader(source: string): boolean {
  const lines = source.split("\n").map((l) => l.replace(/\r$/, ""));
  const first = lines[0] ?? "";
  const candidate = first.startsWith("#!") ? lines[1] : first;
  return candidate?.trimEnd() === GPL_HEADER;
}

const IMPORT_STATEMENT = /(?:^|[;:])\s*import\s+([^;]+)/g;
const FROM_STATEMENT = /(?:^|[;:])\s*from\s+([\w.]+)\s+import\b/g;
const DYNAMIC_CODE: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /\bimportlib\b/, name: "importlib" },
  { pattern: /\b__import__\b/, name: "__import__" },
  { pattern: /\bexec\s*\(/, name: "exec(" },
  { pattern: /\beval\s*\(/, name: "eval(" },
];

function importedModules(text: string): string[] {
  const modules: string[] = [];
  for (const match of text.matchAll(IMPORT_STATEMENT)) {
    for (const part of (match[1] as string).split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0] ?? "";
      if (name !== "") modules.push(name);
    }
  }
  for (const match of text.matchAll(FROM_STATEMENT)) {
    modules.push(match[1] as string);
  }
  return modules;
}

/** Checks one Python source. Pure: no file access. */
export function checkPythonSource(source: string): PythonSourceCheck {
  const hasHeader = hasGplHeader(source);
  const violations: PythonViolation[] = [];
  for (const { line, text } of logicalLines(blankCommentsAndStrings(source))) {
    if (!hasHeader) {
      for (const module of importedModules(text)) {
        if (module.startsWith(".")) continue; // a relative import names no Blender module
        const topLevel = module.split(".")[0] as string;
        if (isBlenderModule(topLevel)) {
          violations.push({
            line,
            message: `imports Blender module "${topLevel}" without ${GPL_HEADER} as the first line (or the line after a shebang)`,
          });
        }
      }
    } else {
      for (const { pattern, name } of DYNAMIC_CODE) {
        if (pattern.test(text)) {
          violations.push({
            line,
            message: `${name} is not allowed in a GPL-3.0-or-later (Blender-side) file`,
          });
        }
      }
    }
  }
  return { hasHeader, violations };
}

/** Paths git ignores under `root` (directories end in `/`), or an empty set outside a git repository. */
function gitIgnored(root: string): ReadonlySet<string> {
  const result = Bun.spawnSync(
    [
      "git",
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ],
    { cwd: root, stdout: "pipe", stderr: "ignore" },
  );
  if (result.exitCode !== 0) return new Set();
  return new Set(
    result.stdout
      .toString("utf8")
      .split("\0")
      .filter((entry) => entry !== ""),
  );
}

function pythonFiles(root: string): string[] {
  const ignored = gitIgnored(root);
  const found: string[] = [];
  const walk = (relative: string): void => {
    const directory = relative === "" ? root : join(root, relative);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        if (ignored.has(`${path}/`)) continue;
        walk(path);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".py") &&
        !ignored.has(path)
      ) {
        found.push(path);
      }
    }
  };
  walk("");
  return found.sort();
}

/**
 * Scans every `.py` under `root` (skipping `node_modules`, `.git`, `scratch`, `models` and
 * gitignored paths) and returns every boundary violation, in file then line order.
 */
export function checkLicenceBoundary(root: string): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const file of pythonFiles(root)) {
    const { violations: found } = checkPythonSource(
      readFileSync(join(root, file), "utf8"),
    );
    for (const violation of found) violations.push({ file, ...violation });
  }
  return violations;
}
