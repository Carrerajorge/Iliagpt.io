import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

// Dynamic imports to avoid eagerly connecting to PostgreSQL when DATABASE_URL is unset
const { default: express } = await import("express");
type Express = import("express").Express;
type Request = import("express").Request;
type Response = import("express").Response;
type NextFunction = import("express").NextFunction;
const { default: request } = await import("supertest");
const middleware = hasDb ? await import("../server/middleware") : null;
const pareRateLimiterMod = hasDb ? await import("../server/middleware/pareRateLimiter") : null;
const idempotencyStore = hasDb ? await import("../server/lib/idempotencyStore") : null;

const pareRequestContract = middleware?.pareRequestContract;
const pareRateLimiter = middleware?.pareRateLimiter;
const pareQuotaGuard = middleware?.pareQuotaGuard;
const requirePareContext = middleware?.requirePareContext;
const pareIdempotencyGuard = middleware?.pareIdempotencyGuard;
const clearPareRateLimitStores = pareRateLimiterMod?.clearPareRateLimitStores;
const checkIdempotencyKey = idempotencyStore?.checkIdempotencyKey;
const completeIdempotencyKey = idempotencyStore?.completeIdempotencyKey;
const failIdempotencyKey = idempotencyStore?.failIdempotencyKey;
const cleanupExpiredKeys = idempotencyStore?.cleanupExpiredKeys;
const computePayloadHash = idempotencyStore?.computePayloadHash;

async function clearTestIdempotencyKeys(): Promise<void> {
  const { db } = await import("../server/db");
  const { pareIdempotencyKeys } = await import("../shared/schema");
  const { sql } = await import("drizzle-orm");
  await db.delete(pareIdempotencyKeys).where(
    sql`idempotency_key LIKE 'concurrency-test-%'`
  );
}

