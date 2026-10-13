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
export { addOutline, measureImage } from "./outline";
export { applyOverlapLines, candidateLines } from "./overlap";
export {
  decodePartId,
  depthTable,
  idByte,
  PART_IDS,
  SUPERSAMPLE,
} from "./parts";
export {
  type CellFacts,
  cellPixelHash,
  type Envelope,
  type Facing,
  POST_STEP_VERSION,
  type PostCell,
  type PostStepFailure,
  type PostStepInput,
  type PostStepResult,
  type PostStepSettings,
  postProcessSlot,
  type RawFrame,
  type StampLocators,
  type StampRecord,
} from "./post";
export {
  type PostPalette,
  postPaletteFrom,
  postPaletteOf,
} from "./post-palette";
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
export {
  BOLT_ANGLES,
  checkStamps,
  FACE_SLOTS,
  type LoadedStampSet,
  loadStampSet,
  parseStampManifest,
  type StampCheck,
  type StampManifest,
  type StampProblem,
  type StampSet,
} from "./stamps";
