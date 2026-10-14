// The owner of one studio root for the life of a process: it opens the SDK
// session on first use, lazily creates the runtime and the editor adapter,
// shares one drain between every command, watches open edits, and tears
// everything down in an order that keeps the root locked until the owned
// server is really gone. A session-mode process also gives the writer lock
// back after a grace period when it is idle, and takes it again at the next
// write: that release is its own path, not `teardown()`.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PaletteSet } from "@panthea/assets";
import {
  type AsepriteConfig,
  BLENDER_PIN,
  createEditorAdapter,
  createPreviewSource,
  type EditorAdapter,
  type EngineCells,
  fsWatcher,
  type LoadedContent,
  type LoadedPalettes,
  loadStudioContent,
  loadStudioPalettes,
  openRuntime,
  openStudioSession,
  type PreviewScheduler,
  type PreviewSource,
  type PreviewWatcher,
  type RuntimeConfig,
  readStudioStatus,
  renderEngineFor,
  type SelectedProfile,
  type StudioContent,
  type StudioOpen,
  type StudioRuntime,
  type StudioSession,
  type StudioStatus,
  studioPaths,
  systemMemoryPressure,
  timerScheduler,
} from "@panthea/assets/studio";
import type { StudioConfig } from "./config";
import {
  done,
  type Json,
  jobSummary,
  type Outcome,
  refuse,
  safeMessage,
} from "./format";

export interface Deps {
  readonly loadContent: (root: string) => LoadedContent;
  /** Reads every palette under the content root afresh; pack, approve and publish judge these, never the palettes of the cached content. */
  readonly loadPalettes: (
    root: string,
    families: readonly string[],
  ) => LoadedPalettes;
  readonly openSession: (root: string) => StudioOpen;
  readonly readStatus: (root: string) => StudioStatus;
  readonly openRuntime: (
    session: StudioSession,
    config: RuntimeConfig,
  ) => StudioRuntime;
  readonly createEditor: (
    session: StudioSession,
    config: AsepriteConfig,
  ) => EditorAdapter;
  /** A runtime profile other than the selected production one, for tests of a staged runtime. */
  readonly profile?: SelectedProfile;
  readonly drawSeed: () => number;
  /** Watches a root for changes, including one that does not exist yet; the preview source rescans on them. */
  readonly watchRoot: PreviewWatcher;
  /** The clock: runs a callback once after a delay. The preview source's coalesced rescans and the parent guard's polls use it. */
  readonly schedule: PreviewScheduler;
  /** Whether a process id names a live process; status uses it to tell an open session from a crashed one. */
  readonly isAlive: (pid: number) => boolean;
  readonly sleep: (ms: number) => Promise<void>;
  /** The system memory pressure level (4 is critical); at critical no engine is launched. */
  readonly pressure: () => number | undefined;
  /** Progress and diagnostics: ids and statuses only, never prompts or output tails. */
  readonly log: (line: string) => void;
}

/** Signal 0 only checks that the process exists; EPERM means it exists under another user. */
export const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const defaultDeps = (log: (line: string) => void): Deps => ({
  loadContent: loadStudioContent,
  loadPalettes: loadStudioPalettes,
  openSession: openStudioSession,
  readStatus: readStudioStatus,
  openRuntime,
  createEditor: createEditorAdapter,
  drawSeed: () => crypto.getRandomValues(new Uint32Array(1))[0] as number,
  watchRoot: fsWatcher,
  schedule: timerScheduler,
  isAlive: processAlive,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pressure: systemMemoryPressure,
  log,
});

export const isOutcome = (value: unknown): value is Outcome =>
  typeof value === "object" && value !== null && "ok" in value;

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Where an edit's workspace file lives under the session's root. */
const workspaceFile = (session: StudioSession, editId: string) =>
  join(studioPaths(session.store.root).edits, editId, "workspace.aseprite");

interface Watch {
  /** Cancels the poll that is armed; undefined while an import is running. */
  cancel: (() => void) | undefined;
  live: boolean;
  baseline: string;
  busy: boolean;
}

