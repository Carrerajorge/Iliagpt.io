import {
  ROUTER_VERSION,
  DEFAULT_CALIBRATION,
  type IntentResult,
  type MultiIntentResult,
  type UnifiedIntentResult,
  type IntentType,
  type SupportedLocale,
  IntentResultSchema
} from "../../../shared/schemas/intent";
import { preprocess, type PreprocessResult } from "./preprocess";
import { detectLanguage, isCodeSwitching, type LanguageDetectionResult } from "./langDetect";
import { ruleBasedMatch, extractSlots, type RuleMatchResult } from "./ruleMatcher";
import { 
  knnMatch, 
  knnMatchSync,
  initializeEmbeddingIndex, 
  isSemanticIndexReady,
  type KNNResult 
} from "./embeddingMatcher";
import { 
  calibrate, 
  calibrateWithConformal,
  getCalibrationStatus,
  getCalibratorConfig,
  configureCal,
  type CalibrationOutput 
} from "./confidenceCalibrator";
import {
  getConformalPredictionSet,
  getConfidenceZone,
  getConformalStats,
  isDriftDetected,
  initializeConformalPredictor,
  recordCoverageOutcome,
  type ConformalPredictionSet,
  type ConfidenceZone,
  type CalibrationExample
} from "./conformalPredictor";
import { llmFallback, getCircuitBreakerStats } from "./fallbackManager";
import { getCached, setCached, getCacheStats, invalidateCache } from "./cache";
import {
  getSemanticCacheHit,
  setSemanticCache,
  getSemanticCacheStats
} from "./semanticCache";
import {
  startTrace,
  endTrace,
  recordError,
  recordDegradedFallback,
  getMetricsSnapshot,
  logStructured
} from "./telemetry";
import {
  detectMultiIntent,
  buildExecutionPlan,
  generateDisambiguationQuestion,
  mergeSlots
} from "./multiIntent";
import {
  detectCompoundIntent,
  validateCompoundPlan,
  serializeCompoundResult,
  isResearchEnabled,
  type CompoundIntentResult,
  type CompoundPlanStep
} from "./compoundIntentPlanner";
import {
  recordFeedback,
  recordCorrection,
  getFeedbackBatch,
  processFeedbackBatch,
  getFeedbackStats,
  registerFeedbackProcessor,
  type FeedbackSignal,
  type FeedbackType,
  type FeedbackContext
} from "./feedbackLoop";
import {
  addHardNegative,
  getConfusionPairs,
  boostHardNegatives,
  processCorrectionsToHardNegatives,
  getHardNegativeStats
} from "./hardNegatives";
import {
  proposeNewAlias,
  confirmAlias,
  getAliasCandidates,
  pruneStaleAliases,
  processCorrectionsToAliases,
  getAliasStats
} from "./aliasExpander";
import {
  recordIntentOutcome,
  getProductMetrics,
  getSliceMetrics,
  getRouteLatencyMetrics,
  recordCorrection as recordProductCorrection,
  recordClarificationResolution,
  resetProductMetrics,
  getMetricsWindow,
  type ProductMetricsSnapshot,
  type OutcomeMetadata,
  type Channel,
  type DeviceType,
  type SliceType,
  type SliceMetrics,
  type Alert as ProductAlert,
  type IntentMetricsData,
  type LocaleMetrics,
  type ChannelMetrics
} from "./productMetrics";
import {
  checkSliceAlerts,
  getActiveAlerts,
  getAllAlerts,
  acknowledgeAlert,
  configureAlertThresholds,
  getAlertThresholds,
  setBaseline,
  getBaseline,
  clearAlerts,
  resetAlertSystem,
  getAlertSummary,
  type AlertSeverity,
  type AlertThresholds,
  type SliceAlertConfig,
  type AlertSummary
} from "./sliceAlerts";
import {
  recordCalibrationDrift,
  getCalibrationDriftMetrics
} from "./telemetry";

