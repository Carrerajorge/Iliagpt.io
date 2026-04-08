/**
 * Pipeline Integrations — Connects infrastructure modules to the chat pipeline.
 * Import this module once during server startup to wire everything.
 */

import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";

// ─── Observability: Request Logger + Correlation ID ───────────────────────────

/** Attach a correlation ID to every request and log request/response. */
export function observabilityMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  (req as any).correlationId = correlationId;
  res.setHeader("X-Request-Id", correlationId);

  const start = Date.now();
  const originalEnd = res.end.bind(res);

  res.end = function (...args: any[]) {
    const duration = Date.now() - start;
    const userId = (req as any).user?.id || (req.headers["x-anonymous-user-id"] as string) || "-";
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    // Only log API requests (skip static assets)
    if (req.path.startsWith("/api/") || req.path.startsWith("/v1/")) {
      console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
        `[${level.toUpperCase()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms user=${userId} rid=${correlationId}`,
      );
    }

    // Record metrics
    try {
      const { metricsCollector } = require("../middleware/observability");
      if (metricsCollector?.recordRequest) {
        metricsCollector.recordRequest(req.method, req.path, res.statusCode);
      }
    } catch { /* observability module may not exist */ }

    return originalEnd.apply(res, args);
  } as any;

  next();
}

// ─── Usage Tracker: Track tokens after LLM responses ──────────────────────────

let _usageTracker: any = null;

function getUsageTracker() {
  if (!_usageTracker) {
    try {
      _usageTracker = require("../analytics/usageTracker").usageTracker;
    } catch { _usageTracker = null; }
  }
  return _usageTracker;
}

/** Call after an LLM response to track token usage. */
export function trackLLMUsage(
  userId: string,
  orgId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  try {
    const tracker = getUsageTracker();
    if (tracker?.trackTokens) {
      tracker.trackTokens(userId, orgId, model, inputTokens, outputTokens);
    }
  } catch { /* non-critical */ }
}

/** Call after document generation. */
export function trackDocGeneration(
  userId: string,
  orgId: string,
  docType: "word" | "excel" | "ppt" | "pdf",
): void {
  try {
    const tracker = getUsageTracker();
    if (tracker?.trackDocGeneration) {
      tracker.trackDocGeneration(userId, orgId, docType);
    }
  } catch { /* non-critical */ }
}

/** Call after tool execution. */
export function trackToolExecution(userId: string, toolName: string): void {
  try {
    const tracker = getUsageTracker();
    if (tracker?.trackToolUsage) {
      tracker.trackToolUsage(userId, toolName);
    }
  } catch { /* non-critical */ }
}

// ─── Memory: Auto-extract facts after responses ───────────────────────────────

let _memoryModule: any = null;

function getMemoryModule() {
  if (!_memoryModule) {
    try {
      _memoryModule = require("../memory/conversationMemory");
    } catch { _memoryModule = null; }
  }
  return _memoryModule;
}

/** Extract facts from conversation in background (non-blocking). */
export function extractFactsInBackground(
  messages: Array<{ role: string; content: string }>,
  userId: string,
): void {
  try {
    const mod = getMemoryModule();
    if (!mod?.ConversationMemory) return;
    const memory = new mod.ConversationMemory();
    // Run in background — don't await
    memory.extractFacts(messages, userId).catch(() => { /* ignore */ });
  } catch { /* non-critical */ }
}

/** Get relevant memory context to inject into system prompt. */
export async function getMemoryContext(userId: string, currentMessage: string): Promise<string> {
  try {
    const mod = getMemoryModule();
    if (!mod?.ConversationMemory) return "";
    const memory = new mod.ConversationMemory();
    return await memory.getRelevantContext(userId, currentMessage);
  } catch {
    return "";
  }
}

// ─── Permission Check before tool execution ───────────────────────────────────

let _permissionEnforcer: any = null;

function getPermissionEnforcer() {
  if (!_permissionEnforcer) {
    try {
      const mod = require("../agent/claw/permissionSystem");
      _permissionEnforcer = new mod.ClawPermissionEnforcer();
    } catch { _permissionEnforcer = null; }
  }
  return _permissionEnforcer;
}

/** Check if user has permission to execute a tool. Returns { allowed, reason }. */
export function checkToolPermission(
  userId: string,
  toolName: string,
  input?: any,
): { allowed: boolean; reason?: string } {
  try {
    const enforcer = getPermissionEnforcer();
    if (!enforcer) return { allowed: true }; // No enforcer = allow all
    return enforcer.check(userId, toolName, input);
  } catch {
    return { allowed: true }; // Fail open for availability
  }
}

// ─── Cache: Embedding cache wrapper ───────────────────────────────────────────

let _cacheManager: any = null;

function getCacheManager() {
  if (!_cacheManager) {
    try {
      const mod = require("../cache/CacheManager");
      _cacheManager = mod.cacheManager || new mod.CacheManager("pipeline:");
    } catch { _cacheManager = null; }
  }
  return _cacheManager;
}

/** Cache embedding results by text hash. */
export async function cachedEmbedding(
  text: string,
  embedFn: () => Promise<number[]>,
): Promise<number[]> {
  try {
    const cache = getCacheManager();
    if (cache?.cachedEmbedding) {
      return await cache.cachedEmbedding(text, embedFn);
    }
  } catch { /* fallback to direct call */ }
  return embedFn();
}

/** Cache model configs with 5-min TTL. */
export async function cachedModelConfig<T>(
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  try {
    const cache = getCacheManager();
    if (cache?.getOrSet) {
      return await cache.getOrSet(`model-config:${key}`, factory, 5 * 60 * 1000);
    }
  } catch { /* fallback */ }
  return factory();
}

// ─── Mount all infrastructure routes ──────────────────────────────────────────

export function mountInfrastructureRoutes(app: Express): void {
  // Public API (OpenAI-compatible)
  try {
    const { publicApiRouter } = require("../api/publicApi");
    if (publicApiRouter) {
      app.use("/v1", publicApiRouter);
      console.log("[Pipeline] Mounted /v1 public API (OpenAI-compatible)");
    }
  } catch (e: any) {
    console.warn("[Pipeline] Could not mount public API:", e.message);
  }

  // Health & metrics endpoints from observability
  try {
    const obs = require("../middleware/observability");
    if (obs.healthEndpoint) {
      app.get("/api/health", obs.healthEndpoint);
    }
    if (obs.metricsEndpoint) {
      app.get("/api/metrics", obs.metricsEndpoint);
    }
  } catch { /* observability module optional */ }
}
