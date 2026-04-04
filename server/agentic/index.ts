/**
 * server/agentic/index.ts — Agentic system entry point.
 *
 * Wires together:
 *   - AutonomousAgentBrain (planner + executor loop)
 *   - AgentOrchestrator (multi-step planning with verification)
 *   - ClaudeComputerUse (browser automation)
 *   - Tool registry and execution
 *
 * Exposes: executeAgenticTask(), the single entry point for agentic requests.
 */

// ── ClaudeComputerUse ────────────────────────────────────────────────────────
export {
  ClaudeComputerUse,
  claudeComputerUse,
  type ComputerUseConfig,
  type ComputerAction,
  type ActionResult,
  type ComputerUseResult,
  type SessionState as ComputerSessionState,
  type VerificationResult as ComputerVerificationResult,
} from "./ClaudeComputerUse";

// ── Agent Brain ───────────────────────────────────────────────────────────────
export {
  AutonomousAgentBrain,
  brain as agentBrain,
  type AgentContext,
} from "../agent/autonomousAgentBrain";

// ── Agent Orchestrator (planner/verifier loop) ────────────────────────────────
export {
  type PlanStep,
  type AgentPlan,
  type AgentStatus,
  type StepResult as AgentStepResult,
  type AgentEvent,
  type AgentProgress,
  type VerificationResult as AgentVerificationResult,
} from "../agent/agentOrchestrator";

// ── Agent Executor ────────────────────────────────────────────────────────────
export {
  executeAgentLoop,
  type AgentExecutorOptions,
} from "../agent/agentExecutor";

// ── Orchestrator API ──────────────────────────────────────────────────────────
export * from "../agent/orchestrator/index";

// ── Convenience entry point ───────────────────────────────────────────────────

import { EventEmitter } from "events";
import { brain } from "../agent/autonomousAgentBrain";
import { executeAgentLoop } from "../agent/agentExecutor";
import { claudeComputerUse } from "./ClaudeComputerUse";
import { createLogger } from "../utils/logger";

const logger = createLogger("AgenticSystem");

export interface AgenticTaskOptions {
  task: string;
  userId?: string;
  conversationId?: string;
  sessionId?: string;
  useBrowser?: boolean;
  useTools?: boolean;
  maxSteps?: number;
  onProgress?: (event: {
    step: number;
    action: string;
    result?: unknown;
    thinking?: string;
  }) => void;
}

export interface AgenticTaskResult {
  success: boolean;
  output: string;
  steps: Array<{ action: string; result: unknown; durationMs: number }>;
  totalDurationMs: number;
  sessionId: string;
}

/**
 * Primary entry point for executing an agentic task.
 *
 * Selects the appropriate agent strategy based on task type:
 * - Browser tasks → ClaudeComputerUse
 * - Tool-using tasks → AgentBrain with tool loop
 * - Complex reasoning → AgentOrchestrator planner
 */
export async function executeAgenticTask(
  options: AgenticTaskOptions
): Promise<AgenticTaskResult> {
  const {
    task,
    userId,
    conversationId,
    sessionId = `session_${Date.now()}`,
    useBrowser = false,
    useTools = true,
    maxSteps = 15,
    onProgress,
  } = options;

  const startTime = Date.now();
  logger.info(`Agentic task started: "${task.slice(0, 60)}" (session: ${sessionId})`);

  try {
    // Browser automation path
    if (useBrowser) {
      const result = await claudeComputerUse.executeTask(
        task,
        sessionId,
        (action, actionResult) => {
          onProgress?.({
            step: 0,
            action: action.type,
            result: { success: actionResult.success, error: actionResult.error },
          });
        }
      );

      return {
        success: result.success,
        output: result.summary,
        steps: result.actions.map((a, i) => ({
          action: a.action.type,
          result: { success: a.success, error: a.error },
          durationMs: 0,
        })),
        totalDurationMs: result.sessionDuration,
        sessionId,
      };
    }

    // Tool-using agent path
    if (useTools) {
      const emitter = new EventEmitter();
      const steps: AgenticTaskResult["steps"] = [];

      emitter.on("step", (event: { action: string; result: unknown }) => {
        const step = { action: event.action, result: event.result, durationMs: Date.now() - startTime };
        steps.push(step);
        onProgress?.({ step: steps.length, action: event.action, result: event.result });
      });

      const loopResult = await executeAgentLoop(
        {
          task,
          userId,
          conversationId,
          maxIterations: maxSteps,
          enableReflection: true,
        },
        emitter
      );

      return {
        success: loopResult.success ?? true,
        output: typeof loopResult === "string" ? loopResult : loopResult.result ?? task,
        steps,
        totalDurationMs: Date.now() - startTime,
        sessionId,
      };
    }

    // Fallback: direct brain invocation
    const agentCtx = {
      userId: userId ?? "anonymous",
      conversationId: conversationId ?? sessionId,
      task,
      tools: [],
    };

    const brainResult = await brain.think(agentCtx);

    return {
      success: true,
      output: typeof brainResult === "string" ? brainResult : JSON.stringify(brainResult),
      steps: [],
      totalDurationMs: Date.now() - startTime,
      sessionId,
    };
  } catch (err) {
    logger.error(`Agentic task failed: ${(err as Error).message}`, err);
    return {
      success: false,
      output: `Task failed: ${(err as Error).message}`,
      steps: [],
      totalDurationMs: Date.now() - startTime,
      sessionId,
    };
  }
}

/**
 * Stop a running browser session.
 */
export async function stopAgenticSession(sessionId: string): Promise<void> {
  await claudeComputerUse.stopSession(sessionId);
  logger.info(`Agentic session stopped: ${sessionId}`);
}
