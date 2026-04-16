/**
 * Virtualized List Component
 * Efficiently renders large lists by only rendering visible items
 */

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';

interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  className?: string;
  onEndReached?: () => void;
  endReachedThreshold?: number;
  emptyMessage?: string;
  loading?: boolean;
}

export function VirtualizedList<T>({
  items,
  itemHeight,
  renderItem,
  overscan = 5,
  className,
  onEndReached,
  endReachedThreshold = 200,
  emptyMessage = "No items",
  loading = false
}: VirtualizedListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Calculate visible range
  const { startIndex, endIndex, visibleItems } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const end = Math.min(items.length - 1, start + visibleCount + overscan * 2);
    
    return {
      startIndex: start,
      endIndex: end,
      visibleItems: items.slice(start, end + 1)
    };
  }, [scrollTop, containerHeight, itemHeight, items, overscan]);

  // Total height of all items
  const totalHeight = items.length * itemHeight;

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);

    // Check if near end
    if (onEndReached) {
      const distanceFromEnd = totalHeight - (target.scrollTop + target.clientHeight);
      if (distanceFromEnd < endReachedThreshold) {
        onEndReached();
      }
    }
  }, [totalHeight, endReachedThreshold, onEndReached]);

  // Measure container on mount and resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);
    setContainerHeight(container.clientHeight);

    return () => resizeObserver.disconnect();
  }, []);

  if (items.length === 0 && !loading) {
    return (
      <div className={cn("flex items-center justify-center py-8 text-muted-foreground", className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("overflow-auto", className)}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: startIndex * itemHeight,
            width: '100%'
          }}
        >
          {visibleItems.map((item, index) => (
            <div
              key={startIndex + index}
              style={{ height: itemHeight }}
            >
              {renderItem(item, startIndex + index)}
            </div>
          ))}
        </div>
      </div>
      {loading && (
        <div className="flex justify-center py-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
    </div>
  );
}

/**
 * Virtualized Table Component
 * For large data tables
 */
interface VirtualizedTableProps<T> {
  data: T[];
  columns: Array<{
    key: string;
    header: string;
    width?: number;
    render?: (item: T) => React.ReactNode;
  }>;
  rowHeight?: number;
  headerHeight?: number;
  className?: string;
  onRowClick?: (item: T, index: number) => void;
}

export function VirtualizedTable<T extends Record<string, any>>({
  data,
  columns,
  rowHeight = 48,
  headerHeight = 40,
  className,
  onRowClick
}: VirtualizedTableProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  const { startIndex, endIndex } = useMemo(() => {
    const overscan = 3;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / rowHeight);
    const end = Math.min(data.length - 1, start + visibleCount + overscan * 2);
    return { startIndex: start, endIndex: end };
  }, [scrollTop, containerHeight, rowHeight, data.length]);

  const visibleRows = data.slice(startIndex, endIndex + 1);
  const totalHeight = data.length * rowHeight;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      setContainerHeight(entries[0].contentRect.height - headerHeight);
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [headerHeight]);

  return (
    <div ref={containerRef} className={cn("border rounded-lg overflow-hidden", className)}>
      {/* Header */}
      <div 
        className="flex bg-muted/50 border-b sticky top-0 z-10"
        style={{ height: headerHeight }}
      >
        {columns.map((col) => (
          <div
            key={col.key}
            className="px-4 py-2 text-xs font-medium text-muted-foreground flex items-center"
            style={{ width: col.width || 'auto', flex: col.width ? 'none' : 1 }}
          >
            {col.header}
          </div>
        ))}
      </div>

      {/* Body */}
      <div
        className="overflow-auto"
        style={{ height: containerHeight }}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ position: 'absolute', top: startIndex * rowHeight, width: '100%' }}>
            {visibleRows.map((item, index) => (
              <div
                key={startIndex + index}
                className={cn(
                  "flex items-center border-b hover:bg-muted/50 transition-colors",
                  onRowClick && "cursor-pointer"
                )}
                style={{ height: rowHeight }}
                onClick={() => onRowClick?.(item, startIndex + index)}
              >
                {columns.map((col) => (
                  <div
                    key={col.key}
                    className="px-4 py-2 text-sm truncate"
                    style={{ width: col.width || 'auto', flex: col.width ? 'none' : 1 }}
                  >
                    {col.render ? col.render(item) : item[col.key]}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Infinite scroll hook
 */
export function useInfiniteScroll(
  callback: () => void,
  options: { threshold?: number; enabled?: boolean } = {}
) {
  const { threshold = 200, enabled = true } = options;
  const observerRef = useRef<IntersectionObserver | null>(null);
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          callback();
        }
      },
      { rootMargin: `${threshold}px` }
    );

    if (targetRef.current) {
      observerRef.current.observe(targetRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [callback, threshold, enabled]);

  return targetRef;
}
