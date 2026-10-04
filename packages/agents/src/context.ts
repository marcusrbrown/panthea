// A god's model prompt and the intent it may answer with. Both are built from
// the god's profile and one perception snapshot, never from the full world
// state or a frame: what the snapshot omits, the god cannot name, and the
// intent parser refuses anything that names it.
//
// The schema steers the model; the parser is the source of truth. A candidate
// that names an unperceived target, an action the god lacks, or a strike
// beyond its power fails to parse, so the router treats the reply as
// invalid-output and repairs it or falls back.

import type { GodAbility, GodProfile } from "@panthea/content";
import {
  type Brand,
  type Consequence,
  type EntityId,
  type EventId,
  GOAL_OUTCOMES,
  type GoalChange,
  type GoalChangeRefusedEvent,
  MAX_GOAL_LENGTH,
  MAX_REPORT_LENGTH,
  type PracticeRefusedEvent,
  type WorldEvent,
} from "@panthea/contracts";
import {
  type ActiveGoal,
  type ActorState,
  getActor,
  getMemories,
  hasCapability,
  isThreadOpen,
  type MemoryEntry,
  nextHop,
  openPetitionsFor,
  type PerceivedEvent,
  type PerceivedExit,
  type PerceptionSnapshot,
  type Petition,
  petitionBalanceOf,
  type RelationshipState,
  type WorldState,
} from "@panthea/world";
import type { ParseResult } from "./config";
import {
  describeContests,
  describeDigest,
  describeEnding,
  describePracticeInstructions,
  isEndingKind,
  NO_PRACTICE,
  PRAYERS_BUDGET_CHARS,
  type PracticeIntent,
  type PracticeOffer,
  type PracticeOptions,
  type PracticeRefusalView,
  parsePractice,
  practiceBy,
  practiceConditions,
  practiceOffer,
  practiceProperties,
  refusalView,
  type ThreadView,
  withStrikeLegality,
} from "./practices";
import type { IntentSchema, RouteContext } from "./router";

/** World actions a god intent can carry today. An ability naming any other action is not offered to the model yet. */
export const GOD_INTENT_ACTIONS = [
  "move",
  "realm-transition",
  "strike",
  "legend",
  "report",
  "bless",
  "practice",
  "wait",
] as const;
export type GodIntentAction = (typeof GOD_INTENT_ACTIONS)[number];

/** What a god decides to do. Targets are entity ids from the snapshot the intent was made from. */
export type GodIntent = GodAction & {
  /** A change to the god's own goal, alongside whatever it does. */
  readonly goal?: GoalChange;
};

type GodAction =
  | { readonly action: "move"; readonly to: EntityId }
  | { readonly action: "realm-transition"; readonly to: EntityId }
  | {
      readonly action: "strike";
      readonly target: EntityId;
      readonly power: number;
    }
  | {
      readonly action: "legend";
      readonly assertion: string;
      /** What the god asserts happened, in structure: its claim, shown ids only. */
      readonly claim?: Consequence;
      readonly linkedEventId?: EventId;
    }
  /**
   * Tell someone here what the god says happened. `claim` is its assertion of
   * who did what to whom and may be false; `linkedEventId` is an event the god
   * witnessed, cited as provenance only.
   */
  | {
      readonly action: "report";
      readonly listener: EntityId;
      readonly content: string;
      readonly claim?: Consequence;
      readonly linkedEventId?: EventId;
    }
  /** Bless the mortal behind one open help petition, standing with it. */
  | { readonly action: "bless"; readonly petition: EventId }
  /** One move in a practice thread with another god: a demand, or an answer to one. */
  | PracticeIntent
  /** Do nothing this turn. Always allowed; nothing is journaled. */
  | { readonly action: "wait" };

/**
 * A god intent that `godIntentSchema`'s parse produced: its action is one the
 * god can take, and its targets and strike power passed the snapshot's checks.
 * Nothing else can make one, so `buildModelProposal` cannot be handed an
 * intent that skipped them.
 */
export type ParsedGodIntent = Brand<GodIntent, "ParsedGodIntent">;

export const MAX_ASSERTION_LENGTH = 280;

/** Most memories a prompt shows: the most salient, so the 4K context bound holds however much a god remembers. */
export const MAX_REMEMBERED = 6;
/** Most feelings a prompt shows: the strongest. */
export const MAX_FEELINGS = 5;
/** Most of a god's own recent actions a prompt shows: the newest. */
export const MAX_OWN_ACTIONS = 5;
/** Most entries of a goal's history a prompt shows: the newest since the goal was set. */
export const MAX_GOAL_HISTORY = 4;
/** Most reports to one listener, or told memories from one teller, a prompt shows: the newest, so one repeated voice cannot crowd out what else the god did or heard. */
export const MAX_REPEATED_REPORTS = 2;
/** How many of a god's own newest authored events a turn reads: enough for the actions shown and for a goal's history to reach back past them. */
export const OWN_EVENT_WINDOW = 4 * MAX_OWN_ACTIONS;

/**
 * Whether `event` is an action `actor` took, as opposed to a cost, a belief,
 * a feeling, or something that happened to it: a move, a crossing, a report or
 * legend it told, or a strike (its ignition or damage). A fire that merely
 * spread from its strike is not. The service's bounded read of a god's own
 * events (apps/simulation) mirrors this, and a test holds the two together.
 */
export function authoredAction(event: WorldEvent, actor: EntityId): boolean {
  switch (event.kind) {
    case "entity-moved":
    case "realm-transitioned":
    case "report-told":
    case "legend-recorded":
      return event.entityId === actor;
    case "building-damaged":
      return event.actor === actor;
    case "building-ignited":
      return event.cause.kind === "strike" && event.cause.actor === actor;
    default:
      return false;
  }
}

/** One thing from a goal's history: something the god itself remembers, or did. */
export type GoalHistoryEntry =
  | {
      readonly kind: "memory";
      readonly sequence: number;
      readonly memory: MemoryEntry;
    }
  | {
      readonly kind: "action";
      readonly sequence: number;
      readonly event: WorldEvent;
    };

/** One place a petition names, with where it is and the first step toward it. */
export interface PetitionPlace {
  readonly id: EntityId;
  readonly name: string;
  /** The exit to take from where the god is, or `undefined` when it is already there or no route exists. */
  readonly hop?: {
    readonly id: EntityId;
    readonly name: string;
    /** The action that reaches it: a move within a realm, a realm-transition across one (the world refuses a plain move across realms). */
    readonly action: "move" | "realm-transition";
  };
  readonly here: boolean;
}

/** An open petition addressed to this god, resolved for the prompt: read from world state (the divine sense), whatever the god can perceive. */
export interface PetitionView {
  readonly id: EventId;
  readonly petitioner: EntityId;
  readonly request: Petition["request"];
  /** The cause in words: what happened to the petitioner. */
  readonly cause: string;
  /** Where each named person and building is, by place. */
  readonly whereabouts: readonly {
    readonly who: readonly EntityId[];
    readonly place: PetitionPlace;
  }[];
  /** Whether the petitioner stands with the god, so a bless is possible. */
  readonly petitionerHere: boolean;
  /** The terms the god could offer on this prayer, written out in the intent it would send; absent when the world would take none. */
  readonly offer?: Readonly<Record<string, unknown>>;
  /** The god set terms on this prayer and the mortal accepted: the boon is owed, and the prayer is no longer a favour to do freely. */
  readonly agreed?: true;
}

