import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ContentBlock } from "./types";
import { parseContentToBlocks } from "./utils";

export interface TextSelection {
    text: string;
    startIndex: number;
    endIndex: number;
}

export function EditableDocumentPreview({
    content,
    onChange,
    onSelectionChange
}: {
    content: string;
    onChange: (newContent: string) => void;
    onSelectionChange?: (selection: TextSelection | null) => void;
}) {
    const [blocks, setBlocks] = useState<ContentBlock[]>(() => parseContentToBlocks(content));
    const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
    const [editingText, setEditingText] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        setBlocks(parseContentToBlocks(content));
    }, [content]);

    useEffect(() => {
        if (editingBlockId !== null && textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.select();
        }
    }, [editingBlockId]);

    const handleTextSelection = () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) {
            return;
        }

        const selectedText = selection.toString();
        if (!selectedText.trim()) {
            return;
        }

        const startIndex = content.indexOf(selectedText);
        if (startIndex === -1) {
            const normalizedContent = content.replace(/\s+/g, ' ');
            const normalizedSelection = selectedText.replace(/\s+/g, ' ');
            const normalizedStart = normalizedContent.indexOf(normalizedSelection);

            if (normalizedStart !== -1) {
                let charCount = 0;
                let realStart = 0;
                for (let i = 0; i < content.length && charCount < normalizedStart; i++) {
                    if (!/\s/.test(content[i]) || (i > 0 && !/\s/.test(content[i - 1]))) {
                        charCount++;
                    }
                    realStart = i + 1;
                }

                onSelectionChange?.({
                    text: selectedText,
                    startIndex: realStart,
                    endIndex: realStart + selectedText.length
                });
            }
            return;
        }

        onSelectionChange?.({
            text: selectedText,
            startIndex,
            endIndex: startIndex + selectedText.length
        });
    };

    const handleBlockClick = (block: ContentBlock) => {
        setEditingBlockId(block.id);
        setEditingText(block.raw);
    };

    const handleSaveBlock = () => {
        if (editingBlockId === null) return;

        const newBlocks = blocks.map(b =>
            b.id === editingBlockId
                ? { ...b, raw: editingText, content: editingText.trim() }
                : b
        );
        setBlocks(newBlocks);

        const newContent = newBlocks.map(b => b.raw).join('\n\n');
        onChange(newContent);
        setEditingBlockId(null);
        setEditingText("");
    };

    const renderInlineFormatting = (text: string) => {
        const parts: React.ReactNode[] = [];
        let remaining = text;
        let key = 0;

        while (remaining.length > 0) {
            const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
            const italicMatch = remaining.match(/\*(.+?)\*/);

            if (boldMatch && boldMatch.index !== undefined) {
                if (boldMatch.index > 0) {
                    parts.push(<span key={key++}>{remaining.slice(0, boldMatch.index)}</span>);
                }
                parts.push(<strong key={key++} className="font-bold">{boldMatch[1]}</strong>);
                remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
            } else if (italicMatch && italicMatch.index !== undefined && !remaining.startsWith('**')) {
                if (italicMatch.index > 0) {
                    parts.push(<span key={key++}>{remaining.slice(0, italicMatch.index)}</span>);
                }
                parts.push(<em key={key++} className="italic">{italicMatch[1]}</em>);
                remaining = remaining.slice(italicMatch.index + italicMatch[0].length);
            } else {
                parts.push(<span key={key++}>{remaining}</span>);
                break;
            }
        }

        return parts;
    };

    const renderBlock = (block: ContentBlock) => {
        const isEditing = editingBlockId === block.id;

        if (isEditing) {
            return (
                <div key={block.id} className="relative">
                    <textarea
                        ref={textareaRef}
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onBlur={handleSaveBlock}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                                setEditingBlockId(null);
                                setEditingText("");
                            }
                        }}
                        className="w-full p-3 border-2 border-blue-500 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-sm font-mono resize-none focus:outline-none"
                        style={{ minHeight: Math.max(60, editingText.split('\n').length * 24) }}
                        data-testid={`textarea-block-${block.id}`}
                    />
                    <div className="absolute -top-6 left-0 text-xs text-blue-600 bg-blue-100 dark:bg-blue-900 px-2 py-0.5 rounded">
                        Editando - Click afuera para guardar
                    </div>
                </div>
            );
        }

        const baseClass = "cursor-pointer transition-all duration-200 hover:bg-teal-50 dark:hover:bg-teal-900/20 rounded px-2 py-1 -mx-2 border border-transparent hover:border-teal-200 dark:hover:border-teal-800";

        switch (block.type) {
            case 'heading1':
                return (
                    <h1
                        key={block.id}
                        onClick={() => handleBlockClick(block)}
                        className={cn("text-4xl font-bold mb-6 mt-2 text-primary hover:text-primary/90", baseClass)}
                        style={{ fontFamily: 'Georgia, serif' }}
                    >
                        {block.content.replace(/^# /, '')}
                    </h1>
                );
            case 'heading2':
                return (
                    <h2
                        key={block.id}
                        onClick={() => handleBlockClick(block)}
                        className={cn("text-2xl font-bold mb-3 mt-6 text-foreground", baseClass)}
                    >
                        {block.content.replace(/^## /, '')}
                    </h2>
                );
            case 'heading3':
                return (
                    <h3
                        key={block.id}
                        onClick={() => handleBlockClick(block)}
                        className={cn("text-lg font-bold mb-2 mt-4 text-foreground", baseClass)}
                    >
                        {block.content.replace(/^### /, '')}
                    </h3>
                );
            case 'paragraph':
                return (
                    <p
                        key={block.id}
                        onClick={() => handleBlockClick(block)}
                        className={cn("mb-3 leading-relaxed text-muted-foreground text-sm", baseClass)}
                    >
                        {renderInlineFormatting(block.content)}
                    </p>
                );
            case 'list':
                return (
                    <ul
                        key={block.id}
                        onClick={() => handleBlockClick(block)}
                        className={cn("list-disc list-inside mb-4 space-y-1", baseClass)}
                    >
                        {block.content.split('\n').map((item, idx) => (
                            <li key={idx} className="text-foreground">
                                {renderInlineFormatting(item.replace(/^[-*] /, ''))}
                            </li>
                        ))}
                    </ul>
                );
            case 'numberedList':
                return (
                    <ol
                        key={block.id}
                        onClick={() => handleBlockClick(block)}
                        className={cn("list-decimal list-inside mb-4 space-y-1", baseClass)}
                    >
                        {block.content.split('\n').map((item, idx) => (
                            <li key={idx} className="text-foreground">
                                {renderInlineFormatting(item.replace(/^\d+\. /, ''))}
                            </li>
                        ))}
                    </ol>
                );
            case 'blockquote':
                return (
                    <blockquote
                        key={block.id}
                        onClick={() => handleBlockClick(block)}
                        className={cn("border-l-4 border-blue-500 pl-4 italic my-4 py-2 bg-muted", baseClass)}
                    >
                        {block.content.split('\n').map((line, idx) => (
                            <p key={idx} className="text-muted-foreground">
                                {renderInlineFormatting(line.replace(/^> /, ''))}
                            </p>
                        ))}
                    </blockquote>
                );
            case 'hr':
                return <hr key={block.id} className="my-6 border-border" />;
            default:
                return null;
        }
    };

    return (
        <div
            className="space-y-1 p-4"
            onMouseUp={handleTextSelection}
            onKeyUp={handleTextSelection}
            data-testid="editable-document-preview"
        >
            {blocks.map(renderBlock)}
        </div>
    );
}
