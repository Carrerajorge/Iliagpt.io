/**
 * Task Router
 * 
 * Determines if a user message should be handled as:
 * - CHAT: Normal conversational response
 * - PRODUCTION: Multi-artifact document generation
 * 
 * This is the entry point for the agentic production system.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { DocumentIntentSchema, type DocumentIntent, type Deliverable } from './types';

const xaiClient = new OpenAI({
    baseURL: 'https://api.x.ai/v1',
    apiKey: process.env.XAI_API_KEY || "missing",
});

// ============================================================================
// Detection Patterns
// ============================================================================

// Strong production signals (Spanish + English)
const PRODUCTION_VERBS = [
    // Spanish
    'elabora', 'redacta', 'genera', 'crea', 'produce', 'escribe', 'desarrolla',
    'prepara', 'construye', 'diseña', 'haz', 'hazme', 'necesito',
    // English
    'create', 'generate', 'write', 'draft', 'produce', 'prepare', 'develop',
    'build', 'make', 'design', 'compose', 'compile'
];

const DOCUMENT_TYPES = [
    // Spanish
    'informe', 'reporte', 'monografía', 'tesis', 'propuesta', 'plan',
    'análisis', 'documento', 'presentación', 'excel', 'word', 'ppt',
    'resumen ejecutivo', 'auditoría', 'estudio', 'investigación',
    // English
    'report', 'thesis', 'proposal', 'analysis', 'presentation', 'document',
    'executive summary', 'audit', 'study', 'research paper', 'spreadsheet'
];

const FORMAT_SIGNALS = [
    'en word', 'en excel', 'en ppt', 'en pdf', 'powerpoint',
    'con estructura', 'formal', 'profesional', 'académico',
    'in word', 'in excel', 'in ppt', 'as pdf', 'structured', 'formal'
];

const LENGTH_SIGNALS = [
    'páginas', 'slides', 'diapositivas', 'hojas', 'secciones',
    'pages', 'slides', 'sheets', 'sections', 'chapters'
];

// ============================================================================
// Router Result
// ============================================================================

export const RouterResultSchema = z.object({
    mode: z.enum(['CHAT', 'PRODUCTION']),
    confidence: z.number().min(0).max(1),
    intent: DocumentIntentSchema.optional(),
    deliverables: z.array(z.enum(['word', 'excel', 'ppt', 'pdf'])).optional(),
    topic: z.string().optional(),
    reasoning: z.string(),
});
export type RouterResult = z.infer<typeof RouterResultSchema>;

// ============================================================================
// Fast Pattern Detection (no LLM)
// ============================================================================

function quickPatternCheck(message: string): { score: number; signals: string[] } {
    const lowerMessage = message.toLowerCase();
    const signals: string[] = [];
    let score = 0;

    // Check production verbs
    for (const verb of PRODUCTION_VERBS) {
        if (lowerMessage.includes(verb)) {
            score += 0.2;
            signals.push(`verb: ${verb}`);
            break; // Only count once
        }
    }

    // Check document types
    for (const docType of DOCUMENT_TYPES) {
        if (lowerMessage.includes(docType)) {
            score += 0.3;
            signals.push(`docType: ${docType}`);
            break;
        }
    }

    // Check format signals
    for (const format of FORMAT_SIGNALS) {
        if (lowerMessage.includes(format)) {
            score += 0.2;
            signals.push(`format: ${format}`);
            break;
        }
    }

    // Check length signals
    for (const length of LENGTH_SIGNALS) {
        if (lowerMessage.includes(length)) {
            score += 0.15;
            signals.push(`length: ${length}`);
            break;
        }
    }

    // Check for explicit multi-artifact request
    const formatCount = ['word', 'excel', 'ppt', 'pdf', 'powerpoint', 'spreadsheet']
        .filter(f => lowerMessage.includes(f)).length;
    if (formatCount >= 2) {
        score += 0.2;
        signals.push(`multiFormat: ${formatCount} formats`);
    }

    return { score: Math.min(score, 1), signals };
}

// ============================================================================
// LLM Intent Detection (when pattern check is ambiguous)
// ============================================================================

async function llmIntentDetection(message: string): Promise<RouterResult> {
    const prompt = `Analiza el siguiente mensaje del usuario y determina si requiere:
- CHAT: Una respuesta conversacional normal
- PRODUCTION: Generación de documentos formales (Word, Excel, PPT, PDF)

Mensaje: "${message}"

Responde en JSON con este formato exacto:
{
  "mode": "CHAT" | "PRODUCTION",
  "confidence": 0.0-1.0,
  "intent": "report" | "thesis" | "proposal" | "analysis" | "presentation" | "plan" | null,
  "deliverables": ["word", "excel", "ppt", "pdf"] o null,
  "topic": "tema principal" o null,
  "reasoning": "explicación breve"
}

Señales de PRODUCTION:
- Verbos: "elabora", "redacta", "genera", "crea", "prepara"
- Tipos: "informe", "tesis", "propuesta", "presentación", "análisis"
- Formatos: "en Word", "en Excel", "con estructura formal"
- Longitud: menciona páginas, slides, secciones

Si no hay señales claras de producción documental, usa CHAT.`;

    try {
        const response = await xaiClient.chat.completions.create({
            model: 'grok-4-1-fast-non-reasoning',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 500,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error('No response from LLM');
        }

        const parsed = JSON.parse(content);
        return RouterResultSchema.parse({
            mode: parsed.mode || 'CHAT',
            confidence: parsed.confidence || 0.5,
            intent: parsed.intent || undefined,
            deliverables: parsed.deliverables || undefined,
            topic: parsed.topic || undefined,
            reasoning: parsed.reasoning || 'LLM analysis',
        });
    } catch (error) {
        console.error('[TaskRouter] LLM detection failed:', error);
        return {
            mode: 'CHAT',
            confidence: 0.5,
            reasoning: 'LLM detection failed, defaulting to CHAT',
        };
    }
}

// ============================================================================
// Main Router Function
// ============================================================================

export interface TaskRouterOptions {
    skipLLM?: boolean;       // Force pattern-only detection
    forceProduction?: boolean; // Force production mode
    threshold?: number;      // Pattern match threshold (default 0.5)
}

export async function routeTask(
    message: string,
    context?: { previousMessages?: string[]; hasAttachments?: boolean },
    options: TaskRouterOptions = {}
): Promise<RouterResult> {
    const startTime = Date.now();

    // Force production if explicitly requested
    if (options.forceProduction) {
        return {
            mode: 'PRODUCTION',
            confidence: 1.0,
            topic: message,
            reasoning: 'Forced production mode',
        };
    }

    // Quick pattern check first
    const { score, signals } = quickPatternCheck(message);
    const threshold = options.threshold ?? 0.5;

    console.log(`[TaskRouter] Pattern score: ${score.toFixed(2)}, signals: ${signals.join(', ')}`);

    // High confidence from patterns alone
    if (score >= 0.7) {
        return {
            mode: 'PRODUCTION',
            confidence: score,
            topic: extractTopic(message),
            deliverables: extractDeliverables(message),
            intent: inferIntent(message),
            reasoning: `High pattern match: ${signals.join(', ')}`,
        };
    }

    // Low confidence - definitely chat
    if (score < 0.2 || options.skipLLM) {
        return {
            mode: 'CHAT',
            confidence: 1 - score,
            reasoning: score < 0.2 ? 'No production signals detected' : 'Skipped LLM, low pattern score',
        };
    }

    // Ambiguous - use LLM for final decision
    const llmResult = await llmIntentDetection(message);

    console.log(`[TaskRouter] LLM result: ${llmResult.mode} (${llmResult.confidence.toFixed(2)})`);
    console.log(`[TaskRouter] Total time: ${Date.now() - startTime}ms`);

    return llmResult;
}

// ============================================================================
// Helper Functions
// ============================================================================

function extractTopic(message: string): string {
    // Remove common action words to get topic
    let topic = message;
    const removePatterns = [
        /^(elabora|redacta|genera|crea|produce|escribe|prepara|haz|hazme)\s*(un|una|el|la|los|las)?\s*/i,
        /^(create|generate|write|draft|make|prepare)\s*(a|an|the)?\s*/i,
        /(en word|en excel|en ppt|en pdf|in word|in excel)/gi,
        /(con estructura|formal|profesional|académico)/gi,
    ];

    for (const pattern of removePatterns) {
        topic = topic.replace(pattern, '');
    }

    return topic.trim().slice(0, 200);
}

