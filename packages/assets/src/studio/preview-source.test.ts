import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spriteFixture } from "../fixtures";
import { sha256Hex } from "../hash";
import {
  fakeWatchFs,
  firstBlob,
  hiddenRgbSprite,
  manualClock,
  publishCanon,
  vocabulary,
  writeDraft,
} from "./_test-preview";
import { decodePng } from "./png/decode";
import {
  COALESCE_MS,
  createPreviewSource,
  fsWatcher,
  isPreviewSlug,
  isPreviewSourceKind,
  type PreviewChange,
  type PreviewSource,
  type PreviewSourceKind,
  parsePreviewResolve,
} from "./preview-source";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function rig(options: { storeExists?: boolean } = {}) {
  const base = mkdtempSync(join(tmpdir(), "preview-source-"));
  dirs.push(base);
  const registryRoot = join(base, "registry");
  const studioRoot = join(base, "studio");
  mkdirSync(registryRoot);
  publishCanon(registryRoot, spriteFixture("placeholder-zeus"));
  if (options.storeExists !== false) mkdirSync(studioRoot);
  const clock = manualClock();
  const events: PreviewChange[] = [];
  const source = createPreviewSource({
    registryRoot,
    studioRoot,
    vocabulary: { ok: true, vocabulary },
    watch: clock.watch,
    schedule: clock.schedule,
    emit: (change) => events.push(change),
  });
  return { base, registryRoot, studioRoot, clock, events, source };
}

const frames = (
  source: PreviewSource,
  id: string,
  kind: PreviewSourceKind = "draft",
) => {
  const resolved = source.resolve({ source: kind, id });
  if (resolved.kind !== "frames") throw new Error("expected frames");
  return resolved;
};

