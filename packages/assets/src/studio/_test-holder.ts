// Test-only subprocess: opens a studio session on argv[2], records job argv[3]
// as running, prints READY, then idles until SIGTERM. A busy root prints BUSY
// and exits 3.

import { jobSource, runningJob } from "./_test-fixtures";
import { openStudioSession } from "./index";

const [root, jobId] = process.argv.slice(2);
if (!root || !jobId) {
  console.error("usage: _test-holder.ts <root> <jobId>");
  process.exit(1);
}

const opened = openStudioSession(root);
if (opened.kind === "busy") {
  console.log("BUSY");
  process.exit(3);
}

const { session } = opened;
session.store.putJob({
  schemaVersion: 1,
  source: jobSource("holder-request"),
  job: runningJob(jobId),
});
process.on("SIGTERM", () => {
  session.close();
  process.exit(0);
});
console.log("READY");
setInterval(() => {}, 1000);
