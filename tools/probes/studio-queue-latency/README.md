# studio-queue-latency: keystroke cost with a long queue

## Question

With 72 jobs in the queue, what does a keystroke in the request form cost, and does giving each queue row only its own job (plan U8) change it?

Status: one run on one host, 2026-10-11. This is a browser harness around the real `WorkflowView`, not the packaged app (see Limitations).

## Method

`main.ts` mounts `WorkflowView` (the same component the packaged app renders) on a fake host with 72 jobs in five statuses and 12 candidates. It types 60 characters into the Subject field with real `input` events and times each one from the dispatch to a forced layout: React's synchronous commit of a discrete event, plus the DOM changes. It also reads the React Profiler time for each commit. The build aliases `react-dom/client` to React's profiling build, so the Profiler reports in a production bundle. A second measure pushes the same 72 jobs as fresh objects (what an unchanged poll looks like) and reads the Profiler time of that commit.

```sh
# from the repo root: build the harness against the current tree
cd apps/studio
OUT_DIR=/tmp/queue-latency bunx vite build --config ../../tools/probes/studio-queue-latency/vite.config.mjs
python3 -m http.server 4571 --bind 127.0.0.1 --directory /tmp/queue-latency &
agent-browser open 'http://127.0.0.1:4571/index.html?jobs=72'
agent-browser eval 'window.measureKeystrokes({keystrokes: 60}).then(r => JSON.stringify(r))'
agent-browser eval 'window.measureSnapshots({polls: 30}).then(r => JSON.stringify(r))'
```

"Before" is the tree at commit `6869739` (U7), built with the same config; "after" is the tree with U8. Host: Apple M1 Pro, headless Chrome through `agent-browser`, production React (profiling build), no CPU throttling. Five runs of 60 keystrokes each, three runs of 30 polls.

## Results

| Measure | Before | After |
| --- | --- | --- |
| Keystroke, median per run | 1.2–1.3 ms | 0.5–0.6 ms |
| Keystroke, p95 per run | 1.2–1.7 ms | 0.6–0.8 ms |
| Keystroke, worst of 300 | 3.5 ms | 1.7 ms |
| React render per keystroke, median | 0.4–0.5 ms | 0.1–0.2 ms |
| React render for an unchanged poll, median | 0.4–0.6 ms | 0.3–0.4 ms |

The keystroke cost fell by about half. The change is that a row is `memo`ized and given its own job, a small context of primitives, its candidate and handlers that never change identity, so typing in the form renders none of the 72 rows. The unchanged poll improves less: the jobs keep their identity, but the candidate records arrive as new objects every poll, and the 12 rows that have one still render.

## Limitations

- **This host does not show the problem.** At 72 jobs the old keystroke already cost about 1.2 ms in Chrome on an M1 Pro, far under a frame. The halving is real and reproducible, but nothing here reproduces a visibly slow keystroke. The slowness the plan reports was seen in the packaged app (WKWebView, with the preview canvas running beside it), which this harness does not include.
- **No packaged-app number.** WKWebView in a release build has no inspector, and the app has no in-page timing hook, so a keystroke could not be timed there. A packaged measurement would need a timing hook in the app or a remote inspector; neither was added.
- No CPU throttling was applied, so the absolute numbers are a floor for slower machines.
- Candidate records are not yet kept by identity across polls (only jobs are, as the plan states).
