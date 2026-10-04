// A god that set terms on a prayer, and whose terms the mortal accepted, owes the
// boon. The prompt says so (a YOU OWE row, which a digest never cuts), leads with
// the next concrete step as an object the model can copy (a bless when it is with
// the mortal, else the next hop toward them), shows no new bargain to begin while
// the boon is owed, and reads the prayer as agreed, not as a favour to do freely.
// Every object shown parses and commits: nothing is offered the parser or the
// world would refuse. The world is real (the authored Greek pack, real ticks, the
// real validator).

import { expect, test } from "bun:test";
import type { EventId, WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  createPrng,
  getActor,
  isThreadOpen,
  nextHop,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
  withActor,
} from "@panthea/world";
import {
  buildGodContext,
  godAvailableActions,
  godIntentSchema,
  rememberedBy,
} from "./context";
import { buildModelProposal } from "./observation";
import {
  describeDigest,
  PRACTICES_HEADING,
  type ThreadView,
} from "./practices";
import { godProfile, greekState, withoutFireSpread } from "./test-fixtures";

const id = toEntityId;

class Run {
  state: WorldState = withoutFireSpread(greekState());
  readonly events: WorldEvent[] = [];
  private n = 0;
  apply(overrides: Record<string, unknown>): WorldEvent {
    this.n += 1;
    const event = {
      schemaVersion: 1,
      id: `evt-${this.state.tick}-${900 + this.n}`,
      sequence: this.state.lastSequence + 1,
      simTime: 0,
      tick: this.state.tick,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      ...overrides,
    } as unknown as WorldEvent;
    this.state = applyEvent(this.state, event);
    this.events.push(event);
    return event;
  }
  tick(...raws: Record<string, unknown>[]) {
    const proposals = raws.map((raw) => {
      this.n += 1;
      const submitted = submitProposal({
        schemaVersion: 1,
        targets: [],
        expectedRevisions: [],
        source: "fixture",
        observationId: `obs-bo-${this.n}`,
        ...raw,
      });
      if (!submitted.ok) throw new Error(submitted.rejection.message);
      return submitted.proposal;
    });
    const result = runTick(this.state, createPrng(1), proposals);
    this.state = result.state;
    this.events.push(...result.events);
    return result;
  }
  prays(mortal = "farmer", god = "zeus"): EventId {
    const cause = this.apply({
      kind: "stock-spoiled",
      entityId: mortal,
      resource: "food",
      amount: 1,
      cause: "director",
    });
    return this.apply({
      kind: "petition-opened",
      entityId: mortal,
      god,
      cause: cause.id,
      request: {
        kind: "help",
        need: { kind: "resource", resource: "food", amount: 1 },
      },
    }).id as EventId;
  }
  /** `mortal` prays to `god` to punish the owner of `buildings`: a real theft, a real punish petition. */
  prayPunish(
    mortal = "farmer",
    god = "zeus",
    buildings = ["woodshed"],
  ): EventId {
    const theft = this.apply({
      kind: "theft",
      entityId: "woodcutter",
      victim: mortal,
      resource: "currency",
      amount: 1,
      cause: "director",
    });
    return this.apply({
      kind: "petition-opened",
      entityId: mortal,
      god,
      cause: theft.id,
      request: { kind: "punish", offender: "woodcutter", buildings },
    }).id as EventId;
  }
  place(who: string, where: string) {
    const actor = getActor(this.state, id(who));
    if (!actor) throw new Error(who);
    this.state = withActor(this.state, { ...actor, locationId: id(where) });
  }
  latest() {
    const thread = [...this.state.threads.values()].at(-1);
    if (!thread) throw new Error("no thread");
    return thread;
  }
  view(god: string) {
    const snapshot = perceive(this.state, id(god), this.events);
    if (!snapshot) throw new Error("no snapshot");
    const remembered = rememberedBy(this.state, id(god));
    const profile = godProfile(god);
    return {
      snapshot,
      remembered,
      context: buildGodContext(profile, snapshot, remembered),
      schema: godIntentSchema(profile, snapshot, remembered),
      actions: godAvailableActions(profile, snapshot, remembered),
    };
  }
  /** Zeus offers terms on `petition` and `mortal` accepts: the boon is now owed. */
  agreed(petition: EventId, mortal = "farmer") {
    this.tick({
      actor: "zeus",
      kind: "practice",
      move: "offer",
      petition,
      term: {
        kind: "make-offering",
        party: mortal,
        to: "zeus",
        resource: "currency",
        amount: 1,
        deadlineTicks: 80,
      },
    });
    const thread = this.latest();
    this.tick({
      actor: mortal,
      kind: "practice",
      move: "accept",
      thread: thread.id,
      source: "routine",
    });
    expect(this.latest().status).toBe("accepted");
    return this.latest();
  }
}

