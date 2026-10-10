import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "@panthea/assets";
import { portraitFixture, spriteFixture } from "@panthea/assets/fixtures";
import { isPreviewSlug, PREVIEW_SOURCE_KINDS } from "@panthea/assets/studio";
import {
  emptyWorld,
  fakeWatchFs,
  firstBlob,
  getJson,
  hiddenRgbSprite,
  publishCanon,
  type Rig,
  removeTempRoots,
  rig,
  vocabulary,
  withManifest,
  world,
  writeDraft,
} from "./_testkit";
import { COALESCE_MS, fsWatcher } from "./dev-bridge";
import {
  type AtlasBytes,
  BRIDGE_PREFIX,
  bridgePaths,
  isSlug,
  isSourceKind,
  type Listing,
  type ResolveRequest,
  SOURCE_KINDS,
  type SourceResolution,
} from "./port";

afterEach(removeTempRoots);

const resolveUrl = (request: ResolveRequest) => {
  const query = new URLSearchParams(
    Object.entries(request).filter(([, v]) => v !== undefined) as [
      string,
      string,
    ][],
  );
  return `${bridgePaths.resolve}?${query}`;
};

const resolve = (r: Rig, request: ResolveRequest) =>
  getJson<SourceResolution>(r.bridge.handle("GET", resolveUrl(request)));

const listing = (r: Rig) =>
  getJson<Listing>(r.bridge.handle("GET", bridgePaths.listing));

const atlasBytes = (r: Rig, bytes: AtlasBytes) => {
  const response = r.bridge.handle("GET", bytes.url);
  return { status: response.status, body: response.body, response };
};

