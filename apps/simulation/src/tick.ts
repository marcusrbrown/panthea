// The per-tick scheduling step: revalidate and commit a queue of
// proposals in one store transaction (writing every observation and
// outcome to the causal trace inside that same transaction), then decide
// the routine proposals for the next tick from the newly committed state.
// `stepWorldTick`/`commitWorldTick`/`traceWorldTick` are exported
// separately so catchup.ts can run several ticks purely in memory and
// commit them together as one chunk transaction, while the live 1 Hz
// loop (wired in the service entrypoint) commits one tick at a time
// through `applyOneTick`.

import type { Database } from "bun:sqlite";
import type {
  CausationId,
  CorrelationId,
  DegradedReason,
  EntityId,
  ObservationRecord,
  Proposal,
  WorldEvent,
} from "@panthea/contracts";
import {
  canonicalJson,
  createObservationId,
  parseObservationRecord,
  parseProposal,
} from "@panthea/contracts";
import {
  type ExternalProposalOutcome,
  getEventRow,
  markExternalProposalConsumed,
  type ProjectionReducers,
  commitTick as persistCommitTick,
  readPendingExternalProposals,
  type Store,
} from "@panthea/persistence";
import {
  createProposalId,
  getObservation,
  type IntentModelRequest,
  type ProposalId,
  parseProposalId,
  recordModelRequest,
  recordObservation,
  recordProposalOutcome,
} from "@panthea/telemetry";
import {
  type CurrencyClaims,
  decideRoutineProposal,
  type PrngState,
  type RuleRejection,
  reject,
  runTick,
  type SubmitResult,
  submitProposal,
  toEntityId,
  type WorldState,
} from "@panthea/world";
import { serializePrngState } from "./world-store";

export interface QueuedProposal {
  readonly id: ProposalId;
  readonly proposal: Proposal;
  readonly observation: ObservationRecord;
  /** Set on a proposal read from the durable journal: the tick that runs it also marks it consumed, in its own transaction. */
  readonly external?: true;
  /**
   * The model request that produced this proposal, if a model did. It is
   * recorded in the trace by the tick that gives the proposal its terminal
   * outcome (committed, rejected, or over the limit), inside that tick's
   * transaction, so a rolled-back tick leaves no row.
   */
  readonly modelRequest?: Omit<IntentModelRequest, "proposalId">;
}

export interface TickDeps {
  readonly store: Store;
  readonly reducers: ProjectionReducers<WorldState>;
  readonly traceDb: Database;
  /** Injectable for tests that simulate a store write failure (e.g. `SQLITE_FULL`); defaults to persistence's real `commitTick`. */
  readonly commitTick?: typeof persistCommitTick;
}

function toCorrelationId(raw: string): CorrelationId {
  return raw as CorrelationId;
}
function toCausationId(raw: string): CausationId {
  return raw as CausationId;
}

function classifyStoreError(error: unknown): DegradedReason {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("SQLITE_FULL") ? "disk-full" : "store-error";
}

/**
 * Every drive-bearing, living actor's routine decision against `state`, as the
 * queue for the *next* tick.
 *
 * Admission policy: a routine proposal that keeps a promise whose deadline is
 * near (`urgent`: a mortal's offering within the urgency window) goes ahead of
 * every other routine proposal; the rest keep the actors' own order. Only the
 * first `maxProposalsPerTick` actions are admitted, so when the cap is short it
 * is gathering, trading, and the like that overflow, never the promise. The
 * order is a pure function of `state`, so catch-up and live play agree.
 */
export function buildRoutineQueue(
  state: WorldState,
  actorIds: Iterable<EntityId> = state.actors.keys(),
): readonly QueuedProposal[] {
  const urgent: QueuedProposal[] = [];
  const ordinary: QueuedProposal[] = [];
  // One round: each decision speaks for the currency its trade will move, so two sellers never both pick the
  // buyer who can pay for only one.
  const claims: CurrencyClaims = new Map();
  for (const actorId of actorIds) {
    const decision = decideRoutineProposal(state, actorId, claims);
    if (!decision) {
      continue;
    }
    (decision.urgent === true ? urgent : ordinary).push({
      id: createProposalId(),
      proposal: decision.proposal,
      observation: decision.observation,
    });
  }
  return [...urgent, ...ordinary];
}

