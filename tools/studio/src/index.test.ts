import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStudioSession,
  readStudioStatus,
  type StudioSession,
} from "@panthea/assets/studio";
import { runSlots } from "../../../packages/assets/src/studio/_test-fixtures";
import { readLog } from "../../../packages/assets/src/studio/_test-runtime";
import {
  alive,
  assetRig,
  capture,
  heldBy,
  parsed,
  pipe,
  removeTempRoots,
  runtimeRig,
  sleep,
  tempRoot,
  waitFor,
} from "./_testkit";
import { type Io, main, parseArgv, type Signals } from "./index";

afterEach(removeTempRoots);

const SOUTH = JSON.stringify([{ state: "idle", direction: "south" }]);

function harness(over: { stdin?: AsyncIterable<string> } = {}) {
  const cap = capture();
  const signals = new Set<(signal: string) => void>();
  const io: Io = {
    stdin: over.stdin ?? (async function* () {})(),
    stdout: (line) => cap.out.push(line),
    stderr: (line) => cap.err.push(line),
  };
  const hub: Signals = {
    subscribe: (handler) => {
      signals.add(handler);
      return () => signals.delete(handler);
    },
  };
  return {
    cap,
    io,
    hub,
    fire: (s: string) => {
      for (const h of signals) h(s);
    },
  };
}

const configDirs: string[] = [];
afterEach(() => {
  for (const d of configDirs.splice(0))
    rmSync(d, { recursive: true, force: true });
});

/** The config file a user would write for the staged runtime. */
function configFile(rig: Awaited<ReturnType<typeof runtimeRig>>): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-cfg-"));
  configDirs.push(dir);
  const file = join(dir, "studio.json");
  writeFileSync(
    file,
    JSON.stringify({
      studioRoot: rig.root,
      contentRoot: rig.config.contentRoot,
      registryRoot: rig.config.registryRoot,
      artifactRoot: rig.dir,
      runtime: {
        port: rig.config.runtime?.port,
        pollMs: 15,
        deadlines: rig.config.runtime?.deadlines,
      },
    }),
  );
  return file;
}

describe("a session started on a root another process holds", () => {
  test("it stays up read-only instead of exiting: reads answer, a write is root-locked with the holder, and ending stdin exits 0", async () => {
    const rig = assetRig();
    rig.session.close();
    const deps = heldBy(4242);
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main(["session", "--root", rig.root], h.io, deps, h.hub);

    stdin.send('{"id":"s","op":"status","args":{}}');
    stdin.send('{"id":"l","op":"list","args":{"kind":"jobs"}}');
    stdin.send(
      JSON.stringify({
        id: "g",
        op: "generate",
        args: { id: "r", subject: "zeus", kind: "sprite", slots: [] },
      }),
    );
    stdin.send('{"id":"s2","op":"status","args":{}}');
    stdin.end();
    const code = await done;

    const responses = parsed(h.cap.out);
    const byId = (id: string) => responses.find((r) => r.id === id);
    expect(code).toBe(0);
    expect(responses).toHaveLength(4);
    expect(byId("s")).toMatchObject({
      ok: true,
      result: { rootLock: { holder: "other", pid: 4242 } },
    });
    expect(byId("l")).toMatchObject({ ok: true, result: [] });
    expect(byId("g")).toMatchObject({
      ok: false,
      error: { code: "root-locked", holder: 4242 },
    });
    expect(byId("s2")).toMatchObject({ ok: true });
    expect(h.cap.err.join("\n")).toContain("read-only");
  });

  test("an edit session exists to write, so it still stops on a held root", async () => {
    const rig = assetRig();
    rig.session.close();
    const h = harness();

    const code = await main(
      ["open", "--root", rig.root, "--id", "e1", "--working-set-id", "w"],
      h.io,
      heldBy(4242),
      h.hub,
    );

    expect(code).toBe(1);
    expect(parsed(h.cap.out)[0]).toMatchObject({
      ok: false,
      error: { code: "root-locked", holder: 4242 },
    });
  });
});

