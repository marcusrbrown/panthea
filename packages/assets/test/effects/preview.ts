// Writes the effects preview: a self-contained HTML page (frames embedded, drawn
// at integer zoom with nearest-neighbour scaling) and PNG contact sheets. Each
// effect is shown alone and composited over a building, full beside calm.
//
//   bun packages/assets/test/effects/preview.ts [outDir] [buildingPng]
//
// The default outDir is a gitignored scratch directory. The building is the
// retro-render probe's house when its render is on disk, else a flat stand-in.
// Nothing is opened; open the HTML yourself.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RgbaImage } from "../../src/conformance";
import {
  defaultRecipe,
  type GeneratedEffect,
  generateEffect,
} from "../../src/effects/generate";
import type { Palette } from "../../src/palette";
import { encodeRgbaPng } from "../../src/placeholder";
import { decodePng } from "../../src/studio/png/decode";
import { loadContent } from "../studio/fixtures";

const repo = join(import.meta.dir, "..", "..", "..", "..");
const outDir =
  process.argv[2] ??
  join(repo, "tools", "probes", "studio-render", "scratch", "u10-effects");
const HOUSE_DEFAULT = join(
  repo,
  "..",
  "panthea",
  "tools",
  "probes",
  "retro-render",
  "scratch",
  "cells-r3",
  "house",
  "toon",
  "static_south_00.png",
);
const housePath = process.argv[3] ?? HOUSE_DEFAULT;

type Rgba = readonly [number, number, number, number];

const canvas = (width: number, height: number, fill?: Rgba): RgbaImage => {
  const rgba = new Uint8Array(width * height * 4);
  if (fill !== undefined)
    for (let p = 0; p < width * height; p += 1) rgba.set(fill, p * 4);
  return { rgba, width, height };
};

/** Draws `src` over `dst` at (x, y) with ordinary alpha-over. */
function over(dst: RgbaImage, src: RgbaImage, x0: number, y0: number): void {
  for (let y = 0; y < src.height; y += 1)
    for (let x = 0; x < src.width; x += 1) {
      const dx = x0 + x;
      const dy = y0 + y;
      if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue;
      const s = (y * src.width + x) * 4;
      const a = (src.rgba[s + 3] as number) / 255;
      if (a === 0) continue;
      const d = (dy * dst.width + dx) * 4;
      for (let c = 0; c < 3; c += 1)
        dst.rgba[d + c] = Math.round(
          (src.rgba[s + c] as number) * a +
            (dst.rgba[d + c] as number) * (1 - a),
        );
      dst.rgba[d + 3] = 255;
    }
}

const zoomed = (image: RgbaImage, zoom: number): RgbaImage => {
  const out = canvas(image.width * zoom, image.height * zoom);
  for (let y = 0; y < out.height; y += 1)
    for (let x = 0; x < out.width; x += 1) {
      const s = (Math.floor(y / zoom) * image.width + Math.floor(x / zoom)) * 4;
      out.rgba.set(image.rgba.subarray(s, s + 4), (y * out.width + x) * 4);
    }
  return out;
};

const frameImage = (effect: GeneratedEffect, rgba: Uint8Array): RgbaImage => ({
  rgba,
  width: effect.cell.w,
  height: effect.cell.h,
});

/** Rows of images laid out on a flat background, each row left to right. */
function sheet(
  rows: readonly (readonly RgbaImage[])[],
  zoom: number,
  background: Rgba,
  gap = 4,
): RgbaImage {
  const cellW = Math.max(...rows.flat().map((i) => i.width)) * zoom;
  const cellH = Math.max(...rows.flat().map((i) => i.height)) * zoom;
  const columns = Math.max(...rows.map((r) => r.length));
  const out = canvas(
    gap + columns * (cellW + gap),
    gap + rows.length * (cellH + gap),
    background,
  );
  for (const [r, row] of rows.entries())
    for (const [c, image] of row.entries())
      over(
        out,
        zoomed(image, zoom),
        gap + c * (cellW + gap),
        gap + r * (cellH + gap),
      );
  return out;
}

const writePng = (name: string, image: RgbaImage) =>
  writeFileSync(
    join(outDir, name),
    encodeRgbaPng(image.rgba, image.width, image.height),
  );

