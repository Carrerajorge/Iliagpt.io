import React, { memo, useState, useMemo } from "react";
import { ExternalLink, Globe, Search, BookOpen, GraduationCap, CheckCircle2, XCircle, ChevronDown, ChevronUp, FileText, BarChart3, Hash } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WebSource } from "@/hooks/use-chats";

interface SourcesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: WebSource[];
  searchQueries?: Array<{ query: string; resultCount: number; status: string }>;
  totalSearches?: number;
}

const ACADEMIC_DOMAINS = new Set([
  "scholar.google.com", "pubmed.ncbi.nlm.nih.gov", "scielo.org", "jstor.org",
  "researchgate.net", "arxiv.org", "doi.org", "scopus.com", "webofscience.com",
  "semanticscholar.org", "academia.edu", "springer.com", "wiley.com",
  "nature.com", "science.org", "ieee.org", "acm.org", "elsevier.com",
  "tandfonline.com", "sagepub.com", "nih.gov", "plos.org",
]);

const isAcademic = (source: WebSource): boolean => {
  const domain = (source.domain || "").replace(/^www\./, "").toLowerCase();
  return ACADEMIC_DOMAINS.has(domain) ||
    /\b(doi|issn|isbn|pmid|arxiv)\b/i.test(source.snippet || "") ||
    /\b(journal|peer.?review|abstract|methodology|findings)\b/i.test(source.snippet || "");
};

function inferDatabase(domain: string): string {
  const d = domain.replace(/^www\./, "").toLowerCase();
  if (d.includes("scholar.google")) return "Google Scholar";
  if (d.includes("pubmed") || d.includes("nih.gov")) return "PubMed";
  if (d.includes("scielo")) return "SciELO";
  if (d.includes("jstor")) return "JSTOR";
  if (d.includes("arxiv")) return "arXiv";
  if (d.includes("scopus")) return "Scopus";
  if (d.includes("researchgate")) return "ResearchGate";
  if (d.includes("ieee")) return "IEEE";
  if (d.includes("springer")) return "Springer";
  if (d.includes("nature.com")) return "Nature";
  if (d.includes("science.org")) return "Science";
  if (d.includes("elsevier")) return "Elsevier";
  if (d.includes("wiley")) return "Wiley";
  if (d.includes("semanticscholar")) return "Semantic Scholar";
  return "";
}

