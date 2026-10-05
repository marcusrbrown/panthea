// Test-only HTTP+process fixture imitating the *shape* of the sd-server
// native async API (capabilities / img_gen / jobs/{id}). It proves harness
// mechanics (HTTP polling, subprocess stop, late output) — it says nothing
// about the real server's schema or any model's behaviour.
//
// Env: FAKE_PORT, FAKE_JOB_MS (generating duration), FAKE_READY_DELAY_MS,
// FAKE_IGNORE_SIGTERM=1, FAKE_LATE_STDOUT=1 (write on SIGTERM then exit),
// FAKE_FAIL_JOB=1, FAKE_BUSY_MS (spin CPU after listening),
// FAKE_ALLOC_MB (resident allocation).
// Log evidence: FAKE_LOG_EARLY (line printed first), FAKE_LOG_FILLER_KB
// (filler lines after it), FAKE_LOG_LATE (line printed when a job starts),
// FAKE_CRASH_ON_JOB=1 (print a crash line, flush, then SIGABRT on the first
// job, like a native abort).
// Restart behaviour: FAKE_START_MARKER (a path) is created by the first
// launch; a launch that finds it already there is a replacement, and
// FAKE_ON_RESTART=exit7 makes it exit 7 at once, =never-ready makes it stay
// alive without ever listening.

import { existsSync, writeFileSync } from "node:fs";

const port = Number(process.env.FAKE_PORT);
const jobMs = Number(process.env.FAKE_JOB_MS ?? 20);
const readyDelayMs = Number(process.env.FAKE_READY_DELAY_MS ?? 0);
const failJob = process.env.FAKE_FAIL_JOB === "1";
const allocMb = Number(process.env.FAKE_ALLOC_MB ?? 0);
const busyMs = Number(process.env.FAKE_BUSY_MS ?? 0);

// FAKE_ALLOC_MB is resident memory the arm's sampler is meant to observe, so it
// must be real, held, and visible before the server says it is ready. The buffer
// hangs off globalThis (not a module-scope const the engine may treat as dead),
// every page is written, and the server does not listen until its own RSS shows
// the allocation (bounded: a platform that never shows it listens anyway, so
// the arm reports what the sampler saw instead of timing out).
function holdResident(mb: number): void {
  const bytes = mb * 1024 * 1024;
  const held = Buffer.alloc(bytes, 1);
  (globalThis as { __fakeResident?: Buffer }).__fakeResident = held;
  const deadline = Date.now() + 2_000;
  while (process.memoryUsage().rss < bytes && Date.now() < deadline) {
    held.fill(2);
    held.fill(1);
  }
}
if (allocMb > 0) holdResident(allocMb);

if (process.env.FAKE_LOG_EARLY) {
  process.stdout.write(`${process.env.FAKE_LOG_EARLY}\n`);
}
for (let i = 0; i < Number(process.env.FAKE_LOG_FILLER_KB ?? 0); i++) {
  process.stdout.write(`${"x".repeat(1023)}\n`);
}

if (process.env.FAKE_IGNORE_SIGTERM === "1") {
  process.on("SIGTERM", () => {});
} else if (process.env.FAKE_LATE_STDOUT === "1") {
  process.on("SIGTERM", () => {
    process.stdout.write("late-result\n");
    setTimeout(() => process.exit(0), 30);
  });
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(
    8 + data.length,
    Bun.hash.crc32(out.subarray(4, 8 + data.length)) >>> 0,
  );
  return out;
}

