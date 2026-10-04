// The order of a god's request, from the text that never changes to the text
// that changes every tick. A model server keeps the start of the last request it
// read and reuses the longest start a new request shares with it, so what comes
// first decides how much of a request it need not read again: what every god is
// told alike, then what one god is, then what changes slowly, then this tick's.
//
// Only the order and the split of what a god is shown are tested here. That the
// same things are shown is the rest of the agents suite's to hold (the same
// sections, the same lines, the same budgets).

import { expect, test } from "bun:test";
import type { WorldEvent } from "@panthea/contracts";
import {
  applyEvent,
  createPrng,
  decideRoutineProposal,
  perceive,
  runTick,
  toEntityId,
  type WorldState,
} from "@panthea/world";
import { buildGodContext, PRAYERS_HEADING, rememberedBy } from "./context";
import { PRACTICES_HEADING } from "./practices";
import { allGodProfiles, greekState, withoutFireSpread } from "./test-fixtures";

const id = toEntityId;
const GODS = allGodProfiles.map((profile) => profile.id).sort();

/** Runs the world forward on its own routines, as the benchmark's capture does, so the gods have scenes, prayers, and memories to be shown. */
function aged(ticks: number): { state: WorldState; events: WorldEvent[] } {
  let state = withoutFireSpread(greekState());
  let prng = createPrng(1);
  const events: WorldEvent[] = [];
  for (let t = 0; t < ticks; t += 1) {
    const queue = [];
    for (const actor of state.actors.keys()) {
      const decision = decideRoutineProposal(state, actor);
      if (decision) queue.push(decision.proposal);
    }
    const result = runTick(state, prng, queue);
    state = result.state;
    prng = result.prng;
    events.push(...result.events);
  }
  return { state, events };
}

/** One god's whole request as the router sends it: the system text, then the user text. */
function requestOf(
  world: { state: WorldState; events: WorldEvent[] },
  god: string,
): { system: string; user: string; whole: string } {
  const profile = allGodProfiles.find((p) => p.id === god);
  if (!profile) throw new Error(god);
  const recent = world.events.filter((e) => e.tick > world.state.tick - 10);
  const snapshot = perceive(world.state, id(god), recent);
  if (!snapshot) throw new Error(`no snapshot for ${god}`);
  const context = buildGodContext(
    profile,
    snapshot,
    rememberedBy(world.state, id(god), recent),
  );
  const system = context.instructions ?? "";
  return {
    system,
    user: context.prompt,
    whole: `${system}\n\n${context.prompt}`,
  };
}

const commonPrefix = (a: string, b: string): number => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
};

const sharedPrefix = (texts: readonly string[]): string => {
  const [first = "", ...rest] = texts;
  let len = first.length;
  for (const text of rest) len = Math.min(len, commonPrefix(first, text));
  return first.slice(0, len);
};

/** The whole lines of the shared start: a half-line the gods happen to agree on does not count. */
const sharedLines = (texts: readonly string[]): string => {
  const prefix = sharedPrefix(texts);
  return prefix.slice(0, prefix.lastIndexOf("\n") + 1);
};

// --- What every god is told alike comes first ---------------------------------------------------

test("all seven gods' requests start with the same text, byte for byte, and it is the world's rules and the response format, not a god's name", () => {
  const world = aged(400);
  const requests = GODS.map((god) => requestOf(world, god).whole);
  expect(GODS).toHaveLength(7);
  const shared = sharedLines(requests);
  // Most of the generic guidance is in it: how to decide, how to move, how to speak, what a goal is, how to wait, how to reply.
  expect(shared.length).toBeGreaterThan(1_000);
  for (const line of [
    "Decide what you do next, in character",
    'You may also move to a neighboring place (action "move")',
    "Speak your report and legend words in the first person",
    "You may keep one goal across turns",
    'You may also choose to wait (action "wait")',
    "Reply with one JSON object naming your action.",
  ]) {
    expect(shared).toContain(line);
  }
  // And none of what makes the gods different.
  for (const god of allGodProfiles) {
    expect(shared).not.toContain(god.name);
    for (const lore of god.lore.slice(0, 1)) {
      expect(shared).not.toContain(lore.statement);
    }
  }
});

test("the shared start is in the system text, and it is the same in every god's whole system text; a god's own text begins right after it", () => {
  const world = aged(400);
  const systems = GODS.map((god) => requestOf(world, god).system);
  const shared = sharedLines(systems);
  expect(shared.length).toBeGreaterThan(1_000);
  for (const god of GODS) {
    const { system } = requestOf(world, god);
    const profile = allGodProfiles.find((p) => p.id === god);
    expect(system.startsWith(shared)).toBe(true);
    // The persona line follows the shared block directly.
    expect(system.slice(shared.length)).toStartWith(
      `You are ${profile?.name},`,
    );
  }
});

test("a god is named by the persona line right after the shared block, and its text through its powers does not depend on the tick", () => {
  const early = aged(200);
  const late = aged(420);
  for (const god of GODS) {
    const a = requestOf(early, god).system;
    const b = requestOf(late, god).system;
    const profile = allGodProfiles.find((p) => p.id === god);
    const persona = a.indexOf(`You are ${profile?.name},`);
    expect(persona).toBeGreaterThan(1_000);
    // Through the god's own fixed text (profile, drives, lore, relationships) two ticks agree exactly.
    const powers = a.indexOf("Your powers:");
    expect(powers).toBeGreaterThan(persona);
    expect(a.slice(0, powers)).toBe(b.slice(0, powers));
  }
});

