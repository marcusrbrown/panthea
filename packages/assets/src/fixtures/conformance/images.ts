// Procedural conformance fixtures: small descriptors that build their pixels,
// so no binary image or giant array is stored.

import type { Rgb, RgbaImage } from "../../conformance";

export const hex = (rgb: Rgb, alpha = 255): string =>
  `#${[...rgb, alpha].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Deterministic numbers for noise fixtures (Numerical Recipes LCG). */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

export function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rgba.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { rgba, width, height };
}

export const pixelAt = (
  img: RgbaImage,
  x: number,
  y: number,
): [number, number, number, number] => {
  const i = (y * img.width + x) * 4;
  return [
    img.rgba[i] as number,
    img.rgba[i + 1] as number,
    img.rgba[i + 2] as number,
    img.rgba[i + 3] as number,
  ];
};

/** Nearest-neighbour upscale by `scale`, the grid starting `phase` pixels in. */
export function upscale(img: RgbaImage, scale: number, phase = 0): RgbaImage {
  return image(img.width * scale, img.height * scale, (x, y) =>
    pixelAt(
      img,
      Math.min(img.width - 1, Math.max(0, Math.floor((x - phase) / scale))),
      Math.min(img.height - 1, Math.max(0, Math.floor((y - phase) / scale))),
    ),
  );
}

/** 71 colours spaced at least 50 apart in some channel: 4 x 4 x 5 levels, the first 71. */
export const COLOURS_71: readonly Rgb[] = (() => {
  const out: Rgb[] = [];
  for (const r of [32, 96, 160, 224]) {
    for (const g of [40, 100, 160, 220]) {
      for (const b of [20, 70, 120, 170, 220]) out.push([r, g, b]);
    }
  }
  return out.slice(0, 71);
})();

/**
 * A 64x80 figure: a 32x64 opaque block on transparency using all 71 colours,
 * with neighbouring pixels always different colours.
 */
export function figure71(): RgbaImage {
  return image(64, 80, (x, y) => {
    if (x < 16 || x >= 48 || y < 8 || y >= 72) return [0, 0, 0, 0];
    const [r, g, b] = COLOURS_71[(x * 7 + y * 13) % 71] as Rgb;
    return [r, g, b, 255];
  });
}

/** 20 provisional palette colours, none pure black or white. */
export const PALETTE_20: readonly Rgb[] = [
  [24, 20, 40],
  [56, 44, 72],
  [96, 72, 104],
  [152, 112, 120],
  [200, 160, 136],
  [232, 200, 160],
  [64, 40, 24],
  [112, 72, 40],
  [168, 112, 56],
  [224, 168, 72],
  [32, 56, 96],
  [48, 96, 152],
  [88, 144, 200],
  [160, 200, 232],
  [40, 72, 48],
  [72, 120, 72],
  [136, 176, 104],
  [200, 216, 152],
  [120, 32, 40],
  [200, 72, 64],
];

export const cloneImage = (img: RgbaImage): RgbaImage => ({
  ...img,
  rgba: Uint8Array.from(img.rgba),
});

/** A 64x80 figure like `figure71` but in five palette colours, so it needs no reduction. */
export function figure5(): RgbaImage {
  return image(64, 80, (x, y) => {
    if (x < 16 || x >= 48 || y < 8 || y >= 72) return [0, 0, 0, 0];
    const [r, g, b] = PALETTE_20[(x + y) % 5] as Rgb;
    return [r, g, b, 255];
  });
}
