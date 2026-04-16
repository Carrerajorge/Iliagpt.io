import { createHash } from "crypto";
import { randomUUID } from "crypto";
import type { ToolContext, ToolResult, ToolDefinition } from "./toolRegistry";
import type { UserPlan, ToolCapability } from "./contracts";
import { policyEngine, type PolicyContext } from "./policyEngine";

export interface RBACRule {
  toolName: string;
  allowedPlans: UserPlan[];
  requiredCapabilities?: ToolCapability[];
  contextConditions?: Array<{
    field: string;
    operator: "eq" | "neq" | "in" | "notIn";
    value: any;
  }>;
  denyReason?: string;
}

export interface ABACAttribute {
  key: string;
  value: any;
}

export interface SkillsRBACCheck {
  allowed: boolean;
  reason?: string;
  matchedRule?: RBACRule;
}

export interface IdempotencyEntry {
  inputHash: string;
  result: ToolResult;
  timestamp: number;
  toolName: string;
  runId: string;
}

export interface CompensationAction {
  id: string;
  toolName: string;
  runId: string;
  stepIndex: number;
  undoFn: () => Promise<void>;
  description: string;
  timestamp: number;
  executed: boolean;
}

export interface ComposedSkill {
  name: string;
  description: string;
  steps: Array<{
    toolName: string;
    inputMapper: (previousResults: ToolResult[], originalInput: any) => any;
    optional?: boolean;
    condition?: (previousResults: ToolResult[]) => boolean;
  }>;
  outputMapper?: (results: ToolResult[]) => ToolResult;
}

export class SkillsKernel {
  private rbacRules: Map<string, RBACRule[]> = new Map();
  private idempotencyCache: Map<string, IdempotencyEntry> = new Map();
  private compensationStack: Map<string, CompensationAction[]> = new Map();
  private composedSkills: Map<string, ComposedSkill> = new Map();
  private idempotencyCacheTTLMs: number = 5 * 60 * 1000;
  private maxCacheEntries: number = 1000;

  addRBACRule(rule: RBACRule): void {
    const existing = this.rbacRules.get(rule.toolName) || [];
    existing.push(rule);
    this.rbacRules.set(rule.toolName, existing);
  }

  removeRBACRules(toolName: string): void {
    this.rbacRules.delete(toolName);
  }

  checkRBAC(toolName: string, context: ToolContext, attributes?: ABACAttribute[]): SkillsRBACCheck {
    const policyContext: PolicyContext = {
      userId: context.userId,
      userPlan: context.userPlan || "free",
      toolName,
      isConfirmed: context.isConfirmed,
    };
    const policyResult = policyEngine.checkAccess(policyContext);
    if (!policyResult.allowed) {
      return {
        allowed: false,
        reason: policyResult.reason || `Policy denied access to ${toolName}`,
      };
    }

    const rules = this.rbacRules.get(toolName);
    if (!rules || rules.length === 0) {
      return { allowed: true };
    }

    const userPlan = context.userPlan || "free";

    for (const rule of rules) {
      if (!rule.allowedPlans.includes(userPlan)) {
        return {
          allowed: false,
          reason: rule.denyReason || `Plan "${userPlan}" not allowed for tool "${toolName}". Required: ${rule.allowedPlans.join(", ")}`,
          matchedRule: rule,
        };
      }

      if (rule.contextConditions) {
        for (const cond of rule.contextConditions) {
          const fieldValue = this.resolveContextField(context, attributes, cond.field);
          const condMet = this.evaluateCondition(fieldValue, cond.operator, cond.value);
          if (!condMet) {
            return {
              allowed: false,
              reason: rule.denyReason || `Context condition not met: ${cond.field} ${cond.operator} ${JSON.stringify(cond.value)}`,
              matchedRule: rule,
            };
          }
        }
      }
    }

    return { allowed: true };
  }

  private resolveContextField(context: ToolContext, attributes: ABACAttribute[] | undefined, field: string): any {
    const ctxVal = (context as any)[field];
    if (ctxVal !== undefined) return ctxVal;

    if (attributes) {
      const attr = attributes.find(a => a.key === field);
      if (attr) return attr.value;
    }

    return undefined;
  }

  private evaluateCondition(value: any, operator: string, expected: any): boolean {
    switch (operator) {
      case "eq": return value === expected;
      case "neq": return value !== expected;
      case "in": return Array.isArray(expected) && expected.includes(value);
      case "notIn": return Array.isArray(expected) && !expected.includes(value);
      default: return true;
    }
  }

  computeInputHash(toolName: string, input: any): string {
    const normalized = JSON.stringify({ tool: toolName, input }, Object.keys({ tool: toolName, input }).sort());
    const hash = createHash("sha256");
    hash.update(normalized);
    return hash.digest("hex").substring(0, 32);
  }

