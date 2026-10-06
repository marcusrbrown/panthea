// The single-writer session host. One session owns an authoring root through
// an OS-held exclusive lock on a SQLite database: the operating system drops
// it when the process exits however it exits, so there is no stale lock to
// reclaim. A busy root is refused, never queued or forwarded to the owner.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import type { GenerationJob } from "@panthea/contracts";
import { type CommandType, openStore, type Store } from "./store";
import { STUDIO_SCHEMA_VERSION, studioPaths } from "./workspace";

export interface StudioSession {
  readonly id: string;
  readonly store: Store;
  /** Ids of queued or running jobs that the previous owner left behind. */
  readonly recovered: readonly string[];
  /** Accepted only once the ledger entry and the job record are durable. */
  enqueue(requestId: string, job: QueuedJob): CommandResult;
  /** Cancels a queued job. */
  remove(jobId: string): CommandResult;
  /** Cancels a running job. The owner of the runtime kills its child. */
  abort(jobId: string): CommandResult;
  close(): void;
}

export type QueuedJob = Extract<GenerationJob, { status: "queued" }>;

export type CommandFailure =
  | "closed"
  | "not-found"
  | "wrong-state"
  | "write-failed";
export type CommandResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: CommandFailure;
      readonly message: string;
    };

export type StudioOpen =
  | { readonly kind: "opened"; readonly session: StudioSession }
  | { readonly kind: "busy" };

const refused = (reason: CommandFailure, message: string): CommandResult => ({
  ok: false,
  reason,
  message,
});

function acquireLock(path: string): Database | undefined {
  const db = new Database(path, { create: true });
  try {
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    db.exec("COMMIT");
    return db;
  } catch (error) {
    db.close();
    if ((error as { code?: string }).code === "SQLITE_BUSY") return undefined;
    throw error;
  }
}

export function openStudioSession(root: string): StudioOpen {
  mkdirSync(root, { recursive: true });
  const lock = acquireLock(studioPaths(root).lock);
  if (!lock) return { kind: "busy" };

  try {
    const store = openStore(root);
    const recovered: string[] = [];
    for (const { requestId, job } of store.status().jobs) {
      if (job.status !== "queued" && job.status !== "running") continue;
      store.putJob({
        schemaVersion: STUDIO_SCHEMA_VERSION,
        requestId,
        job: {
          schemaVersion: job.schemaVersion,
          id: job.id,
          request: job.request,
          provider: job.provider,
          status: "failed",
          error: `interrupted: the session ended while the job was ${job.status}`,
        },
      });
      recovered.push(job.id);
    }

    const record = {
      schemaVersion: STUDIO_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      pid: process.pid,
      startedAt: new Date().toISOString(),
    } as const;
    store.putSession(record);

    let closed = false;
    const closedRefusal = () =>
      refused("closed", "the session is closed; open a new one");
    let lastSeq = store.lastCommandSeq();
    const ledgered = (
      type: CommandType,
      jobId: string,
      effect: () => void,
    ): CommandResult => {
      try {
        store.putCommand({
          schemaVersion: STUDIO_SCHEMA_VERSION,
          seq: lastSeq + 1,
          type,
          jobId,
          at: new Date().toISOString(),
        });
        lastSeq += 1;
        effect();
        return { ok: true };
      } catch (error) {
        return refused("write-failed", (error as Error).message);
      }
    };
    const cancel = (
      jobId: string,
      from: "queued" | "running",
      type: CommandType,
      cancelledBy: "removed" | "aborted",
    ): CommandResult => {
      if (closed) return closedRefusal();
      const read = store.readJob(jobId);
      if (read.kind === "missing")
        return refused("not-found", `no job ${jobId}`);
      if (read.kind === "invalid")
        return refused(
          "wrong-state",
          `job ${jobId} is invalid: ${read.message}`,
        );
      const { requestId, job } = read.value;
      if (job.status !== from)
        return refused(
          "wrong-state",
          `job ${jobId} is ${job.status}, not ${from}`,
        );
      return ledgered(type, jobId, () =>
        store.putJob({
          schemaVersion: STUDIO_SCHEMA_VERSION,
          requestId,
          job: {
            schemaVersion: job.schemaVersion,
            id: job.id,
            request: job.request,
            provider: job.provider,
            status: "cancelled",
            cancelledBy,
          },
        }),
      );
    };

    const closedWrite = <A extends unknown[], R>(write: (...args: A) => R) => {
      return (...args: A): R => {
        if (closed) throw new Error("the session is closed; open a new one");
        return write(...args);
      };
    };
    const guarded: Store = {
      ...store,
      putSession: closedWrite(store.putSession),
      putRequest: closedWrite(store.putRequest),
      putJob: closedWrite(store.putJob),
      putWorkspace: closedWrite(store.putWorkspace),
      putCommand: closedWrite(store.putCommand),
      putBlob: closedWrite(store.putBlob),
    };

    return {
      kind: "opened",
      session: {
        id: record.id,
        store: guarded,
        recovered,
        enqueue(requestId, job) {
          if (closed) return closedRefusal();
          const existing = store.readJob(job.id);
          if (existing.kind !== "missing")
            return refused("wrong-state", `job ${job.id} already exists`);
          return ledgered("enqueue", job.id, () =>
            store.putJob({
              schemaVersion: STUDIO_SCHEMA_VERSION,
              requestId,
              job,
            }),
          );
        },
        remove: (jobId) => cancel(jobId, "queued", "remove", "removed"),
        abort: (jobId) => cancel(jobId, "running", "abort", "aborted"),
        close() {
          if (closed) return;
          closed = true;
          try {
            store.putSession({ ...record, endedAt: new Date().toISOString() });
          } finally {
            lock.close();
          }
        },
      },
    };
  } catch (error) {
    lock.close();
    throw error;
  }
}
