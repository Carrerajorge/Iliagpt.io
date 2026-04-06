import type { NextFunction, Request, Response } from "express";

import type { RequestBrief } from "../agent/requestUnderstanding/briefSchema";
import { requestUnderstandingAgent } from "../agent/requestUnderstanding/requestUnderstandingAgent";
import { getSecureUserId } from "../lib/anonUserHelper";
import { createLogger } from "../lib/structuredLogger";
import { withSpan } from "../lib/tracing";

type GuardMode = "off" | "monitor" | "enforce";

type GuardDecision = {
  allowed: boolean;
  reasons: string[];
  message: string;
};

type GuardStats = {
  analyzed: number;
  allowed: number;
  blocked: number;
  skipped: number;
  unavailable: number;
};

export type ExecutionIntentGuardContext = {
  brief: RequestBrief;
  decision: GuardDecision;
  mode: GuardMode;
};

declare global {
  namespace Express {
    interface Request {
      executionIntentGuard?: ExecutionIntentGuardContext;
    }
  }
}

const executionIntentLogger = createLogger("execution-intent-guard");
const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const guardStats: GuardStats = {
  analyzed: 0,
  allowed: 0,
  blocked: 0,
  skipped: 0,
  unavailable: 0,
};

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function resolveGuardMode(): GuardMode {
  const explicitMode = normalizeText(process.env.EXECUTION_INTENT_GUARD_MODE).toLowerCase();
  if (explicitMode === "off" || explicitMode === "monitor" || explicitMode === "enforce") {
    return explicitMode;
  }

  // Default: enforce when system audit mode is enabled, otherwise monitor.
  const systemAuditEnabled = normalizeText(process.env.SYSTEM_AUDIT_MODE).toLowerCase();
  if (systemAuditEnabled === "false" || systemAuditEnabled === "0" || systemAuditEnabled === "disabled") {
    return "monitor";
  }
  return "enforce";
}

function extractTextFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";

  const parts = messages
    .slice(-6)
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return "";
      const role = normalizeText((entry as any).role).toLowerCase();
      if (role && role !== "user") return "";
      return normalizeText((entry as any).content || (entry as any).text || (entry as any).message);
    })
    .filter(Boolean);

  return normalizeText(parts.join(" "));
}

function extractUserText(req: Request): string {
  const body = (req.body || {}) as Record<string, unknown>;
  const query = req.query || {};

  const directCandidates = [
    body.userText,
    body.message,
    body.prompt,
    body.input,
    body.query,
    body.text,
    body.goal,
    body.instruction,
    body.command,
    body.action,
    body.url,
    body.selector,
    body.content,
    (body.args as any)?.url,
    (body.args as any)?.selector,
    (body.arguments as any)?.url,
    (body.arguments as any)?.selector,
    (body.payload as any)?.message,
    (body.payload as any)?.prompt,
    (body.request as any)?.message,
    (body.request as any)?.text,
    (body.task as any)?.prompt,
    query.prompt,
    query.query,
  ];

  const messageText = extractTextFromMessages(body.messages);

  const firstMatch =
    directCandidates
      .map(normalizeText)
      .find((candidate) => candidate.length > 0) || messageText;

  return normalizeText(firstMatch);
}

function extractAvailableTools(req: Request): string[] {
  const body = (req.body || {}) as Record<string, unknown>;
  const tools = body.availableTools || body.tools || (body.request as any)?.availableTools;
  if (!Array.isArray(tools)) return [];
  return dedupe(tools.map((tool) => normalizeText(tool)));
}

function evaluateBrief(brief: RequestBrief): GuardDecision {
  const reasons: string[] = [];

  if (brief.blocker?.is_blocked) reasons.push("blocker_requires_clarification");
  if (!brief.guardrails.policy_ok) reasons.push("policy_guardrail_failed");
  if (!brief.guardrails.privacy_ok) reasons.push("privacy_guardrail_failed");
  if (!brief.guardrails.security_ok) reasons.push("security_guardrail_failed");
  if (!brief.self_check.passed) reasons.push("self_check_failed");

  const allowed = reasons.length === 0;
  const message = allowed
    ? "Execution allowed by intent guard."
    : brief.blocker?.question
      ? normalizeText(brief.blocker.question)
      : "Execution blocked by intent guard. Clarification or safer constraints are required.";

  return { allowed, reasons, message };
}

function buildBlockedResponse(brief: RequestBrief, decision: GuardDecision, mode: GuardMode) {
  return {
    error: "EXECUTION_BLOCKED_BY_INTENT_GUARD",
    message: decision.message,
    guard: {
      mode,
      allowed: false,
      reasons: decision.reasons,
      blocker: brief.blocker,
      guardrails: brief.guardrails,
      selfCheck: brief.self_check,
      validations: brief.validations,
      successCriteria: brief.success_criteria,
      definitionOfDone: brief.definition_of_done,
      rollback: {
        status: "prevented",
        strategy: "no_side_effects_committed",
        reason: "blocked_before_execution",
      },
      trace: brief.trace,
      toolRouting: brief.tool_routing,
    },
  };
}

export function getExecutionIntentGuardStatus() {
  return {
    mode: resolveGuardMode(),
    stats: { ...guardStats },
  };
}

