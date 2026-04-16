import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

// Mock external dependencies before importing the module
vi.mock("../db", () => ({
  db: {
    execute: vi.fn(),
    query: { pareIdempotencyKeys: { findFirst: vi.fn() } },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue({ rowCount: 0 }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ count: 0 }]),
      })),
    })),
  },
}));

vi.mock("@shared/schema", () => ({
  pareIdempotencyKeys: {
    idempotencyKey: "idempotency_key",
    status: "status",
    expiresAt: "expires_at",
  },
}));

vi.mock("./structuredLogger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  lt: vi.fn((col, val) => ({ col, val })),
  sql: vi.fn((...args: unknown[]) => args),
}));

import {
  computePayloadHash,
  checkIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  cleanupExpiredKeys,
  startCleanupScheduler,
  stopCleanupScheduler,
  getIdempotencyKeyStats,
} from "./idempotencyStore";

describe("idempotencyStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopCleanupScheduler();
    vi.useRealTimers();
  });

  // ===== computePayloadHash =====

  describe("computePayloadHash", () => {
    it("should return a 64-char hex string for a simple object", () => {
      const hash = computePayloadHash({ name: "test", value: 42 });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should produce consistent hashes for identical payloads", () => {
      const payload = { a: 1, b: "hello" };
      const hash1 = computePayloadHash(payload);
      const hash2 = computePayloadHash(payload);
      expect(hash1).toBe(hash2);
    });

    it("should produce the same hash regardless of key order", () => {
      const hash1 = computePayloadHash({ z: 1, a: 2 });
      const hash2 = computePayloadHash({ a: 2, z: 1 });
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different payloads", () => {
      const hash1 = computePayloadHash({ x: 1 });
      const hash2 = computePayloadHash({ x: 2 });
      expect(hash1).not.toBe(hash2);
    });

    it("should handle nested objects and normalize them", () => {
      const payload = { outer: { inner: { deep: "value" } } };
      const hash = computePayloadHash(payload);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should convert Date values to ISO strings when hashing", () => {
      const date = new Date("2024-01-01T00:00:00.000Z");
      const hash1 = computePayloadHash({ d: date });
      const hash2 = computePayloadHash({ d: "2024-01-01T00:00:00.000Z" });
      expect(hash1).toBe(hash2);
    });

    it("should handle circular references gracefully", () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      const hash = computePayloadHash(obj);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should redact __proto__ keys", () => {
      const payload = { normal: "val", ["__proto__"]: "malicious" };
      const hash = computePayloadHash(payload);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should throw for payloads exceeding max size", () => {
      const hugePayload = { data: "x".repeat(200_000) };
      expect(() => computePayloadHash(hugePayload)).toThrow(
        "Idempotency payload too large"
      );
    });

    it("should handle arrays within the payload", () => {
      const hash = computePayloadHash({ items: [1, 2, 3] });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should handle null values in the payload", () => {
      const hash = computePayloadHash({ key: null });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should cap depth at max nesting depth and produce a hash", () => {
      let obj: Record<string, unknown> = { v: "leaf" };
      for (let i = 0; i < 20; i++) {
        obj = { nested: obj };
      }
      const hash = computePayloadHash(obj);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ===== checkIdempotencyKey =====

  describe("checkIdempotencyKey", () => {
    const validKey = "abc123-valid-key";
    const validHash = crypto.createHash("sha256").update("test").digest("hex");

    it("should throw for a key that is too short", async () => {
      await expect(checkIdempotencyKey("ab", validHash)).rejects.toThrow(
        "Invalid idempotency key"
      );
    });

    it("should throw for a key with invalid characters", async () => {
      await expect(
        checkIdempotencyKey("invalid key with spaces!!", validHash)
      ).rejects.toThrow("Invalid idempotency key");
    });

    it("should throw for an invalid payload hash", async () => {
      await expect(
        checkIdempotencyKey(validKey, "not-a-valid-hash")
      ).rejects.toThrow("Invalid idempotency payload hash");
    });

    it("should throw for a key that exceeds max length", async () => {
      const longKey = "a".repeat(141);
      await expect(checkIdempotencyKey(longKey, validHash)).rejects.toThrow(
        "Invalid idempotency key"
      );
    });
  });

  // ===== completeIdempotencyKey =====

  describe("completeIdempotencyKey", () => {
    it("should throw for invalid key on complete", async () => {
      await expect(
        completeIdempotencyKey("ab", { result: "ok" })
      ).rejects.toThrow("Invalid idempotency key");
    });
  });

  // ===== failIdempotencyKey =====

  describe("failIdempotencyKey", () => {
    it("should throw for invalid key on fail", async () => {
      await expect(
        failIdempotencyKey("ab", "some error")
      ).rejects.toThrow("Invalid idempotency key");
    });
  });

  // ===== startCleanupScheduler / stopCleanupScheduler =====

  describe("cleanup scheduler", () => {
    it("should start and stop the cleanup scheduler without error", () => {
      startCleanupScheduler();
      // calling start again should be a no-op (idempotent)
      startCleanupScheduler();
      stopCleanupScheduler();
      // stopping again should be safe
      stopCleanupScheduler();
    });
  });
});
