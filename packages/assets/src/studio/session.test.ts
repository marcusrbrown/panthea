import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { sha256Hex } from "../hash";
import {
  doneCandidate,
  engineFacts,
  jobSource,
  keyframe,
  loadContent,
  needsScaleCandidate,
  PROVISIONAL_TEST_PARAMS,
  queuedJob,
  reapChildren,
  removeTempRoots,
  request,
  runningJob,
  spawnHolder,
  studioAsset,
  succeededJob,
  TEST_PALETTE,
  tempRoot,
  workingSet,
} from "./_test-fixtures";
import * as studio from "./index";
import { openStudioSession, readStudioStatus } from "./index";
import { newRequestRecord } from "./request";

afterEach(async () => {
  await reapChildren();
  removeTempRoots();
});

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (!name.startsWith("session.lock"))
        out[relative(root, path)] = readFileSync(path, "utf8");
    }
  };
  walk(root);
  return out;
}

function openOrFail(root: string) {
  const opened = openStudioSession(root);
  if (opened.kind === "busy") throw new Error("expected an opened session");
  return opened.session;
}

describe("open and busy root", () => {
  test("opening creates the root and a readable session record", () => {
    const root = tempRoot();
    expect(existsSync(root)).toBe(false);
    const session = openOrFail(root);

    expect(existsSync(root)).toBe(true);
    const open = readStudioStatus(root).session;
    expect(open?.pid).toBe(process.pid);
    expect(open?.endedAt).toBeUndefined();

    session.close();
    expect(readStudioStatus(root).session?.endedAt).toBeString();
  });

  test("status is readable while another process owns the lock", async () => {
    const root = tempRoot();
    const holder = await spawnHolder(root, "held-job");
    expect(holder.seen).toContain("READY");

    const status = readStudioStatus(root);
    expect(status.session?.pid).toBe(holder.child.pid);
    expect(status.session?.endedAt).toBeUndefined();
    expect(status.jobs.map((r) => [r.job.id, r.job.status])).toEqual([
      ["held-job", "running"],
    ]);
    expect(status.invalid).toEqual([]);
  });

  test("a second writer refuses busy and leaves the store untouched", async () => {
    const root = tempRoot();
    const holder = await spawnHolder(root, "held-job");
    const before = snapshot(root);

    expect(openStudioSession(root).kind).toBe("busy");
    expect((await spawnHolder(root, "other-job")).seen).toContain("BUSY");

    expect(snapshot(root)).toEqual(before);
    expect(holder.child.exitCode).toBeNull();
    expect(readStudioStatus(root).invalid).toEqual([]);
  });
});

describe("lock lifetime", () => {
  test("the lock is released by close", () => {
    const root = tempRoot();
    openOrFail(root).close();
    openOrFail(root).close();
  });

  test("the lock is released when the owning process exits cleanly", async () => {
    const root = tempRoot();
    const { child } = await spawnHolder(root, "held-job");
    expect(openStudioSession(root).kind).toBe("busy");

    child.kill("SIGTERM");
    await child.exited;
    expect(child.exitCode).toBe(0);

    const session = openOrFail(root);
    expect(session.recovered).toEqual(["held-job"]);
    session.close();
  });

  test("the lock is released when the owning process is SIGKILLed", async () => {
    const root = tempRoot();
    const { child } = await spawnHolder(root, "held-job");

    child.kill("SIGKILL");
    await child.exited;

    const session = openOrFail(root);
    expect(session.recovered).toEqual(["held-job"]);
    const record = readStudioStatus(root).jobs[0];
    expect(record?.job.status).toBe("failed");
    session.close();
  });
});

describe("recovery", () => {
  test("interrupted queued and running jobs fail with a reason; other records are preserved", () => {
    const root = tempRoot();
    const first = openOrFail(root);
    let ordinal = 0;
    const put = (job: Parameters<typeof first.store.putJob>[0]["job"]) =>
      first.store.putJob({
        schemaVersion: 1,
        source: jobSource("r1", ordinal++),
        job,
        ...(job.status === "succeeded" ? { engine: engineFacts() } : {}),
      });
    put(queuedJob("waiting"));
    put(runningJob("busy"));
    put(succeededJob("done"));
    put({ ...queuedJob("failed-before"), status: "failed", error: "boom" });
    put({
      ...queuedJob("removed-before"),
      status: "cancelled",
      cancelledBy: "removed",
    });
    first.store.putRequest({
      schemaVersion: 1,
      id: "r1",
      request: queuedJob("x").request,
      nextOrdinal: 0,
    });
    first.close();
    const preserved = ["done", "failed-before", "removed-before"].map((id) =>
      readFileSync(join(root, "jobs", `${id}.json`), "utf8"),
    );
    const requestBytes = readFileSync(
      join(root, "requests", "r1.json"),
      "utf8",
    );

    const second = openOrFail(root);
    expect(second.recovered.slice().sort()).toEqual(["busy", "waiting"]);
    second.close();

    expect(
      readStudioStatus(root).jobs.map((r) => [r.job.id, r.source]),
    ).toEqual([
      ["busy", jobSource("r1", 1)],
      ["done", jobSource("r1", 2)],
      ["failed-before", jobSource("r1", 3)],
      ["removed-before", jobSource("r1", 4)],
      ["waiting", jobSource("r1", 0)],
    ]);
    const jobs = Object.fromEntries(
      readStudioStatus(root).jobs.map((r) => [r.job.id, r.job]),
    );
    for (const id of ["waiting", "busy"]) {
      const job = jobs[id];
      expect(job?.status).toBe("failed");
      if (job?.status === "failed") expect(job.error).toContain("interrupted");
    }
    expect(
      ["done", "failed-before", "removed-before"].map((id) =>
        readFileSync(join(root, "jobs", `${id}.json`), "utf8"),
      ),
    ).toEqual(preserved);
    expect(readFileSync(join(root, "requests", "r1.json"), "utf8")).toBe(
      requestBytes,
    );
  });

  test("a malformed record is reported and recovery leaves it and its neighbours alone", () => {
    const root = tempRoot();
    const first = openOrFail(root);
    first.store.putJob({
      schemaVersion: 1,
      source: jobSource(),
      job: runningJob("busy"),
    });
    first.close();
    writeFileSync(join(root, "jobs", "broken.json"), "{ not json");
    writeFileSync(
      join(root, "jobs", "wrong-shape.json"),
      JSON.stringify({
        schemaVersion: 1,
        source: jobSource(),
        job: { id: "x" },
      }),
    );

    const second = openOrFail(root);
    expect(second.recovered).toEqual(["busy"]);
    second.close();

    expect(readFileSync(join(root, "jobs", "broken.json"), "utf8")).toBe(
      "{ not json",
    );
    expect(existsSync(join(root, "jobs", "wrong-shape.json"))).toBe(true);
    const status = readStudioStatus(root);
    expect(status.invalid.map((p) => p.file).sort()).toEqual([
      "jobs/broken.json",
      "jobs/wrong-shape.json",
    ]);
    expect(status.jobs.map((r) => r.job.id)).toEqual(["busy"]);
  });
});

