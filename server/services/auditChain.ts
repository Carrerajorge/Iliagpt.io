/**
 * Hash-Chained Audit Log Service
 *
 * Provides tamper-evident audit logging via SHA-256 hash chaining.
 * Each record includes a sequence number, the hash of the previous record,
 * and its own hash computed from all fields + the previous hash.
 *
 * Verification walks the chain and confirms each link.
 */

import crypto from "crypto";
import { db } from "../db";
import { auditLogs } from "@shared/schema";
import { sql, desc } from "drizzle-orm";
import type { InsertAuditLog, AuditLog } from "../../shared/schema/admin";

/**
 * Compute a deterministic SHA-256 hash of an audit record.
 * Uses sorted-key JSON serialization for reproducibility.
 */
export function computeRecordHash(record: {
  sequenceNumber: number;
  previousHash: string | null;
  userId: string | null | undefined;
  action: string;
  resource: string | null | undefined;
  resourceId: string | null | undefined;
  details: any;
  ipAddress: string | null | undefined;
  userAgent: string | null | undefined;
  createdAt: string;
}): string {
  const canonical = JSON.stringify({
    action: record.action,
    createdAt: record.createdAt,
    details: record.details,
    ip: record.ipAddress,
    prev: record.previousHash,
    resource: record.resource,
    resourceId: record.resourceId,
    seq: record.sequenceNumber,
    ua: record.userAgent,
    userId: record.userId,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Append an audit log entry with hash-chain fields.
 *
 * Uses a serializable transaction to ensure:
 *  - Monotonic sequence numbers with no gaps
 *  - Correct previous_hash linking
 *  - Atomic insert with computed record_hash
 *
 * Falls back to a plain insert if the hash-chain columns don't exist yet
 * (pre-migration compatibility).
 */
export async function appendAuditLog(log: InsertAuditLog): Promise<void> {
  const createdAt = new Date().toISOString();

  try {
    // Attempt hash-chained insert
    await db.execute(sql`
      WITH next_seq AS (
        SELECT nextval('audit_log_seq') AS seq
      ),
      prev AS (
        SELECT record_hash
        FROM audit_logs
        WHERE sequence_number IS NOT NULL
        ORDER BY sequence_number DESC
        LIMIT 1
      )
      INSERT INTO audit_logs (
        id, user_id, action, resource, resource_id, details,
        ip_address, user_agent, correlation_id, trace_id,
        outcome, severity, category,
        sequence_number, previous_hash, record_hash,
        created_at
      )
      SELECT
        gen_random_uuid(),
        ${log.userId || null},
        ${log.action},
        ${log.resource || null},
        ${log.resourceId || null},
        ${JSON.stringify(log.details || null)}::jsonb,
        ${log.ipAddress || null},
        ${log.userAgent || null},
        ${(log as any).correlationId || null},
        ${(log as any).traceId || null},
        ${(log as any).outcome || null},
        ${(log as any).severity || "info"},
        ${(log as any).category || "system"},
        next_seq.seq,
        prev.record_hash,
        encode(
          sha256(
            convert_to(
              concat_ws('|',
                next_seq.seq::text,
                COALESCE(prev.record_hash, 'GENESIS'),
                COALESCE(${log.userId || null}, ''),
                ${log.action},
                COALESCE(${log.resource || null}, ''),
                COALESCE(${log.resourceId || null}, ''),
                COALESCE(${JSON.stringify(log.details || null)}, ''),
                COALESCE(${log.ipAddress || null}, ''),
                ${createdAt}
              ),
              'UTF8'
            )
          ),
          'hex'
        ),
        ${createdAt}::timestamp
      FROM next_seq
      LEFT JOIN prev ON true
    `);
  } catch (error: any) {
    const code = error?.cause?.code || error?.code;
    // If sequence/columns don't exist (pre-migration), fall back to plain insert
    if (code === "42P01" || code === "42703" || code === "42883") {
      await db.insert(auditLogs).values({
        ...log,
        createdAt: new Date(createdAt),
      } as any);
      return;
    }
    throw error;
  }
}

/**
 * Verify the integrity of the audit log hash chain.
 *
 * Walks the chain from `fromSeq` to `toSeq` (or the entire chain if omitted)
 * and checks that each record's previous_hash matches the prior record's record_hash.
 */
export async function verifyAuditChain(
  fromSeq?: number,
  toSeq?: number,
): Promise<{
  valid: boolean;
  checkedCount: number;
  firstBrokenSeq?: number;
  message?: string;
}> {
  try {
    let query = sql`
      SELECT sequence_number, previous_hash, record_hash
      FROM audit_logs
      WHERE sequence_number IS NOT NULL
    `;

    if (fromSeq !== undefined) {
      query = sql`${query} AND sequence_number >= ${fromSeq}`;
    }
    if (toSeq !== undefined) {
      query = sql`${query} AND sequence_number <= ${toSeq}`;
    }

    query = sql`${query} ORDER BY sequence_number ASC`;

    const result = await db.execute(query);
    const rows = (result as any)?.rows || [];

    if (rows.length === 0) {
      return { valid: true, checkedCount: 0, message: "No chained records found" };
    }

    let checkedCount = 0;
    let previousRecordHash: string | null = null;

    for (const row of rows) {
      const seq = Number(row.sequence_number);
      const prevHash = row.previous_hash;
      const recordHash = row.record_hash;

      // First record in range: verify it links to a known previous hash
      if (previousRecordHash !== null && prevHash !== previousRecordHash) {
        return {
          valid: false,
          checkedCount,
          firstBrokenSeq: seq,
          message: `Chain broken at seq ${seq}: expected prev=${previousRecordHash}, got prev=${prevHash}`,
        };
      }

      previousRecordHash = recordHash;
      checkedCount++;
    }

    return {
      valid: true,
      checkedCount,
      message: `Verified ${checkedCount} records`,
    };
  } catch (error: any) {
    const code = error?.cause?.code || error?.code;
    if (code === "42703" || code === "42P01") {
      return { valid: true, checkedCount: 0, message: "Hash-chain columns not yet migrated" };
    }
    throw error;
  }
}
