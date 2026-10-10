import { expect, test } from "bun:test";
import { EMPTY_SNAPSHOT, resolveAssetPixels } from "@panthea/assets/browser";
import type { Realm } from "@panthea/contracts";
import { type DecodedImage, placeholderImage } from "@panthea/renderer";
import type { Mesh, MeshBasicMaterial } from "three";
import type { Sprite2D, SpriteGroup } from "three-flatland";

import {
  decodeFixture,
  type FakeSource,
  fakeSource,
  ZEUS_ATLAS_BYTES,
  ZEUS_ATLAS_HASH,
  zeusPayload,
} from "../assets/_test-canon";
import {
  type CanonClient,
  type CanonProblem,
  createCanonClient,
} from "../assets/canon";
import { previewView } from "../fixtures";
import type { WorldViewModel } from "../store";
import { testBackend } from "./_test-backend";
import { viewWithZeus } from "./_test-view";
import { CAMERA_ORIGIN } from "./layout";
import { drawableEvents } from "./presentation";
import { createWorldRenderer, type WorldRenderer } from "./scene";

const IDLE_FRAMES = ["0,0,64,80", "64,0,64,80", "128,0,64,80", "192,0,64,80"];

function canvas() {
  return { width: 0, height: 0, style: {} } as unknown as HTMLCanvasElement & {
    style: Record<string, string>;
  };
}

function setup(
  options: {
    payload?: unknown;
    atlases?: ReadonlyMap<string, Uint8Array>;
    decode?: (bytes: Uint8Array) => Promise<DecodedImage>;
    available?: { width: number; height: number };
    devicePixelRatio?: number;
    source?: FakeSource;
  } = {},
) {
  const problems: CanonProblem[] = [];
  const source =
    options.source ??
    fakeSource(options.payload ?? zeusPayload(), options.atlases);
  const canon = createCanonClient({
    source,
    onProblem: (problem) => problems.push(problem),
  });
  return { source, canon, problems, options };
}

async function mount(
  canon: CanonClient,
  options: {
    decode?: (bytes: Uint8Array) => Promise<DecodedImage>;
    available?: { width: number; height: number };
    devicePixelRatio?: number;
  } = {},
) {
  const backend = testBackend();
  const element = canvas();
  const lost: string[] = [];
  const renderer: WorldRenderer = createWorldRenderer(element, {
    canon,
    createBackend: () => backend,
    decode: options.decode ?? decodeFixture,
    devicePixelRatio: () => options.devicePixelRatio ?? 1,
    available: () => options.available ?? { width: 1200, height: 1300 },
  });
  await renderer.start(() => lost.push("lost"));
  return { renderer, backend, element, lost };
}

const spriteOf = (
  backend: ReturnType<typeof testBackend>,
  id: string,
): Sprite2D => {
  const sprite = backend.layer.spriteFor(id);
  if (sprite === undefined) throw new Error(`no sprite drawn for ${id}`);
  return sprite;
};

const pixelsOf = (sprite: Sprite2D): Uint8Array => {
  const image = sprite.texture?.image as { data: Uint8Array } | undefined;
  if (image === undefined) throw new Error("the sprite has no texture image");
  return image.data;
};

function placeholderPixels(): Uint8Array {
  const resolved = resolveAssetPixels(EMPTY_SNAPSHOT, { spriteId: "x" });
  if (resolved.source !== "placeholder")
    throw new Error("expected a placeholder");
  const image = placeholderImage(resolved.pixels).image;
  return (image as { data: Uint8Array }).data;
}

const spriteGroups = (backend: ReturnType<typeof testBackend>): SpriteGroup[] =>
  backend.scene.children.filter(
    (child): child is SpriteGroup => (child as SpriteGroup).isSpriteGroup,
  );

