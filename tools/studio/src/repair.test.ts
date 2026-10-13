// The repair route on the command line: a masked edit whose base is a frame of
// a published revision, and the refusal of reference conditioning that the
// probe's NO-GO leaves in place. Every registry is an isolated copy.

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readStudioStatus,
  type StudioRuntime,
  type StudioSession,
} from "@panthea/assets/studio";
import {
  type AssetRig,
  paintFigure,
  pngOf,
  publishIdleEast,
  SPRITE_CELL,
} from "../../../packages/assets/src/studio/_test-fixtures";
import { frameHashOf } from "../../../packages/assets/src/studio/frame-ref";
import { assetRig, heldBy, removeTempRoots, run } from "./_testkit";
import type { StudioConfig } from "./config";
import type { Outcome } from "./format";
import { parseArgv } from "./index";

const dirs: string[] = [];
afterEach(() => {
  removeTempRoots();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** A runtime that fails every queued job at once: nothing spawned, nothing timed. */
const fakeRuntime = (session: StudioSession): StudioRuntime => ({
  async drain() {
    const queued = session.queued();
    if (queued.ok)
      for (const { job } of queued.jobs) {
        session.start(job.id);
        session.fail(job.id, "fake runtime");
      }
    return { ok: true, results: [], stopped: "empty" };
  },
  async abort() {
    return { ok: true };
  },
  async close() {
    return { ok: true };
  },
  async shutdown() {
    session.close();
    return { ok: true };
  },
});

const SIZE = { w: 512, h: 640 };

/** An opaque 512x640 PNG, black except for one white rectangle. */
function maskPng() {
  const rgba = new Uint8Array(SIZE.w * SIZE.h * 4);
  for (let at = 0; at < rgba.length; at += 4) rgba[at + 3] = 255;
  for (let y = 200; y < 260; y += 1)
    for (let x = 220; x < 300; x += 1)
      rgba.fill(255, (y * SIZE.w + x) * 4, (y * SIZE.w + x) * 4 + 3);
  return pngOf({ rgba, width: SIZE.w, height: SIZE.h });
}

function setup() {
  const rig: AssetRig = assetRig();
  const revision = publishIdleEast(rig);
  // The hash the studio records for frame 1 of the published idle/east.
  const frameHash = frameHashOf(paintFigure(rig.content, SPRITE_CELL, 1));
  rig.session.close();
  const dir = mkdtempSync(join(tmpdir(), "studio-repair-"));
  dirs.push(dir);
  const maskBytes = maskPng();
  const mask = join(dir, "mask.png");
  writeFileSync(mask, maskBytes);
  const config: StudioConfig = {
    studioRoot: rig.root,
    contentRoot: "/content",
    registryRoot: rig.registryRoot,
    artifactRoot: "/artifacts",
    runtime: {
      port: 1,
      pollMs: 1,
      deadlines: {
        httpMs: 1,
        startupMs: 1,
        generationMs: 1,
        termGraceMs: 1,
        killMs: 1,
      },
    },
  };
  const generate = (args: Record<string, unknown>): Promise<Outcome> =>
    run(
      config,
      "generate",
      {
        id: "zeus-repair",
        subject: "zeus",
        kind: "sprite",
        slots: [{ state: "idle", direction: "east" }],
        batch: 1,
        seed: 20261011,
        editStrength: 0.6,
        editCue: "right hand lifted, bolt held high",
        editMask: mask,
        ...args,
      },
      {
        loadContent: () => ({ ok: true as const, content: rig.content }),
        loadPalettes: () => ({
          ok: true as const,
          palettes: rig.content.palettes,
        }),
        openRuntime: (session) => fakeRuntime(session),
      },
    ).then((r) => r.outcome);
  const published = (frameIndex = 1) =>
    `zeus-sprite@${revision}:idle/east#${frameIndex}`;
  return {
    rig,
    revision,
    frameHash,
    mask,
    maskBytes,
    config,
    generate,
    published,
  };
}

const code = (outcome: Outcome) => (outcome.ok ? "ok" : outcome.error.code);
const requests = (rig: AssetRig) =>
  readStudioStatus(rig.root).requests.map((r) => r.id);

describe("the published-frame flags", () => {
  test("parse to named arguments", () => {
    const parsed = parseArgv([
      "generate",
      "--edit-base-published",
      `zeus-sprite@${"a".repeat(64)}:idle/east#1`,
      "--edit-base-frame-hash",
      "b".repeat(64),
      "--edit-mask",
      "/m.png",
    ]);

    expect(parsed).toMatchObject({
      op: "generate",
      args: {
        editBasePublished: `zeus-sprite@${"a".repeat(64)}:idle/east#1`,
        editBaseFrameHash: "b".repeat(64),
        editMask: "/m.png",
      },
    });
  });
});

describe("generate with a published frame as the edit base", () => {
  test("the request records the base frame ref, the mask, the strength and the cue, and the job carries the same edit", async () => {
    const t = setup();

    const outcome = await t.generate({
      editBasePublished: t.published(),
      editBaseFrameHash: t.frameHash,
    });

    expect(code(outcome)).toBe("generation-failed");
    const status = readStudioStatus(t.rig.root);
    const request = status.requests.find((r) => r.id === "zeus-repair");
    expect(request?.request.edit).toEqual({
      base: {
        kind: "published",
        assetId: "zeus-sprite",
        revision: t.revision,
        slotKey: "idle/east",
        frameIndex: 1,
        frameHash: t.frameHash,
      } as never,
      mask: sha(t.maskBytes) as never,
      strength: 0.6,
      cue: "right hand lifted, bolt held high",
    });
    expect(
      status.jobs.find((j) => j.job.id === "zeus-repair-0000")?.job.request
        .edit,
    ).toEqual(request?.request.edit);
  });

  test("a wrong frame hash refuses the request and stores nothing", async () => {
    const t = setup();

    const outcome = await t.generate({
      editBasePublished: t.published(),
      editBaseFrameHash: "1".repeat(64),
    });

    expect(code(outcome)).toBe("invalid-request");
    expect(JSON.stringify(outcome)).toContain("frame-hash-mismatch");
    expect(requests(t.rig)).not.toContain("zeus-repair");
  });

  test("a missing slot, frame or revision refuses the request with its own reason", async () => {
    const t = setup();
    const cases: [string, string][] = [
      [`zeus-sprite@${t.revision}:walk/east#0`, "missing-slot"],
      [`zeus-sprite@${t.revision}:idle/east#9`, "missing-frame"],
      [`zeus-sprite@${"2".repeat(64)}:idle/east#1`, "missing-revision"],
    ];
    for (const [published, reason] of cases) {
      const outcome = await t.generate({
        editBasePublished: published,
        editBaseFrameHash: t.frameHash,
      });
      expect(code(outcome), reason).toBe("invalid-request");
      expect(JSON.stringify(outcome), reason).toContain(reason);
    }
    expect(requests(t.rig)).not.toContain("zeus-repair");
  });

  test("the reference must be asset@revision:slot#frame with its frame hash, and no other base beside it", async () => {
    const t = setup();
    const cases: Record<string, unknown>[] = [
      { editBasePublished: t.published() },
      { editBaseFrameHash: t.frameHash },
      { editBasePublished: "zeus-sprite", editBaseFrameHash: t.frameHash },
      {
        editBasePublished: "zeus-sprite@abc:idle/east#1",
        editBaseFrameHash: t.frameHash,
      },
      {
        editBasePublished: t.published(),
        editBaseFrameHash: "not-a-hash",
      },
      {
        editBasePublished: t.published(),
        editBaseFrameHash: t.frameHash,
        editBaseJob: "some-job",
        editBaseOutput: "a".repeat(64),
      },
    ];

    for (const args of cases)
      expect(code(await t.generate(args)), JSON.stringify(args)).toBe(
        "invalid-arguments",
      );
    expect(requests(t.rig)).not.toContain("zeus-repair");
  });
});

describe("deriving from Zeus on the command line", () => {
  test("a mirror of the published Zeus idle/east is refused as asymmetric, naming the declared feature", async () => {
    const t = setup();

    const { outcome } = await run(
      t.config,
      "derive",
      { asset: "zeus-sprite", op: "mirror", from: "idle/east", params: {} },
      {
        loadContent: () => ({ ok: true as const, content: t.rig.content }),
        loadPalettes: () => ({
          ok: true as const,
          palettes: t.rig.content.palettes,
        }),
      },
    );

    expect(code(outcome)).toBe("asymmetric");
    expect(JSON.stringify(outcome)).toContain("bolt hand");
    expect(outcome.ok).toBe(false);
  });
});

describe("reference conditioning", () => {
  test("a request that asks for it is refused as unavailable, naming the probe's README, and nothing is stored", async () => {
    const t = setup();

    const outcome = await t.generate({
      reference: [
        {
          assetId: "zeus-sprite",
          revision: t.revision,
          slotKey: "idle/east",
          frameIndex: 1,
        },
      ],
    });

    expect(code(outcome)).toBe("unavailable");
    expect(JSON.stringify(outcome)).toContain(
      "tools/probes/art-reference/README.md",
    );
    expect(requests(t.rig)).not.toContain("zeus-repair");
  });

  test("it is refused even with a valid masked edit beside it", async () => {
    const t = setup();

    const outcome = await t.generate({
      editBasePublished: t.published(),
      editBaseFrameHash: t.frameHash,
      reference: [],
    });

    expect(code(outcome)).toBe("unavailable");
    expect(requests(t.rig)).not.toContain("zeus-repair");
  });

  test("it is refused as unavailable even when another process holds the root: the writer lock is never asked for", async () => {
    const t = setup();
    const deps = heldBy(process.pid, {
      loadContent: () => ({ ok: true as const, content: t.rig.content }),
      loadPalettes: () => ({
        ok: true as const,
        palettes: t.rig.content.palettes,
      }),
    });

    const { outcome } = await run(
      t.config,
      "generate",
      {
        id: "zeus-repair",
        subject: "zeus",
        kind: "sprite",
        slots: [{ state: "idle", direction: "east" }],
        reference: [],
      },
      deps,
    );

    expect(code(outcome)).toBe("unavailable");
    expect(deps.probes()).toBe(0);
    // The same call without a reference does meet the lock.
    const meets = await run(
      t.config,
      "generate",
      {
        id: "zeus-repair",
        subject: "zeus",
        kind: "sprite",
        slots: [{ state: "idle", direction: "east" }],
      },
      deps,
    );
    expect(code(meets.outcome)).toBe("busy");
    expect(deps.probes()).toBeGreaterThan(0);
  });
});
