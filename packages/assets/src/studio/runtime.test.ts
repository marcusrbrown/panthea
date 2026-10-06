import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { sha256Hex } from "../hash";
import { loadContent, removeTempRoots, tempRoot } from "./_test-fixtures";
import {
  type Behavior,
  type LogEvent,
  type Mode,
  readLog,
  stageFixtureRuntime,
  testImage,
} from "./_test-runtime";
import { SELECTED_PROFILE, type SelectedProfile } from "./provider";
import { newRequestRecord, planJobs } from "./request";
import {
  openRuntime,
  type RuntimeConfig,
  type RuntimeDeadlines,
  type StudioRuntime,
} from "./runtime";
import { openStudioSession, type StudioSession } from "./session";
import { readStudioStatus } from "./store";

const content = loadContent();

interface Rig {
  dir: string;
  root: string;
  port: number;
  profile: SelectedProfile;
  session: StudioSession;
  runtime: StudioRuntime;
}

const rigs: Rig[] = [];
const neighbors: ChildProcess[] = [];
const servers: { stop(force?: boolean): void }[] = [];

const DEADLINES: RuntimeDeadlines = {
  httpMs: 2000,
  startupMs: 5000,
  generationMs: 5000,
  termGraceMs: 400,
  killMs: 3000,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(15);
  }
  throw new Error("timed out waiting for a condition");
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const refuseDraw = () => {
  throw new Error("the seed supplier must not be called");
};

async function rig(
  behavior: Behavior,
  options: {
    stage?: boolean;
    deadlines?: Partial<RuntimeDeadlines>;
    port?: number;
  } = {},
): Promise<Rig> {
  const base = dirname(tempRoot());
  const dir = join(base, "artifacts");
  mkdirSync(dir, { recursive: true });
  const staged = stageFixtureRuntime(dir, behavior);
  const profile = staged;
  const opened = openStudioSession(join(base, "studio"));
  if (opened.kind === "busy") throw new Error("busy");
  const port = options.port ?? (await freePort());
  const config: RuntimeConfig = {
    artifactRoot: dir,
    port,
    content,
    deadlines: { ...DEADLINES, ...options.deadlines },
    pollMs: 15,
    profile,
  };
  const made: Rig = {
    dir,
    root: join(base, "studio"),
    port,
    profile,
    session: opened.session,
    runtime: openRuntime(opened.session, config),
  };
  rigs.push(made);
  return made;
}

const SLOTS = [
  { state: "idle", direction: "south" },
  { state: "idle", direction: "north" },
  { state: "idle", direction: "east" },
];

function submit(
  r: Rig,
  id: string,
  options: { slots?: number; seed?: number } = {},
) {
  const built = newRequestRecord(
    content,
    {
      id,
      subject: "zeus",
      kind: "sprite",
      slots: SLOTS.slice(0, options.slots ?? 1),
      batch: 1,
      seed: options.seed ?? 100,
    },
    refuseDraw,
  );
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  const result = r.session.submitRequest(built.value.record);
  if (!result.ok) throw new Error(result.message);
  return { record: built.value.record, jobIds: result.jobIds };
}

function planned(id: string, seed = 100) {
  const built = newRequestRecord(
    content,
    {
      id,
      subject: "zeus",
      kind: "sprite",
      slots: SLOTS.slice(0, 1),
      batch: 1,
      seed,
    },
    refuseDraw,
  );
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  const plan = planJobs(built.value.record, 1);
  if (!plan.ok) throw new Error(JSON.stringify(plan.error));
  return plan.value.jobs[0] as (typeof plan.value.jobs)[number];
}

async function drain(r: Rig) {
  const result = await r.runtime.drain();
  if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
  return result;
}

const events = (r: Rig, name: string): LogEvent[] =>
  readLog(r.dir).filter((e) => e.event === name);
const startPids = (r: Rig) => events(r, "start").map((e) => e.pid);
const jobsById = (r: Rig) =>
  Object.fromEntries(
    readStudioStatus(r.root).jobs.map((record) => [record.job.id, record]),
  );
const ledger = (r: Rig) =>
  readStudioStatus(r.root).commands.map((c) => [c.seq, c.type, c.jobId]);
const blobs = (r: Rig) =>
  existsSync(join(r.root, "blobs")) ? readdirSync(join(r.root, "blobs")) : [];

function fixturePids(r: Rig): number[] {
  return [
    ...new Set(
      readLog(r.dir)
        .filter((e) => e.event === "start" || e.event === "grand")
        .map((e) => e.pid),
    ),
  ];
}

