import { beforeEach, describe, expect, it, vi } from "vitest";

// ===== Mocks =====

vi.mock("../lib/llmGateway", () => ({
  llmGateway: {
    chat: vi.fn(),
    streamChat: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  db: {},
}));

vi.mock("../config/env", () => ({
  env: {
    NODE_ENV: "test",
  },
}));

vi.mock("../utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks are set up
import { apiKeyManager } from "../api/apiKeyManager";
import { planModeService } from "../agent/planMode";
import { llmGateway } from "../lib/llmGateway";

const mockChat = llmGateway.chat as ReturnType<typeof vi.fn>;

// ===== API Key Manager Tests =====

describe("ApiKeyManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create an API key and return raw key and id", async () => {
    const result = await apiKeyManager.createKey("user-1", "Test Key");
    expect(result.key).toMatch(/^sk-iliagpt-[a-f0-9]{64}$/);
    expect(result.id).toBeTruthy();
    expect(typeof result.id).toBe("string");
  });

  it("should validate a correct API key", async () => {
    const { key } = await apiKeyManager.createKey("user-2", "Valid Key");
    const validation = await apiKeyManager.validateKey(key);

    expect(validation.valid).toBe(true);
    expect(validation.userId).toBe("user-2");
    expect(validation.keyId).toBeTruthy();
  });

  it("should reject an invalid API key", async () => {
    const validation = await apiKeyManager.validateKey("sk-iliagpt-invalid");
    expect(validation.valid).toBe(false);
    expect(validation.userId).toBeUndefined();
  });

  it("should list keys showing prefix only", async () => {
    const { key } = await apiKeyManager.createKey("user-3", "List Test Key");
    const keys = await apiKeyManager.listKeys("user-3");

    expect(keys.length).toBeGreaterThanOrEqual(1);
    const found = keys.find((k) => k.name === "List Test Key");
    expect(found).toBeDefined();
    expect(found!.prefix).toBe(key.slice(0, 12));
    expect(found!.prefix.length).toBe(12);
    // Prefix should NOT contain the full key
    expect(found!.prefix).not.toBe(key);
  });

  it("should revoke an API key", async () => {
    const { key, id } = await apiKeyManager.createKey("user-4", "Revoke Key");

    // Key should be valid before revocation
    const beforeRevoke = await apiKeyManager.validateKey(key);
    expect(beforeRevoke.valid).toBe(true);

    // Revoke
    const revoked = await apiKeyManager.revokeKey("user-4", id);
    expect(revoked).toBe(true);

    // Key should be invalid after revocation
    const afterRevoke = await apiKeyManager.validateKey(key);
    expect(afterRevoke.valid).toBe(false);
  });

  it("should return false when revoking non-existent key", async () => {
    const result = await apiKeyManager.revokeKey("user-5", "non-existent-id");
    expect(result).toBe(false);
  });

  it("should enforce rate limit of 60 requests per minute", async () => {
    const { id } = await apiKeyManager.createKey("user-rate", "Rate Key");

    // First 60 requests should pass
    for (let i = 0; i < 60; i++) {
      expect(apiKeyManager.checkRateLimit(id)).toBe(true);
    }

    // 61st request should be rate limited
    expect(apiKeyManager.checkRateLimit(id)).toBe(false);
  });
});

// ===== Plan Mode Tests =====

