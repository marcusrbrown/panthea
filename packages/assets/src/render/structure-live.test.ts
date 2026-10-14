// Structures rendered by the real, pinned, headless Blender. Opt in with PANTHEA_LIVE_BLENDER=1
// (`bun run test:blender`); the executable is read from PANTHEA_BLENDER or the macOS bundle path.
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

/** Renders `slots` of a structure with the real Blender; the cells of each slot, in frame order. */
async function render(
  subject: string,
  pivot: { x: number; y: number },
  slots: readonly string[],
): Promise<{ rig: Rig; cells: Record<string, RgbaImage[]> }> {
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
  for (const [index, id] of ids.entries()) {
    const record = jobsById(rig)[id];
    if (record?.job.status !== "succeeded") throw new Error(`${id} failed`);
    cells[slots[index] as string] = record.job.outputs.map((output) => {
      const decoded = decodePng(
        rig.session.store.readBlob(output.hash) as Uint8Array,
      );
      if (!decoded.ok) throw new Error("cell does not decode");
      return decoded.image;
    });
  }
  return { rig, cells };
}

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
});
