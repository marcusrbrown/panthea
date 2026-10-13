import { describe, expect, it } from "bun:test";
import {
  type RegistrySnapshot,
  type Resolution,
  resolveAsset,
} from "@panthea/assets";
import {
  type FixtureAsset,
  portraitFixture,
  spriteFixture,
} from "@panthea/assets/fixtures";
import {
  type Cell,
  composeScene,
  ENTITY_SLOTS,
  type Instance,
  type Layer,
  type SceneEntity,
} from "@panthea/renderer";

const cell = (x: number, y: number, z = 0): Cell => ({ x, y, z });

function snapshot(...assets: FixtureAsset[]): RegistrySnapshot {
  return {
    entries: new Map(
      assets.map((asset) => [
        asset.manifest.id,
        {
          assetId: asset.manifest.id,
          revision: asset.manifest.atlas.blob,
          manifest: asset.manifest,
        },
      ]),
    ),
  };
}

const god = spriteFixture("placeholder-zeus");
const registry = snapshot(god);
const TWO_BY_TWO = { w: 2, h: 2 };

/** A real resolved god sprite with only the footprint overridden: the field under test. */
function structure(
  id: string,
  at: Cell,
  footprint: { readonly w: number; readonly h: number },
): SceneEntity {
  const resolution = resolveAsset(registry, { spriteId: "placeholder-zeus" });
  if (resolution.source !== "canon" || resolution.kind !== "sprite") {
    throw new Error("fixture did not resolve to a canon sprite");
  }
  return {
    kind: "sprite",
    id,
    layer: "structure",
    cell: at,
    resolution: { ...resolution, footprint },
  };
}

function sprite(
  id: string,
  layer: Layer,
  at: Cell,
  spriteId: string,
  state?: string,
  snap: RegistrySnapshot = registry,
): SceneEntity {
  const resolution = resolveAsset(snap, {
    spriteId,
    ...(state === undefined ? {} : { state }),
  });
  return { kind: "sprite", id, layer, cell: at, resolution };
}

function find(instances: readonly Instance[], id: string): Instance {
  const found = instances.find((instance) => instance.id === id);
  if (found === undefined) throw new Error(`no instance ${id}`);
  return found;
}