export interface RouterConfig {
  enableCache: boolean;
  enableSemanticCache: boolean;
  enableKNN: boolean;
  enableSemanticKNN: boolean;
  enableLLMFallback: boolean;
  enableMultiIntent: boolean;
  enableConformal: boolean;
  fallbackThreshold: number;
  maxRetries: number;
  timeout: number;
}

const DEFAULT_CONFIG: RouterConfig = {
  enableCache: true,
  enableSemanticCache: true,
  enableKNN: true,
  enableSemanticKNN: true,
  enableLLMFallback: true,
  enableMultiIntent: true,
  enableConformal: true,
  fallbackThreshold: 0.80,
  maxRetries: 2,
  timeout: 15000
};

let currentConfig: RouterConfig = { ...DEFAULT_CONFIG };

let embeddingIndexInitPromise: Promise<void> | null = null;
let embeddingIndexInitialized = false;

type IntentRoutedCallback = (result: IntentResult, originalText: string) => void;
type CorrectionReceivedCallback = (signal: FeedbackSignal) => void;

const intentRoutedCallbacks: IntentRoutedCallback[] = [];
const correctionReceivedCallbacks: CorrectionReceivedCallback[] = [];

export function onIntentRouted(callback: IntentRoutedCallback): () => void {
  intentRoutedCallbacks.push(callback);
  return () => {
    const index = intentRoutedCallbacks.indexOf(callback);
    if (index > -1) intentRoutedCallbacks.splice(index, 1);
  };
}

export function onCorrectionReceived(callback: CorrectionReceivedCallback): () => void {
  correctionReceivedCallbacks.push(callback);
  return () => {
    const index = correctionReceivedCallbacks.indexOf(callback);
    if (index > -1) correctionReceivedCallbacks.splice(index, 1);
  };
}

function notifyIntentRouted(result: IntentResult, originalText: string): void {
  for (const callback of intentRoutedCallbacks) {
    try {
      callback(result, originalText);
    } catch (error) {
      logStructured("error", "Intent routed callback error", {
        error: (error as Error).message
      });
    }
  }
}

function notifyCorrectionReceived(signal: FeedbackSignal): void {
  for (const callback of correctionReceivedCallbacks) {
    try {
      callback(signal);
    } catch (error) {
      logStructured("error", "Correction received callback error", {
        error: (error as Error).message
      });
    }
  }
}

export function recordIntentCorrection(
  originalText: string,
  originalIntent: IntentType,
  correctedIntent: IntentType,
  locale: SupportedLocale,
  sessionId?: string
): FeedbackSignal {
  const signal = recordCorrection(
    originalText,
    originalIntent,
    correctedIntent,
    locale,
    sessionId
  );

  addHardNegative(originalText, originalIntent, correctedIntent, locale);
  proposeNewAlias(correctedIntent, originalText, locale, signal.id);
  notifyCorrectionReceived(signal);

  return signal;
}

function isTestEnv(): boolean {
  // Vitest sets one of these.
  return (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    process.env.VITEST_WORKER_ID !== undefined ||
    process.env.VITEST_POOL_ID !== undefined
  );
}

async function ensureEmbeddingIndexInitialized(): Promise<void> {
  if (embeddingIndexInitialized) return;

  // In unit tests we don't need the heavy semantic index (and it can slow suites / cause timeouts).
  if (isTestEnv()) {
    embeddingIndexInitialized = true;
    return;
  }
  
  if (embeddingIndexInitPromise) {
    return embeddingIndexInitPromise;
  }
  
  embeddingIndexInitPromise = (async () => {
    try {
      logStructured("info", "Lazy-loading semantic embedding index", {});
      await initializeEmbeddingIndex();
      embeddingIndexInitialized = true;
      logStructured("info", "Semantic embedding index initialized successfully", {});
    } catch (error: any) {
      logStructured("error", "Failed to initialize semantic embedding index", {
        error: error.message
      });
    }
  })();
  
  return embeddingIndexInitPromise;
}

