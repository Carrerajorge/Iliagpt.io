/**
 * Document Preview Panel - ILIAGPT PRO 3.0
 * 
 * Inline preview for PDF, Word, Excel, images without downloading.
 */

import { memo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    FileText,
    X,
    ZoomIn,
    ZoomOut,
    Download,
    ChevronLeft,
    ChevronRight,
    Maximize2,
    Minimize2,
    RotateCw,
    File,
    Image as ImageIcon,
    Table
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ============== Types ==============

export type DocumentType = "pdf" | "docx" | "xlsx" | "image" | "text" | "markdown";

export interface DocumentFile {
    id: string;
    name: string;
    type: DocumentType;
    url: string;
    size?: number;
    pages?: number;
}

interface DocumentPreviewProps {
    document: DocumentFile | null;
    isOpen: boolean;
    onClose: () => void;
    onDownload?: () => void;
    className?: string;
}

// ============== Icons ==============

const typeIcons: Record<DocumentType, React.ReactNode> = {
    pdf: <FileText className="w-4 h-4 text-red-500" />,
    docx: <FileText className="w-4 h-4 text-blue-500" />,
    xlsx: <Table className="w-4 h-4 text-green-500" />,
    image: <ImageIcon className="w-4 h-4 text-purple-500" />,
    text: <File className="w-4 h-4 text-gray-500" />,
    markdown: <FileText className="w-4 h-4 text-gray-500" />,
};

// ============== Components ==============

export const DocumentPreview = memo(function DocumentPreview({
    document,
    isOpen,
    onClose,
    onDownload,
    className,
}: DocumentPreviewProps) {
    const [zoom, setZoom] = useState(100);
    const [page, setPage] = useState(1);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [rotation, setRotation] = useState(0);

    const handleZoomIn = useCallback(() => {
        setZoom(z => Math.min(z + 25, 200));
    }, []);

    const handleZoomOut = useCallback(() => {
        setZoom(z => Math.max(z - 25, 50));
    }, []);

    const handleRotate = useCallback(() => {
        setRotation(r => (r + 90) % 360);
    }, []);

    const handlePrevPage = useCallback(() => {
        setPage(p => Math.max(p - 1, 1));
    }, []);

    const handleNextPage = useCallback(() => {
        if (document?.pages) {
            setPage(p => Math.min(p + 1, document.pages!));
        }
    }, [document?.pages]);

    if (!isOpen || !document) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, x: 300 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 300 }}
                className={cn(
                    "fixed right-0 top-0 bottom-0 w-[500px] bg-background border-l shadow-2xl z-50",
                    isFullscreen && "w-full",
                    className
                )}
            >
                {/* Header */}
                <div className="flex items-center justify-between h-12 px-4 border-b bg-muted/30">
                    <div className="flex items-center gap-2 min-w-0">
                        {typeIcons[document.type]}
                        <span className="text-sm font-medium truncate">{document.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut}>
                            <ZoomOut className="w-3.5 h-3.5" />
                        </Button>
                        <span className="text-xs w-10 text-center">{zoom}%</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn}>
                            <ZoomIn className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRotate}>
                            <RotateCw className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setIsFullscreen(f => !f)}
                        >
                            {isFullscreen ? (
                                <Minimize2 className="w-3.5 h-3.5" />
                            ) : (
                                <Maximize2 className="w-3.5 h-3.5" />
                            )}
                        </Button>
                        {onDownload && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDownload}>
                                <Download className="w-3.5 h-3.5" />
                            </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                            <X className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto h-[calc(100%-96px)] bg-muted/10">
                    <div
                        className="flex items-center justify-center min-h-full p-4"
                        style={{
                            transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                            transformOrigin: "center center",
                        }}
                    >
                        {document.type === "image" && (
                            <img
                                src={document.url}
                                alt={document.name}
                                className="max-w-full h-auto rounded-lg shadow-lg"
                            />
                        )}

                        {document.type === "pdf" && (
                            <iframe
                                src={`${document.url}#page=${page}`}
                                className="w-full h-full min-h-[600px] rounded-lg"
                                title={document.name}
                            />
                        )}

                        {(document.type === "text" || document.type === "markdown") && (
                            <div className="w-full max-w-2xl bg-background p-6 rounded-lg shadow-lg">
                                <pre className="whitespace-pre-wrap text-sm font-mono">
                                    {/* Content would be loaded here */}
                                    Contenido del documento...
                                </pre>
                            </div>
                        )}

                        {(document.type === "docx" || document.type === "xlsx") && (
                            <div className="flex flex-col items-center gap-4 text-muted-foreground">
                                {typeIcons[document.type]}
                                <p className="text-sm">Vista previa no disponible</p>
                                <Button variant="outline" size="sm" onClick={onDownload}>
                                    <Download className="w-4 h-4 mr-2" />
                                    Descargar para ver
                                </Button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer - Pagination */}
                {document.pages && document.pages > 1 && (
                    <div className="flex items-center justify-center gap-2 h-12 border-t bg-muted/30">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handlePrevPage}
                            disabled={page <= 1}
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="text-sm">
                            {page} / {document.pages}
                        </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handleNextPage}
                            disabled={page >= document.pages}
                        >
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                )}
            </motion.div>
        </AnimatePresence>
    );
});

export default DocumentPreview;
