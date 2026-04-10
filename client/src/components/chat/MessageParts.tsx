
import React, { memo, useState, useCallback, useRef, useEffect } from "react";
import {
    CheckCircle2,
    Copy,
    ThumbsUp,
    ThumbsDown,
    RefreshCw,
    Archive,
    Download,
    Share2,
    Volume2,
    VolumeX,
    Maximize2,
    Minimize2,
    Check,
    ImageIcon,
    ArrowUp,
    ListPlus,
    Minus,
    Globe,
    MoreHorizontal,
    FileText,
    FileSpreadsheet,
    Presentation,
    FileCode,
    File,
    Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { z } from "zod";
import { Message, WebSource } from "@/hooks/use-chats";
import { getFileTheme } from "@/lib/fileTypeTheme";
import { ChatSpreadsheetViewer } from "@/components/chat/ChatSpreadsheetViewer";
import type { ReopenDocumentRequest } from "@/lib/documentPreviewContracts";

import { formatZonedTime, normalizeTimeZone } from "@/lib/platformDateTime";

export const formatMessageTime = (timestamp: Date | number | undefined, timeZone: string): string => {
    if (!timestamp) return "";
    return formatZonedTime(timestamp, { timeZone: normalizeTimeZone(timeZone), includeSeconds: false });
};

export interface DocumentBlock {
    type: "word" | "excel" | "ppt";
    title: string;
    content: string;
}

export const extractTextFromChildren = (children: React.ReactNode): string => {
    if (typeof children === "string") return children;
    if (typeof children === "number") return String(children);
    if (!children) return "";
    if (Array.isArray(children)) {
        return children.map(extractTextFromChildren).join("");
    }
    if (React.isValidElement(children)) {
        return extractTextFromChildren((children.props as { children?: React.ReactNode })?.children);
    }
    const childArray = React.Children.toArray(children);
    return childArray.map(extractTextFromChildren).join("");
};

export const isNumericValue = (text: string): boolean => {
    if (!text || typeof text !== "string") return false;
    const cleaned = text.trim().replace(/[$€£¥%,\s]/g, "");
    return (
        !isNaN(parseFloat(cleaned)) &&
        isFinite(Number(cleaned)) &&
        cleaned.length > 0
    );
};

export const ImageSkeleton = memo(function ImageSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn(
            "animate-pulse bg-gradient-to-br from-muted/80 via-muted to-muted/80 rounded-lg flex items-center justify-center",
            className
        )}>
            <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
        </div>
    );
});

export const LazyImage = memo(function LazyImage({
    src,
    alt,
    className,
    style,
    onClick,
    "data-testid": testId
}: {
    src: string;
    alt: string;
    className?: string;
    style?: React.CSSProperties;
    onClick?: () => void;
    "data-testid"?: string;
}) {
    const [isLoaded, setIsLoaded] = useState(false);
    const [hasError, setHasError] = useState(false);

    return (
        <div className="relative">
            {!isLoaded && !hasError && (
                <ImageSkeleton className={cn(className, "absolute inset-0")} />
            )}
            <img
                src={src}
                alt={alt}
                loading="lazy"
                className={cn(className, !isLoaded && "opacity-0")}
                ref={(el) => { if (el && style) Object.entries(style).forEach(([k, v]) => el.style[k as any] = v as string); }}
                onClick={onClick}
                onLoad={() => setIsLoaded(true)}
                onError={() => setHasError(true)}
                data-testid={testId}
            />
        </div>
    );
});

