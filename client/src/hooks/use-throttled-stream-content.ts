/**
 * useThrottledStreamContent - RAF-batched streaming content state.
 *
 * Problem: Every SSE chunk triggers a setState → re-render. With fast models
 * sending 50-100 chunks/second, this creates jank and wastes CPU.
 *
 * Solution: Accumulate chunks in a ref and flush to React state via
 * requestAnimationFrame, batching all chunks that arrive within a single
 * frame (~16ms) into one render. This gives smooth 60fps streaming.
 *
 * The ref always has the latest content for sync reads (abort handling, etc.)
 * while React state is updated at most once per frame.
 */

import { useState, useCallback, useRef, useEffect } from "react";

export interface ThrottledStreamState {
  /** React state — updated at most once per animation frame */
  displayContent: string;
  /** Ref — always has the absolute latest content */
  contentRef: React.MutableRefObject<string>;
  /** Replace full content */
  setContent: (content: string) => void;
  /** Append a chunk to the content */
  appendChunk: (chunk: string) => string;
  /** Clear everything */
  clear: () => void;
  /** Force an immediate flush from ref to state (for finalize) */
  flush: () => void;
}

export function useThrottledStreamContent(): ThrottledStreamState {
  const [displayContent, setDisplayContent] = useState("");
  const contentRef = useRef("");
  const rafIdRef = useRef<number | null>(null);
  const isDirtyRef = useRef(false);

  // Schedule a RAF flush if not already pending
  const scheduleFlush = useCallback(() => {
    if (isDirtyRef.current && rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        isDirtyRef.current = false;
        setDisplayContent(contentRef.current);
      });
    }
  }, []);

  const setContent = useCallback(
    (content: string) => {
      contentRef.current = content;
      isDirtyRef.current = true;
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const appendChunk = useCallback(
    (chunk: string): string => {
      contentRef.current += chunk;
      isDirtyRef.current = true;
      scheduleFlush();
      return contentRef.current;
    },
    [scheduleFlush]
  );

  const clear = useCallback(() => {
    contentRef.current = "";
    isDirtyRef.current = false;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setDisplayContent("");
  }, []);

  const flush = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    isDirtyRef.current = false;
    setDisplayContent(contentRef.current);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  return {
    displayContent,
    contentRef,
    setContent,
    appendChunk,
    clear,
    flush,
  };
}
