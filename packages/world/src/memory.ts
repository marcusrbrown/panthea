// Memory, beliefs, and relationships: world state changed only by events.
//
// Three event kinds carry it. `memory-recorded` gives one actor one memory
// (witnessed: it was there; told: it holds someone's account as a belief).
// `report-told` is the primary event of a `report` proposal. `relationship-
// changed` moves one actor's feeling toward another and cites the memory that
// caused it. None of them is authored by a rule handler: a tick derives them
// after its primary events have ids (see `runTick`), from committed state and
// those events alone, so replay and rebuild reproduce them exactly.
//
// Derived events never trigger derivation: a memory is never formed of a
// memory, a relationship change, or a report's content (reports are private:
// only the listener learns of one, as a belief). Those kinds are `UNPLACED_
// EVENT_KINDS`: they happen at no place, so nobody perceives them, and the
// types keep them out of a witnessed memory.
//
// A report's claim, not the event it cites, is what a listener learns: the
// teller says who did what to whom, the world stores that as told and never
// checks it. A listener takes a claim from a given teller once (see
// `toldMemory`), so repeating a report cannot farm a relationship.
//
// Every number here is a D23 tunable (docs/product/defaults.md). It is read
// from `rules.memoryBalance`, falling back to `DEFAULT_MEMORY_BALANCE`, so a
// content pack can retune it and none of it lives in a prompt.

import type {
  Consequence,
  EndingEventKind,
  EntityId,
  EventId,
  LegendRecordedEvent,
  LossNoticedEvent,
  MemoryEnding,
  MemoryRecordedEvent,
  PracticeOutcome,
  ReportToldEvent,
  WitnessedEventKind,
  WorldEvent,
  WorldRules,
} from "@panthea/contracts";
import {
  DEFAULT_AFFINITY_LIMIT,
  eventSubjects,
  UNPLACED_EVENT_KINDS,
} from "@panthea/contracts";
import { perceivesEvent } from "./perception";
import {
  type MemoryEntry,
  type RelationshipState,
  relationshipKey,
  type WorldEventDraft,
  type WorldState,
} from "./state";

/** Defaults for `rules.memoryBalance`. A `salience_<event-kind>` entry makes that kind memorable; a kind with none (or 0) is never remembered. */
export const DEFAULT_MEMORY_BALANCE: Readonly<Record<string, number>> = {
  /** Most memories one actor keeps. */
  capacity: 24,
  "salience_building-damaged": 5,
  /** A strike on a mortal: the struck mortal, and anyone at its place, remembers the god that did it. */
  "salience_mortal-struck": 5,
  "salience_building-ignited": 8,
  "salience_building-destroyed": 9,
  "salience_building-repaired": 4,
  "salience_worship-performed": 4,
  /** A belief formed from a report. */
  salience_told: 4,
  /** A theft someone was there to see. */
  salience_theft: 6,
  /** A mortal's memory of a god's answer or silence. */
  salience_sign: 6,
  /** A party's memory of how a thread ended: a bargain kept, refused, or broken is not forgotten with idle talk. */
  "salience_practice-ended": 7,
  /** A loss the mortal noticed. */
  salience_noticed: 5,
  /** Affinity lost toward whoever did harm one witnessed. */
  harmAffinity: 2,
  /** Affinity gained toward whoever did one a kindness. */
  kindnessAffinity: 1,
  /** Affinity lost toward whoever refused one's demand: a refusal is a cooling, not a wrong, so it leaves no grudge. */
  refusalAffinity: 1,
  /** What a belief moves affinity by, as a share of what witnessing it would. */
  toldShare: 0.5,
  /** Affinity never goes beyond plus or minus this. */
  affinityLimit: DEFAULT_AFFINITY_LIMIT,
  /** A grudge never goes beyond this. */
  grudgeLimit: 10,
};

/** A memory tunable from `rules`, or its default. */
export function memoryBalanceOf(rules: WorldRules, key: string): number {
  return rules.memoryBalance?.[key] ?? DEFAULT_MEMORY_BALANCE[key] ?? 0;
}

function balanceOf(state: WorldState, key: string): number {
  return memoryBalanceOf(state.rules, key);
}

/** Most memories one actor holds. */
export function memoryCapacityOf(state: WorldState): number {
  return balanceOf(state, "capacity");
}

const NO_MEMORIES: readonly MemoryEntry[] = [];

/** What `actor` remembers, oldest first. */
export function getMemories(
  state: WorldState,
  actor: EntityId,
): readonly MemoryEntry[] {
  return state.memories.get(actor) ?? NO_MEMORIES;
}

