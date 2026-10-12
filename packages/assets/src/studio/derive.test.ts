// The derivation core: mirror, palette swap and bob over RGBA frames. Fixtures
// are built here from the real palette; nothing reads a clock or a registry
// except the canon idle cell, which is read-only and pinned by revision.

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AssetId,
  durationBounds,
  parseAssetVocabulary,
  type Sha256,
} from "@panthea/contracts";
import { conformImage, type Rgb, type RgbaImage } from "../conformance";
import { type Palette, parsePalette } from "../palette";
import { encodeRgbaPng } from "../placeholder";
import {
  type BobInput,
  type BobParams,
  bobSlot,
  type DerivedSlot,
  derivationRuntime,
  mirrorSlot,
  RECIPE_VERSION,
  type SlotInput,
  type SourceRef,
  slotHash,
  swapImage,
  swapPalette,
} from "./derive";
import { decodePng } from "./png/decode";

const CONTENT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "content",
  "greek",
);

function masterPalette(): Palette {
  const read = (name: string) =>
    readFileSync(join(CONTENT, "palette", name), "utf8");
  const parsed = parsePalette(
    {
      json: JSON.parse(read("palette.json")),
      gpl: read("master.gpl"),
      hex: read("master.hex"),
    },
    ["town", "olympus", "underworld"],
  );
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

const palette = masterPalette();
const family = (id: string) => {
  const found = palette.families.find((f) => f.id === id);
  if (found === undefined) throw new Error(`no family ${id}`);
  return found;
};
const olympus = family("olympus");
const underworld = family("underworld");
const olympusColours: Rgb[] = olympus.ramps.flatMap((r) => [...r.shades]);

const [W, H] = [64, 80];
const GEOMETRY = {
  cell: { w: W, h: H },
  pivot: { x: 32, y: 80 },
  footprint: { w: 1, h: 1 },
};
const SOURCE: SourceRef = {
  assetId: "zeus-sprite" as AssetId,
  revision: "a".repeat(64) as Sha256,
};
const NO_ASYMMETRY = {};
const BOLT_HAND = { asymmetry: { feature: "bolt hand" } };

function blank(w = W, h = H): RgbaImage {
  return { rgba: new Uint8Array(w * h * 4), width: w, height: h };
}

function paint(
  image: RgbaImage,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: Rgb,
  alpha = 255,
): RgbaImage {
  for (let row = y; row < y + h; row += 1)
    for (let col = x; col < x + w; col += 1) {
      const at = (row * image.width + col) * 4;
      image.rgba.set([rgb[0], rgb[1], rgb[2], alpha], at);
    }
  return image;
}

const shade = (ramp: number, index: number): Rgb =>
  (olympus.ramps[ramp] as { shades: readonly Rgb[] }).shades[index] as Rgb;

/** A figure whose columns mirror about the cell centre: x and 63 - x always match. */
function symmetricFigure(headRise = 0): RgbaImage {
  const image = blank();
  paint(image, 28, 10 - headRise, 8, 8, shade(0, 2)); // head
  paint(image, 24, 18, 16, 30, shade(2, 1)); // robe
  paint(image, 26, 48, 12, 26, shade(2, 0)); // hem
  paint(image, 29, 74, 6, 4, shade(1, 0)); // feet
  return image;
}

/** The same figure with a held bolt on its east side only: no pixel-symmetry. */
function lopsidedFigure(headRise = 0): RgbaImage {
  const image = symmetricFigure(headRise);
  paint(image, 40, 20, 4, 14, shade(1, 2));
  paint(image, 44, 16, 2, 10, shade(3, 3));
  return image;
}

const DURATIONS = [333, 167, 333, 167];

function idleSlot(
  direction: string,
  figure: (rise: number) => RgbaImage,
  loopStart?: number,
): SlotInput {
  return {
    key: `idle/${direction}`,
    frames: DURATIONS.map((durationMs, i) => ({
      image: figure(i % 2),
      durationMs,
    })),
    ...(loopStart === undefined ? {} : { loopStart }),
  };
}

const flipped = (image: RgbaImage): RgbaImage => {
  const out = blank(image.width, image.height);
  for (let y = 0; y < image.height; y += 1)
    for (let x = 0; x < image.width; x += 1) {
      const from = (y * image.width + (image.width - 1 - x)) * 4;
      out.rgba.set(
        image.rgba.subarray(from, from + 4),
        (y * image.width + x) * 4,
      );
    }
  return out;
};

const pixel = (image: RgbaImage, x: number, y: number) => [
  ...image.rgba.subarray(
    (y * image.width + x) * 4,
    (y * image.width + x) * 4 + 4,
  ),
];

/** Throws unless the derivation succeeded, so the happy-path tests read straight. */
function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
}