describe("bytes", () => {
  test("with the current key returns the atlas bytes, which decode to the validated size", () => {
    const r = rig();
    writeDraft(r.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 1));
    r.clock.touch(r.studioRoot, "assets/zeus-take.json");
    r.clock.tick();

    const resolved = frames(r.source, "zeus-take");
    const got = r.source.bytes(resolved.selection, resolved.bytes.pixelKey);

    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const decoded = decodePng(got.bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect([decoded.image.width, decoded.image.height]).toEqual([
      resolved.bytes.width,
      resolved.bytes.height,
    ]);
    expect(sha256Hex(got.bytes)).toBe(
      sha256Hex(firstBlob(spriteFixture("placeholder-zeus", 1))),
    );
  });

  test("a stale key is refused, and after a rewrite keys() shows the new key and only the new key serves", () => {
    const r = rig();
    writeDraft(r.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 1));
    r.clock.touch(r.studioRoot, "assets/zeus-take.json");
    r.clock.tick();
    const first = frames(r.source, "zeus-take");
    const keyBefore = r.source
      .keys()
      .selections.find((s) => s.id === "zeus-take");

    writeDraft(r.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 2));
    r.clock.touch(r.studioRoot, "assets/zeus-take.json");
    r.clock.tick();

    const second = frames(r.source, "zeus-take");
    expect(second.bytes.pixelKey).not.toBe(first.bytes.pixelKey);
    expect(r.source.bytes(first.selection, first.bytes.pixelKey)).toEqual({
      ok: false,
      reason: "stale",
    });
    const fresh = r.source.bytes(second.selection, second.bytes.pixelKey);
    expect(fresh.ok && sha256Hex(fresh.bytes)).toBe(
      sha256Hex(firstBlob(spriteFixture("placeholder-zeus", 2))),
    );
    const keyAfter = r.source
      .keys()
      .selections.find((s) => s.id === "zeus-take");
    expect(keyBefore).toBeDefined();
    expect(keyAfter?.key).not.toBe(keyBefore?.key);
    expect(r.events).toHaveLength(2);
  });

  test("no key, an empty key or the wrong selection's key is stale; a selection nothing holds is not found", () => {
    const r = rig();
    writeDraft(r.studioRoot, "zeus-a", spriteFixture("placeholder-zeus", 1));
    writeDraft(r.studioRoot, "zeus-b", spriteFixture("placeholder-zeus", 2));
    r.clock.touch(r.studioRoot, "assets/zeus-a.json");
    r.clock.tick();
    const a = frames(r.source, "zeus-a");
    const b = frames(r.source, "zeus-b");

    for (const version of [null, "", b.bytes.pixelKey, "x"])
      expect(r.source.bytes(a.selection, version), String(version)).toEqual({
        ok: false,
        reason: "stale",
      });
    expect(
      r.source.bytes({ source: "draft", id: "unheld-take" }, a.bytes.pixelKey),
    ).toEqual({ ok: false, reason: "not-found" });
    expect(
      r.source.bytes({ source: "approved", id: "zeus-a" }, a.bytes.pixelKey),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  test("an RGB-only re-export keeps the pixel key, so the key the caller holds still serves", () => {
    const r = rig();
    publishCanon(r.registryRoot, hiddenRgbSprite(10, 1));
    r.clock.touch(r.registryRoot, "index.json");
    r.clock.tick();
    const held = frames(r.source, "placeholder-zeus", "canon");
    r.events.length = 0;

    publishCanon(r.registryRoot, hiddenRgbSprite(10, 200));
    r.clock.touch(r.registryRoot, "index.json");
    r.clock.tick();

    expect(r.events).toEqual([]);
    expect(r.source.bytes(held.selection, held.bytes.pixelKey).ok).toBe(true);
  });

  test("the placeholder serves its own bytes under its own hash and nothing else", () => {
    const r = rig();
    const missing = r.source.resolve({ source: "draft", id: "nothing-here" });
    expect(missing.kind).toBe("placeholder");
    if (missing.kind !== "placeholder") return;

    const bytes = r.source.placeholder(missing.bytes.pixelKey);
    expect(bytes).toBeDefined();
    expect(bytes && decodePng(bytes).ok).toBe(true);
    expect(r.source.placeholder("0".repeat(64))).toBeUndefined();
    expect(r.source.placeholder("../secret")).toBeUndefined();
  });
});

describe("keys", () => {
  test("name every held or refused selection, and the listing key moves with the listing", () => {
    const r = rig();
    const empty = r.source.keys();
    expect(empty.selections.map((s) => `${s.source}:${s.id}`)).toEqual([
      "canon:placeholder-zeus",
    ]);

    writeDraft(r.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 1));
    r.clock.touch(r.studioRoot, "assets/zeus-take.json");
    r.clock.tick();
    const withDraft = r.source.keys();
    expect(withDraft.selections.map((s) => `${s.source}:${s.id}`)).toEqual([
      "canon:placeholder-zeus",
      "draft:zeus-take",
    ]);
    expect(withDraft.listing).not.toBe(empty.listing);
    expect(withDraft.selections[0]?.key).toBe(empty.selections[0]?.key);

    const base = spriteFixture("placeholder-zeus");
    writeDraft(r.studioRoot, "zeus-wide", {
      manifest: {
        ...base.manifest,
        atlas: { ...base.manifest.atlas, width: 512 },
      },
      blobs: base.blobs,
    });
    r.clock.touch(r.studioRoot, "assets/zeus-wide.json");
    r.clock.tick();
    const refused = r.source
      .keys()
      .selections.find((s) => s.id === "zeus-wide");
    expect(refused).toBeDefined();
    expect(r.source.list().entries.find((e) => e.id === "zeus-wide")?.ok).toBe(
      false,
    );
  });

  test("do not move when nothing visible changed", () => {
    const r = rig();
    const before = r.source.keys();
    r.clock.touch(r.studioRoot, "session.lock");
    r.clock.touch(r.studioRoot, "jobs/job-1.json");
    expect(r.clock.pending()).toBe(0);
    r.clock.touch(r.registryRoot, "index.json");
    r.clock.tick();
    expect(r.source.keys()).toEqual(before);
    expect(r.events).toEqual([]);
  });
});

describe("a store root that does not exist yet", () => {
  test("appears in the listing once it is created and the watcher reports it", () => {
    const base = mkdtempSync(join(tmpdir(), "preview-source-"));
    dirs.push(base);
    const registryRoot = join(base, "registry");
    const studioRoot = join(base, "studio");
    mkdirSync(registryRoot);
    publishCanon(registryRoot, spriteFixture("placeholder-zeus"));
    const fake = fakeWatchFs((path) => existsSync(path));
    const clock = manualClock();
    const events: PreviewChange[] = [];
    const source = createPreviewSource({
      registryRoot,
      studioRoot,
      vocabulary: { ok: true, vocabulary },
      watch: (root, onChange) => fsWatcher(root, onChange, fake.fs),
      schedule: clock.schedule,
      emit: (change) => events.push(change),
    });
    expect(source.list().entries.map((e) => e.source)).toEqual(["canon"]);
    expect(source.list().problems.map((p) => p.message)).toContain(
      "studio root does not exist",
    );

    writeDraft(studioRoot, "zeus-take", spriteFixture("placeholder-zeus"));
    fake
      .open()
      .find((watch) => watch.path === base)
      ?.fire("studio");
    expect(clock.pending()).toBe(1);
    clock.tick();

    expect(source.list().entries.map((e) => `${e.source}:${e.id}`)).toEqual([
      "canon:placeholder-zeus",
      "draft:zeus-take",
    ]);
    expect(events).toEqual([
      { changed: [{ source: "draft", id: "zeus-take" }], listing: true },
    ]);
    source.close();
    expect(fake.open()).toEqual([]);
  });
});

