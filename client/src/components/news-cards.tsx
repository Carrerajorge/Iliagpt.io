import React, { memo, useState, useRef, useCallback } from "react";
import { ExternalLink, Globe, ChevronRight, ChevronLeft, Copy, ThumbsUp, ThumbsDown, Share2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WebSource } from "@/hooks/use-chats";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { diffZonedDays, formatZonedDate, normalizeTimeZone, type PlatformDateFormat } from "@/lib/platformDateTime";

interface NewsCardsProps {
  sources: WebSource[];
  maxDisplay?: number;
  onRefresh?: () => void;
}

// Source logo mapping for known domains
const SOURCE_LOGOS: Record<string, string> = {
  "elpais.com": "https://logo.clearbit.com/elpais.com",
  "bbc.com": "https://logo.clearbit.com/bbc.com",
  "cnn.com": "https://logo.clearbit.com/cnn.com",
  "reuters.com": "https://logo.clearbit.com/reuters.com",
  "apnews.com": "https://logo.clearbit.com/apnews.com",
  "nytimes.com": "https://logo.clearbit.com/nytimes.com",
  "theguardian.com": "https://logo.clearbit.com/theguardian.com",
  "infobae.com": "https://logo.clearbit.com/infobae.com",
  "andina.pe": "https://logo.clearbit.com/andina.pe",
  "larepublica.pe": "https://logo.clearbit.com/larepublica.pe",
  "elcomercio.pe": "https://logo.clearbit.com/elcomercio.pe",
  "rpp.pe": "https://logo.clearbit.com/rpp.pe",
  "gestion.pe": "https://logo.clearbit.com/gestion.pe",
};

const getSourceLogo = (domain: string): string | null => {
  const cleanDomain = domain.replace(/^www\./, "").toLowerCase();
  return SOURCE_LOGOS[cleanDomain] || `https://logo.clearbit.com/${cleanDomain}`;
};

const getGradientForDomain = (domain: string): string => {
  const colors = [
    "from-blue-500 to-blue-700",
    "from-red-500 to-red-700",
    "from-green-500 to-green-700",
    "from-purple-500 to-purple-700",
    "from-orange-500 to-orange-700",
    "from-pink-500 to-pink-700",
    "from-cyan-500 to-cyan-700",
    "from-indigo-500 to-indigo-700",
  ];
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

const formatRelativeDate = (
  dateStr: string | undefined,
  opts: { timeZone: string; dateFormat: PlatformDateFormat }
): string => {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = diffZonedDays(date, now, opts.timeZone) ?? Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffHours < 1) return "hace unos minutos";
    if (diffHours < 24) return `hace ${diffHours}h`;
    if (diffDays === 1) return "ayer";
    if (diffDays < 7) return `hace ${diffDays} días`;
    return formatZonedDate(date, { timeZone: opts.timeZone, dateFormat: opts.dateFormat });
  } catch {
    return dateStr;
  }
};

