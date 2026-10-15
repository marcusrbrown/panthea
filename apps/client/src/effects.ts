// The player's effects setting: whether a lightning strike plays the full
// animation or the calm one. It is presentation only and lives in the client:
// it is never sent to the sidecar, never enters the world, and changing it
// does not restart anything. The same committed event is shown either way.
//
// One localStorage key, `panthea.effects`, holds the chosen mode. It is written
// only when the operator picks a mode, never when the setting is created. With
// no stored choice the mode is seeded from the platform's reduced-motion
// preference (calm when it asks to reduce motion, otherwise full); the seed is
// not stored, so a later change of that preference is followed until a choice
// is made. If storage cannot be read or written the choice is held in memory
// for this session and a reload goes back to the seed.

import { EFFECTS_MODES, type EffectsMode } from "@panthea/renderer";

/** The slice of `localStorage` the setting uses; a test supplies its own. */
export interface EffectsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const EFFECTS_KEY = "panthea.effects";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** The slice of `window.matchMedia` the seed uses. */
export type MatchMedia = (query: string) => { readonly matches: boolean };

export interface EffectsSetting {
  mode(): EffectsMode;
  set(mode: EffectsMode): void;
  /** Calls `listener` with the new mode after every change; returns the function that stops it. */
  subscribe(listener: (mode: EffectsMode) => void): () => void;
}

export interface EffectsSettingOptions {
  /** Where the choice is remembered; none keeps it in this session's memory alone. */
  readonly storage: EffectsStorage | undefined;
  /** Seeds the mode from the reduced-motion preference; none seeds the full strike. */
  readonly matchMedia: MatchMedia | undefined;
}

const isMode = (value: unknown): value is EffectsMode =>
  EFFECTS_MODES.some((mode) => mode === value);

function seeded(matchMedia: MatchMedia | undefined): EffectsMode {
  try {
    return matchMedia?.(REDUCED_MOTION_QUERY).matches === true
      ? "calm"
      : "full";
  } catch {
    // A platform that cannot answer shows the full strike.
    return "full";
  }
}

function stored(storage: EffectsStorage | undefined): EffectsMode | undefined {
  try {
    const value = storage?.getItem(EFFECTS_KEY);
    return isMode(value) ? value : undefined;
  } catch {
    // Unreadable storage must not fail the view: use the seed.
    return undefined;
  }
}

export function createEffectsSetting(
  options: EffectsSettingOptions,
): EffectsSetting {
  const { storage, matchMedia } = options;
  let current = stored(storage) ?? seeded(matchMedia);
  const listeners = new Set<(mode: EffectsMode) => void>();
  return {
    mode: () => current,
    set(mode) {
      // Always stored, even when it is the mode the seed gave: it is a choice now.
      try {
        storage?.setItem(EFFECTS_KEY, mode);
      } catch {
        // Chosen for this session only; a reload goes back to the seed.
      }
      if (mode === current) return;
      current = mode;
      for (const listener of listeners) listener(mode);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The browser's `localStorage`, or `undefined` where the platform refuses access to it. */
export function browserEffectsStorage(): EffectsStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The browser's `matchMedia`, or `undefined` where there is none. */
export function browserMatchMedia(): MatchMedia | undefined {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
    ? (query) => window.matchMedia(query)
    : undefined;
}
