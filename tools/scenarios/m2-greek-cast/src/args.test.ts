import { expect, test } from "bun:test";
import { DEFAULT_JOBS, parseArgs } from "./args";
import { endpointOptions } from "./real";

test("the model defaults to the M2 local baseline, qwen3 8B at 4K, and reasoning is unset", () => {
  const args = parseArgs(["--real"]);
  expect(args.model).toBe("qwen3-8b-4k");
  expect(args.reasoningEffort).toBeUndefined();
});

test("--model and --reasoning-effort=none apply to both the real run and the episodes", () => {
  const real = parseArgs([
    "--real",
    "--model=gemma4-e4b-4k",
    "--reasoning-effort=none",
  ]);
  expect(real).toMatchObject({
    real: true,
    model: "gemma4-e4b-4k",
    reasoningEffort: "none",
  });
  const episodes = parseArgs([
    "--episodes=1",
    "--episode-seconds=60",
    "--model=gemma4-e4b-4k",
    "--reasoning-effort=none",
  ]);
  expect(episodes).toMatchObject({
    episodes: 1,
    episodeSeconds: 60,
    model: "gemma4-e4b-4k",
    reasoningEffort: "none",
  });
});

test("a reasoning effort other than none, and an empty model, are refused", () => {
  expect(() => parseArgs(["--reasoning-effort=high"])).toThrow(
    /reasoning-effort/,
  );
  expect(() => parseArgs(["--reasoning-effort="])).toThrow(/reasoning-effort/);
  expect(() => parseArgs(["--model="])).toThrow(/--model/);
});

test("the existing flags still parse: episodes, seconds, out, skip-build, and a positive control", () => {
  expect(
    parseArgs([
      "--skip-build",
      "--episodes=3",
      "--out=/tmp/x",
      "--positive-control=chain",
    ]),
  ).toMatchObject({
    skipBuild: true,
    episodes: 3,
    episodeSeconds: 300,
    out: "/tmp/x",
    control: "chain",
  });
  expect(() => parseArgs(["--nonsense"])).toThrow(/unknown argument/);
  expect(() => parseArgs(["--episodes=0"])).toThrow(/positive/);
});

test("the endpoint is local Ollama unless --base-url says otherwise, and no key reference is set", () => {
  const args = parseArgs(["--real"]);
  expect(args.baseUrl).toBeUndefined();
  expect(args.keyRef).toBeUndefined();
});

test("--base-url and --key-ref select a hosted endpoint and the Keychain entry for its key", () => {
  const args = parseArgs([
    "--episodes=1",
    "--model=gpt-x",
    "--base-url=https://hosted.example.com/v1",
    "--key-ref=hosted-key",
  ]);
  expect(args).toMatchObject({
    baseUrl: "https://hosted.example.com/v1",
    keyRef: "hosted-key",
    model: "gpt-x",
  });
});

test("a base URL that is not a URL, or carries credentials, is refused by the routing config's own rule", () => {
  expect(() => parseArgs(["--base-url=not a url"])).toThrow(/--base-url/);
  expect(() =>
    parseArgs(["--base-url=https://user:pw@example.com/v1"]),
  ).toThrow(/--base-url.*credentials/);
  expect(() => parseArgs(["--base-url="])).toThrow(/--base-url/);
  // Control: the same URL without credentials parses.
  expect(
    parseArgs(["--real", "--base-url=https://example.com/v1"]).baseUrl,
  ).toBe("https://example.com/v1");
});

test("an empty --key-ref is refused", () => {
  expect(() => parseArgs(["--key-ref="])).toThrow(/--key-ref/);
});

// --- Which endpoint flags may be combined -----------------------------------------------------

/** A reader that records every call, so a test can show the Keychain was never reached. */
function spyReader() {
  const reads: string[] = [];
  return {
    reads,
    read: async (keyRef: string) => {
      reads.push(keyRef);
      return "sk-sentinel-DO-NOT-LEAK-0123456789";
    },
  };
}

/** What run.ts does with the arguments: parse them, then read the key for the options. */
async function launch(
  argv: string[],
  read: (keyRef: string) => Promise<string>,
) {
  return endpointOptions(parseArgs(argv), read);
}

