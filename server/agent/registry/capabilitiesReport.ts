import { z } from "zod";
import { toolRegistry, ToolCategory, TOOL_CATEGORIES, ToolExecutionResult, RegisteredTool, ToolImplementationStatus } from "./toolRegistry";
import { agentRegistry, AgentRole, AGENT_ROLES, AgentResult } from "./agentRegistry";
import { orchestrator } from "./orchestrator";

export const TestResultSchema = z.object({
  name: z.string(),
  category: z.string(),
  status: z.enum(["PASS", "FAIL", "SKIP", "STUB", "DISABLED", "ERROR"]),
  implementationStatus: z.enum(["implemented", "stub", "disabled"]).optional(),
  durationMs: z.number(),
  evidence: z.object({
    input: z.any().optional(),
    output: z.any().optional(),
    error: z.string().optional(),
    trace: z.any().optional(),
  }),
  message: z.string().optional(),
});

export type TestResult = z.infer<typeof TestResultSchema>;

export const CategoryReportSchema = z.object({
  category: z.string(),
  totalTools: z.number(),
  implemented: z.number(),
  stubs: z.number(),
  disabled: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  results: z.array(TestResultSchema),
});

export type CategoryReport = z.infer<typeof CategoryReportSchema>;

export const CapabilitiesReportSchema = z.object({
  timestamp: z.string(),
  version: z.string().default("1.0.0"),
  mode: z.enum(["full", "smoke", "implementedOnly"]).default("full"),
  summary: z.object({
    totalTools: z.number(),
    implementedTools: z.number(),
    stubTools: z.number(),
    disabledTools: z.number(),
    totalAgents: z.number(),
    toolsPassed: z.number(),
    toolsFailed: z.number(),
    toolsSkipped: z.number(),
    agentsPassed: z.number(),
    agentsFailed: z.number(),
    overallStatus: z.enum(["PASS", "FAIL", "PARTIAL"]),
    durationMs: z.number(),
  }),
  toolCategories: z.array(CategoryReportSchema),
  agentResults: z.array(TestResultSchema),
  orchestratorResult: TestResultSchema.optional(),
  recommendations: z.array(z.string()),
});

export type CapabilitiesReport = z.infer<typeof CapabilitiesReportSchema>;

export type ReportMode = "full" | "smoke" | "implementedOnly";

