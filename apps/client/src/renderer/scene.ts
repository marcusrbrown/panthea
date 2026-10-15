// The world renderer on the shared pixel core: a fixed-size target drawn at
// 1x with nearest filtering and no antialiasing, enlarged by a whole zoom.
// Actors, buildings and fire are sprites resolved from canon (or the shared
// placeholder pixels); rings and bars are meshes in the same pixel
// space (./decor).
//
// A strike is an effect sprite that plays once over the building the world
// struck, on the renderer's own animation clock from the draw that first
// presents its event. Which events play is decided from the committed events
// alone (an ignition by a strike, or any damage); the effects setting only
// picks which published animation plays.
//
// Atlas textures live in the core's reference-counted store, committed once
// per atlas and bound to the sprites that show them, never freed by a draw.
// The decoded atlases are held for the renderer's life, and the bytes behind
// them in the registry client's cache, so a renderer rebuilt after device
// loss asks the shell for nothing. A draw never throws on account of art: any
// canon failure draws the placeholder and is reported once.

import {
  type CanonResolution,
  resolveAssetPixels,
} from "@panthea/assets/browser";
import type { Atlas, Realm, RecentEvent } from "@panthea/contracts";
import {
  type AtlasSpec,
  createGpuBackend,
  type DecodedImage,
  type EffectsMode,
  frameIndexAt,
  type GpuBackend,
  type LayerEntry,
  oneShotFrameAt,
  placeholderImage,
  STRIKE_ASSET,
  STRUCTURE_ANCHORS,
  strikeAnimation,
} from "@panthea/renderer";

import type { CanonClient } from "../assets/canon";
import { type AtlasDecoder, decodeAtlas, releaseImage } from "../assets/decode";
import type { WorldViewModel } from "../store";
import {
  type ActorArt,
  actorInstances,
  fallbackActor,
  planActors,
  type SpriteItem,
  spriteInstances,
} from "./actors";
import { BACKGROUND, buildDecor, clearDecor } from "./decor";
import {
  CAMERA_ORIGIN,
  fitView,
  LOGICAL_SIZE,
  type WorldPoint,
} from "./layout";
import { placeEvents } from "./presentation";
import { planStructures, structureArtOf } from "./structures";

export interface WorldRenderer {
  start(onDeviceLost: () => void): Promise<void>;
  /**
   * Draws the place `locationId` of `realm` in `view`, and no other: its
   * buildings, inhabitants and event rings, and strikes on its buildings; with
   * no place, the empty ground. Resolves, once the frame is on screen, with the
   * ids of the drawable events at that place it showed (the ones a receipt may be sent for). A draw
   * superseded by a newer one before it renders, or one after disposal, shows
   * nothing and resolves with none.
   */
  draw(
    view: WorldViewModel,
    realm: Realm,
    locationId: string | undefined,
  ): Promise<readonly string[]>;
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
  /** The player's effects setting, read when a strike starts; defaults to the full strike. */
  readonly effects?: () => EffectsMode;
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

/** A strike that is playing: its canon art, and the renderer clock reading it started at. */
interface Bolt {
  readonly eventId: string;
  readonly buildingId: string;
  readonly startedAt: number;
  readonly resolution: CanonResolution;
  readonly payload: Payload;
}

/** The world emits `building-damaged` only from a strike; an ignition is a strike only when its cause says so. */
const isStrike = (event: RecentEvent): boolean =>
  event.kind === "building-damaged" ||
  (event.kind === "building-ignited" && event.cause === "strike");

const boltDurations = (bolt: Bolt): number[] =>
  bolt.resolution.frames.map((frame) => frame.durationMs);

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
  const effects = deps.effects ?? ((): EffectsMode => "full");

  const payloads = new Map<string, Payload>();
  const loading = new Map<string, Promise<Payload | undefined>>();
  const undecodable = new Set<string>();
  let animated: { durations: number[]; loopStart: number | undefined }[] = [];
  // The strikes playing, and what the layer shows apart from them: they are
  // re-applied over `base` whenever a strike's frame changes or it ends.
  let bolts: Bolt[] = [];
  let base: LayerEntry[] = [];
  let strikeTargets = new Map<
    string,
    { readonly foot: WorldPoint; readonly strike: WorldPoint }
  >();
  // The events already presented, so none plays twice: the window of the last
  // draw. The first draw only marks it; a renderer that replaces a lost one
  // starts here, so a remount replays nothing.
  const seen = new Set<string>();
  let primed = false;
  let signature = "";
  let elapsed = 0;
  let generation = 0;
  let compiling = false;
  let recompile = false;
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
    pixels: Extract<ActorArt, { source: "placeholder" }>["pixels"],
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

