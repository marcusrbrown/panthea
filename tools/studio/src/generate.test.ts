import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  adapterInput,
  buildSpec,
  newRequestRecord,
  readStudioStatus,
} from "@panthea/assets/studio";
import { readLog } from "../../../packages/assets/src/studio/_test-runtime";
import {
  alive,
  capture,
  depsFor,
  realContent,
  removeTempRoots,
  run,
  runtimeRig,
  sleep,
  waitFor,
} from "./_testkit";
import { execute } from "./commands";
import { exitOf, type Outcome } from "./format";
import { Studio } from "./host";

afterEach(removeTempRoots);

const SOUTH = [{ state: "idle", direction: "south" }];
const NORTH = [{ state: "idle", direction: "north" }];
const sentBodies = (dir: string) =>
  readLog(dir)
    .filter((e) => e.event === "img_gen")
    .map(
      (e) =>
        e.body as Record<string, unknown> & { seed: number; prompt: string },
    );
const jobsOf = (outcome: Outcome) =>
  (outcome.ok
    ? (outcome.result as { jobs: Record<string, unknown>[] }).jobs
    : (outcome.error.jobs as unknown as Record<string, unknown>[])) ?? [];

describe("a one-shot generation", () => {
  test("runs the request to completion, persists it, and a library call with the same seed sends the same adapter inputs", async () => {
    const rig = await runtimeRig();

    const { outcome, cap } = await run(
      rig.config,
      "generate",
      {
        id: "zeus-idle",
        subject: "zeus",
        kind: "sprite",
        slots: SOUTH,
        batch: 1,
        seed: 77,
      },
      rig.deps,
    );

    expect(outcome).toMatchObject({
      ok: true,
      result: { state: "completed", requestId: "zeus-idle" },
    });
    expect(exitOf(outcome)).toBe(0);
    expect(jobsOf(outcome)).toMatchObject([
      {
        id: "zeus-idle-0000",
        status: "succeeded",
        seed: 77,
        slotKey: "idle/south",
        ordinal: 0,
      },
    ]);
    const status = readStudioStatus(rig.root);
    expect(status.requests[0]).toMatchObject({
      id: "zeus-idle",
      nextOrdinal: 1,
      request: { seed: 77, batch: 1 },
    });
    expect(status.jobs[0]?.job.status).toBe("succeeded");

    const content = realContent();
    const built = newRequestRecord(
      content,
      {
        id: "zeus-idle",
        subject: "zeus",
        kind: "sprite",
        slots: SOUTH,
        batch: 1,
        seed: 77,
      },
      () => 0,
    );
    if (!built.ok) throw new Error("bad request");
    const spec = buildSpec(content, built.value.record.request);
    if (!spec.ok) throw new Error("bad spec");
    const expected = adapterInput(spec.value, "idle/south", 77);
    if (!expected.ok) throw new Error("bad input");
    const [sent] = sentBodies(rig.dir);
    expect(sent).toMatchObject({
      prompt: expected.value.prompt,
      negative_prompt: expected.value.negativePrompt,
      width: expected.value.width,
      height: expected.value.height,
      seed: 77,
      sample_params: {
        sample_method: expected.value.sampleMethod,
        sample_steps: expected.value.sampleSteps,
        guidance: { txt_cfg: expected.value.txtCfg },
      },
    });
    expect(cap.err.some((l) => l.includes("zeus-idle-0000"))).toBe(true);
  });

  test("prints ids, statuses and hashes only: no prompt, engine setting, path or server output", async () => {
    const rig = await runtimeRig();

    const { outcome, cap } = await run(
      rig.config,
      "generate",
      {
        id: "zeus-idle",
        subject: "zeus",
        kind: "sprite",
        slots: SOUTH,
        batch: 1,
        seed: 5,
        styleNote: "PRIVATE-STYLE-NOTE",
      },
      rig.deps,
    );

    const [sent] = sentBodies(rig.dir);
    const text = JSON.stringify(outcome) + cap.err.join("\n");
    expect(text).not.toContain(sent?.prompt as string);
    expect(text).not.toContain("PRIVATE-STYLE-NOTE");
    expect(text).not.toContain("negative_prompt");
    expect(text).not.toContain("settings");
    expect(text).not.toContain(rig.dir);
    expect(text).not.toContain("sample_steps");
  });

  test("an omitted seed is drawn once, persisted, and continued by a reroll without replacing the first jobs", async () => {
    const rig = await runtimeRig();
    let draws = 0;
    const deps = {
      ...rig.deps,
      drawSeed: () => {
        draws += 1;
        return draws * 1000;
      },
    };

    const first = await run(
      rig.config,
      "generate",
      {
        id: "zeus-idle",
        subject: "zeus",
        kind: "sprite",
        slots: SOUTH,
        batch: 1,
      },
      deps,
    );
    const second = await run(
      rig.config,
      "reroll",
      { requestId: "zeus-idle", perSlot: 1 },
      deps,
    );

    expect(first.outcome.ok && second.outcome.ok).toBe(true);
    expect(draws).toBe(1);
    const status = readStudioStatus(rig.root);
    expect(status.requests[0]?.request.seed).toBe(1000);
    expect(
      status.jobs.map((j) => [j.job.id, j.job.request.seed, j.source.ordinal]),
    ).toEqual([
      ["zeus-idle-0000", 1000, 0],
      ["zeus-idle-0001", 1001, 1],
    ]);
    expect(status.jobs.every((j) => j.job.status === "succeeded")).toBe(true);
  });

  test("a bad request is a usage error with the valid alternatives and nothing is queued", async () => {
    const rig = await runtimeRig();

    const subject = await run(
      rig.config,
      "generate",
      { id: "r", subject: "nobody", kind: "sprite", slots: SOUTH, seed: 1 },
      rig.deps,
    );
    const state = await run(
      rig.config,
      "generate",
      {
        id: "r",
        subject: "zeus",
        kind: "sprite",
        slots: [{ state: "fly", direction: "south" }],
        seed: 1,
      },
      rig.deps,
    );
    const kind = await run(
      rig.config,
      "generate",
      { id: "r", subject: "zeus", kind: "tile", slots: SOUTH, seed: 1 },
      rig.deps,
    );
    const slots = await run(
      rig.config,
      "generate",
      { id: "r", subject: "zeus", kind: "sprite", slots: [], seed: 1 },
      rig.deps,
    );

    expect(subject.outcome).toMatchObject({
      ok: false,
      error: {
        code: "invalid-request",
        error: { kind: "unknown-subject", valid: expect.any(Array) },
      },
    });
    expect(state.outcome).toMatchObject({
      ok: false,
      error: {
        code: "invalid-request",
        error: { kind: "unknown-state", valid: expect.any(Array) },
      },
    });
    expect(kind.outcome).toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
    expect(slots.outcome).toMatchObject({
      ok: false,
      error: { code: "invalid-arguments" },
    });
    expect(
      [subject, state, kind, slots].every((r) => exitOf(r.outcome) === 64),
    ).toBe(true);
    expect(readStudioStatus(rig.root).requests).toEqual([]);
  });

  test("a missing runtime config is refused before anything is queued", async () => {
    const rig = await runtimeRig();
    const { runtime: _runtime, ...bare } = rig.config;

    const { outcome } = await run(
      bare,
      "generate",
      { id: "r", subject: "zeus", kind: "sprite", slots: SOUTH, seed: 1 },
      rig.deps,
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "missing-config", field: "runtime" },
    });
    expect(readStudioStatus(rig.root).requests).toEqual([]);
  });
});

