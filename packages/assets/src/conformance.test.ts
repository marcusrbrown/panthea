import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newCandidate,
  parseConformanceReport,
  type Sha256,
  type SpriteManifest,
  transitionAsset,
} from "@panthea/contracts";
import {
  type ConformanceInput,
  conformImage,
  type GridParams,
  type Rgb,
  type RgbaImage,
  recoverGrid,
} from "./conformance";
import { committedVocabulary, spriteFixture } from "./fixtures";
import {
  COLOURS_71,
  cloneImage,
  figure5,
  figure71,
  hex,
  image,
  lcg,
  PALETTE_20,
  pixelAt,
  upscale,
} from "./fixtures/conformance/images";
import { sha256Hex } from "./hash";
import { encodeRgbaPng } from "./placeholder";
import { readPngHeader } from "./png";
import { loadRegistry, publishAsset } from "./registry";
import { resolveAsset } from "./resolve";

const CELL = { w: 64, h: 80 };
const GRID: GridParams = { edgeTolerance: 8, minConfidence: 0.9, minEdges: 50 };

function input(overrides: Partial<ConformanceInput> = {}): ConformanceInput {
  const img = figure71();
  return {
    ...img,
    kind: "sprite",
    mode: "auto",
    cell: CELL,
    pivot: { x: 32, y: 80 },
    paletteRgb: PALETTE_20,
    background: { type: "alpha" },
    alphaCutoff: 128,
    grid: GRID,
    ...overrides,
  };
}

describe("input validation", () => {
  const invalid = (field: string, overrides: Partial<ConformanceInput>) => {
    const result = conformImage(input(overrides));
    expect(result.status).toBe("invalid-input");
    if (result.status === "invalid-input") expect(result.field).toBe(field);
  };

  it("names the field of each unusable input", () => {
    invalid("width", { width: 0 });
    invalid("height", { height: 1.5 });
    invalid("rgba", { rgba: new Uint8Array(10) });
    invalid("kind", { kind: "tile" as never });
    invalid("mode", { mode: "dry-run" as never });
    invalid("cell", { cell: { w: 0, h: 80 } });
    invalid("pivot", { pivot: { x: 1.5, y: 2 } });
    invalid("paletteRgb", { paletteRgb: [] });
    invalid("paletteRgb[1]", {
      paletteRgb: [
        [1, 2, 3],
        [1, 2, 300],
      ],
    });
    invalid("accents", { accents: [[10, 20, 30]] });
    invalid("alphaCutoff", { alphaCutoff: 0 });
    invalid("alphaCutoff", { alphaCutoff: 256 });
    invalid("grid.edgeTolerance", { grid: { ...GRID, edgeTolerance: -1 } });
    invalid("grid.minConfidence", { grid: { ...GRID, minConfidence: 0 } });
    invalid("grid.minConfidence", { grid: { ...GRID, minConfidence: 1.5 } });
    invalid("grid.minEdges", { grid: { ...GRID, minEdges: 0 } });
    invalid("background.tolerance", {
      background: { type: "key", rgb: [1, 2, 3], tolerance: 300 },
    });
    invalid("background.rgb", {
      background: { type: "key", rgb: [1, 2] as never, tolerance: 3 },
    });
    invalid("scale", { scale: 0 });
    invalid("previous", {
      previous: { rgba: new Uint8Array(16), width: 2, height: 2 },
    });
    invalid("mirror", {
      mirror: {
        east: { rgba: new Uint8Array(16), width: 2, height: 2 },
        west: { rgba: new Uint8Array(16), width: 2, height: 2 },
        asymmetry: false,
      },
    });
  });

  it("allows accents on effects only, and at most four", () => {
    const accent = (n: number): Rgb => [10 * n, 20, 30];
    invalid("accents", {
      kind: "effect",
      accents: [1, 2, 3, 4, 5].map(accent),
    });
    invalid("accents[0]", { kind: "effect", accents: [[10, 20, 400]] });
  });

  it("does not mutate the input", () => {
    const given = input();
    const before = Uint8Array.from(given.rgba);
    conformImage(given);
    expect(given.rgba).toEqual(before);
  });
});