test("Zeus draws canon idle-south from the real atlas, and animates by the manifest's own durations from tick deltas", async () => {
  const { canon, source, problems } = setup();
  const { renderer, backend } = await mount(canon);

  await renderer.draw(viewWithZeus(), "olympus");

  const zeus = spriteOf(backend, "actor:zeus");
  const expected = await decodeFixture(ZEUS_ATLAS_BYTES);
  expect(zeus.texture?.image).toMatchObject({ width: 256, height: 80 });
  expect(pixelsOf(zeus)).toEqual((expected.image as { data: Uint8Array }).data);
  expect(zeus.frame?.name).toBe(IDLE_FRAMES[0]);

  // 333 / 167 / 333 / 167 ms, then the loop restarts.
  const at = (deltaMs: number) => {
    renderer.tick(deltaMs);
    return zeus.frame?.name;
  };
  expect(at(332)).toBe(IDLE_FRAMES[0]);
  expect(at(1)).toBe(IDLE_FRAMES[1]); // 333
  expect(at(166)).toBe(IDLE_FRAMES[1]); // 499
  expect(at(1)).toBe(IDLE_FRAMES[2]); // 500
  expect(at(332)).toBe(IDLE_FRAMES[2]); // 832
  expect(at(1)).toBe(IDLE_FRAMES[3]); // 833
  expect(at(166)).toBe(IDLE_FRAMES[3]); // 999
  expect(at(1)).toBe(IDLE_FRAMES[0]); // 1000

  expect(source.atlasCalls()).toEqual([ZEUS_ATLAS_HASH]);
  expect(problems).toEqual([]);
});

test("a strike leaves Zeus in idle-south: no act is selected", async () => {
  const { canon } = setup();
  const { renderer, backend } = await mount(canon);
  const struck = viewWithZeus({
    recentEvents: [
      {
        id: "evt-strike-14",
        sequence: 14,
        tick: 14,
        kind: "building-damaged",
        subjects: ["the-tavern", "zeus"],
      },
    ],
  });

  await renderer.draw(struck, "olympus");
  await renderer.draw(struck, "mortal");
  await renderer.draw(struck, "olympus");

  const zeus = spriteOf(backend, "actor:zeus");
  expect(zeus.frame?.name).toBe(IDLE_FRAMES[0]);
  for (const elapsed of [100, 400, 700, 1000, 2500]) {
    renderer.tick(elapsed);
    expect(IDLE_FRAMES).toContain(zeus.frame?.name ?? "");
  }
  expect(backend.layer.stats).toEqual({ sprites: 1, textures: 1 });
});

test("an inhabitant draws the shared placeholder pixels", async () => {
  const { canon } = setup();
  const { renderer, backend } = await mount(canon);

  await renderer.draw(viewWithZeus(), "mortal");

  const woodcutter = spriteOf(backend, "actor:woodcutter");
  expect(woodcutter.texture?.image).toMatchObject({ width: 16, height: 16 });
  expect(pixelsOf(woodcutter)).toEqual(placeholderPixels());
  // One shared placeholder texture serves every placeholder actor.
  expect(backend.layer.stats).toEqual({ sprites: 2, textures: 1 });
});

test("only the blob a parsed manifest names is ever fetched", async () => {
  const { canon, source } = setup();
  const { renderer } = await mount(canon);

  await renderer.draw(viewWithZeus(), "mortal");
  await renderer.draw(viewWithZeus(), "olympus");

  expect(source.atlasCalls()).toEqual([ZEUS_ATLAS_HASH]);
});

test("a registry problem falls back to the placeholder, is reported once, and never throws in a draw", async () => {
  const { canon, problems } = setup({
    payload: new Error("canon is unavailable"),
  });
  const { renderer, backend } = await mount(canon);

  const view = viewWithZeus();
  await expect(renderer.draw(view, "olympus")).resolves.toBeInstanceOf(Array);
  await renderer.draw(view, "olympus");

  const zeus = spriteOf(backend, "actor:zeus");
  expect(pixelsOf(zeus)).toEqual(placeholderPixels());
  expect(problems).toEqual([
    { scope: "canon_registry", message: "canon is unavailable" },
  ]);
});

test("a refused atlas fetch falls back to the placeholder, is reported once, and is not retried", async () => {
  const { canon, source, problems } = setup({ atlases: new Map() });
  const { renderer, backend } = await mount(canon);

  const view = viewWithZeus();
  await renderer.draw(view, "olympus");
  await renderer.draw(view, "olympus");

  const zeus = spriteOf(backend, "actor:zeus");
  expect(zeus.texture?.image).toMatchObject({ width: 16, height: 16 });
  expect(pixelsOf(zeus)).toEqual(placeholderPixels());
  expect(source.atlasCalls()).toEqual([ZEUS_ATLAS_HASH]);
  expect(problems).toHaveLength(1);
  expect(problems[0]?.scope).toBe(`atlas:${ZEUS_ATLAS_HASH}`);
});

