// Petitions: a mortal prays at the altar about something that happened to it,
// and the named god hears it wherever it is.
//
// A prayer has a recorded cause (an event the mortal remembers in `causes`, or
// one of its open unmet needs), one god, and one request: help with what was
// lost, or punishment of an offender (a strike on its building, or on the mortal itself). The routine walks the
// mortal to the altar and back; the validator opens the petition and routes it.
// Everything here is a pure function of world state, and a petition is state
// changed only by events, so a replay rebuilds it.
//
// Favor is the mortal's affinity toward the god. There is no separate score.

import type {
  BlessingGrantedEvent,
  EntityId,
  EventId,
  LossNoticedEvent,
  PetitionAnsweredEvent,
  PetitionLapsedEvent,
  PetitionOpenedEvent,
  PetitionRefusedEvent,
  PetitionRequest,
  WorldEvent,
  WorldRules,
} from "@panthea/contracts";
import { creditActorInventory } from "./economy";
import { ALTAR, nextHop } from "./geography";
import { getMemories, getRelationship } from "./memory";
import {
  type ActorState,
  getActor,
  noticedKey,
  type Petition,
  type PetitionCause,
  standingOf,
  type WorldEventDraft,
  type WorldState,
} from "./state";

/** Defaults for `rules.petitionBalance`, in simulation ticks unless a count. */
export const DEFAULT_PETITION_BALANCE: Readonly<Record<string, number>> = {
  /**
   * How long after a petition opens a god's answer still counts. Owner
   * decision 2026-10-05 (SC6): 150, so every devotion (2 to 4) can defect inside
   * a 300-tick episode. It covers one trip from the great hall to a petition
   * target plus the answering action at the slowest god pace measured (one
   * action per 25 ticks): (4 + 1) x 25 = 125.
   */
  answerWindowTicks: 150,
  /** How long after it happened an event stays something a mortal will pray about. */
  causePrayableTicks: 150,
  /** Fewest ticks between two prayers by one mortal. */
  prayerCooldownTicks: 20,
  /** Divinity a god spends to bless. */
  blessDivinityCost: 2,
  /** Planks a bless grants for a damaged building. */
  blessPlanks: 3,
  /** Units of a resource a bless grants for an unmet need. */
  blessResourceAmount: 2,
  /** Most a bless returns of stock a mortal lost to theft or spoilage. */
  blessResourceCap: 4,
  /** Ticks without a consequential event before the director causes trouble. */
  directorQuietTicks: 120,
  /** Ticks a goal stays unreplaceable without a reason. */
  goalLockTicks: 40,
  /** Most units a god's strike takes of the struck mortal's most valuable carried good: what one answered prayer gives (`blessResourceAmount`), so a punishment costs about as much as help is worth. */
  strikeGoodsCap: 2,
  /**
   * A mortal defects when its affinity for its patron falls below this: it no longer feels warmly toward the god,
   * 0 or less. A devotion starts at 2 to 4 and a lapse or a refusal costs 2 (`harmAffinity`), so one ignored prayer
   * turns a devotion of 2 and two turn any authored devotion, which two prayers in the first 30 ticks put inside
   * a 300-tick episode (a test holds it).
   */
  defectionAffinity: 1,
  /** Fewest ticks between two wrongs one mortal draws: a temperament sets the odds in a tick, so this keeps one from wronging every tick. */
  wrongCooldownTicks: 30,
  /** What an open need multiplies a mortal's odds of wronging by. */
  wrongNeedMultiplier: 2,
  /** Most units one wrong takes or spoils: what one answered prayer gives (`blessResourceAmount`), so a prayer can make it good. */
  wrongLossCap: 2,
  /** Ticks a credit trade runs before it is judged. */
  creditDeadlineTicks: 100,
  /** Ticks after a wrong in which its victim may still take revenge: the answer window (150, when a prayer lapses and a lapse makes its victim eligible) and a further 150. */
  revengeWindowTicks: 300,
};

/** A petition tunable from `rules`, or its default. */
export function petitionBalanceOf(rules: WorldRules, key: string): number {
  return rules.petitionBalance?.[key] ?? DEFAULT_PETITION_BALANCE[key] ?? 0;
}

/** Most causes a mortal keeps: the newest, so state stays bounded. */
export const MAX_CAUSES = 8;

// --- Causes ------------------------------------------------------------------

