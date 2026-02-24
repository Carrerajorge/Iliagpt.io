/**
 * PDF Preview Component
 * Native PDF preview in browser without downloading
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import {
    ChevronLeft,
    ChevronRight,
    ZoomIn,
    ZoomOut,
    Download,
    Maximize2,
    Minimize2,
    RotateCw,
    Loader2,
    FileText,
    X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface PdfPreviewProps {
    url?: string;
    file?: File | Blob;
    title?: string;
    initialPage?: number;
    className?: string;
    onClose?: () => void;
    showToolbar?: boolean;
    embedded?: boolean;
}

export function PdfPreview({
    url,
    file,
    title = 'Documento PDF',
    initialPage = 1,
    className,
    onClose,
    showToolbar = true,
    embedded = false,
}: PdfPreviewProps) {
    const [numPages, setNumPages] = useState<number>(0);
    const [pageNumber, setPageNumber] = useState(initialPage);
    const [scale, setScale] = useState(1.0);
    const [rotation, setRotation] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [inputPage, setInputPage] = useState(String(initialPage));

    const containerRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    // Document source
    const pdfSource = url || file;

    // Handle document load success
    const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
        setNumPages(numPages);
        setIsLoading(false);
        setError(null);
    }, []);

    // Handle document load error
    const onDocumentLoadError = useCallback((error: Error) => {
        console.error('PDF load error:', error);
        setError('Error al cargar el PDF');
        setIsLoading(false);
        toast({
            title: 'Error',
            description: 'No se pudo cargar el documento PDF',
            variant: 'destructive',
        });
    }, [toast]);

    // Navigation
    const goToPage = useCallback((page: number) => {
        const validPage = Math.max(1, Math.min(page, numPages));
        setPageNumber(validPage);
        setInputPage(String(validPage));
    }, [numPages]);

    const previousPage = useCallback(() => {
        goToPage(pageNumber - 1);
    }, [pageNumber, goToPage]);

    const nextPage = useCallback(() => {
        goToPage(pageNumber + 1);
    }, [pageNumber, goToPage]);

    // Zoom controls
    const zoomIn = useCallback(() => {
        setScale(s => Math.min(s + 0.25, 3));
    }, []);

    const zoomOut = useCallback(() => {
        setScale(s => Math.max(s - 0.25, 0.5));
    }, []);

    const resetZoom = useCallback(() => {
        setScale(1);
    }, []);

    // Rotation
    const rotate = useCallback(() => {
        setRotation(r => (r + 90) % 360);
    }, []);

    // Fullscreen toggle
    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    }, []);

    // Download
    const handleDownload = useCallback(() => {
        if (url) {
            const a = document.createElement('a');
            a.href = url;
            a.download = title.endsWith('.pdf') ? title : `${title}.pdf`;
            a.click();
        } else if (file) {
            const blobUrl = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = title.endsWith('.pdf') ? title : `${title}.pdf`;
            a.click();
            URL.revokeObjectURL(blobUrl);
        }
    }, [url, file, title]);

    // Page input handling
    const handlePageInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setInputPage(e.target.value);
    }, []);

    const handlePageInputBlur = useCallback(() => {
        const page = parseInt(inputPage, 10);
        if (!isNaN(page)) {
            goToPage(page);
        } else {
            setInputPage(String(pageNumber));
        }
    }, [inputPage, pageNumber, goToPage]);

    const handlePageInputKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handlePageInputBlur();
        }
    }, [handlePageInputBlur]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') previousPage();
            if (e.key === 'ArrowRight') nextPage();
            if (e.key === '+' || e.key === '=') zoomIn();
            if (e.key === '-') zoomOut();
            if (e.key === 'Escape' && onClose) onClose();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [previousPage, nextPage, zoomIn, zoomOut, onClose]);

    // Handle fullscreen change
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const Viewer = (
        <div
            ref={containerRef}
            className={cn(
                "flex flex-col bg-muted/30 rounded-lg overflow-hidden",
                embedded ? "h-full" : "h-[80vh]",
                className
            )}
        >
            {/* Toolbar */}
            {showToolbar && (
                <div className="flex items-center justify-between px-4 py-2 bg-background border-b">
                    {/* Title */}
                    <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-red-500 flex-shrink-0" />
                        <span className="font-medium truncate max-w-[200px]">{title}</span>
                    </div>

                    {/* Navigation */}
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={previousPage}
                            disabled={pageNumber <= 1}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>

                        <div className="flex items-center gap-1">
                            <Input
                                value={inputPage}
                                onChange={handlePageInputChange}
                                onBlur={handlePageInputBlur}
                                onKeyDown={handlePageInputKeyDown}
                                className="w-12 h-8 text-center"
                            />
                            <span className="text-sm text-muted-foreground">/ {numPages}</span>
                        </div>

                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={nextPage}
                            disabled={pageNumber >= numPages}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* Zoom & Actions */}
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={zoomOut}>
                            <ZoomOut className="h-4 w-4" />
                        </Button>

                        <span className="text-sm min-w-[50px] text-center">
                            {Math.round(scale * 100)}%
                        </span>

                        <Button variant="ghost" size="icon" onClick={zoomIn}>
                            <ZoomIn className="h-4 w-4" />
                        </Button>

                        <Button variant="ghost" size="icon" onClick={rotate}>
                            <RotateCw className="h-4 w-4" />
                        </Button>

                        <Button variant="ghost" size="icon" onClick={toggleFullscreen}>
                            {isFullscreen ? (
                                <Minimize2 className="h-4 w-4" />
                            ) : (
                                <Maximize2 className="h-4 w-4" />
                            )}
                        </Button>

                        <Button variant="ghost" size="icon" onClick={handleDownload}>
                            <Download className="h-4 w-4" />
                        </Button>

                        {onClose && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onClose}
                                className="text-red-500 hover:text-red-600"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* PDF Content */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-4">
                {isLoading && (
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Cargando PDF...</p>
                    </div>
                )}

                {error && (
                    <div className="flex flex-col items-center gap-4 text-center">
                        <FileText className="h-12 w-12 text-red-500" />
                        <p className="text-red-500">{error}</p>
                        <Button variant="outline" onClick={() => window.location.reload()}>
                            Reintentar
                        </Button>
                    </div>
                )}

                {pdfSource && (
                    <Document
                        file={pdfSource}
                        onLoadSuccess={onDocumentLoadSuccess}
                        onLoadError={onDocumentLoadError}
                        loading={null}
                        className="max-w-full"
                    >
                        <Page
                            pageNumber={pageNumber}
                            scale={scale}
                            rotate={rotation}
                            loading={
                                <div className="flex items-center justify-center p-8">
                                    <Loader2 className="h-6 w-6 animate-spin" />
                                </div>
                            }
                            className="shadow-lg"
                        />
                    </Document>
                )}
            </div>

            {/* Zoom slider (bottom) */}
            {showToolbar && (
                <div className="flex items-center gap-4 px-4 py-2 bg-background border-t">
                    <span className="text-xs text-muted-foreground">Zoom:</span>
                    <Slider
                        value={[scale * 100]}
                        min={50}
                        max={300}
                        step={10}
                        onValueChange={([value]) => setScale(value / 100)}
                        className="w-32"
                    />
                    <Button variant="link" size="sm" onClick={resetZoom}>
                        Restablecer
                    </Button>
                </div>
            )}
        </div>
    );

    // Return embedded or in dialog
    if (embedded) {
        return Viewer;
    }

    return (
        <Dialog open={true} onOpenChange={() => onClose?.()}>
            <DialogContent className="max-w-5xl max-h-[90vh] p-0">
                {Viewer}
            </DialogContent>
        </Dialog>
    );
}

/**
 * Inline PDF preview for chat messages
 */
export function InlinePdfPreview({
    url,
    title
}: {
    url: string;
    title?: string;
}) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="border rounded-lg overflow-hidden">
            <div
                className="flex items-center gap-3 p-3 bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <FileText className="h-8 w-8 text-red-500" />
                <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{title || 'Documento PDF'}</p>
                    <p className="text-xs text-muted-foreground">Click para ver</p>
                </div>
            </div>

            {expanded && (
                <div className="h-[400px]">
                    <PdfPreview
                        url={url}
                        title={title}
                        embedded
                        showToolbar
                        onClose={() => setExpanded(false)}
                    />
                </div>
            )}
        </div>
    );
}

// Default export for lazy loading compatibility
export default PdfPreview;
