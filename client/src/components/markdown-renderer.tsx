import React, { memo, useMemo, useState, useCallback, useRef, useEffect, Component, ErrorInfo, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { Check, Copy, Loader2, Download, Maximize2, Minimize2, FileText, FileSpreadsheet, Presentation, ChevronRight, Globe, ExternalLink } from "lucide-react";
import { preprocessMathInMarkdown } from "@/lib/mathParser";
import { CodeBlockShell } from "./code-block-shell";
import { isLanguageRunnable } from "@/lib/sandboxApi";
import { useSandboxExecution } from "@/hooks/useSandboxExecution";
import { downloadArtifact } from "@/lib/localArtifactAccess";
import { useShikiHighlight } from "@/hooks/useShikiHighlight";
import { useArtifactStore } from "@/stores/artifactStore";
import { RenderBlockWrapper } from "@/components/chat/RenderBlockWrapper";

// ── Sanitized SVG Renderer (uses DOMPurify-cleaned HTML set via ref, not dangerouslySetInnerHTML) ──
const SanitizedSvgBlock = memo(function SanitizedSvgBlock({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
  }, [html]);
  return <div ref={ref} />;
});

// ── Mermaid Diagram Renderer ──
/** Normalize mermaid source: fix common stream artifacts that break parsing */
function normalizeMermaidCode(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")          // <br/> → newline
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">") // HTML entities
    .replace(/&amp;/g, "&")
    .replace(/\u201C|\u201D/g, '"')          // smart quotes → straight
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\r\n/g, "\n")                  // normalize line endings
    .replace(/\t/g, "  ")                    // tabs → spaces
    .trim();
}

const MermaidDiagram = memo(function MermaidDiagram({ code }: { code: string }) {
  const svgRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const svgTextRef = useRef("");
  const lastRenderedRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    const normalized = normalizeMermaidCode(code);

    if (!normalized) {
      if (status !== "loading") setStatus("loading");
      return;
    }

    // Skip re-render if code hasn't meaningfully changed
    if (normalized === lastRenderedRef.current && status === "ok") return;

    // Debounce: wait 400ms after last change to avoid palpitating during streaming
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        const mermaid = (await import("mermaid")).default;
        const isDark = document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? "dark" : "default",
          securityLevel: "loose",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        });
        const id = `mmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const { svg } = await mermaid.render(id, normalized);
        if (cancelled) return;
        lastRenderedRef.current = normalized;
        const clean = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          ADD_TAGS: ["use", "foreignObject", "switch"],
          ADD_ATTR: ["dominant-baseline", "text-anchor", "marker-end", "marker-start"],
        });
        svgTextRef.current = clean;
        if (svgRef.current) svgRef.current.replaceChildren();
        if (svgRef.current) {
          const template = document.createElement("template");
          template.innerHTML = clean;
          svgRef.current.appendChild(template.content);
        }
        setStatus("ok");
      } catch (err) {
        if (!cancelled) {
          // Don't show error during streaming — code might be incomplete
          const msg = err instanceof Error ? err.message : "Render failed";
          console.debug("[MermaidDiagram] Render attempt failed (may be incomplete):", msg);
          // Only show error if this looks like complete code (has closing markers)
          if (normalized.includes("end") || normalized.split("\n").length > 3) {
            setErrorMsg(msg);
            setStatus("error");
          }
        }
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [code, status]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(svgTextRef.current || code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className="my-4 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white dark:bg-zinc-900">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v18M3 12h18M7.5 7.5l9 9M16.5 7.5l-9 9"/></svg>
          Diagrama
        </span>
        <button onClick={handleCopy} className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex items-center gap-1 transition-colors">
          {copied ? <><Check className="h-3 w-3 text-green-500" /> Copiado</> : <><Copy className="h-3 w-3" /> Copiar</>}
        </button>
      </div>
      {status === "error" ? (
        <div className="p-4 text-center space-y-2">
          <p className="text-sm text-amber-500">No se pudo renderizar: {errorMsg}</p>
          <pre className="text-xs font-mono bg-zinc-100 dark:bg-zinc-800 p-3 rounded-lg overflow-auto max-h-48 text-left">{code}</pre>
        </div>
      ) : status === "ok" ? (
        <div ref={svgRef} className="p-4 flex items-center justify-center [&>svg]:max-w-full [&>svg]:h-auto" />
      ) : (
        <div className="p-4 flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400 mr-2" />
          <span className="text-sm text-zinc-400">Renderizando diagrama...</span>
        </div>
      )}
    </div>
  );
});

// ── Inline SVG Renderer (sanitized with DOMPurify — same pattern as MermaidDiagram) ──
/** InlineSvgBlock — Renders SVG code inline with responsive scaling and security. */
const InlineSvgBlock = memo(function InlineSvgBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastCodeRef = useRef("");

  useEffect(() => {
    if (!containerRef.current || !code.trim()) return;
    // Only re-render if code actually changed
    if (code === lastCodeRef.current) return;

    // Wait for complete SVG (has closing tag) or debounce during streaming
    const isComplete = code.includes("</svg>");
    const delay = isComplete ? 0 : 500;

    const timer = setTimeout(() => {
      if (!containerRef.current) return;
      lastCodeRef.current = code;

      // Sanitize with DOMPurify
      const clean = DOMPurify.sanitize(code, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ["use", "foreignObject", "clipPath", "mask", "pattern", "linearGradient", "radialGradient", "stop", "animate", "animateTransform", "defs", "g", "symbol"],
        ADD_ATTR: ["viewBox", "preserveAspectRatio", "xmlns", "xmlns:xlink", "dominant-baseline", "text-anchor", "marker-end", "marker-start", "clip-path", "mask", "filter", "fill-rule", "clip-rule", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "rx", "ry", "cx", "cy", "r", "d", "points", "x1", "y1", "x2", "y2", "offset", "stop-color", "stop-opacity", "font-family", "font-size", "font-weight", "text-decoration", "letter-spacing", "transform", "opacity"],
      });

      if (!clean || !clean.includes("<svg")) {
        // DOMPurify stripped everything — render as fallback text
        containerRef.current.textContent = "SVG could not be rendered safely.";
        return;
      }

      // Insert into DOM via temporary element
      const temp = document.createElement("div");
      temp.innerHTML = clean;
      const svgEl = temp.querySelector("svg");

      if (svgEl) {
        // Ensure viewBox for responsiveness
        if (!svgEl.getAttribute("viewBox")) {
          const w = parseInt(svgEl.getAttribute("width") || "400");
          const h = parseInt(svgEl.getAttribute("height") || "300");
          svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
        }
        // Responsive: CSS controls size
        svgEl.style.width = "100%";
        svgEl.style.height = "auto";
        svgEl.style.maxHeight = "500px";
        svgEl.style.display = "block";
        svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
      }

      containerRef.current.replaceChildren();
      while (temp.firstChild) containerRef.current.appendChild(temp.firstChild);
    }, delay);
    return () => clearTimeout(timer);
  }, [code]);

  return (
    <div
      ref={containerRef}
      className="w-full flex items-center justify-center min-h-[60px] [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-[500px] [&>svg]:block"
    />
  );
});

// ── Inline HTML Renderer (sandboxed iframe for documents, presentations, tables) ──
const InlineHtmlBlock = memo(function InlineHtmlBlock({ code }: { code: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);
  const lastCodeRef = useRef("");

  // Detect if HTML needs scripts (Plotly, Chart.js, D3, etc.)
  const needsScripts = code.includes("<script") && (
    code.includes("plotly") || code.includes("Plotly") ||
    code.includes("chart.js") || code.includes("Chart(") ||
    code.includes("d3.") || code.includes("three.js") ||
    code.includes("cdn.") || code.includes("cdnjs.") ||
    code.includes("Math.") || code.includes("requestAnimationFrame")
  );

  useEffect(() => {
    if (!iframeRef.current || !code.trim()) return;
    const isComplete = code.includes("</html>") || code.includes("</body>") || code.includes("</script>");
    const delay = isComplete ? 100 : 500;

    const timer = setTimeout(() => {
      if (code === lastCodeRef.current) return;
      lastCodeRef.current = code;
      const iframe = iframeRef.current;
      if (!iframe) return;
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) return;

      // If scripts needed (math/charts), keep them. Otherwise strip for safety.
      const html = needsScripts ? code : code.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<!-- scripts removed for safety -->");

      doc.open();
      doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;background:#fff;}*{box-sizing:border-box;}</style></head><body>${html}</body></html>`);
      doc.close();

      // Auto-resize: check multiple times for async content (Plotly renders after load)
      const resizeCheck = () => {
        if (!iframe.contentDocument) return;
        const h = iframe.contentDocument.documentElement?.scrollHeight || iframe.contentDocument.body?.scrollHeight || 400;
        setHeight(Math.min(Math.max(h + 20, 300), 700));
      };
      requestAnimationFrame(resizeCheck);
      setTimeout(resizeCheck, 500);  // Plotly needs time to render
      setTimeout(resizeCheck, 1500); // Final check
    }, delay);
    return () => clearTimeout(timer);
  }, [code, needsScripts]);

  return (
    <iframe
      ref={iframeRef}
      sandbox={needsScripts ? "allow-scripts allow-same-origin" : "allow-same-origin"}
      className="w-full border-0 bg-white dark:bg-white rounded"
      style={{ height: `${height}px`, minHeight: "300px" }}
      title="Contenido renderizado"
    />
  );
});

