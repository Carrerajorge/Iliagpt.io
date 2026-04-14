import React, { memo, useMemo } from "react";
import DOMPurify from "dompurify";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Download,
  FileText,
  FileSpreadsheet,
  Presentation,
  X,
  FileIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFileCategory, getFileTheme, type FileCategory } from "@/lib/fileTypeTheme";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

export interface DocumentPreviewArtifact {
  id: string;
  name: string;
  type: string;
  data?: any;
  mimeType?: string;
  url?: string;
}

interface DocumentPreviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  artifact: DocumentPreviewArtifact | null;
  onDownload?: (artifact: DocumentPreviewArtifact) => void;
}

function getDocumentTypeIcon(category: FileCategory): React.ElementType {
  const icons: Record<FileCategory, React.ElementType> = {
    word: FileText,
    excel: FileSpreadsheet,
    ppt: Presentation,
    pdf: FileText,
    image: FileIcon,
    audio: FileIcon,
    text: FileText,
    code: FileText,
    archive: FileIcon,
    unknown: FileIcon,
  };
  return icons[category] || FileIcon;
}

function getDocumentTypeLabel(category: FileCategory): string {
  const labels: Record<FileCategory, string> = {
    word: "Documento Word",
    excel: "Hoja de cálculo",
    ppt: "Presentación",
    pdf: "Documento PDF",
    image: "Imagen",
    audio: "Audio",
    text: "Archivo de texto",
    code: "Código",
    archive: "Archivo comprimido",
    unknown: "Documento",
  };
  return labels[category] || "Documento";
}

const WordPreview = memo(function WordPreview({ data }: { data: any }) {
  const content = useMemo(() => {
    if (!data) return null;
    if (typeof data === "string") return data;
    if (data.html) return { type: "html" as const, value: data.html };
    if (data.content) return data.content;
    if (data.text) return data.text;
    if (data.markdown) return data.markdown;
    if (Array.isArray(data.paragraphs)) {
      return data.paragraphs.join("\n\n");
    }
    return JSON.stringify(data, null, 2);
  }, [data]);

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground" data-testid="word-preview-empty">
        <p>No hay contenido disponible para previsualizar</p>
      </div>
    );
  }

  // Render HTML content from mammoth conversion
  if (typeof content === "object" && content.type === "html") {
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none p-6" data-testid="word-preview-content">
        <div
          className="font-serif leading-relaxed text-foreground"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.value) }}
        />
      </div>
    );
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none p-4" data-testid="word-preview-content">
      <div className="whitespace-pre-wrap font-serif leading-relaxed text-foreground">
        {content}
      </div>
    </div>
  );
});

