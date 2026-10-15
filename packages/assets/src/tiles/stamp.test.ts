// The dual-grid stamper. The field gate is the spec: a grid assembled from atlas cells is the grid
// stamped directly. Around it: the tie rule, purity, diagonals, band and overhangs, the golden atlas.

import { describe, expect, it } from "bun:test";
import { TILE_CELL, tileAtlasRect } from "@panthea/contracts";
import {
  groundProfile,
  retroPalette,
  syntheticPatches,
} from "../../test/render/ground-patches";
import { type RgbaImage, tileDiamondRow } from "../conformance";
import { sequence } from "../effects/random";
import { sha256Hex } from "../hash";
import { stampParamsOf } from "./params";
import {
  assembleGrid,
  isOver,
  type StampParams,
  stampAtlas,
  stampGrid,
} from "./stamp";

const profile = groundProfile();
const palette = retroPalette();
const patches = syntheticPatches(profile, palette);
const given = (() => {
  const made = stampParamsOf(profile, palette);
  if (!made.ok) throw new Error(made.message);
  return made.params;
})();
// A band colour no patch holds, so band pixels can be told from the flagstone's own darkest shade.
const MARKER = [1, 2, 3] as const;
const params: StampParams = { ...given, bandColour: MARKER };
const N = params.period;

const stamp = (p: StampParams, from = patches) => {
  const made = stampAtlas(p, from);
  if (!made.ok) throw new Error(made.message);
  return made.image;
};
const atlas = stamp(params);

const key = (rgba: Uint8Array, at: number) =>
  `${rgba[at]},${rgba[at + 1]},${rgba[at + 2]}`;
const colours = (image: RgbaImage) => {
  const set = new Set<string>();
  for (let at = 0; at < image.rgba.length; at += 4)
    if (image.rgba[at + 3]) set.add(key(image.rgba, at));
  return set;
};
const OLIVE = colours(patches.base);
const STONE = colours(patches.over);

/** 0 base, 1 over (the marker band counts as over), -1 empty. */
const terrainAt = (rgba: Uint8Array, at: number): number => {
  if (!rgba[at + 3]) return -1;
  const k = key(rgba, at);
  if (k === MARKER.join(",")) return 1;
  if (OLIVE.has(k)) return 0;
  if (STONE.has(k)) return 1;
  throw new Error(`a colour of neither patch: ${k}`);
};

function cellOf(image: RgbaImage, mask: number, offset: number): Uint8Array {
  const rect = tileAtlasRect(mask, offset, N);
  const out = new Uint8Array(rect.w * rect.h * 4);
  for (let row = 0; row < rect.h; row += 1)
    out.set(
      image.rgba.subarray(
        ((rect.y + row) * image.width + rect.x) * 4,
        ((rect.y + row) * image.width + rect.x + rect.w) * 4,
      ),
      row * rect.w * 4,
    );
  return out;
}
const terrainGrid = (cell: Uint8Array) =>
  Array.from({ length: TILE_CELL.h }, (_, y) =>
    Array.from({ length: TILE_CELL.w }, (_, x) =>
      terrainAt(cell, (y * TILE_CELL.w + x) * 4),
    ),
  );

