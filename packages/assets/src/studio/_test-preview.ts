// Test support for the preview-source core and its adapters (the Vite dev
// bridge and the studio session): published canon, store records, a fake
// recursive watcher and a manual scheduler. Test-only.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  committedVocabulary,
  type FixtureAsset,
  spriteFixture,
} from "../fixtures";
import { sha256Hex } from "../hash";
import { encodeRgbaPng } from "../placeholder";
import { parseAssetManifest, selectRevision, writeRevision } from "../registry";
import type {
  PreviewScheduler,
  PreviewWatcher,
  WatchFs,
} from "./preview-source";

export const vocabulary = committedVocabulary();

export function publishCanon(root: string, asset: FixtureAsset): void {
  const written = writeRevision(root, asset.manifest, asset.blobs, vocabulary);
  if (!written.ok) throw new Error(written.message);
  const selected = selectRevision(
    root,
    asset.manifest.id,
    written.value.revision,
    vocabulary,
  );
  if (!selected.ok) throw new Error(selected.message);
}

export function writeDraft(
  studioRoot: string,
  id: string,
  asset: FixtureAsset,
  state: "draft" | "approved" = "draft",
): void {
  const revision = sha256Hex(
    new TextEncoder().encode(JSON.stringify(asset.manifest)),
  );
  for (const [hash, bytes] of asset.blobs) {
    mkdirSync(join(studioRoot, "blobs"), { recursive: true });
    writeFileSync(join(studioRoot, "blobs", `${hash}.png`), bytes);
  }
  mkdirSync(join(studioRoot, "assets"), { recursive: true });
  const body =
    state === "draft"
      ? { state, manifest: asset.manifest, edit: "idle", edits: [] }
      : {
          state,
          manifest: asset.manifest,
          basis: { type: "report-pass" },
        };
  writeFileSync(
    join(studioRoot, "assets", `${id}.json`),
    JSON.stringify({
      schemaVersion: 1,
      id,
      workingSetId: "w",
      assetId: asset.manifest.id,
      prior: null,
      record: body,
      manifestRevision: revision,
      reportBasis: {
        atlasHash: asset.manifest.atlas.blob,
        paletteDigest: revision,
      },
      licenceReview: { manifestRevision: revision, entries: [] },
      licenceAssessments: [],
      published: null,
    }),
  );
}

/** The sprite fixture with a different atlas: visible pixels in the left half, `hidden` RGB under alpha 0 in the right. */
export function hiddenRgbSprite(
  visible: number,
  hidden: number,
  id = "placeholder-zeus",
): FixtureAsset {
  const base = spriteFixture(id);
  const rgba = new Uint8Array(256 * 80 * 4);
  for (let at = 0; at < rgba.length; at += 4) {
    const x = (at / 4) % 256;
    if (x < 128) {
      rgba.set([visible, 90, 160, 255], at);
    } else {
      rgba.set([hidden, hidden, hidden, 0], at);
    }
  }
  const bytes = encodeRgbaPng(rgba, 256, 80);
  const hash = sha256Hex(bytes);
  return {
    manifest: {
      ...base.manifest,
      atlas: { blob: hash, width: 256, height: 80 },
    },
    blobs: new Map([[hash, bytes]]),
  };
}

export function withManifest(
  asset: FixtureAsset,
  patch: Record<string, unknown>,
): FixtureAsset {
  const parsed = parseAssetManifest(
    { ...JSON.parse(JSON.stringify(asset.manifest)), ...patch },
    vocabulary,
  );
  if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
  return { manifest: parsed.value, blobs: asset.blobs };
}

export const firstBlob = (asset: FixtureAsset): Uint8Array =>
  [...asset.blobs.values()][0] as Uint8Array;

export interface FakeWatch {
  readonly path: string;
  readonly recursive: boolean;
  closed: boolean;
  fire(name: string | null): void;
}

export function fakeWatchFs(exists: (path: string) => boolean) {
  const watches: FakeWatch[] = [];
  const fs: WatchFs = {
    exists,
    watch(path, options, onEvent) {
      const watch: FakeWatch = {
        path,
        recursive: options.recursive,
        closed: false,
        fire: (name) => {
          if (!watch.closed) onEvent(name);
        },
      };
      watches.push(watch);
      return {
        close() {
          watch.closed = true;
        },
      };
    },
  };
  return {
    fs,
    watches,
    open: () => watches.filter((watch) => !watch.closed),
  };
}

/** A scheduler that runs nothing until `tick`, and watchers that fire only when touched: the clock and the file system are the test's. */
export function manualClock() {
  const timers = new Map<number, () => void>();
  let next = 0;
  const callbacks = new Map<string, (relative: string) => void>();
  const closed: string[] = [];
  const schedule: PreviewScheduler = (run) => {
    const id = next++;
    timers.set(id, run);
    return () => {
      timers.delete(id);
    };
  };
  const watch: PreviewWatcher = (root, onChange) => {
    callbacks.set(root, onChange);
    return () => {
      closed.push(root);
    };
  };
  return {
    schedule,
    watch,
    closed,
    touch: (root: string, relative: string) => callbacks.get(root)?.(relative),
    pending: () => timers.size,
    /** Runs every waiting timer once. */
    tick() {
      const due = [...timers.entries()];
      for (const [id, run] of due) {
        timers.delete(id);
        run();
      }
    },
  };
}