describe("command lines", () => {
  test("flags become arguments by name, with whole numbers and JSON converted by the command's own spec", () => {
    const parsedArgs = parseArgv([
      "generate",
      "--id",
      "r1",
      "--subject",
      "zeus",
      "--kind",
      "sprite",
      "--slots",
      SOUTH,
      "--batch",
      "4",
      "--seed",
      "77",
      "--style-note",
      "dusk",
      "--config",
      "/c.json",
      "--root",
      "/r",
    ]);

    expect(parsedArgs).toEqual({
      op: "generate",
      args: {
        id: "r1",
        subject: "zeus",
        kind: "sprite",
        slots: JSON.parse(SOUTH),
        batch: 4,
        seed: 77,
        styleNote: "dusk",
      },
      config: "/c.json",
      root: "/r",
    });
  });

  test("finish takes a method and a description as flags", () => {
    expect(
      parseArgv([
        "finish",
        "--id",
        "e1",
        "--png",
        "/a.png",
        "--json",
        "/a.json",
        "--method",
        "script",
        "--description",
        "scripted outline recolour (tools/probes/art-edit/sprite_cleanup_c2c.py)",
      ]),
    ).toMatchObject({
      op: "finish",
      args: {
        id: "e1",
        png: "/a.png",
        json: "/a.json",
        method: "script",
        description:
          "scripted outline recolour (tools/probes/art-edit/sprite_cleanup_c2c.py)",
      },
    });
  });

  test("a bare word fills the command's positional argument, and set takes a sub-command", () => {
    expect(parseArgv(["list", "jobs"])).toMatchObject({
      op: "list",
      args: { kind: "jobs" },
    });
    expect(
      parseArgv(["set", "create", "--id", "w", "--request-id", "r"]),
    ).toMatchObject({
      op: "set-create",
      args: { id: "w", requestId: "r" },
    });
    expect(parseArgv(["session"])).toMatchObject({ op: "session", args: {} });
  });

  test("a JSON flag may name a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-argv-"));
    try {
      writeFileSync(
        join(dir, "a.json"),
        JSON.stringify([{ expression: "awed" }]),
      );

      expect(
        parseArgv(["generate", "--slots", `@${join(dir, "a.json")}`]),
      ).toMatchObject({
        args: { slots: [{ expression: "awed" }] },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const usage: [string, string[]][] = [
    ["no command", []],
    ["an unknown command", ["levitate"]],
    ["a flag without a value", ["status", "--root"]],
    ["a flag followed by a flag", ["status", "--root", "--config", "x"]],
    ["a repeated flag", ["status", "--root", "a", "--root", "b"]],
    ["a stray word", ["status", "extra"]],
    [
      "a non-numeric whole number",
      ["reroll", "--request-id", "r", "--per-slot", "four"],
    ],
    [
      "a negative whole number",
      ["reroll", "--request-id", "r", "--per-slot", "-4"],
    ],
    ["unparseable JSON", ["generate", "--slots", "[oops"]],
    ["a missing JSON file", ["generate", "--slots", "@/nope.json"]],
    ["set without a sub-command", ["set"]],
    ["--yes", ["approve", "--id", "p", "--yes", "true"]],
  ];
  for (const [name, argv] of usage)
    test(`${name} is a usage error`, () => {
      const result = parseArgv(argv);

      expect(result).toMatchObject({ ok: false });
      expect(
        !("op" in result) && "error" in result && result.error.code,
      ).toMatch(/invalid-arguments|unknown-op/);
    });

  test("--yes says what to do instead and never approves", () => {
    const result = parseArgv(["approve", "--id", "p", "--yes", "true"]);

    expect(JSON.stringify(result)).toContain("--confirm");
  });
});

describe("one-shot runs", () => {
  test("a usage error prints one JSON error line on stdout, nothing else, and exits 64", async () => {
    const h = harness();

    const code = await main(["levitate"], h.io, {}, h.hub);

    expect(code).toBe(64);
    expect(parsed(h.cap.out)).toEqual([
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "unknown-op" }),
      }),
    ]);
    expect(h.cap.err).toEqual([]);
  });

  test("a bad config file is a config error with exit 64", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-cfg-"));
    try {
      writeFileSync(join(dir, "bad.json"), '{"profile": {}}');
      const h = harness();

      const code = await main(
        ["status", "--config", join(dir, "bad.json")],
        h.io,
        {},
        h.hub,
      );

      expect(code).toBe(64);
      expect(parsed(h.cap.out)[0]).toMatchObject({
        ok: false,
        error: { code: "invalid-config" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("status with only --root reads a store and prints one JSON result line", async () => {
    const rig = assetRig();
    rig.session.close();
    const h = harness();

    const code = await main(["status", "--root", rig.root], h.io, {}, h.hub);

    expect(code).toBe(0);
    expect(parsed(h.cap.out)).toEqual([
      {
        ok: true,
        result: expect.objectContaining({ counts: expect.any(Object) }),
      },
    ]);
  });

  test("generate prints one result line on stdout and progress on stderr, and exits 0", async () => {
    const rig = await runtimeRig();
    const dir = mkdtempSync(join(tmpdir(), "studio-cfg-"));
    try {
      writeFileSync(
        join(dir, "studio.json"),
        JSON.stringify({
          studioRoot: rig.root,
          contentRoot: rig.config.contentRoot,
          artifactRoot: rig.dir,
          runtime: {
            port: rig.config.runtime?.port,
            pollMs: 15,
            deadlines: rig.config.runtime?.deadlines,
          },
        }),
      );
      const h = harness();

      const code = await main(
        [
          "generate",
          "--config",
          join(dir, "studio.json"),
          "--id",
          "zeus-idle",
          "--subject",
          "zeus",
          "--kind",
          "sprite",
          "--slots",
          SOUTH,
          "--batch",
          "1",
          "--seed",
          "9",
        ],
        h.io,
        rig.deps,
        h.hub,
      );

      expect(code).toBe(0);
      expect(h.cap.out).toHaveLength(1);
      expect(parsed(h.cap.out)[0]).toMatchObject({
        ok: true,
        result: { state: "completed" },
      });
      expect(h.cap.err.length).toBeGreaterThan(0);
      expect(h.cap.err.every((l) => l.startsWith("[studio] "))).toBe(true);
      expect(readStudioStatus(rig.root).jobs[0]?.job.status).toBe("succeeded");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an interrupt during generation aborts the running job, stops the server, releases the root and exits 1", async () => {
    const rig = await runtimeRig({
      sequence: ["hang"],
      grandchild: true,
      ignoreTerm: true,
    });
    const h = harness();
    const done = main(
      [
        "generate",
        "--config",
        configFile(rig),
        "--id",
        "zeus-idle",
        "--subject",
        "zeus",
        "--kind",
        "sprite",
        "--slots",
        SOUTH,
        "--batch",
        "2",
        "--seed",
        "9",
      ],
      h.io,
      rig.deps,
      h.hub,
    );
    await waitFor(() => readLog(rig.dir).some((e) => e.event === "img_gen"));
    await waitFor(() => readLog(rig.dir).some((e) => e.event === "grand"));
    const pids = [
      ...new Set(
        readLog(rig.dir)
          .filter((e) => e.event === "start" || e.event === "grand")
          .map((e) => e.pid),
      ),
    ];

    h.fire("SIGINT");
    const code = await done;

    expect(code).toBe(1);
    expect(parsed(h.cap.out)).toEqual([
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "interrupted" }),
      }),
    ]);
    const jobs = readStudioStatus(rig.root).jobs;
    expect(jobs.find((j) => j.job.id === "zeus-idle-0000")?.job).toMatchObject({
      status: "cancelled",
      cancelledBy: "aborted",
    });
    expect(
      jobs.find((j) => j.job.id === "zeus-idle-0001")?.job.status,
    ).not.toBe("succeeded");
    expect(pids.length).toBe(2);
    expect(pids.every((pid) => !alive(pid))).toBe(true);
    const reopened = openStudioSession(rig.root);
    expect(reopened.kind).toBe("opened");
    if (reopened.kind === "opened") reopened.session.close();
  });
});

