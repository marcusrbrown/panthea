import { describe, expect, it } from "bun:test";
import type { PreviewItem } from "../renderer/preview";
import {
  expressionKeyMessage,
  HARNESS_CAMERA,
  harnessItems,
  MISSING_SPRITE,
  PORTRAIT_PANEL_AT,
  pickIn,
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
