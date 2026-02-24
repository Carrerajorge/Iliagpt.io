import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import { defaultToolRegistry, ToolRegistry } from "../agent/sandbox/tools";
import type { ToolResult as SandboxToolResult } from "../agent/sandbox/agentTypes";

export interface AgentState {
  objective: string;
  plan: string[];
  history: AgentStep[];
  observations: string[];
  toolsUsed: string[];
  currentStep: number;
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
}

export interface AgentStep {
  stepIndex: number;
  action: string;
  tool: string;
  input: Record<string, any>;
  output?: any;
  success: boolean;
  error?: string;
  duration: number;
  timestamp: Date;
}

export interface AgentRunnerConfig {
  maxSteps: number;
  stepTimeoutMs: number;
  enableLogging: boolean;
  maxConsecutiveFailures: number;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface AgentRunRecord {
  run_id: string;
  objective: string;
  route: "agent";
  confidence: number;
  plan: string[];
  tools_used: string[];
  steps: number;
  duration_ms: number;
  status: "completed" | "failed" | "cancelled";
  result: any;
  error?: string;
  created_at: Date;
  completed_at: Date;
}

export interface IRunStore {
  save(record: AgentRunRecord): Promise<void>;
  get(runId: string): Promise<AgentRunRecord | null>;
  list(limit?: number): Promise<AgentRunRecord[]>;
}

class InMemoryRunStore implements IRunStore {
  private runs: Map<string, AgentRunRecord> = new Map();
  private maxRuns = 100;

  async save(record: AgentRunRecord): Promise<void> {
    this.runs.set(record.run_id, record);
    if (this.runs.size > this.maxRuns) {
      const oldest = Array.from(this.runs.keys())[0];
      this.runs.delete(oldest);
    }
  }

  async get(runId: string): Promise<AgentRunRecord | null> {
    return this.runs.get(runId) || null;
  }

  async list(limit = 20): Promise<AgentRunRecord[]> {
    return Array.from(this.runs.values())
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit);
  }
}

export const runStore: IRunStore = new InMemoryRunStore();

const DEFAULT_LLM_TIMEOUT_MS = parseInt(process.env.AGENT_LLM_TIMEOUT_MS || "8000", 10);

