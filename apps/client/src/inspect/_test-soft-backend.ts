// Test support: a render backend that paints, in software, what the real
// layer holds. It is the real sprite layer with real sprites and textures;
// `readRenderTarget` composites each sprite's current frame from its texture
// over the background by the same alpha cutout the GPU material applies, and
// `readCanvas` is that target enlarged by the zoom the last `view` set. The
// optional offset shifts every sprite, which is how a test makes a frame land
// one pixel off.

import {
  createSceneLayer,
  type GpuBackend,
  type SceneLayer,
} from "@panthea/renderer";
import { Group, Scene } from "three";

import { INSPECT_BACKGROUND, type Rgba, upscale } from "./digest";

export interface SoftBackend extends GpuBackend {
  readonly log: string[];
  readonly views: { zoom: number }[];
  readonly layerStats: () => { sprites: number; textures: number };
}

export function softBackend(options: {
  size: { width: number; height: number };
  name?: string;
  offset?: { x: number; y: number };
}): SoftBackend {
  const { width, height } = options.size;
  const scene = new Scene();
  const base = createSceneLayer(scene);
  const decor = new Group();
  scene.add(decor);
  let ids: string[] = [];
  let painted: Rgba | undefined;
  let zoom = 1;
  const log: string[] = [];
  const views: { zoom: number }[] = [];
  const layer: SceneLayer = {
    group: base.group,
    plan: base.plan,
    commit: base.commit,
    apply(entries) {
      ids = entries.map((entry) => entry.instance.id);
      painted = undefined;
      return base.apply(entries);
    },
    tick: base.tick,
    spriteFor: base.spriteFor,
    spritesUsing: base.spritesUsing,
    get stats() {
      return base.stats;
    },
    dispose: base.dispose,
  };

  function paint(): Rgba {
    painted ??= composite();
    return painted;
  }

  function composite(): Rgba {
    const data = new Uint8Array(width * height * 4);
    for (let index = 0; index < data.length; index += 4) {
      data.set([...INSPECT_BACKGROUND, 255], index);
    }
    for (const id of ids) {
      const sprite = base.spriteFor(id);
      const frame = sprite?.frame;
      const atlas = sprite?.texture?.image as
        | { width: number; height: number; data: Uint8Array }
        | undefined;
      if (!sprite || !frame || atlas === undefined) {
        continue;
      }
      const w = frame.sourceWidth ?? 0;
      const h = frame.sourceHeight ?? 0;
      const left =
        Math.round(sprite.position.x - w / 2) + (options.offset?.x ?? 0);
      const top =
        Math.round(-sprite.position.y - h / 2) + (options.offset?.y ?? 0);
      const fromColumn = Math.round(frame.x * atlas.width);
      const fromRowBottom = Math.round(frame.y * atlas.height);
      for (let dy = 0; dy < h; dy += 1) {
        for (let dx = 0; dx < w; dx += 1) {
          const x = left + dx;
          const y = top + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          // The atlas is held bottom row first.
          const source =
            ((fromRowBottom + (h - 1 - dy)) * atlas.width + fromColumn + dx) *
            4;
          if ((atlas.data[source + 3] ?? 0) < 128) continue;
          data.set(
            atlas.data.subarray(source, source + 3),
            (y * width + x) * 4,
          );
        }
      }
    }
    return { width, height, data };
  }

  return {
    layer,
    decor,
    log,
    views,
    layerStats: () => base.stats,
    name: options.name ?? "webgl2",
    start() {
      log.push("start");
      return Promise.resolve();
    },
    view(next) {
      zoom = next.zoom;
      views.push({ zoom: next.zoom });
    },
    prepare() {
      log.push("prepare");
      return Promise.resolve();
    },
    render() {
      log.push("render");
    },
    readRenderTarget: () => Promise.resolve(paint()),
    readCanvas: () => Promise.resolve(upscale(paint(), zoom)),
    dispose() {
      log.push("dispose");
      scene.remove(decor);
      base.dispose();
    },
  };
}
