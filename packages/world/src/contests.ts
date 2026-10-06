// Contest for favour: gods with a rivalry claim a place's people.
//
// A god opens a contest (the `contest` practice move) only over a rival's bless,
// strike, or legend it perceived at a place with a mortal in it. The world keeps
// each such act for a while in `WorldState.services`, noted as the event applies,
// so replay rebuilds it; what the god may cite is read from there, never from the
// model's say-so. A contest runs a window. Over it, each god's services count per
// mortal from what that mortal experienced: a bless to the one blessed and a legend
// to those who heard it are weight for the god, a strike is weight against it for
// every mortal at the struck place. At the end of the window each mortal favours
// the god it weighs most (never one that is not positive), and the god more mortals
// favour wins: its standing at the place rises, the other's falls, for good. A
// window with no god favoured over the other, or a place its people have left,
// expires and changes no one's standing.
//
// Everything here is judged from committed events, in the tick, like the thread
// judge: a contest closes at the end of its last tick, so live play and catch-up
// close it at the same tick with the same result.

import {
  affinityLimitOf,
  type ContestClosedEvent,
  type ContestFavour,
  type ContestOpenedEvent,
  createObservationId,
  type EntityId,
  type EventId,
  type PracticeProposal,
  type WorldEvent,
} from "@panthea/contracts";
import { getMemories } from "./memory";
import { perceivesEvent } from "./perception";
import { type PracticeVerdict, practiceBalanceOf } from "./practices";
import {
  type ActorState,
  type Contest,
  type ContestTally,
  getActor,
  getBuilding,
  isContestOpen,
  type MemoryEntry,
  type ServiceAct,
  standingOf,
  type WorldEventDraft,
  type WorldState,
} from "./state";

/** Whether two gods contest one another: either one's rivals name the other. */
export function areRivals(
  state: WorldState,
  a: EntityId,
  b: EntityId,
): boolean {
  if (a === b) return false;
  return (
    (getActor(state, a)?.rivals ?? []).includes(b) ||
    (getActor(state, b)?.rivals ?? []).includes(a)
  );
}

/** Where a mortal belongs: the place it lives, else where it stands. */
export function placeOf(actor: ActorState): EntityId {
  return actor.home ?? actor.locationId;
}

/** The living mortals who belong to `place`: a place's people. */
export function mortalsOf(state: WorldState, place: EntityId): ActorState[] {
  return [...state.actors.values()].filter(
    (actor) =>
      actor.alive && actor.isDeity !== true && placeOf(actor) === place,
  );
}

const isMortal = (actor: ActorState | undefined): actor is ActorState =>
  actor?.alive === true && actor.isDeity !== true;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// --- The ledger: acts a rival can contest ----------------------------------------------------------

/**
 * The act `event` is, if it is a god's bless, strike (on a building or a mortal), or legend where mortals
 * were: who did it, where, who experienced it, and which other gods perceived
 * it. `before` is the world as it stood before the event. An act that reached
 * no mortal is none the world keeps.
 */
function serviceOf(
  before: WorldState,
  event: WorldEvent,
): ServiceAct | undefined {
  let kind: ServiceAct["kind"];
  let god: EntityId;
  let place: EntityId | undefined;
  let reached: EntityId[];
  switch (event.kind) {
    case "blessing-granted": {
      kind = "bless";
      god = event.entityId;
      const recipient = getActor(before, event.recipient);
      place = recipient?.locationId;
      reached = isMortal(recipient) ? [recipient.id] : [];
      break;
    }
    case "legend-recorded": {
      kind = "legend";
      god = event.entityId;
      place = getActor(before, event.entityId)?.locationId;
      reached = event.hearers.filter((hearer) =>
        isMortal(getActor(before, hearer)),
      );
      break;
    }
    case "building-damaged":
    case "building-ignited":
    case "mortal-struck": {
      kind = "strike";
      if (event.kind === "building-ignited") {
        if (event.cause.kind !== "strike") return undefined;
        god = event.cause.actor;
      } else {
        god = event.actor;
      }
      place =
        event.kind === "mortal-struck"
          ? getActor(before, event.entityId)?.locationId
          : getBuilding(before, event.entityId)?.locationId;
      reached =
        place === undefined
          ? []
          : [...before.actors.values()]
              .filter((a) => isMortal(a) && a.locationId === place)
              .map((a) => a.id);
      break;
    }
    default:
      return undefined;
  }
  if (place === undefined || reached.length === 0) return undefined;
  if (getActor(before, god)?.isDeity !== true) return undefined;
  const perceivedBy = [...before.actors.values()]
    .filter(
      (actor) =>
        actor.alive &&
        actor.isDeity === true &&
        actor.id !== god &&
        perceivesEvent(before, actor, event, []),
    )
    .map((actor) => actor.id)
    .sort(byId);
  return {
    id: event.id,
    kind,
    god,
    place,
    tick: event.tick,
    sequence: event.sequence,
    reached: [...reached].sort(byId),
    perceivedBy,
  };
}

