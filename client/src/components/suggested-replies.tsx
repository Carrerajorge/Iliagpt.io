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
            "px-3 py-1.5 text-xs rounded-full",
            "bg-muted/60 hover:bg-muted border border-border/50",
            "text-muted-foreground hover:text-foreground",
            "transition-all duration-200 ease-in-out",
            "hover:shadow-sm hover:border-border",
            "whitespace-nowrap flex-shrink-0"
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
