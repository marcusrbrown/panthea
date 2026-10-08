import { afterEach, describe, expect, test } from "bun:test";
import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { parsePalette } from "../palette";
import {
  assetRig,
  doneCandidate,
  finishSheet,
  keyframe,
  loadContent,
  nativeFigure,
  needsScaleCandidate,
  olympusMovedPaletteFiles,
  PROVISIONAL_TEST_PARAMS,
  paintFigure,
  removeTempRoots,
  runSlots,
  spriteSet,
  upscale,
  withHiddenRgb,
  workingSet,
} from "./_test-fixtures";
import {
  reportOnly,
  sheet,
  slotConformance,
  sortSheet,
  summarizeSheet,
} from "./reports";
import { buildSpec } from "./request";

const content = loadContent();

describe("sortSheet", () => {
  const pool = [
    needsScaleCandidate("stuck-b", { ordinal: 1 }),
    doneCandidate("fail-low", { pass: false, pixelsChanged: 1, ordinal: 9 }),
    doneCandidate("pass-high", { pixelsChanged: 9, ordinal: 3 }),
    doneCandidate("pass-z", { pixelsChanged: 2, ordinal: 5 }),
    doneCandidate("pass-b", { pixelsChanged: 2, ordinal: 5 }),
    doneCandidate("pass-early", { pixelsChanged: 2, ordinal: 4 }),
    needsScaleCandidate("stuck-a", { ordinal: 1 }),
    needsScaleCandidate("stuck-first", { ordinal: 0 }),
    doneCandidate("fail-high", { pass: false, pixelsChanged: 7, ordinal: 0 }),
  ];
  const expected = [
    "pass-early",
    "pass-b",
    "pass-z",
    "pass-high",
    "fail-low",
    "fail-high",
    "stuck-first",
    "stuck-a",
    "stuck-b",
  ];

  test("passing before failing before needs-scale, then fewest pixels changed, ordinal and id", () => {
    expect(sortSheet(pool).map((c) => c.id)).toEqual(expected);
  });

  test("the order is the same for every input order and the input is not mutated", () => {
    let state = 12345;
    const next = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state;
    };
    for (let round = 0; round < 25; round += 1) {
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = next() % (i + 1);
        [shuffled[i], shuffled[j]] = [
          shuffled[j] as (typeof pool)[number],
          shuffled[i] as (typeof pool)[number],
        ];
      }
      const frozen = Object.freeze([...shuffled]);
      const before = frozen.map((c) => c.id);
      expect(sortSheet(frozen).map((c) => c.id)).toEqual(expected);
      expect(frozen.map((c) => c.id)).toEqual(before);
    }
  });
});

describe("sheet and summarizeSheet", () => {
  const first = doneCandidate("a-1", {
    requestId: "sheet-a",
    slotKey: "idle/south",
    ordinal: 0,
    pixelsChanged: 5,
  });
  const better = doneCandidate("a-2", {
    requestId: "sheet-a",
    slotKey: "idle/south",
    ordinal: 1,
    pixelsChanged: 1,
  });
  const stuck = needsScaleCandidate("a-3", {
    requestId: "sheet-a",
    slotKey: "idle/south",
    ordinal: 2,
  });
  const north = doneCandidate("a-4", {
    requestId: "sheet-a",
    slotKey: "idle/north",
    ordinal: 3,
    pass: false,
  });
  const old = doneCandidate("old-1", {
    requestId: "sheet-old",
    slotKey: "idle/north",
    ordinal: 0,
  });
  const set = workingSet("set", {
    sheetRequestId: "sheet-a",
    picks: { "idle/north": keyframe(old) },
  });
  const status = {
    candidates: [north, stuck, first, old, better],
    workingSets: [set],
  };

  test("shows the current sheet's candidates by slot, sorted, with an earlier sheet's pick still visible", () => {
    const view = sheet(status, "set");

    expect(view?.workingSet).toEqual(set);
    expect(view?.slots.map((s) => s.slotKey)).toEqual([
      "idle/south",
      "idle/north",
    ]);
    expect(view?.slots[0]?.candidates.map((c) => c.id)).toEqual([
      "a-2",
      "a-1",
      "a-3",
    ]);
    expect(view?.slots[1]?.candidates.map((c) => c.id)).toEqual(["a-4"]);
    expect(view?.slots[0]?.pick).toBeUndefined();
    expect(view?.slots[1]?.pick?.candidateId).toBe("old-1");
    expect(sheet(status, "missing")).toBeUndefined();
  });

  test("the summary counts candidates, passes, stuck grids, picks and the working status", () => {
    const view = sheet(status, "set");
    if (!view) throw new Error("no sheet");

    expect(summarizeSheet(view)).toEqual({
      workingSetId: "set",
      status: "open",
      required: 2,
      picked: 1,
      slots: [
        {
          slotKey: "idle/south",
          candidates: 3,
          done: 2,
          passing: 2,
          needsScale: 1,
          picked: false,
        },
        {
          slotKey: "idle/north",
          candidates: 1,
          done: 1,
          passing: 0,
          needsScale: 0,
          picked: true,
        },
      ],
    });
  });
});

