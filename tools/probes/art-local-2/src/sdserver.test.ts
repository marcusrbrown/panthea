// sd-server driver mechanics against the fake HTTP/process fixture and
// inline stub servers. These establish request/poll/abort/validation
// behaviour only — not the real server's schema or any model output.

import { afterEach, describe, expect, it } from "bun:test";
import { freePort, spawnFake } from "./fixtures/util";
import type { ManagedProcess } from "./process";
import {
  buildImgGenBody,
  createSdServerDriver,
  fetchCapabilities,
  type ImgGenParams,
  SD_ROUTES,
} from "./sdserver";

const live: ManagedProcess[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((p) => p.stop()));
});

async function startFake(env: Record<string, string> = {}) {
  const port = await freePort();
  const proc = spawnFake(port, env);
  live.push(proc);
  const baseUrl = `http://127.0.0.1:${port}`;
  const ready = await proc.waitReady(
    async () => (await fetchCapabilities(baseUrl, 500)) !== null,
    { timeoutMs: 10_000, pollMs: 50 },
  );
  expect(ready.status).toBe("ready");
  return { baseUrl, proc };
}

const params: ImgGenParams = {
  prompt: "a pixel hero",
  negativePrompt: "blurry",
  width: 512,
  height: 640,
  seed: 1234,
  lora: { path: "/models/x.safetensors", multiplier: 0.8 },
  sampleParams: { sample_steps: 4 },
};

describe("buildImgGenBody", () => {
  it("sends explicit dimensions, seed, sample_params passthrough and a lora array with is_high_noise", () => {
    const body = buildImgGenBody(params);
    expect(body).toMatchObject({
      prompt: "a pixel hero",
      negative_prompt: "blurry",
      width: 512,
      height: 640,
      seed: 1234,
      sample_params: { sample_steps: 4 },
      lora: [
        {
          path: "/models/x.safetensors",
          multiplier: 0.8,
          is_high_noise: false,
        },
      ],
    });
  });

  it("sends an empty lora array for the no-LoRA control and omits a null seed", () => {
    const body = buildImgGenBody({ ...params, lora: null, seed: null });
    expect(body.lora).toEqual([]);
    expect("seed" in body).toBe(false);
  });

  it("honours configured field names and extra fields instead of hardcoded ones", () => {
    const body = buildImgGenBody(params, {
      fields: {
        prompt: "p",
        negativePrompt: "np",
        width: "w",
        height: "h",
        seed: "s",
        sampleParams: "sp",
        lora: "l",
      },
      extra: { batch_count: 1 },
    });
    expect(body).toMatchObject({
      p: "a pixel hero",
      w: 512,
      h: 640,
      s: 1234,
      batch_count: 1,
    });
    expect("width" in body).toBe(false);
  });
});

describe("createSdServerDriver against the fixture", () => {
  it("submits, polls and returns the PNG bytes; the request body reaches the server", async () => {
    const { baseUrl } = await startFake({ FAKE_JOB_MS: "60" });
    const driver = createSdServerDriver({
      baseUrl,
      makeBody: () => buildImgGenBody(params),
      pollMs: 10,
    });
    const bytes = await driver.generate({
      kind: "sample",
      index: 0,
      seed: 1234,
      signal: new AbortController().signal,
    });
    expect([...bytes.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    const last = (await (
      await fetch(`${baseUrl}/__last-body`)
    ).json()) as Record<string, unknown>;
    expect(last).toMatchObject({ width: 512, height: 640, seed: 1234 });
  });

  it("returns different bytes with and without the lora at the same seed", async () => {
    const { baseUrl } = await startFake();
    const run = async (lora: ImgGenParams["lora"]) =>
      createSdServerDriver({
        baseUrl,
        makeBody: () => buildImgGenBody({ ...params, lora }),
        pollMs: 10,
      }).generate({
        kind: "sample",
        index: 0,
        seed: 1234,
        signal: new AbortController().signal,
      });
    const withLora = await run(params.lora);
    const without = await run(null);
    expect(Buffer.from(withLora).equals(Buffer.from(without))).toBe(false);
  });

  it("rejects with the job's error when the job fails", async () => {
    const { baseUrl } = await startFake({ FAKE_FAIL_JOB: "1" });
    const driver = createSdServerDriver({
      baseUrl,
      makeBody: () => buildImgGenBody(params),
      pollMs: 10,
    });
    await expect(
      driver.generate({
        kind: "sample",
        index: 0,
        seed: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/failed.*fixture failure/s);
  });

  it("stops polling promptly when aborted mid-job", async () => {
    const { baseUrl } = await startFake({ FAKE_JOB_MS: "10000" });
    const controller = new AbortController();
    const driver = createSdServerDriver({
      baseUrl,
      makeBody: () => buildImgGenBody(params),
      pollMs: 10,
    });
    setTimeout(() => controller.abort(), 50);
    const started = performance.now();
    await expect(
      driver.generate({
        kind: "sample",
        index: 0,
        seed: 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  it("rejects clearly when the server is not reachable", async () => {
    const port = await freePort();
    const driver = createSdServerDriver({
      baseUrl: `http://127.0.0.1:${port}`,
      makeBody: () => buildImgGenBody(params),
      requestTimeoutMs: 500,
    });
    await expect(
      driver.generate({
        kind: "sample",
        index: 0,
        seed: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/not reachable|failed/);
  });
});

describe("createSdServerDriver response validation", () => {
  async function stub(handler: (url: URL) => Response) {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (r) => handler(new URL(r.url)),
    });
    return {
      baseUrl: `http://127.0.0.1:${server.port}`,
      stop: () => server.stop(true),
    };
  }
  const generate = (baseUrl: string) =>
    createSdServerDriver({ baseUrl, makeBody: () => ({}), pollMs: 5 }).generate(
      {
        kind: "sample",
        index: 0,
        seed: 1,
        signal: new AbortController().signal,
      },
    );

  it("rejects a submission without an id, naming the field", async () => {
    const s = await stub(() =>
      Response.json({ status: "queued" }, { status: 202 }),
    );
    await expect(generate(s.baseUrl)).rejects.toThrow(/\$\.id/);
    await s.stop();
  });

  it("rejects image bytes that are not a PNG", async () => {
    const s = await stub((url) =>
      url.pathname === SD_ROUTES.imgGen
        ? Response.json({ id: "j", status: "queued" }, { status: 202 })
        : Response.json({
            id: "j",
            status: "completed",
            result: {
              images: [
                { b64_json: Buffer.from("not a png").toString("base64") },
              ],
            },
          }),
    );
    await expect(generate(s.baseUrl)).rejects.toThrow(/PNG/);
    await s.stop();
  });

  it("rejects a completed job with no images", async () => {
    const s = await stub((url) =>
      url.pathname === SD_ROUTES.imgGen
        ? Response.json({ id: "j", status: "queued" }, { status: 202 })
        : Response.json({
            id: "j",
            status: "completed",
            result: { images: [] },
          }),
    );
    await expect(generate(s.baseUrl)).rejects.toThrow(/images/);
    await s.stop();
  });
});

describe("fetchCapabilities", () => {
  it("returns the raw document and cancel_generating when present", async () => {
    const { baseUrl } = await startFake();
    const caps = await fetchCapabilities(baseUrl, 1_000);
    expect(caps?.cancelGenerating).toBe(false);
    expect(caps?.raw).toMatchObject({
      features_by_mode: { img_gen: { cancel_queued: true } },
    });
  });

  it("returns null when unreachable", async () => {
    const port = await freePort();
    expect(await fetchCapabilities(`http://127.0.0.1:${port}`, 300)).toBeNull();
  });
});