export function configure(config: Partial<RouterConfig>): void {
  currentConfig = { ...currentConfig, ...config };
  logStructured("info", "Router configuration updated", { config: currentConfig });
}

export function getConfig(): RouterConfig {
  return { ...currentConfig };
}

function generateClarificationQuestion(
  ruleResult: RuleMatchResult,
  locale: SupportedLocale
): string {
  const questions: Record<SupportedLocale, Record<string, string>> = {
    es: {
      format: "¿En qué formato lo quieres? (PowerPoint, Word o Excel)",
      topic: "¿Sobre qué tema te gustaría que trate?",
      general: "¿Podrías darme más detalles sobre lo que necesitas?"
    },
    en: {
      format: "What format would you like? (PowerPoint, Word, or Excel)",
      topic: "What topic would you like it to be about?",
      general: "Could you give me more details about what you need?"
    },
    pt: {
      format: "Em que formato você quer? (PowerPoint, Word ou Excel)",
      topic: "Sobre qual tema você gostaria que fosse?",
      general: "Você poderia me dar mais detalhes sobre o que precisa?"
    },
    fr: {
      format: "Quel format souhaitez-vous ? (PowerPoint, Word ou Excel)",
      topic: "Quel sujet aimeriez-vous aborder ?",
      general: "Pourriez-vous me donner plus de détails sur ce dont vous avez besoin ?"
    },
    de: {
      format: "Welches Format möchten Sie? (PowerPoint, Word oder Excel)",
      topic: "Über welches Thema soll es gehen?",
      general: "Könnten Sie mir mehr Details geben, was Sie brauchen?"
    },
    it: {
      format: "Quale formato preferisci? (PowerPoint, Word o Excel)",
      topic: "Su quale argomento vorresti che fosse?",
      general: "Potresti darmi più dettagli su cosa ti serve?"
    }
  };

  const localeQuestions = questions[locale] || questions.en;

  if (ruleResult.has_creation_verb && !ruleResult.output_format) {
    return localeQuestions.format;
  }

  return localeQuestions.general;
}

