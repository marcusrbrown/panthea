// Constructed episode data for the analysis and transcript tests: gods,
// committed proposals with the events they caused, and derived memory events.

import type { GodIdentity } from "./episode-analysis";
import type { RealInput, RealProposal, RealRequest } from "./real-analysis";

export const identities = new Map<string, GodIdentity>([
  [
    "zeus",
    {
      id: "zeus",
      name: "Zeus",
      domains: ["sky"],
      drives: { sovereignty: 0.9 },
      abilities: [
        { name: "Thunderbolt", action: "strike" },
        { name: "Pronouncement", action: "legend" },
      ],
    },
  ],
  [
    "hera",
    {
      id: "hera",
      name: "Hera",
      domains: ["marriage"],
      drives: { order: 0.8 },
      abilities: [{ name: "Tale of a Grievance", action: "legend" }],
    },
  ],
]);

let n = 0;
/** One committed god proposal and the event it caused, at `sequence`. */
export function act(
  actor: string,
  fields: Record<string, unknown>,
  sequence: number,
  over: { role?: string | null; outcome?: "committed" | "rejected" } = {},
) {
  n += 1;
  const proposalId = `p${n}`;
  const observationId = `obs-${n}`;
  const proposal: RealProposal = {
    proposalId,
    actor,
    kind: String(fields.kind),
    observationId,
    proposal: { actor, ...fields },
    outcome: over.outcome ?? "committed",
  };
  const request: RealRequest | undefined =
    over.role === null
      ? undefined
      : {
          proposalId,
          role: over.role ?? actor,
          outcome: "intent",
          elapsedMs: 1000,
          promptPayload: "prompt",
          steps: [{ mode: "native" }],
        };
  const eventKind =
    fields.kind === "report"
      ? "report-told"
      : fields.kind === "legend"
        ? "legend-recorded"
        : fields.kind === "goal"
          ? "goal-set"
          : "entity-moved";
  const event = {
    schemaVersion: 1,
    id: `evt-${sequence}-${sequence}`,
    sequence,
    simTime: 0,
    correlationId: observationId,
    causationId: observationId,
    tick: 1,
    approximate: false,
    kind: eventKind,
    entityId: actor,
    ...(fields.kind === "report"
      ? {
          listenerId: fields.listener,
          content: fields.content,
          ...(fields.linkedEventId === undefined
            ? {}
            : { linkedEventId: fields.linkedEventId }),
        }
      : fields.kind === "legend"
        ? {
            assertion: fields.assertion,
            hearers: fields.hearers ?? [],
            ...(fields.claim === undefined ? {} : { claim: fields.claim }),
          }
        : fields.kind === "goal"
          ? {
              text:
                (fields.goal as { set?: { text: string } })?.set?.text ??
                "A goal.",
              target:
                (fields.goal as { set?: { target: string } })?.set?.target ??
                "zeus",
            }
          : { from: "here", to: "there" }),
  };
  return { proposal, request, event };
}

/**
 * A committed bless by `actor` and the event it caused, as the world's log
 * holds it: a blessing-granted event on the proposal's own correlation.
 */
export function blessAct(
  actor: string,
  petition: string,
  sequence: number,
  recipient = "farmer",
) {
  const made = act(actor, { kind: "bless", petition }, sequence);
  return {
    ...made,
    event: {
      ...made.event,
      kind: "blessing-granted",
      entityId: actor,
      recipient,
      petitionId: petition,
      resource: "food",
      amount: 2,
    },
  };
}

/**
 * The sign `petitioner` remembers of `god` answering (or leaving unanswered) a
 * petition, as the world derives it: sourced from the answering (or lapsing)
 * event, never from a proposal's observation.
 */
export const signMemoryEvent = (
  id: string,
  sequence: number,
  petitioner: string,
  god: string,
  sourceEventId: string,
  petitionId: string,
  outcome: "answered" | "lapsed" = "answered",
) =>
  memoryEvent(id, sequence, {
    memoryKind: "sign",
    entityId: petitioner,
    sourceEventId,
    god,
    outcome,
    petitionId,
    subjects: [god],
    consequence: {
      effect: outcome === "answered" ? "kindness" : "harm",
      agent: god,
      target: petitioner,
    },
  });

