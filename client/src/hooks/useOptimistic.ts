/**
 * Hooks: Debounce (#14) and Optimistic Updates (#13)
 * Performance and UX utility hooks
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ============================================
// DEBOUNCE HOOK (#14)
// ============================================

export function useDebounce<T>(value: T, delay: number): T {
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

export function useDebouncedCallback<T extends (...args: any[]) => any>(
    callback: T,
    delay: number
): (...args: Parameters<T>) => void {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return useCallback((...args: Parameters<T>) => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
            callback(...args);
        }, delay);
    }, [callback, delay]);
}

// With leading edge option
export function useDebouncedFunction<T extends (...args: any[]) => any>(
    callback: T,
    delay: number,
    options: { leading?: boolean; trailing?: boolean } = {}
): {
    fn: (...args: Parameters<T>) => void;
    cancel: () => void;
    flush: () => void;
} {
    const { leading = false, trailing = true } = options;
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastArgsRef = useRef<Parameters<T> | null>(null);
    const hasLeadingRef = useRef(false);

    const cancel = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        hasLeadingRef.current = false;
        lastArgsRef.current = null;
    }, []);

    const flush = useCallback(() => {
        if (timeoutRef.current && lastArgsRef.current) {
            callback(...lastArgsRef.current);
            cancel();
        }
    }, [callback, cancel]);

    useEffect(() => cancel, [cancel]);

    const fn = useCallback((...args: Parameters<T>) => {
        lastArgsRef.current = args;

        if (leading && !hasLeadingRef.current) {
            hasLeadingRef.current = true;
            callback(...args);
        }

        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
            if (trailing) {
                callback(...args);
            }
            hasLeadingRef.current = false;
        }, delay);
    }, [callback, delay, leading, trailing]);

    return { fn, cancel, flush };
}

// ============================================
// THROTTLE HOOK
// ============================================

export function useThrottle<T>(value: T, limit: number): T {
    const [throttledValue, setThrottledValue] = useState<T>(value);
    const lastRan = useRef(Date.now());

    useEffect(() => {
        const handler = setTimeout(() => {
            if (Date.now() - lastRan.current >= limit) {
                setThrottledValue(value);
                lastRan.current = Date.now();
            }
        }, limit - (Date.now() - lastRan.current));

        return () => {
            clearTimeout(handler);
        };
    }, [value, limit]);

    return throttledValue;
}

export function useThrottledCallback<T extends (...args: any[]) => any>(
    callback: T,
    limit: number
): (...args: Parameters<T>) => void {
    const lastRan = useRef(0);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return useCallback((...args: Parameters<T>) => {
        const now = Date.now();
        const remaining = limit - (now - lastRan.current);

        if (remaining <= 0) {
            lastRan.current = now;
            callback(...args);
        } else if (!timeoutRef.current) {
            timeoutRef.current = setTimeout(() => {
                lastRan.current = Date.now();
                timeoutRef.current = null;
                callback(...args);
            }, remaining);
        }
    }, [callback, limit]);
}

// ============================================
// OPTIMISTIC UPDATES (#13)
// ============================================

interface OptimisticState<T> {
    data: T;
    pending: boolean;
    error: Error | null;
    optimisticData: T;
}

export function useOptimisticUpdate<T>(
    initialData: T,
    updateFn: (newData: T) => Promise<T>,
    options: {
        onSuccess?: (data: T) => void;
        onError?: (error: Error, previousData: T) => void;
        onSettled?: () => void;
    } = {}
) {
    const [state, setState] = useState<OptimisticState<T>>({
        data: initialData,
        pending: false,
        error: null,
        optimisticData: initialData,
    });

    const previousDataRef = useRef<T>(initialData);

    const update = useCallback(async (newData: T) => {
        previousDataRef.current = state.data;

        // Apply optimistic update immediately
        setState(prev => ({
            ...prev,
            optimisticData: newData,
            pending: true,
            error: null,
        }));

        try {
            const result = await updateFn(newData);

            setState(prev => ({
                ...prev,
                data: result,
                optimisticData: result,
                pending: false,
            }));

            options.onSuccess?.(result);
            return result;
        } catch (error: any) {
            // Rollback to previous data
            setState(prev => ({
                ...prev,
                optimisticData: previousDataRef.current,
                pending: false,
                error,
            }));

            options.onError?.(error, previousDataRef.current);
            throw error;
        } finally {
            options.onSettled?.();
        }
    }, [state.data, updateFn, options]);

    const reset = useCallback(() => {
        setState({
            data: initialData,
            pending: false,
            error: null,
            optimisticData: initialData,
        });
    }, [initialData]);

    return {
        data: state.optimisticData,
        actualData: state.data,
        isPending: state.pending,
        error: state.error,
        update,
        reset,
    };
}

// For list operations
export function useOptimisticList<T extends { id: string | number }>(
    initialItems: T[],
    options: {
        addItem?: (item: T) => Promise<T>;
        updateItem?: (item: T) => Promise<T>;
        removeItem?: (id: T['id']) => Promise<void>;
    }
) {
    const [items, setItems] = useState<T[]>(initialItems);
    const [pending, setPending] = useState<Set<T['id']>>(new Set());

    const optimisticAdd = useCallback(async (item: T) => {
        // Add optimistically
        setItems(prev => [...prev, item]);
        setPending(prev => new Set(prev).add(item.id));

        try {
            const result = await options.addItem?.(item);

            setItems(prev =>
                prev.map(i => i.id === item.id ? (result || i) : i)
            );
        } catch (error) {
            // Remove on failure
            setItems(prev => prev.filter(i => i.id !== item.id));
            throw error;
        } finally {
            setPending(prev => {
                const next = new Set(prev);
                next.delete(item.id);
                return next;
            });
        }
    }, [options]);

    const optimisticUpdate = useCallback(async (item: T) => {
        const previousItems = items;

        // Update optimistically
        setItems(prev =>
            prev.map(i => i.id === item.id ? item : i)
        );
        setPending(prev => new Set(prev).add(item.id));

        try {
            const result = await options.updateItem?.(item);

            setItems(prev =>
                prev.map(i => i.id === item.id ? (result || item) : i)
            );
        } catch (error) {
            // Rollback
            setItems(previousItems);
            throw error;
        } finally {
            setPending(prev => {
                const next = new Set(prev);
                next.delete(item.id);
                return next;
            });
        }
    }, [items, options]);

    const optimisticRemove = useCallback(async (id: T['id']) => {
        const removedItem = items.find(i => i.id === id);

        // Remove optimistically
        setItems(prev => prev.filter(i => i.id !== id));
        setPending(prev => new Set(prev).add(id));

        try {
            await options.removeItem?.(id);
        } catch (error) {
            // Restore on failure
            if (removedItem) {
                setItems(prev => [...prev, removedItem]);
            }
            throw error;
        } finally {
            setPending(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [items, options]);

    return {
        items,
        setItems,
        pending,
        isPending: (id: T['id']) => pending.has(id),
        add: optimisticAdd,
        update: optimisticUpdate,
        remove: optimisticRemove,
    };
}

// ============================================
// SEARCH HOOK WITH DEBOUNCE
// ============================================

export function useSearch<T>(
    searchFn: (query: string) => Promise<T[]>,
    options: {
        debounce?: number;
        minLength?: number;
    } = {}
) {
    const { debounce = 300, minLength = 2 } = options;

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<T[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const debouncedQuery = useDebounce(query, debounce);

    useEffect(() => {
        if (debouncedQuery.length < minLength) {
            setResults([]);
            return;
        }

        const search = async () => {
            setIsSearching(true);
            setError(null);

            try {
                const data = await searchFn(debouncedQuery);
                setResults(data);
            } catch (err: any) {
                setError(err);
                setResults([]);
            } finally {
                setIsSearching(false);
            }
        };

        search();
    }, [debouncedQuery, minLength, searchFn]);

    return {
        query,
        setQuery,
        results,
        isSearching,
        error,
        clear: () => {
            setQuery('');
            setResults([]);
        },
    };
}