/** A refusal of the god's last goal change, as the prompt tells it. */
export interface RefusalView {
  readonly attempted: "replace" | "abandon";
  readonly reason: GoalChangeRefusedEvent["reason"];
  /** Ticks left on the lock now. */
  readonly ticksLeft: number;
}

/** What a god carries into a turn from its own memory and record: bounded, and nothing but what it holds or did. */
export interface Remembered {
  /** Oldest first. */
  readonly memories: readonly MemoryEntry[];
  readonly relationships: readonly RelationshipState[];
  /** The god's own newest authored actions, oldest first, at most `MAX_OWN_ACTIONS`. */
  readonly ownActions: readonly WorldEvent[];
  /** The god's active goal, if it has one. */
  readonly goal: ActiveGoal | undefined;
  /** What the god itself remembers or did involving the goal's target since it set the goal, oldest first, at most `MAX_GOAL_HISTORY`. */
  readonly goalHistory: readonly GoalHistoryEntry[];
  /**
   * The open petitions addressed to this god that its prompt shows, in the order it shows them: those a
   * live practice names first, then the newest, as many as `PRAYERS_BUDGET_CHARS` holds. The world keeps
   * the rest (none is lost); the schema and the parser name only these.
   */
  readonly petitions: readonly PetitionView[];
  /** How many open petitions the budget left out of `petitions`. */
  readonly morePrayers: number;
  /** Ticks a goal stays locked, when goals are gated; absent when they are not. */
  readonly goalLockTicks: number | undefined;
  /** Divinity a bless costs. */
  readonly blessCost: number;
  /** The god's latest goal-change refusal since it set its goal, if any. */
  readonly refusal: RefusalView | undefined;
  /** Every open practice thread the god is a party to, most urgent first (none is hidden): what the digest shows and a move on one pins. */
  readonly threads: readonly ThreadView[];
  /** What a practice term may name, and the causes a demand may rest on. */
  readonly practice: PracticeOptions;
  /** The god's last practice move the world refused, and why: what the digest says about it. */
  readonly practiceRefusal: PracticeRefusalView | undefined;
  /** Whose memory this is: what lets an ending read as "you refused" or "zeus refused". Absent for the empty memory. */
  readonly self: EntityId | undefined;
}

/** Whether `ids` name `target` or a building `target` owns. */
function eventInvolves(
  state: WorldState,
  event: WorldEvent,
  target: EntityId,
): boolean {
  const claimNames = (claim: Consequence | undefined) =>
    claim !== undefined && (claim.agent === target || claim.target === target);
  switch (event.kind) {
    case "entity-moved":
    case "realm-transitioned":
      return event.to === target;
    case "report-told":
      return event.listenerId === target || claimNames(event.claim);
    case "legend-recorded":
      return event.hearers.includes(target) || claimNames(event.claim);
    case "building-damaged":
    case "building-ignited":
      return (
        event.entityId === target ||
        state.buildings.get(event.entityId)?.owner === target
      );
    default:
      return false;
  }
}

function memoryInvolves(memory: MemoryEntry, target: EntityId): boolean {
  return (
    memory.subjects.includes(target) ||
    memory.consequence?.agent === target ||
    memory.consequence?.target === target ||
    (memory.kind === "told" && memory.teller === target)
  );
}

/**
 * The bounded slice of `actorId`'s memory and feelings a turn's prompt shows:
 * its `MAX_REMEMBERED` most salient memories (the newest among equals),
 * oldest first, and its `MAX_FEELINGS` strongest feelings.
 */
/** What one petition's cause was, in the god's words. */
/** How a god is told it may keep and change one goal. */
/** What one action may cite as `linkedEventId`, listed by action because a report cites only what the god saw and a legend only what is here now; and to omit it when there is nothing. */
function citationGuidance(
  action: "report" | "legend",
  ids: readonly EventId[],
): string {
  const unique = [...new Set(ids)];
  return unique.length > 0
    ? `For a ${action}, linkedEventId may be only one of: ${unique.join(", ")}; omit it to cite nothing.`
    : `For a ${action}, omit linkedEventId: ${action === "report" ? "you saw no event you can cite" : "no event here can be cited"}.`;
}

function goalInstruction(remembered: Remembered): string {
  const finite =
    "Set a goal you can finish or fail within a few turns: something concrete with its target that you could see happen.";
  const shape =
    'add "goal" to your reply, {"set": {"text": your aim in your own words, "target": one id you were shown}} and/or {"end": {"outcome": "achieved", "failed", or "abandoned"}}.';
  if (remembered.goalLockTicks === undefined) {
    return `You may keep one goal across turns: ${shape} ${finite} A new goal ends your old one. A goal change goes with any action in the same turn (a move, a strike, a bless, a report); it never needs a turn of its own.`;
  }
  return `You may keep one goal across turns: ${shape} ${finite} A goal holds: you may end it as achieved or failed any time, but you may replace or abandon it only after ${remembered.goalLockTicks} ticks, or once news of its target or a prayer to you gives you cause. A goal change goes with any action in the same turn; it never needs a turn of its own.`;
}

/** What prayers are and how a god may answer one; empty when none are addressed to it. */
function prayerInstructions(remembered: Remembered): string[] {
  if (remembered.petitions.length === 0) return [];
  return [
    `Mortals pray to you, and you hear them wherever you are. Answering a prayer is how you are worshipped: strike the offender's building (action "strike") where it stands, or, for a petitioner who is here, bless them (action "bless", naming the petition, at a cost of ${remembered.blessCost} divinity). If the petitioner or the building is elsewhere, move toward it first; each prayer below says the next step.`,
  ];
}

function describeCause(petition: Petition): string {
  // What the petitioner knew when it prayed, not what the world recorded: an offender it never learned stays unknown.
  const cause = petition.about;
  switch (cause.kind) {
    case "damage":
      return `${cause.building} was damaged${cause.offender === undefined ? "" : ` by ${cause.offender}`}`;
    case "fire":
      return `${cause.building} burned`;
    case "theft":
      return cause.offender === undefined
        ? `its ${cause.resource} was stolen`
        : `${cause.offender} stole ${cause.resource}`;
    case "spoilage":
      return `its ${cause.resource} spoiled`;
    case "need":
      return `it lacked ${cause.resource}`;
    case "grudge":
      return `it holds a grudge against ${cause.offender}`;
  }
}

/** A place as the god sees it: its name, whether the god is there, and the exit to take first. */
function placeFor(
  state: WorldState,
  god: ActorState,
  place: EntityId,
): PetitionPlace | undefined {
  const location = state.locations.get(place);
  if (!location) return undefined;
  if (god.locationId === place) {
    return { id: place, name: location.name, here: true };
  }
  const hop = nextHop(state, god.locationId, place, god.capabilities);
  const exit = hop === undefined ? undefined : state.locations.get(hop);
  const from = state.locations.get(god.locationId);
  return {
    id: place,
    name: location.name,
    here: false,
    ...(hop === undefined || !exit || !from
      ? {}
      : {
          hop: {
            id: hop,
            name: exit.name,
            action: exit.realm === from.realm ? "move" : "realm-transition",
          },
        }),
  };
}

