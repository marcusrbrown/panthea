// The per-world SQLite store: WAL journal with macOS persistent-WAL
// disabled, STRICT tables, and one IMMEDIATE transaction per tick that
// commits events + projections + clock cursor + PRNG state atomically.
//
// packages/world owns event reducers and projection definitions and never
// depends on SQLite; this module owns transactions, storage, and
// projection application/rebuild by calling an injected reducer. It never
// imports packages/world. Persistence stores the projection shape as a
// single opaque JSON document via the caller's `ProjectionCodec`.

import { constants, Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { WorldId } from "@panthea/contracts";
import { createWorldId, type WorldEvent } from "@panthea/contracts";
import type { PersistedClockState } from "./clock";

export const CURRENT_SCHEMA_VERSION = 7;

/** Creates every STRICT table the store owns and stamps `user_version`. */
export function createSchema(db: Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE world (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        world_id TEXT NOT NULL
      ) STRICT
    `);
    db.exec(`
      CREATE TABLE clock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor_wall_ms INTEGER NOT NULL,
        paused INTEGER NOT NULL,
        tick INTEGER NOT NULL,
        sim_time_ms INTEGER NOT NULL
      ) STRICT
    `);
    db.exec(`
      CREATE TABLE prng_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL
      ) STRICT
    `);
    db.exec(`
      CREATE TABLE genesis (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL
      ) STRICT
    `);
    db.exec(`
      CREATE TABLE projections (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL,
        data TEXT NOT NULL
      ) STRICT
    `);
    db.exec(`
      CREATE TABLE events (
        sequence INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        correlation_id TEXT NOT NULL,
        causation_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        approximate INTEGER NOT NULL,
        payload TEXT NOT NULL
      ) STRICT
    `);
    // Every external (fixture or operator) proposal accepted over
    // /proposals, in the order it arrived. Written by intake, consumed by
    // the tick that runs it; kept afterwards (see journal.ts).
    db.exec(`
      CREATE TABLE external_proposals (
        input_order INTEGER PRIMARY KEY,
        proposal_id TEXT NOT NULL UNIQUE,
        target_tick INTEGER NOT NULL,
        proposal TEXT NOT NULL,
        observation TEXT NOT NULL,
        consumed_tick INTEGER,
        outcome TEXT CHECK (outcome IN ('committed', 'rejected')),
        reason TEXT,
        -- A row is pending (no consuming tick, no outcome) or consumed with
        -- its terminal outcome; a rejection always names its reason.
        CHECK ((consumed_tick IS NULL) = (outcome IS NULL)),
        CHECK ((outcome IS 'rejected') = (reason IS NOT NULL))
      ) STRICT
    `);
    // Finds the journaled proposals citing an observation id, so intake can
    // refuse a changed observation under a used id.
    db.exec(`
      CREATE INDEX idx_external_proposals_observation_id
      ON external_proposals (json_extract(observation, '$.id'))
    `);
    // Serves each tick's pending read (unconsumed, target reached, in input
    // order) without walking the consumed history, which is never pruned.
    db.exec(`
      CREATE INDEX idx_external_proposals_pending
      ON external_proposals (input_order) WHERE consumed_tick IS NULL
    `);
    // At most one row, present from a catch-up backlog's first commit until
    // the backlog is closed (its summary persisted, in the same transaction). Written in the same
    // transaction as the discard or chunk it describes, so a restart
    // resumes from exactly what committed. `start_sequence` is the last
    // event sequence before the backlog began: the backlog's notable
    // outcomes are the events committed after it. `summary_id` is the id of
    // the summary this backlog has already persisted as a degraded partial,
    // if any: it is what ties a persisted summary to the backlog that
    // produced it, and it goes away with the row when the backlog closes.
    db.exec(`
      CREATE TABLE catch_up_progress (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        applied_ms INTEGER NOT NULL,
        discarded_ms INTEGER NOT NULL,
        start_sequence INTEGER NOT NULL,
        summary_id TEXT CHECK (summary_id IS NULL OR summary_id <> '')
      ) STRICT
    `);
    // The latest catch-up summary the service has delivered, kept apart from
    // the progress on purpose: progress is the open backlog's working state,
    // cleared when the backlog closes, while the summary is what a client is
    // shown and must outlive that. It is written in the transaction that
    // closes a backlog (or that records a degraded partial one), never
    // before, so a summary that was exposed is always one that survives a
    // kill. `summary_id` is the service-minted identity a client
    // acknowledges; `at_sequence` freezes the outcomes at the backlog's
    // committed ending sequence.
    db.exec(`
      CREATE TABLE catch_up_summary (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        summary_id TEXT NOT NULL CHECK (summary_id <> ''),
        at_sequence INTEGER NOT NULL CHECK (at_sequence >= 0),
        applied_ms INTEGER NOT NULL CHECK (applied_ms >= 0),
        skipped_ms INTEGER NOT NULL CHECK (skipped_ms >= 0),
        major_outcomes TEXT NOT NULL CHECK (
          CASE WHEN json_valid(major_outcomes)
            THEN json_type(major_outcomes) = 'array'
            ELSE 0 END
        )
      ) STRICT
    `);
    db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
  }).immediate();
}

/**
 * Returns whether `db` is a brand-new (version 0) file that needs its
 * schema created, and throws for any other version than this build's. Reads
 * only: a mismatched file is never migrated, reset, or otherwise touched.
 */
function needsSchema(db: Database): boolean {
  const current = (
    db.query("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
  if (current === 0) {
    return true;
  }
  if (current !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `store: schema version ${current} does not match the version this build understands (${CURRENT_SCHEMA_VERSION}); this build never migrates or resets a store, so move the file aside to start a new world`,
    );
  }
  return false;
}

/**
 * Converts `TProjections` to and from the JSON-safe value persistence
 * actually stores. Required because a shape carrying `Map`/`Set` values
 * needs an explicit encoding -- plain `JSON.stringify` silently serializes
 * a `Map` to `{}`.
 */
export interface ProjectionCodec<TProjections> {
  encode(projections: TProjections): unknown;
  decode(value: unknown): TProjections;
}

/** Pure projection definitions injected by the caller. `applyEvent` must be pure so `rebuildProjections` can replay the log deterministically. */
export interface ProjectionReducers<TProjections> {
  readonly initial: TProjections;
  applyEvent(projections: TProjections, event: WorldEvent): TProjections;
  readonly codec: ProjectionCodec<TProjections>;
}

export interface Store {
  readonly db: Database;
  readonly path: string;
  readonly worldId: WorldId;
}

export interface OpenStoreOptions {
  /** Used only when creating a brand-new store; ignored (and asserted) when opening an existing one. */
  readonly worldId?: WorldId;
}

/**
 * The projection value and codec a store persists once, at creation, as
 * its genesis row -- the true starting point `rebuildProjections` replays
 * from. Required on every `openStore` call (not just the first) since a
 * brand-new store needs it immediately; an existing store ignores it, the
 * same way `OpenStoreOptions.worldId` is ignored on reopen.
 */
export interface GenesisInput<TProjections> {
  readonly initial: TProjections;
  readonly codec: Pick<ProjectionCodec<TProjections>, "encode">;
}

/**
 * Opens (creating if needed) the WAL SQLite store at `path`: macOS
 * persistent-WAL disabled before WAL mode is enabled (order matters --
 * some macOS SQLite builds default to a persistent WAL and re-enabling
 * journal_mode after the fact does not clear that setting),
 * `synchronous=NORMAL`, STRICT tables, and a `world` row identifying this
 * slot. A new slot's directory and file get 0700/0600 once, at creation.
 * A brand-new store also persists `genesis.initial` (encoded through
 * `genesis.codec`) once, in its own row, in the same creation transaction
 * as `world`/`clock`/`prng_state`/`projections` -- the starting point
 * `rebuildProjections` replays from, independent of whatever `initial`
 * value a later caller's own `ProjectionReducers` happens to carry.
 */
export function openStore<TProjections>(
  path: string,
  genesis: GenesisInput<TProjections>,
  options: OpenStoreOptions = {},
): Store {
  const dir = dirname(path);
  const existedBefore = existsSync(path);
  if (!existedBefore) {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o700);
  }

  const db = new Database(path, { create: true });

  try {
    // Check the version before anything else touches the file: enabling WAL
    // rewrites the header, and a refused store must be left as it was.
    const fresh = needsSchema(db);
    // Set the db file's mode before WAL mode is enabled: SQLite creates the
    // -wal and -shm sibling files with the main file's current mode, so
    // chmod-ing the main file first (rather than after, once its siblings
    // already exist) is what actually gets them created 0600 under a
    // permissive umask, with no separate chmod of the siblings needed.
    if (!existedBefore) {
      chmodSync(path, 0o600);
    }
    try {
      db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
    } catch {
      // Non-macOS builds (or SQLite builds without this fcntl) may not
      // support the call; WAL still functions correctly without it.
    }
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");

    if (fresh) {
      createSchema(db);
    }

    let worldId: WorldId;
    const worldRow = db.query("SELECT world_id FROM world LIMIT 1").get() as {
      world_id: string;
    } | null;
    if (worldRow) {
      worldId = worldRow.world_id as WorldId;
      if (options.worldId !== undefined && options.worldId !== worldId) {
        throw new Error(
          `store: cannot open ${path} with worldId ${options.worldId}; it already belongs to world ${worldId}`,
        );
      }
    } else {
      worldId = options.worldId ?? createWorldId();
      const now = Date.now();
      const genesisData = JSON.stringify(genesis.codec.encode(genesis.initial));
      db.transaction(() => {
        db.run("INSERT INTO world (id, world_id) VALUES (1, ?)", [worldId]);
        db.run(
          "INSERT INTO clock (id, cursor_wall_ms, paused, tick, sim_time_ms) VALUES (1, ?, 0, 0, 0)",
          [now],
        );
        db.run("INSERT INTO prng_state (id, state) VALUES (1, ?)", [""]);
        db.run("INSERT INTO genesis (id, data) VALUES (1, ?)", [genesisData]);
        db.run(
          "INSERT INTO projections (id, revision, data) VALUES (1, 0, ?)",
          [genesisData],
        );
      }).immediate();
    }

    return { db, path, worldId };
  } catch (error) {
    try {
      db.close();
    } catch {
      // Best-effort: the original error is what matters to the caller.
    }
    throw error;
  }
}

/** Checkpoints the WAL into the main file (TRUNCATE mode) without closing the store. */
export function checkpoint(store: Store): void {
  store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

/** Checkpoints and closes -- the clean-shutdown path. */
export function closeStore(store: Store): void {
  try {
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // Best-effort checkpoint; closing still flushes committed data.
  }
  store.db.close();
}

export function getCurrentSequence(db: Database): number {
  const row = db
    .query("SELECT MAX(sequence) as maxSequence FROM events")
    .get() as { maxSequence: number | null };
  return row.maxSequence ?? 0;
}

/** Every field the `clock` table row carries: wall-clock cursor/pause plus packages/world's tick counter and simulated time, committed atomically with each tick. */
export interface ClockRow extends PersistedClockState {
  readonly tick: number;
  readonly simTimeMs: number;
}

export function readClock(db: Database): ClockRow {
  const row = db
    .query(
      "SELECT cursor_wall_ms, paused, tick, sim_time_ms FROM clock WHERE id = 1",
    )
    .get() as {
    cursor_wall_ms: number;
    paused: number;
    tick: number;
    sim_time_ms: number;
  };
  return {
    cursorWallMs: row.cursor_wall_ms,
    paused: row.paused !== 0,
    tick: row.tick,
    simTimeMs: row.sim_time_ms,
  };
}

function writeClock(db: Database, state: ClockRow): void {
  db.run(
    "UPDATE clock SET cursor_wall_ms = ?, paused = ?, tick = ?, sim_time_ms = ? WHERE id = 1",
    [state.cursorWallMs, state.paused ? 1 : 0, state.tick, state.simTimeMs],
  );
}

/** What the current catch-up backlog has committed so far, across every run (and restart) that worked on it. */
export interface CatchUpProgress {
  /** Time applied as ticks. */
  readonly appliedMs: number;
  /** Time discarded for good: the excess over the cap, and chunks a mid-catch-up pause gave up. */
  readonly discardedMs: number;
  /** The last event sequence before the backlog began; the backlog's events are those after it. */
  readonly startSequence: number;
  /**
   * The id of the summary this backlog has already persisted as a degraded
   * partial; absent until it has. Set by `bindCatchUpProgressSummary`, never
   * by `writeCatchUpProgress`, so recording more progress keeps it.
   */
  readonly summaryId?: string;
}

/** The committed progress of a catch-up backlog whose summary has not been published yet, or `undefined` when none is open. */
export function readCatchUpProgress(db: Database): CatchUpProgress | undefined {
  const row = db
    .query(
      "SELECT applied_ms, discarded_ms, start_sequence, summary_id FROM catch_up_progress WHERE id = 1",
    )
    .get() as {
    applied_ms: number;
    discarded_ms: number;
    start_sequence: number;
    summary_id: string | null;
  } | null;
  return row
    ? {
        appliedMs: row.applied_ms,
        discardedMs: row.discarded_ms,
        startSequence: row.start_sequence,
        ...(row.summary_id === null ? {} : { summaryId: row.summary_id }),
      }
    : undefined;
}

/**
 * Records backlog progress. Call inside a tick's `onCommitted` so it commits or rolls back with that tick.
 * The row's `summaryId` binding is left as it is.
 */
export function writeCatchUpProgress(
  db: Database,
  progress: Omit<CatchUpProgress, "summaryId">,
): void {
  db.run(
    `INSERT INTO catch_up_progress (id, applied_ms, discarded_ms, start_sequence) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET applied_ms = excluded.applied_ms, discarded_ms = excluded.discarded_ms, start_sequence = excluded.start_sequence`,
    [progress.appliedMs, progress.discardedMs, progress.startSequence],
  );
}

/** Ties the open backlog to the summary it has persisted as a partial. No-op when no backlog is open. */
export function bindCatchUpProgressSummary(
  db: Database,
  summaryId: string,
): void {
  db.run("UPDATE catch_up_progress SET summary_id = ? WHERE id = 1", [
    summaryId,
  ]);
}

/** Closes the backlog: the next catch-up starts a new one. */
export function clearCatchUpProgress(db: Database): void {
  db.run("DELETE FROM catch_up_progress WHERE id = 1");
}

/** The latest catch-up summary, as the service delivers it on a frame. */
export interface CatchUpSummaryRecord {
  /** Service-minted identity; a client acknowledges a summary by it. */
  readonly id: string;
  /** The committed sequence the backlog ended at; `majorOutcomes` are frozen at it. */
  readonly atSequence: number;
  readonly appliedMs: number;
  readonly skippedMs: number;
  readonly majorOutcomes: readonly string[];
}

/** The persisted catch-up summary, or `undefined` before any non-empty catch-up has completed. */
export function readCatchUpSummary(
  db: Database,
): CatchUpSummaryRecord | undefined {
  const row = db
    .query(
      "SELECT summary_id, at_sequence, applied_ms, skipped_ms, major_outcomes FROM catch_up_summary WHERE id = 1",
    )
    .get() as {
    summary_id: string;
    at_sequence: number;
    applied_ms: number;
    skipped_ms: number;
    major_outcomes: string;
  } | null;
  return row
    ? {
        id: row.summary_id,
        atSequence: row.at_sequence,
        appliedMs: row.applied_ms,
        skippedMs: row.skipped_ms,
        majorOutcomes: JSON.parse(row.major_outcomes) as string[],
      }
    : undefined;
}

/** Persists the summary, replacing any earlier one. Call inside the transaction that closes (or partially records) the backlog, so it commits or rolls back with it. */
export function writeCatchUpSummary(
  db: Database,
  summary: CatchUpSummaryRecord,
): void {
  db.run(
    `INSERT INTO catch_up_summary (id, summary_id, at_sequence, applied_ms, skipped_ms, major_outcomes) VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET summary_id = excluded.summary_id, at_sequence = excluded.at_sequence, applied_ms = excluded.applied_ms, skipped_ms = excluded.skipped_ms, major_outcomes = excluded.major_outcomes`,
    [
      summary.id,
      summary.atSequence,
      summary.appliedMs,
      summary.skippedMs,
      JSON.stringify(summary.majorOutcomes),
    ],
  );
}

export function readPrngState(db: Database): string {
  const row = db.query("SELECT state FROM prng_state WHERE id = 1").get() as {
    state: string;
  };
  return row.state;
}

function writePrngState(db: Database, state: string): void {
  db.run("UPDATE prng_state SET state = ? WHERE id = 1", [state]);
}

export interface ProjectionsRow<TProjections> {
  readonly revision: number;
  readonly projections: TProjections;
}

export function readProjectionsRow<TProjections>(
  db: Database,
  reducers: Pick<ProjectionReducers<TProjections>, "initial" | "codec">,
): ProjectionsRow<TProjections> {
  const row = db
    .query("SELECT revision, data FROM projections WHERE id = 1")
    .get() as { revision: number; data: string } | null;
  if (!row) {
    return { revision: 0, projections: reducers.initial };
  }
  return {
    revision: row.revision,
    projections: reducers.codec.decode(JSON.parse(row.data)),
  };
}

/**
 * Reads the store's genesis projection -- the value persisted once at
 * creation, independent of whatever `initial` value the caller's own
 * `ProjectionReducers` happens to carry. `rebuildProjections` replays the
 * event log starting here, not from `reducers.initial`, so a freshly
 * constructed composition root (no reference to however the store was
 * originally seeded) still rebuilds the true starting state.
 */
export function readGenesisProjection<TProjections>(
  db: Database,
  reducers: Pick<ProjectionReducers<TProjections>, "codec">,
): TProjections {
  const row = db.query("SELECT data FROM genesis WHERE id = 1").get() as {
    data: string;
  } | null;
  if (!row) {
    throw new Error(
      "store: genesis row is missing; every store persists its genesis projection at creation",
    );
  }
  return reducers.codec.decode(JSON.parse(row.data));
}

function writeProjectionsRow<TProjections>(
  db: Database,
  revision: number,
  projections: TProjections,
  codec: ProjectionCodec<TProjections>,
): void {
  db.run("UPDATE projections SET revision = ?, data = ? WHERE id = 1", [
    revision,
    JSON.stringify(codec.encode(projections)),
  ]);
}

function insertEventRow(db: Database, event: WorldEvent): void {
  db.run(
    `INSERT INTO events (sequence, id, correlation_id, causation_id, kind, approximate, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      event.sequence,
      event.id,
      event.correlationId,
      event.causationId,
      event.kind,
      event.approximate ? 1 : 0,
      JSON.stringify(event),
    ],
  );
}