const digestOf = (prompt: string) => {
  const lines = prompt.split("\n");
  const start = lines.indexOf(PRACTICES_HEADING);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => !l.startsWith("- ") && !l.startsWith("  "));
  return [PRACTICES_HEADING, ...rest.slice(0, end < 0 ? rest.length : end)];
};

const prayerEntry = (prompt: string, petition: string) => {
  const lines = prompt.split("\n");
  const at = lines.findIndex((l) => l.startsWith(`- [${petition}]`));
  if (at < 0) return "";
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => !l.startsWith("  "));
  return [lines[at], ...rest.slice(0, end < 0 ? rest.length : end)].join("\n");
};

test("an accepted remote supplication puts YOU OWE first, naming the mortal, the prayer, and the deadline, with the first hop toward the mortal as an object to copy", () => {
  const run = new Run();
  const petition = run.prays();
  const thread = run.agreed(petition);
  const zeus = getActor(run.state, id("zeus"));
  const farmer = getActor(run.state, id("farmer"));
  if (!zeus || !farmer) throw new Error("actors");
  expect(zeus.locationId).not.toBe(farmer.locationId);
  const hop = nextHop(
    run.state,
    zeus.locationId,
    farmer.locationId,
    zeus.capabilities,
  );
  if (hop === undefined) throw new Error("no route");

  const { context } = run.view("zeus");
  const digest = digestOf(context.prompt);
  // The owed boon leads the digest.
  expect(digest[0]).toBe(PRACTICES_HEADING);
  expect(digest[1]).toContain(`[${thread.id}] YOU OWE farmer`);
  expect(digest[1]).toContain(`your boon on its prayer [${petition}]`);
  expect(digest[1]).toContain(`by tick ${thread.term.deadline}`);
  const row = digest.join("\n");
  expect(row).toContain("is not here");
  expect(row).toContain(`{"action":"move","to":"${hop}"}`);
  // Not a bless object yet: it would be refused until the god is with the mortal.
  expect(row).not.toContain('"action":"bless"');
  // Not the old wording, which said it was the mortal's thread.
  expect(row).not.toContain("ACCEPTED your terms");
  expect(row).not.toContain("still owed (answer the prayer");
});

test("the hop shown parses against the schema and commits in the world: a first step the world takes", () => {
  const run = new Run();
  const petition = run.prays();
  run.agreed(petition);
  const { context, schema, snapshot, remembered } = run.view("zeus");
  const shown = /\{"action":"(move|realm-transition)","to":"([^"]+)"\}/.exec(
    digestOf(context.prompt).join("\n"),
  );
  expect(shown).not.toBeNull();
  const intent = { action: shown?.[1], to: shown?.[2] };
  const parsed = schema.parse(intent);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  const ran = run.tick(built.proposal as never);
  expect(ran.rejected).toEqual([]);
  expect(String(getActor(run.state, id("zeus"))?.locationId)).toBe(
    String(shown?.[2]),
  );
});

test("a co-located one shows the bless object, and it parses, builds, and commits: the boon is given and the thread sees it", () => {
  const run = new Run();
  const petition = run.prays();
  const thread = run.agreed(petition);
  run.place("farmer", String(getActor(run.state, id("zeus"))?.locationId));
  const { context, schema, snapshot, remembered } = run.view("zeus");
  const row = digestOf(context.prompt).join("\n");
  expect(row).toContain(`[${thread.id}] YOU OWE farmer`);
  expect(row).toContain("farmer is here");
  const bless = { action: "bless", petition };
  expect(row).toContain(JSON.stringify(bless));
  expect(row).not.toContain("is not here");

  const parsed = schema.parse(bless);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  const ran = run.tick(built.proposal as never);
  expect(ran.rejected).toEqual([]);
  expect(ran.events.some((e) => e.kind === "blessing-granted")).toBe(true);
  expect(run.state.threads.get(thread.id)?.progress?.boon).toBeDefined();
});

