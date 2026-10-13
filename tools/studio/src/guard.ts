// The parent-death guard for a session run as a sidecar: stdin EOF is the quick
// signal that the parent went away, and this is the backstop for when the pipe
// outlives it. It mirrors `apps/simulation/src/lifecycle.ts`, with the PID
// probe and the clock injected, and re-arms a one-shot timer after each poll
// rather than keeping an interval, so polls can never pile up.

/** The simulation sidecar's poll period. */
export const PARENT_POLL_MS = 2000;

export interface ParentGuardOptions {
  readonly parentPid: number;
  /** Whether a process id names a live process. */
  readonly isAlive: (pid: number) => boolean;
  /** Runs a callback once after a delay; the returned function cancels it. */
  readonly schedule: (run: () => void, delayMs: number) => () => void;
  /** Called once, the first time the parent is found dead. */
  readonly onOrphan: () => void;
}

export interface ParentGuard {
  stop(): void;
}

export function startParentGuard(options: ParentGuardOptions): ParentGuard {
  let stopped = false;
  let cancel: (() => void) | undefined;

  const arm = () => {
    cancel = options.schedule(() => {
      cancel = undefined;
      if (stopped) return;
      if (!options.isAlive(options.parentPid)) {
        stopped = true;
        options.onOrphan();
        return;
      }
      // The probe may have stopped the guard; do not arm a poll nothing will cancel.
      if (!stopped) arm();
    }, PARENT_POLL_MS);
  };
  arm();

  return {
    stop() {
      stopped = true;
      cancel?.();
      cancel = undefined;
    },
  };
}
