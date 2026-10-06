// Pure checks the M2 scenario runs on what it observed. Nothing here touches a
// process, a socket, or a database, so each one has a unit test with a
// positive control (`checks.test.ts`).

import { causalChain, parseEvent, type WorldEvent } from "@panthea/contracts";
import { canonicalJson } from "../../m1-living-world/src/helpers";

/** The traces, out of `traces`, that `prompt` carries: what a knowledge-isolation check is looking for. */
export function tracesIn(
  prompt: string,
  traces: readonly string[],
): readonly string[] {
  return traces.filter((trace) => prompt.includes(trace));
}

/** Whether a scripted reply is the god doing nothing. */
export function isWait(reply: string): boolean {
  try {
    return (JSON.parse(reply) as { action?: unknown }).action === "wait";
  } catch {
    return false;
  }
}

/** The part of a decoded world state that memory and feeling live in. */
export interface RememberedView {
  readonly memories: ReadonlyMap<string, readonly unknown[]>;
  readonly relationships: ReadonlyMap<string, unknown>;
}

/**
 * How `branch` differs from `live` in what anyone remembers or feels: one
 * line per actor whose memories differ and per relationship that differs or is
 * missing on either side. Empty when a restore kept both exactly. `only`
 * limits the comparison to those owners (and the feelings they hold).
 */
export function differences(
  live: RememberedView,
  branch: RememberedView,
  only?: readonly string[],
): readonly string[] {
  const found: string[] = [];
  const counted = (owner: string) => only === undefined || only.includes(owner);
  const owners = new Set([...live.memories.keys(), ...branch.memories.keys()]);
  for (const owner of [...owners].sort()) {
    if (!counted(owner)) continue;
    if (
      canonicalJson(live.memories.get(owner) ?? []) !==
      canonicalJson(branch.memories.get(owner) ?? [])
    ) {
      found.push(`memories of ${owner} differ`);
    }
  }
  const keys = new Set([
    ...live.relationships.keys(),
    ...branch.relationships.keys(),
  ]);
  for (const key of [...keys].sort()) {
    if (!counted(key.split(">")[0] ?? "")) continue;
    if (
      canonicalJson(live.relationships.get(key)) !==
      canonicalJson(branch.relationships.get(key))
    ) {
      found.push(`relationship ${key} differs`);
    }
  }
  return found;
}

/**
 * How `after` differs from `before` in what `owners` remember, for a restart that keeps every memory: one line per
 * memory lost, per memory held under the same id with any other content (subjects, salience, provenance), and per
 * new memory of a kind not in `allowedNew`. A new memory of an allowed kind is the running world's doing, not a loss.
 */
export function memoryChanges(
  before: RememberedView,
  after: RememberedView,
  owners: readonly string[],
  allowedNew: readonly string[],
): readonly string[] {
  type Held = { readonly id: string; readonly kind: string };
  const found: string[] = [];
  for (const owner of owners) {
    const was = (before.memories.get(owner) ?? []) as readonly Held[];
    const now = (after.memories.get(owner) ?? []) as readonly Held[];
    const nowById = new Map(now.map((memory) => [memory.id, memory]));
    const wasIds = new Set(was.map((memory) => memory.id));
    for (const memory of was) {
      const kept = nowById.get(memory.id);
      if (kept === undefined) found.push(`${owner} lost ${memory.id}`);
      else if (canonicalJson(kept) !== canonicalJson(memory)) {
        found.push(`${owner} changed ${memory.id}`);
      }
    }
    for (const memory of now) {
      if (!wasIds.has(memory.id) && !allowedNew.includes(memory.kind)) {
        found.push(`${owner} gained ${memory.kind} ${memory.id}`);
      }
    }
  }
  return found;
}

/** An event as the store holds it: its full payload, parsed from JSON. */
export type StoredEvent = Record<string, unknown> & { readonly id: string };

/**
 * The kinds of the events that led to `eventId`, root first, walked from the
 * event log alone (no trace): what a restored branch, which has no trace rows,
 * can still explain.
 */
export function explainChain(
  events: readonly StoredEvent[],
  eventId: string,
): readonly string[] {
  const parsed = new Map<string, WorldEvent>();
  for (const stored of events) {
    const result = parseEvent(stored);
    if (result.ok) parsed.set(stored.id, result.value);
  }
  return causalChain((id) => parsed.get(id), eventId as WorldEvent["id"]).map(
    (event) => event.kind,
  );
}

/**
 * A prompt without its "Prayers to you:" section: the header, each entry
 * ("- ..."), and each entry's indented lines. A god hears prayers addressed to
 * it by the divine sense, wherever it is, so what a prayer says is not a trace
 * of an event the god perceived; everything outside the section still is.
 */
export function withoutPrayers(prompt: string): string {
  const kept: string[] = [];
  let inPrayers = false;
  for (const line of prompt.split("\n")) {
    if (line === "Prayers to you:") {
      inPrayers = true;
      continue;
    }
    if (inPrayers && (line.startsWith("- ") || line.startsWith("  "))) continue;
    inPrayers = false;
    kept.push(line);
  }
  return kept.join("\n");
}
