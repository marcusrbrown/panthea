import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decodePng } from "@panthea/assets/studio";

import {
  EFFECTS_MODES,
  FIRE_ANIMATION,
  FIRE_ASSET,
  oneShotFrameAt,
  STRIKE_ASSET,
  STRUCTURE_ANCHORS,
  STRUCTURE_ASSETS,
  STRUCTURE_FOOTPRINTS,
  STRUCTURE_PIVOTS,
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
  readonly footprint: { readonly w: number; readonly h: number };
  readonly animations: readonly {
    readonly name?: string;
    readonly state?: string;
    readonly direction?: string;
    readonly frames: readonly {
      readonly durationMs: number;
      readonly rect: Rect;
    }[];
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

test("a structure's footprint and foot are the ones its published art declares, so the placeholder and the layout stand in with what canon draws with", () => {
  // The house's footprint is the 2 by 3 tiles of its plinth that hang from the plinth's lowest point; the tree's, one.
  expect(STRUCTURE_FOOTPRINTS).toEqual({
    building: { w: 2, h: 3 },
    tree: { w: 1, h: 1 },
  });
  // The foot is the pivot, on the bottom vertex of the footprint's bottom cell: the house's on the plinth's lowest
  // point, the bottom edge of its lowest pixel row on a 192x192 cell; the oak's at its trunk.
  expect(STRUCTURE_PIVOTS).toEqual({
    building: { x: 65, y: 181 },
    tree: { x: 96, y: 164 },
  });
  for (const art of ["tree", "building"] as const) {
    const manifest = committed(STRUCTURE_ASSETS[art]);
    expect(STRUCTURE_FOOTPRINTS[art], `${art} footprint`).toEqual(
      manifest.footprint,
    );
    expect(STRUCTURE_PIVOTS[art], `${art} pivot`).toEqual(manifest.pivot);
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

/** The opaque pixels of the intact south frame of `id`, by cell pixel: the first frame of the first intact animation. */
function intactFrame(id: string) {
  const manifest = committed(id) as Manifest & { atlas: { blob: string } };
  const png = decodePng(
    new Uint8Array(
      readFileSync(new URL(`blobs/${manifest.atlas.blob}.png`, REGISTRY)),
    ),
  );
  if (!png.ok) throw new Error(`${id}'s atlas does not decode`);
  const animation = manifest.animations.find((a) => a.state === "intact");
  const rect = animation?.frames[0]?.rect;
  if (rect === undefined) throw new Error(`${id} has no intact frame`);
  const opaque = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < rect.w &&
    y < rect.h &&
    (png.image.rgba[((rect.y + y) * png.image.width + rect.x + x) * 4 + 3] ??
      0) > 0;
  return { manifest, opaque };
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

test("the fire and the strike land on the structure's art: each anchor, from the published foot, is an opaque pixel of the intact cell", () => {
  for (const art of ["tree", "building"] as const) {
    const { manifest, opaque } = intactFrame(STRUCTURE_ASSETS[art]);
    for (const [name, anchor] of [
      ["fire", STRUCTURE_ANCHORS[art].fire],
      ["strike", STRUCTURE_ANCHORS[art].strike],
    ] as const)
      expect(
        opaque(manifest.pivot.x + anchor.x, manifest.pivot.y + anchor.y),
        `${art} ${name} at (${manifest.pivot.x + anchor.x}, ${manifest.pivot.y + anchor.y})`,
      ).toBe(true);
  }
});

test("the house's foot is on its lowest pixel: the cell's last opaque row ends at the pivot, at the pivot's column", () => {
  const { manifest, opaque } = intactFrame(STRUCTURE_ASSETS.building);
  let lowest = -1;
  for (let y = manifest.cell.h - 1; y >= 0 && lowest < 0; y -= 1)
    for (let x = 0; x < manifest.cell.w; x += 1)
      if (opaque(x, y)) {
        lowest = y;
        break;
      }
  expect(lowest + 1).toBe(manifest.pivot.y);
  // Its tip, the porch's front corner, is the one opaque pixel of that row, or within a pixel of the pivot column.
  const tip = Array.from({ length: manifest.cell.w }, (_, x) => x).filter((x) =>
    opaque(x, lowest),
  );
  expect(
    Math.min(...tip.map((x) => Math.abs(x - manifest.pivot.x))),
  ).toBeLessThanOrEqual(1);
});
