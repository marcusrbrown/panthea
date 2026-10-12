import { describe, expect, it } from "bun:test";
import type { PreviewItem } from "../renderer/preview";
import {
  clockTiming,
  createPlaybackClock,
  entryKey,
  expressionAfterListing,
  expressionKeyMessage,
  followClipTiming,
  HARNESS_CAMERA,
  harnessItems,
  harnessSubject,
  MISSING_SPRITE,
  PORTRAIT_PANEL_AT,
  pickIn,
  spriteKeyAfterListing,
} from "./layout";

const zeus = { source: "draft", id: "zeus-idle" } as const;
const portrait = { source: "canon", id: "zeus-portrait" } as const;
const zeusAnimations = [
  { state: "idle", direction: "south" },
  { state: "seated", direction: "north" },
];

function byId(items: readonly PreviewItem[], id: string): PreviewItem {
  const found = items.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no item ${id}`);
  return found;
}

describe("a realm on the previewed record", () => {
  const underworld = { ...zeus, realm: "underworld" } as const;

  it("is applied to the subject only when the chosen subject is the selected record", () => {
    expect(harnessSubject(zeus, { ...zeus, realm: "underworld" })).toEqual(
      underworld,
    );
    expect(
      harnessSubject(
        { source: "draft", id: "other" },
        { ...zeus, realm: "underworld" },
      ),
    ).toEqual({ source: "draft", id: "other" });
    expect(harnessSubject(zeus, zeus)).toEqual(zeus);
    expect(harnessSubject(zeus, undefined)).toEqual(zeus);
    expect(harnessSubject(undefined, { ...zeus, realm: "underworld" })).toBe(
      undefined,
    );
  });

  it("goes into the subject's and the companion's requests, so both are drawn from the variant atlas", () => {
    const items = harnessItems({
      subject: underworld,
      portrait: undefined,
      state: "idle",
      direction: "south",
      ability: undefined,
      expression: "neutral",
      animations: zeusAnimations,
      companion: true,
    });

    expect(byId(items, "subject")).toMatchObject({
      request: { ...underworld, state: "idle", direction: "south" },
    });
    expect(byId(items, "seated")).toMatchObject({
      request: { ...underworld, state: "seated", direction: "north" },
    });
    // The placeholder mortal and structure are not the record and stay on no realm.
    expect(byId(items, "mortal")).toMatchObject({ request: MISSING_SPRITE });
  });
});

describe("harnessItems", () => {
  const items = harnessItems({
    subject: zeus,
    portrait,
    state: "idle",
    direction: "south",
    ability: undefined,
    expression: "neutral",
    animations: zeusAnimations,
    companion: true,
  });

  it("lays a 4x4 ground patch of diamonds", () => {
    const ground = items.filter((item) => item.kind === "diamond");
    expect(ground).toHaveLength(16);
    expect(new Set(ground.map((item) => item.id)).size).toBe(16);
  });

  it("asks for the chosen state and published direction of the companion", () => {
    expect(byId(items, "subject")).toMatchObject({
      kind: "sprite",
      layer: "actor",
      request: { ...zeus, state: "idle", direction: "south" },
    });
    expect(byId(items, "seated")).toMatchObject({
      kind: "sprite",
      request: { ...zeus, state: "seated", direction: "north" },
    });
  });

  it("passes the selected ability and expression and uses a published companion key", () => {
    const keyed = harnessItems({
      subject: zeus,
      portrait,
      state: "act",
      direction: "south",
      ability: "thunderbolt",
      expression: "pleased",
      animations: [
        { state: "act", direction: "south", ability: "thunderbolt" },
        { state: "seated", direction: "west" },
      ],
      companion: true,
    } as never);

    expect(byId(keyed, "subject")).toMatchObject({
      request: {
        ...zeus,
        state: "act",
        direction: "south",
        ability: "thunderbolt",
      },
    });
    expect(byId(keyed, "seated")).toMatchObject({
      request: {
        ...zeus,
        state: "seated",
        direction: "west",
      },
    });
    expect(byId(keyed, "portrait")).toMatchObject({
      request: { ...portrait, expression: "pleased" },
    });
  });

  it("omits the seated companion when it is switched off", () => {
    const without = harnessItems({
      subject: zeus,
      portrait,
      state: "idle",
      direction: "south",
      expression: "neutral",
      companion: false,
    });
    expect(without.some((item) => item.id === "seated")).toBe(false);
  });

  it("draws a placeholder mortal for scale and a 2x2 placeholder structure two depth steps behind the subject", () => {
    expect(byId(items, "mortal")).toMatchObject({
      layer: "actor",
      request: MISSING_SPRITE,
    });
    expect(byId(items, "structure")).toMatchObject({
      layer: "structure",
      cell: { x: 0, y: 0, z: 0 },
      footprint: { w: 2, h: 2 },
      request: MISSING_SPRITE,
    });
    expect(byId(items, "subject")).toMatchObject({
      cell: { x: 2, y: 2, z: 0 },
    });
  });

  it("puts the portrait on a flat panel at the fixed screen position, asking for the chosen expression", () => {
    expect(byId(items, "portrait")).toMatchObject({
      kind: "flat",
      at: PORTRAIT_PANEL_AT,
      request: { ...portrait, expression: "neutral" },
    });
  });

  it("falls back to a placeholder subject and no portrait when nothing is selected", () => {
    const empty = harnessItems({
      subject: undefined,
      portrait: undefined,
      state: "idle",
      direction: "south",
      expression: "neutral",
      companion: true,
    });
    expect(byId(empty, "subject")).toMatchObject({ request: MISSING_SPRITE });
    expect(empty.some((item) => item.id === "portrait")).toBe(false);
  });

  it("swaps the layers and shares the subject's bottom cell when the structure is to draw in front", () => {
    const swapped = harnessItems({
      subject: zeus,
      portrait,
      state: "idle",
      direction: "south",
      expression: "neutral",
      companion: false,
      occlusion: "structure-front",
    });
    expect(byId(swapped, "structure")).toMatchObject({
      layer: "actor",
      cell: { x: 1, y: 1, z: 0 },
      footprint: { w: 2, h: 2 },
    });
    expect(byId(swapped, "subject")).toMatchObject({
      layer: "structure",
      cell: { x: 2, y: 2, z: 0 },
    });
  });

  it("keeps the camera on whole logical pixels", () => {
    expect(Number.isInteger(HARNESS_CAMERA.x)).toBe(true);
    expect(Number.isInteger(HARNESS_CAMERA.y)).toBe(true);
  });
});

describe("pickIn", () => {
  const entry = (source: "canon" | "draft" | "approved", id: string) =>
    ({
      source,
      id,
      assetId: "zeus-portrait",
      kind: "sprite",
      ok: true,
    }) as never;
  const two = [entry("draft", "draft-a"), entry("draft", "draft-b")];

  it("returns the wanted record when it is listed", () => {
    expect(pickIn(two, { source: "draft", id: "draft-b" })).toEqual({
      source: "draft",
      id: "draft-b",
    });
  });

  it("returns nothing, not the first record, when the wanted id is not listed", () => {
    expect(
      pickIn(two, { source: "draft", id: "zeus-portrait" }),
    ).toBeUndefined();
    expect(pickIn(two, { source: "approved", id: "draft-a" })).toBeUndefined();
  });

  it("takes the first record only when nothing is wanted", () => {
    expect(pickIn(two, undefined)).toEqual({ source: "draft", id: "draft-a" });
    expect(pickIn([], undefined)).toBeUndefined();
  });
});

describe("published preview keys", () => {
  const spriteEntry = {
    source: "canon",
    id: "zeus-sprite",
    assetId: "zeus-sprite",
    kind: "sprite",
    state: "canon",
    ok: true,
    animations: [
      { state: "idle", direction: "south" },
      { state: "seated", direction: "south" },
      { state: "act", direction: "south", ability: "thunderbolt" },
    ],
    expressions: [],
  };

  it("offers only directions and abilities that are published for a state", async () => {
    const api = await import("./layout");
    const helpers = api as typeof api & {
      directionsForState?: (entry: never, state: string) => string[];
      abilitiesForKey?: (
        entry: never,
        state: string,
        direction: string,
      ) => string[];
      firstAnimationForState?: (entry: never, state: string) => unknown;
      animationKeyMessage?: (
        entry: never,
        key: { state: string; direction: string; ability?: string },
      ) => string | undefined;
      isAnimationKey?: (
        entry: never,
        key: { state: string; direction: string; ability?: string },
      ) => boolean;
    };
    expect(helpers.directionsForState).toBeFunction();
    expect(helpers.abilitiesForKey).toBeFunction();
    expect(helpers.firstAnimationForState).toBeFunction();
    expect(helpers.animationKeyMessage).toBeFunction();
    expect(helpers.isAnimationKey).toBeFunction();
    if (
      helpers.directionsForState === undefined ||
      helpers.abilitiesForKey === undefined ||
      helpers.firstAnimationForState === undefined ||
      helpers.animationKeyMessage === undefined ||
      helpers.isAnimationKey === undefined
    )
      return;

    expect(helpers.directionsForState(spriteEntry as never, "act")).toEqual([
      "south",
    ]);
    expect(helpers.firstAnimationForState(spriteEntry as never, "act")).toEqual(
      { state: "act", direction: "south", ability: "thunderbolt" },
    );
    expect(
      helpers.abilitiesForKey(spriteEntry as never, "act", "south"),
    ).toEqual(["thunderbolt"]);
    expect(
      helpers.isAnimationKey(spriteEntry as never, {
        state: "act",
        direction: "north",
      }),
    ).toBe(false);
    expect(
      helpers.animationKeyMessage(spriteEntry as never, {
        state: "act",
        direction: "north",
      }),
    ).toBe("not in this asset");
    const missing = harnessItems({
      subject: { source: "canon", id: "zeus-sprite" },
      portrait: undefined,
      state: "act",
      direction: "north",
      ability: undefined,
      expression: "neutral",
      animations: spriteEntry.animations,
      companion: false,
    });
    expect(missing.some((item) => item.id === "subject")).toBe(false);
  });

  it("switching to a portrait selects its first expression without sprite keys", async () => {
    const api = await import("./layout");
    const helpers = api as typeof api & {
      firstPreviewKey?: (entry: never) => unknown;
    };
    expect(helpers.firstPreviewKey).toBeFunction();
    if (helpers.firstPreviewKey === undefined) return;

    const portraitEntry = {
      ...spriteEntry,
      kind: "portrait",
      expressions: [
        "neutral",
        "pleased",
        "angry",
        "grieving",
        "scheming",
        "awed",
      ],
    };
    const selected = helpers.firstPreviewKey({
      ...portraitEntry,
    } as never);
    expect(selected).toEqual({ kind: "portrait", expression: "neutral" });
    expect(helpers.firstPreviewKey(spriteEntry as never)).toEqual({
      kind: "sprite",
      state: "idle",
      direction: "south",
    });
    const portraitOnly = harnessItems({
      subject: undefined,
      portrait: { source: "canon", id: "zeus-portrait" },
      state: "act",
      direction: "north",
      ability: "thunderbolt",
      expression: "neutral",
      animations: spriteEntry.animations,
      expressions: portraitEntry.expressions,
      companion: false,
    });
    expect(portraitOnly.some((item) => item.id === "subject")).toBe(false);
    expect(expressionKeyMessage(portraitEntry as never, "unpublished")).toBe(
      "not in this asset",
    );
    const missingExpression = harnessItems({
      subject: undefined,
      portrait: { source: "canon", id: "zeus-portrait" },
      state: "",
      direction: "",
      expression: "unpublished",
      expressions: portraitEntry.expressions,
      companion: false,
    });
    expect(missingExpression.some((item) => item.id === "portrait")).toBe(
      false,
    );
  });

  it("plays, pauses, steps, and scrubs using an injected clock and manifest timing", async () => {
    const api = await import("./layout");
    const helpers = api as typeof api & {
      createPlaybackClock?: (
        durations: readonly number[],
        loopStart: number | undefined,
        now: () => number,
      ) => {
        frame: () => number;
        elapsed: () => number;
        playing: () => boolean;
        play: () => void;
        pause: () => void;
        step: (amount?: number) => void;
        scrub: (frame: number) => void;
      };
    };
    expect(helpers.createPlaybackClock).toBeFunction();
    if (helpers.createPlaybackClock === undefined) return;

    let now = 0;
    const clock = helpers.createPlaybackClock(
      [83, 100, 83, 83, 100],
      undefined,
      () => now,
    );
    clock.play();
    expect(clock.playing()).toBe(true);
    expect(clock.frame()).toBe(0);
    now = 83;
    expect(clock.frame()).toBe(1);
    now = 183;
    expect(clock.frame()).toBe(2);
    now = 266;
    expect(clock.frame()).toBe(3);
    now = 349;
    expect(clock.frame()).toBe(4);
    clock.pause();
    now = 5000;
    expect(clock.frame()).toBe(4);
    expect(clock.elapsed()).toBe(349);

    clock.scrub(2);
    expect(clock.playing()).toBe(false);
    expect(clock.frame()).toBe(2);
    expect(clock.elapsed()).toBe(224.5);
    now = 5000;
    expect(clock.frame()).toBe(2);
    clock.step(1);
    expect(clock.frame()).toBe(3);
  });

  it("loops only frames 2 through 4 after the first pass", async () => {
    const api = await import("./layout");
    const helpers = api as typeof api & {
      createPlaybackClock?: (
        durations: readonly number[],
        loopStart: number | undefined,
        now: () => number,
      ) => { frame: () => number; play: () => void };
    };
    expect(helpers.createPlaybackClock).toBeFunction();
    if (helpers.createPlaybackClock === undefined) return;

    let now = 0;
    const clock = helpers.createPlaybackClock(
      [83, 100, 83, 83, 100],
      2,
      () => now,
    );
    clock.play();
    now = 449;
    expect(clock.frame()).toBe(2);
    now = 532;
    expect(clock.frame()).toBe(3);
    now = 615;
    expect(clock.frame()).toBe(4);
    now = 715;
    expect(clock.frame()).toBe(2);
  });
});

describe("the selection across a listing refresh", () => {
  const sprite = (animations: readonly object[]) =>
    ({
      source: "canon",
      id: "zeus-sprite",
      assetId: "zeus-sprite",
      kind: "sprite",
      state: "canon",
      ok: true,
      animations,
      expressions: [],
    }) as never;
  const all = [
    { state: "idle", direction: "south" },
    { state: "seated", direction: "south" },
    { state: "act", direction: "south", ability: "thunderbolt" },
  ];
  const act = { state: "act", direction: "south", ability: "thunderbolt" };

  it("a new listing object for the same entry keeps the selected key while it is still published", () => {
    const first = sprite(all);
    const refreshed = sprite([...all]);

    expect(refreshed).not.toBe(first);
    expect(spriteKeyAfterListing(refreshed, entryKey(first), act)).toEqual(act);
  });

  it("falls back to the first key when the entry changed or the key is no longer published", () => {
    const other = { ...(sprite(all) as object), id: "zeus-other" } as never;
    expect(spriteKeyAfterListing(other, "canon:zeus-sprite", act)).toEqual({
      state: "idle",
      direction: "south",
    });
    const trimmed = sprite(all.slice(0, 2));
    expect(spriteKeyAfterListing(trimmed, entryKey(trimmed), act)).toEqual({
      state: "idle",
      direction: "south",
    });
    expect(spriteKeyAfterListing(undefined, undefined, act)).toBeUndefined();
  });

  it("an expression is held across a refresh and reset when its entry or the expression goes", () => {
    const portraitEntry = (expressions: readonly string[]) =>
      ({
        source: "canon",
        id: "zeus-portrait",
        assetId: "zeus-portrait",
        kind: "portrait",
        state: "canon",
        ok: true,
        animations: [],
        expressions,
      }) as never;
    const six = ["neutral", "pleased", "angry", "grieving", "scheming", "awed"];

    expect(
      expressionAfterListing(
        portraitEntry([...six]),
        "canon:zeus-portrait",
        "angry",
      ),
    ).toBe("angry");
    expect(
      expressionAfterListing(
        portraitEntry(six.slice(0, 2)),
        "canon:zeus-portrait",
        "angry",
      ),
    ).toBe("neutral");
    expect(
      expressionAfterListing(portraitEntry([...six]), "canon:other", "angry"),
    ).toBe("neutral");
  });
});

describe("stepping past the last frame", () => {
  const durations = [83, 100, 83, 83, 100];

  it("wraps to the loop start of a looping clip instead of stalling on the last frame", () => {
    const clock = createPlaybackClock(durations, 2, () => 0);
    clock.scrub(4);
    expect(clock.frame()).toBe(4);

    clock.step(1);

    expect(clock.frame()).toBe(2);
    expect(clock.playing()).toBe(false);
  });

  it("wraps to frame 0 when there is no loop, and a step backwards or a scrub still clamps", () => {
    const clock = createPlaybackClock(durations, undefined, () => 0);
    clock.scrub(4);
    clock.step(1);
    expect(clock.frame()).toBe(0);

    clock.step(-1);
    expect(clock.frame()).toBe(0);
    clock.scrub(99);
    expect(clock.frame()).toBe(4);
    clock.scrub(-3);
    expect(clock.frame()).toBe(0);
  });

  it("a single-frame clip stays on its frame", () => {
    const clock = createPlaybackClock([100], undefined, () => 0);
    clock.step(1);
    expect(clock.frame()).toBe(0);
  });
});

describe("the playback timing a resolved asset gives the clock", () => {
  it("is the manifest's own frame durations: the Zeus act, 83/100/83/83/100 ms, with no loop", () => {
    const frames = [83, 100, 83, 83, 100].map((durationMs) => ({ durationMs }));

    expect(clockTiming({ frames })).toEqual({
      durations: [83, 100, 83, 83, 100],
      loopStart: undefined,
    });
  });

  it("carries the loop start, and a clip with no frames has no timing", () => {
    const frames = [83, 100, 83, 83, 100].map((durationMs) => ({ durationMs }));

    expect(clockTiming({ frames, loopStart: 2 })).toEqual({
      durations: [83, 100, 83, 83, 100],
      loopStart: 2,
    });
    expect(clockTiming({ frames: [] })).toEqual({
      durations: [],
      loopStart: undefined,
    });
  });

  it("drives the clock to the manifest's frames: frame 3 at 183 ms of the act, and frame 2 after the first pass with loopStart 2", () => {
    let now = 0;
    const timing = clockTiming({
      frames: [83, 100, 83, 83, 100].map((durationMs) => ({ durationMs })),
      loopStart: 2,
    });
    const clock = createPlaybackClock(
      timing.durations,
      timing.loopStart,
      () => now,
    );
    clock.play();
    now = 183;
    expect(clock.frame()).toBe(2);
    now = 449;
    expect(clock.frame()).toBe(2);
  });
});

describe("following the selected clip's timing", () => {
  const zeus = { source: "canon", id: "zeus-sprite" } as const;
  const request = {
    ...zeus,
    state: "idle",
    direction: "south",
  } as const;
  const clip = (durationMs: number, count = 4, loopStart?: number) => ({
    kind: "frames" as const,
    asset: {
      frames: Array.from({ length: count }, () => ({ durationMs })),
      ...(loopStart === undefined ? {} : { loopStart }),
    },
  });

  /** A source whose clip can be replaced, and whose change events a test fires. */
  function fakeSource(initial: ReturnType<typeof clip>) {
    let current = initial;
    const listeners = new Set<(change: never) => void>();
    let resolves = 0;
    return {
      source: {
        resolve: async () => {
          resolves += 1;
          return current as never;
        },
        subscribe: (listener: (change: never) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      replace: (next: ReturnType<typeof clip>) => {
        current = next;
      },
      emit: (change: {
        changed: readonly { source: string; id: string }[];
        listing: boolean;
      }) => {
        for (const listener of listeners) listener(change as never);
      },
      listeners: () => listeners.size,
      resolves: () => resolves,
    };
  }

  function follow(world: ReturnType<typeof fakeSource>, req = request) {
    let now = 0;
    const playback = createPlaybackClock([], undefined, () => now);
    const seen: {
      durations: readonly number[];
      frame: number;
      playing: boolean;
    }[] = [];
    const stop = followClipTiming({
      source: world.source as never,
      request: req as never,
      playback,
      onTiming: (durations, frame, playing) =>
        seen.push({ durations, frame, playing }),
    });
    return { playback, seen, stop, advance: (ms: number) => (now += ms) };
  }

  const settle = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };

  it("takes the selected clip's timing from the source when it is selected", async () => {
    const world = fakeSource(clip(167));
    const { playback, seen } = follow(world);
    await settle();

    expect(seen.at(-1)?.durations).toEqual([167, 167, 167, 167]);
    playback.scrub(2);
    expect(playback.elapsed()).toBe(167 * 2 + 83.5);
  });

  it("a timing-only change (same keys, listing: false) refreshes the frame indicator, Step and Scrub, and holds the selected frame", async () => {
    const world = fakeSource(clip(167));
    const { playback, seen } = follow(world);
    await settle();
    playback.scrub(1);

    // A new revision: idle's four 167 ms frames become four 333 ms frames.
    world.replace(clip(333));
    world.emit({ changed: [zeus], listing: false });
    await settle();

    expect(seen.at(-1)?.durations).toEqual([333, 333, 333, 333]);
    // The paused frame is kept, on the new timing.
    expect(seen.at(-1)?.frame).toBe(1);
    expect(playback.frame()).toBe(1);
    playback.scrub(2);
    // Midpoint of frame 2 on the new timing, not 250.5 ms of the old one.
    expect(playback.elapsed()).toBe(333 * 2 + 166.5);
    expect(playback.frame()).toBe(2);
    playback.step(1);
    expect(playback.frame()).toBe(3);
    playback.step(1);
    expect(playback.frame()).toBe(0);
  });

  it("a changed frame count or loop start is taken too, and a change that is not this clip's is ignored", async () => {
    const world = fakeSource(clip(100, 4));
    const { playback, seen } = follow(world);
    await settle();
    const resolves = world.resolves();

    world.emit({ changed: [{ source: "canon", id: "other" }], listing: false });
    await settle();
    expect(world.resolves()).toBe(resolves);

    world.replace(clip(100, 6, 3));
    world.emit({ changed: [zeus], listing: true });
    await settle();

    expect(seen.at(-1)?.durations).toHaveLength(6);
    playback.scrub(5);
    playback.step(1);
    expect(playback.frame()).toBe(3);
  });

  it("a playing clip keeps playing through the refresh, and a failed refresh leaves no stale timing", async () => {
    const world = fakeSource(clip(167));
    const { playback, seen } = follow(world);
    await settle();
    playback.play();

    world.replace(clip(333));
    world.emit({ changed: [zeus], listing: false });
    await settle();
    expect(playback.playing()).toBe(true);

    world.source.resolve = async () => {
      throw new Error("the source is gone");
    };
    world.emit({ changed: [zeus], listing: false });
    await settle();
    expect(seen.at(-1)?.durations).toEqual([]);
  });

  describe("input that arrives while a refresh is still resolving", () => {
    /** A refresh whose reply the test releases: what the owner does in between lands first. */
    function pendingRefresh() {
      const world = fakeSource(clip(167));
      const followed = follow(world);
      return { world, ...followed };
    }

    async function startRefresh(
      world: ReturnType<typeof fakeSource>,
      next: ReturnType<typeof clip>,
    ) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      world.source.resolve = async () => {
        await gate;
        return next as never;
      };
      world.emit({ changed: [zeus], listing: false });
      await settle();
      return release;
    }

    it("Play pressed while the resolve is pending is not undone by the reply, so the clock still plays and the button's Pause is true", async () => {
      const { world, playback, seen } = pendingRefresh();
      await settle();
      playback.scrub(1);
      expect(playback.playing()).toBe(false);

      const release = await startRefresh(world, clip(333));
      playback.play();
      release();
      await settle();

      expect(playback.playing()).toBe(true);
      // The UI is told the same thing, so its button keeps saying Pause.
      expect(seen.at(-1)?.playing).toBe(true);
    });

    it("Scrub made while the resolve is pending is kept by the reply, on the new timing", async () => {
      const { world, playback, seen } = pendingRefresh();
      await settle();
      playback.scrub(1);

      const release = await startRefresh(world, clip(333, 6));
      playback.scrub(3);
      release();
      await settle();

      expect(playback.playing()).toBe(false);
      expect(playback.frame()).toBe(3);
      expect(playback.elapsed()).toBe(333 * 3 + 166.5);
      expect(seen.at(-1)?.durations).toHaveLength(6);
      expect(seen.at(-1)?.frame).toBe(3);
    });

    it("a Scrub past the new, shorter clip is clamped to its last frame", async () => {
      const { world, playback } = pendingRefresh();
      await settle();

      const release = await startRefresh(world, clip(333, 3));
      playback.scrub(3);
      release();
      await settle();

      expect(playback.frame()).toBe(2);
      expect(playback.playing()).toBe(false);
    });

    it("a reply that lands while paused still holds the frame the clock is on then", async () => {
      const { world, playback } = pendingRefresh();
      await settle();
      playback.scrub(2);

      const release = await startRefresh(world, clip(333));
      release();
      await settle();

      expect(playback.frame()).toBe(2);
      expect(playback.playing()).toBe(false);
    });
  });

  it("stopping unsubscribes, and a refresh that was in flight when it stopped changes nothing", async () => {
    const world = fakeSource(clip(167));
    const { playback, seen, stop } = follow(world);
    await settle();
    expect(world.listeners()).toBe(1);
    const before = seen.length;

    world.replace(clip(333));
    world.emit({ changed: [zeus], listing: false });
    stop();
    await settle();

    expect(world.listeners()).toBe(0);
    expect(seen.length).toBe(before);
    expect(playback.elapsed()).toBe(0);
  });
});
