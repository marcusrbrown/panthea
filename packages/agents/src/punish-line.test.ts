// The "punish freely" line a god is offered on a punish prayer: its strike object is the whole object the
// parser takes (a whole-number power from 1 to the cap), shown only when the parser and the world would accept
// it and the strike would answer the prayer; a god that cannot strike is told why and given no object. The
// world is real (the authored Greek pack, real ticks, the real validator).

import { expect, test } from "bun:test";
import type { EventId, WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  createPrng,
  getActor,
  perceive,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
  withActor,
} from "@panthea/world";
import { buildGodContext, godIntentSchema, rememberedBy } from "./context";
import { buildModelProposal } from "./observation";
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
        observationId: `obs-pl-${this.n}`,
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
  /** The farmer prays to `god` to punish the woodcutter's woodshed. */
  prayPunish(god: string): EventId {
    const theft = this.apply({
      kind: "theft",
      entityId: "woodcutter",
      victim: "farmer",
      resource: "currency",
      amount: 1,
      cause: "director",
    });
    return this.apply({
      kind: "petition-opened",
      entityId: "farmer",
      god,
      cause: theft.id,
      request: {
        kind: "punish",
        offender: "woodcutter",
        buildings: ["woodshed"],
      },
    }).id as EventId;
  }
  place(who: string, where: string) {
    const actor = getActor(this.state, id(who));
    if (!actor) throw new Error(who);
    this.state = withActor(this.state, { ...actor, locationId: id(where) });
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
    };
  }
}

/** The lines of one prayer's entry in the prayers section. */
const entryOf = (prompt: string, petition: string): string => {
  const lines = prompt.split("\n");
  const at = lines.findIndex((l) => l.startsWith(`- [${petition}]`));
  if (at < 0) return "";
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => !l.startsWith("  "));
  return [lines[at], ...rest.slice(0, end < 0 ? rest.length : end)].join("\n");
};

const SHED = "town-square";

test("the punish line's strike is the whole object: it parses, builds, and commits through the real world, and answers the prayer", () => {
  const run = new Run();
  const petition = run.prayPunish("zeus");
  run.place("zeus", SHED);
  const { context, schema, snapshot, remembered } = run.view("zeus");
  const entry = entryOf(context.prompt, petition);
  const strike = { action: "strike", target: "woodshed", power: 1 };
  expect(entry).toContain(
    `punish freely: woodshed is here: ${JSON.stringify(strike)}`,
  );
  // Copy it exactly, as a model would.
  const shown = /punish freely: [^:]+: (\{[^}]*\})/.exec(entry);
  expect(shown).not.toBeNull();
  const copied = JSON.parse(shown?.[1] as string);
  const parsed = schema.parse(copied);
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
  expect(run.state.petitions.get(petition)?.status).toBe("answered");
});

test("a god without the power to strike is told why and given no object: no ability, no divinity to spend, or a building that cannot be struck", () => {
  const line = (change: (run: Run) => void, god = "zeus") => {
    const run = new Run();
    const petition = run.prayPunish(god);
    run.place(god, SHED);
    change(run);
    const view = run.view(god);
    return {
      entry: entryOf(view.context.prompt, petition),
      schema: view.schema,
    };
  };
  // The building's own line: the strike on the mortal who owns it is a choice of its own, shown beside it.
  const buildingLine = (entry: string) =>
    entry.split("\n").find((l) => l.includes("punish freely")) ?? "";
  const noObject = (entry: string) => {
    expect(entry).toContain("punish freely");
    expect(buildingLine(entry)).not.toMatch(/\{"action":"strike"/);
    expect(entry).toContain("cannot strike it now");
  };

  // Hades has no strike ability at all.
  const hades = line(() => {}, "hades");
  noObject(hades.entry);
  expect(hades.entry).toContain("no power to strike");
  expect(
    hades.schema.parse({ action: "strike", target: "woodshed", power: 1 }).ok,
  ).toBe(false);

  // Zeus with nothing to spend.
  const poor = line((run) => {
    const zeus = getActor(run.state, id("zeus"));
    if (!zeus) throw new Error("zeus");
    run.state = withActor(run.state, {
      ...zeus,
      inventory: new Map(zeus.inventory).set("divinity", 0),
    });
  });
  noObject(poor.entry);
  expect(poor.entry).toContain("divinity");

  // A building the world will not strike, or would not count as an answer.
  const damaged = line((run) => {
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
  noObject(damaged.entry);
  expect(damaged.entry).toContain("woodshed");
  expect(damaged.entry).toContain("destroyed");
});

test("a god that is away is shown the strike on the building directly, as the whole object, and no travel to its place", () => {
  const run = new Run();
  const petition = run.prayPunish("zeus");
  const entry = entryOf(run.view("zeus").context.prompt, petition);
  expect(entry).toContain(
    'punish freely, from where you stand: {"action":"strike","target":"woodshed","power":1}',
  );
  expect(entry).not.toContain("travel");
  expect(entry).not.toContain("once you are there");
  // Copied exactly, it parses, builds from the prayer, and answers it through the real world, with Zeus far from the shed.
  const view = run.view("zeus");
  const shown = /punish freely, from where you stand: (\{[^}]*\})/.exec(entry);
  expect(shown).not.toBeNull();
  const parsed = view.schema.parse(JSON.parse(shown?.[1] as string));
  if (!parsed.ok) throw new Error(parsed.message);
  const built = buildModelProposal(
    id("zeus"),
    view.snapshot,
    parsed.value,
    view.remembered,
  );
  if (!built.ok || built.kind !== "proposal") throw new Error("no proposal");
  const zeusAt = getActor(run.state, id("zeus"))?.locationId;
  const ran = run.tick(built.proposal as never);
  expect(ran.rejected).toEqual([]);
  expect(run.state.petitions.get(petition)?.status).toBe("answered");
  expect(getActor(run.state, id("zeus"))?.locationId).toBe(zeusAt);
});

test("a god that cannot strike, or a listed building it would not strike, is shown no remote strike line, and the owner's line says why", () => {
  // Hades has no strike ability: the building is not offered, and the owner's line carries the reason.
  const hades = new Run();
  const forHades = hades.prayPunish("hades");
  const entry = entryOf(hades.view("hades").context.prompt, forHades);
  expect(entry).not.toContain("from where you stand");
  expect(entry).toContain("no power to strike");
  // A destroyed shed would answer nothing, so it is not offered from afar.
  const wrecked = new Run();
  const petition = wrecked.prayPunish("zeus");
  const shed = wrecked.state.buildings.get(id("woodshed"));
  if (!shed) throw new Error("shed");
  wrecked.state = {
    ...wrecked.state,
    buildings: new Map(wrecked.state.buildings).set(shed.id, {
      ...shed,
      status: "destroyed",
    } as never),
  };
  const gone = entryOf(wrecked.view("zeus").context.prompt, petition);
  expect(gone).not.toContain('"target":"woodshed"');
  expect(gone).toContain('"target":"woodcutter"');
});