const leaked: number[] = [];

afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.runtime.close().catch(() => undefined);
    r.session.close();
    for (const pid of fixturePids(r)) {
      if (alive(pid)) {
        leaked.push(pid);
        process.kill(pid, "SIGKILL");
      }
    }
  }
  for (const n of neighbors.splice(0)) {
    if (n.pid && alive(n.pid)) process.kill(n.pid, "SIGKILL");
  }
  for (const s of servers.splice(0)) s.stop(true);
  removeTempRoots();
  expect(leaked).toEqual([]);
});

describe("native API mapping and durable results", () => {
  test("a job becomes one img_gen request, a stored blob and a succeeded record with its source", async () => {
    const r = await rig({});
    submit(r, "zeus-idle", { seed: 77 });

    const result = await drain(r);

    expect(result.stopped).toBe("empty");
    const expected = testImage(512, 640);
    const hash = sha256Hex(expected.png);
    expect(result.results).toHaveLength(1);
    const first = result.results[0];
    if (first?.outcome !== "succeeded") throw new Error("expected success");
    expect(first.output).toEqual({
      medium: "image",
      hash,
      width: 512,
      height: 640,
    });
    expect(first.image.width).toBe(512);
    expect(first.image.height).toBe(640);
    expect(first.image.rgba).toEqual(expected.rgba);
    expect(Array.from(first.image.rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(first.image.rgba.slice(4 * 512, 4 * 512 + 4))).toEqual([
      0, 1, 1, 0,
    ]);

    const body = events(r, "img_gen")[0]?.body;
    expect(body).toEqual({
      prompt:
        "pixel art, Zeus, Greek god, thunderbolt, storm sky, cloud seat, full body, facing south, idle pose, plain flat background, limited colour palette",
      negative_prompt: SELECTED_PROFILE.negativePrompt,
      width: 512,
      height: 640,
      seed: 77,
      batch_count: 1,
      sample_params: {
        sample_method: "euler",
        sample_steps: 8,
        guidance: { txt_cfg: 1 },
      },
      lora: [],
      output_format: "png",
    });
    const dirOf = (name: string) => join(r.dir, name);
    expect(events(r, "start")[0]?.argv).toEqual([
      "--listen-ip",
      "127.0.0.1",
      "--listen-port",
      String(r.port),
      "--diffusion-model",
      dirOf("models/diffusion.bin"),
      "--llm",
      dirOf("models/encoder.bin"),
      "--vae",
      dirOf("models/vae.bin"),
      "--offload-to-cpu",
      "--diffusion-fa",
    ]);

    const stored = jobsById(r)["zeus-idle-0000"];
    expect(stored?.job).toMatchObject({
      status: "succeeded",
      outputs: [{ medium: "image", hash, width: 512, height: 640 }],
    });
    expect(stored?.job.request).toEqual(planned("zeus-idle", 77).job.request);
    expect(stored?.source).toEqual({
      requestId: "zeus-idle",
      slotKey: "idle/south",
      ordinal: 0,
    });
    expect(readStudioStatus(r.root).requests[0]?.nextOrdinal).toBe(1);
    expect(r.session.store.readBlob(hash)).toEqual(expected.png);
    expect(ledger(r)).toEqual([
      [1, "enqueue", "zeus-idle-0000"],
      [2, "start", "zeus-idle-0000"],
      [3, "succeed", "zeus-idle-0000"],
    ]);
    expect(await r.runtime.close()).toEqual({ ok: true });
  });

  test("queued jobs run in durable enqueue order, not by name, and a removed job is never submitted", async () => {
    const r = await rig({});
    const built = newRequestRecord(
      content,
      {
        id: "zeus-order",
        subject: "zeus",
        kind: "sprite",
        slots: SLOTS,
        batch: 1,
        seed: 500,
      },
      refuseDraw,
    );
    if (!built.ok) throw new Error("bad request");
    r.session.store.putRequest({ ...built.value.record, nextOrdinal: 3 });
    const plan = planJobs(built.value.record, 1);
    if (!plan.ok) throw new Error("bad plan");
    const ids = ["zz-first", "aa-second", "mm-third"];
    for (const [index, planned] of plan.value.jobs.entries())
      r.session.enqueue(planned.source, {
        ...planned.job,
        id: ids[index] as string,
      });
    r.session.remove("aa-second");

    const result = await drain(r);

    expect(result.results.map((x) => x.jobId)).toEqual([
      "zz-first",
      "mm-third",
    ]);
    expect(
      events(r, "img_gen").map((e) => (e.body as { seed: number }).seed),
    ).toEqual([500, 502]);
    const jobs = jobsById(r);
    expect(jobs["aa-second"]?.job).toMatchObject({
      status: "cancelled",
      cancelledBy: "removed",
    });
    expect(jobs["zz-first"]?.source.ordinal).toBe(0);
    expect(jobs["mm-third"]?.source.ordinal).toBe(2);
    expect(ledger(r).map((c) => `${c[1]}:${c[2]}`)).toEqual([
      "enqueue:zz-first",
      "enqueue:aa-second",
      "enqueue:mm-third",
      "remove:aa-second",
      "start:zz-first",
      "succeed:zz-first",
      "start:mm-third",
      "succeed:mm-third",
    ]);
  });

  test("a job whose request record is missing fails without touching the server", async () => {
    const r = await rig({});
    const ghost = planned("ghost");
    r.session.enqueue(ghost.source, ghost.job);

    const result = await drain(r);

    expect(result.results[0]).toMatchObject({ outcome: "failed" });
    expect(jobsById(r)["ghost-0000"]?.job.status).toBe("failed");
    expect(events(r, "img_gen")).toEqual([]);
  });
});

describe("unavailable runtime", () => {
  const damage: [string, (r: Rig) => void, RegExp][] = [
    [
      "a missing component",
      (r) => rmSync(join(r.dir, "models/vae.bin")),
      /vae.*missing|missing.*vae/i,
    ],
    [
      "a component with the wrong hash",
      (r) => writeFileSync(join(r.dir, "models/encoder.bin"), "encodeX"),
      /sha256/i,
    ],
    [
      "a component with the wrong size",
      (r) => writeFileSync(join(r.dir, "models/diffusion.bin"), "diffusion+"),
      /size/i,
    ],
    [
      "a binary that is not executable",
      (r) => chmodSync(join(r.dir, "bin/sd-server"), 0o644),
      /executable/i,
    ],
    [
      "a binary with the wrong hash",
      (r) => {
        writeFileSync(join(r.dir, "bin/sd-server"), "#!/bin/sh\nexit 0\n");
        chmodSync(join(r.dir, "bin/sd-server"), 0o755);
      },
      /sha256/i,
    ],
  ];

  for (const [name, hurt, pattern] of damage) {
    test(`${name} makes every queued job unavailable with staging guidance and starts no child`, async () => {
      const r = await rig({});
      submit(r, "zeus-idle", { slots: 2 });
      hurt(r);

      const result = await drain(r);

      expect(result.stopped).toBe("unavailable");
      expect(result.results.map((x) => x.outcome)).toEqual([
        "unavailable",
        "unavailable",
      ]);
      const jobs = Object.values(jobsById(r));
      for (const { job } of jobs) {
        expect(job.status).toBe("unavailable");
        if (job.status === "unavailable") {
          expect(job.reason).toMatch(pattern);
          expect(job.staging).toContain("artifact root");
        }
      }
      expect(readLog(r.dir)).toEqual([]);
      expect(ledger(r).filter((c) => c[1] === "unavailable")).toHaveLength(2);
    });
  }

  test("an occupied endpoint is refused and its server never contacted", async () => {
    const port = await freePort();
    let contacts = 0;
    const occupier = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch() {
        contacts += 1;
        return new Response("not yours");
      },
    });
    servers.push(occupier);
    const r = await rig({}, { port });
    submit(r, "zeus-idle");

    const result = await drain(r);

    expect(result.stopped).toBe("unavailable");
    const job = jobsById(r)["zeus-idle-0000"]?.job;
    expect(job).toMatchObject({ status: "unavailable" });
    expect(job?.status === "unavailable" && job.reason).toMatch(
      /already in use/,
    );
    expect(contacts).toBe(0);
    expect(readLog(r.dir)).toEqual([]);
  });
});

