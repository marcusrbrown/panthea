import { afterEach, expect, test } from "bun:test";
import { EMPTY_SNAPSHOT, resolveAssetPixels } from "@panthea/assets/browser";
import type { Realm } from "@panthea/contracts";
import { type DecodedImage, placeholderImage } from "@panthea/renderer";
import { testBackend } from "@panthea/testkit/renderer";
import type { Sprite2D, SpriteGroup } from "three-flatland";
import {
  decodeFixture,
  type FakeSource,
  fakeSource,
  ZEUS_ATLAS_BYTES,
  ZEUS_ATLAS_HASH,
  zeusPayload,
} from "../../test/canon-fixture";
import {
  decodeWithTall,
  MIXED_CELL_ATLASES,
  mixedCellPayload,
  TALL_CELL,
  TALL_SPRITE_ID,
} from "../../test/god-tall-fixture";
import { FIRE_ATLAS_HASH } from "../../test/structure-fixture";
import { viewWithZeus } from "../../test/view-fixture";
import {
  COMMITTED_CANON_ATLASES,
  committedCanonPayload,
  RETRO_ATLAS_HASH,
  RETRO_ATLASES,
  retroPayload,
} from "../../test/zeus-retro-fixture";
import {
  type CanonClient,
  type CanonProblem,
  createCanonClient,
} from "../assets/canon";
import { previewView } from "../fixtures";
import type { WorldViewModel } from "../store";
import {
  actorFoot,
  CAMERA_ORIGIN,
  LOGICAL_SIZE,
  locationPoints,
} from "./layout";
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

// A renderer's sprite layer owns an ECS world, and koota caps worlds at 16 per
// process, so every renderer a test mounts is disposed when the test ends
// (dispose is idempotent, and a test may dispose its own sooner).
const mounted: WorldRenderer[] = [];
afterEach(() => {
  for (const renderer of mounted.splice(0)) renderer.dispose();
});

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
  mounted.push(renderer);
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
  // the atlas holds idle's four cells, seated's two, then act's five
  expect(zeus.texture?.image).toMatchObject({ width: 704, height: 80 });
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
  // One shared placeholder texture serves every placeholder sprite: the two
  // actors, the tavern, its fire and the shop.
  expect(backend.layer.stats).toEqual({ sprites: 5, textures: 1 });
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
    backend.holdPrepare(); // only the draws' own frames are counted below

    await renderer.draw(view, "olympus");
    await renderer.draw(view, "mortal");

    // The mortal view: two inhabitants, the tavern, its fire and the shop, all on the one placeholder texture.
    expect(backend.layer.stats).toEqual({ sprites: 5, textures: 1 });
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
  backend.holdPrepare(); // only the draws' own frames are counted below
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

test("a draw renders at once however long the backend's async compile takes, then renders again when it settles; ticks that change no frame render nothing", async () => {
  const { canon } = setup();
  const { renderer, backend } = await mount(canon);
  // The webview's compile can be starved of animation frames (a hidden or
  // occluded window, a runtime without scheduler.yield): it settles late or never.
  const settle = backend.holdPrepare();

  const drawing = renderer.draw(viewWithZeus(), "olympus");
  await flush();
  expect(backend.log).toEqual(["start", "render", "prepare"]);
  await drawing;

  renderer.tick(10);
  renderer.tick(10);
  expect(backend.log).toEqual(["start", "render", "prepare"]);

  settle();
  await flush();
  expect(backend.log).toEqual(["start", "render", "prepare", "render"]);

  renderer.tick(313); // 333 ms: the second idle frame
  expect(backend.log).toEqual([
    "start",
    "render",
    "prepare",
    "render",
    "render",
  ]);
});

