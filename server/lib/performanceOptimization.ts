/**
 * Memory and Performance Optimization
 * Task 23: Optimizar memory footprint del server bundle
 * Task 24: Sistema de garbage collection tuning
 * Task 26: Connection keep-alive optimizado
 * Task 29: Event loop blocking detection
 */

import { Logger } from './logger';
import { EventEmitter } from 'events';

// ============================================================================
// Task 23: Memory Footprint Management
// ============================================================================

interface MemoryStats {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
    arrayBuffers: number;
    utilizationPercent: number;
}

interface MemoryThresholds {
    warningPercent: number;
    criticalPercent: number;
    maxHeapMB: number;
}

class MemoryMonitor extends EventEmitter {
    private thresholds: MemoryThresholds;
    private checkInterval: NodeJS.Timeout | null = null;
    private lastWarning = 0;
    private warningCooldownMs = 60000; // 1 minute between warnings

    constructor(thresholds: Partial<MemoryThresholds> = {}) {
        super();
        this.thresholds = {
            warningPercent: thresholds.warningPercent ?? 80,
            criticalPercent: thresholds.criticalPercent ?? 95,
            maxHeapMB: thresholds.maxHeapMB ?? 1024,
        };
    }

    start(intervalMs: number = 30000): void {
        if (this.checkInterval) return;

        this.checkInterval = setInterval(() => {
            this.check();
        }, intervalMs);
        this.checkInterval.unref();

        Logger.info('[Memory] Monitor started');
    }

    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    getStats(): MemoryStats {
        const mem = process.memoryUsage();
        return {
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            external: mem.external,
            rss: mem.rss,
            arrayBuffers: mem.arrayBuffers,
            utilizationPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
        };
    }

    private check(): void {
        const stats = this.getStats();
        const heapMB = stats.heapUsed / 1024 / 1024;
        const now = Date.now();

        if (stats.utilizationPercent >= this.thresholds.criticalPercent) {
            Logger.error(`[Memory] CRITICAL: ${stats.utilizationPercent}% heap utilization (${Math.round(heapMB)}MB)`);
            this.emit('critical', stats);

            // Force GC if available
            if (global.gc) {
                Logger.warn('[Memory] Forcing garbage collection');
                global.gc();
            }
        } else if (stats.utilizationPercent >= this.thresholds.warningPercent) {
            if (now - this.lastWarning > this.warningCooldownMs) {
                Logger.warn(`[Memory] Warning: ${stats.utilizationPercent}% heap utilization (${Math.round(heapMB)}MB)`);
                this.emit('warning', stats);
                this.lastWarning = now;
            }
        }

        // Check absolute heap size
        if (heapMB > this.thresholds.maxHeapMB) {
            Logger.error(`[Memory] Heap exceeds limit: ${Math.round(heapMB)}MB > ${this.thresholds.maxHeapMB}MB`);
            this.emit('heapLimit', stats);
        }
    }

    forceGC(): boolean {
        if (global.gc) {
            const before = this.getStats();
            global.gc();
            const after = this.getStats();
            const freed = before.heapUsed - after.heapUsed;
            Logger.info(`[Memory] GC freed ${Math.round(freed / 1024 / 1024)}MB`);
            return true;
        }
        return false;
    }
}

export const memoryMonitor = new MemoryMonitor();

// ============================================================================
// Task 24: GC Tuning Recommendations
// ============================================================================

interface GCTuningAdvice {
    recommendation: string;
    nodeFlags: string[];
    reason: string;
}

export function getGCTuningAdvice(): GCTuningAdvice {
    const stats = memoryMonitor.getStats();
    const heapMB = Math.round(stats.heapTotal / 1024 / 1024);

    // Base recommendations
    const nodeFlags: string[] = [];
    let recommendation = '';
    let reason = '';

    if (heapMB < 512) {
        // Small heap - optimize for low latency
        nodeFlags.push('--max-old-space-size=512');
        nodeFlags.push('--optimize-for-size');
        recommendation = 'Small heap optimization';
        reason = 'Heap under 512MB, optimizing for memory efficiency';
    } else if (heapMB < 2048) {
        // Medium heap - balanced
        nodeFlags.push(`--max-old-space-size=${heapMB}`);
        recommendation = 'Balanced GC settings';
        reason = 'Medium heap size, using balanced GC approach';
    } else {
        // Large heap - optimize for throughput
        nodeFlags.push(`--max-old-space-size=${heapMB}`);
        nodeFlags.push('--max-semi-space-size=128');
        recommendation = 'Large heap throughput optimization';
        reason = 'Large heap detected, optimizing for throughput over latency';
    }

    // Always recommend
    nodeFlags.push('--expose-gc'); // Enable manual GC calls

    return { recommendation, nodeFlags, reason };
}

// ============================================================================
// Task 26: Connection Keep-Alive Configuration
// ============================================================================

export interface KeepAliveConfig {
    keepAlive: boolean;
    keepAliveMsecs: number;
    maxSockets: number;
    maxFreeSockets: number;
    timeout: number;
    freeSocketTimeout: number;
}

export const optimizedKeepAliveConfig: KeepAliveConfig = {
    keepAlive: true,
    keepAliveMsecs: 30000,      // Send keep-alive probe every 30s
    maxSockets: 100,            // Max concurrent sockets per host
    maxFreeSockets: 10,         // Max idle sockets to keep
    timeout: 60000,             // Socket timeout 60s
    freeSocketTimeout: 30000,   // Free socket timeout 30s
};