const DEFAULT_CONFIG: AgentRunnerConfig = {
  maxSteps: parseInt(process.env.MAX_AGENT_STEPS || "8", 10),
  stepTimeoutMs: 60000,
  enableLogging: true,
  maxConsecutiveFailures: 2,
};

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class AgentRunner extends EventEmitter {
  private config: AgentRunnerConfig;
  private state: AgentState | null = null;
  private abortController: AbortController | null = null;
  private runId: string = "";
  private startTime: number = 0;
  private consecutiveFailures: number = 0;
  private lastFailedTool: string = "";

  constructor(config: Partial<AgentRunnerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logStructured("debug", "initialized", { maxSteps: this.config.maxSteps, maxConsecutiveFailures: this.config.maxConsecutiveFailures });
  }

  async run(objective: string, planHint: string[] = []): Promise<{ success: boolean; result: any; state: AgentState; run_id: string }> {
    this.runId = nanoid(12);
    this.startTime = Date.now();
    this.consecutiveFailures = 0;
    this.lastFailedTool = "";
    this.abortController = new AbortController();
    
    this.state = {
      objective,
      plan: planHint.length > 0 ? planHint : await this.generatePlan(objective),
      history: [],
      observations: [],
      toolsUsed: [],
      currentStep: 0,
      status: "running",
    };

    this.logStructured("info", "run_started", { run_id: this.runId, objective: objective.slice(0, 200), plan: this.state.plan });
    this.emit("started", { run_id: this.runId, objective, plan: this.state.plan });

    try {
      while (this.state.currentStep < this.config.maxSteps && this.state.status === "running") {
        if (this.abortController.signal.aborted) {
          this.state.status = "cancelled";
          await this.persistRun("cancelled", null, "Run cancelled by user");
          break;
        }

        const stepResult = await this.executeStep();
        
        if (stepResult.tool === "final_answer") {
          this.state.status = "completed";
          await this.persistRun("completed", stepResult.output);
          this.emit("completed", { run_id: this.runId, result: stepResult.output, state: this.state });
          return { success: true, result: stepResult.output, state: this.state, run_id: this.runId };
        }

        if (!stepResult.success) {
          if (stepResult.tool === this.lastFailedTool) {
            this.consecutiveFailures++;
          } else {
            this.consecutiveFailures = 1;
            this.lastFailedTool = stepResult.tool;
          }

          if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
            const errorMsg = `Tool "${stepResult.tool}" failed ${this.consecutiveFailures} consecutive times. Aborting run.`;
            this.logStructured("error", "consecutive_failures", { run_id: this.runId, tool: stepResult.tool, failures: this.consecutiveFailures });
            this.state.status = "failed";
            await this.persistRun("failed", null, errorMsg);
            this.emit("failed", { run_id: this.runId, error: errorMsg, state: this.state });
            return { 
              success: false, 
              result: { error: errorMsg, partial_observations: this.state.observations }, 
              state: this.state,
              run_id: this.runId 
            };
          }
        } else {
          this.consecutiveFailures = 0;
          this.lastFailedTool = "";
        }

        this.state.currentStep++;
      }

      if (this.state.currentStep >= this.config.maxSteps) {
        this.logStructured("warn", "max_steps_reached", { run_id: this.runId, steps: this.config.maxSteps });
        const summaryResult = await this.generateSummary();
        const warningMsg = `[WARNING: Max steps (${this.config.maxSteps}) reached. Response may be incomplete.]`;
        const resultWithWarning = `${warningMsg}\n\n${summaryResult}`;
        this.state.status = "completed";
        await this.persistRun("completed", resultWithWarning);
        this.emit("completed", { run_id: this.runId, result: resultWithWarning, state: this.state });
        return { success: true, result: resultWithWarning, state: this.state, run_id: this.runId };
      }

      await this.persistRun(this.state.status as any, this.state.observations);
      return { success: this.state.status === "completed", result: this.state.observations, state: this.state, run_id: this.runId };
    } catch (error: any) {
      this.state.status = "failed";
      const errorMsg = error.message || "Unknown error";
      this.logStructured("error", "run_failed", { run_id: this.runId, error: errorMsg });
      await this.persistRun("failed", null, errorMsg);
      this.emit("failed", { run_id: this.runId, error: errorMsg, state: this.state });
      return { success: false, result: { error: errorMsg }, state: this.state, run_id: this.runId };
    }
  }

  private async persistRun(status: "completed" | "failed" | "cancelled", result: any, error?: string): Promise<void> {
    const record: AgentRunRecord = {
      run_id: this.runId,
      objective: this.state!.objective,
      route: "agent",
      confidence: 1.0,
      plan: this.state!.plan,
      tools_used: this.state!.toolsUsed,
      steps: this.state!.history.length,
      duration_ms: Date.now() - this.startTime,
      status,
      result,
      error,
      created_at: new Date(this.startTime),
      completed_at: new Date(),
    };

    this.logStructured("info", "run_completed", {
      run_id: record.run_id,
      route: record.route,
      tools_used: record.tools_used,
      steps: record.steps,
      duration_ms: record.duration_ms,
      status: record.status,
    });

    await runStore.save(record);
  }

  private logStructured(level: "debug" | "info" | "warn" | "error", event: string, data: Record<string, any>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      component: "AgentRunner",
      event,
      ...data,
    };
    if (level === "error") {
      console.error(JSON.stringify(entry));
    } else if (level === "warn") {
      console.warn(JSON.stringify(entry));
    } else if (level === "debug" && this.config.enableLogging) {
      console.log(JSON.stringify(entry));
    } else if (level === "info") {
      console.log(JSON.stringify(entry));
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private async executeStep(): Promise<AgentStep> {
    const startTime = Date.now();
    const stepIndex = this.state!.currentStep;

    const nextAction = await this.decideNextAction();
    
    this.logStructured("debug", "step_started", { run_id: this.runId, stepIndex, tool: nextAction.tool, input: nextAction.input });
    this.emit("step_started", { stepIndex, action: nextAction });

    let result: ToolResult;
    
    try {
      result = await this.executeTool(nextAction.tool, nextAction.input);
    } catch (error: any) {
      result = { success: false, error: error.message };
    }

    const step: AgentStep = {
      stepIndex,
      action: nextAction.action,
      tool: nextAction.tool,
      input: nextAction.input,
      output: result.data,
      success: result.success,
      error: result.error,
      duration: Date.now() - startTime,
      timestamp: new Date(),
    };

    this.state!.history.push(step);
    
    if (!this.state!.toolsUsed.includes(nextAction.tool)) {
      this.state!.toolsUsed.push(nextAction.tool);
    }

    if (result.success && result.data) {
      const observation = typeof result.data === "string" 
        ? result.data.slice(0, 2000) 
        : JSON.stringify(result.data).slice(0, 2000);
      this.state!.observations.push(observation);
    }

    this.emit("step_completed", { step, state: this.state });
    this.logStructured("debug", "step_completed", { run_id: this.runId, stepIndex, tool: nextAction.tool, success: result.success, duration_ms: step.duration });

    return step;
  }

  private async decideNextAction(): Promise<{ action: string; tool: string; input: Record<string, any> }> {
    // In tests we must be deterministic and avoid external network calls.
    // Vitest doesn't always set NODE_ENV="test" reliably, so also detect VITEST.
    if (process.env.NODE_ENV === "test" || process.env.VITEST) {
      return this.heuristicNextAction();
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || process.env.NODE_ENV === "test") {
      this.logStructured("debug", "llm_unavailable", { run_id: this.runId, reason: "GEMINI_API_KEY not configured", fallback: "heuristic" });
      return this.heuristicNextAction();
    }

    try {
      const { geminiChat } = await import("../lib/gemini");

      const context = {
        objective: this.state!.objective,
        plan: this.state!.plan,
        currentStep: this.state!.currentStep,
        previousActions: this.state!.history.slice(-3).map(h => ({
          tool: h.tool,
          success: h.success,
          output: h.output?.toString().slice(0, 500),
        })),
        observations: this.state!.observations.slice(-3),
      };

      // Lightweight summary of older steps to maintain context without token bloat
      const olderHistory = this.state!.history.slice(0, -3);
      const contextSummary = olderHistory.length > 0 
        ? "Resumen de pasos anteriores (ya ejecutados):\n" + olderHistory.map(s => `- [Paso ${s.stepIndex}] ${s.tool}: ${s.success ? "Éxito" : "Fallo"}`).join("\n")
        : "";

      // Get all available tools from the registry
      const availableTools = defaultToolRegistry.listToolsWithInfo();
      const toolsDescription = availableTools.map(t => `- ${t.name}: ${t.description}`).join("\n");

      const prompt = `Eres un agente autónomo ejecutando una tarea.

Objetivo: ${context.objective}
Plan: ${context.plan.join(" → ")}
Paso actual: ${context.currentStep + 1}/${this.config.maxSteps}

${contextSummary}

Acciones recientes (últimas 3): ${JSON.stringify(context.previousActions)}
Observaciones recientes: ${context.observations.join("\n---\n")}

Herramientas disponibles:
${toolsDescription}
- final_answer(answer: string): Devuelve la respuesta final al usuario

IMPORTANTE - Parámetros de herramientas:
- slides: {"title": "Título", "slides": [{"title": "Slide 1", "content": "Contenido"}, ...], "theme": "modern"}
- document: {"type": "docx", "title": "Título", "content": "Contenido del documento"}
- search: {"query": "búsqueda", "mode": "quick|deep"}
- browser: {"url": "https://...", "action": "extract"}
- file: {"operation": "read|write|list|delete", "path": "ruta", "content": "para write"}
- shell: {"command": "comando a ejecutar"}

Decide la siguiente acción. Responde SOLO con JSON (sin markdown):
{"action":"descripción","tool":"nombre_herramienta","input":{"param":"valor"}}

Si ya tienes suficiente información para responder, usa final_answer.`;

      const result = await withTimeout(
        geminiChat(
          [{ role: "user", parts: [{ text: prompt }] }],
          { model: "gemini-2.0-flash", maxOutputTokens: 300, temperature: 0.2 }
        ),
        DEFAULT_LLM_TIMEOUT_MS,
        "geminiChat(decideNextAction)"
      );

      const responseText = result.content?.trim() || "";
      const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
      
      if (!jsonMatch) {
        this.logStructured("debug", "llm_parse_failed", { run_id: this.runId, reason: "No valid JSON in response", fallback: "heuristic" });
        return this.heuristicNextAction();
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        action: parsed.action || "execute",
        tool: parsed.tool || "final_answer",
        input: parsed.input || {},
      };
    } catch (error: any) {
      this.logStructured("debug", "llm_decision_failed", { run_id: this.runId, error: error.message, fallback: "heuristic" });
      return this.heuristicNextAction();
    }
  }

  private heuristicNextAction(): { action: string; tool: string; input: Record<string, any> } {
    const objective = this.state!.objective.toLowerCase();
    const originalObjective = this.state!.objective;
    const hasObservations = this.state!.observations.length > 0;
    const currentStep = this.state!.currentStep;

    // Check for presentation/slides request
    if (/presentaci[oó]n|slides?|pptx|powerpoint|diapositivas/i.test(objective) && !this.state!.toolsUsed.includes("slides")) {
      const titleMatch = originalObjective.match(/sobre\s+(.+?)(?:\s+con|\s+de\s+\d+|\.|$)/i);
      const slideCountMatch = originalObjective.match(/(\d+)\s*(?:slides?|diapositivas)/i);
      const slideCount = slideCountMatch ? parseInt(slideCountMatch[1]) : 3;
      const topic = titleMatch ? titleMatch[1].trim() : originalObjective.replace(/crea|genera|haz|make|create|una|presentaci[oó]n|sobre|de|slides/gi, "").trim();
      
      const slides = [];
      for (let i = 0; i < slideCount; i++) {
        slides.push({
          title: i === 0 ? `Introducción a ${topic}` : i === slideCount - 1 ? "Conclusiones" : `Punto ${i}`,
          content: `Contenido sobre ${topic}`
        });
      }
      
      return { 
        action: "Create presentation", 
        tool: "slides", 
        input: { title: `Presentación sobre ${topic}`, slides, theme: "modern" } 
      };
    }

    // Check for document request
    if (/documento|document|docx|word|informe|report|carta|letter/i.test(objective) && !this.state!.toolsUsed.includes("document")) {
      const titleMatch = originalObjective.match(/(?:sobre|titled?|llamad[oa]?)\s+["']?(.+?)["']?(?:\s+con|\.|$)/i);
      const topic = titleMatch ? titleMatch[1].trim() : "Documento";
      
      return { 
        action: "Create document", 
        tool: "document", 
        input: { type: "docx", title: topic, content: `Este es un documento sobre ${topic}.` } 
      };
    }

    // Check for file listing request
    if (/lista.*archivos|list.*files|directorio|directory|ls\b|mostrar archivos/i.test(objective) && !this.state!.toolsUsed.includes("file")) {
      return { 
        action: "List files in directory", 
        tool: "file", 
        input: { operation: "list", path: "." } 
      };
    }

    // Check for shell command request
    if (/ejecut[ae]|run|comando|command|shell|terminal/i.test(objective) && !this.state!.toolsUsed.includes("shell")) {
      const cmdMatch = originalObjective.match(/["'`](.+?)["'`]/);
      return { 
        action: "Execute shell command", 
        tool: "shell", 
        input: { command: cmdMatch ? cmdMatch[1] : "echo 'Hello World'" } 
      };
    }

    // If we have observations and enough steps, generate final answer
    if (hasObservations && currentStep >= 2) {
      return { 
        action: "Generate final answer from observations", 
        tool: "final_answer", 
        input: { answer: this.state!.observations.join("\n\n") } 
      };
    }

    // Check for URL in objective
    const urlMatch = objective.match(/https?:\/\/[^\s]+/);
    if (urlMatch && !this.state!.toolsUsed.includes("browser")) {
      return { action: "Navigate to URL", tool: "browser", input: { url: urlMatch[0], action: "extract" } };
    }

    // Default to search if no specific tool matched
    if (!this.state!.toolsUsed.includes("search")) {
      const searchQuery = objective.replace(/busca|search|encuentra|find|investiga|informaci[oó]n|dame|give me/gi, "").trim().slice(0, 100);
      return { action: "Search for information", tool: "search", input: { query: searchQuery || objective.slice(0, 100), mode: "quick" } };
    }

    return { 
      action: "Complete task", 
      tool: "final_answer", 
      input: { answer: hasObservations ? this.state!.observations.join("\n\n") : "No se encontró información relevante." } 
    };
  }

  private async executeTool(toolName: string, input: Record<string, any>): Promise<ToolResult> {
    this.logStructured("debug", "tool_executing", { run_id: this.runId, tool: toolName, input });

    // In tests, avoid any sandbox/network tool execution to prevent flakiness/timeouts.
    // Vitest doesn't always set NODE_ENV="test" reliably, so also detect VITEST.
    if (process.env.NODE_ENV === "test" || process.env.VITEST) {
      const t = toolName;
      if (t === "search" || t === "web_search" || t === "open_url" || t === "browser") {
        return { success: true, data: { mocked: true, tool: t, input } };
      }
      if (t === "file" || t === "shell" || t === "document" || t === "slides") {
        return { success: true, data: { mocked: true, tool: t, input } };
      }
    }

    // Handle special internal tools first
    if (toolName === "final_answer") {
      return { success: true, data: input.answer || input.response || "Tarea completada" };
    }

    // Handle extract_text locally (doesn't need sandbox tool)
    if (toolName === "extract_text") {
      return this.toolExtractText(input.content || input.html || input.markdown || input.text);
    }

    // Map some common tool aliases
    const toolAliases: Record<string, string> = {
      "web_search": "search",
      "open_url": "browser",
      "create_presentation": "slides",
      "create_document": "document",
      "create_pptx": "slides",
      "create_docx": "document",
      "run_command": "shell",
      "execute_shell": "shell",
      "read_file": "file",
      "write_file": "file",
      "list_files": "file",
    };

    const actualToolName = toolAliases[toolName] || toolName;

    // Avoid real external calls in unit tests (keeps tests deterministic and fast).
    if (process.env.NODE_ENV === "test" && actualToolName === "search") {
      return {
        success: true,
        data: [
          {
            title: "Test search result",
            url: "https://example.com",
            snippet: "Test mode: external search disabled.",
          },
        ],
      };
    }

    // Check if tool exists in sandbox registry
    if (defaultToolRegistry.has(actualToolName)) {
      this.logStructured("info", "sandbox_tool_executing", { run_id: this.runId, tool: actualToolName, originalTool: toolName });
      
      try {
        // Adapt input for specific tools
        let adaptedInput = { ...input };
        
        // Adapt web_search to search tool format
        if (toolName === "web_search" && input.query) {
          adaptedInput = { query: input.query, mode: "quick" };
        }
        
        // Adapt open_url to browser tool format
        if (toolName === "open_url" && input.url) {
          adaptedInput = { url: input.url, action: "extract" };
        }
        
        // Adapt file operations
        if (toolName === "read_file") {
          adaptedInput = { operation: "read", path: input.path || input.file };
        }
        if (toolName === "write_file") {
          adaptedInput = { operation: "write", path: input.path || input.file, content: input.content };
        }
        if (toolName === "list_files") {
          adaptedInput = { operation: "list", path: input.path || input.directory || "." };
        }

        const result: SandboxToolResult = await defaultToolRegistry.execute(actualToolName, adaptedInput);
        
        return {
          success: result.success,
          data: result.data,
          error: result.error,
        };
      } catch (error: any) {
        this.logStructured("error", "sandbox_tool_error", { run_id: this.runId, tool: actualToolName, error: error.message });
        return { success: false, error: error.message };
      }
    }

    // Fallback to legacy implementations for backward compatibility
    switch (toolName) {
      case "web_search":
        return this.toolWebSearch(input.query);
      
      case "open_url":
        return this.toolOpenUrl(input.url);
      
      case "extract_text":
        return this.toolExtractText(input.content || input.html || input.markdown);
      
      default:
        return { success: false, error: `Unknown tool: ${toolName}. Available tools: ${defaultToolRegistry.listTools().join(", ")}` };
    }
  }

  private async toolWebSearch(query: string): Promise<ToolResult> {
    try {
      const { searchAdapter } = await import("../agent/webtool/searchAdapter");
      const results = await searchAdapter.search(query, { maxResults: 5 });
      
      return {
        success: true,
        data: results.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        })),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolOpenUrl(url: string): Promise<ToolResult> {
    try {
      const { fetchAdapter } = await import("../agent/webtool/fetchAdapter");
      const result = await fetchAdapter.fetch(url);
      
      if (!result.success) {
        return { success: false, error: result.error || "Failed to fetch URL" };
      }

      const content = result.html?.slice(0, 10000) || result.text?.slice(0, 10000) || "";
      
      return {
        success: true,
        data: {
          url,
          title: result.title,
          content: content,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolExtractText(content: string): Promise<ToolResult> {
    if (!content) {
      return { success: false, error: "No content provided" };
    }

    const cleanText = content
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);

    return { success: true, data: cleanText };
  }

  private async generatePlan(objective: string): Promise<string[]> {
    // In tests we must be deterministic and avoid external calls.
    // Vitest doesn't always set NODE_ENV="test" reliably, so also detect VITEST.
    if (process.env.NODE_ENV === "test" || process.env.VITEST) {
      return this.heuristicPlan(objective);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || process.env.NODE_ENV === "test") {
      return this.heuristicPlan(objective);
    }

    try {
      const { geminiChat } = await import("../lib/gemini");
      
      const result = await withTimeout(
        geminiChat(
          [{ role: "user", parts: [{ text: `Genera un plan de 3-5 pasos para: "${objective}". Responde SOLO con JSON: {"steps":["paso1","paso2"]}` }] }],
          { model: "gemini-2.0-flash", maxOutputTokens: 150, temperature: 0.3 }
        ),
        DEFAULT_LLM_TIMEOUT_MS,
        "geminiChat(generatePlan)"
      );

      const jsonMatch = result.content?.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.steps)) {
          return parsed.steps;
        }
      }
    } catch (error) {
      this.logStructured("debug", "plan_generation_failed", { run_id: this.runId, fallback: "heuristic" });
    }

    return this.heuristicPlan(objective);
  }

  private heuristicPlan(objective: string): string[] {
    const lower = objective.toLowerCase();
    
    if (/presentaci[oó]n|slides?|pptx|powerpoint|diapositivas/.test(lower)) {
      return ["Analizar tema de la presentación", "Crear estructura de slides", "Generar archivo PPTX", "Entregar resultado"];
    }
    
    if (/documento|document|docx|word|informe|report/.test(lower)) {
      return ["Analizar contenido requerido", "Estructurar documento", "Generar archivo DOCX", "Entregar resultado"];
    }
    
    if (/lista.*archivos|list.*files|directorio|directory/.test(lower)) {
      return ["Listar archivos del directorio", "Formatear resultado", "Entregar lista"];
    }
    
    if (/https?:\/\//.test(objective)) {
      return ["Navegar a la URL", "Extraer contenido", "Analizar información", "Generar respuesta"];
    }
    
    if (/busca|search|investiga|research|encuentra|find|informaci[oó]n/.test(lower)) {
      return ["Buscar información en la web", "Analizar resultados", "Generar respuesta"];
    }
    
    if (/analiza|analyze|procesa|process|codigo|code/.test(lower)) {
      return ["Obtener datos", "Procesar información", "Generar análisis"];
    }
    
    return ["Analizar objetivo", "Buscar información relevante", "Generar respuesta final"];
  }

  private async generateSummary(): Promise<string> {
    const observations = this.state!.observations.join("\n---\n");
    
    if (!observations) {
      return "No se pudo obtener información para completar la tarea.";
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || process.env.NODE_ENV === "test") {
      return observations.slice(0, 2000);
    }

    try {
      const { geminiChat } = await import("../lib/gemini");
      
      const result = await withTimeout(
        geminiChat(
          [{ role: "user", parts: [{ text: `Objetivo: ${this.state!.objective}\n\nInformación recopilada:\n${observations}\n\nGenera una respuesta coherente y útil basada en esta información.` }] }],
          { model: "gemini-2.0-flash", maxOutputTokens: 1000, temperature: 0.3 }
        ),
        DEFAULT_LLM_TIMEOUT_MS,
        "geminiChat(generateSummary)"
      );

      return result.content || observations.slice(0, 2000);
    } catch (error) {
      return observations.slice(0, 2000);
    }
  }

  private log(message: string): void {
    this.logStructured("debug", "trace", { run_id: this.runId, message });
  }
}

export const agentRunner = new AgentRunner();

export async function runAgent(objective: string, planHint: string[] = []): Promise<{ success: boolean; result: any; state: AgentState }> {
  const runner = new AgentRunner();
  return runner.run(objective, planHint);
}