export function getRelationship(
  state: WorldState,
  from: EntityId,
  toward: EntityId,
): RelationshipState | undefined {
  return state.relationships.get(relationshipKey(from, toward));
}

// --- Reducers -----------------------------------------------------------------

function memoryEntryOf(event: MemoryRecordedEvent): MemoryEntry {
  const base = {
    id: event.id,
    sourceEventId: event.sourceEventId,
    salience: event.salience,
    recordedAt: event.sequence,
    subjects: event.subjects,
    ...(event.consequence === undefined
      ? {}
      : { consequence: event.consequence }),
  };
  switch (event.memoryKind) {
    case "witnessed":
      return {
        ...base,
        kind: "witnessed",
        eventKind: event.eventKind,
        ...(event.ending === undefined ? {} : { ending: event.ending }),
      };
    case "noticed":
      return { ...base, kind: "noticed", causeEventId: event.causeEventId };
    case "sign":
      return {
        ...base,
        kind: "sign",
        god: event.god,
        outcome: event.outcome,
        petitionId: event.petitionId,
      };
    case "told":
      return {
        ...base,
        kind: "told",
        teller: event.teller,
        content: event.content,
        ...(event.linkedEventId === undefined
          ? {}
          : { linkedEventId: event.linkedEventId }),
      };
  }
}

/**
 * Forgets entries until `entries` fits `capacity`: the least salient goes
 * first, and among equals the oldest. Purely a function of the entries, so
 * replaying the log forgets exactly what the live world forgot. A new memory
 * less salient than everything held is the one forgotten.
 */
function evict(
  entries: readonly MemoryEntry[],
  capacity: number,
): readonly MemoryEntry[] {
  const kept = [...entries];
  // Content parsing keeps capacity a whole number of at least 0; the floor
  // keeps a rules value that skipped it from looping on an empty list.
  while (kept.length > Math.max(0, capacity)) {
    let victim = 0;
    for (const [index, entry] of kept.entries()) {
      const current = kept[victim];
      if (
        entry.salience < current.salience ||
        (entry.salience === current.salience &&
          entry.recordedAt < current.recordedAt)
      ) {
        victim = index;
      }
    }
    kept.splice(victim, 1);
  }
  return kept;
}

export function applyMemoryRecorded(
  state: WorldState,
  event: MemoryRecordedEvent,
): WorldState {
  const memories = new Map(state.memories);
  memories.set(
    event.entityId,
    evict(
      [...getMemories(state, event.entityId), memoryEntryOf(event)],
      memoryCapacityOf(state),
    ),
  );
  return { ...state, memories };
}

function clampAffinity(state: WorldState, affinity: number): number {
  const limit = balanceOf(state, "affinityLimit");
  return Math.max(-limit, Math.min(limit, affinity));
}

function clampGrudge(state: WorldState, grudge: number): number {
  return Math.min(balanceOf(state, "grudgeLimit"), grudge);
}

const freshRelationship = (
  from: EntityId,
  toward: EntityId,
): RelationshipState => ({
  from,
  toward,
  affinity: 0,
  grudge: 0,
  allied: false,
});

export function applyRelationshipChanged(
  state: WorldState,
  event: Extract<WorldEvent, { kind: "relationship-changed" }>,
): WorldState {
  const held =
    getRelationship(state, event.entityId, event.toward) ??
    freshRelationship(event.entityId, event.toward);
  const relationships = new Map(state.relationships);
  relationships.set(relationshipKey(event.entityId, event.toward), {
    ...held,
    affinity: clampAffinity(state, held.affinity + event.affinityDelta),
    grudge: clampGrudge(state, held.grudge + event.grudgeDelta),
    allied: event.allied ?? held.allied,
  });
  return { ...state, relationships };
}

// --- Derivation ---------------------------------------------------------------

/** A derived event before it has an id, with the committed event it follows from. */
export interface DerivedDraft {
  readonly draft: WorldEventDraft;
  /** The committed event it follows from: its id becomes the derived event's causation. */
  readonly cause: { readonly id: EventId };
}

/**
 * Whether an actor present can come to remember `event` as something it saw.
 * Not the unplaced kinds, which no one perceives; and not a legend, which its
 * hearers remember as told by its narrator (`legendTellings`), so a hearer
 * never holds one legend twice. A legend stays placed and visible.
 */
function isWitnessable(
  event: WorldEvent,
): event is Extract<WorldEvent, { kind: WitnessedEventKind }> {
  return (
    event.kind !== "legend-recorded" &&
    !(UNPLACED_EVENT_KINDS as readonly string[]).includes(event.kind)
  );
}

function unique(ids: readonly EntityId[]): readonly EntityId[] {
  return [...new Set(ids)];
}

