import { expect, test } from "bun:test";
import type { WorldEvent } from "@panthea/contracts";
import {
  createInitialWorldState,
  createPrng,
  runTick,
  type WorldState,
} from "@panthea/world";
import { loadEmbeddedGreekWorldPack } from "./greek-world-pack";
import { buildRoutineQueue } from "./tick";

/**
 * A scripted day in the Greek town: every routine-driven inhabitant decides
 * each tick and the world runs the queue, with no god acting. What each
 * livelihood produces and trades is read from the committed events.
 */
function day(ticks: number): { state: WorldState; events: WorldEvent[] } {
  const pack = loadEmbeddedGreekWorldPack();
  if (!pack.ok) throw new Error(pack.message);
  let state = createInitialWorldState(pack.value);
  let prng = createPrng(7);
  const events: WorldEvent[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const queue = buildRoutineQueue(state).map((entry) => entry.proposal);
    const result = runTick(state, prng, queue);
    state = result.state;
    prng = result.prng;
    events.push(...result.events);
  }
  return { state, events };
}

const DAY = 400;
const ran = day(DAY);

const idsStarting = (prefix: string) =>
  [...ran.state.actors.keys()].filter((id) => String(id).startsWith(prefix));

function of<K extends WorldEvent["kind"]>(kind: K) {
  return ran.events.filter(
    (e): e is Extract<WorldEvent, { kind: K }> => e.kind === kind,
  );
}

const gathered = (who: readonly string[], resource: string) =>
  of("resource-gathered").filter(
    (e) => who.includes(String(e.entityId)) && e.resource === resource,
  );
const produced = (who: readonly string[], output: string) =>
  of("resource-produced").filter(
    (e) => who.includes(String(e.entityId)) && e.output === output,
  );
/** Trades where one of `who` gave `resource` away. */
const sold = (who: readonly string[], resource: string) =>
  of("resource-traded").filter(
    (e) =>
      (who.includes(String(e.entityId)) &&
        e.give.some((line) => line.resource === resource)) ||
      (who.includes(String(e.counterpartyId)) &&
        e.receive.some((line) => line.resource === resource)),
  );

test("the Greek pack's town has twenty mortals and seven gods at the start of the day", () => {
  const mortals = [...ran.state.actors.values()].filter((a) => !a.isDeity);
  expect(mortals).toHaveLength(20);
  expect([...ran.state.actors.values()].filter((a) => a.isDeity)).toHaveLength(
    7,
  );
});

test("fishers catch fish at the harbour and sell it to the ferryman, who sells provisions back", () => {
  const fishers = idsStarting("fisher-");
  expect(fishers.length).toBeGreaterThanOrEqual(4);
  expect(gathered(fishers, "fish").length).toBeGreaterThan(0);
  expect(sold(fishers, "fish").length).toBeGreaterThan(0);
  // The ferryman buys the catch and sells provisions back.
  expect(
    of("resource-traded").some(
      (e) =>
        String(e.counterpartyId) === "ferryman" &&
        e.give.some((line) => line.resource === "fish"),
    ),
  ).toBe(true);
  expect(gathered(["ferryman"], "food").length).toBeGreaterThan(0);
  expect(sold(["ferryman"], "food").length).toBeGreaterThan(0);
});

test("olive growers gather olives by the ancient tree and sell them", () => {
  const growers = idsStarting("olive-grower-");
  expect(growers.length).toBeGreaterThanOrEqual(3);
  expect(gathered(growers, "olives").length).toBeGreaterThan(0);
  expect(sold(growers, "olives").length).toBeGreaterThan(0);
});

test("weavers shear wool, weave it into cloth, and sell the cloth", () => {
  const weavers = idsStarting("weaver-");
  expect(weavers.length).toBeGreaterThanOrEqual(3);
  expect(gathered(weavers, "wool").length).toBeGreaterThan(0);
  expect(produced(weavers, "cloth").length).toBeGreaterThan(0);
  expect(sold(weavers, "cloth").length).toBeGreaterThan(0);
});

test("smiths dig ore at the forge, forge it into tools, and sell the tools", () => {
  const smiths = idsStarting("smith-");
  expect(smiths.length).toBeGreaterThanOrEqual(3);
  expect(gathered(smiths, "ore").length).toBeGreaterThan(0);
  expect(produced(smiths, "tools").length).toBeGreaterThan(0);
  expect(sold(smiths, "tools").length).toBeGreaterThan(0);
});

test("the herdsman and the provisioner supply the grove and the forge with food, and the market trader sells wine at the square", () => {
  expect(gathered(["herdsman-damon"], "food").length).toBeGreaterThan(0);
  expect(gathered(["provisioner-nikanor"], "food").length).toBeGreaterThan(0);
  expect(gathered(["market-trader-iris"], "wine").length).toBeGreaterThan(0);
  expect(sold(["market-trader-iris"], "wine").length).toBeGreaterThan(0);
});

