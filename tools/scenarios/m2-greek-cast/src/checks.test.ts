import { expect, test } from "bun:test";
import {
  differences,
  explainChain,
  isWait,
  memoryChanges,
  type RememberedView,
  tracesIn,
  withoutPrayers,
} from "./checks";

test("tracesIn finds exactly the traces a prompt carries, and none when it carries none", () => {
  const prompt = "You see [evt-4-2] building-ignited at the-tavern.";
  expect(tracesIn(prompt, ["evt-4-2", "the-tavern", "evt-9-9"])).toEqual([
    "evt-4-2",
    "the-tavern",
  ]);
  // Control: a prompt with none of them is clean.
  expect(tracesIn("You are at The Square.", ["evt-4-2", "the-tavern"])).toEqual(
    [],
  );
});

test("isWait recognizes a wait reply and nothing else", () => {
  expect(isWait('{"action":"wait"}')).toBe(true);
  expect(isWait('{ "action": "wait" }')).toBe(true);
  expect(isWait('{"action":"legend","assertion":"x"}')).toBe(false);
  expect(isWait("not json")).toBe(false);
});

const memory = (id: string, salience = 4) => ({
  id,
  kind: "witnessed",
  sourceEventId: "evt-1-1",
  eventKind: "building-ignited",
  salience,
  recordedAt: 3,
  subjects: ["the-tavern"],
});
const relationship = (affinity: number) => ({
  from: "hera",
  toward: "zeus",
  affinity,
  grudge: 0,
  allied: false,
});

function view(
  memories: [string, unknown[]][],
  relationships: [string, unknown][],
): RememberedView {
  return {
    memories: new Map(memories),
    relationships: new Map(relationships),
  } as unknown as RememberedView;
}

test("differences is empty for equal memory and relationships, and names a dropped memory or a changed feeling", () => {
  const live = view(
    [["hera", [memory("evt-5-1"), memory("evt-6-1")]]],
    [["hera>zeus", relationship(-1)]],
  );
  expect(
    differences(
      live,
      view(
        [["hera", [memory("evt-5-1"), memory("evt-6-1")]]],
        [["hera>zeus", relationship(-1)]],
      ),
    ),
  ).toEqual([]);

  // A branch that lost one of Hera's memories.
  expect(
    differences(
      live,
      view([["hera", [memory("evt-5-1")]]], [["hera>zeus", relationship(-1)]]),
    ),
  ).toEqual(["memories of hera differ"]);
  // A branch with the feeling changed, and one with it gone.
  expect(
    differences(
      live,
      view(
        [["hera", [memory("evt-5-1"), memory("evt-6-1")]]],
        [["hera>zeus", relationship(0)]],
      ),
    ),
  ).toEqual(["relationship hera>zeus differs"]);
  expect(
    differences(
      live,
      view([["hera", [memory("evt-5-1"), memory("evt-6-1")]]], []),
    ),
  ).toEqual(["relationship hera>zeus differs"]);
});

test("memoryChanges keeps every retained memory exactly: a lost one, or one with the same id and other content, is named, and a new one only when its kind is allowed", () => {
  const before = view([["zeus", [memory("evt-5-1"), memory("evt-6-1")]]], []);
  const allowed = ["witnessed", "patronage"];
  const changes = (after: RememberedView) =>
    memoryChanges(before, after, ["zeus"], allowed);

  expect(changes(before)).toEqual([]);
  // Control: new memories of an allowed kind are the world's doing; one of any other kind is not.
  const gained = (kind: string) =>
    view(
      [
        [
          "zeus",
          [
            memory("evt-5-1"),
            memory("evt-6-1"),
            { ...memory("evt-9-1"), kind },
          ],
        ],
      ],
      [],
    );
  expect(changes(gained("witnessed"))).toEqual([]);
  expect(changes(gained("patronage"))).toEqual([]);
  expect(changes(gained("told"))).toEqual(["zeus gained told evt-9-1"]);
  // A retained memory dropped.
  expect(changes(view([["zeus", [memory("evt-5-1")]]], []))).toEqual([
    "zeus lost evt-6-1",
  ]);
  // A retained memory whose id is unchanged but whose salience, subjects, or provenance changed.
  for (const changed of [
    { salience: 9 },
    { subjects: ["the-tavern", "hera"] },
    { sourceEventId: "evt-2-2" },
  ]) {
    expect(
      changes(
        view(
          [["zeus", [{ ...memory("evt-5-1"), ...changed }, memory("evt-6-1")]]],
          [],
        ),
      ),
    ).toEqual(["zeus changed evt-5-1"]);
  }
  // Another owner's memories are not judged.
  expect(
    memoryChanges(
      before,
      view(
        [
          ["zeus", [memory("evt-5-1"), memory("evt-6-1")]],
          ["hera", [memory("evt-1-1")]],
        ],
        [],
      ),
      ["zeus"],
      allowed,
    ),
  ).toEqual([]);
});

