// Test-only fake sd-server and the helpers that stage it as an artifact root.
// Run as `bun _test-runtime.ts <behaviorFile> <sd-server flags>`; the staged
// `bin/sd-server` wrapper does exactly that. Behaviour is re-read from the
// behavior file on every request, and every event is appended to log.jsonl
// beside it, so tests can see what the process was asked and what it did.

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { sha256Hex } from "../hash";
import { encodeRgbaPng } from "../placeholder";
import { SELECTED_PROFILE, type SelectedProfile } from "./provider";

export type Mode =
  | "ok"
  | "failed"
  | "http-500"
  | "bad-json"
  | "bad-status"
  | "no-images"
  | "two-images"
  | "bad-base64"
  | "not-png"
  | "truncated-png"
  | "grayscale-png"
  | "wrong-size"
  | "hang";

export interface Behavior {
  exitOnStart?: number;
  startupDelayMs?: number;
  ignoreTerm?: boolean;
  /** The exit code of the `--warm` run that staging makes once. */
  warmExit?: number;
  grandchild?: boolean;
  jobDelayMs?: number;
  /** A PNG file served as the image of every "ok" job instead of the generated pattern. */
  image?: string;
  /** Mode per img_gen submission, counted across processes; the last repeats. */
  sequence?: Mode[];
}

export interface LogEvent {
  pid: number;
  event: string;
  [key: string]: unknown;
}

