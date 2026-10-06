// Authoring-root layout and the pieces every record kind shares. Everything
// under the root is studio-local bookkeeping; canon stays in the registry.
//
//   <root>/session.lock          OS-held exclusive lock (SQLite)
//   <root>/session.json          the session record
//   <root>/requests/<id>.json
//   <root>/jobs/<id>.json
//   <root>/candidates/<jobId>.json
//   <root>/working-sets/<id>.json
//   <root>/edits/<id>.json
//   <root>/edits/<id>/{sheet.png,sheet.json,workspace.aseprite}
//   <root>/commands/<seq>.json   the always-on command ledger
//   <root>/blobs/<sha256>.png    content-addressed bytes

import { join } from "node:path";
import {
  type ApprovalBasis,
  type AssetId,
  type AssetManifest,
  type AssetRecord,
  fail,
  LICENCE_ROLES,
  type LicenceRecord,
  type ModelRef,
  ok,
  type ParseResult,
  parseArray,
  parseAssetId,
  parseConformanceReport,
  parseEnum,
  parseGenerationSettings,
  parseIntegerAtLeast,
  parseLicence,
  parseModelRef,
  parseRuntimeRef,
  parseSha256,
  parseSlug,
  parseStrictRecord,
  parseString,
  type RuntimeRef,
  type SettingValue,
  type Sha256,
} from "@panthea/contracts";

export const STUDIO_SCHEMA_VERSION = 1;

export function parseStudioVersion(
  value: unknown,
  path: string,
): ParseResult<1> {
  return value === STUDIO_SCHEMA_VERSION
    ? ok(STUDIO_SCHEMA_VERSION)
    : fail(`${path}.schemaVersion`, `expected ${STUDIO_SCHEMA_VERSION}`);
}

export const studioPaths = (root: string) => ({
  lock: join(root, "session.lock"),
  session: join(root, "session.json"),
  requests: join(root, "requests"),
  jobs: join(root, "jobs"),
  candidates: join(root, "candidates"),
  workingSets: join(root, "working-sets"),
  edits: join(root, "edits"),
  assets: join(root, "assets"),
  commands: join(root, "commands"),
  blobs: join(root, "blobs"),
});

/** Where a job came from: its request, the slot it fills and its place in the request's sequence. */
export interface JobSource {
  readonly requestId: string;
  readonly slotKey: string;
  readonly ordinal: number;
}

export function parseJobSource(
  input: unknown,
  path: string,
): ParseResult<JobSource> {
  return parseStrictRecord(
    input,
    path,
    ["requestId", "slotKey", "ordinal"],
    (record) => {
      const requestId = parseSlug(record.requestId, `${path}.requestId`);
      if (!requestId.ok) return requestId;
      const slotKey = parseString(record.slotKey, `${path}.slotKey`);
      if (!slotKey.ok) return slotKey;
      const ordinal = parseIntegerAtLeast(record.ordinal, `${path}.ordinal`, 0);
      if (!ordinal.ok) return ordinal;
      return ok({
        requestId: requestId.value,
        slotKey: slotKey.value,
        ordinal: ordinal.value,
      });
    },
  );
}

/**
 * What actually ran a succeeded job, captured from the engine that was launched
 * and hash-verified: never paths, arguments, ports, environment or credentials.
 * The binary hash stays here because a runtime ref carries only name and version.
 */
export interface EngineFacts {
  readonly runtime: RuntimeRef;
  readonly runtimeBinarySha256: Sha256;
  readonly model: ModelRef;
  readonly loras: readonly ModelRef[];
  readonly encoder: ModelRef | null;
  readonly vae: ModelRef | null;
  readonly licences: readonly LicenceRecord[];
  readonly settings: Readonly<Record<string, SettingValue>>;
}

function parseOptionalModel(
  value: unknown,
  path: string,
): ParseResult<ModelRef | null> {
  return value === null ? ok(null) : parseModelRef(value, path);
}

