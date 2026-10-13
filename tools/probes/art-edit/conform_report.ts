import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSpec,
  decodePng,
  loadStudioContent,
  reportOnly,
} from "../../../packages/assets/src/studio/index";

const repo = resolve(import.meta.dir, "../../..");
const paths = Bun.argv.slice(2);
if (paths.length === 0) {
  console.error("Usage: bun conform_report.ts <64x80.png>...");
  process.exit(2);
}

const loaded = loadStudioContent(resolve(repo, "content/greek"));
if (!loaded.ok) {
  console.error(JSON.stringify(loaded.diagnostics));
  process.exit(1);
}
const built = buildSpec(loaded.content, {
  schemaVersion: 1,
  subject: "zeus",
  kind: "sprite",
  slots: [{ state: "idle", direction: "south" }],
  batch: 1,
});
if (!built.ok) {
  console.error(JSON.stringify(built.error));
  process.exit(1);
}

const params = {
  background: { type: "alpha" },
  alphaCutoff: 128,
  grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
  scale: 1,
} as const;

const results: Record<string, unknown> = {};
for (const path of paths) {
  const decoded = decodePng(new Uint8Array(readFileSync(path)));
  if (!decoded.ok) {
    results[path] = { status: "undecodable", message: decoded.message };
    continue;
  }
  const result = reportOnly(decoded.image, built.value, params);
  results[path] =
    result.status === "done"
      ? {
          status: result.report.status,
          checks: result.report.checks,
          pixelsChanged: result.metrics.pixelsChanged,
          coloursBefore: result.metrics.coloursBefore,
        }
      : { status: result.status };
}
console.log(JSON.stringify(results));