/**
 * What `event` did to someone, worked out against the world as it stood just
 * before the event. A strike's damage and a fire it started harm whoever owns
 * the building, and the harm belongs to the actor whose strike began it (fire
 * carries that from ignition, through spread, to destruction). A worshipper
 * does the worshipped deity a kindness.
 */
function consequenceOf(
  before: WorldState,
  event: WorldEvent,
): Consequence | undefined {
  const harm = (
    agent: EntityId | undefined,
    building: EntityId,
  ): Consequence | undefined => {
    if (agent === undefined) return undefined;
    const owner = before.buildings.get(building)?.owner;
    return {
      effect: "harm",
      agent,
      ...(owner === undefined ? {} : { target: owner }),
    };
  };
  switch (event.kind) {
    case "building-damaged":
      return harm(event.actor, event.entityId);
    case "building-ignited":
      return harm(
        event.cause.kind === "director" ? undefined : event.cause.actor,
        event.entityId,
      );
    case "building-destroyed":
      return harm(
        before.buildings.get(event.entityId)?.ignition?.actor,
        event.entityId,
      );
    case "worship-performed":
      return { effect: "kindness", agent: event.entityId, target: event.deity };
    case "theft":
      return { effect: "harm", agent: event.entityId, target: event.victim };
    case "mortal-struck":
      return { effect: "harm", agent: event.actor, target: event.entityId };
    default:
      return undefined;
  }
}

/**
 * The memories a thread's ending gives its parties: each living party
 * remembers how it ended. The ending events are private (unplaced), so no one
 * stands at them; the parties are participants, and they alone remember. A
 * performance or a breach is a kindness or a harm by the one who was to
 * perform, to the other; a refusal or a withdrawal names who refused. `before`
 * is the world just before the event, with the thread still open.
 */
export function endingMemories(
  before: WorldState,
  event: WorldEvent,
): readonly DerivedDraft[] {
  let kind: EndingEventKind;
  let outcome: PracticeOutcome;
  let agent: EntityId | undefined;
  let sealed = false;
  if (event.kind === "practice-ended") {
    kind = "practice-ended";
    outcome = event.outcome;
    sealed = event.reason === "sealed";
  } else if (
    event.kind === "practice-moved" &&
    (event.move === "refuse" || event.move === "withdraw")
  ) {
    kind = "practice-moved";
    outcome = event.move === "refuse" ? "refused" : "withdrawn";
    agent = event.entityId;
  } else {
    return [];
  }
  const thread = before.threads.get(event.threadId);
  if (thread === undefined) return [];
  const performer = thread.term.party;
  const other =
    performer === thread.demander ? thread.obligated : thread.demander;
  if (
    kind === "practice-ended" &&
    thread.acceptance !== undefined &&
    (outcome === "fulfilled" || outcome === "breached")
  ) {
    agent = performer;
  }
  const consequence: Consequence | undefined =
    agent === undefined
      ? undefined
      : outcome === "fulfilled"
        ? { effect: "kindness", agent, target: other }
        : outcome === "breached"
          ? { effect: "harm", agent, target: other }
          : undefined;
  const salience = balanceOf(before, "salience_practice-ended");
  if (salience < 1) return [];
  const ending: MemoryEnding = {
    outcome,
    ...(agent === undefined ? {} : { agent }),
    ...(sealed ? { sealed: true as const } : {}),
    ...(thread.acceptance?.sworn === true ? { sworn: true as const } : {}),
  };
  return [thread.demander, thread.obligated]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .filter((party) => before.actors.get(party)?.alive === true)
    .map((party) => ({
      cause: event,
      draft: {
        kind: "memory-recorded" as const,
        memoryKind: "witnessed" as const,
        entityId: party,
        sourceEventId: event.id,
        eventKind: kind,
        subjects: [thread.demander, thread.obligated],
        salience,
        ...(consequence === undefined ? {} : { consequence }),
        ending,
      },
    }));
}

/**
 * The memories one primary event gives. `before` is the world just before the
 * event, so who was there is exact even when actors move within the tick, and
 * presence is judged by the same rule perception uses (`perceivesEvent`), not
 * by where anyone ended up. Every living actor that perceived a memorable
 * event remembers it, citing the event.
 */
