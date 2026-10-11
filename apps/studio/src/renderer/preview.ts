// The preview controller. It owns what has to survive a renderer: the items
// on show, their resolved assets, the validated atlas payloads, the zoom, the
// camera and the animation clock. The GPU sits behind `RenderBackend`, so
// every decision here (what to fetch, what to swap, when to rebuild, how to
// size the canvas, how to recover from device loss) runs under test with
// fakes. All work is serialised on one queue, so a change that arrives while
// the renderer is being rebuilt is applied once, afterwards.

import {
  type AtlasSpec,
  type CanvasMetrics,
  type Cell,
  canvasMetrics,
  composeScene,
  type DecodedImage,
  diamondImage,
  type Footprint,
  type Instance,
  type Layer,
  type LogicalSize,
  type PixelBuffer,
  type Point,
  type PreviewView,
  type RenderBackend,
  roundCamera,
  type SceneEntity,
  type SceneLayer,
  type SceneResolution,
  ZOOMS,
  type Zoom,
} from "@panthea/renderer";
import type {
  AssetProblem,
  AssetSource,
  ResolveRequest,
  Selection,
  SourceResolution,
} from "../source/port";

// What moved into @panthea/renderer and studio code still imports from here.
export {
  type CanvasMetrics,
  type PixelBuffer,
  type PreviewView,
  type RenderBackend,
  roundCamera,
  ZOOMS,
  type Zoom,
};

// The studio draws at a fixed 480x270.
export const LOGICAL_WIDTH = 480;
export const LOGICAL_HEIGHT = 270;
export const LOGICAL_SIZE: LogicalSize = {
  width: LOGICAL_WIDTH,
  height: LOGICAL_HEIGHT,
};

export type BackendFactory = (canvas: HTMLCanvasElement) => RenderBackend;

export interface PreviewHost {
  createCanvas(): HTMLCanvasElement;
  /** Puts `next` where `previous` was, or into the page when there is no previous canvas. */
  mount(next: HTMLCanvasElement, previous?: HTMLCanvasElement): void;
  unmount(canvas: HTMLCanvasElement): void;
}

export interface PreviewHandlers {
  onStarted?(): void;
  /** Called at most once; the preview draws nothing afterwards. */
  onFailure(message: string): void;
  onProblem?(problem: AssetProblem): void;
  onRender?(): void;
}

export type PreviewItem =
  | {
      readonly kind: "diamond";
      readonly id: string;
      readonly cell: Cell;
    }
  | {
      readonly kind: "sprite";
      readonly id: string;
      readonly layer: Layer;
      readonly cell: Cell;
      /** Declared footprint for a placeholder, which has none. */
      readonly footprint?: Footprint;
      readonly request: ResolveRequest;
    }
  | {
      /** A panel at a screen position, outside the iso scene. */
      readonly kind: "flat";
      readonly id: string;
      readonly at: Point;
      readonly request: ResolveRequest;
    };

export interface PreviewState {
  readonly items: readonly PreviewItem[];
  readonly zoom: Zoom;
  readonly camera: Point;
}

export interface PreviewOptions {
  readonly source: AssetSource;
  readonly host: PreviewHost;
  readonly createBackend: BackendFactory;
  /** Decodes PNG bytes into an image held bottom-row-first with straight alpha. */
  readonly decode: (bytes: Uint8Array) => Promise<DecodedImage>;
  readonly devicePixelRatio?: () => number;
  readonly handlers: PreviewHandlers;
  readonly zoom?: Zoom;
  readonly camera?: Point;
}

export interface Preview {
  readonly state: PreviewState;
  /** The instances currently on show, back to front. */
  readonly drawn: readonly Instance[];
  backendName(): string | undefined;
  /** Resolves when the scene shows these items, or the preview failed. */
  setItems(items: readonly PreviewItem[]): Promise<void>;
  setZoom(zoom: Zoom): void;
  setCamera(origin: Point): void;
  /** Re-reads the device pixel ratio and resizes the CSS box. */
  resize(): void;
  /** Sets the animation clock and redraws. */
  tick(elapsedMs: number): void;
  /** Resolves when all queued work has finished. */
  idle(): Promise<void>;
  readRenderTarget(): Promise<PixelBuffer>;
  readCanvas(): Promise<PixelBuffer>;
  dispose(): void;
}