function refusal<T extends { ok: boolean }>(result: T) {
  expect(result.ok).toBe(false);
  return result as Extract<T, { ok: false }>;
}

const checkOf = (west: RgbaImage, east: RgbaImage, asymmetry = false) => {
  const result = conformImage({
    rgba: west.rgba,
    width: west.width,
    height: west.height,
    kind: "sprite",
    mode: "report-only",
    cell: { w: W, h: H },
    pivot: { x: 32, y: 80 },
    paletteRgb: olympusColours,
    background: { type: "alpha" },
    alphaCutoff: 128,
    grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
    scale: 1,
    mirror: { east, west, asymmetry },
  });
  if (result.status !== "done") throw new Error(result.status);
  return result.report.checks.find((c) => c.check === "mirror");
};

describe("slotHash and the pinned identities", () => {
  it("hashes frames' RGBA in order plus the duration list, ignoring RGB under alpha 0", () => {
    const slot = idleSlot("east", symmetricFigure);
    const again = idleSlot("east", symmetricFigure);
    expect(slotHash(slot)).toBe(slotHash(again));
    const noisy = idleSlot("east", symmetricFigure);
    (noisy.frames[0] as { image: RgbaImage }).image.rgba.set([9, 8, 7, 0], 0);
    expect(slotHash(noisy)).toBe(slotHash(slot));
    const slower = {
      ...slot,
      frames: slot.frames.map((f, i) =>
        i === 0 ? { ...f, durationMs: 334 } : f,
      ),
    };
    expect(slotHash(slower)).not.toBe(slotHash(slot));
    const reordered = { ...slot, frames: [...slot.frames].reverse() };
    expect(slotHash(reordered)).not.toBe(slotHash(slot));
  });

  it("names the recipe version and the encoder in the runtime ref", () => {
    expect(derivationRuntime("mirror")).toEqual({
      name: "panthea-derive",
      version: `mirror@${RECIPE_VERSION.mirror}+encodeRgbaPng@1`,
    });
    expect(derivationRuntime("bob", 2).version).toBe("bob@2+encodeRgbaPng@1");
  });
});

