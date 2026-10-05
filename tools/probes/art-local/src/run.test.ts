// CLI smoke tests for the `suite` command's --model resolution (see
// resolveDefaultSdCppModel in run.ts). Each test spawns the real CLI as a
// subprocess against a `Bun.serve` stub of sd-server's native async API
// (`/sdcpp/v1/img_gen` + `/sdcpp/v1/jobs/{id}`, returning a tiny PNG
// immediately) and a disposable temp directory (via the
// `ART_LOCAL_RESULTS_DIR`/`ART_LOCAL_MODELS_DIR` env var overrides) — no
// network, no real model, no shared state with the probe's real
// results/models.
//
// This exists because a prior README documented `suite --arm sd.cpp`
// without `--model`, but the runner required it and would reject the
// documented invocation outright — these tests exercise both the
// documented explicit-flag invocation and the omitted-flag fallback so
// that regression is caught here, not by a human copy-pasting the README.

import { describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeRgbaPng } from "@panthea/assets";

const RUN_TS_PATH = join(import.meta.dir, "run.ts");

// A 1x1 opaque red RGBA PNG (color type 6), base64-encoded via this
// probe's own encoder — guaranteed decodable by bench.ts's contact-sheet
// PNG decoder, unlike an arbitrary hand-picked fixture that might use a
// color type (e.g. grayscale+alpha) this probe never actually receives
// from either real arm.
const TINY_PNG_BASE64 = Buffer.from(
  encodeRgbaPng(Uint8Array.from([255, 0, 0, 255]), 1, 1),
).toString("base64");

