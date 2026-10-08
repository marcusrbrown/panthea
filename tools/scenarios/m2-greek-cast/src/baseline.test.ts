// The end capture on a real short world: a store written by the apps' own tick, an archive exported by the
// persistence package, and a child process that rebuilds the copy. No sidecar and no model are involved.

import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkpoint,
  closeStore,
  computeContentHash,
  exportArchive,
  getCurrentSequence,
  openStore,
} from "@panthea/persistence";
import { ensureTraceSchema } from "@panthea/telemetry";
import { createPrng } from "@panthea/world";
import {
  applyOneTick,
  buildRoutineQueue,
} from "../../../../apps/simulation/src/tick";
import {
  createWorldProjectionReducers,
  loadGreekWorldState,
} from "../../../../apps/simulation/src/world-store";
import {
  type BaselineRecord,
  captureBaseline,
  exportForBaseline,
  firstDifference,
} from "./baseline";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

interface WorldOnDisk {
  readonly runDir: string;
  readonly dataDir: string;
  readonly storePath: string;
  readonly archivePath: string;
  readonly events: number;
}

/** A real store of `ticks` ticks of the authored town's routines, with an archive exported at its last sequence. */
function worldOnDisk(
  ticks: number,
  options: { readonly closeCleanly?: boolean; readonly export?: boolean } = {},
): WorldOnDisk {
  const runDir = tempDir("panthea-baseline-");
  const dataDir = join(runDir, "app-data");
  const storePath = join(dataDir, "active", "world.sqlite");
  const archivePath = join(runDir, "archive.sqlite");
  mkdirSync(join(dataDir, "active"), { recursive: true });
  const seed = loadGreekWorldState();
  const reducers = createWorldProjectionReducers(seed);
  const store = openStore(storePath, reducers);
  ensureTraceSchema(store.db);
  let state = seed;
  let prng = createPrng(1);
  for (let tick = 1; tick <= ticks; tick += 1) {
    const step = applyOneTick(
      state,
      prng,
      buildRoutineQueue(state),
      { store, reducers, traceDb: store.db },
      { cursorWallMs: tick * 1_000, paused: false },
    );
    if (step.kind !== "committed")
      throw new Error(`tick ${tick}: ${step.message}`);
    state = step.state;
    prng = step.prng;
  }
  const events = getCurrentSequence(store.db);
  if (options.export !== false) exportArchive(store, archivePath);
  if (options.closeCleanly === false) {
    // The store stays open with its WAL unchecked: what a killed sidecar leaves behind.
    return { runDir, dataDir, storePath, archivePath, events };
  }
  checkpoint(store);
  closeStore(store);
  return { runDir, dataDir, storePath, archivePath, events };
}

const bytesOf = (path: string): number => statSync(path).size;

// --- The happy path ---------------------------------------------------------------------------