describe("the scheduler and close", () => {
  test("the coalescing window is the module constant, handed to the scheduler", () => {
    const delays: number[] = [];
    const base = mkdtempSync(join(tmpdir(), "preview-source-"));
    dirs.push(base);
    const touch: { fire?: (relative: string) => void } = {};
    createPreviewSource({
      registryRoot: join(base, "registry"),
      studioRoot: join(base, "studio"),
      vocabulary: { ok: true, vocabulary },
      watch: (_root, onChange) => {
        touch.fire = onChange;
        return () => {};
      },
      schedule: (_run, delay) => {
        delays.push(delay);
        return () => {};
      },
    });
    touch.fire?.("assets/zeus-take.json");
    expect(delays).toEqual([COALESCE_MS]);
  });

  test("close closes both watchers, cancels the pending refresh and silences later events", () => {
    const r = rig();
    r.clock.touch(r.registryRoot, "index.json");
    expect(r.clock.pending()).toBe(1);

    r.source.close();
    r.source.close();

    expect(r.clock.pending()).toBe(0);
    expect([...r.clock.closed].sort()).toEqual(
      [r.registryRoot, r.studioRoot].sort(),
    );
    r.clock.touch(r.registryRoot, "index.json");
    expect(r.clock.pending()).toBe(0);
  });

  test("a vocabulary that failed to load gives one problem and placeholders", () => {
    const base = mkdtempSync(join(tmpdir(), "preview-source-"));
    dirs.push(base);
    const clock = manualClock();
    const source = createPreviewSource({
      registryRoot: join(base, "registry"),
      studioRoot: join(base, "studio"),
      vocabulary: { ok: false, message: "assets/vocabulary.json: is missing" },
      watch: clock.watch,
      schedule: clock.schedule,
    });
    expect(source.list()).toEqual({
      entries: [],
      problems: [
        { scope: "content", message: "assets/vocabulary.json: is missing" },
      ],
    });
    expect(source.resolve({ source: "canon", id: "zeus-portrait" }).kind).toBe(
      "placeholder",
    );
  });
});

describe("parsePreviewResolve", () => {
  test("accepts a source and id with optional slugs", () => {
    expect(
      parsePreviewResolve({
        source: "draft",
        id: "zeus-take",
        state: "idle",
        direction: "south",
      }),
    ).toEqual({
      source: "draft",
      id: "zeus-take",
      state: "idle",
      direction: "south",
    });
  });

  test.each([
    ["an unknown field", { source: "canon", id: "zeus-portrait", path: "/x" }],
    ["an unknown source", { source: "registry", id: "zeus-portrait" }],
    ["a path-like id", { source: "draft", id: "../canary/secret" }],
    ["an empty id", { source: "canon", id: "" }],
    ["a long id", { source: "canon", id: "a".repeat(200) }],
    ["a non-string id", { source: "canon", id: 7 }],
    [
      "a malformed state",
      { source: "canon", id: "zeus-portrait", state: "../x" },
    ],
  ])("refuses %s with a message", (_name, input) => {
    expect(typeof parsePreviewResolve(input)).toBe("string");
  });

  test("an inherited name is not a field and is not read as one", () => {
    expect(
      typeof parsePreviewResolve(
        JSON.parse('{"__proto__":1,"source":"canon","id":"a"}'),
      ),
    ).toBe("string");
    expect(isPreviewSlug("to-string")).toBe(true);
    expect(isPreviewSlug("toString")).toBe(false);
    expect(isPreviewSourceKind("toString")).toBe(false);
    expect(isPreviewSourceKind("constructor")).toBe(false);
  });
});
