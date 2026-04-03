import React, { memo, useState } from "react";
import { ExternalLink, Globe, X, Search, BookOpen, GraduationCap, CheckCircle2, ChevronDown, ChevronUp, FileText } from "lucide-react";
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
]);

const isAcademic = (source: WebSource): boolean => {
  const domain = (source.domain || "").replace(/^www\./, "").toLowerCase();
  return ACADEMIC_DOMAINS.has(domain);
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
  return "";
}

const SourceCard = memo(function SourceCard({ 
  source, 
  index 
}: { 
  source: WebSource; 
  index: number;
}) {
  const academic = isAcademic(source);
  const meta = source.metadata || {};

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
            {source.favicon ? (
              <img
                src={source.favicon}
                alt={source.domain}
                className="w-5 h-5 object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const fallback = target.nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
            ) : (
              <Globe className="w-4 h-4 text-muted-foreground" />
            )}
            <Globe className="w-4 h-4 text-muted-foreground hidden" />
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">
              {source.domain}
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
              {meta.doi && (
                <span className="text-[11px] text-primary">{meta.doi}</span>
              )}
              {inferDatabase(source.domain || "") && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  {inferDatabase(source.domain || "")}
                </span>
              )}
            </div>
          )}
        </div>
        <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      </div>
    </a>
  );
});

export const SourcesPanel = memo(function SourcesPanel({
  open,
  onOpenChange,
  sources,
  searchQueries,
  totalSearches,
}: SourcesPanelProps) {
  const [showAllQueries, setShowAllQueries] = useState(false);
  const displayQueries = searchQueries || [];
  const visibleQueries = showAllQueries ? displayQueries : displayQueries.slice(0, 5);

  const uniqueDomains = new Set(sources.map(s => s.domain?.replace(/^www\./, "") || ""));
  const academicCount = sources.filter(isAcademic).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-md p-0 flex flex-col"
        data-testid="sources-panel"
      >
        <SheetHeader className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
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
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          {displayQueries.length > 0 && (
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Consultas ejecutadas
                </h4>
              </div>
              <div className="space-y-1">
                {visibleQueries.map((q, idx) => (
                  <div key={`q-${idx}`} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-background/50">
                    <CheckCircle2 className={cn(
                      "w-3 h-3 flex-shrink-0",
                      q.status === "completed" ? "text-green-500" : "text-amber-500"
                    )} />
                    <span className="flex-1 truncate">{q.query}</span>
                    <span className="text-muted-foreground flex-shrink-0">{q.resultCount}</span>
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

          <div className="p-4 space-y-3">
            {sources.map((source, idx) => (
              <SourceCard 
                key={`${source.url}-${idx}`} 
                source={source} 
                index={idx} 
              />
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
});
