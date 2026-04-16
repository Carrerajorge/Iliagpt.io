import { db } from "../db";
import { agentModeRuns } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { createHash } from "crypto";

export interface IdempotencyResult {
  isDuplicate: boolean;
  existingRunId?: string;
  existingStatus?: string;
}

export async function checkIdempotency(
  idempotencyKey: string,
  chatId: string
): Promise<IdempotencyResult> {
  if (!idempotencyKey) {
    return { isDuplicate: false };
  }
  
  const [existing] = await db.select()
    .from(agentModeRuns)
    .where(and(
      eq(agentModeRuns.idempotencyKey, idempotencyKey),
      eq(agentModeRuns.chatId, chatId)
    ))
    .limit(1);
  
  if (!existing) {
    return { isDuplicate: false };
  }
  
  const terminalStates = ["completed", "failed", "cancelled"];
  if (terminalStates.includes(existing.status)) {
    return { isDuplicate: false };
  }
  
  return {
    isDuplicate: true,
    existingRunId: existing.id,
    existingStatus: existing.status,
  };
}

export function generateIdempotencyKey(chatId: string, message: string): string {
  const normalizedMessage = message.trim().toLowerCase();
  const hash = createHash("sha256");
  hash.update(`${chatId}:${normalizedMessage}`);
  return hash.digest("hex").substring(0, 32);
}
