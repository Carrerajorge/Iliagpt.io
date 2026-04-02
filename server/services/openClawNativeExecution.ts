import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EmbeddedPiRunResult } from "./superIntelligence/agents/pi-embedded.js";
import { resolveUserScopedAgentDir } from "./userScopedAgentDir.js";

const NATIVE_SESSION_ROOT = "iliagpt-openclaw-native";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_PROMPT_CHARS = 24_000;
const MAX_CONTEXT_CHARS = 8_000;

export type ExecuteOpenClawNativePromptParams = {
  prompt: string;
  context?: unknown;
  userId?: string | null;
  chatId?: string | null;
  provider?: string;
  model?: string;
  timeoutMs?: number;
  enableTools?: boolean;
};

export type ExecuteOpenClawNativePromptResult = {
  engine: string;
  sessionId: string;
  sessionKey: string;
  workspaceDir: string;
  response: string;
  payloads: NonNullable<EmbeddedPiRunResult["payloads"]>;
  mediaUrls: string[];
  meta: EmbeddedPiRunResult["meta"];
  nativeToolsEnabled: boolean;
};

function sanitizeSegment(value: string | null | undefined, fallback: string): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return (normalized || fallback).slice(0, 64);
}

function clampTimeout(timeoutMs?: number): number {
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(5_000, Math.trunc(timeoutMs as number)));
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...(truncado)`;
}

function stringifyContext(context: unknown): string {
  if (context == null) {
    return "";
  }

  try {
    if (typeof context === "string") {
      return truncate(context.trim(), MAX_CONTEXT_CHARS);
    }

    return truncate(JSON.stringify(context, null, 2), MAX_CONTEXT_CHARS);
  } catch {
    return truncate(String(context), MAX_CONTEXT_CHARS);
  }
}

function buildNativePrompt(prompt: string, context?: unknown): string {
  const contextBlock = stringifyContext(context);

  return truncate(
    [
      "Actua como OpenClaw integrado nativamente dentro de ILIAGPT.",
      "Ejecuta la solicitud de forma real usando el runtime embebido.",
      "Si las herramientas estan habilitadas y son necesarias, usalas. Si no hacen falta, responde directamente con precision.",
      contextBlock ? `[Contexto de ejecucion]\n${contextBlock}` : null,
      `[Solicitud]\n${prompt.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    MAX_PROMPT_CHARS,
  );
}

function collectText(result: EmbeddedPiRunResult): string {
  return (result.payloads || [])
    .map((payload) => (typeof payload?.text === "string" ? payload.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function collectMediaUrls(result: EmbeddedPiRunResult): string[] {
  const media = new Set<string>();

  for (const payload of result.payloads || []) {
    if (typeof payload?.mediaUrl === "string" && payload.mediaUrl.trim()) {
      media.add(payload.mediaUrl.trim());
    }
    for (const mediaUrl of payload?.mediaUrls || []) {
      if (typeof mediaUrl === "string" && mediaUrl.trim()) {
        media.add(mediaUrl.trim());
      }
    }
  }

  return [...media];
}

async function loadEmbeddedPiAgentRunner() {
  try {
    const mod = await import("./superIntelligence/agents/pi-embedded.js");
    return mod.runEmbeddedPiAgent;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Embedded OpenClaw runtime is not ready in this build: ${detail}`,
    );
  }
}

export async function executeOpenClawNativePrompt(
  params: ExecuteOpenClawNativePromptParams,
): Promise<ExecuteOpenClawNativePromptResult> {
  const prompt = String(params.prompt || "").trim();
  if (!prompt) {
    throw new Error("prompt is required");
  }

  const userSeed = sanitizeSegment(params.userId, "anon");
  const chatSeed = sanitizeSegment(params.chatId, randomUUID().slice(0, 8));
  const runId = randomUUID().slice(0, 8);

  const sessionId = `iliagpt-native-${userSeed}-${chatSeed}`.slice(0, 180);
  const sessionKey = `iliagpt:native:${userSeed}:${chatSeed}`.slice(0, 180);
  const sessionRoot = path.join(os.tmpdir(), NATIVE_SESSION_ROOT, userSeed);
  const sessionFile = path.join(sessionRoot, `${chatSeed}.jsonl`);
  const workspaceDir = process.env.OPENCLAW_WORKSPACE_ROOT?.trim()
    ? path.resolve(process.env.OPENCLAW_WORKSPACE_ROOT)
    : path.join(os.tmpdir(), "iliagpt-openclaw-workspaces", userSeed);
  const agentDir =
    resolveUserScopedAgentDir(params.userId) || path.join(sessionRoot, "agent");

  await fs.mkdir(sessionRoot, { recursive: true });
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });

  const loggerCtx = { userId: userSeed, chatId: chatSeed, runId };
  console.log(JSON.stringify({
    level: "info", timestamp: new Date().toISOString(), event: "openclaw.native.start",
    message: "Initiating native agent execution", ...loggerCtx,
    workspaceDir, agentDir, toolsEnabled: params.enableTools
  }));

  const abortController = new AbortController();
  const cleanupHandler = async () => {
    console.log(JSON.stringify({ level: "warn", timestamp: new Date().toISOString(), event: "openclaw.native.abort", message: "Graceful shutdown requested, aborting agent run", runId }));
    abortController.abort();
  };
  
  // Register globally for SIGTERM
  import("../lib/gracefulShutdown.js").then(({ registerCleanup }) => registerCleanup(cleanupHandler)).catch(() => {});

  try {
    const runEmbeddedPiAgent = await loadEmbeddedPiAgentRunner();
    const result = await runEmbeddedPiAgent({
      sessionId,
      sessionKey,
      sessionFile,
      workspaceDir,
      agentDir,
      prompt: buildNativePrompt(prompt, params.context),
      provider: params.provider?.trim() || undefined,
      model: params.model?.trim() || undefined,
      timeoutMs: clampTimeout(params.timeoutMs),
      runId,
      disableTools: params.enableTools === true ? false : true,
      messageChannel: "api",
      messageProvider: "iliagpt-openclaw-native",
    });

    const response = collectText(result);
    
    console.log(JSON.stringify({
      level: result.meta?.error ? "error" : "info", timestamp: new Date().toISOString(), event: "openclaw.native.complete",
      message: result.meta?.error ? "Agent execution finished with error" : "Agent execution succeeded",
      ...loggerCtx, durationMs: result.meta?.durationMs,
      error: result.meta?.error?.message,
    }));

    return {
      engine: "OpenClaw native embedded runtime",
      sessionId,
      sessionKey,
      workspaceDir,
      response:
        response ||
        result.meta?.error?.message ||
        "El runtime nativo completo la solicitud sin salida textual.",
      payloads: result.payloads || [],
      mediaUrls: collectMediaUrls(result),
      meta: result.meta,
      nativeToolsEnabled: params.enableTools === true,
    };
  } catch (err: any) {
    if (abortController.signal.aborted) {
      console.log(JSON.stringify({ level: "warn", timestamp: new Date().toISOString(), event: "openclaw.native.terminated", message: "Agent forcefully halted during graceful shutdown", ...loggerCtx }));
      throw new Error("Agent execution interrupted by server shutdown (Graceful Exit)");
    }
    console.log(JSON.stringify({ level: "error", timestamp: new Date().toISOString(), event: "openclaw.native.crash", message: "Catastrophic crash inside agent wrapper", error: err.message, ...loggerCtx }));
    throw err;
  }
}
