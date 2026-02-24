import React, { memo, useMemo, useState, useEffect, useRef, lazy, Suspense, useCallback, Component, type ReactNode, type ErrorInfo } from "react";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { parseDocument, detectFormat, type DocumentFormat } from "@/lib/rstParser";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";

const MarkdownRenderer = lazy(() => import("./markdown-renderer"));

interface DocumentErrorBoundaryProps {
  children: ReactNode;
  fallbackContent?: string;
}

interface DocumentErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class DocumentErrorBoundary extends Component<DocumentErrorBoundaryProps, DocumentErrorBoundaryState> {
  constructor(props: DocumentErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): DocumentErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[DocumentErrorBoundary] Error renderizando documento:', {
      error: error.message,
      stack: errorInfo.componentStack
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium text-sm">Error al renderizar el documento</span>
          </div>
          {this.props.fallbackContent && (
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-40 overflow-auto bg-muted/50 p-2 rounded mt-2">
              {this.props.fallbackContent.slice(0, 500)}
              {this.props.fallbackContent.length > 500 && '...'}
            </pre>
          )}
          <button
            onClick={this.handleRetry}
            className="mt-2 flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
          >
            <RefreshCw className="h-3 w-3" />
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const CHUNK_SIZE = 50;
const CHUNK_HEIGHT_ESTIMATE = 100;

export interface DocumentRendererProps {
  content: string;
  format?: DocumentFormat;
  filename?: string;
  className?: string;
  lazyThreshold?: number;
  enableVirtualization?: boolean;
}

interface ContentChunk {
  id: number;
  content: string;
  startLine: number;
  endLine: number;
}

function splitIntoChunks(content: string, chunkSize: number): ContentChunk[] {
  const lines = content.split('\n');
  const chunks: ContentChunk[] = [];
  
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunkLines = lines.slice(i, i + chunkSize);
    chunks.push({
      id: Math.floor(i / chunkSize),
      content: chunkLines.join('\n'),
      startLine: i,
      endLine: Math.min(i + chunkSize, lines.length),
    });
  }
  
  return chunks;
}

const RstContent = memo(function RstContent({ html, className }: { html: string; className?: string }) {
  // FRONTEND FIX #4: Sanitize RST HTML content to prevent XSS
  const sanitizedHtml = useMemo(() => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
                   'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'code', 'blockquote', 'a', 'img',
                   'strong', 'em', 'b', 'i', 'u', 'span', 'div', 'figure', 'figcaption', 'section', 'article'],
    ALLOWED_ATTR: ['class', 'href', 'src', 'alt', 'title', 'id', 'name', 'target', 'rel'],
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
  }), [html]);

  return (
    <div
      className={cn("rst-content", className)}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      data-testid="rst-content"
    />
  );
});

interface LazyChunkProps {
  chunk: ContentChunk;
  format: "markdown" | "rst";
  isVisible: boolean;
  estimatedHeight: number;
  className?: string;
}

const LazyChunk = memo(function LazyChunk({ 
  chunk, 
  format, 
  isVisible, 
  estimatedHeight,
  className 
}: LazyChunkProps) {
  if (!isVisible) {
    return (
      <div 
        style={{ height: estimatedHeight, minHeight: 50 }}
        className="flex items-center justify-center text-muted-foreground"
        data-testid={`chunk-placeholder-${chunk.id}`}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (format === "rst") {
    const parsed = parseDocument(chunk.content, "rst");
    return <RstContent html={parsed.html} className={className} />;
  }

  return (
    <DocumentErrorBoundary fallbackContent={chunk.content}>
      <Suspense fallback={
        <div className="flex items-center gap-2 p-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading content...</span>
        </div>
      }>
        <MarkdownRenderer content={chunk.content} className={className} />
      </Suspense>
    </DocumentErrorBoundary>
  );
});

export const DocumentRenderer = memo(function DocumentRenderer({
  content,
  format = "auto",
  filename,
  className,
  lazyThreshold = 500,
  enableVirtualization = true,
}: DocumentRendererProps) {
  const [visibleChunks, setVisibleChunks] = useState<Set<number>>(new Set([0, 1, 2]));
  const containerRef = useRef<HTMLDivElement>(null);
  const chunkRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const detectedFormat = useMemo(() => {
    return format === "auto" ? detectFormat(content, filename) : format;
  }, [content, format, filename]);

  const lineCount = useMemo(() => content.split('\n').length, [content]);
  const shouldVirtualize = enableVirtualization && lineCount > lazyThreshold;
  const chunks = useMemo(() => {
    if (!shouldVirtualize) return null;
    return splitIntoChunks(content, CHUNK_SIZE);
  }, [content, shouldVirtualize]);

  const registerChunkRef = useCallback((id: number, el: HTMLDivElement | null) => {
    if (el) {
      chunkRefs.current.set(id, el);
      observerRef.current?.observe(el);
    } else {
      const existing = chunkRefs.current.get(id);
      if (existing) {
        observerRef.current?.unobserve(existing);
        chunkRefs.current.delete(id);
      }
    }
  }, []);

  useEffect(() => {
    if (!shouldVirtualize) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        setVisibleChunks(prev => {
          const next = new Set(prev);
          entries.forEach(entry => {
            const id = parseInt(entry.target.getAttribute('data-chunk-id') || '0');
            if (entry.isIntersecting) {
              next.add(id);
              next.add(id - 1);
              next.add(id + 1);
            }
          });
          return next;
        });
      },
      {
        root: null,
        rootMargin: '200px 0px',
        threshold: 0,
      }
    );

    return () => {
      observerRef.current?.disconnect();
    };
  }, [shouldVirtualize]);

  if (!shouldVirtualize) {
    if (detectedFormat === "rst") {
      const parsed = parseDocument(content, "rst", filename);
      return (
        <div className={cn("document-renderer", className)} data-testid="document-renderer">
          <RstContent html={parsed.html} />
        </div>
      );
    }

    return (
      <div className={cn("document-renderer", className)} data-testid="document-renderer">
        <DocumentErrorBoundary fallbackContent={content}>
          <Suspense fallback={
            <div className="flex items-center gap-2 p-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading markdown renderer...</span>
            </div>
          }>
            <MarkdownRenderer content={content} />
          </Suspense>
        </DocumentErrorBoundary>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className={cn("document-renderer", className)} 
      data-testid="document-renderer"
    >
      {chunks?.map((chunk) => (
        <div
          key={chunk.id}
          ref={(el) => registerChunkRef(chunk.id, el)}
          data-chunk-id={chunk.id}
          data-testid={`chunk-${chunk.id}`}
        >
          <LazyChunk
            chunk={chunk}
            format={detectedFormat}
            isVisible={visibleChunks.has(chunk.id)}
            estimatedHeight={CHUNK_HEIGHT_ESTIMATE * Math.min(chunk.endLine - chunk.startLine, CHUNK_SIZE)}
          />
        </div>
      ))}
    </div>
  );
});

export default DocumentRenderer;
