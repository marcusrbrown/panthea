// Chunked, cancellable catch-up: applied on start and on resume-from-sleep
// to advance a world whose persisted wall-clock cursor is behind now,
// capped at one hour of missed wall time. Every simulated second still
// runs a full tick through the same routines as live play -- no
// aggregation into a coarse step -- but many ticks are computed in memory
// and committed together as one chunk transaction, so the cursor only
// ever advances at a chunk boundary. Every event a catch-up tick produces
// is marked approximate.
//
// Journaled external proposals run inside the chunk transactions like any
// other tick input: the first tick of each chunk takes the pending entries,
// and the same commit that applies the chunk marks them consumed.
//
// Between chunks, control yields back to the event loop so a concurrent
// HTTP request (e.g. `/pause`) is actually served while a long catch-up
// run is in progress, rather than only after it finishes.

import type { DegradedReason, WorldEvent } from "@panthea/contracts";
import {
  type ClockConfig,
  computeTick,
  getCurrentSequence,
  readCatchUpProgress,
  readClock,
  writeCatchUpProgress,
} from "@panthea/persistence";
import {
  DEFAULT_TICK_ELAPSED_MS,
  type PrngState,
  type WorldState,
} from "@panthea/world";
import {
  type BacklogAccount,
  type ClosedBacklog,
  closeCatchUpBacklog,
  EMPTY_ACCOUNT,
  openBacklogAccount,
  recordPartialSummary,
} from "./catchup-summary";
import {
  buildRoutineQueue,
  commitWorldTick,
  mergeTickQueue,
  type QueuedProposal,
  readPendingExternalQueue,
  recordOperatorEvent,
  screenObservations,
  stepWorldTick,
  type TickDeps,
  type WorldTickOutcome,
} from "./tick";
import { serializePrngState } from "./world-store";

export type CatchUpDeps = TickDeps;

/** The account of what the open backlog has committed so far, or an empty one when it has committed nothing. */
function committedAccountOf(deps: CatchUpDeps): BacklogAccount {
  try {
    return openBacklogAccount(deps.store.db) ?? EMPTY_ACCOUNT;
  } catch {
    // The store is what is failing; there is nothing more to read from it.
    return EMPTY_ACCOUNT;
  }
}

/**
 * A commit failed after some of the backlog committed. What it committed is
 * persisted as the summary in a transaction of its own, and the backlog stays
 * open so a retry continues it; the frame then shows a summary that survives a
 * kill. If the store is what failed, that write may fail too: nothing
 * unpersisted is ever published, so the previous summary stays.
 */
function degradedPartial(
  deps: CatchUpDeps,
  state: WorldState,
  prng: PrngState,
  reason: DegradedReason,
  message: string,
): CatchUpResult {
  try {
    recordPartialSummary(deps.store.db);
  } catch {
    // See above.
  }
  return {
    summary: committedAccountOf(deps),
    state,
    prng,
    degraded: { reason, message },
  };
}

/**
 * The commit that would have ended the backlog failed. It rolled back whole,
 * summary included, so the backlog stays open with nothing new persisted and
 * nothing to publish; the retry (a restart, say) ends it.
 */
function degradedCompletion(
  deps: CatchUpDeps,
  state: WorldState,
  prng: PrngState,
  reason: DegradedReason,
  message: string,
): CatchUpResult {
  return {
    summary: committedAccountOf(deps),
    state,
    prng,
    degraded: { reason, message },
  };
}

export interface CatchUpOptions {
  readonly nowWallMs: number;
  /**
   * Called after each chunk commits and after yielding to the event loop,
   * before the next chunk starts; returning `true` stops catch-up at this
   * boundary (an operator pause request arriving mid-catch-up, checked
   * via a live flag `/pause`'s HTTP handler sets) and persists
   * `paused: true`. Defaults to never stopping early.
   */
  readonly onChunkCommitted?: (progress: {
    readonly appliedMs: number;
    readonly ticksRemaining: number;
  }) => boolean;
  /**
   * This pass follows the previous catch-up with no live tick between: the
   * wall time that pass took read as a gap. Its summary adds to the previous
   * one's instead of replacing it (`closeCatchUpBacklog`).
   */
  readonly continuesPrevious?: boolean;
}

