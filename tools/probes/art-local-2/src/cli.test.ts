// CLI behaviour: config parsing, JSON + PNG output with byte-derived hashes,
// private-path redaction, exit codes. Uses the fake sd-server fixture, so it
// proves the harness, not any model or the real sd-server.

import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ArmReport } from "./arm";
import { ConfigError, exitCodeFor, main, parseArmConfig } from "./cli";
import { fakeServerCmd, freePort } from "./fixtures/util";
import { hashBytes } from "./measure";

const dirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "art-local-2-cli-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const minimal = {
  arm: "a",
  prompt: "p",
  seed: 7,
  server: { cmd: ["x"], baseUrl: "http://127.0.0.1:1" },
};

describe("parseArmConfig", () => {
  it("applies the plan defaults: 512x640 and 768x768 cells, warmup 1, 3 samples", () => {
    const config = parseArmConfig(minimal);
    expect(config.cells).toEqual([
      { id: "512x640", width: 512, height: 640 },
      { id: "768x768", width: 768, height: 768 },
    ]);
    expect(config.warmupCount).toBe(1);
    expect(config.sampleCount).toBe(3);
    expect(config.lora).toBeNull();
    expect(config.sampleParams).toEqual({});
  });

  it("rejects missing or mistyped fields, naming the path", () => {
    expect(() => parseArmConfig({ ...minimal, prompt: undefined })).toThrow(
      /\$\.prompt/,
    );
    expect(() => parseArmConfig({ ...minimal, seed: "7" })).toThrow(/\$\.seed/);
    expect(() =>
      parseArmConfig({ ...minimal, server: { cmd: [], baseUrl: "u" } }),
    ).toThrow(/\$\.server\.cmd/);
    expect(() =>
      parseArmConfig({ ...minimal, cells: [{ id: "c", width: 0, height: 5 }] }),
    ).toThrow(/\$\.cells\[0\]\.width/);
    expect(() => parseArmConfig({ ...minimal, sampleCount: 0 })).toThrow(
      /\$\.sampleCount/,
    );
    expect(() => parseArmConfig("nope")).toThrow(/\$/);
  });

  describe("bodyShape", () => {
    const fields = {
      prompt: "p",
      negativePrompt: "n",
      width: "w",
      height: "h",
      seed: "s",
      sampleParams: "sp",
      lora: "l",
    };
    const parse = (bodyShape: unknown) =>
      parseArmConfig({ ...minimal, bodyShape });

    it("accepts a complete shape with an extra object, unchanged", () => {
      const bodyShape = { fields, extra: { stream: false } };
      expect(parse(bodyShape).bodyShape).toEqual(bodyShape);
      expect(parse({ fields }).bodyShape).toEqual({ fields });
    });

    it("names the path of a missing or non-string field mapping", () => {
      expect(() => parse({})).toThrow(ConfigError);
      expect(() => parse({})).toThrow(/\$\.bodyShape\.fields/);
      const { width: _width, ...withoutWidth } = fields;
      expect(() => parse({ fields: withoutWidth })).toThrow(
        /\$\.bodyShape\.fields\.width/,
      );
      expect(() => parse({ fields: { ...fields, seed: 5 } })).toThrow(
        /\$\.bodyShape\.fields\.seed/,
      );
    });

    it("rejects a non-object extra", () => {
      expect(() => parse({ fields, extra: [] })).toThrow(
        /\$\.bodyShape\.extra/,
      );
    });

    it("leaves every shipped arm config parseable", () => {
      const armsDir = join(import.meta.dir, "..", "arms");
      for (const file of readdirSync(armsDir).filter((f) =>
        f.endsWith(".json"),
      )) {
        const raw = JSON.parse(readFileSync(join(armsDir, file), "utf8"));
        expect(() => parseArmConfig(raw)).not.toThrow();
      }
    });
  });

  it("parses a lora with isHighNoise and an explicit id", () => {
    const config = parseArmConfig({
      ...minimal,
      lora: {
        id: "x",
        path: "/p/x.safetensors",
        multiplier: 0.5,
        isHighNoise: true,
      },
    });
    expect(config.lora).toEqual({
      id: "x",
      path: "/p/x.safetensors",
      multiplier: 0.5,
      isHighNoise: true,
    });
  });
});

