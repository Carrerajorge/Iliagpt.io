/**
 * CollapseBlock Component
 * 
 * Renders collapsible content sections.
 */

import React, { useState } from 'react';
import type { CollapseBlock as CollapseBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';
import { renderBlocks } from '../../renderers/registry';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
    block: CollapseBlockType;
    context: RenderContext;
}

export default function CollapseBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const { title, children, defaultOpen = false } = block;
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div
            className="my-4 rounded-lg border overflow-hidden"
            style={{ borderColor: theme.colors.border }}
        >
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
                style={{ backgroundColor: open ? theme.colors.muted : 'transparent' }}
            >
                {open ? (
                    <ChevronDown size={18} style={{ color: theme.colors.mutedForeground }} />
                ) : (
                    <ChevronRight size={18} style={{ color: theme.colors.mutedForeground }} />
                )}
                <span
                    className="font-medium"
                    style={{ color: theme.colors.foreground }}
                >
                    {title}
                </span>
            </button>

            {open && (
                <div
                    className="p-4 border-t"
                    style={{ borderColor: theme.colors.border }}
                >
                    {renderBlocks(children, context)}
                </div>
            )}
        </div>
    );
}
