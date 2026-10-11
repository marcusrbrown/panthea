// Presentation receipts: one relay per event id per session, for events the
// renderer actually drew. The dedup set belongs to one session and resets
// when the session id changes. A failed relay is reported through
// `onError` and never retried automatically; the caller may present the
// same event again, which relays it again.
//
// Relays are paced. A frame carries a ten-tick window of drawable events and
// the service answers 429 past 50 receipts in a window, yet a draw that finds
// the whole window unreceipted (a realm switched back to, the first frame
// after a stall) presents all of it at once. An event over the pace is held
// in the emitter, already drawn, and drained in the order it was presented as
// slots free, on the emitter's own schedule: a paused world broadcasts no
// further frame to present it again. A held event is `deferred`, and
// presenting it again does not queue it twice. A session change, noticed by a
// present or told by `observeSession`, or `dispose` drops what is held.
//
// Every relay names the session its event was drawn under, and the shell
// refuses one that is not the sidecar's current session (`stale-session`): a
// receipt held across a sidecar restart is dropped there, never stamped with
// the new session. The emitter treats that refusal as a drop, not an error.

/** Relays allowed in any second; the service's own limit is 50 (`RECEIPT_LIMIT_PER_WINDOW` in the simulation server), kept clear of by a margin for timing jitter. */
export const RECEIPT_RATE_PER_SECOND = 40;

/**
 * The service counts in a fixed window that opens at its first request and
 * resets at the first request more than this long after, so a request exactly
 * this long after the opener is still counted in it. A relay therefore counts
 * against the pace until it is more than this old; any service window then
 * spans at most this long and holds at most the pace.
 */
const RATE_WINDOW_MS = 1000;

/** What the shell rejects a receipt with when its session is no longer the sidecar's. */
export const STALE_SESSION = "stale-session";

/** A receipt the shell refused because the session it was drawn under is no longer in force. */
export class StaleSessionError extends Error {
  constructor() {
    super(STALE_SESSION);
    this.name = "StaleSessionError";
  }
}

/** Gives the shell's stale-session rejection its type; any other failure passes through unchanged. */
export function receiptFailure(error: unknown): unknown {
  return error === STALE_SESSION ? new StaleSessionError() : error;
}

export interface ReceiptError {
  readonly sessionId: string;
  readonly eventId: string;
  readonly message: string;
}

export type ReceiptResult =
  | "sent"
  | "duplicate"
  | "deferred"
  | "dropped"
  | "failed";

export interface ReceiptEmitter {
  present(sessionId: string, eventId: string): Promise<ReceiptResult>;
  /** Drops the held events and cancels the drain. The emitter stays usable: a later present starts afresh. */
  dispose(): void;
  /**
   * Tells the emitter the session now in force, from every accepted frame
   * whether or not the view draws anything. On a change it resets the dedup
   * set and drops the held events before any further relay; `present` alone
   * would notice only when an event is next presented, and the shell stamps
   * each relay with the sidecar's session at the time it is sent.
   */
  observeSession(sessionId: string): void;
}

export interface ReceiptEmitterDeps {
  /**
   * Relays one receipt, stamped by the shell with `sessionId`, the session the
   * event was drawn under; rejects with a `StaleSessionError` when that is no
   * longer the sidecar's session.
   */
  presentEvent(eventId: string, sessionId: string): Promise<void>;
  onError(error: ReceiptError): void;
  /** The clock the pace is measured on, in milliseconds; defaults to `Date.now`. */
  now?(): number;
  /** Runs `run` once after `delayMs` and returns a function that cancels it; defaults to `setTimeout`. */
  schedule?(run: () => void, delayMs: number): () => void;
  /** Relays allowed in any second; defaults to `RECEIPT_RATE_PER_SECOND`. */
  maxPerSecond?: number;
}

function defaultSchedule(run: () => void, delayMs: number): () => void {
  const handle = setTimeout(run, delayMs);
  return () => clearTimeout(handle);
}

export function createReceiptEmitter(deps: ReceiptEmitterDeps): ReceiptEmitter {
  let sessionId: string | undefined;
  let attempted = new Set<string>();
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? defaultSchedule;
  const limit = deps.maxPerSecond ?? RECEIPT_RATE_PER_SECOND;
  // When each relay still counted against the pace started, oldest first;
  // failures count, as the service counts every request it receives.
  let relayed: number[] = [];
  // Drawn events waiting for a slot, in the order they were presented.
  let held: string[] = [];
  let heldSet = new Set<string>();
  let cancelDrain: (() => void) | undefined;

  function prune(at: number): void {
    relayed = relayed.filter((started) => at - started <= RATE_WINDOW_MS);
  }

  function dropHeld(): void {
    held = [];
    heldSet = new Set();
    cancelDrain?.();
    cancelDrain = undefined;
  }

  async function relay(
    forSessionId: string,
    eventId: string,
  ): Promise<ReceiptResult> {
    relayed.push(now());
    const forSession = attempted;
    forSession.add(eventId);
    try {
      await deps.presentEvent(eventId, forSessionId);
      return "sent";
    } catch (error) {
      if (error instanceof StaleSessionError) {
        // The session this was drawn under has ended. Not an error and never
        // retried: it stays marked, and the session's remaining held events,
        // all drawn under it, would be refused the same way.
        if (forSessionId === sessionId) dropHeld();
        return "dropped";
      }
      // Unmark only inside the session set this attempt started in, so a
      // late failure from an earlier session never touches a later one.
      forSession.delete(eventId);
      deps.onError({
        sessionId: forSessionId,
        eventId,
        message: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    }
  }

  /** Relays held events while slots are free, then arms the next drain for when one frees. */
  function drain(): void {
    cancelDrain?.();
    cancelDrain = undefined;
    const at = now();
    prune(at);
    while (held.length > 0 && relayed.length < limit && sessionId) {
      const eventId = held.shift() as string;
      heldSet.delete(eventId);
      void relay(sessionId, eventId);
    }
    const oldest = relayed[0];
    if (held.length > 0 && oldest !== undefined) {
      const frees = oldest + RATE_WINDOW_MS + 1;
      cancelDrain = schedule(drain, Math.max(1, frees - at));
    }
  }

  function syncSession(nextSessionId: string): void {
    if (nextSessionId === sessionId) return;
    sessionId = nextSessionId;
    attempted = new Set();
    dropHeld();
  }

  return {
    async present(nextSessionId, eventId) {
      syncSession(nextSessionId);
      if (attempted.has(eventId)) {
        return "duplicate";
      }
      if (heldSet.has(eventId)) {
        return "deferred";
      }
      // Anything already held goes first: a new event never jumps the queue.
      drain();
      prune(now());
      if (held.length === 0 && relayed.length < limit) {
        return relay(nextSessionId, eventId);
      }
      held.push(eventId);
      heldSet.add(eventId);
      drain();
      return "deferred";
    },
    dispose() {
      dropHeld();
    },
    observeSession: syncSession,
  };
}
