import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeRgbaPng } from "../../../../packages/assets/src/placeholder";
import { compareRenderRoots } from "./cmd-render";

const ROLE_DIRS = [
  ["toon", ".toon.png"],
  ["id", ".id.png"],
  ["depth", ".depth.png"],
] as const;

/** A tiny RGBA image whose pixels depend on `seed`. */
function image(seed: number): Uint8Array {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = (seed * 37 + i) & 0xff;
    rgba[i + 1] = seed;
    rgba[i + 2] = 9;
    rgba[i + 3] = 255;
  }
  return rgba;
}

/** Writes `frames` (name stem to seed) for every role under `root`. */
function writeSet(root: string, frames: Record<string, number>): void {
  for (const [dir, suffix] of ROLE_DIRS) {
    mkdirSync(join(root, dir), { recursive: true });
    for (const [stem, seed] of Object.entries(frames))
      writeFileSync(
        join(root, dir, `${stem}${suffix}`),
        encodeRgbaPng(image(seed), 4, 4),
      );
  }
}

let temp: string;
let a: string;
let b: string;

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "studio-render-compare-"));
  a = join(temp, "a");
  b = join(temp, "b");
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

describe("compareRenderRoots", () => {
  test("identical complete sets pass", () => {
    writeSet(a, { f00: 1, f01: 2, f02: 3 });
    writeSet(b, { f00: 1, f01: 2, f02: 3 });
    const report = compareRenderRoots(a, b);
    expect(report.allPixelsIdentical).toBe(true);
    for (const role of Object.values(report.perRole)) {
      expect(role.files).toBe(3);
      expect(role.identicalPixels).toBe(3);
      expect(role.onlyInA).toEqual([]);
      expect(role.onlyInB).toEqual([]);
    }
  });

  test("equal-length sets that only partly overlap fail and name the unmatched files", () => {
    writeSet(a, { common: 1, onlyA: 2 });
    writeSet(b, { common: 1, onlyB: 2 });
    const report = compareRenderRoots(a, b);
    expect(report.allPixelsIdentical).toBe(false);
    for (const [, suffix] of ROLE_DIRS) {
      const role = Object.values(report.perRole).find((r) =>
        r.onlyInA.includes(`onlyA${suffix}`),
      );
      expect(role?.onlyInA).toEqual([`onlyA${suffix}`]);
      expect(role?.onlyInB).toEqual([`onlyB${suffix}`]);
    }
  });

  test("a missing frame on one side fails even when every shared frame matches", () => {
    writeSet(a, { f00: 1, f01: 2 });
    writeSet(b, { f00: 1 });
    const report = compareRenderRoots(a, b);
    expect(report.allPixelsIdentical).toBe(false);
    expect(report.perRole.colour?.onlyInA).toEqual(["f01.toon.png"]);
  });

  test("a shared frame whose pixels differ fails (positive control for the pixel check)", () => {
    writeSet(a, { f00: 1, f01: 2 });
    writeSet(b, { f00: 1, f01: 5 });
    const report = compareRenderRoots(a, b);
    expect(report.allPixelsIdentical).toBe(false);
    expect(report.perRole.colour?.differingFiles).toEqual(["f01.toon.png"]);
  });
});
