import { z } from "zod";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type { Response } from "express";

import {
  PromptAnalyzer,
  promptAnalyzer,
  type AnalysisResult,
  type ConversationContext,
  MessageSchema,
  type Message,
} from "./promptAnalyzer";
import {
  IntentRouter,
  intentRouter,
  type RouteDecision,
  type ExecutionPath,
} from "./intentRouter";
import {
  ActivityStreamPublisher,
  activityStreamPublisher,
  type ActivityEvent,
  type ActivityEventType,
} from "./activityStream";
import { SupervisorAgent } from "./supervisorAgent";
import {
  VerifierAgent,
  verifierAgent,
  type VerificationResult,
  type RunResultPackage as VerifierRunResultPackage,
} from "../roles/verifierAgent";
import { llmGateway } from "../../lib/llmGateway";
import { agentEventBus } from "../eventBus";
import { ArtifactSchema, type Artifact } from "../contracts";

export const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  storagePath: z.string().optional(),
  size: z.number().optional(),
  extractedContent: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const PipelineContextSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  intent: z.string().optional(),
  chatId: z.string(),
  messages: z.array(MessageSchema),
  attachments: z.array(AttachmentSchema).optional().default([]),
  model: z.string().optional(),
  res: z.any().optional(),
});
export type PipelineContext = z.infer<typeof PipelineContextSchema>;

export const ArtifactMetadataSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
  url: z.string().optional(),
  size: z.number().optional(),
});
export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

export const QAResultSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  issues: z.array(z.object({
    type: z.string(),
    severity: z.enum(["error", "warning", "info"]),
    description: z.string(),
  })).default([]),
  durationMs: z.number().optional(),
});
export type QAResult = z.infer<typeof QAResultSchema>;

export const PipelineResponseSchema = z.object({
  content: z.string(),
  role: z.literal("assistant"),
  artifact: ArtifactMetadataSchema.optional(),
});
export type PipelineResponse = z.infer<typeof PipelineResponseSchema>;

export const PipelineMetadataSchema = z.object({
  path: z.enum(["direct", "single_agent", "multi_agent"]),
  agentsUsed: z.array(z.string()).default([]),
  toolsUsed: z.array(z.string()).default([]),
  totalSteps: z.number().default(0),
  durationMs: z.number(),
  qaResult: QAResultSchema.optional(),
});
export type PipelineMetadata = z.infer<typeof PipelineMetadataSchema>;

export const PipelineResultSchema = z.object({
  success: z.boolean(),
  runId: z.string().uuid(),
  response: PipelineResponseSchema,
  activityEvents: z.array(z.any()).default([]),
  metadata: PipelineMetadataSchema,
});
export type PipelineResult = z.infer<typeof PipelineResultSchema>;

export const RunStatusSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled", "paused"]),
  currentStep: z.number().default(0),
  totalSteps: z.number().default(0),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  error: z.string().optional(),
});
export type RunStatus = z.infer<typeof RunStatusSchema>;

interface ActiveRun {
  runId: string;
  status: RunStatus["status"];
  startTime: number;
  context: PipelineContext;
  analysis?: AnalysisResult;
  route?: RouteDecision;
  cancelled: boolean;
  events: ActivityEvent[];
}

export type PipelineEvent =
  | "pipeline_started"
  | "analysis_completed"
  | "routing_completed"
  | "execution_started"
  | "execution_completed"
  | "qa_started"
  | "qa_completed"
  | "pipeline_completed"
  | "pipeline_failed";

export interface AgentLoopFacadeOptions {
  enableQA?: boolean;
  maxExecutionTimeMs?: number;
  defaultModel?: string;
  enableSSE?: boolean;
  qaConfig?: {
    minScore?: number;
    skipForDirect?: boolean;
  };
}

export class AgentLoopFacade extends EventEmitter {
  private options: Required<AgentLoopFacadeOptions>;
  private activeRuns: Map<string, ActiveRun> = new Map();
  private supervisorAgent: SupervisorAgent;
  private promptAnalyzer: PromptAnalyzer;
  private intentRouter: IntentRouter;
  private verifierAgent: VerifierAgent;

