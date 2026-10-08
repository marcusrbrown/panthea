import { describe, expect, it } from "bun:test";
import { spriteFixture } from "@panthea/assets/fixtures";
import {
  ClampToEdgeWrapping,
  DataTexture,
  NearestFilter,
  NoColorSpace,
  type Texture,
} from "three";
import { DIAMOND_H, diamondRow, TILE_H, TILE_W } from "./iso";
import {
  type AtlasSpec,
  atlasFrame,
  createTextureStore,
  decideReload,
  diamondImage,
  pixelTexture,
  type RawImage,
  rgbaImage,
  swapImage,
} from "./textures";

const spec = (overrides: Partial<AtlasSpec> = {}): AtlasSpec => ({
  pixelKey: "p1",
  width: 4,
  height: 2,
  ...overrides,
});

function solid(width: number, height: number, tag: number) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba.set([tag, 80, 160, 255], i);
  }
  return rgbaImage(width, height, rgba);
}

function rawOf(texture: Texture): RawImage {
  return texture.image as RawImage;
}

function disposals(texture: Texture): () => number {
  let count = 0;
  texture.addEventListener("dispose", () => {
    count += 1;
  });
  return () => count;
}

/** Pixel at (x, y) counting rows from the top of the original image. */
function topDown(image: RawImage, x: number, y: number): number[] {
  const row = image.height - 1 - y;
  const at = (row * image.width + x) * 4;
  return [...image.data.slice(at, at + 4)];
}

describe("rgbaImage", () => {
  it("stores rows bottom-up so frame UVs follow the flipY=true convention", () => {
    const rgba = new Uint8Array([
      1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255,
    ]);
    const decoded = rgbaImage(2, 2, rgba);
    const raw = decoded.image as RawImage;
    expect([...raw.data]).toEqual([
      3, 0, 0, 255, 4, 0, 0, 255, 1, 0, 0, 255, 2, 0, 0, 255,
    ]);
    expect(topDown(raw, 0, 0)).toEqual([1, 0, 0, 255]);
    expect(topDown(raw, 1, 1)).toEqual([4, 0, 0, 255]);
  });

  it("refuses data that is not width x height x 4 bytes", () => {
    expect(() => rgbaImage(2, 2, new Uint8Array(15))).toThrow(/16/);
  });
});

describe("pixelTexture", () => {
  it("applies the pixel-art preset with colour management off and no premultiplication", () => {
    const texture = pixelTexture(solid(4, 2, 7));
    expect(texture.minFilter).toBe(NearestFilter);
    expect(texture.magFilter).toBe(NearestFilter);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.wrapS).toBe(ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(ClampToEdgeWrapping);
    expect(texture.flipY).toBe(false);
    expect(texture.premultiplyAlpha).toBe(false);
    expect(texture.colorSpace).toBe(NoColorSpace);
    expect(texture).toBeInstanceOf(DataTexture);
    texture.dispose();
  });
});

describe("swapImage", () => {
  it("replaces the pixels of the same texture object and marks it for upload", () => {
    const texture = pixelTexture(solid(4, 2, 7));
    const version = texture.version;
    swapImage(texture, solid(4, 2, 99));
    expect(rawOf(texture).data[0]).toBe(99);
    expect(texture.version).toBeGreaterThan(version);
    texture.dispose();
  });

  it("refuses a different size, which needs a new texture", () => {
    const texture = pixelTexture(solid(4, 2, 7));
    expect(() => swapImage(texture, solid(8, 2, 7))).toThrow(/size/);
    texture.dispose();
  });
});

describe("decideReload", () => {
  it("rebuilds when there is no previous atlas", () => {
    expect(decideReload(undefined, spec())).toBe("rebuild");
  });

  it("keeps the texture when size and visible pixels are unchanged", () => {
    expect(decideReload(spec(), spec())).toBe("keep");
  });

  it("swaps image data in place when only the visible pixels changed at the same size", () => {
    expect(decideReload(spec(), spec({ pixelKey: "p2" }))).toBe("swap");
  });

  it("rebuilds whenever the atlas size changes, even if the pixel key is equal", () => {
    expect(decideReload(spec(), spec({ width: 8 }))).toBe("rebuild");
    expect(decideReload(spec(), spec({ height: 4, pixelKey: "p2" }))).toBe(
      "rebuild",
    );
  });
});