// Smart attachment image component with multi-source fallback and IndexedDB caching.
// Priority: 1) imageUrl (base64, instant) 2) IndexedDB cache 3) storagePath (network)
// On successful network load, caches in IndexedDB for future sessions.
export const AttachmentImage = memo(function AttachmentImage({
    imageUrl,
    storagePath,
    fileId,
    alt,
    className,
    onClick,
    "data-testid": testId
}: {
    imageUrl?: string;
    storagePath?: string;
    fileId?: string;
    alt: string;
    className?: string;
    onClick?: () => void;
    "data-testid"?: string;
}) {
    const [resolvedSrc, setResolvedSrc] = useState<string>(imageUrl || '');
    const [isLoading, setIsLoading] = useState(!imageUrl);
    const [hasError, setHasError] = useState(false);
    const [retryCount, setRetryCount] = useState(0);
    const cacheKey = fileId || storagePath || '';
    const maxRetries = 2;

    // Resolve image source: try IndexedDB cache first, then storagePath
    useEffect(() => {
        if (imageUrl) {
            setResolvedSrc(imageUrl);
            setIsLoading(false);
            // Cache base64 in IndexedDB for future sessions (fire-and-forget)
            if (cacheKey) {
                import('@/lib/attachment-db').then(({ storeImage }) => {
                    storeImage({ id: `att_${cacheKey}`, messageId: '', chatId: '', base64: imageUrl, mimeType: 'image/jpeg' }).catch(() => {});
                }).catch(() => {});
            }
            return;
        }

        let cancelled = false;

        const resolve = async () => {
            // Try IndexedDB cache first
            if (cacheKey) {
                try {
                    const { getImage } = await import('@/lib/attachment-db');
                    const cached = await getImage(`att_${cacheKey}`);
                    if (cached?.base64 && !cancelled) {
                        setResolvedSrc(cached.base64);
                        setIsLoading(false);
                        return;
                    }
                } catch {}
            }

            // Fall back to storagePath (network request)
            if (storagePath && !cancelled) {
                setResolvedSrc(storagePath);
                setIsLoading(false);
            } else if (!cancelled) {
                setHasError(true);
                setIsLoading(false);
            }
        };

        resolve();
        return () => { cancelled = true; };
    }, [imageUrl, storagePath, cacheKey]);

    const handleLoad = useCallback(() => {
        setIsLoading(false);
        setHasError(false);
        // Cache network-loaded image in IndexedDB for future
        if (!imageUrl && storagePath && cacheKey) {
            // Convert loaded image to base64 and cache
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.min(img.naturalWidth, 800); // Limit cache size
                    canvas.height = Math.round(img.naturalHeight * (canvas.width / img.naturalWidth));
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        const base64 = canvas.toDataURL('image/jpeg', 0.85);
                        import('@/lib/attachment-db').then(({ storeImage }) => {
                            storeImage({ id: `att_${cacheKey}`, messageId: '', chatId: '', base64, mimeType: 'image/jpeg' }).catch(() => {});
                        }).catch(() => {});
                    }
                } catch {}
            };
            img.src = storagePath;
        }
    }, [imageUrl, storagePath, cacheKey]);

    const handleError = useCallback(() => {
        if (retryCount < maxRetries) {
            // Retry with exponential backoff
            const delay = 1000 * Math.pow(2, retryCount);
            setTimeout(() => {
                setRetryCount(prev => prev + 1);
                setHasError(false);
                // Force re-fetch by appending retry param
                if (storagePath) {
                    const separator = storagePath.includes('?') ? '&' : '?';
                    setResolvedSrc(`${storagePath}${separator}_retry=${retryCount + 1}`);
                }
            }, delay);
        } else {
            setHasError(true);
            setIsLoading(false);
        }
    }, [retryCount, storagePath]);

    const handleRetryClick = useCallback(() => {
        setRetryCount(0);
        setHasError(false);
        setIsLoading(true);
        if (storagePath) {
            setResolvedSrc(`${storagePath}?_retry=${Date.now()}`);
        }
    }, [storagePath]);

    if (hasError && retryCount >= maxRetries) {
        return (
            <div
                className={cn("flex flex-col items-center justify-center gap-2 bg-muted/50 rounded-lg p-4 cursor-pointer", className)}
                onClick={handleRetryClick}
                data-testid={testId}
            >
                <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                <span className="text-xs text-muted-foreground">Error al cargar - Clic para reintentar</span>
            </div>
        );
    }

    return (
        <div className="relative" data-testid={testId}>
            {isLoading && (
                <ImageSkeleton className={cn(className, "absolute inset-0")} />
            )}
            {resolvedSrc && (
                <img
                    src={resolvedSrc}
                    alt={alt}
                    loading="lazy"
                    className={cn(className, isLoading && "opacity-0")}
                    onClick={onClick}
                    onLoad={handleLoad}
                    onError={handleError}
                />
            )}
        </div>
    );
});

