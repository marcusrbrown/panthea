import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeRgbaPng, sha256Hex } from "@panthea/assets";
import {
  committedVocabulary,
  type FixtureAsset,
  spriteFixture,
} from "@panthea/assets/fixtures";
import {
  parseAssetManifest,
  selectRevision,
  writeRevision,
} from "@panthea/assets/registry";
import {
  type AssetBridge,
  type BridgeOptions,
  type BridgeResponse,
  createAssetBridge,
  type Scheduler,
  type Watcher,
  type WatchFs,
} from "./dev-bridge";
import type { SourceChange } from "./port";

export const vocabulary = committedVocabulary();

const COMMITTED = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "content",
  "greek",
);

const dirs: string[] = [];

export function removeTempRoots(): void {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
}

export interface World {
  readonly base: string;
  readonly registryRoot: string;
  readonly studioRoot: string;
}

/**
 * A copy of the committed registry reduced to its `zeus-portrait` entry, so every scenario starts from one canon
 * asset however much has been published to `content/greek`, and an empty, existing studio root.
 */
export function world(): World {
  const base = mkdtempSync(join(tmpdir(), "studio-bridge-"));
  dirs.push(base);
  const registryRoot = join(base, "registry");
  const studioRoot = join(base, "studio");
  const committed = join(COMMITTED, "assets", "registry");
  const index = JSON.parse(readFileSync(join(committed, "index.json"), "utf8"));
  const portrait = index.entries.find(
    (entry: { assetId: string }) => entry.assetId === "zeus-portrait",
  );
  const manifest = JSON.parse(
    readFileSync(
      join(committed, "manifests", `${portrait.revision}.json`),
      "utf8",
    ),
  );
  mkdirSync(join(registryRoot, "manifests"), { recursive: true });
  mkdirSync(join(registryRoot, "blobs"));
  copyFileSync(
    join(committed, "manifests", `${portrait.revision}.json`),
    join(registryRoot, "manifests", `${portrait.revision}.json`),
  );
  copyFileSync(
    join(committed, "blobs", `${manifest.atlas.blob}.png`),
    join(registryRoot, "blobs", `${manifest.atlas.blob}.png`),
  );
  writeFileSync(
    join(registryRoot, "index.json"),
    `${JSON.stringify({ entries: [portrait], schemaVersion: 1 })}\n`,
  );
  mkdirSync(studioRoot);
  return { base, registryRoot, studioRoot };
}

export function emptyWorld(): World {
  const base = mkdtempSync(join(tmpdir(), "studio-bridge-"));
  dirs.push(base);
  return {
    base,
    registryRoot: join(base, "registry"),
    studioRoot: join(base, "studio"),
  };
}

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

export interface Rig {
  readonly bridge: AssetBridge;
  readonly events: SourceChange[];
  readonly watchers: { readonly root: string; touch(relative: string): void }[];
  readonly closed: string[];
  /** Timers waiting on the injected scheduler. */
  pending(): number;
  /** Runs every waiting timer once. */
  tick(): void;
}

export function rig(w: World, options: Partial<BridgeOptions> = {}): Rig {
  const timers = new Map<number, () => void>();
  let next = 0;
  const schedule: Scheduler = (run) => {
    const id = next++;
    timers.set(id, run);
    return () => {
      timers.delete(id);
    };
  };
  const callbacks = new Map<string, (relative: string) => void>();
  const closed: string[] = [];
  const watch: Watcher = (root, onChange) => {
    callbacks.set(root, onChange);
    return () => {
      closed.push(root);
    };
  };
  const events: SourceChange[] = [];
  const bridge = createAssetBridge({
    registryRoot: w.registryRoot,
    studioRoot: w.studioRoot,
    vocabulary: { ok: true, vocabulary },
    watch,
    schedule,
    emit: (change) => events.push(change),
    ...options,
  });
  return {
    bridge,
    events,
    closed,
    watchers: [w.registryRoot, w.studioRoot].map((root) => ({
      root,
      touch: (relative) => callbacks.get(root)?.(relative),
    })),
    pending: () => timers.size,
    tick() {
      const due = [...timers.entries()];
      for (const [id, run] of due) {
        timers.delete(id);
        run();
      }
    },
  };
}

export function getJson<T>(response: BridgeResponse): T {
  return JSON.parse(response.body as string) as T;
}

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
