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
  "render": { "executable": "/Applications/Blender.app/Contents/MacOS/Blender", "watchdogMs": 60000 },
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

`render` configures the pre-rendered retro engine (pinned Blender 5.2.2, build
`d13f752e3b9c`). `executable` is the owner's alone and must live outside
`artifactRoot`; the runtime hashes it against the pinned sha256 (cached by size
and mtime) and never searches `PATH`. Without it, render jobs are marked
`unavailable` with guidance and image jobs still run. `renderRoot` (default
`<contentRoot>/../../tools/render`) holds the kits, profiles, camera and stamps,
`tempParent` the per-batch scratch directories, and `watchdogMs` is how long a
render may go without a new frame or any output before it is stopped and failed.
One engine is live at a time: `sd-server` stops before a render batch and
restarts after it, and at critical memory pressure (level 4) no engine launches
and the head job stays queued until pressure drops.

## Commands

| Command | What it does |
| --- | --- |
| `session` | Owns the studio root and serves the commands below as newline-delimited JSON (see Sessions) |
| `generate` | `--id --subject --kind --slots <json> [--batch --seed --style-note]`: builds the request, queues it durably and runs it. Add `--edit-mask <png> --edit-strength <n> --edit-cue <text>` with one base (`--edit-base-job <id> --edit-base-output <sha256>`, `--edit-base-image <png> --edit-base-description <text>`, or `--edit-base-published <asset>@<revision>:<slot>#<frame> --edit-base-frame-hash <sha256>`) to make it a masked img2img edit (see Edits and Repair). `--reference <json>` asks for reference conditioning and is always refused as `unavailable` |
| `generate` (recipe) | The same `--id --subject --slots`, with `--kind sprite --palette <id> --pivot '{"x":56,"y":78}'` instead of batch, seed and style note: a recipe request for the render engine (Blender). The render profile comes from the subject's visual profile; the request is stored at batch 1 and seed 0, one job per slot, with provider `blender-eevee`. `--palette` and `--pivot` come together, a batch, seed, style note or edit is refused, and so is a portrait. `resolve` takes the same two flags |
| `reroll` | `--request-id --per-slot [--slot-key]`: more jobs for a request, continuing its seed sequence. With `--slot-key` only that slot gets the new jobs (an unknown slot key is `invalid-request` and queues nothing); without it every slot does |
| `status`, `list <kind>`, `sheet` | Read the durable records without taking the writer lock. `status` also lists `conformSets`, the names of the config's conform sets (never their settings). It also lists `openEdits`, `[{"id","previewSheetHash"}]` for each open edit (`previewSheetHash` is `null` before its first save): a save imported by the watcher changes no count, so a host that polls `status` sees it by comparing this. In `list jobs`, a succeeded job carries `candidate`: `"done"`, `"needs-scale"`, or `null` when it has not been conformed (a candidate's id is its job's id) |
| `resolve` | `--id --subject --kind --slots <json> [--batch --seed --style-note]`: the request `generate` would store and the generation spec built from it, from the content root alone. It takes no lock and writes nothing, so it works while another session owns the root. An omitted seed is drawn and reported; pass the reported seed to `generate` for the same request. An unknown subject, state or kind is the same refusal `generate` gives, with the valid alternatives. Edit files are not accepted. Reply: `{"id","request","spec"}` |
| `source-list`, `source-resolve`, `source-bytes`, `source-keys` | The preview's asset source: published canon (`registryRoot`) plus the store's drafts and approved records (`studioRoot`), validated against the `contentRoot` vocabulary. Read-only, no lock (see Asset source) |
| `report` | `--working-set-id --slot`: a fresh report-only conformance of the slot's stored pixels against the current `contentRoot` palette, without the writer lock; exit `1` with the exact diff when conforming would change them |
| `edit-report` | `--id`: the latest save of an open or finished edit, without the writer lock and without writing. Per slot and frame: the stored report-only result (`report`, `failedChecks`) and the pixels changed against the version the save was measured against (`change`, `pixelsChanged`, `diff`), which is the save before it, or the frames the edit opened with. `diffAgainst` is `unavailable` for a save made before that was recorded. Frames the save has beyond that version are `addedFrames`; frames it lacks are `removedFrames`. A discarded edit, or one with no save, is `wrong-state`; an unknown one is `not-found`. Reply: `{"editId","workingSetId","state","sheetHash","metadataHash","slots":[{"slot","diffAgainst","frames":[{"index","report","failedChecks","change","pixelsChanged","diff"}],"addedFrames","removedFrames"}]}` |
| `candidate-frames`, `candidate-bytes` | `--candidate-id`: a conformed candidate's stored image, read without the writer lock. That is the 1x image the conformance sampled from the generated original, which a pick keeps as the slot's pixels; not the palette-snapped proposal and not the larger original. A candidate is one still, so there is one frame and `durationMs` is `null`. `candidate-frames` is the metadata, `{"candidateId","width","height","frames":[{"index","durationMs","imageHash"}]}`; `candidate-bytes` adds `"base64"` (the PNG, checked against `imageHash`) to each frame and is reached only by the app's byte path. An unknown candidate is `not-found`, one that needs a scale is `wrong-state`, and a missing or altered blob is `corrupt-blob` |
| `remove`, `abort` | Cancel a queued job, or the running one (only the process that owns it) |
| `conform` | `--job-id` with `--set <name>` or `--params <json>`: a candidate from a generated image. For a render job it takes neither (they are not used): the job is read back through its role manifest into a rendered candidate with every cell measured against the asset's palette limits and the declared pivot; the reply is `{candidateId,slotKey,frames,failedChecks,revisionRecipeHash,slotRecipeHash}` |
| `edit-workspace` | `--id`: an edit that is already open, named again for a host that relaunches the editor on it. Replies like `open` (`editId`, `slots`, `workspace`, `workspacePath`); rebuilds the workspace file only if it is gone, and keeps one watch per edit. `not-found` for an unknown edit, `wrong-state` for a finished or discarded one, `workspacePath: null` with no editor configured. Not a read: it takes the writer lock |
| `set create`, `set replace-sheet`, `pick` | Working sets and keyframe picks |
| `reject` | Rejects a packed draft |
| `open`, `import`, `finish`, `discard`, `export` | Hand edits, in the editor or with files; `open` replies with `workspacePath`, the absolute path of the workspace file, for a host that launches the editor on it, or `null` when no `editor` is configured (the edit is still created, with its sheet and metadata, so `export` and `import`/`finish --png --json` work); `finish --png --json` also takes `--method hand\|script` (default `hand`) and `--description` (required for `script`: what ran), so a scripted edit is not recorded as a hand edit. `finish --reviewed <sheetHash>` names the save the owner reviewed (an `edit-report`'s `sheetHash`, 64 lowercase hex digits): if the sheet the finish would take (the editor's fresh export, or `--png`) hashes differently, it is refused as `stale-review`, nothing is written and the edit stays open. Without `--reviewed` a finish takes whatever is there |
| `pack`, `approve`, `approve-with-exception`, `publish` | Final records and canon |
| `derive` | `derive --asset <id> --op mirror\|palette-swap\|bob --from <slot> [--to <slot or family>] [--params <json>]` reads the asset's published revision and writes a working set of derived slots (a write op: it takes the writer lock). `mirror` makes `<state>/west` from `<state>/east` for idle, seated, hurt and down, and is refused as `asymmetric` (naming the feature) when the subject declares one, `off-centre-pivot` or `non-square-footprint` when the geometry is off, and `non-derivable` for walk and act. `bob` rebuilds an idle loop from the rest frame; `--params` is `{region, exclude, dy, durationsMs, seam, repairs}` (all integers; a default breathing loop when omitted), and it is `non-derivable` for any state but idle. `palette-swap` takes the asset's own palette family as `--from` and the target family as `--to`, and adds a realm variant (its own atlas and an inline colour map, regenerated at every pack); `--params '{"ramps":[["marble","ash"]]}'` pairs ramps, else they pair by order, and unequal ramps are `ramp-length`, an opaque colour in none of them `unmapped-colour`. The reply is `{workingSetId, created, slots}`; the same inputs return the set they made, with `created: false`. Then `pack`, `approve` and `publish` run as for drawn art: pack gates conformance on the derived slots, publish recomputes every step and variant from its published source and refuses a mismatch, naming it. A derived slot that is hand-edited and finished becomes a hand step and is never recomputed. A set that mixes derived and generated slots is refused at pack |

