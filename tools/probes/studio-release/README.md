# studio-release: what a release followed by a re-acquire costs

## Question

The studio session gives the writer lock back when the app is idle (plan U7, `docs/plans/2026-10-11-001-feat-studio-derivation-repair-plan.md`) and takes it again at the next write. How long should the idle grace be, and does artifact verification need a cache so that the re-acquire is cheap?

Status: one run on one host, 2026-10-11. The server was started once and stopped by the runtime's own teardown.

## Method

`src/measure.ts` works on a **copy** of the real store, so a running app or CLI is not disturbed:

```sh
bun tools/probes/studio-release/src/measure.ts \
  --config .context/studio-pipeline/seated/config-sitting.json [--runs 3] [--skip-server]
```

- Store: `.context/studio-pipeline/u7-creative/studio` (the store `config-sitting.json` and `config-sitting-cli.json` name), 93 MB on disk, copied to a temp dir.
- Artifacts: the staged files in `../panthea/tools/probes/art-local-2` (the pinned `sd-server`, the Z-Image Q3_K diffusion model, the Qwen3 Q4_K_M encoder, the VAE): 5.98 GB in all.
- Status scan: `readStudioStatus` on the copy. Session acquire: `openStudioSession` plus `close()`.
- Artifact verification: stat and sha256 of the binary and the three models, the same work as `verifyArtifacts` in `packages/assets/src/studio/runtime.ts` (not exported, so the probe repeats it). The cached cost is the `statSync` of those files that the cache key needs.
- Cold start, through the production path: a `Studio` in session mode takes a `generate`, its drain starts the owned server, and the clock stops at the first successful `capabilities` answer. `teardown()` then aborts the job and stops the server group. This includes the ack of the `generate` (content load, session acquire, enqueue) and the runtime's own checks (verification, port probe, spawn, readiness poll at 100 ms).
- Host: Apple M1 Pro, 16 GiB, Darwin, Bun 1.4.3. The page cache was warm for the models (they had been read earlier in the day); a cold disk would make verification slower, not faster.

## Results

| Step | Measured |
| --- | --- |
| Status scan (the whole-store read) | 156–162 ms warm; 311–319 ms on the first call |
| Session acquire (`openStudioSession`, recovery included) | 172–175 ms; close under 1 ms |
| Artifact verification, uncached | 5.4–6.2 s (z_image 3.3 s, Qwen3 2.4 s, VAE 0.35 s, binary 12 ms) |
| Artifact verification, cache hit (stat only) | 0.008–0.5 ms |
| `generate` ack in a session (content load, acquire, enqueue) | 682 ms |
| `generate` to first `capabilities` answer, uncached | 7.82 s |
| Server stop with a job just started (abort, TERM, group gone) | 60 ms |
| Port free after the run, no survivor | yes (`lsof`, `pgrep`) |

Reading it: of the 7.82 s from `generate` to a ready server, 5.4–6.2 s is hashing the models, so **verification dominates** (about 70–80 %). What is left, about 1.6–2.4 s, is the ack (0.68 s, of which 0.17 s is the acquire) and the server's own start and readiness.

A release followed by a re-acquire therefore costs about **8 s uncached** and about **2 s with verification cached** (derived from the parts above: a second server start was not made, so the 2 s is not an end-to-end measurement).

## Decisions

**Cache verification per process: yes.** It dominates, so `verifyArtifacts` keeps a process-level set of files that hashed to their pin, keyed on path, size and mtime (to the nanosecond) and the pinned hash. The size is still checked first on every acquire. A file whose key has changed is hashed again, and one that no longer matches is `unavailable` as before. The cost of the shortcut: a file edited in place without changing its size or its nanosecond mtime is not noticed by a process that already verified it. Another process, or a restart, hashes everything again. Tests: `packages/assets/src/studio/runtime.test.ts` ("artifact verification is cached for the life of the process").

**Grace period: 15 s** (`RELEASE_GRACE_MS` in `tools/studio/src/host.ts`).

- A release that is followed by a write costs about 2 s once the cache is warm, and only a `generate` or `reroll` pays that (they need the server). A conform, a pick or a finish needs the session alone: 0.17 s. At 15 s the grace is several times the re-acquire, and a burst of writes (drain, conform, the poll's next list read, the next click) restarts it instead of releasing in the middle.
- A CLI step that finds the root locked waits at most the grace plus the release itself (about 0.1 s idle) after the app's last write. 15 s is short enough to feel like "the app lets go when I stop", and long enough that the app does not drop the lock between the two clicks of a review.
- Releasing also stops the offloaded server, which holds several GB on a 16 GiB host, so a shorter grace gives memory back sooner.
- **The trade-off.** A longer grace (60 s or more) would be right only if verification were not cached: an uncached re-acquire is 8 s, and a premature release would be felt on every `generate`. With the cache, a longer grace buys little (it saves 2 s on the next generate) and costs a CLI user that many more seconds of `root-locked`. A grace much shorter than 15 s (a few seconds) would release between steps of one review and pay 2 s on the next `generate` for no benefit to anyone.

## Limitations

- One host, one run, a warm page cache. The cold-disk cost of verification and the Linux behaviour were not measured.
- The 2 s re-acquire is derived, not measured end to end: only one server start was made. A packaged-app run (plan U7 verification: a CLI write succeeding while the app is open and idle) is the next check.
- The server stop was measured with a job just started, not an idle server after a finished job; `stopGroup` sends TERM and waits the configured grace (2 s in this config) for a server that ignores it, so an idle stop is bounded by `termGraceMs + killMs`, not by this 60 ms.
- Nothing here measures image quality or generation time.
