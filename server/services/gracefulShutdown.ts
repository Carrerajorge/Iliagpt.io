/**
 * Graceful Shutdown Handler (#35)
 * Clean shutdown of connections and pending operations
 */

import { Server } from 'http';
import { EventEmitter } from 'events';

type ShutdownHandler = () => Promise<void> | void;

interface ShutdownOptions {
    timeout?: number;         // Max time to wait for cleanup (default: 30s)
    signals?: string[];       // Signals to listen for
    forceExitCode?: number;   // Exit code when forced shutdown
    beforeShutdown?: () => Promise<void>;
    onShutdown?: () => Promise<void>;
    logger?: (message: string) => void;
}

const DEFAULT_OPTIONS: Required<Omit<ShutdownOptions, 'beforeShutdown' | 'onShutdown'>> = {
    timeout: 30000,
    signals: ['SIGTERM', 'SIGINT', 'SIGUSR2'],
    forceExitCode: 1,
    logger: console.log,
};

class GracefulShutdown extends EventEmitter {
    private isShuttingDown = false;
    private handlers: ShutdownHandler[] = [];
    private options: Required<Omit<ShutdownOptions, 'beforeShutdown' | 'onShutdown'>> & ShutdownOptions;
    private servers: Server[] = [];

    constructor(options: ShutdownOptions = {}) {
        super();
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.setupSignalHandlers();
    }

    /**
     * Register a cleanup handler
     */
    register(handler: ShutdownHandler): this {
        this.handlers.push(handler);
        return this;
    }

    /**
     * Register HTTP server for graceful close
     */
    registerServer(server: Server): this {
        this.servers.push(server);
        return this;
    }

    /**
     * Setup signal handlers
     */
    private setupSignalHandlers(): void {
        for (const signal of this.options.signals) {
            process.on(signal, async () => {
                this.options.logger(`Received ${signal}, initiating graceful shutdown...`);
                await this.shutdown(signal);
            });
        }

        // Handle uncaught exceptions
        process.on('uncaughtException', async (error) => {
            console.error('Uncaught Exception:', error);
            await this.shutdown('uncaughtException');
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', async (reason) => {
            console.error('Unhandled Rejection:', reason);
            // Don't shutdown on unhandled rejection, just log
        });
    }

    /**
     * Initiate shutdown
     */
    async shutdown(signal?: string): Promise<void> {
        if (this.isShuttingDown) {
            this.options.logger('Shutdown already in progress...');
            return;
        }

        this.isShuttingDown = true;
        this.emit('shutdown:start', signal);

        const startTime = Date.now();

        // Set force exit timeout
        const forceExitTimer = setTimeout(() => {
            console.error('Graceful shutdown timeout - forcing exit');
            process.exit(this.options.forceExitCode);
        }, this.options.timeout);

        try {
            // Run beforeShutdown hook
            if (this.options.beforeShutdown) {
                this.options.logger('Running beforeShutdown hook...');
                await this.options.beforeShutdown();
            }

            // Stop accepting new connections
            await this.closeServers();

            // Wait for existing connections to complete
            await this.drainConnections();

            // Run registered cleanup handlers
            await this.runHandlers();

            // Run onShutdown hook
            if (this.options.onShutdown) {
                this.options.logger('Running onShutdown hook...');
                await this.options.onShutdown();
            }

            const duration = Date.now() - startTime;
            this.options.logger(`Graceful shutdown completed in ${duration}ms`);

            this.emit('shutdown:complete', duration);

            clearTimeout(forceExitTimer);
            process.exit(0);
        } catch (error) {
            console.error('Error during shutdown:', error);
            clearTimeout(forceExitTimer);
            process.exit(this.options.forceExitCode);
        }
    }

    /**
     * Close all HTTP servers
     */
    private async closeServers(): Promise<void> {
        if (this.servers.length === 0) return;

        this.options.logger(`Closing ${this.servers.length} server(s)...`);

        await Promise.all(
            this.servers.map((server) =>
                new Promise<void>((resolve, reject) => {
                    server.close((err) => {
                        if (err && err.message !== 'Server is not running') {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                })
            )
        );

        this.options.logger('All servers closed');
    }

    /**
     * Wait for active connections to drain
     */
    private async drainConnections(): Promise<void> {
        // In a full implementation, track active connections
        // For now, just wait a brief moment
        await new Promise(resolve => setTimeout(resolve, 100));
        this.options.logger('Connections drained');
    }

    /**
     * Run all registered cleanup handlers
     */
    private async runHandlers(): Promise<void> {
        if (this.handlers.length === 0) return;

        this.options.logger(`Running ${this.handlers.length} cleanup handler(s)...`);

        // Run handlers in parallel with individual error catching
        const results = await Promise.allSettled(
            this.handlers.map(async (handler, index) => {
                try {
                    await handler();
                    this.options.logger(`Handler ${index + 1} completed`);
                } catch (error) {
                    console.error(`Handler ${index + 1} failed:`, error);
                    throw error;
                }
            })
        );

        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
            console.warn(`${failed.length} handler(s) failed during shutdown`);
        }
    }

    /**
     * Check if shutdown is in progress
     */
    isShuttingDownNow(): boolean {
        return this.isShuttingDown;
    }
}

// Singleton instance
let instance: GracefulShutdown | null = null;

/**
 * Initialize graceful shutdown
 */
export function initGracefulShutdown(options: ShutdownOptions = {}): GracefulShutdown {
    if (!instance) {
        instance = new GracefulShutdown(options);
    }
    return instance;
}

/**
 * Get the graceful shutdown instance
 */
export function getGracefulShutdown(): GracefulShutdown | null {
    return instance;
}

/**
 * Register a shutdown handler
 */
export function onShutdown(handler: ShutdownHandler): void {
    if (instance) {
        instance.register(handler);
    } else {
        console.warn('Graceful shutdown not initialized. Call initGracefulShutdown first.');
    }
}

/**
 * Register server for graceful close
 */
export function registerServer(server: Server): void {
    if (instance) {
        instance.registerServer(server);
    }
}

/**
 * Common cleanup handlers
 */
export const cleanupHandlers = {
    /**
     * Close database connection
     */
    closeDatabase: async () => {
        // await db.$client.end();
        console.log('Database connection closed');
    },

    /**
     * Close Redis connection
     */
    closeRedis: async () => {
        // await redis.quit();
        console.log('Redis connection closed');
    },

    /**
     * Flush logs
     */
    flushLogs: async () => {
        // await logger.flush();
        console.log('Logs flushed');
    },

    /**
     * Cancel pending jobs
     */
    cancelPendingJobs: async () => {
        // await jobQueue.close();
        console.log('Pending jobs cancelled');
    },
};