/** Distinct tiny 2x2 PNG per (seed, lora present, width). */
function tinyPng(seed: number, hasLora: boolean, width: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 2);
  view.setUint32(4, 2);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = new Uint8Array(2 * 9);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      const o = y * 9 + 1 + x * 4;
      raw[o] = (seed + x) & 255;
      raw[o + 1] = hasLora ? 200 : 20;
      raw[o + 2] = (width + y) & 255;
      raw[o + 3] = 255;
    }
  }
  return Buffer.concat([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", Bun.deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

interface Job {
  readonly id: string;
  readonly readyAt: number;
  readonly png: Uint8Array;
}

const jobs = new Map<string, Job>();
let counter = 0;
let lastBody: unknown = null;

function startServer(): void {
  Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      if (
        request.method === "GET" &&
        url.pathname === "/sdcpp/v1/capabilities"
      ) {
        return Response.json({
          features_by_mode: {
            img_gen: { cancel_queued: true, cancel_generating: false },
          },
        });
      }
      if (request.method === "GET" && url.pathname === "/__last-body") {
        return Response.json(lastBody);
      }
      if (request.method === "POST" && url.pathname === "/sdcpp/v1/img_gen") {
        const body = (await request.json()) as Record<string, unknown>;
        lastBody = body;
        if (process.env.FAKE_LOG_LATE) {
          process.stdout.write(`${process.env.FAKE_LOG_LATE}\n`);
        }
        if (process.env.FAKE_CRASH_ON_JOB === "1") {
          process.stderr.write(
            "fixture abort: simulated native failure\n",
            () => process.kill(process.pid, "SIGABRT"),
          );
          return new Promise<Response>(() => {});
        }
        counter += 1;
        const id = `job-${counter}`;
        const lora = Array.isArray(body.lora) && body.lora.length > 0;
        jobs.set(id, {
          id,
          readyAt: Date.now() + jobMs,
          png: tinyPng(Number(body.seed ?? 0), lora, Number(body.width ?? 0)),
        });
        return Response.json(
          {
            id,
            kind: "img_gen",
            status: "queued",
            created: 1,
            poll_url: `/sdcpp/v1/jobs/${id}`,
          },
          { status: 202 },
        );
      }
      const match = url.pathname.match(/^\/sdcpp\/v1\/jobs\/([^/]+)$/);
      if (request.method === "GET" && match) {
        const job = jobs.get(match[1] as string);
        if (!job)
          return Response.json(
            { error: { code: "not_found" } },
            { status: 404 },
          );
        if (Date.now() < job.readyAt) {
          return Response.json({
            id: job.id,
            kind: "img_gen",
            status: "generating",
            created: 1,
          });
        }
        if (failJob) {
          return Response.json({
            id: job.id,
            kind: "img_gen",
            status: "failed",
            created: 1,
            error: { code: "boom", message: "fixture failure" },
          });
        }
        return Response.json({
          id: job.id,
          kind: "img_gen",
          status: "completed",
          created: 1,
          result: {
            images: [
              { index: 0, b64_json: Buffer.from(job.png).toString("base64") },
            ],
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  // Every line this fixture logs goes through process.stdout.write, never
  // console.log: after the 100 KB of filler a test asks for, the stdout pipe is
  // full, and on Linux with a busy parent a console.log line written then was
  // dropped (this one, 20 of 60 runs), while process.stdout.write waits for room.
  process.stdout.write(`listening ${port}\n`);
  if (busyMs > 0) {
    const end = Date.now() + busyMs;
    const spin = () => {
      const stopAt = Date.now() + 40;
      while (Date.now() < stopAt) {
        // burn cpu
      }
      if (Date.now() < end) setTimeout(spin, 1);
    };
    spin();
  }
}

const startMarker = process.env.FAKE_START_MARKER;
const replacement = startMarker !== undefined && existsSync(startMarker);
if (startMarker !== undefined && !replacement) {
  writeFileSync(startMarker, "started");
}
if (replacement && process.env.FAKE_ON_RESTART === "exit7") {
  process.exit(7);
}

if (replacement && process.env.FAKE_ON_RESTART === "never-ready") {
  setInterval(() => {}, 1000);
} else if (readyDelayMs > 0) {
  setTimeout(startServer, readyDelayMs);
} else {
  startServer();
}
