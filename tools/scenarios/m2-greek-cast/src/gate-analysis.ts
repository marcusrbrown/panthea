// What the experience gate judges about the world's own dynamics, from the events
// one episode (or all of them) committed: food prayers and food failures (SC1), a
// wrong between mortals that reaches the victim's patron and has a consequence
// (SC3), a thread between gods over a worshipper's harm or a defection (SC4), and
// each god's own initiative across the episodes (R19, SC5). Pure functions over
// stored events and journaled proposals: nothing is read from the world.

import type { StoredEvent } from "./checks";
import type { RealProposal } from "./real-analysis";
import { percentile } from "./request-timing";

/** The fewest "cannot get food" lines an episode may log: an 80% cut from the 2026-10-05 baseline of about 1,250. */
export const MAX_FOOD_FAILURE_LINES = 250;

export interface GateCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** One episode's committed events and journaled proposals. */
export interface GateEpisode {
  readonly index: number;
  readonly events: readonly StoredEvent[];
  readonly proposals: readonly RealProposal[];
}

const kindOf = (events: readonly StoredEvent[], kind: string) =>
  events.filter((event) => event.kind === kind);

/** The `unmet-need` lines an episode logs for food: what the transcript prints as "cannot get food". */
export function foodFailureLines(events: readonly StoredEvent[]): number {
  return kindOf(events, "unmet-need").filter((e) => e.resource === "food")
    .length;
}

/** Whether a prayer asks for food: its request is help with food (a need, or goods a strike took). */
const isFoodPrayer = (event: StoredEvent): boolean => {
  const request = event.request as
    | { kind?: string; need?: { kind?: string; resource?: string } }
    | undefined;
  return request?.kind === "help" && request.need?.resource === "food";
};

/** SC1, for one episode: food prayers are fewer than half of all prayers, and food failures are at most 250 lines. */
export function foodChecks(events: readonly StoredEvent[]): GateCheck[] {
  const prayers = kindOf(events, "petition-opened");
  const food = prayers.filter(isFoodPrayer).length;
  const lines = foodFailureLines(events);
  return [
    {
      name: "food failure lines",
      ok: lines <= MAX_FOOD_FAILURE_LINES,
      detail: `${lines} "cannot get food" lines (at most ${MAX_FOOD_FAILURE_LINES})`,
    },
    {
      name: "food prayer share",
      ok: prayers.length === 0 || food * 2 < prayers.length,
      detail: `${food} of ${prayers.length} prayers are about food (fewer than half)`,
    },
  ];
}

/** The patron of each mortal as the episode began (authored), moved by every `patron-changed` event up to `before`. */
function patronsAt(
  authored: ReadonlyMap<string, string>,
  events: readonly StoredEvent[],
  before: number,
): Map<string, string> {
  const patrons = new Map(authored);
  for (const event of kindOf(events, "patron-changed")) {
    if (Number(event.sequence) >= before) break;
    patrons.set(String(event.entityId), String(event.to));
  }
  return patrons;
}

/** What a wrong between mortals of different patrons led to, as the events record it. */
export interface WrongChain {
  readonly episode: number;
  readonly wrong: string;
  readonly wrongdoer: string;
  readonly victim: string;
  readonly kind: string;
  readonly victimPatron: string;
  readonly wrongdoerPatron: string;
  /** The prayer the victim made to its patron about it, if one was opened. */
  readonly prayer: string | undefined;
  /** What the wrong led to: `punished` (the patron answered), `revenge`, `defection`, or none. */
  readonly consequences: readonly ("punished" | "revenge" | "defection")[];
}

/** Every wrong between mortals with different patrons in one episode, and what it led to. */
export function crossPatronWrongs(
  episode: GateEpisode,
  authored: ReadonlyMap<string, string>,
): WrongChain[] {
  const { events } = episode;
  return kindOf(events, "wrong").flatMap((wrong) => {
    const patrons = patronsAt(authored, events, Number(wrong.sequence));
    const victim = String(wrong.victim);
    const wrongdoer = String(wrong.entityId);
    const victimPatron = patrons.get(victim);
    const wrongdoerPatron = patrons.get(wrongdoer);
    if (
      victimPatron === undefined ||
      wrongdoerPatron === undefined ||
      victimPatron === wrongdoerPatron
    ) {
      return [];
    }
    const prayer = kindOf(events, "petition-opened").find(
      (p) => p.cause === wrong.id && String(p.god) === victimPatron,
    );
    const consequences: ("punished" | "revenge" | "defection")[] = [];
    if (
      prayer !== undefined &&
      kindOf(events, "petition-answered").some(
        (a) => a.petitionId === prayer.id,
      )
    ) {
      consequences.push("punished");
    }
    if (kindOf(events, "wrong").some((w) => w.revenge === wrong.id)) {
      consequences.push("revenge");
    }
    // A defection follows the recorded provenance: it is this wrong's only if the change cites the wrong's own
    // prayer among the ones its patron left unanswered, not merely because the victim left that patron later.
    if (
      prayer !== undefined &&
      kindOf(events, "patron-changed").some(
        (c) =>
          c.entityId === victim &&
          String(c.from) === victimPatron &&
          Number(c.sequence) > Number(wrong.sequence) &&
          Array.isArray(c.unanswered) &&
          (c.unanswered as unknown[]).includes(prayer.id),
      )
    ) {
      consequences.push("defection");
    }
    return [
      {
        episode: episode.index,
        wrong: String(wrong.id),
        wrongdoer,
        victim,
        kind: String(wrong.wrong),
        victimPatron,
        wrongdoerPatron,
        prayer: prayer === undefined ? undefined : String(prayer.id),
        consequences,
      },
    ];
  });
}