describe("commands", () => {
  const jobStatuses = (root: string) =>
    Object.fromEntries(
      readStudioStatus(root).jobs.map((r) => [r.job.id, r.job.status]),
    );
  const ledger = (root: string) =>
    readStudioStatus(root).commands.map((c) => [c.seq, c.type, c.jobId]);

  test("enqueue, remove and abort stay in the ledger and the status", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    for (const [ordinal, id] of ["job-a", "job-b", "job-c"].entries())
      expect(session.enqueue(jobSource("r1", ordinal), queuedJob(id))).toEqual({
        ok: true,
      });
    session.store.putJob({
      schemaVersion: 1,
      source: jobSource("r1", 2),
      job: runningJob("job-c"),
    });

    expect(session.remove("job-a")).toEqual({ ok: true });
    expect(session.abort("job-c")).toEqual({ ok: true });

    const expectedLedger = [
      [1, "enqueue", "job-a"],
      [2, "enqueue", "job-b"],
      [3, "enqueue", "job-c"],
      [4, "remove", "job-a"],
      [5, "abort", "job-c"],
    ];
    expect(ledger(root)).toEqual(expectedLedger);
    const jobs = Object.fromEntries(
      readStudioStatus(root).jobs.map((r) => [r.job.id, r.job]),
    );
    expect(jobs["job-a"]).toMatchObject({
      status: "cancelled",
      cancelledBy: "removed",
    });
    expect(jobs["job-b"]?.status).toBe("queued");
    expect(jobs["job-c"]).toMatchObject({
      status: "cancelled",
      cancelledBy: "aborted",
    });
    expect(jobs["job-c"]).not.toHaveProperty("progress");
    expect(
      readStudioStatus(root).jobs.map((r) => [r.job.id, r.source]),
    ).toEqual([
      ["job-a", jobSource("r1", 0)],
      ["job-b", jobSource("r1", 1)],
      ["job-c", jobSource("r1", 2)],
    ]);

    session.close();
    const reopened = openOrFail(root);
    expect(reopened.recovered).toEqual(["job-b"]);
    expect(ledger(root)).toEqual(expectedLedger);
    expect(jobStatuses(root)["job-a"]).toBe("cancelled");
    reopened.close();
  });

  test("a command continues the ledger sequence after reopen", () => {
    const root = tempRoot();
    const first = openOrFail(root);
    first.enqueue(jobSource(), queuedJob("job-a"));
    first.close();
    const second = openOrFail(root);
    second.enqueue(jobSource(), queuedJob("job-b"));
    second.close();
    expect(ledger(root)).toEqual([
      [1, "enqueue", "job-a"],
      [2, "enqueue", "job-b"],
    ]);
  });

  test("commands that do not fit the job's state are refused and not ledgered", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.enqueue(jobSource(), queuedJob("job-a"));

    expect(session.abort("job-a")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    expect(session.remove("nope")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(session.enqueue(jobSource(), queuedJob("job-a"))).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    session.remove("job-a");
    expect(session.remove("job-a")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });

    expect(ledger(root)).toEqual([
      [1, "enqueue", "job-a"],
      [2, "remove", "job-a"],
    ]);
    session.close();
  });

  test("enqueue is not acknowledged when the job record cannot be written", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    writeFileSync(join(root, "jobs"), "not a directory");

    const result = session.enqueue(jobSource(), queuedJob("job-a"));

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect(session.store.readJob("job-a").kind).toBe("missing");
    session.close();
  });

  test("enqueue is not acknowledged, and runs no work, when the ledger cannot be written", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    mkdirSync(join(root, "commands", "00000001.json"), { recursive: true });

    const result = session.enqueue(jobSource(), queuedJob("job-a"));

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect(existsSync(join(root, "jobs", "job-a.json"))).toBe(false);
    session.close();
  });

  test("remove is not acknowledged when the cancelled record cannot be written", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.enqueue(jobSource(), queuedJob("job-a"));
    const before = readFileSync(join(root, "jobs", "job-a.json"), "utf8");
    mkdirSync(join(root, "commands", "00000002.json"), { recursive: true });

    expect(session.remove("job-a")).toMatchObject({
      ok: false,
      reason: "write-failed",
    });

    expect(readFileSync(join(root, "jobs", "job-a.json"), "utf8")).toBe(before);
    session.close();
  });
});

describe("a closed session", () => {
  test("refuses every command after a new owner took the root, leaving jobs and ledger untouched", () => {
    const root = tempRoot();
    const stale = openOrFail(root);
    stale.close();
    const owner = openOrFail(root);
    expect(owner.enqueue(jobSource(), queuedJob("new-owner-job"))).toEqual({
      ok: true,
    });
    owner.store.putJob({
      schemaVersion: 1,
      source: jobSource(),
      job: runningJob("running-job"),
    });
    const before = snapshot(root);

    expect(
      stale.enqueue(jobSource(), queuedJob("closed-owner-job")),
    ).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(stale.remove("new-owner-job")).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(stale.abort("running-job")).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(() => stale.close()).not.toThrow();

    expect(snapshot(root)).toEqual(before);
    expect(owner.enqueue(jobSource(), queuedJob("later-job"))).toEqual({
      ok: true,
    });
    expect(
      readStudioStatus(root).commands.map((c) => [c.seq, c.type, c.jobId]),
    ).toEqual([
      [1, "enqueue", "new-owner-job"],
      [2, "enqueue", "later-job"],
    ]);
    owner.close();
  });

  test("a closed session cannot overwrite the new owner's ledger entry", () => {
    const root = tempRoot();
    const stale = openOrFail(root);
    stale.close();
    const owner = openOrFail(root);
    owner.enqueue(jobSource(), queuedJob("new-owner-job"));

    stale.enqueue(jobSource(), queuedJob("closed-owner-job"));

    const status = readStudioStatus(root);
    expect(status.jobs.map((r) => r.job.id)).toEqual(["new-owner-job"]);
    expect(status.commands.map((c) => c.jobId)).toEqual(["new-owner-job"]);
    owner.close();
  });
});

