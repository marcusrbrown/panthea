import { describe, expect, test } from "bun:test";
import type { StudioSnapshot } from "../host/types";
import { approvalArgsForAsset } from "./actions";
import {
  canRelease,
  initialWorkflowState,
  lockLabel,
  refusedByLock,
  resolveActiveRecord,
  workflowReducer,
} from "./model";

const snapshot = (
  jobs: readonly Record<string, unknown>[] = [],
  extra: Partial<StudioSnapshot> = {},
): StudioSnapshot => ({
  host: { state: "running" },
  status: { owner: null },
  requests: [],
  jobs: jobs as unknown as StudioSnapshot["jobs"],
  candidates: [],
  edits: [],
  workingSets: [],
  assets: [],
  ...extra,
});

describe("workflowReducer", () => {
  test("first snapshot rebuilds all sections and lock owner after reload", () => {
    const loaded = workflowReducer(initialWorkflowState(), {
      type: "snapshot",
      snapshot: snapshot([{ id: "j1", status: "queued" }], {
        host: { state: "read-only", lockHolder: 418 },
        status: { counts: { jobs: 1 }, conformSets: ["standard"] },
        requests: [{ id: "r1", subject: "zeus" }],
        candidates: [{ id: "c1", requestId: "r1" }],
        edits: [{ id: "e1", status: "open" }],
        workingSets: [{ id: "w1", requestId: "r1" }],
        assets: [{ id: "a1", state: "draft" }],
      }),
    });
    expect(loaded.requests).toHaveLength(1);
    expect(loaded.jobs).toHaveLength(1);
    expect(loaded.candidates).toHaveLength(1);
    expect(loaded.edits).toHaveLength(1);
    expect(loaded.workingSets).toHaveLength(1);
    expect(loaded.assets).toHaveLength(1);
    expect(loaded.lockOwner).toBe(418);
    expect(loaded.status?.conformSets).toEqual(["standard"]);
  });

  test("only a read-only host is another session's lock: this app's own lock, a free root and a restart are not", () => {
    for (const host of [
      { state: "running" },
      { state: "starting" },
      { state: "restarting", attempt: 1, maxAttempts: 3 },
      { state: "unavailable", attempt: 3, maxAttempts: 3 },
    ] as const) {
      const loaded = workflowReducer(initialWorkflowState(), {
        type: "snapshot",
        snapshot: snapshot([], {
          host,
          status: { owner: { pid: 6304, open: true } },
        }),
      });
      expect(loaded.lockOwner, host.state).toBeUndefined();
    }
  });

  test("the lock clears when the holder leaves", () => {
    const locked = workflowReducer(initialWorkflowState(), {
      type: "snapshot",
      snapshot: snapshot([], { host: { state: "read-only", lockHolder: 418 } }),
    });
    expect(locked.lockOwner).toBe(418);

    const freed = workflowReducer(locked, {
      type: "snapshot",
      snapshot: snapshot([], { host: { state: "running" } }),
    });
    expect(freed.lockOwner).toBeUndefined();
  });

  describe("the writer lock the app gives back when idle", () => {
    const held = (status: Record<string, unknown>, host: object = {}) =>
      workflowReducer(initialWorkflowState(), {
        type: "snapshot",
        snapshot: snapshot([], {
          host: { state: "running", lock: "held", ...host } as never,
          status,
        }),
      });

    test("the header has three states: held by this app, free, or held by pid N", () => {
      expect(lockLabel(held({ idle: true }))).toBe("Held by this app");
      expect(lockLabel(held({ idle: true }, { lock: "free" }))).toBe("Free");
      expect(
        lockLabel(
          held({}, { state: "read-only", lock: "other", lockHolder: 418 }),
        ),
      ).toBe("Held by pid 418");
    });

    test("no label before the sidecar has said, and none for a host that is not up", () => {
      expect(lockLabel(initialWorkflowState())).toBeUndefined();
      expect(
        lockLabel(
          held(
            {},
            {
              state: "restarting",
              lock: undefined,
              attempt: 1,
              maxAttempts: 3,
            },
          ),
        ),
      ).toBeUndefined();
      expect(lockLabel(held({}, { lock: undefined }))).toBeUndefined();
    });

    test("read-only is held by pid N even when the host did not send the lock word", () => {
      const loaded = workflowReducer(initialWorkflowState(), {
        type: "snapshot",
        snapshot: snapshot([], {
          host: { state: "read-only", lockHolder: 418 },
        }),
      });

      expect(lockLabel(loaded)).toBe("Held by pid 418");
    });

    test("release is offered only when this app holds the lock and the host says it is idle", () => {
      expect(canRelease(held({ idle: true }))).toBe(true);
      expect(
        canRelease(
          held({ idle: false, idleReason: "a job is queued or running" }),
        ),
      ).toBe(false);
      expect(canRelease(held({}))).toBe(false);
      expect(canRelease(held({ idle: "yes" }))).toBe(false);
      // Nothing to release when the lock is free or someone else's.
      expect(canRelease(held({ idle: true }, { lock: "free" }))).toBe(false);
      expect(
        canRelease(
          held(
            { idle: true },
            { state: "read-only", lock: "other", lockHolder: 9 },
          ),
        ),
      ).toBe(false);
      // A host that is not running, or no config.
      expect(
        canRelease(
          held(
            { idle: true },
            {
              state: "restarting",
              lock: undefined,
              attempt: 1,
              maxAttempts: 3,
            },
          ),
        ),
      ).toBe(false);
      expect(canRelease(initialWorkflowState())).toBe(false);
    });

    test("a release that failed and kept the lock can be tried again while idle", () => {
      const failed = held({
        idle: true,
        releaseFailure: "the runtime did not stop",
      });

      expect(canRelease(failed)).toBe(true);
      expect(failed.releaseFailure).toBe("the runtime did not stop");
      expect(held({ idle: true }).releaseFailure).toBeUndefined();
    });

    test("the host's reason for not being idle is kept for the button's hint", () => {
      const busy = held({ idle: false, idleReason: "an op is in flight" });

      expect(busy.idleReason).toBe("an op is in flight");
      expect(held({ idle: true, idleReason: null }).idleReason).toBeUndefined();
    });

    test("a write refused as root-locked keeps the form's resolution and remembers the write for Retry", () => {
      const resolved = workflowReducer(held({ idle: true }, { lock: "free" }), {
        type: "resolution",
        value: { spec: { subject: "zeus" } },
      });
      const args = { id: "zeus-1", subject: "zeus" };

      const refused = workflowReducer(resolved, {
        type: "write-locked",
        op: "generate",
        args,
      });

      expect(refused.resolution).toEqual({ spec: { subject: "zeus" } });
      expect(refused.lockedWrite).toEqual({ op: "generate", args });
      // A poll does not forget it, and does not clear the form either.
      const polled = workflowReducer(refused, {
        type: "snapshot",
        snapshot: snapshot([], {
          host: { state: "read-only", lockHolder: 4242, lock: "other" },
        }),
      });
      expect(polled.lockedWrite).toEqual({ op: "generate", args });
      expect(polled.resolution).toEqual({ spec: { subject: "zeus" } });

      expect(
        workflowReducer(polled, { type: "write-unlocked" }).lockedWrite,
      ).toBeUndefined();
    });

    test("only a refusal by the lock is a root-locked refusal", () => {
      expect(refusedByLock({ code: "root-locked", message: "x" })).toBe(true);
      expect(
        refusedByLock(Object.assign(new Error("x"), { code: "root-locked" })),
      ).toBe(true);
      for (const other of [
        { code: "busy" },
        { code: "not-idle" },
        new Error("root-locked"),
        "root-locked",
        null,
        undefined,
      ])
        expect(refusedByLock(other)).toBe(false);
    });
  });

  test("AE6 cancellation remains marked until the next queued job starts", () => {
    let state = workflowReducer(initialWorkflowState(), {
      type: "snapshot",
      snapshot: snapshot([
        { id: "j1", requestId: "r1", slotKey: "idle/south", status: "running" },
        { id: "j2", requestId: "r1", slotKey: "walk/south", status: "queued" },
        { id: "j3", requestId: "r1", slotKey: "hurt/south", status: "queued" },
      ]),
    });
    state = workflowReducer(state, { type: "job-removed", jobId: "j2" });
    state = workflowReducer(state, { type: "job-cancelled", jobId: "j1" });
    expect(state.jobs.map((job) => job.status)).toEqual([
      "cancelled",
      "removed",
      "queued",
    ]);
    expect(state.restartPending).toBe(true);
    state = workflowReducer(state, {
      type: "snapshot",
      snapshot: snapshot(
        [
          {
            id: "j1",
            requestId: "r1",
            slotKey: "idle/south",
            status: "cancelled",
          },
          {
            id: "j2",
            requestId: "r1",
            slotKey: "walk/south",
            status: "cancelled",
          },
          {
            id: "j3",
            requestId: "r1",
            slotKey: "hurt/south",
            status: "queued",
          },
        ],
        { host: { state: "running" } },
      ),
    });
    expect(state.jobs.map((job) => job.status)).toEqual([
      "cancelled",
      "removed",
      "queued",
    ]);
    expect(state.restartPending).toBe(true);
    state = workflowReducer(state, {
      type: "snapshot",
      snapshot: snapshot(
        [
          {
            id: "j1",
            requestId: "r1",
            slotKey: "idle/south",
            status: "cancelled",
          },
          {
            id: "j2",
            requestId: "r1",
            slotKey: "walk/south",
            status: "cancelled",
          },
          {
            id: "j3",
            requestId: "r1",
            slotKey: "hurt/south",
            status: "running",
          },
        ],
        { host: { state: "running" } },
      ),
    });
    expect(state.jobs[2]?.status).toBe("running");
    expect(state.restartPending).toBe(false);
  });

  test("late output cannot turn a cancelled job into a completed job", () => {
    let state = workflowReducer(initialWorkflowState(), {
      type: "snapshot",
      snapshot: snapshot([{ id: "j1", status: "running" }]),
    });
    state = workflowReducer(state, { type: "job-cancelled", jobId: "j1" });
    state = workflowReducer(state, {
      type: "snapshot",
      snapshot: snapshot([{ id: "j1", status: "succeeded", outputs: [{}] }]),
    });
    expect(state.jobs[0]?.status).toBe("cancelled");
  });

  test("staging and failed are distinct queue dispositions", () => {
    const state = workflowReducer(initialWorkflowState(), {
      type: "snapshot",
      snapshot: snapshot([
        { id: "j1", status: "unavailable", staging: "z-image.safetensors" },
        { id: "j2", status: "failed", error: "engine stopped" },
      ]),
    });
    expect(state.jobs.map((job) => [job.status, job.reason])).toEqual([
      ["unavailable", "z-image.safetensors"],
      ["failed", "engine stopped"],
    ]);
  });

  test("empty queue is an explicit state", () => {
    const state = workflowReducer(initialWorkflowState(), {
      type: "snapshot",
      snapshot: snapshot(),
    });
    expect(state.jobs).toEqual([]);
    expect(state.host.state).toBe("running");
  });

  test("an edit report command result is stored by edit id", () => {
    const initial = initialWorkflowState();
    const report = {
      editId: "e1",
      workingSetId: "w1",
      state: "open",
      sheetHash: "a".repeat(64),
      metadataHash: "b".repeat(64),
      slots: [],
    } as const;
    const state = workflowReducer(initial, {
      type: "edit-report",
      report,
    });
    expect(state.editReports.e1).toEqual(report);
  });

  test("a refused abort restores a running job", () => {
    let state = workflowReducer(initialWorkflowState(), {
      type: "snapshot",
      snapshot: snapshot([{ id: "j1", status: "running" }]),
    });
    state = workflowReducer(state, { type: "job-aborting", jobId: "j1" });
    state = workflowReducer(state, { type: "job-abort-failed", jobId: "j1" });
    expect(state.jobs[0]?.status).toBe("running");
  });

  test("a needs-scale conform result attaches to its succeeded job", () => {
    const state = workflowReducer(
      workflowReducer(initialWorkflowState(), {
        type: "snapshot",
        snapshot: snapshot([
          { id: "j1", status: "succeeded", candidate: null },
        ]),
      }),
      {
        type: "candidate-conformed",
        candidate: {
          status: "needs-scale",
          id: "j1",
          requestId: "r1",
          slotKey: "idle/south",
          ordinal: 0,
          input: { hash: "a".repeat(64), width: 64, height: 80 },
          message: "Choose scale.",
          report: null,
          scale: null,
          coloursMerged: null,
          pixelsChanged: null,
        },
      },
    );
    expect(state.candidates[0]?.status).toBe("needs-scale");
    expect(state.jobs[0]?.raw.candidate).toBe("needs-scale");
  });
});

