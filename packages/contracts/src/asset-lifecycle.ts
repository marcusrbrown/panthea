// Asset lifecycle, generation jobs and provider envelopes. Pure and
// interface-only: no queue, no editor, no conformance, no provider
// implementation lives here.

import {
  ASSET_SCHEMA_VERSIONS,
  type AssetKind,
  type AssetManifest,
  type GenerationRequest,
  type OwnerException,
  type Provenance,
  parseGenerationRequest,
  parsePositiveInteger,
  parseSha256,
  parseSlug,
  parseStrictRecord,
  type Sha256,
} from "./assets";
import { canonicalJson } from "./canonical";
import {
  fail,
  ok,
  type ParseResult,
  parseArray,
  parseEnum,
  parseSchemaVersion,
  parseString,
} from "./ids";

export const ASSET_ERROR_CODES = [
  "illegal-transition",
  "conformance-failed",
  "job-not-succeeded",
  "job-mismatch",
  "hash-mismatch",
  "not-approved",
  "invalid-manifest",
  "corrupt-manifest",
  "corrupt-index",
  "corrupt-blob",
  "missing-blob",
  "io-error",
] as const;
export type AssetErrorCode = (typeof ASSET_ERROR_CODES)[number];

export interface AssetFailure {
  readonly ok: false;
  readonly code: AssetErrorCode;
  readonly message: string;
}
export type AssetResult<T> =
  | { readonly ok: true; readonly value: T }
  | AssetFailure;

export function assetOk<T>(value: T): AssetResult<T> {
  return { ok: true, value };
}
export function assetFail(code: AssetErrorCode, message: string): AssetFailure {
  return { ok: false, code, message };
}

export type GenerationMedium = "image" | "sound";
export function mediumOfKind(kind: AssetKind): GenerationMedium {
  return kind === "sound" ? "sound" : "image";
}

export interface ProviderDescriptor {
  readonly id: string;
  readonly medium: GenerationMedium;
  readonly hosting: "local" | "hosted";
}

export type ProviderAvailability =
  | { readonly status: "available" }
  | {
      readonly status: "unavailable";
      readonly reason: string;
      readonly staging: string;
    };

export interface ImageOutput {
  readonly medium: "image";
  readonly hash: Sha256;
  readonly width: number;
  readonly height: number;
}

export interface SoundOutput {
  readonly medium: "sound";
  readonly hash: Sha256;
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationMs: number;
}

export type JobOutput = ImageOutput | SoundOutput;

export type ProviderOutcome<O extends JobOutput> =
  | { readonly status: "succeeded"; readonly outputs: readonly O[] }
  | { readonly status: "failed"; readonly error: string }
  | {
      readonly status: "unavailable";
      readonly reason: string;
      readonly staging: string;
    }
  | { readonly status: "cancelled" };

export interface ImageProvider {
  readonly descriptor: ProviderDescriptor & { readonly medium: "image" };
  availability(): Promise<ProviderAvailability>;
  generate(
    request: GenerationRequest,
    signal: AbortSignal,
  ): Promise<ProviderOutcome<ImageOutput>>;
}

export interface SoundProvider {
  readonly descriptor: ProviderDescriptor & { readonly medium: "sound" };
  availability(): Promise<ProviderAvailability>;
  generate(
    request: GenerationRequest,
    signal: AbortSignal,
  ): Promise<ProviderOutcome<SoundOutput>>;
}

interface JobBase {
  readonly schemaVersion: number;
  readonly id: string;
  readonly request: GenerationRequest;
  readonly provider: ProviderDescriptor;
}

export type GenerationJob =
  | (JobBase & { readonly status: "queued" })
  | (JobBase & { readonly status: "running"; readonly progress?: number })
  | (JobBase & {
      readonly status: "succeeded";
      readonly outputs: readonly JobOutput[];
    })
  | (JobBase & { readonly status: "failed"; readonly error: string })
  | (JobBase & {
      readonly status: "unavailable";
      readonly reason: string;
      readonly staging: string;
    })
  | (JobBase & {
      readonly status: "cancelled";
      readonly cancelledBy: "removed" | "aborted";
    });