async function writeConfig(
  extra: Record<string, unknown> = {},
  env: Record<string, string> = {},
) {
  const dir = tmp();
  const modelsDir = tmp();
  const weights = join(modelsDir, "model.gguf");
  writeFileSync(weights, "model-bytes");
  const port = await freePort();
  const config = {
    arm: "fixture",
    prompt: "a pixel hero",
    seed: 99,
    sampleParams: { sample_steps: 4 },
    cells: [{ id: "c1", width: 512, height: 640 }],
    warmupCount: 1,
    sampleCount: 2,
    timeoutMs: 5_000,
    rssIntervalMs: 20,
    pollMs: 10,
    lora: {
      id: "lora-x",
      path: join(modelsDir, "lora-x.safetensors"),
      multiplier: 0.8,
    },
    components: [
      {
        role: "diffusion-model",
        id: "model",
        path: weights,
        declared: {
          sha256: hashBytes(new TextEncoder().encode("model-bytes")),
          license: "apache-2.0",
        },
      },
    ],
    server: {
      cmd: fakeServerCmd(),
      baseUrl: `http://127.0.0.1:${port}`,
      env: { FAKE_PORT: String(port), ...env },
      readyTimeoutMs: 10_000,
      maxLifetimeMs: 30_000,
      stopGraceMs: 300,
    },
    ...extra,
  };
  const configPath = join(dir, "arm.json");
  writeFileSync(configPath, JSON.stringify(config));
  const out = tmp();
  return { configPath, out, modelsDir, dir };
}