describe("a session", () => {
  test("answers one correlated JSON line per request, and refuses a bad line without ending", async () => {
    const rig = assetRig();
    rig.session.close();
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main(["session", "--root", rig.root], h.io, {}, h.hub);

    stdin.send("not json");
    stdin.send('{"op":"status"}');
    stdin.send('{"id":"a","op":"status","args":{},"extra":1}');
    stdin.send('{"id":"b","op":"levitate"}');
    stdin.send('{"id":"c","op":"status","args":{"nope":1}}');
    stdin.send('{"id":"d","op":"status"}');
    stdin.send("[]");
    await waitFor(() => h.cap.out.length >= 7);
    stdin.end();
    const code = await done;

    expect(code).toBe(0);
    const responses = parsed(h.cap.out);
    const byId = (id: string | null) => responses.find((r) => r.id === id);
    expect(
      responses.every(
        (r) =>
          Object.keys(r).sort().join() ===
          (r.ok ? "id,ok,result" : "error,id,ok"),
      ),
    ).toBe(true);
    expect(responses.filter((r) => r.id === null)).toHaveLength(3);
    expect(byId("a")).toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
    expect(byId("b")).toMatchObject({
      ok: false,
      error: { code: "unknown-op" },
    });
    expect(byId("c")).toMatchObject({
      ok: false,
      error: { code: "invalid-arguments" },
    });
    expect(byId("d")).toMatchObject({
      ok: true,
      result: { counts: expect.any(Object) },
    });
    expect(h.cap.err).toEqual([]);
  });

  test("an op named like an inherited property is answered once with unknown-op and its id, and the next request is still served", async () => {
    const rig = assetRig();
    rig.session.close();
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main(["session", "--root", rig.root], h.io, {}, h.hub);

    stdin.send('{"id":"bad","op":"toString","args":{}}');
    stdin.send('{"id":"ctor","op":"constructor"}');
    stdin.send('{"id":"proto","op":"__proto__","args":{}}');
    stdin.send('{"id":"ok","op":"status","args":{}}');
    await waitFor(() => h.cap.out.length >= 4);
    stdin.end();
    const code = await done;

    expect(code).toBe(0);
    const responses = parsed(h.cap.out);
    expect(responses).toHaveLength(4);
    for (const id of ["bad", "ctor", "proto"]) {
      const mine = responses.filter((r) => r.id === id);
      expect(mine, id).toHaveLength(1);
      expect(mine[0], id).toMatchObject({
        ok: false,
        error: { code: "unknown-op" },
      });
    }
    expect(responses.filter((r) => r.id === "ok")).toEqual([
      expect.objectContaining({ ok: true, result: expect.any(Object) }),
    ]);
    expect(h.cap.err).toEqual([]);
  });

  test("each op the app added answers an inherited-name argument once with invalid-arguments and its id, and the next request is still served", async () => {
    const rig = assetRig();
    rig.session.close();
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main(["session", "--root", rig.root], h.io, {}, h.hub);
    const ops = [
      "resolve",
      "source-list",
      "source-resolve",
      "source-bytes",
      "source-keys",
      "edit-report",
      "candidate-frames",
      "candidate-bytes",
      "edit-workspace",
    ];

    for (const op of ops) {
      stdin.send(
        JSON.stringify({ id: `${op}:toString`, op, args: { toString: 1 } }),
      );
      stdin.send(`{"id":"${op}:proto","op":"${op}","args":{"__proto__":1}}`);
    }
    stdin.send('{"id":"ok","op":"status","args":{}}');
    stdin.end();
    const code = await done;

    expect(code).toBe(0);
    const responses = parsed(h.cap.out);
    expect(responses).toHaveLength(ops.length * 2 + 1);
    for (const op of ops)
      for (const id of [`${op}:toString`, `${op}:proto`]) {
        const mine = responses.filter((r) => r.id === id);
        expect(mine, id).toHaveLength(1);
        expect(mine[0], id).toMatchObject({
          ok: false,
          error: { code: "invalid-arguments" },
        });
      }
    expect(responses.filter((r) => r.id === "ok")).toHaveLength(1);
    expect(h.cap.err).toEqual([]);
  });

  test("exactly two responses come back for a bad inherited-name op followed by a status, in that order", async () => {
    const rig = assetRig();
    rig.session.close();
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main(["session", "--root", rig.root], h.io, {}, h.hub);

    stdin.send('{"id":"bad","op":"toString","args":{}}');
    await waitFor(() => h.cap.out.length >= 1);
    stdin.send('{"id":"status","op":"status","args":{}}');
    await waitFor(() => h.cap.out.length >= 2);
    stdin.end();
    await done;

    const responses = parsed(h.cap.out);
    expect(responses.map((r) => r.id)).toEqual(["bad", "status"]);
    expect(responses[0]).toMatchObject({
      ok: false,
      error: { code: "unknown-op" },
    });
    expect(responses[1]).toMatchObject({ ok: true });
  });

  test("keeps answering while a generation runs, ends a running job on abort, and on end of input finishes the queue before it exits 0", async () => {
    const rig = await runtimeRig({ sequence: ["hang", "ok"] });
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main(
      ["session", "--config", configFile(rig)],
      h.io,
      rig.deps,
      h.hub,
    );
    const request = (id: string, op: string, args: unknown) =>
      stdin.send(JSON.stringify({ id, op, args }));
    const reply = (id: string) => parsed(h.cap.out).find((r) => r.id === id);

    request("g1", "generate", {
      id: "first",
      subject: "zeus",
      kind: "sprite",
      slots: JSON.parse(SOUTH),
      batch: 1,
      seed: 1,
    });
    await waitFor(() => reply("g1") !== undefined);
    expect(reply("g1")).toMatchObject({
      ok: true,
      result: { state: "queued", jobIds: ["first-0000"] },
    });
    await waitFor(() => readLog(rig.dir).some((e) => e.event === "img_gen"));
    request("s1", "status", {});
    request("g2", "generate", {
      id: "second",
      subject: "zeus",
      kind: "sprite",
      slots: [{ state: "idle", direction: "north" }],
      batch: 1,
      seed: 2,
    });
    await waitFor(() => reply("s1") !== undefined && reply("g2") !== undefined);
    expect(reply("s1")).toMatchObject({
      ok: true,
      result: { jobs: { running: 1 } },
    });
    request("a1", "abort", { jobId: "first-0000" });
    await waitFor(() => reply("a1") !== undefined);
    expect(reply("a1")).toMatchObject({
      ok: true,
      result: { state: "aborted" },
    });

    stdin.end();
    const code = await done;

    expect(code).toBe(0);
    const jobs = readStudioStatus(rig.root).jobs;
    expect(jobs.map((j) => [j.job.id, j.job.status])).toEqual([
      ["first-0000", "cancelled"],
      ["second-0000", "succeeded"],
    ]);
    expect(h.cap.out.every((l) => !l.includes("negative_prompt"))).toBe(true);
    const reopened = openStudioSession(rig.root);
    expect(reopened.kind).toBe("opened");
    if (reopened.kind === "opened") reopened.session.close();
  });

  test("an interrupt stops the running job and the server, refuses further commands, and exits 1", async () => {
    const rig = await runtimeRig({ sequence: ["hang"] });
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main(
      ["session", "--config", configFile(rig)],
      h.io,
      rig.deps,
      h.hub,
    );
    stdin.send(
      JSON.stringify({
        id: "g",
        op: "generate",
        args: {
          id: "zeus-idle",
          subject: "zeus",
          kind: "sprite",
          slots: JSON.parse(SOUTH),
          batch: 1,
          seed: 1,
        },
      }),
    );
    await waitFor(() => readLog(rig.dir).some((e) => e.event === "img_gen"));

    h.fire("SIGTERM");
    const code = await done;

    expect(code).toBe(1);
    expect(readStudioStatus(rig.root).jobs[0]?.job).toMatchObject({
      status: "cancelled",
      cancelledBy: "aborted",
    });
    const pids = readLog(rig.dir)
      .filter((e) => e.event === "start")
      .map((e) => e.pid);
    expect(pids.every((pid) => !alive(pid))).toBe(true);
  });

  const generateLine = (id: string, slots: string, seed: number) =>
    JSON.stringify({
      id,
      op: "generate",
      args: {
        id,
        subject: "zeus",
        kind: "sprite",
        slots: JSON.parse(slots),
        batch: 1,
        seed,
      },
    });
  const NORTH = JSON.stringify([{ state: "idle", direction: "north" }]);
  const pidsOf = (dir: string) => [
    ...new Set(
      readLog(dir)
        .filter((e) => e.event === "start" || e.event === "grand")
        .map((e) => e.pid),
    ),
  ];

  test("a result write that fails mid-drain ends the session with exit 1, leaves the job unfinished, and releases the root only once the server is gone", async () => {
    const rig = await runtimeRig({
      jobDelayMs: 300,
      grandchild: true,
      ignoreTerm: true,
    });
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main(
      ["session", "--config", configFile(rig)],
      h.io,
      rig.deps,
      h.hub,
    );
    stdin.send(generateLine("zeus-idle", SOUTH, 1));
    await waitFor(() => readLog(rig.dir).some((e) => e.event === "img_gen"));
    mkdirSync(join(rig.root, "commands", "00000003.json"));
    await waitFor(() => readLog(rig.dir).some((e) => e.event === "grand"));

    stdin.end();
    const code = await done;

    expect(code).toBe(1);
    expect(parsed(h.cap.out)[0]).toMatchObject({
      id: "zeus-idle",
      ok: true,
      result: { state: "queued" },
    });
    expect(h.cap.err.join("\n")).toContain("drain stopped: write-failed");
    const job = readStudioStatus(rig.root).jobs[0]?.job;
    expect(job?.status).toBe("running");
    const pids = pidsOf(rig.dir);
    expect(pids.length).toBe(2);
    expect(pids.every((pid) => !alive(pid))).toBe(true);
    expect(readStudioStatus(rig.root).session?.endedAt).toBeString();
  });

  test("a session whose jobs failed or were unavailable exits 1 at end of input, and the failed job is on record", async () => {
    const failing = await runtimeRig({ sequence: ["failed"] });
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main(
      ["session", "--config", configFile(failing)],
      h.io,
      failing.deps,
      h.hub,
    );
    stdin.send(generateLine("zeus-idle", SOUTH, 1));
    await waitFor(() => h.cap.out.length === 1);
    stdin.end();

    expect(await done).toBe(1);
    expect(readStudioStatus(failing.root).jobs[0]?.job.status).toBe("failed");

    const missing = await runtimeRig();
    rmSync(join(missing.dir, "models", "vae.bin"));
    const stdin2 = pipe();
    const g = harness({ stdin: stdin2.iterable });
    const done2 = main(
      ["session", "--config", configFile(missing)],
      g.io,
      missing.deps,
      g.hub,
    );
    stdin2.send(generateLine("zeus-idle", SOUTH, 1));
    await waitFor(() => g.cap.out.length === 1);
    stdin2.end();

    expect(await done2).toBe(1);
    expect(readStudioStatus(missing.root).jobs[0]?.job.status).toBe(
      "unavailable",
    );
  });

  test("a session whose only unfinished jobs were cancelled by the operator, by remove or abort, still exits 0", async () => {
    const rig = await runtimeRig({ sequence: ["hang"] });
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main(
      ["session", "--config", configFile(rig)],
      h.io,
      rig.deps,
      h.hub,
    );
    stdin.send(generateLine("a", SOUTH, 1));
    await waitFor(() => readLog(rig.dir).some((e) => e.event === "img_gen"));
    stdin.send(generateLine("b", NORTH, 2));
    await waitFor(() => h.cap.out.length === 2);
    stdin.send('{"id":"r","op":"remove","args":{"jobId":"b-0000"}}');
    stdin.send('{"id":"x","op":"abort","args":{"jobId":"a-0000"}}');
    await waitFor(() => h.cap.out.length === 4);
    stdin.end();

    expect(await done).toBe(0);
    expect(
      readStudioStatus(rig.root).jobs.map((j) => [j.job.id, j.job.status]),
    ).toEqual([
      ["a-0000", "cancelled"],
      ["b-0000", "cancelled"],
    ]);
  });

  test("a session started on a root another process owns no longer exits busy: it serves read-only and exits 0 when stdin ends", async () => {
    const rig = assetRig();
    const h = harness();

    const code = await main(["session", "--root", rig.root], h.io, {}, h.hub);

    expect(code).toBe(0);
    expect(parsed(h.cap.out)).toEqual([]);
    expect(h.cap.err.join("\n")).toContain("serving read-only");
    rig.session.close();
  });
});

