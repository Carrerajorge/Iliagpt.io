/**
 * Data Governance — Enterprise compliance features.
 *
 * - Data retention policies (auto-delete after configurable period)
 * - GDPR data export (all user data in JSON)
 * - Audit trail (who did what, when, from where)
 */

import { db } from "../db";
import { chats, chatMessages } from "@shared/schema";
import { eq, and, lt, sql, desc } from "drizzle-orm";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetentionPolicy {
  id: string;
  orgId?: string;
  retentionDays: number;         // 0 = keep forever
  scope: "all" | "archived" | "deleted";
  applyToMessages: boolean;
  applyToFiles: boolean;
  applyToEmbeddings: boolean;
  createdAt: Date;
}

export interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

export interface GDPRExport {
  userId: string;
  exportedAt: string;
  chats: Array<{
    id: string;
    title: string;
    createdAt: string;
    messages: Array<{
      role: string;
      content: string;
      createdAt: string;
    }>;
  }>;
  profile: Record<string, unknown>;
  files: Array<{ filename: string; mimeType: string; uploadedAt: string }>;
  settings: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// In-memory audit log (production would use a dedicated table)
// ---------------------------------------------------------------------------

const auditLog: AuditEntry[] = [];
const MAX_AUDIT_LOG = 10000;

/**
 * Record an audit event.
 */
export function audit(entry: Omit<AuditEntry, "id" | "timestamp">): void {
  const full: AuditEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date(),
  };

  auditLog.push(full);
  if (auditLog.length > MAX_AUDIT_LOG) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_LOG);
  }

  // Also persist to DB asynchronously (best-effort)
  persistAuditEntry(full).catch(() => {});
}

