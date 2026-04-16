/**
 * connectorConfigHotReload.ts
 *
 * Config hot-reload system for connector configuration management.
 * Provides in-memory config caching, file watching, version control,
 * feature flags, environment resolution, migration, and health checking.
 */

const cryptoMod = require("crypto");
const { EventEmitter } = require("events");

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ConfigFieldType = "string" | "number" | "boolean" | "json" | "secret";

export interface ConfigField {
  name: string;
  type: ConfigFieldType;
  required: boolean;
  defaultValue?: unknown;
  description?: string;
  sensitive?: boolean;
  validationRegex?: string;
  minValue?: number;
  maxValue?: number;
  enumValues?: string[];
  deprecated?: boolean;
  deprecationMessage?: string;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  burstLimit?: number;
  burstWindowMs?: number;
  retryAfterMs?: number;
  strategy?: "fixed" | "sliding" | "token_bucket";
}

export interface SecurityOverrides {
  allowInsecureHttp?: boolean;
  disableCertValidation?: boolean;
  customCaBundle?: string;
  ipWhitelist?: string[];
  ipBlacklist?: string[];
  maxPayloadBytes?: number;
  headerSizeLimit?: number;
  corsAllowedOrigins?: string[];
}

export interface ConnectorConfigSchema {
  connectorId: string;
  version: string;
  fields: ConfigField[];
  rateLimit?: RateLimitConfig;
  security?: SecurityOverrides;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ConfigChangeEvent {
  connectorId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  source: "api" | "file" | "env" | "migration" | "rollback";
  timestamp: number;
  actor?: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string; code: string }>;
  warnings: Array<{ field: string; message: string; code: string }>;
}

export interface ConfigSnapshot {
  id: string;
  connectorId: string;
  config: Record<string, unknown>;
  hash: string;
  version: number;
  createdAt: number;
  createdBy: string;
  description?: string;
  tags?: string[];
}

export interface FeatureFlagEntry {
  name: string;
  enabled: boolean;
  percentage?: number;
  connectorOverrides?: Record<string, boolean>;
  userOverrides?: Record<string, boolean>;
  globalOverride?: boolean;
  description?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

export interface FeatureFlagChange {
  flagName: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
  actor?: string;
}

export interface ConfigHealthReport {
  connectorId: string;
  status: "healthy" | "degraded" | "unhealthy";
  lastUpdated: number;
  staleSinceMs: number;
  missingRequired: string[];
  deprecatedInUse: string[];
  snapshotCount: number;
  validationResult: ConfigValidationResult;
  issues: string[];
}

/* ------------------------------------------------------------------ */
/*  ConnectorConfigStore                                               */
/* ------------------------------------------------------------------ */

export class ConnectorConfigStore extends EventEmitter {
  private configs: Map<string, Map<string, unknown>>;
  private schemas: Map<string, ConnectorConfigSchema>;
  private changeLog: ConfigChangeEvent[];
  private readonly MAX_CHANGE_LOG = 5000;
  private lastUpdated: Map<string, number>;
  private lockedConnectors: Set<string>;
  private bulkOperationInProgress: boolean;
  private sensitiveFields: Map<string, Set<string>>;
  private defaultValues: Map<string, Map<string, unknown>>;
  private validationCache: Map<string, ConfigValidationResult>;
  private accessCounters: Map<string, number>;
  private writeCounters: Map<string, number>;
  private tags: Map<string, Map<string, string[]>>;

  constructor() {
    super();
    this.configs = new Map();
    this.schemas = new Map();
    this.changeLog = [];
    this.lastUpdated = new Map();
    this.lockedConnectors = new Set();
    this.bulkOperationInProgress = false;
    this.sensitiveFields = new Map();
    this.defaultValues = new Map();
    this.validationCache = new Map();
    this.accessCounters = new Map();
    this.writeCounters = new Map();
    this.tags = new Map();
  }

  /**
   * Register a schema for a connector, extracting sensitive fields and defaults.
   */
  registerSchema(schema: ConnectorConfigSchema): void {
    const existing = this.schemas.get(schema.connectorId);
    if (existing && existing.version === schema.version) {
      return;
    }
    this.schemas.set(schema.connectorId, { ...schema, updatedAt: Date.now() });

    const sensitiveSet = new Set<string>();
    const defaultsMap = new Map<string, unknown>();
    for (const field of schema.fields) {
      if (field.sensitive || field.type === "secret") {
        sensitiveSet.add(field.name);
      }
      if (field.defaultValue !== undefined) {
        defaultsMap.set(field.name, field.defaultValue);
      }
    }
    this.sensitiveFields.set(schema.connectorId, sensitiveSet);
    this.defaultValues.set(schema.connectorId, defaultsMap);

    // Invalidate validation cache for this connector
    this.validationCache.delete(schema.connectorId);

    this.emit("schema:registered", {
      connectorId: schema.connectorId,
      version: schema.version,
      fieldCount: schema.fields.length,
      timestamp: Date.now(),
    });
  }

  /**
   * Get the schema for a connector.
   */
  getSchema(connectorId: string): ConnectorConfigSchema | undefined {
    return this.schemas.get(connectorId);
  }

  /**
   * Get all registered schema IDs.
   */
  getRegisteredConnectors(): string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Get a single config value.
   */
  get(connectorId: string, field: string): unknown {
    const count = this.accessCounters.get(connectorId) ?? 0;
    this.accessCounters.set(connectorId, count + 1);

    const connectorConfig = this.configs.get(connectorId);
    if (!connectorConfig) {
      const defaults = this.defaultValues.get(connectorId);
      if (defaults) {
        return defaults.get(field);
      }
      return undefined;
    }

    const value = connectorConfig.get(field);
    if (value === undefined) {
      const defaults = this.defaultValues.get(connectorId);
      if (defaults) {
        return defaults.get(field);
      }
    }
    return value;
  }

  /**
   * Get all config for a connector, merging defaults.
   */
  getAll(connectorId: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const defaults = this.defaultValues.get(connectorId);
    if (defaults) {
      for (const [k, v] of Array.from(defaults.entries())) {
        result[k] = v;
      }
    }
    const connectorConfig = this.configs.get(connectorId);
    if (connectorConfig) {
      for (const [k, v] of Array.from(connectorConfig.entries())) {
        result[k] = v;
      }
    }
    return result;
  }

  /**
   * Get all config with sensitive fields masked.
   */
  getAllMasked(connectorId: string): Record<string, unknown> {
    const raw = this.getAll(connectorId);
    const sensitiveSet = this.sensitiveFields.get(connectorId);
    if (!sensitiveSet) return raw;

    const masked: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (sensitiveSet.has(k)) {
        masked[k] = this.maskValue(v);
      } else {
        masked[k] = v;
      }
    }
    return masked;
  }

  /**
   * Mask a sensitive value, showing only last 4 chars.
   */
  private maskValue(value: unknown): string {
    if (value === null || value === undefined) return "***";
    const str = String(value);
    if (str.length <= 4) return "****";
    return "*".repeat(str.length - 4) + str.slice(-4);
  }

  /**
   * Set a single config value.
   */
  set(
    connectorId: string,
    field: string,
    value: unknown,
    source: ConfigChangeEvent["source"] = "api",
    actor?: string
  ): void {
    if (this.lockedConnectors.has(connectorId)) {
      throw new Error(`Connector config '${connectorId}' is locked and cannot be modified`);
    }

    let connectorConfig = this.configs.get(connectorId);
    if (!connectorConfig) {
      connectorConfig = new Map();
      this.configs.set(connectorId, connectorConfig);
    }

    const oldValue = connectorConfig.get(field);
    if (oldValue === value) return; // No-op for same value

    connectorConfig.set(field, value);
    this.lastUpdated.set(connectorId, Date.now());
    this.validationCache.delete(connectorId);

    const wc = this.writeCounters.get(connectorId) ?? 0;
    this.writeCounters.set(connectorId, wc + 1);

    const changeEvent: ConfigChangeEvent = {
      connectorId,
      field,
      oldValue,
      newValue: value,
      source,
      timestamp: Date.now(),
      actor,
    };

    this.changeLog.push(changeEvent);
    if (this.changeLog.length > this.MAX_CHANGE_LOG) {
      this.changeLog = this.changeLog.slice(-this.MAX_CHANGE_LOG);
    }

    this.emit("config:changed", changeEvent);
    this.emit(`config:changed:${connectorId}`, changeEvent);
  }

