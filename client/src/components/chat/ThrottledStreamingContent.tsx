/**
 * ThrottledStreamingContent — renders streaming markdown with throttled updates
 * to prevent UI palpitation. Updates the visible content at most every 150ms
 * during streaming, then renders the final content immediately when streaming stops.
 */

import React, { useState, useEffect, useRef, memo } from "react";
import { MarkdownRenderer, MarkdownErrorBoundary } from "@/components/markdown-renderer";

interface Props {
  content: string;
  isStreaming: boolean;
  customComponents?: Record<string, React.ComponentType<any>>;
}

const THROTTLE_MS = 150;

export const ThrottledStreamingContent = memo(function ThrottledStreamingContent({
  content,
  isStreaming,
  customComponents,
}: Props) {
  const [visibleContent, setVisibleContent] = useState(content);
  const lastUpdateRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef(content);

  // Always track latest content
  latestContentRef.current = content;

  useEffect(() => {
    if (!isStreaming) {
      // Not streaming — show final content immediately
      if (pendingRef.current) clearTimeout(pendingRef.current);
      setVisibleContent(content);
      return;
    }

    // Streaming — throttle updates
    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;

    if (elapsed >= THROTTLE_MS) {
      // Enough time passed — update now
      lastUpdateRef.current = now;
      setVisibleContent(content);
    } else if (!pendingRef.current) {
      // Schedule update for remaining time
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        lastUpdateRef.current = Date.now();
        setVisibleContent(latestContentRef.current);
      }, THROTTLE_MS - elapsed);
    }

    return () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
    };
  }, [content, isStreaming]);

  if (!visibleContent) return null;

  return (
    <div className="animate-content-fade-in flex flex-col gap-2 w-full items-start min-w-0">
      <div className="prose dark:prose-invert max-w-none min-w-0">
        <MarkdownErrorBoundary fallbackContent={visibleContent}>
          <MarkdownRenderer
            content={visibleContent}
            customComponents={customComponents}
          />
        </MarkdownErrorBoundary>
        {isStreaming && <span className="typing-cursor">|</span>}
      </div>
    </div>
  );
});

export default ThrottledStreamingContent;
