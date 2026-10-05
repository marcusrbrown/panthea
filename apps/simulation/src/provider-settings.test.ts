// The service as the shell launches it, with the operator's model settings and
// keys on the launch line: endpoint status from real requests, a keyed endpoint
// whose key is missing, offline mode, and the sentinel check that a key reaches
// only the request. Every "never" has a positive control that fails the run if
// the check could not see a leak. The service runs in-process on a fast tick
// timer; the planted-key test spawns it for real stdio.

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSyncFrame, type SyncFrame } from "@panthea/contracts";
import { listExternalProposals } from "@panthea/persistence";
import { TICK_TIMER_ENV } from "./index";
import { parseLaunchConfig } from "./launch-config";
import {
  FAST_TICK_MS,
  startTestService,
  stopAllTestServices,
} from "./test-service";

const INDEX_ENTRY = join(import.meta.dir, "index.ts");
const TOKEN = "provider-settings-token";
const SENTINEL = "sk-sentinel-DO-NOT-LEAK-0123456789";
/** A key with a quote and a backslash: JSON writes both escaped, so a raw-only redactor misses them. */
const TRICKY = 'sk-"sentinel\\DO-NOT-LEAK-0123456789';
const TRICKY_ESCAPED = JSON.stringify(TRICKY).slice(1, -1);

// --- A scripted OpenAI-compatible provider that records what it was sent ----------------

type Answer = string | { readonly status: number; readonly body: string };

interface Received {
  readonly authorization: string | null;
  readonly body: string;
}

interface Provider {
  readonly baseUrl: string;
  readonly requests: Received[];
  respond: (request: Received, n: number) => Answer;
  stop(): void;
}

const providers: Provider[] = [];

const LEGEND = (text = "A god speaks of what was seen.") =>
  JSON.stringify({ action: "legend", assertion: text });

function startProvider(
  respond: Provider["respond"] = () => LEGEND(),
): Provider {
  const requests: Received[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const received: Received = {
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      };
      const n = requests.length;
      requests.push(received);
      const answer = provider.respond(received, n);
      if (typeof answer !== "string") {
        return new Response(answer.body, { status: answer.status });
      }
      return Response.json({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "scripted",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: answer },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  });
  const provider: Provider = {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    requests,
    respond,
    stop: () => server.stop(true),
  };
  providers.push(provider);
  return provider;
}

// --- The spawned service ----------------------------------------------------------------

interface Service {
  readonly proc?: ReturnType<typeof Bun.spawn>;
  readonly port: number;
  readonly appDataDir: string;
  /** Everything the service printed, stdout and stderr. */
  output(): string;
  /** Closes stdin and waits for the graceful exit. */
  stop(): Promise<number>;
}

const services: Service[] = [];
const dirs: string[] = [];

afterEach(() => {
  stopAllTestServices();
  for (const service of services.splice(0)) service.proc?.kill();
  for (const provider of providers.splice(0)) provider.stop();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

interface Launch {
  readonly models: object | null;
  readonly offline?: boolean;
  readonly keys?: Record<string, string>;
}

/** The service in this process. */
async function spawnService(launch: Launch): Promise<Service> {
  const appDataDir = mkdtempSync(join(tmpdir(), "panthea-sim-settings-"));
  dirs.push(appDataDir);
  const inProcess = startTestService({
    appDataDir,
    token: TOKEN,
    launch: parseLaunchConfig(
      JSON.stringify({ offline: false, keys: {}, ...launch }),
    ),
  });
  const service: Service = {
    port: inProcess.port,
    appDataDir,
    output: () => inProcess.output(),
    stop: async () => inProcess.stop() ?? 0,
  };
  return service;
}

/** The service as a separate process. */
async function spawnProcess(launch: Launch): Promise<Service> {
  const appDataDir = mkdtempSync(join(tmpdir(), "panthea-sim-settings-"));
  dirs.push(appDataDir);
  const proc = Bun.spawn(["bun", "run", INDEX_ENTRY], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PANTHEA_APP_DATA_DIR: appDataDir,
      [TICK_TIMER_ENV]: String(FAST_TICK_MS),
    },
  });
  const stdin = proc.stdin;
  if (typeof stdin === "number" || !stdin) throw new Error("stdin");
  stdin.write(
    `${TOKEN}\n${JSON.stringify({ offline: false, keys: {}, ...launch })}\n`,
  );
  await stdin.flush();

  let printed = "";
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of stream) {
        printed += decoder.decode(chunk, { stream: true });
      }
    } catch {
      // Killed; nothing more to read.
    }
  };
  void drain(proc.stdout as ReadableStream<Uint8Array>);
  void drain(proc.stderr as ReadableStream<Uint8Array>);

  const port = await until("the service's port", () => {
    const match = /PANTHEA_PORT=(\d+)/.exec(printed);
    return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
  });
  const service: Service = {
    proc,
    port,
    appDataDir,
    output: () => printed,
    async stop() {
      await stdin.end();
      return await proc.exited;
    },
  };
  services.push(service);
  return service;
}