export function witnessMemories(
  before: WorldState,
  event: WorldEvent,
): readonly DerivedDraft[] {
  if (!isWitnessable(event)) return [];
  const salience = balanceOf(before, `salience_${event.kind}`);
  if (salience < 1) return [];

  const consequence = consequenceOf(before, event);
  const subjects = unique([
    ...eventSubjects(event),
    ...(consequence === undefined
      ? []
      : [
          consequence.agent,
          ...(consequence.target === undefined ? [] : [consequence.target]),
        ]),
  ]);
  const witnesses = [...before.actors.values()]
    .filter((actor) => actor.alive && perceivesEvent(before, actor, event, []))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return witnesses.map((actor) => ({
    cause: event,
    draft: {
      kind: "memory-recorded",
      memoryKind: "witnessed",
      entityId: actor.id,
      sourceEventId: event.id,
      eventKind: event.kind,
      subjects,
      salience,
      ...(consequence === undefined ? {} : { consequence }),
    },
  }));
}

function sameClaim(a: Consequence | undefined, b: Consequence | undefined) {
  return (
    a?.effect === b?.effect && a?.agent === b?.agent && a?.target === b?.target
  );
}

/** One telling heard by one listener: a report to its listener, or a legend to one of its hearers. */
export interface Telling {
  /** The committed event the listener's belief rests on: the report, or the legend. */
  readonly sourceEvent: WorldEvent;
  readonly teller: EntityId;
  readonly listener: EntityId;
  readonly content: string;
  readonly claim?: Consequence;
  readonly linkedEventId?: EventId;
}

/** A report is a telling to its one listener. */
export function reportTelling(report: ReportToldEvent): Telling {
  return {
    sourceEvent: report,
    teller: report.entityId,
    listener: report.listenerId,
    content: report.content,
    ...(report.claim === undefined ? {} : { claim: report.claim }),
    ...(report.linkedEventId === undefined
      ? {}
      : { linkedEventId: report.linkedEventId }),
  };
}

/** A legend is a telling to each hearer recorded on it; the narrator is not one. */
export function legendTellings(legend: LegendRecordedEvent): Telling[] {
  return legend.hearers.map((listener) => ({
    sourceEvent: legend,
    teller: legend.entityId,
    listener,
    content: legend.assertion,
    ...(legend.claim === undefined ? {} : { claim: legend.claim }),
    ...(legend.linkedEventId === undefined
      ? {}
      : { linkedEventId: legend.linkedEventId }),
  }));
}

/**
 * The belief a telling gives its listener: the teller's account, verbatim and
 * attributed to the teller, never checked against what happened. What the
 * listener comes to believe about who did what to whom is the report's `claim`
 * and nothing else: the event the teller cited is provenance, and teaches the
 * listener nothing, so a report can neither smuggle in the truth behind its
 * citation nor be made to say something it did not. No claim means a story
 * with no consequence.
 *
 * A listener takes a given account from a given teller once. If it already
 * holds a told memory from this teller with the same claim (or, for a story
 * with no claim, the same words), the repeat forms no memory and no feeling,
 * so telling it again cannot farm a relationship or crowd out other memories.
 * The check reads the listener's memory, so it is deterministic from committed
 * state; a belief the listener has since forgotten can be told again.
 */
export function toldMemory(
  after: WorldState,
  telling: Telling,
): DerivedDraft | undefined {
  const { claim } = telling;
  const heard = getMemories(after, telling.listener).some(
    (memory) =>
      memory.kind === "told" &&
      memory.teller === telling.teller &&
      (claim === undefined
        ? memory.consequence === undefined && memory.content === telling.content
        : sameClaim(memory.consequence, claim)),
  );
  if (heard) return undefined;
  // Like a witnessed kind with no salience, a belief with none is not formed:
  // a memory's salience is a positive whole number.
  const salience = balanceOf(after, "salience_told");
  if (salience < 1) return undefined;
  return {
    cause: telling.sourceEvent,
    draft: {
      kind: "memory-recorded",
      memoryKind: "told",
      entityId: telling.listener,
      sourceEventId: telling.sourceEvent.id,
      teller: telling.teller,
      content: telling.content,
      ...(telling.linkedEventId === undefined
        ? {}
        : { linkedEventId: telling.linkedEventId }),
      subjects: unique([
        telling.teller,
        ...(claim === undefined
          ? []
          : [
              claim.agent,
              ...(claim.target === undefined ? [] : [claim.target]),
            ]),
      ]),
      salience,
      ...(claim === undefined ? {} : { consequence: claim }),
    },
  };
}

/** The memory a mortal forms of a loss it noticed: what it lost and the cause, with no offender and no consequence. */
export function noticedMemory(
  after: WorldState,
  event: LossNoticedEvent,
): DerivedDraft | undefined {
  const salience = balanceOf(after, "salience_noticed");
  if (salience < 1) return undefined;
  return {
    cause: event,
    draft: {
      kind: "memory-recorded",
      memoryKind: "noticed",
      entityId: event.entityId,
      sourceEventId: event.id,
      causeEventId: event.causeEventId,
      subjects: [
        event.entityId,
        ...(event.building === undefined ? [] : [event.building]),
      ],
      salience,
    },
  };
}

