import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  acquireLock,
  openStdinSession,
  shouldSelfTerminate,
  startParentGuard,
} from "./lifecycle";

let dir: string;
let lockPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "panthea-sim-lifecycle-test-"));
  lockPath = join(dir, "lifecycle.lock");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("acquireLock", () => {
  test("no existing lock acquires cleanly", () => {
    const decision = acquireLock(lockPath);
    expect(decision.kind).toBe("acquired");
    if (decision.kind === "acquired") {
      decision.db.close();
    }
  });

  test("a second acquire attempt against the same path, while the first connection is still open, is refused", () => {
    const first = acquireLock(lockPath);
    expect(first.kind).toBe("acquired");

    const second = acquireLock(lockPath);
    expect(second).toEqual({ kind: "refused" });

    if (first.kind === "acquired") {
      first.db.close();
    }
  });

  test("closing the first connection releases the lock for a subsequent acquire", () => {
    const first = acquireLock(lockPath);
    expect(first.kind).toBe("acquired");
    if (first.kind === "acquired") {
      first.db.close();
    }

    const second = acquireLock(lockPath);
    expect(second.kind).toBe("acquired");
    if (second.kind === "acquired") {
      second.db.close();
    }
  });
});

describe("acquireLock: real subprocess launches", () => {
  const HOLDER_SCRIPT = join(import.meta.dir, "..", "test", "lock-holder.ts");

  test("two real subprocess launches against one lock path yield exactly one owner and one refusal", async () => {
    const first = Bun.spawn(["bun", "run", HOLDER_SCRIPT, lockPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await waitForLine(first.stdout, "ACQUIRED");

    const second = Bun.spawn(["bun", "run", HOLDER_SCRIPT, lockPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const secondExit = await second.exited;
    expect(secondExit).toBe(3);

    first.kill();
    await first.exited;
  }, 15_000);

  test("SIGKILLing the owner releases the lock; a new launch then acquires it", async () => {
    const first = Bun.spawn(["bun", "run", HOLDER_SCRIPT, lockPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await waitForLine(first.stdout, "ACQUIRED");

    first.kill("SIGKILL");
    await first.exited;

    const second = Bun.spawn(["bun", "run", HOLDER_SCRIPT, lockPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await waitForLine(second.stdout, "ACQUIRED");

    second.kill();
    await second.exited;
  }, 15_000);
});

async function waitForLine(
  stream: ReadableStream<Uint8Array>,
  expected: string,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 10_000;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error(
          `stream closed before seeing ${JSON.stringify(expected)}; saw: ${buffer}`,
        );
      }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes(expected)) {
        return;
      }
    }
    throw new Error(
      `timed out waiting for ${JSON.stringify(expected)}; saw: ${buffer}`,
    );
  } finally {
    reader.releaseLock();
  }
}

describe("shouldSelfTerminate", () => {
  test("a dead parent should self-terminate", () => {
    expect(shouldSelfTerminate(555, () => false)).toBe(true);
  });

  test("a live parent should not self-terminate", () => {
    expect(shouldSelfTerminate(555, () => true)).toBe(false);
  });
});

describe("openStdinSession", () => {
  test("resolves the token from stdin's first line and never leaks it through onClose alone", async () => {
    const input = new PassThrough();
    const session = openStdinSession(input);
    input.write("the-launch-token\n");
    const token = await session.token;
    expect(token).toBe("the-launch-token");

    let closed = false;
    session.onClose(() => {
      closed = true;
    });
    input.end();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(closed).toBe(true);
  });

  test("stdin EOF before any token line resolves the token as undefined and still fires onClose", async () => {
    const input = new PassThrough();
    const session = openStdinSession(input);
    let closed = false;
    session.onClose(() => {
      closed = true;
    });
    input.end();

    const token = await session.token;
    expect(token).toBeUndefined();
    expect(closed).toBe(true);
  });

  test("only the first line is ever used as the token", async () => {
    const input = new PassThrough();
    const session = openStdinSession(input);
    input.write("first-token\n");
    input.write('{"models":null}\n');
    input.end();
    const token = await session.token;
    expect(token).toBe("first-token");
  });

  test("the second line is the launch config, and a third line is ignored", async () => {
    const input = new PassThrough();
    const session = openStdinSession(input);
    input.write("the-token\n");
    input.write('{"models":null,"offline":false,"keys":{}}\n');
    input.write("a third line\n");
    expect(await session.token).toBe("the-token");
    expect(await session.launchConfig).toBe(
      '{"models":null,"offline":false,"keys":{}}',
    );
  });

  test("stdin EOF after the token but before a config line resolves the config as undefined", async () => {
    const input = new PassThrough();
    const session = openStdinSession(input);
    input.write("the-token\n");
    input.end();
    expect(await session.token).toBe("the-token");
    expect(await session.launchConfig).toBeUndefined();
  });

  test("stdin EOF before any line resolves both as undefined", async () => {
    const input = new PassThrough();
    const session = openStdinSession(input);
    input.end();
    expect(await session.token).toBeUndefined();
    expect(await session.launchConfig).toBeUndefined();
  });

  test("stdin stays open after both lines: EOF still fires onClose", async () => {
    const input = new PassThrough();
    const session = openStdinSession(input);
    let closed = false;
    session.onClose(() => {
      closed = true;
    });
    input.write("the-token\n");
    input.write("{}\n");
    await session.launchConfig;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(closed).toBe(false);
    input.end();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(closed).toBe(true);
  });
});

describe("startParentGuard", () => {
  test("calls onOrphan exactly once, the first time the parent is found dead", async () => {
    let calls = 0;
    let alive = true;
    const guard = startParentGuard(
      42,
      () => {
        calls += 1;
      },
      5,
      () => alive,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toBe(0);
      alive = false;
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(calls).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(calls).toBe(1);
    } finally {
      guard.stop();
    }
  });

  test("stop() prevents any further poll from firing", async () => {
    let calls = 0;
    const guard = startParentGuard(
      42,
      () => {
        calls += 1;
      },
      5,
      () => false,
    );
    guard.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(0);
  });
});