function petitionView(
  state: WorldState,
  god: ActorState,
  petition: Petition,
): PetitionView {
  const request = petition.request;
  const named: EntityId[] =
    request.kind === "punish"
      ? [request.offender, ...request.buildings]
      : request.need.kind === "building"
        ? [request.need.building]
        : [];
  const whoByPlace = new Map<EntityId, EntityId[]>();
  const stand = (who: EntityId, at: EntityId | undefined) => {
    if (at === undefined) return;
    whoByPlace.set(at, [...(whoByPlace.get(at) ?? []), who]);
  };
  stand(petition.petitioner, getActor(state, petition.petitioner)?.locationId);
  for (const id of named) {
    stand(
      id,
      getActor(state, id)?.locationId ?? state.buildings.get(id)?.locationId,
    );
  }
  const whereabouts = [...whoByPlace].flatMap(([at, who]) => {
    const place = placeFor(state, god, at);
    return place === undefined ? [] : [{ who, place }];
  });
  return {
    id: petition.id,
    petitioner: petition.petitioner,
    request,
    cause: describeCause(petition),
    whereabouts,
    petitionerHere:
      getActor(state, petition.petitioner)?.locationId === god.locationId,
  };
}

/** `items` with at most `MAX_REPEATED_REPORTS` per key kept, the newest (the last in order); order is kept. */
function newestPerKey<T>(
  items: readonly T[],
  keyOf: (item: T) => string | undefined,
): T[] {
  const seen = new Map<string, number>();
  const kept: T[] = [];
  for (const item of [...items].reverse()) {
    const key = keyOf(item);
    if (key !== undefined) {
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count > MAX_REPEATED_REPORTS) continue;
    }
    kept.push(item);
  }
  return kept.reverse();
}

export function rememberedBy(
  state: WorldState,
  actorId: EntityId,
  ownEvents: readonly WorldEvent[] = [],
  refusal?: GoalChangeRefusedEvent,
  practiceRefusal?: PracticeRefusedEvent,
): Remembered {
  const own = ownEvents
    .filter((event) => authoredAction(event, actorId))
    .sort((a, b) => a.sequence - b.sequence);
  const goal = state.goals.get(actorId);
  const goalHistory: GoalHistoryEntry[] = [];
  if (goal !== undefined) {
    for (const memory of getMemories(state, actorId)) {
      if (
        memory.recordedAt > goal.sequence &&
        memoryInvolves(memory, goal.target)
      ) {
        goalHistory.push({
          kind: "memory",
          sequence: memory.recordedAt,
          memory,
        });
      }
    }
    for (const event of own) {
      if (
        event.sequence > goal.sequence &&
        eventInvolves(state, event, goal.target)
      ) {
        goalHistory.push({ kind: "action", sequence: event.sequence, event });
      }
    }
    goalHistory.sort((a, b) => a.sequence - b.sequence);
  }
  const memories = newestPerKey(
    [...getMemories(state, actorId)].sort(
      (a, b) => a.recordedAt - b.recordedAt,
    ),
    (memory) => (memory.kind === "told" ? memory.teller : undefined),
  )
    .sort((a, b) => b.salience - a.salience || b.recordedAt - a.recordedAt)
    .slice(0, MAX_REMEMBERED)
    .sort((a, b) => a.recordedAt - b.recordedAt);
  const strength = (r: RelationshipState) => Math.abs(r.affinity) + r.grudge;
  const relationships = [...state.relationships.values()]
    .filter((r) => r.from === actorId)
    .sort((a, b) => strength(b) - strength(a) || (a.toward < b.toward ? -1 : 1))
    .slice(0, MAX_FEELINGS);
  const self = getActor(state, actorId);
  // Only the god's own refusal is told to it: another's is never read into its prompt.
  const refused =
    practiceRefusal === undefined || practiceRefusal.entityId !== actorId
      ? undefined
      : refusalView(practiceRefusal);
  const open = self?.isDeity ? openPetitionsFor(state, actorId) : [];
  const views = open.map((petition) =>
    petitionView(state, self as ActorState, petition),
  );
  // Sizing needs each prayer's choices, which the world's terms decide: ask with every prayer first.
  const everything = practiceBy(
    state,
    actorId,
    memories,
    views.map((petition) => petition.petitioner),
    refused,
  );
  const withOffers = views.map((petition) =>
    everything.options.offerTerms[petition.id] === undefined
      ? petition
      : { ...petition, offer: everything.options.offerTerms[petition.id] },
  );
  const { shown, more } = choosePrayers(state, actorId, open, withOffers);
  // When some prayers are left out, ask again with only the shown ones, so what may be offered, named as a party, or opened with is what the god can see.
  const { threads, options } =
    more === 0
      ? everything
      : practiceBy(
          state,
          actorId,
          memories,
          shown.map((petition) => petition.petitioner),
          refused,
          new Set(shown.map((petition) => petition.id)),
        );
  const prayers = shown.map((petition) => {
    const agreed = threads.some(
      (view) => view.owedBoon?.petition === petition.id,
    );
    const offer = options.offerTerms[petition.id];
    return {
      ...petition,
      ...(offer === undefined ? {} : { offer }),
      ...(agreed ? { agreed: true as const } : {}),
    };
  });
  const lock =
    state.rules.petitionBalance === undefined
      ? undefined
      : petitionBalanceOf(state.rules, "goalLockTicks");
  return {
    memories,
    relationships,
    ownActions: newestPerKey(own, (event) =>
      event.kind === "report-told" ? event.listenerId : undefined,
    ).slice(-MAX_OWN_ACTIONS),
    goal,
    goalHistory: goalHistory.slice(-MAX_GOAL_HISTORY),
    petitions: prayers,
    morePrayers: more,
    goalLockTicks: lock,
    blessCost: petitionBalanceOf(state.rules, "blessDivinityCost"),
    refusal:
      refusal !== undefined &&
      goal !== undefined &&
      refusal.sequence > goal.sequence
        ? {
            attempted: refusal.attempted,
            reason: refusal.reason,
            ticksLeft: Math.max(
              0,
              refusal.unlocksInTicks - (state.tick - refusal.tick),
            ),
          }
        : undefined,
    threads,
    practice: options,
    practiceRefusal: refused,
    self: actorId,
  };
}

export const NOTHING_REMEMBERED: Remembered = {
  memories: [],
  relationships: [],
  ownActions: [],
  goal: undefined,
  goalHistory: [],
  petitions: [],
  morePrayers: 0,
  goalLockTicks: undefined,
  blessCost: 0,
  refusal: undefined,
  threads: [],
  practice: NO_PRACTICE,
  practiceRefusal: undefined,
  self: undefined,
};

/**
 * The ids a god has been shown this turn, which are the only ones a goal may
 * name as its target: the scene (who and what is here, the ways out, the place
 * itself) plus the ids in the memories and feelings its prompt shows, and its
 * goal's own target. Never the god itself.
 */