describe("start failures", () => {
  test("a child that exits before it is ready fails the job with its exit and stderr, and leaves the rest queued", async () => {
    const r = await rig({ exitOnStart: 7 });
    submit(r, "zeus-idle", { slots: 2 });

    const result = await drain(r);

    expect(result.stopped).toBe("start-failed");
    const job = jobsById(r)["zeus-idle-0000"]?.job;
    expect(job).toMatchObject({ status: "failed" });
    expect(job?.status === "failed" && job.error).toMatch(/exited/);
    expect(job?.status === "failed" && job.error).toContain("7");
    expect(job?.status === "failed" && job.error).toContain(
      "refusing to start",
    );
    expect(jobsById(r)["zeus-idle-0001"]?.job.status).toBe("queued");
    expect(startPids(r).every((pid) => !alive(pid))).toBe(true);
  });

  test("a spawn error fails the job", async () => {
    const r = await rig({});
    const binary = join(r.dir, "bin/sd-server");
    const text = "#!/nonexistent/interpreter\n";
    writeFileSync(binary, text);
    chmodSync(binary, 0o755);
    const patched: SelectedProfile = {
      ...r.profile,
      runtime: {
        ...r.profile.runtime,
        binary: {
          path: "bin/sd-server",
          sha256: sha256Hex(new TextEncoder().encode(text)),
        },
      },
    };
    const again = openRuntime(r.session, {
      artifactRoot: r.dir,
      port: r.port,
      content,
      deadlines: DEADLINES,
      pollMs: 15,
      profile: patched,
    });
    submit(r, "zeus-idle");

    const result = await again.drain();

    expect(result.ok && result.stopped).toBe("start-failed");
    const job = jobsById(r)["zeus-idle-0000"]?.job;
    expect(job?.status === "failed" && job.error).toMatch(/spawn/i);
    await again.close();
  });

  test("a child that never becomes ready is torn down within the startup deadline", async () => {
    const r = await rig(
      { startupDelayMs: 5000 },
      { deadlines: { startupMs: 400 } },
    );
    submit(r, "zeus-idle");

    const result = await drain(r);

    expect(result.stopped).toBe("start-failed");
    const job = jobsById(r)["zeus-idle-0000"]?.job;
    expect(job?.status === "failed" && job.error).toMatch(
      /not ready within 400 ms/,
    );
    expect(startPids(r)).toHaveLength(1);
    expect(startPids(r).every((pid) => !alive(pid))).toBe(true);
  });
});

