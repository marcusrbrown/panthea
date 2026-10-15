import { describe, expect, it } from "bun:test";
import { resolveAsset } from "@panthea/assets";
import { tileMaskAt, tileOffsetAt } from "@panthea/assets/browser";
import {
  bottomVertex,
  canvasMetrics,
  composeScene,
  latticeOrigin,
  type SceneEntity,
  STRUCTURE_ANCHORS,
  spriteOrigin,
  ZOOMS,
} from "@panthea/renderer";
import { tileFixture } from "../../../../packages/assets/test/fixtures/tile";
import { canon } from "../../test/canon-kit";
import {
  LOGICAL_HEIGHT,
  LOGICAL_SIZE,
  LOGICAL_WIDTH,
  type PreviewItem,
} from "../renderer/preview";
import {
  clockTiming,
  createPlaybackClock,
  entryKey,
  expressionAfterListing,
  expressionKeyMessage,
  followClipTiming,
  GROUND_GRID,
  GROUND_ORIGIN,
  HARNESS_CAMERA,
  harnessItems,
  harnessSubject,
  MISSING_GROUND,
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

  it("lays no flat ground of its own: with no tile set chosen it asks for one missing set, once", () => {
    const ground = items.filter((item) => item.kind === "tile");
    expect(ground).toHaveLength(1);
    expect(ground[0]).toMatchObject({ request: MISSING_GROUND });
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

  it("draws a placeholder mortal for scale, and the published house two depth steps behind the subject", () => {
    expect(byId(items, "mortal")).toMatchObject({
      layer: "actor",
      request: MISSING_SPRITE,
    });
    expect(byId(items, "structure")).toMatchObject({
      kind: "sprite",
      layer: "structure",
      cell: { x: -3, y: 0, z: 0 },
      footprint: { w: 4, h: 3 },
      request: {
        source: "canon",
        id: "greek-house",
        state: "intact",
        direction: "south",
      },
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

  it("swaps the layers and shares the subject's bottom cell when the house is to draw in front", () => {
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
      cell: { x: -1, y: 0, z: 0 },
      footprint: { w: 4, h: 3 },
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

describe("a rendered god-tall sprite in the preview (R16, R17)", () => {
  // The retro Zeus: a 112x96 cell, pivot (56, 78), a 16-frame walk at 50 ms a frame.
  const CELL = { w: 112, h: 96 };
  const PIVOT = { x: 56, y: 78 };
  const walk = (durationMs = 50) => ({
    frames: Array.from({ length: 16 }, () => ({ durationMs })),
    loopStart: 0,
  });

  const items = harnessItems({
    subject: { source: "draft", id: "zeus-retro" },
    portrait: undefined,
    state: "walk",
    direction: "south",
    ability: undefined,
    expression: "neutral",
    animations: [{ state: "walk", direction: "south" }],
    companion: false,
  });
  const subject = byId(items, "subject");

  it("places the 112x96 cell with its pivot on the bottom vertex of the subject's tile", () => {
    if (subject.kind !== "sprite") throw new Error("not a sprite");
    const footprint = subject.footprint ?? { w: 1, h: 1 };
    const vertex = bottomVertex(subject.cell, footprint);
    const origin = spriteOrigin(subject.cell, footprint, PIVOT);
    if (!vertex.ok || !origin.ok) throw new Error("not placeable");
    expect(origin.value).toEqual({
      x: vertex.value.x - PIVOT.x,
      y: vertex.value.y - PIVOT.y,
    });
    // The cell's own (56, 78) lands exactly on the vertex.
    expect({
      x: origin.value.x + PIVOT.x,
      y: origin.value.y + PIVOT.y,
    }).toEqual(vertex.value);
    // And the whole 112x96 cell is inside the harness viewport, on whole logical pixels.
    const left = origin.value.x - HARNESS_CAMERA.x;
    const top = origin.value.y - HARNESS_CAMERA.y;
    for (const edge of [left, top, left + CELL.w, top + CELL.h])
      expect(Number.isInteger(edge)).toBe(true);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left + CELL.w).toBeLessThanOrEqual(LOGICAL_WIDTH);
    expect(top + CELL.h).toBeLessThanOrEqual(LOGICAL_HEIGHT);
  });

  it("draws at integer zoom only, so the 112x96 cell is 112z x 96z device pixels, with the mortal and the house for scale", () => {
    expect([...ZOOMS]).toEqual([2, 3, 4]);
    for (const zoom of ZOOMS) {
      expect(Number.isInteger(zoom)).toBe(true);
      const metrics = canvasMetrics(LOGICAL_SIZE, zoom, 1);
      expect(metrics.backingWidth).toBe(LOGICAL_WIDTH * zoom);
      expect(metrics.backingHeight).toBe(LOGICAL_HEIGHT * zoom);
      // The cell's device size is a whole multiple: no fractional scale of a pixel-art cell.
      expect((CELL.w * metrics.backingWidth) % LOGICAL_WIDTH).toBe(0);
      expect(CELL.w * zoom).toBe(
        (CELL.w * metrics.backingWidth) / LOGICAL_WIDTH,
      );
    }
    // The context is still there around a rendered subject.
    expect(byId(items, "mortal")).toMatchObject({ request: MISSING_SPRITE });
    expect(byId(items, "structure")).toMatchObject({
      request: { id: "greek-house" },
    });
    expect(items.filter((item) => item.kind === "tile")).toHaveLength(1);
  });

  it("plays the 16-frame clip at the manifest's timing: frame n at 50 n ms, wrapping to the loop start after 800 ms", () => {
    let now = 0;
    const timing = clockTiming(walk());
    expect(timing.durations).toHaveLength(16);
    const clock = createPlaybackClock(
      timing.durations,
      timing.loopStart,
      () => now,
    );
    clock.play();
    for (const [at, frame] of [
      [0, 0],
      [49, 0],
      [50, 1],
      [375, 7],
      [750, 15],
      [799, 15],
      [800, 0],
      [850, 1],
    ] as const) {
      now = at;
      expect(clock.frame()).toBe(frame);
    }
  });

  const settle = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };

  it("live-reloads a re-rendered clip through a deterministic trigger: the new timing is taken, the paused frame held, and an unrelated change is ignored", async () => {
    const entry = { source: "draft", id: "zeus-retro" } as const;
    let current = { kind: "frames" as const, asset: walk(50) };
    const listeners = new Set<(change: never) => void>();
    let resolves = 0;
    const source = {
      resolve: async () => {
        resolves += 1;
        return current as never;
      },
      subscribe: (listener: (change: never) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const emit = (change: {
      changed: readonly { source: string; id: string }[];
      listing: boolean;
    }) => {
      for (const listener of listeners) listener(change as never);
    };
    const now = 0;
    const playback = createPlaybackClock([], undefined, () => now);
    const seen: (readonly number[])[] = [];
    const stop = followClipTiming({
      source: source as never,
      request: { ...entry, state: "walk", direction: "south" } as never,
      playback,
      onTiming: (durations) => seen.push(durations),
    });
    await settle();
    expect(seen.at(-1)).toEqual(Array.from({ length: 16 }, () => 50));
    playback.scrub(5);

    // The asset is re-rendered and republished at 100 ms a frame.
    current = { kind: "frames", asset: walk(100) };
    const before = resolves;
    emit({ changed: [{ source: "draft", id: "another" }], listing: false });
    await settle();
    expect(resolves).toBe(before);
    emit({ changed: [entry], listing: false });
    await settle();

    expect(seen.at(-1)).toEqual(Array.from({ length: 16 }, () => 100));
    expect(playback.frame()).toBe(5);
    stop();
    expect(listeners.size).toBe(0);
  });
});

describe("the structures in the scene", () => {
  const scene = (extra: Partial<Parameters<typeof harnessItems>[0]> = {}) =>
    harnessItems({
      subject: zeus,
      portrait: undefined,
      state: "idle",
      direction: "south",
      expression: "neutral",
      companion: false,
      ...extra,
    });
  const ids = (list: readonly PreviewItem[]) => list.map((item) => item.id);

  it("draws the published Greek house and Old Oak, both intact, with no fire and no bolt until asked", () => {
    const list = scene();

    expect(byId(list, "structure")).toMatchObject({
      request: { source: "canon", id: "greek-house", state: "intact" },
    });
    expect(byId(list, "tree")).toMatchObject({
      kind: "sprite",
      layer: "structure",
      cell: { x: 3, y: 0, z: 0 },
      footprint: { w: 1, h: 1 },
      request: {
        source: "canon",
        id: "oak-tree",
        state: "intact",
        direction: "south",
      },
    });
    expect(ids(list)).not.toContain("structure-fire");
    expect(ids(list)).not.toContain("tree-fire");
    expect(ids(list)).not.toContain("strike");
  });

  it("gives the chosen state to the chosen structure only; the other stays intact", () => {
    const burningTree = scene({ structure: { art: "tree", state: "burning" } });
    expect(byId(burningTree, "tree")).toMatchObject({
      request: { id: "oak-tree", state: "damaged" },
    });
    expect(byId(burningTree, "structure")).toMatchObject({
      request: { id: "greek-house", state: "intact" },
    });
    expect(ids(burningTree)).toContain("tree-fire");
    expect(ids(burningTree)).not.toContain("structure-fire");

    const ruinedHouse = scene({
      structure: { art: "building", state: "ruin" },
    });
    expect(byId(ruinedHouse, "structure")).toMatchObject({
      request: { state: "ruin" },
    });
    expect(byId(ruinedHouse, "tree")).toMatchObject({
      request: { state: "intact" },
    });
    expect(ids(ruinedHouse).filter((id) => id.endsWith("-fire"))).toEqual([]);
  });

  it("stands the fire on the burning structure's anchor, on the structure's layer, sorting after it", () => {
    const list = scene({ structure: { art: "building", state: "burning" } });
    const house = byId(list, "structure");
    const fire = byId(list, "structure-fire");

    expect(fire).toMatchObject({
      kind: "effect",
      layer: "structure",
      // The house's bottom cell: its origin cell moved by the footprint.
      cell: { x: 0, y: 2, z: 0 },
      offset: STRUCTURE_ANCHORS.building.fire,
      request: { source: "canon", id: "fire", animation: "burn" },
    });
    expect(fire?.kind === "effect" && fire.elapsedMs).toBeFalsy();
    expect((house?.id ?? "") < (fire?.id ?? "")).toBe(true);
  });

  it("puts the fire and the bolt on whichever layer and cell the structure is on when it draws in front", () => {
    const list = scene({
      occlusion: "structure-front",
      structure: { art: "building", state: "burning" },
      bolt: { animation: "calm", elapsedMs: () => 0 },
    });

    expect(byId(list, "structure-fire")).toMatchObject({
      layer: "actor",
      cell: { x: 2, y: 2, z: 0 },
    });
    expect(byId(list, "strike")).toMatchObject({
      kind: "effect",
      layer: "effect",
      cell: { x: 2, y: 2, z: 0 },
      offset: STRUCTURE_ANCHORS.building.strike,
      request: { source: "canon", id: "lightning-strike", animation: "calm" },
    });
  });

  it("aims the bolt at the chosen structure, with the clock it was given", () => {
    const clock = () => 42;
    const list = scene({
      structure: { art: "tree", state: "intact" },
      bolt: { animation: "full", elapsedMs: clock },
    });
    const bolt = byId(list, "strike");

    expect(bolt).toMatchObject({
      cell: { x: 3, y: 0, z: 0 },
      offset: STRUCTURE_ANCHORS.tree.strike,
      request: { animation: "full" },
    });
    expect(bolt?.kind === "effect" && bolt.elapsedMs).toBe(clock);
  });

  it("declares the footprints the published art has, for the placeholder when the art is missing", () => {
    for (const [id, item] of [
      ["greek-house", byId(scene(), "structure")],
      ["oak-tree", byId(scene(), "tree")],
    ] as const) {
      const resolved = canon({ spriteId: id, state: "intact" });
      if (resolved.source !== "canon") throw new Error("not canon");
      expect(item.kind === "sprite" && item.footprint).toEqual(
        resolved.footprint,
      );
    }
  });

  it("composes every item without a refusal, the house behind the subject and the fire and bolt over their structure", () => {
    const list = scene({
      structure: { art: "building", state: "burning" },
      bolt: { animation: "full", elapsedMs: () => 0 },
    });
    const { instances, refused } = composeScene(
      list.flatMap((item): SceneEntity[] => {
        if (item.kind === "tile" || item.kind === "flat") return [];
        if (item.request.source !== "canon") return [];
        if (item.id === "subject" || item.id === "mortal") return [];
        const resolution = canon({
          spriteId: item.request.id,
          ...(item.request.state === undefined
            ? {}
            : { state: item.request.state }),
          ...(item.request.direction === undefined
            ? {}
            : { direction: item.request.direction }),
          ...(item.request.animation === undefined
            ? {}
            : { animation: item.request.animation }),
        });
        return [
          item.kind === "effect"
            ? {
                kind: "sprite",
                id: item.id,
                layer: item.layer,
                cell: item.cell,
                offset: item.offset,
                resolution,
              }
            : {
                kind: "sprite",
                id: item.id,
                layer: item.layer,
                cell: item.cell,
                ...(item.footprint === undefined
                  ? {}
                  : { footprint: item.footprint }),
                resolution,
              },
        ];
      }),
    );

    expect(refused).toEqual([]);
    const order = instances
      .filter((instance) => instance.layer !== "ground")
      .map((instance) => instance.id);
    expect(order.indexOf("structure")).toBeLessThan(
      order.indexOf("structure-fire"),
    );
    expect(order.indexOf("structure-fire")).toBeLessThan(
      order.indexOf("strike"),
    );
    // Every drawn cell of the scene's art lies inside the 480x270 viewport.
    for (const instance of instances) {
      if (instance.layer === "ground") continue;
      const left = instance.x - HARNESS_CAMERA.x;
      const top = instance.y - HARNESS_CAMERA.y;
      expect(left, instance.id).toBeGreaterThanOrEqual(0);
      expect(left + instance.w, instance.id).toBeLessThanOrEqual(LOGICAL_WIDTH);
      expect(top, instance.id).toBeGreaterThanOrEqual(0);
      expect(top + instance.h, instance.id).toBeLessThanOrEqual(LOGICAL_HEIGHT);
    }
  });
});

describe("the harness ground", () => {
  const ground = { source: "draft", id: "grass-flagstone-pack" } as const;
  const choice = { selection: ground, period: 4 };
  const scene = (over: Partial<Parameters<typeof harnessItems>[0]> = {}) =>
    harnessItems({
      subject: zeus,
      portrait: undefined,
      state: "idle",
      direction: "south",
      ability: undefined,
      expression: "neutral",
      companion: false,
      ground: choice,
      ...over,
    });
  const tiles = (items: readonly PreviewItem[]) =>
    items.flatMap((item) => (item.kind === "tile" ? [item] : []));

  it("is a 6x6 grid of terrain, so 7x7 lattice points are drawn, each a tile of the chosen set", () => {
    expect(GROUND_GRID).toHaveLength(6);
    for (const row of GROUND_GRID) expect(row).toHaveLength(6);
    const ground = tiles(scene());
    expect(ground).toHaveLength(49);
    expect(new Set(ground.map((item) => item.id)).size).toBe(49);
    for (const tile of ground)
      expect(tile.request).toMatchObject({
        source: "draft",
        id: "grass-flagstone-pack",
      });
    expect(ground.map((tile) => [tile.point.x, tile.point.y]).sort()).toEqual(
      Array.from({ length: 49 }, (_, i) => [
        GROUND_ORIGIN + (i % 7),
        GROUND_ORIGIN + Math.floor(i / 7),
      ]).sort(),
    );
  });

  it("uses all 16 masks, each lattice point's mask read from the grid by the shared maths", () => {
    const ground = tiles(scene());
    const seen = new Set<number>();
    for (const tile of ground) {
      const gx = tile.point.x - GROUND_ORIGIN;
      const gy = tile.point.y - GROUND_ORIGIN;
      expect(tile.request.mask).toBe(tileMaskAt(GROUND_GRID, gx, gy));
      seen.add(tile.request.mask as number);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i),
    );
  });

  it("cycles the offset: each tile's offset is its place in the period plus the cycle, and sixteen cycles show every offset", () => {
    const first = new Map<string, Set<number>>();
    for (let cycle = 0; cycle < 16; cycle += 1) {
      for (const tile of tiles(scene({ groundCycle: cycle }))) {
        const offset = tile.request.offset as number;
        expect(offset).toBe(
          (tileOffsetAt(tile.point.x, tile.point.y, 4) + cycle) % 16,
        );
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(16);
        first.set(tile.id, (first.get(tile.id) ?? new Set()).add(offset));
      }
    }
    for (const offsets of first.values()) expect(offsets.size).toBe(16);
    // No cycle given is the first.
    expect(tiles(scene()).map((t) => t.request.offset)).toEqual(
      tiles(scene({ groundCycle: 0 })).map((t) => t.request.offset),
    );
  });

  it("takes the offsets from the set's own period", () => {
    for (const period of [1, 2, 3]) {
      for (const tile of tiles(
        scene({ ground: { selection: ground, period }, groundCycle: 5 }),
      ))
        expect(tile.request.offset as number).toBeLessThan(period * period);
    }
  });

  it("fits the 480x270 viewport: every tile's box lies inside it, at the camera the scene is built for", () => {
    for (const tile of tiles(scene())) {
      const box = latticeOrigin(tile.point.x, tile.point.y);
      if (!box.ok) throw new Error(box.detail);
      expect(box.value.x - HARNESS_CAMERA.x, tile.id).toBeGreaterThanOrEqual(0);
      expect(box.value.x + 64 - HARNESS_CAMERA.x, tile.id).toBeLessThanOrEqual(
        LOGICAL_WIDTH,
      );
      expect(box.value.y - HARNESS_CAMERA.y, tile.id).toBeGreaterThanOrEqual(0);
      expect(box.value.y + 32 - HARNESS_CAMERA.y, tile.id).toBeLessThanOrEqual(
        LOGICAL_HEIGHT,
      );
    }
  });

  it("asks for one missing set, which fails in the scene, when no tile set is chosen; the rest of the scene is unchanged", () => {
    const missing = scene({ ground: undefined });
    expect(tiles(missing)).toHaveLength(1);
    expect(tiles(missing)[0]).toMatchObject({
      id: "ground",
      request: MISSING_GROUND,
    });
    expect(missing.filter((item) => item.kind !== "tile")).toEqual(
      scene().filter((item) => item.kind !== "tile"),
    );
  });

  it("composes against a real tile set with no refusal, every tile on the ground layer under the actors", () => {
    const tile = tileFixture();
    const snapshot = {
      entries: new Map([
        [
          tile.manifest.id,
          {
            assetId: tile.manifest.id,
            revision: tile.manifest.atlas.blob,
            manifest: tile.manifest,
          },
        ],
      ]),
    };
    const entities = tiles(scene({ groundCycle: 3 })).map(
      (item): SceneEntity => {
        const resolution = resolveAsset(snapshot, {
          spriteId: "grass-flagstone",
          tile: {
            mask: item.request.mask as number,
            offset: item.request.offset as number,
          },
        });
        if (resolution.source !== "canon")
          throw new Error(`${item.id} did not resolve`);
        return { kind: "tile", id: item.id, point: item.point, resolution };
      },
    );
    const { instances, refused } = composeScene(entities);
    expect(refused).toEqual([]);
    expect(instances).toHaveLength(49);
    expect(instances.every((i) => i.layer === "ground")).toBe(true);
  });
});