/**
 * How long an idle session keeps the writer lock. From tools/probes/studio-release:
 * a release followed by a re-acquire comes to about 8 s without the artifact
 * verification cache and about 2 s with it (derived from the measured parts: the
 * session acquire is 0.17 s, the server's cold start the rest). The grace has to outlast
 * an automatic burst (drain, conform, the poll's next list) and a review's
 * clicks, and bounds how long a CLI step finds the root locked after the app's
 * last write.
 */
export const RELEASE_GRACE_MS = 15_000;

/** The margin quit adds to the runtime's own stop deadlines. */
const RELEASE_MARGIN_MS = 3000;

/** An import the watcher did not attempt: the next poll tries again with the baseline untouched. */
const RETRY_IMPORT = new Set([
  "root-locked",
  "shutting-down",
  "release-failed",
  "busy",
]);

export class Studio {
  stopRequested: string | undefined;
  /** True once the edit being foreground-watched ends by finish or discard. */
  editEnded: ((editId: string) => void) | undefined;
  private session: StudioSession | undefined;
  private content: StudioContent | undefined;
  private runtime: StudioRuntime | undefined;
  private editor: EditorAdapter | undefined;
  private preview: PreviewSource | undefined;
  private drain: Promise<void> | undefined;
  private refusal: string | undefined;
  private unfinished = 0;
  private tearingDown: Promise<void> | undefined;
  private readonly watches = new Map<string, Watch>();
  /** Jobs this process is running or has queued, by the status last reported. */
  private readonly watched = new Map<string, string>();
  /** Ops running now that may use the lock (the release op and `status` are not counted). */
  private inflight = 0;
  /** The release in progress; it settles with its outcome and is never rejected. */
  private releasing: Promise<Outcome> | undefined;
  /** Why the last release attempt failed; the lock is still held while this is set. */
  private releaseFailure: string | undefined;
  /**
   * The release's steps (editor close, runtime shutdown, session close) while
   * they are still running. A release whose bound fired leaves them running:
   * until they settle nobody is handed the session they are closing.
   */
  private releaseSteps: Promise<void> | undefined;
  private cancelGrace: (() => void) | undefined;
  /** Whether a write used the lock since the grace was armed: a write restarts the grace, a read does not. */
  private touched = false;
  /** Jobs this process saw reach a terminal status, and jobs a `list jobs` read has carried since. A result has reached the client when it is in both. */
  private readonly settledJobs = new Set<string>();
  private readonly shown = new Set<string>();

  constructor(
    readonly config: StudioConfig,
    readonly deps: Deps,
    readonly mode: "oneshot" | "session",
  ) {}

  get stopping(): boolean {
    return this.tearingDown !== undefined;
  }

  get root(): string | undefined {
    return this.config.studioRoot;
  }

  /** The durable records, read without taking the writer lock. */
  readOnly(): StudioStatus | Outcome {
    if (this.root === undefined) return this.missing("studioRoot");
    return this.session === undefined
      ? this.deps.readStatus(this.root)
      : this.session.store.status();
  }

  missing(what: string): Outcome {
    return refuse(
      "missing-config",
      `${what} is not configured: set it in the config file${what === "studioRoot" ? " or pass --root" : ""}`,
      { field: what },
    );
  }

  /**
   * Who holds the writer lock, as the durable records and a liveness check
   * say. `none` also covers a lock whose holder left no live record: nothing
   * is guessed. A session that has the lock itself reports `self`.
   */
  rootLock(status: StudioStatus): Json {
    if (this.session !== undefined)
      return { holder: "self", pid: status.session?.pid ?? process.pid };
    const record = status.session;
    return record !== undefined &&
      record.endedAt === undefined &&
      this.deps.isAlive(record.pid)
      ? { holder: "other", pid: record.pid }
      : { holder: "none", pid: null };
  }

