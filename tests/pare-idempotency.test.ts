import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

// Dynamic imports to avoid eagerly connecting to PostgreSQL when DATABASE_URL is unset
const idempotencyStore = hasDb ? await import("../server/lib/idempotencyStore") : null;
const checkIdempotencyKey = idempotencyStore?.checkIdempotencyKey;
const completeIdempotencyKey = idempotencyStore?.completeIdempotencyKey;
const failIdempotencyKey = idempotencyStore?.failIdempotencyKey;
const cleanupExpiredKeys = idempotencyStore?.cleanupExpiredKeys;
const computePayloadHash = idempotencyStore?.computePayloadHash;
const startCleanupScheduler = idempotencyStore?.startCleanupScheduler;
const stopCleanupScheduler = idempotencyStore?.stopCleanupScheduler;
const getIdempotencyKeyStats = idempotencyStore?.getIdempotencyKeyStats;

const TEST_TTL_MS = 100;

async function clearTestKeys(): Promise<void> {
  const { db } = await import("../server/db");
  const { pareIdempotencyKeys } = await import("../shared/schema");
  const { sql } = await import("drizzle-orm");
  await db.delete(pareIdempotencyKeys).where(
    sql`idempotency_key LIKE 'test-%'`
  );
}

function generateTestKey(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

describe.skipIf(!hasDb)("PARE Phase 2 Idempotency System", () => {
  beforeAll(async () => {
    if (!hasDb) return;
    await clearTestKeys();
  });

  afterAll(async () => {
    if (!hasDb) return;
    await clearTestKeys();
    stopCleanupScheduler();
  });

  afterEach(async () => {
    if (!hasDb) return;
    await clearTestKeys();
  });

  describe("computePayloadHash", () => {
    it("should generate consistent SHA256 hash for same payload", () => {
      const payload = { messages: [{ role: "user", content: "Hello" }], attachments: [] };
      const hash1 = computePayloadHash(payload);
      const hash2 = computePayloadHash(payload);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("should generate different hashes for different payloads", () => {
      const payload1 = { messages: [{ role: "user", content: "Hello" }] };
      const payload2 = { messages: [{ role: "user", content: "World" }] };
      
      const hash1 = computePayloadHash(payload1);
      const hash2 = computePayloadHash(payload2);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("checkIdempotencyKey", () => {
    it("should return 'new' for a fresh idempotency key", async () => {
      const key = generateTestKey();
      const payloadHash = computePayloadHash({ test: true });
      
      const result = await checkIdempotencyKey(key, payloadHash);
      
      expect(result.status).toBe("new");
    });

    it("should return 'processing' for an in-progress key with same payload", async () => {
      const key = generateTestKey();
      const payloadHash = computePayloadHash({ test: true });
      
      const firstResult = await checkIdempotencyKey(key, payloadHash);
      expect(firstResult.status).toBe("new");
      
      const secondResult = await checkIdempotencyKey(key, payloadHash);
      expect(secondResult.status).toBe("processing");
    });

    it("should return 'conflict' for same key with different payload hash", async () => {
      const key = generateTestKey();
      const payloadHash1 = computePayloadHash({ test: 1 });
      const payloadHash2 = computePayloadHash({ test: 2 });
      
      const firstResult = await checkIdempotencyKey(key, payloadHash1);
      expect(firstResult.status).toBe("new");
      
      const secondResult = await checkIdempotencyKey(key, payloadHash2);
      expect(secondResult.status).toBe("conflict");
    });

    it("should return cached response for completed key with same payload", async () => {
      const key = generateTestKey();
      const payloadHash = computePayloadHash({ test: true });
      const cachedResponse = { success: true, data: "test response" };
      
      await checkIdempotencyKey(key, payloadHash);
      await completeIdempotencyKey(key, cachedResponse);
      
      const result = await checkIdempotencyKey(key, payloadHash);
      
      expect(result.status).toBe("completed");
      if (result.status === "completed") {
        expect(result.cachedResponse).toEqual(cachedResponse);
      }
    });

    it("should allow retry after failed key", async () => {
      const key = generateTestKey();
      const payloadHash = computePayloadHash({ test: true });
      
      await checkIdempotencyKey(key, payloadHash);
      await failIdempotencyKey(key, "Test error");
      
      const result = await checkIdempotencyKey(key, payloadHash);
      expect(result.status).toBe("new");
    });
  });

  describe("completeIdempotencyKey", () => {
    it("should store response and update status to completed", async () => {
      const { db } = await import("../server/db");
      const { pareIdempotencyKeys } = await import("../shared/schema");
      const { eq } = await import("drizzle-orm");
      const key = generateTestKey();
      const payloadHash = computePayloadHash({ test: true });
      const response = { requestId: "test-123", success: true, answer: "Test answer" };

      await checkIdempotencyKey(key, payloadHash);
      await completeIdempotencyKey(key, response);

      const record = await db.query.pareIdempotencyKeys.findFirst({
        where: eq(pareIdempotencyKeys.idempotencyKey, key)
      });

      expect(record).toBeDefined();
      expect(record?.status).toBe("completed");
      expect(record?.responseJson).toEqual(response);
    });
  });

  describe("failIdempotencyKey", () => {
    it("should update status to failed and store error", async () => {
      const { db } = await import("../server/db");
      const { pareIdempotencyKeys } = await import("../shared/schema");
      const { eq } = await import("drizzle-orm");
      const key = generateTestKey();
      const payloadHash = computePayloadHash({ test: true });
      const errorMessage = "Processing failed due to timeout";

      await checkIdempotencyKey(key, payloadHash);
      await failIdempotencyKey(key, errorMessage);

      const record = await db.query.pareIdempotencyKeys.findFirst({
        where: eq(pareIdempotencyKeys.idempotencyKey, key)
      });

      expect(record).toBeDefined();
      expect(record?.status).toBe("failed");
      expect((record?.responseJson as any)?.error).toBe(errorMessage);
    });
  });

  describe("cleanupExpiredKeys", () => {
    it("should delete keys past their expiration time", async () => {
      const { db } = await import("../server/db");
      const { pareIdempotencyKeys } = await import("../shared/schema");
      const { eq } = await import("drizzle-orm");
      const key = generateTestKey();
      const payloadHash = computePayloadHash({ test: true });

      await checkIdempotencyKey(key, payloadHash);

      await db
        .update(pareIdempotencyKeys)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(pareIdempotencyKeys.idempotencyKey, key));

      const deletedCount = await cleanupExpiredKeys();

      expect(deletedCount).toBeGreaterThanOrEqual(1);

      const record = await db.query.pareIdempotencyKeys.findFirst({
        where: eq(pareIdempotencyKeys.idempotencyKey, key)
      });

      expect(record).toBeUndefined();
    });
  });

  describe("Replay Protection", () => {
    it("should return same response for replay requests", async () => {
      const key = generateTestKey();
      const payloadHash = computePayloadHash({ 
        messages: [{ role: "user", content: "Analyze document" }],
        attachments: [{ name: "test.pdf", type: "pdf" }]
      });
      const originalResponse = {
        success: true,
        requestId: "original-123",
        answer_text: "Document analysis complete",
        metadata: { tokensUsed: 500 }
      };
      
      await checkIdempotencyKey(key, payloadHash);
      await completeIdempotencyKey(key, originalResponse);
      
      const replayResult = await checkIdempotencyKey(key, payloadHash);
      
      expect(replayResult.status).toBe("completed");
      if (replayResult.status === "completed") {
        expect(replayResult.cachedResponse).toEqual(originalResponse);
        expect(replayResult.cachedResponse.requestId).toBe("original-123");
      }
    });
  });

  describe("Concurrent Request Handling", () => {
    it("should handle concurrent requests with same key atomically", async () => {
      const key = generateTestKey();
      const payloadHash = computePayloadHash({ test: "concurrent" });
      
      const results = await Promise.all([
        checkIdempotencyKey(key, payloadHash),
        checkIdempotencyKey(key, payloadHash),
        checkIdempotencyKey(key, payloadHash),
      ]);
      
      const newCount = results.filter(r => r.status === "new").length;
      const processingCount = results.filter(r => r.status === "processing").length;
      
      expect(newCount).toBe(1);
      expect(processingCount).toBe(2);
    });
  });

  describe("Cleanup Scheduler", () => {
    it("should start and stop cleanup scheduler without errors", () => {
      expect(() => startCleanupScheduler()).not.toThrow();
      expect(() => stopCleanupScheduler()).not.toThrow();
    });
  });

  describe("Stats Collection", () => {
    it("should return accurate statistics", async () => {
      const processingKey = generateTestKey();
      const completedKey = generateTestKey();
      const failedKey = generateTestKey();
      const payloadHash = computePayloadHash({ test: true });
      
      await checkIdempotencyKey(processingKey, payloadHash);
      
      await checkIdempotencyKey(completedKey, payloadHash);
      await completeIdempotencyKey(completedKey, { success: true });
      
      await checkIdempotencyKey(failedKey, payloadHash);
      await failIdempotencyKey(failedKey, "Test failure");
      
      const stats = await getIdempotencyKeyStats();
      
      expect(stats.processing).toBeGreaterThanOrEqual(1);
      expect(stats.completed).toBeGreaterThanOrEqual(1);
      expect(stats.failed).toBeGreaterThanOrEqual(1);
    });
  });
});
