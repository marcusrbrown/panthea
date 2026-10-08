import { expect, test } from "bun:test";
import {
  captureOllamaState,
  LOG_TAIL_LINES,
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
  expect(state.logTail).toEqual({
    ok: true,
    lines: ["one", WITHHELD, "three"],
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
