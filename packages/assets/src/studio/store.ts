// The durable authoring store: JSON records written through a temp file and
// rename, plus content-addressed blobs. Reads never need the session lock;
// a malformed record is reported by file and never touches its neighbours.
// Durability scope: a process crash never leaves a half-written record. The
// writes are not fsynced, so power loss is not covered.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  fail,
  type GenerationJob,
  type GenerationRequest,
  ok,
  type ParseResult,
  parseEnum,
  parseGenerationJob,
  parseGenerationRequest,
  parseIntegerAtLeast,
  parseSlug,
  parseStrictRecord,
  parseString,
  type Sha256,
} from "@panthea/contracts";
import { sha256Hex } from "../hash";
import { type CandidateRecord, parseCandidateRecord } from "./candidates";
import { type EditRecord, parseEditRecord } from "./export-import";
import { parseWorkingSetRecord, type WorkingSetRecord } from "./working-set";
import {
  type EngineFacts,
  type JobSource,
  parseEngineFacts,
  parseJobSource,
  parseStudioAssetRecord,
  parseStudioVersion,
  type StudioAssetRecord,
  studioPaths,
} from "./workspace";

export const EDIT_FILES = [
  "sheet.png",
  "sheet.json",
  "workspace.aseprite",
] as const;
export type EditFileName = (typeof EDIT_FILES)[number];

export interface SessionRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly endedAt?: string;
}

export interface RequestRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  /** The root request; `seed` is the base seed every job's seed counts from. */
  readonly request: GenerationRequest;
  /** The ordinal the next expanded job takes. */
  readonly nextOrdinal: number;
}

export type { JobSource };

export interface JobRecord {
  readonly schemaVersion: 1;
  readonly source: JobSource;
  readonly job: GenerationJob;
  /** What ran the job; present exactly when the job succeeded. */
  readonly engine?: EngineFacts;
}

export const COMMAND_TYPES = [
  "enqueue",
  "start",
  "succeed",
  "fail",
  "unavailable",
  "remove",
  "abort",
  "pick",
  "open-edit",
  "finish-edit",
  "discard-edit",
  "pack",
  "approve",
  "publish",
  "reject",
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export interface CommandRecord {
  readonly schemaVersion: 1;
  readonly seq: number;
  readonly type: CommandType;
  readonly jobId: string;
  readonly at: string;
}

export interface StoreProblem {
  /** Path relative to the authoring root. */
  readonly file: string;
  readonly message: string;
}

export interface StudioStatus {
  readonly session: SessionRecord | undefined;
  readonly requests: readonly RequestRecord[];
  readonly jobs: readonly JobRecord[];
  readonly candidates: readonly CandidateRecord[];
  readonly workingSets: readonly WorkingSetRecord[];
  readonly edits: readonly EditRecord[];
  readonly assets: readonly StudioAssetRecord[];
  readonly commands: readonly CommandRecord[];
  readonly invalid: readonly StoreProblem[];
}

export type Read<T> =
  | { readonly kind: "found"; readonly value: T }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly message: string };

type Parse<T> = (input: unknown) => ParseResult<T>;

const parseSessionRecord: Parse<SessionRecord> = (input) =>
  parseStrictRecord(
    input,
    "session",
    ["schemaVersion", "id", "pid", "startedAt", "endedAt"],
    (record) => {
      const version = parseStudioVersion(record.schemaVersion, "session");
      if (!version.ok) return version;
      const id = parseString(record.id, "session.id");
      if (!id.ok) return id;
      const pid = parseIntegerAtLeast(record.pid, "session.pid", 1);
      if (!pid.ok) return pid;
      const startedAt = parseString(record.startedAt, "session.startedAt");
      if (!startedAt.ok) return startedAt;
      if (record.endedAt === undefined)
        return ok({
          schemaVersion: version.value,
          id: id.value,
          pid: pid.value,
          startedAt: startedAt.value,
        });
      const endedAt = parseString(record.endedAt, "session.endedAt");
      if (!endedAt.ok) return endedAt;
      return ok({
        schemaVersion: version.value,
        id: id.value,
        pid: pid.value,
        startedAt: startedAt.value,
        endedAt: endedAt.value,
      });
    },
  );

