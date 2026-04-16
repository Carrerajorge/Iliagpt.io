import { z } from "zod";

export const PIPELINE_VERSION = "3.0.0";

export const SupportedLocaleSchema = z.enum(["es", "en", "pt", "fr", "de", "it", "ar", "hi", "ja", "ko", "zh", "ru", "tr", "id"]);
export type SupportedLocale = z.infer<typeof SupportedLocaleSchema>;

export const SourceRefSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url().optional(),
  title: z.string(),
  author: z.string().optional(),
  publishedDate: z.string().optional(),
  accessedAt: z.string().datetime(),
  type: z.enum(["web", "pdf", "doc", "api", "database", "user_input"]),
  reliability: z.number().min(0).max(1).default(0.7),
  locale: SupportedLocaleSchema.optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const EvidenceChunkSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  span: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    page: z.number().int().positive().optional(),
    paragraph: z.number().int().positive().optional(),
  }),
  text: z.string().min(1),
  score: z.number().min(0).max(1),
  lang: SupportedLocaleSchema,
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.any()).optional(),
});
export type EvidenceChunk = z.infer<typeof EvidenceChunkSchema>;

export const NormalizedFactSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.any())]),
  unit: z.string().optional(),
  sourceId: z.string().uuid(),
  evidenceChunkIds: z.array(z.string().uuid()),
  confidence: z.number().min(0).max(1),
  provenance: z.object({
    extractedAt: z.string().datetime(),
    extractionMethod: z.enum(["regex", "llm", "parser", "hybrid"]),
    validatedBy: z.array(z.string()).optional(),
  }),
  locale: SupportedLocaleSchema,
  dataType: z.enum(["number", "currency", "percentage", "date", "text", "entity", "metric"]),
});
export type NormalizedFact = z.infer<typeof NormalizedFactSchema>;

export const AudienceTypeSchema = z.enum(["executive", "technical", "academic", "operational", "general"]);
export type AudienceType = z.infer<typeof AudienceTypeSchema>;

export const DocumentGoalSchema = z.enum(["analyze", "report", "recommend", "audit", "forecast", "compare", "explain", "summarize"]);
export type DocumentGoal = z.infer<typeof DocumentGoalSchema>;

export const SectionStyleSchema = z.object({
  tone: z.enum(["formal", "technical", "conversational", "academic"]),
  detailLevel: z.enum(["brief", "standard", "detailed", "comprehensive"]),
  useFirstPerson: z.boolean().default(false),
  includeCitations: z.boolean().default(true),
  maxWords: z.number().int().positive().optional(),
});
export type SectionStyle = z.infer<typeof SectionStyleSchema>;

export const SectionTypeSchema = z.enum([
  "title_page", "table_of_contents", "executive_summary", "introduction",
  "methodology", "analysis", "results", "discussion", "conclusions",
  "recommendations", "appendix", "bibliography", "glossary", "custom"
]);
export type SectionType = z.infer<typeof SectionTypeSchema>;

export const SectionSpecSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  type: SectionTypeSchema,
  level: z.number().int().min(1).max(4).default(1),
  goals: z.array(z.string()),
  audience: AudienceTypeSchema,
  style: SectionStyleSchema,
  requiredFacts: z.array(z.string()).optional(),
  linkedSections: z.array(z.string().uuid()).optional(),
  order: z.number().int().nonnegative(),
});
export type SectionSpec = z.infer<typeof SectionSpecSchema>;