  /** The typed refusal of a write while another process holds the root. */
  private rootLocked(): Outcome {
    const lock =
      this.root === undefined
        ? undefined
        : this.rootLock(this.deps.readStatus(this.root));
    const holder =
      lock !== undefined &&
      typeof lock === "object" &&
      !Array.isArray(lock) &&
      lock?.holder === "other"
        ? (lock.pid as number)
        : null;
    return refuse(
      "root-locked",
      holder === null
        ? "another process holds this studio root; this session is read-only"
        : `another studio session (pid ${holder}) holds this studio root; this session is read-only`,
      {
        holder,
        hint: "reads still work; a write is accepted once the holder has exited",
      },
    );
  }

  /**
   * Waits out a release in progress. A caller that had to wait while the
   * release failed gets the typed refusal: the lock was kept, but the runtime
   * it would have used is gone.
   */
  private async afterRelease(): Promise<Outcome | undefined> {
    // The steps of a release whose bound fired may still be running: the
    // session is being closed under them, so nobody is handed it. (Waiting for
    // them could wait forever on a shutdown that never answers.)
    const stillRunning = () =>
      this.releaseSteps === undefined
        ? undefined
        : refuse(
            "release-failed",
            "a release that did not finish is still running; the lock is kept",
            { hint: "wait for it, release again later, or quit the app" },
          );
    if (this.releasing === undefined) return stillRunning();
    while (this.releasing !== undefined) await this.releasing;
    return (
      stillRunning() ??
      (this.releaseFailure === undefined
        ? undefined
        : refuse(
            "release-failed",
            "releasing the writer lock failed and the lock was kept",
            { hint: "release again, or quit the app" },
          ))
    );
  }

  /** The session that holds the lock, taking the lock first if this process does not hold it. A release in progress is waited for, then a fresh acquire follows. */
  async owner(): Promise<StudioSession | Outcome> {
    const failed = await this.afterRelease();
    return failed ?? this.acquire();
  }

  private acquire(): StudioSession | Outcome {
    if (this.stopping)
      return refuse("shutting-down", "the session is shutting down");
    if (this.session !== undefined) {
      this.touched = true;
      return this.session;
    }
    if (this.root === undefined) return this.missing("studioRoot");
    const opened = this.deps.openSession(this.root);
    if (opened.kind === "busy")
      // A session keeps serving reads and tries the lock again at the next
      // write; a one-shot command has nothing to wait for.
      return this.mode === "session"
        ? this.rootLocked()
        : refuse("busy", "another session owns this studio root", {
            hint: "read it with status or list, or send the command to the owning session",
          });
    this.session = opened.session;
    this.touched = true;
    for (const id of opened.session.recovered)
      this.deps.log(`recovered interrupted job ${id}`);
    return this.session;
  }

  loadedContent(): StudioContent | Outcome {
    if (this.content !== undefined) return this.content;
    if (this.config.contentRoot === undefined)
      return this.missing("contentRoot");
    const loaded = this.deps.loadContent(this.config.contentRoot);
    if (!loaded.ok)
      return refuse("invalid-content", "the content root does not load", {
        diagnostics: loaded.diagnostics.map((d) => ({
          file: d.file,
          message: d.message,
        })),
      });
    this.content = loaded.content;
    return this.content;
  }

  /**
   * The palettes under the content root as they are on disk now, read and
   * validated for this call. Pack, approve and publish take them in place of
   * the cached content's palettes, so a palette edited after the content loaded
   * is what they judge. A palette that no longer loads refuses the operation.
   */
  freshPalettes(): PaletteSet | Outcome {
    const content = this.loadedContent();
    if (isOutcome(content)) return content;
    if (this.config.contentRoot === undefined)
      return this.missing("contentRoot");
    const loaded = this.deps.loadPalettes(
      this.config.contentRoot,
      content.vocabulary.paletteFamilies,
    );
    if (!loaded.ok)
      return refuse("invalid-content", "the palettes on disk do not load", {
        diagnostics: loaded.diagnostics.map((d) => ({
          file: d.file,
          message: d.message,
        })),
      });
    return loaded.palettes;
  }