describe("atlasFrame", () => {
  it("maps a real manifest frame to normalised UVs on the atlas grid", () => {
    const { manifest } = spriteFixture();
    const second = manifest.animations[0]?.frames[1];
    expect(second?.rect).toEqual({ x: 64, y: 0, w: 64, h: 80 });
    const frame = atlasFrame(
      second?.rect ?? { x: 0, y: 0, w: 0, h: 0 },
      manifest.atlas,
    );
    expect(frame).toMatchObject({
      x: 0.25,
      y: 0,
      width: 0.25,
      height: 1,
      sourceWidth: 64,
      sourceHeight: 80,
    });
  });

  it("samples exactly the rect's texel rows and columns, counted from the top of the image", () => {
    const atlas = { width: 128, height: 64 };
    const rect = { x: 64, y: 16, w: 64, h: 32 };
    const frame = atlasFrame(rect, atlas);
    const bottomRows = [
      frame.y * atlas.height,
      (frame.y + frame.height) * atlas.height,
    ];
    expect(bottomRows).toEqual([
      atlas.height - (rect.y + rect.h),
      atlas.height - rect.y,
    ]);
    expect(frame.x * atlas.width).toBe(rect.x);
    expect((frame.x + frame.width) * atlas.width).toBe(rect.x + rect.w);
    // Texel row r counted from the bottom is row (height - 1 - r) from the top.
    const topRows = [
      atlas.height - bottomRows[1],
      atlas.height - bottomRows[0],
    ];
    expect(topRows).toEqual([rect.y, rect.y + rect.h]);
  });

  it("refuses a rect that leaves the atlas", () => {
    expect(() =>
      atlasFrame({ x: 200, y: 0, w: 64, h: 80 }, { width: 256, height: 80 }),
    ).toThrow(/outside/);
  });
});

describe("diamondImage", () => {
  const diamond = diamondImage();
  const raw = diamond.image as RawImage;

  it("is a 64x32 box with the diamond rows opaque, row 31 clear and alpha strictly binary", () => {
    expect([diamond.width, diamond.height]).toEqual([TILE_W, TILE_H]);
    for (let y = 0; y < TILE_H; y += 1) {
      const span = diamondRow(y);
      for (let x = 0; x < TILE_W; x += 1) {
        const inside = span !== null && x >= span.x0 && x < span.x1;
        const alpha = topDown(raw, x, y)[3];
        expect(alpha).toBe(inside ? 255 : 0);
      }
    }
    expect(topDown(raw, 32, DIAMOND_H)[3]).toBe(0);
  });

  it("leaves no RGB under alpha zero", () => {
    for (let y = 0; y < TILE_H; y += 1) {
      for (let x = 0; x < TILE_W; x += 1) {
        const pixel = topDown(raw, x, y);
        if (pixel[3] === 0) expect(pixel.slice(0, 3)).toEqual([0, 0, 0]);
      }
    }
  });
});