const loadBuilding = (): {
  image: RgbaImage;
  roof: { x: number; y: number };
  source: string;
} => {
  if (existsSync(housePath)) {
    const decoded = decodePng(new Uint8Array(readFileSync(housePath)));
    if (decoded.ok)
      return {
        image: decoded.image,
        // The roof slope the strike lands on, in the render's own pixels.
        roof: { x: 104, y: 62 },
        source: housePath,
      };
  }
  const flat = canvas(192, 176);
  over(flat, canvas(120, 90, [150, 110, 90, 255]), 36, 70);
  over(flat, canvas(120, 30, [120, 70, 55, 255]), 36, 40);
  return {
    image: flat,
    roof: { x: 96, y: 45 },
    source: "a flat stand-in (no house render on disk)",
  };
};

const retro = loadContent().palettes.get("greek-retro") as Palette;
const make = (name: "fire" | "lightning"): GeneratedEffect => {
  const result = generateEffect(defaultRecipe(name, 7), retro);
  if (!result.ok) throw new Error(result.message);
  return result.effect;
};
const fire = make("fire");
const lightning = make("lightning");
const burn = fire.animations[0]?.frames ?? [];
const full = lightning.animations.find((a) => a.name === "full")?.frames ?? [];
const calm = lightning.animations.find((a) => a.name === "calm")?.frames ?? [];

const building = loadBuilding();
const TOP = 72; // room above the building for the bolt
const scene = (
  draw: (target: RgbaImage, at: { x: number; y: number }) => void,
): RgbaImage => {
  const image = canvas(
    building.image.width,
    building.image.height + TOP,
    [58, 66, 78, 255],
  );
  over(image, building.image, 0, TOP);
  draw(image, { x: building.roof.x, y: building.roof.y + TOP });
  return image;
};
const withStrike = (frames: typeof full, index: number | null) =>
  scene((target, roof) => {
    if (index !== null) {
      const f = frames[index];
      if (f !== undefined)
        over(
          target,
          frameImage(lightning, f.rgba),
          roof.x - lightning.pivot.x,
          roof.y - lightning.pivot.y,
        );
    }
  });
const withFire = (index: number) =>
  scene((target, roof) => {
    const f = burn[index];
    if (f !== undefined)
      over(
        target,
        frameImage(fire, f.rgba),
        roof.x - fire.pivot.x,
        roof.y + 10 - fire.pivot.y,
      );
  });

mkdirSync(outDir, { recursive: true });
const dark: Rgba = [34, 38, 46, 255];
const strip = (effect: GeneratedEffect, frames: typeof full) =>
  frames.map((f) => frameImage(effect, f.rgba));

writePng("fire-alone.png", sheet([strip(fire, burn)], 4, dark));
writePng(
  "lightning-alone.png",
  sheet([strip(lightning, full), strip(lightning, calm)], 3, dark),
);
writePng(
  "on-building-fire.png",
  sheet([burn.map((_, i) => withFire(i))], 2, dark),
);
writePng(
  "on-building-strike.png",
  sheet(
    [
      full.map((_, i) => withStrike(full, i)),
      calm.map((_, i) => withStrike(calm, i)),
    ],
    2,
    dark,
  ),
);
// The sheets a reviewer reads at 1x: the same scenes unscaled.
writePng(
  "on-building-1x.png",
  sheet(
    [
      full.map((_, i) => withStrike(full, i)),
      calm.map((_, i) => withStrike(calm, i)),
      burn.slice(0, 8).map((_, i) => withFire(i)),
    ],
    1,
    dark,
    2,
  ),
);

// --- The HTML page -------------------------------------------------------------

const uri = (image: RgbaImage) =>
  `data:image/png;base64,${Buffer.from(encodeRgbaPng(image.rgba, image.width, image.height)).toString("base64")}`;

interface Clip {
  readonly title: string;
  readonly note: string;
  readonly frames: readonly string[];
  readonly ms: readonly number[];
  readonly loop: boolean;
}

const alone = (
  effect: GeneratedEffect,
  frames: typeof full,
): readonly string[] => frames.map((f) => uri(frameImage(effect, f.rgba)));
const ms = (frames: typeof full) => frames.map((f) => f.durationMs);

