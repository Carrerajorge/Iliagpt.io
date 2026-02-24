/**
 * Canonical Brief Schema — JSON Schema / Zod constrained output
 *
 * This defines the structured output that the Request-Understanding Agent MUST
 * produce before any downstream processing. Every field is typed, validated,
 * and documented. The schema enforces:
 *
 *   - No missing fields (all required fields have defaults or are explicitly required)
 *   - No format drift (enum constraints, regex patterns, min/max bounds)
 *   - Deterministic parsing via Zod + JSON Schema export
 *
 * Downstream consumers (RAG, Verifier, Pipeline) depend on this contract.
 */

import { z } from 'zod';

// ============================================================================
// Sub-schemas
// ============================================================================

export const SubTaskSchema = z.object({
  id: z.string().describe('Unique identifier for the sub-task'),
  description: z.string().min(5).max(500).describe('What needs to be done'),
  priority: z.enum(['critical', 'high', 'medium', 'low']).describe('Execution priority'),
  dependsOn: z.array(z.string()).default([]).describe('IDs of sub-tasks this depends on'),
  estimatedComplexity: z.enum(['trivial', 'simple', 'moderate', 'complex', 'very_complex']).default('moderate'),
  requiredCapabilities: z.array(z.string()).default([]).describe('Skills/tools needed'),
});
export type SubTask = z.infer<typeof SubTaskSchema>;

export const DeliverableSpecSchema = z.object({
  format: z.enum([
    'text', 'markdown', 'json', 'html',
    'word', 'excel', 'ppt', 'pdf',
    'code', 'image', 'table', 'chart',
    'email', 'summary', 'report', 'analysis',
    'conversational', 'structured_data', 'other'
  ]).describe('Expected output format'),
  description: z.string().min(3).max(500).describe('What exactly should be delivered'),
  constraints: z.object({
    maxLength: z.number().optional().describe('Max words/pages/slides'),
    minLength: z.number().optional().describe('Min words/pages/slides'),
    lengthUnit: z.enum(['words', 'pages', 'slides', 'paragraphs', 'items']).optional(),
    template: z.string().optional().describe('Template name if applicable'),
    language: z.string().default('es').describe('ISO 639-1 language code'),
  }).default({}),
});
export type DeliverableSpec = z.infer<typeof DeliverableSpecSchema>;

export const AudienceToneSchema = z.object({
  audience: z.enum([
    'executive', 'technical', 'academic', 'operational',
    'general', 'student', 'client', 'internal_team',
    'legal', 'medical', 'creative', 'mixed'
  ]).default('general').describe('Primary audience'),
  tone: z.enum([
    'formal', 'technical', 'conversational', 'executive',
    'academic', 'persuasive', 'instructional', 'empathetic',
    'direct', 'creative', 'neutral'
  ]).default('neutral').describe('Communication tone'),
  formality: z.number().min(1).max(10).default(5).describe('1=very casual, 10=extremely formal'),
  domainJargon: z.boolean().default(false).describe('Whether to use domain-specific terminology'),
});
export type AudienceTone = z.infer<typeof AudienceToneSchema>;

export const DataClassificationSchema = z.object({
  provided: z.array(z.object({
    sourceId: z.string().describe('File ID or "user_text" or "image_N"'),
    sourceType: z.enum(['document', 'image', 'text', 'url', 'data', 'code', 'audio']),
    description: z.string().describe('What this source contains'),
    relevance: z.enum(['primary', 'supporting', 'reference', 'context']),
    extractedEntities: z.array(z.string()).default([]).describe('Key entities extracted'),
    contentSummary: z.string().optional().describe('Brief summary of content'),
  })).default([]).describe('Data/documents explicitly provided by the user'),
  assumptions: z.array(z.object({
    assumption: z.string().describe('What we are assuming'),
    basis: z.string().describe('Why we think this is reasonable'),
    risk: z.enum(['low', 'medium', 'high']).describe('Risk if assumption is wrong'),
    canVerify: z.boolean().default(false).describe('Whether this can be verified via RAG/search'),
  })).default([]).describe('Assumptions the system is making'),
  gaps: z.array(z.string()).default([]).describe('Information that is clearly missing'),
});
export type DataClassification = z.infer<typeof DataClassificationSchema>;