describe("canon", () => {
  test("zeus-portrait from a copy of the committed registry resolves to its manifest and atlas", () => {
    const w = world();
    const r = rig(w);

    const resolved = resolve(r, {
      source: "canon",
      id: "zeus-portrait",
      expression: "neutral",
    });

    expect(resolved.kind).toBe("frames");
    if (resolved.kind !== "frames") return;
    expect<string>(resolved.asset.assetId).toBe("zeus-portrait");
    expect(resolved.asset.kind).toBe("portrait");
    expect(resolved.asset.frames).toHaveLength(1);
    expect(resolved.bytes.width).toBe(resolved.asset.atlas.width);
    expect(resolved.bytes.height).toBe(resolved.asset.atlas.height);

    const fetched = atlasBytes(r, resolved.bytes);
    expect(fetched.status).toBe(200);
    expect(fetched.response.headers["content-type"]).toBe("image/png");
    const blob = readFileSync(
      join(w.registryRoot, "blobs", `${resolved.asset.atlas.blob}.png`),
    );
    expect(sha256Hex(fetched.body as Uint8Array)).toBe(
      sha256Hex(new Uint8Array(blob)),
    );
  });

  test("a canon id the registry does not hold resolves to the placeholder with missing-id", () => {
    const r = rig(world());
    const resolved = resolve(r, { source: "canon", id: "zeus-idle" });
    expect(resolved).toMatchObject({
      kind: "placeholder",
      reason: "missing-id",
    });
    if (resolved.kind !== "placeholder") return;
    const fetched = atlasBytes(r, resolved.bytes);
    expect(fetched.status).toBe(200);
    expect(fetched.response.headers["content-type"]).toBe("image/png");
    expect(resolved.uri).toMatch(/^panthea-asset:\/\/placeholder\//);
  });
});

describe("one source per selection", () => {
  test("a packed draft resolves under draft by record id, and its asset id under canon resolves only from the registry", () => {
    const w = world();
    writeDraft(w.studioRoot, "zeus-take-1", spriteFixture("placeholder-zeus"));
    const r = rig(w);

    const draft = resolve(r, { source: "draft", id: "zeus-take-1" });
    expect(draft).toMatchObject({
      kind: "frames",
      selection: { source: "draft", id: "zeus-take-1" },
      asset: { assetId: "placeholder-zeus", kind: "sprite" },
    });
    if (draft.kind !== "frames") return;
    expect(atlasBytes(r, draft.bytes).status).toBe(200);

    expect(
      resolve(r, { source: "canon", id: "placeholder-zeus" }),
    ).toMatchObject({ kind: "placeholder", reason: "missing-id" });
    expect(
      resolve(r, { source: "draft", id: "placeholder-zeus" }),
    ).toMatchObject({ kind: "placeholder", reason: "missing-id" });
    expect(resolve(r, { source: "approved", id: "zeus-take-1" })).toMatchObject(
      { kind: "placeholder", reason: "missing-id" },
    );
  });

  test("an approved record resolves under approved, not under draft", () => {
    const w = world();
    writeDraft(
      w.studioRoot,
      "zeus-final",
      spriteFixture("placeholder-zeus"),
      "approved",
    );
    const r = rig(w);
    expect(resolve(r, { source: "approved", id: "zeus-final" }).kind).toBe(
      "frames",
    );
    expect(resolve(r, { source: "draft", id: "zeus-final" }).kind).toBe(
      "placeholder",
    );
  });

  test("the listing shows two draft records for one asset id as two selections, each with its record id and state", () => {
    const w = world();
    writeDraft(
      w.studioRoot,
      "zeus-take-2",
      spriteFixture("placeholder-zeus", 2),
    );
    writeDraft(
      w.studioRoot,
      "zeus-take-1",
      spriteFixture("placeholder-zeus", 1),
    );
    writeDraft(
      w.studioRoot,
      "zeus-final",
      spriteFixture("placeholder-zeus", 3),
      "approved",
    );
    const r = rig(w);

    expect(listing(r)).toEqual({
      entries: [
        {
          source: "canon",
          id: "zeus-portrait",
          assetId: "zeus-portrait",
          kind: "portrait",
          state: "canon",
          ok: true,
        },
        {
          source: "draft",
          id: "zeus-take-1",
          assetId: "placeholder-zeus",
          kind: "sprite",
          state: "draft",
          ok: true,
        },
        {
          source: "draft",
          id: "zeus-take-2",
          assetId: "placeholder-zeus",
          kind: "sprite",
          state: "draft",
          ok: true,
        },
        {
          source: "approved",
          id: "zeus-final",
          assetId: "placeholder-zeus",
          kind: "sprite",
          state: "approved",
          ok: true,
        },
      ],
      problems: [],
    });
  });

  test("a missing state returns the placeholder with missing-state and never the other source's frames", () => {
    const w = world();
    publishCanon(w.registryRoot, spriteFixture("placeholder-zeus"));
    writeDraft(
      w.studioRoot,
      "zeus-east",
      withManifest(spriteFixture("placeholder-zeus"), {
        directions: ["east"],
        animations: spriteFixture("placeholder-zeus").manifest.animations.map(
          (animation) => ({ ...animation, direction: "east" }),
        ),
      }),
    );
    const r = rig(w);

    expect(resolve(r, { source: "canon", id: "placeholder-zeus" }).kind).toBe(
      "frames",
    );

    const draft = resolve(r, { source: "draft", id: "zeus-east" });
    expect(draft).toMatchObject({
      kind: "placeholder",
      reason: "missing-state",
    });
    expect(draft).not.toHaveProperty("asset");
    expect(
      resolve(r, { source: "draft", id: "zeus-east", direction: "east" }).kind,
    ).toBe("frames");
  });
});

describe("validation before anything reaches the browser", () => {
  test("an intact PNG whose size is not its manifest's atlas size gives the placeholder and a problem", () => {
    const w = world();
    const base = spriteFixture("placeholder-zeus");
    const resized = withManifest(base, {
      atlas: { ...base.manifest.atlas, width: 512 },
    });
    writeDraft(w.studioRoot, "zeus-wide", resized);
    const r = rig(w);

    const resolved = resolve(r, { source: "draft", id: "zeus-wide" });
    expect(resolved).toMatchObject({
      kind: "placeholder",
      reason: "missing-id",
    });
    if (resolved.kind !== "placeholder") return;
    expect(resolved.problems).toHaveLength(1);
    expect(resolved.problems[0]).toMatchObject({ scope: "draft:zeus-wide" });
    expect(resolved.problems[0]?.message).toContain("declares 512x80");
    expect(listing(r).entries.find((e) => e.id === "zeus-wide")?.ok).toBe(
      false,
    );
    expect(
      r.bridge.handle(
        "GET",
        bridgePaths.atlas({ source: "draft", id: "zeus-wide" }, "x"),
      ).status,
    ).toBe(404);
  });

  test("a truncated atlas whose recorded hash matches still fails the blob gate", () => {
    const w = world();
    const base = spriteFixture("placeholder-zeus");
    const cut = firstBlob(base).slice(0, 29);
    const hash = sha256Hex(cut);
    writeDraft(w.studioRoot, "zeus-cut", {
      manifest: {
        ...base.manifest,
        atlas: { ...base.manifest.atlas, blob: hash },
      },
      blobs: new Map([[hash, cut]]),
    });
    const r = rig(w);

    const resolved = resolve(r, { source: "draft", id: "zeus-cut" });
    expect(resolved.kind).toBe("placeholder");
    if (resolved.kind !== "placeholder") return;
    expect(resolved.problems[0]?.message).toContain("not a valid PNG");
  });

  test("a record whose blob is not in the store gives the placeholder and a problem", () => {
    const w = world();
    writeDraft(w.studioRoot, "zeus-lost", spriteFixture("placeholder-zeus"));
    rmSync(join(w.studioRoot, "blobs"), { recursive: true });
    const r = rig(w);

    const resolved = resolve(r, { source: "draft", id: "zeus-lost" });
    expect(resolved.kind).toBe("placeholder");
    if (resolved.kind !== "placeholder") return;
    expect(resolved.problems[0]?.message).toContain("missing");
  });

  test("a manifest the contract parser refuses gives the placeholder and a problem", () => {
    const w = world();
    const base = spriteFixture("placeholder-zeus");
    writeDraft(w.studioRoot, "zeus-bad", {
      manifest: { ...base.manifest, pivot: { x: 500, y: 500 } },
      blobs: base.blobs,
    });
    const r = rig(w);

    const resolved = resolve(r, { source: "draft", id: "zeus-bad" });
    expect(resolved.kind).toBe("placeholder");
    if (resolved.kind !== "placeholder") return;
    expect(resolved.problems).toHaveLength(1);
  });

  test("a malformed store record is reported without hiding its neighbours", () => {
    const w = world();
    writeDraft(w.studioRoot, "zeus-ok", spriteFixture("placeholder-zeus"));
    writeFileSync(join(w.studioRoot, "assets", "broken.json"), "{ not json");
    const r = rig(w);

    expect(resolve(r, { source: "draft", id: "zeus-ok" }).kind).toBe("frames");
    expect(listing(r).problems).toEqual([
      expect.objectContaining({ scope: "store:assets/broken.json" }),
    ]);
  });

  test("missing registry and store roots give placeholders and problems, not a throw", () => {
    const r = rig(emptyWorld());

    const current = listing(r);
    expect(current.entries).toEqual([]);
    expect(current.problems.map((p) => p.scope).sort()).toEqual([
      "canon:index.json",
      "store",
    ]);
    expect(resolve(r, { source: "canon", id: "zeus-portrait" })).toMatchObject({
      kind: "placeholder",
      reason: "missing-id",
    });
    expect(resolve(r, { source: "draft", id: "anything" })).toMatchObject({
      kind: "placeholder",
      reason: "missing-id",
    });
  });

  test("a vocabulary that failed to load gives placeholders and one problem", () => {
    const w = world();
    const r = rig(w, {
      vocabulary: { ok: false, message: "assets/vocabulary.json: is missing" },
    });
    expect(listing(r)).toEqual({
      entries: [],
      problems: [
        { scope: "content", message: "assets/vocabulary.json: is missing" },
      ],
    });
    expect(resolve(r, { source: "canon", id: "zeus-portrait" }).kind).toBe(
      "placeholder",
    );
  });
});

describe("atlas URLs are pinned to the pixel key they were resolved with", () => {
  const selection = { source: "draft", id: "zeus-take" } as const;

  test("after a pixel change the old URL is 404, the new URL serves the new bytes, and a URL with no key is 404", () => {
    const w = world();
    writeDraft(w.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 1));
    const r = rig(w);
    const first = resolve(r, selection);
    if (first.kind !== "frames") throw new Error("expected frames");
    expect(atlasBytes(r, first.bytes).status).toBe(200);

    writeDraft(w.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 2));
    r.watchers[1]?.touch("assets/zeus-take.json");
    r.tick();

    const second = resolve(r, selection);
    if (second.kind !== "frames") throw new Error("expected frames");
    expect(second.bytes.pixelKey).not.toBe(first.bytes.pixelKey);

    const stale = atlasBytes(r, first.bytes);
    expect(stale.status).toBe(404);
    expect(String(stale.body)).not.toContain("PNG");

    const fresh = atlasBytes(r, second.bytes);
    expect(fresh.status).toBe(200);
    expect(sha256Hex(fresh.body as Uint8Array)).toBe(
      sha256Hex(firstBlob(spriteFixture("placeholder-zeus", 2))),
    );

    const bare = `${BRIDGE_PREFIX}/atlas/draft/zeus-take`;
    expect(r.bridge.handle("GET", bare).status).toBe(404);
    expect(r.bridge.handle("GET", `${bare}?v=`).status).toBe(404);
    expect(
      r.bridge.handle("GET", `${bare}?x=${second.bytes.pixelKey}`).status,
    ).toBe(404);
  });

  test("an RGB-only re-export keeps the pixel key, so the URL the browser holds still serves", () => {
    const w = world();
    publishCanon(w.registryRoot, hiddenRgbSprite(10, 1));
    const r = rig(w);
    const held = resolve(r, { source: "canon", id: "placeholder-zeus" });
    if (held.kind !== "frames") throw new Error("expected frames");

    publishCanon(w.registryRoot, hiddenRgbSprite(10, 200));
    r.watchers[0]?.touch("index.json");
    r.tick();

    expect(r.events).toEqual([]);
    expect(atlasBytes(r, held.bytes).status).toBe(200);
  });
});

