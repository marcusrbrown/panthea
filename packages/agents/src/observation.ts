// The trusted observation builder: the service, not the model, decides what a
// model-made proposal claims about the world. The model supplies an intent;
// this module sets the actor, a fresh observation id, `factsRead` (a subset of
// what the actor's snapshot holds), `stateRevision`, and `expectedRevisions`
// for every entity the intent touches. A world that moved between the
// snapshot and the tick therefore rejects the proposal as `stale-target`.
//
// It refuses an intent whose target is not in the snapshot before anything is
// journaled, so a hallucinated target never becomes a stored proposal.

import {
  createObservationId,
  type EntityId,
  type EntityRevision,
  type ObservationRecord,
  type Proposal,
  type ProposalSource,
} from "@panthea/contracts";
import type { PerceptionSnapshot } from "@panthea/world";
import {
  NOTHING_REMEMBERED,
  type ParsedGodIntent,
  type Remembered,
  shownIds,
} from "./context";

/**
 * What a parsed intent becomes. Discriminated on `kind`, so a caller must
 * narrow to `"proposal"` before it can journal anything: a `wait` carries no
 * proposal and no observation, and a refusal carries neither.
 */
/** The proposal source of every model-built proposal. */
const MODEL_SOURCE: ProposalSource = "model";

export type ModelProposalResult =
  | {
      readonly ok: true;
      readonly kind: "proposal";
      readonly observation: ObservationRecord;
      readonly proposal: Proposal;
    }
  | { readonly ok: true; readonly kind: "wait" }
  | { readonly ok: false; readonly message: string };

const refuse = (message: string): ModelProposalResult => ({
  ok: false,
  message,
});

/**
 * Every fact a snapshot holds, named the way an observation's `factsRead`
 * names them. An observation may cite only these.
 */
export function snapshotFacts(
  snapshot: PerceptionSnapshot,
  remembered: Remembered = NOTHING_REMEMBERED,
): Set<string> {
  const facts = new Set<string>([
    `actor:${snapshot.self.id}.inventory`,
    `actor:${snapshot.self.id}.location`,
    `location:${snapshot.location.id}`,
  ]);
  for (const place of snapshot.destinations) facts.add(`location:${place.id}`);
  for (const actor of snapshot.actors) facts.add(`actor:${actor.id}.location`);
  for (const building of snapshot.buildings) {
    facts.add(`building:${building.id}.status`);
  }
  for (const event of snapshot.events) facts.add(`event:${event.id}`);
  for (const memory of remembered.memories) facts.add(`memory:${memory.id}`);
  for (const feeling of remembered.relationships) {
    facts.add(`feeling:${feeling.toward}`);
  }
  for (const petition of remembered.petitions) {
    facts.add(`petition:${petition.id}`);
  }
  for (const thread of remembered.threads) facts.add(`thread:${thread.id}`);
  return facts;
}

/** The fact an observation cites for a goal's target: the scene fact when it is here, or the remembered account or feeling that named it. */
function goalTargetFact(
  snapshot: PerceptionSnapshot,
  remembered: Remembered,
  target: EntityId,
): string {
  if (snapshot.actors.some((actor) => actor.id === target)) {
    return `actor:${target}.location`;
  }
  if (snapshot.buildings.some((building) => building.id === target)) {
    return `building:${target}.status`;
  }
  if (
    snapshot.location.id === target ||
    snapshot.destinations.some((place) => place.id === target)
  ) {
    return `location:${target}`;
  }
  const memory = remembered.memories.find(
    (m) =>
      m.subjects.includes(target) ||
      m.consequence?.agent === target ||
      m.consequence?.target === target ||
      (m.kind === "told" && m.teller === target),
  );
  if (memory !== undefined) return `memory:${memory.id}`;
  return `feeling:${target}`;
}

/**
 * Builds the observation and proposal for `intent`, made by `actorId` from
 * `snapshot`. `intent` must come from `godIntentSchema`'s parse, which is the
 * only thing that checks the action and strike power; this builder re-checks
 * that every target is in `snapshot`, since the intent may have been parsed
 * against an older one. The service stamps the `model` source on
 * both records; neither the model nor the caller chooses it.
 */