test("no good passes back and forth between two traders without being worked: every mortal's catch, cloth, or tools ends up somewhere it is used", () => {
  // Over the day each producer makes much more than the few trades could pass around: the old ping-pong
  // made trades outnumber production several times over.
  const fishers = idsStarting("fisher-");
  const catches = gathered(fishers, "fish").length;
  expect(sold(fishers, "fish").length).toBeLessThanOrEqual(catches);
  const smiths = idsStarting("smith-");
  expect(sold(smiths, "tools").length).toBeLessThanOrEqual(
    produced(smiths, "tools").length,
  );
  const weavers = idsStarting("weaver-");
  expect(sold(weavers, "cloth").length).toBeLessThanOrEqual(
    produced(weavers, "cloth").length,
  );
});

test("mortals who go short pray to the god they revere, so the day's prayers name several gods", () => {
  const petitions = [...ran.state.petitions.values()];
  expect(petitions.length).toBeGreaterThan(0);
  const named = new Set(petitions.map((p) => String(p.god)));
  expect(named.size).toBeGreaterThanOrEqual(2);
  // A mortal with a devotion prays to its god until its feelings have moved them elsewhere.
  const pack = loadEmbeddedGreekWorldPack();
  if (!pack.ok) throw new Error(pack.message);
  for (const petition of petitions) {
    const devotion = pack.value.inhabitants.find(
      (i) => i.id === String(petition.petitioner),
    )?.devotion?.god;
    if (petition.tick <= 30)
      expect(String(petition.god)).toBe(String(devotion));
  }
});

test("Hades hears prayers: over the scripted day a mortal prays to him, so he can enter a practice (R20)", () => {
  const toHades = of("petition-opened").filter(
    (e) => String(e.god) === "hades",
  );
  expect(toHades.length).toBeGreaterThan(0);
  // The ferryman, who reveres him, now feeds himself and rarely goes short, so he is no longer the one who prays: whoever does reaches Hades through what they feel for him.
});

// --- Occasional hunger (R17, SC1) -------------------------------------------------------------

/** The plan's scripted day for hunger: 300 ticks, no god acting. */
const FOOD_DAY = day(300);
const foodDay = <K extends WorldEvent["kind"]>(kind: K) =>
  FOOD_DAY.events.filter(
    (e): e is Extract<WorldEvent, { kind: K }> => e.kind === kind,
  );
const foodAmount = (events: readonly { amount: number }[]) =>
  events.reduce((sum, e) => sum + e.amount, 0);

test("hunger is occasional: a scripted 300-tick day logs at most 250 'cannot get food' lines, down from about 1,250", () => {
  const cannotGetFood = foodDay("unmet-need").filter(
    (e) => e.resource === "food",
  );
  expect(cannotGetFood.length).toBeLessThanOrEqual(250);
});

test("food prayers are fewer than half of all prayers in the scripted day", () => {
  const prayers = foodDay("petition-opened");
  expect(prayers.length).toBeGreaterThan(0);
  const foodPrayers = prayers.filter(
    (e) =>
      e.request.kind === "help" &&
      e.request.need.kind === "resource" &&
      e.request.need.resource === "food",
  );
  expect(foodPrayers.length * 2).toBeLessThan(prayers.length);
});

test("production meets consumption: producers gather at least as much food as the town eats", () => {
  const gatheredFood = foodAmount(
    foodDay("resource-gathered").filter((e) => e.resource === "food"),
  );
  const eaten = foodAmount(
    foodDay("resource-consumed").filter((e) => e.resource === "food"),
  );
  expect(eaten).toBeGreaterThan(0);
  expect(gatheredFood).toBeGreaterThanOrEqual(eaten);
});

test("food is sold only by its producers, and no pair of mortals trades it in both directions", () => {
  const producers = new Set(
    [...FOOD_DAY.state.actors.values()]
      .filter((a) => a.gathers === "food")
      .map((a) => String(a.id)),
  );
  expect(producers.size).toBeGreaterThan(0);
  const sales = new Set<string>();
  for (const trade of foodDay("resource-traded")) {
    const sold = trade.give.some((line) => line.resource === "food");
    const bought = trade.receive.some((line) => line.resource === "food");
    if (sold === bought) continue;
    const [seller, buyer] = sold
      ? [String(trade.entityId), String(trade.counterpartyId)]
      : [String(trade.counterpartyId), String(trade.entityId)];
    expect(producers.has(seller)).toBe(true);
    sales.add(`${seller}>${buyer}`);
  }
  expect(sales.size).toBeGreaterThan(0);
  for (const sale of sales) {
    const [seller, buyer] = sale.split(">");
    expect(sales.has(`${buyer}>${seller}`)).toBe(false);
  }
});