export const SuccessCriterionSchema = z.object({
  criterion: z.string().describe('What success looks like'),
  measurable: z.boolean().default(false).describe('Can this be measured automatically?'),
  metric: z.string().optional().describe('How to measure if measurable'),
  weight: z.number().min(0).max(1).default(0.5).describe('Relative importance'),
});
export type SuccessCriterion = z.infer<typeof SuccessCriterionSchema>;

export const RiskAmbiguitySchema = z.object({
  type: z.enum(['ambiguity', 'risk', 'conflict', 'out_of_scope', 'hallucination_risk']),
  description: z.string().describe('What the risk/ambiguity is'),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  mitigation: z.string().optional().describe('How to mitigate'),
  affectedSubTasks: z.array(z.string()).default([]).describe('Which sub-task IDs are affected'),
});
export type RiskAmbiguity = z.infer<typeof RiskAmbiguitySchema>;

export const ClarificationQuestionSchema = z.object({
  question: z.string().min(10).max(500).describe('The clarifying question'),
  reason: z.string().describe('Why this needs to be asked'),
  blockerLevel: z.enum(['hard_blocker', 'soft_blocker', 'nice_to_have']),
  defaultIfSkipped: z.string().optional().describe('What assumption to use if user skips'),
  affectedSubTasks: z.array(z.string()).default([]),
});
export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;

// ============================================================================
// Image Analysis Sub-schema (for VLM-extracted content)
// ============================================================================

export const ImageAnalysisSchema = z.object({
  imageId: z.string().describe('Reference to the image'),
  description: z.string().describe('What the image shows'),
  extractedText: z.string().default('').describe('OCR/VLM extracted text'),
  contentType: z.enum([
    'chart', 'diagram', 'screenshot', 'photo', 'table',
    'handwriting', 'document_scan', 'infographic', 'ui_mockup',
    'map', 'logo', 'other'
  ]).describe('Type of visual content'),
  dataPoints: z.array(z.object({
    label: z.string(),
    value: z.string(),
    confidence: z.number().min(0).max(1),
  })).default([]).describe('Structured data extracted from the image'),
  relevanceToRequest: z.string().describe('How this image relates to the user request'),
});
export type ImageAnalysis = z.infer<typeof ImageAnalysisSchema>;

// ============================================================================
// Main Brief Schema
// ============================================================================

