import { WebSocketServer, WebSocket } from "ws";
import { randomUUID, createHmac } from "crypto";
import type { Server as HttpServer } from "http";
import fs from "fs";
import path from "path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { llmGateway } from "../lib/llmGateway";
import { usageQuotaService } from "./usageQuotaService";
import { internetToolDefinitions, executeInternetTool } from "../openclaw/lib/internetAccess";
import { gatherInternetContext, buildInternetSystemPrompt } from "../openclaw/lib/chatInternetBridge";
import { skillRegistry } from "../openclaw/skills/skillRegistry";
import {
  classifyOutputFormat,
  hasExplicitDocumentArtifactRequest,
  hasExplicitPresentationArtifactRequest,
  hasExplicitSpreadsheetArtifactRequest,
} from "@shared/explicitArtifactRequests";

const VERSION = "2026.4.9";

function getWorkspaceRoot(): string {
  return process.env.OPENCLAW_WORKSPACE_ROOT || path.join(process.cwd(), "openclaw-workspaces");
}
const TOKEN_SECRET = process.env.ENCRYPTION_KEY || randomUUID();

const LOCAL_MODEL_BASE_URL = process.env.LOCAL_MODEL_URL || "http://localhost:5000";

async function* streamFromLocalModel(
  messages: ChatCompletionMessageParam[],
  opts: { maxTokens?: number; temperature?: number }
): AsyncGenerator<{ content?: string; done?: boolean }> {
  const url = `${LOCAL_MODEL_BASE_URL}/v1/chat/completions`;
  console.log(`[OpenClaw Gateway] Routing to local model at ${url}`);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: opts.maxTokens || 4096,
        temperature: opts.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error");
      yield { content: `Error del modelo local (${resp.status}): ${errText}`, done: true };
      return;
    }

    const reader = resp.body?.getReader();
    if (!reader) {
      yield { content: "Error: no se pudo leer la respuesta del modelo local", done: true };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          yield { done: true };
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            yield { content: delta };
          }
          if (parsed.choices?.[0]?.finish_reason) {
            yield { done: true };
            return;
          }
        } catch {}
      }
    }
    yield { done: true };
  } catch (err: any) {
    console.error(`[OpenClaw Gateway] Local model error:`, err?.message);
    yield { content: `Error conectando al modelo local: ${err?.message || "conexión rechazada"}`, done: true };
  }
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface GatewayClient {
  connId: string;
  ws: WebSocket;
  authenticated: boolean;
  clientName?: string;
  role?: string;
  userId?: string;
  chatHistory: ChatMessage[];
  activeRuns: Set<string>;
}

const clients = new Map<string, GatewayClient>();

const sessionModelOverrides = new Map<string, { model: string; provider: string }>();

const PROVIDER_MAP: Record<string, "openai" | "gemini" | "xai" | "anthropic" | "deepseek" | "cerebras"> = {
  openrouter: "openai",
  openai: "openai",
  local: "openai",
  gemini: "gemini",
  xai: "xai",
  anthropic: "anthropic",
  deepseek: "deepseek",
  cerebras: "cerebras",
};

const tokenToUserMap = new Map<string, string>();

type GatewayDocumentType = "word" | "excel" | "ppt" | "csv" | "pdf";

interface OpenClawDirectCapabilityResponse {
  kind: "document" | "academic" | "math";
  content: string;
}

const BLANK_ARTIFACT_RE = /\b(blank|vac[ií]o|vac[ií]a|empty|en blanco)\b/i;
const SEARCH_VERB_RE = /\b(busca(?:r)?|search|find|encuentra(?:r)?|lookup|investiga(?:r)?|research)\b/i;
const ACADEMIC_HINT_RE =
  /\b(art[ií]culo(?:s)?\s+cient[ií]fico(?:s)?|paper(?:s)?|academic|academi[ac]|scholar|pubmed|crossref|arxiv|doi|literature|literatura|revisi[oó]n bibliogr[aá]fica|estado del arte|state of the art)\b/i;
const MATH_RENDER_HINT_RE = /\b(katex|latex|ecuaci[oó]n|equation|f[oó]rmula|formula|render(?:iza|izar)?|typeset)\b/i;

