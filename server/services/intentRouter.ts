export {
  routeIntent,
  ROUTER_VERSION,
  getMetricsSnapshot,
  getCacheStats,
  invalidateCache,
  getCircuitBreakerStats,
  configure,
  getConfig,
  preprocess,
  detectLanguage,
  isCodeSwitching,
  ruleBasedMatch,
  extractSlots,
  knnMatch,
  calibrate,
  computeConfusionMatrix,
  llmFallback,
  detectMultiIntent,
  buildExecutionPlan,
  generateDisambiguationQuestion,
  type IntentResult,
  type MultiIntentResult,
  type UnifiedIntentResult
} from "./intent-engine";

export {
  IntentTypeSchema,
  OutputFormatSchema,
  SlotsSchema,
  IntentResultSchema,
  type IntentType,
  type OutputFormat,
  type Slots
} from "../../shared/schemas/intent";