describe("a closed session's store", () => {
  test("every mutator, by handle or retained reference, is refused before any effect", () => {
    const root = tempRoot();
    const stale = openOrFail(root);
    const retained = { ...stale.store };
    stale.close();
    const owner = openOrFail(root);
    owner.enqueue(jobSource(), queuedJob("b-job"));
    owner.store.putBlob(new Uint8Array([1, 2, 3]));
    const before = snapshot(root);
    const failed = {
      schemaVersion: 1,
      source: jobSource(),
      job: { ...queuedJob("b-job"), status: "failed", error: "stale" },
    } as const;
    const attempts: [string, (s: typeof stale.store) => unknown][] = [
      [
        "putSession",
        (s) =>
          s.putSession({
            schemaVersion: 1,
            id: "stale",
            pid: 1,
            startedAt: "t",
          }),
      ],
      [
        "putRequest",
        (s) =>
          s.putRequest({ schemaVersion: 1, id: "r1", request, nextOrdinal: 0 }),
      ],
      ["putJob", (s) => s.putJob(failed)],
      ["putCandidate", (s) => s.putCandidate(doneCandidate("stale-job"))],
      ["putWorkingSet", (s) => s.putWorkingSet(workingSet("stale-set"))],
      [
        "putEdit",
        (s) =>
          s.putEdit({
            schemaVersion: 1,
            id: "stale-edit",
            workingSetId: "w",
            slots: ["idle/south"],
            cell: { w: 64, h: 80 },
            base: {
              "idle/south": {
                kind: "keyframe",
                candidateId: "j",
                imageHash: sha256Hex(new Uint8Array([1])),
              },
            },
            evidence: {
              "idle/south": {
                params: { ...PROVISIONAL_TEST_PARAMS, scale: null },
                palette: {
                  ...TEST_PALETTE,
                  colours: [...TEST_PALETTE.colours],
                },
              },
            },
            baseSheet: {
              sheetHash: sha256Hex(new Uint8Array([2])),
              metadataHash: sha256Hex(new Uint8Array([3])),
            },
            baseSignature: {
              "idle/south": {
                frames: [
                  { hash: sha256Hex(new Uint8Array([4])), durationMs: 167 },
                ],
                pivot: null,
              },
            },
            status: "open",
            preview: null,
          }),
      ],
      ["putAsset", (s) => s.putAsset(studioAsset("stale-asset"))],
      [
        "putEditFile",
        (s) => s.putEditFile("stale-edit", "sheet.png", new Uint8Array([1])),
      ],
      [
        "putCommand",
        (s) =>
          s.putCommand({
            schemaVersion: 1,
            seq: 1,
            type: "enqueue",
            jobId: "stale-job",
            at: "t",
          }),
      ],
      ["putBlob", (s) => s.putBlob(new Uint8Array([9]))],
    ];

    const covered = attempts.map(([name]) => name).sort();
    const exposed = Object.keys(stale.store)
      .filter((key) => key.startsWith("put"))
      .sort();
    expect(
      covered,
      "every put* on the guarded store has a closed-session attempt",
    ).toEqual(exposed);

    for (const [name, attempt] of attempts) {
      expect(() => attempt(stale.store), name).toThrow(/closed/);
      expect(() => attempt(retained), name).toThrow(/closed/);
    }

    expect(snapshot(root)).toEqual(before);
    expect(owner.enqueue(jobSource(), queuedJob("later-job"))).toEqual({
      ok: true,
    });
    expect(readStudioStatus(root).commands.map((c) => c.seq)).toEqual([1, 2]);
    owner.close();
  });

  test("reads stay available after close", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.enqueue(jobSource(), queuedJob("job-a"));
    const hash = session.store.putBlob(new Uint8Array([1, 2, 3]));
    session.close();

    expect(session.store.readJob("job-a").kind).toBe("found");
    expect(session.store.status().jobs).toHaveLength(1);
    expect(session.store.readBlob(hash)).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("close releases the lock even when the closing record cannot be written", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    rmSync(join(root, "session.json"));
    mkdirSync(join(root, "session.json"));

    expect(() => session.close()).toThrow();
    expect(() => session.close()).not.toThrow();

    rmSync(join(root, "session.json"), { recursive: true });
    openOrFail(root).close();
  });
});

describe("public surface", () => {
  test("the studio subpath exposes the host and the lock-free reader, not the unlocked store factory", () => {
    expect(Object.keys(studio).sort()).toEqual([
      "DEFAULT_BATCH",
      "PROVIDER",
      "SELECTED_PROFILE",
      "STUDIO_SCHEMA_VERSION",
      "adapterInput",
      "buildSpec",
      "canonicalFrameHash",
      "createEditorAdapter",
      "decodePng",
      "loadStudioContent",
      "newRequestRecord",
      "openRuntime",
      "openStudioSession",
      "planJobs",
      "readStudioBlob",
      "readStudioStatus",
      "reportOnly",
      "resolveAseprite",
      "resolveEdit",
      "sheet",
      "slotConformance",
      "slotKey",
      "sortSheet",
      "studioPaths",
      "summarizeSheet",
    ]);
  });
});

