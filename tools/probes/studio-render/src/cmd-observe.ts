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
  PROBE_DIR,
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

export function profile(staging: string, out: string): string {
  const extras: string[] = existsSync(extraFile)
    ? (JSON.parse(readFileSync(extraFile, "utf8")) as string[])
    : [];
  const allow = [
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
    join(PROBE_DIR, "blender"),
    join(REPO, "tools/probes/retro-render"),
    join(REPO, "tools/probes/blender-sprite"),
    join(SCRATCH, "home"),
    join(SCRATCH, "tmp"),
    ...extras,
  ];
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-read-data)",
    "(allow file-read-data",
    '  (literal "/")',
    ...allow.map((p) => `  (subpath "${p}")`),
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
}

async function observe(spec: ObserveSpec) {
  const out = join(RUNS, `obs-${spec.label}`);
  rmSync(out, { recursive: true, force: true });
  ensureDir(out);
  ensureDir(join(SCRATCH, "sandbox"));
  const file = join(SCRATCH, `sandbox/${spec.label}.sb`);
  writeFileSync(file, profile(spec.allowedStaging, out));
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
