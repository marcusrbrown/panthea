# studio-headroom: what one heavy image job costs beside the running studio

## Question

With the packaged studio open, how much memory, swap, disk and responsiveness does one real Z-Image 512×640 job use on the 16 GiB M1 Pro, and does the studio stay usable while it runs? This is evidence, not a gate.

Status: one run on one host, recorded in `docs/evidence/asset-studio/unit7/README.md`. Nothing here says the studio fits beside the game, an inference model or a second job.

## What it samples

Once per interval (default 2 s; the recorded run used 1 s), `src/run.ts` writes one JSON line to `samples.jsonl` and, when it stops, `summary.json`:

| Field | Source |
| --- | --- |
| Worker (`sd-server`), studio app and studio sidecar: pid, RSS, physical footprint | `ps -axo pid=,ppid=,command=` to find them, `ps -o rss=` and `footprint -p` to read them |
| Memory pressure (1 normal, 2 warn, 4 critical) | `sysctl -n kern.memorystatus_vm_pressure_level` |
| Swap used and total, free and inactive pages | `sysctl vm.swapusage`, `vm_stat` (the coexistence probe's parsers) |
| Free disk | `df -k <path>` |
| Command round trip | one `status` request through a second, read-only `session` of the sidecar binary, timed from the request line to the reply with the same id |

The round trip is **not** the app's own bridge. It measures how long the sidecar takes to answer a `status` read while the generator runs; it does not go through the webview and the native command layer. Driving the app's `studio_call("status")` from outside needs the webview, which the packaged app does not expose.

## How the worker pid is handled

The worker is a different process after every abort. Each tick reads the process table again, finds processes by executable name (`sd-server`, `panthea-studio`, `panthea-studio-sidecar`; never a substring of an argument), and labels every reading with the pid it was read from. A process that has gone by the RSS read is left out of the sample, never recorded as zero. The studio's own sidecar counts only when the studio app is its parent, so the probe's read-only session is not sampled as the studio. `summary.json` lists every pid a role was seen as, with its sample count, and the pid each peak came from.

RSS understates the worker: while the model is loaded the kernel holds much of it compressed or swapped, so the footprint (what Activity Monitor shows as Memory) is the figure to judge by. Both are recorded.

## Run

```sh
bun tools/probes/studio-headroom/src/run.ts --out <dir> --interval-ms 1000 \
  --disk-path <a path on the volume to watch> \
  --roundtrip-sidecar <app bundle>/Contents/MacOS/panthea-studio-sidecar \
  --roundtrip-config <the studio config the app uses>
```

It runs until `SIGINT` or `SIGTERM` (or `--duration-s`), then writes the summary. It never starts, stops or signals a studio process. Run it before the job so the baseline is in the series.

## Tests

`bun test tools/probes/studio-headroom` runs against a fake process table, a fake link to the sidecar and a test clock; no process is started and nothing sleeps. The loop test changes the worker's pid between ticks: each tick re-reads the table, labels the sample with that tick's pid, and the old pid is never sampled again. Others: a pid that is in the table but gone by the RSS read is left out; two workers are both labelled; a sidecar the app did not start is not counted; a failing command leaves its field absent and the rest of the sample intact; the summary's peaks carry their pids; a slow tick shortens the wait rather than delaying the next tick; the round-trip probe times a request to the reply with the same id on the injected clock, ignores a reply for another id, answers `undefined` on a timeout and for a child that is gone or cannot be written to, and leaves no timer running.

## Results

One run, 2026-10-09, Apple M1 Pro 16 GiB, macOS 15.7.9: one Z-Image 512×640 job (110.0 s) queued from the window of the running packaged studio, sampled every 1 s (188 samples; the worker first appears 45 s in). Full method, the AE6 runs and the caveats are in `docs/evidence/asset-studio/unit7/README.md`.

| | Before the job (45 s) | While the worker was up (143 s) |
| --- | --- | --- |
| Worker RSS / physical footprint | no worker | peak 3,776 MiB / 8,548 MiB (pid 87612, the only worker pid; footprint still 8,547 MiB at the end) |
| Studio app RSS (footprint) | 84 MiB | peak 96 MiB (34 MiB) |
| Sidecar RSS (footprint) | 328 MiB | peak 438 MiB (331 MiB) |
| Memory pressure | normal 45 of 45 | normal 18, warn 125, critical 0 |
| Swap used | up to 8,701 MiB | up to 13,041 MiB (swap total 10,240 → 13,312 MiB) |
| Free pages | min 61 MiB | min 14 MiB |
| Free disk | 38,608 MiB at the start | min 34,337 MiB, 35,369 MiB at the end |
| Sidecar `status` round trip | median 168, p95 187, max 203 ms | median 238, p95 408, max 682 ms; 0 of 188 failed over the run |

- The worker's RSS is less than half its footprint: judge by the footprint.
- The round trip is the sidecar answering a read through a second session, not the app's own command bridge.
- Not shown here: a run beside an inference model or the game, a second job, another host.
