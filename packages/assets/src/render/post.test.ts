// The TypeScript post step: goldens over the committed raw-frame fixture, the stamp occlusion
// rules, edge contact, input refusals and the hand-off to conformance. The probe's own cells for
// the same fixture are compared in test/render/post.parity.test.ts, at the probe's own settings
// (its olive shadow); the goldens here run the current step (the profile's olympus shadow). Synthetic frames are built
// here, in 4x passes, at the size a small cell needs.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeFile,
  FIXTURE_DIR,
  loadRenderFixture,
  PALETTE_FAMILIES,
} from "../../test/render/fixture";
import type { RgbaImage } from "../conformance";
import { conformImage } from "../conformance";
import { loadStudioPalettes } from "../studio/content";
import { candidateLines } from "./overlap";
import { decodePartId, encodeDepth, idByte, type PartId } from "./parts";
import {
  cellPixelHash,
  POST_STEP_VERSION,
  type PostStepInput,
  type PostStepSettings,
  postProcessSlot,
  type RawFrame,
  type StampLocators,
} from "./post";
import {
  nearestBoltAngle,
  roundHalfEven,
  screenAngleDeg,
} from "./stamp-composite";

const fixture = loadRenderFixture();
const COMMITTED_CONTENT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "content",
  "greek",
);

