import { z } from "zod";
import { startAnalysis, type StartAnalysisParams } from "../services/analysisOrchestrator";
import { searchWeb, searchScholar } from "../services/webSearch";
import { generateImage } from "../services/imageGeneration";
import { browserWorker } from "./browser-worker";
import {
  generateWordDocument,
  generateExcelDocument,
  generatePptDocument,
  parseExcelFromText,
  parseSlidesFromText,
} from "../services/documentGeneration";
import { EnterpriseDocumentService, type DocumentSection as EnterpriseDocumentSection } from "../services/enterpriseDocumentService";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { libraryService } from "../services/libraryService";
import { executionEngine, type ExecutionOptions } from "./executionEngine";
import { policyEngine, type PolicyContext } from "./policyEngine";
import { ToolOutputSchema, ToolCapabilitySchema, type ToolCapability } from "./contracts";
import { randomUUID } from "crypto";
import { metricsCollector } from "./metricsCollector";
import { validateOrThrow } from "./validation";
import { defaultToolRegistry as sandboxToolRegistry } from "./sandbox/tools";
import { getIntegrationPolicyCached } from "../services/integrationPolicyCache";
import { getUserSettingsCached } from "../services/userSettingsCache";
import { getUserPrivacySettings } from "../services/privacyService";