const parseRequestRecord: Parse<RequestRecord> = (input) =>
  parseStrictRecord(
    input,
    "requestRecord",
    ["schemaVersion", "id", "request", "nextOrdinal"],
    (record) => {
      const version = parseStudioVersion(record.schemaVersion, "requestRecord");
      if (!version.ok) return version;
      const nextOrdinal = parseIntegerAtLeast(
        record.nextOrdinal,
        "requestRecord.nextOrdinal",
        0,
      );
      if (!nextOrdinal.ok) return nextOrdinal;
      const id = parseSlug(record.id, "requestRecord.id");
      if (!id.ok) return id;
      const request = parseGenerationRequest(
        record.request,
        "requestRecord.request",
      );
      if (!request.ok) return request;
      return ok({
        schemaVersion: version.value,
        id: id.value,
        request: request.value,
        nextOrdinal: nextOrdinal.value,
      });
    },
  );

const parseJobRecord: Parse<JobRecord> = (input) =>
  parseStrictRecord<JobRecord>(
    input,
    "jobRecord",
    ["schemaVersion", "source", "job", "engine"],
    (record) => {
      const version = parseStudioVersion(record.schemaVersion, "jobRecord");
      if (!version.ok) return version;
      const source = parseJobSource(record.source, "jobRecord.source");
      if (!source.ok) return source;
      const job = parseGenerationJob(record.job, "jobRecord.job");
      if (!job.ok) return job;
      if (job.value.status !== "succeeded") {
        if (record.engine !== undefined)
          return fail(
            "jobRecord.engine",
            "only a succeeded job has engine facts",
          );
        return ok({
          schemaVersion: version.value,
          source: source.value,
          job: job.value,
        });
      }
      const engine = parseEngineFacts(record.engine, "jobRecord.engine");
      if (!engine.ok) return engine;
      return ok({
        schemaVersion: version.value,
        source: source.value,
        job: job.value,
        engine: engine.value,
      });
    },
  );

const parseCommandRecord: Parse<CommandRecord> = (input) =>
  parseStrictRecord(
    input,
    "command",
    ["schemaVersion", "seq", "type", "jobId", "at"],
    (record) => {
      const version = parseStudioVersion(record.schemaVersion, "command");
      if (!version.ok) return version;
      const seq = parseIntegerAtLeast(record.seq, "command.seq", 1);
      if (!seq.ok) return seq;
      const type = parseEnum(record.type, "command.type", COMMAND_TYPES);
      if (!type.ok) return type;
      const jobId = parseSlug(record.jobId, "command.jobId");
      if (!jobId.ok) return jobId;
      const at = parseString(record.at, "command.at");
      if (!at.ok) return at;
      return ok({
        schemaVersion: version.value,
        seq: seq.value,
        type: type.value,
        jobId: jobId.value,
        at: at.value,
      });
    },
  );

/** Writes through a sibling temp file and renames it into place. */
function writeAtomic(path: string, bytes: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(temp, bytes);
    renameSync(temp, path);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

const writeJson = (path: string, value: unknown) =>
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);

function readRecord<T>(path: string, parse: Parse<T>): Read<T> {
  if (!existsSync(path)) return { kind: "missing" };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { kind: "invalid", message: (error as Error).message };
  }
  const parsed = parse(json);
  return parsed.ok
    ? { kind: "found", value: parsed.value }
    : { kind: "invalid", message: `${parsed.path}: ${parsed.message}` };
}

export interface Store {
  readonly root: string;
  putSession(record: SessionRecord): void;
  putRequest(record: RequestRecord): void;
  putJob(record: JobRecord): void;
  putCandidate(record: CandidateRecord): void;
  putWorkingSet(record: WorkingSetRecord): void;
  putEdit(record: EditRecord): void;
  putAsset(record: StudioAssetRecord): void;
  /** Writes one of the three files an edit keeps beside its record. */
  putEditFile(id: string, name: EditFileName, bytes: Uint8Array): void;
  putCommand(record: CommandRecord): void;
  /** Stores bytes under their SHA-256; identical bytes are written once. */
  putBlob(bytes: Uint8Array): Sha256;
  readBlob(hash: Sha256): Uint8Array | undefined;
  readJob(id: string): Read<JobRecord>;
  readRequest(id: string): Read<RequestRecord>;
  readCandidate(id: string): Read<CandidateRecord>;
  readWorkingSet(id: string): Read<WorkingSetRecord>;
  readEdit(id: string): Read<EditRecord>;
  readAsset(id: string): Read<StudioAssetRecord>;
  readEditFile(id: string, name: EditFileName): Uint8Array | undefined;
  /** The highest sequence number in the command ledger, by file name. */
  lastCommandSeq(): number;
  status(): StudioStatus;
}