  /**
   * Set multiple config values atomically.
   */
  setBulk(
    connectorId: string,
    values: Record<string, unknown>,
    source: ConfigChangeEvent["source"] = "api",
    actor?: string
  ): void {
    if (this.lockedConnectors.has(connectorId)) {
      throw new Error(`Connector config '${connectorId}' is locked and cannot be modified`);
    }

    this.bulkOperationInProgress = true;
    const changes: ConfigChangeEvent[] = [];

    try {
      let connectorConfig = this.configs.get(connectorId);
      if (!connectorConfig) {
        connectorConfig = new Map();
        this.configs.set(connectorId, connectorConfig);
      }

      for (const [field, value] of Object.entries(values)) {
        const oldValue = connectorConfig.get(field);
        if (oldValue === value) continue;

        connectorConfig.set(field, value);

        const changeEvent: ConfigChangeEvent = {
          connectorId,
          field,
          oldValue,
          newValue: value,
          source,
          timestamp: Date.now(),
          actor,
        };
        changes.push(changeEvent);
        this.changeLog.push(changeEvent);
      }

      if (this.changeLog.length > this.MAX_CHANGE_LOG) {
        this.changeLog = this.changeLog.slice(-this.MAX_CHANGE_LOG);
      }

      this.lastUpdated.set(connectorId, Date.now());
      this.validationCache.delete(connectorId);

      const wc = this.writeCounters.get(connectorId) ?? 0;
      this.writeCounters.set(connectorId, wc + changes.length);
    } finally {
      this.bulkOperationInProgress = false;
    }

    // Emit events after bulk operation is complete
    for (const change of changes) {
      this.emit("config:changed", change);
    }
    if (changes.length > 0) {
      this.emit("config:bulk_updated", { connectorId, changeCount: changes.length, source, actor });
    }
  }

  /**
   * Delete a config field.
   */
  delete(connectorId: string, field: string, source: ConfigChangeEvent["source"] = "api"): boolean {
    if (this.lockedConnectors.has(connectorId)) {
      throw new Error(`Connector config '${connectorId}' is locked`);
    }
    const connectorConfig = this.configs.get(connectorId);
    if (!connectorConfig) return false;

    const oldValue = connectorConfig.get(field);
    if (oldValue === undefined) return false;

    connectorConfig.delete(field);
    this.validationCache.delete(connectorId);
    this.lastUpdated.set(connectorId, Date.now());

    this.emit("config:changed", {
      connectorId,
      field,
      oldValue,
      newValue: undefined,
      source,
      timestamp: Date.now(),
    });
    return true;
  }

  /**
   * Delete all config for a connector.
   */
  deleteAll(connectorId: string): void {
    this.configs.delete(connectorId);
    this.validationCache.delete(connectorId);
    this.lastUpdated.delete(connectorId);
    this.emit("config:cleared", { connectorId, timestamp: Date.now() });
  }

  /**
   * Validate config against its schema.
   */
  validate(connectorId: string): ConfigValidationResult {
    const cached = this.validationCache.get(connectorId);
    if (cached) return cached;

    const schema = this.schemas.get(connectorId);
    if (!schema) {
      const result: ConfigValidationResult = {
        valid: true,
        errors: [],
        warnings: [{ field: "*", message: "No schema registered", code: "NO_SCHEMA" }],
      };
      return result;
    }

    const errors: ConfigValidationResult["errors"] = [];
    const warnings: ConfigValidationResult["warnings"] = [];
    const config = this.getAll(connectorId);

    for (const field of schema.fields) {
      const value = config[field.name];

      // Check required fields
      if (field.required && (value === undefined || value === null || value === "")) {
        errors.push({
          field: field.name,
          message: `Required field '${field.name}' is missing`,
          code: "REQUIRED",
        });
        continue;
      }

      if (value === undefined || value === null) continue;

      // Type validation
      if (field.type === "string" || field.type === "secret") {
        if (typeof value !== "string") {
          errors.push({
            field: field.name,
            message: `Expected string, got ${typeof value}`,
            code: "TYPE_MISMATCH",
          });
        } else if (field.validationRegex) {
          try {
            const regex = new RegExp(field.validationRegex);
            if (!regex.test(value)) {
              errors.push({
                field: field.name,
                message: `Value does not match pattern: ${field.validationRegex}`,
                code: "PATTERN_MISMATCH",
              });
            }
          } catch {
            warnings.push({
              field: field.name,
              message: `Invalid validation regex: ${field.validationRegex}`,
              code: "INVALID_REGEX",
            });
          }
        }
        if (field.enumValues && field.enumValues.length > 0) {
          if (!field.enumValues.includes(String(value))) {
            errors.push({
              field: field.name,
              message: `Value must be one of: ${field.enumValues.join(", ")}`,
              code: "ENUM_MISMATCH",
            });
          }
        }
      } else if (field.type === "number") {
        const num = typeof value === "number" ? value : Number(value);
        if (isNaN(num)) {
          errors.push({
            field: field.name,
            message: `Expected number, got ${typeof value}`,
            code: "TYPE_MISMATCH",
          });
        } else {
          if (field.minValue !== undefined && num < field.minValue) {
            errors.push({
              field: field.name,
              message: `Value ${num} is below minimum ${field.minValue}`,
              code: "MIN_VALUE",
            });
          }
          if (field.maxValue !== undefined && num > field.maxValue) {
            errors.push({
              field: field.name,
              message: `Value ${num} exceeds maximum ${field.maxValue}`,
              code: "MAX_VALUE",
            });
          }
        }
      } else if (field.type === "boolean") {
        if (typeof value !== "boolean" && value !== "true" && value !== "false") {
          errors.push({
            field: field.name,
            message: `Expected boolean, got ${typeof value}`,
            code: "TYPE_MISMATCH",
          });
        }
      } else if (field.type === "json") {
        if (typeof value === "string") {
          try {
            JSON.parse(value);
          } catch {
            errors.push({
              field: field.name,
              message: "Invalid JSON string",
              code: "INVALID_JSON",
            });
          }
        } else if (typeof value !== "object") {
          errors.push({
            field: field.name,
            message: `Expected JSON object or valid JSON string, got ${typeof value}`,
            code: "TYPE_MISMATCH",
          });
        }
      }

      // Deprecation warnings
      if (field.deprecated) {
        warnings.push({
          field: field.name,
          message: field.deprecationMessage || `Field '${field.name}' is deprecated`,
          code: "DEPRECATED",
        });
      }
    }

    // Check for unknown fields
    const knownFields = new Set(schema.fields.map((f) => f.name));
    for (const key of Object.keys(config)) {
      if (!knownFields.has(key)) {
        warnings.push({
          field: key,
          message: `Unknown field '${key}' not in schema`,
          code: "UNKNOWN_FIELD",
        });
      }
    }

    const result: ConfigValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
    };

