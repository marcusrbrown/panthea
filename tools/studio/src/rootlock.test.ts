// A session whose studio root another process holds. It stays up read-only:
// reads answer from the durable records, every mutating op is refused with a
// typed `root-locked` that names the holder, and the first write after the
// holder is gone takes the lock itself. The lock probe (`openSession`), the
// record reader (`readStatus`) and the liveness check (`isAlive`) are injected,
// so nothing here waits on a clock or a real process.

import { afterEach, describe, expect, test } from "bun:test";
import { openStudioSession, readStudioStatus } from "@panthea/assets/studio";
import { spriteSet } from "../../../packages/assets/src/studio/_test-fixtures";
import {
  assetRig,
  capture,
  depsFor,
  heldBy,
  removeTempRoots,
  tempRoot,
} from "./_testkit";
import { execute, opNames, opSpec, READ_ONLY } from "./commands";
import type { StudioConfig } from "./config";
import { exitOf } from "./format";
import { type Deps, Studio } from "./host";

afterEach(removeTempRoots);

const HOLDER = 4242;

const sessionStudio = (config: StudioConfig, over: Partial<Deps>) =>
  new Studio(config, depsFor(capture(), over), "session");

/** Arguments that pass the argument check for an op, whatever they mean. */
function placeholderArgs(op: string): Record<string, unknown> {
  const spec = opSpec(op)?.spec ?? {};
  const args: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(spec)) {
    if (!field.req) continue;
    args[name] =
      field.t === "string"
        ? "x"
        : field.t === "json"
          ? []
          : field.t === "int"
            ? 1
            : 1;
  }
  return args;
}

const MUTATING = () => opNames().filter((op) => !READ_ONLY.has(op));

