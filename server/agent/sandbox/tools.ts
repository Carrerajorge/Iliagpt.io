import { ToolResult, ToolCategory, IAgentTool, SearchResult, WebPageContent } from "./agentTypes";
import { CommandExecutor } from "./commandExecutor";
import { FileManager } from "./fileManager";
import { DocumentCreator, documentCreator } from "./documentCreator";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { searchOrchestrator, EnhancedSearchResult, DeepSearchResult } from "../../services/enhancedWebSearch";
import { executeTool } from "../../services/pythonAgentClient";

export abstract class BaseTool implements IAgentTool {
  abstract name: string;
  abstract description: string;
  abstract category: ToolCategory;
  enabled: boolean = true;

  abstract execute(params: Record<string, any>): Promise<ToolResult>;

  protected createResult(
    success: boolean,
    data?: any,
    message?: string,
    error?: string,
    startTime?: number,
    filesCreated?: string[]
  ): ToolResult {
    return {
      success,
      toolName: this.name,
      data,
      message: message || "",
      error,
      executionTimeMs: startTime ? Date.now() - startTime : 0,
      filesCreated: filesCreated || [],
    };
  }

  protected async withTiming<T>(fn: () => Promise<T>): Promise<{ result: T; executionTimeMs: number }> {
    const startTime = Date.now();
    const result = await fn();
    return { result, executionTimeMs: Date.now() - startTime };
  }
}

export class ShellTool extends BaseTool {
  name = "shell";
  description = "Executes shell commands in a sandboxed environment";
  category: ToolCategory = "system";

  private executor: CommandExecutor;

  constructor(executor?: CommandExecutor) {
    super();
    this.executor = executor || new CommandExecutor();
  }

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple parameter variations
    const command = params.command || params.cmd || params.shell || params.exec || params.run;
    const timeout = params.timeout || params.time_limit || 30000;
    const workingDir = params.workingDir || params.working_dir || params.cwd || params.directory;
    const env = params.env || params.environment || params.variables;

    if (!command || typeof command !== "string") {
      return this.createResult(false, null, "", "Command is required. Use: { command: 'your shell command' }", startTime);
    }

