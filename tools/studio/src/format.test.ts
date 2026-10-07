import { describe, expect, test } from "bun:test";
import type { JobRecord, StudioAssetRecord } from "@panthea/assets/studio";
import {
  assetSummary,
  done,
  exitOf,
  jobSummary,
  refuse,
  safeMessage,
  statusSummary,
} from "./format";

const source = { requestId: "r1", slotKey: "idle/south", ordinal: 2 };
const request = {
  schemaVersion: 1,
  subject: "zeus",
  kind: "sprite",
  slots: [{ state: "idle", direction: "south" }],
  batch: 1,
  seed: 42,
  styleNote: "a private style note",
} as const;
const provider = { id: "p", medium: "image", hosting: "local" } as const;
const hash = "a".repeat(64);

describe("exit codes", () => {
  test("success is 0, usage and config problems are 64, every other refusal is 1", () => {
    expect(exitOf(done({}))).toBe(0);
    for (const code of [
      "invalid-arguments",
      "unknown-op",
      "invalid-request",
      "missing-config",
      "invalid-config",
      "invalid-content",
    ])
      expect(exitOf(refuse(code, "x")), code).toBe(64);
    for (const code of [
      "busy",
      "not-running",
      "confirmation_required",
      "revision-mismatch",
      "generation-failed",
      "unsupported",
      "wrong-state",
      "not-found",
      "editor-unavailable",
      "write-failed",
      "internal",
    ])
      expect(exitOf(refuse(code, "x")), code).toBe(1);
  });
});

describe("safe messages", () => {
  test("keep the first line, drop a captured output tail and are bounded", () => {
    expect(
      safeMessage(
        "the server exited before it was ready (exit code 7). Output: secret tail\nmore",
      ),
    ).toBe("the server exited before it was ready (exit code 7).");
    expect(safeMessage("first line\nsecond line with detail")).toBe(
      "first line",
    );
    expect(safeMessage("x".repeat(500)).length).toBeLessThanOrEqual(200);
    expect(safeMessage("")).toBe("");
  });
});

describe("job summaries", () => {
  const queued: JobRecord = {
    schemaVersion: 1,
    source,
    job: { schemaVersion: 1, id: "j1", request, provider, status: "queued" },
  };

  test("name the job, its source and seed and nothing of the request's text", () => {
    const summary = jobSummary(queued);

    expect(summary).toEqual({
      id: "j1",
      status: "queued",
      requestId: "r1",
      slotKey: "idle/south",
      ordinal: 2,
      seed: 42,
    });
    expect(JSON.stringify(summary)).not.toContain("private style note");
  });

  test("a succeeded job lists output hashes and sizes, never engine settings or prompts", () => {
    const summary = jobSummary({
      schemaVersion: 1,
      source,
      job: {
        schemaVersion: 1,
        id: "j1",
        request,
        provider,
        status: "succeeded",
        outputs: [{ medium: "image", hash, width: 512, height: 640 }],
      },
      engine: {
        runtime: { name: "sd", version: "v" },
        runtimeBinarySha256: hash,
        model: { id: "m", sha256: hash },
        loras: [],
        encoder: null,
        vae: null,
        licences: [],
        settings: {
          prompt: "PRIVATE PROMPT TEXT",
          negative_prompt: "n",
          width: 512,
        },
      },
    } as unknown as JobRecord);

    expect(summary).toMatchObject({
      status: "succeeded",
      outputs: [{ hash, width: 512, height: 640 }],
    });
    const text = JSON.stringify(summary);
    expect(text).not.toContain("PRIVATE PROMPT TEXT");
    expect(text).not.toContain("settings");
    expect(text).not.toContain("engine");
  });

  test("a failed job carries a safe error, an unavailable one its reason and staging, a cancelled one who cancelled it", () => {
    const failed = jobSummary({
      schemaVersion: 1,
      source,
      job: {
        schemaVersion: 1,
        id: "j1",
        request,
        provider,
        status: "failed",
        error: "the server exited (exit code 7). Output: LEAKED TAIL",
      },
    });
    const unavailable = jobSummary({
      schemaVersion: 1,
      source,
      job: {
        schemaVersion: 1,
        id: "j1",
        request,
        provider,
        status: "unavailable",
        reason: "vae is missing",
        staging: "stage it",
      },
    });
    const cancelled = jobSummary({
      schemaVersion: 1,
      source,
      job: {
        schemaVersion: 1,
        id: "j1",
        request,
        provider,
        status: "cancelled",
        cancelledBy: "aborted",
      },
    });

    expect(failed).toMatchObject({
      status: "failed",
      error: "the server exited (exit code 7).",
    });
    expect(JSON.stringify(failed)).not.toContain("LEAKED");
    expect(unavailable).toMatchObject({
      status: "unavailable",
      reason: "vae is missing",
      staging: "stage it",
    });
    expect(cancelled).toMatchObject({
      status: "cancelled",
      cancelledBy: "aborted",
    });
  });
});