describe("change events", () => {
  test("five writes inside the window produce one event and the final bytes win", () => {
    const w = world();
    writeDraft(w.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 1));
    const r = rig(w);
    const store = r.watchers[1];

    for (const tag of [2, 3, 4, 5, 6]) {
      writeDraft(
        w.studioRoot,
        "zeus-take",
        spriteFixture("placeholder-zeus", tag),
      );
      store?.touch("assets/zeus-take.json");
    }

    expect(r.pending()).toBe(1);
    expect(r.events).toEqual([]);
    r.tick();

    expect(r.events).toEqual([
      { changed: [{ source: "draft", id: "zeus-take" }], listing: false },
    ]);
    const resolved = resolve(r, { source: "draft", id: "zeus-take" });
    if (resolved.kind !== "frames") throw new Error("expected frames");
    const fetched = atlasBytes(r, resolved.bytes);
    expect(sha256Hex(fetched.body as Uint8Array)).toBe(
      sha256Hex(firstBlob(spriteFixture("placeholder-zeus", 6))),
    );
    expect(r.pending()).toBe(0);
  });

  test("the coalescing window is a module constant handed to the scheduler", () => {
    const delays: number[] = [];
    const w = world();
    const r = rig(w, {
      schedule: (_run, delay) => {
        delays.push(delay);
        return () => {};
      },
    });
    r.watchers[0]?.touch("index.json");
    expect(delays).toEqual([COALESCE_MS]);
  });

  test("a re-export that changes only RGB under alpha 0 emits nothing, while a visible change emits", () => {
    const w = world();
    publishCanon(w.registryRoot, hiddenRgbSprite(10, 1));
    const r = rig(w);
    const registry = r.watchers[0];

    publishCanon(w.registryRoot, hiddenRgbSprite(10, 200));
    registry?.touch("index.json");
    expect(r.pending()).toBe(1);
    r.tick();
    expect(r.events).toEqual([]);

    publishCanon(w.registryRoot, hiddenRgbSprite(77, 200));
    registry?.touch("index.json");
    r.tick();
    expect(r.events).toEqual([
      {
        changed: [{ source: "canon", id: "placeholder-zeus" }],
        listing: false,
      },
    ]);
  });

  test("publishing while selected emits one change for the canon selection and none for the draft", () => {
    const w = world();
    writeDraft(w.studioRoot, "zeus-take", spriteFixture("placeholder-zeus"));
    const r = rig(w);
    const before = resolve(r, { source: "draft", id: "zeus-take" });

    publishCanon(w.registryRoot, spriteFixture("placeholder-zeus"));
    r.watchers[0]?.touch("index.json");
    r.tick();

    expect(r.events).toEqual([
      {
        changed: [{ source: "canon", id: "placeholder-zeus" }],
        listing: true,
      },
    ]);
    expect(resolve(r, { source: "canon", id: "placeholder-zeus" }).kind).toBe(
      "frames",
    );
    expect(resolve(r, { source: "draft", id: "zeus-take" })).toEqual(before);
  });

  test("deleting a record emits a change that resolves to the placeholder", () => {
    const w = world();
    writeDraft(w.studioRoot, "zeus-take", spriteFixture("placeholder-zeus"));
    const r = rig(w);
    expect(resolve(r, { source: "draft", id: "zeus-take" }).kind).toBe(
      "frames",
    );

    rmSync(join(w.studioRoot, "assets", "zeus-take.json"));
    r.watchers[1]?.touch("assets/zeus-take.json");
    r.tick();

    expect(r.events).toEqual([
      { changed: [{ source: "draft", id: "zeus-take" }], listing: true },
    ]);
    expect(resolve(r, { source: "draft", id: "zeus-take" })).toMatchObject({
      kind: "placeholder",
      reason: "missing-id",
    });
    expect(
      r.bridge.handle(
        "GET",
        bridgePaths.atlas({ source: "draft", id: "zeus-take" }, "x"),
      ).status,
    ).toBe(404);
  });

  test("removing a canon entry from the index emits a change that resolves to the placeholder", () => {
    const w = world();
    const r = rig(w);
    writeFileSync(
      join(w.registryRoot, "index.json"),
      `${JSON.stringify({ schemaVersion: 1, entries: [] })}\n`,
    );
    r.watchers[0]?.touch("index.json");
    r.tick();

    expect(r.events).toEqual([
      { changed: [{ source: "canon", id: "zeus-portrait" }], listing: true },
    ]);
    expect(
      resolve(r, {
        source: "canon",
        id: "zeus-portrait",
        expression: "neutral",
      }).kind,
    ).toBe("placeholder");
  });

  test("a record that becomes invalid emits a change that resolves to the placeholder with its problem", () => {
    const w = world();
    writeDraft(w.studioRoot, "zeus-take", spriteFixture("placeholder-zeus"));
    const r = rig(w);

    const base = spriteFixture("placeholder-zeus");
    const cut = firstBlob(base).slice(0, 29);
    const hash = sha256Hex(cut);
    writeDraft(w.studioRoot, "zeus-take", {
      manifest: {
        ...base.manifest,
        atlas: { ...base.manifest.atlas, blob: hash },
      },
      blobs: new Map([[hash, cut]]),
    });
    r.watchers[1]?.touch("assets/zeus-take.json");
    r.tick();

    expect(r.events).toHaveLength(1);
    expect(r.events[0]?.changed).toEqual([
      { source: "draft", id: "zeus-take" },
    ]);
    expect(resolve(r, { source: "draft", id: "zeus-take" }).kind).toBe(
      "placeholder",
    );
  });

  test("writes the studio does not read, such as the session lock, schedule nothing", () => {
    const r = rig(world());
    const store = r.watchers[1];
    store?.touch("session.lock");
    store?.touch("session.lock-journal");
    store?.touch("jobs/job-1.json");
    expect(r.pending()).toBe(0);
    store?.touch("blobs/abc.png");
    expect(r.pending()).toBe(1);
  });

  test("close stops the watchers, cancels the pending timer and silences later events", () => {
    const w = world();
    const r = rig(w);
    r.watchers[0]?.touch("index.json");
    expect(r.pending()).toBe(1);

    r.bridge.close();

    expect(r.pending()).toBe(0);
    expect([...r.closed].sort()).toEqual([w.registryRoot, w.studioRoot].sort());
    r.watchers[0]?.touch("index.json");
    expect(r.pending()).toBe(0);
    expect(r.events).toEqual([]);
  });
});

