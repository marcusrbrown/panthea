// Content validation and import tools.
//
//   bun run src/index.ts assets [--root <content root>]
//
// `assets` validates the asset data under the content root (default
// content/greek), plus this repository's render kit library and Python licence boundary:
// exit 0 when valid, 1 when invalid (one diagnostic per line, "<file>: <message>"), 64 for
// a usage error.

import { join, resolve } from "node:path";
import { validateAssets } from "./assets";

export {
  type AssetDiagnostic,
  type AssetValidation,
  type AssetValidationOptions,
  validateAssets,
} from "./assets";

const DEFAULT_ROOT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "content",
  "greek",
);

/** The repository the validator lives in: kits and Python files are always checked here. */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

export function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  const rootGiven =
    rest.length === 2 &&
    rest[0] === "--root" &&
    !(rest[1] ?? "--").startsWith("--");
  if (command !== "assets" || (rest.length > 0 && !rootGiven)) {
    console.error("usage: index.ts assets [--root <content root>]");
    return 64;
  }
  const root = rootGiven ? resolve(rest[1] as string) : DEFAULT_ROOT;
  const result = validateAssets(root, { repoRoot: REPO_ROOT });
  for (const diagnostic of result.diagnostics) {
    console.error(`${diagnostic.file}: ${diagnostic.message}`);
  }
  if (result.ok) console.log(`assets valid: ${root}`);
  return result.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
