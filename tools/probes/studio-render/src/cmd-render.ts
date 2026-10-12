// Staging, the minimal-env search, slot renders, and the pixel analyses
// (criteria a, d, f, i, j, k).

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { encodeRgbaPng } from "../../../../packages/assets/src/placeholder";
import {
  ENV_ORDER,
  pickEnv,
  type RunResult,
  runToCompletion,
  savedEnvKeys,
} from "./blender";
import {
  ensureDir,
  KIT_FILES,
  mainCheckout,
  RESULTS,
  RUNS,
  SCRATCH,
} from "./paths";
import {
  compareRgba,
  decodeRgba,
  describePng,
  distinctLevels8,
  distinctLevels16,
  readGrey16,
} from "./png";

export const STAGING = join(SCRATCH, "staging");

export function writeResult(name: string, data: unknown): string {
  const path = join(ensureDir(RESULTS), `${name}.json`);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}

export const sha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

/** Copy only the kit files the recipe imports; no textures. The staging layout mirrors the kit root. */
export function stage(dir: string): {
  files: { path: string; bytes: number; sha256: string }[];
} {
  const source = join(mainCheckout(), "tools/probes");
  rmSync(dir, { recursive: true, force: true });
  const files = KIT_FILES.map((rel) => {
    const to = join(dir, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(source, rel), to);
    return { path: rel, bytes: statSync(to).size, sha256: sha256(to) };
  });
  return { files };
}

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(path, entry.name));
      else out.push(join(path, entry.name));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** (a): the smallest env that renders. Starts empty, adds ceiling keys one at a time. */
export async function envStep(): Promise<void> {
  const attempts: unknown[] = [];
  const keys: string[] = [];
  for (let step = 0; step <= ENV_ORDER.length; step += 1) {
    const out = join(RUNS, `env-${step}`);
    rmSync(out, { recursive: true, force: true });
    const result = await runToCompletion({
      name: `env-${step}`,
      mode: "gpu",
      scriptArgs: ["--out", out],
      outDir: out,
      env: pickEnv(keys),
      timeoutMs: 120_000,
    });
    attempts.push({
      keys: [...keys],
      exitCode: result.exitCode,
      exitSignal: result.exitSignal,
      durationMs: result.durationMs,
      stderrTail: result.stderrTail.slice(-400),
    });
    if (result.ok) {
      writeResult("env", { keys, attempts });
      return;
    }
    const next = ENV_ORDER[step];
    if (next) keys.push(next);
  }
  writeResult("env", { keys: null, attempts });
  throw new Error("no env within the ceiling made the probe render");
}

export interface RenderOptions {
  readonly name: string;
  readonly unstaged: boolean;
  readonly depth16: boolean;
  readonly clip: string;
  readonly facing: string;
  readonly extraClip: string;
}

export async function renderSlot(options: RenderOptions): Promise<RunResult> {
  const out = join(RUNS, options.name);
  rmSync(out, { recursive: true, force: true });
  ensureDir(out);
  const models = options.unstaged
    ? join(mainCheckout(), "tools/probes")
    : STAGING;
  if (!options.unstaged && !existsSync(STAGING)) stage(STAGING);
  const result = await runToCompletion({
    name: options.name,
    mode: "slot",
    scriptArgs: [
      "--models",
      models,
      "--out",
      out,
      "--clip",
      options.clip,
      "--facing",
      options.facing,
      ...(options.extraClip ? ["--extra-clip", options.extraClip] : []),
      ...(options.depth16 ? ["--depth16"] : []),
    ],
    outDir: out,
    colourDir: join(out, "render/zeus-tall/toon"),
    env: pickEnv(savedEnvKeys()),
    timeoutMs: 400_000,
  });
  writeFileSync(
    join(out, "driver.json"),
    `${JSON.stringify({ options, result, envKeys: savedEnvKeys() }, null, 2)}\n`,
  );
  return result;
}

const ROLES = [
  ["colour", "toon", ".toon.png"],
  ["id", "id", ".id.png"],
  ["depth", "depth", ".depth.png"],
] as const;

function roleFiles(run: string, dir: string, suffix: string): string[] {
  const root = join(RUNS, run, "render/zeus-tall", dir);
  return existsSync(root)
    ? readdirSync(root)
        .filter((n) => n.endsWith(suffix))
        .sort()
    : [];
}

export interface CompareReport {
  readonly a: string;
  readonly b: string;
  readonly perRole: Record<
    string,
    {
      files: number;
      identicalPixels: number;
      identicalBytes: number;
      differingFiles: string[];
    }
  >;
  readonly allPixelsIdentical: boolean;
}

/** Decoded-pixel comparison of every frame and role of two runs. */
export function compareRuns(a: string, b: string): CompareReport {
  const perRole: CompareReport["perRole"] = {};
  let all = true;
  for (const [role, dir, suffix] of ROLES) {
    const namesA = roleFiles(a, dir, suffix);
    const namesB = roleFiles(b, dir, suffix);
    const names = namesA.filter((n) => namesB.includes(n));
    let pixels = 0;
    let bytes = 0;
    const differing: string[] = [];
    for (const name of names) {
      const pa = join(RUNS, a, "render/zeus-tall", dir, name);
      const pb = join(RUNS, b, "render/zeus-tall", dir, name);
      const ia = decodeRgba(pa);
      const ib = decodeRgba(pb);
      if (ia && ib && compareRgba(ia, ib).identical) pixels += 1;
      else differing.push(name);
      if (sha256(pa) === sha256(pb)) bytes += 1;
    }
    if (
      names.length === 0 ||
      namesA.length !== namesB.length ||
      differing.length > 0
    )
      all = false;
    perRole[role] = {
      files: names.length,
      identicalPixels: pixels,
      identicalBytes: bytes,
      differingFiles: differing,
    };
  }
  return { a, b, perRole, allPixelsIdentical: all };
}