function normalizeGatewayMessage(message: string): string {
  return String(message || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function inferGatewayDocumentType(message: string): GatewayDocumentType | null {
  const normalized = normalizeGatewayMessage(message);
  const hasExplicitArtifactIntent =
    hasExplicitSpreadsheetArtifactRequest(normalized) ||
    hasExplicitDocumentArtifactRequest(normalized) ||
    hasExplicitPresentationArtifactRequest(normalized);

  if (!hasExplicitArtifactIntent) {
    return null;
  }

  const classification = classifyOutputFormat(normalized);

  if (/\b(pdf|\.pdf)\b/i.test(normalized)) return "pdf";
  if (/\b(csv|\.csv)\b/i.test(normalized)) return "csv";
  if (classification.action === "excel") return "excel";
  if (classification.action === "pptx") return "ppt";
  if (classification.action === "word") return "word";
  return null;
}

function inferGatewayDocumentTitle(message: string, type: GatewayDocumentType): string {
  const fallbackTitles: Record<GatewayDocumentType, string> = {
    word: "documento",
    excel: "excel",
    ppt: "presentacion",
    csv: "datos",
    pdf: "documento_pdf",
  };

  const normalized = normalizeGatewayMessage(message)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^(?:puedes|podr[ií]as|podrias|can you|please)\s+/i, "")
    .replace(/\b(crea(?:r)?|genera(?:r)?|generate|haz(?:me)?|make|prepara(?:r)?|prepare|exporta(?:r)?|export|build)\b/gi, " ")
    .replace(/\b(word|docx|documento|document|pdf|excel|xlsx|csv|spreadsheet|hoja(?:s)? de c[aá]lculo|hoja(?:s)? de calculo|powerpoint|pptx|ppt|slides|diapositivas)\b/gi, " ")
    .replace(BLANK_ARTIFACT_RE, " ")
    .replace(/\b(archivo|file|formato|un|una|el|la|los|las|a|an|the)\b/gi, " ")
    .replace(/\b(con|with|sobre|about)\b[\s\S]*$/i, " ")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized) {
    return normalized.slice(0, 80);
  }

  if (BLANK_ARTIFACT_RE.test(message)) {
    return `${fallbackTitles[type]}_vacio`;
  }

  return fallbackTitles[type];
}

function resolveMathExpressionFromMessage(message: string): string | undefined {
  const latexDelimited = message.match(/\$\$?([\s\S]+?)\$\$?/);
  if (latexDelimited?.[1]) return latexDelimited[1].trim();

  const codeDelimited = message.match(/`([^`]+)`/);
  if (codeDelimited?.[1]) return codeDelimited[1].trim();

  const afterKeyword = message.match(
    /(?:katex|latex|ecuaci[oó]n|equation|f[oó]rmula|formula|render(?:iza|izar)?|typeset)\s*[:\-]?\s*(.+)$/i,
  );
  if (afterKeyword?.[1]) {
    return afterKeyword[1]
      .trim()
      .replace(/^["'“”]|["'“”]$/g, "")
      .replace(/^(?:en\s+)?(?:katex|latex)\s*[:\-]\s*/i, "")
      .trim();
  }

  return undefined;
}

function extractDocumentContent(message: string, type: GatewayDocumentType): string {
  if (BLANK_ARTIFACT_RE.test(message)) {
    return "";
  }

  const codeBlock = message.match(/```(?:[\w-]+)?\n([\s\S]+?)```/);
  if (codeBlock?.[1]?.trim()) {
    return codeBlock[1].trim();
  }

  const labeledTail = message.match(
    /(?:contenido|content|texto|text|datos|data|tabla|table|diapositivas|slides|resumen|summary)\s*:\s*([\s\S]+)$/i,
  );
  if (labeledTail?.[1]?.trim()) {
    return labeledTail[1].trim();
  }

  const mathExpression = resolveMathExpressionFromMessage(message);
  if (mathExpression && MATH_RENDER_HINT_RE.test(message)) {
    return `$$${mathExpression}$$`;
  }

  if (type === "excel" || type === "csv" || type === "ppt") {
    return "";
  }

  const stripped = normalizeGatewayMessage(message)
    .replace(/^(?:puedes|podr[ií]as|podrias|can you|please)\s*/i, "")
    .replace(/^(?:crear|crea|genera|generate|make|haz(?:me)?|prepara|prepare|exporta|export)\b[:\s-]*/i, "")
    .trim();

  return stripped === normalizeGatewayMessage(message) ? "" : stripped;
}

function isAcademicSearchRequest(message: string): boolean {
  const normalized = normalizeGatewayMessage(message);
  return ACADEMIC_HINT_RE.test(normalized) && (SEARCH_VERB_RE.test(normalized) || /\b(sobre|about)\b/i.test(normalized));
}

function isMathRenderRequest(message: string): boolean {
  const normalized = normalizeGatewayMessage(message);
  return MATH_RENDER_HINT_RE.test(normalized) || /\$\$?[\s\S]+?\$\$?/.test(normalized);
}

function formatDocumentResponse(
  type: GatewayDocumentType,
  title: string,
  output: unknown,
): OpenClawDirectCapabilityResponse {
  const payload = isRecord(output) ? output : {};
  const filename = asString(payload.filename) || `${title}.${type === "ppt" ? "pptx" : type}`;
  const downloadUrl = asString(payload.downloadUrl);
  const labels: Record<GatewayDocumentType, string> = {
    word: "Word",
    excel: "Excel",
    ppt: "PowerPoint",
    csv: "CSV",
    pdf: "PDF",
  };

  const parts = [`Listo. Creé el archivo ${labels[type]}.`];
  if (downloadUrl) {
    parts.push(`[Descargar ${filename}](${downloadUrl})`);
  } else {
    parts.push(`Archivo generado: \`${filename}\`.`);
  }

  return {
    kind: "document",
    content: parts.join("\n\n"),
  };
}