/**
 * The cause as the mortal knows it, or `undefined` when it does not know of it.
 * A mortal knows a cause only through one of these, never through the world's
 * log:
 *
 * - a memory of the cause event, witnessed or told (a told one cites it), whose
 *   subjects name the offender: it knows who did it;
 * - a memory of a loss it noticed (`planNoticeStep`): it knows what it lost and
 *   not who did it, so the offender is dropped;
 * - its own unmet need, or its own grudge, which it always knows;
 * - a god's strike on it, which it always knows, and who struck;
 * - another mortal's wrong to it, which it always knows, and who did it;
 * - its own stolen or spoiled stock, which it always knows it lost.
 */
export function knownCause(
  state: WorldState,
  actorId: EntityId,
  cause: PetitionCause,
): PetitionCause | undefined {
  const { offender: _unknown, ...withoutOffender } = cause;
  if (
    cause.kind === "need" ||
    cause.kind === "grudge" ||
    cause.kind === "harm" ||
    cause.kind === "wrong"
  ) {
    return cause;
  }
  const memories = getMemories(state, actorId);
  const namesOffender = memories.some(
    (memory) =>
      cause.offender !== undefined &&
      (memory.kind === "witnessed"
        ? memory.sourceEventId === cause.eventId
        : memory.kind === "told" && memory.linkedEventId === cause.eventId) &&
      memory.subjects.includes(cause.offender),
  );
  if (namesOffender) return cause;
  const noticedIt = memories.some(
    (memory) =>
      memory.kind === "noticed" && memory.causeEventId === cause.eventId,
  );
  if (noticedIt || cause.kind === "theft" || cause.kind === "spoilage") {
    return withoutOffender;
  }
  return undefined;
}

// --- Noticing a loss -----------------------------------------------------------------------

/**
 * The `loss-noticed` events this tick records: each living owner standing at its
 * own damaged, burning, or destroyed building, and each owner of stolen or
 * spoiled stock, once per loss (`state.noticed`). The loss is the owner's own
 * recorded cause (`state.causes`), so the event names the cause that made it.
 * An environmental step like the need scan: it proposes nothing and takes no
 * action slot.
 */
export function planNoticeStep(state: WorldState): readonly WorldEventDraft[] {
  const drafts: WorldEventDraft[] = [];
  for (const [owner, causes] of state.causes) {
    const actor = getActor(state, owner);
    if (!actor?.alive) continue;
    for (const cause of causes) {
      if (state.noticed.has(noticedKey(owner, cause.eventId))) continue;
      if (cause.kind === "damage" || cause.kind === "fire") {
        const building =
          cause.building === undefined
            ? undefined
            : state.buildings.get(cause.building);
        const seesIt =
          building !== undefined &&
          building.owner === owner &&
          building.locationId === actor.locationId &&
          building.status !== "operational";
        if (seesIt) {
          drafts.push({
            kind: "loss-noticed",
            entityId: owner,
            causeEventId: cause.eventId,
            building: building.id,
          });
        }
      } else if (
        (cause.kind === "theft" || cause.kind === "spoilage") &&
        cause.resource !== undefined &&
        cause.amount !== undefined
      ) {
        drafts.push({
          kind: "loss-noticed",
          entityId: owner,
          causeEventId: cause.eventId,
          resource: cause.resource,
          amount: cause.amount,
        });
      }
    }
  }
  return drafts;
}

export function applyLossNoticed(
  state: WorldState,
  event: LossNoticedEvent,
): WorldState {
  const noticed = new Map(state.noticed);
  noticed.set(noticedKey(event.entityId, event.causeEventId), {
    owner: event.entityId,
    causeEventId: event.causeEventId,
    eventId: event.id,
  });
  return { ...state, noticed };
}

/** What a cause is about, for the one-open-petition rule: a resource, or a building. A grudge, or a cause with neither, is about nothing and blocks nothing. */
function subjectOfCause(cause: PetitionCause): string | undefined {
  // A harm by a god is its own matter: it never waits behind a prayer about the goods it took.
  if (cause.kind === "harm" || cause.kind === "wrong") return undefined;
  if (cause.building !== undefined) return `building:${cause.building}`;
  if (cause.resource !== undefined) return `resource:${cause.resource}`;
  return undefined;
}

