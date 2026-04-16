import { useState, useEffect, memo } from "react";
import { 
  ChevronDown, 
  ChevronUp, 
  ExternalLink, 
  FileSpreadsheet, 
  FileText, 
  Download,
  BookOpen,
  Users,
  Calendar,
  Quote,
  Globe,
  Lock,
  Unlock,
  Loader2,
  CheckCircle2,
  Search,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface Author {
  firstName?: string;
  lastName: string;
  fullName: string;
}

interface Journal {
  title: string;
  volume?: string;
  issue?: string;
  pages?: string;
}

interface ScientificArticle {
  id: string;
  source: string;
  title: string;
  authors: Author[];
  abstract?: string;
  journal?: Journal;
  publicationType?: string;
  year?: number;
  doi?: string;
  pmid?: string;
  url?: string;
  pdfUrl?: string;
  keywords?: string[];
  language?: string;
  citationCount?: number;
  isOpenAccess?: boolean;
}

interface SearchProgress {
  type: "searching" | "found" | "filtering" | "complete" | "error";
  source: string;
  articlesFound: number;
  totalArticles: number;
  message: string;
  timestamp: number;
}

interface ScientificSearchResultsProps {
  articles: ScientificArticle[];
  query: string;
  isLoading?: boolean;
  progress?: SearchProgress[];
  onExportExcel?: () => void;
  onExportWord?: () => void;
  showFullOutput?: boolean;
}

const ProgressIndicator = memo(function ProgressIndicator({ 
  progress 
}: { 
  progress: SearchProgress[] 
}) {
  const latestBySource = new Map<string, SearchProgress>();
  for (const p of progress) {
    latestBySource.set(p.source, p);
  }

  const sources = Array.from(latestBySource.values());
  const totalArticles = sources.reduce((sum, p) => sum + p.articlesFound, 0);
  const isComplete = sources.some(p => p.type === "complete" && p.source === "Orquestador");

  return (
    <div className="bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-950/30 dark:to-blue-950/30 border border-sky-200 dark:border-sky-800 rounded-xl p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        {isComplete ? (
          <CheckCircle2 className="w-5 h-5 text-green-500" />
        ) : (
          <Loader2 className="w-5 h-5 text-sky-500 animate-spin" />
        )}
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {isComplete 
            ? `✅ Búsqueda completada: ${totalArticles} artículos encontrados`
            : `🔍 Buscando artículos científicos...`
          }
        </span>
      </div>

      <div className="space-y-2">
        {sources.filter(p => p.source !== "Total" && p.source !== "Orquestador").map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className={cn(
              "w-2 h-2 rounded-full",
              p.type === "complete" ? "bg-green-500" :
              p.type === "error" ? "bg-red-500" :
              "bg-sky-500 animate-pulse"
            )} />
            <span className="text-gray-600 dark:text-gray-400">
              {p.source}:
            </span>
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {p.articlesFound} artículos
            </span>
            {p.type === "filtering" && (
              <span className="text-sky-600 dark:text-sky-400 text-xs">
                (buscando más...)
              </span>
            )}
          </div>
        ))}
      </div>

      {!isComplete && (
        <div className="mt-3 pt-3 border-t border-sky-200 dark:border-sky-700">
          <p className="text-sm text-gray-600 dark:text-gray-400 animate-pulse">
            {progress[progress.length - 1]?.message || "Iniciando búsqueda..."}
          </p>
        </div>
      )}
    </div>
  );
});