function formatAcademicSearchResponse(result: {
  query: string;
  originalQuery?: string;
  totalResults: number;
  results: Array<{
    title?: string;
    authors?: string;
    year?: string | number;
    journal?: string;
    doi?: string;
    url?: string;
    pdfUrl?: string;
    source?: string;
  }>;
}): OpenClawDirectCapabilityResponse {
  const query = result.originalQuery || result.query;
  const topResults = Array.isArray(result.results) ? result.results.slice(0, 5) : [];

  if (topResults.length === 0) {
    return {
      kind: "academic",
      content: `No encontré artículos científicos para: "${query}".`,
    };
  }

  const lines = topResults.map((paper, index) => {
    const title = paper.title?.trim() || `Resultado ${index + 1}`;
    const url = paper.url || paper.pdfUrl || "";
    const authors = paper.authors?.trim();
    const year = String(paper.year || "").trim();
    const journal = paper.journal?.trim();
    const source = paper.source ? String(paper.source).toUpperCase() : "";
    const meta = [authors, year, journal, source].filter(Boolean).join(" | ");
    const doi = paper.doi ? ` DOI: ${paper.doi}` : "";
    const titleLine = url ? `${index + 1}. [${title}](${url})` : `${index + 1}. ${title}`;
    return [titleLine, meta, doi].filter(Boolean).join("\n");
  });

  return {
    kind: "academic",
    content: `Encontré ${result.totalResults} artículos científicos para "${query}".\n\n${lines.join("\n\n")}`,
  };
}

export async function resolveOpenClawDirectCapabilityResponse(params: {
  message: string;
  userId: string;
  chatId: string;
  runId: string;
}): Promise<OpenClawDirectCapabilityResponse | null> {
  const message = normalizeGatewayMessage(params.message);
  if (!message) return null;
  const toolUserId =
    !params.userId ||
    params.userId === "openclaw-user" ||
    params.userId.startsWith("token:")
      ? "anonymous"
      : params.userId;

  const documentType = inferGatewayDocumentType(message);
  if (documentType) {
    const { toolRegistry } = await import("../agent/toolRegistry");
    const title = inferGatewayDocumentTitle(message, documentType);
    const content = extractDocumentContent(message, documentType);
    const result = await toolRegistry.execute(
      "generate_document",
      {
        type: documentType,
        title,
        content,
      },
      {
        userId: toolUserId,
        chatId: params.chatId,
        runId: params.runId,
      },
    );

    if (!result.success) {
      const errorMessage =
        (isRecord(result.error) && asString(result.error.message)) ||
        "No pude generar el archivo solicitado.";
      return {
        kind: "document",
        content: errorMessage,
      };
    }

    return formatDocumentResponse(documentType, title, result.output);
  }

  if (isAcademicSearchRequest(message)) {
    const { searchAllSources } = await import("./unifiedAcademicSearch");
    const result = await searchAllSources(message, {
      maxResults: 8,
      sources: ["openalex", "semantic", "crossref", "pubmed", "arxiv", "scholar"],
    });
    return formatAcademicSearchResponse(result);
  }

  if (isMathRenderRequest(message)) {
    const expression = resolveMathExpressionFromMessage(message);
    if (!expression) {
      return {
        kind: "math",
        content: "Pásame la expresión matemática en LaTeX/KaTeX y la renderizo.",
      };
    }

    const katexModule = await import("katex");
    const renderToString =
      (katexModule as { renderToString?: typeof import("katex").renderToString }).renderToString ||
      (katexModule as { default?: { renderToString?: typeof import("katex").renderToString } }).default?.renderToString;

    if (typeof renderToString === "function") {
      renderToString(expression, {
        displayMode: true,
        throwOnError: false,
        output: "htmlAndMathml",
        strict: "ignore",
      });
    }

    return {
      kind: "math",
      content: `Listo. Aquí está en KaTeX/LaTeX:\n\n$$${expression}$$`,
    };
  }

  return null;
}

export function generateGatewayToken(userId: string): string {
  const hmac = createHmac("sha256", TOKEN_SECRET);
  hmac.update(`openclaw-gateway:${userId}`);
  const token = hmac.digest("hex").slice(0, 32);
  tokenToUserMap.set(token, userId);
  return token;
}

export function resolveUserIdFromToken(token: string): string | null {
  return tokenToUserMap.get(token) || null;
}

function send(ws: WebSocket, obj: any) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  } catch {}
}

function reply(ws: WebSocket, id: number | string, payload: any) {
  send(ws, { type: "res", id, ok: true, payload });
}

