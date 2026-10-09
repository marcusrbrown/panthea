import { afterEach, describe, expect, test } from "bun:test";
import type { Sha256 } from "@panthea/contracts";
import { parseConformanceReport } from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { sha256Hex } from "../hash";
import { encodeRgbaPng } from "../placeholder";
import {
  authoredFrames,
  doneCandidate,
  keyframe,
  loadContent,
  PROVISIONAL_TEST_PARAMS,
  removeTempRoots,
  TEST_PALETTE,
  tempRoot,
  toneFrame,
  workingSet,
} from "./_test-fixtures";
import { grayscalePng } from "./_test-runtime";
import {
  applyFinish,
  buildPreview,
  canonicalMeta,
  cropFrames,
  type EditRecord,
  metadataHash,
  parseEditRecord,
  parseSheetJson,
  placeholderMs,
  type SheetExpectation,
  sheetJson,
  startSheet,
  timingBounds,
  timingWarnings,
} from "./export-import";
import { decodePng } from "./png/decode";

afterEach(removeTempRoots);

const content = loadContent();
const cell = { w: 64, h: 80 };
const slots = ["idle/south", "idle/north"];
const expectation: SheetExpectation = {
  slots,
  cell,
  max: { "idle/south": 4, "idle/north": 4 },
};
const doc = (
  specs: {
    slot: string;
    durations: number[];
    pivot?: { x: number; y: number } | null;
  }[],
) =>
  sheetJson(
    specs.map((s) => ({
      slot: s.slot,
      durations: s.durations,
      pivot: s.pivot ?? null,
    })),
    cell,
  );
const eight = () =>
  doc([
    { slot: "idle/south", durations: [167, 167, 167, 167] },
    { slot: "idle/north", durations: [167, 167, 167, 167] },
  ]);
const parsed = (text: string, e: SheetExpectation = expectation) =>
  parseSheetJson(text, e);
// biome-ignore lint/suspicious/noExplicitAny: the tests edit parsed JSON in place
const mutate = (fn: (json: any) => void, base = eight()) => {
  const json = JSON.parse(base);
  fn(json);
  return JSON.stringify(json);
};

describe("the metadata subset", () => {
  test("a document written for two idle slots parses back to the same durations, tags and pivots", () => {
    const result = parsed(
      doc([
        {
          slot: "idle/south",
          durations: [123, 167, 250, 333],
          pivot: { x: 32, y: 80 },
        },
        { slot: "idle/north", durations: [167, 167, 167, 167] },
      ]),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        size: { w: 512, h: 80 },
        durations: [123, 167, 250, 333, 167, 167, 167, 167],
        tags: [
          { name: "idle/south", from: 0, to: 3 },
          { name: "idle/north", from: 4, to: 7 },
        ],
        pivots: { "idle/south": { x: 32, y: 80 }, "idle/north": null },
      },
    });
  });

  test("the pivot may sit on the cell's far edges and nowhere outside them", () => {
    const at = (x: number, y: number) =>
      parsed(
        doc([
          { slot: "idle/south", durations: [167], pivot: { x, y } },
          { slot: "idle/north", durations: [167] },
        ]),
      );

    for (const [x, y] of [
      [0, 0],
      [32, 80],
      [64, 80],
      [64, 0],
    ] as const)
      expect(at(x, y).ok, `${x},${y}`).toBe(true);
    for (const [x, y] of [
      [65, 80],
      [32, 81],
      [-1, 0],
      [0, -1],
    ] as const)
      expect(at(x, y).ok, `${x},${y}`).toBe(false);
  });

  test("a pivot is relative to its slice bounds and lands in the cell once translated", () => {
    const sliced = (bounds: object, pivot: object, extra: object = {}) =>
      mutate((j) => {
        j.meta.slices = [
          {
            name: "pivot:idle/south",
            keys: [{ frame: 0, bounds, pivot, ...extra }],
          },
        ];
      });
    const offset = { x: 10, y: 10, w: 54, h: 70 };

    const moved = parsed(sliced(offset, { x: 22, y: 70 }));
    const centred = parsed(
      sliced(offset, { x: 22, y: 70 }, { center: { x: 1, y: 1, w: 2, h: 2 } }),
    );

    expect(moved.ok && moved.value.pivots["idle/south"]).toEqual({
      x: 32,
      y: 80,
    });
    expect(centred.ok && centred.value.pivots["idle/south"]).toEqual({
      x: 32,
      y: 80,
    });
    expect(parsed(sliced(offset, { x: 54, y: 70 })).ok).toBe(true);
    expect(parsed(sliced(offset, { x: 55, y: 70 })).ok).toBe(false);
    expect(parsed(sliced(offset, { x: 22, y: 71 })).ok).toBe(false);
    expect(parsed(sliced(offset, { x: -10, y: 0 })).ok).toBe(true);
    expect(parsed(sliced(offset, { x: -11, y: 0 })).ok).toBe(false);
  });

  test("a slice's centre is never read as a pivot and unrelated slices and fields are ignored", () => {
    const text = mutate((j) => {
      j.meta.slices = [
        {
          name: "pivot:idle/south",
          color: "#0000ffff",
          keys: [
            {
              frame: 0,
              bounds: { x: 0, y: 0, w: 64, h: 80 },
              center: { x: 1, y: 1, w: 2, h: 2 },
            },
          ],
        },
        {
          name: "hitbox",
          keys: [{ frame: 3, bounds: { x: 900, y: 0, w: 1, h: 1 } }],
        },
      ];
      j.meta.layers = [{ name: "x" }];
      j.meta.app = "other";
      j.frames[0].filename = "anything";
    });

    const result = parsed(text);

    expect(result.ok && result.value.pivots).toEqual({
      "idle/south": null,
      "idle/north": null,
    });
  });

  test("tag repeat 0, absent and 1 are accepted and nothing else", () => {
    const withRepeat = (repeat: unknown) =>
      parsed(
        mutate((j) => {
          j.meta.frameTags[0].repeat = repeat;
        }),
      );

    expect(withRepeat(undefined).ok).toBe(true);
    expect(withRepeat("0").ok).toBe(true);
    expect(withRepeat("1").ok).toBe(true);
    for (const bad of ["2", 1, 0, "", "yes"])
      expect(withRepeat(bad).ok, String(bad)).toBe(false);
    expect(
      parsed(
        mutate((j) => {
          j.meta.frameTags[0].direction = "reverse";
        }),
      ).ok,
    ).toBe(false);
    expect(
      parsed(
        mutate((j) => {
          j.meta.frameTags[0].direction = "pingpong";
        }),
      ).ok,
    ).toBe(false);
  });

  // biome-ignore lint/suspicious/noExplicitAny: the tests edit parsed JSON in place
  const rejects: [string, (j: any) => void][] = [
    [
      "a trimmed frame",
      (j) => {
        j.frames[1].trimmed = true;
      },
    ],
    [
      "a rotated frame",
      (j) => {
        j.frames[1].rotated = true;
      },
    ],
    [
      "a frame at the wrong x",
      (j) => {
        j.frames[2].frame.x += 1;
      },
    ],
    [
      "a frame at the wrong y",
      (j) => {
        j.frames[2].frame.y = 1;
      },
    ],
    [
      "a frame of the wrong width",
      (j) => {
        j.frames[2].frame.w = 63;
      },
    ],
    [
      "a frame of the wrong height",
      (j) => {
        j.frames[2].frame.h = 79;
      },
    ],
    [
      "a source size that is not the cell",
      (j) => {
        j.frames[0].sourceSize = { w: 65, h: 80 };
      },
    ],
    [
      "a sprite source offset",
      (j) => {
        j.frames[0].spriteSourceSize.x = 2;
      },
    ],
    [
      "a sprite source smaller than the cell",
      (j) => {
        j.frames[0].spriteSourceSize.w = 60;
      },
    ],
    [
      "a zero duration",
      (j) => {
        j.frames[0].duration = 0;
      },
    ],
    [
      "a negative duration",
      (j) => {
        j.frames[0].duration = -1;
      },
    ],
    [
      "a fractional duration",
      (j) => {
        j.frames[0].duration = 12.5;
      },
    ],
    [
      "a string duration",
      (j) => {
        j.frames[0].duration = "100";
      },
    ],
    [
      "a sheet size that is not frames times the cell",
      (j) => {
        j.meta.size.w = 500;
      },
    ],
    [
      "a sheet height that is not the cell's",
      (j) => {
        j.meta.size.h = 81;
      },
    ],
    [
      "a tag gap",
      (j) => {
        j.meta.frameTags[0].to = 2;
      },
    ],
    [
      "overlapping tags",
      (j) => {
        j.meta.frameTags[1].from = 3;
      },
    ],
    [
      "a tag that stops short of the last frame",
      (j) => {
        j.meta.frameTags[1].to = 6;
      },
    ],
    [
      "a tag past the last frame",
      (j) => {
        j.meta.frameTags[1].to = 8;
      },
    ],
    [
      "a tag that runs backwards",
      (j) => {
        j.meta.frameTags[0].from = 3;
        j.meta.frameTags[0].to = 0;
      },
    ],
    [
      "a missing slot tag",
      (j) => {
        j.meta.frameTags.pop();
      },
    ],
    [
      "an unknown tag name",
      (j) => {
        j.meta.frameTags[1].name = "idle/west";
      },
    ],
    [
      "a duplicated tag name",
      (j) => {
        j.meta.frameTags[1].name = "idle/south";
      },
    ],
    [
      "tags in the wrong slot order",
      (j) => {
        j.meta.frameTags.reverse();
      },
    ],
    [
      "a slot with more frames than its maximum",
      (j) => {
        j.frames.push(structuredClone(j.frames[7]));
        j.frames[8].frame.x = 512;
        j.meta.size.w = 576;
        j.meta.frameTags[1].to = 8;
      },
    ],
    [
      "a pivot slice with two keys",
      (j) => {
        j.meta.slices = [
          {
            name: "pivot:idle/south",
            keys: [
              {
                frame: 0,
                bounds: { x: 0, y: 0, w: 64, h: 80 },
                pivot: { x: 1, y: 1 },
              },
              { frame: 1, bounds: { x: 0, y: 0, w: 64, h: 80 } },
            ],
          },
        ];
      },
    ],
    [
      "a pivot key on another frame",
      (j) => {
        j.meta.slices = [
          {
            name: "pivot:idle/south",
            keys: [
              {
                frame: 2,
                bounds: { x: 0, y: 0, w: 64, h: 80 },
                pivot: { x: 1, y: 1 },
              },
            ],
          },
        ];
      },
    ],
    [
      "a pivot slice with no keys",
      (j) => {
        j.meta.slices = [{ name: "pivot:idle/south", keys: [] }];
      },
    ],
    [
      "pivot bounds outside the cell",
      (j) => {
        j.meta.slices = [
          {
            name: "pivot:idle/south",
            keys: [{ frame: 0, bounds: { x: 60, y: 0, w: 10, h: 10 } }],
          },
        ];
      },
    ],
    [
      "pivot bounds of zero size",
      (j) => {
        j.meta.slices = [
          {
            name: "pivot:idle/south",
            keys: [{ frame: 0, bounds: { x: 0, y: 0, w: 0, h: 10 } }],
          },
        ];
      },
    ],
    [
      "a pivot slice for an unknown slot",
      (j) => {
        j.meta.slices = [
          {
            name: "pivot:idle/west",
            keys: [{ frame: 0, bounds: { x: 0, y: 0, w: 64, h: 80 } }],
          },
        ];
      },
    ],
    [
      "a duplicated pivot slice",
      (j) => {
        const s = {
          name: "pivot:idle/south",
          keys: [{ frame: 0, bounds: { x: 0, y: 0, w: 64, h: 80 } }],
        };
        j.meta.slices = [s, structuredClone(s)];
      },
    ],
    [
      "a fractional pivot",
      (j) => {
        j.meta.slices = [
          {
            name: "pivot:idle/south",
            keys: [
              {
                frame: 0,
                bounds: { x: 0, y: 0, w: 64, h: 80 },
                pivot: { x: 1.5, y: 2 },
              },
            ],
          },
        ];
      },
    ],
    [
      "no frames",
      (j) => {
        j.frames = [];
        j.meta.frameTags = [];
        j.meta.size.w = 0;
      },
    ],
    [
      "frames that are not an array",
      (j) => {
        j.frames = {};
      },
    ],
    [
      "no meta",
      (j) => {
        delete j.meta;
      },
    ],
  ];
  for (const [name, change] of rejects)
    test(`${name} is rejected`, () => {
      expect(parsed(mutate(change)).ok).toBe(false);
    });

  test("text that is not JSON, truncated JSON and a non-object are rejected", () => {
    for (const text of ["", "{", eight().slice(0, 200), "[]", "null", "7"])
      expect(parsed(text).ok, text.slice(0, 10)).toBe(false);
  });

  test("the metadata hash covers the owned subset only", () => {
    const base = parsed(eight());
    const noisy = parsed(
      mutate((j) => {
        j.meta.app = "x";
        j.frames[0].filename = "y";
        j.meta.layers = [];
      }),
    );
    const longer = parsed(
      mutate((j) => {
        j.frames[0].duration = 168;
      }),
    );
    if (!base.ok || !noisy.ok || !longer.ok)
      throw new Error("fixture rejected");

    expect(metadataHash(noisy.value)).toBe(metadataHash(base.value));
    expect(metadataHash(longer.value)).not.toBe(metadataHash(base.value));
    expect(canonicalMeta(base.value)).toBe(canonicalMeta(noisy.value));
  });
});