/** Controls for the comparison: it must be able to report "different". */
export function compareControls(run: string): unknown {
  const col = (i: number) =>
    join(
      RUNS,
      run,
      "render/zeus-tall/toon",
      `walk16_south_${String(i).padStart(2, "0")}.toon.png`,
    );
  const idp = join(RUNS, run, "render/zeus-tall/id", "walk16_south_00.id.png");
  const f0 = decodeRgba(col(0));
  const f1 = decodeRgba(col(1));
  const id0 = decodeRgba(idp);
  if (!f0 || !f1 || !id0) return { error: "frames missing" };
  const flipped = { ...f0, rgba: Uint8Array.from(f0.rgba) };
  const at = flipped.rgba.findIndex(
    (_v, i) => i % 4 === 0 && flipped.rgba[i + 3] !== 0,
  );
  flipped.rgba[at] = ((flipped.rgba[at] as number) + 1) & 0xff;
  return {
    sameFrameAgainstItself: compareRgba(f0, f0),
    frame0VsFrame1: compareRgba(f0, f1),
    colourVsPartId: compareRgba(f0, id0),
    oneChannelByteFlipped: compareRgba(f0, flipped),
  };
}

/** (f): formats, decodePng's view, depth levels, bytes per slot. */
export function formats(run: string): unknown {
  const root = join(RUNS, run, "render/zeus-tall");
  const first = (dir: string, suffix: string) =>
    join(root, dir, roleFiles(run, dir, suffix)[0] as string);
  const facts: Record<string, unknown> = {};
  const bytesByRole: Record<string, number> = {};
  const decodedBytes: Record<string, number> = {};
  for (const [role, dir, suffix] of ROLES) {
    const names = roleFiles(run, dir, suffix);
    facts[role] =
      names.length === 0
        ? null
        : { sample: names[0], ...describePng(first(dir, suffix)) };
    bytesByRole[role] = names.reduce(
      (s, n) => s + statSync(join(root, dir, n)).size,
      0,
    );
    decodedBytes[role] = names.reduce((s, n) => {
      const image = decodeRgba(join(root, dir, n));
      return s + (image ? image.rgba.length : 0);
    }, 0);
  }
  const depth16Names = existsSync(join(root, "depth"))
    ? readdirSync(join(root, "depth"))
        .filter((n) => n.endsWith(".depth16.png"))
        .sort()
    : [];
  let depth16: unknown = null;
  if (depth16Names.length > 0) {
    const p16 = join(root, "depth", depth16Names[0] as string);
    const p8 = join(
      root,
      "depth",
      (depth16Names[0] as string).replace(".depth16.png", ".depth.png"),
    );
    const img8 = decodeRgba(p8);
    const grey = readGrey16(p16);
    // Levels over the whole slot, not just one frame.
    const levels8 = new Set<number>();
    const levels16 = new Set<number>();
    for (const n of depth16Names) {
      const a = decodeRgba(
        join(root, "depth", n.replace(".depth16.png", ".depth.png")),
      );
      const b = readGrey16(join(root, "depth", n));
      if (a)
        for (let i = 0; i < a.rgba.length; i += 4)
          if ((a.rgba[i + 3] as number) > 0) levels8.add(a.rgba[i] as number);
      if (b) for (const v of b.samples) if (v > 0) levels16.add(v);
    }
    depth16 = {
      files: depth16Names.length,
      sample: depth16Names[0],
      facts: describePng(p16),
      firstFrame: {
        levels8: img8 ? distinctLevels8(img8) : null,
        levels16: grey ? distinctLevels16(grey) : null,
      },
      wholeSlot: { levels8: levels8.size, levels16: levels16.size },
      bytes16: depth16Names.reduce(
        (s, n) => s + statSync(join(root, "depth", n)).size,
        0,
      ),
    };
  }
  return {
    facts,
    bytesByRole,
    bytesOnDiskTotal: Object.values(bytesByRole).reduce((a, b) => a + b, 0),
    decodedRgbaBytes: decodedBytes,
    decodedRgbaTotal: Object.values(decodedBytes).reduce((a, b) => a + b, 0),
    depth16,
  };
}

/** (i): figure height from the render script's own extents, per clip. */
export function heights(run: string): {
  frames: number;
  meanHeightPx: number;
  minPx: number;
  maxPx: number;
} {
  const meta = JSON.parse(
    readFileSync(join(RUNS, run, "render/zeus-tall/meta.json"), "utf8"),
  ) as {
    frames: { extent_px: { top: number; bottom: number } }[];
  };
  const h = meta.frames.map((f) => f.extent_px.bottom - f.extent_px.top);
  return {
    frames: h.length,
    meanHeightPx: h.reduce((a, b) => a + b, 0) / h.length,
    minPx: Math.min(...h),
    maxPx: Math.max(...h),
  };
}

/** (f) control: decodePng accepts a known-good 8-bit RGBA PNG written by the repo's own encoder. */
export function pngControl(): unknown {
  const path = join(ensureDir(join(SCRATCH, "outside")), "encoder-control.png");
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = i % 251;
    rgba[i + 3] = 255;
  }
  writeFileSync(path, encodeRgbaPng(rgba, 8, 8));
  return describePng(path);
}