async function until<T>(
  what: string,
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await Bun.sleep(5);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function frameOf(service: Service): Promise<SyncFrame> {
  const response = await fetch(`http://127.0.0.1:${service.port}/frame`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const parsed = parseSyncFrame(await response.json());
  if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
  return parsed.value;
}

type EndpointOutcome = {
  readonly endpoint: string;
  readonly state: string;
  readonly reason?: string;
  readonly detail?: string;
};

const statusOf = (frame: SyncFrame, endpoint: string) =>
  frame.modelEndpoints?.find((entry) => entry.endpoint === endpoint) as
    | EndpointOutcome
    | undefined;

const configFor = (
  endpoints: object[],
  roles: Record<string, object> = {},
): object => ({
  endpoints: endpoints.map((endpoint) => ({ model: "scripted", ...endpoint })),
  roles,
});

/** One endpoint for every god in the pack: a god with no role of its own has no route, and the first turn goes to whoever's id sorts first. */
const allGods = (endpoint: string, fallback?: string[]) =>
  Object.fromEntries(
    ["athena", "hades", "hephaestus", "hera", "hermes", "poseidon", "zeus"].map(
      (god) => [god, { endpoint, ...(fallback ? { fallback } : {}) }],
    ),
  );

// --- The scan: finds a planted secret anywhere in a directory ------------------------------

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** The files under `dir` whose bytes contain `secret`: the world store, its journal and trace, logs on disk. */
function filesHolding(dir: string, secret: string): string[] {
  const needle = Buffer.from(secret);
  return filesUnder(dir).filter((path) => readFileSync(path).includes(needle));
}

describe("the leak scan can see a leak (positive controls)", () => {
  test("it finds a secret in a plain file and in a row inserted into the world store behind the writer's back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "panthea-scan-control-"));
    dirs.push(dir);
    await Bun.write(join(dir, "plain.txt"), `before ${SENTINEL} after`);
    expect(filesHolding(dir, SENTINEL)).toEqual([join(dir, "plain.txt")]);

    // A real world store, then a trace row written around the writer.
    const provider = startProvider();
    const service = await spawnService({
      models: configFor(
        [{ id: "local", baseUrl: provider.baseUrl }],
        allGods("local"),
      ),
    });
    expect(await service.stop()).toBe(0);
    expect(filesHolding(service.appDataDir, SENTINEL)).toEqual([]);

    const db = new Database(join(service.appDataDir, "active", "world.sqlite"));
    db.run(
      `INSERT INTO trace_model_requests
         (id, proposal_id, role, outcome, steps, elapsed_ms, prompt_digest, output_digest, prompt_payload, output_payload, recorded_at)
       VALUES ('req-bypass', NULL, 'zeus', 'exhausted', '[]', 1, 'd', NULL, ?, NULL, 1)`,
      [`bypassed the writer ${SENTINEL}`],
    );
    db.close();
    expect(filesHolding(service.appDataDir, SENTINEL).length).toBeGreaterThan(
      0,
    );
  });
});

describe("endpoint status comes from real requests", () => {
  test("an unreachable endpoint reports failed with a reason, gods idle under model-degraded, and recovery reports ok", async () => {
    const provider = startProvider(() => ({ status: 500, body: "down" }));
    const service = await spawnService({
      models: configFor(
        [{ id: "local", baseUrl: provider.baseUrl }],
        allGods("local"),
      ),
    });

    const failed = await until("the endpoint to report failed", async () => {
      const frame = await frameOf(service);
      return statusOf(frame, "local")?.state === "failed" ? frame : undefined;
    });
    expect(statusOf(failed, "local")).toMatchObject({
      endpoint: "local",
      state: "failed",
      reason: "http-5xx",
    });
    expect(failed.status).toBe("degraded");
    expect(failed.degradedReason).toBe("model-degraded");

    provider.respond = () => LEGEND();
    const recovered = await until("the endpoint to recover", async () => {
      const frame = await frameOf(service);
      return statusOf(frame, "local")?.state === "ok" ? frame : undefined;
    });
    expect(statusOf(recovered, "local")).toEqual({
      endpoint: "local",
      state: "ok",
    });
    expect(recovered.status).toBe("running");
  });

  test("before any request every configured endpoint is untried, and a service with no models carries no status", async () => {
    const none = await spawnService({ models: null });
    expect((await frameOf(none)).modelEndpoints).toBeUndefined();

    const provider = startProvider();
    const started = await spawnService({
      models: configFor([{ id: "local", baseUrl: provider.baseUrl }], {}),
    });
    // No role is assigned, so no god ever asks: the endpoint stays untried.
    const frame = await frameOf(started);
    expect(frame.modelEndpoints).toEqual([
      { endpoint: "local", state: "untried" },
    ]);
  });

  test("a keyed endpoint whose key is missing at spawn fails with key-not-set, sends nothing upstream, and gods idle under model-degraded", async () => {
    const provider = startProvider(() => ({
      status: 401,
      body: "Unauthorized",
    }));
    const service = await spawnService({
      models: configFor(
        [{ id: "local", baseUrl: provider.baseUrl, keyRef: "zeus-key" }],
        allGods("local"),
      ),
      keys: {},
    });

    const frame = await until("key-missing status", async () => {
      const current = await frameOf(service);
      return statusOf(current, "local")?.state === "failed"
        ? current
        : undefined;
    });
    expect(statusOf(frame, "local")).toEqual({
      endpoint: "local",
      state: "failed",
      reason: "key-missing",
      detail: "key not set (zeus-key)",
    });
    expect(frame.degradedReason).toBe("model-degraded");
    expect(provider.requests).toHaveLength(0);
  });

  test("positive control: the same keyed endpoint with its key set is reached with the bearer key and reports ok", async () => {
    const provider = startProvider();
    const service = await spawnService({
      models: configFor(
        [{ id: "local", baseUrl: provider.baseUrl, keyRef: "zeus-key" }],
        allGods("local"),
      ),
      keys: { "zeus-key": SENTINEL },
    });
    await until("the endpoint to report ok", async () =>
      statusOf(await frameOf(service), "local")?.state === "ok"
        ? true
        : undefined,
    );
    expect(provider.requests.length).toBeGreaterThan(0);
    for (const request of provider.requests) {
      expect(request.authorization).toBe(`Bearer ${SENTINEL}`);
    }
  });
});

describe("offline mode", () => {
  const HOSTED = "https://hosted.invalid/v1";
  const models = (localUrl: string) =>
    configFor(
      [
        { id: "hosted", baseUrl: HOSTED, keyRef: "hosted-key" },
        { id: "local", baseUrl: localUrl },
      ],
      allGods("hosted", ["local"]),
    );

  test("positive control: online, the hosted endpoint is tried first and fails, and the local fallback answers", async () => {
    const provider = startProvider();
    const service = await spawnService({
      models: models(provider.baseUrl),
      offline: false,
      keys: { "hosted-key": SENTINEL },
    });
    const frame = await until("hosted tried and local ok", async () => {
      const current = await frameOf(service);
      return statusOf(current, "hosted")?.state === "failed" &&
        statusOf(current, "local")?.state === "ok"
        ? current
        : undefined;
    });
    // The hosted endpoint was really attempted, with the key set, and its
    // failure account carries no key.
    expect(statusOf(frame, "hosted")?.reason).toBeDefined();
    expect(JSON.stringify(frame)).not.toContain(SENTINEL);
    expect(provider.requests.length).toBeGreaterThan(0);
  });

  test("offline, the hosted endpoint is dropped before any request (still untried), and the local fallback answers", async () => {
    const provider = startProvider();
    const service = await spawnService({
      models: models(provider.baseUrl),
      offline: true,
      keys: { "hosted-key": SENTINEL },
    });
    await until("local ok", async () =>
      statusOf(await frameOf(service), "local")?.state === "ok"
        ? true
        : undefined,
    );
    const frame = await frameOf(service);
    expect(statusOf(frame, "hosted")).toEqual({
      endpoint: "hosted",
      state: "untried",
    });
    expect(provider.requests.length).toBeGreaterThan(0);
    // The hosted key never reached the local endpoint either.
    for (const request of provider.requests) {
      expect(request.authorization).toBeNull();
    }
  });
});

describe("a key reaches only the request (sentinel)", () => {
  const keyed = (provider: Provider) =>
    configFor(
      [{ id: "local", baseUrl: provider.baseUrl, keyRef: "sk" }],
      allGods("local"),
    );

  test("a planted key sent on the launch line never appears in a prompt, the frame, the world store (journal and trace), or the logs", async () => {
    const provider = startProvider();
    const service = await spawnProcess({
      models: keyed(provider),
      keys: { sk: SENTINEL },
    });
    await until("god turns to be answered and committed", async () => {
      const db = new Database(
        join(service.appDataDir, "active", "world.sqlite"),
        { readonly: true },
      );
      try {
        return provider.requests.length >= 2 &&
          listExternalProposals(db).some(
            (entry) => entry.outcome?.status === "committed",
          )
          ? true
          : undefined;
      } finally {
        db.close();
      }
    });

    // Positive control: the key did reach every request, as the bearer.
    for (const request of provider.requests) {
      expect(request.authorization).toBe(`Bearer ${SENTINEL}`);
    }
    // Negative checks.
    for (const request of provider.requests) {
      expect(request.body).not.toContain(SENTINEL);
    }
    expect(JSON.stringify(await frameOf(service))).not.toContain(SENTINEL);
    expect(await service.stop()).toBe(0);
    expect(service.output()).not.toContain(SENTINEL);
    expect(filesHolding(service.appDataDir, SENTINEL)).toEqual([]);
  });

  test("control: an endpoint that echoes the key back in its error is redacted in the trace row, the frame, and the logs", async () => {
    const provider = startProvider((request) => ({
      status: 401,
      body: `Incorrect API key provided: ${request.authorization?.replace("Bearer ", "")}`,
    }));
    const service = await spawnService({
      models: keyed(provider),
      keys: { sk: SENTINEL },
    });
    const frame = await until("the failure to be reported", async () => {
      const current = await frameOf(service);
      return statusOf(current, "local")?.state === "failed"
        ? current
        : undefined;
    });
    // Positive control: the endpoint really did receive the key it echoed.
    expect(provider.requests[0]?.authorization).toBe(`Bearer ${SENTINEL}`);
    expect(statusOf(frame, "local")?.detail).toContain("[redacted]");
    expect(JSON.stringify(frame)).not.toContain(SENTINEL);

    // The trace row is written when the chain ends; wait for it.
    const steps = await until("the exhausted request's trace row", () => {
      const db = new Database(
        join(service.appDataDir, "active", "world.sqlite"),
        { readonly: true },
      );
      try {
        const row = db
          .query("SELECT steps FROM trace_model_requests LIMIT 1")
          .get() as { steps: string } | null;
        return row?.steps;
      } finally {
        db.close();
      }
    });
    expect(steps).toContain("[redacted]");
    expect(await service.stop()).toBe(0);
    expect(service.output()).not.toContain(SENTINEL);
    expect(filesHolding(service.appDataDir, SENTINEL)).toEqual([]);
  });

  test("control: a model that puts the key in its answer is refused before it is journaled, and the trace row holds the marker", async () => {
    const provider = startProvider((request) =>
      LEGEND(`Zeus speaks ${request.authorization?.replace("Bearer ", "")}`),
    );
    const service = await spawnService({
      models: keyed(provider),
      keys: { sk: SENTINEL },
    });
    await until("a god turn that echoed the key", () =>
      service.output().includes("contained a key") ? true : undefined,
    );
    const db = new Database(
      join(service.appDataDir, "active", "world.sqlite"),
      {
        readonly: true,
      },
    );
    try {
      expect(listExternalProposals(db)).toEqual([]);
      const rows = db
        .query("SELECT output_payload FROM trace_model_requests")
        .all() as { output_payload: string | null }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(
        rows.some((row) => row.output_payload?.includes("[redacted]")),
      ).toBe(true);
    } finally {
      db.close();
    }
    expect(await service.stop()).toBe(0);
    expect(service.output()).not.toContain(SENTINEL);
    expect(filesHolding(service.appDataDir, SENTINEL)).toEqual([]);
  });

  describe("a key JSON escapes", () => {
    test("positive control: the key and its escaped form differ, and the key still reaches the request as the bearer", async () => {
      expect(TRICKY_ESCAPED).not.toBe(TRICKY);
      const provider = startProvider();
      const service = await spawnService({
        models: keyed(provider),
        keys: { sk: TRICKY },
      });
      await until("a request", () =>
        provider.requests.length > 0 ? true : undefined,
      );
      expect(provider.requests[0]?.authorization).toBe(`Bearer ${TRICKY}`);
      expect(await service.stop()).toBe(0);
    });

    test("an endpoint that echoes the key in a JSON error body is redacted in the frame, the trace row, and the logs", async () => {
      const provider = startProvider((request) => ({
        status: 401,
        body: JSON.stringify({
          error: `Incorrect key ${request.authorization?.replace("Bearer ", "")}`,
        }),
      }));
      const service = await spawnService({
        models: keyed(provider),
        keys: { sk: TRICKY },
      });
      const frame = await until("the failure to be reported", async () => {
        const current = await frameOf(service);
        return statusOf(current, "local")?.state === "failed"
          ? current
          : undefined;
      });
      expect(JSON.stringify(frame)).not.toContain(TRICKY_ESCAPED);
      expect(JSON.stringify(frame)).not.toContain(TRICKY);
      const steps = await until("the trace row", () => {
        const db = new Database(
          join(service.appDataDir, "active", "world.sqlite"),
          { readonly: true },
        );
        try {
          const row = db
            .query("SELECT steps FROM trace_model_requests LIMIT 1")
            .get() as { steps: string } | null;
          return row?.steps;
        } finally {
          db.close();
        }
      });
      expect(steps).toContain("[redacted]");
      expect(await service.stop()).toBe(0);
      expect(service.output()).not.toContain(TRICKY);
      expect(service.output()).not.toContain(TRICKY_ESCAPED);
      expect(filesHolding(service.appDataDir, TRICKY)).toEqual([]);
      expect(filesHolding(service.appDataDir, TRICKY_ESCAPED)).toEqual([]);
    });

    test("a model that puts the key in its answer is refused before the journal even though the proposal holds it escaped", async () => {
      const provider = startProvider((request) =>
        LEGEND(`Zeus speaks ${request.authorization?.replace("Bearer ", "")}`),
      );
      const service = await spawnService({
        models: keyed(provider),
        keys: { sk: TRICKY },
      });
      await until("a god turn that echoed the key", () =>
        service.output().includes("contained a key") ? true : undefined,
      );
      const db = new Database(
        join(service.appDataDir, "active", "world.sqlite"),
        { readonly: true },
      );
      try {
        expect(listExternalProposals(db)).toEqual([]);
        const rows = db
          .query("SELECT output_payload FROM trace_model_requests")
          .all() as { output_payload: string | null }[];
        expect(
          rows.some((row) => row.output_payload?.includes("[redacted]")),
        ).toBe(true);
      } finally {
        db.close();
      }
      expect(await service.stop()).toBe(0);
      expect(service.output()).not.toContain(TRICKY);
      expect(service.output()).not.toContain(TRICKY_ESCAPED);
      expect(filesHolding(service.appDataDir, TRICKY)).toEqual([]);
      expect(filesHolding(service.appDataDir, TRICKY_ESCAPED)).toEqual([]);
    });
  });
});
