import { afterEach, describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderEngineFor } from "./engine";
import { loadRenderInputs, renderCellsOf } from "./load";

const RENDER_ROOT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "tools",
  "render",
);
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A render root holding only the camera and the Zeus profile, plus any extra profiles. */
function rootWith(extra: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "render-cells-"));
  dirs.push(root);
  cpSync(join(RENDER_ROOT, "camera.json"), join(root, "camera.json"));
  mkdirSync(join(root, "profiles"));
  cpSync(
    join(RENDER_ROOT, "profiles", "zeus.json"),
    join(root, "profiles", "zeus.json"),
  );
  for (const [id, profile] of Object.entries(extra))
    writeFileSync(
      join(root, "profiles", `${id}.json`),
      JSON.stringify(profile),
    );
  return root;
}

const structure = (id: string, width: number, height: number) => ({
  schemaVersion: 1,
  kind: "structure",
  id,
  kitFiles: [],
  build: { kind: "house" },
  cell: { id: "structure", width, height, pivot: [width / 2, height - 10] },
  materials: { wall: { ramp: "marble", bias: 0 } },
  clips: { intact: { loop: false, frames: 1, frameMs: 1000 } },
});

describe("the cells the render engine accepts", () => {
  it("are the camera's cell when only figures are committed", () => {
    expect(renderCellsOf(loadRenderInputs(rootWith()))).toEqual([
      { w: 112, h: 96 },
    ]);
  });

  it("add each structure's own frame once, in profile order", () => {
    const root = rootWith({
      "a-house": structure("a-house", 160, 160),
      "b-house": structure("b-house", 160, 160),
      "c-tree": structure("c-tree", 128, 192),
    });
    expect(renderEngineFor(root).measuredCells).toEqual([
      { w: 160, h: 160 },
      { w: 128, h: 192 },
      { w: 112, h: 96 },
    ]);
  });

  it("are empty when the camera cannot be read", () => {
    const root = rootWith();
    writeFileSync(join(root, "camera.json"), "{");
    expect(renderCellsOf(loadRenderInputs(root))).toEqual([]);
  });

  it("belong to the render provider at generation scale 1", () => {
    const engine = renderEngineFor(RENDER_ROOT);
    expect(engine.generationScale).toBe(1);
    expect(engine.provider.id).toBe("blender-eevee");
  });
});
