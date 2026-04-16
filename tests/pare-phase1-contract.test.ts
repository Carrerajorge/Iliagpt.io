import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { Express, Request, Response, NextFunction } from "express";
import request from "supertest";
import { pareRequestContract, requirePareContext, type PareContext } from "../server/middleware/pareRequestContract";
import { pareRateLimiter, clearPareRateLimitStores, ipRateLimitStore, userRateLimitStore } from "../server/middleware/pareRateLimiter";
import { pareQuotaGuard, getQuotaConfig } from "../server/middleware/pareQuotaGuard";

function createTestApp(middlewares: Array<(req: Request, res: Response, next: NextFunction) => void>): Express {
  const app = express();
  app.use(express.json({ limit: "200mb" }));
  
  middlewares.forEach(mw => app.use(mw));
  
  app.post("/test", (req, res) => {
    const pareContext = (req as any).pareContext;
    res.json({
      success: true,
      pareContext: pareContext ? {
        requestId: pareContext.requestId,
        idempotencyKey: pareContext.idempotencyKey,
        isDataMode: pareContext.isDataMode,
        attachmentsCount: pareContext.attachmentsCount,
        hasStartTime: typeof pareContext.startTime === "number",
        hasClientIp: typeof pareContext.clientIp === "string",
        userId: pareContext.userId,
      } : null,
    });
  });
  
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  
  return app;
}

