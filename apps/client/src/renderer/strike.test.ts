// The lightning bolt: an effect sprite that plays once over a building when
// the world commits a strike on it, and the effects setting that picks which
// strike it plays. The world is authoritative; every test here feeds the
// renderer committed events and reads what it presents. Time is the
// renderer's own animation clock, moved only by `tick`.

import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  eventSubjects,
  parseSyncFrame,
  type WorldEvent,
} from "@panthea/contracts";
import { type EffectsMode, STRUCTURE_ANCHORS } from "@panthea/renderer";
import { testBackend } from "@panthea/testkit/renderer";
import {
  buildingBase,
  createPrng,
  decode,
  encode,
  runTick,
  submitProposal,
  toEntityId,
  type WorldState,
  withBuilding,
} from "@panthea/world";

import {
  decodeFixture,
  type FakeSource,
  fakeSource,
} from "../../test/canon-fixture";
import { STRIKE_ATLAS_HASH } from "../../test/structure-fixture";
import { viewWithZeus } from "../../test/view-fixture";
import {
  COMMITTED_CANON_ATLASES,
  committedCanonPayload,
  RETRO_ATLASES,
  retroPayload,
} from "../../test/zeus-retro-fixture";
import { createCanonClient } from "../assets/canon";
import { createEffectsSetting } from "../effects";
import { baseState, type FixtureEvent, framePayload } from "../fixtures";
import { toViewModel, type WorldViewModel } from "../store";
import { buildingFoot, locationPoints } from "./layout";
import { drawableEvents } from "./presentation";
import { createWorldRenderer, type WorldRenderer } from "./scene";

// The published strike: `full` is 8 frames of 110, 90, 70, 90, 90, 100, 100 and 100 ms (750 in all), `calm` 4 frames
// of 150, 130, 130 and 130 ms (540), each frame a 64x128 cell in one row.
const FULL_RECTS = [0, 64, 128, 192, 256, 320, 384, 448].map(
  (x) => `${x},0,64,128`,
);
const CALM_RECTS = [512, 576, 640, 704].map((x) => `${x},0,64,128`);

function canvas() {
  return { width: 0, height: 0, style: {} } as unknown as HTMLCanvasElement & {
    style: Record<string, string>;
  };
}

// A renderer's sprite layer owns an ECS world and koota caps worlds at 16 per
// process, so every renderer a test mounts is disposed when the test ends.
const mounted: WorldRenderer[] = [];
afterEach(() => {
  for (const renderer of mounted.splice(0)) renderer.dispose();
});

function canonClient(source: FakeSource) {
  return createCanonClient({ source });
}

async function mount(
  options: { source?: FakeSource; effects?: () => EffectsMode } = {},
) {
  const source =
    options.source ??
    fakeSource(committedCanonPayload(), COMMITTED_CANON_ATLASES);
  const backend = testBackend();
  const renderer = createWorldRenderer(canvas(), {
    canon: canonClient(source),
    createBackend: () => backend,
    decode: decodeFixture,
    devicePixelRatio: () => 1,
    available: () => ({ width: 1200, height: 1300 }),
    ...(options.effects === undefined ? {} : { effects: options.effects }),
  });
  mounted.push(renderer);
  await renderer.start(() => {});
  return { renderer, backend, source };
}

type Mounted = Awaited<ReturnType<typeof mount>>;

const event = (
  id: string,
  sequence: number,
  kind: string,
  cause?: string,
  subjects: readonly string[] = ["the-tavern", "zeus"],
): FixtureEvent => ({
  id,
  sequence,
  tick: 4,
  kind,
  subjects,
  ...(cause === undefined ? {} : { cause }),
});

const struck = (id = "evt-ignite-1", sequence = 20) =>
  event(id, sequence, "building-ignited", "strike");

const viewOf = (events: readonly FixtureEvent[]): WorldViewModel =>
  viewWithZeus({ recentEvents: events });

const boltId = (id: string) => `effect:bolt:${id}`;
const frameOf = (harness: Mounted, id: string) =>
  harness.backend.layer.spriteFor(boltId(id))?.frame?.name;
const rendersOf = (harness: Mounted) =>
  harness.backend.log.filter((entry) => entry === "render").length;