describe("composeScene: resolver results", () => {
  it("draws canon idle-south and the placeholder for a missing seated state, with no error (AE1)", () => {
    const only = snapshot(god);
    const scene = composeScene([
      sprite("idle", "actor", cell(2, 2), "placeholder-zeus", undefined, only),
      sprite("seated", "actor", cell(4, 2), "placeholder-zeus", "seated", only),
    ]);
    expect(scene.refused).toEqual([]);
    const idle = find(scene.instances, "idle");
    const seated = find(scene.instances, "seated");

    expect(idle.art.source).toBe("canon");
    if (idle.art.source === "canon") {
      expect(idle.art.assetId).toBe(god.manifest.id);
      expect(idle.art.frames).toEqual(god.manifest.animations[0]?.frames);
      expect(idle.art.atlas).toEqual(god.manifest.atlas);
    }
    expect([idle.w, idle.h]).toEqual([64, 80]);

    expect(seated.art.source).toBe("placeholder");
    if (seated.art.source === "placeholder") {
      expect(seated.art.reason).toBe("missing-state");
      expect([seated.w, seated.h]).toEqual([
        seated.art.placeholder.width,
        seated.art.placeholder.height,
      ]);
    }
  });

  it("falls back to the placeholder for an unknown sprite id with the resolver's reason", () => {
    const scene = composeScene([
      sprite("ghost", "actor", cell(0, 0), "no-such-sprite"),
    ]);
    const ghost = find(scene.instances, "ghost");
    expect(ghost.art.source === "placeholder" && ghost.art.reason).toBe(
      "missing-id",
    );
  });

  it("places a canon sprite by its manifest pivot on the footprint's bottom vertex", () => {
    const scene = composeScene([
      sprite("zeus", "actor", cell(2, 3), "placeholder-zeus"),
    ]);
    const zeus = find(scene.instances, "zeus");
    expect(zeus.footprint).toEqual({ w: 1, h: 1 });
    // Bottom vertex of tile (2,3): x = (2-3)*32 = -32, y = 5*16 + 31 = 111.
    expect(god.manifest.pivot).toEqual({ x: 32, y: 80 });
    expect({ x: zeus.x, y: zeus.y }).toEqual({ x: -64, y: 31 });
    expect([zeus.x + 32, zeus.y + 80]).toEqual([-32, 111]);
  });

  it("places a 2x2 structure's pivot on the bottom vertex of its bottom cell", () => {
    const scene = composeScene([structure("tower", cell(3, 3), TWO_BY_TWO)]);
    const built = find(scene.instances, "tower");
    expect(built.footprint).toEqual({ w: 2, h: 2 });
    // Bottom cell (4,4): vertex x = 0, y = 8*16 + 31 = 159.
    expect([built.x + 32, built.y + 80]).toEqual([0, 159]);
  });

  it("anchors a placeholder at the bottom-centre of a single tile", () => {
    const scene = composeScene([sprite("ghost", "actor", cell(1, 1), "none")]);
    const ghost = find(scene.instances, "ghost");
    // Tile (1,1): vertex x = 0, y = 2*16 + 31 = 63.
    expect([ghost.w, ghost.h]).toEqual([16, 16]);
    expect([ghost.x + ghost.w / 2, ghost.y + ghost.h]).toEqual([0, 63]);
  });

  it("draws ground diamonds procedurally on the ground layer", () => {
    const scene = composeScene([
      { kind: "diamond", id: "g0", cell: cell(0, 0) },
      sprite("zeus", "actor", cell(0, 0), "placeholder-zeus"),
    ]);
    const ground = find(scene.instances, "g0");
    expect(ground.art).toEqual({ source: "diamond" });
    expect(ground.layer).toBe("ground");
    expect(ground.w).toBe(64);
    expect(ground.h).toBe(32);
    expect({ x: ground.x, y: ground.y }).toEqual({ x: -32, y: 0 });
    expect(ground.z).toBeLessThan(find(scene.instances, "zeus").z);
  });
});

describe("composeScene: depth", () => {
  it("is independent of a sprite's pixel height", () => {
    const scene = composeScene([
      sprite("tall", "actor", cell(5, 5), "placeholder-zeus"),
      sprite("short", "actor", cell(5, 5), "no-such-sprite"),
    ]);
    const tall = find(scene.instances, "tall");
    const short = find(scene.instances, "short");
    expect(tall.h).toBeGreaterThan(short.h);
    expect(tall.depth).toBe(short.depth);
    expect(Math.abs(tall.z - short.z)).toBeLessThan(ENTITY_SLOTS);
  });

  it("orders by footprint cell, not by how far a sprite reaches up the screen", () => {
    const scene = composeScene([
      sprite("tall-behind", "actor", cell(1, 1), "placeholder-zeus"),
      sprite("short-ahead", "actor", cell(2, 1), "no-such-sprite"),
    ]);
    expect(find(scene.instances, "short-ahead").z).toBeGreaterThan(
      find(scene.instances, "tall-behind").z,
    );
  });

  it("lets a 2x2 structure in front occlude an actor behind it", () => {
    const scene = composeScene([
      structure("tower", cell(3, 3), TWO_BY_TWO),
      sprite("behind", "actor", cell(2, 2), "placeholder-zeus"),
      sprite("ahead", "actor", cell(4, 5), "placeholder-zeus"),
    ]);
    const tower = find(scene.instances, "tower");
    expect(tower.depth).toBe(8);
    expect(find(scene.instances, "behind").z).toBeLessThan(tower.z);
    expect(find(scene.instances, "ahead").z).toBeGreaterThan(tower.z);
  });

  it("sorts an actor after a structure at the same depth", () => {
    const scene = composeScene([
      sprite("actor", "actor", cell(5, 3), "placeholder-zeus"),
      structure("tower", cell(3, 3), TWO_BY_TWO),
    ]);
    const tower = find(scene.instances, "tower");
    const actor = find(scene.instances, "actor");
    expect(tower.depth).toBe(actor.depth);
    expect(tower.z).toBeLessThan(actor.z);
  });

  it("enters elevation as -z while lifting the screen position by 16 px", () => {
    const scene = composeScene([
      sprite("ground", "actor", cell(3, 3, 0), "placeholder-zeus"),
      sprite("raised", "actor", cell(3, 3, 1), "placeholder-zeus"),
    ]);
    const ground = find(scene.instances, "ground");
    const raised = find(scene.instances, "raised");
    expect(raised.depth).toBe(ground.depth - 1);
    expect(raised.z).toBeLessThan(ground.z);
    expect(raised.y).toBe(ground.y - 16);
    expect(raised.x).toBe(ground.x);
  });

  it("breaks equal depth and layer by entity id, the same way whatever the input order", () => {
    const ids = ["delta", "alpha", "charlie", "bravo"];
    const build = (order: readonly string[]) =>
      composeScene(
        order.map((id) => sprite(id, "actor", cell(2, 2), "placeholder-zeus")),
      );
    const forward = build(ids);
    const reversed = build([...ids].reverse());
    expect(forward.instances.map((i) => i.id)).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
    ]);
    expect(reversed).toEqual(forward);
    expect(build(ids)).toEqual(forward);
    expect(new Set(forward.instances.map((i) => i.z)).size).toBe(4);
  });

  it("returns instances back to front", () => {
    const scene = composeScene([
      sprite("c", "speech", cell(1, 1), "placeholder-zeus"),
      { kind: "diamond", id: "a", cell: cell(6, 6) },
      sprite("b", "actor", cell(0, 0), "placeholder-zeus"),
    ]);
    const zs = scene.instances.map((i) => i.z);
    expect([...zs].sort((p, q) => p - q)).toEqual(zs);
    expect(scene.instances.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });
});

