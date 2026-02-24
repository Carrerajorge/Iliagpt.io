/**
 * TextBlock Component
 * 
 * Renders text content with optional formatting.
 */

import React from 'react';
import type { TextBlock as TextBlockType, ParagraphBlock } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';

interface Props {
    block: TextBlockType | ParagraphBlock;
    context: RenderContext;
}

export default function TextBlock({ block, context }: Props) {
    const theme = useContentTheme();

    if (block.type === 'paragraph' && 'children' in block) {
        return (
            <p
                className="mb-4 leading-relaxed"
                style={{
                    fontSize: theme.typography.fontSize.base,
                    lineHeight: theme.typography.lineHeight.relaxed,
                    color: theme.colors.foreground,
                    textAlign: block.align || 'left',
                }}
            >
                {block.children.map((child, i) => (
                    <InlineContent key={i} node={child} theme={theme} />
                ))}
            </p>
        );
    }

    // Simple text block
    const textBlock = block as TextBlockType;
    const { value, format } = textBlock;

    let content: React.ReactNode = value;

    // Apply formatting
    if (format?.bold) content = <strong>{content}</strong>;
    if (format?.italic) content = <em>{content}</em>;
    if (format?.underline) content = <u>{content}</u>;
    if (format?.strikethrough) content = <s>{content}</s>;
    if (format?.code) {
        content = (
            <code
                className="px-1.5 py-0.5 rounded text-sm"
                style={{
                    backgroundColor: theme.colors.muted,
                    fontFamily: theme.typography.fontMono,
                }}
            >
                {content}
            </code>
        );
    }
    if (format?.link) {
        content = (
            <a
                href={format.link}
                className="text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
            >
                {content}
            </a>
        );
    }
    if (format?.highlight) {
        content = (
            <mark style={{ backgroundColor: format.highlight, padding: '0 2px' }}>
                {content}
            </mark>
        );
    }

    return (
        <span
            className="inline"
            style={{ color: theme.colors.foreground }}
        >
            {content}
        </span>
    );
}

function InlineContent({ node, theme }: { node: any; theme: any }) {
    if (node.type === 'text') {
        return <TextBlock block={node} context={{} as RenderContext} />;
    }
    if (node.type === 'link') {
        return (
            <a
                href={node.href}
                className="text-primary hover:underline"
                title={node.title}
                target={node.target || '_blank'}
                rel="noopener noreferrer"
            >
                {node.text}
            </a>
        );
    }
    if (node.type === 'mention') {
        return (
            <span className="text-primary font-medium">
                @{node.displayName}
            </span>
        );
    }
    if (node.type === 'emoji') {
        return <span role="img">{node.emoji}</span>;
    }
    return null;
}