export function parseEngineFacts(
  input: unknown,
  path: string,
): ParseResult<EngineFacts> {
  return parseStrictRecord(
    input,
    path,
    [
      "runtime",
      "runtimeBinarySha256",
      "model",
      "loras",
      "encoder",
      "vae",
      "licences",
      "settings",
    ],
    (record) => {
      const runtime = parseRuntimeRef(record.runtime, `${path}.runtime`);
      if (!runtime.ok) return runtime;
      const binary = parseSha256(
        record.runtimeBinarySha256,
        `${path}.runtimeBinarySha256`,
      );
      if (!binary.ok) return binary;
      const model = parseModelRef(record.model, `${path}.model`);
      if (!model.ok) return model;
      const loras = parseArray(record.loras, `${path}.loras`, parseModelRef);
      if (!loras.ok) return loras;
      const encoder = parseOptionalModel(record.encoder, `${path}.encoder`);
      if (!encoder.ok) return encoder;
      const vae = parseOptionalModel(record.vae, `${path}.vae`);
      if (!vae.ok) return vae;
      const licences = parseArray(
        record.licences,
        `${path}.licences`,
        parseLicence,
      );
      if (!licences.ok) return licences;
      const settings = parseGenerationSettings(
        record.settings,
        `${path}.settings`,
      );
      if (!settings.ok) return settings;
      return ok({
        runtime: runtime.value,
        runtimeBinarySha256: binary.value,
        model: model.value,
        loras: loras.value,
        encoder: encoder.value,
        vae: vae.value,
        licences: licences.value,
        settings: settings.value,
      });
    },
  );
}

export const LICENCE_SOURCES = [
  "pinned-terms",
  "owner-assessment",
  "none",
] as const;
export const LICENCE_STATUSES = [
  "compatible",
  "incompatible",
  "unclear",
] as const;

/** The owner's own compatibility call for licence terms the studio does not know; not a legal clearance. */
export interface LicenceAssessment {
  readonly record: LicenceRecord;
  readonly disposition: "mit-compatible" | "incompatible";
  readonly reason: string;
}

export interface LicenceReviewEntry {
  readonly subject: string;
  readonly role: LicenceRecord["role"];
  readonly source: (typeof LICENCE_SOURCES)[number];
  readonly status: (typeof LICENCE_STATUSES)[number];
  readonly reason: string;
}

/** A packed asset as the studio keeps it: the contract record plus what its gates were measured against. */
export interface StudioAssetRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly workingSetId: string;
  readonly assetId: AssetId;
  /** The registry revision of this asset when it was packed, or null for a first revision. */
  readonly prior: Sha256 | null;
  readonly record: AssetRecord;
  /** The hash of the canonical text of the record's current manifest. */
  readonly manifestRevision: Sha256;
  readonly reportBasis: {
    readonly atlasHash: Sha256;
    readonly paletteDigest: Sha256;
  };
  readonly licenceReview: {
    readonly manifestRevision: Sha256;
    readonly entries: readonly LicenceReviewEntry[];
  };
  readonly licenceAssessments: readonly LicenceAssessment[];
  readonly published: { readonly revision: Sha256 } | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The record's own shape only. The manifest is checked against the content
 * vocabulary where it is used (pack, approve, publish), which a stored record
 * does not have at hand.
 */
