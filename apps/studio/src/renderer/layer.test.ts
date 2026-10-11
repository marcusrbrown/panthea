import { describe, expect, it } from "bun:test";
import { type RegistrySnapshot, resolveAsset } from "@panthea/assets";
import { spriteFixture } from "@panthea/assets/fixtures";
import {
  type AtlasSpec,
  composeScene,
  createSceneLayer,
  diamondImage,
  diamondRow,
  frameIndexAt,
  type Instance,
  type LayerEntry,
  layerPosition,
  type RawImage,
  rgbaImage,
  type SceneEntity,
  type SceneLayer,
  TILE_H,
  TILE_W,
} from "@panthea/renderer";
import { Scene, type Texture } from "three";
import type { Sprite2D } from "three-flatland";

const god = spriteFixture("placeholder-zeus");
const snapshot: RegistrySnapshot = {
  entries: new Map([
    [
      god.manifest.id,
      {
        assetId: god.manifest.id,
        revision: god.manifest.atlas.blob,
        manifest: god.manifest,
      },
    ],
  ]),
};
const ATLAS = god.manifest.atlas;
const GOD_SPEC: AtlasSpec = {
  pixelKey: "pixels-1",
  width: ATLAS.width,
  height: ATLAS.height,
};

function atlasImage(width: number, height: number, tag: number) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([tag, 80, 160, 255], i);
  return rgbaImage(width, height, rgba);
}

function godEntity(
  id: string,
  at = { x: 2, y: 3, z: 0 },
  override: Partial<
    Extract<SceneEntity, { kind: "sprite" }>["resolution"]
  > = {},
): SceneEntity {
  const resolution = resolveAsset(snapshot, { spriteId: god.manifest.id });
  return {
    kind: "sprite",
    id,
    layer: "actor",
    cell: at,
    resolution: { ...resolution, ...override } as never,
  };
}

function instances(...entities: SceneEntity[]): Instance[] {
  const scene = composeScene(entities);
  expect(scene.refused).toEqual([]);
  return [...scene.instances];
}

function setup() {
  const scene = new Scene();
  const layer = createSceneLayer(scene);
  return { scene, layer };
}

function spriteOf(layer: SceneLayer, id: string): Sprite2D {
  const sprite = layer.spriteFor(id);
  if (sprite === undefined) throw new Error(`no sprite for ${id}`);
  return sprite;
}

function entriesFor(list: readonly Instance[], atlasKey: string): LayerEntry[] {
  return list.map((instance) => ({ instance, atlasKey }));
}