const ExcelPreview = memo(function ExcelPreview({ data }: { data: any }) {
  const tableData = useMemo(() => {
    if (!data) return null;
    
    if (data.headers && data.rows) {
      return { headers: data.headers, rows: data.rows };
    }
    
    if (data.sheets && Array.isArray(data.sheets) && data.sheets.length > 0) {
      const firstSheet = data.sheets[0];
      if (firstSheet.data && Array.isArray(firstSheet.data)) {
        const [headers, ...rows] = firstSheet.data;
        return { headers: headers || [], rows: rows || [] };
      }
    }
    
    if (Array.isArray(data)) {
      if (data.length === 0) return null;
      const [headers, ...rows] = data;
      return { headers: Array.isArray(headers) ? headers : [], rows };
    }
    
    if (data.data && Array.isArray(data.data)) {
      const [headers, ...rows] = data.data;
      return { headers: Array.isArray(headers) ? headers : [], rows };
    }
    
    return null;
  }, [data]);

  if (!tableData || !tableData.headers || tableData.headers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground" data-testid="excel-preview-empty">
        <p>No hay datos disponibles para previsualizar</p>
      </div>
    );
  }

  const displayRows = tableData.rows.slice(0, 100);

  return (
    <div className="p-4 overflow-auto" data-testid="excel-preview-content">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-10">#</th>
              {tableData.headers.map((header: any, idx: number) => (
                <th
                  key={idx}
                  className="px-3 py-2 text-left text-xs font-semibold text-foreground truncate max-w-[200px]"
                  title={String(header)}
                >
                  {String(header)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {displayRows.map((row: any[], rowIdx: number) => (
              <tr key={rowIdx} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{rowIdx + 1}</td>
                {tableData.headers.map((_: any, colIdx: number) => {
                  const value = row[colIdx];
                  const displayValue = value === null || value === undefined ? "" : String(value);
                  return (
                    <td
                      key={colIdx}
                      className="px-3 py-2 text-xs text-foreground truncate max-w-[200px]"
                      title={displayValue.length > 30 ? displayValue : undefined}
                    >
                      {displayValue || <span className="text-muted-foreground">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tableData.rows.length > 100 && (
        <p className="mt-2 text-xs text-muted-foreground text-center">
          Mostrando 100 de {tableData.rows.length} filas
        </p>
      )}
    </div>
  );
});

const PowerPointPreview = memo(function PowerPointPreview({ data }: { data: any }) {
  const slides = useMemo(() => {
    if (!data) return [];
    
    if (Array.isArray(data.slides)) {
      return data.slides;
    }
    
    if (Array.isArray(data)) {
      return data;
    }
    
    if (data.content && Array.isArray(data.content)) {
      return data.content;
    }
    
    return [];
  }, [data]);

  if (slides.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground" data-testid="ppt-preview-empty">
        <p>No hay diapositivas disponibles para previsualizar</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4" data-testid="ppt-preview-content">
      {slides.map((slide: any, idx: number) => {
        const title = slide.title || slide.heading || `Diapositiva ${idx + 1}`;
        const content = slide.content || slide.body || slide.text || slide.bullets || "";
        const notes = slide.notes || slide.speakerNotes || "";

        return (
          <div
            key={idx}
            className="rounded-lg border border-border bg-card p-4 shadow-sm"
            data-testid={`ppt-slide-${idx}`}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="flex items-center justify-center w-6 h-6 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 text-xs font-bold">
                {idx + 1}
              </span>
              <h3 className="font-semibold text-foreground text-sm">{title}</h3>
            </div>
            {content && (
              <div className="text-sm text-muted-foreground whitespace-pre-wrap pl-8">
                {Array.isArray(content) ? (
                  <ul className="list-disc list-inside space-y-1">
                    {content.map((item: string, i: number) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  content
                )}
              </div>
            )}
            {notes && (
              <div className="mt-3 pt-3 border-t border-border/50 pl-8">
                <p className="text-xs text-muted-foreground italic">
                  <span className="font-medium">Notas:</span> {notes}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

const CSVPreview = memo(function CSVPreview({ data }: { data: any }) {
  return <ExcelPreview data={data} />;
});

const GenericPreview = memo(function GenericPreview({ data, name }: { data: any; name: string }) {
  const content = useMemo(() => {
    if (!data) return null;
    if (typeof data === "string") return data;
    return JSON.stringify(data, null, 2);
  }, [data]);

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground" data-testid="generic-preview-empty">
        <p>No hay contenido disponible para previsualizar</p>
      </div>
    );
  }

  return (
    <div className="p-4" data-testid="generic-preview-content">
      <pre className="text-xs font-mono text-foreground whitespace-pre-wrap bg-muted/30 rounded-lg p-4 overflow-auto max-h-[600px]">
        {content}
      </pre>
    </div>
  );
});

export const DocumentPreviewPanel = memo(function DocumentPreviewPanel({
  isOpen,
  onClose,
  artifact,
  onDownload,
}: DocumentPreviewPanelProps) {
  const category = useMemo(() => {
    if (!artifact) return "unknown" as FileCategory;
    return getFileCategory(artifact.name, artifact.mimeType);
  }, [artifact]);

  const theme = useMemo(() => {
    return getFileTheme(artifact?.name, artifact?.mimeType);
  }, [artifact]);

  const IconComponent = getDocumentTypeIcon(category);
  const typeLabel = getDocumentTypeLabel(category);

  const handleDownload = () => {
    if (artifact && onDownload) {
      onDownload(artifact);
    }
  };

  const renderPreview = () => {
    if (!artifact?.data) {
      // If we have a URL but no data, show a download prompt
      if (artifact?.url) {
        return (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-8" data-testid="url-only-preview">
            <div className={cn("w-16 h-16 rounded-2xl flex items-center justify-center", theme.bgColor)}>
              <IconComponent className="h-8 w-8 text-white" />
            </div>
            <p className="text-center">Este documento está disponible para descargar.</p>
            <a
              href={artifact.url}
              download={artifact.name}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Descargar {artifact.name}
            </a>
          </div>
        );
      }
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground" data-testid="no-data-preview">
          <p>No hay datos disponibles para previsualizar</p>
        </div>
      );
    }

    switch (category) {
      case "word":
        return <WordPreview data={artifact.data} />;
      case "excel":
        return <ExcelPreview data={artifact.data} />;
      case "ppt":
        return <PowerPointPreview data={artifact.data} />;
      default:
        if (artifact.name?.toLowerCase().endsWith(".csv")) {
          return <CSVPreview data={artifact.data} />;
        }
        return <GenericPreview data={artifact.data} name={artifact.name} />;
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg md:max-w-xl lg:max-w-2xl p-0 flex flex-col"
        data-testid="document-preview-panel"
      >
        <SheetHeader className="px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div
                className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-lg shrink-0",
                  theme.bgColor
                )}
              >
                <IconComponent className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-sm font-semibold text-foreground truncate" title={artifact?.name}>
                  {artifact?.name || "Documento"}
                </SheetTitle>
                <p className="text-xs text-muted-foreground">{typeLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onDownload && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  className="gap-1.5"
                  data-testid="button-download-document"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Descargar</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8"
                data-testid="button-close-preview"
              >
                <X className="h-4 w-4" />
                <VisuallyHidden>Cerrar</VisuallyHidden>
              </Button>
            </div>
          </div>
        </SheetHeader>
        <ScrollArea className="flex-1 overflow-auto">
          {renderPreview()}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
});

export default DocumentPreviewPanel;
