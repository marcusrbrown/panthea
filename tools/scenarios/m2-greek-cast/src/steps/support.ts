// What the steps share for driving and reading the world: proposals the gods
// journaled (read from the store, since no endpoint lists them), a god's turn
// driven to a committed outcome, fixture proposals for staging the world, and
// bounded waits.

import { createObservationId } from "@panthea/contracts";
import { createProposalId } from "@panthea/telemetry";
import { toEntityId, type WorldState } from "@panthea/world";
import {
  check,
  ScenarioFailure,
  waitFor,
} from "../../../m1-living-world/src/helpers";
import { readFrame } from "../../../m1-living-world/src/steps/api";
import { activeStorePath } from "../../../m1-living-world/src/world-db";
import { type JournaledProposal, readProposals } from "../db";
import type { God, Reply } from "../provider";
import type { Story } from "./context";

export { check, waitFor };

export const proposalsOf = (story: Story): JournaledProposal[] =>
  readProposals(activeStorePath(story.dataDir));

export const lastInputOrder = (story: Story): number =>
  proposalsOf(story).at(-1)?.inputOrder ?? 0;

/** Every journaled proposal a god's turn produced (source model), optionally of one actor. */
export const modelProposals = (story: Story, actor?: string) =>
  proposalsOf(story).filter(
    (entry) =>
      entry.source === "model" &&
      (actor === undefined || entry.actor === actor),
  );

/** Awaits `promise`, failing naming `invariant` if it takes longer than `ms`. */
export async function within<T>(
  invariant: string,
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ScenarioFailure(invariant, `not observed within ${ms} ms`),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The first journaled model proposal by `actor` of `kind` after `afterOrder`. */
export const waitForModelProposal = (
  story: Story,
  actor: string,
  kind: string,
  afterOrder: number,
  why: string,
  timeoutMs = 30_000,
) =>
  waitFor(
    why,
    () =>
      modelProposals(story, actor).find(
        (entry) => entry.inputOrder > afterOrder && entry.kind === kind,
      ),
    { timeoutMs, intervalMs: 50 },
  );

/** The journal row of `proposalId` once a tick has consumed it. */
export const waitForConsumed = (
  story: Story,
  proposalId: string,
  why: string,
  timeoutMs = 20_000,
) =>
  waitFor(
    why,
    () => {
      const row = proposalsOf(story).find((e) => e.proposalId === proposalId);
      return row?.consumedTick === undefined ? undefined : row;
    },
    { timeoutMs, intervalMs: 50 },
  );

/** Queues `reply` for `god`, waits for the proposal its turn journals, and waits for it to run. Fails unless it committed. */
export async function driveGod(
  story: Story,
  god: God,
  kind: string,
  reply: Reply,
  why: string,
): Promise<JournaledProposal> {
  const after = lastInputOrder(story);
  story.provider.enqueue(god, reply);
  const journaled = await waitForModelProposal(
    story,
    god,
    kind,
    after,
    `${why}: ${god}'s ${kind} turn is journaled`,
  );
  const consumed = await waitForConsumed(
    story,
    journaled.proposalId,
    `${why}: ${god}'s ${kind} runs on a tick`,
  );
  check(
    consumed.outcome === "committed",
    `${why}: ${god}'s ${kind} commits`,
    `${consumed.outcome} ${consumed.reason}`,
  );
  return consumed;
}

export async function stateOf(story: Story): Promise<WorldState> {
  return (await readFrame(story.sidecar)).state;
}

export async function locationOf(
  story: Story,
  actor: string,
): Promise<string | undefined> {
  return (await stateOf(story)).actors.get(toEntityId(actor))?.locationId;
}

/**
 * A god travels to `to`: one scripted travel turn, then the world walks the
 * journey one hop a tick until the god stands there.
 */
export async function walk(story: Story, god: God, to: string): Promise<void> {
  await driveGod(
    story,
    god,
    "travel",
    JSON.stringify({ action: "travel", to }),
    `${god} sets out for ${to}`,
  );
  const at = await waitFor(
    `${god} arrives at ${to}`,
    async () => ((await locationOf(story, god)) === to ? to : undefined),
    { timeoutMs: 30_000, intervalMs: 100 },
  );
  check(at === to, `${god} stands at ${to}`, String(at));
}

/** Posts a fixture proposal for `actor` (source fixture, staging the world) and returns its id without waiting for a tick to run it. */
export async function submitFixture(
  story: Story,
  actor: string,
  fields: Record<string, unknown>,
  why: string,
): Promise<string> {
  const { frame } = await readFrame(story.sidecar);
  const proposalId = createProposalId();
  const observationId = createObservationId();
  const response = await story.sidecar.request("POST", "/proposals", {
    proposalId,
    observation: {
      schemaVersion: 1,
      id: observationId,
      observer: actor,
      stateRevision: frame.sequence,
      factsRead: [],
      source: "fixture",
    },
    proposal: {
      schemaVersion: 1,
      actor,
      targets: [],
      expectedRevisions: [],
      source: "fixture",
      observationId,
      ...fields,
    },
  });
  check(
    response.status === 202 || response.status === 200,
    `${why}: the fixture is accepted`,
    `${response.status} ${JSON.stringify(response.body)}`,
  );
  return proposalId;
}

/**
 * Posts a fixture proposal for `actor` (source fixture, staging the world) and
 * waits for the tick that runs it. Returns its journal row.
 */
export async function postFixture(
  story: Story,
  actor: string,
  fields: Record<string, unknown>,
  why: string,
): Promise<JournaledProposal> {
  const proposalId = await submitFixture(story, actor, fields, why);
  return waitForConsumed(story, proposalId, `${why}: the fixture runs`);
}

export const legend = (assertion: string): string =>
  JSON.stringify({ action: "legend", assertion });