// --- A god's start is unchanged while only this tick's state changed ------------------------------------------

test("between two ticks where only per-tick state changed, a god's request is the same up to the line that says where it is and what tick it is", () => {
  const world = aged(400);
  const profile = allGodProfiles[0];
  if (!profile) throw new Error("no gods");
  const god = profile.id;
  const first = requestOf(world, god);
  // Only the tick moves, and nothing in the scene: the same state a tick later.
  const later = {
    ...world,
    state: { ...world.state, tick: world.state.tick + 1 },
  };
  const second = requestOf(later, god);
  expect(second.whole).not.toBe(first.whole);
  const at = first.whole.indexOf(
    " in the ",
    first.whole.indexOf("You are at "),
  );
  expect(at).toBeGreaterThan(0);
  expect(commonPrefix(first.whole, second.whole)).toBeGreaterThan(
    first.whole.indexOf("You are at "),
  );
  // Everything before the per-tick lines is unchanged: the system text and the slow part of the user text.
  const location = first.whole.indexOf("You are at ");
  expect(second.whole.slice(0, location)).toBe(first.whole.slice(0, location));
  // The tick itself is the first thing to differ.
  expect(commonPrefix(first.whole, second.whole)).toBeLessThan(
    first.whole.indexOf("What do you do?"),
  );
});

/** Every god is told something by a mortal, so each has a memory to be shown. */
function remembering(world: { state: WorldState; events: WorldEvent[] }) {
  let state = world.state;
  let n = 0;
  for (const god of GODS) {
    n += 1;
    const report = {
      schemaVersion: 1,
      id: `evt-9-${900 + n * 2}`,
      sequence: state.lastSequence + 1,
      simTime: 0,
      tick: state.tick,
      correlationId: "fixture",
      causationId: "fixture",
      approximate: false,
      kind: "report-told",
      entityId: "farmer",
      listenerId: god,
      content: "The harvest failed.",
    } as unknown as WorldEvent;
    state = applyEvent(state, report);
    state = applyEvent(state, {
      ...report,
      id: `evt-9-${901 + n * 2}`,
      sequence: state.lastSequence + 1,
      kind: "memory-recorded",
      memoryKind: "told",
      entityId: god,
      sourceEventId: report.id,
      teller: "farmer",
      content: "The harvest failed.",
      subjects: ["farmer"],
      salience: 4,
    } as unknown as WorldEvent);
  }
  return { state, events: world.events };
}

test("a god's slow state (what it remembers, how it feels, its goal, what it did) comes before the scene, and the scene before the question", () => {
  const world = remembering(aged(450));
  let checked = 0;
  for (const god of GODS) {
    const { user } = requestOf(world, god);
    const where = user.indexOf("You are at ");
    expect(where).toBeGreaterThanOrEqual(0);
    for (const heading of [
      "You remember:",
      "How you feel now:",
      "What you did recently:",
    ]) {
      const at = user.indexOf(heading);
      if (at < 0) continue;
      checked += 1;
      expect(at).toBeLessThan(where);
    }
    // The goal line (or the offer to set one) is slow state too.
    const goal = Math.max(
      user.indexOf("You have no goal."),
      user.indexOf("Your goal:"),
    );
    expect(goal).toBeGreaterThanOrEqual(0);
    expect(goal).toBeLessThan(where);
    // The scene, in the order a tick changes it, ends at the question.
    for (const heading of [
      "Here with you:",
      "Buildings here:",
      "Recent events here:",
      "Ways out:",
    ]) {
      const at = user.indexOf(heading);
      expect(at).toBeGreaterThan(where);
      expect(at).toBeLessThan(user.indexOf("What do you do?"));
    }
  }
  expect(checked).toBeGreaterThan(0);
});

test("prayers, practice threads, openings, and contests are the last sections before the question: per-tick state last", () => {
  const world = aged(450);
  const seen = new Set<string>();
  for (const god of GODS) {
    const { user } = requestOf(world, god);
    const question = user.indexOf("What do you do?");
    const scene = user.indexOf("Recent events here:");
    for (const heading of [PRAYERS_HEADING, PRACTICES_HEADING]) {
      const at = user.split("\n").indexOf(heading);
      if (at < 0) continue;
      seen.add(heading);
      const charAt = user.split("\n").slice(0, at).join("\n").length;
      expect(charAt).toBeGreaterThan(scene);
      expect(charAt).toBeLessThan(question);
    }
    // The digest is the last section: nothing but the question follows it.
    const lines = user.split("\n");
    const digest = lines.indexOf(PRACTICES_HEADING);
    if (digest >= 0) {
      const rest = lines.slice(digest + 1);
      const end = rest.findIndex(
        (l) => !l.startsWith("- ") && !l.startsWith("  "),
      );
      expect(rest[end]).toBe("What do you do?");
    }
  }
  expect(seen.size).toBeGreaterThan(0);
});

// --- The budget -------------------------------------------------------------------------------------------------------

test("a god's request stays inside the 4K-token budget the context was built for", () => {
  const world = aged(450);
  for (const god of GODS) {
    const { whole } = requestOf(world, god);
    // About four characters to a token: the busiest seven-god request stays under 4,096 tokens with room for the reply and the schema.
    expect(whole.length).toBeLessThan(11_000);
  }
});
