/**
 * Virtualization Utilities
 * Optimizations for virtual lists to reduce re-renders and memory usage
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';

// ============================================
// MEMOIZATION UTILITIES
// ============================================

/**
 * Create a stable item renderer that prevents unnecessary re-renders
 * by memoizing the render function based on item data
 */
export function createStableItemRenderer<T>(
  renderItem: (item: T, index: number) => React.ReactNode,
  getItemKey: (item: T, index: number) => string | number
) {
  const cache = new Map<string | number, React.ReactNode>();

  return (item: T, index: number) => {
    const key = getItemKey(item, index);
    if (!cache.has(key)) {
      cache.set(key, renderItem(item, index));
    }
    return cache.get(key);
  };
}

/**
 * Hook for stable callback references that don't cause re-renders
 */
export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T
): T {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  return useCallback(
    ((...args: Parameters<T>) => callbackRef.current(...args)) as T,
    []
  );
}

// ============================================
// SCROLL PERFORMANCE
// ============================================

/**
 * Debounced scroll handler to reduce event processing
 */
export function useDebouncedScroll(
  onScroll: (scrollTop: number) => void,
  delay: number = 16 // ~60fps
) {
  const frameRef = useRef<number>();
  const lastScrollTop = useRef<number>(0);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLElement>) => {
      const scrollTop = event.currentTarget.scrollTop;

      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }

      frameRef.current = requestAnimationFrame(() => {
        if (Math.abs(scrollTop - lastScrollTop.current) > 1) {
          lastScrollTop.current = scrollTop;
          onScroll(scrollTop);
        }
      });
    },
    [onScroll]
  );

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return handleScroll;
}

/**
 * Throttled scroll handler for heavy computations
 */
export function useThrottledScroll(
  onScroll: (scrollTop: number) => void,
  throttleMs: number = 100
) {
  const lastCallRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout>();

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLElement>) => {
      const scrollTop = event.currentTarget.scrollTop;
      const now = Date.now();

      if (now - lastCallRef.current >= throttleMs) {
        lastCallRef.current = now;
        onScroll(scrollTop);
      } else {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          lastCallRef.current = Date.now();
          onScroll(scrollTop);
        }, throttleMs - (now - lastCallRef.current));
      }
    },
    [onScroll, throttleMs]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return handleScroll;
}

// ============================================
// MEMORY MANAGEMENT
// ============================================

/**
 * LRU Cache for rendered items to prevent memory growth
 */
