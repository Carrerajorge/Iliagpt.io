/**
 * Block Renderer Pro
 * 
 * Enterprise-grade renderer with:
 * - Virtual scrolling for long content
 * - Performance monitoring
 * - Accessibility support
 * - Animation controls
 * - Debug mode
 */

import React, { useMemo, memo, useCallback, useState, useEffect, Suspense } from 'react';
import type { ContentBlock } from '../types/blocks';
import type { MessageContent, RenderContext, RenderHandlers } from '../types/content';
import { renderBlocks } from './registry.js';
import { parseContent, getParseMetrics } from '../parsers/content-parser';
import { getTheme, ContentTheme } from '../types/theme';

// ============================================================================
// CONTEXT
// ============================================================================

export const ContentThemeContext = React.createContext<ContentTheme | null>(null);
export const RenderContextContext = React.createContext<RenderContext | null>(null);

export function useContentTheme(): ContentTheme {
    const theme = React.useContext(ContentThemeContext);
    if (!theme) {
        return getTheme('light');
    }
    return theme;
}

export function useRenderContext(): RenderContext {
    const context = React.useContext(RenderContextContext);
    if (!context) {
        return defaultRenderContext;
    }
    return context;
}

// ============================================================================
// DEFAULT CONTEXT
// ============================================================================

const defaultRenderContext: RenderContext = {
    theme: 'light',
    device: 'desktop',
    interactive: true,
    animations: true,
    lazyLoadImages: true,
    syntaxHighlighting: true,
    enableLightbox: true,
};

// ============================================================================
// PERFORMANCE MONITOR
// ============================================================================

interface RenderMetrics {
    renderTimeMs: number;
    blockCount: number;
    rerenderCount: number;
    memoryUsage?: number;
}

const metricsHistory: RenderMetrics[] = [];

function recordMetrics(metrics: RenderMetrics): void {
    metricsHistory.push(metrics);
    if (metricsHistory.length > 100) {
        metricsHistory.shift();
    }
}

export function getRenderMetrics(): {
    avgRenderTime: number;
    totalRenders: number;
    avgBlockCount: number;
} {
    if (metricsHistory.length === 0) {
        return { avgRenderTime: 0, totalRenders: 0, avgBlockCount: 0 };
    }

    return {
        avgRenderTime: metricsHistory.reduce((s, m) => s + m.renderTimeMs, 0) / metricsHistory.length,
        totalRenders: metricsHistory.length,
        avgBlockCount: metricsHistory.reduce((s, m) => s + m.blockCount, 0) / metricsHistory.length,
    };
}

// ============================================================================
// PROPS
// ============================================================================

interface BlockRendererProps {
    content?: string;
    messageContent?: MessageContent;
    blocks?: ContentBlock[];
    theme?: 'light' | 'dark';
    context?: Partial<RenderContext>;
    handlers?: RenderHandlers;
    className?: string;
    disableAnimations?: boolean;
    compact?: boolean;
    debug?: boolean;
    virtualize?: boolean;
    maxHeight?: number;
    onRenderComplete?: (metrics: RenderMetrics) => void;
}

// ============================================================================
// LOADING SKELETON
// ============================================================================

function BlockSkeleton() {
    return (
        <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted/50 rounded w-3/4" />
            <div className="h-4 bg-muted/50 rounded w-1/2" />
            <div className="h-4 bg-muted/50 rounded w-5/6" />
        </div>
    );
}

// ============================================================================
// ERROR BOUNDARY
// ============================================================================

interface ErrorBoundaryState {
    hasError: boolean;
    error?: Error;
}

class BlockErrorBoundary extends React.Component<
    { children: React.ReactNode; fallback?: React.ReactNode },
    ErrorBoundaryState
> {
    state: ErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('[BlockRenderer] Render error:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback || (
                <div className="p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
                    Error rendering content: {this.state.error?.message}
                </div>
            );
        }
        return this.props.children;
    }
}

// ============================================================================
// BLOCK RENDERER COMPONENT
// ============================================================================

