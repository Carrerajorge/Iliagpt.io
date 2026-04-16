import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { 
  ExternalLink, 
  Star, 
  Clock, 
  FileText, 
  Globe, 
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  BookOpen,
  Quote
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SparkpageSource {
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  date?: string;
  type?: "article" | "paper" | "website" | "book";
  authors?: string[];
}

interface SparkpageCardProps {
  title: string;
  summary: string;
  sources: SparkpageSource[];
  keyPoints?: string[];
  confidence?: number;
  className?: string;
  onDeepen?: () => void;
  onCite?: (source: SparkpageSource) => void;
}

export const SparkpageCard = memo(function SparkpageCard({
  title,
  summary,
  sources,
  keyPoints = [],
  confidence,
  className,
  onDeepen,
  onCite,
}: SparkpageCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopySource = (source: SparkpageSource, index: number) => {
    const citation = `${source.title}. ${source.domain}. ${source.url}`;
    navigator.clipboard.writeText(citation);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-xl border bg-card overflow-hidden",
        "hover:shadow-md transition-shadow",
        className
      )}
    >
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold text-base leading-tight">{title}</h3>
          {confidence && (
            <Badge variant="secondary" className="shrink-0">
              {Math.round(confidence * 100)}% confianza
            </Badge>
          )}
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          {summary}
        </p>

        {keyPoints.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Puntos clave:
            </span>
            <ul className="space-y-1">
              {keyPoints.slice(0, 3).map((point, index) => (
                <li 
                  key={index}
                  className="flex items-start gap-2 text-sm"
                >
                  <span className="text-primary mt-1">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <span className="text-xs text-muted-foreground">
            {sources.length} fuente{sources.length !== 1 ? "s" : ""}
          </span>
          <div className="flex -space-x-1">
            {sources.slice(0, 4).map((source, index) => (
              <div
                key={index}
                className={cn(
                  "w-5 h-5 rounded-full bg-muted border-2 border-background",
                  "flex items-center justify-center"
                )}
                title={source.domain}
              >
                <span className="text-[8px] font-medium uppercase">
                  {source.domain.charAt(0)}
                </span>
              </div>
            ))}
            {sources.length > 4 && (
              <div className="w-5 h-5 rounded-full bg-primary/10 border-2 border-background flex items-center justify-center">
                <span className="text-[8px] font-medium text-primary">
                  +{sources.length - 4}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-2 flex items-center justify-between hover:bg-muted/50 transition-colors"
        >
          <span className="text-xs font-medium text-muted-foreground">
            Ver fuentes
          </span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-4 pb-4 space-y-2"
          >
            {sources.map((source, index) => (
              <SourceItem
                key={index}
                source={source}
                isCopied={copiedIndex === index}
                onCopy={() => handleCopySource(source, index)}
                onCite={() => onCite?.(source)}
              />
            ))}
          </motion.div>
        )}
      </div>

      {onDeepen && (
        <div className="px-4 pb-4">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onDeepen}
          >
            <BookOpen className="w-4 h-4 mr-2" />
            Profundizar
          </Button>
        </div>
      )}
    </motion.div>
  );
});

const SourceItem = memo(function SourceItem({
  source,
  isCopied,
  onCopy,
  onCite,
}: {
  source: SparkpageSource;
  isCopied: boolean;
  onCopy: () => void;
  onCite?: () => void;
}) {
  const typeIcons = {
    article: FileText,
    paper: BookOpen,
    website: Globe,
    book: BookOpen,
  };
  const Icon = typeIcons[source.type || "website"];

  return (
    <div className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
      <Icon className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
      
      <div className="flex-1 min-w-0">
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium hover:text-primary transition-colors line-clamp-1"
        >
          {source.title}
        </a>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{source.domain}</span>
          {source.date && (
            <>
              <span>•</span>
              <span>{source.date}</span>
            </>
          )}
        </div>
        {source.snippet && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {source.snippet}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onCopy}
          title="Copiar referencia"
        >
          {isCopied ? (
            <Check className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </Button>
        {onCite && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onCite}
            title="Citar"
          >
            <Quote className="w-3.5 h-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          asChild
        >
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </Button>
      </div>
    </div>
  );
});

export default SparkpageCard;
