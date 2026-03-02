import React, { useState, useEffect, useCallback } from "react";
import { X, Download, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getFileTheme } from "@/lib/fileTypeTheme";

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
  const [content, setContent] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mime = file.mimeType || file.type || "";
  const isImage = mime.startsWith("image/");
  const isPdf = mime.includes("pdf") || file.name?.toLowerCase().endsWith(".pdf");
  const isText = mime.startsWith("text/") || /\.(txt|md|json|xml|csv|log|js|ts|tsx|jsx|py|html|css|yaml|yml|sh|sql|env)$/i.test(file.name || "");

  const fileId = file.fileId || file.id;
  const theme = getFileTheme(file.name, mime);

  const fetchContent = useCallback(async () => {
    if (!fileId) {
      setLoading(false);
      if (file.dataUrl) return;
      if (file.content) { setContent(file.content); return; }
      setError("No file ID available");
      return;
    }

    try {
      setLoading(true);

      if (isPdf) {
        const res = await fetch(`/api/files/${fileId}/content`);
        if (!res.ok) throw new Error("Failed to fetch file");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } else if (isImage) {
        const res = await fetch(`/api/files/${fileId}/content`);
        if (!res.ok) throw new Error("Failed to fetch image");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } else if (isText) {
        const res = await fetch(`/api/files/${fileId}/content`);
        if (!res.ok) throw new Error("Failed to fetch file");
        const text = await res.text();
        setContent(text);
      } else {
        setContent(null);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load file");
    } finally {
      setLoading(false);
    }
  }, [fileId, isPdf, isImage, isText, file.dataUrl, file.content]);

  useEffect(() => {
    fetchContent();
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
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
    if (fileId) {
      const a = document.createElement("a");
      a.href = `/api/files/${fileId}/content`;
      a.download = file.name || "download";
      a.click();
    } else if (file.dataUrl) {
      const a = document.createElement("a");
      a.href = file.dataUrl;
      a.download = file.name || "download";
      a.click();
    }
  };

  const imageSource = file.dataUrl || file.imageUrl || blobUrl;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="file-preview-overlay"
    >
      <div
        className="relative bg-background rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-border"
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
              {file.size && (
                <span className="text-xs text-muted-foreground">
                  {file.size < 1024 ? `${file.size} B` :
                    file.size < 1048576 ? `${(file.size / 1024).toFixed(1)} KB` :
                      `${(file.size / 1048576).toFixed(1)} MB`}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDownload}
              title="Download"
              data-testid="button-download-file"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              title="Close"
              data-testid="button-close-preview"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading && (
            <div className="flex items-center justify-center h-64" data-testid="preview-loading">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
              <FileText className="h-12 w-12" />
              <p className="text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" /> Download instead
              </Button>
            </div>
          )}

          {!loading && !error && isImage && imageSource && (
            <div className="flex items-center justify-center">
              <img
                src={imageSource}
                alt={file.name}
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
                data-testid="preview-image"
              />
            </div>
          )}

          {!loading && !error && isPdf && blobUrl && (
            <iframe
              src={blobUrl}
              className="w-full h-[70vh] rounded-lg border border-border"
              title={file.name}
              data-testid="preview-pdf"
            />
          )}

          {!loading && !error && isText && content !== null && (
            <pre
              className="text-sm font-mono whitespace-pre-wrap break-words bg-muted/50 rounded-lg p-4 max-h-[70vh] overflow-auto"
              data-testid="preview-text"
            >
              {content}
            </pre>
          )}

          {!loading && !error && !isImage && !isPdf && !isText && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
              <div className={cn("flex items-center justify-center w-20 h-20 rounded-2xl", theme.bgColor)}>
                <span className="text-white text-2xl font-bold">{theme.icon}</span>
              </div>
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs">Preview not available for this file type</p>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" /> Download file
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