function run(input: PostStepInput) {
  const result = postProcessSlot(input);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

describe("goldens over the committed fixture", () => {
  const golden = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "golden.json"), "utf8"),
  ) as {
    postStepVersion: number;
    cells: { name: string; pixelHash: string }[];
    envelope: unknown;
  };

  it("pins the cells of the fixture slot, pixel for pixel, to the golden hashes", () => {
    const result = run(fixture.current);
    expect(result.cells.map((c) => c.name)).toEqual(
      golden.cells.map((c) => c.name),
    );
    for (const [i, cell] of result.cells.entries()) {
      expect(cellPixelHash(cell.image) as string).toBe(
        golden.cells[i]?.pixelHash as string,
      );
    }
  });

  it("pins the slot envelope", () => {
    expect(run(fixture.current).envelope).toEqual(golden.envelope as never);
  });

  it("ties the golden to the post-step version: a changed golden needs a bumped version", () => {
    expect(golden.postStepVersion).toBe(POST_STEP_VERSION);
    expect(run(fixture.current).version).toBe(POST_STEP_VERSION);
  });

  it("is deterministic: a second run gives the same bytes", () => {
    const a = run(fixture.current);
    const b = run(fixture.current);
    for (const [i, cell] of a.cells.entries()) {
      expect(
        Buffer.from(cell.image.rgba).equals(
          Buffer.from(b.cells[i]?.image.rgba as Uint8Array),
        ),
      ).toBe(true);
    }
  });

  it("emits binary alpha, canonical alpha-0 RGB and only palette colours", () => {
    for (const cell of run(fixture.current).cells) {
      expect(cell.image.width).toBe(112);
      expect(cell.image.height).toBe(96);
      for (let at = 0; at < cell.image.rgba.length; at += 4) {
        const a = cell.image.rgba[at + 3] as number;
        expect([0, 255]).toContain(a);
        if (a === 0) {
          expect([...cell.image.rgba.subarray(at, at + 3)]).toEqual([0, 0, 0]);
        } else {
          expect(
            fixture.palette.indexOf([
              cell.image.rgba[at] as number,
              cell.image.rgba[at + 1] as number,
              cell.image.rgba[at + 2] as number,
            ]),
          ).toBeDefined();
        }
      }
    }
  });

  it("draws the contact shadow as one palette colour on empty pixels only, never outlined over the figure", () => {
    // The current step takes it from shade 0 of the profile's olympus ramp (lapis, #243f63).
    const lapis = fixture.palette.ramps.get("lapis")?.[0] as readonly number[];
    expect([...lapis]).toEqual([0x24, 0x3f, 0x63]);
    for (const cell of run(fixture.current).cells) {
      let shadowPixels = 0;
      for (let at = 0; at < cell.image.rgba.length; at += 4) {
        const same = [0, 1, 2, 3].every(
          (k) => cell.image.rgba[at + k] === cell.figure.rgba[at + k],
        );
        if (same) continue;
        shadowPixels += 1;
        expect(cell.figure.rgba[at + 3]).toBe(0);
        expect([...cell.image.rgba.subarray(at, at + 4)]).toEqual([
          ...lapis,
          255,
        ]);
      }
      expect(shadowPixels).toBeGreaterThan(0);
    }
  });

  it("still draws the probe's olive shade 1 when the settings say so (post step v1's explicit shadow)", () => {
    const olive = fixture.palette.ramps.get("olive")?.[1] as readonly number[];
    expect([...olive]).toEqual([0x51, 0x5c, 0x3d]);
    for (const cell of run(fixture.input).cells) {
      let shadowPixels = 0;
      for (let at = 0; at < cell.image.rgba.length; at += 4) {
        const same = [0, 1, 2, 3].every(
          (k) => cell.image.rgba[at + k] === cell.figure.rgba[at + k],
        );
        if (same) continue;
        shadowPixels += 1;
        expect([...cell.image.rgba.subarray(at, at + 4)]).toEqual([
          ...olive,
          255,
        ]);
      }
      expect(shadowPixels).toBeGreaterThan(0);
    }
  });

  it("measures colours on the final cell and height, outline and envelope on the shadow-free figure", () => {
    const result = run(fixture.current);
    for (const cell of result.cells) {
      const figureColours = new Set<number>();
      const cellColours = new Set<number>();
      for (let at = 0; at < cell.image.rgba.length; at += 4) {
        const key = (c: Uint8Array) =>
          (c[at] as number) * 65536 +
          (c[at + 1] as number) * 256 +
          (c[at + 2] as number);
        if (cell.figure.rgba[at + 3]) figureColours.add(key(cell.figure.rgba));
        if (cell.image.rgba[at + 3]) cellColours.add(key(cell.image.rgba));
      }
      expect(cell.facts.coloursFigure).toBe(figureColours.size);
      expect(cell.facts.colours).toBe(cellColours.size);
      // The shadow colour (lapis shade 0) is also an eye-stamp colour, so it may add none.
      expect(cell.facts.colours).toBeGreaterThanOrEqual(
        cell.facts.coloursFigure,
      );
      const [x0, y0, x1, y1] = cell.facts.box;
      expect(cell.facts.height).toBe(y1 - y0);
      expect(cell.facts.width).toBe(x1 - x0);
      expect(cell.facts.bottomRow).toBe(y1 - 1);
      // The figure's box is the box of the figure image, not of the cell with its shadow.
      const rows = new Set<number>();
      for (let i = 0; i < cell.figure.rgba.length; i += 4) {
        if (cell.figure.rgba[i + 3])
          rows.add(Math.floor(i / 4 / cell.figure.width));
      }
      expect(Math.min(...rows)).toBe(y0);
      expect(Math.max(...rows)).toBe(y1 - 1);
    }
    expect(result.envelope.up).toBeGreaterThan(0);
    // With a shadow colour the figure does not use (the probe's olive), the final cell counts one more.
    for (const cell of run(fixture.input).cells)
      expect(cell.facts.colours).toBe(cell.facts.coloursFigure + 1);
  });
});

// --- synthetic frames ---------------------------------------------------------------------------

const SMALL: PostStepSettings = {
  cell: { w: 40, h: 32 },
  originPx: [20, 28],
  pivotPx: [20, 28],
  depthRange: [18, 22],
  overlapThresholdM: 0.05,
  shadow: null,
};
const SCALE = 4;

interface Block {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly part: PartId;
  readonly depthM: number;
  readonly rgb: readonly [number, number, number];
}

