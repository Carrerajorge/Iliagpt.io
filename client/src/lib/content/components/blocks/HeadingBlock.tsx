/**
 * HeadingBlock Component
 * 
 * Renders h1-h6 headings with anchors.
 */

import React, { ElementType } from 'react';
import type { HeadingBlock as HeadingBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';

interface Props {
    block: HeadingBlockType;
    context: RenderContext;
}

export default function HeadingBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const { level, value, anchor } = block;

    const Tag = `h${level}` as ElementType;

    const styles: React.CSSProperties = {
        fontSize: theme.blocks.heading.sizes[`h${level}` as keyof typeof theme.blocks.heading.sizes],
        fontWeight: theme.blocks.heading.weights[`h${level}` as keyof typeof theme.blocks.heading.weights],
        marginTop: theme.blocks.heading.margins[`h${level}` as keyof typeof theme.blocks.heading.margins],
        marginBottom: theme.spacing[3],
        color: theme.colors.foreground,
        lineHeight: theme.typography.lineHeight.tight,
    };

    return (
        <Tag
            id={anchor || undefined}
            className="group scroll-mt-20"
            style={styles}
        >
            {value}
            {anchor && (
                <a
                    href={`#${anchor}`}
                    className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground"
                >
                    #
                </a>
            )}
        </Tag>
    );
}
