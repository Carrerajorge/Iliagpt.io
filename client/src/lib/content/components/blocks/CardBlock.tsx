/**
 * CardBlock Component
 * 
 * Renders card with image, title, description, and actions.
 */

import React from 'react';
import type { CardBlock as CardBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme, useRenderContext } from '../../renderers/block-renderer';

interface Props {
    block: CardBlockType;
    context: RenderContext;
}

export default function CardBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const renderContext = useRenderContext();
    const { title, subtitle, description, image, actions, variant = 'default' } = block;

    const cardStyles: React.CSSProperties = {
        backgroundColor: theme.blocks.card.background,
        borderRadius: theme.blocks.card.borderRadius,
        overflow: 'hidden',
        transition: `box-shadow ${theme.animations.duration.normal}`,
    };

    if (variant === 'elevated') {
        cardStyles.boxShadow = theme.blocks.card.shadow;
    } else if (variant === 'outlined') {
        cardStyles.border = `1px solid ${theme.blocks.card.border}`;
    } else {
        cardStyles.border = `1px solid ${theme.blocks.card.border}`;
        cardStyles.boxShadow = theme.shadows.sm;
    }

    const handleAction = (action: string) => {
        renderContext.handlers?.onButtonAction?.(action, block.id);
    };

    return (
        <div
            className="my-4 hover:shadow-md transition-shadow"
            style={cardStyles}
        >
            {image && (
                <div className="aspect-video overflow-hidden">
                    <img
                        src={image}
                        alt={title || ''}
                        className="w-full h-full object-cover"
                    />
                </div>
            )}

            <div style={{ padding: theme.blocks.card.padding }}>
                {title && (
                    <h3
                        className="font-semibold text-lg"
                        style={{ color: theme.colors.foreground }}
                    >
                        {title}
                    </h3>
                )}

                {subtitle && (
                    <p
                        className="text-sm mt-1"
                        style={{ color: theme.colors.mutedForeground }}
                    >
                        {subtitle}
                    </p>
                )}

                {description && (
                    <p
                        className="mt-2"
                        style={{ color: theme.colors.foreground }}
                    >
                        {description}
                    </p>
                )}

                {actions && actions.length > 0 && (
                    <div className="flex gap-2 mt-4">
                        {actions.map((action, i) => (
                            <button
                                key={i}
                                onClick={() => handleAction(action.action)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${action.variant === 'primary'
                                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                        : action.variant === 'ghost'
                                            ? 'hover:bg-muted'
                                            : 'bg-muted hover:bg-muted/80'
                                    }`}
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