test("an atlas that will not decode, or decodes to the wrong size, falls back and is reported once", async () => {
  const wrongSize = (bytes: Uint8Array) =>
    decodeFixture(bytes).then((image) => ({ ...image, width: 10, height: 10 }));
  const failing = () => Promise.reject(new Error("bad PNG"));

  for (const decode of [failing, wrongSize]) {
    const { canon, problems } = setup();
    const { renderer, backend } = await mount(canon, { decode });

    const view = viewWithZeus();
    await renderer.draw(view, "olympus");
    await renderer.draw(view, "olympus");

    expect(pixelsOf(spriteOf(backend, "actor:zeus"))).toEqual(
      placeholderPixels(),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.scope).toBe(`atlas:${ZEUS_ATLAS_HASH}`);
  }
});

test("three device-loss remounts rebuild from cached bytes: no refetch, no leaked textures, sprites, groups or meshes", async () => {
  const { canon, source } = setup();
  const view = viewWithZeus();
  const backends: ReturnType<typeof testBackend>[] = [];

  for (let mounted = 0; mounted < 4; mounted += 1) {
    const { renderer, backend, lost } = await mount(canon);
    backends.push(backend);

    await renderer.draw(view, "olympus");
    await renderer.draw(view, "mortal");

    expect(backend.layer.stats).toEqual({ sprites: 2, textures: 1 });
    expect(spriteGroups(backend)).toEqual([backend.layer.group]);
    expect(backend.decor.children.length).toBeGreaterThan(0);

    backend.triggerLost();
    expect(lost).toEqual(["lost"]);
    renderer.dispose();

    expect(backend.layer.stats).toEqual({ sprites: 0, textures: 0 });
    expect(spriteGroups(backend)).toEqual([]);
    expect(backend.decor.children).toEqual([]);
  }

  expect(source.registryCalls()).toBe(1);
  expect(source.atlasCalls()).toEqual([ZEUS_ATLAS_HASH]);
  // Each remount drew canon again, from the cached bytes.
  const last = backends[3];
  expect(last?.log.filter((entry) => entry === "render")).toHaveLength(2);
});

test("repeated renderer replacement never exhausts the sprite-group world limit", async () => {
  const { canon } = setup();
  const view = viewWithZeus();

  for (let mounted = 0; mounted < 40; mounted += 1) {
    const { renderer, backend } = await mount(canon);
    await renderer.draw(view, "mortal");
    await renderer.draw(view, "olympus");
    expect(backend.layer.stats.sprites).toBe(1);
    renderer.dispose();
  }
});

test("the ids a draw hands back are exactly the drawable events, as before", async () => {
  const { canon } = setup();
  const { renderer } = await mount(canon);
  const views: WorldViewModel[] = [previewView(), viewWithZeus()];

  for (const view of views) {
    for (const realm of ["mortal", "olympus", "underworld"] as Realm[]) {
      const drawn = await renderer.draw(view, realm);
      expect(drawn).toEqual(
        drawableEvents(view, realm).map((event) => event.id),
      );
    }
  }
  const preview = await renderer.draw(previewView(), "mortal");
  expect(preview).toEqual([
    "evt-strike-14",
    "evt-fire-15",
    "evt-trade-16",
    "evt-worship-17",
  ]);
});

