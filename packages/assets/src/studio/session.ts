// The single-writer session host. One session owns an authoring root through
// an OS-held exclusive lock on a SQLite database: the operating system drops
// it when the process exits however it exits, so there is no stale lock to
// reclaim. A busy root is refused, never queued or forwarded to the owner.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import type { GenerationJob, JobOutput, Sha256 } from "@panthea/contracts";
import { parseSlug } from "@panthea/contracts";
import type { PaletteSet } from "../palette";
import type { RenderAuditConfig } from "../render/audit";
import {
  buildRenderedCandidate,
  type RenderedCandidate,
} from "../render/candidate";
import {
  type CandidateRecord,
  type ConformParams,
  conformCandidate,
} from "./candidates";
import {
  createDeriveOps,
  type DeriveInput,
  type DeriveResult,
} from "./derivation";
import {
  createEditOps,
  type EditCommandResult,
  type EditResult,
} from "./edit-session";
import type { EffectInput } from "./effect";
import type { FinishStep } from "./export-import";
import type { PackInput } from "./packing";
import {
  type ApproveOptions,
  type AssetOpResult,
  createAssetOps,
  currentRevision,
} from "./publish";
import { planJobs, type StudioContent } from "./request";
import {
  type CommandType,
  type JobRecord,
  type JobSource,
  openStore,
  type Read,
  type RequestRecord,
  type Store,
} from "./store";
import {
  newWorkingSet,
  pickKeyframe,
  pickRendered,
  replaceSheetOf,
} from "./working-set";
import {
  type EngineFacts,
  parseEngineFacts,
  STUDIO_SCHEMA_VERSION,
  studioPaths,
} from "./workspace";

