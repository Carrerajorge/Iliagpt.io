import { useRef, useEffect, useCallback, useState } from 'react';
import * as d3 from 'd3';
import type { SVGConfig } from '@shared/schemas/graphics';
import { sanitizeSVG, exportSVGAsString } from './svg-utils';

interface SVGRendererProps {
  config: SVGConfig;
  className?: string;
  onReady?: (svgElement: SVGSVGElement) => void;
  onExport?: (svgString: string) => void;
}

export function SVGRenderer({ config, className, onReady, onExport }: SVGRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const parseDimension = useCallback((value: number | string | undefined, fallback: number): number => {
    if (value === undefined) return fallback;
    if (typeof value === 'number') return value;
    if (value.endsWith('%')) return fallback;
    return parseInt(value, 10) || fallback;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    const updateDimensions = () => {
      const rect = container.getBoundingClientRect();
      setDimensions({
        width: parseDimension(config.width, rect.width || 800),
        height: parseDimension(config.height, rect.height || 600),
      });
    };

    updateDimensions();

    if (config.responsive !== false) {
      const resizeObserver = new ResizeObserver(updateDimensions);
      resizeObserver.observe(container);
      return () => resizeObserver.disconnect();
    }
  }, [config.width, config.height, config.responsive, parseDimension]);

  useEffect(() => {
    if (!containerRef.current || dimensions.width === 0) return;

    const container = d3.select(containerRef.current);
    container.selectAll('svg').remove();

    const svg = container
      .append('svg')
      .attr('id', config.id)
      .attr('width', dimensions.width)
      .attr('height', dimensions.height)
      .attr('xmlns', 'http://www.w3.org/2000/svg')
      .attr('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    if (config.viewBox) {
      svg.attr('viewBox', config.viewBox);
    } else {
      svg.attr('viewBox', `0 0 ${dimensions.width} ${dimensions.height}`);
    }

    if (config.preserveAspectRatio) {
      svg.attr('preserveAspectRatio', config.preserveAspectRatio);
    }

    if (config.background) {
      svg
        .append('rect')
        .attr('class', 'svg-background')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('fill', config.background);
    }

    const contentGroup = svg.append('g').attr('class', 'svg-content');

    if (config.content) {
      const sanitizedContent = sanitizeSVG(config.content);
      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg">${sanitizedContent}</svg>`,
        'image/svg+xml'
      );
      
      const parsedSvg = parsedDoc.documentElement;
      const fragment = document.createDocumentFragment();
      
      while (parsedSvg.firstChild) {
        fragment.appendChild(parsedSvg.firstChild);
      }
      contentGroup.node()?.appendChild(fragment);
    }

    svgRef.current = svg.node();

    if ((config.enableZoom || config.enablePan) && svgRef.current) {
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 10])
        .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          contentGroup.attr('transform', event.transform.toString());
        });

      if (!config.enableZoom) {
        zoom.scaleExtent([1, 1]);
      }

      if (!config.enablePan) {
        zoom.translateExtent([[0, 0], [0, 0]]);
      }

      svg.call(zoom);
      zoomRef.current = zoom;
    }

    if (svgRef.current && onReady) {
      onReady(svgRef.current);
    }

    return () => {
      container.selectAll('svg').remove();
      svgRef.current = null;
      zoomRef.current = null;
    };
  }, [config, dimensions, onReady]);

  const handleExport = useCallback(() => {
    if (svgRef.current && onExport) {
      const svgString = exportSVGAsString(svgRef.current);
      onExport(svgString);
    }
  }, [onExport]);

  const resetZoom = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(300)
        .call(zoomRef.current.transform, d3.zoomIdentity);
    }
  }, []);

  const zoomIn = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(200)
        .call(zoomRef.current.scaleBy, 1.3);
    }
  }, []);

  const zoomOut = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(200)
        .call(zoomRef.current.scaleBy, 0.7);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: typeof config.width === 'string' ? config.width : config.width ? `${config.width}px` : '100%',
        height: typeof config.height === 'string' ? config.height : config.height ? `${config.height}px` : '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
      data-testid={`svg-renderer-${config.id}`}
    >
      {(config.enableZoom || config.enablePan) && (
        <div 
          className="absolute top-2 right-2 flex flex-col gap-1 z-10"
          data-testid="svg-zoom-controls"
        >
          <button
            onClick={zoomIn}
            className="w-8 h-8 bg-white/90 dark:bg-gray-800/90 hover:bg-white dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded flex items-center justify-center text-gray-700 dark:text-gray-300 shadow-sm"
            data-testid="svg-zoom-in"
            title="Zoom In"
          >
            +
          </button>
          <button
            onClick={zoomOut}
            className="w-8 h-8 bg-white/90 dark:bg-gray-800/90 hover:bg-white dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded flex items-center justify-center text-gray-700 dark:text-gray-300 shadow-sm"
            data-testid="svg-zoom-out"
            title="Zoom Out"
          >
            −
          </button>
          <button
            onClick={resetZoom}
            className="w-8 h-8 bg-white/90 dark:bg-gray-800/90 hover:bg-white dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded flex items-center justify-center text-gray-700 dark:text-gray-300 shadow-sm text-xs"
            data-testid="svg-zoom-reset"
            title="Reset Zoom"
          >
            ↻
          </button>
        </div>
      )}
      {config.exportable && onExport && (
        <button
          onClick={handleExport}
          className="absolute bottom-2 right-2 px-3 py-1 bg-white/90 dark:bg-gray-800/90 hover:bg-white dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-sm text-gray-700 dark:text-gray-300 shadow-sm z-10"
          data-testid="svg-export-button"
        >
          Export SVG
        </button>
      )}
    </div>
  );
}

export type { SVGRendererProps };
