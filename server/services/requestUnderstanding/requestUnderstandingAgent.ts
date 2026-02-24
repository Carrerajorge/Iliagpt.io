/**
 * Request-Understanding Agent — Mandatory Gating Step
 *
 * This agent is the FIRST thing that runs on every user request.
 * Before ANY downstream processing (RAG, generation, agent execution),
 * this agent:
 *
 *   1. Receives: raw text + document summaries + image analyses
 *   2. Produces: a CanonicalBrief (structured JSON, validated by Zod)
 *   3. Gates: if there's a hard_blocker → returns clarification question
 *             otherwise → brief flows to the pipeline
 *
 * Uses constrained/structured output (JSON mode) to ensure the LLM
 * never deviates from the schema.
 */

import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from '@google/genai';
import { withSpan } from '../../lib/tracing';
import {
  CanonicalBriefSchema,
  type CanonicalBrief,
  type ImageAnalysis,
  parseBrief,
  createEmptyBrief,
  getBriefJsonSchema,
} from './briefSchema';
import type { VLMAnalysisResult } from './visionLanguageModel';
import type { LayoutAwareDocument } from './layoutAwareParser';

// ============================================================================
// Configuration
// ============================================================================

const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.VITEST_WORKER_ID;
const genAI = !isTestEnv && process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const UNDERSTANDING_MODEL = process.env.UNDERSTANDING_MODEL || 'gemini-2.5-flash';
const MAX_TEXT_INPUT = 30000; // chars
const MAX_RETRIES = 2;

// ============================================================================
// Types
// ============================================================================

export interface UnderstandingInput {
  /** Raw user message text */
  userText: string;
  /** Conversation history (last N messages for context) */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Parsed documents (from layout-aware parser) */
  documents?: LayoutAwareDocument[];
  /** Image analyses (from VLM) */
  imageAnalyses?: VLMAnalysisResult[];
  /** User ID for personalization context */
  userId?: string;
  /** Chat ID for conversation context */
  chatId?: string;
}

export interface UnderstandingResult {
  brief: CanonicalBrief;
  /** Whether the request is blocked pending clarification */
  needsClarification: boolean;
  /** Processing metadata */
  meta: {
    model: string;
    inputTokensEstimate: number;
    outputTokensEstimate: number;
    retries: number;
    latencyMs: number;
    parseErrors: string[];
  };
}

// ============================================================================
// Prompt Construction
// ============================================================================

function buildSystemPrompt(): string {
  return `Eres un agente de comprensión de solicitudes. Tu ÚNICO trabajo es analizar la solicitud del usuario y producir un "brief canónico" en JSON estructurado.

REGLAS ABSOLUTAS:
1. Tu salida DEBE ser un objeto JSON válido que cumpla exactamente con el esquema proporcionado.
2. NO generes contenido, respuestas ni consejos. Solo analiza y clasifica.
3. NUNCA inventes información que no esté en los datos proporcionados. Si algo no está claro, clasifícalo como "assumption" o "gap".
4. Si hay un bloqueador real (ambigüedad crítica que impide ejecutar la tarea), genera UNA sola pregunta de aclaración.
5. Si NO hay bloqueador, clarificationQuestion DEBE ser null.
6. Las sub-tareas deben ser entre 1 y 10, ordenadas por dependencia lógica.
7. El brief debe capturar TODA la información relevante de los documentos e imágenes adjuntos.
8. Detecta el idioma del usuario y usa ese idioma para descriptions y criterios.

PARA DOCUMENTOS ADJUNTOS:
- Clasifica cada documento como provided data (primary/supporting/reference/context)
- Extrae entidades clave (nombres, fechas, cifras, conceptos)
- Identifica si el documento contiene tablas, datos numéricos, o texto narrativo

PARA IMÁGENES:
- Integra el análisis visual proporcionado en imageAnalyses
- Relaciona el contenido visual con la solicitud del usuario

PARA ROUTING:
- Si la solicitud requiere generar un documento → suggestedPipeline: "production"
- Si requiere buscar en documentos → requiresRAG: true
- Si requiere buscar en internet → requiresWebSearch: true
- Si es una conversación simple → suggestedPipeline: "chat"
- Si es multi-paso complejo → suggestedPipeline: "agent"`;
}

