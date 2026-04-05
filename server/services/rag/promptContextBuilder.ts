/**
 * Prompt Context Builder
 *
 * Assembles the final prompt under a strict token budget:
 *   system + task + last messages + relevant memories + topK chunks
 *
 * Includes inline citations and anti-hallucination rules.
 */

import type { ScoredChunk } from "./hybridRetriever";
import type { ShortTermMemory, LongTermMemory } from "./memoryService";
import type { EpisodicSummary, UserMemory } from "@shared/schema/rag";
import { sanitizeRAGContent } from "../../rag/UnifiedRAGPipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptSection {
    label: string;
    content: string;
    tokenEstimate: number;
    priority: number; // lower = higher priority (allocated first)
}

export interface Citation {
    id: string;
    text: string;
    source: string;
    pageNumber?: number;
    sectionTitle?: string | null;
    score: number;
}

export interface BuiltPrompt {
    systemPrompt: string;
    userPrompt: string;
    citations: Citation[];
    tokenUsage: {
        system: number;
        task: number;
        shortTerm: number;
        longTerm: number;
        episodic: number;
        ragChunks: number;
        total: number;
        budget: number;
    };
    sectionsIncluded: string[];
}

export interface PromptBuildOptions {
    tokenBudget?: number;
    language?: "es" | "en";
    taskDescription?: string;
    systemInstructions?: string;
    includeAntiHallucination?: boolean;
    citationStyle?: "numbered" | "bracketed";
    maxShortTermTokens?: number;
    maxLongTermTokens?: number;
    maxEpisodicTokens?: number;
    maxRagTokens?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "...";
}

// ---------------------------------------------------------------------------
// System prompt templates
// ---------------------------------------------------------------------------

const ANTI_HALLUCINATION_ES = `
REGLAS ESTRICTAS:
1. Responde ÚNICAMENTE con información que esté en el contexto proporcionado.
2. Si la información no está disponible, di: "No tengo información sobre eso en el contexto disponible."
3. NUNCA inventes datos, estadísticas, fechas o hechos.
4. Cita tus fuentes usando [Fuente N] para cada afirmación relevante.
5. Si no estás seguro, indica tu nivel de incertidumbre.
6. Distingue claramente entre hechos del contexto y razonamiento propio.`;

