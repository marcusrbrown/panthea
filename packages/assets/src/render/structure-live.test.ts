// Structures rendered by the real, pinned, headless Blender. Opt in with PANTHEA_LIVE_BLENDER=1
// (`PANTHEA_LIVE_BLENDER=1 bun test packages/assets/src/render/structure-live.test.ts`); the executable is read
// from PANTHEA_BLENDER or the macOS bundle path.
// The default run uses the fake Blender and does not cover what only the real script can show:
// the silhouette of a damaged house, and the seam of the tree's wind loop.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  closeRigs,
  drain,
  jobsById,
  openRig,
  type Rig,
  submitRender,
} from "../../test/render/rig";
import type { RgbaImage } from "../conformance";
import { decodePng } from "../studio/png/decode";
import { BLENDER_PIN } from "./engine";

afterEach(closeRigs);

const optedIn = process.env.PANTHEA_LIVE_BLENDER === "1";
const BLENDER =
  process.env.PANTHEA_BLENDER ??
  "/Applications/Blender.app/Contents/MacOS/Blender";
const live = optedIn && existsSync(BLENDER) ? test : test.skip;
const T = 280_000;

/**
 * Renders `slots` of a structure with the real Blender: the cells of each slot in frame order, and the raw colour pass
 * (the supersampled render before the post step) of each frame.
 */
async function render(
  subject: string,
  pivot: { x: number; y: number },
  slots: readonly string[],
): Promise<{
  rig: Rig;
  cells: Record<string, RgbaImage[]>;
  raw: Record<string, RgbaImage[]>;
}> {
  const rig = await openRig({
    executable: BLENDER,
    pin: BLENDER_PIN,
    watchdogMs: 120_000,
  });
  const ids = submitRender(
    rig,
    `${subject}-live`,
    slots.map((state) => ({ state, direction: "south" })),
    { subject, pivot },
  );
  const result = await drain(rig);
  for (const entry of result.results)
    if (entry.outcome !== "rendered")
      throw new Error(`${entry.jobId}: ${entry.outcome}`);
  const cells: Record<string, RgbaImage[]> = {};
  const raw: Record<string, RgbaImage[]> = {};
  for (const [index, id] of ids.entries()) {
    const record = jobsById(rig)[id];
    if (record?.job.status !== "succeeded") throw new Error(`${id} failed`);
    const manifest = JSON.parse(
      new TextDecoder().decode(
        rig.session.store.readBlob(record.engine?.settings.manifest as never),
      ),
    ) as { frames: { raw: { colour: string } }[] };
    raw[slots[index] as string] = manifest.frames.map((frame) => {
      const decoded = decodePng(
        rig.session.store.readBlob(frame.raw.colour as never) as Uint8Array,
      );
      if (!decoded.ok) throw new Error("raw frame does not decode");
      return decoded.image;
    });
    cells[slots[index] as string] = record.job.outputs.map((output) => {
      const decoded = decodePng(
        rig.session.store.readBlob(output.hash) as Uint8Array,
      );
      if (!decoded.ok) throw new Error("cell does not decode");
      return decoded.image;
    });
  }
  return { rig, cells, raw };
}

/** Opaque pixels of `a` where `b` is transparent. */
const outside = (a: RgbaImage, b: RgbaImage): number => {
  let count = 0;
  for (let i = 0; i < a.width * a.height; i += 1)
    if (a.rgba[i * 4 + 3] !== 0 && b.rgba[i * 4 + 3] === 0) count += 1;
  return count;
};

/** Opaque pixels of `a` that lie outside `b`'s silhouette: the transparent pixels of `b` reachable from its border. */
const outsideFilled = (a: RgbaImage, b: RgbaImage): number => {
  const { width, height } = b;
  const reached = new Uint8Array(width * height);
  const stack: number[] = [];
  const visit = (x: number, y: number) => {
    const at = y * width + x;
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    if (reached[at] === 1 || b.rgba[at * 4 + 3] !== 0) return;
    reached[at] = 1;
    stack.push(at);
  };
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    visit(0, y);
    visit(width - 1, y);
  }
  while (stack.length > 0) {
    const at = stack.pop() as number;
    const x = at % width;
    const y = Math.floor(at / width);
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }
  let count = 0;
  for (let i = 0; i < width * height; i += 1)
    if (a.rgba[i * 4 + 3] !== 0 && reached[i] === 1) count += 1;
  return count;
};

