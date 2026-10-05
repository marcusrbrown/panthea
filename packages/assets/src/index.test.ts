import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