`--slots`, `--params` and the other JSON flags take JSON text or `@file`.

## Parity check

`bun tools/studio/src/parity.ts --a <root> --a-candidate <id> --b <root> --b-candidate <id>` reads two conformed candidates without the writer lock and compares the decoded generated image, the decoded conformed 1x image, the conformance report and the metrics. It prints one JSON line and exits `0` when they are identical, `1` when they differ (naming the first differing pixel) or a candidate cannot be read, and `64` for a usage error. The seed is shown, not compared: a different seed shows up as different pixels. `parity.test.ts` pins the comparison and the CLI-path against session-path pair against the staged fake runtime; the packaged-app run is recorded in `docs/evidence/asset-studio/unit7/README.md`.

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

## Repair

A masked edit can start from one frame of a published revision, which is how a
frame that cannot be derived (a walk or act pose, or a west cell of a subject
that declares an asymmetry) is redrawn. Name it
`--edit-base-published <asset>@<revision>:<slot>#<frame>` (the revision is its
64-character hash, the frame a zero-based index) with
`--edit-base-frame-hash <sha256>`, the hash of the frame's cell as a PNG with
the colour under alpha 0 zeroed. The hash is required: it fixes which pixels
the edit started from, and a request naming another is refused. The session
reads the frame from the registry (`registryRoot` in the config), checks the
hash, and scales the cell by the whole generation factor with nearest pixels to
make the base. A refusal names its reason: `missing-revision`, `missing-slot`,
`missing-frame` or `frame-hash-mismatch` (which also prints the hash the frame
really has). A base whose size is not a whole multiple of the request's is
refused.

