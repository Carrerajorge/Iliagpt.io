/**
 * useStreamChat - conversation-isolated streaming chat hook.
 *
 * Guarantees:
 * - One in-flight stream per conversationId (replace/reject policy)
 * - SSE events are routed strictly by conversationId + request correlation
 * - Background streams do not write into the active chat buffer
 * - Stream buffers and abort controllers are scoped per conversation
 */

import { useCallback, useRef, useEffect } from "react";
import { apiFetch, getAnonUserIdHeader } from "@/lib/apiClient";
import type { Message } from "@/hooks/use-chats";
import { type AIState, type AiProcessStep } from "@/components/chat-interface/types";
import { buildAssistantMessage } from "@shared/assistantMessage";
import { upsertMessageByIdentity } from "@/lib/chatMessageIdentity";

export interface StreamChatDeps {
  setOptimisticMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onSendMessage: (message: Message) => Promise<any>;
  setStreamingContent: (content: string) => void;
  streamingContentRef: React.MutableRefObject<string>;
  setAiState: (value: React.SetStateAction<AIState>, conversationId?: string | null) => void;
  setAiProcessSteps?: (value: React.SetStateAction<AiProcessStep[]>, conversationId?: string | null) => void;
  getActiveConversationId?: () => string | null;
}

export interface StreamOptions {
  body: Record<string, any>;
  chatId?: string | null;
  conversationId?: string | null;
  signal?: AbortSignal;
  onEvent?: (eventType: string, data: any) => void;
  onChunk?: (chunk: string, eventData: any, fullContent: string) => boolean | void;
  onAiStateChange?: (state: AIState) => void;
  buildFinalMessage?: (fullContent: string, lastEventData?: any, messageId?: string) => Message;
  buildErrorMessage?: (error: Error, messageId?: string) => Message;
  queueMode?: "queue" | "replace" | "reject";
  timeoutMs?: number;
  firstTokenTimeoutMs?: number;
  doneTimeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  retryJitterMs?: number;
}

export interface StreamResult {
  ok: boolean;
  content: string;
  message?: Message;
  response?: Response;
  error?: Error;
}

interface ConversationSession {
  abortController: AbortController | null;
  pendingRequestId: string | null;
  nextMessageId: string | null;
  serverAssistantMessageId: string | null;
  fullContent: string;
  pendingContent: string | null;
  queueDepth: number;
  rafId: number | null;
  finalizing: boolean;
  lastFinalizedRequestId: string | null;
  timeoutId: ReturnType<typeof setTimeout> | null;
  firstTokenTimeoutId: ReturnType<typeof setTimeout> | null;
  doneTimeoutId: ReturnType<typeof setTimeout> | null;
  contentTokenTimeoutId: ReturnType<typeof setTimeout> | null;
  idleRecoveryTimeoutId: ReturnType<typeof setTimeout> | null;
  hydratingProgress: Promise<void> | null;
}

interface RemoteStreamingProgress {
  chatId: string;
  lastSeq: number;
  content: string;
  status: "streaming" | "completed" | "failed";
  assistantMessageId?: string | null;
  requestId?: string | null;
  updatedAt?: number;
}

interface ConversationQueueEntry {
  id: string;
  tail: Promise<void>;
}

interface ConversationQueueTicket {
  queued: boolean;
  release: () => void;
}

function createSession(): ConversationSession {
  return {
    abortController: null,
    pendingRequestId: null,
    nextMessageId: null,
    serverAssistantMessageId: null,
    fullContent: "",
    pendingContent: null,
    queueDepth: 0,
    rafId: null,
    finalizing: false,
    lastFinalizedRequestId: null,
    timeoutId: null,
    firstTokenTimeoutId: null,
    doneTimeoutId: null,
    contentTokenTimeoutId: null,
    idleRecoveryTimeoutId: null,
    hydratingProgress: null,
  };
}

const DEFAULT_STREAM_TIMEOUT_MS = 300_000;
const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 45_000;
const DEFAULT_DONE_TIMEOUT_MS = 45_000;
// Gap guard: max time between receiving any SSE event and the first content token.
// Covers the window after firstTokenTimeout is cleared (by a non-content event like
// "thinking") but before doneTimeout is armed (which requires a content chunk).
const DEFAULT_CONTENT_TOKEN_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_RECOVERY_MS = 800;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS = 400;
const DEFAULT_RETRY_JITTER_MS = 250;

