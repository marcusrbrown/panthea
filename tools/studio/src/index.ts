#!/usr/bin/env bun
// The studio CLI. One-shot verbs run a command and exit; `session` (and
// `open`, which is a session that stays for one edit) serves the same
// commands as newline-delimited JSON on stdin and stdout, so a process that
// owns the studio root can take commands while a generation is running.
//
// stdout carries only JSON results. Progress and diagnostics go to stderr and
// name ids and statuses, never prompts, engine settings or output tails.
// Exit codes: 0 success, 1 a failed or refused workflow, 64 usage or config.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execute, opNames, opSpec, own, type Spec } from "./commands";
import { loadConfig, type StudioConfig } from "./config";
import { exitOf, type Outcome, refuse } from "./format";
import { startParentGuard } from "./guard";
import { type Deps, defaultDeps, isOutcome, Studio } from "./host";

export interface Io {
  readonly stdin: AsyncIterable<string>;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

export interface Signals {
  subscribe(handler: (signal: string) => void): () => void;
}

interface Parsed {
  readonly op: string;
  readonly args: Record<string, unknown>;
  readonly config: string | undefined;
  readonly root: string | undefined;
  /** The process whose death ends a session: set only by `--parent-pid`. */
  readonly parentPid?: number;
}

const camel = (flag: string) =>
  flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

function convert(
  value: string,
  type: "string" | "int" | "number" | "json",
  flag: string,
): unknown | Outcome {
  if (type === "string") return value;
  if (type === "number")
    return /^\d*\.?\d+$/.test(value)
      ? Number(value)
      : refuse("invalid-arguments", `--${flag} must be a number`);
  if (type === "int")
    return /^\d+$/.test(value)
      ? Number(value)
      : refuse("invalid-arguments", `--${flag} must be a whole number`);
  try {
    return JSON.parse(
      value.startsWith("@") ? readFileSync(value.slice(1), "utf8") : value,
    );
  } catch {
    return refuse(
      "invalid-arguments",
      `--${flag} must be JSON text or @path to a JSON file`,
    );
  }
}

export function parseArgv(argv: readonly string[]): Parsed | Outcome {
  const words: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (!token.startsWith("--")) {
      words.push(token);
      continue;
    }
    const name = token.slice(2);
    const value = argv[i + 1];
    if (name === "" || value === undefined || value.startsWith("--"))
      return refuse("invalid-arguments", `--${name} needs a value`);
    if (name === "yes")
      return refuse(
        "invalid-arguments",
        "--yes is not accepted: approval and publication need --confirm <revision>",
      );
    if (flags.has(name))
      return refuse("invalid-arguments", `--${name} was given twice`);
    flags.set(name, value);
    i += 1;
  }
  const verb = words.shift();
  if (verb === undefined)
    return refuse(
      "invalid-arguments",
      `give a command: ${["session", ...opNames()].join(", ")}`,
    );
  let op = verb;
  if (verb === "set") {
    const sub = words.shift();
    if (sub === undefined)
      return refuse("invalid-arguments", "set needs create or replace-sheet");
    op = `set-${sub}`;
  }
  const def = opSpec(op);
  if (verb !== "session" && def === undefined)
    return refuse("unknown-op", `unknown command "${verb}"`, {
      known: ["session", ...opNames()],
    });
  const spec: Spec = def?.spec ?? {};
  const args: Record<string, unknown> = {};
  for (const word of words) {
    if (def?.positional === undefined || args[def.positional] !== undefined)
      return refuse("invalid-arguments", `unexpected argument "${word}"`);
    args[def.positional] = word;
  }
  let config: string | undefined;
  let root: string | undefined;
  let parentPid: number | undefined;
  for (const [flag, value] of flags) {
    if (flag === "config") config = value;
    else if (flag === "root") root = value;
    else if (flag === "parent-pid") {
      // Zero or a negative id would signal a process group, not a process.
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
        return refuse(
          "invalid-arguments",
          "--parent-pid must be a positive whole number",
        );
      if (verb !== "session" && verb !== "open")
        return refuse(
          "invalid-arguments",
          "--parent-pid applies to session and open only",
        );
      parentPid = Number(value);
    } else {
      const key = camel(flag);
      const converted = convert(value, own(spec, key)?.t ?? "string", flag);
      if (isOutcome(converted)) return converted;
      args[key] = converted;
    }
  }
  return {
    op,
    args,
    config,
    root,
    ...(parentPid === undefined ? {} : { parentPid }),
  };
}

async function* lines(source: AsyncIterable<string>): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of source) {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      yield buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
    }
  }
  if (buffer.trim() !== "") yield buffer;
}

const REQUEST_KEYS = ["id", "op", "args"];