export interface StudioSession {
  readonly id: string;
  readonly store: Store;
  /** Ids of queued or running jobs that the previous owner left behind. */
  readonly recovered: readonly string[];
  /** Accepted only once the ledger entry and the job record are durable. */
  enqueue(source: JobSource, job: QueuedJob): CommandResult;
  /** Cancels a queued job. */
  submitRequest(record: RequestRecord): ExpandResult;
  /** Another `perSlot` jobs for every slot of the request, or only for `slotKey` when given. */
  reroll(requestId: string, perSlot: number, slotKey?: string): ExpandResult;
  /** Queued jobs in durable enqueue order. */
  queued(): QueuedResult;
  start(jobId: string): CommandResult;
  succeed(
    jobId: string,
    outputs: readonly JobOutput[],
    engine: EngineFacts,
  ): CommandResult;
  fail(jobId: string, error: string): CommandResult;
  unavailable(jobId: string, reason: string, staging: string): CommandResult;
  /** Conforms a succeeded job's original image into a candidate; the original bytes are never rewritten. */
  conform(
    jobId: string,
    content: StudioContent,
    params: ConformParams,
  ): ConformResult;
  /**
   * Reads a succeeded render job back through its role manifest into a rendered candidate: every
   * cell measured report-only against the asset's palette limits and the declared pivot. Needs
   * no conformance parameters: a render's cells are already native.
   */
  conformRendered(jobId: string, content: StudioContent): RenderedConformResult;
  openWorkingSet(
    id: string,
    requestId: string,
    content: StudioContent,
  ): CommandResult;
  replaceSheet(workingSetId: string, requestId: string): CommandResult;
  /** Keeps a snapshot of a done candidate for its slot; ledgered. */
  /** `slot` defaults to the candidate's own; only a portrait set accepts another. */
  pick(workingSetId: string, candidateId: string, slot?: string): CommandResult;
  /**
   * Opens a sheet of the slots' frames for the owner to edit. Refused when a
   * slot has nothing to start from or is already in an open edit.
   */
  openEdit(
    id: string,
    workingSetId: string,
    slots: readonly string[],
    content: StudioContent,
  ): EditCommandResult;
  /** Validates an exported sheet and its metadata in full, then stores them and a preview; changes no working set. */
  importEdit(
    id: string,
    png: Uint8Array,
    json: string,
    content: StudioContent,
  ): EditResult;
  /**
   * Imports the final sheet and puts its frames into the working set with one edit step each: a hand edit unless
   * `step` says the sheet was made by a script, which then must say what ran.
   */
  finishEdit(
    id: string,
    png: Uint8Array,
    json: string,
    content: StudioContent,
    step?: FinishStep,
    reviewed?: Sha256,
  ): EditResult;
  /** Ends an edit and leaves the working set exactly as it was. */
  discardEdit(id: string): EditCommandResult;
  /**
   * Reads a published revision and writes a working set of derived slots (a
   * mirror, a bob, or a palette swap into a realm variant). The same inputs
   * return the set they made before. Nothing is packed or approved.
   */
  derive(
    input: DeriveInput,
    content: StudioContent,
    registryRoot: string,
  ): DeriveResult;
  /**
   * Packs a complete working set into a draft asset record; never approves.
   * Like approve and publish, it takes the palettes as they are on disk now.
   */
  pack(
    input: PackInput,
    content: StudioContent,
    palettes: PaletteSet,
    registryRoot: string,
  ): AssetOpResult;
  /**
   * Runs the effect generator into a draft effect asset record; never approves.
   * Takes the palettes as they are on disk now, like `pack`.
   */
  effect(
    input: EffectInput,
    content: StudioContent,
    palettes: PaletteSet,
  ): AssetOpResult;
  /** The separate, explicit approval of a draft's exact manifest and atlas. */
  approveAsset(
    id: string,
    options: ApproveOptions,
    content: StudioContent,
    palettes: PaletteSet,
  ): AssetOpResult;
  /** Publishes an approved asset through the registry; every gate runs before canon is written. */
  publishAsset(
    id: string,
    content: StudioContent,
    palettes: PaletteSet,
    registryRoot: string,
    /** Where the committed `tools/render` is, which a rendered asset's render audit needs. */
    render?: RenderAuditConfig,
  ): AssetOpResult;
  /** Rejects an idle draft; the record keeps its manifest, and a rejected asset is never approved or published. */
  rejectAsset(id: string, reason?: string): AssetOpResult;
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
  | "invalid-params"
  | "write-failed";

export type ConformFailure =
  | "closed"
  | "not-found"
  | "wrong-state"
  | "write-failed"
  | "invalid-params"
  | "unsupported-png"
  | "corrupt-png";

export type RenderedConformResult =
  | { readonly ok: true; readonly candidate: RenderedCandidate }
  | {
      readonly ok: false;
      readonly reason: ConformFailure;
      readonly message: string;
    };

export type ConformResult =
  | { readonly ok: true; readonly candidate: CandidateRecord }
  | {
      readonly ok: false;
      readonly reason: ConformFailure;
      readonly message: string;
    };
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
      engine?: EngineFacts,
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
          ...(engine === undefined ? {} : { engine }),
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
    const expand = (
      record: RequestRecord,
      perSlot: number,
      onlySlotKey?: string,
    ): ExpandResult => {
      const plan = planJobs(record, perSlot, onlySlotKey);
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

    const writeRecord = (write: () => void): CommandResult => {
      try {
        write();
        return { ok: true };
      } catch (error) {
        return refused("write-failed", (error as Error).message);
      }
    };
    const lookup = <T>(
      kind: string,
      id: string,
      read: (id: string) => Read<T>,
    ): { ok: true; record: T } | { ok: false; refusal: CommandResult } => {
      if (!parseSlug(id, kind).ok)
        return { ok: false, refusal: refused("not-found", `no ${kind} ${id}`) };
      const found = read(id);
      if (found.kind === "missing")
        return { ok: false, refusal: refused("not-found", `no ${kind} ${id}`) };
      if (found.kind === "invalid")
        return {
          ok: false,
          refusal: refused(
            "wrong-state",
            `${kind} ${id} is invalid: ${found.message}`,
          ),
        };
      return { ok: true, record: found.value };
    };
    const conformRefusal = (refusal: CommandResult): ConformResult =>
      refusal.ok
        ? refused("wrong-state", "unreachable")
        : { ok: false, reason: refusal.reason, message: refusal.message };
    const renderedRefusal = (refusal: CommandResult): RenderedConformResult =>
      refusal.ok
        ? refused("wrong-state", "unreachable")
        : { ok: false, reason: refusal.reason, message: refusal.message };
    const readRequestOrRefuse = (id: string) =>
      lookup("request", id, store.readRequest);
    const readSetOrRefuse = (id: string) =>
      lookup("working set", id, store.readWorkingSet);
    const readCandidateOrRefuse = (id: string) =>
      lookup("candidate", id, store.readCandidate);

    const editOps = createEditOps({
      store,
      isClosed: () => closed,
      ledgered,
      write: writeRecord,
      hasLedgered: (type, id) =>
        store.status().commands.some((c) => c.type === type && c.jobId === id),
    });
    const assetOps = createAssetOps({
      store,
      isClosed: () => closed,
      ledgered,
      write: writeRecord,
      hasLedgered: (type, id) =>
        store.status().commands.some((c) => c.type === type && c.jobId === id),
    });
    const deriveOps = createDeriveOps(
      {
        store,
        isClosed: () => closed,
        ledgered,
        write: writeRecord,
        hasLedgered: (type, id) =>
          store
            .status()
            .commands.some((c) => c.type === type && c.jobId === id),
      },
      currentRevision,
    );
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
      putCandidate: closedWrite(store.putCandidate),
      putRenderedCandidate: closedWrite(store.putRenderedCandidate),
      putWorkingSet: closedWrite(store.putWorkingSet),
      putEdit: closedWrite(store.putEdit),
      putAsset: closedWrite(store.putAsset),
      putEditFile: closedWrite(store.putEditFile),
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
        reroll(requestId, perSlot, onlySlotKey) {
          if (closed) return expandRefusal("closed", CLOSED);
          const read = store.readRequest(requestId);
          if (read.kind === "missing")
            return expandRefusal("not-found", `no request ${requestId}`);
          if (read.kind === "invalid")
            return expandRefusal(
              "wrong-state",
              `request ${requestId} is invalid: ${read.message}`,
            );
          return expand(read.value, perSlot, onlySlotKey);
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
        succeed(jobId, outputs, engine) {
          if (closed) return closedRefusal();
          const facts = parseEngineFacts(engine, "engine");
          if (!facts.ok)
            return refused("invalid-params", `${facts.path}: ${facts.message}`);
          return transition(
            jobId,
            "succeed",
            ["running"],
            (job) => ({ ...jobBase(job), status: "succeeded", outputs }),
            facts.value,
          );
        },
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
        conform(jobId, content, params) {
          if (closed) return { ok: false, reason: "closed", message: CLOSED };
          const job = lookup("job", jobId, store.readJob);
          if (!job.ok) return conformRefusal(job.refusal);
          const request = lookup(
            "request",
            job.record.source.requestId,
            store.readRequest,
          );
          if (!request.ok) return conformRefusal(request.refusal);
          const output =
            job.record.job.status === "succeeded"
              ? job.record.job.outputs[0]
              : undefined;
          const outcome = conformCandidate({
            job: job.record,
            request: request.record,
            original: output && store.readBlob(output.hash),
            content,
            params,
          });
          if (!outcome.ok) return outcome;
          try {
            for (const blob of outcome.blobs) store.putBlob(blob);
            store.putCandidate(outcome.candidate);
          } catch (error) {
            return refused("write-failed", (error as Error).message);
          }
          return { ok: true, candidate: outcome.candidate };
        },
        conformRendered(jobId, content) {
          if (closed) return { ok: false, reason: "closed", message: CLOSED };
          const job = lookup("job", jobId, store.readJob);
          if (!job.ok) return renderedRefusal(job.refusal);
          const request = lookup(
            "request",
            job.record.source.requestId,
            store.readRequest,
          );
          if (!request.ok) return renderedRefusal(request.refusal);
          const built = buildRenderedCandidate({
            job: job.record,
            request: request.record,
            content,
            readBlob: (hash) => store.readBlob(hash),
          });
          if (!built.ok)
            return { ok: false, reason: "wrong-state", message: built.message };
          try {
            store.putRenderedCandidate(built.candidate);
          } catch (error) {
            return refused("write-failed", (error as Error).message);
          }
          return { ok: true, candidate: built.candidate };
        },
        openWorkingSet(id, requestId, content) {
          if (closed) return closedRefusal();
          if (!parseSlug(id, "id").ok)
            return refused(
              "invalid-params",
              "a working set id is a lowercase hyphenated name",
            );
          if (store.readWorkingSet(id).kind !== "missing")
            return refused("wrong-state", `working set ${id} already exists`);
          const request = readRequestOrRefuse(requestId);
          if (!request.ok) return request.refusal;
          const made = newWorkingSet(id, request.record, content);
          if (!made.ok) return refused(made.reason, made.message);
          return writeRecord(() => store.putWorkingSet(made.record));
        },
        replaceSheet(workingSetId, requestId) {
          if (closed) return closedRefusal();
          const set = readSetOrRefuse(workingSetId);
          if (!set.ok) return set.refusal;
          const request = readRequestOrRefuse(requestId);
          if (!request.ok) return request.refusal;
          const next = replaceSheetOf(set.record, request.record);
          if (!next.ok) return refused(next.reason, next.message);
          return writeRecord(() => store.putWorkingSet(next.record));
        },
        pick(workingSetId, candidateId, slot) {
          if (closed) return closedRefusal();
          const set = readSetOrRefuse(workingSetId);
          if (!set.ok) return set.refusal;
          const rendered = store.readRenderedCandidate(candidateId);
          if (rendered.kind === "found") {
            if (slot !== undefined && slot !== rendered.value.slotKey)
              return refused(
                "wrong-state",
                `candidate ${candidateId} was rendered for ${rendered.value.slotKey}; a sprite slot only takes a candidate drawn for it, not ${slot}`,
              );
            const next = pickRendered(set.record, rendered.value);
            if (!next.ok) return refused(next.reason, next.message);
            return ledgered("pick", candidateId, () =>
              store.putWorkingSet(next.record),
            );
          }
          const candidate = readCandidateOrRefuse(candidateId);
          if (!candidate.ok) return candidate.refusal;
          const next = pickKeyframe(set.record, candidate.record, slot);
          if (!next.ok) return refused(next.reason, next.message);
          return ledgered("pick", candidateId, () =>
            store.putWorkingSet(next.record),
          );
        },
        openEdit: editOps.openEdit,
        importEdit: editOps.importEdit,
        finishEdit: editOps.finishEdit,
        discardEdit: editOps.discardEdit,
        derive: deriveOps.derive,
        pack: assetOps.pack,
        effect: assetOps.effect,
        approveAsset: assetOps.approveAsset,
        publishAsset: assetOps.publishAsset,
        rejectAsset: assetOps.rejectAsset,
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
