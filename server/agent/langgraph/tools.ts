import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  DocumentTool,
  SearchTool,
  BrowserTool,
  MessageTool,
  ResearchTool,
  PlanTool,
  SlidesTool,
  WebDevTool,
  ScheduleTool,
  ExposeTool,
  GenerateTool,
  ShellTool,
  FileTool,
  PythonTool,
} from "../sandbox/tools";
import type { ToolResult } from "../sandbox/agentTypes";
import { MEMORY_TOOLS, memoryStoreTool, memoryRetrieveTool, contextManageTool, sessionStateTool } from "./memoryTools";
import { REASONING_TOOLS, reasonTool, reflectTool, verifyTool } from "./reasoningTools";
import { ORCHESTRATION_TOOLS, orchestrateTool, workflowTool, strategicPlanTool } from "./orchestrationTools";
import { COMMUNICATION_TOOLS, decideTool, clarifyTool, summarizeTool, explainTool } from "./communicationTools";
import { ADVANCED_SYSTEM_TOOLS, codeExecuteTool, fileConvertTool, environmentTool, searchSemanticTool } from "./systemTools";
import { MACOS_NATIVE_TOOLS } from "../tools/macosNativeTools";
import { WEB_TOOLS } from "./webTools";
import { GENERATION_TOOLS } from "./generationTools";
import { PROCESSING_TOOLS } from "./processingTools";
import { DATA_TOOLS } from "./dataTools";
import { DOCUMENT_TOOLS } from "./documentTools";
import { DEVELOPMENT_TOOLS } from "./developmentTools";
import { DIAGRAM_TOOLS } from "./diagramTools";
import { API_TOOLS } from "./apiTools";
import { PRODUCTIVITY_TOOLS } from "./productivityTools";
import { SECURITY_TOOLS } from "./securityTools";
import { AUTOMATION_TOOLS } from "./automationTools";
import { DATABASE_TOOLS } from "./databaseTools";
import { MONITORING_TOOLS } from "./monitoringTools";
import { UTILITY_TOOLS } from "./utilityTools";

const sandboxTools = {
  document: new DocumentTool(),
  search: new SearchTool(),
  browser: new BrowserTool(),
  message: new MessageTool(),
  research: new ResearchTool(),
  plan: new PlanTool(),
  slides: new SlidesTool(),
  webdev_init_project: new WebDevTool(),
  schedule: new ScheduleTool(),
  expose: new ExposeTool(),
  generate: new GenerateTool(),
  shell: new ShellTool(),
  file: new FileTool(),
  python: new PythonTool(),
};

function formatToolResult(result: ToolResult): string {
  if (result.success) {
    return JSON.stringify({
      success: true,
      message: result.message,
      data: result.data,
      filesCreated: result.filesCreated,
    });
  }
  return JSON.stringify({
    success: false,
    error: result.error || "Tool execution failed",
  });
}

export const documentTool = tool(
  async (input) => {
    const result = await sandboxTools.document.execute(input);
    return formatToolResult(result);
  },
  {
    name: "document",
    description: "Creates professional documents: PPTX, DOCX, XLSX. Use type='pptx' for presentations, 'docx' for Word documents, 'xlsx' for spreadsheets.",
    schema: z.object({
      type: z.enum(["pptx", "docx", "xlsx", "powerpoint", "word", "excel"]).describe("Document type to create"),
      title: z.string().describe("Document title"),
      filename: z.string().optional().describe("Output filename"),
      slides: z.array(z.object({
        title: z.string().optional(),
        content: z.string().optional(),
        bullets: z.array(z.string()).optional(),
      })).optional().describe("Slides for presentations"),
      sections: z.array(z.object({
        title: z.string().optional(),
        content: z.string().optional(),
        bullets: z.array(z.string()).optional(),
        level: z.number().optional(),
      })).optional().describe("Sections for Word documents"),
      sheets: z.array(z.object({
        name: z.string(),
        headers: z.array(z.string()),
        rows: z.array(z.array(z.any())),
      })).optional().describe("Sheets for Excel documents"),
    }),
  }
);

export const searchTool = tool(
  async (input) => {
    const result = await sandboxTools.search.execute(input);
    return formatToolResult(result);
  },
  {
    name: "search",
    description: "Performs web search using multiple sources with intelligent fallback (SearXNG, Brave, DuckDuckGo). Useful for research, fact-checking, price comparisons, and tracking. Returns results with titles, snippets, and URLs.",
    schema: z.object({
      query: z.string().describe("Search query"),
      maxResults: z.number().optional().default(10).describe("Maximum number of results"),
    }),
  }
);