function buildUserPrompt(input: UnderstandingInput): string {
  const parts: string[] = [];

  // User text
  const truncatedText = input.userText.length > MAX_TEXT_INPUT
    ? input.userText.slice(0, MAX_TEXT_INPUT) + '\n[...TRUNCADO...]'
    : input.userText;
  parts.push(`## Solicitud del usuario:\n${truncatedText}`);

  // Conversation history
  if (input.conversationHistory && input.conversationHistory.length > 0) {
    const recent = input.conversationHistory.slice(-5);
    const historyStr = recent.map(m =>
      `[${m.role}]: ${m.content.slice(0, 500)}${m.content.length > 500 ? '...' : ''}`
    ).join('\n');
    parts.push(`## Historial reciente:\n${historyStr}`);
  }

  // Documents
  if (input.documents && input.documents.length > 0) {
    const docSummaries = input.documents.map((doc, i) => {
      const sections = doc.sections.slice(0, 5).map(s =>
        `  - [${s.type}] ${s.title || '(sin título)'}: ${s.content.slice(0, 200)}...`
      ).join('\n');
      const tables = doc.tables.length > 0
        ? `\n  Tablas: ${doc.tables.length} (headers: ${doc.tables.map(t => t.headers.join(', ')).join(' | ')})`
        : '';
      return `### Documento ${i + 1}: ${doc.metadata.fileName} (${doc.metadata.fileType}, ${doc.metadata.totalPages || '?'} páginas)\n${sections}${tables}`;
    }).join('\n\n');
    parts.push(`## Documentos adjuntos:\n${docSummaries}`);
  }

  // Images
  if (input.imageAnalyses && input.imageAnalyses.length > 0) {
    const imgSummaries = input.imageAnalyses.map((img, i) =>
      `### Imagen ${i + 1}: ${img.contentType}\n  Descripción: ${img.description}\n  Texto extraído: ${img.extractedText.slice(0, 300) || '(ninguno)'}\n  Datos: ${img.dataPoints.map(d => `${d.label}=${d.value}`).join(', ') || '(ninguno)'}`
    ).join('\n\n');
    parts.push(`## Análisis de imágenes:\n${imgSummaries}`);
  }

  // Fingerprint data
  const hasCode = /```|function\s|const\s|import\s|class\s/i.test(input.userText);
  const hasUrls = /https?:\/\/[^\s]+/.test(input.userText);
  const hasNumbers = /\d{3,}/.test(input.userText);
  const langHint = detectLanguageHint(input.userText);

  parts.push(`## Metadatos del input:
- Longitud texto: ${input.userText.length} chars
- Documentos: ${input.documents?.length || 0}
- Imágenes: ${input.imageAnalyses?.length || 0}
- Idioma detectado: ${langHint}
- Contiene código: ${hasCode}
- Contiene URLs: ${hasUrls}
- Contiene números significativos: ${hasNumbers}`);

  parts.push(`## Instrucción:
Analiza todo lo anterior y genera el brief canónico en JSON. Recuerda:
- briefId: "${uuidv4()}"
- version: "2.0"
- createdAt: "${new Date().toISOString()}"
- Si no hay bloqueador, clarificationQuestion: null
- subTasks: entre 1 y 10
- successCriteria: al menos 1`);

  return parts.join('\n\n');
}

function detectLanguageHint(text: string): string {
  const spanishIndicators = /\b(el|la|los|las|un|una|de|del|en|con|por|para|que|es|son|está|están|pero|como|más|también|todo|ya|hay|puede|tiene|hacer|ser|este|esta|estos|estas|ese|esa|muy|bien|sin|sobre|entre|cuando|donde|hasta|desde|cada|otro|otra|nos|les|hola|quiero|necesito|puedes|dame|hazme)\b/gi;
  const englishIndicators = /\b(the|is|are|was|were|been|being|have|has|had|do|does|did|will|would|could|should|may|might|shall|can|this|that|these|those|with|from|into|about|between|through|after|before|please|want|need|give|make)\b/gi;

  const spanishMatches = (text.match(spanishIndicators) || []).length;
  const englishMatches = (text.match(englishIndicators) || []).length;

  if (spanishMatches > englishMatches * 1.5) return 'es';
  if (englishMatches > spanishMatches * 1.5) return 'en';
  return spanishMatches >= englishMatches ? 'es' : 'en';
}

// ============================================================================
// Core Agent Logic
// ============================================================================

async function callLLMForBrief(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ raw: string; parsed: unknown }> {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not configured — cannot run Request-Understanding Agent');
  }

  const result = await (genAI as any).models.generateContent({
    model: UNDERSTANDING_MODEL,
    contents: [
      { role: 'user', parts: [{ text: `${systemPrompt}\n\n---\n\n${userPrompt}\n\nResponde SOLO con el JSON del brief canónico. Sin texto adicional.` }] },
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.9,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  });

  const rawText = result.text || '';

  // Try to parse JSON
  let parsed: unknown;
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawText];
    const jsonStr = jsonMatch[1] || rawText;
    parsed = JSON.parse(jsonStr.trim());
  } catch {
    // Try to find JSON object in the response
    const objectMatch = rawText.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      parsed = JSON.parse(objectMatch[0]);
    } else {
      throw new Error(`Failed to parse LLM response as JSON: ${rawText.slice(0, 200)}`);
    }
  }

  return { raw: rawText, parsed };
}

/**
 * Main entry point: understand a user request and produce a canonical brief.
 */
export async function understandRequest(input: UnderstandingInput): Promise<UnderstandingResult> {
  const startTime = Date.now();
  const briefId = uuidv4();
  let retries = 0;
  let parseErrors: string[] = [];

  return withSpan('request_understanding.analyze', async (span) => {
    span.setAttribute('ru.brief_id', briefId);
    span.setAttribute('ru.text_length', input.userText.length);
    span.setAttribute('ru.doc_count', input.documents?.length || 0);
    span.setAttribute('ru.image_count', input.imageAnalyses?.length || 0);

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(input);
    const inputTokensEstimate = Math.ceil((systemPrompt.length + userPrompt.length) / 4);

    // Retry loop with schema validation
    while (retries <= MAX_RETRIES) {
      try {
        const { parsed } = await callLLMForBrief(systemPrompt, userPrompt);

        // Validate against Zod schema
        const validation = parseBrief(parsed);

        if (validation.success) {
          const brief = validation.brief;
          const latencyMs = Date.now() - startTime;

          // Override metadata fields for consistency
          brief.briefId = briefId;
          brief.processingTimeMs = latencyMs;
          brief.createdAt = new Date().toISOString();

          // Inject image analyses from VLM if they weren't in LLM output
          if (input.imageAnalyses && input.imageAnalyses.length > 0 && brief.imageAnalyses.length === 0) {
            brief.imageAnalyses = input.imageAnalyses.map((img, i): ImageAnalysis => ({
              imageId: `img-${i}`,
              description: img.description,
              extractedText: img.extractedText,
              contentType: img.contentType as any,
              dataPoints: img.dataPoints,
              relevanceToRequest: img.relevanceToRequest || 'Adjunto por el usuario',
            }));
          }

          // Ensure rawInputFingerprint is accurate
          brief.rawInputFingerprint = {
            textLength: input.userText.length,
            documentCount: input.documents?.length || 0,
            imageCount: input.imageAnalyses?.length || 0,
            languageDetected: detectLanguageHint(input.userText),
            hasCode: /```|function\s|const\s|import\s|class\s/i.test(input.userText),
            hasUrls: /https?:\/\/[^\s]+/.test(input.userText),
            hasNumbers: /\d{3,}/.test(input.userText),
          };

          span.setAttribute('ru.intent_category', brief.intentCategory);
          span.setAttribute('ru.intent_confidence', brief.intentConfidence);
          span.setAttribute('ru.subtask_count', brief.subTasks.length);
          span.setAttribute('ru.needs_clarification', brief.clarificationQuestion !== null);
          span.setAttribute('ru.suggested_pipeline', brief.routingHints.suggestedPipeline);
          span.setAttribute('ru.retries', retries);
          span.setAttribute('ru.latency_ms', latencyMs);

          return {
            brief,
            needsClarification: brief.clarificationQuestion?.blockerLevel === 'hard_blocker',
            meta: {
              model: UNDERSTANDING_MODEL,
              inputTokensEstimate,
              outputTokensEstimate: Math.ceil(JSON.stringify(brief).length / 4),
              retries,
              latencyMs,
              parseErrors,
            },
          };
        } else {
          parseErrors = validation.errors;
          console.warn(`[RequestUnderstanding] Schema validation failed (attempt ${retries + 1}):`, validation.errors.slice(0, 5));
          retries++;

          if (retries <= MAX_RETRIES) {
            // Add error feedback to the prompt for self-healing
            const healingPrompt = userPrompt + `\n\n## CORRECCIÓN NECESARIA:\nTu respuesta anterior tenía errores de esquema:\n${validation.errors.join('\n')}\n\nCorrige estos errores y genera un JSON válido.`;
            const healedResult = await callLLMForBrief(systemPrompt, healingPrompt);
            const healedValidation = parseBrief(healedResult.parsed);
            if (healedValidation.success) {
              const brief = healedValidation.brief;
              brief.briefId = briefId;
              brief.processingTimeMs = Date.now() - startTime;
              brief.createdAt = new Date().toISOString();

              return {
                brief,
                needsClarification: brief.clarificationQuestion?.blockerLevel === 'hard_blocker',
                meta: {
                  model: UNDERSTANDING_MODEL,
                  inputTokensEstimate,
                  outputTokensEstimate: Math.ceil(JSON.stringify(brief).length / 4),
                  retries,
                  latencyMs: Date.now() - startTime,
                  parseErrors,
                },
              };
            }
          }
        }
      } catch (error) {
        console.error(`[RequestUnderstanding] LLM call failed (attempt ${retries + 1}):`, error);
        retries++;
        if (retries > MAX_RETRIES) {
          // Return a fallback brief constructed heuristically
          return buildFallbackBrief(input, briefId, startTime, parseErrors);
        }
      }
    }

    // If all retries exhausted, return fallback
    return buildFallbackBrief(input, briefId, startTime, parseErrors);
  });
}