describe("the atlas", () => {
  it("is 16 columns by N squared rows of 64x32 cells, every cell a full diamond and nothing else", () => {
    expect([atlas.width, atlas.height]).toEqual([1024, 32 * N * N]);
    let diamond = 0;
    for (let row = 0; row < 32; row += 1) {
      const span = tileDiamondRow(row);
      if (span !== null) diamond += span.x1 - span.x0;
    }
    let cells = 0;
    for (let offset = 0; offset < N * N; offset += 1)
      for (let mask = 0; mask < 16; mask += 1) {
        const grid = terrainGrid(cellOf(atlas, mask, offset));
        let opaque = 0;
        for (const [y, row] of grid.entries())
          for (const [x, value] of row.entries()) {
            const span = tileDiamondRow(y);
            const inside = span !== null && x >= span.x0 && x < span.x1;
            expect(value !== -1, `(${mask},${offset}) ${x},${y}`).toBe(inside);
            if (value !== -1) opaque += 1;
          }
        expect(opaque).toBe(diamond);
        cells += 1;
      }
    expect(cells).toBe(256);
    for (let at = 3; at < atlas.rgba.length; at += 4)
      expect([0, 255]).toContain(atlas.rgba[at] as number);
  });

  it("pins the golden atlas of the synthetic patch pair, with every (mask, offset) cell present", () => {
    // Fixed parameters, not the profile's, so a tuned profile does not move the golden.
    const golden = stamp({
      period: 4,
      noiseSeed: 11,
      wavelengthTiles: 2,
      amplitude: 0.12,
      edgeBandPx: 2,
      overhangs: 6,
      bandColour: [0x56, 0x65, 0x5d],
    });
    const hash = sha256Hex(
      new Uint8Array([
        ...new TextEncoder().encode(`${golden.width}x${golden.height}:`),
        ...golden.rgba,
      ]),
    );
    for (let offset = 0; offset < 16; offset += 1)
      for (let mask = 0; mask < 16; mask += 1)
        expect(
          cellOf(golden, mask, offset).some(
            (byte, at) => at % 4 === 3 && byte === 255,
          ),
          `(${mask},${offset}) is present`,
        ).toBe(true);
    expect(String(hash)).toBe(GOLDEN);
  });

  it("is deterministic: the same patches and parameters give the same bytes", () => {
    expect(
      Buffer.from(stamp(params).rgba).equals(Buffer.from(atlas.rgba)),
    ).toBe(true);
  });

  it("moves with the noise seed, so the seed is read", () => {
    const other = stamp({ ...params, noiseSeed: params.noiseSeed + 1 });
    expect(Buffer.from(other.rgba).equals(Buffer.from(atlas.rgba))).toBe(false);
  });
});

describe("the field gate", () => {
  const random = sequence(12345);
  const grid = Array.from({ length: 12 }, () =>
    Array.from({ length: 12 }, () => (random() < 0.45 ? 1 : 0)),
  );

  it("a 12x12 grid assembled from atlas cells is byte-identical to the grid stamped directly, band and overhangs included", () => {
    expect(grid.flat().includes(0) && grid.flat().includes(1)).toBe(true);
    const direct = stampGrid(params, patches, grid);
    if (!direct.ok) throw new Error(direct.message);
    const assembled = assembleGrid(atlas, N, grid);
    expect([assembled.width, assembled.height]).toEqual([
      direct.image.width,
      direct.image.height,
    ]);
    expect(
      Buffer.from(assembled.rgba).equals(Buffer.from(direct.image.rgba)),
    ).toBe(true);
    // Both decorations are in this grid, so the gate covers them.
    const seen = colours(assembled);
    expect(seen.has(MARKER.join(","))).toBe(true);
  });

  it("holds for the committed parameters and a different grid too", () => {
    const other = Array.from({ length: 9 }, (_, y) =>
      Array.from({ length: 13 }, (_, x) => ((x * 7 + y * 3) % 5 < 2 ? 1 : 0)),
    );
    const full = stamp(given);
    const direct = stampGrid(given, patches, other);
    if (!direct.ok) throw new Error(direct.message);
    expect(
      Buffer.from(assembleGrid(full, N, other).rgba).equals(
        Buffer.from(direct.image.rgba),
      ),
    ).toBe(true);
  });
});

describe("the threshold", () => {
  it("a field value of exactly 1/2 is base, and anything above it is over", () => {
    expect(isOver(0.5)).toBe(false);
    expect(isOver(0.5 + 2 ** -40)).toBe(true);
    expect(isOver(0.49)).toBe(false);
  });
});

describe("purity", () => {
  it("mask 0 is pure base and mask 15 pure over, at every offset", () => {
    for (let offset = 0; offset < N * N; offset += 1) {
      for (const [mask, want] of [
        [0, 0],
        [15, 1],
      ] as const) {
        const cell = cellOf(atlas, mask, offset);
        for (let at = 0; at < cell.length; at += 4) {
          const terrain = terrainAt(cell, at);
          if (terrain !== -1) expect(terrain).toBe(want);
        }
        const rest = colours({ width: 64, height: 32, rgba: cell });
        expect(rest.has(MARKER.join(","))).toBe(false);
      }
    }
  });

  it("every cell's four diamond vertices take their corner's terrain", () => {
    // Top, right, bottom and left vertex pixels, for the corners N, E, S and W.
    const vertices: [number, [number, number][]][] = [
      [
        1,
        [
          [31, 0],
          [32, 0],
        ],
      ],
      [2, [[63, 15]]],
      [
        4,
        [
          [31, 30],
          [32, 30],
        ],
      ],
      [8, [[0, 15]]],
    ];
    for (let offset = 0; offset < N * N; offset += 1)
      for (let mask = 0; mask < 16; mask += 1) {
        const grid = terrainGrid(cellOf(atlas, mask, offset));
        for (const [bit, points] of vertices)
          for (const [x, y] of points)
            expect(
              grid[y]?.[x],
              `mask ${mask} offset ${offset} corner ${bit} at ${x},${y}`,
            ).toBe((mask & bit) === 0 ? 0 : 1);
      }
  });
});

