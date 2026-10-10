import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GodProfile } from "@panthea/content";
import {
  type AssetVocabulary,
  parseGenerationJob,
  parseGenerationRequest,
} from "@panthea/contracts";
import type { Palette } from "../palette";
import { loadContent } from "./_test-fixtures";
import { PROVIDER, SELECTED_PROFILE } from "./provider";
import {
  adapterInput,
  buildSpec,
  DEFAULT_BATCH,
  newRequestRecord,
  planJobs,
  type RequestInput,
  type StudioContent,
  slotKey,
} from "./request";

const repo = join(import.meta.dir, "..", "..", "..", "..");
const probeRoot = join(repo, "tools", "probes", "art-local-2");
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8"));

const content = loadContent();
const zeus = content.gods.find((g) => g.id === "zeus") as GodProfile;

function ok<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const idleSouth: RequestInput = {
  subject: "zeus",
  kind: "sprite",
  slots: [{ state: "idle", direction: "south" }],
};
const sixExpressions: RequestInput = {
  subject: "zeus",
  kind: "portrait",
  slots: content.vocabulary.expressions.map((expression) => ({ expression })),
};
const neverDraw = () => {
  throw new Error("the seed supplier must not be called");
};

describe("spec derivation", () => {
  test("Zeus idle-south joins the profiles, vocabulary, palette and art guide", () => {
    const { record } = ok(
      newRequestRecord(
        content,
        { id: "zeus-idle", ...idleSouth, seed: 11 },
        neverDraw,
      ),
    );
    const spec = ok(buildSpec(content, record.request));

    expect(spec).toMatchObject({
      subject: "zeus",
      name: "Zeus",
      kind: "sprite",
      domains: zeus.domains,
      iconography: ["thunderbolt"],
      cell: { id: "god", w: 64, h: 80 },
      native: { w: 64, h: 80 },
      generated: { w: 512, h: 640 },
      pivot: { x: 32, y: 80 },
      palette: { id: "greek-master", family: "olympus", maxColours: 16 },
    });
    expect(spec.palette.approval).toEqual(content.palette.approval);
    const olympus = content.palette.families.find((f) => f.id === "olympus");
    expect(spec.palette.ramps.length).toBeGreaterThan(0);
    expect(spec.palette.ramps).toEqual(olympus?.ramps ?? []);
    expect(spec.slots.map((s) => [s.key, s.slot])).toEqual([
      ["idle/south", { state: "idle", direction: "south" }],
    ]);
  });

  test("the portrait uses the portrait cell with no pivot and the portrait colour limit", () => {
    const { record } = ok(
      newRequestRecord(
        content,
        { id: "zeus-faces", ...sixExpressions, seed: 1 },
        neverDraw,
      ),
    );
    const spec = ok(buildSpec(content, record.request));

    expect(spec).toMatchObject({
      kind: "portrait",
      cell: { id: "portrait", w: 96, h: 96 },
      native: { w: 96, h: 96 },
      generated: { w: 768, h: 768 },
      palette: { maxColours: 32 },
    });
    expect(spec.pivot).toBeUndefined();
    expect(spec.slots.map((s) => s.key)).toEqual([
      ...content.vocabulary.expressions,
    ]);
  });

  test("the spec follows the content, not constants", () => {
    const changed: StudioContent = {
      ...content,
      visuals: content.visuals.map((v) => ({ ...v, iconography: ["owl"] })),
    };
    const spec = ok(
      buildSpec(changed, {
        schemaVersion: 1,
        ...idleSouth,
        batch: 1,
        seed: 1,
      }),
    );
    expect(spec.iconography).toEqual(["owl"]);
    const input = ok(adapterInput(spec, "idle/south", 1));
    expect(input.prompt).toContain("owl");
    expect(input.prompt).not.toContain("thunderbolt");
  });

  test("ability slots need a known ability of that god and only on per-ability states", () => {
    const build = (slot: RequestInput["slots"][number]) =>
      buildSpec(content, {
        schemaVersion: 1,
        subject: "zeus",
        kind: "sprite",
        slots: [slot],
        batch: 1,
        seed: 1,
      });

    expect(
      ok(build({ state: "act", direction: "south", ability: "thunderbolt" }))
        .slots[0]?.key,
    ).toBe("act/south/thunderbolt");
    expect(
      build({ state: "act", direction: "south", ability: "nope" }),
    ).toEqual({
      ok: false,
      error: {
        kind: "unknown-ability",
        ability: "nope",
        valid: zeus.abilities.map((a) => a.id),
      },
    });
    expect(build({ state: "act", direction: "south" })).toMatchObject({
      ok: false,
      error: { kind: "invalid-slot" },
    });
    expect(
      build({ state: "idle", direction: "south", ability: "thunderbolt" }),
    ).toMatchObject({
      ok: false,
      error: { kind: "invalid-slot" },
    });
    expect(
      ok(build({ state: "seated", direction: "south" })).slots[0]?.key,
    ).toBe("seated/south");
  });

  test("unknown values return typed errors with the valid alternatives", () => {
    const sprite = (slot: RequestInput["slots"][number]) =>
      buildSpec(content, {
        schemaVersion: 1,
        subject: "zeus",
        kind: "sprite",
        slots: [slot],
        batch: 1,
        seed: 1,
      });
    const vocabulary: AssetVocabulary = content.vocabulary;

    expect(
      buildSpec(content, {
        schemaVersion: 1,
        subject: "nobody",
        kind: "sprite",
        slots: [{ state: "idle", direction: "south" }],
        batch: 1,
      }),
    ).toEqual({
      ok: false,
      error: {
        kind: "unknown-subject",
        subject: "nobody",
        valid: content.visuals.map((v) => v.godId),
      },
    });
    expect(sprite({ state: "fly", direction: "south" })).toEqual({
      ok: false,
      error: {
        kind: "unknown-state",
        state: "fly",
        valid: vocabulary.states.map((s) => s.id),
      },
    });
    expect(sprite({ state: "idle", direction: "up" })).toEqual({
      ok: false,
      error: {
        kind: "unknown-direction",
        direction: "up",
        valid: vocabulary.directions,
      },
    });
    expect(
      buildSpec(content, {
        schemaVersion: 1,
        subject: "zeus",
        kind: "portrait",
        slots: [{ expression: "bored" }],
        batch: 1,
      }),
    ).toEqual({
      ok: false,
      error: {
        kind: "unknown-expression",
        expression: "bored",
        valid: vocabulary.expressions,
      },
    });
    expect(
      buildSpec(content, {
        schemaVersion: 1,
        subject: "zeus",
        kind: "tile",
        slots: [{ state: "idle" }],
        batch: 1,
      }),
    ).toEqual({
      ok: false,
      error: {
        kind: "unsupported-kind",
        requested: "tile",
        valid: ["sprite", "portrait"],
      },
    });
  });

  test("slots must match the kind", () => {
    const wrong = (
      kind: "sprite" | "portrait",
      slot: RequestInput["slots"][number],
    ) =>
      buildSpec(content, {
        schemaVersion: 1,
        subject: "zeus",
        kind,
        slots: [slot],
        batch: 1,
      });
    expect(
      wrong("portrait", { state: "idle", direction: "south" }),
    ).toMatchObject({
      ok: false,
      error: { kind: "invalid-slot" },
    });
    expect(wrong("sprite", { expression: "neutral" })).toMatchObject({
      ok: false,
      error: { kind: "invalid-slot" },
    });
    expect(wrong("sprite", { state: "idle" })).toMatchObject({
      ok: false,
      error: { kind: "invalid-slot" },
    });
  });

  test("a cell with no measured generation size is reported, never guessed", () => {
    const odd: StudioContent = {
      ...content,
      vocabulary: {
        ...content.vocabulary,
        cells: content.vocabulary.cells.map((c) =>
          c.id === "god" ? { ...c, w: 70 } : c,
        ),
      },
    };
    expect(
      buildSpec(odd, { schemaVersion: 1, ...idleSouth, batch: 1 }),
    ).toMatchObject({
      ok: false,
      error: { kind: "unmeasured-size", native: { w: 70, h: 80 } },
    });
  });

  test("a palette without the subject's family is reported", () => {
    const bare: StudioContent = {
      ...content,
      palette: {
        ...content.palette,
        families: content.palette.families.filter(
          (f) => f.id !== "olympus",
        ) as Palette["families"],
      },
    };
    expect(
      buildSpec(bare, { schemaVersion: 1, ...idleSouth, batch: 1 }),
    ).toEqual({
      ok: false,
      error: {
        kind: "unknown-palette-family",
        family: "olympus",
        valid: ["town", "underworld"],
      },
    });
  });
});