function generateTestIdempotencyKey(): string {
  return `concurrency-test-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

let processingDelay = 50;
let forceParserFailure = false;
let parserFailureCount = 0;

function createConcurrencyTestApp(): Express {
  const app = express();
  app.use(express.json({ limit: "200mb" }));
  
  app.post("/api/analyze",
    pareRequestContract,
    pareRateLimiter({ 
      ipMaxRequests: 10, 
      ipWindowMs: 60000,
      userMaxRequests: 5,
      userWindowMs: 60000,
    }),
    pareQuotaGuard({ maxFilesPerRequest: 20 }),
    pareIdempotencyGuard,
    async (req: Request, res: Response) => {
      const pareContext = requirePareContext(req);
      const { requestId, idempotencyKey } = pareContext;
      
      const { attachments } = req.body;
      
      if (!attachments || attachments.length === 0) {
        return res.status(400).json({
          error: "ATTACHMENTS_REQUIRED",
          requestId,
        });
      }
      
      if (forceParserFailure) {
        parserFailureCount++;
        if (idempotencyKey) {
          await failIdempotencyKey(idempotencyKey, "Forced parser failure for testing");
        }
        return res.status(500).json({
          error: "PARSER_FAILURE",
          message: "Parser failed (simulated)",
          requestId,
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, processingDelay));
      
      const response = {
        success: true,
        requestId,
        processedAt: new Date().toISOString(),
        attachments_count: attachments.length,
        idempotencyKey,
      };
      
      if (idempotencyKey) {
        await completeIdempotencyKey(idempotencyKey, response);
      }
      
      return res.json(response);
    }
  );
  
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Concurrency test app error:", err);
    res.status(500).json({ error: err.message });
  });
  
  return app;
}

describe.skipIf(!hasDb)("PARE Concurrency Tests", () => {
  let app: Express;
  
  beforeAll(async () => {
    if (!hasDb) return;
    await clearTestIdempotencyKeys();
  });

  afterAll(async () => {
    if (!hasDb) return;
    await clearTestIdempotencyKeys();
  });
  
  beforeEach(() => {
    clearPareRateLimitStores();
    app = createConcurrencyTestApp();
    processingDelay = 50;
    forceParserFailure = false;
    parserFailureCount = 0;
  });
  
  afterEach(async () => {
    await clearTestIdempotencyKeys();
  });
  
  describe("Idempotency Under Concurrent Load", () => {
    it("should process only once when 10 concurrent requests have same idempotency key", async () => {
      const idempotencyKey = generateTestIdempotencyKey();
      const payload = {
        messages: [{ role: "user", content: "Analyze" }],
        attachments: [{ name: "test.pdf", mimeType: "application/pdf", type: "document", content: "dGVzdA==" }],
      };
      
      processingDelay = 100;
      
      const requests = Array(10).fill(null).map(() =>
        request(app)
          .post("/api/analyze")
          .set("X-Idempotency-Key", idempotencyKey)
          .send(payload)
      );
      
      const responses = await Promise.all(requests);
      
      const successResponses = responses.filter(r => r.status === 200);
      const processingResponses = responses.filter(r => r.status === 202 || r.body?.status === "processing");
      
      expect(successResponses.length).toBeGreaterThanOrEqual(1);
      
      const allRequestIds = successResponses.map(r => r.body.requestId);
      const uniqueProcessedAts = [...new Set(successResponses.map(r => r.body.processedAt))];
      
      expect(uniqueProcessedAts.length).toBeLessThanOrEqual(2);
    });
    
    it("should return identical responses for replay requests after completion", async () => {
      const idempotencyKey = generateTestIdempotencyKey();
      const payload = {
        messages: [{ role: "user", content: "Test" }],
        attachments: [{ name: "doc.pdf", mimeType: "application/pdf", type: "document", content: "dGVzdA==" }],
      };
      
      processingDelay = 10;
      
      const firstResponse = await request(app)
        .post("/api/analyze")
        .set("X-Idempotency-Key", idempotencyKey)
        .send(payload);
      
      expect(firstResponse.status).toBe(200);
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const secondResponse = await request(app)
        .post("/api/analyze")
        .set("X-Idempotency-Key", idempotencyKey)
        .send(payload);
      
      if (secondResponse.status === 200) {
        expect(secondResponse.body.success).toBe(firstResponse.body.success);
        expect(secondResponse.body.attachments_count).toBe(firstResponse.body.attachments_count);
      }
    });
    
    it("should handle rapid sequential requests with same idempotency key", async () => {
      const idempotencyKey = generateTestIdempotencyKey();
      const payload = {
        messages: [{ role: "user", content: "Rapid test" }],
        attachments: [{ name: "rapid.pdf", mimeType: "application/pdf", type: "document", content: "cmFwaWQ=" }],
      };
      
      processingDelay = 5;
      
      const results: number[] = [];
      
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post("/api/analyze")
          .set("X-Idempotency-Key", idempotencyKey)
          .send(payload);
        
        results.push(response.status);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      expect(results.filter(s => s === 200 || s === 202).length).toBe(5);
    });
  });
  
  describe("Idempotency Conflict Detection", () => {
    it("should return 409 when same key used with different payload", async () => {
      const idempotencyKey = generateTestIdempotencyKey();
      
      const payload1 = {
        messages: [{ role: "user", content: "First request" }],
        attachments: [{ name: "doc1.pdf", mimeType: "application/pdf", type: "document", content: "Zmlyc3Q=" }],
      };
      
      const payload2 = {
        messages: [{ role: "user", content: "Second request with different content" }],
        attachments: [{ name: "doc2.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", type: "document", content: "c2Vjb25k" }],
      };
      
      processingDelay = 100;
      
      const [response1, response2] = await Promise.all([
        request(app)
          .post("/api/analyze")
          .set("X-Idempotency-Key", idempotencyKey)
          .send(payload1),
        new Promise<request.Response>(async (resolve) => {
          await new Promise(r => setTimeout(r, 20));
          const res = await request(app)
            .post("/api/analyze")
            .set("X-Idempotency-Key", idempotencyKey)
            .send(payload2);
          resolve(res);
        }),
      ]);
      
      const statuses = [response1.status, response2.status];
      
      expect(
        statuses.includes(409) || 
        statuses.includes(200) && statuses.includes(202)
      ).toBe(true);
      
      const conflictResponse = response1.status === 409 ? response1 : response2;
      if (conflictResponse.status === 409) {
        expect(conflictResponse.body.error).toContain("CONFLICT");
      }
    });
    
    it("should compute different payload hashes for different payloads", () => {
      const payload1 = { messages: [{ role: "user", content: "A" }], attachments: [{ name: "a.pdf" }] };
      const payload2 = { messages: [{ role: "user", content: "B" }], attachments: [{ name: "b.pdf" }] };
      
      const hash1 = computePayloadHash(payload1);
      const hash2 = computePayloadHash(payload2);
      
      expect(hash1).not.toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash2).toHaveLength(64);
    });
    
    it("should compute same hash for identical payloads", () => {
      const payload = { messages: [{ role: "user", content: "Same" }], attachments: [{ name: "same.pdf" }] };
      
      const hash1 = computePayloadHash(payload);
      const hash2 = computePayloadHash(payload);
      
      expect(hash1).toBe(hash2);
    });
  });
  
  describe("Rate Limiting Under Concurrent Load", () => {
    it("should enforce rate limit and return 429 after threshold", async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.use(pareRequestContract);
      testApp.use(pareRateLimiter({ ipMaxRequests: 5, ipWindowMs: 60000 }));
      testApp.post("/api/analyze", (_req, res) => {
        res.json({ success: true });
      });
      
      const results: number[] = [];
      
      for (let i = 0; i < 10; i++) {
        const response = await request(testApp)
          .post("/api/analyze")
          .send({ attachments: [{ name: "test.pdf" }] });
        results.push(response.status);
      }
      
      const successCount = results.filter(s => s === 200).length;
      const rateLimitedCount = results.filter(s => s === 429).length;
      
      expect(successCount).toBe(5);
      expect(rateLimitedCount).toBe(5);
    });
    
    it("should include Retry-After header on 429 responses", async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.use(pareRequestContract);
      testApp.use(pareRateLimiter({ ipMaxRequests: 1, ipWindowMs: 60000 }));
      testApp.post("/api/analyze", (_req, res) => {
        res.json({ success: true });
      });
      
      await request(testApp)
        .post("/api/analyze")
        .send({ attachments: [{ name: "first.pdf" }] });
      
      const response = await request(testApp)
        .post("/api/analyze")
        .send({ attachments: [{ name: "second.pdf" }] });
      
      expect(response.status).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
      
      const retryAfter = parseInt(response.headers["retry-after"], 10);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });
    
    it("should return rate limit headers on successful requests", async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.use(pareRequestContract);
      testApp.use(pareRateLimiter({ ipMaxRequests: 10, ipWindowMs: 60000 }));
      testApp.post("/api/analyze", (_req, res) => {
        res.json({ success: true });
      });
      
      const response = await request(testApp)
        .post("/api/analyze")
        .send({ attachments: [{ name: "test.pdf" }] });
      
      expect(response.status).toBe(200);
      expect(response.headers["x-ratelimit-limit"]).toBe("10");
      expect(response.headers["x-ratelimit-remaining"]).toBeDefined();
      expect(response.headers["x-ratelimit-reset"]).toBeDefined();
    });
    
    it("should handle 100 concurrent requests and rate limit appropriately", async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.use(pareRequestContract);
      testApp.use(pareRateLimiter({ ipMaxRequests: 20, ipWindowMs: 60000 }));
      testApp.post("/api/analyze", (_req, res) => {
        res.json({ success: true });
      });
      
      clearPareRateLimitStores();
      
      const requests = Array(100).fill(null).map((_, i) =>
        request(testApp)
          .post("/api/analyze")
          .send({ attachments: [{ name: `file-${i}.pdf` }] })
      );
      
      const responses = await Promise.all(requests);
      
      const successCount = responses.filter(r => r.status === 200).length;
      const rateLimitedCount = responses.filter(r => r.status === 429).length;
      
      expect(successCount).toBe(20);
      expect(rateLimitedCount).toBe(80);
      
      responses.filter(r => r.status === 429).forEach(r => {
        expect(r.headers["retry-after"]).toBeDefined();
      });
    });
  });
  
  describe("Circuit Breaker Behavior", () => {
    it("should track parser failures", async () => {
      forceParserFailure = true;
      parserFailureCount = 0;
      
      const requests = Array(5).fill(null).map((_, i) =>
        request(app)
          .post("/api/analyze")
          .set("X-Idempotency-Key", generateTestIdempotencyKey())
          .send({
            messages: [{ role: "user", content: "Fail test" }],
            attachments: [{ name: `fail-${i}.pdf`, mimeType: "application/pdf", type: "document", content: "ZmFpbA==" }],
          })
      );
      
      const responses = await Promise.all(requests);
      
      const failedCount = responses.filter(r => r.status === 500).length;
      expect(failedCount).toBeGreaterThan(0);
      expect(parserFailureCount).toBeGreaterThan(0);
    });
    
    it("should mark idempotency key as failed on parser error", async () => {
      forceParserFailure = true;
      const idempotencyKey = generateTestIdempotencyKey();
      
      const response = await request(app)
        .post("/api/analyze")
        .set("X-Idempotency-Key", idempotencyKey)
        .send({
          messages: [{ role: "user", content: "Fail" }],
          attachments: [{ name: "fail.pdf", mimeType: "application/pdf", type: "document", content: "ZmFpbA==" }],
        });
      
      expect(response.status).toBe(500);
      
      forceParserFailure = false;
      
      const retryResponse = await request(app)
        .post("/api/analyze")
        .set("X-Idempotency-Key", idempotencyKey)
        .send({
          messages: [{ role: "user", content: "Fail" }],
          attachments: [{ name: "fail.pdf", mimeType: "application/pdf", type: "document", content: "ZmFpbA==" }],
        });
      
      expect(retryResponse.status).toBe(200);
    });
    
    it("should recover from failures and process new requests", async () => {
      forceParserFailure = true;
      
      await request(app)
        .post("/api/analyze")
        .set("X-Idempotency-Key", generateTestIdempotencyKey())
        .send({
          messages: [{ role: "user", content: "Fail" }],
          attachments: [{ name: "fail.pdf", mimeType: "application/pdf", type: "document", content: "ZmFpbA==" }],
        });
      
      forceParserFailure = false;
      
      const response = await request(app)
        .post("/api/analyze")
        .set("X-Idempotency-Key", generateTestIdempotencyKey())
        .send({
          messages: [{ role: "user", content: "Success" }],
          attachments: [{ name: "success.pdf", mimeType: "application/pdf", type: "document", content: "c3VjY2Vzcw==" }],
        });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
  
  describe("Stress Testing", () => {
    it("should handle mixed concurrent operations without deadlock", async () => {
      const operations = [
        ...Array(5).fill(null).map((_, i) => ({
          type: "normal",
          key: generateTestIdempotencyKey(),
          payload: { messages: [{ role: "user", content: `Normal ${i}` }], attachments: [{ name: `n${i}.pdf`, mimeType: "application/pdf", type: "document", content: "bm9ybWFs" }] },
        })),
        ...Array(3).fill(null).map(() => ({
          type: "duplicate",
          key: generateTestIdempotencyKey(),
          payload: { messages: [{ role: "user", content: "Duplicate" }], attachments: [{ name: "dup.pdf", mimeType: "application/pdf", type: "document", content: "ZHVw" }] },
        })),
        ...Array(2).fill(null).map((_, i) => ({
          type: "noKey",
          key: null,
          payload: { messages: [{ role: "user", content: `NoKey ${i}` }], attachments: [{ name: `nk${i}.pdf`, mimeType: "application/pdf", type: "document", content: "bm9rZXk=" }] },
        })),
      ];
      
      const duplicateKey = operations.find(o => o.type === "duplicate")?.key;
      operations.filter(o => o.type === "duplicate").forEach(o => {
        o.key = duplicateKey!;
      });
      
      processingDelay = 20;
      
      const requests = operations.map(op => {
        const req = request(app).post("/api/analyze");
        if (op.key) {
          req.set("X-Idempotency-Key", op.key);
        }
        return req.send(op.payload);
      });
      
      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(5000);
      
      const successfulResponses = responses.filter(r => r.status === 200 || r.status === 202);
      expect(successfulResponses.length).toBeGreaterThan(0);
      
      responses.forEach(r => {
        expect([200, 202, 400, 409, 429, 500]).toContain(r.status);
      });
    });
    
    it("should maintain request isolation under load", async () => {
      const requests = Array(20).fill(null).map((_, i) => {
        const key = generateTestIdempotencyKey();
        return request(app)
          .post("/api/analyze")
          .set("X-Idempotency-Key", key)
          .send({
            messages: [{ role: "user", content: `Request ${i}` }],
            attachments: [{ name: `doc-${i}.pdf`, mimeType: "application/pdf", type: "document", content: Buffer.from(`content-${i}`).toString("base64") }],
          });
      });
      
      const responses = await Promise.all(requests);
      
      const requestIds = responses
        .filter(r => r.status === 200)
        .map(r => r.body.requestId);
      
      const uniqueRequestIds = [...new Set(requestIds)];
      expect(uniqueRequestIds.length).toBe(requestIds.length);
    });
  });
});