test("a strike-caused ignition plays the bolt once, frame by frame on the published durations, then hides it", async () => {
  const harness = await mount();
  const { renderer } = harness;
  await renderer.draw(viewOf([]), "mortal");

  await renderer.draw(viewOf([struck()]), "mortal");

  const durations = [110, 90, 70, 90, 90, 100, 100, 100];
  let elapsed = 0;
  for (const [index, duration] of durations.entries()) {
    // The first and the last millisecond of each frame show that frame.
    expect(frameOf(harness, "evt-ignite-1")).toBe(FULL_RECTS[index]);
    renderer.tick(duration - 1);
    elapsed += duration;
    expect(frameOf(harness, "evt-ignite-1")).toBe(FULL_RECTS[index]);
    renderer.tick(1);
  }
  expect(elapsed).toBe(750);
  // Every frame has had its time: the bolt is gone and does not loop.
  expect(
    harness.backend.layer.spriteFor(boltId("evt-ignite-1")),
  ).toBeUndefined();
  renderer.tick(10_000);
  expect(
    harness.backend.layer.spriteFor(boltId("evt-ignite-1")),
  ).toBeUndefined();

  // Drawing the same committed window again does not play it again.
  await renderer.draw(viewOf([struck()]), "mortal");
  expect(
    harness.backend.layer.spriteFor(boltId("evt-ignite-1")),
  ).toBeUndefined();
});

test("every building-damaged event plays the bolt, since the world emits it only from a strike", async () => {
  const harness = await mount();
  await harness.renderer.draw(viewOf([]), "mortal");

  await harness.renderer.draw(
    viewOf([event("evt-damaged-1", 21, "building-damaged")]),
    "mortal",
  );

  expect(frameOf(harness, "evt-damaged-1")).toBe(FULL_RECTS[0]);
});

test("a director or spread fire, an ignition with no cause, and other kinds on a building play no bolt", async () => {
  const harness = await mount();
  await harness.renderer.draw(viewOf([]), "mortal");
  const before = harness.backend.layer.stats.sprites;

  await harness.renderer.draw(
    viewOf([
      event("evt-director", 20, "building-ignited", "director"),
      event("evt-spread", 21, "building-ignited", "spread"),
      event("evt-bare", 22, "building-ignited"),
      event("evt-destroyed", 23, "building-destroyed"),
      event("evt-repaired", 24, "building-repaired"),
    ]),
    "mortal",
  );

  expect(harness.backend.layer.stats.sprites).toBe(before);
  for (const id of [
    "evt-director",
    "evt-spread",
    "evt-bare",
    "evt-destroyed",
    "evt-repaired",
  ]) {
    expect(frameOf(harness, id)).toBeUndefined();
  }
});

test("a fresh start replays nothing: the first draw marks the window seen without playing it", async () => {
  const harness = await mount();

  await harness.renderer.draw(viewOf([struck()]), "mortal");

  expect(frameOf(harness, "evt-ignite-1")).toBeUndefined();
  // And it is seen: drawing it again, or a later view still carrying it, plays nothing either.
  await harness.renderer.draw(viewOf([struck()]), "mortal");
  expect(frameOf(harness, "evt-ignite-1")).toBeUndefined();
  await harness.renderer.draw(
    viewOf([struck(), struck("evt-ignite-2", 21)]),
    "mortal",
  );
  expect(frameOf(harness, "evt-ignite-1")).toBeUndefined();
  expect(frameOf(harness, "evt-ignite-2")).toBe(FULL_RECTS[0]);
});

test("a remount replays nothing: the renderer that replaces a lost one marks its first window seen", async () => {
  const first = await mount();
  await first.renderer.draw(viewOf([]), "mortal");
  await first.renderer.draw(viewOf([struck()]), "mortal");
  expect(frameOf(first, "evt-ignite-1")).toBe(FULL_RECTS[0]);
  first.renderer.dispose();

  const second = await mount();
  await second.renderer.draw(viewOf([struck()]), "mortal");

  expect(frameOf(second, "evt-ignite-1")).toBeUndefined();
});

test("a realm switch out and back replays nothing, and a strike in the realm not being viewed is not shown when it is switched to", async () => {
  const harness = await mount();
  const { renderer } = harness;
  await renderer.draw(viewOf([]), "mortal");

  // The strike lands while Olympus is viewed: the tavern is not there, so no bolt.
  await renderer.draw(viewOf([struck()]), "olympus");
  expect(frameOf(harness, "evt-ignite-1")).toBeUndefined();
  // Back in the mortal realm, the event is already seen.
  await renderer.draw(viewOf([struck()]), "mortal");
  expect(frameOf(harness, "evt-ignite-1")).toBeUndefined();

  // A bolt that has played and finished is not played again by leaving and returning.
  await renderer.draw(viewOf([struck(), struck("evt-ignite-2", 21)]), "mortal");
  expect(frameOf(harness, "evt-ignite-2")).toBe(FULL_RECTS[0]);
  renderer.tick(800);
  await renderer.draw(
    viewOf([struck(), struck("evt-ignite-2", 21)]),
    "olympus",
  );
  await renderer.draw(viewOf([struck(), struck("evt-ignite-2", 21)]), "mortal");
  expect(frameOf(harness, "evt-ignite-2")).toBeUndefined();
});