describe("root request record", () => {
  test("a supplied seed is kept and never drawn; the default batch is four", () => {
    const { record } = ok(
      newRequestRecord(
        content,
        { id: "r-supplied", ...idleSouth, seed: 99 },
        neverDraw,
      ),
    );
    expect(DEFAULT_BATCH).toBe(4);
    expect(record).toEqual({
      schemaVersion: 1,
      id: "r-supplied",
      request: {
        schemaVersion: 1,
        subject: "zeus",
        kind: "sprite",
        slots: [{ state: "idle", direction: "south" }],
        batch: 4,
        seed: 99,
      },
      nextOrdinal: 0,
    });
  });

  test("an omitted seed is drawn exactly once and stored", () => {
    let draws = 0;
    const { record } = ok(
      newRequestRecord(
        content,
        { id: "r-drawn", ...sixExpressions, batch: 2, styleNote: "dusk" },
        () => {
          draws += 1;
          return 4242;
        },
      ),
    );
    expect(draws).toBe(1);
    expect(record.request).toMatchObject({
      seed: 4242,
      batch: 2,
      styleNote: "dusk",
    });
    ok(planJobs(record, 2));
    expect(draws).toBe(1);
  });

  test("bad ids, seeds and structure return errors", () => {
    expect(
      newRequestRecord(
        content,
        { id: "Not A Slug", ...idleSouth, seed: 1 },
        neverDraw,
      ),
    ).toMatchObject({ ok: false, error: { kind: "invalid-request" } });
    expect(
      newRequestRecord(content, { id: "r", ...idleSouth, seed: -1 }, neverDraw),
    ).toMatchObject({ ok: false, error: { kind: "invalid-request" } });
    expect(
      newRequestRecord(
        content,
        { id: "r", ...idleSouth, seed: 2 ** 60 },
        neverDraw,
      ),
    ).toMatchObject({ ok: false, error: { kind: "invalid-request" } });
    expect(
      newRequestRecord(
        content,
        { id: "r", ...idleSouth, batch: 0, seed: 1 },
        neverDraw,
      ),
    ).toMatchObject({ ok: false, error: { kind: "invalid-request" } });
    expect(
      newRequestRecord(
        content,
        { id: "r", ...idleSouth, slots: [], seed: 1 },
        neverDraw,
      ),
    ).toMatchObject({ ok: false, error: { kind: "invalid-request" } });
  });

  test("an unknown subject or slot is refused before any seed is drawn", () => {
    expect(
      newRequestRecord(
        content,
        { id: "r", ...idleSouth, subject: "nobody" },
        neverDraw,
      ),
    ).toMatchObject({ ok: false, error: { kind: "unknown-subject" } });
  });
});