describe("generation failures", () => {
  const cases: [Mode, RegExp, boolean][] = [
    ["failed", /fixture says no/, false],
    ["no-images", /exactly one image/, false],
    ["two-images", /exactly one image/, false],
    ["bad-base64", /base64/i, false],
    ["not-png", /corrupt-png/, false],
    ["truncated-png", /corrupt-png/, false],
    ["grayscale-png", /unsupported-png/, false],
    ["wrong-size", /8x8.*512x640|512x640/, false],
    ["http-500", /500/, true],
    ["bad-json", /JSON/i, true],
    ["bad-status", /weird/, true],
  ];

  for (const [mode, pattern, restarts] of cases) {
    test(`${mode} fails the job, stores nothing, and ${restarts ? "restarts" : "keeps"} the child for the next job`, async () => {
      const r = await rig({ sequence: [mode, "ok"] });
      submit(r, "zeus-idle", { slots: 2 });

      const result = await drain(r);

      expect(result.results.map((x) => x.outcome)).toEqual([
        "failed",
        "succeeded",
      ]);
      const first = jobsById(r)["zeus-idle-0000"]?.job;
      expect(first?.status === "failed" && first.error).toMatch(pattern);
      expect(jobsById(r)["zeus-idle-0001"]?.job.status).toBe("succeeded");
      expect(blobs(r)).toHaveLength(1);
      expect(startPids(r)).toHaveLength(restarts ? 2 : 1);
      if (restarts) expect(startPids(r)[0]).not.toBe(startPids(r)[1]);
      if (restarts) expect(alive(startPids(r)[0] as number)).toBe(false);
    });
  }

  test("a job that outlives the generation deadline fails and the child is restarted for the next job", async () => {
    const r = await rig(
      { sequence: ["hang", "ok"] },
      { deadlines: { generationMs: 300 } },
    );
    submit(r, "zeus-idle", { slots: 2 });

    const result = await drain(r);

    expect(result.results.map((x) => x.outcome)).toEqual([
      "failed",
      "succeeded",
    ]);
    const first = jobsById(r)["zeus-idle-0000"]?.job;
    expect(first?.status === "failed" && first.error).toMatch(
      /generation deadline/,
    );
    expect(startPids(r)).toHaveLength(2);
    expect(alive(startPids(r)[0] as number)).toBe(false);
  });
});

