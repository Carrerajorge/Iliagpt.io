import { z } from "zod";

export const ROUTER_VERSION = "2.0.0";

export const IntentTypeSchema = z.enum([
  "CREATE_PRESENTATION",
  "CREATE_DOCUMENT",
  "CREATE_SPREADSHEET",
  "SUMMARIZE",
  "TRANSLATE",
  "SEARCH_WEB",
  "ANALYZE_DOCUMENT",
  "CHAT_GENERAL",
  "NEED_CLARIFICATION"
]);

export const OutputFormatSchema = z.enum([
  "pptx",
  "docx",
  "xlsx",
  "pdf",
  "txt",
  "csv",
  "html"
]).nullable();

export const LengthSchema = z.enum(["short", "medium", "long"]).nullable();

export const SlotsSchema = z.object({
  topic: z.string().optional(),
  title: z.string().optional(),
  language: z.string().optional(),
  length: LengthSchema.optional(),
  audience: z.string().optional(),
  style: z.string().optional(),
  bullet_points: z.boolean().optional(),
  include_images: z.boolean().optional(),
  source_language: z.string().optional(),
  target_language: z.string().optional(),
  num_slides: z.number().optional(),
  template: z.string().optional(),
  file_paths: z.array(z.string()).optional(),
  validation_issues: z.array(z.string()).optional(),
  page_numbers: z.array(z.number()).optional(),
  page_range: z.object({ start: z.number(), end: z.number() }).optional(),
  section_number: z.number().optional(),
  scope: z.enum(["all", "partial", "specific"]).optional()
});

export const SingleIntentResultSchema = z.object({
  intent: IntentTypeSchema,
  output_format: OutputFormatSchema,
  slots: SlotsSchema,
  confidence: z.number().min(0).max(1),
  raw_confidence: z.number().min(0).max(1).optional(),
  normalized_text: z.string(),
  clarification_question: z.string().optional(),
  matched_patterns: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
  fallback_used: z.enum(["none", "knn", "llm"]).optional(),
  language_detected: z.string().optional()
});

export const PlanStepSchema = z.object({
  step_id: z.number(),
  intent: IntentTypeSchema,
  output_format: OutputFormatSchema,
  slots: SlotsSchema,
  depends_on: z.array(z.number()).optional()
});

export const MultiIntentResultSchema = z.object({
  type: z.literal("multi"),
  intents: z.array(SingleIntentResultSchema),
  plan: z.object({
    steps: z.array(PlanStepSchema),
    execution_order: z.array(z.number())
  }).optional(),
  aggregated_confidence: z.number().min(0).max(1),
  normalized_text: z.string(),
  router_version: z.string(),
  language_detected: z.string().optional(),
  processing_time_ms: z.number().optional(),
  cache_hit: z.boolean().optional()
});

export const CompoundPlanStepSchema = z.object({
  type: z.enum(["WEB_RESEARCH", "EVIDENCE_BUILD", "OUTLINE", "DRAFT_SECTIONS", "FACT_VERIFY", "RENDER_DOCX"]),
  query: z.string().optional(),
  constraints: z.record(z.any()).optional(),
  min_sources: z.number().optional(),
  dedupe: z.boolean().optional(),
  rank: z.string().optional(),
  sections: z.array(z.string()).optional(),
  require_citations: z.boolean().optional(),
  halt_below_rate: z.number().optional(),
  template: z.string().optional(),
  theme: z.string().optional(),
});

export const CompoundPlanSchema = z.object({
  isCompound: z.boolean(),
  intent: z.string(),
  doc_type: z.string().nullable(),
  output_format: z.string().nullable(),
  topic: z.string().nullable(),
  requires_research: z.boolean(),
  plan: z.object({
    id: z.string(),
    steps: z.array(CompoundPlanStepSchema),
  }).nullable(),
  confidence: z.number(),
  locale: z.string(),
});

export const IntentResultSchema = SingleIntentResultSchema.extend({
  type: z.literal("single").optional(),
  router_version: z.string().optional(),
  processing_time_ms: z.number().optional(),
  cache_hit: z.boolean().optional(),
  compound_plan: CompoundPlanSchema.optional(),
});

export const UnifiedIntentResultSchema = z.union([
  IntentResultSchema,
  MultiIntentResultSchema
]);

export type IntentType = z.infer<typeof IntentTypeSchema>;
export type OutputFormat = z.infer<typeof OutputFormatSchema>;
export type Slots = z.infer<typeof SlotsSchema>;
export type SingleIntentResult = z.infer<typeof SingleIntentResultSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type MultiIntentResult = z.infer<typeof MultiIntentResultSchema>;
export type IntentResult = z.infer<typeof IntentResultSchema>;
export type UnifiedIntentResult = z.infer<typeof UnifiedIntentResultSchema>;

export const SupportedLocales = ["es", "en", "pt", "fr", "de", "it", "ar", "hi", "ja", "ko", "zh", "ru", "tr", "id"] as const;
export type SupportedLocale = typeof SupportedLocales[number];

export interface IntentMetrics {
  total_requests: number;
  cache_hits: number;
  cache_misses: number;
  rule_only_classifications: number;
  knn_fallbacks: number;
  llm_fallbacks: number;
  clarification_requests: number;
  unknown_intents: number;
  avg_confidence: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  by_intent: Record<IntentType, number>;
  by_locale: Record<string, number>;
}

export interface CalibrationConfig {
  temperature: number;
  isotonic_bins: number[];
  isotonic_values: number[];
  rule_weight: number;
  knn_weight: number;
  min_threshold: number;
  fallback_threshold: number;
}

export const DEFAULT_CALIBRATION: CalibrationConfig = {
  temperature: 1.0,
  isotonic_bins: [0, 0.3, 0.5, 0.7, 0.85, 0.95, 1.0],
  isotonic_values: [0.1, 0.35, 0.55, 0.72, 0.88, 0.97, 1.0],
  rule_weight: 0.6,
  knn_weight: 0.4,
  min_threshold: 0.50,
  fallback_threshold: 0.80
};

export const StepConstraintsSchema = z.object({
  max_output_size: z.number(),
  allowed_formats: z.array(OutputFormatSchema),
  timeout_ms: z.number(),
  requires_document_source: z.boolean().optional(),
  requires_web_source: z.boolean().optional()
});

export const PlanConstraintsSchema = z.object({
  max_total_duration_ms: z.number(),
  max_parallel_steps: z.number(),
  allow_partial_failure: z.boolean()
});

export const FullPlanStepSchema = z.object({
  id: z.string(),
  intent: IntentTypeSchema,
  slots: z.record(z.unknown()),
  output_format: OutputFormatSchema,
  constraints: StepConstraintsSchema,
  depends_on: z.array(z.string()),
  inherits_from: z.string().optional()
});

export const ExecutionPlanSchema = z.object({
  id: z.string(),
  steps: z.array(FullPlanStepSchema),
  execution_order: z.array(z.array(z.string())),
  estimated_duration_ms: z.number(),
  constraints: PlanConstraintsSchema,
  is_valid: z.boolean(),
  validation_errors: z.array(z.string())
});

export type StepConstraints = z.infer<typeof StepConstraintsSchema>;
export type PlanConstraints = z.infer<typeof PlanConstraintsSchema>;
export type FullPlanStep = z.infer<typeof FullPlanStepSchema>;
export type ExecutionPlanType = z.infer<typeof ExecutionPlanSchema>;