test("on a short real world the rebuilt projection equals the live one, in a separate process, and the bytes, time and event count are recorded", async () => {
  const world = worldOnDisk(30);
  const before = readFileSync(world.storePath);

  const record = await captureBaseline({
    runDir: world.runDir,
    dataDir: world.dataDir,
    archivePath: world.archivePath,
  });

  expect(record.store).toMatchObject({ state: "captured" });
  expect(record.store.state === "captured" && record.store.bytes).toBe(
    bytesOf(world.storePath),
  );
  expect(record.archive).toMatchObject({
    state: "captured",
    eventSequence: world.events,
  });
  expect(record.archive.state === "captured" && record.archive.bytes).toBe(
    bytesOf(world.archivePath),
  );

  expect(record.rebuild.state).toBe("captured");
  if (record.rebuild.state !== "captured") return;
  expect(record.rebuild.equal).toBe(true);
  expect(record.rebuild.events).toBe(world.events);
  expect(record.rebuild.events).toBeGreaterThan(30);
  expect(record.rebuild.ms).toBeGreaterThan(0);
  expect(Number.isFinite(record.rebuild.ms)).toBe(true);
  expect(record.rebuild.liveDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(record.rebuild.rebuiltDigest).toBe(record.rebuild.liveDigest);
  expect(record.rebuild.projectionBytes).toBeGreaterThan(1_000);
  expect(record.rebuild.integrity).toBe("ok");
  expect(record.rebuild.firstDifference).toBeUndefined();
  expect(record.rebuild.process).toBe("separate");
  expect(record.rebuild.childPid).not.toBe(process.pid);

  expect(record.importProof).toMatchObject({
    state: "captured",
    ok: true,
    events: world.events,
  });

  // It worked on a copy: the live store is as it was.
  expect(readFileSync(world.storePath).equals(before)).toBe(true);
});

test("the store's WAL is copied with it: a store a killed sidecar left with its WAL unchecked rebuilds to every event", async () => {
  const world = worldOnDisk(25, { closeCleanly: false });
  const walPath = `${world.storePath}-wal`;
  expect(existsSync(walPath)).toBe(true);
  expect(bytesOf(walPath)).toBeGreaterThan(0);

  const record = await captureBaseline({
    runDir: world.runDir,
    dataDir: world.dataDir,
    archivePath: world.archivePath,
  });

  expect(record.store).toMatchObject({
    state: "captured",
    walBytes: bytesOf(walPath),
  });
  expect(record.rebuild).toMatchObject({
    state: "captured",
    equal: true,
    events: world.events,
  });
});

test("the record names no path, host or user: only sizes, a time, a count and digests", async () => {
  const world = worldOnDisk(15);
  const record = await captureBaseline({
    runDir: world.runDir,
    dataDir: world.dataDir,
    archivePath: world.archivePath,
  });
  const text = JSON.stringify(record);
  expect(text).not.toContain(world.runDir);
  expect(text).not.toContain(tmpdir());
  expect(text).not.toContain("/Users/");
  expect(text).not.toContain("world.sqlite");
});

// --- The positive controls -------------------------------------------------------------------

/** Alters one event row's payload in place, keeping the row's own columns, so the log still parses. */
function alterOneEvent(path: string, rowMatching: string): number {
  const db = new Database(path);
  try {
    const row = db
      .query(
        `SELECT sequence, payload FROM events WHERE kind = '${rowMatching}' ORDER BY sequence ASC LIMIT 1`,
      )
      .get() as { sequence: number; payload: string } | null;
    if (row === null) throw new Error(`no ${rowMatching} event to alter`);
    const payload = JSON.parse(row.payload) as { amount: number };
    payload.amount += 3;
    db.run("UPDATE events SET payload = ? WHERE sequence = ?", [
      JSON.stringify(payload),
      row.sequence,
    ]);
    return row.sequence;
  } finally {
    db.close();
  }
}

/** The kind of event the routines emit that carries an `amount` the projection depends on. */
function kindWithAmount(path: string): string {
  // Read-write: a cleanly stopped WAL store cannot be opened read-only without its -shm file.
  const db = new Database(path);
  try {
    const row = db
      .query(
        "SELECT kind FROM events WHERE json_extract(payload, '$.amount') IS NOT NULL ORDER BY sequence ASC LIMIT 1",
      )
      .get() as { kind: string } | null;
    if (row === null) throw new Error("no event with an amount");
    return row.kind;
  } finally {
    db.close();
  }
}

test("positive control: a store copy with one event row altered rebuilds to something else, and the record says unequal and where", async () => {
  const world = worldOnDisk(30);
  const kind = kindWithAmount(world.storePath);

  const record = await captureBaseline({
    runDir: world.runDir,
    dataDir: world.dataDir,
    archivePath: world.archivePath,
    tamper: { storeCopy: (path) => alterOneEvent(path, kind) },
  });

  expect(record.rebuild.state).toBe("captured");
  if (record.rebuild.state !== "captured") return;
  expect(record.rebuild.equal).toBe(false);
  expect(record.rebuild.rebuiltDigest).not.toBe(record.rebuild.liveDigest);
  expect(record.rebuild.firstDifference).toBeDefined();
  expect(record.rebuild.firstDifference).not.toBe("");
  // The archive was not touched, so the import proof still holds: the two proofs are independent.
  expect(record.importProof).toMatchObject({ state: "captured", ok: true });
});

test("positive control: an archive with one event row altered and its content hash recomputed is refused on import, for a reason about the event log, and creates no slot", async () => {
  const world = worldOnDisk(30);
  const kind = kindWithAmount(world.storePath);

  const record = await captureBaseline({
    runDir: world.runDir,
    dataDir: world.dataDir,
    archivePath: world.archivePath,
    tamper: {
      archive: (path) => {
        alterOneEvent(path, kind);
        const db = new Database(path);
        try {
          const manifest = db
            .query("SELECT * FROM manifest WHERE id = 1")
            .get() as {
            format_version: number;
            sqlite_schema_version: number;
            payload_schema_version: number;
            world_id: string;
            event_sequence: number;
          };
          db.run("UPDATE manifest SET content_hash = ?", [
            computeContentHash(db, {
              formatVersion: manifest.format_version,
              sqliteSchemaVersion: manifest.sqlite_schema_version,
              payloadSchemaVersion: manifest.payload_schema_version,
              worldId: manifest.world_id as never,
              eventSequence: manifest.event_sequence,
            }),
          ]);
        } finally {
          db.close();
        }
      },
    },
  });

  expect(record.importProof.state).toBe("captured");
  if (record.importProof.state !== "captured") return;
  expect(record.importProof.ok).toBe(false);
  expect(record.importProof.slotCreated).toBe(false);
  expect(record.importProof.refusal?.kind).toBe("corrupt");
  expect(record.importProof.refusal?.reason).toContain("event log");
  // The store was untouched, so the rebuild proof still holds.
  expect(record.rebuild).toMatchObject({ state: "captured", equal: true });
});

test("control for the control: a byte changed in the archive without recomputing the hash is refused for the hash, not the event log", async () => {
  const world = worldOnDisk(20);
  const kind = kindWithAmount(world.storePath);
  const record = await captureBaseline({
    runDir: world.runDir,
    dataDir: world.dataDir,
    archivePath: world.archivePath,
    tamper: { archive: (path) => alterOneEvent(path, kind) },
  });
  expect(record.importProof).toMatchObject({
    state: "captured",
    ok: false,
    refusal: { kind: "inconsistent-manifest" },
  });
  const reason =
    record.importProof.state === "captured"
      ? record.importProof.refusal?.reason
      : "";
  expect(reason).toContain("content hash");
  expect(reason).not.toContain("genesis and event log");
});

// --- Runs that ended early --------------------------------------------------------------------

test("a run that ended before its export still captures the store and its rebuild, and marks the archive and the import missing with the reason, not failed", async () => {
  const world = worldOnDisk(20, { export: false });

  const record = await captureBaseline({
    runDir: world.runDir,
    dataDir: world.dataDir,
    archivePath: world.archivePath,
    archiveMissingReason: "the run ended before the export",
  });

  expect(record.store.state).toBe("captured");
  expect(record.rebuild).toMatchObject({ state: "captured", equal: true });
  expect(record.archive).toEqual({
    state: "missing",
    reason: "the run ended before the export",
  });
  expect(record.importProof).toEqual({
    state: "missing",
    reason: "there is no archive to import",
  });
});

test("a run with no store at all marks every part missing, each with its reason, and does not throw", async () => {
  const runDir = tempDir("panthea-baseline-empty-");
  const record = await captureBaseline({
    runDir,
    dataDir: join(runDir, "app-data"),
    archivePath: join(runDir, "archive.sqlite"),
  });
  for (const part of [
    record.store,
    record.archive,
    record.rebuild,
    record.importProof,
  ]) {
    expect(part.state).toBe("missing");
    expect(part.state === "missing" && part.reason.length).toBeGreaterThan(5);
  }
  expect(record.rebuild).toMatchObject({
    reason: "there is no store to rebuild",
  });
});

test("a store the child cannot open is a missing rebuild with the child's account, not a thrown error", async () => {
  const world = worldOnDisk(10);
  const record = await captureBaseline({
    runDir: world.runDir,
    dataDir: world.dataDir,
    archivePath: world.archivePath,
    tamper: {
      storeCopy: (path) => {
        const db = new Database(path);
        db.run("DROP TABLE genesis");
        db.close();
      },
    },
  });
  expect(record.rebuild.state).toBe("missing");
  expect(record.rebuild.state === "missing" && record.rebuild.reason).toContain(
    "rebuild",
  );
  expect(record.store.state).toBe("captured");
});

// --- Writing the evidence ---------------------------------------------------------------------

test("the record is written beside the run as baseline.json and equals the returned record", async () => {
  const world = worldOnDisk(10);
  const record = await captureBaseline({
    runDir: world.runDir,
    dataDir: world.dataDir,
    archivePath: world.archivePath,
  });
  const written = JSON.parse(
    readFileSync(join(world.runDir, "baseline.json"), "utf8"),
  ) as BaselineRecord;
  expect(written).toEqual(JSON.parse(JSON.stringify(record)));
});

test("the working copy is removed after the capture: the run folder gains only baseline.json", async () => {
  const world = worldOnDisk(10);
  const before = new Set(readdirSync(world.runDir));
  await captureBaseline({
    runDir: world.runDir,
    dataDir: world.dataDir,
    archivePath: world.archivePath,
  });
  const after = new Set(readdirSync(world.runDir));
  expect([...after].filter((name) => !before.has(name))).toEqual([
    "baseline.json",
  ]);
});

// --- Exporting from the live world ------------------------------------------------------------

test("the export pauses the world, then asks it to export to the path, and returns the manifest's sequence; a refusal at either step is an error that names it", async () => {
  const calls: string[] = [];
  const world = {
    async request(method: "GET" | "POST", path: string, body?: unknown) {
      calls.push(`${method} ${path} ${JSON.stringify(body ?? null)}`);
      return path === "/export"
        ? {
            status: 200,
            body: {
              manifest: { eventSequence: 77, worldId: "w", contentHash: "h" },
            },
          }
        : { status: 200, body: {} };
    },
  };
  const exported = await exportForBaseline(world, "/runs/a/archive.sqlite");
  expect(calls).toEqual([
    "POST /pause null",
    'POST /export {"path":"/runs/a/archive.sqlite"}',
  ]);
  expect(exported).toEqual({ eventSequence: 77 });

  await expect(
    exportForBaseline(
      {
        request: async (_m, path) => ({
          status: path === "/pause" ? 500 : 200,
          body: "no",
        }),
      },
      "/x",
    ),
  ).rejects.toThrow(/pause/);
  await expect(
    exportForBaseline(
      {
        request: async (_m, path) => ({
          status: path === "/export" ? 500 : 200,
          body: "no",
        }),
      },
      "/x",
    ),
  ).rejects.toThrow(/export/);
});

// --- The first difference ---------------------------------------------------------------------

test("firstDifference names the first path where two JSON values differ, and nothing when they are equal", () => {
  expect(
    firstDifference(
      { a: 1, b: [1, 2, { c: 3 }] },
      { a: 1, b: [1, 2, { c: 3 }] },
    ),
  ).toBeUndefined();
  expect(firstDifference({ a: 1 }, { a: 2 })).toBe("a");
  expect(
    firstDifference({ a: { b: [1, 2, 3] } }, { a: { b: [1, 2, 4] } }),
  ).toBe("a.b[2]");
  expect(firstDifference({ a: [1] }, { a: [1, 2] })).toBe("a[1]");
  expect(firstDifference({ a: 1 }, { a: 1, z: 2 })).toBe("z");
  expect(firstDifference([1], { a: 1 })).toBe("");
  // Keys are compared in sorted order whatever their order in the object.
  expect(firstDifference({ b: 1, a: 1 }, { a: 2, b: 2 })).toBe("a");
});