export const CleanDataTableWrapper = ({ children }: { children?: React.ReactNode }) => {
    const [copied, setCopied] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const tableRef = useRef<HTMLDivElement>(null);

    const handleCopy = useCallback(async () => {
        if (!tableRef.current) return;
        const table = tableRef.current.querySelector('table');
        if (!table) return;

        const rows = table.querySelectorAll('tr');
        const text = Array.from(rows).map(row => {
            const cells = row.querySelectorAll('th, td');
            return Array.from(cells).map(cell => cell.textContent?.trim() || '').join('\t');
        }).join('\n');

        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy table:', err);
        }
    }, []);

    const handleDownload = useCallback(() => {
        if (!tableRef.current) return;
        const table = tableRef.current.querySelector('table');
        if (!table) return;

        const rows = table.querySelectorAll('tr');
        const csv = Array.from(rows).map(row => {
            const cells = row.querySelectorAll('th, td');
            return Array.from(cells).map(cell => {
                const text = cell.textContent?.trim() || '';
                return text.includes(',') ? `"${text}"` : text;
            }).join(',');
        }).join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'tabla.csv';
        link.click();
        URL.revokeObjectURL(url);
    }, []);

    return (
        <div
            ref={tableRef}
            className={cn(
                "relative group my-4",
                isExpanded && "fixed inset-4 z-50 bg-background rounded-lg border shadow-2xl overflow-auto p-4"
            )}
        >
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <button
                    onClick={handleCopy}
                    className="p-1.5 rounded-md bg-muted/80 hover:bg-muted border border-border/50"
                    title={copied ? "Copiado" : "Copiar tabla"}
                    data-testid="button-copy-table"
                >
                    {copied ? (
                        <Check className="h-4 w-4 text-green-500" />
                    ) : (
                        <Copy className="h-4 w-4 text-muted-foreground" />
                    )}
                </button>
                <button
                    onClick={handleDownload}
                    className="p-1.5 rounded-md bg-muted/80 hover:bg-muted border border-border/50"
                    title="Descargar CSV"
                    data-testid="button-download-table"
                >
                    <Download className="h-4 w-4 text-muted-foreground" />
                </button>
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="p-1.5 rounded-md bg-muted/80 hover:bg-muted border border-border/50"
                    title={isExpanded ? "Minimizar" : "Expandir"}
                    data-testid="button-expand-table"
                >
                    {isExpanded ? (
                        <Minimize2 className="h-4 w-4 text-muted-foreground" />
                    ) : (
                        <Maximize2 className="h-4 w-4 text-muted-foreground" />
                    )}
                </button>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full border-collapse border border-border text-sm">
                    {children}
                </table>
            </div>
        </div>
    );
};

export const CleanDataTableComponents = {
    table: CleanDataTableWrapper,
    thead: ({ children }: { children?: React.ReactNode }) => (
        <thead className="bg-muted/50">{children}</thead>
    ),
    tbody: ({ children }: { children?: React.ReactNode }) => (
        <tbody>{children}</tbody>
    ),
    tr: ({ children }: { children?: React.ReactNode }) => (
        <tr className="border-b border-border">{children}</tr>
    ),
    th: ({ children }: { children?: React.ReactNode }) => {
        const text = extractTextFromChildren(children);
        const isNumeric = isNumericValue(text);
        return (
            <th
                scope="col"
                className={cn(
                    "px-3 py-2 text-left font-semibold",
                    isNumeric && "text-right"
                )}
            >
                {children}
            </th>
        );
    },
    td: ({ children }: { children?: React.ReactNode }) => {
        const text = extractTextFromChildren(children);
        const isNumeric = isNumericValue(text);
        const isLong = text.length > 50;
        return (
            <td
                className={cn(
                    "px-3 py-2",
                    isNumeric && "text-right",
                    isLong && "max-w-xs break-words"
                )}
            >
                {children}
            </td>
        );
    }
};

const DocumentBlockSchema = z.object({
    type: z.enum(["word", "excel", "ppt"]),
    title: z.string().min(1),
    content: z.string()
});

