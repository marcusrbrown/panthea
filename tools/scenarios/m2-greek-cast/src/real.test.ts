import { expect, test } from "bun:test";
import { join } from "node:path";
import { parseRoutingConfig, planRoute } from "@panthea/agents";
import { loadContentPack } from "@panthea/content";
import { REPO_ROOT } from "../../m1-living-world/src/sidecar";
import { parseArgs } from "./args";
import {
  endpointKind,
  KeyMissing,
  launchConfigFor,
  OllamaUnreachable,
  prepareOllama,
  readKeychainKey,
  routingConfigFor,
} from "./real";

const options = {
  binary: "/b",
  durationMs: 1000,
  ollama: "http://127.0.0.1:11434",
  model: "gemma4-e4b-4k",
};

test("the endpoint config names the model, and carries reasoningEffort only when asked", () => {
  const without = routingConfigFor(options) as {
    endpoints: Record<string, unknown>[];
    roles: Record<string, { endpoint: string }>;
  };
  expect(without.endpoints[0]).toEqual({
    id: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "gemma4-e4b-4k",
  });
  expect(without.roles.zeus?.endpoint).toBe("ollama");
  expect(without.roles.hera?.endpoint).toBe("ollama");

  const withNone = routingConfigFor({
    ...options,
    reasoningEffort: "none",
  }) as { endpoints: Record<string, unknown>[] };
  expect(withNone.endpoints[0]).toEqual({
    id: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "gemma4-e4b-4k",
    reasoningEffort: "none",
  });
});

test("every god in the authored pack has a route to the endpoint, Athena and Hades named, so no god's turn exhausts for want of a role", () => {
  const pack = loadContentPack(join(REPO_ROOT, "content", "greek", "world"));
  if (!pack.ok) throw new Error(pack.message);
  const gods = pack.value.inhabitants
    .filter((inhabitant) => inhabitant.deity === true)
    .map((inhabitant) => inhabitant.id);
  expect(gods).toContain("athena");
  expect(gods).toContain("hades");
  expect(gods).toHaveLength(7);
  for (const config of [
    routingConfigFor(options),
    routingConfigFor({
      ...options,
      baseUrl: "https://hosted.example.com/v1",
      keyRef: "k",
    }),
  ]) {
    const parsed = parseRoutingConfig(config);
    if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
    const only = (config as { endpoints: { id: string }[] }).endpoints[0]?.id;
    for (const god of ["athena", "hades", ...gods]) {
      const plan = planRoute(parsed.value, god, { offline: false });
      expect([god, plan.steps.map((step) => step.endpoint.id)]).toEqual([
        god,
        [only],
      ]);
    }
  }
});

const SENTINEL = "sk-sentinel-DO-NOT-LEAK-0123456789";
const hosted = {
  ...options,
  baseUrl: "https://hosted.example.com/v1",
  keyRef: "hosted-key",
};

test("a hosted base URL is the endpoint's base URL as given, with the key reference and no key", () => {
  const config = routingConfigFor({
    ...hosted,
    keys: { "hosted-key": SENTINEL },
  }) as {
    endpoints: Record<string, unknown>[];
    roles: Record<string, { endpoint: string }>;
  };
  expect(config.endpoints[0]).toEqual({
    id: "hosted",
    baseUrl: "https://hosted.example.com/v1",
    model: "gemma4-e4b-4k",
    keyRef: "hosted-key",
  });
  expect(config.roles.zeus?.endpoint).toBe("hosted");
  expect(config.roles.hera?.endpoint).toBe("hosted");
  expect(JSON.stringify(config)).not.toContain(SENTINEL);
  // Control: no key reference given, none in the endpoint.
  const keyless = routingConfigFor({ ...options, baseUrl: hosted.baseUrl }) as {
    endpoints: Record<string, unknown>[];
  };
  expect(keyless.endpoints[0]).not.toHaveProperty("keyRef");
});

test("the launch line carries the key under its key reference, online, and nowhere else", () => {
  const launch = launchConfigFor({
    ...hosted,
    keys: { "hosted-key": SENTINEL },
  });
  expect(launch.keys).toEqual({ "hosted-key": SENTINEL });
  expect(launch.offline).toBe(false);
  expect(JSON.stringify(launch.models)).not.toContain(SENTINEL);
  // Control: the local default sends no keys.
  expect(launchConfigFor(options).keys).toEqual({});
});

/** A stand-in for the default Ollama that records every request it gets. */
function countingOllama(model: string) {
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push(new URL(request.url).pathname);
      return Response.json({ models: [{ name: model }] });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    stop: () => server.stop(true),
  };
}

