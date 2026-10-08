import { afterEach, describe, expect, test } from "bun:test";
import {
  openRuntime,
  openStudioSession,
  readStudioStatus,
} from "@panthea/assets/studio";
import { readLog } from "../../../packages/assets/src/studio/_test-runtime";
import {
  alive,
  capture,
  depsFor,
  removeTempRoots,
  run,
  runtimeRig,
  waitFor,
} from "./_testkit";
import { execute } from "./commands";
import { Studio } from "./host";

afterEach(removeTempRoots);

const SOUTH = [{ state: "idle", direction: "south" }];
const pidsOf = (dir: string) => [
  ...new Set(
    readLog(dir)
      .filter((e) => e.event === "start" || e.event === "grand")
      .map((e) => e.pid),
  ),
];

describe("teardown", () => {
  test("a finished one-shot command leaves no server and a root another process can open", async () => {
    const rig = await runtimeRig({ grandchild: true, ignoreTerm: true });

    const { outcome } = await run(
      rig.config,
      "generate",
      {
        id: "zeus-idle",
        subject: "zeus",
        kind: "sprite",
        slots: SOUTH,
        batch: 1,
        seed: 1,
      },
      rig.deps,
    );

    expect(outcome.ok).toBe(true);
    const pids = pidsOf(rig.dir);
    expect(pids.length).toBe(2);
    expect(pids.every((pid) => !alive(pid))).toBe(true);
    const reopened = openStudioSession(rig.root);
    expect(reopened.kind).toBe("opened");
    if (reopened.kind === "opened") reopened.session.close();
  });

  test("a failed shutdown keeps the root locked and the server's owner alive, retries at the configured poll, and only then releases", async () => {
    const rig = await runtimeRig({ grandchild: true, ignoreTerm: true });
    const gates: (() => void)[] = [];
    let attempts = 0;
    const cap = capture();
    const deps = depsFor(cap, {
      ...rig.deps,
      sleep: () => new Promise<void>((release) => gates.push(release)),
      openRuntime: (session, config) => {
        const real = openRuntime(session, config);
        return {
          ...real,
          shutdown: async () => {
            attempts += 1;
            return attempts <= 2
              ? {
                  ok: false,
                  reason: "teardown-incomplete",
                  message: "processes 1234 of group 1234 survived",
                }
              : real.shutdown();
          },
        };
      },
    });
    const studio = new Studio(rig.config, deps, "session");
    await execute(studio, "generate", {
      id: "zeus-idle",
      subject: "zeus",
      kind: "sprite",
      slots: SOUTH,
      batch: 1,
      seed: 1,
    });
    await studio.idle();
    await waitFor(() => pidsOf(rig.dir).length === 2);
    const pids = pidsOf(rig.dir);
    let settled = false;

    const teardown = studio.teardown().then(() => {
      settled = true;
    });
    await waitFor(() => gates.length === 1);

    expect(settled).toBe(false);
    expect(openStudioSession(rig.root).kind).toBe("busy");
    expect(pids.every((pid) => alive(pid))).toBe(true);
    gates.shift()?.();
    await waitFor(() => gates.length === 1);
    expect(settled).toBe(false);
    expect(openStudioSession(rig.root).kind).toBe("busy");
    expect(pids.every((pid) => alive(pid))).toBe(true);
    gates.shift()?.();
    await teardown;

    expect(attempts).toBe(3);
    expect(pids.every((pid) => !alive(pid))).toBe(true);
    const reopened = openStudioSession(rig.root);
    expect(reopened.kind).toBe("opened");
    if (reopened.kind === "opened") reopened.session.close();
    const log = cap.err.join("\n");
    expect(log).toContain("the root stays locked");
    expect(log).not.toContain("1234");
  });

  test("teardown is idempotent: a second call shares the first and shuts down once", async () => {
    const rig = await runtimeRig();
    let shutdowns = 0;
    const studio = new Studio(
      rig.config,
      depsFor(capture(), {
        ...rig.deps,
        openRuntime: (session, config) => {
          const real = openRuntime(session, config);
          return {
            ...real,
            shutdown: () => {
              shutdowns += 1;
              return real.shutdown();
            },
          };
        },
      }),
      "session",
    );
    await execute(studio, "generate", {
      id: "zeus-idle",
      subject: "zeus",
      kind: "sprite",
      slots: SOUTH,
      batch: 1,
      seed: 1,
    });
    await studio.idle();

    await Promise.all([studio.teardown(), studio.teardown()]);
    await studio.teardown();

    expect(shutdowns).toBe(1);
  });

  test("a command that throws still releases the root", async () => {
    const rig = await runtimeRig();
    const { outcome } = await run(
      rig.config,
      "set-create",
      { id: "w", requestId: "r" },
      {
        ...rig.deps,
        loadContent: () => {
          throw new Error("boom with SECRET_TOKEN_77");
        },
      },
    );

    expect(outcome).toMatchObject({ ok: false, error: { code: "internal" } });
    expect(JSON.stringify(outcome)).not.toContain("SECRET_TOKEN_77");
    const reopened = openStudioSession(rig.root);
    expect(reopened.kind).toBe("opened");
    if (reopened.kind === "opened") reopened.session.close();
  });

  test("while stopping, a mutating command is refused and a read still answers", async () => {
    const rig = await runtimeRig({ sequence: ["hang"] });
    const studio = new Studio(
      rig.config,
      depsFor(capture(), rig.deps),
      "session",
    );
    await execute(studio, "generate", {
      id: "zeus-idle",
      subject: "zeus",
      kind: "sprite",
      slots: SOUTH,
      batch: 1,
      seed: 1,
    });
    await waitFor(() => readLog(rig.dir).some((e) => e.event === "img_gen"));

    const stopping = studio.teardown();
    const mutate = await execute(studio, "remove", { jobId: "zeus-idle-0000" });
    const read = await execute(studio, "status", {});
    await stopping;

    expect(mutate).toMatchObject({
      ok: false,
      error: { code: "shutting-down" },
    });
    expect(read.ok).toBe(true);
    expect(readStudioStatus(rig.root).jobs[0]?.job).toMatchObject({
      status: "cancelled",
      cancelledBy: "aborted",
    });
    expect(pidsOf(rig.dir).every((pid) => !alive(pid))).toBe(true);
  });
});