test("nothing is shown that the parser or the world would refuse: with too little divinity to bless, the row says so and shows no bless object", () => {
  const run = new Run();
  const petition = run.prays();
  const thread = run.agreed(petition);
  run.place("farmer", String(getActor(run.state, id("zeus"))?.locationId));
  const zeus = getActor(run.state, id("zeus"));
  if (!zeus) throw new Error("zeus");
  run.state = withActor(run.state, {
    ...zeus,
    inventory: new Map(zeus.inventory).set("divinity", 0),
  });
  const { context, schema } = run.view("zeus");
  const row = digestOf(context.prompt).join("\n");
  expect(row).toContain(`[${thread.id}] YOU OWE farmer`);
  expect(row).not.toContain('"action":"bless"');
  expect(row).toContain("divinity");
  expect(schema.parse({ action: "bless", petition }).ok).toBe(false);
});

test("while a boon is owed no new bargain is shown to begin: no demand, no offer on another prayer, no rival act to contest; the other actions stay available", () => {
  const run = new Run();
  const owed = run.prays("farmer", "zeus");
  run.agreed(owed);
  const other = run.prays("woodcutter", "zeus");
  const { context, remembered, actions, schema } = run.view("zeus");
  const text = `${context.instructions}\n${context.prompt}`;
  expect(text).not.toContain("You may begin a bargain");
  expect(remembered.practice.openings).toEqual([]);
  // The second prayer's entry offers no terms to set.
  const entry = prayerEntry(context.prompt, other);
  expect(entry).toContain(`[${other}]`);
  expect(entry).not.toContain("set terms");
  expect(entry).not.toContain('"move":"offer"');
  // Allowed, not suggested: the actions are all still there.
  expect(actions).toContain("wait");
  expect(actions).toContain("practice");
  expect(schema.parse({ action: "wait" }).ok).toBe(true);

  // Control: with no boon owed, the second prayer does show the terms it may be answered with.
  const free = new Run();
  const only = free.prays("woodcutter", "zeus");
  const entryFree = prayerEntry(free.view("zeus").context.prompt, only);
  expect(entryFree).toContain("set terms");
  expect(entryFree).toContain('"move":"offer"');
});

test("control: once the boon is given, the obligation and the suppression go away; once the thread has ended, so do they", () => {
  const run = new Run();
  const petition = run.prays();
  const thread = run.agreed(petition);
  const mortalPlace = String(getActor(run.state, id("zeus"))?.locationId);
  run.place("farmer", mortalPlace);
  expect(digestOf(run.view("zeus").context.prompt).join("\n")).toContain(
    "YOU OWE farmer",
  );
  // Zeus gives the boon.
  run.tick({ actor: "zeus", kind: "bless", petition });
  expect(run.state.threads.get(thread.id)?.progress?.boon).toBeDefined();
  const after = digestOf(run.view("zeus").context.prompt).join("\n");
  expect(after).not.toContain("YOU OWE");
  expect(after).toContain("Boon: given");
  expect(after).toContain("Offering: still owed");

  // A thread that ended (the world expired it) owes nothing and suppresses nothing.
  const ended = new Run();
  const p2 = ended.prays();
  const t2 = ended.agreed(p2);
  for (
    let n = 0;
    n < 200 && isThreadOpen(ended.state.threads.get(t2.id) ?? t2);
    n += 1
  ) {
    ended.tick();
  }
  expect(isThreadOpen(ended.state.threads.get(t2.id) ?? t2)).toBe(false);
  const done = ended.view("zeus");
  expect(`${done.context.prompt}`).not.toContain("YOU OWE");
  expect(digestOf(done.context.prompt).join("\n")).not.toContain("your boon");
});