const REJECTED: readonly [string, string[], RegExp][] = [
  [
    "--key-ref alone, which would hand the key to local Ollama",
    ["--episodes=1", "--key-ref=hosted-key"],
    /--key-ref needs --base-url/,
  ],
  [
    "--key-ref with a local base URL",
    [
      "--episodes=1",
      "--base-url=http://localhost:11434/v1",
      "--key-ref=hosted-key",
    ],
    /--key-ref is sent only to a non-local https:\/\/ --base-url/,
  ],
  [
    "--key-ref with a plain-http hosted base URL, which would send the key in cleartext",
    [
      "--episodes=1",
      "--base-url=http://hosted.example.com/v1",
      "--key-ref=hosted-key",
    ],
    /--key-ref is sent only to a non-local https:\/\/ --base-url/,
  ],
  [
    "--base-url without --real or --episodes",
    ["--base-url=https://hosted.example.com/v1"],
    /--base-url applies only with --real or --episodes/,
  ],
  [
    "--key-ref and --base-url without --real or --episodes",
    ["--base-url=https://hosted.example.com/v1", "--key-ref=hosted-key"],
    /--key-ref applies only with --real or --episodes/,
  ],
];

test.each(REJECTED)(
  "rejected before any Keychain read: %s",
  async (_name, argv, message) => {
    const spy = spyReader();
    await expect(launch(argv, spy.read)).rejects.toThrow(message);
    expect(spy.reads).toEqual([]);
    // The message names flags, never a key value.
    await launch(argv, spy.read).catch((error: Error) => {
      expect(error.message).not.toContain("sk-sentinel");
    });
  },
);

test("the hosted invocation still parses, and reads the key once for its key reference", async () => {
  const argv = [
    "--episodes=1",
    "--base-url=https://hosted.example.com/v1",
    "--key-ref=hosted-key",
  ];
  expect(parseArgs(argv)).toMatchObject({
    episodes: 1,
    baseUrl: "https://hosted.example.com/v1",
    keyRef: "hosted-key",
  });
  const spy = spyReader();
  const options = await launch(argv, spy.read);
  expect(spy.reads).toEqual(["hosted-key"]);
  expect(options).toEqual({
    baseUrl: "https://hosted.example.com/v1",
    keyRef: "hosted-key",
    keys: { "hosted-key": "sk-sentinel-DO-NOT-LEAK-0123456789" },
  });
});

test("a local base URL without a key reference still parses, and reads no key", async () => {
  for (const argv of [
    ["--real", "--base-url=http://localhost:11434/v1"],
    ["--episodes=1", "--base-url=http://127.0.0.1:8080/v1"],
  ]) {
    expect(parseArgs(argv).baseUrl).toBeDefined();
    const spy = spyReader();
    expect(await launch(argv, spy.read)).toEqual({
      baseUrl: argv[1]?.slice("--base-url=".length),
    });
    expect(spy.reads).toEqual([]);
  }
});

test("a hosted base URL without a key reference parses (a keyless hosted endpoint) and reads no key", async () => {
  const spy = spyReader();
  const argv = ["--real", "--base-url=https://hosted.example.com/v1"];
  expect(parseArgs(argv).keyRef).toBeUndefined();
  expect(await launch(argv, spy.read)).toEqual({
    baseUrl: "https://hosted.example.com/v1",
  });
  expect(spy.reads).toEqual([]);
});

test("--write-readme runs four controls at once unless --jobs says otherwise", () => {
  expect(DEFAULT_JOBS).toBe(4);
  expect(parseArgs(["--write-readme"])).toMatchObject({
    writeReadme: true,
    jobs: 4,
  });
  expect(parseArgs(["--write-readme", "--jobs=1"]).jobs).toBe(1);
  expect(parseArgs(["--jobs=6", "--write-readme"]).jobs).toBe(6);
});

test("--jobs must be a positive whole number and applies only with --write-readme", () => {
  for (const bad of [
    "--jobs=0",
    "--jobs=-2",
    "--jobs=1.5",
    "--jobs=",
    "--jobs=x",
  ]) {
    expect(() => parseArgs(["--write-readme", bad])).toThrow(/--jobs/);
  }
  expect(() => parseArgs(["--jobs=2"])).toThrow(/only with --write-readme/);
  expect(() =>
    parseArgs(["--skip-build", "--positive-control=chain", "--jobs=2"]),
  ).toThrow(/only with --write-readme/);
});
