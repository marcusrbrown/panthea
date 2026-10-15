// listFiles walks a slot directory while the render script is still writing it. The script moves
// `<outDir>.partial` to `<outDir>` in one rename (render.py, os.replace), so a walk that lists the
// partial directory can find a subdirectory gone by the time it descends into it.

import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFiles } from "./list-files";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function slotDirs() {
  const base = mkdtempSync(join(tmpdir(), "list-files-"));
  roots.push(base);
  const partial = join(base, "slot.partial");
  const landed = join(base, "slot");
  for (const role of ["colour", "id", "depth"]) {
    mkdirSync(join(partial, role), { recursive: true });
    writeFileSync(join(partial, role, "00.png"), role);
  }
  return { partial, landed };
}

describe("listFiles", () => {
  test("lists nested files, sorted, as relative paths", () => {
    const { partial } = slotDirs();
    expect(listFiles(partial)).toEqual([
      "colour/00.png",
      "depth/00.png",
      "id/00.png",
    ]);
  });

  test("a directory that does not exist has no files", () => {
    const { landed } = slotDirs();
    expect(listFiles(landed)).toEqual([]);
  });

  test("a directory moved away between listing it and descending into it contributes nothing, and does not throw", () => {
    const { partial, landed } = slotDirs();
    // The render script's rename lands right after the walk read the partial directory's entries.
    const racing = (dir: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      if (dir === partial) renameSync(partial, landed);
      return entries;
    };
    expect(listFiles(partial, racing)).toEqual([]);
    expect(listFiles(landed)).toHaveLength(3);
  });
});
