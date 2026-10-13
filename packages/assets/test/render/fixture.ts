// Loads the committed raw-frame fixture for the post step: one slot of the probe's r3 zeus-tall
// render (cast, west, six frames) with the cells the probe's own post step made from it.
// See ../fixtures/render/README.md for where it came from and how to regenerate it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RgbaImage } from "../../src/conformance";
import { parsePalette } from "../../src/palette";
import type {
  Facing,
  PostStepInput,
  PostStepSettings,
  RawFrame,
  StampLocators,
} from "../../src/render/post";
import { type PostPalette, postPaletteOf } from "../../src/render/post-palette";
import { postSettingsFor } from "../../src/render/recipe";
import { type LoadedStampSet, loadStampSet } from "../../src/render/stamps";
import { decodePng } from "../../src/studio/png/decode";

export const FIXTURE_DIR = join(import.meta.dir, "..", "fixtures", "render");
export const RENDER_ROOT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "tools",
  "render",
);
export const PALETTE_FAMILIES = ["town", "olympus", "underworld"] as const;

interface FramesFile {
  readonly item: string;
  readonly slot: string;
  readonly cell: readonly [number, number];
  readonly originPx: readonly [number, number];
  readonly pivotPx: readonly [number, number];
  readonly depthRange: readonly [number, number];
  readonly overlapThresholdM: number;
  readonly shadow: {
    readonly rx: number;
    readonly ry: number;
    readonly ramp: string;
    readonly shade: number;
  };
  readonly frames: readonly {
    readonly name: string;
    readonly facing: Facing;
    readonly locators: StampLocators;
  }[];
}

/** The probe's per-cell facts, in its own (snake_case) stamp record. */
export interface ExpectedCell {
  readonly name: string;
  readonly pixelHash: string;
  readonly height: number;
  readonly width: number;
  readonly bottomRow: number;
  readonly colours: number;
  readonly outsidePalette: number;
  readonly coloursFigure: number;
  readonly outsidePaletteFigure: number;
  readonly outline: boolean;
  readonly binaryAlpha: boolean;
  readonly box: readonly number[];
  readonly overlapPx: number;
  readonly unknownIdPx: number;
  readonly stamps: {
    readonly face: {
      readonly planned: number;
      readonly drawn: number;
      readonly skipped: number;
    };
    readonly bolt?: {
      readonly angle: number;
      readonly drawn: number;
      readonly total: number;
      readonly core_drawn: number;
      readonly core_total: number;
      readonly occluded: number;
      readonly protected: number;
      readonly clipped: number;
      readonly outline_on_body: number;
    };
  };
}

export interface ExpectedFile {
  readonly envelope: {
    readonly left: number;
    readonly right: number;
    readonly up: number;
    readonly down: number;
    readonly margin: {
      readonly left: number;
      readonly right: number;
      readonly top: number;
      readonly bottom: number;
    };
    readonly min_margin: number;
  };
  readonly cells: readonly ExpectedCell[];
}

export interface RenderFixture {
  readonly slot: string;
  /** The probe's settings (post-step v1: its ground tone, `olive` shade 1), for the parity test. */
  readonly settings: PostStepSettings;
  readonly palette: PostPalette;
  readonly stamps: LoadedStampSet;
  readonly frames: readonly RawFrame[];
  readonly expected: ExpectedFile;
  /** The probe's cells, decoded. */
  readonly expectedImages: ReadonlyMap<string, RgbaImage>;
  /** The probe's input: parity with the probe is held at these settings. */
  readonly input: PostStepInput;
  /** The same slot under the current post step: the contact shadow from the Zeus profile's olympus ramp. */
  readonly current: PostStepInput;
}

const readJson = <T>(...parts: string[]): T =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, ...parts), "utf8")) as T;

export function decodeFile(path: string): RgbaImage {
  const decoded = decodePng(new Uint8Array(readFileSync(path)));
  if (!decoded.ok) throw new Error(`${path}: ${decoded.message}`);
  return decoded.image;
}

/** The ramp the committed Zeus profile takes its contact shadow from. */
function zeusShadowRamp(): string {
  const profile = JSON.parse(
    readFileSync(join(RENDER_ROOT, "profiles", "zeus.json"), "utf8"),
  ) as { shadow: { ramp: string } };
  return profile.shadow.ramp;
}

export function loadRenderFixture(): RenderFixture {
  const file = readJson<FramesFile>("frames.json");
  const parsedPalette = parsePalette(
    {
      json: readJson<unknown>("palette", "palette.json"),
      gpl: readFileSync(join(FIXTURE_DIR, "palette", "master.gpl"), "utf8"),
      hex: readFileSync(join(FIXTURE_DIR, "palette", "master.hex"), "utf8"),
    },
    PALETTE_FAMILIES,
  );
  if (!parsedPalette.ok) throw new Error(parsedPalette.message);
  const palette = postPaletteOf(parsedPalette.value);
  if (!palette.ok) throw new Error(palette.message);
  const stamps = loadStampSet(RENDER_ROOT, "zeus");
  if (!stamps.ok)
    throw new Error(stamps.problems.map((p) => p.message).join("; "));

  const settings: PostStepSettings = {
    cell: { w: file.cell[0], h: file.cell[1] },
    originPx: file.originPx,
    pivotPx: file.pivotPx,
    depthRange: file.depthRange,
    overlapThresholdM: file.overlapThresholdM,
    shadow: file.shadow,
  };
  const frames: RawFrame[] = file.frames.map((frame) => ({
    name: frame.name,
    facing: frame.facing,
    colour: decodeFile(join(FIXTURE_DIR, "frames", `${frame.name}.colour.png`)),
    id: decodeFile(join(FIXTURE_DIR, "frames", `${frame.name}.id.png`)),
    depth: decodeFile(join(FIXTURE_DIR, "frames", `${frame.name}.depth.png`)),
    locators: frame.locators,
  }));
  const expected = readJson<ExpectedFile>("expected.json");
  return {
    slot: file.slot,
    settings,
    palette: palette.value,
    stamps: stamps.set,
    frames,
    expected,
    expectedImages: new Map(
      expected.cells.map((cell) => [
        cell.name,
        decodeFile(join(FIXTURE_DIR, "expected", `${cell.name}.png`)),
      ]),
    ),
    input: {
      slot: file.slot,
      settings,
      palette: palette.value,
      stamps: stamps.set,
      frames,
    },
    current: {
      slot: file.slot,
      settings: {
        ...settings,
        shadow: postSettingsFor(zeusShadowRamp()).shadow,
      },
      palette: palette.value,
      stamps: stamps.set,
      frames,
    },
  };
}