export const browserTool = tool(
  async (input) => {
    const result = await sandboxTools.browser.execute(input);
    return formatToolResult(result);
  },
  {
    name: "browser",
    description: "Fetches and extracts readable text content from URLs. Use this to read web pages.",
    schema: z.object({
      url: z.string().url().describe("URL to fetch"),
      extractText: z.boolean().optional().default(true).describe("Extract readable text"),
      maxLength: z.number().optional().describe("Maximum content length"),
    }),
  }
);

export const messageTool = tool(
  async (input) => {
    const result = await sandboxTools.message.execute(input);
    return formatToolResult(result);
  },
  {
    name: "message",
    description: "Returns formatted messages to the user in various formats.",
    schema: z.object({
      content: z.union([z.string(), z.array(z.string())]).describe("Message content"),
      format: z.enum(["text", "markdown", "json", "list", "bullet"]).optional().default("text"),
      title: z.string().optional().describe("Optional title/header"),
      type: z.enum(["info", "success", "warning", "error"]).optional().default("info"),
    }),
  }
);

export const researchTool = tool(
  async (input) => {
    const result = await sandboxTools.research.execute(input);
    return formatToolResult(result);
  },
  {
    name: "research",
    description: "Performs deep research on a topic by combining web search with content extraction and analysis.",
    schema: z.object({
      topic: z.string().describe("Research topic"),
      depth: z.enum(["quick", "standard", "deep"]).optional().default("standard"),
      maxSources: z.number().optional().default(5),
    }),
  }
);

export const planTool = tool(
  async (input) => {
    const result = await sandboxTools.plan.execute(input);
    return formatToolResult(result);
  },
  {
    name: "plan",
    description: "Manages task plans: create, detect intent, track progress. Creates structured execution plans.",
    schema: z.object({
      action: z.enum(["create", "detect", "status"]).describe("Action to perform"),
      input: z.string().optional().describe("Task description or text to analyze"),
    }),
  }
);

export const slidesTool = tool(
  async (input) => {
    const result = await sandboxTools.slides.execute(input);
    return formatToolResult(result);
  },
  {
    name: "slides",
    description: "Creates PowerPoint presentations with AI-generated content and professional designs.",
    schema: z.object({
      topic: z.string().describe("Presentation topic"),
      slideCount: z.number().optional().default(5).describe("Number of slides"),
      style: z.string().optional().describe("Presentation style/theme"),
    }),
  }
);

export const webdevTool = tool(
  async (input) => {
    const result = await sandboxTools.webdev_init_project.execute(input);
    return formatToolResult(result);
  },
  {
    name: "webdev_init_project",
    description: "Initializes web development projects with specified frameworks and configurations.",
    schema: z.object({
      projectName: z.string().describe("Project name"),
      framework: z.enum(["react", "vue", "next", "express", "fastapi"]).optional(),
      typescript: z.boolean().optional().default(true),
    }),
  }
);

export const scheduleTool = tool(
  async (input) => {
    const result = await sandboxTools.schedule.execute(input);
    return formatToolResult(result);
  },
  {
    name: "schedule",
    description: "Creates and manages schedules and calendar events (meetings, reminders, focus blocks). Useful for detecting conflicts and suggesting optimal time slots.",
    schema: z.object({
      action: z.enum(["create", "list", "update"]).describe("Action to perform"),
      title: z.string().optional().describe("Event title"),
      startTime: z.string().optional().describe("Start time (ISO format)"),
      endTime: z.string().optional().describe("End time (ISO format)"),
      description: z.string().optional(),
    }),
  }
);

export const exposeTool = tool(
  async (input) => {
    const result = await sandboxTools.expose.execute(input);
    return formatToolResult(result);
  },
  {
    name: "expose",
    description: "Exposes local services or creates shareable URLs for development.",
    schema: z.object({
      port: z.number().describe("Port to expose"),
      protocol: z.enum(["http", "https"]).optional().default("http"),
    }),
  }
);

export const generateTool = tool(
  async (input) => {
    const result = await sandboxTools.generate.execute(input);
    return formatToolResult(result);
  },
  {
    name: "generate",
    description: "Generates various content types: code, text, data, etc.",
    schema: z.object({
      type: z.enum(["code", "text", "data", "image"]).describe("Content type to generate"),
      prompt: z.string().describe("Generation prompt"),
      language: z.string().optional().describe("Programming language for code"),
    }),
  }
);