describe("grid recovery", () => {
  const big = (src = figure71()) => upscale(src, 8);

  it("is scale 1 with no edge evidence when the size already matches the cell", () => {
    const resolved = recoverGrid(figure71(), CELL, GRID);
    expect(resolved).toEqual({
      ok: true,
      grid: {
        scale: 1,
        source: "dimensions",
        confidence: null,
        onGridEdges: 0,
        offGridEdges: 0,
        coarserThanCell: false,
      },
    });
  });

  it("detects the 8x grid of the 71-colour figure with full confidence", () => {
    const resolved = recoverGrid(big(), CELL, GRID);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.grid).toMatchObject({
      scale: 8,
      source: "detected",
      confidence: 1,
      offGridEdges: 0,
      coarserThanCell: false,
    });
    // The 1x figure's edges, counted here without the module under test.
    let expected = 0;
    const src = figure71();
    const same = (a: number, b: number) =>
      [0, 1, 2, 3].every(
        (c) =>
          Math.abs((src.rgba[a + c] as number) - (src.rgba[b + c] as number)) <=
          GRID.edgeTolerance,
      );
    for (let y = 0; y < 80; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const here = (y * 64 + x) * 4;
        if (x < 63 && !same(here, here + 4)) expected += 1;
        if (y < 79 && !same(here, here + 256)) expected += 1;
      }
    }
    // Each 1x edge is 8 neighbour pairs along the block boundary.
    expect(resolved.grid.onGridEdges).toBe(expected * 8);
  });

  const needsScale = (
    name: string,
    img: ReturnType<typeof big>,
    check: (grid: {
      confidence: number | null;
      onGridEdges: number;
      offGridEdges: number;
      coarserThanCell: boolean;
    }) => void,
  ) =>
    it(`asks for the scale on ${name}`, () => {
      const resolved = recoverGrid(img, CELL, GRID);
      expect(resolved.ok).toBe(false);
      if (!resolved.ok && resolved.status === "needs-scale") {
        check(resolved.grid);
        expect(resolved.message.length).toBeGreaterThan(0);
      } else {
        throw new Error(
          `expected needs-scale, got ${JSON.stringify(resolved).slice(0, 120)}`,
        );
      }
    });

  needsScale(
    "a solid image",
    image(512, 640, () => [90, 60, 30, 255]),
    (g) => {
      expect(g.onGridEdges + g.offGridEdges).toBe(0);
      expect(g.confidence).toBeNull();
    },
  );
  needsScale(
    "a smooth gradient below the edge tolerance",
    image(512, 640, (x, y) => [Math.floor(x / 4), Math.floor(y / 5), 100, 255]),
    (g) => expect(g.onGridEdges + g.offGridEdges).toBe(0),
  );
  const noise = lcg(7);
  needsScale(
    "seeded noise",
    image(512, 640, () => {
      const v = noise();
      return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, 255];
    }),
    (g) => {
      expect(g.confidence as number).toBeLessThan(0.2);
      expect(g.offGridEdges).toBeGreaterThan(g.onGridEdges);
    },
  );
  needsScale(
    "a true 4x grid under an 8x claim",
    upscale(
      image(128, 160, (x, y) => {
        const [r, g, b] = COLOURS_71[(x * 7 + y * 13) % 71] as Rgb;
        return [r, g, b, 255];
      }),
      4,
    ),
    (g) => {
      expect(g.confidence).toBeCloseTo(0.5, 1);
      expect(g.coarserThanCell).toBe(false);
    },
  );
  needsScale("a grid shifted by 3 pixels", upscale(figure71(), 8, 3), (g) => {
    expect(g.onGridEdges).toBe(0);
    expect(g.offGridEdges).toBeGreaterThan(0);
  });
  needsScale(
    "a 16x grid under an 8x claim, reporting the coarser native grid",
    upscale(
      image(32, 40, (x, y) => {
        const [r, g, b] = COLOURS_71[(x * 7 + y * 13) % 71] as Rgb;
        return [r, g, b, 255];
      }),
      16,
    ),
    (g) => {
      expect(g.confidence).toBe(1);
      expect(g.coarserThanCell).toBe(true);
    },
  );

  it("accepts noise below the tolerance and rejects noise above it", () => {
    const withNoise = (amplitude: number) => {
      const rand = lcg(11);
      const src = big();
      const out = Uint8Array.from(src.rgba);
      for (let i = 0; i < out.length; i += 4) {
        if (out[i + 3] === 0) continue;
        for (let c = 0; c < 3; c += 1) {
          const delta = (rand() % (2 * amplitude + 1)) - amplitude;
          out[i + c] = Math.min(
            255,
            Math.max(0, (out[i + c] as number) + delta),
          );
        }
      }
      return { ...src, rgba: out };
    };
    // Tolerance 8: noise of +-3 moves neighbours apart by at most 6.
    const quiet = recoverGrid(withNoise(3), CELL, GRID);
    expect(quiet.ok).toBe(true);
    if (quiet.ok)
      expect(quiet.grid.confidence as number).toBeGreaterThanOrEqual(0.9);
    const loud = recoverGrid(withNoise(40), CELL, GRID);
    expect(loud.ok).toBe(false);
  });

  it("rejects dimensions that are no integer multiple of the cell", () => {
    const resolved = recoverGrid(
      image(500, 640, () => [1, 2, 3, 255]),
      CELL,
      GRID,
    );
    expect(resolved).toMatchObject({
      ok: false,
      status: "invalid-input",
      field: "width",
    });
    const tall = recoverGrid(
      image(512, 600, () => [1, 2, 3, 255]),
      CELL,
      GRID,
    );
    expect(tall).toMatchObject({
      ok: false,
      status: "invalid-input",
      field: "height",
    });
    const skew = recoverGrid(
      image(512, 480, () => [1, 2, 3, 255]),
      CELL,
      GRID,
    );
    expect(skew).toMatchObject({
      ok: false,
      status: "invalid-input",
      field: "height",
    });
  });

  it("takes a supplied scale without the confidence gate, and keeps the evidence", () => {
    const smooth = image(512, 640, (x, y) => [
      Math.floor(x / 4),
      Math.floor(y / 5),
      100,
      255,
    ]);
    const resolved = recoverGrid(smooth, CELL, GRID, 8);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.grid).toMatchObject({
        scale: 8,
        source: "supplied",
        onGridEdges: 0,
        offGridEdges: 0,
      });
    }
    const real = recoverGrid(big(), CELL, GRID, 8);
    expect(real.ok && real.grid.confidence).toBe(1);
  });

  it("rejects a supplied scale that does not fit the image and cell", () => {
    const resolved = recoverGrid(big(), CELL, GRID, 4);
    expect(resolved).toMatchObject({
      ok: false,
      status: "invalid-input",
      field: "scale",
    });
    const one = recoverGrid(big(), CELL, GRID, 1);
    expect(one).toMatchObject({
      ok: false,
      status: "invalid-input",
      field: "scale",
    });
  });
});

