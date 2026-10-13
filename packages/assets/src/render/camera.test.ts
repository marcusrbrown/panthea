// The one camera (ADR-0012): tools/render/camera.json defines the 2:1 orthographic view, the
// light and the cell math once. Requests carry no camera id; the hash joins the revision recipe.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Camera, cameraHash, cellGeometry, parseCamera } from "./camera";

const COMMITTED_CAMERA = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "tools",
  "render",
  "camera.json",
);

function committed(): unknown {
  return JSON.parse(readFileSync(COMMITTED_CAMERA, "utf8"));
}

function parsed(value: unknown = committed()): Camera {
  const result = parseCamera(value);
  if (!result.ok) throw new Error(`${result.path}: ${result.message}`);
  return result.value;
}

function tampered(change: (camera: Record<string, unknown>) => void): unknown {
  const copy = structuredClone(committed()) as Record<string, unknown>;
  change(copy);
  return copy;
}

describe("the committed camera", () => {
  it("parses and yields the 112x96 god-tall cell with pivot (56, 78)", () => {
    const geometry = cellGeometry(parsed());
    expect(geometry.cell).toEqual({ width: 112, height: 96 });
    expect(geometry.pivot).toEqual({ x: 56, y: 78 });
    expect(geometry.renderSize).toEqual({ width: 448, height: 384 });
  });

  it("is the 2:1 view of the probe: 60 degrees down, 45 turned, 29.0788 px per unit", () => {
    const camera = parsed();
    expect(camera.rotationDeg).toEqual([60, 0, 45]);
    expect(camera.pixelsPerUnit).toBe(29.0788);
    expect(camera.supersample).toBe(4);
  });

  it("spans the cell height in world units and shifts the pivot off the image centre", () => {
    const geometry = cellGeometry(parsed());
    expect(geometry.orthoScale).toBeCloseTo(96 / 29.0788, 12);
    expect(geometry.pivotShiftUnits.x).toBeCloseTo(0, 12);
    expect(geometry.pivotShiftUnits.y).toBeCloseTo((78 - 48) / 29.0788, 12);
  });

  it("hashes stably, whatever order the keys arrive in", () => {
    const camera = parsed();
    expect(cameraHash(camera)).toMatch(/^[0-9a-f]{64}$/);
    expect(cameraHash(parsed())).toBe(cameraHash(camera));
    const reversed = Object.fromEntries(
      Object.entries(committed() as object).reverse(),
    );
    expect(cameraHash(parsed(reversed))).toBe(cameraHash(camera));
  });
});

describe("a tampered camera", () => {
  it("changes its hash (each field of the view, the cell and the look)", () => {
    const base = cameraHash(parsed());
    const changes: ((camera: Record<string, unknown>) => void)[] = [
      (c) => {
        c.pixelsPerUnit = 29.0789;
      },
      (c) => {
        c.supersample = 2;
      },
      (c) => {
        (c.cell as { pivot: number[] }).pivot = [56, 77];
      },
      (c) => {
        (c.light as { sunStrength: number }).sunStrength = 3.7;
      },
      (c) => {
        (c.shading as { bandStarts: number[] }).bandStarts = [
          0, 0.41, 0.58, 0.76, 0.92,
        ];
      },
    ];
    for (const change of changes) {
      expect(cameraHash(parsed(tampered(change)))).not.toBe(base);
    }
  });

  it("is refused when it is no longer a 2:1 view, or when its parts disagree", () => {
    const refused: ((camera: Record<string, unknown>) => void)[] = [
      (c) => {
        c.rotationDeg = [55, 0, 45];
      },
      (c) => {
        (c.cell as { pivot: number[] }).pivot = [112, 78];
      },
      (c) => {
        (c.shading as { bandShades: number[] }).bandShades = [1, 2, 3];
      },
      (c) => {
        (c.shading as { bandStarts: number[] }).bandStarts = [
          0, 0.6, 0.5, 0.7, 0.9,
        ];
      },
      (c) => {
        c.supersample = 0;
      },
      (c) => {
        c.projection = "perspective";
      },
      (c) => {
        c.cameraId = "other";
      },
    ];
    for (const change of refused) {
      expect(parseCamera(tampered(change)).ok).toBe(false);
    }
  });
});
