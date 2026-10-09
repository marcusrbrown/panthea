import { describe, expect, test } from "bun:test";
import type { StudioSnapshot } from "../host/types";
import { initialWorkflowState, workflowReducer } from "./model";

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
        status: { counts: { jobs: 1 } },
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

  test("AE6 cancellation then restart preserves the remaining queue order", () => {
    let state = workflowReducer(initialWorkflowState(), {
      type: "snapshot",
      snapshot: snapshot([
        { id: "j1", requestId: "r1", slotKey: "idle/south", status: "running" },
        { id: "j2", requestId: "r1", slotKey: "walk/south", status: "queued" },
        { id: "j3", requestId: "r1", slotKey: "hurt/south", status: "queued" },
      ]),
    });
    state = workflowReducer(state, { type: "job-aborting", jobId: "j1" });
    state = workflowReducer(state, { type: "job-removed", jobId: "j2" });
    state = workflowReducer(state, { type: "job-cancelled", jobId: "j1" });
    expect(state.jobs.map((job) => job.status)).toEqual([
      "cancelled",
      "removed",
      "queued",
    ]);
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
        { host: { state: "restarting", attempt: 1, maxAttempts: 3 } },
      ),
    });
    expect(state.jobs.map((job) => job.status)).toEqual([
      "cancelled",
      "removed",
      "running",
    ]);
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
});
