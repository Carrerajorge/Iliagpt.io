/**
 * Virtualized Message List Component
 * Renders large message lists efficiently using react-window
 */

import React, { useCallback, useRef, useEffect, useMemo } from 'react';
// @ts-ignore - react-window v2 types
import { VariableSizeList as List } from 'react-window';
// @ts-ignore - types may not exist
import AutoSizer from 'react-virtualized-auto-sizer';

interface ListChildComponentProps {
    index: number;
    style: React.CSSProperties;
}
import { Message } from '@/components/chat-interface/types';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Bot, User, Copy, RotateCcw, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { usePlatformSettings } from '@/contexts/PlatformSettingsContext';
import { formatZonedTime, normalizeTimeZone } from '@/lib/platformDateTime';

interface VirtualizedMessageListProps {
    messages: Message[];
    streamingContent?: string;
    isStreaming?: boolean;
    onEditMessage?: (id: string, content: string) => void;
    onDeleteMessage?: (id: string) => void;
    onRegenerateMessage?: (id: string) => void;
    className?: string;
}

// Minimum and maximum row heights
const MIN_ROW_HEIGHT = 80;
const MAX_ROW_HEIGHT = 2000;
const CHARS_PER_LINE = 80;
const LINE_HEIGHT = 24;
const PADDING = 48;

export function VirtualizedMessageList({
    messages,
    streamingContent = '',
    isStreaming = false,
    onEditMessage,
    onDeleteMessage,
    onRegenerateMessage,
    className,
}: VirtualizedMessageListProps) {
    const listRef = useRef<List>(null);
    const rowHeights = useRef<Map<number, number>>(new Map());
    const { toast } = useToast();
    const { settings: platformSettings } = usePlatformSettings();
    const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);

    // Include streaming message if active
    const displayMessages = useMemo(() => {
        if (isStreaming && streamingContent) {
            return [
                ...messages,
                {
                    id: 'streaming',
                    role: 'assistant' as const,
                    content: streamingContent,
                    timestamp: new Date(),
                    isStreaming: true,
                },
            ];
        }
        return messages;
    }, [messages, streamingContent, isStreaming]);

    // Calculate row height based on content
    const getItemSize = useCallback((index: number): number => {
        const cached = rowHeights.current.get(index);
        if (cached) return cached;

        const message = displayMessages[index];
        if (!message) return MIN_ROW_HEIGHT;

        // Estimate height based on content length
        const lines = Math.ceil(message.content.length / CHARS_PER_LINE);
        const contentHeight = Math.max(lines * LINE_HEIGHT, MIN_ROW_HEIGHT - PADDING);
        const totalHeight = Math.min(contentHeight + PADDING, MAX_ROW_HEIGHT);

        rowHeights.current.set(index, totalHeight);
        return totalHeight;
    }, [displayMessages]);

    // Reset row heights when messages change
    useEffect(() => {
        rowHeights.current.clear();
        listRef.current?.resetAfterIndex(0);
    }, [messages.length]);

    // Scroll to bottom when new messages arrive
    useEffect(() => {
        if (displayMessages.length > 0) {
            listRef.current?.scrollToItem(displayMessages.length - 1, 'end');
        }
    }, [displayMessages.length, streamingContent]);

    // Copy message content
    const handleCopy = useCallback((content: string) => {
        navigator.clipboard.writeText(content);
        toast({ title: 'Copiado al portapapeles' });
    }, [toast]);

    // Data passed to the list items
    const itemData = useMemo(() => ({
        messages: displayMessages,
        onCopy: handleCopy,
        onEditMessage,
        onDeleteMessage,
        onRegenerateMessage,
        platformTimeZone,
    }), [displayMessages, handleCopy, onEditMessage, onDeleteMessage, onRegenerateMessage, platformTimeZone]);

    return (
        <div className={cn("flex-1 h-full", className)}>
            <AutoSizer>
                {({ height, width }: { height: number; width: number }) => (
                    <List
                        ref={listRef}
                        height={height}
                        width={width}
                        itemCount={displayMessages.length}
                        itemSize={getItemSize}
                        itemData={itemData}
                        overscanCount={5}
                        className="scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
                    >
                        {MessageRowItem}
                    </List>
                )}
            </AutoSizer>
        </div>
    );
}

// Extracted and memoized row component
const MessageRowItem = React.memo(({ index, style, data }: { index: number; style: React.CSSProperties; data: any }) => {
    const message = data.messages[index];
    if (!message) return null;

    const { onCopy, onEditMessage, onDeleteMessage, onRegenerateMessage, platformTimeZone } = data;
    const isUser = message.role === 'user';
    const isStreamingMessage = message.id === 'streaming';

    return (
        <div style={style} className="px-4 py-2">
            <div className={cn(
                "flex gap-3 max-w-4xl mx-auto",
                isUser && "flex-row-reverse"
            )}>
                {/* Avatar */}
                <Avatar className="h-8 w-8 flex-shrink-0">
                    {isUser ? (
                        <AvatarFallback className="bg-primary text-primary-foreground">
                            <User className="h-4 w-4" />
                        </AvatarFallback>
                    ) : (
                        <AvatarFallback className="bg-muted">
                            <Bot className="h-4 w-4" />
                        </AvatarFallback>
                    )}
                </Avatar>

                {/* Message Content */}
                <div className={cn(
                    "flex-1 min-w-0 group",
                    isUser && "text-right"
                )}>
                    <div className={cn(
                        "inline-block text-left rounded-2xl px-4 py-2 max-w-full",
                        isUser
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                    )}>
                        {isUser ? (
                            <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        ) : (
                            <div className="prose prose-sm dark:prose-invert max-w-none">
                                <MarkdownRenderer content={message.content} />
                                {isStreamingMessage && (
                                    <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
                                )}
                            </div>
                        )}
                    </div>

                    {/* Message Actions */}
                    {!isStreamingMessage && (
                        <div className={cn(
                            "flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity",
                            isUser ? "justify-end" : "justify-start"
                        )}>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => onCopy(message.content)}
                                aria-label="Copiar mensaje"
                            >
                                <Copy className="h-3 w-3" />
                            </Button>

                            {!isUser && onRegenerateMessage && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => onRegenerateMessage(message.id)}
                                    aria-label="Regenerar respuesta"
                                >
                                    <RotateCcw className="h-3 w-3" />
                                </Button>
                            )}

                            {onEditMessage && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => onEditMessage(message.id, message.content)}
                                    aria-label="Editar mensaje"
                                >
                                    <Pencil className="h-3 w-3" />
                                </Button>
                            )}

                            {onDeleteMessage && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-red-500 hover:text-red-600"
                                    onClick={() => onDeleteMessage(message.id)}
                                    aria-label="Eliminar mensaje"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Timestamp */}
                    <p className={cn(
                        "text-xs text-muted-foreground mt-1",
                        isUser ? "text-right" : "text-left"
                    )}>
                        {formatZonedTime(message.timestamp, { timeZone: platformTimeZone })}
                    </p>
                </div>
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison for performance
    // Only re-render if style (scroll position) changes, 
    // or if the specific message data at this index changes
    const prevMsg = prevProps.data.messages[prevProps.index];
    const nextMsg = nextProps.data.messages[nextProps.index];

    return (
        prevProps.index === nextProps.index &&
        prevProps.style === nextProps.style &&
        prevMsg === nextMsg && // Reference equality check is sufficient if messages array preserves references
        prevProps.data.onCopy === nextProps.data.onCopy // Check handlers didn't change
    );
});