test("the prayer's own entry reads as agreed and owed when its terms were accepted, not as a favour to do freely; an unagreed prayer is unchanged", () => {
  const run = new Run();
  const petition = run.prays();
  const before = prayerEntry(run.view("zeus").context.prompt, petition);
  expect(before).toContain("help freely");
  run.agreed(petition);
  const entry = prayerEntry(run.view("zeus").context.prompt, petition);
  expect(entry).toContain(`[${petition}]`);
  expect(entry).toContain("You agreed terms on this prayer");
  expect(entry).toContain("owe");
  expect(entry).not.toContain("help freely");
  expect(entry).not.toContain("if you choose this");
  expect(entry).not.toContain("set terms");
});

test("a crowded digest keeps the owed row: it is never cut, whatever else is open and however little room is left", () => {
  const run = new Run();
  const petition = run.prays();
  run.agreed(petition);
  const { remembered } = run.view("zeus");
  const owed = remembered.threads.find((view) => view.owedBoon !== undefined);
  if (!owed) throw new Error("no owed view");
  expect(owed.standing).toBe("obligation");
  // Twenty more open threads of every sort and a budget that cannot hold even one full row.
  const crowd: ThreadView[] = Array.from({ length: 20 }, (_, n) => ({
    ...owed,
    id: `evt-0-${n}` as EventId,
    standing: n % 2 === 0 ? "other" : "awaiting",
    owedBoon: undefined,
    supplication: undefined,
    moves: ["accept", "refuse"],
    intents: {},
    term: { ...owed.term, party: id("zeus") },
  }));
  for (const budget of [1600, 400, 50, 0]) {
    const lines = describeDigest([...crowd, owed], undefined, [], budget);
    expect(lines.join("\n")).toContain(`[${owed.id}] YOU OWE farmer`);
    expect(lines.join("\n")).toContain(`[${petition}]`);
  }
  // Leading, too: the obligation sorts before the rest in the view list the digest is given.
  expect(remembered.threads[0]?.id).toBe(owed.id);
});

test("an owed boon is private to its god: no other god's prompt carries the thread, the prayer, or the mortal's agreement", () => {
  const run = new Run();
  const petition = run.prays();
  const thread = run.agreed(petition);
  const hera = run.view("hera");
  const text = `${hera.context.instructions}\n${hera.context.prompt}\n${JSON.stringify(hera.schema.jsonSchema)}`;
  expect(text).not.toContain(thread.id);
  expect(text).not.toContain(petition);
  expect(text).not.toContain("your boon");
});

test("prompt size for a god that owes one boon, against the same god with the terms accepted shown the old way", () => {
  const run = new Run();
  const petition = run.prays();
  const open = new Run();
  open.prays();
  const unagreed = run.view("zeus").context;
  run.agreed(petition);
  const owed = run.view("zeus").context;
  const size = (c: { instructions?: string; prompt: string }) =>
    (c.instructions?.length ?? 0) + c.prompt.length;
  console.log(
    `BOON_OWED_SIZE unagreed ${size(unagreed)} owed ${size(owed)} delta ${size(owed) - size(unagreed)}`,
  );
  expect(size(owed)).toBeLessThan(size(unagreed) + 700);
});

// --- A punish prayer's boon is a strike ---------------------------------------------------------------

test("an accepted punish supplication with the god away from the building shows the hop toward it, as an object that parses and commits; no bless is shown for a prayer a bless does not answer", () => {
  const run = new Run();
  const petition = run.prayPunish();
  const thread = run.agreed(petition);
  const zeus = getActor(run.state, id("zeus"));
  const shed = run.state.buildings.get(id("woodshed"));
  if (!zeus || !shed) throw new Error("fixture");
  expect(zeus.locationId).not.toBe(shed.locationId);
  const hop = nextHop(
    run.state,
    zeus.locationId,
    shed.locationId,
    zeus.capabilities,
  );
  if (hop === undefined) throw new Error("no route");

  const { context, schema, snapshot, remembered } = run.view("zeus");
  const digest = digestOf(context.prompt);
  expect(digest[1]).toContain(`[${thread.id}] YOU OWE farmer`);
  expect(digest[1]).toContain(`your boon on its prayer [${petition}]`);
  const row = digest.join("\n");
  expect(row).toContain("woodshed");
  expect(row).toContain(`{"action":"move","to":"${hop}"}`);
  expect(row).not.toContain('"action":"bless"');
  expect(row).not.toContain("answered as it asks");
  expect(row).not.toContain("You cannot give it now");

  const parsed = schema.parse({ action: "move", to: hop });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  expect(run.tick(built.proposal as never).rejected).toEqual([]);
  expect(String(getActor(run.state, id("zeus"))?.locationId)).toBe(String(hop));
});