    this.validationCache.set(connectorId, result);
    return result;
  }

  /**
   * Get default values for a connector.
   */
  getDefaults(connectorId: string): Record<string, unknown> {
    const defaults = this.defaultValues.get(connectorId);
    if (!defaults) return {};
    const result: Record<string, unknown> = {};
    for (const [k, v] of Array.from(defaults.entries())) {
      result[k] = v;
    }
    return result;
  }

  /**
   * Diff two connector configs.
   */
  diff(
    connectorIdA: string,
    connectorIdB: string
  ): Array<{ field: string; valueA: unknown; valueB: unknown; status: "added" | "removed" | "changed" | "unchanged" }> {
    const configA = this.getAll(connectorIdA);
    const configB = this.getAll(connectorIdB);
    const allKeys = new Set([...Object.keys(configA), ...Object.keys(configB)]);
    const diffs: Array<{
      field: string;
      valueA: unknown;
      valueB: unknown;
      status: "added" | "removed" | "changed" | "unchanged";
    }> = [];

    for (const key of Array.from(allKeys)) {
      const valA = configA[key];
      const valB = configB[key];
      if (valA === undefined && valB !== undefined) {
        diffs.push({ field: key, valueA: undefined, valueB: valB, status: "added" });
      } else if (valA !== undefined && valB === undefined) {
        diffs.push({ field: key, valueA: valA, valueB: undefined, status: "removed" });
      } else if (JSON.stringify(valA) !== JSON.stringify(valB)) {
        diffs.push({ field: key, valueA: valA, valueB: valB, status: "changed" });
      } else {
        diffs.push({ field: key, valueA: valA, valueB: valB, status: "unchanged" });
      }
    }

    return diffs;
  }

  /**
   * Diff current config against a snapshot.
   */
  diffWithSnapshot(
    connectorId: string,
    snapshot: Record<string, unknown>
  ): Array<{ field: string; current: unknown; snapshot: unknown; status: "added" | "removed" | "changed" | "unchanged" }> {
    const current = this.getAll(connectorId);
    const allKeys = new Set([...Object.keys(current), ...Object.keys(snapshot)]);
    const diffs: Array<{
      field: string;
      current: unknown;
      snapshot: unknown;
      status: "added" | "removed" | "changed" | "unchanged";
    }> = [];

    for (const key of Array.from(allKeys)) {
      const cur = current[key];
      const snap = snapshot[key];
      if (cur === undefined && snap !== undefined) {
        diffs.push({ field: key, current: undefined, snapshot: snap, status: "removed" });
      } else if (cur !== undefined && snap === undefined) {
        diffs.push({ field: key, current: cur, snapshot: undefined, status: "added" });
      } else if (JSON.stringify(cur) !== JSON.stringify(snap)) {
        diffs.push({ field: key, current: cur, snapshot: snap, status: "changed" });
      } else {
        diffs.push({ field: key, current: cur, snapshot: snap, status: "unchanged" });
      }
    }
    return diffs;
  }

  /**
   * Lock a connector config to prevent changes.
   */
  lock(connectorId: string): void {
    this.lockedConnectors.add(connectorId);
    this.emit("config:locked", { connectorId, timestamp: Date.now() });
  }

  /**
   * Unlock a connector config.
   */
  unlock(connectorId: string): void {
    this.lockedConnectors.delete(connectorId);
    this.emit("config:unlocked", { connectorId, timestamp: Date.now() });
  }

  /**
   * Check if a connector config is locked.
   */
  isLocked(connectorId: string): boolean {
    return this.lockedConnectors.has(connectorId);
  }

  /**
   * Get the change log, optionally filtered.
   */
  getChangeLog(connectorId?: string, limit = 100): ConfigChangeEvent[] {
    let log = this.changeLog;
    if (connectorId) {
      log = log.filter((e) => e.connectorId === connectorId);
    }
    return log.slice(-limit);
  }

  /**
   * Get the last updated timestamp for a connector.
   */
  getLastUpdated(connectorId: string): number | undefined {
    return this.lastUpdated.get(connectorId);
  }

  /**
   * Check if any config exists for a connector.
   */
  has(connectorId: string): boolean {
    return this.configs.has(connectorId) || this.schemas.has(connectorId);
  }

  /**
   * Get access count for analytics.
   */
  getAccessCount(connectorId: string): number {
    return this.accessCounters.get(connectorId) ?? 0;
  }

  /**
   * Get write count for analytics.
   */
  getWriteCount(connectorId: string): number {
    return this.writeCounters.get(connectorId) ?? 0;
  }

  /**
   * Set tags on a connector config field.
   */
  setTags(connectorId: string, field: string, tags: string[]): void {
    let connectorTags = this.tags.get(connectorId);
    if (!connectorTags) {
      connectorTags = new Map();
      this.tags.set(connectorId, connectorTags);
    }
    connectorTags.set(field, tags);
  }

  /**
   * Get tags for a connector config field.
   */
  getTags(connectorId: string, field: string): string[] {
    const connectorTags = this.tags.get(connectorId);
    if (!connectorTags) return [];
    return connectorTags.get(field) ?? [];
  }

  /**
   * Get a summary of the store's state.
   */
  getSummary(): {
    connectorCount: number;
    schemaCount: number;
    changeLogSize: number;
    lockedCount: number;
  } {
    return {
      connectorCount: this.configs.size,
      schemaCount: this.schemas.size,
      changeLogSize: this.changeLog.length,
      lockedCount: this.lockedConnectors.size,
    };
  }

  /**
   * Reset the entire store.
   */
  reset(): void {
    this.configs.clear();
    this.schemas.clear();
    this.changeLog = [];
    this.lastUpdated.clear();
    this.lockedConnectors.clear();
    this.sensitiveFields.clear();
    this.defaultValues.clear();
    this.validationCache.clear();
    this.accessCounters.clear();
    this.writeCounters.clear();
    this.tags.clear();
    this.emit("store:reset", { timestamp: Date.now() });
  }
}

/* ------------------------------------------------------------------ */
/*  ConfigWatcher                                                      */
/* ------------------------------------------------------------------ */

export class ConfigWatcher extends EventEmitter {
  private watchedPaths: Map<string, { lastHash: string; lastModified: number }>;
  private pollIntervalMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  private debounceMs: number;
  private running: boolean;
  private errorCounts: Map<string, number>;
  private readonly MAX_ERRORS = 10;
  private watchCallbacks: Map<string, Array<(data: Record<string, unknown>) => void>>;
  private lastPollTime: number;
  private pollCount: number;
  private fileContentCache: Map<string, string>;
  private atomicUpdateLocks: Set<string>;
  private pausedPaths: Set<string>;

  constructor(pollIntervalMs = 5000, debounceMs = 1000) {
    super();
    this.watchedPaths = new Map();
    this.pollIntervalMs = pollIntervalMs;
    this.pollTimer = null;
    this.debounceTimers = new Map();
    this.debounceMs = debounceMs;
    this.running = false;
    this.errorCounts = new Map();
    this.watchCallbacks = new Map();
    this.lastPollTime = 0;
    this.pollCount = 0;
    this.fileContentCache = new Map();
    this.atomicUpdateLocks = new Set();
    this.pausedPaths = new Set();
  }

  /**
   * Start watching for config changes.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
    this.emit("watcher:started", { interval: this.pollIntervalMs, timestamp: Date.now() });
  }

  /**
   * Stop watching.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const timer of Array.from(this.debounceTimers.values())) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.emit("watcher:stopped", { timestamp: Date.now() });
  }

  /**
   * Add a file path to watch.
   */
  watch(filePath: string, callback?: (data: Record<string, unknown>) => void): void {
    if (!this.watchedPaths.has(filePath)) {
      this.watchedPaths.set(filePath, { lastHash: "", lastModified: 0 });
      this.errorCounts.set(filePath, 0);
    }
    if (callback) {
      const callbacks = this.watchCallbacks.get(filePath) ?? [];
      callbacks.push(callback);
      this.watchCallbacks.set(filePath, callbacks);
    }
    this.emit("watcher:added", { path: filePath, timestamp: Date.now() });
  }

