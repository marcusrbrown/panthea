// Test-only helper subprocess for lifecycle.test.ts's real-subprocess lock
// tests: acquires the lock at argv[2], prints ACQUIRED, then idles until
// killed. A refused acquire prints REFUSED and exits 3, matching the real
// entrypoint's refusal exit code.

import { acquireLock } from "../src/lifecycle";

const lockPath = process.argv[2];
if (!lockPath) {
  console.error("usage: lock-holder.ts <lockPath>");
  process.exit(1);
}

const decision = acquireLock(lockPath);
if (decision.kind === "refused") {
  console.log("REFUSED");
  process.exit(3);
}

console.log("ACQUIRED");
process.on("SIGTERM", () => {
  decision.db.close();
  process.exit(0);
});
setInterval(() => {}, 1000);