describe("job expansion", () => {
  const { record } = ok(
    newRequestRecord(
      content,
      { id: "zeus-faces", ...sixExpressions, seed: 1000 },
      neverDraw,
    ),
  );

  test("six expressions at the default batch become 24 narrowed jobs", () => {
    const plan = ok(planJobs(record, record.request.batch));

    expect(plan.jobs).toHaveLength(24);
    expect(plan.nextOrdinal).toBe(24);
    expect(new Set(plan.jobs.map((j) => j.job.id)).size).toBe(24);
    expect(plan.jobs.map((j) => j.source.ordinal)).toEqual([
      ...Array(24).keys(),
    ]);
    for (const [index, { job, source }] of plan.jobs.entries()) {
      const slot = content.vocabulary.expressions[
        Math.floor(index / 4)
      ] as string;
      expect(source).toEqual({
        requestId: "zeus-faces",
        slotKey: slot,
        ordinal: index,
      });
      expect(job.status).toBe("queued");
      expect(job.provider).toEqual(PROVIDER);
      expect(job.request).toEqual({
        schemaVersion: 1,
        subject: "zeus",
        kind: "portrait",
        slots: [{ expression: slot }],
        batch: 1,
        seed: 1000 + index,
      });
      expect(slotKey(job.request.slots[0] ?? {})).toBe(slot);
      expect(parseGenerationRequest(job.request).ok).toBe(true);
      expect(parseGenerationJob(job).ok).toBe(true);
    }
  });

  test("a reroll continues the ordinal and seed sequence without reusing ids", () => {
    const first = ok(planJobs(record, 4));
    const rerolled = ok(
      planJobs({ ...record, nextOrdinal: first.nextOrdinal }, 2),
    );

    expect(rerolled.jobs).toHaveLength(12);
    expect(rerolled.jobs.map((j) => j.source.ordinal)).toEqual(
      [...Array(12).keys()].map((n) => 24 + n),
    );
    expect(rerolled.jobs[0]?.job.request.seed).toBe(1024);
    expect(rerolled.nextOrdinal).toBe(36);
    const ids = new Set([...first.jobs, ...rerolled.jobs].map((j) => j.job.id));
    expect(ids.size).toBe(36);
  });

  test("a reroll of one slot plans only that slot, continuing the same ordinal and seed sequence", () => {
    const first = ok(planJobs(record, 4));
    const key = slotKey(record.request.slots[2] ?? {});

    const one = ok(
      planJobs({ ...record, nextOrdinal: first.nextOrdinal }, 3, key),
    );

    expect(one.jobs).toHaveLength(3);
    expect(one.jobs.map((j) => j.source.slotKey)).toEqual([key, key, key]);
    expect(one.jobs.map((j) => j.source.ordinal)).toEqual([24, 25, 26]);
    expect(one.jobs.map((j) => j.job.request.seed)).toEqual([1024, 1025, 1026]);
    expect(one.nextOrdinal).toBe(27);
    for (const { job } of one.jobs) {
      expect(slotKey(job.request.slots[0] ?? {})).toBe(key);
      expect(parseGenerationJob(job).ok).toBe(true);
    }
  });

  test("a slot the request does not have is refused with nothing planned, and no slot behaves as before", () => {
    expect(planJobs(record, 1, "expression/nobody")).toMatchObject({
      ok: false,
      error: { kind: "invalid-request", path: "slotKey" },
    });
    expect(planJobs(record, 1, "")).toMatchObject({ ok: false });
    expect(ok(planJobs(record, 2)).jobs).toHaveLength(12);
    expect(ok(planJobs(record, 2, undefined)).jobs).toHaveLength(12);
  });

  test("a seed that would pass the safe-integer limit is refused with nothing planned", () => {
    const edge = (base: number, perSlot: number) =>
      planJobs(
        {
          ...record,
          request: { ...record.request, seed: base },
        },
        perSlot,
      );
    expect(edge(Number.MAX_SAFE_INTEGER - 23, 4)).toMatchObject({ ok: true });
    expect(edge(Number.MAX_SAFE_INTEGER - 22, 4)).toMatchObject({
      ok: false,
      error: { kind: "seed-overflow" },
    });
  });

  test("the per-slot count must be a positive integer", () => {
    for (const count of [0, -1, 1.5, Number.NaN])
      expect(planJobs(record, count)).toMatchObject({
        ok: false,
        error: { kind: "invalid-request" },
      });
  });
});

