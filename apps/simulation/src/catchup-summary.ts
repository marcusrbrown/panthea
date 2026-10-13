// The catch-up summary a client is shown, and the rules for when it is
// persisted, kept, and replaced. A summary is derived once, from the open
// backlog (`catch_up_progress`) and the events it committed, and is then
// stored as its own row (`catch_up_summary`) with a service-minted id. It is
// never re-derived: a summary persisted at a backlog's ending sequence stays
// exactly that while live ticks go on and later backlogs come and go. Its id
// names the backlog that produced it: only that backlog, still open, may keep
// the id it already persisted; every later backlog mints its own.
//
// One exception to "every later backlog mints its own": the live loop reads the
// wall time a catch-up pass itself took as a gap and runs a small follow-up
// pass at once. That pass is the same absence, not a new one, so a follow-up
// that says it continues the pass before it (`continuesPrevious`) adds to that
// summary instead of replacing it: the client then shows the whole absence, not
// the few seconds the first pass took. The service cannot know whether a client
// has dismissed the earlier summary, so the combined one is a changed summary
// and gets a new id, like any other change.
//
// Every write here is meant to run inside the transaction that ends (or
// partially records) the backlog, so the summary row and the progress delete
// commit or roll back together, and only what committed is ever published.

import type { Database } from "bun:sqlite";
import {
  bindCatchUpProgressSummary,
  type CatchUpProgress,
  type CatchUpSummaryRecord,
  clearCatchUpProgress,
  getCurrentSequence,
  listEvents,
  readCatchUpProgress,
  readCatchUpSummary,
  writeCatchUpSummary,
} from "@panthea/persistence";
import { DEFAULT_TICK_ELAPSED_MS } from "@panthea/world";

/** Event kinds worth naming in the catch-up summary's `majorOutcomes`. */
export const MAJOR_EVENT_KINDS = new Set<string>([
  "building-ignited",
  "building-destroyed",
  "building-repaired",
  "legend-recorded",
]);

/** What a backlog applied, skipped, and found notable, before it has an identity or an ending sequence. */
export interface BacklogAccount {
  readonly appliedMs: number;
  readonly skippedMs: number;
  readonly majorOutcomes: readonly string[];
}

export const EMPTY_ACCOUNT: BacklogAccount = {
  appliedMs: 0,
  skippedMs: 0,
  majorOutcomes: [],
};

/**
 * A backlog's account, read from what it committed: time applied and
 * discarded from its progress row, and its notable outcomes from the events
 * committed after the sequence it started at, up to and including
 * `endSequence`. Bounding at the ending sequence is what keeps a summary
 * about its own backlog and not about events that happened after it.
 */
export function accountOf(
  db: Database,
  progress: CatchUpProgress,
  endSequence: number,
): BacklogAccount {
  return {
    appliedMs: progress.appliedMs,
    skippedMs: progress.discardedMs,
    majorOutcomes: listEvents(db, {
      fromSequence: progress.startSequence,
      toSequence: endSequence,
    })
      .filter((event) => MAJOR_EVENT_KINDS.has(event.kind))
      .map(
        (event) =>
          `${event.kind}:${"entityId" in event ? String(event.entityId) : ""}`,
      ),
  };
}

/**
 * Whether an account is something worth telling: at least one tick applied
 * or skipped, or an outcome. Less than that (a resume with no missed time, a
 * restart a few milliseconds after the store was created) is "nothing
 * happened" and must not open the panel or replace an earlier summary.
 */
export function isNonEmptyAccount(account: BacklogAccount): boolean {
  return (
    account.appliedMs >= DEFAULT_TICK_ELAPSED_MS ||
    account.skippedMs >= DEFAULT_TICK_ELAPSED_MS ||
    account.majorOutcomes.length > 0
  );
}

/** The account of the open backlog frozen at the current committed sequence, or `undefined` when none is open. */
export function openBacklogAccount(db: Database): BacklogAccount | undefined {
  const progress = readCatchUpProgress(db);
  return progress ? accountOf(db, progress, getCurrentSequence(db)) : undefined;
}

function sameSummary(
  existing: CatchUpSummaryRecord,
  account: BacklogAccount,
  atSequence: number,
): boolean {
  return (
    existing.atSequence === atSequence &&
    existing.appliedMs === account.appliedMs &&
    existing.skippedMs === account.skippedMs &&
    existing.majorOutcomes.length === account.majorOutcomes.length &&
    existing.majorOutcomes.every(
      (outcome, index) => outcome === account.majorOutcomes[index],
    )
  );
}

