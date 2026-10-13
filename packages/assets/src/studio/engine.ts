// The interface every engine the runtime drives implements: the image engine (sd-server) and
// the render engine (Blender). The drain picks the engine from a job's provider; only one
// engine is ever live, so the drain stops the other before it launches this one.
//
// An engine settles the jobs it runs through the session; it never ends the drain itself.

import type { TeardownResult } from "./process";
import type { JobResult } from "./runtime";
import type { CommandResult } from "./session";
import type { JobRecord } from "./store";

/** The job in flight. Created by the drain (or by the engine for the next job of a batch). */
export interface Running {
  readonly id: string;
  readonly controller: AbortController;
  /** Set by the runtime when it cancels the job (abort or quit); the engine reports it as aborted. */
  aborted: boolean;
}

export type Ready =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: "unavailable";
      readonly reason: string;
    }
  | { readonly ok: false; readonly kind: "failed"; readonly error: string }
  | { readonly ok: false; readonly kind: "aborted" };

export type Attempt =
  | { readonly kind: "result"; readonly result: JobResult }
  | { readonly kind: "skipped" }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "session-closed" }
  /** The engine turned out unavailable while running; the job in flight is already marked. The drain marks the rest of its provider's queue. */
  | {
      readonly kind: "unavailable";
      readonly reason: string;
      /** The job that was in flight; it is still running until the drain marks it. */
      readonly jobId: string;
    };

/** A refused transition: a closed session or an unwritable record ends the drain; any other refusal means the job moved on. */
export function unsettled(
  refusal: Extract<CommandResult, { ok: false }>,
): Attempt {
  if (refusal.reason === "closed") return { kind: "session-closed" };
  if (refusal.reason === "write-failed")
    return { kind: "refused", message: refusal.message };
  return { kind: "skipped" };
}

export interface Engine {
  /** The id of the provider whose jobs this engine runs. */
  readonly provider: string;
  /** What the owner does about an unavailable engine. */
  readonly guidance: string;
  /** The jobs from the head of the queue this engine runs in one go; at least the first. */
  batchOf(queue: readonly JobRecord[]): readonly JobRecord[];
  /**
   * Verifies the engine's artifacts and, for a long-lived engine, brings it up. Runs under the
   * running job's abort controller: hashing and start-up stop when it fires.
   */
  ready(running: Running): Promise<Ready>;
  /**
   * Runs the batch. The first job is already running; `track` registers each later job as the
   * one in flight, so an abort addresses it. Returns one attempt per job it settled.
   */
  run(
    batch: readonly JobRecord[],
    running: Running,
    track: (jobId: string) => Running,
  ): Promise<readonly Attempt[]>;
  /** True while a child of this engine is owned. */
  live(): boolean;
  /** Stops the child's process group (TERM, then KILL) and waits until it is gone. */
  stop(): Promise<TeardownResult>;
}
