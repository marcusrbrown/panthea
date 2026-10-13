// The script contract is shared by render.py, the runner's parsers and U7's test fake: the
// recipe input, the per-slot done.json sentinel, and the exit-code table with its status mapping.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sha256 } from "@panthea/contracts";
import { parseCamera } from "./camera";
import { parseProfile } from "./profile";
import {
  classifyExit,
  classifyTermination,
  type DoneSentinel,
  EXIT_CODES,
  FIRST_LINE_MARKER,
  ID_BASE,
  ID_STEP,
  PART_IDS,
  parseDoneSentinel,
  parseRenderRecipe,
  type RecipeSlot,
  type RenderRecipe,
  renderDoneJson,
  renderRecipeJson,
  SENTINEL_NAME,
} from "./script-contract";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const read = (...parts: string[]) =>
  readFileSync(join(REPO_ROOT, ...parts), "utf8");

function recipe(): RenderRecipe {
  const camera = parseCamera(JSON.parse(read("tools/render/camera.json")));
  const profile = parseProfile(
    JSON.parse(read("tools/render/profiles/zeus.json")),
  );
  if (!camera.ok || !profile.ok)
    throw new Error("committed inputs do not parse");
  return {
    schemaVersion: 1,
    blender: { version: "5.2.2", buildHash: "d13f752e3b9c" },
    stagingRoot: "/tmp/staging",
    camera: camera.value,
    profile: profile.value,
    palette: {
      id: "greek-retro",
      digest: "a".repeat(64) as Sha256,
      ramps: [
        ...new Set(Object.values(profile.value.materials).map((m) => m.ramp)),
      ].map((id) => ({
        id,
        shades: [
          "#76572f",
          "#947039",
          "#b38b43",
          "#c8a559",
          "#ddbf70",
          "#f4e4ae",
        ],
      })),
    },
    slots: [
      {
        id: "idle-south",
        state: "idle",
        facing: "south",
        frames: 4,
        outDir: "/tmp/out/idle-south",
      },
      {
        id: "walk-east",
        state: "walk",
        facing: "east",
        frames: 16,
        outDir: "/tmp/out/walk-east",
      },
    ],
  };
}

function sentinel(frames = 3): DoneSentinel {
  const roleFiles = (role: string) =>
    Array.from({ length: frames }, (_, i) => ({
      name: `${role}/${String(i).padStart(2, "0")}.png`,
      sha256:
        `${role === "colour" ? "1" : role === "id" ? "2" : "3"}${String(i)}`.padEnd(
          64,
          "0",
        ) as Sha256,
    }));
  return {
    schemaVersion: 1,
    slot: "idle-south",
    blender: { version: "5.2.2", buildHash: "d13f752e3b9c" },
    frames,
    files: {
      colour: roleFiles("colour"),
      id: roleFiles("id"),
      depth: roleFiles("depth"),
    },
    sourceFrames: Array.from({ length: frames }, (_, i) => i * 2.5),
    extentPx: Array.from({ length: frames }, () => ({
      top: 10,
      bottom: 78,
      left: 40,
      right: 72,
    })),
    locators: Array.from({ length: frames }, () => ({
      bolt: { basePx: [60, 50], tipPx: [66, 30], baseDepth: 19.5 },
      points: { eyes_l: { px: [55, 20], depth: 19.2 } },
    })),
  };
}

describe("the exit-code table", () => {
  it("maps no GPU context and a version mismatch to unavailable, an input error to failed", () => {
    expect(EXIT_CODES).toEqual({
      ok: 0,
      scriptError: 1,
      noGpuContext: 10,
      versionMismatch: 11,
      inputError: 12,
    });
    expect(classifyExit(0)).toEqual({ ok: true, value: "ok" });
    expect(classifyExit(10)).toEqual({ ok: true, value: "unavailable" });
    expect(classifyExit(11)).toEqual({ ok: true, value: "unavailable" });
    expect(classifyExit(12)).toEqual({ ok: true, value: "failed" });
    expect(classifyExit(1)).toEqual({ ok: true, value: "failed" });
  });

  it("refuses an unknown exit code", () => {
    expect(classifyExit(99).ok).toBe(false);
    expect(classifyExit(-1).ok).toBe(false);
    expect(classifyExit(2.5).ok).toBe(false);
  });

  it("reads death by signal before the first script line as unavailable, and after it as failed", () => {
    expect(
      classifyTermination({
        signal: "SIGSEGV",
        sawFirstLine: false,
        aborted: false,
      }),
    ).toBe("unavailable");
    expect(
      classifyTermination({
        signal: "SIGSEGV",
        sawFirstLine: true,
        aborted: false,
      }),
    ).toBe("failed");
  });

  it("reads a signal after the runner's own abort as aborted, not failed", () => {
    expect(
      classifyTermination({
        signal: "SIGTERM",
        sawFirstLine: true,
        aborted: true,
      }),
    ).toBe("aborted");
    expect(
      classifyTermination({
        signal: "SIGKILL",
        sawFirstLine: false,
        aborted: true,
      }),
    ).toBe("aborted");
  });

  it("matches the constants render.py exits with", () => {
    const script = read("tools/render/blender/render.py");
    const numbers = (name: string) =>
      Number(new RegExp(`^${name} = (\\d+)`, "m").exec(script)?.[1]);
    expect(numbers("EXIT_OK")).toBe(EXIT_CODES.ok);
    expect(numbers("EXIT_SCRIPT_ERROR")).toBe(EXIT_CODES.scriptError);
    expect(numbers("EXIT_NO_GPU")).toBe(EXIT_CODES.noGpuContext);
    expect(numbers("EXIT_VERSION")).toBe(EXIT_CODES.versionMismatch);
    expect(numbers("EXIT_INPUT")).toBe(EXIT_CODES.inputError);
    expect(script).toContain(`FIRST_LINE_MARKER = "${FIRST_LINE_MARKER}"`);
    expect(script).toContain(`SENTINEL_NAME = "${SENTINEL_NAME}"`);
  });
});

