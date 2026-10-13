import { describe, expect, it } from "bun:test";
import { DataTexture, type InstancedMesh } from "three";
import { TileMap2D, type TileMapData } from "three-flatland";
import {
  bottomVertex,
  COORD_MAX,
  COORD_MIN,
  DEPTH_CAMERA_Z,
  DEPTH_FAR,
  DEPTH_NEAR,
  DEPTH_Z_MAX,
  DEPTH_Z_MIN,
  DIAMOND_H,
  depthOf,
  depthZ,
  diamondOrigin,
  diamondRow,
  ELEVATION_MAX,
  ELEVATION_MIN,
  ELEVATION_STEP,
  ENTITY_SLOTS,
  FOOTPRINT_MAX,
  LAYERS,
  spriteOrigin,
  TILE_H,
  TILE_W,
} from "./iso";

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

function rasterize(side: number): Map<string, number> {
  const covered = new Map<string, number>();
  for (let x = 0; x < side; x += 1) {
    for (let y = 0; y < side; y += 1) {
      const origin = unwrap(diamondOrigin(cell(x, y)));
      for (let row = 0; row < TILE_H; row += 1) {
        const span = diamondRow(row);
        if (span === null) continue;
        for (let px = span.x0; px < span.x1; px += 1) {
          const key = `${origin.x + px},${origin.y + row}`;
          covered.set(key, (covered.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return covered;
}

describe("tile geometry", () => {
  it("uses the art-guide constants", () => {
    expect([TILE_W, TILE_H, DIAMOND_H, ELEVATION_STEP]).toEqual([
      64, 32, 31, 16,
    ]);
  });

  it("draws the diamond 64x31: widest on row 15, 4px at the vertices, nothing on row 31", () => {
    expect(diamondRow(15)).toEqual({ x0: 0, x1: 64 });
    expect(diamondRow(0)).toEqual({ x0: 30, x1: 34 });
    expect(diamondRow(30)).toEqual({ x0: 30, x1: 34 });
    expect(diamondRow(31)).toBeNull();
    expect(diamondRow(-1)).toBeNull();
    for (let row = 0; row < DIAMOND_H; row += 1) {
      const span = diamondRow(row);
      expect(span).not.toBeNull();
      if (span !== null) {
        expect(span.x1 - span.x0).toBe(4 + 4 * Math.min(row, 30 - row));
      }
    }
  });

  it("abuts adjacent diamonds with no seam row and no overlap", () => {
    const covered = rasterize(6);
    expect([...covered.values()].every((count) => count === 1)).toBe(true);
    for (let y = 20; y <= 70; y += 1) {
      const reach = Math.min(2 * y, 60) - 4;
      for (let x = -reach; x < reach; x += 1) {
        expect(covered.get(`${x},${y}`)).toBe(1);
      }
    }
  });

  it("locks the (0,0) and (1,0) diamonds edge to edge on every shared row", () => {
    const a = unwrap(diamondOrigin(cell(0, 0)));
    const b = unwrap(diamondOrigin(cell(1, 0)));
    expect(b).toEqual({ x: a.x + TILE_W / 2, y: a.y + TILE_H / 2 });
    for (let row = TILE_H / 2; row < DIAMOND_H; row += 1) {
      const left = diamondRow(row);
      const right = diamondRow(row - TILE_H / 2);
      expect(left).not.toBeNull();
      expect(right).not.toBeNull();
      if (left !== null && right !== null) {
        expect(a.x + left.x1).toBe(b.x + right.x0);
      }
    }
  });

  it("lifts exactly 16 px per elevation step on screen only in y", () => {
    const ground = unwrap(bottomVertex(cell(3, 2, 0), ONE));
    const up1 = unwrap(bottomVertex(cell(3, 2, 1), ONE));
    const up3 = unwrap(bottomVertex(cell(3, 2, 3), ONE));
    expect(up1).toEqual({ x: ground.x, y: ground.y - 16 });
    expect(up3).toEqual({ x: ground.x, y: ground.y - 48 });
  });

  it("puts the bottom vertex of cell (0,0) on x=0 at the last diamond row's lower edge", () => {
    expect(unwrap(bottomVertex(cell(0, 0), ONE))).toEqual({ x: 0, y: 31 });
    expect(unwrap(diamondOrigin(cell(0, 0)))).toEqual({ x: -32, y: 0 });
  });
});

describe("depth order", () => {
  it("is x + y - z of the footprint's bottom-vertex cell", () => {
    expect(unwrap(depthOf(cell(3, 4, 0), ONE))).toBe(7);
    expect(unwrap(depthOf(cell(3, 4, 0), { w: 2, h: 2 }))).toBe(9);
    expect(unwrap(depthOf(cell(3, 4, 0), { w: 3, h: 1 }))).toBe(9);
  });

  it("enters elevation as -z: one step up sorts before ground at the same x + y", () => {
    expect(unwrap(depthOf(cell(3, 3, 1), ONE))).toBe(5);
    expect(unwrap(depthOf(cell(3, 3, 0), ONE))).toBe(6);
    const up = depthZ({ depth: 5, layer: "actor", order: 0 });
    const ground = depthZ({ depth: 6, layer: "actor", order: 0 });
    expect(unwrap(up)).toBeLessThan(unwrap(ground));
  });

  it("breaks depth ties by layer in art-guide order, then by entity order", () => {
    const zs = LAYERS.map((layer) =>
      unwrap(depthZ({ depth: 4, layer, order: 0 })),
    );
    expect(LAYERS).toEqual([
      "ground",
      "decal",
      "structure",
      "actor",
      "effect",
      "speech",
    ]);
    expect([...zs].sort((a, b) => a - b)).toEqual(zs);
    expect(new Set(zs).size).toBe(LAYERS.length);
    const first = unwrap(depthZ({ depth: 4, layer: "actor", order: 0 }));
    const second = unwrap(depthZ({ depth: 4, layer: "actor", order: 1 }));
    expect(first).toBeLessThan(second);
  });

  it("is strictly monotonic in (depth, layer, order) and stays inside the camera range", () => {
    const depths = [
      unwrap(depthOf(cell(COORD_MIN, COORD_MIN, ELEVATION_MAX), ONE)),
      -3,
      0,
      1,
      2,
      40,
      unwrap(depthOf(cell(COORD_MAX, COORD_MAX, ELEVATION_MIN), ONE)),
    ];
    let previous = Number.NEGATIVE_INFINITY;
    for (const depth of depths) {
      for (const layer of LAYERS) {
        for (const order of [0, 1, ENTITY_SLOTS - 1]) {
          const z = unwrap(depthZ({ depth, layer, order }));
          expect(z).toBeGreaterThan(previous);
          expect(Number.isInteger(z)).toBe(true);
          previous = z;
        }
      }
    }
    const lowest = unwrap(
      depthZ({ depth: depths[0] as number, layer: "ground", order: 0 }),
    );
    const highest = unwrap(
      depthZ({
        depth: depths[depths.length - 1] as number,
        layer: "speech",
        order: ENTITY_SLOTS - 1,
      }),
    );
    expect(lowest).toBe(DEPTH_Z_MIN);
    expect(highest).toBe(DEPTH_Z_MAX);
    expect(DEPTH_Z_MAX).toBeLessThan(2 ** 24);
  });

  it("keeps every drawable inside the orthographic near/far from the camera plane", () => {
    expect(DEPTH_CAMERA_Z - DEPTH_Z_MAX).toBeGreaterThanOrEqual(DEPTH_NEAR);
    expect(DEPTH_CAMERA_Z - DEPTH_Z_MIN).toBeLessThanOrEqual(DEPTH_FAR);
    expect(DEPTH_NEAR).toBeGreaterThan(0);
  });
});

describe("range refusal", () => {
  it("accepts the range boundaries", () => {
    expect(
      bottomVertex(cell(COORD_MIN, COORD_MIN, ELEVATION_MIN), ONE).ok,
    ).toBe(true);
    expect(
      bottomVertex(cell(COORD_MAX, COORD_MAX, ELEVATION_MAX), ONE).ok,
    ).toBe(true);
    expect(
      bottomVertex(cell(COORD_MAX - FOOTPRINT_MAX + 1, 0), {
        w: FOOTPRINT_MAX,
        h: 1,
      }).ok,
    ).toBe(true);
  });

  it.each([
    ["x past max", cell(COORD_MAX + 1, 0), ONE],
    ["y below min", cell(0, COORD_MIN - 1), ONE],
    ["z above max", cell(0, 0, ELEVATION_MAX + 1), ONE],
    ["z below min", cell(0, 0, ELEVATION_MIN - 1), ONE],
    ["footprint spilling past max", cell(COORD_MAX, 0), { w: 2, h: 1 }],
  ])(
    "refuses %s with a reason instead of clamping",
    (_name, target, footprint) => {
      const results = [
        bottomVertex(target, footprint),
        depthOf(target, footprint),
        spriteOrigin(target, footprint, { x: 0, y: 0 }),
      ];
      if (footprint === ONE) results.push(diamondOrigin(target));
      for (const result of results) {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe("out-of-range");
          expect(result.detail.length).toBeGreaterThan(0);
        }
      }
    },
  );

  it.each([
    ["fractional x", cell(0.5, 0)],
    ["NaN y", cell(0, Number.NaN)],
    ["infinite z", cell(0, 0, Number.POSITIVE_INFINITY)],
  ])("refuses %s as non-integer", (_name, target) => {
    const result = bottomVertex(target, ONE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("non-integer");
  });

  it.each([
    ["zero width", { w: 0, h: 1 }],
    ["oversized height", { w: 1, h: FOOTPRINT_MAX + 1 }],
    ["fractional width", { w: 1.5, h: 1 }],
  ])("refuses a footprint with %s", (_name, footprint) => {
    const result = bottomVertex(cell(0, 0), footprint);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad-footprint");
  });

  it("refuses an entity order outside the slot range", () => {
    for (const order of [-1, ENTITY_SLOTS, 0.5]) {
      const result = depthZ({ depth: 0, layer: "actor", order });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("bad-order");
    }
  });

  it("refuses a depth outside the supported range", () => {
    for (const depth of [-1000, 1000]) {
      const result = depthZ({ depth, layer: "actor", order: 0 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("out-of-range");
    }
  });
});

describe("TileMap2D (three-flatland 0.1.0-alpha.10)", () => {
  function isometricMap(): TileMapData {
    return {
      width: 2,
      height: 2,
      tileWidth: TILE_W,
      tileHeight: TILE_H,
      orientation: "isometric",
      renderOrder: "right-down",
      infinite: false,
      tilesets: [
        {
          name: "probe",
          firstGid: 1,
          tileWidth: TILE_W,
          tileHeight: TILE_H,
          imageWidth: TILE_W * 2,
          imageHeight: TILE_H,
          columns: 2,
          tileCount: 2,
          tiles: new Map(),
          texture: new DataTexture(
            new Uint8Array(TILE_W * 2 * TILE_H * 4),
            TILE_W * 2,
            TILE_H,
          ),
        },
      ],
      tileLayers: [
        {
          name: "ground",
          id: 1,
          width: 2,
          height: 2,
          data: new Uint32Array([1, 1, 1, 1]),
        },
      ],
      objectLayers: [],
    };
  }

  it("places tiles orthogonally even when orientation is isometric, so the studio projects itself", () => {
    const map = new TileMap2D({ data: isometricMap() });
    expect(map.data?.orientation).toBe("isometric");
    const meshes: InstancedMesh[] = [];
    map.traverse((child) => {
      if ((child as InstancedMesh).isInstancedMesh === true) {
        meshes.push(child as InstancedMesh);
      }
    });
    expect(meshes).toHaveLength(1);
    const mesh = meshes[0] as InstancedMesh;
    const centres = Array.from({ length: mesh.count }, (_, i) => ({
      x: mesh.instanceMatrix.array[i * 16 + 12] as number,
      y: mesh.instanceMatrix.array[i * 16 + 13] as number,
    }));
    // Tiled order is row-major, y down; world y is up. An isometric layout
    // would stagger x by half a tile between rows and y by half a tile
    // between columns.
    expect(centres).toEqual([
      { x: 32, y: 48 },
      { x: 96, y: 48 },
      { x: 32, y: 16 },
      { x: 96, y: 16 },
    ]);
    const east = map.tileToWorld(1, 0);
    const origin = map.tileToWorld(0, 0);
    expect({ dx: east.x - origin.x, dy: east.y - origin.y }).toEqual({
      dx: TILE_W,
      dy: 0,
    });
    map.dispose();
  });

  it("differs from the studio projection, which staggers a half tile per step", () => {
    const at = (x: number, y: number) => unwrap(bottomVertex(cell(x, y), ONE));
    expect({
      dx: at(1, 0).x - at(0, 0).x,
      dy: at(1, 0).y - at(0, 0).y,
    }).toEqual({
      dx: TILE_W / 2,
      dy: TILE_H / 2,
    });
    expect({
      dx: at(0, 1).x - at(0, 0).x,
      dy: at(0, 1).y - at(0, 0).y,
    }).toEqual({
      dx: -TILE_W / 2,
      dy: TILE_H / 2,
    });
  });
});
