import { describe, expect, it } from "bun:test";
import { loadContent } from "../../test/studio/fixtures";
import { conformImage, type Rgb } from "../conformance";
import type { Palette } from "../palette";
import { DEFAULT_CONFORM } from "../studio/derivation";
import { renderFireFrame } from "./fire";
import {
  defaultRecipe,
  type EffectRecipe,
  type GeneratedEffect,
  generateEffect,
  parseEffectRecipe,
  recipeParams,
} from "./generate";

const retro = loadContent().palettes.get("greek-retro") as Palette;

const make = (recipe: EffectRecipe): GeneratedEffect => {
  const result = generateEffect(recipe, retro);
  if (!result.ok) throw new Error(result.message);
  return result.effect;
};

const fire = () => make(defaultRecipe("fire", 7));
const lightning = () => make(defaultRecipe("lightning", 7));

const animation = (effect: GeneratedEffect, name: string) => {
  const found = effect.animations.find((a) => a.name === name);
  if (found === undefined) throw new Error(`no animation ${name}`);
  return found;
};

const rampShades = (family: string, ramp: string): Rgb[] => {
  const shades = retro.families
    .find((f) => f.id === family)
    ?.ramps.find((r) => r.id === ramp)?.shades;
  if (shades === undefined) throw new Error(`no ramp ${family}/${ramp}`);
  return [...shades];
};

const key = (rgb: readonly number[]) => rgb.join(",");

/** Opaque pixels as `x,y` -> `r,g,b`. */
function opaque(
  rgba: Uint8Array,
  width: number,
): Map<string, { x: number; y: number; colour: string }> {
  const out = new Map<string, { x: number; y: number; colour: string }>();
  for (let p = 0; p < rgba.length / 4; p += 1) {
    if (rgba[p * 4 + 3] === 0) continue;
    const x = p % width;
    const y = Math.floor(p / width);
    out.set(`${x},${y}`, {
      x,
      y,
      colour: key([
        rgba[p * 4] as number,
        rgba[p * 4 + 1] as number,
        rgba[p * 4 + 2] as number,
      ]),
    });
  }
  return out;
}