export async function routeIntent(
  text: string,
  config: Partial<RouterConfig> = {}
): Promise<IntentResult> {
  const effectiveConfig = { ...currentConfig, ...config };
  const startTime = Date.now();
  const ctx = startTrace("routeIntent", { text_length: text.length });

  try {
    if (effectiveConfig.enableSemanticKNN && !embeddingIndexInitialized) {
      ensureEmbeddingIndexInitialized().catch(() => {});
    }

    const langResult = detectLanguage(text);
    const locale = langResult.locale;

    logStructured("info", "Language detected", {
      locale,
      confidence: langResult.confidence,
      method: langResult.method,
      is_code_switching: isCodeSwitching(text)
    });

    const preprocessResult = preprocess(text, locale);
    const { normalized } = preprocessResult;

    logStructured("info", "Text preprocessed", {
      original_length: text.length,
      normalized_length: normalized.length,
      typos_corrected: preprocessResult.typos_corrected.length,
      urls_removed: preprocessResult.removed_urls.length,
      emojis_removed: preprocessResult.removed_emojis.length
    });

    if (effectiveConfig.enableCache) {
      const cached = getCached(normalized, ROUTER_VERSION);
      if (cached) {
        logStructured("info", "Cache hit", { normalized_text: normalized.substring(0, 50) });
        
        const result: IntentResult = {
          ...cached,
          processing_time_ms: Date.now() - startTime,
          cache_hit: true,
          router_version: ROUTER_VERSION
        };
        
        endTrace(ctx, result, true);
        return result;
      }
    }

    if (effectiveConfig.enableMultiIntent) {
      const multiResult = detectMultiIntent(normalized);
      if (multiResult.isMultiIntent && multiResult.detectedIntents.length > 1) {
        logStructured("info", "Multi-intent detected", {
          intents: multiResult.detectedIntents,
          separator: multiResult.separatorType
        });
      }
    }

    const compoundResult = detectCompoundIntent(text, locale);
    if (compoundResult.isCompound) {
      logStructured("info", "Compound intent detected (research + document)", {
        doc_type: compoundResult.doc_type,
        topic: compoundResult.topic,
        requires_research: compoundResult.requires_research,
        steps_count: compoundResult.plan?.steps.length || 0
      });

      const validation = validateCompoundPlan(compoundResult);
      
      if (validation.errors.includes("research_not_enabled")) {
        logStructured("warn", "Research not enabled for compound intent", {
          topic: compoundResult.topic
        });
        
        const result: IntentResult = {
          intent: "NEED_CLARIFICATION",
          output_format: compoundResult.output_format,
          slots: { topic: compoundResult.topic || undefined },
          confidence: 0.85,
          normalized_text: normalized,
          clarification_question: locale === "es" 
            ? "La investigación web no está habilitada. ¿Deseas que cree el documento sin investigación previa?"
            : "Web research is not enabled. Would you like me to create the document without prior research?",
          matched_patterns: ["compound_research_document"],
          fallback_used: "none",
          language_detected: locale,
          type: "single",
          router_version: ROUTER_VERSION,
          processing_time_ms: Date.now() - startTime,
          cache_hit: false,
          compound_plan: serializeCompoundResult(compoundResult)
        };
        
        endTrace(ctx, result, true);
        return result;
      }

      if (validation.isValid && compoundResult.plan) {
        const result: IntentResult = {
          intent: "CREATE_DOCUMENT",
          output_format: compoundResult.output_format,
          slots: { 
            topic: compoundResult.topic || undefined,
            doc_type: compoundResult.doc_type || undefined
          },
          confidence: compoundResult.confidence,
          normalized_text: normalized,
          matched_patterns: ["compound_research_document"],
          fallback_used: "none",
          language_detected: locale,
          type: "single",
          router_version: ROUTER_VERSION,
          processing_time_ms: Date.now() - startTime,
          cache_hit: false,
          compound_plan: serializeCompoundResult(compoundResult)
        };
        
        if (effectiveConfig.enableCache) {
          setCached(normalized, ROUTER_VERSION, result);
        }
        
        notifyIntentRouted(result, text);
        endTrace(ctx, result, true);
        return result;
      }
    }

    const ruleResult = ruleBasedMatch(normalized, locale);

    logStructured("info", "Rule-based match complete", {
      intent: ruleResult.intent,
      confidence: ruleResult.confidence,
      raw_score: ruleResult.raw_score,
      patterns_matched: ruleResult.matched_patterns.length,
      has_creation_verb: ruleResult.has_creation_verb
    });

    let knnResult: KNNResult | null = null;
    let queryEmbedding: number[] | undefined;
    
    if (effectiveConfig.enableKNN) {
      const useSemanticKNN = effectiveConfig.enableSemanticKNN && isSemanticIndexReady();
      
      if (useSemanticKNN) {
        knnResult = await knnMatch(text, {
          useSemantic: true,
          k: 20,
          fallbackToTFIDF: true
        });
        
        queryEmbedding = knnResult.embedding;
        
        if (effectiveConfig.enableSemanticCache && queryEmbedding) {
          const semanticCacheHit = getSemanticCacheHit(queryEmbedding);
          if (semanticCacheHit) {
            logStructured("info", "Semantic cache hit", {
              similarity: semanticCacheHit.similarity,
              intent: semanticCacheHit.result.intent
            });
            
            const result: IntentResult = {
              ...semanticCacheHit.result,
              processing_time_ms: Date.now() - startTime,
              cache_hit: true,
              router_version: ROUTER_VERSION
            };
            
            endTrace(ctx, result, true);
            return result;
          }
        }
      } else {
        knnResult = knnMatchSync(text, 5);
      }
      
      logStructured("info", "KNN match complete", {
        intent: knnResult.intent,
        confidence: knnResult.confidence,
        method: knnResult.method,
        top_match_similarity: knnResult.top_matches[0]?.similarity || 0
      });
    }

    const ALL_INTENTS: IntentType[] = [
      "CREATE_PRESENTATION",
      "CREATE_DOCUMENT",
      "CREATE_SPREADSHEET",
      "SUMMARIZE",
      "TRANSLATE",
      "SEARCH_WEB",
      "ANALYZE_DOCUMENT",
      "CHAT_GENERAL",
      "NEED_CLARIFICATION"
    ];
    
    const intentScores: Record<IntentType, number> = {} as Record<IntentType, number>;
    for (const intent of ALL_INTENTS) {
      if (intent === ruleResult.intent) {
        intentScores[intent] = ruleResult.confidence;
      } else {
        // Use deterministic zero score for non-matching intents instead of random noise
        // Random values cause non-deterministic calibration and make debugging impossible
        intentScores[intent] = 0;
      }
    }
    
    if (knnResult) {
      intentScores[knnResult.intent] = Math.max(
        intentScores[knnResult.intent] || 0, 
        knnResult.confidence
      );
    }

    const calibrationInput = {
      rule_confidence: ruleResult.confidence,
      knn_confidence: knnResult?.confidence || ruleResult.confidence,
      rule_patterns_matched: ruleResult.matched_patterns.length,
      has_creation_verb: ruleResult.has_creation_verb,
      text_length: text.length,
      language_confidence: langResult.confidence,
      intent_scores: intentScores
    };

    const calibrated = calibrate(calibrationInput, DEFAULT_CALIBRATION);

    logStructured("info", "Confidence calibrated", {
      raw_combined: calibrated.raw_combined,
      calibrated: calibrated.calibrated_confidence,
      adjustment: calibrated.adjustment_applied,
      should_fallback: calibrated.should_fallback,
      confidence_zone: calibrated.confidence_zone,
      prediction_set_size: calibrated.conformal_prediction_set?.intents.length,
      calibration_drift_detected: calibrated.calibration_drift_detected
    });

    let finalIntent = ruleResult.intent;
    let finalConfidence = calibrated.calibrated_confidence;
    let fallbackUsed: "none" | "knn" | "llm" = "none";
    let reasoning: string | undefined;
    let slots = extractSlots(normalized, text);
    let conformalZone: ConfidenceZone | undefined = calibrated.confidence_zone;
    let predictionSetSize = calibrated.conformal_prediction_set?.intents.length || 1;

    if (effectiveConfig.enableConformal && calibrated.conformal_prediction_set) {
      const conformalResult = calibrateWithConformal(intentScores, locale);
      conformalZone = conformalResult.predictionSet.zone;
      predictionSetSize = conformalResult.predictionSet.intents.length;
      
      logStructured("info", "Conformal prediction applied", {
        zone: conformalZone,
        prediction_set_size: predictionSetSize,
        selected_intent: conformalResult.selectedIntent,
        should_clarify: conformalResult.shouldClarify,
        drift_detected: conformalResult.driftDetected
      });
      
      if (conformalZone === "HIGH_CONFIDENCE") {
        finalIntent = conformalResult.selectedIntent;
      } else if (conformalZone === "MEDIUM_CONFIDENCE") {
        if (knnResult && knnResult.confidence > ruleResult.confidence) {
          finalIntent = knnResult.intent;
          fallbackUsed = "knn";
        } else {
          finalIntent = conformalResult.selectedIntent;
        }
      }
    }

    if (knnResult && knnResult.confidence > ruleResult.confidence && !effectiveConfig.enableConformal) {
      finalIntent = knnResult.intent;
      fallbackUsed = "knn";
      
      if (knnResult.method === "semantic_knn") {
        finalConfidence = Math.max(finalConfidence, knnResult.confidence * 0.95);
      }
    }

    const shouldUseLLMFallback = effectiveConfig.enableConformal 
      ? (conformalZone === "LOW_CONFIDENCE" && effectiveConfig.enableLLMFallback)
      : (calibrated.should_fallback && effectiveConfig.enableLLMFallback);

    if (shouldUseLLMFallback) {
      logStructured("info", "Triggering LLM fallback", {
        calibrated_confidence: calibrated.calibrated_confidence,
        threshold: effectiveConfig.fallbackThreshold,
        conformal_zone: conformalZone
      });

      try {
        const llmResult = await llmFallback(
          normalized,
          text,
          effectiveConfig.maxRetries
        );

        if (llmResult.fallback_method === "llm") {
          finalIntent = llmResult.intent;
          finalConfidence = llmResult.confidence;
          slots = { ...slots, ...llmResult.slots };
          reasoning = llmResult.reasoning;
          fallbackUsed = "llm";

          logStructured("info", "LLM fallback successful", {
            intent: finalIntent,
            confidence: finalConfidence
          });
        } else {
          recordDegradedFallback();
          logStructured("warn", "Using degraded fallback", {
            intent: llmResult.intent,
            error: llmResult.error
          });
        }
      } catch (error) {
        recordError(error as Error, ctx);
        logStructured("error", "LLM fallback failed", {
          error: (error as Error).message
        });
      }
    }

    let clarificationQuestion: string | undefined;
    
    if (effectiveConfig.enableConformal && conformalZone === "LOW_CONFIDENCE") {
      finalIntent = "NEED_CLARIFICATION";
      const conformalClarification = calibrateWithConformal(intentScores, locale);
      clarificationQuestion = conformalClarification.clarificationQuestion;
    } else if (finalConfidence < 0.50 || finalIntent === "CHAT_GENERAL") {
      if (ruleResult.has_creation_verb && !ruleResult.output_format) {
        finalIntent = "NEED_CLARIFICATION";
        clarificationQuestion = generateClarificationQuestion(ruleResult, locale);
      }
    }

    const result: IntentResult = {
      intent: finalIntent,
      output_format: ruleResult.output_format,
      slots,
      confidence: finalConfidence,
      raw_confidence: calibrated.raw_combined,
      normalized_text: normalized,
      clarification_question: clarificationQuestion,
      matched_patterns: ruleResult.matched_patterns,
      reasoning,
      fallback_used: fallbackUsed,
      language_detected: locale,
      type: "single",
      router_version: ROUTER_VERSION,
      processing_time_ms: Date.now() - startTime,
      cache_hit: false
    };

    const validatedResult = IntentResultSchema.parse(result);

    if (effectiveConfig.enableCache) {
      setCached(normalized, ROUTER_VERSION, validatedResult);
    }

    if (effectiveConfig.enableSemanticCache && queryEmbedding) {
      setSemanticCache(queryEmbedding, validatedResult);
    }

    notifyIntentRouted(validatedResult, text);

    endTrace(ctx, validatedResult, true);
    return validatedResult;

  } catch (error) {
    recordError(error as Error, ctx);
    
    logStructured("error", "Route intent failed", {
      error: (error as Error).message,
      text_length: text.length
    });

    const fallbackResult: IntentResult = {
      intent: "CHAT_GENERAL",
      output_format: null,
      slots: {},
      confidence: 0.30,
      normalized_text: text.toLowerCase(),
      fallback_used: "none",
      type: "single",
      router_version: ROUTER_VERSION,
      processing_time_ms: Date.now() - startTime,
      cache_hit: false
    };

    endTrace(ctx, fallbackResult, false);
    return fallbackResult;
  }
}

