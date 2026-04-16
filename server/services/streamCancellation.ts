/**
 * Streaming Cancellation (#47)
 * Real cancellation of LLM generation from client
 */

import { EventEmitter } from 'events';

// Active stream registry
const activeStreams = new Map<string, {
    controller: AbortController;
    startedAt: Date;
    userId: number;
    model: string;
}>();

/**
 * Register a new stream
 */
export function registerStream(
    streamId: string,
    userId: number,
    model: string
): AbortController {
    const controller = new AbortController();

    activeStreams.set(streamId, {
        controller,
        startedAt: new Date(),
        userId,
        model,
    });

    // Auto-cleanup after 10 minutes
    setTimeout(() => {
        unregisterStream(streamId);
    }, 10 * 60 * 1000);

    return controller;
}

/**
 * Unregister a stream (completed or cancelled)
 */
export function unregisterStream(streamId: string): void {
    activeStreams.delete(streamId);
}

/**
 * Cancel a stream
 */
export function cancelStream(streamId: string, userId?: number): boolean {
    const stream = activeStreams.get(streamId);

    if (!stream) {
        return false;
    }

    // Verify ownership if userId provided
    if (userId !== undefined && stream.userId !== userId) {
        console.warn(`User ${userId} attempted to cancel stream owned by ${stream.userId}`);
        return false;
    }

    stream.controller.abort();
    activeStreams.delete(streamId);

    console.log(`Stream ${streamId} cancelled`);
    return true;
}

/**
 * Get active streams for a user
 */
export function getUserActiveStreams(userId: number): string[] {
    const streams: string[] = [];

    for (const [streamId, stream] of activeStreams.entries()) {
        if (stream.userId === userId) {
            streams.push(streamId);
        }
    }

    return streams;
}

/**
 * Cancel all streams for a user
 */
export function cancelAllUserStreams(userId: number): number {
    const streams = getUserActiveStreams(userId);

    for (const streamId of streams) {
        cancelStream(streamId);
    }

    return streams.length;
}

/**
 * Get stream status
 */
export function getStreamStatus(streamId: string): {
    active: boolean;
    startedAt?: Date;
    durationMs?: number;
} {
    const stream = activeStreams.get(streamId);

    if (!stream) {
        return { active: false };
    }

    return {
        active: true,
        startedAt: stream.startedAt,
        durationMs: Date.now() - stream.startedAt.getTime(),
    };
}

// ============================================
// EXPRESS ROUTER
// ============================================

import { Router, Request, Response } from 'express';

export function createStreamCancellationRouter(): Router {
    const router = Router();

    // Cancel specific stream
    router.post('/cancel/:streamId', (req: Request, res: Response) => {
        const { streamId } = req.params;
        const userId = (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const cancelled = cancelStream(streamId, userId);

        if (!cancelled) {
            return res.status(404).json({ error: 'Stream not found or unauthorized' });
        }

        res.json({ success: true, message: 'Stream cancelled' });
    });

    // Cancel all user streams
    router.post('/cancel-all', (req: Request, res: Response) => {
        const userId = (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const count = cancelAllUserStreams(userId);

        res.json({ success: true, cancelledCount: count });
    });

    // Get stream status
    router.get('/status/:streamId', (req: Request, res: Response) => {
        const { streamId } = req.params;
        const status = getStreamStatus(streamId);

        res.json(status);
    });

    return router;
}

// ============================================
// CANCELLABLE STREAM WRAPPER
// ============================================

export interface StreamOptions {
    streamId: string;
    userId: number;
    model: string;
    onCancel?: () => void;
}

/**
 * Create a cancellable async generator wrapper
 */
export async function* withCancellation<T>(
    generator: AsyncGenerator<T>,
    options: StreamOptions
): AsyncGenerator<T> {
    const controller = registerStream(
        options.streamId,
        options.userId,
        options.model
    );

    try {
        for await (const item of generator) {
            // Check if cancelled
            if (controller.signal.aborted) {
                options.onCancel?.();
                return;
            }
            yield item;
        }
    } finally {
        unregisterStream(options.streamId);
    }
}

/**
 * Fetch with cancellation support
 */
export async function fetchWithCancellation(
    url: string,
    options: RequestInit & { streamId?: string; userId?: number; model?: string }
): Promise<globalThis.Response> {
    const controller = options.streamId
        ? registerStream(options.streamId, options.userId || 0, options.model || '')
        : new AbortController();

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        return response;
    } catch (error: any) {
        if (error.name === 'AbortError') {
            throw new Error('Request cancelled');
        }
        throw error;
    } finally {
        if (options.streamId) {
            unregisterStream(options.streamId);
        }
    }
}

// ============================================
// CLIENT-SIDE HOOK
// ============================================

/**
 * React hook for stream cancellation
 * Usage: const { streamId, cancel, isActive } = useCancellableStream();
 */
export function createClientCancellation() {
    let currentStreamId: string | null = null;

    return {
        start: (streamId: string) => {
            currentStreamId = streamId;
        },

        cancel: async () => {
            if (!currentStreamId) return false;

            try {
                const response = await fetch(`/api/stream/cancel/${currentStreamId}`, {
                    method: 'POST',
                    credentials: 'include',
                });

                if (response.ok) {
                    currentStreamId = null;
                    return true;
                }
            } catch (error) {
                console.error('Failed to cancel stream:', error);
            }
            return false;
        },

        isActive: () => currentStreamId !== null,

        getStreamId: () => currentStreamId,
    };
}
