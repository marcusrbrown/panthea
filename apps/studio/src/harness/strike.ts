// The harness has no world, so the scene keeps the little the studio needs of
// one: which state the struck building is in, the effects toggle, and a strike
// in flight. A strike plays its bolt once on a playback clock; when the bolt
// is over the strike has resolved and the building is burning, whichever
// animation played. Nothing here draws: `harnessItems` turns it into items.

import {
  EFFECTS_MODES,
  type EffectsMode,
  oneShotFrameAt,
} from "@panthea/renderer";
import type { BuildingState } from "./building";
import { type BoltChoice, createPlaybackClock } from "./layout";

export interface StrikeScene {
  building(): BuildingState;
  /** The owner's choice: it also cancels a strike in flight, which would otherwise overwrite it. */
  setBuilding(state: BuildingState): void;
  mode(): EffectsMode;
  setMode(mode: EffectsMode): void;
  striking(): boolean;
  /**
   * Starts a strike now with the frame durations of the bolt animation
   * `animation` (the toggle's now, unless the caller resolved another). A
   * strike already in flight is not restarted. Empty durations (art that is
   * not published) are a bolt that is over at once.
   */
  strike(durations: readonly number[], animation?: EffectsMode): void;
  /**
   * The bolt to draw: the in-flight strike's animation (or the toggle's when
   * none is in flight) and its clock, which reads how long the bolt has played
   * or `undefined` while no strike is in flight.
   */
  bolt(): BoltChoice;
  /** Resolves a strike whose bolt is over: the building burns. True when it did. */
  settle(): boolean;
}

export function createStrikeScene(input: {
  /** The playback clock's time source; tests pass their own. */
  readonly now: () => number;
  readonly initial?: BuildingState;
}): StrikeScene {
  const clock = createPlaybackClock([], undefined, input.now);
  let building: BuildingState = input.initial ?? "intact";
  let mode: EffectsMode = EFFECTS_MODES[0];
  let flight:
    | { readonly animation: EffectsMode; readonly durations: readonly number[] }
    | undefined;

  const elapsedMs = (): number | undefined =>
    flight === undefined ? undefined : clock.elapsed();

  return {
    building: () => building,
    setBuilding(state) {
      building = state;
      if (flight !== undefined) {
        flight = undefined;
        clock.pause();
      }
    },
    mode: () => mode,
    setMode(next) {
      mode = next;
    },
    striking: () => flight !== undefined,
    strike(durations, animation = mode) {
      if (flight !== undefined) return;
      flight = { animation, durations };
      clock.configure(durations);
      clock.play();
    },
    bolt: () => ({ animation: flight?.animation ?? mode, elapsedMs }),
    settle() {
      if (flight === undefined) return false;
      if (oneShotFrameAt(flight.durations, clock.elapsed()) !== undefined)
        return false;
      flight = undefined;
      clock.pause();
      building = "burning";
      return true;
    },
  };
}