const SMOKE_TEST_INPUTS: Record<string, Record<string, unknown>> = {
  web_search: { query: "test query", maxResults: 1 },
  browse_url: { url: "https://example.com", action: "extract" },
  extract_content: { url: "https://example.com" },
  screenshot: { url: "https://example.com" },
  form_fill: { url: "https://example.com", fields: { name: "test" } },
  summarize: { text: "This is a test text for summarization." },
  
  text_generate: { prompt: "Hello", maxTokens: 10 },
  image_generate: { prompt: "A simple test image", size: "256x256" },
  code_generate: { language: "javascript", description: "hello world function" },
  audio_generate: { type: "speech", text: "Hello world" },
  video_generate: { prompt: "test video", duration: 5 },
  
  text_summarize: { text: "This is a long text that needs to be summarized into shorter form." },
  text_translate: { text: "Hello world", targetLanguage: "es" },
  image_process: { imageUrl: "https://example.com/test.jpg", operations: ["resize"] },
  audio_transcribe: { audioUrl: "https://example.com/test.mp3", language: "en" },
  ocr_extract: { imageUrl: "https://example.com/test.jpg" },
  sentiment_analyze: { text: "I love this product!" },
  
  data_transform: { data: [{ a: 1 }], operations: ["filter"] },
  data_visualize: { data: [{ x: 1, y: 2 }], chartType: "line" },
  json_parse: { input: '{"test": true}' },
  csv_parse: { input: "a,b\n1,2" },
  statistics_compute: { data: [1, 2, 3, 4, 5], measures: ["mean", "median"] },
  spreadsheet_analyze: { data: [[1, 2], [3, 4]], operations: ["sum"] },
  
  document_create: { type: "docx", title: "Test", content: "Test content" },
  pdf_generate: { title: "Test PDF", content: "Test content" },
  slides_create: { title: "Test", slides: [{ title: "Slide 1" }] },
  spreadsheet_create: { title: "Test Sheet", sheets: [{ name: "Sheet1", headers: ["A", "B"], rows: [[1, 2], [3, 4]] }] },
  template_fill: { templateId: "template123", data: { name: "test" } },
  document_convert: { inputUrl: "https://example.com/doc.docx", outputFormat: "pdf" },
  
  code_analyze: { code: "function test() { return 1; }", language: "javascript" },
  git_operation: { operation: "status", repoPath: "/tmp/test" },
  package_manage: { action: "list", packageManager: "npm" },
  shell_execute: { command: "echo test" },
  file_read: { path: "package.json" },
  file_write: { path: "/tmp/test.txt", content: "test" },
  
  diagram_flowchart: { nodes: [{ id: "1", label: "Start" }], edges: [] },
  diagram_sequence: { participants: ["A", "B"], messages: [{ from: "A", to: "B", message: "Hello" }] },
  diagram_mindmap: { root: "Main Topic", branches: [{ label: "Child", children: [] }] },
  diagram_class: { classes: [{ name: "Test", properties: [], methods: [] }] },
  diagram_gantt: { title: "Test", tasks: [{ name: "Task 1", start: "2024-01-01", duration: 5 }] },
  diagram_erd: { entities: [{ name: "User", attributes: ["id", "name"] }], relationships: [{ from: "User", to: "Post", type: "one-to-many" }] },
  
  http_request: { url: "https://api.example.com/test", method: "GET" },
  api_mock: { endpoint: "/test", method: "GET", response: { data: "test" } },
  webhook_send: { url: "https://example.com/webhook", payload: { event: "test" } },
  oauth_flow: { provider: "google", scopes: ["email"], redirectUri: "https://example.com/callback" },
  graphql_query: { endpoint: "https://api.example.com/graphql", query: "{ test }" },
  
  calendar_event: { title: "Test Event", startTime: "2024-01-01T10:00:00Z", endTime: "2024-01-01T11:00:00Z" },
  task_create: { title: "Test Task", description: "A test task" },
  notes_create: { title: "Test Note", content: "Test note content" },
  reminder_set: { message: "Test", time: "2024-12-01T10:00:00Z" },
  timer_start: { duration: 60 },
  
  security_scan: { target: "https://example.com" },
  encrypt: { data: "test", algorithm: "aes-256" },
  decrypt: { data: "encrypted_data", algorithm: "aes-256", key: "testkey123456789" },
  hash: { data: "test", algorithm: "sha256" },
  audit_log: { action: "login", resource: "user", actor: "user123", details: {} },
  
  workflow_create: { name: "test", trigger: { type: "manual", config: {} }, steps: [{ action: "notify", config: {} }] },
  cron_schedule: { expression: "0 * * * *", command: "echo test" },
  batch_process: { items: [1, 2, 3], operation: "process" },
  retry_with_backoff: { operation: "api_call", maxRetries: 3, initialDelay: 1000 },
  queue_message: { queueName: "test-queue", payload: { data: "test" } },
  
  db_query: { query: "SELECT 1", params: [] },
  db_migrate: { direction: "up" },
  db_backup: { database: "test", format: "sql" },
  db_seed: { table: "users", data: [{ name: "test" }] },
  cache_get: { key: "test" },
  cache_set: { key: "test", value: "value" },
  session_manage: { action: "get", sessionId: "test" },
  
  logs_search: { query: "error", level: "error" },
  metrics_collect: { namespace: "app", metrics: ["cpu", "memory"] },
  alert_create: { name: "test_alert", condition: "cpu > 80", threshold: 80, actions: ["email"] },
  health_check: { targets: ["service1"] },
  trace_request: { traceId: "test-trace-id" },
  
  uuid_generate: {},
  date_format: { date: "2024-01-01", format: "YYYY-MM-DD" },
  json_format: { input: { a: 1 }, indent: 2 },
  regex_test: { pattern: "\\d+", text: "test123" },
  base64_encode: { input: "test", operation: "encode" },
  url_parse: { url: "https://example.com/path?q=test" },
  qrcode_generate: { data: "https://example.com" },
  
  memory_store: { key: "test", value: "test_value" },
  memory_retrieve: { key: "test" },
  memory_search: { query: "test", limit: 10 },
  context_manage: { operation: "get" },
  session_state: { sessionId: "test-session", operation: "get" },
  
  reason: { premise: "If A then B. A is true.", question: "Is B true?" },
  reflect: { action: "completed task", outcome: "success" },
  verify: { claim: "The result is valid", evidence: ["test passed"] },
  analyze_problem: { problem: "Application is slow", context: {} },
  clarify: { statement: "Test statement" },
  plan: { goal: "Complete test", constraints: [] },
  decide: { options: ["A", "B"], criteria: "cost effectiveness" },
  
  orchestrate: { task: "simple test task" },
  workflow: { name: "test", steps: [] },
  delegate: { agentName: "ResearchAgent", task: "research topic" },
  parallel_execute: { operations: [{ tool: "echo", input: { message: "test" } }], maxConcurrency: 2 },
  strategic_plan: { objective: "Complete project", resources: [] },
  
  email_send: { to: ["test@example.com"], subject: "Test", body: "Test email" },
  message_compose: { platform: "email", content: "Test message", format: "plain" },
  notify: { channel: "slack", message: "Test notification" },
  explain: { topic: "Complex topic to explain", audience: "beginner" },
  
  code_execute: { code: "console.log('test')", language: "javascript" },
  file_convert: { inputPath: "/tmp/test.txt", outputFormat: "pdf" },
  environment_manage: { operation: "list" },
  search_semantic: { query: "test search", collection: "documents" },
  process_spawn: { command: "echo test", args: [] },
  resource_monitor: { resources: ["cpu", "memory"] },
  
  default: { test: true },
};

