// Test helpers shared by driver/arm/CLI tests.

import { type ManagedProcess, spawnManaged } from "../process";

export const FAKE_SERVER = new URL("./fake-sd-server.ts", import.meta.url)
  .pathname;

export async function freePort(): Promise<number> {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(""),
  });
  const port = server.port as number;
  await server.stop(true);
  return port;
}

export function fakeServerCmd(): string[] {
  return [process.execPath, "run", FAKE_SERVER];
}

export function spawnFake(
  port: number,
  env: Record<string, string> = {},
): ManagedProcess {
  return spawnManaged({
    cmd: fakeServerCmd(),
    env: { FAKE_PORT: String(port), ...env },
    maxLifetimeMs: 20_000,
    stopGraceMs: 300,
  });
}
