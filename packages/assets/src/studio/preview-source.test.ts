import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portraitFixture, spriteFixture } from "../fixtures";
import { sha256Hex } from "../hash";
import { encodeRgbaPng } from "../placeholder";
import {
  fakeWatchFs,
  firstBlob,
  hiddenRgbSprite,
  manualClock,
  publishCanon,
  variantSprite,
  vocabulary,
  withManifest,
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
  test("lists every animation key and portrait expression for canon, draft, and approved records", () => {
    const r = rig();
    const sprite = spriteFixture("zeus-sprite");
    const idleFrames = sprite.manifest.animations[0]?.frames;
    if (idleFrames === undefined)
      throw new Error("sprite fixture has no frames");
    const actDurations = [83, 100, 83, 83, 100];
    const zeus = withManifest(sprite, {
      animations: [
        { state: "idle", direction: "south", frames: idleFrames },
        {
          state: "seated",
          direction: "south",
          frames: idleFrames.slice(0, 2),
        },
        {
          state: "act",
          direction: "south",
          ability: "thunderbolt",
          loopStart: 2,
          frames: actDurations.map((durationMs, index) => {
            const sourceFrame = idleFrames[index % idleFrames.length];
            if (sourceFrame === undefined)
              throw new Error("sprite fixture has no source frame");
            return { ...sourceFrame, durationMs };
          }),
        },
      ],
    });
    const portrait = portraitFixture("zeus-portrait");
    const portraitFrames = portrait.manifest.expressions.map(
      (item) => item.frame,
    );
    const expressions = [
      "neutral",
      "pleased",
      "angry",
      "grieving",
      "scheming",
      "awed",
    ];
    const zeusPortrait = withManifest(portrait, {
      expressions: expressions.map((expression, index) => ({
        expression,
        frame: portraitFrames[index % portraitFrames.length],
      })),
    });

    publishCanon(r.registryRoot, zeus);
    publishCanon(r.registryRoot, zeusPortrait);
    for (const state of ["draft", "approved"] as const) {
      writeDraft(r.studioRoot, `zeus-sprite-${state}`, zeus, state);
      writeDraft(r.studioRoot, `zeus-portrait-${state}`, zeusPortrait, state);
    }
    r.clock.touch(r.registryRoot, "index.json");
    r.clock.touch(r.studioRoot, "assets/zeus-sprite-draft.json");
    r.clock.tick();

    const listing = r.source.list();
    const spriteKeys = [
      { state: "idle", direction: "south" },
      { state: "seated", direction: "south" },
      { state: "act", direction: "south", ability: "thunderbolt" },
    ];
    for (const source of ["canon", "draft", "approved"] as const) {
      const spriteEntry = listing.entries.find(
        (entry) => entry.source === source && entry.assetId === "zeus-sprite",
      );
      const portraitEntry = listing.entries.find(
        (entry) => entry.source === source && entry.assetId === "zeus-portrait",
      );
      expect(spriteEntry?.animations).toEqual(spriteKeys);
      expect(portraitEntry?.expressions).toEqual(expressions);
    }
  });

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

describe("a realm variant is a selection of its own", () => {
  const draftRig = () => {
    const r = rig();
    const v = variantSprite("placeholder-zeus", 3);
    writeDraft(r.studioRoot, "zeus-take", v.asset);
    r.clock.touch(r.studioRoot, "assets/zeus-take.json");
    r.clock.tick();
    return { r, v };
  };

  test("a draft's realm request resolves the variant atlas and serves the variant's bytes, not the base's", () => {
    const { r, v } = draftRig();

    const base = r.source.resolve({ source: "draft", id: "zeus-take" });
    const variant = r.source.resolve({
      source: "draft",
      id: "zeus-take",
      realm: "underworld",
    });

    expect(base.kind).toBe("frames");
    expect(variant.kind).toBe("frames");
    if (base.kind !== "frames" || variant.kind !== "frames") return;
    expect(variant.selection).toEqual({
      source: "draft",
      id: "zeus-take",
      realm: "underworld",
    });
    expect(variant.bytes.pixelKey).not.toBe(base.bytes.pixelKey);
    const got = r.source.bytes(variant.selection, variant.bytes.pixelKey);
    expect(got.ok && sha256Hex(got.bytes)).toBe(v.variantHash);
    const own = r.source.bytes(base.selection, base.bytes.pixelKey);
    expect(own.ok && sha256Hex(own.bytes)).toBe(sha256Hex(v.baseBytes));
    // The key of one never serves the other.
    expect(r.source.bytes(variant.selection, base.bytes.pixelKey)).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  test("a canon revision's variant is served the same way, from the registry's own blob", () => {
    const r = rig();
    const v = variantSprite("placeholder-hera", 4);
    publishCanon(r.registryRoot, v.asset);
    r.clock.touch(r.registryRoot, "index.json");
    r.clock.tick();

    const variant = r.source.resolve({
      source: "canon",
      id: "placeholder-hera",
      realm: "underworld",
    });

    expect(variant.kind).toBe("frames");
    if (variant.kind !== "frames") return;
    const got = r.source.bytes(variant.selection, variant.bytes.pixelKey);
    expect(got.ok && sha256Hex(got.bytes)).toBe(v.variantHash);
  });

  test("a realm the asset does not publish is the not-in-this-asset outcome, and no bytes are held for it", () => {
    const { r } = draftRig();

    const unknown = r.source.resolve({
      source: "draft",
      id: "zeus-take",
      realm: "town",
    });
    const missingState = r.source.resolve({
      source: "draft",
      id: "zeus-take",
      state: "walk",
    });

    expect(unknown.kind).toBe("placeholder");
    if (unknown.kind !== "placeholder" || missingState.kind !== "placeholder")
      return;
    expect(unknown.reason).toBe(missingState.reason);
    expect(
      r.source.bytes({ source: "draft", id: "zeus-take", realm: "town" }, "x"),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  test("the listing names each entry's realms, and keys() follows a variant's own pixels", () => {
    const { r, v } = draftRig();
    const entry = r.source
      .list()
      .entries.find((e) => e.id === "zeus-take" && e.source === "draft");
    expect(entry?.realms).toEqual(["underworld"]);
    const plain = r.source.list().entries.find((e) => e.source === "canon");
    expect(plain?.realms).toEqual([]);
    const before = r.source
      .keys()
      .selections.find((s) => s.id === "zeus-take" && s.realm === "underworld");
    expect(before).toBeDefined();

    // The variant is regenerated with different pixels; the base is untouched.
    const rgba = new Uint8Array(256 * 80 * 4);
    for (let at = 0; at < rgba.length; at += 4)
      rgba.set([200, 12, 90, 255], at);
    const bytes = encodeRgbaPng(rgba, 256, 80);
    const hash = sha256Hex(bytes);
    const next = withManifest(v.asset, {
      realmVariants: [
        {
          ...(v.asset.manifest as unknown as { realmVariants: object[] })
            .realmVariants[0],
          atlas: { blob: hash, width: 256, height: 80 },
        },
      ],
    });
    writeDraft(r.studioRoot, "zeus-take", {
      manifest: next.manifest,
      blobs: new Map([...v.asset.blobs, [hash, bytes]]),
    });
    r.clock.touch(r.studioRoot, "assets/zeus-take.json");
    r.clock.tick();

    const after = r.source
      .keys()
      .selections.find((s) => s.id === "zeus-take" && s.realm === "underworld");
    expect(after?.key).not.toBe(before?.key);
    expect(
      r.events.some((e) =>
        e.changed.some((c) => c.id === "zeus-take" && c.realm === "underworld"),
      ),
    ).toBe(true);
  });

  test("a variant whose blob is missing is refused with a problem and resolves as not in this asset; the base still serves", () => {
    const r = rig();
    const v = variantSprite("placeholder-zeus", 5);
    writeDraft(r.studioRoot, "zeus-take", {
      manifest: v.asset.manifest,
      blobs: new Map([...v.asset.blobs].filter(([h]) => h !== v.variantHash)),
    });
    r.clock.touch(r.studioRoot, "assets/zeus-take.json");
    r.clock.tick();

    const variant = r.source.resolve({
      source: "draft",
      id: "zeus-take",
      realm: "underworld",
    });

    expect(variant.kind).toBe("placeholder");
    expect(r.source.resolve({ source: "draft", id: "zeus-take" }).kind).toBe(
      "frames",
    );
    expect(
      r.source.list().problems.some((p) => p.message.includes("realm variant")),
    ).toBe(true);
  });
});

describe("parsePreviewResolve and a realm", () => {
  test("accepts a realm slug, and refuses a malformed one", () => {
    expect(
      parsePreviewResolve({
        source: "draft",
        id: "zeus-take",
        realm: "underworld",
      }),
    ).toEqual({ source: "draft", id: "zeus-take", realm: "underworld" });
    expect(
      typeof parsePreviewResolve({
        source: "draft",
        id: "zeus-take",
        realm: "../x",
      }),
    ).toBe("string");
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
