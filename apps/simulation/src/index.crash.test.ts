// Spawns the real entrypoint as a subprocess against a temp app-data dir
// pre-seeded with a large missed-time gap, SIGKILLs it while its startup
// catch-up is in progress, then restarts it and reads the store directly
// (never through HTTP -- the shell/webview auth token is minted per
// launch and never held by a probe/test artifact). The pre-seeded
// `catchUpChunkMs` is set far below the authored default so catch-up
// spans enough wall-clock time (many small commits, each a real SQLite
// transaction) for an external kill to reliably land mid-progress --
// still the real service, the real store, and the real one-hour cap.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeStore,
  openStore,
  readClock,
  readLiveProjections,
  rebuildProjections,
} from "@panthea/persistence";
import {
  createWorldProjectionReducers,
  loadGreekWorldState,
  restoreWorldTime,
} from "./world-store";

const INDEX_ENTRY = join(import.meta.dir, "index.ts");
// The properties here (a kill mid-chunk resumes from the last commit, each run
// respects the cap, no interval is applied twice) do not depend on the cap's
// size, only on the gap being well past it. The authored cap is an hour and
// its own tests are in catchup.test.ts; here the store is seeded with a ten
// minute cap and a gap six times it, so a run applies 600 one-second chunks and
// not 3,600. An hour of the whole town took 13 s alone and over a minute when
// the machine was busy, which is CPU, not the property.
const CATCH_UP_CAP_MS = 10 * 60 * 1000;
const SEEDED_CHUNK_MS = 1_000;
const MISSED_MS = 6 * CATCH_UP_CAP_MS;

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function spawnAndWriteToken(
  appDataDir: string,
  token: string,
): Promise<ReturnType<typeof Bun.spawn>> {
  const proc = Bun.spawn(["bun", "run", INDEX_ENTRY], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PANTHEA_APP_DATA_DIR: appDataDir },
  });
  const stdin = proc.stdin;
  if (typeof stdin === "number" || !stdin) {
    throw new Error("expected a FileSink stdin (spawned with stdin: 'pipe')");
  }
  stdin.write(`${token}\n{"models":null,"offline":false,"keys":{}}\n`);
  await stdin.flush();
  return proc;
}

test("kill during a startup catch-up chunk: restart resumes from the last committed chunk, each run's own cap is respected, and no interval is applied twice", async () => {
  const appDataDir = tempDir("panthea-sim-index-crash-");
  try {
    const activeStorePath = join(appDataDir, "active", "world.sqlite");
    const seeded = loadGreekWorldState();
    const seededWithTinyChunks = {
      ...seeded,
      rules: {
        ...seeded.rules,
        catchUpChunkMs: SEEDED_CHUNK_MS,
        catchUpCapMs: CATCH_UP_CAP_MS,
      },
    };
    const reducers = createWorldProjectionReducers(seededWithTinyChunks);
    const store = openStore(activeStorePath, reducers);
    const missedCursor = Date.now() - MISSED_MS;
    store.db.run("UPDATE clock SET cursor_wall_ms = ? WHERE id = 1", [
      missedCursor,
    ]);
    closeStore(store);

    // --- Kill mid-catch-up -------------------------------------------
    const firstProc = await spawnAndWriteToken(
      appDataDir,
      "crash-test-token-1",
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    firstProc.kill("SIGKILL");
    await firstProc.exited;

    const afterCrash = openStore(activeStorePath, reducers);
    const clockAfterCrash = readClock(afterCrash.db);
    // Progress may be anywhere from "not yet committed a chunk" to
    // "finished this run's own hour"; the invariant that always holds
    // is the cap itself.
    expect(clockAfterCrash.tick).toBeGreaterThanOrEqual(0);
    expect(clockAfterCrash.tick * 1000).toBeLessThanOrEqual(CATCH_UP_CAP_MS);
    const integrityAfterCrash = afterCrash.db
      .query("PRAGMA integrity_check")
      .get() as { integrity_check: string };
    expect(integrityAfterCrash.integrity_check).toBe("ok");
    const liveAfterCrash = restoreWorldTime(
      readLiveProjections(afterCrash, reducers),
      clockAfterCrash,
    );
    const rebuiltAfterCrash = restoreWorldTime(
      rebuildProjections(afterCrash, reducers),
      clockAfterCrash,
    );
    expect(rebuiltAfterCrash).toEqual(liveAfterCrash);
    closeStore(afterCrash);

    // --- Restart: let it run to completion this time ------------------
    const secondProc = await spawnAndWriteToken(
      appDataDir,
      "crash-test-token-2",
    );
    const stdout = secondProc.stdout;
    if (typeof stdout === "number" || !stdout) {
      throw new Error(
        "expected a ReadableStream stdout (spawned with stdout: 'pipe')",
      );
    }
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    await Promise.race([
      (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done)
            throw new Error("service exited before completing catch-up");
          buffer += decoder.decode(value, { stream: true });
          // The server starts (and prints PANTHEA_PORT) before catch-up
          // runs, so it can serve requests while catch-up chunks through
          // the backlog; wait for the distinct completion line instead so
          // this run's own catch-up has actually fully applied (or been
          // capped) before we kill it.
          if (/startup catch-up complete/.test(buffer)) return;
        }
      })(),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error("timed out waiting for startup catch-up to complete"),
            ),
          // Ten minutes of the whole town (twenty routine mortals, each traced) in
          // one-second chunks: about 3 s alone and ten times that on a busy machine.
          60_000,
        ),
      ),
    ]);
    reader.releaseLock();
    secondProc.kill("SIGTERM");
    await secondProc.exited;

    const afterRestart = openStore(activeStorePath, reducers);
    const clockAfterRestart = readClock(afterRestart.db);

    // Resumed forward, never backward or from scratch.
    expect(clockAfterRestart.tick).toBeGreaterThanOrEqual(clockAfterCrash.tick);
    // This run's own application respects the cap too.
    const secondRunTicks = clockAfterRestart.tick - clockAfterCrash.tick;
    expect(secondRunTicks * 1000).toBeLessThanOrEqual(CATCH_UP_CAP_MS);

    const integrityAfterRestart = afterRestart.db
      .query("PRAGMA integrity_check")
      .get() as { integrity_check: string };
    expect(integrityAfterRestart.integrity_check).toBe("ok");
    const liveAfterRestart = restoreWorldTime(
      readLiveProjections(afterRestart, reducers),
      clockAfterRestart,
    );
    const rebuiltAfterRestart = restoreWorldTime(
      rebuildProjections(afterRestart, reducers),
      clockAfterRestart,
    );
    expect(rebuiltAfterRestart).toEqual(liveAfterRestart);
    // Every tick after the crash boundary continues forward, live and
    // rebuilt agreeing -- no interval from before the crash was ever
    // reapplied (a double-apply would show up here as either a
    // sequence conflict during the second run's own commits, which
    // would have thrown, or a live/rebuilt mismatch).
    expect(clockAfterRestart.cursorWallMs).toBeGreaterThan(
      clockAfterCrash.cursorWallMs,
    );

    closeStore(afterRestart);
  } finally {
    rmSync(appDataDir, { recursive: true, force: true });
  }
}, 90_000);