const FOUR = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const EIGHT = [...FOUR, [1, 1], [-1, -1], [1, -1], [-1, 1]] as const;

/** Connected components of equal terrain inside a cell: 4-connected unless `around` says 8. */
function components(
  grid: number[][],
  around: readonly (readonly [number, number])[] = FOUR,
): { terrain: number; pixels: [number, number][] }[] {
  const seen = grid.map((row) => row.map(() => false));
  const found: { terrain: number; pixels: [number, number][] }[] = [];
  for (const [y, row] of grid.entries())
    for (const [x, terrain] of row.entries()) {
      if (terrain === -1 || seen[y]?.[x]) continue;
      const pixels: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];
      (seen[y] as boolean[])[x] = true;
      while (stack.length > 0) {
        const [px, py] = stack.pop() as [number, number];
        pixels.push([px, py]);
        for (const [dx, dy] of around) {
          const nx = px + dx;
          const ny = py + dy;
          if (grid[ny]?.[nx] === terrain && !seen[ny]?.[nx]) {
            (seen[ny] as boolean[])[nx] = true;
            stack.push([nx, ny]);
          }
        }
      }
      found.push({ terrain, pixels });
    }
  return found;
}

describe("diagonals", () => {
  /** Whether `a` and `b` are joined by pixels of `terrain`, after eroding that terrain by one pixel. */
  function bridged(
    grid: number[][],
    terrain: number,
    a: [number, number],
    b: [number, number],
  ) {
    const kept = grid.map((row, y) =>
      row.map((value, x) =>
        value !== terrain
          ? -1
          : [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ].every(([dx, dy]) => {
                const near = grid[y + (dy as number)]?.[x + (dx as number)];
                return near === undefined || near === -1 || near === terrain;
              })
            ? terrain
            : -1,
      ),
    );
    const start = a;
    const reach = components(kept).find((c) =>
      c.pixels.some(([x, y]) => x === start[0] && y === start[1]),
    );
    return reach?.pixels.some(([x, y]) => x === b[0] && y === b[1]) ?? false;
  }

  for (const [mask, name] of [
    [5, "N and S over"],
    [10, "E and W over"],
  ] as const) {
    it(`mask ${mask} (${name}) keeps a connected bridge at every offset, three pixels wide, with no single-pixel island`, () => {
      const top: [number, number] = [31, 1];
      const bottom: [number, number] = [31, 29];
      const left: [number, number] = [1, 15];
      const right: [number, number] = [62, 15];
      const overPair = mask === 5 ? [top, bottom] : [left, right];
      const basePair = mask === 5 ? [left, right] : [top, bottom];
      let bridgedOver = 0;
      let bridgedBase = 0;
      for (let offset = 0; offset < N * N; offset += 1) {
        const grid = terrainGrid(cellOf(atlas, mask, offset));
        const over = bridged(
          grid,
          1,
          overPair[0] as [number, number],
          overPair[1] as [number, number],
        );
        const base = bridged(
          grid,
          0,
          basePair[0] as [number, number],
          basePair[1] as [number, number],
        );
        expect(over || base, `offset ${offset} has a bridge`).toBe(true);
        expect(over && base, `offset ${offset} bridges both ways`).toBe(false);
        if (over) bridgedOver += 1;
        else bridgedBase += 1;
        const islands = components(grid, EIGHT).filter(
          (c) => c.pixels.length === 1,
        );
        expect(islands, `offset ${offset} islands`).toEqual([]);
      }
      // The tile's hash chooses which terrain bridges; both happen across the offsets.
      expect(bridgedOver).toBeGreaterThan(0);
      expect(bridgedBase).toBeGreaterThan(0);
    });
  }

  it("the field has no single-pixel island of either terrain, in any cell or in a 12x12 grid", () => {
    for (let offset = 0; offset < N * N; offset += 1)
      for (let mask = 0; mask < 16; mask += 1)
        expect(
          components(terrainGrid(cellOf(atlas, mask, offset)), EIGHT).filter(
            (c) => c.pixels.length === 1,
          ),
          `mask ${mask} offset ${offset}`,
        ).toEqual([]);
  });
});