/** SC3, across the episodes: a wrong between mortals with different patrons reached the victim's patron and had a visible consequence. */
export function mortalWrongCheck(
  episodes: readonly GateEpisode[],
  authored: ReadonlyMap<string, string>,
): GateCheck {
  const chains = episodes.flatMap((e) => crossPatronWrongs(e, authored));
  const reached = chains.filter((c) => c.prayer !== undefined);
  const led = reached.filter((c) => c.consequences.length > 0);
  return {
    name: "mortal wrong",
    ok: led.length > 0,
    detail: `${chains.length} wrongs between mortals of different patrons, ${reached.length} prayed to the victim's patron, ${led.length} with a consequence (punishment, revenge, or defection; at least 1)`,
  };
}

/**
 * Demands and contests between gods over a worshipper's harm (SC4): a strike's harm, or a defection. Both parties are
 * gods of the cast, and an offer made on a prayer (a supplication, whose counterparty is the mortal who prayed) is
 * not a demand: terms offered to a mortal are no dispute between gods, as `ownThreads` already holds.
 */
export function godThreadsOverHarm(
  events: readonly StoredEvent[],
  gods: readonly string[],
): StoredEvent[] {
  const isGod = new Set(gods);
  const harms = new Set([
    ...kindOf(events, "mortal-struck").map((e) => e.id),
    ...kindOf(events, "patron-changed").map((e) => e.id),
  ]);
  return [
    ...kindOf(events, "practice-opened").filter(
      (e) =>
        isGod.has(String(e.entityId)) &&
        isGod.has(String(e.counterparty)) &&
        e.petition === undefined &&
        Array.isArray(e.causes) &&
        (e.causes as unknown[]).some((cause) => harms.has(String(cause))),
    ),
    ...kindOf(events, "contest-opened").filter(
      (e) =>
        isGod.has(String(e.entityId)) &&
        isGod.has(String(e.rival)) &&
        harms.has(String(e.cause)),
    ),
  ];
}

/** SC4, across the episodes: at least one demand or contest between gods opened citing a worshipper's harm or a defection. */
export function godThreadOverHarmCheck(
  episodes: readonly GateEpisode[],
  gods: readonly string[],
): GateCheck {
  const threads = episodes.flatMap((e) => godThreadsOverHarm(e.events, gods));
  return {
    name: "god thread over harm or defection",
    ok: threads.length > 0,
    detail: `${threads.length} demands or contests between gods cite a worshipper's harm or a defection (at least 1)`,
  };
}

/** A thread a god opened of its own toward another god: a demand it opened (carrying its terms), or a contest. */
export interface OwnThread {
  readonly episode: number;
  readonly god: string;
  readonly toward: string;
  readonly kind: "demand" | "contest";
  readonly id: string;
}

/** Every demand or contest each god opened toward another god in the episodes. Terms offered to a mortal, and answers to prayers, do not count. */
export function ownThreads(
  episodes: readonly GateEpisode[],
  gods: readonly string[],
): OwnThread[] {
  const isGod = new Set(gods);
  return episodes.flatMap((episode) => [
    ...kindOf(episode.events, "practice-opened").flatMap((e) =>
      isGod.has(String(e.entityId)) &&
      isGod.has(String(e.counterparty)) &&
      e.petition === undefined
        ? [
            {
              episode: episode.index,
              god: String(e.entityId),
              toward: String(e.counterparty),
              kind: "demand" as const,
              id: e.id,
            },
          ]
        : [],
    ),
    ...kindOf(episode.events, "contest-opened").flatMap((e) =>
      isGod.has(String(e.entityId)) && isGod.has(String(e.rival))
        ? [
            {
              episode: episode.index,
              god: String(e.entityId),
              toward: String(e.rival),
              kind: "contest" as const,
              id: e.id,
            },
          ]
        : [],
    ),
  ]);
}