const AGENT_WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT || "/tmp/agent-workspace";
const getRunWorkspaceDir = (runId: string) => path.resolve(AGENT_WORKSPACE_ROOT, runId);
const AGENT_LOCAL_FS_ROOT = process.env.AGENT_LOCAL_FS_ROOT
  ? path.resolve(process.env.AGENT_LOCAL_FS_ROOT)
  : path.resolve(os.homedir());

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const rel = path.relative(rootPath, candidatePath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function expandHomePath(inputPath: string): string {
  if (inputPath === "~") return AGENT_LOCAL_FS_ROOT;
  if (inputPath.startsWith("~/")) return path.join(AGENT_LOCAL_FS_ROOT, inputPath.slice(2));
  return inputPath;
}

function resolveAccessibleReadPath(runId: string, requestedPath: string): {
  resolvedPath: string;
  scope: "workspace" | "local_home";
} {
  const workspaceDir = getRunWorkspaceDir(runId);
  const rawPath = String(requestedPath || ".").trim();
  const expanded = expandHomePath(rawPath);
  const isAbsoluteLike = expanded.startsWith("/");
  const resolvedPath = isAbsoluteLike
    ? path.resolve(expanded)
    : path.resolve(workspaceDir, expanded);

  if (isPathInside(workspaceDir, resolvedPath)) {
    return { resolvedPath, scope: "workspace" };
  }
  if (isPathInside(AGENT_LOCAL_FS_ROOT, resolvedPath)) {
    return { resolvedPath, scope: "local_home" };
  }

  throw new Error(
    `Access denied: read path must stay inside workspace (${workspaceDir}) or local home (${AGENT_LOCAL_FS_ROOT})`,
  );
}

type AutoConfirmPolicy = "always" | "ask" | "never";

type ConcurrencyState = { active: number; queue: Array<() => void> };
const concurrencyByKey = new Map<string, ConcurrencyState>();

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

const normalizeAutoConfirmPolicy = (value: unknown): AutoConfirmPolicy => {
  const v = String(value ?? "").toLowerCase().trim();
  if (v === "always" || v === "ask" || v === "never") return v;
  return "ask";
};

async function acquireConcurrencySlot(
  key: string,
  limit: number,
  signal?: AbortSignal
): Promise<() => void> {
  const state = concurrencyByKey.get(key) || { active: 0, queue: [] };
  if (!concurrencyByKey.has(key)) concurrencyByKey.set(key, state);

  const release = () => {
    const s = concurrencyByKey.get(key);
    if (!s) return;
    s.active = Math.max(0, s.active - 1);
    const next = s.queue.shift();
    if (next) next();
    if (s.active === 0 && s.queue.length === 0) {
      concurrencyByKey.delete(key);
    }
  };

  if (signal?.aborted) {
    throw new Error("ABORTED");
  }

  if (state.active < limit) {
    state.active++;
    return release;
  }

  return new Promise<() => void>((resolve, reject) => {
    const grant = () => {
      if (signal?.aborted) {
        reject(new Error("ABORTED"));
        return;
      }
      state.active++;
      resolve(release);
    };

    const onAbort = () => {
      const idx = state.queue.indexOf(grant);
      if (idx >= 0) state.queue.splice(idx, 1);
      if (state.active === 0 && state.queue.length === 0) {
        concurrencyByKey.delete(key);
      }
      reject(new Error("ABORTED"));
    };

    state.queue.push(grant);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

export const ToolDefinitionSchema = z.object({
  name: z.string().min(1, "Tool name is required"),
  description: z.string().min(1, "Tool description is required"),
  inputSchema: z.custom<z.ZodSchema>((val) => val instanceof z.ZodType, {
    message: "inputSchema must be a valid Zod schema",
  }),
  capabilities: z.array(ToolCapabilitySchema).optional(),
  safetyPolicy: z.enum(["safe", "requires_confirmation", "dangerous"]).default("safe"),
  timeoutMs: z.number().int().positive().default(30000),
  estimatedCostUsd: z.number().nonnegative().optional(),
  execute: z.custom<(input: any, context: ToolContext) => Promise<ToolResult>>(
    (val) => typeof val === "function",
    { message: "execute must be a function" }
  ),
});

export type ArtifactType = "file" | "image" | "document" | "chart" | "data" | "preview" | "link";

export interface ToolContext {
  userId: string;
  chatId: string;
  runId: string;
  correlationId?: string;
  stepIndex?: number;
  userPlan?: "free" | "pro" | "admin";
  isConfirmed?: boolean;
  signal?: AbortSignal;
  // Wiring from IntegrationPolicy (Settings -> Apps -> Advanced)
  autoConfirmPolicy?: AutoConfirmPolicy;
  sandboxMode?: boolean;
  maxParallelCalls?: number;

  /**
   * Optional streaming hook for long-running tools (e.g. shell_command).
   * The callback MUST be best-effort (never throw); the tool will ignore failures.
   * Consumers should not assume chunk boundaries align with lines.
   */
  onStream?: (evt: { stream: "stdout" | "stderr"; chunk: string }) => void;

  /**
   * Optional hook invoked once when a tool-backed process exits.
   * Best-effort: errors are ignored by the tool.
   */
  onExit?: (evt: {
    exitCode: number;
    signal: string | null;
    wasKilled: boolean;
    durationMs: number;
  }) => void;
}

export interface ToolArtifact {
  id: string;
  type: ArtifactType;
  name: string;
  mimeType?: string;
  url?: string;
  data: any;
  size?: number;
  createdAt: Date;
}

export interface ToolPreview {
  type: "text" | "html" | "markdown" | "image" | "chart";
  content: any;
  title?: string;
}

export interface ToolLog {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: Date;
  data?: any;
}

export interface ToolMetrics {
  durationMs: number;
  tokensUsed?: number;
  apiCalls?: number;
  bytesProcessed?: number;
  successRate?: number;
  errorRate?: number;
}

export interface ToolResult {
  success: boolean;
  output: any;
  artifacts?: ToolArtifact[];
  previews?: ToolPreview[];
  logs?: ToolLog[];
  metrics?: ToolMetrics;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details?: any;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  capabilities?: ToolCapability[];
  safetyPolicy?: "safe" | "requires_confirmation" | "dangerous";
  timeoutMs?: number;
  estimatedCostUsd?: number;
  execute: (input: any, context: ToolContext) => Promise<ToolResult>;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    const validatedTool = validateOrThrow(
      ToolDefinitionSchema,
      tool,
      `ToolRegistry.register(${tool?.name || "unknown"})`
    );

    if (this.tools.has(validatedTool.name)) {
      console.warn(`[ToolRegistry] Overwriting existing tool: ${validatedTool.name}`);
    }
    this.tools.set(validatedTool.name, validatedTool as ToolDefinition);
    console.log(`[ToolRegistry] Registered tool: ${validatedTool.name}`);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  listForPlan(plan: "free" | "pro" | "admin"): ToolDefinition[] {
    const allowedTools = policyEngine.getToolsForPlan(plan);
    return this.list().filter(t => allowedTools.includes(t.name));
  }

  async execute(name: string, input: any, context: ToolContext): Promise<ToolResult> {
    let tool = this.tools.get(name);
    const startTime = Date.now();
    const logs: ToolLog[] = [];

    const addLog = (level: ToolLog["level"], message: string, data?: any) => {
      logs.push({ level, message, timestamp: new Date(), data });
    };

    const redactForLog = (value: any): any => {
      const seen = new WeakSet();
      const sensitiveKeys = ["password", "token", "secret", "key", "auth", "credential", "apiKey"];

      const walk = (v: any): any => {
        if (v === null || v === undefined) return v;
        if (typeof v === "string") {
          if (v.length > 2000) return v.slice(0, 2000) + "...[truncated]";
          return v;
        }
        if (typeof v !== "object") return v;
        if (seen.has(v)) return "[Circular]";
        seen.add(v);

        if (Array.isArray(v)) {
          return v.slice(0, 50).map(walk);
        }

        const out: Record<string, any> = {};
        for (const [k, child] of Object.entries(v)) {
          if (sensitiveKeys.some(s => k.toLowerCase().includes(s.toLowerCase()))) {
            out[k] = "[REDACTED]";
          } else {
            out[k] = walk(child);
          }
        }
        return out;
      };

      return walk(value);
    };

    const idempotencyKey =
      typeof input?.idempotencyKey === "string"
        ? input.idempotencyKey
        : typeof input?.idempotency_key === "string"
          ? input.idempotency_key
          : undefined;

    const persistToolCallLog = (params: {
      status: string;
      providerId?: string;
      latencyMs?: number;
      errorCode?: string;
      errorMessage?: string;
      output?: any;
    }) => {
      void (async () => {
        try {
          const safeUserId =
            context.userId === "anonymous" || context.userId.startsWith("anon_")
              ? undefined
              : context.userId;
          const { storage } = await import("../storage");
          await storage.createToolCallLog({
            userId: safeUserId,
            chatId: context.chatId,
            runId: context.runId,
            toolId: name,
            providerId: params.providerId || "agentic_engine",
            inputRedacted: redactForLog(input),
            outputRedacted: redactForLog(params.output),
            status: params.status,
            errorCode: params.errorCode,
            errorMessage: params.errorMessage,
            latencyMs: Math.max(0, Math.round(params.latencyMs ?? (Date.now() - startTime))),
            idempotencyKey,
          });

          // Best-effort gap tracking: if the tool was requested but does not exist, log it as a capability gap.
          if (params.status === "not_found") {
            // @ts-ignore - Drizzle generated type might be missing userId temporarily
            await storage.createAgentGapLog({
              userId: safeUserId,
              userPrompt: `Missing tool: ${name}`,
              detectedIntent: "tool_not_found",
              gapReason: params.errorMessage || `Tool "${name}" not found`,
              suggestedCapability: name,
              status: "pending",
            });
          }
        } catch (err: any) {
          console.warn("[ToolRegistry] Failed to persist tool_call_logs:", err?.message || err);
        }
      })();
    };

    const trackAndReturn = (result: ToolResult, meta?: { status?: string; providerId?: string }) => {
      persistToolCallLog({
        status: meta?.status || (result.success ? "success" : "error"),
        providerId: meta?.providerId,
        latencyMs: result.metrics?.durationMs,
        errorCode: result.error?.code,
        errorMessage: result.error?.message,
        output: {
          success: result.success,
          output: result.output,
          error: result.error ? { code: result.error.code, message: result.error.message } : undefined,
          metrics: result.metrics,
        },
      });
      return result;
    };

    if (context.signal?.aborted) {
      addLog("info", "Tool execution aborted before start");
      return trackAndReturn({
        success: false,
        output: null,
        artifacts: [],
        previews: [],
        logs,
        metrics: { durationMs: Date.now() - startTime },
        error: {
          code: "ABORTED",
          message: "Tool execution was cancelled",
          retryable: false,
        },
      }, { status: "cancelled" });
    }

    const integrationPolicy = await getIntegrationPolicyCached(context.userId);
    const enabledTools = integrationPolicy?.enabledTools || [];
    const disabledTools = new Set(integrationPolicy?.disabledTools || []);

    if (disabledTools.has(name) || (enabledTools.length > 0 && !enabledTools.includes(name))) {
      addLog("warn", `Tool blocked by integration policy: ${name}`);
      return trackAndReturn(
        {
          success: false,
          output: null,
          artifacts: [],
          previews: [],
          logs,
          metrics: { durationMs: Date.now() - startTime },
          error: {
            code: "TOOL_DISABLED",
            message: `Tool "${name}" is disabled by policy`,
            retryable: false,
          },
        },
        { status: "denied", providerId: "integration_policy" }
      );
    }

    const autoConfirmPolicy = normalizeAutoConfirmPolicy(
      context.autoConfirmPolicy ?? integrationPolicy?.autoConfirmPolicy
    );
    const sandboxMode = context.sandboxMode ?? integrationPolicy?.sandboxMode === "true";
    const maxParallelCalls = clampInt(
      context.maxParallelCalls ?? integrationPolicy?.maxParallelCalls,
      3,
      1,
      10
    );

    const effectiveContext: ToolContext = {
      ...context,
      autoConfirmPolicy,
      sandboxMode,
      maxParallelCalls,
      isConfirmed: context.isConfirmed === true || autoConfirmPolicy === "always",
    };

    // Concurrency is a user preference; enforce it globally per user (not just per run).
    // Fallback to runId only when we can't identify a stable user.
    const normalizedUserId = String(effectiveContext.userId || "").trim();
    const concurrencyKey =
      normalizedUserId && normalizedUserId !== "anonymous"
        ? `user:${normalizedUserId}`
        : `run:${effectiveContext.runId}`;

    // User Settings Feature Gates (Privacy/Safety toggles)
    // These are user-controlled switches from Configuraciones > Personalización.
    // They must be enforced server-side to prevent accidental tool usage.
    try {
      const userSettings = await getUserSettingsCached(context.userId);
      const featureFlags = {
        webSearchAuto: userSettings?.featureFlags?.webSearchAuto ?? true,
        codeInterpreterEnabled: userSettings?.featureFlags?.codeInterpreterEnabled ?? true,
        canvasEnabled: userSettings?.featureFlags?.canvasEnabled ?? true,
        connectorSearchAuto: userSettings?.featureFlags?.connectorSearchAuto ?? false,
      };

      const isWebTool = new Set([
        "web_search",
        "browse_url",
        "web_search_retrieve",
        // Sandbox aliases
        "search",
        "browser",
        "research",
      ]).has(name);

      const isCanvasTool = new Set([
        "generate_document",
        // Sandbox aliases
        "document",
        "slides",
      ]).has(name);

      const isConnectorTool = name.startsWith("gmail_") || name.startsWith("whatsapp_");

      if (!featureFlags.webSearchAuto && isWebTool) {
        addLog("warn", `Tool blocked: web search disabled in user settings (${name})`);
        return trackAndReturn(
          {
            success: false,
            output: null,
            artifacts: [],
            previews: [],
            logs,
            metrics: { durationMs: Date.now() - startTime },
            error: {
              code: "WEB_SEARCH_DISABLED",
              message: "Web search is disabled in your settings",
              retryable: false,
            },
          },
          { status: "denied", providerId: "user_settings" }
        );
      }

      if (!featureFlags.canvasEnabled && isCanvasTool) {
        addLog("warn", `Tool blocked: canvas disabled in user settings (${name})`);
        return trackAndReturn(
          {
            success: false,
            output: null,
            artifacts: [],
            previews: [],
            logs,
            metrics: { durationMs: Date.now() - startTime },
            error: {
              code: "CANVAS_DISABLED",
              message: "Canvas features are disabled in your settings",
              retryable: false,
            },
          },
          { status: "denied", providerId: "user_settings" }
        );
      }

      if (!featureFlags.connectorSearchAuto && isConnectorTool) {
        addLog("warn", `Tool blocked: connector search disabled in user settings (${name})`);
        return trackAndReturn(
          {
            success: false,
            output: null,
            artifacts: [],
            previews: [],
            logs,
            metrics: { durationMs: Date.now() - startTime },
            error: {
              code: "CONNECTOR_SEARCH_DISABLED",
              message: "Connector search is disabled in your settings",
              retryable: false,
            },
          },
          { status: "denied", providerId: "user_settings" }
        );
      }

      // Deny any code-executing tool when code interpreter is disabled.
      if (!featureFlags.codeInterpreterEnabled && policyEngine.hasCapability(name, "executes_code")) {
        addLog("warn", `Tool blocked: code interpreter disabled in user settings (${name})`);
        return trackAndReturn(
          {
            success: false,
            output: null,
            artifacts: [],
            previews: [],
            logs,
            metrics: { durationMs: Date.now() - startTime },
            error: {
              code: "CODE_INTERPRETER_DISABLED",
              message: "Code interpreter is disabled in your settings",
              retryable: false,
            },
          },
          { status: "denied", providerId: "user_settings" }
        );
      }
    } catch (e: any) {
      // Best-effort: if settings can't be loaded, don't block tools.
      addLog("debug", "User settings feature-gate check skipped (unavailable)", e?.message || e);
    }

    if (!tool) {
      // Try sandbox tools as fallback with proper adaptation
      if (sandboxToolRegistry.has(name)) {
        addLog("info", `Using sandbox tool: ${name}`);

        const sandboxPolicyContext: PolicyContext = {
          userId: context.userId,
          userPlan: context.userPlan || "free",
          toolName: name,
          isConfirmed: effectiveContext.isConfirmed,
        };

        const sandboxPolicyCheck = policyEngine.checkAccess(sandboxPolicyContext);
        if (!sandboxPolicyCheck.allowed) {
          addLog("warn", `Policy denied sandbox tool execution: ${sandboxPolicyCheck.reason}`);
          const denialCode = sandboxPolicyCheck.requiresConfirmation
            ? effectiveContext.autoConfirmPolicy === "never"
              ? "ACCESS_DENIED"
              : "REQUIRES_CONFIRMATION"
            : "ACCESS_DENIED";
          return trackAndReturn(
            {
              success: false,
              output: null,
              artifacts: [],
              previews: [],
              logs,
              metrics: { durationMs: Date.now() - startTime },
              error: {
                code: denialCode,
                message: sandboxPolicyCheck.reason || "Access denied",
                retryable: false,
              },
            },
            { status: "denied", providerId: "sandbox" }
          );
        }

        // Enforce network access policy for tools that require network.
        if (
          sandboxPolicyCheck.policy.capabilities.includes("requires_network") &&
          context.userId &&
          context.userId !== "anonymous" &&
          !context.userId.startsWith("anon_")
        ) {
          try {
            const { getNetworkAccessPolicyForUser } = await import("../services/networkAccessPolicyService");
            const net = await getNetworkAccessPolicyForUser(context.userId);
            if (!net.effectiveNetworkAccessEnabled) {
              addLog("warn", `Network access disabled by policy (lockedByOrg=${net.lockedByOrg})`);
              return trackAndReturn(
                {
                  success: false,
                  output: null,
                  artifacts: [],
                  previews: [],
                  logs,
                  metrics: { durationMs: Date.now() - startTime },
                  error: {
                    code: "NETWORK_DISABLED",
                    message: net.lockedByOrg
                      ? "Network access is disabled by your organization policy"
                      : "Network access is disabled for your user",
                    retryable: false,
                    details: { lockedByOrg: net.lockedByOrg, orgId: net.orgId },
                  },
                },
                { status: "denied", providerId: "network_policy" }
              );
            }
          } catch (err: any) {
            // Best-effort: if DB/env isn't configured, don't block tool usage.
            addLog("debug", "Network access policy check skipped (unavailable)", err?.message || err);
          }
        }

        let releaseSlot: (() => void) | undefined;
        try {
          releaseSlot = await acquireConcurrencySlot(concurrencyKey, maxParallelCalls, effectiveContext.signal);
        } catch (err: any) {
          addLog("info", "Tool execution aborted while waiting for concurrency slot");
          return trackAndReturn(
            {
              success: false,
              output: null,
              artifacts: [],
              previews: [],
              logs,
              metrics: { durationMs: Date.now() - startTime },
              error: {
                code: "ABORTED",
                message: "Tool execution was cancelled",
                retryable: false,
              },
            },
            { status: "cancelled", providerId: "sandbox" }
          );
        }

        try {
          // Check abort signal before sandbox execution
          if (effectiveContext.signal?.aborted) {
            return trackAndReturn(
              {
                success: false,
                output: null,
                artifacts: [],
                previews: [],
                logs,
                metrics: { durationMs: Date.now() - startTime },
                error: {
                  code: "ABORTED",
                  message: "Tool execution was cancelled before sandbox tool",
                  retryable: false,
                },
              },
              { status: "cancelled", providerId: "sandbox" }
            );
          }

          // Guardrails: sandbox shell can execute arbitrary commands. Require confirmation
          // for dangerous command patterns (same policy as shell_command).
          if (name === "shell") {
            const cmd = String(
              input?.command || input?.cmd || input?.shell || input?.exec || input?.run || ""
            ).trim();
            if (cmd) {
              const { getDangerousShellMatch } = await import("./security/shellCommandPolicy");
              const matchedDanger = getDangerousShellMatch(cmd);
              if (matchedDanger && effectiveContext.isConfirmed !== true) {
                const denialCode =
                  effectiveContext.autoConfirmPolicy === "never"
                    ? "ACCESS_DENIED"
                    : "REQUIRES_CONFIRMATION";
                return trackAndReturn(
                  {
                    success: false,
                    output: { command: cmd },
                    artifacts: [],
                    previews: [
                      {
                        type: "text",
                        title: "Confirmation required",
                        content: `This command is considered high-risk and requires explicit confirmation before execution:\n\n${cmd}`,
                      },
                    ],
                    logs,
                    metrics: { durationMs: Date.now() - startTime },
                    error: {
                      code: denialCode,
                      message:
                        denialCode === "ACCESS_DENIED"
                          ? "Blocked by settings: auto-confirm policy is set to 'never'."
                          : `Command requires confirmation (${matchedDanger.reason}). Confirm to proceed.`,
                      retryable: false,
                      details: { reason: matchedDanger.reason },
                    },
                  },
                  { status: "denied", providerId: "sandbox" }
                );
              }
            }
          }

          const sandboxResult = await sandboxToolRegistry.execute(name, input);
          const artifacts: ToolArtifact[] = [];
          const previews: ToolPreview[] = [];

          // Convert sandbox file outputs to artifacts
          if (sandboxResult.filesCreated && sandboxResult.filesCreated.length > 0) {
            for (const filePath of sandboxResult.filesCreated) {
              const ext = filePath.split('.').pop()?.toLowerCase();
              let type: ArtifactType = "file";
              let mimeType = "application/octet-stream";

              if (ext === "pptx") { type = "document"; mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"; }
              else if (ext === "docx") { type = "document"; mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; }
              else if (ext === "xlsx") { type = "document"; mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; }
              else if (ext === "png" || ext === "jpg" || ext === "jpeg") { type = "image"; mimeType = `image/${ext}`; }

              artifacts.push({
                id: randomUUID(),
                type,
                name: filePath.split('/').pop() || filePath,
                mimeType,
                url: `/api/files/download?path=${encodeURIComponent(filePath)}`,
                data: { path: filePath },
                createdAt: new Date(),
              });
            }
          }

          // Properly format output based on sandbox tool type
          let output: any;
          if (sandboxResult.data) {
            // For structured data tools (search, browser, etc.), preserve the data structure
            output = sandboxResult.data;

            // Add preview for search results
            if (name === "search" && sandboxResult.data.results) {
              previews.push({
                type: "markdown",
                content: `### Search Results\n${sandboxResult.data.results.slice(0, 5).map((r: any) =>
                  `- **[${r.title}](${r.url})**\n  ${r.snippet || ''}`
                ).join('\n\n')}`,
                title: `Search: ${input.query || "results"}`,
              });
            }

            // Add preview for browser content
            if (name === "browser" && sandboxResult.data.content) {
              previews.push({
                type: "text",
                content: sandboxResult.data.content.substring(0, 1000) + (sandboxResult.data.content.length > 1000 ? "..." : ""),
                title: sandboxResult.data.title || input.url,
              });
            }
          } else {
            output = sandboxResult.message;
          }

          metricsCollector.record({
            toolName: name,
            latencyMs: sandboxResult.executionTimeMs || (Date.now() - startTime),
            success: sandboxResult.success,
            timestamp: new Date(),
          });

          return trackAndReturn({
            success: sandboxResult.success,
            output,
            artifacts,
            previews,
            logs,
            metrics: { durationMs: sandboxResult.executionTimeMs || (Date.now() - startTime) },
            error: sandboxResult.error ? {
              code: "SANDBOX_ERROR",
              message: sandboxResult.error,
              retryable: true,
            } : undefined,
          }, { providerId: "sandbox" });
        } catch (sandboxError: any) {
          addLog("error", `Sandbox tool error: ${sandboxError.message}`);

          metricsCollector.record({
            toolName: name,
            latencyMs: Date.now() - startTime,
            success: false,
            errorCode: "SANDBOX_ERROR",
            timestamp: new Date(),
          });

          return trackAndReturn({
            success: false,
            output: null,
            artifacts: [],
            previews: [],
            logs,
            metrics: { durationMs: Date.now() - startTime },
            error: {
              code: "SANDBOX_ERROR",
              message: sandboxError.message,
              retryable: false,
            },
          }, { providerId: "sandbox" });
        } finally {
          releaseSlot?.();
        }
      }

      return trackAndReturn({
        success: false,
        output: null,
        artifacts: [],
        previews: [],
        logs,
        metrics: { durationMs: Date.now() - startTime },
        error: {
          code: "TOOL_NOT_FOUND",
          message: `Tool "${name}" not found`,
          retryable: false,
        },
      }, { status: "not_found" });
    }

    const policyContext: PolicyContext = {
      userId: context.userId,
      userPlan: context.userPlan || "free",
      toolName: name,
      isConfirmed: effectiveContext.isConfirmed,
    };

    const policyCheck = policyEngine.checkAccess(policyContext);

    if (!policyCheck.allowed) {
      addLog("warn", `Policy denied execution: ${policyCheck.reason}`);
      const denialCode = policyCheck.requiresConfirmation
        ? effectiveContext.autoConfirmPolicy === "never"
          ? "ACCESS_DENIED"
          : "REQUIRES_CONFIRMATION"
        : "ACCESS_DENIED";
      return trackAndReturn({
        success: false,
        output: null,
        artifacts: [],
        previews: [],
        logs,
        metrics: { durationMs: Date.now() - startTime },
        error: {
          code: denialCode,
          message: policyCheck.reason || "Access denied",
          retryable: false,
        },
      }, { status: "denied" });
    }

    // Enforce network access policy for tools that require network.
    if (
      policyCheck.policy.capabilities.includes("requires_network") &&
      context.userId &&
      context.userId !== "anonymous" &&
      !context.userId.startsWith("anon_")
    ) {
      try {
        const { getNetworkAccessPolicyForUser } = await import("../services/networkAccessPolicyService");
        const net = await getNetworkAccessPolicyForUser(context.userId);
        if (!net.effectiveNetworkAccessEnabled) {
          addLog("warn", `Network access disabled by policy (lockedByOrg=${net.lockedByOrg})`);
          return trackAndReturn(
            {
              success: false,
              output: null,
              artifacts: [],
              previews: [],
              logs,
              metrics: { durationMs: Date.now() - startTime },
              error: {
                code: "NETWORK_DISABLED",
                message: net.lockedByOrg
                  ? "Network access is disabled by your organization policy"
                  : "Network access is disabled for your user",
                retryable: false,
                details: { lockedByOrg: net.lockedByOrg, orgId: net.orgId },
              },
            },
            { status: "denied", providerId: "network_policy" }
          );
        }
      } catch (err: any) {
        // Best-effort: if DB/env isn't configured, don't block tool usage.
        addLog("debug", "Network access policy check skipped (unavailable)", err?.message || err);
      }
    }

    let releaseSlot: (() => void) | undefined;
    try {
      let validatedInput: unknown;
      try {
        validatedInput = validateOrThrow(
          tool.inputSchema,
          input,
          `ToolRegistry.execute(${name}).input`
        );
      } catch (validationError: any) {
        addLog("error", "Input validation failed", validationError.zodError?.errors || validationError.message);
        return trackAndReturn({
          success: false,
          output: null,
          artifacts: [],
          previews: [],
          logs,
          metrics: { durationMs: Date.now() - startTime },
          error: {
            code: "INVALID_INPUT",
            message: `Invalid input: ${validationError.message}`,
            retryable: false,
            details: validationError.zodError?.errors,
          },
        }, { status: "validation_error" });
      }

      addLog("info", `Executing tool: ${name}`);
      try {
        releaseSlot = await acquireConcurrencySlot(concurrencyKey, maxParallelCalls, effectiveContext.signal);
      } catch (err: any) {
        addLog("info", "Tool execution aborted while waiting for concurrency slot");
        return trackAndReturn(
          {
            success: false,
            output: null,
            artifacts: [],
            previews: [],
            logs,
            metrics: { durationMs: Date.now() - startTime },
            error: {
              code: "ABORTED",
              message: "Tool execution was cancelled",
              retryable: false,
            },
          },
          { status: "cancelled" }
        );
      }

      const executionResult = await executionEngine.execute(
        name,
        () => tool!.execute(validatedInput, effectiveContext),
        {
          maxRetries: policyCheck.policy.maxRetries,
          timeoutMs: Math.min(
            tool!.timeoutMs ?? 30000,
            policyCheck.policy.maxExecutionTimeMs
          ),
        },
        {
          runId: context.runId,
          correlationId: context.correlationId || `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          stepIndex: context.stepIndex || 0,
          userId: context.userId,
          userPlan: context.userPlan || "free",
        }
      );

      if (executionResult.success && executionResult.data) {
        const denyRequiresConfirmation =
          executionResult.data?.error?.code === "REQUIRES_CONFIRMATION" &&
          effectiveContext.autoConfirmPolicy === "never";

        const result = denyRequiresConfirmation
          ? ({
            ...executionResult.data,
            success: false,
            error: {
              code: "ACCESS_DENIED",
              message:
                "Blocked by settings: auto-confirm policy is set to 'never'.",
              retryable: false,
              details: executionResult.data?.error?.details,
            },
          } as ToolResult)
          : executionResult.data;
        addLog("info", `Tool completed successfully in ${executionResult.metrics.totalDurationMs}ms`);

        metricsCollector.record({
          toolName: name,
          latencyMs: executionResult.metrics.totalDurationMs,
          success: result.success,
          errorCode: result.success ? undefined : result.error?.code,
          timestamp: new Date(),
        });

        const validatedOutput = ToolOutputSchema.safeParse(result);
        if (!validatedOutput.success) {
          addLog("warn", `Tool output validation failed: ${validatedOutput.error.message}`);
          if (process.env.AGENTIC_STRICT_TOOL_OUTPUT_VALIDATION === "true") {
            return trackAndReturn({
              success: false,
              output: null,
              artifacts: [],
              previews: [],
              logs,
              metrics: { durationMs: executionResult.metrics.totalDurationMs },
              error: {
                code: "CONTRACT_VIOLATION",
                message: "Tool returned an invalid result shape",
                retryable: false,
                details: validatedOutput.error.flatten(),
              },
            });
          }
        }

        return trackAndReturn({
          success: result.success,
          output: result.output,
          artifacts: result.artifacts || [],
          previews: result.previews || [],
          logs: [...(result.logs || []), ...logs],
          metrics: {
            durationMs: executionResult.metrics.totalDurationMs,
            ...result.metrics,
          },
          error: result.error,
        }, denyRequiresConfirmation ? { status: "denied" } : undefined);
      } else {
        addLog("error", `Tool failed: ${executionResult.error?.message}`, executionResult.error);

        metricsCollector.record({
          toolName: name,
          latencyMs: executionResult.metrics.totalDurationMs,
          success: false,
          errorCode: executionResult.error?.code || "EXECUTION_ERROR",
          timestamp: new Date(),
        });

        return trackAndReturn({
          success: false,
          output: null,
          artifacts: [],
          previews: [],
          logs,
          metrics: {
            durationMs: executionResult.metrics.totalDurationMs,
          },
          error: {
            code: executionResult.error?.code || "EXECUTION_ERROR",
            message: executionResult.error?.message || "Unknown error",
            retryable: executionResult.error?.retryable || false,
          },
        });
      }
    } catch (error: any) {
      addLog("error", `Unexpected error: ${error.message}`, { stack: error.stack });

      metricsCollector.record({
        toolName: name,
        latencyMs: Date.now() - startTime,
        success: false,
        errorCode: "UNEXPECTED_ERROR",
        timestamp: new Date(),
      });

      return trackAndReturn({
        success: false,
        output: null,
        artifacts: [],
        previews: [],
        logs,
        metrics: { durationMs: Date.now() - startTime },
        error: {
          code: "UNEXPECTED_ERROR",
          message: error.message || "Unknown error",
          retryable: false,
        },
      });
    } finally {
      releaseSlot?.();
    }
  }

  createArtifact(type: ArtifactType, name: string, data: any, mimeType?: string): ToolArtifact {
    return createArtifact(type, name, data, mimeType);
  }
}

export function createArtifact(type: ArtifactType, name: string, data: any, mimeType?: string, url?: string): ToolArtifact {
  return {
    id: randomUUID(),
    type,
    name,
    mimeType,
    url,
    data,
    size: (typeof data === "string" && data.length > 0) ? data.length : (Buffer.isBuffer(data) && data.length > 0) ? data.length : undefined,
    createdAt: new Date(),
  };
}

export function createError(code: string, message: string, retryable: boolean = false, details?: any): ToolResult["error"] {
  return { code, message, retryable, details };
}

const analyzeSpreadsheetSchema = z.object({
  uploadId: z.string().describe("The ID of the uploaded spreadsheet file"),
  scope: z.enum(["active", "selected", "all"]).default("all").describe("Which sheets to analyze"),
  sheetNames: z.array(z.string()).default([]).describe("Specific sheet names to analyze (for 'selected' scope)"),
  analysisMode: z.enum(["full", "summary", "extract_tasks", "text_only", "custom"]).default("full"),
  userPrompt: z.string().optional().describe("Custom analysis instructions"),
});

const analyzeSpreadsheetTool: ToolDefinition = {
  name: "analyze_spreadsheet",
  description: "Analyze Excel or CSV spreadsheet files. Performs data analysis, generates insights, charts, and summaries from spreadsheet data.",
  inputSchema: analyzeSpreadsheetSchema,
  capabilities: ["reads_files", "produces_artifacts"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const params: StartAnalysisParams = {
        uploadId: input.uploadId,
        userId: context.userId,
        scope: input.scope,
        sheetNames: input.sheetNames,
        analysisMode: input.analysisMode,
        userPrompt: input.userPrompt,
      };

      const result = await startAnalysis(params);

      return {
        success: true,
        output: {
          sessionId: result.sessionId,
          message: "Analysis started successfully",
        },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("ANALYSIS_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const webSearchSchema = z.object({
  query: z.string().describe("The search query"),
  maxResults: z.number().min(1).max(20).default(5).describe("Maximum number of results to return"),
  academic: z.boolean().default(false).describe("Whether to search academic/scholarly sources"),
});

const webSearchTool: ToolDefinition = {
  name: "web_search",
  description: "Search the web for information. Can search general web or academic/scholarly sources like Google Scholar.",
  inputSchema: webSearchSchema,
  capabilities: ["requires_network", "accesses_external_api"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      if (context.signal?.aborted) {
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "Web search was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      if (input.academic) {
        const results = await searchScholar(input.query, input.maxResults);
        if (context.signal?.aborted) {
          return {
            success: false,
            output: null,
            error: createError("ABORTED", "Web search was cancelled", false),
            artifacts: [],
            previews: [],
            logs: [],
            metrics: { durationMs: Date.now() - startTime },
          };
        }
        return {
          success: true,
          output: {
            query: input.query,
            type: "academic",
            results,
          },
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const response = await searchWeb(input.query, input.maxResults);
      if (context.signal?.aborted) {
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "Web search was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }
      return {
        success: true,
        output: {
          query: response.query,
          type: "web",
          results: response.results,
          contents: response.contents,
        },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      if (context.signal?.aborted) {
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "Web search was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }
      return {
        success: false,
        output: null,
        error: createError("SEARCH_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const generateImageSchema = z.object({
  prompt: z.string().describe("Description of the image to generate"),
});

const generateImageTool: ToolDefinition = {
  name: "generate_image",
  description: "Generate an image using Gemini AI based on a text description. Returns a base64-encoded image.",
  inputSchema: generateImageSchema,
  capabilities: ["requires_network", "accesses_external_api", "produces_artifacts"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const result = await generateImage(input.prompt);

      return {
        success: true,
        output: {
          prompt: result.prompt,
          mimeType: result.mimeType,
        },
        artifacts: [
          createArtifact(
            "image",
            "generated_image",
            { base64: result.imageBase64, mimeType: result.mimeType },
            result.mimeType
          ),
        ],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("IMAGE_GENERATION_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const browseUrlSchema = z.object({
  url: z.string().url().describe("The URL to navigate to"),
  takeScreenshot: z.boolean().default(true).describe("Whether to capture a screenshot"),
  sessionId: z.string().optional().describe("Existing browser session ID (creates new if not provided)"),
});

const browseUrlTool: ToolDefinition = {
  name: "browse_url",
  description: "Navigate to a URL using a headless browser. Returns page content, title, and optionally a screenshot.",
  inputSchema: browseUrlSchema,
  capabilities: ["requires_network", "accesses_external_api", "long_running"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    let sessionId = input.sessionId;
    let createdSession = false;

    try {
      if (context.signal?.aborted) {
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "URL browsing was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const privacy = await getUserPrivacySettings(context.userId);
      if (!privacy.remoteBrowserDataAccess) {
        // Privacy-preserving fallback: do a stateless HTTP fetch without cookies/session,
        // and never capture screenshots.
        const fetchStart = Date.now();

        const extractTitle = (html: string): string => {
          const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
          return (match?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 200);
        };

        const response = await fetch(input.url, {
          signal: context.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        if (!response.ok) {
          return {
            success: false,
            output: null,
            error: createError(
              "BROWSE_ERROR",
              `Remote browser data access is disabled. HTTP fetch failed: ${response.status} ${response.statusText}`,
              response.status >= 500
            ),
            artifacts: [],
            previews: [],
            logs: [
              {
                level: "warn",
                message: "Remote browser disabled by privacy settings; browse_url used HTTP fetch fallback.",
                timestamp: new Date(),
                data: { url: input.url, status: response.status },
              },
            ],
            metrics: { durationMs: Date.now() - startTime },
          };
        }

        const htmlText = await response.text();
        const html = htmlText.slice(0, 50000);

        return {
          success: true,
          output: {
            url: response.url || input.url,
            title: extractTitle(html),
            html,
            timing: {
              navigationMs: Date.now() - fetchStart,
              renderMs: 0,
            },
            sessionId: undefined,
            privacyFallback: true,
          },
          artifacts: [],
          previews: [],
          logs: [
            {
              level: "info",
              message: "Remote browser disabled by privacy settings; browse_url used HTTP fetch fallback (no cookies/session, no screenshots).",
              timestamp: new Date(),
              data: { url: input.url },
            },
          ],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      if (!sessionId) {
        sessionId = await browserWorker.createSession();
        createdSession = true;
      }

      if (context.signal?.aborted) {
        if (createdSession && sessionId) {
          await browserWorker.destroySession(sessionId).catch(() => { });
        }
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "URL browsing was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const result = await browserWorker.navigate(sessionId, input.url, input.takeScreenshot);

      if (context.signal?.aborted) {
        if (createdSession && sessionId) {
          await browserWorker.destroySession(sessionId).catch(() => { });
        }
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "URL browsing was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const artifacts: ToolArtifact[] = [];
      if (result.screenshot) {
        artifacts.push(
          createArtifact(
            "image",
            "page_screenshot",
            { base64: result.screenshot.toString("base64"), mimeType: "image/png" },
            "image/png"
          )
        );
      }

      if (createdSession) {
        await browserWorker.destroySession(sessionId);
      }

      return {
        success: result.success,
        output: {
          url: result.url,
          title: result.title,
          html: result.html?.slice(0, 50000),
          timing: result.timing,
          sessionId: createdSession ? undefined : sessionId,
        },
        artifacts,
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: result.error ? createError("BROWSE_ERROR", result.error, true) : undefined,
      };
    } catch (error: any) {
      if (createdSession && sessionId) {
        await browserWorker.destroySession(sessionId).catch(() => { });
      }
      if (context.signal?.aborted) {
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "URL browsing was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }
      return {
        success: false,
        output: null,
        error: createError("BROWSE_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

function buildDocumentSectionsFromText(title: string, content: string): EnterpriseDocumentSection[] {
  const normalized = String(content || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [{
      id: "section-1",
      title: "Contenido",
      content: title,
      level: 1,
    }];
  }

  const headingRe = /^(#{1,3})\s+(.+)$/;
  const lines = normalized.split("\n");
  const sections: EnterpriseDocumentSection[] = [];
  let currentSection: EnterpriseDocumentSection | null = null;

  const flushCurrentSection = () => {
    if (!currentSection) return;
    currentSection.content = currentSection.content.trim() || "Contenido generado automáticamente.";
    sections.push(currentSection);
    currentSection = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const headingMatch = line.match(headingRe);

    if (headingMatch) {
      flushCurrentSection();
      const level = Math.min(3, headingMatch[1].length) as 1 | 2 | 3;
      currentSection = {
        id: `section-${sections.length + 1}`,
        title: headingMatch[2].trim(),
        content: "",
        level,
      };
      continue;
    }

    if (!currentSection) {
      currentSection = {
        id: `section-${sections.length + 1}`,
        title: "Contenido",
        content: "",
        level: 1,
      };
    }

    currentSection.content += `${line}\n`;
  }

  flushCurrentSection();

  return sections.length > 0
    ? sections
    : [{
        id: "section-1",
        title: "Contenido",
        content: normalized,
        level: 1,
      }];
}

const generateDocumentSchema = z.object({
  type: z.enum(["word", "excel", "ppt", "csv", "pdf"]).describe("Type of document to generate"),
  title: z.string().describe("Document title"),
  content: z.string().describe("Document content (text for Word, data for Excel/CSV, slide structure for PPT)"),
});

const generateDocumentTool: ToolDefinition = {
  name: "generate_document",
  description: "Generate Office documents (Word, Excel, PowerPoint, PDF, CSV). For Word/PDF: provide markdown/text content. For Excel/CSV: provide tabular data (rows separated by newlines, columns by tabs or commas). For PowerPoint: provide slide content.",
  inputSchema: generateDocumentSchema,
  capabilities: ["produces_artifacts", "writes_files"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      let buffer: Buffer;
      let mimeType: string;
      let extension: string;

      switch (input.type) {
        case "word":
          buffer = await generateWordDocument(input.title, input.content);
          mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          extension = "docx";
          break;

        case "excel": {
          const excelData = parseExcelFromText(input.content);
          buffer = await generateExcelDocument(input.title, excelData);
          mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          extension = "xlsx";
          break;
        }

        case "ppt": {
          const slides = parseSlidesFromText(input.content);
          buffer = await generatePptDocument(input.title, slides, {
            trace: {
              source: "toolRegistry",
            },
          });
          mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
          extension = "pptx";
          break;
        }

        case "csv": {
          // Parse content as tabular data and convert to CSV format
          const csvData = parseExcelFromText(input.content);
          const csvContent = csvData
            .map((row) =>
              row
                .map((cell) => {
                  const cellStr = String(cell ?? "");
                  // Escape cells that contain commas, quotes, or newlines
                  if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
                    return `"${cellStr.replace(/"/g, '""')}"`;
                  }
                  return cellStr;
                })
                .join(",")
            )
            .join("\n");
          buffer = Buffer.from(csvContent, "utf-8");
          mimeType = "text/csv";
          extension = "csv";
          break;
        }

        case "pdf": {
          const documentService = EnterpriseDocumentService.create("professional");
          const pdfResult = await documentService.generateDocument({
            type: "pdf",
            title: input.title,
            author: "ILIAGPT AI",
            sections: buildDocumentSectionsFromText(input.title, input.content),
            options: {
              includePageNumbers: true,
              includeHeader: true,
              includeFooter: true,
            },
          });

          if (!pdfResult.success || !pdfResult.buffer) {
            throw new Error(pdfResult.error || "PDF generation failed");
          }

          buffer = pdfResult.buffer;
          mimeType = "application/pdf";
          extension = "pdf";
          break;
        }

        default:
          throw new Error(`Unsupported document type: ${input.type}`);
      }

      const filename = `${input.title.replace(/[^a-zA-Z0-9-_]/g, "_")}.${extension}`;

      // A) Make it downloadable via /api/artifacts/<filename>
      const artifactsDir = path.join(process.cwd(), "artifacts");
      await fs.mkdir(artifactsDir, { recursive: true });
      const artifactPath = path.join(artifactsDir, filename);
      await fs.writeFile(artifactPath, buffer);
      const downloadUrl = `/api/artifacts/${filename}`;

      // C) Save into Library (object storage + metadata)
      // If library upload fails, we still return the downloadable artifact.
      let library: any = null;
      try {
        const upload = await libraryService.generateUploadUrl(
          context.userId,
          filename,
          mimeType
        );

        await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": mimeType },
          body: Buffer.from(buffer) as unknown as BodyInit,
        });

        const ext = extension;
        const fileType =
          input.type === "word" || input.type === "pdf"
            ? "document"
            : input.type === "excel"
              ? "spreadsheet"
              : input.type === "ppt"
                ? "presentation"
                : "other";

        const saved = await libraryService.saveFileMetadata(context.userId, upload.objectPath, {
          name: filename,
          originalName: filename,
          description: `Generated by agent run ${context.runId}`,
          type: fileType,
          mimeType,
          extension: ext,
          size: buffer.length,
          metadata: {
            runId: context.runId,
            chatId: context.chatId,
            tool: "generate_document",
            title: input.title,
          },
        });

        library = {
          fileUuid: saved.uuid,
          storageUrl: saved.storageUrl,
          name: saved.name,
        };
      } catch (e) {
        console.warn("[generate_document] Failed to save to library:", (e as any)?.message || e);
      }

      return {
        success: true,
        output: {
          type: input.type,
          title: input.title,
          filename,
          size: buffer.length,
          downloadUrl,
          library,
        },
        artifacts: [
          createArtifact(
            "document",
            filename,
            {
              base64: buffer.toString("base64"),
              mimeType,
              filename,
              downloadUrl,
              library,
            },
            mimeType,
            downloadUrl
          ),
        ],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("DOCUMENT_GENERATION_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const readFileSchema = z.object({
  filepath: z.string().describe("Path to file. Relative paths resolve inside run workspace; absolute/~/ paths resolve inside local home."),
});

