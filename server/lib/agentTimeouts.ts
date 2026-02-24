
export const AGENT_TIMEOUTS = {
    // Standard tool execution (search, scrape)
    TOOL_EXECUTION: 60 * 1000, // 1 minute

    // Complex analysis (Python pandas, large text processing)
    ANALYSIS_TASK: 5 * 60 * 1000, // 5 minutes

    // Full agent run (Orchestrator session)
    AGENT_RUN_TOTAL: 15 * 60 * 1000, // 15 minutes

    // Single LLM inference
    LLM_INFERENCE: 90 * 1000, // 1.5 minutes
};

export class TimeoutError extends Error {
    constructor(message: string, public code = 'TIMEOUT_EXCEEDED') {
        super(message);
        this.name = 'TimeoutError';
    }
}

export async function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    context: string = 'Operation'
): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new TimeoutError(`${context} timed out after ${ms}ms`));
        }, ms);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutId!);
        return result;
    } catch (error) {
        clearTimeout(timeoutId!);
        throw error;
    }
}