/** Lets every settled promise run its continuation; no timer, no clock. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

test("a draw superseded while its atlas loads hands back nothing and the newer draw renders once", async () => {
  let release: (bytes: Uint8Array) => void = () => {};
  const held = new Promise<Uint8Array>((resolve) => {
    release = resolve;
  });
  const slow: FakeSource = {
    ...fakeSource(zeusPayload()),
    atlas: () => held,
  };
  const { canon } = setup({ source: slow });
  const { renderer, backend } = await mount(canon);
  await canon.load();

  const first = renderer.draw(viewWithZeus(), "olympus");
  await flush();
  const second = renderer.draw(previewView(), "mortal");
  await flush();
  release(ZEUS_ATLAS_BYTES);

  expect(await first).toEqual([]);
  expect(await second).toEqual(
    drawableEvents(previewView(), "mortal").map((event) => event.id),
  );
  expect(backend.log.filter((entry) => entry === "render")).toHaveLength(1);
  expect(backend.layer.spriteFor("actor:zeus")).toBeUndefined();
});

test("a draw prepares the scene, then renders; ticks that change no frame render nothing", async () => {
  const { canon } = setup();
  const { renderer, backend } = await mount(canon);

  await renderer.draw(viewWithZeus(), "olympus");
  expect(backend.log).toEqual(["start", "prepare", "render"]);

  renderer.tick(10);
  renderer.tick(10);
  expect(backend.log).toEqual(["start", "prepare", "render"]);

  renderer.tick(313); // 333 ms: the second idle frame
  expect(backend.log).toEqual(["start", "prepare", "render", "render"]);
});

test("nothing animates, so ticks never render, when no actor is canon", async () => {
  const { canon } = setup({ payload: new Error("no canon") });
  const { renderer, backend } = await mount(canon);

  await renderer.draw(viewWithZeus(), "olympus");
  const rendered = backend.log.length;
  renderer.tick(5000);

  expect(backend.log).toHaveLength(rendered);
});

test("a renderer disposed while the scene prepares renders nothing and hands back nothing", async () => {
  const { canon } = setup();
  const { renderer, backend } = await mount(canon);
  const release = backend.holdPrepare();

  const drawing = renderer.draw(viewWithZeus(), "olympus");
  await flush();
  expect(backend.log).toContain("prepare");
  renderer.dispose();
  release();

  expect(await drawing).toEqual([]);
  expect(backend.log).not.toContain("render");
  expect(await renderer.draw(viewWithZeus(), "olympus")).toEqual([]);
  expect(() => renderer.tick(10)).not.toThrow();
  expect(() => renderer.dispose()).not.toThrow();
});

test("the canvas backing store is the logical size times the largest whole zoom that fits, drawn from the centred camera", async () => {
  const { canon } = setup();
  const { backend, element } = await mount(canon, {
    available: { width: 1200, height: 1300 },
  });

  expect(element.width).toBe(1152);
  expect(element.height).toBe(1184);
  expect(element.style.width).toBe("1152px");
  expect(element.style.height).toBe("1184px");
  expect(element.style.left).toBe("24px");
  expect(element.style.top).toBe("58px");
  const view = backend.views.at(-1);
  expect(view?.zoom).toBe(2);
  expect(view?.camera).toEqual(CAMERA_ORIGIN);
  expect(view?.metrics).toMatchObject({
    backingWidth: 1152,
    backingHeight: 1184,
  });
});

test("at a device pixel ratio of 2 the CSS box is half the backing store", async () => {
  const { canon } = setup();
  const { element } = await mount(canon, {
    available: { width: 600, height: 620 },
    devicePixelRatio: 2,
  });

  expect(element.width).toBe(1152);
  expect(element.style.width).toBe("576px");
  expect(element.style.height).toBe("592px");
});

test("places, buildings, flames and event rings are meshes in the decor group, redrawn without accumulating", async () => {
  const { canon } = setup();
  const { renderer, backend } = await mount(canon);
  const view = previewView();

  await renderer.draw(view, "mortal");
  const first = backend.decor.children.length;
  await renderer.draw(view, "mortal");

  expect(backend.decor.children).toHaveLength(first);
  const names = backend.decor.children.map((child) => child.name);
  expect(names).toContain("place:town-square");
  expect(names).toContain("building:the-tavern");
  expect(names).toContain("flame:the-tavern");
  expect(names.filter((name) => name.startsWith("ring:"))).toHaveLength(4);
  expect(names).toContain("dead:fallen-guard");
  await renderer.draw(view, "olympus");
  expect(backend.decor.children.map((child) => child.name)).not.toContain(
    "building:the-tavern",
  );
});

test("pixel building colors use the shared palette without color conversion", async () => {
  const { canon } = setup();
  const { renderer, backend } = await mount(canon);

  await renderer.draw(previewView(), "mortal");

  const shop = backend.decor.children.find(
    (child) => child.name === "building:the-tavern",
  );
  const wall = shop?.children.find((child) => child.name === "wall") as Mesh;
  const color = (wall.material as MeshBasicMaterial).color;
  // The burning tavern uses the shared rust token.
  expect([color.r, color.g, color.b].map((v) => Math.round(v * 255))).toEqual([
    0xa5, 0x4d, 0x36,
  ]);
});
