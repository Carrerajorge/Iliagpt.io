/**
 * Block Component Registry
 * 
 * Maps block types to their React components.
 * Supports lazy loading and plugin extensibility.
 */

import React, { lazy, Suspense } from 'react';
import type { ContentBlock, BlockType } from '../types/blocks';
import type { RenderContext, BlockRenderer } from '../types/content';

// ============================================================================
// LAZY LOADED COMPONENTS
// ============================================================================

const TextBlock = lazy(() => import('../components/blocks/TextBlock'));
const HeadingBlock = lazy(() => import('../components/blocks/HeadingBlock'));
const DividerBlock = lazy(() => import('../components/blocks/DividerBlock'));
const CodeBlock = lazy(() => import('../components/blocks/CodeBlock'));
const ListBlock = lazy(() => import('../components/blocks/ListBlock'));
const QuoteBlock = lazy(() => import('../components/blocks/QuoteBlock'));
const ImageBlock = lazy(() => import('../components/blocks/ImageBlock'));
const TableBlock = lazy(() => import('../components/blocks/TableBlock'));
const CardBlock = lazy(() => import('../components/blocks/CardBlock'));
const CalloutBlock = lazy(() => import('../components/blocks/CalloutBlock'));
const ButtonBlock = lazy(() => import('../components/blocks/ButtonBlock'));
const FileBlock = lazy(() => import('../components/blocks/FileBlock'));
const ChartBlock = lazy(() => import('../components/blocks/ChartBlock'));
const EmbedBlock = lazy(() => import('../components/blocks/EmbedBlock'));
const LinkPreviewBlock = lazy(() => import('../components/blocks/LinkPreviewBlock'));
const MathBlock = lazy(() => import('../components/blocks/MathBlock'));
const CheckboxBlock = lazy(() => import('../components/blocks/CheckboxBlock'));
const CollapseBlock = lazy(() => import('../components/blocks/CollapseBlock'));
const RawHtmlBlock = lazy(() => import('../components/blocks/RawHtmlBlock'));

// ============================================================================
// REGISTRY
// ============================================================================

type ComponentMap = {
    [K in BlockType]?: React.LazyExoticComponent<any>;
};

const blockComponentMap: ComponentMap = {
    'text': TextBlock,
    'paragraph': TextBlock,
    'heading': HeadingBlock,
    'divider': DividerBlock,
    'code': CodeBlock,
    'list': ListBlock,
    'list-item': ListBlock,
    'quote': QuoteBlock,
    'image': ImageBlock,
    'table': TableBlock,
    'table-row': TableBlock,
    'table-cell': TableBlock,
    'card': CardBlock,
    'callout': CalloutBlock,
    'button': ButtonBlock,
    'file': FileBlock,
    'chart': ChartBlock,
    'embed': EmbedBlock,
    'link-preview': LinkPreviewBlock,
    'math': MathBlock,
    'checkbox': CheckboxBlock,
    'collapse': CollapseBlock,
    'raw-html': RawHtmlBlock,
};

// ============================================================================
// PLUGIN REGISTRY
// ============================================================================

interface PluginComponent {
    component: React.ComponentType<{ block: ContentBlock; context: RenderContext }>;
    priority: number;
}

const pluginComponentMap = new Map<BlockType, PluginComponent>();

export function registerBlockComponent(
    type: BlockType,
    component: React.ComponentType<{ block: ContentBlock; context: RenderContext }>,
    priority = 0
): void {
    const existing = pluginComponentMap.get(type);
    if (!existing || priority > existing.priority) {
        pluginComponentMap.set(type, { component, priority });
    }
}

export function unregisterBlockComponent(type: BlockType): boolean {
    return pluginComponentMap.delete(type);
}

// ============================================================================
// COMPONENT RESOLUTION
// ============================================================================

export function getBlockComponent(
    type: BlockType
): React.ComponentType<{ block: ContentBlock; context: RenderContext }> | null {
    // Check plugin registry first (higher priority)
    const pluginComponent = pluginComponentMap.get(type);
    if (pluginComponent) {
        return pluginComponent.component;
    }

    // Fallback to built-in components
    const BuiltInComponent = blockComponentMap[type];
    if (BuiltInComponent) {
        return BuiltInComponent as any;
    }

    return null;
}

// ============================================================================
// BLOCK FALLBACK
// ============================================================================

function BlockFallback() {
    return (
        <div className= "animate-pulse bg-muted/50 rounded h-4 my-2" />
  );
}

function BlockError({ type }: { type: string }) {
    return (
        <div className= "text-xs text-destructive bg-destructive/10 px-2 py-1 rounded" >
        Unknown block type: { type }
    </div>
  );
}

// ============================================================================
// RENDER BLOCK
// ============================================================================

export function renderBlock(
    block: ContentBlock,
    context: RenderContext,
    key?: string | number
): React.ReactNode {
    const Component = getBlockComponent(block.type);

    if (!Component) {
        return <BlockError key={ key } type = { block.type } />;
    }

    return (
        <Suspense key= { key ?? block.id
} fallback = {< BlockFallback />}>
    <Component block={ block } context = { context } />
        </Suspense>
  );
}

// ============================================================================
// RENDER BLOCKS
// ============================================================================

export function renderBlocks(
    blocks: ContentBlock[],
    context: RenderContext
): React.ReactNode[] {
    return blocks.map((block, index) => renderBlock(block, context, block.id || index));
}

// ============================================================================
// REGISTRY INFO
// ============================================================================

export function getRegisteredBlockTypes(): BlockType[] {
    const builtIn = Object.keys(blockComponentMap) as BlockType[];
    const plugins = Array.from(pluginComponentMap.keys());
    return [...new Set([...builtIn, ...plugins])];
}

export function isBlockTypeSupported(type: BlockType): boolean {
    return blockComponentMap[type] !== undefined || pluginComponentMap.has(type);
}

export default {
    registerBlockComponent,
    unregisterBlockComponent,
    getBlockComponent,
    renderBlock,
    renderBlocks,
    getRegisteredBlockTypes,
    isBlockTypeSupported,
};
