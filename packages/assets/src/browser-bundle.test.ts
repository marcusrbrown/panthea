// The browser-safe subpath must bundle for a browser target without pulling in
// any platform module. Bun.build resolves the real import graph (workspace
// packages included); a plugin records every node:/bun: specifier and every
// bare Node builtin that the graph asks for.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUILTINS = [...new Set(builtinModules.map((m) => m.split("/")[0]))];
const PLATFORM = new RegExp(
  `^(?:node:|bun:|(?:${BUILTINS.map((m) => m?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:/|$))`,
);

async function platformImports(entry: string): Promise<string[]> {
  const found = new Set<string>();
  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    plugins: [
      {
        name: "record-platform-imports",
        setup(build) {
          build.onResolve({ filter: PLATFORM }, (args) => {
            found.add(args.path);
            return { path: args.path, external: true };
          });
        },
      },
    ],
  });
  expect(result.success, result.logs.map(String).join("\n")).toBe(true);
  return [...found].sort();
}

test("the browser-safe subpath bundles for a browser target with no node: module", async () => {
  expect(await platformImports(join(import.meta.dir, "browser.ts"))).toEqual(
    [],
  );
});

test("the bundle check does flag a node: import reached through a relative module", async () => {
  const dir = mkdtempSync(join(tmpdir(), "browser-bundle-"));
  try {
    writeFileSync(join(dir, "entry.ts"), 'export * from "./middle";\n');
    writeFileSync(
      join(dir, "middle.ts"),
      'import { createHash } from "node:crypto";\nimport { inflateSync } from "zlib";\nexport const f = () => [createHash, inflateSync];\n',
    );
    expect(await platformImports(join(dir, "entry.ts"))).toEqual([
      "node:crypto",
      "zlib",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