/** The unmet needs `actorId` has, as causes: what it lacks, with no offender. */
function needCauses(state: WorldState, actorId: EntityId): PetitionCause[] {
  return [...state.needs.values()]
    .filter((need) => need.actor === actorId)
    .map((need) => ({
      eventId: need.eventId,
      tick: need.tick,
      kind: "need" as const,
      resource: need.resource,
    }));
}

/**
 * What a petition was about, as the petitioner knew it when it prayed: the
 * cause it cited through `knownCause`, so an offender it never learned stays
 * unknown. A cause no longer on record (a fixture's, say) is read from the
 * request instead.
 */
function aboutPetition(
  state: WorldState,
  event: PetitionOpenedEvent,
): PetitionCause {
  const recorded = [
    ...(state.causes.get(event.entityId) ?? []),
    ...needCauses(state, event.entityId),
  ].find((cause) => cause.eventId === event.cause);
  const known =
    recorded === undefined
      ? undefined
      : knownCause(state, event.entityId, recorded);
  if (known !== undefined) return known;
  const base = { eventId: event.cause, tick: event.tick };
  const { request } = event;
  if (request.kind === "punish") {
    return { ...base, kind: "grudge", offender: request.offender };
  }
  return request.need.kind === "building"
    ? { ...base, kind: "damage", building: request.need.building }
    : { ...base, kind: "need", resource: request.need.resource };
}

/**
 * What the petitions say about one mortal and about every cause, read once per
 * `petitions` Map and not once per question.
 *
 * Petitions are never pruned, so a long-lived world holds thousands, while every
 * mortal asks "may I pray now, and about what" on every tick. Answering from the
 * Map each time walked all of them three times per question (the prayer
 * cooldown, the causes already prayed about, the subjects with a petition open),
 * which in an hour of catch-up on a world six hours old was most of the time the
 * routines took.
 *
 * The index is a pure function of the Map's contents and is kept in a WeakMap
 * keyed by the Map object. That is sound because a `WorldState` is never
 * changed in place: every reducer that changes a petition builds a new Map
 * (`applyPetitionOpened`, `closePetition`) and the old one is garbage. Nothing is
 * stored on the state, so it is not persisted, not encoded, and not compared.
 */
interface PetitionIndex {
  /** Every cause some petition cites. */
  readonly causes: ReadonlySet<EventId>;
  /** The tick of each petitioner's newest petition. */
  readonly newestTick: ReadonlyMap<EntityId, number>;
  /** The subjects (`resource:…`, `building:…`) each petitioner has a petition open about. */
  readonly openSubjects: ReadonlyMap<EntityId, ReadonlySet<string>>;
}

const petitionIndexes = new WeakMap<
  ReadonlyMap<EventId, Petition>,
  PetitionIndex
>();

function petitionIndex(state: WorldState): PetitionIndex {
  let index = petitionIndexes.get(state.petitions);
  if (index === undefined) {
    const causes = new Set<EventId>();
    const newestTick = new Map<EntityId, number>();
    const openSubjects = new Map<EntityId, Set<string>>();
    for (const petition of state.petitions.values()) {
      causes.add(petition.cause);
      const newest = newestTick.get(petition.petitioner);
      if (newest === undefined || petition.tick > newest) {
        newestTick.set(petition.petitioner, petition.tick);
      }
      if (petition.status === "open") {
        const subject = subjectOfCause(petition.about);
        if (subject !== undefined) {
          const held = openSubjects.get(petition.petitioner);
          if (held === undefined) {
            openSubjects.set(petition.petitioner, new Set([subject]));
          } else {
            held.add(subject);
          }
        }
      }
    }
    index = { causes, newestTick, openSubjects };
    petitionIndexes.set(state.petitions, index);
  }
  return index;
}

