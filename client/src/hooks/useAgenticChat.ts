/**
 * useAgenticChat.ts
 *
 * Full agentic chat hook with SSE streaming, multi-turn message state,
 * background task tracking and cancellation support.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  AgenticStreamParser,
  createStreamParser,
  parseSSELine,
  type ParsedAgenticMessage,
  type ToolCall,
} from '@/lib/agentic/agenticStreamParser';

export type { ToolCall } from '@/lib/agentic/agenticStreamParser';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface AgenticMessage {
  id: string;
  role: 'user' | 'assistant';
  parsedMessage?: ParsedAgenticMessage; // for assistant messages
  text?: string; // for user messages
  createdAt: number;
}

export interface AgenticChatConfig {
  chatId: string;
  endpoint?: string; // default '/api/chat/stream'
  onError?: (err: Error) => void;
  onComplete?: (message: AgenticMessage) => void;
  onToolCall?: (toolCall: ToolCall) => void;
}

export interface AgenticChatState {
  messages: AgenticMessage[];
  isStreaming: boolean;
  isThinking: boolean;
  currentToolCall: ToolCall | null;
  backgroundTaskIds: string[];
  error: string | null;
  canCancel: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let _msgCounter = 0;
function generateMessageId(role: string): string {
  return `${role}-${Date.now()}-${++_msgCounter}`;
}

function buildFormData(text: string, attachments: File[]): FormData {
  const fd = new FormData();
  fd.append('message', text);
  for (const file of attachments) {
    fd.append('attachments', file, file.name);
  }
  return fd;
}

// ---------------------------------------------------------------------------
// useAgenticChat
// ---------------------------------------------------------------------------

export function useAgenticChat(config: AgenticChatConfig): {
  state: AgenticChatState;
  sendMessage: (text: string, attachments?: File[]) => Promise<void>;
  cancel: () => void;
  retry: () => void;
  clearMessages: () => void;
} {
  const {
    chatId,
    endpoint = '/api/chat/stream',
    onError,
    onComplete,
    onToolCall,
  } = config;

  const [state, setState] = useState<AgenticChatState>({
    messages: [],
    isStreaming: false,
    isThinking: false,
    currentToolCall: null,
    backgroundTaskIds: [],
    error: null,
    canCancel: false,
  });

  // Refs that don't need to trigger re-renders
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastUserTextRef = useRef<string>('');
  const lastUserAttachmentsRef = useRef<File[]>([]);
  const parserRef = useRef<AgenticStreamParser | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Stream a response for a given assistant message id
  // -------------------------------------------------------------------------

  const streamResponse = useCallback(
    async (
      assistantMessageId: string,
      userText: string,
      attachments: File[]
    ): Promise<void> => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const parser = createStreamParser(assistantMessageId);
      parserRef.current = parser;

      setState((prev) => ({
        ...prev,
        isStreaming: true,
        canCancel: true,
        error: null,
      }));

      try {
        let response: Response;

        if (attachments.length > 0) {
          const fd = buildFormData(userText, attachments);
          fd.append('chatId', chatId);
          fd.append('assistantMessageId', assistantMessageId);
          response = await fetch(endpoint, {
            method: 'POST',
            body: fd,
            signal: controller.signal,
          });
        } else {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId,
              message: userText,
              assistantMessageId,
            }),
            signal: controller.signal,
          });
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => response.statusText);
          throw new Error(`Stream request failed (${response.status}): ${errText}`);
        }

        if (!response.body) {
          throw new Error('Response has no body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let lineBuffer = '';

        // Accumulate SSE fields across data chunks
        let pendingData = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuffer += decoder.decode(value, { stream: true });

          // Split on newlines — SSE lines are \n or \r\n delimited
          const lines = lineBuffer.split(/\r?\n/);
          // Last element may be incomplete — keep it in the buffer
          lineBuffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line === '') {
              // Empty line = dispatch accumulated event
              if (pendingData) {
                const event = parser.processEvent(`data: ${pendingData}`);
                if (event) {
                  parser.handleEvent(event);
                  const snapshot = parser.getSnapshot();

                  // Derive UI state from snapshot
                  const nodes = snapshot.nodes;
                  const lastToolNode = [...nodes]
                    .reverse()
                    .find((n) => n.type === 'tool_call');
                  const activeToolCall =
                    lastToolNode?.toolCall?.status === 'pending' ||
                    lastToolNode?.toolCall?.status === 'running'
                      ? lastToolNode.toolCall
                      : null;

                  if (event.type === 'task_spawned' && event.taskId) {
                    setState((prev) => ({
                      ...prev,
                      backgroundTaskIds: [...prev.backgroundTaskIds, event.taskId!],
                    }));
                  }

                  if (
                    event.type === 'tool_call_start' &&
                    lastToolNode?.toolCall
                  ) {
                    onToolCall?.(lastToolNode.toolCall);
                  }

                  setState((prev) => ({
                    ...prev,
                    isThinking: activeToolCall !== null,
                    currentToolCall: activeToolCall ?? prev.currentToolCall,
                    messages: prev.messages.map((m) =>
                      m.id === assistantMessageId
                        ? { ...m, parsedMessage: snapshot }
                        : m
                    ),
                  }));

                  if (event.type === 'done') {
                    const finalSnapshot = parser.getSnapshot();
                    const assistantMsg: AgenticMessage = {
                      id: assistantMessageId,
                      role: 'assistant',
                      parsedMessage: finalSnapshot,
                      createdAt: finalSnapshot.startedAt,
                    };

                    setState((prev) => ({
                      ...prev,
                      isStreaming: false,
                      isThinking: false,
                      currentToolCall: null,
                      canCancel: false,
                      messages: prev.messages.map((m) =>
                        m.id === assistantMessageId ? assistantMsg : m
                      ),
                    }));

                    onComplete?.(assistantMsg);
                  }

                  if (event.type === 'error') {
                    const errMsg = event.error ?? 'Unknown stream error';
                    setState((prev) => ({
                      ...prev,
                      isStreaming: false,
                      isThinking: false,
                      currentToolCall: null,
                      canCancel: false,
                      error: errMsg,
                    }));
                    onError?.(new Error(errMsg));
                  }
                }
                pendingData = '';
              }
              continue;
            }

            const parsed = parseSSELine(line);
            if (parsed?.data !== undefined) {
              if (parsed.data === '[DONE]') {
                // Treat as done signal if server sends it this way
                if (!parser.isComplete()) {
                  parser.handleEvent({ type: 'done' });
                  const finalSnapshot = parser.getSnapshot();
                  const assistantMsg: AgenticMessage = {
                    id: assistantMessageId,
                    role: 'assistant',
                    parsedMessage: finalSnapshot,
                    createdAt: finalSnapshot.startedAt,
                  };
                  setState((prev) => ({
                    ...prev,
                    isStreaming: false,
                    isThinking: false,
                    currentToolCall: null,
                    canCancel: false,
                    messages: prev.messages.map((m) =>
                      m.id === assistantMessageId ? assistantMsg : m
                    ),
                  }));
                  onComplete?.(assistantMsg);
                }
              } else {
                pendingData = parsed.data;
              }
            }
            // event: field — we don't need separate event type routing here
            // because our JSON payloads carry their own `type` field
          }
        }

        // Handle any leftover in lineBuffer (stream ended without trailing \n)
        if (lineBuffer.trim() && lineBuffer.trim() !== '[DONE]') {
          const event = parser.processEvent(`data: ${lineBuffer.trim()}`);
          if (event) {
            parser.handleEvent(event);
            const snapshot = parser.getSnapshot();
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, parsedMessage: snapshot }
                  : m
              ),
            }));
          }
        }

        // Ensure streaming flag is cleared even if 'done' event was never sent
        setState((prev) => {
          if (prev.isStreaming) {
            return {
              ...prev,
              isStreaming: false,
              canCancel: false,
              isThinking: false,
              currentToolCall: null,
            };
          }
          return prev;
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          // User cancelled — update state accordingly but don't fire onError
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            canCancel: false,
            isThinking: false,
            currentToolCall: null,
          }));
          return;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          canCancel: false,
          isThinking: false,
          currentToolCall: null,
          error: error.message,
        }));
        onError?.(error);
      } finally {
        abortControllerRef.current = null;
      }
    },
    [chatId, endpoint, onError, onComplete, onToolCall]
  );

  // -------------------------------------------------------------------------
  // sendMessage
  // -------------------------------------------------------------------------

  const sendMessage = useCallback(
    async (text: string, attachments: File[] = []): Promise<void> => {
      if (state.isStreaming) return;

      lastUserTextRef.current = text;
      lastUserAttachmentsRef.current = attachments;

      const userMsgId = generateMessageId('user');
      const assistantMsgId = generateMessageId('assistant');
      const now = Date.now();

      const userMessage: AgenticMessage = {
        id: userMsgId,
        role: 'user',
        text,
        createdAt: now,
      };

      const assistantPlaceholder: AgenticMessage = {
        id: assistantMsgId,
        role: 'assistant',
        parsedMessage: {
          id: assistantMsgId,
          nodes: [],
          isComplete: false,
          hasError: false,
          totalToolCalls: 0,
          completedToolCalls: 0,
          startedAt: now,
        },
        createdAt: now,
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage, assistantPlaceholder],
        error: null,
      }));

      await streamResponse(assistantMsgId, text, attachments);
    },
    [state.isStreaming, streamResponse]
  );

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------

  const cancel = useCallback((): void => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setState((prev) => ({
      ...prev,
      isStreaming: false,
      canCancel: false,
      isThinking: false,
      currentToolCall: null,
    }));
  }, []);

  // -------------------------------------------------------------------------
  // retry
  // -------------------------------------------------------------------------

  const retry = useCallback((): void => {
    if (state.isStreaming) return;

    const lastText = lastUserTextRef.current;
    const lastAttachments = lastUserAttachmentsRef.current;
    if (!lastText) return;

    // Remove the last assistant message (which likely has an error) so we can
    // append a fresh one
    setState((prev) => {
      const msgs = [...prev.messages];
      if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
        msgs.pop();
      }
      return { ...prev, messages: msgs, error: null };
    });

    // Re-stream — use a new assistant message id
    const assistantMsgId = generateMessageId('assistant');
    const now = Date.now();
    const placeholder: AgenticMessage = {
      id: assistantMsgId,
      role: 'assistant',
      parsedMessage: {
        id: assistantMsgId,
        nodes: [],
        isComplete: false,
        hasError: false,
        totalToolCalls: 0,
        completedToolCalls: 0,
        startedAt: now,
      },
      createdAt: now,
    };

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, placeholder],
    }));

    streamResponse(assistantMsgId, lastText, lastAttachments).catch(
      (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
      }
    );
  }, [state.isStreaming, streamResponse, onError]);

  // -------------------------------------------------------------------------
  // clearMessages
  // -------------------------------------------------------------------------

  const clearMessages = useCallback((): void => {
    abortControllerRef.current?.abort();
    setState({
      messages: [],
      isStreaming: false,
      isThinking: false,
      currentToolCall: null,
      backgroundTaskIds: [],
      error: null,
      canCancel: false,
    });
  }, []);

  return { state, sendMessage, cancel, retry, clearMessages };
}