test("with the god at the building the row shows the strike, whole: it parses, builds, and commits, and the world sees the boon", () => {
  const run = new Run();
  const petition = run.prayPunish();
  const thread = run.agreed(petition);
  run.place(
    "zeus",
    String(run.state.buildings.get(id("woodshed"))?.locationId),
  );
  const { context, schema, snapshot, remembered } = run.view("zeus");
  const row = digestOf(context.prompt).join("\n");
  expect(row).toContain(`[${thread.id}] YOU OWE farmer`);
  expect(row).toContain("[woodshed] is here");
  const strike = { action: "strike", target: "woodshed", power: 1 };
  expect(row).toContain(JSON.stringify(strike));
  expect(row).not.toContain('"action":"bless"');

  const parsed = schema.parse(strike);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const built = buildModelProposal(
    id("zeus"),
    snapshot,
    parsed.value,
    remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  const ran = run.tick(built.proposal as never);
  expect(ran.rejected).toEqual([]);
  expect(
    ran.events.some(
      (e) => e.kind === "building-damaged" || e.kind === "building-ignited",
    ),
  ).toBe(true);
  expect(run.state.threads.get(thread.id)?.progress?.boon).toBeDefined();
});

test("control: a punish boon the world would not take shows its reason and no object: too little divinity, a building that cannot be struck, a prayer no longer open", () => {
  const owedRow = (change: (run: Run) => void) => {
    const run = new Run();
    const petition = run.prayPunish();
    run.agreed(petition);
    change(run);
    const view = run.view("zeus");
    return {
      row: digestOf(view.context.prompt).join("\n"),
      schema: view.schema,
    };
  };
  const here = (run: Run) =>
    run.place(
      "zeus",
      String(run.state.buildings.get(id("woodshed"))?.locationId),
    );
  const noObject = (row: string) => {
    expect(row).toContain("YOU OWE farmer");
    expect(row).not.toContain('"action":"strike"');
    expect(row).not.toContain('"action":"move"');
    expect(row).toContain("You cannot give it now");
  };

  const poor = owedRow((run) => {
    here(run);
    const zeus = getActor(run.state, id("zeus"));
    if (!zeus) throw new Error("zeus");
    run.state = withActor(run.state, {
      ...zeus,
      inventory: new Map(zeus.inventory).set("divinity", 0),
    });
  });
  noObject(poor.row);
  expect(poor.row).toContain("divinity");

  const burned = owedRow((run) => {
    here(run);
    const shed = run.state.buildings.get(id("woodshed"));
    if (!shed) throw new Error("shed");
    run.state = {
      ...run.state,
      buildings: new Map(run.state.buildings).set(shed.id, {
        ...shed,
        status: "destroyed",
      } as never),
    };
  });
  noObject(burned.row);
  expect(burned.row).toContain("woodshed");

  const closed = owedRow((run) => {
    here(run);
    const prayer = [...run.state.petitions.values()].at(-1);
    if (!prayer) throw new Error("prayer");
    run.state = {
      ...run.state,
      petitions: new Map(run.state.petitions).set(prayer.id, {
        ...prayer,
        status: "answered",
      }),
    };
  });
  noObject(closed.row);
  expect(closed.row).toContain("no longer open");
});

// --- A compact owed row keeps its step -------------------------------------------------------------------

/** Four help supplications Zeus set terms on, each accepted: four boons owed at once. */
function fourOwed() {
  const run = new Run();
  const mortals = [...run.state.actors.values()]
    .filter(
      (actor) =>
        actor.alive &&
        !actor.isDeity &&
        (actor.inventory.get("currency") ?? 0) >= 1 &&
        actor.locationId !== getActor(run.state, id("zeus"))?.locationId,
    )
    .slice(0, 4)
    .map((actor) => String(actor.id));
  expect(mortals).toHaveLength(4);
  const threads = mortals.map((mortal) => {
    const petition = run.prays(mortal, "zeus");
    return { mortal, petition, thread: run.agreed(petition, mortal) };
  });
  return { run, threads };
}

test("with four boons owed, every owed row carries its one step or its obstacle, whether the digest shows it whole or compacts it, and the step parses", () => {
  const { run, threads } = fourOwed();
  const { context, schema, remembered } = run.view("zeus");
  const check = (digest: readonly string[], compacted: boolean) => {
    const rows: string[] = [];
    for (const [at, line] of digest.entries()) {
      if (!line.includes("YOU OWE")) continue;
      let end = at + 1;
      while (end < digest.length && (digest[end] ?? "").startsWith("  "))
        end += 1;
      rows.push(digest.slice(at, end).join("\n"));
    }
    expect(rows).toHaveLength(4);
    // A compacted row is one line, with no cause text.
    expect(rows.some((row) => !row.includes("\n"))).toBe(compacted);
    expect(rows.some((row) => row.includes("\n"))).toBe(true);
    for (const [n, row] of rows.entries()) {
      expect(row).toContain(
        `your boon on its prayer [${threads[n]?.petition}]`,
      );
      const step = /(\{"action":"[^}]*\})/.exec(row);
      const obstacle = /Cannot now: |You cannot give it now: /.test(row);
      expect(step !== null || obstacle).toBe(true);
      if (step !== null) {
        expect(schema.parse(JSON.parse(step[1] as string)).ok).toBe(true);
      }
    }
  };
  // The default budget, as the prompt builds it: it already holds two whole rows and compacts the other two.
  check(digestOf(context.prompt), true);
  // A tighter one that cannot hold four whole rows: the rows compact and keep their step.
  check(describeDigest(remembered.threads, undefined, [], 700), true);
  expect(context.prompt).not.toContain("see the practice row");
});

test("a compact owed row keeps its obstacle when there is no step", () => {
  const { run, threads } = fourOwed();
  // The second prayer has been answered by other means: its boon can no longer be given.
  const closed = threads[1];
  if (!closed) throw new Error("fixture");
  const prayer = run.state.petitions.get(closed.petition);
  if (!prayer) throw new Error("prayer");
  run.state = {
    ...run.state,
    petitions: new Map(run.state.petitions).set(prayer.id, {
      ...prayer,
      status: "answered",
    }),
  };
  const { remembered } = run.view("zeus");
  const lines = describeDigest(remembered.threads, undefined, [], 0);
  const line = lines.find((l) => l.includes(`[${closed.petition}]`));
  expect(line).toBeDefined();
  expect(line).not.toContain("\n");
  expect(line).toContain("YOU OWE");
  expect(line).toContain("no longer open");
  expect(line).not.toMatch(/\{"action"/);
});

test("owed rows are never cut: with a budget too small for even their compact form, every owed row is still shown and the other threads go first", () => {
  const { run, threads } = fourOwed();
  const { remembered } = run.view("zeus");
  const lines = describeDigest(remembered.threads, undefined, [], 0);
  const text = lines.join("\n");
  for (const { petition } of threads) {
    expect(text).toContain(`your boon on its prayer [${petition}]`);
  }
  expect(lines.filter((l) => l.includes("YOU OWE"))).toHaveLength(4);
  for (const line of lines.filter((l) => l.includes("YOU OWE"))) {
    expect(/\{"action":"[^}]*\}|annot/.test(line)).toBe(true);
  }
});

test("prompt size with four owed boons against one", () => {
  const one = new Run();
  const p = one.prays();
  one.agreed(p);
  const { run } = fourOwed();
  const size = (c: { instructions?: string; prompt: string }) =>
    (c.instructions?.length ?? 0) + c.prompt.length;
  console.log(
    `BOON_OWED_FOUR one ${size(one.view("zeus").context)} four ${size(run.view("zeus").context)} digest one ${digestOf(one.view("zeus").context.prompt).join("\n").length} four ${digestOf(run.view("zeus").context.prompt).join("\n").length}`,
  );
});
