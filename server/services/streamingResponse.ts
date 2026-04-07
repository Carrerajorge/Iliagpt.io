/**
 * Streaming Chunked Responses Service
 * 
 * Features:
 * - Token-by-token SSE emission
 * - Backpressure handling
 * - Connection management
 * - AbortController support
 */

import { Request, Response } from "express";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { createSession, type Session } from "better-sse";

// Streaming configuration
export interface StreamConfig {
    heartbeatInterval: number;  // ms
    maxChunkSize: number;       // characters
    flushThreshold: number;     // characters before auto-flush
    connectionTimeout: number;  // ms
}

const DEFAULT_CONFIG: StreamConfig = {
    heartbeatInterval: 15000,   // 15 seconds
    maxChunkSize: 500,          // 500 chars per chunk (increased for throughput)
    flushThreshold: 1,          // Flush immediately for minimal latency
    connectionTimeout: 300000,  // 5 minutes
};

// Active streams registry
const activeStreams = new Map<string, StreamController>();

export interface StreamController {
    id: string;
    startedAt: Date;
    bytesSent: number;
    chunksSent: number;
    aborted: boolean;
    close: () => void;
    write: (data: string) => boolean;
    writeEvent: (event: string, data: any) => boolean;
}

// Initialize SSE response
export function initSSEStream(
    req: Request,
    res: Response,
    options: Partial<StreamConfig> = {}
): StreamController {
    const config = { ...DEFAULT_CONFIG, ...options };
    const streamId = `stream_${typeof randomUUID === "function" ? randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.setHeader("X-Stream-Id", streamId);
    res.flushHeaders();

    let aborted = false;
    let bytesSent = 0;
    let chunksSent = 0;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    // Heartbeat to keep connection alive
    heartbeatTimer = setInterval(() => {
        if (!aborted) {
            res.write(": heartbeat\n\n");
        }
    }, config.heartbeatInterval);

    // Connection timeout
    timeoutTimer = setTimeout(() => {
        if (!aborted) {
            controller.writeEvent("timeout", { message: "Connection timeout" });
            controller.close();
        }
    }, config.connectionTimeout);

    // Handle client disconnect
    req.on("close", () => {
        aborted = true;
        cleanup();
    });

    req.on("aborted", () => {
        aborted = true;
        cleanup();
    });

    function cleanup() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        activeStreams.delete(streamId);
    }

    const controller: StreamController = {
        id: streamId,
        startedAt: new Date(),
        get bytesSent() { return bytesSent; },
        get chunksSent() { return chunksSent; },
        get aborted() { return aborted; },

        write(data: string): boolean {
            if (aborted) return false;

            try {
                res.write(`data: ${data}\n\n`);
                bytesSent += data.length;
                chunksSent++;
                return true;
            } catch {
                aborted = true;
                return false;
            }
        },

        writeEvent(event: string, data: any): boolean {
            if (aborted) return false;

            try {
                const payload = typeof data === "string" ? data : JSON.stringify(data);
                res.write(`event: ${event}\ndata: ${payload}\n\n`);
                bytesSent += payload.length;
                chunksSent++;
                return true;
            } catch {
                aborted = true;
                return false;
            }
        },

        close() {
            if (!aborted) {
                res.write("event: done\ndata: {}\n\n");
                res.end();
                aborted = true;
            }
            cleanup();
        },
    };

    activeStreams.set(streamId, controller);
    return controller;
}

// Stream tokens immediately without artificial delay
export async function streamTokens(
    controller: StreamController,
    tokens: string[],
    options: {
        delayMs?: number;
        onToken?: (token: string, index: number) => void;
    } = {}
): Promise<{ completed: boolean; tokensSent: number }> {
    const { delayMs = 0, onToken } = options;
    let tokensSent = 0;

    for (let i = 0; i < tokens.length; i++) {
        if (controller.aborted) {
            return { completed: false, tokensSent };
        }

        const success = controller.writeEvent("token", {
            token: tokens[i],
            index: i,
            total: tokens.length
        });

        if (!success) {
            return { completed: false, tokensSent };
        }

        tokensSent++;
        onToken?.(tokens[i], i);

        // Only apply delay if explicitly requested (default: no delay)
        if (delayMs > 0) {
            await sleep(delayMs);
        }
    }

    return { completed: true, tokensSent };
}

// Stream text in chunks without artificial delay
export async function streamText(
    controller: StreamController,
    text: string,
    options: {
        chunkSize?: number;
        delayMs?: number;
        onChunk?: (chunk: string, index: number) => void;
    } = {}
): Promise<{ completed: boolean; bytesSent: number }> {
    const { chunkSize = 50, delayMs = 0, onChunk } = options;
    let bytesSent = 0;
    let chunkIndex = 0;

    for (let i = 0; i < text.length; i += chunkSize) {
        if (controller.aborted) {
            return { completed: false, bytesSent };
        }

        const chunk = text.slice(i, i + chunkSize);
        const success = controller.writeEvent("chunk", {
            content: chunk,
            position: i,
            total: text.length
        });

        if (!success) {
            return { completed: false, bytesSent };
        }

        bytesSent += chunk.length;
        onChunk?.(chunk, chunkIndex++);

        // Only apply delay if explicitly requested (default: no delay)
        if (delayMs > 0) {
            await sleep(delayMs);
        }
    }

    return { completed: true, bytesSent };
}

// Stream from an async generator
export async function streamFromGenerator<T>(
    controller: StreamController,
    generator: AsyncGenerator<T>,
    options: {
        eventName?: string;
        transform?: (item: T) => any;
    } = {}
): Promise<{ completed: boolean; itemsSent: number }> {
    const { eventName = "data", transform } = options;
    let itemsSent = 0;

    try {
        for await (const item of generator) {
            if (controller.aborted) {
                return { completed: false, itemsSent };
            }

            const data = transform ? transform(item) : item;
            const success = controller.writeEvent(eventName, data);

            if (!success) {
                return { completed: false, itemsSent };
            }

            itemsSent++;
        }

        return { completed: true, itemsSent };
    } catch (error) {
        controller.writeEvent("error", {
            message: (error as Error).message
        });
        return { completed: false, itemsSent };
    }
}

// Stream from EventEmitter
export function streamFromEmitter(
    controller: StreamController,
    emitter: EventEmitter,
    events: string[]
): { stop: () => void } {
    const handlers: { event: string; handler: (...args: any[]) => void }[] = [];

    for (const event of events) {
        const handler = (...args: any[]) => {
            if (!controller.aborted) {
                controller.writeEvent(event, args.length === 1 ? args[0] : args);
            }
        };

        emitter.on(event, handler);
        handlers.push({ event, handler });
    }

    return {
        stop() {
            for (const { event, handler } of handlers) {
                emitter.off(event, handler);
            }
        },
    };
}

// Get active stream by ID
export function getStream(streamId: string): StreamController | undefined {
    return activeStreams.get(streamId);
}

// Get all active streams
export function getActiveStreams(): { id: string; startedAt: Date; bytesSent: number }[] {
    return Array.from(activeStreams.values()).map(s => ({
        id: s.id,
        startedAt: s.startedAt,
        bytesSent: s.bytesSent,
    }));
}

// Abort a stream
export function abortStream(streamId: string): boolean {
    const stream = activeStreams.get(streamId);
    if (stream) {
        stream.close();
        return true;
    }
    return false;
}

// Utility: sleep
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Create a typed streaming response for LLM output
export function createLLMStream(req: Request, res: Response) {
    const controller = initSSEStream(req, res);

    return {
        controller,

        sendToken(token: string) {
            return controller.writeEvent("token", { token });
        },

        sendChunk(content: string) {
            return controller.writeEvent("chunk", { content });
        },

        sendProgress(progress: number, message?: string) {
            return controller.writeEvent("progress", { progress, message });
        },

        sendMetadata(metadata: Record<string, any>) {
            return controller.writeEvent("metadata", metadata);
        },

        sendError(error: string) {
            return controller.writeEvent("error", { error });
        },

        complete(summary?: Record<string, any>) {
            controller.writeEvent("complete", summary || {});
            controller.close();
        },

        isActive() {
            return !controller.aborted;
        },
    };
}

/**
 * Creates a better-sse Session for spec-compliant SSE with automatic keepalive,
 * serialization, and lifecycle management. Use for new SSE endpoints where the
 * full StreamController is not needed.
 *
 * Returns a Session object with .push(event, data) for sending typed events.
 */
export async function createBetterSSESession(
    req: Request,
    res: Response,
    options?: {
        keepAliveInterval?: number;
        retry?: number;
    }
): Promise<Session> {
    const session = await createSession(req, res, {
        keepAlive: options?.keepAliveInterval ?? 15000,
        retry: options?.retry ?? 3000,
        headers: {
            "X-Accel-Buffering": "no",
        },
    });

    return session;
}

/**
 * Wraps a better-sse Session into a StreamController-compatible interface,
 * allowing gradual migration of existing endpoints.
 */
export function sessionToController(session: Session): StreamController {
    const streamId = `bsse_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let bytesSent = 0;
    let chunksSent = 0;

    const controller: StreamController = {
        id: streamId,
        startedAt: new Date(),
        get bytesSent() { return bytesSent; },
        get chunksSent() { return chunksSent; },
        get aborted() { return !session.isConnected; },

        write(data: string): boolean {
            if (!session.isConnected) return false;
            try {
                session.push(data);
                bytesSent += data.length;
                chunksSent++;
                return true;
            } catch {
                return false;
            }
        },

        writeEvent(event: string, data: any): boolean {
            if (!session.isConnected) return false;
            try {
                const payload = typeof data === "string" ? data : JSON.stringify(data);
                session.push(payload, event);
                bytesSent += payload.length;
                chunksSent++;
                return true;
            } catch {
                return false;
            }
        },

        close() {
            // Session closes when the underlying response ends
            try {
                session.push("{}", "done");
            } catch {
                // Connection may already be closed
            }
        },
    };

    activeStreams.set(streamId, controller);
    session.on("disconnected", () => {
        activeStreams.delete(streamId);
    });

    return controller;
}

export default {
    initSSEStream,
    streamTokens,
    streamText,
    streamFromGenerator,
    streamFromEmitter,
    getStream,
    getActiveStreams,
    abortStream,
    createLLMStream,
    createBetterSSESession,
    sessionToController,
};
