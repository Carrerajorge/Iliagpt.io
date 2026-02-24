/**
 * Enhanced Audit Logger Service
 * Captures detailed audit information for all admin actions
 */

import { Request } from "express";
import { storage } from "../storage";
import { getSecureUserId } from "../lib/anonUserHelper";

export interface AuditContext {
  userId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string | null;
  requestId?: string | null;
}

export interface AuditLogOptions {
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, any>;
  severity?: "info" | "warning" | "error" | "critical";
  category?: "auth" | "admin" | "user" | "system" | "security" | "data" | "config";
}

/**
 * Extract audit context from Express request
 */
export function extractAuditContext(req: Request): AuditContext {
  const userId = getSecureUserId(req);

  const anyReq = req as any;
  const actorEmail =
    anyReq.user?.claims?.email ||
    anyReq.user?.email ||
    anyReq.session?.passport?.user?.claims?.email ||
    anyReq.session?.passport?.user?.email ||
    anyReq.user?.profile?.emails?.[0]?.value ||
    null;
  const actorRole =
    anyReq.user?.role ||
    anyReq.user?.claims?.role ||
    anyReq.session?.passport?.user?.role ||
    anyReq.session?.passport?.user?.claims?.role ||
    null;

  const ipAddress =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.headers["x-real-ip"] as string) ||
    req.socket?.remoteAddress ||
    req.ip ||
    "unknown";
  const userAgent = req.headers["user-agent"] || "unknown";
  const sessionId = anyReq.sessionID || anyReq.cookies?.sessionId || null;
  const requestId = anyReq.requestId || (req.headers["x-request-id"] as string) || null;

  return {
    userId,
    actorEmail,
    actorRole,
    ipAddress,
    userAgent,
    sessionId,
    requestId,
  };
}

/**
 * Create a detailed audit log entry
 */
export async function createAuditLogEntry(
  context: AuditContext,
  options: AuditLogOptions
): Promise<void> {
  try {
    await storage.createAuditLog({
      userId: context.userId,
      action: options.action,
      resource: options.resource,
      resourceId: options.resourceId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      details: {
        actorEmail: context.actorEmail,
        actorRole: context.actorRole,
        ...options.details,
        severity: options.severity || "info",
        category: options.category || "system",
        sessionId: context.sessionId,
        requestId: context.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[AuditLogger] Failed to create audit log:", error);
  }
}

/**
 * Convenience wrapper that takes an Express request directly
 */
export async function auditLog(
  req: Request,
  options: AuditLogOptions
): Promise<void> {
  const context = extractAuditContext(req);
  await createAuditLogEntry(context, options);
}

/**
 * Pre-configured audit loggers for common actions
 */
export const AuditActions = {
  // Authentication
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  AUTH_LOGIN_FAILED: "auth.login_failed",
  AUTH_PASSWORD_RESET: "auth.password_reset",
  AUTH_SESSION_CREATED: "auth.session_created",
  AUTH_SESSION_EXPIRED: "auth.session_expired",

  // User Management
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  USER_DELETED: "user.deleted",
  USER_ROLE_CHANGED: "user.role_changed",
  USER_PLAN_CHANGED: "user.plan_changed",
  USER_STATUS_CHANGED: "user.status_changed",

  // Admin Actions
  ADMIN_ACCESS: "admin.access",
  ADMIN_DENIED: "admin.access_denied",
  ADMIN_SETTINGS_CHANGED: "admin.settings_changed",
  ADMIN_EXPORT_DATA: "admin.export_data",
  ADMIN_IMPORT_DATA: "admin.import_data",

  // AI Models
  MODEL_CREATED: "model.created",
  MODEL_UPDATED: "model.updated",
  MODEL_DELETED: "model.deleted",
  MODEL_ENABLED: "model.enabled",
  MODEL_DISABLED: "model.disabled",
  MODEL_CONFIG_CHANGED: "model.config_changed",
  MODEL_TESTED: "model.tested",
  MODELS_SYNC: "models.sync",
  MODELS_SYNC_ALL: "models.sync_all",

  // Conversations
  CHAT_CREATED: "chat.created",
  CHAT_DELETED: "chat.deleted",
  CHAT_FLAGGED: "chat.flagged",
  CHAT_EXPORTED: "chat.exported",
  CHAT_STREAM: "chat.stream",

  // Payments
  PAYMENT_RECEIVED: "payment.received",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_REFUNDED: "payment.refunded",
  PAYMENT_RECONCILED: "payment.reconciled",
  PAYMENT_DISPUTED: "payment.disputed",

  // Invoices
  INVOICE_CREATED: "invoice.created",
  INVOICE_SENT: "invoice.sent",
  INVOICE_PAID: "invoice.paid",
  INVOICE_CANCELLED: "invoice.cancelled",

  // Security
  SECURITY_POLICY_CREATED: "security.policy_created",
  SECURITY_POLICY_UPDATED: "security.policy_updated",
  SECURITY_POLICY_DELETED: "security.policy_deleted",
  SECURITY_POLICY_ENABLED: "security.policy_enabled",
  SECURITY_POLICY_DISABLED: "security.policy_disabled",
  SECURITY_ALERT: "security.alert",
  SECURITY_IP_BLOCKED: "security.ip_blocked",
  SECURITY_RATE_LIMITED: "security.rate_limited",

  // Reports
  REPORT_GENERATED: "report.generated",
  REPORT_SCHEDULED: "report.scheduled",
  REPORT_EXPORTED: "report.exported",

  // Database
  DB_QUERY_EXECUTED: "db.query_executed",
  DB_BACKUP_CREATED: "db.backup_created",
  DB_MIGRATION_RUN: "db.migration_run",

  // System
  SYSTEM_CONFIG_CHANGED: "system.config_changed",
  SYSTEM_MAINTENANCE: "system.maintenance",
  SYSTEM_ERROR: "system.error",
} as const;

export type AuditAction = typeof AuditActions[keyof typeof AuditActions];