/** What a backlog applied, skipped, and found notable, before it has an identity or an ending sequence (those come when it is persisted). */
export type CatchUpOutcome = BacklogAccount;

export interface CatchUpResult {
  readonly summary: CatchUpOutcome;
  readonly state: WorldState;
  readonly prng: PrngState;
  /** Present only when a chunk's own store commit failed; `state`/`prng` reflect the last chunk that *did* commit. */
  readonly degraded?: {
    readonly reason: DegradedReason;
    readonly message: string;
  };
}

/** Yields control to the event loop, giving any pending I/O (an incoming HTTP request in particular) a chance to run before the next chunk starts. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Runs catch-up against `deps.store`'s persisted clock: does nothing if
 * the world is currently paused (paused wall time never becomes
 * catch-up), otherwise applies up to `initialState.rules.catchUpCapMs` of
 * missed wall time in `initialState.rules.catchUpChunkMs`-sized chunks,
 * each committed as one transaction with the cursor advanced inside it. A
 * chunk whose own commit fails (a store write failure) stops catch-up and
 * reports degraded, leaving every prior chunk's commit intact.
 *
 * The cap bounds the remaining backlog, not the total. With cap C, `a`
 * already applied, and `d` of new downtime since, the next run applies
 * min(C, C - a + d): the excess over C is discarded in one commit before
 * any chunk, so a run that dies partway never hands its restart a fresh
 * cap over the same sleep.
 *
 * The backlog's progress (time applied, time discarded, and the event
 * sequence it started after) is committed in the same transaction as each
 * discard and chunk, so a restart continues it.
 *
 * The backlog ends in one commit: the final cursor jump, a mid-catch-up
 * pause, or (on a restart with nothing left to apply) a commit of its own.
 * That same transaction persists the backlog's summary, frozen at the
 * committed ending sequence with a service-minted id, and clears the
 * progress. So a summary exists on disk before anything can expose it, a
 * kill at any point leaves either the whole ending or none of it, and the
 * summary never changes afterwards however many live ticks follow. If that
 * commit fails the backlog stays open, the run reports degraded, and no
 * summary is persisted or published.
 *
 * A degraded run (a chunk, the discard, or the pause failed to commit)
 * persists what the backlog committed as its summary in a transaction of its
 * own and keeps the progress open. A retry with nothing new committed reuses
 * that summary's id; one that changes it mints a new id.
 *
 * `summary` is the backlog's account as of return (for a closed backlog, as
 * persisted); what a client sees is read back from the store
 * (`refreshStatusAfterCatchUp`), never taken from here.
 */