describe("resampling to the cell", () => {
  const input5 = (
    img = upscale(figure5(), 8),
    overrides: Partial<ConformanceInput> = {},
  ) => input({ ...img, ...overrides });

  const done = (result: ReturnType<typeof conformImage>) => {
    if (result.status !== "done") {
      throw new Error(
        `expected done, got ${JSON.stringify(result).slice(0, 200)}`,
      );
    }
    return result;
  };

  it("samples each block's centre pixel and counts the blocks that blend colours", () => {
    const src = cloneImage(upscale(figure5(), 8));
    const put = (
      x: number,
      y: number,
      rgba: readonly [number, number, number, number],
    ) => src.rgba.set(rgba, (y * src.width + x) * 4);
    // Corner pixels are not the centre sample: five blend, one stays within tolerance.
    for (const [bx, by] of [
      [20, 10],
      [21, 10],
      [30, 40],
      [40, 60],
      [17, 70],
    ] as const) {
      put(bx * 8, by * 8, [255, 255, 0, 255]);
    }
    const [r, g, b] = pixelAt(src, 25 * 8, 20 * 8);
    put(25 * 8, 20 * 8, [r + 5, g, b, 255]);
    // The centre pixel of block (22, 15) decides that block: x = 22*8+4, y = 15*8+4.
    put(22 * 8 + 4, 15 * 8 + 4, [32, 56, 96, 255]);

    const result = done(conformImage(input5(src)));
    expect(result.image).toMatchObject({ width: 64, height: 80 });
    expect(result.metrics.resize).toEqual({
      from: { w: 512, h: 640 },
      to: { w: 64, h: 80 },
      factor: 8,
      detected: true,
      supplied: false,
    });
    expect(result.metrics.blendedBlocks).toBe(6);
    expect(pixelAt(result.image, 22, 15)).toEqual([32, 56, 96, 255]);
    expect(pixelAt(result.image, 20, 10)).toEqual(pixelAt(figure5(), 20, 10));
    expect(result.metrics.grid).toMatchObject({
      scale: 8,
      source: "detected",
      confidence: expect.any(Number),
    });
  });

  it("is a straight copy when the size already matches the cell", () => {
    const result = done(conformImage(input5(figure5())));
    expect(result.image.rgba).toEqual(figure5().rgba);
    expect(result.metrics.resize).toMatchObject({
      factor: 1,
      detected: false,
      supplied: false,
    });
    expect(result.metrics.blendedBlocks).toBe(0);
  });

  it("carries the grid evidence of a supplied scale through", () => {
    const smooth = image(512, 640, (x, y) => [
      Math.floor(x / 4),
      Math.floor(y / 5),
      100,
      255,
    ]);
    const result = done(conformImage(input5(smooth, { scale: 8 })));
    expect(result.metrics.resize).toMatchObject({
      factor: 8,
      detected: false,
      supplied: true,
    });
    expect(result.metrics.grid).toMatchObject({ source: "supplied", scale: 8 });
  });

  it("returns the grid evidence when the scale must be supplied", () => {
    const result = conformImage(
      input5(image(512, 640, () => [90, 60, 30, 255])),
    );
    expect(result.status).toBe("needs-scale");
    if (result.status === "needs-scale") {
      expect(result.grid).toMatchObject({
        scale: 8,
        onGridEdges: 0,
        offGridEdges: 0,
      });
    }
  });
});