/**
 * The journaled external proposals a tick numbered `tick` runs: pending
 * entries targeted at or before it, in input order. Entries are parsed again
 * as the versioned proposal and observation they were stored as; one that no
 * longer parses is a corrupt store and throws rather than being skipped.
 */
export function readPendingExternalQueue(
  db: Database,
  tick: number,
): QueuedProposal[] {
  return readPendingExternalProposals(db, tick).map((entry) => {
    const id = parseProposalId(entry.proposalId, "proposalId");
    const proposal = parseProposal(entry.proposal);
    const observation = parseObservationRecord(entry.observation);
    if (!id.ok || !proposal.ok || !observation.ok) {
      throw new Error(
        `journal entry ${entry.proposalId} no longer parses as a proposal and observation`,
      );
    }
    return {
      id: id.value,
      proposal: proposal.value,
      observation: observation.value,
      external: true,
    };
  });
}

/**
 * The proposals one live tick runs, in admission order: every external
 * (fixture or operator) proposal first, in the order they arrived, then the
 * routines' proposals in their own order.
 *
 * External proposals go first because `stepWorldTick` admits only the first
 * `maxProposalsPerTick` entries: behind the routines, an external proposal
 * would be the one rejected as over-limit whenever the cap is tight. Claims
 * are external proposals too and go first with the rest. They are counted
 * against the cap separately (`stepWorldTick`), so a claim gets its recorded
 * rejection, never an over-limit one, and never costs a routine its slot.
 *
 * An actor commits one action per tick, so an external proposal for an
 * actor takes that actor's slot and the actor's routine proposal yields:
 * it is dropped before the tick, never submitted, so nothing about it is
 * recorded (no observation, no rejection). This holds whether or not the
 * external proposal then commits. A claim never commits and a goal-only
 * proposal has no action, so neither displaces a routine.
 *
 * The result is a pure function of the two queues, and nothing here reads a
 * clock. External proposals come from the durable journal in `input_order`,
 * each assigned to a tick when `/proposals` commits it, so the merge input is
 * persisted state.
 */
export function mergeTickQueue(
  routine: readonly QueuedProposal[],
  external: readonly QueuedProposal[],
): QueuedProposal[] {
  const claimed = new Set<EntityId>(
    external
      .filter(
        (queued) =>
          queued.proposal.kind !== "claim" && queued.proposal.kind !== "goal",
      )
      .map((queued) => queued.proposal.actor),
  );
  return [
    ...external,
    ...routine.filter((queued) => !claimed.has(queued.proposal.actor)),
  ];
}

export interface StepOptions {
  readonly elapsedMs?: number;
  readonly approximate?: boolean;
}

export interface WorldTickOutcome {
  readonly result: ReturnType<typeof runTick>;
  readonly admitted: readonly QueuedProposal[];
  readonly overflow: readonly QueuedProposal[];
  /** The goal events an over-limit action's goal change still committed: the action overflowed, the declaration did not. Keyed by the overflowed proposal. */
  readonly overflowGoalEvents: ReadonlyMap<
    QueuedProposal,
    readonly WorldEvent[]
  >;
  /** Proposals that cited an observation id already bound to different content. They never reached the world; each gets a terminal `observation-conflict` rejection. */
  readonly refused: readonly QueuedProposal[];
}

/**
 * Splits `queue` into what may run and what must be refused because its
 * observation id is already bound to different content, either in the trace
 * or by an earlier proposal in this same queue. Several proposals citing one
 * unchanged observation all pass. This runs before the tick, outside the
 * commit transaction, so a conflict becomes an explicit outcome instead of a
 * throw that would roll the tick back to repeat forever.
 */