export function shownIds(
  snapshot: PerceptionSnapshot,
  remembered: Remembered,
): readonly EntityId[] {
  const ids = new Set<EntityId>([
    ...snapshot.actors.map((actor) => actor.id),
    ...snapshot.buildings.map((building) => building.id),
    ...snapshot.exits.map((exit) => exit.to),
    snapshot.location.id,
  ]);
  for (const memory of remembered.memories) {
    for (const subject of memory.subjects) ids.add(subject);
    if (memory.consequence !== undefined) {
      ids.add(memory.consequence.agent);
      if (memory.consequence.target !== undefined) {
        ids.add(memory.consequence.target);
      }
    }
    if (memory.kind === "told") ids.add(memory.teller);
  }
  for (const relationship of remembered.relationships) {
    ids.add(relationship.toward);
  }
  if (remembered.goal !== undefined) ids.add(remembered.goal.target);
  for (const petition of remembered.petitions) {
    ids.add(petition.petitioner);
    if (petition.request.kind === "punish") {
      ids.add(petition.request.offender);
      for (const building of petition.request.buildings) ids.add(building);
    } else if (petition.request.need.kind === "building") {
      ids.add(petition.request.need.building);
    }
  }
  ids.delete(snapshot.self.id);
  return [...ids];
}

function isGodIntentAction(action: string): action is GodIntentAction {
  return (GOD_INTENT_ACTIONS as readonly string[]).includes(action);
}

/** The first ability the profile grants for `action`. */
function abilityFor(
  profile: GodProfile,
  action: GodIntentAction,
): GodAbility | undefined {
  return profile.abilities.find((ability) => ability.action === action);
}

/** Exits the god can actually take: the world refuses a move or transition to a place whose required capability the actor lacks (`hasCapability`, the rule validate.ts applies). */
function usableExits(snapshot: PerceptionSnapshot): readonly PerceivedExit[] {
  return snapshot.exits.filter((exit) =>
    hasCapability(snapshot.self.capabilities, exit.requiredCapability),
  );
}

/** Destinations of an ordinary move: usable exits within the observer's own realm. */
function moveTargets(snapshot: PerceptionSnapshot): readonly EntityId[] {
  return usableExits(snapshot)
    .filter((exit) => exit.realm === snapshot.location.realm)
    .map((exit) => exit.to);
}

/** Destinations of a realm transition: exits over a transport that lead to another realm. */
function transitionTargets(snapshot: PerceptionSnapshot): readonly EntityId[] {
  return usableExits(snapshot)
    .filter(
      (exit) =>
        exit.transport !== "path" && exit.realm !== snapshot.location.realm,
    )
    .map((exit) => exit.to);
}

/** The most power a strike can carry: the ability's authored power, and never more than the divinity held. `0` means a strike is not possible. */
function strikePowerCap(
  ability: GodAbility | undefined,
  snapshot: PerceptionSnapshot,
): number {
  if (!ability) return 0;
  const authored = ability.parameters?.power ?? snapshot.self.divinity;
  return Math.floor(Math.min(authored, snapshot.self.divinity));
}

/** Everything one intent action needs to be offered: what its target fields may hold. */
interface Offer {
  readonly moves: readonly EntityId[];
  readonly transitions: readonly EntityId[];
  readonly strikeTargets: readonly EntityId[];
  readonly strikeCap: number;
  readonly canLegend: boolean;
  readonly eventIds: readonly EventId[];
  /** Who is here to hear a report; a report is offered only when someone is. */
  readonly listeners: readonly EntityId[];
  /** Ids a claim may name as its agent, and as its target: the god and what it perceives. */
  readonly claimAgents: readonly EntityId[];
  readonly claimTargets: readonly EntityId[];
  /** Events the god remembers witnessing, the only ones a report may cite. */
  readonly witnessedEventIds: readonly EventId[];
  /** Whether the god has a goal it could end. */
  readonly hasGoal: boolean;
  /** The ids a new goal may name as its target (`shownIds`). */
  readonly goalTargets: readonly EntityId[];
  /** Open help petitions whose petitioner stands here and whose bless the god can pay for. */
  readonly blessPetitions: readonly EventId[];
  /** What a practice move may name, when the god has a move to make or a cause to demand over. */
  readonly practice: PracticeOffer | undefined;
}

/** Help petitions whose petitioner is here, the one thing a bless can answer. */
function blessablePetitions(
  snapshot: PerceptionSnapshot,
  remembered: Remembered,
): readonly EventId[] {
  const divinity =
    snapshot.self.inventory.find((item) => item.resource === "divinity")
      ?.amount ?? 0;
  if (divinity < remembered.blessCost) return [];
  return remembered.petitions
    .filter(
      (petition) =>
        petition.request.kind === "help" &&
        petition.petitionerHere &&
        snapshot.actors.some((actor) => actor.id === petition.petitioner),
    )
    .map((petition) => petition.id);
}

function offerFor(
  profile: GodProfile,
  snapshot: PerceptionSnapshot,
  remembered: Remembered,
): Offer {
  const listeners = snapshot.actors.map((actor) => actor.id);
  const strikeCap = strikePowerCap(abilityFor(profile, "strike"), snapshot);
  const strikeTargets =
    strikeCap >= 1 ? snapshot.buildings.map((building) => building.id) : [];
  return {
    moves: moveTargets(snapshot),
    transitions: transitionTargets(snapshot),
    strikeTargets,
    strikeCap: strikeTargets.length > 0 ? strikeCap : 0,
    canLegend: abilityFor(profile, "legend") !== undefined,
    eventIds: snapshot.events.map((event) => event.id),
    listeners,
    claimAgents: [snapshot.self.id, ...listeners],
    claimTargets: [
      snapshot.self.id,
      ...listeners,
      ...snapshot.buildings.map((building) => building.id),
    ],
    witnessedEventIds: remembered.memories.flatMap((memory) =>
      memory.kind === "witnessed" ? [memory.sourceEventId] : [],
    ),
    hasGoal: remembered.goal !== undefined,
    goalTargets: shownIds(snapshot, remembered),
    blessPetitions: blessablePetitions(snapshot, remembered),
    practice: practiceOffer(
      snapshot.self.id,
      remembered.threads,
      remembered.practice,
      snapshot.actors.filter((a) => !a.isDeity).map((a) => a.id),
    ),
  };
}

function availableActions(offer: Offer): readonly GodIntentAction[] {
  const actions: GodIntentAction[] = [];
  if (offer.moves.length > 0) actions.push("move");
  if (offer.transitions.length > 0) actions.push("realm-transition");
  if (offer.strikeCap >= 1) actions.push("strike");
  if (offer.canLegend) actions.push("legend");
  if (offer.listeners.length > 0) actions.push("report");
  if (offer.blessPetitions.length > 0) actions.push("bless");
  if (offer.practice !== undefined) actions.push("practice");
  actions.push("wait");
  return actions;
}

/**
 * The actions this god can take right now: its movement options and the
 * abilities it can afford, given what it perceives, and waiting, which is
 * always available. Ordered movement first, then the profile's abilities,
 * then waiting.
 */
export function godAvailableActions(
  profile: GodProfile,
  snapshot: PerceptionSnapshot,
  remembered: Remembered = NOTHING_REMEMBERED,
): readonly GodIntentAction[] {
  const offered = new Set(
    availableActions(offerFor(profile, snapshot, remembered)),
  );
  const order = [
    "move",
    "realm-transition",
    ...profile.abilities.map((ability) => ability.action),
    "report",
    "bless",
    "practice",
    "wait",
  ];
  return [...new Set(order)].filter(
    (action): action is GodIntentAction =>
      isGodIntentAction(action) && offered.has(action),
  );
}

function invalid(path: string, message: string): ParseResult<never> {
  return { ok: false, path, message };
}