export function getEventRow(db: Database, id: string): WorldEvent | undefined {
  const row = db.query("SELECT payload FROM events WHERE id = ?").get(id) as {
    payload: string;
  } | null;
  return row ? (JSON.parse(row.payload) as WorldEvent) : undefined;
}

export function listEvents(
  db: Database,
  options: {
    readonly fromSequence?: number;
    readonly toSequence?: number;
    /** Leave out events of these kinds. */
    readonly excludeKinds?: readonly string[];
    /** Only the newest this many of what remains (still returned oldest first). */
    readonly newest?: number;
  } = {},
): readonly WorldEvent[] {
  const from = options.fromSequence ?? 0;
  const to = options.toSequence ?? Number.MAX_SAFE_INTEGER;
  const excluded = options.excludeKinds ?? [];
  const notIn =
    excluded.length === 0
      ? ""
      : ` AND kind NOT IN (${excluded.map(() => "?").join(", ")})`;
  const newest = options.newest;
  const order =
    newest === undefined ? "ORDER BY sequence ASC" : "ORDER BY sequence DESC";
  const limit = newest === undefined ? "" : " LIMIT ?";
  const rows = db
    .query(
      `SELECT payload FROM events WHERE sequence > ? AND sequence <= ?${notIn} ${order}${limit}`,
    )
    .all(from, to, ...excluded, ...(newest === undefined ? [] : [newest])) as {
    payload: string;
  }[];
  if (newest !== undefined) rows.reverse();
  return rows.map((row) => JSON.parse(row.payload) as WorldEvent);
}

