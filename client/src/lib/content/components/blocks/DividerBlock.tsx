/**
 * DividerBlock Component
 * 
 * Renders horizontal dividers with variants.
 */

import React from 'react';
import type { DividerBlock as DividerBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';

interface Props {
    block: DividerBlockType;
    context: RenderContext;
}

export default function DividerBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const { variant = 'thin', spacing = 'md' } = block;

    const height = theme.blocks.divider.height[variant === 'thick' ? 'thick' : 'thin'];
    const margin = theme.blocks.divider.margin[spacing];

    const borderStyle = variant === 'dashed' ? 'dashed' : variant === 'dotted' ? 'dotted' : 'solid';

    return (
        <hr
            className="border-0"
            style={{
                height: variant === 'dashed' || variant === 'dotted' ? 0 : height,
                borderTop: variant === 'dashed' || variant === 'dotted'
                    ? `${height}px ${borderStyle} ${theme.blocks.divider.color}`
                    : 'none',
                backgroundColor: variant === 'dashed' || variant === 'dotted'
                    ? 'transparent'
                    : theme.blocks.divider.color,
                marginTop: margin,
                marginBottom: margin,
            }}
        />
    );
}
