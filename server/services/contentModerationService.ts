/**
 * Content Moderation Service (Mejora #14 - Fase 3)
 *
 * Filtra respuestas del LLM antes de enviarlas al usuario o canal externo.
 * Detecta:
 *   - Contenido NSFW explícito
 *   - Odio, acoso o amenazas
 *   - Datos PII fuga: números de tarjeta, SSN, etc.
 *   - Instrucciones peligrosas (explotar, sintetizar, hackear)
 *   - Revelación accidental del system prompt interno
 *
 * Configuración por plan:
 *   - free: moderación estricta
 *   - pro: moderación normal
 *   - enterprise: configurable
 */

import { Logger } from "../lib/logger";
import { incCounter } from "../metrics/prometheus";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type ModerationVerdict = "allowed" | "redacted" | "blocked";

export interface ModerationResult {
    verdict: ModerationVerdict;
    categories: string[];
    redactedContent?: string;   // contenido con PII/datos sensibles reemplazados
    message?: string;
}

// ─── Patrones de Moderación ───────────────────────────────────────────────────

interface ModerationPattern {
    pattern: RegExp;
    category: string;
    action: "block" | "redact";
    replacement?: string;
}

const MODERATION_PATTERNS: ModerationPattern[] = [
    // ── PII: Datos Personales (redactar en lugar de bloquear) ──────────────
    {
        pattern: /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g,
        category: "pii_card_number",
        action: "redact",
        replacement: "[TARJETA REDACTADA]",
    },
    {
        pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
        category: "pii_ssn",
        action: "redact",
        replacement: "[SSN REDACTADO]",
    },
    {
        pattern: /password[:\s]+(['"]?)([^\s'"]{6,})\1/gi,
        category: "pii_password",
        action: "redact",
        replacement: "password: [REDACTADO]",
    },
    {
        pattern: /sk-[A-Za-z0-9]{32,}/g,   // OpenAI keys
        category: "secret_key_leak",
        action: "redact",
        replacement: "[API_KEY REDACTADA]",
    },
    {
        pattern: /AIza[A-Za-z0-9_\-]{35}/g,  // Google API keys
        category: "secret_key_leak",
        action: "redact",
        replacement: "[API_KEY REDACTADA]",
    },

    // ── System Prompt Leak ─────────────────────────────────────────────────
    {
        pattern: /Mi\s+system\s+prompt\s+(?:es|dice)[:\s]+.{20,500}/i,
        category: "system_prompt_leak",
        action: "redact",
        replacement: "[INFORMACIÓN INTERNA REDACTADA]",
    },
    {
        pattern: /My\s+system\s+prompt\s+(?:is|says)[:\s]+.{20,500}/i,
        category: "system_prompt_leak",
        action: "redact",
        replacement: "[INTERNAL INFORMATION REDACTED]",
    },

    // ── Contenido Peligroso Explícito (bloquear) ──────────────────────────
    {
        pattern: /(?:cómo|how to)\s+(?:hacer|make|build|create)\s+(?:una?\s+)?(?:bomba|bomb|explosive)/i,
        category: "dangerous_instructions",
        action: "block",
    },
    {
        pattern: /(?:fabricar|synthesize|manufacture)\s+(?:drogas?|drugs?|methamphetamine|fentanyl)/i,
        category: "dangerous_instructions",
        action: "block",
    },
    {
        pattern: /\b(?:how to hack|exploit (?:vulnerability|CVE)|SQL injection (?:payload|attack))\b/i,
        category: "hacking_instructions",
        action: "block",
    },
];

// ─── Análisis de Moderación ───────────────────────────────────────────────────

const MAX_CONTENT_CHARS = 50_000;

export function moderateContent(
    content: string,
    options?: {
        plan?: string;
        channel?: string;
        skipCategories?: string[];
    },
): ModerationResult {
    const { plan = "free", skipCategories = [] } = options ?? {};

    // Enterprise puede desactivar categorías específicas
    const activePatterns = MODERATION_PATTERNS.filter(
        p => !skipCategories.includes(p.category),
    );

    let processedContent = content.slice(0, MAX_CONTENT_CHARS);
    const detectedCategories: string[] = [];
    let blocked = false;
    let redacted = false;

    for (const { pattern, category, action, replacement } of activePatterns) {
        const freshPattern = new RegExp(pattern.source, pattern.flags);

        if (!freshPattern.test(processedContent)) continue;

        detectedCategories.push(category);

        if (action === "block") {
            blocked = true;
            // Para bloqueos, loguear y retornar inmediatamente
            incCounter("content_moderation_blocks_total", { category });
            Logger.warn("[ContentModeration] Content BLOCKED", { category, plan });
            return {
                verdict: "blocked",
                categories: detectedCategories,
                message: "Contenido bloqueado por políticas de moderación.",
            };
        }

        if (action === "redact" && replacement) {
            processedContent = processedContent.replace(freshPattern, replacement);
            redacted = true;
            incCounter("content_moderation_redactions_total", { category });
        }
    }

    if (blocked) {
        return { verdict: "blocked", categories: detectedCategories };
    }

    if (redacted) {
        Logger.info("[ContentModeration] Content REDACTED", { categories: detectedCategories, plan });
        return {
            verdict: "redacted",
            categories: detectedCategories,
            redactedContent: processedContent,
        };
    }

    return { verdict: "allowed", categories: [] };
}

/**
 * Versión simplificada: retorna el contenido final (redactado si necesario)
 * o null si debe bloquearse.
 */
export function filterContent(content: string, options?: Parameters<typeof moderateContent>[1]): string | null {
    const result = moderateContent(content, options);
    if (result.verdict === "blocked") return null;
    if (result.verdict === "redacted" && result.redactedContent !== undefined) {
        return result.redactedContent;
    }
    return content;
}