export const parseDocumentBlocks = (
    content: string
): { text: string; documents: DocumentBlock[] } => {
    if (!content || typeof content !== 'string') {
        return { text: content || '', documents: [] };
    }

    const documents: DocumentBlock[] = [];
    const regex = /```document\s*\n([\s\S]*?)```/g;
    let match;
    let cleanText = content;
    const successfulBlocks: string[] = [];

    while ((match = regex.exec(content)) !== null) {
        try {
            let jsonStr = match[1]?.trim();
            if (!jsonStr) continue;

            jsonStr = jsonStr.replace(
                /"content"\s*:\s*"([\s\S]*?)"\s*\}/,
                (m: string, contentValue: string) => {
                    const fixedContent = contentValue
                        .replace(/\n/g, "\\n")
                        .replace(/\r/g, "\\r")
                        .replace(/\t/g, "\\t");
                    return `"content": "${fixedContent}"}`;
                }
            );

            const parsed = JSON.parse(jsonStr);
            const validated = DocumentBlockSchema.safeParse(parsed);

            if (validated.success) {
                const doc = validated.data;
                doc.content = doc.content
                    .replace(/\\n/g, "\n")
                    .replace(/\\\\n/g, "\n");
                documents.push(doc);
                successfulBlocks.push(match[0]);
            }
        } catch (e) {
            // Regex fallback logic omitted for brevity as typically not needed if valid JSON
            try {
                const blockContent = match[1];
                if (!blockContent) continue;

                const typeMatch = blockContent.match(
                    /"type"\s*:\s*"(word|excel|ppt)"/
                );
                const titleMatch = blockContent.match(/"title"\s*:\s*"([^"]+)"/);
                const contentMatch = blockContent.match(
                    /"content"\s*:\s*"([\s\S]*?)"\s*\}?\s*$/
                );

                if (typeMatch && titleMatch && contentMatch) {
                    documents.push({
                        type: typeMatch[1] as "word" | "excel" | "ppt",
                        title: titleMatch[1],
                        content: contentMatch[1]
                            .replace(/\\n/g, "\n")
                            .replace(/\\\\n/g, "\n")
                    });
                    successfulBlocks.push(match[0]);
                }
            } catch (fallbackError) {
                // ignore
            }
        }
    }

    for (const block of successfulBlocks) {
        cleanText = cleanText.replace(block, "").trim();
    }

    return { text: cleanText, documents };
};

export const extractCodeBlocks = (
    content: string
): { type: "text" | "python"; content: string }[] => {
    if (!content || typeof content !== 'string') {
        return [{ type: "text" as const, content: content || "" }];
    }

    const pythonBlockRegex = /```(?:python|py)\n([\s\S]*?)```/g;
    const blocks: { type: "text" | "python"; content: string }[] = [];
    let lastIndex = 0;
    let match;

    while ((match = pythonBlockRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
            const textContent = content.slice(lastIndex, match.index);
            if (textContent) {
                blocks.push({
                    type: "text",
                    content: textContent
                });
            }
        }
        const codeContent = match[1] ?? "";
        blocks.push({ type: "python", content: codeContent });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
        const remainingContent = content.slice(lastIndex);
        if (remainingContent) {
            blocks.push({ type: "text", content: remainingContent });
        }
    }

    return blocks.length > 0 ? blocks : [{ type: "text" as const, content: content || "" }];
};

interface AttachmentListProps {
    attachments: Message["attachments"];
    variant: "compact" | "default";
    onOpenPreview?: (attachment: NonNullable<Message["attachments"]>[0]) => void;
    onReopenDocument?: (doc: ReopenDocumentRequest) => void;
}

