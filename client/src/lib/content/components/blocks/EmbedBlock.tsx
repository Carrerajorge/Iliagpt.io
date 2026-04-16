/**
 * EmbedBlock Component
 * 
 * Renders embedded content (YouTube, Twitter, etc.).
 */

import React from 'react';
import type { EmbedBlock as EmbedBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';
import { ExternalLink, Play } from 'lucide-react';

interface Props {
    block: EmbedBlockType;
    context: RenderContext;
}

// FRONTEND FIX #42: Allowlist of safe embed providers and validate URLs
const ALLOWED_EMBED_HOSTS: Record<string, string[]> = {
    'youtube': ['www.youtube.com', 'youtube.com'],
    'vimeo': ['player.vimeo.com', 'vimeo.com'],
    'spotify': ['open.spotify.com'],
    'twitter': ['twitter.com', 'x.com'],
};

const isValidEmbedUrl = (url: string, provider: string): boolean => {
    try {
        const parsed = new URL(url);
        // Block javascript: and data: protocols
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return false;
        }
        const allowedHosts = ALLOWED_EMBED_HOSTS[provider];
        if (allowedHosts && !allowedHosts.some(host => parsed.hostname === host || parsed.hostname.endsWith('.' + host))) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
};

const getEmbedUrl = (provider: string, url: string): string | null => {
    // FRONTEND FIX #43: Validate URL before processing
    if (!isValidEmbedUrl(url, provider)) {
        return null;
    }

    switch (provider) {
        case 'youtube': {
            const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
            return match ? `https://www.youtube.com/embed/${match[1]}` : null;
        }
        case 'vimeo': {
            const match = url.match(/vimeo\.com\/(\d+)/);
            return match ? `https://player.vimeo.com/video/${match[1]}` : null;
        }
        case 'twitter': {
            return null; // Twitter requires API, show link instead
        }
        case 'spotify': {
            return url.replace('open.spotify.com', 'open.spotify.com/embed');
        }
        default:
            return null;
    }
};

export default function EmbedBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const { provider, url, embedUrl, width, height, aspectRatio = '16/9' } = block;

    // FRONTEND FIX #44: Validate embedUrl if provided directly
    const validatedEmbedUrl = embedUrl && isValidEmbedUrl(embedUrl, provider) ? embedUrl : null;
    const finalEmbedUrl = validatedEmbedUrl || getEmbedUrl(provider, url);

    // For Twitter, just show a link card
    if (provider === 'twitter') {
        return (
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="my-4 block p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                style={{ borderColor: theme.colors.border }}
            >
                <div className="flex items-center gap-3">
                    <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: '#1DA1F2' }}
                    >
                        <span className="text-white font-bold">𝕏</span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p
                            className="font-medium"
                            style={{ color: theme.colors.foreground }}
                        >
                            Ver en Twitter
                        </p>
                        <p
                            className="text-sm truncate"
                            style={{ color: theme.colors.mutedForeground }}
                        >
                            {url}
                        </p>
                    </div>
                    <ExternalLink size={18} style={{ color: theme.colors.mutedForeground }} />
                </div>
            </a>
        );
    }

    // FRONTEND FIX #45: Show error state for invalid URLs
    if (!finalEmbedUrl) {
        return (
            <div
                className="my-4 p-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800"
            >
                <p className="text-sm text-red-600 dark:text-red-400">
                    No se puede mostrar este contenido embebido (URL no válida o proveedor no soportado)
                </p>
            </div>
        );
    }

    return (
        <div
            className="my-4 rounded-lg overflow-hidden"
            style={{
                aspectRatio,
                maxWidth: width || '100%',
            }}
        >
            {/* FRONTEND FIX #46: Add sandbox and loading attributes for security */}
            <iframe
                src={finalEmbedUrl}
                width="100%"
                height="100%"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                referrerPolicy="strict-origin-when-cross-origin"
                className="w-full h-full"
                style={{
                    height: height || '100%',
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: theme.borderRadius.lg,
                }}
            />
        </div>
    );
}