const event = (
  id: string,
  kind: string,
  extra: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  id,
  sequence: Number(id.split("-")[2]),
  simTime: 0,
  correlationId: "c",
  causationId: "c",
  tick: 1,
  approximate: false,
  kind,
  ...extra,
});

test("explainChain walks a relationship change back through its memory and the report to the strike, from events alone", () => {
  const events = [
    event("evt-1-1", "building-ignited", {
      entityId: "the-tavern",
      cause: { kind: "strike", actor: "zeus" },
    }),
    event("evt-2-2", "report-told", {
      entityId: "zeus",
      listenerId: "hera",
      content: "x",
      linkedEventId: "evt-1-1",
    }),
    event("evt-2-3", "memory-recorded", {
      memoryKind: "told",
      entityId: "hera",
      sourceEventId: "evt-2-2",
      teller: "zeus",
      content: "x",
      subjects: ["zeus"],
      salience: 4,
    }),
    event("evt-2-4", "relationship-changed", {
      entityId: "hera",
      toward: "zeus",
      affinityDelta: -1,
      grudgeDelta: 0,
      memoryEventId: "evt-2-3",
    }),
  ];
  expect(explainChain(events, "evt-2-4")).toEqual([
    "building-ignited",
    "report-told",
    "memory-recorded",
    "relationship-changed",
  ]);
  // Control: with the memory event missing from the log, the chain stops at the change.
  expect(
    explainChain(
      events.filter((e) => e.id !== "evt-2-3"),
      "evt-2-4",
    ),
  ).toEqual(["relationship-changed"]);
});

test("withoutPrayers removes exactly the prayers section of a prompt: its header, its entries and their sub-lines, and nothing after", () => {
  const prompt = [
    "You are at Hall.",
    "Prayers to you:",
    "- [evt-1-2] farmer asks for help with the-tavern (the-tavern burned).",
    "  farmer at Town Square [town-square]: take Gates of Olympus [olympus-gate] toward Town Square.",
    "- [evt-3-4] woodcutter asks for help with food (it lacked food).",
    "You have no goal. You may set one.",
    "Ways out:",
  ].join("\n");
  expect(withoutPrayers(prompt)).toBe(
    [
      "You are at Hall.",
      "You have no goal. You may set one.",
      "Ways out:",
    ].join("\n"),
  );
  // Control: a prompt with none is unchanged, and the same words elsewhere are not removed.
  expect(withoutPrayers("You are at Hall.\nWays out:")).toBe(
    "You are at Hall.\nWays out:",
  );
  const elsewhere =
    "You saw [evt-1-1] building-ignited (the-tavern)\nWays out:";
  expect(withoutPrayers(elsewhere)).toBe(elsewhere);
  expect(tracesIn(withoutPrayers(prompt), ["the-tavern"])).toEqual([]);
  expect(tracesIn(prompt, ["the-tavern"])).toEqual(["the-tavern"]);
});

test("differences can be limited to some owners: a change in someone else's memory or feeling is not reported, and one in a listed owner's is", () => {
  const live = view(
    [
      ["hera", [memory("evt-5-1")]],
      ["farmer", [memory("evt-6-1")]],
    ],
    [
      ["hera>zeus", relationship(-1)],
      ["farmer>zeus", relationship(-2)],
    ],
  );
  const later = view(
    [
      ["hera", [memory("evt-5-1")]],
      ["farmer", [memory("evt-6-1"), memory("evt-9-9")]],
    ],
    [
      ["hera>zeus", relationship(-1)],
      ["farmer>zeus", relationship(-5)],
    ],
  );
  expect(differences(live, later)).toEqual([
    "memories of farmer differ",
    "relationship farmer>zeus differs",
  ]);
  expect(differences(live, later, ["hera", "zeus"])).toEqual([]);
  // Control: a change in a listed owner is still caught.
  const heraLost = view(
    [
      ["hera", []],
      ["farmer", [memory("evt-6-1")]],
    ],
    [["hera>zeus", relationship(-1)]],
  );
  expect(differences(live, heraLost, ["hera"])).toEqual([
    "memories of hera differ",
  ]);
});
