/**
 * Enhanced Streaming Service
 * Improved streaming with smaller chunks and smooth UI updates
 */

import { EventEmitter } from 'events';

interface StreamingOptions {
    chunkSize?: number;         // Characters per chunk (default: 10)
    chunkDelay?: number;        // Milliseconds between chunks (default: 20)
    bufferSize?: number;        // Max buffer before forced flush (default: 100)
    onChunk?: (chunk: string) => void;
    onComplete?: (fullContent: string) => void;
    onError?: (error: Error) => void;
    onEvent?: (event: string, data: any) => void;
}

interface StreamState {
    buffer: string;
    fullContent: string;
    isStreaming: boolean;
    startTime: number;
    chunkCount: number;
    totalChars: number;
}

/**
 * Enhanced streaming processor that breaks content into smooth,
 * small chunks for better UI rendering
 */
export class EnhancedStreamProcessor extends EventEmitter {
    private options: Required<StreamingOptions>;
    private state: StreamState;
    private flushTimer: NodeJS.Timeout | null = null;
    private abortController: AbortController | null = null;

    constructor(options: StreamingOptions = {}) {
        super();

        this.options = {
            chunkSize: options.chunkSize ?? 10,
            chunkDelay: options.chunkDelay ?? 20,
            bufferSize: options.bufferSize ?? 100,
            onChunk: options.onChunk ?? (() => { }),
            onComplete: options.onComplete ?? (() => { }),
            onError: options.onError ?? console.error,
            onEvent: options.onEvent ?? (() => { }),
        };

        this.state = this.createInitialState();
    }

    private createInitialState(): StreamState {
        return {
            buffer: '',
            fullContent: '',
            isStreaming: false,
            startTime: 0,
            chunkCount: 0,
            totalChars: 0,
        };
    }

    /**
     * Start processing a stream
     */
    async processStream(stream: ReadableStream<Uint8Array>): Promise<string> {
        this.state = this.createInitialState();
        this.state.isStreaming = true;
        this.state.startTime = Date.now();
        this.abortController = new AbortController();

        const reader = stream.getReader();
        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    await this.flushBuffer(true);
                    break;
                }

                if (this.abortController.signal.aborted) {
                    break;
                }

                const text = decoder.decode(value, { stream: true });
                this.state.buffer += text;
                this.state.fullContent += text;
                this.state.totalChars += text.length;

                // Process buffer if it exceeds threshold
                if (this.state.buffer.length >= this.options.bufferSize) {
                    await this.flushBuffer(false);
                }
            }

            this.state.isStreaming = false;
            this.options.onComplete(this.state.fullContent);
            this.emit('complete', this.state.fullContent);

            return this.state.fullContent;
        } catch (error) {
            this.state.isStreaming = false;
            this.options.onError(error as Error);
            this.emit('error', error);
            throw error;
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Process SSE stream from fetch
     */
    async processSSEStream(response: Response): Promise<string> {
        if (!response.body) {
            throw new Error('No response body');
        }

        this.state = this.createInitialState();
        this.state.isStreaming = true;
        this.state.startTime = Date.now();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    await this.flushBuffer(true);
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                let currentEvent = 'message';

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        currentEvent = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            // Emit specific event
                            this.emit(currentEvent, data);
                            this.options.onEvent?.(currentEvent, data);

                            // Handle standard content flow
                            if (data.content) {
                                this.state.buffer += data.content;
                                this.state.fullContent += data.content;
                                this.state.totalChars += data.content.length;
                            }

                            if (data.done || currentEvent === 'done') {
                                await this.flushBuffer(true);
                                break;
                            }
                        } catch {
                            // Non-JSON SSE data
                        }
                    }
                }

                if (this.state.buffer.length >= this.options.bufferSize) {
                    await this.flushBuffer(false);
                }
            }

            this.state.isStreaming = false;
            this.options.onComplete(this.state.fullContent);
            this.emit('complete', this.state.fullContent);

            return this.state.fullContent;
        } catch (error) {
            this.state.isStreaming = false;
            this.options.onError(error as Error);
            this.emit('error', error);
            throw error;
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Flush buffer in small chunks with delays for smooth rendering
     */
    private async flushBuffer(final: boolean): Promise<void> {
        while (this.state.buffer.length > 0) {
            const chunk = this.state.buffer.slice(0, this.options.chunkSize);
            this.state.buffer = this.state.buffer.slice(this.options.chunkSize);

            this.state.chunkCount++;
            this.options.onChunk(chunk);
            this.emit('chunk', chunk);

            if (!final && this.state.buffer.length > 0) {
                await this.delay(this.options.chunkDelay);
            }
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Abort the current stream
     */
    abort(): void {
        this.abortController?.abort();
        this.state.isStreaming = false;
        this.emit('abort');
    }

    /**
     * Get current streaming statistics
     */
    getStats(): {
        isStreaming: boolean;
        duration: number;
        chunkCount: number;
        totalChars: number;
        charsPerSecond: number;
    } {
        const duration = Date.now() - this.state.startTime;
        return {
            isStreaming: this.state.isStreaming,
            duration,
            chunkCount: this.state.chunkCount,
            totalChars: this.state.totalChars,
            charsPerSecond: duration > 0 ? (this.state.totalChars / duration) * 1000 : 0,
        };
    }
}

/**
 * Hook-friendly streaming function
 */
export async function* streamWithSmallChunks(
    response: Response,
    chunkSize: number = 10,
    chunkDelay: number = 20,
): AsyncGenerator<string, void, unknown> {
    if (!response.body) {
        throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                // Flush remaining buffer
                while (buffer.length > 0) {
                    yield buffer.slice(0, chunkSize);
                    buffer = buffer.slice(chunkSize);
                    if (buffer.length > 0) {
                        await new Promise(r => setTimeout(r, chunkDelay));
                    }
                }
                break;
            }

            const text = decoder.decode(value, { stream: true });
            buffer += text;

            // Emit chunks
            while (buffer.length >= chunkSize) {
                yield buffer.slice(0, chunkSize);
                buffer = buffer.slice(chunkSize);
                await new Promise(r => setTimeout(r, chunkDelay));
            }
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Create optimized SSE connection
 */
export function createSSEConnection(
    url: string,
    onMessage: (data: any) => void,
    onError?: (error: Event) => void,
    onComplete?: () => void,
): EventSource {
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onMessage(data);

            if (data.done) {
                eventSource.close();
                onComplete?.();
            }
        } catch (error) {
            // Non-JSON message
            onMessage({ content: event.data });
        }
    };

    eventSource.onerror = (error) => {
        onError?.(error);
        eventSource.close();
    };

    return eventSource;
}
