import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as assets from "./index";

test("the root exports lookup, placeholder and helpers", () => {
  expect(Object.keys(assets).sort()).toEqual(
    [
      "DEFAULT_PLACEHOLDER",
      "EMPTY_SNAPSHOT",
      "encodeRgbaPng",
      "readPngHeader",
      "renderPlaceholder",
      "resolveAsset",
      "sha256Hex",
    ].sort(),
  );
});

test("the root and the pure lookup never import the filesystem or the registry", () => {
  for (const file of ["index.ts", "resolve.ts", "png.ts"]) {
    const source = readFileSync(join(import.meta.dir, file), "utf8");
    expect(source, file).not.toMatch(
      /^(import|export) .*(node:fs|node:path|\.\/registry)/m,
    );
  }
});