const InlineSourceBadge = memo(function InlineSourceBadge({ name, url }: { name: string; url: string }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [imageError, setImageError] = useState(false);

  let domain = "";
  try {
    const urlObj = new URL(url);
    domain = urlObj.hostname.replace(/^www\./, "");
  } catch {
    domain = name.toLowerCase().replace(/\s+/g, "");
  }

  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

  return (
    <span className="relative inline-block align-baseline">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 ml-1",
          "text-xs font-medium rounded-full",
          "bg-sky-500/10 hover:bg-sky-500/20",
          "border border-sky-500/30 hover:border-sky-500/50",
          "text-sky-500 hover:text-sky-400",
          "transition-all duration-200 cursor-pointer",
          "no-underline hover:no-underline"
        )}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        data-testid={`source-badge-${name.toLowerCase().replace(/\s+/g, '-')}`}
      >
        {!imageError ? (
          <img
            src={faviconUrl}
            alt=""
            className="w-3 h-3 rounded-full object-contain"
            onError={() => setImageError(true)}
          />
        ) : (
          <Globe className="w-3 h-3" />
        )}
        <span className="max-w-[100px] truncate">{name}</span>
      </a>

      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
          <div className="bg-popover border border-border rounded-lg shadow-lg p-2 min-w-[160px] max-w-[240px]">
            <div className="flex items-center gap-2">
              {!imageError ? (
                // FRONTEND FIX #15: Add meaningful alt text for favicon
                <img src={faviconUrl} alt={`${name || domain} favicon`} className="w-4 h-4 rounded-full object-contain" />
              ) : (
                <Globe className="w-4 h-4 text-muted-foreground" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-xs text-foreground truncate">{name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{domain}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </span>
  );
});

