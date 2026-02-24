import { createHash } from "crypto";

export type LoopDetectorKind = "generic_repeat" | "known_poll_no_progress" | "global_circuit_breaker" | "ping_pong";

export type LoopDetectionResult =
    | { stuck: false }
    | {
        stuck: true;
        level: "warning" | "critical";
        detector: LoopDetectorKind;
        count: number;
        message: string;
    };

export const TOOL_CALL_HISTORY_SIZE = 30;
export const CRITICAL_THRESHOLD = 20;

export type ToolCallRecord = {
    toolName: string;
    argsHash: string;
    resultHash?: string;
    timestamp: number;
};

function stableStringify(value: any): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) || String(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export function hashToolCall(toolName: string, params: any): string {
    return `${toolName}:${createHash("sha256").update(stableStringify(params)).digest("hex")}`;
}

export function hashToolOutcome(result: any, error: any): string {
    const data = error !== undefined ? `error:${stableStringify(error)}` : stableStringify(result);
    return createHash("sha256").update(data).digest("hex");
}

/**
 * Detect if an agent is stuck in a repetitive tool call loop or ping-ponging without making progress.
 */
export function detectToolCallLoop(history: ToolCallRecord[], toolName: string, params: any): LoopDetectionResult {
    if (!history || history.length === 0) return { stuck: false };

    const currentHash = hashToolCall(toolName, params);

    // Check Global Circuit Breaker (Same exact tool and args repeatedly)
    let streak = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].toolName === toolName && history[i].argsHash === currentHash) {
            streak++;
        } else {
            break; // Streak broken
        }
    }

    if (streak >= CRITICAL_THRESHOLD) {
        return {
            stuck: true,
            level: "critical",
            detector: "global_circuit_breaker",
            count: streak,
            message: `CRITICAL: ${toolName} has repeated identical arguments ${streak} times in a row. Session execution blocked by global circuit breaker to prevent runaway loops.`
        };
    }

    // Ping Pong Detection
    const last = history[history.length - 1];
    if (history.length >= 4 && last.argsHash !== currentHash) {
        let pingPongCount = 0;
        const hashA = currentHash;
        const hashB = last.argsHash;

        for (let i = history.length - 1; i >= 0; i--) {
            const expectedHash = (pingPongCount % 2 === 0) ? hashB : hashA;
            if (history[i].argsHash === expectedHash) {
                pingPongCount++;
            } else {
                break;
            }
        }

        if (pingPongCount >= CRITICAL_THRESHOLD) {
            return {
                stuck: true,
                level: "critical",
                detector: "ping_pong",
                count: pingPongCount,
                message: `CRITICAL: You are alternating between two repeated tool-call patterns (${pingPongCount} consecutive calls) with no progress. This appears to be a stuck ping-pong loop. Session execution blocked to prevent resource waste.`
            };
        }
    }

    return { stuck: false };
}
