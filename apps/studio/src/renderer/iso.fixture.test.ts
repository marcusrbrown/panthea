import { describe, expect, it } from "bun:test";
import { spriteFixture } from "@panthea/assets/fixtures";
import {
  bottomVertex,
  DIAMOND_H,
  diamondOrigin,
  spriteOrigin,
  TILE_W,
} from "@panthea/renderer";

function unwrap<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly reason: string; readonly detail: string },
): T {
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  return result.value;
}

const cell = (x: number, y: number, z = 0) => ({ x, y, z });
const ONE = { w: 1, h: 1 };

describe("pivot placement", () => {
  const { manifest } = spriteFixture();

  it("lands the fixture idle-south pivot (32,80) on the tile's bottom vertex", () => {
    expect(manifest.pivot).toEqual({ x: 32, y: 80 });
    const target = cell(2, 3);
    const vertex = unwrap(bottomVertex(target, manifest.footprint));
    const origin = unwrap(
      spriteOrigin(target, manifest.footprint, manifest.pivot),
    );
    expect(origin.x + manifest.pivot.x).toBe(vertex.x);
    expect(origin.y + manifest.pivot.y).toBe(vertex.y);
    expect(origin).toEqual({ x: -64, y: 31 });
  });

  it("derives sprite offset and diamond from one grid: feet on the last diamond row, centred on the tile", () => {
    const target = cell(2, 3);
    const box = unwrap(diamondOrigin(target));
    const origin = unwrap(
      spriteOrigin(target, manifest.footprint, manifest.pivot),
    );
    const lastSpriteRow = origin.y + manifest.cell.h - 1;
    expect(lastSpriteRow).toBe(box.y + DIAMOND_H - 1);
    expect(origin.x + manifest.pivot.x).toBe(box.x + TILE_W / 2);
  });

  it("anchors a multi-tile footprint on the bottom vertex of its bottom cell", () => {
    const big = { w: 2, h: 2 };
    const vertex = unwrap(bottomVertex(cell(4, 4), big));
    expect(vertex).toEqual(unwrap(bottomVertex(cell(5, 5), ONE)));
  });
});