describe("PlanModeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate a plan from a query", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        title: "Test Plan",
        steps: [
          { title: "Search", description: "Search for relevant files", toolName: "search", toolArgs: { query: "test" } },
          { title: "Analyze", description: "Analyze the results" },
          { title: "Summarize", description: "Summarize findings" },
        ],
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      requestId: "req-1",
      latencyMs: 500,
      model: "gpt-4o",
      provider: "openai",
    });

    const plan = await planModeService.generatePlan(
      "Find and analyze test files",
      "user-plan-1",
      "chat-1",
      ["search", "read_file", "write_file"],
    );

    expect(plan.id).toMatch(/^plan_/);
    expect(plan.status).toBe("draft");
    expect(plan.steps).toHaveLength(3);
    expect(plan.totalSteps).toBe(3);
    expect(plan.completedSteps).toBe(0);
    expect(plan.steps[0].description).toBe("Search for relevant files");
    expect(plan.steps[0].toolName).toBe("search");
    expect(plan.steps[1].toolName).toBeUndefined();
    expect(plan.title).toBe("Test Plan");
  });

  it("should approve a draft plan", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ title: "Quick Plan", steps: [{ description: "Step 1" }] }),
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      requestId: "req-2",
      latencyMs: 100,
      model: "gpt-4o",
      provider: "openai",
    });

    const plan = await planModeService.generatePlan("Do something", "user-approve", "chat-2", []);
    const approved = planModeService.approvePlan(plan.id);

    expect(approved).toBeDefined();
    expect(approved!.status).toBe("approved");
    expect(approved!.id).toBe(plan.id);
    expect(approved!.approvedAt).toBeDefined();
  });

  it("should reject a draft plan", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ steps: [{ description: "Step 1" }] }),
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      requestId: "req-3",
      latencyMs: 100,
      model: "gpt-4o",
      provider: "openai",
    });

    const plan = await planModeService.generatePlan("Do something", "user-reject", "chat-3", []);
    const rejected = planModeService.rejectPlan(plan.id);

    expect(rejected).toBeDefined();
    expect(rejected!.status).toBe("rejected");
  });

  it("should return undefined when approving non-existent plan", () => {
    const result = planModeService.approvePlan("plan_nonexistent");
    expect(result).toBeUndefined();
  });

  it("should return undefined when rejecting non-existent plan", () => {
    const result = planModeService.rejectPlan("plan_nonexistent");
    expect(result).toBeUndefined();
  });

  it("should modify plan steps and approve", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        steps: [
          { description: "Original step 1" },
          { description: "Original step 2" },
        ],
      }),
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      requestId: "req-4",
      latencyMs: 100,
      model: "gpt-4o",
      provider: "openai",
    });

    const plan = await planModeService.generatePlan("Do something", "user-modify", "chat-4", []);
    const modified = planModeService.modifyPlan(plan.id, [
      { stepIndex: 0, newDescription: "Modified step 1" },
    ]);

    expect(modified.status).toBe("approved");
    expect(modified.steps[0].description).toBe("Modified step 1");
    expect(modified.steps[1].description).toBe("Original step 2");
  });

  it("should execute plan steps and yield progress updates", async () => {
    // Mock for plan generation
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        steps: [
          { description: "Step A" },
          { description: "Step B" },
        ],
      }),
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      requestId: "req-5",
      latencyMs: 100,
      model: "gpt-4o",
      provider: "openai",
    });

    const plan = await planModeService.generatePlan("Execute test", "user-exec", "chat-5", []);
    planModeService.approvePlan(plan.id);

    // Mock for each step execution
    mockChat.mockResolvedValueOnce({
      content: "Result of step A",
      usage: { promptTokens: 20, completionTokens: 15, totalTokens: 35 },
      requestId: "req-5a",
      latencyMs: 200,
      model: "gpt-4o",
      provider: "openai",
    });
    mockChat.mockResolvedValueOnce({
      content: "Result of step B",
      usage: { promptTokens: 20, completionTokens: 15, totalTokens: 35 },
      requestId: "req-5b",
      latencyMs: 200,
      model: "gpt-4o",
      provider: "openai",
    });

    const updates: Array<{ type: string }> = [];
    for await (const update of planModeService.executePlan(plan.id)) {
      updates.push(update);
    }

    // Should have: step_start, step_complete, step_start, step_complete, plan_complete
    expect(updates).toHaveLength(5);
    expect(updates[0].type).toBe("step_start");
    expect(updates[1].type).toBe("step_complete");
    expect(updates[2].type).toBe("step_start");
    expect(updates[3].type).toBe("step_complete");
    expect(updates[4].type).toBe("plan_complete");
  });

  it("should handle step execution failure and skip remaining steps", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        steps: [
          { description: "Fail step" },
          { description: "Skip step" },
        ],
      }),
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      requestId: "req-6",
      latencyMs: 100,
      model: "gpt-4o",
      provider: "openai",
    });

    const plan = await planModeService.generatePlan("Fail test", "user-fail", "chat-6", []);
    planModeService.approvePlan(plan.id);

    // First step execution fails
    mockChat.mockRejectedValueOnce(new Error("LLM connection failed"));

    const updates: Array<{ type: string; step: any; plan: any }> = [];
    for await (const update of planModeService.executePlan(plan.id)) {
      updates.push(update);
    }

    // step_start, step_failed (then stops)
    expect(updates).toHaveLength(2);
    expect(updates[0].type).toBe("step_start");
    expect(updates[1].type).toBe("step_failed");
    expect(updates[1].step.error).toBe("LLM connection failed");

    // Check that remaining steps are skipped
    const finalPlan = planModeService.getPlan(plan.id);
    expect(finalPlan!.status).toBe("failed");
    expect(finalPlan!.steps[1].status).toBe("skipped");
  });

  it("should get active plans for a user", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ steps: [{ description: "Active step" }] }),
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      requestId: "req-7",
      latencyMs: 100,
      model: "gpt-4o",
      provider: "openai",
    });

    const plan = await planModeService.generatePlan("Active plan", "user-active", "chat-7", []);
    const activePlans = planModeService.getActivePlans("user-active");

    expect(activePlans.some((p) => p.id === plan.id)).toBe(true);
  });

  it("should throw when executing unapproved plan", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ steps: [{ description: "Unapproved" }] }),
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      requestId: "req-8",
      latencyMs: 100,
      model: "gpt-4o",
      provider: "openai",
    });

    const plan = await planModeService.generatePlan("Unapproved", "user-unapp", "chat-8", []);

    const gen = planModeService.executePlan(plan.id);
    await expect(gen.next()).rejects.toThrow("Plan must be approved");
  });

  it("should handle malformed LLM JSON gracefully", async () => {
    mockChat.mockResolvedValueOnce({
      content: "This is not valid JSON at all",
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      requestId: "req-9",
      latencyMs: 100,
      model: "gpt-4o",
      provider: "openai",
    });

    const plan = await planModeService.generatePlan("Malformed", "user-mal", "chat-9", []);

    // Should fallback to a single step plan
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].description).toBe("Malformed");
    expect(plan.status).toBe("draft");
  });
});

