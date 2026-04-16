import { db } from "../db";
import { openclawInstances, openclawTokenLedger, openclawAdminConfig } from "@shared/schema";
import { DEFAULT_OPENCLAW_RELEASE_TAG } from "@shared/openclawRelease";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import crypto from "crypto";

function generateInstanceId(userId: string): string {
  const hash = crypto.createHash("sha256").update(userId).digest("hex").slice(0, 12);
  return `oc_${hash}`;
}

function generateId(): string {
  return crypto.randomUUID();
}

export async function getOrCreateInstance(userId: string) {
  const existing = await db
    .select()
    .from(openclawInstances)
    .where(eq(openclawInstances.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    const nextVersion =
      existing[0].version && existing[0].version !== DEFAULT_OPENCLAW_RELEASE_TAG
        ? DEFAULT_OPENCLAW_RELEASE_TAG
        : existing[0].version;
    await db
      .update(openclawInstances)
      .set({ lastActiveAt: new Date(), updatedAt: new Date(), version: nextVersion })
      .where(eq(openclawInstances.id, existing[0].id));
    return { ...existing[0], version: nextVersion };
  }

  const adminConfig = await getAdminConfig();

  if (!adminConfig.globalEnabled) {
    throw new Error("OpenClaw instances are currently disabled by the administrator");
  }

  if (!adminConfig.autoProvisionOnLogin) {
    throw new Error("Auto-provisioning is disabled. Contact admin to create your instance.");
  }

  const instanceId = generateInstanceId(userId);

  const [instance] = await db
    .insert(openclawInstances)
    .values({
      id: generateId(),
      userId,
      instanceId,
      status: "active",
      version: DEFAULT_OPENCLAW_RELEASE_TAG,
      tokensLimit: adminConfig.defaultTokensLimit,
    })
    .returning();

  return instance;
}

export async function getUserInstance(userId: string) {
  const [instance] = await db
    .select()
    .from(openclawInstances)
    .where(eq(openclawInstances.userId, userId))
    .limit(1);
  return instance || null;
}

export async function getAllInstances() {
  return db
    .select()
    .from(openclawInstances)
    .orderBy(desc(openclawInstances.lastActiveAt));
}

export async function updateInstanceTokenLimit(instanceId: string, tokensLimit: number) {
  const [updated] = await db
    .update(openclawInstances)
    .set({ tokensLimit, updatedAt: new Date() })
    .where(eq(openclawInstances.id, instanceId))
    .returning();
  return updated;
}

export async function updateInstanceStatus(instanceId: string, status: string) {
  const [updated] = await db
    .update(openclawInstances)
    .set({ status, updatedAt: new Date() })
    .where(eq(openclawInstances.id, instanceId))
    .returning();
  return updated;
}

export async function recordTokenUsage(
  userId: string,
  instanceIdStr: string,
  action: string,
  tokensIn: number,
  tokensOut: number,
  toolName?: string,
  model?: string,
  metadata?: Record<string, unknown>
) {
  await db.insert(openclawTokenLedger).values({
    id: generateId(),
    userId,
    instanceId: instanceIdStr,
    action,
    toolName: toolName || null,
    tokensIn,
    tokensOut,
    model: model || null,
    metadata: metadata || {},
  });

  await db
    .update(openclawInstances)
    .set({
      tokensUsed: sql`${openclawInstances.tokensUsed} + ${tokensIn + tokensOut}`,
      requestCount: sql`${openclawInstances.requestCount} + 1`,
      lastActiveAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(openclawInstances.instanceId, instanceIdStr));
}

export async function checkTokenBudget(userId: string): Promise<{ allowed: boolean; remaining: number; used: number; limit: number }> {
  const instance = await getUserInstance(userId);
  if (!instance) return { allowed: false, remaining: 0, used: 0, limit: 0 };

  const remaining = instance.tokensLimit - instance.tokensUsed;
  return {
    allowed: remaining > 0 && instance.status === "active",
    remaining: Math.max(0, remaining),
    used: instance.tokensUsed,
    limit: instance.tokensLimit,
  };
}

export async function getUserTokenHistory(userId: string, limit = 50) {
  return db
    .select()
    .from(openclawTokenLedger)
    .where(eq(openclawTokenLedger.userId, userId))
    .orderBy(desc(openclawTokenLedger.createdAt))
    .limit(limit);
}

export async function getAdminConfig() {
  const [config] = await db
    .select()
    .from(openclawAdminConfig)
    .where(eq(openclawAdminConfig.id, "default"))
    .limit(1);

  if (!config) {
    const [newConfig] = await db
      .insert(openclawAdminConfig)
      .values({ id: "default" })
      .returning();
    return newConfig;
  }
  return config;
}

export async function updateAdminConfig(updates: Partial<{
  defaultTokensLimit: number;
  globalEnabled: boolean;
  autoProvisionOnLogin: boolean;
  currentVersion: string;
  lastSyncAt: Date;
}>) {
  const [updated] = await db
    .update(openclawAdminConfig)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(openclawAdminConfig.id, "default"))
    .returning();
  return updated;
}

export async function resetUserTokens(instanceId: string) {
  const [updated] = await db
    .update(openclawInstances)
    .set({ tokensUsed: 0, requestCount: 0, updatedAt: new Date() })
    .where(eq(openclawInstances.id, instanceId))
    .returning();
  return updated;
}

export async function getGlobalStats() {
  const instances = await getAllInstances();
  const totalTokens = instances.reduce((sum, i) => sum + i.tokensUsed, 0);
  const totalRequests = instances.reduce((sum, i) => sum + i.requestCount, 0);
  const activeCount = instances.filter((i) => i.status === "active").length;

  return {
    totalInstances: instances.length,
    activeInstances: activeCount,
    totalTokensUsed: totalTokens,
    totalRequests,
    instances,
  };
}

export async function deleteInstance(id: string) {
  const [instance] = await db
    .select()
    .from(openclawInstances)
    .where(eq(openclawInstances.id, id))
    .limit(1);

  if (instance) {
    await db.delete(openclawTokenLedger).where(eq(openclawTokenLedger.instanceId, instance.instanceId));
  }
  await db.delete(openclawInstances).where(eq(openclawInstances.id, id));
}
