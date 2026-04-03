import React, { memo } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WebSource } from "@/hooks/use-chats";

interface SourcesIndicatorProps {
  sources: WebSource[];
  onViewSources: () => void;
  totalSearches?: number;
}

export const SourcesIndicator = memo(function SourcesIndicator({
  sources,
  onViewSources,
  totalSearches,
}: SourcesIndicatorProps) {
  if (!sources || sources.length === 0) return null;

  const uniqueDomains = sources.reduce((acc, s) => {
    const domain = s.domain?.replace(/^www\./, "") || "";
    if (domain && !acc.find(x => x.domain?.replace(/^www\./, "") === domain)) acc.push(s);
    return acc;
  }, [] as WebSource[]);

  const displayLogos = uniqueDomains.slice(0, 4);

  return (
    <button
      onClick={onViewSources}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/60 hover:bg-muted border border-border/40 hover:border-border/70 transition-all cursor-pointer group"
      data-testid="button-sources"
    >
      <div className="flex items-center" style={{ marginRight: displayLogos.length > 1 ? `${(displayLogos.length - 1) * 4}px` : 0 }}>
        {displayLogos.map((source, idx) => {
          const domain = source.domain?.replace(/^www\./, "") || "";
          return (
            <div
              key={`${domain}-${idx}`}
              className={cn(
                "w-6 h-6 rounded-full bg-white dark:bg-zinc-800 border-2 border-white dark:border-zinc-800 overflow-hidden flex items-center justify-center shadow-sm",
                idx > 0 && "-ml-2.5"
              )}
              style={{ zIndex: displayLogos.length - idx }}
            >
              <img
                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
                alt={domain}
                className="w-4 h-4 rounded-full object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const fallback = target.nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
              <Globe className="w-3 h-3 text-muted-foreground hidden items-center justify-center" />
            </div>
          );
        })}
      </div>
      <span className="text-sm font-semibold text-foreground/80 group-hover:text-foreground transition-colors whitespace-nowrap">
        {sources.length} sources
      </span>
    </button>
  );
});
