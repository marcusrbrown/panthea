// Content hashing. Uses node:crypto, so this is a Node/Bun module.

import { createHash } from "node:crypto";
import type { Sha256 } from "@panthea/contracts";

export function sha256Hex(bytes: Uint8Array): Sha256 {
  return createHash("sha256").update(bytes).digest("hex") as Sha256;
}
