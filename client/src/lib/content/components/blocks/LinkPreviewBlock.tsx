/**
 * LinkPreviewBlock Component
 * 
 * Renders rich link previews with OG data.
 */

import React from 'react';
import type { LinkPreviewBlock as LinkPreviewBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';
import { ExternalLink, Globe } from 'lucide-react';

interface Props {
    block: LinkPreviewBlockType;
    context: RenderContext;
}

export default function LinkPreviewBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const { url, title, description, image, siteName, favicon } = block;

    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="my-4 flex gap-4 rounded-lg border overflow-hidden hover:bg-muted/30 transition-colors group"
            style={{ borderColor: theme.colors.border }}
        >
            {image && (
                <div className="w-32 h-24 flex-shrink-0 overflow-hidden">
                    <img
                        src={image}
                        alt={title || ''}
                        className="w-full h-full object-cover"
                    />
                </div>
            )}

            <div className="flex-1 py-3 pr-3 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    {favicon ? (
                        <img src={favicon} alt="" className="w-4 h-4" />
                    ) : (
                        <Globe size={14} style={{ color: theme.colors.mutedForeground }} />
                    )}
                    <span
                        className="text-xs"
                        style={{ color: theme.colors.mutedForeground }}
                    >
                        {siteName || new URL(url).hostname}
                    </span>
                </div>

                {title && (
                    <p
                        className="font-medium line-clamp-1 group-hover:underline"
                        style={{ color: theme.colors.foreground }}
                    >
                        {title}
                    </p>
                )}

                {description && (
                    <p
                        className="text-sm line-clamp-2 mt-1"
                        style={{ color: theme.colors.mutedForeground }}
                    >
                        {description}
                    </p>
                )}
            </div>

            <div className="flex items-center pr-3">
                <ExternalLink
                    size={16}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: theme.colors.mutedForeground }}
                />
            </div>
        </a>
    );
}
