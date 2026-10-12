// Criterion h: staging isolation observed independently of the script. The
// render runs under a sandbox profile that denies file-read-data everywhere and
// then allows an explicit list; the kernel's own Sandbox denial records (read
// with `log show` after the run) are the observation. Positive controls plant
// a texture and a buffer outside staging, and read a file from inside the
// sandboxed Blender, and the unstaged kit root must be refused.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeRgbaPng } from "../../../../packages/assets/src/placeholder";
import { countPngs, pickEnv, runToCompletion, savedEnvKeys } from "./blender";
import { listFiles, STAGING, sha256, stage, writeResult } from "./cmd-render";
import {
  BLENDER_BUNDLE,
  ensureDir,
  mainCheckout,
  REPO,
  RUNS,
  SCRATCH,
} from "./paths";

const DATA_EXTENSION = /\.(gltf|glb|bin|png|jpe?g|webp|hdr|exr|blend)$/i;

interface Denial {
  readonly process: string;
  readonly pid: number;
  readonly path: string;
}

function logTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function readDenials(sinceMs: number): Denial[] {
  const result = spawnSync(
    "log",
    [
      "show",
      "--start",
      logTime(sinceMs - 2000),
      "--style",
      "compact",
      "--predicate",
      'eventMessage CONTAINS "deny(1) file-read-data"',
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const out: Denial[] = [];
  for (const line of result.stdout.split("\n")) {
    const match = /Sandbox: (\S+)\((\d+)\) deny\(1\) file-read-data (.+)$/.exec(
      line,
    );
    if (match)
      out.push({
        process: match[1] as string,
        pid: Number(match[2]),
        path: match[3] as string,
      });
  }
  return out;
}

const extraFile = join(SCRATCH, "sandbox/extra-allow.json");

/**
 * The repo files the render reads, one literal each (found from the render's own
 * `repo_files_loaded` and the data files it opens). Whole script directories are
 * never allowed, so a `models/` tree beside them stays denied.
 */
export const SCRIPT_FILES: readonly string[] = [
  "tools/probes/blender-sprite/proxy_plan.py",
  "tools/probes/blender-sprite/render.py",
  "tools/probes/blender-sprite/sprite_plan.py",
  "tools/probes/blender-sprite/zeus_proxy.py",
  "tools/probes/blender-sprite/pose_offsets.json",
  "tools/probes/retro-render/palette_plan.py",
  "tools/probes/retro-render/render_retro.py",
  "tools/probes/retro-render/retro_assets.py",
  "tools/probes/retro-render/retro_lib.py",
  "tools/probes/retro-render/retro_paths.py",
  "tools/probes/retro-render/retro_plan.py",
  "tools/probes/retro-render/tile_geom.py",
  "tools/probes/retro-render/wind_plan.py",
  "tools/probes/retro-render/palette/scene-palette.json",
  "tools/probes/studio-render/blender/probe_render.py",
];

/** Directories whose own listing the import system reads (names only, never their contents). */
const SCRIPT_DIRS: readonly string[] = [
  "tools/probes/blender-sprite",
  "tools/probes/retro-render",
  "tools/probes/studio-render/blender",
];

export function profile(staging: string, out: string): string {
  const extras: string[] = existsSync(extraFile)
    ? (JSON.parse(readFileSync(extraFile, "utf8")) as string[])
    : [];
  const subpaths = [
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library",
    "/private/etc",
    "/dev",
    BLENDER_BUNDLE,
    staging,
    out,
    join(SCRATCH, "home"),
    join(SCRATCH, "tmp"),
    ...extras,
  ];
  const literals = [
    "/",
    ...SCRIPT_DIRS.map((p) => join(REPO, p)),
    ...SCRIPT_FILES.map((p) => join(REPO, p)),
  ];
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-read-data)",
    "(allow file-read-data",
    ...literals.map((p) => `  (literal "${p}")`),
    ...subpaths.map((p) => `  (subpath "${p}")`),
    ")",
    "",
  ].join("\n");
}

interface ObserveSpec {
  readonly label: string;
  readonly mode: "slot" | "read";
  readonly models?: string;
  readonly allowedStaging: string;
  readonly readPath?: string;
  /** Replaces the generated profile (used only by the broad-allow control). */
  readonly profileText?: (staging: string, out: string) => string;
}

async function observe(spec: ObserveSpec) {
  const out = join(RUNS, `obs-${spec.label}`);
  rmSync(out, { recursive: true, force: true });
  ensureDir(out);
  ensureDir(join(SCRATCH, "sandbox"));
  const file = join(SCRATCH, `sandbox/${spec.label}.sb`);
  writeFileSync(file, (spec.profileText ?? profile)(spec.allowedStaging, out));
  const result = await runToCompletion({
    name: spec.label,
    mode: spec.mode,
    scriptArgs: [
      "--out",
      out,
      ...(spec.models ? ["--models", spec.models] : []),
      ...(spec.readPath ? ["--path", spec.readPath] : []),
      "--clip",
      "walk16",
      "--facing",
      "south",
    ],
    outDir: out,
    colourDir: join(out, "render/zeus-tall/toon"),
    env: pickEnv(savedEnvKeys()),
    wrapper: { binary: "/usr/bin/sandbox-exec", args: ["-f", file] },
    timeoutMs: 400_000,
  });
  await Bun.sleep(3000);
  const all = readDenials(result.spawnEpochMs);
  const mine = all.filter((d) => d.pid === result.pid);
  const others = [
    ...new Set(all.filter((d) => d.pid !== result.pid).map((d) => d.process)),
  ];
  const unique = [...new Map(mine.map((d) => [d.path, d])).values()]
    .map((d) => d.path)
    .sort();
  const main = mainCheckout();
  return {
    label: spec.label,
    exitCode: result.exitCode,
    exitSignal: result.exitSignal,
    durationMs: result.durationMs,
    pngs: countPngs(out),
    sentinelPresent: existsSync(join(out, "probe-done.json")),
    probeLines: result.stdoutTail
      .split("\n")
      .filter((l) => l.includes("PROBE"))
      .map((l) => l.slice(0, 240)),
    deniedReadsByThisPid: mine.length,
    deniedPaths: unique,
    deniedKitOrDataPaths: unique.filter(
      (p) =>
        DATA_EXTENSION.test(p) ||
        p.startsWith(`${main}/`) ||
        p.includes("/tools/probes/retro-render/models") ||
        p.includes("/blender-sprite/models"),
    ),
    otherProcessesWithDenialsInWindow: others,
    stderrTail: result.stderrTail.slice(-400),
  };
}