/**
 * Apply keep-alive options to HTTP agent
 */
export function createOptimizedAgent(): import('http').Agent {
    const http = require('http');
    return new http.Agent(optimizedKeepAliveConfig);
}

export function createOptimizedHttpsAgent(): import('https').Agent {
    const https = require('https');
    return new https.Agent(optimizedKeepAliveConfig);
}

// ============================================================================
// Task 29: Event Loop Blocking Detection
// ============================================================================

interface EventLoopLag {
    lagMs: number;
    timestamp: Date;
    severity: 'normal' | 'warning' | 'critical';
}

class EventLoopMonitor extends EventEmitter {
    private checkInterval: NodeJS.Timeout | null = null;
    private lastCheck = process.hrtime.bigint();
    private intervalMs: number;
    private warningThresholdMs: number;
    private criticalThresholdMs: number;
    private recentLags: EventLoopLag[] = [];
    private maxHistorySize = 60;

    constructor(options: {
        intervalMs?: number;
        warningThresholdMs?: number;
        criticalThresholdMs?: number;
    } = {}) {
        super();
        this.intervalMs = options.intervalMs ?? 1000;
        this.warningThresholdMs = options.warningThresholdMs ?? 100;
        this.criticalThresholdMs = options.criticalThresholdMs ?? 500;
    }

    start(): void {
        if (this.checkInterval) return;

        this.lastCheck = process.hrtime.bigint();

        this.checkInterval = setInterval(() => {
            this.measureLag();
        }, this.intervalMs);

        this.checkInterval.unref();
        Logger.info('[EventLoop] Monitor started');
    }

    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    private measureLag(): void {
        const now = process.hrtime.bigint();
        const expectedNs = BigInt(this.intervalMs * 1_000_000);
        const actualNs = now - this.lastCheck;
        const lagNs = actualNs - expectedNs;
        const lagMs = Number(lagNs) / 1_000_000;

        this.lastCheck = now;

        // Only record significant deviations
        if (lagMs > 10) {
            let severity: 'normal' | 'warning' | 'critical' = 'normal';

            if (lagMs >= this.criticalThresholdMs) {
                severity = 'critical';
                Logger.error(`[EventLoop] CRITICAL lag: ${Math.round(lagMs)}ms`);
                this.emit('critical', { lagMs });
            } else if (lagMs >= this.warningThresholdMs) {
                severity = 'warning';
                Logger.warn(`[EventLoop] Warning lag: ${Math.round(lagMs)}ms`);
                this.emit('warning', { lagMs });
            }

            this.recentLags.push({
                lagMs,
                timestamp: new Date(),
                severity,
            });

            // Keep history bounded
            if (this.recentLags.length > this.maxHistorySize) {
                this.recentLags.shift();
            }
        }
    }

    getStats(): {
        recentLags: EventLoopLag[];
        averageLagMs: number;
        maxLagMs: number;
        blockingEvents: number;
    } {
        const lags = this.recentLags;
        const blockingEvents = lags.filter(l => l.severity !== 'normal').length;

        return {
            recentLags: lags.slice(-10),
            averageLagMs: lags.length > 0
                ? Math.round(lags.reduce((sum, l) => sum + l.lagMs, 0) / lags.length)
                : 0,
            maxLagMs: lags.length > 0
                ? Math.round(Math.max(...lags.map(l => l.lagMs)))
                : 0,
            blockingEvents,
        };
    }

    /**
     * Detect potential blocking operations
     */
    wrapSync<T>(fn: () => T, operationName: string): T {
        const start = process.hrtime.bigint();
        const result = fn();
        const durationNs = process.hrtime.bigint() - start;
        const durationMs = Number(durationNs) / 1_000_000;

        if (durationMs > 50) {
            Logger.warn(`[EventLoop] Blocking operation '${operationName}' took ${Math.round(durationMs)}ms`);
            this.emit('blockingOperation', { operationName, durationMs });
        }

        return result;
    }
}

export const eventLoopMonitor = new EventLoopMonitor();

// ============================================================================
// Unified Performance Monitor
// ============================================================================

export function startPerformanceMonitoring(): void {
    memoryMonitor.start(30000);
    eventLoopMonitor.start();

    // Register event handlers
    memoryMonitor.on('critical', (stats) => {
        Logger.error('[Performance] Memory critical - initiating emergency measures');
    });

    eventLoopMonitor.on('critical', ({ lagMs }) => {
        Logger.error(`[Performance] Event loop blocked for ${lagMs}ms`);
    });

    Logger.info('[Performance] All performance monitors started');
}

export function stopPerformanceMonitoring(): void {
    memoryMonitor.stop();
    eventLoopMonitor.stop();
    Logger.info('[Performance] All performance monitors stopped');
}

export function getPerformanceSnapshot(): {
    memory: MemoryStats;
    eventLoop: ReturnType<typeof eventLoopMonitor.getStats>;
    gcAdvice: GCTuningAdvice;
} {
    return {
        memory: memoryMonitor.getStats(),
        eventLoop: eventLoopMonitor.getStats(),
        gcAdvice: getGCTuningAdvice(),
    };
}

// ============================================================================
// Exports
// ============================================================================

export { MemoryMonitor, EventLoopMonitor };
export type { MemoryStats, MemoryThresholds, EventLoopLag };
