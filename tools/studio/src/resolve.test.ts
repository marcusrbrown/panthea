import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  buildSpec,
  openStudioSession,
  readStudioStatus,
  type StudioRuntime,
} from "@panthea/assets/studio";
import {
  capture,
  depsFor,
  REAL_CONTENT,
  realContent,
  removeTempRoots,
  run,
  tempRoot,
} from "./_testkit";
import { execute } from "./commands";
import type { StudioConfig } from "./config";
import { exitOf } from "./format";
import { Studio } from "./host";

afterEach(removeTempRoots);

const SOUTH = [{ state: "idle", direction: "south" }];
const REQUEST = {
  id: "zeus-idle",
  subject: "zeus",
  kind: "sprite",
  slots: SOUTH,
  batch: 2,
  seed: 77,
  styleNote: "warm light",
} as const;

/** A runtime that refuses to drain: generate stores its request and returns, with no server. A refusal also keeps the host from re-kicking the queue it leaves behind. */
const runtimeConfig = (root: string): StudioConfig => ({
  studioRoot: root,
  contentRoot: REAL_CONTENT,
  artifactRoot: root,
  runtime: {
    port: 1,
    pollMs: 10,
    deadlines: {
      httpMs: 1,
      startupMs: 1,
      generationMs: 1,
      termGraceMs: 1,
      killMs: 1,
    },
  },
});

const idleRuntime = (): StudioRuntime => ({
  drain: async () => ({ ok: false, reason: "closed", message: "stub" }),
  abort: async () => ({ ok: true }),
  close: async () => ({ ok: true }),
  shutdown: async () => ({ ok: true }),
});

describe("resolve", () => {
  test("returns the request and spec a following generate stores for the same input", async () => {
    const root = tempRoot();
    const config = runtimeConfig(root);
    const resolved = await run(config, "resolve", REQUEST);
    const studio = new Studio(
      config,
      depsFor(capture(), { openRuntime: idleRuntime }),
      "session",
    );
    const generated = await execute(studio, "generate", REQUEST);
    await studio.idle();
    await studio.teardown();

    expect(resolved.outcome.ok).toBe(true);
    expect(generated.ok).toBe(true);
    if (!resolved.outcome.ok) return;
    const stored = readStudioStatus(root).requests[0];
    expect(stored?.request).toEqual(
      (resolved.outcome.result as { request: unknown }).request as never,
    );
    const rebuilt = buildSpec(realContent(), stored?.request as never);
    if (!rebuilt.ok) throw new Error("the stored request does not build");
    expect((resolved.outcome.result as { spec: unknown }).spec).toEqual(
      JSON.parse(JSON.stringify(rebuilt.value)),
    );
    expect(
      (resolved.outcome.result as { spec: { slots: { key: string }[] } }).spec
        .slots[0]?.key,
    ).toBe("idle/south");
  });

  test("an omitted seed is drawn once and reported, and a supplied seed draws nothing", async () => {
    let draws = 0;
    const deps = {
      drawSeed: () => {
        draws += 1;
        return 4242;
      },
    };
    const config: StudioConfig = { contentRoot: REAL_CONTENT };
    const { seed: _seed, ...unseeded } = REQUEST;

    const drawn = await run(config, "resolve", unseeded, deps);
    const given = await run(config, "resolve", REQUEST, deps);

    expect(draws).toBe(1);
    expect(drawn.outcome).toMatchObject({
      ok: true,
      result: { request: { seed: 4242 } },
    });
    expect(given.outcome).toMatchObject({
      ok: true,
      result: { request: { seed: 77 } },
    });
  });

  test("an unknown subject is the subject-list refusal generate gives, and nothing is written", async () => {
    const root = tempRoot();
    const config = runtimeConfig(root);
    const input = { ...REQUEST, subject: "nobody" };

    const resolved = await run(config, "resolve", input);
    expect(existsSync(root)).toBe(false);
    const generated = await run(config, "generate", input, {
      openRuntime: idleRuntime,
    });

    expect(resolved.outcome).toMatchObject({
      ok: false,
      error: {
        code: "invalid-request",
        error: { kind: "unknown-subject", valid: expect.any(Array) },
      },
    });
    expect(resolved.outcome).toEqual(generated.outcome);
    expect(exitOf(resolved.outcome)).toBe(64);
  });

  test("works while another session owns the root, and the owner's records are untouched", async () => {
    const root = tempRoot();
    const held = openStudioSession(root);
    if (held.kind !== "opened") throw new Error("expected to own the root");
    try {
      const { outcome } = await run(
        { studioRoot: root, contentRoot: REAL_CONTENT },
        "resolve",
        REQUEST,
      );

      expect(outcome.ok).toBe(true);
      expect(readStudioStatus(root).requests).toEqual([]);
    } finally {
      held.session.close();
    }
  });

  test("needs only the content root: no studio root, runtime or registry", async () => {
    const { outcome } = await run(
      { contentRoot: REAL_CONTENT },
      "resolve",
      REQUEST,
    );
    expect(outcome.ok).toBe(true);

    const missing = await run({}, "resolve", REQUEST);
    expect(missing.outcome).toMatchObject({
      ok: false,
      error: { code: "missing-config", field: "contentRoot" },
    });
  });

  test("checks its arguments like generate does, and takes no edit files", async () => {
    const config: StudioConfig = { contentRoot: REAL_CONTENT };
    const cases: [string, unknown][] = [
      ["no slots", { ...REQUEST, slots: [] }],
      ["a bad slot key", { ...REQUEST, slots: [{ state: 1 }] }],
      ["an unknown argument", { ...REQUEST, dir: "/tmp" }],
      ["an edit mask", { ...REQUEST, editMask: "/tmp/mask.png" }],
      ["a missing id", { subject: "zeus", kind: "sprite", slots: SOUTH }],
    ];
    for (const [name, args] of cases) {
      const { outcome } = await run(config, "resolve", args);
      expect(outcome, name).toMatchObject({
        ok: false,
        error: { code: "invalid-arguments" },
      });
    }
    const kind = await run(config, "resolve", { ...REQUEST, kind: "tile" });
    expect(kind.outcome).toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
  });

  test("still answers while the session is shutting down", async () => {
    const studio = new Studio(
      { contentRoot: REAL_CONTENT },
      depsFor(capture()),
      "session",
    );
    const stopping = studio.teardown();
    const outcome = await execute(studio, "resolve", REQUEST);
    await stopping;
    expect(outcome.ok).toBe(true);
  });
});