/**
 * Persists `account` as the latest summary of the open backlog `progress`.
 * The id belongs to the backlog, not to the account's content: it is reused,
 * with nothing written, only when the summary already persisted is the one
 * this same open backlog recorded as a degraded partial (`progress.summaryId`)
 * and nothing about it changed, so a client that acknowledged it is not shown
 * it again. Any other case mints a new id: a difference in the account, even
 * at the same sequence, or a backlog that has not persisted a summary yet,
 * even when its account is identical to the last closed backlog's. When the
 * backlog stays open (`bind`), the new id is tied to it so a retry or the
 * closing commit can recognise it.
 */
function persistAccount(
  db: Database,
  progress: CatchUpProgress,
  account: BacklogAccount,
  atSequence: number,
  bind: boolean,
): CatchUpSummaryRecord {
  const existing = readCatchUpSummary(db);
  if (
    existing &&
    existing.id === progress.summaryId &&
    sameSummary(existing, account, atSequence)
  ) {
    return existing;
  }
  const record: CatchUpSummaryRecord = {
    id: crypto.randomUUID(),
    atSequence,
    appliedMs: account.appliedMs,
    skippedMs: account.skippedMs,
    majorOutcomes: [...account.majorOutcomes],
  };
  // The summary and the binding are one unit: a summary published under a
  // new id while the progress still names the old one would make the id
  // unrecognisable to a retry and the state unimportable. `db.transaction`
  // is a savepoint when the caller is already inside a commit's transaction
  // (`closeCatchUpBacklog`), and a transaction of its own otherwise
  // (`recordPartialSummary` from a degraded run).
  db.transaction(() => {
    writeCatchUpSummary(db, record);
    if (bind) {
      bindCatchUpProgressSummary(db, record.id);
    }
  })();
  return record;
}

/**
 * Persists the open backlog's account as the latest summary but keeps the
 * backlog open: a degraded catch-up shows what it committed, and a retry
 * continues from the same progress. Returns the persisted summary, or
 * `undefined` when there is no open backlog or it amounts to nothing (the
 * previous summary is kept). The summary and its binding to the backlog
 * commit or roll back together, on their own or inside the caller's transaction.
 */
export function recordPartialSummary(
  db: Database,
): CatchUpSummaryRecord | undefined {
  const progress = readCatchUpProgress(db);
  if (!progress) {
    return undefined;
  }
  const endSequence = getCurrentSequence(db);
  const account = accountOf(db, progress, endSequence);
  return isNonEmptyAccount(account)
    ? persistAccount(db, progress, account, endSequence, true)
    : undefined;
}

export interface CloseOptions {
  /**
   * The pass being closed follows the one before it with nothing running in
   * between (no live tick): the same absence. It adds to that pass's summary,
   * which it must adjoin: the summary ended at the sequence this backlog
   * started after, and no partial summary of its own is bound to it.
   */
  readonly continuesPrevious?: boolean;
}

/** `previous` and `account` as one account: the time and outcomes of the whole absence. */
function combined(
  previous: CatchUpSummaryRecord,
  account: BacklogAccount,
): BacklogAccount {
  return {
    appliedMs: previous.appliedMs + account.appliedMs,
    skippedMs: previous.skippedMs + account.skippedMs,
    majorOutcomes: [...previous.majorOutcomes, ...account.majorOutcomes],
  };
}

export interface ClosedBacklog {
  /** What the backlog applied, skipped, and found, frozen at its ending sequence. */
  readonly account: BacklogAccount;
  /** The summary now persisted for it, or `undefined` when it amounted to nothing and the previous summary was kept. */
  readonly delivered: CatchUpSummaryRecord | undefined;
}

/**
 * Ends the open backlog: freezes its account at the current committed
 * sequence, persists it as the latest summary (unless it amounts to nothing),
 * and clears the progress. Call inside the commit transaction that ends the
 * backlog, so the summary and the delete commit or roll back with it. Returns
 * `undefined` when no backlog is open. A pass that amounts to nothing leaves
 * the earlier summary alone, even when it continues it.
 */
export function closeCatchUpBacklog(
  db: Database,
  options: CloseOptions = {},
): ClosedBacklog | undefined {
  const progress = readCatchUpProgress(db);
  if (!progress) {
    return undefined;
  }
  const endSequence = getCurrentSequence(db);
  const account = accountOf(db, progress, endSequence);
  const previous =
    options.continuesPrevious === true && progress.summaryId === undefined
      ? readCatchUpSummary(db)
      : undefined;
  const persisted =
    previous !== undefined && previous.atSequence === progress.startSequence
      ? combined(previous, account)
      : account;
  const delivered = isNonEmptyAccount(account)
    ? persistAccount(db, progress, persisted, endSequence, false)
    : undefined;
  clearCatchUpProgress(db);
  return { account, delivered };
}