export async function initializeRouter(): Promise<void> {
  logStructured("info", "Initializing Intent Router v2.0", {});
  
  try {
    await ensureEmbeddingIndexInitialized();
    logStructured("info", "Intent Router initialized successfully", {
      semantic_index_ready: isSemanticIndexReady()
    });
  } catch (error: any) {
    logStructured("warn", "Intent Router initialized with degraded capabilities", {
      error: error.message,
      semantic_index_ready: false
    });
  }
}

export function getRouterStatus(): {
  version: string;
  semantic_index_ready: boolean;
  config: RouterConfig;
  cache_stats: ReturnType<typeof getCacheStats>;
  semantic_cache_stats: ReturnType<typeof getSemanticCacheStats>;
  circuit_breaker: ReturnType<typeof getCircuitBreakerStats>;
  conformal_stats: ReturnType<typeof getConformalStats> | null;
  calibration_status: ReturnType<typeof getCalibrationStatus>;
} {
  return {
    version: ROUTER_VERSION,
    semantic_index_ready: isSemanticIndexReady(),
    config: currentConfig,
    cache_stats: getCacheStats(),
    semantic_cache_stats: getSemanticCacheStats(),
    circuit_breaker: getCircuitBreakerStats(),
    conformal_stats: currentConfig.enableConformal ? getConformalStats() : null,
    calibration_status: getCalibrationStatus()
  };
}

