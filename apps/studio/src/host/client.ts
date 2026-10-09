// A typed client for the native host's named commands. It holds request and
// response shapes and nothing else: no UI, no Tauri import (the transport is
// injected; `./tauri` supplies the real one), no node module. Every reply is
// parsed before it reaches the caller, and a failure always rejects with a
// `HostError`, never a bare string or an untyped object.

import {
  type CommandError,
  type ConfigChoice,
  type ConfigStatus,
  type EditBrought,
  type EditExport,
  type EditOpened,
  type EditReport,
  type Parsed,
  parseCommandError,
  parseConfigChoice,
  parseConfigStatus,
  parseEditBrought,
  parseEditExport,
  parseEditOpened,
  parseEditReport,
  parseSnapshot,
  type StudioSnapshot,
} from "./types";

/** The two things the webview needs from Tauri, behind a seam tests replace. */
export interface HostTransport {
  invoke(
    command: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  /** A channel whose messages go to `onMessage`; the returned handle is passed to the command that fills it. */
  openChannel(onMessage: (payload: unknown) => void): unknown;
}

/** The ops `studio_call` accepts: the native schema table, in its order. A test pins this list to `src-tauri/src/schema.rs`. */
export const STUDIO_OPS = [
  "status",
  "list",
  "sheet",
  "report",
  "edit-report",
  "resolve",
  "source-list",
  "source-resolve",
  "source-keys",
  "generate",
  "reroll",
  "abort",
  "remove",
  "set-create",
  "set-replace-sheet",
  "pick",
  "reject",
  "discard",
  "finish",
  "pack",
  "approve",
  "approve-with-exception",
  "publish",
] as const;
export type StudioOp = (typeof STUDIO_OPS)[number];

export class HostError extends Error implements CommandError {
  readonly code: string;
  readonly retryable: boolean;
  readonly detail?: unknown;

  constructor(error: CommandError) {
    super(error.message === "" ? error.code : error.message);
    this.name = "HostError";
    this.code = error.code;
    this.retryable = error.retryable;
    if (error.detail !== undefined) this.detail = error.detail;
  }
}

const malformed = (message: string) =>
  new HostError({ code: "malformed-reply", message, retryable: false });

/** What a bytes request names: a held atlas, or the placeholder by its hash. */
export type BytesTarget =
  | { readonly source: "canon" | "draft" | "approved"; readonly id: string }
  | { readonly placeholder: string };

export type HostProblem =
  | { readonly kind: "invalid-snapshot"; readonly message: string }
  | { readonly kind: "subscribe-failed"; readonly message: string }
  | { readonly kind: "listener-failed"; readonly message: string };

export interface SnapshotListener {
  onSnapshot(snapshot: StudioSnapshot): void;
  /** Invalid payloads and failures land here; they are dropped, never thrown into the channel handler. */
  onProblem?(problem: HostProblem): void;
}

/** One shared subscription: the host keeps a single channel, so consumers fan out from here. */
export interface SnapshotHub {
  /** Returns the unsubscribe. A listener subscribing late is given the latest snapshot at once. */
  subscribe(listener: SnapshotListener): () => void;
}

export interface StudioHost {
  call(
    op: StudioOp,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  previewBytes(target: BytesTarget, version?: string): Promise<Uint8Array>;
  readonly snapshots: SnapshotHub;
  editOpen(
    editId: string,
    workingSetId: string,
    slots: readonly string[],
  ): Promise<EditOpened>;
  editExport(editId: string): Promise<EditExport>;
  editImport(editId: string, finish?: boolean): Promise<EditBrought>;
  /** The latest save of an open or finished edit; refuses with not-found or wrong-state. */
  editReport(editId: string): Promise<EditReport>;
  configStatus(): Promise<ConfigStatus>;
  configChoose(): Promise<ConfigChoice>;
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function isBytes(value: unknown): value is ArrayBuffer | Uint8Array {
  const tag = Object.prototype.toString.call(value);
  return tag === "[object ArrayBuffer]" || tag === "[object Uint8Array]";
}

function createSnapshotHub(transport: HostTransport): SnapshotHub {
  const listeners = new Set<SnapshotListener>();
  let latest: StudioSnapshot | undefined;
  let generation = 0;
  let started = false;

  const report = (listener: SnapshotListener, problem: HostProblem): void => {
    try {
      listener.onProblem?.(problem);
    } catch {
      // The problem handler itself failed; there is nowhere left to report.
    }
  };

  const deliver = (listener: SnapshotListener, snapshot: StudioSnapshot) => {
    try {
      listener.onSnapshot(snapshot);
    } catch (error) {
      report(listener, { kind: "listener-failed", message: messageOf(error) });
    }
  };

  const receive = (mine: number, payload: unknown): void => {
    if (mine !== generation) return;
    const parsed: Parsed<StudioSnapshot> = parseSnapshot(payload);
    if (!parsed.ok) {
      for (const listener of [...listeners])
        report(listener, { kind: "invalid-snapshot", message: parsed.message });
      return;
    }
    latest = parsed.value;
    for (const listener of [...listeners]) deliver(listener, parsed.value);
  };

  const start = (): void => {
    started = true;
    generation += 1;
    const mine = generation;
    const channel = transport.openChannel((payload) => receive(mine, payload));
    transport
      .invoke("subscribe_studio", { channel })
      .then(undefined, (error) => {
        if (mine !== generation) return;
        // Retire this channel and let the next subscriber try again.
        generation += 1;
        started = false;
        const problem: HostProblem = {
          kind: "subscribe-failed",
          message: parseCommandError(error).message,
        };
        for (const listener of [...listeners]) report(listener, problem);
      });
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (latest !== undefined) deliver(listener, latest);
      if (!started) start();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createStudioHost(transport: HostTransport): StudioHost {
  const invoke = async (
    command: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<unknown> => {
    try {
      return await transport.invoke(command, args);
    } catch (error) {
      throw new HostError(parseCommandError(error));
    }
  };

  const parsed = <T>(
    reply: unknown,
    parse: (value: unknown) => Parsed<T>,
  ): T => {
    const result = parse(reply);
    if (!result.ok) throw malformed(result.message);
    return result.value;
  };

  return {
    call: (op, args) => invoke("studio_call", { op, args: args ?? {} }),

    async previewBytes(target, version) {
      const reply = await invoke(
        "preview_bytes",
        version === undefined
          ? { selection: target }
          : { selection: target, v: version },
      );
      if (!isBytes(reply)) throw malformed("preview bytes are not bytes");
      return reply instanceof Uint8Array
        ? reply.slice()
        : new Uint8Array(reply);
    },

    snapshots: createSnapshotHub(transport),

    async editOpen(editId, workingSetId, slots) {
      return parsed(
        await invoke("edit_open", { editId, workingSetId, slots: [...slots] }),
        parseEditOpened,
      );
    },
    async editExport(editId) {
      return parsed(await invoke("edit_export", { editId }), parseEditExport);
    },
    async editImport(editId, finish = false) {
      return parsed(
        await invoke("edit_import", { editId, finish }),
        parseEditBrought,
      );
    },
    async editReport(editId) {
      return parsed(
        await invoke("studio_call", {
          op: "edit-report",
          args: { id: editId },
        }),
        parseEditReport,
      );
    },
    async configStatus() {
      return parsed(await invoke("config_status"), parseConfigStatus);
    },
    async configChoose() {
      return parsed(await invoke("config_choose"), parseConfigChoice);
    },
  };
}
