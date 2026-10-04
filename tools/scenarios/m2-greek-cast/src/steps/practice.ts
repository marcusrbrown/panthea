// What the practice steps share: a god's turn driven to whatever the world did
// with it (a committed move, or a refusal the step wants to see), the ids a
// scripted reply reads out of the prompt its god was shown (a reply is a
// function of that prompt, as Hera's policy is, so it names only what the god
// could name), the threads and feelings read from the committed state, and the
// events read from the store.

import {
  type PracticeThread,
  toEntityId,
  type WorldState,
} from "@panthea/world";
import { eventsOf } from "../../../m1-living-world/src/steps/direct";
import type { StoredEvent } from "../checks";
import type { JournaledProposal } from "../db";
import type { God, Reply, SeenRequest } from "../provider";
import type { Story } from "./context";
import {
  check,
  lastInputOrder,
  modelProposals,
  stateOf,
  waitFor,
  waitForConsumed,
  walk,
} from "./support";

export type { StoredEvent };

const id = toEntityId;

/** Every stored event's full payload, oldest first. */
export const storedEvents = (story: Story): StoredEvent[] =>
  eventsOf(story).map((event) => event.payload as StoredEvent);

export const eventsOfKind = (
  story: Story,
  kind: string,
  where: (event: StoredEvent) => boolean = () => true,
): StoredEvent[] =>
  storedEvents(story).filter((event) => event.kind === kind && where(event));

/**
 * Queues `reply` for `god`, waits for the proposal its next turn journals,
 * whatever its outcome, and for the tick that runs it. Unlike `driveGod` it
 * does not require the proposal to commit: a step that wants to see the world
 * refuse a move reads the row's outcome and reason.
 */
export async function godActs(
  story: Story,
  god: God,
  reply: Reply,
  why: string,
): Promise<JournaledProposal> {
  const after = lastInputOrder(story);
  story.provider.enqueue(god, reply);
  const journaled = await waitFor(
    `${why}: ${god}'s turn is journaled`,
    () => modelProposals(story, god).find((entry) => entry.inputOrder > after),
    { timeoutMs: 40_000, intervalMs: 50 },
  );
  return waitForConsumed(
    story,
    journaled.proposalId,
    `${why}: ${god}'s proposal runs on a tick`,
  );
}

/** As `godActs`, and the proposal must commit. */
export async function godMoves(
  story: Story,
  god: God,
  reply: Reply,
  why: string,
): Promise<JournaledProposal> {
  const row = await godActs(story, god, reply, why);
  check(
    row.outcome === "committed",
    `${why}: ${god}'s move commits`,
    `${row.outcome} ${row.reason}`,
  );
  return row;
}

/** The first request `god` was asked after `mark` (a count of requests), waiting for it: what its next prompt shows. */
export function nextPrompt(
  story: Story,
  god: God,
  mark: number,
  why: string,
): Promise<SeenRequest> {
  return waitFor(
    why,
    () =>
      story.provider.requests
        .slice(mark)
        .find((request) => request.god === god),
    { timeoutMs: 30_000, intervalMs: 50 },
  );
}

// --- What a prompt names ---------------------------------------------------------------------

/** The causes a god's prompt lists to demand over: `[id] words`. */
export function demandCauses(
  prompt: string,
): { readonly id: string; readonly text: string }[] {
  const line = prompt
    .split("\n")
    .find((l) => l.startsWith("Causes you may demand over:"));
  if (line === undefined) return [];
  return line
    .slice("Causes you may demand over:".length)
    .split("; ")
    .flatMap((entry) => {
      const match = /\[(evt-[^\]]+)\] (.+?)\.?$/.exec(entry.trim());
      return match === null
        ? []
        : [{ id: match[1] as string, text: match[2] as string }];
    });
}

/** The thread a digest row of `label` names: `- [thread] AWAITING YOUR ANSWER`. */
export function threadLabelled(
  prompt: string,
  label: string,
): string | undefined {
  return new RegExp(`^- \\[(evt-[^\\]]+)\\] ${label}`, "m").exec(prompt)?.[1];
}

type Term = Record<string, unknown>;

/** One term to be at `place`, `party` to do it. */
export const beAt = (
  party: string,
  place: string,
  deadlineTicks: number,
): Term => ({ kind: "be-at", party, place, deadlineTicks });

/** A demand over the cause `pick` chooses from the prompt. */
export const demandOver =
  (
    pick: (causes: ReturnType<typeof demandCauses>) => string | undefined,
    term: Term,
  ) =>
  (seen: { readonly prompt: string }): string => {
    const cause = pick(demandCauses(seen.prompt));
    if (cause === undefined) {
      throw new Error(
        `the prompt lists no cause to demand over: ${demandCauses(seen.prompt)
          .map((c) => c.text)
          .join(" | ")}`,
      );
    }
    return JSON.stringify({
      action: "practice",
      move: "demand",
      cause,
      term,
    });
  };

/** A move on the thread this god's digest labels `label`. */
export const answerThread =
  (label: string, move: string, extra: Record<string, unknown> = {}) =>
  (seen: { readonly prompt: string }): string => {
    const thread = threadLabelled(seen.prompt, label);
    if (thread === undefined) {
      throw new Error(`the prompt has no thread labelled "${label}"`);
    }
    return JSON.stringify({ action: "practice", move, thread, ...extra });
  };

// --- The committed state -----------------------------------------------------------------------

export const threadsOf = (state: WorldState): PracticeThread[] => [
  ...state.threads.values(),
];

export async function threadAfter(
  story: Story,
  known: readonly string[],
  why: string,
): Promise<PracticeThread> {
  return waitFor(
    why,
    async () =>
      threadsOf(await stateOf(story)).find((t) => !known.includes(t.id)),
    { timeoutMs: 20_000, intervalMs: 100 },
  );
}

export async function threadNow(
  story: Story,
  threadId: string,
): Promise<PracticeThread> {
  const thread = (await stateOf(story)).threads.get(threadId as never);
  check(thread !== undefined, `${threadId} is a thread`, "not in the state");
  return thread;
}

/** Waits until a thread has ended, and returns it. */
export function threadEnded(
  story: Story,
  threadId: string,
  why: string,
  timeoutMs = 60_000,
): Promise<PracticeThread> {
  return waitFor(
    why,
    async () => {
      const thread = (await stateOf(story)).threads.get(threadId as never);
      return thread !== undefined && thread.closedTick !== undefined
        ? thread
        : undefined;
    },
    { timeoutMs, intervalMs: 200 },
  );
}

export const feeling = (state: WorldState, from: string, toward: string) =>
  state.relationships.get(`${from}>${toward}` as never);

// --- Getting about ---------------------------------------------------------------------------

/** Sends `god` to `to` with one scripted travel turn, unless it is already there; the world walks the way. */
export async function walkTo(
  story: Story,
  god: God,
  to: string,
): Promise<void> {
  const actor = (await stateOf(story)).actors.get(id(god));
  if (actor === undefined) throw new Error(`no actor ${god}`);
  if (actor.locationId === to) return;
  await walk(story, god, to);
}

/** Brings both gods to the place `god` stands in, so a report between them can be told. */
export async function meet(story: Story, mover: God, other: God) {
  const state = await stateOf(story);
  const at = state.actors.get(id(other))?.locationId;
  check(at !== undefined, `${other} is somewhere`, "no location");
  await walkTo(story, mover, at);
}
