import React, { memo, useState, useRef, useCallback } from "react";
import { ExternalLink, Globe, ChevronRight, ChevronLeft, GraduationCap, FileText, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WebSource } from "@/hooks/use-chats";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { diffZonedDays, formatZonedDate, normalizeTimeZone, type PlatformDateFormat } from "@/lib/platformDateTime";
import { SourcesPanel } from "@/components/sources-panel";

interface NewsCardsProps {
  sources: WebSource[];
  maxDisplay?: number;
  onRefresh?: () => void;
  searchLabel?: string;
  searchQueries?: Array<{ query: string; resultCount: number; status: string }>;
  totalSearches?: number;
}

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
  "scholar.google.com": "https://logo.clearbit.com/scholar.google.com",
  "pubmed.ncbi.nlm.nih.gov": "https://logo.clearbit.com/pubmed.gov",
  "scielo.org": "https://logo.clearbit.com/scielo.org",
  "jstor.org": "https://logo.clearbit.com/jstor.org",
  "researchgate.net": "https://logo.clearbit.com/researchgate.net",
  "arxiv.org": "https://logo.clearbit.com/arxiv.org",
};

const ACADEMIC_DOMAINS = new Set([
  "scholar.google.com", "pubmed.ncbi.nlm.nih.gov", "scielo.org", "jstor.org",
  "researchgate.net", "arxiv.org", "doi.org", "scopus.com", "webofscience.com",
  "semanticscholar.org", "academia.edu", "springer.com", "wiley.com",
  "nature.com", "science.org", "ieee.org", "acm.org", "elsevier.com",
  "tandfonline.com", "sagepub.com", "nih.gov", "plos.org",
]);

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

const isAcademicSource = (source: WebSource): boolean => {
  const domain = (source.domain || "").replace(/^www\./, "").toLowerCase();
  return ACADEMIC_DOMAINS.has(domain) || 
    /\b(doi|issn|isbn|pmid|arxiv)\b/i.test(source.snippet || "") ||
    /\b(journal|peer.?review|abstract|methodology|findings)\b/i.test(source.snippet || "");
};

function inferSearchLabel(sources: WebSource[], explicitLabel?: string): string {
  if (explicitLabel) return explicitLabel;
  
  const academicCount = sources.filter(isAcademicSource).length;
  const totalSources = sources.length;
  
  if (academicCount > totalSources * 0.4) return "Artículos académicos encontrados";
  
  const newsKeywords = /\b(noticias?|news|breaking|última hora|today|hoy)\b/i;
  const hasNewsSources = sources.some(s => 
    newsKeywords.test(s.title || "") || newsKeywords.test(s.snippet || "")
  );
  if (hasNewsSources) return "Noticias encontradas";
  
  return "Resultados de búsqueda";
}

function getSearchIcon(label: string) {
  if (label.includes("académico") || label.includes("Artículo")) return GraduationCap;
  if (label.includes("Noticia")) return FileText;
  return Search;
}

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