function parseMember<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  what: string,
): ParseResult<T> {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    return invalid(
      path,
      `${what} must be one of the ids you can see: ${allowed.join(", ") || "(none)"}`,
    );
  }
  return { ok: true, value: value as T };
}

/** The intent's action with its optional goal change: both must parse. */
function parseIntent(
  offer: Offer,
  actions: readonly GodIntentAction[],
  candidate: unknown,
): ParseResult<GodIntent> {
  const parsed = parseAction(offer, actions, candidate);
  if (!parsed.ok) return parsed;
  const raw = (candidate as Record<string, unknown>).goal;
  if (raw === undefined || raw === null) return parsed;
  const goal = parseGoalChange(offer, raw);
  if (!goal.ok) return goal;
  return { ok: true, value: { ...parsed.value, goal: goal.value } };
}

function parseGoalChange(offer: Offer, raw: unknown): ParseResult<GoalChange> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return invalid("goal", "goal must be an object");
  }
  const fields = raw as Record<string, unknown>;
  let end: GoalChange["end"];
  if (fields.end !== undefined && fields.end !== null) {
    if (!offer.hasGoal) {
      return invalid("goal.end", "you have no goal to end");
    }
    const outcome = (fields.end as Record<string, unknown>)?.outcome;
    const parsed = parseMember(
      outcome,
      "goal.end.outcome",
      GOAL_OUTCOMES,
      "outcome",
    );
    if (!parsed.ok) return parsed;
    end = { outcome: parsed.value };
  }
  let set: GoalChange["set"];
  if (fields.set !== undefined && fields.set !== null) {
    const record = fields.set as Record<string, unknown>;
    const text = record?.text;
    if (
      typeof text !== "string" ||
      text.trim() === "" ||
      text.length > MAX_GOAL_LENGTH
    ) {
      return invalid(
        "goal.set.text",
        `text must be 1 to ${MAX_GOAL_LENGTH} characters`,
      );
    }
    const target = parseMember(
      record.target,
      "goal.set.target",
      offer.goalTargets,
      "target",
    );
    if (!target.ok) return target;
    set = { text, target: target.value as EntityId };
  }
  if (end === undefined && set === undefined) {
    return invalid("goal", "a goal change needs an end, a set, or both");
  }
  return {
    ok: true,
    value: {
      ...(end === undefined ? {} : { end }),
      ...(set === undefined ? {} : { set }),
    },
  };
}

function parseAction(
  offer: Offer,
  actions: readonly GodIntentAction[],
  candidate: unknown,
): ParseResult<GodIntent> {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return invalid("", "expected a JSON object");
  }
  const fields = candidate as Record<string, unknown>;
  const action = parseMember(fields.action, "action", actions, "action");
  if (!action.ok) return action;

  switch (action.value) {
    case "move":
    case "realm-transition": {
      // The schema offers one list of destinations, so the destination, not the
      // word the model paired with it, says which it is: a step within the
      // realm, or a crossing. The world still validates the proposal either way.
      const to = parseMember(
        fields.to,
        "to",
        [...new Set([...offer.moves, ...offer.transitions])],
        "to",
      );
      if (!to.ok) return to;
      const destination = to.value as EntityId;
      const crossing = offer.transitions.includes(destination);
      return {
        ok: true,
        value: {
          action: crossing ? "realm-transition" : "move",
          to: destination,
        },
      };
    }
    case "strike": {
      const target = parseMember(
        fields.target,
        "target",
        offer.strikeTargets,
        "target",
      );
      if (!target.ok) return target;
      const power = fields.power;
      if (
        typeof power !== "number" ||
        !Number.isInteger(power) ||
        power < 1 ||
        power > offer.strikeCap
      ) {
        return invalid(
          "power",
          `power must be a whole number from 1 to ${offer.strikeCap}`,
        );
      }
      return {
        ok: true,
        value: { action: "strike", target: target.value as EntityId, power },
      };
    }
    case "legend": {
      const assertion = fields.assertion;
      if (
        typeof assertion !== "string" ||
        assertion.trim() === "" ||
        assertion.length > MAX_ASSERTION_LENGTH
      ) {
        return invalid(
          "assertion",
          `assertion must be 1 to ${MAX_ASSERTION_LENGTH} characters`,
        );
      }
      const claim = parseClaim(offer, fields.claim);
      if (!claim.ok) return claim;
      const claimed = claim.value === undefined ? {} : { claim: claim.value };
      const linked = fields.linkedEventId;
      if (linked === undefined || linked === null) {
        return {
          ok: true,
          value: { action: "legend", assertion, ...claimed },
        };
      }
      const linkedEventId = parseMember(
        linked,
        "linkedEventId",
        offer.eventIds,
        "linkedEventId",
      );
      return linkedEventId.ok
        ? {
            ok: true,
            value: {
              action: "legend",
              assertion,
              ...claimed,
              linkedEventId: linkedEventId.value,
            },
          }
        : linkedEventId;
    }
    case "report":
      return parseReport(offer, fields);
    case "bless": {
      const petition = parseMember(
        fields.petition,
        "petition",
        offer.blessPetitions,
        "petition",
      );
      return petition.ok
        ? {
            ok: true,
            value: { action: "bless", petition: petition.value as EventId },
          }
        : petition;
    }
    case "practice": {
      if (offer.practice === undefined) {
        return invalid("action", "you have no practice move to make");
      }
      return parsePractice(offer.practice, fields);
    }
    case "wait":
      return { ok: true, value: { action: "wait" } };
  }
}

function parseReport(
  offer: Offer,
  fields: Record<string, unknown>,
): ParseResult<GodIntent> {
  const listener = parseMember(
    fields.listener,
    "listener",
    offer.listeners,
    "listener",
  );
  if (!listener.ok) return listener;
  const content = fields.content;
  if (
    typeof content !== "string" ||
    content.trim() === "" ||
    content.length > MAX_REPORT_LENGTH
  ) {
    return invalid(
      "content",
      `content must be 1 to ${MAX_REPORT_LENGTH} characters`,
    );
  }
  const claim = parseClaim(offer, fields.claim);
  if (!claim.ok) return claim;
  let linkedEventId: EventId | undefined;
  if (fields.linkedEventId !== undefined && fields.linkedEventId !== null) {
    const cited = parseMember(
      fields.linkedEventId,
      "linkedEventId",
      offer.witnessedEventIds,
      "linkedEventId",
    );
    if (!cited.ok) return cited;
    linkedEventId = cited.value;
  }
  return {
    ok: true,
    value: {
      action: "report",
      listener: listener.value as EntityId,
      content,
      ...(claim.value === undefined ? {} : { claim: claim.value }),
      ...(linkedEventId === undefined ? {} : { linkedEventId }),
    },
  };
}

const CLAIM_EFFECTS = ["harm", "kindness"] as const;

function parseClaim(
  offer: Offer,
  raw: unknown,
): ParseResult<Consequence | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("claim", "claim must be an object");
  }
  const claim = raw as Record<string, unknown>;
  const effect = parseMember(
    claim.effect,
    "claim.effect",
    CLAIM_EFFECTS,
    "effect",
  );
  if (!effect.ok) return effect;
  const agent = parseMember(
    claim.agent,
    "claim.agent",
    offer.claimAgents,
    "agent",
  );
  if (!agent.ok) return agent;
  if (claim.target === undefined || claim.target === null) {
    return {
      ok: true,
      value: { effect: effect.value, agent: agent.value as EntityId },
    };
  }
  const target = parseMember(
    claim.target,
    "claim.target",
    offer.claimTargets,
    "target",
  );
  if (!target.ok) return target;
  return {
    ok: true,
    value: {
      effect: effect.value,
      agent: agent.value as EntityId,
      target: target.value as EntityId,
    },
  };
}