export function buildModelProposal(
  actorId: EntityId,
  snapshot: PerceptionSnapshot,
  intent: ParsedGodIntent,
  remembered: Remembered = NOTHING_REMEMBERED,
): ModelProposalResult {
  if (snapshot.observer !== actorId) {
    return refuse(
      `the snapshot was taken by ${snapshot.observer}, not ${actorId}`,
    );
  }

  // A goal's target is checked against the ids the god was shown, the same set
  // the parser used: the scene plus what its prompt remembered.
  const goalTarget = intent.goal?.set?.target;
  if (
    goalTarget !== undefined &&
    !shownIds(snapshot, remembered).includes(goalTarget)
  ) {
    return refuse(`${goalTarget} is not an id the god was shown`);
  }

  // A wait with nothing to change claims nothing: no observation, no proposal.
  if (intent.action === "wait" && intent.goal === undefined) {
    return { ok: true, kind: "wait" };
  }

  const factsRead = [`actor:${actorId}.inventory`, `actor:${actorId}.location`];
  if (goalTarget !== undefined) {
    factsRead.push(goalTargetFact(snapshot, remembered, goalTarget));
  }
  // Only the actions that stand on what they saw pin anything: strike pins the
  // god, its location, and the building. Report, travel, legend, and bless pin nothing. A revision goes up on
  // any change, so a pin refused them for changes they do not depend on (a
  // bystander arriving or leaving raises the location's, a mortal's worship
  // raises the god's), while the validator already judges at commit time
  // everything those pins would protect: the god alive, its current location and
  // access to the destination (travel), its presence with the listener and what
  // it cites (report), and the audience at its place (legend).
  const expectedRevisions: EntityRevision[] = [];
  const selfPin: EntityRevision = {
    entityId: actorId,
    revision: snapshot.self.revision,
  };
  const locationPin: EntityRevision = {
    entityId: snapshot.location.id,
    revision: snapshot.location.revision,
  };
  const observationId = createObservationId();
  const base = {
    schemaVersion: 1,
    actor: actorId,
    expectedRevisions,
    source: MODEL_SOURCE,
    observationId,
    ...(intent.goal === undefined ? {} : { goal: intent.goal }),
  };

  let proposal: Proposal;
  switch (intent.action) {
    case "wait": {
      // A goal-only turn has no action to protect, so it pins no revisions: a
      // world that moved while the god thought must not refuse its declaration.
      if (intent.goal === undefined) return refuse("a wait carries no goal");
      proposal = {
        ...base,
        expectedRevisions: [],
        targets: [],
        kind: "goal",
        goal: intent.goal,
      };
      break;
    }
    case "travel": {
      if (!snapshot.destinations.some((place) => place.id === intent.to)) {
        return refuse(`${intent.to} is not a destination in the snapshot`);
      }
      factsRead.push(`location:${intent.to}`);
      // A journey pins nothing: the world works the route out from wherever the god stands when it commits, and judges every hop as it walks.
      proposal = { ...base, targets: [], kind: "travel", to: intent.to };
      break;
    }
    case "strike": {
      const target = snapshot.buildings.find(
        (building) => building.id === intent.target,
      );
      if (!target) {
        // Not a building here: the mortal a shown prayer asks the god to punish. The world takes its goods wherever it
        // is, so nothing pins its place or its revision (a routine moves it every tick); the prayer is the fact.
        const prayer = remembered.petitions.find(
          (candidate) => candidate.strikeMortal?.target === intent.target,
        );
        if (prayer === undefined) {
          return refuse(
            `${intent.target} is not a building in the snapshot or the offender of a prayer shown`,
          );
        }
        factsRead.push(`petition:${prayer.id}`);
        expectedRevisions.push(selfPin);
        proposal = {
          ...base,
          targets: [intent.target],
          kind: "strike",
          target: intent.target,
          power: intent.power,
        };
        break;
      }
      factsRead.push(`building:${target.id}.status`);
      expectedRevisions.push(selfPin, locationPin, {
        entityId: target.id,
        revision: target.revision,
      });
      proposal = {
        ...base,
        targets: [target.id],
        kind: "strike",
        target: target.id,
        power: intent.power,
      };
      break;
    }
    case "report": {
      const listener = snapshot.actors.find(
        (actor) => actor.id === intent.listener,
      );
      if (!listener) {
        return refuse(`${intent.listener} is not an actor in the snapshot`);
      }
      factsRead.push(`actor:${listener.id}.location`);
      // The listener's revision is not pinned: its liveness and presence are
      // judged again when the report is validated, and its inventory changing
      // (a routine gather, a trade) is no reason to refuse a report.
      proposal = {
        ...base,
        targets: [listener.id],
        kind: "report",
        listener: listener.id,
        content: intent.content,
        ...(intent.claim === undefined ? {} : { claim: intent.claim }),
        ...(intent.linkedEventId === undefined
          ? {}
          : { linkedEventId: intent.linkedEventId }),
      };
      break;
    }
    case "bless": {
      const petition = remembered.petitions.find(
        (candidate) => candidate.id === intent.petition,
      );
      if (!petition || petition.bless === undefined) {
        return refuse(`${intent.petition} is not a prayer the god was shown`);
      }
      factsRead.push(`petition:${petition.id}`);
      // A bless answers the prayer, wherever the god and the petitioner stand, so it is built from the prayer and not from
      // the scene. It pins no revision. Everything it depends on is judged again when it is validated: the god's divinity,
      // the petitioner alive, the petition open, addressed to this god, of a kind a bless answers, and inside its window.
      // A pin only added refusals for changes it does not depend on (a routine gathering raises the petitioner's
      // revision, any mortal passing through raises the location's, a mortal's worship raises the god's own) and hid
      // the real reason when one did apply.
      proposal = {
        ...base,
        expectedRevisions: [],
        targets: [petition.petitioner],
        kind: "bless",
        petition: petition.id,
      };
      break;
    }
    case "refuse": {
      const petition = remembered.petitions.find(
        (candidate) => candidate.id === intent.petition,
      );
      if (petition === undefined) {
        return refuse(`${intent.petition} is not a prayer the god was shown`);
      }
      factsRead.push(`petition:${petition.id}`);
      // A refusal pins nothing: the world judges again that the prayer is open, addressed to the god, and inside its window.
      proposal = {
        ...base,
        expectedRevisions: [],
        targets: [],
        kind: "refuse",
        petition: petition.id,
      };
      break;
    }
    case "practice": {
      if (intent.move === "offer") {
        const prayer = remembered.practice.offerable.find(
          (candidate) => candidate.id === intent.petition,
        );
        const petition = remembered.petitions.find(
          (candidate) => candidate.id === intent.petition,
        );
        if (prayer === undefined || petition === undefined) {
          return refuse(`${intent.petition} is not a prayer the god was shown`);
        }
        factsRead.push(`petition:${petition.id}`);
        // An offer opens a thread, so there is nothing to pin: whether the
        // prayer is still open, the offering affordable, the stake authored,
        // and no terms already standing are judged when it commits.
        proposal = {
          ...base,
          targets: [],
          kind: "practice",
          move: "offer",
          petition: intent.petition,
          term: intent.term,
          ...(intent.stake === undefined ? {} : { stake: intent.stake }),
        };
        break;
      }
      if (intent.move === "contest") {
        const act = remembered.practice.contests.find(
          (candidate) => candidate.id === intent.cause,
        );
        if (act === undefined) {
          return refuse(`${intent.cause} is not an act the god was shown`);
        }
        factsRead.push(`event:${act.id}`);
        // A contest opens a record of its own, so there is nothing to pin: whether
        // the act is still the rival's to be contested, the god saw it, and the
        // place holds no contest already are judged when it commits.
        proposal = {
          ...base,
          targets: [],
          kind: "practice",
          move: "contest",
          cause: act.id,
        };
        break;
      }
      if (intent.move === "demand") {
        const cause = remembered.practice.causes.find(
          (candidate) => candidate.id === intent.cause,
        );
        if (cause === undefined) {
          return refuse(`${intent.cause} is not a cause the god was shown`);
        }
        // A demand opens a thread, so there is nothing to pin: whether the god
        // knows the cause, the other god lives, and the term can be performed
        // are all judged when it commits.
        factsRead.push(cause.fact ?? `memory:${cause.memoryId}`);
        proposal = {
          ...base,
          targets: [],
          kind: "practice",
          move: "demand",
          counterparty: intent.term.party,
          cause: cause.id,
          term: intent.term,
        };
        break;
      }
      const thread = remembered.threads.find(
        (candidate) => candidate.id === intent.thread,
      );
      if (thread === undefined) {
        return refuse(`${intent.thread} is not a thread the god was shown`);
      }
      factsRead.push(`thread:${thread.id}`);
      // A move pins its thread's revision and nothing else. What the move
      // depends on (the god alive and a party, the thread open and inside its
      // window, the offer the other god's, the budget, the term performable) is
      // judged again at commit; a pin on the god, its place, or the other party
      // would only refuse it for changes it does not depend on.
      expectedRevisions.push({
        entityId: thread.id as unknown as EntityId,
        revision: thread.revision,
      });
      const move = {
        ...base,
        targets: [],
        kind: "practice" as const,
        thread: thread.id,
      };
      proposal =
        intent.move === "counter"
          ? { ...move, move: "counter", term: intent.term }
          : intent.move === "accept"
            ? {
                ...move,
                move: "accept",
                ...(intent.swear === undefined ? {} : { swear: intent.swear }),
              }
            : { ...move, move: intent.move };
      break;
    }
    case "legend": {
      if (
        intent.linkedEventId !== undefined &&
        !snapshot.events.some((event) => event.id === intent.linkedEventId)
      ) {
        return refuse(
          `${intent.linkedEventId} is not an event in the snapshot`,
        );
      }
      if (intent.linkedEventId !== undefined) {
        factsRead.push(`event:${intent.linkedEventId}`);
      }
      proposal = {
        ...base,
        targets: [],
        kind: "legend",
        assertion: intent.assertion,
        ...(intent.claim === undefined ? {} : { claim: intent.claim }),
        ...(intent.linkedEventId === undefined
          ? {}
          : { linkedEventId: intent.linkedEventId }),
      };
      break;
    }
  }

  const observation: ObservationRecord = {
    schemaVersion: 1,
    id: observationId,
    observer: actorId,
    stateRevision: snapshot.stateRevision,
    factsRead,
    source: MODEL_SOURCE,
  };
  return { ok: true, kind: "proposal", observation, proposal };
}