export const ClaimSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  sectionId: z.string().uuid(),
  requiresCitation: z.boolean(),
  citations: z.array(SourceRefSchema),
  factIds: z.array(z.string().uuid()),
  verified: z.boolean().default(false),
  verificationScore: z.number().min(0).max(1).optional(),
  verificationMethod: z.enum(["retrieval", "llm", "rule", "manual"]).optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const GAPSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["missing_evidence", "weak_citation", "unverified_claim", "incomplete_section", "data_inconsistency"]),
  missing: z.string(),
  question: z.string(),
  sectionId: z.string().uuid().optional(),
  claimId: z.string().uuid().optional(),
  priority: z.enum(["critical", "high", "medium", "low"]),
  suggestedAction: z.enum(["re_retrieve", "re_plan", "ask_user", "fallback", "skip"]),
  resolvedAt: z.string().datetime().optional(),
});
export type GAP = z.infer<typeof GAPSchema>;

export const SectionContentSchema = z.object({
  sectionId: z.string().uuid(),
  markdown: z.string(),
  claims: z.array(ClaimSchema),
  wordCount: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  iteration: z.number().int().nonnegative().default(0),
});
export type SectionContent = z.infer<typeof SectionContentSchema>;

export const QualityGateResultSchema = z.object({
  gateId: z.string(),
  gateName: z.string(),
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  issues: z.array(z.object({
    severity: z.enum(["error", "warning", "info"]),
    message: z.string(),
    location: z.string().optional(),
  })),
  checkedAt: z.string().datetime(),
});
export type QualityGateResult = z.infer<typeof QualityGateResultSchema>;

export const StageStatusSchema = z.enum(["pending", "running", "completed", "failed", "skipped", "retrying"]);
export type StageStatus = z.infer<typeof StageStatusSchema>;

export const StageResultSchema = z.object({
  stageId: z.string(),
  stageName: z.string(),
  status: StageStatusSchema,
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  output: z.any().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).optional(),
  qualityGate: QualityGateResultSchema.optional(),
  tokensUsed: z.number().int().nonnegative().optional(),
});
export type StageResult = z.infer<typeof StageResultSchema>;

export const DocumentPlanSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  subtitle: z.string().optional(),
  authors: z.array(z.string()),
  date: z.string(),
  locale: SupportedLocaleSchema,
  audience: AudienceTypeSchema,
  goal: DocumentGoalSchema,
  sections: z.array(SectionSpecSchema),
  style: z.object({
    template: z.string().optional(),
    fontFamily: z.string().default("Calibri"),
    fontSize: z.number().default(11),
    lineSpacing: z.number().default(1.15),
    margins: z.object({
      top: z.number().default(1),
      bottom: z.number().default(1),
      left: z.number().default(1),
      right: z.number().default(1),
    }).optional(),
  }),
  estimatedWordCount: z.number().int().positive().optional(),
});
export type DocumentPlan = z.infer<typeof DocumentPlanSchema>;