// ============================================================================
// Fallback: Heuristic Brief Construction
// ============================================================================

function buildFallbackBrief(
  input: UnderstandingInput,
  briefId: string,
  startTime: number,
  parseErrors: string[],
): UnderstandingResult {
  const text = input.userText.toLowerCase();
  const latencyMs = Date.now() - startTime;

  // Heuristic intent detection
  let intentCategory: CanonicalBrief['intentCategory'] = 'conversational';
  let suggestedPipeline: 'chat' | 'production' | 'agent' | 'rag_only' | 'hybrid' = 'chat';

  const productionVerbs = /\b(genera|crea|escribe|redacta|elabora|produce|arma|hazme|preparame|generate|create|write|draft|build|make)\b/i;
  const docTypes = /\b(documento|informe|reporte|tesis|análisis|presentación|excel|word|ppt|pdf|resumen|report|thesis|analysis|presentation|summary)\b/i;
  const ragSignals = /\b(busca|encuentra|qué dice|según|de acuerdo|search|find|what does|according)\b/i;
  const codeSignals = /\b(código|función|programa|api|endpoint|component|code|function|script)\b/i;

  if (productionVerbs.test(text) && docTypes.test(text)) {
    intentCategory = 'create_document';
    suggestedPipeline = 'production';
  } else if (ragSignals.test(text)) {
    intentCategory = 'answer_question';
    suggestedPipeline = 'rag_only';
  } else if (codeSignals.test(text)) {
    intentCategory = 'code_generation';
    suggestedPipeline = 'agent';
  } else if (text.length > 500) {
    intentCategory = 'multi_step_workflow';
    suggestedPipeline = 'agent';
  }

  const brief = createEmptyBrief(briefId);
  brief.primaryIntent = input.userText.slice(0, 500);
  brief.intentCategory = intentCategory;
  brief.intentConfidence = 0.3;
  brief.processingTimeMs = latencyMs;
  brief.deliverable.format = suggestedPipeline === 'production' ? 'word' : 'text';
  brief.deliverable.description = 'Respuesta basada en análisis heurístico (fallback)';
  brief.routingHints.suggestedPipeline = suggestedPipeline;
  brief.routingHints.requiresRAG = (input.documents?.length || 0) > 0;
  brief.routingHints.requiresMultiModal = (input.imageAnalyses?.length || 0) > 0;
  brief.rawInputFingerprint = {
    textLength: input.userText.length,
    documentCount: input.documents?.length || 0,
    imageCount: input.imageAnalyses?.length || 0,
    languageDetected: detectLanguageHint(input.userText),
    hasCode: /```|function\s|const\s/i.test(input.userText),
    hasUrls: /https?:\/\//.test(input.userText),
    hasNumbers: /\d{3,}/.test(input.userText),
  };

  // Classify documents
  if (input.documents) {
    brief.dataClassification.provided = input.documents.map((doc, i) => ({
      sourceId: doc.metadata.fileId || `doc-${i}`,
      sourceType: 'document' as const,
      description: `${doc.metadata.fileName} (${doc.metadata.fileType})`,
      relevance: 'primary' as const,
      extractedEntities: [],
      contentSummary: doc.sections[0]?.content.slice(0, 200) || '',
    }));
  }

  // Add image analyses
  if (input.imageAnalyses) {
    brief.imageAnalyses = input.imageAnalyses.map((img, i) => ({
      imageId: `img-${i}`,
      description: img.description,
      extractedText: img.extractedText,
      contentType: img.contentType as any || 'other',
      dataPoints: img.dataPoints || [],
      relevanceToRequest: img.relevanceToRequest || 'Adjunto por el usuario',
    }));
  }

  return {
    brief,
    needsClarification: false,
    meta: {
      model: 'heuristic-fallback',
      inputTokensEstimate: Math.ceil(input.userText.length / 4),
      outputTokensEstimate: Math.ceil(JSON.stringify(brief).length / 4),
      retries: MAX_RETRIES + 1,
      latencyMs,
      parseErrors,
    },
  };
}

// ============================================================================
// Export
// ============================================================================

export const requestUnderstandingAgent = {
  understandRequest,
  buildSystemPrompt,
  buildUserPrompt,
  detectLanguageHint,
};
