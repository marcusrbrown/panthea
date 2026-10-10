// One dispatcher for every verb: the one-shot CLI and the session host both
// call `execute`, so a command means the same thing in either. Every handler
// calls the SDK; nothing here keeps a private pipeline or its own state.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ApproveOptions,
  type AssetOpResult,
  type CandidateFrames,
  type CommandResult,
  candidateFrames,
  type EditRecord,
  type EditResult,
  editReport,
  type FinishStep,
  isPreviewSlug,
  isPreviewSourceKind,
  newRequestRecord,
  type PackInput,
  parsePreviewResolve,
  type RequestInput,
  resolveEdit,
  type StudioAssetRecord,
  type StudioContent,
  type StudioSession,
  sheet,
  slotConformance,
  summarizeSheet,
} from "@panthea/assets/studio";
import { parseConformParams } from "./config";
import {
  assetSummary,
  type CandidateKinds,
  candidateSummary,
  done,
  editSummary,
  type Json,
  jobSummary,
  type Outcome,
  refuse,
  requestSummary,
  safeMessage,
  setSummary,
  statusSummary,
} from "./format";
import { isOutcome, type Studio } from "./host";

/** The sheet-hash type the SDK takes, without a second dependency for one alias. */
type Sha256 = NonNullable<
  Parameters<import("@panthea/assets/studio").StudioSession["finishEdit"]>[5]
>;

type Kind = "string" | "int" | "number" | "json";
export type Spec = Record<string, { t: Kind; req?: true }>;
type Args = Record<string, unknown>;

interface OpDef {
  readonly spec: Spec;
  /** The one argument a bare word on the command line fills. */
  readonly positional?: string;
  readonly run: (studio: Studio, args: Args) => Promise<Outcome> | Outcome;
}

const str = (name: string, req = false): Spec => ({
  [name]: { t: "string", ...(req ? { req: true as const } : {}) },
});

/**
 * A table's own entry for a key, never an inherited one: `toString`,
 * `constructor` and `__proto__` are not commands or arguments.
 */
