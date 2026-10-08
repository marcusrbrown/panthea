// Atlas textures for the preview: pixel-exact texture creation, the reload
// decision, frame UVs on the atlas grid, and a reference-counted store that
// never disposes a texture while a sprite still uses it. No GPU is touched;
// textures are plain three objects until a renderer uploads them.
//
// Orientation: atlases are held bottom-row-first (the flipY=true convention
// three-flatland's frame UVs assume) with `texture.flipY = false`, so the
// decoder flips bitmaps with `imageOrientation: "flipY"` and raw RGBA goes
// through `rgbaImage`.

import {
  DataTexture,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  Texture,
  UnsignedByteType,
} from "three";
import {
  applyTextureOptions,
  Sprite2DMaterial,
  type SpriteFrame,
} from "three-flatland";
import { diamondRow, TILE_H, TILE_W } from "./iso";

/** Alpha is binary, so any cutoff in (0, 1) is exact. */
export const ALPHA_CUTOFF = 0.5;

export interface RawImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, straight alpha, bottom row first. */
  readonly data: Uint8Array;
}

export type TextureImage = RawImage | ImageBitmap;

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly image: TextureImage;
}

const isRaw = (image: TextureImage): image is RawImage => "data" in image;

/** Wraps top-down RGBA bytes, flipping them to the stored bottom-up order. */
export function rgbaImage(
  width: number,
  height: number,
  topDown: Uint8Array,
): DecodedImage {
  const expected = width * height * 4;
  if (topDown.length !== expected) {
    throw new Error(
      `a ${width}x${height} RGBA image needs ${expected} bytes, got ${topDown.length}`,
    );
  }
  const data = new Uint8Array(expected);
  const stride = width * 4;
  for (let row = 0; row < height; row += 1) {
    data.set(
      topDown.subarray(row * stride, (row + 1) * stride),
      (height - 1 - row) * stride,
    );
  }
  return { width, height, image: { width, height, data } };
}

export function pixelTexture(decoded: DecodedImage): Texture {
  const { image } = decoded;
  const texture = isRaw(image)
    ? new DataTexture(
        image.data,
        image.width,
        image.height,
        RGBAFormat,
        UnsignedByteType,
      )
    : new Texture(image);
  applyTextureOptions(texture, "pixel-art");
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.needsUpdate = true;
  return texture;
}

/** Replaces the pixels of a texture of the same size and queues the upload. */
export function swapImage(texture: Texture, decoded: DecodedImage): void {
  const current = texture.image as TextureImage;
  if (current.width !== decoded.width || current.height !== decoded.height) {
    throw new Error(
      `cannot swap a ${decoded.width}x${decoded.height} image into a ${current.width}x${current.height} texture: the size differs`,
    );
  }
  if (isRaw(current) && isRaw(decoded.image)) {
    current.data.set(decoded.image.data);
  } else {
    texture.image = decoded.image;
  }
  texture.needsUpdate = true;
}

export interface AtlasSpec {
  /** Hash of the visible atlas pixels: equal keys mean the same image. */
  readonly pixelKey: string;
  readonly width: number;
  readonly height: number;
}

export type ReloadDecision = "keep" | "swap" | "rebuild";

/**
 * What a reload does to the texture. A size change needs a new texture; the
 * same size with new pixels is swapped in place; identical pixels are kept.
 * Geometry and timing changes are the sprite's business, not the texture's.
 */
export function decideReload(
  previous: AtlasSpec | undefined,
  next: AtlasSpec,
): ReloadDecision {
  if (
    previous === undefined ||
    previous.width !== next.width ||
    previous.height !== next.height
  ) {
    return "rebuild";
  }
  return previous.pixelKey === next.pixelKey ? "keep" : "swap";
}

/** A manifest frame rect as a three-flatland frame: UVs on the bottom-up atlas grid. */
export function atlasFrame(
  rect: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  },
  atlas: { readonly width: number; readonly height: number },
): SpriteFrame {
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.w <= 0 ||
    rect.h <= 0 ||
    rect.x + rect.w > atlas.width ||
    rect.y + rect.h > atlas.height
  ) {
    throw new Error(
      `frame ${rect.x},${rect.y} ${rect.w}x${rect.h} lies outside the ${atlas.width}x${atlas.height} atlas`,
    );
  }
  return {
    name: `${rect.x},${rect.y},${rect.w},${rect.h}`,
    x: rect.x / atlas.width,
    y: 1 - (rect.y + rect.h) / atlas.height,
    width: rect.w / atlas.width,
    height: rect.h / atlas.height,
    sourceWidth: rect.w,
    sourceHeight: rect.h,
  };
}

