// The separate process of the end capture. It opens a copy of the run's store, which shares nothing with the writer,
// rebuilds the projection from the store's own genesis row and event log, times that, and compares the canonical JSON
// of the rebuilt projection with the one the store holds live. If given an archive it also imports it into a scratch
// slot, which re-checks the archive's projection against its own event log. It prints one JSON line and exits 0 whether
// or not the two projections are equal; a non-zero exit means it could not measure.
//
//   bun baseline-child.ts --store <copy> [--archive <file> --scratch <dir>]

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import {
  closeStore,
  getCurrentSequence,
  ImportError,
  importArchive,
  openStore,
  type ProjectionReducers,
  readClock,
  readLiveProjections,
  rebuildProjections,
} from "@panthea/persistence";
import type { WorldState } from "@panthea/world";
import {
  restoreWorldTime,
  worldImportReducers,
  worldProjectionCodec,
} from "../../../../apps/simulation/src/world-store";
import { canonicalJson } from "../../m1-living-world/src/helpers";
import { firstDifference } from "./baseline-compare";

export interface RebuildReading {
  readonly ms: number;
  readonly events: number;
  readonly equal: boolean;
  readonly liveDigest: string;
  readonly rebuiltDigest: string;
  readonly projectionBytes: number;
  readonly integrity: string;
  readonly firstDifference?: string;
}

export interface ImportReading {
  readonly ok: boolean;
  readonly events?: number;
  readonly slotCreated: boolean;
  readonly refusal?: { readonly kind: string; readonly reason: string };
}

/** What the child measured: each part is its reading, or why it could not be taken. */
export interface ChildReading {
  readonly childPid: number;
  readonly rebuild?: RebuildReading;
  readonly rebuildError?: string;
  readonly importProof?: ImportReading;
  readonly importError?: string;
}

const sha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** Rebuilds the projection of the store at `path` from its genesis and log, times it, and compares it with the live one. */
export function rebuildAndCompare(path: string): RebuildReading {
  if (!existsSync(path)) throw new Error("there is no store at the path");
  // An existing store keeps its own genesis row; the genesis argument is only used to create one.
  const genesis = { initial: undefined as never, codec: worldProjectionCodec };
  const store = openStore(path, genesis);
  const reducers = {
    ...worldImportReducers,
    initial: genesis.initial,
  } as unknown as ProjectionReducers<WorldState>;
  try {
    const integrity = (
      store.db.query("PRAGMA integrity_check").get() as {
        integrity_check: string;
      }
    ).integrity_check;
    const clock = readClock(store.db);
    const events = getCurrentSequence(store.db);
    const live = restoreWorldTime(readLiveProjections(store, reducers), clock);
    const started = performance.now();
    const rebuiltRaw = rebuildProjections(store, reducers);
    const ms = performance.now() - started;
    const rebuilt = restoreWorldTime(rebuiltRaw, clock);
    const liveEncoded = worldProjectionCodec.encode(live);
    const rebuiltEncoded = worldProjectionCodec.encode(rebuilt);
    const liveText = canonicalJson(liveEncoded);
    const rebuiltText = canonicalJson(rebuiltEncoded);
    const equal = liveText === rebuiltText;
    const difference = equal
      ? undefined
      : firstDifference(liveEncoded, rebuiltEncoded);
    return {
      ms: Math.max(Math.round(ms * 100) / 100, 0.01),
      events,
      equal,
      liveDigest: sha256(liveText),
      rebuiltDigest: sha256(rebuiltText),
      projectionBytes: Buffer.byteLength(liveText),
      integrity,
      ...(difference === undefined ? {} : { firstDifference: difference }),
    };
  } finally {
    closeStore(store);
  }
}

/** Imports the archive at `archivePath` into a fresh slot under `scratch`, and reports whether it was taken or why it was refused. */
export function proveImport(
  archivePath: string,
  scratch: string,
): ImportReading {
  mkdirSync(scratch, { recursive: true });
  try {
    const result = importArchive(archivePath, scratch, worldImportReducers);
    return {
      ok: true,
      events: result.manifest.eventSequence,
      slotCreated: true,
    };
  } catch (error) {
    if (error instanceof ImportError) {
      const slots = readdirSync(scratch).filter((name) =>
        name.startsWith("slot-"),
      );
      return {
        ok: false,
        slotCreated: slots.length > 0,
        refusal: { kind: error.kind, reason: error.message },
      };
    }
    throw error;
  }
}

function main(argv: readonly string[]): void {
  const arg = (name: string): string | undefined => {
    const at = argv.indexOf(name);
    return at < 0 ? undefined : argv[at + 1];
  };
  const store = arg("--store");
  if (store === undefined)
    throw new Error("baseline-child: --store is required");
  const archive = arg("--archive");
  const scratch = arg("--scratch");
  const failure = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);
  let rebuild: RebuildReading | undefined;
  let rebuildError: string | undefined;
  try {
    rebuild = rebuildAndCompare(store);
  } catch (error) {
    rebuildError = failure(error);
  }
  let importProof: ImportReading | undefined;
  let importError: string | undefined;
  if (archive !== undefined && scratch !== undefined) {
    try {
      importProof = proveImport(archive, scratch);
    } catch (error) {
      importError = failure(error);
    }
  }
  const reading: ChildReading = {
    childPid: process.pid,
    ...(rebuild === undefined ? {} : { rebuild }),
    ...(rebuildError === undefined ? {} : { rebuildError }),
    ...(importProof === undefined ? {} : { importProof }),
    ...(importError === undefined ? {} : { importError }),
  };
  process.stdout.write(`${JSON.stringify(reading)}\n`);
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `baseline-child: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