  /** The item with its art settled: canon whose atlas loaded, otherwise the placeholder. `sprite` names what the item draws. */
  async function settle<T extends SpriteItem>(
    item: T,
    sprite: string,
  ): Promise<{ item: T; payload: Payload }> {
    if (item.art.source === "canon") {
      const payload = await canonPayload(item.art.resolution.atlas);
      if (payload !== undefined) return { item, payload };
      const art = fallbackActor(sprite);
      return {
        item: { ...item, art },
        payload: placeholderPayload(art.pixels),
      };
    }
    return { item, payload: placeholderPayload(item.art.pixels) };
  }

  /**
   * Compiles the scene's new materials without blocking a frame, then renders
   * once more with them. One compile runs at a time; a scene change meanwhile
   * queues exactly one more, so a stream of views cannot stack compiles.
   */
  function compileBehind(): void {
    if (backend.prepare === undefined) return;
    if (compiling) {
      recompile = true;
      return;
    }
    compiling = true;
    void (async () => {
      do {
        recompile = false;
        try {
          await backend.prepare?.();
        } catch (error) {
          canon.report({ scope: "compile", message: messageOf(error) });
          break;
        }
        if (disposed) break;
        backend.render();
      } while (recompile);
      compiling = false;
    })();
  }

  const boltFrame = (bolt: Bolt): number | undefined =>
    oneShotFrameAt(boltDurations(bolt), elapsed - bolt.startedAt);

  const frameSignature = (): string =>
    `${animated
      .map((track) => frameIndexAt(track.durations, track.loopStart, elapsed))
      .join(",")}|${bolts.map((bolt) => boltFrame(bolt) ?? "end").join(",")}`;

  /** The strike for `mode`, with its atlas loaded; undefined when it is not published or its atlas cannot be had. */
  async function strikeArt(
    snapshot: Parameters<typeof resolveAssetPixels>[0],
    mode: EffectsMode,
  ): Promise<{ resolution: CanonResolution; payload: Payload } | undefined> {
    const resolved = resolveAssetPixels(snapshot, {
      spriteId: STRIKE_ASSET,
      animation: strikeAnimation(mode),
    });
    if (resolved.source !== "canon") return undefined;
    const payload = await canonPayload(resolved.atlas);
    return payload === undefined
      ? undefined
      : { resolution: resolved, payload };
  }

  /** The layer shows `base` and every strike still playing, each at its frame; finished strikes are dropped. */
  function applyLayer(): void {
    bolts = bolts.filter((bolt) => boltFrame(bolt) !== undefined);
    const { layer } = backend;
    const items = bolts.flatMap((bolt) => {
      const frame = bolt.resolution.frames[boltFrame(bolt) ?? -1];
      const target = strikeTargets.get(bolt.buildingId);
      if (frame === undefined || target === undefined) return [];
      return [
        {
          bolt,
          item: {
            id: `effect:bolt:${bolt.eventId}`,
            foot: target.strike,
            depthFoot: target.foot,
            art: {
              source: "canon" as const,
              resolution: { ...bolt.resolution, frames: [frame] },
            },
          },
        },
      ];
    });
    const { instances, dropped } = spriteInstances(
      items.map(({ item }) => item),
      "effect",
    );
    for (const id of dropped) {
      canon.report({
        scope: id,
        message: "no depth slot is left for this strike",
      });
    }
    const atlasOf = new Map(
      items.map(({ bolt, item }) => [item.id, bolt.payload] as const),
    );
    const entries = instances.flatMap((instance) => {
      const payload = atlasOf.get(instance.id);
      if (payload === undefined) return [];
      if (layer.plan(payload.key, payload.spec) !== "keep") {
        layer.commit(payload.key, payload.spec, payload.image);
      }
      return [{ instance, atlasKey: payload.key }];
    });
    const applied = layer.apply([...base, ...entries]);
    for (const id of applied.skipped) {
      canon.report({ scope: id, message: "its atlas could not be drawn" });
    }
  }