describe("read-only endpoints", () => {
  test.each([
    ["a path-like id", { source: "draft", id: "../canary/secret" }],
    ["an encoded traversal", { source: "draft", id: "..%2fcanary%2fsecret" }],
    ["an absolute path", { source: "canon", id: "/etc/passwd" }],
    ["uppercase", { source: "canon", id: "Zeus-Portrait" }],
    ["an empty id", { source: "canon", id: "" }],
    ["a long id", { source: "canon", id: "a".repeat(200) }],
    ["an unknown source", { source: "registry", id: "zeus-portrait" }],
    [
      "a malformed state",
      { source: "canon", id: "zeus-portrait", state: "../x" },
    ],
  ])("resolve refuses %s with 400", (_name, params) => {
    const w = world();
    mkdirSync(join(w.base, "canary"));
    writeFileSync(join(w.base, "canary", "secret"), "canary-contents");
    const r = rig(w);
    const response = r.bridge.handle(
      "GET",
      `${BRIDGE_PREFIX}/resolve?${new URLSearchParams(params)}`,
    );
    expect(response.status).toBe(400);
    expect(String(response.body)).not.toContain("canary-contents");
  });

  test("an unknown parameter is refused", () => {
    const r = rig(world());
    expect(
      r.bridge.handle(
        "GET",
        `${BRIDGE_PREFIX}/resolve?source=canon&id=zeus-portrait&path=/etc/passwd`,
      ).status,
    ).toBe(400);
  });

  test.each([
    [
      "traversal in the id",
      `${BRIDGE_PREFIX}/atlas/draft/..%2F..%2Fcanary%2Fsecret`,
    ],
    ["a slash in the id", `${BRIDGE_PREFIX}/atlas/draft/a/b`],
    ["a dot segment", `${BRIDGE_PREFIX}/atlas/draft/../secret`],
    ["an unknown source", `${BRIDGE_PREFIX}/atlas/registry/zeus-portrait`],
    ["a missing id", `${BRIDGE_PREFIX}/atlas/canon`],
    [
      "a malformed placeholder hash",
      `${BRIDGE_PREFIX}/placeholder/..%2Fsecret`,
    ],
    ["a short placeholder hash", `${BRIDGE_PREFIX}/placeholder/abc`],
  ])("the atlas and placeholder endpoints refuse %s", (_name, url) => {
    const w = world();
    mkdirSync(join(w.base, "canary"));
    writeFileSync(join(w.base, "canary", "secret"), "canary-contents");
    const r = rig(w);
    const response = r.bridge.handle("GET", url);
    expect([400, 404]).toContain(response.status);
    expect(String(response.body)).not.toContain("canary-contents");
  });

  test("a well-formed id nothing holds is 404 for bytes, and a placeholder hash that is not ours is 404", () => {
    const r = rig(world());
    expect(
      r.bridge.handle("GET", `${BRIDGE_PREFIX}/atlas/draft/unheld-take`).status,
    ).toBe(404);
    expect(
      r.bridge.handle("GET", `${BRIDGE_PREFIX}/placeholder/${"0".repeat(64)}`)
        .status,
    ).toBe(404);
  });

  test("only GET is served, and unknown routes are 404", () => {
    const r = rig(world());
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const response = r.bridge.handle(method, bridgePaths.listing);
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("GET");
    }
    expect(r.bridge.handle("GET", `${BRIDGE_PREFIX}/nothing`).status).toBe(404);
  });

  test("requests touch no filesystem: bytes are served from validated memory after the roots are gone", () => {
    const w = world();
    writeDraft(w.studioRoot, "zeus-take", spriteFixture("placeholder-zeus"));
    const r = rig(w);
    const resolved = resolve(r, { source: "draft", id: "zeus-take" });
    if (resolved.kind !== "frames") throw new Error("expected frames");

    rmSync(w.base, { recursive: true, force: true });

    expect(atlasBytes(r, resolved.bytes).status).toBe(200);
    expect(listing(r).entries).toHaveLength(2);
  });

  test("responses are never cached or sniffed", () => {
    const r = rig(world());
    const response = r.bridge.handle("GET", bridgePaths.listing);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-type"]).toBe("application/json");
  });
});

