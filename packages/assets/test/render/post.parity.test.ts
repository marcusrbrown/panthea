// Parity of the TypeScript post step with the probe's Python one, over the committed raw-frame
// fixture (one slot of the r3 zeus-tall render). The expected cells are the probe's own output,
// made once by tools/probes/retro-render/export_parity_fixture.py; this test needs no Blender,
// no ffmpeg and no Python. When the two disagree, the difference is reported pixel by pixel.

import { describe, expect, it } from "bun:test";
import type { RgbaImage } from "../../src/conformance";
import { cellPixelHash, postProcessSlot } from "../../src/render/post";
import { loadRenderFixture } from "./fixture";

const fixture = loadRenderFixture();
const result = postProcessSlot(fixture.input);

/** The first few pixels where two cells differ, as readable text; empty when they are equal. */
function differences(a: RgbaImage, b: RgbaImage): string[] {
  const out: string[] = [];
  for (let at = 0; at < a.rgba.length && out.length < 8; at += 4) {
    const alpha = a.rgba[at + 3] === 0 && b.rgba[at + 3] === 0;
    if (alpha) continue;
    for (let k = 0; k < 4; k += 1) {
      if (a.rgba[at + k] !== b.rgba[at + k]) {
        const px = at / 4;
        out.push(
          `(${px % a.width},${Math.floor(px / a.width)}): ts ${[...a.rgba.subarray(at, at + 4)]} probe ${[...b.rgba.subarray(at, at + 4)]}`,
        );
        break;
      }
    }
  }
  return out;
}

describe("post-step parity with the probe", () => {
  it("processes the fixture slot", () => {
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.cells).toHaveLength(fixture.expected.cells.length);
  });

  for (const expected of fixture.expected.cells) {
    describe(expected.name, () => {
      const cell = result.ok
        ? result.cells.find((c) => c.name === expected.name)
        : undefined;
      const probe = fixture.expectedImages.get(expected.name) as RgbaImage;

      it("matches the probe's cell pixel for pixel", () => {
        expect(cell).toBeDefined();
        const image = (cell as NonNullable<typeof cell>).image;
        expect([image.width, image.height]).toEqual([
          probe.width,
          probe.height,
        ]);
        expect(differences(image, probe)).toEqual([]);
      });

      it("has the probe's decoded-pixel hash", () => {
        expect(cellPixelHash(probe) as string).toBe(expected.pixelHash);
        expect(
          cellPixelHash((cell as NonNullable<typeof cell>).image) as string,
        ).toBe(expected.pixelHash);
      });

      it("reports the probe's measurements", () => {
        const facts = (cell as NonNullable<typeof cell>).facts;
        expect({
          height: facts.height,
          width: facts.width,
          bottomRow: facts.bottomRow,
          colours: facts.colours,
          outsidePalette: facts.outsidePalette,
          coloursFigure: facts.coloursFigure,
          outsidePaletteFigure: facts.outsidePaletteFigure,
          outline: facts.outline,
          binaryAlpha: facts.binaryAlpha,
          box: [...facts.box],
          overlapPx: facts.overlapPx,
          unknownIdPx: facts.unknownIdPx,
        }).toEqual({
          height: expected.height,
          width: expected.width,
          bottomRow: expected.bottomRow,
          colours: expected.colours,
          outsidePalette: expected.outsidePalette,
          coloursFigure: expected.coloursFigure,
          outsidePaletteFigure: expected.outsidePaletteFigure,
          outline: expected.outline,
          binaryAlpha: expected.binaryAlpha,
          box: [...expected.box],
          overlapPx: expected.overlapPx,
          unknownIdPx: expected.unknownIdPx,
        });
      });

      it("records the probe's stamp counts", () => {
        const stamps = (cell as NonNullable<typeof cell>).facts.stamps;
        expect(stamps.face).toEqual(expected.stamps.face);
        const bolt = expected.stamps.bolt;
        expect(stamps.bolt).toEqual(
          bolt === undefined
            ? undefined
            : {
                angle: bolt.angle,
                drawn: bolt.drawn,
                total: bolt.total,
                coreDrawn: bolt.core_drawn,
                coreTotal: bolt.core_total,
                occluded: bolt.occluded,
                protected: bolt.protected,
                clipped: bolt.clipped,
                outlineOnBody: bolt.outline_on_body,
              },
        );
      });
    });
  }

  it("reports the probe's slot envelope", () => {
    if (!result.ok) throw new Error(result.message);
    const probe = fixture.expected.envelope;
    expect(result.envelope).toMatchObject({
      left: probe.left,
      right: probe.right,
      up: probe.up,
      down: probe.down,
      margin: probe.margin,
      minMargin: probe.min_margin,
    });
  });

  it("covers the stamp paths the slot exists for: face, bolt, depth occlusion and protected hand", () => {
    if (!result.ok) throw new Error(result.message);
    const bolts = result.cells.map((c) => c.facts.stamps.bolt);
    expect(result.cells.every((c) => c.facts.stamps.face.drawn > 0)).toBe(true);
    expect(bolts.some((b) => (b?.occluded ?? 0) > 0)).toBe(true);
    expect(bolts.every((b) => (b?.protected ?? 0) > 0)).toBe(true);
    expect(new Set(bolts.map((b) => b?.angle)).size).toBeGreaterThan(1);
  });
});
