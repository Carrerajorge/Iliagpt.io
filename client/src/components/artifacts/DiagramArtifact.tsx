import { useState, useEffect, useRef, useCallback } from "react";
import DOMPurify from "dompurify";
import { Copy, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DiagramArtifactProps {
  content: string;
}

export function DiagramArtifact({ content }: DiagramArtifactProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgOutput, setSvgOutput] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
        });

        const id = `mermaid-${Date.now()}`;
        const { svg } = await mermaid.render(id, content);

        if (!cancelled) {
          setSvgOutput(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to render diagram"
          );
          setSvgOutput("");
        }
      }
    }

    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [content]);

  const handleCopySvg = useCallback(async () => {
    const textToCopy = svgOutput || content;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [svgOutput, content]);

  const sanitizedSvg = svgOutput
    ? DOMPurify.sanitize(svgOutput, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ["use"],
      })
    : "";

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/50">
        <span className="text-xs text-muted-foreground">
          {error ? "Mermaid source" : "Mermaid diagram"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={handleCopySvg}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              {svgOutput ? "Copy SVG" : "Copy source"}
            </>
          )}
        </Button>
      </div>

      {/* Diagram or fallback */}
      <div className="flex-1 overflow-auto p-4">
        {error ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-amber-500 text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>Could not render diagram: {error}</span>
            </div>
            <pre className="p-4 text-sm font-mono bg-slate-950 text-slate-300 rounded-lg overflow-auto whitespace-pre-wrap">
              {content}
            </pre>
          </div>
        ) : sanitizedSvg ? (
          <div
            ref={containerRef}
            className="flex items-center justify-center"
            dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
          />
        ) : (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            Rendering diagram...
          </div>
        )}
      </div>
    </div>
  );
}
