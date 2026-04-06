import type { Response } from "express";
import { executeAgentLoop } from "../agentExecutor";
import { agentManager, type AgentEvent, type AgentProgress } from "../agentOrchestrator";
import type { RequestSpec } from "../requestSpec";

export type AgentExecutionMode = "conversation" | "direct_agent_loop" | "structured_orchestrator";
type AgentRuntimeTransport = "native_sse" | "agentic_json";

export interface StreamAgentRuntimeOptions {
  res: Response;
  runId: string;
  userId: string;
  chatId: string;
  requestSpec: RequestSpec;
  executionMode: Exclude<AgentExecutionMode, "conversation">;
  initialMessages: Array<{ role: string; content: string }>;
  accessLevel?: "owner" | "trusted" | "unknown";
  maxIterations?: number;
  model?: string;
  transport?: AgentRuntimeTransport;
}

export interface StreamAgentRuntimeResult {
  finalAnswer: string;
  status: "completed" | "awaiting_confirmation" | "cancelled";
  executionMode: Exclude<AgentExecutionMode, "conversation">;
}

const STRUCTURED_INTENTS = new Set([
  "multi_step_task",
  "research",
  "document_analysis",
  "data_analysis",
  "code_generation",
]);

const DIRECT_INTENTS = new Set([
  "web_automation",
]);

const MULTI_STEP_SIGNAL = /\b(?:step|steps|first|then|next|after|finally|paso a paso|primero|luego|despu[eé]s|adem[aá]s)\b/i;

export function selectAgentExecutionMode(options: {
  requestSpec: RequestSpec;
  rawMessage: string;
  resolvedLane: "fast" | "deep";
  hasAttachments: boolean;
  hasAgenticSignal: boolean;
}): AgentExecutionMode {
  const { requestSpec, rawMessage, resolvedLane, hasAttachments, hasAgenticSignal } = options;
  const intent = requestSpec.intent;
  const looksMultiStep = MULTI_STEP_SIGNAL.test(rawMessage || "");

  if (
    STRUCTURED_INTENTS.has(intent) ||
    requestSpec.primaryAgent === "orchestrator" ||
    (hasAgenticSignal && (resolvedLane === "deep" || looksMultiStep || hasAttachments))
  ) {
    return "structured_orchestrator";
  }

  if (DIRECT_INTENTS.has(intent) || (hasAgenticSignal && intent !== "chat")) {
    return "direct_agent_loop";
  }

  return "conversation";
}

function isWritable(res: Response): boolean {
  const target = res as any;
  return !(target.writableEnded || target.destroyed || target.closed);
}

function writeNativeSse(res: Response, event: string, payload: Record<string, unknown>): void {
  if (!isWritable(res)) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  const target = res as any;
  if (typeof target.flush === "function") {
    target.flush();
  }
}

function writeJsonSse(res: Response, payload: Record<string, unknown>): void {
  if (!isWritable(res)) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  const target = res as any;
  if (typeof target.flush === "function") {
    target.flush();
  }
}

function chunkTextForJson(text: string, size = 180): string[] {
  const safe = String(text || "");
  if (!safe) return [];
  return safe.match(new RegExp(`.{1,${size}}`, "g")) || [safe];
}

function summarizeOutput(output: unknown): unknown {
  if (typeof output === "string") {
    return output.length > 2000 ? `${output.slice(0, 2000)}...(truncated)` : output;
  }
  if (output && typeof output === "object") {
    const serialized = JSON.stringify(output);
    return serialized.length > 2000 ? `${serialized.slice(0, 2000)}...(truncated)` : output;
  }
  return output;
}

function buildProgressMessage(progress: AgentProgress): string {
  const currentStep = progress.plan?.steps?.[progress.currentStepIndex];
  if (progress.status === "awaiting_confirmation") {
    return "Se requiere confirmacion para continuar.";
  }
  if (progress.status === "completed") {
    return "Verificacion final completada.";
  }
  if (progress.status === "verifying") {
    return "Verificando evidencia y resultados.";
  }
  if (currentStep) {
    return `${currentStep.description}`;
  }
  return `Estado actual: ${progress.status}`;
}

function buildConfirmationMessage(runId: string, reason: string, toolName: string): string {
  return `Run ${runId}: se requiere confirmacion para ejecutar ${toolName}. ${reason}`;
}