function replyError(ws: WebSocket, id: number | string, code: string | number, message: string) {
  send(ws, { type: "res", id, ok: false, error: { code: String(code), message } });
}

function handleMethod(client: GatewayClient, id: number | string, method: string, params: any) {
  const ws = client.ws;

  switch (method) {
    case "connect":
      client.authenticated = true;
      client.clientName = params?.client?.name || "control-ui";
      client.role = params?.client?.role || "control";
      if (params?.auth?.authToken) {
        const resolvedUserId = resolveUserIdFromToken(params.auth.authToken);
        client.userId = resolvedUserId || `token:${params.auth.authToken.slice(0, 8)}`;
      }
      console.log(`[OpenClaw Gateway] Client authenticated: ${client.clientName} (role=${client.role})`);
      reply(ws, id, {
        version: VERSION,
        gatewayId: "iliagpt-gateway",
        features: ["chat", "agents", "sessions", "cron", "channels", "skills", "nodes", "config", "internet", "web-fetch", "web-search"],
        auth: { mode: "token", accepted: true, role: client.role, scopes: ["operator.read", "operator.write"] },
        presence: [],
      });
      send(ws, {
        type: "event",
        event: "connected",
        payload: {
          version: VERSION,
          gatewayId: "iliagpt-gateway",
          connId: client.connId,
        },
      });
      break;

    case "status":
      reply(ws, id, {
        version: VERSION,
        uptime: Math.floor(process.uptime()),
        platform: "iliagpt",
        gatewayId: "iliagpt-gateway",
        connections: clients.size,
        agents: 1,
        sessions: 0,
        channels: {},
      });
      break;

    case "health":
      reply(ws, id, {
        ok: true,
        version: VERSION,
        uptime: Math.floor(process.uptime()),
        memory: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        },
      });
      break;

    case "last-heartbeat":
      reply(ws, id, { ts: Date.now() });
      break;

    case "system-presence":
      reply(ws, id, { presences: [], version: 1 });
      break;

    case "config.get":
      reply(ws, id, {
        models: {
          default: { provider: "openrouter", model: "google/gemma-4-31b-it" },
          providers: {
            openrouter: { enabled: true },
            local: { enabled: true },
            gemini: { enabled: false },
            openai: { enabled: false },
            xai: { enabled: false },
            anthropic: { enabled: false },
          },
        },
        agents: { default: { id: "main" } },
        gateway: { port: 18789, auth: { mode: "none" } },
      });
      break;

    case "config.schema":
      reply(ws, id, { schema: {} });
      break;

    case "config.set":
    case "config.apply": {
      const rawConfig = params?.raw || params?.config || "";
      const sessionKeyForConfig = params?.sessionKey || "main";
      if (typeof rawConfig === "string" && rawConfig.includes("model")) {
        try {
          const parsed = typeof rawConfig === "string" ? JSON.parse(rawConfig) : rawConfig;
          if (parsed?.model?.model) {
            const providerForModel = parsed.model.provider || "openrouter";
            sessionModelOverrides.set(sessionKeyForConfig, {
              model: parsed.model.model,
              provider: providerForModel,
            });
            console.log(`[OpenClaw Gateway] Model override set for session ${sessionKeyForConfig}: ${parsed.model.model} (${providerForModel})`);
          }
        } catch {}
      }
      reply(ws, id, { ok: true });
      break;
    }

    case "config.openFile":
      reply(ws, id, { ok: true });
      break;

    case "channels.status":
      reply(ws, id, {
        channels: {},
        summary: { total: 0, connected: 0, disconnected: 0 },
      });
      break;

    case "channels.logout":
      reply(ws, id, { ok: true });
      break;

    case "models.list":
      reply(ws, id, {
        models: [
          { id: "google/gemma-4-31b-it", provider: "openrouter", name: "Gemma 4 31B IT", available: true },
          { id: "local-5000", provider: "local", name: "Local Model (localhost:5000)", available: true },
        ],
        default: { provider: "openrouter", model: "google/gemma-4-31b-it" },
      });
      break;

    case "agents.list":
      reply(ws, id, {
        agents: [
          { id: "main", name: "main", description: "Agente principal de IliaGPT", status: "active" },
        ],
      });
      break;

    case "agent.identity.get":
      reply(ws, id, {
        id: params?.agentId || "main",
        name: "main",
        description: "Agente principal de IliaGPT",
        avatar: null,
      });
      break;

    case "agents.files.list": {
      const filesDir = path.join(getWorkspaceRoot(), client.userId || "default", "files");
      try {
        if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });
        const entries = fs.readdirSync(filesDir).map((name) => {
          const stat = fs.statSync(path.join(filesDir, name));
          return { name, size: stat.size, modified: stat.mtime.toISOString() };
        });
        reply(ws, id, { files: entries });
      } catch {
        reply(ws, id, { files: [] });
      }
      break;
    }

    case "agents.files.get": {
      const fileName = params?.name || params?.path;
      if (!fileName) { replyError(ws, id, -32602, "Missing file name"); break; }
      const safeName = path.basename(fileName); // prevent path traversal
      const filePath = path.join(getWorkspaceRoot(), client.userId || "default", "files", safeName);
      try {
        if (!fs.existsSync(filePath)) { replyError(ws, id, -32601, "File not found"); break; }
        const data = fs.readFileSync(filePath);
        const base64 = data.toString("base64");
        const stat = fs.statSync(filePath);
        reply(ws, id, { name: safeName, size: stat.size, data: base64, encoding: "base64" });
      } catch (e: any) {
        replyError(ws, id, -32603, e.message || "Failed to read file");
      }
      break;
    }

    case "agents.files.set": {
      const setName = params?.name || params?.path;
      if (!setName) { replyError(ws, id, -32602, "Missing file name"); break; }
      const safeSetName = path.basename(setName);
      const setDir = path.join(getWorkspaceRoot(), client.userId || "default", "files");
      try {
        if (!fs.existsSync(setDir)) fs.mkdirSync(setDir, { recursive: true });
        const setPath = path.join(setDir, safeSetName);
        if (params?.data) {
          const encoding = params?.encoding === "base64" ? "base64" : "utf-8";
          fs.writeFileSync(setPath, Buffer.from(params.data, encoding));
        } else if (params?.content) {
          fs.writeFileSync(setPath, params.content, "utf-8");
        }
        const stat = fs.statSync(setPath);
        console.log(`[OpenClaw Gateway] File saved: ${safeSetName} (${stat.size} bytes) for user ${client.userId}`);
        reply(ws, id, { ok: true, name: safeSetName, size: stat.size });
      } catch (e: any) {
        replyError(ws, id, -32603, e.message || "Failed to write file");
      }
      break;
    }

    case "agents.files.delete": {
      const delName = params?.name || params?.path;
      if (!delName) { replyError(ws, id, -32602, "Missing file name"); break; }
      const safeDelName = path.basename(delName);
      const delPath = path.join(getWorkspaceRoot(), client.userId || "default", "files", safeDelName);
      try {
        if (fs.existsSync(delPath)) fs.unlinkSync(delPath);
        reply(ws, id, { ok: true });
      } catch (e: any) {
        replyError(ws, id, -32603, e.message || "Failed to delete file");
      }
      break;
    }

    case "sessions.list": {
      const mainOverride = sessionModelOverrides.get("main");
      reply(ws, id, {
        sessions: [
          {
            key: "main",
            agentId: "main",
            label: "main",
            status: "idle",
            model: mainOverride?.model || "google/gemma-4-31b-it",
            provider: mainOverride?.provider || "openrouter",
            createdAt: Date.now() - 60000,
            updatedAt: Date.now(),
          },
        ],
        defaults: {
          model: "google/gemma-4-31b-it",
          provider: "openrouter",
          agentId: "main",
        },
      });
      break;
    }

    case "sessions.subscribe":
      reply(ws, id, { ok: true });
      break;

    case "sessions.usage":
      reply(ws, id, {
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        sessions: [],
      });
      break;

    case "sessions.usage.logs":
      reply(ws, id, { logs: [] });
      break;

    case "sessions.usage.timeseries":
      reply(ws, id, { points: [] });
      break;

    case "sessions.delete":
    case "sessions.reset":
    case "sessions.compact":
      reply(ws, id, { ok: true });
      break;

    case "sessions.patch": {
      const patchKey = params?.key || params?.sessionKey || "main";
      if (params?.model) {
        const modelId = params.model.trim();
        const modelsList = [
          { id: "google/gemma-4-31b-it", provider: "openrouter" },
          { id: "local-5000", provider: "local" },
        ];
        const found = modelsList.find(m => m.id === modelId);
        const patchProvider = params.provider || found?.provider || (modelId.includes("/") ? "openrouter" : "openai");
        sessionModelOverrides.set(patchKey, { model: modelId, provider: patchProvider });
        console.log(`[OpenClaw Gateway] sessions.patch model override: ${patchKey} -> ${modelId} (${patchProvider})`);
      }
      reply(ws, id, {
        ok: true,
        resolved: {
          model: params?.model || sessionModelOverrides.get(patchKey)?.model || "google/gemma-4-31b-it",
          modelProvider: params?.provider || sessionModelOverrides.get(patchKey)?.provider || "openrouter",
        },
      });
      break;
    }

    case "sessions.steer":
      reply(ws, id, { ok: true });
      break;

    case "tools.catalog":
    case "tools.effective":
      reply(ws, id, {
        tools: internetToolDefinitions.map((t) => ({
          ...t,
          enabled: true,
          source: "openclaw-internet",
        })),
      });
      break;

    case "tools.execute": {
      if (!client.authenticated) {
        replyError(ws, id, "UNAUTHORIZED", "Authentication required for tool execution");
        break;
      }
      const toolId = params?.toolId || params?.id || "";
      const toolParams = params?.params || params?.arguments || {};
      const toolRunId = params?.runId || randomUUID();

      send(ws, {
        type: "event",
        event: "tool.status",
        payload: { toolId, runId: toolRunId, state: "running" },
      });

      executeInternetTool(toolId, toolParams)
        .then((result) => {
          reply(ws, id, { ok: result.ok, runId: toolRunId, ...result });
          send(ws, {
            type: "event",
            event: "tool.status",
            payload: { toolId, runId: toolRunId, state: "done", ok: result.ok },
          });
        })
        .catch((err: any) => {
          replyError(ws, id, "TOOL_ERROR", err?.message || "Tool execution failed");
          send(ws, {
            type: "event",
            event: "tool.status",
            payload: { toolId, runId: toolRunId, state: "error", error: err?.message },
          });
        });
      break;
    }

    case "skills.status": {
      const allSkills = skillRegistry.list();
      const skillEntries = allSkills.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        status: s.status || 'ready',
        source: s.source || 'builtin',
        tools: s.tools || [],
      }));
      reply(ws, id, {
        skills: skillEntries,
        installed: skillEntries.filter(s => s.status === 'ready').map(s => s.id),
        total: skillEntries.length,
        ready: skillEntries.filter(s => s.status === 'ready').length,
        needsSetup: skillEntries.filter(s => s.status === 'needs_setup').length,
      });
      break;
    }

    case "skills.install":
    case "skills.update":
      reply(ws, id, { ok: true });
      break;

    case "cron.list":
      reply(ws, id, { jobs: [] });
      break;

    case "cron.status":
      reply(ws, id, { running: false, jobs: 0 });
      break;

    case "cron.runs":
      reply(ws, id, { runs: [] });
      break;

    case "cron.add":
    case "cron.remove":
    case "cron.update":
    case "cron.run":
      reply(ws, id, { ok: true });
      break;

    case "node.list":
      reply(ws, id, { nodes: [] });
      break;

    case "device.pair.list":
      reply(ws, id, { devices: [] });
      break;

    case "device.pair.approve":
    case "device.pair.reject":
    case "device.token.revoke":
    case "device.token.rotate":
      reply(ws, id, { ok: true });
      break;

    case "logs.tail":
      reply(ws, id, { lines: [] });
      break;

    case "usage.cost":
      reply(ws, id, { totalCost: 0, breakdown: [] });
      break;

    case "update.run":
      reply(ws, id, { ok: true, version: VERSION, updated: true, features: ["internet-access"] });
      break;

    case "web.login.start":
      reply(ws, id, { ok: true, url: "/", token: randomUUID() });
      break;

    case "web.login.wait":
      reply(ws, id, { ok: true });
      break;

    case "chat.history":
      reply(ws, id, {
        messages: client.chatHistory.map((m, i) => ({
          id: `msg-${i}`,
          role: m.role,
          content: m.content,
          timestamp: Date.now(),
        })),
      });
      break;

    case "chat.send": {
      let userMessage = params?.message || params?.content || "";
      const chatSessionKey = params?.sessionKey || "main";
      const runId = params?.idempotencyKey || randomUUID();

      console.log(`[OpenClaw Gateway] chat.send params:`, JSON.stringify(params, null, 0)?.slice(0, 500));

      const sessionOverride = sessionModelOverrides.get(chatSessionKey);
      const selectedModel = params?.model || sessionOverride?.model || "google/gemma-4-31b-it";
      const selectedProvider = params?.provider || sessionOverride?.provider || "openrouter";

      // ── Process attachments: save to workspace + extract text for LLM context ──
      // The Control UI sends: { id, dataUrl: "data:mime;base64,...", mimeType, fileName }
      const rawAttachments: Array<any> = params?.attachments || [];
      const attachmentContextParts: string[] = [];

      if (rawAttachments.length > 0) {
        const userDir = path.join(getWorkspaceRoot(), client.userId || "default", "files");
        if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

        for (const att of rawAttachments) {
          const rawName = att.fileName || att.name || att.filename || `file-${Date.now()}`;
          const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._\-]/g, "_");
          const filePath = path.join(userDir, safeName);
          try {
            // Handle dataUrl format from Control UI: "data:application/pdf;base64,..."
            if (att.dataUrl && typeof att.dataUrl === "string" && att.dataUrl.startsWith("data:")) {
              const commaIdx = att.dataUrl.indexOf(",");
              if (commaIdx > 0) {
                fs.writeFileSync(filePath, Buffer.from(att.dataUrl.slice(commaIdx + 1), "base64"));
              }
            } else if (att.data) {
              fs.writeFileSync(filePath, Buffer.from(att.data, att.encoding === "base64" ? "base64" : "utf-8"));
            } else if (att.content) {
              fs.writeFileSync(filePath, att.content, "utf-8");
            }
            console.log(`[OpenClaw Gateway] Attachment saved: ${safeName} (${att.mimeType || "unknown"}) for user ${client.userId}`);

            // Extract text content for LLM context
            const buf = fs.readFileSync(filePath);
            const mime = att.mimeType || "";
            let extractedText = "";

            if (mime.includes("text") || safeName.endsWith(".csv") || safeName.endsWith(".txt") || safeName.endsWith(".md") || safeName.endsWith(".json")) {
              extractedText = buf.toString("utf-8").slice(0, 50000);
            } else if (safeName.endsWith(".xlsx") || safeName.endsWith(".xls")) {
              try {
                const XLSX = require("xlsx");
                const wb = XLSX.read(buf, { type: "buffer" });
                extractedText = wb.SheetNames.map((name: string) => {
                  const sheet = wb.Sheets[name];
                  return `[Hoja: ${name}]\n${XLSX.utils.sheet_to_csv(sheet)}`;
                }).join("\n\n").slice(0, 50000);
              } catch { extractedText = `[Archivo Excel: ${safeName} — no se pudo leer]`; }
            } else if (safeName.endsWith(".docx") || safeName.endsWith(".doc")) {
              extractedText = `[Documento Word guardado: ${safeName}, ${buf.length} bytes. Usa la herramienta de análisis de documentos para procesarlo en detalle.]`;
            } else {
              extractedText = `[Archivo binario: ${safeName}, ${buf.length} bytes, tipo: ${mime || "desconocido"}]`;
            }

            attachmentContextParts.push(`--- DOCUMENTO ADJUNTO: ${safeName} ---\n${extractedText}\n--- FIN: ${safeName} ---`);
          } catch (err: any) {
            console.error(`[OpenClaw Gateway] Failed to process attachment ${safeName}:`, err.message);
          }
        }
      }

      // Prepend attachment context to the user message
      if (attachmentContextParts.length > 0) {
        const attachmentContext = attachmentContextParts.join("\n\n");
        userMessage = `${userMessage}\n\n[DOCUMENTOS ADJUNTOS - Analiza el contenido de estos archivos para responder]\n${attachmentContext}`;
      }

      if (!userMessage.trim() && rawAttachments.length === 0) {
        replyError(ws, id, "EMPTY_MESSAGE", "Message cannot be empty");
        break;
      }

      reply(ws, id, { ok: true, runId, attachments: rawAttachments.length });

      client.chatHistory.push({ role: "user", content: userMessage });
      client.activeRuns.add(runId);

      const mappedProvider = PROVIDER_MAP[selectedProvider] || "openai";

      (async () => {
        let fullResponse = "";

        send(ws, {
          type: "event",
          event: "chat",
          payload: {
            sessionKey: chatSessionKey,
            runId,
            state: "delta",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "" }],
              meta: { status: "searching" },
            },
          },
        });

        try {
          const directResponse = await resolveOpenClawDirectCapabilityResponse({
            message: userMessage,
            userId: client.userId || "openclaw-user",
            chatId: chatSessionKey,
            runId,
          });

          if (directResponse) {
            fullResponse = directResponse.content;
            client.chatHistory.push({ role: "assistant", content: fullResponse });

            if (client.chatHistory.length > 60) {
              client.chatHistory.splice(1, client.chatHistory.length - 40);
            }

            const estimatedTokens = Math.ceil(fullResponse.length / 4) + Math.ceil(userMessage.length / 4);
            usageQuotaService.recordOpenClawTokenUsage(client.userId || "", estimatedTokens).catch(() => {});

            if (client.activeRuns.has(runId)) {
              send(ws, {
                type: "event",
                event: "chat",
                payload: {
                  sessionKey: chatSessionKey,
                  runId,
                  state: "final",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: fullResponse }],
                    timestamp: Date.now(),
                  },
                },
              });
            }
            return;
          }
        } catch (err: any) {
          console.error(`[OpenClaw Gateway] direct capability error:`, err?.message || err);
        }

        let internetContext = null;
        try {
          internetContext = await gatherInternetContext(userMessage);
          if (internetContext) {
            console.log(`[OpenClaw Gateway] Internet context gathered: search=${!!internetContext.searchResults} fetch=${internetContext.fetchResults?.length || 0}`);
          }
        } catch (e: any) {
          console.warn(`[OpenClaw Gateway] Internet context error:`, e?.message);
        }

        const systemPrompt = buildInternetSystemPrompt(internetContext);

        const llmMessages: ChatCompletionMessageParam[] = [
          { role: "system" as const, content: systemPrompt },
          ...client.chatHistory.map((m) => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          })),
        ];

        try {
          console.log(`[OpenClaw Gateway] chat.send: model=${selectedModel}, provider=${selectedProvider}, mapped=${mappedProvider}, historyLen=${client.chatHistory.length}`);

          const isLocalModel = selectedProvider === "local" || selectedModel === "local-5000";

          const stream = isLocalModel
            ? streamFromLocalModel(llmMessages, { maxTokens: 4096, temperature: 0.7 })
            : llmGateway.streamChat(llmMessages, {
                model: selectedModel,
                provider: mappedProvider,
                userId: client.userId || "openclaw-user",
                requestId: runId,
                maxTokens: 4096,
                temperature: 0.7,
              });

          for await (const chunk of stream) {
            if (!client.activeRuns.has(runId)) {
              console.log(`[OpenClaw Gateway] Run ${runId} was aborted`);
              send(ws, {
                type: "event",
                event: "chat",
                payload: {
                  sessionKey: chatSessionKey,
                  runId,
                  state: "aborted",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: fullResponse }],
                    timestamp: Date.now(),
                  },
                },
              });
              break;
            }

            if (chunk.content) {
              fullResponse += chunk.content;
              send(ws, {
                type: "event",
                event: "chat",
                payload: {
                  sessionKey: chatSessionKey,
                  runId,
                  state: "delta",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: fullResponse }],
                  },
                },
              });
            }

            if (chunk.done) {
              break;
            }
          }

          client.chatHistory.push({ role: "assistant", content: fullResponse });

          if (client.chatHistory.length > 60) {
            client.chatHistory.splice(1, client.chatHistory.length - 40);
          }

          const estimatedTokens = Math.ceil(fullResponse.length / 4) + Math.ceil(userMessage.length / 4);
          usageQuotaService.recordOpenClawTokenUsage(client.userId || "", estimatedTokens).catch(() => {});

          if (client.activeRuns.has(runId)) {
            send(ws, {
              type: "event",
              event: "chat",
              payload: {
                sessionKey: chatSessionKey,
                runId,
                state: "final",
                message: {
                  role: "assistant",
                  content: [{ type: "text", text: fullResponse }],
                  timestamp: Date.now(),
                },
              },
            });
          }
        } catch (err: any) {
          console.error(`[OpenClaw Gateway] chat.send error:`, err?.message || err);

          send(ws, {
            type: "event",
            event: "chat",
            payload: {
              sessionKey: chatSessionKey,
              runId,
              state: "error",
              errorMessage: err?.message || "Failed to get AI response",
            },
          });
        } finally {
          client.activeRuns.delete(runId);
        }
      })();
      break;
    }

    case "chat.abort": {
      const abortRunId = params?.runId;
      if (abortRunId) {
        client.activeRuns.delete(abortRunId);
      }
      reply(ws, id, { ok: true });
      break;
    }

    default:
      replyError(ws, id, -32601, `Method not found: ${method}`);
      break;
  }
}