describe("frameIndexAt", () => {
  const durations = [100, 100, 100, 100];

  it("walks frames by their own durations and loops", () => {
    expect(
      [0, 99, 100, 250, 399, 400, 1250].map((t) =>
        frameIndexAt(durations, undefined, t),
      ),
    ).toEqual([0, 0, 1, 2, 3, 0, 0]);
  });

  it("uses per-frame durations", () => {
    expect(
      [0, 49, 50, 149, 150, 999].map((t) =>
        frameIndexAt([50, 100, 1000], undefined, t),
      ),
    ).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("loops back to loopStart after the first pass", () => {
    expect(
      [0, 100, 200, 300, 400, 500, 600].map((t) =>
        frameIndexAt(durations, 2, t),
      ),
    ).toEqual([0, 1, 2, 3, 2, 3, 2]);
  });

  it("holds the only frame, and treats negative or non-finite time as the start", () => {
    expect(frameIndexAt([100], undefined, 5000)).toBe(0);
    expect(frameIndexAt(durations, undefined, -5)).toBe(0);
    expect(frameIndexAt(durations, undefined, Number.NaN)).toBe(0);
  });
});

describe("layerPosition", () => {
  it("centres the sprite on its top-left box and flips y for the y-up world", () => {
    const [instance] = instances(godEntity("zeus"));
    if (instance === undefined) throw new Error("no instance");
    expect(layerPosition(instance)).toEqual({
      x: instance.x + 32,
      y: -(instance.y + 40),
      z: instance.z,
    });
  });
});

describe("scene layer", () => {
  it("draws one sprite per instance with the atlas material, the first frame and the depth z", () => {
    const { layer } = setup();
    const list = instances(godEntity("zeus"));
    layer.commit("god", GOD_SPEC, atlasImage(256, 80, 1));
    const result = layer.apply(entriesFor(list, "god"));
    expect(result).toEqual({ drawn: 1, skipped: [] });

    const sprite = spriteOf(layer, "zeus");
    const instance = list[0] as Instance;
    expect(sprite.position.toArray()).toEqual([
      instance.x + 32,
      -(instance.y + 40),
      instance.z,
    ]);
    expect(sprite.material.alphaTest).toBeGreaterThan(0);
    expect(sprite.material.depthWrite).toBe(true);
    expect(sprite.material.depthTest).toBe(true);
    expect(sprite.scale.toArray()).toEqual([64, 80, 1]);
    expect(sprite.anchor.toArray()).toEqual([0.5, 0.5]);
    expect(sprite.lit).toBe(false);
    expect(layer.stats).toEqual({ sprites: 1, textures: 1 });
    layer.dispose();
  });

  it("batches instances of one atlas together and splits batches per atlas", () => {
    const { scene, layer } = setup();
    const list = instances(
      godEntity("a", { x: 0, y: 0, z: 0 }),
      godEntity("b", { x: 1, y: 0, z: 0 }),
    );
    layer.commit("god", GOD_SPEC, atlasImage(256, 80, 1));
    layer.commit("other", GOD_SPEC, atlasImage(256, 80, 2));
    layer.apply([
      { instance: list[0] as Instance, atlasKey: "god" },
      { instance: list[1] as Instance, atlasKey: "god" },
    ]);
    scene.updateMatrixWorld(true);
    expect(layer.group.batchCount).toBe(1);

    layer.apply([
      { instance: list[0] as Instance, atlasKey: "god" },
      { instance: list[1] as Instance, atlasKey: "other" },
    ]);
    scene.updateMatrixWorld(true);
    expect(layer.group.batchCount).toBe(2);
    layer.dispose();
  });

  it("skips an instance whose atlas was never committed, and reports it", () => {
    const { layer } = setup();
    const list = instances(godEntity("zeus"));
    expect(layer.apply(entriesFor(list, "absent"))).toEqual({
      drawn: 0,
      skipped: ["zeus"],
    });
    expect(layer.stats).toEqual({ sprites: 0, textures: 0 });
    layer.dispose();
  });

  it("moves a sprite in place when only its placement changed (a pivot-only edit)", () => {
    const { layer } = setup();
    layer.commit("god", GOD_SPEC, atlasImage(256, 80, 1));
    layer.apply(entriesFor(instances(godEntity("zeus")), "god"));
    const before = spriteOf(layer, "zeus");
    const frameBefore = before.frame?.name;

    const moved = instances(
      godEntity("zeus", undefined, { pivot: { x: 16, y: 70 } }),
    );
    layer.apply(entriesFor(moved, "god"));

    const after = spriteOf(layer, "zeus");
    const instance = moved[0] as Instance;
    expect(after).toBe(before);
    expect(after.frame?.name).toBe(frameBefore);
    expect(after.position.x).toBe(instance.x + 32);
    expect(after.position.y).toBe(-(instance.y + 40));
    expect(layer.stats).toEqual({ sprites: 1, textures: 1 });
    layer.dispose();
  });

  it("rebuilds the sprite on a frame-rect change at the same atlas size, keeping the texture", () => {
    const { layer } = setup();
    layer.commit("god", GOD_SPEC, atlasImage(256, 80, 1));
    const original = instances(godEntity("zeus"));
    layer.apply(entriesFor(original, "god"));
    const before = spriteOf(layer, "zeus");
    const texture = before.texture;

    const frames = [
      { rect: { x: 64, y: 0, w: 64, h: 80 }, durationMs: 167 },
      { rect: { x: 0, y: 0, w: 64, h: 80 }, durationMs: 167 },
    ];
    const reframed = instances(godEntity("zeus", undefined, { frames }));
    layer.apply(entriesFor(reframed, "god"));

    const after = spriteOf(layer, "zeus");
    expect(after).not.toBe(before);
    expect(after.texture).toBe(texture);
    expect(after.frame?.x).toBe(0.25);
    expect(layer.stats).toEqual({ sprites: 1, textures: 1 });
    layer.dispose();
  });

  it("swaps pixels in place for a same-size reload without touching sprites", () => {
    const { layer } = setup();
    layer.commit("god", GOD_SPEC, atlasImage(256, 80, 1));
    layer.apply(entriesFor(instances(godEntity("zeus")), "god"));
    const sprite = spriteOf(layer, "zeus");
    const texture = sprite.texture as Texture;

    const result = layer.commit(
      "god",
      { ...GOD_SPEC, pixelKey: "pixels-2" },
      atlasImage(256, 80, 200),
    );
    expect(result.decision).toBe("swap");
    expect(spriteOf(layer, "zeus")).toBe(sprite);
    expect(sprite.texture).toBe(texture);
    expect((texture.image as RawImage).data[0]).toBe(200);
    layer.dispose();
  });

  it("detaches the old sprite before the old texture is disposed on a size change", () => {
    const { layer } = setup();
    layer.commit("god", GOD_SPEC, atlasImage(256, 80, 1));
    const list = instances(godEntity("zeus"));
    layer.apply(entriesFor(list, "god"));
    const oldSprite = spriteOf(layer, "zeus");
    const oldTexture = oldSprite.texture as Texture;
    const events: string[] = [];
    let referencedAtDisposal = true;
    oldTexture.addEventListener("dispose", () => {
      events.push("texture");
      referencedAtDisposal = layer.spritesUsing(oldTexture).length > 0;
    });
    const dispose = oldSprite.dispose.bind(oldSprite);
    oldSprite.dispose = () => {
      events.push("sprite");
      dispose();
    };

    layer.commit(
      "god",
      { pixelKey: "pixels-2", width: 512, height: 80 },
      atlasImage(512, 80, 9),
    );
    layer.apply(entriesFor(list, "god"));

    expect(events).toEqual(["sprite", "texture"]);
    expect(referencedAtDisposal).toBe(false);
    expect(spriteOf(layer, "zeus").texture).not.toBe(oldTexture);
    expect(layer.stats).toEqual({ sprites: 1, textures: 1 });
    layer.dispose();
  });

  it("returns to the baseline after 20 mixed reloads", () => {
    const { scene, layer } = setup();
    layer.commit("god", GOD_SPEC, atlasImage(256, 80, 0));
    const list = instances(godEntity("zeus"));
    layer.apply(entriesFor(list, "god"));
    const baseline = layer.stats;
    for (let i = 1; i <= 20; i += 1) {
      const wide = i % 2 === 0;
      layer.commit(
        "god",
        { pixelKey: `pixels-${i}`, width: wide ? 256 : 512, height: 80 },
        atlasImage(wide ? 256 : 512, 80, i),
      );
      layer.apply(entriesFor(list, "god"));
      scene.updateMatrixWorld(true);
      expect(layer.stats).toEqual(baseline);
    }
    expect(layer.group.batchCount).toBe(1);
    layer.dispose();
  });

  it("removes sprites and releases atlases for instances that left the scene", () => {
    const { scene, layer } = setup();
    layer.commit("god", GOD_SPEC, atlasImage(256, 80, 1));
    const list = instances(
      godEntity("a", { x: 0, y: 0, z: 0 }),
      godEntity("b", { x: 1, y: 0, z: 0 }),
    );
    layer.apply(entriesFor(list, "god"));
    expect(layer.stats.sprites).toBe(2);
    layer.apply(entriesFor([list[0] as Instance], "god"));
    expect(layer.stats).toEqual({ sprites: 1, textures: 1 });
    layer.apply([]);
    scene.updateMatrixWorld(true);
    expect(layer.stats).toEqual({ sprites: 0, textures: 0 });
    expect(layer.group.isEmpty).toBe(true);
    layer.dispose();
  });

  it("draws the generated ground diamond", () => {
    const { layer } = setup();
    const list = instances({
      kind: "diamond",
      id: "g",
      cell: { x: 0, y: 0, z: 0 },
    });
    layer.commit(
      "diamond",
      { pixelKey: "diamond", width: TILE_W, height: TILE_H },
      diamondImage(),
    );
    expect(layer.apply(entriesFor(list, "diamond")).drawn).toBe(1);
    const sprite = spriteOf(layer, "g");
    expect(sprite.scale.toArray()).toEqual([TILE_W, TILE_H, 1]);
    expect(diamondRow(0)).not.toBeNull();
    layer.dispose();
  });

  it("selects the animation frame from elapsed time", () => {
    const { layer } = setup();
    layer.commit("god", GOD_SPEC, atlasImage(256, 80, 1));
    layer.apply(entriesFor(instances(godEntity("zeus")), "god"));
    const sprite = spriteOf(layer, "zeus");
    const x = () => sprite.frame?.x;
    expect(x()).toBe(0);
    layer.tick(170);
    expect(x()).toBe(0.25);
    layer.tick(3 * 167 + 1);
    expect(x()).toBe(0.75);
    layer.tick(4 * 167 + 1);
    expect(x()).toBe(0);
    layer.dispose();
  });

  it("keeps the playback time across a re-apply, so a reload does not restart the animation", () => {
    const { layer } = setup();
    layer.commit("god", GOD_SPEC, atlasImage(256, 80, 1));
    const list = instances(godEntity("zeus"));
    layer.apply(entriesFor(list, "god"));
    layer.tick(170);
    layer.commit(
      "god",
      { pixelKey: "pixels-2", width: 512, height: 80 },
      atlasImage(512, 80, 3),
    );
    layer.apply(entriesFor(list, "god"));
    expect(spriteOf(layer, "zeus").frame?.height).toBe(1);
    expect(spriteOf(layer, "zeus").frame?.name).toBe("64,0,64,80");
    layer.dispose();
  });

  it("releases its ECS world on dispose, so layers can be made and disposed past koota's 16-world cap", () => {
    // A layer owns a SpriteGroup, whose world is created with its first sprite
    // and counted against a process-wide cap of 16. A device-loss remount or an
    // inspector toggle builds a layer each time, so a dispose that kept the
    // world would exhaust the cap in the running app.
    for (let made = 0; made < 40; made += 1) {
      const { layer } = setup();
      layer.commit("god", GOD_SPEC, atlasImage(256, 80, 1));
      layer.apply(entriesFor(instances(godEntity("zeus")), "god"));
      expect(layer.stats.sprites).toBe(1);
      layer.dispose();
    }
  });

  it("disposes cleanly, twice, and ignores later calls", () => {
    const { scene, layer } = setup();
    layer.commit("god", GOD_SPEC, atlasImage(256, 80, 1));
    layer.apply(entriesFor(instances(godEntity("zeus")), "god"));
    layer.dispose();
    expect(scene.children).toEqual([]);
    expect(layer.stats).toEqual({ sprites: 0, textures: 0 });
    expect(() => layer.dispose()).not.toThrow();
    expect(
      layer.apply(entriesFor(instances(godEntity("zeus")), "god")),
    ).toEqual({
      drawn: 0,
      skipped: [],
    });
    expect(() => layer.tick(5)).not.toThrow();
    expect(layer.stats).toEqual({ sprites: 0, textures: 0 });
  });

  it("can be replaced 40 times without exhausting the sprite-group world limit", () => {
    for (let i = 0; i < 40; i += 1) {
      const { scene, layer } = setup();
      layer.commit("god", GOD_SPEC, atlasImage(256, 80, 1));
      layer.apply(entriesFor(instances(godEntity("zeus")), "god"));
      scene.updateMatrixWorld(true);
      layer.dispose();
    }
  });
});