test("Ollama preparation runs only on the default path: any explicit base URL, local or hosted, skips it", async () => {
  // Nothing listens on port 1: preparing the default Ollama there would throw.
  const unreachable = { ...options, ollama: "http://127.0.0.1:1" };
  for (const baseUrl of [
    "http://127.0.0.1:8080/v1",
    "http://localhost:11434/v1",
    "http://192.168.1.20:8080/v1",
    "https://hosted.example.com/v1",
  ]) {
    await expect(
      prepareOllama({ ...unreachable, baseUrl }),
    ).resolves.toBeUndefined();
  }
  // Control: the default path still prepares Ollama, and fails when it is unreachable.
  await expect(prepareOllama(unreachable)).rejects.toBeInstanceOf(
    OllamaUnreachable,
  );
});

test("a healthy custom local endpoint proceeds without a single call to the default Ollama's tags or warm-up", async () => {
  const ollama = countingOllama(options.model);
  try {
    await prepareOllama({
      ...options,
      ollama: ollama.url,
      baseUrl: "http://127.0.0.1:8080/v1",
    });
    expect(ollama.requests).toEqual([]);
    // Control: without a base URL the same Ollama is asked for its tags and told to load the model.
    await prepareOllama({ ...options, ollama: ollama.url });
    expect(ollama.requests).toEqual(["/api/tags", "/api/generate"]);
  } finally {
    ollama.stop();
  }
});

test("the key is read from the Keychain entry the shell writes, through an argv array, and one trailing newline is trimmed", async () => {
  const calls: (readonly string[])[] = [];
  const key = await readKeychainKey("hosted-key", async (argv) => {
    calls.push(argv);
    return { exitCode: 0, stdout: `${SENTINEL}\n` };
  });
  expect(key).toBe(SENTINEL);
  expect(calls).toEqual([
    [
      "security",
      "find-generic-password",
      "-s",
      "ai.panthe.desktop.endpoint-keys",
      "-a",
      "hosted-key",
      "-w",
    ],
  ]);
  // Only one newline goes; the key keeps any other whitespace.
  expect(
    await readKeychainKey("k", async () => ({
      exitCode: 0,
      stdout: " a b \n\n",
    })),
  ).toBe(" a b \n");
});

test("a missing or empty Keychain entry fails naming only the key reference", async () => {
  for (const result of [
    { exitCode: 44, stdout: `partial ${SENTINEL}` },
    { exitCode: 0, stdout: "\n" },
  ]) {
    const failure = await readKeychainKey(
      "hosted-key",
      async () => result,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(KeyMissing);
    const message = (failure as Error).message;
    expect(message).toContain("hosted-key");
    expect(message).not.toContain(SENTINEL);
  }
});

// --- Which endpoint a run names, and what its record says it was -------------------------------

test("a base URL that is only a pass-through to the local Ollama names the endpoint ollama and records local, and sends no key", () => {
  const viaProxy = {
    ...options,
    baseUrl: "http://127.0.0.1:53211/v1",
    upstreamIsLocal: true as const,
  };
  const config = routingConfigFor(viaProxy) as {
    endpoints: Record<string, unknown>[];
    roles: Record<string, { endpoint: string }>;
    fallback: string[];
  };
  expect(config.endpoints[0]).toEqual({
    id: "ollama",
    baseUrl: "http://127.0.0.1:53211/v1",
    model: "gemma4-e4b-4k",
  });
  expect(config.roles.zeus?.endpoint).toBe("ollama");
  expect(config.fallback).toEqual(["ollama"]);
  expect(JSON.stringify(config)).not.toContain("hosted");
  expect(endpointKind(viaProxy)).toBe("local");
  expect(launchConfigFor(viaProxy).keys).toEqual({});
  // The flag, not the URL, is what says it: the same URL without it is an explicit endpoint as before.
  expect(
    (
      routingConfigFor({ ...viaProxy, upstreamIsLocal: undefined }) as {
        endpoints: { id: string }[];
      }
    ).endpoints[0]?.id,
  ).toBe("hosted");
});

test("the existing paths are unchanged: the default Ollama, a hosted endpoint, and an explicit local base URL", () => {
  const idOf = (o: Parameters<typeof routingConfigFor>[0]) =>
    (routingConfigFor(o) as { endpoints: { id: string }[] }).endpoints[0]?.id;
  // The default Ollama: named ollama, and a run record says nothing about it.
  expect(idOf(options)).toBe("ollama");
  expect(endpointKind(options)).toBeUndefined();
  // A hosted endpoint: named hosted, recorded hosted.
  expect(idOf(hosted)).toBe("hosted");
  expect(endpointKind(hosted)).toBe("hosted");
  // An explicit local base URL (a llama-server, a LAN box) keeps the name it always had and is recorded local.
  const lan = { ...options, baseUrl: "http://192.168.1.20:8080/v1" };
  expect(idOf(lan)).toBe("hosted");
  expect(endpointKind(lan)).toBe("local");
  // The key-reference guard is still the argument parser's: a key reference with a local base URL is refused there.
  expect(() =>
    parseArgs([
      "--episodes=1",
      "--base-url=http://localhost:11434/v1",
      "--key-ref=k",
    ]),
  ).toThrow(/--key-ref is sent only to a non-local https:\/\/ --base-url/);
});
