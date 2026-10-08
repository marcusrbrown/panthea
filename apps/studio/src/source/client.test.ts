import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { spriteFixture } from "@panthea/assets/fixtures";
import { removeTempRoots, rig, world, writeDraft } from "./_testkit";
import { createDevBridgeSource, type HotChannel, parseChange } from "./client";
import type { AssetBridge } from "./dev-bridge";
import { CHANGE_EVENT, type SourceChange } from "./port";

afterEach(removeTempRoots);

const fetchVia =
  (bridge: AssetBridge) =>
  async (url: string): Promise<Response> => {
    const response = bridge.handle("GET", url);
    return new Response(response.body as BodyInit, {
      status: response.status,
      headers: { ...response.headers },
    });
  };

function fakeHot() {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const disposers: (() => void)[] = [];
  const hot: HotChannel = {
    on: (event, listener) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    off: (event, listener) => {
      listeners.get(event)?.delete(listener);
    },
    dispose: (callback) => {
      disposers.push(callback);
    },
  };
  return {
    hot,
    send: (data: unknown) => {
      for (const listener of [...(listeners.get(CHANGE_EVENT) ?? [])])
        listener(data);
    },
    count: () => listeners.get(CHANGE_EVENT)?.size ?? 0,
    disposeModule: () => {
      for (const dispose of disposers) dispose();
    },
  };
}

describe("the browser side of the dev bridge", () => {
  test("lists, resolves and fetches validated bytes through the read-only endpoints", async () => {
    const w = world();
    writeDraft(w.studioRoot, "zeus-take", spriteFixture("placeholder-zeus"));
    const r = rig(w);
    const source = createDevBridgeSource({
      fetch: fetchVia(r.bridge),
      hot: undefined,
    });

    const listing = await source.list();
    expect(listing.entries.map((e) => `${e.source}:${e.id}`)).toEqual([
      "canon:zeus-portrait",
      "draft:zeus-take",
    ]);

    const resolved = await source.resolve({
      source: "draft",
      id: "zeus-take",
    });
    expect(resolved.kind).toBe("frames");
    const bytes = await source.fetchBytes(resolved.bytes);
    expect([...bytes.slice(0, 4)]).toEqual([137, 80, 78, 71]);
  });

  test("an unknown selection resolves to the placeholder and its bytes still fetch", async () => {
    const r = rig(world());
    const source = createDevBridgeSource({
      fetch: fetchVia(r.bridge),
      hot: undefined,
    });
    const resolved = await source.resolve({ source: "draft", id: "nothing" });
    expect(resolved).toMatchObject({
      kind: "placeholder",
      reason: "missing-id",
    });
    expect((await source.fetchBytes(resolved.bytes)).length).toBeGreaterThan(8);
  });

  test("a refused request rejects instead of returning a payload", async () => {
    const r = rig(world());
    const source = createDevBridgeSource({
      fetch: fetchVia(r.bridge),
      hot: undefined,
    });
    await expect(
      source.resolve({ source: "draft", id: "../x" }),
    ).rejects.toThrow("400");
    await expect(
      source.fetchBytes({
        url: "/__panthea-studio/assets/atlas/draft/unheld",
        width: 1,
        height: 1,
        pixelKey: "k",
      }),
    ).rejects.toThrow("404");
  });

  test("a bridge change event reaches subscribers and a live edit resolves to the new bytes", async () => {
    const w = world();
    writeDraft(w.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 1));
    const r = rig(w);
    const channel = fakeHot();
    const source = createDevBridgeSource({
      fetch: fetchVia(r.bridge),
      hot: channel.hot,
    });
    const seen: SourceChange[] = [];
    source.subscribe((change) => seen.push(change));
    const before = await source.resolve({ source: "draft", id: "zeus-take" });

    writeDraft(w.studioRoot, "zeus-take", spriteFixture("placeholder-zeus", 2));
    r.watchers[1]?.touch("assets/zeus-take.json");
    r.tick();
    for (const event of r.events) channel.send(event);

    expect(seen).toEqual([
      { changed: [{ source: "draft", id: "zeus-take" }], listing: false },
    ]);
    const after = await source.resolve({ source: "draft", id: "zeus-take" });
    expect(after.bytes.pixelKey).not.toBe(before.bytes.pixelKey);
    if (after.kind !== "frames" || before.kind !== "frames")
      throw new Error("expected frames");
    expect(after.manifestKey).toBe(before.manifestKey);
  });

  test("malformed events are dropped", () => {
    const channel = fakeHot();
    const source = createDevBridgeSource({ hot: channel.hot });
    const seen: SourceChange[] = [];
    source.subscribe((change) => seen.push(change));
    for (const bad of [
      null,
      "x",
      {},
      { changed: "x", listing: false },
      { changed: [{ source: "draft", id: "../x" }], listing: false },
      { changed: [], listing: "yes" },
    ])
      channel.send(bad);
    expect(seen).toEqual([]);
    expect(parseChange({ changed: [], listing: true })).toEqual({
      changed: [],
      listing: true,
    });
  });

  test("unsubscribe stops delivery, and HMR dispose tears every subscription down", () => {
    const channel = fakeHot();
    const source = createDevBridgeSource({ hot: channel.hot });
    const a: SourceChange[] = [];
    const b: SourceChange[] = [];
    const stopA = source.subscribe((c) => a.push(c));
    source.subscribe((c) => b.push(c));
    expect(channel.count()).toBe(2);

    stopA();
    channel.send({ changed: [], listing: true });
    expect(a).toEqual([]);
    expect(b).toHaveLength(1);
    expect(channel.count()).toBe(1);

    channel.disposeModule();
    expect(channel.count()).toBe(0);
    channel.send({ changed: [], listing: true });
    expect(b).toHaveLength(1);
    source.subscribe((c) => b.push(c))();
    expect(channel.count()).toBe(0);
  });

  test("without an HMR channel subscribing is a harmless no-op", () => {
    const source = createDevBridgeSource({ hot: undefined });
    expect(() => source.subscribe(() => {})()).not.toThrow();
  });
});

test("the client module imports nothing from node or the assets runtime", async () => {
  const text = await Bun.file(join(import.meta.dir, "client.ts")).text();
  expect(text).not.toMatch(/from "node:/);
  expect(text).not.toMatch(/^import (?!type)[^;]*from "@panthea\/assets/m);
  expect(text).not.toMatch(/from "\.\/dev-bridge"/);
});