const SourceCard = memo(function SourceCard({ 
  source, 
  index,
  originQuery,
}: { 
  source: WebSource; 
  index: number;
  originQuery?: string;
}) {
  const academic = isAcademic(source);
  const meta = source.metadata || {};
  const domain = (source.domain || "").replace(/^www\./, "");

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "block p-3 rounded-lg border hover:border-border hover:bg-muted/50 transition-colors group",
        academic ? "border-amber-200/50 dark:border-amber-700/30" : "border-border/50"
      )}
      data-testid={`source-card-${index}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground/50 font-mono w-4 text-right">{index + 1}</span>
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
            <img
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              alt={domain}
              className="w-5 h-5 object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <Globe className="w-4 h-4 text-muted-foreground hidden" />
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">
              {domain}
            </span>
            {academic && <GraduationCap className="w-3 h-3 text-amber-500" />}
            {source.date && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="text-xs text-muted-foreground">
                  {source.date}
                </span>
              </>
            )}
          </div>
          <p className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
            {source.title}
          </p>
          {source.snippet && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {source.snippet}
            </p>
          )}
          {academic && (
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {meta.authors && (
                <span className="text-[11px] text-muted-foreground">
                  <span className="font-medium">Autores:</span> {meta.authors}
                </span>
              )}
              {meta.year && (
                <span className="text-[11px] text-muted-foreground">
                  <span className="font-medium">Año:</span> {meta.year}
                </span>
              )}
              {(meta.journal || meta.publication) && (
                <span className="text-[11px] text-muted-foreground">
                  <span className="font-medium">Revista:</span> {meta.journal || meta.publication}
                </span>
              )}
              {meta.doi && (
                <span className="text-[11px] text-primary">DOI: {meta.doi}</span>
              )}
              {inferDatabase(domain) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  {inferDatabase(domain)}
                </span>
              )}
            </div>
          )}
          {originQuery && (
            <p className="text-[10px] text-muted-foreground/60 mt-1 flex items-center gap-1">
              <Search className="w-2.5 h-2.5" />
              <span className="truncate">Consulta: "{originQuery}"</span>
            </p>
          )}
        </div>
        <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      </div>
    </a>
  );
});

type ViewMode = "all" | "by-query" | "by-domain";

export const SourcesPanel = memo(function SourcesPanel({
  open,
  onOpenChange,
  sources,
  searchQueries,
  totalSearches,
}: SourcesPanelProps) {
  const [showAllQueries, setShowAllQueries] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const displayQueries = searchQueries || [];
  const visibleQueries = showAllQueries ? displayQueries : displayQueries.slice(0, 5);

  const uniqueDomains = new Set(sources.map(s => s.domain?.replace(/^www\./, "") || ""));
  const academicCount = sources.filter(isAcademic).length;
  const completedQueries = displayQueries.filter(q => q.status === "completed").length;
  const failedQueries = displayQueries.filter(q => q.status === "failed").length;
  const totalResults = displayQueries.reduce((sum, q) => sum + (q.resultCount || 0), 0);

  const sourcesByQuery = useMemo(() => {
    const map = new Map<string, WebSource[]>();
    for (const s of sources) {
      const q = (s as any).query || "general";
      if (!map.has(q)) map.set(q, []);
      map.get(q)!.push(s);
    }
    return map;
  }, [sources]);

  const sourcesByDomain = useMemo(() => {
    const map = new Map<string, WebSource[]>();
    for (const s of sources) {
      const d = (s.domain || "").replace(/^www\./, "") || "unknown";
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(s);
    }
    return map;
  }, [sources]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-md p-0 flex flex-col"
        data-testid="sources-panel"
      >
        <SheetHeader className="px-4 py-3 border-b flex-shrink-0">
          <div>
            <SheetTitle className="text-base font-semibold">
              Fuentes consultadas ({sources.length})
            </SheetTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {uniqueDomains.size} sitios únicos
              {academicCount > 0 && <> · {academicCount} académicas</>}
              {totalSearches != null && totalSearches > 0 && <> · {totalSearches} búsquedas</>}
            </p>
          </div>
        </SheetHeader>

        {displayQueries.length > 0 && (
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Auditoría de búsqueda
                </h4>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-0.5">
                  <CheckCircle2 className="w-3 h-3 text-green-500" /> {completedQueries}
                </span>
                {failedQueries > 0 && (
                  <span className="flex items-center gap-0.5">
                    <XCircle className="w-3 h-3 text-red-400" /> {failedQueries}
                  </span>
                )}
                <span className="flex items-center gap-0.5">
                  <BarChart3 className="w-3 h-3" /> {totalResults} res.
                </span>
              </div>
            </div>
            <div className="space-y-1">
              {visibleQueries.map((q, idx) => (
                <div key={`q-${idx}`} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-background/50">
                  {q.status === "completed" ? (
                    <CheckCircle2 className="w-3 h-3 flex-shrink-0 text-green-500" />
                  ) : q.status === "failed" ? (
                    <XCircle className="w-3 h-3 flex-shrink-0 text-red-400" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3 flex-shrink-0 text-amber-500" />
                  )}
                  <span className="flex-1 truncate">{q.query}</span>
                  <span className="text-muted-foreground flex-shrink-0 tabular-nums">
                    {q.resultCount} {q.resultCount === 1 ? "res." : "res."}
                  </span>
                </div>
              ))}
            </div>
            {displayQueries.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-1.5 h-6 text-xs"
                onClick={() => setShowAllQueries(!showAllQueries)}
              >
                {showAllQueries ? (
                  <><ChevronUp className="w-3 h-3 mr-1" /> Menos</>
                ) : (
                  <><ChevronDown className="w-3 h-3 mr-1" /> +{displayQueries.length - 5} más</>
                )}
              </Button>
            )}
          </div>
        )}

        <div className="px-4 py-2 border-b border-border flex gap-1 flex-shrink-0">
          <Button
            variant={viewMode === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setViewMode("all")}
            data-testid="button-view-all"
          >
            <FileText className="w-3 h-3 mr-1" />
            Todas
          </Button>
          {displayQueries.length > 0 && (
            <Button
              variant={viewMode === "by-query" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => setViewMode("by-query")}
              data-testid="button-view-by-query"
            >
              <Search className="w-3 h-3 mr-1" />
              Por consulta
            </Button>
          )}
          <Button
            variant={viewMode === "by-domain" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setViewMode("by-domain")}
            data-testid="button-view-by-domain"
          >
            <Globe className="w-3 h-3 mr-1" />
            Por sitio
          </Button>
        </div>

        <ScrollArea className="flex-1">
          {viewMode === "all" && (
            <div className="p-4 space-y-3">
              {sources.map((source, idx) => (
                <SourceCard 
                  key={`${source.url}-${idx}`} 
                  source={source} 
                  index={idx}
                  originQuery={(source as any).query}
                />
              ))}
            </div>
          )}

          {viewMode === "by-query" && (
            <div className="p-4 space-y-4">
              {Array.from(sourcesByQuery.entries()).map(([query, querySources], groupIdx) => (
                <div key={`group-${groupIdx}`}>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Hash className="w-3 h-3 text-primary" />
                    <span className="text-xs font-medium text-foreground/80 truncate flex-1">
                      {query}
                    </span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {querySources.length} res.
                    </span>
                  </div>
                  <div className="space-y-2 pl-1">
                    {querySources.map((source, idx) => (
                      <SourceCard 
                        key={`${source.url}-${groupIdx}-${idx}`} 
                        source={source} 
                        index={idx}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {viewMode === "by-domain" && (
            <div className="p-4 space-y-4">
              {Array.from(sourcesByDomain.entries()).map(([domain, domainSources], groupIdx) => {
                const academic = ACADEMIC_DOMAINS.has(domain.toLowerCase());
                const db = inferDatabase(domain);
                return (
                  <div key={`dom-${groupIdx}`}>
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                        alt={domain}
                        className="w-4 h-4 rounded-full"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <span className="text-xs font-medium text-foreground/80 truncate flex-1">
                        {domain}
                      </span>
                      {academic && <GraduationCap className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                      {db && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 flex-shrink-0">
                          {db}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {domainSources.length}
                      </span>
                    </div>
                    <div className="space-y-2 pl-1">
                      {domainSources.map((source, idx) => (
                        <SourceCard 
                          key={`${source.url}-${groupIdx}-${idx}`} 
                          source={source} 
                          index={idx}
                          originQuery={(source as any).query}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
});