describe("the part-ID table", () => {
  it("is the one render.py draws, in the same order", () => {
    const script = read("tools/render/blender/render.py");
    const block = /^PART_IDS = \(([\s\S]*?)^\)/m.exec(script)?.[1] ?? "";
    expect([...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])).toEqual([
      ...PART_IDS,
    ]);
    expect(script).toContain(`ID_BASE, ID_STEP = ${ID_BASE}, ${ID_STEP}`);
  });
});

describe("the recipe input", () => {
  it("round-trips through its JSON form", () => {
    const original = recipe();
    const again = parseRenderRecipe(JSON.parse(renderRecipeJson(original)));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value).toEqual(original);
  });

  it("refuses a recipe with no slots, a duplicate slot id, a state the profile does not pose, or a frame count of zero", () => {
    const base = recipe();
    const attempts: RenderRecipe[] = [
      { ...base, slots: [] },
      {
        ...base,
        slots: [base.slots[0] as RecipeSlot, base.slots[0] as RecipeSlot],
      },
      {
        ...base,
        slots: [{ ...(base.slots[0] as RecipeSlot), state: "walk16" }],
      },
      { ...base, slots: [{ ...(base.slots[0] as RecipeSlot), frames: 0 }] },
    ];
    for (const attempt of attempts) {
      expect(parseRenderRecipe(JSON.parse(renderRecipeJson(attempt))).ok).toBe(
        false,
      );
    }
  });

  it("refuses a palette that lacks a ramp the profile's materials use", () => {
    const base = recipe();
    const result = parseRenderRecipe(
      JSON.parse(
        renderRecipeJson({ ...base, palette: { ...base.palette, ramps: [] } }),
      ),
    );
    expect(result.ok).toBe(false);
  });

  it("refuses unknown keys and a missing pin", () => {
    const json = JSON.parse(renderRecipeJson(recipe()));
    expect(parseRenderRecipe({ ...json, extra: 1 }).ok).toBe(false);
    const { blender: _pin, ...unpinned } = json;
    expect(parseRenderRecipe(unpinned).ok).toBe(false);
  });
});

describe("the done.json sentinel", () => {
  it("round-trips: frame count and one sha256 per file per role", () => {
    const original = sentinel();
    const again = parseDoneSentinel(JSON.parse(renderDoneJson(original)));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value).toEqual(original);
  });

  it("is accepted against the slot and frame count the runner expects", () => {
    const result = parseDoneSentinel(JSON.parse(renderDoneJson(sentinel(16))), {
      slot: "idle-south",
      frames: 16,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a frame count that the files, extents or locators do not match", () => {
    const base = sentinel();
    expect(parseDoneSentinel({ ...base, frames: 4 }).ok).toBe(false);
    expect(
      parseDoneSentinel({ ...base, extentPx: base.extentPx.slice(1) }).ok,
    ).toBe(false);
    expect(
      parseDoneSentinel({ ...base, sourceFrames: base.sourceFrames.slice(1) })
        .ok,
    ).toBe(false);
    expect(
      parseDoneSentinel({ ...base, locators: base.locators.slice(1) }).ok,
    ).toBe(false);
  });

  it("refuses a missing, extra or short role", () => {
    const base = sentinel();
    const { depth: _depth, ...two } = base.files;
    expect(parseDoneSentinel({ ...base, files: two }).ok).toBe(false);
    expect(
      parseDoneSentinel({
        ...base,
        files: { ...base.files, normal: base.files.colour },
      }).ok,
    ).toBe(false);
    expect(
      parseDoneSentinel({
        ...base,
        files: { ...base.files, id: base.files.id.slice(1) },
      }).ok,
    ).toBe(false);
  });

  it("refuses a duplicate or escaping file name and a malformed hash", () => {
    const base = sentinel();
    const dup = [...base.files.colour];
    dup[1] = dup[0] as never;
    expect(
      parseDoneSentinel({ ...base, files: { ...base.files, colour: dup } }).ok,
    ).toBe(false);
    const escaping = [...base.files.colour];
    escaping[0] = { name: "../x.png", sha256: escaping[0]?.sha256 as never };
    expect(
      parseDoneSentinel({ ...base, files: { ...base.files, colour: escaping } })
        .ok,
    ).toBe(false);
    const bad = [...base.files.colour];
    bad[0] = { name: "colour/00.png", sha256: "nope" as never };
    expect(
      parseDoneSentinel({ ...base, files: { ...base.files, colour: bad } }).ok,
    ).toBe(false);
  });

  it("refuses a sentinel for another slot or another frame count than expected", () => {
    const text = JSON.parse(renderDoneJson(sentinel(3)));
    expect(parseDoneSentinel(text, { slot: "walk-east", frames: 3 }).ok).toBe(
      false,
    );
    expect(parseDoneSentinel(text, { slot: "idle-south", frames: 16 }).ok).toBe(
      false,
    );
  });
});