const blobs = new Map<string, Uint8Array>();
const putPng = (image: RgbaImage): Sha256 => {
  const png = encodeRgbaPng(image.rgba, image.width, image.height);
  const hash = sha256Hex(png);
  blobs.set(hash, png);
  return hash;
};
const readBlob = (hash: Sha256) => blobs.get(hash);
const strip = (frames: RgbaImage[]): RgbaImage => {
  const width = frames[0]?.width ?? 0;
  const height = frames[0]?.height ?? 0;
  const rgba = new Uint8Array(width * frames.length * height * 4);
  frames.forEach((frame, index) => {
    for (let y = 0; y < height; y += 1)
      rgba.set(
        frame.rgba.subarray(y * width * 4, (y + 1) * width * 4),
        (y * width * frames.length + index * width) * 4,
      );
  });
  return { rgba, width: width * frames.length, height };
};
const pickFor = (slot: string, tone: number, hidden = 0) => ({
  ...keyframe(
    doneCandidate(`pick-${slot.replace("/", "-")}`, { slotKey: slot }),
  ),
  imageHash: putPng(toneFrame(cell, tone, hidden)),
});
const evidence = {
  params: { ...PROVISIONAL_TEST_PARAMS, scale: null },
  palette: { ...TEST_PALETTE, colours: [...TEST_PALETTE.colours] },
} as const;
const ms = (slot: string) => placeholderMs(content, "sprite", slot);

describe("placeholder durations and timing bounds", () => {
  test("derive from the vocabulary's frame rates; states without one and portraits use 100 ms", () => {
    expect(ms("idle/south")).toBe(334);
    expect(ms("act/south/thunderbolt")).toBe(100);
    expect(ms("seated/south")).toBe(100);
    expect(ms("hurt/south")).toBe(100);
    expect(placeholderMs(content, "portrait", "neutral")).toBe(100);
  });

  test("bounds floor the fastest rate and ceil the slowest, as the contracts do", () => {
    expect(timingBounds(content, "sprite", "idle/south")).toEqual({
      min: 166,
      max: 334,
    });
    expect(placeholderMs(content, "sprite", "idle/south")).toBe(334);
  });

  test("warnings list the frames outside their bounds and never the ones inside", () => {
    const preview = (durations: number[]) => ({
      sheetHash: sha256Hex(new Uint8Array([1])),
      metadataHash: sha256Hex(new Uint8Array([2])),
      slots: {
        "idle/south": {
          frames: durations.map((durationMs, i) => ({
            hash: sha256Hex(new Uint8Array([i])),
            durationMs,
          })),
          pivot: null,
          reports: [],
          timing: durations.map((durationMs, frame) => ({
            frame,
            durationMs,
            bounds: timingBounds(content, "sprite", "idle/south"),
          })),
        },
        seated: {
          frames: [],
          pivot: null,
          reports: [],
          timing: [{ frame: 4, durationMs: 9999, bounds: null }],
        },
      },
    });

    const warned = timingWarnings(preview([123, 166, 334, 335, 500]) as never);

    expect(warned.map((w) => [w.slot, w.frame, w.durationMs])).toEqual([
      ["idle/south", 0, 123],
      ["idle/south", 3, 335],
      ["idle/south", 4, 500],
    ]);
    expect(timingWarnings(preview([166, 167, 333, 334]) as never)).toEqual([]);
  });

  test("bounds are the per-frame milliseconds the rate range allows, or none", () => {
    expect(timingBounds(content, "sprite", "idle/south")).toEqual({
      min: 166,
      max: 334,
    });
    expect(timingBounds(content, "sprite", "act/east/thunderbolt")).toEqual({
      min: 83,
      max: 100,
    });
    expect(timingBounds(content, "sprite", "seated/south")).toBeNull();
    expect(timingBounds(content, "portrait", "neutral")).toBeNull();
  });
});

