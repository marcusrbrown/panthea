# studio: the headless authoring CLI

`studio` runs the asset authoring pipeline from a terminal or from another
program. It is a thin front for the SDK in `@panthea/assets/studio`: every
command calls the same functions the app will, and nothing here keeps a private
pipeline or state of its own.

```sh
bun run --cwd tools/studio studio <command> [flags]
```

## Output and exit codes

- stdout carries JSON only: one line per result, `{"ok":true,"result":...}` or
  `{"ok":false,"error":{"code","message",...}}`. In a session each line also
  carries the request `id`.
- stderr carries progress and diagnostics: job ids and statuses, never prompts,
  engine settings, file paths or the output of the server or the editor.
- Exit `0` is success. Exit `64` is a usage, config or content problem
  (`invalid-arguments`, `unknown-op`, `invalid-request`, `missing-config`,
  `invalid-config`, `invalid-content`). Exit `1` is every other refusal or
  failure: a failed or unavailable generation, `busy`, `not-running`,
  `wrong-state`, `confirmation_required`, `revision-mismatch`, `unsupported`.

A generation that does not succeed is exit `1`, never a quiet success.

## Configuration

Pass `--config <file>`. Relative paths in it resolve against the config file's
own directory. `--root <dir>` sets the studio root alone, which is all that
`status`, `list`, `sheet` and `report` need. Nothing has a default: a command
that needs a setting you did not give says which one and exits `64`.

```json
{
  "studioRoot": "work/.studio",
  "contentRoot": "content/greek",
  "registryRoot": "work/registry",
  "artifactRoot": "work/artifacts",
  "runtime": {
    "port": 8190,
    "pollMs": 100,
    "deadlines": { "httpMs": 10000, "startupMs": 120000, "generationMs": 300000, "termGraceMs": 2000, "killMs": 10000 }
  },
  "editor": { "executable": "/path/to/aseprite", "timeoutMs": 30000, "editPollMs": 500 },
  "conform": {
    "standard": {
      "background": { "type": "alpha" },
      "alphaCutoff": 128,
      "grid": { "edgeTolerance": 8, "minConfidence": 0.6, "minEdges": 20 }
    }
  }
}
```

The numbers above only show the shape. Conformance thresholds are the owner's
to choose: every field of a set is required, a background is `{"type":"alpha"}`
or `{"type":"key","rgb":[r,g,b],"tolerance":n}`, and `scale` is optional.
`artifactRoot` must already hold the staged runtime and models; nothing is
downloaded. The editor path falls back to `PATH` and then the macOS app bundle.
The environment is never passed to the server or the editor.

## Commands