export async function preExecutionIntentGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const mode = resolveGuardMode();

  if (mode === "off" || !mutationMethods.has(req.method)) {
    guardStats.skipped += 1;
    next();
    return;
  }

  const userText = extractUserText(req);
  if (!userText) {
    guardStats.skipped += 1;
    next();
    return;
  }

  const userId = getSecureUserId(req) || undefined;
  const chatId = normalizeText((req.body as any)?.chatId) || undefined;
  const availableTools = extractAvailableTools(req);

  guardStats.analyzed += 1;

  // --- BYPASS: terminal endpoints must NOT depend on LLM quota ---
const pathOnly = (req.originalUrl || req.url || req.path || "").split("?")[0];

const isTerminalSessionCreate =
  req.method === "POST" && /^\/api\/terminal\/sessions$/.test(pathOnly);

const isTerminalExec =
  req.method === "POST" && /^\/api\/terminal\/sessions\/[^/]+\/exec$/.test(pathOnly);

const isTerminalFileOp =
  req.method === "POST" && /^\/api\/terminal\/sessions\/[^/]+\/file$/.test(pathOnly);

// sometimes internal routes appear without /api in logs
const isTerminalExecNoApi =
  req.method === "POST" && /^\/terminal\/sessions\/[^/]+\/exec$/.test(pathOnly);

const isTerminalFileNoApi =
  req.method === "POST" && /^\/terminal\/sessions\/[^/]+\/file$/.test(pathOnly);

const isSafePythonAgentReadOnly =
  req.method === "POST" && (
    /^\/api\/python-agent\/search$/.test(pathOnly) ||
    /^\/api\/python-agent\/browse$/.test(pathOnly)
  );

const isOpenClawInternet =
  req.method === "POST" && /^\/api\/openclaw\/internet\/(fetch|search)$/.test(pathOnly);

const isSafeReadOnlyHealth =
  req.method === "GET" && (/^\/api\/python-agent\/health$/.test(pathOnly) || /^\/api\/python-agent\/status$/.test(pathOnly));

if (
  isTerminalSessionCreate ||
  isTerminalExec ||
  isTerminalFileOp ||
  isTerminalExecNoApi ||
  isTerminalFileNoApi ||
  isSafePythonAgentReadOnly ||
  isSafeReadOnlyHealth ||
  isOpenClawInternet
) {
  return next();
}

  try {
    const brief = await withSpan(
      "execution.intent_guard",
      async (span) => {
        span.setAttribute("guard.mode", mode);
        span.setAttribute("guard.path", req.path);
        span.setAttribute("guard.method", req.method);
        span.setAttribute("guard.has_user_id", Boolean(userId));
        span.setAttribute("guard.input_length", userText.length);

        const result = await requestUnderstandingAgent.buildBrief({
          text: userText,
          conversationHistory: Array.isArray((req.body as any)?.messages)
            ? ((req.body as any).messages as any[])
              .slice(-6)
              .map((entry) => ({
                role: String(entry?.role || "user").toLowerCase() === "assistant" ? "assistant" : "user",
                content: normalizeText(entry?.content || entry?.text || entry?.message),
              }))
            : undefined,
          availableTools,
          userId,
          chatId,
          requestId: (res.locals?.traceId as string) || undefined,
          userPlan: "free",
        });

        span.setAttribute("guard.intent_confidence", result.intent.confidence);
        span.setAttribute("guard.blocked_by_brief", result.blocker.is_blocked);
        span.setAttribute("guard.self_check_passed", result.self_check.passed);
        return result;
      },
      {
        requestId: (res.locals?.traceId as string) || undefined,
        userId,
      },
    );

    const decision = evaluateBrief(brief);
    req.executionIntentGuard = { brief, decision, mode };

    if (decision.allowed) {
      guardStats.allowed += 1;
      executionIntentLogger
        .withRequest((res.locals?.traceId as string) || "n/a", userId)
        .info("Execution intent guard passed", {
          path: req.originalUrl,
          method: req.method,
          confidence: brief.intent.confidence,
          intent: brief.intent.primary_intent,
        });
      next();
      return;
    }

    guardStats.blocked += 1;
    executionIntentLogger
      .withRequest((res.locals?.traceId as string) || "n/a", userId)
      .warn("Execution intent guard flagged request", {
        path: req.originalUrl,
        method: req.method,
        mode,
        reasons: decision.reasons,
        blocker: brief.blocker,
      });

    if (mode === "enforce") {
      res.status(409).json(buildBlockedResponse(brief, decision, mode));
      return;
    }

    next();
  } catch (error: any) {
    guardStats.unavailable += 1;
    executionIntentLogger
      .withRequest((res.locals?.traceId as string) || "n/a", userId)
      .error("Execution intent guard failed", {
        path: req.originalUrl,
        method: req.method,
        mode,
        error: error?.message || String(error),
      });

    if (mode === "enforce") {
      res.status(503).json({
        error: "INTENT_GUARD_UNAVAILABLE",
        message: "Execution intent analysis is temporarily unavailable. No side effects were applied.",
        guard: {
          mode,
          rollback: {
            status: "prevented",
            strategy: "no_side_effects_committed",
            reason: "guard_unavailable",
          },
        },
      });
      return;
    }

    next();
  }
}