describe("background and alpha", () => {
  const A: Rgb = PALETTE_20[0] as Rgb;
  const B: Rgb = PALETTE_20[5] as Rgb;
  const K: Rgb = [255, 0, 255];
  const cellOf = (w: number, h: number, pixel: Parameters<typeof image>[2]) =>
    input({
      ...image(w, h, pixel),
      cell: { w, h },
      pivot: undefined,
      paletteRgb: [A, B],
      background: { type: "key", rgb: K, tolerance: 4 },
    });
  const run = (given: ConformanceInput) => {
    const result = conformImage(given);
    if (result.status !== "done") {
      throw new Error(
        `expected done, got ${JSON.stringify(result).slice(0, 200)}`,
      );
    }
    return result;
  };

  it("removes only the key colour reachable from the border, and counts it", () => {
    const counters = cellOf(6, 6, (x, y) => {
      if (x === 0 || y === 0 || x === 5 || y === 5) {
        return x === 5 && y === 5 ? [253, 2, 255, 255] : [...K, 255];
      }
      if (x === 2 && y === 2) return [...K, 255]; // enclosed: stays
      if (x === 4 && y === 3) return [...B, 100]; // below the cutoff: becomes transparent
      if (x === 2 && y === 4) return [...A, 200]; // at or above: becomes opaque
      return [...A, 255];
    });
    const result = run(counters);
    expect(result.metrics.keyedPixels).toBe(20);
    expect(result.metrics.alphaChanged).toBe(2);
    expect(pixelAt(result.image, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(result.image, 5, 5)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(result.image, 2, 2)[3]).toBe(255);
    expect(pixelAt(result.image, 4, 3)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(result.image, 2, 4)).toEqual([...A, 255]);
  });

  it("does not start from a border that is not the key colour", () => {
    const framed = cellOf(6, 6, (x, y) =>
      x === 0 || y === 0 || x === 5 || y === 5 ? [...A, 255] : [...K, 255],
    );
    expect(run(framed).metrics.keyedPixels).toBe(0);
  });

  it("stops at the tolerance edge", () => {
    const near = cellOf(6, 6, (x, y) => {
      if (x === 0 && y === 3) return [250, 0, 255, 255]; // 5 away: outside tolerance 4
      return x === 0 || y === 0 || x === 5 || y === 5
        ? [...K, 255]
        : [...A, 255];
    });
    const result = run(near);
    expect(result.metrics.keyedPixels).toBe(19);
    expect(pixelAt(result.image, 0, 3)[3]).toBe(255);
  });

  it("does not leak through a diagonal wall (4-connected fill)", () => {
    const diamond = cellOf(5, 5, (x, y) =>
      (x === 1 && y === 2) ||
      (x === 3 && y === 2) ||
      (x === 2 && y === 1) ||
      (x === 2 && y === 3)
        ? [...A, 255]
        : [...K, 255],
    );
    const result = run(diamond);
    expect(result.metrics.keyedPixels).toBe(20);
    expect(pixelAt(result.image, 2, 2)[3]).toBe(255);
  });

  it("binarises alpha at the cutoff and never touches the input", () => {
    const edge = cellOf(
      4,
      1,
      (x) =>
        [
          [...A, 127],
          [...A, 128],
          [...A, 0],
          [...A, 255],
        ][x] as [number, number, number, number],
    );
    const given = { ...edge, background: { type: "alpha" } as const };
    const before = Uint8Array.from(given.rgba);
    const result = run(given);
    expect([0, 1, 2, 3].map((x) => pixelAt(result.image, x, 0))).toEqual([
      [0, 0, 0, 0],
      [...A, 255],
      [0, 0, 0, 0],
      [...A, 255],
    ]);
    expect(result.metrics.alphaChanged).toBe(2);
    expect(given.rgba).toEqual(before);
  });
});

describe("colour reduction and palette mapping", () => {
  const run = (given: ConformanceInput) => {
    const result = conformImage(given);
    if (result.status !== "done") {
      throw new Error(
        `expected done, got ${JSON.stringify(result).slice(0, 200)}`,
      );
    }
    return result;
  };
  const row = (colours: readonly (readonly [number, number, number])[]) =>
    input({
      ...image(colours.length, 1, (x) => [...(colours[x] as Rgb), 255]),
      cell: { w: colours.length, h: 1 },
      pivot: undefined,
    });
  const opaque = (img: { rgba: Uint8Array }) => {
    const out: Rgb[] = [];
    for (let i = 0; i < img.rgba.length; i += 4) {
      if (img.rgba[i + 3] !== 0)
        out.push([img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]] as Rgb);
    }
    return out;
  };
  const inPalette = (rgb: Rgb, palette: readonly Rgb[] = PALETTE_20) =>
    palette.some((p) => p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2]);

  it("takes the 71-colour 8x figure to the 64x80 grid within 16 palette colours, with measured counts", () => {
    const result = run(input({ ...upscale(figure71(), 8) }));
    expect(result.image).toMatchObject({ width: 64, height: 80 });
    const colours = opaque(result.image);
    expect(colours.every((c) => inPalette(c))).toBe(true);
    const distinct = new Set(colours.map((c) => hex(c)));
    expect(distinct.size).toBeLessThanOrEqual(16);
    expect(result.metrics.coloursBefore).toBe(71);
    expect(result.metrics.coloursAfter).toBe(distinct.size);
    expect(result.metrics.coloursMerged).toBe(71 - distinct.size);
    expect(result.metrics.iterations).toBeGreaterThan(0);

    // Independent reference: compare the figure with the output pixel by pixel.
    const source = figure71();
    let changed = 0;
    const perColour = new Map<string, number>();
    for (let i = 0; i < source.rgba.length; i += 4) {
      if (source.rgba[i + 3] === 0) continue;
      const before: Rgb = [
        source.rgba[i],
        source.rgba[i + 1],
        source.rgba[i + 2],
      ] as Rgb;
      const after: Rgb = [
        result.image.rgba[i],
        result.image.rgba[i + 1],
        result.image.rgba[i + 2],
      ] as Rgb;
      if (hex(before) !== hex(after)) {
        changed += 1;
        const key = hex(before, 255).slice(0, 7);
        perColour.set(key, (perColour.get(key) ?? 0) + 1);
      }
    }
    expect(result.metrics.pixelsRecoloured).toBe(changed);
    expect(result.metrics.pixelsChanged).toBe(changed);
    const expectedMap = [...perColour.entries()]
      .map(([from, pixels]) => ({ from, pixels }))
      .sort((a, b) => b.pixels - a.pixels || (a.from < b.from ? -1 : 1));
    expect(
      result.metrics.colourMap.map(({ from, pixels }) => ({ from, pixels })),
    ).toEqual(expectedMap);
    expect(
      result.metrics.colourMap.every((e) => /^#[0-9a-f]{6}$/.test(e.to)),
    ).toBe(true);
  });

  it("leaves a figure that is already on the palette and within budget untouched", () => {
    const result = run(input({ ...upscale(figure5(), 8) }));
    expect(result.image.rgba).toEqual(figure5().rgba);
    expect(result.metrics).toMatchObject({
      coloursBefore: 5,
      coloursAfter: 5,
      coloursMerged: 0,
      iterations: 0,
      colourMap: [],
      pixelsRecoloured: 0,
      pixelsChanged: 0,
    });
  });

  it("merges a near-duplicate colour into its neighbour by weighted clustering", () => {
    const base = PALETTE_20.slice(0, 16);
    const near: Rgb = [153, 113, 121]; // palette[3] + 1 per channel
    const colours = [...base, ...base, near];
    const result = run(row(colours));
    expect(result.metrics.coloursBefore).toBe(17);
    expect(result.metrics.coloursAfter).toBe(16);
    expect(result.metrics.coloursMerged).toBe(1);
    expect(result.metrics.pixelsRecoloured).toBe(1);
    expect(result.metrics.colourMap).toEqual([
      {
        from: hex(near).slice(0, 7),
        to: hex(base[3] as Rgb).slice(0, 7),
        pixels: 1,
      },
    ]);
    expect(opaque(result.image).every((c) => inPalette(c))).toBe(true);
  });

  it("runs no clustering at exactly the sprite budget, only the palette mapping", () => {
    const sixteen = Array.from(
      { length: 16 },
      (_, i) => COLOURS_71[i * 4] as Rgb,
    );
    const result = run(row(sixteen));
    expect(result.metrics.iterations).toBe(0);
    expect(result.metrics.coloursBefore).toBe(16);
    expect(opaque(result.image).every((c) => inPalette(c))).toBe(true);
    const seventeen = [...sixteen, COLOURS_71[70] as Rgb];
    expect(run(row(seventeen)).metrics.iterations).toBeGreaterThan(0);
  });

  it("allows 32 colours on a portrait and 16 on a sprite", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => COLOURS_71[i] as Rgb);
    const portrait = run({ ...row(thirty), kind: "portrait" });
    expect(portrait.metrics.iterations).toBe(0);
    const forty = Array.from({ length: 40 }, (_, i) => COLOURS_71[i] as Rgb);
    expect(
      run({ ...row(forty), kind: "portrait" }).metrics.iterations,
    ).toBeGreaterThan(0);
    expect(run(row(thirty)).metrics.iterations).toBeGreaterThan(0);
  });

  it("breaks a palette tie towards the lower index and never dithers", () => {
    const palette: Rgb[] = [
      [10, 10, 10],
      [30, 10, 10],
    ];
    const result = run({ ...row([[20, 10, 10]]), paletteRgb: palette });
    expect(opaque(result.image)).toEqual([[10, 10, 10]]);
  });

  it("gives effects the palette plus declared accents with no colour limit, mapping the rest", () => {
    const accent: Rgb = [255, 240, 128];
    const colours: Rgb[] = [...PALETTE_20, accent];
    const effect = (extra: readonly Rgb[] = []) =>
      run({
        ...row([...colours, ...extra]),
        kind: "effect",
        accents: [accent],
      });
    const clean = effect();
    expect(clean.metrics).toMatchObject({
      coloursBefore: 21,
      coloursAfter: 21,
      coloursMerged: 0,
      iterations: 0,
      pixelsRecoloured: 0,
    });
    const stray: Rgb = [250, 235, 120];
    const mapped = effect([stray]);
    expect(mapped.metrics.colourMap).toEqual([
      { from: hex(stray).slice(0, 7), to: hex(accent).slice(0, 7), pixels: 1 },
    ]);
    expect(mapped.metrics.pixelsRecoloured).toBe(1);
  });
});