const lum = (colour: string): number => {
  const [r = 0, g = 0, b = 0] = colour.split(",").map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/** Sum of the luminance of every opaque pixel. */
const light = (rgba: Uint8Array, width: number): number =>
  [...opaque(rgba, width).values()].reduce((s, p) => s + lum(p.colour), 0);

const differing = (a: Uint8Array, b: Uint8Array): number => {
  let count = 0;
  for (let p = 0; p < a.length; p += 4)
    for (let c = 0; c < 4; c += 1)
      if (a[p + c] !== b[p + c]) {
        count += 1;
        break;
      }
  return count;
};

describe("determinism", () => {
  it("gives the same bytes for the same seed and parameters", () => {
    for (const name of ["fire", "lightning"] as const) {
      const a = make(defaultRecipe(name, 11));
      const b = make(defaultRecipe(name, 11));
      expect(a.animations.map((x) => x.frames.map((f) => f.hash))).toEqual(
        b.animations.map((x) => x.frames.map((f) => f.hash)),
      );
      for (const [i, anim] of a.animations.entries())
        for (const [j, frame] of anim.frames.entries())
          expect(frame.png).toEqual(
            (b.animations[i] as (typeof a.animations)[number]).frames[j]
              ?.png as Uint8Array,
          );
    }
  });

  it("gives other bytes for another seed", () => {
    for (const name of ["fire", "lightning"] as const) {
      const a = make(defaultRecipe(name, 1));
      const b = make(defaultRecipe(name, 2));
      expect(a.animations[0]?.frames.map((f) => f.hash)).not.toEqual(
        b.animations[0]?.frames.map((f) => f.hash),
      );
    }
  });

  it("zeroes the colour under transparent pixels", () => {
    for (const effect of [fire(), lightning()])
      for (const anim of effect.animations)
        for (const frame of anim.frames)
          for (let p = 0; p < frame.rgba.length; p += 4)
            if (frame.rgba[p + 3] === 0)
              expect([...frame.rgba.subarray(p, p + 3)]).toEqual([0, 0, 0]);
  });
});

describe("fire", () => {
  const effect = fire();
  const frames = animation(effect, "burn").frames;
  const { w, h } = effect.cell;
  const terracotta = rampShades("town", "terracotta");
  const outline = (rampShades("town", "soil")[0] as Rgb).join(",");

  it("is one looping animation anchored at the base", () => {
    expect(effect.animations.map((a) => a.name)).toEqual(["burn"]);
    expect(effect.pivot).toEqual({ x: w / 2, y: h });
    expect(frames.length).toBeGreaterThanOrEqual(6);
    for (const frame of frames) {
      const lit = opaque(frame.rgba, w);
      const bottom = [...lit.values()].filter((p) => p.y === h - 1);
      expect(bottom.length).toBeGreaterThan(4);
      expect(bottom.some((p) => Math.abs(p.x + 0.5 - w / 2) <= w / 4)).toBe(
        true,
      );
    }
  });

  it("closes its loop: the noise phase after the last frame is the first", () => {
    const recipe = defaultRecipe("fire", 7);
    expect(recipe.effect).toBe("fire");
    if (recipe.effect !== "fire") return;
    const first = renderFireFrame(recipe.seed, recipe.params, 0, retro);
    const again = renderFireFrame(recipe.seed, recipe.params, 1, retro);
    expect(again).toEqual(first);
  });

  it("flows from the last frame to the first as smoothly as between neighbours", () => {
    const steps = frames.map((f, i) =>
      differing(
        f.rgba,
        (frames[(i + 1) % frames.length] as (typeof frames)[number]).rgba,
      ),
    );
    const wrap = steps[steps.length - 1] as number;
    const inside = Math.max(...steps.slice(0, -1));
    expect(inside).toBeGreaterThan(0);
    expect(wrap).toBeLessThanOrEqual(inside * 1.25);
  });

  it("moves: no two consecutive frames are the same", () => {
    for (let i = 0; i < frames.length; i += 1)
      expect(
        differing(
          (frames[i] as (typeof frames)[number]).rgba,
          (frames[(i + 1) % frames.length] as (typeof frames)[number]).rgba,
        ),
      ).toBeGreaterThan(0);
  });

  it("uses the terracotta ramp, an outline colour, and binary alpha", () => {
    const allowed = new Set([...terracotta.map(key), outline]);
    for (const frame of frames) {
      for (let p = 0; p < frame.rgba.length; p += 4)
        expect([0, 255]).toContain(frame.rgba[p + 3] as number);
      for (const px of opaque(frame.rgba, w).values())
        expect(allowed.has(px.colour)).toBe(true);
    }
  });

  it("outlines the outer silhouette only", () => {
    for (const frame of frames) {
      const lit = opaque(frame.rgba, w);
      // Transparent pixels reachable from the cell border.
      const outside = new Set<string>();
      const stack: [number, number][] = [];
      const push = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const k = `${x},${y}`;
        if (lit.has(k) || outside.has(k)) return;
        outside.add(k);
        stack.push([x, y]);
      };
      for (let x = 0; x < w; x += 1) push(x, 0);
      for (let y = 0; y < h; y += 1) {
        push(0, y);
        push(w - 1, y);
      }
      while (stack.length > 0) {
        const [x, y] = stack.pop() as [number, number];
        push(x + 1, y);
        push(x - 1, y);
        push(x, y + 1);
        push(x, y - 1);
      }
      let outlined = 0;
      for (const px of lit.values()) {
        const touchesOutside = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) =>
          outside.has(`${px.x + (dx as number)},${px.y + (dy as number)}`),
        );
        expect(px.colour === outline).toBe(touchesOutside);
        if (touchesOutside) outlined += 1;
      }
      expect(outlined).toBeGreaterThan(10);
    }
  });

  it("shapes tongues: the silhouette has several tips", () => {
    const lit = opaque((frames[0] as (typeof frames)[number]).rgba, w);
    const top: number[] = [];
    for (let x = 0; x < w; x += 1) {
      let y = 0;
      while (y < h && !lit.has(`${x},${y}`)) y += 1;
      top.push(y);
    }
    let tips = 0;
    for (let x = 1; x < w - 1; x += 1) {
      const here = top[x] as number;
      if (
        here < h &&
        here < (top[x - 1] as number) &&
        here <= (top[x + 1] as number)
      )
        tips += 1;
    }
    expect(tips).toBeGreaterThanOrEqual(2);
  });

  it("follows the tongue count parameter", () => {
    const two = make({
      ...defaultRecipe("fire", 7),
      params: { ...(defaultRecipe("fire", 7).params as object), tongues: 2 },
    } as EffectRecipe);
    const three = fire();
    expect(
      (two.animations[0] as (typeof two.animations)[number]).frames[0]?.hash,
    ).not.toBe(
      (three.animations[0] as (typeof three.animations)[number]).frames[0]
        ?.hash,
    );
  });
});

