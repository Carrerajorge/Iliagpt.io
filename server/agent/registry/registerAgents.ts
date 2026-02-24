import { z } from "zod";
import crypto from "crypto";
import { agentRegistry, createAgent, AgentConfig, AgentTask, AgentResult, AgentCapability } from "./agentRegistry";
import { toolRegistry } from "./toolRegistry";

export function registerAllAgents(): void {
  console.log("[AgentRegistry] Registering all specialized agents...");

  registerOrchestratorAgent();
  registerResearchAgent();
  registerCodeAgent();
  registerDataAgent();
  registerContentAgent();
  registerCommunicationAgent();
  registerBrowserAgent();
  registerDocumentAgent();
  registerQAAgent();
  registerSecurityAgent();

  const stats = agentRegistry.getStats();
  console.log(`[AgentRegistry] Registered ${stats.totalAgents} agents`);
}

function registerOrchestratorAgent(): void {
  const config: AgentConfig = {
    name: "OrchestratorAgent",
    description: "Master orchestrator that coordinates all other agents, plans complex multi-step tasks, and manages workflow execution",
    role: "Orchestrator",
    model: "grok-4-1-fast-non-reasoning",
    temperature: 0.3,
    maxTokens: 8192,
    systemPrompt: `You are the Orchestrator Agent. Your role is to:
1. Analyze incoming tasks and break them into subtasks
2. Delegate subtasks to appropriate specialized agents
3. Coordinate execution flow and handle dependencies
4. Aggregate results and handle failures gracefully
5. Replan when necessary based on intermediate results`,
    tools: ["orchestrate", "workflow", "delegate", "parallel_execute", "strategic_plan", "reason", "plan"],
    capabilities: [
      {
        name: "task_orchestration",
        description: "Orchestrate multi-agent workflows",
        tools: ["orchestrate", "delegate", "parallel_execute"],
        inputSchema: z.object({ task: z.string() }),
        outputSchema: z.object({ results: z.array(z.any()) }),
      },
      {
        name: "strategic_planning",
        description: "Create strategic execution plans",
        tools: ["strategic_plan", "plan"],
        inputSchema: z.object({ objective: z.string() }),
        outputSchema: z.object({ plan: z.any() }),
      },
    ],
    timeout: 180000,
    maxIterations: 20,
    priority: 10,
  };

  const agent = createAgent(config, async (task, tools) => {
    const startTime = Date.now();

    try {
      const planResult = await tools.execute("plan", { goal: task.description });

      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: true,
        output: { plan: planResult.data, status: "orchestration_complete" },
        duration: Date.now() - startTime,
        reasoning: "Task analyzed and orchestration plan created",
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: false,
        error: err.message,
        duration: Date.now() - startTime,
      };
    }
  });

  agentRegistry.register(agent);
}

function registerResearchAgent(): void {
  const config: AgentConfig = {
    name: "ResearchAssistantAgent",
    description: "Specializes in web research, information gathering, fact-checking, and knowledge synthesis",
    role: "Research",
    model: "grok-4-1-fast-non-reasoning",
    temperature: 0.5,
    maxTokens: 8192,
    systemPrompt: `You are the Research Assistant Agent. Your role is to:
1. Search and gather information from multiple sources
2. Verify facts and cross-reference information
3. Synthesize findings into coherent summaries
4. Identify knowledge gaps and suggest follow-up research
5. Create research reports and summaries`,
    tools: ["web_search", "browse_url", "extract_content", "text_summarize", "verify", "memory_store", "memory_retrieve", "document_create"],
    capabilities: [
      {
        name: "web_research",
        description: "Conduct comprehensive web research",
        tools: ["web_search", "browse_url", "extract_content"],
        inputSchema: z.object({ query: z.string() }),
        outputSchema: z.object({ findings: z.array(z.any()) }),
      },
      {
        name: "fact_verification",
        description: "Verify claims against multiple sources",
        tools: ["verify", "web_search"],
        inputSchema: z.object({ claim: z.string() }),
        outputSchema: z.object({ verified: z.boolean(), confidence: z.number() }),
      },
    ],
    timeout: 120000,
    maxIterations: 15,
    priority: 8,
  };

  const agent = createAgent(config, async (task, tools) => {
    const startTime = Date.now();

    try {
      const searchResult = await tools.execute("web_search", {
        query: task.description,
        maxResults: 5
      });

      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: true,
        output: { research: searchResult.data },
        duration: Date.now() - startTime,
        reasoning: "Research completed successfully",
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: false,
        error: err.message,
        duration: Date.now() - startTime,
      };
    }
  });

  agentRegistry.register(agent);
}

