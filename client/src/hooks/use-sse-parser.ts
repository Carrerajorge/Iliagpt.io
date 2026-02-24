/**
 * useSSEParser - Centralized Server-Sent Events parser with proper buffering.
 *
 * Eliminates duplicated SSE parsing scattered across 5+ code paths in
 * chat-interface.tsx. Handles:
 *  - Proper line buffering across TCP chunk boundaries
 *  - Event type tracking (chunk, text, done, error, etc.)
 *  - Abort signal integration
 *  - Automatic cleanup
 */

import { useRef, useCallback } from "react";

export interface SSEEvent {
  type: string;
  data: Record<string, any>;
}

export interface SSEParserCallbacks {
  onContent?: (content: string, fullContent: string) => void;
  onEvent?: (event: SSEEvent) => void;
  onDone?: (fullContent: string, finalEvent?: SSEEvent) => void;
  onError?: (error: Error) => void;
}

export function useSSEParser() {
  const bufferRef = useRef("");
  const contentRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    bufferRef.current = "";
    contentRef.current = "";
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  /**
   * Parse a ReadableStream of SSE data.
   * Returns the accumulated full content string when complete.
   */
  const parseStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      callbacks: SSEParserCallbacks,
      signal?: AbortSignal
    ): Promise<string> => {
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let currentEventType = "chunk";

      try {
        while (true) {
          if (signal?.aborted) break;

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith("event: ")) {
              currentEventType = trimmed.slice(7).trim();
              continue;
            }

            if (!trimmed.startsWith("data: ")) continue;

            const dataStr = trimmed.slice(6);
            if (dataStr === "[DONE]") {
              callbacks.onDone?.(fullContent);
              return fullContent;
            }

            try {
              const data = JSON.parse(dataStr);
              const event: SSEEvent = { type: currentEventType, data };

              // Emit raw event for non-standard handlers
              callbacks.onEvent?.(event);

              // Handle content accumulation for standard text events
              if (
                currentEventType === "chunk" ||
                currentEventType === "text"
              ) {
                const content = data.content || "";
                if (content) {
                  fullContent += content;
                  callbacks.onContent?.(content, fullContent);
                }
              }

              // Handle terminal events
              if (
                currentEventType === "done" ||
                currentEventType === "finish"
              ) {
                callbacks.onDone?.(fullContent, event);
                return fullContent;
              }

              if (
                currentEventType === "error" ||
                currentEventType === "production_error"
              ) {
                const errorMsg =
                  data.message || data.error || "Stream error";
                callbacks.onError?.(new Error(errorMsg));
                return fullContent;
              }
            } catch {
              // Ignore JSON parse errors for partial data
            }
          }
        }

        // Stream ended without explicit done event
        callbacks.onDone?.(fullContent);
        return fullContent;
      } catch (err: any) {
        if (err.name === "AbortError") {
          return fullContent;
        }
        callbacks.onError?.(err);
        return fullContent;
      }
    },
    []
  );

  /**
   * Convenience: fetch a URL and parse its SSE stream.
   */
  const fetchAndParse = useCallback(
    async (
      url: string,
      options: RequestInit,
      callbacks: SSEParserCallbacks
    ): Promise<{ response: Response; fullContent: string } | null> => {
      abortRef.current = new AbortController();
      const mergedSignal = options.signal || abortRef.current.signal;

      try {
        const response = await fetch(url, {
          ...options,
          signal: mergedSignal,
        });

        if (!response.ok) {
          return { response, fullContent: "" };
        }

        const reader = response.body?.getReader();
        if (!reader) {
          callbacks.onError?.(new Error("No response body"));
          return { response, fullContent: "" };
        }

        const fullContent = await parseStream(reader, callbacks, mergedSignal);
        return { response, fullContent };
      } catch (err: any) {
        if (err.name !== "AbortError") {
          callbacks.onError?.(err);
        }
        return null;
      }
    },
    [parseStream]
  );

  return {
    parseStream,
    fetchAndParse,
    reset,
    abort,
    contentRef,
  };
}
