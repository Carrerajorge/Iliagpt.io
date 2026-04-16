/**
 * RenderBlockWrapper — Action bar for rendered blocks (SVG, Mermaid, HTML, etc.)
 *
 * Shows 4 buttons at the bottom: Regenerate, Copy Code, Download, View Code.
 */

import { useState, useCallback, useRef } from "react";
import { RefreshCw, Copy, Check, Download, Code2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface RenderBlockWrapperProps {
  type: "svg" | "mermaid" | "html" | "chart" | "table";
  code: string;
  children: React.ReactNode;
  onRegenerate?: () => void;
}

function getFileExtension(type: string): string {
  switch (type) {
    case "svg": return ".svg";
    case "mermaid": return ".mmd";
    case "html": case "chart": return ".html";
    case "table": return ".html";
    default: return ".txt";
  }
}

function getMimeType(type: string): string {
  switch (type) {
    case "svg": return "image/svg+xml";
    case "html": case "chart": case "table": return "text/html";
    default: return "text/plain";
  }
}

export function RenderBlockWrapper({ type, code, children, onRegenerate }: RenderBlockWrapperProps) {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Código copiado");
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([code], { type: getMimeType(type) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `render-${Date.now()}${getFileExtension(type)}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Archivo descargado");
  }, [code, type]);

  const handleRegenerate = useCallback(() => {
    if (onRegenerate) {
      onRegenerate();
    } else {
      // Dispatch event so chat can pick it up
      const typeLabel = type === "svg" ? "SVG" : type === "mermaid" ? "diagrama" : type === "chart" ? "gráfico" : type === "html" ? "HTML" : "visualización";
      window.dispatchEvent(new CustomEvent("codex-regenerate", {
        detail: { message: `Regenera el ${typeLabel} anterior con otro estilo diferente y más profesional` }
      }));
    }
  }, [type, onRegenerate]);

  return (
    <div className="my-4 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] shadow-sm overflow-hidden">
      {/* Rendered content */}
      <div className="p-4 overflow-hidden bg-white dark:bg-zinc-900 [&>svg]:max-w-full [&>svg]:h-auto [&>div]:max-w-full">
        {children}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-center gap-1 px-3 py-2 border-t border-gray-100 dark:border-white/[0.06] bg-gray-50/50 dark:bg-white/[0.02]">
        <button
          onClick={handleRegenerate}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/70 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          title="Regenerar"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Regenerar</span>
        </button>

        <div className="w-px h-4 bg-gray-200 dark:bg-white/10 mx-0.5" />

        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/70 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          title="Copiar código"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{copied ? "Copiado" : "Copiar"}</span>
        </button>

        <div className="w-px h-4 bg-gray-200 dark:bg-white/10 mx-0.5" />

        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/70 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          title="Descargar"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Descargar</span>
        </button>

        <div className="w-px h-4 bg-gray-200 dark:bg-white/10 mx-0.5" />

        <button
          onClick={() => setShowCode(!showCode)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-colors",
            showCode
              ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10"
              : "text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/70 hover:bg-gray-100 dark:hover:bg-white/10"
          )}
          title="Ver código"
        >
          <Code2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Código</span>
          {showCode ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {/* Code viewer (expandable) */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200",
          showCode ? "max-h-[400px]" : "max-h-0"
        )}
      >
        <div className="relative border-t border-gray-200 dark:border-white/[0.06]">
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1.5 rounded-md bg-gray-700/80 hover:bg-gray-600 text-gray-300 transition-colors z-10"
            title="Copiar"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <pre className="bg-gray-900 dark:bg-[#0a0a15] text-gray-300 p-4 text-[11px] font-mono leading-5 overflow-auto max-h-[380px]">
            <code>{code}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