test("a bolt that is playing keeps playing across redraws of the same window", async () => {
  const harness = await mount();
  const { renderer } = harness;
  await renderer.draw(viewOf([]), "mortal");
  await renderer.draw(viewOf([struck()]), "mortal");
  renderer.tick(120);
  expect(frameOf(harness, "evt-ignite-1")).toBe(FULL_RECTS[1]);

  await renderer.draw(viewOf([struck()]), "mortal");

  expect(frameOf(harness, "evt-ignite-1")).toBe(FULL_RECTS[1]);
  renderer.tick(80);
  expect(frameOf(harness, "evt-ignite-1")).toBe(FULL_RECTS[2]);
});

test("the calm setting picks the calm animation: 4 frames, 540 ms", async () => {
  const harness = await mount({ effects: () => "calm" });
  const { renderer } = harness;
  await renderer.draw(viewOf([]), "mortal");

  await renderer.draw(viewOf([struck()]), "mortal");

  const durations = [150, 130, 130, 130];
  for (const [index, duration] of durations.entries()) {
    expect(frameOf(harness, "evt-ignite-1")).toBe(CALM_RECTS[index]);
    renderer.tick(duration);
  }
  expect(
    harness.backend.layer.spriteFor(boltId("evt-ignite-1")),
  ).toBeUndefined();
});

test("the setting is read when a strike starts: a bolt keeps the animation it began with, the next one follows the change", async () => {
  const setting = createEffectsSetting({
    storage: undefined,
    matchMedia: undefined,
  });
  const harness = await mount({ effects: () => setting.mode() });
  const { renderer } = harness;
  await renderer.draw(viewOf([]), "mortal");
  await renderer.draw(viewOf([struck()]), "mortal");
  expect(frameOf(harness, "evt-ignite-1")).toBe(FULL_RECTS[0]);

  setting.set("calm");
  renderer.tick(120);
  expect(frameOf(harness, "evt-ignite-1")).toBe(FULL_RECTS[1]);
  renderer.tick(700);
  await renderer.draw(viewOf([struck(), struck("evt-ignite-2", 21)]), "mortal");

  expect(frameOf(harness, "evt-ignite-2")).toBe(CALM_RECTS[0]);
});

test("the bolt strikes the building's anchor, in the effect layer in front of the building and its fire", async () => {
  const harness = await mount();
  const { renderer, backend } = harness;
  const base = viewOf([]);
  await renderer.draw(base, "mortal");

  await renderer.draw(viewOf([struck()]), "mortal");

  const square = base.realms.mortal.find(
    (location) => location.id === "town-square",
  );
  const place = locationPoints(base.realms.mortal).get("town-square");
  const index = square?.buildings.findIndex((b) => b.id === "the-tavern") ?? -1;
  if (place === undefined || index < 0) throw new Error("no tavern");
  const foot = buildingFoot(place, index);
  const target = STRUCTURE_ANCHORS.building.strike;
  const bolt = backend.layer.spriteFor(boltId("evt-ignite-1"));
  if (bolt === undefined) throw new Error("no bolt");
  // The cell is 64x128 with its pivot at (32, 116): the sprite's centre is the target moved 116 - 64 up.
  expect([bolt.position.x, bolt.position.y]).toEqual([
    foot.x + target.x,
    foot.y - target.y + (116 - 64),
  ]);
  const house = backend.layer.spriteFor("structure:the-tavern");
  const fire = backend.layer.spriteFor("structure:the-tavern:fire");
  expect(bolt.position.z).toBeGreaterThan(house?.position.z ?? Number.NaN);
  expect(bolt.position.z).toBeGreaterThan(fire?.position.z ?? Number.NaN);
});

