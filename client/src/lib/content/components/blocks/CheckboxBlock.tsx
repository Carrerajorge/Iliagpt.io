/**
 * CheckboxBlock Component
 * 
 * Renders interactive checkboxes.
 */

import React from 'react';
import type { CheckboxBlock as CheckboxBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme, useRenderContext } from '../../renderers/block-renderer';
import { Check, Square } from 'lucide-react';

interface Props {
    block: CheckboxBlockType;
    context: RenderContext;
}

export default function CheckboxBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const renderContext = useRenderContext();
    const { label, checked, disabled = false } = block;

    const handleChange = () => {
        if (!disabled && renderContext.handlers?.onCheckboxChange) {
            renderContext.handlers.onCheckboxChange(block.id, !checked);
        }
    };

    return (
        <label
            className={`flex items-center gap-2 my-2 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={handleChange}
        >
            <div
                className="w-5 h-5 rounded border flex items-center justify-center transition-colors"
                style={{
                    borderColor: checked ? theme.colors.primary : theme.colors.border,
                    backgroundColor: checked ? theme.colors.primary : 'transparent',
                }}
            >
                {checked && <Check size={14} className="text-white" />}
            </div>
            <span
                className={checked ? 'line-through' : ''}
                style={{
                    color: checked ? theme.colors.mutedForeground : theme.colors.foreground
                }}
            >
                {label}
            </span>
        </label>
    );
}
