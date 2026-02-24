/**
 * Context Summarization (#42)
 * Optimize context window usage with intelligent summarization
 */

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: Date;
}

interface SummaryResult {
    summary: string;
    originalTokens: number;
    summarizedTokens: number;
    compressionRatio: number;
}

// Token estimation (approx 4 chars per token)
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

// Model context limits
const MODEL_LIMITS: Record<string, number> = {
    'grok-3': 131072,
    'grok-3-fast': 131072,
    'grok-3-mini': 131072,
    'gemini-2.5-pro': 1000000,
    'claude-3.5-sonnet': 200000,
    'gpt-4o': 128000,
};

/**
 * Sliding window context management
 */
export function applyContextWindow(
    messages: Message[],
    model: string,
    targetTokens?: number
): Message[] {
    const limit = MODEL_LIMITS[model] || 128000;
    const target = targetTokens || Math.floor(limit * 0.7); // 70% of limit

    let totalTokens = 0;
    const result: Message[] = [];

    // Always include system message
    const systemMessages = messages.filter(m => m.role === 'system');
    for (const msg of systemMessages) {
        totalTokens += estimateTokens(msg.content);
        result.push(msg);
    }

    // Add messages from newest to oldest
    const nonSystemMessages = messages.filter(m => m.role !== 'system').reverse();

    for (const msg of nonSystemMessages) {
        const msgTokens = estimateTokens(msg.content);
        if (totalTokens + msgTokens > target) {
            break;
        }
        totalTokens += msgTokens;
        result.unshift(msg);
    }

    return result;
}

/**
 * Generate a summary of older messages
 */
export async function summarizeContext(
    messages: Message[],
    summarizer: (text: string) => Promise<string>
): Promise<SummaryResult> {
    const textToSummarize = messages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n\n');

    const originalTokens = estimateTokens(textToSummarize);

    const summaryPrompt = `Summarize the following conversation concisely, preserving key facts, decisions, and context:

${textToSummarize}

Provide a brief summary that captures the essential information.`;

    const summary = await summarizer(summaryPrompt);
    const summarizedTokens = estimateTokens(summary);

    return {
        summary,
        originalTokens,
        summarizedTokens,
        compressionRatio: originalTokens / summarizedTokens,
    };
}

/**
 * Smart context builder with summarization
 */
export async function buildOptimizedContext(
    messages: Message[],
    model: string,
    options: {
        maxTokens?: number;
        summarizer?: (text: string) => Promise<string>;
        preserveRecentCount?: number;
    } = {}
): Promise<{ messages: Message[]; wasSummarized: boolean }> {
    const {
        maxTokens = Math.floor((MODEL_LIMITS[model] || 128000) * 0.7),
        summarizer,
        preserveRecentCount = 10,
    } = options;

    // Calculate current token usage
    let totalTokens = 0;
    for (const msg of messages) {
        totalTokens += estimateTokens(msg.content);
    }

    // If under limit, return as-is
    if (totalTokens <= maxTokens) {
        return { messages, wasSummarized: false };
    }

    // Separate system, older, and recent messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    const recentMessages = nonSystemMessages.slice(-preserveRecentCount);
    const olderMessages = nonSystemMessages.slice(0, -preserveRecentCount);

    // If no summarizer, just truncate
    if (!summarizer || olderMessages.length === 0) {
        return {
            messages: [...systemMessages, ...recentMessages],
            wasSummarized: false,
        };
    }

    // Summarize older messages
    const { summary } = await summarizeContext(olderMessages, summarizer);

    const summaryMessage: Message = {
        role: 'system',
        content: `[Previous conversation summary]\n${summary}\n[End of summary]`,
    };

    return {
        messages: [...systemMessages, summaryMessage, ...recentMessages],
        wasSummarized: true,
    };
}

/**
 * Incremental summarization for long conversations
 */
export class ConversationSummarizer {
    private summaries: string[] = [];
    private unsummarizedMessages: Message[] = [];
    private summarizeThreshold: number;
    private summarizer: (text: string) => Promise<string>;

    constructor(
        summarizer: (text: string) => Promise<string>,
        options: { summarizeThreshold?: number } = {}
    ) {
        this.summarizer = summarizer;
        this.summarizeThreshold = options.summarizeThreshold || 20;
    }

    async addMessage(message: Message): Promise<void> {
        this.unsummarizedMessages.push(message);

        // Check if we need to summarize
        if (this.unsummarizedMessages.length >= this.summarizeThreshold) {
            await this.summarizeChunk();
        }
    }

    private async summarizeChunk(): Promise<void> {
        const { summary } = await summarizeContext(
            this.unsummarizedMessages,
            this.summarizer
        );

        this.summaries.push(summary);
        this.unsummarizedMessages = [];
    }

    async getFullContext(systemPrompt: string): Promise<Message[]> {
        const result: Message[] = [
            { role: 'system', content: systemPrompt },
        ];

        // Add combined summaries
        if (this.summaries.length > 0) {
            result.push({
                role: 'system',
                content: `[Conversation history summary]\n${this.summaries.join('\n\n')}\n[End summary]`,
            });
        }

        // Add recent unsummarized messages
        result.push(...this.unsummarizedMessages);

        return result;
    }

    getStats(): {
        summarizedChunks: number;
        pendingMessages: number;
        estimatedTokensSaved: number;
    } {
        return {
            summarizedChunks: this.summaries.length,
            pendingMessages: this.unsummarizedMessages.length,
            estimatedTokensSaved: this.summaries.length * 2000, // Rough estimate
        };
    }

    reset(): void {
        this.summaries = [];
        this.unsummarizedMessages = [];
    }
}

/**
 * Extract key entities from conversation for context
 */
export function extractKeyEntities(messages: Message[]): {
    topics: string[];
    names: string[];
    dates: string[];
    numbers: string[];
} {
    const fullText = messages.map(m => m.content).join(' ');

    // Simple regex-based extraction (use NER in production)
    const topics = [...new Set(
        fullText.match(/(?:about|regarding|concerning|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g)
            ?.map(m => m.replace(/^(about|regarding|concerning|for)\s+/, ''))
        || []
    )];

    const names = [...new Set(
        fullText.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g) || []
    )];

    const dates = [...new Set(
        fullText.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g) || []
    )];

    const numbers = [...new Set(
        fullText.match(/\b\d+(?:,\d{3})*(?:\.\d+)?\b/g) || []
    )].slice(0, 10);

    return { topics, names, dates, numbers };
}
