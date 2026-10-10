// The world renderer on the shared pixel core: a fixed-size target drawn at
// 1x with nearest filtering and no antialiasing, enlarged by a whole zoom.
// Actors are sprites resolved from canon (or the shared placeholder pixels);
// everything else is a mesh in the same pixel space (./decor).
//
// Atlas textures live in the core's reference-counted store, committed once
// per atlas and bound to the sprites that show them, never freed by a draw.
// The decoded atlases are held for the renderer's life, and the bytes behind
// them in the registry client's cache, so a renderer rebuilt after device
// loss asks the shell for nothing. A draw never throws on account of art: any
// canon failure draws the placeholder and is reported once.

import type { Atlas, Realm } from "@panthea/contracts";
import {
  type AtlasSpec,
  createGpuBackend,
  type DecodedImage,
  frameIndexAt,
  type GpuBackend,
  placeholderImage,
} from "@panthea/renderer";

import type { CanonClient } from "../assets/canon";
import { type AtlasDecoder, decodeAtlas, releaseImage } from "../assets/decode";
import type { WorldViewModel } from "../store";
import {
  type ActorItem,
  actorInstances,
  fallbackActor,
  planActors,
} from "./actors";
import { BACKGROUND, buildDecor, clearDecor } from "./decor";
import { CAMERA_ORIGIN, fitView, LOGICAL_SIZE, locationPoints } from "./layout";

export interface WorldRenderer {
  start(onDeviceLost: () => void): Promise<void>;
  /**
   * Draws `view`. Resolves, once the frame is on screen, with the ids of the
   * drawable events it showed (the ones a receipt may be sent for). A draw
   * superseded by a newer one before it renders, or one after disposal, shows
   * nothing and resolves with none.
   */
  draw(view: WorldViewModel, realm: Realm): Promise<readonly string[]>;
  /** Advances the animation clock by the render loop's frame delta, redrawing only when a frame changes. */
  tick(deltaMs: number): void;
  dispose(): void;
}

export type RendererFactory = (canvas: HTMLCanvasElement) => WorldRenderer;

export interface WorldRendererDeps {
  readonly canon: CanonClient;
  readonly createBackend?: (canvas: HTMLCanvasElement) => GpuBackend;
  readonly decode?: AtlasDecoder;
  readonly devicePixelRatio?: () => number;
  /** The CSS box the canvas is fitted into; defaults to the canvas's parent. */
  readonly available?: (canvas: HTMLCanvasElement) => {
    readonly width: number;
    readonly height: number;
  };
}