describe("teardown", () => {
  test("a cooperative child is stopped by TERM and its group is gone before close returns", async () => {
    const r = await rig({});
    submit(r, "zeus-idle");
    await drain(r);
    const [pid] = startPids(r);

    expect(await r.runtime.close()).toEqual({ ok: true });

    expect(events(r, "term")).toHaveLength(1);
    expect(alive(pid as number)).toBe(false);
  });

  test("a child that ignores TERM is killed after the grace period", async () => {
    const r = await rig({ ignoreTerm: true });
    submit(r, "zeus-idle");
    await drain(r);
    const [pid] = startPids(r);

    const started = Date.now();
    expect(await r.runtime.close()).toEqual({ ok: true });

    expect(Date.now() - started).toBeGreaterThanOrEqual(
      DEADLINES.termGraceMs - 50,
    );
    expect(events(r, "term-ignored")).toHaveLength(1);
    expect(alive(pid as number)).toBe(false);
  });

  test("a grandchild that outlives its parent and holds the pipes is still reaped, and a neighbour survives", async () => {
    const neighbor = spawn("sleep", ["60"], {
      detached: true,
      stdio: "ignore",
    });
    neighbors.push(neighbor);
    const r = await rig({ grandchild: true });
    submit(r, "zeus-idle");
    await drain(r);
    await waitFor(() => events(r, "grand").length === 1);
    const grandPid = events(r, "grand")[0]?.pid as number;
    const [parentPid] = startPids(r);
    expect(alive(grandPid)).toBe(true);

    expect(await r.runtime.close()).toEqual({ ok: true });

    expect(events(r, "term")).toHaveLength(1);
    expect(alive(parentPid as number)).toBe(false);
    expect(alive(grandPid)).toBe(false);
    expect(alive(neighbor.pid as number)).toBe(true);
  });
});

describe("abort", () => {
  test("an abort cancels the running job, kills and awaits the old child, and the next job runs on a fresh ready one", async () => {
    const r = await rig({ sequence: ["hang", "ok"] });
    submit(r, "zeus-idle", { slots: 2 });
    const running = r.runtime.drain();
    await waitFor(() => events(r, "poll").length > 0);
    expect(jobsById(r)["zeus-idle-0000"]?.job.status).toBe("running");
    const [oldPid] = startPids(r);

    const aborted = await r.runtime.abort("zeus-idle-0000");

    expect(aborted).toEqual({ ok: true });
    expect(alive(oldPid as number)).toBe(false);
    const done = await running;
    if (!done.ok) throw new Error(done.message);
    expect(done.results.map((x) => x.outcome)).toEqual([
      "aborted",
      "succeeded",
    ]);
    const jobs = jobsById(r);
    expect(jobs["zeus-idle-0000"]?.job).toMatchObject({
      status: "cancelled",
      cancelledBy: "aborted",
    });
    expect(jobs["zeus-idle-0000"]?.source).toEqual({
      requestId: "zeus-idle",
      slotKey: "idle/south",
      ordinal: 0,
    });
    expect(jobs["zeus-idle-0001"]?.job.status).toBe("succeeded");
    expect(startPids(r)).toHaveLength(2);
    expect(startPids(r)[1]).not.toBe(oldPid);
    expect(blobs(r)).toHaveLength(1);
    expect(ledger(r).map((c) => `${c[1]}:${c[2]}`)).toEqual([
      "enqueue:zeus-idle-0000",
      "enqueue:zeus-idle-0001",
      "start:zeus-idle-0000",
      "abort:zeus-idle-0000",
      "start:zeus-idle-0001",
      "succeed:zeus-idle-0001",
    ]);
  });

  test("output the old child produces after the abort is never stored or promoted", async () => {
    const r = await rig(
      { ignoreTerm: true, jobDelayMs: 300 },
      { deadlines: { termGraceMs: 1200 } },
    );
    submit(r, "zeus-idle");
    const running = r.runtime.drain();
    await waitFor(() => events(r, "poll").length > 0);

    const aborted = await r.runtime.abort("zeus-idle-0000");

    expect(aborted).toEqual({ ok: true });
    expect(events(r, "output-ready")).toHaveLength(1);
    const done = await running;
    expect(done.ok && done.results.map((x) => x.outcome)).toEqual(["aborted"]);
    expect(jobsById(r)["zeus-idle-0000"]?.job).toMatchObject({
      status: "cancelled",
      cancelledBy: "aborted",
    });
    expect(blobs(r)).toEqual([]);
    expect(startPids(r).every((pid) => !alive(pid))).toBe(true);
  });

  test("abort refuses a job that is not running", async () => {
    const r = await rig({});
    submit(r, "zeus-idle");

    expect(await r.runtime.abort("zeus-idle-0000")).toMatchObject({
      ok: false,
      reason: "not-running",
    });
    expect(await r.runtime.abort("nope")).toMatchObject({
      ok: false,
      reason: "not-running",
    });
  });

  test("closing the runtime while a job runs aborts it and reaps the child", async () => {
    const r = await rig({ sequence: ["hang"] });
    submit(r, "zeus-idle");
    const running = r.runtime.drain();
    await waitFor(() => events(r, "poll").length > 0);
    const [pid] = startPids(r);

    expect(await r.runtime.close()).toEqual({ ok: true });

    const done = await running;
    expect(done.ok && done.results.map((x) => x.outcome)).toEqual(["aborted"]);
    expect(jobsById(r)["zeus-idle-0000"]?.job).toMatchObject({
      status: "cancelled",
      cancelledBy: "aborted",
    });
    expect(alive(pid as number)).toBe(false);
    expect(blobs(r)).toEqual([]);
  });
});