describe("request submission", () => {
  const content = loadContent();
  const refuseDraw = () => {
    throw new Error("the seed supplier must not be called");
  };
  const faces = (
    id: string,
    seed?: number,
    draw: () => number = refuseDraw,
  ) => {
    const built = newRequestRecord(
      content,
      {
        id,
        subject: "zeus",
        kind: "portrait",
        slots: content.vocabulary.expressions.map((expression) => ({
          expression,
        })),
        ...(seed === undefined ? {} : { seed }),
      },
      draw,
    );
    if (!built.ok) throw new Error(JSON.stringify(built.error));
    return built.value.record;
  };
  const sources = (root: string) =>
    readStudioStatus(root).jobs.map((r) => [r.job.id, r.source]);

  test("six expressions persist the request and 24 narrowed jobs before acknowledging", () => {
    const root = tempRoot();
    let draws = 0;
    const record = faces("zeus-faces", undefined, () => {
      draws += 1;
      return 5000;
    });
    const session = openOrFail(root);

    const result = session.submitRequest(record);

    expect(result.ok).toBe(true);
    const status = readStudioStatus(root);
    expect(status.requests).toEqual([{ ...record, nextOrdinal: 24 }]);
    expect(status.requests[0]?.request.seed).toBe(5000);
    expect(status.jobs).toHaveLength(24);
    expect(new Set(status.jobs.map((r) => r.job.id)).size).toBe(24);
    for (const [index, { source, job }] of status.jobs.entries()) {
      expect(job.status).toBe("queued");
      expect(job.request.batch).toBe(1);
      expect(job.request.slots).toHaveLength(1);
      expect(job.request.seed).toBe(5000 + index);
      expect(source).toEqual({
        requestId: "zeus-faces",
        slotKey: content.vocabulary.expressions[Math.floor(index / 4)],
        ordinal: index,
      });
    }
    expect(result.ok && result.jobIds).toEqual(
      status.jobs.map((r) => r.job.id),
    );
    expect(status.commands.map((c) => [c.seq, c.type])).toEqual(
      [...Array(24).keys()].map((n) => [n + 1, "enqueue"]),
    );
    expect(draws).toBe(1);
    session.close();
  });

  test("seed, ordinal and sources survive reopen and recovery; a reroll continues and keeps other records", () => {
    const root = tempRoot();
    const first = openOrFail(root);
    first.submitRequest(faces("zeus-faces", 5000));
    first.store.putWorkingSet(
      workingSet("picked", { sheetRequestId: "zeus-faces" }),
    );
    const before = sources(root);
    first.close();

    const second = openOrFail(root);
    expect(second.recovered).toHaveLength(24);
    expect(sources(root)).toEqual(before);
    expect(readStudioStatus(root).requests[0]).toMatchObject({
      nextOrdinal: 24,
      request: { seed: 5000 },
    });
    const workspaceBytes = readFileSync(
      join(root, "working-sets", "picked.json"),
      "utf8",
    );

    const result = second.reroll("zeus-faces", 2);

    expect(result.ok && result.jobIds).toHaveLength(12);
    const status = readStudioStatus(root);
    expect(status.jobs).toHaveLength(36);
    const rerolled = status.jobs.filter((r) => r.source.ordinal >= 24);
    expect(rerolled.map((r) => r.source.ordinal).sort((a, b) => a - b)).toEqual(
      [...Array(12).keys()].map((n) => 24 + n),
    );
    for (const { source, job } of rerolled)
      expect(job.request.seed).toBe(5000 + source.ordinal);
    expect(status.requests[0]?.nextOrdinal).toBe(36);
    expect(
      readFileSync(join(root, "working-sets", "picked.json"), "utf8"),
    ).toBe(workspaceBytes);
    second.close();
  });

  test("a request that cannot be written acknowledges and enqueues nothing", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    writeFileSync(join(root, "requests"), "not a directory");

    const result = session.submitRequest(faces("zeus-faces", 1));

    expect(result).toMatchObject({
      ok: false,
      reason: "write-failed",
      enqueued: [],
    });
    expect(existsSync(join(root, "jobs"))).toBe(false);
    expect(existsSync(join(root, "commands"))).toBe(false);
    session.close();
  });

  test("a job that cannot be written reports what was enqueued and keeps its ordinals reserved", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    mkdirSync(join(root, "commands", "00000003.json"), { recursive: true });

    const result = session.submitRequest(faces("zeus-faces", 1));

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect(!result.ok && result.enqueued).toEqual([
      "zeus-faces-0000",
      "zeus-faces-0001",
    ]);
    expect(readStudioStatus(root).jobs.map((r) => r.job.id)).toEqual([
      "zeus-faces-0000",
      "zeus-faces-0001",
    ]);
    expect(readStudioStatus(root).requests[0]?.nextOrdinal).toBe(24);
    session.close();
  });

  test("duplicate, unknown, empty and overflowing requests are refused before any write", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.submitRequest(faces("zeus-faces", 1));
    const before = snapshot(root);

    expect(session.submitRequest(faces("zeus-faces", 2))).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    expect(session.reroll("nobody", 1)).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(session.reroll("zeus-faces", 0)).toMatchObject({
      ok: false,
      reason: "invalid-request",
    });
    expect(
      session.submitRequest(faces("zeus-edge", Number.MAX_SAFE_INTEGER - 5)),
    ).toMatchObject({ ok: false, reason: "seed-overflow", enqueued: [] });

    expect(snapshot(root)).toEqual(before);
    session.close();
  });

  test("a closed session cannot submit or reroll into a new owner's store", () => {
    const root = tempRoot();
    const stale = openOrFail(root);
    stale.close();
    const owner = openOrFail(root);
    owner.submitRequest(faces("owner-faces", 1));
    const before = snapshot(root);

    expect(stale.submitRequest(faces("stale-faces", 2))).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(stale.reroll("owner-faces", 1)).toMatchObject({
      ok: false,
      reason: "closed",
    });

    expect(snapshot(root)).toEqual(before);
    owner.close();
  });
});