/** How a service weighs for the god that did it, with the mortal who experienced it. */
const weightOf = (kind: ServiceAct["kind"]): number =>
  kind === "strike" ? -1 : 1;

function addTally(
  tallies: readonly ContestTally[],
  god: EntityId,
  mortal: EntityId,
  weight: number,
): ContestTally[] {
  const next = [...tallies];
  const at = next.findIndex((t) => t.god === god && t.mortal === mortal);
  if (at >= 0) {
    const held = next[at] as ContestTally;
    next[at] = { ...held, weight: held.weight + weight };
  } else {
    next.push({ god, mortal, weight });
    next.sort((a, b) => byId(a.god, b.god) || byId(a.mortal, b.mortal));
  }
  return next;
}

/**
 * Notes `event` if it is an act a rival can contest: it joins the ledger, which
 * keeps the newest `contestLedgerMax` acts no older than `contestActTicks`, and
 * it counts in every open contest at its place that one of its two gods is in,
 * when it came after the contest opened and no later than the tick its window
 * ends. `before` is the world as the event found it; `after` has the event
 * applied.
 */
export function noteService(
  before: WorldState,
  after: WorldState,
  event: WorldEvent,
): WorldState {
  const act = serviceOf(before, event);
  if (act === undefined) return after;
  // One strike is one act, though it may damage and ignite.
  if (
    act.kind === "strike" &&
    after.services.some(
      (held) =>
        held.kind === "strike" &&
        held.god === act.god &&
        held.place === act.place &&
        held.tick === act.tick,
    )
  ) {
    return after;
  }
  const maxAge = practiceBalanceOf(after.rules, "contestActTicks");
  const max = practiceBalanceOf(after.rules, "contestLedgerMax");
  const services = [...after.services, act]
    .filter((held) => act.tick - held.tick <= maxAge)
    .slice(-max);
  let contests = after.contests;
  for (const contest of after.contests.values()) {
    if (
      !isContestOpen(contest) ||
      contest.place !== act.place ||
      (act.god !== contest.opener && act.god !== contest.rival) ||
      act.sequence <= contest.openedSequence ||
      act.tick > contest.closesAt
    ) {
      continue;
    }
    let tallies = contest.tallies;
    for (const mortal of act.reached) {
      tallies = addTally(tallies, act.god, mortal, weightOf(act.kind));
    }
    contests = new Map(contests).set(contest.id, { ...contest, tallies });
  }
  return { ...after, services, contests };
}

// --- Opening ---------------------------------------------------------------------------------------

const refuse = (
  reason: "malformed" | "unauthorized-claim" | "no-progress",
  message: string,
  thread?: EventId,
): PracticeVerdict => ({
  ok: false,
  reason,
  message,
  ...(thread === undefined ? {} : { thread }),
});

