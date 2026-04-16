/**
 * Predictive Prefetch Hook - ILIAGPT PRO 3.0
 * 
 * Intelligently preloads likely responses and data.
 * Reduces perceived latency through prediction.
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ============== Types ==============

export interface PrefetchConfig {
    maxCacheSize?: number;
    predictionThreshold?: number;
    prefetchDelay?: number;
    enableAnalytics?: boolean;
}

export interface PredictionResult {
    prediction: string;
    confidence: number;
    type: "response" | "search" | "action";
    cachedAt: Date;
}

export interface PrefetchState {
    predictions: Map<string, PredictionResult>;
    cacheHits: number;
    cacheMisses: number;
    isPrefetching: boolean;
}

interface InputPattern {
    prefix: string;
    completions: string[];
    frequency: number;
    lastUsed: Date;
}

// ============== Pattern Learning ==============

const patterns: Map<string, InputPattern> = new Map();
const prefetchCache: Map<string, PredictionResult> = new Map();

function learnPattern(input: string, completion: string): void {
    const prefix = input.slice(0, 20);
    const existing = patterns.get(prefix);

    if (existing) {
        if (!existing.completions.includes(completion)) {
            existing.completions.push(completion);
        }
        existing.frequency++;
        existing.lastUsed = new Date();
    } else {
        patterns.set(prefix, {
            prefix,
            completions: [completion],
            frequency: 1,
            lastUsed: new Date(),
        });
    }
}

function predictCompletion(input: string): { prediction: string; confidence: number } | null {
    const prefix = input.slice(0, 20);
    const pattern = patterns.get(prefix);

    if (!pattern || pattern.completions.length === 0) {
        // Try partial match
        for (const [key, p] of patterns) {
            if (key.startsWith(prefix.slice(0, 10)) && p.frequency > 2) {
                return {
                    prediction: p.completions[0],
                    confidence: 0.5 * (p.frequency / 10),
                };
            }
        }
        return null;
    }

    const recentBias = (Date.now() - pattern.lastUsed.getTime()) < 3600000 ? 0.1 : 0;
    const confidence = Math.min(0.95, 0.5 + (pattern.frequency * 0.05) + recentBias);

    return {
        prediction: pattern.completions[0],
        confidence,
    };
}

// ============== Hook ==============

export function usePredictivePrefetch(config: PrefetchConfig = {}) {
    const {
        maxCacheSize = 100,
        predictionThreshold = 0.6,
        prefetchDelay = 300,
        enableAnalytics = true,
    } = config;

    const [state, setState] = useState<PrefetchState>({
        predictions: new Map(),
        cacheHits: 0,
        cacheMisses: 0,
        isPrefetching: false,
    });

    const prefetchTimeout = useRef<NodeJS.Timeout | null>(null);
    const currentInput = useRef<string>("");

    // ======== Input Tracking ========

    const trackInput = useCallback((input: string) => {
        currentInput.current = input;

        // Cancel pending prefetch
        if (prefetchTimeout.current) {
            clearTimeout(prefetchTimeout.current);
        }

        if (input.length < 5) return;

        // Schedule prefetch
        prefetchTimeout.current = setTimeout(() => {
            prefetchForInput(input);
        }, prefetchDelay);
    }, [prefetchDelay]);

    // ======== Prefetching ========

    const prefetchForInput = useCallback(async (input: string) => {
        const prediction = predictCompletion(input);

        if (!prediction || prediction.confidence < predictionThreshold) {
            return;
        }

        setState(s => ({ ...s, isPrefetching: true }));

        try {
            // Check if already cached
            const cacheKey = `${input}:${prediction.prediction}`;
            if (prefetchCache.has(cacheKey)) {
                return; // Already prefetched
            }

            // Prefetch the likely response
            const prefetched = await executePrefetch(prediction.prediction);

            if (prefetched) {
                const result: PredictionResult = {
                    prediction: prefetched,
                    confidence: prediction.confidence,
                    type: "response",
                    cachedAt: new Date(),
                };

                prefetchCache.set(cacheKey, result);

                // Enforce cache size
                if (prefetchCache.size > maxCacheSize) {
                    const oldest = [...prefetchCache.entries()]
                        .sort((a, b) => a[1].cachedAt.getTime() - b[1].cachedAt.getTime())[0];
                    if (oldest) prefetchCache.delete(oldest[0]);
                }

                setState(s => ({
                    ...s,
                    predictions: new Map(prefetchCache),
                }));
            }
        } finally {
            setState(s => ({ ...s, isPrefetching: false }));
        }
    }, [predictionThreshold, maxCacheSize]);

    // ======== Cache Retrieval ========

    const getPrefetched = useCallback((input: string): PredictionResult | null => {
        const prediction = predictCompletion(input);
        if (!prediction) {
            setState(s => ({ ...s, cacheMisses: s.cacheMisses + 1 }));
            return null;
        }

        const cacheKey = `${input}:${prediction.prediction}`;
        const cached = prefetchCache.get(cacheKey);

        if (cached) {
            setState(s => ({ ...s, cacheHits: s.cacheHits + 1 }));
            return cached;
        }

        setState(s => ({ ...s, cacheMisses: s.cacheMisses + 1 }));
        return null;
    }, []);

    // ======== Learning ========

    const recordCompletion = useCallback((input: string, completion: string) => {
        learnPattern(input, completion);

        if (enableAnalytics) {
            console.log(`[Prefetch] Learned: "${input.slice(0, 20)}..." -> "${completion.slice(0, 30)}..."`);
        }
    }, [enableAnalytics]);

    // ======== Common Queries Prefetch ========

    const prefetchCommonQueries = useCallback(async (queries: string[]) => {
        for (const query of queries) {
            const cacheKey = `common:${query}`;
            if (!prefetchCache.has(cacheKey)) {
                const result = await executePrefetch(query);
                if (result) {
                    prefetchCache.set(cacheKey, {
                        prediction: result,
                        confidence: 0.8,
                        type: "response",
                        cachedAt: new Date(),
                    });
                }
            }
        }
        setState(s => ({ ...s, predictions: new Map(prefetchCache) }));
    }, []);

    // ======== Stats ========

    const getStats = useCallback(() => {
        const total = state.cacheHits + state.cacheMisses;
        return {
            cacheHits: state.cacheHits,
            cacheMisses: state.cacheMisses,
            hitRate: total > 0 ? state.cacheHits / total : 0,
            cacheSize: prefetchCache.size,
            patternsLearned: patterns.size,
        };
    }, [state.cacheHits, state.cacheMisses]);

    // ======== Cleanup ========

    const clearCache = useCallback(() => {
        prefetchCache.clear();
        setState(s => ({
            ...s,
            predictions: new Map(),
            cacheHits: 0,
            cacheMisses: 0,
        }));
    }, []);

    useEffect(() => {
        return () => {
            if (prefetchTimeout.current) {
                clearTimeout(prefetchTimeout.current);
            }
        };
    }, []);

    return {
        ...state,
        trackInput,
        getPrefetched,
        recordCompletion,
        prefetchCommonQueries,
        getStats,
        clearCache,
    };
}

// ======== Prefetch Executor ========

async function executePrefetch(query: string): Promise<string | null> {
    // In production, this would call the actual API with low priority
    console.log(`[Prefetch] Prefetching: ${query.slice(0, 50)}...`);

    // Simulate API call
    await new Promise(r => setTimeout(r, 50));

    // Return mock result
    return `Prefetched response for: ${query}`;
}

export default usePredictivePrefetch;