test("a tick that changes no frame renders nothing, and each bolt frame, and its end, renders once", async () => {
  const harness = await mount();
  const { renderer } = harness;
  await renderer.draw(viewOf([]), "mortal");
  await renderer.draw(viewOf([struck()]), "mortal");
  const afterDraw = rendersOf(harness);

  renderer.tick(1);
  expect(rendersOf(harness)).toBe(afterDraw);

  // 110 ms: the second frame. The fire loop (90 ms frames) has changed too, in the same render.
  renderer.tick(109);
  expect(rendersOf(harness)).toBe(afterDraw + 1);

  // To the end of the strike at 750 ms: the last frame change and the hiding are each a render.
  renderer.tick(640);
  expect(
    harness.backend.layer.spriteFor(boltId("evt-ignite-1")),
  ).toBeUndefined();
  const ended = rendersOf(harness);
  renderer.tick(5);
  expect(rendersOf(harness) - ended).toBeLessThanOrEqual(1);
});

test("a strike with no published bolt shows none, and the event is still drawn for its receipt", async () => {
  const harness = await mount({
    source: fakeSource(retroPayload(), RETRO_ATLASES),
  });
  await harness.renderer.draw(viewOf([]), "mortal");
  const view = viewOf([struck()]);

  const drawn = await harness.renderer.draw(view, "mortal");

  expect(frameOf(harness, "evt-ignite-1")).toBeUndefined();
  expect(drawn).toEqual(drawableEvents(view, "mortal").map((e) => e.id));
  expect(drawn).toContain("evt-ignite-1");
});

test("a bolt whose atlas cannot be fetched shows none, is reported once, and the draw still completes", async () => {
  const atlases = new Map(COMMITTED_CANON_ATLASES);
  atlases.delete(STRIKE_ATLAS_HASH);
  const source = fakeSource(committedCanonPayload(), atlases);
  const problems: string[] = [];
  const backend = testBackend();
  const renderer = createWorldRenderer(canvas(), {
    canon: createCanonClient({
      source,
      onProblem: (problem) => problems.push(problem.scope),
    }),
    createBackend: () => backend,
    decode: decodeFixture,
    devicePixelRatio: () => 1,
    available: () => ({ width: 1200, height: 1300 }),
  });
  mounted.push(renderer);
  await renderer.start(() => {});
  await renderer.draw(viewOf([]), "mortal");

  const drawn = await renderer.draw(viewOf([struck()]), "mortal");
  await renderer.draw(viewOf([struck(), struck("evt-ignite-2", 21)]), "mortal");

  expect(drawn).toContain("evt-ignite-1");
  expect(backend.layer.spriteFor(boltId("evt-ignite-1"))).toBeUndefined();
  expect(problems).toEqual([`atlas:${STRIKE_ATLAS_HASH}`]);
});

test("a draw superseded before it settles does not mark its events seen: the draw that replaces it plays the bolt", async () => {
  let release: (bytes: Uint8Array) => void = () => {};
  const held = new Promise<Uint8Array>((resolve) => {
    release = resolve;
  });
  const real = fakeSource(committedCanonPayload(), COMMITTED_CANON_ATLASES);
  const slow: FakeSource = {
    ...real,
    atlas: (hash) => (hash === STRIKE_ATLAS_HASH ? held : real.atlas(hash)),
  };
  const harness = await mount({ source: slow });
  const { renderer } = harness;
  await renderer.draw(viewOf([]), "mortal");

  const first = renderer.draw(viewOf([struck()]), "mortal");
  const second = renderer.draw(viewOf([struck()]), "mortal");
  release(COMMITTED_CANON_ATLASES.get(STRIKE_ATLAS_HASH) ?? new Uint8Array());

  expect(await first).toEqual([]);
  expect(await second).toContain("evt-ignite-1");
  expect(frameOf(harness, "evt-ignite-1")).toBe(FULL_RECTS[0]);
});

test("the seen set is the current window: an event stays seen while the window carries it and is forgotten once it leaves, so the set is as small as the window", async () => {
  const harness = await mount();
  const { renderer } = harness;
  await renderer.draw(viewOf([]), "mortal");
  await renderer.draw(viewOf([struck()]), "mortal");
  renderer.tick(800);

  // Still in the window: seen.
  await renderer.draw(viewOf([struck(), struck("evt-ignite-2", 21)]), "mortal");
  renderer.tick(800);
  expect(frameOf(harness, "evt-ignite-1")).toBeUndefined();

  // Gone from the window (the sidecar's window is a few ticks and only moves forward), it is dropped from the set.
  await renderer.draw(viewOf([struck("evt-ignite-2", 21)]), "mortal");
  await renderer.draw(viewOf([struck(), struck("evt-ignite-2", 21)]), "mortal");
  expect(frameOf(harness, "evt-ignite-1")).toBe(FULL_RECTS[0]);
});

// --- The effects setting changes presentation only ---------------------------------------------------------