export const PipelineStateSchema = z.object({
  runId: z.string().uuid(),
  pipelineVersion: z.string().default(PIPELINE_VERSION),
  query: z.string(),
  locale: SupportedLocaleSchema,
  status: z.enum(["initializing", "planning", "gathering", "analyzing", "writing", "verifying", "assembling", "completed", "failed"]),
  
  plan: DocumentPlanSchema.optional(),
  sources: z.array(SourceRefSchema),
  evidence: z.array(EvidenceChunkSchema),
  facts: z.array(NormalizedFactSchema),
  sections: z.array(SectionContentSchema),
  claims: z.array(ClaimSchema),
  gaps: z.array(GAPSchema),
  
  stageResults: z.array(StageResultSchema),
  qualityGates: z.array(QualityGateResultSchema),
  
  currentStage: z.string().optional(),
  currentIteration: z.number().int().nonnegative().default(0),
  maxIterations: z.number().int().positive().default(3),
  
  totalTokensUsed: z.number().int().nonnegative().default(0),
  totalDurationMs: z.number().int().nonnegative().default(0),
  
  artifacts: z.array(z.object({
    id: z.string().uuid(),
    type: z.enum(["docx", "pdf", "html"]),
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    buffer: z.instanceof(Buffer).optional(),
  })),
  
  error: z.string().optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type PipelineState = z.infer<typeof PipelineStateSchema>;

export const PipelineEventSchema = z.object({
  runId: z.string().uuid(),
  eventType: z.enum([
    "pipeline.started", "pipeline.completed", "pipeline.failed",
    "stage.started", "stage.progress", "stage.completed", "stage.failed", "stage.retrying",
    "quality_gate.passed", "quality_gate.failed",
    "gap.detected", "gap.resolved",
    "artifact.created"
  ]),
  stageId: z.string().optional(),
  stageName: z.string().optional(),
  progress: z.number().min(0).max(1).optional(),
  message: z.string().optional(),
  data: z.any().optional(),
  timestamp: z.string().datetime(),
});
export type PipelineEvent = z.infer<typeof PipelineEventSchema>;

export const StageConfigSchema = z.object({
  timeoutMs: z.number().int().positive().default(60000),
  maxRetries: z.number().int().nonnegative().default(3),
  retryDelayMs: z.number().int().positive().default(1000),
  retryBackoffMultiplier: z.number().positive().default(2),
  circuitBreakerThreshold: z.number().int().positive().default(5),
  circuitBreakerResetMs: z.number().int().positive().default(60000),
  qualityGateThreshold: z.number().min(0).max(1).default(0.7),
  cacheTTLSeconds: z.number().int().positive().default(3600),
  enableSemanticCache: z.boolean().default(true),
});
export type StageConfig = z.infer<typeof StageConfigSchema>;

export const OrchestratorConfigSchema = z.object({
  maxIterations: z.number().int().positive().default(3),
  maxTotalTimeMs: z.number().int().positive().default(300000),
  stageConfigs: z.record(StageConfigSchema.partial()).optional(),
  enableParallelExecution: z.boolean().default(true),
  enableSemanticCache: z.boolean().default(true),
  enableCircuitBreaker: z.boolean().default(true),
  fallbackToRules: z.boolean().default(true),
  minClaimVerificationRate: z.number().min(0).max(1).default(0.5),
  sloTargets: z.object({
    p95LatencyMs: z.number().int().positive().default(30000),
    p99LatencyMs: z.number().int().positive().default(60000),
    successRate: z.number().min(0).max(1).default(0.95),
    claimCoverageRate: z.number().min(0).max(1).default(0.90),
  }).optional(),
});
export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;

export const EvalMetricsSchema = z.object({
  runId: z.string().uuid(),
  pipelineVersion: z.string(),
  accuracy: z.number().min(0).max(1),
  abstainRate: z.number().min(0).max(1),
  unsupportedClaimsRate: z.number().min(0).max(1),
  averageLatencyMs: z.number().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
  p99LatencyMs: z.number().nonnegative(),
  totalTokensUsed: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  qualityGatePassRate: z.number().min(0).max(1),
  evaluatedAt: z.string().datetime(),
  locale: SupportedLocaleSchema.optional(),
  testSetSize: z.number().int().positive(),
});
export type EvalMetrics = z.infer<typeof EvalMetricsSchema>;

export interface StageContext {
  runId: string;
  locale: SupportedLocale;
  state: PipelineState;
  config: StageConfig;
  emitEvent: (event: Omit<PipelineEvent, "runId" | "timestamp">) => void;
  abortSignal?: AbortSignal;
}

export interface Stage<TInput, TOutput> {
  id: string;
  name: string;
  execute(input: TInput, context: StageContext): Promise<TOutput>;
  validate(output: TOutput): QualityGateResult;
  fallback?(input: TInput, context: StageContext): Promise<TOutput>;
}

export function createPipelineEvent(
  runId: string,
  eventType: PipelineEvent["eventType"],
  data?: Partial<Omit<PipelineEvent, "runId" | "eventType" | "timestamp">>
): PipelineEvent {
  return PipelineEventSchema.parse({
    runId,
    eventType,
    timestamp: new Date().toISOString(),
    ...data,
  });
}
