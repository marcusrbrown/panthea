// Process-tree RSS/CPU polling via `ps` (macOS and Linux). One `ps -axo`
// snapshot per tick is walked from the root pid, so generator child
// processes are included. Limitations, by construction:
//   - sampled peak only: spikes between ticks are invisible, so the peak is
//     a lower bound on the true maximum;
//   - `%cpu` from ps is the OS's decayed average, a coarse idle signal.

import type { ResidentEvidence } from "./measure";

export interface ProcRow {
  readonly pid: number;
  readonly ppid: number;
  readonly rssKb: number;
  readonly cpuPercent: number;
}

export interface TreeUsage {
  readonly rssKb: number;
  readonly cpuPercent: number;
  readonly processCount: number;
}

export type UsageReader = (rootPid: number) => Promise<TreeUsage | null>;

export function parsePsOutput(text: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 4) {
      continue;
    }
    const [pid, ppid, rssKb, cpuPercent] = parts.map(Number) as [
      number,
      number,
      number,
      number,
    ];
    if ([pid, ppid, rssKb, cpuPercent].some((n) => !Number.isFinite(n))) {
      continue;
    }
    rows.push({ pid, ppid, rssKb, cpuPercent });
  }
  return rows;
}

/** Sums the root and its descendants; null when the root is not in the snapshot. */
export function treeUsage(
  rows: readonly ProcRow[],
  rootPid: number,
): TreeUsage | null {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  if (!byPid.has(rootPid)) {
    return null;
  }
  const children = new Map<number, ProcRow[]>();
  for (const row of rows) {
    const siblings = children.get(row.ppid) ?? [];
    siblings.push(row);
    children.set(row.ppid, siblings);
  }
  const seen = new Set<number>();
  const queue = [rootPid];
  let rssKb = 0;
  let cpuPercent = 0;
  while (queue.length > 0) {
    const pid = queue.pop() as number;
    if (seen.has(pid)) {
      continue;
    }
    seen.add(pid);
    const row = byPid.get(pid);
    if (row) {
      rssKb += row.rssKb;
      cpuPercent += row.cpuPercent;
    }
    for (const child of children.get(pid) ?? []) {
      queue.push(child.pid);
    }
  }
  return { rssKb, cpuPercent, processCount: seen.size };
}

export async function readTreeUsage(
  rootPid: number,
): Promise<TreeUsage | null> {
  try {
    const ps = Bun.spawn(["ps", "-axo", "pid=,ppid=,rss=,%cpu="], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = await new Response(ps.stdout).text();
    await ps.exited;
    return treeUsage(parsePsOutput(text), rootPid);
  } catch {
    return null;
  }
}

export interface TreeSampler {
  setPhase(name: string): void;
  /** Retarget after a restart; null pauses sampling. */
  setRoot(pid: number | null): void;
  /** Cumulative evidence so far; sampling continues. */
  snapshot(): ResidentEvidence;
  stop(): ResidentEvidence;
}

export function createTreeSampler(options: {
  readonly intervalMs?: number;
  readonly read?: UsageReader;
  readonly phase?: string;
  readonly rootPid?: number | null;
}): TreeSampler {
  const intervalMs = options.intervalMs ?? 250;
  const read = options.read ?? readTreeUsage;
  let phase = options.phase ?? "run";
  let root = options.rootPid ?? null;
  let busy = false;
  let stopped = false;
  let sampleCount = 0;
  let peak: number | null = null;
  const byPhase: Record<
    string,
    { sampleCount: number; observedSampledPeakKb: number }
  > = {};

  const timer = setInterval(async () => {
    if (busy || stopped || root === null) {
      return;
    }
    busy = true;
    const labelled = phase;
    try {
      const usage = await read(root);
      if (usage !== null && !stopped) {
        sampleCount += 1;
        peak = peak === null ? usage.rssKb : Math.max(peak, usage.rssKb);
        const entry = byPhase[labelled] ?? {
          sampleCount: 0,
          observedSampledPeakKb: 0,
        };
        byPhase[labelled] = {
          sampleCount: entry.sampleCount + 1,
          observedSampledPeakKb: Math.max(
            entry.observedSampledPeakKb,
            usage.rssKb,
          ),
        };
      }
    } finally {
      busy = false;
    }
  }, intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();

  const snapshot = (): ResidentEvidence => ({
    intervalMs,
    sampleCount,
    observedSampledPeakKb: peak,
    byPhase: { ...byPhase },
    semantics: "observed-sampled-peak-not-guaranteed-maximum",
  });

  return {
    snapshot,
    setPhase(name) {
      phase = name;
    },
    setRoot(pid) {
      root = pid;
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      return snapshot();
    },
  };
}

export interface IdleResult {
  readonly reason: "below-threshold" | "timed-out" | "process-gone";
  readonly afterMs: number;
  readonly evidence: readonly {
    readonly atMs: number;
    readonly cpuPercent: number;
  }[];
}

const MAX_IDLE_EVIDENCE = 200;

/** Polls tree CPU until it drops below the threshold; bounded by `timeoutMs`. */
export async function waitForTreeIdle(
  rootPid: number,
  options: {
    readonly thresholdPercent?: number;
    readonly timeoutMs: number;
    readonly pollMs?: number;
    readonly read?: UsageReader;
  },
): Promise<IdleResult> {
  const threshold = options.thresholdPercent ?? 5;
  const pollMs = options.pollMs ?? 250;
  const read = options.read ?? readTreeUsage;
  const startedAt = performance.now();
  const evidence: { atMs: number; cpuPercent: number }[] = [];
  for (;;) {
    const usage = await read(rootPid);
    const atMs = performance.now() - startedAt;
    if (usage === null) {
      return { reason: "process-gone", afterMs: atMs, evidence };
    }
    if (evidence.length < MAX_IDLE_EVIDENCE) {
      evidence.push({ atMs, cpuPercent: usage.cpuPercent });
    }
    if (usage.cpuPercent < threshold) {
      return { reason: "below-threshold", afterMs: atMs, evidence };
    }
    if (atMs >= options.timeoutMs) {
      return { reason: "timed-out", afterMs: atMs, evidence };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