/**
 * The intent schema for one god's turn: the JSON Schema that steers the model
 * (targets as enums of ids in the snapshot, strike power bounded by the
 * ability and the divinity held) and the parser that enforces the same.
 */
export function godIntentSchema(
  profile: GodProfile,
  snapshot: PerceptionSnapshot,
  remembered: Remembered = NOTHING_REMEMBERED,
): IntentSchema<ParsedGodIntent> {
  const offer = offerFor(profile, snapshot, remembered);
  const actions = godAvailableActions(profile, snapshot, remembered);

  const properties: Record<string, unknown> = {
    action: { type: "string", enum: [...actions] },
  };
  const to = [...new Set([...offer.moves, ...offer.transitions])];
  if (to.length > 0) {
    properties.to = {
      type: "string",
      enum: to,
      description:
        'Where to go: one of your ways out, for the action "move" or "realm-transition" (name it here, not in "target").',
    };
  }
  if (offer.strikeCap >= 1) {
    properties.target = {
      type: "string",
      enum: [...offer.strikeTargets],
      description:
        'The building a strike hits: for the action "strike" only, never a place to go.',
    };
    properties.power = {
      type: "integer",
      minimum: 1,
      maximum: offer.strikeCap,
    };
  }
  if (offer.canLegend) {
    properties.assertion = {
      type: "string",
      minLength: 1,
      maxLength: MAX_ASSERTION_LENGTH,
    };
  }
  if (offer.listeners.length > 0) {
    properties.listener = { type: "string", enum: [...offer.listeners] };
    properties.content = {
      type: "string",
      minLength: 1,
      maxLength: MAX_REPORT_LENGTH,
    };
  }
  if (offer.listeners.length > 0 || offer.canLegend) {
    properties.claim = {
      type: "object",
      properties: {
        effect: { type: "string", enum: [...CLAIM_EFFECTS] },
        agent: { type: "string", enum: [...offer.claimAgents] },
        target: { type: "string", enum: [...offer.claimTargets] },
      },
      required: ["effect", "agent"],
      additionalProperties: false,
    };
  }
  if (offer.blessPetitions.length > 0) {
    properties.petition = { type: "string", enum: [...offer.blessPetitions] };
  }
  const conditions =
    offer.practice === undefined ? [] : practiceConditions(offer.practice);
  if (offer.practice !== undefined) {
    Object.assign(properties, practiceProperties(offer.practice));
  }
  properties.goal = {
    type: "object",
    properties: {
      set: {
        type: "object",
        properties: {
          text: { type: "string", minLength: 1, maxLength: MAX_GOAL_LENGTH },
          target: { type: "string", enum: [...offer.goalTargets] },
        },
        required: ["text", "target"],
        additionalProperties: false,
      },
      ...(offer.hasGoal
        ? {
            end: {
              type: "object",
              properties: {
                outcome: { type: "string", enum: [...GOAL_OUTCOMES] },
              },
              required: ["outcome"],
              additionalProperties: false,
            },
          }
        : {}),
    },
    additionalProperties: false,
  };
  const citable = [...new Set([...offer.eventIds, ...offer.witnessedEventIds])];
  if ((offer.canLegend || offer.listeners.length > 0) && citable.length > 0) {
    // One flat list, the union: the schema stays small on the 4K context. Which ids an action may cite is told in the instructions (`citationGuidance`) and enforced by the parser.
    properties.linkedEventId = {
      type: "string",
      enum: citable,
      description:
        "Cite only an id the instructions list for your action (report or legend); omit it when none is listed.",
    };
  }

  return {
    jsonSchema: {
      type: "object",
      properties,
      required: ["action"],
      // Conditions are flat and only present when a practice is on offer; see `practiceConditions`.
      ...(conditions.length === 0 ? {} : { allOf: conditions }),
      additionalProperties: false,
    },
    // The one place an intent is branded: only a candidate that passed every
    // check above becomes a ParsedGodIntent.
    parse: (candidate) => {
      const parsed = parseIntent(offer, actions, candidate);
      return parsed.ok
        ? { ok: true, value: parsed.value as ParsedGodIntent }
        : parsed;
    },
  };
}

// --- The prompt ------------------------------------------------------------------

function describeEvent(event: PerceivedEvent): string {
  const subjects = event.subjects.join(", ");
  const detail = event.assertion === undefined ? "" : `: "${event.assertion}"`;
  return `- [${event.id}] ${event.kind} (${subjects})${detail}`;
}

const EFFECT_WORDS = {
  harm: "harmed",
  kindness: "was kind to",
} as const;

function describeConsequence(consequence: Consequence | undefined): string {
  if (consequence === undefined) return "";
  return `${consequence.agent} ${EFFECT_WORDS[consequence.effect]} ${consequence.target ?? "someone"}`;
}

function describeMemory(memory: MemoryEntry, self?: EntityId): string {
  const what = describeConsequence(memory.consequence);
  if (memory.kind === "witnessed" && isEndingKind(memory.eventKind)) {
    // A thread's ending is remembered by its parties though no one stood at it: how it ended, and who decided it.
    return `- ${describeEnding(memory, self)} [${memory.sourceEventId}]`;
  }
  if (memory.kind === "witnessed") {
    return `- You saw [${memory.sourceEventId}] ${memory.eventKind} (${memory.subjects.join(", ")})${what === "" ? "" : `: ${what}`}`;
  }
  if (memory.kind === "noticed") {
    return `- You noticed a loss (${memory.subjects.join(", ")}), caused by [${memory.causeEventId}]`;
  }
  if (memory.kind === "sign") {
    // A god's own memory is never a sign (signs go to mortals), but the type allows it.
    return `- ${memory.god} ${memory.outcome === "answered" ? "answered" : "did not answer"} a petition`;
  }
  return `- ${memory.teller} told you: "${memory.content}"${what === "" ? "" : ` (claiming ${what})`}`;
}

/** The memory and feelings sections of a prompt; empty when the god remembers nothing. */
function describeRemembered(remembered: Remembered): string[] {
  const lines: string[] = [];
  if (remembered.memories.length > 0) {
    lines.push(
      "You remember:",
      ...remembered.memories.map((memory) =>
        describeMemory(memory, remembered.self),
      ),
    );
  }
  if (remembered.relationships.length > 0) {
    lines.push(
      "How you feel now:",
      ...remembered.relationships.map(
        (r) =>
          `- ${r.toward}: affinity ${r.affinity}${r.grudge > 0 ? `, grudge ${r.grudge}` : ""}${r.allied ? ", allied" : ""}`,
      ),
    );
  }
  return lines;
}

function claimClause(claim: Consequence | undefined): string {
  return claim === undefined ? "" : ` (claiming ${describeConsequence(claim)})`;
}

