// The god turn runner: gives each god an occasional turn without touching the
// tick. A turn snapshots the last committed state, awaits the model outside
// any transaction (`runGodTurn`), then journals the resulting proposal through
// the same durable intake as `/proposals`, in-process with source `model`. The
// tick admits and consumes it like any other external proposal, revalidating
// it against the world as it is by then.
//
// The journal is the only durable record of a turn. A god with a pending
// journal entry gets no new turn, so a restart needs no turn identity: a turn
// killed before it journaled is simply asked again, and one killed after runs
// once from the journal.
//
// Which god goes next is `pickGod`'s to say (packages/agents/src/scheduler.ts):
// gods that owe an accepted obligation first, then gods a thread is waiting on,
// then the rest in round-robin, with no god passed over more than a round. A god
// on a journey is not offered at all until it ends, unless a thread awaits it. What
// each god is waiting on is read from the world state the turn starts from, by
// the rule the god's own prompt sorts its rows by. The cursor and the skip
// counts live in this closure only: a restart starts them over, and the world
// never reads them.

import {
  type GodTurnDeps,
  type GodTurnResult,
  OWN_EVENT_WINDOW,
  type Pick,
  pickGod,
  type Rotation,
  runGodTurn,
  START_OF_ROTATION,
  schedulingSignals,
} from "@panthea/agents";
import {
  type EntityId,
  type GoalChangeRefusedEvent,
  type JourneyEndedEvent,
  type PracticeRefusedEvent,
  UNPLACED_EVENT_KINDS,
  type WorldEvent,
} from "@panthea/contracts";
import {
  insertExternalProposal,
  listEvents,
  readPendingExternalProposals,
  type Store,
} from "@panthea/persistence";
import {
  createProposalId,
  createRedactor,
  recordModelRequest,
} from "@panthea/telemetry";
import type { WorldState } from "@panthea/world";
import {
  RECENT_EVENT_CAP,
  reportModelOutcome,
  type ServiceStatusRef,
} from "./server";
import { intakeProposal } from "./tick";

/**
 * The lifecycle seam: what the service says about itself that decides whether
 * a turn may start. Dispatch asks; it never infers from frames or from where
 * it was called.
 */
export interface Lifecycle {
  /** The catch-up run at startup has finished. */
  startupCatchUpComplete(): boolean;
  /** Any catch-up run, startup or after sleep, is in progress. */
  catchUpRunning(): boolean;
  /** The world is paused: no new turn starts. A turn already in flight still journals. */
  paused(): boolean;
}

export interface GodTurnRunnerDeps extends GodTurnDeps {
  readonly store: Store;
  /** The last committed state; read when a turn starts. */
  readonly getState: () => WorldState;
  readonly lifecycle: Lifecycle;
  readonly statusRef: ServiceStatusRef;
  readonly onLog?: (message: string) => void;
  /** Every loaded endpoint key. Replaced before a trace row is stored or a line is logged, and an answer that holds one is never journaled. */
  readonly secrets?: Iterable<string>;
}

export interface GodTurnRunner {
  /** Starts a turn when the lifecycle allows one, none is in flight, and a god is eligible. Returns at once whether or not it did; it never awaits inference. */
  dispatch(): boolean;
  inFlight(): boolean;
  /** Resolves when no turn is in flight. */
  idle(): Promise<void>;
  /** Abandons the turn in flight: nothing more is journaled. */
  stop(): void;
}

/**
 * The newest `OWN_EVENT_WINDOW` events the god's own actions committed, up to
 * `toSequence`, oldest first: moves, crossings, the reports and legends it told
 * (which the frame window leaves out, being unplaced or newest-capped), and its
 * strikes. Only committed events can be here, so a rejected or exhausted turn
 * is never shown to the god, and replay reproduces exactly this. The SQL mirrors
 * `authoredAction` in packages/agents, and a test holds the two together.
 */
export function readOwnEvents(
  db: Store["db"],
  god: EntityId,
  toSequence: number,
): WorldEvent[] {
  const rows = db
    .query(
      `SELECT payload FROM events
       WHERE sequence <= ?
         AND (
           (kind IN ('entity-moved', 'realm-transitioned', 'report-told', 'legend-recorded')
             AND json_extract(payload, '$.entityId') = ?)
           OR (kind = 'building-damaged' AND json_extract(payload, '$.actor') = ?)
           OR (kind = 'building-ignited'
             AND json_extract(payload, '$.cause.kind') = 'strike'
             AND json_extract(payload, '$.cause.actor') = ?)
         )
       ORDER BY sequence DESC
       LIMIT ?`,
    )
    .all(toSequence, god, god, god, OWN_EVENT_WINDOW) as { payload: string }[];
  return rows.reverse().map((row) => JSON.parse(row.payload) as WorldEvent);
}

