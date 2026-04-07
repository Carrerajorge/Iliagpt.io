import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../toolRegistry";
import { BUNDLED_SKILLS } from "../../data/bundledSkills";
import { skillRegistry } from "../../openclaw/skills/skillRegistry";
import { normalizeOpenClawSkillStatus } from "@shared/skillsRuntime";

type BundledSkillInput = {
  instruction: string;
  data?: unknown;
};

const DIRECT_BRIDGE_SKILLS = new Set([
  "analyze_spreadsheet",
  "web_search",
  "browse_url",
  "generate_document",
  "spawn_subagent",
  "memory_search",
  "math_render",
]);

const ACADEMIC_HINT_RE =
  /\b(academic|academi[ac]|art[ií]culo(?:s)?|paper(?:s)?|scientific|cient[ií]fic|scholar|pubmed|crossref|arxiv|doi|literature|literatura|state of the art|revisi[oó]n bibliogr[aá]fica)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function fail(
  startTime: number,
  code: string,
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): ToolResult {
  return {
    success: false,
    output: null,
    error: { code, message, retryable, details },
    metrics: { durationMs: Date.now() - startTime },
  };
}

function extractUrl(value: string): string | undefined {
  const match = value.match(/https?:\/\/[^\s)]+/i);
  return match?.[0];
}

function normalizeDocumentType(value: unknown): "word" | "excel" | "ppt" | "csv" | "pdf" | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["word", "docx", "document"].includes(normalized)) return "word";
  if (["excel", "xlsx", "spreadsheet", "sheet"].includes(normalized)) return "excel";
  if (["ppt", "pptx", "powerpoint", "slides", "presentation"].includes(normalized)) return "ppt";
  if (normalized === "csv") return "csv";
  if (normalized === "pdf") return "pdf";
  return undefined;
}

function inferDocumentType(instruction: string, data: Record<string, unknown>): "word" | "excel" | "ppt" | "csv" | "pdf" {
  const explicit =
    normalizeDocumentType(data.type) ||
    normalizeDocumentType(data.format) ||
    normalizeDocumentType(data.docType) ||
    normalizeDocumentType(data.documentType) ||
    normalizeDocumentType(data.exportFormat);
  if (explicit) return explicit;

  if (/\b(pdf)\b/i.test(instruction)) return "pdf";
  if (/\b(excel|xlsx|spreadsheet|hoja de c[aá]lculo|hoja de calculo)\b/i.test(instruction)) return "excel";
  if (/\b(powerpoint|pptx|ppt|slides|diapositivas)\b/i.test(instruction)) return "ppt";
  if (/\b(csv)\b/i.test(instruction)) return "csv";
  return "word";
}

function inferTitle(instruction: string, fallback: string): string {
  const firstLine = instruction.split(/\r?\n/, 1)[0]?.trim() || "";
  const cleaned = firstLine
    .replace(/^(crea|crear|genera|generar|haz|hacer|exporta|exportar|renderiza|render|solve|resuelve)\b[:\s-]*/i, "")
    .replace(/\b(word|docx|excel|xlsx|spreadsheet|powerpoint|pptx|ppt|slides|csv|pdf|katex|latex)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 80) || fallback;
}

function buildTabularContent(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map((row) =>
    Array.isArray(row)
      ? row.map((cell) => String(cell ?? "")).join("\t")
      : String(row ?? ""),
  );
  return rows.join("\n");
}

function buildSlidesContent(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const slides = value
    .map((slide, index) => {
      if (typeof slide === "string") {
        return `## Slide ${index + 1}\n${slide.trim()}`;
      }
      if (isRecord(slide)) {
        const title = asString(slide.title) || `Slide ${index + 1}`;
        const bullets = Array.isArray(slide.bullets)
          ? slide.bullets.map((item) => `- ${String(item ?? "").trim()}`).join("\n")
          : "";
        const body =
          asString(slide.content) ||
          asString(slide.body) ||
          bullets ||
          "";
        return `## ${title}\n${body}`.trim();
      }
      return null;
    })
    .filter((slide): slide is string => Boolean(slide && slide.trim().length > 0));
  return slides.length > 0 ? slides.join("\n\n") : null;
}

function resolveDocumentContent(instruction: string, data: Record<string, unknown>, type: "word" | "excel" | "ppt" | "csv" | "pdf"): string {
  for (const key of ["content", "markdown", "body", "text"]) {
    const value = asString(data[key]);
    if (value) return value;
  }

  if ((type === "excel" || type === "csv")) {
    const rows = buildTabularContent(data.rows) || buildTabularContent(data.table) || buildTabularContent(data.data);
    if (rows) return rows;
  }

  if (type === "ppt") {
    const slides = buildSlidesContent(data.slides);
    if (slides) return slides;
  }

  return instruction.trim();
}

