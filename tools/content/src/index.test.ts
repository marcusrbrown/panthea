import { afterEach, describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./index";

const COMMITTED = join(import.meta.dir, "..", "..", "..", "content", "greek");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function quietly<T>(run: () => T): { result: T; stderr: string[] } {
  const stderr: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = (...args: unknown[]) => stderr.push(args.join(" "));
  try {
    return { result: run(), stderr };
  } finally {
    console.log = log;
    console.error = error;
  }
}

describe("tools-content CLI", () => {
  it("validates the committed content with exit 0", () => {
    expect(quietly(() => main(["assets"])).result).toBe(0);
  });

  it("exits 1 and prints file-addressed diagnostics for invalid content", () => {
    const root = mkdtempSync(join(tmpdir(), "content-cli-"));
    dirs.push(root);
    cpSync(COMMITTED, root, { recursive: true });
    writeFileSync(join(root, "assets", "registry", "index.json"), "not json");
    const { result, stderr } = quietly(() => main(["assets", "--root", root]));
    expect(result).toBe(1);
    expect(stderr[0]).toMatch(/^assets\/registry\/index\.json: /);
  });

  it("exits 64 for a usage error", () => {
    for (const argv of [
      [],
      ["nope"],
      ["assets", "--root"],
      ["assets", "extra"],
    ]) {
      expect(quietly(() => main(argv)).result).toBe(64);
    }
  });
});