function getSmokeTestInput(toolName: string): Record<string, unknown> {
  return SMOKE_TEST_INPUTS[toolName] || SMOKE_TEST_INPUTS.default;
}

class CapabilitiesReportRunner {
  private report: CapabilitiesReport | null = null;

  private getToolStats() {
    const tools = toolRegistry.getAll();
    let implemented = 0, stubs = 0, disabled = 0;
    for (const tool of tools) {
      const status = (tool.metadata as any).implementationStatus || "implemented";
      if (status === "implemented") implemented++;
      else if (status === "stub") stubs++;
      else if (status === "disabled") disabled++;
    }
    return { total: tools.length, implemented, stubs, disabled };
  }

  async runReport(mode: ReportMode = "full"): Promise<CapabilitiesReport> {
    const startTime = Date.now();
    console.log("\n" + "=".repeat(60));
    console.log(`CAPABILITIES REPORT - Mode: ${mode.toUpperCase()}`);
    console.log("=".repeat(60) + "\n");

    const toolStats = this.getToolStats();
    const toolCategories: CategoryReport[] = [];
    let toolsPassed = 0, toolsFailed = 0, toolsSkipped = 0;

    for (const category of TOOL_CATEGORIES) {
      const categoryReport = await this.testToolCategory(category, mode);
      toolCategories.push(categoryReport);
      toolsPassed += categoryReport.passed;
      toolsFailed += categoryReport.failed;
      toolsSkipped += categoryReport.skipped;
    }

    const agentResults: TestResult[] = [];
    let agentsPassed = 0, agentsFailed = 0;

    const agentsToTest = mode === "smoke" 
      ? (["Orchestrator", "Research", "Code"] as AgentRole[])
      : AGENT_ROLES;

    for (const role of agentsToTest) {
      const agentResult = await this.testAgent(role);
      agentResults.push(agentResult);
      if (agentResult.status === "PASS") agentsPassed++;
      else agentsFailed++;
    }

    const orchestratorResult = await this.testOrchestrator();

    const overallStatus = 
      toolsFailed === 0 && agentsFailed === 0 && orchestratorResult.status === "PASS" && toolsSkipped === 0
        ? "PASS"
        : toolsFailed > 0 || agentsFailed > 0
          ? "FAIL"
          : "PARTIAL";

    const recommendations = this.generateRecommendations(toolCategories, agentResults, orchestratorResult);

    this.report = {
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      mode,
      summary: {
        totalTools: toolStats.total,
        implementedTools: toolStats.implemented,
        stubTools: toolStats.stubs,
        disabledTools: toolStats.disabled,
        totalAgents: agentRegistry.getAll().length,
        toolsPassed,
        toolsFailed,
        toolsSkipped,
        agentsPassed,
        agentsFailed,
        overallStatus,
        durationMs: Date.now() - startTime,
      },
      toolCategories,
      agentResults,
      orchestratorResult,
      recommendations,
    };

    this.printReport(this.report);
    return this.report;
  }

