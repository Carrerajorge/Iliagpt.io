/**
 * SUPERINTELLIGENCE - Audit Middleware
 * Middleware para capturar métricas automáticamente
 * Tarea 1: Integración con Express
 */

import { Request, Response, NextFunction } from 'express';
import { performanceAuditor } from './PerformanceAuditor';
import { Logger } from '../../../lib/logger';

// Extender Request para tracking
declare global {
  namespace Express {
    interface Request {
      auditStartTime?: number;
      auditServiceName?: string;
    }
  }
}

/**
 * Middleware para capturar métricas de endpoints automáticamente
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  req.auditStartTime = startTime;

  // Capturar el tamaño de la respuesta
  const originalSend = res.send.bind(res);
  let responseSize = 0;

  res.send = function (body: any): Response {
    if (body) {
      responseSize = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body));
    }
    return originalSend(body);
  };

  // Registrar métricas cuando la respuesta termina
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const endpoint = normalizeEndpoint(req.path);

    performanceAuditor.recordEndpointCall(
      endpoint,
      req.method,
      res.statusCode,
      duration,
      responseSize
    );

    // Si tiene nombre de servicio asociado, registrar también
    if (req.auditServiceName) {
      performanceAuditor.recordServiceCall(
        req.auditServiceName,
        duration,
        res.statusCode < 400,
        { endpoint, method: req.method }
      );
    }
  });

  next();
}

/**
 * Decorador para envolver funciones de servicio con auditoría
 */
export function withAudit<T extends (...args: any[]) => Promise<any>>(
  serviceName: string,
  fn: T
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const startTime = Date.now();
    let success = true;

    try {
      const result = await fn(...args);
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      performanceAuditor.recordServiceCall(serviceName, duration, success);
    }
  }) as T;
}

/**
 * Higher-order function para crear un servicio auditado
 */
export function createAuditedService<T extends Record<string, (...args: any[]) => Promise<any>>>(
  serviceName: string,
  service: T
): T {
  const auditedService = {} as T;

  for (const [key, fn] of Object.entries(service)) {
    if (typeof fn === 'function') {
      (auditedService as any)[key] = withAudit(`${serviceName}.${key}`, fn);
    } else {
      (auditedService as any)[key] = fn;
    }
  }

  return auditedService;
}

/**
 * Normalizar paths de endpoints para agrupar métricas
 * /api/users/123 -> /api/users/:id
 */
function normalizeEndpoint(path: string): string {
  return path
    // UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
    // Numeric IDs
    .replace(/\/\d+/g, '/:id')
    // MongoDB ObjectIds
    .replace(/[0-9a-f]{24}/gi, ':objectId')
    // Tokens o hashes largos
    .replace(/[0-9a-zA-Z]{32,}/g, ':token');
}

/**
 * Wrapper para registrar consumo de tokens de LLM
 */
export function trackTokenUsage(
  provider: 'openai' | 'anthropic' | 'google' | 'xai',
  model: string,
  inputTokens: number,
  outputTokens: number
): void {
  performanceAuditor.recordTokenUsage(provider, model, inputTokens, outputTokens);
}

/**
 * Wrapper para registrar queries de base de datos
 */
export function trackDatabaseQuery(
  queryPattern: string,
  executionTime: number,
  rowsAffected: number = 0
): void {
  performanceAuditor.recordDatabaseQuery(queryPattern, executionTime, rowsAffected);
}

/**
 * Clase para crear contextos de auditoría de servicios
 */
export class ServiceAuditContext {
  private serviceName: string;
  private startTime: number;
  private metadata: Record<string, any> = {};

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.startTime = Date.now();
  }

  addMetadata(key: string, value: any): this {
    this.metadata[key] = value;
    return this;
  }

  success(): void {
    const duration = Date.now() - this.startTime;
    performanceAuditor.recordServiceCall(this.serviceName, duration, true, this.metadata);
  }

  failure(error?: Error): void {
    const duration = Date.now() - this.startTime;
    this.metadata.error = error?.message;
    performanceAuditor.recordServiceCall(this.serviceName, duration, false, this.metadata);
  }

  async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn();
      this.success();
      return result;
    } catch (error) {
      this.failure(error as Error);
      throw error;
    }
  }
}

/**
 * Factory function para crear contexto de auditoría
 */
export function audit(serviceName: string): ServiceAuditContext {
  return new ServiceAuditContext(serviceName);
}

/**
 * Express router middleware factory
 */
export function createAuditedRouter(baseName: string) {
  return {
    middleware: (req: Request, _res: Response, next: NextFunction) => {
      req.auditServiceName = baseName;
      next();
    },
  };
}

// Export para uso directo
export { performanceAuditor };
