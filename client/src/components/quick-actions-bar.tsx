/**
 * Quick Actions Bar - ILIAGPT PRO 3.0
 * 
 * Floating action bar for message interactions:
 * Copy, Edit, Regenerate, Export, Branch
 */

import { memo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Copy,
    Check,
    RefreshCw,
    Edit3,
    Share2,
    FileDown,
    Bookmark,
    MoreHorizontal,
    ThumbsUp,
    ThumbsDown,
    MessageSquarePlus,
    Code2,
    FileText
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    TooltipProvider
} from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ============== Types ==============

export interface QuickAction {
    id: string;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    shortcut?: string;
    variant?: "default" | "success" | "danger";
}

interface QuickActionsBarProps {
    messageId: string;
    content: string;
    isAssistant?: boolean;
    onCopy?: () => void;
    onEdit?: () => void;
    onRegenerate?: () => void;
    onExport?: (format: "markdown" | "text" | "docx") => void;
    onShare?: () => void;
    onBookmark?: () => void;
    onFeedback?: (type: "up" | "down") => void;
    onBranch?: () => void;
    className?: string;
    variant?: "floating" | "inline" | "minimal";
}

// ============== Components ==============

/**
 * Copy button with success state
 */
function CopyButton({ content, onCopy }: { content: string; onCopy?: () => void }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            onCopy?.();
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    }, [content, onCopy]);

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-7 w-7 transition-colors",
                            copied && "text-green-500"
                        )}
                        onClick={handleCopy}
                    >
                        {copied ? (
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                            >
                                <Check className="w-3.5 h-3.5" />
                            </motion.div>
                        ) : (
                            <Copy className="w-3.5 h-3.5" />
                        )}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>{copied ? "¡Copiado!" : "Copiar"}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

/**
 * Main Quick Actions Bar
 */
export const QuickActionsBar = memo(function QuickActionsBar({
    messageId,
    content,
    isAssistant = true,
    onCopy,
    onEdit,
    onRegenerate,
    onExport,
    onShare,
    onBookmark,
    onFeedback,
    onBranch,
    className,
    variant = "floating",
}: QuickActionsBarProps) {
    const [showMore, setShowMore] = useState(false);

    const baseClasses = cn(
        "flex items-center gap-0.5",
        variant === "floating" && "bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg px-1 py-0.5",
        variant === "inline" && "bg-muted/50 rounded-md px-1 py-0.5",
        variant === "minimal" && "opacity-0 group-hover:opacity-100 transition-opacity",
        className
    );

    return (
        <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className={baseClasses}
        >
            {/* Copy */}
            <CopyButton content={content} onCopy={onCopy} />

            {/* Regenerate (only for assistant) */}
            {isAssistant && onRegenerate && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={onRegenerate}
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Regenerar respuesta</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}

            {/* Edit (only for user) */}
            {!isAssistant && onEdit && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={onEdit}
                            >
                                <Edit3 className="w-3.5 h-3.5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Editar mensaje</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}

            {/* Feedback (only for assistant) */}
            {isAssistant && onFeedback && (
                <>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 hover:text-green-500"
                                    onClick={() => onFeedback("up")}
                                >
                                    <ThumbsUp className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Buena respuesta</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 hover:text-red-500"
                                    onClick={() => onFeedback("down")}
                                >
                                    <ThumbsDown className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Mala respuesta</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </>
            )}

            {/* More actions dropdown */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    {onBookmark && (
                        <DropdownMenuItem onClick={onBookmark}>
                            <Bookmark className="w-4 h-4 mr-2" />
                            Guardar en favoritos
                        </DropdownMenuItem>
                    )}

                    {onBranch && (
                        <DropdownMenuItem onClick={onBranch}>
                            <MessageSquarePlus className="w-4 h-4 mr-2" />
                            Crear rama desde aquí
                        </DropdownMenuItem>
                    )}

                    {onShare && (
                        <DropdownMenuItem onClick={onShare}>
                            <Share2 className="w-4 h-4 mr-2" />
                            Compartir
                        </DropdownMenuItem>
                    )}

                    <DropdownMenuSeparator />

                    {onExport && (
                        <>
                            <DropdownMenuItem onClick={() => onExport("markdown")}>
                                <Code2 className="w-4 h-4 mr-2" />
                                Exportar Markdown
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onExport("text")}>
                                <FileText className="w-4 h-4 mr-2" />
                                Exportar Texto
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onExport("docx")}>
                                <FileDown className="w-4 h-4 mr-2" />
                                Exportar Word
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </motion.div>
    );
});

/**
 * Compact inline version
 */
export function InlineQuickActions({
    content,
    onCopy
}: {
    content: string;
    onCopy?: () => void;
}) {
    return (
        <div className="inline-flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyButton content={content} onCopy={onCopy} />
        </div>
    );
}

export default QuickActionsBar;
