import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  callsTo,
  type FakeTransport,
  fakeTransport,
  hostError,
} from "../host/_testkit";
import { createStudioHost } from "../host/client";
import type { AssetProblem, SourceChange } from "./port";
import { createTauriSource } from "./tauri";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const KEY_C = "c".repeat(64);
const PLACEHOLDER = "0123456789abcdef".repeat(4);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_2 = new Uint8Array([137, 80, 78, 71, 9, 9, 9, 9]);

const frames = (pixelKey: string, id = "zeus-take", source = "draft") => ({
  kind: "frames",
  selection: { source, id },
  manifestKey: "m".repeat(64),
  asset: {
    kind: "sprite",
    assetId: "placeholder-zeus",
    revision: "r".repeat(64),
    uri: "panthea-asset://asset/placeholder-zeus",
    atlas: { blob: "b".repeat(64), width: 128, height: 80 },
    cell: { w: 64, h: 80 },
    frames: [
      { rect: { x: 0, y: 0, w: 64, h: 80 }, durationMs: 167 },
      { rect: { x: 64, y: 0, w: 64, h: 80 }, durationMs: 167 },
    ],
    loopStart: 0,
    pivot: { x: 32, y: 76 },
    footprint: { w: 1, h: 1 },
  },
  bytes: { width: 128, height: 80, pixelKey },
});

const placeholder = (selection = { source: "draft", id: "nothing" }) => ({
  kind: "placeholder",
  selection,
  reason: "missing-id",
  uri: `panthea-asset://placeholder/${PLACEHOLDER}`,
  problems: [],
  bytes: { width: 16, height: 16, pixelKey: PLACEHOLDER },
});

const listing = {
  entries: [
    {
      source: "canon",
      id: "zeus-sprite",
      assetId: "zeus-sprite",
      kind: "sprite",
      state: "canon",
      ok: true,
    },
    {
      source: "draft",
      id: "zeus-take",
      assetId: "placeholder-zeus",
      kind: "sprite",
      state: "draft",
      ok: false,
    },
  ],
  problems: [{ scope: "draft:zeus-take", message: "atlas blob is missing" }],
};

const keys = (
  listingKey: string,
  selections: readonly (readonly [string, string, string])[],
) => ({
  listing: listingKey,
  selections: selections.map(([source, id, key]) => ({ source, id, key })),
});

const snapshot = (
  sourceKeys: ReturnType<typeof keys> | null | undefined,
  extra: Record<string, unknown> = {},
) => ({
  host: { state: "running" },
  ...(sourceKeys === undefined ? {} : { keys: sourceKeys }),
  ...extra,
});

function rig(
  ops: Record<string, (args: Record<string, unknown>) => unknown> = {},
) {
  const problems: AssetProblem[] = [];
  const transport: FakeTransport = fakeTransport({
    studio_call: callsTo({
      "source-list": () => listing,
      "source-resolve": () => frames(KEY_A),
      ...ops,
    }),
    preview_bytes: () => PNG.buffer.slice(0),
    subscribe_studio: () => undefined,
  });
  const host = createStudioHost(transport);
  const source = createTauriSource(host, {
    onProblem: (problem) => problems.push(problem),
  });
  const push = (payload: unknown) => transport.channels[0]?.emit(payload);
  const changes: SourceChange[] = [];
  const watch = () => source.subscribe((change) => changes.push(change));
  return { transport, source, problems, push, changes, watch };
}

const draft = (id: string) => ({ source: "draft" as const, id });