export function testImage(width: number, height: number) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      rgba[at] = x & 255;
      rgba[at + 1] = y & 255;
      rgba[at + 2] = (x * 3 + y) & 255;
      rgba[at + 3] = x % 5 === 0 ? 0 : 255;
    }
  }
  return { rgba, png: encodeRgbaPng(rgba, width, height) };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes)
    c = (CRC_TABLE[(c ^ byte) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

/** The PNG with a tRNS chunk after its header, which the studio decoder refuses as unsupported. */
export function withTransparencyChunk(png: Uint8Array): Uint8Array {
  const trns = chunk("tRNS", new Uint8Array(6));
  const at = 8 + 12 + 13;
  const out = new Uint8Array(png.length + trns.length);
  out.set(png.subarray(0, at));
  out.set(trns, at);
  out.set(png.subarray(at), at + trns.length);
  return out;
}

/** A valid 8-bit grayscale PNG, which the studio decoder refuses as unsupported. */
export function grayscalePng(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = new Uint8Array((width + 1) * height);
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function completed(
  mode: Mode,
  width: number,
  height: number,
  imagePath: string | undefined,
): Response {
  const image = (bytes: Uint8Array) => ({ b64_json: b64(bytes) });
  const ok =
    imagePath === undefined
      ? testImage(width, height).png
      : new Uint8Array(readFileSync(imagePath));
  const images: Record<string, unknown[]> = {
    ok: [image(ok)],
    "no-images": [],
    "two-images": [image(ok), image(ok)],
    "bad-base64": [{ b64_json: "!!not base64!!" }],
    "not-png": [image(new TextEncoder().encode("not a png"))],
    "truncated-png": [image(ok.slice(0, Math.floor(ok.length / 2)))],
    "grayscale-png": [image(grayscalePng(4, 4))],
    "wrong-size": [image(testImage(8, 8).png)],
  };
  return Response.json({
    status: "completed",
    result: { images: images[mode] ?? [] },
  });
}

function main(): void {
  const [behaviorPath, ...flags] = process.argv.slice(2) as [
    string,
    ...string[],
  ];
  const dir = dirname(behaviorPath);
  const logPath = join(dir, "log.jsonl");
  const log = (event: string, extra: Record<string, unknown> = {}) =>
    appendFileSync(
      logPath,
      `${JSON.stringify({ pid: process.pid, event, ...extra })}\n`,
    );
  const behavior = (): Behavior =>
    JSON.parse(readFileSync(behaviorPath, "utf8"));
  const port = Number(flags[flags.indexOf("--listen-port") + 1]);

  // A warm-up run only loads the fixture: no handlers, no log, no listener.
  if (flags.includes("--warm")) process.exit(behavior().warmExit ?? 0);

  if (behavior().ignoreTerm) process.on("SIGTERM", () => log("term-ignored"));
  else
    process.on("SIGTERM", () => {
      log("term");
      process.exit(0);
    });

  log("start", { argv: flags });
  const initial = behavior();
  if (initial.exitOnStart !== undefined) {
    console.error("fixture: refusing to start");
    process.exit(initial.exitOnStart);
  }
  if (initial.grandchild) {
    spawn(process.execPath, [import.meta.path, "--grand", behaviorPath], {
      detached: false,
      stdio: ["ignore", "inherit", "inherit"],
    });
  }

  const jobs = new Map<string, { at: number; mode: Mode; n: number }>();
  const submissions = () =>
    readFileSync(logPath, "utf8")
      .split("\n")
      .filter((line) => line.includes('"event":"img_gen"')).length;

  setTimeout(() => {
    Bun.serve({
      hostname: "127.0.0.1",
      port,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/sdcpp/v1/capabilities") {
          log("capabilities");
          return Response.json({
            features_by_mode: { img_gen: { cancel_generating: false } },
          });
        }
        if (url.pathname === "/sdcpp/v1/img_gen" && request.method === "POST") {
          const body = (await request.json()) as {
            width: number;
            height: number;
          };
          log("img_gen", { body });
          const n = submissions();
          const sequence = behavior().sequence ?? ["ok"];
          const mode = sequence[Math.min(n, sequence.length) - 1] ?? "ok";
          if (mode === "http-500") return new Response("boom", { status: 500 });
          const id = `fixture-job-${process.pid}-${n}`;
          jobs.set(id, { at: Date.now(), mode, n });
          setTimeout(
            () => log("output-ready", { id }),
            behavior().jobDelayMs ?? 0,
          );
          return Response.json(
            { id, poll_url: `/sdcpp/v1/jobs/${encodeURIComponent(id)}` },
            { status: 202 },
          );
        }
        const match = /^\/sdcpp\/v1\/jobs\/(.+)$/.exec(url.pathname);
        if (match && request.method === "GET") {
          const id = decodeURIComponent(match[1] as string);
          const job = jobs.get(id);
          log("poll", { id });
          if (!job) return new Response("unknown job", { status: 404 });
          const ready =
            job.mode !== "hang" &&
            Date.now() - job.at >= (behavior().jobDelayMs ?? 0);
          if (!ready) return Response.json({ status: "generating" });
          if (job.mode === "failed")
            return Response.json({
              status: "failed",
              error: { message: "fixture says no" },
            });
          if (job.mode === "bad-json")
            return new Response("not json", { status: 200 });
          if (job.mode === "bad-status")
            return Response.json({ status: "weird" });
          const submitted = readLogBody(logPath, job.n);
          return completed(
            job.mode,
            submitted.width,
            submitted.height,
            behavior().image,
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    log("listening", { port });
  }, initial.startupDelayMs ?? 0);
}

function readLogBody(
  logPath: string,
  n: number,
): { width: number; height: number } {
  const lines = readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.includes('"event":"img_gen"'));
  const entry = JSON.parse(lines[n - 1] as string) as {
    body: { width: number; height: number };
  };
  return entry.body;
}

function grand(behaviorPath: string): void {
  const log = join(dirname(behaviorPath), "log.jsonl");
  process.on("SIGTERM", () => {});
  appendFileSync(
    log,
    `${JSON.stringify({ pid: process.pid, event: "grand" })}\n`,
  );
  setInterval(() => {}, 1000);
}

if (import.meta.main) {
  if (process.argv[2] === "--grand") grand(process.argv[3] as string);
  else main();
}

export function writeBehavior(dir: string, behavior: Behavior): void {
  writeFileSync(join(dir, "bin", "behavior.json"), JSON.stringify(behavior));
}

export function readLog(dir: string): LogEvent[] {
  try {
    return readFileSync(join(dir, "bin", "log.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogEvent);
  } catch {
    return [];
  }
}

/** Writes an artifact root whose pinned files are the fixture's own, with matching sizes and hashes. */
export function stageFixtureRuntime(
  dir: string,
  behavior: Behavior,
): SelectedProfile {
  mkdirSync(join(dir, "bin"), { recursive: true });
  mkdirSync(join(dir, "models"), { recursive: true });
  writeBehavior(dir, behavior);
  const wrapper = `#!/bin/sh\nexec '${process.execPath}' '${import.meta.path}' '${join(dir, "bin", "behavior.json")}' "$@"\n`;
  const binary = join(dir, "bin", "sd-server");
  writeFileSync(binary, wrapper);
  chmodSync(binary, 0o755);
  // The first exec of a freshly written wrapper can take hundreds of
  // milliseconds on the host; take that cost here, not inside a startup
  // deadline the fixture's first real start is measured against.
  const warmed = spawnSync(binary, ["--warm"], {
    env: {},
    timeout: 30_000,
    killSignal: "SIGKILL",
    encoding: "utf8",
  });
  if (warmed.status !== 0)
    throw new Error(
      `fixture warm-up failed: ${warmed.error?.message ?? `exit ${warmed.status}, signal ${warmed.signal}`}`,
    );
  const component = (role: string, id: string, file: string, text: string) => {
    const bytes = new TextEncoder().encode(text);
    writeFileSync(join(dir, file), bytes);
    return {
      role,
      id,
      file,
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
      license: "fixture",
    };
  };
  const wrapperBytes = new TextEncoder().encode(wrapper);
  return {
    runtime: {
      id: "fixture-sd-server",
      commit: "fixture",
      license: "fixture",
      archive: {
        file: "bin/sd-release.zip",
        sizeBytes: 0,
        sha256: sha256Hex(new Uint8Array()),
      },
      binary: { path: "bin/sd-server", sha256: sha256Hex(wrapperBytes) },
    },
    components: [
      component(
        "diffusion-model",
        "fixture-diffusion",
        "models/diffusion.bin",
        "diffusion",
      ),
      component(
        "text-encoder",
        "fixture-encoder",
        "models/encoder.bin",
        "encoder",
      ),
      component("vae", "fixture-vae", "models/vae.bin", "vae"),
    ],
    serverFlags: SELECTED_PROFILE.serverFlags,
    sampling: SELECTED_PROFILE.sampling,
    edit: SELECTED_PROFILE.edit,
    negativePrompt: SELECTED_PROFILE.negativePrompt,
    measuredCells: SELECTED_PROFILE.measuredCells,
    generationScale: SELECTED_PROFILE.generationScale,
  };
}
