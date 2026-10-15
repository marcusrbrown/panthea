// A ground tile in the shared scene: placed at its lattice point, always drawn first, and cut from the
// atlas by (mask, offset). Real resolver output, not hand-built resolutions.

import { describe, expect, it } from "bun:test";
import { resolveAsset } from "@panthea/assets";
import { tileMaskAt, tileOffsetAt } from "@panthea/assets/browser";
import { spriteFixture } from "@panthea/assets/fixtures";
import { tileFixture } from "../../assets/test/fixtures/tile";
import { COORD_MAX, DEPTH_MIN, diamondOrigin, latticeOrigin } from "./iso";
import { composeScene, type Instance, type SceneEntity } from "./scene";

const tile = tileFixture();
const god = spriteFixture("placeholder-zeus");
const snapshot = {
  entries: new Map(
    [tile, god].map((asset) => [
      asset.manifest.id,
      {
        assetId: asset.manifest.id,
        revision: asset.manifest.atlas.blob,
        manifest: asset.manifest,
      },
    ]),
  ),
};

function tileAt(
  x: number,
  y: number,
  mask = 0,
  offset = 0,
  id = `t-${x}-${y}`,
): SceneEntity {
  const resolution = resolveAsset(snapshot, {
    spriteId: "grass-flagstone",
    tile: { mask, offset },
  });
  if (resolution.source !== "canon" || resolution.kind !== "tile")
    throw new Error("the fixture did not resolve to a canon tile");
  return { kind: "tile", id, point: { x, y }, resolution };
}

function actorAt(x: number, y: number, id = "actor"): SceneEntity {
  const resolution = resolveAsset(snapshot, { spriteId: "placeholder-zeus" });
  if (resolution.source !== "canon") throw new Error("no sprite");
  return {
    kind: "sprite",
    id,
    layer: "actor",
    cell: { x, y, z: 0 },
    resolution,
  };
}

const only = (entities: readonly SceneEntity[]): Instance[] => {
  const composed = composeScene(entities);
  expect(composed.refused).toEqual([]);
  return [...composed.instances];
};

