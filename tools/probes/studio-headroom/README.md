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

`bun test tools/probes/studio-headroom` runs against a fake process table that the test changes between ticks: the worker pid changes and the old pid is never read again; a pid that is in the table but gone by the RSS read is left out; two workers are both labelled; a sidecar the app did not start is not counted; a failing command leaves its field absent and the rest of the sample intact; the summary's peaks carry their pids; the round-trip probe times a real child, ignores a reply for an earlier request and answers `undefined` for a child that is gone or silent.

## Results

See the headroom table in `docs/evidence/asset-studio/unit7/README.md`.