describe("starting a sheet", () => {
  test("a single pick becomes one frame, not four copies, with a placeholder duration and no pivot", () => {
    const set = workingSet("w", {
      picks: { "idle/south": pickFor("idle/south", 0, 5) },
    });

    const result = startSheet({
      set,
      slots: ["idle/south"],
      readBlob,
      placeholderMs: ms,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cell).toEqual(cell);
    expect(result.value.base).toEqual({
      "idle/south": {
        kind: "keyframe",
        candidateId: "pick-idle-south",
        imageHash: set.picks["idle/south"]?.imageHash,
      },
    });
    const sheet = decodePng(result.value.png);
    expect(sheet.ok && [sheet.image.width, sheet.image.height]).toEqual([
      64, 80,
    ]);
    const meta = parseSheetJson(result.value.json, {
      slots: ["idle/south"],
      cell,
      max: { "idle/south": 4 },
    });
    expect(meta.ok && meta.value.durations).toEqual([334]);
    expect(meta.ok && meta.value.pivots).toEqual({ "idle/south": null });
    const pixels = decodePng(result.value.png);
    expect(
      pixels.ok &&
        Buffer.compare(pixels.image.rgba, toneFrame(cell, 0, 5).rgba),
    ).toBe(0);
  });

  test("authored frames are used as they are, with their durations and pivot, next to a picked slot", () => {
    const south = [0, 1, 2].map((tone) => putPng(toneFrame(cell, tone)));
    const set = workingSet("w", {
      picks: { "idle/north": pickFor("idle/north", 3) },
      frames: {
        "idle/south": authoredFrames("e1", 3, {
          frames: south.map((hash, i) => ({
            hash,
            durationMs: [123, 250, 333][i] as number,
          })),
          pivot: { x: 32, y: 80 },
        }),
      },
    });

    const result = startSheet({ set, slots, readBlob, placeholderMs: ms });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = parseSheetJson(result.value.json, expectation);
    expect(meta.ok && meta.value.durations).toEqual([123, 250, 333, 334]);
    expect(meta.ok && meta.value.tags).toEqual([
      { name: "idle/south", from: 0, to: 2 },
      { name: "idle/north", from: 3, to: 3 },
    ]);
    expect(meta.ok && meta.value.pivots).toEqual({
      "idle/south": { x: 32, y: 80 },
      "idle/north": null,
    });
    expect(result.value.base["idle/south"]).toEqual({
      kind: "frames",
      editId: "e1",
      sheetHash: set.frames["idle/south"]?.sheetHash,
    });
    const sheet = decodePng(result.value.png);
    expect(sheet.ok && sheet.image.width).toBe(256);
    expect(
      sheet.ok &&
        Buffer.compare(
          sheet.image.rgba,
          strip([0, 1, 2, 3].map((t) => toneFrame(cell, t))).rgba,
        ),
    ).toBe(0);
  });

  test("a slot with neither a pick nor frames, a missing blob and frames of another size are refused", () => {
    const pick = pickFor("idle/south", 0);
    expect(
      startSheet({
        set: workingSet("w", { picks: { "idle/south": pick } }),
        slots,
        readBlob,
        placeholderMs: ms,
      }).ok,
    ).toBe(false);
    expect(
      startSheet({
        set: workingSet("w", {
          picks: {
            "idle/south": {
              ...pick,
              imageHash: sha256Hex(new Uint8Array([9])),
            },
          },
        }),
        slots: ["idle/south"],
        readBlob,
        placeholderMs: ms,
      }).ok,
    ).toBe(false);
    const small = putPng(toneFrame({ w: 32, h: 40 }, 0));
    expect(
      startSheet({
        set: workingSet("w", {
          picks: {
            "idle/south": pick,
            "idle/north": { ...pick, imageHash: small },
          },
        }),
        slots,
        readBlob,
        placeholderMs: ms,
      }).ok,
    ).toBe(false);
    expect(
      startSheet({
        set: workingSet("w"),
        slots: [],
        readBlob,
        placeholderMs: ms,
      }).ok,
    ).toBe(false);
  });
});

describe("cropping and previews", () => {
  const edit = {
    slots,
    cell,
    evidence: { "idle/south": evidence, "idle/north": evidence },
  };
  const frames = [
    toneFrame(cell, 0, 11),
    toneFrame(cell, 40, 22),
    toneFrame(cell, 0, 33),
    toneFrame(cell, 0, 44),
    toneFrame(cell, 0, 55),
    toneFrame(cell, 40, 66),
    toneFrame(cell, 0, 77),
  ];
  const sheet = strip(frames);
  const meta = (durations: number[], south = 3) => {
    const parsedMeta = parseSheetJson(
      doc([
        { slot: "idle/south", durations: durations.slice(0, south) },
        { slot: "idle/north", durations: durations.slice(south) },
      ]),
      expectation,
    );
    if (!parsedMeta.ok) throw new Error(parsedMeta.message);
    return parsedMeta.value;
  };
  const build = (durations = [100, 200, 300, 335, 100, 100, 100]) =>
    buildPreview({
      image: sheet,
      sheetHash: sha256Hex(new Uint8Array([1])),
      meta: meta(durations),
      edit,
      kind: "sprite",
      content,
    });

  test("cropping returns each cell's exact RGBA, hidden RGB included", () => {
    const crops = cropFrames(sheet, cell);

    expect(crops).toHaveLength(7);
    for (const [index, crop] of crops.entries())
      expect(
        Buffer.compare(crop.rgba, (frames[index] as RgbaImage).rgba),
        String(index),
      ).toBe(0);
  });

  test("a preview stores every frame's exact bytes, a separate proposal and its report, whatever the report says", () => {
    const result = build();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { preview, blobs: out } = result.value;
    const byHash = new Map(out.map((png) => [sha256Hex(png), png]));
    expect(preview.sheetHash).toBe(sha256Hex(new Uint8Array([1])));
    expect(preview.metadataHash).toBe(
      metadataHash(meta([100, 200, 300, 335, 100, 100, 100])),
    );
    expect(
      preview.slots["idle/south"]?.frames.map((f) => f.durationMs),
    ).toEqual([100, 200, 300]);
    expect(preview.slots["idle/north"]?.frames).toHaveLength(4);
    const all = [
      ...(preview.slots["idle/south"]?.frames ?? []),
      ...(preview.slots["idle/north"]?.frames ?? []),
    ];
    all.forEach((frame, index) => {
      const png = byHash.get(frame.hash);
      expect(png).toBeDefined();
      expect(frame.hash).toBe(
        sha256Hex(encodeRgbaPng((frames[index] as RgbaImage).rgba, 64, 80)),
      );
      const back = decodePng(png as Uint8Array);
      expect(
        back.ok &&
          Buffer.compare(back.image.rgba, (frames[index] as RgbaImage).rgba),
      ).toBe(0);
    });
    const south = preview.slots["idle/south"];
    expect(south?.reports).toHaveLength(3);
    for (const entry of south?.reports ?? []) {
      expect(parseConformanceReport(entry.report).ok).toBe(true);
      expect(byHash.has(entry.proposalHash)).toBe(true);
    }
    expect(south?.reports[1]?.report.status).toBe("fail");
    expect(south?.reports[1]?.diff.length).toBeGreaterThan(0);
    expect(south?.reports[1]?.proposalHash).not.toBe(south?.frames[1]?.hash);
  });

  test("timing is diagnostic only: an out-of-range duration is recorded against its bounds and never refused", () => {
    const result = build();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.preview.slots["idle/south"]?.timing).toEqual([
      { frame: 0, durationMs: 100, bounds: { min: 166, max: 334 } },
      { frame: 1, durationMs: 200, bounds: { min: 166, max: 334 } },
      { frame: 2, durationMs: 300, bounds: { min: 166, max: 334 } },
    ]);
    expect(result.value.preview.slots["idle/north"]?.timing[0]).toEqual({
      frame: 3,
      durationMs: 335,
      bounds: { min: 166, max: 334 },
    });
  });

  test("a sheet that is not the metadata's size is refused", () => {
    const result = buildPreview({
      image: strip(frames.slice(0, 6)),
      sheetHash: sha256Hex(new Uint8Array([1])),
      meta: meta([100, 100, 100, 100, 100, 100, 100]),
      edit,
      kind: "sprite",
      content,
    });

    expect(result.ok).toBe(false);
  });
});