const ANTI_HALLUCINATION_EN = `
STRICT RULES:
1. Answer ONLY with information from the provided context.
2. If information is not available, say: "I don't have information about that in the available context."
3. NEVER fabricate data, statistics, dates, or facts.
4. Cite your sources using [Source N] for each relevant claim.
5. If uncertain, indicate your level of uncertainty.
6. Clearly distinguish between context facts and your own reasoning.`;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildPromptContext(
    query: string,
    chunks: ScoredChunk[],
    shortTerm: ShortTermMemory,
    longTerm: LongTermMemory,
    episodic: EpisodicSummary[],
    options: PromptBuildOptions = {},
): BuiltPrompt {
    const {
        tokenBudget = 8000,
        language = "es",
        taskDescription,
        systemInstructions,
        includeAntiHallucination = true,
        citationStyle = "numbered",
        maxShortTermTokens = 2000,
        maxLongTermTokens = 1000,
        maxEpisodicTokens = 800,
        maxRagTokens = 3000,
    } = options;

    const citations: Citation[] = [];
    const sectionsIncluded: string[] = [];

    // --- 1. System prompt (highest priority) ---
    let systemParts: string[] = [];

    if (systemInstructions) {
        systemParts.push(systemInstructions);
    } else {
        systemParts.push(
            language === "es"
                ? "Eres un asistente inteligente con memoria persistente. Usas el contexto proporcionado para dar respuestas precisas y relevantes."
                : "You are an intelligent assistant with persistent memory. You use the provided context to give precise and relevant answers.",
        );
    }

    if (includeAntiHallucination) {
        systemParts.push(language === "es" ? ANTI_HALLUCINATION_ES : ANTI_HALLUCINATION_EN);
    }

    const systemPrompt = systemParts.join("\n\n");
    const systemTokens = estimateTokens(systemPrompt);

    // --- Budget allocation ---
    let remaining = tokenBudget - systemTokens;
    const taskTokens = taskDescription ? Math.min(estimateTokens(taskDescription), Math.floor(remaining * 0.1)) : 0;
    remaining -= taskTokens;

    // Allocate proportionally to remaining budget
    const shortTermBudget = Math.min(maxShortTermTokens, Math.floor(remaining * 0.30));
    const ragBudget = Math.min(maxRagTokens, Math.floor(remaining * 0.35));
    const longTermBudget = Math.min(maxLongTermTokens, Math.floor(remaining * 0.20));
    const episodicBudget = Math.min(maxEpisodicTokens, Math.floor(remaining * 0.15));

    // --- 2. Build user prompt sections ---
    const userParts: string[] = [];

    // Task description
    if (taskDescription) {
        userParts.push(`## ${language === "es" ? "Tarea" : "Task"}\n${truncateToTokens(taskDescription, taskTokens)}`);
        sectionsIncluded.push("task");
    }

    // Short-term memory (recent messages)
    let shortTermTokensUsed = 0;
    if (shortTerm.messages.length > 0) {
        const recentLines: string[] = [];
        for (const msg of shortTerm.messages) {
            const line = `${msg.role === "user" ? "Usuario" : "Asistente"}: ${msg.content}`;
            const lineTokens = estimateTokens(line);
            if (shortTermTokensUsed + lineTokens > shortTermBudget) break;
            recentLines.push(line);
            shortTermTokensUsed += lineTokens;
        }
        if (recentLines.length > 0) {
            userParts.push(
                `## ${language === "es" ? "Conversación reciente" : "Recent conversation"}\n${recentLines.join("\n")}`,
            );
            sectionsIncluded.push("short_term");
        }
    }

    // Long-term memories
    let longTermTokensUsed = 0;
    if (longTerm.memories.length > 0) {
        const memLines: string[] = [];
        for (const mem of longTerm.memories) {
            const line = `- [${mem.category}] ${mem.fact} (confianza: ${Math.round((mem.confidence ?? 0.5) * 100)}%)`;
            const lineTokens = estimateTokens(line);
            if (longTermTokensUsed + lineTokens > longTermBudget) break;
            memLines.push(line);
            longTermTokensUsed += lineTokens;
        }
        if (memLines.length > 0) {
            userParts.push(
                `## ${language === "es" ? "Memoria del usuario" : "User memory"}\n${memLines.join("\n")}`,
            );
            sectionsIncluded.push("long_term");
        }
    }

    // Episodic summaries
    let episodicTokensUsed = 0;
    if (episodic.length > 0) {
        const epLines: string[] = [];
        for (const ep of episodic) {
            const line = `- ${language === "es" ? "Conversación previa" : "Previous conversation"}: ${ep.summary}`;
            const lineTokens = estimateTokens(line);
            if (episodicTokensUsed + lineTokens > episodicBudget) break;
            epLines.push(line);
            episodicTokensUsed += lineTokens;
        }
        if (epLines.length > 0) {
            userParts.push(
                `## ${language === "es" ? "Conversaciones anteriores" : "Previous conversations"}\n${epLines.join("\n")}`,
            );
            sectionsIncluded.push("episodic");
        }
    }

    // RAG chunks with citations
    let ragTokensUsed = 0;
    if (chunks.length > 0) {
        const prefix = citationStyle === "numbered" ? "Fuente" : "Source";
        const chunkLines: string[] = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const ref = `[${prefix} ${i + 1}${chunk.pageNumber ? `, p.${chunk.pageNumber}` : ""}]`;
            const line = `${ref}\n${sanitizeRAGContent(chunk.content)}`;
            const lineTokens = estimateTokens(line);

            if (ragTokensUsed + lineTokens > ragBudget) break;

            chunkLines.push(line);
            ragTokensUsed += lineTokens;

            citations.push({
                id: chunk.id,
                text: chunk.content.slice(0, 300),
                source: chunk.source,
                pageNumber: chunk.pageNumber,
                sectionTitle: chunk.sectionTitle,
                score: chunk.score,
            });
        }

        if (chunkLines.length > 0) {
            userParts.push(
                `## ${language === "es" ? "Contexto relevante" : "Relevant context"}\n${chunkLines.join("\n\n---\n\n")}`,
            );
            sectionsIncluded.push("rag_chunks");
        }
    }

    // Query
    userParts.push(`## ${language === "es" ? "Pregunta" : "Question"}\n${query}`);

    const userPrompt = userParts.join("\n\n");
    const totalTokens = systemTokens + taskTokens + shortTermTokensUsed + longTermTokensUsed + episodicTokensUsed + ragTokensUsed + estimateTokens(query);

    return {
        systemPrompt,
        userPrompt,
        citations,
        tokenUsage: {
            system: systemTokens,
            task: taskTokens,
            shortTerm: shortTermTokensUsed,
            longTerm: longTermTokensUsed,
            episodic: episodicTokensUsed,
            ragChunks: ragTokensUsed,
            total: totalTokens,
            budget: tokenBudget,
        },
        sectionsIncluded,
    };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const promptContextBuilder = {
    buildPromptContext,
    estimateTokens,
    truncateToTokens,
};
