/**
 * WorkOrder Processor
 * 
 * Normalizes user requests into structured WorkOrders.
 * Applies smart defaults based on intent and audience.
 */

import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import {
    WorkOrderSchema,
    type WorkOrder,
    type DocumentIntent,
    type Audience,
    type Deliverable,
    type Tone,
    type CitationStyle,
    type SourcePolicy,
    type RouterResult
} from './types';

const xaiClient = new OpenAI({
    baseURL: 'https://api.x.ai/v1',
    apiKey: process.env.XAI_API_KEY || "missing",
});

// ============================================================================
// Default Configurations by Intent
// ============================================================================

interface IntentDefaults {
    audience: Audience;
    deliverables: Deliverable[];
    tone: Tone;
    citationStyle: CitationStyle;
    sourcePolicy: SourcePolicy;
    maxPages?: number;
    maxSlides?: number;
}

const INTENT_DEFAULTS: Record<DocumentIntent, IntentDefaults> = {
    report: {
        audience: 'general',
        deliverables: ['word', 'pdf'],
        tone: 'formal',
        citationStyle: 'none',
        sourcePolicy: 'both',
        maxPages: 20,
    },
    thesis: {
        audience: 'academic',
        deliverables: ['word', 'pdf'],
        tone: 'formal',
        citationStyle: 'APA',
        sourcePolicy: 'both',
        maxPages: 50,
    },
    proposal: {
        audience: 'executive',
        deliverables: ['word', 'ppt', 'pdf'],
        tone: 'executive',
        citationStyle: 'none',
        sourcePolicy: 'internal',
        maxPages: 15,
        maxSlides: 20,
    },
    analysis: {
        audience: 'technical',
        deliverables: ['word', 'excel'],
        tone: 'technical',
        citationStyle: 'none',
        sourcePolicy: 'both',
        maxPages: 30,
    },
    presentation: {
        audience: 'executive',
        deliverables: ['ppt', 'pdf'],
        tone: 'executive',
        citationStyle: 'none',
        sourcePolicy: 'none',
        maxSlides: 15,
    },
    plan: {
        audience: 'operational',
        deliverables: ['word', 'excel'],
        tone: 'conversational',
        citationStyle: 'none',
        sourcePolicy: 'none',
        maxPages: 10,
    },
    audit: {
        audience: 'technical',
        deliverables: ['word', 'excel', 'pdf'],
        tone: 'formal',
        citationStyle: 'none',
        sourcePolicy: 'internal',
        maxPages: 40,
    },
    comparison: {
        audience: 'technical',
        deliverables: ['word', 'excel'],
        tone: 'technical',
        citationStyle: 'none',
        sourcePolicy: 'both',
        maxPages: 25,
    },
    executive_summary: {
        audience: 'executive',
        deliverables: ['word', 'pdf'],
        tone: 'executive',
        citationStyle: 'none',
        sourcePolicy: 'none',
        maxPages: 5,
    },
};

// ============================================================================
// WorkOrder Creation
// ============================================================================

export interface CreateWorkOrderInput {
    routerResult: RouterResult;
    message: string;
    userId: string;
    chatId?: string;
    overrides?: Partial<WorkOrder>;
}

export async function createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder> {
    const { routerResult, message, userId, chatId, overrides } = input;

    const intent = routerResult.intent || 'report';
    const defaults = INTENT_DEFAULTS[intent];

    // Merge router-detected deliverables with defaults
    const deliverables = routerResult.deliverables?.length
        ? routerResult.deliverables
        : defaults.deliverables;

    // Create base work order
    const workOrder: WorkOrder = {
        id: uuidv4(),
        createdAt: new Date(),
        userId,
        chatId,

        intent,
        topic: routerResult.topic || extractTopicFromMessage(message),
        description: message,

        audience: overrides?.audience || defaults.audience,
        deliverables: deliverables as Deliverable[],
        tone: overrides?.tone || defaults.tone,
        citationStyle: overrides?.citationStyle || defaults.citationStyle,

        sourcePolicy: overrides?.sourcePolicy || defaults.sourcePolicy,
        uploadedDocuments: [],

        constraints: {
            maxPages: overrides?.constraints?.maxPages || defaults.maxPages,
            maxSlides: overrides?.constraints?.maxSlides || defaults.maxSlides,
            language: detectLanguage(message),
            corporateStyle: false,
            ...overrides?.constraints,
        },

        budget: {
            maxLLMCalls: 50,
            maxSearchQueries: 20,
            maxRetries: 3,
            timeoutMinutes: 10,
            ...overrides?.budget,
        },

        status: 'pending',
        currentStage: 0,
        totalStages: calculateTotalStages(deliverables as Deliverable[]),
    };

    // Validate
    return WorkOrderSchema.parse(workOrder);
}

