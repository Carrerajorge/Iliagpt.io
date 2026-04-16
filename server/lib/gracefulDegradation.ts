import { EventEmitter } from "events";
import { createLogger } from "./structuredLogger";
import { Registry, Gauge, Counter } from "prom-client";

const logger = createLogger("graceful-degradation");

export enum DegradationLevel {
  FULL = "FULL",
  DEGRADED_1 = "DEGRADED_1",
  DEGRADED_2 = "DEGRADED_2",
  MINIMAL = "MINIMAL",
  OFFLINE = "OFFLINE",
}

export type ServiceStatus = "healthy" | "degraded" | "unhealthy";

export type ServiceName = "llm" | "database" | "redis" | "embeddings" | "external_apis";

export interface ServiceHealth {
  name: ServiceName;
  status: ServiceStatus;
  lastCheck: Date;
  latencyMs: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastError?: string;
  currentFallbackIndex: number;
}

export interface ServiceConfig {
  name: ServiceName;
  healthCheck: () => Promise<boolean>;
  intervalMs: number;
  criticalForLevel: DegradationLevel;
  fallbackChain: FallbackOption[];
}

export interface FallbackOption {
  name: string;
  priority: number;
  execute: <T>(...args: any[]) => Promise<T>;
  isAvailable: () => Promise<boolean>;
}

export interface LevelConfig {
  level: DegradationLevel;
  availableServices: Set<ServiceName>;
  description: string;
  features: {
    llmEnabled: boolean;
    embeddingsEnabled: boolean;
    ragEnabled: boolean;
    externalApisEnabled: boolean;
    cacheOnly: boolean;
    predefinedResponsesOnly: boolean;
    maintenanceMode: boolean;
  };
}

export interface DegradationEvents {
  level_changed: { oldLevel: DegradationLevel; newLevel: DegradationLevel; reason: string };
  service_status_changed: { service: ServiceName; oldStatus: ServiceStatus; newStatus: ServiceStatus };
  fallback_used: { service: ServiceName; fallbackName: string; reason: string };
  recovery_started: { service: ServiceName };
  recovery_completed: { service: ServiceName };
}

const LEVEL_CONFIGS: Map<DegradationLevel, LevelConfig> = new Map([
  [
    DegradationLevel.FULL,
    {
      level: DegradationLevel.FULL,
      availableServices: new Set<ServiceName>(["llm", "database", "redis", "embeddings", "external_apis"]),
      description: "All services fully operational",
      features: {
        llmEnabled: true,
        embeddingsEnabled: true,
        ragEnabled: true,
        externalApisEnabled: true,
        cacheOnly: false,
        predefinedResponsesOnly: false,
        maintenanceMode: false,
      },
    },
  ],
  [
    DegradationLevel.DEGRADED_1,
    {
      level: DegradationLevel.DEGRADED_1,
      availableServices: new Set<ServiceName>(["llm", "database", "redis", "external_apis"]),
      description: "No embeddings, no advanced RAG",
      features: {
        llmEnabled: true,
        embeddingsEnabled: false,
        ragEnabled: false,
        externalApisEnabled: true,
        cacheOnly: false,
        predefinedResponsesOnly: false,
        maintenanceMode: false,
      },
    },
  ],
  [
    DegradationLevel.DEGRADED_2,
    {
      level: DegradationLevel.DEGRADED_2,
      availableServices: new Set<ServiceName>(["database", "redis"]),
      description: "No external services, cache only",
      features: {
        llmEnabled: false,
        embeddingsEnabled: false,
        ragEnabled: false,
        externalApisEnabled: false,
        cacheOnly: true,
        predefinedResponsesOnly: false,
        maintenanceMode: false,
      },
    },
  ],
  [
    DegradationLevel.MINIMAL,
    {
      level: DegradationLevel.MINIMAL,
      availableServices: new Set<ServiceName>([]),
      description: "Predefined responses only",
      features: {
        llmEnabled: false,
        embeddingsEnabled: false,
        ragEnabled: false,
        externalApisEnabled: false,
        cacheOnly: false,
        predefinedResponsesOnly: true,
        maintenanceMode: false,
      },
    },
  ],
  [
    DegradationLevel.OFFLINE,
    {
      level: DegradationLevel.OFFLINE,
      availableServices: new Set<ServiceName>([]),
      description: "Maintenance mode - system offline",
      features: {
        llmEnabled: false,
        embeddingsEnabled: false,
        ragEnabled: false,
        externalApisEnabled: false,
        cacheOnly: false,
        predefinedResponsesOnly: false,
        maintenanceMode: true,
      },
    },
  ],
]);