  /**
   * Remove a watched path.
   */
  unwatch(filePath: string): void {
    this.watchedPaths.delete(filePath);
    this.errorCounts.delete(filePath);
    this.watchCallbacks.delete(filePath);
    this.fileContentCache.delete(filePath);
    const timer = this.debounceTimers.get(filePath);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(filePath);
    }
    this.emit("watcher:removed", { path: filePath, timestamp: Date.now() });
  }

  /**
   * Pause watching a specific path.
   */
  pause(filePath: string): void {
    this.pausedPaths.add(filePath);
  }

  /**
   * Resume watching a specific path.
   */
  resume(filePath: string): void {
    this.pausedPaths.delete(filePath);
  }

  /**
   * Perform a single poll cycle.
   */
  private async poll(): Promise<void> {
    this.lastPollTime = Date.now();
    this.pollCount++;

    for (const [filePath, state] of Array.from(this.watchedPaths.entries())) {
      if (this.pausedPaths.has(filePath)) continue;
      if (this.atomicUpdateLocks.has(filePath)) continue;

      try {
        const content = await this.readFile(filePath);
        if (content === null) continue;

        const hash = cryptoMod.createHash("sha256").update(content).digest("hex");
        if (hash === state.lastHash) continue;

        // Content has changed — debounce the notification
        this.debounceChange(filePath, content, hash);
      } catch (err: unknown) {
        const count = (this.errorCounts.get(filePath) ?? 0) + 1;
        this.errorCounts.set(filePath, count);
        const msg = err instanceof Error ? err.message : String(err);
        this.emit("watcher:error", { path: filePath, error: msg, errorCount: count });

        if (count >= this.MAX_ERRORS) {
          this.unwatch(filePath);
          this.emit("watcher:max_errors", { path: filePath, count });
        }
      }
    }
  }

  /**
   * Debounce change notifications.
   */
  private debounceChange(filePath: string, content: string, hash: string): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.processChange(filePath, content, hash);
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Process a confirmed file change.
   */
  private processChange(filePath: string, content: string, hash: string): void {
    const state = this.watchedPaths.get(filePath);
    if (!state) return;

    const oldHash = state.lastHash;
    state.lastHash = hash;
    state.lastModified = Date.now();
    this.fileContentCache.set(filePath, content);
    this.errorCounts.set(filePath, 0);

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      this.emit("watcher:parse_error", { path: filePath, hash });
      return;
    }

    this.emit("config:file_changed", {
      path: filePath,
      oldHash,
      newHash: hash,
      data: parsed,
      timestamp: Date.now(),
    });

    const callbacks = this.watchCallbacks.get(filePath) ?? [];
    for (const cb of callbacks) {
      try {
        cb(parsed);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.emit("watcher:callback_error", { path: filePath, error: msg });
      }
    }
  }

  /**
   * Read a file (stub — in real impl, use fs.readFile).
   */
  private async readFile(filePath: string): Promise<string | null> {
    try {
      const fs = require("fs").promises;
      const content = await fs.readFile(filePath, "utf-8");
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Begin an atomic update — pauses watching for the given path.
   */
  beginAtomicUpdate(filePath: string): void {
    this.atomicUpdateLocks.add(filePath);
  }

  /**
   * Complete an atomic update — resumes watching and forces a re-read.
   */
  async completeAtomicUpdate(filePath: string): Promise<void> {
    this.atomicUpdateLocks.delete(filePath);
    // Force a re-read on next poll
    const state = this.watchedPaths.get(filePath);
    if (state) {
      state.lastHash = "";
    }
  }

  /**
   * Get watcher stats.
   */
  getStats(): {
    running: boolean;
    watchedCount: number;
    pollCount: number;
    lastPollTime: number;
    errors: Record<string, number>;
  } {
    const errors: Record<string, number> = {};
    for (const [path, count] of Array.from(this.errorCounts.entries())) {
      errors[path] = count;
    }
    return {
      running: this.running,
      watchedCount: this.watchedPaths.size,
      pollCount: this.pollCount,
      lastPollTime: this.lastPollTime,
      errors,
    };
  }

  /**
   * Get all watched paths.
   */
  getWatchedPaths(): string[] {
    return Array.from(this.watchedPaths.keys());
  }
}

/* ------------------------------------------------------------------ */
/*  ConfigVersionControl                                               */
/* ------------------------------------------------------------------ */

export class ConfigVersionControl extends EventEmitter {
  private snapshots: Map<string, ConfigSnapshot[]>;
  private readonly MAX_SNAPSHOTS_PER_CONNECTOR = 50;
  private versionCounters: Map<string, number>;
  private tagIndex: Map<string, Map<string, string>>;  // tag -> connectorId -> snapshotId

  constructor() {
    super();
    this.snapshots = new Map();
    this.versionCounters = new Map();
    this.tagIndex = new Map();
  }

  /**
   * Take a snapshot of a connector's config.
   */
  snapshot(
    connectorId: string,
    config: Record<string, unknown>,
    createdBy = "system",
    description?: string,
    tags?: string[]
  ): ConfigSnapshot {
    const version = (this.versionCounters.get(connectorId) ?? 0) + 1;
    this.versionCounters.set(connectorId, version);

    const configJson = JSON.stringify(config, null, 2);
    const hash = cryptoMod.createHash("sha256").update(configJson).digest("hex");

    const snap: ConfigSnapshot = {
      id: `snap_${connectorId}_${version}_${Date.now()}`,
      connectorId,
      config: JSON.parse(JSON.stringify(config)),
      hash,
      version,
      createdAt: Date.now(),
      createdBy,
      description,
      tags,
    };

    let connectorSnapshots = this.snapshots.get(connectorId);
    if (!connectorSnapshots) {
      connectorSnapshots = [];
      this.snapshots.set(connectorId, connectorSnapshots);
    }

    connectorSnapshots.push(snap);

    // Trim to max snapshots
    if (connectorSnapshots.length > this.MAX_SNAPSHOTS_PER_CONNECTOR) {
      const removed = connectorSnapshots.splice(
        0,
        connectorSnapshots.length - this.MAX_SNAPSHOTS_PER_CONNECTOR
      );
      for (const r of removed) {
        this.emit("snapshot:pruned", { connectorId, snapshotId: r.id, version: r.version });
      }
    }

    // Index tags
    if (tags) {
      for (const tag of tags) {
        let tagMap = this.tagIndex.get(tag);
        if (!tagMap) {
          tagMap = new Map();
          this.tagIndex.set(tag, tagMap);
        }
        tagMap.set(connectorId, snap.id);
      }
    }

    this.emit("snapshot:created", {
      connectorId,
      snapshotId: snap.id,
      version,
      hash,
      timestamp: Date.now(),
    });

    return snap;
  }

  /**
   * Get the latest snapshot for a connector.
   */
  getLatest(connectorId: string): ConfigSnapshot | undefined {
    const snaps = this.snapshots.get(connectorId);
    if (!snaps || snaps.length === 0) return undefined;
    return snaps[snaps.length - 1];
  }

  /**
   * Get a specific snapshot by ID.
   */
  getById(connectorId: string, snapshotId: string): ConfigSnapshot | undefined {
    const snaps = this.snapshots.get(connectorId);
    if (!snaps) return undefined;
    return snaps.find((s) => s.id === snapshotId);
  }

  /**
   * Get a snapshot by version number.
   */
  getByVersion(connectorId: string, version: number): ConfigSnapshot | undefined {
    const snaps = this.snapshots.get(connectorId);
    if (!snaps) return undefined;
    return snaps.find((s) => s.version === version);
  }

  /**
   * Rollback to a specific snapshot version.
   */
  rollback(connectorId: string, version: number): ConfigSnapshot | undefined {
    const snap = this.getByVersion(connectorId, version);
    if (!snap) return undefined;

    // Create a new snapshot from the rollback target
    const rollbackSnap = this.snapshot(
      connectorId,
      snap.config,
      "rollback",
      `Rollback to version ${version}`,
      ["rollback"]
    );

    this.emit("snapshot:rollback", {
      connectorId,
      targetVersion: version,
      newVersion: rollbackSnap.version,
      timestamp: Date.now(),
    });

    return rollbackSnap;
  }

  /**
   * Rollback to the previous snapshot.
   */
  rollbackToPrevious(connectorId: string): ConfigSnapshot | undefined {
    const snaps = this.snapshots.get(connectorId);
    if (!snaps || snaps.length < 2) return undefined;
    const prev = snaps[snaps.length - 2];
    return this.rollback(connectorId, prev.version);
  }

  /**
   * Get version history for a connector.
   */
  getHistory(connectorId: string, limit = 20): ConfigSnapshot[] {
    const snaps = this.snapshots.get(connectorId);
    if (!snaps) return [];
    return snaps.slice(-limit).reverse();
  }

  /**
   * Compare two snapshot versions.
   */
  compare(
    connectorId: string,
    versionA: number,
    versionB: number
  ): Array<{ field: string; versionA: unknown; versionB: unknown; status: "added" | "removed" | "changed" | "unchanged" }> {
    const snapA = this.getByVersion(connectorId, versionA);
    const snapB = this.getByVersion(connectorId, versionB);
    if (!snapA || !snapB) return [];

    const allKeys = new Set([...Object.keys(snapA.config), ...Object.keys(snapB.config)]);
    const diffs: Array<{
      field: string;
      versionA: unknown;
      versionB: unknown;
      status: "added" | "removed" | "changed" | "unchanged";
    }> = [];

    for (const key of Array.from(allKeys)) {
      const valA = snapA.config[key];
      const valB = snapB.config[key];
      if (valA === undefined && valB !== undefined) {
        diffs.push({ field: key, versionA: undefined, versionB: valB, status: "added" });
      } else if (valA !== undefined && valB === undefined) {
        diffs.push({ field: key, versionA: valA, versionB: undefined, status: "removed" });
      } else if (JSON.stringify(valA) !== JSON.stringify(valB)) {
        diffs.push({ field: key, versionA: valA, versionB: valB, status: "changed" });
      } else {
        diffs.push({ field: key, versionA: valA, versionB: valB, status: "unchanged" });
      }
    }
    return diffs;
  }

  /**
   * Find snapshots by tag.
   */
  findByTag(tag: string): Array<{ connectorId: string; snapshotId: string }> {
    const tagMap = this.tagIndex.get(tag);
    if (!tagMap) return [];
    return Array.from(tagMap.entries()).map(([connectorId, snapshotId]) => ({
      connectorId,
      snapshotId,
    }));
  }

  /**
   * Get the total snapshot count across all connectors.
   */
  getTotalSnapshotCount(): number {
    let total = 0;
    for (const snaps of Array.from(this.snapshots.values())) {
      total += snaps.length;
    }
    return total;
  }

  /**
   * Get snapshot count for a connector.
   */
  getSnapshotCount(connectorId: string): number {
    const snaps = this.snapshots.get(connectorId);
    return snaps ? snaps.length : 0;
  }

  /**
   * Clear all snapshots for a connector.
   */
  clearHistory(connectorId: string): void {
    this.snapshots.delete(connectorId);
    this.versionCounters.delete(connectorId);
    this.emit("snapshot:cleared", { connectorId, timestamp: Date.now() });
  }

  /**
   * Get all connector IDs with snapshots.
   */
  getTrackedConnectors(): string[] {
    return Array.from(this.snapshots.keys());
  }
}

/* ------------------------------------------------------------------ */
/*  FeatureFlagManager                                                 */
/* ------------------------------------------------------------------ */

export class FeatureFlagManager extends EventEmitter {
  private flags: Map<string, FeatureFlagEntry>;
  private changeHistory: FeatureFlagChange[];
  private readonly MAX_HISTORY = 2000;
  private evaluationCache: Map<string, Map<string, boolean>>;
  private evaluationCacheTTL: number;
  private evaluationCacheTimestamps: Map<string, number>;

  constructor(cacheTTLMs = 60000) {
    super();
    this.flags = new Map();
    this.changeHistory = [];
    this.evaluationCache = new Map();
    this.evaluationCacheTTL = cacheTTLMs;
    this.evaluationCacheTimestamps = new Map();
  }

  /**
   * Create or update a feature flag.
   */
  setFlag(
    name: string,
    entry: Partial<FeatureFlagEntry> & { enabled: boolean },
    actor?: string
  ): void {
    const existing = this.flags.get(name);
    const now = Date.now();

    const fullEntry: FeatureFlagEntry = {
      name,
      enabled: entry.enabled,
      percentage: entry.percentage,
      connectorOverrides: entry.connectorOverrides ?? existing?.connectorOverrides,
      userOverrides: entry.userOverrides ?? existing?.userOverrides,
      globalOverride: entry.globalOverride ?? existing?.globalOverride,
      description: entry.description ?? existing?.description,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: entry.expiresAt ?? existing?.expiresAt,
    };

    this.flags.set(name, fullEntry);
    this.invalidateFlagCache(name);

    if (existing) {
      // Track changes
      for (const [key, val] of Object.entries(fullEntry) as [string, unknown][]) {
        const oldVal = (existing as Record<string, unknown>)[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(val)) {
          const change: FeatureFlagChange = {
            flagName: name,
            field: key,
            oldValue: oldVal,
            newValue: val,
            timestamp: now,
            actor,
          };
          this.changeHistory.push(change);
        }
      }
    }

    if (this.changeHistory.length > this.MAX_HISTORY) {
      this.changeHistory = this.changeHistory.slice(-this.MAX_HISTORY);
    }

    this.emit("flag:updated", { name, entry: fullEntry, actor, timestamp: now });
  }

  /**
   * Remove a feature flag.
   */
  removeFlag(name: string): boolean {
    const existed = this.flags.delete(name);
    this.invalidateFlagCache(name);
    if (existed) {
      this.emit("flag:removed", { name, timestamp: Date.now() });
    }
    return existed;
  }

  /**
   * Evaluate a flag for a given context.
   */
  isEnabled(name: string, context?: { connectorId?: string; userId?: string }): boolean {
    const flag = this.flags.get(name);
    if (!flag) return false;

    // Check expiration
    if (flag.expiresAt && Date.now() > flag.expiresAt) {
      return false;
    }

    // Global override takes precedence
    if (flag.globalOverride !== undefined) {
      return flag.globalOverride;
    }

    // User override
    if (context?.userId && flag.userOverrides) {
      const userOverride = flag.userOverrides[context.userId];
      if (userOverride !== undefined) return userOverride;
    }

    // Connector override
    if (context?.connectorId && flag.connectorOverrides) {
      const connOverride = flag.connectorOverrides[context.connectorId];
      if (connOverride !== undefined) return connOverride;
    }

    // Not enabled at all
    if (!flag.enabled) return false;

    // Percentage-based rollout
    if (flag.percentage !== undefined && flag.percentage < 100) {
      const identifier = context?.userId ?? context?.connectorId ?? "global";
      return this.deterministicHashCheck(name, identifier, flag.percentage);
    }

    return flag.enabled;
  }

  /**
   * Deterministic hash-based percentage check.
   */
  private deterministicHashCheck(flagName: string, identifier: string, percentage: number): boolean {
    const cacheKey = `${flagName}:${identifier}`;
    const cachedEntry = this.evaluationCache.get(flagName);
    const cachedTimestamp = this.evaluationCacheTimestamps.get(cacheKey);

    if (cachedEntry && cachedTimestamp && Date.now() - cachedTimestamp < this.evaluationCacheTTL) {
      const cached = cachedEntry.get(identifier);
      if (cached !== undefined) return cached;
    }

    const hash = cryptoMod
      .createHash("sha256")
      .update(`${flagName}:${identifier}`)
      .digest("hex");
    const hashNum = parseInt(hash.substring(0, 8), 16);
    const normalized = hashNum / 0xffffffff;
    const result = normalized * 100 < percentage;

    // Cache result
    let flagCache = this.evaluationCache.get(flagName);
    if (!flagCache) {
      flagCache = new Map();
      this.evaluationCache.set(flagName, flagCache);
    }
    flagCache.set(identifier, result);
    this.evaluationCacheTimestamps.set(cacheKey, Date.now());

    return result;
  }

  /**
   * Invalidate the evaluation cache for a flag.
   */
  private invalidateFlagCache(name: string): void {
    this.evaluationCache.delete(name);
    // Clean up timestamps
    const prefix = `${name}:`;
    const keysToDelete: string[] = [];
    for (const key of Array.from(this.evaluationCacheTimestamps.keys())) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.evaluationCacheTimestamps.delete(key);
    }
  }

  /**
   * Get a flag entry.
   */
  getFlag(name: string): FeatureFlagEntry | undefined {
    return this.flags.get(name);
  }

  /**
   * Get all flags.
   */
  getAllFlags(): FeatureFlagEntry[] {
    return Array.from(this.flags.values());
  }

  /**
   * Get all flag names.
   */
  getFlagNames(): string[] {
    return Array.from(this.flags.keys());
  }

  /**
   * Get change history.
   */
  getHistory(flagName?: string, limit = 50): FeatureFlagChange[] {
    let history = this.changeHistory;
    if (flagName) {
      history = history.filter((c) => c.flagName === flagName);
    }
    return history.slice(-limit);
  }

  /**
   * Set a connector-level override.
   */
  setConnectorOverride(flagName: string, connectorId: string, enabled: boolean): void {
    const flag = this.flags.get(flagName);
    if (!flag) return;

    if (!flag.connectorOverrides) {
      flag.connectorOverrides = {};
    }
    flag.connectorOverrides[connectorId] = enabled;
    flag.updatedAt = Date.now();
    this.invalidateFlagCache(flagName);
    this.emit("flag:connector_override", { flagName, connectorId, enabled, timestamp: Date.now() });
  }

  /**
   * Set a user-level override.
   */
  setUserOverride(flagName: string, userId: string, enabled: boolean): void {
    const flag = this.flags.get(flagName);
    if (!flag) return;

    if (!flag.userOverrides) {
      flag.userOverrides = {};
    }
    flag.userOverrides[userId] = enabled;
    flag.updatedAt = Date.now();
    this.invalidateFlagCache(flagName);
    this.emit("flag:user_override", { flagName, userId, enabled, timestamp: Date.now() });
  }

  /**
   * Remove all overrides for a flag.
   */
  clearOverrides(flagName: string): void {
    const flag = this.flags.get(flagName);
    if (!flag) return;
    flag.connectorOverrides = undefined;
    flag.userOverrides = undefined;
    flag.globalOverride = undefined;
    flag.updatedAt = Date.now();
    this.invalidateFlagCache(flagName);
    this.emit("flag:overrides_cleared", { flagName, timestamp: Date.now() });
  }

  /**
   * Get all expired flags.
   */
  getExpiredFlags(): FeatureFlagEntry[] {
    const now = Date.now();
    return Array.from(this.flags.values()).filter(
      (f) => f.expiresAt !== undefined && f.expiresAt < now
    );
  }

  /**
   * Clean up expired flags.
   */
  cleanupExpired(): number {
    const expired = this.getExpiredFlags();
    for (const flag of expired) {
      this.flags.delete(flag.name);
      this.invalidateFlagCache(flag.name);
    }
    if (expired.length > 0) {
      this.emit("flags:cleanup", { count: expired.length, timestamp: Date.now() });
    }
    return expired.length;
  }

  /**
   * Get summary statistics.
   */
  getSummary(): {
    total: number;
    enabled: number;
    disabled: number;
    percentageBased: number;
    expired: number;
    withOverrides: number;
  } {
    const all = Array.from(this.flags.values());
    const now = Date.now();
    return {
      total: all.length,
      enabled: all.filter((f) => f.enabled).length,
      disabled: all.filter((f) => !f.enabled).length,
      percentageBased: all.filter((f) => f.percentage !== undefined).length,
      expired: all.filter((f) => f.expiresAt !== undefined && f.expiresAt < now).length,
      withOverrides: all.filter(
        (f) =>
          (f.connectorOverrides && Object.keys(f.connectorOverrides).length > 0) ||
          (f.userOverrides && Object.keys(f.userOverrides).length > 0) ||
          f.globalOverride !== undefined
      ).length,
    };
  }
}