describe("composeScene: refusals", () => {
  it("refuses out-of-range coordinates by id with a reason, and still composes the rest", () => {
    const scene = composeScene([
      sprite("far", "actor", cell(500, 0), "placeholder-zeus"),
      sprite("near", "actor", cell(1, 1), "placeholder-zeus"),
    ]);
    expect(scene.instances.map((i) => i.id)).toEqual(["near"]);
    expect(scene.refused).toHaveLength(1);
    expect(scene.refused[0]).toMatchObject({
      id: "far",
      reason: "out-of-range",
    });
    expect(scene.refused[0]?.detail).toContain("500");
  });

  it("refuses a footprint that spills past the supported range", () => {
    const scene = composeScene([structure("edge", cell(63, 0), TWO_BY_TWO)]);
    expect(scene.instances).toEqual([]);
    expect(scene.refused[0]).toMatchObject({
      id: "edge",
      reason: "out-of-range",
    });
  });

  it("refuses a duplicate id instead of drawing two entities under one name", () => {
    const scene = composeScene([
      sprite("twin", "actor", cell(0, 0), "placeholder-zeus"),
      sprite("twin", "actor", cell(1, 0), "placeholder-zeus"),
    ]);
    expect(scene.instances.map((i) => i.id)).toEqual(["twin"]);
    expect(scene.refused).toEqual([
      expect.objectContaining({ id: "twin", reason: "duplicate-id" }),
    ]);
  });

  it("refuses a portrait resolution: portraits preview flat, outside the scene", () => {
    const portrait = portraitFixture();
    const resolution: Resolution = resolveAsset(snapshot(portrait), {
      spriteId: "zeus-portrait",
      expression: "neutral",
    });
    expect(resolution.source === "canon" && resolution.kind).toBe("portrait");
    const scene = composeScene([
      {
        kind: "sprite",
        id: "face",
        layer: "actor",
        cell: cell(0, 0),
        resolution,
      },
    ]);
    expect(scene.instances).toEqual([]);
    expect(scene.refused[0]).toMatchObject({
      id: "face",
      reason: "not-placeable",
    });
  });

  it("refuses entities past the slot count for one depth and layer, rather than reordering them", () => {
    const entities = Array.from({ length: ENTITY_SLOTS + 1 }, (_, i) =>
      sprite(
        `e${String(i).padStart(4, "0")}`,
        "actor",
        cell(0, 0),
        "placeholder-zeus",
      ),
    );
    const scene = composeScene(entities);
    expect(scene.instances).toHaveLength(ENTITY_SLOTS);
    expect(scene.refused).toHaveLength(1);
    expect(scene.refused[0]).toMatchObject({
      id: `e${String(ENTITY_SLOTS).padStart(4, "0")}`,
      reason: "too-many-at-depth",
    });
  });

  it("composes an empty scene", () => {
    expect(composeScene([])).toEqual({ instances: [], refused: [] });
  });
});