/** One of the god's own committed actions, in its own terms: what it did, said, and claimed. */
function describeOwnAction(event: WorldEvent): string {
  switch (event.kind) {
    case "entity-moved":
      return `you moved to ${event.to}`;
    case "realm-transitioned":
      return `you crossed to ${event.to}`;
    case "report-told":
      return `you told ${event.listenerId}: "${event.content}"${claimClause(event.claim)}`;
    case "legend-recorded":
      return `you told everyone present: "${event.assertion}"${claimClause(event.claim)} (${event.hearers.length === 0 ? "no one was there" : `heard by ${event.hearers.join(", ")}`})`;
    case "building-damaged":
      return `you struck ${event.entityId}`;
    case "building-ignited":
      return `you struck ${event.entityId}, setting it alight`;
    default:
      return event.kind;
  }
}

function describeHistoryEntry(
  entry: GoalHistoryEntry,
  self?: EntityId,
): string {
  return entry.kind === "memory"
    ? describeMemory(entry.memory, self)
    : `- ${describeOwnAction(entry.event)}`;
}

/** Whether `target` is in the scene the god perceives now. */
function targetIsHere(snapshot: PerceptionSnapshot, target: EntityId): boolean {
  return (
    snapshot.location.id === target ||
    snapshot.actors.some((actor) => actor.id === target) ||
    snapshot.buildings.some((building) => building.id === target)
  );
}

/**
 * The ways a god may answer a prayer, as a choice and not a command: help (or
 * punish) freely, where the way there is said only for one who chooses it; set
 * terms, written out in full when the world would take them; or let it be.
 * Every action is written out as the object to send, since a model copies what
 * it is shown whole and leaves out fields it is only told about.
 */
function answerGuidance(petition: PetitionView): string[] {
  const { request } = petition;
  const send = (intent: Record<string, unknown>) => JSON.stringify(intent);
  if (petition.agreed) {
    return [
      `  You agreed terms on this prayer, and ${petition.petitioner} accepted them: you owe the boon (the row for it is under "Your open practices").`,
    ];
  }
  const terms =
    petition.offer === undefined
      ? []
      : [
          `  - set terms (your boon for an offering, to be judged by the world): ${send(petition.offer)}`,
        ];
  const letBe = "  - or let it be: waiting is always allowed.";
  const free = (lines: readonly string[]) => [
    "  Your choices:",
    ...lines,
    ...terms,
    letBe,
  ];
  if (request.kind === "help") {
    const bless = { action: "bless", petition: petition.id };
    if (petition.petitionerHere) {
      return free([
        `  - help freely: ${petition.petitioner} is here: ${send(bless)}`,
      ]);
    }
    const hop = petition.whereabouts.find((entry) =>
      entry.who.includes(petition.petitioner),
    )?.place.hop;
    return free(
      hop === undefined
        ? []
        : [
            `  - help freely: ${petition.petitioner} is not here; if you choose this, go toward them ${send({ action: hop.action, to: hop.id })} (${hop.name}) turn by turn until you are with them, then bless them ${send(bless)}.`,
          ],
    );
  }
  const buildings = request.buildings;
  const here = petition.whereabouts.find(
    (entry) =>
      entry.place.here && entry.who.some((id) => buildings.includes(id)),
  );
  const target = (entry: { who: readonly EntityId[] }) =>
    entry.who.find((id) => buildings.includes(id));
  if (here !== undefined) {
    return free([
      `  - punish freely: ${target(here)} is here: ${send({ action: "strike", target: target(here) })} (with a power, from 1 to your limit).`,
    ]);
  }
  const away = petition.whereabouts.find(
    (entry) => entry.place.hop !== undefined && target(entry) !== undefined,
  );
  const hop = away?.place.hop;
  return free(
    away === undefined || hop === undefined
      ? []
      : [
          `  - punish freely: if you choose this, go toward ${away.place.name} ${send({ action: hop.action, to: hop.id })} (${hop.name}) turn by turn until you are there, then strike ${target(away)}.`,
        ],
  );
}

/** The heading of the prayers section: the one place the divine sense delivers petitions, found by it (with the indented and dashed lines under it) wherever a prompt is checked for another god's prayers. */
export const PRAYERS_HEADING = "Prayers to you:";

/** The lines one prayer takes in the prompt: who asked, for what, about what, where each place is from here, and the ways to answer. */
function describePrayer(petition: PetitionView): string[] {
  const request = petition.request;
  const ask =
    request.kind === "punish"
      ? `asks you to punish ${request.offender}, who owns ${request.buildings.join(", ")}`
      : request.need.kind === "building"
        ? `asks for help with ${request.need.building}`
        : `asks for help with ${request.need.resource}`;
  const lines = [
    `- [${petition.id}] ${petition.petitioner} ${ask} (${petition.cause}).`,
  ];
  for (const { who, place } of petition.whereabouts) {
    lines.push(
      `  ${who.join(", ")} at ${place.name} [${place.id}]${
        place.here
          ? " (here)"
          : place.hop === undefined
            ? ": no way there"
            : `: take ${place.hop.name} [${place.hop.id}] toward ${place.name} (action "${place.hop.action}", to "${place.hop.id}")`
      }.`,
    );
  }
  lines.push(...answerGuidance(petition));
  return lines;
}

/** The one line that stands for the prayers the budget left out. */
const morePrayersLine = (count: number) =>
  `- and ${count} more prayers to you.`;

/**
 * Which prayers the prompt shows. Prayers a live practice names (an open offer, or an accepted term
 * that names the prayer) come first and are never cut. After them the newest: a prayer just made is
 * one whose petitioner is still in the need it prayed about, and the oldest open ones are those
 * most likely to have been met by other means or to lapse unanswered; it is also the order the
 * opening that offers terms picks in. Each is kept while the section (heading and the closing line
 * included) stays within `PRAYERS_BUDGET_CHARS`; the first that does not fit ends the list, so
 * nothing older than a hidden prayer is shown. At least one prayer is always shown.
 */
function choosePrayers(
  state: WorldState,
  actorId: EntityId,
  open: readonly Petition[],
  views: readonly PetitionView[],
): { shown: PetitionView[]; more: number } {
  const live = new Set<EventId>();
  for (const thread of state.threads.values()) {
    if (
      thread.petition !== undefined &&
      isThreadOpen(thread) &&
      (thread.demander === actorId || thread.obligated === actorId)
    ) {
      live.add(thread.petition);
    }
  }
  const sequence = new Map(open.map((p) => [p.id, p.sequence]));
  const newest = (a: PetitionView, b: PetitionView) =>
    (sequence.get(b.id) ?? 0) - (sequence.get(a.id) ?? 0) ||
    (a.id < b.id ? -1 : 1);
  const ordered = [
    ...views.filter((view) => live.has(view.id)).sort(newest),
    ...views.filter((view) => !live.has(view.id)).sort(newest),
  ];
  const size = (view: PetitionView) =>
    describePrayer(view).reduce((sum, line) => sum + line.length + 1, 0);
  let used = PRAYERS_HEADING.length + 1;
  const reserve = morePrayersLine(ordered.length).length + 1;
  const shown: PetitionView[] = [];
  for (const view of ordered) {
    const cost = size(view);
    const must = live.has(view.id) || shown.length === 0;
    if (!must && used + cost + reserve > PRAYERS_BUDGET_CHARS) break;
    shown.push(view);
    used += cost;
  }
  return { shown, more: ordered.length - shown.length };
}