function parseProviderDescriptor(
  value: unknown,
  path: string,
): ParseResult<ProviderDescriptor> {
  return parseStrictRecord(
    value,
    path,
    ["id", "medium", "hosting"],
    (record) => {
      const id = parseSlug(record.id, `${path}.id`);
      if (!id.ok) return id;
      const medium = parseEnum(record.medium, `${path}.medium`, [
        "image",
        "sound",
      ] as const);
      if (!medium.ok) return medium;
      const hosting = parseEnum(record.hosting, `${path}.hosting`, [
        "local",
        "hosted",
      ] as const);
      if (!hosting.ok) return hosting;
      return ok({ id: id.value, medium: medium.value, hosting: hosting.value });
    },
  );
}

function parseJobOutput(
  medium: GenerationMedium,
): (value: unknown, path: string) => ParseResult<JobOutput> {
  return (value, path) => {
    if (medium === "image") {
      return parseStrictRecord(
        value,
        path,
        ["medium", "hash", "width", "height"],
        (record) => {
          if (record.medium !== "image")
            return fail(`${path}.medium`, 'expected "image"');
          const hash = parseSha256(record.hash, `${path}.hash`);
          if (!hash.ok) return hash;
          const width = parsePositiveInteger(record.width, `${path}.width`);
          if (!width.ok) return width;
          const height = parsePositiveInteger(record.height, `${path}.height`);
          if (!height.ok) return height;
          return ok({
            medium: "image",
            hash: hash.value,
            width: width.value,
            height: height.value,
          });
        },
      );
    }
    return parseStrictRecord(
      value,
      path,
      ["medium", "hash", "sampleRate", "channels", "durationMs"],
      (record) => {
        if (record.medium !== "sound")
          return fail(`${path}.medium`, 'expected "sound"');
        const hash = parseSha256(record.hash, `${path}.hash`);
        if (!hash.ok) return hash;
        const sampleRate = parsePositiveInteger(
          record.sampleRate,
          `${path}.sampleRate`,
        );
        if (!sampleRate.ok) return sampleRate;
        const channels = parsePositiveInteger(
          record.channels,
          `${path}.channels`,
        );
        if (!channels.ok) return channels;
        const durationMs = parsePositiveInteger(
          record.durationMs,
          `${path}.durationMs`,
        );
        if (!durationMs.ok) return durationMs;
        return ok({
          medium: "sound",
          hash: hash.value,
          sampleRate: sampleRate.value,
          channels: channels.value,
          durationMs: durationMs.value,
        });
      },
    );
  };
}

const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "unavailable",
  "cancelled",
] as const;

const JOB_STATUS_KEYS = {
  queued: [],
  running: ["progress"],
  succeeded: ["outputs"],
  failed: ["error"],
  unavailable: ["reason", "staging"],
  cancelled: ["cancelledBy"],
} as const;

