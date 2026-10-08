---
title: Live-reload asset bridges need version-keyed bytes and watches for late roots
date: 2026-10-08
category: integration-issues
module: studio-preview
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "An atlas URL from an earlier resolve served the newer bytes with HTTP 200"
  - "The preview committed new bytes under the old frame layout and never re-resolved"
  - "Drafts never appeared when the store root was created after the dev server started, even after a browser refresh"
root_cause: missing_validation
resolution_type: code_fix
tags: [studio, live-reload, vite, asset-bridge, fs-watch, pixel-key, cache-invalidation]
---

# Live-reload asset bridges need version-keyed bytes and watches for late roots

## Problem

The studio's Vite dev-server bridge (`apps/studio/src/source/dev-bridge.ts`) serves validated canon, draft and approved assets to the browser and pushes change events for live reload. It had two defects, both fixed in #179:

- Atlas URLs weren't tied to the pixels they were resolved for.
- A store root that was missing at startup was never watched.

## Symptoms

- `bridgePaths.atlas` builds `/atlas/<source>/<id>?v=<pixelKey>`, but the endpoint ignored `v`. A file change between `resolve()` and `fetchBytes()` meant the old URL returned the new bytes with HTTP 200. The preview committed them under the old size and frames, and its re-resolve path, which runs only when a fetch fails, never ran.
- On a fresh checkout, the authoring CLI creates `.studio` after the preview starts. Drafts written afterwards never appeared. Refreshing didn't help, because requests read the bridge's cached model.

## What Didn't Work

Serving the current atlas for a selection id failed because the id is stable over time, but the pixels behind it are not.

Returning a no-op watcher for a missing root failed because the real watcher never fired after `.studio` appeared.

The injected test watcher registered callbacks even for roots that didn't exist, so tests passed while the real watcher never fired.

## Solution

1. **Pin atlas fetches to the resolved pixel key.** `atlas()` receives `url.searchParams.get("v")` and returns 404 when it is missing or differs from the held `pixelKey`. The preview's existing fetch-failure path then re-resolves.

   ```ts
   return found === undefined || found.pixelKey !== pixelKey
     ? refused(404, "no validated atlas for this selection")
     : png(found.atlas);
   ```

2. **Watch a missing root until it appears.** `fsWatcher(root, onChange, fs = nodeWatchFs)` handles three cases:
   - While the root is missing, it watches the nearest existing ancestor, non-recursively.
   - Each time a deeper level appears, it moves the watch down to that level.
   - When the root itself appears, it closes the ancestor watch, attaches a recursive watch on the root, and calls `onChange("")`.

   The empty path gets past the store filter, which otherwise only rescans for `assets/` and `blobs/` changes:

   ```ts
   if (root === "store") {
     const first = relative.split(/[\\/]/)[0] ?? "";
     if (first !== "" && first !== "assets" && first !== "blobs") return;
   }
   ```

## Why This Works

A URL now names one exact set of pixels. When the pixels change, the old URL fails loudly, and the client's retry gets a fresh resolution whose layout matches its bytes.

`pixelKey` is `canonicalFrameHash` of the decoded atlas, which ignores RGB under alpha 0. A re-export that changes only invisible pixels keeps both the key and the URL, so it causes no spurious reload. `manifestKey` leaves out only the atlas blob hash, so any other manifest change still changes the layout key.

The watcher fix makes startup order irrelevant. If the root exists, it is watched. If it appears later, the bridge rescans and announces it.

## Prevention

- **Version-key every byte URL a client resolves, and enforce the key on the server.** A query parameter the server ignores only busts caches; it doesn't pin the content.
- **`apps/studio/src/source/dev-bridge.test.ts` pins both fixes:**
  - after a pixel change, the old URL is 404 and the new URL serves the new bytes;
  - a missing or wrong `v` is 404;
  - an RGB-only change under alpha 0 keeps the key;
  - the watcher moves from ancestor to recursive root and reports `""`;
  - a store created after the bridge starts lists its first draft and emits one change.
- **Test watchers through the production logic with injected fs primitives** (`WatchFs`: `exists`, `watch`), not through a fake that ignores whether the path exists. The thin `node:fs` wrapper itself stays untested.
- **Keep `resolveAsset` on the node side.** `@panthea/assets` isn't browser-safe, because `resolve` imports `placeholder`, which imports `node:crypto` and `node:zlib`. The browser imports types only, and the studio's scripts run Vite through Bun (`bun --bun vite`).

## Related

- `docs/solutions/integration-issues/catch-up-summary-lost-between-polls-2026-09-28.md`: identity across a polling boundary, the same lesson on a different surface.
- `docs/solutions/logic-errors/transparent-rgb-bytes-broke-grid-recovery-2026-10-05.md`: the alpha-0 canonicalisation that `pixelKey` relies on.
- `docs/solutions/integration-issues/incomplete-pngs-pass-hash-and-header-checks-2026-10-04.md`: why every atlas still passes `checkBlob`.
- `docs/solutions/logic-errors/client-view-presentation-against-invented-fixtures-2026-09-28.md`: test doubles that don't match real behaviour hide real failures.
