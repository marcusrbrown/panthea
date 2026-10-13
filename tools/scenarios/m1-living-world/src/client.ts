// A headless client built from the real apps/client modules: the frame
// parser and subscription (connection.ts), the store and view model
// (store.ts), the observer (observer.ts), event placement for the viewed
// realm (renderer/presentation.ts), and the receipt emitter (receipts.ts).
// Only the transport is replaced: it polls `GET /frame` and posts
// `POST /receipts` to the sidecar the way the desktop shell's proxy does,
// stamping each receipt with the latest frame's session id.

import { subscribe, type Transport } from "@panthea/client/src/connection";
import {
  createObserver,
  type ObserverTarget,
} from "@panthea/client/src/observer";
import {
  createReceiptEmitter,
  StaleSessionError,
} from "@panthea/client/src/receipts";
import {
  drawableEvents,
  receiptDrawnEvents,
} from "@panthea/client/src/renderer/presentation";
import {
  createWorldStore,
  type WorldViewModel,
} from "@panthea/client/src/store";
import { parseSyncFrame, type Realm, type SyncFrame } from "@panthea/contracts";
import type { Sidecar } from "./sidecar";

const POLL_INTERVAL_MS = 250;

export type FrameBody =
  | { readonly ok: true; readonly frame: SyncFrame }
  | { readonly ok: false; readonly message: string };

/** Parses a `GET /frame` body through the contracts parser, the way the real client does, before anything reads a field off it. */
export function parseFrameBody(body: unknown): FrameBody {
  const parsed = parseSyncFrame(body);
  return parsed.ok
    ? { ok: true, frame: parsed.value }
    : {
        ok: false,
        message: `frame did not parse: ${parsed.path}: ${parsed.message}`,
      };
}

export interface PresentedEvent {
  readonly eventId: string;
  readonly kind: string;
  readonly sessionId: string;
  readonly realm: Realm;
}

export interface HeadlessClient {
  /** Points the client at a (re)started sidecar; the next poll delivers a fresh frame. */
  attach(sidecar: Sidecar): void;
  /** Stops polling. */
  stop(): void;
  view(): WorldViewModel | undefined;
  /** Every receipt this client relayed successfully, in order. */
  presented(): readonly PresentedEvent[];
  /** Frame, receipt, and relay errors the client reported. */
  errors(): readonly string[];
  /** Placed events this client's viewed realm has shown, by event id, across every frame it received. */
  drawnIds(): ReadonlySet<string>;
}

export function createHeadlessClient(
  follow: ObserverTarget,
  initial: Sidecar,
): HeadlessClient {
  let target = initial;
  let latestSessionId: string | undefined;
  let lastForwarded: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  const presented: PresentedEvent[] = [];
  const errors: string[] = [];
  const drawn = new Set<string>();
  const kindsById = new Map<string, string>();

  const store = createWorldStore();
  const observer = createObserver();
  observer.pick(follow);

  let onPayload: ((payload: unknown) => void) | undefined;

  const transport: Transport = {
    async subscribeWorld(handler) {
      onPayload = handler;
      timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
      void poll();
    },
    async presentEvent(eventId, sessionId) {
      // The shell's rule: a receipt is relayed only under the session in force.
      if (latestSessionId === undefined) {
        throw new Error("no frame received yet");
      }
      if (sessionId !== latestSessionId) {
        throw new StaleSessionError();
      }
      const response = await target.request("POST", "/receipts", {
        eventId,
        sessionId,
      });
      if (response.status !== 200) {
        throw new Error(`receipt relay returned ${response.status}`);
      }
    },
  };

  // The desktop shell forwards a frame only when its sequence, status, or
  // session id changes; the poller does the same.
  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const response = await target.request("GET", "/frame");
      if (response.status !== 200) {
        errors.push(`frame: GET /frame answered ${response.status}`);
        return;
      }
      const parsed = parseFrameBody(response.body);
      if (!parsed.ok) {
        errors.push(`frame: ${parsed.message}`);
        return;
      }
      const frame = parsed.frame;
      latestSessionId = frame.sessionId;
      const key = `${frame.sessionId}:${frame.sequence}:${frame.status}`;
      if (key !== lastForwarded) {
        lastForwarded = key;
        onPayload?.(frame);
      }
    } catch {
      // The sidecar is stopped or restarting; the next poll retries.
    } finally {
      polling = false;
    }
  }

  // The emitter paces receipts and drains a burst on its own schedule, so a
  // receipt may go out long after the draw that presented it: it is recorded
  // when the relay succeeds, with the session and realm of that draw.
  const drawnAt = new Map<string, { sessionId: string; realm: Realm }>();
  const emitter = createReceiptEmitter({
    presentEvent: async (eventId, sessionId) => {
      await transport.presentEvent(eventId, sessionId);
      const at = drawnAt.get(eventId);
      if (at === undefined) return;
      presented.push({
        eventId,
        kind: kindsById.get(eventId) ?? "unknown",
        sessionId: at.sessionId,
        realm: at.realm,
      });
    },
    onError: (error) =>
      errors.push(`receipt ${error.eventId}: ${error.message}`),
  });

  // Same rule as App.tsx: draw what the viewed realm places, receipt only that.
  store.onChange((view) => {
    const observation = observer.update(view);
    const realm: Realm =
      observation.kind === "following"
        ? observation.realm
        : observation.kind === "held" && observation.lastKnown
          ? observation.lastKnown.realm
          : "mortal";
    const events = drawableEvents(view, realm);
    for (const event of events) {
      drawn.add(event.id);
      kindsById.set(event.id, event.kind);
    }
    void receiptDrawnEvents(view.sessionId, events, {
      present(sessionId, eventId) {
        drawnAt.set(eventId, { sessionId, realm });
        return emitter.present(sessionId, eventId);
      },
      dispose: () => emitter.dispose(),
      observeSession: (sessionId) => emitter.observeSession(sessionId),
    });
  });

  void subscribe(
    ({ frame, state }) => {
      emitter.observeSession(frame.sessionId);
      store.apply(frame, state);
    },
    (error) => errors.push(`${error.kind}: ${error.message}`),
    transport,
  );

  return {
    attach(next) {
      target = next;
      lastForwarded = undefined;
      void poll();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    view: () => store.viewModel(),
    presented: () => presented,
    errors: () => errors,
    drawnIds: () => drawn,
  };
}