/** The acts `god` perceived, by rivals it contests, that it may still open a contest over right now: each one the world would accept. Newest last. */
export function contestableActs(
  state: WorldState,
  god: EntityId,
): readonly ServiceAct[] {
  return state.services.filter((act) => {
    const verdict = validateContest(state, {
      schemaVersion: 1,
      actor: god,
      targets: [],
      expectedRevisions: [],
      source: "model",
      observationId: createObservationId(),
      kind: "practice",
      move: "contest",
      cause: act.id,
    });
    return verdict.ok;
  });
}

/**
 * A contest over a defection: the god a mortal left contests its home with the god it went to. It rests on
 * the opener's own memory of the change of patron, so it needs no rivalry, no perceived act, and no act young
 * enough; only the god that lost the worshipper may cite it, and once.
 */
function validateDefection(
  state: WorldState,
  proposal: Extract<PracticeProposal, { move: "contest" }>,
  memory: Extract<MemoryEntry, { kind: "patronage" }>,
): PracticeVerdict {
  if (memory.from !== proposal.actor) {
    return refuse(
      "unauthorized-claim",
      "only the god that lost the worshipper may contest its defection",
    );
  }
  const rival = getActor(state, memory.to);
  if (rival?.alive !== true || rival.isDeity !== true) {
    return refuse("malformed", `${memory.to} is no longer a living god`);
  }
  if (mortalsOf(state, memory.home).length === 0) {
    return refuse("malformed", `no mortal lives at ${memory.home} now`);
  }
  const here = [...state.contests.values()].filter(
    (contest) => contest.place === memory.home,
  );
  const open = here.find(isContestOpen);
  if (open !== undefined) {
    return refuse(
      "no-progress",
      `${open.id} already holds ${memory.home} between ${open.opener} and ${open.rival}; let it close`,
      open.id,
    );
  }
  const spent = here.find((contest) => contest.cause === proposal.cause);
  if (spent !== undefined) {
    return refuse(
      "no-progress",
      `that defection was already contested (${spent.id})`,
      spent.id,
    );
  }
  const latest = here
    .filter(
      (contest) =>
        (contest.opener === proposal.actor && contest.rival === memory.to) ||
        (contest.opener === memory.to && contest.rival === proposal.actor),
    )
    .sort((a, b) => a.openedSequence - b.openedSequence)
    .at(-1);
  return {
    ok: true,
    events: [
      {
        kind: "contest-opened",
        entityId: proposal.actor,
        rival: memory.to,
        place: memory.home,
        cause: proposal.cause,
        closesAt:
          state.tick + practiceBalanceOf(state.rules, "contestWindowTicks"),
        ...(latest === undefined ? {} : { succeeds: latest.id }),
      },
    ],
  };
}