describe("open", () => {
  function pickedRoot() {
    const rig = assetRig();
    const [id] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    rig.session.pick("w", id as string);
    rig.session.close();
    const file = join(
      mkdtempSync(join(tmpdir(), "studio-cfg-")),
      "studio.json",
    );
    configDirs.push(join(file, ".."));
    writeFileSync(
      file,
      JSON.stringify({
        studioRoot: rig.root,
        contentRoot: "/content",
        editor: { timeoutMs: 1000, editPollMs: 15 },
      }),
    );
    const calls: string[] = [];
    const deps = {
      loadContent: () => ({ ok: true as const, content: rig.content }),
      createEditor: (session: StudioSession) => ({
        openWorkspace: async (editId: string) => {
          session.store.putEditFile(
            editId,
            "workspace.aseprite",
            new TextEncoder().encode("v1"),
          );
          return {
            ok: true as const,
            readback: {
              rgb: true,
              size: { w: 64, h: 80 },
              durationsMs: [167],
              tags: [],
              pivots: {},
              palette: [],
            },
          };
        },
        refresh: async (editId: string, _content: unknown, mode: string) => {
          calls.push(`${mode} ${editId}`);
          return { ok: true as const, changed: true };
        },
        refreshFallback: () => ({
          ok: false as const,
          reason: "wrong-state" as const,
          message: "unused",
        }),
        close: async () => {},
      }),
    };
    return { rig, file, deps, calls };
  }
  const OPEN = [
    "open",
    "--id",
    "e1",
    "--working-set-id",
    "w",
    "--slots",
    '["idle/south"]',
  ];

  test("serves one edit in the foreground until finish: the open answer, one import per changed workspace, then exit 0", async () => {
    const { rig, file, deps, calls } = pickedRoot();
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main([...OPEN, "--config", file], h.io, deps, h.hub);
    await waitFor(() => h.cap.out.length === 1);
    expect(parsed(h.cap.out)[0]).toMatchObject({
      id: "open",
      ok: true,
      result: { editId: "e1" },
    });

    writeFileSync(join(rig.root, "edits", "e1", "workspace.aseprite"), "v2");
    await waitFor(() => calls.includes("import e1"));
    stdin.send('{"id":"f","op":"finish","args":{"id":"e1"}}');
    const code = await done;

    expect(code).toBe(0);
    expect(calls.filter((c) => c === "import e1")).toHaveLength(1);
    expect(parsed(h.cap.out).find((r) => r.id === "f")).toMatchObject({
      ok: true,
      result: { state: "finished" },
    });
  });

  test("end of input with the edit still open leaves it open and exits 1", async () => {
    const { rig, file, deps } = pickedRoot();
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main([...OPEN, "--config", file], h.io, deps, h.hub);
    await waitFor(() => h.cap.out.length === 1);

    stdin.end();

    expect(await done).toBe(1);
    expect(readStudioStatus(rig.root).edits[0]?.status).toBe("open");
    const reopened = openStudioSession(rig.root);
    expect(reopened.kind).toBe("opened");
    if (reopened.kind === "opened") reopened.session.close();
  });

  test("a discard ends it with exit 0, and an open that cannot build its workspace ends at once with exit 1", async () => {
    const { file, deps } = pickedRoot();
    const stdin = pipe();
    const h = harness({ stdin: stdin.iterable });
    const done = main([...OPEN, "--config", file], h.io, deps, h.hub);
    await waitFor(() => h.cap.out.length === 1);
    stdin.send('{"id":"d","op":"discard","args":{"id":"e1"}}');
    expect(await done).toBe(0);

    const failing = pickedRoot();
    const g = harness({ stdin: pipe().iterable });
    const code = await main(
      [...OPEN, "--config", failing.file],
      g.io,
      {
        ...failing.deps,
        createEditor: () => ({
          openWorkspace: async () => ({
            ok: false as const,
            reason: "editor-unavailable" as const,
            message: "no editor",
          }),
          refresh: async () => ({
            ok: false as const,
            reason: "editor-unavailable" as const,
            message: "no editor",
          }),
          refreshFallback: () => ({
            ok: false as const,
            reason: "wrong-state" as const,
            message: "unused",
          }),
          close: async () => {},
        }),
      },
      g.hub,
    );
    expect(code).toBe(1);
    expect(parsed(g.cap.out)[0]).toMatchObject({
      id: "open",
      ok: false,
      error: { code: "editor-unavailable" },
    });
  });
});