function preprocessSourceBadges(content: string, webSources?: Array<{ url: string; siteName?: string; domain: string; metadata?: { pageNumber?: number; section?: string; totalPages?: number } }>): string {
  let processed = content;

  // Handle existing explicit source tags
  processed = processed.replace(
    /\[\[FUENTE:([^\|]+)\|([^\]]+)\]\]/g,
    (_, name, url) => `[%%SOURCE%%${name.trim()}%%SOURCE%%](${url.trim()})`
  );

  if (webSources && webSources.length > 0) {
    // Regex for various citation formats:
    // [1], [Source 1], [Fuente 1], [Ref 1]
    // (Source 1), (Fuente 1), (Ref 1) - Note: standard markdown might treat (url) as link part, so context matters, but here we replace text.
    // We target isolated patterns to avoid breaking existing links.
    processed = processed.replace(
      /(\[|\()\s*(?:Fuente|Source|Ref|Cita)?[:.]?\s*(\d+)\s*(\]|\))/gi,
      (match, open, num, close) => {
        const index = parseInt(num, 10);
        const source = webSources[index - 1]; // 1-based index

        if (source) {
          const name = source.siteName || source.domain;
          let label = name;

          // Enhanced citation label with metadata
          if (source.metadata) {
            const parts = [];

            // Page priority
            if (source.metadata.pageNumber) {
              parts.push(`p. ${source.metadata.pageNumber}`);
            }

            // Section priority
            if (source.metadata.section) {
              const sec = source.metadata.section;
              // Limit section length to keep badge concise
              parts.push(sec.length > 20 ? sec.substring(0, 18) + "..." : sec);
            }

            if (parts.length > 0) {
              label = `${name} • ${parts.join(" ")}`;
            }
          }

          // Return markdown link with special marker
          // We add a space only if it doesn't look like it's inside a sentence flow awkwardly, 
          // but safely adding a leading space helps prevent merging with previous words.
          return ` [%%SOURCE%%${label}%%SOURCE%%](${source.url})`;
        }
        return match;
      }
    );
  }

  return processed;
}

const purifyConfig = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark',
    'a', 'img', 'span', 'div',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'math', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'mroot', 'msqrt', 'mtext', 'mspace', 'mtable', 'mtr', 'mtd', 'annotation', 'annotation-xml', 'semantics',
    'svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'g', 'defs', 'use', 'symbol'
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'class', 'className', 'id', 'style',
    'target', 'rel', 'width', 'height', 'loading', 'decoding',
    'colspan', 'rowspan', 'scope',
    'xmlns', 'display', 'viewBox', 'fill', 'stroke', 'd', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin',
    'aria-hidden', 'data-testid'
  ],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur']
};

// Prevent Reverse Tabnabbing
DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
  if ('target' in node && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function sanitizeContent(content: string): string {
  if (!content || typeof content !== 'string') return '';
  return DOMPurify.sanitize(content, purifyConfig) as unknown as string;
}

interface MarkdownErrorBoundaryProps {
  children: ReactNode;
  fallbackContent?: string;
}

interface MarkdownErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  lastFallbackContent?: string;
}

export class MarkdownErrorBoundary extends Component<MarkdownErrorBoundaryProps, MarkdownErrorBoundaryState> {
  constructor(props: MarkdownErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, lastFallbackContent: props.fallbackContent };
  }

  static getDerivedStateFromError(error: Error): Partial<MarkdownErrorBoundaryState> {
    return { hasError: true, error };
  }

  static getDerivedStateFromProps(
    nextProps: MarkdownErrorBoundaryProps,
    prevState: MarkdownErrorBoundaryState
  ): Partial<MarkdownErrorBoundaryState> | null {
    if (nextProps.fallbackContent !== prevState.lastFallbackContent) {
      return {
        hasError: false,
        error: null,
        lastFallbackContent: nextProps.fallbackContent,
      };
    }
    return null;
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('[MarkdownErrorBoundary] Rendering error (silent fallback):', error.message);
  }

  componentDidUpdate(prevProps: MarkdownErrorBoundaryProps) {
    if (prevProps.fallbackContent !== this.props.fallbackContent && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      const content = this.props.fallbackContent || '';
      return (
        <div className="whitespace-pre-wrap break-words">
          <span className="bg-yellow-100 text-yellow-800 px-1 rounded">
            {content}
          </span>
        </div>
      );
    }

    return this.props.children;
  }
}

type GenerationState = 'analyzing' | 'structuring' | 'generating' | 'completing' | 'done';

const STATE_MESSAGES: Record<GenerationState, { text: string; progress: number }> = {
  analyzing: { text: 'Analizando solicitud...', progress: 20 },
  structuring: { text: 'Estructurando contenido...', progress: 45 },
  generating: { text: 'Generando documento...', progress: 70 },
  completing: { text: 'Finalizando...', progress: 90 },
  done: { text: 'Documento listo', progress: 100 }
};

interface DocumentGenerationLoaderProps {
  documentType: 'word' | 'excel' | 'ppt';
  title?: string;
  isComplete: boolean;
  onOpen?: () => void;
}

