// The recipe module: the locator mapping from the script's `done.json` shape to the post step's
// `StampLocators`, and the revision and slot recipe hashes.

import { describe, expect, it } from "bun:test";
import type { Sha256 } from "@panthea/contracts";
import { loadRenderFixture } from "../../test/render/fixture";
import {
  cellPixelHash,
  POST_STEP_VERSION,
  postProcessSlot,
  type RawFrame,
  type StampLocators,
} from "./post";
import {
  POST_SETTINGS,
  postSettingsFor,
  postStepSettings,
  type RevisionInputs,
  revisionRecipe,
  slotRecipeHash,
  stampLocatorsFrom,
} from "./recipe";
import {
  type DoneSentinel,
  type FrameLocators,
  parseDoneSentinel,
} from "./script-contract";

const fixture = loadRenderFixture();
const H = (c: string) => c.repeat(64) as Sha256;

/** What render.py writes for a frame: eyes and brows as `points` keyed `<mesh>_<side>`. */
function sentinelLocators(locators: StampLocators | undefined): FrameLocators {
  const points: Record<string, { px: [number, number]; depth: number }> = {};
  for (const side of ["l", "r"] as const) {
    const eye = locators?.eyes?.[side];
    if (eye !== undefined) {
      points[`eyes_${side}`] = {
        px: [eye.px[0], eye.px[1]],
        depth: eye.depth,
      };
      // The brow locator is written too; the face stamp carries its own brow pixels.
      points[`eyebrows_${side}`] = {
        px: [eye.px[0], eye.px[1] - 2],
        depth: eye.depth,
      };
    }
  }
  return { points };
}

function sentinelOf(locators: readonly FrameLocators[]): DoneSentinel {
  const frames = locators.length;
  const files = (role: string) =>
    locators.map((_, i) => ({
      name: `${role}/${String(i).padStart(2, "0")}.png`,
      sha256: H("a"),
    }));
  return {
    schemaVersion: 1,
    slot: "zeus-0000",
    blender: { version: "5.2.2", buildHash: "d13f752e3b9c" },
    frames,
    files: { colour: files("colour"), id: files("id"), depth: files("depth") },
    sourceFrames: locators.map((_, i) => i),
    extentPx: locators.map(() => ({ top: 0, bottom: 1, left: 0, right: 1 })),
    locators: [...locators],
  };
}