export function screenObservations(
  traceDb: Database,
  queue: readonly QueuedProposal[],
): { runnable: QueuedProposal[]; refused: QueuedProposal[] } {
  const runnable: QueuedProposal[] = [];
  const refused: QueuedProposal[] = [];
  const claimedInQueue = new Map<string, string>();
  for (const queued of queue) {
    const content = canonicalJson(queued.observation);
    const id = String(queued.observation.id);
    const recorded = getObservation(traceDb, queued.observation.id);
    const boundTo = recorded
      ? canonicalJson(recorded.record)
      : claimedInQueue.get(id);
    if (boundTo !== undefined && boundTo !== content) {
      refused.push(queued);
      continue;
    }
    claimedInQueue.set(id, boundTo ?? content);
    runnable.push(queued);
  }
  return { runnable, refused };
}

/**
 * Splits `queue`, in order, into what one tick admits and what is over the
 * limit. Actions, claims, and goal-only proposals are counted separately, each
 * up to `cap`: a claim never commits and a goal-only proposal has no action, so
 * neither may use up capacity a routine or another action needs (a full tick
 * would otherwise lose a god's declared goal for good), yet each still has to be
 * bounded so a flood cannot make the tick do unbounded validation and trace
 * writes.
 *
 * An action over the action cap that carries a goal change keeps the change
 * while goal capacity remains: the action overflows, the declaration is
 * admitted through the goal bucket (`goalOnly`) and committed on its own.
 */
function admitWithinCap(
  queue: readonly QueuedProposal[],
  cap: number,
): {
  admitted: QueuedProposal[];
  overflow: QueuedProposal[];
  goalOnly: QueuedProposal[];
} {
  const admitted: QueuedProposal[] = [];
  const overflow: QueuedProposal[] = [];
  const goalOnly: QueuedProposal[] = [];
  const counts = { action: 0, claim: 0, goal: 0 };
  for (const queued of queue) {
    const bucket =
      queued.proposal.kind === "claim"
        ? "claim"
        : queued.proposal.kind === "goal"
          ? "goal"
          : "action";
    if (counts[bucket] < cap) {
      admitted.push(queued);
      counts[bucket] += 1;
    } else {
      overflow.push(queued);
      if (queued.proposal.goal !== undefined && counts.goal < cap) {
        counts.goal += 1;
        goalOnly.push(queued);
      }
    }
  }
  return { admitted, overflow, goalOnly };
}

/** The goal change of an over-limit action as a goal-only proposal: no action, no revisions to go stale, the same actor and observation. */
function goalOnlyOf(proposal: Proposal): Proposal {
  if (proposal.goal === undefined) throw new Error("no goal change");
  return {
    schemaVersion: proposal.schemaVersion,
    actor: proposal.actor,
    targets: [],
    expectedRevisions: [],
    source: proposal.source,
    observationId: proposal.observationId,
    kind: "goal",
    goal: proposal.goal,
  };
}

/**
 * Runs one world tick purely in memory: proposals beyond
 * `state.rules.maxProposalsPerTick` (counted as `admitWithinCap` does) never
 * reach the world engine (over-limit), everything else is revalidated and
 * committed sequentially by `runTick`. No store or trace I/O --
 * `commitWorldTick`/`traceWorldTick` do that, separately, so a caller can
 * run several ticks before committing any of them (catchup.ts's
 * chunking).
 */
