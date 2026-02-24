/**
 * ButtonBlock Component
 * 
 * Renders interactive buttons.
 */

import React from 'react';
import type { ButtonBlock as ButtonBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme, useRenderContext } from '../../renderers/block-renderer';
import { Loader2, ExternalLink, Copy, Download } from 'lucide-react';

interface Props {
    block: ButtonBlockType;
    context: RenderContext;
}

export default function ButtonBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const renderContext = useRenderContext();
    const {
        label, action, actionType, variant = 'primary',
        size = 'md', icon, iconPosition = 'left',
        disabled = false, loading = false
    } = block;

    const sizeConfig = theme.blocks.button.sizes[size];

    const handleClick = async () => {
        if (disabled || loading) return;

        switch (actionType) {
            case 'link':
                window.open(action, '_blank', 'noopener,noreferrer');
                break;
            case 'copy':
                await navigator.clipboard.writeText(action);
                break;
            case 'download':
                const link = document.createElement('a');
                link.href = action;
                link.download = '';
                link.click();
                break;
            case 'callback':
                renderContext.handlers?.onButtonAction?.(action, block.id);
                break;
        }
    };

    const getVariantStyles = (): React.CSSProperties => {
        switch (variant) {
            case 'primary':
                return {
                    backgroundColor: theme.colors.primary,
                    color: theme.colors.primaryForeground,
                };
            case 'secondary':
                return {
                    backgroundColor: theme.colors.secondary,
                    color: theme.colors.secondaryForeground,
                };
            case 'outline':
                return {
                    backgroundColor: 'transparent',
                    border: `1px solid ${theme.colors.border}`,
                    color: theme.colors.foreground,
                };
            case 'ghost':
                return {
                    backgroundColor: 'transparent',
                    color: theme.colors.foreground,
                };
            case 'destructive':
                return {
                    backgroundColor: theme.colors.destructive,
                    color: theme.colors.destructiveForeground,
                };
            default:
                return {};
        }
    };

    const ActionIcon = actionType === 'link' ? ExternalLink :
        actionType === 'copy' ? Copy :
            actionType === 'download' ? Download : null;

    return (
        <button
            onClick={handleClick}
            disabled={disabled || loading}
            className={`inline-flex items-center justify-center gap-2 font-medium transition-all
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}
        ${variant === 'ghost' ? 'hover:bg-muted' : ''}
      `}
            style={{
                height: sizeConfig.height,
                paddingLeft: sizeConfig.padding,
                paddingRight: sizeConfig.padding,
                fontSize: sizeConfig.fontSize,
                borderRadius: theme.blocks.button.borderRadius,
                ...getVariantStyles(),
            }}
        >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {!loading && iconPosition === 'left' && ActionIcon && <ActionIcon size={16} />}
            {label}
            {!loading && iconPosition === 'right' && ActionIcon && <ActionIcon size={16} />}
        </button>
    );
}
