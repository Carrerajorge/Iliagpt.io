import React, { memo, useState, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { convertToLatex, sanitizeMathInput } from "@/lib/mathParser";
import { loadMathJax } from "@/lib/mathjaxLoader";
import { Loader2, AlertCircle } from "lucide-react";
import katex from "katex";

declare global {
  interface Window {
    MathJax?: {
      typesetPromise?: (elements?: HTMLElement[]) => Promise<void>;
      tex2chtml?: (latex: string, options?: any) => HTMLElement;
      startup?: {
        promise: Promise<void>;
        defaultReady: () => void;
      };
    };
  }
}

export interface MathRendererProps {
  content: string;
  block?: boolean;
  className?: string;
  fallbackToMathJax?: boolean;
  showError?: boolean;
}

type RenderStatus = "idle" | "loading" | "success" | "loading-mathjax" | "mathjax-ready" | "fallback" | "error";

interface RenderState {
  status: RenderStatus;
  html: string;
  error?: string;
  latex?: string;
  displayMode?: boolean;
  version?: number;
}

function renderWithKatex(latex: string, displayMode: boolean): { html: string; success: boolean; error?: string } {
  try {
    const sanitized = sanitizeMathInput(latex);
    const html = katex.renderToString(sanitized, {
      displayMode,
      throwOnError: true,
      trust: false,
      strict: "warn",
      maxSize: 500,
      maxExpand: 100,
    });
    
    return { html, success: true };
  } catch (error: any) {
    return { 
      html: "", 
      success: false, 
      error: error.message || "KaTeX render error" 
    };
  }
}

export const MathRenderer = memo(function MathRenderer({
  content,
  block = false,
  className,
  fallbackToMathJax = true,
  showError = true,
}: MathRendererProps) {
  const [state, setState] = useState<RenderState>({ status: "idle", html: "", version: 0 });
  const containerRef = useRef<HTMLSpanElement>(null);
  const versionRef = useRef(0);
  const normalizedPreview = useRef("");

  useEffect(() => {
    versionRef.current += 1;
    const currentVersion = versionRef.current;
    
    if (!content) {
      setState({ status: "success", html: "", version: currentVersion });
      return;
    }

    setState({ status: "loading", html: "", version: currentVersion });

    const { latex, isBlock } = convertToLatex(content);
    normalizedPreview.current = latex;
    const displayMode = block || isBlock;
    const katexResult = renderWithKatex(latex, displayMode);
    
    if (katexResult.success) {
      if (versionRef.current === currentVersion) {
        setState({ status: "success", html: katexResult.html, version: currentVersion });
      }
      return;
    }
    if (!fallbackToMathJax) {
      if (versionRef.current === currentVersion) {
        setState({ 
          status: "error", 
          html: "", 
          error: katexResult.error,
          version: currentVersion 
        });
      }
      return;
    }
    if (versionRef.current === currentVersion) {
      setState({ 
        status: "loading-mathjax", 
        html: "", 
        latex, 
        displayMode,
        version: currentVersion 
      });
    }
  }, [content, block, fallbackToMathJax]);

  useEffect(() => {
    if (state.status !== "mathjax-ready" || !containerRef.current || !state.latex) {
      return;
    }

    const currentVersion = state.version;

    const runMathJax = async () => {
      try {
        await loadMathJax();
        if (versionRef.current !== currentVersion || !containerRef.current) return;
        
        const sanitizedLatex = sanitizeMathInput(state.latex ?? "");
        const mathContent = state.displayMode 
          ? `$$${sanitizedLatex}$$` 
          : `$${sanitizedLatex}$`;
        containerRef.current.textContent = mathContent;
        
        if (window.MathJax?.typesetPromise) {
          await window.MathJax.typesetPromise([containerRef.current]);
          if (versionRef.current === currentVersion && containerRef.current) {
            setState(prev => {
              if (prev.version !== currentVersion) return prev;
              return { 
                ...prev, 
                status: "fallback", 
                html: containerRef.current?.innerHTML || "" 
              };
            });
          }
        }
      } catch (error: any) {
        if (versionRef.current === currentVersion) {
          setState(prev => {
            if (prev.version !== currentVersion) return prev;
            return { 
              status: "error", 
              html: "", 
              error: error.message || "MathJax render failed",
              version: currentVersion 
            };
          });
        }
      }
    };

    runMathJax();
  }, [state.status, state.latex, state.displayMode, state.version]);

  useEffect(() => {
    if (state.status === "loading-mathjax") {
      const timer = requestAnimationFrame(() => {
        if (versionRef.current === state.version && containerRef.current) {
          setState(prev => {
            if (prev.version !== state.version) return prev;
            return { ...prev, status: "mathjax-ready" };
          });
        }
      });
      return () => cancelAnimationFrame(timer);
    }
  }, [state.status, state.version]);

  if (state.status === "loading") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-muted-foreground", className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Rendering...</span>
      </span>
    );
  }

  if (state.status === "error" && showError) {
    return (
      <span
        className={cn(
          block
            ? "flex flex-col gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
            : "inline-flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1 text-sm text-destructive",
          className
        )}
        title={state.error}
      >
        <span className="inline-flex items-center gap-1 font-medium">
          <AlertCircle className="h-3.5 w-3.5" />
          LaTeX no válido
        </span>
        <code className="max-w-full overflow-x-auto rounded bg-destructive/10 px-2 py-1 text-xs text-destructive/90">
          {normalizedPreview.current || content}
        </code>
      </span>
    );
  }

  if (state.status === "loading-mathjax" || state.status === "mathjax-ready") {
    return (
      <span
        ref={containerRef}
        className={cn(
          "inline-flex items-center gap-1",
          block ? "block my-4" : "inline",
          className
        )}
        data-testid="math-loading-mathjax"
      >
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading MathJax...</span>
      </span>
    );
  }

  if (state.status === "fallback") {
    return (
      <span
        ref={containerRef}
        className={cn(
          block ? "block my-4 overflow-x-auto" : "inline",
          className
        )}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(state.html) }}
        data-testid="math-mathjax"
      />
    );
  }

  return (
    <span
      ref={containerRef}
      className={cn(
        block ? "katex-display block my-4 overflow-x-auto" : "inline",
        className
      )}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(state.html) }}
      data-testid="math-katex"
    />
  );
});

export interface MathBlockProps {
  children: string;
  className?: string;
}

export const InlineMath = memo(function InlineMath({ children, className }: MathBlockProps) {
  return <MathRenderer content={children} block={false} className={className} />;
});

export const BlockMath = memo(function BlockMath({ children, className }: MathBlockProps) {
  return <MathRenderer content={children} block={true} className={className} />;
});

export default MathRenderer;
