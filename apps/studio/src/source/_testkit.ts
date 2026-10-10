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
import { vocabulary } from "../../../../packages/assets/src/studio/_test-preview";
import {
  type AssetBridge,
  type BridgeOptions,
  type BridgeResponse,
  createAssetBridge,
  type Scheduler,
  type Watcher,
} from "./dev-bridge";
import type { SourceChange } from "./port";

// The fixtures the core's own tests use are shared, so the adapter and the core are tested on the same worlds.
export {
  type FakeWatch,
  fakeWatchFs,
  firstBlob,
  hiddenRgbSprite,
  publishCanon,
  vocabulary,
  withManifest,
  writeDraft,
} from "../../../../packages/assets/src/studio/_test-preview";

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
