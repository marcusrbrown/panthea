// The harness scene as data: a 6x6 ground of the chosen tile set, the subject at a fixed tile, a
// seated companion that shows the placeholder fallback, a placeholder mortal
// for scale, the published Greek house two depth steps behind the subject, so
// the subject covers part of it, the published Old Oak, the fire over the
// structure the owner set burning, the strike's bolt, and a flat portrait
// panel. Coordinates assume HARNESS_CAMERA.

import { tileMaskAt, tileOffsetAt } from "@panthea/assets/browser";
import {
  type Cell,
  type EffectsMode,
  FIRE_ANIMATION,
  FIRE_ASSET,
  frameIndexAt,
  type Layer,
  type Point,
  STRIKE_ASSET,
  STRUCTURE_ANCHORS,
  STRUCTURE_ASSETS,
  type StructureArt,
  strikeAnimation,
} from "@panthea/renderer";
import type { PreviewItem } from "../renderer/preview";
import type {
  AssetSource,
  ListingEntry,
  ResolveRequest,
  Selection,
} from "../source/port";
import { type BuildingState, lookOf } from "./building";

/**
 * Top-left of the 480x270 viewport in screen space. It sits high enough that
 * the strike's cell, which reaches 116 px above the point the bolt lands on,
 * lands on a roof or a canopy inside the view.
 */
export const HARNESS_CAMERA: Point = { x: -240, y: -140 };

/** Screen position of the portrait panel, right of the ground patch. */
export const PORTRAIT_PANEL_AT: Point = { x: 138, y: -130 };

/** An id no source holds, so every source answers with its placeholder. */
export const MISSING_SPRITE: Selection = {
  source: "canon",
  id: "missing-placeholder",
};

/** An id no source holds as a tile set, so the ground fails in the scene instead of drawing something else. */
export const MISSING_GROUND: Selection = {
  source: "canon",
  id: "missing-placeholder",
};

/**
 * The terrain under the scene, 6x6 grid cells (0 grass, 1 flagstone), drawn as 7x7 lattice points.
 * It is laid out so every one of the 16 corner masks appears: the cross, the single cells, the
 * diagonal pair, the edge runs and the inner and outer corners.
 */
export const GROUND_GRID: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 1],
  [0, 1, 1, 1, 0, 0],
  [0, 0, 1, 0, 0, 0],
  [1, 0, 1, 0, 1, 0],
  [0, 1, 0, 0, 1, 1],
];

/**
 * World coordinate of the grid's first cell. The grid is centred on the world origin because that is the
 * one placement at which its 7x7 lattice, 448 px wide and 224 px high, lies inside HARNESS_CAMERA's 480x270.
 */
export const GROUND_ORIGIN = -3;

/** The tile set the ground is drawn from, and the period of its offsets (N, so N squared of them). */
export interface GroundChoice {
  readonly selection: Selection;
  readonly period: number;
}

/**
 * Which of the subject and the house draws in front where they overlap. The
 * house is 4x3 tiles, so its depth is that of its bottom cell: at a shared
 * depth the layer decides. "subject-front" puts the house two depth steps
 * behind, "structure-front" shares the subject's bottom cell and swaps their
 * layers.
 */
export type OcclusionPair = "subject-front" | "structure-front";

/** The structure the owner sets a state on, and the state. The other structure stays intact. */
export interface StructureChoice {
  readonly art: StructureArt;
  readonly state: BuildingState;
}

/** The strike's bolt: the animation to ask for, and the clock it plays on (see the effect item). */
export interface BoltChoice {
  readonly animation: EffectsMode;
  readonly elapsedMs: () => number | undefined;
}

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
  /** Absent: the house, intact. */
  readonly structure?: StructureChoice;
  /** Absent: no bolt item. */
  readonly bolt?: BoltChoice;
  /** The tile set the ground is drawn from. Absent: one missing set, which fails in the scene. */
  readonly ground?: GroundChoice;
  /** Moves every tile on to the next offset of its set, so a cycle shows the variants. Absent: 0. */
  readonly groundCycle?: number;
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

/** The id a listing entry is selected by; the same entry has the same string across listing refreshes. */
export const entryKey = (
  entry: Pick<ListingEntry, "source" | "id"> | undefined,
) => (entry === undefined ? undefined : `${entry.source}:${entry.id}`);

/**
 * The sprite key to hold after the listing changed. The same entry (by key
 * string, not object identity: every listing refresh makes new objects) keeps
 * the key the owner chose while it is still published; a different entry, or a
 * key that is gone, falls back to the first published key.
 */