describe("the process", () => {
  const ENTRY = join(import.meta.dir, "index.ts");
  const children: number[] = [];
  afterEach(() => {
    for (const pid of children.splice(0)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });

  function start(args: string[]) {
    const child = spawn(process.execPath, [ENTRY, ...args], {
      env: { PATH: process.env.PATH ?? "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (child.pid !== undefined) children.push(child.pid);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const exited = new Promise<number>((resolve) =>
      child.on("close", (code) => resolve(code ?? -1)),
    );
    return { child, exited, out: () => out, err: () => err };
  }

  test("usage errors exit 64 with one JSON line on stdout and nothing on stderr", async () => {
    for (const argv of [
      [],
      ["levitate"],
      ["status", "--root"],
      ["approve", "--id", "p", "--yes", "1"],
    ]) {
      const p = start(argv);
      expect(await p.exited, argv.join(" ")).toBe(64);
      expect(p.out().trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(p.out())).toMatchObject({ ok: false });
      expect(p.err()).toBe("");
    }
  });

  test("status reads a root another process owns, and a mutation against it is refused as busy with exit 1", async () => {
    const rig = assetRig();
    runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);

    const status = start(["status", "--root", rig.root]);
    const remove = start([
      "remove",
      "--root",
      rig.root,
      "--job-id",
      "zeus-idle-0000",
    ]);

    expect(await status.exited).toBe(0);
    expect(JSON.parse(status.out())).toMatchObject({
      ok: true,
      result: { counts: { jobs: 1 } },
    });
    expect(await remove.exited).toBe(1);
    expect(JSON.parse(remove.out())).toMatchObject({
      ok: false,
      error: { code: "busy" },
    });
    rig.session.close();
  });

  test("a session answers on stdout only, leaves the root on end of input, and exits 0", async () => {
    const root = tempRoot();
    const p = start(["session", "--root", root]);
    p.child.stdin.write('{"id":"1","op":"status"}\nnot json\n');
    await waitFor(() => p.out().split("\n").filter(Boolean).length >= 2);
    p.child.stdin.end();

    expect(await p.exited).toBe(0);
    const lines = p
      .out()
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ id: "1", ok: true });
    expect(lines[1]).toMatchObject({
      id: null,
      ok: false,
      error: { code: "invalid-request" },
    });
    expect(p.err()).toBe("");
  });

  test("a session owns its root until it exits: a second one is busy for mutations, and an interrupt releases the root with exit 1", async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    const owner = start(["session", "--root", root]);
    owner.child.stdin.write(
      '{"id":"1","op":"pick","args":{"workingSetId":"w","candidateId":"c"}}\n',
    );
    await waitFor(() => owner.out().includes('"id":"1"'));
    const second = start(["remove", "--root", root, "--job-id", "x"]);
    const status = start(["status", "--root", root]);

    expect(await second.exited).toBe(1);
    expect(JSON.parse(second.out())).toMatchObject({ error: { code: "busy" } });
    expect(await status.exited).toBe(0);
    owner.child.kill("SIGTERM");
    expect(await owner.exited).toBe(1);

    const reopened = openStudioSession(root);
    expect(reopened.kind).toBe("opened");
    if (reopened.kind === "opened") reopened.session.close();
  });
});

void sleep;
void readdirSync;
void (null as unknown as StudioSession);