| Command | What it does |
| --- | --- |
| `session` | Owns the studio root and serves the commands below as newline-delimited JSON (see Sessions) |
| `generate` | `--id --subject --kind --slots <json> [--batch --seed --style-note]`: builds the request, queues it durably and runs it. Add `--edit-mask <png> --edit-strength <n> --edit-cue <text>` with one base (`--edit-base-job <id> --edit-base-output <sha256>` or `--edit-base-image <png> --edit-base-description <text>`) to make it a masked img2img edit (see Edits) |
| `reroll` | `--request-id --per-slot`: more jobs for a request, continuing its seed sequence |
| `status`, `list <kind>`, `sheet` | Read the durable records without taking the writer lock |
| `resolve` | `--id --subject --kind --slots <json> [--batch --seed --style-note]`: the request `generate` would store and the generation spec built from it, from the content root alone. It takes no lock and writes nothing, so it works while another session owns the root. An omitted seed is drawn and reported; pass the reported seed to `generate` for the same request. An unknown subject, state or kind is the same refusal `generate` gives, with the valid alternatives. Edit files are not accepted. Reply: `{"id","request","spec"}` |
| `source-list`, `source-resolve`, `source-bytes`, `source-keys` | The preview's asset source: published canon (`registryRoot`) plus the store's drafts and approved records (`studioRoot`), validated against the `contentRoot` vocabulary. Read-only, no lock (see Asset source) |
| `report` | `--working-set-id --slot`: a fresh report-only conformance of the slot's stored pixels against the current `contentRoot` palette, without the writer lock; exit `1` with the exact diff when conforming would change them |
| `edit-report` | `--id`: the latest save of an open or finished edit, without the writer lock and without writing. Per slot and frame: the stored report-only result (`report`, `failedChecks`) and the pixels changed against the version the save was measured against (`change`, `pixelsChanged`, `diff`), which is the save before it, or the frames the edit opened with. `diffAgainst` is `unavailable` for a save made before that was recorded. Frames the save has beyond that version are `addedFrames`; frames it lacks are `removedFrames`. A discarded edit, or one with no save, is `wrong-state`; an unknown one is `not-found`. Reply: `{"editId","workingSetId","state","sheetHash","metadataHash","slots":[{"slot","diffAgainst","frames":[{"index","report","failedChecks","change","pixelsChanged","diff"}],"addedFrames","removedFrames"}]}` |
| `candidate-frames`, `candidate-bytes` | `--candidate-id`: a conformed candidate's stored image, read without the writer lock. That is the 1x image the conformance sampled from the generated original, which a pick keeps as the slot's pixels; not the palette-snapped proposal and not the larger original. A candidate is one still, so there is one frame and `durationMs` is `null`. `candidate-frames` is the metadata, `{"candidateId","width","height","frames":[{"index","durationMs","imageHash"}]}`; `candidate-bytes` adds `"base64"` (the PNG, checked against `imageHash`) to each frame and is reached only by the app's byte path. An unknown candidate is `not-found`, one that needs a scale is `wrong-state`, and a missing or altered blob is `corrupt-blob` |
| `remove`, `abort` | Cancel a queued job, or the running one (only the process that owns it) |
| `conform` | `--job-id` with `--set <name>` or `--params <json>`: a candidate from a generated image |
| `set create`, `set replace-sheet`, `pick` | Working sets and keyframe picks |
| `reject` | Rejects a packed draft |
| `open`, `import`, `finish`, `discard`, `export` | Hand edits, in the editor or with files; `open` replies with `workspacePath`, the absolute path of the workspace file, for a host that launches the editor on it; `finish --png --json` also takes `--method hand\|script` (default `hand`) and `--description` (required for `script`: what ran), so a scripted edit is not recorded as a hand edit |
| `pack`, `approve`, `approve-with-exception`, `publish` | Final records and canon |
| `derive` | Not supported: exits `1` and changes nothing |

`--slots`, `--params` and the other JSON flags take JSON text or `@file`.

## Edits

A `generate` with the `--edit-*` flags edits an existing image instead of
drawing from noise. White mask pixels are the ones the model may change; the
mask must be an opaque black-and-white PNG the size of the base and the
generated image, with at least one white pixel, and the strength is above 0 and
at most 1. The base is either a succeeded job's output (`--edit-base-job` and
the output hash it made) or a hand-authored PNG (`--edit-base-image`, with a
description): no job made the latter, so a packed asset records it as hand work,
with its hash, and needs the owner's hand-work licence. The mask and any
hand-authored image are read from their paths and stored as blobs only once the
whole edit has been checked. `--edit-cue` is the wording of the change; the
studio prompts `same Greek god <name>, preserve the same head, hairline, face
shape, eyes, beard, skin and composition; <cue>`, the wording measured in the
art-edit probe. The request, every job's narrowed request and the job's recorded settings
name the base, mask hash and strength, and a packed asset lists the base job
among its related jobs. The runtime sends the pinned sd-server `init_image` and
`mask_image` as base64 PNGs and `strength`. An edit samples with CFG 7 and
distilled guidance 1 (`SELECTED_PROFILE.edit`), the settings the art-edit probe's
CLI runs used; plain generation keeps CFG 1 and sends no distilled guidance.
Edit jobs take about twice as long as plain ones, and record `txt_cfg` and
`distilled_guidance` in their settings.

## One-shot and session

A one-shot `generate` runs the whole drain and exits with the result, so its
answer says `"state":"completed"` and lists the jobs. In a session the same
command answers at once with `"state":"queued"` and the job ids once the queue
write is durable, and the drain runs behind it. These are different answers by
design.

Only one process owns a studio root. Reads work against a root someone else
owns. A one-shot command that changes anything against a root another process
owns is refused with `busy`; there is no remote control of another process.
`abort` only works inside the process that is running the job.