export function spriteKeyAfterListing(
  entry: ListingEntry | undefined,
  previousEntryKey: string | undefined,
  current: PreviewAnimationKey,
): PreviewAnimationKey | undefined {
  if (
    entry !== undefined &&
    entryKey(entry) === previousEntryKey &&
    isAnimationKey(entry, current)
  )
    return current;
  const first = firstPreviewKey(entry);
  return first?.kind === "sprite"
    ? {
        state: first.state,
        direction: first.direction,
        ...(first.ability === undefined ? {} : { ability: first.ability }),
      }
    : undefined;
}

/** The expression to hold after the listing changed, by the same rule as sprite keys. */
export function expressionAfterListing(
  entry: ListingEntry | undefined,
  previousEntryKey: string | undefined,
  current: string,
): string {
  if (
    entry?.kind === "portrait" &&
    entryKey(entry) === previousEntryKey &&
    entry.expressions.includes(current)
  )
    return current;
  const first = firstPreviewKey(entry);
  return first?.kind === "portrait" ? first.expression : "";
}

/** What a resolved atlas tells the playback clock: each frame's duration and where the loop starts, both from the manifest. */
export function clockTiming(asset: {
  readonly frames: readonly { readonly durationMs: number }[];
  readonly loopStart?: number | undefined;
}): {
  readonly durations: readonly number[];
  readonly loopStart: number | undefined;
} {
  return {
    durations: asset.frames.map((frame) => frame.durationMs),
    loopStart: asset.loopStart,
  };
}

/**
 * Keeps the playback clock on the timing of the clip the owner selected, for as
 * long as it is followed. It resolves the clip when it starts and again
 * whenever the source reports that selection changed: a new revision can change
 * frame durations, frame count or loop start while every key name stays the
 * same (so the listing is unchanged), and Step, Scrub and the frame indicator
 * must follow the timing the renderer is drawing. The selected key is kept, and
 * so is a paused frame (clamped to the new count). Returns the stop.
 */
export function followClipTiming(input: {
  readonly source: Pick<AssetSource, "resolve" | "subscribe">;
  readonly request: ResolveRequest;
  readonly playback: PlaybackClock;
  /** Reports the new timing with the frame and whether the clock is playing, so the UI never says otherwise. */
  readonly onTiming: (
    durations: readonly number[],
    frame: number,
    playing: boolean,
  ) => void;
}): () => void {
  const { source, request, playback, onTiming } = input;
  let disposed = false;
  // Only the newest resolve may apply: an older one that lands late is stale.
  let latest = 0;

  const load = (refresh: boolean) => {
    latest += 1;
    const mine = latest;
    void source.resolve(request).then(
      (resolved) => {
        if (disposed || mine !== latest) return;
        if (resolved.kind !== "frames") {
          playback.configure([], undefined);
          onTiming([], 0, playback.playing());
          return;
        }
        // What the owner did while this was resolving (Play, Pause, a Scrub)
        // counts: the clock's state is read now, not when the refresh began,
        // and the reply never changes whether it is playing.
        const wasPlaying = playback.playing();
        const heldFrame = playback.frame();
        const { durations, loopStart } = clockTiming(resolved.asset);
        playback.configure(durations, loopStart);
        if (refresh && !wasPlaying && durations.length > 0)
          playback.scrub(Math.min(heldFrame, durations.length - 1));
        onTiming(durations, playback.frame(), playback.playing());
      },
      () => {
        if (disposed || mine !== latest) return;
        playback.configure([], undefined);
        onTiming([], 0, playback.playing());
      },
    );
  };

  playback.configure([], undefined);
  onTiming([], 0, playback.playing());
  load(false);
  const unsubscribe = source.subscribe((change) => {
    if (
      change.changed.some(
        (selection) =>
          selection.source === request.source && selection.id === request.id,
      )
    )
      load(true);
  });
  return () => {
    disposed = true;
    unsubscribe();
  };
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
      // Past the last frame a step wraps to where the clip loops (the first
      // frame when it has no loop) rather than stalling on the last one. A
      // scrub keeps its clamp.
      const last = durations.length - 1;
      let target = frame() + amount;
      if (last > 0 && target > last) {
        const start = Math.min(Math.max(0, loopStart ?? 0), last);
        target = start + ((target - last - 1) % (last + 1 - start));
      }
      seek(target);
    },
    scrub(index) {
      seek(index);
    },
  };
}

/**
 * The subject to draw: the chosen one, on the realm the previewed record asks
 * for. The realm applies only when the chosen subject is that record itself; any
 * other chosen subject is drawn from its base atlas.
 */