describe("texture store", () => {
  it("creates one texture and one cutout material per atlas, shared by every user", () => {
    const store = createTextureStore();
    const entry = store.commit("a", spec(), solid(4, 2, 1)).entry;
    expect(store.use("u1", "a")).toBe(entry);
    expect(store.use("u2", "a")).toBe(entry);
    expect(store.stats).toEqual({ textures: 1, materials: 1 });
    expect(entry.material.alphaTest).toBeGreaterThan(0);
    expect(entry.material.transparent).toBe(false);
    expect(entry.material.depthWrite).toBe(true);
    expect(entry.material.depthTest).toBe(true);
    store.dispose();
    expect(store.stats).toEqual({ textures: 0, materials: 0 });
  });

  it("reuses the texture object for a same-size reload and uploads the new pixels", () => {
    const store = createTextureStore();
    const first = store.commit("a", spec(), solid(4, 2, 1)).entry;
    store.use("u", "a");
    const second = store.commit("a", spec({ pixelKey: "p2" }), solid(4, 2, 50));
    expect(second.decision).toBe("swap");
    expect(second.entry).toBe(first);
    expect(second.entry.texture).toBe(first.texture);
    expect(rawOf(first.texture).data[0]).toBe(50);
    expect(store.stats.textures).toBe(1);
    store.dispose();
  });

  it("keeps the entry and ignores the image when nothing visible changed", () => {
    const store = createTextureStore();
    const first = store.commit("a", spec(), solid(4, 2, 1)).entry;
    const again = store.commit("a", spec(), solid(4, 2, 77));
    expect(again.decision).toBe("keep");
    expect(again.entry).toBe(first);
    expect(rawOf(first.texture).data[0]).toBe(1);
    store.dispose();
  });

  it("disposes the old texture on a size change, but only once its last user has moved", () => {
    const store = createTextureStore();
    const old = store.commit("a", spec(), solid(4, 2, 1)).entry;
    const oldDisposals = disposals(old.texture);
    store.use("u", "a");

    const rebuilt = store.commit(
      "a",
      spec({ width: 8, pixelKey: "p2" }),
      solid(8, 2, 2),
    );
    expect(rebuilt.decision).toBe("rebuild");
    expect(rebuilt.entry.texture).not.toBe(old.texture);
    expect(oldDisposals()).toBe(0);
    expect(store.stats.textures).toBe(2);

    store.use("u", "a");
    expect(oldDisposals()).toBe(1);
    expect(store.stats.textures).toBe(1);
    store.dispose();
  });

  it("disposes a replaced texture immediately when nothing uses it", () => {
    const store = createTextureStore();
    const old = store.commit("a", spec(), solid(4, 2, 1)).entry;
    const oldDisposals = disposals(old.texture);
    store.commit("a", spec({ width: 8 }), solid(8, 2, 2));
    expect(oldDisposals()).toBe(1);
    expect(store.stats.textures).toBe(1);
    store.dispose();
  });

  it("never disposes a texture while any user still references it", () => {
    const store = createTextureStore();
    const old = store.commit("a", spec(), solid(4, 2, 1)).entry;
    const oldDisposals = disposals(old.texture);
    store.use("u1", "a");
    store.use("u2", "a");
    store.commit("a", spec({ width: 8 }), solid(8, 2, 2));
    store.use("u1", "a");
    expect(oldDisposals()).toBe(0);
    store.release("u2");
    expect(oldDisposals()).toBe(1);
    store.dispose();
  });

  it("returns to the baseline after 20 reloads of one asset, rebuilt or swapped", () => {
    const store = createTextureStore();
    store.commit("a", spec(), solid(4, 2, 0));
    store.use("u", "a");
    const baseline = store.stats;
    for (let i = 1; i <= 20; i += 1) {
      const grow = i % 2 === 0;
      store.commit(
        "a",
        spec({ width: grow ? 4 : 8, pixelKey: `p${i}` }),
        solid(grow ? 4 : 8, 2, i),
      );
      store.use("u", "a");
      expect(store.stats).toEqual(baseline);
    }
    store.release("u");
    expect(store.stats).toEqual({ textures: 0, materials: 0 });
  });

  it("releases an atlas when its last user leaves", () => {
    const store = createTextureStore();
    const entry = store.commit("a", spec(), solid(4, 2, 1)).entry;
    const count = disposals(entry.texture);
    store.use("u", "a");
    store.release("u");
    expect(count()).toBe(1);
    expect(store.entry("a")).toBeUndefined();
    store.release("u");
    expect(count()).toBe(1);
  });

  it("moves a user between atlases and frees the one it left", () => {
    const store = createTextureStore();
    const a = store.commit("a", spec(), solid(4, 2, 1)).entry;
    const b = store.commit("b", spec(), solid(4, 2, 2)).entry;
    const aCount = disposals(a.texture);
    store.use("u", "a");
    expect(store.use("u", "b")).toBe(b);
    expect(aCount()).toBe(1);
    expect(store.stats.textures).toBe(1);
    store.dispose();
  });

  it("refuses to bind a user to an atlas that was never committed", () => {
    const store = createTextureStore();
    expect(() => store.use("u", "missing")).toThrow(/missing/);
  });

  it("plans from the current spec", () => {
    const store = createTextureStore();
    expect(store.plan("a", spec())).toBe("rebuild");
    store.commit("a", spec(), solid(4, 2, 1));
    expect(store.plan("a", spec())).toBe("keep");
    expect(store.plan("a", spec({ pixelKey: "p2" }))).toBe("swap");
    expect(store.plan("a", spec({ width: 9 }))).toBe("rebuild");
    store.dispose();
  });

  it("disposing the store twice is safe", () => {
    const store = createTextureStore();
    store.commit("a", spec(), solid(4, 2, 1));
    store.dispose();
    expect(() => store.dispose()).not.toThrow();
  });
});