/** The prayers addressed to the god that its prompt shows, and a line for those it does not. */
function describePetitions(remembered: Remembered): string[] {
  if (remembered.petitions.length === 0) return [];
  const lines = [PRAYERS_HEADING];
  for (const petition of remembered.petitions) {
    lines.push(...describePrayer(petition));
  }
  if (remembered.morePrayers > 0) {
    lines.push(morePrayersLine(remembered.morePrayers));
  }
  return lines;
}

/** The god's own recent actions, and its goal with what has happened with its target since. */
function describeSelf(
  snapshot: PerceptionSnapshot,
  remembered: Remembered,
): string[] {
  const lines: string[] = [];
  if (remembered.ownActions.length > 0) {
    lines.push(
      "What you did recently:",
      ...remembered.ownActions.map((event) => `- ${describeOwnAction(event)}`),
    );
  }
  const { goal } = remembered;
  if (goal === undefined) {
    lines.push("You have no goal. You may set one.");
  } else {
    if (remembered.refusal !== undefined) {
      const { attempted, reason, ticksLeft } = remembered.refusal;
      lines.push(
        `You tried to ${attempted} your goal and were refused: it is ${reason}${ticksLeft > 0 ? ` for ${ticksLeft} more ticks` : ""}, and nothing has given you cause to change it.`,
      );
    }
    lines.push(
      `Your goal: "${goal.text}" (target ${goal.target}, ${targetIsHere(snapshot, goal.target) ? "here" : "not here"}).`,
    );
    lines.push("Judge it now: if it is achieved or failed, end it this turn.");
    if (remembered.goalHistory.length > 0) {
      lines.push(
        "Since you set it:",
        ...remembered.goalHistory.map((entry) =>
          describeHistoryEntry(entry, remembered.self),
        ),
      );
    }
  }
  return lines;
}

function describeAbility(
  ability: GodAbility,
  profile: GodProfile,
  snapshot: PerceptionSnapshot,
): string | undefined {
  if (!isGodIntentAction(ability.action)) return undefined;
  const limit =
    ability.action === "strike"
      ? ` Use a power of at most ${strikePowerCap(abilityFor(profile, "strike"), snapshot)} (your authored power and the divinity you hold).`
      : "";
  return `- ${ability.name} (action "${ability.action}"): ${ability.description}${limit}`;
}

/**
 * The prompt for one god's turn. `instructions` is who the god is (drives,
 * lore, relationships, powers); `prompt` is what the god perceives now. Built
 * from the profile and the snapshot alone.
 */
export function buildGodContext(
  profile: GodProfile,
  snapshot: PerceptionSnapshot,
  remembered: Remembered = NOTHING_REMEMBERED,
): RouteContext {
  const offer = offerFor(profile, snapshot, remembered);
  const drives = Object.entries(profile.drives)
    .map(([drive, weight]) => `${drive} ${weight}`)
    .join(", ");
  const abilities = profile.abilities
    .map((ability) => describeAbility(ability, profile, snapshot))
    .filter((line): line is string => line !== undefined);
  const relationships = profile.relationships.map(
    (relationship) =>
      `- ${relationship.target} (${relationship.kind}), disposition ${relationship.disposition.toFixed(2)} on a scale from -1 to 1${relationship.note === undefined ? "" : `: ${relationship.note}`}`,
  );

  // The order of a request is the order of how long its text stays the same. A
  // model server reuses the longest start a new request shares with the last one
  // it read, so what is first is read least often: what every god is told alike,
  // then what this god is, then what changes with the tick. The lines are the
  // same lines a god has always been shown; only where each one sits changed.
  const instructions = [
    // Every god, every tick: how to decide, how to act, how to speak, how to reply.
    "Decide what you do next, in character, using only what you are shown as perceived. You know nothing else about the world, and you may only name ids listed in the scene.",
    'You may also move to a neighboring place (action "move"), or cross to another realm where a passage leads (action "realm-transition").',
    "Speak your report and legend words in the first person, to those who hear them, without using your own name.",
    `Keep a legend assertion (at most ${MAX_ASSERTION_LENGTH} characters) and report content (at most ${MAX_REPORT_LENGTH} characters) to one or two short sentences.`,
    goalInstruction(remembered),
    'You may also choose to wait (action "wait") and do nothing this turn; waiting is always allowed.',
    "Reply with one JSON object naming your action.",
    // This god, fixed: who it is, what is told of it, whom it holds close, what it can do.
    `You are ${profile.name}, a Greek god of ${profile.domains.join(", ")}.`,
    `Your drives, from 0 to 1: ${drives}.`,
    "What is told of you:",
    ...profile.lore.map((line) => `- ${line.statement}`),
    ...(relationships.length > 0
      ? ["Those you hold close or against:", ...relationships]
      : []),
    "Your powers:",
    ...abilities,
    // What this turn's scene and prayers add to the guidance: last, since it can change with every tick.
    ...(snapshot.actors.length > 0
      ? [
          'You may also tell someone here something (action "report", naming the listener, your words, and optionally a claim of who harmed or did a kindness to whom, and an event you saw). It is your own account, told as you choose.',
          citationGuidance("report", offer.witnessedEventIds),
        ]
      : []),
    ...(abilityFor(profile, "legend") === undefined
      ? []
      : [
          snapshot.actors.length === 0
            ? "No one is here to hear a legend now."
            : `A legend is heard by everyone here now: ${snapshot.actors.map((actor) => actor.id).join(", ")}.`,
          citationGuidance("legend", offer.eventIds),
        ]),
    ...prayerInstructions(remembered),
    ...(offer.practice === undefined
      ? []
      : describePracticeInstructions(remembered.threads, remembered.practice)),
  ].join("\n");

  const held =
    snapshot.self.inventory.length === 0
      ? "nothing"
      : snapshot.self.inventory
          .map((item) => `${item.resource} ${item.amount}`)
          .join(", ");
  // The user text goes the same way: what the god remembers and has resolved first, since it changes when something happens to it; the scene next, in the order a tick changes it; the open prayers, practices, and contests last, just before the question.
  const prompt = [
    ...describeRemembered(remembered),
    ...describeSelf(snapshot, remembered),
    `You are at ${snapshot.location.name} [${snapshot.location.id}] in the ${snapshot.location.realm} realm, tick ${snapshot.tick}.`,
    `You hold: ${held}.`,
    "Here with you:",
    ...(snapshot.actors.length === 0
      ? ["- no one else"]
      : snapshot.actors.map(
          (actor) => `- ${actor.id}${actor.isDeity ? " (a god)" : ""}`,
        )),
    "Buildings here:",
    ...(snapshot.buildings.length === 0
      ? ["- none"]
      : snapshot.buildings.map(
          (building) =>
            `- ${building.name} [${building.id}], ${building.status}`,
        )),
    "Recent events here:",
    ...(snapshot.events.length === 0
      ? ["- none"]
      : snapshot.events.map(describeEvent)),
    "Ways out:",
    ...(usableExits(snapshot).length === 0
      ? ["- none"]
      : usableExits(snapshot).map(
          (exit) =>
            `- ${exit.name} [${exit.to}], ${exit.realm} realm, by ${exit.transport}`,
        )),
    ...describePetitions(remembered),
    ...describeContests(remembered.practice),
    ...describeDigest(
      withStrikeLegality(
        remembered.threads,
        strikePowerCap(abilityFor(profile, "strike"), snapshot),
      ),
      remembered.practiceRefusal,
      remembered.practice.openings,
    ),
    "What do you do?",
  ].join("\n");

  return { instructions, prompt };
}