const ArticleCard = memo(function ArticleCard({ 
  article, 
  index 
}: { 
  article: ScientificArticle; 
  index: number 
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getSourceBadge = (source: string) => {
    const normalized = source.toLowerCase();
    const badges: Record<string, { label: string; className: string }> = {
      pubmed: { label: "PubMed", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
      scielo: { label: "SciELO", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
      semantic: { label: "Semantic Scholar", className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
      semantic_scholar: { label: "Semantic Scholar", className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
      openalex: { label: "OpenAlex", className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200" },
      crossref: { label: "Crossref", className: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
      core: { label: "CORE", className: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200" },
      arxiv: { label: "arXiv", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
      doaj: { label: "DOAJ", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" },
      base: { label: "BASE", className: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200" },
    };
    return badges[normalized] || {
      label: source,
      className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
    };
  };

  const getTypeBadge = (type?: string) => {
    const labels: Record<string, { label: string; color: string }> = {
      meta_analysis: { label: "Meta-análisis", color: "bg-red-100 text-red-800" },
      systematic_review: { label: "Revisión Sistemática", color: "bg-orange-100 text-orange-800" },
      review: { label: "Revisión", color: "bg-yellow-100 text-yellow-800" },
      clinical_trial: { label: "Ensayo Clínico", color: "bg-emerald-100 text-emerald-800" },
      randomized_controlled_trial: { label: "ECA", color: "bg-teal-100 text-teal-800" },
    };
    return labels[type || ""] || null;
  };

  const typeBadge = getTypeBadge(article.publicationType);
  const sourceBadge = getSourceBadge(article.source);

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-sky-300 dark:hover:border-sky-700 transition-colors">
        <CollapsibleTrigger className="w-full text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs text-gray-500 font-medium">#{index + 1}</span>
                <Badge variant="outline" className={sourceBadge.className}>
                  {sourceBadge.label}
                </Badge>
                {typeBadge && (
                  <Badge variant="outline" className={typeBadge.color}>
                    {typeBadge.label}
                  </Badge>
                )}
                {article.isOpenAccess ? (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-medium">
                    <Unlock className="w-3 h-3 mr-1" />
                    Open Access
                    {article.pdfUrl ? " • PDF" : ""}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
                    <Lock className="w-3 h-3 mr-1" />
                    Restringido
                  </Badge>
                )}
              </div>
              
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 line-clamp-2 mb-2">
                {article.title}
              </h4>
              
              <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 flex-wrap">
                {article.authors.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {article.authors.slice(0, 3).map(a => a.fullName || a.lastName).join(", ")}
                    {article.authors.length > 3 && ` +${article.authors.length - 3}`}
                  </span>
                )}
                {article.year && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {article.year}
                  </span>
                )}
                {article.citationCount !== undefined && (
                  <span className="flex items-center gap-1">
                    <Quote className="w-3.5 h-3.5" />
                    {article.citationCount} citas
                  </span>
                )}
              </div>
              
              {article.journal && (
                <p className="text-sm text-gray-500 dark:text-gray-500 mt-1 flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5" />
                  {article.journal.title}
                  {article.journal.volume && `, Vol. ${article.journal.volume}`}
                  {article.journal.issue && `(${article.journal.issue})`}
                </p>
              )}
            </div>
            
            <div className="flex-shrink-0">
              {isExpanded ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
            {article.abstract && (
              <div>
                <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-1">Abstract</h5>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  {article.abstract}
                </p>
              </div>
            )}
            
            {article.keywords && article.keywords.length > 0 && (
              <div>
                <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-1">Palabras clave</h5>
                <div className="flex flex-wrap gap-1">
                  {article.keywords.map((kw, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {kw}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            
            <div className="flex items-center gap-2 pt-2">
              {article.pdfUrl && (
                <a
                  href={article.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-sm font-medium text-red-700 hover:bg-red-100"
                >
                  <FileText className="w-3.5 h-3.5" />
                  PDF directo
                </a>
              )}
              {article.doi && (
                <a
                  href={`https://doi.org/${article.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-sky-500 hover:text-sky-600 flex items-center gap-1"
                >
                  <Globe className="w-3.5 h-3.5" />
                  DOI: {article.doi}
                </a>
              )}
              {article.url && (
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-sky-500 hover:text-sky-600 flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Ver artículo
                </a>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
});

export const ScientificSearchResults = memo(function ScientificSearchResults({
  articles,
  query,
  isLoading,
  progress = [],
  onExportExcel,
  onExportWord,
  showFullOutput = true,
}: ScientificSearchResultsProps) {
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(false);
  const shouldShowDocuments = articles.length >= 10;

  if (isLoading && progress.length > 0) {
    return <ProgressIndicator progress={progress} />;
  }

  if (articles.length === 0 && !isLoading) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-yellow-600" />
        <p className="text-yellow-800 dark:text-yellow-200">
          No se encontraron artículos científicos para "{query}"
        </p>
      </div>
    );
  }

  if (!showFullOutput || articles.length < 10) {
    return (
      <div className="space-y-4">
        <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Search className="w-5 h-5 text-sky-500" />
              Resultados de Búsqueda Científica
            </h3>
            <Badge variant="secondary">{articles.length} artículos</Badge>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Búsqueda: "{query}"
          </p>
        </div>
        
        <div className="space-y-3">
          {articles.map((article, index) => (
            <ArticleCard key={article.id} article={article} index={index} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-950/30 dark:to-blue-950/30 border border-sky-200 dark:border-sky-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-sky-500" />
              Resultados de Búsqueda Científica
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Se encontraron <strong>{articles.length} artículos</strong> para "{query}"
            </p>
          </div>
          <Badge className="bg-sky-500 text-white text-lg px-3 py-1">
            {articles.length}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {onExportExcel && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExportExcel}
              className="flex items-center gap-2"
            >
              <FileSpreadsheet className="w-4 h-4 text-green-600" />
              Descargar Excel
            </Button>
          )}
          {onExportWord && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExportWord}
              className="flex items-center gap-2"
            >
              <FileText className="w-4 h-4 text-blue-600" />
              Descargar Informe Word (APA 7)
            </Button>
          )}
        </div>
      </div>

      <Collapsible open={isSourcesExpanded} onOpenChange={setIsSourcesExpanded}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between p-3 h-auto">
            <span className="flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Ver {articles.length} fuentes encontradas
            </span>
            {isSourcesExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-3 pt-2">
              {articles.map((article, index) => (
                <ArticleCard key={article.id} article={article} index={index} />
              ))}
            </div>
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});

export default ScientificSearchResults;