describe("PARE Phase 1 Request Contract Infrastructure", () => {
  
  describe("pareRequestContract Middleware", () => {
    
    it("should generate X-Request-Id if not provided", async () => {
      const app = createTestApp([pareRequestContract]);
      
      const response = await request(app)
        .post("/test")
        .send({ attachments: [] });
      
      expect(response.status).toBe(200);
      expect(response.headers["x-request-id"]).toBeDefined();
      expect(response.body.pareContext.requestId).toBeDefined();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(response.body.pareContext.requestId)).toBe(true);
    });
    
    it("should preserve valid X-Request-Id if provided", async () => {
      const app = createTestApp([pareRequestContract]);
      const customRequestId = "550e8400-e29b-41d4-a716-446655440000";
      
      const response = await request(app)
        .post("/test")
        .set("X-Request-Id", customRequestId)
        .send({ attachments: [] });
      
      expect(response.status).toBe(200);
      expect(response.headers["x-request-id"]).toBe(customRequestId);
      expect(response.body.pareContext.requestId).toBe(customRequestId);
    });
    
    it("should regenerate invalid X-Request-Id", async () => {
      const app = createTestApp([pareRequestContract]);
      const invalidRequestId = "not-a-valid-uuid";
      
      const response = await request(app)
        .post("/test")
        .set("X-Request-Id", invalidRequestId)
        .send({ attachments: [] });
      
      expect(response.status).toBe(200);
      expect(response.body.pareContext.requestId).not.toBe(invalidRequestId);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(response.body.pareContext.requestId)).toBe(true);
    });
    
    it("should extract X-Idempotency-Key header", async () => {
      const app = createTestApp([pareRequestContract]);
      const idempotencyKey = "idem-key-12345";
      
      const response = await request(app)
        .post("/test")
        .set("X-Idempotency-Key", idempotencyKey)
        .send({ attachments: [] });
      
      expect(response.status).toBe(200);
      expect(response.body.pareContext.idempotencyKey).toBe(idempotencyKey);
    });
    
    it("should return null idempotencyKey when header not provided", async () => {
      const app = createTestApp([pareRequestContract]);
      
      const response = await request(app)
        .post("/test")
        .send({ attachments: [] });
      
      expect(response.status).toBe(200);
      expect(response.body.pareContext.idempotencyKey).toBeNull();
    });
    
    it("should detect DATA_MODE when attachments are present", async () => {
      const app = createTestApp([pareRequestContract]);
      
      const response = await request(app)
        .post("/test")
        .send({ 
          attachments: [
            { name: "doc1.pdf", type: "application/pdf" },
            { name: "doc2.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
          ] 
        });
      
      expect(response.status).toBe(200);
      expect(response.body.pareContext.isDataMode).toBe(true);
      expect(response.body.pareContext.attachmentsCount).toBe(2);
    });
    
    it("should NOT detect DATA_MODE when no attachments", async () => {
      const app = createTestApp([pareRequestContract]);
      
      const response = await request(app)
        .post("/test")
        .send({ attachments: [] });
      
      expect(response.status).toBe(200);
      expect(response.body.pareContext.isDataMode).toBe(false);
      expect(response.body.pareContext.attachmentsCount).toBe(0);
    });
    
    it("should NOT detect DATA_MODE when attachments undefined", async () => {
      const app = createTestApp([pareRequestContract]);
      
      const response = await request(app)
        .post("/test")
        .send({ message: "hello" });
      
      expect(response.status).toBe(200);
      expect(response.body.pareContext.isDataMode).toBe(false);
      expect(response.body.pareContext.attachmentsCount).toBe(0);
    });
    
    it("should include startTime in context", async () => {
      const app = createTestApp([pareRequestContract]);
      
      const before = Date.now();
      const response = await request(app)
        .post("/test")
        .send({ attachments: [] });
      const after = Date.now();
      
      expect(response.status).toBe(200);
      expect(response.body.pareContext.hasStartTime).toBe(true);
    });
    
    it("should propagate requestId in response header", async () => {
      const app = createTestApp([pareRequestContract]);
      
      const response = await request(app)
        .post("/test")
        .send({ attachments: [] });
      
      expect(response.status).toBe(200);
      const headerRequestId = response.headers["x-request-id"];
      const contextRequestId = response.body.pareContext.requestId;
      expect(headerRequestId).toBe(contextRequestId);
    });
  });
  
  describe("pareRateLimiter Middleware", () => {
    
    beforeEach(() => {
      clearPareRateLimitStores();
    });
    
    afterEach(() => {
      clearPareRateLimitStores();
    });
    
    it("should allow requests within IP rate limit", async () => {
      const app = createTestApp([
        pareRequestContract,
        pareRateLimiter({ ipMaxRequests: 5, ipWindowMs: 60000 }),
      ]);
      
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post("/test")
          .send({ attachments: [] });
        
        expect(response.status).toBe(200);
      }
    });
    
    it("should return 429 when IP rate limit exceeded", async () => {
      const app = createTestApp([
        pareRequestContract,
        pareRateLimiter({ ipMaxRequests: 3, ipWindowMs: 60000 }),
      ]);
      
      for (let i = 0; i < 3; i++) {
        await request(app).post("/test").send({ attachments: [] });
      }
      
      const response = await request(app)
        .post("/test")
        .send({ attachments: [] });
      
      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe("TOO_MANY_REQUESTS");
      expect(response.body.error.limitType).toBe("ip");
      expect(response.headers["retry-after"]).toBeDefined();
    });
    
    it("should include Retry-After header on rate limit", async () => {
      const app = createTestApp([
        pareRequestContract,
        pareRateLimiter({ ipMaxRequests: 1, ipWindowMs: 60000 }),
      ]);
      
      await request(app).post("/test").send({ attachments: [] });
      
      const response = await request(app)
        .post("/test")
        .send({ attachments: [] });
      
      expect(response.status).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
      const retryAfter = parseInt(response.headers["retry-after"], 10);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });
    
    it("should set rate limit headers on successful requests", async () => {
      const app = createTestApp([
        pareRequestContract,
        pareRateLimiter({ ipMaxRequests: 10, ipWindowMs: 60000 }),
      ]);
      
      const response = await request(app)
        .post("/test")
        .send({ attachments: [] });
      
      expect(response.status).toBe(200);
      expect(response.headers["x-ratelimit-limit"]).toBe("10");
      expect(response.headers["x-ratelimit-remaining"]).toBeDefined();
      expect(response.headers["x-ratelimit-reset"]).toBeDefined();
    });
    
    it("should track user rate limit when userId present", async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).user = { claims: { sub: "user-123" } };
        next();
      });
      app.use(pareRequestContract);
      app.use(pareRateLimiter({ userMaxRequests: 2, userWindowMs: 60000, ipMaxRequests: 100 }));
      app.post("/test", (req, res) => {
        res.json({ success: true });
      });
      
      await request(app).post("/test").send({ attachments: [] });
      await request(app).post("/test").send({ attachments: [] });
      
      const response = await request(app)
        .post("/test")
        .send({ attachments: [] });
      
      expect(response.status).toBe(429);
      expect(response.body.error.limitType).toBe("user");
    });
  });
  
  describe("pareQuotaGuard Middleware", () => {
    
    it("should allow requests within quota limits", async () => {
      const app = createTestApp([
        pareRequestContract,
        pareQuotaGuard({ maxFilesPerRequest: 20 }),
      ]);
      
      const response = await request(app)
        .post("/test")
        .send({ 
          attachments: [
            { name: "doc1.pdf", size: 1000 },
            { name: "doc2.pdf", size: 2000 }
          ]
        });
      
      expect(response.status).toBe(200);
    });
    
    it("should return 422 when max files exceeded", async () => {
      const app = createTestApp([
        pareRequestContract,
        pareQuotaGuard({ maxFilesPerRequest: 2 }),
      ]);
      
      const response = await request(app)
        .post("/test")
        .send({ 
          attachments: [
            { name: "doc1.pdf", size: 1000 },
            { name: "doc2.pdf", size: 1000 },
            { name: "doc3.pdf", size: 1000 }
          ]
        });
      
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("QUOTA_EXCEEDED");
      expect(response.body.error.violations.some((v: any) => v.type === "MAX_FILES_EXCEEDED")).toBe(true);
    });
    
    it("should return 422 when single file size exceeded", async () => {
      const MB = 1024 * 1024;
      const app = createTestApp([
        pareRequestContract,
        pareQuotaGuard({ maxFileSizeBytes: 10 * MB }),
      ]);
      
      const response = await request(app)
        .post("/test")
        .send({ 
          attachments: [
            { name: "large-doc.pdf", size: 20 * MB }
          ]
        });
      
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("QUOTA_EXCEEDED");
      expect(response.body.error.violations.some((v: any) => v.type === "FILE_SIZE_EXCEEDED")).toBe(true);
    });
    
    it("should return 422 when total size exceeded", async () => {
      const MB = 1024 * 1024;
      const app = createTestApp([
        pareRequestContract,
        pareQuotaGuard({ 
          maxFileSizeBytes: 100 * MB,
          maxTotalSizeBytes: 50 * MB 
        }),
      ]);
      
      const response = await request(app)
        .post("/test")
        .send({ 
          attachments: [
            { name: "doc1.pdf", size: 30 * MB },
            { name: "doc2.pdf", size: 30 * MB }
          ]
        });
      
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("QUOTA_EXCEEDED");
      expect(response.body.error.violations.some((v: any) => v.type === "TOTAL_SIZE_EXCEEDED")).toBe(true);
    });
    
    it("should return 422 when max pages estimate exceeded", async () => {
      const app = createTestApp([
        pareRequestContract,
        pareQuotaGuard({ 
          maxPagesEstimate: 10,
          bytesPerPageEstimate: 3000,
          maxFileSizeBytes: 100 * 1024 * 1024,
          maxTotalSizeBytes: 200 * 1024 * 1024,
        }),
      ]);
      
      const response = await request(app)
        .post("/test")
        .send({ 
          attachments: [
            { name: "big-doc.pdf", size: 50000 }
          ]
        });
      
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("QUOTA_EXCEEDED");
      expect(response.body.error.violations.some((v: any) => v.type === "MAX_PAGES_EXCEEDED")).toBe(true);
    });
    
    it("should include limit details in quota error response", async () => {
      const MB = 1024 * 1024;
      const app = createTestApp([
        pareRequestContract,
        pareQuotaGuard({ maxFilesPerRequest: 1 }),
      ]);
      
      const response = await request(app)
        .post("/test")
        .send({ 
          attachments: [
            { name: "doc1.pdf", size: 1000 },
            { name: "doc2.pdf", size: 1000 }
          ]
        });
      
      expect(response.status).toBe(422);
      expect(response.body.error.limits).toBeDefined();
      expect(response.body.error.limits.maxFiles).toBe(1);
      expect(response.body.error.requestId).toBeDefined();
    });
    
    it("should pass through when no attachments", async () => {
      const app = createTestApp([
        pareRequestContract,
        pareQuotaGuard(),
      ]);
      
      const response = await request(app)
        .post("/test")
        .send({ message: "hello" });
      
      expect(response.status).toBe(200);
    });
    
    it("should calculate size from base64 content", async () => {
      const app = createTestApp([
        pareRequestContract,
        pareQuotaGuard({ maxFileSizeBytes: 100 }),
      ]);
      
      const largeBase64 = "data:application/pdf;base64," + "A".repeat(200);
      
      const response = await request(app)
        .post("/test")
        .send({ 
          attachments: [
            { name: "doc.pdf", content: largeBase64 }
          ]
        });
      
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("QUOTA_EXCEEDED");
    });
  });
  
  describe("DATA_MODE Server-Side Enforcement", () => {
    
    it("should enforce DATA_MODE based on attachments.length, ignoring frontend flag", async () => {
      const app = createTestApp([pareRequestContract]);
      
      const response = await request(app)
        .post("/test")
        .send({ 
          documentMode: false,
          attachments: [{ name: "doc.pdf" }]
        });
      
      expect(response.status).toBe(200);
      expect(response.body.pareContext.isDataMode).toBe(true);
    });
    
    it("should NOT enforce DATA_MODE when attachments empty, even if frontend says true", async () => {
      const app = createTestApp([pareRequestContract]);
      
      const response = await request(app)
        .post("/test")
        .send({ 
          documentMode: true,
          attachments: []
        });
      
      expect(response.status).toBe(200);
      expect(response.body.pareContext.isDataMode).toBe(false);
    });
  });
  
  describe("Middleware Integration", () => {
    
    beforeEach(() => {
      clearPareRateLimitStores();
    });
    
    afterEach(() => {
      clearPareRateLimitStores();
    });
    
    it("should work with all 3 middlewares in sequence", async () => {
      const app = createTestApp([
        pareRequestContract,
        pareRateLimiter({ ipMaxRequests: 100 }),
        pareQuotaGuard({ maxFilesPerRequest: 10 }),
      ]);
      
      const response = await request(app)
        .post("/test")
        .set("X-Idempotency-Key", "test-key-123")
        .send({ 
          attachments: [{ name: "doc.pdf", size: 1000 }]
        });
      
      expect(response.status).toBe(200);
      expect(response.body.pareContext.idempotencyKey).toBe("test-key-123");
      expect(response.body.pareContext.isDataMode).toBe(true);
      expect(response.headers["x-request-id"]).toBeDefined();
      expect(response.headers["x-ratelimit-limit"]).toBeDefined();
    });
    
    it("should block at rate limiter before reaching quota guard", async () => {
      const app = createTestApp([
        pareRequestContract,
        pareRateLimiter({ ipMaxRequests: 1 }),
        pareQuotaGuard({ maxFilesPerRequest: 10 }),
      ]);
      
      await request(app).post("/test").send({ attachments: [] });
      
      const response = await request(app)
        .post("/test")
        .send({ attachments: [{ name: "doc.pdf", size: 1000 }] });
      
      expect(response.status).toBe(429);
    });
    
    it("should propagate requestId through all middleware responses", async () => {
      const app = createTestApp([
        pareRequestContract,
        pareRateLimiter({ ipMaxRequests: 100 }),
        pareQuotaGuard({ maxFilesPerRequest: 1 }),
      ]);
      
      const response = await request(app)
        .post("/test")
        .send({ 
          attachments: [
            { name: "doc1.pdf", size: 1000 },
            { name: "doc2.pdf", size: 1000 }
          ]
        });
      
      expect(response.status).toBe(422);
      expect(response.body.error.requestId).toBeDefined();
      expect(response.headers["x-request-id"]).toBe(response.body.error.requestId);
    });
  });
});
