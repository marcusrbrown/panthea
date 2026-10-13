// The end capture of the unattended run and the numbers the ADR-0005 workload baseline records: the size of the store,
// its WAL and the exported archive; how long a rebuild from genesis and the event log takes, in a process that shares
// nothing with the writer, and whether it makes the projection the store holds live; and whether importing the archive
// into a scratch slot is accepted, which re-checks the archive's projection against its own log.
//
// A part that could not be captured (the run ended before the export, there was no store) is `missing` with the reason.
// It is never a failure of the run on its own account; the report's threshold table decides what a missing part means
// for the verdict. Nothing here names a path, a host or a user: the record is committed.

import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeStorePath } from "../../m1-living-world/src/world-db";
import type { ChildReading } from "./baseline-child";
import { formatJson } from "./json-format";

export { firstDifference } from "./baseline-compare";

/** One part of the capture: what was measured, or why it was not. */
export type Part<T> =
  | ({ readonly state: "captured" } & T)
  | { readonly state: "missing"; readonly reason: string };

export interface BaselineRecord {
  /** The live store's size and the WAL beside it, in bytes. */
  readonly store: Part<{ readonly bytes: number; readonly walBytes: number }>;
  readonly archive: Part<{
    readonly bytes: number;
    /** The last event sequence the archive holds, read from the file. */
    readonly eventSequence: number;
  }>;
  /** The rebuild from genesis and the event log, in a separate process, against the live projection. */
  readonly rebuild: Part<{
    readonly ms: number;
    readonly events: number;
    readonly equal: boolean;
    readonly liveDigest: string;
    readonly rebuiltDigest: string;
    readonly projectionBytes: number;
    readonly integrity: string;
    readonly firstDifference?: string;
    readonly process: "separate";
    readonly childPid: number;
  }>;
  /** Importing the archive into a scratch slot. */
  readonly importProof: Part<{
    readonly ok: boolean;
    readonly events?: number;
    readonly slotCreated: boolean;
    readonly refusal?: { readonly kind: string; readonly reason: string };
  }>;
}

/** Changes the working copies before the child reads them: the positive controls. */
export interface Tamper {
  readonly storeCopy?: (path: string) => void;
  readonly archive?: (path: string) => void;
}

export interface BaselineInput {
  readonly runDir: string;
  readonly dataDir: string;
  readonly archivePath: string;
  /** Why there is no archive, when the run ended before it could be exported. */
  readonly archiveMissingReason?: string;
  readonly tamper?: Tamper;
}

const CHILD = join(import.meta.dir, "baseline-child.ts");

const sizeOf = (path: string): number => statSync(path).size;