/* ------------------------------------------------------------------ */
/*  ConfigEnvironmentResolver                                          */
/* ------------------------------------------------------------------ */

export class ConfigEnvironmentResolver {
  private envPrefix: string;
  private dbProvider: (() => Promise<Record<string, Record<string, unknown>>>) | null;
  private fileProvider: (() => Promise<Record<string, Record<string, unknown>>>) | null;
  private resolutionOrder: Array<"env" | "db" | "file" | "default">;
  private resolvedCache: Map<string, { value: unknown; source: string; timestamp: number }>;
  private cacheTTLMs: number;
  private sensitivePatterns: RegExp[];
  private resolutionLog: Array<{
    connectorId: string;
    field: string;
    source: string;
    timestamp: number;
  }>;
  private readonly MAX_RESOLUTION_LOG = 1000;

  constructor(options?: {
    envPrefix?: string;
    resolutionOrder?: Array<"env" | "db" | "file" | "default">;
    cacheTTLMs?: number;
  }) {
    this.envPrefix = options?.envPrefix ?? "CONNECTOR";
    this.dbProvider = null;
    this.fileProvider = null;
    this.resolutionOrder = options?.resolutionOrder ?? ["env", "db", "file", "default"];
    this.resolvedCache = new Map();
    this.cacheTTLMs = options?.cacheTTLMs ?? 300000; // 5 min
    this.sensitivePatterns = [
      /secret/i,
      /password/i,
      /token/i,
      /api_key/i,
      /apikey/i,
      /private_key/i,
    ];
    this.resolutionLog = [];
  }