const commandFile = (seq: number) => `${String(seq).padStart(8, "0")}.json`;

export function openStore(root: string): Store {
  const paths = studioPaths(root);

  const list = <T>(dir: string, parse: Parse<T>, invalid: StoreProblem[]) => {
    if (!existsSync(dir)) return [];
    const values: T[] = [];
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      const read = readRecord(join(dir, name), parse);
      if (read.kind === "found") values.push(read.value);
      else if (read.kind === "invalid")
        invalid.push({
          file: relative(root, join(dir, name)),
          message: read.message,
        });
    }
    return values;
  };

  return {
    root,
    putSession: (record) => writeJson(paths.session, record),
    putRequest: (record) =>
      writeJson(join(paths.requests, `${record.id}.json`), record),
    putJob: (record) =>
      writeJson(join(paths.jobs, `${record.job.id}.json`), record),
    putCandidate: (record) =>
      writeJson(join(paths.candidates, `${record.id}.json`), record),
    putWorkingSet: (record) =>
      writeJson(join(paths.workingSets, `${record.id}.json`), record),
    putAsset: (record) =>
      writeJson(join(paths.assets, `${record.id}.json`), record),
    putEdit: (record) =>
      writeJson(join(paths.edits, `${record.id}.json`), record),
    putEditFile(id, name, bytes) {
      if (!parseSlug(id, "edit").ok || !EDIT_FILES.includes(name))
        throw new Error(`not an edit file: ${id}/${name}`);
      writeAtomic(join(paths.edits, id, name), bytes);
    },
    putCommand: (record) =>
      writeJson(join(paths.commands, commandFile(record.seq)), record),
    putBlob(bytes) {
      const hash = sha256Hex(bytes);
      const path = join(paths.blobs, `${hash}.png`);
      if (!existsSync(path)) writeAtomic(path, bytes);
      return hash;
    },
    readBlob(hash) {
      const path = join(paths.blobs, `${hash}.png`);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
    },
    readJob: (id) => readRecord(join(paths.jobs, `${id}.json`), parseJobRecord),
    readRequest: (id) =>
      readRecord(join(paths.requests, `${id}.json`), parseRequestRecord),
    readCandidate: (id) =>
      readRecord(join(paths.candidates, `${id}.json`), parseCandidateRecord),
    readAsset: (id) =>
      readRecord(join(paths.assets, `${id}.json`), parseStudioAssetRecord),
    readEdit: (id) =>
      readRecord(join(paths.edits, `${id}.json`), parseEditRecord),
    readEditFile(id, name) {
      if (!parseSlug(id, "edit").ok || !EDIT_FILES.includes(name))
        return undefined;
      const path = join(paths.edits, id, name);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
    },
    readWorkingSet: (id) =>
      readRecord(join(paths.workingSets, `${id}.json`), parseWorkingSetRecord),
    lastCommandSeq() {
      if (!existsSync(paths.commands)) return 0;
      return readdirSync(paths.commands)
        .map((name) => /^(\d+)\.json$/.exec(name)?.[1])
        .reduce((max, seq) => Math.max(max, seq ? Number(seq) : 0), 0);
    },
    status() {
      const invalid: StoreProblem[] = [];
      const session = readRecord(paths.session, parseSessionRecord);
      if (session.kind === "invalid")
        invalid.push({ file: "session.json", message: session.message });
      return {
        session: session.kind === "found" ? session.value : undefined,
        requests: list(paths.requests, parseRequestRecord, invalid),
        jobs: list(paths.jobs, parseJobRecord, invalid),
        candidates: list(paths.candidates, parseCandidateRecord, invalid),
        workingSets: list(paths.workingSets, parseWorkingSetRecord, invalid),
        edits: list(paths.edits, parseEditRecord, invalid),
        assets: list(paths.assets, parseStudioAssetRecord, invalid),
        commands: list(paths.commands, parseCommandRecord, invalid),
        invalid,
      };
    },
  };
}

/** Inspects the durable records without owning the session lock. */
export const readStudioStatus = (root: string): StudioStatus =>
  openStore(root).status();
