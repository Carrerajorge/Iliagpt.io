import React, { memo } from "react";
import { Globe, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
    if (domain && !acc.includes(domain)) acc.push(domain);
    return acc;
  }, [] as string[]);

  const displayedSources = sources.slice(0, 5);
  const remainingCount = Math.max(0, uniqueDomains.length - displayedSources.length);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 gap-1.5 text-muted-foreground hover:text-foreground group"
          onClick={onViewSources}
          data-testid="button-sources"
        >
          <div className="flex items-center">
            {displayedSources.map((source, idx) => (
              <div
                key={`${source.domain}-${idx}`}
                className={cn(
                  "w-5 h-5 rounded-full bg-background border border-border overflow-hidden flex items-center justify-center shadow-sm",
                  idx > 0 && "-ml-2 ring-1 ring-background"
                )}
                style={{ zIndex: 10 - idx }}
              >
                {source.favicon ? (
                  <img
                    src={source.favicon}
                    alt={source.domain}
                    className="w-3.5 h-3.5 object-contain"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const fallback = target.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : (
                  <Globe className="w-2.5 h-2.5 text-muted-foreground" />
                )}
                <Globe className="w-2.5 h-2.5 text-muted-foreground hidden" />
              </div>
            ))}
            {remainingCount > 0 && (
              <div
                className="w-5 h-5 rounded-full bg-muted border border-border flex items-center justify-center text-[9px] font-medium text-muted-foreground -ml-2 ring-1 ring-background shadow-sm"
                style={{ zIndex: 4 }}
              >
                +{remainingCount}
              </div>
            )}
          </div>
          <span className="text-xs font-medium">{sources.length} fuentes</span>
          {totalSearches != null && totalSearches > 0 && (
            <span className="text-[10px] text-muted-foreground/70">
              ({totalSearches} búsquedas)
            </span>
          )}
          <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>Ver {sources.length} fuentes de {uniqueDomains.length} sitios</p>
      </TooltipContent>
    </Tooltip>
  );
});