const DocumentGenerationLoader = memo(function DocumentGenerationLoader({
  documentType,
  title,
  isComplete,
  onOpen
}: DocumentGenerationLoaderProps) {
  const [state, setState] = useState<GenerationState>('analyzing');

  useEffect(() => {
    if (isComplete) {
      setState('done');
      return;
    }

    const progression: GenerationState[] = ['analyzing', 'structuring', 'generating', 'completing'];
    let currentIndex = 0;

    const interval = setInterval(() => {
      currentIndex = Math.min(currentIndex + 1, progression.length - 1);
      setState(progression[currentIndex]);
    }, 1200);

    return () => clearInterval(interval);
  }, [isComplete]);

  const currentState = STATE_MESSAGES[state];

  const DocIcon = documentType === 'word' ? FileText : documentType === 'excel' ? FileSpreadsheet : Presentation;
  const iconBgColor = documentType === 'word' ? 'bg-[#2B579A]' : documentType === 'excel' ? 'bg-[#217346]' : 'bg-[#D04423]';

  if (isComplete) {
    return (
      <div
        className="flex items-center gap-3.5 p-4 bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-950/30 dark:to-blue-950/30 border border-sky-200 dark:border-sky-800 rounded-2xl cursor-pointer transition-all duration-300 hover:shadow-lg hover:shadow-sky-200/50 dark:hover:shadow-sky-900/30 hover:-translate-y-0.5 max-w-[340px] group"
        onClick={onOpen}
        data-testid="document-ready-card"
      >
        <div className="relative flex-shrink-0">
          <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center", iconBgColor)}>
            <DocIcon className="w-5 h-5 text-white" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-white dark:border-gray-900">
            <Check className="w-3 h-3 text-white" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate block">
            {title || 'Documento Word'}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Documento listo • Click para abrir
          </span>
        </div>
        <ChevronRight className="w-5 h-5 text-sky-500 transition-transform group-hover:translate-x-1" />
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-slate-50 to-gray-100 dark:from-slate-900 dark:to-gray-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 max-w-[340px] shadow-sm" data-testid="document-generation-loader">
      <div className="flex items-center gap-3.5 mb-4">
        <div className="relative flex-shrink-0">
          <div className="absolute inset-0 w-11 h-11 rounded-full bg-sky-400/20 dark:bg-sky-500/20 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
          <div className={cn("relative w-11 h-11 rounded-xl flex items-center justify-center", iconBgColor)}>
            <DocIcon className="w-5 h-5 text-white" />
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
            Creando documento
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 animate-pulse">
            {currentState.text}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="flex-1 h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-blue-500 rounded-full transition-all duration-500 ease-out w-[var(--prog-width)]"
            ref={(el) => { if (el) el.style.setProperty('--prog-width', `${currentState.progress}%`); }}
          />
        </div>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums min-w-[32px] text-right">
          {currentState.progress}%
        </span>
      </div>

      <div className="flex justify-center gap-1.5 mt-4">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce duration-1000",
              i === 0 && "delay-0",
              i === 1 && "delay-[150ms]",
              i === 2 && "delay-[300ms]"
            )}
          />
        ))}
      </div>
    </div>
  );
});

function detectDocumentJSON(content: string): { isDocument: boolean; type?: 'word' | 'excel' | 'ppt'; title?: string; isComplete: boolean } {
  const trimmed = content.trim();

  const typeMatch = trimmed.match(/"type"\s*:\s*"(word|excel|ppt)"/);
  if (!typeMatch) {
    const partialTypeMatch = trimmed.match(/\{\s*"type"\s*:\s*"?/);
    if (partialTypeMatch || trimmed.startsWith('{')) {
      const looksLikeDocStart = /^\s*\{\s*(?:"type"|"title"|"content")/.test(trimmed);
      if (looksLikeDocStart) {
        return { isDocument: true, isComplete: false };
      }
    }
    return { isDocument: false, isComplete: false };
  }

  const docType = typeMatch[1] as 'word' | 'excel' | 'ppt';
  const titleMatch = trimmed.match(/"title"\s*:\s*"([^"]+)"/);
  const title = titleMatch?.[1];

  const hasContent = /"content"\s*:\s*"/.test(trimmed);
  const endsWithClosingBrace = trimmed.endsWith('}');
  const isComplete = hasContent && endsWithClosingBrace;

  return { isDocument: true, type: docType, title, isComplete };
}

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "math",
    "mrow",
    "mi",
    "mo",
    "mn",
    "msup",
    "msub",
    "mfrac",
    "mroot",
    "msqrt",
    "mtext",
    "mspace",
    "mtable",
    "mtr",
    "mtd",
    "annotation",
    "annotation-xml",
    "semantics",
    "svg",
    "path",
    "circle",
    "rect",
    "line",
    "polygon",
    "polyline",
    "g",
    "defs",
    "use",
    "symbol",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] || []), "className", "class", "style"],
    math: ["xmlns", "display"],
    svg: ["xmlns", "viewBox", "width", "height", "fill", "stroke"],
    path: ["d", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin"],
    code: ["className", "class"],
    span: ["className", "class", "style", "aria-hidden"],
    div: ["className", "class", "style"],
    img: ["src", "alt", "title", "loading", "width", "height"],
    a: ["href", "title", "target", "rel"],
    table: ["className", "class"],
    th: ["className", "class", "scope", "colSpan", "rowSpan"],
    td: ["className", "class", "colSpan", "rowSpan"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https", "data"],
    href: ["http", "https", "mailto", "#"],
  },
};


interface LazyImageProps {
  src?: string;
  alt?: string;
  title?: string;
  className?: string;
  maxHeight?: string;
}

