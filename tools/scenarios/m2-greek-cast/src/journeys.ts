// Each journey a god made, read from the run's own events: the world's
// `journey-started` event, the hops it caused (the `entity-moved` and
// `realm-transitioned` events correlated to it), and the `journey-ended` event
// that closed it. Pure functions over the stored events, like the request
// timings: nothing is inferred, and no check of the gate reads any of it.

import type { StoredEvent } from "./checks";

export interface JourneyHop {
  readonly tick: number;
  readonly kind: "entity-moved" | "realm-transitioned";
  readonly to: string;
  /** The place a crossing was made from. */
  readonly via?: string;
}

export type JourneyEnding =
  | { readonly kind: "arrived" | "replaced"; readonly tick: number }
  | {
      readonly kind: "refused";
      /** What the world answered. */
      readonly reason: string;
      readonly tick: number;
    };

export interface JourneyRecord {
  /** The `journey-started` event. */
  readonly id: string;
  readonly god: string;
  /** Where the god stood when it set out: where its last move left it, else where the world placed it; absent when neither is known. */
  readonly from: string | undefined;
  readonly to: string;
  readonly startTick: number;
  readonly hops: readonly JourneyHop[];
  /** Absent while the god is still travelling at the end of the run. */
  readonly ending: JourneyEnding | undefined;
}

const isMove = (event: StoredEvent): boolean =>
  event.kind === "entity-moved" || event.kind === "realm-transitioned";

/**
 * Every journey in `events`, in the order they started. `startLocations` is
 * where the world first placed each god, for a god's first journey.
 */
export function journeysOf(
  events: readonly StoredEvent[],
  startLocations: Readonly<Record<string, string>> | undefined,
): JourneyRecord[] {
  const ordered = [...events].sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  );
  const journeys: JourneyRecord[] = [];
  for (const start of ordered) {
    if (start.kind !== "journey-started") continue;
    const god = String(start.entityId);
    const before = ordered
      .filter(
        (event) =>
          isMove(event) &&
          event.entityId === god &&
          Number(event.sequence) < Number(start.sequence),
      )
      .at(-1);
    const hops = ordered
      .filter((event) => isMove(event) && event.correlationId === start.id)
      .map(
        (event): JourneyHop => ({
          tick: Number(event.tick),
          kind: event.kind as JourneyHop["kind"],
          to: String(event.to),
          ...(event.kind === "realm-transitioned"
            ? { via: String(event.via) }
            : {}),
        }),
      );
    const end = ordered.find(
      (event) =>
        event.kind === "journey-ended" && event.journeyEventId === start.id,
    );
    journeys.push({
      id: start.id,
      god,
      from: before === undefined ? startLocations?.[god] : String(before.to),
      to: String(start.to),
      startTick: Number(start.tick),
      hops,
      ending:
        end === undefined
          ? undefined
          : end.ending === "refused"
            ? {
                kind: "refused",
                reason: String(end.reason),
                tick: Number(end.tick),
              }
            : {
                kind: end.ending as "arrived" | "replaced",
                tick: Number(end.tick),
              },
    });
  }
  return journeys;
}

/** How many journeys started and how they ended, by kind, with the reason of each refusal. */
export function renderJourneyCounts(
  journeys: readonly JourneyRecord[],
): string {
  if (journeys.length === 0) return "none started";
  const count = (kind: string) =>
    journeys.filter((journey) => journey.ending?.kind === kind).length;
  const reasons = new Map<string, number>();
  for (const journey of journeys) {
    if (journey.ending?.kind === "refused") {
      reasons.set(
        journey.ending.reason,
        (reasons.get(journey.ending.reason) ?? 0) + 1,
      );
    }
  }
  const why = [...reasons]
    .map(([reason, n]) => (n > 1 ? `${reason} ×${n}` : reason))
    .join(", ");
  const still = journeys.filter((journey) => journey.ending === undefined);
  return `${journeys.length} started: ${count("arrived")} arrived, ${count("refused")} refused${why === "" ? "" : ` (${why})`}, ${count("replaced")} replaced, ${still.length} still travelling`;
}

const hopsWord = (n: number) => `${n} ${n === 1 ? "hop" : "hops"}`;

function endingWords(journey: JourneyRecord): string {
  const { ending } = journey;
  if (ending === undefined) return "still travelling at the end";
  return ending.kind === "refused"
    ? `refused at tick ${ending.tick} (${ending.reason})`
    : `${ending.kind} at tick ${ending.tick}`;
}

/** The journeys, one numbered line each with its hops beneath. `name` gives a god's display name. */
export function renderJourneys(
  journeys: readonly JourneyRecord[],
  name: (god: string) => string,
): string {
  if (journeys.length === 0) return "No god set out on a journey.";
  return journeys
    .flatMap((journey, i) => [
      `${i + 1}. ${name(journey.god)}: ${journey.from ?? "an unknown place"} → ${journey.to}, set out at tick ${journey.startTick}, ${hopsWord(journey.hops.length)}, ${endingWords(journey)}`,
      ...journey.hops.map((hop) =>
        hop.kind === "realm-transitioned"
          ? `   - tick ${hop.tick}: crossed from ${hop.via} to ${hop.to}`
          : `   - tick ${hop.tick}: moved to ${hop.to}`,
      ),
    ])
    .join("\n");
}
