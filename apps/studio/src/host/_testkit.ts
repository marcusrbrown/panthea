// A fake host transport for tests: it records every invoke, answers by command
// name, and lets a test push payloads down the studio channel as the native
// host would. No timers; every reply is a resolved promise.

import type { HostTransport } from "./client";

export interface Call {
  readonly command: string;
  readonly args: Readonly<Record<string, unknown>> | undefined;
}

export type Answer = (
  args: Readonly<Record<string, unknown>> | undefined,
) => unknown;

export interface FakeChannel {
  /** What `subscribe_studio` was handed. */
  readonly handle: object;
  /** Sends one payload to the webview as the host's channel would. */
  emit(payload: unknown): void;
}

export interface FakeTransport extends HostTransport {
  readonly calls: Call[];
  readonly channels: FakeChannel[];
  /** The calls to one command, in order. */
  to(command: string): Call[];
  answer(command: string, answer: Answer): void;
}

export function fakeTransport(
  initial: Readonly<Record<string, Answer>> = {},
): FakeTransport {
  const answers = new Map<string, Answer>(Object.entries(initial));
  const calls: Call[] = [];
  const channels: FakeChannel[] = [];
  return {
    calls,
    channels,
    to: (command) => calls.filter((call) => call.command === command),
    answer: (command, answer) => {
      answers.set(command, answer);
    },
    async invoke(command, args) {
      calls.push({ command, args });
      const answer = answers.get(command);
      if (answer === undefined) throw hostError("unknown-command", command);
      return answer(args);
    },
    openChannel(onMessage) {
      const handle = {};
      channels.push({ handle, emit: onMessage });
      return handle;
    },
  };
}

/** The rejection shape the host's commands use. */
export const hostError = (
  code: string,
  message = "",
  retryable = false,
  detail?: unknown,
) => ({
  code,
  message,
  retryable,
  ...(detail === undefined ? {} : { detail }),
});

/** A `studio_call` answer table: `ops.status = () => ...`. */
export function callsTo(
  ops: Record<string, (args: Record<string, unknown>) => unknown>,
): Answer {
  return (args) => {
    const op = args?.op;
    const handler = typeof op === "string" ? ops[op] : undefined;
    if (handler === undefined) throw hostError("unknown-op", String(op));
    return handler((args?.args ?? {}) as Record<string, unknown>);
  };
}