describe("a generation that does not succeed is not reported as success", () => {
  test("a server-reported failure is exit 1 with the failed job, and the next job still runs", async () => {
    const rig = await runtimeRig({ sequence: ["failed", "ok"] });

    const { outcome } = await run(
      rig.config,
      "generate",
      {
        id: "zeus-idle",
        subject: "zeus",
        kind: "sprite",
        slots: SOUTH,
        batch: 2,
        seed: 1,
      },
      rig.deps,
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "generation-failed" },
    });
    expect(exitOf(outcome)).toBe(1);
    expect(jobsOf(outcome).map((j) => j.status)).toEqual([
      "failed",
      "succeeded",
    ]);
  });

  test("an unavailable runtime fails every job with staging guidance and starts no server", async () => {
    const rig = await runtimeRig();
    rmSync(join(rig.dir, "models", "vae.bin"));

    const { outcome } = await run(
      rig.config,
      "generate",
      {
        id: "zeus-idle",
        subject: "zeus",
        kind: "sprite",
        slots: SOUTH,
        batch: 2,
        seed: 1,
      },
      rig.deps,
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "generation-failed" },
    });
    expect(exitOf(outcome)).toBe(1);
    expect(jobsOf(outcome)).toMatchObject([
      {
        status: "unavailable",
        reason: expect.stringContaining("vae"),
        staging: expect.stringContaining("artifact root"),
      },
      { status: "unavailable" },
    ]);
    expect(readLog(rig.dir)).toEqual([]);
  });

  test("an accepted job whose sibling could not be queued keeps its durable acknowledgement in the error", async () => {
    const rig = await runtimeRig();
    mkdirSync(join(rig.root, "jobs", "zeus-idle-0001.json"), {
      recursive: true,
    });

    const { outcome } = await run(
      rig.config,
      "generate",
      {
        id: "zeus-idle",
        subject: "zeus",
        kind: "sprite",
        slots: SOUTH,
        batch: 2,
        seed: 1,
      },
      rig.deps,
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: "wrong-state",
        requestId: "zeus-idle",
        enqueued: ["zeus-idle-0000"],
      },
    });
    expect(exitOf(outcome)).toBe(1);
    expect(readLog(rig.dir)).toEqual([]);
  });
});