describe("ownership", () => {
  test("a second drain while one runs is refused", async () => {
    const r = await rig({ sequence: ["hang", "ok"] });
    submit(r, "zeus-idle");
    const running = r.runtime.drain();
    await waitFor(() => events(r, "poll").length > 0);

    expect(await r.runtime.drain()).toMatchObject({
      ok: false,
      reason: "busy",
    });

    await r.runtime.abort("zeus-idle-0000");
    await running;
  });

  test("a closed runtime refuses to drain or abort", async () => {
    const r = await rig({});
    submit(r, "zeus-idle");
    await r.runtime.close();

    expect(await r.runtime.drain()).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(await r.runtime.abort("zeus-idle-0000")).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(readLog(r.dir)).toEqual([]);
  });

  test("shutdown tears the child down before the session releases the root", async () => {
    const r = await rig({ ignoreTerm: true });
    submit(r, "zeus-idle");
    await drain(r);
    const [pid] = startPids(r);

    expect(await r.runtime.shutdown()).toEqual({ ok: true });

    expect(alive(pid as number)).toBe(false);
    const reopened = openStudioSession(r.root);
    expect(reopened.kind).toBe("opened");
    if (reopened.kind === "opened") reopened.session.close();
    expect(
      r.session.enqueue(
        { requestId: "x", slotKey: "a", ordinal: 0 },
        {
          schemaVersion: 1,
          id: "late",
          request: {
            schemaVersion: 1,
            subject: "zeus",
            kind: "sprite",
            slots: [{ state: "idle", direction: "south" }],
            batch: 1,
          },
          provider: {
            id: "sd-server-z-image-turbo",
            medium: "image",
            hosting: "local",
          },
          status: "queued",
        },
      ),
    ).toMatchObject({ ok: false, reason: "closed" });
  });

  test("a runtime on a closed session cannot touch a new owner's queue or start a child", async () => {
    const r = await rig({});
    const stale = r.session;
    stale.close();
    const owner = openStudioSession(r.root);
    if (owner.kind === "busy") throw new Error("busy");
    const built = newRequestRecord(
      content,
      {
        id: "owner-req",
        subject: "zeus",
        kind: "sprite",
        slots: SLOTS.slice(0, 1),
        batch: 1,
        seed: 3,
      },
      refuseDraw,
    );
    if (!built.ok) throw new Error("bad request");
    owner.session.submitRequest(built.value.record);
    const before = JSON.stringify(readStudioStatus(r.root));

    expect(await r.runtime.drain()).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(await r.runtime.abort("owner-req-0000")).toMatchObject({
      ok: false,
    });

    expect(JSON.stringify(readStudioStatus(r.root))).toBe(before);
    expect(readLog(r.dir)).toEqual([]);
    owner.session.close();
  });

  test("a failing caller that shuts down in finally leaves no child behind", async () => {
    const r = await rig({ grandchild: true });
    submit(r, "zeus-idle");
    let pids: number[] = [];
    await expect(
      (async () => {
        try {
          await drain(r);
          await waitFor(() => events(r, "grand").length === 1);
          pids = fixturePids(r);
          throw new Error("injected assertion failure");
        } finally {
          await r.runtime.shutdown();
        }
      })(),
    ).rejects.toThrow("injected assertion failure");

    expect(pids).toHaveLength(2);
    expect(pids.every((pid) => !alive(pid))).toBe(true);
  });
});

