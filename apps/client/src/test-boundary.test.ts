import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Test support lives in apps/client/test, outside src, so a production build
// (which bundles what src imports) cannot reach it. This keeps src from
// importing it.

const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(clientDir, "src");
const testDir = join(clientDir, "test");

interface Source {
  readonly path: string;
  readonly text: string;
}

const isTestFile = (path: string): boolean => /\.test\.tsx?$/.test(path);

/** Every module specifier a file imports, re-exports or dynamically imports. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
}

function reachesTestDir(from: string, specifier: string): boolean {
  if (specifier.startsWith("@panthea/client/test")) return true;
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(from), specifier);
  return target === testDir || target.startsWith(testDir + sep);
}

/** The non-test files that import from apps/client/test. */
function importersOfTestSupport(sources: readonly Source[]): string[] {
  return sources
    .filter((source) => !isTestFile(source.path))
    .filter((source) =>
      specifiers(source.text).some((specifier) =>
        reachesTestDir(source.path, specifier),
      ),
    )
    .map((source) => source.path);
}

function sourcesUnder(dir: string): Source[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return /\.tsx?$/.test(entry.name)
      ? [{ path, text: readFileSync(path, "utf8") }]
      : [];
  });
}

test("no production file under apps/client/src imports from apps/client/test", () => {
  const sources = sourcesUnder(srcDir);

  // The scan must have read the tree, or an empty list would pass vacuously.
  expect(sources.length).toBeGreaterThan(10);
  expect(importersOfTestSupport(sources)).toEqual([]);
});

test("the scan catches an import of test support from a production file, however it is written, and spares tests and unrelated imports", () => {
  const at = (name: string) => join(srcDir, name);
  const sources: Source[] = [
    {
      path: at("receipts.ts"),
      text: 'import { fakeClock } from "../test/fake-clock";',
    },
    {
      path: at("renderer/scene.ts"),
      text: 'export { fakeClock } from "../../test/fake-clock";',
    },
    {
      path: at("lazy.ts"),
      text: 'const clock = await import("../test/fake-clock");',
    },
    {
      path: at("named.ts"),
      text: 'import { fakeClock } from "@panthea/client/test/fake-clock";',
    },
    {
      path: at("receipts.test.ts"),
      text: 'import { fakeClock } from "../test/fake-clock";',
    },
    { path: at("clean.ts"), text: 'import { fakeClock } from "./fake-clock";' },
    { path: at("deep/other.ts"), text: 'import "../receipts";' },
  ];

  expect(importersOfTestSupport(sources)).toEqual([
    at("receipts.ts"),
    at("renderer/scene.ts"),
    at("lazy.ts"),
    at("named.ts"),
  ]);
});