test("every view of a stream presents although a compile outlasts the next view, and compiles never stack", async () => {
  const { canon } = setup();
  const { renderer, backend } = await mount(canon);
  const settle = backend.holdPrepare();
  const count = (entry: string) =>
    backend.log.filter((logged) => logged === entry).length;

  const view = previewView();
  const drawn: Promise<readonly string[]>[] = [];
  for (const offset of [0, 1, 2]) {
    // The next view arrives as soon as the last one's synchronous work is done.
    drawn.push(renderer.draw({ ...view, tick: view.tick + offset }, "mortal"));
    await flush();
  }

  expect(count("render")).toBe(3);
  expect(count("prepare")).toBe(1);
  expect((await Promise.all(drawn)).every((ids) => ids.length > 0)).toBe(true);

  // Views that arrived during the compile get exactly one more.
  settle();
  await flush();
  expect(count("prepare")).toBe(2);
  expect(count("render")).toBe(5);
});

test("a compile that settles after disposal renders nothing, and one that fails is reported and does not stop the next", async () => {
  const { canon, problems } = setup();
  const { renderer, backend } = await mount(canon);
  const settle = backend.holdPrepare();

  await renderer.draw(viewWithZeus(), "olympus");
  renderer.dispose();
  settle();
  await flush();
  expect(backend.log.filter((entry) => entry === "render")).toHaveLength(1);

  const failing = await mount(canon);
  const prepare = failing.backend.prepare;
  let attempts = 0;
  failing.backend.prepare = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("shader link failed");
    await prepare?.();
  };
  await failing.renderer.draw(viewWithZeus(), "olympus");
  await flush();
  expect(problems.map((problem) => problem.message)).toEqual([
    "shader link failed",
  ]);
  await failing.renderer.draw(viewWithZeus(), "olympus");
  await flush();
  expect(attempts).toBe(2);
});

test("nothing animates, so ticks never render, when no actor is canon", async () => {
  const { canon } = setup({ payload: new Error("no canon") });
  const { renderer, backend } = await mount(canon);

  await renderer.draw(viewWithZeus(), "olympus");
  const rendered = backend.log.length;
  renderer.tick(5000);

  expect(backend.log).toHaveLength(rendered);
});

test("a renderer disposed while its atlas loads renders nothing and hands back nothing", async () => {
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

  const drawing = renderer.draw(viewWithZeus(), "olympus");
  await flush();
  renderer.dispose();
  release(ZEUS_ATLAS_BYTES);

  expect(await drawing).toEqual([]);
  expect(backend.log).not.toContain("render");
  expect(await renderer.draw(viewWithZeus(), "olympus")).toEqual([]);
  expect(() => renderer.tick(10)).not.toThrow();
  expect(() => renderer.dispose()).not.toThrow();
});

test("the canvas backing store is the logical size times the largest whole zoom that fits, drawn from the centred camera", async () => {
  const { canon } = setup();
  const { backend, element } = await mount(canon, {
    available: { width: 1500, height: 1900 },
  });

  expect(element.width).toBe(1472);
  expect(element.height).toBe(1856);
  expect(element.style.width).toBe("1472px");
  expect(element.style.height).toBe("1856px");
  expect(element.style.left).toBe("14px");
  expect(element.style.top).toBe("22px");
  const view = backend.views.at(-1);
  expect(view?.zoom).toBe(2);
  expect(view?.camera).toEqual(CAMERA_ORIGIN);
  expect(view?.metrics).toMatchObject({
    backingWidth: 1472,
    backingHeight: 1856,
  });
});

test("at a device pixel ratio of 2 the CSS box is half the backing store", async () => {
  const { canon } = setup();
  const { element } = await mount(canon, {
    available: { width: 736, height: 928 },
    devicePixelRatio: 2,
  });

  expect(element.width).toBe(1472);
  expect(element.style.width).toBe("736px");
  expect(element.style.height).toBe("928px");
});

test("places and event rings are meshes in the decor group, redrawn without accumulating; buildings and flames are not meshes", async () => {
  const { canon } = setup();
  const { renderer, backend } = await mount(canon);
  const view = previewView();

  await renderer.draw(view, "mortal");
  const first = backend.decor.children.length;
  await renderer.draw(view, "mortal");

  expect(backend.decor.children).toHaveLength(first);
  const names = backend.decor.children.map((child) => child.name);
  expect(names).toContain("place:town-square");
  expect(names.filter((name) => name.startsWith("ring:"))).toHaveLength(4);
  expect(names).toContain("dead:fallen-guard");
  expect(
    names.filter(
      (name) => name.startsWith("building:") || name.startsWith("flame:"),
    ),
  ).toEqual([]);
  await renderer.draw(view, "olympus");
  expect(backend.decor.children.map((child) => child.name)).not.toContain(
    "place:town-square",
  );
});

