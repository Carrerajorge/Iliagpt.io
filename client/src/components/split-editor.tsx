/**
 * Split Editor Component - ILIAGPT PRO 3.0
 * 
 * Side-by-side editing of code and documents.
 * Resizable panes with synchronized scrolling.
 */

import React, { useState, useCallback, useRef, useEffect } from "react";

// ============== Types ==============

export interface SplitEditorProps {
    leftContent?: string;
    rightContent?: string;
    leftTitle?: string;
    rightTitle?: string;
    leftLanguage?: string;
    rightLanguage?: string;
    onLeftChange?: (content: string) => void;
    onRightChange?: (content: string) => void;
    syncScroll?: boolean;
    theme?: "light" | "dark";
    className?: string;
}

interface PaneState {
    content: string;
    scrollTop: number;
    cursorPosition: { line: number; column: number };
}

// ============== Component ==============

export function SplitEditor({
    leftContent = "",
    rightContent = "",
    leftTitle = "Editor 1",
    rightTitle = "Editor 2",
    leftLanguage = "text",
    rightLanguage = "text",
    onLeftChange,
    onRightChange,
    syncScroll = true,
    theme = "dark",
    className = "",
}: SplitEditorProps) {
    const [leftPane, setLeftPane] = useState<PaneState>({
        content: leftContent,
        scrollTop: 0,
        cursorPosition: { line: 1, column: 1 },
    });

    const [rightPane, setRightPane] = useState<PaneState>({
        content: rightContent,
        scrollTop: 0,
        cursorPosition: { line: 1, column: 1 },
    });

    const [splitPosition, setSplitPosition] = useState(50);
    const [isDragging, setIsDragging] = useState(false);
    const [activePane, setActivePane] = useState<"left" | "right">("left");

    const containerRef = useRef<HTMLDivElement>(null);
    const leftEditorRef = useRef<HTMLTextAreaElement>(null);
    const rightEditorRef = useRef<HTMLTextAreaElement>(null);

    // ======== Split Resizing ========

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging || !containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        const newPosition = ((e.clientX - rect.left) / rect.width) * 100;
        setSplitPosition(Math.max(20, Math.min(80, newPosition)));
    }, [isDragging]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    useEffect(() => {
        if (isDragging) {
            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
            return () => {
                window.removeEventListener("mousemove", handleMouseMove);
                window.removeEventListener("mouseup", handleMouseUp);
            };
        }
    }, [isDragging, handleMouseMove, handleMouseUp]);

    // ======== Synchronized Scroll ========

    const handleScroll = useCallback((pane: "left" | "right", scrollTop: number) => {
        if (!syncScroll) return;

        if (pane === "left" && rightEditorRef.current) {
            rightEditorRef.current.scrollTop = scrollTop;
        } else if (pane === "right" && leftEditorRef.current) {
            leftEditorRef.current.scrollTop = scrollTop;
        }
    }, [syncScroll]);

    // ======== Content Changes ========

    const handleLeftChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const content = e.target.value;
        setLeftPane(p => ({ ...p, content }));
        onLeftChange?.(content);
    }, [onLeftChange]);

    const handleRightChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const content = e.target.value;
        setRightPane(p => ({ ...p, content }));
        onRightChange?.(content);
    }, [onRightChange]);

    // ======== Cursor Position ========

    const updateCursorPosition = useCallback((
        textarea: HTMLTextAreaElement,
        pane: "left" | "right"
    ) => {
        const text = textarea.value.substring(0, textarea.selectionStart);
        const lines = text.split("\n");
        const line = lines.length;
        const column = lines[lines.length - 1].length + 1;

        const update = { line, column };
        if (pane === "left") {
            setLeftPane(p => ({ ...p, cursorPosition: update }));
        } else {
            setRightPane(p => ({ ...p, cursorPosition: update }));
        }
    }, []);

    // ======== Keyboard Shortcuts ========

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        // Tab insertion
        if (e.key === "Tab") {
            e.preventDefault();
            const textarea = e.target as HTMLTextAreaElement;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const value = textarea.value;

            textarea.value = value.substring(0, start) + "  " + value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 2;
        }

        // Toggle active pane
        if (e.key === "Escape") {
            setActivePane(p => p === "left" ? "right" : "left");
        }
    }, []);

    // ======== Styling ========

    const isDark = theme === "dark";
    const bgColor = isDark ? "bg-gray-900" : "bg-white";
    const textColor = isDark ? "text-gray-100" : "text-gray-900";
    const borderColor = isDark ? "border-gray-700" : "border-gray-300";
    const headerBg = isDark ? "bg-gray-800" : "bg-gray-100";

    return (
        <div
            ref={containerRef}
            className={`flex h-full ${bgColor} ${textColor} ${className}`}
            style={{ userSelect: isDragging ? "none" : "auto" }}
        >
            {/* Left Pane */}
            <div
                className="flex flex-col overflow-hidden"
                style={{ width: `${splitPosition}%` }}
            >
                <PaneHeader
                    title={leftTitle}
                    language={leftLanguage}
                    cursor={leftPane.cursorPosition}
                    isActive={activePane === "left"}
                    isDark={isDark}
                />
                <textarea
                    ref={leftEditorRef}
                    value={leftPane.content}
                    onChange={handleLeftChange}
                    onScroll={(e) => handleScroll("left", e.currentTarget.scrollTop)}
                    onClick={() => setActivePane("left")}
                    onKeyUp={(e) => updateCursorPosition(e.currentTarget, "left")}
                    onKeyDown={handleKeyDown}
                    className={`flex-1 resize-none outline-none p-4 font-mono text-sm ${bgColor} ${activePane === "left" ? "ring-2 ring-blue-500" : ""
                        }`}
                    spellCheck={false}
                    style={{ tabSize: 2 }}
                />
            </div>

            {/* Resize Handle */}
            <div
                className={`w-1 cursor-col-resize ${isDark ? "bg-gray-700 hover:bg-blue-500" : "bg-gray-300 hover:bg-blue-400"} transition-colors`}
                onMouseDown={handleMouseDown}
            />

            {/* Right Pane */}
            <div
                className="flex flex-col overflow-hidden"
                style={{ width: `${100 - splitPosition}%` }}
            >
                <PaneHeader
                    title={rightTitle}
                    language={rightLanguage}
                    cursor={rightPane.cursorPosition}
                    isActive={activePane === "right"}
                    isDark={isDark}
                />
                <textarea
                    ref={rightEditorRef}
                    value={rightPane.content}
                    onChange={handleRightChange}
                    onScroll={(e) => handleScroll("right", e.currentTarget.scrollTop)}
                    onClick={() => setActivePane("right")}
                    onKeyUp={(e) => updateCursorPosition(e.currentTarget, "right")}
                    onKeyDown={handleKeyDown}
                    className={`flex-1 resize-none outline-none p-4 font-mono text-sm ${bgColor} ${activePane === "right" ? "ring-2 ring-blue-500" : ""
                        }`}
                    spellCheck={false}
                    style={{ tabSize: 2 }}
                />
            </div>
        </div>
    );
}