describe("a session keeps answering while a generation runs", () => {
  test("generate acknowledges the durable queue at once; status, enqueue, remove and abort all answer while the server works", async () => {
    const rig = await runtimeRig({ sequence: ["hang", "ok"] });
    const cap = capture();
    const studio = new Studio(rig.config, depsFor(cap, rig.deps), "session");
    try {
      const first = await execute(studio, "generate", {
        id: "first",
        subject: "zeus",
        kind: "sprite",
        slots: SOUTH,
        batch: 1,
        seed: 1,
      });
      expect(first).toMatchObject({
        ok: true,
        result: { state: "queued", requestId: "first", jobIds: ["first-0000"] },
      });
      await waitFor(() => readLog(rig.dir).some((e) => e.event === "img_gen"));

      const status = await execute(studio, "status", {});
      const second = await execute(studio, "generate", {
        id: "second",
        subject: "zeus",
        kind: "sprite",
        slots: NORTH,
        batch: 1,
        seed: 2,
      });
      const listed = await execute(studio, "list", { kind: "jobs" });

      expect(status).toMatchObject({
        ok: true,
        result: { jobs: { running: 1 } },
      });
      expect(second).toMatchObject({
        ok: true,
        result: { state: "queued", jobIds: ["second-0000"] },
      });
      expect(listed).toMatchObject({
        ok: true,
        result: [
          { id: "first-0000", status: "running" },
          { id: "second-0000", status: "queued" },
        ],
      });

      const removed = await execute(studio, "remove", { jobId: "second-0000" });
      const aborted = await execute(studio, "abort", { jobId: "first-0000" });
      await studio.idle();

      expect(removed).toMatchObject({ ok: true, result: { state: "removed" } });
      expect(aborted).toMatchObject({ ok: true, result: { state: "aborted" } });
      const jobs = readStudioStatus(rig.root).jobs;
      expect(jobs.find((j) => j.job.id === "first-0000")?.job).toMatchObject({
        status: "cancelled",
        cancelledBy: "aborted",
      });
      expect(jobs.find((j) => j.job.id === "second-0000")?.job).toMatchObject({
        status: "cancelled",
        cancelledBy: "removed",
      });
      expect(sentBodies(rig.dir)).toHaveLength(1);
    } finally {
      await studio.teardown();
    }
    expect(readStudioStatus(rig.root).session?.endedAt).toBeString();
  });

  test("a job queued while another runs is run next by the same drain, with no second concurrent drain", async () => {
    const rig = await runtimeRig({ jobDelayMs: 150 });
    const cap = capture();
    const studio = new Studio(rig.config, depsFor(cap, rig.deps), "session");
    try {
      await execute(studio, "generate", {
        id: "a",
        subject: "zeus",
        kind: "sprite",
        slots: SOUTH,
        batch: 1,
        seed: 1,
      });
      await waitFor(() => readLog(rig.dir).some((e) => e.event === "img_gen"));
      await execute(studio, "generate", {
        id: "b",
        subject: "zeus",
        kind: "sprite",
        slots: NORTH,
        batch: 1,
        seed: 2,
      });
      await studio.idle();
    } finally {
      await studio.teardown();
    }

    const jobs = readStudioStatus(rig.root).jobs;
    expect(jobs.map((j) => [j.job.id, j.job.status])).toEqual([
      ["a-0000", "succeeded"],
      ["b-0000", "succeeded"],
    ]);
    expect(studio.drainRefusal()).toBeUndefined();
    expect(readLog(rig.dir).filter((e) => e.event === "start")).toHaveLength(1);
  });

  test("an abort in a process that is not running the job answers not-running, never reaching another process", async () => {
    const rig = await runtimeRig();

    const { outcome } = await run(
      rig.config,
      "abort",
      { jobId: "anything" },
      rig.deps,
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "not-running" },
    });
    expect(exitOf(outcome)).toBe(1);
  });
});

void alive;
void sleep;