/**
 * The sign a mortal remembers of a god's answer or silence: a kindness by the
 * god toward it, or a harm by its neglect. It records which god and which
 * petition and nothing of where or how the god answered. A dead petitioner
 * remembers nothing.
 */
export function signMemory(
  after: WorldState,
  event: Extract<
    WorldEvent,
    { kind: "petition-answered" | "petition-lapsed" | "petition-refused" }
  >,
): DerivedDraft | undefined {
  // A refusal is the god's own event: its petitioner is the one who remembers it.
  const refused = event.kind === "petition-refused";
  const petitioner = refused ? event.petitioner : event.entityId;
  const god = refused ? event.entityId : event.god;
  if (!after.actors.get(petitioner)?.alive) return undefined;
  const salience = balanceOf(after, "salience_sign");
  if (salience < 1) return undefined;
  const answered = event.kind === "petition-answered";
  return {
    cause: event,
    draft: {
      kind: "memory-recorded",
      memoryKind: "sign",
      entityId: petitioner,
      sourceEventId: event.id,
      god,
      outcome: answered ? "answered" : refused ? "refused" : "lapsed",
      petitionId: event.petitionId,
      subjects: [god],
      salience,
      consequence: {
        effect: answered ? "kindness" : "harm",
        agent: god,
        target: petitioner,
      },
    },
  };
}

/**
 * The relationship changes this tick's new memories cause, each citing its
 * memory. Harm one remembers lowers affinity toward whoever did it, and adds a
 * grudge when the rememberer was the one wronged; a kindness raises affinity
 * only in the one it served. A belief moves affinity by `toldShare` of what
 * witnessing would. Nobody feels anything about their own acts. `state` is the
 * world with these memories already applied; changes to one pair within a tick
 * build on each other.
 */
export function planRelationships(
  state: WorldState,
  memories: readonly (MemoryRecordedEvent & { readonly id: EventId })[],
): readonly DerivedDraft[] {
  const harm = balanceOf(state, "harmAffinity");
  const kindness = balanceOf(state, "kindnessAffinity");
  const refusal = balanceOf(state, "refusalAffinity");
  const toldShare = balanceOf(state, "toldShare");

  const running = new Map<string, RelationshipState>();
  const drafts: DerivedDraft[] = [];
  for (const memory of memories) {
    const c = memory.consequence;
    const owner = memory.entityId;
    const ending =
      memory.memoryKind === "witnessed" ? memory.ending : undefined;
    let toward: EntityId | undefined;
    let affinityDelta = 0;
    let grudgeDelta = 0;
    if (ending?.outcome === "refused") {
      // A refusal cools the one refused toward the refuser; it wrongs no one.
      if (ending.agent !== undefined && ending.agent !== owner) {
        toward = ending.agent;
        affinityDelta = -refusal;
      }
    } else if (
      c !== undefined &&
      c.agent !== owner &&
      !(c.effect === "kindness" && c.target !== owner)
    ) {
      const strength = c.effect === "harm" ? harm : kindness;
      const scaled =
        memory.memoryKind === "told"
          ? Math.max(1, Math.round(strength * toldShare))
          : strength;
      toward = c.agent;
      affinityDelta = c.effect === "harm" ? -scaled : scaled;
      grudgeDelta = c.effect === "harm" && c.target === owner ? 1 : 0;
    }
    // A sealed settlement is the only thing that makes an alliance (R19): each
    // party allies with the other.
    const sealed = ending?.sealed === true;
    if (sealed) toward ??= memory.subjects.find((subject) => subject !== owner);
    if (toward === undefined) continue;

    const key = relationshipKey(owner, toward);
    const held =
      running.get(key) ??
      getRelationship(state, owner, toward) ??
      freshRelationship(owner, toward);
    const allied = sealed ? true : held.allied;
    if (affinityDelta === 0 && grudgeDelta === 0 && allied === held.allied) {
      continue;
    }
    running.set(key, {
      ...held,
      affinity: clampAffinity(state, held.affinity + affinityDelta),
      grudge: clampGrudge(state, held.grudge + grudgeDelta),
      allied,
    });
    drafts.push({
      cause: memory,
      draft: {
        kind: "relationship-changed",
        entityId: owner,
        toward,
        affinityDelta,
        grudgeDelta,
        ...(allied === held.allied ? {} : { allied }),
        memoryEventId: memory.id,
      },
    });
  }
  return drafts;
}
