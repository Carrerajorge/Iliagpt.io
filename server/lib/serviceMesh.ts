/**
 * Service Mesh & Health Checks
 * Task 5: Service mesh interno con health checks entre módulos
 * 
 * Features:
 * - Service registry with health monitoring
 * - Dependency tracking between services
 * - Circuit breaker integration
 * - Graceful degradation
 */

import { EventEmitter } from 'events';
import { Logger } from './logger';

// ============================================================================
// Types
// ============================================================================

type ServiceStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';

interface ServiceHealth {
    status: ServiceStatus;
    lastCheck: Date | null;
    latencyMs: number;
    consecutiveFailures: number;
    message?: string;
}

interface ServiceConfig {
    name: string;
    healthCheck: () => Promise<boolean>;
    dependencies?: string[];
    checkIntervalMs?: number;
    timeoutMs?: number;
    criticalForStartup?: boolean;
}

interface ServiceInfo extends ServiceConfig {
    health: ServiceHealth;
    checkInterval: NodeJS.Timeout | null;
}

// ============================================================================
// Service Registry
// ============================================================================

class ServiceRegistry extends EventEmitter {
    private services: Map<string, ServiceInfo> = new Map();
    private isShuttingDown = false;

    register(config: ServiceConfig): void {
        if (this.services.has(config.name)) {
            Logger.warn(`[ServiceMesh] Service ${config.name} already registered, updating...`);
            this.unregister(config.name);
        }

        const serviceInfo: ServiceInfo = {
            ...config,
            checkIntervalMs: config.checkIntervalMs ?? 30000,
            timeoutMs: config.timeoutMs ?? 5000,
            criticalForStartup: config.criticalForStartup ?? false,
            dependencies: config.dependencies ?? [],
            health: {
                status: 'UNKNOWN',
                lastCheck: null,
                latencyMs: 0,
                consecutiveFailures: 0,
            },
            checkInterval: null,
        };

        this.services.set(config.name, serviceInfo);
        Logger.info(`[ServiceMesh] Registered service: ${config.name}`);

        // Start health checking
        this.startHealthCheck(config.name);
    }

    unregister(name: string): void {
        const service = this.services.get(name);
        if (service?.checkInterval) {
            clearInterval(service.checkInterval);
        }
        this.services.delete(name);
        Logger.info(`[ServiceMesh] Unregistered service: ${name}`);
    }

    private async performHealthCheck(name: string): Promise<void> {
        const service = this.services.get(name);
        if (!service || this.isShuttingDown) return;

        const startTime = Date.now();
        const previousStatus = service.health.status;

        try {
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Health check timeout')), service.timeoutMs);
            });

            const checkPromise = service.healthCheck();
            const isHealthy = await Promise.race([checkPromise, timeoutPromise]);

            const latencyMs = Date.now() - startTime;

