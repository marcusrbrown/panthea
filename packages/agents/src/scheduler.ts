// Which god takes the next turn. Seven gods share one model, one inference at a
// time, so a turn is a scarce thing and the order matters: a god that owes
// something should not wait behind gods with nothing to decide.
//
// The picker is a pure function. It is given the gods that may take a turn
// (alive, with a profile, nothing of theirs waiting in the journal: the caller's
// to decide), what the world says each is waiting on (`schedulingSignals`, read
// from world state, never from a prompt), and the rotation's memory: who was
// served last and how many picks each god has been passed over. It answers who
// goes next and what the memory becomes. It reads no clock and no store, and it
// changes nothing it is given.
//
// The order is three tiers, then a bound:
//
//   1. Gods that owe an accepted obligation (a term they must perform, a boon
//      they owe), whatever its deadline: the earliest deadline first.
//   2. Gods a thread is waiting on for an answer.
//   3. Everyone else, round-robin in id order from the cursor.
//
// Ties inside a tier go by id order from the cursor (the god served last). A
// prayer or a contest raises nothing. And no god that is offered every time is
// passed over more than `SKIP_CAP` picks in a row: one full round of seven.
//
// The bound is kept for every god at once, not only for the one that reaches it.
// A rule that only lets a god at the cap jump the queue cannot hold it: with
// two gods that always owe, the five idle ones would reach the cap on the same
// pick and only one of them could be served. So a pick is the first god in
// tier order whose service still leaves every god that would be passed over a
// way to be served within the cap (each pick serves one god, so the gods most
// in need must be served in order, and there must be room for all of them). A
// god at the cap leaves no room, so it goes first, ahead of every tier. Seven
// gods and a cap of seven leave one spare pick in eight: a god that always owes
// goes ahead of the round, and the gap it opens is closed before any other god
// is passed over too often. Where more gods are offered than a round can hold
// (nine, say) the bound cannot be kept, and the god passed over most goes first.
//
// The memory lives in the caller's process and starts over on a restart: nothing
// here is stored, and the world never reads it.

import type { EntityId } from "@panthea/contracts";

/** A god is passed over at most this many picks in a row: one full round of seven. */
export const SKIP_CAP = 7;

/** What the world says a god is waiting on. See `schedulingSignals`. */
export interface GodSignals {
  readonly god: EntityId;
  /** The earliest deadline among the accepted obligations the god must perform, or `undefined`. */
  readonly obligationDeadline: number | undefined;
  /** A thread is waiting on this god's answer. */
  readonly awaited: boolean;
}

/** The rotation's memory. Never stored. */
export interface Rotation {
  /** The god served last: the cursor the round-robin continues from. */
  readonly lastServed: EntityId | undefined;
  /** For each god offered at the last pick and not served by it, how many picks in a row it has been passed over. A god not here has been passed over none. */
  readonly skips: ReadonlyMap<EntityId, number>;
}

/** A rotation that has served no one, which is what a restart is. */
export const START_OF_ROTATION: Rotation = {
  lastServed: undefined,
  skips: new Map(),
};

export interface Pick {
  readonly god: EntityId;
  /** The tier the god was picked from. */
  readonly why: "obligation" | "awaiting" | "rotation";
  /** The skip bound put this god ahead of one the tiers preferred. */
  readonly forced: boolean;
  /** The memory after this pick. */
  readonly rotation: Rotation;
}

/** `ids` in id order from the cursor: the gods after `lastServed` first, then the rest, as the round-robin always went. */
function fromCursor(
  ids: readonly EntityId[],
  lastServed: EntityId | undefined,
): EntityId[] {
  const sorted = [...ids].sort();
  if (lastServed === undefined) return sorted;
  return [
    ...sorted.filter((god) => god > lastServed),
    ...sorted.filter((god) => god <= lastServed),
  ];
}

/**
 * Whether every god in `counts` (the picks each has been passed over so far)
 * can still be served within `cap` passes, one god per pick: a god passed over
 * `c` times can wait until the `cap + 1 - c`th pick from now, and the gods in
 * order of that latest pick must each have a pick of their own.
 */
function everyoneCanBeServed(counts: readonly number[], cap: number): boolean {
  return [...counts]
    .map((passed) => cap + 1 - passed)
    .sort((a, b) => a - b)
    .every((latest, index) => latest >= index + 1);
}

/**
 * The god that takes the next turn among `eligible`, or `undefined` when no god
 * is. `rotation` is not changed: the pick carries the memory that follows it,
 * and the caller keeps that only when the turn really starts.
 */
export function pickGod(
  eligible: readonly GodSignals[],
  rotation: Rotation,
  cap: number = SKIP_CAP,
): Pick | undefined {
  if (eligible.length === 0) return undefined;
  const signalsOf = new Map(eligible.map((signals) => [signals.god, signals]));
  const ordered = fromCursor([...signalsOf.keys()], rotation.lastServed);
  const position = new Map(ordered.map((god, index) => [god, index]));
  const tierOf = (god: EntityId): 0 | 1 | 2 => {
    const signals = signalsOf.get(god) as GodSignals;
    return signals.obligationDeadline !== undefined
      ? 0
      : signals.awaited
        ? 1
        : 2;
  };
  const deadlineOf = (god: EntityId) =>
    (signalsOf.get(god) as GodSignals).obligationDeadline ??
    Number.POSITIVE_INFINITY;

  // The order the tiers prefer: owing gods by deadline, awaited gods, then the rest, each by the cursor.
  const preferred = [...ordered].sort(
    (a, b) =>
      tierOf(a) - tierOf(b) ||
      (tierOf(a) === 0 ? deadlineOf(a) - deadlineOf(b) : 0) ||
      (position.get(a) as number) - (position.get(b) as number),
  );
  const passedOver = (god: EntityId) => rotation.skips.get(god) ?? 0;

  // The first preferred god whose service leaves everyone else a way to be served within the cap.
  const keepsTheBound = (god: EntityId): boolean =>
    everyoneCanBeServed(
      ordered
        .filter((other) => other !== god)
        .map((other) => passedOver(other) + 1),
      cap,
    );
  const bounded = preferred.find(keepsTheBound);
  // With no such god (more offered than a round holds, or a god already at the cap and another past it), serve the god passed over most.
  const chosen =
    bounded ??
    [...ordered].sort(
      (a, b) =>
        passedOver(b) - passedOver(a) ||
        (position.get(a) as number) - (position.get(b) as number),
    )[0];
  const god = chosen as EntityId;

  const skips = new Map<EntityId, number>();
  for (const other of ordered) {
    if (other !== god) skips.set(other, passedOver(other) + 1);
  }
  const tier = tierOf(god);
  return {
    god,
    why: tier === 0 ? "obligation" : tier === 1 ? "awaiting" : "rotation",
    forced: god !== preferred[0],
    rotation: { lastServed: god, skips },
  };
}