describe("list, resolve, fetchBytes", () => {
  test("lists through source-list, resolves through source-resolve and fetches the bytes the resolution names", async () => {
    const r = rig();

    const listed = await r.source.list();
    const resolved = await r.source.resolve({
      source: "draft",
      id: "zeus-take",
    });
    const bytes = await r.source.fetchBytes(resolved.bytes);

    expect(listed.entries.map((e) => `${e.source}:${e.id}`)).toEqual([
      "canon:zeus-sprite",
      "draft:zeus-take",
    ]);
    expect(listed.problems).toEqual(listing.problems);
    expect(resolved).toMatchObject({
      kind: "frames",
      selection: draft("zeus-take"),
      bytes: { width: 128, height: 80, pixelKey: KEY_A },
    });
    expect([...bytes]).toEqual([...PNG]);
    expect(r.transport.to("preview_bytes")[0]?.args).toEqual({
      selection: draft("zeus-take"),
      v: KEY_A,
    });
    expect(
      r.transport
        .to("studio_call")
        .map((call) => (call.args as { op: string }).op),
    ).toEqual(["source-list", "source-resolve"]);
  });

  test("the resolve request is sent without the fields it leaves out", async () => {
    const r = rig();
    await r.source.resolve({ source: "canon", id: "zeus-sprite" });
    await r.source.resolve({
      source: "canon",
      id: "zeus-sprite",
      state: "walk",
      direction: "east",
    });

    const sent = r.transport.to("studio_call").map((c) => c.args);
    expect(sent).toEqual([
      { op: "source-resolve", args: { source: "canon", id: "zeus-sprite" } },
      {
        op: "source-resolve",
        args: {
          source: "canon",
          id: "zeus-sprite",
          state: "walk",
          direction: "east",
        },
      },
    ]);
  });

  test("the resolution's bytes name no file: the url is an opaque in-app reference", async () => {
    const r = rig();
    const resolved = await r.source.resolve({
      source: "draft",
      id: "zeus-take",
    });
    expect(resolved.bytes.url.startsWith("studio-host:")).toBe(true);
    expect(resolved.bytes.url).not.toMatch(/https?:|file:|\/Users|\.\./);
  });

  test("an unknown selection resolves to the placeholder, and its bytes come by hash with no version", async () => {
    const r = rig({ "source-resolve": () => placeholder() });

    const resolved = await r.source.resolve({ source: "draft", id: "nothing" });
    const bytes = await r.source.fetchBytes(resolved.bytes);

    expect(resolved).toMatchObject({
      kind: "placeholder",
      reason: "missing-id",
    });
    expect(bytes.length).toBe(PNG.length);
    expect(r.transport.to("preview_bytes")[0]?.args).toEqual({
      selection: { placeholder: PLACEHOLDER },
    });
  });

  test("a bytes reference that is not one this source made is refused before the host is asked", async () => {
    const r = rig();
    for (const url of [
      "",
      "/__panthea-studio/assets/atlas/draft/zeus-take?v=k",
      "studio-host:atlas/registry/zeus-take?v=k",
      "studio-host:atlas/draft/../x?v=k",
      "studio-host:atlas/draft/zeus-take",
      "studio-host:placeholder/short",
      "studio-host:placeholder/../../etc/passwd",
    ])
      await expect(
        r.source.fetchBytes({ url, width: 1, height: 1, pixelKey: "k" }),
      ).rejects.toThrow();
    expect(r.transport.to("preview_bytes")).toEqual([]);
  });
});

