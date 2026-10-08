import { describe, expect, it } from "bun:test";
import { type RegistrySnapshot, resolveAsset } from "@panthea/assets";
import { spriteFixture } from "@panthea/assets/fixtures";
import { Scene, type Texture } from "three";
import type { Sprite2D } from "three-flatland";
import type {
  AssetSource,
  AtlasBytes,
  ResolveRequest,
  Selection,
  SourceChange,
  SourceResolution,
} from "../source/port";
import { createSceneLayer } from "./layer";
import {
  type BackendFactory,
  cameraBounds,
  canvasMetrics,
  createPreview,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type Preview,
  type PreviewHandlers,
  type PreviewHost,
  type PreviewItem,
  type RenderBackend,
  roundCamera,
} from "./preview";
import { type DecodedImage, type RawImage, rgbaImage } from "./textures";

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

const CANON: Selection = { source: "canon", id: "placeholder-zeus" };
const DRAFT: Selection = { source: "draft", id: "zeus-draft-1" };

interface FakeCanvas {
  width: number;
  height: number;
  readonly style: { width?: string; height?: string };
}

function fakeCanvas(): FakeCanvas {
  return { width: 300, height: 150, style: {} };
}

/** Bytes a fake decoder can read back: width, height and a pixel tag. */
function fakeBytes(width: number, height: number, tag: number): Uint8Array {
  return new Uint8Array([
    width >> 8,
    width & 255,
    height >> 8,
    height & 255,
    tag,
  ]);
}

function fakeDecode(bytes: Uint8Array): Promise<DecodedImage> {
  const width = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
  const height = ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4)
    rgba.set([bytes[4] ?? 0, 80, 160, 255], i);
  return Promise.resolve(rgbaImage(width, height, rgba));
}

interface Published {
  width: number;
  height: number;
  tag: number;
  pixelKey: string;
  manifestKey: string;
  pivot?: { x: number; y: number };
  placeholder?: boolean;
}

function published(overrides: Partial<Published> = {}): Published {
  return {
    width: god.manifest.atlas.width,
    height: god.manifest.atlas.height,
    tag: 1,
    pixelKey: "pixels-1",
    manifestKey: "manifest-1",
    ...overrides,
  };
}

const keyOf = (selection: Selection) => `${selection.source}:${selection.id}`;

class FakeSource implements AssetSource {
  readonly world = new Map<string, Published>();
  readonly files = new Map<string, Uint8Array>();
  readonly resolves: string[] = [];
  fetches = 0;
  failNextFetches = 0;
  listener: ((change: SourceChange) => void) | undefined;
  unsubscribed = 0;

  publish(selection: Selection, value: Published): void {
    this.world.set(keyOf(selection), value);
    this.files.set(
      `fake://${keyOf(selection)}/${value.pixelKey}`,
      fakeBytes(value.width, value.height, value.tag),
    );
  }

  emit(...changed: Selection[]): void {
    this.listener?.({ changed, listing: false });
  }

  list() {
    return Promise.resolve({ entries: [], problems: [] });
  }

  resolve(request: ResolveRequest): Promise<SourceResolution> {
    const selection = { source: request.source, id: request.id };
    this.resolves.push(keyOf(selection));
    const value = this.world.get(keyOf(selection));
    if (value === undefined)
      return Promise.reject(new Error("unknown selection"));
    const bytes: AtlasBytes = {
      url: `fake://${keyOf(selection)}/${value.pixelKey}`,
      width: value.width,
      height: value.height,
      pixelKey: value.pixelKey,
    };
    if (value.placeholder === true) {
      return Promise.resolve({
        kind: "placeholder",
        selection,
        reason: "missing-state",
        uri: `panthea-asset://placeholder/${value.pixelKey}`,
        problems: [],
        bytes,
      });
    }
    const resolved = resolveAsset(snapshot, { spriteId: god.manifest.id });
    if (resolved.source !== "canon") throw new Error("fixture did not resolve");
    const { source: _source, ...asset } = resolved;
    return Promise.resolve({
      kind: "frames",
      selection,
      manifestKey: value.manifestKey,
      asset: {
        ...asset,
        atlas: { ...asset.atlas, width: value.width, height: value.height },
        ...(value.pivot === undefined ? {} : { pivot: value.pivot }),
      },
      bytes,
    });
  }