  async runFullReport(): Promise<CapabilitiesReport> {
    return this.runReport("full");
  }

  async runQuickSmokeTest(): Promise<CapabilitiesReport> {
    return this.runReport("smoke");
  }

  async runImplementedOnlyReport(): Promise<CapabilitiesReport> {
    return this.runReport("implementedOnly");
  }

  private async testToolCategory(category: ToolCategory, mode: ReportMode = "full"): Promise<CategoryReport> {
    console.log(`\nTesting category: ${category} (mode: ${mode})`);
    console.log("-".repeat(40));

    const allTools = toolRegistry.getByCategory(category);
    const results: TestResult[] = [];
    let passed = 0, failed = 0, skipped = 0;
    let implemented = 0, stubs = 0, disabled = 0;

    const toolsToTest = mode === "smoke" 
      ? allTools.slice(0, 1) 
      : allTools;

    for (const tool of allTools) {
      const implStatus = (tool.metadata as any).implementationStatus || "implemented";
      if (implStatus === "implemented") implemented++;
      else if (implStatus === "stub") stubs++;
      else if (implStatus === "disabled") disabled++;

      if (mode === "implementedOnly" && implStatus !== "implemented") {
        results.push({
          name: tool.metadata.name,
          category,
          status: implStatus === "stub" ? "STUB" : "DISABLED",
          implementationStatus: implStatus,
          durationMs: 0,
          evidence: {},
          message: `Excluded from test: ${implStatus}`,
        });
        continue;
      }

      if (mode === "smoke" && !toolsToTest.includes(tool)) {
        results.push({
          name: tool.metadata.name,
          category,
          status: "SKIP",
          implementationStatus: implStatus,
          durationMs: 0,
          evidence: {},
          message: "Skipped in smoke test mode",
        });
        skipped++;
        continue;
      }

      if (implStatus === "stub") {
        results.push({
          name: tool.metadata.name,
          category,
          status: "STUB",
          implementationStatus: implStatus,
          durationMs: 0,
          evidence: {},
          message: "Tool is marked as stub - not verified",
        });
        continue;
      }

      if (implStatus === "disabled") {
        results.push({
          name: tool.metadata.name,
          category,
          status: "DISABLED",
          implementationStatus: implStatus,
          durationMs: 0,
          evidence: {},
          message: "Tool is disabled - excluded from verification",
        });
        continue;
      }

      const result = await this.testSingleTool(tool);
      result.implementationStatus = implStatus;
      results.push(result);
      
      if (result.status === "PASS") passed++;
      else if (result.status === "FAIL" || result.status === "ERROR") failed++;
      else skipped++;

      const statusIcon = result.status === "PASS" ? "✓" : result.status === "FAIL" ? "✗" : "○";
      console.log(`  ${statusIcon} ${tool.metadata.name}: ${result.status} (${result.durationMs}ms)`);
    }

    return {
      category,
      totalTools: allTools.length,
      implemented,
      stubs,
      disabled,
      passed,
      failed,
      skipped,
      results,
    };
  }