describe("resolveActiveRecord", () => {
  const record = (id: string) => ({
    id,
    assetId: "zeus-sprite",
    state: "draft",
    manifestRevision: `rev-${id}`,
  });
  const one = [record("record-zeus-sprite-1")];
  const two = [record("record-zeus-sprite-1"), record("record-zeus-sprite-2")];

  test("a selected id that is in the snapshot is the active record", () => {
    const active = resolveActiveRecord(two, "record-zeus-sprite-2");

    expect(active).toMatchObject({ kind: "record" });
    if (active.kind !== "record") throw new Error("expected a record");
    expect(active.asset.id).toBe("record-zeus-sprite-2");
    expect(approvalArgsForAsset(active.asset)).toEqual({
      id: "record-zeus-sprite-2",
      confirm: "rev-record-zeus-sprite-2",
    });
  });

  test("a selected id that has not arrived is pending, never another record", () => {
    expect(resolveActiveRecord(one, "record-zeus-sprite-2")).toEqual({
      kind: "pending",
      id: "record-zeus-sprite-2",
    });
    expect(resolveActiveRecord([], "record-zeus-sprite-2")).toEqual({
      kind: "pending",
      id: "record-zeus-sprite-2",
    });
  });

  test("a selected record that leaves the snapshot does not hand its place to another", () => {
    expect(resolveActiveRecord(two, "record-zeus-sprite-1").kind).toBe(
      "record",
    );
    expect(
      resolveActiveRecord(
        [record("record-zeus-sprite-2")],
        "record-zeus-sprite-1",
      ),
    ).toEqual({ kind: "pending", id: "record-zeus-sprite-1" });
  });

  test("with nothing selected the first record is shown, and with no records there is none", () => {
    const active = resolveActiveRecord(two, undefined);
    expect(active.kind === "record" && active.asset.id).toBe(
      "record-zeus-sprite-1",
    );
    expect(resolveActiveRecord([], undefined)).toEqual({ kind: "none" });
  });
});