describe("portraits and fixtures", () => {
  test("a portrait draft resolves one frame for the requested expression and the placeholder for an expression it lacks", () => {
    const w = world();
    writeDraft(
      w.studioRoot,
      "hera-faces",
      portraitFixture("hera-portrait", "hera"),
    );
    const r = rig(w);

    const awed = resolve(r, {
      source: "draft",
      id: "hera-faces",
      expression: "awed",
    });
    expect(awed).toMatchObject({ kind: "frames" });
    expect(
      resolve(r, { source: "draft", id: "hera-faces", expression: "angry" }),
    ).toMatchObject({ kind: "placeholder", reason: "missing-state" });
    expect(resolve(r, { source: "draft", id: "hera-faces" })).toMatchObject({
      kind: "placeholder",
      reason: "wrong-kind",
    });
  });

  test("the vocabulary in use is the committed one", () => {
    expect(vocabulary.expressions).toContain("awed");
  });
});

describe("the production watcher waits for a root that does not exist yet", () => {
  test("it watches the nearest existing ancestor, then switches to a recursive root watch and reports the root", () => {
    const present = new Set(["/repo"]);
    const fake = fakeWatchFs((path) => present.has(path));
    const changes: string[] = [];

    fsWatcher("/repo/.studio", (relative) => changes.push(relative), fake.fs);

    expect(fake.open().map((w) => [w.path, w.recursive])).toEqual([
      ["/repo", false],
    ]);

    present.add("/repo/.studio");
    fake.watches[0]?.fire(".studio");

    expect(fake.watches[0]?.closed).toBe(true);
    expect(fake.open().map((w) => [w.path, w.recursive])).toEqual([
      ["/repo/.studio", true],
    ]);
    expect(changes).toEqual([""]);

    fake.open()[0]?.fire("assets/zeus-take.json");
    fake.open()[0]?.fire(null);
    expect(changes).toEqual(["", "assets/zeus-take.json", ""]);
  });

  test("it follows a root several levels down as each level appears, and ignores unrelated entries", () => {
    const present = new Set(["/repo"]);
    const fake = fakeWatchFs((path) => present.has(path));
    const changes: string[] = [];
    fsWatcher("/repo/a/b", (relative) => changes.push(relative), fake.fs);

    fake.watches[0]?.fire("unrelated");
    expect(fake.watches).toHaveLength(1);
    expect(changes).toEqual([]);

    present.add("/repo/a");
    fake.watches[0]?.fire("a");
    expect(fake.open().map((w) => [w.path, w.recursive])).toEqual([
      ["/repo/a", false],
    ]);
    expect(changes).toEqual([]);

    present.add("/repo/a/b");
    fake.open()[0]?.fire("b");
    expect(fake.open().map((w) => [w.path, w.recursive])).toEqual([
      ["/repo/a/b", true],
    ]);
    expect(changes).toEqual([""]);
  });

  test("a root that already exists is watched recursively with no report, and close stops everything", () => {
    const fake = fakeWatchFs(() => true);
    const changes: string[] = [];
    const close = fsWatcher("/repo/.studio", (r) => changes.push(r), fake.fs);
    expect(fake.open().map((w) => [w.path, w.recursive])).toEqual([
      ["/repo/.studio", true],
    ]);
    expect(changes).toEqual([]);
    close();
    expect(fake.open()).toEqual([]);

    const present = new Set(["/repo"]);
    const waiting = fakeWatchFs((path) => present.has(path));
    const stop = fsWatcher("/repo/.studio", (r) => changes.push(r), waiting.fs);
    stop();
    present.add("/repo/.studio");
    waiting.watches[0]?.fire(".studio");
    expect(waiting.watches).toHaveLength(1);
    expect(changes).toEqual([]);
  });

  test("a store that appears after the bridge starts is listed and announced once its first draft lands", () => {
    const w = world();
    rmSync(w.studioRoot, { recursive: true });
    const fake = fakeWatchFs((path) => existsSync(path));
    const r = rig(w, {
      watch: (root, onChange) => fsWatcher(root, onChange, fake.fs),
    });
    expect(listing(r).entries.map((e) => e.source)).toEqual(["canon"]);
    expect(fake.open().find((watch) => watch.path === w.base)?.recursive).toBe(
      false,
    );

    writeDraft(w.studioRoot, "zeus-take", spriteFixture("placeholder-zeus"));
    fake
      .open()
      .find((watch) => watch.path === w.base)
      ?.fire("studio");
    expect(r.pending()).toBe(1);
    r.tick();

    expect(r.events).toEqual([
      { changed: [{ source: "draft", id: "zeus-take" }], listing: true },
    ]);
    expect(listing(r).entries.map((e) => `${e.source}:${e.id}`)).toEqual([
      "canon:zeus-portrait",
      "draft:zeus-take",
    ]);
    expect(resolve(r, { source: "draft", id: "zeus-take" }).kind).toBe(
      "frames",
    );
    expect(
      fake
        .open()
        .some((watch) => watch.path === w.studioRoot && watch.recursive),
    ).toBe(true);
  });
});

describe("the browser's copies of the core's vocabulary", () => {
  test("name the same source kinds and accept the same ids", () => {
    expect([...SOURCE_KINDS]).toEqual([...PREVIEW_SOURCE_KINDS]);
    for (const kind of [...PREVIEW_SOURCE_KINDS, "registry", "", "toString"])
      expect(isSourceKind(kind), kind).toBe(
        (PREVIEW_SOURCE_KINDS as readonly string[]).includes(kind),
      );
    for (const id of [
      "zeus-portrait",
      "a",
      "a-b-c",
      "Zeus",
      "a--b",
      "-a",
      "a-",
      "../x",
      "a/b",
      "",
      "a".repeat(128),
      "a".repeat(129),
    ])
      expect(isSlug(id), id).toBe(isPreviewSlug(id));
    for (const value of [undefined, null, 7, {}])
      expect(isSlug(value)).toBe(isPreviewSlug(value));
  });
});