const clips: Clip[] = [
  {
    title: "Fire, alone",
    note: `${burn.length} frames, ${ms(burn)[0]} ms each, loops`,
    frames: alone(fire, burn),
    ms: ms(burn),
    loop: true,
  },
  {
    title: "Lightning full, alone",
    note: `${full.length} frames, ${ms(full).reduce((a, b) => a + b, 0)} ms, once`,
    frames: alone(lightning, full),
    ms: ms(full),
    loop: false,
  },
  {
    title: "Lightning calm, alone",
    note: `${calm.length} frames, ${ms(calm).reduce((a, b) => a + b, 0)} ms, once`,
    frames: alone(lightning, calm),
    ms: ms(calm),
    loop: false,
  },
  {
    title: "Fire on the building",
    note: "looping, anchored on the roof",
    frames: burn.map((_, i) => uri(withFire(i))),
    ms: ms(burn),
    loop: true,
  },
  {
    title: "Strike on the building, full",
    note: "once, then the roof burns",
    frames: [
      ...full.map((_, i) => uri(withStrike(full, i))),
      ...burn.map((_, i) => uri(withFire(i))),
    ],
    ms: [...ms(full), ...ms(burn)],
    loop: false,
  },
  {
    title: "Strike on the building, calm",
    note: "once, then the roof burns",
    frames: [
      ...calm.map((_, i) => uri(withStrike(calm, i))),
      ...burn.map((_, i) => uri(withFire(i))),
    ],
    ms: [...ms(calm), ...ms(burn)],
    loop: false,
  },
];

const html = `<!doctype html>
<meta charset="utf-8">
<title>Effects preview: fire and lightning</title>
<style>
  body { background: #22262e; color: #d6dbe4; font: 14px/1.4 system-ui, sans-serif; margin: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { margin: 0 0 12px; color: #9aa3b2; }
  .row { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { margin-top: 6px; }
  figcaption small { color: #9aa3b2; display: block; }
  canvas { background: #3a424e; image-rendering: pixelated; display: block; }
  button, select { font: inherit; }
</style>
<h1>Effects preview: fire and lightning</h1>
<p>Building: ${building.source}. Drawn at integer zoom with nearest-neighbour scaling.
  Zoom <select id="zoom"><option>1</option><option>2</option><option selected>3</option><option>4</option></select>
  <button id="replay">Replay</button></p>
<div class="row" id="stage"></div>
<script>
const clips = ${JSON.stringify(clips)};
const stage = document.getElementById("stage");
const images = clips.map((c) => c.frames.map((src) => { const i = new Image(); i.src = src; return i; }));
const players = clips.map((clip, n) => {
  const figure = document.createElement("figure");
  const canvas = document.createElement("canvas");
  const caption = document.createElement("figcaption");
  caption.innerHTML = clip.title + "<small>" + clip.note + "</small>";
  figure.append(canvas, caption);
  stage.append(figure);
  return { clip, canvas, n, frame: 0, timer: 0 };
});
function draw(p) {
  const img = images[p.n][p.frame];
  const zoom = Number(document.getElementById("zoom").value);
  if (!img.complete) return;
  p.canvas.width = img.naturalWidth * zoom;
  p.canvas.height = img.naturalHeight * zoom;
  const ctx = p.canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, p.canvas.width, p.canvas.height);
}
function play(p) {
  clearTimeout(p.timer);
  p.frame = 0;
  const step = () => {
    draw(p);
    const wait = p.clip.ms[p.frame];
    p.frame += 1;
    if (p.frame >= p.clip.frames.length) {
      if (!p.clip.loop) { p.timer = setTimeout(() => { p.frame = p.clip.frames.length - 1; draw(p); }, wait); return; }
      p.frame = 0;
    }
    p.timer = setTimeout(step, wait);
  };
  step();
}
function startAll() { players.forEach(play); }
document.getElementById("replay").onclick = startAll;
document.getElementById("zoom").onchange = () => players.forEach(draw);
window.onload = startAll;
</script>
`;
writeFileSync(join(outDir, "index.html"), html);
console.log(`wrote ${outDir}`);
