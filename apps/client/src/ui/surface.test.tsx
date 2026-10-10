import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { WorldViewModel } from "../store";
import { ClientSurface } from "./surface";

function view(overrides: Partial<WorldViewModel> = {}): WorldViewModel {
  return {
    sequence: 1,
    sessionId: "session-1",
    tick: 3,
    status: "running",
    realms: {
      mortal: [
        {
          id: "town-square",
          name: "Town Square",
          realm: "mortal",
          edges: [],
          actors: [
            {
              id: "wanderer",
              locationId: "town-square",
              alive: true,
              sprite: "placeholder-wanderer",
              isDeity: false,
              inventory: [],
            },
          ],
          buildings: [],
        },
      ],
      olympus: [
        {
          id: "hall",
          name: "Hall",
          realm: "olympus",
          edges: [],
          actors: [],
          buildings: [],
        },
      ],
      underworld: [
        {
          id: "gate",
          name: "Gate",
          realm: "underworld",
          edges: [],
          actors: [],
          buildings: [],
        },
      ],
    },
    recentEvents: [],
    ...overrides,
  } as WorldViewModel;
}

test("target picker renders actor and locations grouped by realm", () => {
  const html = renderToStaticMarkup(
    <ClientSurface view={view()} observation={{ kind: "idle" }} />,
  );

  expect(html.indexOf("Mortal")).toBeLessThan(html.indexOf("Olympus"));
  expect(html.indexOf("Olympus")).toBeLessThan(html.indexOf("Underworld"));
  expect(html).toContain("Wanderer");
  expect(html).toContain("Town Square");
  expect(html).toContain("Event 1");
  expect(html).not.toContain("Frame 1");
});

test("the displayed realm follows the actor into the Underworld", () => {
  const html = renderToStaticMarkup(
    <ClientSurface
      view={view()}
      observation={{
        kind: "following",
        target: { kind: "actor", id: "wanderer" },
        locationId: "gate",
        realm: "underworld",
      }}
    />,
  );

  expect(html).toContain('data-realm="underworld"');
  expect(html).toContain("Underworld");
});

test("recent activity changes with the viewed realm and includes non-scene event kinds", () => {
  const realmEvents = view({
    recentEvents: [
      {
        id: "move",
        sequence: 1,
        tick: 1,
        kind: "entity-moved",
        subjects: ["wanderer"],
      },
      {
        id: "worship",
        sequence: 2,
        tick: 2,
        kind: "worship-performed",
        subjects: ["hall"],
      },
      {
        id: "weather",
        sequence: 3,
        tick: 3,
        kind: "weather-changed",
        subjects: ["gate"],
      },
    ] as never,
  });
  const mortalHtml = renderToStaticMarkup(
    <ClientSurface view={realmEvents} observation={{ kind: "idle" }} />,
  );
  const olympusHtml = renderToStaticMarkup(
    <ClientSurface
      view={realmEvents}
      observation={{
        kind: "following",
        target: { kind: "location", id: "hall" },
        locationId: "hall",
        realm: "olympus",
      }}
    />,
  );
  const underworldHtml = renderToStaticMarkup(
    <ClientSurface
      view={realmEvents}
      observation={{
        kind: "following",
        target: { kind: "location", id: "gate" },
        locationId: "gate",
        realm: "underworld",
      }}
    />,
  );

  expect(mortalHtml).toContain("Entity Moved");
  expect(mortalHtml).not.toContain("Worship Performed");
  expect(olympusHtml).toContain("Worship Performed");
  expect(olympusHtml).not.toContain("Entity Moved");
  expect(underworldHtml).toContain("Weather Changed");
  expect(underworldHtml).not.toContain("Worship Performed");
});

test("a lost target shows its held location and reason", () => {
  const html = renderToStaticMarkup(
    <ClientSurface
      view={view()}
      observation={{
        kind: "held",
        target: { kind: "actor", id: "wanderer" },
        reason: "died",
        lastKnown: { locationId: "town-square", realm: "mortal" },
      }}
    />,
  );

  expect(html).toContain("Lost sight: died");
  expect(html).toContain("Town Square");
});

test("catch-up summary is presented as a dismissible panel", () => {
  const summaryView = view({
    catchUpSummary: {
      id: "summary-9",
      appliedMs: 7_200_000,
      skippedMs: 10_800_000,
      majorOutcomes: ["tavern fire spread"],
      atSequence: 9,
    },
  });
  const html = renderToStaticMarkup(
    <ClientSurface view={summaryView} observation={{ kind: "idle" }} />,
  );
  const dismissedHtml = renderToStaticMarkup(
    <ClientSurface
      view={summaryView}
      observation={{ kind: "idle" }}
      dismissedSummary
    />,
  );

  expect(html).toContain("Caught up: 2h applied, 3h skipped");
  expect(html).toContain('aria-label="Dismiss catch-up summary"');
  expect(dismissedHtml).not.toContain("Caught up:");
});

test("paused status is visible without exposing world controls", () => {
  const html = renderToStaticMarkup(
    <ClientSurface
      view={view({ status: "paused" })}
      observation={{ kind: "idle" }}
    />,
  );

  expect(html).toContain("World paused");
  expect(html).not.toContain("Resume");
  expect(html).not.toContain("Stop world");
});

test("degraded status remains visible until a later frame clears it", () => {
  const degraded = view({ status: "degraded", degradedReason: "disk-full" });
  const degradedHtml = renderToStaticMarkup(
    <ClientSurface view={degraded} observation={{ kind: "idle" }} />,
  );
  const runningHtml = renderToStaticMarkup(
    <ClientSurface
      view={view({ sequence: 2, status: "running" })}
      observation={{ kind: "idle" }}
    />,
  );

  expect(degradedHtml).toContain("disk-full");
  expect(runningHtml).not.toContain("disk-full");
});

test("model degradation says models are unavailable while the world runs", () => {
  const html = renderToStaticMarkup(
    <ClientSurface
      view={view({ status: "degraded", degradedReason: "model-degraded" })}
      observation={{ kind: "idle" }}
    />,
  );

  expect(html).toContain("Models unavailable — world running");
  expect(html).not.toContain("World degraded");
  expect(html).toContain('role="status"');
  expect(html).not.toContain(">Degraded</div>");
});

test("store errors retain the halting degraded treatment", () => {
  const html = renderToStaticMarkup(
    <ClientSurface
      view={view({ status: "degraded", degradedReason: "store-error" })}
      observation={{ kind: "idle" }}
    />,
  );

  expect(html).toContain("World degraded");
  expect(html).toContain("store-error");
});

test("successive model-degraded frames keep the banner as ticks and sequence advance", () => {
  const frames = [
    view({
      sequence: 4,
      tick: 6,
      status: "degraded",
      degradedReason: "model-degraded",
    }),
    view({
      sequence: 5,
      tick: 7,
      status: "degraded",
      degradedReason: "model-degraded",
    }),
  ];
  const html = frames.map((frame) =>
    renderToStaticMarkup(
      <ClientSurface view={frame} observation={{ kind: "idle" }} />,
    ),
  );

  expect(html[0]).toContain("Models unavailable — world running");
  expect(html[0]).toContain("Tick 6");
  expect(html[0]).toContain("Event 4");
  expect(html[1]).toContain("Models unavailable — world running");
  expect(html[1]).toContain("Tick 7");
  expect(html[1]).toContain("Event 5");
});