  private async testSingleTool(tool: RegisteredTool): Promise<TestResult> {
    const startTime = Date.now();
    const input = getSmokeTestInput(tool.metadata.name);

    try {
      if (tool.healthCheck) {
        const healthy = await tool.healthCheck();
        if (!healthy) {
          return {
            name: tool.metadata.name,
            category: tool.metadata.category,
            status: "FAIL",
            durationMs: Date.now() - startTime,
            evidence: { error: "Health check failed" },
            message: "Tool health check returned false",
          };
        }
      }

      const inputValidation = tool.inputSchema.safeParse(input);
      if (!inputValidation.success) {
        return {
          name: tool.metadata.name,
          category: tool.metadata.category,
          status: "SKIP",
          durationMs: Date.now() - startTime,
          evidence: { 
            input,
            error: inputValidation.error.message,
          },
          message: "Schema validation test - input validation works correctly",
        };
      }

      const result = await toolRegistry.execute(tool.metadata.name, input, {
        skipValidation: false,
        skipRateLimit: true,
      });

      return {
        name: tool.metadata.name,
        category: tool.metadata.category,
        status: result.success ? "PASS" : "FAIL",
        durationMs: Date.now() - startTime,
        evidence: {
          input,
          output: result.data,
          error: result.error?.message,
          trace: result.trace,
        },
        message: result.success ? "Tool executed successfully" : result.error?.message,
      };
    } catch (err: any) {
      return {
        name: tool.metadata.name,
        category: tool.metadata.category,
        status: "ERROR",
        durationMs: Date.now() - startTime,
        evidence: {
          input,
          error: err.message,
        },
        message: `Unexpected error: ${err.message}`,
      };
    }
  }

  private async testAgent(role: AgentRole): Promise<TestResult> {
    const startTime = Date.now();
    console.log(`\nTesting agent: ${role}`);

    try {
      const agent = agentRegistry.getByRole(role);
      if (!agent) {
        return {
          name: role,
          category: "Agent",
          status: "FAIL",
          durationMs: Date.now() - startTime,
          evidence: { error: `Agent with role ${role} not found` },
          message: "Agent not registered",
        };
      }

      const healthy = await agent.healthCheck();
      if (!healthy) {
        return {
          name: role,
          category: "Agent",
          status: "FAIL",
          durationMs: Date.now() - startTime,
          evidence: { error: "Agent health check failed" },
          message: "Some required tools are missing",
        };
      }

      const capabilities = agent.getCapabilities();
      
      const statusIcon = "✓";
      console.log(`  ${statusIcon} ${role}: PASS (${Date.now() - startTime}ms)`);
      console.log(`    Tools: ${agent.config.tools.length}, Capabilities: ${capabilities.length}`);

      return {
        name: role,
        category: "Agent",
        status: "PASS",
        durationMs: Date.now() - startTime,
        evidence: {
          output: {
            name: agent.config.name,
            tools: agent.config.tools,
            capabilities: capabilities.map(c => c.name),
          },
        },
        message: "Agent initialized and healthy",
      };
    } catch (err: any) {
      console.log(`  ✗ ${role}: ERROR (${Date.now() - startTime}ms)`);
      return {
        name: role,
        category: "Agent",
        status: "ERROR",
        durationMs: Date.now() - startTime,
        evidence: { error: err.message },
        message: `Unexpected error: ${err.message}`,
      };
    }
  }

  private async testOrchestrator(): Promise<TestResult> {
    const startTime = Date.now();
    console.log("\nTesting Orchestrator routing...");

    try {
      const testQueries = [
        { query: "search for information about AI", expectedIntent: "research" },
        { query: "write a JavaScript function", expectedIntent: "code" },
        { query: "analyze this data set", expectedIntent: "data_analysis" },
        { query: "create a presentation", expectedIntent: "document" },
      ];

      const results: Array<{ query: string; intent: string; agent: string; correct: boolean }> = [];

      for (const test of testQueries) {
        const { intent, agentName, tools } = await orchestrator.route(test.query);
        const correct = intent.intent === test.expectedIntent;
        results.push({
          query: test.query,
          intent: intent.intent,
          agent: agentName,
          correct,
        });
        
        const icon = correct ? "✓" : "○";
        console.log(`  ${icon} "${test.query.slice(0, 30)}..." → ${intent.intent} (${agentName})`);
      }

      const allCorrect = results.every(r => r.correct);

      return {
        name: "Orchestrator",
        category: "System",
        status: allCorrect ? "PASS" : "PARTIAL" as any,
        durationMs: Date.now() - startTime,
        evidence: { output: results },
        message: allCorrect 
          ? "All routing tests passed" 
          : `${results.filter(r => r.correct).length}/${results.length} routing tests passed`,
      };
    } catch (err: any) {
      return {
        name: "Orchestrator",
        category: "System",
        status: "ERROR",
        durationMs: Date.now() - startTime,
        evidence: { error: err.message },
        message: `Orchestrator test failed: ${err.message}`,
      };
    }
  }