describe("teardown that does not complete", () => {
  const NO_WAIT = { termGraceMs: 0, killMs: 0 };

  test("a failed shutdown keeps the root busy and a retry tears the owned group down before releasing it", async () => {
    const r = await rig(
      { grandchild: true, ignoreTerm: true },
      { deadlines: NO_WAIT },
    );
    submit(r, "zeus-idle");
    await drain(r);
    await waitFor(() => events(r, "grand").length === 1);
    const pids = fixturePids(r);
    expect(pids).toHaveLength(2);

    const first = await r.runtime.shutdown();

    expect(first).toMatchObject({ ok: false, reason: "teardown-incomplete" });
    expect(openStudioSession(r.root).kind).toBe("busy");
    await sleep(300);

    const retry = await r.runtime.shutdown();

    expect(retry).toEqual({ ok: true });
    expect(pids.every((pid) => !alive(pid))).toBe(true);
    const reopened = openStudioSession(r.root);
    expect(reopened.kind).toBe("opened");
    if (reopened.kind === "opened") reopened.session.close();
  });

  test("a failed close can be retried and then really signals and checks the group again", async () => {
    const r = await rig(
      { grandchild: true, ignoreTerm: true },
      { deadlines: NO_WAIT },
    );
    submit(r, "zeus-idle");
    await drain(r);
    await waitFor(() => events(r, "grand").length === 1);
    const pids = fixturePids(r);

    expect(await r.runtime.close()).toMatchObject({
      ok: false,
      reason: "teardown-incomplete",
    });
    await sleep(300);
    expect(await r.runtime.close()).toEqual({ ok: true });

    expect(pids.every((pid) => !alive(pid))).toBe(true);
    expect(openStudioSession(r.root).kind).toBe("busy");
  });
});

describe("a retry right after a failed teardown", () => {
  test("reports the group's state instead of throwing while its members are still being reaped", async () => {
    const r = await rig(
      { grandchild: true, ignoreTerm: true },
      { deadlines: { termGraceMs: 0, killMs: 0 } },
    );
    submit(r, "zeus-idle");
    await drain(r);
    await waitFor(() => events(r, "grand").length === 1);

    await r.runtime.close();
    const pids = fixturePids(r);
    const immediate = await r.runtime.close();
    if (immediate.ok) expect(pids.every((pid) => !alive(pid))).toBe(true);

    expect(["teardown-incomplete", undefined]).toContain(
      immediate.ok ? undefined : immediate.reason,
    );
    await sleep(300);
    expect(await r.runtime.close()).toEqual({ ok: true });
  });
});

describe("a failed write of a failure is never acknowledged", () => {
  const blockLedger = (r: Rig, seq: number) =>
    mkdirSync(join(r.root, "commands", `${String(seq).padStart(8, "0")}.json`));

  function expectUnrecorded(r: Rig, ledgerSeqs: number) {
    const jobs = jobsById(r);
    expect(jobs["zeus-idle-0000"]?.job.status).toBe("running");
    expect(jobs["zeus-idle-0000"]?.source).toEqual({
      requestId: "zeus-idle",
      slotKey: "idle/south",
      ordinal: 0,
    });
    expect(jobs["zeus-idle-0001"]?.job.status).toBe("queued");
    expect(ledger(r).map((c) => `${c[1]}:${c[2]}`)).toEqual(
      [
        "enqueue:zeus-idle-0000",
        "enqueue:zeus-idle-0001",
        "start:zeus-idle-0000",
      ].slice(0, ledgerSeqs),
    );
  }

  test("a lone job whose failure cannot be written is not reported failed", async () => {
    const r = await rig({ sequence: ["failed"] });
    submit(r, "zeus-idle");
    blockLedger(r, 3);

    const result = await r.runtime.drain();

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect(jobsById(r)["zeus-idle-0000"]?.job.status).toBe("running");
    expect(ledger(r).map((c) => `${c[1]}:${c[2]}`)).toEqual([
      "enqueue:zeus-idle-0000",
      "start:zeus-idle-0000",
    ]);
  });

  test("a server-reported failure whose record cannot be written stops the drain with a refusal", async () => {
    const r = await rig({ sequence: ["failed", "ok"] });
    submit(r, "zeus-idle", { slots: 2 });
    blockLedger(r, 4);

    const result = await r.runtime.drain();

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect("results" in result).toBe(false);
    expectUnrecorded(r, 3);
    expect(events(r, "img_gen")).toHaveLength(1);
  });

  test("a client failure whose record cannot be written is refused, and the child is still stopped", async () => {
    const r = await rig({ sequence: ["http-500", "ok"] });
    submit(r, "zeus-idle", { slots: 2 });
    blockLedger(r, 4);

    const result = await r.runtime.drain();

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expectUnrecorded(r, 3);
    expect(events(r, "img_gen")).toHaveLength(1);
    expect(startPids(r).every((pid) => !alive(pid))).toBe(true);
  });

  test("a start failure whose record cannot be written is refused and the next job stays queued", async () => {
    const r = await rig({ exitOnStart: 7 });
    submit(r, "zeus-idle", { slots: 2 });
    blockLedger(r, 4);

    const result = await r.runtime.drain();

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect("results" in result).toBe(false);
    expectUnrecorded(r, 3);
    expect(startPids(r)).toHaveLength(1);
  });
});