export function own<T>(
  table: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Checks an op's arguments against its spec: every key known, every type exact, required keys present. */
export function readArgs(args: unknown, spec: Spec): Args | Outcome {
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return refuse("invalid-arguments", "arguments must be an object");
  const found = args as Args;
  for (const [key, value] of Object.entries(found)) {
    const field = own(spec, key);
    if (field === undefined)
      return refuse("invalid-arguments", `unknown argument "${key}"`);
    const okType =
      field.t === "string"
        ? typeof value === "string" && value !== ""
        : field.t === "int"
          ? typeof value === "number" && Number.isInteger(value) && value >= 0
          : field.t === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : value !== undefined;
    if (!okType)
      return refuse(
        "invalid-arguments",
        `argument "${key}" must be a ${field.t === "int" ? "whole number" : field.t === "number" ? "number" : field.t === "string" ? "non-empty string" : "JSON value"}`,
      );
  }
  for (const [key, field] of Object.entries(spec))
    if (field.req && !Object.hasOwn(found, key))
      return refuse("invalid-arguments", `argument "${key}" is required`);
  return found;
}

const fromCommand = (
  result: CommandResult | EditResult | AssetOpResult,
): Outcome | undefined =>
  result.ok ? undefined : refuse(result.reason, safeMessage(result.message));

const j = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

function parseSlots(value: unknown): RequestInput["slots"] | Outcome {
  if (!Array.isArray(value) || value.length === 0)
    return refuse("invalid-arguments", "slots must be a non-empty array");
  const allowed = ["state", "direction", "ability", "expression"];
  for (const slot of value)
    if (
      typeof slot !== "object" ||
      slot === null ||
      Object.entries(slot).some(
        ([k, v]) => !allowed.includes(k) || typeof v !== "string",
      )
    )
      return refuse(
        "invalid-arguments",
        "each slot is an object of state, direction, ability or expression strings",
      );
  return value as RequestInput["slots"];
}

function strictObject(
  value: unknown,
  name: string,
  keys: readonly string[],
): Record<string, unknown> | Outcome {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return refuse("invalid-arguments", `${name} must be an object`);
  const extra = Object.keys(value).find((k) => !keys.includes(k));
  return extra === undefined
    ? (value as Record<string, unknown>)
    : refuse("invalid-arguments", `${name} has an unknown key "${extra}"`);
}

const EDIT_COMMON = ["editMask", "editStrength", "editCue"] as const;
const EDIT_JOB_BASE = ["editBaseJob", "editBaseOutput"] as const;
const EDIT_HAND_BASE = ["editBaseImage", "editBaseDescription"] as const;

type Edit = NonNullable<RequestInput["edit"]>;
type EditArgs = {
  readonly request: Edit;
  /** Files read for the edit, by hash; stored only once the whole edit is valid. */
  readonly blobs: ReadonlyMap<string, Uint8Array>;
};

const hashOf = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * The masked-edit flags: the mask, strength and cue, and exactly one base: a
 * job's output (`--edit-base-job` with `--edit-base-output`) or a hand-authored
 * image (`--edit-base-image` with `--edit-base-description`). Files are read
 * from their paths and named by their hashes.
 */
function readEditArgs(a: Args): EditArgs | undefined | Outcome {
  const given = (keys: readonly string[]) =>
    keys.filter((key) => a[key] !== undefined).length;
  const all = (keys: readonly string[]) => given(keys) === keys.length;
  if (given([...EDIT_COMMON, ...EDIT_JOB_BASE, ...EDIT_HAND_BASE]) === 0)
    return undefined;
  const jobBase = given(EDIT_JOB_BASE) > 0;
  const handBase = given(EDIT_HAND_BASE) > 0;
  if (
    !all(EDIT_COMMON) ||
    jobBase === handBase ||
    (jobBase && !all(EDIT_JOB_BASE)) ||
    (handBase && !all(EDIT_HAND_BASE))
  )
    return refuse(
      "invalid-arguments",
      "an edit needs --edit-mask, --edit-strength and --edit-cue with one base: --edit-base-job and --edit-base-output, or --edit-base-image and --edit-base-description",
    );
  const blobs = new Map<string, Uint8Array>();
  const read = (path: string, what: string): Uint8Array | Outcome => {
    try {
      const bytes = new Uint8Array(readFileSync(path));
      blobs.set(hashOf(bytes), bytes);
      return bytes;
    } catch {
      return refuse("invalid-arguments", `the ${what} file cannot be read`);
    }
  };
  const mask = read(a.editMask as string, "mask");
  if (isOutcome(mask)) return mask;
  let base: Edit["base"];
  if (jobBase)
    base = {
      kind: "job",
      jobId: a.editBaseJob as string,
      output: a.editBaseOutput as Edit["mask"],
    };
  else {
    const image = read(a.editBaseImage as string, "base image");
    if (isOutcome(image)) return image;
    base = {
      kind: "hand",
      image: hashOf(image) as Edit["mask"],
      description: a.editBaseDescription as string,
    };
  }
  return {
    blobs,
    request: {
      base,
      mask: hashOf(mask) as Edit["mask"],
      strength: a.editStrength as number,
      cue: a.editCue as string,
    },
  };
}

/** The finish step the flags describe: none for the default hand edit, a script step only with its description. */
function readStep(a: Args): FinishStep | undefined | Outcome {
  if (a.method === undefined && a.description === undefined) return undefined;
  const method = a.method ?? "hand";
  if (method !== "hand" && method !== "script")
    return refuse("invalid-arguments", '--method must be "hand" or "script"');
  if (a.description !== undefined && a.description === "")
    return refuse("invalid-arguments", "--description must not be empty");
  if (method === "script")
    return a.description === undefined
      ? refuse(
          "invalid-arguments",
          "--method script needs a --description of what ran",
        )
      : { method, description: a.description as string };
  return a.description === undefined
    ? { method }
    : { method, description: a.description as string };
}

function readFiles(
  png: unknown,
  json: unknown,
): { png: Uint8Array; json: string } | undefined | Outcome {
  if (png === undefined && json === undefined) return undefined;
  if (png === undefined || json === undefined)
    return refuse(
      "invalid-arguments",
      "give both --png and --json, or neither",
    );
  try {
    return {
      png: new Uint8Array(readFileSync(png as string)),
      json: readFileSync(json as string, "utf8"),
    };
  } catch {
    return refuse(
      "invalid-arguments",
      "the sheet or metadata file cannot be read",
    );
  }
}

interface Shape {
  readonly slots: RequestInput["slots"];
  readonly kind: "sprite" | "portrait";
}

/** The request fields `generate` and `resolve` both take, checked before anything is built or opened. */
function requestShape(a: Args): Shape | Outcome {
  const slots = parseSlots(a.slots);
  if (isOutcome(slots)) return slots;
  if (a.kind !== "sprite" && a.kind !== "portrait")
    return refuse("invalid-request", 'kind must be "sprite" or "portrait"');
  return { slots, kind: a.kind };
}

/** The request record and spec for these arguments, built from content alone: no store, lock or runtime. */
function buildRequest(
  studio: Studio,
  content: StudioContent,
  a: Args,
  shape: Shape,
  edit?: Edit,
) {
  const built = newRequestRecord(
    content,
    {
      id: a.id as string,
      subject: a.subject as string,
      kind: shape.kind,
      slots: shape.slots,
      ...(a.batch === undefined ? {} : { batch: a.batch as number }),
      ...(a.seed === undefined ? {} : { seed: a.seed as number }),
      ...(a.styleNote === undefined
        ? {}
        : { styleNote: a.styleNote as string }),
      ...(edit === undefined ? {} : { edit }),
    },
    studio.deps.drawSeed,
  );
  return built.ok
    ? built.value
    : refuse("invalid-request", "the request is not valid", {
        error: j(built.error),
      });
}

/** Runs the queued drain to its end in a one-shot command; in a session it answers at once. */
async function afterEnqueue(
  studio: Studio,
  requestId: string,
  jobIds: readonly string[],
): Promise<Outcome> {
  studio.kick();
  if (studio.mode === "session")
    return done({ state: "queued", requestId, jobIds: [...jobIds] });
  await studio.idle();
  const jobs = studio.jobsOf(jobIds);
  const bad = jobs.filter(
    (job) => (job as { status: string }).status !== "succeeded",
  );
  const refusal = studio.drainRefusal();
  if (bad.length === 0 && refusal === undefined)
    return done({ state: "completed", requestId, jobs });
  return refuse(
    "generation-failed",
    refusal ?? `${bad.length} of ${jobs.length} jobs did not succeed`,
    { requestId, jobs },
  );
}

const unsupported = (): Outcome =>
  refuse(
    "unsupported",
    "derive is not supported: no frames are made or changed",
    {
      verb: "derive",
    },
  );

function resolveParams(studio: Studio, a: Args) {
  if ((a.set === undefined) === (a.params === undefined))
    return refuse("invalid-arguments", "give exactly one of --set or --params");
  if (a.set !== undefined) {
    const sets = studio.config.conform;
    const name = a.set as string;
    // Own names only: a set called constructor or __proto__ is not in the config.
    const named =
      sets !== undefined && Object.hasOwn(sets, name) ? sets[name] : undefined;
    return (
      named ??
      refuse(
        "invalid-config",
        `no conform set named "${a.set as string}" in the config`,
      )
    );
  }
  const parsed = parseConformParams(a.params, "params");
  return parsed.ok ? parsed.value : refuse("invalid-arguments", parsed.message);
}

function reviewOf(record: StudioAssetRecord): Record<string, Json> {
  return { review: assetSummary(record) };
}

/** The confirm-by-revision gate: nothing changes unless the owner names the exact revision they reviewed. */
function confirmation(
  record: StudioAssetRecord,
  confirm: unknown,
  needs: "draft" | "approved",
): Outcome | undefined {
  if (record.record.state !== needs)
    return refuse(
      "wrong-state",
      `asset ${record.id} is ${record.record.state}, not ${needs === "draft" ? "a draft" : "approved"}`,
    );
  if (confirm === undefined)
    return refuse(
      "confirmation_required",
      `review the asset, then repeat the command with --confirm ${record.manifestRevision}`,
      reviewOf(record),
    );
  if (confirm !== record.manifestRevision)
    return refuse(
      "revision-mismatch",
      "the confirmed revision is not the asset's current revision",
      { expected: record.manifestRevision, ...reviewOf(record) },
    );
  return undefined;
}

function assetOf(studio: Studio, id: string): StudioAssetRecord | Outcome {
  const status = studio.readOnly();
  if (isOutcome(status)) return status;
  const record = status.assets.find((a) => a.id === id);
  return record ?? refuse("not-found", `no asset record ${id}`);
}

function parseAssessments(
  value: unknown,
): ApproveOptions["assessments"] | Outcome {
  if (value === undefined) return undefined;
  if (!Array.isArray(value))
    return refuse("invalid-arguments", "assessments must be an array");
  const items: NonNullable<ApproveOptions["assessments"]>[number][] = [];
  for (const entry of value) {
    const item = strictObject(entry, "an assessment", [
      "record",
      "disposition",
      "reason",
    ]);
    if (isOutcome(item)) return item;
    const record = strictObject(item.record, "an assessment record", [
      "subject",
      "role",
      "licence",
      "attribution",
    ]);
    if (isOutcome(record)) return record;
    if (
      (item.disposition !== "mit-compatible" &&
        item.disposition !== "incompatible") ||
      typeof item.reason !== "string" ||
      typeof record.subject !== "string" ||
      typeof record.role !== "string" ||
      typeof record.licence !== "string" ||
      (record.attribution !== undefined &&
        typeof record.attribution !== "string")
    )
      return refuse(
        "invalid-arguments",
        "an assessment needs a record, a disposition of mit-compatible or incompatible, and a reason",
      );
    items.push({
      record: record as never,
      disposition: item.disposition,
      reason: item.reason,
    });
  }
  return items;
}

/** A fresh report-only check of one slot's stored pixels against the current content; it reads without the writer lock and writes nothing. */
function reportSlot(
  root: string,
  content: StudioContent,
  setId: string,
  slot: string,
): Outcome {
  const result = slotConformance(root, setId, slot, content);
  if (!result.ok) return refuse(result.reason, safeMessage(result.message));
  const frames = result.frames.map((f) => ({
    index: f.index,
    report: f.report.status,
    failedChecks: f.report.checks
      .filter((c) => c.status === "fail")
      .map((c) => c.check),
    pixelsChanged: f.diff.length,
    diff: j(f.diff),
  }));
  const detail = {
    workingSetId: setId,
    slot,
    source: result.source,
    frames: j(frames),
  };
  if (frames.some((f) => f.pixelsChanged > 0))
    return refuse(
      "proposal-would-replace",
      "conforming would change the stored pixels; nothing was changed",
      detail,
    );
  if (frames.some((f) => f.report !== "pass"))
    return refuse("report-failed", "the report fails", detail);
  return done(detail);
}

function candidateReply(studio: Studio, a: Args, withBytes: boolean): Outcome {
  const root = studio.root;
  if (root === undefined) return studio.missing("studioRoot");
  const result: CandidateFrames = candidateFrames(
    root,
    a.candidateId as string,
  );
  if (!result.ok) return refuse(result.reason, safeMessage(result.message));
  return done({
    candidateId: result.candidateId,
    width: result.width,
    height: result.height,
    frames: result.frames.map((frame) => ({
      index: frame.index,
      durationMs: frame.durationMs,
      imageHash: frame.imageHash,
      ...(withBytes
        ? { base64: Buffer.from(frame.bytes).toString("base64") }
        : {}),
    })),
  });
}

/**
 * What an edit's workspace holds, from the edit's own record: the frames of the
 * latest save, or else the frames it opened with, one tag per slot (1-based,
 * as the editor reports them) and the strip they make.
 */
function workspaceOf(edit: EditRecord): Json {
  const durationsMs: number[] = [];
  const tags: Json[] = [];
  for (const slot of edit.slots) {
    const frames =
      edit.preview?.slots[slot]?.frames ?? edit.baseSignature[slot]?.frames;
    const from = durationsMs.length + 1;
    for (const frame of frames ?? []) durationsMs.push(frame.durationMs);
    tags.push({ name: slot, from, to: durationsMs.length });
  }
  return {
    size: { w: edit.cell.w * durationsMs.length, h: edit.cell.h },
    durationsMs,
    tags,
  };
}

/** The reply for an edit that exists: its slots, its workspace, and where the workspace file is (null when there is none). */
function editReply(
  session: StudioSession,
  id: string,
  workspacePath: string | undefined,
): Outcome {
  const found = session.store.readEdit(id);
  if (found.kind !== "found")
    return refuse("wrong-state", `edit ${id} cannot be read`);
  return done({
    editId: id,
    slots: [...found.value.slots],
    workspace: workspaceOf(found.value),
    workspacePath: workspacePath ?? null,
  });
}

const LIST_KINDS = [
  "requests",
  "jobs",
  "candidates",
  "working-sets",
  "edits",
  "assets",
] as const;

const OPS: Record<string, OpDef> = {
  status: {
    spec: {},
    run: (studio) => {
      const status = studio.readOnly();
      return isOutcome(status)
        ? status
        : done({
            ...(statusSummary(status, studio.deps.isAlive) as Record<
              string,
              Json
            >),
            rootLock: studio.rootLock(status),
            conformSets: Object.keys(studio.config.conform ?? {}).sort(),
          });
    },
  },
  list: {
    spec: str("kind", true),
    positional: "kind",
    run: (studio, a) => {
      const status = studio.readOnly();
      if (isOutcome(status)) return status;
      switch (a.kind) {
        case "requests":
          return done(status.requests.map(requestSummary));
        case "jobs": {
          const kinds: CandidateKinds = new Map(
            status.candidates.map((c) => [c.id, c.result.status] as const),
          );
          return done(status.jobs.map((record) => jobSummary(record, kinds)));
        }
        case "candidates":
          return done(status.candidates.map(candidateSummary));
        case "working-sets":
          return done(status.workingSets.map(setSummary));
        case "edits":
          return done(status.edits.map(editSummary));
        case "assets":
          return done(status.assets.map(assetSummary));
        default:
          return refuse(
            "invalid-arguments",
            `kind must be one of ${LIST_KINDS.join(", ")}`,
          );
      }
    },
  },
  sheet: {
    spec: str("workingSetId", true),
    run: (studio, a) => {
      const status = studio.readOnly();
      if (isOutcome(status)) return status;
      const view = sheet(status, a.workingSetId as string);
      return view === undefined
        ? refuse("not-found", `no working set ${a.workingSetId as string}`)
        : done(j(summarizeSheet(view)));
    },
  },
  report: {
    spec: { ...str("workingSetId", true), ...str("slot", true) },
    run: (studio, a) => {
      const root = studio.root;
      if (root === undefined) return studio.missing("studioRoot");
      const content = studio.loadedContent();
      if (isOutcome(content)) return content;
      return reportSlot(
        root,
        content,
        a.workingSetId as string,
        a.slot as string,
      );
    },
  },
  "edit-report": {
    // The latest save of an edit: each frame's stored report-only result and
    // its changed pixels against the version the save was measured against.
    spec: str("id", true),
    run: (studio, a) => {
      const root = studio.root;
      if (root === undefined) return studio.missing("studioRoot");
      const result = editReport(root, a.id as string);
      if (!result.ok) return refuse(result.reason, safeMessage(result.message));
      const { ok: _ok, ...reply } = result;
      return done(j(reply));
    },
  },
  // A candidate's stored conformed image. `candidate-frames` is the metadata
  // alone; `candidate-bytes` adds each frame's PNG as base64 and is reached
  // only by the host's byte path. Both read without the writer lock.
  "candidate-frames": {
    spec: str("candidateId", true),
    run: (studio, a) => candidateReply(studio, a, false),
  },
  "candidate-bytes": {
    spec: str("candidateId", true),
    run: (studio, a) => candidateReply(studio, a, true),
  },
  derive: { spec: {}, run: () => unsupported() },

  // The preview's asset source: read-only, no writer lock, answered from the
  // source's last scan of the configured registry and studio roots.
  "source-list": {
    spec: {},
    run: (studio) => {
      const source = studio.previewSource();
      return isOutcome(source) ? source : done(j(source.list()));
    },
  },
  "source-resolve": {
    spec: {
      ...str("source", true),
      ...str("id", true),
      ...str("state"),
      ...str("direction"),
      ...str("ability"),
      ...str("expression"),
    },
    run: (studio, a) => {
      const request = parsePreviewResolve(a);
      if (typeof request === "string")
        return refuse("invalid-arguments", request);
      const source = studio.previewSource();
      return isOutcome(source) ? source : done(j(source.resolve(request)));
    },
  },
  "source-bytes": {
    // A held atlas by selection and the pixel key it was resolved with, or the placeholder by its hash.
    spec: {
      ...str("source"),
      ...str("id"),
      ...str("v"),
      ...str("placeholder"),
    },
    run: (studio, a) => {
      const base64 = (bytes: Uint8Array) =>
        Buffer.from(bytes).toString("base64");
      if (a.placeholder !== undefined) {
        if (
          a.source !== undefined ||
          a.id !== undefined ||
          a.v !== undefined ||
          !/^[0-9a-f]{64}$/.test(a.placeholder as string)
        )
          return refuse(
            "invalid-arguments",
            "give a placeholder hash alone, or source, id and v",
          );
        const source = studio.previewSource();
        if (isOutcome(source)) return source;
        const bytes = source.placeholder(a.placeholder as string);
        return bytes === undefined
          ? refuse("not-found", "no such placeholder")
          : done({
              placeholder: a.placeholder as string,
              base64: base64(bytes),
            });
      }
      if (
        !isPreviewSourceKind(a.source) ||
        !isPreviewSlug(a.id) ||
        typeof a.v !== "string"
      )
        return refuse(
          "invalid-arguments",
          "give source (canon, draft or approved), a lowercase hyphenated id and the version v from source-resolve",
        );
      const source = studio.previewSource();
      if (isOutcome(source)) return source;
      const got = source.bytes({ source: a.source, id: a.id }, a.v);
      if (!got.ok)
        return got.reason === "stale"
          ? refuse(
              "stale-version",
              "the version is not the selection's current one: resolve it again",
            )
          : refuse("not-found", "no validated atlas for this selection");
      return done({
        source: a.source,
        id: a.id,
        pixelKey: got.pixelKey,
        width: got.width,
        height: got.height,
        base64: base64(got.bytes),
      });
    },
  },
  "source-keys": {
    spec: {},
    run: (studio) => {
      const source = studio.previewSource();
      return isOutcome(source) ? source : done(j(source.keys()));
    },
  },

  generate: {
    spec: {
      ...str("id", true),
      ...str("subject", true),
      ...str("kind", true),
      slots: { t: "json", req: true },
      batch: { t: "int" },
      seed: { t: "int" },
      ...str("styleNote"),
      ...str("editBaseJob"),
      ...str("editBaseOutput"),
      ...str("editBaseImage"),
      ...str("editBaseDescription"),
      ...str("editMask"),
      editStrength: { t: "number" },
      ...str("editCue"),
    },
    run: async (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const content = studio.loadedContent();
      if (isOutcome(content)) return content;
      const runtime = studio.runtimeFor(session);
      if (isOutcome(runtime)) return runtime;
      const shape = requestShape(a);
      if (isOutcome(shape)) return shape;
      const edit = readEditArgs(a);
      if (isOutcome(edit)) return edit;
      const built = buildRequest(studio, content, a, shape, edit?.request);
      if (isOutcome(built)) return built;
      const spec = built.spec;
      if (edit !== undefined && spec.edit !== undefined) {
        // Checked with the files served from memory, so a refusal stores nothing.
        const checked = resolveEdit(spec.edit, spec.generated, {
          readJob: session.store.readJob,
          readBlob: (hash) =>
            edit.blobs.get(hash) ?? session.store.readBlob(hash),
        });
        if (!checked.ok)
          return refuse("invalid-request", "the edit is not valid", {
            error: j(checked.error),
          });
        try {
          for (const bytes of edit.blobs.values()) session.store.putBlob(bytes);
        } catch (error) {
          return refuse(
            "write-failed",
            safeMessage(
              `could not store the edit files: ${(error as Error).message}`,
            ),
          );
        }
      }
      const ack = session.submitRequest(built.record);
      if (!ack.ok)
        return refuse(ack.reason, safeMessage(ack.message), {
          requestId: a.id as string,
          enqueued: [...ack.enqueued],
        });
      return afterEnqueue(studio, a.id as string, ack.jobIds);
    },
  },
  resolve: {
    // The request fields only: edits name files by path, and a preview never reads files.
    spec: {
      ...str("id", true),
      ...str("subject", true),
      ...str("kind", true),
      slots: { t: "json", req: true },
      batch: { t: "int" },
      seed: { t: "int" },
      ...str("styleNote"),
    },
    run: (studio, a) => {
      const content = studio.loadedContent();
      if (isOutcome(content)) return content;
      const shape = requestShape(a);
      if (isOutcome(shape)) return shape;
      const built = buildRequest(studio, content, a, shape);
      if (isOutcome(built)) return built;
      return done({
        id: a.id as string,
        request: j(built.record.request),
        spec: j(built.spec),
      });
    },
  },
  reroll: {
    spec: {
      ...str("requestId", true),
      perSlot: { t: "int", req: true },
      ...str("slotKey"),
    },
    run: async (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const runtime = studio.runtimeFor(session);
      if (isOutcome(runtime)) return runtime;
      const ack = session.reroll(
        a.requestId as string,
        a.perSlot as number,
        a.slotKey as string | undefined,
      );
      if (!ack.ok)
        return refuse(ack.reason, safeMessage(ack.message), {
          requestId: a.requestId as string,
          enqueued: [...ack.enqueued],
        });
      return afterEnqueue(studio, a.requestId as string, ack.jobIds);
    },
  },
  remove: {
    spec: str("jobId", true),
    run: (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      return (
        fromCommand(session.remove(a.jobId as string)) ??
        done({ jobId: a.jobId as string, state: "removed" })
      );
    },
  },
  abort: {
    spec: str("jobId", true),
    run: async (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const runtime = studio.runtimeIfStarted();
      if (runtime === undefined)
        return refuse(
          "not-running",
          "no job is running in this process; only the owning session can abort",
        );
      const result = await runtime.abort(a.jobId as string);
      if (result.ok)
        return done({ jobId: a.jobId as string, state: "aborted" });
      return refuse(result.reason, safeMessage(result.message));
    },
  },
  conform: {
    spec: { ...str("jobId", true), ...str("set"), params: { t: "json" } },
    run: (studio, a) => {
      const params = resolveParams(studio, a);
      if (isOutcome(params)) return params;
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const content = studio.loadedContent();
      if (isOutcome(content)) return content;
      const result = session.conform(a.jobId as string, content, params);
      return result.ok
        ? done(candidateSummary(result.candidate))
        : refuse(result.reason, safeMessage(result.message));
    },
  },
  "set-create": {
    spec: { ...str("id", true), ...str("requestId", true) },
    run: (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const content = studio.loadedContent();
      if (isOutcome(content)) return content;
      return (
        fromCommand(
          session.openWorkingSet(
            a.id as string,
            a.requestId as string,
            content,
          ),
        ) ?? done({ id: a.id as string, state: "open" })
      );
    },
  },
  "set-replace-sheet": {
    spec: { ...str("workingSetId", true), ...str("requestId", true) },
    run: (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      return (
        fromCommand(
          session.replaceSheet(a.workingSetId as string, a.requestId as string),
        ) ??
        done({
          workingSetId: a.workingSetId as string,
          sheetRequestId: a.requestId as string,
        })
      );
    },
  },
  pick: {
    spec: {
      ...str("workingSetId", true),
      ...str("candidateId", true),
      ...str("slot"),
    },
    run: (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const slot = a.slot as string | undefined;
      return (
        fromCommand(
          session.pick(a.workingSetId as string, a.candidateId as string, slot),
        ) ??
        done({
          workingSetId: a.workingSetId as string,
          candidateId: a.candidateId as string,
          ...(slot === undefined ? {} : { slot }),
        })
      );
    },
  },
  reject: {
    spec: { ...str("id", true), ...str("reason") },
    run: (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const result = session.rejectAsset(
        a.id as string,
        a.reason as string | undefined,
      );
      return result.ok
        ? done(assetSummary(result.asset))
        : refuse(result.reason, safeMessage(result.message));
    },
  },

  open: {
    spec: {
      ...str("id", true),
      ...str("workingSetId", true),
      slots: { t: "json", req: true },
    },
    run: async (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const content = studio.loadedContent();
      if (isOutcome(content)) return content;
      const slots = a.slots;
      if (!Array.isArray(slots) || slots.some((s) => typeof s !== "string"))
        return refuse(
          "invalid-arguments",
          "slots must be an array of slot keys",
        );
      const opened = session.openEdit(
        a.id as string,
        a.workingSetId as string,
        slots as string[],
        content,
      );
      if (!opened.ok) return refuse(opened.reason, safeMessage(opened.message));
      // No editor configured: the edit still exists, with its sheet and
      // metadata, so the files path (export, edit by hand, import) works.
      if (studio.config.editor === undefined)
        return editReply(session, a.id as string, undefined);
      const editor = studio.editorFor(session);
      if (isOutcome(editor)) return editor;
      const built = await editor.openWorkspace(a.id as string);
      if (!built.ok)
        return refuse(built.reason, safeMessage(built.message), {
          editId: a.id as string,
          guidance:
            "the edit is open: export its sheet with `export`, edit it by hand and bring it back with `import` or `finish` using --png and --json",
        });
      studio.watchEdit(a.id as string, studio.workspaceHash(a.id as string));
      const workspacePath = studio.workspacePath(a.id as string);
      return done({
        editId: a.id as string,
        slots: slots as string[],
        workspace: {
          size: j(built.readback.size),
          durationsMs: [...built.readback.durationsMs],
          tags: built.readback.tags.map((t) => ({
            name: t.name,
            from: t.from,
            to: t.to,
          })),
        },
        // A path the native host launches the editor on; the host strips it before anything reaches the webview.
        ...(workspacePath === undefined ? {} : { workspacePath }),
      });
    },
  },
  // An edit that is already open: names its workspace file again, rebuilding
  // it only if it is gone, and makes sure the session is watching it. The path
  // reaches the native host only, which strips it before the webview.
  "edit-workspace": {
    spec: str("id", true),
    run: async (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const id = a.id as string;
      const found = isPreviewSlug(id)
        ? session.store.readEdit(id)
        : ({ kind: "missing" } as const);
      if (found.kind === "missing") return refuse("not-found", `no edit ${id}`);
      if (found.kind === "invalid")
        return refuse("wrong-state", `edit ${id} is invalid`);
      if (found.value.status !== "open")
        return refuse(
          "wrong-state",
          `edit ${id} is ${found.value.status}, not open`,
        );
      if (studio.config.editor === undefined)
        return editReply(session, id, undefined);
      const content = studio.loadedContent();
      if (isOutcome(content)) return content;
      const editor = studio.editorFor(session);
      if (isOutcome(editor)) return editor;
      if (studio.workspaceHash(id) === undefined) {
        const built = await editor.openWorkspace(id);
        if (!built.ok)
          return refuse(built.reason, safeMessage(built.message), {
            editId: id,
          });
      }
      studio.watchEdit(id, studio.workspaceHash(id));
      return editReply(session, id, studio.workspacePath(id));
    },
  },
  import: {
    spec: { ...str("id", true), ...str("png"), ...str("json") },
    run: async (studio, a) => editBring(studio, a, "import"),
  },
  finish: {
    spec: {
      ...str("id", true),
      ...str("png"),
      ...str("json"),
      ...str("method"),
      ...str("description"),
      ...str("reviewed"),
    },
    run: async (studio, a) => editBring(studio, a, "finish"),
  },
  discard: {
    spec: str("id", true),
    run: (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const result = session.discardEdit(a.id as string);
      if (!result.ok) return refuse(result.reason, safeMessage(result.message));
      studio.unwatchEdit(a.id as string);
      return done({ editId: a.id as string, state: "discarded" });
    },
  },
  export: {
    spec: { ...str("id", true), ...str("dir", true) },
    run: (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const written: string[] = [];
      try {
        mkdirSync(a.dir as string, { recursive: true });
        for (const name of [
          "sheet.png",
          "sheet.json",
          "workspace.aseprite",
        ] as const) {
          const bytes = session.store.readEditFile(a.id as string, name);
          if (bytes === undefined) {
            if (name === "workspace.aseprite") continue;
            return refuse("not-found", `edit ${a.id as string} has no ${name}`);
          }
          writeFileSync(join(a.dir as string, name), bytes);
          written.push(name);
        }
      } catch {
        return refuse("write-failed", "the export directory cannot be written");
      }
      return done({ editId: a.id as string, files: written });
    },
  },

  pack: {
    spec: {
      ...str("id", true),
      ...str("workingSetId", true),
      ...str("assetId", true),
      ...str("styleTag", true),
      footprint: { t: "json" },
      stillFrameMs: { t: "int" },
      carriedParams: { t: "json" },
      originalWork: { t: "json" },
    },
    run: (studio, a) => {
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const content = studio.loadedContent();
      if (isOutcome(content)) return content;
      const registry = studio.registryRoot();
      if (isOutcome(registry)) return registry;
      const input: { -readonly [K in keyof PackInput]: PackInput[K] } = {
        id: a.id as string,
        workingSetId: a.workingSetId as string,
        assetId: a.assetId as string,
        styleTag: a.styleTag as string,
      };
      if (a.footprint !== undefined) {
        const f = strictObject(a.footprint, "footprint", ["w", "h"]);
        if (isOutcome(f)) return f;
        if (
          !Number.isInteger(f.w) ||
          !Number.isInteger(f.h) ||
          (f.w as number) < 1 ||
          (f.h as number) < 1
        )
          return refuse(
            "invalid-arguments",
            "footprint needs whole w and h of at least 1",
          );
        input.footprint = { w: f.w as number, h: f.h as number };
      }
      if (a.stillFrameMs !== undefined)
        input.stillFrameMs = a.stillFrameMs as number;
      if (a.carriedParams !== undefined) {
        const p = parseConformParams(a.carriedParams, "carriedParams");
        if (!p.ok) return refuse("invalid-arguments", p.message);
        if (p.value.scale !== undefined)
          return refuse("invalid-arguments", "carriedParams takes no scale");
        input.carriedParams = {
          background: p.value.background,
          alphaCutoff: p.value.alphaCutoff,
          grid: p.value.grid,
        };
      }
      if (a.originalWork !== undefined) {
        const w = strictObject(a.originalWork, "originalWork", [
          "licence",
          "attribution",
        ]);
        if (isOutcome(w)) return w;
        if (
          typeof w.licence !== "string" ||
          w.licence === "" ||
          (w.attribution !== undefined && typeof w.attribution !== "string")
        )
          return refuse(
            "invalid-arguments",
            "originalWork needs a licence and may carry an attribution",
          );
        input.originalWork = {
          licence: w.licence,
          ...(w.attribution === undefined
            ? {}
            : { attribution: w.attribution as string }),
        };
      }
      const result = session.pack(input, content, content.palette, registry);
      return result.ok
        ? done(assetSummary(result.asset))
        : refuse(result.reason, safeMessage(result.message));
    },
  },
  approve: {
    spec: approveSpec(false),
    run: (studio, a) => approve(studio, a, false),
  },
  "approve-with-exception": {
    spec: approveSpec(true),
    run: (studio, a) => approve(studio, a, true),
  },
  publish: {
    spec: { ...str("id", true), ...str("confirm") },
    run: (studio, a) => {
      const found = assetOf(studio, a.id as string);
      if (isOutcome(found)) return found;
      const gate = confirmation(found, a.confirm, "approved");
      if (gate !== undefined) return gate;
      const session = studio.owner();
      if (isOutcome(session)) return session;
      const content = studio.loadedContent();
      if (isOutcome(content)) return content;
      const registry = studio.registryRoot();
      if (isOutcome(registry)) return registry;
      const result = session.publishAsset(
        a.id as string,
        content,
        content.palette,
        registry,
      );
      return result.ok
        ? done({
            id: result.asset.id,
            state: result.asset.record.state,
            revision: result.asset.published?.revision ?? null,
          })
        : refuse(result.reason, safeMessage(result.message));
    },
  },
};

function approveSpec(withException: boolean): Spec {
  return {
    ...str("id", true),
    ...str("confirm"),
    assessments: { t: "json" },
    ...(withException
      ? { exception: { t: "json" as const, req: true as const } }
      : {}),
  };
}

function approve(
  studio: Studio,
  a: Args,
  withException: boolean,
): Outcome | Promise<Outcome> {
  const options: { -readonly [K in keyof ApproveOptions]: ApproveOptions[K] } =
    {};
  if (withException) {
    const e = strictObject(a.exception, "exception", ["reason"]);
    if (isOutcome(e)) return e;
    if (typeof e.reason !== "string" || e.reason.trim() === "")
      return refuse("invalid-arguments", "an exception needs a reason");
    options.exception = { reason: e.reason };
  }
  const assessments = parseAssessments(a.assessments);
  if (isOutcome(assessments)) return assessments;
  if (assessments !== undefined) options.assessments = assessments;
  const found = assetOf(studio, a.id as string);
  if (isOutcome(found)) return found;
  const gate = confirmation(found, a.confirm, "draft");
  if (gate !== undefined) return gate;
  const session = studio.owner();
  if (isOutcome(session)) return session;
  const content = studio.loadedContent();
  if (isOutcome(content)) return content;
  const result = session.approveAsset(
    a.id as string,
    options,
    content,
    content.palette,
  );
  if (!result.ok) return refuse(result.reason, safeMessage(result.message));
  const state = result.asset.record;
  return done({
    id: result.asset.id,
    state: state.state,
    manifestRevision: result.asset.manifestRevision,
    basis: state.state === "approved" ? state.basis.type : null,
  });
}

async function editBring(
  studio: Studio,
  a: Args,
  mode: "import" | "finish",
): Promise<Outcome> {
  // The sheet hash the owner reviewed (an edit report's `sheetHash`): a finish
  // that would take any other sheet is refused as `stale-review`.
  const reviewed = a.reviewed as string | undefined;
  if (reviewed !== undefined && !/^[0-9a-f]{64}$/.test(reviewed))
    return refuse(
      "invalid-arguments",
      '"reviewed" must be a sheet hash (64 lowercase hex digits)',
    );
  const session = studio.owner();
  if (isOutcome(session)) return session;
  const content = studio.loadedContent();
  if (isOutcome(content)) return content;
  const files = readFiles(a.png, a.json);
  if (isOutcome(files)) return files;
  const step = readStep(a);
  if (isOutcome(step)) return step;
  if (step !== undefined && files === undefined)
    return refuse(
      "invalid-arguments",
      "--method and --description describe a sheet brought back with --png and --json",
    );
  let result: EditResult | { ok: false; reason: string; message: string };
  if (files !== undefined)
    result =
      mode === "import"
        ? session.importEdit(a.id as string, files.png, files.json, content)
        : session.finishEdit(
            a.id as string,
            files.png,
            files.json,
            content,
            step,
            reviewed as Sha256 | undefined,
          );
  else {
    const editor = studio.editorFor(session);
    if (isOutcome(editor)) return editor;
    result = await editor.refresh(
      a.id as string,
      content,
      mode,
      reviewed as Sha256 | undefined,
    );
  }
  if (!result.ok) return refuse(result.reason, safeMessage(result.message));
  if (mode === "finish") studio.unwatchEdit(a.id as string);
  return done({
    editId: a.id as string,
    state: mode === "finish" ? "finished" : "imported",
    changed: result.changed,
  });
}

export const opSpec = (op: string): OpDef | undefined => own(OPS, op);
export const opNames = (): string[] => Object.keys(OPS);

/** The ops that read durable records and take no writer lock. */
export const READ_ONLY = new Set([
  "status",
  "list",
  "sheet",
  "report",
  "edit-report",
  "candidate-frames",
  "candidate-bytes",
  "resolve",
  "source-list",
  "source-resolve",
  "source-bytes",
  "source-keys",
  "derive",
]);

export async function execute(
  studio: Studio,
  op: string,
  args: unknown,
): Promise<Outcome> {
  const def = own(OPS, op);
  if (def === undefined)
    return refuse("unknown-op", `unknown command "${op}"`, {
      known: opNames(),
    });
  // Everything past the lookup is inside the try, so a throw while reading
  // the arguments is still one error response for this request.
  try {
    const read = readArgs(args ?? {}, def.spec);
    if (isOutcome(read)) return read;
    if (studio.stopping && !READ_ONLY.has(op))
      return refuse("shutting-down", "the session is shutting down");
    if (studio.mode === "session" && !READ_ONLY.has(op)) {
      // A session that does not own the root tries the lock now, so every
      // write is refused (or promoted) in one place, before the op's own work.
      const owned = studio.owner();
      if (isOutcome(owned)) return owned;
    }
    return await def.run(studio, read);
  } catch {
    return refuse("internal", "the command failed unexpectedly");
  }
}