// --- Checks, report-only mode, diffs, determinism ---------------------------------

const done = (given: ConformanceInput) => {
  const result = conformImage(given);
  if (result.status !== "done") {
    throw new Error(
      `expected done, got ${JSON.stringify(result).slice(0, 200)}`,
    );
  }
  return result;
};
const check = (result: ReturnType<typeof done>, id: string) =>
  result.report.checks.find((c) => c.check === id);
const ids = (result: ReturnType<typeof done>) =>
  result.report.checks.map((c) => c.check);
const rgbaHex = (
  img: { rgba: Uint8Array; width: number },
  x: number,
  y: number,
) => {
  const [r, g, b, a] = pixelAt(img as never, x, y);
  return a === 0 ? "#00000000" : hex([r, g, b], a);
};

const A: Rgb = PALETTE_20[0] as Rgb;
const B: Rgb = PALETTE_20[5] as Rgb;
const small = (
  w: number,
  h: number,
  pixel: Parameters<typeof image>[2],
  overrides: Partial<ConformanceInput> = {},
) =>
  input({
    ...image(w, h, pixel),
    cell: { w, h },
    pivot: undefined,
    paletteRgb: [A, B],
    ...overrides,
  });
const T: [number, number, number, number] = [0, 0, 0, 0];

describe("the report", () => {
  it("lists the sprite checks in a fixed order and is a valid contract report", () => {
    const result = done(input({ ...upscale(figure71(), 8) }));
    expect(ids(result)).toEqual([
      "grid",
      "canvas",
      "binary-alpha",
      "palette",
      "colour-count",
      "pure-black-white",
      "pivot",
      "silhouette",
    ]);
    expect(result.report.status).toBe("pass");
    expect(parseConformanceReport(result.report).ok).toBe(true);
    expect(check(result, "grid")?.message).toContain("8x");
    expect(check(result, "colour-count")?.message).toContain("limit 16");
  });

  it("fails overall when any check fails, with a specific message", () => {
    const result = done(
      input({ ...figure5(), mode: "report-only", pivot: { x: 65, y: 10 } }),
    );
    expect(result.report.status).toBe("fail");
    expect(check(result, "pivot")).toMatchObject({ status: "fail" });
    expect(check(result, "pivot")?.message).toContain("65,10");
  });
});

describe("report-only mode", () => {
  const hand20 = () =>
    image(64, 80, (x, y) =>
      x < 16 || x >= 48 || y < 8 || y >= 72
        ? T
        : [...(PALETTE_20[(x * 3 + y) % 20] as Rgb), 255],
    );

  it("keeps the input bytes, reports the violation and proposes the cleanup with a diff", () => {
    const source = hand20();
    const given = input({ ...source, mode: "report-only" });
    const result = done(given);
    expect(result.image.rgba).toEqual(source.rgba);
    expect(result.image.rgba).not.toBe(given.rgba);
    expect(given.rgba).toEqual(source.rgba);
    expect(check(result, "colour-count")).toMatchObject({ status: "fail" });
    expect(check(result, "colour-count")?.message).toContain("20");
    expect(check(result, "palette")).toMatchObject({ status: "pass" });
    expect(result.report.status).toBe("fail");

    expect(result.proposal.rgba).not.toEqual(source.rgba);
    expect(result.diff.length).toBeGreaterThan(0);
    expect(result.metrics.pixelsChanged).toBe(result.diff.length);
    let last = -1;
    for (const entry of result.diff) {
      const order = entry.y * 64 + entry.x;
      expect(order).toBeGreaterThan(last);
      last = order;
      expect(entry.before).toBe(rgbaHex(source, entry.x, entry.y));
      expect(entry.after).toBe(rgbaHex(result.proposal, entry.x, entry.y));
      expect(entry.before).not.toBe(entry.after);
    }
    // A pixel not in the diff is unchanged.
    const changed = new Set(result.diff.map((d) => d.y * 64 + d.x));
    for (let p = 0; p < 64 * 80; p += 1) {
      if (changed.has(p)) continue;
      expect(rgbaHex(result.proposal, p % 64, Math.floor(p / 64))).toBe(
        rgbaHex(source, p % 64, Math.floor(p / 64)),
      );
    }
  });

  it("reports the actual size and blending of an oversized input without resizing it", () => {
    const big = upscale(figure5(), 8);
    const result = done(input({ ...big, mode: "report-only" }));
    expect(result.image).toMatchObject({ width: 512, height: 640 });
    expect(result.image.rgba).toEqual(big.rgba);
    expect(check(result, "canvas")).toMatchObject({ status: "fail" });
    expect(check(result, "canvas")?.message).toContain("512x640");
    expect(check(result, "grid")).toMatchObject({ status: "pass" });
    expect(result.proposal).toMatchObject({ width: 64, height: 80 });
    expect(result.proposal.rgba).toEqual(figure5().rgba);
  });

  it("flags fractional alpha on every kind and fixes it only in auto mode", () => {
    for (const kind of ["sprite", "portrait", "effect"] as const) {
      const src = cloneImage(figure5());
      src.rgba[(20 * 64 + 20) * 4 + 3] = 100;
      const accents = kind === "effect" ? { accents: [] as Rgb[] } : {};
      const report = done(
        input({ ...src, kind, mode: "report-only", ...accents }),
      );
      expect(check(report, "binary-alpha")).toMatchObject({ status: "fail" });
      expect(check(report, "binary-alpha")?.message).toContain("20,20");
      const auto = done(input({ ...src, kind, mode: "auto", ...accents }));
      expect(check(auto, "binary-alpha")).toMatchObject({ status: "pass" });
      expect(auto.metrics.alphaChanged).toBe(1);
    }
  });

  it("returns a typed result with an unchanged input in auto mode too", () => {
    const given = input({ ...upscale(figure71(), 8) });
    const before = Uint8Array.from(given.rgba);
    done(given);
    expect(given.rgba).toEqual(before);
  });
});

