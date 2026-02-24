import { createLogger } from "./structuredLogger";
import { createAlert, resolveAlertsByService } from "./alertManager";

const logger = createLogger("health-monitor");

export type ServiceStatus = "healthy" | "degraded" | "unhealthy";

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  lastCheck: Date;
  latency?: number;
  errorCount: number;
  consecutiveFailures: number;
  lastError?: string;
}

interface ServiceConfig {
  name: string;
  checkFn: () => Promise<boolean>;
  intervalMs: number;
}

type AlertCallback = (service: string, status: ServiceStatus, previousStatus: ServiceStatus) => void;

const services: Map<string, ServiceHealth> = new Map();
const serviceConfigs: Map<string, ServiceConfig> = new Map();
const serviceIntervals: Map<string, NodeJS.Timeout> = new Map();
const alertCallbacks: Set<AlertCallback> = new Set();

const DEGRADED_THRESHOLD = 2; // Fallos consecutivos para degraded
const UNHEALTHY_THRESHOLD = 5; // Fallos consecutivos para unhealthy
const DEFAULT_CHECK_INTERVAL = 60000; // 60 segundos

export async function checkService(
  name: string,
  checkFn: () => Promise<boolean>
): Promise<ServiceHealth> {
  const startTime = Date.now();
  let health = services.get(name);

  if (!health) {
    health = {
      name,
      status: "healthy",
      lastCheck: new Date(),
      errorCount: 0,
      consecutiveFailures: 0,
    };
    services.set(name, health);
  }

  const previousStatus = health.status;

  try {
    const success = await checkFn();
    const latency = Date.now() - startTime;

    if (success) {
      health.consecutiveFailures = 0;
      health.status = "healthy";
      health.latency = latency;
      health.lastError = undefined;

      // Si estaba en mal estado, resolver alertas
      if (previousStatus !== "healthy") {
        resolveAlertsByService(name);
        logger.info(`Service ${name} recovered to healthy`, { latency });
      }
    } else {
      handleFailure(health, "Health check returned false", latency);
    }
  } catch (error: any) {
    const latency = Date.now() - startTime;
    handleFailure(health, error.message || "Unknown error", latency);
  }

  health.lastCheck = new Date();

  // Notificar si cambió el estado
  if (previousStatus !== health.status) {
    notifyStatusChange(name, health.status, previousStatus);
  }

  return { ...health };
}

function handleFailure(health: ServiceHealth, errorMessage: string, latency: number): void {
  health.errorCount++;
  health.consecutiveFailures++;
  health.latency = latency;
  health.lastError = errorMessage;

  if (health.consecutiveFailures >= UNHEALTHY_THRESHOLD) {
    if (health.status !== "unhealthy") {
      health.status = "unhealthy";
      createAlert({
        type: "api_failure",
        service: health.name,
        message: `Service ${health.name} is unhealthy: ${errorMessage}`,
        severity: "critical",
        resolved: false,
      });
      logger.error(`Service ${health.name} marked unhealthy`, {
        consecutiveFailures: health.consecutiveFailures,
        error: errorMessage,
      });
    }
  } else if (health.consecutiveFailures >= DEGRADED_THRESHOLD) {
    if (health.status === "healthy") {
      health.status = "degraded";
      createAlert({
        type: "api_failure",
        service: health.name,
        message: `Service ${health.name} is degraded: ${errorMessage}`,
        severity: "medium",
        resolved: false,
      });
      logger.warn(`Service ${health.name} marked degraded`, {
        consecutiveFailures: health.consecutiveFailures,
        error: errorMessage,
      });
    }
  }
}

function notifyStatusChange(service: string, status: ServiceStatus, previousStatus: ServiceStatus): void {
  const callbacks = Array.from(alertCallbacks);
  for (const callback of callbacks) {
    try {
      callback(service, status, previousStatus);
    } catch (error: any) {
      logger.error("Alert callback error", { error: error.message });
    }
  }
}

export function registerService(
  name: string,
  checkFn: () => Promise<boolean>,
  intervalMs: number = DEFAULT_CHECK_INTERVAL
): void {
  // Limpiar intervalo existente si hay uno
  const existingInterval = serviceIntervals.get(name);
  if (existingInterval) {
    clearInterval(existingInterval);
  }

  serviceConfigs.set(name, { name, checkFn, intervalMs });

  // Inicializar estado del servicio
  services.set(name, {
    name,
    status: "healthy",
    lastCheck: new Date(),
    errorCount: 0,
    consecutiveFailures: 0,
  });

  // Ejecutar primera verificación
  checkService(name, checkFn).catch(err => {
    logger.error(`Initial health check failed for ${name}`, { error: err.message });
  });

  // Configurar intervalo de verificación automática
  const interval = setInterval(() => {
    checkService(name, checkFn).catch(err => {
      logger.error(`Scheduled health check failed for ${name}`, { error: err.message });
    });
  }, intervalMs);

  serviceIntervals.set(name, interval);
  logger.info(`Registered service ${name} for health monitoring`, { intervalMs });
}

export function unregisterService(name: string): void {
  const interval = serviceIntervals.get(name);
  if (interval) {
    clearInterval(interval);
    serviceIntervals.delete(name);
  }
  serviceConfigs.delete(name);
  services.delete(name);
  logger.info(`Unregistered service ${name}`);
}

export function getServiceHealth(name: string): ServiceHealth | undefined {
  const health = services.get(name);
  return health ? { ...health } : undefined;
}

export function getAllServicesHealth(): ServiceHealth[] {
  return Array.from(services.values()).map(h => ({ ...h }));
}

export function registerAlert(callback: AlertCallback): () => void {
  alertCallbacks.add(callback);
  return () => alertCallbacks.delete(callback);
}

export function getOverallStatus(): ServiceStatus {
  const healthStates = Array.from(services.values());

  if (healthStates.some(h => h.status === "unhealthy")) {
    return "unhealthy";
  }
  if (healthStates.some(h => h.status === "degraded")) {
    return "degraded";
  }
  return "healthy";
}

// Función de inicialización para registrar servicios comunes
export function initializeHealthMonitoring(): void {
  logger.info("Initializing health monitoring system");

  // Registrar xAI health check
  /*
  if (process.env.XAI_API_KEY) {
    registerService("xai", async () => {
      const { llmGateway } = await import("./llmGateway");
      const result = await llmGateway.healthCheck();
      return result.xai.available;
    }, 60000);
  }
  
  // Registrar Gemini health check
  if (process.env.GEMINI_API_KEY) {
    registerService("gemini", async () => {
      const { llmGateway } = await import("./llmGateway");
      const result = await llmGateway.healthCheck();
      return result.gemini.available;
    }, 60000);
  }
  */

  // Registrar Database health check
  registerService("database", async () => {
    try {
      const { db } = await import("../db");
      await db.execute("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }, 30000);
}