describe("job transitions", () => {
  const ledgerTypes = (root: string) =>
    readStudioStatus(root).commands.map((c) => [c.seq, c.type, c.jobId]);
  const image = {
    medium: "image",
    hash: sha256Hex(new Uint8Array([1])),
    width: 8,
    height: 8,
  } as const;

  test("queued lists jobs in durable enqueue order, not by name, and drops started or removed jobs", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    for (const [ordinal, id] of [
      "zz-first",
      "aa-second",
      "mm-third",
      "bb-fourth",
    ].entries())
      session.enqueue(jobSource("r1", ordinal), queuedJob(id));
    session.remove("mm-third");
    session.start("zz-first");

    const queued = session.queued();

    expect(queued.ok && queued.jobs.map((r) => r.job.id)).toEqual([
      "aa-second",
      "bb-fourth",
    ]);
    session.close();
  });

  test("start, succeed, fail and unavailable persist the job, keep its source and extend the one ledger", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    for (const [ordinal, id] of ["job-a", "job-b", "job-c", "job-d"].entries())
      session.enqueue(jobSource("r1", ordinal), queuedJob(id));

    expect(session.start("job-a")).toEqual({ ok: true });
    expect(session.succeed("job-a", [image], engineFacts())).toEqual({
      ok: true,
    });
    expect(session.start("job-b")).toEqual({ ok: true });
    expect(session.fail("job-b", "server said no")).toEqual({ ok: true });
    expect(session.unavailable("job-c", "no runtime", "stage it")).toEqual({
      ok: true,
    });
    expect(session.start("job-d")).toEqual({ ok: true });
    expect(session.unavailable("job-d", "runtime vanished", "restage")).toEqual(
      {
        ok: true,
      },
    );

    const jobs = Object.fromEntries(
      readStudioStatus(root).jobs.map((r) => [r.job.id, r]),
    );
    expect(jobs["job-a"]?.job).toMatchObject({
      status: "succeeded",
      outputs: [image],
    });
    expect(jobs["job-b"]?.job).toMatchObject({
      status: "failed",
      error: "server said no",
    });
    expect(jobs["job-c"]?.job).toMatchObject({
      status: "unavailable",
      reason: "no runtime",
      staging: "stage it",
    });
    expect(jobs["job-d"]?.job).toMatchObject({ status: "unavailable" });
    expect(jobs["job-a"]?.job.request).toEqual(queuedJob("job-a").request);
    expect(readStudioStatus(root).jobs.map((r) => r.source.ordinal)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(ledgerTypes(root)).toEqual([
      [1, "enqueue", "job-a"],
      [2, "enqueue", "job-b"],
      [3, "enqueue", "job-c"],
      [4, "enqueue", "job-d"],
      [5, "start", "job-a"],
      [6, "succeed", "job-a"],
      [7, "start", "job-b"],
      [8, "fail", "job-b"],
      [9, "unavailable", "job-c"],
      [10, "start", "job-d"],
      [11, "unavailable", "job-d"],
    ]);
    session.close();
  });

  test("a success stores its engine facts with its outputs, and no other state carries them", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    for (const [ordinal, id] of ["job-a", "job-b", "job-c"].entries())
      session.enqueue(jobSource("r1", ordinal), queuedJob(id));
    const engine = engineFacts({
      loras: [{ id: "pixel-lora", sha256: sha256Hex(new Uint8Array([7])) }],
    });
    session.start("job-a");
    session.start("job-b");
    session.start("job-c");

    expect(session.succeed("job-a", [image], engine)).toEqual({ ok: true });
    session.fail("job-b", "x");
    session.abort("job-c");

    const jobs = Object.fromEntries(
      readStudioStatus(root).jobs.map((r) => [r.job.id, r]),
    );
    expect(jobs["job-a"]?.engine).toEqual(engine);
    expect(jobs["job-b"]).not.toHaveProperty("engine");
    expect(jobs["job-c"]).not.toHaveProperty("engine");
    expect(readStudioStatus(root).invalid).toEqual([]);
    session.close();
  });

  test("a success whose engine facts could not be read back is refused and leaves the job running", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.enqueue(jobSource(), queuedJob("job-a"));
    session.start("job-a");
    const before = snapshot(root);
    const bad = [
      engineFacts({ settings: { apiKey: "x" } }),
      engineFacts({ settings: { server: "http://127.0.0.1:1" } }),
      { ...engineFacts(), extra: 1 } as never,
      { ...engineFacts(), runtimeBinarySha256: "xyz" } as never,
    ];

    for (const engine of bad)
      expect(session.succeed("job-a", [image], engine)).toMatchObject({
        ok: false,
        reason: "invalid-params",
      });

    expect(snapshot(root)).toEqual(before);
    expect(readStudioStatus(root).jobs[0]?.job.status).toBe("running");
    session.close();
  });

  test("a success whose record cannot be written is not acknowledged and stores no engine facts", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.enqueue(jobSource(), queuedJob("job-a"));
    session.start("job-a");
    mkdirSync(join(root, "commands", "00000003.json"));

    expect(session.succeed("job-a", [image], engineFacts())).toMatchObject({
      ok: false,
      reason: "write-failed",
    });

    const record = readStudioStatus(root).jobs[0];
    expect(record?.job.status).toBe("running");
    expect(record).not.toHaveProperty("engine");
    session.close();
  });

  test("a transition that does not fit the job's state is refused and not ledgered", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.enqueue(jobSource(), queuedJob("job-a"));

    expect(session.succeed("job-a", [image], engineFacts())).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    expect(session.fail("job-a", "x")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    session.start("job-a");
    expect(session.start("job-a")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    session.abort("job-a");
    expect(session.succeed("job-a", [image], engineFacts())).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    expect(session.start("nope")).toMatchObject({
      ok: false,
      reason: "not-found",
    });

    expect(ledgerTypes(root)).toEqual([
      [1, "enqueue", "job-a"],
      [2, "start", "job-a"],
      [3, "abort", "job-a"],
    ]);
    session.close();
  });

  test("a closed session refuses every transition and the queue, leaving a new owner's store untouched", () => {
    const root = tempRoot();
    const stale = openOrFail(root);
    stale.close();
    const owner = openOrFail(root);
    owner.enqueue(jobSource(), queuedJob("job-a"));
    owner.enqueue(jobSource("r1", 1), queuedJob("job-b"));
    owner.start("job-b");
    const before = snapshot(root);

    for (const result of [
      stale.start("job-a"),
      stale.succeed("job-b", [image], engineFacts()),
      stale.fail("job-b", "x"),
      stale.unavailable("job-a", "x", "y"),
    ])
      expect(result).toMatchObject({ ok: false, reason: "closed" });
    expect(stale.queued()).toMatchObject({ ok: false, reason: "closed" });

    expect(snapshot(root)).toEqual(before);
    owner.close();
  });
});

