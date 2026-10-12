// The harness scene as data: a ground patch, the subject at a fixed tile, a
// seated companion that shows the placeholder fallback, a placeholder mortal
// for scale, a placeholder 2x2 structure two depth steps behind the subject on its column, so the subject covers part of it, and a flat
// portrait panel. Coordinates assume HARNESS_CAMERA.

import { frameIndexAt, type Point } from "@panthea/renderer";
import type { PreviewItem } from "../renderer/preview";
import type { ListingEntry, Selection } from "../source/port";

/** Top-left of the 480x270 viewport in screen space. */
export const HARNESS_CAMERA: Point = { x: -240, y: -80 };

/** Screen position of the portrait panel, right of the ground patch. */
export const PORTRAIT_PANEL_AT: Point = { x: 138, y: -70 };

/** An id no source holds, so every source answers with its placeholder. */
export const MISSING_SPRITE: Selection = {
  source: "canon",
  id: "missing-placeholder",
};

const PATCH = 4;

/**
 * Which of the subject and the placeholder structure draws in front where
 * they overlap. A sprite's screen y is 16 x depth + 31, so a 16 px structure
 * can only overlap the taller subject behind it or at its own depth, where
 * the layer decides: "subject-front" puts the structure two depth steps
 * behind, "structure-front" shares the subject's bottom cell and swaps their
 * layers.
 */
export type OcclusionPair = "subject-front" | "structure-front";

export interface HarnessSelection {
  readonly subject: Selection | undefined;
  readonly portrait: Selection | undefined;
  readonly state: string;
  readonly direction: string;
  readonly ability?: string;
  readonly expression: string;
  readonly animations?: readonly PreviewAnimationKey[];
  readonly expressions?: readonly string[];
  readonly companion: boolean;
  readonly occlusion?: OcclusionPair;
}

export interface PreviewAnimationKey {
  readonly state: string;
  readonly direction: string;
  readonly ability?: string;
}

export type InitialPreviewKey =
  | ({ readonly kind: "sprite" } & PreviewAnimationKey)
  | { readonly kind: "portrait"; readonly expression: string };

export function firstPreviewKey(
  entry: ListingEntry | undefined,
): InitialPreviewKey | undefined {
  if (entry?.kind === "sprite") {
    const key = entry.animations[0];
    return key === undefined ? undefined : { kind: "sprite", ...key };
  }
  if (entry?.kind === "portrait") {
    const expression = entry.expressions[0];
    return expression === undefined
      ? undefined
      : { kind: "portrait", expression };
  }
  return undefined;
}

export function statesForEntry(entry: ListingEntry | undefined): string[] {
  return [...new Set(entry?.animations.map((key) => key.state) ?? [])];
}

export function firstAnimationForState(
  entry: ListingEntry | undefined,
  state: string,
): PreviewAnimationKey | undefined {
  return entry?.animations.find((key) => key.state === state);
}

export function directionsForState(
  entry: ListingEntry | undefined,
  state: string,
): string[] {
  return [
    ...new Set(
      entry?.animations
        .filter((key) => key.state === state)
        .map((key) => key.direction) ?? [],
    ),
  ];
}

export function abilitiesForKey(
  entry: ListingEntry | undefined,
  state: string,
  direction: string,
): string[] {
  return [
    ...new Set(
      entry?.animations.flatMap((key) =>
        key.state === state &&
        key.direction === direction &&
        key.ability !== undefined
          ? [key.ability]
          : [],
      ) ?? [],
    ),
  ];
}

export function isAnimationKey(
  entry: Pick<ListingEntry, "kind" | "animations"> | undefined,
  selected: PreviewAnimationKey,
): boolean {
  return (
    entry?.kind === "sprite" &&
    entry.animations.some(
      (key) =>
        key.state === selected.state &&
        key.direction === selected.direction &&
        key.ability === selected.ability,
    )
  );
}

export function animationKeyMessage(
  entry: ListingEntry | undefined,
  selected: PreviewAnimationKey,
): string | undefined {
  return entry?.kind === "sprite" && !isAnimationKey(entry, selected)
    ? "not in this asset"
    : undefined;
}

export function expressionKeyMessage(
  entry: ListingEntry | undefined,
  expression: string,
): string | undefined {
  return entry?.kind === "portrait" && !entry.expressions.includes(expression)
    ? "not in this asset"
    : undefined;
}

function companionAnimation(
  animations: readonly PreviewAnimationKey[],
): PreviewAnimationKey | undefined {
  return animations.find((key) => key.state === "seated") ?? animations[0];
}

export interface PlaybackClock {
  configure(durations: readonly number[], loopStart?: number): void;
  elapsed(): number;
  frame(): number;
  playing(): boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  step(amount?: number): void;
  scrub(frame: number): void;
}