describe("adapter inputs", () => {
  test("the same spec and seed give identical inputs; only the seed varies", () => {
    const build = () => {
      const { record } = ok(
        newRequestRecord(
          content,
          { id: "zeus-idle", ...idleSouth, seed: 5 },
          neverDraw,
        ),
      );
      return ok(buildSpec(content, record.request));
    };
    const a = ok(adapterInput(build(), "idle/south", 5));
    const b = ok(adapterInput(build(), "idle/south", 5));

    expect(a).toEqual(b);
    expect(a).toEqual({
      prompt:
        "pixel art, Zeus, Greek god, thunderbolt, full body, front view, facing the viewer, idle pose, plain flat background, limited colour palette",
      negativePrompt:
        "blurry, antialiased, smooth gradients, photograph, 3d render, text, watermark",
      width: 512,
      height: 640,
      seed: 5,
      sampleMethod: "euler",
      sampleSteps: 8,
      txtCfg: 1,
    });
    expect(ok(adapterInput(build(), "idle/south", 6))).toEqual({
      ...a,
      seed: 6,
    });
  });

  test("each direction is worded as the view it draws, never as a compass word", () => {
    const views: [string, string][] = [
      ["south", "front view, facing the viewer"],
      ["north", "back view, facing away from the viewer"],
      ["east", "side view, facing right"],
      ["west", "side view, facing left"],
    ];
    for (const [direction, view] of views) {
      const { record } = ok(
        newRequestRecord(
          content,
          {
            id: `zeus-${direction}`,
            ...idleSouth,
            slots: [{ state: "idle", direction }],
            seed: 1,
          },
          neverDraw,
        ),
      );
      const spec = ok(buildSpec(content, record.request));
      const { prompt } = ok(adapterInput(spec, `idle/${direction}`, 1));

      expect(prompt).toContain(`full body, ${view}, idle pose`);
      expect(prompt).not.toContain(`facing ${direction}`);
      expect(spec.slots.map((s) => s.key)).toEqual([`idle/${direction}`]);
    }
  });

  test("a vocabulary direction with no view wording is a typed unknown-direction error, not a silent fallback", () => {
    const widened: StudioContent = {
      ...content,
      vocabulary: {
        ...content.vocabulary,
        directions: [...content.vocabulary.directions, "up"],
      },
    };

    expect(
      buildSpec(widened, {
        schemaVersion: 1,
        subject: "zeus",
        kind: "sprite",
        slots: [{ state: "idle", direction: "up" }],
        batch: 1,
      }),
    ).toEqual({
      ok: false,
      error: {
        kind: "unknown-direction",
        direction: "up",
        valid: content.vocabulary.directions,
      },
    });
  });

  test("a portrait names its expression and the style note is appended", () => {
    const { record } = ok(
      newRequestRecord(
        content,
        {
          id: "zeus-faces",
          ...sixExpressions,
          seed: 1,
          styleNote: "storm light",
        },
        neverDraw,
      ),
    );
    const spec = ok(buildSpec(content, record.request));
    expect(ok(adapterInput(spec, "awed", 1))).toMatchObject({
      prompt:
        "pixel art portrait, Zeus, Greek god, thunderbolt, bust, three-quarter view, awed expression, flat background, limited colour palette, storm light",
      width: 768,
      height: 768,
    });
  });

  test("a slot key outside the spec is an error", () => {
    const { record } = ok(
      newRequestRecord(
        content,
        { id: "zeus-idle", ...idleSouth, seed: 1 },
        neverDraw,
      ),
    );
    expect(
      adapterInput(ok(buildSpec(content, record.request)), "idle/north", 1),
    ).toMatchObject({ ok: false, error: { kind: "invalid-slot" } });
  });
});

