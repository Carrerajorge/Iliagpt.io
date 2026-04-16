/**
 * TableBlock Component
 * 
 * Renders tables with striping and sorting.
 */

import React from 'react';
import type { TableBlock as TableBlockType, TableRowBlock, TableCellBlock } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';

interface Props {
    block: TableBlockType | TableRowBlock | TableCellBlock;
    context: RenderContext;
}

export default function TableBlock({ block, context }: Props) {
    const theme = useContentTheme();

    if (block.type === 'table-cell') {
        return <TableCell block={block} theme={theme} />;
    }

    if (block.type === 'table-row') {
        return <TableRow block={block} theme={theme} />;
    }

    const { rows, caption, striped = true, bordered = true, headers } = block;

    return (
        <div className="my-4 overflow-x-auto">
            <table
                className="w-full border-collapse"
                style={{
                    border: bordered ? `1px solid ${theme.blocks.table.borderColor}` : 'none',
                }}
            >
                {caption && (
                    <caption
                        className="mb-2 text-sm"
                        style={{ color: theme.colors.mutedForeground }}
                    >
                        {caption}
                    </caption>
                )}

                {headers && headers.length > 0 && (
                    <thead>
                        <tr style={{ backgroundColor: theme.blocks.table.headerBackground }}>
                            {headers.map((header, i) => (
                                <th
                                    key={i}
                                    className="text-left font-semibold"
                                    style={{
                                        padding: `${theme.blocks.table.cellPadding.y}px ${theme.blocks.table.cellPadding.x}px`,
                                        color: theme.blocks.table.headerColor,
                                        borderBottom: `1px solid ${theme.blocks.table.borderColor}`,
                                    }}
                                >
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                )}

                <tbody>
                    {rows.map((row, rowIndex) => (
                        <tr
                            key={row.id || rowIndex}
                            style={{
                                backgroundColor: row.header
                                    ? theme.blocks.table.headerBackground
                                    : striped && rowIndex % 2 === 1
                                        ? theme.blocks.table.rowAlternate
                                        : theme.blocks.table.rowBackground,
                            }}
                        >
                            {row.cells.map((cell, cellIndex) => {
                                const CellTag = row.header ? 'th' : 'td';
                                return (
                                    <CellTag
                                        key={cell.id || cellIndex}
                                        colSpan={cell.colspan}
                                        rowSpan={cell.rowspan}
                                        className={row.header ? 'font-semibold' : ''}
                                        style={{
                                            padding: `${theme.blocks.table.cellPadding.y}px ${theme.blocks.table.cellPadding.x}px`,
                                            color: row.header ? theme.blocks.table.headerColor : theme.colors.foreground,
                                            borderBottom: `1px solid ${theme.blocks.table.borderColor}`,
                                            borderRight: bordered ? `1px solid ${theme.blocks.table.borderColor}` : 'none',
                                            textAlign: cell.align || 'left',
                                        }}
                                    >
                                        {typeof cell.value === 'string' ? cell.value : 'Complex content'}
                                    </CellTag>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function TableRow({ block, theme }: { block: TableRowBlock; theme: any }) {
    return null; // Rendered by parent
}

function TableCell({ block, theme }: { block: TableCellBlock; theme: any }) {
    return null; // Rendered by parent
}
