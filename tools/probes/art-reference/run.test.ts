import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  buildImgGenBody,
  checkCapabilities,
  DEFAULT_SETTINGS,
  type Deps,
  encodeRef,
  HEIGHT,
  NEGATIVE_PROMPT,
  POLL_MS,
  type RefName,
  ROUTES,
  RUNS,
  runProbe,
  SEED,
  WIDTH,
} from "./run";

const PNG_HEAD = [137, 80, 78, 71, 13, 10, 26, 10];
const idleBytes = new Uint8Array([...PNG_HEAD, 1, 2, 3, 4]);
const seatedBytes = new Uint8Array([...PNG_HEAD, 9, 8, 7]);
const outputBytes = new Uint8Array([...PNG_HEAD, 42, 43, 44, 45, 46]);

const params = {
  prompt: "a prompt",
  negativePrompt: "a negative",
  seed: SEED,
  width: WIDTH,
  height: HEIGHT,
  settings: DEFAULT_SETTINGS,
};

const capabilities = (refImages: boolean | undefined) =>
  JSON.stringify({
    features: refImages === undefined ? {} : { ref_images: refImages },
    features_by_mode:
      refImages === undefined ? {} : { img_gen: { ref_images: refImages } },
  });

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body?: string;
}

/** Scripted fake: no sockets, no clock, no sleeping. */
function fakeDeps(options: {
  readonly caps: { status: number; text: string };
  readonly jobStatuses?: readonly string[];
  readonly rss?: readonly (number | null)[];
  readonly existing?: readonly string[];
  readonly submit?: { status: number; text: string };
}) {
  const calls: Call[] = [];
  const writes = new Map<string, Uint8Array>();
  const logs: Record<string, unknown>[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  let polls = 0;
  let rssAt = 0;
  const statuses = options.jobStatuses ?? ["queued", "generating", "completed"];
  const deps: Deps = {
    async http(method, path, body) {
      calls.push({ method, path, body });
      if (path === ROUTES.capabilities) return options.caps;
      if (method === "POST") {
        return (
          options.submit ?? {
            status: 202,
            text: JSON.stringify({ id: "job-1", status: "queued" }),
          }
        );
      }
      const status = statuses[Math.min(polls, statuses.length - 1)];
      polls += 1;
      return {
        status: 200,
        text: JSON.stringify(
          status === "completed"
            ? {
                status,
                result: {
                  images: [
                    { b64_json: Buffer.from(outputBytes).toString("base64") },
                  ],
                },
              }
            : status === "failed"
              ? { status, error: { message: "out of memory" } }
              : { status },
        ),
      };
    },
    async sleep(ms) {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    async readRssKiB() {
      const series = options.rss ?? [];
      const value = series[Math.min(rssAt, series.length - 1)] ?? null;
      rssAt += 1;
      return value;
    },
    async readRef(name: RefName) {
      return name === "idle" ? idleBytes : seatedBytes;
    },
    async write(name, bytes) {
      writes.set(name, bytes);
    },
    async log(record) {
      logs.push(record);
    },
    async exists(name) {
      return (options.existing ?? []).includes(name);
    },
  };
  return { deps, calls, writes, logs, sleeps };
}

describe("buildImgGenBody", () => {
  it("encodes PNG bytes as raw base64 in input order", () => {
    const body = buildImgGenBody(params, [idleBytes, seatedBytes]);
    expect(body.ref_images).toEqual([
      Buffer.from(idleBytes).toString("base64"),
      Buffer.from(seatedBytes).toString("base64"),
    ]);
  });

  it("is byte-identical across calls for the same inputs", () => {
    const a = JSON.stringify(buildImgGenBody(params, [idleBytes]));
    const b = JSON.stringify(buildImgGenBody(params, [idleBytes]));
    expect(a).toBe(b);
    expect(createHash("sha256").update(a).digest("hex")).toBe(
      createHash("sha256").update(b).digest("hex"),
    );
    // Key order is part of the contract: reordering would change the hash recorded in the README.
    expect(Object.keys(JSON.parse(a))).toEqual([
      "prompt",
      "negative_prompt",
      "width",
      "height",
      "seed",
      "batch_count",
      "ref_images",
      "lora",
      "sample_params",
      "output_format",
    ]);
  });

  it("pins seed, size, empty lora and the sampler settings", () => {
    const body = buildImgGenBody(params, [idleBytes]);
    expect(body).toMatchObject({
      seed: 20261011,
      width: 512,
      height: 640,
      lora: [],
      sample_params: {
        sample_method: "euler",
        sample_steps: 20,
        guidance: { txt_cfg: 4, img_cfg: 4 },
      },
    });
  });

  it("supports a data-URL encoding", () => {
    expect(encodeRef(idleBytes, "data-url")).toBe(
      `data:image/png;base64,${Buffer.from(idleBytes).toString("base64")}`,
    );
    expect(buildImgGenBody(params, [idleBytes], "data-url").ref_images).toEqual(
      [encodeRef(idleBytes, "data-url")],
    );
  });

  it("omits ref_images for the no-reference baseline", () => {
    const body = buildImgGenBody(params, []);
    expect("ref_images" in body).toBe(false);
  });
});

describe("run plan", () => {
  it("has the baseline, one-reference facing and pose, and a two-reference facing", () => {
    expect(RUNS.map((run) => [run.id, run.refs])).toEqual([
      ["baseline", []],
      ["facing-1ref", ["idle"]],
      ["pose-1ref", ["idle"]],
      ["facing-2ref", ["idle", "seated"]],
    ]);
  });
});

describe("checkCapabilities", () => {
  it("accepts a server that advertises ref_images", () => {
    expect(checkCapabilities(JSON.parse(capabilities(true)))).toEqual({
      ok: true,
    });
  });

  it("rejects missing, false and malformed capabilities", () => {
    expect(checkCapabilities(JSON.parse(capabilities(undefined))).ok).toBe(
      false,
    );
    expect(checkCapabilities(JSON.parse(capabilities(false))).ok).toBe(false);
    expect(checkCapabilities("nope").ok).toBe(false);
  });
});

describe("runProbe", () => {
  it("stops before any job when ref_images is absent", async () => {
    const fake = fakeDeps({ caps: { status: 200, text: capabilities(false) } });
    const result = await runProbe(fake.deps);
    expect(result).toEqual({
      status: "stopped",
      reason: "capabilities.features.ref_images is not true",
      jobsSubmitted: 0,
    });
    expect(fake.calls.map((call) => call.method)).toEqual(["GET"]);
    expect(fake.writes.size).toBe(0);
    expect(fake.logs[0]).toMatchObject({ event: "capabilities", ok: false });
  });

  it("stops when the capabilities request itself fails", async () => {
    const fake = fakeDeps({ caps: { status: 503, text: "" } });
    const result = await runProbe(fake.deps);
    expect(result.status).toBe("stopped");
    expect(fake.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("runs a reference job: body, polling, RSS peak, latency and hash", async () => {
    const fake = fakeDeps({
      caps: { status: 200, text: capabilities(true) },
      rss: [5_000_000, 7_100_000, 6_900_000],
    });
    const only = RUNS.filter((run) => run.id === "facing-2ref");
    const result = await runProbe(fake.deps, { runs: only });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("unreachable");
    const [record] = result.records;
    expect(record).toBeDefined();
    if (!record) throw new Error("unreachable");

    const post = fake.calls.find((call) => call.method === "POST");
    expect(post?.path).toBe(ROUTES.imgGen);
    const sent = JSON.parse(post?.body ?? "{}");
    expect(sent.ref_images).toEqual([
      Buffer.from(idleBytes).toString("base64"),
      Buffer.from(seatedBytes).toString("base64"),
    ]);
    expect(sent.negative_prompt).toBe(NEGATIVE_PROMPT);
    expect(sent.prompt).toContain("reference images");

    // Three polls (queued, generating, completed): two sleeps, three RSS samples.
    expect(fake.sleeps).toEqual([POLL_MS, POLL_MS]);
    expect(record.latencySeconds).toBe(2);
    expect(record.peakRssKiB).toBe(7_100_000);
    expect(record.rssSamples).toBe(3);
    expect(record.outputSha256).toBe(
      createHash("sha256").update(outputBytes).digest("hex"),
    );
    expect(record.bodySha256).toBe(
      createHash("sha256")
        .update(post?.body ?? "")
        .digest("hex"),
    );
    expect(record.refSha256).toEqual([
      createHash("sha256").update(idleBytes).digest("hex"),
      createHash("sha256").update(seatedBytes).digest("hex"),
    ]);
    expect(fake.writes.get("outputs/facing-2ref.png")).toEqual(outputBytes);
  });

  it("sends no ref_images for the baseline", async () => {
    const fake = fakeDeps({ caps: { status: 200, text: capabilities(true) } });
    await runProbe(fake.deps, {
      runs: RUNS.filter((run) => run.id === "baseline"),
    });
    const post = fake.calls.find((call) => call.method === "POST");
    expect("ref_images" in JSON.parse(post?.body ?? "{}")).toBe(false);
  });

  it("skips runs whose output already exists", async () => {
    const fake = fakeDeps({
      caps: { status: 200, text: capabilities(true) },
      existing: ["outputs/baseline.png"],
    });
    const result = await runProbe(fake.deps, {
      runs: RUNS.filter((run) => run.id === "baseline"),
    });
    expect(result).toEqual({
      status: "completed",
      records: [],
      skipped: ["baseline"],
    });
    expect(fake.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("reports a failed job and stops the remaining runs", async () => {
    const fake = fakeDeps({
      caps: { status: 200, text: capabilities(true) },
      jobStatuses: ["generating", "failed"],
    });
    const result = await runProbe(fake.deps);
    expect(result).toMatchObject({
      status: "failed",
      runId: "baseline",
      reason: "job failed: out of memory",
    });
    expect(fake.calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(fake.writes.size).toBe(0);
  });

  it("reports a rejected submission with the server's message", async () => {
    const fake = fakeDeps({
      caps: { status: 200, text: capabilities(true) },
      submit: {
        status: 400,
        text: '{"error":"invalid generation parameters"}',
      },
    });
    const result = await runProbe(fake.deps);
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toContain("invalid generation parameters");
    }
  });
});