describe("a ground tile", () => {
  it("is placed at its lattice point's origin, 64x32, with the canon atlas cell it was resolved to", () => {
    const [instance] = only([tileAt(3, 1, 6, 9)]);
    expect(instance).toMatchObject({
      id: "t-3-1",
      layer: "ground",
      cell: { x: 3, y: 1, z: 0 },
      w: 64,
      h: 32,
      depth: DEPTH_MIN,
    });
    const origin = latticeOrigin(3, 1);
    if (!origin.ok) throw new Error("no origin");
    expect({ x: instance?.x, y: instance?.y }).toEqual(origin.value);
    expect(instance?.art).toMatchObject({
      source: "canon",
      assetId: "grass-flagstone",
    });
    if (instance?.art.source !== "canon") throw new Error("not canon art");
    // The frame is the atlas cell at index offset * 16 + mask.
    const index = 9 * 16 + 6;
    expect(instance.art.frames.map((f) => f.rect)).toEqual([
      { x: (index % 16) * 64, y: Math.floor(index / 16) * 32, w: 64, h: 32 },
    ]);
  });

  it("four tiles at the lattice points around one grid cell meet exactly at that cell's centre", () => {
    for (const [gx, gy] of [
      [0, 0],
      [3, 2],
      [2, 3],
      [5, 5],
      [-2, 1],
    ] as const) {
      const box = diamondOrigin({ x: gx, y: gy, z: 0 });
      if (!box.ok) throw new Error("no origin");
      // The cell's centre, in pixel-edge coordinates.
      const centre = { x: box.value.x + 32, y: box.value.y + 16 };
      const placed = new Map(
        only([
          tileAt(gx, gy), // the cell is its south corner
          tileAt(gx + 1, gy), // west
          tileAt(gx, gy + 1), // east
          tileAt(gx + 1, gy + 1), // north
        ]).map((i) => [`${i.cell.x - gx},${i.cell.y - gy}`, i]),
      );
      const at = (key: string) => placed.get(key) as Instance;
      // The vertex each tile shows the cell: south tile's bottom, west tile's east... measured on
      // the box edges: top (x + 32, y), right (x + 64, y + 16), bottom (x + 32, y + 32), left (x, y + 16).
      const south = at("0,0");
      const west = at("1,0");
      const east = at("0,1");
      const north = at("1,1");
      expect(
        { x: south.x + 32, y: south.y + 32 },
        "south tile, bottom",
      ).toEqual(centre);
      expect({ x: north.x + 32, y: north.y }, "north tile, top").toEqual(
        centre,
      );
      expect({ x: west.x, y: west.y + 16 }, "west tile, left").toEqual(centre);
      expect({ x: east.x + 64, y: east.y + 16 }, "east tile, right").toEqual(
        centre,
      );
    }
  });

  it("sorts below every actor: the tile at (0, 1) is under an actor at (0, 0), and every tile shares one depth", () => {
    const composed = only([
      actorAt(0, 0),
      tileAt(0, 1),
      tileAt(7, 7),
      tileAt(-3, 4),
    ]);
    const ids = composed.map((i) => i.id);
    expect(ids.indexOf("t-0-1")).toBeLessThan(ids.indexOf("actor"));
    expect(ids.indexOf("t-7-7")).toBeLessThan(ids.indexOf("actor"));
    expect(ids.indexOf("t-3-4".replace("t-3", "t--3"))).toBeLessThan(
      ids.indexOf("actor"),
    );
    for (const instance of composed.filter((i) => i.layer === "ground"))
      expect(instance.depth).toBe(DEPTH_MIN);
    const tileZ = Math.max(
      ...composed.filter((i) => i.layer === "ground").map((i) => i.z),
    );
    expect(tileZ).toBeLessThan(composed.find((i) => i.id === "actor")?.z ?? 0);
  });

  it("an 8x8 grid draws 9x9 tiles, each in its own slot at the one ground depth, in a stable order", () => {
    const grid = Array.from({ length: 8 }, (_, y) =>
      Array.from({ length: 8 }, (_, x) => ((x + y) % 3 === 0 ? 1 : 0)),
    );
    const entities: SceneEntity[] = [];
    for (let y = 0; y <= 8; y += 1)
      for (let x = 0; x <= 8; x += 1)
        entities.push(
          tileAt(x, y, tileMaskAt(grid, x, y), tileOffsetAt(x, y, 4)),
        );
    const composed = composeScene(entities);
    expect(entities).toHaveLength(81);
    expect(composed.refused).toEqual([]);
    expect(composed.instances).toHaveLength(81);
    expect(new Set(composed.instances.map((i) => i.z)).size).toBe(81);
    const reversed = composeScene([...entities].reverse());
    expect(reversed.instances.map((i) => i.id)).toEqual(
      composed.instances.map((i) => i.id),
    );
  });

  it("refuses a lattice point outside the supported coordinates, naming the tile, and still composes the rest", () => {
    const composed = composeScene([tileAt(COORD_MAX + 1, 0), tileAt(1, 1)]);
    expect(composed.instances.map((i) => i.id)).toEqual(["t-1-1"]);
    expect(composed.refused).toMatchObject([
      { id: `t-${COORD_MAX + 1}-0`, reason: "out-of-range" },
    ]);
    expect(composeScene([tileAt(0.5, 0)]).refused).toMatchObject([
      { reason: "non-integer" },
    ]);
  });

  it("refuses a resolution that is not a tile, and a placeholder, as not placeable", () => {
    const sprite = resolveAsset(snapshot, { spriteId: "placeholder-zeus" });
    if (sprite.source !== "canon") throw new Error("no sprite");
    expect(
      composeScene([
        {
          kind: "tile",
          id: "wrong",
          point: { x: 0, y: 0 },
          resolution: sprite,
        },
      ]).refused,
    ).toMatchObject([{ id: "wrong", reason: "not-placeable" }]);
    const placeholder = resolveAsset(snapshot, { spriteId: "nowhere" });
    if (placeholder.source !== "placeholder") throw new Error("no placeholder");
    expect(
      composeScene([
        {
          kind: "tile",
          id: "missing",
          point: { x: 0, y: 0 },
          resolution: {
            source: "placeholder",
            reason: placeholder.reason,
            uri: placeholder.uri,
            placeholder: {
              width: placeholder.placeholder.width,
              height: placeholder.placeholder.height,
            },
          },
        },
      ]).refused,
    ).toMatchObject([{ id: "missing", reason: "not-placeable" }]);
  });
});