export const AttachmentList = memo(function AttachmentList({
    attachments,
    variant,
    onOpenPreview,
    onReopenDocument
}: AttachmentListProps) {
    if (!attachments || attachments.length === 0) return null;

    return (
        <div
            className={cn(
                "flex flex-wrap gap-2",
                variant === "default" && "mb-2 justify-end"
            )}
        >
            {attachments.map((att, i) =>
                att.type === "document" && att.documentType && att.fileId ? (
                    <div
                        key={i}
                        className={cn(
                            "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm border bg-card border-border cursor-pointer hover:bg-accent/80 hover:border-accent transition-all duration-200 shadow-sm hover:shadow-md"
                        )}
                        onClick={() => onOpenPreview?.(att)}
                        data-testid={`attachment-document-${i}`}
                    >
                        <div
                            className={cn(
                                "flex items-center justify-center w-9 h-9 rounded-lg shrink-0",
                                att.documentType === "word" && "bg-blue-600",
                                att.documentType === "excel" && "bg-green-600",
                                att.documentType === "ppt" && "bg-orange-500",
                                att.documentType === "pdf" && "bg-red-600"
                            )}
                        >
                            {att.documentType === "word" ? <FileText className="h-4 w-4 text-white" /> :
                             att.documentType === "excel" ? <FileSpreadsheet className="h-4 w-4 text-white" /> :
                             att.documentType === "ppt" ? <Presentation className="h-4 w-4 text-white" /> :
                             <FileText className="h-4 w-4 text-white" />}
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                            <span className="max-w-[200px] truncate font-medium">
                                {att.title || att.name}
                            </span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Eye className="h-3 w-3" /> Click to preview
                            </span>
                        </div>
                    </div>
                ) : att.type === "document" && att.documentType ? (
                    <div
                        key={i}
                        className={cn(
                            "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm border bg-card border-border cursor-pointer hover:bg-accent/80 hover:border-accent transition-all duration-200 shadow-sm hover:shadow-md"
                        )}
                        onClick={() => onReopenDocument?.({
                            type: att.documentType as "word" | "excel" | "ppt",
                            title: att.title || att.name,
                            content: att.content || ""
                        })}
                        data-testid={`attachment-document-${i}`}
                    >
                        <div
                            className={cn(
                                "flex items-center justify-center w-9 h-9 rounded-lg shrink-0",
                                att.documentType === "word" && "bg-blue-600",
                                att.documentType === "excel" && "bg-green-600",
                                att.documentType === "ppt" && "bg-orange-500",
                                att.documentType === "pdf" && "bg-red-600"
                            )}
                        >
                            {att.documentType === "word" ? <FileText className="h-4 w-4 text-white" /> :
                             att.documentType === "excel" ? <FileSpreadsheet className="h-4 w-4 text-white" /> :
                             att.documentType === "ppt" ? <Presentation className="h-4 w-4 text-white" /> :
                             <FileText className="h-4 w-4 text-white" />}
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                            <span className="max-w-[200px] truncate font-medium">
                                {att.title || att.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                Saved document - Click to open
                            </span>
                        </div>
                    </div>
                ) : att.type === "image" && (att.imageUrl || att.storagePath || att.fileId) ? (
                    <div
                        key={i}
                        className={cn(
                            "relative rounded-xl overflow-hidden border border-border",
                            variant === "default" && "max-w-[280px] cursor-pointer hover:opacity-90 transition-opacity"
                        )}
                        onClick={() => onOpenPreview?.(att)}
                    >
                        <AttachmentImage
                            imageUrl={att.imageUrl}
                            storagePath={att.storagePath}
                            fileId={att.fileId}
                            alt={att.name}
                            className="w-full h-auto max-h-[200px] object-cover"
                            data-testid={`attachment-image-${i}`}
                        />
                    </div>
                ) : att.spreadsheetData ? (
                    <div key={i} className="flex flex-col gap-3">
                        <ChatSpreadsheetViewer
                            uploadId={att.spreadsheetData.uploadId}
                            filename={att.name}
                            sheets={att.spreadsheetData.sheets}
                            previewData={att.spreadsheetData.previewData}
                            onDownload={() => onOpenPreview?.(att)}
                            onExpand={() => window.open(`/spreadsheet-analyzer?uploadId=${att.spreadsheetData!.uploadId}`, '_blank')}
                        />
                        
                    </div>
                ) : (
                    (() => {
                        const attTheme = getFileTheme(att.name, att.mimeType);
                        return (
                            <div
                                key={i}
                                className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-xl text-sm border bg-card border-border",
                                    variant === "default" && "cursor-pointer hover:bg-accent transition-colors"
                                )}
                                onClick={() => onOpenPreview?.(att)}
                                data-testid={`attachment-file-${i}`}
                            >
                                <div
                                    className={cn(
                                        "flex items-center justify-center w-8 h-8 rounded-lg",
                                        attTheme.bgColor
                                    )}
                                >
                                    <span className="text-white text-xs font-bold">
                                        {attTheme.icon}
                                    </span>
                                </div>
                                <span className="max-w-[200px] truncate font-medium">
                                    {att.name}
                                </span>
                            </div>
                        );
                    })()
                )
            )}
        </div>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.variant === nextProps.variant &&
        prevProps.attachments === nextProps.attachments
    );
});

