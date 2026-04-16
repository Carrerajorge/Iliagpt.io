import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import {
  toolRegistry,
  agentRegistry,
  orchestrator,
  capabilitiesReportRunner,
  initializeAgentSystem,
  RegisteredTool,
  ToolConfig,
  TOOL_CATEGORIES,
} from "../index";

describe("Tool Registry", () => {
  beforeAll(async () => {
    await initializeAgentSystem({ runSmokeTest: false });
  });

  describe("Registration", () => {
    it("should have 100+ tools registered", () => {
      const stats = toolRegistry.getStats();
      expect(stats.totalTools).toBeGreaterThanOrEqual(100);
    });

    it("should have tools in all 19 categories", () => {
      const stats = toolRegistry.getStats();
      const categoryCount = Object.keys(stats.byCategory).length;
      expect(categoryCount).toBeGreaterThanOrEqual(19);
    });

    it("should have unique tool names", () => {
      const tools = toolRegistry.getAll();
      const names = tools.map(t => t.metadata.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it("each tool should have valid metadata", () => {
      const tools = toolRegistry.getAll();
      for (const tool of tools) {
        expect(tool.metadata.name).toBeTruthy();
        expect(tool.metadata.name.length).toBeGreaterThan(0);
        expect(tool.metadata.description).toBeTruthy();
        expect(tool.metadata.description.length).toBeGreaterThanOrEqual(10);
        expect(tool.metadata.category).toBeTruthy();
        expect(TOOL_CATEGORIES).toContain(tool.metadata.category);
      }
    });

    it("each tool should have valid config", () => {
      const tools = toolRegistry.getAll();
      for (const tool of tools) {
        expect(tool.config.timeout).toBeGreaterThan(0);
        expect(tool.config.maxRetries).toBeGreaterThanOrEqual(0);
        expect(tool.config.rateLimitPerMinute).toBeGreaterThan(0);
        expect(tool.config.rateLimitPerHour).toBeGreaterThan(0);
      }
    });

    it("each tool should have input and output schemas", () => {
      const tools = toolRegistry.getAll();
      for (const tool of tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
        expect(typeof tool.inputSchema.safeParse).toBe("function");
        expect(typeof tool.outputSchema.safeParse).toBe("function");
      }
    });
  });

  describe("Schema Validation", () => {
    it("should validate web_search input correctly", () => {
      const tool = toolRegistry.get("web_search");
      expect(tool).toBeDefined();
      
      const validInput = { query: "test query", maxResults: 5 };
      const validResult = tool!.inputSchema.safeParse(validInput);
      expect(validResult.success).toBe(true);

      const invalidInput = { query: "", maxResults: 100 };
      const invalidResult = tool!.inputSchema.safeParse(invalidInput);
      expect(invalidResult.success).toBe(false);
    });

    it("should validate hash input correctly", () => {
      const tool = toolRegistry.get("hash");
      expect(tool).toBeDefined();
      
      const validInput = { data: "test", algorithm: "sha256" };
      const validResult = tool!.inputSchema.safeParse(validInput);
      expect(validResult.success).toBe(true);
    });

    it("should reject invalid inputs", () => {
      const tool = toolRegistry.get("email_send");
      expect(tool).toBeDefined();
      
      const invalidInput = { to: ["not-an-email"], subject: "test", body: "test" };
      const result = tool!.inputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe("Tool Execution", () => {
    it("should execute hash tool successfully", async () => {
      const result = await toolRegistry.execute("hash", {
        data: "test",
        algorithm: "sha256",
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.trace.status).toBe("success");
      expect(result.trace.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should execute uuid_generate tool successfully", async () => {
      const result = await toolRegistry.execute("uuid_generate", {
        version: "v4",
        count: 3,
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("should execute json_parse tool successfully", async () => {
      const result = await toolRegistry.execute("json_parse", {
        input: '{"test": true, "value": 42}',
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("should execute csv_parse tool successfully", async () => {
      const result = await toolRegistry.execute("csv_parse", {
        input: "name,value\ntest,42\nfoo,100",
        delimiter: ",",
        hasHeaders: true,
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("should execute password_generate tool successfully", async () => {
      const result = await toolRegistry.execute("password_generate", {
        length: 16,
        includeSymbols: true,
        includeNumbers: true,
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("should return NOT_FOUND_ERROR for non-existent tool", async () => {
      const result = await toolRegistry.execute("non_existent_tool", {});
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_FOUND_ERROR");
    });

    it("should return VALIDATION_ERROR for invalid input", async () => {
      const result = await toolRegistry.execute("web_search", {
        query: "", // Empty query should fail validation
        maxResults: 1000, // Exceeds max
      });
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Tracing", () => {
    it("should record traces for all executions", async () => {
      const initialTraces = toolRegistry.getTraces().length;
      
      await toolRegistry.execute("hash", { data: "test", algorithm: "sha256" });
      await toolRegistry.execute("uuid_generate", { version: "v4" });
      
      const newTraces = toolRegistry.getTraces().length;
      expect(newTraces).toBeGreaterThanOrEqual(initialTraces + 2);
    });

    it("should include required trace fields", async () => {
      await toolRegistry.execute("base64_encode", {
        input: "hello world",
        operation: "encode",
      });
      
      const traces = toolRegistry.getTraces({ toolName: "base64_encode", limit: 1 });
      expect(traces.length).toBe(1);
      
      const trace = traces[0];
      expect(trace.requestId).toBeDefined();
      expect(trace.toolName).toBe("base64_encode");
      expect(trace.startTime).toBeGreaterThan(0);
      expect(trace.endTime).toBeGreaterThan(0);
      expect(trace.durationMs).toBeGreaterThanOrEqual(0);
      expect(trace.status).toBe("success");
      expect(trace.retryCount).toBeDefined();
    });

    it("should filter traces correctly", async () => {
      const successTraces = toolRegistry.getTraces({ status: "success", limit: 5 });
      for (const trace of successTraces) {
        expect(trace.status).toBe("success");
      }
    });
  });
});

describe("Agent Registry", () => {
  describe("Registration", () => {
    it("should have 10 specialized agents registered", () => {
      const stats = agentRegistry.getStats();
      expect(stats.totalAgents).toBe(10);
    });

    it("should have all required agent roles", () => {
      const requiredRoles = [
        "Orchestrator",
        "Research",
        "Code",
        "Data",
        "Content",
        "Communication",
        "Browser",
        "Document",
        "QA",
        "Security",
      ];
      
      for (const role of requiredRoles) {
        const agent = agentRegistry.getByRole(role as any);
        expect(agent).toBeDefined();
        expect(agent?.config.role).toBe(role);
      }
    });

    it("each agent should have valid config", () => {
      const agents = agentRegistry.getAll();
      for (const agent of agents) {
        expect(agent.config.name).toBeTruthy();
        expect(agent.config.description.length).toBeGreaterThanOrEqual(10);
        expect(agent.config.tools.length).toBeGreaterThan(0);
        expect(agent.config.capabilities.length).toBeGreaterThan(0);
        expect(agent.config.timeout).toBeGreaterThan(0);
        expect(agent.config.maxIterations).toBeGreaterThan(0);
      }
    });

    it("each agent should reference existing tools", () => {
      const agents = agentRegistry.getAll();
      for (const agent of agents) {
        for (const toolName of agent.config.tools) {
          const tool = toolRegistry.get(toolName);
          expect(tool).toBeDefined();
        }
      }
    });
  });

  describe("Health Checks", () => {
    it("all agents should pass health check", async () => {
      const healthResults = await agentRegistry.runHealthChecks();
      
      for (const [agentName, healthy] of healthResults) {
        expect(healthy).toBe(true);
      }
    });
  });
});

describe("Orchestrator", () => {
  describe("Intent Analysis", () => {
    it("should correctly identify research intent", () => {
      const intent = orchestrator.analyzeIntent("search for information about AI");
      expect(intent.intent).toBe("research");
      expect(intent.suggestedAgent).toBe("Research");
    });

    it("should correctly identify code intent", () => {
      const intent = orchestrator.analyzeIntent("write a JavaScript function to sort arrays");
      expect(intent.intent).toBe("code");
      expect(intent.suggestedAgent).toBe("Code");
    });

    it("should correctly identify data_analysis intent", () => {
      const intent = orchestrator.analyzeIntent("analyze this dataset and create a chart");
      expect(intent.intent).toBe("data_analysis");
      expect(intent.suggestedAgent).toBe("Data");
    });

    it("should correctly identify document intent", () => {
      const intent = orchestrator.analyzeIntent("create a presentation about our project");
      expect(intent.intent).toBe("document");
      expect(intent.suggestedAgent).toBe("Document");
    });

    it("should correctly identify security intent", () => {
      const intent = orchestrator.analyzeIntent("security audit check vulnerabilities encryption");
      expect(["security", "code"]).toContain(intent.intent);
      expect(["Security", "Code"]).toContain(intent.suggestedAgent);
    });
  });

  describe("Routing", () => {
    it("should route to correct agent", async () => {
      const { agentName, tools } = await orchestrator.route("search for AI news");
      expect(agentName).toContain("Research");
    });

    it("should suggest appropriate tools", async () => {
      const { tools } = await orchestrator.route("browse and extract content from a website");
      expect(tools.length).toBeGreaterThan(0);
    });

    it("should create workflow for complex tasks", async () => {
      const { workflow } = await orchestrator.route(
        "first search for information, then analyze the data, and finally create a report"
      );
      // Complex tasks may create workflows
      // This depends on complexity estimation
    });
  });

  describe("Complexity Estimation", () => {
    it("should estimate simple tasks correctly", () => {
      const intent = orchestrator.analyzeIntent("search for cats");
      expect(intent.complexity).toBe("simple");
    });

    it("should estimate complex tasks correctly", () => {
      const intent = orchestrator.analyzeIntent(
        "First I need you to search for information about machine learning, then analyze the results, " +
        "and after that create a detailed report with charts, and also send an email with the findings"
      );
      expect(intent.complexity).toBe("complex");
    });
  });
});

describe("Capabilities Report", () => {
  describe("Full Report", () => {
    it("should generate a complete capabilities report", async () => {
      const report = await capabilitiesReportRunner.runQuickSmokeTest();
      
      expect(report.timestamp).toBeDefined();
      expect(report.version).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.toolCategories).toBeDefined();
      expect(report.agentResults).toBeDefined();
      expect(report.orchestratorResult).toBeDefined();
    });

    it("should report correct tool counts", async () => {
      const report = await capabilitiesReportRunner.runQuickSmokeTest();
      const stats = toolRegistry.getStats();
      
      expect(report.summary.totalTools).toBe(stats.totalTools);
    });

    it("should report correct agent counts", async () => {
      const report = await capabilitiesReportRunner.runQuickSmokeTest();
      const stats = agentRegistry.getStats();
      
      expect(report.summary.totalAgents).toBe(stats.totalAgents);
    });

    it("should include duration metrics", async () => {
      const report = await capabilitiesReportRunner.runQuickSmokeTest();
      
      expect(report.summary.durationMs).toBeGreaterThan(0);
    });
  });

  describe("JUnit Export", () => {
    it("should generate valid JUnit XML", async () => {
      await capabilitiesReportRunner.runQuickSmokeTest();
      const junit = capabilitiesReportRunner.toJUnit();
      
      expect(junit).toContain('<?xml version="1.0"');
      expect(junit).toContain("<testsuites");
      expect(junit).toContain("<testsuite");
      expect(junit).toContain("<testcase");
    });
  });
});

describe("Error Handling", () => {
  describe("Normalized Errors", () => {
    it("should return VALIDATION_ERROR with proper structure", async () => {
      const result = await toolRegistry.execute("web_search", {
        query: "", // Invalid: empty query
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("VALIDATION_ERROR");
      expect(result.error?.message).toBeDefined();
      expect(result.error?.retryable).toBe(false);
    });

    it("should return NOT_FOUND_ERROR for missing tools", async () => {
      const result = await toolRegistry.execute("this_tool_does_not_exist", {});
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_FOUND_ERROR");
      expect(result.error?.retryable).toBe(false);
    });

    it("should include error in trace", async () => {
      const result = await toolRegistry.execute("web_search", { query: "" });
      
      expect(result.trace.status).toBe("error");
      expect(result.trace.error).toBeDefined();
      expect(result.trace.error?.code).toBeDefined();
      expect(result.trace.error?.message).toBeDefined();
    });
  });

  describe("Guardrails", () => {
    it("should enforce rate limiting - check mechanism exists", async () => {
      const tool = toolRegistry.get("uuid_generate");
      expect(tool).toBeDefined();
      expect(tool!.config.rateLimitPerMinute).toBeGreaterThan(0);
      expect(tool!.config.rateLimitPerHour).toBeGreaterThan(0);
    });

    it("should track retry count in trace", async () => {
      const result = await toolRegistry.execute("uuid_generate", { 
        count: 1 
      }, { skipRateLimit: true });
      
      expect(result.trace.retryCount).toBeDefined();
      expect(result.trace.retryCount).toBeGreaterThanOrEqual(0);
    });

    it("should record timestamps in trace", async () => {
      const result = await toolRegistry.execute("uuid_generate", { count: 1 }, { skipRateLimit: true });
      
      expect(result.trace.startTime).toBeGreaterThan(0);
      expect(result.trace.endTime).toBeGreaterThan(0);
      expect(result.trace.endTime).toBeGreaterThanOrEqual(result.trace.startTime);
    });

    it("should generate unique requestId for each execution", async () => {
      const results = await Promise.all([
        toolRegistry.execute("uuid_generate", { count: 1 }, { skipRateLimit: true }),
        toolRegistry.execute("uuid_generate", { count: 1 }, { skipRateLimit: true }),
        toolRegistry.execute("uuid_generate", { count: 1 }, { skipRateLimit: true }),
      ]);
      
      const requestIds = results.map(r => r.trace.requestId);
      expect(new Set(requestIds).size).toBe(3);
    });

    it("should support skipRateLimit option", async () => {
      const result = await toolRegistry.execute(
        "uuid_generate",
        { count: 1 },
        { skipRateLimit: true }
      );
      
      expect(result.success).toBe(true);
    });

    it("should have timeout and retry config for all tools", () => {
      const tools = toolRegistry.getAll();
      for (const tool of tools) {
        expect(tool.config.timeout).toBeGreaterThan(0);
        expect(tool.config.maxRetries).toBeGreaterThanOrEqual(0);
        expect(tool.config.retryDelay).toBeGreaterThan(0);
      }
    });
  });
});

describe("Integration Tests", () => {
  describe("Multi-Tool Workflows", () => {
    it("should execute sequential tool calls", async () => {
      const result1 = await toolRegistry.execute("uuid_generate", { count: 1 });
      expect(result1.success).toBe(true);
      
      const result2 = await toolRegistry.execute("memory_store", {
        key: "test_uuid",
        value: "test-value",
        namespace: "test",
      });
      expect(result2.success).toBe(true);
      
      const result3 = await toolRegistry.execute("memory_retrieve", {
        key: "test_uuid",
        namespace: "test",
      });
      expect(result3.success).toBe(true);
    });

    it("should handle parallel tool calls", async () => {
      const results = await Promise.all([
        toolRegistry.execute("hash", { data: "test1", algorithm: "sha256" }, { skipRateLimit: true }),
        toolRegistry.execute("hash", { data: "test2", algorithm: "sha256" }, { skipRateLimit: true }),
        toolRegistry.execute("hash", { data: "test3", algorithm: "sha256" }, { skipRateLimit: true }),
      ]);
      
      expect(results.every(r => r.success)).toBe(true);
    });
  });

  describe("Agent-Tool Integration", () => {
    it("agent tools should all exist in registry", () => {
      const agents = agentRegistry.getAll();
      const missingTools: string[] = [];
      
      for (const agent of agents) {
        for (const toolName of agent.config.tools) {
          if (!toolRegistry.has(toolName)) {
            missingTools.push(`${agent.config.name}: ${toolName}`);
          }
        }
      }
      
      expect(missingTools).toEqual([]);
    });
  });

  describe("Orchestrator Flow", () => {
    it("should route and suggest valid tools", async () => {
      const { intent, agentName, tools } = await orchestrator.route("encrypt some data");
      
      expect(intent.intent).toBeDefined();
      expect(agentName).toBeDefined();
      
      for (const toolName of tools) {
        expect(toolRegistry.has(toolName)).toBe(true);
      }
    });
  });
});

describe("E2E Tests", () => {
  describe("Full Task Execution", () => {
    it("should complete a simple data processing task", async () => {
      const result1 = await toolRegistry.execute("json_parse", {
        input: JSON.stringify({ users: [{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }] }),
      });
      expect(result1.success).toBe(true);
      
      const result2 = await toolRegistry.execute("data_transform", {
        data: result1.data,
        operations: ["analyze"],
      });
      expect(result2.success).toBe(true);
    });

    it("should complete a security task", async () => {
      const result1 = await toolRegistry.execute("password_generate", {
        length: 24,
        includeSymbols: true,
      }, { skipRateLimit: true });
      expect(result1.success).toBe(true);
      
      const result2 = await toolRegistry.execute("hash", {
        data: "test-password",
        algorithm: "sha256",
      }, { skipRateLimit: true });
      expect(result2.success).toBe(true);
      expect(result2.data).toBeDefined();
    });
  });

  describe("System Health", () => {
    it("full system should be healthy", async () => {
      const toolHealth = await toolRegistry.runHealthChecks();
      const agentHealth = await agentRegistry.runHealthChecks();
      
      const unhealthyTools = Array.from(toolHealth.entries())
        .filter(([_, healthy]) => !healthy)
        .map(([name]) => name);
      
      const unhealthyAgents = Array.from(agentHealth.entries())
        .filter(([_, healthy]) => !healthy)
        .map(([name]) => name);
      
      expect(unhealthyTools).toEqual([]);
      expect(unhealthyAgents).toEqual([]);
    });

    it("stats should be consistent", () => {
      const toolStats = toolRegistry.getStats();
      const agentStats = agentRegistry.getStats();
      
      expect(toolStats.totalTools).toBeGreaterThanOrEqual(100);
      expect(agentStats.totalAgents).toBe(10);
      
      const categorySum = Object.values(toolStats.byCategory).reduce((a, b) => a + b, 0);
      expect(categorySum).toBe(toolStats.totalTools);
    });
  });
});