  /**
   * The read-only asset source over the configured registry and studio roots,
   * validated against the content's vocabulary. It takes no writer lock. The
   * first call starts its watchers, so a session that is already stopping
   * refuses rather than start new ones; an existing source keeps answering from
   * its last scan.
   */
  async previewSource(): Promise<PreviewSource | Outcome> {
    while (this.releasing !== undefined) await this.releasing;
    if (this.preview !== undefined) return this.preview;
    if (this.stopping)
      return refuse("shutting-down", "the session is shutting down");
    const studioRoot = this.root;
    if (studioRoot === undefined) return this.missing("studioRoot");
    const registryRoot = this.registryRoot();
    if (isOutcome(registryRoot)) return registryRoot;
    const content = this.loadedContent();
    if (isOutcome(content)) return content;
    this.preview = createPreviewSource({
      registryRoot,
      studioRoot,
      vocabulary: { ok: true, vocabulary: content.vocabulary },
      watch: this.deps.watchRoot,
      schedule: this.deps.schedule,
    });
    return this.preview;
  }

  registryRoot(): string | Outcome {
    return this.config.registryRoot ?? this.missing("registryRoot");
  }

  runtimeFor(session: StudioSession): StudioRuntime | Outcome {
    // A failed release left the runtime closed: it cannot run a job.
    if (this.releaseFailure !== undefined)
      return refuse(
        "release-failed",
        "the runtime was shut down by a release that failed",
        { hint: "release again, or quit the app" },
      );
    if (this.runtime !== undefined) return this.runtime;
    const { artifactRoot, runtime } = this.config;
    if (artifactRoot === undefined) return this.missing("artifactRoot");
    if (runtime === undefined) return this.missing("runtime");
    const content = this.loadedContent();
    if (isOutcome(content)) return content;
    this.runtime = this.deps.openRuntime(session, {
      artifactRoot,
      port: runtime.port,
      content,
      ...(this.config.registryRoot === undefined
        ? {}
        : { registryRoot: this.config.registryRoot }),
      deadlines: runtime.deadlines,
      pollMs: runtime.pollMs,
      pressure: this.deps.pressure,
      ...(this.deps.profile === undefined
        ? {}
        : { profile: this.deps.profile }),
      ...this.renderEngine(),
    });
    return this.runtime;
  }

  /**
   * The render engine's config, from the owner's `render` section: the executable is theirs
   * alone, never the webview's. Without an executable the engine is still registered, so render
   * jobs are marked unavailable with guidance rather than failed.
   */
  private renderRootOf(): string | undefined {
    const { render, contentRoot } = this.config;
    if (render === undefined) return undefined;
    return (
      render.renderRoot ??
      (contentRoot === undefined
        ? undefined
        : resolve(contentRoot, "..", "..", "tools", "render"))
    );
  }

  /** The cells the render engine accepts: the frame of every committed profile, from `render.renderRoot` or its default beside the content root. */
  renderCells(): EngineCells {
    const { render, contentRoot } = this.config;
    return renderEngineFor(
      render?.renderRoot ??
        resolve(contentRoot ?? "", "..", "..", "tools", "render"),
    );
  }

  /** Where the committed render inputs are, for the publish-time render audit of a rendered asset. */
  renderAudit(): { readonly renderRoot: string } | undefined {
    const renderRoot = this.renderRootOf();
    return renderRoot === undefined ? undefined : { renderRoot };
  }

  private renderEngine(): Pick<RuntimeConfig, "render"> {
    const { render } = this.config;
    const renderRoot = this.renderRootOf();
    if (render === undefined || renderRoot === undefined) return {};
    return {
      render: {
        executable: render.executable ?? "",
        pin: BLENDER_PIN,
        renderRoot,
        ...(render.tempParent === undefined
          ? {}
          : { tempParent: render.tempParent }),
        watchdogMs: render.watchdogMs,
      },
    };
  }

  runtimeIfStarted(): StudioRuntime | undefined {
    return this.runtime;
  }