describe("colour hidden under alpha 0", () => {
  const base = () => upscale(figure5(), 8);
  /** Deterministic non-zero, per-pixel varying RGB on every alpha-0 pixel. */
  const withHiddenRgb = (src: RgbaImage): RgbaImage => {
    const out = cloneImage(src);
    const rand = lcg(7);
    for (let at = 0; at < out.rgba.length; at += 4) {
      if (out.rgba[at + 3] !== 0) continue;
      for (let c = 0; c < 3; c += 1) {
        out.rgba[at + c] = 1 + ((rand() >>> 8) % 255);
      }
    }
    return out;
  };
  const png = (img: RgbaImage) =>
    Buffer.from(encodeRgbaPng(img.rgba, img.width, img.height));

  it("recovers the same grid evidence as the zero-filled image", () => {
    const baseline = recoverGrid(base(), CELL, GRID);
    expect(baseline).toMatchObject({
      ok: true,
      grid: { scale: 8, source: "detected", confidence: 1, offGridEdges: 0 },
    });
    expect(recoverGrid(withHiddenRgb(base()), CELL, GRID)).toEqual(baseline);
  });

  it("counts no blended block for colour no pixel shows", () => {
    const result = done(input({ ...withHiddenRgb(base()), scale: 8 }));
    expect(result.metrics.blendedBlocks).toBe(0);
  });

  it("conforms in auto mode to the same result and PNG bytes as the zero-filled image", () => {
    const baseline = done(input({ ...base() }));
    const given = input({ ...withHiddenRgb(base()) });
    expect(conformImage(given)).toEqual(baseline);
    expect(png(done(given).image).equals(png(baseline.image))).toBe(true);
  });

  it("reports the same evidence in report-only mode and leaves every input byte untouched", () => {
    const source = withHiddenRgb(base());
    const snapshot = Uint8Array.from(source.rgba);
    const baseline = done(input({ ...base(), mode: "report-only" }));
    const given = input({ ...source, mode: "report-only" });
    expect(conformImage(given).status).toBe("done");
    const result = done(given);
    expect(result.proposal).toEqual(baseline.proposal);
    expect(result.report).toEqual(baseline.report);
    expect(result.metrics).toEqual(baseline.metrics);
    expect(result.diff).toEqual(baseline.diff);
    expect(result.editDiff).toEqual(baseline.editDiff);
    expect(result.image.rgba).toEqual(snapshot);
    expect(result.image.rgba).not.toBe(given.rgba);
    expect(given.rgba).toEqual(snapshot);
    expect(result.image.rgba).not.toEqual(baseline.image.rgba);
  });

  describe("edge counts on a 2x grid", () => {
    const edges = (pixel: Parameters<typeof image>[2]) => {
      const resolved = recoverGrid(
        image(8, 8, pixel),
        { w: 4, h: 4 },
        { edgeTolerance: 8, minConfidence: 0.5, minEdges: 1 },
      );
      if (!("grid" in resolved)) throw new Error(resolved.message);
      return {
        on: resolved.grid.onGridEdges,
        off: resolved.grid.offGridEdges,
      };
    };
    const hiddenAt = (
      x: number,
      y: number,
    ): [number, number, number, number] => [
      1 + ((x * 31 + y * 17) % 255),
      1 + ((x * 13 + y * 29) % 255),
      1 + ((x * 7 + y * 11) % 255),
      0,
    ];

    it("finds no edge between pixels that differ only in hidden colour", () => {
      expect(edges((x, y) => hiddenAt(x, y))).toEqual({ on: 0, off: 0 });
    });

    it("still finds the boundary of transparent against opaque", () => {
      expect(
        edges((x, y) => (x < 4 ? hiddenAt(x, y) : [0, 0, 0, 255])),
      ).toEqual({ on: 8, off: 0 });
    });

    it("finds no edge when the alpha step is within the tolerance and the visible colour is zero", () => {
      expect(edges((x, y) => (x < 4 ? hiddenAt(x, y) : [0, 0, 0, 5]))).toEqual({
        on: 0,
        off: 0,
      });
    });

    it("finds the boundary when the alpha step exceeds the tolerance", () => {
      expect(edges((x, y) => (x < 4 ? hiddenAt(x, y) : [0, 0, 0, 20]))).toEqual(
        { on: 8, off: 0 },
      );
    });
  });
});