export class RenderCache<T> {
  private cache = new Map<string, T>();
  private order: string[] = [];
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      const index = this.order.indexOf(key);
      if (index > -1) {
        this.order.splice(index, 1);
        this.order.push(key);
      }
    }
    return value;
  }

  set(key: string, value: T): void {
    if (this.cache.has(key)) {
      this.cache.set(key, value);
      return;
    }

    // Evict oldest if at capacity
    while (this.order.length >= this.maxSize) {
      const oldest = this.order.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, value);
    this.order.push(key);
  }

  clear(): void {
    this.cache.clear();
    this.order = [];
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Hook to use render cache
 */
export function useRenderCache<T>(maxSize: number = 100) {
  const cacheRef = useRef<RenderCache<T>>();

  if (!cacheRef.current) {
    cacheRef.current = new RenderCache<T>(maxSize);
  }

  useEffect(() => {
    return () => {
      cacheRef.current?.clear();
    };
  }, []);

  return cacheRef.current;
}

// ============================================
// OVERSCAN OPTIMIZATION
// ============================================

/**
 * Calculate optimal overscan based on scroll velocity
 */
export function useAdaptiveOverscan(
  baseOverscan: number = 3,
  maxOverscan: number = 10
) {
  const lastScrollTime = useRef<number>(Date.now());
  const lastScrollTop = useRef<number>(0);
  const velocity = useRef<number>(0);

  const updateVelocity = useCallback((scrollTop: number) => {
    const now = Date.now();
    const dt = now - lastScrollTime.current;

    if (dt > 0) {
      const distance = Math.abs(scrollTop - lastScrollTop.current);
      velocity.current = distance / dt; // pixels per ms
    }

    lastScrollTime.current = now;
    lastScrollTop.current = scrollTop;
  }, []);

  const getOverscan = useCallback(() => {
    // Higher velocity = more overscan
    const velocityFactor = Math.min(velocity.current / 2, 1);
    return Math.round(baseOverscan + (maxOverscan - baseOverscan) * velocityFactor);
  }, [baseOverscan, maxOverscan]);

  return { updateVelocity, getOverscan };
}

// ============================================
// ITEM SIZE ESTIMATION
// ============================================

/**
 * Track and average item heights for better scroll estimation
 */
export function useItemSizeEstimator(defaultSize: number = 50) {
  const sizes = useRef<Map<number, number>>(new Map());
  const totalMeasured = useRef<number>(0);
  const totalSize = useRef<number>(0);

  const setSize = useCallback((index: number, size: number) => {
    if (!sizes.current.has(index)) {
      totalMeasured.current++;
      totalSize.current += size;
    } else {
      totalSize.current -= sizes.current.get(index)!;
      totalSize.current += size;
    }
    sizes.current.set(index, size);
  }, []);

  const getSize = useCallback(
    (index: number) => {
      return sizes.current.get(index);
    },
    []
  );

  const getAverageSize = useCallback(() => {
    if (totalMeasured.current === 0) {
      return defaultSize;
    }
    return totalSize.current / totalMeasured.current;
  }, [defaultSize]);

  const estimateTotalSize = useCallback(
    (itemCount: number) => {
      let knownSize = 0;
      let unknownCount = 0;

      for (let i = 0; i < itemCount; i++) {
        const size = sizes.current.get(i);
        if (size !== undefined) {
          knownSize += size;
        } else {
          unknownCount++;
        }
      }

      return knownSize + unknownCount * getAverageSize();
    },
    [getAverageSize]
  );

  const reset = useCallback(() => {
    sizes.current.clear();
    totalMeasured.current = 0;
    totalSize.current = 0;
  }, []);

  return {
    setSize,
    getSize,
    getAverageSize,
    estimateTotalSize,
    reset,
  };
}

// ============================================
// WINDOWING HELPERS
// ============================================

/**
 * Calculate visible range with overscan
 */
export function calculateVisibleRange(
  scrollTop: number,
  containerHeight: number,
  itemHeight: number,
  itemCount: number,
  overscan: number = 3
): { startIndex: number; endIndex: number; visibleStartIndex: number; visibleEndIndex: number } {
  const visibleStartIndex = Math.floor(scrollTop / itemHeight);
  const visibleEndIndex = Math.min(
    Math.ceil((scrollTop + containerHeight) / itemHeight),
    itemCount - 1
  );

  const startIndex = Math.max(0, visibleStartIndex - overscan);
  const endIndex = Math.min(itemCount - 1, visibleEndIndex + overscan);

  return {
    startIndex,
    endIndex,
    visibleStartIndex,
    visibleEndIndex,
  };
}

/**
 * Get items to render based on visible range
 */
export function getItemsToRender<T>(
  items: T[],
  startIndex: number,
  endIndex: number
): Array<{ item: T; index: number }> {
  const result: Array<{ item: T; index: number }> = [];

  for (let i = startIndex; i <= endIndex && i < items.length; i++) {
    result.push({ item: items[i], index: i });
  }

  return result;
}

// ============================================
// SCROLL RESTORATION
// ============================================

/**
 * Save and restore scroll position
 */
export function useScrollRestoration(key: string) {
  const scrollPositions = useRef<Map<string, number>>(new Map());

  const savePosition = useCallback(
    (scrollTop: number) => {
      scrollPositions.current.set(key, scrollTop);
    },
    [key]
  );

  const restorePosition = useCallback(
    (containerRef: React.RefObject<HTMLElement>) => {
      const position = scrollPositions.current.get(key);
      if (position !== undefined && containerRef.current) {
        containerRef.current.scrollTop = position;
      }
    },
    [key]
  );

  const clearPosition = useCallback(() => {
    scrollPositions.current.delete(key);
  }, [key]);

  return {
    savePosition,
    restorePosition,
    clearPosition,
    hasPosition: scrollPositions.current.has(key),
  };
}
