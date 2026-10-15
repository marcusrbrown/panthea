import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  browserEffectsStorage,
  createEffectsSetting,
  EFFECTS_KEY,
  type EffectsStorage,
  REDUCED_MOTION_QUERY,
} from "./effects";

/** An in-memory `localStorage` that records every write, so a test can tell a choice from a seed. */
function recordingStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const writes: [string, string][] = [];
  const storage: EffectsStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      writes.push([key, value]);
      data.set(key, value);
    },
  };
  return { storage, writes, data };
}

const media = (reduce: boolean) => (query: string) => ({
  matches: query === REDUCED_MOTION_QUERY && reduce,
});

test("the storage key is panthea.effects, and the seed asks for reduced motion", () => {
  expect(EFFECTS_KEY).toBe("panthea.effects");
  expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
});

test("with nothing stored and no reduced-motion preference the strike is the full one", () => {
  const { storage } = recordingStorage();

  expect(
    createEffectsSetting({ storage, matchMedia: media(false) }).mode(),
  ).toBe("full");
});

test("a reduced-motion preference seeds the calm strike, and the seed is not stored as a choice", () => {
  const { storage, writes } = recordingStorage();

  const setting = createEffectsSetting({ storage, matchMedia: media(true) });

  expect(setting.mode()).toBe("calm");
  expect(writes).toEqual([]);
});

test("a stored choice beats the seed, either way", () => {
  expect(
    createEffectsSetting({
      storage: recordingStorage({ [EFFECTS_KEY]: "full" }).storage,
      matchMedia: media(true),
    }).mode(),
  ).toBe("full");
  expect(
    createEffectsSetting({
      storage: recordingStorage({ [EFFECTS_KEY]: "calm" }).storage,
      matchMedia: media(false),
    }).mode(),
  ).toBe("calm");
});

test("a stored value that is not a mode is ignored", () => {
  const { storage } = recordingStorage({ [EFFECTS_KEY]: "loud" });

  expect(
    createEffectsSetting({ storage, matchMedia: media(true) }).mode(),
  ).toBe("calm");
});

test("a choice is written to storage, and a fresh setting over the same storage is a reload that keeps it", () => {
  const { storage, writes } = recordingStorage();
  const setting = createEffectsSetting({ storage, matchMedia: media(false) });

  setting.set("calm");

  expect(setting.mode()).toBe("calm");
  expect(writes).toEqual([[EFFECTS_KEY, "calm"]]);
  expect(
    createEffectsSetting({ storage, matchMedia: media(false) }).mode(),
  ).toBe("calm");
});

test("picking the mode the seed already gave is still a choice: it is stored, and a later preference does not undo it", () => {
  const { storage, writes } = recordingStorage();
  createEffectsSetting({ storage, matchMedia: media(false) }).set("full");

  expect(writes).toEqual([[EFFECTS_KEY, "full"]]);
  expect(
    createEffectsSetting({ storage, matchMedia: media(true) }).mode(),
  ).toBe("full");
});

test("storage that refuses a write keeps the choice for this session only", () => {
  const storage: EffectsStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  const setting = createEffectsSetting({ storage, matchMedia: media(false) });

  setting.set("calm");

  expect(setting.mode()).toBe("calm");
  // A reload has nothing stored: back to the seed.
  expect(
    createEffectsSetting({ storage, matchMedia: media(false) }).mode(),
  ).toBe("full");
});

test("storage that cannot be read, or none at all, falls back to the seed and still holds a choice", () => {
  const unreadable: EffectsStorage = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {},
  };

  const blocked = createEffectsSetting({
    storage: unreadable,
    matchMedia: media(true),
  });
  expect(blocked.mode()).toBe("calm");

  const none = createEffectsSetting({
    storage: undefined,
    matchMedia: media(false),
  });
  expect(none.mode()).toBe("full");
  none.set("calm");
  expect(none.mode()).toBe("calm");
});

test("no matchMedia, or one that throws, seeds the full strike", () => {
  expect(
    createEffectsSetting({ storage: undefined, matchMedia: undefined }).mode(),
  ).toBe("full");
  expect(
    createEffectsSetting({
      storage: undefined,
      matchMedia: () => {
        throw new Error("unsupported");
      },
    }).mode(),
  ).toBe("full");
});

test("listeners hear a change once, never a repeat of the current mode, and stop when unsubscribed", () => {
  const setting = createEffectsSetting({
    storage: undefined,
    matchMedia: media(false),
  });
  const heard: string[] = [];
  const stop = setting.subscribe((mode) => heard.push(mode));

  setting.set("full");
  setting.set("calm");
  setting.set("calm");
  stop();
  setting.set("full");

  expect(heard).toEqual(["calm"]);
});

test("the browser's storage is whatever localStorage is, or nothing where the platform refuses it", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    expect(browserEffectsStorage()).toBeUndefined();
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(globalThis, "localStorage");
    } else {
      Object.defineProperty(globalThis, "localStorage", original);
    }
  }
});

test("the setting reaches nothing that talks to the sidecar: its only import is the renderer's mode type", () => {
  const source = readFileSync(new URL("./effects.ts", import.meta.url), "utf8");
  const specifiers = [
    ...source.matchAll(/^import\b[^;]*?from\s+"([^"]+)"/gms),
  ].map((match) => match[1]);

  // No transport, no receipts, no Tauri: a change of mode cannot be sent anywhere.
  expect(specifiers).toEqual(["@panthea/renderer"]);
});