// Individual news card component
const NewsCard = memo(function NewsCard({
  source,
  index,
  platformTimeZone,
  platformDateFormat,
}: {
  source: WebSource;
  index: number;
  platformTimeZone: string;
  platformDateFormat: PlatformDateFormat;
}) {
  const [imageError, setImageError] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const hasImage = source.imageUrl && !imageError;
  const domain = source.domain?.replace(/^www\./, "") || "unknown";
  const sourceLogo = !logoError ? getSourceLogo(domain) : null;

  return (
    <a
      href={source.canonicalUrl || source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-shrink-0 w-[280px] group cursor-pointer"
      data-testid={`news-card-${index}`}
      aria-label={`Leer: ${source.title || domain}`}
    >
      <div className="rounded-xl overflow-hidden border border-border bg-card hover:border-primary/50 transition-all duration-200 hover:shadow-lg h-full">
        {/* Image container with 16:9 aspect ratio */}
        <div className={cn(
          "relative overflow-hidden",
          "aspect-[16/9]",
          !hasImage && "bg-gradient-to-br",
          !hasImage && getGradientForDomain(domain)
        )}>
          {hasImage ? (
            <img
              src={source.imageUrl}
              alt={source.title || domain}
              className="w-full h-full object-cover"
              onError={() => setImageError(true)}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-black/10" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-white/80 text-4xl font-bold uppercase">
                  {domain.slice(0, 2)}
                </span>
              </div>
            </>
          )}
          {/* External link indicator on hover */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="bg-black/50 backdrop-blur-sm rounded-full p-1.5">
              <ExternalLink className="w-3 h-3 text-white" />
            </div>
          </div>
        </div>
        
        {/* Card content */}
        <div className="p-3 space-y-2">
          {/* Source info with logo */}
          <div className="flex items-center gap-2">
            {sourceLogo ? (
              <img
                src={sourceLogo}
                alt={source.source?.name || domain}
                className="w-4 h-4 rounded-full object-contain bg-white"
                onError={() => setLogoError(true)}
                loading="lazy"
              />
            ) : source.favicon ? (
              <img
                src={source.favicon}
                alt={domain}
                className="w-4 h-4 rounded-full object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
            ) : (
              <div className={cn(
                "w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white bg-gradient-to-br",
                getGradientForDomain(domain)
              )}>
                {domain.slice(0, 2).toUpperCase()}
              </div>
            )}
            <span className="text-xs text-muted-foreground truncate flex-1">
              {source.source?.name || source.siteName || domain}
            </span>
            {source.date && (
              <span className="text-xs text-muted-foreground/70">
                {formatRelativeDate(source.date, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
              </span>
            )}
          </div>
          
          {/* Title */}
          <h4 className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-primary transition-colors min-h-[2.5rem]">
            {source.title || domain}
          </h4>
        </div>
      </div>
    </a>
  );
});

// Source badge component for the sources panel
const SourceBadge = memo(function SourceBadge({ 
  source, 
  onClick 
}: { 
  source: WebSource; 
  onClick?: () => void;
}) {
  const [logoError, setLogoError] = useState(false);
  const domain = source.domain?.replace(/^www\./, "") || "unknown";
  const sourceLogo = !logoError ? getSourceLogo(domain) : null;
  const name = source.source?.name || source.siteName || domain;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => {
              e.preventDefault();
              onClick?.();
              window.open(source.url, "_blank", "noopener,noreferrer");
            }}
            className="w-6 h-6 rounded-full border border-border bg-background hover:border-primary hover:scale-110 transition-all flex items-center justify-center overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary/50"
            aria-label={`Ver noticias de ${name}`}
          >
            {sourceLogo ? (
              <img
                src={sourceLogo}
                alt={name}
                className="w-full h-full object-cover"
                onError={() => setLogoError(true)}
                loading="lazy"
              />
            ) : (
              <span className={cn(
                "w-full h-full flex items-center justify-center text-[8px] font-bold text-white bg-gradient-to-br",
                getGradientForDomain(domain)
              )}>
                {domain.slice(0, 2).toUpperCase()}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {name}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

// Sources panel component (appears on the right)
const SourcesPanel = memo(function SourcesPanel({ 
  sources, 
  isOpen, 
  onClose 
}: { 
  sources: WebSource[]; 
  isOpen: boolean; 
  onClose: () => void;
}) {
  if (!isOpen) return null;

  // Get unique sources by domain
  const uniqueSources = sources.reduce((acc, source) => {
    const domain = source.domain?.replace(/^www\./, "") || "unknown";
    if (!acc.find(s => s.domain?.replace(/^www\./, "") === domain)) {
      acc.push(source);
    }
    return acc;
  }, [] as WebSource[]);

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-background border-l border-border shadow-xl z-50 overflow-y-auto animate-in slide-in-from-right duration-300">
      <div className="sticky top-0 bg-background border-b border-border p-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Fuentes</h3>
          <p className="text-xs text-muted-foreground">
            {sources.length} resultados / {uniqueSources.length} fuentes
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      
      <div className="p-4 space-y-3">
        {uniqueSources.map((source, idx) => {
          const domain = source.domain?.replace(/^www\./, "") || "unknown";
          const name = source.source?.name || source.siteName || domain;
          const count = sources.filter(s => s.domain?.replace(/^www\./, "") === domain).length;
          
          return (
            <a
              key={`source-panel-${idx}`}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-all group"
            >
              <SourceBadge source={source} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium group-hover:text-primary transition-colors">
                  {name}
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  ({count} {count === 1 ? "artículo" : "artículos"})
                </span>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
          );
        })}
      </div>
    </div>
  );
});

// Main NewsCards component
export const NewsCards = memo(function NewsCards({ sources, maxDisplay = 8, onRefresh }: NewsCardsProps) {
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const [showSourcesPanel, setShowSourcesPanel] = useState(false);

  const updateScrollState = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
    }
  }, []);

  const scroll = useCallback((direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 300;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
      setTimeout(updateScrollState, 300);
    }
  }, [updateScrollState]);

  if (!sources || sources.length === 0) return null;

  const displaySources = sources.slice(0, maxDisplay);
  
  // Get unique sources for the badges
  const uniqueSources = sources.reduce((acc, source) => {
    const domain = source.domain?.replace(/^www\./, "") || "unknown";
    if (!acc.find(s => s.domain?.replace(/^www\./, "") === domain)) {
      acc.push(source);
    }
    return acc;
  }, [] as WebSource[]);

  return (
    <>
      <div className="relative my-4" data-testid="news-cards-container">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-medium text-foreground">
            Noticias relacionadas
          </span>
          <span className="text-xs text-muted-foreground">
            ({sources.length} resultados)
          </span>
        </div>
        
        {/* Horizontal scrollable cards container */}
        <div className="relative group">
          {/* Left scroll button */}
          {canScrollLeft && (
            <button
              onClick={() => scroll('left')}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-background/95 border border-border shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent -ml-5"
              aria-label="Scroll left"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          
          {/* Cards container */}
          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 px-1"
            onScroll={updateScrollState}
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {displaySources.map((source, idx) => (
              <NewsCard
                key={`${source.url}-${idx}`}
                source={source}
                index={idx}
                platformTimeZone={platformTimeZone}
                platformDateFormat={platformDateFormat}
              />
            ))}
          </div>
          
          {/* Right scroll button */}
          {canScrollRight && displaySources.length > 2 && (
            <button
              onClick={() => scroll('right')}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-background/95 border border-border shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent -mr-5"
              aria-label="Scroll right"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* News summary with direct links */}
        <div className="mt-3 space-y-1.5">
          {displaySources.map((source, idx) => {
            const domain = source.domain?.replace(/^www\./, "") || "";
            return (
              <a
                key={`summary-${idx}`}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors group text-left"
              >
                <img
                  src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                  alt=""
                  className="w-4 h-4 rounded-full mt-0.5 flex-shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors min-w-0">
                      {source.title || domain}
                    </span>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 text-sm leading-none hover:scale-110 transition-transform"
                      title={source.url}
                      onClick={(e) => e.stopPropagation()}
                    >🔗</a>
                  </div>
                  {source.snippet && (
                    <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                      {source.snippet}
                    </p>
                  )}
                  <span className="text-[10px] text-muted-foreground/60">
                    {domain}
                    {source.date && ` · ${formatRelativeDate(source.date, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}`}
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      </div>

      {/* Sources panel overlay */}
      {showSourcesPanel && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowSourcesPanel(false)}
          />
          <SourcesPanel 
            sources={sources} 
            isOpen={showSourcesPanel} 
            onClose={() => setShowSourcesPanel(false)} 
          />
        </>
      )}
    </>
  );
});

// Legacy SourcesList component for backwards compatibility
export const SourcesList = memo(function SourcesList({ sources }: { sources: WebSource[] }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="space-y-3 my-4" data-testid="sources-list">
      {sources.map((source, idx) => (
        <a
          key={`${source.url}-${idx}`}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-all group"
          data-testid={`source-item-${idx}`}
        >
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
            {source.favicon ? (
              <img
                src={source.favicon}
                alt={source.domain}
                className="w-6 h-6 object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.onerror = null;
                  target.src = '';
                  target.style.display = 'none';
                }}
              />
            ) : (
              <Globe className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted-foreground">{source.domain}</span>
              {source.date && (
                <>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground">{source.date}</span>
                </>
              )}
            </div>
            <h4 className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-1">
              {source.title || source.url}
            </h4>
            {source.snippet && (
              <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                {source.snippet}
              </p>
            )}
          </div>
          
          <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </a>
      ))}
    </div>
  );
});