describe("reportOnly", () => {
  const request = {
    schemaVersion: 1 as const,
    subject: "zeus",
    kind: "sprite" as const,
    slots: [{ state: "idle", direction: "south" }],
    batch: 1,
    seed: 1,
  };
  const built = buildSpec(content, request);
  if (!built.ok) throw new Error("spec");
  const spec = built.value;
  const figure = nativeFigure(content);

  test("reports on the image as it is, returns the raw bytes unchanged and writes nothing", () => {
    const hidden = withHiddenRgb(upscale(figure, 8), 5);
    const copy = Uint8Array.from(hidden.rgba);

    const result = reportOnly(hidden, spec, PROVISIONAL_TEST_PARAMS);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.mode).toBe("report-only");
    expect(Buffer.compare(result.image.rgba, copy)).toBe(0);
    expect(Buffer.compare(hidden.rgba, copy)).toBe(0);
    expect(result.image.width).toBe(512);
    expect(result.proposal.width).toBe(64);
    expect(result.proposal.height).toBe(80);
  });

  test("hidden RGB under alpha 0 changes neither the report, the proposal nor the diff", () => {
    const one = reportOnly(
      withHiddenRgb(upscale(figure, 8), 1),
      spec,
      PROVISIONAL_TEST_PARAMS,
    );
    const two = reportOnly(
      withHiddenRgb(upscale(figure, 8), 9),
      spec,
      PROVISIONAL_TEST_PARAMS,
    );

    expect(one.status === "done" && two.status === "done").toBe(true);
    if (one.status !== "done" || two.status !== "done") return;
    expect(one.report).toEqual(two.report);
    expect(one.diff).toEqual(two.diff);
    expect(Buffer.compare(one.proposal.rgba, two.proposal.rgba)).toBe(0);
  });

  test("an image at the cell size is evaluated without a resize and returned untouched", () => {
    const result = reportOnly(figure, spec, PROVISIONAL_TEST_PARAMS);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.metrics.resize.factor).toBe(1);
    expect(Buffer.compare(result.image.rgba, figure.rgba)).toBe(0);
    expect(result.report.status).toBe("pass");
  });
});