/** What a mortal could pray about now, newest first: the causes it knows (`knownCause`) and its open unmet needs, minus any already prayed about or older than the prayable window. Empty during the prayer cooldown. */
export function prayableCauses(
  state: WorldState,
  actorId: EntityId,
): readonly PetitionCause[] {
  if (inCooldown(state, actorId)) return [];
  const window = petitionBalanceOf(state.rules, "causePrayableTicks");
  const { causes: prayedAbout, openSubjects: allOpen } = petitionIndex(state);
  // One open petition per resource or building: while the mortal's own petition
  // about a subject is open, a new cause about the same subject is not prayed
  // about (it is still a cause of its own, and once the petition is answered or
  // lapses a later cause can lead to a prayer).
  const openSubjects = allOpen.get(actorId);
  return [...(state.causes.get(actorId) ?? []), ...needCauses(state, actorId)]
    .flatMap((cause) => {
      const known = knownCause(state, actorId, cause);
      return known === undefined ? [] : [known];
    })
    .filter(
      (cause) =>
        state.tick - cause.tick <= window &&
        !prayedAbout.has(cause.eventId) &&
        !(openSubjects?.has(subjectOfCause(cause) ?? "") ?? false) &&
        requestFor(state, cause) !== undefined,
    )
    .sort(
      (a, b) =>
        // A harm a god did leads, so its patron hears the god's name before any need is prayed about.
        Number(b.kind === "harm") - Number(a.kind === "harm") ||
        b.tick - a.tick ||
        (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
    );
}

/** Whether `actorId` has prayed within the prayer cooldown: its newest petition is younger than the cooldown, and so any other of its petitions is no younger than that. */
function inCooldown(state: WorldState, actorId: EntityId): boolean {
  const cooldown = petitionBalanceOf(state.rules, "prayerCooldownTicks");
  const newest = petitionIndex(state).newestTick.get(actorId);
  return newest !== undefined && state.tick - newest < cooldown;
}

/** The buildings `owner` holds, in id order. */
function buildingsOwnedBy(state: WorldState, owner: EntityId): EntityId[] {
  return [...state.buildings.values()]
    .filter((building) => building.owner === owner)
    .map((building) => building.id)
    .sort();
}

/**
 * What a mortal would ask for about `cause`: punishment of an offender who owns
 * a building, otherwise help with what was lost. A grudge against a living
 * mortal asks for its punishment, building or none (the world strikes its goods).
 * A harm by a god asks for the goods back, or, when nothing was taken, for the
 * god to answer for it. A grudge against anyone else has nothing to ask for, so
 * it is not prayable.
 */
export function requestFor(
  state: WorldState,
  cause: PetitionCause,
): PetitionRequest | undefined {
  const owned =
    cause.offender === undefined ? [] : buildingsOwnedBy(state, cause.offender);
  if (cause.offender !== undefined && owned.length > 0) {
    return { kind: "punish", offender: cause.offender, buildings: owned };
  }
  switch (cause.kind) {
    case "damage":
    case "fire":
      return cause.building === undefined
        ? undefined
        : {
            kind: "help",
            need: { kind: "building", building: cause.building },
          };
    case "theft":
    case "spoilage":
      return cause.resource === undefined
        ? undefined
        : {
            kind: "help",
            need: {
              kind: "resource",
              resource: cause.resource,
              ...(cause.amount === undefined ? {} : { amount: cause.amount }),
            },
          };
    case "need":
      return cause.resource === undefined
        ? undefined
        : {
            kind: "help",
            need: { kind: "resource", resource: cause.resource },
          };
    case "grudge": {
      const offender =
        cause.offender === undefined
          ? undefined
          : getActor(state, cause.offender);
      return offender?.alive === true && offender.isDeity !== true
        ? { kind: "punish", offender: offender.id, buildings: [] }
        : undefined;
    }
    case "wrong": {
      const offender =
        cause.offender === undefined
          ? undefined
          : getActor(state, cause.offender);
      if (offender?.alive === true && offender.isDeity !== true) {
        return { kind: "punish", offender: offender.id, buildings: [] };
      }
      return cause.resource === undefined
        ? undefined
        : {
            kind: "help",
            need: {
              kind: "resource",
              resource: cause.resource,
              ...(cause.amount === undefined ? {} : { amount: cause.amount }),
            },
          };
    }
    case "harm":
      if (cause.resource !== undefined && (cause.amount ?? 0) > 0) {
        return {
          kind: "help",
          need: {
            kind: "resource",
            resource: cause.resource,
            ...(cause.amount === undefined ? {} : { amount: cause.amount }),
          },
        };
      }
      return cause.offender === undefined
        ? undefined
        : { kind: "punish", offender: cause.offender, buildings: [] };
  }
}

// --- Routing and opening ---------------------------------------------------------------

/** Petitions ever addressed to `god`: the tie-break when a mortal favors two gods equally. */
function petitionsReceivedBy(state: WorldState, god: EntityId): number {
  let count = 0;
  for (const petition of state.petitions.values()) {
    if (petition.god === god) count += 1;
  }
  return count;
}

function livingGod(state: WorldState, id: EntityId): EntityId | undefined {
  const actor = getActor(state, id);
  return actor?.alive === true && actor.isDeity === true ? id : undefined;
}

/** The god `mortal` belongs to, when it has a patron and the patron lives. */
export function patronOf(
  state: WorldState,
  mortal: EntityId,
): EntityId | undefined {
  const patron = state.patrons.get(mortal);
  return patron === undefined ? undefined : livingGod(state, patron);
}

/**
 * The god of the domain a trouble falls in, from the pack's trouble-kind table: fire, spoiled stock, and a
 * director's theft have no mortal wrongdoer to answer for them. A fire or a theft a god's own act
 * caused is a harm by that god, which belongs to the victim's patron, so it has no domain god here.
 */
function domainGod(
  state: WorldState,
  cause: PetitionCause,
): EntityId | undefined {
  if (
    cause.kind !== "fire" &&
    cause.kind !== "spoilage" &&
    cause.kind !== "theft"
  ) {
    return undefined;
  }
  if (
    cause.offender !== undefined &&
    getActor(state, cause.offender)?.isDeity === true
  ) {
    return undefined;
  }
  const god = state.rules.troubleKinds?.[cause.kind];
  return god === undefined ? undefined : livingGod(state, god as EntityId);
}

/**
 * The god `mortal` prays to about `cause`. A trouble in a god's domain goes to that god. Everything else (a
 * wrong, a grudge, a harm, a need, hunger included) goes to the mortal's patron. A mortal with no patron,
 * one built outside a content pack, prays to the living deity it weighs most: its affinity plus the god's
 * lasting standing at the place it lives. On a tie, the one that has received the fewest petitions; then by id.
 */
export function routePetition(
  state: WorldState,
  mortal: EntityId,
  cause?: PetitionCause,
): EntityId | undefined {
  const domain = cause === undefined ? undefined : domainGod(state, cause);
  if (domain !== undefined) return domain;
  const patron = patronOf(state, mortal);
  if (patron !== undefined) return patron;
  const gods = [...state.actors.values()]
    .filter((actor) => actor.alive && actor.isDeity === true)
    .map((actor) => actor.id)
    .sort();
  const actor = getActor(state, mortal);
  const place =
    actor === undefined ? undefined : (actor.home ?? actor.locationId);
  let best: EntityId | undefined;
  let bestWeight = Number.NEGATIVE_INFINITY;
  let bestReceived = Number.POSITIVE_INFINITY;
  for (const god of gods) {
    const weight =
      (getRelationship(state, mortal, god)?.affinity ?? 0) +
      (place === undefined ? 0 : standingOf(state, god, place));
    const received = petitionsReceivedBy(state, god);
    if (
      weight > bestWeight ||
      (weight === bestWeight && received < bestReceived)
    ) {
      best = god;
      bestWeight = weight;
      bestReceived = received;
    }
  }
  return best;
}

/** The petition `mortal` would open citing `causeId` now, or `undefined` when the cause is not one it can pray about. */
export function petitionFor(
  state: WorldState,
  mortal: EntityId,
  causeId: EventId,
): { readonly god: EntityId; readonly request: PetitionRequest } | undefined {
  const cause = prayableCauses(state, mortal).find(
    (c) => c.eventId === causeId,
  );
  if (cause === undefined) return undefined;
  const request = requestFor(state, cause);
  const god = routePetition(state, mortal, cause);
  return request === undefined || god === undefined
    ? undefined
    : { god, request };
}

/** Whether `actor` may pray: a living mortal. */
export function canPray(actor: ActorState | undefined): actor is ActorState {
  return actor?.alive === true && actor.isDeity !== true;
}

/** The petitions addressed to `god` that are still open. This is the divine sense: the god's own petitions, read from world state, whatever it can perceive. */
export function openPetitionsFor(
  state: WorldState,
  god: EntityId,
): readonly Petition[] {
  return [...state.petitions.values()]
    .filter((petition) => petition.god === god && petition.status === "open")
    .sort((a, b) => a.tick - b.tick || (a.id < b.id ? -1 : 1));
}

// --- The routine's part -----------------------------------------------------------------

/** What a mortal's routine does about prayer this tick, if anything: pray, or take one step toward the altar or home. */
export type PrayerStep =
  | { readonly kind: "pray"; readonly cause: EventId }
  | {
      readonly kind: "walk";
      readonly to: EntityId;
      readonly purpose: "altar" | "home";
    };

export function prayerStep(
  state: WorldState,
  actorId: EntityId,
): PrayerStep | undefined {
  const actor = getActor(state, actorId);
  if (!canPray(actor)) return undefined;
  const [cause] = prayableCauses(state, actorId);
  if (cause !== undefined) {
    if (actor.locationId === ALTAR)
      return { kind: "pray", cause: cause.eventId };
    const hop = nextHop(state, actor.locationId, ALTAR, actor.capabilities);
    return hop === undefined
      ? undefined
      : { kind: "walk", to: hop, purpose: "altar" };
  }
  // The walk home belongs to the prayer trip: a mortal still within its prayer
  // cooldown of its last prayer is on its way back. One placed elsewhere any
  // other time stays put.
  if (
    actor.home !== undefined &&
    actor.locationId !== actor.home &&
    inCooldown(state, actorId)
  ) {
    const hop = nextHop(
      state,
      actor.locationId,
      actor.home,
      actor.capabilities,
    );
    return hop === undefined
      ? undefined
      : { kind: "walk", to: hop, purpose: "home" };
  }
  return undefined;
}

// --- Reducers ----------------------------------------------------------------------------

/** Whether the memory that moved this feeling rests on a wrong between mortals. */
function fromWrong(
  state: WorldState,
  event: Extract<WorldEvent, { kind: "relationship-changed" }>,
): boolean {
  const memory = getMemories(state, event.entityId).find(
    (held) => held.id === event.memoryEventId,
  );
  return memory !== undefined && state.wrongs.has(memory.sourceEventId);
}

/** Records `cause` for `owner`, keeping only the newest `MAX_CAUSES`. */
function recordCause(
  state: WorldState,
  owner: EntityId | undefined,
  cause: PetitionCause,
): WorldState {
  if (owner === undefined || !getActor(state, owner)) return state;
  const causes = new Map(state.causes);
  causes.set(
    owner,
    [...(state.causes.get(owner) ?? []), cause].slice(-MAX_CAUSES),
  );
  return { ...state, causes };
}

/**
 * What an event that happened to a mortal leaves in its memory of causes:
 * damage or fire to its building, a theft from it, spoiled stock, a grudge. Run
 * against the state just before the event is applied.
 */
export function recordCauses(state: WorldState, event: WorldEvent): WorldState {
  switch (event.kind) {
    case "building-damaged":
      return recordCause(state, state.buildings.get(event.entityId)?.owner, {
        eventId: event.id,
        tick: event.tick,
        kind: "damage",
        offender: event.actor,
        building: event.entityId,
      });
    case "building-ignited":
      return recordCause(state, state.buildings.get(event.entityId)?.owner, {
        eventId: event.id,
        tick: event.tick,
        kind: "fire",
        ...(event.cause.kind === "director" || event.cause.actor === undefined
          ? {}
          : { offender: event.cause.actor }),
        building: event.entityId,
      });
    case "theft":
      return recordCause(state, event.victim, {
        eventId: event.id,
        tick: event.tick,
        kind: "theft",
        offender: event.entityId,
        resource: event.resource,
        amount: event.amount,
      });
    case "stock-spoiled":
      return recordCause(state, event.entityId, {
        eventId: event.id,
        tick: event.tick,
        kind: "spoilage",
        resource: event.resource,
        amount: event.amount,
      });
    case "wrong":
      return recordCause(state, event.victim, {
        eventId: event.id,
        tick: event.tick,
        kind: "wrong",
        offender: event.entityId,
        resource: event.resource,
        amount: event.amount,
        wrong: event.wrong,
      });
    case "mortal-struck":
      return recordCause(state, event.entityId, {
        eventId: event.id,
        tick: event.tick,
        kind: "harm",
        offender: event.actor,
        ...(event.resource === undefined
          ? {}
          : { resource: event.resource, amount: event.amount }),
      });
    case "relationship-changed":
      // A grudge a wrong left is that wrong's own cause, prayed about once: not a second prayer.
      return event.grudgeDelta > 0 && !fromWrong(state, event)
        ? recordCause(state, event.entityId, {
            eventId: event.id,
            tick: event.tick,
            kind: "grudge",
            offender: event.toward,
          })
        : state;
    default:
      return state;
  }
}

export function applyPetitionOpened(
  state: WorldState,
  event: PetitionOpenedEvent,
): WorldState {
  const petitions = new Map(state.petitions);
  petitions.set(event.id, {
    id: event.id,
    petitioner: event.entityId,
    god: event.god,
    cause: event.cause,
    about: aboutPetition(state, event),
    request: event.request,
    tick: event.tick,
    sequence: event.sequence,
    status: "open",
  });
  return { ...state, petitions };
}

export function applyBlessingGranted(
  state: WorldState,
  event: BlessingGrantedEvent,
): WorldState {
  const granted = creditActorInventory(
    state,
    event.recipient,
    event.resource,
    event.amount,
  );
  if (event.building === undefined) return granted;
  const repairGrants = new Map(granted.repairGrants);
  repairGrants.set(event.recipient, event.building);
  return { ...granted, repairGrants };
}

function closePetition(
  state: WorldState,
  petitionId: EventId,
  status: "answered" | "lapsed" | "refused",
): WorldState {
  const petition = state.petitions.get(petitionId);
  if (petition === undefined || petition.status !== "open") return state;
  const petitions = new Map(state.petitions);
  petitions.set(petitionId, { ...petition, status });
  return { ...state, petitions };
}

export function applyPetitionAnswered(
  state: WorldState,
  event: PetitionAnsweredEvent,
): WorldState {
  return closePetition(state, event.petitionId, "answered");
}

export function applyPetitionLapsed(
  state: WorldState,
  event: PetitionLapsedEvent,
): WorldState {
  return closePetition(state, event.petitionId, "lapsed");
}

export function applyPetitionRefused(
  state: WorldState,
  event: PetitionRefusedEvent,
): WorldState {
  return closePetition(state, event.petitionId, "refused");
}

// --- Judging ----------------------------------------------------------------------------

/** Whether `tick` is still inside `petition`'s answer window: inclusive, so the last tick of the window answers. */
export function inAnswerWindow(
  state: WorldState,
  petition: Petition,
  tick: number,
): boolean {
  return (
    tick - petition.tick <= petitionBalanceOf(state.rules, "answerWindowTicks")
  );
}

/** What a request asks of a bless: planks for a building, or an amount of a resource. */
export function blessingFor(
  state: WorldState,
  request: PetitionRequest,
): { resource: string; amount: number; building?: EntityId } | undefined {
  if (request.kind !== "help") return undefined;
  if (request.need.kind === "building") {
    return {
      resource: "planks",
      amount: petitionBalanceOf(state.rules, "blessPlanks"),
      building: request.need.building,
    };
  }
  // Lost stock is returned up to the cap; an unmet need gets the standing amount.
  return {
    resource: request.need.resource,
    amount:
      request.need.amount === undefined
        ? petitionBalanceOf(state.rules, "blessResourceAmount")
        : Math.min(
            request.need.amount,
            petitionBalanceOf(state.rules, "blessResourceCap"),
          ),
  };
}

/** What a bless by `god` could do for a petition: the grant it would make, or why it could not. */
export type Blessability =
  | {
      readonly ok: true;
      readonly petition: Petition;
      readonly blessing: {
        resource: string;
        amount: number;
        building?: EntityId;
      };
    }
  | { readonly ok: false; readonly message: string };

/**
 * Whether a bless by `god` could answer petition `petitionId`: the petition is
 * addressed to that god, still open inside its answer window, and a request for
 * help (a punish petition is answered by a strike). The one rule `bless` is
 * validated by and a term to bless a mortal is held to, so a term cannot promise
 * a blessing the world would refuse to give. It does not look at where anyone
 * stands, who is alive, or what the god holds: those belong to the act itself.
 */
export function blessability(
  state: WorldState,
  petitionId: EventId,
  god: EntityId,
): Blessability {
  const petition = state.petitions.get(petitionId);
  if (
    petition === undefined ||
    petition.god !== god ||
    petition.status !== "open" ||
    !inAnswerWindow(state, petition, state.tick)
  ) {
    return {
      ok: false,
      message: `${petitionId} is not an open petition addressed to this god`,
    };
  }
  const blessing = blessingFor(state, petition.request);
  if (blessing === undefined) {
    return {
      ok: false,
      message: "a punish petition is answered by a strike",
    };
  }
  return { ok: true, petition, blessing };
}

/**
 * Whether `god` may refuse petition `petitionId`: it is addressed to that god, still open, and inside its
 * answer window, the same standing a bless needs. A refusal asks nothing of the world beyond that.
 */
export function refusability(
  state: WorldState,
  petitionId: EventId,
  god: EntityId,
):
  | { readonly ok: true; readonly petition: Petition }
  | { readonly ok: false; readonly message: string } {
  const petition = state.petitions.get(petitionId);
  if (
    petition === undefined ||
    petition.god !== god ||
    petition.status !== "open" ||
    !inAnswerWindow(state, petition, state.tick)
  ) {
    return {
      ok: false,
      message: `${petitionId} is not an open petition addressed to this god`,
    };
  }
  return { ok: true, petition };
}

/** A judged answer: the petition it answers and the event that answered it. */
export interface Answer {
  readonly petition: Petition;
  readonly answeredBy: WorldEvent;
}

/**
 * The petitions this tick's primary events answer, in event order. `before` is
 * the world at the start of the tick and each event is judged against it with
 * the events before it applied (`applyEvent`), so a strike is judged on the
 * building as it stood. `petitions` is the world the petitions live in now.
 *
 * A strike by the named god on an operational building the offender owns
 * answers every open punish petition against that offender that lists it; a
 * strike on the offender itself answers every one. A
 * blessing answers the one petition it names. An answer inside the window
 * counts; the lapse check runs afterwards, so an answer on a petition's last
 * tick wins over its lapse.
 */
export function judgeAnswers(
  before: WorldState,
  primary: readonly WorldEvent[],
  petitions: WorldState,
  apply: (state: WorldState, event: WorldEvent) => WorldState,
): readonly Answer[] {
  const answers: Answer[] = [];
  const answered = new Set<EventId>();
  let running = before;
  for (const event of primary) {
    // An event answers only a petition already heard: one opened earlier in
    // sequence, never one that comes later in the same tick.
    const open = (petition: Petition) =>
      !answered.has(petition.id) &&
      petitions.petitions.get(petition.id)?.status === "open" &&
      petition.sequence < event.sequence &&
      inAnswerWindow(petitions, petition, event.tick);
    const answer = (petition: Petition) => {
      answered.add(petition.id);
      answers.push({ petition, answeredBy: event });
    };
    if (event.kind === "blessing-granted") {
      const petition = petitions.petitions.get(event.petitionId);
      if (petition && open(petition)) answer(petition);
    } else if (event.kind === "mortal-struck") {
      // A strike on the mortal answers every open punish petition against it that is addressed to the striker.
      for (const petition of petitions.petitions.values()) {
        if (
          petition.god === event.actor &&
          petition.request.kind === "punish" &&
          petition.request.offender === event.entityId &&
          open(petition)
        ) {
          answer(petition);
        }
      }
    } else if (
      event.kind === "building-damaged" ||
      event.kind === "building-ignited"
    ) {
      const striker =
        event.kind === "building-damaged"
          ? event.actor
          : event.cause.kind === "strike"
            ? event.cause.actor
            : undefined;
      const building = running.buildings.get(event.entityId);
      if (striker !== undefined && building?.status === "operational") {
        for (const petition of petitions.petitions.values()) {
          if (
            petition.god === striker &&
            petition.request.kind === "punish" &&
            petition.request.buildings.includes(event.entityId) &&
            open(petition)
          ) {
            answer(petition);
          }
        }
      }
    }
    running = apply(running, event);
  }
  return answers;
}

/** The open petitions whose window has closed: `state.tick` is past the last answerable tick (T + window), so a petition opened at T lapses on T + window + 1. Run after answers, which count through T + window. */
export function lapsingPetitions(state: WorldState): readonly Petition[] {
  const window = petitionBalanceOf(state.rules, "answerWindowTicks");
  return [...state.petitions.values()].filter(
    (petition) =>
      petition.status === "open" && state.tick - petition.tick > window,
  );
}

/** The draft of a `petition-answered` event. */
export function answeredDraft(answer: Answer): WorldEventDraft {
  return {
    kind: "petition-answered",
    entityId: answer.petition.petitioner,
    god: answer.petition.god,
    petitionId: answer.petition.id,
    answeredBy: answer.answeredBy.id,
  };
}
