/**
 * Enhanced Streaming Hook - ILIAGPT PRO 3.0
 * 
 * Word-by-word streaming with typing effect,
 * markdown parsing, and error recovery.
 */

import { useState, useCallback, useRef, useEffect } from "react";

// ============== Types ==============

export interface StreamConfig {
    speed?: "slow" | "normal" | "fast" | "instant";
    chunkSize?: number;
    showCursor?: boolean;
    parseMarkdown?: boolean;
    onComplete?: (text: string) => void;
    onError?: (error: Error) => void;
}

export interface StreamState {
    text: string;
    displayText: string;
    isStreaming: boolean;
    isComplete: boolean;
    progress: number;
    error: Error | null;
}

interface StreamChunk {
    content: string;
    timestamp: number;
}

// ============== Speed Config ==============

const SPEED_CONFIG = {
    slow: { baseDelay: 80, variance: 40 },
    normal: { baseDelay: 30, variance: 15 },
    fast: { baseDelay: 10, variance: 5 },
    instant: { baseDelay: 0, variance: 0 },
};

// ============== Hook ==============

export function useEnhancedStreaming(config: StreamConfig = {}) {
    const {
        speed = "normal",
        chunkSize = 1,
        showCursor = true,
        parseMarkdown = true,
        onComplete,
        onError,
    } = config;

    const [state, setState] = useState<StreamState>({
        text: "",
        displayText: "",
        isStreaming: false,
        isComplete: false,
        progress: 0,
        error: null,
    });

    const buffer = useRef<StreamChunk[]>([]);
    const displayIndex = useRef(0);
    const animationFrame = useRef<number | null>(null);
    const abortController = useRef<AbortController | null>(null);

    // ======== Animation Loop ========

    const animate = useCallback(() => {
        const { baseDelay, variance } = SPEED_CONFIG[speed];

        const processChar = () => {
            const fullText = buffer.current.map(c => c.content).join("");

            if (displayIndex.current >= fullText.length) {
                // Check if more content in buffer
                if (state.isStreaming) {
                    animationFrame.current = requestAnimationFrame(() => {
                        setTimeout(processChar, 50);
                    });
                } else {
                    setState(s => ({
                        ...s,
                        displayText: fullText,
                        isComplete: true,
                        progress: 1,
                    }));
                    onComplete?.(fullText);
                }
                return;
            }

            // Get next chunk
            const nextIndex = Math.min(
                displayIndex.current + chunkSize,
                fullText.length
            );
            displayIndex.current = nextIndex;

            const displayText = fullText.slice(0, nextIndex);
            const cursorText = showCursor && !state.isComplete ? displayText + "▋" : displayText;

            setState(s => ({
                ...s,
                displayText: cursorText,
                progress: nextIndex / fullText.length,
            }));

            // Schedule next frame
            const delay = baseDelay + Math.random() * variance;
            animationFrame.current = requestAnimationFrame(() => {
                setTimeout(processChar, delay);
            });
        };

        processChar();
    }, [speed, chunkSize, showCursor, state.isStreaming, state.isComplete, onComplete]);

    // ======== Start Streaming ========

    const startStream = useCallback(async (
        streamSource: AsyncIterable<string> | ReadableStream<string> | Response
    ): Promise<string> => {
        // Reset state
        buffer.current = [];
        displayIndex.current = 0;
        abortController.current = new AbortController();

        setState({
            text: "",
            displayText: showCursor ? "▋" : "",
            isStreaming: true,
            isComplete: false,
            progress: 0,
            error: null,
        });

        // Start animation
        animate();

        try {
            let stream: ReadableStream<Uint8Array>;

            if (streamSource instanceof Response) {
                if (!streamSource.body) throw new Error("No response body");
                stream = streamSource.body;
            } else if ("getReader" in streamSource) {
                stream = streamSource as unknown as ReadableStream<Uint8Array>;
            } else {
                // AsyncIterable
                for await (const chunk of streamSource) {
                    if (abortController.current?.signal.aborted) break;
                    buffer.current.push({ content: chunk, timestamp: Date.now() });
                    setState(s => ({ ...s, text: s.text + chunk }));
                }
                setState(s => ({ ...s, isStreaming: false }));
                return buffer.current.map(c => c.content).join("");
            }

            const reader = stream.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();

                if (done || abortController.current?.signal.aborted) break;

                const text = decoder.decode(value, { stream: true });
                buffer.current.push({ content: text, timestamp: Date.now() });
                setState(s => ({ ...s, text: s.text + text }));
            }

            setState(s => ({ ...s, isStreaming: false }));
            return buffer.current.map(c => c.content).join("");

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            setState(s => ({
                ...s,
                isStreaming: false,
                error: err,
            }));
            onError?.(err);
            throw err;
        }
    }, [showCursor, animate, onError]);

    // ======== Stream from Text ========

    const streamText = useCallback((text: string): void => {
        buffer.current = [{ content: text, timestamp: Date.now() }];
        displayIndex.current = 0;

        setState({
            text,
            displayText: showCursor ? "▋" : "",
            isStreaming: true,
            isComplete: false,
            progress: 0,
            error: null,
        });

        animate();

        // Mark as complete after adding to buffer
        setTimeout(() => {
            setState(s => ({ ...s, isStreaming: false }));
        }, 50);
    }, [showCursor, animate]);

    // ======== Stream from SSE ========

    const streamSSE = useCallback(async (
        url: string,
        options?: RequestInit
    ): Promise<string> => {
        abortController.current = new AbortController();

        buffer.current = [];
        displayIndex.current = 0;

        setState({
            text: "",
            displayText: showCursor ? "▋" : "",
            isStreaming: true,
            isComplete: false,
            progress: 0,
            error: null,
        });

        animate();

        try {
            const response = await fetch(url, {
                ...options,
                signal: abortController.current.signal,
                headers: {
                    ...options?.headers,
                    Accept: "text/event-stream",
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error("No response body");

            const decoder = new TextDecoder();
            let buffer_sse = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer_sse += decoder.decode(value, { stream: true });
                const lines = buffer_sse.split("\n");
                buffer_sse = lines.pop() || "";

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const data = line.slice(6);
                        if (data === "[DONE]") continue;

                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content ||
                                parsed.content ||
                                parsed.text || "";

                            if (content) {
                                buffer.current.push({ content, timestamp: Date.now() });
                                setState(s => ({ ...s, text: s.text + content }));
                            }
                        } catch {
                            // Non-JSON data, use as-is
                            if (data.trim()) {
                                buffer.current.push({ content: data, timestamp: Date.now() });
                                setState(s => ({ ...s, text: s.text + data }));
                            }
                        }
                    }
                }
            }

            setState(s => ({ ...s, isStreaming: false }));
            return buffer.current.map(c => c.content).join("");

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            setState(s => ({ ...s, isStreaming: false, error: err }));
            onError?.(err);
            throw err;
        }
    }, [showCursor, animate, onError]);

    // ======== Control Functions ========

    const stopStream = useCallback(() => {
        abortController.current?.abort();
        if (animationFrame.current) {
            cancelAnimationFrame(animationFrame.current);
        }

        const fullText = buffer.current.map(c => c.content).join("");
        setState(s => ({
            ...s,
            displayText: fullText,
            isStreaming: false,
            isComplete: true,
            progress: 1,
        }));
    }, []);

    const resetStream = useCallback(() => {
        stopStream();
        buffer.current = [];
        displayIndex.current = 0;
        setState({
            text: "",
            displayText: "",
            isStreaming: false,
            isComplete: false,
            progress: 0,
            error: null,
        });
    }, [stopStream]);

    const skipToEnd = useCallback(() => {
        if (animationFrame.current) {
            cancelAnimationFrame(animationFrame.current);
        }

        const fullText = buffer.current.map(c => c.content).join("");
        displayIndex.current = fullText.length;

        setState(s => ({
            ...s,
            displayText: fullText,
            isComplete: !s.isStreaming,
            progress: 1,
        }));

        if (!state.isStreaming) {
            onComplete?.(fullText);
        }
    }, [state.isStreaming, onComplete]);

    // ======== Cleanup ========

    useEffect(() => {
        return () => {
            if (animationFrame.current) {
                cancelAnimationFrame(animationFrame.current);
            }
            abortController.current?.abort();
        };
    }, []);

    return {
        ...state,
        startStream,
        streamText,
        streamSSE,
        stopStream,
        resetStream,
        skipToEnd,
    };
}

// ============== Utility: Parse Markdown while streaming ========

export function parseStreamingMarkdown(text: string): string {
    // Simple markdown parsing that works mid-stream
    return text
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
}

export default useEnhancedStreaming;