const LazyImage = memo(function LazyImage({
  src,
  alt,
  title,
  className,
  maxHeight = "400px"
}: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setError(true), []);

  if (!src) return null;

  // Check if this is a Gmail logo - render inline and small
  const isGmailLogo = src.includes('gmail-logo') || (alt?.toLowerCase() === 'gmail');

  if (isGmailLogo) {
    return (
      <img
        src={src}
        alt={alt || "Gmail"}
        title={title || "Ver en Gmail"}
        loading="eager"
        decoding="async"
        className="inline-block align-text-bottom ml-1.5 w-[1.4em] h-[1.4em]"
        data-testid="img-gmail-logo"
      />
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center bg-muted rounded-lg p-4 my-3 text-muted-foreground text-sm">
        Error loading image
      </div>
    );
  }

  return (
    <div className="relative my-3">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted rounded-lg">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <img
        src={src}
        alt={alt || "Image"}
        title={title}
        loading="lazy"
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          "max-w-full h-auto rounded-lg transition-opacity duration-300 max-h-[var(--img-max-h)]",
          loaded ? "opacity-100" : "opacity-0",
          className
        )}
        ref={(el) => { if (el) el.style.setProperty('--img-max-h', typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight); }}
        data-testid="img-markdown"
      />
    </div>
  );
});

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  onOpenDocument?: (doc: { type: 'word' | 'excel' | 'ppt'; title: string; content: string }) => void;
}

