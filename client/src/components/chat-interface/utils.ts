/**
 * Content Parser Utilities
 * Parse markdown and extract blocks
 */

import React from 'react';
import { ContentBlock } from './types';

/**
 * Parse markdown content into structured blocks
 */
export function parseContentToBlocks(content: string): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    const lines = content.split('\n');
    let currentBlock: ContentBlock | null = null;
    let blockId = 0;

    const flushBlock = () => {
        if (currentBlock && currentBlock.content.trim()) {
            blocks.push(currentBlock);
        }
        currentBlock = null;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Heading detection
        if (line.startsWith('# ')) {
            flushBlock();
            blocks.push({
                id: blockId++,
                type: 'heading1',
                content: line.slice(2),
                raw: line,
            });
            continue;
        }

        if (line.startsWith('## ')) {
            flushBlock();
            blocks.push({
                id: blockId++,
                type: 'heading2',
                content: line.slice(3),
                raw: line,
            });
            continue;
        }

        if (line.startsWith('### ')) {
            flushBlock();
            blocks.push({
                id: blockId++,
                type: 'heading3',
                content: line.slice(4),
                raw: line,
            });
            continue;
        }

        // Horizontal rule
        if (/^---+$/.test(line.trim())) {
            flushBlock();
            blocks.push({
                id: blockId++,
                type: 'hr',
                content: '',
                raw: line,
            });
            continue;
        }

        // Blockquote
        if (line.startsWith('> ')) {
            if (!currentBlock || currentBlock.type !== 'blockquote') {
                flushBlock();
                currentBlock = {
                    id: blockId++,
                    type: 'blockquote',
                    content: line.slice(2),
                    raw: line,
                };
            } else {
                currentBlock.content += '\n' + line.slice(2);
                currentBlock.raw += '\n' + line;
            }
            continue;
        }

        // Unordered list
        if (/^[-*+]\s/.test(line)) {
            if (!currentBlock || currentBlock.type !== 'list') {
                flushBlock();
                currentBlock = {
                    id: blockId++,
                    type: 'list',
                    content: line.slice(2),
                    raw: line,
                };
            } else {
                currentBlock.content += '\n' + line.slice(2);
                currentBlock.raw += '\n' + line;
            }
            continue;
        }

        // Ordered list
        if (/^\d+\.\s/.test(line)) {
            if (!currentBlock || currentBlock.type !== 'numberedList') {
                flushBlock();
                currentBlock = {
                    id: blockId++,
                    type: 'numberedList',
                    content: line.replace(/^\d+\.\s/, ''),
                    raw: line,
                };
            } else {
                currentBlock.content += '\n' + line.replace(/^\d+\.\s/, '');
                currentBlock.raw += '\n' + line;
            }
            continue;
        }

        // Table detection (simple)
        if (line.includes('|') && line.trim().startsWith('|')) {
            if (!currentBlock || currentBlock.type !== 'table') {
                flushBlock();
                currentBlock = {
                    id: blockId++,
                    type: 'table',
                    content: line,
                    raw: line,
                };
            } else {
                currentBlock.content += '\n' + line;
                currentBlock.raw += '\n' + line;
            }
            continue;
        }

        // Regular paragraph
        if (line.trim()) {
            if (!currentBlock || currentBlock.type !== 'paragraph') {
                flushBlock();
                currentBlock = {
                    id: blockId++,
                    type: 'paragraph',
                    content: line,
                    raw: line,
                };
            } else {
                currentBlock.content += ' ' + line;
                currentBlock.raw += '\n' + line;
            }
        } else {
            flushBlock();
        }
    }

    flushBlock();
    return blocks;
}

/**
 * Extract plain text from React children
 */
export function extractTextFromChildren(children: React.ReactNode): string {
    if (typeof children === 'string') return children;
    if (typeof children === 'number') return String(children);
    if (!children) return '';

    if (Array.isArray(children)) {
        return children.map(extractTextFromChildren).join('');
    }

    if (React.isValidElement(children)) {
        return extractTextFromChildren((children as React.ReactElement<{ children?: React.ReactNode }>).props.children);
    }

    return '';
}

/**
 * Check if a value looks numeric
 */
export function isNumericValue(text: string): boolean {
    const cleaned = text.replace(/[,$%€£¥]/g, '').trim();
    return !isNaN(parseFloat(cleaned)) && isFinite(Number(cleaned));
}

/**
 * Extract table data from children for Excel export
 */
export function extractTableData(children: React.ReactNode): string[][] {
    const data: string[][] = [];

    const processChildren = (node: React.ReactNode) => {
        if (!node) return;

        if (Array.isArray(node)) {
            node.forEach(processChildren);
            return;
        }

        if (React.isValidElement(node)) {
            const element = node as React.ReactElement<any>;

            if (element.type === 'tr' || (typeof element.type === 'function' && element.type.name === 'tr')) {
                const row: string[] = [];
                React.Children.forEach(element.props.children, (cell) => {
                    if (cell && typeof cell === 'object' && 'props' in cell) {
                        const cellElement = cell as React.ReactElement<{ children?: React.ReactNode }>;
                        row.push(extractTextFromChildren(cellElement.props.children));
                    }
                });
                if (row.length > 0) {
                    data.push(row);
                }
            } else if (element.props && (element.props as { children?: React.ReactNode }).children) {
                processChildren((element.props as { children?: React.ReactNode }).children);
            }
        }
    };

    processChildren(children);
    return data;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Format duration in milliseconds to readable string
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