describe("lightning", () => {
  const effect = lightning();
  const { w, h } = effect.cell;
  const full = animation(effect, "full");
  const calm = animation(effect, "calm");
  const target = (() => {
    const recipe = defaultRecipe("lightning", 7);
    if (recipe.effect !== "lightning") throw new Error("recipe");
    return { x: recipe.params.targetX, y: recipe.params.targetY };
  })();

  /** Whether an 8-connected run of opaque pixels joins the top row to the target. */
  const reachesTarget = (rgba: Uint8Array): boolean => {
    const lit = opaque(rgba, w);
    const seen = new Set<string>();
    const stack: [number, number][] = [];
    for (let x = 0; x < w; x += 1)
      if (lit.has(`${x},0`)) {
        seen.add(`${x},0`);
        stack.push([x, 0]);
      }
    while (stack.length > 0) {
      const [x, y] = stack.pop() as [number, number];
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const k = `${x + dx},${y + dy}`;
          if (lit.has(k) && !seen.has(k)) {
            seen.add(k);
            stack.push([x + dx, y + dy]);
          }
        }
    }
    return seen.has(`${target.x},${target.y}`);
  };

  const brightness = (anim: typeof full) =>
    anim.frames.map((f) => light(f.rgba, w));
  const total = (anim: typeof full) =>
    anim.frames.reduce((s, f) => s + f.durationMs, 0);

  it("holds a full and a calm animation in one effect", () => {
    expect(effect.animations.map((a) => a.name)).toEqual(["full", "calm"]);
    expect(effect.pivot).toEqual(target);
  });

  it("plays about 750 ms over about 8 frames in full, with fewer in calm", () => {
    expect(full.frames).toHaveLength(8);
    expect(total(full)).toBe(750);
    expect(calm.frames.length).toBeLessThan(full.frames.length);
    expect(calm.frames.length).toBeGreaterThanOrEqual(3);
    expect(total(calm)).toBeLessThan(total(full));
  });

  it("draws a leader that grows, a single peak that reaches the target, then the impact", () => {
    const lit = full.frames.map((f) => opaque(f.rgba, w).size);
    // The leader is a partial bolt growing from the top of the cell.
    for (const i of [0, 1]) {
      const frame = full.frames[i] as (typeof full.frames)[number];
      expect(reachesTarget(frame.rgba)).toBe(false);
      expect([...opaque(frame.rgba, w).values()].some((p) => p.y === 0)).toBe(
        true,
      );
    }
    expect(lit[1]).toBeGreaterThan(lit[0] as number);
    // The peak is the brightest frame, once, and reaches the target.
    const bright = brightness(full);
    const peak = bright.indexOf(Math.max(...bright));
    expect(peak).toBe(2);
    expect(
      reachesTarget((full.frames[peak] as (typeof full.frames)[number]).rgba),
    ).toBe(true);
    // One rise to the peak, then only a fall: no repeated pulses.
    for (let i = 1; i <= peak; i += 1)
      expect(bright[i] as number).toBeGreaterThan(bright[i - 1] as number);
    for (let i = peak + 1; i < bright.length; i += 1)
      expect(bright[i] as number).toBeLessThan(bright[i - 1] as number);
    // The impact is around the target after the bolt has gone.
    const last = opaque(
      (full.frames[7] as (typeof full.frames)[number]).rgba,
      w,
    );
    expect([...last.values()].some((p) => p.y === 0)).toBe(false);
    expect(
      [...last.values()].some(
        (p) => Math.abs(p.x - target.x) <= 14 && Math.abs(p.y - target.y) <= 8,
      ),
    ).toBe(true);
  });

  it("never fills the cell: no frame lights more than 15% of it", () => {
    for (const anim of [full, calm])
      for (const frame of anim.frames)
        expect(opaque(frame.rgba, w).size / (w * h)).toBeLessThan(0.15);
  });

  it("keeps the leader, the bolt and the impact in calm, at lower contrast", () => {
    const lit = calm.frames.map((f) => opaque(f.rgba, w).size);
    expect(
      reachesTarget((calm.frames[0] as (typeof calm.frames)[number]).rgba),
    ).toBe(false);
    expect(lit[0]).toBeGreaterThan(0);
    const bolt = calm.frames.findIndex((f) => reachesTarget(f.rgba));
    expect(bolt).toBe(1);
    const last = opaque(
      (calm.frames[calm.frames.length - 1] as (typeof calm.frames)[number])
        .rgba,
      w,
    );
    expect([...last.values()].some((p) => p.y === 0)).toBe(false);
    expect(last.size).toBeGreaterThan(0);
    const fullPeak = Math.max(...brightness(full));
    const calmPeak = Math.max(...brightness(calm));
    expect(calmPeak).toBeLessThan(fullPeak * 0.6);
    const peakLum = (anim: typeof full) =>
      Math.max(
        ...anim.frames.flatMap((f) =>
          [...opaque(f.rgba, w).values()].map((p) => lum(p.colour)),
        ),
      );
    expect(peakLum(calm)).toBeLessThan(peakLum(full));
  });

  it("is one bolt in both versions: calm is drawn along the same path", () => {
    const fullPeak = opaque(
      (full.frames[2] as (typeof full.frames)[number]).rgba,
      w,
    );
    const calmBolt = opaque(
      (calm.frames[1] as (typeof calm.frames)[number]).rgba,
      w,
    );
    const shared = [...calmBolt.keys()].filter((k) => fullPeak.has(k)).length;
    expect(shared / calmBolt.size).toBeGreaterThan(0.9);
  });

  it("declares the glow colours it uses, and calm needs none", () => {
    expect(effect.glowColours.length).toBeGreaterThanOrEqual(2);
    const declared = new Set(effect.glowColours.map(key));
    const palette = new Set(
      [
        ...rampShades("olympus", "cloud"),
        ...rampShades("olympus", "lapis"),
      ].map(key),
    );
    const used = (anim: typeof full) =>
      new Set(
        anim.frames.flatMap((f) =>
          [...opaque(f.rgba, w).values()].map((p) => p.colour),
        ),
      );
    for (const colour of used(full))
      expect(declared.has(colour) || palette.has(colour)).toBe(true);
    expect([...used(full)].some((c) => declared.has(c))).toBe(true);
    for (const colour of used(calm)) expect(palette.has(colour)).toBe(true);
  });

  it("follows the seed: another seed bends the bolt differently", () => {
    const other = make(defaultRecipe("lightning", 8));
    expect(animation(other, "full").frames[2]?.hash).not.toBe(
      full.frames[2]?.hash,
    );
  });
});

