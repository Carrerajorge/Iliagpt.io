import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class ComputerUseAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "ComputerUseAgent",
      description: "Full computer control agent: agentic browser automation across any browser (Chromium/Firefox/WebKit), autonomous screen interaction with vision, terminal control, and professional document generation (PPT/DOCX/XLSX).",
      model: DEFAULT_MODEL,
      temperature: 0.2,
      maxTokens: 16384,
      systemPrompt: `You are the ComputerUseAgent - a powerful autonomous computer control specialist.

Your capabilities:
1. **Agentic Browser Control**: Navigate any browser (Chromium, Firefox, WebKit) autonomously. Self-correcting navigation using vision analysis and LLM reasoning. Multi-tab, multi-browser session management.
2. **Screen Interaction**: Click elements by CSS selector or screen coordinates, type text, scroll, press keys, use hotkeys. Vision-guided element detection and interaction.
3. **Data Extraction**: Extract structured or unstructured data from web pages using CSS selectors or AI-powered semantic extraction.
4. **Terminal Control**: Execute shell commands, manage files, run scripts (Python, Node.js, Bash), monitor system resources, manage processes and ports.
5. **Document Generation**: Create professional PowerPoint presentations (15 templates), Word documents (cover pages, TOC, references), and Excel spreadsheets (formulas, charts, formatting).
6. **Vision Analysis**: Capture and analyze screenshots, OCR text extraction, UI element detection, accessibility audits.

Autonomous behavior:
- Decompose complex goals into step-by-step actions
- Self-verify results after each action using screenshots and analysis
- Retry failed actions with alternative strategies
- Report progress and ask for clarification when stuck
- Prioritize safety: never execute destructive commands without confirmation

Security considerations:
- Block dangerous shell commands (rm -rf /, fork bombs, etc.)
- Validate URLs before navigation
- Sanitize extracted content
- Use stealth mode for anti-detection when appropriate`,
      tools: [
        "computer_use_session",
        "computer_use_navigate",
        "computer_use_interact",
        "computer_use_screenshot",
        "computer_use_extract",
        "computer_use_agentic",
        "generate_perfect_ppt",
        "generate_perfect_doc",
        "generate_perfect_excel",
        "terminal_execute",
        "terminal_system_info",
        "terminal_file_op",
        "vision_analyze",
      ],
      timeout: 300000,
      maxIterations: 50,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const taskType = this.determineTaskType(task);
      let result: any;

      switch (taskType) {
        case "browser_control":
          result = await this.executeBrowserControl(task);
          break;
        case "agentic_browse":
          result = await this.executeAgenticBrowse(task);
          break;
        case "terminal":
          result = await this.executeTerminalTask(task);
          break;
        case "generate_ppt":
          result = await this.executeDocumentGeneration(task, "ppt");
          break;
        case "generate_doc":
          result = await this.executeDocumentGeneration(task, "doc");
          break;
        case "generate_excel":
          result = await this.executeDocumentGeneration(task, "excel");
          break;
        case "vision":
          result = await this.executeVisionTask(task);
          break;
        default:
          result = await this.executeGeneralTask(task);
      }

      this.updateState({ status: "completed", progress: 100, completedAt: new Date().toISOString() });

      return {
        taskId: task.id,
        agentId: this.state.id,
        success: true,
        output: result,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      this.updateState({ status: "failed", error: error.message });
      return {
        taskId: task.id,
        agentId: this.state.id,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private determineTaskType(task: AgentTask): string {
    const desc = task.description.toLowerCase();
    if (desc.includes("agentic") || desc.includes("autonomous") || desc.includes("self-navigate") || desc.includes("goal")) return "agentic_browse";
    if (desc.includes("browser") || desc.includes("navigate") || desc.includes("click") || desc.includes("scrape") || desc.includes("web")) return "browser_control";
    if (desc.includes("terminal") || desc.includes("command") || desc.includes("shell") || desc.includes("execute") || desc.includes("system")) return "terminal";
    if (desc.includes("ppt") || desc.includes("presentation") || desc.includes("powerpoint") || desc.includes("slides")) return "generate_ppt";
    if (desc.includes("document") || desc.includes("docx") || desc.includes("word") || desc.includes("report") || desc.includes("essay")) return "generate_doc";
    if (desc.includes("excel") || desc.includes("spreadsheet") || desc.includes("xlsx") || desc.includes("budget") || desc.includes("invoice")) return "generate_excel";
    if (desc.includes("vision") || desc.includes("screenshot") || desc.includes("analyze screen") || desc.includes("ocr")) return "vision";
    return "general";
  }

  private async executeBrowserControl(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Plan browser control actions for this task:
Task: ${task.description}
Input: ${JSON.stringify(task.input)}

Return a JSON plan with:
{
  "browserProfile": "chrome-desktop|firefox-desktop|safari-desktop|mobile-iphone|mobile-android",
  "steps": [
    {
      "action": "navigate|click|type|scroll|screenshot|extract",
      "target": "url or selector",
      "value": "text to type or data",
      "waitAfter": 1000,
      "verify": "verification step after action"
    }
  ],
  "extractionGoal": "what data to extract",
  "successCriteria": "how to know task is done"
}`,
        },
      ],
      temperature: 0.2,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "browser_control",
      plan: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async executeAgenticBrowse(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create an autonomous browsing plan for this goal:
Goal: ${task.description}
Context: ${JSON.stringify(task.input)}

Return a JSON autonomous plan:
{
  "goal": "clear goal statement",
  "strategy": "high-level approach",
  "browserProfile": "chrome-desktop",
  "maxSteps": 20,
  "steps": [
    {
      "description": "what to do",
      "action": "navigate|search|click|type|extract|screenshot|verify",
      "target": "url or selector",
      "fallback": "alternative if this fails"
    }
  ],
  "successCriteria": ["list of conditions for success"],
  "safetyChecks": ["checks before each action"]
}`,
        },
      ],
      temperature: 0.3,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "agentic_browse",
      plan: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async executeTerminalTask(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Plan terminal/system commands for:
Task: ${task.description}
Input: ${JSON.stringify(task.input)}

Return JSON:
{
  "commands": [
    {
      "command": "shell command",
      "description": "what it does",
      "timeout": 30000,
      "requiresConfirmation": false,
      "expectedOutput": "what to expect"
    }
  ],
  "safetyChecks": ["pre-execution safety checks"],
  "rollbackPlan": "how to undo if something goes wrong"
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "terminal",
      plan: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async executeDocumentGeneration(task: AgentTask, docType: "ppt" | "doc" | "excel"): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Plan professional ${docType} generation:
Task: ${task.description}
Input: ${JSON.stringify(task.input)}

Return JSON:
{
  "topic": "document topic",
  "type": "${docType}",
  "template": "template name",
  "style": "professional|creative|academic|minimal",
  "language": "en",
  "details": {
    ${docType === "ppt" ? '"slideCount": 10, "includeCharts": true, "includeSpeakerNotes": true, "audience": "target audience"' : ""}
    ${docType === "doc" ? '"wordCount": 2000, "documentType": "report|proposal|essay", "includeTableOfContents": true, "includeCoverPage": true' : ""}
    ${docType === "excel" ? '"rowCount": 20, "includeFormulas": true, "includeConditionalFormatting": true, "columns": ["column names"]' : ""}
  },
  "customInstructions": "specific requirements"
}`,
        },
      ],
      temperature: 0.3,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: `generate_${docType}`,
      plan: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async executeVisionTask(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Plan vision analysis for:
Task: ${task.description}
Input: ${JSON.stringify(task.input)}

Return JSON:
{
  "analysisType": "analyze|ocr|detect_elements|accessibility",
  "query": "specific question about the screen",
  "sessionId": "session to capture from",
  "postAnalysisActions": ["what to do with results"]
}`,
        },
      ],
      temperature: 0.2,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "vision",
      plan: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async executeGeneralTask(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: `Computer use task: ${task.description}\nInput: ${JSON.stringify(task.input)}` },
      ],
      temperature: 0.2,
    });

    return {
      type: "general_computer_use",
      result: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "agentic_browser_control",
        description: "Autonomous browser control with self-correcting navigation across any browser engine",
        inputSchema: z.object({ goal: z.string(), browserProfile: z.string().optional(), maxSteps: z.number().optional() }),
        outputSchema: z.object({ success: z.boolean(), steps: z.array(z.any()), data: z.any() }),
      },
      {
        name: "screen_interaction",
        description: "Click, type, scroll, and interact with screen elements using selectors or coordinates",
        inputSchema: z.object({ sessionId: z.string(), action: z.string(), target: z.string().optional() }),
        outputSchema: z.object({ success: z.boolean(), result: z.any() }),
      },
      {
        name: "terminal_control",
        description: "Execute shell commands, manage files, run scripts on the computer",
        inputSchema: z.object({ command: z.string(), cwd: z.string().optional() }),
        outputSchema: z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number() }),
      },
      {
        name: "document_generation",
        description: "Generate professional PPT, DOCX, and XLSX documents with AI content",
        inputSchema: z.object({ type: z.enum(["ppt", "doc", "excel"]), topic: z.string() }),
        outputSchema: z.object({ fileName: z.string(), filePath: z.string() }),
      },
      {
        name: "vision_analysis",
        description: "Capture and analyze screenshots with AI vision for OCR, element detection, accessibility",
        inputSchema: z.object({ sessionId: z.string(), query: z.string().optional() }),
        outputSchema: z.object({ analysis: z.any(), elements: z.array(z.any()).optional() }),
      },
    ];
  }
}

export const computerUseAgent = new ComputerUseAgent();
