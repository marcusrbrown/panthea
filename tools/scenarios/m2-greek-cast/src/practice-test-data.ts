// Constructed episode data for the practice analysis and transcript tests: a
// log with a refused settlement, a no-progress repeat, a successor that is
// sworn and breached with the oath penalty, and two supplications (terms kept,
// terms broken, the broken one punished with a transformation), together with
// the proposals the gods journaled and the prompts they were shown.

import type { RealInput, RealProposal, RealRequest } from "./real-analysis";

type Fields = Record<string, unknown>;

/** A growing event log: each `add` takes the next sequence. */
export class Log {
  readonly events: Fields[] = [];
  private sequence = 0;
  add(kind: string, tick: number, fields: Fields, correlationId = "fixture") {
    this.sequence += 1;
    const event = {
      schemaVersion: 1,
      id: `evt-${tick}-${this.sequence}`,
      sequence: this.sequence,
      simTime: 0,
      tick,
      correlationId,
      causationId: correlationId,
      approximate: false,
      kind,
      ...fields,
    };
    this.events.push(event);
    return event as Fields & { id: string; sequence: number };
  }
  /** `who` is told something by `teller`; returns the report and the belief it formed. */
  told(
    tick: number,
    teller: string,
    who: string,
    content: string,
    claim?: Fields,
  ) {
    const report = this.add("report-told", tick, {
      entityId: teller,
      listenerId: who,
      content,
      ...(claim === undefined ? {} : { claim }),
    });
    const belief = this.add("memory-recorded", tick, {
      memoryKind: "told",
      entityId: who,
      sourceEventId: report.id,
      teller,
      content,
      subjects: [teller],
      salience: 4,
      ...(claim === undefined ? {} : { consequence: claim }),
    });
    return { report, belief };
  }
  /** Both living parties remember how a thread ended, and `feelings` follow from the first memory. */
  remember(
    tick: number,
    ending: Fields & { id: string },
    kind: "practice-moved" | "practice-ended",
    parties: [string, string],
    how: Fields,
    feelings: {
      entityId: string;
      toward: string;
      affinityDelta: number;
      grudgeDelta?: number;
      allied?: boolean;
    }[] = [],
  ) {
    const memories = parties.map((party) =>
      this.add("memory-recorded", tick, {
        memoryKind: "witnessed",
        entityId: party,
        sourceEventId: ending.id,
        eventKind: kind,
        subjects: parties,
        salience: 7,
        ending: how,
      }),
    );
    for (const feeling of feelings) {
      const memory = memories.find((m) => m.entityId === feeling.entityId);
      this.add("relationship-changed", tick, {
        grudgeDelta: 0,
        ...feeling,
        memoryEventId: memory?.id,
      });
    }
    return memories;
  }
}

const term = (
  kind: string,
  party: string,
  place: string,
  deadline: number,
) => ({
  kind,
  party,
  place,
  deadline,
});

/** A prompt the way the harness stores it: scene, an optional digest, and "You remember" with the endings the god holds. */
export function prompt(
  god: string,
  tick: number,
  options: {
    owes?: {
      thread: string;
      other: string;
      words: string;
      deadline: number;
      unperformable?: string;
    };
    here?: string[];
    at?: string;
    remembers?: string[];
    cause?: string;
  } = {},
): string {
  const lines: string[] = [];
  if (options.owes !== undefined) {
    const { thread, other, words, deadline, unperformable } = options.owes;
    lines.push(
      "Your open practices:",
      `- [${thread}] YOU OWE ${other}: ${words}, by tick ${deadline} (${deadline - tick} ticks left). you agreed at tick 22. Cause: ${other} told you of it [evt-1-1].`,
      "  Perform it before the deadline; if you do not, the world records a breach.",
      ...(unperformable === undefined
        ? []
        : [`  UNPERFORMABLE now: ${unperformable}.`]),
    );
  }
  const at = options.at ?? "great-hall";
  lines.push(
    `You are at ${at} [${at}] in the mortal realm, tick ${tick}.`,
    "Here with you:",
    ...(options.here === undefined || options.here.length === 0
      ? ["- no one else"]
      : options.here.map((who) => `- ${who}`)),
    "Buildings here:",
    "- none",
  );
  if (options.remembers !== undefined && options.remembers.length > 0) {
    lines.push(
      "You remember:",
      ...options.remembers.map((line) => `- ${line}`),
    );
  }
  lines.push("What do you do?");
  return `You are ${god}.\n${lines.join("\n")}`;
}

