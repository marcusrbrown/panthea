import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  EFFECTS_MODES,
  FIRE_ANIMATION,
  FIRE_ASSET,
  oneShotFrameAt,
  STRIKE_ASSET,
  STRUCTURE_ANCHORS,
  STRUCTURE_ASSETS,
  STRUCTURE_STATES,
  strikeAnimation,
} from "./structures";

const REGISTRY = new URL(
  "../../../content/greek/assets/registry/",
  import.meta.url,
);

interface Manifest {
  readonly id: string;
  readonly cell: { readonly w: number; readonly h: number };
  readonly pivot: { readonly x: number; readonly y: number };
  readonly animations: readonly {
    readonly name?: string;
    readonly state?: string;
    readonly direction?: string;
    readonly frames: readonly { readonly durationMs: number }[];
  }[];
}

/** The committed canon manifest of `id`, read the way the registry names it: the index revision is the file stem. */
function committed(id: string): Manifest {
  const index = JSON.parse(
    readFileSync(new URL("index.json", REGISTRY), "utf8"),
  ) as { entries: { assetId: string; revision: string }[] };
  const entry = index.entries.find((candidate) => candidate.assetId === id);
  if (entry === undefined) throw new Error(`${id} is not published`);
  return JSON.parse(
    readFileSync(new URL(`manifests/${entry.revision}.json`, REGISTRY), "utf8"),
  ) as Manifest;
}

test("a one-shot shows each frame for its own duration, then is finished", () => {
  const durations = [110, 90, 70];

  expect(oneShotFrameAt(durations, 0)).toBe(0);
  expect(oneShotFrameAt(durations, 109)).toBe(0);
  expect(oneShotFrameAt(durations, 110)).toBe(1);
  expect(oneShotFrameAt(durations, 199)).toBe(1);
  expect(oneShotFrameAt(durations, 200)).toBe(2);
  expect(oneShotFrameAt(durations, 269)).toBe(2);
  // Exactly the total is already over; a one-shot never loops back.
  expect(oneShotFrameAt(durations, 270)).toBeUndefined();
  expect(oneShotFrameAt(durations, 10_000)).toBeUndefined();
});

test("a one-shot that has not started shows its first frame, whatever the clock reads", () => {
  expect(oneShotFrameAt([50, 50], -5)).toBe(0);
  expect(oneShotFrameAt([50, 50], Number.NaN)).toBe(0);
  expect(oneShotFrameAt([50, 50], Number.NEGATIVE_INFINITY)).toBe(0);
});

test("a one-shot with no duration to show is finished at once, and a zero-length frame is never shown", () => {
  expect(oneShotFrameAt([], 0)).toBeUndefined();
  expect(oneShotFrameAt([0, 0], 0)).toBeUndefined();
  expect(oneShotFrameAt([0, 40], 0)).toBe(1);
});

test("the effects setting names the strike animation it plays", () => {
  expect([...EFFECTS_MODES]).toEqual(["full", "calm"]);
  expect(strikeAnimation("full")).toBe("full");
  expect(strikeAnimation("calm")).toBe("calm");
});

test("every published asset the game and the studio draw exists, with the animations and states they select", () => {
  expect(STRUCTURE_ASSETS).toEqual({
    tree: "oak-tree",
    building: "greek-house",
  });
  for (const art of ["tree", "building"] as const) {
    const manifest = committed(STRUCTURE_ASSETS[art]);
    for (const state of STRUCTURE_STATES) {
      expect(
        manifest.animations.some(
          (animation) =>
            animation.state === state && animation.direction === "south",
        ),
      ).toBe(true);
    }
  }
  const fire = committed(FIRE_ASSET);
  expect(fire.animations.map((animation) => animation.name)).toContain(
    FIRE_ANIMATION,
  );
  const strike = committed(STRIKE_ASSET);
  for (const mode of EFFECTS_MODES) {
    expect(strike.animations.map((animation) => animation.name)).toContain(
      strikeAnimation(mode),
    );
  }
});

test("each structure's fire and strike anchors lie inside its published cell, measured from its foot", () => {
  for (const art of ["tree", "building"] as const) {
    const { cell, pivot } = committed(STRUCTURE_ASSETS[art]);
    for (const anchor of [
      STRUCTURE_ANCHORS[art].fire,
      STRUCTURE_ANCHORS[art].strike,
    ]) {
      // An anchor is an offset from the foot (the manifest pivot), y down.
      expect(pivot.x + anchor.x).toBeGreaterThanOrEqual(0);
      expect(pivot.x + anchor.x).toBeLessThan(cell.w);
      expect(pivot.y + anchor.y).toBeGreaterThanOrEqual(0);
      expect(pivot.y + anchor.y).toBeLessThan(cell.h);
    }
  }
});