describe("a stale version", () => {
  test("re-resolves once and fetches the new key's bytes", async () => {
    let resolves = 0;
    const r = rig({
      "source-resolve": () => {
        resolves += 1;
        return frames(resolves === 1 ? KEY_A : KEY_B);
      },
    });
    const calls: unknown[] = [];
    r.transport.answer("preview_bytes", (args) => {
      calls.push(args);
      if ((args as { v: string }).v === KEY_A)
        throw hostError("stale-version", "resolve it again");
      return PNG_2.buffer.slice(0);
    });
    const resolved = await r.source.resolve({
      source: "draft",
      id: "zeus-take",
    });

    const bytes = await r.source.fetchBytes(resolved.bytes);

    expect([...bytes]).toEqual([...PNG_2]);
    expect(calls).toEqual([
      { selection: draft("zeus-take"), v: KEY_A },
      { selection: draft("zeus-take"), v: KEY_B },
    ]);
    expect(resolves).toBe(2);
  });

  test("a second stale answer is the end: no third try, no loop", async () => {
    let resolves = 0;
    const r = rig({
      "source-resolve": () => {
        resolves += 1;
        return frames(resolves === 1 ? KEY_A : KEY_B);
      },
    });
    r.transport.answer("preview_bytes", () => {
      throw hostError("stale-version", "still moving");
    });
    const resolved = await r.source.resolve({
      source: "draft",
      id: "zeus-take",
    });

    await expect(r.source.fetchBytes(resolved.bytes)).rejects.toMatchObject({
      code: "stale-version",
    });

    expect(r.transport.to("preview_bytes")).toHaveLength(2);
    expect(resolves).toBe(2);
  });

  test("a selection that is gone by the re-resolve rejects instead of fetching a placeholder as its atlas", async () => {
    let resolves = 0;
    const r = rig({
      "source-resolve": () => {
        resolves += 1;
        return resolves === 1 ? frames(KEY_A) : placeholder(draft("zeus-take"));
      },
    });
    r.transport.answer("preview_bytes", () => {
      throw hostError("stale-version", "x");
    });
    const resolved = await r.source.resolve({
      source: "draft",
      id: "zeus-take",
    });

    await expect(r.source.fetchBytes(resolved.bytes)).rejects.toThrow();
    expect(r.transport.to("preview_bytes")).toHaveLength(1);
  });

  test("any other refusal rejects at once without a re-resolve", async () => {
    const r = rig();
    r.transport.answer("preview_bytes", () => {
      throw hostError("not-found", "no validated atlas for this selection");
    });
    const resolved = await r.source.resolve({
      source: "draft",
      id: "zeus-take",
    });

    await expect(r.source.fetchBytes(resolved.bytes)).rejects.toMatchObject({
      code: "not-found",
    });

    expect(r.transport.to("preview_bytes")).toHaveLength(1);
    expect(r.transport.to("studio_call")).toHaveLength(1);
  });
});