  /**
   * Set the DB provider for config resolution.
   */
  setDbProvider(provider: () => Promise<Record<string, Record<string, unknown>>>): void {
    this.dbProvider = provider;
  }

  /**
   * Set the file provider for config resolution.
   */
  setFileProvider(provider: () => Promise<Record<string, Record<string, unknown>>>): void {
    this.fileProvider = provider;
  }

  /**
   * Resolve a single config value using the resolution chain.
   */
  async resolve(
    connectorId: string,
    field: string,
    schema?: ConnectorConfigSchema
  ): Promise<{ value: unknown; source: string }> {
    // Check cache
    const cacheKey = `${connectorId}:${field}`;
    const cached = this.resolvedCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTLMs) {
      return { value: cached.value, source: cached.source };
    }

    const isSensitive = this.isSensitiveField(field);

    for (const source of this.resolutionOrder) {
      let value: unknown = undefined;

      switch (source) {
        case "env": {
          const envKey = this.buildEnvKey(connectorId, field);
          value = process.env[envKey];
          if (value === undefined) {
            // Also try uppercase normalized
            const altKey = this.buildEnvKey(connectorId, field).toUpperCase();
            value = process.env[altKey];
          }
          break;
        }
        case "db": {
          if (isSensitive) continue; // Secrets only from env
          if (this.dbProvider) {
            try {
              const dbConfigs = await this.dbProvider();
              const connectorConfig = dbConfigs[connectorId];
              if (connectorConfig) {
                value = connectorConfig[field];
              }
            } catch {
              // DB unavailable, continue
            }
          }
          break;
        }
        case "file": {
          if (isSensitive) continue; // Secrets only from env
          if (this.fileProvider) {
            try {
              const fileConfigs = await this.fileProvider();
              const connectorConfig = fileConfigs[connectorId];
              if (connectorConfig) {
                value = connectorConfig[field];
              }
            } catch {
              // File unavailable, continue
            }
          }
          break;
        }
        case "default": {
          if (schema) {
            const fieldDef = schema.fields.find((f) => f.name === field);
            if (fieldDef && fieldDef.defaultValue !== undefined) {
              value = fieldDef.defaultValue;
            }
          }
          break;
        }
      }

      if (value !== undefined) {
        // Cache the resolved value
        this.resolvedCache.set(cacheKey, {
          value,
          source,
          timestamp: Date.now(),
        });

        this.logResolution(connectorId, field, source);
        return { value, source };
      }
    }