function extractDeliverables(message: string): Deliverable[] {
    const lowerMessage = message.toLowerCase();
    const deliverables: Deliverable[] = [];

    if (lowerMessage.includes('word') || lowerMessage.includes('docx') ||
        lowerMessage.includes('documento')) {
        deliverables.push('word');
    }
    if (lowerMessage.includes('excel') || lowerMessage.includes('xlsx') ||
        lowerMessage.includes('spreadsheet') || lowerMessage.includes('hoja de cálculo')) {
        deliverables.push('excel');
    }
    if (lowerMessage.includes('ppt') || lowerMessage.includes('powerpoint') ||
        lowerMessage.includes('presentación') || lowerMessage.includes('slides') ||
        lowerMessage.includes('diapositivas')) {
        deliverables.push('ppt');
    }
    if (lowerMessage.includes('pdf')) {
        deliverables.push('pdf');
    }

    // Default to word if no format specified but production mode detected
    if (deliverables.length === 0) {
        deliverables.push('word');
    }

    return deliverables;
}

function inferIntent(message: string): DocumentIntent {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('tesis') || lowerMessage.includes('monografía') ||
        lowerMessage.includes('thesis')) {
        return 'thesis';
    }
    if (lowerMessage.includes('propuesta') || lowerMessage.includes('proposal')) {
        return 'proposal';
    }
    if (lowerMessage.includes('análisis') || lowerMessage.includes('analysis')) {
        return 'analysis';
    }
    if (lowerMessage.includes('presentación') || lowerMessage.includes('presentation')) {
        return 'presentation';
    }
    if (lowerMessage.includes('plan')) {
        return 'plan';
    }
    if (lowerMessage.includes('auditoría') || lowerMessage.includes('audit')) {
        return 'audit';
    }
    if (lowerMessage.includes('comparación') || lowerMessage.includes('comparison')) {
        return 'comparison';
    }
    if (lowerMessage.includes('resumen ejecutivo') || lowerMessage.includes('executive summary')) {
        return 'executive_summary';
    }

    return 'report'; // Default
}

// ============================================================================
// Exports
// ============================================================================

export { quickPatternCheck, extractTopic, extractDeliverables, inferIntent };
