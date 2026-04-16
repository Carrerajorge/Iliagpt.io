import { useState, useEffect, useRef, memo } from "react";
import { cn } from "@/lib/utils";

interface TypingEffectProps {
  text: string;
  speed?: number;
  className?: string;
  onComplete?: () => void;
  isStreaming?: boolean;
}

export const TypingEffect = memo(function TypingEffect({
  text,
  speed = 15,
  className,
  onComplete,
  isStreaming = false,
}: TypingEffectProps) {
  const [displayedText, setDisplayedText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const previousTextRef = useRef(text);

  useEffect(() => {
    if (text !== previousTextRef.current) {
      if (text.startsWith(previousTextRef.current)) {
        previousTextRef.current = text;
      } else {
        setDisplayedText("");
        setCurrentIndex(0);
        previousTextRef.current = text;
      }
    }
  }, [text]);

  useEffect(() => {
    if (currentIndex < text.length) {
      const charsToAdd = isStreaming ? 3 : 1;
      const timeout = setTimeout(() => {
        const nextIndex = Math.min(currentIndex + charsToAdd, text.length);
        setDisplayedText(text.slice(0, nextIndex));
        setCurrentIndex(nextIndex);
      }, speed);

      return () => clearTimeout(timeout);
    } else if (currentIndex >= text.length && onComplete) {
      onComplete();
    }
  }, [currentIndex, text, speed, onComplete, isStreaming]);

  return (
    <span className={cn("", className)}>
      {displayedText}
      {currentIndex < text.length && (
        <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5" />
      )}
    </span>
  );
});

interface StreamingTextProps {
  content: string;
  isComplete?: boolean;
  className?: string;
}

export const StreamingText = memo(function StreamingText({
  content,
  isComplete = false,
  className,
}: StreamingTextProps) {
  const [visibleLength, setVisibleLength] = useState(0);
  const previousLengthRef = useRef(0);

  useEffect(() => {
    if (content.length > previousLengthRef.current) {
      const newChars = content.length - previousLengthRef.current;
      const delay = Math.max(5, 50 / newChars);
      
      let current = previousLengthRef.current;
      const interval = setInterval(() => {
        current += Math.ceil(newChars / 10);
        if (current >= content.length) {
          current = content.length;
          clearInterval(interval);
        }
        setVisibleLength(current);
      }, delay);

      previousLengthRef.current = content.length;
      return () => clearInterval(interval);
    }
  }, [content]);

  useEffect(() => {
    if (isComplete) {
      setVisibleLength(content.length);
    }
  }, [isComplete, content.length]);

  return (
    <span className={className}>
      {content.slice(0, visibleLength)}
      {!isComplete && visibleLength < content.length && (
        <span className="inline-block w-0.5 h-4 bg-primary/60 animate-pulse ml-0.5" />
      )}
    </span>
  );
});

export default TypingEffect;