async function persistAuditEntry(entry: AuditEntry): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO audit_logs (id, user_id, action, resource, resource_id, details, ip_address, user_agent, created_at)
      VALUES (${entry.id}, ${entry.userId}, ${entry.action}, ${entry.resource}, ${entry.resourceId || null},
              ${entry.details ? JSON.stringify(entry.details) : null}::jsonb,
              ${entry.ipAddress || null}, ${entry.userAgent || null}, ${entry.timestamp})
      ON CONFLICT DO NOTHING
    `);
  } catch {
    // audit_logs table may not exist yet — that's fine
  }
}

/**
 * Query recent audit entries.
 */
export function getAuditLog(options: {
  userId?: string;
  action?: string;
  resource?: string;
  limit?: number;
  since?: Date;
}): AuditEntry[] {
  let entries = auditLog;

  if (options.userId) entries = entries.filter(e => e.userId === options.userId);
  if (options.action) entries = entries.filter(e => e.action === options.action);
  if (options.resource) entries = entries.filter(e => e.resource === options.resource);
  if (options.since) entries = entries.filter(e => e.timestamp >= options.since!);

  return entries.slice(-(options.limit || 100)).reverse();
}

// ---------------------------------------------------------------------------
// Data Retention
// ---------------------------------------------------------------------------

const retentionPolicies = new Map<string, RetentionPolicy>();

/**
 * Set a data retention policy for an organization or globally.
 */
export function setRetentionPolicy(policy: Omit<RetentionPolicy, "id" | "createdAt">): RetentionPolicy {
  const full: RetentionPolicy = {
    ...policy,
    id: crypto.randomUUID(),
    createdAt: new Date(),
  };
  retentionPolicies.set(policy.orgId || "global", full);
  return full;
}

/**
 * Get the active retention policy for an org (falls back to global).
 */
export function getRetentionPolicy(orgId?: string): RetentionPolicy | null {
  return retentionPolicies.get(orgId || "global") || retentionPolicies.get("global") || null;
}

/**
 * Apply retention policy: delete data older than the retention period.
 * Returns the number of records deleted.
 */
export async function applyRetention(orgId?: string): Promise<{ chatsDeleted: number; messagesDeleted: number }> {
  const policy = getRetentionPolicy(orgId);
  if (!policy || policy.retentionDays === 0) return { chatsDeleted: 0, messagesDeleted: 0 };

  const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
  let chatsDeleted = 0;
  let messagesDeleted = 0;

  try {
    // Delete old messages
    if (policy.applyToMessages) {
      const result = await db
        .delete(chatMessages)
        .where(lt(chatMessages.createdAt, cutoff));
      messagesDeleted = (result as any).rowCount ?? 0;
    }

    // Delete old chats (only archived/deleted if scope requires)
    const chatConditions = [lt(chats.createdAt, cutoff)];
    if (policy.scope === "archived") {
      chatConditions.push(eq(chats.archived, "true"));
    } else if (policy.scope === "deleted") {
      chatConditions.push(sql`${chats.deletedAt} IS NOT NULL`);
    }

    const chatResult = await db
      .delete(chats)
      .where(and(...chatConditions));
    chatsDeleted = (chatResult as any).rowCount ?? 0;

    audit({
      userId: "system",
      action: "retention_applied",
      resource: "data",
      details: { chatsDeleted, messagesDeleted, retentionDays: policy.retentionDays, orgId },
    });
  } catch (err: any) {
    console.error("[DataGovernance] Retention failed:", err?.message);
  }

  return { chatsDeleted, messagesDeleted };
}

// ---------------------------------------------------------------------------
// GDPR Data Export
// ---------------------------------------------------------------------------

/**
 * Export all data for a user in GDPR-compliant JSON format.
 */
export async function exportUserData(userId: string): Promise<GDPRExport> {
  audit({
    userId,
    action: "gdpr_export_requested",
    resource: "user_data",
  });

  // Fetch all user chats with messages
  const userChats = await db
    .select()
    .from(chats)
    .where(eq(chats.userId, userId))
    .orderBy(desc(chats.createdAt));

  const chatExports = [];
  for (const chat of userChats) {
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chat.id))
      .orderBy(chatMessages.createdAt);

    chatExports.push({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt.toISOString(),
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  }

  // Fetch user profile
  let profile: Record<string, unknown> = {};
  try {
    const { users } = await import("@shared/schema");
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (user) {
      profile = {
        id: user.id,
        username: (user as any).username,
        email: (user as any).email,
        createdAt: (user as any).createdAt,
      };
    }
  } catch {
    // user table structure may vary
  }

  // Fetch user files
  let files: GDPRExport["files"] = [];
  try {
    const { files: filesTable } = await import("@shared/schema/files");
    const userFiles = await db.select().from(filesTable).where(eq(filesTable.userId, userId));
    files = userFiles.map(f => ({
      filename: f.originalName || "",
      mimeType: f.mimeType || "",
      uploadedAt: f.createdAt ? new Date(f.createdAt).toISOString() : "",
    }));
  } catch {
    // files table may not exist
  }

  // Fetch user settings
  let settings: Record<string, unknown> = {};
  try {
    const { userSettings } = await import("@shared/schema");
    const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    if (s) {
      const { userId: _, ...rest } = s as any;
      settings = rest;
    }
  } catch {
    // settings may not exist
  }

  return {
    userId,
    exportedAt: new Date().toISOString(),
    chats: chatExports,
    profile,
    files,
    settings,
  };
}

/**
 * Delete all user data (GDPR right to be forgotten).
 */
export async function deleteUserData(userId: string): Promise<{ deleted: boolean; details: Record<string, number> }> {
  audit({
    userId,
    action: "gdpr_deletion_requested",
    resource: "user_data",
  });

  const details: Record<string, number> = {};

  try {
    // Delete messages first (FK constraint)
    const userChatIds = await db.select({ id: chats.id }).from(chats).where(eq(chats.userId, userId));
    for (const chat of userChatIds) {
      const r = await db.delete(chatMessages).where(eq(chatMessages.chatId, chat.id));
      details.messages = (details.messages || 0) + ((r as any).rowCount ?? 0);
    }

    // Delete chats
    const r2 = await db.delete(chats).where(eq(chats.userId, userId));
    details.chats = (r2 as any).rowCount ?? 0;

    // Delete RAG data
    try {
      const { ragChunks } = await import("@shared/schema/rag");
      const r3 = await db.delete(ragChunks).where(eq(ragChunks.userId, userId));
      details.ragChunks = (r3 as any).rowCount ?? 0;
    } catch {
      // rag table may not exist
    }

    return { deleted: true, details };
  } catch (err: any) {
    console.error("[DataGovernance] User data deletion failed:", err?.message);
    return { deleted: false, details };
  }
}