const AcademicCitation = memo(function AcademicCitation({ source }: { source: WebSource }) {
  const meta = source.metadata || {};
  const authors = meta.authors || meta.author;
  const year = meta.year || meta.publishedYear;
  const journal = meta.journal || meta.publication || meta.publisher;
  const doi = meta.doi;
  const citations = meta.citations || meta.citationCount;
  const sourceType = meta.sourceType || (isAcademicSource(source) ? "Artículo académico" : "Fuente web");
  const database = meta.database || inferDatabase(source.domain || "");
  
  return (
    <div className="mt-1.5 space-y-0.5" data-testid="academic-citation">
      {authors && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/70">Autores:</span> {authors}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {year && (
          <span className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">Año:</span> {year}
          </span>
        )}
        {journal && (
          <span className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">Revista:</span> {journal}
          </span>
        )}
        {database && (
          <span className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">Base:</span> {database}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {doi && (
          <a
            href={`https://doi.org/${doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-primary hover:underline"
          >
            DOI: {doi}
          </a>
        )}
        {citations != null && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
            {citations} citas
          </span>
        )}
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {sourceType}
        </span>
      </div>
    </div>
  );
});

function inferDatabase(domain: string): string {
  const d = domain.replace(/^www\./, "").toLowerCase();
  if (d.includes("scholar.google")) return "Google Scholar";
  if (d.includes("pubmed") || d.includes("nih.gov")) return "PubMed";
  if (d.includes("scielo")) return "SciELO";
  if (d.includes("jstor")) return "JSTOR";
  if (d.includes("arxiv")) return "arXiv";
  if (d.includes("scopus")) return "Scopus";
  if (d.includes("researchgate")) return "ResearchGate";
  if (d.includes("semanticscholar")) return "Semantic Scholar";
  if (d.includes("ieee")) return "IEEE";
  if (d.includes("springer")) return "Springer";
  if (d.includes("nature.com")) return "Nature";
  if (d.includes("science.org")) return "Science";
  if (d.includes("elsevier")) return "Elsevier";
  if (d.includes("wiley")) return "Wiley";
  return "";
}

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
  const academic = isAcademicSource(source);

  return (
    <a
      href={source.canonicalUrl || source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-shrink-0 w-[280px] group cursor-pointer"
      data-testid={`news-card-${index}`}
      aria-label={`Leer: ${source.title || domain}`}
    >
      <div className={cn(
        "rounded-xl overflow-hidden border bg-card hover:border-primary/50 transition-all duration-200 hover:shadow-lg h-full",
        academic ? "border-amber-300/50 dark:border-amber-600/30" : "border-border"
      )}>
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
                {academic ? (
                  <GraduationCap className="w-10 h-10 text-white/80" />
                ) : (
                  <span className="text-white/80 text-4xl font-bold uppercase">
                    {domain.slice(0, 2)}
                  </span>
                )}
              </div>
            </>
          )}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="bg-black/50 backdrop-blur-sm rounded-full p-1.5">
              <ExternalLink className="w-3 h-3 text-white" />
            </div>
          </div>
          {academic && (
            <div className="absolute top-2 left-2">
              <div className="bg-amber-500/90 backdrop-blur-sm rounded-full px-2 py-0.5 flex items-center gap-1">
                <GraduationCap className="w-3 h-3 text-white" />
                <span className="text-[10px] font-medium text-white">Académico</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="p-3 space-y-2">
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
          
          <h4 className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-primary transition-colors min-h-[2.5rem]">
            {source.title || domain}
          </h4>

          {academic && <AcademicCitation source={source} />}
        </div>
      </div>
    </a>
  );
});

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
            aria-label={`Ver fuente: ${name}`}
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

export const NewsCards = memo(function NewsCards({ sources, maxDisplay = 8, onRefresh, searchLabel, searchQueries, totalSearches }: NewsCardsProps) {
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
  const label = inferSearchLabel(sources, searchLabel);
  const SearchIcon = getSearchIcon(label);
  
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
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <SearchIcon className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground" data-testid="text-search-label">
              {label}
            </span>
            <span className="text-xs text-muted-foreground">
              ({sources.length} resultados)
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowSourcesPanel(true)}
            data-testid="button-view-all-sources"
          >
            <div className="flex items-center -space-x-1.5 mr-1">
              {uniqueSources.slice(0, 4).map((source, idx) => {
                const domain = source.domain?.replace(/^www\./, "") || "unknown";
                return (
                  <div
                    key={`stack-${idx}`}
                    className={cn(
                      "w-5 h-5 rounded-full bg-background border border-border overflow-hidden flex items-center justify-center",
                      idx > 0 && "ring-1 ring-background -ml-2"
                    )}
                    style={{ zIndex: 10 - idx }}
                  >
                    <img
                      src={getSourceLogo(domain) || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                      alt={domain}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                );
              })}
              {uniqueSources.length > 4 && (
                <div className="w-5 h-5 rounded-full bg-muted border border-border flex items-center justify-center text-[9px] font-medium text-muted-foreground ring-1 ring-background -ml-2" style={{ zIndex: 5 }}>
                  +{uniqueSources.length - 4}
                </div>
              )}
            </div>
            <span>{uniqueSources.length} fuentes</span>
            <ChevronRight className="w-3 h-3" />
          </Button>
        </div>
        
        <div className="relative group">
          {canScrollLeft && (
            <button
              onClick={() => scroll('left')}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-background/95 border border-border shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent -ml-5"
              aria-label="Scroll left"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          
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

        <div className="mt-3 space-y-1.5">
          {displaySources.map((source, idx) => {
            const domain = source.domain?.replace(/^www\./, "") || "";
            const academic = isAcademicSource(source);
            return (
              <a
                key={`summary-${idx}`}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors group text-left"
                data-testid={`source-link-${idx}`}
              >
                <span className="text-[10px] text-muted-foreground/50 font-mono mt-0.5 w-4 flex-shrink-0 text-right">
                  {idx + 1}
                </span>
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
                    {academic && <GraduationCap className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                    <ExternalLink className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
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
                  {academic && <AcademicCitation source={source} />}
                </div>
              </a>
            );
          })}
        </div>
      </div>

      <SourcesPanel
        open={showSourcesPanel}
        onOpenChange={setShowSourcesPanel}
        sources={sources}
        searchQueries={searchQueries}
        totalSearches={totalSearches}
      />
    </>
  );
});

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