    this.logResolution(connectorId, field, "none");
    return { value: undefined, source: "none" };
  }

  /**
   * Resolve all fields for a connector.
   */
  async resolveAll(
    connectorId: string,
    schema: ConnectorConfigSchema
  ): Promise<Record<string, { value: unknown; source: string }>> {
    const results: Record<string, { value: unknown; source: string }> = {};
    for (const field of schema.fields) {
      results[field.name] = await this.resolve(connectorId, field.name, schema);
    }
    return results;
  }

  /**
   * Build the environment variable key.
   * Convention: CONNECTOR_{ID}_{FIELD} (all uppercase, hyphens to underscores).
   */
  private buildEnvKey(connectorId: string, field: string): string {
    const normalizedId = connectorId.replace(/-/g, "_").toUpperCase();
    const normalizedField = field.replace(/-/g, "_").toUpperCase();
    return `${this.envPrefix}_${normalizedId}_${normalizedField}`;
  }

  /**
   * Check if a field name matches sensitive patterns.
   */
  private isSensitiveField(field: string): boolean {
    return this.sensitivePatterns.some((pattern) => pattern.test(field));
  }

  /**
   * Log a resolution for diagnostics.
   */
  private logResolution(connectorId: string, field: string, source: string): void {
    this.resolutionLog.push({
      connectorId,
      field,
      source,
      timestamp: Date.now(),
    });
    if (this.resolutionLog.length > this.MAX_RESOLUTION_LOG) {
      this.resolutionLog = this.resolutionLog.slice(-this.MAX_RESOLUTION_LOG);
    }
  }

  /**
   * Invalidate cache.
   */
  invalidateCache(connectorId?: string): void {
    if (connectorId) {
      const prefix = `${connectorId}:`;
      for (const key of Array.from(this.resolvedCache.keys())) {
        if (key.startsWith(prefix)) {
          this.resolvedCache.delete(key);
        }
      }
    } else {
      this.resolvedCache.clear();
    }
  }

  /**
   * Get resolution log.
   */
  getResolutionLog(connectorId?: string, limit = 50): typeof this.resolutionLog {
    let log = this.resolutionLog;
    if (connectorId) {
      log = log.filter((l) => l.connectorId === connectorId);
    }
    return log.slice(-limit);
  }

  /**
   * Get the expected env var name for a connector field (for documentation/debugging).
   */
  getExpectedEnvVarName(connectorId: string, field: string): string {
    return this.buildEnvKey(connectorId, field);
  }

  /**
   * Check which env vars are set for a connector.
   */
  getSetEnvVars(connectorId: string, schema: ConnectorConfigSchema): string[] {
    const set: string[] = [];
    for (const field of schema.fields) {
      const envKey = this.buildEnvKey(connectorId, field.name);
      if (process.env[envKey] !== undefined) {
        set.push(envKey);
      }
    }
    return set;
  }
}

/* ------------------------------------------------------------------ */
/*  ConfigMigrator                                                     */
/* ------------------------------------------------------------------ */

interface MigrationDefinition {
  fromVersion: string;
  toVersion: string;
  connectorId: string;
  migrate: (config: Record<string, unknown>) => Record<string, unknown>;
  description?: string;
  reversible?: boolean;
  reverse?: (config: Record<string, unknown>) => Record<string, unknown>;
}

export class ConfigMigrator extends EventEmitter {
  private migrations: Map<string, MigrationDefinition[]>;
  private migrationHistory: Array<{
    connectorId: string;
    fromVersion: string;
    toVersion: string;
    timestamp: number;
    success: boolean;
    error?: string;
  }>;
  private readonly MAX_HISTORY = 500;

  constructor() {
    super();
    this.migrations = new Map();
    this.migrationHistory = [];
  }

  /**
   * Register a migration for a connector.
   */
  registerMigration(migration: MigrationDefinition): void {
    const key = migration.connectorId;
    let connectorMigrations = this.migrations.get(key);
    if (!connectorMigrations) {
      connectorMigrations = [];
      this.migrations.set(key, connectorMigrations);
    }

    // Check for duplicate
    const exists = connectorMigrations.some(
      (m) => m.fromVersion === migration.fromVersion && m.toVersion === migration.toVersion
    );
    if (exists) {
      throw new Error(
        `Migration from ${migration.fromVersion} to ${migration.toVersion} already registered for ${key}`
      );
    }

    connectorMigrations.push(migration);

    this.emit("migration:registered", {
      connectorId: key,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if a migration path exists between two versions.
   */
  canMigrate(connectorId: string, fromVersion: string, toVersion: string): boolean {
    const path = this.findMigrationPath(connectorId, fromVersion, toVersion);
    return path.length > 0;
  }

  /**
   * Find the chain of migrations from one version to another.
   */
  private findMigrationPath(
    connectorId: string,
    fromVersion: string,
    toVersion: string
  ): MigrationDefinition[] {
    const connectorMigrations = this.migrations.get(connectorId);
    if (!connectorMigrations) return [];

    // BFS to find migration path
    const queue: Array<{ version: string; path: MigrationDefinition[] }> = [
      { version: fromVersion, path: [] },
    ];
    const visited = new Set<string>();
    visited.add(fromVersion);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.version === toVersion) {
        return current.path;
      }

      for (const migration of connectorMigrations) {
        if (migration.fromVersion === current.version && !visited.has(migration.toVersion)) {
          visited.add(migration.toVersion);
          queue.push({
            version: migration.toVersion,
            path: [...current.path, migration],
          });
        }
      }
    }

    return [];
  }

  /**
   * Execute a migration (or chain of migrations) on a config.
   */
  migrate(
    connectorId: string,
    config: Record<string, unknown>,
    fromVersion: string,
    toVersion: string
  ): { config: Record<string, unknown>; migrationsApplied: number; finalVersion: string } {
    const path = this.findMigrationPath(connectorId, fromVersion, toVersion);
    if (path.length === 0) {
      throw new Error(
        `No migration path found from ${fromVersion} to ${toVersion} for ${connectorId}`
      );
    }

    let currentConfig = JSON.parse(JSON.stringify(config));
    let migrationsApplied = 0;
    let currentVersion = fromVersion;

    for (const migration of path) {
      try {
        currentConfig = migration.migrate(currentConfig);
        migrationsApplied++;
        currentVersion = migration.toVersion;

        this.migrationHistory.push({
          connectorId,
          fromVersion: migration.fromVersion,
          toVersion: migration.toVersion,
          timestamp: Date.now(),
          success: true,
        });

        this.emit("migration:applied", {
          connectorId,
          fromVersion: migration.fromVersion,
          toVersion: migration.toVersion,
          description: migration.description,
          timestamp: Date.now(),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.migrationHistory.push({
          connectorId,
          fromVersion: migration.fromVersion,
          toVersion: migration.toVersion,
          timestamp: Date.now(),
          success: false,
          error: msg,
        });

        this.emit("migration:failed", {
          connectorId,
          fromVersion: migration.fromVersion,
          toVersion: migration.toVersion,
          error: msg,
          timestamp: Date.now(),
        });

        throw new Error(
          `Migration failed at step ${migration.fromVersion} -> ${migration.toVersion}: ${msg}`
        );
      }
    }

    if (this.migrationHistory.length > this.MAX_HISTORY) {
      this.migrationHistory = this.migrationHistory.slice(-this.MAX_HISTORY);
    }

    return { config: currentConfig, migrationsApplied, finalVersion: currentVersion };
  }

  /**
   * Get migration history.
   */
  getHistory(connectorId?: string, limit = 50): typeof this.migrationHistory {
    let history = this.migrationHistory;
    if (connectorId) {
      history = history.filter((h) => h.connectorId === connectorId);
    }
    return history.slice(-limit);
  }

  /**
   * Get all registered migrations for a connector.
   */
  getRegisteredMigrations(connectorId: string): Array<{ from: string; to: string; description?: string }> {
    const migrations = this.migrations.get(connectorId) ?? [];
    return migrations.map((m) => ({
      from: m.fromVersion,
      to: m.toVersion,
      description: m.description,
    }));
  }

  /**
   * Get all available target versions from a given version.
   */
  getAvailableTargets(connectorId: string, fromVersion: string): string[] {
    const connectorMigrations = this.migrations.get(connectorId) ?? [];
    const targets = new Set<string>();

    // BFS from fromVersion
    const queue = [fromVersion];
    const visited = new Set<string>();
    visited.add(fromVersion);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const m of connectorMigrations) {
        if (m.fromVersion === current && !visited.has(m.toVersion)) {
          visited.add(m.toVersion);
          targets.add(m.toVersion);
          queue.push(m.toVersion);
        }
      }
    }

    return Array.from(targets);
  }

  /**
   * Get the latest version available for a connector.
   */
  getLatestVersion(connectorId: string): string | undefined {
    const connectorMigrations = this.migrations.get(connectorId) ?? [];
    if (connectorMigrations.length === 0) return undefined;

    // Find versions that are only toVersion (terminal nodes)
    const fromVersions = new Set(connectorMigrations.map((m) => m.fromVersion));
    const toVersions = new Set(connectorMigrations.map((m) => m.toVersion));

    const terminals = Array.from(toVersions).filter((v) => !fromVersions.has(v));
    return terminals.length > 0 ? terminals[terminals.length - 1] : undefined;
  }
}

/* ------------------------------------------------------------------ */
/*  ConfigHealthChecker                                                */
/* ------------------------------------------------------------------ */

export class ConfigHealthChecker {
  private stalenessThresholdMs: number;
  private lastCheckResults: Map<string, ConfigHealthReport>;
  private checkHistory: Array<{
    connectorId: string;
    status: ConfigHealthReport["status"];
    timestamp: number;
  }>;
  private readonly MAX_CHECK_HISTORY = 500;