/**
 * The god's latest refused goal change up to `toSequence`, if any. Read inside
 * the turn's handled path with the other store reads, so a store fault abandons
 * the turn like any other.
 */
export function readLatestRefusal(
  db: Store["db"],
  god: EntityId,
  toSequence: number,
): GoalChangeRefusedEvent | undefined {
  const row = db
    .query(
      `SELECT payload FROM events
       WHERE sequence <= ? AND kind = 'goal-change-refused'
         AND json_extract(payload, '$.entityId') = ?
       ORDER BY sequence DESC
       LIMIT 1`,
    )
    .get(toSequence, god) as { payload: string } | null;
  return row === null
    ? undefined
    : (JSON.parse(row.payload) as GoalChangeRefusedEvent);
}

/**
 * The god's latest journey ending up to `toSequence`, if any. Whether it is
 * still news (the god is on no journey and has done nothing of its own since)
 * is the prompt's to say, from the state and the god's own events. Read inside
 * the turn's handled path with the other store reads.
 */
export function readLatestJourneyEnding(
  db: Store["db"],
  god: EntityId,
  toSequence: number,
): JourneyEndedEvent | undefined {
  const row = db
    .query(
      `SELECT payload FROM events
       WHERE sequence <= ? AND kind = 'journey-ended'
         AND json_extract(payload, '$.entityId') = ?
       ORDER BY sequence DESC
       LIMIT 1`,
    )
    .get(toSequence, god) as { payload: string } | null;
  return row === null
    ? undefined
    : (JSON.parse(row.payload) as JourneyEndedEvent);
}

/**
 * The god's latest refused practice move (or talk around an open thread) up to
 * `toSequence`, if no practice move of its own has committed since. A refusal
 * is private world state like the goal refusal: committed with the rejected
 * proposal, so replay reproduces exactly what the god is told. The god's own
 * next committed move answers it, and it is no longer shown. Read inside the
 * turn's handled path with the other store reads.
 */
export function readLatestPracticeRefusal(
  db: Store["db"],
  god: EntityId,
  toSequence: number,
): PracticeRefusedEvent | undefined {
  const row = db
    .query(
      `SELECT payload FROM events
       WHERE sequence <= ? AND kind = 'practice-refused'
         AND json_extract(payload, '$.entityId') = ?
         AND sequence > COALESCE(
           (SELECT MAX(sequence) FROM events
            WHERE sequence <= ? AND kind IN ('practice-opened', 'practice-moved')
              AND json_extract(payload, '$.entityId') = ?),
           0)
       ORDER BY sequence DESC
       LIMIT 1`,
    )
    .get(toSequence, god, toSequence, god) as { payload: string } | null;
  return row === null
    ? undefined
    : (JSON.parse(row.payload) as PracticeRefusedEvent);
}

/** The actors with a pending journal entry: they have a proposal waiting and get no new turn. */
function actorsWithPendingProposals(store: Store): ReadonlySet<string> {
  const actors = new Set<string>();
  for (const entry of readPendingExternalProposals(
    store.db,
    Number.MAX_SAFE_INTEGER,
  )) {
    const actor = (entry.proposal as { actor?: unknown } | null)?.actor;
    if (typeof actor === "string") actors.add(actor);
  }
  return actors;
}

