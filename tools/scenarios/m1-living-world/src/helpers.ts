// Pure helpers for the scenario: fixture instantiation, byte corruption,
// the catch-up identity, polling with a named invariant, and step
// bookkeeping. Nothing here touches a process, a socket, or a database.

export class ScenarioFailure extends Error {
  constructor(
    readonly invariant: string,
    readonly detail: string,
  ) {
    super(`invariant violated: ${invariant} -- ${detail}`);
    this.name = "ScenarioFailure";
  }
}

/** Throws a `ScenarioFailure` naming `invariant` unless `condition` holds. */
export function check(
  condition: boolean,
  invariant: string,
  detail: string,
): asserts condition {
  if (!condition) {
    throw new ScenarioFailure(invariant, detail);
  }
}

// --- Fixtures ----------------------------------------------------------------

export type FixtureValues = Readonly<Record<string, string | number>>;

/**
 * Deep-copies a fixture, replacing every string that is exactly a
 * `$placeholder` with its value. A `$`-prefixed string with no value is a
 * typo in the fixture and throws rather than reaching the sidecar.
 */
export function instantiate(template: unknown, values: FixtureValues): unknown {
  if (typeof template === "string" && template.startsWith("$")) {
    const value = values[template];
    if (value === undefined) {
      throw new Error(`fixture placeholder ${template} has no value`);
    }
    return value;
  }
  if (Array.isArray(template)) {
    return template.map((item) => instantiate(item, values));
  }
  if (typeof template === "object" && template !== null) {
    return Object.fromEntries(
      Object.entries(template).map(([key, item]) => [
        key,
        instantiate(item, values),
      ]),
    );
  }
  return template;
}

// --- Archive corruption ------------------------------------------------------

/**
 * Returns a copy of `bytes` with the first byte of the first occurrence of
 * `marker` changed. The marker is text the archive stores verbatim (an
 * event payload), so the change lands in row data, not unused page space.
 */
export function corruptArchiveBytes(
  bytes: Uint8Array,
  marker: string,
): Uint8Array {
  const at = Buffer.from(bytes).indexOf(marker);
  if (at < 0) {
    throw new Error(`corruption marker not found in archive: ${marker}`);
  }
  const copy = new Uint8Array(bytes);
  copy[at] = (copy[at] ?? 0) ^ 0x01;
  return copy;
}

// --- Canonical JSON ---------------------------------------------------------

/** JSON with object keys sorted at every depth, so two serializations of the same value compare equal as text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// --- Catch-up identity ---------------------------------------------------------

export interface CatchUpBaseline {
  /** Tick and wall cursor the world had when the harness backdated the cursor. */
  readonly tick: number;
  /** The backdated cursor: the start of the interval the machine "slept" through. */
  readonly backdatedCursorMs: number;
}

export interface CatchUpIdentity {
  readonly ok: boolean;
  readonly ticksAdvanced: number;
  readonly ticksForCursorAdvance: number;
}

/**
 * Every applied wall second is one tick and moves the cursor by one
 * second, whether it was applied by a catch-up chunk or a live tick; the
 * sub-second remainder is dropped when catch-up finishes. So at any
 * committed point, ticks since the baseline equal whole seconds of cursor
 * advance since the backdated cursor. An interval applied twice pushes
 * ticks ahead of the cursor; a dropped one leaves them behind.
 */
export function catchUpIdentity(
  baseline: CatchUpBaseline,
  clock: { readonly tick: number; readonly cursorWallMs: number },
): CatchUpIdentity {
  const ticksAdvanced = clock.tick - baseline.tick;
  const ticksForCursorAdvance = Math.floor(
    (clock.cursorWallMs - baseline.backdatedCursorMs) / 1000,
  );
  return {
    ok: ticksAdvanced === ticksForCursorAdvance,
    ticksAdvanced,
    ticksForCursorAdvance,
  };
}

/** Burn-ticks a building shows between ignition and destruction: intensity grows by `growth` each tick and destroys at `destroyAt`. */
export function expectedBurnTicks(
  destroyAt: number,
  growthPerTick: number,
): number {
  return Math.ceil(destroyAt / growthPerTick) - 1;
}

// --- Polling ------------------------------------------------------------------

export interface WaitOptions {
  readonly timeoutMs: number;
  readonly intervalMs?: number;
}

/** Polls `probe` until it returns a value; fails naming `invariant` if it never does. */
export async function waitFor<T>(
  invariant: string,
  probe: () => T | undefined | Promise<T | undefined>,
  options: WaitOptions,
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  const interval = options.intervalMs ?? 100;
  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new ScenarioFailure(
        invariant,
        `not observed within ${options.timeoutMs} ms`,
      );
    }
    await Bun.sleep(interval);
  }
}

// --- Concurrency ----------------------------------------------------------------

/** Runs `run` over `items` with at most `limit` in flight; the results are in `items` order whatever order they finish in. Rejects with the first failure, after which no further item starts. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await run(items[index] as T);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

// --- Step records ---------------------------------------------------------------

export interface Measurement {
  readonly name: string;
  readonly unit: string;
  readonly value: number;
}

export interface StepResult {
  readonly id: string;
  readonly title: string;
  /** What the step asserts, in one sentence. */
  readonly invariant: string;
  /** What was actually measured, in plain words. */
  readonly result: string;
  readonly measurements: readonly Measurement[];
  /** Observations worth reading that are not assertions (e.g. a product gap the step measured). */
  readonly notes: readonly string[];
  readonly elapsedMs: number;
}

export interface StepRecorder {
  readonly results: readonly StepResult[];
  /** Runs one step and returns whatever its body returns, so a step can hand facts to later ones. */
  run<T>(
    id: string,
    title: string,
    invariant: string,
    body: (report: StepReport) => Promise<T>,
  ): Promise<T>;
}

export interface StepReport {
  /** Records the step's measured outcome and numbers; call once, after the checks pass. */
  done(
    result: string,
    measurements?: readonly Measurement[],
    notes?: readonly string[],
  ): void;
}

export function createStepRecorder(
  onStep: (result: StepResult) => void = () => {},
  clock: () => number = Date.now,
): StepRecorder {
  const results: StepResult[] = [];
  return {
    results,
    async run(id, title, invariant, body) {
      const startedAt = clock();
      let recorded:
        | {
            result: string;
            measurements: readonly Measurement[];
            notes: readonly string[];
          }
        | undefined;
      const report: StepReport = {
        done(result, measurements = [], notes = []) {
          recorded = { result, measurements, notes };
        },
      };
      const value = await body(report);
      if (recorded === undefined) {
        throw new Error(`step ${id} finished without recording a result`);
      }
      const step: StepResult = {
        id,
        title,
        invariant,
        result: recorded.result,
        measurements: recorded.measurements,
        notes: recorded.notes,
        elapsedMs: clock() - startedAt,
      };
      results.push(step);
      onStep(step);
      return value;
    },
  };
}