  constructor(stalenessThresholdMs = 3600000) {
    this.stalenessThresholdMs = stalenessThresholdMs;
    this.lastCheckResults = new Map();
    this.checkHistory = [];
  }

  /**
   * Perform a health check on a connector's config.
   */
  check(
    connectorId: string,
    store: ConnectorConfigStore,
    versionControl: ConfigVersionControl
  ): ConfigHealthReport {
    const issues: string[] = [];
    const now = Date.now();

    // Validate config
    const validationResult = store.validate(connectorId);
    if (!validationResult.valid) {
      issues.push(`Validation errors: ${validationResult.errors.length}`);
    }

    // Check staleness
    const lastUpdated = store.getLastUpdated(connectorId) ?? 0;
    const staleSinceMs = lastUpdated > 0 ? now - lastUpdated : -1;
    if (staleSinceMs > this.stalenessThresholdMs) {
      issues.push(
        `Config is stale: last updated ${Math.round(staleSinceMs / 60000)} minutes ago`
      );
    }

    // Check missing required fields
    const missingRequired: string[] = [];
    const schema = store.getSchema(connectorId);
    if (schema) {
      const config = store.getAll(connectorId);
      for (const field of schema.fields) {
        if (field.required) {
          const val = config[field.name];
          if (val === undefined || val === null || val === "") {
            missingRequired.push(field.name);
          }
        }
      }
    }
    if (missingRequired.length > 0) {
      issues.push(`Missing required fields: ${missingRequired.join(", ")}`);
    }

    // Check deprecated fields in use
    const deprecatedInUse: string[] = [];
    if (schema) {
      const config = store.getAll(connectorId);
      for (const field of schema.fields) {
        if (field.deprecated && config[field.name] !== undefined) {
          deprecatedInUse.push(field.name);
        }
      }
    }
    if (deprecatedInUse.length > 0) {
      issues.push(`Deprecated fields in use: ${deprecatedInUse.join(", ")}`);
    }

    // Snapshot count
    const snapshotCount = versionControl.getSnapshotCount(connectorId);

    // Determine status
    let status: ConfigHealthReport["status"] = "healthy";
    if (missingRequired.length > 0 || !validationResult.valid) {
      status = "unhealthy";
    } else if (deprecatedInUse.length > 0 || staleSinceMs > this.stalenessThresholdMs) {
      status = "degraded";
    }

    const report: ConfigHealthReport = {
      connectorId,
      status,
      lastUpdated,
      staleSinceMs,
      missingRequired,
      deprecatedInUse,
      snapshotCount,
      validationResult,
      issues,
    };

    this.lastCheckResults.set(connectorId, report);
    this.checkHistory.push({
      connectorId,
      status,
      timestamp: now,
    });
    if (this.checkHistory.length > this.MAX_CHECK_HISTORY) {
      this.checkHistory = this.checkHistory.slice(-this.MAX_CHECK_HISTORY);
    }

    return report;
  }

  /**
   * Check all registered connectors.
   */
  checkAll(
    store: ConnectorConfigStore,
    versionControl: ConfigVersionControl
  ): ConfigHealthReport[] {
    const connectorIds = store.getRegisteredConnectors();
    const reports: ConfigHealthReport[] = [];
    for (const id of connectorIds) {
      reports.push(this.check(id, store, versionControl));
    }
    return reports;
  }

  /**
   * Get the last check result for a connector.
   */
  getLastResult(connectorId: string): ConfigHealthReport | undefined {
    return this.lastCheckResults.get(connectorId);
  }

  /**
   * Get overall system health.
   */
  getOverallHealth(
    store: ConnectorConfigStore,
    versionControl: ConfigVersionControl
  ): {
    status: "healthy" | "degraded" | "unhealthy";
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
  } {
    const reports = this.checkAll(store, versionControl);
    const healthy = reports.filter((r) => r.status === "healthy").length;
    const degraded = reports.filter((r) => r.status === "degraded").length;
    const unhealthy = reports.filter((r) => r.status === "unhealthy").length;

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (unhealthy > 0) {
      status = "unhealthy";
    } else if (degraded > 0) {
      status = "degraded";
    }

    return {
      status,
      total: reports.length,
      healthy,
      degraded,
      unhealthy,
    };
  }

  /**
   * Get check history for a connector.
   */
  getCheckHistory(
    connectorId?: string,
    limit = 50
  ): typeof this.checkHistory {
    let history = this.checkHistory;
    if (connectorId) {
      history = history.filter((h) => h.connectorId === connectorId);
    }
    return history.slice(-limit);
  }

  /**
   * Set the staleness threshold.
   */
  setStalenessThreshold(ms: number): void {
    this.stalenessThresholdMs = ms;
  }
}

/* ------------------------------------------------------------------ */
/*  Singletons                                                         */
/* ------------------------------------------------------------------ */

export const configStore = new ConnectorConfigStore();
export const configWatcher = new ConfigWatcher();
export const configVersionControl = new ConfigVersionControl();
export const featureFlagManager = new FeatureFlagManager();
export const configEnvironmentResolver = new ConfigEnvironmentResolver();
export const configMigrator = new ConfigMigrator();
export const configHealthChecker = new ConfigHealthChecker();
