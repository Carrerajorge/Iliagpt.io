/**
 * Startup and Shutdown Optimization
 * Task 16: Lazy loading de módulos pesados
 * Task 17: Optimizar startup time con eager loading selectivo
 * Task 18: Sistema de warmup para caches críticos
 * Task 19: Graceful shutdown con drain de conexiones
 * Task 20: Timeout chains para operaciones dependientes
 */

import { Logger } from './logger';
import { EventEmitter } from 'events';

// ============================================================================
// Task 16 & 17: Module Loading Optimization
// ============================================================================

type ModuleLoader<T> = () => Promise<T>;

interface LazyModuleConfig {
    name: string;
    loader: ModuleLoader<any>;
    preload?: boolean;      // Load during startup (eager)
    critical?: boolean;     // Required for app to function
    timeout?: number;       // Max time to wait for load
}

class ModuleRegistry {
    private modules: Map<string, {
        config: LazyModuleConfig;
        instance: any;
        loaded: boolean;
        loading: Promise<any> | null;
        loadTime?: number;
    }> = new Map();

    register(config: LazyModuleConfig): void {
        this.modules.set(config.name, {
            config,
            instance: null,
            loaded: false,
            loading: null,
        });
    }

    async get<T>(name: string): Promise<T> {
        const module = this.modules.get(name);
        if (!module) {
            throw new Error(`Module ${name} not registered`);
        }

        if (module.loaded) {
            return module.instance as T;
        }

        if (module.loading) {
            return module.loading as Promise<T>;
        }

        const startTime = Date.now();
        module.loading = this.loadWithTimeout(module.config);

        try {
            module.instance = await module.loading;
            module.loaded = true;
            module.loadTime = Date.now() - startTime;
            Logger.info(`[ModuleRegistry] Loaded ${name} in ${module.loadTime}ms`);
            return module.instance as T;
        } finally {
            module.loading = null;
        }
    }

