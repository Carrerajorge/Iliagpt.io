import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FilePreviewSurface } from "@/components/FilePreviewSurface";
import { downloadArtifact, fetchArtifactResponse } from "@/lib/localArtifactAccess";
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Download,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  FileText,
  FileSpreadsheet,
  Presentation,
} from "lucide-react";

export type DocumentType = "pdf" | "docx" | "xlsx" | "pptx";

export interface DocumentPreviewProps {
  url: string;
  type: DocumentType;
  title?: string;
  className?: string;
  html?: string;
}

interface PDFViewerState {
  loading: boolean;
  error: string | null;
  numPages: number;
  currentPage: number;
  scale: number;
}

const PDFJS_WORKER_URL = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const DEFAULT_ZOOM = 1;

const LoadingSkeleton = memo(function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4" data-testid="document-preview-skeleton">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[600px] w-full" />
    </div>
  );
});

const ErrorDisplay = memo(function ErrorDisplay({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="destructive" data-testid="document-preview-error">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Failed to load document</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{error}</span>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            data-testid="button-retry-load"
            className="w-fit"
          >
            <RotateCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
});

const getDocumentIcon = (type: DocumentType) => {
  switch (type) {
    case "pdf":
      return <FileText className="h-12 w-12 text-red-500" />;
    case "docx":
      return <FileText className="h-12 w-12 text-blue-500" />;
    case "xlsx":
      return <FileSpreadsheet className="h-12 w-12 text-green-500" />;
    case "pptx":
      return <Presentation className="h-12 w-12 text-orange-500" />;
  }
};

const getDocumentLabel = (type: DocumentType) => {
  switch (type) {
    case "pdf":
      return "PDF Document";
    case "docx":
      return "Word Document";
    case "xlsx":
      return "Excel Spreadsheet";
    case "pptx":
      return "PowerPoint Presentation";
  }
};

const HtmlPreview = memo(function HtmlPreview({
  html,
  type,
}: {
  html: string;
  type: DocumentType;
}) {
  return (
    <div className="h-full w-full overflow-auto bg-white" data-testid="document-preview-html">
      <FilePreviewSurface
        preview={{ type, html }}
        variant="modal"
        className="min-h-full rounded-none"
      />
    </div>
  );
});

const OfficeDocumentFallback = memo(function OfficeDocumentFallback({
  url,
  type,
  title,
}: Omit<DocumentPreviewProps, "className" | "html">) {
  const handleDownload = useCallback(async () => {
    await downloadArtifact(url, title ? `${title}.${type}` : undefined);
  }, [title, type, url]);

  return (
    <Card data-testid="document-preview-office">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {getDocumentIcon(type)}
          <span>{title || getDocumentLabel(type)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4 py-8">
          <p className="text-muted-foreground text-center">
            Preview is not available for {getDocumentLabel(type)} files.
            <br />
            Download the file to view its contents.
          </p>
          <Button onClick={() => void handleDownload()} data-testid="button-download-document">
            <Download className="h-4 w-4 mr-2" />
            Download {title || getDocumentLabel(type)}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});

const DocxViewer = memo(function DocxViewer({
  url,
  title,
}: Omit<DocumentPreviewProps, "type" | "className" | "html">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchArtifactResponse(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch DOCX preview (${response.status})`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const { renderAsync } = (await import("docx-preview")) as {
        renderAsync: (
          data: BlobPart,
          container: HTMLElement,
          styleContainer?: HTMLElement | null,
          options?: Record<string, unknown>,
        ) => Promise<void>;
      };

      if (!containerRef.current) return;
      containerRef.current.replaceChildren();

      await renderAsync(arrayBuffer, containerRef.current, undefined, {
        className: "ilia-docx-preview",
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,
        useBase64URL: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to render DOCX preview");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  if (error) {
    return <ErrorDisplay error={error} onRetry={() => void loadPreview()} />;
  }

  return (
    <div className="flex h-full flex-col gap-4" data-testid="document-preview-docx">
      {title && (
        <h3 className="px-4 pt-4 text-lg font-semibold" data-testid="text-document-title">
          {title}
        </h3>
      )}
      <div className="relative flex-1 overflow-auto rounded-lg border bg-slate-100 p-6 dark:bg-slate-950/50">
        {loading && (
          <div className="absolute inset-0 z-10">
            <LoadingSkeleton />
          </div>
        )}
        <div
          ref={containerRef}
          className={cn(
            "mx-auto min-h-[200px] w-full max-w-[960px]",
            loading && "opacity-0 pointer-events-none",
          )}
          data-testid="document-preview-docx-canvas"
        />
      </div>
    </div>
  );
});

const PDFViewer = memo(function PDFViewer({
  url,
  title,
}: Omit<DocumentPreviewProps, "type" | "className" | "html">) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<any>(null);
  const pdfjsLibRef = useRef<any>(null);

  const [state, setState] = useState<PDFViewerState>({
    loading: true,
    error: null,
    numPages: 0,
    currentPage: 1,
    scale: DEFAULT_ZOOM,
  });

  const loadPdfJs = useCallback(async () => {
    if (pdfjsLibRef.current) return pdfjsLibRef.current;

    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      pdfjsLibRef.current = pdfjsLib;
      return pdfjsLib;
    } catch {
      throw new Error("Failed to load PDF.js library");
    }
  }, []);

  const loadDocument = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const pdfjsLib = await loadPdfJs();
      const loadingTask = pdfjsLib.getDocument(url);
      const pdf = await loadingTask.promise;
      pdfDocRef.current = pdf;

      setState((prev) => ({
        ...prev,
        loading: false,
        numPages: pdf.numPages,
        currentPage: 1,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load PDF document",
      }));
    }
  }, [loadPdfJs, url]);

  const renderPage = useCallback(async (pageNum: number, scale: number) => {
    if (!pdfDocRef.current || !canvasRef.current) return;

    try {
      const page = await pdfDocRef.current.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");

      if (!context) return;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;
    } catch (err) {
      console.error("Failed to render page:", err);
    }
  }, []);

  useEffect(() => {
    void loadDocument();
    return () => {
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [loadDocument]);

  useEffect(() => {
    if (!state.loading && !state.error && state.numPages > 0) {
      void renderPage(state.currentPage, state.scale);
    }
  }, [renderPage, state.currentPage, state.error, state.loading, state.numPages, state.scale]);

  const goToPage = useCallback(
    (page: number) => {
      if (page >= 1 && page <= state.numPages) {
        setState((prev) => ({ ...prev, currentPage: page }));
      }
    },
    [state.numPages],
  );

  const zoomIn = useCallback(() => {
    const currentIndex = ZOOM_LEVELS.findIndex((z) => z >= state.scale);
    const nextIndex = Math.min(currentIndex + 1, ZOOM_LEVELS.length - 1);
    setState((prev) => ({ ...prev, scale: ZOOM_LEVELS[nextIndex] }));
  }, [state.scale]);

  const zoomOut = useCallback(() => {
    const currentIndex = ZOOM_LEVELS.findIndex((z) => z >= state.scale);
    const prevIndex = Math.max(currentIndex - 1, 0);
    setState((prev) => ({ ...prev, scale: ZOOM_LEVELS[prevIndex] }));
  }, [state.scale]);

  const resetZoom = useCallback(() => {
    setState((prev) => ({ ...prev, scale: DEFAULT_ZOOM }));
  }, []);

  if (state.loading) {
    return <LoadingSkeleton />;
  }

  if (state.error) {
    return <ErrorDisplay error={state.error} onRetry={() => void loadDocument()} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="document-preview-pdf">
      {title && (
        <h3 className="text-lg font-semibold" data-testid="text-document-title">
          {title}
        </h3>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-muted rounded-lg">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => goToPage(state.currentPage - 1)}
            disabled={state.currentPage <= 1}
            data-testid="button-prev-page"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm px-2" data-testid="text-page-info">
            Page {state.currentPage} of {state.numPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => goToPage(state.currentPage + 1)}
            disabled={state.currentPage >= state.numPages}
            data-testid="button-next-page"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={zoomOut}
            disabled={state.scale <= ZOOM_LEVELS[0]}
            data-testid="button-zoom-out"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetZoom}
            data-testid="button-zoom-reset"
            aria-label="Reset zoom"
          >
            {Math.round(state.scale * 100)}%
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={zoomIn}
            disabled={state.scale >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            data-testid="button-zoom-in"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        className="overflow-auto border rounded-lg bg-muted/50 max-h-[800px]"
        data-testid="pdf-canvas-container"
      >
        <div className="flex justify-center p-4">
          <canvas
            ref={canvasRef}
            className="shadow-lg bg-white"
            data-testid="pdf-canvas"
          />
        </div>
      </div>
    </div>
  );
});

export const DocumentPreview = memo(function DocumentPreview({
  url,
  type,
  title,
  className,
  html,
}: DocumentPreviewProps) {
  const normalizedType = useMemo(() => type.toLowerCase() as DocumentType, [type]);
  const canUseStructuredHtmlPreview =
    html &&
    html.trim().length > 0 &&
    (normalizedType === "xlsx" || normalizedType === "pptx" || !url);

  if (canUseStructuredHtmlPreview) {
    return (
      <div className={cn("w-full", className)} data-testid="document-preview">
        <HtmlPreview html={html} type={normalizedType} />
      </div>
    );
  }

  if (!url) {
    return <ErrorDisplay error="No document URL provided" />;
  }

  return (
    <div className={cn("w-full", className)} data-testid="document-preview">
      {normalizedType === "pdf" ? (
        <PDFViewer url={url} title={title} />
      ) : normalizedType === "docx" ? (
        <DocxViewer url={url} title={title} />
      ) : (
        <OfficeDocumentFallback url={url} type={normalizedType} title={title} />
      )}
    </div>
  );
});

export default DocumentPreview;