describe("silhouette, pivot and palette rules", () => {
  it("passes one connected shape, including diagonal contact", () => {
    const diagonal = done(
      small(6, 6, (x, y) =>
        (x === 1 && y === 1) || (x === 2 && y === 2) ? [...A, 255] : T,
      ),
    );
    expect(check(diagonal, "silhouette")).toMatchObject({ status: "pass" });
  });

  it("fails two parts, and names single-pixel strays by coordinate", () => {
    const blob = (x: number, y: number) => x >= 3 && x <= 5 && y >= 1 && y <= 3;
    const strays = done(
      small(8, 5, (x, y) =>
        blob(x, y) || (x === 0 && y === 0) || (x === 7 && y === 4)
          ? [...A, 255]
          : T,
      ),
    );
    expect(check(strays, "silhouette")).toMatchObject({ status: "fail" });
    expect(check(strays, "silhouette")?.message).toContain("3 connected parts");
    expect(check(strays, "silhouette")?.message).toContain("0,0");
    expect(check(strays, "silhouette")?.message).toContain("7,4");
    const blobs = done(
      small(8, 4, (x, y) =>
        y >= 1 && y <= 2 && (x <= 1 || x >= 5) ? [...A, 255] : T,
      ),
    );
    expect(check(blobs, "silhouette")?.message).toContain("2 connected parts");
    expect(check(blobs, "silhouette")?.message).not.toContain("stray");
  });

  it("fails an empty sprite and does not apply the rule to portraits or effects", () => {
    expect(check(done(small(4, 4, () => T)), "silhouette")).toMatchObject({
      status: "fail",
    });
    const split = (x: number, y: number) =>
      y === 1 && (x === 0 || x === 3)
        ? ([...A, 255] as [number, number, number, number])
        : T;
    expect(ids(done(small(4, 3, split, { kind: "portrait" })))).not.toContain(
      "silhouette",
    );
    expect(
      ids(done(small(4, 3, split, { kind: "effect", accents: [] }))),
    ).not.toContain("silhouette");
    expect(done(small(4, 3, split, { kind: "portrait" })).report.status).toBe(
      "pass",
    );
  });

  it("checks only the declared pivot against the cell, bottom and right edges included", () => {
    const at = (x: number, y: number) =>
      done(input({ ...figure5(), pivot: { x, y } }));
    expect(check(at(32, 80), "pivot")).toMatchObject({ status: "pass" });
    expect(check(at(64, 80), "pivot")).toMatchObject({ status: "pass" });
    expect(check(at(0, 0), "pivot")).toMatchObject({ status: "pass" });
    expect(check(at(65, 10), "pivot")).toMatchObject({ status: "fail" });
    expect(check(at(-1, 10), "pivot")).toMatchObject({ status: "fail" });
    expect(check(at(10, 81), "pivot")).toMatchObject({ status: "fail" });
    expect(ids(done(input({ ...figure5(), pivot: undefined })))).not.toContain(
      "pivot",
    );
  });

  it("fails pure black and white in a sprite even when the palette holds them", () => {
    const black: Rgb = [0, 0, 0];
    const white: Rgb = [255, 255, 255];
    const sprite = (rgb: Rgb, kind: "sprite" | "portrait") =>
      done(
        small(3, 1, (x) => (x === 1 ? [...rgb, 255] : [...A, 255]), {
          paletteRgb: [A, black, white],
          kind,
        }),
      );
    expect(check(sprite(black, "sprite"), "pure-black-white")).toMatchObject({
      status: "fail",
    });
    expect(
      check(sprite(white, "sprite"), "pure-black-white")?.message,
    ).toContain("#ffffff");
    expect(ids(sprite(black, "portrait"))).not.toContain("pure-black-white");
  });

  it("holds an effect to the palette plus its declared accents", () => {
    const accent: Rgb = [255, 240, 128];
    const strayColour: Rgb = [250, 10, 10];
    const effect = (pixels: Rgb[], overrides: Partial<ConformanceInput> = {}) =>
      done(
        small(pixels.length, 1, (x) => [...(pixels[x] as Rgb), 255], {
          kind: "effect",
          accents: [accent],
          pivot: { x: 1, y: 1 },
          ...overrides,
        }),
      );
    const clean = effect([A, accent]);
    expect(ids(clean)).toEqual([
      "grid",
      "canvas",
      "binary-alpha",
      "palette",
      "pivot",
      "accents",
    ]);
    expect(clean.report.status).toBe("pass");
    expect(check(clean, "accents")?.message).toContain("1 declared accent");
    const undeclared = effect([A, strayColour], { mode: "report-only" });
    expect(check(undeclared, "palette")).toMatchObject({ status: "fail" });
    expect(check(undeclared, "palette")?.message).toContain("#fa0a0a");
    expect(check(effect([A, strayColour]), "palette")).toMatchObject({
      status: "pass",
    });
    expect(effect([A, strayColour]).metrics.pixelsRecoloured).toBe(1);
  });

  it("compares west with the flipped east frame unless an asymmetry is declared", () => {
    const east = image(4, 2, (x, y) => [
      ...(PALETTE_20[(x + 2 * y) % 5] as Rgb),
      255,
    ]);
    const flipped = image(4, 2, (x, y) => pixelAt(east, 3 - x, y));
    const mirror = (west: typeof east, asymmetry = false) =>
      done(
        small(4, 2, () => [...A, 255], { mirror: { east, west, asymmetry } }),
      );
    expect(check(mirror(flipped), "mirror")).toMatchObject({ status: "pass" });
    const off = cloneImage(flipped);
    off.rgba[(1 * 4 + 2) * 4] = (off.rgba[(1 * 4 + 2) * 4] as number) ^ 0x40;
    expect(check(mirror(off), "mirror")).toMatchObject({ status: "fail" });
    expect(check(mirror(off), "mirror")?.message).toContain("2,1");
    expect(check(mirror(off, true), "mirror")).toMatchObject({
      status: "pass",
    });
    expect(check(mirror(off, true), "mirror")?.message).toContain(
      "asymmetry declared",
    );
    expect(ids(done(small(4, 2, () => [...A, 255])))).not.toContain("mirror");
  });
});

describe("the edit diff", () => {
  it("shows what the edit changed against the previous version, row-major", () => {
    const previous = figure5();
    const edited = cloneImage(previous);
    const put = (x: number, y: number, rgb: Rgb) =>
      edited.rgba.set([...rgb, 255], (y * 64 + x) * 4);
    put(30, 20, PALETTE_20[10] as Rgb);
    put(18, 21, PALETTE_20[11] as Rgb);
    put(40, 9, PALETTE_20[12] as Rgb);
    const result = done(input({ ...edited, mode: "report-only", previous }));
    expect(result.editDiff).toEqual([
      {
        x: 40,
        y: 9,
        before: rgbaHex(previous, 40, 9),
        after: hex(PALETTE_20[12] as Rgb),
      },
      {
        x: 30,
        y: 20,
        before: rgbaHex(previous, 30, 20),
        after: hex(PALETTE_20[10] as Rgb),
      },
      {
        x: 18,
        y: 21,
        before: rgbaHex(previous, 18, 21),
        after: hex(PALETTE_20[11] as Rgb),
      },
    ]);
    expect(done(input({ ...edited })).editDiff).toBeNull();
  });
});