function buildNativeToJsonAdapter(res: Response, runId: string): Response {
  let buffer = "";

  const forwardFrame = (frame: string) => {
    const lines = frame.split("\n").map((line) => line.trim()).filter(Boolean);
    let eventName = "message";
    let payload: Record<string, any> = {};

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        const raw = line.slice("data:".length).trim();
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = { raw };
        }
      }
    }

    switch (eventName) {
      case "chunk":
        writeJsonSse(res, {
          type: "text_delta",
          runId,
          delta: String(payload.content || ""),
          metadata: { sequence: payload.sequence, nativeEvent: eventName },
        });
        break;
      case "thinking":
        writeJsonSse(res, {
          type: "thinking_delta",
          runId,
          thinking: String(payload.message || payload.content || payload.step || "Analizando..."),
          metadata: { nativeEvent: eventName, step: payload.step },
        });
        break;
      case "clarification":
        writeJsonSse(res, {
          type: "text_delta",
          runId,
          delta: String(payload.question || payload.message || "Se necesita informacion adicional."),
          metadata: { nativeEvent: eventName, missingFields: payload.missingFields || [] },
        });
        break;
      case "error":
        writeJsonSse(res, {
          type: "error",
          runId,
          error: String(payload.message || "Execution error"),
          metadata: { nativeEvent: eventName, code: payload.code },
        });
        break;
      case "done":
        writeJsonSse(res, {
          type: "done",
          runId,
          metadata: payload,
        });
        break;
      case "exec_plan_update":
      case "plan":
      case "progress_update":
      case "search_progress":
      case "artifacts":
        writeJsonSse(res, {
          type: "thinking_delta",
          runId,
          thinking: String(
            payload.message ||
            payload.summary ||
            payload.status ||
            payload.stepId ||
            payload.current ||
            "Actualizando ejecucion...",
          ),
          metadata: { nativeEvent: eventName, ...payload },
        });
        break;
      default:
        break;
    }
  };

  const adapter: Partial<Response> & {
    writableEnded: boolean;
    destroyed: boolean;
    closed: boolean;
    locals: Record<string, unknown>;
  } = {
    writableEnded: false,
    destroyed: false,
    closed: false,
    locals: {},
    write(chunk: any) {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";
      for (const frame of frames) {
        if (frame.trim()) {
          forwardFrame(frame);
        }
      }
      return true;
    },
    end() {
      adapter.writableEnded = true;
      adapter.closed = true;
      if (buffer.trim()) {
        forwardFrame(buffer);
        buffer = "";
      }
      return adapter as Response;
    },
    flush() {
      return undefined;
    },
  };

  return adapter as Response;
}

async function runDirectAgentLoop(options: StreamAgentRuntimeOptions): Promise<StreamAgentRuntimeResult> {
  const {
    res,
    runId,
    userId,
    chatId,
    requestSpec,
    executionMode,
    initialMessages,
    accessLevel,
    maxIterations,
    transport = "native_sse",
  } = options;

  const targetRes = transport === "agentic_json" ? buildNativeToJsonAdapter(res, runId) : res;
  const finalAnswer = await executeAgentLoop(initialMessages, targetRes, {
    runId,
    userId,
    chatId,
    requestSpec,
    accessLevel,
    maxIterations,
  });

  return {
    finalAnswer,
    status: "completed",
    executionMode,
  };
}

