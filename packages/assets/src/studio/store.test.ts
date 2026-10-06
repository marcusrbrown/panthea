import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../hash";
import {
  queuedJob,
  removeTempRoots,
  request,
  succeededJob,
  tempRoot,
} from "./_test-fixtures";
import { readStudioStatus } from "./index";
import { openStore } from "./store";

afterEach(removeTempRoots);

const repoRoot = join(import.meta.dir, "..", "..", "..", "..");

describe("authoring root", () => {
  test(".studio is gitignored", () => {
    const result = Bun.spawnSync(
      ["git", "check-ignore", "-q", ".studio/jobs/a.json"],
      { cwd: repoRoot },
    );
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("status of a root that does not exist is empty and creates nothing", () => {
    const root = tempRoot();
    expect(readStudioStatus(root)).toEqual({
      session: undefined,
      requests: [],
      jobs: [],
      workspaces: [],
      commands: [],
      invalid: [],
    });
    expect(existsSync(root)).toBe(false);
  });
});

describe("records", () => {
  test("every record kind reads back as written", () => {
    const store = openStore(tempRoot());
    const session = {
      schemaVersion: 1,
      id: "s-1",
      pid: 42,
      startedAt: "2026-10-05T00:00:00.000Z",
    } as const;
    const requestRecord = { schemaVersion: 1, id: "r1", request } as const;
    const jobRecord = {
      schemaVersion: 1,
      requestId: "r1",
      job: succeededJob("job-a"),
    } as const;
    const workspace = {
      schemaVersion: 1,
      id: "w1",
      requestId: "r1",
      status: "open",
    } as const;
    const command = {
      schemaVersion: 1,
      seq: 1,
      type: "enqueue",
      jobId: "job-a",
      at: "2026-10-05T00:00:00.000Z",
    } as const;

    store.putSession(session);
    store.putRequest(requestRecord);
    store.putJob(jobRecord);
    store.putWorkspace(workspace);
    store.putCommand(command);

    expect(store.status()).toEqual({
      session,
      requests: [requestRecord],
      jobs: [jobRecord],
      workspaces: [workspace],
      commands: [command],
      invalid: [],
    });
  });

  test("a malformed record of each kind is reported by file; valid neighbours still read", () => {
    const root = tempRoot();
    const store = openStore(root);
    store.putRequest({ schemaVersion: 1, id: "good", request });
    store.putJob({
      schemaVersion: 1,
      requestId: "good",
      job: queuedJob("job-a"),
    });
    store.putWorkspace({
      schemaVersion: 1,
      id: "good",
      requestId: "good",
      status: "open",
    });
    store.putCommand({
      schemaVersion: 1,
      seq: 1,
      type: "enqueue",
      jobId: "job-a",
      at: "t",
    });
    writeFileSync(
      join(root, "requests", "bad.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "bad",
        request: { subject: "zeus" },
      }),
    );
    writeFileSync(join(root, "jobs", "bad.json"), "{");
    writeFileSync(
      join(root, "workspaces", "bad.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "bad",
        requestId: "good",
        status: "weird",
      }),
    );
    writeFileSync(
      join(root, "commands", "00000002.json"),
      JSON.stringify({
        schemaVersion: 1,
        seq: 2,
        type: "explode",
        jobId: "job-a",
        at: "t",
      }),
    );
    writeFileSync(join(root, "session.json"), "garbage");

    const status = store.status();

    expect(status.invalid.map((p) => p.file).sort()).toEqual([
      "commands/00000002.json",
      "jobs/bad.json",
      "requests/bad.json",
      "session.json",
      "workspaces/bad.json",
    ]);
    expect(status.invalid.every((p) => p.message.length > 0)).toBe(true);
    expect(status.session).toBeUndefined();
    expect(status.requests.map((r) => r.id)).toEqual(["good"]);
    expect(status.jobs.map((r) => r.job.id)).toEqual(["job-a"]);
    expect(status.workspaces.map((r) => r.id)).toEqual(["good"]);
    expect(status.commands.map((r) => r.seq)).toEqual([1]);
    expect(readFileSync(join(root, "jobs", "bad.json"), "utf8")).toBe("{");
  });

  test("temp files from an interrupted write are neither listed nor reported", () => {
    const root = tempRoot();
    const store = openStore(root);
    store.putJob({
      schemaVersion: 1,
      requestId: "r1",
      job: queuedJob("job-a"),
    });
    writeFileSync(join(root, "jobs", "job-b.json.123.abc.tmp"), '{"half":');

    const status = store.status();

    expect(status.jobs.map((r) => r.job.id)).toEqual(["job-a"]);
    expect(status.invalid).toEqual([]);
  });

  test("a failed write leaves no temp file behind", () => {
    const root = tempRoot();
    const store = openStore(root);
    mkdirSync(join(root, "jobs", "job-a.json"), { recursive: true });

    expect(() =>
      store.putJob({
        schemaVersion: 1,
        requestId: "r1",
        job: queuedJob("job-a"),
      }),
    ).toThrow();

    expect(readdirSync(join(root, "jobs"))).toEqual(["job-a.json"]);
  });

  test("a rewrite replaces the whole record", () => {
    const root = tempRoot();
    const store = openStore(root);
    store.putJob({
      schemaVersion: 1,
      requestId: "r1",
      job: queuedJob("job-a"),
    });
    store.putJob({
      schemaVersion: 1,
      requestId: "r1",
      job: succeededJob("job-a"),
    });

    expect(store.status().jobs.map((r) => r.job.status)).toEqual(["succeeded"]);
    expect(readdirSync(join(root, "jobs"))).toEqual(["job-a.json"]);
  });
});

describe("blobs", () => {
  test("bytes are stored once under their SHA-256 and read back unchanged", () => {
    const root = tempRoot();
    const store = openStore(root);
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

    const hash = store.putBlob(bytes);
    expect(hash).toBe(sha256Hex(bytes));
    expect(store.putBlob(bytes.slice())).toBe(hash);

    expect(readdirSync(join(root, "blobs"))).toEqual([`${hash}.png`]);
    expect(store.readBlob(hash)).toEqual(bytes);
    expect(store.putBlob(new Uint8Array([9]))).not.toBe(hash);
    expect(store.readBlob("0".repeat(64) as typeof hash)).toBeUndefined();
  });
});