const blankPass = (w: number, h: number): RgbaImage => ({
  width: w,
  height: h,
  rgba: new Uint8Array(w * h * 4),
});

/** A frame whose raw passes hold opaque blocks (cell-pixel rectangles); each block fills its 4x4 sub-pixels. */
function syntheticFrame(
  blocks: readonly Block[],
  locators?: StampLocators,
  settings: PostStepSettings = SMALL,
  facing: RawFrame["facing"] = "south",
): RawFrame {
  const w = settings.cell.w * SCALE;
  const h = settings.cell.h * SCALE;
  const colour = blankPass(w, h);
  const id = blankPass(w, h);
  const depth = blankPass(w, h);
  for (const b of blocks) {
    for (let y = b.y0 * SCALE; y < b.y1 * SCALE; y += 1) {
      for (let x = b.x0 * SCALE; x < b.x1 * SCALE; x += 1) {
        const at = (y * w + x) * 4;
        colour.rgba.set([...b.rgb, 255], at);
        id.rgba.set([idByte(b.part), 0, 0, 255], at);
        depth.rgba.set([encodeDepth(b.depthM, 18, 22), 0, 0, 255], at);
      }
    }
  }
  return {
    name: "synthetic",
    facing,
    colour,
    id,
    depth,
    ...(locators === undefined ? {} : { locators }),
  };
}

const MARBLE = fixture.palette.ramps.get("marble")?.[3] as readonly [
  number,
  number,
  number,
];
const syntheticInput = (
  frame: RawFrame,
  slot = "idle/south",
): PostStepInput => ({
  slot,
  settings: SMALL,
  palette: fixture.palette,
  stamps: fixture.stamps,
  frames: [frame],
});

const goldCount = (image: RgbaImage): number => {
  let n = 0;
  for (let at = 0; at < image.rgba.length; at += 4) {
    if (
      image.rgba[at + 3] &&
      fixture.palette.rampOf.get(
        ((image.rgba[at] as number) << 16) |
          ((image.rgba[at + 1] as number) << 8) |
          (image.rgba[at + 2] as number),
      ) === "pale-gold"
    )
      n += 1;
  }
  return n;
};

// The bolt is held at angle 0 (tip to the right of the base) with its grip at the cell's middle row.
const BOLT = (baseDepth: number): StampLocators => ({
  bolt: { basePx: [12, 16], tipPx: [16, 16], baseDepth },
});
const TORSO = (x1: number, depthM = 18.5): Block => ({
  x0: 2,
  y0: 2,
  x1,
  y1: 30,
  part: "torso",
  depthM,
  rgb: MARBLE,
});

describe("stamp occlusion by part id and depth", () => {
  it("draws the bolt where it is nearer than the body (positive control)", () => {
    const result = run(syntheticInput(syntheticFrame([TORSO(38)], BOLT(18.0))));
    const bolt = result.cells[0]?.facts.stamps.bolt;
    expect(bolt?.occluded).toBe(0);
    expect(bolt?.drawn).toBe(
      (bolt?.coreDrawn as number) + (bolt?.outlineOnBody as number),
    );
    expect(bolt?.coreDrawn).toBe(bolt?.coreTotal as number);
    expect(
      goldCount((result.cells[0] as { figure: RgbaImage }).figure),
    ).toBeGreaterThan(0);
  });

  it("drops a bolt that lies fully behind the body", () => {
    const result = run(syntheticInput(syntheticFrame([TORSO(38)], BOLT(19.5))));
    const cell = result.cells[0];
    expect(cell?.facts.stamps.bolt?.coreDrawn).toBe(0);
    expect(cell?.facts.stamps.bolt?.occluded).toBe(
      cell?.facts.stamps.bolt?.coreTotal as number,
    );
    expect(goldCount((cell as { figure: RgbaImage }).figure)).toBe(0);
  });

  it("clips a bolt that is partly behind the body by depth: only the part that clears the body is drawn", () => {
    // The body ends at x = 20; the bolt spans x = 12..28 and is behind the body.
    const result = run(syntheticInput(syntheticFrame([TORSO(20)], BOLT(19.5))));
    const bolt = result.cells[0]?.facts.stamps.bolt;
    expect(bolt?.occluded).toBeGreaterThan(0);
    expect(bolt?.coreDrawn).toBeGreaterThan(0);
    expect((bolt?.coreDrawn as number) + (bolt?.occluded as number)).toBe(
      bolt?.coreTotal as number,
    );
    const figure = (result.cells[0] as { figure: RgbaImage }).figure;
    // Every gold pixel is right of the body: none is drawn over it.
    for (let y = 0; y < figure.height; y += 1) {
      for (let x = 0; x < 20; x += 1) {
        const at = (y * figure.width + x) * 4;
        const key =
          ((figure.rgba[at] as number) << 16) |
          ((figure.rgba[at + 1] as number) << 8) |
          (figure.rgba[at + 2] as number);
        if (figure.rgba[at + 3])
          expect(fixture.palette.rampOf.get(key)).not.toBe("pale-gold");
      }
    }
  });
});

