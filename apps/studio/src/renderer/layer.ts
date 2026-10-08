// The sprite layer of one renderer: one SpriteGroup, one Sprite2D per scene
// instance, and the texture store that backs them. Instances come from
// scene.ts; atlases are committed by key before they are applied. Nothing here
// touches a GPU, so it runs under test with real sprites and DataTextures.

import type { Object3D } from "three";
import { Sprite2D, type SpriteFrame, SpriteGroup } from "three-flatland";
import type { Instance } from "./scene";
import {
  type AtlasEntry,
  type AtlasSpec,
  atlasFrame,
  type CommitResult,
  createTextureStore,
  type DecodedImage,
  type ReloadDecision,
} from "./textures";

export interface LayerEntry {
  readonly instance: Instance;
  /** The key the instance's atlas was committed under. */
  readonly atlasKey: string;
}

export interface ApplyResult {
  readonly drawn: number;
  /** Ids that could not be drawn: no committed atlas, or frames outside it. */
  readonly skipped: readonly string[];
}

export interface SceneLayer {
  readonly group: SpriteGroup;
  plan(key: string, spec: AtlasSpec): ReloadDecision;
  commit(key: string, spec: AtlasSpec, image: DecodedImage): CommitResult;
  /** Makes the layer show exactly these instances. */
  apply(entries: readonly LayerEntry[]): ApplyResult;
  /** Sets the playback clock and selects each animated sprite's frame. */
  tick(elapsedMs: number): void;
  spriteFor(id: string): Sprite2D | undefined;
  spritesUsing(texture: unknown): readonly Sprite2D[];
  readonly stats: { readonly sprites: number; readonly textures: number };
  dispose(): void;
}

/** Index of the frame showing at `elapsedMs`; after the first pass it loops from `loopStart`. */
export function frameIndexAt(
  durations: readonly number[],
  loopStart: number | undefined,
  elapsedMs: number,
): number {
  const count = durations.length;
  if (count <= 1) return 0;
  const time = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const length = (from: number) => {
    let sum = 0;
    for (let i = from; i < count; i += 1) sum += Math.max(0, durations[i] ?? 0);
    return sum;
  };
  const walk = (from: number, within: number) => {
    let remaining = within;
    for (let i = from; i < count; i += 1) {
      remaining -= Math.max(0, durations[i] ?? 0);
      if (remaining < 0) return i;
    }
    return count - 1;
  };
  const total = length(0);
  if (total <= 0) return 0;
  if (time < total) return walk(0, time);
  const start = Math.min(Math.max(0, loopStart ?? 0), count - 1);
  const cycle = length(start);
  return cycle <= 0 ? start : walk(start, (time - total) % cycle);
}

/** World position of the sprite centre: x right, y up, z the depth key. */
export function layerPosition(instance: Instance): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: instance.x + instance.w / 2,
    y: -(instance.y + instance.h / 2),
    z: instance.z,
  };
}

interface FrameTrack {
  readonly frames: readonly SpriteFrame[];
  readonly durations: readonly number[];
  readonly loopStart: number | undefined;
  readonly signature: string;
}

function trackOf(instance: Instance, spec: AtlasSpec): FrameTrack {
  const { art } = instance;
  if (art.source === "canon") {
    const durations = art.frames.map((frame) => frame.durationMs);
    return {
      frames: art.frames.map((frame) => atlasFrame(frame.rect, spec)),
      durations,
      loopStart: art.loopStart,
      signature: JSON.stringify([
        art.frames.map((frame) => [
          frame.rect.x,
          frame.rect.y,
          frame.rect.w,
          frame.rect.h,
          frame.durationMs,
        ]),
        art.loopStart ?? null,
        instance.w,
        instance.h,
      ]),
    };
  }
  return {
    frames: [atlasFrame({ x: 0, y: 0, w: spec.width, h: spec.height }, spec)],
    durations: [1],
    loopStart: undefined,
    signature: JSON.stringify([
      spec.width,
      spec.height,
      instance.w,
      instance.h,
    ]),
  };
}

interface Drawn {
  readonly sprite: Sprite2D;
  readonly atlas: AtlasEntry;
  readonly track: FrameTrack;
  frameIndex: number;
}

export function createSceneLayer(scene: Object3D): SceneLayer {
  const group = new SpriteGroup();
  const store = createTextureStore();
  const drawn = new Map<string, Drawn>();
  let elapsed = 0;
  let disposed = false;
  scene.add(group);

  function place(sprite: Sprite2D, instance: Instance): void {
    const at = layerPosition(instance);
    sprite.position.set(at.x, at.y, at.z);
  }

  function showFrame(entry: Drawn): void {
    const index = frameIndexAt(
      entry.track.durations,
      entry.track.loopStart,
      elapsed,
    );
    if (index === entry.frameIndex) return;
    entry.frameIndex = index;
    const frame = entry.track.frames[index];
    if (frame !== undefined) entry.sprite.setFrame(frame);
  }

  function detach(id: string): void {
    const entry = drawn.get(id);
    if (entry === undefined) return;
    drawn.delete(id);
    group.remove(entry.sprite);
    entry.sprite.dispose();
  }

  return {
    group,
    plan: (key, spec) => store.plan(key, spec),
    commit(key, spec, image) {
      if (disposed) throw new Error("the layer was disposed");
      return store.commit(key, spec, image);
    },
    apply(entries) {
      if (disposed) return { drawn: 0, skipped: [] };
      const skipped: string[] = [];
      const present = new Set<string>();
      for (const { instance, atlasKey } of entries) {
        const atlas = store.entry(atlasKey);
        if (atlas === undefined) {
          skipped.push(instance.id);
          continue;
        }
        let track: FrameTrack;
        try {
          track = trackOf(instance, atlas.spec);
        } catch {
          skipped.push(instance.id);
          continue;
        }
        present.add(instance.id);
        const existing = drawn.get(instance.id);
        if (
          existing !== undefined &&
          existing.atlas === atlas &&
          existing.track.signature === track.signature
        ) {
          place(existing.sprite, instance);
          continue;
        }
        detach(instance.id);
        const index = frameIndexAt(track.durations, track.loopStart, elapsed);
        const sprite = new Sprite2D({
          texture: atlas.texture,
          material: atlas.material,
          frame: track.frames[index] ?? track.frames[0],
          anchor: [0.5, 0.5],
          lit: false,
          receiveShadows: false,
        });
        place(sprite, instance);
        group.add(sprite);
        drawn.set(instance.id, { sprite, atlas, track, frameIndex: index });
        store.use(instance.id, atlasKey);
      }
      for (const id of [...drawn.keys()]) {
        if (present.has(id)) continue;
        detach(id);
        store.release(id);
      }
      return { drawn: present.size, skipped };
    },
    tick(elapsedMs) {
      if (disposed) return;
      elapsed = elapsedMs;
      for (const entry of drawn.values()) showFrame(entry);
    },
    spriteFor: (id) => drawn.get(id)?.sprite,
    spritesUsing: (texture) =>
      [...drawn.values()]
        .filter((entry) => entry.sprite.texture === texture)
        .map((entry) => entry.sprite),
    get stats() {
      return { sprites: drawn.size, textures: store.stats.textures };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of [...drawn.keys()]) {
        detach(id);
        store.release(id);
      }
      store.dispose();
      scene.remove(group);
      group.dispose();
    },
  };
}