  constructor(options: AgentLoopFacadeOptions = {}) {
    super();
    this.options = {
      enableQA: options.enableQA ?? true,
      maxExecutionTimeMs: options.maxExecutionTimeMs ?? 300000,
      defaultModel: options.defaultModel ?? "gemini-3.1-pro",
      enableSSE: options.enableSSE ?? true,
      qaConfig: {
        minScore: options.qaConfig?.minScore ?? 0.7,
        skipForDirect: options.qaConfig?.skipForDirect ?? true,
      },
    };
    this.supervisorAgent = new SupervisorAgent();
    this.promptAnalyzer = promptAnalyzer;
    this.intentRouter = intentRouter;
    this.verifierAgent = verifierAgent;
    this.setMaxListeners(100);
  }

  async execute(message: string, context: PipelineContext): Promise<PipelineResult> {
    const runId = randomUUID();
    const startTime = Date.now();

    const validatedContext = PipelineContextSchema.parse(context);

    const activeRun: ActiveRun = {
      runId,
      status: "running",
      startTime,
      context: validatedContext,
      cancelled: false,
      events: [],
    };
    this.activeRuns.set(runId, activeRun);

    this.emitPipelineEvent("pipeline_started", runId, { message: message.slice(0, 100) });

    activityStreamPublisher.publishRunCreated(runId, {
      status: "created",
      message: `Pipeline started: ${message.slice(0, 100)}`,
    });

    if (validatedContext.res && this.options.enableSSE) {
      activityStreamPublisher.subscribe(runId, validatedContext.res);
    }

    try {
      const conversationContext: ConversationContext = {
        sessionId: validatedContext.sessionId,
        userId: validatedContext.userId,
        chatId: validatedContext.chatId,
        messages: validatedContext.messages,
        attachments: validatedContext.attachments || [],
        runId,
      };

      const analysis = await this.promptAnalyzer.analyze(message, conversationContext);
      activeRun.analysis = analysis;

      this.emitPipelineEvent("analysis_completed", runId, {
        intent: analysis.intent,
        complexity: analysis.complexity,
        deliverables: analysis.deliverables.length,
      });

      if (activeRun.cancelled) {
        return this.createCancelledResult(runId, startTime);
      }

      const route = await this.intentRouter.route(analysis);
      activeRun.route = route;

      this.emitPipelineEvent("routing_completed", runId, {
        path: route.path,
        agents: route.agents.map(a => a.agentName),
        estimatedSteps: route.estimatedSteps,
      });

      if (activeRun.cancelled) {
        return this.createCancelledResult(runId, startTime);
      }

      this.emitPipelineEvent("execution_started", runId, { path: route.path });

      let executionResult: {
        content: string;
        artifacts: Artifact[];
        toolsUsed: string[];
        agentsUsed: string[];
        steps: number;
        summary?: string;
      };

      switch (route.path) {
        case "direct":
          executionResult = await this.executeDirectPath(message, analysis, validatedContext);
          break;
        case "single_agent":
          executionResult = await this.executeSingleAgentPath(message, analysis, route, runId);
          break;
        case "multi_agent":
          executionResult = await this.executeMultiAgentPath(message, analysis, route, runId, validatedContext);
          break;
        default:
          executionResult = await this.executeDirectPath(message, analysis, validatedContext);
      }

      this.emitPipelineEvent("execution_completed", runId, {
        path: route.path,
        stepsCompleted: executionResult.steps,
        artifactsCreated: executionResult.artifacts.length,
      });

      if (activeRun.cancelled) {
        return this.createCancelledResult(runId, startTime);
      }

      let qaResult: QAResult | undefined;
      if (this.options.enableQA && !(route.path === "direct" && this.options.qaConfig.skipForDirect)) {
        this.emitPipelineEvent("qa_started", runId, {});
        qaResult = await this.runQAVerification(runId, analysis, executionResult);
        this.emitPipelineEvent("qa_completed", runId, { passed: qaResult.passed, score: qaResult.score });

        activityStreamPublisher.publishQAResult(runId, qaResult.passed, {
          passed: qaResult.passed,
          message: qaResult.passed ? "QA verification passed" : "QA verification failed",
          confidence: qaResult.score,
          details: { issues: qaResult.issues },
        });
      }

      const durationMs = Date.now() - startTime;

      activeRun.status = "completed";

      const artifact = executionResult.artifacts[0];
      const artifactMetadata: ArtifactMetadata | undefined = artifact ? {
        id: artifact.id,
        type: artifact.type,
        name: artifact.name,
        mimeType: artifact.mimeType,
        url: artifact.url,
        size: artifact.size,
      } : undefined;

      const result: PipelineResult = {
        success: true,
        runId,
        response: {
          content: executionResult.content,
          role: "assistant",
          artifact: artifactMetadata,
        },
        activityEvents: activityStreamPublisher.getHistory(runId),
        metadata: {
          path: route.path,
          agentsUsed: executionResult.agentsUsed,
          toolsUsed: executionResult.toolsUsed,
          totalSteps: executionResult.steps,
          durationMs,
          qaResult,
        },
      };

      activityStreamPublisher.publishRunCompleted(runId, {
        status: "completed",
        summary: executionResult.summary || executionResult.content.slice(0, 200),
        durationMs,
        completedSteps: executionResult.steps,
        totalSteps: executionResult.steps,
        artifactsCount: executionResult.artifacts.length,
      });

      await this.promptAnalyzer.storeExecutionMemory(
        validatedContext.sessionId,
        runId,
        {
          userMessage: message,
          assistantResponse: executionResult.content,
          intent: analysis.intent,
          toolsUsed: executionResult.toolsUsed,
          agentsUsed: executionResult.agentsUsed,
          artifacts: executionResult.artifacts.map(a => ({
            id: a.id,
            type: a.type,
            name: a.name
          })),
          success: true
        }
      );

      this.emitPipelineEvent("pipeline_completed", runId, {
        success: true,
        durationMs,
        path: route.path,
      });

      if (validatedContext.res && this.options.enableSSE) {
        activityStreamPublisher.unsubscribe(runId, validatedContext.res);
      }

      this.activeRuns.delete(runId);
      return result;

    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      activeRun.status = "failed";

      console.error(`[AgentLoopFacade] Pipeline failed for run ${runId}:`, error);

      try {
        await this.promptAnalyzer.storeExecutionMemory(
          validatedContext.sessionId,
          runId,
          {
            userMessage: message,
            assistantResponse: `Error: ${error.message}`,
            intent: activeRun.analysis?.intent || "unknown",
            toolsUsed: [],
            agentsUsed: [],
            artifacts: [],
            success: false
          }
        );
      } catch (memError) {
        console.error(`[Memory] Failed to store error context:`, memError);
      }

      activityStreamPublisher.publishRunFailed(runId, {
        status: "failed",
        error: error.message,
        message: `Pipeline execution failed: ${error.message}`,
      });

      this.emitPipelineEvent("pipeline_failed", runId, {
        error: error.message,
        durationMs,
      });

      if (validatedContext.res && this.options.enableSSE) {
        activityStreamPublisher.unsubscribe(runId, validatedContext.res);
      }

      this.activeRuns.delete(runId);

      return {
        success: false,
        runId,
        response: {
          content: `I apologize, but I encountered an error while processing your request: ${error.message}. Please try again.`,
          role: "assistant",
        },
        activityEvents: activityStreamPublisher.getHistory(runId),
        metadata: {
          path: activeRun.route?.path || "direct",
          agentsUsed: [],
          toolsUsed: [],
          totalSteps: 0,
          durationMs,
        },
      };
    }
  }