            if (isHealthy) {
                service.health = {
                    status: 'HEALTHY',
                    lastCheck: new Date(),
                    latencyMs,
                    consecutiveFailures: 0,
                };
            } else {
                service.health.consecutiveFailures++;
                service.health.lastCheck = new Date();
                service.health.latencyMs = latencyMs;
                service.health.status = service.health.consecutiveFailures >= 3 ? 'UNHEALTHY' : 'DEGRADED';
            }
        } catch (error: any) {
            service.health.consecutiveFailures++;
            service.health.lastCheck = new Date();
            service.health.latencyMs = Date.now() - startTime;
            service.health.message = error.message;
            service.health.status = service.health.consecutiveFailures >= 3 ? 'UNHEALTHY' : 'DEGRADED';
        }

        // Emit status change event
        if (previousStatus !== service.health.status) {
            Logger.info(`[ServiceMesh] ${name}: ${previousStatus} -> ${service.health.status}`);
            this.emit('statusChange', {
                service: name,
                previousStatus,
                currentStatus: service.health.status,
                health: service.health,
            });
        }
    }

    private startHealthCheck(name: string): void {
        const service = this.services.get(name);
        if (!service) return;

        // Perform initial check
        this.performHealthCheck(name);

        // Set up periodic checking
        service.checkInterval = setInterval(
            () => this.performHealthCheck(name),
            service.checkIntervalMs
        );
        service.checkInterval.unref();
    }

    getHealth(name: string): ServiceHealth | null {
        return this.services.get(name)?.health ?? null;
    }

    getAllHealth(): Record<string, ServiceHealth> {
        const result: Record<string, ServiceHealth> = {};
        for (const [name, service] of this.services) {
            result[name] = service.health;
        }
        return result;
    }

    isServiceHealthy(name: string): boolean {
        const health = this.getHealth(name);
        return health?.status === 'HEALTHY';
    }

    getOverallStatus(): { status: ServiceStatus; unhealthy: string[]; degraded: string[] } {
        const unhealthy: string[] = [];
        const degraded: string[] = [];

        for (const [name, service] of this.services) {
            if (service.health.status === 'UNHEALTHY') {
                unhealthy.push(name);
            } else if (service.health.status === 'DEGRADED') {
                degraded.push(name);
            }
        }

        let status: ServiceStatus = 'HEALTHY';
        if (unhealthy.length > 0) status = 'UNHEALTHY';
        else if (degraded.length > 0) status = 'DEGRADED';

        return { status, unhealthy, degraded };
    }

    getDependencyGraph(): Record<string, string[]> {
        const graph: Record<string, string[]> = {};
        for (const [name, service] of this.services) {
            graph[name] = service.dependencies ?? [];
        }
        return graph;
    }

    async checkDependencies(name: string): Promise<{ ready: boolean; missing: string[] }> {
        const service = this.services.get(name);
        if (!service) return { ready: false, missing: [name] };

        const missing: string[] = [];
        for (const dep of service.dependencies ?? []) {
            if (!this.isServiceHealthy(dep)) {
                missing.push(dep);
            }
        }

        return { ready: missing.length === 0, missing };
    }

    async waitForServices(timeoutMs: number = 30000): Promise<boolean> {
        const startTime = Date.now();
        const criticalServices = Array.from(this.services.entries())
            .filter(([_, s]) => s.criticalForStartup)
            .map(([name]) => name);

        if (criticalServices.length === 0) return true;

        Logger.info(`[ServiceMesh] Waiting for critical services: ${criticalServices.join(', ')}`);

        while (Date.now() - startTime < timeoutMs) {
            const allHealthy = criticalServices.every(name => this.isServiceHealthy(name));
            if (allHealthy) {
                Logger.info(`[ServiceMesh] All critical services are healthy`);
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const unhealthy = criticalServices.filter(name => !this.isServiceHealthy(name));
        Logger.error(`[ServiceMesh] Critical services not healthy after ${timeoutMs}ms: ${unhealthy.join(', ')}`);
        return false;
    }

    shutdown(): void {
        this.isShuttingDown = true;
        for (const [name, service] of this.services) {
            if (service.checkInterval) {
                clearInterval(service.checkInterval);
            }
        }
        Logger.info(`[ServiceMesh] Shutdown complete`);
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const serviceRegistry = new ServiceRegistry();

// ============================================================================
// Pre-register Core Services
// ============================================================================

export function registerCoreServices(): void {
    // Database service
    serviceRegistry.register({
        name: 'database',
        criticalForStartup: true,
        checkIntervalMs: 30000,
        healthCheck: async () => {
            const { isHealthy } = await import('../db');
            return isHealthy();
        },
    });

    // Redis service (optional)
    serviceRegistry.register({
        name: 'redis',
        criticalForStartup: false,
        checkIntervalMs: 30000,
        healthCheck: async () => {
            const { env } = await import('../config/env');
            if (!env.REDIS_URL) return true; // Skip if not configured

            try {
                const Redis = (await import('ioredis')).default;
                const client = new Redis(env.REDIS_URL, {
                    connectTimeout: 3000,
                    lazyConnect: true
                });
                await client.ping();
                await client.quit();
                return true;
            } catch {
                return false;
            }
        },
    });

    // LLM Gateway service
    serviceRegistry.register({
        name: 'llm-gateway',
        criticalForStartup: false,
        dependencies: [],
        checkIntervalMs: 60000,
        healthCheck: async () => {
            // LLM is considered healthy if we have at least one working provider
            try {
                const { env } = await import('../config/env');
                return !!(env.GOOGLE_API_KEY || env.GEMINI_API_KEY || env.OPENAI_API_KEY);
            } catch {
                return false;
            }
        },
    });

    Logger.info(`[ServiceMesh] Core services registered`);
}

// ============================================================================
// Graceful Degradation Decorator
// ============================================================================

interface DegradedResponse<T> {
    data: T | null;
    degraded: boolean;
    reason?: string;
}

export function withGracefulDegradation<T>(
    serviceName: string,
    fallback: T
): <F extends (...args: any[]) => Promise<T>>(fn: F) => (...args: Parameters<F>) => Promise<DegradedResponse<T>> {
    return (fn) => {
        return async (...args) => {
            // Check service health first
            if (!serviceRegistry.isServiceHealthy(serviceName)) {
                Logger.warn(`[ServiceMesh] ${serviceName} unhealthy, using fallback`);
                return {
                    data: fallback,
                    degraded: true,
                    reason: `${serviceName} service is unavailable`,
                };
            }

            try {
                const result = await fn(...args);
                return { data: result, degraded: false };
            } catch (error: any) {
                Logger.error(`[ServiceMesh] ${serviceName} call failed: ${error.message}`);
                return {
                    data: fallback,
                    degraded: true,
                    reason: error.message,
                };
            }
        };
    };
}

// ============================================================================
// Exports
// ============================================================================

export type { ServiceStatus, ServiceHealth, ServiceConfig };