export function parseGenerationJob(
  input: unknown,
  path = "job",
): ParseResult<GenerationJob> {
  const status = isStatusRecord(input)
    ? parseEnum(input.status, `${path}.status`, JOB_STATUSES)
    : fail(path, "expected an object");
  if (!status.ok) return status;
  return parseStrictRecord<GenerationJob>(
    input,
    path,
    [
      "schemaVersion",
      "id",
      "request",
      "provider",
      "status",
      ...JOB_STATUS_KEYS[status.value],
    ],
    (record) => {
      const schemaVersion = parseSchemaVersion(
        record.schemaVersion,
        ASSET_SCHEMA_VERSIONS,
        `${path}.schemaVersion`,
      );
      if (!schemaVersion.ok) return schemaVersion;
      const id = parseSlug(record.id, `${path}.id`);
      if (!id.ok) return id;
      const request = parseGenerationRequest(record.request, `${path}.request`);
      if (!request.ok) return request;
      const provider = parseProviderDescriptor(
        record.provider,
        `${path}.provider`,
      );
      if (!provider.ok) return provider;
      if (provider.value.medium !== mediumOfKind(request.value.kind)) {
        return fail(
          `${path}.provider.medium`,
          `a ${request.value.kind} request needs a ${mediumOfKind(request.value.kind)} provider`,
        );
      }
      if (
        provider.value.hosting === "hosted" &&
        status.value !== "unavailable"
      ) {
        return fail(
          `${path}.status`,
          "no hosted provider is wired; its jobs are unavailable",
        );
      }
      const base = {
        schemaVersion: schemaVersion.value,
        id: id.value,
        request: request.value,
        provider: provider.value,
      };
      switch (status.value) {
        case "queued":
          return ok({ ...base, status: "queued" });
        case "running": {
          if (record.progress === undefined)
            return ok({ ...base, status: "running" });
          const progress = record.progress;
          if (
            typeof progress !== "number" ||
            !(progress >= 0 && progress <= 1)
          ) {
            return fail(`${path}.progress`, "expected a number from 0 to 1");
          }
          return ok({ ...base, status: "running", progress });
        }
        case "succeeded": {
          const outputs = parseArray(
            record.outputs,
            `${path}.outputs`,
            parseJobOutput(provider.value.medium),
          );
          if (!outputs.ok) return outputs;
          if (outputs.value.length === 0)
            return fail(
              `${path}.outputs`,
              "a succeeded job has at least one output",
            );
          return ok({ ...base, status: "succeeded", outputs: outputs.value });
        }
        case "failed": {
          const error = parseString(record.error, `${path}.error`);
          if (!error.ok) return error;
          return ok({ ...base, status: "failed", error: error.value });
        }
        case "unavailable": {
          const reason = parseString(record.reason, `${path}.reason`);
          if (!reason.ok) return reason;
          const staging = parseString(record.staging, `${path}.staging`);
          if (!staging.ok) return staging;
          return ok({
            ...base,
            status: "unavailable",
            reason: reason.value,
            staging: staging.value,
          });
        }
        case "cancelled": {
          const cancelledBy = parseEnum(
            record.cancelledBy,
            `${path}.cancelledBy`,
            ["removed", "aborted"] as const,
          );
          if (!cancelledBy.ok) return cancelledBy;
          return ok({
            ...base,
            status: "cancelled",
            cancelledBy: cancelledBy.value,
          });
        }
      }
    },
  );
}

function isStatusRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ConformanceCheck {
  readonly check: string;
  readonly status: "pass" | "fail";
  readonly message?: string;
}

export interface ConformanceReport {
  readonly schemaVersion: number;
  readonly status: "pass" | "fail";
  readonly checks: readonly ConformanceCheck[];
}

export function parseConformanceReport(
  input: unknown,
  path = "report",
): ParseResult<ConformanceReport> {
  return parseStrictRecord(
    input,
    path,
    ["schemaVersion", "status", "checks"],
    (record) => {
      const schemaVersion = parseSchemaVersion(
        record.schemaVersion,
        ASSET_SCHEMA_VERSIONS,
        `${path}.schemaVersion`,
      );
      if (!schemaVersion.ok) return schemaVersion;
      const status = parseEnum(record.status, `${path}.status`, [
        "pass",
        "fail",
      ] as const);
      if (!status.ok) return status;
      const checks = parseArray(
        record.checks,
        `${path}.checks`,
        (value, checkPath) =>
          parseStrictRecord(
            value,
            checkPath,
            ["check", "status", "message"],
            (item) => {
              const check = parseString(item.check, `${checkPath}.check`);
              if (!check.ok) return check;
              const checkStatus = parseEnum(
                item.status,
                `${checkPath}.status`,
                ["pass", "fail"] as const,
              );
              if (!checkStatus.ok) return checkStatus;
              if (item.message === undefined)
                return ok({ check: check.value, status: checkStatus.value });
              const message = parseString(item.message, `${checkPath}.message`);
              if (!message.ok) return message;
              return ok({
                check: check.value,
                status: checkStatus.value,
                message: message.value,
              });
            },
          ),
      );
      if (!checks.ok) return checks;
      const anyFailed = checks.value.some((check) => check.status === "fail");
      if ((status.value === "pass") === anyFailed) {
        return fail(
          `${path}.status`,
          anyFailed
            ? "a report with a failed check does not pass"
            : "a failing report names a failed check",
        );
      }
      return ok({
        schemaVersion: schemaVersion.value,
        status: status.value,
        checks: checks.value,
      });
    },
  );
}

