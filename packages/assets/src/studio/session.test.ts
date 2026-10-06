import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import {
  queuedJob,
  reapChildren,
  removeTempRoots,
  request,
  runningJob,
  spawnHolder,
  succeededJob,
  tempRoot,
} from "./_test-fixtures";
import * as studio from "./index";
import { openStudioSession, readStudioStatus } from "./index";

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
    const put = (job: Parameters<typeof first.store.putJob>[0]["job"]) =>
      first.store.putJob({ schemaVersion: 1, requestId: "r1", job });
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
      requestId: "r1",
      job: runningJob("busy"),
    });
    first.close();
    writeFileSync(join(root, "jobs", "broken.json"), "{ not json");
    writeFileSync(
      join(root, "jobs", "wrong-shape.json"),
      JSON.stringify({ schemaVersion: 1, requestId: "r1", job: { id: "x" } }),
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
    for (const id of ["job-a", "job-b", "job-c"])
      expect(session.enqueue("r1", queuedJob(id))).toEqual({ ok: true });
    session.store.putJob({
      schemaVersion: 1,
      requestId: "r1",
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
    first.enqueue("r1", queuedJob("job-a"));
    first.close();
    const second = openOrFail(root);
    second.enqueue("r1", queuedJob("job-b"));
    second.close();
    expect(ledger(root)).toEqual([
      [1, "enqueue", "job-a"],
      [2, "enqueue", "job-b"],
    ]);
  });

  test("commands that do not fit the job's state are refused and not ledgered", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.enqueue("r1", queuedJob("job-a"));

    expect(session.abort("job-a")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    expect(session.remove("nope")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(session.enqueue("r1", queuedJob("job-a"))).toMatchObject({
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

    const result = session.enqueue("r1", queuedJob("job-a"));

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect(session.store.readJob("job-a").kind).toBe("missing");
    session.close();
  });

  test("enqueue is not acknowledged, and runs no work, when the ledger cannot be written", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    mkdirSync(join(root, "commands", "00000001.json"), { recursive: true });

    const result = session.enqueue("r1", queuedJob("job-a"));

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect(existsSync(join(root, "jobs", "job-a.json"))).toBe(false);
    session.close();
  });

  test("remove is not acknowledged when the cancelled record cannot be written", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.enqueue("r1", queuedJob("job-a"));
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
    expect(owner.enqueue("r1", queuedJob("new-owner-job"))).toEqual({
      ok: true,
    });
    owner.store.putJob({
      schemaVersion: 1,
      requestId: "r1",
      job: runningJob("running-job"),
    });
    const before = snapshot(root);

    expect(stale.enqueue("r1", queuedJob("closed-owner-job"))).toMatchObject({
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
    expect(owner.enqueue("r1", queuedJob("later-job"))).toEqual({ ok: true });
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
    owner.enqueue("r1", queuedJob("new-owner-job"));

    stale.enqueue("r1", queuedJob("closed-owner-job"));

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
    owner.enqueue("r1", queuedJob("b-job"));
    owner.store.putBlob(new Uint8Array([1, 2, 3]));
    const before = snapshot(root);
    const failed = {
      schemaVersion: 1,
      requestId: "r1",
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
        (s) => s.putRequest({ schemaVersion: 1, id: "r1", request }),
      ],
      ["putJob", (s) => s.putJob(failed)],
      [
        "putWorkspace",
        (s) =>
          s.putWorkspace({
            schemaVersion: 1,
            id: "w1",
            requestId: "r1",
            status: "open",
          }),
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

    for (const [name, attempt] of attempts) {
      expect(() => attempt(stale.store), name).toThrow(/closed/);
      expect(() => attempt(retained), name).toThrow(/closed/);
    }

    expect(snapshot(root)).toEqual(before);
    expect(owner.enqueue("r1", queuedJob("later-job"))).toEqual({ ok: true });
    expect(readStudioStatus(root).commands.map((c) => c.seq)).toEqual([1, 2]);
    owner.close();
  });

  test("reads stay available after close", () => {
    const root = tempRoot();
    const session = openOrFail(root);
    session.enqueue("r1", queuedJob("job-a"));
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
      "STUDIO_SCHEMA_VERSION",
      "openStudioSession",
      "readStudioStatus",
      "studioPaths",
    ]);
  });
});
