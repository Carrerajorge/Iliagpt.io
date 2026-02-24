/**
 * ListBlock Component
 * 
 * Renders ordered/unordered lists with nested support.
 */

import React from 'react';
import type { ListBlock as ListBlockType, ListItemBlock } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';
import { renderBlocks } from '../../renderers/registry';
import { Check, Square } from 'lucide-react';

interface Props {
    block: ListBlockType | ListItemBlock;
    context: RenderContext;
}

export default function ListBlock({ block, context }: Props) {
    const theme = useContentTheme();

    if (block.type === 'list-item') {
        return <ListItem block={block} context={context} theme={theme} />;
    }

    const { ordered, start, items } = block;
    const Tag = ordered ? 'ol' : 'ul';

    return (
        <Tag
            start={start}
            className="my-4"
            style={{
                paddingLeft: theme.blocks.list.indent,
                listStyleType: ordered ? 'decimal' : 'disc',
                color: theme.colors.foreground,
            }}
        >
            {items.map((item, i) => (
                <ListItem key={item.id || i} block={item} context={context} theme={theme} />
            ))}
        </Tag>
    );
}

function ListItem({
    block,
    context,
    theme
}: {
    block: ListItemBlock;
    context: RenderContext;
    theme: any;
}) {
    const { children, checked } = block;
    const isCheckbox = checked !== undefined;

    return (
        <li
            className="mb-1"
            style={{
                marginBottom: theme.blocks.list.itemSpacing,
                listStyleType: isCheckbox ? 'none' : undefined,
                marginLeft: isCheckbox ? -theme.blocks.list.indent : undefined,
            }}
        >
            <div className="flex items-start gap-2">
                {isCheckbox && (
                    <span
                        className="flex-shrink-0 mt-0.5"
                        style={{ color: checked ? theme.colors.success : theme.colors.mutedForeground }}
                    >
                        {checked ? (
                            <Check size={theme.blocks.list.checkboxSize} />
                        ) : (
                            <Square size={theme.blocks.list.checkboxSize} />
                        )}
                    </span>
                )}
                <div className={`flex-1 ${checked ? 'line-through opacity-60' : ''}`}>
                    {renderBlocks(children, context)}
                </div>
            </div>
        </li>
    );
}