/** A deterministic elapsed-time clock. It creates no timers; callers supply `now`. */
export function createPlaybackClock(
  initialDurations: readonly number[],
  initialLoopStart: number | undefined,
  now: () => number,
): PlaybackClock {
  let durations = [...initialDurations];
  let loopStart = initialLoopStart;
  let pausedAt = 0;
  let startedAt = now();
  let isPlaying = false;

  const elapsed = () =>
    pausedAt + (isPlaying ? Math.max(0, now() - startedAt) : 0);
  const frame = () => frameIndexAt(durations, loopStart, elapsed());
  const seek = (index: number) => {
    if (durations.length === 0) return;
    const target = Math.max(0, Math.min(durations.length - 1, index));
    pausedAt = durations
      .slice(0, target)
      .reduce((total, duration) => total + duration, 0);
    pausedAt += (durations[target] ?? 0) / 2;
    startedAt = now();
    isPlaying = false;
  };

  return {
    configure(nextDurations, nextLoopStart) {
      durations = [...nextDurations];
      loopStart = nextLoopStart;
      pausedAt = 0;
      startedAt = now();
    },
    elapsed,
    frame,
    playing: () => isPlaying,
    play() {
      if (isPlaying) return;
      startedAt = now();
      isPlaying = true;
    },
    pause() {
      if (!isPlaying) return;
      pausedAt = elapsed();
      isPlaying = false;
    },
    toggle() {
      if (isPlaying) this.pause();
      else this.play();
    },
    step(amount = 1) {
      seek(frame() + amount);
    },
    scrub(index) {
      seek(index);
    },
  };
}

export function harnessItems(selection: HarnessSelection): PreviewItem[] {
  const items: PreviewItem[] = [];
  for (let x = 0; x < PATCH; x += 1) {
    for (let y = 0; y < PATCH; y += 1) {
      items.push({
        kind: "diamond",
        id: `ground-${x}-${y}`,
        cell: { x, y, z: 0 },
      });
    }
  }
  const subject = selection.subject ?? MISSING_SPRITE;
  const structureFront = selection.occlusion === "structure-front";
  items.push({
    kind: "sprite",
    id: "structure",
    layer: structureFront ? "actor" : "structure",
    cell: structureFront ? { x: 1, y: 1, z: 0 } : { x: 0, y: 0, z: 0 },
    footprint: { w: 2, h: 2 },
    request: MISSING_SPRITE,
  });
  items.push({
    kind: "sprite",
    id: "mortal",
    layer: "actor",
    cell: { x: 0, y: 2, z: 0 },
    request: MISSING_SPRITE,
  });
  const subjectKey = {
    state: selection.state,
    direction: selection.direction,
    ...(selection.ability === undefined ? {} : { ability: selection.ability }),
  };
  const subjectKeyValid =
    selection.subject === undefined ||
    selection.animations === undefined ||
    isAnimationKey(
      { kind: "sprite", animations: selection.animations },
      subjectKey,
    );
  if (
    subjectKeyValid &&
    (selection.subject !== undefined || selection.portrait === undefined)
  ) {
    items.push({
      kind: "sprite",
      id: "subject",
      layer: structureFront ? "structure" : "actor",
      cell: { x: 2, y: 2, z: 0 },
      request: { ...subject, ...subjectKey },
    });
  }
  const companion = selection.animations
    ? companionAnimation(selection.animations)
    : undefined;
  if (selection.companion && companion !== undefined) {
    items.push({
      kind: "sprite",
      id: "seated",
      layer: "actor",
      cell: { x: 3, y: 1, z: 0 },
      request: {
        ...subject,
        ...companion,
      },
    });
  }
  if (
    selection.portrait !== undefined &&
    (selection.expressions === undefined ||
      selection.expressions.includes(selection.expression))
  ) {
    items.push({
      kind: "flat",
      id: "portrait",
      at: PORTRAIT_PANEL_AT,
      request: { ...selection.portrait, expression: selection.expression },
    });
  }
  return items;
}

/**
 * The listed entry the harness should draw: the wanted one, or the first when
 * nothing is wanted. A wanted id that is not listed answers nothing, so the
 * slot draws its placeholder rather than another record.
 */
export function pickIn(
  list: readonly ListingEntry[],
  wanted: Selection | undefined,
): Selection | undefined {
  const chosen =
    wanted === undefined
      ? list[0]
      : list.find(
          (entry) => entry.source === wanted.source && entry.id === wanted.id,
        );
  return chosen === undefined
    ? undefined
    : { source: chosen.source, id: chosen.id };
}
