/**
 * ImageBlock Component
 * 
 * Renders images with lazy loading and lightbox.
 */

import React, { useState, useCallback } from 'react';
import type { ImageBlock as ImageBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme, useRenderContext } from '../../renderers/block-renderer';
import { X, ZoomIn, Download, Loader2 } from 'lucide-react';

interface Props {
    block: ImageBlockType;
    context: RenderContext;
}

export default function ImageBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const renderContext = useRenderContext();
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);

    const { src, alt, caption, width, height, loading = 'lazy', lightbox = true } = block;

    const handleLoad = useCallback(() => {
        setLoaded(true);
        renderContext.handlers?.onImageLoad?.(block.id);
    }, [block.id, renderContext.handlers]);

    const handleError = useCallback(() => {
        setError(true);
    }, []);

    if (error) {
        return (
            <div
                className="my-4 p-8 text-center rounded-lg border-2 border-dashed"
                style={{ borderColor: theme.colors.border }}
            >
                <span style={{ color: theme.colors.mutedForeground }}>
                    Error al cargar imagen
                </span>
            </div>
        );
    }

    return (
        <>
            <figure className="my-4">
                <div
                    className="relative inline-block overflow-hidden cursor-zoom-in"
                    style={{
                        borderRadius: theme.blocks.image.borderRadius,
                        maxWidth: theme.blocks.image.maxWidth,
                        boxShadow: theme.blocks.image.shadow,
                    }}
                    onClick={lightbox && renderContext.enableLightbox ? () => setLightboxOpen(true) : undefined}
                >
                    {!loaded && (
                        <div
                            className="absolute inset-0 flex items-center justify-center bg-muted animate-pulse"
                            style={{ width: width || 400, height: height || 300 }}
                        >
                            <Loader2 className="animate-spin" size={24} style={{ color: theme.colors.mutedForeground }} />
                        </div>
                    )}

                    <img
                        src={src}
                        alt={alt}
                        width={width}
                        height={height}
                        loading={loading}
                        onLoad={handleLoad}
                        onError={handleError}
                        className={`block transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                        style={{
                            maxWidth: '100%',
                            height: 'auto',
                        }}
                    />

                    {lightbox && loaded && (
                        <div
                            className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                            style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
                        >
                            <ZoomIn size={32} className="text-white" />
                        </div>
                    )}
                </div>

                {caption && (
                    <figcaption
                        className="mt-2 text-center"
                        style={{
                            fontSize: theme.blocks.image.captionSize,
                            color: theme.blocks.image.captionColor,
                        }}
                    >
                        {caption}
                    </figcaption>
                )}
            </figure>

            {/* Lightbox */}
            {lightboxOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ backgroundColor: 'rgba(0,0,0,0.9)' }}
                    onClick={() => setLightboxOpen(false)}
                >
                    <button
                        className="absolute top-4 right-4 p-2 text-white hover:bg-white/10 rounded-full"
                        onClick={() => setLightboxOpen(false)}
                    >
                        <X size={24} />
                    </button>

                    <img
                        src={src}
                        alt={alt}
                        className="max-w-full max-h-[90vh] object-contain"
                    />

                    <a
                        href={src}
                        download
                        className="absolute bottom-4 right-4 p-2 text-white hover:bg-white/10 rounded-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Download size={24} />
                    </a>
                </div>
            )}
        </>
    );
}
