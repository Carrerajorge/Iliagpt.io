import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { X, Download, ChevronLeft, ChevronRight, Maximize2, Minimize2, FileText } from "lucide-react";

export interface DocumentPreviewProps {
  url: string;
  fileName: string;
  fileType: string;
  onClose: () => void;
}

export function DocumentPreview({ url, fileName, fileType, onClose }: DocumentPreviewProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleDownload = useCallback(() => {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  }, [url, fileName]);

  // Determine preview mode based on file type
  const ext = fileType.toLowerCase().replace(".", "");
  const canPreview = ["pdf", "html", "png", "jpg", "jpeg", "gif", "svg", "txt"].includes(ext);
  const isOffice = ["docx", "doc", "xlsx", "xls", "pptx", "ppt"].includes(ext);

  // Build preview URL — Office files use Google Docs viewer or Office Online
  const previewUrl = canPreview
    ? url
    : isOffice
      ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(window.location.origin + url)}`
      : null;

  return (
    <div
      className={cn(
        "fixed top-0 right-0 z-50 flex flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 shadow-2xl transition-all duration-300",
        isMaximized ? "w-full h-full" : "w-[50vw] h-full max-w-[800px]",
        "animate-in slide-in-from-right duration-300",
      )}
      data-testid="document-preview"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
        <FileText className="h-4 w-4 text-zinc-500 shrink-0" />
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate flex-1">
          {fileName}
        </span>
        <span className="text-[11px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
          {ext.toUpperCase()}
        </span>
        <button
          onClick={handleDownload}
          className="p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          title="Descargar"
        >
          <Download className="h-4 w-4 text-zinc-500" />
        </button>
        <button
          onClick={() => setIsMaximized(!isMaximized)}
          className="p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          title={isMaximized ? "Reducir" : "Maximizar"}
        >
          {isMaximized ? <Minimize2 className="h-4 w-4 text-zinc-500" /> : <Maximize2 className="h-4 w-4 text-zinc-500" />}
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          title="Cerrar"
        >
          <X className="h-4 w-4 text-zinc-500" />
        </button>
      </div>

      {/* Preview content */}
      <div className="flex-1 overflow-hidden bg-zinc-100 dark:bg-zinc-950">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            className="w-full h-full border-0"
            title={`Preview: ${fileName}`}
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
            <FileText className="h-16 w-16 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              La vista previa no está disponible para archivos {ext.toUpperCase()}.
            </p>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
            >
              <Download className="h-4 w-4" />
              Descargar archivo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default DocumentPreview;
