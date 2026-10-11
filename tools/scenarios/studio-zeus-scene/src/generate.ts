// Writes the committed reference digests from the committed registry:
//   bun run --cwd tools/scenarios scenario:zeus-scene:digests
// The scenario test regenerates in memory and fails if the file differs.

import { writeFileSync } from "node:fs";
import {
  buildReference,
  COMMITTED_REFERENCE,
  readCommittedRegistry,
  renderReference,
} from "./reference";

const reference = buildReference(readCommittedRegistry());
writeFileSync(COMMITTED_REFERENCE, renderReference(reference));
const frames = reference.assets.flatMap((asset) =>
  asset.selections.flatMap((selection) => selection.frames),
);
console.log(
  `wrote ${COMMITTED_REFERENCE}: ${reference.assets.length} assets, ${frames.length} frames x ${reference.zooms.length} zooms`,
);
