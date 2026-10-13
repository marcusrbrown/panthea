// The one module that touches Tauri's webview API. Everything else takes a
// `HostTransport`, so the client, the source and their tests never import it.

import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import {
  createStudioHost,
  type HostTransport,
  type StudioHost,
} from "./client";

export function createTauriTransport(): HostTransport {
  return {
    invoke: (command, args) => invoke(command, args),
    openChannel(onMessage) {
      const channel = new Channel<unknown>();
      channel.onmessage = onMessage;
      return channel;
    },
  };
}

/** True inside the packaged (or `tauri dev`) webview; false in a plain browser. */
export const inTauri = (): boolean => isTauri();

let shared: StudioHost | undefined;

/** The webview's one host client: a single snapshot subscription however many views read it. */
export function tauriHost(): StudioHost {
  shared ??= createStudioHost(createTauriTransport());
  return shared;
}