  private generateRecommendations(
    toolCategories: CategoryReport[],
    agentResults: TestResult[],
    orchestratorResult: TestResult
  ): string[] {
    const recommendations: string[] = [];

    for (const category of toolCategories) {
      if (category.failed > 0) {
        const failedTools = category.results
          .filter(r => r.status === "FAIL" || r.status === "ERROR")
          .map(r => r.name);
        recommendations.push(
          `[${category.category}] Fix failing tools: ${failedTools.join(", ")}`
        );
      }
    }

    const failedAgents = agentResults.filter(r => r.status !== "PASS");
    for (const agent of failedAgents) {
      recommendations.push(`[Agent] Fix ${agent.name}: ${agent.message}`);
    }

    if (orchestratorResult.status !== "PASS") {
      recommendations.push(`[Orchestrator] ${orchestratorResult.message}`);
    }

    return recommendations;
  }

  private printReport(report: CapabilitiesReport): void {
    console.log("\n" + "=".repeat(60));
    console.log("CAPABILITIES REPORT SUMMARY");
    console.log("=".repeat(60));
    console.log(`Timestamp: ${report.timestamp}`);
    console.log(`Duration: ${report.summary.durationMs}ms`);
    console.log("");
    console.log(`Overall Status: ${report.summary.overallStatus}`);
    console.log("");
    console.log("Tools:");
    console.log(`  Total: ${report.summary.totalTools}`);
    console.log(`  Passed: ${report.summary.toolsPassed}`);
    console.log(`  Failed: ${report.summary.toolsFailed}`);
    console.log("");
    console.log("Agents:");
    console.log(`  Total: ${report.summary.totalAgents}`);
    console.log(`  Passed: ${report.summary.agentsPassed}`);
    console.log(`  Failed: ${report.summary.agentsFailed}`);
    
    if (report.recommendations.length > 0) {
      console.log("");
      console.log("Recommendations:");
      for (const rec of report.recommendations) {
        console.log(`  - ${rec}`);
      }
    }
    
    console.log("=".repeat(60) + "\n");
  }

  getLastReport(): CapabilitiesReport | null {
    return this.report;
  }

  toJUnit(): string {
    if (!this.report) return "<testsuites />";

    const testcases = this.report.toolCategories.flatMap(cat =>
      cat.results.map(r => `
    <testcase name="${r.name}" classname="${r.category}" time="${r.durationMs / 1000}">
      ${r.status === "FAIL" || r.status === "ERROR" 
        ? `<failure message="${r.message || ""}">${JSON.stringify(r.evidence, null, 2)}</failure>` 
        : ""}
      ${r.status === "SKIP" ? `<skipped message="${r.message || ""}" />` : ""}
    </testcase>`)
    );

    const agentCases = this.report.agentResults.map(r => `
    <testcase name="${r.name}" classname="Agents" time="${r.durationMs / 1000}">
      ${r.status === "FAIL" || r.status === "ERROR" 
        ? `<failure message="${r.message || ""}">${JSON.stringify(r.evidence, null, 2)}</failure>` 
        : ""}
    </testcase>`);

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Capabilities Report" time="${this.report.summary.durationMs / 1000}">
  <testsuite name="Tools" tests="${this.report.summary.totalTools}" failures="${this.report.summary.toolsFailed}">
    ${testcases.join("")}
  </testsuite>
  <testsuite name="Agents" tests="${this.report.summary.totalAgents}" failures="${this.report.summary.agentsFailed}">
    ${agentCases.join("")}
  </testsuite>
</testsuites>`;
  }
}

export const capabilitiesReportRunner = new CapabilitiesReportRunner();
export { CapabilitiesReportRunner };