export function stepWorldTick(
  state: WorldState,
  prng: PrngState,
  queue: readonly QueuedProposal[],
  options: StepOptions = {},
): WorldTickOutcome {
  const { admitted, overflow, goalOnly } = admitWithinCap(
    queue,
    state.rules.maxProposalsPerTick,
  );
  const declarations = new Map(
    goalOnly.map((queued) => [queued, goalOnlyOf(queued.proposal)] as const),
  );
  // The world engine runs the queue in its original order, a rescued goal
  // declaration standing where its action stood: a later set must replace an
  // earlier one, and a later end must end it.
  const admittedSet = new Set(admitted);
  const runQueue = queue.flatMap((queued) => {
    if (admittedSet.has(queued)) return [queued.proposal];
    const declaration = declarations.get(queued);
    return declaration === undefined ? [] : [declaration];
  });
  const result = runTick(state, prng, runQueue, {
    elapsedMs: options.elapsedMs,
    approximate: options.approximate,
  });
  const overflowGoalEvents = new Map<QueuedProposal, readonly WorldEvent[]>();
  for (const [queued, declaration] of declarations) {
    const record = result.committed.find((c) => c.proposal === declaration);
    if (record && record.events.length > 0) {
      overflowGoalEvents.set(queued, record.events);
    }
  }
  return { result, admitted, overflow, overflowGoalEvents, refused: [] };
}

export type CommitOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: DegradedReason;
      readonly message: string;
    };

const OPERATOR_ENTITY_ID = toEntityId("operator");

/**
 * Records a pause/resume as an operator event, distinct from any
 * character action: it never goes through `runTick`/`validateProposal`
 * and produces no `WorldEvent`. Returned as a callback rather than called
 * directly, so both `server.ts`'s `/pause`/`/resume` handlers and
 * catchup.ts's mid-catch-up pause can pass it to `commitWorldTick`'s
 * `onCommitted` hook and have it write inside the same transaction as
 * the clock transition -- a trace failure then rolls the transition back
 * exactly like a world-state write failure would, instead of leaving the
 * clock changed under an outcome that reports failure.
 */
export function recordOperatorEvent(kind: string): (db: Database) => void {
  return (db) => {
    recordObservation(db, {
      schemaVersion: 1,
      id: createObservationId(),
      observer: OPERATOR_ENTITY_ID,
      stateRevision: 0,
      factsRead: [`operator:${kind}`],
      source: "operator",
    });
  };
}

/**
 * Commits `events` in one store transaction; every proposal outcome in
 * `traceOutcomes` is written inside that same transaction (via
 * `commitTick`'s `onCommitted` hook), so a trace write failure rolls the
 * whole tick back exactly like a world-state write failure would. A
 * thrown error (a store write failure, including `SQLITE_FULL`, or a
 * trace write failure) is reported, never thrown -- nothing partially
 * commits either way.
 */
