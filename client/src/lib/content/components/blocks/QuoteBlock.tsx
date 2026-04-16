/**
 * QuoteBlock Component
 * 
 * Renders blockquotes with optional author.
 */

import React from 'react';
import type { QuoteBlock as QuoteBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';
import { renderBlocks } from '../../renderers/registry';
import { Quote } from 'lucide-react';

interface Props {
    block: QuoteBlockType;
    context: RenderContext;
}

export default function QuoteBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const { children, author, citation } = block;

    return (
        <blockquote
            className="my-4 relative"
            style={{
                borderLeftWidth: theme.blocks.quote.borderLeft.width,
                borderLeftColor: theme.blocks.quote.borderLeft.color,
                borderLeftStyle: 'solid',
                backgroundColor: theme.blocks.quote.background,
                paddingLeft: theme.blocks.quote.padding.x,
                paddingRight: theme.blocks.quote.padding.x,
                paddingTop: theme.blocks.quote.padding.y,
                paddingBottom: theme.blocks.quote.padding.y,
                borderRadius: theme.borderRadius.md,
                fontStyle: theme.blocks.quote.fontStyle,
            }}
        >
            <Quote
                className="absolute top-2 right-2 opacity-10"
                size={24}
                style={{ color: theme.colors.foreground }}
            />

            <div style={{ color: theme.colors.foreground }}>
                {renderBlocks(children, context)}
            </div>

            {(author || citation) && (
                <footer
                    className="mt-2 text-sm"
                    style={{ color: theme.colors.mutedForeground }}
                >
                    {author && <cite className="font-medium not-italic">— {author}</cite>}
                    {citation && <span className="ml-1">({citation})</span>}
                </footer>
            )}
        </blockquote>
    );
}
