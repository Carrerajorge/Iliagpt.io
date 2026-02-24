/**
 * Callout Block Pro
 * 
 * GitHub-style callouts with animations and icons.
 */

import React, { useState, useRef, useEffect } from 'react';
import type { CalloutBlock as CalloutBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';
import { renderBlocks } from '../../renderers/registry';
import {
    Info, AlertTriangle, XCircle, CheckCircle,
    Lightbulb, FileText, ChevronDown, ChevronRight,
    Sparkles, AlertCircle, Bell
} from 'lucide-react';

interface Props {
    block: CalloutBlockType;
    context: RenderContext;
}

const VARIANT_CONFIG = {
    info: {
        icon: Info,
        gradient: 'from-blue-500/20 to-blue-600/10',
        border: 'border-l-blue-500',
        iconColor: 'text-blue-500',
        bgLight: 'bg-blue-50',
        bgDark: 'bg-blue-500/10',
        title: 'Información',
    },
    warning: {
        icon: AlertTriangle,
        gradient: 'from-amber-500/20 to-amber-600/10',
        border: 'border-l-amber-500',
        iconColor: 'text-amber-500',
        bgLight: 'bg-amber-50',
        bgDark: 'bg-amber-500/10',
        title: 'Advertencia',
    },
    error: {
        icon: XCircle,
        gradient: 'from-red-500/20 to-red-600/10',
        border: 'border-l-red-500',
        iconColor: 'text-red-500',
        bgLight: 'bg-red-50',
        bgDark: 'bg-red-500/10',
        title: 'Error',
    },
    success: {
        icon: CheckCircle,
        gradient: 'from-green-500/20 to-green-600/10',
        border: 'border-l-green-500',
        iconColor: 'text-green-500',
        bgLight: 'bg-green-50',
        bgDark: 'bg-green-500/10',
        title: 'Éxito',
    },
    tip: {
        icon: Lightbulb,
        gradient: 'from-purple-500/20 to-purple-600/10',
        border: 'border-l-purple-500',
        iconColor: 'text-purple-500',
        bgLight: 'bg-purple-50',
        bgDark: 'bg-purple-500/10',
        title: 'Consejo',
    },
    note: {
        icon: FileText,
        gradient: 'from-gray-500/20 to-gray-600/10',
        border: 'border-l-gray-500',
        iconColor: 'text-gray-500',
        bgLight: 'bg-gray-50',
        bgDark: 'bg-gray-500/10',
        title: 'Nota',
    },
};

export default function CalloutBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const { variant, title, children, collapsible = false } = block;
    const [collapsed, setCollapsed] = useState(false);
    const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
    const contentRef = useRef<HTMLDivElement>(null);

    const config = VARIANT_CONFIG[variant];
    const Icon = config.icon;
    const isDark = theme.mode === 'dark';

    useEffect(() => {
        if (contentRef.current) {
            setContentHeight(contentRef.current.scrollHeight);
        }
    }, [children]);

    return (
        <div
            className={`
        my-5 rounded-xl overflow-hidden border-l-4
        ${config.border}
        ${isDark ? config.bgDark : config.bgLight}
        transition-all duration-300 ease-out
      `}
            style={{
                boxShadow: isDark
                    ? '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
                    : '0 1px 3px rgba(0, 0, 0, 0.1)',
            }}
        >
            {/* Header */}
            <div
                className={`
          flex items-center gap-3 px-5 py-4
          ${collapsible ? 'cursor-pointer hover:bg-white/5' : ''}
          transition-colors
        `}
                onClick={collapsible ? () => setCollapsed(!collapsed) : undefined}
            >
                {collapsible && (
                    <span className="transition-transform duration-200" style={{
                        transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                    }}>
                        <ChevronRight size={16} className={config.iconColor} />
                    </span>
                )}

                <div className={`p-2 rounded-lg ${isDark ? 'bg-white/10' : 'bg-white/50'}`}>
                    <Icon size={20} className={config.iconColor} />
                </div>

                <span
                    className="font-semibold"
                    style={{ color: theme.colors.foreground }}
                >
                    {title || config.title}
                </span>
            </div>

            {/* Content with animation */}
            <div
                ref={contentRef}
                className="overflow-hidden transition-all duration-300 ease-out"
                style={{
                    maxHeight: collapsed ? 0 : contentHeight,
                    opacity: collapsed ? 0 : 1,
                }}
            >
                <div
                    className="px-5 pb-4 pl-16"
                    style={{ color: theme.colors.foreground }}
                >
                    {renderBlocks(children, context)}
                </div>
            </div>
        </div>
    );
}