describe("selected profile", () => {
  const components = readJson(join(probeRoot, "components.json")) as {
    runtime: Record<string, unknown>;
    arms: Record<
      string,
      {
        components: {
          role: string;
          id: string;
          file: string;
          sizeBytes: number;
          sha256: string;
          license: string;
        }[];
      }
    >;
  };
  const arm = readJson(
    join(probeRoot, "arms", "z-image-turbo-nolora.json"),
  ) as {
    server: {
      cmd: string[];
      binary: { path: string; declared: Record<string, string> };
    };
    negativePrompt: string;
    sampleParams: {
      sample_method: string;
      sample_steps: number;
      guidance: { txt_cfg: number };
    };
    cells: { width: number; height: number }[];
  };
  const pinned = (components.arms["z-image-turbo"]?.components ?? []).filter(
    (c) => c.role !== "lora",
  );

  test("components, runtime and settings match the probe's pinned data, with no LoRA", () => {
    expect(SELECTED_PROFILE.runtime).toMatchObject({
      id: components.runtime.id,
      commit: components.runtime.commit,
      license: components.runtime.license,
      archive: {
        file: components.runtime.file,
        sizeBytes: components.runtime.sizeBytes,
        sha256: components.runtime.sha256,
      },
      binary: {
        path: arm.server.binary.path,
        sha256: arm.server.binary.declared.sha256,
      },
    });
    expect(SELECTED_PROFILE.components).toEqual(
      pinned.map((c) => ({
        role: c.role,
        id: c.id,
        file: c.file,
        sizeBytes: c.sizeBytes,
        sha256: c.sha256,
        license: c.license,
      })),
    );
    expect(
      SELECTED_PROFILE.components.map((c: { license: string }) => c.license),
    ).toEqual(["Apache-2.0", "Apache-2.0", "Apache-2.0"]);
    expect(SELECTED_PROFILE.runtime.license).toBe("MIT");
    expect(JSON.stringify(SELECTED_PROFILE)).not.toMatch(/lora|civitai|http/i);
    expect(SELECTED_PROFILE.negativePrompt).toBe(arm.negativePrompt);
    expect(SELECTED_PROFILE.sampling).toEqual({
      sampleMethod: arm.sampleParams.sample_method,
      sampleSteps: arm.sampleParams.sample_steps,
      txtCfg: arm.sampleParams.guidance.txt_cfg,
    });
    expect(SELECTED_PROFILE.measuredCells).toEqual(
      arm.cells.map((c) => ({ w: c.width, h: c.height })),
    );
    expect(SELECTED_PROFILE.serverFlags).toEqual(
      arm.server.cmd.filter(
        (a) => a === "--offload-to-cpu" || a === "--diffusion-fa",
      ),
    );
  });

  test("jobs name a local image provider", () => {
    expect(PROVIDER).toEqual({
      id: "sd-server-z-image-turbo",
      medium: "image",
      hosting: "local",
    });
  });
});