const DIAMOND_KEY = "diamond";
const DIAMOND_SPEC: AtlasSpec = {
  pixelKey: DIAMOND_KEY,
  width: 64,
  height: 32,
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function atlasKeyOf(resolution: SourceResolution): string {
  return resolution.kind === "frames"
    ? `${resolution.selection.source}:${resolution.selection.id}`
    : `placeholder:${resolution.uri}`;
}

function specOf(resolution: SourceResolution): AtlasSpec {
  const { bytes } = resolution;
  return { pixelKey: bytes.pixelKey, width: bytes.width, height: bytes.height };
}

function sceneResolution(resolution: SourceResolution): SceneResolution {
  if (resolution.kind === "frames") {
    return { source: "canon", ...resolution.asset };
  }
  return {
    source: "placeholder",
    reason: resolution.reason,
    uri: resolution.uri,
    placeholder: {
      width: resolution.bytes.width,
      height: resolution.bytes.height,
    },
  };
}

const sameSpec = (a: AtlasSpec, b: AtlasSpec): boolean =>
  a.pixelKey === b.pixelKey && a.width === b.width && a.height === b.height;

interface Payload {
  readonly spec: AtlasSpec;
  readonly image: DecodedImage;
}

interface Live {
  readonly canvas: HTMLCanvasElement;
  readonly backend: RenderBackend;
}

export function createPreview(options: PreviewOptions): Preview {
  const { source, host, handlers } = options;
  const devicePixelRatio = options.devicePixelRatio ?? (() => 1);

  let items: readonly PreviewItem[] = [];
  let zoom: Zoom = options.zoom ?? 2;
  let camera: Point = roundCamera(options.camera ?? { x: 0, y: 0 });
  let elapsed = 0;
  const resolutions = new Map<string, SourceResolution>();
  const payloads = new Map<string, Payload>();
  let drawn: {
    instances: ReturnType<typeof composeScene>["instances"];
    keys: Map<string, string>;
  } = {
    instances: [],
    keys: new Map(),
  };
  const reported = new Set<string>();

  let live: Live | undefined;
  let ready = false;
  let recovering = false;
  let failed = false;
  let disposed = false;
  let tail: Promise<void> = Promise.resolve();

  const usable = () => !disposed && !failed;

  function fail(message: string): void {
    if (!usable()) return;
    failed = true;
    ready = false;
    live?.backend.dispose();
    handlers.onFailure(message);
  }

  function enqueue(task: () => Promise<void> | void): Promise<void> {
    const run = tail
      .then(async () => {
        if (usable()) await task();
      })
      .catch((error: unknown) => fail(messageOf(error)));
    tail = run;
    return run;
  }

  function report(scope: string, message: string): void {
    if (!usable()) return;
    const key = `${scope}\u0000${message}`;
    if (reported.has(key)) return;
    reported.add(key);
    handlers.onProblem?.({ scope, message });
  }

  function render(): void {
    if (!usable() || !ready || recovering || live === undefined) return;
    live.backend.render();
    handlers.onRender?.();
  }

  async function present(): Promise<void> {
    const backend = live?.backend;
    if (backend?.prepare === undefined) {
      render();
      return;
    }
    if (!usable() || !ready || recovering) return;
    await backend.prepare();
    if (!usable() || live?.backend !== backend) return;
    render();
  }

  function applyView(): void {
    if (live === undefined) return;
    const metrics = canvasMetrics(LOGICAL_SIZE, zoom, devicePixelRatio());
    const { canvas } = live;
    if (
      canvas.width !== metrics.backingWidth ||
      canvas.height !== metrics.backingHeight
    ) {
      canvas.width = metrics.backingWidth;
      canvas.height = metrics.backingHeight;
    }
    canvas.style.width = `${metrics.cssWidth}px`;
    canvas.style.height = `${metrics.cssHeight}px`;
    live.backend.view({ zoom, camera, metrics });
  }

  function open(previous: HTMLCanvasElement | undefined): Live {
    const canvas = host.createCanvas();
    host.mount(canvas, previous);
    try {
      const created: Live = { canvas, backend: options.createBackend(canvas) };
      live = created;
      return created;
    } catch (error) {
      host.unmount(canvas);
      throw error;
    }
  }

  function onDeviceLost(): void {
    if (!usable() || recovering) return;
    recovering = true;
    void enqueue(recover);
  }

  async function boot(): Promise<void> {
    const opened = open(undefined);
    await opened.backend.start(onDeviceLost);
    if (!usable()) return;
    ready = true;
    applyView();
    handlers.onStarted?.();
  }

  async function recover(): Promise<void> {
    const previous = live;
    ready = false;
    previous?.backend.dispose();
    const opened = open(previous?.canvas);
    await opened.backend.start(onDeviceLost);
    if (!usable()) return;
    for (const [key, payload] of payloads) {
      opened.backend.layer.commit(key, payload.spec, payload.image);
    }
    opened.backend.layer.tick(elapsed);
    ready = true;
    recovering = false;
    applyView();
    place(opened.backend.layer);
    await present();
  }

  function place(layer: SceneLayer): void {
    const entries = drawn.instances.flatMap((instance) => {
      const atlasKey = drawn.keys.get(instance.id);
      return atlasKey === undefined ? [] : [{ instance, atlasKey }];
    });
    const result = layer.apply(entries);
    for (const id of result.skipped) report(id, "its atlas could not be drawn");
  }

  const matches = (item: PreviewItem, selections: readonly Selection[]) =>
    item.kind !== "diamond" &&
    selections.some(
      (selection) =>
        selection.source === item.request.source &&
        selection.id === item.request.id,
    );

  async function resolveItem(item: PreviewItem): Promise<void> {
    if (item.kind === "diamond") return;
    try {
      const resolved = await source.resolve(item.request);
      if (usable()) resolutions.set(item.id, resolved);
    } catch (error) {
      resolutions.delete(item.id);
      report(item.id, messageOf(error));
    }
  }

  async function load(
    key: string,
    spec: AtlasSpec,
    users: readonly PreviewItem[],
    mayReresolve: boolean,
  ): Promise<DecodedImage | "retry" | undefined> {
    if (key === DIAMOND_KEY) return diamondImage();
    const retained = payloads.get(key);
    if (retained !== undefined && sameSpec(retained.spec, spec)) {
      return retained.image;
    }
    const resolution = resolutions.get(users[0]?.id ?? "");
    if (resolution === undefined) return undefined;
    try {
      return await options.decode(await source.fetchBytes(resolution.bytes));
    } catch (error) {
      if (mayReresolve) {
        await Promise.all(users.map(resolveItem));
        return "retry";
      }
      for (const user of users) report(user.id, messageOf(error));
      return undefined;
    }
  }

  async function redraw(mayReresolve = true): Promise<void> {
    const backend = live?.backend;
    if (backend === undefined) return;
    const entities: SceneEntity[] = [];
    const keyOfItem = new Map<string, string>();
    const specOfKey = new Map<string, AtlasSpec>();
    const usersOfKey = new Map<string, PreviewItem[]>();
    for (const item of items) {
      let key: string;
      if (item.kind === "diamond") {
        entities.push({ kind: "diamond", id: item.id, cell: item.cell });
        key = DIAMOND_KEY;
        specOfKey.set(key, DIAMOND_SPEC);
      } else {
        const resolution = resolutions.get(item.id);
        if (resolution === undefined) continue;
        entities.push(
          item.kind === "flat"
            ? {
                kind: "flat",
                id: item.id,
                at: item.at,
                resolution: sceneResolution(resolution),
              }
            : {
                kind: "sprite",
                id: item.id,
                layer: item.layer,
                cell: item.cell,
                ...(item.footprint === undefined
                  ? {}
                  : { footprint: item.footprint }),
                resolution: sceneResolution(resolution),
              },
        );
        key = atlasKeyOf(resolution);
        specOfKey.set(key, specOf(resolution));
      }
      keyOfItem.set(item.id, key);
      usersOfKey.set(key, [...(usersOfKey.get(key) ?? []), item]);
    }

    const composition = composeScene(entities);
    for (const refusal of composition.refused) {
      report(refusal.id, `${refusal.reason}: ${refusal.detail}`);
    }

    const unavailable = new Set<string>();
    let retry = false;
    for (const [key, spec] of specOfKey) {
      if (backend.layer.plan(key, spec) === "keep") continue;
      const image = await load(
        key,
        spec,
        usersOfKey.get(key) ?? [],
        mayReresolve,
      );
      if (!usable() || live?.backend !== backend) return;
      if (image === "retry") {
        retry = true;
        continue;
      }
      if (image === undefined) {
        unavailable.add(key);
        continue;
      }
      backend.layer.commit(key, spec, image);
      payloads.set(key, { spec, image });
    }
    if (retry) {
      await redraw(false);
      return;
    }

    for (const key of [...payloads.keys()]) {
      if (!specOfKey.has(key)) payloads.delete(key);
    }
    drawn = {
      instances: composition.instances.filter((instance) => {
        const key = keyOfItem.get(instance.id);
        return key !== undefined && !unavailable.has(key);
      }),
      keys: keyOfItem,
    };
    place(backend.layer);
    await present();
  }

  async function refresh(changed?: readonly Selection[]): Promise<void> {
    const targets = items.filter(
      (item) =>
        item.kind !== "diamond" &&
        (changed === undefined || matches(item, changed)),
    );
    if (changed !== undefined && targets.length === 0) return;
    await Promise.all(targets.map(resolveItem));
    if (!usable()) return;
    await redraw();
  }

  const unsubscribe = source.subscribe((change) => {
    if (!usable() || change.changed.length === 0) return;
    void enqueue(() => refresh(change.changed));
  });

  void enqueue(boot);

  function readback(
    read: (backend: RenderBackend) => Promise<PixelBuffer>,
  ): Promise<PixelBuffer> {
    return (async () => {
      await preview.idle();
      if (!usable() || !ready || live === undefined) {
        throw new Error("the preview has no live renderer to read from");
      }
      return read(live.backend);
    })();
  }

  const preview: Preview = {
    get state() {
      return { items, zoom, camera };
    },
    get drawn() {
      return drawn.instances;
    },
    backendName: () => live?.backend.name,
    setItems(next) {
      items = [...next];
      const ids = new Set(items.map((item) => item.id));
      for (const id of [...resolutions.keys()]) {
        if (!ids.has(id)) resolutions.delete(id);
      }
      reported.clear();
      return enqueue(() => refresh());
    },
    setZoom(next) {
      if (!ZOOMS.includes(next)) return;
      zoom = next;
      void enqueue(() => {
        applyView();
        render();
      });
    },
    setCamera(origin) {
      camera = roundCamera(origin);
      void enqueue(() => {
        applyView();
        render();
      });
    },
    resize() {
      void enqueue(() => {
        applyView();
        render();
      });
    },
    tick(elapsedMs) {
      if (!usable()) return;
      elapsed = elapsedMs;
      if (!ready || recovering || live === undefined) return;
      live.backend.layer.tick(elapsedMs);
      render();
    },
    async idle() {
      let seen: Promise<void>;
      do {
        seen = tail;
        await seen;
      } while (seen !== tail);
    },
    readRenderTarget: () => readback((backend) => backend.readRenderTarget()),
    readCanvas: () => readback((backend) => backend.readCanvas()),
    dispose() {
      if (disposed) return;
      disposed = true;
      ready = false;
      unsubscribe();
      live?.backend.dispose();
      if (live !== undefined) host.unmount(live.canvas);
    },
  };
  return preview;
}