  editorFor(session: StudioSession): EditorAdapter | Outcome {
    if (this.editor !== undefined) return this.editor;
    const { editor } = this.config;
    if (editor === undefined) return this.missing("editor");
    this.editor = this.deps.createEditor(session, {
      ...(editor.executable === undefined
        ? {}
        : { executable: editor.executable }),
      timeoutMs: editor.timeoutMs,
      ...(editor.tempParent === undefined
        ? {}
        : { tempParent: editor.tempParent }),
    });
    return this.editor;
  }

  /** Reports each watched job's status change and stops watching a job once it has settled. Reads only those jobs' records. */
  private reportProgress(session: StudioSession): void {
    for (const [id, reported] of this.watched) {
      const read = session.store.readJob(id);
      if (read.kind !== "found") {
        this.watched.delete(id);
        continue;
      }
      const { status } = read.value.job;
      if (status !== reported) {
        this.watched.set(id, status);
        this.deps.log(`job ${id} ${status}`);
      }
      if (status !== "queued" && status !== "running") {
        this.watched.delete(id);
        this.settledJobs.add(id);
      }
    }
    this.pruneDelivered();
  }

  /** Forgets jobs whose terminal result has reached the client. */
  private pruneDelivered(): void {
    for (const id of this.settledJobs)
      if (this.shown.delete(id)) this.settledJobs.delete(id);
  }

  /** A `list jobs` read carried these terminal jobs to the client. */
  resultsDelivered(ids: readonly string[]): void {
    // Only jobs this process ran count; anything else a listing carries is not remembered.
    for (const id of ids)
      if (this.settledJobs.has(id) || this.watched.has(id)) this.shown.add(id);
    this.pruneDelivered();
  }

  /** Starts draining the durable queue unless a drain is already running; one drain at a time. */
  kick(): void {
    // A release in progress is waited out; if it succeeded there is no runtime
    // left to drain, and the next write that starts one kicks again.
    if (this.releasing !== undefined) {
      void this.releasing.then(() => this.kick());
      return;
    }
    const session = this.session;
    const runtime = this.runtime;
    if (this.stopping || !session || !runtime) return;
    // The one full store read per kick: which jobs are waiting to be reported.
    const waiting = session.queued();
    if (waiting.ok)
      for (const { job } of waiting.jobs)
        if (!this.watched.has(job.id)) this.watched.set(job.id, "");
    if (this.drain !== undefined) return;
    // A tick reads only the watched jobs, and the next one is armed only once
    // this one has finished, so the poll can neither grow with the store nor
    // keep the event loop from the drain, whatever the period.
    const pollMs = this.config.runtime?.pollMs ?? 100;
    let polling = true;
    let cancelTick: (() => void) | undefined;
    const tick = () => {
      this.reportProgress(session);
      if (polling) cancelTick = this.deps.schedule(tick, pollMs);
    };
    this.reportProgress(session);
    cancelTick = this.deps.schedule(tick, pollMs);
    const queuedLeft = () => {
      const queued = session.queued();
      return queued.ok && queued.jobs.length > 0;
    };
    this.drain = (async () => {
      for (;;) {
        const result = await runtime.drain();
        if (!result.ok) {
          this.refusal = `${result.reason}: ${safeMessage(result.message)}`;
          this.deps.log(`drain stopped: ${this.refusal}`);
          return;
        }
        this.unfinished += result.results.filter(
          (r) => r.outcome === "failed" || r.outcome === "unavailable",
        ).length;
        if (
          result.stopped === "empty" ||
          result.stopped === "start-failed" ||
          result.stopped === "unavailable"
        ) {
          // An unavailable engine marked only its own jobs; the others may still be queued.
          if (!queuedLeft()) return;
          continue;
        }
        if (result.stopped === "deferred") {
          // Memory pressure is critical: the jobs stay queued. Wait a poll and look again
          // rather than spin; quit and release end the wait at the next look.
          this.deps.log(
            `drain deferred: ${result.guidance ?? "memory pressure is critical"}`,
          );
          await this.deps.sleep(pollMs);
          if (this.stopping || this.releasing !== undefined) return;
          continue;
        }
        return;
      }
    })().finally(() => {
      polling = false;
      cancelTick?.();
      this.reportProgress(session);
      this.drain = undefined;
      if (!this.stopping && this.refusal === undefined && queuedLeft())
        this.kick();
      this.settle();
    });
  }