export class NonContiguousSequenceError extends Error {
  constructor(
    readonly expected: number,
    readonly received: number,
  ) {
    super(
      `commitTick: non-contiguous event sequence (expected ${expected}, received ${received})`,
    );
    this.name = "NonContiguousSequenceError";
  }
}

export interface TickInput {
  /** Events to append this tick, in order, with sequence numbers contiguous from `getCurrentSequence(db) + 1`. */
  readonly events: readonly WorldEvent[];
  readonly cursorWallMs: number;
  readonly paused: boolean;
  /** The tick counter's value after this tick. */
  readonly tick: number;
  /** Simulated milliseconds elapsed after this tick. */
  readonly simTimeMs: number;
  /** Opaque seeded-PRNG state, serialized by the caller. */
  readonly prngState: string;
  /**
   * Runs inside the same transaction as the tick's own writes, after
   * events/projections/clock/PRNG are written but before the transaction
   * commits. A caller in another package (e.g. writing causal-trace rows
   * to the same physical database) can throw here to roll the whole tick
   * back atomically; this module stays free of any dependency on what the
   * callback actually writes.
   */
  readonly onCommitted?: (db: Database) => void;
}

export interface TickCommitResult<TProjections> {
  readonly sequence: number;
  readonly projections: TProjections;
}