/** `text` with every given path replaced, so an error message never carries a temporary directory or a user name. */
function scrub(text: string, paths: readonly string[]): string {
  let out = text;
  for (const path of paths) out = out.split(path).join("<path>");
  return out
    .replace(/\/(?:Users|home|private|var|tmp)\/[^\s"':,)]+/g, "<path>")
    .slice(0, 300);
}

/** The last event sequence in an archive file, read without importing it. */
function archiveEventSequence(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    const row = db.query("SELECT MAX(sequence) AS m FROM events").get() as {
      m: number | null;
    };
    return row.m ?? 0;
  } finally {
    db.close();
  }
}

/** Runs the child over the working copies and returns what it printed, or why it printed nothing usable. */
async function runChild(
  args: readonly string[],
  scrubbed: readonly string[],
): Promise<{ reading: ChildReading } | { error: string }> {
  const child = Bun.spawn([process.execPath, CHILD, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const line = stdout.trim().split("\n").at(-1) ?? "";
  if (code !== 0 || line === "") {
    return {
      error: `the rebuild process exited ${code}: ${scrub(stderr.trim().split("\n").at(-1) ?? "no output", scrubbed)}`,
    };
  }
  try {
    return { reading: JSON.parse(line) as ChildReading };
  } catch {
    return { error: "the rebuild process printed something that is not JSON" };
  }
}

/**
 * Captures the baseline from a stopped (or killed) run. Copies the store and its WAL into a scratch directory, has a child
 * process rebuild and compare the copy and import the archive, writes `baseline.json` beside the run, and removes the
 * scratch directory. Never throws for a part it cannot take.
 */
export async function captureBaseline(
  input: BaselineInput,
): Promise<BaselineRecord> {
  const storePath = activeStorePath(input.dataDir);
  const walPath = `${storePath}-wal`;
  const work = mkdtempSync(join(tmpdir(), "panthea-baseline-"));
  const scrubbed = [work, input.runDir, input.dataDir];

  try {
    let store: BaselineRecord["store"];
    if (existsSync(storePath)) {
      store = {
        state: "captured",
        bytes: sizeOf(storePath),
        walBytes: existsSync(walPath) ? sizeOf(walPath) : 0,
      };
    } else {
      store = { state: "missing", reason: "there is no store" };
    }

    let archive: BaselineRecord["archive"];
    if (existsSync(input.archivePath)) {
      try {
        archive = {
          state: "captured",
          bytes: sizeOf(input.archivePath),
          eventSequence: archiveEventSequence(input.archivePath),
        };
      } catch (error) {
        archive = {
          state: "missing",
          reason: `the archive could not be read: ${scrub(error instanceof Error ? error.message : String(error), scrubbed)}`,
        };
      }
    } else {
      archive = {
        state: "missing",
        reason: input.archiveMissingReason ?? "no archive was exported",
      };
    }

    const args: string[] = [];
    let copy: string | undefined;
    if (store.state === "captured") {
      const copyDir = join(work, "store");
      mkdirSync(copyDir, { recursive: true });
      copy = join(copyDir, "world.sqlite");
      copyFileSync(storePath, copy);
      if (existsSync(walPath)) copyFileSync(walPath, `${copy}-wal`);
      input.tamper?.storeCopy?.(copy);
      args.push("--store", copy);
    }
    let archiveCopy: string | undefined;
    if (archive.state === "captured") {
      archiveCopy = join(work, "archive.sqlite");
      copyFileSync(input.archivePath, archiveCopy);
      input.tamper?.archive?.(archiveCopy);
      args.push("--archive", archiveCopy, "--scratch", join(work, "slots"));
    }

    let rebuild: BaselineRecord["rebuild"] = {
      state: "missing",
      reason: "there is no store to rebuild",
    };
    let importProof: BaselineRecord["importProof"] = {
      state: "missing",
      reason: "there is no archive to import",
    };

    if (copy === undefined && archiveCopy !== undefined) {
      // No store, but an archive: the import still has something to prove.
      args.unshift("--store", join(work, "absent.sqlite"));
    }
    if (args.length > 0) {
      const ran = await runChild(args, scrubbed);
      if ("error" in ran) {
        const reason = ran.error;
        if (copy !== undefined) rebuild = { state: "missing", reason };
        if (archiveCopy !== undefined) {
          importProof = { state: "missing", reason };
        }
      } else {
        const { reading } = ran;
        if (copy !== undefined) {
          rebuild =
            reading.rebuild === undefined
              ? {
                  state: "missing",
                  reason: `the rebuild could not be taken: ${scrub(reading.rebuildError ?? "no reading", scrubbed)}`,
                }
              : {
                  state: "captured",
                  ...reading.rebuild,
                  process: "separate",
                  childPid: reading.childPid,
                };
        }
        if (archiveCopy !== undefined) {
          importProof =
            reading.importProof === undefined
              ? {
                  state: "missing",
                  reason: `the import could not be taken: ${scrub(reading.importError ?? "no reading", scrubbed)}`,
                }
              : {
                  state: "captured",
                  ...reading.importProof,
                  ...(reading.importProof.refusal === undefined
                    ? {}
                    : {
                        refusal: {
                          kind: reading.importProof.refusal.kind,
                          reason: scrub(
                            reading.importProof.refusal.reason,
                            scrubbed,
                          ),
                        },
                      }),
                };
        }
      }
    }

    const record: BaselineRecord = { store, archive, rebuild, importProof };
    writeFileSync(join(input.runDir, "baseline.json"), formatJson(record));
    return record;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export interface ArchiveExport {
  readonly eventSequence: number;
}

/** What the end capture needs of a running sidecar: the HTTP API. */
export interface Requester {
  request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
}

/** Pauses the world so its history stops moving, then exports its archive to `archivePath`. */
export async function exportForBaseline(
  world: Requester,
  archivePath: string,
): Promise<ArchiveExport> {
  const paused = await world.request("POST", "/pause");
  if (paused.status !== 200) {
    throw new Error(`pause answered ${paused.status}`);
  }
  const exported = await world.request("POST", "/export", {
    path: archivePath,
  });
  if (exported.status !== 200) {
    throw new Error(`export answered ${exported.status}`);
  }
  const manifest = (exported.body as { manifest?: { eventSequence?: unknown } })
    .manifest;
  if (typeof manifest?.eventSequence !== "number") {
    throw new Error("export answered without a manifest");
  }
  return { eventSequence: manifest.eventSequence };
}