  async idle(): Promise<void> {
    while (this.drain !== undefined) await this.drain;
  }

  drainRefusal(): string | undefined {
    return this.refusal;
  }

  /** Why the work this process ran did not finish: a drain that stopped, or jobs that failed or were unavailable. Operator cancellation is not a failure. */
  workflowFailure(): string | undefined {
    if (this.refusal !== undefined) return this.refusal;
    return this.unfinished > 0
      ? `${this.unfinished} job${this.unfinished === 1 ? "" : "s"} failed or were unavailable`
      : undefined;
  }

  /**
   * Foreground-watches an edit's workspace; a changed file is imported once by
   * content hash. The watcher is a lazy writer: each import goes through
   * `owner()` (taking the lock if a release gave it up) and the editor that is
   * current then, and the watch survives a release. Only finishing or
   * discarding the edit ends it.
   */
  watchEdit(editId: string, workspaceHash: string | undefined): void {
    const session = this.session;
    const pollMs = this.config.editor?.editPollMs;
    if (!session || !this.editor || !this.content || pollMs === undefined)
      return;
    // One watch per edit: a second request for the same edit keeps the first.
    if (this.watches.has(editId)) return;
    const file = workspaceFile(session, editId);
    const watch: Watch = {
      baseline: workspaceHash ?? "",
      busy: false,
      live: true,
      cancel: undefined,
    };
    const arm = () => {
      if (watch.live)
        watch.cancel = this.deps.schedule(() => void poll(), pollMs);
    };
    const poll = async () => {
      watch.cancel = undefined;
      try {
        await this.importChanged(editId, file, watch);
      } catch (error) {
        // Nothing here may escape the timer: a session that will not open, or a
        // workspace file that vanished, is a refusal to try again next poll,
        // with the baseline untouched and the watch still armed.
        this.deps.log(
          `edit ${editId} not imported: ${error instanceof Error ? error.message : "the import failed"}`,
        );
      } finally {
        arm();
      }
    };
    this.watches.set(editId, watch);
    arm();
  }

  /**
   * One poll of a watch. The baseline advances after a success or a terminal
   * refusal; a refusal to take the lock (or a release that failed) leaves it,
   * so the next poll tries again.
   */
  private async importChanged(
    editId: string,
    file: string,
    watch: Watch,
  ): Promise<void> {
    if (!watch.live || !existsSync(file)) return;
    const hash = sha256(new Uint8Array(readFileSync(file)));
    if (hash === watch.baseline) return;
    watch.busy = true;
    try {
      const owned = await this.owner();
      if (isOutcome(owned)) {
        if (!owned.ok && RETRY_IMPORT.has(owned.error.code)) return;
        watch.baseline = hash;
        this.deps.log(
          `edit ${editId} not imported: ${owned.ok ? "refused" : owned.error.code}`,
        );
        return;
      }
      const editor = this.editorFor(owned);
      const content = this.loadedContent();
      if (isOutcome(editor) || isOutcome(content)) {
        watch.baseline = hash;
        this.deps.log(`edit ${editId} not imported: not configured`);
        return;
      }
      try {
        const result = await editor.refresh(editId, content, "import");
        // An editor that could not be started never looked at the file: the
        // baseline stays so the next poll tries again. Every other result,
        // including a failed export, is terminal for this version.
        if (!result.ok && result.reason === "editor-unavailable") {
          this.deps.log(`edit ${editId} not imported: ${result.reason}`);
          return;
        }
        watch.baseline = hash;
        this.deps.log(
          result.ok
            ? `edit ${editId} ${result.changed ? "imported" : "unchanged"}`
            : `edit ${editId} not imported: ${result.reason}`,
        );
      } catch {
        watch.baseline = hash;
        this.deps.log(`edit ${editId} not imported: the import failed`);
      }
    } finally {
      watch.busy = false;
      this.settle();
    }
  }