async function runStructuredOrchestrator(options: StreamAgentRuntimeOptions): Promise<StreamAgentRuntimeResult> {
  const {
    res,
    runId,
    userId,
    chatId,
    requestSpec,
    executionMode,
    initialMessages,
    model,
    transport = "native_sse",
  } = options;

  const latestUserMessage =
    [...initialMessages].reverse().find((message) => message.role === "user")?.content ||
    requestSpec.rawMessage ||
    "";

  const orchestrator = await agentManager.createRun(
    runId,
    chatId,
    userId,
    latestUserMessage,
    requestSpec.attachments,
    "free",
    model,
  );

  if (transport === "native_sse" && orchestrator.plan) {
    writeNativeSse(res, "plan", {
      runId,
      intent: requestSpec.intent,
      executionMode,
      steps: orchestrator.plan.steps.map((step, index) => ({
        id: `step_${index}`,
        label: step.description,
        status: index === 0 ? "active" : "pending",
        toolName: step.toolName,
      })),
      timestamp: Date.now(),
    });
  } else if (transport === "agentic_json" && orchestrator.plan) {
    writeJsonSse(res, {
      type: "thinking_delta",
      runId,
      thinking: `Plan estructurado listo con ${orchestrator.plan.steps.length} pasos.`,
      metadata: {
        executionMode,
        intent: requestSpec.intent,
        steps: orchestrator.plan.steps.map((step) => ({
          toolName: step.toolName,
          description: step.description,
        })),
      },
    });
  }

  let lastStatus = "";
  let lastStepIndex = -1;
  let emittedArtifacts = 0;

  const emitProgress = (progress: AgentProgress) => {
    if (transport === "native_sse") {
      if (progress.currentStepIndex !== lastStepIndex || progress.status !== lastStatus) {
        const step = progress.plan?.steps?.[progress.currentStepIndex];
        writeNativeSse(res, "exec_plan_update", {
          runId,
          stepId: `step_${progress.currentStepIndex}`,
          status: progress.status,
          label: step?.description,
          toolName: step?.toolName,
          timestamp: Date.now(),
        });
        writeNativeSse(res, "thinking", {
          runId,
          step: progress.status,
          message: buildProgressMessage(progress),
          timestamp: Date.now(),
        });
      }
    } else {
      if (progress.currentStepIndex !== lastStepIndex || progress.status !== lastStatus) {
        writeJsonSse(res, {
          type: "thinking_delta",
          runId,
          thinking: buildProgressMessage(progress),
          metadata: {
            status: progress.status,
            currentStepIndex: progress.currentStepIndex,
            totalSteps: progress.totalSteps,
          },
        });
      }
    }

    if (progress.status === "awaiting_confirmation") {
      const pending = orchestrator.getPendingConfirmation();
      if (pending) {
        const confirmationMessage = buildConfirmationMessage(runId, pending.reason, pending.toolName);
        if (transport === "native_sse") {
          writeNativeSse(res, "confirmation", {
            runId,
            status: "awaiting_confirmation",
            toolName: pending.toolName,
            reason: pending.reason,
            message: confirmationMessage,
            timestamp: Date.now(),
          });
        } else {
          writeJsonSse(res, {
            type: "text_delta",
            runId,
            delta: confirmationMessage,
            metadata: {
              status: "awaiting_confirmation",
              toolName: pending.toolName,
            },
          });
        }
      }
    }

    if (progress.artifacts.length > emittedArtifacts) {
      const newArtifacts = progress.artifacts.slice(emittedArtifacts);
      emittedArtifacts = progress.artifacts.length;
      if (transport === "native_sse") {
        writeNativeSse(res, "artifacts", {
          runId,
          artifacts: newArtifacts,
          count: progress.artifacts.length,
          timestamp: Date.now(),
        });
      } else {
        writeJsonSse(res, {
          type: "thinking_delta",
          runId,
          thinking: `Artifacts generados: ${progress.artifacts.length}.`,
          metadata: {
            artifacts: newArtifacts,
            count: progress.artifacts.length,
          },
        });
      }
    }

    lastStatus = progress.status;
    lastStepIndex = progress.currentStepIndex;
  };

  const emitEvent = ({ event }: { runId: string; event: AgentEvent; eventStream: AgentEvent[] }) => {
    const content = event.content || {};

    if (transport === "native_sse") {
      if (event.type === "action" && content.type === "execute_step") {
        writeNativeSse(res, "tool_call_start", {
          runId,
          stepIndex: content.stepIndex,
          toolName: content.toolName,
          input: content.input,
          timestamp: Date.now(),
        });
        return;
      }

      if (event.type === "observation" && content.type === "step_result") {
        writeNativeSse(res, "tool_call_result", {
          runId,
          stepIndex: content.stepIndex,
          toolName: orchestrator.plan?.steps?.[content.stepIndex]?.toolName,
          success: Boolean(content.success),
          output: summarizeOutput(content),
          timestamp: Date.now(),
        });
        return;
      }

      if (event.type === "verification") {
        writeNativeSse(res, "thinking", {
          runId,
          step: "verification",
          message: String(event.summary || content.feedback || "Verificando evidencia..."),
          confidence: event.confidence,
          timestamp: Date.now(),
        });
        return;
      }

      if (event.type === "error") {
        writeNativeSse(res, "error", {
          runId,
          message: String(content.error || content.message || "Structured runtime error"),
          timestamp: Date.now(),
        });
      }
      return;
    }

    if (event.type === "action" && content.type === "execute_step") {
      writeJsonSse(res, {
        type: "tool_call_start",
        runId,
        index: content.stepIndex,
        toolName: String(content.toolName || "tool"),
        toolArgs: content.input || {},
        metadata: { description: content.description },
      });
      return;
    }

    if (event.type === "observation" && content.type === "step_result") {
      writeJsonSse(res, {
        type: "tool_result",
        runId,
        index: content.stepIndex,
        result: summarizeOutput(content),
        metadata: {
          success: Boolean(content.success),
          artifactCount: Number(content.artifactCount || 0),
          duration: content.duration,
        },
      });
      return;
    }

    if (event.type === "verification") {
      writeJsonSse(res, {
        type: "thinking_delta",
        runId,
        thinking: String(event.summary || content.feedback || "Verificando evidencia..."),
        metadata: {
          phase: "verification",
          confidence: event.confidence,
          shouldRetry: event.shouldRetry,
          shouldReplan: event.shouldReplan,
        },
      });
      return;
    }

    if (event.type === "error") {
      writeJsonSse(res, {
        type: "error",
        runId,
        error: String(content.error || content.message || "Structured runtime error"),
      });
    }
  };

  const status = await new Promise<"completed" | "awaiting_confirmation" | "cancelled">((resolve, reject) => {
    const resolveIfTerminal = (progress: AgentProgress) => {
      if (progress.status === "completed" || progress.status === "awaiting_confirmation" || progress.status === "cancelled") {
        cleanup();
        resolve(progress.status);
      } else if (progress.status === "failed") {
        cleanup();
        reject(new Error("Structured orchestrator failed"));
      }
    };

    const cleanup = () => {
      orchestrator.off("progress", emitProgress);
      orchestrator.off("progress", resolveIfTerminal);
      orchestrator.off("event", emitEvent as any);
      orchestrator.off("error", handleError);
    };

    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    orchestrator.on("progress", emitProgress);
    orchestrator.on("event", emitEvent as any);
    orchestrator.on("error", handleError);
    orchestrator.on("progress", resolveIfTerminal);

    void agentManager.executeRun(runId).catch((error) => {
      cleanup();
      reject(error);
    });
  });

  let finalAnswer = orchestrator.summary;
  if (!finalAnswer) {
    if (status === "awaiting_confirmation") {
      const pending = orchestrator.getPendingConfirmation();
      finalAnswer = pending
        ? buildConfirmationMessage(runId, pending.reason, pending.toolName)
        : "La ejecucion quedo pausada esperando confirmacion.";
    } else if (status === "cancelled") {
      finalAnswer = "La ejecucion fue cancelada antes de completarse.";
    } else {
      finalAnswer = await orchestrator.generateSummary();
    }
  }

  if (finalAnswer) {
    if (transport === "native_sse") {
      const chunks = chunkTextForJson(finalAnswer, 160);
      for (let index = 0; index < chunks.length; index++) {
        writeNativeSse(res, "chunk", {
          runId,
          content: chunks[index],
          sequence: index + 1,
          timestamp: Date.now(),
        });
      }
      writeNativeSse(res, "done", {
        runId,
        executionMode,
        status,
        timestamp: Date.now(),
      });
    } else {
      for (const chunk of chunkTextForJson(finalAnswer, 160)) {
        writeJsonSse(res, {
          type: "text_delta",
          runId,
          delta: chunk,
          metadata: { executionMode, status },
        });
      }
      writeJsonSse(res, {
        type: "done",
        runId,
        metadata: { executionMode, status },
      });
    }
  }

  return {
    finalAnswer,
    status,
    executionMode,
  };
}

export async function streamAgentRuntime(options: StreamAgentRuntimeOptions): Promise<StreamAgentRuntimeResult> {
  if (options.executionMode === "direct_agent_loop") {
    return runDirectAgentLoop(options);
  }
  return runStructuredOrchestrator(options);
}
