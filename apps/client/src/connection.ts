// The client's only link to the simulation: two Tauri commands, one that
// streams committed-state frames over a Channel and one that relays a
// presentation receipt. Every payload is untrusted data -- it is parsed
// through the contracts and decoded through the world codec before any
// other module sees it, and nothing received is ever evaluated or written
// to markup. A bad payload is dropped and reported; nothing is thrown into
// the Channel handler.

import { parseSyncFrame, type SyncFrame } from "@panthea/contracts";
import { decode, type WorldState } from "@panthea/world";
import { Channel, invoke } from "@tauri-apps/api/core";
import { receiptFailure } from "./receipts";

export interface ConnectedFrame {
  readonly frame: SyncFrame;
  readonly state: WorldState;
}

export type ConnectionError =
  | {
      readonly kind: "invalid-frame";
      readonly message: string;
      readonly path: string;
    }
  | { readonly kind: "invalid-state"; readonly message: string }
  | { readonly kind: "handler-failed"; readonly message: string }
  | { readonly kind: "subscribe-failed"; readonly message: string };

/** The two shell commands the client may call, behind a seam tests replace. */
export interface Transport {
  /** Subscribes to committed-state frames; replaces any earlier subscription, and the shell sends the latest frame right away. */
  subscribeWorld(onPayload: (payload: unknown) => void): Promise<void>;
  /** Relays a receipt for `eventId`, attributed to `sessionId`; rejects with a `StaleSessionError` when the shell says that session has ended. */
  presentEvent(eventId: string, sessionId: string): Promise<void>;
}

export interface ModelSettingsTransport {
  readModelSettings(): Promise<string | null>;
  saveModelSettings(settings: string): Promise<void>;
  setEndpointKey(keyRef: string, key: string): Promise<void>;
  deleteEndpointKey(keyRef: string): Promise<void>;
  endpointKeyStatus(
    keyRefs: readonly string[],
  ): Promise<Record<string, "set" | "missing">>;
}

export function createTauriTransport(): Transport & ModelSettingsTransport {
  return {
    async subscribeWorld(onPayload) {
      const frames = new Channel<unknown>();
      frames.onmessage = onPayload;
      await invoke("subscribe_world", { frames });
    },
    async presentEvent(eventId, sessionId) {
      try {
        await invoke("present_event", { eventId, sessionId });
      } catch (error) {
        throw receiptFailure(error);
      }
    },
    async readModelSettings() {
      return invoke<string | null>("read_model_settings");
    },
    async saveModelSettings(settings) {
      await invoke("save_model_settings", { settings });
    },
    async setEndpointKey(keyRef, key) {
      await invoke("set_endpoint_key", { keyRef, key });
    },
    async deleteEndpointKey(keyRef) {
      await invoke("delete_endpoint_key", { keyRef });
    },
    async endpointKeyStatus(keyRefs) {
      return invoke<Record<string, "set" | "missing">>("endpoint_key_status", {
        keyRefs,
      });
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Subscribes to the frame stream. Every payload is parsed and decoded;
 * a valid one reaches `onFrame`, an invalid one reaches `onError` and is
 * dropped. A throw from either callback is caught and reported (a throw
 * from `onError` itself is swallowed), so nothing propagates into the
 * Channel handler. A failed subscription is reported through `onError`.
 */
export async function subscribe(
  onFrame: (connected: ConnectedFrame) => void,
  onError: (error: ConnectionError) => void,
  transport: Transport = createTauriTransport(),
): Promise<void> {
  const report = (error: ConnectionError): void => {
    try {
      onError(error);
    } catch {
      // The error channel itself failed; there is nowhere left to report.
    }
  };

  const receive = (payload: unknown): void => {
    const parsed = parseSyncFrame(payload);
    if (!parsed.ok) {
      report({
        kind: "invalid-frame",
        message: parsed.message,
        path: parsed.path,
      });
      return;
    }

    let state: WorldState;
    try {
      state = decode(parsed.value.state);
    } catch (error) {
      report({ kind: "invalid-state", message: messageOf(error) });
      return;
    }

    try {
      onFrame({ frame: parsed.value, state });
    } catch (error) {
      report({ kind: "handler-failed", message: messageOf(error) });
    }
  };

  try {
    await transport.subscribeWorld(receive);
  } catch (error) {
    report({ kind: "subscribe-failed", message: messageOf(error) });
  }
}

/** Relays a presentation receipt for a committed event the renderer drew; rejects if the shell cannot relay it. */
export function presentEvent(
  eventId: string,
  sessionId: string,
  transport: Transport = createTauriTransport(),
): Promise<void> {
  return transport.presentEvent(eventId, sessionId);
}
