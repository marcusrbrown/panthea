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
| `generate` | `--id --subject --kind --slots <json> [--batch --seed --style-note]`: builds the request, queues it durably and runs it |
| `reroll` | `--request-id --per-slot`: more jobs for a request, continuing its seed sequence |
| `status`, `list <kind>`, `sheet` | Read the durable records without taking the writer lock |
| `report` | `--working-set-id --slot`: a fresh report-only conformance of the slot's stored pixels against the current `contentRoot` palette, without the writer lock; exit `1` with the exact diff when conforming would change them |
| `remove`, `abort` | Cancel a queued job, or the running one (only the process that owns it) |
| `conform` | `--job-id` with `--set <name>` or `--params <json>`: a candidate from a generated image |
| `set create`, `set replace-sheet`, `pick` | Working sets and keyframe picks |
| `reject` | Rejects a packed draft |
| `open`, `import`, `finish`, `discard`, `export` | Hand edits, in the editor or with files |
| `pack`, `approve`, `approve-with-exception`, `publish` | Final records and canon |
| `derive` | Not supported: exits `1` and changes nothing |

`--slots`, `--params` and the other JSON flags take JSON text or `@file`.

## One-shot and session

A one-shot `generate` runs the whole drain and exits with the result, so its
answer says `"state":"completed"` and lists the jobs. In a session the same
command answers at once with `"state":"queued"` and the job ids once the queue
write is durable, and the drain runs behind it. These are different answers by
design.

Only one process owns a studio root. Reads work against a root someone else
owns. A command that changes anything against a root another process owns is
refused with `busy`; there is no remote control of another process. `abort`
only works inside the process that is running the job.

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

End of input, an error, `SIGINT` and `SIGTERM` all close the editor and shut the
runtime down before the writer lock is released. If the owned server will not
stop, the process keeps the lock and retries at the configured poll rather than
leaving a server behind. An interrupt during a generation records the running
job as aborted and exits `1`.

## Limits

macOS and POSIX only: the runtime needs process groups. The final cut of the
real model path and the app shell are separate work; the tests here use a staged
fake server and fake editor.