describe("mirror east to west", () => {
  const east = idleSlot("east", lopsidedFigure, 2);
  const input = {
    source: SOURCE,
    slot: east,
    subject: NO_ASYMMETRY,
    geometry: GEOMETRY,
  };

  it("flips every frame and keeps order, durations, loop start, pivot and footprint", () => {
    const done = must(mirrorSlot(input));
    expect(done.slots).toHaveLength(1);
    const [west] = done.slots as [DerivedSlot];
    expect(west.key).toBe("idle/west");
    expect(west.frames.map((f) => f.durationMs)).toEqual(DURATIONS);
    expect(west.loopStart).toBe(2);
    expect(done.pivot).toEqual(GEOMETRY.pivot);
    expect(done.footprint).toEqual(GEOMETRY.footprint);
    for (const [i, frame] of west.frames.entries()) {
      const source = (east.frames[i] as { image: RgbaImage }).image;
      expect(frame.image.rgba).toEqual(flipped(source).rgba);
    }
    // The bolt is east-only, so the flip changed pixels the figure did not mirror.
    const source0 = (east.frames[0] as { image: RgbaImage }).image;
    expect(pixel(source0, 41, 25)).not.toEqual(pixel(source0, 22, 25));
    expect(
      pixel((west.frames[0] as { image: RgbaImage }).image, 22, 25),
    ).toEqual(pixel(source0, 41, 25));
  });

  it("records one step per output slot: recipe, version, params, source slot hash, output slot, result hash", () => {
    const done = must(mirrorSlot(input));
    const [west] = done.slots as [DerivedSlot];
    expect(done.steps).toEqual([
      {
        recipe: "mirror",
        version: RECIPE_VERSION.mirror,
        params: { from: "east", to: "west" },
        source: {
          assetId: SOURCE.assetId,
          revision: SOURCE.revision,
          slotKey: "idle/east",
          slotHash: slotHash(east),
        },
        outputSlot: "idle/west",
        resultHash: west.resultHash,
      },
    ]);
  });

  it("is byte-identical across runs, and encodes the zeroed-RGB frame", () => {
    const first = must(mirrorSlot(input));
    const second = must(mirrorSlot(input));
    expect(first.steps).toEqual(second.steps);
    for (const [i, frame] of (first.slots[0] as DerivedSlot).frames.entries()) {
      const other = (second.slots[0] as DerivedSlot).frames[i] as {
        png: Uint8Array;
      };
      expect(frame.png).toEqual(other.png);
      expect(frame.png).toEqual(
        encodeRgbaPng(frame.image.rgba, frame.image.width, frame.image.height),
      );
    }
  });

  it("passes the conformance mirror check for each frame, and the check bites on a bad west", () => {
    const done = must(mirrorSlot(input));
    for (const [i, frame] of (done.slots[0] as DerivedSlot).frames.entries()) {
      const source = (east.frames[i] as { image: RgbaImage }).image;
      expect(checkOf(frame.image, source)).toMatchObject({ status: "pass" });
    }
    const source0 = (east.frames[0] as { image: RgbaImage }).image;
    expect(checkOf(source0, source0)).toMatchObject({ status: "fail" });
  });

  it("zeroes RGB under alpha 0 before encoding, and the PNG decodes to what was derived", () => {
    const noisy = idleSlot("east", lopsidedFigure);
    (noisy.frames[0] as { image: RgbaImage }).image.rgba.set(
      [200, 100, 50, 0],
      0,
    );
    const done = must(mirrorSlot({ ...input, slot: noisy }));
    const frame = (done.slots[0] as DerivedSlot)
      .frames[0] as DerivedSlot["frames"][number];
    const decoded = decodePng(frame.png);
    if (!decoded.ok) throw new Error(decoded.message);
    for (let at = 0; at < decoded.image.rgba.length; at += 4) {
      if (decoded.image.rgba[at + 3] === 0)
        expect([...decoded.image.rgba.subarray(at, at + 3)]).toEqual([0, 0, 0]);
    }
    expect(decoded.image.rgba).toEqual(frame.image.rgba);
  });

  it("allows idle, seated, hurt and down", () => {
    for (const state of ["idle", "seated", "hurt", "down"]) {
      const slot: SlotInput = {
        key: `${state}/east`,
        frames: [{ image: symmetricFigure(), durationMs: 200 }],
      };
      const done = must(mirrorSlot({ ...input, slot }));
      expect((done.slots[0] as DerivedSlot).key).toBe(`${state}/west`);
    }
  });

  it("refuses a declared asymmetry, naming the feature", () => {
    const refused = refusal(mirrorSlot({ ...input, subject: BOLT_HAND }));
    expect(refused.reason).toBe("asymmetric");
    expect(refused.message).toContain("bolt hand");
  });

  it("refuses an off-centre pivot and a non-square footprint", () => {
    expect(
      refusal(
        mirrorSlot({
          ...input,
          geometry: { ...GEOMETRY, pivot: { x: 31, y: 80 } },
        }),
      ).reason,
    ).toBe("off-centre-pivot");
    expect(
      refusal(
        mirrorSlot({
          ...input,
          geometry: { ...GEOMETRY, footprint: { w: 2, h: 1 } },
        }),
      ).reason,
    ).toBe("non-square-footprint");
  });

  it("refuses walk and act as non-derivable, even when the subject is asymmetric", () => {
    for (const key of ["walk/east", "act/east/thunderbolt"]) {
      for (const subject of [NO_ASYMMETRY, BOLT_HAND]) {
        const refused = refusal(
          mirrorSlot({
            ...input,
            subject,
            slot: {
              key,
              frames: [{ image: symmetricFigure(), durationMs: 90 }],
            },
          }),
        );
        expect(refused.reason).toBe("non-derivable");
        expect(refused.message).toContain("repair");
      }
    }
  });

  it("derives west from east only", () => {
    for (const direction of ["south", "north", "west"]) {
      const refused = refusal(
        mirrorSlot({ ...input, slot: idleSlot(direction, symmetricFigure) }),
      );
      expect(refused.reason).toBe("non-derivable");
    }
  });

  it("refuses a frame that is not the cell size, and an empty slot", () => {
    const small: SlotInput = {
      key: "idle/east",
      frames: [{ image: blank(8, 8), durationMs: 200 }],
    };
    expect(refusal(mirrorSlot({ ...input, slot: small })).reason).toBe(
      "invalid-params",
    );
    expect(
      refusal(mirrorSlot({ ...input, slot: { key: "idle/east", frames: [] } }))
        .reason,
    ).toBe("invalid-params");
  });

  it("bumping the recipe version changes the step identity and not the pixels", () => {
    const one = must(mirrorSlot(input));
    const two = must(mirrorSlot({ ...input, version: 2 }));
    expect(two.steps[0]?.version).toBe(2);
    expect(two.steps[0]).not.toEqual(one.steps[0]);
    expect(two.steps[0]?.resultHash).toBe(one.steps[0]?.resultHash);
    expect(two.slots).toEqual(one.slots);
  });
});