function registerCodeAgent(): void {
  const config: AgentConfig = {
    name: "CodeAgent",
    description: "Specializes in code generation, analysis, debugging, and software development tasks",
    role: "Code",
    model: "grok-4-1-fast-non-reasoning",
    temperature: 0.2,
    maxTokens: 16384,
    systemPrompt: `You are the Code Agent. Your role is to:
1. Generate high-quality code in multiple languages
2. Analyze code for bugs, security issues, and improvements
3. Debug and fix code issues
4. Refactor and optimize existing code
5. Write tests and documentation`,
    tools: ["code_generate", "code_analyze", "shell_execute", "file_read", "file_write", "git_operation", "package_manage"],
    capabilities: [
      {
        name: "code_generation",
        description: "Generate code from specifications",
        tools: ["code_generate", "file_write"],
        inputSchema: z.object({ language: z.string(), description: z.string() }),
        outputSchema: z.object({ code: z.string() }),
      },
      {
        name: "code_analysis",
        description: "Analyze code for issues",
        tools: ["code_analyze", "file_read"],
        inputSchema: z.object({ code: z.string() }),
        outputSchema: z.object({ issues: z.array(z.any()) }),
      },
    ],
    timeout: 120000,
    maxIterations: 15,
    priority: 9,
  };

  const agent = createAgent(config, async (task, tools) => {
    const startTime = Date.now();

    try {
      const codeResult = await tools.execute("code_generate", {
        language: task.input.language || "javascript",
        description: task.description,
      });

      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: true,
        output: { code: codeResult.data },
        duration: Date.now() - startTime,
        reasoning: "Code generated successfully",
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: false,
        error: err.message,
        duration: Date.now() - startTime,
      };
    }
  });

  agentRegistry.register(agent);
}

function registerDataAgent(): void {
  const config: AgentConfig = {
    name: "DataAnalystAgent",
    description: "Specializes in data processing, analysis, visualization, and database operations",
    role: "Data",
    model: "grok-4-1-fast-non-reasoning",
    temperature: 0.3,
    maxTokens: 8192,
    systemPrompt: `You are the Data Analyst Agent. Your role is to:
1. Transform and clean data
2. Perform statistical analysis
3. Create visualizations and charts
4. Query and manage databases
5. Process various data formats (JSON, CSV, Excel)
6. Generate spreadsheets and reports`,
    tools: ["data_transform", "data_visualize", "json_parse", "csv_parse", "statistics_compute", "spreadsheet_analyze", "spreadsheet_create", "db_query", "db_schema"],
    capabilities: [
      {
        name: "data_analysis",
        description: "Analyze and process data",
        tools: ["data_transform", "statistics_compute"],
        inputSchema: z.object({ data: z.any() }),
        outputSchema: z.object({ analysis: z.any() }),
      },
      {
        name: "data_visualization",
        description: "Create charts and visualizations",
        tools: ["data_visualize"],
        inputSchema: z.object({ data: z.array(z.any()), chartType: z.string() }),
        outputSchema: z.object({ chartUrl: z.string() }),
      },
    ],
    timeout: 90000,
    maxIterations: 10,
    priority: 7,
  };

  const agent = createAgent(config, async (task, tools) => {
    const startTime = Date.now();

    try {
      const transformResult = await tools.execute("data_transform", {
        data: task.input.data || [],
        operations: ["analyze"],
      });

      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: true,
        output: { analysis: transformResult.data },
        duration: Date.now() - startTime,
        reasoning: "Data analysis completed",
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: false,
        error: err.message,
        duration: Date.now() - startTime,
      };
    }
  });

  agentRegistry.register(agent);
}

function registerContentAgent(): void {
  const config: AgentConfig = {
    name: "ContentAgent",
    description: "Specializes in content creation, writing, translation, and media generation",
    role: "Content",
    model: "grok-4-1-fast-non-reasoning",
    temperature: 0.7,
    maxTokens: 8192,
    systemPrompt: `You are the Content Agent. Your role is to:
1. Generate high-quality written content
2. Create images and visual content
3. Translate content between languages
4. Summarize and rewrite content
5. Maintain consistent tone and style`,
    tools: ["text_generate", "image_generate", "text_translate", "text_summarize", "summarize", "audio_generate"],
    capabilities: [
      {
        name: "content_creation",
        description: "Create written content",
        tools: ["text_generate"],
        inputSchema: z.object({ prompt: z.string(), style: z.string().optional() }),
        outputSchema: z.object({ content: z.string() }),
      },
      {
        name: "translation",
        description: "Translate content",
        tools: ["text_translate"],
        inputSchema: z.object({ text: z.string(), targetLanguage: z.string() }),
        outputSchema: z.object({ translated: z.string() }),
      },
    ],
    timeout: 90000,
    maxIterations: 10,
    priority: 6,
  };

  const agent = createAgent(config, async (task, tools) => {
    const startTime = Date.now();

    try {
      const contentResult = await tools.execute("text_generate", {
        prompt: task.description,
        maxTokens: 1024,
      });

      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: true,
        output: { content: contentResult.data },
        duration: Date.now() - startTime,
        reasoning: "Content generated successfully",
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: false,
        error: err.message,
        duration: Date.now() - startTime,
      };
    }
  });

  agentRegistry.register(agent);
}