export function commitWorldTick(
  deps: TickDeps,
  events: readonly WorldEvent[],
  commitOptions: {
    readonly tick: number;
    readonly simTimeMs: number;
    readonly prngState: string;
    readonly cursorWallMs: number;
    readonly paused: boolean;
  },
  traceOutcomes: readonly WorldTickOutcome[] = [],
  /** An additional write to run inside the same transaction, after `traceOutcomes` -- e.g. a pause/resume operator observation, so a failure there rolls back the clock transition exactly like any other trace write failure would. */
  onCommitted?: (db: Database) => void,
): CommitOutcome {
  const commit = deps.commitTick ?? persistCommitTick;
  try {
    commit(deps.store, deps.reducers, {
      events,
      ...commitOptions,
      onCommitted: (db) => {
        for (const outcome of traceOutcomes) {
          traceWorldTick(db, outcome);
        }
        onCommitted?.(db);
      },
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: classifyStoreError(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Records an observation `screenObservations` has already cleared; a conflict means the screen was bypassed or is wrong, and throws. */
function recordScreenedObservation(
  traceDb: Database,
  observation: ObservationRecord,
): void {
  const result = recordObservation(traceDb, observation);
  if (result.kind === "conflict") {
    throw new Error(
      `invariant breach: observation ${observation.id} is already bound to different content, but a proposal citing it reached the trace unscreened`,
    );
  }
}

/** Records every queued proposal's observation and outcome (committed, rejected, or over-limit) to the trace, and consumes the external ones from the journal -- called inside the tick's own transaction, so neither trace rows nor consumption outlive a rolled-back tick. */
export function traceWorldTick(
  traceDb: Database,
  outcome: WorldTickOutcome,
): void {
  const byProposal = new Map(
    outcome.admitted.map((queued) => [queued.proposal, queued] as const),
  );
  /** How each proposal ended this tick, for the journal rows of the external ones. */
  const terminal = new Map<ProposalId, ExternalProposalOutcome>();

  // `screenObservations` already refused any proposal whose observation id is
  // bound to different content, so an admitted or over-limit observation can
  // only be new or an exact reuse. A conflict here is a broken invariant, not
  // an outcome: it throws, the tick's transaction rolls back, and the commit
  // reports a store error rather than silently attributing evidence to the
  // wrong record.
  for (const queued of outcome.admitted) {
    recordScreenedObservation(traceDb, queued.observation);
  }
  for (const queued of outcome.refused) {
    // Its own observation is not recorded: the id already means something
    // else. The outcome names the refusal, and the trace shows no
    // observation hop for it.
    recordProposalOutcome(traceDb, {
      proposalId: queued.id,
      observationId: queued.observation.id,
      correlationId: toCorrelationId(String(queued.observation.id)),
      causationId: toCausationId(String(queued.observation.id)),
      proposal: queued.proposal,
      outcome: "rejected",
      reason: "observation-conflict",
    });
    terminal.set(queued.id, {
      status: "rejected",
      reason: "observation-conflict",
    });
  }
  for (const queued of outcome.overflow) {
    recordScreenedObservation(traceDb, queued.observation);
    recordProposalOutcome(traceDb, {
      proposalId: queued.id,
      observationId: queued.observation.id,
      correlationId: toCorrelationId(String(queued.observation.id)),
      causationId: toCausationId(String(queued.observation.id)),
      proposal: queued.proposal,
      outcome: "rejected",
      reason: "over-limit",
      // The action was over the limit; a goal change it carried was not.
      eventIds: (outcome.overflowGoalEvents.get(queued) ?? []).map(
        (event) => event.id,
      ),
    });
    terminal.set(queued.id, { status: "rejected", reason: "over-limit" });
  }
  for (const record of outcome.result.committed) {
    const queued = byProposal.get(record.proposal);
    if (!queued) {
      continue;
    }
    recordProposalOutcome(traceDb, {
      proposalId: queued.id,
      observationId: queued.observation.id,
      correlationId: toCorrelationId(String(queued.observation.id)),
      causationId: toCausationId(String(queued.observation.id)),
      proposal: record.proposal,
      outcome: "committed",
      eventIds: record.events.map((event) => event.id),
    });
    terminal.set(queued.id, { status: "committed" });
  }
  for (const record of outcome.result.rejected) {
    const queued = byProposal.get(record.proposal);
    if (!queued) {
      continue;
    }
    recordProposalOutcome(traceDb, {
      proposalId: queued.id,
      observationId: queued.observation.id,
      correlationId: toCorrelationId(String(queued.observation.id)),
      causationId: toCausationId(String(queued.observation.id)),
      proposal: record.proposal,
      outcome: "rejected",
      reason: record.reason,
      // The action was refused; a goal change it carried was not, and the
      // trace row names the events that recorded it.
      eventIds: record.goalEvents.map((event) => event.id),
    });
    terminal.set(queued.id, { status: "rejected", reason: record.reason });
  }
  // A model proposal's request joins the trace with the proposal's outcome, in
  // the same transaction. Refused proposals count: the model was still asked.
  for (const queued of [
    ...outcome.admitted,
    ...outcome.overflow,
    ...outcome.refused,
  ]) {
    if (queued.modelRequest) {
      recordModelRequest(traceDb, {
        ...queued.modelRequest,
        proposalId: queued.id,
      });
    }
  }
  // Every external proposal this tick took, committed, rejected, or over the
  // limit, now has its terminal outcome above; consume it, with that outcome
  // on its journal row, in the same transaction so it can never run again.
  for (const queued of [
    ...outcome.admitted,
    ...outcome.overflow,
    ...outcome.refused,
  ]) {
    if (!queued.external) {
      continue;
    }
    const ended = terminal.get(queued.id);
    if (!ended) {
      throw new Error(`proposal ${queued.id} ended the tick with no outcome`);
    }
    markExternalProposalConsumed(
      traceDb,
      queued.id,
      outcome.result.state.tick,
      ended,
    );
  }
}

export type TickStepResult =
  | {
      readonly kind: "committed";
      readonly state: WorldState;
      readonly prng: PrngState;
      readonly nextQueue: readonly QueuedProposal[];
      readonly events: number;
    }
  | {
      readonly kind: "store-error";
      readonly reason: DegradedReason;
      readonly message: string;
    };

/** One live tick: `stepWorldTick` then `commitWorldTick`, which writes the tick's trace rows inside the same transaction as its world-state commit. */
export function applyOneTick(
  state: WorldState,
  prng: PrngState,
  queue: readonly QueuedProposal[],
  deps: TickDeps,
  commit: {
    readonly cursorWallMs: number;
    readonly paused: boolean;
    readonly elapsedMs?: number;
    readonly approximate?: boolean;
  },
): TickStepResult {
  let screened: ReturnType<typeof screenObservations>;
  try {
    screened = screenObservations(deps.traceDb, queue);
  } catch (error) {
    // The trace could not be read: a store failure like any other, reported
    // rather than thrown.
    return {
      kind: "store-error",
      reason: classifyStoreError(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const { runnable, refused } = screened;
  const outcome: WorldTickOutcome = {
    ...stepWorldTick(state, prng, runnable, {
      elapsedMs: commit.elapsedMs,
      approximate: commit.approximate,
    }),
    refused,
  };
  const committed = commitWorldTick(
    deps,
    outcome.result.events,
    {
      tick: outcome.result.state.tick,
      simTimeMs: outcome.result.state.simTime,
      prngState: serializePrngState(outcome.result.prng),
      cursorWallMs: commit.cursorWallMs,
      paused: commit.paused,
    },
    [outcome],
  );
  if (!committed.ok) {
    return {
      kind: "store-error",
      reason: committed.reason,
      message: committed.message,
    };
  }
  return {
    kind: "committed",
    state: outcome.result.state,
    prng: outcome.result.prng,
    nextQueue: buildRoutineQueue(outcome.result.state),
    events: outcome.result.events.length,
  };
}

// --- Proposal intake ---------------------------------------------------------

/**
 * Checks a legend proposal's `linkedEventId` against the store's committed
 * events before it is ever queued: an unknown id is rejected here, so a
 * legend can only ever commit as verified when its link is real (the world
 * engine itself stays storage-free and never re-checks this).
 */
export function checkLegendIntake(
  db: Database,
  proposal: Proposal,
): RuleRejection | undefined {
  if (proposal.kind !== "legend" || proposal.linkedEventId === undefined) {
    return undefined;
  }
  if (getEventRow(db, proposal.linkedEventId) === undefined) {
    return reject(
      "malformed",
      `legend linkedEventId ${proposal.linkedEventId} does not reference a committed event`,
    );
  }
  return undefined;
}

/** Parses an untrusted proposal payload, then runs the service's own intake checks (currently: legend link validity) that the storage-free world engine cannot run itself. */
export function intakeProposal(db: Database, raw: unknown): SubmitResult {
  const parsed = submitProposal(raw);
  if (!parsed.ok) {
    return parsed;
  }
  const legendRejection = checkLegendIntake(db, parsed.proposal);
  if (legendRejection) {
    return {
      ok: false,
      rejection: {
        reason: legendRejection.reason,
        message: legendRejection.message,
      },
    };
  }
  return parsed;
}