/** The events a contest proposal would commit, or why the world refuses it. */
export function validateContest(
  state: WorldState,
  proposal: Extract<PracticeProposal, { move: "contest" }>,
): PracticeVerdict {
  const god = getActor(state, proposal.actor);
  if (god?.alive !== true || god.isDeity !== true) {
    return refuse("unauthorized-claim", "only a living god contests");
  }
  const maxAge = practiceBalanceOf(state.rules, "contestActTicks");
  const act = state.services.find((held) => held.id === proposal.cause);
  if (act === undefined) {
    const defection = getMemories(state, proposal.actor).find(
      (memory) =>
        memory.kind === "patronage" && memory.sourceEventId === proposal.cause,
    );
    if (defection?.kind === "patronage") {
      return validateDefection(state, proposal, defection);
    }
  }
  if (act === undefined || state.tick - act.tick > maxAge) {
    return refuse(
      "malformed",
      `${proposal.cause} is not a rival's bless, strike, or legend before mortals that can still be contested`,
    );
  }
  if (act.god === proposal.actor) {
    return refuse("unauthorized-claim", "a god does not contest its own act");
  }
  if (!areRivals(state, proposal.actor, act.god)) {
    return refuse(
      "unauthorized-claim",
      `${proposal.actor} has no rivalry with ${act.god}`,
    );
  }
  if (!act.perceivedBy.includes(proposal.actor)) {
    return refuse(
      "unauthorized-claim",
      `${proposal.actor} did not perceive ${proposal.cause}`,
    );
  }
  if (mortalsOf(state, act.place).length === 0) {
    return refuse("malformed", `no mortal lives at ${act.place} now`);
  }
  const here = [...state.contests.values()].filter(
    (contest) => contest.place === act.place,
  );
  const open = here.find(isContestOpen);
  if (open !== undefined) {
    return refuse(
      "no-progress",
      `${open.id} already holds ${act.place} between ${open.opener} and ${open.rival}; let it close`,
      open.id,
    );
  }
  // Once closed, a new contest at this place between these gods needs a rival act that came after the last one closed.
  const between = here
    .filter(
      (contest) =>
        (contest.opener === proposal.actor && contest.rival === act.god) ||
        (contest.opener === act.god && contest.rival === proposal.actor),
    )
    .sort((a, b) => a.openedSequence - b.openedSequence);
  const latest = between.at(-1);
  if (latest !== undefined) {
    const consumed = between.some((contest) => contest.cause === act.id);
    if (consumed || act.sequence <= (latest.closedSequence ?? 0)) {
      return refuse(
        "no-progress",
        `that was already contested (${latest.id}); a new contest at ${act.place} needs a rival act since it closed`,
        latest.id,
      );
    }
  }
  return {
    ok: true,
    events: [
      {
        kind: "contest-opened",
        entityId: proposal.actor,
        rival: act.god,
        place: act.place,
        cause: act.id,
        closesAt:
          state.tick + practiceBalanceOf(state.rules, "contestWindowTicks"),
        ...(latest === undefined ? {} : { succeeds: latest.id }),
      },
    ],
  };
}

export function applyContestOpened(
  state: WorldState,
  event: ContestOpenedEvent,
): WorldState {
  const contest: Contest = {
    id: event.id,
    opener: event.entityId,
    rival: event.rival,
    place: event.place,
    cause: event.cause,
    openedTick: event.tick,
    openedSequence: event.sequence,
    closesAt: event.closesAt,
    ...(event.succeeds === undefined ? {} : { succeeds: event.succeeds }),
    status: "open",
    tallies: [],
  };
  return {
    ...state,
    contests: new Map(state.contests).set(contest.id, contest),
  };
}

export function applyContestClosed(
  state: WorldState,
  event: ContestClosedEvent,
): WorldState {
  const contest = state.contests.get(event.contestId);
  if (contest === undefined) return state;
  const closed: Contest = {
    ...contest,
    status: event.result,
    closedTick: event.tick,
    closedSequence: event.sequence,
    reason: event.reason,
    ...(event.result === "decided" ? { winner: event.winner } : {}),
  };
  return { ...state, contests: new Map(state.contests).set(closed.id, closed) };
}

/**
 * `state` with `delta` added to `god`'s standing at `place`, held within the pack's own affinity limit
 * either way (the one rule affinity keeps), so a win at the limit changes nothing more; a standing
 * back at 0 is absent.
 */
export function changeStanding(
  state: WorldState,
  god: EntityId,
  place: EntityId,
  delta: number,
): WorldState {
  const limit = affinityLimitOf(state.rules);
  const next = Math.max(
    -limit,
    Math.min(limit, standingOf(state, god, place) + delta),
  );
  const places = new Map(state.standing.get(god));
  if (next === 0) places.delete(place);
  else places.set(place, next);
  const standing = new Map(state.standing);
  if (places.size === 0) standing.delete(god);
  else standing.set(god, places);
  return { ...state, standing };
}

// --- Closing ---------------------------------------------------------------------------------------

/**
 * What each mortal in `tallies` favours: the god it weighs strictly more than the other, and only if that
 * weight is positive. Only the living who still belong to the contest's place vote (the same rule as
 * `mortalsOf`: home, else where it stands), so a mortal who died or moved away after it was served no
 * longer decides the place.
 */
