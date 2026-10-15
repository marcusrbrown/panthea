import { describe, expect, it } from "bun:test";
import { EFFECTS_MODES, type EffectsMode } from "@panthea/renderer";
import { canon } from "../../test/canon-kit";
import { BUILDING_STATES, lookOf } from "./building";
import { harnessItems } from "./layout";
import { createStrikeScene } from "./strike";

/** The published strike's frame durations for a mode, from its committed manifest. */
function published(mode: EffectsMode): readonly number[] {
  const strike = canon({ spriteId: "lightning-strike", animation: mode });
  if (strike.source !== "canon") throw new Error("not canon");
  return strike.frames.map((frame) => frame.durationMs);
}

const total = (durations: readonly number[]) =>
  durations.reduce((sum, duration) => sum + duration, 0);

function rig(initial?: Parameters<typeof createStrikeScene>[0]["initial"]) {
  let now = 1_000;
  const scene = createStrikeScene({
    now: () => now,
    ...(initial === undefined ? {} : { initial }),
  });
  return {
    scene,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const items = (scene: ReturnType<typeof createStrikeScene>) =>
  harnessItems({
    subject: undefined,
    portrait: undefined,
    state: "idle",
    direction: "south",
    expression: "neutral",
    companion: false,
    structure: { art: "building", state: scene.building() },
    bolt: scene.bolt(),
  });

const byId = (list: ReturnType<typeof items>, id: string) =>
  list.find((item) => item.id === id);

describe("the building state control", () => {
  it("offers intact, damaged, burning and ruin, and a new scene starts intact and in full effects", () => {
    expect([...BUILDING_STATES]).toEqual([
      "intact",
      "damaged",
      "burning",
      "ruin",
    ]);
    const { scene } = rig();
    expect(scene.building()).toBe("intact");
    expect(scene.mode()).toBe("full");
    expect(scene.striking()).toBe(false);
  });

  it("maps each state to the published art it draws: burning is the damaged art with the fire loop over it", () => {
    expect(lookOf("intact")).toEqual({ state: "intact", fire: false });
    expect(lookOf("damaged")).toEqual({ state: "damaged", fire: false });
    expect(lookOf("burning")).toEqual({ state: "damaged", fire: true });
    expect(lookOf("ruin")).toEqual({ state: "ruin", fire: false });
  });

  it("each chosen state is drawn from the scene's items", () => {
    const { scene } = rig();
    for (const state of BUILDING_STATES) {
      scene.setBuilding(state);
      const list = items(scene);
      expect(byId(list, "structure")).toMatchObject({
        request: { id: "greek-house", state: lookOf(state).state },
      });
      expect(byId(list, "structure-fire" as string) !== undefined).toBe(
        lookOf(state).fire,
      );
    }
  });

  it("chooses the state the scene starts in", () => {
    expect(rig("ruin").scene.building()).toBe("ruin");
  });
});

describe("the effects toggle", () => {
  it("names the strike animation of the chosen mode", () => {
    const { scene } = rig();
    for (const mode of EFFECTS_MODES) {
      scene.setMode(mode);
      expect(scene.mode()).toBe(mode);
      expect(scene.bolt().animation).toBe(mode);
    }
  });
});

describe("a strike (AE7)", () => {
  for (const mode of EFFECTS_MODES) {
    it(`in ${mode} mode plays the ${mode} bolt for its frames' durations on the playback clock, and the building ends burning`, () => {
      const { scene, advance } = rig();
      const durations = published(mode);
      scene.setMode(mode);

      scene.strike(durations);

      expect(scene.striking()).toBe(true);
      expect(scene.bolt().animation).toBe(mode);
      expect(byId(items(scene), "strike")).toMatchObject({
        kind: "effect",
        layer: "effect",
        request: { source: "canon", id: "lightning-strike", animation: mode },
      });
      // The bolt starts at the click and its clock follows the playback clock.
      expect(scene.bolt().elapsedMs()).toBe(0);
      advance(total(durations) - 1);
      expect(scene.bolt().elapsedMs()).toBe(total(durations) - 1);
      expect(scene.settle()).toBe(false);
      expect(scene.building()).toBe("intact");

      advance(1);
      expect(scene.settle()).toBe(true);
      expect(scene.building()).toBe("burning");
      expect(scene.striking()).toBe(false);
      expect(scene.bolt().elapsedMs()).toBeUndefined();
      expect(byId(items(scene), "structure-fire")).toMatchObject({
        kind: "effect",
        request: { id: "fire", animation: "burn" },
      });
      expect(byId(items(scene), "structure")).toMatchObject({
        request: { state: "damaged" },
      });
    });
  }

  for (const mode of EFFECTS_MODES) {
    it(`in ${mode} mode a strike on a ruin plays the bolt for its frames' durations and the building stays a ruin`, () => {
      const { scene, advance } = rig("ruin");
      const durations = published(mode);
      scene.setMode(mode);

      scene.strike(durations);

      expect(scene.striking()).toBe(true);
      expect(byId(items(scene), "strike")).toMatchObject({
        kind: "effect",
        request: { source: "canon", id: "lightning-strike", animation: mode },
      });
      advance(total(durations) - 1);
      expect(scene.settle()).toBe(false);
      expect(scene.building()).toBe("ruin");

      advance(1);
      expect(scene.settle()).toBe(true);
      expect(scene.building()).toBe("ruin");
      expect(scene.striking()).toBe(false);
      expect(scene.bolt().elapsedMs()).toBeUndefined();
      expect(byId(items(scene), "structure-fire")).toBeUndefined();
      expect(byId(items(scene), "structure")).toMatchObject({
        request: { state: "ruin" },
      });
    });
  }

  it("any state other than ruin resolves to burning when the bolt ends", () => {
    for (const state of BUILDING_STATES) {
      if (state === "ruin") continue;
      const { scene, advance } = rig(state);
      scene.strike([100]);
      advance(100);
      expect(scene.settle()).toBe(true);
      expect(scene.building()).toBe("burning");
    }
  });

  it("full and calm are different animations of one asset, and both end in the same state", () => {
    expect(published("calm").length).toBeLessThan(published("full").length);
    const ends = EFFECTS_MODES.map((mode) => {
      const { scene, advance } = rig("damaged");
      scene.setMode(mode);
      scene.strike(published(mode));
      advance(10_000);
      scene.settle();
      return scene.building();
    });
    expect(ends).toEqual(["burning", "burning"]);
  });

  it("settles nothing until the bolt is over, and settling twice changes nothing", () => {
    const { scene, advance } = rig();
    expect(scene.settle()).toBe(false);
    scene.strike([100, 100]);
    advance(50);
    expect(scene.settle()).toBe(false);
    advance(150);
    expect(scene.settle()).toBe(true);
    expect(scene.settle()).toBe(false);
    expect(scene.building()).toBe("burning");
  });

  it("keeps the bolt it started with when the toggle changes mid-strike", () => {
    const { scene } = rig();
    scene.setMode("full");
    scene.strike(published("full"));

    scene.setMode("calm");

    expect(scene.mode()).toBe("calm");
    expect(scene.bolt().animation).toBe("full");
  });

  it("plays the animation the caller resolved the durations of, whatever the toggle says by then", () => {
    const { scene } = rig();
    scene.setMode("calm");

    scene.strike(published("full"), "full");

    expect(scene.bolt().animation).toBe("full");
  });

  it("a second Strike while one plays does not restart it", () => {
    const { scene, advance } = rig();
    scene.strike([100, 100]);
    advance(120);

    scene.strike([100, 100]);

    expect(scene.bolt().elapsedMs()).toBe(120);
  });

  it("a strike whose bolt art is not published resolves at once: the world outcome does not wait for the picture", () => {
    const { scene } = rig();
    scene.strike([]);
    expect(scene.settle()).toBe(true);
    expect(scene.building()).toBe("burning");
  });

  it("the owner choosing a state mid-strike cancels the strike and keeps the choice", () => {
    const { scene, advance } = rig();
    scene.strike([100, 100]);
    advance(50);

    scene.setBuilding("ruin");
    advance(500);

    expect(scene.striking()).toBe(false);
    expect(scene.settle()).toBe(false);
    expect(scene.building()).toBe("ruin");
    expect(scene.bolt().elapsedMs()).toBeUndefined();
  });

  it("can be played again after it resolved", () => {
    const { scene, advance } = rig();
    scene.strike([100]);
    advance(100);
    scene.settle();
    scene.setBuilding("intact");

    scene.strike([100]);

    expect(scene.bolt().elapsedMs()).toBe(0);
    advance(100);
    expect(scene.settle()).toBe(true);
    expect(scene.building()).toBe("burning");
  });
});
