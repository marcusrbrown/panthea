import { expect, test } from "bun:test";
import {
  captureOllamaState,
  LOG_TAIL_LINES,
  renderLogTail,
  sanitizeLogLines,
  tailLines,
  WITHHELD,
} from "./unattended-diagnostics";

const HOME = "/Users/someone";

test("the tail is the last fifty lines, whole file or not", () => {
  const lines = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);
  expect(LOG_TAIL_LINES).toBe(50);
  const tail = tailLines(`${lines.join("\n")}\n`, LOG_TAIL_LINES);
  expect(tail).toHaveLength(50);
  expect(tail[0]).toBe("line 71");
  expect(tail[49]).toBe("line 120");
  expect(tailLines("a\nb\n", 50)).toEqual(["a", "b"]);
  expect(tailLines("", 50)).toEqual([]);
});

test("a line that looks like a key or a credential is withheld whole, and an ordinary one is kept", () => {
  const keyed = [
    "OLLAMA_API_KEY=abc123",
    "Authorization: Bearer sk-live-0123456789",
    'token="ghp_0123456789abcdefghijklmnopqrstuvwxyz"',
    "password: hunter2",
    "secret=whatever",
    "key sk-0123456789abcdef0123456789abcdef0123",
    "id AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEf",
  ];
  const kept = [
    'time=2026-10-07T18:00:00 level=INFO source=server.go msg="llama runner started in 4.12 seconds"',
    '[GIN] 2026/10/07 - 18:00:01 | 200 |  2.1s | 127.0.0.1 | POST "/v1/chat/completions"',
    "load_tensors: offloaded 33/33 layers to GPU",
  ];
  const out = sanitizeLogLines([...keyed, ...kept], HOME);
  expect(out.slice(0, keyed.length)).toEqual(keyed.map(() => WITHHELD));
  expect(out.slice(keyed.length)).toEqual(kept);
});

test("a line that names a host other than localhost is withheld, and loopback, localhost and a bare port are kept", () => {
  const outside = [
    "pulling manifest from https://registry.ollama.ai/v2/library/x",
    '[GIN] 2026/10/07 | 200 | 192.168.1.20 | GET "/api/tags"',
    "listening on 10.0.0.5:11434",
    "dial tcp ffee::1: connect refused",
    "peer example.com:443",
  ];
  const local = [
    "listening on 127.0.0.1:11434",
    "OLLAMA_HOST:http://127.0.0.1:11434",
    "origin http://localhost:3000 allowed",
    "dial tcp [::1]:11434 ok",
    "OLLAMA_NUM_PARALLEL:1 OLLAMA_MAX_LOADED_MODELS:0",
  ];
  const out = sanitizeLogLines([...outside, ...local], HOME);
  expect(out.slice(0, outside.length)).toEqual(outside.map(() => WITHHELD));
  expect(out.slice(outside.length)).toEqual(local);
});

test("the home directory in a path is shortened, so a user name never reaches the evidence", () => {
  const out = sanitizeLogLines(
    [`OLLAMA_MODELS:${HOME}/.ollama/models`, `see ${HOME}/Library/Logs/x.log`],
    HOME,
  );
  expect(out).toEqual([
    "OLLAMA_MODELS:~/.ollama/models",
    "see ~/Library/Logs/x.log",
  ]);
  expect(JSON.stringify(out)).not.toContain("someone");
});

test("the capture asks the real Ollama URL for /api/ps, never anything else, and returns its body with the sanitized tail", async () => {
  const asked: string[] = [];
  const ps = {
    models: [{ name: "granite3.3-8b-4k", size: 5, expires_at: "t" }],
  };
  const state = await captureOllamaState({
    ollama: "http://127.0.0.1:11434",
    home: HOME,
    fetch: async (url) => {
      asked.push(String(url));
      return Response.json(ps);
    },
    readLog: () => "one\nAuthorization: Bearer x\nthree\n",
  });

  expect(asked).toEqual(["http://127.0.0.1:11434/api/ps"]);
  expect(state.ps).toEqual({ ok: true, body: ps });
  expect(state.logTail).toMatchObject({
    ok: true,
    lines: ["one", WITHHELD, "three"],
    stale: false,
  });
});