export function favourOf(state: WorldState, contest: Contest): ContestFavour[] {
  const favoured: ContestFavour[] = [];
  const voters = new Set(mortalsOf(state, contest.place).map((a) => a.id));
  const mortals = [...new Set(contest.tallies.map((t) => t.mortal))]
    .filter((mortal) => voters.has(mortal))
    .sort(byId);
  for (const mortal of mortals) {
    const weigh = (god: EntityId) =>
      contest.tallies.find((t) => t.god === god && t.mortal === mortal)
        ?.weight ?? 0;
    const opener = weigh(contest.opener);
    const rival = weigh(contest.rival);
    if (opener > rival && opener > 0) {
      favoured.push({ mortal, god: contest.opener });
    } else if (rival > opener && rival > 0) {
      favoured.push({ mortal, god: contest.rival });
    }
  }
  return favoured;
}

/**
 * The contests this tick closes, as `contest-closed` drafts, in the order they
 * opened. A place its people have left (or all died) ends its contest expired
 * at once; otherwise a contest closes at the end of the last tick of its window,
 * decided for the god more mortals favour or, when neither, expired.
 */
export function judgeContests(after: WorldState): readonly WorldEventDraft[] {
  const drafts: WorldEventDraft[] = [];
  const open = [...after.contests.values()]
    .filter(isContestOpen)
    .sort((a, b) => a.openedSequence - b.openedSequence);
  for (const contest of open) {
    const base = {
      kind: "contest-closed" as const,
      entityId: contest.opener,
      rival: contest.rival,
      place: contest.place,
      contestId: contest.id,
    };
    if (mortalsOf(after, contest.place).length === 0) {
      drafts.push({ ...base, result: "expired", reason: "place-empty" });
      continue;
    }
    if (after.tick < contest.closesAt) continue;
    const favoured = favourOf(after, contest);
    const openers = favoured.filter((f) => f.god === contest.opener).length;
    const rivals = favoured.length - openers;
    if (openers === rivals) {
      drafts.push({ ...base, result: "expired", reason: "no-favour" });
      continue;
    }
    drafts.push({
      ...base,
      result: "decided",
      reason: "window",
      winner: openers > rivals ? contest.opener : contest.rival,
      favoured,
    });
  }
  return drafts;
}

/**
 * What a decision does to the gods: the winner's standing at the place rises and
 * the other's falls, each recorded as the sourced motif (standing won, standing
 * lost) citing the closing event. An expired contest changes nothing.
 */
export function planContestStanding(
  after: WorldState,
  closings: readonly ContestClosedEvent[],
): readonly WorldEventDraft[] {
  const drafts: WorldEventDraft[] = [];
  const delta = practiceBalanceOf(after.rules, "contestStanding");
  for (const closing of closings) {
    if (closing.result !== "decided") continue;
    const loser =
      closing.winner === closing.entityId ? closing.rival : closing.entityId;
    const about = {
      kind: "motif-applied" as const,
      effect: "standing" as const,
      place: closing.place,
      threadId: closing.contestId,
      cause: closing.id,
    };
    drafts.push(
      {
        ...about,
        entityId: closing.winner,
        motif: "standing-won",
        delta,
      },
      {
        ...about,
        entityId: loser,
        motif: "standing-lost",
        delta: -delta,
      },
    );
  }
  return drafts;
}

// --- What the world's pressure may land on ------------------------------------------------------------

/** The places something is open at: where an open thread's term names a place, where a mortal party to an open thread lives, and where a contest is held that no one has served. */
export function placesWithSomethingOpen(state: WorldState): Set<EntityId> {
  const places = new Set<EntityId>();
  for (const thread of state.threads.values()) {
    if (
      thread.status !== "open" &&
      thread.status !== "countered" &&
      thread.status !== "accepted"
    ) {
      continue;
    }
    const term = thread.term;
    if ("place" in term && typeof term.place === "string") {
      places.add(term.place as EntityId);
    }
    for (const party of [thread.demander, thread.obligated]) {
      const actor = getActor(state, party);
      if (isMortal(actor)) places.add(placeOf(actor));
    }
  }
  for (const contest of state.contests.values()) {
    if (isContestOpen(contest) && contest.tallies.length === 0) {
      places.add(contest.place);
    }
  }
  return places;
}
