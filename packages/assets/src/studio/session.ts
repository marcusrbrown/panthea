// The single-writer session host. One session owns an authoring root through
// an OS-held exclusive lock on a SQLite database: the operating system drops
// it when the process exits however it exits, so there is no stale lock to
// reclaim. A busy root is refused, never queued or forwarded to the owner.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import type { GenerationJob, JobOutput } from "@panthea/contracts";
import { planJobs } from "./request";
import {
  type CommandType,
  type JobRecord,
  type JobSource,
  openStore,
  type RequestRecord,
  type Store,
} from "./store";
import { STUDIO_SCHEMA_VERSION, studioPaths } from "./workspace";

export interface StudioSession {
  readonly id: string;
  readonly store: Store;
  /** Ids of queued or running jobs that the previous owner left behind. */
  readonly recovered: readonly string[];
  /** Accepted only once the ledger entry and the job record are durable. */
  enqueue(source: JobSource, job: QueuedJob): CommandResult;
  /** Cancels a queued job. */
  submitRequest(record: RequestRecord): ExpandResult;
  reroll(requestId: string, perSlot: number): ExpandResult;
  /** Queued jobs in durable enqueue order. */
  queued(): QueuedResult;
  start(jobId: string): CommandResult;
  succeed(jobId: string, outputs: readonly JobOutput[]): CommandResult;
  fail(jobId: string, error: string): CommandResult;
  unavailable(jobId: string, reason: string, staging: string): CommandResult;
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

export type QueuedResult =
  | { readonly ok: true; readonly jobs: readonly JobRecord[] }
  | {
      readonly ok: false;
      readonly reason: "closed";
      readonly message: string;
    };

export type ExpandFailure =
  | CommandFailure
  | "invalid-request"
  | "seed-overflow";

export type ExpandResult =
  | { readonly ok: true; readonly jobIds: readonly string[] }
  | {
      readonly ok: false;
      readonly reason: ExpandFailure;
      readonly message: string;
      readonly enqueued: readonly string[];
    };

export type StudioOpen =
  | { readonly kind: "opened"; readonly session: StudioSession }
  | { readonly kind: "busy" };

const refused = <R extends string>(reason: R, message: string) =>
  ({ ok: false, reason, message }) as const;

const CLOSED = "the session is closed; open a new one";

const expandRefusal = (
  reason: ExpandFailure,
  message: string,
): ExpandResult => ({ ok: false, reason, message, enqueued: [] });

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
    for (const { source, job } of store.status().jobs) {
      if (job.status !== "queued" && job.status !== "running") continue;
      store.putJob({
        schemaVersion: STUDIO_SCHEMA_VERSION,
        source,
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
    const closedRefusal = () => refused("closed", CLOSED);
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
    const jobBase = (job: GenerationJob) => ({
      schemaVersion: job.schemaVersion,
      id: job.id,
      request: job.request,
      provider: job.provider,
    });
    const transition = (
      jobId: string,
      type: CommandType,
      from: readonly GenerationJob["status"][],
      next: (job: GenerationJob) => GenerationJob,
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
      const { source, job } = read.value;
      if (!from.includes(job.status))
        return refused(
          "wrong-state",
          `job ${jobId} is ${job.status}, not ${from.join(" or ")}`,
        );
      return ledgered(type, jobId, () =>
        store.putJob({
          schemaVersion: STUDIO_SCHEMA_VERSION,
          source,
          job: next(job),
        }),
      );
    };

    const enqueue = (source: JobSource, job: QueuedJob): CommandResult => {
      if (closed) return closedRefusal();
      const existing = store.readJob(job.id);
      if (existing.kind !== "missing")
        return refused("wrong-state", `job ${job.id} already exists`);
      return ledgered("enqueue", job.id, () =>
        store.putJob({ schemaVersion: STUDIO_SCHEMA_VERSION, source, job }),
      );
    };

    // The advanced ordinal is durable before any job is enqueued, so a retry
    // or a reroll never reuses an ordinal or a seed.
    const expand = (record: RequestRecord, perSlot: number): ExpandResult => {
      const plan = planJobs(record, perSlot);
      if (!plan.ok)
        return expandRefusal(
          plan.error.kind === "seed-overflow"
            ? "seed-overflow"
            : "invalid-request",
          JSON.stringify(plan.error),
        );
      try {
        store.putRequest({ ...record, nextOrdinal: plan.value.nextOrdinal });
      } catch (error) {
        return expandRefusal("write-failed", (error as Error).message);
      }
      const enqueued: string[] = [];
      for (const { source, job } of plan.value.jobs) {
        const result = enqueue(source, job);
        if (!result.ok) return { ...result, enqueued };
        enqueued.push(job.id);
      }
      return { ok: true, jobIds: enqueued };
    };

    const closedWrite = <A extends unknown[], R>(write: (...args: A) => R) => {
      return (...args: A): R => {
        if (closed) throw new Error(CLOSED);
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
        enqueue,
        submitRequest(record) {
          if (closed) return expandRefusal("closed", CLOSED);
          if (store.readRequest(record.id).kind !== "missing")
            return expandRefusal(
              "wrong-state",
              `request ${record.id} already exists`,
            );
          return expand(record, record.request.batch);
        },
        reroll(requestId, perSlot) {
          if (closed) return expandRefusal("closed", CLOSED);
          const read = store.readRequest(requestId);
          if (read.kind === "missing")
            return expandRefusal("not-found", `no request ${requestId}`);
          if (read.kind === "invalid")
            return expandRefusal(
              "wrong-state",
              `request ${requestId} is invalid: ${read.message}`,
            );
          return expand(read.value, perSlot);
        },
        queued() {
          if (closed) return { ok: false, reason: "closed", message: CLOSED };
          const { commands, jobs } = store.status();
          const byId = new Map(jobs.map((record) => [record.job.id, record]));
          return {
            ok: true,
            jobs: commands.flatMap((command) => {
              const record = byId.get(command.jobId);
              return command.type === "enqueue" &&
                record?.job.status === "queued"
                ? [record]
                : [];
            }),
          };
        },
        start: (jobId) =>
          transition(jobId, "start", ["queued"], (job) => ({
            ...jobBase(job),
            status: "running",
          })),
        succeed: (jobId, outputs) =>
          transition(jobId, "succeed", ["running"], (job) => ({
            ...jobBase(job),
            status: "succeeded",
            outputs,
          })),
        fail: (jobId, error) =>
          transition(jobId, "fail", ["running"], (job) => ({
            ...jobBase(job),
            status: "failed",
            error,
          })),
        unavailable: (jobId, reason, staging) =>
          transition(jobId, "unavailable", ["queued", "running"], (job) => ({
            ...jobBase(job),
            status: "unavailable",
            reason,
            staging,
          })),
        remove: (jobId) =>
          transition(jobId, "remove", ["queued"], (job) => ({
            ...jobBase(job),
            status: "cancelled",
            cancelledBy: "removed",
          })),
        abort: (jobId) =>
          transition(jobId, "abort", ["running"], (job) => ({
            ...jobBase(job),
            status: "cancelled",
            cancelledBy: "aborted",
          })),
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
