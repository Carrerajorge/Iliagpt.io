import { useEffect, useRef, useCallback } from "react";
import { chatLogger } from "@/lib/logger";

interface PerformanceMetrics {
  componentName: string;
  mountTime: number;
  renderCount: number;
  lastRenderTime: number;
  totalRenderTime: number;
  avgRenderTime: number;
}

interface UseComponentPerformanceOptions {
  componentName: string;
  logOnUnmount?: boolean;
  logThreshold?: number; // ms, log warning if render time exceeds this
}

export function useComponentPerformance({
  componentName,
  logOnUnmount = true,
  logThreshold = 100,
}: UseComponentPerformanceOptions): void {
  const metricsRef = useRef<PerformanceMetrics>({
    componentName,
    mountTime: performance.now(),
    renderCount: 0,
    lastRenderTime: 0,
    totalRenderTime: 0,
    avgRenderTime: 0,
  });
  const renderStartTime = useRef<number>(0);

  // Start timing before render
  renderStartTime.current = performance.now();

  useEffect(() => {
    const metrics = metricsRef.current;
    const renderTime = performance.now() - renderStartTime.current;

    metrics.renderCount++;
    metrics.lastRenderTime = renderTime;
    metrics.totalRenderTime += renderTime;
    metrics.avgRenderTime = metrics.totalRenderTime / metrics.renderCount;

    // Log warning if render is slow
    if (renderTime > logThreshold) {
      chatLogger.warn(`Slow render detected in ${componentName}`, {
        renderTime: `${renderTime.toFixed(2)}ms`,
        renderCount: metrics.renderCount,
        avgRenderTime: `${metrics.avgRenderTime.toFixed(2)}ms`,
      });
    }
  });

  useEffect(() => {
    return () => {
      if (logOnUnmount) {
        const metrics = metricsRef.current;
        const lifetime = performance.now() - metrics.mountTime;

        chatLogger.info(`Component ${componentName} unmounted`, {
          lifetime: `${lifetime.toFixed(2)}ms`,
          renderCount: metrics.renderCount,
          avgRenderTime: `${metrics.avgRenderTime.toFixed(2)}ms`,
          totalRenderTime: `${metrics.totalRenderTime.toFixed(2)}ms`,
        });
      }
    };
  }, [componentName, logOnUnmount]);
}

// Hook to measure expensive operations
export function usePerformanceTimer(operationName: string) {
  const startTimeRef = useRef<number | null>(null);

  const start = useCallback(() => {
    startTimeRef.current = performance.now();
  }, []);

  const end = useCallback(() => {
    if (startTimeRef.current === null) {
      chatLogger.warn(`Performance timer ended without starting: ${operationName}`);
      return 0;
    }

    const duration = performance.now() - startTimeRef.current;
    chatLogger.debug(`Operation ${operationName} completed`, {
      duration: `${duration.toFixed(2)}ms`,
    });

    startTimeRef.current = null;
    return duration;
  }, [operationName]);

  return { start, end };
}

// Utility to measure function execution time
export function measurePerformance<T extends (...args: any[]) => any>(
  fn: T,
  fnName: string
): (...args: Parameters<T>) => ReturnType<T> {
  return (...args: Parameters<T>): ReturnType<T> => {
    const start = performance.now();
    const result = fn(...args);

    // Handle promises
    if (result instanceof Promise) {
      return result.finally(() => {
        const duration = performance.now() - start;
        chatLogger.debug(`Async function ${fnName} completed`, {
          duration: `${duration.toFixed(2)}ms`,
        });
      }) as ReturnType<T>;
    }

    const duration = performance.now() - start;
    chatLogger.debug(`Function ${fnName} completed`, {
      duration: `${duration.toFixed(2)}ms`,
    });

    return result;
  };
}

// Report Web Vitals
export function reportWebVitals(): void {
  if (typeof window === "undefined" || !("performance" in window)) return;

  // LCP (Largest Contentful Paint)
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const lastEntry = entries[entries.length - 1];
    chatLogger.info("LCP measured", {
      value: lastEntry.startTime,
      element: (lastEntry as any).element?.tagName,
    });
  }).observe({ entryTypes: ["largest-contentful-paint"] });

  // FID (First Input Delay)
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const delay = (entry as any).processingStart - entry.startTime;
      chatLogger.info("FID measured", {
        value: delay,
        element: (entry as any).target?.tagName,
      });
    }
  }).observe({ entryTypes: ["first-input"] });

  // CLS (Cumulative Layout Shift)
  let clsValue = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!(entry as any).hadRecentInput) {
        clsValue += (entry as any).value;
      }
    }
    chatLogger.info("CLS updated", { value: clsValue });
  }).observe({ entryTypes: ["layout-shift"] });

  // FCP (First Contentful Paint)
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const fcp = entries[entries.length - 1];
    chatLogger.info("FCP measured", { value: fcp.startTime });
  }).observe({ entryTypes: ["paint"] });
}