const CANON = {
  payload: committedCanonPayload,
  atlases: COMMITTED_CANON_ATLASES,
};

test("buildings draw as structure sprites from the published atlases, and a burning one has the fire over it", async () => {
  const { canon, problems } = setup({
    payload: CANON.payload(),
    atlases: CANON.atlases,
  });
  const { renderer, backend } = await mount(canon);

  await renderer.draw(previewView(), "mortal");

  // The burning tavern: the damaged house (second cell) and the first fire frame.
  expect(spriteOf(backend, "structure:the-tavern").frame?.name).toBe(
    "192,0,192,192",
  );
  expect(
    spriteOf(backend, "structure:the-tavern").texture?.image,
  ).toMatchObject({
    width: 576,
    height: 192,
  });
  expect(spriteOf(backend, "structure:the-tavern:fire").frame?.name).toBe(
    "0,0,64,88",
  );
  expect(
    spriteOf(backend, "structure:the-tavern:fire").texture?.image,
  ).toMatchObject({
    width: 640,
    height: 88,
  });
  // The operational shop is the intact house and has no fire.
  expect(spriteOf(backend, "structure:agora-shop").frame?.name).toBe(
    "0,0,192,192",
  );
  expect(backend.layer.spriteFor("structure:agora-shop:fire")).toBeUndefined();
  expect(problems).toEqual([]);
});

test("the fire loops on its own durations while the building beneath stays still", async () => {
  const { canon } = setup({
    payload: CANON.payload(),
    atlases: CANON.atlases,
  });
  const { renderer, backend } = await mount(canon);
  await renderer.draw(previewView(), "mortal");
  const fire = spriteOf(backend, "structure:the-tavern:fire");
  const house = spriteOf(backend, "structure:the-tavern");

  // Ten frames of 90 ms, then round again.
  renderer.tick(89);
  expect(fire.frame?.name).toBe("0,0,64,88");
  renderer.tick(1);
  expect(fire.frame?.name).toBe("64,0,64,88");
  renderer.tick(810);
  expect(fire.frame?.name).toBe("0,0,64,88");
  expect(house.frame?.name).toBe("192,0,192,192");
});

test("a building draws the placeholder when its art is not published, and the event on it is still drawn for receipts", async () => {
  const { canon, problems } = setup();
  const { renderer, backend } = await mount(canon);
  const view = previewView();

  const drawn = await renderer.draw(view, "mortal");

  for (const id of ["structure:the-tavern", "structure:the-tavern:fire"]) {
    const sprite = spriteOf(backend, id);
    expect(sprite.texture?.image).toMatchObject({ width: 16, height: 16 });
    expect(pixelsOf(sprite)).toEqual(placeholderPixels());
  }
  expect(drawn).toEqual(
    drawableEvents(view, "mortal").map((event) => event.id),
  );
  expect(drawn).toContain("evt-fire-15");
  // Nothing published is not a problem the player is told about: it is the placeholder.
  expect(problems).toEqual([]);
});

test("a structure whose atlas cannot be fetched falls back to the placeholder, is reported once, and the rest still draws", async () => {
  const atlases = new Map(COMMITTED_CANON_ATLASES);
  atlases.delete(FIRE_ATLAS_HASH);
  const { canon, problems } = setup({ payload: CANON.payload(), atlases });
  const { renderer, backend } = await mount(canon);

  await renderer.draw(previewView(), "mortal");
  await renderer.draw(previewView(), "mortal");

  expect(pixelsOf(spriteOf(backend, "structure:the-tavern:fire"))).toEqual(
    placeholderPixels(),
  );
  expect(spriteOf(backend, "structure:the-tavern").frame?.name).toBe(
    "192,0,192,192",
  );
  expect(problems.map((problem) => problem.scope)).toEqual([
    `atlas:${FIRE_ATLAS_HASH}`,
  ]);
});