const ShikiCodeContent = memo(function ShikiCodeContent({ code, language }: { code: string; language: string }) {
  const { html, isLoading } = useShikiHighlight(code, language || 'text');

  if (isLoading) {
    return (
      <pre className="rounded-lg overflow-x-auto p-4 pt-8 bg-muted/30">
        <code className="text-sm font-mono">{code}</code>
      </pre>
    );
  }

  return (
    <div
      className="shiki-wrapper rounded-lg overflow-x-auto [&>pre]:p-4 [&>pre]:pt-8 [&>pre]:m-0 [&>pre]:rounded-lg [&>pre]:overflow-x-auto [&_code]:text-sm [&_code]:font-mono"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

const CodeBlock = memo(function CodeBlock({ inline, className, children, onOpenDocument }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const language = (match?.[1] || "").toLowerCase().trim();
  const codeContent = String(children).replace(/\n$/, "");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [codeContent]);

  if (inline) {
    return (
      <code className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono">
        {children}
      </code>
    );
  }

  const docDetection = detectDocumentJSON(codeContent);
  const isDocumentLanguage = language === 'document' || language === 'json';

  if (docDetection.isDocument && (isDocumentLanguage || !language)) {
    const handleOpenDocument = () => {
      if (!docDetection.isComplete || !docDetection.type) return;

      try {
        const parsed = JSON.parse(codeContent);
        if (parsed.type && parsed.title && parsed.content) {
          let docContent = parsed.content;
          if (typeof docContent === 'string') {
            docContent = docContent.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');
          }
          onOpenDocument?.({
            type: parsed.type,
            title: parsed.title,
            content: docContent
          });
        }
      } catch (e) {
        console.error('Failed to parse document JSON:', e);
      }
    };

    return (
      <div className="my-4">
        <DocumentGenerationLoader
          documentType={docDetection.type || 'word'}
          title={docDetection.title}
          isComplete={docDetection.isComplete}
          onOpen={handleOpenDocument}
        />
      </div>
    );
  }

  // Mermaid diagram rendering — detect ```mermaid blocks and render inline
  if (language === "mermaid") {
    return (
      <RenderBlockWrapper type="mermaid" code={codeContent}>
        <MermaidDiagram code={codeContent} />
      </RenderBlockWrapper>
    );
  }

  // SVG rendering — detect ```svg blocks and render sanitized SVG inline
  if (language === "svg" || (language === "xml" && codeContent.trimStart().startsWith("<svg"))) {
    // DOMPurify sanitizes the SVG to prevent XSS while keeping valid SVG elements
    const sanitizedSvg = DOMPurify.sanitize(codeContent, { USE_PROFILES: { svg: true, svgFilters: true } });
    return (
      <RenderBlockWrapper type="svg" code={codeContent}>
        <div className="flex justify-center [&>svg]:max-w-full [&>svg]:h-auto">
          <SanitizedSvgBlock html={sanitizedSvg} />
        </div>
      </RenderBlockWrapper>
    );
  }

  // HTML visual rendering — detect ```html blocks that contain visual elements
  if (language === "html" && /(<(svg|canvas|table\s|div\s[^>]*style|section\s[^>]*style|header\s[^>]*style|main\s[^>]*style))/i.test(codeContent)) {
    return (
      <RenderBlockWrapper type="html" code={codeContent}>
        <iframe
          srcDoc={codeContent}
          className="w-full border-0 rounded-lg bg-white"
          style={{ minHeight: "200px", maxHeight: "600px", height: "400px" }}
          sandbox="allow-scripts allow-same-origin"
          title="HTML Preview"
        />
      </RenderBlockWrapper>
    );
  }

  const lineCount = codeContent.split("\n").length;
  const showArtifactButton = lineCount > 15;

  const handleOpenAsArtifact = useCallback(() => {
    const store = useArtifactStore.getState();
    const id = `code-${Date.now()}`;
    store.openArtifact({
      id,
      type: "code",
      title: language ? `${language} snippet` : "Code",
      content: codeContent,
      language: language || undefined,
      messageId: "",
    });
  }, [codeContent, language]);

  return (
    <div className="relative group my-4">
      {language && (
        <div className="absolute top-0 left-0 px-3 py-1 text-xs font-mono text-muted-foreground bg-muted/50 rounded-tl-lg rounded-br-lg z-10">
          {language}
        </div>
      )}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        {showArtifactButton && (
          <button
            onClick={handleOpenAsArtifact}
            className="p-1.5 rounded-md bg-muted/80 hover:bg-muted transition-colors"
            aria-label="Open as Artifact"
            title="Open as Artifact"
            data-testid="button-open-artifact"
          >
            <Maximize2 className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-md bg-muted/80 hover:bg-muted transition-colors"
          aria-label={copied ? "Copied" : "Copy code"}
          data-testid="button-copy-code"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </div>
      <ShikiCodeContent code={codeContent} language={language} />
    </div>
  );
});

interface TableWrapperProps {
  children?: React.ReactNode;
}

const TableWrapper = memo(function TableWrapper({ children }: TableWrapperProps) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const handleCopy = useCallback(async () => {
    if (!tableRef.current) return;
    const table = tableRef.current.querySelector('table');
    if (!table) return;

    const rows = table.querySelectorAll('tr');
    const text = Array.from(rows).map(row => {
      const cells = row.querySelectorAll('th, td');
      return Array.from(cells).map(cell => cell.textContent?.trim() || '').join('\t');
    }).join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy table:', err);
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!tableRef.current) return;
    const table = tableRef.current.querySelector('table');
    if (!table) return;

    const rows = table.querySelectorAll('tr');
    const csv = Array.from(rows).map(row => {
      const cells = row.querySelectorAll('th, td');
      return Array.from(cells).map(cell => {
        const text = cell.textContent?.trim() || '';
        return text.includes(',') ? `"${text}"` : text;
      }).join(',');
    }).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tabla.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div
      ref={tableRef}
      className={cn(
        "relative group my-4",
        isExpanded && "fixed inset-4 z-50 bg-background rounded-lg border shadow-2xl overflow-auto p-4"
      )}
    >
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-md bg-muted/80 hover:bg-muted border border-border/50"
          title={copied ? "Copiado" : "Copiar tabla"}
          data-testid="button-copy-table"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <button
          onClick={handleDownload}
          className="p-1.5 rounded-md bg-muted/80 hover:bg-muted border border-border/50"
          title="Descargar CSV"
          data-testid="button-download-table"
        >
          <Download className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 rounded-md bg-muted/80 hover:bg-muted border border-border/50"
          title={isExpanded ? "Minimizar" : "Expandir"}
          data-testid="button-expand-table"
        >
          {isExpanded ? (
            <Minimize2 className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Maximize2 className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse border border-border rounded-lg" data-testid="table-markdown">
          {children}
        </table>
      </div>
    </div>
  );
});

interface TableComponents {
  table: React.ComponentType<{ children?: React.ReactNode }>;
  thead: React.ComponentType<{ children?: React.ReactNode }>;
  tbody: React.ComponentType<{ children?: React.ReactNode }>;
  tr: React.ComponentType<{ children?: React.ReactNode }>;
  th: React.ComponentType<{ children?: React.ReactNode }>;
  td: React.ComponentType<{ children?: React.ReactNode }>;
}

const tableComponents: TableComponents = {
  table: TableWrapper,
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-muted/30 transition-colors">{children}</tr>,
  th: ({ children }) => (
    <th className="px-4 py-2 text-left text-sm font-semibold border border-border">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-2 text-sm border border-border">{children}</td>
  ),
};

interface InteractiveCodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  runnable?: boolean;
  editable?: boolean;
  onEdit?: (code: string) => void;
}

const InteractiveCodeBlock = memo(function InteractiveCodeBlock({
  inline,
  className,
  children,
  runnable = true,
  editable = false,
  onEdit,
}: InteractiveCodeBlockProps) {
  const match = /language-(\w+)/.exec(className || "");
  const language = (match?.[1] || "text").toLowerCase().trim();
  const codeContent = String(children).replace(/\n$/, "");

  const { execute, isRunning, result, errorLines, reset } = useSandboxExecution();

  const isRunnable = runnable && isLanguageRunnable(language);

  const handleRun = useCallback(async () => {
    await execute(codeContent, language);
  }, [execute, codeContent, language]);

  const handleEdit = useCallback(() => {
    onEdit?.(codeContent);
  }, [onEdit, codeContent]);

  if (inline) {
    return (
      <code className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono">
        {children}
      </code>
    );
  }

  // Document generation code (has saveFile + library imports) — auto-execute and show result
  if ((language === "javascript" || language === "js") && codeContent.includes("saveFile") && (
    codeContent.includes("pptxgenjs") || codeContent.includes("PptxGenJS") ||
    codeContent.includes("exceljs") || codeContent.includes("ExcelJS") ||
    codeContent.includes("require(\"docx\")") || codeContent.includes("require('docx')") ||
    codeContent.includes("pdfkit") || codeContent.includes("PDFDocument")
  )) {
    const { ExecutableCodeBlock } = require("./chat/ExecutableCodeBlock");
    return <ExecutableCodeBlock code={codeContent} language={language} autoRun={true} />;
  }

  // Mermaid diagrams render inline as SVG with action buttons
  if (language === "mermaid") {
    return (
      <RenderBlockWrapper type="mermaid" code={codeContent}>
        <MermaidDiagram code={codeContent} />
      </RenderBlockWrapper>
    );
  }

  // SVG renders inline with action buttons — detect both ```svg and ```xml with <svg content
  if (language === "svg" || (language === "xml" && codeContent.trimStart().startsWith("<svg")) || (!language && codeContent.trimStart().startsWith("<svg"))) {
    return (
      <RenderBlockWrapper type="svg" code={codeContent}>
        <InlineSvgBlock code={codeContent} />
      </RenderBlockWrapper>
    );
  }

  // HTML renders inline with action buttons (documents, presentations, tables)
  if (language === "html" && codeContent.length > 100 && (codeContent.includes("<style") || codeContent.includes("<table") || codeContent.includes("<section") || codeContent.includes("<div"))) {
    return (
      <RenderBlockWrapper type="html" code={codeContent}>
        <InlineHtmlBlock code={codeContent} />
      </RenderBlockWrapper>
    );
  }

  return (
    <div className="my-4 space-y-2">
      <CodeBlockShell
        code={codeContent}
        language={language}
        showLineNumbers={true}
        maxHeight="400px"
        errorLines={errorLines}
        runnable={isRunnable}
        editable={editable}
        onRun={isRunnable ? handleRun : undefined}
        onEdit={editable ? handleEdit : undefined}
      />
      {isRunning && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground px-3 py-2 bg-muted/30 rounded-md">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Running...</span>
        </div>
      )}
      {result && !isRunning && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden">
          <div className="px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-xs text-zinc-400 font-mono">
              Output {result.usedFallback && "(local fallback)"}
            </span>
            <button
              onClick={reset}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              data-testid="button-clear-output"
            >
              Clear
            </button>
          </div>
          <div className="p-3 font-mono text-sm overflow-x-auto">
            {result.run.stdout && (
              <pre className="text-green-400 whitespace-pre-wrap">{result.run.stdout}</pre>
            )}
            {result.run.stderr && (
              <pre className="text-red-400 whitespace-pre-wrap">{result.run.stderr}</pre>
            )}
            {!result.run.stdout && !result.run.stderr && (
              <span className="text-zinc-500 italic">No output</span>
            )}
          </div>
          {result.run.code !== 0 && (
            <div className="px-3 py-1.5 bg-red-500/10 border-t border-zinc-800 text-xs text-red-400">
              Exit code: {result.run.code}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  imageMaxHeight?: string;
  enableMath?: boolean;
  enableCodeHighlight?: boolean;
  enableGfm?: boolean;
  sanitize?: boolean;
  enableInteractiveCode?: boolean;
  interactiveCodeEditable?: boolean;
  onCodeEdit?: (code: string) => void;
  onOpenDocument?: (doc: { type: 'word' | 'excel' | 'ppt'; title: string; content: string }) => void;
  customComponents?: Record<string, React.ComponentType<any>>;
  webSources?: Array<{ url: string; siteName?: string; domain: string }>;
}

function isSimpleContent(text: string): boolean {
  if (!text || text.length < 5) return true;
  const hasCodeBlocks = /```[\s\S]*```|`[^`]+`/.test(text);
  const hasMath = /\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$|\\[[\s\S]+?\\]|\\([\s\S]+?\\)/.test(text);
  const hasComplexMarkdown = /^#{1,6}\s|^\s*[-*+]\s|\|.*\|.*\||!\[.*\]\(.*\)/m.test(text);
  const hasLinks = /\[.*?\]\(.*?\)/.test(text);
  const hasBold = /\*\*[^*]+\*\*|__[^_]+__/.test(text);
  const hasItalic = /\*[^*]+\*|_[^_]+_/.test(text);
  const hasSourceBadges = /%%SOURCE%%/.test(text);
  return !hasCodeBlocks && !hasMath && !hasComplexMarkdown && !hasLinks && !hasBold && !hasItalic && !hasSourceBadges;
}

function SafeSimpleRenderer({ content, className }: { content: string; className?: string }) {
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none", className)} data-testid="markdown-renderer-simple">
      {paragraphs.map((p, i) => (
        <p key={i} className="mb-3 leading-relaxed whitespace-pre-wrap">{p}</p>
      ))}
    </div>
  );
}

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return children.toString();
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (typeof children === 'object' && children !== null && 'props' in children) {
    return extractText((children as any).props.children);
  }
  return '';
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  imageMaxHeight = "400px",
  enableMath = true,
  enableCodeHighlight = true,
  enableGfm = true,
  sanitize = true,
  enableInteractiveCode = false,
  interactiveCodeEditable = false,
  onCodeEdit,
  onOpenDocument,
  customComponents = {},
  webSources,
}: MarkdownRendererProps) {
  const [renderError, setRenderError] = useState<Error | null>(null);

  const processedContent = useMemo(() => {
    if (!content) return "";
    try {
      let processed = content;
      processed = preprocessSourceBadges(processed, webSources);
      const sanitized = sanitize ? sanitizeContent(processed) : processed;
      return enableMath ? preprocessMathInMarkdown(sanitized) : sanitized;
    } catch (error) {
      console.error('[MarkdownRenderer] Content processing error:', error);
      return content;
    }
  }, [content, enableMath, sanitize, webSources]);

  useEffect(() => {
    setRenderError(null);
  }, [processedContent]);

  const isSimple = useMemo(() => isSimpleContent(content || ''), [content]);

  const remarkPlugins = useMemo(() => {
    const plugins: any[] = [];
    if (enableGfm && !isSimple) plugins.push(remarkGfm);
    if (enableMath && !isSimple) plugins.push(remarkMath);
    return plugins;
  }, [enableGfm, enableMath, isSimple]);

  const rehypePlugins = useMemo(() => {
    const plugins: any[] = [];
    if (isSimple) return plugins;
    if (sanitize && !enableMath) {
      plugins.push([rehypeSanitize, sanitizeSchema]);
    }
    if (enableMath) {
      plugins.push([rehypeKatex, {
        throwOnError: false,
        errorColor: '#cc0000',
        strict: false,
        trust: false,
        output: 'htmlAndMathml'
      }]);
    }
    // Shiki-based highlighting is now handled at the component level (ShikiCodeContent)
    // rehypeHighlight is kept as an import for potential fallback but no longer added to plugins
    return plugins;
  }, [enableMath, sanitize, isSimple]);

  const CodeComponent = useMemo(() => {
    if (enableInteractiveCode) {
      return (props: any) => (
        <InteractiveCodeBlock
          {...props}
          editable={interactiveCodeEditable}
          onEdit={onCodeEdit}
        />
      );
    }
    return (props: any) => <CodeBlock {...props} onOpenDocument={onOpenDocument} />;
  }, [enableInteractiveCode, interactiveCodeEditable, onCodeEdit, onOpenDocument]);

  const components = useMemo(() => ({
    code: CodeComponent,
    img: (props: any) => <LazyImage {...props} maxHeight={imageMaxHeight} />,
    p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 leading-[1.75] text-[15px]">{children}</p>,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const childText = extractText(children).trim();

      const sourceMatch = childText.match(/^%%SOURCE%%(.+)%%SOURCE%%$/);
      if (sourceMatch && href) {
        return <InlineSourceBadge name={sourceMatch[1]} url={href} />;
      }

      let domain = "";
      try { if (href) domain = new URL(href).hostname.replace(/^www\./, ""); } catch {}

      const isDOI = href?.includes("doi.org/");
      const isLocalArtifactLink = typeof href === "string" && /^\/api\/artifacts\//.test(href);

      return (
        <a
          href={href}
          target={isLocalArtifactLink ? undefined : "_blank"}
          rel={isLocalArtifactLink ? undefined : "noopener noreferrer"}
          download={isLocalArtifactLink ? true : undefined}
          onClick={(event) => {
            if (!isLocalArtifactLink || !href) {
              return;
            }
            event.preventDefault();
            void downloadArtifact(href, childText || undefined).catch((error) => {
              console.error("[MarkdownRenderer] Failed to download local artifact:", error);
              window.open(href, "_blank", "noopener,noreferrer");
            });
          }}
          className={cn(
            "inline-flex items-center gap-1 transition-colors no-underline",
            isLocalArtifactLink
              ? "text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white font-medium"
              : isDOI
              ? "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-mono text-[13px]"
              : "text-sky-500 hover:text-sky-400 hover:underline"
          )}
          data-testid="link-markdown"
        >
          {isLocalArtifactLink ? <Download className="w-3 h-3 flex-shrink-0" /> : null}
          {!isLocalArtifactLink && isDOI && <ExternalLink className="w-3 h-3 flex-shrink-0" />}
          {children}
        </a>
      );
    },
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="mb-4 space-y-1.5 pl-1">{children}</ul>
    ),
    ol: ({ children, start }: { children?: React.ReactNode; start?: number }) => {
      const text = extractText(children);
      const signals = [
        /\(\d{4}[a-z]?\)/.test(text),
        /doi\.org/i.test(text),
        /\bet\s+al\./i.test(text),
        /https?:\/\/doi/i.test(text),
      ].filter(Boolean).length;
      const isCitation = signals >= 2;

      if (isCitation) {
        return (
          <ol start={start} className="mb-4 space-y-3 pl-0 list-none" data-testid="citation-list">
            {children}
          </ol>
        );
      }

      return (
        <ol start={start} className="list-decimal mb-4 space-y-1.5 pl-6" data-testid="ordered-list">
          {children}
        </ol>
      );
    },
    li: ({ children, node, ...props }: { children?: React.ReactNode; node?: any; ordered?: boolean; index?: number }) => {
      const text = extractText(children);
      const hasCitationSignals = [
        /\(\d{4}[a-z]?\)/.test(text),
        /doi\.org/i.test(text),
        /\bet\s+al\./i.test(text),
        /https?:\/\/doi/i.test(text),
      ].filter(Boolean).length;
      const isCitation = hasCitationSignals >= 2;

      if (isCitation) {
        const itemIndex = typeof props.index === 'number' ? props.index + 1 : null;
        const yearMatch = text.match(/\((\d{4}[a-z]?)\)/);
        const doiMatch = text.match(/https?:\/\/doi\.org\/[^\s)]+/);
        const italicMatch = text.match(/\*([^*]+)\*/);

        return (
          <li className="relative flex gap-3 p-3 rounded-xl bg-muted/30 border border-border/50 hover:border-primary/30 hover:bg-muted/50 transition-all group list-none" data-testid="citation-item">
            {itemIndex && (
              <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                {itemIndex}
              </span>
            )}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="text-[14px] leading-relaxed text-foreground/90">{children}</div>
              <div className="flex items-center gap-2 flex-wrap">
                {yearMatch && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[11px] font-medium">
                    {yearMatch[1]}
                  </span>
                )}
                {doiMatch && (
                  <a
                    href={doiMatch[0]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium hover:bg-emerald-500/20 transition-colors no-underline"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    DOI
                  </a>
                )}
                {italicMatch && (
                  <span className="text-[11px] text-muted-foreground italic truncate max-w-[200px]">
                    {italicMatch[1]}
                  </span>
                )}
              </div>
            </div>
          </li>
        );
      }

      return (
        <li className="text-[15px] leading-relaxed ml-2 pl-1 marker:text-primary/60">{children}</li>
      );
    },
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="text-2xl font-bold mb-4 mt-6 pb-2 border-b border-border/50 text-foreground">{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="text-xl font-bold mb-3 mt-5 text-foreground">{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="text-lg font-semibold mb-2 mt-4 text-foreground/90">{children}</h3>
    ),
    h4: ({ children }: { children?: React.ReactNode }) => (
      <h4 className="text-base font-semibold mb-2 mt-3 text-foreground/80">{children}</h4>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="border-l-[3px] border-primary/40 pl-4 py-1 my-4 bg-primary/[0.03] rounded-r-lg text-muted-foreground italic">
        {children}
      </blockquote>
    ),
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <em className="italic text-foreground/80">{children}</em>
    ),
    hr: () => <hr className="my-6 border-border/50" />,
    ...tableComponents,
    ...customComponents,
  }), [imageMaxHeight, customComponents, CodeComponent]);

  if (!processedContent) {
    return null;
  }

  if (renderError || isSimple) {
    return <SafeSimpleRenderer content={processedContent || content} className={className} />;
  }

  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none", className)} data-testid="markdown-renderer">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownRenderer;