export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY";

export interface RouterHealth {
  status: HealthStatus;
  version: string;
  uptime_seconds: number;
  metrics_summary: {
    total_requests: number;
    success_rate: number;
    error_rate: number;
    p95_latency_ms: number;
    fallback_rate: number;
    unknown_rate: number;
  };
  active_alerts: ProductAlert[];
  alert_summary: AlertSummary;
  degraded_components: string[];
  last_check: Date;
}

const startTime = Date.now();

export function getRouterHealth(): RouterHealth {
  const alerts = checkSliceAlerts();
  const activeAlerts = getActiveAlerts();
  const alertSummary = getAlertSummary();
  const metrics = getMetricsSnapshot();
  const productMetrics = getProductMetrics(activeAlerts);
  
  const degradedComponents: string[] = [];
  let status: HealthStatus = "HEALTHY";
  
  if (!isSemanticIndexReady()) {
    degradedComponents.push("semantic_embeddings");
  }
  
  const circuitBreaker = getCircuitBreakerStats();
  if (circuitBreaker.state === "OPEN") {
    degradedComponents.push("llm_fallback");
  }
  
  if (alertSummary.by_severity.CRITICAL > 0) {
    status = "UNHEALTHY";
  } else if (alertSummary.by_severity.WARNING > 0 || degradedComponents.length > 0) {
    status = "DEGRADED";
  }
  
  if (metrics.error_rate > 0.10) {
    status = "UNHEALTHY";
  } else if (metrics.error_rate > 0.05) {
    if (status === "HEALTHY") {
      status = "DEGRADED";
    }
  }
  
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  
  return {
    status,
    version: ROUTER_VERSION,
    uptime_seconds: uptimeSeconds,
    metrics_summary: {
      total_requests: metrics.total_requests,
      success_rate: productMetrics.overall.success_rate,
      error_rate: metrics.error_rate,
      p95_latency_ms: metrics.p95_latency_ms,
      fallback_rate: productMetrics.overall.fallback_rate,
      unknown_rate: productMetrics.overall.unknown_rate
    },
    active_alerts: activeAlerts,
    alert_summary: alertSummary,
    degraded_components: degradedComponents,
    last_check: new Date()
  };
}