/** The world the strike lands in: the fixture's tavern, whole again. */
function strikeWorld(): WorldState {
  const world = baseState();
  const tavern = world.buildings.get(toEntityId("the-tavern"));
  if (tavern === undefined) throw new Error("no tavern");
  return withBuilding(world, {
    ...buildingBase(tavern),
    status: "operational",
  });
}

const stateHash = (state: WorldState): string =>
  createHash("sha256")
    .update(canonicalJson(encode(state)))
    .digest("hex");

function recentOf(events: readonly WorldEvent[]): FixtureEvent[] {
  return events.flatMap((event) =>
    event.kind === "building-damaged" || event.kind === "building-ignited"
      ? [
          {
            id: event.id,
            sequence: event.sequence,
            tick: event.tick,
            kind: event.kind,
            subjects: [...eventSubjects(event)],
            ...(event.kind === "building-ignited"
              ? { cause: event.cause.kind }
              : {}),
          },
        ]
      : [],
  );
}

/** Runs the seeded world for `ticks` ticks with a strike on the first, drawing every committed frame through `renderer` when there is one. */
async function runWorld(
  ticks: number,
  renderer: WorldRenderer | undefined,
): Promise<{ hash: string; bolts: number; ids: string[][] }> {
  const submitted = submitProposal({
    schemaVersion: 1,
    actor: "zeus",
    targets: ["the-tavern"],
    expectedRevisions: [],
    source: "fixture",
    observationId: "obs-strike",
    kind: "strike",
    target: "the-tavern",
    power: 3,
  });
  if (!submitted.ok) throw new Error(submitted.rejection.message);
  let state = strikeWorld();
  let prng = createPrng(11);
  let bolts = 0;
  const ids: string[][] = [];
  await renderer?.draw(toFrame(state, []), "mortal");
  for (let tick = 0; tick < ticks; tick += 1) {
    const result = runTick(state, prng, tick === 0 ? [submitted.proposal] : []);
    state = result.state;
    prng = result.prng;
    const recent = recentOf(result.events);
    bolts += recent.length;
    if (renderer !== undefined) {
      ids.push([...(await renderer.draw(toFrame(state, recent), "mortal"))]);
      renderer.tick(250);
    }
  }
  return { hash: stateHash(state), bolts, ids };
}

function toFrame(
  state: WorldState,
  recentEvents: readonly FixtureEvent[],
): WorldViewModel {
  const parsed = parseSyncFrame(framePayload(state, { recentEvents }));
  if (!parsed.ok) throw new Error(parsed.message);
  return toViewModel(parsed.value, decode(parsed.value.state));
}

test("a seeded world run ends in the same state hash with the full setting, the calm one and no renderer at all, and presents the same events", async () => {
  const bare = await runWorld(6, undefined);
  const full = await mount({ effects: () => "full" });
  const calm = await mount({ effects: () => "calm" });

  const withFull = await runWorld(6, full.renderer);
  const withCalm = await runWorld(6, calm.renderer);

  expect(bare.bolts).toBeGreaterThan(0);
  expect(withFull.hash).toBe(bare.hash);
  expect(withCalm.hash).toBe(bare.hash);
  // The same committed events are drawn, and so receipted, whichever strike is played.
  expect(withCalm.ids).toEqual(withFull.ids);
  expect(withFull.ids.flat().length).toBeGreaterThan(0);
});

test("toggling the setting asks the registry for nothing and redraws nothing: it is read when a strike starts", async () => {
  const heard: string[] = [];
  const setting = createEffectsSetting({
    storage: { getItem: () => null, setItem: () => {} },
    matchMedia: undefined,
  });
  const harness = await mount({ effects: () => setting.mode() });
  await harness.renderer.draw(viewOf([]), "mortal");
  const registryCalls = harness.source.registryCalls();
  const atlasCalls = [...harness.source.atlasCalls()];
  const log = [...harness.backend.log];
  const names = harness.backend.decor.children.map((child) => child.name);
  const sprites = harness.backend.layer.stats;
  setting.subscribe((mode) => heard.push(mode));

  setting.set("calm");
  setting.set("full");
  setting.set("calm");

  expect(setting.mode()).toBe("calm");
  expect(harness.source.registryCalls()).toBe(registryCalls);
  expect(harness.source.atlasCalls()).toEqual(atlasCalls);
  expect(harness.backend.log).toEqual(log);
  expect(harness.backend.decor.children.map((child) => child.name)).toEqual(
    names,
  );
  expect(harness.backend.layer.stats).toEqual(sprites);
  // The listener is the only thing that heard it.
  expect(heard).toEqual(["calm", "full", "calm"]);
});