  /** The edit's workspace file, for a host that launches the editor on it; undefined before the session is open. */
  workspacePath(editId: string): string | undefined {
    return this.session === undefined
      ? undefined
      : resolve(workspaceFile(this.session, editId));
  }

  workspaceHash(editId: string): string | undefined {
    const session = this.session;
    if (session === undefined) return undefined;
    const file = workspaceFile(session, editId);
    return existsSync(file)
      ? sha256(new Uint8Array(readFileSync(file)))
      : undefined;
  }

  unwatchEdit(editId: string): void {
    const watch = this.watches.get(editId);
    if (watch === undefined) return;
    watch.live = false;
    watch.cancel?.();
    this.watches.delete(editId);
    this.editEnded?.(editId);
  }

  get hasWatches(): boolean {
    return this.watches.size > 0;
  }

  /**
   * Stops watching, closes the editor and shuts the runtime down, keeping the
   * writer lock until the owned server is gone: a failed shutdown is retried
   * at the configured poll, never abandoned.
   */
  teardown(): Promise<void> {
    this.tearingDown ??= (async () => {
      this.disarmGrace();
      this.preview?.close();
      for (const id of [...this.watches.keys()]) this.unwatchEdit(id);
      // A release in progress finishes (or fails) first, so nothing is closed twice.
      if (this.releasing !== undefined) await this.releasing;
      await this.editor?.close();
      if (this.runtime !== undefined) {
        const pollMs = this.config.runtime?.pollMs ?? 100;
        for (let attempt = 1; ; attempt += 1) {
          const result = await this.runtime.shutdown();
          if (result.ok) break;
          this.deps.log(
            `the owned runtime is still stopping; the root stays locked (attempt ${attempt})`,
          );
          await this.deps.sleep(pollMs);
        }
      } else this.session?.close();
    })();
    return this.tearingDown;
  }

  /** Counts an op that may use the lock while it runs; the returned function ends it and re-evaluates the idle grace. */
  begin(counted = true): () => void {
    if (counted) this.inflight += 1;
    return () => {
      if (counted) this.inflight -= 1;
      this.settle();
    };
  }

  /**
   * Why the app is not idle, or undefined when it is. Idle needs all of: no op
   * in flight, no drain running, the drain not stopped by a refusal, no job
   * queued or running, every terminal result carried to the client, and no
   * edit import in flight. An open edit with no import running does not count.
   */
  idleReason(): string | undefined {
    if (this.releasing !== undefined) return "a release is in progress";
    if (this.inflight > 0) return "an op is in flight";
    if (this.drain !== undefined) return "a drain is running";
    if (this.refusal !== undefined)
      return `the drain stopped on a refusal: ${this.refusal}`;
    if (this.watched.size > 0) return "a job is queued or running";
    this.pruneDelivered();
    if (this.settledJobs.size > 0)
      return "a job result has not reached the client";
    for (const watch of this.watches.values())
      if (watch.busy) return "an edit import is in flight";
    return undefined;
  }

  /** Why the last release failed while the lock was kept; undefined otherwise. */
  get releaseFailed(): string | undefined {
    return this.releaseFailure;
  }

  /**
   * Gives the writer lock back if the app is idle. Its own path, not
   * `teardown()`: it never latches `stopping` and never unwatches edits. The
   * steps, in order: close the editor, shut the runtime down (which stops the
   * server group and, with nothing running, aborts nothing), close the
   * session, then clear the session, runtime, editor and preview refs. One
   * attempt, bounded like quit; if it fails the lock is kept and the failure is
   * reported.
   */
  release(): Promise<Outcome> {
    if (this.releasing !== undefined) return this.releasing;
    if (this.stopping)
      return Promise.resolve(
        refuse("shutting-down", "the session is shutting down"),
      );
    const session = this.session;
    if (session === undefined) return Promise.resolve(done({ state: "free" }));
    if (this.releaseSteps !== undefined)
      return Promise.resolve(
        refuse(
          "release-failed",
          "a release that did not finish is still running; the lock is kept",
        ),
      );
    let reason = this.idleReason();
    if (reason === undefined) {
      // The one full read: a job left queued in the store (not drained by this
      // process) still stops a release.
      const queued = session.queued();
      if (queued.ok && queued.jobs.length > 0)
        reason = "a job is queued or running";
    }
    if (reason !== undefined)
      return Promise.resolve(
        refuse("not-idle", `the app is not idle: ${reason}`, { reason }),
      );
    this.disarmGrace();
    const attempt = this.performRelease(session);
    this.releasing = attempt;
    void attempt.then(() => {
      if (this.releasing === attempt) this.releasing = undefined;
      this.settle();
    });
    return attempt;
  }