export {
  ROUTER_VERSION,
  getMetricsSnapshot,
  getCacheStats,
  getSemanticCacheStats,
  invalidateCache,
  getCircuitBreakerStats,
  isSemanticIndexReady,
  type IntentResult,
  type MultiIntentResult,
  type UnifiedIntentResult
};

export { preprocess } from "./preprocess";
export { detectLanguage, isCodeSwitching } from "./langDetect";
export { ruleBasedMatch, extractSlots } from "./ruleMatcher";
export { knnMatch, knnMatchSync } from "./embeddingMatcher";
export { 
  calibrate, 
  computeConfusionMatrix, 
  calibrateWithConformal, 
  getCalibrationStatus,
  configureCal 
} from "./confidenceCalibrator";
export {
  calibrateConformalPredictor,
  getConformalPredictionSet,
  getConfidenceZone,
  getConformalStats,
  initializeConformalPredictor,
  recordCoverageOutcome,
  isDriftDetected,
  type CalibrationExample,
  type ConformalPredictionSet,
  type ConfidenceZone,
  type ConformalStats
} from "./conformalPredictor";
export { llmFallback } from "./fallbackManager";
export { 
  detectMultiIntent, 
  buildExecutionPlan, 
  buildEnhancedExecutionPlan,
  generateDisambiguationQuestion,
  mergeSlots,
  inheritSlotsForStep,
  getExecutableSteps,
  validateMultiIntentPlan,
  type ExecutionPlan,
  type IntentInput,
  type EnhancedMultiIntentPlan,
  type MultiIntentDetectionResult
} from "./multiIntent";
export {
  createExecutionPlan,
  validatePlanConstraints,
  getStepDependencies,
  getDefaultConstraints,
  getParallelGroups,
  canExecuteInParallel,
  getStepOutput,
  serializeExecutionPlan,
  deserializeExecutionPlan,
  type PlanStep,
  type StepConstraints,
  type PlanConstraints,
  type ValidationResult
} from "./intentPlanner";
export { 
  initializeEmbeddingIndex, 
  semanticKNNMatch, 
  addExampleToIndex, 
  getIndexStats 
} from "./semanticEmbeddings";
export { 
  getSemanticCacheHit, 
  setSemanticCache, 
  clearSemanticCache 
} from "./semanticCache";
export {
  recordFeedback,
  recordCorrection,
  recordRephrase,
  recordFormatChange,
  recordEarlyStop,
  recordClarificationResult,
  getFeedbackBatch,
  processFeedbackBatch,
  getFeedbackStats,
  getAllFeedback,
  clearFeedbackStore,
  registerFeedbackProcessor,
  startCleanupTimer,
  stopCleanupTimer,
  type FeedbackSignal,
  type FeedbackType,
  type FeedbackContext,
  type ProcessedBatchResult
} from "./feedbackLoop";
export {
  addHardNegative,
  getConfusionPairs,
  getTopConfusionPairs,
  getConfusionCountBetween,
  boostHardNegatives,
  decayHardNegativeWeights,
  getHardNegatives,
  getHardNegativesForIntent,
  getHardNegativeStats,
  processCorrectionsToHardNegatives,
  clearHardNegatives,
  exportHardNegatives,
  importHardNegatives,
  getEmbeddingsForBoosting,
  type HardNegative,
  type ConfusionPair
} from "./hardNegatives";
export {
  proposeNewAlias,
  confirmAlias,
  rejectAlias,
  getAliasCandidates,
  getPendingCandidates,
  getConfirmedAliasesForIntent,
  getAllConfirmedAliases,
  pruneStaleAliases,
  processCorrectionsToAliases,
  processRephrasesToAliases,
  getAliasStats,
  clearAliasStore,
  exportAliasCandidates,
  exportConfirmedAliases,
  importAliasCandidates,
  type AliasCandidate,
  type ConfirmedAlias
} from "./aliasExpander";

export {
  recordIntentOutcome,
  getProductMetrics,
  getSliceMetrics,
  getRouteLatencyMetrics,
  recordClarificationResolution,
  resetProductMetrics,
  getMetricsWindow,
  type ProductMetricsSnapshot,
  type OutcomeMetadata,
  type Channel,
  type DeviceType,
  type SliceType,
  type SliceMetrics,
  type Alert as ProductAlert,
  type IntentMetricsData,
  type LocaleMetrics,
  type ChannelMetrics
} from "./productMetrics";

export {
  checkSliceAlerts,
  getActiveAlerts,
  getAllAlerts,
  acknowledgeAlert,
  configureAlertThresholds,
  getAlertThresholds,
  setBaseline,
  getBaseline,
  clearAlerts,
  resetAlertSystem,
  getAlertSummary,
  type AlertSeverity,
  type AlertThresholds,
  type SliceAlertConfig,
  type AlertSummary
} from "./sliceAlerts";

export {
  recordCalibrationDrift,
  getCalibrationDriftMetrics,
  type RouteLatencyMetrics
} from "./telemetry";