describe("locator mapping (U6 done.json to U5 StampLocators)", () => {
  it("maps a real sentinel's eye points to the post step's shape", () => {
    const locators = fixture.frames.map((f) => sentinelLocators(f.locators));
    // Through the real parser, with the JSON round trip the runner does.
    const parsed = parseDoneSentinel(
      JSON.parse(JSON.stringify(sentinelOf(locators))),
      { slot: "zeus-0000", frames: locators.length },
    );
    if (!parsed.ok) throw new Error(parsed.message);
    parsed.value.locators.forEach((l, i) => {
      expect(stampLocatorsFrom(l)).toEqual(
        fixture.frames[i]?.locators as StampLocators,
      );
    });
  });

  it("leaves the eyes out when the sentinel has none, and refuses a sentinel that carries a bolt locator", () => {
    expect(stampLocatorsFrom({ points: {} })).toEqual({});
    const withBolt = sentinelOf([{ points: {} }]);
    const bolted = {
      ...withBolt,
      locators: [
        { bolt: { basePx: [1, 2], tipPx: [3, 4], baseDepth: 19 }, points: {} },
      ],
    };
    const parsed = parseDoneSentinel(JSON.parse(JSON.stringify(bolted)), {
      slot: "zeus-0000",
      frames: 1,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.path).toContain("bolt");
    const oneEye = stampLocatorsFrom({
      points: { eyes_l: { px: [5, 6], depth: 18.5 } },
    });
    expect(oneEye).toEqual({ eyes: { l: { px: [5, 6], depth: 18.5 } } });
  });

  it("post-processes the fixture slot from mapped locators to the committed cell hashes", () => {
    const sentinel = sentinelOf(
      fixture.frames.map((f) => sentinelLocators(f.locators)),
    );
    const frames: RawFrame[] = fixture.frames.map((f, i) => ({
      ...f,
      locators: stampLocatorsFrom(sentinel.locators[i] as FrameLocators),
    }));
    const result = postProcessSlot({ ...fixture.input, frames });
    if (!result.ok) throw new Error(result.message);
    result.cells.forEach((cell, i) => {
      expect(cellPixelHash(cell.image) as string).toBe(
        fixture.expected.cells[i]?.pixelHash as string,
      );
    });
  });
});

const inputs = (over: Partial<RevisionInputs> = {}): RevisionInputs => ({
  profile: H("1"),
  camera: H("2"),
  palette: { id: "greek-retro", digest: H("3") },
  pivot: { x: 56, y: 78 },
  script: H("4"),
  postStep: { version: 2, settings: postSettingsFor("lapis") },
  blender: {
    version: "5.2.2",
    buildHash: "d13f752e3b9c",
    binarySha256: H("5"),
  },
  kit: H("6"),
  stamps: H("7"),
  ...over,
});

describe("the post step's fixed settings", () => {
  it("is post step v3 (no prop stamps), with the contact shadow taken from the darkest shade of a ramp the profile names", () => {
    expect(POST_STEP_VERSION).toBe(3);
    expect(POST_SETTINGS.shadow.shade).toBe(0);
    expect(postSettingsFor("lapis")).toEqual({
      overlapThresholdM: 0.05,
      shadow: { rx: 10, ry: 5, ramp: "lapis", shade: 0 },
    });
    // The ramp is not hard-coded: another profile's ramp is what the settings carry.
    expect(postSettingsFor("marble").shadow?.ramp).toBe("marble");
    const camera = {
      cell: { width: 112, height: 96, pivot: [56, 78] as const },
      depthRange: [18, 22] as const,
    };
    expect(
      postStepSettings(camera, { x: 56, y: 78 }, postSettingsFor("cloud")),
    ).toMatchObject({
      shadow: { ramp: "cloud", shade: 0 },
      overlapThresholdM: 0.05,
    });
  });
});

describe("recipe hashes", () => {
  const base = revisionRecipe(inputs()).hash;

  it("is stable for the same inputs and independent of key order", () => {
    expect(revisionRecipe(inputs()).hash).toBe(base);
    const reordered = inputs();
    const shuffled = {
      stamps: reordered.stamps,
      kit: reordered.kit,
      blender: reordered.blender,
      postStep: reordered.postStep,
      script: reordered.script,
      pivot: reordered.pivot,
      palette: reordered.palette,
      camera: reordered.camera,
      profile: reordered.profile,
    } satisfies RevisionInputs;
    expect(revisionRecipe(shuffled).hash).toBe(base);
  });

  it("changes with each field the revision covers", () => {
    const variants: Partial<RevisionInputs>[] = [
      { profile: H("a") },
      { camera: H("a") },
      { palette: { id: "greek-retro", digest: H("a") } },
      { palette: { id: "greek-master", digest: H("3") } },
      { pivot: { x: 56, y: 77 } },
      { script: H("a") },
      { postStep: { version: 3, settings: postSettingsFor("lapis") } },
      { postStep: { version: 2, settings: postSettingsFor("marble") } },
      {
        postStep: {
          version: 2,
          settings: { ...postSettingsFor("lapis"), overlapThresholdM: 0.06 },
        },
      },
      { blender: { ...inputs().blender, buildHash: "000000000000" } },
      { blender: { ...inputs().blender, version: "5.2.3" } },
      { blender: { ...inputs().blender, binarySha256: H("a") } },
      { kit: H("a") },
      { stamps: H("a") },
    ];
    for (const change of variants)
      expect(revisionRecipe(inputs(change)).hash).not.toBe(base);
  });

  it("records the 8-bit depth quantisation in the recipe", () => {
    expect(revisionRecipe(inputs()).fields.postStep.depthBits).toBe(8);
  });

  it("gives each slot its own hash from the revision hash plus state, clip, facing and seed", () => {
    const slot = {
      state: "walk",
      clip: "walk16",
      facing: "south",
      seed: 0,
    } as const;
    const first = slotRecipeHash(base, slot);
    expect(slotRecipeHash(base, slot)).toBe(first);
    for (const change of [
      { state: "idle" },
      { clip: "walk8" },
      { facing: "east" },
      { seed: 1 },
    ] as const)
      expect(slotRecipeHash(base, { ...slot, ...change })).not.toBe(first);
    const other = revisionRecipe(inputs({ script: H("a") })).hash;
    expect(slotRecipeHash(other, slot)).not.toBe(first);
  });
});