describe("changes", () => {
  const base = keys("l1", [
    ["canon", "zeus-sprite", KEY_A],
    ["draft", "zeus-take", KEY_B],
  ]);

  /** A source whose first snapshot has been seen, so changes are measured from it. */
  async function settled() {
    const r = rig();
    r.watch();
    r.push(snapshot(base));
    return r;
  }

  test("the first snapshot is the baseline and announces nothing", async () => {
    const r = rig();
    r.watch();
    r.push(snapshot(base));
    expect(r.changes).toEqual([]);
  });

  test("a changed key emits exactly one SourceChange naming that selection", async () => {
    const r = await settled();

    r.push(
      snapshot(
        keys("l1", [
          ["canon", "zeus-sprite", KEY_A],
          ["draft", "zeus-take", KEY_C],
        ]),
      ),
    );

    expect(r.changes).toEqual([
      { changed: [draft("zeus-take")], listing: false },
    ]);
  });

  test("a snapshot with the same keys, however often it arrives, emits nothing", async () => {
    const r = await settled();
    for (let i = 0; i < 3; i += 1) r.push(snapshot(base));
    r.push(snapshot(base, { jobs: [{ id: "j", status: "queued" }] }));
    expect(r.changes).toEqual([]);
  });

  test("a new selection and a removed one are both changes, in one event, with the listing bit", async () => {
    const r = await settled();

    r.push(
      snapshot(
        keys("l2", [
          ["canon", "zeus-sprite", KEY_A],
          ["approved", "zeus-final", KEY_C],
        ]),
      ),
    );

    expect(r.changes).toEqual([
      {
        changed: [
          { source: "approved", id: "zeus-final" },
          { source: "draft", id: "zeus-take" },
        ],
        listing: true,
      },
    ]);
  });

  test("a listing change alone sets the listing bit with no selection", async () => {
    const r = await settled();
    r.push(snapshot({ ...base, listing: "l9" }));
    expect(r.changes).toEqual([{ changed: [], listing: true }]);
  });

  test("a host-only snapshot (the sidecar is away) emits nothing, and keys coming back unchanged emit nothing", async () => {
    const r = await settled();

    r.push({ host: { state: "restarting", attempt: 1, maxAttempts: 3 } });
    r.push(snapshot(null, { errors: {} }));
    r.push(snapshot(base));

    expect(r.changes).toEqual([]);
  });

  test("a change made while the sidecar was away is found when the keys come back", async () => {
    const r = await settled();

    r.push({ host: { state: "starting" } });
    r.push(
      snapshot(
        keys("l1", [
          ["canon", "zeus-sprite", KEY_A],
          ["draft", "zeus-take", KEY_C],
        ]),
      ),
    );

    expect(r.changes).toEqual([
      { changed: [draft("zeus-take")], listing: false },
    ]);
  });

  test("every subscriber gets the change, and they share one host subscription", async () => {
    const r = rig();
    const second: SourceChange[] = [];
    r.watch();
    r.source.subscribe((change) => second.push(change));
    r.push(snapshot(base));

    r.push(
      snapshot({
        ...base,
        selections: [
          { source: "canon", id: "zeus-sprite", key: KEY_C },
          { source: "draft", id: "zeus-take", key: KEY_B },
        ],
      }),
    );

    expect(r.changes).toHaveLength(1);
    expect(second).toEqual(r.changes);
    expect(r.transport.to("subscribe_studio")).toHaveLength(1);
    expect(r.transport.channels).toHaveLength(1);
  });

  test("unsubscribing stops one listener, and the baseline is kept so a change made while nobody listened is not lost", async () => {
    const r = rig();
    const stop = r.watch();
    r.push(snapshot(base));
    stop();

    r.push(
      snapshot(
        keys("l1", [
          ["canon", "zeus-sprite", KEY_C],
          ["draft", "zeus-take", KEY_B],
        ]),
      ),
    );
    expect(r.changes).toEqual([]);

    r.watch();
    expect(r.changes).toEqual([
      { changed: [{ source: "canon", id: "zeus-sprite" }], listing: false },
    ]);
  });

  test("a listener that throws is reported and does not stop the others", async () => {
    const r = rig();
    const seen: SourceChange[] = [];
    r.source.subscribe(() => {
      throw new Error("preview exploded");
    });
    r.source.subscribe((change) => seen.push(change));
    r.push(snapshot(base));

    r.push(snapshot({ ...base, listing: "l2" }));

    expect(seen).toHaveLength(1);
    expect(r.problems).toEqual([
      { scope: "subscriber", message: "preview exploded" },
    ]);
  });
});

describe("recovering", () => {
  test("a read that failed before the sidecar was up is retried by one catch-up change when its data arrives", async () => {
    const r = rig();
    r.transport.answer("studio_call", () => {
      throw hostError("sidecar-unavailable", "not running", true);
    });
    r.watch();
    await expect(r.source.list()).rejects.toMatchObject({ retryable: true });

    r.push(
      snapshot(
        keys("l1", [
          ["canon", "zeus-sprite", KEY_A],
          ["draft", "zeus-take", KEY_B],
        ]),
      ),
    );
    r.push(
      snapshot(
        keys("l1", [
          ["canon", "zeus-sprite", KEY_A],
          ["draft", "zeus-take", KEY_B],
        ]),
      ),
    );

    expect(r.changes).toEqual([
      {
        changed: [
          { source: "canon", id: "zeus-sprite" },
          { source: "draft", id: "zeus-take" },
        ],
        listing: true,
      },
    ]);
  });

  test("reads that succeeded before the first keys arrived are caught up once, because they may predate them", async () => {
    const r = rig();
    r.watch();
    await r.source.list();
    await r.source.resolve({ source: "draft", id: "zeus-take" });

    r.push(snapshot(keys("l1", [["draft", "zeus-take", KEY_B]])));
    r.push(snapshot(keys("l1", [["draft", "zeus-take", KEY_B]])));

    expect(r.changes).toEqual([
      { changed: [draft("zeus-take")], listing: true },
    ]);
  });

  test("a source that was never read from announces nothing for its first keys", async () => {
    const r = rig();
    r.watch();
    r.push(snapshot(keys("l1", [["draft", "zeus-take", KEY_B]])));
    expect(r.changes).toEqual([]);
  });

  test("a failed read after the baseline asks for a catch-up on the next snapshot, once", async () => {
    const r = rig();
    r.watch();
    r.push(snapshot(keys("l1", [["draft", "zeus-take", KEY_B]])));
    r.transport.answer("studio_call", () => {
      throw hostError("timeout", "slow");
    });
    await expect(
      r.source.resolve({ source: "draft", id: "zeus-take" }),
    ).rejects.toThrow();

    r.push(snapshot(keys("l1", [["draft", "zeus-take", KEY_B]])));
    r.push(snapshot(keys("l1", [["draft", "zeus-take", KEY_B]])));

    expect(r.changes).toEqual([
      { changed: [draft("zeus-take")], listing: true },
    ]);
  });
});

