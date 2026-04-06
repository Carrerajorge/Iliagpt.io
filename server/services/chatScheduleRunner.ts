import { and, asc, desc, eq, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, dbRead } from "../db";
import { Logger } from "../lib/logger";
import { storage } from "../storage";
import { chatService } from "./ChatServiceV2";
import { usageQuotaService } from "./usageQuotaService";
import { knowledgeBaseService } from "./knowledgeBase";
import { chatMessages, chatSchedules, chats } from "../../shared/schema";
import { computeNextRunAt, type ChatScheduleType } from "./chatScheduleUtils";

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_LOCK_TTL_MS = 5 * 60_000;
const DEFAULT_CONTEXT_LIMIT = 20;
const DEFAULT_BATCH_LIMIT = 10;

const INSTANCE_ID =
  process.env.SCHEDULE_RUNNER_INSTANCE_ID ||
  process.env.INSTANCE_ID ||
  `iliagpt-${process.pid}`;

function shouldRunRunner(): boolean {
  if (process.env.SCHEDULE_RUNNER_ENABLED) {
    return process.env.SCHEDULE_RUNNER_ENABLED === "true";
  }
  // Default: enabled everywhere except tests.
  return process.env.NODE_ENV !== "test";
}

function computeBackoffMs(failureCount: number): number {
  const capped = Math.min(Math.max(failureCount, 0), 6);
  // 30s, 60s, 120s, ... up to ~32m max
  return Math.min(30_000 * Math.pow(2, capped), 32 * 60_000);
}

async function fetchRecentChatMessages(chatId: string, limit: number) {
  // Bypass storage.getChatMessages cache: schedules must run on the most recent context.
  const rows = await dbRead
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return rows.reverse();
}

async function tryLockSchedule(scheduleId: string, now: Date, staleCutoff: Date) {
  const [locked] = await db
    .update(chatSchedules)
    .set({
      lockedAt: now,
      lockedBy: INSTANCE_ID,
      updatedAt: now,
    })
    .where(
      and(
        eq(chatSchedules.id, scheduleId),
        eq(chatSchedules.isActive, true),
        or(isNull(chatSchedules.lockedAt), lt(chatSchedules.lockedAt, staleCutoff)),
      ),
    )
    .returning();
  return locked || null;
}