describe("a failed write of a start, a success or an unavailable is never acknowledged", () => {
  const blockLedger = (r: Rig, seq: number) =>
    mkdirSync(join(r.root, "commands", `${String(seq).padStart(8, "0")}.json`));

  const sources = (r: Rig) =>
    Object.fromEntries(
      readStudioStatus(r.root).jobs.map((x) => [x.job.id, x.source]),
    );

  const expectSources = (r: Rig) =>
    expect(sources(r)).toEqual({
      "zeus-idle-0000": {
        requestId: "zeus-idle",
        slotKey: "idle/south",
        ordinal: 0,
      },
      "zeus-idle-0001": {
        requestId: "zeus-idle",
        slotKey: "idle/north",
        ordinal: 1,
      },
    });

  test("a start that cannot be written stops the drain: both jobs stay queued and nothing is submitted", async () => {
    const r = await rig({});
    submit(r, "zeus-idle", { slots: 2 });
    blockLedger(r, 3);

    const result = await r.runtime.drain();

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect("results" in result).toBe(false);
    const jobs = jobsById(r);
    expect(jobs["zeus-idle-0000"]?.job.status).toBe("queued");
    expect(jobs["zeus-idle-0001"]?.job.status).toBe("queued");
    expectSources(r);
    expect(ledger(r).map((c) => `${c[1]}:${c[2]}`)).toEqual([
      "enqueue:zeus-idle-0000",
      "enqueue:zeus-idle-0001",
    ]);
    expect(events(r, "img_gen")).toEqual([]);
  });

  test("a success that cannot be written stops the drain: the job stays running and the next job is never submitted", async () => {
    const r = await rig({});
    submit(r, "zeus-idle", { slots: 2 });
    blockLedger(r, 4);

    const result = await r.runtime.drain();

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect("results" in result).toBe(false);
    const jobs = jobsById(r);
    expect(jobs["zeus-idle-0000"]?.job.status).toBe("running");
    expect(jobs["zeus-idle-0001"]?.job.status).toBe("queued");
    expectSources(r);
    expect(ledger(r).map((c) => `${c[1]}:${c[2]}`)).toEqual([
      "enqueue:zeus-idle-0000",
      "enqueue:zeus-idle-0001",
      "start:zeus-idle-0000",
    ]);
    expect(events(r, "img_gen")).toHaveLength(1);
    expect(blobs(r)).toHaveLength(1);
  });

  test("a lone job's success that cannot be written is not reported settled", async () => {
    const r = await rig({});
    submit(r, "zeus-idle");
    blockLedger(r, 3);

    const result = await r.runtime.drain();

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect("results" in result).toBe(false);
    expect(jobsById(r)["zeus-idle-0000"]?.job.status).toBe("running");
    expect(ledger(r).map((c) => `${c[1]}:${c[2]}`)).toEqual([
      "enqueue:zeus-idle-0000",
      "start:zeus-idle-0000",
    ]);
    expect(events(r, "img_gen")).toHaveLength(1);
  });

  test("a start failure's own start that cannot be written is refused and the job stays queued", async () => {
    const r = await rig({ exitOnStart: 7 });
    submit(r, "zeus-idle", { slots: 2 });
    blockLedger(r, 3);

    const result = await r.runtime.drain();

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect("results" in result).toBe(false);
    expect(jobsById(r)["zeus-idle-0000"]?.job.status).toBe("queued");
    expect(jobsById(r)["zeus-idle-0001"]?.job.status).toBe("queued");
    expectSources(r);
    expect(ledger(r).map((c) => `${c[1]}:${c[2]}`)).toEqual([
      "enqueue:zeus-idle-0000",
      "enqueue:zeus-idle-0001",
    ]);
  });

  test("an unavailable that cannot be written is refused, not reported as a closed session", async () => {
    const r = await rig({});
    submit(r, "zeus-idle", { slots: 2 });
    rmSync(join(r.dir, "models/vae.bin"));
    blockLedger(r, 3);

    const result = await r.runtime.drain();

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect("results" in result).toBe(false);
    expect(jobsById(r)["zeus-idle-0000"]?.job.status).toBe("queued");
    expect(jobsById(r)["zeus-idle-0001"]?.job.status).toBe("queued");
    expectSources(r);
    expect(readLog(r.dir)).toEqual([]);
  });
});