    private async loadWithTimeout(config: LazyModuleConfig): Promise<any> {
        const timeout = config.timeout ?? 30000;

        return Promise.race([
            config.loader(),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Module ${config.name} load timeout`)), timeout);
            }),
        ]);
    }

    async preloadAll(): Promise<{ loaded: string[]; failed: string[] }> {
        const loaded: string[] = [];
        const failed: string[] = [];

        const preloadModules = Array.from(this.modules.entries())
            .filter(([_, m]) => m.config.preload);

        await Promise.all(
            preloadModules.map(async ([name, _]) => {
                try {
                    await this.get(name);
                    loaded.push(name);
                } catch (error: any) {
                    Logger.error(`[ModuleRegistry] Failed to preload ${name}: ${error.message}`);
                    failed.push(name);
                }
            })
        );

        return { loaded, failed };
    }

    getStats(): Array<{ name: string; loaded: boolean; loadTime?: number }> {
        return Array.from(this.modules.entries()).map(([name, m]) => ({
            name,
            loaded: m.loaded,
            loadTime: m.loadTime,
        }));
    }
}

export const moduleRegistry = new ModuleRegistry();

// ============================================================================
// Task 18: Cache Warmup System
// ============================================================================

interface WarmupTask {
    name: string;
    priority: number;          // Higher = run first
    warmup: () => Promise<void>;
    critical?: boolean;        // Must complete for startup
    timeout?: number;
}

class CacheWarmer extends EventEmitter {
    private tasks: WarmupTask[] = [];
    private completed: Set<string> = new Set();
    private failed: Set<string> = new Set();

    register(task: WarmupTask): void {
        this.tasks.push(task);
        this.tasks.sort((a, b) => b.priority - a.priority);
    }

    async warmAll(): Promise<{
        completed: string[];
        failed: string[];
        totalTime: number
    }> {
        const startTime = Date.now();
        Logger.info(`[CacheWarmer] Starting warmup of ${this.tasks.length} caches`);

        // Group by priority for parallel execution within priority level
        const priorityGroups = new Map<number, WarmupTask[]>();
        for (const task of this.tasks) {
            const group = priorityGroups.get(task.priority) || [];
            group.push(task);
            priorityGroups.set(task.priority, group);
        }

        // Execute groups in priority order
        const sortedPriorities = Array.from(priorityGroups.keys()).sort((a, b) => b - a);

        for (const priority of sortedPriorities) {
            const group = priorityGroups.get(priority)!;
            await Promise.all(group.map(task => this.executeTask(task)));
        }

        const totalTime = Date.now() - startTime;
        Logger.info(`[CacheWarmer] Warmup complete in ${totalTime}ms (${this.completed.size} success, ${this.failed.size} failed)`);

        return {
            completed: Array.from(this.completed),
            failed: Array.from(this.failed),
            totalTime,
        };
    }

    private async executeTask(task: WarmupTask): Promise<void> {
        const taskStart = Date.now();
        const timeout = task.timeout ?? 30000;

        try {
            await Promise.race([
                task.warmup(),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Warmup timeout')), timeout);
                }),
            ]);

            this.completed.add(task.name);
            this.emit('taskComplete', { name: task.name, duration: Date.now() - taskStart });
            Logger.debug(`[CacheWarmer] ${task.name} warmed in ${Date.now() - taskStart}ms`);
        } catch (error: any) {
            this.failed.add(task.name);
            this.emit('taskFailed', { name: task.name, error: error.message });

            if (task.critical) {
                throw new Error(`Critical warmup task ${task.name} failed: ${error.message}`);
            }
            Logger.warn(`[CacheWarmer] ${task.name} warmup failed: ${error.message}`);
        }
    }
}

export const cacheWarmer = new CacheWarmer();

// ============================================================================
// Task 19: Graceful Shutdown
// ============================================================================

type ShutdownHandler = () => Promise<void>;

interface ShutdownConfig {
    timeout: number;           // Max time for all handlers
    forceExitDelay: number;    // Time to wait before force exit
}

class GracefulShutdown extends EventEmitter {
    private handlers: Array<{ name: string; handler: ShutdownHandler; priority: number }> = [];
    private isShuttingDown = false;
    private config: ShutdownConfig;

    constructor(config: Partial<ShutdownConfig> = {}) {
        super();
        this.config = {
            timeout: config.timeout ?? 30000,
            forceExitDelay: config.forceExitDelay ?? 5000,
        };

        // Register signal handlers
        process.on('SIGTERM', () => this.shutdown('SIGTERM'));
        process.on('SIGINT', () => this.shutdown('SIGINT'));
        process.on('SIGUSR2', () => this.shutdown('SIGUSR2')); // Nodemon restart
    }

    register(name: string, handler: ShutdownHandler, priority: number = 0): void {
        this.handlers.push({ name, handler, priority });
        this.handlers.sort((a, b) => b.priority - a.priority);
        Logger.debug(`[Shutdown] Registered handler: ${name} (priority: ${priority})`);
    }

    async shutdown(signal?: string): Promise<void> {
        if (this.isShuttingDown) {
            Logger.warn(`[Shutdown] Already shutting down, ignoring ${signal}`);
            return;
        }

        this.isShuttingDown = true;
        Logger.info(`[Shutdown] Graceful shutdown initiated${signal ? ` (${signal})` : ''}`);
        this.emit('start', { signal });

        const startTime = Date.now();

        // Set force exit timer
        const forceExitTimer = setTimeout(() => {
            Logger.error(`[Shutdown] Force exit after ${this.config.timeout + this.config.forceExitDelay}ms`);
            process.exit(1);
        }, this.config.timeout + this.config.forceExitDelay);

        try {
            // Execute handlers with overall timeout
            await Promise.race([
                this.executeHandlers(),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Shutdown timeout')), this.config.timeout);
                }),
            ]);

            const duration = Date.now() - startTime;
            Logger.info(`[Shutdown] Clean shutdown completed in ${duration}ms`);
            this.emit('complete', { duration });
        } catch (error: any) {
            Logger.error(`[Shutdown] Error during shutdown: ${error.message}`);
            this.emit('error', { error });
        } finally {
            clearTimeout(forceExitTimer);
            process.exit(0);
        }
    }

    private async executeHandlers(): Promise<void> {
        for (const { name, handler } of this.handlers) {
            try {
                Logger.debug(`[Shutdown] Executing: ${name}`);
                await handler();
                Logger.debug(`[Shutdown] Completed: ${name}`);
            } catch (error: any) {
                Logger.error(`[Shutdown] Handler ${name} failed: ${error.message}`);
                // Continue with other handlers
            }
        }
    }

    isInProgress(): boolean {
        return this.isShuttingDown;
    }
}

export const gracefulShutdown = new GracefulShutdown();

// ============================================================================
// Task 20: Timeout Chains for Dependent Operations
// ============================================================================

interface TimeoutChainStep<T> {
    name: string;
    execute: () => Promise<T>;
    timeout: number;
    fallback?: () => T;
    retries?: number;
}

interface ChainResult<T> {
    success: boolean;
    results: Map<string, T>;
    errors: Map<string, Error>;
    totalDuration: number;
}

class TimeoutChain<T = any> {
    private steps: TimeoutChainStep<T>[] = [];
    private totalTimeout: number;

    constructor(totalTimeout: number) {
        this.totalTimeout = totalTimeout;
    }

    add(step: TimeoutChainStep<T>): this {
        this.steps.push(step);
        return this;
    }

    async execute(): Promise<ChainResult<T>> {
        const startTime = Date.now();
        const results = new Map<string, T>();
        const errors = new Map<string, Error>();
        let remainingTime = this.totalTimeout;

        for (const step of this.steps) {
            if (remainingTime <= 0) {
                errors.set(step.name, new Error('Chain timeout exceeded'));
                continue;
            }

            const stepTimeout = Math.min(step.timeout, remainingTime);
            const stepStart = Date.now();

            try {
                const result = await this.executeStep(step, stepTimeout);
                results.set(step.name, result);
            } catch (error: any) {
                errors.set(step.name, error);

                if (step.fallback) {
                    try {
                        results.set(step.name, step.fallback());
                    } catch (fallbackError: any) {
                        errors.set(`${step.name}_fallback`, fallbackError);
                    }
                }
            }

            remainingTime -= (Date.now() - stepStart);
        }

        return {
            success: errors.size === 0,
            results,
            errors,
            totalDuration: Date.now() - startTime,
        };
    }

    private async executeStep(step: TimeoutChainStep<T>, timeout: number): Promise<T> {
        const retries = step.retries ?? 0;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await Promise.race([
                    step.execute(),
                    new Promise<never>((_, reject) => {
                        setTimeout(() => reject(new Error(`Step ${step.name} timeout`)), timeout);
                    }),
                ]);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
                }
            }
        }

        throw lastError;
    }
}

export function createTimeoutChain<T = any>(totalTimeout: number): TimeoutChain<T> {
    return new TimeoutChain<T>(totalTimeout);
}

// ============================================================================
// Application Startup Orchestrator
// ============================================================================

interface StartupResult {
    success: boolean;
    modules: { loaded: string[]; failed: string[] };
    caches: { completed: string[]; failed: string[] };
    totalTime: number;
}

export async function orchestrateStartup(): Promise<StartupResult> {
    const startTime = Date.now();
    Logger.info('[Startup] Beginning application initialization...');

    // 1. Preload critical modules
    const moduleResult = await moduleRegistry.preloadAll();

    // 2. Warm critical caches
    const cacheResult = await cacheWarmer.warmAll();

    // 3. Register shutdown handlers if not already done
    // (This would be called from index.ts normally)

    const totalTime = Date.now() - startTime;
    const success = moduleResult.failed.length === 0 &&
        cacheResult.failed.filter(n =>
            cacheWarmer['tasks'].find(t => t.name === n)?.critical
        ).length === 0;

    Logger.info(`[Startup] Initialization ${success ? 'complete' : 'completed with warnings'} in ${totalTime}ms`);

    return {
        success,
        modules: moduleResult,
        caches: cacheResult,
        totalTime,
    };
}

// ============================================================================
// Exports
// ============================================================================

export { ModuleRegistry, CacheWarmer, GracefulShutdown, TimeoutChain };