function inferAcademicSearch(instruction: string, data: Record<string, unknown>): boolean {
  return (
    asBoolean(data.academic) === true ||
    asStringArray(data.sources).length > 0 ||
    ACADEMIC_HINT_RE.test(instruction)
  );
}

async function executeRegisteredTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const { toolRegistry } = await import("../toolRegistry");
  return toolRegistry.execute(toolName, input, context);
}

async function executeAcademicSearchSkill(
  startTime: number,
  query: string,
  data: Record<string, unknown>,
): Promise<ToolResult> {
  const { searchAllSources } = await import("../../services/unifiedAcademicSearch");

  const maxResults = Math.min(20, Math.max(1, Math.floor(asNumber(data.maxResults) ?? asNumber(data.limit) ?? 8)));
  const requestedSources = asStringArray(data.sources);
  const sources =
    requestedSources.length > 0
      ? requestedSources
      : ["openalex", "semantic", "crossref", "pubmed", "arxiv", "scholar"];

  const result = await searchAllSources(query, {
    maxResults,
    sources: sources as Array<"openalex" | "semantic" | "crossref" | "pubmed" | "arxiv" | "scholar">,
  });

  return {
    success: true,
    output: {
      query: result.query,
      type: "academic",
      totalResults: result.totalResults,
      sources: result.sources,
      expandedQueries: result.expandedQueries,
      results: result.results,
      timing: result.timing,
      metrics: result.metrics,
    },
    metrics: { durationMs: Date.now() - startTime },
  };
}

async function executeWebSearchSkill(
  startTime: number,
  input: BundledSkillInput,
  context: ToolContext,
): Promise<ToolResult> {
  const data = isRecord(input.data) ? input.data : {};
  const query = asString(data.query) || input.instruction.trim();
  if (!query) {
    return fail(startTime, "MISSING_QUERY", "Provide a search query for this skill.");
  }

  if (inferAcademicSearch(query, data)) {
    return executeAcademicSearchSkill(startTime, query, data);
  }

  const maxResults = Math.min(20, Math.max(1, Math.floor(asNumber(data.maxResults) ?? asNumber(data.limit) ?? 8)));
  return executeRegisteredTool("web_search", { query, maxResults, academic: false }, context);
}

async function executeBrowseUrlSkill(
  startTime: number,
  input: BundledSkillInput,
  context: ToolContext,
): Promise<ToolResult> {
  const data = isRecord(input.data) ? input.data : {};
  const url = asString(data.url) || extractUrl(input.instruction);
  if (!url) {
    return fail(startTime, "MISSING_URL", "Provide a valid URL to inspect with this skill.");
  }

  return executeRegisteredTool(
    "browse_url",
    {
      url,
      takeScreenshot: asBoolean(data.takeScreenshot) ?? true,
      sessionId: asString(data.sessionId),
    },
    context,
  );
}

async function executeGenerateDocumentSkill(
  startTime: number,
  input: BundledSkillInput,
  context: ToolContext,
): Promise<ToolResult> {
  const data = isRecord(input.data) ? input.data : {};
  const type = inferDocumentType(input.instruction, data);
  const title = asString(data.title) || inferTitle(input.instruction, `generated_${type}`);
  const content = resolveDocumentContent(input.instruction, data, type);

  if (!content) {
    return fail(startTime, "MISSING_DOCUMENT_CONTENT", "Provide content or structured data for document generation.");
  }

  return executeRegisteredTool("generate_document", { type, title, content }, context);
}

async function executeAnalyzeSpreadsheetSkill(
  startTime: number,
  input: BundledSkillInput,
  context: ToolContext,
): Promise<ToolResult> {
  const data = isRecord(input.data) ? input.data : {};
  const uploadId = asString(data.uploadId) || asString(data.fileId);
  if (!uploadId) {
    return fail(
      startTime,
      "MISSING_UPLOAD_ID",
      "Spreadsheet analysis requires an uploaded file. Pass data.uploadId from a chat attachment.",
      false,
      { acceptedFields: ["uploadId", "fileId"] },
    );
  }

  return executeRegisteredTool(
    "analyze_spreadsheet",
    {
      uploadId,
      scope: asString(data.scope) || "all",
      sheetNames: asStringArray(data.sheetNames),
      analysisMode: asString(data.analysisMode) || "summary",
      userPrompt: asString(data.userPrompt) || input.instruction,
    },
    context,
  );
}

