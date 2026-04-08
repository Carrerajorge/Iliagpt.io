/**
 * ExecutableCodeBlock — Detects document-generating code blocks (with saveFile()),
 * auto-executes them on the server, and shows the result with download button.
 * Replaces raw code display with: [Running...] → [Preview + Download]
 */

import React, { useState, useEffect, useRef, useCallback, memo } from "react";
import { Play, Download, Loader2, Check, AlertCircle, Code2, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiClient";

interface GeneratedFile {
  filename: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
  previewHtml: string;
}

interface Props {
  code: string;
  language: string;
  autoRun?: boolean;
}

export const ExecutableCodeBlock = memo(function ExecutableCodeBlock({ code, language, autoRun = true }: Props) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const ranRef = useRef(false);

  const isDocumentCode = code.includes("saveFile") && (
    code.includes("pptxgenjs") || code.includes("PptxGenJS") ||
    code.includes("exceljs") || code.includes("ExcelJS") ||
    code.includes("docx") || code.includes("Document") ||
    code.includes("pdfkit") || code.includes("PDFDocument") ||
    code.includes("require(")
  );

  const execute = useCallback(async () => {
    if (status === "running") return;
    setStatus("running");
    setError("");
    setFiles([]);

    try {
      const res = await apiFetch("/api/execute-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language: "javascript" }),
      });
      const data = await res.json();

      if (data.success && data.files?.length > 0) {
        setFiles(data.files);
        setOutput(data.output || "");
        setStatus("done");
      } else {
        setError(data.error || "No files generated");
        setOutput(data.output || "");
        setStatus("error");
      }
    } catch (err: any) {
      setError(err?.message || "Execution failed");
      setStatus("error");
    }
  }, [code, status]);

  // Auto-run on mount if it's document code
  useEffect(() => {
    if (autoRun && isDocumentCode && !ranRef.current && status === "idle") {
      ranRef.current = true;
      // Debounce to avoid running on incomplete streaming code
      const timer = setTimeout(execute, 800);
      return () => clearTimeout(timer);
    }
  }, [autoRun, isDocumentCode, status, execute]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  // If not document code, don't render this component (let normal code block handle it)
  if (!isDocumentCode) return null;

  return (
    <div className="my-4 rounded-xl border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-900/60 shadow-sm overflow-hidden">
      {/* Status Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          {status === "running" && (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">Generando documento...</span>
            </>
          )}
          {status === "done" && (
            <>
              <Check className="h-4 w-4 text-emerald-500" />
              <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                {files.length} archivo{files.length !== 1 ? "s" : ""} generado{files.length !== 1 ? "s" : ""}
              </span>
            </>
          )}
          {status === "error" && (
            <>
              <AlertCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm text-red-600 dark:text-red-400 font-medium">Error en la generación</span>
            </>
          )}
          {status === "idle" && (
            <>
              <Code2 className="h-4 w-4 text-zinc-400" />
              <span className="text-sm text-zinc-500 font-medium">Código de documento</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {status === "idle" && (
            <button onClick={execute} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
              <Play className="h-3 w-3" /> Ejecutar
            </button>
          )}
          {status === "error" && (
            <button onClick={() => { ranRef.current = false; setStatus("idle"); setTimeout(execute, 100); }} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              Reintentar
            </button>
          )}
          <button onClick={() => setShowCode(!showCode)} className={cn("flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors", showCode ? "text-blue-600 bg-blue-50 dark:bg-blue-900/20" : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800")}>
            <Code2 className="h-3 w-3" />
            {showCode ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Generated Files */}
      {files.length > 0 && (
        <div className="p-3 space-y-2">
          {files.map((file, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
              <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-xs",
                file.mimeType.includes("presentation") ? "bg-orange-500" :
                file.mimeType.includes("spreadsheet") ? "bg-emerald-600" :
                file.mimeType.includes("word") ? "bg-blue-600" :
                file.mimeType.includes("pdf") ? "bg-red-600" : "bg-zinc-600"
              )}>
                {file.filename.split(".").pop()?.toUpperCase() || "FILE"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{file.filename}</p>
                <p className="text-[11px] text-zinc-400">{Math.round(file.size / 1024)} KB</p>
              </div>
              <a href={file.downloadUrl} download={file.filename}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors">
                <Download className="h-3.5 w-3.5" /> Descargar
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Error Details */}
      {status === "error" && error && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Console Output */}
      {output && status !== "idle" && (
        <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800">
          <pre className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap max-h-20 overflow-auto">{output}</pre>
        </div>
      )}

      {/* Code Viewer (expandable) */}
      <div className={cn("overflow-hidden transition-all duration-200", showCode ? "max-h-[400px]" : "max-h-0")}>
        <pre className="bg-zinc-900 dark:bg-zinc-950 text-zinc-300 p-4 text-[11px] font-mono leading-5 overflow-auto max-h-[380px] border-t border-zinc-800">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
});

export default ExecutableCodeBlock;