export const CanonicalBriefSchema = z.object({
  // Metadata
  briefId: z.string().describe('Unique brief identifier'),
  version: z.literal('2.0').describe('Schema version'),
  createdAt: z.string().datetime().describe('ISO 8601 timestamp'),
  processingTimeMs: z.number().describe('How long the understanding agent took'),

  // Core Understanding
  primaryIntent: z.string().min(10).max(1000).describe(
    'The user\'s main intention in one clear sentence'
  ),
  intentCategory: z.enum([
    'create_document', 'analyze_data', 'answer_question',
    'summarize', 'translate', 'compare', 'research',
    'code_generation', 'creative_writing', 'problem_solving',
    'extract_information', 'transform_data', 'explain',
    'review_critique', 'plan_strategy', 'calculate',
    'conversational', 'multi_step_workflow', 'other'
  ]).describe('High-level intent classification'),
  intentConfidence: z.number().min(0).max(1).describe('How confident we are in the intent classification'),

  // Decomposition
  subTasks: z.array(SubTaskSchema).min(1).max(10).describe(
    'Ordered list of 1-10 sub-tasks to fulfill the request'
  ),

  // Output Specification
  deliverable: DeliverableSpecSchema.describe('What exactly to deliver and in what format'),

  // Audience & Tone
  audienceTone: AudienceToneSchema,

  // Constraints
  constraints: z.object({
    mustInclude: z.array(z.string()).default([]).describe('Elements that MUST appear in output'),
    mustNotInclude: z.array(z.string()).default([]).describe('Elements that must NOT appear'),
    referenceStyle: z.enum(['APA', 'IEEE', 'MLA', 'Chicago', 'Harvard', 'none']).default('none'),
    domainConstraints: z.array(z.string()).default([]).describe('Domain-specific rules'),
    temporalConstraints: z.object({
      dateReferences: z.array(z.string()).default([]),
      cutoffDate: z.string().optional(),
      freshnessCritical: z.boolean().default(false),
    }).default({}),
  }).default({}),

  // Data Classification
  dataClassification: DataClassificationSchema,

  // Image Analyses (from VLM)
  imageAnalyses: z.array(ImageAnalysisSchema).default([]).describe(
    'Visual content extracted and analyzed from attached images'
  ),

  // Success Criteria
  successCriteria: z.array(SuccessCriterionSchema).min(1).max(10).describe(
    'How to judge if the response is successful'
  ),

  // Risks & Ambiguities
  risksAndAmbiguities: z.array(RiskAmbiguitySchema).default([]),

  // Clarification (at most ONE question if there's a hard blocker)
  clarificationQuestion: ClarificationQuestionSchema.nullable().default(null).describe(
    'A single clarifying question if there is a blocker, or null'
  ),

  // Routing Hints (for downstream pipeline)
  routingHints: z.object({
    requiresRAG: z.boolean().default(false),
    requiresWebSearch: z.boolean().default(false),
    requiresCodeExecution: z.boolean().default(false),
    requiresDocumentGeneration: z.boolean().default(false),
    requiresDataAnalysis: z.boolean().default(false),
    requiresMultiModal: z.boolean().default(false),
    suggestedPipeline: z.enum([
      'chat', 'production', 'agent', 'rag_only', 'hybrid'
    ]).default('chat'),
    estimatedComplexity: z.enum(['trivial', 'simple', 'moderate', 'complex', 'very_complex']).default('moderate'),
    estimatedTokenBudget: z.number().default(2000),
  }).default({}),

  // Raw inputs reference (for traceability)
  rawInputFingerprint: z.object({
    textLength: z.number(),
    documentCount: z.number().default(0),
    imageCount: z.number().default(0),
    languageDetected: z.string().default('es'),
    hasCode: z.boolean().default(false),
    hasUrls: z.boolean().default(false),
    hasNumbers: z.boolean().default(false),
  }),
});

export type CanonicalBrief = z.infer<typeof CanonicalBriefSchema>;

// ============================================================================
// JSON Schema export (for constrained/structured LLM outputs)
// ============================================================================

/**
 * Converts the Zod schema to a simplified JSON Schema that can be used
 * with LLM structured output APIs (e.g., OpenAI response_format, Gemini
 * responseSchema, etc.)
 */