describe("a part at the cell edge", () => {
  it("is reported clipped when it touches the edge, and keeps a complete outline when it does not", () => {
    const block = (x1: number): Block => ({
      x0: 28,
      y0: 4,
      x1,
      y1: 24,
      part: "torso",
      depthM: 19,
      rgb: MARBLE,
    });
    const touching = run(syntheticInput(syntheticFrame([block(40)]))).cells[0];
    expect(touching?.facts.clipped).toBe(true);
    expect(touching?.facts.outline).toBe(false);
    const clear = run(syntheticInput(syntheticFrame([block(38)]))).cells[0];
    expect(clear?.facts.clipped).toBe(false);
    expect(clear?.facts.outline).toBe(true);
  });

  it("reports the slot envelope as clipped when any frame touches the edge", () => {
    const edge: Block = {
      x0: 0,
      y0: 4,
      x1: 12,
      y1: 24,
      part: "torso",
      depthM: 19,
      rgb: MARBLE,
    };
    expect(run(syntheticInput(syntheticFrame([edge]))).envelope.clipped).toBe(
      true,
    );
    expect(
      run(syntheticInput(syntheticFrame([{ ...edge, x0: 3 }]))).envelope
        .clipped,
    ).toBe(false);
  });
});

describe("raw frames that cannot be processed", () => {
  const good = () => syntheticFrame([TORSO(38)]);

  it("accepts the unbroken frame (positive control)", () => {
    expect(postProcessSlot(syntheticInput(good())).ok).toBe(true);
  });

  it("refuses a pass of the wrong size, naming the slot and the frame", () => {
    const frame = good();
    const wrong = {
      ...frame,
      id: blankPass(SMALL.cell.w * SCALE, SMALL.cell.h * SCALE + 4),
    };
    const result = postProcessSlot(syntheticInput(wrong, "walk/east"));
    expect(result).toMatchObject({
      ok: false,
      code: "frame-size",
      slot: "walk/east",
      frame: "synthetic",
    });
    if (!result.ok) expect(result.message).toContain("walk/east");
  });

  it("refuses a missing pass, naming the slot and the pass", () => {
    for (const pass of ["colour", "id", "depth"] as const) {
      const result = postProcessSlot(
        syntheticInput({ ...good(), [pass]: undefined }, "walk/east"),
      );
      expect(result).toMatchObject({
        ok: false,
        code: "missing-pass",
        slot: "walk/east",
      });
      if (!result.ok) expect(result.message).toContain(pass);
    }
  });

  it("refuses a slot with no frames and a frame with nothing drawn", () => {
    expect(
      postProcessSlot({ ...syntheticInput(good()), frames: [] }),
    ).toMatchObject({ ok: false, code: "no-frames" });
    expect(postProcessSlot(syntheticInput(syntheticFrame([])))).toMatchObject({
      ok: false,
      code: "empty-frame",
    });
  });

  it("refuses a shadow ramp the palette does not have", () => {
    const input = syntheticInput(good());
    const result = postProcessSlot({
      ...input,
      settings: {
        ...SMALL,
        shadow: { rx: 4, ry: 2, ramp: "no-such-ramp", shade: 1 },
      },
    });
    expect(result).toMatchObject({ ok: false, code: "unknown-ramp" });
  });

  it("refuses a face stamp whose eye locator is missing, naming the slot", () => {
    const frame = syntheticFrame(
      [{ x0: 2, y0: 2, x1: 38, y1: 30, part: "head", depthM: 19, rgb: MARBLE }],
      {
        eyes: { l: { px: [20, 14], depth: 19 } },
      },
    );
    const result = postProcessSlot(syntheticInput(frame, "idle/south"));
    expect(result).toMatchObject({
      ok: false,
      code: "missing-locator",
      slot: "idle/south",
    });
  });
});