function parseAssetState(
  value: unknown,
  path: string,
  assetId: AssetId,
): ParseResult<AssetRecord> {
  if (!isRecord(value)) return fail(path, "expected an object");
  const state = parseEnum(value.state, `${path}.state`, [
    "candidate",
    "draft",
    "approved",
    "canon",
    "rejected",
  ] as const);
  if (!state.ok) return state;
  const keys = {
    candidate: ["state", "manifest", "report"],
    draft: ["state", "manifest", "report", "edit", "edits"],
    approved: ["state", "manifest", "basis"],
    canon: ["state", "manifest", "basis"],
    rejected: ["state", "manifest", "rejectedFrom", "reason"],
  }[state.value];
  return parseStrictRecord<AssetRecord>(value, path, keys, (record) => {
    const manifest = record.manifest;
    if (
      !isRecord(manifest) ||
      manifest.id !== assetId ||
      !isRecord(manifest.atlas) ||
      !parseSha256(manifest.atlas.blob, `${path}.manifest.atlas.blob`).ok
    )
      return fail(`${path}.manifest`, `expected the manifest of "${assetId}"`);
    const body = { manifest: manifest as unknown as AssetManifest };
    if (state.value === "candidate") {
      const report = parseConformanceReport(record.report, `${path}.report`);
      if (!report.ok) return report;
      return ok({ state: "candidate", ...body, report: report.value });
    }
    if (state.value === "draft") {
      const edit = parseEnum(record.edit, `${path}.edit`, [
        "idle",
        "editing-externally",
      ] as const);
      if (!edit.ok) return edit;
      const edits = parseArray(record.edits, `${path}.edits`, (item, at) =>
        parseEnum(item, at, ["finished", "discarded"] as const),
      );
      if (!edits.ok) return edits;
      const parsed =
        record.report === undefined
          ? undefined
          : parseConformanceReport(record.report, `${path}.report`);
      if (parsed !== undefined && !parsed.ok) return parsed;
      return ok({
        state: "draft",
        ...body,
        ...(parsed === undefined ? {} : { report: parsed.value }),
        edit: edit.value,
        edits: edits.value,
      });
    }
    if (state.value === "rejected") {
      const from = parseEnum(record.rejectedFrom, `${path}.rejectedFrom`, [
        "candidate",
        "draft",
      ] as const);
      if (!from.ok) return from;
      if (record.reason === undefined)
        return ok({ state: "rejected", ...body, rejectedFrom: from.value });
      const reason = parseString(record.reason, `${path}.reason`);
      if (!reason.ok) return reason;
      return ok({
        state: "rejected",
        ...body,
        rejectedFrom: from.value,
        reason: reason.value,
      });
    }
    const basis = parseStrictRecord<ApprovalBasis>(
      record.basis,
      `${path}.basis`,
      ["type", "reason"],
      (item) => {
        const type = parseEnum(item.type, `${path}.basis.type`, [
          "report-pass",
          "owner-exception",
        ] as const);
        if (!type.ok) return type;
        if (type.value === "report-pass") {
          if (item.reason !== undefined)
            return fail(
              `${path}.basis.reason`,
              "a passing report has no reason",
            );
          return ok({ type: "report-pass" } as const);
        }
        const reason = parseString(item.reason, `${path}.basis.reason`);
        if (!reason.ok) return reason;
        return ok({ type: "owner-exception", reason: reason.value } as const);
      },
    );
    if (!basis.ok) return basis;
    return ok({ state: state.value, ...body, basis: basis.value });
  });
}

function parseAssessment(
  value: unknown,
  path: string,
): ParseResult<LicenceAssessment> {
  return parseStrictRecord(
    value,
    path,
    ["record", "disposition", "reason"],
    (item) => {
      const record = parseLicence(item.record, `${path}.record`);
      if (!record.ok) return record;
      const disposition = parseEnum(item.disposition, `${path}.disposition`, [
        "mit-compatible",
        "incompatible",
      ] as const);
      if (!disposition.ok) return disposition;
      const reason = parseString(item.reason, `${path}.reason`);
      if (!reason.ok) return reason;
      if (reason.value.trim() === "")
        return fail(`${path}.reason`, "expected a reason");
      return ok({
        record: record.value,
        disposition: disposition.value,
        reason: reason.value,
      });
    },
  );
}

function parseReviewEntry(
  value: unknown,
  path: string,
): ParseResult<LicenceReviewEntry> {
  return parseStrictRecord(
    value,
    path,
    ["subject", "role", "source", "status", "reason"],
    (item) => {
      const subject = parseString(item.subject, `${path}.subject`);
      if (!subject.ok) return subject;
      const role = parseEnum(item.role, `${path}.role`, LICENCE_ROLES);
      if (!role.ok) return role;
      const source = parseEnum(item.source, `${path}.source`, LICENCE_SOURCES);
      if (!source.ok) return source;
      const status = parseEnum(item.status, `${path}.status`, LICENCE_STATUSES);
      if (!status.ok) return status;
      const reason = parseString(item.reason, `${path}.reason`);
      if (!reason.ok) return reason;
      return ok({
        subject: subject.value,
        role: role.value,
        source: source.value,
        status: status.value,
        reason: reason.value,
      });
    },
  );
}