test("an actor standing below a building draws in front of it, and the fire draws over the building", async () => {
  const { canon } = setup({ payload: CANON.payload(), atlases: CANON.atlases });
  const { renderer, backend } = await mount(canon);

  await renderer.draw(previewView(), "mortal");

  // The preview's wanderer stands at the tavern's place, below the building row.
  const house = spriteOf(backend, "structure:the-tavern");
  const actor = spriteOf(backend, "actor:wanderer");
  expect(actor.position.z).toBeGreaterThan(house.position.z);
  expect(
    spriteOf(backend, "structure:the-tavern:fire").position.z,
  ).toBeGreaterThan(house.position.z);
});

test("a repairing building keeps a repair bar mesh, a burning one has no flame mesh", async () => {
  const { canon } = setup();
  const { renderer, backend } = await mount(canon);
  const base = previewView();
  const repairing: WorldViewModel = {
    ...base,
    realms: {
      ...base.realms,
      mortal: base.realms.mortal.map((location) => ({
        ...location,
        buildings: location.buildings.map((building) =>
          building.id === "the-tavern"
            ? {
                id: building.id,
                name: building.name,
                locationId: building.locationId,
                status: "repairing" as const,
                inventory: [],
                repair: { progress: 1, required: 3 },
              }
            : building,
        ),
      })),
    },
  };

  await renderer.draw(repairing, "mortal");

  const names = backend.decor.children.map((child) => child.name);
  expect(names).toContain("repair:the-tavern");
  expect(names.some((name) => name.startsWith("flame:"))).toBe(false);
  expect(backend.layer.spriteFor("structure:the-tavern:fire")).toBeUndefined();
});

test("a legacy 64x80 actor and a 112x96 god-tall actor draw in one scene, each placed by its own pivot, inside the target", async () => {
  const { canon, problems } = setup({
    payload: mixedCellPayload(),
    atlases: MIXED_CELL_ATLASES,
  });
  const { renderer, backend } = await mount(canon, { decode: decodeWithTall });

  const base = viewWithZeus();
  const olympus = base.realms.olympus.map((location) => {
    const zeus = location.actors.find((actor) => actor.id === "zeus");
    if (zeus === undefined) return location;
    return {
      ...location,
      actors: [
        zeus,
        { ...zeus, id: "tall", sprite: TALL_SPRITE_ID, isDeity: false },
      ],
    };
  });
  const view: WorldViewModel = {
    ...base,
    realms: { ...base.realms, olympus },
  };
  await renderer.draw(view, "olympus");

  const place = locationPoints(olympus).get(olympus[0]?.id ?? "");
  if (place === undefined) throw new Error("the fixture has no place");
  const legacy = spriteOf(backend, "actor:zeus");
  const tall = spriteOf(backend, "actor:tall");
  expect(problems).toEqual([]);
  expect(legacy.frame?.name).toBe("0,0,64,80");
  expect(tall.frame?.name).toBe(`0,0,${TALL_CELL.width},${TALL_CELL.height}`);
  expect(tall.texture?.image).toMatchObject({ width: 448, height: 96 });

  // A sprite's centre is its foot moved to the pivot's centre-relative offset (y up).
  const legacyFoot = actorFoot(place, 0);
  const tallFoot = actorFoot(place, 1);
  expect([legacy.position.x, legacy.position.y]).toEqual([
    legacyFoot.x - 32 + 64 / 2,
    legacyFoot.y + 80 - 80 / 2,
  ]);
  expect([tall.position.x, tall.position.y]).toEqual([
    tallFoot.x - TALL_CELL.pivotX + TALL_CELL.width / 2,
    tallFoot.y + TALL_CELL.pivotY - TALL_CELL.height / 2,
  ]);
  // The feet sit where the layout says; the tall cell reaches 18 px below its foot, the legacy one none.
  const bottom = (centreY: number, height: number) => centreY - height / 2;
  expect(bottom(legacy.position.y, 80)).toBe(legacyFoot.y);
  expect(bottom(tall.position.y, TALL_CELL.height)).toBe(tallFoot.y - 18);

  // Both cells lie inside the camera's view of the target.
  const halfWidth = LOGICAL_SIZE.width / 2;
  const halfHeight = LOGICAL_SIZE.height / 2;
  for (const [sprite, w, h] of [
    [legacy, 64, 80],
    [tall, TALL_CELL.width, TALL_CELL.height],
  ] as const) {
    expect(sprite.position.x - w / 2).toBeGreaterThanOrEqual(-halfWidth);
    expect(sprite.position.x + w / 2).toBeLessThanOrEqual(halfWidth);
    expect(sprite.position.y + h / 2).toBeLessThanOrEqual(halfHeight);
    expect(sprite.position.y - h / 2).toBeGreaterThanOrEqual(-halfHeight);
  }
});

