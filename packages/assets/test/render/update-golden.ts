// Rewrites test/fixtures/render/golden.json from the TypeScript post step:
//
//   bun run packages/assets/test/render/update-golden.ts
//
// Run it only for a deliberate change to the post step's output, in the same commit that bumps
// POST_STEP_VERSION. It does not touch the probe's expected cells (expected.json, expected/),
// which stay as the record of what the probe made.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cellPixelHash,
  POST_STEP_VERSION,
  postProcessSlot,
} from "../../src/render/post";
import { FIXTURE_DIR, loadRenderFixture } from "./fixture";

const result = postProcessSlot(loadRenderFixture().input);
if (!result.ok) {
  console.error(result.message);
  process.exit(1);
}
writeFileSync(
  join(FIXTURE_DIR, "golden.json"),
  `${JSON.stringify(
    {
      postStepVersion: POST_STEP_VERSION,
      cells: result.cells.map((cell) => ({
        name: cell.name,
        pixelHash: cellPixelHash(cell.image),
      })),
      envelope: result.envelope,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `golden.json: ${result.cells.length} cells, post step v${POST_STEP_VERSION}`,
);