export function harnessSubject(
  chosen: Selection | undefined,
  selected: Selection | undefined,
): Selection | undefined {
  if (
    chosen === undefined ||
    selected?.realm === undefined ||
    selected.source !== chosen.source ||
    selected.id !== chosen.id
  )
    return chosen;
  return { source: chosen.source, id: chosen.id, realm: selected.realm };
}

/** The footprints the published structure art declares, in tiles: what a placeholder stands in with. */
const STRUCTURE_FOOTPRINTS: Readonly<
  Record<StructureArt, { readonly w: number; readonly h: number }>
> = { building: { w: 4, h: 3 }, tree: { w: 1, h: 1 } };

const STRUCTURE_FACING = "south";

interface StructureSpot {
  readonly id: string;
  readonly layer: Layer;
  /** The footprint's origin cell. */
  readonly cell: Cell;
}

function structureSpots(
  occlusion: OcclusionPair | undefined,
): Record<StructureArt, StructureSpot> {
  const front = occlusion === "structure-front";
  return {
    // The house's bottom cell is (x + 3, y + 2): (0, 2) two depth steps behind
    // the subject, or the subject's own (2, 2) when it is to draw in front.
    building: {
      id: "structure",
      layer: front ? "actor" : "structure",
      cell: front ? { x: -1, y: 0, z: 0 } : { x: -3, y: 0, z: 0 },
    },
    tree: { id: "tree", layer: "structure", cell: { x: 3, y: 0, z: 0 } },
  };
}

/** The cell a structure's foot stands on: the bottom cell of its footprint. */
function footCell(art: StructureArt, spot: StructureSpot): Cell {
  const footprint = STRUCTURE_FOOTPRINTS[art];
  return {
    x: spot.cell.x + footprint.w - 1,
    y: spot.cell.y + footprint.h - 1,
    z: spot.cell.z,
  };
}

/** The ground: a tile at every lattice point round the grid, from the chosen set at the cycle's offset. */
function groundItems(selection: HarnessSelection): PreviewItem[] {
  if (selection.ground === undefined)
    return [
      {
        kind: "tile",
        id: "ground",
        point: { x: GROUND_ORIGIN, y: GROUND_ORIGIN },
        request: MISSING_GROUND,
      },
    ];
  const { selection: set, period } = selection.ground;
  const cycle = selection.groundCycle ?? 0;
  const items: PreviewItem[] = [];
  for (let gy = 0; gy <= GROUND_GRID.length; gy += 1) {
    for (let gx = 0; gx <= GROUND_GRID.length; gx += 1) {
      const x = GROUND_ORIGIN + gx;
      const y = GROUND_ORIGIN + gy;
      items.push({
        kind: "tile",
        id: `ground-${gx}-${gy}`,
        point: { x, y },
        request: {
          ...set,
          mask: tileMaskAt(GROUND_GRID, gx, gy),
          offset: (tileOffsetAt(x, y, period) + cycle) % (period * period),
        },
      });
    }
  }
  return items;
}

export function harnessItems(selection: HarnessSelection): PreviewItem[] {
  const items: PreviewItem[] = groundItems(selection);
  const subject = selection.subject ?? MISSING_SPRITE;
  const structureFront = selection.occlusion === "structure-front";
  const target = selection.structure?.art ?? "building";
  const look = lookOf(selection.structure?.state ?? "intact");
  const spots = structureSpots(selection.occlusion);
  for (const art of ["building", "tree"] as const) {
    const spot = spots[art];
    items.push({
      kind: "sprite",
      id: spot.id,
      layer: spot.layer,
      cell: spot.cell,
      footprint: STRUCTURE_FOOTPRINTS[art],
      request: {
        source: "canon",
        id: STRUCTURE_ASSETS[art],
        state: art === target ? look.state : "intact",
        direction: STRUCTURE_FACING,
      },
    });
  }
  const targetSpot = spots[target];
  const targetFoot = footCell(target, targetSpot);
  if (look.fire) {
    items.push({
      kind: "effect",
      id: `${targetSpot.id}-fire`,
      layer: targetSpot.layer,
      cell: targetFoot,
      offset: STRUCTURE_ANCHORS[target].fire,
      request: { source: "canon", id: FIRE_ASSET, animation: FIRE_ANIMATION },
    });
  }
  if (selection.bolt !== undefined) {
    items.push({
      kind: "effect",
      id: "strike",
      layer: "effect",
      cell: targetFoot,
      offset: STRUCTURE_ANCHORS[target].strike,
      request: {
        source: "canon",
        id: STRIKE_ASSET,
        animation: strikeAnimation(selection.bolt.animation),
      },
      elapsedMs: selection.bolt.elapsedMs,
    });
  }
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