export function getBriefJsonSchema(): object {
  return {
    type: 'object',
    required: [
      'briefId', 'version', 'createdAt', 'processingTimeMs',
      'primaryIntent', 'intentCategory', 'intentConfidence',
      'subTasks', 'deliverable', 'audienceTone', 'constraints',
      'dataClassification', 'imageAnalyses', 'successCriteria',
      'risksAndAmbiguities', 'clarificationQuestion',
      'routingHints', 'rawInputFingerprint'
    ],
    properties: {
      briefId: { type: 'string' },
      version: { type: 'string', enum: ['2.0'] },
      createdAt: { type: 'string', format: 'date-time' },
      processingTimeMs: { type: 'number' },
      primaryIntent: { type: 'string', minLength: 10, maxLength: 1000 },
      intentCategory: {
        type: 'string',
        enum: [
          'create_document', 'analyze_data', 'answer_question',
          'summarize', 'translate', 'compare', 'research',
          'code_generation', 'creative_writing', 'problem_solving',
          'extract_information', 'transform_data', 'explain',
          'review_critique', 'plan_strategy', 'calculate',
          'conversational', 'multi_step_workflow', 'other'
        ]
      },
      intentConfidence: { type: 'number', minimum: 0, maximum: 1 },
      subTasks: {
        type: 'array', minItems: 1, maxItems: 10,
        items: {
          type: 'object',
          required: ['id', 'description', 'priority'],
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            dependsOn: { type: 'array', items: { type: 'string' } },
            estimatedComplexity: { type: 'string', enum: ['trivial', 'simple', 'moderate', 'complex', 'very_complex'] },
            requiredCapabilities: { type: 'array', items: { type: 'string' } },
          }
        }
      },
      deliverable: {
        type: 'object',
        required: ['format', 'description'],
        properties: {
          format: { type: 'string' },
          description: { type: 'string' },
          constraints: { type: 'object' },
        }
      },
      audienceTone: { type: 'object' },
      constraints: { type: 'object' },
      dataClassification: { type: 'object' },
      imageAnalyses: { type: 'array', items: { type: 'object' } },
      successCriteria: { type: 'array', items: { type: 'object' } },
      risksAndAmbiguities: { type: 'array', items: { type: 'object' } },
      clarificationQuestion: {
        oneOf: [
          { type: 'null' },
          {
            type: 'object',
            required: ['question', 'reason', 'blockerLevel'],
            properties: {
              question: { type: 'string' },
              reason: { type: 'string' },
              blockerLevel: { type: 'string', enum: ['hard_blocker', 'soft_blocker', 'nice_to_have'] },
            }
          }
        ]
      },
      routingHints: { type: 'object' },
      rawInputFingerprint: { type: 'object' },
    }
  };
}

// ============================================================================
// Validation & Parsing Helpers
// ============================================================================

export function parseBrief(raw: unknown): { success: true; brief: CanonicalBrief } | { success: false; errors: string[] } {
  const result = CanonicalBriefSchema.safeParse(raw);
  if (result.success) {
    return { success: true, brief: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

export function createEmptyBrief(requestId: string): CanonicalBrief {
  return {
    briefId: requestId,
    version: '2.0',
    createdAt: new Date().toISOString(),
    processingTimeMs: 0,
    primaryIntent: 'Unable to determine intent',
    intentCategory: 'other',
    intentConfidence: 0,
    subTasks: [{ id: 'st-1', description: 'Process user request', priority: 'medium', dependsOn: [], estimatedComplexity: 'moderate', requiredCapabilities: [] }],
    deliverable: { format: 'text', description: 'Response to user', constraints: { language: 'es' } },
    audienceTone: { audience: 'general', tone: 'neutral', formality: 5, domainJargon: false },
    constraints: { mustInclude: [], mustNotInclude: [], referenceStyle: 'none', domainConstraints: [], temporalConstraints: { dateReferences: [], freshnessCritical: false } },
    dataClassification: { provided: [], assumptions: [], gaps: [] },
    imageAnalyses: [],
    successCriteria: [{ criterion: 'Response addresses the user query', measurable: false, weight: 1.0 }],
    risksAndAmbiguities: [],
    clarificationQuestion: null,
    routingHints: { requiresRAG: false, requiresWebSearch: false, requiresCodeExecution: false, requiresDocumentGeneration: false, requiresDataAnalysis: false, requiresMultiModal: false, suggestedPipeline: 'chat', estimatedComplexity: 'moderate', estimatedTokenBudget: 2000 },
    rawInputFingerprint: { textLength: 0, documentCount: 0, imageCount: 0, languageDetected: 'es', hasCode: false, hasUrls: false, hasNumbers: false },
  };
}