export interface Episode {
  readonly input: RealInput;
  /** The log the input's events were written to, to be continued. */
  readonly log: Log;
  readonly ids: {
    readonly contest: string;
    readonly contestClosing: string;
    readonly refused: string;
    readonly successor: string;
    readonly kept: string;
    readonly broken: string;
    readonly npObservation: string;
    readonly refusedEnding: string;
    readonly breachEnding: string;
  };
}

/** The coherent episode every analysis test starts from. */
export function episode(): Episode {
  const log = new Log();
  const proposals: RealProposal[] = [];
  const requests: RealRequest[] = [];
  let n = 0;
  const propose = (
    actor: string,
    fields: Fields,
    outcome: "committed" | "rejected",
    reason?: string,
  ) => {
    n += 1;
    const proposal: RealProposal = {
      proposalId: `p${n}`,
      actor,
      kind: String(fields.kind),
      observationId: `obs-${n}`,
      proposal: { actor, ...fields },
      outcome,
      ...(reason === undefined ? {} : { reason }),
    };
    proposals.push(proposal);
    return proposal;
  };
  const ask = (god: string, promptText: string, proposal?: RealProposal) => {
    requests.push({
      proposalId: proposal?.proposalId,
      role: god,
      outcome: "intent",
      elapsedMs: 1000,
      promptPayload: promptText,
      steps: [{ mode: "native" }],
    });
  };

  // A refused settlement. Hera was told of Zeus's deed; she demands that he be
  // at the square; Zeus refuses; she is cooled toward him.
  const first = log.told(5, "zeus", "hera", "I burned the agora", {
    effect: "harm",
    agent: "zeus",
  });
  const demand1 = propose(
    "hera",
    {
      kind: "practice",
      move: "demand",
      counterparty: "zeus",
      cause: first.report.id,
      term: {},
    },
    "committed",
  );
  const refused = log.add(
    "practice-opened",
    10,
    {
      entityId: "hera",
      practice: "settlement",
      counterparty: "zeus",
      causes: [first.report.id],
      term: term("be-at", "zeus", "town-square", 40),
      negotiationDeadline: 60,
      counterBudget: 3,
      subject: { agent: "zeus" },
    },
    demand1.observationId,
  );
  ask(
    "hera",
    prompt("hera", 9, { remembers: [`zeus told you: "I burned the agora"`] }),
    demand1,
  );
  const refusal = propose(
    "zeus",
    { kind: "practice", move: "refuse", thread: refused.id },
    "committed",
  );
  const refusedEnding = log.add(
    "practice-moved",
    12,
    { entityId: "zeus", threadId: refused.id, move: "refuse" },
    refusal.observationId,
  );
  log.remember(
    12,
    refusedEnding,
    "practice-moved",
    ["hera", "zeus"],
    { outcome: "refused", agent: "zeus" },
    [{ entityId: "hera", toward: "zeus", affinityDelta: -1 }],
  );
  ask("zeus", prompt("zeus", 11), refusal);

  // Hera repeats the demand; the world rejects it as no-progress and records why.
  const repeat = propose(
    "hera",
    {
      kind: "practice",
      move: "demand",
      counterparty: "zeus",
      cause: first.report.id,
      term: {},
    },
    "rejected",
    "no-progress",
  );
  log.add(
    "practice-refused",
    14,
    {
      entityId: "hera",
      attempted: "demand",
      reason: "no-progress",
      thread: refused.id,
      why: "that was already answered: zeus refused it",
    },
    repeat.observationId,
  );
  ask(
    "hera",
    prompt("hera", 13, {
      remembers: [`zeus refused your offer [${refusedEnding.id}]`],
    }),
    repeat,
  );
  // Told her demand made no progress, Hera takes another tack: she tells him what she thinks of it.
  const tack = propose(
    "hera",
    { kind: "report", listener: "zeus", content: "You will answer for it." },
    "committed",
  );
  log.add(
    "report-told",
    15,
    {
      entityId: "hera",
      listenerId: "zeus",
      content: "You will answer for it.",
    },
    tack.observationId,
  );
  ask(
    "hera",
    prompt("hera", 14, {
      remembers: [`zeus refused your offer [${refusedEnding.id}]`],
    }),
    tack,
  );

  // Zeus tells her something newer. Her demand opens as a linked successor and he swears it.
  const second = log.told(18, "zeus", "hera", "I did it again", {
    effect: "harm",
    agent: "zeus",
    target: "farmer",
  });
  void second;
  const third = log.told(18, "zeus", "hera", "I helped them", {
    effect: "kindness",
    agent: "zeus",
  });
  const demand2 = propose(
    "hera",
    {
      kind: "practice",
      move: "demand",
      counterparty: "zeus",
      cause: third.report.id,
      term: {},
    },
    "committed",
  );
  const successor = log.add(
    "practice-opened",
    20,
    {
      entityId: "hera",
      practice: "settlement",
      counterparty: "zeus",
      causes: [third.report.id],
      term: term("tell-legend", "zeus", "altar", 50),
      negotiationDeadline: 80,
      counterBudget: 3,
      subject: { agent: "zeus" },
      succeeds: refused.id,
    },
    demand2.observationId,
  );
  // Hera's later choice differs from the demand she made before the refusal.
  ask(
    "hera",
    prompt("hera", 19, {
      remembers: [`zeus refused your offer [${refusedEnding.id}]`],
    }),
    demand2,
  );
  const accept = propose(
    "zeus",
    { kind: "practice", move: "accept", thread: successor.id, swear: true },
    "committed",
  );
  log.add(
    "practice-moved",
    21,
    { entityId: "zeus", threadId: successor.id, move: "accept", sworn: true },
    accept.observationId,
  );
  ask("zeus", prompt("zeus", 20), accept);

  // Zeus's turns while the obligation is open: he moves toward the altar, waits
  // with no mortal there to hear a legend, then lets time run.
  const owes = (tick: number, unperformable?: string) => ({
    thread: successor.id,
    other: "hera",
    words: "you must tell a legend to the mortals at altar",
    deadline: 50,
    tick,
    ...(unperformable === undefined ? {} : { unperformable }),
  });
  const walk = propose("zeus", { kind: "travel", to: "altar" }, "committed");
  log.add(
    "entity-moved",
    23,
    { entityId: "zeus", from: "town-square", to: "altar" },
    walk.observationId,
  );
  ask(
    "zeus",
    prompt("zeus", 22, { owes: owes(22), at: "town-square", here: ["farmer"] }),
    walk,
  );
  ask("zeus", prompt("zeus", 30, { owes: owes(30), at: "altar", here: [] }));
  const idle = propose(
    "zeus",
    { kind: "report", listener: "hera", content: "Elsewhere" },
    "committed",
  );
  ask(
    "zeus",
    prompt("zeus", 40, { owes: owes(40), at: "altar", here: ["farmer"] }),
    idle,
  );
  log.add(
    "report-told",
    41,
    { entityId: "zeus", listenerId: "hera", content: "Elsewhere" },
    idle.observationId,
  );

  // The deadline passes: breached, the oath penalty, and what each remembers.
  const breach = log.add("practice-ended", 51, {
    entityId: "hera",
    counterparty: "zeus",
    threadId: successor.id,
    outcome: "breached",
    reason: "obligation-deadline",
  });
  log.add("motif-applied", 51, {
    entityId: "zeus",
    motif: "oath-penalty",
    threadId: successor.id,
    cause: breach.id,
    effect: "oath-penalty",
    divinityLost: 3,
    capability: "divine",
    accessRestoredAt: 151,
  });
  log.remember(
    51,
    breach,
    "practice-ended",
    ["hera", "zeus"],
    { outcome: "breached", agent: "zeus", sworn: true },
    [{ entityId: "hera", toward: "zeus", affinityDelta: -2, grudgeDelta: 1 }],
  );
  const later = propose(
    "hera",
    { kind: "report", listener: "zeus", content: "You broke your oath" },
    "committed",
  );
  log.add(
    "report-told",
    53,
    { entityId: "hera", listenerId: "zeus", content: "You broke your oath" },
    later.observationId,
  );
  ask(
    "hera",
    prompt("hera", 52, {
      remembers: [`zeus breached the sworn term to you [${breach.id}]`],
    }),
    later,
  );
  const zeusLater = propose("zeus", { kind: "wait" }, "committed");
  void zeusLater;
  const zeusAction = propose(
    "zeus",
    { kind: "legend", assertion: "I regret it" },
    "committed",
  );
  log.add(
    "legend-recorded",
    55,
    { entityId: "zeus", assertion: "I regret it", hearers: [] },
    zeusAction.observationId,
  );
  ask(
    "zeus",
    prompt("zeus", 54, {
      remembers: [`you breached the sworn term to hera [${breach.id}]`],
    }),
    zeusAction,
  );

  // Supplication: the farmer's terms kept.
  const spoiled = log.add("stock-spoiled", 60, {
    entityId: "farmer",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  const prayer = log.add("petition-opened", 61, {
    entityId: "farmer",
    god: "hera",
    cause: spoiled.id,
    request: {
      kind: "help",
      need: { kind: "resource", resource: "food", amount: 1 },
    },
  });
  const offer1 = propose(
    "hera",
    { kind: "practice", move: "offer", petition: prayer.id, term: {} },
    "committed",
  );
  const kept = log.add(
    "practice-opened",
    62,
    {
      entityId: "hera",
      practice: "supplication",
      counterparty: "farmer",
      causes: [spoiled.id],
      petition: prayer.id,
      term: {
        kind: "make-offering",
        party: "farmer",
        to: "hera",
        resource: "wood",
        amount: 1,
        deadline: 90,
      },
      negotiationDeadline: 120,
      counterBudget: 0,
    },
    offer1.observationId,
  );
  ask("hera", prompt("hera", 61), offer1);
  log.add(
    "practice-moved",
    63,
    { entityId: "farmer", threadId: kept.id, move: "accept", sworn: false },
    "routine",
  );
  const blessing = log.add("blessing-granted", 66, {
    entityId: "hera",
    recipient: "farmer",
    petitionId: prayer.id,
    resource: "food",
    amount: 1,
  });
  log.add("practice-progressed", 66, {
    entityId: "hera",
    counterparty: "farmer",
    threadId: kept.id,
    step: "boon",
    by: blessing.id,
  });
  const worship = log.add("worship-performed", 68, {
    entityId: "farmer",
    deity: "hera",
    offering: { resource: "wood", amount: 1 },
    favorEffect: "x",
    favorExpiresAtTick: 200,
  });
  const keptEnd = log.add("practice-ended", 68, {
    entityId: "hera",
    counterparty: "farmer",
    threadId: kept.id,
    outcome: "fulfilled",
    reason: "performed",
    performedBy: worship.id,
  });
  log.remember(
    68,
    keptEnd,
    "practice-ended",
    ["hera", "farmer"],
    { outcome: "fulfilled", agent: "farmer" },
    [{ entityId: "hera", toward: "farmer", affinityDelta: 1 }],
  );

  // Supplication: the woodcutter takes the boon and offers nothing; the stake applies.
  const lost = log.add("stock-spoiled", 70, {
    entityId: "woodcutter",
    resource: "food",
    amount: 1,
    cause: "director",
  });
  const prayer2 = log.add("petition-opened", 71, {
    entityId: "woodcutter",
    god: "zeus",
    cause: lost.id,
    request: {
      kind: "help",
      need: { kind: "resource", resource: "food", amount: 1 },
    },
  });
  const offer2 = propose(
    "zeus",
    {
      kind: "practice",
      move: "offer",
      petition: prayer2.id,
      term: {},
      stake: "wolf",
    },
    "committed",
  );
  const broken = log.add(
    "practice-opened",
    72,
    {
      entityId: "zeus",
      practice: "supplication",
      counterparty: "woodcutter",
      causes: [lost.id],
      petition: prayer2.id,
      term: {
        kind: "make-offering",
        party: "woodcutter",
        to: "zeus",
        resource: "currency",
        amount: 2,
        deadline: 100,
      },
      negotiationDeadline: 130,
      counterBudget: 0,
      stake: {
        form: "wolf",
        capabilitiesGained: ["beast"],
        capabilitiesLost: [],
      },
    },
    offer2.observationId,
  );
  ask("zeus", prompt("zeus", 71), offer2);
  log.add(
    "practice-moved",
    73,
    {
      entityId: "woodcutter",
      threadId: broken.id,
      move: "accept",
      sworn: false,
    },
    "routine",
  );
  const boon2 = log.add("blessing-granted", 76, {
    entityId: "zeus",
    recipient: "woodcutter",
    petitionId: prayer2.id,
    resource: "food",
    amount: 1,
  });
  log.add("practice-progressed", 76, {
    entityId: "zeus",
    counterparty: "woodcutter",
    threadId: broken.id,
    step: "boon",
    by: boon2.id,
  });
  const brokenEnd = log.add("practice-ended", 101, {
    entityId: "zeus",
    counterparty: "woodcutter",
    threadId: broken.id,
    outcome: "breached",
    reason: "obligation-deadline",
  });
  log.add("motif-applied", 101, {
    entityId: "woodcutter",
    motif: "transformation-punishment",
    threadId: broken.id,
    cause: brokenEnd.id,
    effect: "transformation",
    intent: "punishment",
    form: "wolf",
    capabilitiesGained: ["beast"],
    capabilitiesLost: [],
  });
  log.remember(
    101,
    brokenEnd,
    "practice-ended",
    ["zeus", "woodcutter"],
    { outcome: "breached", agent: "woodcutter" },
    [{ entityId: "zeus", toward: "woodcutter", affinityDelta: -1 }],
  );

  // A contest for favour. Poseidon tells a legend before the fishers at the dock; Athena, who heard it, opens
  // a contest over it, out-tells him, and wins: her standing there rises and his falls, each citing the closing.
  const rival = log.add("legend-recorded", 110, {
    entityId: "poseidon",
    assertion: "The sea feeds the dock.",
    hearers: ["fisher-kallias", "fisher-melina", "athena"],
  });
  const contest = log.add("contest-opened", 112, {
    entityId: "athena",
    rival: "poseidon",
    place: "ferry-dock",
    cause: rival.id,
    closesAt: 140,
  });
  log.add("legend-recorded", 120, {
    entityId: "athena",
    assertion: "The olive feeds the dock better.",
    hearers: ["fisher-kallias", "fisher-melina", "poseidon"],
  });
  const closed = log.add("contest-closed", 140, {
    entityId: "athena",
    rival: "poseidon",
    place: "ferry-dock",
    contestId: contest.id,
    result: "decided",
    reason: "window",
    winner: "athena",
    favoured: [
      { mortal: "fisher-kallias", god: "athena" },
      { mortal: "fisher-melina", god: "athena" },
    ],
  });
  log.add("motif-applied", 140, {
    entityId: "athena",
    motif: "standing-won",
    threadId: contest.id,
    cause: closed.id,
    effect: "standing",
    place: "ferry-dock",
    delta: 1,
  });
  log.add("motif-applied", 140, {
    entityId: "poseidon",
    motif: "standing-lost",
    threadId: contest.id,
    cause: closed.id,
    effect: "standing",
    place: "ferry-dock",
    delta: -1,
  });

  return {
    log,
    input: {
      requests,
      proposals,
      events: log.events as unknown as RealInput["events"],
      polls: { total: 10, degraded: 0 },
    },
    ids: {
      contest: contest.id,
      contestClosing: closed.id,
      refused: refused.id,
      successor: successor.id,
      kept: kept.id,
      broken: broken.id,
      npObservation: repeat.observationId,
      refusedEnding: refusedEnding.id,
      breachEnding: breach.id,
    },
  };
}

/** The seven gods of the authored cast. */
export const CAST = [
  "athena",
  "hades",
  "hephaestus",
  "hera",
  "hermes",
  "poseidon",
  "zeus",
] as const;

export interface FullCast {
  readonly input: RealInput;
  readonly ids: Episode["ids"] & {
    /** The alliance thread, and the event that ended it sealed. */
    readonly alliance: string;
    readonly sealing: string;
    /** Hermes's demand of Hades, which Hades refused. */
    readonly hadesRefused: string;
  };
}

/**
 * The coherent episode, carried on to the full cast: journeys by four gods;
 * Hephaestus walks to the dock, tells Hermes of a kindness, and Hermes asks him
 * for an alliance, which he accepts and the world seals, so each of the two
 * becomes allied with the other; Hades walks to the dock and tells Hermes
 * something, and Hermes demands of him in turn, which Hades refuses.
 */
export function fullCast(): FullCast {
  const base = episode();
  const { log } = base;
  for (const [god, to] of [
    ["zeus", "town-square"],
    ["hera", "town-square"],
  ] as const) {
    log.add("journey-started", 149, { entityId: god, to });
  }

  // Hephaestus walks to the dock, tells Hermes of a kindness, and Hermes asks him for an alliance.
  log.add("journey-started", 150, {
    entityId: "hephaestus",
    to: "ferry-dock",
  });
  const oars = log.told(
    155,
    "hephaestus",
    "hermes",
    "I forged the ferryman's oars",
    {
      effect: "kindness",
      agent: "hephaestus",
    },
  );
  const alliance = log.add("practice-opened", 156, {
    entityId: "hermes",
    practice: "settlement",
    counterparty: "hephaestus",
    causes: [oars.report.id],
    term: {
      kind: "ally",
      party: "hephaestus",
      to: "hermes",
      deadline: 206,
    },
    negotiationDeadline: 216,
    counterBudget: 3,
    subject: { agent: "hephaestus" },
  });
  log.add("practice-moved", 157, {
    entityId: "hephaestus",
    threadId: alliance.id,
    move: "accept",
    sworn: false,
  });
  const sealing = log.add("practice-ended", 157, {
    entityId: "hermes",
    counterparty: "hephaestus",
    threadId: alliance.id,
    outcome: "fulfilled",
    reason: "sealed",
  });
  log.remember(
    157,
    sealing,
    "practice-ended",
    ["hermes", "hephaestus"],
    { outcome: "fulfilled", sealed: true },
    [
      {
        entityId: "hermes",
        toward: "hephaestus",
        affinityDelta: 0,
        allied: true,
      },
      {
        entityId: "hephaestus",
        toward: "hermes",
        affinityDelta: 0,
        allied: true,
      },
    ],
  );

  // Hades walks to the dock and tells Hermes something; Hermes demands of him, and he refuses.
  log.add("journey-started", 160, { entityId: "hades", to: "ferry-dock" });
  const decree = log.told(
    162,
    "hades",
    "hermes",
    "No shade leaves my halls unpaid for",
    { effect: "kindness", agent: "hades" },
  );
  const demanded = log.add("practice-opened", 163, {
    entityId: "hermes",
    practice: "settlement",
    counterparty: "hades",
    causes: [decree.report.id],
    term: term("be-at", "hades", "town-square", 203),
    negotiationDeadline: 223,
    counterBudget: 3,
    subject: { agent: "hades" },
  });
  const no = log.add("practice-moved", 164, {
    entityId: "hades",
    threadId: demanded.id,
    move: "refuse",
  });
  log.remember(
    164,
    no,
    "practice-moved",
    ["hermes", "hades"],
    { outcome: "refused", agent: "hades" },
    [{ entityId: "hermes", toward: "hades", affinityDelta: -1 }],
  );

  return {
    input: {
      ...base.input,
      events: log.events as unknown as RealInput["events"],
    },
    ids: {
      ...base.ids,
      alliance: alliance.id,
      sealing: sealing.id,
      hadesRefused: demanded.id,
    },
  };
}
