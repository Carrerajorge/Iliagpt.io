/**
 * SagaCoordinator — Multi-step transactional workflows with compensation.
 *
 * Executes a sequence of steps. If any step fails, all previously completed
 * steps are compensated in reverse order (backward recovery).  Results are
 * persisted best-effort to the `executionPlans` table so the rest of the
 * system can observe saga outcomes without hard-coupling to this module.
 */

export interface SagaStep {
  name: string;
  execute: (ctx: SagaContext) => Promise<unknown>;
  compensate?: (ctx: SagaContext) => Promise<void>;
}

export interface SagaContext {
  planId: string;
  userId: string;
  chatId: string;
  data: Record<string, unknown>;
  completedSteps: string[];
  results: Map<string, unknown>;
}

export interface SagaResult {
  success: boolean;
  results: Record<string, unknown>;
  failedStep?: string;
  error?: string;
  compensationLog: string[];
}

/* ------------------------------------------------------------------ */
/*  Core saga executor                                                 */
/* ------------------------------------------------------------------ */

export async function executeSaga(
  planId: string,
  userId: string,
  chatId: string,
  steps: SagaStep[],
  initialData: Record<string, unknown> = {},
): Promise<SagaResult> {
  const ctx: SagaContext = {
    planId,
    userId,
    chatId,
    data: { ...initialData },
    completedSteps: [],
    results: new Map(),
  };

  const compensationLog: string[] = [];
  let failedStep: string | undefined;
  let errorMessage: string | undefined;

  for (const step of steps) {
    try {
      const result = await step.execute(ctx);
      ctx.results.set(step.name, result);
      ctx.completedSteps.push(step.name);
    } catch (err: unknown) {
      failedStep = step.name;
      errorMessage =
        err instanceof Error ? err.message : String(err);

      console.error(
        `[SagaCoordinator] Step "${step.name}" failed in saga ${planId}: ${errorMessage}`,
      );

      // Compensate in reverse order
      const stepsToCompensate = [...ctx.completedSteps].reverse();
      for (const completedName of stepsToCompensate) {
        const completedStep = steps.find((s) => s.name === completedName);
        if (!completedStep?.compensate) {
          compensationLog.push(
            `${completedName}: skipped (no compensate handler)`,
          );
          continue;
        }

        try {
          await completedStep.compensate(ctx);
          compensationLog.push(`${completedName}: compensated`);
        } catch (compErr: unknown) {
          const compMsg =
            compErr instanceof Error ? compErr.message : String(compErr);
          compensationLog.push(`${completedName}: compensation FAILED — ${compMsg}`);
          console.error(
            `[SagaCoordinator] Compensation for "${completedName}" failed: ${compMsg}`,
          );
        }
      }

      break; // stop processing remaining steps
    }
  }

  const success = failedStep === undefined;

  // Convert results Map to plain object for serialisation
  const resultsObj: Record<string, unknown> = {};
  for (const [k, v] of ctx.results) {
    resultsObj[k] = v;
  }

  const sagaResult: SagaResult = {
    success,
    results: resultsObj,
    ...(failedStep ? { failedStep } : {}),
    ...(errorMessage ? { error: errorMessage } : {}),
    compensationLog,
  };

  // Best-effort persistence
  await persistSagaResult(planId, sagaResult).catch((persistErr) => {
    console.warn(
      `[SagaCoordinator] Could not persist saga result for ${planId}:`,
      persistErr,
    );
  });

  return sagaResult;
}

/* ------------------------------------------------------------------ */
/*  Best-effort DB persistence                                         */
/* ------------------------------------------------------------------ */

async function persistSagaResult(
  planId: string,
  result: SagaResult,
): Promise<void> {
  try {
    const { db } = await import("../../db/index.js");
    const { executionPlans } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");

    await db
      .update(executionPlans)
      .set({
        status: result.success ? "completed" : "failed",
        result: JSON.stringify(result),
        updatedAt: new Date(),
      } as Record<string, unknown>)
      .where(eq(executionPlans.id, planId));
  } catch {
    // Table may not exist or schema may differ — silently ignore.
  }
}