async function executeSpawnSubagentSkill(
  startTime: number,
  input: BundledSkillInput,
  context: ToolContext,
): Promise<ToolResult> {
  const data = isRecord(input.data) ? input.data : {};
  const objective = asString(data.objective) || input.instruction.trim();
  if (!objective) {
    return fail(startTime, "MISSING_OBJECTIVE", "Provide an objective for the subagent.");
  }

  return executeRegisteredTool(
    "openclaw_spawn_subagent",
    {
      objective,
      planHint: asStringArray(data.planHint),
      parentRunId: asString(data.parentRunId),
      chatId: asString(data.chatId),
    },
    context,
  );
}

async function executeMemorySearchSkill(
  startTime: number,
  input: BundledSkillInput,
  context: ToolContext,
): Promise<ToolResult> {
  const data = isRecord(input.data) ? input.data : {};
  const contextMode =
    asString(data.mode) === "context" ||
    asBoolean(data.contextOnly) === true;

  if (contextMode) {
    const message = asString(data.message) || input.instruction.trim();
    if (!message) {
      return fail(startTime, "MISSING_MESSAGE", "Provide a message to build contextual memory.");
    }
    return executeRegisteredTool(
      "openclaw_rag_context",
      { message, currentChatId: asString(data.currentChatId) },
      context,
    );
  }

  const query = asString(data.query) || input.instruction.trim();
  if (!query) {
    return fail(startTime, "MISSING_QUERY", "Provide a query to search memory.");
  }

  return executeRegisteredTool(
    "openclaw_rag_search",
    {
      query,
      limit: Math.min(20, Math.max(1, Math.floor(asNumber(data.limit) ?? 5))),
      minScore: Math.min(1, Math.max(0, asNumber(data.minScore) ?? 0.3)),
      chatId: asString(data.chatId),
    },
    context,
  );
}

