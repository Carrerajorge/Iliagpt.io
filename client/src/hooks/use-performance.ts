/**
 * Performance Utilities
 * 
 * Hooks and utilities for:
 * - Debouncing
 * - Throttling
 * - Memoization
 * - Deferred values
 */

import {
    useState,
    useEffect,
    useCallback,
    useRef,
    useMemo,
    useDeferredValue,
    type DependencyList,
    type RefCallback,
} from 'react';

// ============================================================================
// Debounce
// ============================================================================

/**
 * Debounce hook - delays execution until pause in changes
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(timer);
        };
    }, [value, delay]);

    return debouncedValue;
}

/**
 * Debounced callback hook
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
    callback: T,
    delay: number = 300
): T {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const callbackRef = useRef(callback);

    // Update ref when callback changes
    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    const debouncedCallback = useCallback((...args: Parameters<T>) => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
            callbackRef.current(...args);
        }, delay);
    }, [delay]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return debouncedCallback as T;
}

// ============================================================================
// Throttle
// ============================================================================

/**
 * Throttled callback hook - limits execution rate
 */
export function useThrottledCallback<T extends (...args: any[]) => any>(
    callback: T,
    delay: number = 300
): T {
    const lastRunRef = useRef<number>(0);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const callbackRef = useRef(callback);

    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    const throttledCallback = useCallback((...args: Parameters<T>) => {
        const now = Date.now();
        const timeSinceLastRun = now - lastRunRef.current;

        if (timeSinceLastRun >= delay) {
            lastRunRef.current = now;
            callbackRef.current(...args);
        } else {
            // Schedule for later if not already scheduled
            if (!timeoutRef.current) {
                timeoutRef.current = setTimeout(() => {
                    lastRunRef.current = Date.now();
                    callbackRef.current(...args);
                    timeoutRef.current = null;
                }, delay - timeSinceLastRun);
            }
        }
    }, [delay]);

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return throttledCallback as T;
}

// ============================================================================
// Deferred Value (for search/filtering)
// ============================================================================

/**
 * Deferred search value - shows current input immediately but defers expensive operations
 */
export function useDeferredSearch(searchTerm: string): {
    immediateValue: string;
    deferredValue: string;
    isPending: boolean;
} {
    const deferredValue = useDeferredValue(searchTerm);
    const isPending = searchTerm !== deferredValue;

    return {
        immediateValue: searchTerm,
        deferredValue,
        isPending,
    };
}

// ============================================================================
// Previous Value
// ============================================================================

/**
 * Track previous value of a variable
 */
export function usePrevious<T>(value: T): T | undefined {
    const ref = useRef<T | undefined>(undefined);

    useEffect(() => {
        ref.current = value;
    }, [value]);

    return ref.current;
}

// ============================================================================
// Stable Callback
// ============================================================================

/**
 * Stable callback that always has latest version without causing re-renders
 */
export function useStableCallback<T extends (...args: any[]) => any>(callback: T): T {
    const callbackRef = useRef(callback);

    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    return useCallback((...args: Parameters<T>) => {
        return callbackRef.current(...args);
    }, []) as T;
}

// ============================================================================
// Memoized List
// ============================================================================

/**
 * Memoize a list with stable identity for unchanged items
 */
export function useMemoizedList<T extends { id: string }>(
    items: T[],
    deps: DependencyList = []
): T[] {
    const prevItemsRef = useRef<Map<string, T>>(new Map());

    return useMemo(() => {
        const newMap = new Map<string, T>();
        const result: T[] = [];

        for (const item of items) {
            const prevItem = prevItemsRef.current.get(item.id);

            // Use previous reference if content is the same
            if (prevItem && JSON.stringify(prevItem) === JSON.stringify(item)) {
                newMap.set(item.id, prevItem);
                result.push(prevItem);
            } else {
                newMap.set(item.id, item);
                result.push(item);
            }
        }

        prevItemsRef.current = newMap;
        return result;
    }, [items, ...deps]);
}

// ============================================================================
// Intersection Observer
// ============================================================================

/**
 * Intersection observer hook for lazy loading
 */
export function useIntersectionObserver(
    options: IntersectionObserverInit = {}
): [RefCallback<Element>, boolean] {
    const [isVisible, setIsVisible] = useState(false);
    const [element, setElement] = useState<Element | null>(null);

    useEffect(() => {
        if (!element) return;

        const observer = new IntersectionObserver(([entry]) => {
            setIsVisible(entry.isIntersecting);
        }, options);

        observer.observe(element);

        return () => {
            observer.disconnect();
        };
    }, [element, options.root, options.rootMargin, options.threshold]);

    return [setElement, isVisible];
}

// ============================================================================
// Render Count (Development)
// ============================================================================

/**
 * Track render count (development only)
 */
export function useRenderCount(componentName: string): void {
    const countRef = useRef(0);
    countRef.current++;

    useEffect(() => {
        if (import.meta.env.DEV) {
            console.log(`[RenderCount] ${componentName}: ${countRef.current}`);
        }
    });
}
