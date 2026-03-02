import React, { useState, useEffect, useCallback, useRef } from "react";
import { X, Download, FileText, Loader2, ExternalLink, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getFileTheme } from "@/lib/fileTypeTheme";
import { PdfPreview } from "@/components/PdfPreview";

interface FilePreviewModalProps {
  file: {
    id?: string;
    name: string;
    type?: string;
    mimeType?: string;
    size?: number;
    storagePath?: string;
    imageUrl?: string;
    dataUrl?: string;
    fileId?: string;
    content?: string;
  };
  onClose: () => void;
}

export function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
  const [previewData, setPreviewData] = useState<any>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const mime = file.mimeType || file.type || "";
  const ext = (file.name || "").toLowerCase().split(".").pop() || "";
  const isImage = mime.startsWith("image/");
  const isPdf = mime.includes("pdf") || ext === "pdf";
  const isDocx = mime.includes("wordprocessingml") || ext === "docx" || ext === "doc";
  const isXlsx = mime.includes("spreadsheetml") || ext === "xlsx" || ext === "xls";
  const isText = mime.startsWith("text/") || /\.(txt|md|json|xml|csv|log|js|ts|tsx|jsx|py|html|css|yaml|yml|sh|sql|env)$/i.test(file.name || "");
  const isOfficeDoc = isDocx || isXlsx;

  const fileId = file.fileId || file.id;
  const theme = getFileTheme(file.name, mime);
  const rawUrl = fileId ? `/api/files/${fileId}/raw` : undefined;

  const fetchContent = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (isPdf || (file.dataUrl && isImage)) {
        setLoading(false);
        return;
      }

      if (!fileId) {
        if (file.content) {
          setPreviewData({ type: "text", content: file.content });
        } else if (!file.dataUrl) {
          setError("No hay ID de archivo disponible");
        }
        setLoading(false);
        return;
      }

      if (isOfficeDoc || isText) {
        const res = await fetch(`/api/files/${fileId}/preview-html`);
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = await res.json();
        setPreviewData(data);
      } else if (isImage) {
        const res = await fetch(`/api/files/${fileId}/raw`);
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = url;
        setBlobUrl(url);
      }
    } catch (err: any) {
      console.error("Preview fetch error:", err);
      setError(err.message || "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [fileId, isPdf, isImage, isText, isOfficeDoc, file.dataUrl, file.content]);

  useEffect(() => {
    fetchContent();
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [fetchContent]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const handleDownload = () => {
    const a = document.createElement("a");
    if (rawUrl) {
      a.href = rawUrl;
    } else if (file.dataUrl) {
      a.href = file.dataUrl;
    } else {
      return;
    }
    a.download = file.name || "download";
    a.click();
  };

  if (isPdf && (rawUrl || file.dataUrl)) {
    return (
      <PdfPreview
        url={rawUrl || file.dataUrl || ""}
        title={file.name}
        onClose={onClose}
      />
    );
  }

  const imageSource = file.dataUrl || file.imageUrl || blobUrl;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="file-preview-overlay"
    >
      <div
        className="relative bg-background rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-border"
        onClick={(e) => e.stopPropagation()}
        data-testid="file-preview-modal"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn("flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0", theme.bgColor)}>
              <span className="text-white text-xs font-bold">{theme.icon}</span>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate" data-testid="preview-filename">{file.name}</h3>
              <span className="text-xs text-muted-foreground">{theme.label}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={handleDownload} title="Descargar" data-testid="button-download-file">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} title="Cerrar" data-testid="button-close-preview">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center h-64" data-testid="preview-loading">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground p-4">
              <FileText className="h-12 w-12" />
              <p className="text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" /> Descargar archivo
              </Button>
            </div>
          )}

          {!loading && !error && isImage && imageSource && (
            <div className="flex items-center justify-center p-4">
              <img src={imageSource} alt={file.name} className="max-w-full max-h-[70vh] object-contain rounded-lg" data-testid="preview-image" />
            </div>
          )}

          {!loading && !error && previewData?.type === "docx" && previewData.html && (
            <div className="p-6 overflow-auto max-h-[75vh]" data-testid="preview-docx">
              <div
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: previewData.html }}
              />
            </div>
          )}

          {!loading && !error && previewData?.type === "xlsx" && previewData.sheets && (
            <div className="p-4 overflow-auto max-h-[75vh]" data-testid="preview-xlsx">
              {previewData.sheetNames?.map((sheetName: string) => (
                <div key={sheetName} className="mb-6">
                  {previewData.sheetNames.length > 1 && (
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-green-600" />
                      {sheetName}
                    </h4>
                  )}
                  <div className="overflow-x-auto border border-border rounded-lg">
                    <table className="w-full text-xs">
                      <tbody>
                        {(previewData.sheets[sheetName] || []).slice(0, 200).map((row: any[], rowIdx: number) => (
                          <tr key={rowIdx} className={rowIdx === 0 ? "bg-muted/50 font-semibold" : rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                            {(row || []).map((cell: any, cellIdx: number) => (
                              <td key={cellIdx} className="px-2 py-1 border-r border-b border-border whitespace-nowrap max-w-[200px] truncate">
                                {cell != null ? String(cell) : ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(previewData.sheets[sheetName] || []).length > 200 && (
                    <p className="text-xs text-muted-foreground mt-1">Mostrando primeras 200 filas de {previewData.sheets[sheetName].length}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {!loading && !error && previewData?.type === "text" && previewData.content != null && (
            <pre className="text-sm font-mono whitespace-pre-wrap break-words bg-muted/50 rounded-lg p-4 m-4 max-h-[70vh] overflow-auto" data-testid="preview-text">
              {previewData.content}
            </pre>
          )}

          {!loading && !error && !isImage && !isPdf && !previewData && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground p-4">
              <div className={cn("flex items-center justify-center w-20 h-20 rounded-2xl", theme.bgColor)}>
                <span className="text-white text-2xl font-bold">{theme.icon}</span>
              </div>
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs">Vista previa no disponible para este tipo de archivo</p>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" /> Descargar archivo
              </Button>
            </div>
          )}

          {!loading && !error && previewData?.type === "unknown" && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground p-4">
              <div className={cn("flex items-center justify-center w-20 h-20 rounded-2xl", theme.bgColor)}>
                <span className="text-white text-2xl font-bold">{theme.icon}</span>
              </div>
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs">Vista previa no disponible para este tipo de archivo</p>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" /> Descargar archivo
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