test("promoted Zeus (zeus-retro, 112x96) draws idle-south from the real published atlas inside the 736x928 target, beside an actor created before promotion that keeps zeus-sprite", async () => {
  const { canon, problems } = setup({
    payload: retroPayload(),
    atlases: RETRO_ATLASES,
  });
  const { renderer, backend, element } = await mount(canon);

  const base = viewWithZeus({}, "zeus-retro");
  const olympus = base.realms.olympus.map((location) => {
    const zeus = location.actors.find((actor) => actor.id === "zeus");
    if (zeus === undefined) return location;
    return {
      ...location,
      actors: [
        zeus,
        { ...zeus, id: "elder", sprite: "zeus-sprite", isDeity: false },
      ],
    };
  });
  const view: WorldViewModel = {
    ...base,
    realms: { ...base.realms, olympus },
  };
  await renderer.draw(view, "olympus");

  const place = locationPoints(olympus).get(olympus[0]?.id ?? "");
  if (place === undefined) throw new Error("the fixture has no place");
  const retro = spriteOf(backend, "actor:zeus");
  const elder = spriteOf(backend, "actor:elder");
  expect(problems).toEqual([]);
  // 1200x1300 available: integer zoom 1, so the canvas is the 736x928 target itself.
  expect([element.width, element.height]).toEqual([
    LOGICAL_SIZE.width,
    LOGICAL_SIZE.height,
  ]);
  expect(LOGICAL_SIZE).toEqual({ width: 736, height: 928 });
  // The real atlas: 136 cells of 112x96 in one row, idle/south first.
  expect(retro.texture?.image).toMatchObject({ width: 15232, height: 96 });
  expect(retro.frame?.name).toBe("0,0,112,96");
  expect(elder.frame?.name).toBe("0,0,64,80");
  expect(elder.texture?.image).toMatchObject({ width: 704, height: 80 });

  // Each is placed by its own pivot: (56,78) for the retro cell, (32,80) for the legacy one.
  const retroFoot = actorFoot(place, 0);
  const elderFoot = actorFoot(place, 1);
  expect([retro.position.x, retro.position.y]).toEqual([
    retroFoot.x - 56 + 112 / 2,
    retroFoot.y + 78 - 96 / 2,
  ]);
  expect([elder.position.x, elder.position.y]).toEqual([
    elderFoot.x - 32 + 64 / 2,
    elderFoot.y + 80 - 80 / 2,
  ]);

  // Both cells lie inside the camera's view of the 736x928 target.
  const halfWidth = LOGICAL_SIZE.width / 2;
  const halfHeight = LOGICAL_SIZE.height / 2;
  for (const [sprite, w, h] of [
    [retro, 112, 96],
    [elder, 64, 80],
  ] as const) {
    expect(sprite.position.x - w / 2).toBeGreaterThanOrEqual(-halfWidth);
    expect(sprite.position.x + w / 2).toBeLessThanOrEqual(halfWidth);
    expect(sprite.position.y + h / 2).toBeLessThanOrEqual(halfHeight);
    expect(sprite.position.y - h / 2).toBeGreaterThanOrEqual(-halfHeight);
  }
  // The retro atlas is the one the registry named, not a stand-in.
  expect(RETRO_ATLAS_HASH).toHaveLength(64);
});
