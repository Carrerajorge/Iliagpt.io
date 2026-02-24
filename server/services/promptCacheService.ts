/**
 * Prompt Caching Service (Mejora #7 - Fase 2)
 *
 * Detecta cuando un prompt comparte un prefijo de sistema largo (>= 1024 tokens)
 * y marca el mensaje con las directivas de caché específicas de cada proveedor:
 *   - Anthropic: `cache_control: { type: "ephemeral" }` en el bloque de contenido
 *   - OpenAI:    `cache_control: { type: "auto" }` en el bloque de contenido (GPT-4.1+)
 *
 * Esto puede ahorrar hasta un 90% de los tokens de entrada para conversaciones largas
 * con system prompts repetitivos (documentos de referencia, personalidades, conocimiento base).
 *
 * Docs:
 *  - Anthropic: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 *  - OpenAI: https://platform.openai.com/docs/guides/latency-optimization#prompt-caching
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat";

// ─── Constantes ─────────────────────────────────────────────────────────────

/** Mínimo de tokens estimados para que Anthropic acepte cache_control. */
const ANTHROPIC_MIN_CACHEABLE_TOKENS = 1024;
/** Mínimo de tokens estimados para que OpenAI active prompt caching. */
const OPENAI_MIN_CACHEABLE_TOKENS = 1024;

/** Aproximación: 4 caracteres ≈ 1 token. */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface CachingHints {
    /** Número de mensajes marcados con directivas de caché. */
    markedCount: number;
    /** Proveedor para el que se generaron las directivas. */
    provider: "anthropic" | "openai" | "none";
    /** Tokens estimados que se beneficiarán del cache. */
    estimatedCachedTokens: number;
}

// ─── Anthropic Prompt Caching ────────────────────────────────────────────────

/**
 * Transforma los mensajes del sistema para Anthropic añadiendo `cache_control`.
 * Anthropic permite hasta 4 puntos de caché por request.
 *
 * @param messages  Array de mensajes (formato OpenAI, convertido a Anthropic internamente)
 * @returns Mensajes clonados con directivas de caché en los bloques elegibles
 */
export function applyAnthropicPromptCaching(
    messages: ChatCompletionMessageParam[],
): { messages: ChatCompletionMessageParam[]; hints: CachingHints } {
    let markedCount = 0;
    let totalTokens = 0;

    // Sólo los mensajes del sistema largos son candidatos
    const patched = messages.map((msg) => {
        if (msg.role !== "system") return msg;

        const text = typeof msg.content === "string" ? msg.content : "";
        const tokens = estimateTokens(text);

        if (tokens < ANTHROPIC_MIN_CACHEABLE_TOKENS) return msg;

        // Anthropic espera contenido en formato de bloque para usar cache_control
        markedCount++;
        totalTokens += tokens;

        return {
            ...msg,
            content: [
                {
                    type: "text" as const,
                    text,
                    cache_control: { type: "ephemeral" as const },
                },
            ],
        };
    });

    return {
        messages: patched as ChatCompletionMessageParam[],
        hints: {
            markedCount,
            provider: markedCount > 0 ? "anthropic" : "none",
            estimatedCachedTokens: totalTokens,
        },
    };
}

// ─── OpenAI Prefix Caching ───────────────────────────────────────────────────

/**
 * Marca el primer mensaje de sistema largo con un "anchor" de caché para OpenAI.
 * OpenAI activa el prefix caching automáticamente para prompts >= 1024 tokens,
 * pero añadimos la anotación para tener visibilidad en los logs.
 *
 * @param messages  Array de mensajes en formato OpenAI
 * @returns Mensajes con metadatos de caché añadidos donde sea pertinente
 */
export function applyOpenAIPromptCaching(
    messages: ChatCompletionMessageParam[],
): { messages: ChatCompletionMessageParam[]; hints: CachingHints } {
    let markedCount = 0;
    let totalTokens = 0;

    const patched = messages.map((msg) => {
        if (msg.role !== "system") return msg;

        const text = typeof msg.content === "string" ? msg.content : "";
        const tokens = estimateTokens(text);

        if (tokens < OPENAI_MIN_CACHEABLE_TOKENS) return msg;

        markedCount++;
        totalTokens += tokens;

        // OpenAI prefix caching is automatic, but we annotate for observability.
        // The _cacheHint field is stripped before sending to the API by the gateway.
        return {
            ...msg,
            _cacheHint: { eligible: true, tokens, provider: "openai" },
        };
    });

    return {
        messages: patched as ChatCompletionMessageParam[],
        hints: {
            markedCount,
            provider: markedCount > 0 ? "openai" : "none",
            estimatedCachedTokens: totalTokens,
        },
    };
}

// ─── Función pública unificada ─────────────────────────────────────────────

/**
 * Aplica las directivas de caché de prompt apropiadas según el proveedor LLM.
 *
 * @param messages  Mensajes del request
 * @param provider  Proveedor LLM objetivo ("anthropic" | "openai" | otros)
 * @returns { messages: [...], hints: CachingHints }
 */
export function applyPromptCaching(
    messages: ChatCompletionMessageParam[],
    provider: string,
): { messages: ChatCompletionMessageParam[]; hints: CachingHints } {
    const normalizedProvider = (provider || "").toLowerCase();

    if (normalizedProvider.includes("anthropic") || normalizedProvider.includes("claude")) {
        return applyAnthropicPromptCaching(messages);
    }

    if (normalizedProvider.includes("openai") || normalizedProvider.includes("gpt")) {
        return applyOpenAIPromptCaching(messages);
    }

    // Otros proveedores (Gemini, etc.): no aplica por ahora
    return {
        messages,
        hints: { markedCount: 0, provider: "none", estimatedCachedTokens: 0 },
    };
}