export interface ActionToolbarProps {
    messageId: string;
    content: string;
    msgIndex: number;
    copiedMessageId: string | null;
    messageFeedback: Record<string, "up" | "down" | null>;
    speakingMessageId: string | null;
    aiState: "idle" | "thinking" | "responding" | "agent_working";
    isRegenerating: boolean;
    variant: "compact" | "default";
    webSources?: WebSource[];
    onCopy: (content: string, id: string) => void;
    onFeedback: (id: string, type: "up" | "down") => void;
    onRegenerate: (index: number, instruction?: string) => void;
    onShare: (content: string) => void;
    onReadAloud: (id: string, content: string) => void;
    onViewSources?: () => void;
}

export const ActionToolbar = memo(function ActionToolbar({
    messageId,
    content,
    msgIndex,
    copiedMessageId,
    messageFeedback,
    speakingMessageId,
    aiState,
    isRegenerating,
    variant,
    webSources,
    onCopy,
    onFeedback,
    onRegenerate,
    onShare,
    onReadAloud,
    onViewSources
}: ActionToolbarProps) {
    const testIdSuffix = variant === "compact" ? messageId : `main-${messageId}`;
    const [regenerateOpen, setRegenerateOpen] = useState(false);
    const [customInstruction, setCustomInstruction] = useState("");

    const handleRegenerateOption = useCallback((instruction?: string) => {
        setRegenerateOpen(false);
        setCustomInstruction("");
        onRegenerate(msgIndex, instruction);
    }, [msgIndex, onRegenerate]);

    const handleCustomSubmit = useCallback(() => {
        if (customInstruction.trim()) {
            handleRegenerateOption(customInstruction.trim());
        }
    }, [customInstruction, handleRegenerateOption]);

    return (
        <TooltipProvider delayDuration={300}>
            <div
                className="inline-flex items-center gap-0"
                data-testid={`message-actions-${testIdSuffix}`}
            >
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground/70 hover:text-foreground"
                            onClick={() => onCopy(content, messageId)}
                            data-testid={`button-copy-${testIdSuffix}`}
                            aria-label="Copiar respuesta"
                        >
                            {copiedMessageId === messageId ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                                <Copy className="h-3.5 w-3.5" />
                            )}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p>Copiar respuesta</p>
                    </TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-6 w-6",
                                messageFeedback[messageId] === "up"
                                    ? "text-green-500"
                                    : "text-muted-foreground/70 hover:text-foreground"
                            )}
                            onClick={() => onFeedback(messageId, "up")}
                            data-testid={`button-like-${testIdSuffix}`}
                            aria-label="Me gusta"
                        >
                            <ThumbsUp className="h-3.5 w-3.5" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p>Me gusta</p>
                    </TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-6 w-6",
                                messageFeedback[messageId] === "down"
                                    ? "text-red-500"
                                    : "text-muted-foreground/70 hover:text-foreground"
                            )}
                            onClick={() => onFeedback(messageId, "down")}
                            data-testid={`button-dislike-${testIdSuffix}`}
                            aria-label="No me gusta"
                        >
                            <ThumbsDown className="h-3.5 w-3.5" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p>No me gusta</p>
                    </TooltipContent>
                </Tooltip>

                <Popover open={regenerateOpen} onOpenChange={setRegenerateOpen}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-muted-foreground/70 hover:text-foreground"
                                    disabled={aiState !== "idle"}
                                    data-testid={`button-regenerate-${testIdSuffix}`}
                                    aria-label="Regenerar respuesta"
                                >
                                    <RefreshCw
                                        className={cn("h-3.5 w-3.5", isRegenerating && "animate-spin")}
                                    />
                                </Button>
                            </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>Regenerar</p>
                        </TooltipContent>
                    </Tooltip>
                    <PopoverContent
                        className="w-52 p-1.5 bg-background/95 backdrop-blur-xl border-border/50 shadow-lg"
                        align="start"
                        side="top"
                        sideOffset={8}
                    >
                        <div className="space-y-0.5">
                            <div className="flex items-center gap-1 px-1 pb-1 border-b border-border/30 mb-1">
                                <input
                                    type="text"
                                    placeholder="Pedir cambio de respuesta"
                                    value={customInstruction}
                                    onChange={(e) => setCustomInstruction(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleCustomSubmit()}
                                    className="flex-1 h-7 px-2 text-[13px] bg-transparent border-none outline-none placeholder:text-muted-foreground/50"
                                    data-testid={`input-custom-regenerate-${testIdSuffix}`}
                                />
                                <button
                                    onClick={handleCustomSubmit}
                                    disabled={!customInstruction.trim()}
                                    className="h-6 w-6 flex items-center justify-center rounded-full bg-foreground/10 hover:bg-foreground/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                    data-testid={`button-submit-custom-${testIdSuffix}`}
                                    aria-label="Enviar instrucción"
                                    title="Enviar instrucción"
                                >
                                    <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            <button
                                className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-left hover:bg-muted/60 rounded transition-colors"
                                onClick={() => handleRegenerateOption()}
                                data-testid={`option-retry-${testIdSuffix}`}
                            >
                                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground/70" />
                                <span>Inténtalo nuevamente</span>
                            </button>
                            <button
                                className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-left hover:bg-muted/60 rounded transition-colors"
                                onClick={() => handleRegenerateOption("Agrega más detalles y explicaciones a tu respuesta")}
                                data-testid={`option-details-${testIdSuffix}`}
                            >
                                <ListPlus className="h-3.5 w-3.5 text-muted-foreground/70" />
                                <span>Agregar detalles</span>
                            </button>
                            <button
                                className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-left hover:bg-muted/60 rounded transition-colors"
                                onClick={() => handleRegenerateOption("Hazlo más conciso y breve, elimina redundancias")}
                                data-testid={`option-concise-${testIdSuffix}`}
                            >
                                <Minus className="h-3.5 w-3.5 text-muted-foreground/70" />
                                <span>Más concisa</span>
                            </button>
                        </div>
                    </PopoverContent>
                </Popover>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-6 w-6",
                                speakingMessageId === messageId
                                    ? "text-primary"
                                    : "text-muted-foreground/70 hover:text-foreground"
                            )}
                            onClick={() => onReadAloud(messageId, content)}
                            data-testid={`button-read-aloud-${testIdSuffix}`}
                            aria-label="Leer en voz alta"
                        >
                            {speakingMessageId === messageId ? (
                                <VolumeX className="h-3.5 w-3.5" />
                            ) : (
                                <Volume2 className="h-3.5 w-3.5" />
                            )}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p>{speakingMessageId === messageId ? "Detener" : "Leer en voz alta"}</p>
                    </TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground/70 hover:text-foreground"
                            onClick={() => onShare(content)}
                            data-testid={`button-share-${testIdSuffix}`}
                            aria-label="Compartir"
                        >
                            <Share2 className="h-3.5 w-3.5" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p>Compartir</p>
                    </TooltipContent>
                </Tooltip>

                {/* Sources stacked logos - only when webSources exist */}
                {webSources && webSources.length > 0 && onViewSources && (
                    <>
                        <div className="w-px h-4 bg-border/50 mx-1" />
                        <button
                            onClick={onViewSources}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted/50 hover:bg-muted border border-border/30 hover:border-border/60 transition-all cursor-pointer group"
                            data-testid={`button-sources-stacked-${testIdSuffix}`}
                        >
                            <div className="flex items-center">
                                {webSources
                                    .reduce((acc: WebSource[], s) => {
                                        const d = s.domain?.replace(/^www\./, "") || "";
                                        if (!acc.find(x => (x.domain?.replace(/^www\./, "") || "") === d)) acc.push(s);
                                        return acc;
                                    }, [])
                                    .slice(0, 4)
                                    .map((source, idx) => (
                                        <div
                                            key={`stk-${idx}`}
                                            className={cn(
                                                "w-5 h-5 rounded-full bg-white dark:bg-zinc-800 border-2 border-white dark:border-zinc-800 overflow-hidden flex items-center justify-center shadow-sm",
                                                idx > 0 && "-ml-2"
                                            )}
                                            style={{ zIndex: 10 - idx }}
                                        >
                                            <img
                                                src={`https://www.google.com/s2/favicons?domain=${source.domain?.replace(/^www\./, "")}&sz=64`}
                                                alt=""
                                                className="w-3.5 h-3.5 rounded-full object-contain"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                        </div>
                                    ))}
                            </div>
                            <span className="text-xs font-semibold text-foreground/70 group-hover:text-foreground transition-colors whitespace-nowrap">
                                {webSources.length} sources
                            </span>
                        </button>
                    </>
                )}
            </div>
        </TooltipProvider>
    );
});