export type EditOutcome = "finished" | "discarded";
export type ApprovalBasis =
  | { readonly type: "report-pass" }
  | { readonly type: "owner-exception"; readonly reason: string };

/** The record owns the manifest it covers: an approval is for exactly these contents. */
interface RecordBase {
  readonly manifest: AssetManifest;
}

export type AssetRecord =
  | (RecordBase & {
      readonly state: "candidate";
      readonly report: ConformanceReport;
    })
  | (RecordBase & {
      readonly state: "draft";
      readonly report?: ConformanceReport;
      readonly edit: "idle" | "editing-externally";
      readonly edits: readonly EditOutcome[];
    })
  | (RecordBase & { readonly state: "approved"; readonly basis: ApprovalBasis })
  | (RecordBase & { readonly state: "canon"; readonly basis: ApprovalBasis })
  | (RecordBase & {
      readonly state: "rejected";
      readonly rejectedFrom: "candidate" | "draft";
      readonly reason?: string;
    });

export type AssetAction =
  | { readonly type: "pick" }
  | { readonly type: "reject"; readonly reason?: string }
  | { readonly type: "start-edit" }
  /** The edited manifest: same id, provenance as before plus one appended hand-edit step. */
  | { readonly type: "finish-edit"; readonly manifest: AssetManifest }
  | { readonly type: "discard-edit" }
  | {
      readonly type: "approve";
      readonly report?: ConformanceReport;
      readonly exception?: OwnerException;
    }
  | { readonly type: "canonize" };

export function newCandidate(
  manifest: AssetManifest,
  report: ConformanceReport,
): AssetRecord {
  return { state: "candidate", manifest, report };
}

const refuse = (record: AssetRecord, action: AssetAction) =>
  assetFail("illegal-transition", `${record.state} cannot ${action.type}`);

function approve(
  record: Extract<AssetRecord, { state: "draft" }>,
  action: Extract<AssetAction, { type: "approve" }>,
): AssetResult<AssetRecord> {
  const report = action.report ?? record.report;
  if (report?.status === "pass") {
    return assetOk({
      state: "approved",
      manifest: record.manifest,
      basis: { type: "report-pass" },
    });
  }
  const reason = action.exception?.reason.trim();
  if (reason === undefined || reason === "") {
    return assetFail(
      "conformance-failed",
      report === undefined
        ? "approval needs a passing conformance report or an owner exception"
        : "conformance failed; approval needs an owner exception with a reason",
    );
  }
  return assetOk({
    state: "approved",
    manifest: {
      ...record.manifest,
      provenance: { ...record.manifest.provenance, ownerException: { reason } },
    },
    basis: { type: "owner-exception", reason },
  });
}

/** Why `after` is not `before` plus one recorded hand edit, if it is not. */
function editProblem(
  before: AssetManifest,
  after: AssetManifest,
): string | undefined {
  if (after.id !== before.id) {
    return `an edit keeps the asset id "${before.id}", not "${after.id}"`;
  }
  const was = before.provenance.handEdits;
  const now = after.provenance.handEdits;
  if (
    now.length !== was.length + 1 ||
    canonicalJson(now.slice(0, was.length)) !== canonicalJson(was)
  ) {
    return "an edit appends exactly one hand-edit step to the provenance";
  }
  if (
    canonicalJson({ ...after.provenance, handEdits: was }) !==
    canonicalJson(before.provenance)
  ) {
    return "an edit changes nothing in the provenance but the appended hand-edit step";
  }
  return undefined;
}

