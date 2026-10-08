import { expect, test } from "bun:test";
import { DEFAULT_JOBS, parseArgs } from "./args";
import { endpointOptions } from "./real";
import {
  CONTROL_NAMES,
  CONTROL_STEP,
  STAGED_STEPS,
  WORLD_CONTROLS,
} from "./steps/context";

test("the model defaults to the M2 local baseline, granite3.3 8B at 4K, and reasoning is unset", () => {
  const args = parseArgs(["--real"]);
  expect(args.model).toBe("granite3.3-8b-4k");
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

test("--steps names staged steps that start a world of their own, and nothing else", () => {
  expect(parseArgs(["--skip-build", "--steps=S21,S24"]).steps).toEqual([
    "S21",
    "S24",
  ]);
  expect(parseArgs(["--skip-build"]).steps).toBeUndefined();
  // A step that rests on the story's world cannot run alone.
  for (const bad of [
    "--steps=S15",
    "--steps=S21,S1",
    "--steps=",
    "--steps=S28",
  ]) {
    expect(() => parseArgs([bad])).toThrow(/staged steps/);
  }
});

test("each staged-world control runs only its own step, and the others run the story", () => {
  for (const [control, step] of Object.entries(CONTROL_STEP)) {
    expect(STAGED_STEPS as readonly string[]).toContain(step);
    expect(CONTROL_NAMES as readonly string[]).toContain(control);
  }
  expect(CONTROL_STEP).toEqual({
    "strike-chain": "S21",
    "refusal-revenge": "S22",
    "no-answerer": "S24",
    "director-off": "S25",
    "remote-bless": "S26",
    "remote-strike": "S27",
  });
  // A control with no staged step reruns the story to the step it breaks.
  for (const control of ["chain", "isolation", "trace", "petition-privacy"]) {
    expect((CONTROL_STEP as Record<string, unknown>)[control]).toBeUndefined();
  }
  // The in-process world control is not a process control.
  expect(CONTROL_NAMES as readonly string[]).not.toContain("trouble-route");
  expect(WORLD_CONTROLS).toEqual(["trouble-route"]);
});

// --- The unattended run ----------------------------------------------------------------------

test("--unattended selects the one-world run at the full sixty minutes, on local Ollama, and the existing modes are off", () => {
  const args = parseArgs(["--unattended"]);
  expect(args).toMatchObject({
    unattended: true,
    unattendedMinutes: 60,
    scripted: undefined,
    episodes: 0,
    real: false,
    writeReadme: false,
  });
  // Without it nothing changes: the story, the episodes and the real run parse as they did.
  expect(parseArgs([])).toMatchObject({
    unattended: false,
    unattendedMinutes: 60,
    scripted: undefined,
  });
  expect(parseArgs(["--episodes=2"]).unattended).toBe(false);
  expect(parseArgs(["--real"]).unattended).toBe(false);
});

test("--unattended-minutes scales the running phases, takes a positive whole number, and needs --unattended", () => {
  expect(parseArgs(["--unattended", "--unattended-minutes=6"])).toMatchObject({
    unattended: true,
    unattendedMinutes: 6,
  });
  expect(
    parseArgs(["--unattended", "--unattended-minutes=1"]).unattendedMinutes,
  ).toBe(1);
  for (const bad of ["0", "-3", "2.5", "six", ""]) {
    expect(() =>
      parseArgs(["--unattended", `--unattended-minutes=${bad}`]),
    ).toThrow(/--unattended-minutes/);
  }
  expect(() => parseArgs(["--unattended-minutes=6"])).toThrow(
    /--unattended-minutes applies only with --unattended/,
  );
});

test("--unattended is refused with every other mode and with a hosted endpoint: one world, local only", () => {
  for (const other of [
    "--episodes=1",
    "--real",
    "--write-readme",
    "--positive-control=chain",
    "--steps=S21",
    "--base-url=http://127.0.0.1:9000/v1",
    "--key-ref=k",
  ]) {
    expect(() => parseArgs(["--unattended", other])).toThrow(/--unattended/);
    expect(() => parseArgs([other, "--unattended"])).toThrow(/--unattended/);
  }
  // Control: the flags that do apply parse alongside it.
  expect(
    parseArgs([
      "--unattended",
      "--skip-build",
      "--model=m",
      "--reasoning-effort=none",
      "--out=/tmp/x",
    ]),
  ).toMatchObject({
    unattended: true,
    skipBuild: true,
    model: "m",
    reasoningEffort: "none",
    out: "/tmp/x",
  });
});

test("--scripted answers the run from the scripted provider instead of Ollama, in one of two modes, and only with --unattended", () => {
  expect(parseArgs(["--unattended", "--scripted=answer"]).scripted).toBe(
    "answer",
  );
  expect(parseArgs(["--unattended", "--scripted=empty-200"]).scripted).toBe(
    "empty-200",
  );
  expect(() => parseArgs(["--unattended", "--scripted=other"])).toThrow(
    /--scripted/,
  );
  expect(() => parseArgs(["--unattended", "--scripted="])).toThrow(
    /--scripted/,
  );
  expect(() => parseArgs(["--scripted=answer"])).toThrow(
    /--scripted applies only with --unattended/,
  );
});