describe("working sets", () => {
  const content = loadContent();
  const refuseDraw = () => {
    throw new Error("the seed supplier must not be called");
  };
  const request = (
    id: string,
    kind: "sprite" | "portrait",
    slots: { state?: string; direction?: string; expression?: string }[],
    subject = "zeus",
  ) => {
    const built = newRequestRecord(
      content,
      { id, subject, kind, slots, batch: 1, seed: 1 },
      refuseDraw,
    );
    if (!built.ok) throw new Error(JSON.stringify(built.error));
    return built.value.record;
  };
  const expressions = content.vocabulary.expressions.map((expression) => ({
    expression,
  }));
  const spriteSlots = [
    { state: "idle", direction: "south" },
    { state: "idle", direction: "north" },
  ];
  const setOf = (root: string, id: string) =>
    readStudioStatus(root).workingSets.find((w) => w.id === id);
  const bytesOf = (root: string, id: string) =>
    readFileSync(join(root, "working-sets", `${id}.json`), "utf8");
  const pickLedger = (root: string) =>
    readStudioStatus(root)
      .commands.filter((c) => c.type === "pick")
      .map((c) => c.jobId);

  function portraitSession(root: string) {
    const session = openOrFail(root);
    session.submitRequest(request("faces-a", "portrait", expressions));
    expect(session.openWorkingSet("zeus-faces", "faces-a", content)).toEqual({
      ok: true,
    });
    return session;
  }
  const faceCandidate = (
    id: string,
    expression: string,
    requestId = "faces-a",
    extra = {},
  ) =>
    doneCandidate(id, {
      requestId,
      slotKey: expression,
      kind: "portrait",
      ...extra,
    });

  test("opening a set from a six-expression portrait request requires all six; a sprite set requires the request's slots", () => {
    const root = tempRoot();
    const session = portraitSession(root);
    session.submitRequest(request("walk-a", "sprite", spriteSlots));

    expect(session.openWorkingSet("zeus-idle", "walk-a", content)).toEqual({
      ok: true,
    });

    expect(setOf(root, "zeus-faces")).toEqual({
      schemaVersion: 1,
      id: "zeus-faces",
      subject: "zeus",
      kind: "portrait",
      sheetRequestId: "faces-a",
      required: [...content.vocabulary.expressions],
      limits: Object.fromEntries(
        content.vocabulary.expressions.map((slot) => [
          slot,
          { min: 1, max: 1 },
        ]),
      ),
      picks: {},
      frames: {},
      status: "open",
    });
    expect(setOf(root, "zeus-idle")).toMatchObject({
      kind: "sprite",
      required: ["idle/south", "idle/north"],
      limits: {
        "idle/south": { min: 4, max: 4 },
        "idle/north": { min: 4, max: 4 },
      },
      sheetRequestId: "walk-a",
    });
    session.close();
  });

  test("a duplicate id, a bad id and an unknown request are refused without writing", () => {
    const root = tempRoot();
    const session = portraitSession(root);
    const before = bytesOf(root, "zeus-faces");

    expect(
      session.openWorkingSet("zeus-faces", "faces-a", content),
    ).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(
      session.openWorkingSet("Not A Slug", "faces-a", content),
    ).toMatchObject({ ok: false, reason: "invalid-params" });
    expect(
      session.openWorkingSet("../escape", "faces-a", content),
    ).toMatchObject({ ok: false, reason: "invalid-params" });
    expect(session.openWorkingSet("zeus-more", "nope", content)).toMatchObject({
      ok: false,
      reason: "not-found",
    });

    expect(bytesOf(root, "zeus-faces")).toBe(before);
    expect(readdirSync(join(root, "working-sets"))).toEqual([
      "zeus-faces.json",
    ]);
    session.close();
  });

  test("a portrait set is complete only when all six expressions are picked, each pick ledgered with the candidate id", () => {
    const root = tempRoot();
    const session = portraitSession(root);
    const names = content.vocabulary.expressions;
    names.forEach((expression, index) => {
      session.store.putCandidate(faceCandidate(`face-${index}`, expression));
    });

    names.forEach((_, index) => {
      expect(session.pick("zeus-faces", `face-${index}`)).toEqual({ ok: true });
      expect(setOf(root, "zeus-faces")?.status).toBe(
        index === names.length - 1 ? "complete" : "open",
      );
    });

    expect(names).toHaveLength(6);
    expect(pickLedger(root)).toEqual(names.map((_, i) => `face-${i}`));
    expect(Object.keys(setOf(root, "zeus-faces")?.picks ?? {})).toEqual([
      ...names,
    ]);
    session.close();
  });

  test("a portrait set requires the expressions its request selected, in vocabulary order, and is complete when exactly those are picked", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    const names = content.vocabulary.expressions;
    const chosen = [names[4] as string, names[1] as string];
    session.submitRequest(
      request(
        "faces-two",
        "portrait",
        chosen.map((expression) => ({ expression })),
      ),
    );

    expect(session.openWorkingSet("two-faces", "faces-two", content)).toEqual({
      ok: true,
    });

    const wanted = names.filter((name) => chosen.includes(name));
    expect(setOf(root, "two-faces")).toMatchObject({
      required: wanted,
      limits: Object.fromEntries(
        wanted.map((slot) => [slot, { min: 1, max: 1 }]),
      ),
      status: "open",
    });
    for (const [index, expression] of chosen.entries())
      session.store.putCandidate(
        faceCandidate(`two-${index}`, expression, "faces-two", {
          ordinal: index,
        }),
      );
    expect(session.pick("two-faces", "two-0")).toEqual({ ok: true });
    expect(setOf(root, "two-faces")?.status).toBe("open");
    expect(session.pick("two-faces", "two-1")).toEqual({ ok: true });
    expect(setOf(root, "two-faces")?.status).toBe("complete");
    session.store.putCandidate(
      faceCandidate(
        "other",
        names.find((n) => !chosen.includes(n)) as string,
        "faces-two",
        { ordinal: 9 },
      ),
    );
    expect(session.pick("two-faces", "other")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    session.close();
  });

  test("a stored portrait request with an expression the vocabulary does not have is refused, never trimmed to the rest", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    const good = request("faces-bad", "portrait", [
      { expression: content.vocabulary.expressions[0] as string },
    ]);
    session.store.putRequest({
      ...good,
      request: {
        ...good.request,
        slots: [...good.request.slots, { expression: "bored" }],
      },
    });
    const before = readStudioStatus(root).workingSets;

    const result = session.openWorkingSet("bad-faces", "faces-bad", content);

    expect(result).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(!result.ok && result.message).toMatch(/bored/);
    expect(readStudioStatus(root).workingSets).toEqual(before);
    session.close();
  });

  test("a sprite set stays open however many slots are picked", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.submitRequest(request("walk-a", "sprite", spriteSlots));
    session.openWorkingSet("zeus-idle", "walk-a", content);
    session.store.putCandidate(
      doneCandidate("walk-1", { requestId: "walk-a", slotKey: "idle/south" }),
    );
    session.store.putCandidate(
      doneCandidate("walk-2", {
        requestId: "walk-a",
        slotKey: "idle/north",
        ordinal: 1,
      }),
    );

    expect(session.pick("zeus-idle", "walk-2")).toEqual({ ok: true });
    expect(session.pick("zeus-idle", "walk-1")).toEqual({ ok: true });

    expect(Object.keys(JSON.parse(bytesOf(root, "zeus-idle")).picks)).toEqual([
      "idle/south",
      "idle/north",
    ]);
    expect(setOf(root, "zeus-idle")?.status).toBe("open");
    session.close();
  });

  test("a portrait slot may take a candidate drawn for another expression, and the pick keeps the candidate's true source", () => {
    const root = tempRoot();
    const session = portraitSession(root);
    session.submitRequest(
      request("faces-neutral", "portrait", [{ expression: "neutral" }]),
    );
    expect(session.replaceSheet("zeus-faces", "faces-neutral")).toEqual({
      ok: true,
    });
    session.store.putCandidate(
      faceCandidate("neutral-0001", "neutral", "faces-neutral"),
    );

    expect(session.pick("zeus-faces", "neutral-0001", "pleased")).toEqual({
      ok: true,
    });

    const pick = setOf(root, "zeus-faces")?.picks.pleased;
    expect(pick?.candidateId).toBe("neutral-0001");
    expect(pick?.source).toEqual({
      requestId: "faces-neutral",
      slotKey: "neutral",
      ordinal: 0,
    });
    expect(Object.keys(setOf(root, "zeus-faces")?.picks ?? {})).toEqual([
      "pleased",
    ]);

    for (const expression of content.vocabulary.expressions)
      expect(session.pick("zeus-faces", "neutral-0001", expression)).toEqual({
        ok: true,
      });
    const set = setOf(root, "zeus-faces");
    expect(set?.status).toBe("complete");
    for (const expression of content.vocabulary.expressions)
      expect(set?.picks[expression]).toEqual(set?.picks.pleased);
    expect(pickLedger(root)).toEqual(
      Array.from({ length: 7 }, () => "neutral-0001"),
    );
    session.close();
  });

  test("a cross-slot portrait pick still needs a slot the set requires", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.submitRequest(
      request("faces-two", "portrait", [
        { expression: "neutral" },
        { expression: "pleased" },
      ]),
    );
    session.openWorkingSet("two-faces", "faces-two", content);
    session.store.putCandidate(
      faceCandidate("neutral-0001", "neutral", "faces-two"),
    );
    const before = bytesOf(root, "two-faces");

    expect(session.pick("two-faces", "neutral-0001", "awed")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });

    expect(bytesOf(root, "two-faces")).toBe(before);
    expect(pickLedger(root)).toEqual([]);
    session.close();
  });

  test("with no slot a pick goes to the candidate's own slot", () => {
    const root = tempRoot();
    const session = portraitSession(root);
    session.store.putCandidate(faceCandidate("neutral-1", "neutral"));

    expect(session.pick("zeus-faces", "neutral-1")).toEqual({ ok: true });

    expect(Object.keys(setOf(root, "zeus-faces")?.picks ?? {})).toEqual([
      "neutral",
    ]);
    expect(setOf(root, "zeus-faces")?.picks.neutral?.source.slotKey).toBe(
      "neutral",
    );
    session.close();
  });

  test("a sprite slot only takes a candidate drawn for it", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.submitRequest(request("walk-a", "sprite", spriteSlots));
    session.openWorkingSet("zeus-idle", "walk-a", content);
    session.store.putCandidate(
      doneCandidate("walk-1", { requestId: "walk-a", slotKey: "idle/south" }),
    );
    const before = bytesOf(root, "zeus-idle");

    const refused = session.pick("zeus-idle", "walk-1", "idle/north");

    expect(refused).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(!refused.ok && refused.message).toMatch(
      /drawn for idle\/south.*not idle\/north/,
    );
    expect(bytesOf(root, "zeus-idle")).toBe(before);
    expect(pickLedger(root)).toEqual([]);
    expect(session.pick("zeus-idle", "walk-1", "idle/south")).toEqual({
      ok: true,
    });
    session.close();
  });

  test("a failing report may be picked; every other refusal leaves the set and the ledger unchanged", () => {
    const root = tempRoot();
    const session = portraitSession(root);
    session.submitRequest(request("walk-a", "sprite", spriteSlots));
    session.submitRequest(request("faces-b", "portrait", expressions));
    session.store.putCandidate(
      faceCandidate("failing", "neutral", "faces-a", { pass: false }),
    );
    expect(session.pick("zeus-faces", "failing")).toEqual({ ok: true });
    const picked = bytesOf(root, "zeus-faces");
    const ledgerBefore = pickLedger(root);

    const stuck = needsScaleCandidate("stuck", {
      requestId: "faces-a",
      slotKey: "pleased",
      kind: "portrait",
    });
    const refusals: [string, string, string][] = [
      ["no such set", "nope", "failing"],
      ["no such candidate", "zeus-faces", "ghost"],
      ["a bad candidate id", "zeus-faces", "../x"],
      ["a candidate that needs a scale", "zeus-faces", "stuck"],
      ["a sprite candidate for a portrait set", "zeus-faces", "sprite-c"],
      ["another subject's candidate", "zeus-faces", "other-subject"],
      ["a candidate of another sheet", "zeus-faces", "old-sheet"],
      [
        "a candidate for a slot the set does not need",
        "zeus-faces",
        "stray-slot",
      ],
    ];
    session.store.putCandidate(stuck);
    session.store.putCandidate(
      doneCandidate("sprite-c", {
        requestId: "faces-a",
        slotKey: "pleased",
        kind: "sprite",
      }),
    );
    session.store.putCandidate(
      faceCandidate("other-subject", "pleased", "faces-a", { subject: "hera" }),
    );
    session.store.putCandidate(
      faceCandidate("old-sheet", "pleased", "faces-b"),
    );
    session.store.putCandidate(faceCandidate("stray-slot", "ecstatic"));

    for (const [name, setId, candidateId] of refusals) {
      expect(session.pick(setId, candidateId), name).toMatchObject({
        ok: false,
      });
    }
    expect(session.pick("nope", "failing")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(session.pick("zeus-faces", "ghost")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(session.pick("zeus-faces", "stuck")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    expect(session.pick("zeus-faces", "old-sheet")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });

    expect(bytesOf(root, "zeus-faces")).toBe(picked);
    expect(pickLedger(root)).toEqual(ledgerBefore);
    session.close();
  });

  test("a pick is a snapshot: a re-conformed candidate leaves it unchanged until the slot is picked again", () => {
    const root = tempRoot();
    const session = portraitSession(root);
    session.store.putCandidate(faceCandidate("neutral-1", "neutral"));
    session.pick("zeus-faces", "neutral-1");
    const picked = bytesOf(root, "zeus-faces");

    session.store.putCandidate(
      faceCandidate("neutral-1", "neutral", "faces-a", {
        pass: false,
        pixelsChanged: 9,
      }),
    );
    expect(bytesOf(root, "zeus-faces")).toBe(picked);
    expect(setOf(root, "zeus-faces")?.picks.neutral).toEqual(
      keyframe(faceCandidate("neutral-1", "neutral")),
    );

    expect(session.pick("zeus-faces", "neutral-1")).toEqual({ ok: true });
    expect(setOf(root, "zeus-faces")?.picks.neutral?.report.status).toBe(
      "fail",
    );
    expect(Object.keys(setOf(root, "zeus-faces")?.picks ?? {})).toEqual([
      "neutral",
    ]);
    session.close();
  });

  test("picks survive a reroll and a sheet replacement; only the current sheet's candidates can be picked", () => {
    const root = tempRoot();
    const session = portraitSession(root);
    session.submitRequest(request("faces-b", "portrait", expressions));
    session.store.putCandidate(faceCandidate("neutral-1", "neutral"));
    session.pick("zeus-faces", "neutral-1");
    const picked = setOf(root, "zeus-faces")?.picks;

    expect(session.reroll("faces-a", 1)).toMatchObject({ ok: true });
    expect(setOf(root, "zeus-faces")?.picks).toEqual(picked);

    expect(session.replaceSheet("zeus-faces", "faces-b")).toEqual({ ok: true });
    expect(setOf(root, "zeus-faces")).toMatchObject({
      sheetRequestId: "faces-b",
      status: "open",
      picks: picked,
    });

    session.store.putCandidate(faceCandidate("old", "pleased", "faces-a"));
    session.store.putCandidate(faceCandidate("new", "pleased", "faces-b"));
    expect(session.pick("zeus-faces", "old")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    expect(session.pick("zeus-faces", "new")).toEqual({ ok: true });
    expect(Object.keys(setOf(root, "zeus-faces")?.picks ?? {})).toEqual([
      "neutral",
      "pleased",
    ]);
    session.close();
  });

  test("a sheet can only be replaced by a request of the same kind and subject that exists", () => {
    const root = tempRoot();
    const session = portraitSession(root);
    session.submitRequest(request("walk-a", "sprite", spriteSlots));
    const before = bytesOf(root, "zeus-faces");

    expect(session.replaceSheet("zeus-faces", "walk-a")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    expect(session.replaceSheet("zeus-faces", "nope")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(session.replaceSheet("nope", "faces-a")).toMatchObject({
      ok: false,
      reason: "not-found",
    });

    expect(bytesOf(root, "zeus-faces")).toBe(before);
    session.close();
  });

  test("a pick whose ledger entry cannot be written is refused and changes nothing", () => {
    const root = tempRoot();
    const session = portraitSession(root);
    session.store.putCandidate(faceCandidate("neutral-1", "neutral"));
    const before = bytesOf(root, "zeus-faces");
    const next = readStudioStatus(root).commands.length + 1;
    mkdirSync(join(root, "commands", `${String(next).padStart(8, "0")}.json`));

    expect(session.pick("zeus-faces", "neutral-1")).toMatchObject({
      ok: false,
      reason: "write-failed",
    });

    expect(bytesOf(root, "zeus-faces")).toBe(before);
    expect(setOf(root, "zeus-faces")?.picks).toEqual({});
    session.close();
  });

  test("a pick whose working set cannot be written is refused and leaves the set as it was", () => {
    const root = tempRoot();
    const session = portraitSession(root);
    session.store.putCandidate(faceCandidate("neutral-1", "neutral"));
    const before = bytesOf(root, "zeus-faces");
    chmodSync(join(root, "working-sets"), 0o500);
    try {
      expect(session.pick("zeus-faces", "neutral-1")).toMatchObject({
        ok: false,
        reason: "write-failed",
      });
    } finally {
      chmodSync(join(root, "working-sets"), 0o700);
    }

    expect(bytesOf(root, "zeus-faces")).toBe(before);
    expect(setOf(root, "zeus-faces")?.picks).toEqual({});
    session.close();
  });

  test("a closed session refuses every working-set operation and leaves a new owner's store untouched", () => {
    const root = tempRoot();
    const stale = openOrFail(root);
    stale.close();
    const owner = portraitSession(root);
    owner.store.putCandidate(faceCandidate("neutral-1", "neutral"));
    owner.submitRequest(request("faces-b", "portrait", expressions));
    const before = snapshot(root);

    expect(stale.openWorkingSet("x", "faces-a", content)).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(stale.replaceSheet("zeus-faces", "faces-b")).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(stale.pick("zeus-faces", "neutral-1")).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(
      stale.conform("job", content, {
        background: { type: "alpha" },
        alphaCutoff: 128,
        grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
      }),
    ).toMatchObject({ ok: false, reason: "closed" });

    expect(snapshot(root)).toEqual(before);
    owner.close();
  });

  test("method references taken before the close refuse afterwards too", () => {
    const root = tempRoot();
    const stale = openOrFail(root);
    const { conform, openWorkingSet, replaceSheet, pick } = stale;
    stale.close();
    const owner = portraitSession(root);
    owner.store.putCandidate(faceCandidate("neutral-1", "neutral"));
    const before = snapshot(root);

    expect(openWorkingSet("x", "faces-a", content)).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(replaceSheet("zeus-faces", "faces-a")).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(pick("zeus-faces", "neutral-1")).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(
      conform("job", content, {
        background: { type: "alpha" },
        alphaCutoff: 128,
        grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
      }),
    ).toMatchObject({ ok: false, reason: "closed" });

    expect(snapshot(root)).toEqual(before);
    owner.close();
  });
});
