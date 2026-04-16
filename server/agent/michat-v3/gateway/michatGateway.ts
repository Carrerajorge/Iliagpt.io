/**
 * MICHAT v3.1 — Gateway Multi-tenant
 * Rate limiting distribuido, sesiones, idempotencia, durabilidad
 */

import { UXLevel, UXResponse } from "../ux/types";
import { UXRenderer } from "../ux/renderer";
import { SessionStore } from "../infra/sessionStore";
import { DistributedRateLimiter } from "../infra/distributedRateLimiter";
import { DurableQueue } from "../infra/durableQueue";
import { AgentRunnerV31, ToolCall, WorkflowStep, WorkflowResult, AgentDefinition, LLMConfig } from "../runner/agentRunnerV31";
import { MichatError } from "../errors";

export interface TenantContext {
  tenantId: string;
  plan: "free" | "pro" | "enterprise";
  uiLevelDefault: UXLevel;
  maxMessagesInSession: number;
  rateLimitTokens: number;
  rateLimitIntervalMs: number;
}

export const TenantDefaults: Record<TenantContext["plan"], Omit<TenantContext, "tenantId">> = {
  free: {
    plan: "free",
    uiLevelDefault: "minimal",
    maxMessagesInSession: 40,
    rateLimitTokens: 10,
    rateLimitIntervalMs: 60000,
  },
  pro: {
    plan: "pro",
    uiLevelDefault: "standard",
    maxMessagesInSession: 120,
    rateLimitTokens: 60,
    rateLimitIntervalMs: 60000,
  },
  enterprise: {
    plan: "enterprise",
    uiLevelDefault: "standard",
    maxMessagesInSession: 300,
    rateLimitTokens: 300,
    rateLimitIntervalMs: 60000,
  },
};

export interface GatewayRequest {
  sessionId: string;
  message: string;
  user?: {
    id?: string;
    name?: string;
    roles?: string[];
    capabilities?: string[];
    tenantId?: string;
  };
  tenant?: TenantContext;
  uxLevel?: UXLevel;
  idempotencyKey?: string;
}

export interface GatewayDependencies {
  session: SessionStore;
  rateLimiter: DistributedRateLimiter;
  queue: DurableQueue;
  runner: AgentRunnerV31;
  exec: {
    executeTool: (
      call: ToolCall,
      ctx: { requestId: string; traceId: string; user?: GatewayRequest["user"]; tenant: TenantContext }
    ) => Promise<unknown>;
    runWorkflow: (
      steps: WorkflowStep[],
      ctx: { requestId: string; traceId: string; user?: GatewayRequest["user"]; tenant: TenantContext }
    ) => Promise<WorkflowResult>;
  };
  resolveAgent: (msg: string, user?: GatewayRequest["user"]) => Promise<AgentDefinition>;
  llmCfg: LLMConfig;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class MichatGateway {
  private idempotencyCache = new Map<string, UXResponse>();
  private renderer = new UXRenderer();

  constructor(private deps: GatewayDependencies) {}

  async handle(req: GatewayRequest): Promise<UXResponse> {
    const tenant: TenantContext = req.tenant ?? {
      tenantId: req.user?.tenantId ?? "default",
      ...TenantDefaults.pro,
    };

    const requestId = generateId("req");
    const traceId = generateId("trace");

    if (req.idempotencyKey) {
      const cached = this.idempotencyCache.get(req.idempotencyKey);
      if (cached) {
        return { ...cached, requestId };
      }
    }

    const rateLimitKey = `t:${tenant.tenantId}:u:${req.user?.id ?? "anon"}`;
    const allowed = await this.deps.rateLimiter.allow(rateLimitKey, 1);
    if (!allowed) {
      throw new MichatError("E_RATE_LIMIT", "Rate limited", {
        tenantId: tenant.tenantId,
        userId: req.user?.id,
      });
    }

    await this.deps.session.append(req.sessionId, {
      role: "user",
      content: req.message,
    });
    await this.deps.session.trim(req.sessionId, tenant.maxMessagesInSession);

    const agent = await this.deps.resolveAgent(req.message, req.user);

    const uxLevel = req.uxLevel ?? tenant.uiLevelDefault;
    const response = await this.deps.runner.run({
      agent,
      userTask: req.message,
      ctx: {
        requestId,
        traceId,
        user: req.user,
        uiLevel: uxLevel,
      },
      llmCfg: this.deps.llmCfg,
      exec: {
        executeTool: (call) =>
          this.deps.exec.executeTool(call, { requestId, traceId, user: req.user, tenant }),
        runWorkflow: (steps) =>
          this.deps.exec.runWorkflow(steps, { requestId, traceId, user: req.user, tenant }),
      },
    });

    const assistantText = response.blocks
      .filter((b) => b.type === "text" || b.type === "notice")
      .map((b: any) => b.text)
      .join("\n");

    await this.deps.session.append(req.sessionId, {
      role: "assistant",
      content: assistantText || "ok",
    });

    if (req.idempotencyKey) {
      this.idempotencyCache.set(req.idempotencyKey, response);
      setTimeout(() => {
        this.idempotencyCache.delete(req.idempotencyKey!);
      }, 300000);
    }

    return response;
  }

  async enqueueWorkflow(
    workflowType: string,
    payload: unknown,
    idempotencyKey: string
  ): Promise<string> {
    return this.deps.queue.enqueue({
      type: workflowType,
      payload,
      idempotencyKey,
    });
  }

  getStats() {
    return {
      idempotencyCacheSize: this.idempotencyCache.size,
    };
  }
}