/**
 * The only way an asset record changes state. Editing is a draft substate:
 * start and discard record what happened and leave the manifest alone;
 * finishing swaps in the edited manifest, appends its hand-edit step, and
 * drops the draft's report, which no longer describes it.
 */
export function transitionAsset(
  record: AssetRecord,
  action: AssetAction,
): AssetResult<AssetRecord> {
  switch (record.state) {
    case "candidate":
      if (action.type === "pick") {
        return assetOk({
          state: "draft",
          manifest: record.manifest,
          report: record.report,
          edit: "idle",
          edits: [],
        });
      }
      if (action.type === "reject") {
        return assetOk({
          state: "rejected",
          manifest: record.manifest,
          rejectedFrom: "candidate",
          ...(action.reason === undefined ? {} : { reason: action.reason }),
        });
      }
      return refuse(record, action);
    case "draft":
      if (record.edit === "editing-externally") {
        if (action.type === "finish-edit") {
          const problem = editProblem(record.manifest, action.manifest);
          if (problem !== undefined)
            return assetFail("invalid-manifest", problem);
          return assetOk({
            state: "draft",
            manifest: action.manifest,
            edit: "idle",
            edits: [...record.edits, "finished"],
          });
        }
        if (action.type === "discard-edit") {
          return assetOk({
            ...record,
            edit: "idle",
            edits: [...record.edits, "discarded"],
          });
        }
        return refuse(record, action);
      }
      if (action.type === "start-edit")
        return assetOk({ ...record, edit: "editing-externally" });
      if (action.type === "approve") return approve(record, action);
      if (action.type === "reject") {
        return assetOk({
          state: "rejected",
          manifest: record.manifest,
          rejectedFrom: "draft",
          ...(action.reason === undefined ? {} : { reason: action.reason }),
        });
      }
      return refuse(record, action);
    case "approved":
      if (action.type === "canonize")
        return assetOk({ ...record, state: "canon" });
      return refuse(record, action);
    case "canon":
    case "rejected":
      return refuse(record, action);
  }
}

/** Cross-checks a provenance record against the job records it names. */
export function checkProvenanceAgainstJobs(
  provenance: Provenance,
  jobs: readonly GenerationJob[],
): AssetResult<true> {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  for (const ref of provenance.relatedJobs) {
    const job = byId.get(ref.jobId);
    if (job === undefined)
      return assetFail(
        "job-mismatch",
        `job "${ref.jobId}" is not in the ledger`,
      );
    if (
      provenance.method === "generated" &&
      ref.jobId === provenance.jobId &&
      job.status !== "succeeded"
    ) {
      return assetFail(
        "job-not-succeeded",
        `source job "${ref.jobId}" is ${job.status} in the ledger`,
      );
    }
    if (job.status !== ref.status) {
      return assetFail(
        "job-mismatch",
        `job "${ref.jobId}" is ${job.status} in the ledger, ${ref.status} in the provenance`,
      );
    }
    if (job.status === "succeeded") {
      const recorded = new Set<string>(ref.outputs ?? []);
      const actual = new Set<string>(job.outputs.map((output) => output.hash));
      if (
        recorded.size !== actual.size ||
        [...actual].some((hash) => !recorded.has(hash))
      ) {
        return assetFail(
          "hash-mismatch",
          `job "${ref.jobId}" outputs differ from the provenance`,
        );
      }
    }
    if (provenance.method === "generated" && ref.jobId === provenance.jobId) {
      if (canonicalJson(job.request) !== canonicalJson(provenance.request)) {
        return assetFail(
          "job-mismatch",
          `job "${ref.jobId}" was run for a different request`,
        );
      }
    }
  }
  return assetOk(true);
}
