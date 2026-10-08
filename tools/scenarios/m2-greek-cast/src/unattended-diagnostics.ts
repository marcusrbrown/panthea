// What the unattended run captures from Ollama when it ends on a fault: the loaded-model table from the real
// Ollama's /api/ps, and the last lines of its server log with anything key-like or off-machine withheld. Both go
// into the evidence folder, which is committed, so nothing that names a key, a host other than the local machine, or
// a user is kept.

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** How many lines of the server log the capture keeps. */
export const LOG_TAIL_LINES = 50;

/** Stands in for a log line that was withheld. */
export const WITHHELD = "[line withheld]";

/** The Ollama server log of the desktop install. */
export const OLLAMA_LOG_PATH = join(homedir(), ".ollama", "logs", "server.log");

/** The last `count` non-trailing lines of `text`. */
export function tailLines(text: string, count: number): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-count);
}

const KEY_WORDS =
  /(api[_-]?key|authorization|bearer|token|password|passwd|secret|credential)/i;
const KEY_LIKE = /\b(sk|pk|ghp|gho|xox[a-z])[-_][A-Za-z0-9_-]{12,}/;
const LONG_TOKEN = /[A-Za-z0-9_+/=-]{32,}/;
const URL_HOST = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@]*@)?([^\s/:?#]+)/gi;
const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/g;
const IPV6 = /\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/gi;
const HOST_PORT = /\b((?:[a-z0-9-]+\.)+[a-z]{2,}):\d{1,5}\b/gi;

const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "::"]);

const isLocalHost = (host: string): boolean =>
  LOCAL_NAMES.has(host.toLowerCase().replace(/^\[|\]$/g, ""));

/** True when the line names a host other than the local machine. */
function namesOtherHost(line: string): boolean {
  for (const match of line.matchAll(URL_HOST)) {
    if (!isLocalHost(match[1] ?? "")) return true;
  }
  for (const match of line.matchAll(IPV4)) {
    const parts = (match[1] ?? "").split(".").map(Number);
    if (parts.every((part) => part <= 255) && !isLocalHost(match[1] ?? "")) {
      return true;
    }
  }
  for (const match of line.matchAll(HOST_PORT)) {
    if (!isLocalHost(match[1] ?? "")) return true;
  }
  for (const match of line.matchAll(IPV6)) {
    const text = match[0];
    // Times (18:00:01) have no hex letters beyond digits and at most three colons; an address has the doubled colon or more groups.
    if (text.includes("::") || (text.match(/:/g) ?? []).length >= 4) {
      if (!isLocalHost(text)) return true;
    }
  }
  return false;
}

/**
 * The lines with every one that looks like a key, a credential or a long opaque token replaced by {@link WITHHELD},
 * every one that names a host other than the local machine likewise, and `home` shortened to `~` in the rest.
 */
export function sanitizeLogLines(
  lines: readonly string[],
  home: string,
): string[] {
  return lines.map((line) => {
    if (
      KEY_WORDS.test(line) ||
      KEY_LIKE.test(line) ||
      LONG_TOKEN.test(line) ||
      namesOtherHost(line)
    ) {
      return WITHHELD;
    }
    return home === "" ? line : line.split(home).join("~");
  });
}

export type Captured<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly reason: string };

export interface LogTail {
  readonly lines: readonly string[];
  /** The log was last written before the run began, so its lines are not the run's. */
  readonly stale: boolean;
  /** When the log was last written (ISO, to the second), when that could be read. */
  readonly modifiedAt?: string;
  /** Says why the lines should not be read as the run's; present only for a stale log. */
  readonly note?: string;
}

export interface OllamaState {
  /** Ollama's own account of what it has loaded: `/api/ps` on the real URL. */
  readonly ps: Captured<{ readonly body: unknown }>;
  readonly logTail: Captured<LogTail>;
}

/** The text of the tail file: a stale log's note first, so the file read alone cannot pass old lines off as the fault's. */
export function renderLogTail(tail: OllamaState["logTail"]): string {
  if (!tail.ok) return `${tail.reason}\n`;
  const head = tail.note === undefined ? [] : [`# ${tail.note}`];
  return `${[...head, ...tail.lines].join("\n")}\n`;
}

export interface CaptureOptions {
  /** The real Ollama origin, never the outage proxy. */
  readonly ollama: string;
  readonly home?: string;
  readonly fetch?: (url: string) => Promise<Response>;
  /** The server log's text, or `undefined` when there is none. */
  readonly readLog?: () => string | undefined;
  /** Epoch ms at which the run began: a log last written before it is marked stale. */
  readonly since?: number;
  /** When the log was last written, in epoch ms, or `undefined` when that cannot be read. */
  readonly logModifiedAt?: () => number | undefined;
}

const PS_TIMEOUT_MS = 5_000;

/** Captures Ollama's loaded-model table and the sanitized tail of its server log. Never throws. */
export async function captureOllamaState(
  options: CaptureOptions,
): Promise<OllamaState> {
  const get =
    options.fetch ??
    ((url: string) =>
      fetch(url, { signal: AbortSignal.timeout(PS_TIMEOUT_MS) }));
  const readLog =
    options.readLog ??
    (() => {
      try {
        return readFileSync(OLLAMA_LOG_PATH, "utf8");
      } catch {
        return undefined;
      }
    });
  const home = options.home ?? homedir();
  const modifiedAt =
    options.logModifiedAt ??
    (() => {
      try {
        return statSync(OLLAMA_LOG_PATH).mtimeMs;
      } catch {
        return undefined;
      }
    });

  let ps: OllamaState["ps"];
  try {
    const response = await get(`${options.ollama}/api/ps`);
    ps = response.ok
      ? { ok: true, body: await response.json() }
      : { ok: false, reason: `/api/ps answered ${response.status}` };
  } catch (error) {
    ps = {
      ok: false,
      reason: `/api/ps unreachable: ${error instanceof Error ? error.name : "error"}`,
    };
  }

  let logTail: OllamaState["logTail"];
  try {
    const text = readLog();
    if (text === undefined) {
      logTail = { ok: false, reason: "no server log to read" };
    } else {
      const written = modifiedAt();
      const iso =
        written === undefined
          ? undefined
          : `${new Date(written).toISOString().replace(/\.\d+Z$/, "Z")}`;
      const stale =
        options.since !== undefined &&
        written !== undefined &&
        written < options.since;
      logTail = {
        ok: true,
        lines: sanitizeLogLines(tailLines(text, LOG_TAIL_LINES), home),
        stale,
        ...(iso === undefined ? {} : { modifiedAt: iso }),
        ...(stale
          ? {
              note: `The server log was last written ${iso}, before this run began; these lines are not from it.`,
            }
          : {}),
      };
    }
  } catch {
    logTail = { ok: false, reason: "the server log could not be read" };
  }
  return { ps, logTail };
}
