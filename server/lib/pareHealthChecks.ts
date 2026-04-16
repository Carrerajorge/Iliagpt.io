/**
 * PARE Health Checks - Kubernetes readiness/liveness probes
 * 
 * Provides health check endpoints for Kubernetes orchestration:
 * - LIVENESS: Is the process alive? (fast, just returns OK)
 * - READINESS: Can the service handle requests? (checks dependencies)
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { getWorkerPool } from './parserSandbox';
import { getAllCircuitBreakers, CircuitState } from '../utils/circuitBreaker';

const APP_VERSION = process.env.npm_package_version || '1.0.0';
const startTime = Date.now();
const HEALTH_CHECK_TIMEOUT_MS = 5000;

export interface CheckDetail {
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  duration_ms: number;
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    [name: string]: CheckDetail;
  };
  version: string;
  uptime_seconds: number;
}

export interface HealthSummary {
  live: boolean;
  ready: boolean;
  details: HealthCheckResult;
}

let shuttingDown = false;

export function setShuttingDown(value: boolean): void {
  shuttingDown = value;
  if (value) {
    console.log('[HealthCheck] Service marked as shutting down');
  }
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

function getUptimeSeconds(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

function determineOverallStatus(checks: Record<string, CheckDetail>): 'healthy' | 'degraded' | 'unhealthy' {
  const checkValues = Object.values(checks);
  if (checkValues.length === 0) return 'healthy';
  
  const hasFailure = checkValues.some(c => c.status === 'fail');
  const hasWarning = checkValues.some(c => c.status === 'warn');
  
  if (hasFailure) return 'unhealthy';
  if (hasWarning) return 'degraded';
  return 'healthy';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

async function checkDatabase(): Promise<CheckDetail> {
  const start = Date.now();
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return {
        status: 'pass',
        message: 'Database connection successful',
        duration_ms: Date.now() - start,
      };
    } finally {
      client.release();
    }
  } catch (error: any) {
    return {
      status: 'fail',
      message: `Database connection failed: ${error.message}`,
      duration_ms: Date.now() - start,
    };
  }
}

async function checkWorkerPool(): Promise<CheckDetail> {
  const start = Date.now();
  try {
    const pool = getWorkerPool();
    const stats = pool.getStats();
    
    const availableWorkers = stats.totalWorkers - stats.activeWorkers;
    const queuedTasks = stats.queuedTasks;
    
    if (stats.totalWorkers === 0) {
      return {
        status: 'fail',
        message: 'No workers initialized',
        duration_ms: Date.now() - start,
      };
    }
    
    if (availableWorkers === 0 && queuedTasks > 10) {
      return {
        status: 'warn',
        message: `All workers busy, ${queuedTasks} tasks queued`,
        duration_ms: Date.now() - start,
      };
    }
    
    return {
      status: 'pass',
      message: `${availableWorkers}/${stats.totalWorkers} workers available, ${queuedTasks} queued`,
      duration_ms: Date.now() - start,
    };
  } catch (error: any) {
    return {
      status: 'warn',
      message: `Worker pool check failed: ${error.message}`,
      duration_ms: Date.now() - start,
    };
  }
}

async function checkCircuitBreakers(): Promise<CheckDetail> {
  const start = Date.now();
  try {
    const breakers = getAllCircuitBreakers();
    
    if (breakers.size === 0) {
      return {
        status: 'pass',
        message: 'No circuit breakers registered',
        duration_ms: Date.now() - start,
      };
    }
    
    let openCount = 0;
    let halfOpenCount = 0;
    let closedCount = 0;
    
    for (const [, breaker] of breakers) {
      const state = breaker.getState();
      if (state === CircuitState.OPEN) openCount++;
      else if (state === CircuitState.HALF_OPEN) halfOpenCount++;
      else closedCount++;
    }
    
    const total = breakers.size;
    
    if (openCount === total && total > 0) {
      return {
        status: 'fail',
        message: `All ${total} circuit breakers are OPEN`,
        duration_ms: Date.now() - start,
      };
    }
    
    if (openCount > total / 2) {
      return {
        status: 'warn',
        message: `${openCount}/${total} circuit breakers are OPEN`,
        duration_ms: Date.now() - start,
      };
    }
    
    return {
      status: 'pass',
      message: `Circuit breakers: ${closedCount} closed, ${halfOpenCount} half-open, ${openCount} open`,
      duration_ms: Date.now() - start,
    };
  } catch (error: any) {
    return {
      status: 'warn',
      message: `Circuit breaker check failed: ${error.message}`,
      duration_ms: Date.now() - start,
    };
  }
}

async function checkMemory(): Promise<CheckDetail> {
  const start = Date.now();
  try {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / (1024 * 1024);
    const heapTotalMB = usage.heapTotal / (1024 * 1024);
    const heapUsedPercent = (usage.heapUsed / usage.heapTotal) * 100;
    
    if (heapUsedPercent >= 90) {
      return {
        status: 'fail',
        message: `Memory usage critical: ${heapUsedPercent.toFixed(1)}% (${heapUsedMB.toFixed(1)}MB/${heapTotalMB.toFixed(1)}MB)`,
        duration_ms: Date.now() - start,
      };
    }
    
    if (heapUsedPercent >= 75) {
      return {
        status: 'warn',
        message: `Memory usage elevated: ${heapUsedPercent.toFixed(1)}% (${heapUsedMB.toFixed(1)}MB/${heapTotalMB.toFixed(1)}MB)`,
        duration_ms: Date.now() - start,
      };
    }
    
    return {
      status: 'pass',
      message: `Memory usage: ${heapUsedPercent.toFixed(1)}% (${heapUsedMB.toFixed(1)}MB/${heapTotalMB.toFixed(1)}MB)`,
      duration_ms: Date.now() - start,
    };
  } catch (error: any) {
    return {
      status: 'warn',
      message: `Memory check failed: ${error.message}`,
      duration_ms: Date.now() - start,
    };
  }
}

async function checkShutdownStatus(): Promise<CheckDetail> {
  const start = Date.now();
  
  if (shuttingDown) {
    return {
      status: 'fail',
      message: 'Service is shutting down',
      duration_ms: Date.now() - start,
    };
  }
  
  return {
    status: 'pass',
    message: 'Service is running',
    duration_ms: Date.now() - start,
  };
}

export async function checkLiveness(): Promise<HealthCheckResult> {
  const checks: Record<string, CheckDetail> = {};
  
  const start = Date.now();
  checks['process'] = {
    status: 'pass',
    message: 'Process is alive',
    duration_ms: Date.now() - start,
  };
  
  return {
    status: 'healthy',
    checks,
    version: APP_VERSION,
    uptime_seconds: getUptimeSeconds(),
  };
}

export async function checkReadiness(): Promise<HealthCheckResult> {
  const checks: Record<string, CheckDetail> = {};
  
  const checkPromises: Promise<void>[] = [
    withTimeout(checkDatabase(), HEALTH_CHECK_TIMEOUT_MS, {
      status: 'fail' as const,
      message: 'Database check timed out',
      duration_ms: HEALTH_CHECK_TIMEOUT_MS,
    }).then(result => { checks['database'] = result; }),
    
    withTimeout(checkWorkerPool(), HEALTH_CHECK_TIMEOUT_MS, {
      status: 'warn' as const,
      message: 'Worker pool check timed out',
      duration_ms: HEALTH_CHECK_TIMEOUT_MS,
    }).then(result => { checks['worker_pool'] = result; }),
    
    withTimeout(checkCircuitBreakers(), HEALTH_CHECK_TIMEOUT_MS, {
      status: 'warn' as const,
      message: 'Circuit breaker check timed out',
      duration_ms: HEALTH_CHECK_TIMEOUT_MS,
    }).then(result => { checks['circuit_breakers'] = result; }),
    
    withTimeout(checkMemory(), HEALTH_CHECK_TIMEOUT_MS, {
      status: 'warn' as const,
      message: 'Memory check timed out',
      duration_ms: HEALTH_CHECK_TIMEOUT_MS,
    }).then(result => { checks['memory'] = result; }),
    
    withTimeout(checkShutdownStatus(), HEALTH_CHECK_TIMEOUT_MS, {
      status: 'fail' as const,
      message: 'Shutdown status check timed out',
      duration_ms: HEALTH_CHECK_TIMEOUT_MS,
    }).then(result => { checks['shutdown_status'] = result; }),
  ];
  
  await Promise.all(checkPromises);
  
  return {
    status: determineOverallStatus(checks),
    checks,
    version: APP_VERSION,
    uptime_seconds: getUptimeSeconds(),
  };
}

export function getHealthSummary(): HealthSummary {
  const checks: Record<string, CheckDetail> = {};
  
  checks['process'] = {
    status: 'pass',
    message: 'Process is alive',
    duration_ms: 0,
  };
  
  if (shuttingDown) {
    checks['shutdown_status'] = {
      status: 'fail',
      message: 'Service is shutting down',
      duration_ms: 0,
    };
  }
  
  const details: HealthCheckResult = {
    status: shuttingDown ? 'unhealthy' : 'healthy',
    checks,
    version: APP_VERSION,
    uptime_seconds: getUptimeSeconds(),
  };
  
  return {
    live: true,
    ready: !shuttingDown,
    details,
  };
}

export function createHealthRouter(): Router {
  const router = Router();
  
  router.get('/live', async (_req: Request, res: Response) => {
    try {
      const result = await checkLiveness();
      const statusCode = result.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(result);
    } catch (error: any) {
      res.status(503).json({
        status: 'unhealthy',
        checks: {
          error: {
            status: 'fail',
            message: error.message,
            duration_ms: 0,
          },
        },
        version: APP_VERSION,
        uptime_seconds: getUptimeSeconds(),
      });
    }
  });
  
  router.get('/ready', async (_req: Request, res: Response) => {
    try {
      const result = await checkReadiness();
      const statusCode = result.status === 'healthy' || result.status === 'degraded' ? 200 : 503;
      res.status(statusCode).json(result);
    } catch (error: any) {
      res.status(503).json({
        status: 'unhealthy',
        checks: {
          error: {
            status: 'fail',
            message: error.message,
            duration_ms: 0,
          },
        },
        version: APP_VERSION,
        uptime_seconds: getUptimeSeconds(),
      });
    }
  });
  
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const [liveness, readiness] = await Promise.all([
        checkLiveness(),
        checkReadiness(),
      ]);
      
      const combinedChecks = {
        ...liveness.checks,
        ...readiness.checks,
      };
      
      const overallStatus = determineOverallStatus(combinedChecks);
      const statusCode = overallStatus === 'healthy' || overallStatus === 'degraded' ? 200 : 503;
      
      res.status(statusCode).json({
        status: overallStatus,
        live: liveness.status === 'healthy',
        ready: readiness.status !== 'unhealthy',
        checks: combinedChecks,
        version: APP_VERSION,
        uptime_seconds: getUptimeSeconds(),
      });
    } catch (error: any) {
      res.status(503).json({
        status: 'unhealthy',
        live: false,
        ready: false,
        checks: {
          error: {
            status: 'fail',
            message: error.message,
            duration_ms: 0,
          },
        },
        version: APP_VERSION,
        uptime_seconds: getUptimeSeconds(),
      });
    }
  });
  
  return router;
}

export const pareHealthChecks = {
  checkLiveness,
  checkReadiness,
  getHealthSummary,
  setShuttingDown,
  isShuttingDown,
  createHealthRouter,
};
