import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "@panthea/assets";
import { spriteFixture } from "@panthea/assets/fixtures";
import {
  decodePng,
  fsWatcher,
  loadStudioContent,
  openStudioSession,
} from "@panthea/assets/studio";
import {
  fakeWatchFs,
  firstBlob,
  manualClock,
  publishCanon,
  writeDraft,
} from "../../../packages/assets/src/studio/_test-preview";
import {
  capture,
  depsFor,
  parsed,
  pipe,
  REAL_CONTENT,
  removeTempRoots,
} from "./_testkit";
import { execute } from "./commands";
import type { StudioConfig } from "./config";
import { exitOf, type Outcome } from "./format";
import { Studio } from "./host";
import { type Io, main } from "./index";

afterEach(removeTempRoots);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A registry with one published sprite, a store with no records yet, and the clock and watchers the test drives. */
function rig() {
  const base = mkdtempSync(join(tmpdir(), "studio-source-"));
  dirs.push(base);
  const registryRoot = join(base, "registry");
  const studioRoot = join(base, "studio");
  mkdirSync(registryRoot);
  mkdirSync(studioRoot);
  publishCanon(registryRoot, spriteFixture("placeholder-zeus"));
  const clock = manualClock();
  const config: StudioConfig = {
    studioRoot,
    registryRoot,
    contentRoot: REAL_CONTENT,
  };
  const deps = { watchRoot: clock.watch, schedule: clock.schedule };
  const studio = new Studio(config, depsFor(capture(), deps), "session");
  const call = (op: string, args: unknown = {}) => execute(studio, op, args);
  const touchDraft = (id: string) => {
    clock.touch(studioRoot, `assets/${id}.json`);
    clock.tick();
  };
  return {
    base,
    registryRoot,
    studioRoot,
    clock,
    config,
    deps,
    studio,
    call,
    touchDraft,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: replies are JSON read by shape in assertions
type Obj = Record<string, any>;
const ok = (outcome: Outcome): Obj => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.error.code}`);
  return outcome.result as Obj;
};

describe("source-list", () => {
  test("lists canon and the store's drafts, and takes no lock", async () => {
    const r = rig();
    writeDraft(r.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 1));
    r.touchDraft("zeus-take");
    const owner = openStudioSession(r.studioRoot);
    if (owner.kind !== "opened") throw new Error("expected to own the root");
    try {
      const listing = ok(await r.call("source-list"));

      expect(listing.entries.map((e: Obj) => `${e.source}:${e.id}`)).toEqual([
        "canon:placeholder-zeus",
        "draft:zeus-take",
      ]);
      expect(listing.problems).toEqual([]);
    } finally {
      owner.session.close();
      await r.studio.teardown();
    }
  });

  test("writes nothing: the store and registry are the same after every source op", async () => {
    const r = rig();
    writeDraft(r.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 1));
    r.touchDraft("zeus-take");
    const snapshot = () =>
      [r.registryRoot, r.studioRoot].map((root) =>
        readdirSync(root, { recursive: true }).sort(),
      );
    const before = snapshot();

    const resolved = ok(
      await r.call("source-resolve", { source: "draft", id: "zeus-take" }),
    );
    await r.call("source-list");
    await r.call("source-keys");
    await r.call("source-bytes", {
      source: "draft",
      id: "zeus-take",
      v: resolved.bytes.pixelKey,
    });

    expect(snapshot()).toEqual(before);
    await r.studio.teardown();
  });
});

describe("source-resolve", () => {
  test("returns the frames resolution for a draft, with its keys and no URL", async () => {
    const r = rig();
    writeDraft(r.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 1));
    r.touchDraft("zeus-take");

    const resolved = ok(
      await r.call("source-resolve", {
        source: "draft",
        id: "zeus-take",
        state: "idle",
        direction: "south",
      }),
    );

    expect(resolved).toMatchObject({
      kind: "frames",
      selection: { source: "draft", id: "zeus-take" },
      asset: { assetId: "placeholder-zeus", kind: "sprite" },
      bytes: { width: expect.any(Number), pixelKey: expect.any(String) },
    });
    expect(resolved.manifestKey).toMatch(/^[0-9a-f]{64}$/);
    expect(resolved.bytes).not.toHaveProperty("url");
    await r.studio.teardown();
  });

  test("a selection nothing holds resolves to the placeholder, not an error", async () => {
    const r = rig();
    const resolved = ok(
      await r.call("source-resolve", { source: "draft", id: "nothing-here" }),
    );
    expect(resolved).toMatchObject({
      kind: "placeholder",
      reason: "missing-id",
    });
    await r.studio.teardown();
  });

  test.each([
    ["a path-like id", { source: "draft", id: "../canary/secret" }],
    ["an absolute path", { source: "canon", id: "/etc/passwd" }],
    ["an unknown source", { source: "registry", id: "zeus-portrait" }],
    ["an unknown field", { source: "canon", id: "zeus-portrait", path: "/x" }],
    [
      "a malformed state",
      { source: "canon", id: "zeus-portrait", state: "../x" },
    ],
    ["no id", { source: "canon" }],
    ["no source", { id: "zeus-portrait" }],
  ])("refuses %s as an argument error", async (_name, args) => {
    const r = rig();
    const outcome = await r.call("source-resolve", args);
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "invalid-arguments" },
    });
    expect(exitOf(outcome)).toBe(64);
    await r.studio.teardown();
  });
});

describe("source-bytes", () => {
  test("with the current key returns the atlas as base64, which decodes to the validated size", async () => {
    const r = rig();
    writeDraft(r.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 1));
    r.touchDraft("zeus-take");
    const resolved = ok(
      await r.call("source-resolve", { source: "draft", id: "zeus-take" }),
    );

    const reply = ok(
      await r.call("source-bytes", {
        source: "draft",
        id: "zeus-take",
        v: resolved.bytes.pixelKey,
      }),
    );

    const png = new Uint8Array(Buffer.from(reply.base64, "base64"));
    const decoded = decodePng(png);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect([decoded.image.width, decoded.image.height]).toEqual([
      resolved.bytes.width,
      resolved.bytes.height,
    ]);
    expect(reply).toMatchObject({
      pixelKey: resolved.bytes.pixelKey,
      width: resolved.bytes.width,
      height: resolved.bytes.height,
    });
    expect(sha256Hex(png)).toBe(
      sha256Hex(firstBlob(spriteFixture("placeholder-zeus", 1))),
    );
    await r.studio.teardown();
  });

  test("a stale key is refused and the next source-keys shows the new key", async () => {
    const r = rig();
    writeDraft(r.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 1));
    r.touchDraft("zeus-take");
    const first = ok(
      await r.call("source-resolve", { source: "draft", id: "zeus-take" }),
    );
    const keysBefore = ok(await r.call("source-keys"));

    writeDraft(r.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 2));
    r.touchDraft("zeus-take");

    const stale = await r.call("source-bytes", {
      source: "draft",
      id: "zeus-take",
      v: first.bytes.pixelKey,
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "stale-version" },
    });
    expect(JSON.stringify(stale)).not.toContain("base64");
    const keysAfter = ok(await r.call("source-keys"));
    const keyOf = (keys: Obj) =>
      keys.selections.find((s: Obj) => s.id === "zeus-take")?.key;
    expect(keyOf(keysAfter)).toBeDefined();
    expect(keyOf(keysAfter)).not.toBe(keyOf(keysBefore));

    const second = ok(
      await r.call("source-resolve", { source: "draft", id: "zeus-take" }),
    );
    const fresh = ok(
      await r.call("source-bytes", {
        source: "draft",
        id: "zeus-take",
        v: second.bytes.pixelKey,
      }),
    );
    expect(sha256Hex(new Uint8Array(Buffer.from(fresh.base64, "base64")))).toBe(
      sha256Hex(firstBlob(spriteFixture("placeholder-zeus", 2))),
    );
    await r.studio.teardown();
  });

  test("a selection nothing holds is not-found, and arguments are checked", async () => {
    const r = rig();
    expect(
      await r.call("source-bytes", { source: "draft", id: "unheld", v: "k" }),
    ).toMatchObject({ ok: false, error: { code: "not-found" } });

    const bad: unknown[] = [
      { source: "draft", id: "zeus-take" },
      { source: "draft", v: "k" },
      { id: "zeus-take", v: "k" },
      { source: "draft", id: "../x", v: "k" },
      { source: "draft", id: "zeus-take", v: "k", path: "/x" },
      { source: "draft", id: "zeus-take", v: "" },
      { placeholder: "0".repeat(64), source: "draft", id: "zeus-take", v: "k" },
      { placeholder: "../secret" },
      {},
    ];
    for (const args of bad)
      expect(
        await r.call("source-bytes", args),
        JSON.stringify(args),
      ).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
    await r.studio.teardown();
  });

  test("the placeholder's bytes are served by their hash, and an unknown hash is not-found", async () => {
    const r = rig();
    const missing = ok(
      await r.call("source-resolve", { source: "draft", id: "nothing-here" }),
    );

    const reply = ok(
      await r.call("source-bytes", { placeholder: missing.bytes.pixelKey }),
    );
    const decoded = decodePng(
      new Uint8Array(Buffer.from(reply.base64, "base64")),
    );
    expect(decoded.ok).toBe(true);
    expect(
      await r.call("source-bytes", { placeholder: "0".repeat(64) }),
    ).toMatchObject({ ok: false, error: { code: "not-found" } });
    await r.studio.teardown();
  });
});

describe("a store root created after the session starts", () => {
  test("appears in source-list once it exists and the watcher reports it", async () => {
    const r = rig();
    rmSync(r.studioRoot, { recursive: true });
    const fake = fakeWatchFs((path) => existsSync(path));
    const studio = new Studio(
      r.config,
      depsFor(capture(), {
        schedule: r.clock.schedule,
        watchRoot: (root, onChange) => fsWatcher(root, onChange, fake.fs),
      }),
      "session",
    );

    const before = ok(await execute(studio, "source-list", {}));
    expect(before.entries.map((e: Obj) => e.source)).toEqual(["canon"]);
    expect(before.problems).toEqual([
      { scope: "store", message: "studio root does not exist" },
    ]);

    writeDraft(r.studioRoot, "zeus-take", spriteFixture("placeholder-zeus"));
    fake
      .open()
      .find((watch) => watch.path === r.base)
      ?.fire("studio");
    r.clock.tick();

    const after = ok(await execute(studio, "source-list", {}));
    expect(after.entries.map((e: Obj) => `${e.source}:${e.id}`)).toEqual([
      "canon:placeholder-zeus",
      "draft:zeus-take",
    ]);
    await studio.teardown();
    expect(fake.open()).toEqual([]);
  });
});

describe("configuration and lifecycle", () => {
  test("the roots are the config's studioRoot and registryRoot, and the vocabulary comes from contentRoot; each missing one is named", async () => {
    const base = rig();
    const without = (key: keyof StudioConfig) => {
      const { [key]: _gone, ...rest } = base.config;
      return new Studio(rest, depsFor(capture(), base.deps), "session");
    };
    for (const field of [
      "studioRoot",
      "registryRoot",
      "contentRoot",
    ] as const) {
      const studio = without(field);
      const outcome = await execute(studio, "source-list", {});
      expect(outcome, field).toMatchObject({
        ok: false,
        error: { code: "missing-config", field },
      });
      expect(exitOf(outcome)).toBe(64);
      await studio.teardown();
    }
    await base.studio.teardown();
  });

  test("an invalid content root is the invalid-content refusal, and a later fix is picked up", async () => {
    const r = rig();
    let broken = true;
    const studio = new Studio(
      r.config,
      depsFor(capture(), {
        ...r.deps,
        loadContent: (root) =>
          broken
            ? { ok: false, diagnostics: [{ file: "x.json", message: "bad" }] }
            : loadStudioContent(root),
      }),
      "session",
    );
    expect(await execute(studio, "source-list", {})).toMatchObject({
      ok: false,
      error: { code: "invalid-content" },
    });
    broken = false;
    expect((await execute(studio, "source-list", {})).ok).toBe(true);
    await studio.teardown();
  });

  test("the source is created once, shared by every op, and closed by teardown, which closes both watchers", async () => {
    const r = rig();
    await r.call("source-list");
    await r.call("source-keys");
    expect(r.clock.closed).toEqual([]);

    await r.studio.teardown();

    expect([...r.clock.closed].sort()).toEqual(
      [r.registryRoot, r.studioRoot].sort(),
    );
    // Reads of the last model still answer while the session winds down.
    expect((await r.call("source-list")).ok).toBe(true);
  });

  test("a session that is already stopping does not open watchers for a first source op", async () => {
    const r = rig();
    const stopping = r.studio.teardown();
    const outcome = await r.call("source-list");
    await stopping;
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "shutting-down" },
    });
    expect(r.clock.closed).toEqual([]);
  });
});

describe("over the session protocol", () => {
  test("each source op gets exactly one correlated reply, bytes come back as one base64 line, and an inherited op name is unknown", async () => {
    const r = rig();
    writeDraft(r.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 1));
    const configPath = join(r.base, "studio.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        studioRoot: r.studioRoot,
        registryRoot: r.registryRoot,
        contentRoot: REAL_CONTENT,
      }),
    );
    const stdin = pipe();
    const out: string[] = [];
    const io: Io = {
      stdin: stdin.iterable,
      stdout: (line) => out.push(line),
      stderr: () => {},
    };
    // The key the session will hold, read through a separate read-only host on the same roots.
    const resolved = ok(
      await execute(r.studio, "source-resolve", {
        source: "draft",
        id: "zeus-take",
      }),
    );
    await r.studio.teardown();

    const send = (id: string, op: string, args: unknown) =>
      stdin.send(JSON.stringify({ id, op, args }));
    send("list", "source-list", {});
    send("res", "source-resolve", { source: "draft", id: "zeus-take" });
    send("bytes", "source-bytes", {
      source: "draft",
      id: "zeus-take",
      v: resolved.bytes.pixelKey,
    });
    send("stale", "source-bytes", {
      source: "draft",
      id: "zeus-take",
      v: "old",
    });
    send("keys", "source-keys", {});
    send("bad", "source-resolve", { source: "draft", id: "../x" });
    send("proto", "__proto__", {});
    stdin.end();
    const code = await main(["session", "--config", configPath], io, r.deps);

    expect(code).toBe(0);
    const replies = parsed(out);
    expect(replies.map((x) => x.id).sort()).toEqual(
      ["bad", "bytes", "keys", "list", "proto", "res", "stale"].sort(),
    );
    const byId = (id: string) => replies.find((x) => x.id === id);
    expect(byId("list")).toMatchObject({ ok: true });
    expect(byId("bytes")).toMatchObject({
      ok: true,
      result: { base64: expect.any(String), pixelKey: resolved.bytes.pixelKey },
    });
    expect(byId("stale")).toMatchObject({
      ok: false,
      error: { code: "stale-version" },
    });
    expect(byId("bad")).toMatchObject({
      ok: false,
      error: { code: "invalid-arguments" },
    });
    expect(byId("proto")).toMatchObject({
      ok: false,
      error: { code: "unknown-op" },
    });
    expect(out.every((line) => !line.includes("\n"))).toBe(true);
  });
});
