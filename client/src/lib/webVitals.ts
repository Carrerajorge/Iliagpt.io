/**
 * Web Vitals Tracker
 * 
 * Monitors Core Web Vitals:
 * - LCP (Largest Contentful Paint)
 * - FID (First Input Delay)
 * - CLS (Cumulative Layout Shift)
 * - FCP (First Contentful Paint)
 * - TTFB (Time to First Byte)
 */

interface WebVitalMetric {
    name: string;
    value: number;
    rating: 'good' | 'needs-improvement' | 'poor';
    delta: number;
    id: string;
}

type WebVitalCallback = (metric: WebVitalMetric) => void;

// Thresholds for Core Web Vitals (based on Google's recommendations)
const THRESHOLDS = {
    LCP: { good: 2500, poor: 4000 },
    FID: { good: 100, poor: 300 },
    CLS: { good: 0.1, poor: 0.25 },
    FCP: { good: 1800, poor: 3000 },
    TTFB: { good: 800, poor: 1800 },
    INP: { good: 200, poor: 500 },
};

function getRating(name: string, value: number): WebVitalMetric['rating'] {
    const threshold = THRESHOLDS[name as keyof typeof THRESHOLDS];
    if (!threshold) return 'good';

    if (value <= threshold.good) return 'good';
    if (value <= threshold.poor) return 'needs-improvement';
    return 'poor';
}

// Buffer to collect metrics
const metricsBuffer: WebVitalMetric[] = [];
const listeners: WebVitalCallback[] = [];

function reportMetric(metric: WebVitalMetric): void {
    metricsBuffer.push(metric);

    // Notify all listeners
    for (const listener of listeners) {
        listener(metric);
    }

    // Log in development
    if (import.meta.env.DEV) {
        const emoji = metric.rating === 'good' ? '✅' :
            metric.rating === 'needs-improvement' ? '⚠️' : '❌';
        console.log(
            `${emoji} [WebVitals] ${metric.name}: ${metric.value.toFixed(2)} (${metric.rating})`
        );
    }
}

/**
 * Initialize Web Vitals tracking
 */
export async function initWebVitals(): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
        // Use Performance Observer API
        if ('PerformanceObserver' in window) {
            // LCP
            const lcpObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                const lastEntry = entries[entries.length - 1];
                if (lastEntry) {
                    reportMetric({
                        name: 'LCP',
                        value: lastEntry.startTime,
                        rating: getRating('LCP', lastEntry.startTime),
                        delta: lastEntry.startTime,
                        id: `lcp-${Date.now()}`,
                    });
                }
            });
            lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });

            // FCP
            const fcpObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                const fcpEntry = entries.find(e => e.name === 'first-contentful-paint');
                if (fcpEntry) {
                    reportMetric({
                        name: 'FCP',
                        value: fcpEntry.startTime,
                        rating: getRating('FCP', fcpEntry.startTime),
                        delta: fcpEntry.startTime,
                        id: `fcp-${Date.now()}`,
                    });
                }
            });
            fcpObserver.observe({ type: 'paint', buffered: true });

            // CLS
            let clsValue = 0;
            const clsObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (!(entry as any).hadRecentInput) {
                        clsValue += (entry as any).value;
                    }
                }
                reportMetric({
                    name: 'CLS',
                    value: clsValue,
                    rating: getRating('CLS', clsValue),
                    delta: clsValue,
                    id: `cls-${Date.now()}`,
                });
            });
            clsObserver.observe({ type: 'layout-shift', buffered: true });

            // FID / INP
            const fidObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                const firstEntry = entries[0];
                if (firstEntry) {
                    const value = (firstEntry as any).processingStart - firstEntry.startTime;
                    reportMetric({
                        name: 'FID',
                        value,
                        rating: getRating('FID', value),
                        delta: value,
                        id: `fid-${Date.now()}`,
                    });
                }
            });
            fidObserver.observe({ type: 'first-input', buffered: true });
        }

        // TTFB from Navigation Timing
        if ('performance' in window && 'getEntriesByType' in performance) {
            const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
            if (navEntries.length > 0) {
                const ttfb = navEntries[0].responseStart - navEntries[0].requestStart;
                reportMetric({
                    name: 'TTFB',
                    value: ttfb,
                    rating: getRating('TTFB', ttfb),
                    delta: ttfb,
                    id: `ttfb-${Date.now()}`,
                });
            }
        }
    } catch (error) {
        console.warn('[WebVitals] Failed to initialize:', error);
    }
}

/**
 * Subscribe to Web Vitals metrics
 */
export function onWebVital(callback: WebVitalCallback): () => void {
    listeners.push(callback);

    // Send buffered metrics
    for (const metric of metricsBuffer) {
        callback(metric);
    }

    // Return unsubscribe function
    return () => {
        const index = listeners.indexOf(callback);
        if (index > -1) {
            listeners.splice(index, 1);
        }
    };
}

/**
 * Get all collected metrics
 */
export function getMetrics(): WebVitalMetric[] {
    return [...metricsBuffer];
}

/**
 * Get summary of metrics
 */
export function getMetricsSummary(): Record<string, { value: number; rating: WebVitalMetric['rating'] }> {
    const summary: Record<string, { value: number; rating: WebVitalMetric['rating'] }> = {};

    for (const metric of metricsBuffer) {
        summary[metric.name] = {
            value: metric.value,
            rating: metric.rating,
        };
    }

    return summary;
}

/**
 * Send metrics to analytics endpoint
 */
export async function reportToAnalytics(endpoint: string): Promise<void> {
    if (metricsBuffer.length === 0) return;

    try {
        await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                metrics: metricsBuffer,
                timestamp: Date.now(),
                url: window.location.href,
                userAgent: navigator.userAgent,
            }),
            keepalive: true, // Allow request to complete even if page unloads
        });
    } catch (error) {
        console.warn('[WebVitals] Failed to report metrics:', error);
    }
}