function plant(): { texture: string; buffer: string; sanity: string } {
  const outside = ensureDir(join(SCRATCH, "outside"));
  const texture = join(outside, "planted-texture.png");
  writeFileSync(
    texture,
    encodeRgbaPng(new Uint8Array(4 * 4 * 4).fill(200), 4, 4),
  );
  const buffer = join(outside, "planted.bin");
  const sanity = join(outside, "sanity.txt");
  writeFileSync(sanity, "outside the allow-list\n");
  return { texture, buffer, sanity };
}

const BEARD =
  "retro-render/models/Universal Base Characters[Standard]/Universal Base Characters[Standard]/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)";

function editBeard(
  root: string,
  change: (doc: {
    images?: { uri?: string }[];
    buffers?: { uri?: string }[];
  }) => void,
): void {
  const path = join(root, BEARD, "Hair_Beard.gltf");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  change(doc);
  writeFileSync(path, JSON.stringify(doc));
}

export async function observeStep(which: string): Promise<void> {
  const planted = plant();
  if (!existsSync(STAGING)) stage(STAGING);
  const results: unknown[] = [];
  const want = (name: string) => which === "all" || which === name;
  if (want("staged"))
    results.push(
      await observe({
        label: "staged",
        mode: "slot",
        models: STAGING,
        allowedStaging: STAGING,
      }),
    );
  if (want("sanity"))
    results.push(
      await observe({
        label: "sanity-read",
        mode: "read",
        allowedStaging: STAGING,
        readPath: planted.sanity,
      }),
    );
  if (want("planted-texture")) {
    const dir = join(SCRATCH, "staging-planted-texture");
    stage(dir);
    editBeard(dir, (doc) => {
      if (doc.images?.[0]) doc.images[0].uri = planted.texture;
    });
    results.push(
      await observe({
        label: "planted-texture",
        mode: "slot",
        models: dir,
        allowedStaging: dir,
      }),
    );
  }
  if (want("planted-buffer")) {
    const dir = join(SCRATCH, "staging-planted-buffer");
    stage(dir);
    const real = join(dir, BEARD, "Hair_Beard.bin");
    writeFileSync(planted.buffer, readFileSync(real));
    editBeard(dir, (doc) => {
      if (doc.buffers?.[0]) doc.buffers[0].uri = planted.buffer;
    });
    results.push(
      await observe({
        label: "planted-buffer",
        mode: "slot",
        models: dir,
        allowedStaging: dir,
      }),
    );
  }
  if (which === "repo-models") {
    // A normal checkout: the kit pack directories sit under this repo's own script directories.
    const models = join(REPO, "tools/probes/retro-render/models");
    const planted_in_repo = join(models, "planted-control.bin");
    const created = !existsSync(models);
    ensureDir(models);
    writeFileSync(
      planted_in_repo,
      "planted kit-like file under a models directory\n",
    );
    try {
      results.push(
        await observe({
          label: "repo-models-narrow",
          mode: "read",
          allowedStaging: STAGING,
          readPath: planted_in_repo,
        }),
      );
      results.push(
        await observe({
          label: "repo-models-broad-control",
          mode: "read",
          allowedStaging: STAGING,
          readPath: planted_in_repo,
          profileText: (staging, out) =>
            `${profile(staging, out)}(allow file-read-data (subpath "${join(REPO, "tools/probes/retro-render")}"))\n`,
        }),
      );
    } finally {
      rmSync(planted_in_repo, { force: true });
      if (created) rmSync(models, { recursive: true, force: true });
    }
  }
  if (want("unstaged"))
    results.push(
      await observe({
        label: "unstaged-kit-root",
        mode: "slot",
        models: join(mainCheckout(), "tools/probes"),
        allowedStaging: STAGING,
      }),
    );
  const previous = existsSync(join(SCRATCH, "results/observe.json"))
    ? (
        JSON.parse(
          readFileSync(join(SCRATCH, "results/observe.json"), "utf8"),
        ) as { runs: { label: string }[] }
      ).runs
    : [];
  const merged = [
    ...previous.filter(
      (r) => !(results as { label: string }[]).some((n) => n.label === r.label),
    ),
    ...results,
  ];
  writeResult("observe", {
    runs: merged,
    allowExtras: existsSync(extraFile)
      ? JSON.parse(readFileSync(extraFile, "utf8"))
      : [],
    stagingFiles: listFiles(STAGING).map((f) => ({
      path: f.slice(STAGING.length + 1),
      sha256: sha256(f),
    })),
  });
}