export function parseStudioAssetRecord(
  input: unknown,
  path = "asset",
): ParseResult<StudioAssetRecord> {
  return parseStrictRecord(
    input,
    path,
    [
      "schemaVersion",
      "id",
      "workingSetId",
      "assetId",
      "prior",
      "record",
      "manifestRevision",
      "reportBasis",
      "licenceReview",
      "licenceAssessments",
      "published",
    ],
    (record) => {
      const version = parseStudioVersion(record.schemaVersion, path);
      if (!version.ok) return version;
      const id = parseSlug(record.id, `${path}.id`);
      if (!id.ok) return id;
      const workingSetId = parseSlug(
        record.workingSetId,
        `${path}.workingSetId`,
      );
      if (!workingSetId.ok) return workingSetId;
      const assetId = parseAssetId(record.assetId, `${path}.assetId`);
      if (!assetId.ok) return assetId;
      const prior =
        record.prior === null
          ? ok(null)
          : parseSha256(record.prior, `${path}.prior`);
      if (!prior.ok) return prior;
      const asset = parseAssetState(
        record.record,
        `${path}.record`,
        assetId.value,
      );
      if (!asset.ok) return asset;
      const manifestRevision = parseSha256(
        record.manifestRevision,
        `${path}.manifestRevision`,
      );
      if (!manifestRevision.ok) return manifestRevision;
      const basis = parseStrictRecord(
        record.reportBasis,
        `${path}.reportBasis`,
        ["atlasHash", "paletteDigest"],
        (item) => {
          const atlasHash = parseSha256(
            item.atlasHash,
            `${path}.reportBasis.atlasHash`,
          );
          if (!atlasHash.ok) return atlasHash;
          const digest = parseSha256(
            item.paletteDigest,
            `${path}.reportBasis.paletteDigest`,
          );
          if (!digest.ok) return digest;
          return ok({
            atlasHash: atlasHash.value,
            paletteDigest: digest.value,
          });
        },
      );
      if (!basis.ok) return basis;
      const review = parseStrictRecord(
        record.licenceReview,
        `${path}.licenceReview`,
        ["manifestRevision", "entries"],
        (item) => {
          const revision = parseSha256(
            item.manifestRevision,
            `${path}.licenceReview.manifestRevision`,
          );
          if (!revision.ok) return revision;
          const entries = parseArray(
            item.entries,
            `${path}.licenceReview.entries`,
            parseReviewEntry,
          );
          if (!entries.ok) return entries;
          return ok({
            manifestRevision: revision.value,
            entries: entries.value,
          });
        },
      );
      if (!review.ok) return review;
      const assessments = parseArray(
        record.licenceAssessments,
        `${path}.licenceAssessments`,
        parseAssessment,
      );
      if (!assessments.ok) return assessments;
      const published =
        record.published === null
          ? ok(null)
          : parseStrictRecord(
              record.published,
              `${path}.published`,
              ["revision"],
              (item) => {
                const revision = parseSha256(
                  item.revision,
                  `${path}.published.revision`,
                );
                return revision.ok
                  ? ok({ revision: revision.value })
                  : revision;
              },
            );
      if (!published.ok) return published;
      return ok({
        schemaVersion: version.value,
        id: id.value,
        workingSetId: workingSetId.value,
        assetId: assetId.value,
        prior: prior.value,
        record: asset.value,
        manifestRevision: manifestRevision.value,
        reportBasis: basis.value,
        licenceReview: review.value,
        licenceAssessments: assessments.value,
        published: published.value,
      });
    },
  );
}