describe("palette conformance", () => {
  for (const name of ["fire", "lightning"] as const) {
    it(`${name}: every frame conforms to the palette family plus its declared glow colours`, () => {
      const effect = make(defaultRecipe(name, 3));
      const family = retro.families.find((f) => f.id === effect.paletteFamily);
      const colours = (family?.ramps ?? []).flatMap((r) => r.shades);
      for (const anim of effect.animations)
        for (const frame of anim.frames) {
          const result = conformImage({
            rgba: frame.rgba,
            width: effect.cell.w,
            height: effect.cell.h,
            kind: "effect",
            mode: "report-only",
            cell: effect.cell,
            pivot: effect.pivot,
            paletteRgb: colours,
            glow: effect.glowColours,
            background: DEFAULT_CONFORM.background,
            alphaCutoff: DEFAULT_CONFORM.alphaCutoff,
            grid: DEFAULT_CONFORM.grid,
            scale: 1,
          });
          if (result.status !== "done") throw new Error(result.status);
          expect(result.report.status).toBe("pass");
        }
    });
  }

  it("refuses a glow colour that was not declared", () => {
    const effect = lightning();
    const family = retro.families.find((f) => f.id === effect.paletteFamily);
    const colours = (family?.ramps ?? []).flatMap((r) => r.shades);
    const frame = animation(effect, "full").frames[2] as ReturnType<
      typeof animation
    >["frames"][number];
    const result = conformImage({
      rgba: frame.rgba,
      width: effect.cell.w,
      height: effect.cell.h,
      kind: "effect",
      mode: "report-only",
      cell: effect.cell,
      paletteRgb: colours,
      glow: effect.glowColours.slice(1),
      background: DEFAULT_CONFORM.background,
      alphaCutoff: DEFAULT_CONFORM.alphaCutoff,
      grid: DEFAULT_CONFORM.grid,
      scale: 1,
    });
    if (result.status !== "done") throw new Error(result.status);
    expect(
      result.report.checks.find((c) => c.check === "palette")?.status,
    ).toBe("fail");
  });
});