function registerCommunicationAgent(): void {
  const config: AgentConfig = {
    name: "CommunicationAgent",
    description: "Specializes in email, messaging, notifications, and inter-agent communication",
    role: "Communication",
    model: "grok-4-1-fast-non-reasoning",
    temperature: 0.5,
    maxTokens: 4096,
    systemPrompt: `You are the Communication Agent. Your role is to:
1. Compose and send emails and messages
2. Handle notifications across platforms
3. Facilitate clear communication
4. Clarify ambiguous requests
5. Make decisions when asked`,
    tools: ["email_send", "message_compose", "notify", "decide", "clarify", "summarize"],
    capabilities: [
      {
        name: "email_management",
        description: "Handle email communications",
        tools: ["email_send", "message_compose"],
        inputSchema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
        outputSchema: z.object({ sent: z.boolean() }),
      },
      {
        name: "decision_support",
        description: "Help with decision making",
        tools: ["decide", "clarify"],
        inputSchema: z.object({ options: z.array(z.string()), criteria: z.string() }),
        outputSchema: z.object({ recommendation: z.string() }),
      },
    ],
    timeout: 60000,
    maxIterations: 8,
    priority: 5,
  };

  const agent = createAgent(config, async (task, tools) => {
    const startTime = Date.now();

    try {
      const messageResult = await tools.execute("message_compose", {
        platform: "generic",
        content: task.description,
        format: "plain",
      });

      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: true,
        output: { message: messageResult.data },
        duration: Date.now() - startTime,
        reasoning: "Communication task completed",
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: false,
        error: err.message,
        duration: Date.now() - startTime,
      };
    }
  });

  agentRegistry.register(agent);
}

function registerBrowserAgent(): void {
  const config: AgentConfig = {
    name: "BrowserAgent",
    description: "Specializes in web browsing, navigation, scraping, and web automation",
    role: "Browser",
    model: "grok-4-1-fast-non-reasoning",
    temperature: 0.3,
    maxTokens: 8192,
    systemPrompt: `You are the Browser Agent. Your role is to:
1. Navigate and interact with web pages
2. Extract content from websites
3. Take screenshots and capture page state
4. Fill forms and automate web interactions
5. Handle authentication flows`,
    tools: ["browse_url", "screenshot", "form_fill", "extract_content", "web_search"],
    capabilities: [
      {
        name: "web_navigation",
        description: "Navigate and interact with web pages",
        tools: ["browse_url", "form_fill"],
        inputSchema: z.object({ url: z.string() }),
        outputSchema: z.object({ content: z.string() }),
      },
      {
        name: "content_extraction",
        description: "Extract structured data from pages",
        tools: ["extract_content", "screenshot"],
        inputSchema: z.object({ url: z.string(), selectors: z.record(z.string()).optional() }),
        outputSchema: z.object({ data: z.any() }),
      },
    ],
    timeout: 120000,
    maxIterations: 12,
    priority: 6,
  };

  const agent = createAgent(config, async (task, tools) => {
    const startTime = Date.now();

    try {
      const browseResult = await tools.execute("browse_url", {
        url: task.input.url || "https://example.com",
        action: "extract",
      });

      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: true,
        output: { pageContent: browseResult.data },
        duration: Date.now() - startTime,
        reasoning: "Page browsed and content extracted",
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: false,
        error: err.message,
        duration: Date.now() - startTime,
      };
    }
  });

  agentRegistry.register(agent);
}