/**
 * R19, across the gate's episodes and not per episode: every god opens at least one thread of its own toward another
 * god. A god that opens one in only one episode meets it. The detail names, for a god that does not, what its turns
 * proposed and the world refused: a rejected demand or contest is logged, never counted.
 */
export function initiativeChecks(
  episodes: readonly GateEpisode[],
  gods: readonly string[],
): GateCheck[] {
  const threads = ownThreads(episodes, gods);
  return gods.map((god) => {
    const opened = threads.filter((t) => t.god === god);
    const rejected = episodes
      .flatMap((e) => e.proposals)
      .filter(
        (p) =>
          p.actor === god &&
          p.kind === "practice" &&
          (p.proposal.move === "demand" || p.proposal.move === "contest") &&
          p.outcome !== "committed",
      );
    const where = [...new Set(opened.map((t) => `episode ${t.episode}`))].join(
      ", ",
    );
    return {
      name: `initiative: ${god}`,
      ok: opened.length > 0,
      detail:
        opened.length > 0
          ? `${opened.length} (${opened.filter((t) => t.kind === "demand").length} demands, ${opened.filter((t) => t.kind === "contest").length} contests; ${where}); answers and terms offered to mortals do not count`
          : `no demand or contest toward another god in any episode (at least 1); ${rejected.length} proposed and not committed${rejected.length === 0 ? "" : ` (${[...new Set(rejected.map((p) => p.reason ?? "no reason"))].join(", ")})`}`,
    };
  });
}

/** The gate's checks across its episodes. */
export function gateChecks(
  episodes: readonly GateEpisode[],
  gods: readonly string[],
  authored: ReadonlyMap<string, string>,
): GateCheck[] {
  return [
    mortalWrongCheck(episodes, authored),
    godThreadOverHarmCheck(episodes, gods),
    ...initiativeChecks(episodes, gods),
  ];
}

// --- What the transcripts report ---------------------------------------------------------------

export interface EpisodeMetrics {
  readonly foodFailureLines: number;
  readonly prayers: number;
  readonly foodPrayers: number;
  /** Trouble events by the god whose domain they were in. */
  readonly troublesByGod: Readonly<Record<string, number>>;
  readonly defections: number;
  readonly wrongs: number;
  readonly crossPatronWrongs: readonly WrongChain[];
  /** Ticks from the event a prayer is about to the prayer's closing, over closed prayers, by closing. */
  readonly causeToAnswer: {
    readonly closed: number;
    readonly medianTicks: number | undefined;
    readonly p95Ticks: number | undefined;
    readonly byOutcome: Readonly<Record<string, number>>;
  };
}

/** The numbers the plan's transcript metrics name, for one episode. */
export function episodeMetrics(
  episode: GateEpisode,
  authored: ReadonlyMap<string, string>,
): EpisodeMetrics {
  const { events } = episode;
  const tickOf = new Map(events.map((e) => [e.id, Number(e.tick)]));
  const troublesByGod: Record<string, number> = {};
  for (const trouble of kindOf(events, "trouble")) {
    const god = String(trouble.god);
    troublesByGod[god] = (troublesByGod[god] ?? 0) + 1;
  }
  const byOutcome: Record<string, number> = {};
  const waits: number[] = [];
  for (const prayer of kindOf(events, "petition-opened")) {
    const closing = events.find(
      (e) =>
        e.petitionId === prayer.id &&
        (e.kind === "petition-answered" ||
          e.kind === "petition-lapsed" ||
          e.kind === "petition-refused"),
    );
    const causeTick = tickOf.get(String(prayer.cause));
    if (closing === undefined || causeTick === undefined) continue;
    const outcome = String(closing.kind).replace("petition-", "");
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;
    waits.push(Number(closing.tick) - causeTick);
  }
  const sorted = [...waits].sort((a, b) => a - b);
  return {
    foodFailureLines: foodFailureLines(events),
    prayers: kindOf(events, "petition-opened").length,
    foodPrayers: kindOf(events, "petition-opened").filter(isFoodPrayer).length,
    troublesByGod,
    defections: kindOf(events, "patron-changed").length,
    wrongs: kindOf(events, "wrong").length,
    crossPatronWrongs: crossPatronWrongs(episode, authored),
    causeToAnswer: {
      closed: waits.length,
      medianTicks: sorted[Math.floor(sorted.length / 2)],
      p95Ticks: percentile(waits, 0.95),
      byOutcome,
    },
  };
}
