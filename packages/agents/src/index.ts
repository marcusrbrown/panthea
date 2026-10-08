// Context, memory, planning, model routing, and fallback live here. Model
// routing: a router that turns a context into a typed intent through
// operator-configured OpenAI-compatible endpoints. Context: a god's prompt and
// intent schema built from its profile and one perception snapshot, and the
// trusted builder that turns a parsed intent into an observation and proposal.

export type {
  Endpoint,
  ParseResult,
  RoleAssignment,
  RoutePlan,
  RouteStep,
  RoutingConfig,
} from "./config";
export {
  isLocalHost,
  isLocalUrl,
  parseRoutingConfig,
  planRoute,
} from "./config";
export type {
  GoalHistoryEntry,
  GodIntent,
  GodIntentAction,
  ParsedGodIntent,
  Remembered,
} from "./context";
export {
  authoredAction,
  buildGodContext,
  GOD_INTENT_ACTIONS,
  godAvailableActions,
  godIntentSchema,
  MAX_ASSERTION_LENGTH,
  MAX_FEELINGS,
  MAX_GOAL_HISTORY,
  MAX_OWN_ACTIONS,
  MAX_REMEMBERED,
  NOTHING_REMEMBERED,
  OWN_EVENT_WINDOW,
  PRAYERS_HEADING,
  rememberedBy,
  shownIds,
} from "./context";
export type { ModelProposalResult } from "./observation";
export { buildModelProposal, snapshotFacts } from "./observation";
export type {
  AnswerMove,
  DemandCause,
  PracticeIntent,
  PracticeOptions,
  SchedulingSignals,
  Standing,
  ThreadView,
} from "./practices";
export {
  CONTESTS_BUDGET_CHARS,
  CONTESTS_HEADING,
  DIGEST_BUDGET_CHARS,
  describeContests,
  describeDigest,
  describeTerm,
  PRACTICES_HEADING,
  PRAYERS_BUDGET_CHARS,
  PROMPT_TOKEN_CAP,
  schedulingSignals,
} from "./practices";
export type { CapInput, Capped, ShedCounts } from "./prompt-cap";
export {
  DEFAULT_RATIO,
  estimateTokens,
  fitsCap,
  fitToCap,
  MODEL_RATIOS,
  routeRatio,
} from "./prompt-cap";
export type { EndpointModelArgs } from "./providers";
export { createEndpointModel, RedirectRefusedError } from "./providers";
export { extractJsonObjects, repairIntent } from "./repair";
export type {
  FailureReason,
  IntentSchema,
  RouteContext,
  RouteLimits,
  RouteResult,
  Router,
  RouterOptions,
  StepFailure,
  StepMetadata,
} from "./router";
export {
  createRouter,
  DEFAULT_ROUTE_LIMITS,
  requestChars,
} from "./router";
export type { GodSignals, Pick, Rotation } from "./scheduler";
export { pickGod, SKIP_CAP, START_OF_ROTATION } from "./scheduler";
export type { EndpointStatus, RouteOutcome } from "./status";
export { initialEndpointStatus, recordRouteOutcome } from "./status";
export type {
  AnsweredRequest,
  CapFigures,
  ExhaustedRequest,
  GodTurnDeps,
  GodTurnResult,
} from "./turn";
export { runGodTurn } from "./turn";