const LEVEL_PRIORITY: DegradationLevel[] = [
  DegradationLevel.FULL,
  DegradationLevel.DEGRADED_1,
  DegradationLevel.DEGRADED_2,
  DegradationLevel.MINIMAL,
  DegradationLevel.OFFLINE,
];

const DEGRADED_THRESHOLD = 2;
const UNHEALTHY_THRESHOLD = 5;
const RECOVERY_THRESHOLD = 3;
const DEFAULT_CHECK_INTERVAL = 30000;

class DegradationEventEmitter extends EventEmitter {
  emit<K extends keyof DegradationEvents>(event: K, payload: DegradationEvents[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends keyof DegradationEvents>(event: K, listener: (payload: DegradationEvents[K]) => void): this {
    return super.on(event, listener);
  }

  once<K extends keyof DegradationEvents>(event: K, listener: (payload: DegradationEvents[K]) => void): this {
    return super.once(event, listener);
  }
}

const metricsRegistry = new Registry();

const currentDegradationLevelGauge = new Gauge({
  name: "degradation_current_level",
  help: "Current degradation level (0=FULL, 1=DEGRADED_1, 2=DEGRADED_2, 3=MINIMAL, 4=OFFLINE)",
  registers: [metricsRegistry],
});

const serviceHealthGauge = new Gauge({
  name: "degradation_service_health",
  help: "Service health status (0=unhealthy, 1=degraded, 2=healthy)",
  labelNames: ["service"],
  registers: [metricsRegistry],
});

const fallbacksUsedCounter = new Counter({
  name: "degradation_fallbacks_used_total",
  help: "Total number of fallbacks used",
  labelNames: ["service", "fallback_name"],
  registers: [metricsRegistry],
});

const levelChangeCounter = new Counter({
  name: "degradation_level_changes_total",
  help: "Total number of degradation level changes",
  labelNames: ["from_level", "to_level"],
  registers: [metricsRegistry],
});

const serviceRecoveryCounter = new Counter({
  name: "degradation_service_recoveries_total",
  help: "Total number of service recoveries",
  labelNames: ["service"],
  registers: [metricsRegistry],
});

export class DegradationManager {
  private currentLevel: DegradationLevel = DegradationLevel.FULL;
  private services: Map<ServiceName, ServiceHealth> = new Map();
  private serviceConfigs: Map<ServiceName, ServiceConfig> = new Map();
  private checkIntervals: Map<ServiceName, NodeJS.Timeout> = new Map();
  private events: DegradationEventEmitter = new DegradationEventEmitter();
  private isShuttingDown: boolean = false;
  private levelHistory: Array<{ level: DegradationLevel; timestamp: Date; reason: string }> = [];
  private readonly maxHistoryEntries = 100;

  constructor() {
    this.initializeDefaultServices();
    currentDegradationLevelGauge.set(0);
  }

  private initializeDefaultServices(): void {
    const defaultServices: ServiceName[] = ["llm", "database", "redis", "embeddings", "external_apis"];
    
    for (const name of defaultServices) {
      this.services.set(name, {
        name,
        status: "healthy",
        lastCheck: new Date(),
        latencyMs: 0,
        consecutiveFailures: 0,
        consecutiveSuccesses: RECOVERY_THRESHOLD,
        currentFallbackIndex: 0,
      });
      serviceHealthGauge.set({ service: name }, 2);
    }
  }

  registerService(name: ServiceName, healthCheck: () => Promise<boolean>, options?: {
    intervalMs?: number;
    criticalForLevel?: DegradationLevel;
    fallbackChain?: FallbackOption[];
  }): void {
    const config: ServiceConfig = {
      name,
      healthCheck,
      intervalMs: options?.intervalMs ?? DEFAULT_CHECK_INTERVAL,
      criticalForLevel: options?.criticalForLevel ?? DegradationLevel.DEGRADED_1,
      fallbackChain: options?.fallbackChain ?? [],
    };

    this.serviceConfigs.set(name, config);

    if (!this.services.has(name)) {
      this.services.set(name, {
        name,
        status: "healthy",
        lastCheck: new Date(),
        latencyMs: 0,
        consecutiveFailures: 0,
        consecutiveSuccesses: RECOVERY_THRESHOLD,
        currentFallbackIndex: 0,
      });
      serviceHealthGauge.set({ service: name }, 2);
    }

    this.startHealthCheck(name);
    logger.info(`Service registered: ${name}`, { intervalMs: config.intervalMs });
  }

  private startHealthCheck(name: ServiceName): void {
    const config = this.serviceConfigs.get(name);
    if (!config) return;

    if (this.checkIntervals.has(name)) {
      clearInterval(this.checkIntervals.get(name)!);
    }

    this.performHealthCheck(name);

    const intervalId = setInterval(() => {
      if (!this.isShuttingDown) {
        this.performHealthCheck(name);
      }
    }, config.intervalMs);

    intervalId.unref();
    this.checkIntervals.set(name, intervalId);
  }

  private async performHealthCheck(name: ServiceName): Promise<void> {
    const config = this.serviceConfigs.get(name);
    const health = this.services.get(name);
    
    if (!config || !health) return;

    const startTime = Date.now();
    const previousStatus = health.status;

    try {
      const isHealthy = await config.healthCheck();
      const latencyMs = Date.now() - startTime;

      health.latencyMs = latencyMs;
      health.lastCheck = new Date();

      if (isHealthy) {
        this.handleHealthCheckSuccess(health, previousStatus);
      } else {
        this.handleHealthCheckFailure(health, "Health check returned false", previousStatus);
      }
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      health.latencyMs = latencyMs;
      health.lastCheck = new Date();
      this.handleHealthCheckFailure(health, error.message || "Unknown error", previousStatus);
    }

    this.recalculateLevel();
  }

  private handleHealthCheckSuccess(health: ServiceHealth, previousStatus: ServiceStatus): void {
    health.consecutiveFailures = 0;
    health.consecutiveSuccesses++;
    health.lastError = undefined;

    if (health.consecutiveSuccesses >= RECOVERY_THRESHOLD) {
      if (health.status !== "healthy") {
        health.status = "healthy";
        health.currentFallbackIndex = 0;
        serviceHealthGauge.set({ service: health.name }, 2);
        serviceRecoveryCounter.inc({ service: health.name });

        this.events.emit("recovery_completed", { service: health.name });
        this.events.emit("service_status_changed", {
          service: health.name,
          oldStatus: previousStatus,
          newStatus: "healthy",
        });

        logger.info(`Service recovered: ${health.name}`, {
          consecutiveSuccesses: health.consecutiveSuccesses,
        });
      }
    } else if (health.status === "unhealthy" && health.consecutiveSuccesses >= 1) {
      health.status = "degraded";
      serviceHealthGauge.set({ service: health.name }, 1);

      this.events.emit("recovery_started", { service: health.name });
      this.events.emit("service_status_changed", {
        service: health.name,
        oldStatus: previousStatus,
        newStatus: "degraded",
      });

      logger.info(`Service recovering: ${health.name}`, {
        consecutiveSuccesses: health.consecutiveSuccesses,
      });
    }
  }

  private handleHealthCheckFailure(health: ServiceHealth, error: string, previousStatus: ServiceStatus): void {
    health.consecutiveFailures++;
    health.consecutiveSuccesses = 0;
    health.lastError = error;

    if (health.consecutiveFailures >= UNHEALTHY_THRESHOLD) {
      if (health.status !== "unhealthy") {
        health.status = "unhealthy";
        serviceHealthGauge.set({ service: health.name }, 0);

        this.events.emit("service_status_changed", {
          service: health.name,
          oldStatus: previousStatus,
          newStatus: "unhealthy",
        });

        logger.error(`Service unhealthy: ${health.name}`, {
          consecutiveFailures: health.consecutiveFailures,
          error,
        });
      }
    } else if (health.consecutiveFailures >= DEGRADED_THRESHOLD) {
      if (health.status === "healthy") {
        health.status = "degraded";
        serviceHealthGauge.set({ service: health.name }, 1);

        this.events.emit("service_status_changed", {
          service: health.name,
          oldStatus: previousStatus,
          newStatus: "degraded",
        });

        logger.warn(`Service degraded: ${health.name}`, {
          consecutiveFailures: health.consecutiveFailures,
          error,
        });
      }
    }
  }

  private recalculateLevel(): void {
    const oldLevel = this.currentLevel;
    let newLevel = DegradationLevel.FULL;

    const unhealthyServices = new Set<ServiceName>();
    const degradedServices = new Set<ServiceName>();

    for (const [name, health] of this.services) {
      if (health.status === "unhealthy") {
        unhealthyServices.add(name);
      } else if (health.status === "degraded") {
        degradedServices.add(name);
      }
    }

    if (unhealthyServices.has("database") && unhealthyServices.has("redis")) {
      newLevel = DegradationLevel.OFFLINE;
    } else if (unhealthyServices.has("llm") && unhealthyServices.has("database")) {
      newLevel = DegradationLevel.MINIMAL;
    } else if (unhealthyServices.has("llm") || unhealthyServices.has("external_apis")) {
      newLevel = DegradationLevel.DEGRADED_2;
    } else if (unhealthyServices.has("embeddings") || degradedServices.has("llm")) {
      newLevel = DegradationLevel.DEGRADED_1;
    } else if (degradedServices.size > 0) {
      newLevel = DegradationLevel.DEGRADED_1;
    }

    if (newLevel !== oldLevel) {
      this.currentLevel = newLevel;
      const levelIndex = LEVEL_PRIORITY.indexOf(newLevel);
      currentDegradationLevelGauge.set(levelIndex);
      levelChangeCounter.inc({ from_level: oldLevel, to_level: newLevel });

      const reason = this.buildLevelChangeReason(unhealthyServices, degradedServices);
      
      this.levelHistory.push({
        level: newLevel,
        timestamp: new Date(),
        reason,
      });

      if (this.levelHistory.length > this.maxHistoryEntries) {
        this.levelHistory.shift();
      }

      this.events.emit("level_changed", { oldLevel, newLevel, reason });

      logger.warn(`Degradation level changed: ${oldLevel} -> ${newLevel}`, {
        reason,
        unhealthyServices: Array.from(unhealthyServices),
        degradedServices: Array.from(degradedServices),
      });
    }
  }

  private buildLevelChangeReason(unhealthy: Set<ServiceName>, degraded: Set<ServiceName>): string {
    const parts: string[] = [];
    
    if (unhealthy.size > 0) {
      parts.push(`unhealthy: ${Array.from(unhealthy).join(", ")}`);
    }
    if (degraded.size > 0) {
      parts.push(`degraded: ${Array.from(degraded).join(", ")}`);
    }

    return parts.length > 0 ? parts.join("; ") : "all services healthy";
  }

  getCurrentLevel(): DegradationLevel {
    return this.currentLevel;
  }

  getLevelConfig(level?: DegradationLevel): LevelConfig | undefined {
    return LEVEL_CONFIGS.get(level ?? this.currentLevel);
  }

  isServiceAvailable(service: ServiceName): boolean {
    const health = this.services.get(service);
    if (!health) return false;

    const levelConfig = LEVEL_CONFIGS.get(this.currentLevel);
    if (!levelConfig) return false;

    return levelConfig.availableServices.has(service) && health.status !== "unhealthy";
  }

  getServiceHealth(service: ServiceName): ServiceHealth | undefined {
    return this.services.get(service);
  }

  getAllServiceHealth(): Map<ServiceName, ServiceHealth> {
    return new Map(this.services);
  }

  async getFallback<T>(service: ServiceName, defaultValue?: T): Promise<FallbackOption | null> {
    const config = this.serviceConfigs.get(service);
    const health = this.services.get(service);

    if (!config || !health) return null;

    const sortedFallbacks = [...config.fallbackChain].sort((a, b) => a.priority - b.priority);

    for (let i = health.currentFallbackIndex; i < sortedFallbacks.length; i++) {
      const fallback = sortedFallbacks[i];
      try {
        const isAvailable = await fallback.isAvailable();
        if (isAvailable) {
          if (i !== health.currentFallbackIndex) {
            health.currentFallbackIndex = i;
            
            fallbacksUsedCounter.inc({ service, fallback_name: fallback.name });
            
            this.events.emit("fallback_used", {
              service,
              fallbackName: fallback.name,
              reason: health.lastError || "primary unavailable",
            });

            logger.info(`Using fallback for ${service}: ${fallback.name}`, {
              fallbackIndex: i,
              reason: health.lastError,
            });
          }
          return fallback;
        }
      } catch (error) {
        logger.warn(`Fallback ${fallback.name} for ${service} check failed`, { error });
      }
    }

    return null;
  }

  async executeFallbackChain<T>(service: ServiceName, args: any[], defaultValue: T): Promise<T> {
    const fallback = await this.getFallback<T>(service);
    
    if (fallback) {
      try {
        return await fallback.execute<T>(...args);
      } catch (error: any) {
        logger.error(`Fallback ${fallback.name} for ${service} execution failed`, {
          error: error.message,
        });
        
        const health = this.services.get(service);
        if (health) {
          health.currentFallbackIndex++;
          return this.executeFallbackChain(service, args, defaultValue);
        }
      }
    }

    return defaultValue;
  }

  isFeatureAvailable(feature: keyof LevelConfig["features"]): boolean {
    const levelConfig = LEVEL_CONFIGS.get(this.currentLevel);
    if (!levelConfig) return false;
    return levelConfig.features[feature];
  }

  forceLevel(level: DegradationLevel, reason: string = "manual override"): void {
    const oldLevel = this.currentLevel;
    this.currentLevel = level;

    const levelIndex = LEVEL_PRIORITY.indexOf(level);
    currentDegradationLevelGauge.set(levelIndex);

    this.levelHistory.push({
      level,
      timestamp: new Date(),
      reason: `FORCED: ${reason}`,
    });

    if (this.levelHistory.length > this.maxHistoryEntries) {
      this.levelHistory.shift();
    }

    this.events.emit("level_changed", { oldLevel, newLevel: level, reason: `FORCED: ${reason}` });

    logger.warn(`Degradation level forced: ${oldLevel} -> ${level}`, { reason });
  }

  getLevelHistory(): Array<{ level: DegradationLevel; timestamp: Date; reason: string }> {
    return [...this.levelHistory];
  }

  on<K extends keyof DegradationEvents>(event: K, listener: (payload: DegradationEvents[K]) => void): void {
    this.events.on(event, listener);
  }

  once<K extends keyof DegradationEvents>(event: K, listener: (payload: DegradationEvents[K]) => void): void {
    this.events.once(event, listener);
  }

  off<K extends keyof DegradationEvents>(event: K, listener: (payload: DegradationEvents[K]) => void): void {
    this.events.off(event, listener);
  }

  getMetrics(): Registry {
    return metricsRegistry;
  }

  async getMetricsText(): Promise<string> {
    return metricsRegistry.metrics();
  }

  getStats(): {
    currentLevel: DegradationLevel;
    services: Record<ServiceName, ServiceHealth>;
    levelHistory: Array<{ level: DegradationLevel; timestamp: Date; reason: string }>;
    isMaintenanceMode: boolean;
  } {
    const servicesRecord: Record<string, ServiceHealth> = {};
    for (const [name, health] of this.services) {
      servicesRecord[name] = { ...health };
    }

    return {
      currentLevel: this.currentLevel,
      services: servicesRecord as Record<ServiceName, ServiceHealth>,
      levelHistory: this.getLevelHistory(),
      isMaintenanceMode: this.isFeatureAvailable("maintenanceMode"),
    };
  }

  shutdown(): void {
    this.isShuttingDown = true;

    for (const [name, intervalId] of this.checkIntervals) {
      clearInterval(intervalId);
      logger.debug(`Stopped health check for ${name}`);
    }

    this.checkIntervals.clear();
    this.events.removeAllListeners();

    logger.info("DegradationManager shutdown complete");
  }

  reset(): void {
    for (const [name, health] of this.services) {
      health.status = "healthy";
      health.consecutiveFailures = 0;
      health.consecutiveSuccesses = RECOVERY_THRESHOLD;
      health.currentFallbackIndex = 0;
      health.lastError = undefined;
      serviceHealthGauge.set({ service: name }, 2);
    }

    this.currentLevel = DegradationLevel.FULL;
    currentDegradationLevelGauge.set(0);
    this.levelHistory = [];

    logger.info("DegradationManager reset to FULL");
  }
}

const defaultManager = new DegradationManager();

export function getCurrentDegradationLevel(): DegradationLevel {
  return defaultManager.getCurrentLevel();
}

export function isFeatureAvailable(feature: keyof LevelConfig["features"]): boolean {
  return defaultManager.isFeatureAvailable(feature);
}

export function isServiceAvailable(service: ServiceName): boolean {
  return defaultManager.isServiceAvailable(service);
}

export function getDefaultManager(): DegradationManager {
  return defaultManager;
}

export const DEFAULT_FALLBACK_CHAINS: Record<ServiceName, FallbackOption[]> = {
  llm: [
    {
      name: "grok",
      priority: 1,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("Grok execution not implemented - override in registration");
      },
      isAvailable: async () => !!process.env.XAI_API_KEY,
    },
    {
      name: "gemini",
      priority: 2,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("Gemini execution not implemented - override in registration");
      },
      isAvailable: async () => !!process.env.GEMINI_API_KEY,
    },
    {
      name: "cached_responses",
      priority: 3,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("Cached responses not implemented - override in registration");
      },
      isAvailable: async () => true,
    },
    {
      name: "generic_response",
      priority: 4,
      execute: async <T>(): Promise<T> => {
        return "I'm experiencing temporary issues. Please try again shortly." as T;
      },
      isAvailable: async () => true,
    },
  ],
  database: [
    {
      name: "primary",
      priority: 1,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("Primary DB not implemented - override in registration");
      },
      isAvailable: async () => true,
    },
    {
      name: "readonly_replica",
      priority: 2,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("Readonly replica not implemented - override in registration");
      },
      isAvailable: async () => false,
    },
    {
      name: "cached_data",
      priority: 3,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("Cached data not implemented - override in registration");
      },
      isAvailable: async () => true,
    },
  ],
  redis: [
    {
      name: "primary",
      priority: 1,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("Redis primary not implemented - override in registration");
      },
      isAvailable: async () => !!process.env.REDIS_URL,
    },
    {
      name: "memory_cache",
      priority: 2,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("Memory cache not implemented - override in registration");
      },
      isAvailable: async () => true,
    },
  ],
  embeddings: [
    {
      name: "api",
      priority: 1,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("Embeddings API not implemented - override in registration");
      },
      isAvailable: async () => true,
    },
    {
      name: "local_model",
      priority: 2,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("Local model not implemented - override in registration");
      },
      isAvailable: async () => false,
    },
    {
      name: "keyword_search",
      priority: 3,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("Keyword search not implemented - override in registration");
      },
      isAvailable: async () => true,
    },
  ],
  external_apis: [
    {
      name: "primary",
      priority: 1,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("External API not implemented - override in registration");
      },
      isAvailable: async () => true,
    },
    {
      name: "cached_responses",
      priority: 2,
      execute: async <T>(...args: any[]): Promise<T> => {
        throw new Error("Cached responses not implemented - override in registration");
      },
      isAvailable: async () => true,
    },
  ],
};

export const PREDEFINED_RESPONSES: Record<string, string> = {
  greeting: "Hello! Our system is currently operating in limited capacity. How can I help you with basic queries?",
  error: "I apologize, but I'm unable to process that request at the moment. Please try again later.",
  maintenance: "Our system is currently undergoing maintenance. We expect to be back shortly. Thank you for your patience.",
  rate_limit: "You've reached the request limit. Please wait a moment before trying again.",
  fallback: "I'm here to help, though some advanced features are temporarily unavailable. What can I assist you with?",
};

export {
  DegradationManager,
  LEVEL_CONFIGS,
  LEVEL_PRIORITY,
  metricsRegistry as degradationMetricsRegistry,
};