describe("finishing", () => {
  const frame = (hash: string, durationMs = 167) => ({
    hash: hash as Sha256,
    durationMs,
  });
  const h = (n: number) => sha256Hex(new Uint8Array([n]));
  const edit: EditRecord = {
    schemaVersion: 1,
    id: "e2",
    workingSetId: "w",
    slots: ["idle/south"],
    cell,
    base: {
      "idle/south": { kind: "keyframe", candidateId: "job-a", imageHash: h(1) },
    },
    evidence: { "idle/south": evidence },
    baseSheet: { sheetHash: h(2), metadataHash: h(3) },
    baseSignature: {
      "idle/south": { frames: [{ hash: h(30), durationMs: 167 }], pivot: null },
    },
    status: "open",
    preview: null,
  };
  const preview = (count: number) => ({
    sheetHash: h(9),
    metadataHash: h(8),
    slots: {
      "idle/south": {
        frames: Array.from({ length: count }, (_, i) => frame(h(20 + i))),
        pivot: { x: 32, y: 80 },
        reports: [],
        timing: [],
      },
    },
  });

  test("puts the frames, basis, pivot and one hand edit into the set and completes it when every slot is full", () => {
    const set = workingSet("w", {
      required: ["idle/south"],
      picks: { "idle/south": keyframe(doneCandidate("job-a")) },
    });

    const result = applyFinish({ set, edit, preview: preview(4) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.frames["idle/south"]).toEqual({
      editId: "e2",
      basis: edit.base["idle/south"],
      sheetHash: h(9),
      frames: preview(4).slots["idle/south"].frames,
      pivot: { x: 32, y: 80 },
      handEdits: [{ description: "hand edit e2", hash: h(9) }],
    });
    expect(result.value.picks).toEqual(set.picks);
    expect(result.value.status).toBe("complete");
  });

  test("a re-edit keeps the earlier hand edits and appends exactly one more", () => {
    const earlier = authoredFrames("e1", 4);
    const set = workingSet("w", {
      required: ["idle/south"],
      frames: { "idle/south": earlier },
      status: "complete",
    });
    const again: EditRecord = {
      ...edit,
      base: {
        "idle/south": {
          kind: "frames",
          editId: "e1",
          sheetHash: earlier.sheetHash,
        },
      },
    };

    const result = applyFinish({ set, edit: again, preview: preview(4) });

    expect(result.ok && result.value.frames["idle/south"]?.handEdits).toEqual([
      ...earlier.handEdits,
      { description: "hand edit e2", hash: h(9) },
    ]);
  });

  test("fewer frames than the slot's minimum are refused and other slots stay as they were", () => {
    const set = workingSet("w", {
      picks: { "idle/south": keyframe(doneCandidate("job-a")) },
    });

    expect(applyFinish({ set, edit, preview: preview(3) }).ok).toBe(false);
    const done = applyFinish({ set, edit, preview: preview(4) });
    expect(done.ok && done.value.status).toBe("open");
    expect(done.ok && Object.keys(done.value.frames)).toEqual(["idle/south"]);
  });
});

describe("the edit record", () => {
  const h = (n: number) => sha256Hex(new Uint8Array([n]));
  const reportOf = {
    schemaVersion: 1,
    status: "pass",
    checks: [{ check: "grid", status: "pass" }],
  };
  // biome-ignore lint/suspicious/noExplicitAny: the tests edit parsed JSON in place
  const record = (): any => ({
    schemaVersion: 1,
    id: "e1",
    workingSetId: "w",
    slots: ["idle/south"],
    cell: { ...cell },
    base: {
      "idle/south": { kind: "keyframe", candidateId: "job-a", imageHash: h(1) },
    },
    evidence: { "idle/south": structuredClone(evidence) },
    baseSheet: { sheetHash: h(2), metadataHash: h(3) },
    baseSignature: {
      "idle/south": { frames: [{ hash: h(30), durationMs: 167 }], pivot: null },
    },
    status: "open",
    preview: {
      sheetHash: h(4),
      metadataHash: h(5),
      slots: {
        "idle/south": {
          frames: [{ hash: h(6), durationMs: 167 }],
          pivot: { x: 32, y: 80 },
          reports: [
            {
              report: reportOf,
              proposalHash: h(7),
              diff: [{ x: 1, y: 2, before: "#01020304", after: "#526471ff" }],
            },
          ],
          timing: [
            { frame: 0, durationMs: 167, bounds: { min: 167, max: 167 } },
          ],
        },
      },
    },
  });

  test("a valid record, with or without a preview, parses and reads back unchanged", () => {
    expect(parseEditRecord(record())).toEqual({ ok: true, value: record() });
    expect(parseEditRecord({ ...record(), preview: null }).ok).toBe(true);
    const nobounds = record();
    nobounds.preview.slots["idle/south"].timing[0].bounds = null;
    expect(parseEditRecord(nobounds).ok).toBe(true);
  });

  // biome-ignore lint/suspicious/noExplicitAny: the tests edit parsed JSON in place
  const bad: [string, (r: any) => void][] = [
    [
      "a base signature for a slot the edit lacks",
      (r) => {
        r.baseSignature["idle/north"] = r.baseSignature["idle/south"];
      },
    ],
    [
      "a slot without a base signature",
      (r) => {
        delete r.baseSignature["idle/south"];
      },
    ],
    [
      "a base signature with no frames",
      (r) => {
        r.baseSignature["idle/south"].frames = [];
      },
    ],
    [
      "a base signature with a bad frame hash",
      (r) => {
        r.baseSignature["idle/south"].frames[0].hash = "x";
      },
    ],
    [
      "a base signature with a fractional duration",
      (r) => {
        r.baseSignature["idle/south"].frames[0].durationMs = 1.5;
      },
    ],
    [
      "a base signature without its pivot",
      (r) => {
        delete r.baseSignature["idle/south"].pivot;
      },
    ],
    [
      "no base signature",
      (r) => {
        delete r.baseSignature;
      },
    ],
    [
      "an unknown key",
      (r) => {
        r.extra = 1;
      },
    ],
    [
      "a status that is not open, finished or discarded",
      (r) => {
        r.status = "weird";
      },
    ],
    [
      "a bad working set id",
      (r) => {
        r.workingSetId = "Not Valid";
      },
    ],
    [
      "no slots",
      (r) => {
        r.slots = [];
      },
    ],
    [
      "a duplicated slot",
      (r) => {
        r.slots = ["idle/south", "idle/south"];
      },
    ],
    [
      "a base for a slot the edit lacks",
      (r) => {
        r.base["idle/north"] = r.base["idle/south"];
      },
    ],
    [
      "a slot without a base",
      (r) => {
        delete r.base["idle/south"];
      },
    ],
    [
      "a slot without evidence",
      (r) => {
        delete r.evidence["idle/south"];
      },
    ],
    [
      "a zero-width cell",
      (r) => {
        r.cell.w = 0;
      },
    ],
    [
      "a base sheet hash that is not a sha256",
      (r) => {
        r.baseSheet.sheetHash = "x";
      },
    ],
    [
      "a preview for a slot the edit lacks",
      (r) => {
        r.preview.slots["idle/north"] = r.preview.slots["idle/south"];
      },
    ],
    [
      "a preview slot with no frames",
      (r) => {
        r.preview.slots["idle/south"].frames = [];
        r.preview.slots["idle/south"].reports = [];
        r.preview.slots["idle/south"].timing = [];
      },
    ],
    [
      "a preview with a report missing",
      (r) => {
        r.preview.slots["idle/south"].reports = [];
      },
    ],
    [
      "a preview with a timing entry missing",
      (r) => {
        r.preview.slots["idle/south"].timing = [];
      },
    ],
    [
      "a preview report that is malformed",
      (r) => {
        r.preview.slots["idle/south"].reports[0].report = { status: "pass" };
      },
    ],
    [
      "a diff pixel with a bad colour",
      (r) => {
        r.preview.slots["idle/south"].reports[0].diff[0].after = "#526471";
      },
    ],
    [
      "a timing entry for the wrong frame",
      (r) => {
        r.preview.slots["idle/south"].timing[0].frame = 3;
      },
    ],
    [
      "timing bounds with min above max",
      (r) => {
        r.preview.slots["idle/south"].timing[0].bounds = { min: 200, max: 100 };
      },
    ],
    [
      "a fractional duration",
      (r) => {
        r.preview.slots["idle/south"].frames[0].durationMs = 1.5;
      },
    ],
    [
      "a preview key that is unknown",
      (r) => {
        r.preview.extra = 1;
      },
    ],
  ];
  for (const [name, change] of bad)
    test(`${name} is rejected`, () => {
      const r = record();
      change(r);
      expect(parseEditRecord(r).ok).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Session-level edits, on a real temporary store.
// ---------------------------------------------------------------------------

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { openStudioSession, type StudioSession } from "./session";
import { readStudioStatus } from "./store";

function openSession(root: string): StudioSession {
  const opened = openStudioSession(root);
  if (opened.kind === "busy") throw new Error("busy");
  return opened.session;
}

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (!name.startsWith("session.lock"))
        out[relative(root, path)] = Buffer.from(readFileSync(path)).toString(
          "base64",
        );
    }
  };
  walk(root);
  return out;
}

const pngBytes = (image: RgbaImage) =>
  encodeRgbaPng(image.rgba, image.width, image.height);

interface Authored {
  readonly slot: string;
  readonly frames: RgbaImage[];
  readonly durations?: number[];
  readonly pivot?: { x: number; y: number } | null;
}
/** What the editor would hand back: a strip and its metadata. */
const authored = (slotsFrames: Authored[]) => ({
  png: pngBytes(strip(slotsFrames.flatMap((s) => s.frames))),
  json: sheetJson(
    slotsFrames.map((s) => ({
      slot: s.slot,
      durations: s.durations ?? s.frames.map(() => 167),
      pivot: s.pivot ?? null,
    })),
    cell,
  ),
});
const frames = (count: number, tone: number, hidden = 0) =>
  Array.from({ length: count }, (_, i) =>
    toneFrame(cell, tone + i, hidden + i),
  );

/** A session with a sprite working set whose two idle slots each hold a pick. */
function rig(options: { slots?: string[]; kind?: "sprite" | "portrait" } = {}) {
  const root = tempRoot();
  const session = openSession(root);
  const required = options.slots ?? slots;
  const picks = Object.fromEntries(
    required.map((slot, index) => [
      slot,
      {
        ...keyframe(
          doneCandidate(`pick-${index}`, {
            slotKey: slot,
            kind: options.kind ?? "sprite",
          }),
        ),
        imageHash: session.store.putBlob(
          pngBytes(toneFrame(cell, index, 9 + index)),
        ),
      },
    ]),
  );
  session.store.putWorkingSet(
    workingSet("w", {
      kind: options.kind ?? "sprite",
      required,
      picks,
      status: options.kind === "portrait" ? "complete" : "open",
    }),
  );
  return { root, session, required };
}
const setOf = (root: string, id = "w") =>
  readStudioStatus(root).workingSets.find((w) => w.id === id);
const editOf = (root: string, id: string) =>
  readStudioStatus(root).edits.find((e) => e.id === id);
const ledgerOf = (root: string) =>
  readStudioStatus(root).commands.map((c) => `${c.type}:${c.jobId}`);
const blockNextLedger = (root: string) => {
  const next = readStudioStatus(root).commands.length + 1;
  mkdirSync(join(root, "commands", `${String(next).padStart(8, "0")}.json`), {
    recursive: true,
  });
};
const bytesOf = (root: string, id = "w") =>
  readFileSync(join(root, "working-sets", `${id}.json`), "utf8");

describe("opening an edit", () => {
  test("writes the sheet and metadata, a record at the picks' basis, and ledgers it", () => {
    const { root, session } = rig();
    const before = bytesOf(root);

    expect(session.openEdit("e1", "w", slots, content)).toEqual({ ok: true });

    const edit = editOf(root, "e1");
    expect(edit).toMatchObject({
      id: "e1",
      workingSetId: "w",
      slots,
      cell,
      status: "open",
      preview: null,
    });
    const set = setOf(root, "w");
    expect(edit?.base).toEqual({
      "idle/south": {
        kind: "keyframe",
        candidateId: "pick-0",
        imageHash: set?.picks["idle/south"]?.imageHash as Sha256,
      },
      "idle/north": {
        kind: "keyframe",
        candidateId: "pick-1",
        imageHash: set?.picks["idle/north"]?.imageHash as Sha256,
      },
    });
    expect(edit?.evidence["idle/south"]).toEqual({
      params: set?.picks["idle/south"]?.params as never,
      palette: set?.picks["idle/south"]?.palette as never,
    });
    const png = session.store.readEditFile("e1", "sheet.png") as Uint8Array;
    const json = new TextDecoder().decode(
      session.store.readEditFile("e1", "sheet.json"),
    );
    const meta = parseSheetJson(json, expectation);
    expect(meta.ok).toBe(true);
    expect(edit?.baseSheet).toEqual({
      sheetHash: sha256Hex(png),
      metadataHash: (meta.ok ? metadataHash(meta.value) : "") as Sha256,
    });
    const sheet = decodePng(png);
    expect(sheet.ok && [sheet.image.width, sheet.image.height]).toEqual([
      128, 80,
    ]);
    expect(ledgerOf(root)).toEqual(["open-edit:e1"]);
    expect(bytesOf(root)).toBe(before);
    session.close();
  });

  test("slots are kept in the working set's order whatever order they were asked for", () => {
    const { root, session } = rig();

    expect(
      session.openEdit("e1", "w", ["idle/north", "idle/south"], content),
    ).toEqual({ ok: true });

    expect(editOf(root, "e1")?.slots).toEqual(slots);
    session.close();
  });

  const refusals: [
    string,
    (r: ReturnType<typeof rig>) => ReturnType<StudioSession["openEdit"]>,
    string,
  ][] = [
    [
      "a bad id",
      (r) => r.session.openEdit("Not Valid", "w", slots, content),
      "invalid-params",
    ],
    [
      "a path-like id",
      (r) => r.session.openEdit("../x", "w", slots, content),
      "invalid-params",
    ],
    [
      "an unknown working set",
      (r) => r.session.openEdit("e1", "nope", slots, content),
      "not-found",
    ],
    [
      "no slots",
      (r) => r.session.openEdit("e1", "w", [], content),
      "invalid-params",
    ],
    [
      "a duplicated slot",
      (r) =>
        r.session.openEdit("e1", "w", ["idle/south", "idle/south"], content),
      "invalid-params",
    ],
    [
      "a slot the set does not need",
      (r) => r.session.openEdit("e1", "w", ["idle/west"], content),
      "invalid-params",
    ],
    [
      "a slot with neither a pick nor frames",
      (r) => {
        r.session.store.putWorkingSet(
          workingSet("bare", {
            picks: {
              "idle/south": setOf(r.root, "w")?.picks["idle/south"] as never,
            },
          }),
        );
        return r.session.openEdit("e1", "bare", slots, content);
      },
      "wrong-state",
    ],
  ];
  for (const [name, attempt, reason] of refusals)
    test(`${name} is refused and nothing is written`, () => {
      const r = rig();
      const before = snapshot(r.root);

      expect(attempt(r)).toMatchObject({ ok: false, reason });

      const after = snapshot(r.root);
      if (name.includes("neither")) delete after["working-sets/bare.json"];
      expect(after).toEqual(before);
      r.session.close();
    });

  test("an id that exists, and a slot already in an open edit, are refused; a disjoint slot is not", () => {
    const { root, session } = rig();
    session.openEdit("e1", "w", ["idle/south"], content);
    const before = snapshot(root);

    expect(session.openEdit("e1", "w", ["idle/north"], content)).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    expect(session.openEdit("e2", "w", slots, content)).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    expect(snapshot(root)).toEqual(before);
    expect(session.openEdit("e2", "w", ["idle/north"], content)).toEqual({
      ok: true,
    });
    session.close();
  });

  test("a discarded or finished edit no longer blocks its slots", () => {
    const { root, session } = rig();
    session.openEdit("e1", "w", slots, content);
    session.discardEdit("e1");

    expect(session.openEdit("e2", "w", slots, content)).toEqual({ ok: true });
    expect(editOf(root, "e2")?.status).toBe("open");
    session.close();
  });

  test("a ledger that cannot be written is refused and leaves no edit record", () => {
    const { root, session } = rig();
    blockNextLedger(root);

    expect(session.openEdit("e1", "w", slots, content)).toMatchObject({
      ok: false,
      reason: "write-failed",
    });

    expect(editOf(root, "e1")).toBeUndefined();
    expect(session.store.readEdit("e1")).toEqual({ kind: "missing" });
    rmSync(join(root, "commands", "00000001.json"), { recursive: true });
    expect(session.openEdit("e1", "w", slots, content)).toEqual({ ok: true });
    session.close();
  });

  test("a sheet that cannot be written is refused before anything is ledgered", () => {
    const { root, session } = rig();
    mkdirSync(join(root, "edits"), { recursive: true });
    writeFileSync(join(root, "edits", "e1"), "in the way");

    expect(session.openEdit("e1", "w", slots, content)).toMatchObject({
      ok: false,
      reason: "write-failed",
    });

    expect(ledgerOf(root)).toEqual([]);
    expect(editOf(root, "e1")).toBeUndefined();
    session.close();
  });
});

const blobNames = (root: string) =>
  existsSync(join(root, "blobs"))
    ? readdirSync(join(root, "blobs")).sort()
    : [];
const opened = () => {
  const r = rig();
  r.session.openEdit("e1", "w", slots, content);
  return r;
};
const full = () =>
  authored([
    { slot: "idle/south", frames: frames(4, 0, 20) },
    { slot: "idle/north", frames: frames(4, 10, 40) },
  ]);

describe("importing an edit", () => {
  test("stores the exact sheet and every frame as drawn, with a preview, and changes no working set", () => {
    const { root, session } = opened();
    const south = frames(3, 0, 20);
    const north = frames(4, 10, 40);
    const edited = authored([
      {
        slot: "idle/south",
        frames: south,
        durations: [123, 167, 250],
        pivot: { x: 32, y: 80 },
      },
      { slot: "idle/north", frames: north },
    ]);
    const setBefore = bytesOf(root);
    const ledgerBefore = ledgerOf(root);

    const result = session.importEdit("e1", edited.png, edited.json, content);

    expect(result).toEqual({ ok: true, changed: true });
    const preview = editOf(root, "e1")?.preview;
    expect(preview?.sheetHash).toBe(sha256Hex(edited.png));
    expect(session.store.readBlob(sha256Hex(edited.png) as Sha256)).toEqual(
      edited.png,
    );
    [...south, ...north].forEach((frame, index) => {
      const slot = index < 3 ? "idle/south" : "idle/north";
      const ref = preview?.slots[slot]?.frames[index < 3 ? index : index - 3];
      const stored = session.store.readBlob(ref?.hash as Sha256);
      expect(stored, String(index)).toEqual(pngBytes(frame));
      const back = decodePng(stored as Uint8Array);
      expect(back.ok && Buffer.compare(back.image.rgba, frame.rgba)).toBe(0);
    });
    expect(
      preview?.slots["idle/south"]?.frames.map((f) => f.durationMs),
    ).toEqual([123, 167, 250]);
    expect(preview?.slots["idle/south"]?.pivot).toEqual({ x: 32, y: 80 });
    expect(preview?.slots["idle/north"]?.pivot).toBeNull();
    expect(editOf(root, "e1")?.status).toBe("open");
    expect(bytesOf(root)).toBe(setBefore);
    expect(ledgerOf(root)).toEqual(ledgerBefore);
    session.close();
  });

  test("a pivot slice with offset bounds is stored as the cell position it names", () => {
    const { root, session } = opened();
    const edited = full();
    const json = mutate((j) => {
      j.meta.slices = [
        {
          name: "pivot:idle/south",
          keys: [
            {
              frame: 0,
              bounds: { x: 10, y: 10, w: 54, h: 70 },
              pivot: { x: 22, y: 70 },
            },
          ],
        },
      ];
    }, edited.json);

    expect(session.importEdit("e1", edited.png, json, content)).toEqual({
      ok: true,
      changed: true,
    });

    expect(editOf(root, "e1")?.preview?.slots["idle/south"]?.pivot).toEqual({
      x: 32,
      y: 80,
    });
    session.close();
  });

  test("an offset pivot that lands outside the cell is refused and writes nothing", () => {
    const { root, session } = opened();
    const edited = full();
    const before = snapshot(root);
    const json = mutate((j) => {
      j.meta.slices = [
        {
          name: "pivot:idle/south",
          keys: [
            {
              frame: 0,
              bounds: { x: 10, y: 10, w: 54, h: 70 },
              pivot: { x: 55, y: 70 },
            },
          ],
        },
      ];
    }, edited.json);

    expect(session.importEdit("e1", edited.png, json, content)).toMatchObject({
      ok: false,
      reason: "invalid-params",
    });
    expect(session.finishEdit("e1", edited.png, json, content)).toMatchObject({
      ok: false,
      reason: "invalid-params",
    });

    expect(snapshot(root)).toEqual(before);
    session.close();
  });

  test("a failing report is accepted; its proposal is stored separately and the hand pixels are untouched", () => {
    const { root, session } = opened();
    const off = authored([
      { slot: "idle/south", frames: frames(4, 40, 3) },
      { slot: "idle/north", frames: frames(4, 60, 5) },
    ]);

    expect(session.importEdit("e1", off.png, off.json, content)).toEqual({
      ok: true,
      changed: true,
    });

    const slot = editOf(root, "e1")?.preview?.slots["idle/south"];
    expect(slot?.reports.every((r) => r.report.status === "fail")).toBe(true);
    slot?.reports.forEach((entry, index) => {
      expect(entry.proposalHash).not.toBe(slot.frames[index]?.hash);
      expect(session.store.readBlob(entry.proposalHash)).toBeDefined();
      expect(entry.diff.length).toBeGreaterThan(0);
      expect(
        session.store.readBlob(slot.frames[index]?.hash as Sha256),
      ).toEqual(pngBytes(frames(4, 40, 3)[index] as RgbaImage));
    });
    session.close();
  });

  test("repeating an import, or importing the sheet the edit started with, changes nothing", () => {
    const { root, session } = opened();
    const base = {
      png: session.store.readEditFile("e1", "sheet.png") as Uint8Array,
      json: new TextDecoder().decode(
        session.store.readEditFile("e1", "sheet.json"),
      ),
    };
    const before = snapshot(root);

    expect(session.importEdit("e1", base.png, base.json, content)).toEqual({
      ok: true,
      changed: false,
    });
    expect(snapshot(root)).toEqual(before);

    const edited = full();
    expect(session.importEdit("e1", edited.png, edited.json, content)).toEqual({
      ok: true,
      changed: true,
    });
    const after = snapshot(root);
    expect(session.importEdit("e1", edited.png, edited.json, content)).toEqual({
      ok: true,
      changed: false,
    });
    expect(snapshot(root)).toEqual(after);
    session.close();
  });

  test("a sheet with identical held frames and a 335 ms idle frame is accepted and only diagnosed", () => {
    const { root, session } = opened();
    const hold = toneFrame(cell, 0, 7);
    const edited = authored([
      {
        slot: "idle/south",
        frames: [hold, hold, hold, hold],
        durations: [335, 167, 167, 167],
      },
      { slot: "idle/north", frames: frames(4, 10, 40) },
    ]);

    expect(session.importEdit("e1", edited.png, edited.json, content)).toEqual({
      ok: true,
      changed: true,
    });

    const timing = editOf(root, "e1")?.preview?.slots["idle/south"]?.timing[0];
    expect(timing).toEqual({
      frame: 0,
      durationMs: 335,
      bounds: { min: 166, max: 334 },
    });
    const hashes = editOf(root, "e1")?.preview?.slots["idle/south"]?.frames.map(
      (f) => f.hash,
    );
    expect(new Set(hashes).size).toBe(1);
    session.close();
  });

  test("three idle frames are previewed; five are refused", () => {
    const { root, session } = opened();
    const short = authored([
      { slot: "idle/south", frames: frames(3, 0) },
      { slot: "idle/north", frames: frames(4, 10) },
    ]);
    const long = authored([
      { slot: "idle/south", frames: frames(5, 0) },
      { slot: "idle/north", frames: frames(4, 10) },
    ]);
    const before = snapshot(root);

    expect(
      session.importEdit("e1", long.png, long.json, content),
    ).toMatchObject({ ok: false, reason: "invalid-params" });
    expect(snapshot(root)).toEqual(before);
    expect(session.importEdit("e1", short.png, short.json, content)).toEqual({
      ok: true,
      changed: true,
    });
    session.close();
  });

  const truncated = (png: Uint8Array) =>
    png.slice(0, Math.floor(png.length / 2));
  const refusals: [string, () => { png: Uint8Array; json: string }, string][] =
    [
      [
        "bytes that are not a PNG",
        () => ({
          png: new TextEncoder().encode("not a png"),
          json: full().json,
        }),
        "corrupt-png",
      ],
      [
        "a truncated PNG",
        () => ({ png: truncated(full().png), json: full().json }),
        "corrupt-png",
      ],
      [
        "an unsupported PNG",
        () => ({ png: grayscaleFor(), json: full().json }),
        "unsupported-png",
      ],
      [
        "malformed metadata",
        () => ({ png: full().png, json: "{ nope" }),
        "invalid-params",
      ],
      [
        "truncated metadata",
        () => ({ png: full().png, json: full().json.slice(0, 300) }),
        "invalid-params",
      ],
      [
        "trimmed metadata",
        () => ({
          png: full().png,
          json: mutate((j) => {
            j.frames[0].trimmed = true;
          }, full().json),
        }),
        "invalid-params",
      ],
      [
        "rotated metadata",
        () => ({
          png: full().png,
          json: mutate((j) => {
            j.frames[0].rotated = true;
          }, full().json),
        }),
        "invalid-params",
      ],
      [
        "overlapping tags",
        () => ({
          png: full().png,
          json: mutate((j) => {
            j.meta.frameTags[1].from = 3;
          }, full().json),
        }),
        "invalid-params",
      ],
      [
        "a tag gap",
        () => ({
          png: full().png,
          json: mutate((j) => {
            j.meta.frameTags[0].to = 2;
          }, full().json),
        }),
        "invalid-params",
      ],
      [
        "a misnamed tag",
        () => ({
          png: full().png,
          json: mutate((j) => {
            j.meta.frameTags[0].name = "walk";
          }, full().json),
        }),
        "invalid-params",
      ],
      [
        "a pivot outside the cell",
        () => ({
          png: full().png,
          json: mutate((j) => {
            j.meta.slices = [
              {
                name: "pivot:idle/south",
                keys: [
                  {
                    frame: 0,
                    bounds: { x: 0, y: 0, w: 64, h: 80 },
                    pivot: { x: 65, y: 80 },
                  },
                ],
              },
            ];
          }, full().json),
        }),
        "invalid-params",
      ],
      [
        "a sheet that is not the metadata's size",
        () => ({
          png: authored([
            { slot: "idle/south", frames: frames(4, 0) },
            { slot: "idle/north", frames: frames(3, 0) },
          ]).png,
          json: full().json,
        }),
        "invalid-params",
      ],
      [
        "a sheet of the wrong height",
        () => ({
          png: pngBytes(
            strip(frames(8, 0).map((f) => ({ ...f, height: 80 }))),
          ).slice(0, 0).length
            ? full().png
            : pngBytes({
                rgba: new Uint8Array(512 * 81 * 4),
                width: 512,
                height: 81,
              }),
          json: full().json,
        }),
        "invalid-params",
      ],
    ];
  for (const [name, make, reason] of refusals)
    test(`${name} is refused as ${reason} and writes nothing`, () => {
      const { root, session } = opened();
      const before = snapshot(root);
      const { png, json } = make();

      expect(session.importEdit("e1", png, json, content)).toMatchObject({
        ok: false,
        reason,
      });

      expect(snapshot(root)).toEqual(before);
      session.close();
    });

  test("a bad import after a good one leaves the earlier preview and its blobs", () => {
    const { root, session } = opened();
    const good = full();
    session.importEdit("e1", good.png, good.json, content);
    const before = snapshot(root);

    expect(
      session.importEdit("e1", good.png.slice(0, 500), good.json, content),
    ).toMatchObject({ ok: false });
    expect(session.importEdit("e1", good.png, "{ half", content)).toMatchObject(
      { ok: false },
    );

    expect(snapshot(root)).toEqual(before);
    expect(editOf(root, "e1")?.preview?.sheetHash).toBe(sha256Hex(good.png));
    session.close();
  });

  test("an unknown edit, a bad id and a finished edit are refused", () => {
    const { root, session } = opened();
    const good = full();
    const before = snapshot(root);

    expect(
      session.importEdit("nope", good.png, good.json, content),
    ).toMatchObject({ ok: false, reason: "not-found" });
    expect(
      session.importEdit("../x", good.png, good.json, content),
    ).toMatchObject({ ok: false, reason: "not-found" });
    session.discardEdit("e1");
    const afterDiscard = snapshot(root);
    expect(
      session.importEdit("e1", good.png, good.json, content),
    ).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(snapshot(root)).toEqual(afterDiscard);
    expect(afterDiscard).not.toEqual(before);
    session.close();
  });

  test("an edit whose basis has since changed is stale and refused", () => {
    const { root, session } = opened();
    const set = setOf(root, "w");
    if (!set) throw new Error("no set");
    session.store.putWorkingSet({
      ...set,
      picks: {
        ...set.picks,
        "idle/south": {
          ...set.picks["idle/south"],
          imageHash: sha256Hex(new Uint8Array([42])),
        },
      },
    });
    const good = full();
    const before = snapshot(root);

    expect(
      session.importEdit("e1", good.png, good.json, content),
    ).toMatchObject({ ok: false, reason: "wrong-state" });

    expect(snapshot(root)).toEqual(before);
    session.close();
  });

  test("blocked blobs and a blocked edit record are write failures, never acknowledged", () => {
    const { root, session } = opened();
    const good = full();
    const before = editOf(root, "e1");

    rmSync(join(root, "blobs"), { recursive: true, force: true });
    writeFileSync(join(root, "blobs"), "in the way");
    expect(
      session.importEdit("e1", good.png, good.json, content),
    ).toMatchObject({ ok: false, reason: "write-failed" });
    expect(editOf(root, "e1")).toEqual(before);
    rmSync(join(root, "blobs"));

    chmodSync(join(root, "edits"), 0o500);
    try {
      expect(
        session.importEdit("e1", good.png, good.json, content),
      ).toMatchObject({ ok: false, reason: "write-failed" });
    } finally {
      chmodSync(join(root, "edits"), 0o700);
    }
    expect(editOf(root, "e1")).toEqual(before);
    expect(session.importEdit("e1", good.png, good.json, content)).toEqual({
      ok: true,
      changed: true,
    });
    session.close();
  });
});

const grayscaleFor = () => grayscalePng(512, 80);

describe("finishing an edit", () => {
  test("puts the frames into the working set with one hand edit per slot and completes it", () => {
    const { root, session } = opened();
    const final = authored([
      {
        slot: "idle/south",
        frames: frames(4, 0, 20),
        durations: [123, 167, 250, 333],
        pivot: { x: 32, y: 80 },
      },
      { slot: "idle/north", frames: frames(4, 10, 40) },
    ]);
    const picksBefore = setOf(root)?.picks;

    expect(session.finishEdit("e1", final.png, final.json, content)).toEqual({
      ok: true,
      changed: true,
    });

    const set = setOf(root);
    const sheetHash = sha256Hex(final.png);
    expect(set?.status).toBe("complete");
    expect(set?.picks).toEqual(picksBefore);
    expect(set?.frames["idle/south"]).toMatchObject({
      editId: "e1",
      sheetHash,
      pivot: { x: 32, y: 80 },
      basis: { kind: "keyframe", candidateId: "pick-0" },
      handEdits: [{ description: "hand edit e1", hash: sheetHash }],
    });
    expect(set?.frames["idle/south"]?.frames.map((f) => f.durationMs)).toEqual([
      123, 167, 250, 333,
    ]);
    expect(set?.frames["idle/north"]?.handEdits).toEqual([
      { description: "hand edit e1", hash: sheetHash },
    ]);
    expect(editOf(root, "e1")?.status).toBe("finished");
    expect(ledgerOf(root)).toEqual(["open-edit:e1", "finish-edit:e1"]);
    session.close();
  });

  test("a scripted finish records a script step with its description on every slot and on the edit; a named hand finish keeps the hand form", () => {
    const scripted = opened();
    const final = full();
    const script = {
      method: "script",
      description:
        "scripted idle loop (tools/probes/art-edit/sprite_idle_c2.py)",
    } as const;

    expect(
      scripted.session.finishEdit("e1", final.png, final.json, content, script),
    ).toEqual({ ok: true, changed: true });

    const sheetHash = sha256Hex(final.png);
    const step = {
      description: script.description,
      method: "script",
      hash: sheetHash,
    } as const;
    expect(setOf(scripted.root)?.frames["idle/south"]?.handEdits).toEqual([
      step,
    ]);
    expect(setOf(scripted.root)?.frames["idle/north"]?.handEdits).toEqual([
      step,
    ]);
    expect(editOf(scripted.root, "e1")?.step).toEqual(script);
    scripted.session.close();

    const named = opened();
    const again = full();
    expect(
      named.session.finishEdit("e1", again.png, again.json, content, {
        method: "hand",
        description: "redrew the left hand",
      }),
    ).toEqual({ ok: true, changed: true });
    expect(setOf(named.root)?.frames["idle/south"]?.handEdits).toEqual([
      { description: "redrew the left hand", hash: sha256Hex(again.png) },
    ]);
    expect(editOf(named.root, "e1")?.step).toEqual({
      method: "hand",
      description: "redrew the left hand",
    });
    named.session.close();
  });

  test("a plain finish records no step on the edit and no method on the hand edit", () => {
    const { root, session } = opened();
    const final = full();
    session.finishEdit("e1", final.png, final.json, content);
    expect(editOf(root, "e1")?.step).toBeUndefined();
    const step = setOf(root)?.frames["idle/south"]?.handEdits[0];
    expect(step).toEqual({
      description: "hand edit e1",
      hash: sha256Hex(final.png),
    });
    expect(step && "method" in step).toBe(false);
    session.close();
  });

  test("a scripted finish without a description or with an unknown method is refused with nothing written", () => {
    const { root, session } = opened();
    const final = full();
    for (const bad of [
      { method: "script" },
      { method: "script", description: "" },
      { method: "magic", description: "x" },
    ]) {
      expect(
        session.finishEdit("e1", final.png, final.json, content, bad as never),
      ).toMatchObject({ ok: false, reason: "invalid-params" });
    }
    expect(editOf(root, "e1")?.status).toBe("open");
    expect(setOf(root)?.status).toBe("open");
    session.close();
  });

  test("a retry after a failed finished mark must repeat the same step", () => {
    const { root, session } = opened();
    const final = full();
    const script = { method: "script", description: "scripted a" } as const;
    chmodSync(join(root, "edits"), 0o500);
    try {
      expect(
        session.finishEdit("e1", final.png, final.json, content, script),
      ).toMatchObject({ ok: false, reason: "write-failed" });
    } finally {
      chmodSync(join(root, "edits"), 0o700);
    }

    expect(
      session.finishEdit("e1", final.png, final.json, content),
    ).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(
      session.finishEdit("e1", final.png, final.json, content, {
        ...script,
        description: "scripted b",
      }),
    ).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(
      session.finishEdit("e1", final.png, final.json, content, script),
    ).toEqual({ ok: true, changed: true });
    expect(editOf(root, "e1")?.step).toEqual(script);
    session.close();
  });

  test("a preview of the same content is reused and finishing needs no second import", () => {
    const { root, session } = opened();
    const final = full();
    session.importEdit("e1", final.png, final.json, content);

    expect(session.finishEdit("e1", final.png, final.json, content)).toEqual({
      ok: true,
      changed: true,
    });

    expect(setOf(root)?.frames["idle/south"]?.frames).toEqual(
      editOf(root, "e1")?.preview?.slots["idle/south"]?.frames,
    );
    session.close();
  });

  test("an unedited sheet, a short slot, an overlong slot and a stale basis are refused with nothing written", () => {
    const { root, session } = opened();
    const base = {
      png: session.store.readEditFile("e1", "sheet.png") as Uint8Array,
      json: new TextDecoder().decode(
        session.store.readEditFile("e1", "sheet.json"),
      ),
    };
    const short = authored([
      { slot: "idle/south", frames: frames(3, 0) },
      { slot: "idle/north", frames: frames(4, 0) },
    ]);
    const long = authored([
      { slot: "idle/south", frames: frames(5, 0) },
      { slot: "idle/north", frames: frames(4, 0) },
    ]);
    const before = snapshot(root);

    expect(
      session.finishEdit("e1", base.png, base.json, content),
    ).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(
      session.finishEdit("e1", short.png, short.json, content),
    ).toMatchObject({ ok: false, reason: "invalid-params" });
    expect(
      session.finishEdit("e1", long.png, long.json, content),
    ).toMatchObject({ ok: false, reason: "invalid-params" });
    expect(
      session.finishEdit("e1", new Uint8Array([1, 2]), full().json, content),
    ).toMatchObject({ ok: false, reason: "corrupt-png" });
    expect(snapshot(root)).toEqual(before);

    const set = setOf(root);
    if (!set) throw new Error("no set");
    session.store.putWorkingSet({
      ...set,
      picks: {
        ...set.picks,
        "idle/south": {
          ...set.picks["idle/south"],
          imageHash: sha256Hex(new Uint8Array([42])),
        },
      },
    });
    const stale = snapshot(root);
    expect(
      session.finishEdit("e1", full().png, full().json, content),
    ).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(snapshot(root)).toEqual(stale);
    session.close();
  });

  test("a blocked ledger is a write failure that leaves the set and the edit as they were", () => {
    const { root, session } = opened();
    const final = full();
    const before = snapshot(root);
    blockNextLedger(root);

    expect(
      session.finishEdit("e1", final.png, final.json, content),
    ).toMatchObject({ ok: false, reason: "write-failed" });

    const {
      [`commands/${String(readStudioStatus(root).commands.length + 1).padStart(8, "0")}.json`]:
        _blocked,
      ...rest
    } = snapshot(root);
    void _blocked;
    expect(Object.keys(rest).filter((k) => !before[k])).toEqual(
      expect.not.arrayContaining(["working-sets/w.json"]),
    );
    expect(bytesOf(root)).toBe(
      Buffer.from(before["working-sets/w.json"] as string, "base64").toString(),
    );
    expect(editOf(root, "e1")?.status).toBe("open");
    session.close();
  });

  test("a failure writing the set can be retried and the retry ledgers nothing twice", () => {
    const { root, session } = opened();
    const final = full();
    chmodSync(join(root, "working-sets"), 0o500);
    try {
      expect(
        session.finishEdit("e1", final.png, final.json, content),
      ).toMatchObject({ ok: false, reason: "write-failed" });
    } finally {
      chmodSync(join(root, "working-sets"), 0o700);
    }
    expect(editOf(root, "e1")?.status).toBe("open");
    expect(setOf(root)?.status).toBe("open");

    expect(session.finishEdit("e1", final.png, final.json, content)).toEqual({
      ok: true,
      changed: true,
    });

    expect(
      ledgerOf(root).filter((entry) => entry === "finish-edit:e1"),
    ).toHaveLength(1);
    expect(setOf(root)?.frames["idle/south"]?.handEdits).toHaveLength(1);
    session.close();
  });

  test("a failure marking the edit finished is retried to completion without a second hand edit or ledger entry", () => {
    const { root, session } = opened();
    const final = full();
    chmodSync(join(root, "edits"), 0o500);
    try {
      expect(
        session.finishEdit("e1", final.png, final.json, content),
      ).toMatchObject({ ok: false, reason: "write-failed" });
    } finally {
      chmodSync(join(root, "edits"), 0o700);
    }
    expect(setOf(root)?.frames["idle/south"]?.editId).toBe("e1");
    expect(editOf(root, "e1")?.status).toBe("open");

    expect(session.finishEdit("e1", final.png, final.json, content)).toEqual({
      ok: true,
      changed: true,
    });

    expect(editOf(root, "e1")?.status).toBe("finished");
    expect(setOf(root)?.frames["idle/south"]?.handEdits).toHaveLength(1);
    expect(setOf(root)?.frames["idle/north"]?.handEdits).toHaveLength(1);
    expect(
      ledgerOf(root).filter((entry) => entry === "finish-edit:e1"),
    ).toHaveLength(1);
    session.close();
  });

  test("a second edit keeps the history, and a pick can no longer replace authored frames", () => {
    const { root, session } = opened();
    const first = full();
    session.finishEdit("e1", first.png, first.json, content);
    const set = setOf(root);

    expect(session.openEdit("e2", "w", ["idle/south"], content)).toEqual({
      ok: true,
    });
    const second = authored([
      { slot: "idle/south", frames: frames(4, 70, 90) },
    ]);
    expect(session.finishEdit("e2", second.png, second.json, content)).toEqual({
      ok: true,
      changed: true,
    });

    const after = setOf(root);
    expect(after?.frames["idle/south"]?.handEdits).toEqual([
      ...(set?.frames["idle/south"]?.handEdits ?? []),
      { description: "hand edit e2", hash: sha256Hex(second.png) },
    ]);
    expect(after?.frames["idle/south"]?.basis).toEqual({
      kind: "frames",
      editId: "e1",
      sheetHash: sha256Hex(first.png),
    });
    expect(after?.frames["idle/north"]).toEqual(set?.frames["idle/north"]);
    session.store.putCandidate(
      doneCandidate("fresh", { slotKey: "idle/south", requestId: "r1" }),
    );
    expect(session.pick("w", "fresh")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    expect(setOf(root)).toEqual(after);
    session.close();
  });

  test("six portrait expressions as single frames complete the set", () => {
    const expressions = [...content.vocabulary.expressions];
    const { root, session } = rig({ slots: expressions, kind: "portrait" });
    expect(expressions).toHaveLength(6);
    expect(session.openEdit("p1", "w", expressions, content)).toEqual({
      ok: true,
    });
    const done = authored(
      expressions.map((slot, index) => ({
        slot,
        frames: [toneFrame(cell, index === 3 ? 30 : index, 3)],
        durations: [100],
      })),
    );

    expect(session.finishEdit("p1", done.png, done.json, content)).toEqual({
      ok: true,
      changed: true,
    });

    expect(Object.keys(setOf(root)?.frames ?? {})).toEqual(expressions);
    expect(setOf(root)?.status).toBe("complete");
    expect(setOf(root)?.frames.neutral?.frames).toHaveLength(1);
    expect(setOf(root)?.frames.grieving?.handEdits).toHaveLength(1);
    session.close();
  });
});

describe("discarding an edit", () => {
  test("leaves the working set byte-identical and keeps the edit's blobs and preview for audit", () => {
    const { root, session } = opened();
    const edited = full();
    session.importEdit("e1", edited.png, edited.json, content);
    const set = bytesOf(root);
    const blobs = blobNames(root);

    expect(session.discardEdit("e1")).toEqual({ ok: true });

    expect(bytesOf(root)).toBe(set);
    expect(blobNames(root)).toEqual(blobs);
    expect(editOf(root, "e1")?.status).toBe("discarded");
    expect(editOf(root, "e1")?.preview?.sheetHash).toBe(sha256Hex(edited.png));
    expect(ledgerOf(root)).toEqual(["open-edit:e1", "discard-edit:e1"]);
    session.close();
  });

  test("an unknown, finished or already discarded edit is refused and a blocked ledger changes nothing", () => {
    const { root, session } = opened();
    const before = snapshot(root);

    expect(session.discardEdit("nope")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(session.discardEdit("../x")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    blockNextLedger(root);
    expect(session.discardEdit("e1")).toMatchObject({
      ok: false,
      reason: "write-failed",
    });
    expect(editOf(root, "e1")?.status).toBe("open");
    rmSync(join(root, "commands", "00000002.json"), { recursive: true });
    expect(snapshot(root)).toEqual(before);

    expect(session.discardEdit("e1")).toEqual({ ok: true });
    expect(session.discardEdit("e1")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });
    session.close();
  });
});

describe("a closed session", () => {
  test("refuses all four edit methods, including retained references, and leaves a new owner's store alone", () => {
    const { root, session: stale } = opened();
    const { openEdit, importEdit, finishEdit, discardEdit } = stale;
    stale.close();
    const owner = openSession(root);
    const good = full();
    const before = snapshot(root);

    expect(openEdit("e9", "w", slots, content)).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(importEdit("e1", good.png, good.json, content)).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(finishEdit("e1", good.png, good.json, content)).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(discardEdit("e1")).toMatchObject({ ok: false, reason: "closed" });
    expect(stale.openEdit("e9", "w", slots, content)).toMatchObject({
      ok: false,
      reason: "closed",
    });

    expect(snapshot(root)).toEqual(before);
    owner.close();
  });
});

// ---------------------------------------------------------------------------
// What counts as an edit, and what a revert leaves behind.
// ---------------------------------------------------------------------------

import { withAncillaryChunk } from "./_test-fixtures";

/** An edit opened on four authored frames per slot, so a real change is a small one. */
function authoredRig() {
  const r = rig();
  const base = full();
  r.session.openEdit("seed", "w", slots, content);
  r.session.finishEdit("seed", base.png, base.json, content);
  r.session.openEdit("e2", "w", slots, content);
  return { ...r, base };
}

const hiddenOnly = (png: Uint8Array): Uint8Array => {
  const decoded = decodePng(png);
  if (!decoded.ok) throw new Error("fixture does not decode");
  const rgba = Uint8Array.from(decoded.image.rgba);
  for (let at = 0; at < rgba.length; at += 4)
    if (rgba[at + 3] === 0) rgba.set([1, 2, 3], at);
  return pngBytes({
    rgba,
    width: decoded.image.width,
    height: decoded.image.height,
  });
};

describe("what counts as an edit", () => {
  const sameCases = (base: {
    png: Uint8Array;
    json: string;
  }): [string, { png: Uint8Array; json: string }][] => [
    [
      "the same pixels re-encoded with an ancillary chunk",
      { png: withAncillaryChunk(base.png), json: base.json },
    ],
    [
      "the same pixels with only the hidden RGB changed",
      { png: hiddenOnly(base.png), json: base.json },
    ],
  ];

  for (const [name, pick] of [
    ["re-encoded", 0],
    ["hidden-only", 1],
  ] as const) {
    test(`${name} identical pixels are no edit: nothing to import and nothing to finish`, () => {
      const { root, session, base } = authoredRig();
      const [, same] = sameCases(base)[pick] as [
        string,
        { png: Uint8Array; json: string },
      ];
      expect(sha256Hex(same.png)).not.toBe(sha256Hex(base.png));
      const before = snapshot(root);

      expect(session.importEdit("e2", same.png, same.json, content)).toEqual({
        ok: true,
        changed: false,
      });
      expect(
        session.finishEdit("e2", same.png, same.json, content),
      ).toMatchObject({ ok: false, reason: "wrong-state" });

      expect(snapshot(root)).toEqual(before);
      expect(ledgerOf(root).filter((l) => l.includes("finish-edit"))).toEqual([
        "finish-edit:seed",
      ]);
      expect(editOf(root, "e2")?.status).toBe("open");
      session.close();
    });
  }

  test("one changed pixel is an edit: finish succeeds with exactly one new hand step", () => {
    const { root, session, base } = authoredRig();
    const changed = frames(4, 0, 20);
    const pixel = (20 * 64 + 20) * 4;
    changed[1]?.rgba.set([255, 0, 255, 255], pixel);
    const edited = authored([
      { slot: "idle/south", frames: changed },
      { slot: "idle/north", frames: frames(4, 10, 40) },
    ]);
    expect(sha256Hex(edited.png)).not.toBe(sha256Hex(base.png));

    expect(session.finishEdit("e2", edited.png, edited.json, content)).toEqual({
      ok: true,
      changed: true,
    });

    const steps = setOf(root)?.frames["idle/south"]?.handEdits.map(
      (h) => h.description,
    );
    expect(steps).toEqual(["hand edit seed", "hand edit e2"]);
    expect(
      setOf(root)?.frames["idle/north"]?.handEdits.map((h) => h.description),
    ).toEqual(["hand edit seed", "hand edit e2"]);
    session.close();
  });

  const timing: [string, () => { png: Uint8Array; json: string }][] = [
    [
      "only a duration",
      () =>
        authored([
          {
            slot: "idle/south",
            frames: frames(4, 0, 20),
            durations: [167, 167, 168, 167],
          },
          { slot: "idle/north", frames: frames(4, 10, 40) },
        ]),
    ],
    [
      "only a pivot",
      () =>
        authored([
          {
            slot: "idle/south",
            frames: frames(4, 0, 20),
            pivot: { x: 32, y: 80 },
          },
          { slot: "idle/north", frames: frames(4, 10, 40) },
        ]),
    ],
  ];
  for (const [name, make] of timing)
    test(`a change to ${name}, with identical pixels, is an edit`, () => {
      const { root, session } = authoredRig();
      const edited = make();

      expect(
        session.importEdit("e2", edited.png, edited.json, content),
      ).toEqual({ ok: true, changed: true });
      expect(
        session.finishEdit("e2", edited.png, edited.json, content),
      ).toEqual({ ok: true, changed: true });

      expect(setOf(root)?.frames["idle/south"]?.handEdits).toHaveLength(2);
      session.close();
    });

  test("a different frame count is an edit even when every frame looks alike", () => {
    const { session } = authoredRig();
    const fewer = authored([
      { slot: "idle/south", frames: frames(3, 0, 20) },
      { slot: "idle/north", frames: frames(4, 10, 40) },
    ]);

    expect(session.importEdit("e2", fewer.png, fewer.json, content)).toEqual({
      ok: true,
      changed: true,
    });
    session.close();
  });

  test("an unedited sheet from picks alone is still refused", () => {
    const { root, session } = opened();
    const base = {
      png: session.store.readEditFile("e1", "sheet.png") as Uint8Array,
      json: new TextDecoder().decode(
        session.store.readEditFile("e1", "sheet.json"),
      ),
    };
    const before = snapshot(root);

    expect(
      session.finishEdit(
        "e1",
        withAncillaryChunk(base.png),
        base.json,
        content,
      ),
    ).toMatchObject({ ok: false, reason: "wrong-state" });

    expect(snapshot(root)).toEqual(before);
    session.close();
  });
});

describe("a preview that is reverted", () => {
  test("importing the starting sheet again clears the preview and leaves everything else as it was", () => {
    const { root, session } = opened();
    const base = {
      png: session.store.readEditFile("e1", "sheet.png") as Uint8Array,
      json: new TextDecoder().decode(
        session.store.readEditFile("e1", "sheet.json"),
      ),
    };
    const edited = full();
    session.importEdit("e1", edited.png, edited.json, content);
    expect(editOf(root, "e1")?.preview).not.toBeNull();
    const blobs = blobNames(root);
    const set = bytesOf(root);
    const ledger = ledgerOf(root);

    expect(session.importEdit("e1", base.png, base.json, content)).toEqual({
      ok: true,
      changed: true,
    });

    expect(editOf(root, "e1")?.preview).toBeNull();
    expect(editOf(root, "e1")?.status).toBe("open");
    expect(readStudioStatus(root).edits[0]?.preview).toBeNull();
    expect(blobNames(root)).toEqual(blobs);
    expect(bytesOf(root)).toBe(set);
    expect(ledgerOf(root)).toEqual(ledger);
    expect(
      session.finishEdit("e1", base.png, base.json, content),
    ).toMatchObject({ ok: false, reason: "wrong-state" });
    const after = snapshot(root);

    expect(session.importEdit("e1", base.png, base.json, content)).toEqual({
      ok: true,
      changed: false,
    });
    expect(snapshot(root)).toEqual(after);
    expect(session.importEdit("e1", edited.png, edited.json, content)).toEqual({
      ok: true,
      changed: true,
    });
    expect(editOf(root, "e1")?.preview?.sheetHash).toBe(sha256Hex(edited.png));
    session.close();
  });

  test("a re-encoded starting sheet reverts the preview too, and the same preview is still a no-op", () => {
    const { root, session } = opened();
    const base = {
      png: session.store.readEditFile("e1", "sheet.png") as Uint8Array,
      json: new TextDecoder().decode(
        session.store.readEditFile("e1", "sheet.json"),
      ),
    };
    const edited = full();
    session.importEdit("e1", edited.png, edited.json, content);
    const before = snapshot(root);
    expect(session.importEdit("e1", edited.png, edited.json, content)).toEqual({
      ok: true,
      changed: false,
    });
    expect(snapshot(root)).toEqual(before);

    expect(
      session.importEdit(
        "e1",
        withAncillaryChunk(base.png),
        base.json,
        content,
      ),
    ).toEqual({ ok: true, changed: true });

    expect(editOf(root, "e1")?.preview).toBeNull();
    session.close();
  });

  test("a failed revert write is never acknowledged and keeps the earlier preview", () => {
    const { root, session } = opened();
    const base = {
      png: session.store.readEditFile("e1", "sheet.png") as Uint8Array,
      json: new TextDecoder().decode(
        session.store.readEditFile("e1", "sheet.json"),
      ),
    };
    const edited = full();
    session.importEdit("e1", edited.png, edited.json, content);
    chmodSync(join(root, "edits"), 0o500);
    try {
      expect(
        session.importEdit("e1", base.png, base.json, content),
      ).toMatchObject({ ok: false, reason: "write-failed" });
    } finally {
      chmodSync(join(root, "edits"), 0o700);
    }

    expect(editOf(root, "e1")?.preview?.sheetHash).toBe(sha256Hex(edited.png));
    session.close();
  });
});