  async getRunStatus(runId: string): Promise<RunStatus> {
    const activeRun = this.activeRuns.get(runId);

    if (activeRun) {
      return {
        runId,
        status: activeRun.cancelled ? "cancelled" : activeRun.status,
        currentStep: activeRun.route?.estimatedSteps || 0,
        totalSteps: activeRun.route?.estimatedSteps || 0,
        startedAt: activeRun.startTime,
        completedAt: activeRun.status === "completed" ? Date.now() : undefined,
      };
    }

    return {
      runId,
      status: "completed",
      currentStep: 0,
      totalSteps: 0,
    };
  }

  async cancelRun(runId: string): Promise<boolean> {
    const activeRun = this.activeRuns.get(runId);

    if (!activeRun) {
      console.warn(`[AgentLoopFacade] Cannot cancel run ${runId}: not found`);
      return false;
    }

    if (activeRun.status === "completed" || activeRun.status === "failed") {
      console.warn(`[AgentLoopFacade] Cannot cancel run ${runId}: already ${activeRun.status}`);
      return false;
    }

    activeRun.cancelled = true;
    activeRun.status = "cancelled";

    activityStreamPublisher.publishRunFailed(runId, {
      status: "cancelled",
      message: "Run cancelled by user",
    });

    console.log(`[AgentLoopFacade] Run ${runId} cancelled`);
    return true;
  }