describe("a session on a root another process holds", () => {
  test("it answers status and list from the records, and status names the holder", async () => {
    const rig = assetRig();
    spriteSet(rig);
    rig.session.close();
    const deps = heldBy(HOLDER);
    const studio = sessionStudio({ studioRoot: rig.root }, deps);

    const status = await execute(studio, "status", {});
    const jobs = await execute(studio, "list", { kind: "jobs" });
    const sets = await execute(studio, "list", { kind: "working-sets" });

    expect(status).toMatchObject({
      ok: true,
      result: {
        rootLock: { holder: "other", pid: HOLDER },
        counts: { jobs: 1 },
      },
    });
    expect(jobs).toMatchObject({
      ok: true,
      result: [{ id: "zeus-idle-0000" }],
    });
    expect(sets.ok).toBe(true);
    await studio.teardown();
  });

  test("generate is refused as root-locked with the holder's pid, and exits 1 rather than as a usage error", async () => {
    const rig = assetRig();
    rig.session.close();
    const studio = sessionStudio({ studioRoot: rig.root }, heldBy(HOLDER));

    const outcome = await execute(studio, "generate", {
      id: "r",
      subject: "zeus",
      kind: "sprite",
      slots: [{ state: "idle", direction: "south" }],
    });

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "root-locked", holder: HOLDER },
    });
    expect(exitOf(outcome)).toBe(1);
    expect(JSON.stringify(outcome)).toContain(String(HOLDER));
    await studio.teardown();
  });

  test("every mutating op is refused the same way, and nothing is written", async () => {
    const rig = assetRig();
    spriteSet(rig);
    rig.session.close();
    const studio = sessionStudio({ studioRoot: rig.root }, heldBy(HOLDER));
    const ops = MUTATING();
    expect(ops.length).toBeGreaterThan(10);
    const before = JSON.stringify(readStudioStatus(rig.root));

    for (const op of ops) {
      const outcome = await execute(studio, op, placeholderArgs(op));
      expect(outcome, op).toMatchObject({
        ok: false,
        error: { code: "root-locked", holder: HOLDER },
      });
    }

    expect(JSON.stringify(readStudioStatus(rig.root))).toBe(before);
    await studio.teardown();
  });

  test("the reads keep answering: they run and are never refused as root-locked", async () => {
    const rig = assetRig();
    spriteSet(rig);
    rig.session.close();
    const studio = sessionStudio({ studioRoot: rig.root }, heldBy(HOLDER));

    for (const [op, args] of [
      ["status", {}],
      ["list", { kind: "candidates" }],
      ["sheet", { workingSetId: "w" }],
      ["edit-report", { id: "e1" }],
      ["candidate-frames", { candidateId: "zeus-idle-0000" }],
      ["candidate-bytes", { candidateId: "zeus-idle-0000" }],
    ] as const) {
      const outcome = await execute(studio, op, args);
      expect(outcome.ok, op).toBe(true);
    }
    const unknown = await execute(studio, "candidate-frames", {
      candidateId: "nope",
    });
    expect(unknown).toMatchObject({ ok: false, error: { code: "not-found" } });
    await studio.teardown();
  });

  test("a holder with no live record is reported as unknown, never guessed", async () => {
    const rig = assetRig();
    rig.session.close();
    const studio = sessionStudio({ studioRoot: rig.root }, heldBy(undefined));

    const status = await execute(studio, "status", {});
    const write = await execute(studio, "remove", { jobId: "j" });

    expect(status).toMatchObject({
      ok: true,
      result: { rootLock: { holder: "none", pid: null } },
    });
    expect(write).toMatchObject({
      ok: false,
      error: { code: "root-locked", holder: null },
    });
    await studio.teardown();
  });

  test("a holder that has exited is reported as gone, and the next write takes the lock itself", async () => {
    const rig = assetRig();
    rig.session.close();
    const deps = heldBy(HOLDER);
    let held = true;
    const studio = sessionStudio(
      { studioRoot: rig.root },
      {
        ...deps,
        // Busy while the holder lives, then the real lock.
        openSession: (root: string) =>
          held ? { kind: "busy" as const } : openStudioSession(root),
      },
    );

    const during = await execute(studio, "remove", { jobId: "none" });
    expect(during).toMatchObject({
      ok: false,
      error: { code: "root-locked", holder: HOLDER },
    });

    held = false;
    deps.alive.delete(HOLDER);
    const gone = await execute(studio, "status", {});
    expect(gone).toMatchObject({
      ok: true,
      result: { rootLock: { holder: "none", pid: null } },
    });
    // The session has not taken the lock yet: another process could still have it.
    const probe = openStudioSession(rig.root);
    expect(probe.kind).toBe("opened");
    if (probe.kind === "opened") probe.session.close();

    const after = await execute(studio, "remove", { jobId: "none" });
    expect(after.ok === false && after.error.code).not.toBe("root-locked");
    const now = await execute(studio, "status", {});
    expect(now).toMatchObject({
      ok: true,
      result: { rootLock: { holder: "self", pid: process.pid } },
    });
    expect(openStudioSession(rig.root).kind).toBe("busy");
    await studio.teardown();
  });

  test("a holder that comes back before the write is root-locked again, not a crash", async () => {
    const rig = assetRig();
    rig.session.close();
    const deps = heldBy(HOLDER);
    const studio = sessionStudio({ studioRoot: rig.root }, deps);
    deps.alive.delete(HOLDER);
    deps.alive.add(HOLDER);

    const outcome = await execute(studio, "pick", {
      workingSetId: "w",
      candidateId: "c",
    });

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "root-locked", holder: HOLDER },
    });
    expect(deps.probes()).toBeGreaterThan(0);
    await studio.teardown();
  });

  test("a one-shot command keeps its own busy refusal, and a session that owns the root reports itself", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const oneShot = new Studio(
      { studioRoot: rig.root },
      depsFor(capture()),
      "oneshot",
    );
    expect(
      await execute(oneShot, "remove", { jobId: "zeus-idle-0000" }),
    ).toMatchObject({
      ok: false,
      error: { code: "busy" },
    });
    await oneShot.teardown();
    rig.session.close();

    const owner = sessionStudio({ studioRoot: rig.root }, {});
    expect((owner.owner() as { store?: unknown }).store).toBeDefined();
    expect(await execute(owner, "status", {})).toMatchObject({
      ok: true,
      result: { rootLock: { holder: "self", pid: process.pid } },
    });
    await owner.teardown();
  });

  test("a status with no studio root at all is still a missing-config refusal", async () => {
    const studio = sessionStudio({}, {});
    expect(await execute(studio, "status", {})).toMatchObject({
      ok: false,
      error: { code: "missing-config" },
    });
    expect(tempRoot()).toBeString();
  });
});