export function createGodTurnRunner(deps: GodTurnRunnerDeps): GodTurnRunner {
  const redact = createRedactor(deps.secrets ?? []);
  const emit = deps.onLog ?? (() => {});
  const log = (message: string): void => emit(redact(message));
  const record = (
    db: Store["db"],
    request: Parameters<typeof recordModelRequest>[1],
  ): void => {
    recordModelRequest(db, request, Date.now(), redact);
  };
  let running: Promise<void> | undefined;
  let abort: AbortController | undefined;
  /** The rotation's memory: who was served last and how many picks each god has been passed over. In this process only. */
  let rotation: Rotation = START_OF_ROTATION;

  /** The god that takes the next turn, with the memory that follows the pick; nothing is kept until the turn starts. */
  function nextGod(state: WorldState): Pick | undefined {
    const pending = actorsWithPendingProposals(deps.store);
    const candidates = [...state.actors.values()]
      .filter(
        (actor) =>
          actor.isDeity === true &&
          actor.alive &&
          deps.profiles.has(actor.id) &&
          !pending.has(actor.id),
      )
      .map((actor) => actor.id);
    const signals = schedulingSignals(state, candidates);
    // A god on a journey takes no turn until it arrives or the journey ends, unless a thread waits on its answer: owing alone does not call it back. A god kept out is not offered, so it is not passed over either.
    const eligible = candidates.filter(
      (god) => !state.journeys.has(god) || signals.get(god)?.awaited === true,
    );
    return pickGod(
      eligible.map((god) => ({
        god,
        obligationDeadline: signals.get(god)?.obligationDeadline,
        awaited: signals.get(god)?.awaited ?? false,
      })),
      rotation,
    );
  }

  /** Records the request, then journals the proposal: a committed proposal always has its request, and a crash between the two leaves at worst a request with no proposal. */
  function conclude(result: GodTurnResult): void {
    // A turn the cap stopped before any request says nothing about the model: no provider was asked.
    if (
      result.kind !== "exhausted" ||
      result.request.exhaustedReason === undefined
    ) {
      reportModelOutcome(deps.statusRef, result.request.route);
    }
    const db = deps.store.db;
    if (result.kind !== "proposal") {
      record(db, result.request);
      return;
    }
    // A key can only reach an answer if an endpoint echoed it back; the answer
    // would become world content, so it goes no further than its trace row.
    if (
      redact(JSON.stringify(result.proposal)) !==
      JSON.stringify(result.proposal)
    ) {
      record(db, result.request);
      log(
        `god turn for ${result.proposal.actor} refused: the answer contained a key and was not journaled`,
      );
      return;
    }
    const intake = intakeProposal(db, result.proposal);
    if (!intake.ok) {
      record(db, result.request);
      log(`god turn refused at intake: ${intake.rejection.message}`);
      return;
    }
    const proposalId = createProposalId();
    record(db, { ...result.request, proposalId });
    insertExternalProposal(db, {
      proposalId,
      proposal: intake.proposal,
      observation: result.observation,
    });
  }

  /**
   * One turn, start to finish, with every store read and write inside the
   * handled path: whatever goes wrong is logged and the turn abandoned, so the
   * promise `dispatch` keeps never rejects. Nothing awaits it, and a rejection
   * nobody handles would end the process.
   */
  async function turn(god: EntityId, state: WorldState, signal: AbortSignal) {
    try {
      const recentEvents = listEvents(deps.store.db, {
        toSequence: state.lastSequence,
        excludeKinds: UNPLACED_EVENT_KINDS,
        newest: RECENT_EVENT_CAP,
      });
      const ownEvents = readOwnEvents(deps.store.db, god, state.lastSequence);
      const refusal = readLatestRefusal(deps.store.db, god, state.lastSequence);
      const practiceRefusal = readLatestPracticeRefusal(
        deps.store.db,
        god,
        state.lastSequence,
      );
      const journeyEnding = readLatestJourneyEnding(
        deps.store.db,
        god,
        state.lastSequence,
      );
      const result = await runGodTurn(deps, {
        state,
        actorId: god,
        recentEvents,
        ownEvents,
        ...(refusal === undefined ? {} : { refusal }),
        ...(practiceRefusal === undefined ? {} : { practiceRefusal }),
        ...(journeyEnding === undefined ? {} : { journeyEnding }),
        signal,
      });
      if (result && !signal.aborted) conclude(result);
    } catch (error) {
      log(
        `god turn for ${god} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    dispatch() {
      const { lifecycle } = deps;
      if (running !== undefined) return false;
      // Called from the tick loop's timer: reading the lifecycle (paused reads
      // the store), state, or the journal must never throw into it. A failed
      // read is logged and no turn starts.
      let state: WorldState;
      let pick: Pick | undefined;
      try {
        if (
          !lifecycle.startupCatchUpComplete() ||
          lifecycle.catchUpRunning() ||
          lifecycle.paused()
        ) {
          return false;
        }
        state = deps.getState();
        pick = nextGod(state);
      } catch (error) {
        log(
          `god turn not started: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
      if (pick === undefined) return false;
      const { god } = pick;
      rotation = pick.rotation;
      abort = new AbortController();
      running = turn(god, state, abort.signal).finally(() => {
        running = undefined;
        abort = undefined;
      });
      return true;
    },
    inFlight: () => running !== undefined,
    idle: async () => {
      await running;
    },
    stop() {
      abort?.abort();
    },
  };
}