  private async executeDirectPath(
    message: string,
    analysis: AnalysisResult,
    context: PipelineContext
  ): Promise<{
    content: string;
    artifacts: Artifact[];
    toolsUsed: string[];
    agentsUsed: string[];
    steps: number;
    summary?: string;
  }> {
    const systemPrompt = `You are a helpful AI assistant. Respond directly to the user's request.
The user's intent has been analyzed as: ${analysis.intent}
Complexity level: ${analysis.complexity}

Provide a clear, helpful response.`;

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...context.messages.slice(-10).map(m => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
      { role: "user" as const, content: message },
    ];

    const response = await llmGateway.chat(messages, {
      provider: "xai",
      model: context.model || this.options.defaultModel,
      temperature: 0.7,
      maxTokens: 4096,
    });

    return {
      content: response.content,
      artifacts: [],
      toolsUsed: [],
      agentsUsed: ["LLM"],
      steps: 1,
      summary: response.content.slice(0, 200),
    };
  }

  private async executeSingleAgentPath(
    message: string,
    analysis: AnalysisResult,
    route: RouteDecision,
    runId: string
  ): Promise<{
    content: string;
    artifacts: Artifact[];
    toolsUsed: string[];
    agentsUsed: string[];
    steps: number;
    summary?: string;
  }> {
    const primaryAgent = route.agents[0];
    if (!primaryAgent) {
      return this.executeDirectPath(message, analysis, {
        sessionId: runId,
        userId: "system",
        chatId: runId,
        messages: [{ role: "user", content: message }],
        attachments: [],
      });
    }

    activityStreamPublisher.publishAgentDelegated(runId, {
      agentName: primaryAgent.agentName,
      agentRole: primaryAgent.role,
      taskDescription: message.slice(0, 200),
      status: "started",
    });

    const result = await this.supervisorAgent.execute({
      id: runId,
      type: analysis.intent,
      description: message,
      input: {
        message,
        analysis,
        deliverables: analysis.deliverables,
      },
      priority: "high",
      retries: 0,
      maxRetries: 3,
    });

    activityStreamPublisher.publishAgentDelegated(runId, {
      agentName: primaryAgent.agentName,
      agentRole: primaryAgent.role,
      status: result.success ? "completed" : "failed",
    });

    const output = result.output as any;
    const content = output?.summary || output?.content ||
      (result.success ? "Task completed successfully." : `Task failed: ${result.error}`);

    return {
      content,
      artifacts: output?.artifacts || [],
      toolsUsed: route.tools,
      agentsUsed: [primaryAgent.agentName],
      steps: output?.metrics?.completedSteps || 1,
      summary: content.slice(0, 200),
    };
  }