The result is an ordinary `generated` candidate in its own working set: pick it,
finish it in the editor, pack, review, approve and publish it like drawn art.
Pack requires the base to be a frame of the revision now published for the asset
it packs, records the base frame ref with the mask, strength and cue in the
generation, lists that revision in `sourceAssets` and carries its licences. A
repair candidate cannot share a working set with a new derived slot; pack them in
separate revisions. A repair of an asset whose published revision holds derived
cells or realm variants stays `generated` and carries their steps in
`provenance.steps`, so the derivation is not lost; publish recomputes those steps
like any derived revision's.

Mask and base files are paths and stay on the command line; the app does not
take them.

### Reference conditioning

`--reference` is accepted so that a request that asks for it fails loudly. It
returns `unavailable` before the studio lock is taken or anything is stored. The
probe that tested reference-conditioned facing and pose on the pinned sd-server
did not pass (NO-GO): facing failed, and the seated pose missed its ceiling by a
hair. The result is in `tools/probes/art-reference/README.md`. The repair route
is the masked edit above.

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
| `source-resolve` | `source` (`canon`, `draft` or `approved`), `id`, optional `realm` (a realm palette family: its variant atlas instead of the base atlas; a realm the asset does not publish resolves as a placeholder, `missing-state`), optional `state`, `direction`, `ability`, `expression` | `{"kind":"frames","selection","manifestKey","asset","bytes":{"width","height","pixelKey"}}`, or `{"kind":"placeholder","selection","reason","uri","problems","bytes"}` when nothing valid is held |
| `source-bytes` | `source`, `id`, optional `realm` and `v` (the `pixelKey` from `source-resolve`), or `placeholder` (a placeholder's `pixelKey`) alone | `{"source","id"[,"realm"],"pixelKey","width","height","base64"}`, or `{"placeholder","base64"}`; `base64` is the validated PNG. A `v` that is not the selection's current key is refused `stale-version` (resolve again); nothing held is `not-found` |
| `source-keys` | none | `{"listing","selections":[{"source","id","key"}]}`: compare with the previous reply to see what changed |

Ids are lowercase hyphenated slugs; anything else, and any unknown argument, is
`invalid-arguments`. Bytes are pinned to the key they were resolved with, so a
rewritten draft is never served under the old key.

## Rendered assets

A recipe request renders each slot once (`generate` above). Each succeeded job holds the post-step cells in frame order and a role manifest blob (`engine.settings.manifest`) that names the raw colour, part-ID and depth frames, the locators the post step stamped from, and the recipe hashes. Then:

1. `conform --job-id <job>` reads the job back as a rendered candidate (stored under `rendered-candidates/`, separate from image candidates).
2. `pick` takes the candidate id; **all** of the slot's frames go into the working set with no edit step, and the slot counts as done. A pick refuses a slot with authored frames or an image pick.
3. `open` and `finish` work on a rendered slot like any other; the hand step records which job it started from, and the slot leaves the rendered entries.
4. `pack` writes `rendered` provenance: the revision recipe, a slot entry per rendered slot (raw frame hashes per role), the kit licences and the related jobs. It refuses a revision whose slots were not all rendered under one revision recipe hash, a generated (image-model) pick, and any cell carried from an earlier revision.
5. `publish` runs a render audit on top of the usual gates, offline and without Blender: it recomputes the revision recipe from the committed profile, camera, kit files, stamp set, script, post-step version, Blender pin and the palette on disk, runs the post step again from the stored raw frames and compares every cell and the atlas (a hand-edited slot keeps its hand pixels), and checks the job ledger. It needs `render.renderRoot` (default `<contentRoot>/../../tools/render`).

Manifest timing for a rendered slot is its state's fastest allowed rate (`1000 / fps.max` ms a frame, so walk is 50 ms); a looping clip (idle, walk, seated) has `loopStart` 0, the act clip none. `status` lists `renderSubjects`, the subjects that name a render profile.

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