describe("determinism and the PNG it feeds", () => {
  const canonical = (result: ReturnType<typeof done>) =>
    JSON.stringify(result, (_, v) =>
      v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v,
    );

  it("repeats the same report, metrics and PNG bytes for the same input", () => {
    const run = () => done(input({ ...upscale(figure71(), 8) }));
    const first = run();
    const second = run();
    expect(canonical(second)).toBe(canonical(first));
    const png = encodeRgbaPng(
      first.image.rgba,
      first.image.width,
      first.image.height,
    );
    const again = encodeRgbaPng(
      second.image.rgba,
      second.image.width,
      second.image.height,
    );
    expect(sha256Hex(again)).toBe(sha256Hex(png));
    expect(Buffer.from(again).equals(Buffer.from(png))).toBe(true);
    expect(readPngHeader(png)).toMatchObject({
      width: 64,
      height: 80,
      bitDepth: 8,
      colorType: 6,
    });
  });
});

describe("conformance feeding the registry", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  it("publishes a conformed atlas under the report it produced and resolves it as canon", () => {
    const result = done(input({ ...upscale(figure71(), 8) }));
    expect(result.report.status).toBe("pass");
    const strip = image(256, 80, (x, y) => pixelAt(result.image, x % 64, y));
    const bytes = encodeRgbaPng(strip.rgba, 256, 80);
    const hash = sha256Hex(bytes) as Sha256;
    const base = spriteFixture().manifest;
    const manifest: SpriteManifest = {
      ...base,
      atlas: { blob: hash, width: 256, height: 80 },
    };

    let record = newCandidate(manifest, result.report);
    for (const action of [{ type: "pick" }, { type: "approve" }] as const) {
      const next = transitionAsset(record, action);
      if (!next.ok) throw new Error(next.message);
      record = next.value;
    }
    const dir = join(mkdtempSync(join(tmpdir(), "conformance-")), "registry");
    dirs.push(join(dir, ".."));
    const vocabulary = committedVocabulary();
    const published = publishAsset(
      dir,
      record,
      new Map([[hash, bytes]]),
      vocabulary,
    );
    expect(published.ok).toBe(true);
    const loaded = loadRegistry(dir, vocabulary);
    expect(loaded.problems).toEqual([]);
    expect(
      resolveAsset(loaded.snapshot, { spriteId: "placeholder-zeus" }),
    ).toMatchObject({ source: "canon" });
  });

  it("does not let a failing report be approved", () => {
    const result = done(
      input({ ...figure5(), mode: "report-only", pivot: { x: 99, y: 0 } }),
    );
    expect(result.report.status).toBe("fail");
    const record = transitionAsset(
      newCandidate(spriteFixture().manifest, result.report),
      { type: "pick" },
    );
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    const approve = transitionAsset(record.value, { type: "approve" });
    expect(approve.ok).toBe(false);
  });
});

describe("counters and kind rules on fixed fixtures", () => {
  const K: Rgb = [255, 0, 255];
  const counters = () =>
    image(6, 6, (x, y) => {
      if (x === 0 || y === 0 || x === 5 || y === 5) {
        return x === 5 && y === 5 ? [253, 2, 255, 255] : [...K, 255];
      }
      if (x === 2 && y === 2) return [...K, 255];
      if (x === 4 && y === 3) return [...B, 100];
      if (x === 2 && y === 4) return [...A, 200];
      return [...A, 255];
    });
  const given = (
    img: ReturnType<typeof counters>,
    overrides: Partial<ConformanceInput> = {},
  ) =>
    small(img.width, img.height, (x, y) => pixelAt(img, x, y), {
      cell: { w: 6, h: 6 },
      background: { type: "key", rgb: K, tolerance: 4 },
      ...overrides,
    });

  it("counts keyed, alpha-snapped and recoloured pixels, and their union, independent of the resize", () => {
    const plain = done(given(counters()));
    expect(plain.metrics).toMatchObject({
      keyedPixels: 20,
      alphaChanged: 2,
      pixelsRecoloured: 1,
      pixelsChanged: 23,
      blendedBlocks: 0,
    });
    // 20 ring pixels + the cut pixel + the opaque-snapped pixel + the enclosed key colour.
    expect(plain.diff.map((d) => `${d.x},${d.y}`)).toContain("2,2");

    const doubled = done(given(upscale(counters(), 2), { scale: 2 }));
    expect(doubled.metrics.resize).toMatchObject({ factor: 2, supplied: true });
    expect(doubled.metrics).toMatchObject({
      keyedPixels: 20,
      alphaChanged: 2,
      pixelsRecoloured: 1,
      pixelsChanged: 23,
    });
    expect(doubled.image.rgba).toEqual(plain.image.rgba);
  });

  it("lets a portrait keep 20 palette colours with interior shading that a sprite must reduce", () => {
    const shaded = image(64, 80, (x, y) =>
      x < 8 || x >= 56 || y < 8 || y >= 72
        ? [...(PALETTE_20[18] as Rgb), 255]
        : [...(PALETTE_20[(x + 3 * y) % 20] as Rgb), 255],
    );
    const portrait = done(
      input({ ...shaded, kind: "portrait", mode: "report-only" }),
    );
    expect(check(portrait, "colour-count")).toMatchObject({ status: "pass" });
    expect(check(portrait, "binary-alpha")).toMatchObject({ status: "pass" });
    expect(portrait.report.status).toBe("pass");
    const sprite = done(
      input({ ...shaded, kind: "sprite", mode: "report-only" }),
    );
    expect(check(sprite, "colour-count")).toMatchObject({ status: "fail" });
    const reduced = done(input({ ...shaded, kind: "sprite", mode: "auto" }));
    expect(reduced.metrics.coloursAfter).toBeLessThanOrEqual(16);
    expect(check(reduced, "colour-count")).toMatchObject({ status: "pass" });
  });
});