const DIAMOND_FILL = [138, 154, 112, 255] as const;

/** The ground diamond: the 64x31 art-guide shape in a 64x32 box, binary alpha, no RGB under alpha 0. */
export function diamondImage(): DecodedImage {
  const rgba = new Uint8Array(TILE_W * TILE_H * 4);
  for (let y = 0; y < TILE_H; y += 1) {
    const span = diamondRow(y);
    if (span === null) continue;
    for (let x = span.x0; x < span.x1; x += 1) {
      rgba.set(DIAMOND_FILL, (y * TILE_W + x) * 4);
    }
  }
  return rgbaImage(TILE_W, TILE_H, rgba);
}

export interface AtlasEntry {
  readonly key: string;
  readonly texture: Texture;
  readonly material: Sprite2DMaterial;
  readonly spec: AtlasSpec;
}

export interface CommitResult {
  readonly decision: ReloadDecision;
  readonly entry: AtlasEntry;
}

export interface TextureStore {
  plan(key: string, spec: AtlasSpec): ReloadDecision;
  /** Applies the plan for `key`. A keep ignores `image`. */
  commit(key: string, spec: AtlasSpec, image: DecodedImage): CommitResult;
  /** The atlas currently committed for `key`. */
  entry(key: string): AtlasEntry | undefined;
  /** Binds `user` to the current atlas for `key`, freeing whatever it used before. */
  use(user: string, key: string): AtlasEntry;
  release(user: string): void;
  readonly stats: { readonly textures: number; readonly materials: number };
  dispose(): void;
}

interface MutableEntry {
  readonly key: string;
  readonly texture: Texture;
  readonly material: Sprite2DMaterial;
  spec: AtlasSpec;
  readonly users: Set<string>;
}

export function createTextureStore(): TextureStore {
  const current = new Map<string, MutableEntry>();
  const retired = new Set<MutableEntry>();
  const bindings = new Map<string, MutableEntry>();

  function discard(entry: MutableEntry): void {
    retired.delete(entry);
    if (current.get(entry.key) === entry) current.delete(entry.key);
    entry.material.dispose();
    entry.texture.dispose();
  }

  function create(
    key: string,
    spec: AtlasSpec,
    image: DecodedImage,
  ): MutableEntry {
    const texture = pixelTexture(image);
    const material = new Sprite2DMaterial({
      map: texture,
      alphaTest: ALPHA_CUTOFF,
      transparent: false,
    });
    return { key, texture, material, spec, users: new Set() };
  }

  function release(user: string): void {
    const entry = bindings.get(user);
    if (entry === undefined) return;
    bindings.delete(user);
    entry.users.delete(user);
    if (entry.users.size === 0) discard(entry);
  }

  return {
    plan(key, spec) {
      return decideReload(current.get(key)?.spec, spec);
    },
    commit(key, spec, image) {
      const previous = current.get(key);
      const decision = decideReload(previous?.spec, spec);
      if (previous !== undefined && decision === "keep") {
        return { decision, entry: previous };
      }
      if (previous !== undefined && decision === "swap") {
        swapImage(previous.texture, image);
        previous.spec = spec;
        return { decision, entry: previous };
      }
      const entry = create(key, spec, image);
      current.set(key, entry);
      if (previous !== undefined) {
        if (previous.users.size === 0) discard(previous);
        else retired.add(previous);
      }
      return { decision, entry };
    },
    entry(key) {
      return current.get(key);
    },
    use(user, key) {
      const entry = current.get(key);
      if (entry === undefined) {
        throw new Error(`no atlas was committed for "${key}"`);
      }
      if (bindings.get(user) === entry) return entry;
      entry.users.add(user);
      release(user);
      bindings.set(user, entry);
      return entry;
    },
    release,
    get stats() {
      const live = current.size + retired.size;
      return { textures: live, materials: live };
    },
    dispose() {
      for (const entry of [...current.values(), ...retired]) discard(entry);
      current.clear();
      retired.clear();
      bindings.clear();
    },
  };
}
