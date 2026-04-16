import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mocks – must be defined before imports that use the mocked modules
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({
  db: { execute: vi.fn() },
}));

vi.mock("../config/env", () => ({
  env: { NODE_ENV: "test" },
}));

vi.mock("../utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../lib/llmGateway", () => ({
  llmGateway: {
    chat: vi.fn(),
    streamChat: vi.fn(),
  },
}));

vi.mock("../lib/tokenCounter", () => ({
  tokenCounter: {
    countAccurate: vi.fn().mockReturnValue(10),
    countFast: vi.fn().mockReturnValue(5),
  },
}));

vi.mock("../embeddingService", () => ({
  generateEmbeddingsBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
}));

// Mock the DB-backed auth to allow controlled testing
vi.mock("../api/v1/apiAuth", () => {
  const validKey = "sk-test-valid-key";
  const expiredKey = "sk-test-expired-key";
  const deactivatedKey = "sk-test-deactivated-key";
  const rateLimitedKey = "sk-test-ratelimited-key";

  let rateLimitCounter = 0;

  return {
    authenticateApiKey: vi.fn().mockImplementation((req: any, res: any, next: any) => {
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        return res.status(401).json({
          error: { message: "Missing API key", type: "invalid_request_error", param: null, code: "missing_api_key" },
        });
      }
      const key = auth.slice(7);
      if (key === expiredKey) {
        return res.status(401).json({
          error: { message: "This API key has expired", type: "authentication_error", param: null, code: "api_key_expired" },
        });
      }
      if (key === deactivatedKey) {
        return res.status(401).json({
          error: { message: "This API key has been deactivated", type: "authentication_error", param: null, code: "api_key_deactivated" },
        });
      }
      if (key !== validKey && key !== rateLimitedKey) {
        return res.status(401).json({
          error: { message: "Invalid API key provided", type: "authentication_error", param: null, code: "invalid_api_key" },
        });
      }
      req.apiKeyUser = {
        userId: "test-user-1",
        email: "test@example.com",
        role: "user",
        apiKeyId: "key-id-1",
        permissions: ["read", "write"],
        rateLimit: key === rateLimitedKey ? 0 : 1000, // 0 limit = already exceeded
      };
      next();
    }),
    apiRateLimit: vi.fn().mockImplementation((req: any, res: any, next: any) => {
      if (req.apiKeyUser?.rateLimit === 0) {
        return res.status(429).json({
          error: { message: "Rate limit exceeded", type: "tokens_exceeded", param: null, code: "rate_limit_exceeded" },
        });
      }
      next();
    }),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createOpenAICompatRouter } from "../api/v1/completions";
import { llmGateway } from "../lib/llmGateway";

const VALID_AUTH = "Bearer sk-test-valid-key";
const EXPIRED_AUTH = "Bearer sk-test-expired-key";
const RATE_LIMITED_AUTH = "Bearer sk-test-ratelimited-key";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", createOpenAICompatRouter());
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenAI-Compatible API (/v1)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  // 1. GET /v1/models returns model list
  describe("GET /v1/models", () => {
    it("returns a list of models in OpenAI format", async () => {
      const res = await request(app)
        .get("/v1/models")
        .set("Authorization", VALID_AUTH);

      expect(res.status).toBe(200);
      expect(res.body.object).toBe("list");
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      const first = res.body.data[0];
      expect(first).toHaveProperty("id");
      expect(first).toHaveProperty("object", "model");
      expect(first).toHaveProperty("created");
      expect(first).toHaveProperty("owned_by");
    });
  });

  // 2. POST /v1/chat/completions without auth returns 401
  describe("POST /v1/chat/completions – auth", () => {
    it("returns 401 when no Authorization header is provided", async () => {
      const res = await request(app)
        .post("/v1/chat/completions")
        .send({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("missing_api_key");
    });
  });

  // 3. POST /v1/chat/completions with invalid model returns error
  describe("POST /v1/chat/completions – validation", () => {
    it("returns 400 when model is missing", async () => {
      const res = await request(app)
        .post("/v1/chat/completions")
        .set("Authorization", VALID_AUTH)
        .send({ messages: [{ role: "user", content: "hi" }] });

      expect(res.status).toBe(400);
      expect(res.body.error.param).toBe("model");
    });

    it("returns 400 when messages is empty", async () => {
      const res = await request(app)
        .post("/v1/chat/completions")
        .set("Authorization", VALID_AUTH)
        .send({ model: "gpt-4o", messages: [] });

      expect(res.status).toBe(400);
      expect(res.body.error.param).toBe("messages");
    });
  });

  // 4. Non-streaming response has correct OpenAI format
  describe("POST /v1/chat/completions – non-streaming", () => {
    it("returns a properly formatted chat completion", async () => {
      (llmGateway.chat as any).mockResolvedValue({
        content: "Hello! How can I help?",
        usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
        model: "gpt-4o",
        provider: "openai",
        requestId: "req-1",
        latencyMs: 200,
        status: "completed",
      });

      const res = await request(app)
        .post("/v1/chat/completions")
        .set("Authorization", VALID_AUTH)
        .send({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        });

      expect(res.status).toBe(200);
      expect(res.body.object).toBe("chat.completion");
      expect(res.body.id).toMatch(/^chatcmpl-/);
      expect(res.body.model).toBe("gpt-4o");
      expect(res.body.choices).toHaveLength(1);
      expect(res.body.choices[0].message.role).toBe("assistant");
      expect(res.body.choices[0].message.content).toBe("Hello! How can I help?");
      expect(res.body.choices[0].finish_reason).toBe("stop");
      expect(res.body.usage).toEqual({
        prompt_tokens: 5,
        completion_tokens: 8,
        total_tokens: 13,
      });
    });
  });

  // 5. Streaming response sends SSE chunks with [DONE]
  describe("POST /v1/chat/completions – streaming", () => {
    it("returns SSE chunks ending with [DONE]", async () => {
      async function* fakeStream() {
        yield { content: "Hello", sequenceId: 0, done: false, requestId: "req-s" };
        yield { content: " world", sequenceId: 1, done: false, requestId: "req-s" };
        yield { content: "", sequenceId: 2, done: true, requestId: "req-s" };
      }
      (llmGateway.streamChat as any).mockReturnValue(fakeStream());

      const res = await request(app)
        .post("/v1/chat/completions")
        .set("Authorization", VALID_AUTH)
        .send({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hi" }],
          stream: true,
        });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");

      const text = res.text;
      // Should contain content chunks
      expect(text).toContain('"Hello"');
      expect(text).toContain('" world"');
      // Should end with [DONE]
      expect(text).toContain("data: [DONE]");
      // Should contain finish_reason: stop
      expect(text).toContain('"finish_reason":"stop"');
      // Every data line should be valid JSON (except [DONE])
      const dataLines = text
        .split("\n")
        .filter((l: string) => l.startsWith("data: ") && !l.includes("[DONE]"));
      for (const line of dataLines) {
        const json = JSON.parse(line.slice(6));
        expect(json.object).toBe("chat.completion.chunk");
        expect(json.id).toMatch(/^chatcmpl-/);
      }
    });
  });

  // 6. POST /v1/embeddings returns correct format
  describe("POST /v1/embeddings", () => {
    it("returns embeddings in OpenAI format", async () => {
      const res = await request(app)
        .post("/v1/embeddings")
        .set("Authorization", VALID_AUTH)
        .send({ model: "text-embedding-ada-002", input: "Hello world" });

      expect(res.status).toBe(200);
      expect(res.body.object).toBe("list");
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].object).toBe("embedding");
      expect(res.body.data[0].index).toBe(0);
      expect(Array.isArray(res.body.data[0].embedding)).toBe(true);
      expect(res.body.usage).toHaveProperty("prompt_tokens");
      expect(res.body.usage).toHaveProperty("total_tokens");
      expect(res.body.model).toBe("text-embedding-iliagpt-1536");
    });

    it("returns 400 when input is missing", async () => {
      const res = await request(app)
        .post("/v1/embeddings")
        .set("Authorization", VALID_AUTH)
        .send({ model: "text-embedding-ada-002" });

      expect(res.status).toBe(400);
      expect(res.body.error.param).toBe("input");
    });
  });

  // 7. API key validation middleware rejects expired keys
  describe("API key validation", () => {
    it("rejects expired API keys", async () => {
      const res = await request(app)
        .get("/v1/models")
        .set("Authorization", EXPIRED_AUTH);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("api_key_expired");
    });
  });

  // 8. Rate limiting returns 429 with OpenAI-format error
  describe("Rate limiting", () => {
    it("returns 429 with OpenAI-style error when rate limited", async () => {
      const res = await request(app)
        .get("/v1/models")
        .set("Authorization", RATE_LIMITED_AUTH);

      expect(res.status).toBe(429);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("rate_limit_exceeded");
      expect(res.body.error.type).toBe("tokens_exceeded");
    });
  });
});
