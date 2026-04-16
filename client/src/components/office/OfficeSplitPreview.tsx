import React, { memo, useCallback } from "react";
import { Download, Eye, FileSpreadsheet, FileText, Presentation, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentPreview } from "@/components/document/DocumentPreview";
import { downloadArtifact } from "@/lib/localArtifactAccess";
import type { ReopenDocumentRequest } from "@/lib/documentPreviewContracts";

interface OfficeSplitPreviewProps {
  document: ReopenDocumentRequest;
  onClose: () => void;
}

function resolveDocumentType(document: ReopenDocumentRequest): "docx" | "xlsx" | "pptx" | "pdf" {
  if (document.type === "excel") return "xlsx";
  if (document.type === "ppt") return "pptx";
  if (document.type === "pdf") return "pdf";
  return "docx";
}

function resolveIcon(document: ReopenDocumentRequest) {
  if (document.type === "excel") return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
  if (document.type === "ppt") return <Presentation className="h-4 w-4 text-orange-500" />;
  return <FileText className="h-4 w-4 text-blue-600" />;
}

export const OfficeSplitPreview = memo(function OfficeSplitPreview({
  document,
  onClose,
}: OfficeSplitPreviewProps) {
  const previewUrl = document.previewUrl || document.downloadUrl || "";
  const downloadUrl = document.downloadUrl || document.previewUrl || "";
  const documentType = resolveDocumentType(document);

  const handleDownload = useCallback(async () => {
    if (!downloadUrl) return;
    await downloadArtifact(downloadUrl, document.fileName || document.title);
  }, [document.fileName, document.title, downloadUrl]);

  return (
    <div className="flex h-full flex-col bg-background" data-testid="chat-artifact-split-preview">
      <div className="relative z-20 flex shrink-0 items-center justify-between border-b border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
            {resolveIcon(document)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{document.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {document.mimeType || documentType.toUpperCase()}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {previewUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              data-testid="chat-artifact-preview-button"
            >
              <Eye className="h-4 w-4" />
              Preview activo
            </Button>
          )}
          {downloadUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => void handleDownload()}
              data-testid="chat-artifact-download-button"
            >
              <Download className="h-4 w-4" />
              Descargar
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative z-30"
            onClick={onClose}
            data-testid="chat-artifact-close-button"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="relative z-0 min-h-0 flex-1 overflow-hidden p-4">
        <DocumentPreview
          url={previewUrl}
          type={documentType}
          title={document.title}
          html={document.previewHtml}
          className="h-full"
        />
      </div>
    </div>
  );
});
