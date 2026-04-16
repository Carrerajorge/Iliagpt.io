/**
 * Split View Layout - ILIAGPT PRO 3.0
 * 
 * Resizable split panel for document + chat side-by-side view
 */

import { memo, useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    PanelLeftClose,
    PanelRightClose,
    GripVertical,
    Maximize2,
    Minimize2,
    X,
    FileText,
    Code,
    Image
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface SplitViewLayoutProps {
    leftPanel: React.ReactNode;
    rightPanel: React.ReactNode;
    leftTitle?: string;
    rightTitle?: string;
    defaultSplit?: number; // 0-100 percentage for left panel
    minLeftWidth?: number; // px
    minRightWidth?: number; // px
    onClose?: () => void;
    className?: string;
}

export const SplitViewLayout = memo(function SplitViewLayout({
    leftPanel,
    rightPanel,
    leftTitle = "Documento",
    rightTitle = "Chat",
    defaultSplit = 50,
    minLeftWidth = 300,
    minRightWidth = 350,
    onClose,
    className,
}: SplitViewLayoutProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [splitPercent, setSplitPercent] = useState(defaultSplit);
    const [isDragging, setIsDragging] = useState(false);
    const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
    const [isRightCollapsed, setIsRightCollapsed] = useState(false);

    // Handle resize drag
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!containerRef.current) return;

            const rect = containerRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = (x / rect.width) * 100;

            // Clamp between min widths
            const minLeft = (minLeftWidth / rect.width) * 100;
            const minRight = (minRightWidth / rect.width) * 100;
            const maxPercent = 100 - minRight;

            setSplitPercent(Math.max(minLeft, Math.min(maxPercent, percent)));
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isDragging, minLeftWidth, minRightWidth]);

    // Collapse handlers
    const toggleLeftCollapse = useCallback(() => {
        setIsLeftCollapsed(prev => !prev);
        if (isRightCollapsed) setIsRightCollapsed(false);
    }, [isRightCollapsed]);

    const toggleRightCollapse = useCallback(() => {
        setIsRightCollapsed(prev => !prev);
        if (isLeftCollapsed) setIsLeftCollapsed(false);
    }, [isLeftCollapsed]);

    const effectiveLeftWidth = isLeftCollapsed ? 0 : isRightCollapsed ? 100 : splitPercent;
    const effectiveRightWidth = isRightCollapsed ? 0 : isLeftCollapsed ? 100 : 100 - splitPercent;

    return (
        <div
            ref={containerRef}
            className={cn(
                "flex h-full w-full relative overflow-hidden",
                isDragging && "select-none cursor-col-resize",
                className
            )}
        >
            {/* Left Panel */}
            <motion.div
                animate={{ width: `${effectiveLeftWidth}%` }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className={cn(
                    "h-full flex flex-col overflow-hidden",
                    isLeftCollapsed && "w-0"
                )}
            >
                {/* Left Header */}
                <div className="flex items-center justify-between h-12 px-3 border-b bg-muted/30 flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium truncate">{leftTitle}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={toggleLeftCollapse}
                                    >
                                        {isLeftCollapsed ? (
                                            <Maximize2 className="w-4 h-4" />
                                        ) : (
                                            <PanelLeftClose className="w-4 h-4" />
                                        )}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {isLeftCollapsed ? "Expandir" : "Colapsar"}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>

                {/* Left Content */}
                <div className="flex-1 overflow-auto">
                    {leftPanel}
                </div>
            </motion.div>

            {/* Resize Handle */}
            {!isLeftCollapsed && !isRightCollapsed && (
                <div
                    className={cn(
                        "relative w-1 flex-shrink-0 group cursor-col-resize",
                        "hover:bg-primary/20 transition-colors",
                        isDragging && "bg-primary/30"
                    )}
                    onMouseDown={handleMouseDown}
                >
                    {/* Visual grip */}
                    <div className={cn(
                        "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
                        "flex items-center justify-center w-4 h-8 rounded-full",
                        "bg-muted border border-border opacity-0 group-hover:opacity-100",
                        "transition-opacity",
                        isDragging && "opacity-100 bg-primary/20 border-primary/50"
                    )}>
                        <GripVertical className="w-3 h-3 text-muted-foreground" />
                    </div>
                </div>
            )}

            {/* Right Panel */}
            <motion.div
                animate={{ width: `${effectiveRightWidth}%` }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className={cn(
                    "h-full flex flex-col overflow-hidden border-l",
                    isRightCollapsed && "w-0 border-l-0"
                )}
            >
                {/* Right Header */}
                <div className="flex items-center justify-between h-12 px-3 border-b bg-muted/30 flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{rightTitle}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={toggleRightCollapse}
                                    >
                                        {isRightCollapsed ? (
                                            <Maximize2 className="w-4 h-4" />
                                        ) : (
                                            <PanelRightClose className="w-4 h-4" />
                                        )}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {isRightCollapsed ? "Expandir" : "Colapsar"}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        {onClose && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                            onClick={onClose}
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Cerrar Split View</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                </div>

                {/* Right Content */}
                <div className="flex-1 overflow-auto">
                    {rightPanel}
                </div>
            </motion.div>

            {/* Collapsed indicators */}
            <AnimatePresence>
                {isLeftCollapsed && (
                    <motion.button
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-muted border shadow-lg hover:bg-accent transition-colors"
                        onClick={toggleLeftCollapse}
                    >
                        <PanelRightClose className="w-4 h-4" />
                    </motion.button>
                )}
                {isRightCollapsed && (
                    <motion.button
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-muted border shadow-lg hover:bg-accent transition-colors"
                        onClick={toggleRightCollapse}
                    >
                        <PanelLeftClose className="w-4 h-4" />
                    </motion.button>
                )}
            </AnimatePresence>
        </div>
    );
});

/**
 * Hook for managing split view state
 */
export function useSplitView() {
    const [isEnabled, setIsEnabled] = useState(false);
    const [documentContent, setDocumentContent] = useState<{
        type: "text" | "code" | "image" | "pdf";
        content: string;
        title?: string;
    } | null>(null);

    const openSplitView = useCallback((content: typeof documentContent) => {
        setDocumentContent(content);
        setIsEnabled(true);
    }, []);

    const closeSplitView = useCallback(() => {
        setIsEnabled(false);
        setDocumentContent(null);
    }, []);

    return {
        isEnabled,
        documentContent,
        openSplitView,
        closeSplitView,
        setDocumentContent,
    };
}

export default SplitViewLayout;
