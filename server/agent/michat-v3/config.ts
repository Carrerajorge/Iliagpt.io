import { z } from "zod";
import type { ResolvedConfig } from "./types";

const ConfigSchema = z.object({
  MODEL: z.string().default("grok-3-mini"),
  API_KEY: z.string().optional(),
  BASE_URL: z.string().default("https://api.x.ai/v1"),
  TEMPERATURE: z.number().min(0).max(2).default(0.7),
  MAX_TOKENS: z.number().int().positive().default(4096),
  TIMEOUT_MS: z.number().int().positive().default(30000),
  MAX_CONCURRENCY: z.number().int().positive().default(8),
  CB_FAILURE_THRESHOLD: z.number().int().positive().default(5),
  CB_OPEN_MS: z.number().int().positive().default(60000),
  CB_HALF_OPEN_MAX_CALLS: z.number().int().positive().default(3),
  RL_BUCKET_CAPACITY: z.number().int().positive().default(20),
  RL_REFILL_PER_SEC: z.number().positive().default(2),
  TOOL_MAX_CONCURRENT_DEFAULT: z.number().int().positive().default(4),
  CACHE_DEFAULT_TTL_MS: z.number().int().positive().default(300000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ENABLE_AUDIT: z.boolean().default(true),
});

export type ConfigInput = z.input<typeof ConfigSchema>;

export function resolveConfig(input: Partial<ConfigInput> = {}): ResolvedConfig {
  const envConfig: Partial<ConfigInput> = {
    MODEL: process.env.XAI_MODEL || process.env.MICHAT_MODEL,
    API_KEY: process.env.XAI_API_KEY || process.env.MICHAT_API_KEY,
    BASE_URL: process.env.XAI_BASE_URL || process.env.MICHAT_BASE_URL,
    TEMPERATURE: process.env.MICHAT_TEMPERATURE ? parseFloat(process.env.MICHAT_TEMPERATURE) : undefined,
    MAX_TOKENS: process.env.MICHAT_MAX_TOKENS ? parseInt(process.env.MICHAT_MAX_TOKENS) : undefined,
    TIMEOUT_MS: process.env.MICHAT_TIMEOUT_MS ? parseInt(process.env.MICHAT_TIMEOUT_MS) : undefined,
    MAX_CONCURRENCY: process.env.MICHAT_MAX_CONCURRENCY ? parseInt(process.env.MICHAT_MAX_CONCURRENCY) : undefined,
    LOG_LEVEL: (process.env.MICHAT_LOG_LEVEL as any) || undefined,
    ENABLE_AUDIT: process.env.MICHAT_ENABLE_AUDIT === "true" ? true : process.env.MICHAT_ENABLE_AUDIT === "false" ? false : undefined,
  };

  const mergedConfig = {
    ...Object.fromEntries(Object.entries(envConfig).filter(([_, v]) => v !== undefined)),
    ...input,
  };

  return ConfigSchema.parse(mergedConfig) as ResolvedConfig;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function jitter(base: number, factor: number = 0.3): number {
  const variation = base * factor;
  return base + (Math.random() * 2 - 1) * variation;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function uid(prefix: string = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms`));
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export function sanitizeUserInput(input: string): string {
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, 50000)
    .trim();
}

export function safeJsonParse<T = unknown>(str: string): T | null {
  try {
    const jsonMatch = str.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}

export function redactSecrets(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  
  const sensitiveKeys = ["password", "secret", "token", "api_key", "apikey", "key", "credential"];
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSecrets(value);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}