function registerDocumentAgent(): void {
  const config: AgentConfig = {
    name: "DocumentAgent",
    description: "Specializes in document creation, conversion, and management (PDFs, Word, Excel, PowerPoint)",
    role: "Document",
    model: "grok-4-1-fast-non-reasoning",
    temperature: 0.4,
    maxTokens: 8192,
    systemPrompt: `You are the Document Agent. Your role is to:
1. Create professional documents (Word, PDF, Excel, PowerPoint)
2. Convert documents between formats
3. Fill document templates with data
4. Extract text from documents
5. Manage document workflows`,
    tools: ["document_create", "pdf_generate", "slides_create", "spreadsheet_create", "template_fill", "document_convert", "ocr_extract"],
    capabilities: [
      {
        name: "document_creation",
        description: "Create various document types",
        tools: ["document_create", "pdf_generate", "slides_create"],
        inputSchema: z.object({ type: z.string(), title: z.string(), content: z.string() }),
        outputSchema: z.object({ fileUrl: z.string() }),
      },
      {
        name: "document_conversion",
        description: "Convert between document formats",
        tools: ["document_convert"],
        inputSchema: z.object({ inputUrl: z.string(), outputFormat: z.string() }),
        outputSchema: z.object({ convertedUrl: z.string() }),
      },
    ],
    timeout: 90000,
    maxIterations: 10,
    priority: 6,
  };

  const agent = createAgent(config, async (task, tools) => {
    const startTime = Date.now();

    try {
      const docResult = await tools.execute("document_create", {
        type: task.input.type || "docx",
        title: task.input.title || "Document",
        content: task.description,
      });

      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: true,
        output: { document: docResult.data },
        duration: Date.now() - startTime,
        reasoning: "Document created successfully",
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: false,
        error: err.message,
        duration: Date.now() - startTime,
      };
    }
  });

  agentRegistry.register(agent);
}

function registerQAAgent(): void {
  const config: AgentConfig = {
    name: "QAAgent",
    description: "Specializes in testing, quality assurance, validation, and verification tasks",
    role: "QA",
    model: "grok-4-1-fast-non-reasoning",
    temperature: 0.2,
    maxTokens: 8192,
    systemPrompt: `You are the QA Agent. Your role is to:
1. Design and execute test cases
2. Validate outputs against expectations
3. Perform integration and end-to-end testing
4. Identify bugs and quality issues
5. Generate test reports`,
    tools: ["verify", "code_analyze", "shell_execute", "health_check", "logs_search", "metrics_collect"],
    capabilities: [
      {
        name: "test_execution",
        description: "Run and manage tests",
        tools: ["shell_execute", "verify"],
        inputSchema: z.object({ testCommand: z.string() }),
        outputSchema: z.object({ passed: z.boolean(), results: z.any() }),
      },
      {
        name: "quality_validation",
        description: "Validate output quality",
        tools: ["verify", "code_analyze"],
        inputSchema: z.object({ output: z.any(), criteria: z.array(z.string()) }),
        outputSchema: z.object({ valid: z.boolean(), issues: z.array(z.string()) }),
      },
    ],
    timeout: 120000,
    maxIterations: 15,
    priority: 7,
  };

  const agent = createAgent(config, async (task, tools) => {
    const startTime = Date.now();

    try {
      const verifyResult = await tools.execute("verify", {
        claim: task.description,
        evidence: [],
      });

      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: true,
        output: { verification: verifyResult.data },
        duration: Date.now() - startTime,
        reasoning: "QA verification completed",
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: false,
        error: err.message,
        duration: Date.now() - startTime,
      };
    }
  });

  agentRegistry.register(agent);
}

function registerSecurityAgent(): void {
  const config: AgentConfig = {
    name: "SecurityAgent",
    description: "Specializes in security scanning, encryption, auditing, and vulnerability assessment",
    role: "Security",
    model: "grok-4-1-fast-non-reasoning",
    temperature: 0.2,
    maxTokens: 8192,
    systemPrompt: `You are the Security Agent. Your role is to:
1. Scan for security vulnerabilities
2. Encrypt and decrypt sensitive data
3. Audit access and changes
4. Generate secure passwords and tokens
5. Validate security policies`,
    tools: ["security_scan", "encrypt", "decrypt", "hash", "password_generate", "audit_log"],
    capabilities: [
      {
        name: "vulnerability_scanning",
        description: "Scan for security vulnerabilities",
        tools: ["security_scan"],
        inputSchema: z.object({ target: z.string(), scanType: z.string() }),
        outputSchema: z.object({ vulnerabilities: z.array(z.any()) }),
      },
      {
        name: "encryption",
        description: "Handle encryption operations",
        tools: ["encrypt", "decrypt", "hash"],
        inputSchema: z.object({ data: z.string(), operation: z.string() }),
        outputSchema: z.object({ result: z.string() }),
      },
    ],
    timeout: 90000,
    maxIterations: 10,
    priority: 8,
  };

  const agent = createAgent(config, async (task, tools) => {
    const startTime = Date.now();

    try {
      const scanResult = await tools.execute("security_scan", {
        target: task.input.target || "code",
        scanType: "code",
      });

      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: true,
        output: { securityReport: scanResult.data },
        duration: Date.now() - startTime,
        reasoning: "Security scan completed",
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        agentId: crypto.randomUUID(),
        agentName: config.name,
        success: false,
        error: err.message,
        duration: Date.now() - startTime,
      };
    }
  });

  agentRegistry.register(agent);
}
