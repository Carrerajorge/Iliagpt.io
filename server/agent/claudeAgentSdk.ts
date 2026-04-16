/**
 * Claude Agent SDK Integration — Uses @anthropic-ai/claude-agent-sdk to power
 * agentic capabilities with native tool calling (Bash, Read, Write, Edit, etc.)
 *
 * This provides a production-ready agent that can execute multi-step tasks
 * using Claude's native tool use with real system access.
 */

import type { Response } from "express";

// Lazy import to avoid breaking if SDK not available
let sdkModule: any = null;

async function getSdk() {
  if (!sdkModule) {
    try {
      sdkModule = await import("@anthropic-ai/claude-agent-sdk");
    } catch {
      throw new Error("Claude Agent SDK not available. Install with: npm install @anthropic-ai/claude-agent-sdk");
    }
  }
  return sdkModule;
}

export interface ClaudeAgentRequest {
  prompt: string;
  userId: string;
  chatId: string;
  /** SSE response to stream events to */
  res?: Response;
  /** Working directory for file operations */
  cwd?: string;
  /** Max agentic turns before stopping */
  maxTurns?: number;
  /** Abort signal */
  signal?: AbortSignal;
  /** Allowed tools (default: all safe tools) */
  tools?: string[];
  /** Custom system prompt addition */
  systemPrompt?: string;
}

export interface ClaudeAgentResult {
  content: string;
  toolsUsed: string[];
  turns: number;
  durationMs: number;
  error?: string;
}

/**
 * Execute a prompt using the Claude Agent SDK with native tool calling.
 * Streams events to the SSE response if provided.
 */
export async function executeClaudeAgent(request: ClaudeAgentRequest): Promise<ClaudeAgentResult> {
  const sdk = await getSdk();
  const startMs = Date.now();
  const toolsUsed: string[] = [];
  let content = "";
  let turns = 0;

  const abortController = new AbortController();
  if (request.signal) {
    request.signal.addEventListener("abort", () => abortController.abort());
  }

  try {
    const queryResult = sdk.query({
      prompt: request.prompt,
      options: {
        abortController,
        cwd: request.cwd || process.cwd(),
        maxTurns: request.maxTurns || 10,
        tools: request.tools || [
          "Read", "Write", "Edit", "Bash", "Glob", "Grep",
          "WebFetch", "WebSearch",
        ],
        allowedTools: [
          "Read", "Glob", "Grep", "WebFetch", "WebSearch",
        ],
        systemPrompt: request.systemPrompt || buildAgentSystemPrompt(),
        permissionMode: "default",
      },
    });

    // Stream events
    for await (const message of queryResult) {
      if (abortController.signal.aborted) break;

      switch (message.type) {
        case "assistant": {
          // Final or partial assistant message
          const text = extractTextContent(message);
          if (text) {
            content = text;
            emitSSE(request.res, "chunk", {
              content: text,
              requestId: request.chatId,
              timestamp: Date.now(),
            });
          }
          turns++;
          break;
        }

        case "stream_event": {
          // Streaming delta
          const event = message.event;
          if (event?.type === "content_block_delta" && (event as any).delta?.text) {
            const delta = (event as any).delta.text;
            content += delta;
            emitSSE(request.res, "chunk", {
              content: delta,
              requestId: request.chatId,
              timestamp: Date.now(),
            });
          }
          // Tool use events
          if (event?.type === "content_block_start" && (event as any).content_block?.type === "tool_use") {
            const toolName = (event as any).content_block.name;
            toolsUsed.push(toolName);
            emitSSE(request.res, "step", {
              id: `tool-${Date.now()}`,
              type: "executing",
              title: `Usando ${toolName}...`,
              status: "running",
              expandable: false,
              timestamp: new Date().toISOString(),
            });
          }
          break;
        }

        case "result": {
          const text = extractTextContent(message);
          if (text) content = text;
          break;
        }

        case "tool_progress": {
          // Tool execution progress
          const toolName = (message as any).tool_name || "tool";
          emitSSE(request.res, "step", {
            id: `progress-${Date.now()}`,
            type: "executing",
            title: `${toolName}: procesando...`,
            status: "running",
            expandable: false,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "status": {
          // Status updates (thinking, etc.)
          const statusMsg = (message as any).message || "";
          if (statusMsg) {
            emitSSE(request.res, "step", {
              id: `status-${Date.now()}`,
              type: "thinking",
              title: statusMsg,
              status: "completed",
              expandable: false,
              timestamp: new Date().toISOString(),
            });
          }
          break;
        }
      }
    }

    return {
      content,
      toolsUsed: [...new Set(toolsUsed)],
      turns,
      durationMs: Date.now() - startMs,
    };
  } catch (error: any) {
    if (error?.name === "AbortError" || abortController.signal.aborted) {
      return {
        content: content || "Ejecución cancelada por el usuario.",
        toolsUsed: [...new Set(toolsUsed)],
        turns,
        durationMs: Date.now() - startMs,
      };
    }

    console.error("[ClaudeAgentSDK] Execution error:", error?.message);
    return {
      content: content || "",
      toolsUsed: [...new Set(toolsUsed)],
      turns,
      durationMs: Date.now() - startMs,
      error: error?.message || "Agent execution failed",
    };
  }
}

/** Check if Claude Agent SDK is available */
export async function isClaudeAgentAvailable(): Promise<boolean> {
  try {
    await getSdk();
    return true;
  } catch {
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildAgentSystemPrompt(): string {
  return `Eres IliaGPT, un asistente agéntico avanzado. Puedes ejecutar herramientas para completar tareas complejas.

REGLAS:
- Piensa paso a paso antes de actuar
- Usa herramientas cuando sea necesario (leer archivos, ejecutar código, buscar en web)
- Siempre verifica tus resultados
- Responde en el idioma del usuario
- Para contenido visual (diagramas, SVG), genera código inline renderizable
- Para documentos, usa las herramientas de escritura de archivos`;
}

function extractTextContent(message: any): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("");
  }
  if (message.message?.content) return extractTextContent(message.message);
  return "";
}

function emitSSE(res: Response | undefined, type: string, data: any): void {
  if (!res || res.writableEnded) return;
  try {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  } catch {
    // Connection closed
  }
}