describe("hand-off to conformance", () => {
  it("passes every fixture cell under the greek-retro limits and the declared pivot (draft palette)", () => {
    const loaded = loadStudioPalettes(COMMITTED_CONTENT, PALETTE_FAMILIES);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    const retro = loaded.palettes.get("greek-retro");
    expect(retro?.approval.status).toBe("draft");
    expect(retro?.limits?.colours.sprite).toBe(48);
    for (const cell of run(fixture.current).cells) {
      const result = conformImage({
        rgba: cell.image.rgba,
        width: cell.image.width,
        height: cell.image.height,
        kind: "sprite",
        mode: "report-only",
        cell: { w: 112, h: 96 },
        pivot: { x: 56, y: 78 },
        paletteRgb: retro?.colours as never,
        colourLimit: retro?.limits?.colours.sprite as number,
        background: { type: "alpha" },
        alphaCutoff: 128,
        grid: { edgeTolerance: 8, minConfidence: 0.9, minEdges: 50 },
        scale: 1,
      });
      expect(result.status).toBe("done");
      if (result.status === "done") {
        expect(result.report.checks.filter((c) => c.status === "fail")).toEqual(
          [],
        );
        expect(result.report.status).toBe("pass");
      }
    }
  });

  it("passes the palette check against the olympus family alone with the current shadow, and fails it with the probe's olive shadow (positive control)", () => {
    const loaded = loadStudioPalettes(COMMITTED_CONTENT, PALETTE_FAMILIES);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    const retro = loaded.palettes.get("greek-retro");
    const olympus = (retro?.families ?? [])
      .filter((f) => f.id === "olympus")
      .flatMap((f) => f.ramps.flatMap((r) => r.shades));
    expect(olympus.length).toBeGreaterThan(0);
    const paletteStatus = (image: RgbaImage) => {
      const result = conformImage({
        rgba: image.rgba,
        width: 112,
        height: 96,
        kind: "sprite",
        mode: "report-only",
        cell: { w: 112, h: 96 },
        pivot: { x: 56, y: 78 },
        paletteRgb: olympus as never,
        colourLimit: 48,
        background: { type: "alpha" },
        alphaCutoff: 128,
        grid: { edgeTolerance: 8, minConfidence: 0.9, minEdges: 50 },
        scale: 1,
      });
      if (result.status !== "done") throw new Error("conform did not finish");
      return result.report.checks.find((c) => c.check === "palette")?.status;
    };
    for (const cell of run(fixture.current).cells)
      expect(paletteStatus(cell.image)).toBe("pass");
    for (const cell of run(fixture.input).cells)
      expect(paletteStatus(cell.image)).toBe("fail");
  });

  it("holds the same cells to the legacy limits and fails them (negative control)", () => {
    const loaded = loadStudioPalettes(COMMITTED_CONTENT, PALETTE_FAMILIES);
    if (!loaded.ok) throw new Error("palettes did not load");
    const master = loaded.palettes.get("greek-master");
    const cell = run(fixture.current).cells[0] as { image: RgbaImage };
    const result = conformImage({
      rgba: cell.image.rgba,
      width: 112,
      height: 96,
      kind: "sprite",
      mode: "report-only",
      cell: { w: 112, h: 96 },
      pivot: { x: 56, y: 78 },
      paletteRgb: master?.colours as never,
      background: { type: "alpha" },
      alphaCutoff: 128,
      grid: { edgeTolerance: 8, minConfidence: 0.9, minEdges: 50 },
      scale: 1,
    });
    expect(result.status === "done" && result.report.status).toBe("fail");
  });
});