describe("composeScene: placeholder footprint", () => {
  const placeholder = resolveAsset(registry, { spriteId: "no-such-sprite" });

  it("anchors a placeholder on the bottom vertex of a declared 2x2 footprint", () => {
    const scene = composeScene([
      {
        kind: "sprite",
        id: "hall",
        layer: "structure",
        cell: cell(3, 3),
        footprint: TWO_BY_TWO,
        resolution: placeholder,
      },
    ]);
    const hall = find(scene.instances, "hall");
    expect(hall.footprint).toEqual(TWO_BY_TWO);
    expect(hall.depth).toBe(8);
    // Bottom cell (4,4): vertex x = 0, y = 8*16 + 31 = 159.
    expect([hall.x + hall.w / 2, hall.y + hall.h]).toEqual([0, 159]);
  });

  it("ignores the override for canon art, whose manifest declares its own footprint", () => {
    const resolution = resolveAsset(registry, { spriteId: "placeholder-zeus" });
    const scene = composeScene([
      {
        kind: "sprite",
        id: "zeus",
        layer: "actor",
        cell: cell(3, 3),
        footprint: TWO_BY_TWO,
        resolution,
      },
    ]);
    expect(find(scene.instances, "zeus").footprint).toEqual({ w: 1, h: 1 });
  });

  it("refuses an out-of-range override footprint", () => {
    const scene = composeScene([
      {
        kind: "sprite",
        id: "wide",
        layer: "structure",
        cell: cell(0, 0),
        footprint: { w: 9, h: 1 },
        resolution: placeholder,
      },
    ]);
    expect(scene.refused[0]).toMatchObject({
      id: "wide",
      reason: "bad-footprint",
    });
  });
});

describe("composeScene: flat panels", () => {
  const portrait = portraitFixture();
  const portraitResolution = resolveAsset(snapshot(portrait), {
    spriteId: "zeus-portrait",
    expression: "neutral",
  });

  it("places a portrait at a screen position, at its cell size, in front of every iso instance", () => {
    const scene = composeScene([
      {
        kind: "flat",
        id: "panel",
        at: { x: 140, y: -20 },
        resolution: portraitResolution,
      },
      sprite("far-front", "speech", cell(63, 63, -8), "placeholder-zeus"),
    ]);
    expect(scene.refused).toEqual([]);
    const panel = find(scene.instances, "panel");
    expect([panel.x, panel.y, panel.w, panel.h]).toEqual([140, -20, 96, 96]);
    expect(panel.layer).toBe("speech");
    expect(panel.art.source).toBe("canon");
    expect(panel.z).toBeGreaterThan(find(scene.instances, "far-front").z);
  });

  it("places a flat placeholder at its own size", () => {
    const resolution = resolveAsset(registry, { spriteId: "missing" });
    const scene = composeScene([
      { kind: "flat", id: "ph", at: { x: 8, y: 9 }, resolution },
    ]);
    const ph = find(scene.instances, "ph");
    expect([ph.x, ph.y, ph.w, ph.h]).toEqual([8, 9, 16, 16]);
  });

  it("refuses a fractional screen position", () => {
    const scene = composeScene([
      {
        kind: "flat",
        id: "panel",
        at: { x: 0.5, y: 0 },
        resolution: portraitResolution,
      },
    ]);
    expect(scene.instances).toEqual([]);
    expect(scene.refused[0]).toMatchObject({
      id: "panel",
      reason: "non-integer",
    });
  });
});