describe("a grid has no flecks", () => {
  it("in grids of every density, no run of one terrain is smaller than 12 pixels, so the edge neither pinches nor speckles", () => {
    const small: number[] = [];
    let components8 = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const random = sequence(seed);
      const density = 0.2 + (seed % 6) * 0.12;
      const grid = Array.from({ length: 12 }, () =>
        Array.from({ length: 12 }, () => (random() < density ? 1 : 0)),
      );
      const image = assembleGrid(atlas, N, grid);
      const terrain = Array.from({ length: image.height }, (_, y) =>
        Array.from({ length: image.width }, (_, x) =>
          terrainAt(image.rgba, (y * image.width + x) * 4),
        ),
      );
      for (const part of components(terrain, EIGHT)) {
        components8 += 1;
        if (part.pixels.length < 12) small.push(part.pixels.length);
      }
    }
    expect(components8).toBeGreaterThan(100);
    expect(small).toEqual([]);
  });
});

describe("the edge band and the overhangs", () => {
  const bandless = stamp({ ...params, edgeBandPx: 0, overhangs: 0 });
  const withoutHangs = stamp({ ...params, overhangs: 0 });

  it("draws a band only on the over side of a boundary, broken, a few pixels deep", () => {
    let band = 0;
    let bandOnBoundary = 0;
    let boundary = 0;
    for (let offset = 0; offset < N * N; offset += 1)
      for (let mask = 1; mask < 15; mask += 1) {
        const cell = cellOf(atlas, mask, offset);
        const plain = cellOf(bandless, mask, offset);
        const grid = terrainGrid(plain);
        for (let y = 0; y < 32; y += 1)
          for (let x = 0; x < 64; x += 1) {
            const at = (y * 64 + x) * 4;
            const marked =
              key(cell, at) === MARKER.join(",") && cell[at + 3] !== 0;
            if (marked) {
              band += 1;
              expect(grid[y]?.[x], `band on base at ${x},${y}`).toBe(1);
            }
            // An over pixel next to a base pixel is on the boundary.
            const touches = FOUR.some(
              ([dx, dy]) => grid[y + dy]?.[x + dx] === 0,
            );
            if (grid[y]?.[x] === 1 && touches) {
              boundary += 1;
              if (marked) bandOnBoundary += 1;
            }
          }
      }
    expect(band).toBeGreaterThan(0);
    // Broken, not a rim: some boundary pixels carry it and some do not.
    expect(bandOnBoundary / boundary).toBeGreaterThan(0.2);
    expect(bandOnBoundary / boundary).toBeLessThan(0.9);
  });

  it("the band is the profile's flagstone ramp darkest shade", () => {
    expect([...given.bandColour]).toEqual([0x56, 0x65, 0x5d]);
  });

  it("places overhangs of grass on the over side, next to the boundary, from the seeded hash", () => {
    let hangs = 0;
    for (let offset = 0; offset < N * N; offset += 1)
      for (let mask = 1; mask < 15; mask += 1) {
        const a = cellOf(atlas, mask, offset);
        const b = cellOf(withoutHangs, mask, offset);
        for (let at = 0; at < a.length; at += 4)
          if (
            a[at] !== b[at] ||
            a[at + 1] !== b[at + 1] ||
            a[at + 2] !== b[at + 2]
          ) {
            hangs += 1;
            expect(terrainAt(b, at), "an overhang replaces the over side").toBe(
              1,
            );
            expect(OLIVE.has(key(a, at)), "an overhang is grass").toBe(true);
          }
      }
    expect(hangs).toBeGreaterThan(0);
  });
});

describe("refusals", () => {
  it("refuses a patch that is not the period's size", () => {
    const small = {
      width: 100,
      height: 100,
      rgba: new Uint8Array(100 * 100 * 4),
    };
    const made = stampAtlas(params, { base: small, over: patches.over });
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.message).toMatch(/base patch is 100x100/);
  });

  it("refuses a noise wavelength that does not divide the period", () => {
    const made = stampAtlas({ ...params, wavelengthTiles: 3 }, patches);
    expect(made.ok).toBe(false);
  });
});

const GOLDEN =
  "1b6e13155344cbf52f2c334b430fd9feeb88a99099a62da302614d034a5e8840";
