import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import * as assets from "./index";

test("the root exports lookup, placeholder and helpers", () => {
  expect(Object.keys(assets).sort()).toEqual(
    [
      "DEFAULT_PLACEHOLDER",
      "EMPTY_SNAPSHOT",
      "conformImage",
      "encodeRgbaPng",
      "paletteDigest",
      "parsePalette",
      "readPngHeader",
      "recoverGrid",
      "renderPlaceholder",
      "resolveAsset",
      "sha256Hex",
    ].sort(),
  );
});

test("the root and the pure lookup never import the filesystem or the registry", () => {
  for (const file of ["index.ts", "resolve.ts", "png.ts", "palette.ts"]) {
    const source = readFileSync(join(import.meta.dir, file), "utf8");
    expect(source, file).not.toMatch(
      /^(import|export) .*(node:fs|node:path|\.\/registry)/m,
    );
  }
});

test("conformance and palette have no platform imports, randomness or clock", () => {
  for (const file of ["conformance.ts", "palette.ts"]) {
    const source = readFileSync(join(import.meta.dir, file), "utf8");
    expect(source, file).not.toMatch(/from "node:/);
    expect(source, file).not.toMatch(
      /Math\.random|Date\.now|new Date|process\.|performance\./,
    );
  }
});

const FORBIDDEN_BEYOND_ROOT =
  /^(?:\.\/studio|bun:sqlite|node:child_process|@panthea\/content)/;

/** Module specifiers reachable from `entry` through relative imports. */
function reachableSpecifiers(entry: string, dir: string): string[] {
  const seen = new Set<string>();
  const specifiers = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /^(?:import|export)\b[^"'\n]*?(?:from\s+)?["']([^"']+)["']/gm,
    )) {
      const specifier = match[1] as string;
      if (!specifier.startsWith(".")) {
        specifiers.add(specifier);
        continue;
      }
      const target = join(dirname(file), specifier);
      specifiers.add(relative(dir, target) || ".");
      for (const candidate of [`${target}.ts`, join(target, "index.ts")]) {
        if (existsSync(candidate)) visit(candidate);
      }
    }
  };
  visit(entry);
  return [...specifiers];
}

function forbidden(specifiers: string[]): string[] {
  return specifiers.filter(
    (s) => FORBIDDEN_BEYOND_ROOT.test(s) || s.startsWith("studio"),
  );
}

test("the root and the registry never reach the studio host, content, SQLite or child processes", () => {
  for (const entry of ["index.ts", "registry.ts"]) {
    const reached = reachableSpecifiers(
      join(import.meta.dir, entry),
      import.meta.dir,
    );
    expect(forbidden(reached), entry).toEqual([]);
  }
});

test("the import-boundary walk does flag a studio, content, SQLite or child-process import", () => {
  const dir = mkdtempSync(join(tmpdir(), "boundary-"));
  try {
    mkdirSync(join(dir, "studio"));
    writeFileSync(join(dir, "root.ts"), 'export * from "./middle";\n');
    writeFileSync(
      join(dir, "middle.ts"),
      'import "./studio";\nimport { x } from "bun:sqlite";\nimport "@panthea/content";\n',
    );
    writeFileSync(
      join(dir, "studio", "index.ts"),
      'import "node:child_process";\n',
    );
    expect(
      forbidden(reachableSpecifiers(join(dir, "root.ts"), dir)).sort(),
    ).toEqual([
      "@panthea/content",
      "bun:sqlite",
      "node:child_process",
      "studio",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the studio subpath is a package export", () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
  ) as { exports: Record<string, string> };
  expect(manifest.exports["./studio"]).toBe("./src/studio/index.ts");
  expect(Object.keys(manifest.exports).sort()).toEqual([
    ".",
    "./fixtures",
    "./registry",
    "./studio",
  ]);
});