const isBusyAiState = (state: AIState): boolean =>
  state === "sending" ||
  state === "streaming" ||
  state === "thinking" ||
  state === "responding" ||
  state === "agent_working";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateRequestId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === "function") {
      return `req_${c.randomUUID()}`;
    }
  } catch {
    // ignore
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function getServerAssistantMessageId(session: ConversationSession | null | undefined): string | null {
  const candidate =
    typeof session?.serverAssistantMessageId === "string"
      ? session.serverAssistantMessageId.trim()
      : "";
  return candidate.length > 0 ? candidate : null;
}

function getDoneEventContent(data: any): string {
  if (typeof data?.answer_text === "string" && data.answer_text.trim()) {
    return data.answer_text;
  }
  if (typeof data?.content === "string" && data.content.trim()) {
    return data.content;
  }
  return "";
}

function normalizeConversationId(options: StreamOptions): string | null {
  const fromOptions = typeof options.conversationId === "string" ? options.conversationId.trim() : "";
  if (fromOptions) return fromOptions;

  const fromChat = typeof options.chatId === "string" ? options.chatId.trim() : "";
  if (fromChat) return fromChat;

  const fromBodyConversationId =
    typeof options.body?.conversationId === "string" ? options.body.conversationId.trim() : "";
  if (fromBodyConversationId) return fromBodyConversationId;

  const fromBodyChatId = typeof options.body?.chatId === "string" ? options.body.chatId.trim() : "";
  if (fromBodyChatId) return fromBodyChatId;

  return null;
}

function shouldExposeStreamDebug(): boolean {
  if (typeof window === "undefined") return false;
  return (
    import.meta.env.DEV ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
  );
}

function pushStreamDebug(entry: Record<string, unknown>): void {
  if (!shouldExposeStreamDebug() || typeof window === "undefined") return;
  const globalWindow = window as typeof window & {
    __streamChatDebug?: Array<Record<string, unknown>>;
  };
  globalWindow.__streamChatDebug = [...(globalWindow.__streamChatDebug || []), entry].slice(-80);
}

export function useStreamChat(deps: StreamChatDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const { streamingContentRef } = deps;

  const setAiState = useCallback<StreamChatDeps["setAiState"]>((...args) => depsRef.current.setAiState(...args), []);
  const setAiProcessSteps = useCallback<NonNullable<StreamChatDeps["setAiProcessSteps"]>>((...args) => depsRef.current.setAiProcessSteps?.(...args), []);
  const getActiveConversationId = useCallback<NonNullable<StreamChatDeps["getActiveConversationId"]>>(() => depsRef.current.getActiveConversationId?.() ?? null, []);
  const setOptimisticMessages = useCallback<StreamChatDeps["setOptimisticMessages"]>((...args) => depsRef.current.setOptimisticMessages(...args), []);
  const onSendMessage = useCallback<StreamChatDeps["onSendMessage"]>((...args) => depsRef.current.onSendMessage(...args), []);
  const setStreamingContent = useCallback<StreamChatDeps["setStreamingContent"]>((...args) => depsRef.current.setStreamingContent(...args), []);


  const sessionsRef = useRef<Map<string, ConversationSession>>(new Map());
  const queueRef = useRef<Map<string, ConversationQueueEntry>>(new Map());
  const queueGenerationRef = useRef<Map<string, number>>(new Map());
  const lastStartedConversationRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const nextMessageIdRef = useRef<string | null>(null);

  const getSession = useCallback((conversationId: string): ConversationSession => {
    const existing = sessionsRef.current.get(conversationId);
    if (existing) return existing;
    const created = createSession();
    sessionsRef.current.set(conversationId, created);
    return created;
  }, []);

  const resetProcessSteps = useCallback((conversationId: string, session?: ConversationSession) => {
    const activeSession = session || getSession(conversationId);
    setAiProcessSteps?.(
      activeSession.queueDepth > 0
        ? [{ id: "conversation-queue", title: "En cola", status: "active" as const }]
        : [],
      conversationId,
    );
  }, [getSession, setAiProcessSteps]);

  const acquireConversationQueueTicket = useCallback(
    async (
      conversationId: string,
      queueMode: "queue" | "replace" | "reject",
      signal?: AbortSignal,
    ): Promise<ConversationQueueTicket> => {
      const session = getSession(conversationId);
      const existingEntry = queueRef.current.get(conversationId);
      const hasPendingWork = Boolean(existingEntry || session.abortController);
      const queueStartedAt = Date.now();

      const clearQueueUi = () => {
        setAiProcessSteps?.((prev) => prev.filter((step) => step?.id !== "conversation-queue"), conversationId);
      };

      if (queueMode === "reject" && hasPendingWork) {
        throw new Error("Conversation already has a pending response");
      }

      if (queueMode === "replace") {
        clearQueueUi();
        const activeAbortController = session.abortController;
        if (activeAbortController) {
          activeAbortController.abort();
        }
        session.abortController = null;
        session.pendingRequestId = null;
        setAiState("idle", conversationId);
        resetProcessSteps(conversationId, session);
        queueRef.current.delete(conversationId);
        queueGenerationRef.current.set(
          conversationId,
          (queueGenerationRef.current.get(conversationId) || 0) + 1,
        );
        return { queued: false, release: () => {} };
      }

      if (hasPendingWork) {
        setAiState("queued", conversationId);
        setAiProcessSteps?.([
          {
            id: "conversation-queue",
            title: "En cola",
            description: "Esperando turno para enviar este mensaje",
            status: "active",
            startedAt: queueStartedAt,
            queuePosition: 1,
          },
        ], conversationId);
      }

      const generation = queueGenerationRef.current.get(conversationId) || 0;
      const previousTail = existingEntry?.tail || Promise.resolve();
      const entryId = generateRequestId();
      if (hasPendingWork) {
        session.queueDepth += 1;
      }
      let releaseTurn!: () => void;
      const ownTurn = new Promise<void>((resolve) => {
        releaseTurn = resolve;
      });

      queueRef.current.set(conversationId, {
        id: entryId,
        tail: previousTail.catch(() => undefined).then(() => ownTurn),
      });

      const release = () => {
        clearQueueUi();
        releaseTurn();
        const currentEntry = queueRef.current.get(conversationId);
        if (currentEntry?.id === entryId) {
          queueRef.current.delete(conversationId);
        }
      };

      try {
        if (signal?.aborted) {
          throw createAbortError("Request aborted before stream start");
        }

        await new Promise<void>((resolve, reject) => {
          let settled = false;
          let abortHandler: (() => void) | null = null;

          const finalize = (fn: () => void) => {
            if (settled) return;
            settled = true;
            if (signal && abortHandler) {
              signal.removeEventListener("abort", abortHandler);
            }
            fn();
          };

          if (signal) {
            abortHandler = () => finalize(() => reject(createAbortError("Request aborted before stream start")));
            signal.addEventListener("abort", abortHandler, { once: true });
          }

          previousTail.catch(() => undefined).then(() => finalize(resolve));
        });

        const currentGeneration = queueGenerationRef.current.get(conversationId) || 0;
        if (currentGeneration !== generation) {
          throw createAbortError("Conversation queue replaced by a newer request");
        }

        if (hasPendingWork) {
          session.queueDepth = Math.max(0, session.queueDepth - 1);
        }
        clearQueueUi();
        return { queued: hasPendingWork, release };
      } catch (error) {
        if (hasPendingWork) {
          session.queueDepth = Math.max(0, session.queueDepth - 1);
        }
        clearQueueUi();
        release();
        throw error;
      }
    },
    [getSession, setAiProcessSteps, setAiState]
  );

  const clearResilienceUi = useCallback((conversationId?: string | null) => {
    const targetConversationId = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!targetConversationId) return;

    setAiProcessSteps?.(
      (prev) => prev.filter((step) => step?.id !== "stream-reconnect" && step?.id !== "stream-recover"),
      targetConversationId,
    );
  }, [setAiProcessSteps]);

  const clearStreamingProgressRemote = useCallback(async (conversationId?: string | null) => {
    const targetConversationId = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!targetConversationId) return;

    try {
      await apiFetch(`/api/streaming/progress/${encodeURIComponent(targetConversationId)}`, {
        method: "DELETE",
        timeoutMs: 5000,
      });
    } catch (error) {
      console.warn("[useStreamChat] Failed to clear remote streaming progress:", error);
    }
  }, []);

  const isConversationActive = useCallback(
    (conversationId: string): boolean => {
      const activeConversationId = getActiveConversationId?.();
      if (!activeConversationId) return true;
      return activeConversationId === conversationId;
    },
    [getActiveConversationId]
  );

  const flushNow = useCallback(
    (conversationId: string) => {
      const session = getSession(conversationId);
      if (session.rafId !== null) {
        cancelAnimationFrame(session.rafId);
        session.rafId = null;
      }
      if (session.pendingContent !== null && isConversationActive(conversationId)) {
        streamingContentRef.current = session.pendingContent;
        setStreamingContent(session.pendingContent);
        session.pendingContent = null;
      }
    },
    [getSession, isConversationActive, setStreamingContent, streamingContentRef]
  );

  const scheduleFlush = useCallback(
    (conversationId: string) => {
      const session = getSession(conversationId);
      if (session.pendingContent === null || session.rafId !== null) return;

      // Throttle rendering to ~100ms intervals to reduce re-renders during fast streaming
      session.rafId = requestAnimationFrame(() => {
        session.rafId = null;
        if (session.pendingContent === null || !isConversationActive(conversationId)) return;
        const now = Date.now();
        const lastFlush = (session as any)._lastFlushMs || 0;
        if (now - lastFlush < 80) {
          // Too soon — schedule another RAF
          session.rafId = requestAnimationFrame(() => {
            session.rafId = null;
            if (session.pendingContent !== null && isConversationActive(conversationId)) {
              (session as any)._lastFlushMs = Date.now();
              streamingContentRef.current = session.pendingContent;
              setStreamingContent(session.pendingContent);
              session.pendingContent = null;
            }
          });
          return;
        }
        (session as any)._lastFlushMs = now;
        streamingContentRef.current = session.pendingContent;
        setStreamingContent(session.pendingContent);
        session.pendingContent = null;
      });
    },
    [getSession, isConversationActive, setStreamingContent, streamingContentRef]
  );

  const clearSessionRuntime = useCallback((conversationId: string) => {
    const session = getSession(conversationId);

    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
      session.timeoutId = null;
    }
    if (session.firstTokenTimeoutId) {
      clearTimeout(session.firstTokenTimeoutId);
      session.firstTokenTimeoutId = null;
    }
    if (session.doneTimeoutId) {
      clearTimeout(session.doneTimeoutId);
      session.doneTimeoutId = null;
    }
    if (session.contentTokenTimeoutId) {
      clearTimeout(session.contentTokenTimeoutId);
      session.contentTokenTimeoutId = null;
    }
    if (session.idleRecoveryTimeoutId) {
      clearTimeout(session.idleRecoveryTimeoutId);
      session.idleRecoveryTimeoutId = null;
    }

    if (session.rafId !== null) {
      cancelAnimationFrame(session.rafId);
      session.rafId = null;
    }

    session.pendingRequestId = null;
    session.serverAssistantMessageId = null;
    session.hydratingProgress = null;
  }, [getSession]);

  const abortConversation = useCallback(
    (conversationId: string) => {
      const session = getSession(conversationId);
      // Reset finalizing FIRST to prevent race with finalize() callback
      session.finalizing = false;
      if (session.abortController) {
        session.abortController.abort();
      }
      session.abortController = null;
      session.pendingContent = null;
      session.fullContent = "";
      clearSessionRuntime(conversationId);
      setAiState("idle", conversationId);
      void clearStreamingProgressRemote(conversationId);
    },
    [clearSessionRuntime, clearStreamingProgressRemote, getSession, setAiState]
  );

  const abort = useCallback(() => {
    const activeConversationId = getActiveConversationId?.() || lastStartedConversationRef.current;
    if (activeConversationId) {
      abortConversation(activeConversationId);
    } else if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Always clear streaming content so stale text never re-appears
    streamingContentRef.current = "";
    setStreamingContent("");
  }, [abortConversation, getActiveConversationId, setStreamingContent, streamingContentRef]);

  const finalize = useCallback(
    (message: Message, conversationId?: string | null, finalState: AIState = "idle") => {
      const targetConversationId =
        (conversationId && conversationId.trim()) ||
        getActiveConversationId?.() ||
        lastStartedConversationRef.current;

      const applyFinalState = (_state: AIState, targetId: string | null) => {
        // Always transition directly to idle to prevent the stop button from sticking.
        // The intermediate "done" state caused a visible flash where the button remained active.
        setAiState("idle", targetId);

        if (!targetId) return;

        const targetSession = getSession(targetId);
        if (targetSession.idleRecoveryTimeoutId) {
          clearTimeout(targetSession.idleRecoveryTimeoutId);
          targetSession.idleRecoveryTimeoutId = null;
        }

        // Aggressive stale-state recovery:
        // if no request is pending shortly after finalize, force non-terminal busy
        // states back to idle so "stop chat" and thinking indicators never stick.
        targetSession.idleRecoveryTimeoutId = setTimeout(() => {
          const latestSession = getSession(targetId);
          latestSession.idleRecoveryTimeoutId = null;
          if (latestSession.pendingRequestId) return;
          setAiState((prev) => (isBusyAiState(prev) ? "idle" : prev), targetId);
          setAiProcessSteps?.([], targetId);
        }, DEFAULT_IDLE_RECOVERY_MS);
      };

      if (!targetConversationId) {
        onSendMessage(message).catch((err) => {
          console.error("[useStreamChat] onSendMessage failed:", err);
        });
        streamingContentRef.current = "";
        setStreamingContent("");
        applyFinalState(finalState, targetConversationId);
        setAiProcessSteps?.([], targetConversationId);
        void clearStreamingProgressRemote(targetConversationId);
        return;
      }

      const session = getSession(targetConversationId);
      if (session.finalizing) return;
      session.finalizing = true;
      const serverAssistantMessageId = getServerAssistantMessageId(session);
      const shouldReuseServerAssistantMessage =
        message.role === "assistant" && !!serverAssistantMessageId;
      const finalizedMessage =
        shouldReuseServerAssistantMessage && serverAssistantMessageId
          ? {
              ...message,
              id: serverAssistantMessageId,
              clientTempId:
                (typeof message.clientTempId === "string" && message.clientTempId.trim()) ||
                (typeof message.id === "string" && message.id !== serverAssistantMessageId
                  ? message.id
                  : undefined),
            }
          : message;
      const finalizedRequestId =
        typeof finalizedMessage.requestId === "string" && finalizedMessage.requestId.trim()
          ? finalizedMessage.requestId.trim()
          : session.pendingRequestId;
      if (finalizedRequestId && session.lastFinalizedRequestId === finalizedRequestId) {
        session.finalizing = false;
        return;
      }
      if (finalizedRequestId) {
        session.lastFinalizedRequestId = finalizedRequestId;
      }

      flushNow(targetConversationId);

      // When the server already persisted the assistant message (shouldReuseServerAssistantMessage),
      // we only update the local optimistic display so the dedup pipeline can merge it.
      // Otherwise, call onSendMessage which handles both local state and server persistence.
      // Do NOT do both — that causes the message to appear in both sources → duplicates.
      if (shouldReuseServerAssistantMessage) {
        setOptimisticMessages((prev) => upsertMessageByIdentity(prev, finalizedMessage));
      } else {
        onSendMessage(finalizedMessage).catch((err) => {
          console.error("[useStreamChat] onSendMessage failed:", err);
        });
      }

      session.fullContent = "";
      session.pendingContent = null;
      session.pendingRequestId = null;

      if (isConversationActive(targetConversationId)) {
        streamingContentRef.current = "";
        setStreamingContent("");
      }

      applyFinalState(finalState, targetConversationId);
      setAiProcessSteps?.([], targetConversationId);
      void clearStreamingProgressRemote(targetConversationId);

      queueMicrotask(() => {
        const latestSession = getSession(targetConversationId);
        latestSession.finalizing = false;
      });
    },
    [
      flushNow,
      getActiveConversationId,
      getSession,
      isConversationActive,
      onSendMessage,
      clearStreamingProgressRemote,
      setAiProcessSteps,
      setAiState,
      setOptimisticMessages,
      setStreamingContent,
      streamingContentRef,
    ]
  );

  const hydrateStreamingProgress = useCallback(
    async (conversationId: string): Promise<void> => {
      const session = getSession(conversationId);
      if (session.hydratingProgress) {
        return session.hydratingProgress;
      }

      if (session.abortController || session.pendingRequestId || session.fullContent) {
        return;
      }

      let hydrationPromise: Promise<void> | null = null;
      hydrationPromise = (async () => {
        try {
          while (true) {
            const response = await apiFetch(`/api/streaming/progress/${encodeURIComponent(conversationId)}`, {
              method: "GET",
              timeoutMs: 6000,
            });

            if (response.status === 404) {
              return;
            }

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const progress = (await response.json().catch(() => null)) as RemoteStreamingProgress | null;
            if (!progress || typeof progress !== "object") {
              return;
            }

            const latestSession = getSession(conversationId);
            if (latestSession.hydratingProgress !== hydrationPromise) {
              return;
            }
            if (latestSession.abortController || latestSession.pendingRequestId || latestSession.fullContent) {
              return;
            }

            const restoredContent = typeof progress.content === "string" ? progress.content : "";
            const restoredMessageId =
              typeof progress.assistantMessageId === "string" && progress.assistantMessageId.trim()
                ? progress.assistantMessageId.trim()
                : latestSession.nextMessageId || `assistant-resume-${conversationId}`;
            const restoredRequestId =
              typeof progress.requestId === "string" && progress.requestId.trim()
                ? progress.requestId.trim()
                : null;

            latestSession.fullContent = restoredContent;
            latestSession.pendingContent = null;
            latestSession.nextMessageId = restoredMessageId;
            latestSession.serverAssistantMessageId = restoredMessageId;
            latestSession.pendingRequestId = restoredRequestId;

            if (isConversationActive(conversationId)) {
              setAiState("recovering", conversationId);
              setAiProcessSteps?.(
                [
                  {
                    id: "stream-recover",
                    title: "Recuperando respuesta",
                    description: restoredContent
                      ? "Reconectando con la respuesta que estaba en progreso"
                      : "Retomando la respuesta interrumpida",
                    status: "active",
                    startedAt: Date.now(),
                  },
                ],
                conversationId,
              );
              nextMessageIdRef.current = restoredMessageId;
              streamingContentRef.current = restoredContent;
              setStreamingContent(restoredContent);

              // Simulate a brief delay so the user perceives the reconnect jump
              setTimeout(() => {
                const current = getSession(conversationId);
                if (current.hydratingProgress !== hydrationPromise && !current.abortController) return;
                if (isConversationActive(conversationId)) {
                  clearResilienceUi(conversationId);
                  setAiState(restoredContent ? "responding" : "thinking", conversationId);
                }
              }, 800);
            }

            if (progress.status !== "streaming") {
              // Polling finished! The backend has marked the execution run as done or failed.
              if (progress.status === "completed") {
                clearResilienceUi(conversationId);
                const finalMsgId = restoredMessageId;
                const msg = buildAssistantMessage({
                  id: finalMsgId,
                  timestamp: new Date(),
                  requestId: restoredRequestId || `req_hydrated_${Date.now()}`,
                  content: restoredContent,
                  fallbackContent: "Respuesta recuperada.",
                }) as Message;
                finalize(msg, conversationId, "done");
              } else if (progress.status === "failed") {
                clearResilienceUi(conversationId);
                const errorMsgId = restoredMessageId;
                const errorMsg = {
                  id: errorMsgId,
                  role: "assistant" as const,
                  content: "Se interrumpió la generación en el servidor. Puedes intentar enviar tu mensaje nuevamente.",
                  timestamp: new Date(),
                  requestId: restoredRequestId || `req_hydrated_${Date.now()}`,
                };
                finalize(errorMsg, conversationId, "error");
              }
              await clearStreamingProgressRemote(conversationId);
              return;
            }

            await sleep(1500); // Poll every 1.5 seconds if still streaming
          }
        } catch (error) {
          console.warn("[useStreamChat] Failed to hydrate remote streaming progress:", error);
        } finally {
          const latestSession = getSession(conversationId);
          if (latestSession.hydratingProgress === hydrationPromise) {
            latestSession.hydratingProgress = null;
          }
        }
      })();

      session.hydratingProgress = hydrationPromise;
      return hydrationPromise;
    },
    [
      clearResilienceUi,
      clearStreamingProgressRemote,
      finalize,
      getSession,
      isConversationActive,
      setAiProcessSteps,
      setAiState,
      setStreamingContent,
      streamingContentRef,
    ]
  );

  const stream = useCallback(
    async (url: string, options: StreamOptions): Promise<StreamResult> => {
      const {
        body,
        chatId: rawChatId,
        signal,
        onEvent,
        onChunk,
        onAiStateChange,
        buildFinalMessage,
        buildErrorMessage,
        queueMode = "queue",
        timeoutMs = DEFAULT_STREAM_TIMEOUT_MS,
        firstTokenTimeoutMs = DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
        doneTimeoutMs = DEFAULT_DONE_TIMEOUT_MS,
        maxRetries = DEFAULT_MAX_RETRIES,
        retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
        retryJitterMs = DEFAULT_RETRY_JITTER_MS,
      } = options;

      const conversationId = normalizeConversationId(options);
      if (!conversationId) {
        const error = new Error("conversationId is required for isolated streaming");
        return { ok: false, content: "", error };
      }

      const scopedChatId = typeof rawChatId === "string" ? rawChatId.trim() : "";
      const bodyChatId = typeof body?.chatId === "string" ? body.chatId.trim() : "";

      const session = getSession(conversationId);

      const messageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      session.nextMessageId = messageId;
      session.serverAssistantMessageId = null;
      session.lastFinalizedRequestId = null;
      const baseRequestId =
        typeof body?.requestId === "string" && body.requestId.trim()
          ? body.requestId.trim()
          : generateRequestId();

      const buildAttemptRequestId = (attempt: number) => {
        if (attempt === 0) return baseRequestId;
        const withSuffix = `${baseRequestId}_retry${attempt}`;
        return withSuffix.length > 120 ? withSuffix.slice(0, 120) : withSuffix;
      };

      const normalizedMaxRetries =
        Number.isFinite(maxRetries) && Number(maxRetries) >= 0
          ? Math.floor(Number(maxRetries))
          : DEFAULT_MAX_RETRIES;

      const computeBackoff = (attemptIndex: number) => {
        const base = retryBackoffMs * Math.pow(2, attemptIndex);
        const jitter = retryJitterMs ? Math.floor(Math.random() * retryJitterMs) : 0;
        return Math.max(0, base + jitter);
      };

      const shouldRetry = (
        error: any,
        response?: Response,
        timeoutCause?: "overall" | "first-token" | "done" | null
      ) => {
        if (timeoutCause) return true;
        // Explicitly retryable errors (e.g. EMPTY_STREAM when server sent no content)
        if (error?.retryable === true) return true;
        if (error?.code === "EMPTY_STREAM") return true;
        const status = (error as any)?.status ?? response?.status;
        if (typeof status === "number") {
          if (status >= 500 || status === 429 || status === 408 || status === 504) return true;
          return false;
        }
        const msg = String(error?.message || "").toLowerCase();
        if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("timeout")) return true;
        return false;
      };

      let lastError: Error | undefined;
      let lastResponse: Response | undefined;
      let lastContent = "";

      const setRetryIndicator = (attemptNumber: number, retryDelayMs: number) => {
        const retryAfterSeconds = retryDelayMs > 0 ? Math.ceil(retryDelayMs / 1000) : 0;
        setAiState("reconnecting", conversationId);
        setAiProcessSteps?.((prev: any[]) => {
          const reconnectStep = {
            id: "stream-reconnect",
            step: "stream-reconnect",
            title: attemptNumber > 1
              ? `Reconectando... intento ${attemptNumber}`
              : "Reconectando...",
            description: retryDelayMs > 0
              ? `Reintentando en ${retryAfterSeconds}s`
              : "Reintentando ahora",
            status: "active",
            startedAt: Date.now(),
            retryAfterSeconds,
          };
          const withoutReconnect = prev.filter((step: any) => step?.id !== reconnectStep.id);
          return [...withoutReconnect, reconnectStep];
        }, conversationId);
      };

      let queueTicket: ConversationQueueTicket;
      try {
        queueTicket = await acquireConversationQueueTicket(conversationId, queueMode, signal);
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        return { ok: false, content: session.fullContent, error: normalizedError };
      }

      try {
        for (let attempt = 0; attempt <= normalizedMaxRetries; attempt++) {
            const streamRequestId = buildAttemptRequestId(attempt);
            const controller = new AbortController();
            abortControllerRef.current = controller;
            session.abortController = controller;
            lastStartedConversationRef.current = conversationId;

            const requestBody: Record<string, any> = {
              ...body,
              requestId: streamRequestId,
              conversationId,
              chatId: bodyChatId || scopedChatId || conversationId,
              queueMode,
            };

            const combinedSignal = signal
              ? AbortSignal.any?.([controller.signal, signal]) ?? controller.signal
              : controller.signal;

            session.pendingRequestId = streamRequestId;
            session.fullContent = "";
            session.pendingContent = null;
            session.finalizing = false;
            session.hydratingProgress = null;
            if (session.idleRecoveryTimeoutId) {
              clearTimeout(session.idleRecoveryTimeoutId);
              session.idleRecoveryTimeoutId = null;
            }

            if (isConversationActive(conversationId)) {
              nextMessageIdRef.current = messageId;
              streamingContentRef.current = "";
              setStreamingContent("");
            }

            const initialAiState = session.queueDepth > 0 ? "queued" : "thinking";
            setAiState(initialAiState, conversationId);
            onAiStateChange?.(initialAiState);
            resetProcessSteps(conversationId, session);

            let response: Response | undefined;
            let fullContent = "";
            let lastEventData: any = null;
            let timeoutCause: "overall" | "first-token" | "done" | null = null;
            let hasReceivedEvent = false;
            let hasReceivedToken = false;

            if (session.timeoutId) {
              clearTimeout(session.timeoutId);
            }
            session.timeoutId = setTimeout(() => {
              timeoutCause = "overall";
              controller.abort();
            }, timeoutMs);

            if (session.firstTokenTimeoutId) {
              clearTimeout(session.firstTokenTimeoutId);
            }
            if (firstTokenTimeoutMs > 0) {
              session.firstTokenTimeoutId = setTimeout(() => {
                if (!hasReceivedEvent && !session.finalizing && session.pendingRequestId === streamRequestId) {
                  timeoutCause = "first-token";
                  controller.abort();
                }
              }, firstTokenTimeoutMs);
            }

            if (session.doneTimeoutId) {
              clearTimeout(session.doneTimeoutId);
            }
            const armDoneTimeout = () => {
              if (doneTimeoutMs <= 0) return;
              if (session.doneTimeoutId) {
                clearTimeout(session.doneTimeoutId);
                session.doneTimeoutId = null;
              }
              session.doneTimeoutId = setTimeout(() => {
                if (!session.finalizing && session.pendingRequestId === streamRequestId && hasReceivedToken) {
                  timeoutCause = "done";
                  controller.abort();
                }
              }, doneTimeoutMs);
            };
            const clearTokenTimeouts = () => {
              if (session.firstTokenTimeoutId) {
                clearTimeout(session.firstTokenTimeoutId);
                session.firstTokenTimeoutId = null;
              }
              if (session.doneTimeoutId) {
                clearTimeout(session.doneTimeoutId);
                session.doneTimeoutId = null;
              }
              if (session.contentTokenTimeoutId) {
                clearTimeout(session.contentTokenTimeoutId);
                session.contentTokenTimeoutId = null;
              }
            };

            try {
              clearResilienceUi(conversationId);
              // Normalize optional array fields — never send null (breaks PARE schema validation)
              const cleanedBody = {
                ...requestBody,
                attachments: Array.isArray((requestBody as any).attachments) ? (requestBody as any).attachments : undefined,
                images: Array.isArray((requestBody as any).images) ? (requestBody as any).images : undefined,
              };

              response = await fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-request-id": streamRequestId,
                  ...getAnonUserIdHeader(),
                },
                credentials: "include",
                body: JSON.stringify(cleanedBody),
                signal: combinedSignal,
              });

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const retryAfterHeader = response.headers.get("Retry-After");
                const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
                const queuePositionHeader = response.headers.get("X-Chat-Queue-Position");
                const queuePosition = queuePositionHeader ? Number(queuePositionHeader) : undefined;
                const error = new Error(
                  response.status === 429 && Number.isFinite(retryAfter)
                    ? `El chat está ocupado. Reintenta en ${retryAfter}s.`
                    : errorData.error || errorData.message || `HTTP ${response.status}`
                );
                (error as any).status = response.status;
                if (Number.isFinite(retryAfter)) {
                  (error as any).retryAfter = retryAfter;
                }
                if (Number.isFinite(queuePosition)) {
                  (error as any).queuePosition = queuePosition;
                }
                throw error;
              }

              const contentType = response.headers.get("Content-Type") || "";
              if (contentType.includes("application/json")) {
                const jsonData = await response.json().catch(() => null);
                const status = jsonData?.status;

                if (status === "already_done" || status === "already_processing" || status === "claim_failed") {
                  session.fullContent = "";
                  session.pendingContent = null;
                  if (isConversationActive(conversationId)) {
                    streamingContentRef.current = "";
                    setStreamingContent("");
                  }
                  setAiState("idle", conversationId);
                  resetProcessSteps(conversationId, session);
                  return { ok: true, content: "", response };
                }

                const error = new Error(
                  jsonData?.error || jsonData?.message || `Unexpected JSON response (${status || "json"})`
                );
                (error as any).status = response.status;
                throw error;
              }

              const reader = response.body?.getReader();
              if (!reader) {
                throw new Error("No response body");
              }

              const responseAiState = session.queueDepth > 0 ? "queued" : "thinking";
              setAiState(responseAiState, conversationId);
              onAiStateChange?.(responseAiState);

              const decoder = new TextDecoder();
              let sseBuffer = "";
              let currentEventType = "chunk";
              let streamDone = false;
              let pendingTerminalError: Error | null = null;

              while (!streamDone) {
                if (combinedSignal.aborted) break;

                const { done, value } = await reader.read();
                if (done) break;

                sseBuffer += decoder.decode(value, { stream: true });
                const lines = sseBuffer.split("\n");
                sseBuffer = lines.pop() || "";

                for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed) continue;

                if (trimmed.startsWith("event: ")) {
                  currentEventType = trimmed.slice(7).trim();
                  continue;
                }

                if (trimmed.startsWith(":")) {
                  if (trimmed.includes("heartbeat")) {
                    if (!hasReceivedEvent) {
                      hasReceivedEvent = true;
                      if (session.firstTokenTimeoutId) {
                        clearTimeout(session.firstTokenTimeoutId);
                        session.firstTokenTimeoutId = null;
                      }
                      if (!hasReceivedToken && !session.contentTokenTimeoutId) {
                        session.contentTokenTimeoutId = setTimeout(() => {
                          if (!hasReceivedToken && !session.finalizing && session.pendingRequestId === streamRequestId) {
                            timeoutCause = "first-token";
                            controller.abort();
                          }
                        }, DEFAULT_CONTENT_TOKEN_TIMEOUT_MS);
                      }
                    }
                    onEvent?.("heartbeat", {
                      conversationId,
                      requestId: streamRequestId,
                    });
                  }
                  continue;
                }

                if (!trimmed.startsWith("data: ")) continue;

                  const dataStr = trimmed.slice(6);
                  if (dataStr === "[DONE]") {
                    streamDone = true;
                    break;
                  }

                  let data: any;
                  try {
                    data = JSON.parse(dataStr);
                  } catch (parseErr) {
                    console.warn("[Stream] Malformed SSE chunk:", dataStr.slice(0, 80));
                    continue;
                  }

                  if (!data || typeof data !== "object") continue;

                  const eventConversationId =
                    typeof data.conversationId === "string" ? data.conversationId.trim() : "";
                  if (!eventConversationId || eventConversationId !== conversationId) {
                    pushStreamDebug({
                      phase: "filter",
                      reason: "conversation_mismatch",
                      eventType: currentEventType,
                      expectedConversationId: conversationId,
                      eventConversationId: eventConversationId || null,
                    });
                    continue;
                  }

                  const eventRequestId = typeof data.requestId === "string" ? data.requestId.trim() : "";
                  const eventAssistantMessageId =
                    typeof data.assistantMessageId === "string" ? data.assistantMessageId.trim() : "";

                  if (!eventRequestId && !eventAssistantMessageId) {
                    pushStreamDebug({
                      phase: "filter",
                      reason: "missing_request_and_assistant_id",
                      eventType: currentEventType,
                      conversationId,
                    });
                    continue;
                  }

                  if (eventRequestId && eventRequestId !== streamRequestId) {
                    pushStreamDebug({
                      phase: "filter",
                      reason: "request_mismatch",
                      eventType: currentEventType,
                      conversationId,
                      expectedRequestId: streamRequestId,
                      eventRequestId,
                      eventAssistantMessageId: eventAssistantMessageId || null,
                    });
                    continue;
                  }

                  pushStreamDebug({
                    phase: "accepted",
                    eventType: currentEventType,
                    conversationId,
                    eventRequestId: eventRequestId || null,
                    eventAssistantMessageId: eventAssistantMessageId || null,
                  });

                  if (eventAssistantMessageId) {
                    session.serverAssistantMessageId = eventAssistantMessageId;
                  }

                  lastEventData = data;

                  if (!hasReceivedEvent) {
                    hasReceivedEvent = true;
                    if (session.firstTokenTimeoutId) {
                      clearTimeout(session.firstTokenTimeoutId);
                      session.firstTokenTimeoutId = null;
                    }
                    // Arm contentTokenTimeout: guards the gap between receiving any SSE
                    // event and the first content chunk. Without this, the spinner could
                    // stay visible for up to 5 min (overallTimeout) if no chunks arrive.
                    if (!hasReceivedToken && !session.contentTokenTimeoutId) {
                      session.contentTokenTimeoutId = setTimeout(() => {
                        if (!hasReceivedToken && !session.finalizing && session.pendingRequestId === streamRequestId) {
                          timeoutCause = "first-token";
                          controller.abort();
                        }
                      }, DEFAULT_CONTENT_TOKEN_TIMEOUT_MS);
                    }
                  }

                  const isStaleConversation = session.pendingRequestId !== streamRequestId;

                  setAiProcessSteps?.(
                    (prev: any[]) => prev.filter((step: any) => step?.id !== "stream-reconnect"),
                    conversationId
                  );

                  onEvent?.(currentEventType, data);

                  if (currentEventType === "chunk" || currentEventType === "text") {
                    const content = typeof data.content === "string" ? data.content : "";
                    if (content) {
                      if (!hasReceivedToken) {
                        hasReceivedToken = true;
                        if (session.firstTokenTimeoutId) {
                          clearTimeout(session.firstTokenTimeoutId);
                          session.firstTokenTimeoutId = null;
                        }
                        // Clear contentTokenTimeout — we got a real token
                        if (session.contentTokenTimeoutId) {
                          clearTimeout(session.contentTokenTimeoutId);
                          session.contentTokenTimeoutId = null;
                        }
                        if (!isStaleConversation) {
                          const tokenAiState = session.queueDepth > 0 ? "queued" : "responding";
                          setAiState(tokenAiState, conversationId);
                          onAiStateChange?.(tokenAiState);
                        }
                        armDoneTimeout();
                      } else {
                        // Re-arm on every chunk so it acts as an inactivity timer
                        armDoneTimeout();
                      }
                      fullContent += content;
                      session.fullContent = fullContent;
                      let shouldUpdateStreamingBuffer = true;
                      if (onChunk && isConversationActive(conversationId)) {
                        try {
                          shouldUpdateStreamingBuffer = onChunk(content, data, fullContent) !== false;
                        } catch (chunkError) {
                          console.error("[useStreamChat] onChunk handler failed:", chunkError);
                        }
                      }
                      if (shouldUpdateStreamingBuffer && isConversationActive(conversationId)) {
                        session.pendingContent = fullContent;
                        scheduleFlush(conversationId);
                      }
                    }
                  }

                  if (!isStaleConversation && currentEventType === "thinking") {
                    const thinkingAiState = session.queueDepth > 0 ? "queued" : "thinking";
                    setAiState(thinkingAiState, conversationId);
                    onAiStateChange?.(thinkingAiState);

                    if (data.step && data.message) {
                      setAiProcessSteps?.(
                        (prev: any[]) => {
                          const existing = prev.find((s: any) => s.id === data.step);
                          if (existing) return prev;
                          return [
                            ...prev,
                            {
                              id: data.step,
                              step: data.step,
                              title: data.message,
                              status: "pending",
                            },
                          ];
                        },
                        conversationId
                      );
                    }
                  }

                  if (!isStaleConversation && currentEventType === "context") {
                    const contextAiState = session.queueDepth > 0 ? "queued" : "responding";
                    setAiState(contextAiState, conversationId);
                    onAiStateChange?.(contextAiState);
                    setAiProcessSteps?.(
                      (prev: any[]) => prev.map((s: any) => ({ ...s, status: "done" })),
                      conversationId
                    );
                  }

                  if (!isStaleConversation && currentEventType === "production_start") {
                    setAiState("agent_working", conversationId);
                    onAiStateChange?.("agent_working");
                  }

                  // Skill Auto-Dispatcher events
                  if (!isStaleConversation && currentEventType === "skill_auto_start") {
                    setAiState("agent_working", conversationId);
                    onAiStateChange?.("agent_working");
                    const skillName = typeof data?.skillName === "string" ? data.skillName : "Skill";
                    setAiProcessSteps?.(
                      (prev: any[]) => [
                        ...prev,
                        {
                          id: `skill-${data?.skillId || Date.now()}`,
                          step: "skill_execution",
                          title: `Ejecutando ${skillName}...`,
                          message: `Generando resultado profesional con ${skillName}`,
                          status: "active",
                        },
                      ],
                      conversationId
                    );
                  }

                  if (!isStaleConversation && currentEventType === "skill_auto_complete") {
                    setAiProcessSteps?.(
                      (prev: any[]) =>
                        prev.map((s: any) =>
                          s.step === "skill_execution"
                            ? { ...s, status: "done", title: `${data?.skillName || "Skill"} completado` }
                            : s
                        ),
                      conversationId
                    );
                  }

                  // Handle artifact events (from skill dispatcher and production pipeline)
                  if (!isStaleConversation && currentEventType === "artifact" && data?.downloadUrl) {
                    onEvent?.(currentEventType, data);
                  }

                  // Handle agentic step events (real-time tool execution visualization)
                  if (!isStaleConversation && currentEventType === "step" && data?.step) {
                    onEvent?.("step", data.step);
                  }

                  if (!isStaleConversation && currentEventType === "task_spawned") {
                    setAiState("agent_working", conversationId);
                    onAiStateChange?.("agent_working");

                    const taskId = typeof data?.taskId === "string" ? data.taskId.trim() : "";
                    const label =
                      typeof data?.label === "string" && data.label.trim()
                        ? data.label.trim()
                        : typeof data?.metadata?.label === "string" && data.metadata.label.trim()
                          ? data.metadata.label.trim()
                          : taskId
                            ? `Task ${taskId}`
                            : "Background task";

                    setAiProcessSteps?.(
                      (prev: any[]) => {
                        const stepId = taskId ? `bg-task-${taskId}` : `bg-task-${Date.now()}`;
                        const exists = prev.find((s: any) => s.id === stepId);
                        const nextStep = {
                          id: stepId,
                          step: stepId,
                          title: `${label} en segundo plano`,
                          message: `${label} continúa ejecutándose mientras puedes seguir usando otros chats.`,
                          status: "active",
                        };
                        if (exists) {
                          return prev.map((s: any) => (s.id === stepId ? { ...s, ...nextStep } : s));
                        }
                        return [...prev, nextStep];
                      },
                      conversationId
                    );
                  }

                  if (!isStaleConversation && (currentEventType === "tool_status" || currentEventType === "tool_start" || currentEventType === "tool_result")) {
                    onEvent?.(currentEventType, data);
                  }

                  if (currentEventType === "done" || currentEventType === "finish") {
                    clearTokenTimeouts();
                    streamDone = true;
                    flushNow(conversationId);

                    if (pendingTerminalError || data.error === true) {
                      const terminalError =
                        pendingTerminalError ??
                        new Error(
                          typeof data.error === "string" && data.error.trim()
                            ? data.error
                            : "Stream error"
                        );
                      lastError = terminalError;
                      lastResponse = response;
                      lastContent = fullContent;

                      const errorMsg = buildErrorMessage?.(terminalError, messageId) ?? {
                        id: messageId,
                        role: "assistant" as const,
                        content: terminalError.message || "Error de conexión. Por favor, intenta de nuevo.",
                        timestamp: new Date(),
                        requestId: data.requestId || streamRequestId,
                      };

                      if (!session.finalizing) {
                        finalize(errorMsg, conversationId, "error");
                      }

                      return { ok: false, content: fullContent, message: errorMsg, response, error: terminalError };
                    }

                    const terminalContent = fullContent || getDoneEventContent(data);

                    // If done arrived but no content was received, throw a retryable error.
                    // The catch block below will auto-retry (up to normalizedMaxRetries times).
                    // This handles cases where SSE events lacked IDs and were silently filtered.
                    if (!terminalContent) {
                      console.warn("[useStreamChat] Done received with no content — treating as retryable empty stream");
                      const emptyStreamError = new Error("No se recibió respuesta del servidor.");
                      (emptyStreamError as any).retryable = true;
                      (emptyStreamError as any).code = "EMPTY_STREAM";
                      throw emptyStreamError;
                    }

                    // Prefer the server-persisted ID to avoid duplicate POSTs
                    const finalMessageId = (typeof data.assistantMessageId === "string" && data.assistantMessageId.trim())
                      ? data.assistantMessageId.trim()
                      : messageId;
                    const isServerPersisted = finalMessageId !== messageId;

                    const msg = (buildFinalMessage?.(fullContent, data, finalMessageId) ?? buildAssistantMessage({
                      id: finalMessageId,
                      timestamp: new Date(),
                      requestId: data.requestId || streamRequestId,
                      content: terminalContent,
                      artifact: data.artifact,
                      webSources: data.webSources,
                      searchQueries: data.searchQueries,
                      totalSearches: data.totalSearches,
                      followUpSuggestions: data.followUpSuggestions,
                      confidence: data.confidence,
                      uncertaintyReason: data.uncertaintyReason,
                      retrievalSteps: data.retrievalSteps,
                      steps: data.steps,
                    })) as Message;

                    if (isServerPersisted) {
                      (msg as any).serverPersisted = true;
                      // Preserve the original client-generated messageId so finalize
                      // can set it as clientTempId for identity-dedup matching.
                      if (!msg.clientTempId) {
                        (msg as any).clientTempId = messageId;
                      }
                    }

                    finalize(msg, conversationId, "done");
                    return { ok: true, content: terminalContent, message: msg, response };
                  }

                  if (currentEventType === "error" || currentEventType === "production_error") {
                    const rawError: any = data.message ?? data.error ?? "Stream error";
                    let errorMsg: string;
                    if (typeof rawError === "string") {
                      errorMsg = rawError;
                    } else if (rawError && typeof rawError === "object") {
                      // Handle structured error payloads like
                      // { code: "RATE_LIMIT", message: "...", retryAfterMs: 4046 }
                      errorMsg =
                        (typeof rawError.message === "string" && rawError.message) ||
                        (typeof rawError.error === "string" && rawError.error) ||
                        (typeof rawError.code === "string" && rawError.code) ||
                        (() => {
                          try {
                            return JSON.stringify(rawError);
                          } catch {
                            return "Stream error";
                          }
                        })();
                    } else {
                      errorMsg = String(rawError ?? "Stream error");
                    }
                    const terminalError = new Error(errorMsg);
                    // Preserve structured payload for callers that want to react
                    // to error codes (e.g. RATE_LIMIT) instead of a plain string.
                    if (rawError && typeof rawError === "object") {
                      (terminalError as any).payload = rawError;
                      if (typeof (rawError as any).code === "string") {
                        (terminalError as any).code = (rawError as any).code;
                      }
                    }
                    pendingTerminalError = terminalError;
                    if (!isStaleConversation) {
                      setAiState("error", conversationId);
                      onAiStateChange?.("error");
                    }
                    continue;
                  }
                }
              }

              if (pendingTerminalError) {
                throw pendingTerminalError;
              }

              const terminalContent = fullContent || getDoneEventContent(lastEventData);

              if (!session.finalizing && terminalContent) {
                clearTokenTimeouts();
                flushNow(conversationId);
                const msg = (buildFinalMessage?.(terminalContent, lastEventData, messageId) ?? buildAssistantMessage({
                  id: messageId,
                  timestamp: new Date(),
                  requestId: streamRequestId,
                  content: terminalContent,
                  artifact: lastEventData?.artifact,
                  webSources: lastEventData?.webSources,
                  searchQueries: lastEventData?.searchQueries,
                  totalSearches: lastEventData?.totalSearches,
                  followUpSuggestions: lastEventData?.followUpSuggestions,
                  confidence: lastEventData?.confidence,
                  uncertaintyReason: lastEventData?.uncertaintyReason,
                  retrievalSteps: lastEventData?.retrievalSteps,
                  steps: lastEventData?.steps,
                })) as Message;

                finalize(msg, conversationId, "done");
                return { ok: true, content: terminalContent, message: msg, response };
              }

              if (!session.finalizing) {
                clearTokenTimeouts();
                // Stream ended without a done event and without content.
                // Create a retryable error so the retry logic (below) can
                // attempt the request again before showing any message.
                const emptyStreamError = new Error("No se recibió respuesta del servidor.");
                (emptyStreamError as any).retryable = true;
                (emptyStreamError as any).code = "EMPTY_STREAM";
                throw emptyStreamError;
              }

              return { ok: true, content: fullContent, response };
            } catch (err: any) {
              if (err?.name === "AbortError") {
                clearTokenTimeouts();

                if (!timeoutCause) {
                  if (isConversationActive(conversationId)) {
                    streamingContentRef.current = "";
                    setStreamingContent("");
                  }
                  setAiState("idle", conversationId);
                  resetProcessSteps(conversationId, session);
                  return { ok: false, content: fullContent, response, error: err };
                }

                const abortMessage =
                  timeoutCause === "first-token"
                    ? `No se recibió ningún evento del servidor en ${firstTokenTimeoutMs}ms.`
                    : timeoutCause === "done"
                      ? `La respuesta demoró demasiado (>${doneTimeoutMs}ms).`
                      : `Stream timeout after ${timeoutMs}ms.`;

                const abortError = new Error(abortMessage);
                lastError = abortError;
                lastResponse = response;
                lastContent = fullContent;

                if (attempt < normalizedMaxRetries) {
                  const retryDelay = computeBackoff(attempt);
                  setRetryIndicator(attempt + 1, retryDelay);
                  await sleep(retryDelay);
                  continue;
                }

                const timeoutErrorMsg = buildErrorMessage?.(abortError, messageId) ?? {
                  id: messageId,
                  role: "assistant" as const,
                  content: abortMessage,
                  timestamp: new Date(),
                  requestId: streamRequestId,
                };
                finalize(timeoutErrorMsg, conversationId, "error");

                return { ok: false, content: fullContent, response, error: abortError };
              }

              const normalizedError = err instanceof Error ? err : new Error(String(err));
              console.error("[useStreamChat] Stream error:", normalizedError);

              const retryable = shouldRetry(normalizedError, response, timeoutCause);
              lastError = normalizedError;
              lastResponse = response;
              lastContent = fullContent;

              if (retryable && attempt < normalizedMaxRetries) {
                const retryDelay = computeBackoff(attempt);
                setRetryIndicator(attempt + 1, retryDelay);
                await sleep(retryDelay);
                continue;
              }

              clearResilienceUi(conversationId);
              const errorMsg = buildErrorMessage?.(normalizedError, messageId) ?? {
                id: messageId,
                role: "assistant" as const,
                content: normalizedError?.message || "Error de conexión. Por favor, intenta de nuevo.",
                timestamp: new Date(),
                requestId: streamRequestId,
              };

              if (!session.finalizing) {
                finalize(errorMsg, conversationId, "error");
              }

              return { ok: false, content: fullContent, message: errorMsg, response, error: normalizedError };
            } finally {
              clearResilienceUi(conversationId);
              if (session.abortController === controller) {
                session.abortController = null;
              }

              if (session.pendingRequestId === streamRequestId) {
                session.pendingRequestId = null;
              }

              if (session.timeoutId) {
                clearTimeout(session.timeoutId);
                session.timeoutId = null;
              }
              if (session.firstTokenTimeoutId) {
                clearTimeout(session.firstTokenTimeoutId);
                session.firstTokenTimeoutId = null;
              }
              if (session.doneTimeoutId) {
                clearTimeout(session.doneTimeoutId);
                session.doneTimeoutId = null;
              }
              if (session.contentTokenTimeoutId) {
                clearTimeout(session.contentTokenTimeoutId);
                session.contentTokenTimeoutId = null;
              }

              if (abortControllerRef.current === controller) {
                abortControllerRef.current = null;
              }
            }
        }

        if (lastError) {
          const errorMsg = buildErrorMessage?.(lastError, messageId) ?? {
            id: messageId,
            role: "assistant" as const,
            content: lastError.message || "Error de conexión. Por favor, intenta de nuevo.",
            timestamp: new Date(),
            requestId: baseRequestId,
          };
          finalize(errorMsg, conversationId, "error");
          return { ok: false, content: lastContent, message: errorMsg, response: lastResponse, error: lastError };
        }

        const fallbackError = new Error("Stream failed");
        return { ok: false, content: "", error: fallbackError };
      } finally {
        queueTicket.release();
      }
    },
    [
      acquireConversationQueueTicket,
      abortConversation,
      clearResilienceUi,
      finalize,
      flushNow,
      getSession,
      isConversationActive,
      scheduleFlush,
      setAiProcessSteps,
      setAiState,
    ]
  );

  useEffect(() => {
    return () => {
      for (const [, session] of sessionsRef.current.entries()) {
        if (session.abortController) {
          session.abortController.abort();
          session.abortController = null;
        }
        if (session.timeoutId) {
          clearTimeout(session.timeoutId);
          session.timeoutId = null;
        }
        if (session.firstTokenTimeoutId) {
          clearTimeout(session.firstTokenTimeoutId);
          session.firstTokenTimeoutId = null;
        }
        if (session.doneTimeoutId) {
          clearTimeout(session.doneTimeoutId);
          session.doneTimeoutId = null;
        }
        if (session.contentTokenTimeoutId) {
          clearTimeout(session.contentTokenTimeoutId);
          session.contentTokenTimeoutId = null;
        }
        if (session.idleRecoveryTimeoutId) {
          clearTimeout(session.idleRecoveryTimeoutId);
          session.idleRecoveryTimeoutId = null;
        }
        if (session.rafId !== null) {
          cancelAnimationFrame(session.rafId);
          session.rafId = null;
        }
        session.pendingRequestId = null;
        session.pendingContent = null;
        session.fullContent = "";
        session.finalizing = false;
        session.lastFinalizedRequestId = null;
        session.nextMessageId = null;
        session.serverAssistantMessageId = null;
        session.hydratingProgress = null;
      }
      sessionsRef.current.clear();
      abortControllerRef.current = null;
      nextMessageIdRef.current = null;
      streamingContentRef.current = "";
    };
  }, [streamingContentRef]);

  const getPendingRequestId = useCallback((conversationId: string): string | null => {
    return sessionsRef.current.get(conversationId)?.pendingRequestId || null;
  }, []);

  const synchronizeConversation = useCallback((conversationId: string | null | undefined) => {
    if (!conversationId) return;
    const session = getSession(conversationId);
    lastStartedConversationRef.current = conversationId;
    abortControllerRef.current = session.abortController;
  }, [getSession]);

  return {
    stream,
    abort,
    abortConversation,
    finalize,
    synchronizeConversation,
    getPendingRequestId,
    abortControllerRef,
    contentRef: streamingContentRef,
    nextMessageIdRef,
  };
}