describe("untrusted payloads", () => {
  test.each([
    ["not an object", 7],
    ["no entries", { problems: [] }],
    ["entries that are not a list", { entries: {}, problems: [] }],
    ["no problems", { entries: [] }],
    [
      "an entry with a path-like id",
      { entries: [{ ...listing.entries[0], id: "../x" }], problems: [] },
    ],
    [
      "an entry with an unknown source",
      {
        entries: [{ ...listing.entries[0], source: "registry" }],
        problems: [],
      },
    ],
    [
      "an entry with an unknown kind",
      { entries: [{ ...listing.entries[0], kind: "tile" }], problems: [] },
    ],
    [
      "an entry whose ok is not a boolean",
      { entries: [{ ...listing.entries[0], ok: "yes" }], problems: [] },
    ],
    [
      "a problem with no message",
      { entries: [], problems: [{ scope: "store" }] },
    ],
  ])(
    "a listing with %s rejects and returns nothing",
    async (_name, payload) => {
      const r = rig({ "source-list": () => payload });
      await expect(r.source.list()).rejects.toMatchObject({
        code: "malformed-reply",
      });
    },
  );

  const withAsset = (patch: Record<string, unknown>) => {
    const value = frames(KEY_A);
    return { ...value, asset: { ...value.asset, ...patch } };
  };

  test.each([
    ["null", null],
    ["an unknown kind", { ...frames(KEY_A), kind: "mystery" }],
    [
      "a selection with a bad id",
      { ...frames(KEY_A), selection: { source: "draft", id: "../x" } },
    ],
    ["no bytes", { ...frames(KEY_A), bytes: undefined }],
    [
      "a bytes size that is not a number",
      { ...frames(KEY_A), bytes: { width: "1", height: 1, pixelKey: KEY_A } },
    ],
    [
      "an empty pixel key",
      { ...frames(KEY_A), bytes: { width: 1, height: 1, pixelKey: "" } },
    ],
    ["a missing manifest key", { ...frames(KEY_A), manifestKey: undefined }],
    ["an asset that is not an object", { ...frames(KEY_A), asset: "x" }],
    [
      "an asset kind that is not sprite or portrait",
      withAsset({ kind: "tile" }),
    ],
    ["frames that are not a list", withAsset({ frames: {} })],
    [
      "a frame with a text rect",
      withAsset({
        frames: [{ rect: { x: "0", y: 0, w: 1, h: 1 }, durationMs: 1 }],
      }),
    ],
    [
      "a frame with no duration",
      withAsset({ frames: [{ rect: { x: 0, y: 0, w: 1, h: 1 } }] }),
    ],
    ["a cell with no height", withAsset({ cell: { w: 64 } })],
    ["an atlas with no blob", withAsset({ atlas: { width: 1, height: 1 } })],
    ["a pivot that is not a point", withAsset({ pivot: [1, 2] })],
    ["a footprint that is not a size", withAsset({ footprint: "1x1" })],
    ["a loop start that is not a number", withAsset({ loopStart: "0" })],
    [
      "a placeholder with an unknown reason",
      { ...placeholder(), reason: "because" },
    ],
    [
      "a placeholder whose hash is not a sha256",
      { ...placeholder(), bytes: { width: 1, height: 1, pixelKey: "../x" } },
    ],
    [
      "a placeholder with a bad problems list",
      { ...placeholder(), problems: [1] },
    ],
  ])(
    "a resolution with %s rejects and returns nothing",
    async (_name, payload) => {
      const r = rig({ "source-resolve": () => payload });
      await expect(
        r.source.resolve({ source: "draft", id: "zeus-take" }),
      ).rejects.toMatchObject({ code: "malformed-reply" });
    },
  );

  test("optional frame fields may be absent", async () => {
    const value = frames(KEY_A);
    const { loopStart: _l, pivot: _p, footprint: _f, ...asset } = value.asset;
    const r = rig({ "source-resolve": () => ({ ...value, asset }) });
    const resolved = await r.source.resolve({
      source: "draft",
      id: "zeus-take",
    });
    expect(resolved.kind).toBe("frames");
    if (resolved.kind === "frames")
      expect(resolved.asset).not.toHaveProperty("pivot");
  });

  test("an invalid channel payload is reported through onProblem and dropped, and the next valid snapshot still works", async () => {
    const r = rig();
    r.watch();
    r.push(snapshot(keys("l1", [["draft", "zeus-take", KEY_A]])));

    for (const bad of [
      null,
      "x",
      { host: { state: "asleep" } },
      { host: { state: "running" }, keys: { listing: 1, selections: [] } },
    ])
      r.push(bad);
    r.push(snapshot(keys("l1", [["draft", "zeus-take", KEY_B]])));

    expect(r.problems).toHaveLength(4);
    expect(r.problems[0]).toMatchObject({ scope: "studio-channel" });
    expect(r.changes).toEqual([
      { changed: [draft("zeus-take")], listing: false },
    ]);
  });

  test("a keys section the session refused is reported once, not on every snapshot", async () => {
    const r = rig();
    r.watch();
    const refused = snapshot(null, {
      errors: {
        keys: {
          code: "missing-config",
          message: "registryRoot is not configured",
        },
      },
    });

    r.push(refused);
    r.push(refused);
    r.push(refused);

    expect(r.problems).toEqual([
      {
        scope: "source-keys",
        message: "missing-config: registryRoot is not configured",
      },
    ]);
    expect(r.changes).toEqual([]);
  });
});

describe("browser safety", () => {
  const read = (...parts: string[]) =>
    Bun.file(join(import.meta.dir, "..", ...parts)).text();

  test.each([
    ["source/tauri.ts"],
    ["host/types.ts"],
    ["host/client.ts"],
    ["host/tauri.ts"],
  ])(
    "%s imports nothing from node, the assets runtime or the dev bridge",
    async (file) => {
      const text = await read(...file.split("/"));
      expect(text).not.toMatch(/from "node:/);
      expect(text).not.toMatch(/require\(/);
      expect(text).not.toMatch(/^import (?!type)[^;]*from "@panthea\/assets/ms);
      expect(text).not.toMatch(/from "\.\/dev-bridge"/);
      expect(text).not.toMatch(/from "\.\.\/source\/dev-bridge"/);
    },
  );

  test("only the host transport touches @tauri-apps/api, and only its core module", async () => {
    for (const file of ["source/tauri.ts", "host/types.ts", "host/client.ts"])
      expect(await read(...file.split("/")), file).not.toMatch(/@tauri-apps/);
    const transport = await read("host", "tauri.ts");
    const imports = [...transport.matchAll(/from "(@tauri-apps\/[^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(imports).toEqual(["@tauri-apps/api/core"]);
  });
});