test("an Ollama that does not answer, or a log that cannot be read, is recorded as such and never throws", async () => {
  const unreachable = await captureOllamaState({
    ollama: "http://127.0.0.1:11434",
    home: HOME,
    fetch: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    },
    readLog: () => {
      throw new Error("ENOENT");
    },
  });
  expect(unreachable.ps.ok).toBe(false);
  expect(unreachable.logTail.ok).toBe(false);

  const failing = await captureOllamaState({
    ollama: "http://127.0.0.1:11434",
    home: HOME,
    fetch: async () => new Response("down", { status: 500 }),
    readLog: () => undefined,
  });
  expect(failing.ps).toMatchObject({ ok: false });
  expect(failing.logTail).toMatchObject({ ok: false });
});

test("the capture holds no host but the one it was asked, and no user name", async () => {
  const state = await captureOllamaState({
    ollama: "http://127.0.0.1:11434",
    home: HOME,
    fetch: async () => Response.json({ models: [] }),
    readLog: () =>
      `OLLAMA_MODELS:${HOME}/.ollama/models\nreach https://registry.ollama.ai/x\n`,
  });
  const text = JSON.stringify(state);
  expect(text).not.toContain("registry.ollama.ai");
  expect(text).not.toContain("someone");
});

// --- A log that stopped before the run began -------------------------------------------------

const RUN_START = Date.parse("2026-10-08T02:00:00Z");

test("a log last written before the run began is marked stale, with when it was written, so old lines are never presented as the fault's", async () => {
  const state = await captureOllamaState({
    ollama: "http://127.0.0.1:11434",
    home: HOME,
    since: RUN_START,
    fetch: async () => Response.json({ models: [] }),
    readLog: () => "old one\nold two\n",
    logModifiedAt: () => Date.parse("2026-05-14T09:30:00Z"),
  });
  expect(state.logTail).toMatchObject({
    ok: true,
    stale: true,
    modifiedAt: "2026-05-14T09:30:00Z",
  });
  expect(state.logTail.ok && state.logTail.note).toContain(
    "before this run began",
  );
  expect(state.logTail.ok && state.logTail.note).toContain(
    "2026-05-14T09:30:00Z",
  );
  // The lines are still given, under that note.
  expect(state.logTail.ok && state.logTail.lines).toEqual([
    "old one",
    "old two",
  ]);
});

test("a log written during the run is not stale, and one written at the instant it began is not either", async () => {
  for (const modified of [RUN_START, RUN_START + 60_000]) {
    const state = await captureOllamaState({
      ollama: "http://127.0.0.1:11434",
      home: HOME,
      since: RUN_START,
      fetch: async () => Response.json({ models: [] }),
      readLog: () => "a\n",
      logModifiedAt: () => modified,
    });
    expect(state.logTail).toMatchObject({ ok: true, stale: false });
    expect(state.logTail.ok && state.logTail.note).toBeUndefined();
  }
  const justBefore = await captureOllamaState({
    ollama: "http://127.0.0.1:11434",
    home: HOME,
    since: RUN_START,
    fetch: async () => Response.json({ models: [] }),
    readLog: () => "a\n",
    logModifiedAt: () => RUN_START - 1,
  });
  expect(justBefore.logTail).toMatchObject({ stale: true });
});

test("with no start time or no way to read when the log was written, nothing is claimed about it", async () => {
  const state = await captureOllamaState({
    ollama: "http://127.0.0.1:11434",
    home: HOME,
    fetch: async () => Response.json({ models: [] }),
    readLog: () => "a\n",
    logModifiedAt: () => undefined,
  });
  expect(state.logTail).toMatchObject({ ok: true, stale: false });
  expect(state.logTail.ok && state.logTail.modifiedAt).toBeUndefined();
  // A start time with no way to read the file's age claims nothing either.
  const unknown = await captureOllamaState({
    ollama: "http://127.0.0.1:11434",
    home: HOME,
    since: RUN_START,
    fetch: async () => Response.json({ models: [] }),
    readLog: () => "a\n",
    logModifiedAt: () => undefined,
  });
  expect(unknown.logTail).toMatchObject({ ok: true, stale: false });
});

test("the written tail file starts with the stale note, so a reader of the file alone cannot take old lines for the fault's", () => {
  const stale = renderLogTail({
    ok: true,
    lines: ["x"],
    stale: true,
    modifiedAt: "2026-05-14T09:30:00Z",
    note: "The server log was last written 2026-05-14T09:30:00Z, before this run began; these lines are not from it.",
  });
  expect(stale.split("\n")[0]).toContain("before this run began");
  expect(stale).toContain("\nx\n");
  expect(renderLogTail({ ok: true, lines: ["x"], stale: false })).toBe("x\n");
  expect(renderLogTail({ ok: false, reason: "no server log to read" })).toBe(
    "no server log to read\n",
  );
});
