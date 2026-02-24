/**
 * History Resolver
 * 
 * Resolves anaphoras (it, that, the file, etc.) using conversation history.
 * Expands ambiguous references to concrete entities.
 */

// Lazy import of OpenAI to avoid initialization errors in test environments
let _openai: any = null;
let _MODELS: any = null;

function getOpenAI() {
    if (!_openai) {
        try {
            const lib = require("../../lib/openai");
            _openai = lib.openai;
            _MODELS = lib.MODELS;
        } catch (e) {
            return null;
        }
    }
    return _openai;
}

function getMODELS() {
    getOpenAI();
    return _MODELS || { TEXT: "grok-3-fast" };
}

export interface ConversationTurn {
    role: "user" | "assistant";
    content: string;
    timestamp?: Date;
    metadata?: {
        mentionedFiles?: string[];
        mentionedEntities?: string[];
        actions?: string[];
    };
}

export interface ResolvedReference {
    original: string;
    resolved: string;
    confidence: number;
    source: "conversation" | "inference";
}

export interface HistoryContext {
    recentFiles: string[];
    recentTopics: string[];
    recentActions: string[];
    lastUserRequest?: string;
    lastAssistantResponse?: string;
}

const RESOLUTION_PROMPT = `Given the conversation history and the current user message, resolve any ambiguous references.

Ambiguous references include:
- Pronouns: "it", "that", "this", "they", "them"
- Vague references: "the file", "the document", "the code", "the result"
- Relative actions: "do it again", "the same thing", "like before"

Return a JSON object:
{
  "hasAmbiguousReferences": boolean,
  "resolutions": [
    {
      "original": "the ambiguous text",
      "resolved": "what it refers to based on context",
      "confidence": 0.0-1.0
    }
  ],
  "expandedMessage": "the user message with references resolved"
}

Conversation History:
`;

export class HistoryResolver {
    buildContext(history: ConversationTurn[]): HistoryContext {
        const context: HistoryContext = {
            recentFiles: [],
            recentTopics: [],
            recentActions: []
        };

        // Extract from recent turns (last 5)
        const recentTurns = history.slice(-10);

        for (const turn of recentTurns) {
            if (turn.metadata?.mentionedFiles) {
                context.recentFiles.push(...turn.metadata.mentionedFiles);
            }
            if (turn.metadata?.mentionedEntities) {
                context.recentTopics.push(...turn.metadata.mentionedEntities);
            }
            if (turn.metadata?.actions) {
                context.recentActions.push(...turn.metadata.actions);
            }

            if (turn.role === "user") {
                context.lastUserRequest = turn.content;
            } else {
                context.lastAssistantResponse = turn.content;
            }
        }

        // Deduplicate
        context.recentFiles = [...new Set(context.recentFiles)].slice(-5);
        context.recentTopics = [...new Set(context.recentTopics)].slice(-10);
        context.recentActions = [...new Set(context.recentActions)].slice(-5);

        return context;
    }

    async resolve(
        currentMessage: string,
        history: ConversationTurn[]
    ): Promise<{
        expandedMessage: string;
        resolutions: ResolvedReference[];
        usedLLM: boolean;
    }> {
        // First, check if resolution is needed
        if (!this.needsResolution(currentMessage)) {
            return {
                expandedMessage: currentMessage,
                resolutions: [],
                usedLLM: false
            };
        }

        const openai = getOpenAI();
        const MODELS = getMODELS();

        if (!openai) {
            // Fall back to heuristic if OpenAI not available
            return this.fallbackResolve(currentMessage, history);
        }

        // Try LLM resolution
        try {
            const historyText = history
                .slice(-6)
                .map(t => `${t.role}: ${t.content}`)
                .join("\n");

            const response = await openai.chat.completions.create({
                model: MODELS.TEXT,
                messages: [
                    { role: "system", content: RESOLUTION_PROMPT + historyText },
                    { role: "user", content: `Current message: "${currentMessage}"` }
                ],
                temperature: 0.1,
                max_tokens: 500,
                response_format: { type: "json_object" }
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                return this.fallbackResolve(currentMessage, history);
            }

            const parsed = JSON.parse(content);
            return {
                expandedMessage: parsed.expandedMessage || currentMessage,
                resolutions: (parsed.resolutions || []).map((r: any) => ({
                    original: r.original,
                    resolved: r.resolved,
                    confidence: r.confidence || 0.5,
                    source: "conversation" as const
                })),
                usedLLM: true
            };

        } catch (error) {
            console.error("[HistoryResolver] LLM resolution failed:", error);
            return this.fallbackResolve(currentMessage, history);
        }
    }

    private needsResolution(text: string): boolean {
        const ambiguousPatterns = [
            /\b(it|that|this|these|those)\b/i,
            /\b(the file|the document|the code|the result|the output)\b/i,
            /\b(do it again|same thing|like before|repeat)\b/i,
            /\b(previous|last|earlier)\b/i
        ];

        return ambiguousPatterns.some(p => p.test(text));
    }

    private fallbackResolve(
        currentMessage: string,
        history: ConversationTurn[]
    ): {
        expandedMessage: string;
        resolutions: ResolvedReference[];
        usedLLM: boolean;
    } {
        const context = this.buildContext(history);
        const resolutions: ResolvedReference[] = [];
        let expandedMessage = currentMessage;

        // Simple pattern-based resolution
        const patterns: [RegExp, () => string | null][] = [
            [/\bthe file\b/i, () => context.recentFiles[0] || null],
            [/\bthe document\b/i, () => context.recentFiles[0] || null],
            [/\bdo it again\b/i, () => context.lastUserRequest || null],
            [/\bthe same thing\b/i, () => context.recentActions[0] || null]
        ];

        for (const [pattern, resolver] of patterns) {
            const match = currentMessage.match(pattern);
            if (match) {
                const resolved = resolver();
                if (resolved) {
                    resolutions.push({
                        original: match[0],
                        resolved,
                        confidence: 0.6,
                        source: "inference"
                    });
                    expandedMessage = expandedMessage.replace(pattern, resolved);
                }
            }
        }

        return {
            expandedMessage,
            resolutions,
            usedLLM: false
        };
    }
}