// ============================================================================
// Enhanced Extraction with LLM
// ============================================================================

export async function enrichWorkOrder(workOrder: WorkOrder): Promise<WorkOrder> {
    const prompt = `Analiza esta solicitud de documento y extrae información adicional.

Solicitud: "${workOrder.description}"
Tema detectado: "${workOrder.topic}"
Tipo: ${workOrder.intent}

Responde en JSON con:
{
  "refinedTopic": "tema más específico si es posible",
  "suggestedSections": ["sección1", "sección2", ...],
  "keyQuestions": ["pregunta1", "pregunta2", ...],
  "dataNeeds": ["datos necesarios para Excel si aplica"],
  "researchKeywords": ["keywords para investigación"],
  "estimatedComplexity": "low" | "medium" | "high",
  "suggestedLength": {
    "pages": número,
    "slides": número o null
  }
}`;

    try {
        const response = await xaiClient.chat.completions.create({
            model: 'grok-4-1-fast-non-reasoning',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.3,
            max_tokens: 800,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) return workOrder;

        const enrichment = JSON.parse(content);

        // Update work order with enriched data
        return {
            ...workOrder,
            topic: enrichment.refinedTopic || workOrder.topic,
            constraints: {
                ...workOrder.constraints,
                maxPages: enrichment.suggestedLength?.pages || workOrder.constraints.maxPages,
                maxSlides: enrichment.suggestedLength?.slides || workOrder.constraints.maxSlides,
            },
            // Store enrichment data for later stages
            metadata: {
                suggestedSections: enrichment.suggestedSections,
                keyQuestions: enrichment.keyQuestions,
                dataNeeds: enrichment.dataNeeds,
                researchKeywords: enrichment.researchKeywords,
                complexity: enrichment.estimatedComplexity,
            },
        } as WorkOrder & { metadata: Record<string, unknown> };

    } catch (error) {
        console.error('[WorkOrderProcessor] Enrichment failed:', error);
        return workOrder;
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

function extractTopicFromMessage(message: string): string {
    // Remove common prefixes
    let topic = message
        .replace(/^(por favor|please|necesito|i need|quiero|i want)\s*/i, '')
        .replace(/^(elabora|redacta|genera|crea|produce|escribe|prepara|haz|hazme)\s*/i, '')
        .replace(/^(create|generate|write|draft|make|prepare)\s*/i, '')
        .replace(/^(un|una|el|la|los|las|a|an|the)\s*/i, '')
        .replace(/(en word|en excel|en ppt|en pdf|in word|in excel)/gi, '')
        .trim();

    // Limit length
    if (topic.length > 200) {
        topic = topic.substring(0, 200) + '...';
    }

    return topic;
}

function detectLanguage(text: string): string {
    // Simple heuristic - could use a proper library
    const spanishWords = ['el', 'la', 'de', 'que', 'un', 'una', 'es', 'en', 'por', 'con'];
    const englishWords = ['the', 'a', 'an', 'is', 'are', 'of', 'in', 'to', 'for', 'with'];

    const lowerText = text.toLowerCase();
    const words = lowerText.split(/\s+/);

    let spanishScore = 0;
    let englishScore = 0;

    for (const word of words) {
        if (spanishWords.includes(word)) spanishScore++;
        if (englishWords.includes(word)) englishScore++;
    }

    return spanishScore > englishScore ? 'es' : 'en';
}

function calculateTotalStages(deliverables: Deliverable[]): number {
    // Base stages: intake, blueprint, research, analysis, writing, qa, consistency, render
    let stages = 8;

    // Add stages for specific deliverables
    if (deliverables.includes('excel')) stages++; // data stage
    if (deliverables.includes('ppt')) stages++;   // slides stage

    return stages;
}

// ============================================================================
// Validation
// ============================================================================

export function validateWorkOrder(workOrder: WorkOrder): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!workOrder.topic || workOrder.topic.length < 3) {
        errors.push('Topic is too short or missing');
    }

    if (workOrder.deliverables.length === 0) {
        errors.push('At least one deliverable is required');
    }

    if (workOrder.constraints.maxPages && workOrder.constraints.maxPages > 500) {
        errors.push('Maximum pages exceeded (limit: 500)');
    }

    if (workOrder.budget.timeoutMinutes > 30) {
        errors.push('Timeout too long (max: 30 minutes)');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

// ============================================================================
// Exports
// ============================================================================

export { INTENT_DEFAULTS, extractTopicFromMessage, detectLanguage, calculateTotalStages };