A `session` started on a root another process holds does not exit. It serves
every read and refuses every other op with `root-locked`, whose error carries
`holder` (the holding process id, or `null` when it left no live record).
`status` reports `rootLock`: `{"holder":"self"|"other"|"none","pid":number|null}`,
read from the lock holder's session record and a liveness check. There is no
polling: the session tries the lock again at each write, so the first write
after the holder has exited takes the root (`rootLock` then says `self`), and a
holder that has come back is `root-locked` again. `open`, which exists to
write, still stops with `root-locked` and exit `1`.

### Sessions

`studio session` reads one JSON object per line from stdin:
`{"id":"1","op":"status","args":{}}`, and writes one line per request to stdout
as soon as it settles, carrying the same `id`: `{"id","ok":true,"result"}` or
`{"id","ok":false,"error"}`. A line that is not a valid request is answered with
`"id":null`. Commands never wait on a running generation, so `status`, `remove`,
`abort` and further `generate` calls are answered while the server works. Ops
are the command names above, with `set-create` and `set-replace-sheet` for the
set commands and arguments in camelCase.

At end of input the session finishes the queued jobs and exits `0`, or `1` if the drain stopped on an error or any job it ran failed or was unavailable; jobs the operator removed or aborted do not count against it. `open` is a
session that serves one edit: it builds the workspace, imports it again when the
file's content changes, and exits `0` after `finish` or `discard`, or `1` if
input ends first.

### Asset source

`source-list`, `source-resolve`, `source-bytes` and `source-keys` serve what the
isometric preview reads, through the same node-side core
(`@panthea/assets/studio`, `createPreviewSource`) that backs the Vite dev bridge.
They need `studioRoot`, `registryRoot` and `contentRoot` in the config and take
no writer lock. The source scans on first use and again, after a short
coalescing window, when either root changes; a root that does not exist yet is
picked up once it is created.

| Op | Arguments | Reply |
| --- | --- | --- |
| `source-list` | none | `{"entries":[{"source","id","assetId","kind","state","ok"}],"problems":[{"scope","message"}]}` |
| `source-resolve` | `source` (`canon`, `draft` or `approved`), `id`, optional `state`, `direction`, `ability`, `expression` | `{"kind":"frames","selection","manifestKey","asset","bytes":{"width","height","pixelKey"}}`, or `{"kind":"placeholder","selection","reason","uri","problems","bytes"}` when nothing valid is held |
| `source-bytes` | `source`, `id` and `v` (the `pixelKey` from `source-resolve`), or `placeholder` (a placeholder's `pixelKey`) alone | `{"source","id","pixelKey","width","height","base64"}`, or `{"placeholder","base64"}`; `base64` is the validated PNG. A `v` that is not the selection's current key is refused `stale-version` (resolve again); nothing held is `not-found` |
| `source-keys` | none | `{"listing","selections":[{"source","id","key"}]}`: compare with the previous reply to see what changed |

Ids are lowercase hyphenated slugs; anything else, and any unknown argument, is
`invalid-arguments`. Bytes are pinned to the key they were resolved with, so a
rewritten draft is never served under the old key.

## Approval and publication

Neither is ever automatic and `--yes` is refused. `approve` and
`approve-with-exception` need `--confirm <manifestRevision>` of the draft the
owner reviewed; without it the command exits `1` with `confirmation_required`
and the review metadata, and changes nothing. A wrong revision is
`revision-mismatch`. Success returns the final approved revision, and `publish`
needs `--confirm` with that revision. An exception (`--exception {"reason"}`) is
the owner's approval of a failing report; it does not clear licence terms, which
need separate `--assessments` of the exact records.

## Stopping

`--parent-pid <pid>` (with `session` or `open`) arms a parent guard for a session
run as a sidecar: every two seconds it checks that process is alive, and when it
is not, the session stops exactly as on `SIGTERM`: the editor and runtime close
before the lock is released, and it exits `1`. Without the flag there is no guard.

End of input, an error, `SIGINT` and `SIGTERM` all close the editor and shut the
runtime down before the writer lock is released. If the owned server will not
stop, the process keeps the lock and retries at the configured poll rather than
leaving a server behind. An interrupt during a generation records the running
job as aborted and exits `1`.

## Limits

macOS and POSIX only: the runtime needs process groups. The final cut of the
real model path and the app shell are separate work; the tests here use a staged
fake server and fake editor.