async function releaseLock(scheduleId: string) {
  await db
    .update(chatSchedules)
    .set({
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(chatSchedules.id, scheduleId));
}

async function advanceScheduleAfterSuccess(schedule: typeof chatSchedules.$inferSelect, runFinishedAt: Date) {
  const scheduleType = schedule.scheduleType as ChatScheduleType;
  let isActive = schedule.isActive;
  let nextRunAt: Date | null = null;

  if (scheduleType === "once") {
    isActive = false;
    nextRunAt = null;
  } else {
    nextRunAt = computeNextRunAt(
      {
        scheduleType,
        timeZone: schedule.timeZone,
        timeOfDay: schedule.timeOfDay,
        daysOfWeek: schedule.daysOfWeek || null,
      },
      new Date(runFinishedAt.getTime() + 1000),
    );
  }

  await db
    .update(chatSchedules)
    .set({
      isActive,
      lastRunAt: runFinishedAt,
      nextRunAt,
      lockedAt: null,
      lockedBy: null,
      failureCount: 0,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(chatSchedules.id, schedule.id));
}

async function markScheduleError(schedule: typeof chatSchedules.$inferSelect, error: Error) {
  const failureCount = (schedule.failureCount || 0) + 1;
  const backoffMs = computeBackoffMs(failureCount);
  const nextRunAt = new Date(Date.now() + backoffMs);

  await db
    .update(chatSchedules)
    .set({
      failureCount,
      lastError: error.message || String(error),
      nextRunAt,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(chatSchedules.id, schedule.id));
}

async function disableSchedule(schedule: typeof chatSchedules.$inferSelect, reason: string) {
  await db
    .update(chatSchedules)
    .set({
      isActive: false,
      nextRunAt: null,
      lastError: reason,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(chatSchedules.id, schedule.id));
}

async function pauseScheduleUntil(schedule: typeof chatSchedules.$inferSelect, nextRunAt: Date, reason: string) {
  await db
    .update(chatSchedules)
    .set({
      nextRunAt,
      lastError: reason,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(chatSchedules.id, schedule.id));
}

async function executeSchedule(schedule: typeof chatSchedules.$inferSelect, plannedAtEpochMs: number) {
  // Idempotency guard: if assistant message exists for this occurrence, just advance the schedule.
  const assistantReqId = `schedule:${schedule.id}:${plannedAtEpochMs}:assistant`;
  const existingAssistant = await dbRead
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(eq(chatMessages.requestId, assistantReqId))
    .limit(1);

  if (existingAssistant.length > 0) {
    await advanceScheduleAfterSuccess(schedule, new Date());
    return;
  }

  const chat = await storage.getChat(schedule.chatId);
  if (!chat) {
    await disableSchedule(schedule, "Chat no encontrado (posiblemente eliminado).");
    return;
  }
  if (!chat.userId || chat.userId !== schedule.userId) {
    await disableSchedule(schedule, "El chat ya no pertenece al usuario.");
    return;
  }

  // Enforce quotas so scheduled runs can't bypass plan limits.
  const hasTokenQuota = await usageQuotaService.hasTokenQuota(schedule.userId);
  if (!hasTokenQuota) {
    await disableSchedule(schedule, "Has excedido tu límite de tokens. Actualiza tu plan o agrega créditos para continuar.");
    return;
  }

  const context = await fetchRecentChatMessages(schedule.chatId, DEFAULT_CONTEXT_LIMIT);
  const messagesForModel = context
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
    .map((m) => ({ role: m.role as any, content: m.content }));

  const prompt = String(schedule.prompt || "").trim();
  if (!prompt) {
    await disableSchedule(schedule, "La programación no tiene contenido.");
    return;
  }

  messagesForModel.push({ role: "user", content: prompt });

  const estimatedInputTokens = messagesForModel.reduce((sum, message) => {
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
    return sum + Math.ceil(content.length / 4);
  }, 0);

  const dailyTokenQuota = await usageQuotaService.getDailyTokenQuotaStatus(schedule.userId, estimatedInputTokens);
  if (!dailyTokenQuota.allowed) {
    await pauseScheduleUntil(schedule, next, dailyTokenQuota.message || "Límite diario de tokens alcanzado.");
    return;
  }

  const usageCheck = await usageQuotaService.checkAndIncrementUsage(schedule.userId);
  if (!usageCheck.allowed) {
    const resetAt = usageCheck.resetAt ? new Date(usageCheck.resetAt as any) : null;
    const nextRun =
      resetAt && Number.isFinite(resetAt.getTime())
        ? new Date(resetAt.getTime() + 1_000)
        : new Date(Date.now() + 60 * 60_000);
    await pauseScheduleUntil(schedule, nextRun, usageCheck.message || "Límite de solicitudes alcanzado.");
    return;
  }

  const response = await chatService.chat(messagesForModel, {
    conversationId: schedule.chatId,
    userId: schedule.userId,
  });

  // Token usage accounting.
  const promptTokens = (response as any)?.usage?.promptTokens;
  const completionTokens = (response as any)?.usage?.completionTokens;
  if (
    typeof promptTokens === "number" &&
    Number.isFinite(promptTokens) &&
    typeof completionTokens === "number" &&
    Number.isFinite(completionTokens) &&
    (promptTokens > 0 || completionTokens > 0)
  ) {
    usageQuotaService.recordTokenUsageDetailed(schedule.userId, promptTokens, completionTokens).catch((err) => {
      Logger.error(`[Schedules] Failed to record token usage userId=${schedule.userId}: ${err?.message || err}`);
    });
  }

  const assistantContentRaw = String((response as any)?.content || "").trim();
  const assistantContent = assistantContentRaw.length > 0 ? assistantContentRaw : "Listo.";

  const userReqId = `schedule:${schedule.id}:${plannedAtEpochMs}:user`;

  const userCreatedAt = new Date();
  const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1);

  const inserted = await db.transaction(async (tx) => {
    const [userMsg] = await tx
      .insert(chatMessages)
      .values({
        chatId: schedule.chatId,
        role: "user",
        content: prompt,
        status: "done",
        requestId: userReqId,
        userMessageId: null,
        createdAt: userCreatedAt,
        metadata: {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          trigger: "scheduled",
          plannedAt: new Date(plannedAtEpochMs).toISOString(),
        },
      })
      .returning();

    const [assistantMsg] = await tx
      .insert(chatMessages)
      .values({
        chatId: schedule.chatId,
        role: "assistant",
        content: assistantContent,
        status: "done",
        requestId: assistantReqId,
        userMessageId: userMsg?.id || null,
        sources: (response as any).sources || null,
        createdAt: assistantCreatedAt,
        metadata: {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          trigger: "scheduled",
          plannedAt: new Date(plannedAtEpochMs).toISOString(),
          webSources: (response as any).webSources || undefined,
          agentRunId: (response as any).agentRunId || undefined,
          wasAgentTask: (response as any).wasAgentTask || undefined,
          artifact: (response as any).artifact || undefined,
          artifacts: (response as any).artifacts || undefined,
        },
      })
      .returning();

    await tx
      .update(chats)
      .set({
        updatedAt: new Date(),
        lastMessageAt: assistantCreatedAt,
        messageCount: sql<number>`coalesce(${chats.messageCount}, 0) + 2`,
      })
      .where(eq(chats.id, schedule.chatId));

    return {
      userMsgId: userMsg?.id || null,
      assistantMsgId: assistantMsg?.id || null,
    };
  });

  // Keep RAG/search features consistent: scheduled messages should be ingested like normal chat traffic.
  if (inserted.userMsgId) {
    const userMessageId = inserted.userMsgId;
    queueMicrotask(() => {
      knowledgeBaseService
        .ingestChatMessage({
          chatId: schedule.chatId,
          messageId: userMessageId,
          role: "user",
          content: prompt,
        })
        .catch((error) => {
          Logger.error(`[Knowledge] Failed to ingest scheduled user msg scheduleId=${schedule.id}: ${error?.message || error}`);
        });
    });
  }
  if (inserted.assistantMsgId) {
    const assistantMessageId = inserted.assistantMsgId;
    queueMicrotask(() => {
      knowledgeBaseService
        .ingestChatMessage({
          chatId: schedule.chatId,
          messageId: assistantMessageId,
          role: "assistant",
          content: assistantContent,
        })
        .catch((error) => {
          Logger.error(`[Knowledge] Failed to ingest scheduled assistant msg scheduleId=${schedule.id}: ${error?.message || error}`);
        });
    });
  }

  await advanceScheduleAfterSuccess(schedule, new Date());
}

async function processDueSchedulesOnce() {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - DEFAULT_LOCK_TTL_MS);

  const due = await dbRead
    .select()
    .from(chatSchedules)
    .where(
      and(
        eq(chatSchedules.isActive, true),
        isNotNull(chatSchedules.nextRunAt),
        lte(chatSchedules.nextRunAt, now),
        or(isNull(chatSchedules.lockedAt), lt(chatSchedules.lockedAt, staleCutoff)),
      ),
    )
    .orderBy(asc(chatSchedules.nextRunAt))
    .limit(DEFAULT_BATCH_LIMIT);

  for (const schedule of due) {
    try {
      const locked = await tryLockSchedule(schedule.id, now, staleCutoff);
      if (!locked) continue;

      const plannedAtEpochMs = locked.nextRunAt?.getTime() || Date.now();
      await executeSchedule(locked, plannedAtEpochMs);
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      Logger.error(`[Schedules] Execution failed scheduleId=${schedule.id}: ${error.message}`);
      try {
        // Best-effort: refresh schedule state before updating failure counters.
        const [fresh] = await dbRead.select().from(chatSchedules).where(eq(chatSchedules.id, schedule.id)).limit(1);
        await markScheduleError(fresh || schedule, error);
      } catch (updateErr: any) {
        Logger.error(`[Schedules] Failed to update error state scheduleId=${schedule.id}: ${updateErr?.message || updateErr}`);
        await releaseLock(schedule.id).catch(() => {});
      }
    }
  }
}

let runnerTimer: NodeJS.Timeout | null = null;
let runnerDisabledForMissingSchema = false;

function isMissingChatSchedulesTableError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (current instanceof Error) {
      const anyError = current as Error & { code?: string; cause?: unknown };
      if (anyError.code === "42P01" || /relation "chat_schedules" does not exist/i.test(anyError.message)) {
        return true;
      }
      if ("cause" in anyError) {
        queue.push(anyError.cause);
      }
      continue;
    }

    if (typeof current === "object") {
      const maybeRecord = current as Record<string, unknown>;
      if (maybeRecord.code === "42P01") {
        return true;
      }
      if (typeof maybeRecord.message === "string" && /relation "chat_schedules" does not exist/i.test(maybeRecord.message)) {
        return true;
      }
      if ("cause" in maybeRecord) {
        queue.push(maybeRecord.cause);
      }
    }
  }

  return false;
}

export function startChatScheduleRunner() {
  if (!shouldRunRunner()) {
    Logger.info("[Schedules] Runner disabled");
    return;
  }

  if (runnerDisabledForMissingSchema) {
    Logger.warn("[Schedules] Runner skipped because chat_schedules is not available on this database");
    return;
  }

  if (runnerTimer) return;

  const intervalMs = Number(process.env.SCHEDULE_RUNNER_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS;
  Logger.info(`[Schedules] Runner starting (instance=${INSTANCE_ID}, intervalMs=${intervalMs})`);

  const tick = async () => {
    if (runnerDisabledForMissingSchema) {
      return;
    }
    try {
      await processDueSchedulesOnce();
    } catch (err: any) {
      if (isMissingChatSchedulesTableError(err)) {
        runnerDisabledForMissingSchema = true;
        if (runnerTimer) {
          clearInterval(runnerTimer);
          runnerTimer = null;
        }
        Logger.warn("[Schedules] Runner disabled because relation \"chat_schedules\" does not exist");
        return;
      }
      Logger.error(`[Schedules] Runner tick failed: ${err?.message || err}`);
    }
  };

  // Run ASAP on boot.
  tick().catch(() => {});

  runnerTimer = setInterval(() => {
    tick().catch(() => {});
  }, intervalMs);

  // Do not keep Node alive just for schedules.
  runnerTimer.unref?.();
}

export async function runChatScheduleNow(userId: string, scheduleId: string) {
  const [schedule] = await dbRead
    .select()
    .from(chatSchedules)
    .where(and(eq(chatSchedules.id, scheduleId), eq(chatSchedules.userId, userId)))
    .limit(1);

  if (!schedule) {
    const err = new Error("Schedule not found");
    (err as any).statusCode = 404;
    throw err;
  }

  // Short lock TTL for user-triggered runs, but still guard against duplicates.
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - DEFAULT_LOCK_TTL_MS);
  const locked = await tryLockSchedule(schedule.id, now, staleCutoff);
  if (!locked) {
    const err = new Error("Schedule is currently running");
    (err as any).statusCode = 409;
    throw err;
  }

  try {
    await executeSchedule(locked, Date.now());
    return { success: true };
  } catch (err: any) {
    const error = err instanceof Error ? err : new Error(String(err));
    await markScheduleError(locked, error).catch(() => releaseLock(locked.id).catch(() => {}));
    throw error;
  }
}