describe("palette swap", () => {
  const pairs = olympus.ramps.map((source, i) => ({
    source,
    target: underworld.ramps[i] as (typeof underworld.ramps)[number],
  }));
  const asset = (): SlotInput[] => {
    const idle = idleSlot("south", symmetricFigure);
    const first = (idle.frames[0] as { image: RgbaImage }).image;
    paint(first, 2, 2, 1, 1, shade(3, 3), 128); // a partial-alpha pixel
    first.rgba.set([77, 66, 55, 0], (5 * W + 5) * 4); // noise under alpha 0
    const act: SlotInput = {
      key: "act/south/thunderbolt",
      loopStart: 1,
      frames: [0, 1, 2, 3].map((i) => ({
        image: lopsidedFigure(i % 2),
        durationMs: 90,
      })),
    };
    return [idle, act];
  };
  const input = {
    source: SOURCE,
    slots: asset(),
    sourceFamily: "olympus",
    targetFamily: "underworld",
    pairs,
  };

  it("maps every opaque colour olympus to underworld by ramp and index, act slots included", () => {
    const done = must(swapPalette(input));
    expect(done.slots.map((s) => s.key)).toEqual([
      "idle/south",
      "act/south/thunderbolt",
    ]);
    const swap = new Map(
      pairs.flatMap(({ source, target }) =>
        source.shades.map(
          (s, i) => [s.join(","), target.shades[i] as Rgb] as const,
        ),
      ),
    );
    for (const [s, slot] of done.slots.entries()) {
      const from = (input.slots[s] as SlotInput).frames;
      expect(slot.frames).toHaveLength(from.length);
      for (const [f, frame] of slot.frames.entries()) {
        const before = (from[f] as { image: RgbaImage }).image;
        for (let at = 0; at < before.rgba.length; at += 4) {
          const out = [...frame.image.rgba.subarray(at, at + 4)];
          expect(out[3]).toBe(before.rgba[at + 3] as number);
          if (out[3] === 0) {
            expect(out.slice(0, 3)).toEqual([0, 0, 0]);
            continue;
          }
          const key = [...before.rgba.subarray(at, at + 3)].join(",");
          expect(out.slice(0, 3)).toEqual([...(swap.get(key) as Rgb)]);
        }
      }
    }
    const act = done.slots[1] as DerivedSlot;
    expect(act.loopStart).toBe(1);
    expect(act.frames.map((f) => f.durationMs)).toEqual([90, 90, 90, 90]);
  });

  it("returns the colour map keyed by source ramp and index, covering the whole pair table", () => {
    const done = must(swapPalette(input));
    expect(done.map).toHaveLength(16);
    expect(done.map[0]).toEqual({
      source: { ramp: "marble", index: 0 },
      target: { ramp: "ash", index: 0 },
    });
    expect(done.map[15]).toEqual({
      source: { ramp: "cloud", index: 3 },
      target: { ramp: "ember", index: 3 },
    });
  });

  it("records one step per slot with the family and ramp pairing as params", () => {
    const done = must(swapPalette(input));
    expect(done.steps).toHaveLength(2);
    const [idle] = done.steps;
    expect(idle).toMatchObject({
      recipe: "palette-swap",
      version: RECIPE_VERSION["palette-swap"],
      outputSlot: "idle/south",
      source: {
        assetId: SOURCE.assetId,
        slotKey: "idle/south",
        slotHash: slotHash(input.slots[0] as SlotInput),
      },
      resultHash: (done.slots[0] as DerivedSlot).resultHash,
      params: {
        sourceFamily: "olympus",
        targetFamily: "underworld",
        ramps: [
          { source: "marble", target: "ash" },
          { source: "pale-gold", target: "violet" },
          { source: "lapis", target: "bone" },
          { source: "cloud", target: "ember" },
        ],
      },
    });
  });

  it("is byte-stable, and its output conforms to the target palette", () => {
    const one = must(swapPalette(input));
    const two = must(swapPalette({ ...input, slots: asset() }));
    expect(two.steps).toEqual(one.steps);
    const target = new Set(
      underworld.ramps.flatMap((r) => r.shades.map((s) => s.join(","))),
    );
    for (const slot of one.slots)
      for (const frame of slot.frames) {
        for (let at = 0; at < frame.image.rgba.length; at += 4)
          if ((frame.image.rgba[at + 3] as number) > 0)
            expect(
              target.has([...frame.image.rgba.subarray(at, at + 3)].join(",")),
            ).toBe(true);
        expect(frame.png).toEqual(
          (two.slots[one.slots.indexOf(slot)] as DerivedSlot).frames[
            slot.frames.indexOf(frame)
          ]?.png as Uint8Array,
        );
      }
  });

  it("refuses ramps of unequal length", () => {
    const short = {
      ...(underworld.ramps[0] as (typeof underworld.ramps)[number]),
      shades: (
        underworld.ramps[0] as (typeof underworld.ramps)[number]
      ).shades.slice(0, 3),
    };
    const refused = refusal(
      swapPalette({
        ...input,
        pairs: [
          {
            source: olympus.ramps[0] as (typeof olympus.ramps)[number],
            target: short,
          },
        ],
      }),
    );
    expect(refused.reason).toBe("ramp-length");
    expect(refused.message).toContain("marble");
  });

  it("refuses an opaque colour no pair maps, naming it", () => {
    const slots = asset();
    paint(
      (slots[1] as SlotInput).frames[2]?.image as RgbaImage,
      3,
      3,
      1,
      1,
      [0x12, 0x34, 0x56],
    );
    const refused = refusal(swapPalette({ ...input, slots }));
    expect(refused.reason).toBe("unmapped-colour");
    expect(refused.message).toContain("#123456");
    expect(refused.colour).toBe("#123456");
  });

  it("refuses colours from another family's ramps as unmapped", () => {
    const town = family("town");
    const slots = asset();
    const shadeOfTown = (town.ramps[0] as (typeof town.ramps)[number])
      .shades[0] as Rgb;
    paint(
      (slots[0] as SlotInput).frames[1]?.image as RgbaImage,
      1,
      1,
      1,
      1,
      shadeOfTown,
    );
    expect(refusal(swapPalette({ ...input, slots })).reason).toBe(
      "unmapped-colour",
    );
  });
});