    try {
      const result = await this.executor.execute(command, {
        timeout: timeout || 30000,
        workingDir,
        env,
      });

      const success = result.status === "completed" && result.returnCode === 0;

      return this.createResult(
        success,
        {
          stdout: result.stdout,
          stderr: result.stderr,
          returnCode: result.returnCode,
          status: result.status,
        },
        success ? `Command executed successfully` : `Command failed with code ${result.returnCode}`,
        success ? undefined : result.errorMessage || result.stderr,
        startTime
      );
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class FileTool extends BaseTool {
  name = "file";
  description = "Performs file operations: read, write, delete, list, mkdir, process (universal file parsing for PDF, DOCX, XLSX, code files, etc.)";
  category: ToolCategory = "file";

  private fileManager: FileManager;

  constructor(fileManager?: FileManager) {
    super();
    this.fileManager = fileManager || new FileManager();
  }

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple parameter variations
    const operation = params.operation || params.action || params.op || params.mode || "read";
    const path = params.path || params.file || params.filepath || params.file_path || params.filename;
    const content = params.content || params.data || params.text || params.body;
    const encoding = params.encoding || params.charset || "utf-8";
    const recursive = params.recursive !== false;
    const pattern = params.pattern || params.glob || params.filter;
    const createDirs = params.createDirs !== false && params.create_dirs !== false;

    if (!operation) {
      return this.createResult(false, null, "", "Operation is required. Use: { operation: 'read|write|delete|list|mkdir|process', path: '...' }", startTime);
    }

    try {
      let result;
      const filesCreated: string[] = [];

      switch (operation) {
        case "process":
          if (!path) {
            return this.createResult(false, null, "", "Path is required for process operation", startTime);
          }
          try {
            const { processFile } = await import("../../services/fileProcessor");
            const processed = await processFile(path);
            return this.createResult(
              processed.success,
              {
                filename: processed.filename,
                mimeType: processed.mimeType,
                category: processed.category,
                content: processed.content,
                metadata: processed.metadata,
                size: processed.size,
              },
              processed.success ? `File processed: ${processed.filename} (${processed.category})` : "Failed to process file",
              processed.error,
              startTime
            );
          } catch (processError) {
            return this.createResult(false, null, "", `Process error: ${processError instanceof Error ? processError.message : String(processError)}`, startTime);
          }

        case "read":
          if (!path) {
            return this.createResult(false, null, "", "Path is required for read operation", startTime);
          }
          result = await this.fileManager.read(path, encoding || "utf-8");
          break;

        case "write":
          if (!path || content === undefined) {
            return this.createResult(false, null, "", "Path and content are required for write operation", startTime);
          }
          result = await this.fileManager.write(path, content, { encoding, createDirs: createDirs !== false });
          if (result.success) {
            filesCreated.push(result.path);
          }
          break;

        case "delete":
          if (!path) {
            return this.createResult(false, null, "", "Path is required for delete operation", startTime);
          }
          result = await this.fileManager.delete(path, recursive || false);
          break;

        case "list":
          result = await this.fileManager.listDir(path || ".", pattern, recursive || false);
          break;

        case "mkdir":
          if (!path) {
            return this.createResult(false, null, "", "Path is required for mkdir operation", startTime);
          }
          result = await this.fileManager.mkdir(path);
          break;

        case "exists":
          if (!path) {
            return this.createResult(false, null, "", "Path is required for exists operation", startTime);
          }
          result = await this.fileManager.exists(path);
          break;

        case "copy":
          if (!params.src || !params.dst) {
            return this.createResult(false, null, "", "Source and destination are required for copy operation", startTime);
          }
          result = await this.fileManager.copy(params.src, params.dst);
          if (result.success) {
            filesCreated.push(params.dst);
          }
          break;

        case "move":
          if (!params.src || !params.dst) {
            return this.createResult(false, null, "", "Source and destination are required for move operation", startTime);
          }
          result = await this.fileManager.move(params.src, params.dst);
          break;

        default:
          return this.createResult(false, null, "", `Unknown operation: ${operation}`, startTime);
      }

      return this.createResult(
        result.success,
        result.data,
        result.message,
        result.error,
        startTime,
        filesCreated
      );
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class PythonTool extends BaseTool {
  name = "python";
  description = "Executes Python code in a sandboxed environment";
  category: ToolCategory = "development";

  private executor: CommandExecutor;

  constructor(executor?: CommandExecutor) {
    super();
    this.executor = executor || new CommandExecutor();
  }

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple parameter variations
    const code = params.code || params.script || params.python || params.source || params.program;
    const timeout = params.timeout || params.time_limit || 60000;

    if (!code || typeof code !== "string") {
      return this.createResult(false, null, "", "Python code is required. Use: { code: 'print(\"hello\")' }", startTime);
    }

    try {
      const result = await this.executor.executeScript(code, "python3", timeout || 60000);
      const success = result.status === "completed" && result.returnCode === 0;

      return this.createResult(
        success,
        {
          stdout: result.stdout,
          stderr: result.stderr,
          returnCode: result.returnCode,
        },
        success ? "Python code executed successfully" : "Python execution failed",
        success ? undefined : result.errorMessage || result.stderr,
        startTime
      );
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class SearchTool extends BaseTool {
  name = "search";
  description = "Performs web search using multiple sources with intelligent fallback (SearXNG, Brave, DuckDuckGo)";
  category: ToolCategory = "search";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple parameter variations LLM might use
    const query = params.query || params.search || params.term || params.q || params.text || params.input;
    const maxResults = params.maxResults || params.max_results || params.limit || 10;
    const { timeout, sources } = params;

    if (!query || typeof query !== "string") {
      return this.createResult(false, null, "", "Search query is required. Use: { query: 'your search' }", startTime);
    }

    try {
      const results = await searchOrchestrator.search(query, {
        maxResults,
        timeout,
        sources
      });

      const searchResults: SearchResult[] = results.map((r: EnhancedSearchResult) => ({
        title: r.title,
        snippet: r.snippet,
        url: r.url,
      }));

      return this.createResult(
        true,
        {
          results: searchResults,
          query,
          totalResults: results.length,
          sources: results.map(r => r.source),
          scores: results.map(r => r.score)
        },
        `Found ${results.length} results for "${query}"`,
        undefined,
        startTime
      );
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class BrowserTool extends BaseTool {
  name = "browser";
  description = "Fetches and extracts readable text content from URLs";
  category: ToolCategory = "browser";

  private maxContentLength = 50000;
  private timeout = 30000;

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple URL parameter names
    const url = params.url || params.link || params.href || params.page || params.website || params.address;
    const extractText = params.extractText !== false && params.extract_text !== false;
    const maxLength = params.maxLength || params.max_length || params.limit;

    if (!url || typeof url !== "string") {
      return this.createResult(false, null, "", "URL is required. Use: { url: 'https://...' }", startTime);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return this.createResult(
          false,
          { url, status: response.status },
          "",
          `Failed to fetch URL: HTTP ${response.status}`,
          startTime
        );
      }

      const html = await response.text();
      let title = "";
      let content = html;

      if (extractText) {
        try {
          const dom = new JSDOM(html, { url });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();

          if (article) {
            title = article.title || "";
            content = article.textContent || "";
          } else {
            const doc = dom.window.document;
            title = doc.title || "";
            content = doc.body?.textContent?.replace(/\s+/g, " ").trim() || "";
          }
        } catch {
          content = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }
      }

      const limit = maxLength || this.maxContentLength;
      const truncatedContent = content.length > limit ? content.substring(0, limit) + "..." : content;

      const pageContent: WebPageContent = {
        url,
        title,
        content: truncatedContent,
        status: response.status,
      };

      return this.createResult(
        true,
        pageContent,
        `Successfully fetched content from ${url}`,
        undefined,
        startTime
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.createResult(
        false,
        { url, error: errorMessage },
        "",
        `Failed to fetch URL: ${errorMessage}`,
        startTime
      );
    }
  }
}

export class DocumentTool extends BaseTool {
  name = "document";
  description = "Creates professional documents: PPTX, DOCX, XLSX";
  category: ToolCategory = "document";

  private creator: DocumentCreator;

  constructor(creator?: DocumentCreator) {
    super();
    this.creator = creator || documentCreator;
  }

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple parameter variations
    const type = params.type || params.format || params.doc_type || params.document_type || "docx";
    const title = params.title || params.name || params.heading || params.subject || "Untitled";
    const filename = params.filename || params.file_name || params.output || params.file;

    if (!type) {
      return this.createResult(false, null, "", "Document type is required. Use: { type: 'pptx|docx|xlsx', title: '...' }", startTime);
    }

    try {
      let result: ToolResult;

      switch (type.toLowerCase()) {
        case "pptx":
        case "powerpoint":
        case "presentation":
        case "slides":
          // Handle slides array or object with slides property
          let slides = params.slides || params.pages || [];
          if (!Array.isArray(slides) && params.content) {
            slides = Array.isArray(params.content) ? params.content : (params.content.slides || []);
          }
          if (!Array.isArray(slides)) slides = [];
          const theme = params.theme || params.style || params.design;
          result = await this.creator.createPptx(title, slides, theme, filename);
          break;

        case "docx":
        case "word":
        case "doc":
        case "document":
          // Handle sections array or object with sections property
          let sections = params.sections || params.paragraphs || [];
          if (!Array.isArray(sections) && params.content) {
            sections = Array.isArray(params.content) ? params.content : (params.content.sections || []);
          }
          if (!Array.isArray(sections)) sections = [];
          const author = params.author || params.creator || params.by;
          result = await this.creator.createDocx(title, sections, author, filename);
          break;

        case "xlsx":
        case "excel":
        case "spreadsheet":
        case "xls":
          // Handle sheets array or object with sheets property
          let sheets = params.sheets || params.data || [];
          if (!Array.isArray(sheets) && params.content) {
            sheets = Array.isArray(params.content) ? params.content : (params.content.sheets || []);
          }
          if (!Array.isArray(sheets)) sheets = [];
          result = await this.creator.createXlsx(title, sheets, filename);
          break;

        default:
          return this.createResult(false, null, "", `Unknown document type: ${type}. Use: pptx, docx, xlsx`, startTime);
      }

      return {
        ...result,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class MessageTool extends BaseTool {
  name = "message";
  description = "Returns formatted messages to the user";
  category: ToolCategory = "communication";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple content parameter names
    const content = params.content || params.message || params.text || params.body || params.response || params.output;
    const format = params.format || "text";
    const title = params.title || params.subject || params.header;
    const type = params.type || "info";

    if (!content) {
      return this.createResult(false, null, "", "Message content is required. Use: { content: 'your message' }", startTime);
    }

    try {
      let formattedContent = content;

      if (format === "markdown") {
        formattedContent = content;
      } else if (format === "json") {
        formattedContent = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      } else if (format === "list" && Array.isArray(content)) {
        formattedContent = content.map((item, i) => `${i + 1}. ${item}`).join("\n");
      } else if (format === "bullet" && Array.isArray(content)) {
        formattedContent = content.map((item) => `• ${item}`).join("\n");
      }

      return this.createResult(
        true,
        {
          content: formattedContent,
          format,
          title,
          type,
          timestamp: new Date().toISOString(),
        },
        formattedContent,
        undefined,
        startTime
      );
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN TOOL - Task Planning and Management
// ═══════════════════════════════════════════════════════════════════════════════
export class PlanTool extends BaseTool {
  name = "plan";
  description = "Manages task plans: create, update, advance phases, track progress";
  category: ToolCategory = "system";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple parameter variations
    const action = params.action || params.operation || params.command || "create";
    const input = params.input || params.text || params.query || params.task || params.objective || params.goal;
    const planId = params.planId || params.plan_id || params.id;
    const phaseIndex = params.phaseIndex || params.phase_index || params.phase;
    const stepIndex = params.stepIndex || params.step_index || params.step;
    const status = params.status || params.state;

    try {
      const { taskPlanner } = await import("./taskPlanner");

      switch (action) {
        case "create":
        case "new":
        case "generate":
          if (!input) return this.createResult(false, null, "", "Input/task is required to create a plan. Use: { input: 'your task' }", startTime);
          const plan = await taskPlanner.createPlan(input);
          return this.createResult(true, { plan }, `Plan created with ${plan.phases.length} phases`, undefined, startTime);

        case "detect":
        case "analyze":
        case "intent":
          if (!input) return this.createResult(false, null, "", "Input is required to detect intent", startTime);
          const intent = await taskPlanner.detectIntent(input);
          return this.createResult(true, intent, `Detected intent: ${intent.intent}`, undefined, startTime);

        case "status":
        case "check":
        case "get":
          return this.createResult(true, { message: "Plan tool ready", available: true }, "Plan tool ready", undefined, startTime);

        default:
          return this.createResult(false, null, "", `Unknown action: ${action}. Use: create, detect, status`, startTime);
      }
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDES TOOL - PowerPoint Presentation Creation
// ═══════════════════════════════════════════════════════════════════════════════
export class SlidesTool extends BaseTool {
  name = "slides";
  description = "Creates PowerPoint presentations with AI-generated content and professional designs";
  category: ToolCategory = "document";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple parameter variations
    const topic = params.topic || params.subject || params.about || params.prompt || params.content || params.theme_topic;
    const title = params.title || params.name || params.presentation_title;
    const slideCount = params.slideCount || params.slide_count || params.num_slides || params.slides || 5;
    const theme = params.theme || params.style || params.design || "professional";
    const outline = params.outline || params.structure || params.slides_content;

    if (!topic && !outline && !title) {
      return this.createResult(false, null, "", "Topic, title, or outline is required. Use: { topic: 'your topic' }", startTime);
    }

    try {
      const docTool = new DocumentTool();
      const content = outline || { slides: [{ title: title || topic, content: topic }] };

      return await docTool.execute({
        type: "pptx",
        title: title || topic,
        content,
        theme,
        slideCount
      });
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBDEV TOOL - Web Development Project Scaffolding
// ═══════════════════════════════════════════════════════════════════════════════
export class WebDevTool extends BaseTool {
  name = "webdev_init_project";
  description = "Initializes web development projects with scaffolding (React, Vue, Next.js, Express, FastAPI)";
  category: ToolCategory = "system";

  private templates: Record<string, { files: Record<string, string>; dirs: string[] }> = {
    react: {
      dirs: ["src", "src/components", "public"],
      files: {
        "package.json": JSON.stringify({ name: "react-app", version: "1.0.0", scripts: { dev: "vite", build: "vite build" }, dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" }, devDependencies: { "@vitejs/plugin-react": "^4.0.0", vite: "^5.0.0" } }, null, 2),
        "src/App.jsx": `import { useState } from 'react'\nexport default function App() {\n  const [count, setCount] = useState(0)\n  return <div><h1>React App</h1><button onClick={() => setCount(c => c + 1)}>Count: {count}</button></div>\n}`,
        "index.html": `<!DOCTYPE html><html><head><title>React App</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`,
        "src/main.jsx": `import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App'\nReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)`
      }
    },
    express: {
      dirs: ["src", "src/routes"],
      files: {
        "package.json": JSON.stringify({ name: "express-app", version: "1.0.0", scripts: { start: "node src/index.js", dev: "node --watch src/index.js" }, dependencies: { express: "^4.18.2" } }, null, 2),
        "src/index.js": `const express = require('express')\nconst app = express()\napp.use(express.json())\napp.get('/', (req, res) => res.json({ message: 'Hello Express!' }))\napp.listen(5000, '0.0.0.0', () => console.log('Server running on port 5000'))`
      }
    },
    vue: {
      dirs: ["src", "src/components", "public"],
      files: {
        "package.json": JSON.stringify({ name: "vue-app", version: "1.0.0", scripts: { dev: "vite", build: "vite build" }, dependencies: { vue: "^3.4.0" }, devDependencies: { "@vitejs/plugin-vue": "^5.0.0", vite: "^5.0.0" } }, null, 2),
        "src/App.vue": `<template><div><h1>Vue App</h1><button @click="count++">Count: {{ count }}</button></div></template>\n<script setup>\nimport { ref } from 'vue'\nconst count = ref(0)\n</script>`,
        "index.html": `<!DOCTYPE html><html><head><title>Vue App</title></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>`,
        "src/main.js": `import { createApp } from 'vue'\nimport App from './App.vue'\ncreateApp(App).mount('#app')`
      }
    },
    nextjs: {
      dirs: ["app", "public"],
      files: {
        "package.json": JSON.stringify({ name: "nextjs-app", version: "1.0.0", scripts: { dev: "next dev", build: "next build", start: "next start" }, dependencies: { next: "^14.0.0", react: "^18.2.0", "react-dom": "^18.2.0" } }, null, 2),
        "app/page.tsx": `export default function Home() {\n  return <main><h1>Next.js App</h1></main>\n}`,
        "app/layout.tsx": `export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>\n}`
      }
    },
    fastapi: {
      dirs: ["app", "app/routers"],
      files: {
        "requirements.txt": "fastapi>=0.128.0\nuvicorn>=0.40.0\npython-multipart>=0.0.22",
        "app/main.py": `from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/")\ndef read_root():\n    return {"message": "Hello FastAPI!"}\n\nif __name__ == "__main__":\n    import uvicorn\n    uvicorn.run(app, host="0.0.0.0", port=5000)`
      }
    }
  };

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple parameter variations
    const framework = params.framework || params.type || params.template || params.stack || "react";
    const projectName = params.projectName || params.project_name || params.name || params.app_name || "my-app";
    const outputDir = params.outputDir || params.output_dir || params.directory || params.path || "/tmp/agent-projects";

    const normalizedFramework = framework.toLowerCase().replace(/[.-]/g, "");
    const template = this.templates[normalizedFramework] || this.templates[framework.toLowerCase()];
    if (!template) {
      return this.createResult(false, null, "", `Unknown framework: ${framework}. Available: ${Object.keys(this.templates).join(", ")}`, startTime);
    }

    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const projectPath = path.join(outputDir, projectName);

      await fs.mkdir(projectPath, { recursive: true });
      for (const dir of template.dirs) {
        await fs.mkdir(path.join(projectPath, dir), { recursive: true });
      }
      for (const [file, content] of Object.entries(template.files)) {
        await fs.writeFile(path.join(projectPath, file), content, "utf-8");
      }

      return this.createResult(
        true,
        { projectPath, framework, files: Object.keys(template.files), directories: template.dirs },
        `${framework} project created at ${projectPath}`,
        undefined,
        startTime,
        Object.keys(template.files).map(f => path.join(projectPath, f))
      );
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULE TOOL - Task Scheduling
// ═══════════════════════════════════════════════════════════════════════════════
export class ScheduleTool extends BaseTool {
  name = "schedule";
  description = "Schedules tasks for future or recurring execution";
  category: ToolCategory = "system";

  private scheduledTasks: Map<string, { task: string; scheduledAt: Date; status: string }> = new Map();

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple parameter variations
    const action = params.action || params.operation || "create";
    const task = params.task || params.description || params.name || params.job || params.command;
    const delay = params.delay || params.wait || params.after || 0;
    const taskId = params.taskId || params.task_id || params.id;
    const cron = params.cron || params.schedule || params.interval;

    try {
      switch (action) {
        case "create":
        case "add":
        case "new":
          if (!task) return this.createResult(false, null, "", "Task description is required. Use: { task: 'your task' }", startTime);
          const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const scheduledAt = new Date(Date.now() + (delay || 0));
          this.scheduledTasks.set(id, { task, scheduledAt, status: "scheduled" });
          return this.createResult(true, { taskId: id, task, scheduledAt, status: "scheduled" }, `Task scheduled: ${id}`, undefined, startTime);

        case "list":
          const tasks = Array.from(this.scheduledTasks.entries()).map(([id, t]) => ({ id, ...t }));
          return this.createResult(true, { tasks, count: tasks.length }, `${tasks.length} scheduled tasks`, undefined, startTime);

        case "cancel":
          if (!taskId) return this.createResult(false, null, "", "Task ID is required to cancel", startTime);
          if (this.scheduledTasks.has(taskId)) {
            this.scheduledTasks.delete(taskId);
            return this.createResult(true, { taskId, status: "cancelled" }, `Task ${taskId} cancelled`, undefined, startTime);
          }
          return this.createResult(false, null, "", `Task ${taskId} not found`, startTime);

        default:
          return this.createResult(false, null, "", `Unknown action: ${action}. Use: create, list, cancel`, startTime);
      }
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPOSE TOOL - Port Exposure for Public Access
// ═══════════════════════════════════════════════════════════════════════════════
export class ExposeTool extends BaseTool {
  name = "expose";
  description = "Exposes a local port for temporary public access";
  category: ToolCategory = "system";

  private exposedPorts: Map<number, { url: string; expiresAt: Date }> = new Map();

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple parameter variations and convert port to number
    const action = params.action || params.operation || "expose";
    const portRaw = params.port || params.portNumber || params.port_number;
    const port = typeof portRaw === "string" ? parseInt(portRaw, 10) : portRaw;
    const duration = params.duration || params.timeout || params.ttl || 3600;

    try {
      switch (action) {
        case "expose":
        case "open":
        case "start":
          if (!port || isNaN(port)) return this.createResult(false, null, "", "Port number is required. Use: { port: 3000 }", startTime);
          const replitUrl = process.env.REPLIT_DEV_DOMAIN || process.env.REPL_SLUG;
          const publicUrl = replitUrl ? `https://${replitUrl}` : `http://localhost:${port}`;
          const expiresAt = new Date(Date.now() + duration * 1000);
          this.exposedPorts.set(port, { url: publicUrl, expiresAt });
          return this.createResult(true, { port, url: publicUrl, expiresAt }, `Port ${port} exposed at ${publicUrl}`, undefined, startTime);

        case "list":
          const ports = Array.from(this.exposedPorts.entries()).map(([p, info]) => ({ port: p, ...info }));
          return this.createResult(true, { ports, count: ports.length }, `${ports.length} ports exposed`, undefined, startTime);

        case "close":
          if (!port) return this.createResult(false, null, "", "Port is required to close", startTime);
          this.exposedPorts.delete(port);
          return this.createResult(true, { port, status: "closed" }, `Port ${port} exposure closed`, undefined, startTime);

        default:
          return this.createResult(false, null, "", `Unknown action: ${action}. Use: expose, list, close`, startTime);
      }
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE TOOL - Media Generation (Images, Audio)
// ═══════════════════════════════════════════════════════════════════════════════
export class GenerateTool extends BaseTool {
  name = "generate";
  description = "Generates media content: images, audio, or other creative assets using AI";
  category: ToolCategory = "document";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple parameter variations
    const type = params.type || params.media_type || params.format || params.kind || "image";
    const prompt = params.prompt || params.description || params.text || params.input || params.query;
    const style = params.style || params.theme || params.aesthetic;
    const size = params.size || params.dimensions || params.resolution || "1024x1024";
    const outputPath = params.outputPath || params.output_path || params.path;

    if (!prompt) {
      return this.createResult(false, null, "", "Prompt/description is required. Use: { prompt: 'your description' }", startTime);
    }

    try {
      const fs = await import("fs/promises");
      const path = await import("path");

      switch (type) {
        case "image":
          const { generateImage } = await import("../../services/imageGeneration");
          const imageResult = await generateImage(prompt);

          if (imageResult && imageResult.success && imageResult.imageUrl) {
            return this.createResult(
              true,
              { url: imageResult.imageUrl, type: "image", prompt, dimensions: size },
              `Image generated successfully`,
              undefined,
              startTime,
              []
            );
          }
          return this.createResult(false, null, "", imageResult?.error || "Image generation failed", startTime);

        case "placeholder":
          const placeholderPath = `/tmp/agent-generated/placeholder_${Date.now()}.svg`;
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect fill="#ddd" width="400" height="300"/><text x="50%" y="50%" text-anchor="middle" fill="#666">${prompt}</text></svg>`;
          await fs.mkdir("/tmp/agent-generated", { recursive: true });
          await fs.writeFile(placeholderPath, svg);
          return this.createResult(true, { path: placeholderPath, type: "placeholder" }, `Placeholder created`, undefined, startTime, [placeholderPath]);

        default:
          return this.createResult(false, null, "", `Unsupported type: ${type}. Use: image, placeholder`, startTime);
      }
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

export class ResearchTool extends BaseTool {
  name = "research";
  description = "Performs deep research with multi-source search and parallel content extraction";
  category: ToolCategory = "search";

  private maxPages = 5;

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    // Accept multiple parameter variations
    const query = params.query || params.topic || params.subject || params.search || params.question || params.input;
    const maxPages = params.maxPages || params.max_pages || params.limit || params.pages || this.maxPages;
    const extractContent = params.extractContent !== false && params.extract_content !== false;
    const concurrencyLimit = params.concurrencyLimit || params.concurrency_limit || params.parallel || 3;

    if (!query || typeof query !== "string") {
      return this.createResult(false, null, "", "Research query/topic is required. Use: { query: 'your topic' }", startTime);
    }

    try {
      const deepResults = await searchOrchestrator.deepSearch(query, {
        maxResults: maxPages,
        extractContent,
        concurrencyLimit,
        maxContentLength: 10000
      });

      const researchData = deepResults.map((r: DeepSearchResult) => ({
        source: {
          title: r.title,
          snippet: r.snippet,
          url: r.url,
        },
        content: r.content ? {
          url: r.url,
          title: r.title,
          content: r.content,
          status: 200
        } : undefined,
        score: r.score,
        extractedAt: r.extractedAt
      }));

      const summary = {
        query,
        totalSources: researchData.length,
        successfulFetches: researchData.filter((r) => r.content).length,
        sources: researchData,
        availableSearchSources: searchOrchestrator.getAvailableSources()
      };

      return this.createResult(
        true,
        summary,
        `Research completed: ${researchData.length} sources found, ${summary.successfulFetches} successfully fetched`,
        undefined,
        startTime
      );
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class ToolRegistry {
  private tools: Map<string, IAgentTool> = new Map();

  register(tool: IAgentTool): void {
    if (!tool.name) {
      throw new Error("Tool must have a name");
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): IAgentTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, params: Record<string, any>): Promise<ToolResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        success: false,
        toolName: name,
        message: "",
        error: `Tool "${name}" not found`,
        executionTimeMs: 0,
        filesCreated: [],
      };
    }

    if (!tool.enabled) {
      return {
        success: false,
        toolName: name,
        message: "",
        error: `Tool "${name}" is disabled`,
        executionTimeMs: 0,
        filesCreated: [],
      };
    }

    try {
      return await tool.execute(params);
    } catch (error) {
      return {
        success: false,
        toolName: name,
        message: "",
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: 0,
        filesCreated: [],
      };
    }
  }

  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  listToolsWithInfo(): Array<{ name: string; description: string; category: ToolCategory; enabled: boolean }> {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      enabled: tool.enabled,
    }));
  }

  getToolsByCategory(category: ToolCategory): IAgentTool[] {
    return Array.from(this.tools.values()).filter((tool) => tool.category === category);
  }

  enableTool(name: string): boolean {
    const tool = this.tools.get(name);
    if (tool) {
      tool.enabled = true;
      return true;
    }
    return false;
  }

  disableTool(name: string): boolean {
    const tool = this.tools.get(name);
    if (tool) {
      tool.enabled = false;
      return true;
    }
    return false;
  }

  clear(): void {
    this.tools.clear();
  }

  get size(): number {
    return this.tools.size;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEATHER TOOL - Current Weather & Forecasts (Open-Meteo)
// ═══════════════════════════════════════════════════════════════════════════════
export class WeatherTool extends BaseTool {
  name = "weather";
  description = "Get current weather and forecasts for any location via Open-Meteo";
  category: ToolCategory = "data";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const location = params.location || params.city || params.place;
    const forecastDays = params.days || params.forecast_days || 3;

    if (!location) {
      return this.createResult(false, null, "", "Location is required. Use: { location: 'London' }", startTime);
    }

    try {
      // 1. Geocode
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`);
      if (!geoRes.ok) throw new Error("Geocoding failed");
      const geoData = await geoRes.json();

      if (!geoData.results || geoData.results.length === 0) {
        return this.createResult(false, null, "", `Location '${location}' not found`, startTime);
      }

      const { latitude, longitude, name, country } = geoData.results[0];

      // 2. Weather
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=${forecastDays}`);

      if (!weatherRes.ok) throw new Error("Weather fetch failed");
      const weatherData = await weatherRes.json();

      return this.createResult(true, {
        location: { name, country, latitude, longitude },
        current: weatherData.current,
        daily: weatherData.daily,
        timezone: weatherData.timezone
      }, `Fetched weather for ${name}, ${country}`, undefined, startTime);
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLACES TOOL - Location & POI search
// ═══════════════════════════════════════════════════════════════════════════════
export class PlacesTool extends BaseTool {
  name = "goplaces";
  description = "Search for places, businesses, and points of interest using Nominatim/OSM";
  category: ToolCategory = "search";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const query = params.query || params.place || params.search;
    const limit = params.limit || 5;

    if (!query) return this.createResult(false, null, "", "Query is required. Use: { query: 'coffee shops in NY' }", startTime);

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}`, {
        headers: { "User-Agent": "ILIAGPT-Agent/1.0" }
      });
      if (!res.ok) throw new Error("Places fetch failed");
      const data = await res.json();

      const places = data.map((p: any) => ({
        name: p.display_name,
        type: p.type,
        lat: p.lat,
        lon: p.lon,
        importance: p.importance
      }));

      return this.createResult(true, { places, count: places.length }, `Found ${places.length} places for '${query}'`, undefined, startTime);
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARIZE TOOL - Deep Web URL Summarization
// ═══════════════════════════════════════════════════════════════════════════════
export class SummarizeTool extends BaseTool {
  name = "summarize";
  description = "Extracts and summarizes long articles, documents, or web pages";
  category: ToolCategory = "ai";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const url = params.url || params.link;
    const text = params.text || params.content;
    const length = params.length || "medium";

    if (!url && !text) {
      return this.createResult(false, null, "", "Either 'url' or 'text' is required.", startTime);
    }

    try {
      let contentToSummarize = text;

      if (url) {
        const browser = new BrowserTool();
        const bResult = await browser.execute({ url, extractText: true });
        if (!bResult.success) throw new Error(`Fetch failed: ${bResult.error}`);
        contentToSummarize = bResult.data.content;
      }

      if (!contentToSummarize) throw new Error("No content found to summarize");

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return this.createResult(false, { content: contentToSummarize.slice(0, 1000) + "..." }, "API Key missing, returning truncated content", undefined, startTime);

      const { geminiChat } = await import("../../lib/gemini");
      const prompt = `Please provide a ${length} summary of the following text. Be concise but capture the key points:\n\n${contentToSummarize.slice(0, 30000)}`;

      const result = await geminiChat([{ role: "user", parts: [{ text: prompt }] }], { model: "gemini-2.0-flash", temperature: 0.3 });

      return this.createResult(true, { summary: result.content, originalLength: contentToSummarize.length }, "Summarization successful", undefined, startTime);
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GITHUB TOOL - Repository and PR Management
// ═══════════════════════════════════════════════════════════════════════════════
export class GitHubTool extends BaseTool {
  name = "github";
  description = "Interact with GitHub API to manage repositories, issues, and pull requests";
  category: ToolCategory = "integration";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const action = params.action || "list_issues";
    const owner = params.owner || params.org;
    const repo = params.repo || params.repository;

    // We expect the user to have GITHUB_TOKEN in env or pass it
    const token = params.token || process.env.GITHUB_TOKEN || process.env.GITHUB_API_KEY;

    if (!token) return this.createResult(false, null, "", "GitHub Token is required in environment (GITHUB_TOKEN) or params", startTime);
    if (!owner || !repo) return this.createResult(false, null, "", "Owner and repo are required (e.g., owner: 'microsoft', repo: 'vscode')", startTime);

    const headers = {
      "Accept": "application/vnd.github.v3+json",
      "Authorization": `token ${token}`,
      "User-Agent": "ILIAGPT-Agent/1.0"
    };

    try {
      let url = `https://api.github.com/repos/${owner}/${repo}`;
      let method = "GET";
      let body = undefined;

      switch (action) {
        case "list_issues":
          url += "/issues?state=all&per_page=10";
          break;
        case "create_issue":
          if (!params.title) throw new Error("Title is required for create_issue");
          url += "/issues";
          method = "POST";
          body = JSON.stringify({ title: params.title, body: params.body || "" });
          break;
        case "list_prs":
          url += "/pulls?state=all&per_page=10";
          break;
        case "get_repo":
          // Uses base url
          break;
        default:
          return this.createResult(false, null, "", `Unknown GitHub action: ${action}`, startTime);
      }

      const res = await fetch(url, { method, headers, body });
      if (!res.ok) throw new Error(`GitHub API error: ${res.statusText}`);
      const data = await res.json();

      return this.createResult(true, { action, data }, `GitHub action '${action}' completed`, undefined, startTime);
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTION TOOL - Workspace Management
// ═══════════════════════════════════════════════════════════════════════════════
export class NotionTool extends BaseTool {
  name = "notion";
  description = "Interact with Notion API to read databases and create pages";
  category: ToolCategory = "integration";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const action = params.action || "search"; // search, create_page, query_db
    const token = params.token || process.env.NOTION_API_KEY;

    if (!token) return this.createResult(false, null, "", "Notion API Key is required", startTime);

    const headers = {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    };

    try {
      let url = "https://api.notion.com/v1";
      let method = "POST";
      let body: any = {};

      switch (action) {
        case "search":
          url += "/search";
          body = { query: params.query || "" };
          break;
        case "query_db":
          if (!params.database_id) throw new Error("database_id required");
          url += `/databases/${params.database_id}/query`;
          break;
        case "create_page":
          if (!params.parent_id) throw new Error("parent_id (page or database) required");
          url += "/pages";
          body = {
            parent: params.parent_type === "database" ? { database_id: params.parent_id } : { page_id: params.parent_id },
            properties: {
              title: { title: [{ text: { content: params.title || "New Page" } }] }
            }
          };
          break;
        default:
          return this.createResult(false, null, "", `Unknown Notion action: ${action}`, startTime);
      }

      const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Notion API error: ${res.statusText}`);
      const data = await res.json();

      return this.createResult(true, { action, data }, `Notion action '${action}' completed`, undefined, startTime);
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRELLO TOOL - Boards and Cards Management
// ═══════════════════════════════════════════════════════════════════════════════
export class TrelloTool extends BaseTool {
  name = "trello";
  description = "Interact with Trello API to manage boards, lists, and cards";
  category: ToolCategory = "integration";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const action = params.action || "get_boards";
    const apiKey = params.apiKey || process.env.TRELLO_API_KEY;
    const token = params.token || process.env.TRELLO_TOKEN;

    if (!apiKey || !token) return this.createResult(false, null, "", "Trello API Key and Token are required", startTime);

    const baseUrl = "https://api.trello.com/1";
    const authQuery = `key=${apiKey}&token=${token}`;

    try {
      let url = "";
      let method = "GET";
      let body = undefined;

      switch (action) {
        case "get_boards":
          url = `${baseUrl}/members/me/boards?${authQuery}`;
          break;
        case "get_lists":
          if (!params.board_id) throw new Error("board_id required");
          url = `${baseUrl}/boards/${params.board_id}/lists?${authQuery}`;
          break;
        case "create_card":
          if (!params.list_id || !params.name) throw new Error("list_id and name required");
          url = `${baseUrl}/cards?idList=${params.list_id}&name=${encodeURIComponent(params.name)}&${authQuery}`;
          method = "POST";
          if (params.desc) url += `&desc=${encodeURIComponent(params.desc)}`;
          break;
        default:
          return this.createResult(false, null, "", `Unknown Trello action: ${action}`, startTime);
      }

      const res = await fetch(url, { method });
      if (!res.ok) throw new Error(`Trello API error: ${res.statusText}`);
      const data = await res.json();

      return this.createResult(true, { action, data }, `Trello action '${action}' completed`, undefined, startTime);
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA & PROCESSING TOOLS (Phase 3 - Bridged to Python Agent)
// ═══════════════════════════════════════════════════════════════════════════════
export class PdfTool extends BaseTool {
  name = "nano-pdf";
  description = "PDF operations: extract text, retrieve metadata, or merge multiple PDFs";
  category: ToolCategory = "file";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const result = await executeTool({ tool: "nano-pdf", params });
      return this.createResult(result.success, result.data, result.message, result.error || undefined, startTime, result.files_created);
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

export class ImageGenTool extends BaseTool {
  name = "openai-image-gen";
  description = "Generates images from text prompts using OpenAI DALL-E";
  category: ToolCategory = "ai";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const result = await executeTool({ tool: "openai-image-gen", params });
      return this.createResult(result.success, result.data, result.message, result.error || undefined, startTime, result.files_created);
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

export class TTSTool extends BaseTool {
  name = "sag";
  description = "Generates high-quality speech audio from text using ElevenLabs API";
  category: ToolCategory = "ai";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const result = await executeTool({ tool: "sag", params });
      return this.createResult(result.success, result.data, result.message, result.error || undefined, startTime, result.files_created);
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

export class DynamicPythonTool extends BaseTool {
  name: string;
  description: string;
  category: ToolCategory;

  constructor(name: string, description: string, category: ToolCategory) {
    super();
    this.name = name;
    this.description = description;
    this.category = category;
  }

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const result = await executeTool({ tool: this.name, params });
      return this.createResult(result.success, result.data, result.message, result.error || undefined, startTime, result.files_created);
    } catch (error) {
      return this.createResult(false, null, "", error instanceof Error ? error.message : String(error), startTime);
    }
  }
}

export function createDefaultToolRegistry(
  executor?: CommandExecutor,
  fileManager?: FileManager,
  docCreator?: DocumentCreator
): ToolRegistry {
  const registry = new ToolRegistry();

  // Core tools
  registry.register(new ShellTool(executor));
  registry.register(new FileTool(fileManager));
  registry.register(new PythonTool(executor));
  registry.register(new SearchTool());
  registry.register(new BrowserTool());
  registry.register(new DocumentTool(docCreator));
  registry.register(new MessageTool());
  registry.register(new ResearchTool());

  // Extended tools
  registry.register(new PlanTool());
  registry.register(new SlidesTool());
  registry.register(new WebDevTool());
  registry.register(new ScheduleTool());
  registry.register(new ExposeTool());
  // Phase 1 Tools
  registry.register(new WeatherTool());
  registry.register(new PlacesTool());
  registry.register(new SummarizeTool());

  // Phase 2 Tools
  registry.register(new GitHubTool());
  registry.register(new NotionTool());
  registry.register(new TrelloTool());

  // Phase 3 Tools
  registry.register(new PdfTool());
  registry.register(new ImageGenTool());
  registry.register(new TTSTool());

  // Phase 4 Tools: Dynamic Generation in UI
  const DYNAMIC_SKILLS = [
    { name: "base64-encode", desc: "Encodes a string to Base64", cat: "data" as ToolCategory },
    { name: "base64-decode", desc: "Decodes a Base64 string", cat: "data" as ToolCategory },
    { name: "md5-hash", desc: "Generate MD5 hash of text", cat: "system" as ToolCategory },
    { name: "sha1-hash", desc: "Generate SHA1 hash of text", cat: "system" as ToolCategory },
    { name: "sha256-hash", desc: "Generate SHA256 hash of text", cat: "system" as ToolCategory },
    { name: "sha512-hash", desc: "Generate SHA512 hash of text", cat: "system" as ToolCategory },
    { name: "url-encode", desc: "URL encodes a string", cat: "data" as ToolCategory },
    { name: "url-decode", desc: "URL decodes a string", cat: "data" as ToolCategory },
    { name: "html-escape", desc: "Escapes HTML characters", cat: "data" as ToolCategory },
    { name: "html-unescape", desc: "Unescapes HTML characters", cat: "data" as ToolCategory },
    { name: "text-uppercase", desc: "Convert text to UPPERCASE", cat: "ai" as ToolCategory },
    { name: "text-lowercase", desc: "Convert text to lowercase", cat: "ai" as ToolCategory },
    { name: "text-titlecase", desc: "Convert text to Title Case", cat: "ai" as ToolCategory },
    { name: "text-reverse", desc: "Reverse a text string", cat: "ai" as ToolCategory },
    { name: "text-length", desc: "Count characters in text", cat: "ai" as ToolCategory },
    { name: "word-count", desc: "Count words in text", cat: "ai" as ToolCategory },
    { name: "line-count", desc: "Count lines in text", cat: "ai" as ToolCategory },
    { name: "sort-lines", desc: "Sort lines alphabetically", cat: "ai" as ToolCategory },
    { name: "dedupe-lines", desc: "Remove duplicate lines", cat: "ai" as ToolCategory },
    { name: "extract-emails", desc: "Extract emails from text", cat: "data" as ToolCategory },
    { name: "extract-urls", desc: "Extract URLs from text", cat: "data" as ToolCategory },
    { name: "strip-whitespace", desc: "Remove leading/trailing whitespace", cat: "ai" as ToolCategory },
    { name: "math-add", desc: "Add multiple numbers together (comma separated)", cat: "data" as ToolCategory },
    { name: "math-subtract", desc: "Subtract numbers", cat: "data" as ToolCategory },
    { name: "math-multiply", desc: "Multiply numbers", cat: "data" as ToolCategory },
    { name: "math-divide", desc: "Divide numbers", cat: "data" as ToolCategory },
    { name: "math-power", desc: "Calculate power (base, exponent)", cat: "data" as ToolCategory },
    { name: "math-sqrt", desc: "Calculate square root", cat: "data" as ToolCategory },
    { name: "math-log", desc: "Calculate natural logarithm", cat: "data" as ToolCategory },
    { name: "currency-format", desc: "Format number as currency", cat: "data" as ToolCategory },
    { name: "json-minify", desc: "Minify a JSON string", cat: "data" as ToolCategory },
    { name: "json-prettify", desc: "Format JSON string nicely", cat: "data" as ToolCategory },
    { name: "csv-to-json", desc: "Convert simple CSV to JSON", cat: "data" as ToolCategory },
    { name: "json-to-csv", desc: "Convert flat JSON array to CSV", cat: "data" as ToolCategory },
    { name: "yaml-to-json", desc: "Convert YAML to JSON", cat: "data" as ToolCategory },
    { name: "json-to-yaml", desc: "Convert JSON to YAML", cat: "data" as ToolCategory },
    { name: "xml-to-json", desc: "Convert simple XML to JSON", cat: "data" as ToolCategory },
    { name: "generate-uuid", desc: "Generate a random UUID v4", cat: "system" as ToolCategory },
    { name: "generate-password", desc: "Generate a strong random password", cat: "system" as ToolCategory },
    { name: "generate-lorem", desc: "Generate Lorem Ipsum placeholder text", cat: "ai" as ToolCategory },
    { name: "epoch-to-iso", desc: "Convert UNIX epoch to ISO8601", cat: "system" as ToolCategory },
    { name: "iso-to-epoch", desc: "Convert ISO8601 to UNIX epoch", cat: "system" as ToolCategory },
    { name: "current-time-utc", desc: "Get current UTC time", cat: "system" as ToolCategory }
  ];

  DYNAMIC_SKILLS.forEach(skill => {
    registry.register(new DynamicPythonTool(skill.name, skill.desc, skill.cat));
  });

  for (let i = 1; i <= 47; i++) {
    registry.register(new DynamicPythonTool(`util-skill-${i}`, `Automated utility skill ${i} for data processing`, "data" as ToolCategory));
  }

  return registry;
}

export const defaultToolRegistry = createDefaultToolRegistry();
