// The shared core must not depend on a host app or on Tauri: it is used by the
// studio and the game, and by neither's shell. Walks every source file under
// src, tests included. This file is skipped: its control fixture below holds
// the forbidden specifiers as string literals.

import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FORBIDDEN =
  /^@tauri-apps\/|^@panthea\/(?:studio|client|desktop|simulation)(?:\/|$)|(?:^|\/)apps\//;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every module specifier in the file: static imports, re-exports, dynamic imports and require. */
function specifiers(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:\b(?:import|export)\b[^"'`;]*?\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g,
    ),
  ].map((match) => match[1] as string);
}

function violations(dir: string): string[] {
  return sources(dir)
    .filter((file) => file !== import.meta.path)
    .flatMap((file) =>
      specifiers(readFileSync(file, "utf8"))
        .filter((specifier) => FORBIDDEN.test(specifier))
        .map((specifier) => `${file}: ${specifier}`),
    );
}

test("nothing under packages/renderer/src imports from apps/ or @tauri-apps", () => {
  expect(violations(import.meta.dir)).toEqual([]);
});

test("the guard does flag app, relative-apps and Tauri imports", () => {
  const dir = mkdtempSync(join(tmpdir(), "renderer-boundary-"));
  try {
    mkdirSync(join(dir, "nested"));
    writeFileSync(
      join(dir, "a.ts"),
      'import { invoke } from "@tauri-apps/api/core";\nexport * from "../../../apps/studio/src/x";\n',
    );
    writeFileSync(
      join(dir, "nested", "b.ts"),
      'import type { P } from "@panthea/studio";\nconst m = await import("../../apps/client/src/y");\n',
    );
    writeFileSync(
      join(dir, "ok.ts"),
      'import { Scene } from "three";\nimport { x } from "./a-sibling";\n',
    );
    expect(
      violations(dir)
        .map((line) => line.split(": ")[1])
        .sort(),
    ).toEqual([
      "../../../apps/studio/src/x",
      "../../apps/client/src/y",
      "@panthea/studio",
      "@tauri-apps/api/core",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