export const shellTool = tool(
  async (input) => {
    const result = await sandboxTools.shell.execute(input);
    return formatToolResult(result);
  },
  {
    name: "shell",
    description: "Executes shell commands in a sandboxed environment. Use for system operations, file manipulation, and running scripts.",
    schema: z.object({
      command: z.string().describe("Shell command to execute"),
      timeout: z.number().optional().default(30000).describe("Timeout in milliseconds"),
      workingDir: z.string().optional().describe("Working directory"),
    }),
  }
);

export const fileTool = tool(
  async (input) => {
    const result = await sandboxTools.file.execute(input);
    return formatToolResult(result);
  },
  {
    name: "file",
    description: "Performs file operations: read, write, delete, list, mkdir, process. Universal file parsing for PDF, DOCX, XLSX, code files.",
    schema: z.object({
      operation: z.enum(["read", "write", "delete", "list", "mkdir", "exists", "copy", "move", "process"]).describe("File operation"),
      path: z.string().describe("File or directory path"),
      content: z.string().optional().describe("Content for write operation"),
      encoding: z.string().optional().default("utf-8"),
      recursive: z.boolean().optional().default(true),
    }),
  }
);

export const pythonTool = tool(
  async (input) => {
    const result = await sandboxTools.python.execute(input);
    return formatToolResult(result);
  },
  {
    name: "python",
    description: "Executes Python code in a sandboxed environment. Use for data analysis, statistics, machine learning (predictions/forecasting), and real-time/stream processing prototypes.",
    schema: z.object({
      code: z.string().describe("Python code to execute"),
      timeout: z.number().optional().default(60000).describe("Timeout in milliseconds"),
    }),
  }
);