function startSdServerStub(): { readonly url: string; stop: () => void } {
  let jobCounter = 0;
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/sdcpp/v1/capabilities" && req.method === "GET") {
        return Response.json({
          model: { name: "stub", stem: "stub", path: "stub" },
          features_by_mode: {
            img_gen: { cancel_queued: true, cancel_generating: false },
          },
        });
      }
      if (url.pathname === "/sdcpp/v1/img_gen" && req.method === "POST") {
        jobCounter += 1;
        const id = `job_smoke_${jobCounter}`;
        return Response.json(
          {
            id,
            kind: "img_gen",
            status: "queued",
            created: Math.floor(Date.now() / 1000),
            poll_url: `/sdcpp/v1/jobs/${id}`,
          },
          { status: 202 },
        );
      }
      if (url.pathname.startsWith("/sdcpp/v1/jobs/") && req.method === "GET") {
        const id = url.pathname.slice("/sdcpp/v1/jobs/".length);
        return Response.json({
          id,
          kind: "img_gen",
          status: "completed",
          created: Math.floor(Date.now() / 1000),
          started: Math.floor(Date.now() / 1000),
          completed: Math.floor(Date.now() / 1000),
          queue_position: 0,
          result: {
            output_format: "png",
            images: [{ index: 0, b64_json: TINY_PNG_BASE64 }],
          },
          error: null,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

// `Bun.spawn` (async), not `Bun.spawnSync`: the stub server below runs in
// this same test process via `Bun.serve`, which needs the event loop free
// to accept and answer the spawned CLI's HTTP requests. A synchronous
// spawn would block that event loop while waiting for the child, and the
// child would in turn block forever waiting for a response the parent can
// never send — a same-process deadlock, not a slow test.
async function runSuiteCli(
  args: readonly string[],
  env: Record<string, string>,
): Promise<{ readonly exitCode: number; readonly stderr: string }> {
  const proc = Bun.spawn(["bun", "run", RUN_TS_PATH, "suite", ...args], {
    env: { ...process.env, ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stderr };
}

describe("suite --arm sd.cpp: --model resolution", () => {
  it("runs the documented invocation (explicit --model) and writes a suite record", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "art-local-run-explicit-"));
    const stub = startSdServerStub();
    try {
      const resultsDir = join(tempDir, "results");
      mkdirSync(resultsDir, { recursive: true });
      const readmePath = join(tempDir, "README.md");

      const { exitCode, stderr } = await runSuiteCli(
        [
          "--arm",
          "sd.cpp",
          "--base-url",
          stub.url,
          "--model",
          "sd-v1-5-pruned-emaonly-Q4_0",
          "--width",
          "64",
          "--height",
          "64",
          "--steps",
          "1",
          "--label",
          "smoke-explicit",
        ],
        {
          ART_LOCAL_RESULTS_DIR: resultsDir,
          ART_LOCAL_README_PATH: readmePath,
        },
      );

      expect(stderr).not.toContain("failed to decode");
      expect(exitCode).toBe(0);

      const record = JSON.parse(
        readFileSync(join(resultsDir, "smoke-explicit.json"), "utf8"),
      );
      expect(record.kind).toBe("arm");
      expect(record.arm).toBe("sd.cpp");
      expect(record.model).toBe("sd-v1-5-pruned-emaonly-Q4_0");
      expect(record.n).toBeGreaterThan(0);
      expect(record.errors).toEqual([]);
    } finally {
      stub.stop();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves --model from the single checkpoint under models/ when omitted", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "art-local-run-implicit-"));
    const stub = startSdServerStub();
    try {
      const resultsDir = join(tempDir, "results");
      const modelsDir = join(tempDir, "models");
      mkdirSync(resultsDir, { recursive: true });
      mkdirSync(modelsDir, { recursive: true });
      writeFileSync(join(modelsDir, "only-checkpoint.gguf"), "fake weights");
      const readmePath = join(tempDir, "README.md");

      const { exitCode, stderr } = await runSuiteCli(
        [
          "--arm",
          "sd.cpp",
          "--base-url",
          stub.url,
          "--width",
          "64",
          "--height",
          "64",
          "--steps",
          "1",
          "--label",
          "smoke-implicit",
        ],
        {
          ART_LOCAL_RESULTS_DIR: resultsDir,
          ART_LOCAL_README_PATH: readmePath,
          ART_LOCAL_MODELS_DIR: modelsDir,
        },
      );

      expect(exitCode).toBe(0);
      expect(stderr).toContain("resolved sd.cpp model: only-checkpoint");

      const record = JSON.parse(
        readFileSync(join(resultsDir, "smoke-implicit.json"), "utf8"),
      );
      expect(record.model).toBe("only-checkpoint");
    } finally {
      stub.stop();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails with a clear, candidate-listing error when models/ has more than one checkpoint and --model is omitted", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "art-local-run-ambiguous-"));
    const stub = startSdServerStub();
    try {
      const resultsDir = join(tempDir, "results");
      const modelsDir = join(tempDir, "models");
      mkdirSync(resultsDir, { recursive: true });
      mkdirSync(modelsDir, { recursive: true });
      writeFileSync(join(modelsDir, "a.gguf"), "fake weights a");
      writeFileSync(join(modelsDir, "b.safetensors"), "fake weights b");

      const { exitCode, stderr } = await runSuiteCli(
        [
          "--arm",
          "sd.cpp",
          "--base-url",
          stub.url,
          "--width",
          "64",
          "--height",
          "64",
          "--steps",
          "1",
          "--label",
          "smoke-ambiguous",
        ],
        {
          ART_LOCAL_RESULTS_DIR: resultsDir,
          ART_LOCAL_MODELS_DIR: modelsDir,
        },
      );

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("2 checkpoints were found");
      expect(stderr).toContain("a.gguf");
      expect(stderr).toContain("b.safetensors");
    } finally {
      stub.stop();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails with a clear error when models/ has no checkpoint and --model is omitted", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "art-local-run-empty-"));
    const stub = startSdServerStub();
    try {
      const resultsDir = join(tempDir, "results");
      const modelsDir = join(tempDir, "models");
      mkdirSync(resultsDir, { recursive: true });
      mkdirSync(modelsDir, { recursive: true });

      const { exitCode, stderr } = await runSuiteCli(
        [
          "--arm",
          "sd.cpp",
          "--base-url",
          stub.url,
          "--width",
          "64",
          "--height",
          "64",
          "--steps",
          "1",
          "--label",
          "smoke-empty",
        ],
        {
          ART_LOCAL_RESULTS_DIR: resultsDir,
          ART_LOCAL_MODELS_DIR: modelsDir,
        },
      );

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("no checkpoint");
    } finally {
      stub.stop();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