function resolveMathExpression(instruction: string, data: Record<string, unknown>): string | undefined {
  const explicit =
    asString(data.expression) ||
    asString(data.latex) ||
    asString(data.formula);
  if (explicit) return explicit;

  const latexDelimited = instruction.match(/\$\$?([\s\S]+?)\$\$?/);
  if (latexDelimited?.[1]) return latexDelimited[1].trim();

  const codeDelimited = instruction.match(/`([^`]+)`/);
  if (codeDelimited?.[1]) return codeDelimited[1].trim();

  const afterKeyword = instruction.match(
    /(?:katex|latex|ecuaci[oó]n|equation|f[oó]rmula|formula|expresi[oó]n|expression|render(?:iza|)|resuelve|solve)\s*[:\-]?\s*(.+)$/i,
  );
  if (afterKeyword?.[1]) {
    return afterKeyword[1].trim().replace(/^["']|["']$/g, "");
  }

  return instruction.trim() || undefined;
}

async function executeMathRenderSkill(
  startTime: number,
  input: BundledSkillInput,
  context: ToolContext,
): Promise<ToolResult> {
  const data = isRecord(input.data) ? input.data : {};
  const expression = resolveMathExpression(input.instruction, data);
  if (!expression) {
    return fail(startTime, "MISSING_EXPRESSION", "Provide a LaTeX/math expression to render.");
  }

  const displayMode =
    asBoolean(data.displayMode) ??
    /\b(display|block|bloque|centrad[ao])\b/i.test(input.instruction);

  const katexModule = await import("katex");
  const renderToString =
    (katexModule as { renderToString?: typeof import("katex").renderToString }).renderToString ||
    (katexModule as { default?: { renderToString?: typeof import("katex").renderToString } }).default?.renderToString;

  if (typeof renderToString !== "function") {
    return fail(startTime, "KATEX_UNAVAILABLE", "KaTeX renderer is not available in this runtime.", true);
  }

  const html = renderToString(expression, {
    displayMode,
    throwOnError: false,
    output: "htmlAndMathml",
    strict: "ignore",
  });
  const markdown = displayMode ? `$$${expression}$$` : `$${expression}$`;

  const exportType = normalizeDocumentType(
    data.exportFormat ?? data.documentType ?? data.type,
  );

  if (exportType) {
    const title = asString(data.title) || inferTitle(input.instruction, "math_render");
    const explanation = asString(data.explanation) || "";
    const exportContent = [explanation, markdown].filter(Boolean).join("\n\n");
    const exportResult = await executeRegisteredTool(
      "generate_document",
      { type: exportType, title, content: exportContent || markdown },
      context,
    );

    if (!exportResult.success) {
      return {
        ...exportResult,
        output: {
          ...(isRecord(exportResult.output) ? exportResult.output : {}),
          latex: expression,
          markdown,
          html,
          displayMode,
        },
        previews: [
          { type: "html", content: html, title: "KaTeX Preview" },
          { type: "markdown", content: markdown, title: "LaTeX" },
          ...(exportResult.previews || []),
        ],
        metrics: { durationMs: Date.now() - startTime },
      };
    }

    return {
      ...exportResult,
      output: {
        ...(isRecord(exportResult.output) ? exportResult.output : {}),
        latex: expression,
        markdown,
        html,
        displayMode,
        exportedType: exportType,
      },
      previews: [
        { type: "html", content: html, title: "KaTeX Preview" },
        { type: "markdown", content: markdown, title: "LaTeX" },
        ...(exportResult.previews || []),
      ],
      metrics: { durationMs: Date.now() - startTime },
    };
  }

  return {
    success: true,
    output: {
      latex: expression,
      markdown,
      html,
      displayMode,
    },
    previews: [
      { type: "html", content: html, title: "KaTeX Preview" },
      { type: "markdown", content: markdown, title: "LaTeX" },
    ],
    metrics: { durationMs: Date.now() - startTime },
  };
}

async function executeBridgedSkill(
  skillId: string,
  input: BundledSkillInput,
  context: ToolContext,
  startTime: number,
): Promise<ToolResult> {
  switch (skillId) {
    case "web_search":
      return executeWebSearchSkill(startTime, input, context);
    case "browse_url":
      return executeBrowseUrlSkill(startTime, input, context);
    case "generate_document":
      return executeGenerateDocumentSkill(startTime, input, context);
    case "analyze_spreadsheet":
      return executeAnalyzeSpreadsheetSkill(startTime, input, context);
    case "spawn_subagent":
      return executeSpawnSubagentSkill(startTime, input, context);
    case "memory_search":
      return executeMemorySearchSkill(startTime, input, context);
    case "math_render":
      return executeMathRenderSkill(startTime, input, context);
    default:
      return fail(startTime, "SKILL_BRIDGE_NOT_IMPLEMENTED", `No execution bridge is registered for ${skillId}.`);
  }
}

export const BUNDLED_SKILL_TOOLS: ToolDefinition[] = BUNDLED_SKILLS.map((skill) => {
  const safeName = skill.id.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 60);

  return {
    name: `skill_${safeName}`,
    description: `Execute the '${skill.name}' skill. Category: ${skill.category}. ${skill.description}`,
    inputSchema: z.object({
      instruction: z
        .string()
        .describe("Specific instructions or goals for this skill. What do you want it to accomplish?"),
      data: z
        .any()
        .optional()
        .describe("Optional structured data or parameters required for the skill execution."),
    }),
    capabilities: ["executes_code", "requires_network"],
    execute: async (input: BundledSkillInput, context: ToolContext): Promise<ToolResult> => {
      const startTime = Date.now();

      try {
        const runtimeSkill = skillRegistry.get(skill.id);
        const runtimeStatus = runtimeSkill
          ? normalizeOpenClawSkillStatus(runtimeSkill.status)
          : DIRECT_BRIDGE_SKILLS.has(skill.id)
            ? "ready"
            : "catalog_only";

        if (runtimeSkill && runtimeStatus !== "ready") {
          return fail(
            startTime,
            "SKILL_NOT_READY",
            `La skill ${skill.name} existe en runtime, pero su estado actual es ${runtimeStatus}.`,
            false,
            {
              skillId: skill.id,
              status: runtimeStatus,
              source: runtimeSkill.source || "builtin",
            },
          );
        }

        if (DIRECT_BRIDGE_SKILLS.has(skill.id)) {
          return executeBridgedSkill(skill.id, input, context, startTime);
        }

        if (!runtimeSkill) {
          return fail(
            startTime,
            "SKILL_CATALOG_ONLY",
            `La skill ${skill.name} está listada en el catálogo, pero no tiene un runtime ejecutable activo.`,
            false,
            {
              skillId: skill.id,
              reason: "runtime_missing",
            },
          );
        }

        return fail(
          startTime,
          "SKILL_BRIDGE_NOT_IMPLEMENTED",
          `La skill ${skill.name} está registrada en OpenClaw, pero este bridge aún no tiene una ruta de ejecución nativa segura.`,
          false,
          {
            skillId: skill.id,
            status: runtimeStatus,
            source: runtimeSkill.source || "builtin",
            requestedInstruction: input.instruction,
            hasStructuredData: input.data !== undefined,
          },
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(startTime, "SKILL_EXECUTION_ERROR", `Failed to execute skill ${skill.name}: ${message}`, true);
      }
    },
  };
});