export function attachOpenClawGateway(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  const origEmit = httpServer.emit.bind(httpServer);
  httpServer.emit = function (event: string, ...args: any[]) {
    if (event === "upgrade") {
      const req = args[0] as any;
      const socket = args[1];
      const head = args[2];
      const pathname = (req.url || "").split("?")[0];
      console.log(`[OpenClaw Gateway] Upgrade request: ${pathname}`);
      if (pathname === "/openclaw-ws" || pathname === "/openclaw-ui") {
        console.log(`[OpenClaw Gateway] Handling upgrade for ${pathname}`);
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
        return true;
      }
    }
    return origEmit(event, ...args);
  } as any;

  wss.on("connection", (ws) => {
    const connId = randomUUID();
    const nonce = randomUUID();
    const client: GatewayClient = { connId, ws, authenticated: false, chatHistory: [], activeRuns: new Set() };
    clients.set(connId, client);
    console.log(`[OpenClaw Gateway] New connection: ${connId}`);

    send(ws, {
      type: "event",
      event: "connect.challenge",
      payload: { nonce, ts: Date.now() },
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        console.log(`[OpenClaw Gateway] Message from ${connId}: ${msg.method || msg.type || "unknown"}`);
        if (msg.type === "request" && msg.method && msg.id !== undefined) {
          handleMethod(client, msg.id, msg.method, msg.params);
        } else if (msg.method && msg.id !== undefined) {
          handleMethod(client, msg.id, msg.method, msg.params);
        }
      } catch (e) {
        console.error(`[OpenClaw Gateway] Parse error:`, e);
      }
    });

    ws.on("close", () => {
      console.log(`[OpenClaw Gateway] Connection closed: ${connId}`);
      clients.delete(connId);
    });

    ws.on("error", (err) => {
      console.error(`[OpenClaw Gateway] Connection error for ${connId}:`, err);
      clients.delete(connId);
    });
  });

  console.log("[OpenClaw Gateway] WebSocket gateway attached at /openclaw-ws");
  return wss;
}