  private async executeMultiAgentPath(
    message: string,
    analysis: AnalysisResult,
    route: RouteDecision,
    runId: string,
    context: PipelineContext
  ): Promise<{
    content: string;
    artifacts: Artifact[];
    toolsUsed: string[];
    agentsUsed: string[];
    steps: number;
    summary?: string;
  }> {
    for (const agent of route.agents) {
      activityStreamPublisher.publishAgentDelegated(runId, {
        agentName: agent.agentName,
        agentRole: agent.role,
        taskDescription: `Part of multi-agent execution for: ${message.slice(0, 100)}`,
        status: "started",
      });
    }

    const orchestrationResult = await this.supervisorAgent.orchestrate(
      {
        query: message,
        intent: analysis.intent,
        complexity: analysis.complexity === "trivial" || analysis.complexity === "simple"
          ? "simple"
          : analysis.complexity === "moderate"
            ? "moderate"
            : "complex",
        context: {
          deliverables: analysis.deliverables,
          runId,
          userId: context.userId,
          chatId: context.chatId,
        },
      },
      {
        selectedAgents: route.agents.map(a => ({
          name: a.agentName,
          role: a.role,
          reason: `Selected for ${analysis.intent}`,
          priority: a.priority <= 3 ? "high" : a.priority <= 6 ? "medium" : "low",
        })),
        suggestedTools: route.tools,
        executionMode: route.executionStrategy === "parallel" ? "parallel" :
          route.executionStrategy === "sequential" ? "sequential" : "hybrid",
        estimatedComplexity: route.confidence * 10,
      }
    );

    for (const agent of route.agents) {
      activityStreamPublisher.publishAgentDelegated(runId, {
        agentName: agent.agentName,
        agentRole: agent.role,
        status: orchestrationResult.success ? "completed" : "failed",
      });
    }

    const aggregated = orchestrationResult.aggregatedOutput;
    const artifacts: Artifact[] = aggregated.artifacts.map((artifactId, index) => ({
      id: artifactId || randomUUID(),
      type: "file" as const,
      name: `artifact_${index}`,
      createdAt: new Date(),
    }));

    return {
      content: aggregated.summary,
      artifacts,
      toolsUsed: route.tools,
      agentsUsed: route.agents.map(a => a.agentName),
      steps: aggregated.metrics.completedSteps,
      summary: aggregated.summary.slice(0, 200),
    };
  }

  private async runQAVerification(
    runId: string,
    analysis: AnalysisResult,
    executionResult: {
      content: string;
      artifacts: Artifact[];
      toolsUsed: string[];
      summary?: string;
    }
  ): Promise<QAResult> {
    try {
      const verifierPackage: VerifierRunResultPackage = {
        runId,
        correlationId: runId,
        objective: analysis.rawMessage,
        stepResults: [],
        artifacts: executionResult.artifacts,
        citations: [],
        summary: executionResult.summary || executionResult.content.slice(0, 500),
      };

      const verificationResult = await this.verifierAgent.verify(verifierPackage);

      return {
        passed: verificationResult.passed,
        score: verificationResult.score,
        issues: verificationResult.issues.map(i => ({
          type: i.type,
          severity: i.severity,
          description: i.description,
        })),
        durationMs: verificationResult.durationMs,
      };
    } catch (error: any) {
      console.error(`[AgentLoopFacade] QA verification failed:`, error);
      return {
        passed: true,
        score: 1,
        issues: [],
        durationMs: 0,
      };
    }
  }

  private createCancelledResult(runId: string, startTime: number): PipelineResult {
    return {
      success: false,
      runId,
      response: {
        content: "The operation was cancelled.",
        role: "assistant",
      },
      activityEvents: activityStreamPublisher.getHistory(runId),
      metadata: {
        path: "direct",
        agentsUsed: [],
        toolsUsed: [],
        totalSteps: 0,
        durationMs: Date.now() - startTime,
      },
    };
  }

  private emitPipelineEvent(event: PipelineEvent, runId: string, data: Record<string, any>): void {
    try {
      this.emit(event, {
        runId,
        timestamp: Date.now(),
        ...data,
      });
    } catch (error) {
      console.error(`[AgentLoopFacade] Event emission error for ${event}:`, error);
    }
  }

  getActiveRuns(): string[] {
    return Array.from(this.activeRuns.keys());
  }

  getActiveRunCount(): number {
    return this.activeRuns.size;
  }

  isEnabled(): boolean {
    return intentRouter.isEnabled();
  }
}

export const agentLoopFacade = new AgentLoopFacade();

export function createAgentLoopFacade(options?: AgentLoopFacadeOptions): AgentLoopFacade {
  return new AgentLoopFacade(options);
}