/**
 * Commits one tick: appends `input.events`, applies each to the injected
 * reducer to advance projections, and persists the clock (cursor, pause,
 * tick, sim time) and PRNG state -- all inside one `BEGIN IMMEDIATE`
 * transaction. A thrown error at any point (a non-contiguous sequence, a
 * faulting reducer) rolls the whole transaction back automatically.
 */
export function commitTick<TProjections>(
  store: Store,
  reducers: ProjectionReducers<TProjections>,
  input: TickInput,
): TickCommitResult<TProjections> {
  const run = store.db.transaction(() => {
    let sequence = getCurrentSequence(store.db);
    let { projections } = readProjectionsRow(store.db, reducers);

    for (const event of input.events) {
      const expected = sequence + 1;
      if (event.sequence !== expected) {
        throw new NonContiguousSequenceError(expected, event.sequence);
      }
      insertEventRow(store.db, event);
      projections = reducers.applyEvent(projections, event);
      sequence = event.sequence;
    }

    writeProjectionsRow(store.db, sequence, projections, reducers.codec);
    writeClock(store.db, {
      cursorWallMs: input.cursorWallMs,
      paused: input.paused,
      tick: input.tick,
      simTimeMs: input.simTimeMs,
    });
    writePrngState(store.db, input.prngState);
    input.onCommitted?.(store.db);

    return { sequence, projections };
  });

  return run.immediate();
}

/**
 * Replays the entire event log from the store's persisted genesis row, ignoring
 * whatever is currently stored in `projections` -- used to prove
 * rebuild-equals-live, and to check an imported archive's projection against
 * its own log. It streams the log, so memory stays flat however long it is.
 */
export function rebuildProjections<TProjections>(
  store: Store,
  reducers: Pick<ProjectionReducers<TProjections>, "applyEvent" | "codec">,
): TProjections {
  let projections = readGenesisProjection(store.db, reducers);
  const rows = store.db
    .query("SELECT payload FROM events ORDER BY sequence ASC")
    .iterate() as IterableIterator<{ payload: string }>;
  for (const row of rows) {
    projections = reducers.applyEvent(
      projections,
      JSON.parse(row.payload) as WorldEvent,
    );
  }
  return projections;
}

/** Reads the currently-stored (live) projections without replaying the log. */
export function readLiveProjections<TProjections>(
  store: Store,
  reducers: ProjectionReducers<TProjections>,
): TProjections {
  return readProjectionsRow(store.db, reducers).projections;
}
