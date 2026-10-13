// Scanners for the guard test. Test support lives in `@panthea/testkit` and in
// `apps/client/test`; production sources must never import either, so a
// production build cannot pick the support code up. Each scan returns the
// repo-relative paths of the offending files, sorted.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
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

function walk(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      files.push(...walk(root, join(directory, entry.name)));
    } else if (entry.isFile() && SOURCE.test(entry.name)) {
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