describe("asset summaries", () => {
  test("carry the review metadata an owner decides on and no manifest body", () => {
    const record = {
      schemaVersion: 1,
      id: "pack-1",
      workingSetId: "w",
      assetId: "zeus-sprite",
      prior: null,
      record: {
        state: "draft",
        manifest: {
          id: "zeus-sprite",
          styleTag: "SECRET STYLE",
          atlas: { blob: hash },
        },
        report: {
          schemaVersion: 1,
          status: "fail",
          checks: [
            {
              check: "idle/south#0:palette",
              status: "fail",
              message: "off palette",
            },
            { check: "idle/south#0:grid", status: "pass" },
          ],
        },
        edit: "idle",
        edits: [],
      },
      manifestRevision: hash,
      reportBasis: { atlasHash: hash, paletteDigest: hash },
      licenceReview: {
        manifestRevision: hash,
        entries: [
          {
            subject: "m",
            role: "model",
            source: "pinned-terms",
            status: "compatible",
            reason: "Apache-2.0 is MIT-compatible",
          },
        ],
      },
      licenceAssessments: [],
      published: null,
    } as unknown as StudioAssetRecord;

    const summary = assetSummary(record);

    expect(summary).toEqual({
      id: "pack-1",
      workingSetId: "w",
      assetId: "zeus-sprite",
      state: "draft",
      manifestRevision: hash,
      prior: null,
      published: null,
      report: { status: "fail", failedChecks: ["idle/south#0:palette"] },
      licences: [{ subject: "m", role: "model", status: "compatible" }],
    });
    expect(JSON.stringify(summary)).not.toContain("SECRET STYLE");
  });
});

describe("status summaries", () => {
  test("count records by kind and job status and list invalid files", () => {
    const summary = statusSummary(
      {
        session: { schemaVersion: 1, id: "s", pid: 42, startedAt: "t" },
        requests: [],
        jobs: [],
        candidates: [],
        workingSets: [],
        edits: [],
        assets: [],
        commands: [],
        invalid: [{ file: "jobs/bad.json", message: "bad" }],
      } as never,
      () => true,
    );

    expect(summary).toMatchObject({
      owner: { pid: 42, startedAt: "t", open: true },
      counts: {
        requests: 0,
        jobs: 0,
        candidates: 0,
        workingSets: 0,
        edits: 0,
        assets: 0,
      },
      invalid: [{ file: "jobs/bad.json" }],
    });
  });

  describe("the owner is open only while its process is alive and the session is not ended", () => {
    const ownerOf = (
      session: { endedAt?: string },
      isAlive: (pid: number) => boolean,
    ) =>
      (
        statusSummary(
          {
            session: {
              schemaVersion: 1,
              id: "s",
              pid: 42,
              startedAt: "t",
              ...session,
            },
            requests: [],
            jobs: [],
            candidates: [],
            workingSets: [],
            edits: [],
            assets: [],
            commands: [],
            invalid: [],
          } as never,
          isAlive,
        ) as { owner: { open: boolean } }
      ).owner;

    test("alive and not ended is open", () => {
      const asked: number[] = [];
      const owner = ownerOf({}, (pid) => {
        asked.push(pid);
        return true;
      });

      expect(owner.open).toBe(true);
      expect(asked).toEqual([42]);
    });

    test("dead and not ended (a crashed owner) is not open", () => {
      expect(ownerOf({}, () => false).open).toBe(false);
    });

    test("ended is not open, whether or not the pid is alive", () => {
      expect(ownerOf({ endedAt: "u" }, () => true).open).toBe(false);
      expect(ownerOf({ endedAt: "u" }, () => false).open).toBe(false);
    });
  });
});
