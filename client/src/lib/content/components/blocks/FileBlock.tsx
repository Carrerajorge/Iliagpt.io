/**
 * FileBlock Component
 * 
 * Renders file attachments with download.
 */

import React from 'react';
import type { FileBlock as FileBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';
import { FileText, Image, FileCode, FileSpreadsheet, File, Download } from 'lucide-react';

interface Props {
    block: FileBlockType;
    context: RenderContext;
}

const getFileIcon = (mimeType?: string, name?: string) => {
    if (!mimeType && name) {
        const ext = name.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '')) return Image;
        if (['js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css', 'json'].includes(ext || '')) return FileCode;
        if (['csv', 'xlsx', 'xls'].includes(ext || '')) return FileSpreadsheet;
        if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext || '')) return FileText;
    }

    if (mimeType?.startsWith('image/')) return Image;
    if (mimeType?.includes('javascript') || mimeType?.includes('typescript')) return FileCode;
    if (mimeType?.includes('spreadsheet') || mimeType?.includes('csv')) return FileSpreadsheet;
    if (mimeType?.includes('pdf') || mimeType?.includes('document')) return FileText;

    return File;
};

const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function FileBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const { name, url, size, mimeType, preview, downloadable = true } = block;

    const Icon = getFileIcon(mimeType, name);
    const sizeText = formatFileSize(size);

    return (
        <div
            className="my-4 flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors group"
            style={{
                borderColor: theme.colors.border,
            }}
        >
            {preview ? (
                <img
                    src={preview}
                    alt={name}
                    className="w-10 h-10 rounded object-cover"
                />
            ) : (
                <div
                    className="w-10 h-10 rounded flex items-center justify-center"
                    style={{ backgroundColor: theme.colors.muted }}
                >
                    <Icon size={20} style={{ color: theme.colors.mutedForeground }} />
                </div>
            )}

            <div className="flex-1 min-w-0">
                <p
                    className="font-medium truncate"
                    style={{ color: theme.colors.foreground }}
                >
                    {name}
                </p>
                {sizeText && (
                    <p
                        className="text-sm"
                        style={{ color: theme.colors.mutedForeground }}
                    >
                        {sizeText}
                    </p>
                )}
            </div>

            {downloadable && (
                <a
                    href={url}
                    download={name}
                    className="p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted"
                >
                    <Download size={18} style={{ color: theme.colors.mutedForeground }} />
                </a>
            )}
        </div>
    );
}
