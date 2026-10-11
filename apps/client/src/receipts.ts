// Presentation receipts: one relay per event id per session, for events the
// renderer actually drew. The dedup set belongs to one session and resets
// when the session id changes. A failed relay is reported through
// `onError` and never retried automatically; the caller may present the
// same event again, which relays it again.
//
// Relays are paced. A frame carries a ten-tick window of drawable events and
// the service answers 429 past 50 receipts in a second, yet a draw that finds
// the whole window unreceipted (a realm switched back to, the first frame
// after a stall) presents all of it at once. An event over the pace is
// `deferred`: not relayed, not marked, not an error. It is relayed when it is
// presented again, which the next frame does while it is still in the window.

/** Relays allowed in any second; the service's own limit is 50 (`RECEIPT_LIMIT_PER_WINDOW` in the simulation server), kept clear of by a margin for timing jitter. */
export const RECEIPT_RATE_PER_SECOND = 40;
const RATE_WINDOW_MS = 1000;

export interface ReceiptError {
  readonly sessionId: string;
  readonly eventId: string;
  readonly message: string;
}

export type ReceiptResult = "sent" | "duplicate" | "deferred" | "failed";

export interface ReceiptEmitter {
  present(sessionId: string, eventId: string): Promise<ReceiptResult>;
}

export interface ReceiptEmitterDeps {
  presentEvent(eventId: string): Promise<void>;
  onError(error: ReceiptError): void;
  /** The clock the pace is measured on, in milliseconds; defaults to `Date.now`. */
  now?(): number;
  /** Relays allowed in any second; defaults to `RECEIPT_RATE_PER_SECOND`. */
  maxPerSecond?: number;
}

export function createReceiptEmitter(deps: ReceiptEmitterDeps): ReceiptEmitter {
  let sessionId: string | undefined;
  let attempted = new Set<string>();
  const now = deps.now ?? Date.now;
  const limit = deps.maxPerSecond ?? RECEIPT_RATE_PER_SECOND;
  // When each relay in the last second started; failures count, as the
  // service counts every request it receives.
  let relayed: number[] = [];

  return {
    async present(nextSessionId, eventId) {
      if (nextSessionId !== sessionId) {
        sessionId = nextSessionId;
        attempted = new Set();
      }
      if (attempted.has(eventId)) {
        return "duplicate";
      }
      const at = now();
      relayed = relayed.filter((started) => at - started < RATE_WINDOW_MS);
      if (relayed.length >= limit) {
        return "deferred";
      }
      relayed.push(at);
      const forSession = attempted;
      forSession.add(eventId);

      try {
        await deps.presentEvent(eventId);
        return "sent";
      } catch (error) {
        // Unmark only inside the session set this attempt started in, so a
        // late failure from an earlier session never touches a later one.
        forSession.delete(eventId);
        deps.onError({
          sessionId: nextSessionId,
          eventId,
          message: error instanceof Error ? error.message : String(error),
        });
        return "failed";
      }
    },
  };
}
