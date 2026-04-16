import { z } from "zod";
import { IntentTypeSchema, DeliverableTypeSchema } from "../requestSpec";

// ─── LLM Intent Classification Schema ────────────────────────────────
// This is the structured output the LLM planner returns via function calling.

export const LlmIntentClassificationSchema = z.object({
  intent: IntentTypeSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(300),
  deliverableType: DeliverableTypeSchema,
  complexityLevel: z.enum(["simple", "moderate", "complex"]),
  requiresWebSearch: z.boolean(),
  requiresDocumentGeneration: z.boolean(),
  requiresBrowserAutomation: z.boolean(),
  ambiguities: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
  extractedEntities: z.record(z.any()).default({}),
});
export type LlmIntentClassification = z.infer<typeof LlmIntentClassificationSchema>;

// ─── Intent Analysis Result ──────────────────────────────────────────
// The full result returned by analyzeIntent(), combining regex + LLM signals.

export const IntentAnalysisResultSchema = z.object({
  intent: IntentTypeSchema,
  confidence: z.number().min(0).max(1),
  source: z.enum(["regex", "llm", "hybrid"]),
  brief: z.any().nullable(), // RequestBrief | null — typed loosely to avoid circular deps
  escalationReason: z.string().optional(),
  llmClassification: LlmIntentClassificationSchema.nullable().default(null),
  latencyMs: z.number().nonnegative(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
  extractedEntities: z.record(z.any()).default({}),
});
export type IntentAnalysisResult = z.infer<typeof IntentAnalysisResultSchema>;

// ─── Enhanced Brief Extensions ───────────────────────────────────────
// Extra fields added to the existing RequestBriefSchema for the analysis layer.

export const BriefScopeSchema = z.object({
  included: z.array(z.string()).default([]),
  excluded: z.array(z.string()).default([]),
});

export const RequiredInputSchema = z.object({
  name: z.string(),
  status: z.enum(["provided", "missing", "inferred"]),
  value: z.any().optional(),
});

export const ExpectedOutputSchema = z.object({
  format: z.string(),
  estimatedSize: z.string().optional(),
  language: z.string().default("es"),
});
