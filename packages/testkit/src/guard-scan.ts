// Scanners for the guard test. Test support lives in `@panthea/testkit` and in
// each workspace's `test/` directory; production sources must never import
// either, so a production build cannot pick the support code up. No source
// file name starts with an underscore. Each scan returns the repo-relative
// paths of the offending files, sorted.

import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
// Anything a build or a developer would call source, for the file-name rule.
const SOURCE_LIKE = /\.(?:[cm]?[jt]sx?|rs|sh)$/;
const WORKSPACE_GROUPS = ["apps", "packages", "tools"];
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "target",
  "gen",
  ".git",
  ".context",
]);
const TESTKIT = /^@panthea\/testkit(?:\/|$)/;

// `from "x"`, a bare `import "x"`, `import("x")` and `require("x")`.
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'`])([^"'`\n]+)\1/g;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function specifiers(text: string): string[] {
  const found: string[] = [];
  for (const match of stripComments(text).matchAll(SPECIFIER)) {
    const specifier = match[2];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

function walk(
  root: string,
  directory = root,
  matches: RegExp = SOURCE,
): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      files.push(...walk(root, join(directory, entry.name), matches));
    } else if (entry.isFile() && matches.test(entry.name)) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

const posix = (path: string): string => path.split(sep).join("/");

function isProductionSource(root: string, file: string): boolean {
  if (TEST_FILE.test(file)) return false;
  return !posix(relative(root, file)).split("/").includes("test");
}

/** Production sources, in any workspace, that import `@panthea/testkit` (or a subpath of it). */
export function findTestkitImports(root: string): string[] {
  return walk(root)
    .filter((file) => isProductionSource(root, file))
    .filter((file) =>
      specifiers(readFileSync(file, "utf8")).some((s) => TESTKIT.test(s)),
    )
    .map((file) => posix(relative(root, file)))
    .sort();
}

/** Non-test files under `apps/client/src` that import anything inside `apps/client/test`. */
export function findClientTestImports(root: string): string[] {
  const clientSource = join(root, "apps", "client", "src");
  const clientTest = join(root, "apps", "client", "test");
  let files: string[];
  try {
    files = walk(root, clientSource);
  } catch {
    return [];
  }
  return files
    .filter((file) => !TEST_FILE.test(file))
    .filter((file) =>
      specifiers(readFileSync(file, "utf8")).some((specifier) => {
        if (!specifier.startsWith(".")) return false;
        const target = resolve(dirname(file), specifier);
        return target === clientTest || target.startsWith(clientTest + sep);
      }),
    )
    .map((file) => posix(relative(root, file)))
    .sort();
}

/** Source files under `apps/`, `packages/` and `tools/` (any depth, tests and test directories included) whose name starts with `_`. */
export function findUnderscoreSourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const group of WORKSPACE_GROUPS) {
    let files: string[];
    try {
      files = walk(root, join(root, group), SOURCE_LIKE);
    } catch {
      continue;
    }
    for (const file of files) {
      if (basename(file).startsWith("_"))
        found.push(posix(relative(root, file)));
    }
  }
  return found.sort();
}

/**
 * Production sources under `apps/`, `packages/` and `tools/` with a relative
 * import that lands inside any `test` directory (`<workspace>/test/...`).
 */
export function findTestDirectoryImports(root: string): string[] {
  const found: string[] = [];
  for (const group of WORKSPACE_GROUPS) {
    let files: string[];
    try {
      files = walk(root, join(root, group));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!isProductionSource(root, file)) continue;
      const importsTestDirectory = specifiers(readFileSync(file, "utf8")).some(
        (specifier) => {
          if (!specifier.startsWith(".")) return false;
          const target = posix(
            relative(root, resolve(dirname(file), specifier)),
          );
          return target.split("/").includes("test");
        },
      );
      if (importsTestDirectory) found.push(posix(relative(root, file)));
    }
  }
  return found.sort();
}