export const macDesktopCreateFolderTool = tool(
  async (input) => {
    try {
      const rawName = String(input.name || "").trim();
      if (!rawName) {
        return JSON.stringify({ success: false, error: "Folder name is required" });
      }

      const invalid = /[\\/:*?"<>|]/.test(rawName) || rawName.includes("..");
      if (invalid) {
        return JSON.stringify({ success: false, error: "Invalid folder name" });
      }

      const desktopDir = path.join(os.homedir(), "Desktop");
      const folderPath = path.join(desktopDir, rawName);
      await fs.mkdir(folderPath, { recursive: true });
      const auditPath = path.join(os.homedir(), ".iliagpt-control-audit.log");
      await fs.appendFile(
        auditPath,
        `${new Date().toISOString()} mac_desktop_create_folder name=${rawName} path=${folderPath}\n`,
        "utf-8"
      );

      return JSON.stringify({
        success: true,
        created: true,
        path: folderPath,
        message: `Folder ready at ${folderPath}`,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error?.message || "Failed to create folder" });
    }
  },
  {
    name: "mac_desktop_create_folder",
    description: "Creates a folder directly on this Mac Desktop. Use this when the user explicitly asks to create a folder in Escritorio/Desktop.",
    schema: z.object({
      name: z.string().min(1).max(120).describe("Folder name only (no slashes or path)"),
    }),
  }
);

export const SAFE_TOOLS = [
  documentTool,
  searchTool,
  browserTool,
  messageTool,
  researchTool,
  planTool,
  slidesTool,
  webdevTool,
  scheduleTool,
  exposeTool,
  generateTool,
];

export const SYSTEM_TOOLS = [
  shellTool,
  fileTool,
  pythonTool,
  macDesktopCreateFolderTool,
];

export { MEMORY_TOOLS, memoryStoreTool, memoryRetrieveTool, contextManageTool, sessionStateTool };

export { REASONING_TOOLS, reasonTool, reflectTool, verifyTool };

export { ORCHESTRATION_TOOLS, orchestrateTool, workflowTool, strategicPlanTool };

export { COMMUNICATION_TOOLS, decideTool, clarifyTool, summarizeTool, explainTool };

export { ADVANCED_SYSTEM_TOOLS, codeExecuteTool, fileConvertTool, environmentTool, searchSemanticTool };

export { WEB_TOOLS };

export { GENERATION_TOOLS };

export { PROCESSING_TOOLS };

export { DATA_TOOLS };

export { DOCUMENT_TOOLS };

export { DEVELOPMENT_TOOLS };

export { DIAGRAM_TOOLS };

export { API_TOOLS };

export { PRODUCTIVITY_TOOLS };

export { SECURITY_TOOLS };

export { AUTOMATION_TOOLS };

export { DATABASE_TOOLS };

export { MONITORING_TOOLS };

export { UTILITY_TOOLS };

export const ALL_TOOLS = [
  ...SAFE_TOOLS,
  ...SYSTEM_TOOLS,
  ...MEMORY_TOOLS,
  ...REASONING_TOOLS,
  ...ORCHESTRATION_TOOLS,
  ...COMMUNICATION_TOOLS,
  ...ADVANCED_SYSTEM_TOOLS,
  ...MACOS_NATIVE_TOOLS,
  ...WEB_TOOLS,
  ...GENERATION_TOOLS,
  ...PROCESSING_TOOLS,
  ...DATA_TOOLS,
  ...DOCUMENT_TOOLS,
  ...DEVELOPMENT_TOOLS,
  ...DIAGRAM_TOOLS,
  ...API_TOOLS,
  ...PRODUCTIVITY_TOOLS,
  ...SECURITY_TOOLS,
  ...AUTOMATION_TOOLS,
  ...DATABASE_TOOLS,
  ...MONITORING_TOOLS,
  ...UTILITY_TOOLS,
];

export function getToolsByCategory(options: {
  includeSafe?: boolean;
  includeSystem?: boolean;
  includeMemory?: boolean;
  includeReasoning?: boolean;
  includeOrchestration?: boolean;
  includeCommunication?: boolean;
  includeAdvancedSystem?: boolean;
  includeWeb?: boolean;
  includeGeneration?: boolean;
  includeProcessing?: boolean;
  includeData?: boolean;
  includeDocument?: boolean;
  includeDevelopment?: boolean;
  includeDiagram?: boolean;
  includeApi?: boolean;
  includeProductivity?: boolean;
  includeSecurity?: boolean;
  includeAutomation?: boolean;
  includeDatabase?: boolean;
  includeMonitoring?: boolean;
  includeUtility?: boolean;
} = {}) {
  const {
    includeSafe = true,
    includeSystem = false,
    includeMemory = false,
    includeReasoning = false,
    includeOrchestration = false,
    includeCommunication = false,
    includeAdvancedSystem = false,
    includeWeb = false,
    includeGeneration = false,
    includeProcessing = false,
    includeData = false,
    includeDocument = false,
    includeDevelopment = false,
    includeDiagram = false,
    includeApi = false,
    includeProductivity = false,
    includeSecurity = false,
    includeAutomation = false,
    includeDatabase = false,
    includeMonitoring = false,
    includeUtility = false,
  } = options;
  
  const tools = [];
  if (includeSafe) tools.push(...SAFE_TOOLS);
  if (includeSystem) tools.push(...SYSTEM_TOOLS);
  if (includeMemory) tools.push(...MEMORY_TOOLS);
  if (includeReasoning) tools.push(...REASONING_TOOLS);
  if (includeOrchestration) tools.push(...ORCHESTRATION_TOOLS);
  if (includeCommunication) tools.push(...COMMUNICATION_TOOLS);
  if (includeAdvancedSystem) tools.push(...ADVANCED_SYSTEM_TOOLS);
  if (includeWeb) tools.push(...WEB_TOOLS);
  if (includeGeneration) tools.push(...GENERATION_TOOLS);
  if (includeProcessing) tools.push(...PROCESSING_TOOLS);
  if (includeData) tools.push(...DATA_TOOLS);
  if (includeDocument) tools.push(...DOCUMENT_TOOLS);
  if (includeDevelopment) tools.push(...DEVELOPMENT_TOOLS);
  if (includeDiagram) tools.push(...DIAGRAM_TOOLS);
  if (includeApi) tools.push(...API_TOOLS);
  if (includeProductivity) tools.push(...PRODUCTIVITY_TOOLS);
  if (includeSecurity) tools.push(...SECURITY_TOOLS);
  if (includeAutomation) tools.push(...AUTOMATION_TOOLS);
  if (includeDatabase) tools.push(...DATABASE_TOOLS);
  if (includeMonitoring) tools.push(...MONITORING_TOOLS);
  if (includeUtility) tools.push(...UTILITY_TOOLS);
  return tools;
}

const TOOL_NAME_ALIASES: Readonly<Record<string, string>> = {
  search_web: "web_search",
};

export function getToolByName(name: string) {
  const normalizedName = TOOL_NAME_ALIASES[name] || name;
  return ALL_TOOLS.find((t) => t.name === normalizedName);
}
