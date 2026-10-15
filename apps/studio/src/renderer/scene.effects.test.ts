import { describe, expect, it } from "bun:test";
import {
  bottomVertex,
  composeScene,
  type SceneEntity,
  spriteOrigin,
} from "@panthea/renderer";
import { canon } from "../../test/canon-kit";

const strike = (
  extra: Partial<Extract<SceneEntity, { kind: "sprite" }>> = {},
) =>
  ({
    kind: "sprite",
    id: "bolt",
    layer: "effect",
    cell: { x: 3, y: 2, z: 0 },
    resolution: canon({ spriteId: "lightning-strike", animation: "full" }),
    ...extra,
  }) as SceneEntity;

describe("an effect in the scene", () => {
  it("is placed like a sprite: its pivot on the bottom vertex of its cell", () => {
    const { instances, refused } = composeScene([strike()]);

    expect(refused).toEqual([]);
    const bolt = instances[0];
    const vertex = bottomVertex({ x: 3, y: 2, z: 0 });
    const origin = spriteOrigin(
      { x: 3, y: 2, z: 0 },
      { w: 1, h: 1 },
      {
        x: 32,
        y: 116,
      },
    );
    if (!vertex.ok || !origin.ok) throw new Error("not placeable");
    expect([bolt?.x, bolt?.y]).toEqual([origin.value.x, origin.value.y]);
    expect([bolt?.w, bolt?.h]).toEqual([64, 128]);
    expect(bolt?.art).toMatchObject({
      source: "canon",
      assetId: "lightning-strike",
    });
  });

  it("moves by a whole-pixel offset from that spot, without changing its depth", () => {
    const plain = composeScene([strike()]).instances[0];
    const moved = composeScene([strike({ offset: { x: -6, y: -75 } })])
      .instances[0];

    expect(moved?.x).toBe((plain?.x ?? 0) - 6);
    expect(moved?.y).toBe((plain?.y ?? 0) - 75);
    expect(moved?.depth).toBe(plain?.depth);
    expect(moved?.z).toBe(plain?.z);
  });

  it("refuses an offset that is not whole pixels, and goes on composing the rest", () => {
    const scene = composeScene([
      strike({ offset: { x: 0.5, y: 0 } }),
      strike({ id: "fine" }),
    ]);

    expect(scene.refused.map((entry) => entry.id)).toEqual(["bolt"]);
    expect(scene.refused[0]?.reason).toBe("non-integer");
    expect(scene.instances.map((instance) => instance.id)).toEqual(["fine"]);
  });

  it("draws over a structure standing at the same depth, and behind an actor in front of it", () => {
    const house = {
      kind: "sprite",
      id: "house",
      layer: "structure",
      cell: { x: 0, y: 0, z: 0 },
      resolution: canon({ spriteId: "greek-house", state: "damaged" }),
    } as const satisfies SceneEntity;
    const front = {
      kind: "sprite",
      id: "mortal",
      layer: "actor",
      cell: { x: 3, y: 3, z: 0 },
      resolution: canon({ spriteId: "zeus-retro" }),
    } as const satisfies SceneEntity;

    const { instances } = composeScene([
      front,
      strike({ cell: { x: 3, y: 2, z: 0 } }),
      house,
    ]);

    expect(instances.map((instance) => instance.id)).toEqual([
      "house",
      "bolt",
      "mortal",
    ]);
  });
});