describe("main", () => {
  it("writes redacted results.json and PNGs whose hashes match their bytes", async () => {
    const { configPath, out, modelsDir, dir } = await writeConfig();
    const code = await main(["--config", configPath, "--out", out]);
    expect(code).toBe(0);
    const resultsPath = join(out, "fixture", "results.json");
    expect(existsSync(resultsPath)).toBe(true);
    const text = readFileSync(resultsPath, "utf8");
    const results = JSON.parse(text);
    // no private paths
    for (const secret of [
      modelsDir,
      dir,
      out,
      homedir(),
      "/private/var",
      "/var/folders",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("<models>");
    // images: file exists, hash from the actual bytes, matches the cell outputs
    expect(results.images.length).toBe(2 * (1 + 2));
    for (const image of results.images) {
      const bytes = readFileSync(join(out, "fixture", image.file));
      expect(hashBytes(bytes)).toBe(image.sha256);
      expect(bytes.byteLength).toBe(image.byteLength);
      expect([...bytes.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
    }
    const sampleHashes = results.images
      .filter((i: { kind: string }) => i.kind === "sample")
      .map((i: { sha256: string }) => i.sha256);
    const outputHashes = results.cells.flatMap(
      (c: { outputs: { sha256: string }[] }) => c.outputs.map((o) => o.sha256),
    );
    expect(outputHashes.sort()).toEqual(sampleHashes.sort());
    expect(results.cells.map((c: { status: string }) => c.status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(results.cells[0].components[0]).toMatchObject({
      declaredHashMatches: true,
      license: "apache-2.0",
    });
    expect(results.cells[0].settings.loraFile).toBe("lora-x.safetensors");
  });

  it("exits 64 and writes nothing when bodyShape is malformed", async () => {
    const { configPath, out } = await writeConfig({ bodyShape: {} });
    expect(await main(["--config", configPath, "--out", out])).toBe(64);
    expect(existsSync(join(out, "fixture"))).toBe(false);
  });

  it("exits 1 and still writes results and the server log when the server cannot be spawned", async () => {
    const { configPath, out, modelsDir } = await writeConfig();
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    cfg.server.cmd = [join(modelsDir, "no-such-dir", "sd-server")];
    writeFileSync(configPath, JSON.stringify(cfg));
    const code = await main(["--config", configPath, "--out", out]);
    expect(code).toBe(1);
    const results = JSON.parse(
      readFileSync(join(out, "fixture", "results.json"), "utf8"),
    );
    expect(results.cells.map((c: { status: string }) => c.status)).toEqual([
      "failed",
      "failed",
    ]);
    expect(results.servers[0].exit.reason).toBe("spawn-failed");
    const log = readFileSync(
      join(out, "fixture", results.servers[0].logFile),
      "utf8",
    );
    expect(log).toMatch(/^spawn failed: /);
    expect(log).not.toContain(modelsDir);
  });

  it("exits 2 (staging needed), writes unavailable records and no images when a component is missing", async () => {
    const { configPath, out, modelsDir } = await writeConfig();
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    cfg.components.push({
      role: "vae",
      id: "vae",
      path: join(modelsDir, "missing.safetensors"),
    });
    writeFileSync(configPath, JSON.stringify(cfg));
    const code = await main(["--config", configPath, "--out", out]);
    expect(code).toBe(2);
    const results = JSON.parse(
      readFileSync(join(out, "fixture", "results.json"), "utf8"),
    );
    expect(
      results.cells.every(
        (c: { status: string }) => c.status === "unavailable",
      ),
    ).toBe(true);
    expect(results.cells).toHaveLength(2);
    expect(results.images).toHaveLength(0);
  });

  it("exits 1 when a cell times out and records no image for it", async () => {
    const { configPath, out } = await writeConfig(
      { timeoutMs: 300, warmupCount: 0, sampleCount: 1, lora: null },
      { FAKE_JOB_MS: "30000" },
    );
    const code = await main(["--config", configPath, "--out", out]);
    expect(code).toBe(1);
    const results = JSON.parse(
      readFileSync(join(out, "fixture", "results.json"), "utf8"),
    );
    expect(results.cells[0].status).toBe("timed-out");
    expect(results.images).toHaveLength(0);
  });

  it("exits 64 and writes nothing on bad arguments or an invalid config", async () => {
    const out = tmp();
    expect(await main([])).toBe(64);
    const bad = join(tmp(), "bad.json");
    writeFileSync(bad, JSON.stringify({ arm: "a" }));
    expect(await main(["--config", bad, "--out", out])).toBe(64);
    expect(existsSync(join(out, "a"))).toBe(false);
  });
});

describe("main server log artifact", () => {
  // logTail stays a bounded summary; the full retained server output is
  // persisted next to results.json so evidence before the tail survives.
  const single = { warmupCount: 0, sampleCount: 1, lora: null };
  const readResults = (out: string) =>
    JSON.parse(readFileSync(join(out, "fixture", "results.json"), "utf8"));

  it("keeps a line earlier than the 4000-char tail, and output past the old 64 KiB retention, after a successful run", async () => {
    const { configPath, out } = await writeConfig(single, {
      FAKE_LOG_EARLY: `EARLY-MARKER ${process.cwd()}/models/x.gguf`,
      FAKE_LOG_FILLER_KB: "100",
      FAKE_LOG_LATE: "LATE-MARKER",
    });
    expect(await main(["--config", configPath, "--out", out])).toBe(0);
    const server = readResults(out).servers[0];
    expect(server.logTail.length).toBeLessThanOrEqual(4_000);
    expect(server.logTail).not.toContain("EARLY-MARKER");
    expect(server.logTruncated).toBe(false);
    const log = readFileSync(join(out, "fixture", server.logFile), "utf8");
    expect(log).toContain("EARLY-MARKER <cwd>/models/x.gguf");
    expect(log).toContain("LATE-MARKER");
    expect(log).toContain("listening");
    expect(log.length).toBeGreaterThan(100 * 1024);
    // same private-path redaction as results.json
    expect(log).not.toContain(process.cwd());
    expect(log).not.toContain(homedir());
  });

  it("keeps the early line and the crash line when the server aborts mid-job", async () => {
    const { configPath, out } = await writeConfig(single, {
      FAKE_LOG_EARLY: "EARLY-MARKER",
      FAKE_LOG_FILLER_KB: "10",
      FAKE_CRASH_ON_JOB: "1",
    });
    expect(await main(["--config", configPath, "--out", out])).toBe(1);
    const results = readResults(out);
    expect(results.cells[0].status).toBe("failed");
    const server = results.servers[0];
    expect(server.exit).toMatchObject({
      reason: "exited",
      signalCode: "SIGABRT",
    });
    expect(server.logTail).not.toContain("EARLY-MARKER");
    const log = readFileSync(join(out, "fixture", server.logFile), "utf8");
    expect(log).toContain("EARLY-MARKER");
    expect(log).toContain("fixture abort: simulated native failure");
  });
});

describe("main cancel probe", () => {
  const probe = {
    afterMs: 150,
    cell: { id: "probe", width: 512, height: 640 },
  };

  it("exits 0 and records restart timing when the job is aborted mid-flight", async () => {
    const { configPath, out } = await writeConfig(
      {
        cells: [],
        cancelProbe: probe,
        idle: { thresholdPercent: 50, timeoutMs: 5_000 },
      },
      { FAKE_JOB_MS: "30000" },
    );
    expect(await main(["--config", configPath, "--out", out])).toBe(0);
    const results = JSON.parse(
      readFileSync(join(out, "fixture", "results.json"), "utf8"),
    );
    expect(results.cancelProbe.status).toBe("cancelled");
    expect(results.cancelProbe.cancel.readiness).toBe("ready");
  });

  it("exits 1 when the job finished before the abort (no cancellation evidence)", async () => {
    const { configPath, out } = await writeConfig(
      { cells: [], cancelProbe: probe },
      { FAKE_JOB_MS: "1" },
    );
    expect(await main(["--config", configPath, "--out", out])).toBe(1);
  });
});

describe("cli entry point", () => {
  it("runs as `bun run src/cli.ts` and exits with the arm's code", async () => {
    const { configPath, out } = await writeConfig();
    const proc = Bun.spawn(
      [
        process.execPath,
        "run",
        join(import.meta.dir, "cli.ts"),
        "--config",
        configPath,
        "--out",
        out,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(await proc.exited).toBe(0);
    expect(existsSync(join(out, "fixture", "results.json"))).toBe(true);
  });
});

describe("exitCodeFor", () => {
  const config = (extra: Record<string, unknown> = {}) =>
    parseArmConfig({ ...minimal, ...extra });
  const probe = {
    afterMs: 150,
    cell: { id: "probe", width: 512, height: 640 },
  };
  const completedCell = { status: "completed" } as const;
  const timing = {
    abortToExitMs: 60,
    restartToReadyMs: 300,
    totalCancelToReadyMs: 360,
    readiness: "ready",
    escalatedToKill: false,
    restartToIdleMs: 1000,
    idle: "below-threshold",
    idleThresholdPercent: 5,
    idleCpuEvidence: [],
  };
  const report = (cells: unknown[], cancelProbe: unknown = null): ArmReport =>
    ({ cells, cancelProbe }) as unknown as ArmReport;
  const cancelled = (cancel: unknown) => ({
    status: "cancelled",
    cancel,
  });

  it("keeps the existing codes without a cancel probe: 0 completed, 1 failed, 2 all unavailable", () => {
    expect(exitCodeFor(report([completedCell]), config())).toBe(0);
    expect(
      exitCodeFor(report([completedCell, { status: "failed" }]), config()),
    ).toBe(1);
    expect(exitCodeFor(report([{ status: "unavailable" }]), config())).toBe(2);
    // An unavailable arm never ran its probe, so the configured probe is not a failure.
    expect(
      exitCodeFor(
        report([{ status: "unavailable" }]),
        config({ cancelProbe: probe }),
      ),
    ).toBe(2);
  });

  it("accepts a cancelled probe with a ready replacement and every timing present", () => {
    expect(
      exitCodeFor(
        report([completedCell], cancelled(timing)),
        config({ cancelProbe: probe }),
      ),
    ).toBe(0);
  });

  const unacceptable: [string, unknown][] = [
    ["a missing probe record", null],
    ["a probe that completed", { status: "completed" }],
    ["a cancelled probe with no timing", cancelled(null)],
    [
      "a replacement that exited",
      cancelled({
        ...timing,
        readiness: "exited",
        restartToReadyMs: null,
        totalCancelToReadyMs: null,
      }),
    ],
    [
      "a replacement that never became ready",
      cancelled({
        ...timing,
        readiness: "timed-out",
        restartToReadyMs: null,
        totalCancelToReadyMs: null,
      }),
    ],
    [
      "a replacement never attempted",
      cancelled({ ...timing, readiness: "not-attempted" }),
    ],
    ["a null abort-to-exit", cancelled({ ...timing, abortToExitMs: null })],
    [
      "a null restart-to-ready",
      cancelled({ ...timing, restartToReadyMs: null }),
    ],
    [
      "a null cancel-to-ready total",
      cancelled({ ...timing, totalCancelToReadyMs: null }),
    ],
  ];
  for (const [name, record] of unacceptable) {
    it(`exits 1 for ${name}`, () => {
      expect(
        exitCodeFor(
          report([completedCell], record),
          config({ cancelProbe: probe }),
        ),
      ).toBe(1);
    });
  }

  it("holds idle evidence to the configuration: required when set, ignored when not", () => {
    const idle = { thresholdPercent: 5, timeoutMs: 1000 };
    const withIdle = config({ cancelProbe: probe, idle });
    for (const bad of [
      { idle: "timed-out", restartToIdleMs: null },
      { idle: "not-measured", restartToIdleMs: null },
      { idle: "process-gone", restartToIdleMs: null },
      { idle: "below-threshold", restartToIdleMs: null },
    ]) {
      expect(
        exitCodeFor(
          report([completedCell], cancelled({ ...timing, ...bad })),
          withIdle,
        ),
      ).toBe(1);
    }
    expect(
      exitCodeFor(report([completedCell], cancelled(timing)), withIdle),
    ).toBe(0);
    const noIdle = { ...timing, idle: "not-measured", restartToIdleMs: null };
    expect(
      exitCodeFor(
        report([completedCell], cancelled(noIdle)),
        config({ cancelProbe: probe }),
      ),
    ).toBe(0);
  });
});

describe("main cancel probe: the replacement must come back", () => {
  const probe = {
    afterMs: 150,
    cell: { id: "probe", width: 512, height: 640 },
  };
  const run = async (onRestart: "exit7" | "never-ready") => {
    const marker = join(tmp(), "first-launch-marker");
    const { configPath, out } = await writeConfig(
      { cells: [], cancelProbe: probe },
      {
        FAKE_JOB_MS: "30000",
        FAKE_START_MARKER: marker,
        FAKE_ON_RESTART: onRestart,
      },
    );
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    cfg.server.readyTimeoutMs = 1_000;
    writeFileSync(configPath, JSON.stringify(cfg));
    const code = await main(["--config", configPath, "--out", out]);
    const results = JSON.parse(
      readFileSync(join(out, "fixture", "results.json"), "utf8"),
    );
    return { code, results };
  };

  it("exits 1 when the replacement exits instead of becoming ready", async () => {
    const { code, results } = await run("exit7");
    expect(results.cancelProbe.status).toBe("cancelled");
    expect(results.cancelProbe.cancel.readiness).toBe("exited");
    expect(code).toBe(1);
  });

  it("exits 1 when the replacement never becomes ready", async () => {
    const { code, results } = await run("never-ready");
    expect(results.cancelProbe.cancel.readiness).toBe("timed-out");
    expect(code).toBe(1);
  });
});
