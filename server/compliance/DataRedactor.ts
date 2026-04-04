import crypto from "crypto";
import Redis from "ioredis";
import { piiDetector, PIIType, PIIMatch } from "./PIIDetector";
import { Logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RedactionStrategy = "mask" | "hash" | "remove" | "tokenize";

export interface RedactionConfig {
  strategy: RedactionStrategy;
  maskChar?: string;
  preserveLength?: boolean;
  hashAlgorithm?: "sha256" | "sha512";
}

export interface RedactionResult {
  original: string;
  redacted: string;
  matches: PIIMatch[];
  redactionCount: number;
}

export interface RedactionContext {
  userId?: string;
  tenantId?: string;
  purpose: string;
  requestId?: string;
}

export interface RedactionLogEntry {
  timestamp: Date;
  context: RedactionContext;
  matchCount: number;
  types: PIIType[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_PREFIX = "[TOKEN:";
const TOKEN_SUFFIX = "]";
const TOKEN_STORE_PREFIX = "redact:token:";
const DEFAULT_MASK_CHAR = "*";

// ─── DataRedactor ─────────────────────────────────────────────────────────────

class DataRedactor {
  private config: Map<PIIType, RedactionConfig>;
  private tokenStore: Map<string, string> = new Map();
  private redis: Redis;
  private log: RedactionLogEntry[] = [];

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    this.redis.on("error", (err: Error) => {
      Logger.warn("[DataRedactor] Redis error", { error: err.message });
    });

    this.config = this.buildDefaultConfig();
  }

  // ── Redaction ─────────────────────────────────────────────────────────────────

  redact(text: string, options?: Partial<RedactionConfig>): RedactionResult {
    const matches = piiDetector.detect(text);
    if (matches.length === 0) {
      return { original: text, redacted: text, matches: [], redactionCount: 0 };
    }

    let redacted = text;
    // Process from end to preserve offsets
    const sorted = [...matches].sort((a, b) => b.start - a.start);

    for (const match of sorted) {
      const cfg = options
        ? { ...this.config.get(match.type) ?? this.defaultConfig(), ...options }
        : this.config.get(match.type) ?? this.defaultConfig();

      const replacement = this.applyStrategy(match.value, cfg, match.type);
      redacted = redacted.slice(0, match.start) + replacement + redacted.slice(match.end);
    }

    return {
      original: text,
      redacted,
      matches,
      redactionCount: matches.length,
    };
  }

  redactObject(obj: Record<string, any>, fieldsToRedact?: string[]): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (fieldsToRedact && fieldsToRedact.includes(key)) {
        result[key] = this.redact(String(value)).redacted;
      } else if (typeof value === "string") {
        result[key] = this.redact(value).redacted;
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        result[key] = this.redactObject(value, fieldsToRedact);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === "string" ? this.redact(item).redacted : item
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  async redactAndLog(text: string, context: RedactionContext): Promise<RedactionResult> {
    const result = this.redact(text);

    const logEntry: RedactionLogEntry = {
      timestamp: new Date(),
      context,
      matchCount: result.redactionCount,
      types: [...new Set(result.matches.map((m) => m.type))],
    };

    this.log.unshift(logEntry);
    if (this.log.length > 1000) this.log.pop();

    if (result.redactionCount > 0) {
      Logger.info("[DataRedactor] PII redacted", {
        userId: context.userId,
        tenantId: context.tenantId,
        purpose: context.purpose,
        matchCount: result.redactionCount,
        types: logEntry.types,
      });
    }

    return result;
  }

  detokenize(text: string): string {
    let result = text;
    const tokenRegex = /\[TOKEN:[a-f0-9]{16}\]/g;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(text)) !== null) {
      const token = match[0];
      const original = this.tokenStore.get(token);
      if (original) {
        result = result.replace(token, original);
      }
    }

    return result;
  }

  async bulkRedact(texts: string[]): Promise<RedactionResult[]> {
    return texts.map((t) => this.redact(t));
  }

  setStrategy(piiType: PIIType, config: RedactionConfig): void {
    this.config.set(piiType, config);
  }

  getRedactionLog(limit: number): RedactionLogEntry[] {
    return this.log.slice(0, limit);
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private applyStrategy(value: string, config: RedactionConfig, type: PIIType): string {
    switch (config.strategy) {
      case "mask": {
        const maskChar = config.maskChar ?? DEFAULT_MASK_CHAR;
        if (!config.preserveLength) {
          // Preserve some context for readability
          if (value.length > 4) {
            return value.slice(0, 2) + maskChar.repeat(value.length - 4) + value.slice(-2);
          }
          return maskChar.repeat(value.length);
        }
        return maskChar.repeat(value.length);
      }

      case "hash": {
        const algo = config.hashAlgorithm ?? "sha256";
        const hashed = crypto.createHash(algo).update(value).digest("hex").slice(0, 16);
        return `[${type.toUpperCase()}:${hashed}]`;
      }

      case "remove":
        return `[REDACTED:${type.toUpperCase()}]`;

      case "tokenize": {
        const tokenId = crypto.randomBytes(8).toString("hex");
        const token = `${TOKEN_PREFIX}${tokenId}${TOKEN_SUFFIX}`;
        this.tokenStore.set(token, value);
        // Persist to Redis with 24h TTL
        this.redis
          .set(`${TOKEN_STORE_PREFIX}${tokenId}`, value, "EX", 86400)
          .catch(() => {});
        return token;
      }

      default:
        return `[REDACTED]`;
    }
  }

  private buildDefaultConfig(): Map<PIIType, RedactionConfig> {
    const c = new Map<PIIType, RedactionConfig>();
    c.set("email", { strategy: "mask" });
    c.set("phone", { strategy: "mask" });
    c.set("ssn", { strategy: "hash", hashAlgorithm: "sha256" });
    c.set("credit_card", { strategy: "mask", maskChar: "*", preserveLength: false });
    c.set("name", { strategy: "mask" });
    c.set("address", { strategy: "mask" });
    c.set("ip_address", { strategy: "mask" });
    c.set("passport", { strategy: "hash" });
    c.set("driver_license", { strategy: "hash" });
    c.set("bank_account", { strategy: "hash", hashAlgorithm: "sha256" });
    c.set("date_of_birth", { strategy: "mask" });
    return c;
  }

  private defaultConfig(): RedactionConfig {
    return { strategy: "remove" };
  }
}

export const dataRedactor = new DataRedactor();