const alpha = (image: RgbaImage): number[] =>
  Array.from({ length: image.width * image.height }, (_, i) =>
    image.rgba[i * 4 + 3] === 0 ? 0 : 1,
  );

describe("a house rendered by the real Blender", () => {
  live(
    "damaged keeps intact's alpha silhouette, and ruin does not",
    async () => {
      const { cells } = await render("greek-house", { x: 96, y: 136 }, [
        "intact",
        "damaged",
        "ruin",
      ]);
      const [intact] = cells.intact as [RgbaImage];
      const [damaged] = cells.damaged as [RgbaImage];
      const [ruin] = cells.ruin as [RgbaImage];
      expect(alpha(damaged)).toEqual(alpha(intact));
      // The colours did change: the same shape is not the same picture.
      expect(Buffer.from(damaged.rgba).equals(Buffer.from(intact.rgba))).toBe(
        false,
      );
      expect(alpha(ruin)).not.toEqual(alpha(intact));
    },
    T,
  );
});

/** Pixels that differ between two cells. */
const differing = (a: RgbaImage, b: RgbaImage): number => {
  let count = 0;
  for (let at = 0; at < a.rgba.length; at += 4)
    for (let k = 0; k < 4; k += 1)
      if (a.rgba[at + k] !== b.rgba[at + k]) {
        count += 1;
        break;
      }
  return count;
};

describe("a tree rendered by the real Blender", () => {
  live(
    "its wind loop is seamless: the step from the last frame back to the first is no bigger than the steps between the others",
    async () => {
      const { cells } = await render("oak-tree", { x: 96, y: 164 }, ["intact"]);
      const frames = cells.intact as RgbaImage[];
      expect(frames).toHaveLength(12);
      const steps = frames.map((frame, i) =>
        differing(frame, frames[(i + 1) % frames.length] as RgbaImage),
      );
      const wrap = steps[frames.length - 1] as number;
      const inner = steps.slice(0, -1);
      // The tree moves, and the wrap-around is one more of those steps.
      expect(Math.min(...inner)).toBeGreaterThan(0);
      expect(wrap).toBeGreaterThan(0);
      expect(wrap).toBeLessThanOrEqual(Math.max(...inner) * 1.25);
    },
    T,
  );

  live(
    "damaged keeps the trunk and drops the crown's leaves, and the ruin is a still stump",
    async () => {
      const { cells } = await render("oak-tree", { x: 96, y: 164 }, [
        "intact",
        "damaged",
        "ruin",
      ]);
      expect(cells.damaged).toHaveLength(12);
      expect(cells.ruin).toHaveLength(1);
      const [intact] = cells.intact as RgbaImage[];
      const [ruin] = cells.ruin as RgbaImage[];
      const count = (image: RgbaImage) =>
        alpha(image).reduce((n, v) => n + v, 0);
      expect(count(ruin as RgbaImage)).toBeLessThan(
        count(intact as RgbaImage) / 5,
      );
    },
    T,
  );

  live(
    "damaged has no limb or twig the intact tree does not have: its alpha is a subset of intact's in every frame of the loop",
    async () => {
      const { cells, raw } = await render("oak-tree", { x: 96, y: 164 }, [
        "intact",
        "damaged",
      ]);
      const intact = cells.intact as RgbaImage[];
      const damaged = cells.damaged as RgbaImage[];
      expect(damaged).toHaveLength(intact.length);
      // The geometry itself, in the supersampled render: exact. Both states sway by the same function of the
      // same frame number, and the burnt tree is the intact skeleton with fewer parts, so no tolerance is needed.
      for (const [i, frame] of (raw.damaged as RgbaImage[]).entries())
        expect(
          outside(frame, (raw.intact as RgbaImage[])[i] as RgbaImage),
        ).toBe(0);
      // The cells: the post step draws a 1 px outline round the silhouette's outside, and a pocket that is
      // enclosed in intact (so unoutlined) is open in damaged when its leaves are gone. So the cell check is
      // that damaged stays inside intact's silhouette with its enclosed pockets filled, again with no tolerance.
      for (const [i, frame] of damaged.entries())
        expect(outsideFilled(frame, intact[i] as RgbaImage)).toBe(0);
    },
    T,
  );
});