  fetchBytes(bytes: AtlasBytes): Promise<Uint8Array> {
    this.fetches += 1;
    if (this.failNextFetches > 0) {
      this.failNextFetches -= 1;
      return Promise.reject(new Error("404"));
    }
    const file = this.files.get(bytes.url);
    return file === undefined
      ? Promise.reject(new Error("missing file"))
      : Promise.resolve(file);
  }

  subscribe(listener: (change: SourceChange) => void): () => void {
    this.listener = listener;
    return () => {
      this.unsubscribed += 1;
    };
  }
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

function deferred(): Deferred {
  let resolve = () => {};
  let reject = (_error: Error) => {};
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface BackendRecord {
  readonly canvas: FakeCanvas;
  readonly scene: Scene;
  readonly backend: RenderBackend;
  readonly views: {
    zoom: number;
    camera: { x: number; y: number };
    backingWidth: number;
    backingHeight: number;
  }[];
  renders: number;
  disposed: boolean;
  lose(): void;
  gate: Deferred | undefined;
}

class Harness {
  readonly source = new FakeSource();
  readonly backends: BackendRecord[] = [];
  readonly canvases: FakeCanvas[] = [];
  readonly mounts: { next: FakeCanvas; previous: FakeCanvas | undefined }[] =
    [];
  readonly unmounted: FakeCanvas[] = [];
  readonly failures: string[] = [];
  readonly problems: string[] = [];
  started = 0;
  throwOnCreate: Error | undefined;
  startFails: Error | undefined;
  /** Gates the next backend's start() until resolved. */
  nextGate: Deferred | undefined;
  dpr = 1;

  readonly host: PreviewHost = {
    createCanvas: () => {
      const canvas = fakeCanvas();
      this.canvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    },
    mount: (next, previous) => {
      this.mounts.push({
        next: next as unknown as FakeCanvas,
        previous: previous as unknown as FakeCanvas | undefined,
      });
    },
    unmount: (canvas) => {
      this.unmounted.push(canvas as unknown as FakeCanvas);
    },
  };

  readonly createBackend: BackendFactory = (canvas) => {
    if (this.throwOnCreate !== undefined) throw this.throwOnCreate;
    const scene = new Scene();
    const layer = createSceneLayer(scene);
    let onLost: (() => void) | undefined;
    const gate = this.nextGate;
    this.nextGate = undefined;
    const record: BackendRecord = {
      canvas: canvas as unknown as FakeCanvas,
      scene,
      views: [],
      renders: 0,
      disposed: false,
      gate,
      lose: () => onLost?.(),
      backend: {
        layer,
        async start(handler) {
          onLost = handler;
          if (gate !== undefined) await gate.promise;
        },
        view: (view) => {
          record.views.push({
            zoom: view.zoom,
            camera: view.camera,
            backingWidth: view.metrics.backingWidth,
            backingHeight: view.metrics.backingHeight,
          });
        },
        render: () => {
          record.renders += 1;
        },
        readRenderTarget: () =>
          Promise.resolve({
            width: LOGICAL_WIDTH,
            height: LOGICAL_HEIGHT,
            data: new Uint8Array(0),
          }),
        readCanvas: () =>
          Promise.resolve({ width: 0, height: 0, data: new Uint8Array(0) }),
        dispose: () => {
          record.disposed = true;
          layer.dispose();
        },
      },
    };
    const startFails = this.startFails;
    if (startFails !== undefined) {
      const original = record.backend.start.bind(record.backend);
      (record.backend as { start: RenderBackend["start"] }).start = async (
        handler,
      ) => {
        await original(handler);
        throw startFails;
      };
    }
    this.backends.push(record);
    return record.backend;
  };

  readonly handlers: PreviewHandlers = {
    onStarted: () => {
      this.started += 1;
    },
    onFailure: (message) => {
      this.failures.push(message);
    },
    onProblem: (problem) => {
      this.problems.push(`${problem.scope}: ${problem.message}`);
    },
  };

  preview(overrides: { zoom?: 2 | 3 | 4 } = {}): Preview {
    return createPreview({
      source: this.source,
      host: this.host,
      createBackend: this.createBackend,
      decode: fakeDecode,
      devicePixelRatio: () => this.dpr,
      handlers: this.handlers,
      ...overrides,
    });
  }

  get live(): BackendRecord {
    const record = this.backends[this.backends.length - 1];
    if (record === undefined) throw new Error("no backend yet");
    return record;
  }
}

const subject: PreviewItem = {
  kind: "sprite",
  id: "subject",
  layer: "actor",
  cell: { x: 2, y: 3, z: 0 },
  request: CANON,
};

function sprite(record: BackendRecord, id: string): Sprite2D {
  const found = record.backend.layer.spriteFor(id);
  if (found === undefined) throw new Error(`no sprite ${id}`);
  return found;
}

const pixel0 = (texture: Texture | null) =>
  texture === null ? undefined : (texture.image as RawImage).data[0];

describe("canvas sizing", () => {
  it.each([
    [2, 1, 960, 540, 960, 540],
    [3, 1, 1440, 810, 1440, 810],
    [4, 1, 1920, 1080, 1920, 1080],
    [2, 2, 960, 540, 480, 270],
    [4, 2, 1920, 1080, 960, 540],
    [2, 1.5, 960, 540, 640, 360],
    [3, 1.5, 1440, 810, 960, 540],
    [4, 1.5, 1920, 1080, 1280, 720],
  ])(
    "zoom %d at devicePixelRatio %d: backing %dx%d, CSS %dx%d",
    (zoom, dpr, bw, bh, cw, ch) => {
      expect(canvasMetrics(zoom as 2 | 3 | 4, dpr)).toEqual({
        backingWidth: bw,
        backingHeight: bh,
        cssWidth: cw,
        cssHeight: ch,
      });
    },
  );

  it("keeps the backing store an exact integer multiple at a fractional ratio, with only the CSS size fractional", () => {
    const metrics = canvasMetrics(3, 1.25);
    expect(metrics.backingWidth).toBe(LOGICAL_WIDTH * 3);
    expect(metrics.backingHeight).toBe(LOGICAL_HEIGHT * 3);
    expect(Number.isInteger(metrics.backingWidth)).toBe(true);
    expect(metrics.cssWidth).toBeCloseTo(1152, 9);
    expect(metrics.cssWidth * 1.25).toBeCloseTo(metrics.backingWidth, 9);
  });

  it("treats a missing or invalid devicePixelRatio as 1", () => {
    for (const dpr of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(canvasMetrics(2, dpr).cssWidth).toBe(960);
    }
  });
});

describe("camera", () => {
  it("rounds to whole logical pixels", () => {
    expect(roundCamera({ x: 10.4, y: -3.6 })).toEqual({ x: 10, y: -4 });
    expect(roundCamera({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("frames the fixed logical viewport from its top-left in screen space", () => {
    expect(cameraBounds({ x: -240, y: 20 })).toEqual({
      left: -240,
      right: 240,
      top: -20,
      bottom: -290,
    });
  });
});

describe("preview lifecycle", () => {
  it("starts a backend on a fresh canvas sized exactly logical size x zoom, then reports started once", async () => {
    const h = new Harness();
    const preview = h.preview();
    await preview.idle();
    expect(h.started).toBe(1);
    expect(h.failures).toEqual([]);
    expect(h.backends).toHaveLength(1);
    const canvas = h.live.canvas;
    expect([canvas.width, canvas.height]).toEqual([960, 540]);
    expect([canvas.style.width, canvas.style.height]).toEqual([
      "960px",
      "540px",
    ]);
    expect(h.mounts).toEqual([{ next: canvas, previous: undefined }]);
    preview.dispose();
  });

  it("sizes the CSS box from the device pixel ratio but keeps the backing store integral", async () => {
    const h = new Harness();
    h.dpr = 1.5;
    const preview = h.preview({ zoom: 3 });
    await preview.idle();
    const canvas = h.live.canvas;
    expect([canvas.width, canvas.height]).toEqual([1440, 810]);
    expect([canvas.style.width, canvas.style.height]).toEqual([
      "960px",
      "540px",
    ]);
    h.dpr = 2;
    preview.resize();
    await preview.idle();
    expect([canvas.width, canvas.height]).toEqual([1440, 810]);
    expect([canvas.style.width, canvas.style.height]).toEqual([
      "720px",
      "405px",
    ]);
    preview.dispose();
  });

  it("resizes 2x to 4x to exactly logical size x zoom without re-resolving or re-fetching", async () => {
    const h = new Harness();
    h.source.publish(CANON, published());
    const preview = h.preview({ zoom: 2 });
    await preview.setItems([subject]);
    const resolves = h.source.resolves.length;
    const fetches = h.source.fetches;
    const texture = sprite(h.live, "subject").texture;

    preview.setZoom(4);
    await preview.idle();

    const canvas = h.live.canvas;
    expect([canvas.width, canvas.height]).toEqual([
      LOGICAL_WIDTH * 4,
      LOGICAL_HEIGHT * 4,
    ]);
    expect(h.source.resolves).toHaveLength(resolves);
    expect(h.source.fetches).toBe(fetches);
    expect(sprite(h.live, "subject").texture).toBe(texture);
    expect(h.live.views.at(-1)).toMatchObject({
      zoom: 4,
      backingWidth: 1920,
      backingHeight: 1080,
    });
    preview.dispose();
  });

  it("hands the backend a camera rounded to whole logical pixels", async () => {
    const h = new Harness();
    const preview = h.preview();
    preview.setCamera({ x: -239.6, y: 12.2 });
    await preview.idle();
    expect(h.live.views.at(-1)?.camera).toEqual({ x: -240, y: 12 });
    expect(preview.state.camera).toEqual({ x: -240, y: 12 });
    preview.dispose();
  });

  it("reports a construction failure once and draws nothing afterwards", async () => {
    const h = new Harness();
    h.throwOnCreate = new Error("no WebGL");
    h.source.publish(CANON, published());
    const preview = h.preview();
    await preview.setItems([subject]);
    await preview.setItems([subject]);
    preview.setZoom(3);
    await preview.idle();
    expect(h.failures).toEqual(["no WebGL"]);
    expect(h.backends).toHaveLength(0);
    expect(h.source.resolves).toHaveLength(0);
    expect(h.started).toBe(0);
    preview.dispose();
  });

  it("reports a rejected start once and disposes the backend", async () => {
    const h = new Harness();
    h.startFails = new Error("adapter lost");
    const preview = h.preview();
    await preview.idle();
    await preview.setItems([]);
    expect(h.failures).toEqual(["adapter lost"]);
    expect(h.started).toBe(0);
    expect(h.live.disposed).toBe(true);
    preview.dispose();
  });
});

describe("preview scene", () => {
  it("resolves each item once, fetches each atlas once and draws the sprite at its depth z", async () => {
    const h = new Harness();
    h.source.publish(CANON, published());
    const preview = h.preview();
    await preview.setItems([
      subject,
      { ...subject, id: "twin", cell: { x: 4, y: 3, z: 0 } },
    ]);
    expect(h.source.resolves).toEqual([keyOf(CANON), keyOf(CANON)]);
    expect(h.source.fetches).toBe(1);
    expect(h.live.backend.layer.stats).toEqual({ sprites: 2, textures: 1 });
    expect(sprite(h.live, "twin").position.z).toBeGreaterThan(
      sprite(h.live, "subject").position.z,
    );
    expect(h.live.renders).toBeGreaterThan(0);
    expect(h.problems).toEqual([]);
    preview.dispose();
  });

  it("draws the ground diamond without asking the source", async () => {
    const h = new Harness();
    const preview = h.preview();
    await preview.setItems([
      { kind: "diamond", id: "g", cell: { x: 0, y: 0, z: 0 } },
    ]);
    expect(h.source.resolves).toEqual([]);
    expect(h.live.backend.layer.stats).toEqual({ sprites: 1, textures: 1 });
    preview.dispose();
  });

  it("reports a refused entity as a problem and still draws the rest", async () => {
    const h = new Harness();
    h.source.publish(CANON, published());
    const preview = h.preview();
    await preview.setItems([
      subject,
      { ...subject, id: "far", cell: { x: 500, y: 0, z: 0 } },
    ]);
    expect(h.live.backend.layer.stats.sprites).toBe(1);
    expect(h.problems).toHaveLength(1);
    expect(h.problems[0]).toContain("far");
    preview.dispose();
  });

  it("reports a source error as a problem and leaves that item out", async () => {
    const h = new Harness();
    const preview = h.preview();
    await preview.setItems([subject]);
    expect(h.live.backend.layer.stats.sprites).toBe(0);
    expect(h.problems[0]).toContain("subject");
    expect(h.failures).toEqual([]);
    preview.dispose();
  });

  it("draws a placeholder resolution on the placeholder atlas, shared by every user", async () => {
    const h = new Harness();
    const missing: Selection = { source: "canon", id: "no-such-sprite" };
    h.source.publish(
      missing,
      published({ width: 16, height: 16, placeholder: true, pixelKey: "ph" }),
    );
    const preview = h.preview();
    await preview.setItems([
      { ...subject, id: "a", request: missing },
      { ...subject, id: "b", request: missing, cell: { x: 5, y: 5, z: 0 } },
    ]);
    expect(h.live.backend.layer.stats).toEqual({ sprites: 2, textures: 1 });
    preview.dispose();
  });
});

describe("live reload", () => {
  async function started() {
    const h = new Harness();
    h.source.publish(CANON, published());
    const preview = h.preview();
    await preview.setItems([subject]);
    return { h, preview };
  }

  it("re-resolves only the changed selection and ignores unrelated changes", async () => {
    const { h, preview } = await started();
    h.source.publish(DRAFT, published());
    const before = h.source.resolves.length;
    h.source.emit(DRAFT);
    await preview.idle();
    expect(h.source.resolves).toHaveLength(before);
    h.source.emit(CANON);
    await preview.idle();
    expect(h.source.resolves).toHaveLength(before + 1);
    preview.dispose();
  });

  it("swaps pixels in place when the manifest key and atlas size are unchanged", async () => {
    const { h, preview } = await started();
    const before = sprite(h.live, "subject");
    const texture = before.texture as Texture;

    h.source.publish(CANON, published({ tag: 77, pixelKey: "pixels-2" }));
    h.source.emit(CANON);
    await preview.idle();

    expect(sprite(h.live, "subject")).toBe(before);
    expect(before.texture).toBe(texture);
    expect(pixel0(texture)).toBe(77);
    expect(h.live.backend.layer.stats).toEqual({ sprites: 1, textures: 1 });
    preview.dispose();
  });

  it("neither fetches nor touches the texture when only the pivot changed at the same atlas size", async () => {
    const { h, preview } = await started();
    const sprite0 = sprite(h.live, "subject");
    const texture = sprite0.texture as Texture;
    const fetches = h.source.fetches;
    const version = texture.version;
    const x = sprite0.position.x;

    h.source.publish(
      CANON,
      published({ manifestKey: "manifest-2", pivot: { x: 16, y: 70 } }),
    );
    h.source.emit(CANON);
    await preview.idle();

    expect(h.source.fetches).toBe(fetches);
    expect(texture.version).toBe(version);
    expect(sprite(h.live, "subject").texture).toBe(texture);
    expect(sprite(h.live, "subject").position.x).toBe(x + 16);
    preview.dispose();
  });

  it("rebuilds the texture and disposes the old one when the atlas size changes", async () => {
    const { h, preview } = await started();
    const old = sprite(h.live, "subject").texture as Texture;
    let disposed = 0;
    old.addEventListener("dispose", () => {
      disposed += 1;
    });

    h.source.publish(
      CANON,
      published({
        width: 512,
        pixelKey: "pixels-2",
        manifestKey: "manifest-2",
      }),
    );
    h.source.emit(CANON);
    await preview.idle();

    const fresh = sprite(h.live, "subject").texture as Texture;
    expect(fresh).not.toBe(old);
    expect(disposed).toBe(1);
    expect(h.live.backend.layer.stats).toEqual({ sprites: 1, textures: 1 });
    preview.dispose();
  });

  it("returns to the baseline after 20 reloads", async () => {
    const { h, preview } = await started();
    const baseline = h.live.backend.layer.stats;
    for (let i = 2; i <= 21; i += 1) {
      const wide = i % 2 === 0;
      h.source.publish(
        CANON,
        published({
          width: wide ? 512 : 256,
          tag: i,
          pixelKey: `pixels-${i}`,
          manifestKey: `manifest-${i}`,
        }),
      );
      h.source.emit(CANON);
      await preview.idle();
      expect(h.live.backend.layer.stats).toEqual(baseline);
    }
    expect(h.backends).toHaveLength(1);
    preview.dispose();
  });

  it("re-resolves and retries once when fetching the bytes fails", async () => {
    const { h, preview } = await started();
    h.source.publish(CANON, published({ tag: 5, pixelKey: "pixels-2" }));
    h.source.failNextFetches = 1;
    const resolves = h.source.resolves.length;
    h.source.emit(CANON);
    await preview.idle();
    expect(h.source.resolves).toHaveLength(resolves + 2);
    expect(pixel0(sprite(h.live, "subject").texture)).toBe(5);
    expect(h.problems).toEqual([]);
    preview.dispose();
  });

  it("reports a problem, without throwing, when the retry fails too", async () => {
    const { h, preview } = await started();
    h.source.publish(CANON, published({ tag: 5, pixelKey: "pixels-2" }));
    h.source.failNextFetches = 2;
    h.source.emit(CANON);
    await preview.idle();
    expect(h.problems.some((problem) => problem.includes("subject"))).toBe(
      true,
    );
    expect(h.failures).toEqual([]);
    preview.dispose();
  });

  it("applies a change that arrives before the first draw after the draw", async () => {
    const h = new Harness();
    h.source.publish(CANON, published());
    const gate = deferred();
    h.nextGate = gate;
    const preview = h.preview();
    const first = preview.setItems([subject]);
    h.source.publish(CANON, published({ tag: 9, pixelKey: "pixels-2" }));
    h.source.emit(CANON);
    gate.resolve();
    await first;
    await preview.idle();
    expect(pixel0(sprite(h.live, "subject").texture)).toBe(9);
    preview.dispose();
  });
});

describe("device loss", () => {
  async function started(zoom: 2 | 3 | 4 = 3) {
    const h = new Harness();
    h.source.publish(CANON, published());
    const preview = h.preview({ zoom });
    await preview.setItems([
      subject,
      { kind: "diamond", id: "g", cell: { x: 2, y: 3, z: 0 } },
    ]);
    return { h, preview };
  }

  it("rebuilds on a fresh canvas and a new backend from retained state, without refetching", async () => {
    const { h, preview } = await started(4);
    preview.setCamera({ x: -100, y: 10 });
    await preview.idle();
    const first = h.live;
    const fetches = h.source.fetches;
    const resolves = h.source.resolves.length;

    first.lose();
    await preview.idle();

    expect(h.backends).toHaveLength(2);
    const second = h.live;
    expect(first.disposed).toBe(true);
    expect(second.canvas).not.toBe(first.canvas);
    expect(h.mounts.at(-1)).toEqual({
      next: second.canvas,
      previous: first.canvas,
    });
    expect([second.canvas.width, second.canvas.height]).toEqual([1920, 1080]);
    expect(second.views.at(-1)).toMatchObject({
      zoom: 4,
      camera: { x: -100, y: 10 },
    });
    expect(second.backend.layer.stats).toEqual({ sprites: 2, textures: 2 });
    expect(h.source.fetches).toBe(fetches);
    expect(h.source.resolves).toHaveLength(resolves);
    expect(second.renders).toBeGreaterThan(0);
    expect(h.failures).toEqual([]);
    expect(h.started).toBe(1);
    preview.dispose();
  });

  it("recovers once per loss however many times the loss is signalled", async () => {
    const { h, preview } = await started();
    const first = h.live;
    first.lose();
    first.lose();
    first.lose();
    await preview.idle();
    expect(h.backends).toHaveLength(2);

    h.live.lose();
    await preview.idle();
    expect(h.backends).toHaveLength(3);
    preview.dispose();
  });

  it("applies a change that arrives during the rebuild to the rebuilt scene exactly once", async () => {
    const { h, preview } = await started();
    const first = h.live;
    const gate = deferred();
    h.nextGate = gate;
    first.lose();
    await Promise.resolve();

    h.source.publish(CANON, published({ tag: 42, pixelKey: "pixels-2" }));
    const resolves = h.source.resolves.length;
    h.source.emit(CANON);
    gate.resolve();
    await preview.idle();

    expect(h.source.resolves).toHaveLength(resolves + 1);
    expect(h.backends).toHaveLength(2);
    expect(pixel0(sprite(h.live, "subject").texture)).toBe(42);
    expect(h.live.backend.layer.stats).toEqual({ sprites: 2, textures: 2 });
    expect(first.backend.layer.stats).toEqual({ sprites: 0, textures: 0 });
    expect(h.failures).toEqual([]);
    preview.dispose();
  });

  it("reports a failed recovery once and stops drawing", async () => {
    const { h, preview } = await started();
    h.throwOnCreate = new Error("context creation failed");
    h.live.lose();
    await preview.idle();
    h.live.lose();
    preview.setZoom(2);
    await preview.idle();
    expect(h.failures).toEqual(["context creation failed"]);
    preview.dispose();
  });
});

describe("dispose", () => {
  it("unsubscribes, disposes the backend and unmounts the canvas", async () => {
    const h = new Harness();
    h.source.publish(CANON, published());
    const preview = h.preview();
    await preview.setItems([subject]);
    const record = h.live;
    preview.dispose();
    expect(h.source.unsubscribed).toBe(1);
    expect(record.disposed).toBe(true);
    expect(h.unmounted).toEqual([record.canvas]);
    preview.dispose();
    expect(h.source.unsubscribed).toBe(1);
  });

  it("ignores change events, device loss and calls after dispose", async () => {
    const h = new Harness();
    h.source.publish(CANON, published());
    const preview = h.preview();
    await preview.setItems([subject]);
    const record = h.live;
    const resolves = h.source.resolves.length;
    const renders = record.renders;
    preview.dispose();

    h.source.emit(CANON);
    record.lose();
    await preview.setItems([subject]);
    preview.setZoom(4);
    preview.setCamera({ x: 5, y: 5 });
    preview.tick(100);
    preview.resize();
    await preview.idle();

    expect(h.source.resolves).toHaveLength(resolves);
    expect(h.backends).toHaveLength(1);
    expect(record.renders).toBe(renders);
    expect(h.failures).toEqual([]);
    expect(record.canvas.width).not.toBe(LOGICAL_WIDTH * 4);
  });

  it("ignores a change delivered after an HMR teardown unsubscribed the source", async () => {
    const h = new Harness();
    h.source.publish(CANON, published());
    const preview = h.preview();
    await preview.setItems([subject]);
    preview.dispose();
    const resolves = h.source.resolves.length;
    h.source.emit(CANON);
    await preview.idle();
    expect(h.source.resolves).toHaveLength(resolves);
  });

  it("stays silent when dispose lands while the backend is still starting", async () => {
    const h = new Harness();
    const gate = deferred();
    h.nextGate = gate;
    const preview = h.preview();
    await Promise.resolve();
    preview.dispose();
    gate.resolve();
    await preview.idle();
    expect(h.started).toBe(0);
    expect(h.failures).toEqual([]);
    expect(h.live.disposed).toBe(true);
  });
});

describe("animation clock", () => {
  it("advances sprite frames and redraws", async () => {
    const h = new Harness();
    h.source.publish(CANON, published());
    const preview = h.preview();
    await preview.setItems([subject]);
    const renders = h.live.renders;
    preview.tick(170);
    expect(sprite(h.live, "subject").frame?.x).toBe(0.25);
    expect(h.live.renders).toBe(renders + 1);
    preview.dispose();
  });
});
