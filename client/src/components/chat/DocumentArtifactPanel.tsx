/**
 * DocumentArtifactPanel — Side panel for document artifact rendering.
 * Renders spreadsheets with cell grid, presentations with slide preview,
 * and documents with formatted HTML. Uses DOMPurify for security.
 */

import React, { useState, useRef, useEffect, memo } from "react";
import { cn } from "@/lib/utils";
import { Download, X, Maximize2, Minimize2, FileSpreadsheet, FileText, Presentation, File } from "lucide-react";
import { SpreadsheetViewer, type SheetData } from "./SpreadsheetViewer";
import DOMPurify from "dompurify";

export interface DocumentArtifact {
  type: "xlsx" | "docx" | "pptx" | "pdf" | "csv";
  filename: string;
  downloadUrl: string;
  previewHtml?: string;
  sheets?: SheetData[];
}

interface Props {
  artifact: DocumentArtifact | null;
  open: boolean;
  onClose: () => void;
}

const TYPE_CONFIG: Record<string, { icon: typeof FileText; label: string; color: string }> = {
  xlsx: { icon: FileSpreadsheet, label: "Hoja de cálculo", color: "bg-emerald-600" },
  csv: { icon: FileSpreadsheet, label: "CSV", color: "bg-emerald-600" },
  docx: { icon: FileText, label: "Documento Word", color: "bg-blue-600" },
  pptx: { icon: Presentation, label: "Presentación", color: "bg-orange-500" },
  pdf: { icon: FileText, label: "PDF", color: "bg-red-600" },
};

/** Sanitize HTML with DOMPurify and render via ref (safe DOM insertion) */
function SafeHtmlContent({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !html) return;
    // Sanitize with DOMPurify before any DOM insertion
    const sanitized = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ["section", "style"],
      ADD_ATTR: ["style"],
    });
    ref.current.replaceChildren();
    // Use template element for safe fragment creation
    const tpl = document.createElement("template");
    tpl.innerHTML = sanitized;
    ref.current.appendChild(tpl.content.cloneNode(true));
  }, [html]);
  return <div ref={ref} className={className} />;
}

export const DocumentArtifactPanel = memo(function DocumentArtifactPanel({ artifact, open, onClose }: Props) {
  const [maximized, setMaximized] = useState(false);
  if (!open || !artifact) return null;

  const config = TYPE_CONFIG[artifact.type] || { icon: File, label: "Documento", color: "bg-zinc-600" };
  const Icon = config.icon;

  return (
    <div className={cn(
      "fixed top-0 right-0 z-50 flex flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 shadow-2xl transition-all duration-300 animate-in slide-in-from-right",
      maximized ? "w-full h-full" : "w-[50vw] max-w-[900px] h-full",
    )}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn("w-6 h-6 rounded flex items-center justify-center shrink-0", config.color)}>
            <Icon className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200 truncate">{artifact.filename}</span>
          <span className="text-[10px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 shrink-0 uppercase">{artifact.type}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <a href={artifact.downloadUrl} download={artifact.filename} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors" title="Descargar">
            <Download className="h-4 w-4 text-zinc-500" />
          </a>
          <button onClick={() => setMaximized(!maximized)} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            {maximized ? <Minimize2 className="h-4 w-4 text-zinc-500" /> : <Maximize2 className="h-4 w-4 text-zinc-500" />}
          </button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            <X className="h-4 w-4 text-zinc-500" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {(artifact.type === "xlsx" || artifact.type === "csv") && artifact.sheets && (
          <SpreadsheetViewer sheets={artifact.sheets} filename={artifact.filename} downloadUrl={artifact.downloadUrl} />
        )}
        {artifact.type === "pptx" && artifact.previewHtml && (
          <div className="h-full overflow-auto p-4 bg-zinc-100 dark:bg-zinc-950">
            <SafeHtmlContent html={artifact.previewHtml} className="max-w-4xl mx-auto" />
          </div>
        )}
        {(artifact.type === "docx" || artifact.type === "pdf") && artifact.previewHtml && (
          <div className="h-full overflow-auto p-6 bg-white dark:bg-zinc-900">
            <SafeHtmlContent html={artifact.previewHtml} className="prose dark:prose-invert max-w-none" />
          </div>
        )}
        {!artifact.sheets && !artifact.previewHtml && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
            <Icon className="h-16 w-16 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500">Vista previa no disponible.</p>
            <a href={artifact.downloadUrl} download={artifact.filename}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium">
              <Download className="h-4 w-4" /> Descargar
            </a>
          </div>
        )}
      </div>
    </div>
  );
});

export default DocumentArtifactPanel;