export async function runCatchUp(
  initialState: WorldState,
  initialPrng: PrngState,
  deps: CatchUpDeps,
  options: CatchUpOptions,
): Promise<CatchUpResult> {
  const clock = readClock(deps.store.db);
  if (clock.paused) {
    // Paused wall time never becomes catch-up. A backlog left open by a
    // degraded run is closed when the world resumes.
    return {
      summary: committedAccountOf(deps),
      state: initialState,
      prng: initialPrng,
    };
  }

  const rules = initialState.rules;
  const clockConfig: ClockConfig = { catchUpCapMs: rules.catchUpCapMs };
  const {
    appliedMs: totalAppliedMs,
    skippedMs: excessMs,
    newCursor: sampledNowCursor,
  } = computeTick(clock, options.nowWallMs, clockConfig);

  // Progress a previous run committed for this same backlog, if its summary
  // was not published. A new backlog starts after the last committed event.
  const prior = readCatchUpProgress(deps.store.db);
  const priorAppliedMs = prior?.appliedMs ?? 0;
  const startSequence =
    prior?.startSequence ?? getCurrentSequence(deps.store.db);
  let discardedMs = prior?.discardedMs ?? 0;

  // A remainder shorter than one tick is below the simulation's resolution:
  // it is neither applied nor reported as skipped, so a gap of a few
  // milliseconds (every restart has one) is "nothing happened".
  const tickMs = DEFAULT_TICK_ELAPSED_MS;
  const totalTicks = Math.floor(totalAppliedMs / tickMs);

  const closing = { continuesPrevious: options.continuesPrevious === true };

  // What ended backlog this run closed, once it has: set by the ending
  // commit's callback, so it is only meaningful after that commit succeeded.
  let closed: ClosedBacklog | undefined;

  if (totalTicks === 0) {
    if (!prior) {
      return { summary: EMPTY_ACCOUNT, state: initialState, prng: initialPrng };
    }
    // Nothing more to apply, but a previous run left the backlog open (it
    // applied everything and its ending commit did not happen, or it degraded
    // and a retry has nothing new). End it now: persist its summary and clear
    // the progress in one transaction, exactly as the run that finished it
    // would have. That includes the cursor: the sub-tick remainder is dropped
    // here for the same reason the normal ending drops it, so it cannot be
    // left behind to add up to an extra tick later.
    const finish = commitWorldTick(
      deps,
      [],
      {
        tick: initialState.tick,
        simTimeMs: initialState.simTime,
        prngState: serializePrngState(initialPrng),
        cursorWallMs: sampledNowCursor,
        paused: false,
      },
      [],
      (db) => {
        closed = closeCatchUpBacklog(db, closing);
      },
    );
    if (!finish.ok) {
      return degradedCompletion(
        deps,
        initialState,
        initialPrng,
        finish.reason,
        finish.message,
      );
    }
    return {
      summary: closed?.account ?? EMPTY_ACCOUNT,
      state: initialState,
      prng: initialPrng,
    };
  }

  let cursorWallMs = clock.cursorWallMs;
  if (excessMs > 0) {
    // The gap is longer than the cap. Discard the excess in its own commit,
    // before any chunk.
    const discardedCursor = cursorWallMs + excessMs;
    const discard = commitWorldTick(
      deps,
      [],
      {
        tick: initialState.tick,
        simTimeMs: initialState.simTime,
        prngState: serializePrngState(initialPrng),
        cursorWallMs: discardedCursor,
        paused: false,
      },
      [],
      (db) => {
        recordOperatorEvent(`catch-up-discard:${excessMs}`)(db);
        writeCatchUpProgress(db, {
          appliedMs: priorAppliedMs,
          discardedMs: discardedMs + excessMs,
          startSequence,
        });
      },
    );
    if (!discard.ok) {
      return degradedPartial(
        deps,
        initialState,
        initialPrng,
        discard.reason,
        discard.message,
      );
    }
    cursorWallMs = discardedCursor;
    discardedMs += excessMs;
  }

  const chunkTicks = Math.max(1, Math.floor(rules.catchUpChunkMs / tickMs));

  let committedState = initialState;
  let committedPrng = initialPrng;
  let ticksDone = 0;
  let pausedMidCatchUp = false;

  while (ticksDone < totalTicks) {
    const ticksThisChunk = Math.min(chunkTicks, totalTicks - ticksDone);

    // Journaled external proposals run on their next simulated tick, which
    // is this chunk's first. Anything accepted while catch-up yielded targets
    // the tick after the last committed chunk, so it is eligible here too.
    let pending: QueuedProposal[];
    try {
      pending = readPendingExternalQueue(
        deps.store.db,
        committedState.tick + 1,
      );
    } catch (error) {
      return degradedPartial(
        deps,
        committedState,
        committedPrng,
        "store-error",
        error instanceof Error ? error.message : String(error),
      );
    }

    let workingState = committedState;
    let workingPrng = committedPrng;
    // The first tick's queue holds the journaled proposals. One whose
    // observation id is bound to different content is refused with an
    // explicit outcome here, before the chunk commits, never thrown inside it.
    let screened: ReturnType<typeof screenObservations>;
    try {
      screened = screenObservations(
        deps.traceDb,
        mergeTickQueue(buildRoutineQueue(workingState), pending),
      );
    } catch (error) {
      return degradedPartial(
        deps,
        committedState,
        committedPrng,
        "store-error",
        error instanceof Error ? error.message : String(error),
      );
    }
    let workingQueue: readonly QueuedProposal[] = screened.runnable;
    const chunkOutcomes: WorldTickOutcome[] = [];
    let chunkEvents: WorldEvent[] = [];

    for (let i = 0; i < ticksThisChunk; i += 1) {
      const stepped = stepWorldTick(workingState, workingPrng, workingQueue, {
        approximate: true,
      });
      const outcome: WorldTickOutcome =
        i === 0 ? { ...stepped, refused: screened.refused } : stepped;
      chunkOutcomes.push(outcome);
      chunkEvents = [...chunkEvents, ...outcome.result.events];
      workingState = outcome.result.state;
      workingPrng = outcome.result.prng;
      workingQueue = buildRoutineQueue(workingState);
    }

    const newCursorWallMs = cursorWallMs + ticksThisChunk * tickMs;
    const commit = commitWorldTick(
      deps,
      chunkEvents,
      {
        tick: workingState.tick,
        simTimeMs: workingState.simTime,
        prngState: serializePrngState(workingPrng),
        cursorWallMs: newCursorWallMs,
        paused: false,
      },
      chunkOutcomes,
      (db) =>
        writeCatchUpProgress(db, {
          appliedMs: priorAppliedMs + (ticksDone + ticksThisChunk) * tickMs,
          discardedMs,
          startSequence,
        }),
    );

    if (!commit.ok) {
      return degradedPartial(
        deps,
        committedState,
        committedPrng,
        commit.reason,
        commit.message,
      );
    }

    committedState = workingState;
    committedPrng = workingPrng;
    cursorWallMs = newCursorWallMs;
    ticksDone += ticksThisChunk;

    if (ticksDone < totalTicks) {
      await yieldToEventLoop();
    }

    if (
      ticksDone < totalTicks &&
      options.onChunkCommitted?.({
        appliedMs: priorAppliedMs + ticksDone * tickMs,
        ticksRemaining: totalTicks - ticksDone,
      })
    ) {
      // Persists the pause, alongside the cursor already advanced
      // through the last committed chunk, and its operator observation
      // in the same transaction -- through the same `commitWorldTick`
      // `onCommitted` path `/pause` itself uses (`recordOperatorEvent`),
      // so a trace failure here rolls the pause transition back exactly
      // like it would for a live `/pause` request, rather than being
      // swallowed. The backlog ends here: the remainder is discarded, which
      // the progress records, and the backlog is closed in this same commit:
      // its summary is persisted and its progress cleared with the pause.
      const pauseCommit = commitWorldTick(
        deps,
        [],
        {
          tick: committedState.tick,
          simTimeMs: committedState.simTime,
          prngState: serializePrngState(committedPrng),
          cursorWallMs,
          paused: true,
        },
        [],
        (db) => {
          recordOperatorEvent("pause")(db);
          writeCatchUpProgress(db, {
            appliedMs: priorAppliedMs + ticksDone * tickMs,
            discardedMs: discardedMs + (totalTicks - ticksDone) * tickMs,
            startSequence,
          });
          closed = closeCatchUpBacklog(db, closing);
        },
      );
      if (!pauseCommit.ok) {
        return degradedPartial(
          deps,
          committedState,
          committedPrng,
          pauseCommit.reason,
          pauseCommit.message,
        );
      }
      pausedMidCatchUp = true;
      break;
    }
  }

  if (!pausedMidCatchUp) {
    // Every tick this call could apply is now committed. Jump the
    // persisted cursor the rest of the way to the sampled wall time
    // (matching what `computeTick` itself would have persisted for an
    // ordinary, uncapped tick), dropping the sub-tick remainder so it does
    // not look like still-missed time to whatever calls catch-up next. The
    // same commit ends the backlog: its summary is persisted and its progress
    // cleared, so the summary exists on disk before anything can expose it,
    // and a failure here rolls all three back together.
    const adjust = commitWorldTick(
      deps,
      [],
      {
        tick: committedState.tick,
        simTimeMs: committedState.simTime,
        prngState: serializePrngState(committedPrng),
        cursorWallMs: sampledNowCursor,
        paused: false,
      },
      [],
      (db) => {
        closed = closeCatchUpBacklog(db, closing);
      },
    );
    if (!adjust.ok) {
      return degradedCompletion(
        deps,
        committedState,
        committedPrng,
        adjust.reason,
        adjust.message,
      );
    }
  }

  return {
    summary: closed?.account ?? EMPTY_ACCOUNT,
    state: committedState,
    prng: committedPrng,
  };
}