describe("the decoded-pixel hash", () => {
  it("ignores RGB hidden under alpha 0 and tells different pixels apart", () => {
    const a = decodeFile(join(FIXTURE_DIR, "expected", "cast_west_00.png"));
    const b = { ...a, rgba: new Uint8Array(a.rgba) };
    for (let at = 0; at < b.rgba.length; at += 4) {
      if (b.rgba[at + 3] === 0) b.rgba.set([9, 8, 7], at);
    }
    expect(cellPixelHash(b)).toBe(cellPixelHash(a));
    const c = { ...a, rgba: new Uint8Array(a.rgba) };
    const firstOpaque =
      c.rgba.findIndex((v, i) => i % 4 === 3 && v === 255) - 3;
    c.rgba[firstOpaque] = (c.rgba[firstOpaque] as number) ^ 1;
    expect(cellPixelHash(c)).not.toBe(cellPixelHash(a));
  });
});

// Pixel rules the fixture slot does not reach, pinned to the probe's (Python's) arithmetic.
describe("rules inherited from the probe", () => {
  it("rounds halves to the even neighbour, as Python does, when it places and orients a bolt", () => {
    expect(
      [0.5, 1.5, 2.5, 3.5, -0.5, -2.5, 2.4, 2.6].map(roundHalfEven),
    ).toEqual([0, 2, 2, 4, -0, -2, 2, 3]);
    expect(nearestBoltAngle(22.5)).toBe(0);
    expect(nearestBoltAngle(67.5)).toBe(90);
    expect(nearestBoltAngle(337.5)).toBe(0);
    expect(nearestBoltAngle(359)).toBe(0);
    expect(screenAngleDeg([0, 0], [1, 0])).toBe(0);
    expect(screenAngleDeg([0, 0], [0, 1])).toBe(270);
    expect(screenAngleDeg([0, 0], [-1, -1])).toBeCloseTo(135, 9);
  });

  it("gives a far pixel its largest depth gap, and the first neighbour (left, right, up, down) on a tie", () => {
    // Row 0: [A near] [B far] [C near]; B has two equal-gap neighbours, left and right.
    const parts: (PartId | null)[] = ["torso", "head", "arm_l"];
    const lines = candidateLines(parts, [1, 1.5, 1], 3, 1, 0.05);
    expect([...lines]).toEqual([[1, 0]]);
    // A larger gap on the right wins over the earlier, smaller one on the left.
    const bigger = candidateLines(parts, [1, 1.5, 0.9], 3, 1, 0.05);
    expect([...bigger]).toEqual([[1, 2]]);
    // A gap under the threshold draws no line.
    expect(candidateLines(parts, [1, 1.04, 1.04], 3, 1, 0.05).size).toBe(0);
  });

  it("decodes part ids through the 8-bit round trip and refuses everything else", () => {
    expect(decodePartId(16)).toBe("head");
    expect(decodePartId(14)).toBe("head");
    expect(decodePartId(18)).toBe("head");
    expect(decodePartId(19)).toBeNull();
    expect(decodePartId(13)).toBeNull();
    expect(decodePartId(24)).toBe("torso");
    expect(decodePartId(255)).toBeNull();
  });
});