describe("slotConformance", () => {
  afterEach(removeTempRoots);

  const tree = (root: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (!name.startsWith("session.lock"))
          out[relative(root, path)] = readFileSync(path).toString("base64");
      }
    };
    walk(root);
    return out;
  };

  const moved = (rig: ReturnType<typeof assetRig>) => {
    const files = olympusMovedPaletteFiles();
    const palette = parsePalette(
      {
        json: JSON.parse(files["palette.json"]),
        gpl: files["master.gpl"],
        hex: files["master.hex"],
      },
      rig.content.vocabulary.paletteFamilies,
    );
    if (!palette.ok) throw new Error(palette.message);
    return { ...rig.content, palette: palette.value };
  };

  test("a clean hand-finished slot reports every frame against the current palette with no diff", () => {
    const rig = assetRig();
    spriteSet(rig);

    const result = slotConformance(rig.root, "w", "idle/south", rig.content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("hand");
    expect(result.frames.map((f) => f.index)).toEqual([0, 1, 2, 3]);
    expect(
      result.frames.every(
        (f) => f.report.status === "pass" && f.diff.length === 0,
      ),
    ).toBe(true);
    rig.session.close();
  });

  test("the same stored frames under a changed approved palette are reported fresh, with the replacing diff, and every stored byte is left alone", () => {
    const rig = assetRig();
    spriteSet(rig);
    const before = tree(rig.root);

    const result = slotConformance(rig.root, "w", "idle/south", moved(rig));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames.every((f) => f.report.status === "fail")).toBe(true);
    expect(result.frames.every((f) => f.diff.length > 0)).toBe(true);
    expect(tree(rig.root)).toEqual(before);
    rig.session.close();
  });

  test("a stored off-palette pixel is still reported with its own diff, from the stored params and not the stored report", () => {
    const rig = assetRig();
    const [id] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    rig.session.pick("w", id as string);
    const frames = [0, 1, 2, 3].map((i) =>
      paintFigure(rig.content, { w: 64, h: 80 }, i),
    );
    frames[1]?.rgba.set([255, 0, 255, 255], (20 * 64 + 20) * 4);
    finishSheet(rig, "e1", "w", { w: 64, h: 80 }, [
      { slot: "idle/south", frames },
    ]);

    const result = slotConformance(rig.root, "w", "idle/south", rig.content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames.map((f) => f.diff.length > 0)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(result.frames[1]?.diff.some((d) => d.x === 20 && d.y === 20)).toBe(
      true,
    );
    rig.session.close();
  });

  test("a slot that is only picked is reported from the picked native image", () => {
    const rig = assetRig();
    const [id] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    rig.session.pick("w", id as string);

    const clean = slotConformance(rig.root, "w", "idle/south", rig.content);
    const changed = slotConformance(rig.root, "w", "idle/south", moved(rig));

    expect(clean).toMatchObject({ ok: true, source: "pick" });
    expect(clean.ok && clean.frames).toHaveLength(1);
    expect(changed.ok && changed.frames[0]?.report.status).toBe("fail");
    expect(changed.ok && (changed.frames[0]?.diff.length ?? 0) > 0).toBe(true);
    rig.session.close();
  });

  test("it reads a root another session owns and leaves it open", () => {
    const rig = assetRig();
    spriteSet(rig);

    const result = slotConformance(rig.root, "w", "idle/south", rig.content);

    expect(result.ok).toBe(true);
    rig.session.close();
  });

  test("an unknown working set or slot, and a slot with nothing stored, are not found", () => {
    const rig = assetRig();
    const [id] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    void id;

    expect(
      slotConformance(rig.root, "nope", "idle/south", rig.content),
    ).toMatchObject({ ok: false, reason: "not-found" });
    expect(
      slotConformance(rig.root, "w", "idle/west", rig.content),
    ).toMatchObject({ ok: false, reason: "not-found" });
    expect(
      slotConformance(rig.root, "w", "idle/south", rig.content),
    ).toMatchObject({ ok: false, reason: "not-found" });
    rig.session.close();
  });

  test("a missing, altered or undecodable stored frame is a typed failure, never a throw", () => {
    const rig = assetRig();
    spriteSet(rig);
    const set = rig.session.store.status().workingSets[0];
    const hash = set?.frames["idle/south"]?.frames[2]?.hash as string;
    const file = join(rig.root, "blobs", `${hash}.png`);
    const good = readFileSync(file);

    writeFileSync(file, "no longer the stored image");
    const altered = slotConformance(rig.root, "w", "idle/south", rig.content);
    rmSync(file);
    const missing = slotConformance(rig.root, "w", "idle/south", rig.content);
    writeFileSync(file, good);
    const restored = slotConformance(rig.root, "w", "idle/south", rig.content);

    expect(altered).toMatchObject({ ok: false, reason: "corrupt-blob" });
    expect(missing).toMatchObject({ ok: false, reason: "corrupt-blob" });
    expect(JSON.stringify([altered, missing])).not.toContain(
      "no longer the stored image",
    );
    expect(restored.ok).toBe(true);
    rig.session.close();
  });

  test("content that cannot build the slot's spec is a typed failure", () => {
    const rig = assetRig();
    spriteSet(rig);

    const result = slotConformance(rig.root, "w", "idle/south", {
      ...rig.content,
      visuals: [],
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    rig.session.close();
  });
});