describe("recipes", () => {
  it("round-trips through integer parameters", () => {
    for (const name of ["fire", "lightning"] as const) {
      const recipe = defaultRecipe(name, 5);
      const parsed = parseEffectRecipe(5, recipeParams(recipe));
      expect(parsed).toEqual({ ok: true, recipe });
    }
  });

  it("refuses unknown effects, keys and out-of-range values", () => {
    const fireJson = recipeParams(defaultRecipe("fire", 1));
    const lightningJson = recipeParams(defaultRecipe("lightning", 1));
    const refused = (json: unknown) => {
      const r = parseEffectRecipe(1, json);
      expect(r.ok).toBe(false);
      return r.ok ? "" : r.message;
    };
    expect(refused({ effect: "smoke" })).toMatch(/effect/);
    expect(refused({ ...fireJson, extra: 1 })).toMatch(/extra/);
    expect(refused({ ...fireJson, tongues: 9 })).toMatch(/tongues/);
    expect(refused({ ...fireJson, frames: 1 })).toMatch(/frames/);
    expect(refused({ ...fireJson, width: 1.5 })).toMatch(/width/);
    expect(refused({ ...lightningJson, fullMs: [100, 100] })).toMatch(/fullMs/);
    expect(refused({ ...lightningJson, targetY: 500 })).toMatch(/targetY/);
    expect(refused("fire")).toMatch(/object/);
    expect(parseEffectRecipe(-1, fireJson).ok).toBe(false);
  });

  it("refuses a palette without the ramps it draws from", () => {
    const bare: Palette = { ...retro, families: [] };
    const result = generateEffect(defaultRecipe("fire", 1), bare);
    expect(result.ok).toBe(false);
  });
});