interface Payload {
  readonly key: string;
  readonly spec: AtlasSpec;
  readonly image: DecodedImage;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function defaultBackend(canvas: HTMLCanvasElement): GpuBackend {
  return createGpuBackend(canvas, {
    logicalSize: LOGICAL_SIZE,
    background: BACKGROUND,
  });
}

function defaultAvailable(canvas: HTMLCanvasElement) {
  const box = canvas.parentElement ?? canvas;
  return { width: box.clientWidth, height: box.clientHeight };
}

export function createWorldRenderer(
  canvas: HTMLCanvasElement,
  deps: WorldRendererDeps,
): WorldRenderer {
  const { canon } = deps;
  const backend = (deps.createBackend ?? defaultBackend)(canvas);
  const decode = deps.decode;
  const devicePixelRatio =
    deps.devicePixelRatio ?? (() => window.devicePixelRatio || 1);
  const available = deps.available ?? defaultAvailable;

  const payloads = new Map<string, Payload>();
  const loading = new Map<string, Promise<Payload | undefined>>();
  const undecodable = new Set<string>();
  let animated: { durations: number[]; loopStart: number | undefined }[] = [];
  let signature = "";
  let elapsed = 0;
  let generation = 0;
  let preparing = 0;
  let ready = false;
  let disposed = false;

  function applyView(): void {
    const fitted = fitView(available(canvas), devicePixelRatio());
    const { metrics } = fitted;
    if (
      canvas.width !== metrics.backingWidth ||
      canvas.height !== metrics.backingHeight
    ) {
      canvas.width = metrics.backingWidth;
      canvas.height = metrics.backingHeight;
    }
    canvas.style.width = `${metrics.cssWidth}px`;
    canvas.style.height = `${metrics.cssHeight}px`;
    canvas.style.left = `${fitted.left}px`;
    canvas.style.top = `${fitted.top}px`;
    canvas.style.imageRendering = "pixelated";
    backend.view({ zoom: fitted.zoom, camera: CAMERA_ORIGIN, metrics });
  }

  function onResize(): void {
    if (disposed || !ready) return;
    applyView();
    backend.render();
  }

  async function loadCanon(
    key: string,
    atlas: Atlas,
  ): Promise<Payload | undefined> {
    const bytes = await canon.atlas(atlas.blob);
    if (bytes === undefined) return undefined;
    try {
      const image = await decodeAtlas(bytes, atlas, decode);
      if (disposed) {
        releaseImage(image);
        return undefined;
      }
      const payload: Payload = {
        key,
        spec: {
          pixelKey: atlas.blob,
          width: atlas.width,
          height: atlas.height,
        },
        image,
      };
      payloads.set(key, payload);
      return payload;
    } catch (error) {
      undecodable.add(key);
      canon.report({ scope: `atlas:${atlas.blob}`, message: messageOf(error) });
      return undefined;
    }
  }

  function canonPayload(atlas: Atlas): Promise<Payload | undefined> {
    const key = `canon:${atlas.blob}`;
    const held = payloads.get(key);
    if (held !== undefined) return Promise.resolve(held);
    if (undecodable.has(key)) return Promise.resolve(undefined);
    let pending = loading.get(key);
    if (pending === undefined) {
      pending = loadCanon(key, atlas).finally(() => loading.delete(key));
      loading.set(key, pending);
    }
    return pending;
  }

  function placeholderPayload(
    pixels: Extract<ActorItem["art"], { source: "placeholder" }>["pixels"],
  ): Payload {
    // The client only ever draws the default placeholder, whose pixels are a
    // pure function of its size, so the size names the pixels.
    const pixelKey = `default:${pixels.width}x${pixels.height}`;
    const key = `placeholder:${pixelKey}`;
    let payload = payloads.get(key);
    if (payload === undefined) {
      payload = {
        key,
        spec: { pixelKey, width: pixels.width, height: pixels.height },
        image: placeholderImage(pixels),
      };
      payloads.set(key, payload);
    }
    return payload;
  }

  /** The item with its art settled: canon whose atlas loaded, otherwise the placeholder. */
  async function settle(
    item: ActorItem,
  ): Promise<{ item: ActorItem; payload: Payload }> {
    if (item.art.source === "canon") {
      const payload = await canonPayload(item.art.resolution.atlas);
      if (payload !== undefined) return { item, payload };
      const art = fallbackActor(item.actor.sprite);
      return {
        item: { ...item, art },
        payload: placeholderPayload(art.pixels),
      };
    }
    return { item, payload: placeholderPayload(item.art.pixels) };
  }

  const frameSignature = (): string =>
    animated
      .map((track) => frameIndexAt(track.durations, track.loopStart, elapsed))
      .join(",");

  async function draw(
    view: WorldViewModel,
    realm: Realm,
  ): Promise<readonly string[]> {
    if (disposed) return [];
    generation += 1;
    const mine = generation;
    const stale = () => disposed || mine !== generation;

    const { snapshot } = await canon.load();
    if (stale()) return [];
    const locations = view.realms[realm];
    const points = locationPoints(locations);
    const settled = await Promise.all(
      planActors(locations, points, snapshot).map(settle),
    );
    if (stale()) return [];

    // From here to the render there is no await: the scene changes in one step.
    const { layer, decor: group } = backend;
    const keys = new Map<string, string>();
    for (const { item, payload } of settled) {
      keys.set(item.id, payload.key);
      if (layer.plan(payload.key, payload.spec) !== "keep") {
        layer.commit(payload.key, payload.spec, payload.image);
      }
    }
    const { instances, dropped } = actorInstances(
      settled.map(({ item }) => item),
    );
    for (const id of dropped) {
      canon.report({
        scope: id,
        message: "no depth slot is left for this actor",
      });
    }
    const applied = layer.apply(
      instances.flatMap((instance) => {
        const atlasKey = keys.get(instance.id);
        return atlasKey === undefined ? [] : [{ instance, atlasKey }];
      }),
    );
    for (const id of applied.skipped) {
      canon.report({ scope: id, message: "its atlas could not be drawn" });
    }

    const fallen = new Map(
      settled
        .filter(({ item }) => !item.actor.alive)
        .map(({ item }) => [item.actor.id, item.foot] as const),
    );
    clearDecor(group);
    const decor = buildDecor(view, realm, locations, points, fallen);
    for (const object of decor.objects) group.add(object);

    animated = instances.flatMap((instance) =>
      instance.art.source === "canon" && instance.art.frames.length > 1
        ? [
            {
              durations: instance.art.frames.map((frame) => frame.durationMs),
              loopStart: instance.art.loopStart,
            },
          ]
        : [],
    );

    // New materials compile before the first frame that shows them.
    preparing += 1;
    try {
      await backend.prepare?.();
    } finally {
      preparing -= 1;
    }
    if (stale()) return [];
    backend.render();
    ready = true;
    signature = frameSignature();
    return decor.drawnEventIds;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("resize", onResize);
  }

  return {
    async start(onDeviceLost) {
      await Promise.all([backend.start(onDeviceLost), canon.load()]);
      if (disposed) return;
      applyView();
    },
    draw,
    tick(deltaMs) {
      if (disposed) return;
      if (Number.isFinite(deltaMs) && deltaMs > 0) elapsed += deltaMs;
      backend.layer.tick(elapsed);
      if (!ready || preparing > 0) return;
      const next = frameSignature();
      if (next === signature) return;
      signature = next;
      backend.render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      ready = false;
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", onResize);
      }
      clearDecor(backend.decor);
      backend.dispose();
      for (const payload of payloads.values()) releaseImage(payload.image);
      payloads.clear();
    },
  };
}

/** A factory for the scene host: each renderer shares the one registry client, so its cache outlives a device-loss remount. */
export function createWorldRendererFactory(
  deps: WorldRendererDeps,
): RendererFactory {
  return (canvas) => createWorldRenderer(canvas, deps);
}
