/**
 * Login approval requests (push-based MFA)
 *
 * Stored in Postgres to support multi-instance deployments.
 */

import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db, dbRead } from "../db";

export type LoginApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type LoginApprovalRecord = {
  id: string;
  userId: string;
  status: LoginApprovalStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  decidedBySid: string | null;
};

async function ensureTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS login_approvals (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        decided_at TIMESTAMP,
        decided_by_sid VARCHAR(255)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_login_approvals_user ON login_approvals(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_login_approvals_expires ON login_approvals(expires_at)`);
  } catch {
    // Best-effort. If the table already exists or the DB is unavailable, callers will error later.
  }
}

ensureTables();

function mapRow(row: any): LoginApprovalRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    status: String(row.status) as LoginApprovalStatus,
    metadata: (row.metadata as any) || {},
    createdAt: row.created_at ? new Date(row.created_at) : new Date(0),
    expiresAt: row.expires_at ? new Date(row.expires_at) : new Date(0),
    decidedAt: row.decided_at ? new Date(row.decided_at) : null,
    decidedBySid: row.decided_by_sid ? String(row.decided_by_sid) : null,
  };
}

export async function createLoginApproval(params: {
  userId: string;
  metadata?: Record<string, unknown>;
  ttlMs?: number;
}): Promise<{ id: string; expiresAt: Date }> {
  const id = crypto.randomUUID();
  const ttlMs = params.ttlMs ?? 5 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const metadata = params.metadata ?? {};

  await db.execute(sql`
    INSERT INTO login_approvals (id, user_id, status, metadata, expires_at)
    VALUES (${id}, ${params.userId}, 'pending', ${JSON.stringify(metadata)}, ${expiresAt})
  `);

  return { id, expiresAt };
}

export async function getLoginApproval(id: string): Promise<LoginApprovalRecord | null> {
  const result = await dbRead.execute(sql`
    SELECT id, user_id, status, metadata, created_at, expires_at, decided_at, decided_by_sid
    FROM login_approvals
    WHERE id = ${id}
  `);
  const row = (result as any)?.rows?.[0];
  return row ? mapRow(row) : null;
}

export async function respondLoginApproval(params: {
  id: string;
  userId: string;
  decision: "approved" | "denied";
  decidedBySid?: string | null;
}): Promise<{ updated: boolean }> {
  const decidedAt = new Date();
  const decidedBySid = params.decidedBySid ?? null;

  // Only allow transition from pending -> decision, and not after expiry.
  const result = await db.execute(sql`
    UPDATE login_approvals
    SET status = ${params.decision},
        decided_at = ${decidedAt},
        decided_by_sid = ${decidedBySid}
    WHERE id = ${params.id}
      AND user_id = ${params.userId}
      AND status = 'pending'
      AND expires_at > NOW()
  `);

  return { updated: (result as any)?.rowCount ? (result as any).rowCount > 0 : false };
}

export async function expireLoginApproval(id: string): Promise<void> {
  await db.execute(sql`
    UPDATE login_approvals
    SET status = 'expired'
    WHERE id = ${id}
      AND status = 'pending'
      AND expires_at <= NOW()
  `);
}