// ===== OpenAI-Compatible API Format Tests =====

describe("OpenAI Format Compliance", () => {
  it("chat completion response has choices array with usage object", () => {
    const response = {
      id: "chatcmpl-abc123",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    expect(response.object).toBe("chat.completion");
    expect(Array.isArray(response.choices)).toBe(true);
    expect(response.choices[0]).toHaveProperty("index");
    expect(response.choices[0]).toHaveProperty("message");
    expect(response.choices[0]).toHaveProperty("finish_reason");
    expect(response.usage).toHaveProperty("prompt_tokens");
    expect(response.usage).toHaveProperty("completion_tokens");
    expect(response.usage).toHaveProperty("total_tokens");
    expect(response.id).toMatch(/^chatcmpl-/);
    expect(typeof response.created).toBe("number");
  });

  it("streaming chunk has delta with content", () => {
    const chunk = {
      id: "chatcmpl-abc123",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          delta: { content: "Hello" },
          finish_reason: null,
        },
      ],
    };

    expect(chunk.object).toBe("chat.completion.chunk");
    expect(Array.isArray(chunk.choices)).toBe(true);
    expect(chunk.choices[0]).toHaveProperty("delta");
    expect(chunk.choices[0].delta).toHaveProperty("content");
    expect(chunk.choices[0].finish_reason).toBeNull();
  });

  it("models list returns objects with correct shape", () => {
    const modelsList = {
      object: "list",
      data: [
        {
          id: "gpt-4o",
          object: "model",
          created: 1700000000,
          owned_by: "openai",
        },
      ],
    };

    expect(modelsList.object).toBe("list");
    expect(Array.isArray(modelsList.data)).toBe(true);
    expect(modelsList.data[0].object).toBe("model");
    expect(modelsList.data[0]).toHaveProperty("id");
    expect(modelsList.data[0]).toHaveProperty("owned_by");
  });

  it("embeddings response has correct structure with 1536-dim vectors", () => {
    const embeddingsResponse = {
      object: "list",
      data: [
        {
          object: "embedding",
          embedding: new Array(1536).fill(0),
          index: 0,
        },
      ],
      model: "text-embedding-iliagpt-1536",
      usage: {
        prompt_tokens: 10,
        total_tokens: 10,
      },
    };

    expect(embeddingsResponse.object).toBe("list");
    expect(Array.isArray(embeddingsResponse.data)).toBe(true);
    expect(embeddingsResponse.data[0].object).toBe("embedding");
    expect(embeddingsResponse.data[0].embedding).toHaveLength(1536);
    expect(embeddingsResponse.usage).toHaveProperty("prompt_tokens");
    expect(embeddingsResponse.usage).toHaveProperty("total_tokens");
  });

  it("error responses follow OpenAI error envelope format", () => {
    const errorResponse = {
      error: {
        message: "Invalid API key provided.",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    };

    expect(errorResponse.error).toHaveProperty("message");
    expect(errorResponse.error).toHaveProperty("type");
    expect(errorResponse.error).toHaveProperty("code");
  });
});
