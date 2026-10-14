import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  findClientTestImports,
  findTestDirectoryImports,
  findTestkitImports,
  findUnderscoreSourceFiles,
} from "./guard-scan";

const repoRoot = join(import.meta.dir, "..", "..", "..");

const scratch: string[] = [];
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "testkit-guard-"));
  scratch.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}
afterEach(() => {
  for (const root of scratch.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("test support stays out of production sources", () => {
  test("no production source in the repo imports @panthea/testkit", () => {
    expect(findTestkitImports(repoRoot)).toEqual([]);
  });

  test("no production source under apps/client/src imports apps/client/test", () => {
    expect(findClientTestImports(repoRoot)).toEqual([]);
  });

  test("no production source under apps, packages or tools imports a workspace test directory", () => {
    expect(findTestDirectoryImports(repoRoot)).toEqual([]);
  });

  test("no source file under apps, packages or tools has a name starting with an underscore", () => {
    expect(findUnderscoreSourceFiles(repoRoot)).toEqual([]);
  });

  describe("positive controls", () => {
    test("a production source importing @panthea/testkit is reported, in every import form", () => {
      const root = tree({
        "apps/a/src/static.ts": `import { testActor } from "@panthea/testkit/world";\n`,
        "apps/a/src/reexport.ts": `export { testBackend } from "@panthea/testkit/renderer";\n`,
        "apps/a/src/dynamic.ts": `export const load = () => import("@panthea/testkit/world");\n`,
        "apps/a/src/bare.ts": `import "@panthea/testkit/world";\n`,
        "apps/a/src/required.cjs": `const t = require("@panthea/testkit/world");\n`,
        "packages/b/src/x.tsx": `import { testActor } from "@panthea/testkit/world";\n`,
      });
      expect(findTestkitImports(root)).toEqual([
        "apps/a/src/bare.ts",
        "apps/a/src/dynamic.ts",
        "apps/a/src/reexport.ts",
        "apps/a/src/required.cjs",
        "apps/a/src/static.ts",
        "packages/b/src/x.tsx",
      ]);
    });

    test("a test file, a file under a test directory, and a mere mention are not reported", () => {
      const root = tree({
        "apps/a/src/thing.test.ts": `import { testActor } from "@panthea/testkit/world";\n`,
        "apps/a/src/thing.test.tsx": `import { testActor } from "@panthea/testkit/world";\n`,
        "apps/a/test/helper.ts": `import { testActor } from "@panthea/testkit/world";\n`,
        "apps/a/src/comment.ts": `// import { testActor } from "@panthea/testkit/world";\n/* import "@panthea/testkit/world"; */\nexport const x = 1;\n`,
        "apps/a/src/text.ts": `export const note = "see @panthea/testkit";\n`,
        "apps/a/node_modules/dep/index.ts": `import "@panthea/testkit/world";\n`,
        "apps/a/dist/out.js": `import "@panthea/testkit/world";\n`,
      });
      expect(findTestkitImports(root)).toEqual([]);
    });

    test("a client source importing apps/client/test is reported, by any relative path", () => {
      const root = tree({
        "apps/client/src/a.ts": `import { f } from "../test/canon-fixture";\n`,
        "apps/client/src/deep/b.ts": `import { f } from "../../test/soft-backend";\n`,
        "apps/client/src/deep/c.tsx": `export * from "../../test/view-fixture";\n`,
        "apps/client/src/deep/d.ts": `export const g = () => import("../../test/canon-fixture");\n`,
        "apps/client/src/deep/e.ts": `import "../../test";\n`,
      });
      expect(findClientTestImports(root)).toEqual([
        "apps/client/src/a.ts",
        "apps/client/src/deep/b.ts",
        "apps/client/src/deep/c.tsx",
        "apps/client/src/deep/d.ts",
        "apps/client/src/deep/e.ts",
      ]);
    });

    test("a client test, a client test directory and an unrelated relative import are not reported", () => {
      const root = tree({
        "apps/client/src/a.test.ts": `import { f } from "../test/canon-fixture";\n`,
        "apps/client/src/deep/b.test.tsx": `import { f } from "../../test/soft-backend";\n`,
        "apps/client/test/canon-fixture.ts": `import { g } from "../src/assets/canon";\n`,
        "apps/client/src/ok.ts": `import { f } from "./deep/b";\nimport { g } from "../testing";\n`,
      });
      expect(findClientTestImports(root)).toEqual([]);
    });

    test("a source file whose name starts with an underscore is reported, in any workspace and at any depth", () => {
      const root = tree({
        "apps/a/src/_helper.ts": `export const x = 1;\n`,
        "apps/a/src/deep/_test-kit.tsx": `export const y = 1;\n`,
        "packages/b/src/_fixtures.test.ts": `export const z = 1;\n`,
        "packages/b/test/_kit.ts": `export const w = 1;\n`,
        "tools/c/src/_run.sh": `echo hi\n`,
        "apps/a/src-tauri/src/_native.rs": `fn main() {}\n`,
      });
      expect(findUnderscoreSourceFiles(root)).toEqual([
        "apps/a/src-tauri/src/_native.rs",
        "apps/a/src/_helper.ts",
        "apps/a/src/deep/_test-kit.tsx",
        "packages/b/src/_fixtures.test.ts",
        "packages/b/test/_kit.ts",
        "tools/c/src/_run.sh",
      ]);
    });

    test("an underscore inside a name, a non-source file, a skipped directory and a file outside the workspaces are not reported", () => {
      const root = tree({
        "apps/a/src/snake_case.ts": `export const x = 1;\n`,
        "apps/a/src/a_b_.ts": `export const y = 1;\n`,
        "apps/a/public/_headers": `/*\n`,
        "apps/a/src/_notes.md": `# notes\n`,
        "apps/a/node_modules/dep/_x.ts": `export const z = 1;\n`,
        "apps/a/dist/_x.js": `export const w = 1;\n`,
        "docs/_scratch.ts": `export const v = 1;\n`,
      });
      expect(findUnderscoreSourceFiles(root)).toEqual([]);
    });

    test("a production source importing a workspace test directory is reported, by any relative path", () => {
      const root = tree({
        "apps/a/src/one.ts": `import { f } from "../test/kit";\n`,
        "packages/b/src/deep/two.ts": `import { f } from "../../test/studio/fixtures";\n`,
        "tools/c/src/three.tsx": `export * from "../../../packages/b/test/studio/runtime";\n`,
        "apps/a/src/deep/four.ts": `export const g = () => import("../../test/kit");\n`,
        "apps/a/src/five.ts": `import "../test";\n`,
      });
      expect(findTestDirectoryImports(root)).toEqual([
        "apps/a/src/deep/four.ts",
        "apps/a/src/five.ts",
        "apps/a/src/one.ts",
        "packages/b/src/deep/two.ts",
        "tools/c/src/three.tsx",
      ]);
    });

    test("a test, a file in a test directory, an unrelated relative import and a mere mention are not reported", () => {
      const root = tree({
        "apps/a/src/one.test.ts": `import { f } from "../test/kit";\n`,
        "packages/b/src/two.test.tsx": `import { f } from "../../b/test/studio/fixtures";\n`,
        "apps/a/test/kit.ts": `import { g } from "../src/thing";\n`,
        "packages/b/test/studio/fixtures.ts": `import { g } from "../../src/studio/thing";\n`,
        "apps/a/src/ok.ts": `import { f } from "./deep/b";\nimport { g } from "../testing";\nimport { h } from "../latest";\n`,
        "apps/a/src/comment.ts": `// import { f } from "../test/kit";\nexport const x = 1;\n`,
      });
      expect(findTestDirectoryImports(root)).toEqual([]);
    });
  });
});