/** `entityId` now feels differently toward `toward`, because of the memory `memoryEventId`. */
export const relationshipChangedEvent = (
  id: string,
  sequence: number,
  entityId: string,
  toward: string,
  memoryEventId: string,
  affinityDelta = 1,
) => ({
  ...envelope(id, sequence, 1),
  kind: "relationship-changed",
  entityId,
  toward,
  affinityDelta,
  grudgeDelta: 0,
  memoryEventId,
});

export function input(
  acts: ReturnType<typeof act>[],
  extraEvents: Record<string, unknown>[] = [],
): RealInput {
  return {
    requests: acts.flatMap((a) => (a.request ? [a.request] : [])),
    proposals: acts.map((a) => a.proposal),
    events: [...acts.map((a) => a.event), ...extraEvents].sort(
      (a, b) => Number(a.sequence) - Number(b.sequence),
    ) as RealInput["events"],
    polls: { total: 10, degraded: 0 },
  };
}

export const move = (actor: string, to: string, sequence: number) =>
  act(actor, { kind: "travel", to }, sequence);

export const memoryEvent = (
  id: string,
  sequence: number,
  fields: Record<string, unknown>,
) => ({
  schemaVersion: 1,
  id,
  sequence,
  simTime: 0,
  correlationId: "tick-1",
  causationId: "x",
  tick: 1,
  approximate: false,
  kind: "memory-recorded",
  subjects: [],
  salience: 4,
  ...fields,
});

/** A goal-set event by `actor`, as the log holds it. */
export const goalSetEvent = (
  id: string,
  sequence: number,
  actor: string,
  text = "A goal.",
  target = "zeus",
) => ({
  schemaVersion: 1,
  id,
  sequence,
  simTime: 0,
  correlationId: `obs-${id}`,
  causationId: `obs-${id}`,
  tick: 1,
  approximate: false,
  kind: "goal-set",
  entityId: actor,
  text,
  target,
});

/** A goal-ended event by `actor`, ending the goal set by `goalEventId`. */
export const goalEndedEvent = (
  id: string,
  sequence: number,
  actor: string,
  goalEventId: string,
  outcome = "achieved",
) => ({
  schemaVersion: 1,
  id,
  sequence,
  simTime: 0,
  correlationId: `obs-${id}`,
  causationId: `obs-${id}`,
  tick: 1,
  approximate: false,
  kind: "goal-ended",
  entityId: actor,
  outcome,
  goalEventId,
});

const envelope = (id: string, sequence: number, tick: number) => ({
  schemaVersion: 1,
  id,
  sequence,
  simTime: 0,
  tick,
  correlationId: `tick-${tick}`,
  causationId: `tick-${tick}`,
  approximate: false,
});

/** `actor` arrived at `to`, as the world's log holds it. */
export const movedEvent = (
  id: string,
  sequence: number,
  actor: string,
  to: string,
  tick = 1,
) => ({
  ...envelope(id, sequence, tick),
  kind: "entity-moved",
  entityId: actor,
  to,
});

/** A prayer by `petitioner` to `god`, about the event `cause`. */
export const petitionOpenedEvent = (
  id: string,
  sequence: number,
  petitioner: string,
  god: string,
  cause = "evt-1-1",
  tick = 1,
) => ({
  ...envelope(id, sequence, tick),
  kind: "petition-opened",
  entityId: petitioner,
  god,
  cause,
  request: { kind: "help", need: { kind: "resource", resource: "food" } },
});

/** `god` answering `petitioner`'s petition `petitionId`. */
export const petitionAnsweredEvent = (
  id: string,
  sequence: number,
  petitioner: string,
  god: string,
  petitionId: string,
  answeredBy = "evt-9-9",
  tick = 5,
) => ({
  ...envelope(id, sequence, tick),
  kind: "petition-answered",
  entityId: petitioner,
  god,
  petitionId,
  answeredBy,
});

export const petitionLapsedEvent = (
  id: string,
  sequence: number,
  petitioner: string,
  god: string,
  petitionId: string,
  tick = 250,
) => ({
  ...envelope(id, sequence, tick),
  kind: "petition-lapsed",
  entityId: petitioner,
  god,
  petitionId,
});

export const goalRefusedEvent = (
  id: string,
  sequence: number,
  god: string,
  tick = 3,
  unlocksInTicks = 37,
) => ({
  ...envelope(id, sequence, tick),
  kind: "goal-change-refused",
  entityId: god,
  reason: "locked",
  attempted: "replace",
  unlocksInTicks,
});