  private async performRelease(session: StudioSession): Promise<Outcome> {
    const { deadlines } = this.config.runtime ?? {};
    const bound =
      (deadlines === undefined ? 0 : deadlines.termGraceMs + deadlines.killMs) +
      RELEASE_MARGIN_MS;
    // The steps keep going past the bound: a shutdown that finishes late still
    // completes the release, and only then clears the refs.
    let overBound = false;
    const steps = (async (): Promise<string | undefined> => {
      try {
        await this.editor?.close();
        if (this.runtime !== undefined) {
          const result = await this.runtime.shutdown();
          if (!result.ok) return `the runtime did not stop (${result.reason})`;
        }
        session.close();
        // Teardown closes the preview itself once it has begun.
        if (!this.stopping) this.preview?.close();
        this.session = undefined;
        this.runtime = undefined;
        this.editor = undefined;
        this.preview = undefined;
        this.releaseFailure = undefined;
        if (overBound)
          this.deps.log(
            "the release finished late: the writer lock is now free",
          );
        return undefined;
      } catch {
        return "closing the session threw";
      }
    })();
    // Tracks the steps themselves, not the race: it stays set while they run.
    const open = steps.then(() => {
      if (this.releaseSteps === open) this.releaseSteps = undefined;
    });
    this.releaseSteps = open;
    let cancel: () => void = () => {};
    const timeout = new Promise<string>((resolve) => {
      cancel = this.deps.schedule(() => {
        overBound = true;
        resolve(`the release did not finish within ${bound} ms`);
      }, bound);
    });
    const failure = await Promise.race([steps, timeout]);
    cancel();
    if (failure === undefined) {
      this.deps.log("released the writer lock");
      return done({ state: "released" });
    }
    // A late success clears this; a failure that came with the steps already
    // finished leaves it set, as before.
    this.releaseFailure ??= failure;
    this.deps.log(`release failed: the writer lock is kept (${failure})`);
    return refuse(
      "release-failed",
      "releasing the writer lock failed and the lock was kept",
      { reason: failure },
    );
  }

  /** Re-evaluates the idle grace: armed when idle, restarted by a write, left alone by a read. */
  settle(): void {
    if (
      this.mode !== "session" ||
      this.stopping ||
      this.session === undefined ||
      this.releasing !== undefined ||
      // After a failed release nothing retries on its own: a manual release does.
      this.releaseFailure !== undefined
    )
      return;
    if (this.idleReason() !== undefined) {
      this.disarmGrace();
      return;
    }
    if (this.cancelGrace !== undefined && !this.touched) return;
    this.disarmGrace();
    this.touched = false;
    this.cancelGrace = this.deps.schedule(() => {
      this.cancelGrace = undefined;
      void this.release().then((outcome) => {
        if (!outcome.ok && outcome.error.code !== "not-idle")
          this.deps.log(`automatic release: ${outcome.error.code}`);
      });
    }, RELEASE_GRACE_MS);
  }

  private disarmGrace(): void {
    this.cancelGrace?.();
    this.cancelGrace = undefined;
  }

  jobsOf(ids: readonly string[]): Json[] {
    const session = this.session;
    if (session === undefined) return [];
    const records = new Map(
      session.store.status().jobs.map((r) => [r.job.id, r]),
    );
    return ids.flatMap((id) => {
      const record = records.get(id);
      return record === undefined ? [] : [jobSummary(record)];
    });
  }
}
