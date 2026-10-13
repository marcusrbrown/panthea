// Render-pipeline checks that `tools/content` runs. Node/Bun only: these read the repository
// from disk, so they are not part of the package's main or browser entry points.

export {
  checkKits,
  type Kit,
  type KitCheck,
  type KitFile,
  type KitManifest,
  type KitProblem,
  type ProfileKitRefs,
  parseKitManifest,
} from "./kits";
export {
  type BoundaryViolation,
  checkLicenceBoundary,
  checkPythonSource,
  GPL_HEADER,
} from "./licence-boundary";
