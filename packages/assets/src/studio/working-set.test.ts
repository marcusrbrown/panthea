// The rendered working-set entry: picking a render job fills a slot with all its frames and no edit
// step, the set counts the slot as done, and the entry round-trips through the record parser.

import { describe, expect, test } from "bun:test";
import type { ConformanceReport, Sha256 } from "@panthea/contracts";
import { content, RENDER_ROOT } from "../../test/render/rig";
import type { RenderedCandidate } from "../render/candidate";
import { renderEngineFor } from "../render/engine";
import { DEFAULT_CONFORM } from "./derivation";
import { newRequestRecord } from "./request";
import {
  newWorkingSet,
  parseWorkingSetRecord,
  pickRendered,
  slotBasisOf,
  type WorkingSetRecord,
} from "./working-set";

const H = (c: string) => c.repeat(64) as Sha256;
const PASS: ConformanceReport = {
  schemaVersion: 1,
  status: "pass",
  checks: [],
};

function request(id: string, slots: { state: string; direction: string }[]) {
  const built = newRequestRecord(
    content,
    {
      id,
      subject: "zeus",
      kind: "sprite",
      slots,
      render: { palette: "greek-retro", pivot: { x: 56, y: 78 } },
    },
    () => 0,
    renderEngineFor(RENDER_ROOT),
  );
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value.record;
}

function candidate(
  jobId: string,
  requestId: string,
  slotKey: string,
  frames = 16,
  over: Partial<RenderedCandidate> = {},
): RenderedCandidate {
  return {
    schemaVersion: 1,
    id: jobId,
    source: { requestId, slotKey, ordinal: 0 },
    subject: "zeus",
    kind: "sprite",
    slotKey,
    manifest: H("e"),
    revisionRecipeHash: H("a"),
    slotRecipeHash: H("b"),
    postStepVersion: 1,
    frames: Array.from({ length: frames }, (_, i) => ({
      hash: H(String.fromCharCode(48 + (i % 10))),
      durationMs: 50,
      report: PASS,
    })),
    loopStart: 0,
    params: DEFAULT_CONFORM,
    target: {
      cell: { id: "god-tall", w: 112, h: 96 },
      pivot: { x: 56, y: 78 },
      palette: {
        id: "greek-retro",
        family: "olympus",
        digest: null,
        colours: ["#000000"],
      },
    },
    ...over,
  };
}

const walk = request("zeus-retro-walk", [
  { state: "walk", direction: "south" },
]);
function open(
  slots = [{ state: "walk", direction: "south" }],
  id = "zeus-retro-walk",
) {
  const made = newWorkingSet("zeus-set", request(id, slots), content);
  if (!made.ok) throw new Error(made.message);
  return made.record;
}

describe("picking a rendered candidate", () => {
  test("fills the slot with all its frames and no edit step, and the set counts it as done", () => {
    const set = open();
    expect(set.status).toBe("open");
    const picked = pickRendered(
      set,
      candidate("zeus-retro-walk-0000", "zeus-retro-walk", "walk/south"),
    );
    if (!picked.ok) throw new Error(picked.message);

    const entry = picked.record.rendered?.["walk/south"];
    expect(entry?.jobId).toBe("zeus-retro-walk-0000");
    expect(entry?.frames).toHaveLength(16);
    expect(entry?.frames.every((f) => f.durationMs === 50)).toBe(true);
    expect(entry?.loopStart).toBe(0);
    expect(entry?.revisionRecipeHash).toBe(H("a"));
    expect(entry?.slotRecipeHash).toBe(H("b"));
    expect(entry?.postStep).toEqual({ version: 1 });
    expect(picked.record.picks).toEqual({});
    expect(picked.record.frames).toEqual({});
    expect(picked.record.status).toBe("complete");
    expect(slotBasisOf(picked.record, "walk/south")).toEqual({
      kind: "rendered",
      jobId: "zeus-retro-walk-0000",
      manifest: H("e"),
    });
  });

  test("an image pick alone still does not complete a sprite (positive control for the rendered branch)", () => {
    expect(open().status).toBe("open");
  });

  test("a picked render replaces an earlier render pick of the same slot", () => {
    const first = pickRendered(
      open(),
      candidate("zeus-retro-walk-0000", "zeus-retro-walk", "walk/south"),
    );
    if (!first.ok) throw new Error(first.message);
    const second = pickRendered(
      first.record,
      candidate("zeus-retro-walk-0000", "zeus-retro-walk", "walk/south", 16, {
        slotRecipeHash: H("c"),
      }),
    );
    if (!second.ok) throw new Error(second.message);
    expect(second.record.rendered?.["walk/south"]?.slotRecipeHash).toBe(H("c"));
  });

  test("round-trips through the record parser; a status that disagrees with its entries is refused", () => {
    const picked = pickRendered(
      open(),
      candidate("zeus-retro-walk-0000", "zeus-retro-walk", "walk/south"),
    );
    if (!picked.ok) throw new Error(picked.message);
    const text = JSON.parse(JSON.stringify(picked.record));
    const parsed = parseWorkingSetRecord(text);
    expect(parsed).toEqual({ ok: true, value: picked.record });
    expect(parseWorkingSetRecord({ ...text, status: "open" }).ok).toBe(false);
  });

  const refusals: [
    string,
    (set: WorkingSetRecord) => ReturnType<typeof pickRendered>,
    RegExp,
  ][] = [
    [
      "a candidate drawn for another slot",
      (set) =>
        pickRendered(
          set,
          candidate("zeus-retro-walk-0000", "zeus-retro-walk", "idle/south"),
        ),
      /not one this working set needs|drawn for/,
    ],
    [
      "a candidate of another request than the sheet",
      (set) =>
        pickRendered(set, candidate("other-0000", "other", "walk/south")),
      /current sheet/,
    ],
    [
      "a candidate of another subject",
      (set) =>
        pickRendered(
          set,
          candidate(
            "zeus-retro-walk-0000",
            "zeus-retro-walk",
            "walk/south",
            16,
            { subject: "hera" },
          ),
        ),
      /not a sprite for zeus|subject/,
    ],
    [
      "a frame count the slot's rule does not allow",
      (set) =>
        pickRendered(
          set,
          candidate("zeus-retro-walk-0000", "zeus-retro-walk", "walk/south", 6),
        ),
      /16-16 frames|frames/,
    ],
  ];
  for (const [name, attempt, reason] of refusals)
    test(`refuses ${name}`, () => {
      const result = attempt(open());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(reason);
    });

  test("a render pick is refused over a slot with authored frames, which it would not replace", () => {
    const set = open();
    const authored: WorkingSetRecord = {
      ...set,
      frames: {
        "walk/south": {
          editId: "an-edit",
          basis: {
            kind: "rendered",
            jobId: "zeus-retro-walk-0000",
            manifest: H("e"),
          },
          sheetHash: H("1"),
          frames: Array.from({ length: 16 }, () => ({
            hash: H("2"),
            durationMs: 50,
          })),
          pivot: null,
          handEdits: [],
        },
      },
      status: "complete",
    };
    const result = pickRendered(
      authored,
      candidate("zeus-retro-walk-0000", "zeus-retro-walk", "walk/south"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/authored frames/);
  });
});

void walk;