describe("swapping a whole image under a recorded colour map", () => {
  const ramps = new Map(
    [...olympus.ramps, ...underworld.ramps].map((r) => [r.id, r] as const),
  );
  const map = olympus.ramps.flatMap((source, i) =>
    source.shades.map((_, index) => ({
      source: { ramp: source.id, index },
      target: {
        ramp: (underworld.ramps[i] as { id: string }).id,
        index,
      },
    })),
  );

  it("recolours every opaque pixel, keeps alpha, zeroes hidden RGB and encodes the PNG", () => {
    const image = symmetricFigure();
    paint(image, 2, 2, 1, 1, shade(3, 3), 128);
    image.rgba.set([5, 6, 7, 0], 0);
    const done = must(swapImage(image, map, ramps));
    expect(pixel(done.image, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(done.image, 2, 2)[3]).toBe(128);
    expect(pixel(done.image, 30, 12).slice(0, 3)).toEqual([
      ...(underworld.ramps[0] as { shades: readonly Rgb[] }).shades[2],
    ]);
    expect(done.png).toEqual(
      encodeRgbaPng(done.image.rgba, done.image.width, done.image.height),
    );
  });

  it("refuses an opaque colour no mapped shade has, and a map the palette lacks", () => {
    const stray = symmetricFigure();
    paint(stray, 1, 1, 1, 1, [0x12, 0x34, 0x56]);
    expect(refusal(swapImage(stray, map, ramps)).colour).toBe("#123456");
    const missing = [
      {
        source: { ramp: "marble", index: 9 },
        target: { ramp: "ash", index: 0 },
      },
    ];
    expect(refusal(swapImage(symmetricFigure(), missing, ramps)).reason).toBe(
      "invalid-params",
    );
  });
});

describe("bob", () => {
  const params: BobParams = {
    region: { x: 20, y: 8, w: 24, h: 40 },
    exclude: [],
    dy: [0, 0, -1, 0],
    durationsMs: DURATIONS,
    seam: "fill-from-fixed",
    repairs: [],
  };
  const idle = idleSlot("south", symmetricFigure);
  const rest = (idle.frames[0] as { image: RgbaImage }).image;
  const run = (over: Partial<BobParams> = {}, slot: SlotInput = idle) =>
    bobSlot({
      source: SOURCE,
      slot,
      geometry: GEOMETRY,
      limits: {
        frames: { min: 4, max: 4 },
        durationMs: { min: 166, max: 334 },
      },
      params: { ...params, ...over },
    });

  it("shifts the region by dy per frame, fills what it vacates from the fixed pixel below, and leaves the rest", () => {
    const done = must(run());
    const [out] = done.slots as [DerivedSlot];
    expect(out.key).toBe("idle/south");
    expect(out.frames.map((f) => f.durationMs)).toEqual(DURATIONS);
    // Frames with dy 0 are the rest frame, pixel for pixel.
    for (const i of [0, 1, 3])
      expect((out.frames[i] as { image: RgbaImage }).image.rgba).toEqual(
        rest.rgba,
      );
    const raised = (out.frames[2] as { image: RgbaImage }).image;
    // The head row 10 moved up to row 9; the robe's top row 18 to 17.
    expect(pixel(raised, 30, 9)).toEqual(pixel(rest, 30, 10));
    expect(pixel(raised, 30, 17)).toEqual(pixel(rest, 30, 18));
    // Row 47 (the robe's lowest row in the region, 18..47) is vacated and filled from row 48.
    expect(pixel(raised, 30, 47)).toEqual(pixel(rest, 30, 48));
    // Outside the region nothing moved.
    expect(pixel(raised, 30, 60)).toEqual(pixel(rest, 30, 60));
    expect(pixel(raised, 30, 76)).toEqual(pixel(rest, 30, 76));
    // The cluster's own bottom corners (x 24 and 25 at row 47) have no fixed pixel below: they go transparent.
    expect(pixel(raised, 24, 47)[3]).toBe(0);
  });

  it("leaves excluded boxes where they are", () => {
    const withBolt = idleSlot("south", lopsidedFigure);
    const base = (withBolt.frames[0] as { image: RgbaImage }).image;
    const wide = { region: { x: 20, y: 8, w: 30, h: 40 } };
    const raisedOf = (over: Partial<BobParams>) =>
      (
        (must(run({ ...wide, ...over }, withBolt)).slots[0] as DerivedSlot)
          .frames[2] as { image: RgbaImage }
      ).image;
    // Without the exclusion the bolt stem (x 40..43, rows 20..33) rises with the body.
    expect(pixel(raisedOf({}), 41, 19)).toEqual(pixel(base, 41, 20));
    // Inside the box it stays put, whole.
    const held = raisedOf({ exclude: [{ x: 40, y: 19, w: 6, h: 16 }] });
    for (let y = 20; y < 34; y += 1)
      for (let x = 40; x < 44; x += 1)
        expect(pixel(held, x, y)).toEqual(pixel(base, x, y));
    expect(pixel(held, 41, 19)).toEqual(pixel(base, 41, 19));
    // The body beside it still rises.
    expect(pixel(held, 30, 9)).toEqual(pixel(base, 30, 10));
  });

  it("applies the recorded repair list per frame, recolouring opaque pixels only", () => {
    const hex = `#${shade(1, 3)
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")}`;
    const done = must(
      run({ repairs: [{ frame: 1, x: 30, y: 12, colour: hex }] }),
    );
    const frames = (done.slots[0] as DerivedSlot).frames;
    expect(pixel((frames[1] as { image: RgbaImage }).image, 30, 12)).toEqual([
      ...shade(1, 3),
      255,
    ]);
    expect(pixel((frames[0] as { image: RgbaImage }).image, 30, 12)).toEqual(
      pixel(rest, 30, 12),
    );
    const onAir = refusal(
      run({ repairs: [{ frame: 1, x: 2, y: 2, colour: hex }] }),
    );
    expect(onAir.reason).toBe("invalid-params");
  });

  it("records the params verbatim as the step's canonical params, with the source slot hash", () => {
    const done = must(run());
    expect(done.steps).toHaveLength(1);
    expect(done.steps[0]).toMatchObject({
      recipe: "bob",
      version: RECIPE_VERSION.bob,
      params,
      source: { slotKey: "idle/south", slotHash: slotHash(idle) },
      outputSlot: "idle/south",
      resultHash: (done.slots[0] as DerivedSlot).resultHash,
    });
  });

  it("refuses everything but idle as non-derivable and names the repair route", () => {
    for (const key of [
      "act/south/thunderbolt",
      "walk/south",
      "seated/south",
      "hurt/south",
    ]) {
      const refused = refusal(
        run({}, { key, frames: idle.frames.map((f) => ({ ...f })) }),
      );
      expect(refused.reason).toBe("non-derivable");
      expect(refused.message).toContain("repair");
    }
  });

  it("refuses a frame count or duration outside the idle bounds", () => {
    expect(
      refusal(run({ dy: [0, 0, -1], durationsMs: [333, 167, 333] })).reason,
    ).toBe("non-derivable");
    expect(refusal(run({ durationsMs: [333, 100, 333, 167] })).reason).toBe(
      "non-derivable",
    );
  });

  it("refuses params that cannot run", () => {
    const bad: Partial<BobParams>[] = [
      { dy: [0, 0, -1] },
      { dy: [0, 0, -1.5, 0] },
      { region: { x: 60, y: 8, w: 24, h: 40 } },
      { region: { x: 20, y: 8, w: 0, h: 40 } },
      { dy: [0, 0, -20, 0] },
      { repairs: [{ frame: 9, x: 30, y: 12, colour: "#112233" }] },
      { repairs: [{ frame: 1, x: 30, y: 12, colour: "red" }] },
    ];
    for (const change of bad)
      expect(refusal(run(change)).reason).toBe("invalid-params");
  });

  it("is deterministic and bumping the version changes only the step", () => {
    const one = must(run());
    expect(must(run()).steps).toEqual(one.steps);
    const two = must(
      bobSlot({
        source: SOURCE,
        slot: idle,
        geometry: GEOMETRY,
        limits: {
          frames: { min: 4, max: 4 },
          durationMs: { min: 166, max: 334 },
        },
        params,
        version: 2,
      }),
    );
    expect(two.steps[0]?.resultHash).toBe(one.steps[0]?.resultHash);
    expect(two.steps[0]?.version).toBe(2);
    expect(two.slots).toEqual(one.slots);
  });
});

// The canon zeus-sprite revision whose idle cell the bob recipe is measured against.
const CANON_REVISION =
  "1382b7f7604f3fed64721f7f1bb4ee99f474d1ddafed5bde2aa7a1487230a56d";

function canonIdle(): { slot: SlotInput; limits: BobInput["limits"] } {
  const manifestText = readFileSync(
    join(CONTENT, "assets", "registry", "manifests", `${CANON_REVISION}.json`),
    "utf8",
  );
  expect(createHash("sha256").update(manifestText).digest("hex")).toBe(
    CANON_REVISION,
  );
  const manifest = JSON.parse(manifestText);
  const atlasBytes = new Uint8Array(
    readFileSync(
      join(
        CONTENT,
        "assets",
        "registry",
        "blobs",
        `${manifest.atlas.blob}.png`,
      ),
    ),
  );
  expect(createHash("sha256").update(atlasBytes).digest("hex")).toBe(
    manifest.atlas.blob,
  );
  const atlas = decodePng(atlasBytes);
  if (!atlas.ok) throw new Error(atlas.message);
  const animation = manifest.animations.find(
    (a: { state: string; direction: string }) =>
      a.state === "idle" && a.direction === "south",
  );
  const frames = animation.frames.map(
    (f: {
      rect: { x: number; y: number; w: number; h: number };
      durationMs: number;
    }) => {
      const { x, y, w, h } = f.rect;
      const rgba = new Uint8Array(w * h * 4);
      for (let row = 0; row < h; row += 1) {
        const from = ((y + row) * atlas.image.width + x) * 4;
        rgba.set(atlas.image.rgba.subarray(from, from + w * 4), row * w * 4);
      }
      return { image: { rgba, width: w, height: h }, durationMs: f.durationMs };
    },
  );
  const vocabulary = parseAssetVocabulary(
    JSON.parse(
      readFileSync(join(CONTENT, "assets", "vocabulary.json"), "utf8"),
    ),
  );
  if (!vocabulary.ok) throw new Error(vocabulary.message);
  const rule = vocabulary.value.states.find((s) => s.id === "idle");
  if (rule?.fps === undefined) throw new Error("idle has no fps bounds");
  return {
    slot: { key: "idle/south", frames },
    limits: { frames: rule.frames, durationMs: durationBounds(rule.fps) },
  };
}

/** The probe's region for the idle rise (tools/probes/art-edit/sprite_idle_c2.py): rows 30-45 right of column 25, less the right arm (x >= 38 from row 43). */
const CANON_BOB: BobParams = {
  region: { x: 25, y: 30, w: 39, h: 16 },
  exclude: [{ x: 38, y: 43, w: 26, h: 37 }],
  dy: [0, 0, -1, 0],
  durationsMs: [333, 167, 333, 167],
  seam: "fill-from-fixed",
  repairs: [],
};

/** The probe's recolours: the pixels the rise leaves wrong, and the chest fold on frames 1 to 3. */
const CANON_REPAIRS: BobParams["repairs"] = [
  { frame: 1, x: 26, y: 49, colour: "#f3f0dc" },
  { frame: 1, x: 29, y: 46, colour: "#c7d8d4" },
  { frame: 2, x: 25, y: 39, colour: "#637b89" },
  { frame: 2, x: 25, y: 40, colour: "#9fb5bf" },
  { frame: 2, x: 25, y: 45, colour: "#f3f0dc" },
  { frame: 2, x: 26, y: 49, colour: "#f3f0dc" },
  { frame: 2, x: 29, y: 46, colour: "#c7d8d4" },
  { frame: 3, x: 28, y: 47, colour: "#f3f0dc" },
];

const conformsAsSprite = (image: RgbaImage) => {
  const result = conformImage({
    rgba: image.rgba,
    width: image.width,
    height: image.height,
    kind: "sprite",
    mode: "report-only",
    cell: { w: W, h: H },
    pivot: { x: 32, y: 80 },
    paletteRgb: olympusColours,
    background: { type: "alpha" },
    alphaCutoff: 128,
    grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
    scale: 1,
  });
  if (result.status !== "done") throw new Error(result.status);
  return result.report;
};

const differing = (a: RgbaImage, b: RgbaImage): string[] => {
  const out: string[] = [];
  for (let p = 0; p < a.width * a.height; p += 1) {
    const key = (i: RgbaImage) =>
      i.rgba[p * 4 + 3] === 0
        ? "clear"
        : [...i.rgba.subarray(p * 4, p * 4 + 4)].join();
    if (key(a) !== key(b))
      out.push(`${p % a.width},${Math.floor(p / a.width)}`);
  }
  return out;
};

describe("bob on the canon zeus-sprite idle cell", () => {
  const { slot, limits } = canonIdle();
  const bob = (params: BobParams) =>
    must(bobSlot({ source: SOURCE, slot, geometry: GEOMETRY, limits, params }))
      .slots[0] as DerivedSlot;
  const canonImage = (i: number) =>
    (slot.frames[i] as { image: RgbaImage }).image;

  it("reads the idle bounds from the vocabulary: four frames of 166 to 334 ms", () => {
    expect(limits).toEqual({
      frames: { min: 4, max: 4 },
      durationMs: { min: 166, max: 334 },
    });
    expect(slot.frames.map((f) => f.durationMs)).toEqual([333, 167, 333, 167]);
  });

  it("a pure translation plus the seam rule conforms on every frame, with no repair list", () => {
    const derived = bob(CANON_BOB);
    expect(derived.frames.map((f) => f.durationMs)).toEqual(DURATIONS);
    for (const frame of derived.frames) {
      const report = conformsAsSprite(frame.image);
      expect(report.checks.filter((c) => c.status !== "pass")).toEqual([]);
      expect(report.status).toBe("pass");
    }
  });

  it("differs from the accepted canon only where the probe recoloured by hand", () => {
    const derived = bob(CANON_BOB);
    expect(
      differing(derived.frames[0]?.image as RgbaImage, canonImage(0)),
    ).toEqual([]);
    expect(
      differing(derived.frames[1]?.image as RgbaImage, canonImage(1)),
    ).toEqual(["29,46", "26,49"]);
    expect(
      differing(derived.frames[2]?.image as RgbaImage, canonImage(2)),
    ).toEqual(["25,39", "25,40", "25,45", "29,46", "26,49"]);
    expect(
      differing(derived.frames[3]?.image as RgbaImage, canonImage(3)),
    ).toEqual(["28,47"]);
  });

  it("with the recorded repair list it reproduces the canon idle pixel for pixel", () => {
    const derived = bob({ ...CANON_BOB, repairs: CANON_REPAIRS });
    for (const [i, frame] of derived.frames.entries()) {
      expect(differing(frame.image, canonImage(i))).toEqual([]);
      expect(conformsAsSprite(frame.image).status).toBe("pass");
    }
  });

  it("stays inside the idle bounds and keeps the figure inside the cell", () => {
    const derived = bob(CANON_BOB);
    expect(derived.frames).toHaveLength(limits.frames.min);
    for (const frame of derived.frames) {
      expect(frame.durationMs).toBeGreaterThanOrEqual(limits.durationMs.min);
      expect(frame.durationMs).toBeLessThanOrEqual(limits.durationMs.max);
      expect(frame.image.width).toBe(W);
      expect(frame.image.height).toBe(H);
    }
    // The loop is 1000 ms: three or six frames per second.
    expect(derived.frames.reduce((sum, f) => sum + f.durationMs, 0)).toBe(1000);
  });
});

describe("derive functions do no I/O", () => {
  it("import nothing from node:fs, node:child_process or the network", () => {
    const source = readFileSync(join(import.meta.dir, "derive.ts"), "utf8");
    for (const banned of [
      "node:fs",
      "node:child_process",
      "node:net",
      "node:http",
      "fetch(",
      "Date.now",
      "Math.random",
      "setTimeout",
    ])
      expect(source).not.toContain(banned);
  });
});