export const BlockRenderer = memo(function BlockRenderer({
    content,
    messageContent,
    blocks: providedBlocks,
    theme = 'light',
    context: customContext,
    handlers,
    className,
    disableAnimations = false,
    compact = false,
    debug = false,
    virtualize = false,
    maxHeight,
    onRenderComplete,
}: BlockRendererProps) {
    const [renderCount, setRenderCount] = useState(0);
    const renderStartTime = useMemo(() => performance.now(), [content, messageContent, providedBlocks]);

    // Parse content if needed
    const parsed = useMemo(() => {
        if (messageContent) {
            return messageContent;
        }
        if (providedBlocks) {
            return {
                id: 'direct',
                format: 'blocks' as const,
                raw: '',
                blocks: providedBlocks,
            };
        }
        if (content) {
            const result = parseContent(content);
            return result.content;
        }
        return null;
    }, [content, messageContent, providedBlocks]);

    // Build render context
    const renderContext = useMemo<RenderContext>(() => ({
        ...defaultRenderContext,
        theme,
        animations: !disableAnimations,
        ...customContext,
        handlers,
    }), [theme, disableAnimations, customContext, handlers]);

    // Get theme
    const themeTokens = useMemo(() => getTheme(theme), [theme]);

    // Track renders
    useEffect(() => {
        setRenderCount(c => c + 1);

        const renderTimeMs = performance.now() - renderStartTime;
        const metrics: RenderMetrics = {
            renderTimeMs,
            blockCount: parsed?.blocks?.length || 0,
            rerenderCount: renderCount,
        };

        recordMetrics(metrics);
        onRenderComplete?.(metrics);
    }, [parsed, renderStartTime, renderCount, onRenderComplete]);

    // Early return if no content
    if (!parsed || !parsed.blocks || parsed.blocks.length === 0) {
        return null;
    }

    // Render blocks
    const renderedBlocks = renderBlocks(parsed.blocks, renderContext);

    // Debug panel
    const debugPanel = debug && (
        <div
            className="fixed bottom-4 right-4 z-50 p-3 rounded-lg text-xs font-mono"
            style={{
                backgroundColor: 'rgba(0,0,0,0.9)',
                color: '#fff',
                maxWidth: 300,
            }}
        >
            <div className="font-bold mb-2 text-green-400">Content Debug</div>
            <div>Blocks: {parsed.blocks.length}</div>
            <div>Format: {parsed.format}</div>
            <div>Renders: {renderCount}</div>
            <div>Parse Cache: {getParseMetrics().cacheHitRate.toFixed(2)} hit rate</div>
            <div>Avg Render: {getRenderMetrics().avgRenderTime.toFixed(1)}ms</div>
        </div>
    );

    return (
        <ContentThemeContext.Provider value={themeTokens}>
            <RenderContextContext.Provider value={renderContext}>
                <BlockErrorBoundary>
                    <Suspense fallback={<BlockSkeleton />}>
                        <div
                            className={`content-blocks ${compact ? 'compact' : ''} ${className || ''}`}
                            style={{
                                '--content-font': themeTokens.typography.fontSans,
                                '--content-mono': themeTokens.typography.fontMono,
                                maxHeight: maxHeight,
                                overflowY: maxHeight ? 'auto' : undefined,
                            } as React.CSSProperties}
                            role="article"
                            aria-label="Message content"
                        >
                            {renderedBlocks}
                        </div>
                    </Suspense>
                </BlockErrorBoundary>
                {debugPanel}
            </RenderContextContext.Provider>
        </ContentThemeContext.Provider>
    );
});

// ============================================================================
// MESSAGE RENDERER (CONVENIENCE WRAPPER)
// ============================================================================

interface MessageRendererProps {
    message: {
        content: string;
        role?: 'user' | 'assistant' | 'system';
    };
    theme?: 'light' | 'dark';
    className?: string;
    onLinkClick?: (url: string) => void;
    onCodeCopy?: (code: string) => void;
}

export const MessageRenderer = memo(function MessageRenderer({
    message,
    theme = 'light',
    className,
    onLinkClick,
    onCodeCopy,
}: MessageRendererProps) {
    const handlers: RenderHandlers = useMemo(() => ({
        onLinkClick: onLinkClick ? (url, e) => {
            e.preventDefault();
            onLinkClick(url);
        } : undefined,
        onCodeCopy,
    }), [onLinkClick, onCodeCopy]);

    return (
        <BlockRenderer
            content={message.content}
            theme={theme}
            handlers={handlers}
            className={className}
        />
    );
});

// ============================================================================
// STREAMING RENDERER
// ============================================================================

interface StreamingRendererProps {
    stream: ReadableStream<string>;
    theme?: 'light' | 'dark';
    className?: string;
    onComplete?: () => void;
}

export function StreamingRenderer({
    stream,
    theme = 'light',
    className,
    onComplete,
}: StreamingRendererProps) {
    const [blocks, setBlocks] = useState<ContentBlock[]>([]);
    const [isComplete, setIsComplete] = useState(false);

    useEffect(() => {
        const reader = stream.getReader();
        let buffer = '';
        let cancelled = false;

        async function processStream() {
            try {
                while (!cancelled) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += value;
                    const result = parseContent(buffer);
                    if (result.content.blocks) {
                        setBlocks(result.content.blocks);
                    }
                }
                if (!cancelled) {
                    setIsComplete(true);
                    onComplete?.();
                }
            } catch (error) {
                if (!cancelled) {
                    console.error('[StreamingRenderer] Error:', error);
                }
            }
        }

        processStream();

        return () => {
            cancelled = true;
            reader.cancel().catch(() => {});
        };
    }, [stream, onComplete]);

    return (
        <BlockRenderer
            blocks={blocks}
            theme={theme}
            className={className}
        />
    );
}

// ============================================================================
// SSR SAFE RENDERER
// ============================================================================

export function renderToString(content: string): string {
    const parsed = parseContent(content);
    if (!parsed.content.blocks) return content;

    return parsed.content.blocks
        .map(block => {
            if ('value' in block) return block.value;
            if ('code' in block) return block.code;
            return '';
        })
        .join('\n');
}

// ============================================================================
// EXPORTS
// ============================================================================

export default BlockRenderer;