/** Serves newline-delimited JSON requests, answering each as soon as it settles; reads never wait on a running generation. */
async function serve(
  studio: Studio,
  io: Io,
  initial: { op: string; args: Record<string, unknown> } | undefined,
  stop: Promise<void>,
): Promise<number> {
  const pending = new Set<Promise<void>>();
  const respond = (id: string | null, outcome: Outcome) =>
    io.stdout(
      JSON.stringify(
        outcome.ok
          ? { id, ok: true, result: outcome.result }
          : { id, ok: false, error: outcome.error },
      ),
    );
  const track = (work: Promise<void>) => {
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };
  const handle = async (line: string) => {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      return respond(
        null,
        refuse("invalid-request", "the line is not valid JSON"),
      );
    }
    if (
      typeof request !== "object" ||
      request === null ||
      Array.isArray(request)
    )
      return respond(
        null,
        refuse("invalid-request", "a request is a JSON object"),
      );
    const record = request as Record<string, unknown>;
    const id =
      typeof record.id === "string" && record.id !== "" ? record.id : null;
    const extra = Object.keys(record).find((k) => !REQUEST_KEYS.includes(k));
    if (id === null || typeof record.op !== "string" || extra !== undefined)
      return respond(
        id,
        refuse(
          "invalid-request",
          "a request is {id, op, args} with a string id and op",
        ),
      );
    let outcome: Outcome;
    try {
      outcome = await execute(studio, record.op, record.args ?? {});
    } catch {
      outcome = refuse("internal", "the command failed unexpectedly");
    }
    respond(id, outcome);
  };

  let initialFailed = false;
  let ended: () => void = () => {};
  const edit = new Promise<void>((resolveEdit) => {
    ended = resolveEdit;
  });
  if (initial !== undefined) {
    const watched =
      typeof initial.args.id === "string" ? initial.args.id : undefined;
    studio.editEnded = (id) => id === watched && ended();
    track(
      (async () => {
        let outcome: Outcome;
        try {
          outcome = await execute(studio, initial.op, initial.args);
        } catch {
          outcome = refuse("internal", "the command failed unexpectedly");
        }
        respond(initial.op, outcome);
        if (!outcome.ok) {
          initialFailed = true;
          ended();
        }
      })(),
    );
  }

  const reader = lines(io.stdin)[Symbol.asyncIterator]();
  const halted = Symbol("halted");
  const halt = Promise.race([stop, edit]).then(() => halted);
  for (;;) {
    const next = await Promise.race([reader.next(), halt]);
    if (next === halted || (next as IteratorResult<string>).done) break;
    const line = (next as IteratorResult<string>).value;
    if (line.trim() !== "") track(handle(line));
  }
  void reader.return?.(undefined);
  await Promise.allSettled([...pending]);
  if (studio.stopRequested === undefined) await studio.idle();
  return initialFailed ||
    studio.stopRequested !== undefined ||
    studio.hasWatches ||
    studio.workflowFailure() !== undefined
    ? 1
    : 0;
}

export async function main(
  argv: readonly string[],
  io: Io,
  overrides: Partial<Deps> = {},
  signals?: Signals,
): Promise<number> {
  const deps: Deps = {
    ...defaultDeps((line) => io.stderr(`[studio] ${line}`)),
    ...overrides,
  };
  const finish = (outcome: Outcome) => {
    io.stdout(
      JSON.stringify(
        outcome.ok
          ? { ok: true, result: outcome.result }
          : { ok: false, error: outcome.error },
      ),
    );
    return exitOf(outcome);
  };
  const parsed = parseArgv(argv);
  if (isOutcome(parsed)) return finish(parsed);

  let config: StudioConfig = {};
  if (parsed.config !== undefined) {
    const loaded = loadConfig(parsed.config);
    if (!loaded.ok) return finish(refuse("invalid-config", loaded.message));
    config = loaded.value;
  }
  if (parsed.root !== undefined)
    config = { ...config, studioRoot: resolve(parsed.root) };

  const isSession = parsed.op === "session" || parsed.op === "open";
  const studio = new Studio(config, deps, isSession ? "session" : "oneshot");
  let stopNow: () => void = () => {};
  const stop = new Promise<void>((resolveStop) => {
    stopNow = resolveStop;
  });
  const interrupt = (signal: string) => {
    studio.stopRequested = signal;
    stopNow();
    void studio.teardown();
  };
  const unsubscribe = signals?.subscribe(interrupt);
  // The same stop path as a signal: the parent is gone, so close down in order and exit 1.
  const parentGuard =
    isSession && parsed.parentPid !== undefined
      ? startParentGuard({
          parentPid: parsed.parentPid,
          isAlive: deps.isAlive,
          schedule: deps.schedule,
          onOrphan: () => {
            deps.log("the parent process is gone; shutting down");
            interrupt("parent-dead");
          },
        })
      : undefined;
  try {
    if (isSession) {
      const owned = studio.owner();
      if (isOutcome(owned)) return finish(owned);
      const code = await serve(
        studio,
        io,
        parsed.op === "open" ? { op: "open", args: parsed.args } : undefined,
        stop,
      );
      return code;
    }
    let outcome = await execute(studio, parsed.op, parsed.args);
    if (studio.stopRequested !== undefined)
      outcome = refuse("interrupted", `stopped by ${studio.stopRequested}`);
    return finish(outcome);
  } catch {
    return finish(refuse("internal", "the command failed unexpectedly"));
  } finally {
    parentGuard?.stop();
    unsubscribe?.();
    await studio.teardown();
  }
}

if (import.meta.main) {
  const stdin = process.stdin;
  stdin.setEncoding("utf8");
  const handlers = new Set<(signal: string) => void>();
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      for (const handler of handlers) handler(signal);
    });
  const code = await main(
    process.argv.slice(2),
    {
      stdin: stdin as unknown as AsyncIterable<string>,
      stdout: (line) => void process.stdout.write(`${line}\n`),
      stderr: (line) => void process.stderr.write(`${line}\n`),
    },
    {},
    {
      subscribe: (handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
  );
  await new Promise<void>((done) => process.stdout.write("", () => done()));
  process.exit(code);
}