const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read file contents from workspace or local home (read-only).",
  inputSchema: readFileSchema,
  capabilities: ["reads_files"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const fs = await import('fs/promises');
      const { resolvedPath, scope } = resolveAccessibleReadPath(context.runId, input.filepath);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      return {
        success: true,
        output: {
          filepath: input.filepath,
          resolvedPath,
          scope,
          content,
          size: content.length,
        },
        artifacts: [],
        previews: [{ type: "text", content: content.slice(0, 1000), title: input.filepath }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("FILE_READ_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const writeFileSchema = z.object({
  filepath: z.string().describe("Path to file in workspace"),
  content: z.string().describe("File content to write"),
});

const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write or create a file in the agent's workspace.",
  inputSchema: writeFileSchema,
  capabilities: ["writes_files"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const workspaceDir = getRunWorkspaceDir(context.runId);
      await fs.mkdir(workspaceDir, { recursive: true });
      const safePath = path.resolve(workspaceDir, input.filepath);
      if (!safePath.startsWith(workspaceDir)) {
        throw new Error('Access denied: path outside workspace');
      }
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, input.content, 'utf-8');
      return {
        success: true,
        output: { filepath: input.filepath, size: input.content.length, created: true },
        artifacts: [createArtifact("file", input.filepath, { path: safePath, size: input.content.length })],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("FILE_WRITE_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const shellCommandSchema = z.object({
  command: z.string().describe("Shell command to execute"),
  timeout: z.number().min(1000).max(60000).default(30000).describe("Timeout in milliseconds"),
});

const shellCommandTool: ToolDefinition = {
  name: "shell_command",
  description: "Execute a shell command in the agent's sandbox. Useful for system/terminal tasks (install/uninstall packages, monitor CPU/RAM/disk, manage processes/services, backups/restore). Streams stdout/stderr and enforces safety checks.",
  inputSchema: shellCommandSchema,
  capabilities: ["executes_code", "long_running", "high_risk"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();

    // Ensure workspace exists
    const fs = await import("fs/promises");
    const path = await import("path");
    const workspaceDir = getRunWorkspaceDir(context.runId);
    await fs.mkdir(workspaceDir, { recursive: true });

    const cmd = String(input.command ?? "").trim();
    if (!cmd) {
      return {
        success: false,
        output: null,
        error: createError("INVALID_INPUT", "Command is required", false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }

    const { getDangerousShellMatch, getShellSandboxMode } = await import("./security/shellCommandPolicy");

    const matchedDanger = getDangerousShellMatch(cmd);
    if (matchedDanger && context.isConfirmed !== true) {
      return {
        success: false,
        output: { command: cmd },
        error: createError(
          "REQUIRES_CONFIRMATION",
          `Command requires confirmation (${matchedDanger.reason}). Confirm to proceed.`,
          false,
          { reason: matchedDanger.reason }
        ),
        artifacts: [],
        previews: [
          {
            type: "text",
            title: "Confirmation required",
            content: `This command is considered high-risk and requires explicit confirmation before execution:\n\n${cmd}`,
          },
        ],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }

    const { spawn } = await import("child_process");

    const timeoutMs = Math.min(Math.max(Number(input.timeout ?? 30000), 1000), 60000);

    // Sandbox mode: host | docker | runner.
    // Stable default: in production, default to runner (docker-isolated service).
    let sandboxMode = getShellSandboxMode();
    const dockerImage = process.env.SHELL_COMMAND_DOCKER_IMAGE || "debian:bookworm-slim";

    const runnerUrl = process.env.SHELL_COMMAND_RUNNER_URL || "http://sandbox-runner:8080";
    const runnerToken = process.env.SHELL_COMMAND_RUNNER_TOKEN || process.env.SANDBOX_RUNNER_TOKEN || "";

    // User-driven sandbox preference: when enabled, prefer the runner if configured.
    if (context.sandboxMode === true && sandboxMode === "host" && runnerToken) {
      sandboxMode = "runner";
    }

    const runWithRunner = async (): Promise<ToolResult> => {
      if (!runnerToken) {
        return {
          success: false,
          output: { command: cmd, stdout: "", stderr: "", exitCode: 1 },
          error: createError("COMMAND_ERROR", "Runner token not configured (SHELL_COMMAND_RUNNER_TOKEN)", false),
          artifacts: [],
          previews: [{ type: "text", content: "Runner token not configured", title: "Error" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      // Start remote job
      const ac = new AbortController();
      const abortHandler = () => ac.abort();
      context.signal?.addEventListener?.("abort", abortHandler, { once: true });

      let stdout = "";
      let stderr = "";
      const maxCapture = 1024 * 1024;

      try {
        const startRes = await fetch(`${runnerUrl.replace(/\/$/, "")}/v1/shell/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${runnerToken}`,
          },
          body: JSON.stringify({ runId: context.runId, command: cmd, timeoutMs }),
          signal: ac.signal,
        });

        if (!startRes.ok) {
          const text = await startRes.text().catch(() => "");
          return {
            success: false,
            output: { command: cmd, stdout: "", stderr: text, exitCode: 1 },
            error: createError("COMMAND_ERROR", `Runner start failed: ${startRes.status}`, true, { body: text }),
            artifacts: [],
            previews: [{ type: "text", content: text, title: "Runner Error" }],
            logs: [],
            metrics: { durationMs: Date.now() - startTime },
          };
        }

        const { jobId, streamUrl } = (await startRes.json()) as any;
        const streamRes = await fetch(`${runnerUrl.replace(/\/$/, "")}${streamUrl || `/v1/shell/stream/${jobId}`}`, {
          headers: { Authorization: `Bearer ${runnerToken}` },
          signal: ac.signal,
        });

        if (!streamRes.ok || !streamRes.body) {
          const text = await streamRes.text().catch(() => "");
          return {
            success: false,
            output: { command: cmd, stdout: "", stderr: text, exitCode: 1 },
            error: createError("COMMAND_ERROR", `Runner stream failed: ${streamRes.status}`, true, { body: text }),
            artifacts: [],
            previews: [{ type: "text", content: text, title: "Runner Stream Error" }],
            logs: [],
            metrics: { durationMs: Date.now() - startTime },
          };
        }

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        let exitEvt: any = null;
        let doneReceived = false;

        const safeEmit = (stream: "stdout" | "stderr", chunk: string) => {
          if (!chunk) return;
          try {
            context.onStream?.({ stream, chunk });
          } catch {
            // ignore
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          // parse SSE by events separated by blank line
          while (true) {
            const idx = buf.indexOf("\n\n");
            if (idx === -1) break;
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);

            const lines = raw.split("\n");
            let eventName = "message";
            let data = "";
            for (const line of lines) {
              if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
              if (line.startsWith("data:")) data += line.slice("data:".length).trim();
            }

            if (eventName === "shell") {
              try {
                const evt = JSON.parse(data);
                if (evt?.type === "stdout") {
                  safeEmit("stdout", String(evt.chunk || ""));
                  if (stdout.length < maxCapture) stdout += String(evt.chunk || "").slice(0, maxCapture - stdout.length);
                } else if (evt?.type === "stderr") {
                  safeEmit("stderr", String(evt.chunk || ""));
                  if (stderr.length < maxCapture) stderr += String(evt.chunk || "").slice(0, maxCapture - stderr.length);
                } else if (evt?.type === "exit") {
                  exitEvt = evt;
                }
              } catch {
                // ignore malformed events
              }
            }

            // Some SSE servers keep the connection open. If we receive a terminal marker,
            // stop reading to avoid hanging indefinitely.
            if (eventName === "done") {
              doneReceived = true;
              try {
                void reader.cancel();
              } catch {
                // ignore
              }
              buf = "";
              break;
            }
          }

          // If we got a terminal marker, stop reading.
          if (doneReceived) {
            break;
          }

          // If we got an exit event, we can also stop early.
          if (exitEvt) {
            try {
              void reader.cancel();
            } catch {
              // ignore
            }
            break;
          }
        }

        const exitCode = Number(exitEvt?.exitCode ?? 1);
        const signal = exitEvt?.signal ? String(exitEvt.signal) : null;
        const wasKilled = Boolean(exitEvt?.wasKilled);
        const durationMs = Number(exitEvt?.durationMs ?? Date.now() - startTime);

        try {
          context.onExit?.({ exitCode, signal, wasKilled, durationMs });
        } catch {
          // ignore
        }

        const ok = exitCode === 0 && !wasKilled;
        return {
          success: ok,
          output: { command: cmd, stdout, stderr, exitCode },
          artifacts: [],
          previews: [{ type: "text", content: (stdout || stderr).slice(0, 100000), title: ok ? "Command Output" : "Error Output" }],
          logs: [],
          error: ok ? undefined : createError(wasKilled ? "COMMAND_TIMEOUT" : "COMMAND_ERROR", stderr || `Exit code ${exitCode}`, true),
          metrics: { durationMs: Date.now() - startTime },
        };
      } catch (err: any) {
        if (context.signal?.aborted || ac.signal.aborted) {
          return {
            success: false,
            output: { command: cmd, stdout: "", stderr: "", exitCode: 1 },
            error: createError("ABORTED", "Command cancelled", false),
            artifacts: [],
            previews: [],
            logs: [],
            metrics: { durationMs: Date.now() - startTime },
          };
        }
        return {
          success: false,
          output: { command: cmd, stdout: "", stderr: err?.message || String(err), exitCode: 1 },
          error: createError("COMMAND_ERROR", `Runner unavailable: ${err?.message || String(err)}`, true),
          artifacts: [],
          previews: [{ type: "text", content: err?.message || String(err), title: "Runner Error" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      } finally {
        context.signal?.removeEventListener?.("abort", abortHandler as any);
      }
    };

    if (sandboxMode === "runner") {
      return await runWithRunner();
    }

    const { existsSync } = await import("fs");
    const bashPath =
      process.env.SHELL_COMMAND_BASH_PATH ||
      (existsSync("/bin/bash")
        ? "/bin/bash"
        : existsSync("/usr/bin/bash")
          ? "/usr/bin/bash"
          : "bash");

    const runWithHost = () => {
      return spawn(bashPath, ["-lc", cmd], {
        cwd: workspaceDir,
        env: { ...process.env, HOME: workspaceDir },
        shell: false,
        windowsHide: true,
      });
    };

    const runWithDocker = () => {
      // Hardening defaults (v1): no network, drop caps, no new privileges.
      // We mount the per-run workspace as /workspace.
      const uid = typeof (process as any).getuid === "function" ? (process as any).getuid() : undefined;
      const gid = typeof (process as any).getgid === "function" ? (process as any).getgid() : undefined;

      const dockerArgs: string[] = [
        "run",
        "--rm",
        "-i",
        "--network",
        "none",
        "--security-opt",
        "no-new-privileges",
        "--cap-drop",
        "ALL",
        "--pids-limit",
        "256",
        "--cpus",
        process.env.SHELL_COMMAND_DOCKER_CPUS || "1",
        "--memory",
        process.env.SHELL_COMMAND_DOCKER_MEMORY || "512m",
        "-v",
        `${workspaceDir}:/workspace`,
        "-w",
        "/workspace",
      ];

      if (uid !== undefined && gid !== undefined) {
        dockerArgs.push("--user", `${uid}:${gid}`);
      }

      dockerArgs.push(dockerImage, "/bin/bash", "-lc", cmd);

      return spawn("docker", dockerArgs, {
        cwd: workspaceDir,
        env: { ...process.env, HOME: workspaceDir },
        shell: false,
        windowsHide: true,
      });
    };

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      let child = null as any;
      try {
        child = sandboxMode === "docker" ? runWithDocker() : runWithHost();
      } catch (err: any) {
        return resolve({
          success: false,
          output: { command: cmd, stdout: "", stderr: "", exitCode: 1 },
          error: createError(
            "COMMAND_ERROR",
            sandboxMode === "docker"
              ? `Docker sandbox unavailable: ${err?.message || String(err)}`
              : `Command spawn failed: ${err?.message || String(err)}`,
            true
          ),
          artifacts: [],
          previews: [{ type: "text", content: err?.message || String(err), title: "Error Output" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        });
      }

      const maxCapture = 1024 * 1024; // 1MB each stream

      const safeEmit = (stream: "stdout" | "stderr", chunk: string) => {
        if (!chunk) return;
        try {
          context.onStream?.({ stream, chunk });
        } catch {
          // ignore
        }
      };

      const onData = (stream: "stdout" | "stderr") => (data: any) => {
        const chunk = data?.toString?.() ?? String(data);
        safeEmit(stream, chunk);

        if (stream === "stdout") {
          if (stdout.length < maxCapture) stdout += chunk.slice(0, maxCapture - stdout.length);
        } else {
          if (stderr.length < maxCapture) stderr += chunk.slice(0, maxCapture - stderr.length);
        }
      };

      child.stdout?.on("data", onData("stdout"));
      child.stderr?.on("data", onData("stderr"));

      const timeoutHandle = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      const abortHandler = () => {
        killed = true;
        child.kill("SIGKILL");
      };

      if (context.signal) {
        if (context.signal.aborted) abortHandler();
        context.signal.addEventListener("abort", abortHandler, { once: true });
      }

      child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timeoutHandle);
        context.signal?.removeEventListener?.("abort", abortHandler as any);

        const exitCode = typeof code === "number" ? code : signal ? 1 : 0;

        try {
          context.onExit?.({
            exitCode,
            signal: signal ? String(signal) : null,
            wasKilled: killed,
            durationMs: Date.now() - startTime,
          });
        } catch {
          // ignore
        }

        if (killed) {
          return resolve({
            success: false,
            output: { command: cmd, stdout, stderr, exitCode },
            error: createError("COMMAND_TIMEOUT", `Command exceeded timeout of ${timeoutMs}ms`, false),
            artifacts: [],
            previews: [{ type: "text", content: (stdout || stderr).slice(0, 100000), title: "Command Output (partial)" }],
            logs: [],
            metrics: { durationMs: Date.now() - startTime },
          });
        }

        const ok = exitCode === 0;
        const previewText = (stdout || stderr).slice(0, 100000);

        return resolve({
          success: ok,
          output: { command: cmd, stdout, stderr, exitCode },
          artifacts: [],
          previews: [{ type: "text", content: previewText, title: ok ? "Command Output" : "Error Output" }],
          logs: [],
          error: ok ? undefined : createError("COMMAND_ERROR", stderr || `Exit code ${exitCode}`, true),
          metrics: { durationMs: Date.now() - startTime },
        });
      });

      child.on("error", (err: Error) => {
        clearTimeout(timeoutHandle);
        context.signal?.removeEventListener?.("abort", abortHandler as any);

        return resolve({
          success: false,
          output: { command: cmd, stdout, stderr, exitCode: 1 },
          error: createError("COMMAND_ERROR", err.message, true),
          artifacts: [],
          previews: [{ type: "text", content: err.message, title: "Error Output" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        });
      });
    });
  },
};

const listFilesSchema = z.object({
  directory: z.string().default(".").describe("Directory path. Relative paths resolve inside run workspace; absolute/~/ paths resolve inside local home."),
  maxEntries: z.number().int().min(1).max(1000).optional().default(200).describe("Maximum number of entries to return."),
});

const listFilesTool: ToolDefinition = {
  name: "list_files",
  description: "List files and directories from workspace or local home (read-only).",
  inputSchema: listFilesSchema,
  capabilities: ["reads_files"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const fs = await import('fs/promises');
      const workspaceDir = getRunWorkspaceDir(context.runId);
      await fs.mkdir(workspaceDir, { recursive: true });
      const { resolvedPath, scope } = resolveAccessibleReadPath(context.runId, input.directory);
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      const files = entries
        .slice(0, input.maxEntries)
        .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }));
      return {
        success: true,
        output: {
          directory: input.directory,
          resolvedPath,
          scope,
          files,
          count: files.length,
          truncated: entries.length > files.length,
          totalDetected: entries.length,
        },
        artifacts: [],
        previews: [{ type: "text", content: files.map(f => `${f.type === 'directory' ? '[D]' : '[F]'} ${f.name}`).join('\n'), title: "Files" }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("LIST_FILES_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

import { initializeClawiSkills } from "../openclaw/skills/clawiSkillAdapter";
import { createAgenticTools } from "../openclaw/tools/agenticTools";
import { createClawiRuntimeTools } from "../openclaw/tools/clawiRuntimeTools";
import { spawnSubagentTool } from "./tools/spawn_subagent";
import { memorySearchTool } from "./tools/memory_search";

initializeClawiSkills().catch(e => console.error("Failed to init Clawi skills", e));

export const toolRegistry = new ToolRegistry();
toolRegistry.register(spawnSubagentTool);
toolRegistry.register(memorySearchTool);
for (const tool of createAgenticTools()) {
  if (!toolRegistry.get(tool.name)) {
    toolRegistry.register(tool);
  }
}
for (const tool of createClawiRuntimeTools()) {
  if (!toolRegistry.get(tool.name)) {
    toolRegistry.register(tool);
  }
}



toolRegistry.register(analyzeSpreadsheetTool);
toolRegistry.register(webSearchTool);
toolRegistry.register(generateImageTool);
toolRegistry.register(browseUrlTool);
toolRegistry.register(generateDocumentTool);
toolRegistry.register(readFileTool);
toolRegistry.register(writeFileTool);
toolRegistry.register(shellCommandTool);
toolRegistry.register(listFilesTool);

import { browseAndActTool } from "./tools/browseAndActTool";
import {
  createPresentationTool,
  createDocumentTool,
  createSpreadsheetTool,
  createPdfTool
} from "./tools/artifactTools";

toolRegistry.register(browseAndActTool);
toolRegistry.register(createPresentationTool);
toolRegistry.register(createDocumentTool);
toolRegistry.register(createSpreadsheetTool);
toolRegistry.register(createPdfTool);

// Register extended tools
import { extendedTools } from "./extendedTools";
for (const tool of extendedTools) {
  toolRegistry.register(tool);
}

// Register OpenClaw capability tools (academic, document, agent management)
import { academicTools } from "./tools/academicTools";
import { documentAdvancedTools } from "./tools/documentAdvancedTools";
import { agentManagementTools } from "./tools/agentManagementTools";

function registerSimpleTools(
  simpleTools: Array<{ name: string; description: string; schema: any; execute: (params: any) => Promise<any>; category: string }>
) {
  for (const st of simpleTools) {
    const adapted: ToolDefinition = {
      name: st.name,
      description: st.description,
      inputSchema: st.schema,
      execute: async (input: any, _context: ToolContext): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
          const result = await st.execute(input);
          return {
            success: true,
            output: result,
            metrics: { durationMs: Date.now() - startTime },
          };
        } catch (error: any) {
          return {
            success: false,
            output: null,
            error: { code: `${st.name.toUpperCase()}_ERROR`, message: error.message, retryable: false },
            metrics: { durationMs: Date.now() - startTime },
          };
        }
      },
    };
    toolRegistry.register(adapted);
  }
}

registerSimpleTools(academicTools);
registerSimpleTools(documentAdvancedTools);
registerSimpleTools(agentManagementTools);

import { BUNDLED_SKILL_TOOLS } from "./tools/bundledSkillTools";
for (const tool of BUNDLED_SKILL_TOOLS) {
  toolRegistry.register(tool);
}

export {
  analyzeSpreadsheetSchema,
  webSearchSchema,
  generateImageSchema,
  browseUrlSchema,
  generateDocumentSchema,
};
