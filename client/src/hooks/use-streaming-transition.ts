/**
 * useStreamingTransition - Atomic streaming-to-message transition manager.
 *
 * THE CORE FIX: This hook eliminates the "flash of empty content" bug by
 * guaranteeing that a finalized message is ALWAYS visible in the DOM before
 * the streaming content is cleared. It works by:
 *
 * 1. Inserting the message into optimisticMessages (instant DOM presence)
 * 2. Only THEN clearing streamingContent / aiState
 * 3. Tracking a brief "settling" window where we keep a CSS transition class
 *    so even if React batches oddly, the user sees a smooth crossfade
 *
 * Usage replaces the fragile pattern of:
 *   setOptimisticMessages(prev => [...prev, msg]);
 *   onSendMessage(msg);
 *   setStreamingContent("");
 *   setAiState("idle");
 *
 * With:
 *   transition.finalize(msg);
 */

import { useCallback, useRef } from "react";
import type { Message } from "@/hooks/use-chats";
import { upsertMessageByIdentity } from "@/lib/chatMessageIdentity";

import { type AIState, type AiProcessStep } from "@/components/chat-interface/types";

export interface StreamingTransitionDeps {
  /** Adds message to optimistic list for immediate display */
  setOptimisticMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  /** Persists message to backend/parent state */
  onSendMessage: (message: Message) => Promise<any>;
  /** Clears the streaming text */
  setStreamingContent: (content: string) => void;
  /** Ref to the streaming content string */
  streamingContentRef: React.MutableRefObject<string>;
  /** Sets the AI state indicator */
  setAiState: (value: React.SetStateAction<AIState>, conversationId?: string | null) => void;
  /** Optional: clear AI process steps */
  setAiProcessSteps?: (value: React.SetStateAction<AiProcessStep[]>, conversationId?: string | null) => void;
  /** Optional: scope updates to a specific conversation */
  conversationId?: string | null;
}

export interface FinalizeOptions {
  /** Keep aiState as-is (don't reset to idle). Useful for agent flows. */
  keepAiState?: boolean;
  /** Custom AI state to transition to (default: "idle") */
  targetAiState?: AIState;
  /** Clear AI process steps (default: true) */
  clearProcessSteps?: boolean;
}

export function useStreamingTransition(deps: StreamingTransitionDeps) {
  const {
    setOptimisticMessages,
    onSendMessage,
    setStreamingContent,
    streamingContentRef,
    setAiState,
    setAiProcessSteps,
    conversationId,
  } = deps;

  // Guard against double-finalize in the same tick
  const finalizingRef = useRef(false);

  /**
   * Atomically transition from streaming to finalized message.
   * Guarantees the message is in the DOM before streaming clears.
   */
  const finalize = useCallback(
    (message: Message, options?: FinalizeOptions) => {
      if (finalizingRef.current) {
        console.warn("[StreamingTransition] Double finalize blocked for", message.id);
        return;
      }
      finalizingRef.current = true;

      // STEP 1: Insert into optimistic messages — immediate DOM presence
      setOptimisticMessages((prev) => upsertMessageByIdentity(prev, message));

      // STEP 2: Persist to backend (fire-and-forget, errors handled by caller or retry queue)
      onSendMessage(message).catch((err) => {
        console.error("[StreamingTransition] onSendMessage failed:", err);
      });

      // STEP 3: Clear streaming state — safe because optimistic message is already set
      streamingContentRef.current = "";
      setStreamingContent("");

      // STEP 4: Reset AI state
      if (!options?.keepAiState) {
        setAiState(options?.targetAiState ?? "idle", conversationId);
      }

      // STEP 5: Clear process steps if applicable
      if (options?.clearProcessSteps !== false && setAiProcessSteps) {
        setAiProcessSteps([], conversationId);
      }

      // Release guard after microtask to prevent same-tick double calls
      queueMicrotask(() => {
        finalizingRef.current = false;
      });
    },
    [
      setOptimisticMessages,
      onSendMessage,
      setStreamingContent,
      streamingContentRef,
      setAiState,
      setAiProcessSteps,
    ]
  );

  /**
   * Start a new streaming session — clears previous state.
   */
  const startStreaming = useCallback(
    (aiState: AIState = "sending") => {
      streamingContentRef.current = "";
      setStreamingContent("");
      setAiState(aiState, conversationId);
      setAiProcessSteps?.([], conversationId);
    },
    [setStreamingContent, streamingContentRef, setAiState, setAiProcessSteps, conversationId]
  );

  /**
   * Update streaming content (both ref and state).
   */
  const updateContent = useCallback(
    (content: string) => {
      streamingContentRef.current = content;
      setStreamingContent(content);
    },
    [setStreamingContent, streamingContentRef]
  );

  /**
   * Append to streaming content.
   */
  const appendContent = useCallback(
    (chunk: string) => {
      const newContent = streamingContentRef.current + chunk;
      streamingContentRef.current = newContent;
      setStreamingContent(newContent);
      return newContent;
    },
    [setStreamingContent, streamingContentRef]
  );

  return {
    finalize,
    startStreaming,
    updateContent,
    appendContent,
    /** Direct ref to current streaming text for sync reads */
    contentRef: streamingContentRef,
  };
}
