import { afterEach, describe, expect, test } from "bun:test";
import { openStudioSession } from "@panthea/assets/studio";
import { manualClock } from "../../../packages/assets/src/studio/_test-preview";
import { assetRig, capture, parsed, pipe, removeTempRoots } from "./_testkit";
import { exitOf } from "./format";
import { PARENT_POLL_MS, startParentGuard } from "./guard";
import { type Io, main, parseArgv, type Signals } from "./index";

afterEach(removeTempRoots);

describe("startParentGuard", () => {
  test("polls the parent on a re-armed timer and calls onOrphan exactly once, the first time it is found dead", () => {
    const clock = manualClock();
    const probed: number[] = [];
    let alive = true;
    let orphaned = 0;
    startParentGuard({
      parentPid: 4242,
      isAlive: (pid) => {
        probed.push(pid);
        return alive;
      },
      schedule: clock.schedule,
      onOrphan: () => {
        orphaned += 1;
      },
    });

    expect(clock.pending()).toBe(1);
    clock.tick();
    clock.tick();
    expect(orphaned).toBe(0);
    expect(probed).toEqual([4242, 4242]);
    expect(clock.pending()).toBe(1);

    alive = false;
    clock.tick();
    expect(orphaned).toBe(1);
    expect(clock.pending()).toBe(0);
    clock.tick();
    clock.tick();
    expect(orphaned).toBe(1);
    expect(probed).toHaveLength(3);
  });

  test("hands the scheduler the poll period, and the period is the simulation's two seconds", () => {
    const delays: number[] = [];
    startParentGuard({
      parentPid: 1,
      isAlive: () => true,
      schedule: (_run, ms) => {
        delays.push(ms);
        return () => {};
      },
      onOrphan: () => {},
    });
    expect(delays).toEqual([PARENT_POLL_MS]);
    expect(PARENT_POLL_MS).toBe(2000);
  });

  test("stop cancels the waiting poll and no later one fires", () => {
    const clock = manualClock();
    let orphaned = 0;
    const guard = startParentGuard({
      parentPid: 1,
      isAlive: () => false,
      schedule: clock.schedule,
      onOrphan: () => {
        orphaned += 1;
      },
    });

    guard.stop();
    guard.stop();

    expect(clock.pending()).toBe(0);
    clock.tick();
    expect(orphaned).toBe(0);
  });

  test("a stop that lands inside a poll prevents the next one from being armed", () => {
    const clock = manualClock();
    let guard: ReturnType<typeof startParentGuard> | undefined;
    guard = startParentGuard({
      parentPid: 1,
      isAlive: () => {
        guard?.stop();
        return true;
      },
      schedule: clock.schedule,
      onOrphan: () => {},
    });
    clock.tick();
    expect(clock.pending()).toBe(0);
  });
});

describe("--parent-pid", () => {
  test("is accepted by session and open, and read as a positive whole number", () => {
    expect(parseArgv(["session", "--parent-pid", "4242"])).toMatchObject({
      op: "session",
      parentPid: 4242,
    });
    expect(
      parseArgv([
        "open",
        "--parent-pid",
        "7",
        "--id",
        "e",
        "--working-set-id",
        "w",
        "--slots",
        "[]",
      ]),
    ).toMatchObject({ op: "open", parentPid: 7 });
    expect(parseArgv(["session"])).not.toHaveProperty(
      "parentPid",
      expect.anything(),
    );
  });

  test.each([
    ["not a number", ["session", "--parent-pid", "abc"]],
    [
      "zero, which would signal a process group",
      ["session", "--parent-pid", "0"],
    ],
    ["negative", ["session", "--parent-pid", "-5"]],
    ["fractional", ["session", "--parent-pid", "1.5"]],
    ["given twice", ["session", "--parent-pid", "1", "--parent-pid", "2"]],
    ["a one-shot command", ["status", "--parent-pid", "1"]],
  ])("refuses %s as a usage error", (_name, argv) => {
    const result = parseArgv(argv);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-arguments" },
    });
    expect(exitOf(result as never)).toBe(64);
  });
});

function harness(stdin: AsyncIterable<string>) {
  const cap = capture();
  const io: Io = {
    stdin,
    stdout: (line) => cap.out.push(line),
    stderr: (line) => cap.err.push(line),
  };
  const hub: Signals = { subscribe: () => () => {} };
  return { cap, io, hub };
}

describe("a session with a parent guard", () => {
  test("ends with exit 1 when the parent dies while stdin is still open, and releases the root", async () => {
    const rig = assetRig();
    rig.session.close();
    const clock = manualClock();
    let alive = true;
    const stdin = pipe();
    const h = harness(stdin.iterable);
    const done = main(
      ["session", "--root", rig.root, "--parent-pid", "4242"],
      h.io,
      { isAlive: (pid) => pid === 4242 && alive, schedule: clock.schedule },
      h.hub,
    );
    stdin.send('{"id":"s1","op":"status","args":{}}');
    await Promise.resolve();

    clock.tick();
    expect(clock.pending()).toBe(1);
    alive = false;
    clock.tick();
    const code = await done;

    expect(code).toBe(1);
    expect(clock.pending()).toBe(0);
    const reopened = openStudioSession(rig.root);
    expect(reopened.kind).toBe("opened");
    if (reopened.kind === "opened") reopened.session.close();
  });

  test("names the cause on stderr without a path or a pid", async () => {
    const rig = assetRig();
    rig.session.close();
    const clock = manualClock();
    const stdin = pipe();
    const h = harness(stdin.iterable);
    const done = main(
      ["session", "--root", rig.root, "--parent-pid", "4242"],
      h.io,
      { isAlive: () => false, schedule: clock.schedule },
      h.hub,
    );
    await Promise.resolve();
    clock.tick();
    await done;

    expect(h.cap.err.join("\n")).toContain("parent process is gone");
    expect(h.cap.err.join("\n")).not.toContain("4242");
    expect(h.cap.err.join("\n")).not.toContain(rig.root);
  });

  test("a live parent changes nothing: replies keep coming, end of input still exits 0, and the poll is cancelled", async () => {
    const rig = assetRig();
    rig.session.close();
    const clock = manualClock();
    const stdin = pipe();
    const h = harness(stdin.iterable);
    const done = main(
      ["session", "--root", rig.root, "--parent-pid", "4242"],
      h.io,
      { isAlive: () => true, schedule: clock.schedule },
      h.hub,
    );
    stdin.send('{"id":"s1","op":"status","args":{}}');
    clock.tick();
    clock.tick();
    stdin.end();
    const code = await done;

    expect(code).toBe(0);
    expect(parsed(h.cap.out)).toEqual([
      expect.objectContaining({ id: "s1", ok: true }),
    ]);
    expect(clock.pending()).toBe(0);
  });

  test("without the flag no guard is armed", async () => {
    const rig = assetRig();
    rig.session.close();
    const clock = manualClock();
    const stdin = pipe();
    const h = harness(stdin.iterable);
    const done = main(
      ["session", "--root", rig.root],
      h.io,
      { isAlive: () => false, schedule: clock.schedule },
      h.hub,
    );
    await Promise.resolve();
    expect(clock.pending()).toBe(0);
    stdin.end();
    expect(await done).toBe(0);
  });
});
