import { useState, useCallback, useRef } from 'react';
import { createPptStreamParser } from '@/lib/pptStreaming';

type PptParser = ReturnType<typeof createPptStreamParser>;

function safeCreateParser(): PptParser | null {
  try {
    return createPptStreamParser();
  } catch (err) {
    console.error("[usePptStreaming] Failed to create parser:", err);
    return null;
  }
}

export function usePptStreaming() {
  const [isStreaming, setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);
  // Lazy init: only create parser once (avoids calling factory on every render)
  const parserRef = useRef<PptParser | null>(null);
  if (parserRef.current === null) {
    parserRef.current = safeCreateParser();
  }

  const startStreaming = useCallback(() => {
    parserRef.current?.reset();
    isStreamingRef.current = true;
    setIsStreaming(true);
  }, []);

  const stopStreaming = useCallback(() => {
    parserRef.current?.flush();
    isStreamingRef.current = false;
    setIsStreaming(false);
  }, []);

  const processChunk = useCallback((chunk: string) => {
    if (isStreamingRef.current) {
      parserRef.current?.processChunk(chunk);
    }
  }, []);

  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    processChunk
  };
}
