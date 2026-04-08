import { memo } from "react";
import { cn } from "@/lib/utils";
import {
  buildFollowUpSuggestions,
  normalizeFollowUpSuggestions,
} from "@shared/followUpSuggestions";

interface SuggestedRepliesProps {
  suggestions: string[];
  onSelect: (text: string) => void;
}

export const SuggestedReplies = memo(function SuggestedReplies({
  suggestions,
  onSelect
}: SuggestedRepliesProps) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div 
      className="flex flex-wrap gap-2 overflow-x-auto scrollbar-hide"
      data-testid="suggested-replies-container"
    >
      {suggestions.slice(0, 4).map((suggestion, index) => (
        <button
          key={index}
          onClick={() => onSelect(suggestion)}
          className={cn(
            "px-3.5 py-2 text-[13px] rounded-xl",
            "bg-white dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/50",
            "text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white",
            "transition-all duration-150 ease-out",
            "hover:bg-zinc-50 dark:hover:bg-zinc-700/60 hover:border-zinc-300 dark:hover:border-zinc-600",
            "hover:shadow-sm active:scale-[0.98]",
            "whitespace-nowrap flex-shrink-0 cursor-pointer select-none"
          )}
          data-testid={`suggested-reply-${index}`}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
});

interface SuggestionOptions {
  preferred?: string[];
  userMessage?: string;
  hasWebSources?: boolean;
}

export function generateSuggestions(content: string, options: SuggestionOptions = {}): string[] {
  const preferred = normalizeFollowUpSuggestions(options.preferred);
  if (preferred.length > 0) {
    return preferred;
  }

  if (!content) return [];

  return buildFollowUpSuggestions({
    assistantContent: content,
    userMessage: options.userMessage,
    hasWebSources: options.hasWebSources,
  });
}