  async function draw(
    view: WorldViewModel,
    realm: Realm,
    locationId: string | undefined,
  ): Promise<readonly string[]> {
    if (disposed) return [];
    generation += 1;
    const mine = generation;
    const stale = () => disposed || mine !== generation;

    const { snapshot } = await canon.load();
    if (stale()) return [];
    const place = view.realms[realm].find(
      (location) => location.id === locationId,
    );
    // The strikes this draw would start: events not yet presented, on a
    // building at the followed place. Nothing is marked seen until the draw is
    // known to be the one that presents.
    const fresh = primed
      ? placeEvents(view, realm).filter(
          (placed) =>
            placed.locationId === place?.id &&
            placed.buildingId !== undefined &&
            isStrike(placed.event) &&
            !seen.has(placed.event.id),
        )
      : [];
    const [settled, settledStructures, striking] = await Promise.all([
      Promise.all(
        planActors(place, snapshot).map((item) =>
          settle(item, item.actor.sprite),
        ),
      ),
      Promise.all(
        planStructures(place, snapshot).map((item) =>
          settle(item, item.assetId),
        ),
      ),
      fresh.length > 0 ? strikeArt(snapshot, effects()) : undefined,
    ]);
    if (stale()) return [];

    // This draw presents: every event of the window is now seen, whatever its
    // place or realm, so following another place replays nothing, and the
    // strikes it starts begin on the renderer's clock.
    if (striking !== undefined) {
      for (const placed of fresh) {
        if (placed.buildingId === undefined) continue;
        bolts.push({
          eventId: placed.event.id,
          buildingId: placed.buildingId,
          startedAt: elapsed,
          ...striking,
        });
      }
    }
    const inWindow = new Set<string>(
      view.recentEvents.map((event) => event.id),
    );
    for (const id of inWindow) seen.add(id);
    for (const id of [...seen]) if (!inWindow.has(id)) seen.delete(id);
    primed = true;

    // From here to the render there is no await: the scene changes in one step.
    const { layer, decor: group } = backend;
    const keys = new Map<string, string>();
    for (const { item, payload } of [...settled, ...settledStructures]) {
      keys.set(item.id, payload.key);
      if (layer.plan(payload.key, payload.spec) !== "keep") {
        layer.commit(payload.key, payload.spec, payload.image);
      }
    }
    const actors = actorInstances(settled.map(({ item }) => item));
    const structures = spriteInstances(
      settledStructures.map(({ item }) => item),
      "structure",
    );
    const instances = [...structures.instances, ...actors.instances];
    for (const id of [...actors.dropped, ...structures.dropped]) {
      canon.report({
        scope: id,
        message: "no depth slot is left for this actor",
      });
    }
    base = instances.flatMap((instance) => {
      const atlasKey = keys.get(instance.id);
      return atlasKey === undefined ? [] : [{ instance, atlasKey }];
    });
    strikeTargets = new Map(
      settledStructures.flatMap(({ item }) => {
        if (item.role !== "building") return [];
        const anchor =
          STRUCTURE_ANCHORS[structureArtOf(item.building.id)].strike;
        return [
          [
            item.building.id,
            {
              foot: item.foot,
              // The anchor is an offset down the screen; the layout's y points up.
              strike: { x: item.foot.x + anchor.x, y: item.foot.y - anchor.y },
            },
          ] as const,
        ];
      }),
    );
    applyLayer();

    const fallen = new Map(
      settled
        .filter(({ item }) => !item.actor.alive)
        .map(({ item }) => [item.actor.id, item.foot] as const),
    );
    clearDecor(group);
    const decor = buildDecor(view, realm, place, fallen);
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

    // Present at once; never wait on the compile. The backend's async compile
    // (`prepare`) yields to the main thread once per object, through
    // animation frames where there is no scheduler.yield (WKWebView), so with
    // a few hundred decor meshes it outlasts the next committed frame, and in a
    // hidden or occluded window it never settles. Gating the frame on it left
    // every draw superseded before it presented: a blank stage. A frame
    // rendered ahead of the compile can omit materials still compiling, so the
    // compile runs behind it and renders the scene again when it settles.
    backend.render();
    ready = true;
    signature = frameSignature();
    compileBehind();
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
      if (!ready) return;
      if (frameSignature() === signature) return;
      // A strike changed frame or ended: show it, then note what is shown.
      applyLayer();
      signature = frameSignature();
      backend.render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      ready = false;
      bolts = [];
      base = [];
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