  checkIdempotency(toolName: string, input: any, runId: string): IdempotencyEntry | null {
    this.pruneExpiredCache();

    const hash = this.computeInputHash(toolName, input);
    const cacheKey = `${runId}:${hash}`;
    const entry = this.idempotencyCache.get(cacheKey);

    if (entry && Date.now() - entry.timestamp < this.idempotencyCacheTTLMs) {
      return entry;
    }

    if (entry) {
      this.idempotencyCache.delete(cacheKey);
    }

    return null;
  }

  cacheResult(toolName: string, input: any, runId: string, result: ToolResult): void {
    const hash = this.computeInputHash(toolName, input);
    const cacheKey = `${runId}:${hash}`;

    if (this.idempotencyCache.size >= this.maxCacheEntries) {
      const oldest = this.idempotencyCache.keys().next().value;
      if (oldest) this.idempotencyCache.delete(oldest);
    }

    this.idempotencyCache.set(cacheKey, {
      inputHash: hash,
      result,
      timestamp: Date.now(),
      toolName,
      runId,
    });
  }

  private pruneExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.idempotencyCache) {
      if (now - entry.timestamp >= this.idempotencyCacheTTLMs) {
        this.idempotencyCache.delete(key);
      }
    }
  }

  clearCache(runId?: string): void {
    if (!runId) {
      this.idempotencyCache.clear();
      return;
    }
    for (const key of this.idempotencyCache.keys()) {
      if (key.startsWith(`${runId}:`)) {
        this.idempotencyCache.delete(key);
      }
    }
  }

  registerCompensation(
    runId: string,
    toolName: string,
    stepIndex: number,
    undoFn: () => Promise<void>,
    description: string
  ): string {
    const id = randomUUID();
    const action: CompensationAction = {
      id,
      toolName,
      runId,
      stepIndex,
      undoFn,
      description,
      timestamp: Date.now(),
      executed: false,
    };

    const stack = this.compensationStack.get(runId) || [];
    stack.push(action);
    this.compensationStack.set(runId, stack);

    return id;
  }

  async rollback(runId: string, fromStepIndex?: number): Promise<Array<{ id: string; success: boolean; error?: string }>> {
    const stack = this.compensationStack.get(runId);
    if (!stack || stack.length === 0) {
      return [];
    }

    const toRollback = fromStepIndex !== undefined
      ? stack.filter(a => a.stepIndex >= fromStepIndex && !a.executed)
      : stack.filter(a => !a.executed);

    toRollback.sort((a, b) => b.stepIndex - a.stepIndex);

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const action of toRollback) {
      try {
        await action.undoFn();
        action.executed = true;
        results.push({ id: action.id, success: true });
      } catch (err: any) {
        action.executed = true;
        results.push({
          id: action.id,
          success: false,
          error: err?.message || String(err),
        });
      }
    }

    return results;
  }

  getCompensationStack(runId: string): CompensationAction[] {
    return (this.compensationStack.get(runId) || []).map(a => ({
      ...a,
      undoFn: a.undoFn,
    }));
  }

  clearCompensations(runId: string): void {
    this.compensationStack.delete(runId);
  }

  registerSkill(skill: ComposedSkill): void {
    this.composedSkills.set(skill.name, skill);
  }

  getSkill(name: string): ComposedSkill | undefined {
    return this.composedSkills.get(name);
  }

  listSkills(): ComposedSkill[] {
    return Array.from(this.composedSkills.values());
  }

  removeSkill(name: string): boolean {
    return this.composedSkills.delete(name);
  }

  async executeSkill(
    skillName: string,
    input: any,
    context: ToolContext,
    toolExecutor: (toolName: string, toolInput: any, ctx: ToolContext) => Promise<ToolResult>
  ): Promise<ToolResult> {
    const skill = this.composedSkills.get(skillName);
    if (!skill) {
      return {
        success: false,
        output: null,
        error: {
          code: "SKILL_NOT_FOUND",
          message: `Composed skill "${skillName}" not found`,
          retryable: false,
        },
      };
    }

    const stepResults: ToolResult[] = [];
    const startTime = Date.now();

    for (let i = 0; i < skill.steps.length; i++) {
      const step = skill.steps[i];

      if (step.condition && !step.condition(stepResults)) {
        continue;
      }

      const rbacCheck = this.checkRBAC(step.toolName, context);
      if (!rbacCheck.allowed) {
        if (step.optional) continue;
        return {
          success: false,
          output: null,
          error: {
            code: "SKILL_STEP_DENIED",
            message: `Step ${i} (${step.toolName}) denied: ${rbacCheck.reason}`,
            retryable: false,
          },
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const stepInput = step.inputMapper(stepResults, input);

      const cached = this.checkIdempotency(step.toolName, stepInput, context.runId);
      if (cached) {
        stepResults.push(cached.result);
        continue;
      }

      const result = await toolExecutor(step.toolName, stepInput, context);
      stepResults.push(result);

      if (result.success) {
        this.cacheResult(step.toolName, stepInput, context.runId, result);
      }

      if (!result.success && !step.optional) {
        await this.rollback(context.runId, 0);
        return {
          success: false,
          output: {
            failedStep: i,
            failedTool: step.toolName,
            partialResults: stepResults,
          },
          error: {
            code: "SKILL_STEP_FAILED",
            message: `Composed skill "${skillName}" failed at step ${i} (${step.toolName}): ${result.error?.message || "Unknown error"}`,
            retryable: result.error?.retryable || false,
          },
          metrics: { durationMs: Date.now() - startTime },
        };
      }
    }

    if (skill.outputMapper) {
      return skill.outputMapper(stepResults);
    }

    const lastSuccessful = stepResults.filter(r => r.success).pop();
    return {
      success: true,
      output: {
        skillName,
        stepCount: stepResults.length,
        results: stepResults.map((r, i) => ({
          step: i,
          success: r.success,
          output: r.output,
        })),
        finalOutput: lastSuccessful?.output,
      },
      artifacts: stepResults.flatMap(r => r.artifacts || []),
      previews: stepResults.flatMap(r => r.previews || []),
      metrics: { durationMs: Date.now() - startTime },
    };
  }

  async executeWithKernel(
    toolName: string,
    input: any,
    context: ToolContext,
    toolExecutor: (toolName: string, toolInput: any, ctx: ToolContext) => Promise<ToolResult>,
    compensationFn?: () => Promise<void>
  ): Promise<ToolResult> {
    const rbacCheck = this.checkRBAC(toolName, context);
    if (!rbacCheck.allowed) {
      return {
        success: false,
        output: null,
        error: {
          code: "RBAC_DENIED",
          message: rbacCheck.reason || `Access denied for tool "${toolName}"`,
          retryable: false,
        },
      };
    }

    const cached = this.checkIdempotency(toolName, input, context.runId);
    if (cached) {
      return {
        ...cached.result,
        logs: [
          ...(cached.result.logs || []),
          {
            level: "info" as const,
            message: `Idempotent cache hit for ${toolName} (hash: ${cached.inputHash})`,
            timestamp: new Date(),
          },
        ],
      };
    }

    const result = await toolExecutor(toolName, input, context);

    if (result.success) {
      this.cacheResult(toolName, input, context.runId, result);

      if (compensationFn) {
        this.registerCompensation(
          context.runId,
          toolName,
          context.stepIndex || 0,
          compensationFn,
          `Undo ${toolName} call`
        );
      }
    }

    return result;
  }

  getStats(): {
    rbacRuleCount: number;
    cacheSize: number;
    compensationStackSizes: Record<string, number>;
    registeredSkills: string[];
  } {
    const stackSizes: Record<string, number> = {};
    for (const [runId, stack] of this.compensationStack) {
      stackSizes[runId] = stack.length;
    }
    return {
      rbacRuleCount: Array.from(this.rbacRules.values()).reduce((acc, rules) => acc + rules.length, 0),
      cacheSize: this.idempotencyCache.size,
      compensationStackSizes: stackSizes,
      registeredSkills: Array.from(this.composedSkills.keys()),
    };
  }
}

export const skillsKernel = new SkillsKernel();

skillsKernel.registerSkill({
  name: "research",
  description: "Search the web, fetch content, and summarize findings",
  steps: [
    {
      toolName: "web_search",
      inputMapper: (_prev, input) => ({ query: input.query || input.topic }),
    },
    {
      toolName: "browse_url",
      inputMapper: (prev, _input) => {
        const searchResult = prev[0]?.output;
        const firstUrl = searchResult?.results?.[0]?.url || searchResult?.url;
        return { url: firstUrl || "" };
      },
      optional: true,
      condition: (prev) => prev[0]?.success === true,
    },
    {
      toolName: "web_search",
      inputMapper: (prev, input) => ({
        query: `${input.query || input.topic} summary analysis`,
      }),
      optional: true,
    },
  ],
  outputMapper: (results) => ({
    success: results.some(r => r.success),
    output: {
      searchResults: results[0]?.output,
      pageContent: results[1]?.output,
      additionalSearch: results[2]?.output,
    },
    artifacts: results.flatMap(r => r.artifacts || []),
    previews: results.flatMap(r => r.previews || []),
    metrics: {
      durationMs: results.reduce((sum, r) => sum + (r.metrics?.durationMs || 0), 0),
    },
  }),
});

skillsKernel.addRBACRule({
  toolName: "shell_command",
  allowedPlans: ["pro", "admin"],
  denyReason: "Shell command execution requires Pro or Admin plan",
});

skillsKernel.addRBACRule({
  toolName: "execute_code",
  allowedPlans: ["pro", "admin"],
  denyReason: "Code execution requires Pro or Admin plan",
});