// ======== Sub-components ========

interface PaneHeaderProps {
    title: string;
    language: string;
    cursor: { line: number; column: number };
    isActive: boolean;
    isDark: boolean;
}

function PaneHeader({ title, language, cursor, isActive, isDark }: PaneHeaderProps) {
    return (
        <div className={`flex items-center justify-between px-3 py-2 border-b ${isDark ? "bg-gray-800 border-gray-700" : "bg-gray-100 border-gray-200"
            }`}>
            <div className="flex items-center gap-2">
                <span className={`font-medium ${isActive ? "text-blue-400" : ""}`}>
                    {title}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded ${isDark ? "bg-gray-700" : "bg-gray-200"
                    }`}>
                    {language}
                </span>
            </div>
            <span className="text-xs text-gray-500">
                Ln {cursor.line}, Col {cursor.column}
            </span>
        </div>
    );
}

// ============== Diff View ========

export function DiffSplitEditor({
    original,
    modified,
    ...props
}: Omit<SplitEditorProps, 'leftContent' | 'rightContent'> & {
    original: string;
    modified: string;
}) {
    return (
        <SplitEditor
            leftContent={original}
            rightContent={modified}
            leftTitle="Original"
            rightTitle="Modified"
            syncScroll={true}
            {...props}
        />
    );
}

export default SplitEditor;
