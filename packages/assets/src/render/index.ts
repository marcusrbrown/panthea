// Render-pipeline checks that `tools/content` runs. Node/Bun only: these read the repository
// from disk, so they are not part of the package's main or browser entry points.

export { type Camera, cameraHash, cellGeometry, parseCamera } from "./camera";
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
export {
  loadRenderInputs,
  type RenderInputProblem,
  type RenderInputs,
} from "./load";
export {
  type ModelProfile,
  parseProfile,
  posePolicy,
  profileHash,
  profileKitProblems,
  profileKitRefs,
  sourceFrameTimes,
} from "./profile";
export {
  classifyExit,
  classifyTermination,
  type DoneSentinel,
  EXIT_CODES,
  parseDoneSentinel,
  parseRenderRecipe,
  type RenderRecipe,
  renderDoneJson,
  renderRecipeJson,
} from "./script-contract";
