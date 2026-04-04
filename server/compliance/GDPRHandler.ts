/**
 * GDPRHandler.ts
 * GDPR compliance handler: data access, portability, erasure, consent management,
 * retention policies, and privacy reporting. Privacy-safe logging throughout.
 */

import crypto from 'crypto';
import { RequestHandler, Request, Response, NextFunction } from 'express';
import { pool } from '../db';
import { Logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export type GDPRRequestStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'rejected';
export type GDPRRequestType   = 'access' | 'deletion' | 'portability' | 'rectification';

export interface AccessRequest {
  id: string;
  userId: string;
  requestedBy: string;
  type: GDPRRequestType;
  status: GDPRRequestStatus;
  createdAt: Date;
  completedAt: Date | null;
  dataExport?: DataExport;
}

export interface DataExport {
  userId: string;
  user: UserData | null;
  chats: ChatData[];
  agents: AgentData[];
  documents: DocumentData[];
  auditLog: AuditEntry[];
  apiKeys: ApiKeyData[];
  exportedAt: Date;
  format: 'json';
}

export interface UserData {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
  role: string;
}

export interface ChatData {
  id: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  messages: MessageData[];
}

export interface MessageData {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}

export interface AgentData {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

export interface DocumentData {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress: string | null;
  createdAt: Date;
}

export interface ApiKeyData {
  id: string;
  name: string;
  maskedKey: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface DeletionRequest {
  id: string;
  userId: string;
  requestedBy: string;
  reason: string | null;
  status: GDPRRequestStatus;
  scheduledFor: Date; // 30-day window
  createdAt: Date;
  completedAt: Date | null;
}

export interface DeletionResult {
  requestId: string;
  userId: string;
  deletedAt: Date;
  actions: DeletionAction[];
  retainedRecords: RetainedRecord[];
}

export interface DeletionAction {
  resource: string;
  count: number;
  action: 'deleted' | 'anonymised';
}

export interface RetainedRecord {
  resource: string;
  reason: string;
  retentionPeriod: string;
}

export type ConsentType = 'marketing' | 'analytics' | 'thirdParty' | 'essential';

export interface ConsentRecord {
  id?: string;
  userId: string;
  consentType: ConsentType;
  granted: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  privacyPolicyVersion: string;
  grantedAt: Date;
  withdrawnAt: Date | null;
}

export interface RetentionReport {
  generatedAt: Date;
  overdueRecords: OverdueRecord[];
  summary: Record<string, number>;
}

export interface OverdueRecord {
  table: string;
  id: string;
  userId: string;
  createdAt: Date;
  retentionDays: number;
  daysOverdue: number;
}

export interface PrivacyReport {
  userId: string;
  generatedAt: Date;
  dataCategories: DataCategory[];
  legalBases: LegalBasis[];
  thirdParties: string[];
  retentionPolicies: RetentionPolicy[];
  openRequests: number;
}

export interface DataCategory {
  name: string;
  description: string;
  examples: string[];
  recordCount: number;
}

export interface LegalBasis {
  category: string;
  basis: string;
  description: string;
}

export interface RetentionPolicy {
  dataType: string;
  retentionDays: number;
  legalRequirement: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DELETION_WINDOW_DAYS   = 30;
const ENCRYPTION_ALGORITHM   = 'aes-256-gcm';
const IV_LENGTH              = 16;
const AUTH_TAG_LENGTH        = 16;

// Data retention periods (days)
const RETENTION_POLICIES: RetentionPolicy[] = [
  { dataType: 'messages',     retentionDays: 730,  legalRequirement: false },
  { dataType: 'audit_log',    retentionDays: 2555, legalRequirement: true  }, // 7 years
  { dataType: 'billing',      retentionDays: 2555, legalRequirement: true  },
  { dataType: 'api_keys',     retentionDays: 365,  legalRequirement: false },
  { dataType: 'documents',    retentionDays: 730,  legalRequirement: false },
  { dataType: 'consent',      retentionDays: 2555, legalRequirement: true  },
];

// ---------------------------------------------------------------------------
// Helper: derive a deterministic per-user encryption key
// ---------------------------------------------------------------------------

function deriveUserKey(userId: string): Buffer {
  const secret = process.env.GDPR_EXPORT_SECRET ?? 'gdpr-export-default-secret-CHANGE-ME';
  return crypto.pbkdf2Sync(secret, userId, 100_000, 32, 'sha256');
}

// ---------------------------------------------------------------------------
// Helper: encrypt JSON payload
// ---------------------------------------------------------------------------

function encryptPayload(plaintext: string, userId: string): string {
  const key = deriveUserKey(userId);
  const iv  = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv) as crypto.CipherGCM;
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext  (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Helper: one-way hash for anonymisation (not reversible)
// ---------------------------------------------------------------------------

function anonymiseEmail(email: string): string {
  const hash = crypto.createHash('sha256').update(email).digest('hex').slice(0, 16);
  return `deleted-${hash}@gdpr-anonymised.invalid`;
}

function anonymiseValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// GDPRHandler class
// ---------------------------------------------------------------------------

export class GDPRHandler {
  private static instance: GDPRHandler;
  private initialised = false;

  private constructor() {}

  static getInstance(): GDPRHandler {
    if (!GDPRHandler.instance) {
      GDPRHandler.instance = new GDPRHandler();
    }
    return GDPRHandler.instance;
  }

  // ---- Initialisation ------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialised) return;
    await this.ensureTables();
    this.initialised = true;
    Logger.info('GDPRHandler initialised');
  }

  private async ensureTables(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // GDPR requests (access + deletion)
      await client.query(`
        CREATE TABLE IF NOT EXISTS gdpr_requests (
          id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id        UUID        NOT NULL,
          requested_by   UUID        NOT NULL,
          type           TEXT        NOT NULL CHECK (type IN ('access','deletion','portability','rectification')),
          status         TEXT        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending','processing','completed','failed','rejected')),
          reason         TEXT,
          scheduled_for  TIMESTAMPTZ,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at   TIMESTAMPTZ,
          metadata       JSONB       DEFAULT '{}'
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gdpr_requests_user_id
          ON gdpr_requests (user_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gdpr_requests_status
          ON gdpr_requests (status)
      `);

      // Consent records
      await client.query(`
        CREATE TABLE IF NOT EXISTS consent_records (
          id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id                 UUID        NOT NULL,
          consent_type            TEXT        NOT NULL CHECK (consent_type IN ('marketing','analytics','thirdParty','essential')),
          granted                 BOOLEAN     NOT NULL,
          ip_address              INET,
          user_agent              TEXT,
          privacy_policy_version  TEXT        NOT NULL DEFAULT '1.0',
          granted_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          withdrawn_at            TIMESTAMPTZ
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_consent_records_user_id
          ON consent_records (user_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_consent_records_type
          ON consent_records (user_id, consent_type)
      `);

      // Data retention policies (configurable per-deployment)
      await client.query(`
        CREATE TABLE IF NOT EXISTS data_retention_policies (
          id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          data_type        TEXT        NOT NULL UNIQUE,
          retention_days   INTEGER     NOT NULL,
          legal_requirement BOOLEAN    NOT NULL DEFAULT FALSE,
          description      TEXT,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // Seed default retention policies (upsert)
      for (const policy of RETENTION_POLICIES) {
        await client.query(`
          INSERT INTO data_retention_policies (data_type, retention_days, legal_requirement)
          VALUES ($1, $2, $3)
          ON CONFLICT (data_type) DO NOTHING
        `, [policy.dataType, policy.retentionDays, policy.legalRequirement]);
      }

      await client.query('COMMIT');
      Logger.info('GDPR tables ensured');
    } catch (err) {
      await client.query('ROLLBACK');
      Logger.error('Failed to ensure GDPR tables', err);
      throw err;
    } finally {
      client.release();
    }
  }

  // ---- Data Access Request -------------------------------------------------

  async requestAccess(userId: string, requestedBy: string): Promise<AccessRequest> {
    await this.init();

    const client = await pool.connect();
    try {
      // Create request record
      const reqResult = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO gdpr_requests (user_id, requested_by, type, status)
         VALUES ($1, $2, 'access', 'processing')
         RETURNING id, created_at`,
        [userId, requestedBy],
      );
      const { id: requestId, created_at: createdAt } = reqResult.rows[0];

      // Collect all user data
      const dataExport = await this.exportData(userId);

      // Mark complete
      await client.query(
        `UPDATE gdpr_requests SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [requestId],
      );

      Logger.info('GDPR access request completed', { requestId, userId: '[REDACTED]' });

      return {
        id:          requestId,
        userId,
        requestedBy,
        type:        'access',
        status:      'completed',
        createdAt,
        completedAt: new Date(),
        dataExport,
      };
    } catch (err) {
      await client.query(
        `UPDATE gdpr_requests SET status = 'failed', completed_at = NOW() WHERE user_id = $1 AND type = 'access' AND status = 'processing'`,
        [userId],
      );
      Logger.error('GDPR access request failed', err);
      throw err;
    } finally {
      client.release();
    }
  }

  // ---- Data Export ---------------------------------------------------------

  async exportData(userId: string): Promise<DataExport> {
    await this.init();

    const client = await pool.connect();
    try {
      // User record
      const userRows = await client.query<{
        id: string; email: string; name: string | null;
        created_at: Date; updated_at: Date; role: string;
      }>(
        `SELECT id, email, name, created_at, updated_at,
                COALESCE(role, 'user') AS role
         FROM users WHERE id = $1`,
        [userId],
      );
      const userData: UserData | null = userRows.rows[0]
        ? {
            id:        userRows.rows[0].id,
            email:     userRows.rows[0].email,
            name:      userRows.rows[0].name,
            createdAt: userRows.rows[0].created_at,
            updatedAt: userRows.rows[0].updated_at,
            role:      userRows.rows[0].role,
          }
        : null;

      // Chats + messages
      const chatRows = await client.query<{
        id: string; title: string | null; created_at: Date; updated_at: Date;
      }>(
        `SELECT id, title, created_at, updated_at
         FROM chats WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );

      const chats: ChatData[] = await Promise.all(
        chatRows.rows.map(async (chat) => {
          const msgRows = await client.query<{
            id: string; role: string; content: string; created_at: Date;
          }>(
            `SELECT id, role, content, created_at
             FROM messages WHERE chat_id = $1 ORDER BY created_at ASC`,
            [chat.id],
          );
          return {
            id:           chat.id,
            title:        chat.title,
            createdAt:    chat.created_at,
            updatedAt:    chat.updated_at,
            messageCount: msgRows.rowCount ?? 0,
            messages:     msgRows.rows.map(m => ({
              id:        m.id,
              role:      m.role,
              content:   m.content,
              createdAt: m.created_at,
            })),
          };
        }),
      );

      // Agents
      const agentRows = await client.query<{
        id: string; name: string; description: string | null; created_at: Date;
      }>(
        `SELECT id, name, description, created_at
         FROM agents WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      const agents: AgentData[] = agentRows.rows.map(a => ({
        id:          a.id,
        name:        a.name,
        description: a.description,
        createdAt:   a.created_at,
      }));

      // Documents
      const docRows = await client.query<{
        id: string; filename: string; mime_type: string; size_bytes: number; created_at: Date;
      }>(
        `SELECT id, filename, mime_type, size_bytes, created_at
         FROM documents WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      const documents: DocumentData[] = docRows.rows.map(d => ({
        id:        d.id,
        filename:  d.filename,
        mimeType:  d.mime_type,
        sizeBytes: d.size_bytes,
        createdAt: d.created_at,
      }));

      // Audit log
      const auditRows = await client.query<{
        id: string; action: string; resource_type: string;
        resource_id: string; ip_address: string | null; created_at: Date;
      }>(
        `SELECT id, action, resource_type, resource_id, ip_address, created_at
         FROM audit_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10000`,
        [userId],
      );
      const auditLog: AuditEntry[] = auditRows.rows.map(r => ({
        id:           r.id,
        action:       r.action,
        resourceType: r.resource_type,
        resourceId:   r.resource_id,
        ipAddress:    r.ip_address,
        createdAt:    r.created_at,
      }));

      // API keys (masked)
      const keyRows = await client.query<{
        id: string; name: string; key_prefix: string; created_at: Date; last_used_at: Date | null;
      }>(
        `SELECT id, name, key_prefix, created_at, last_used_at
         FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      const apiKeys: ApiKeyData[] = keyRows.rows.map(k => ({
        id:          k.id,
        name:        k.name,
        maskedKey:   `${k.key_prefix}${'*'.repeat(20)}`,
        createdAt:   k.created_at,
        lastUsedAt:  k.last_used_at,
      }));

      Logger.info('GDPR data export assembled', { userId: '[REDACTED]', tables: 6 });

      return {
        userId,
        user:       userData,
        chats,
        agents,
        documents,
        auditLog,
        apiKeys,
        exportedAt: new Date(),
        format:     'json',
      };
    } finally {
      client.release();
    }
  }

  // ---- Deletion Request ----------------------------------------------------

  async requestDeletion(
    userId: string,
    requestedBy: string,
    reason?: string,
  ): Promise<DeletionRequest> {
    await this.init();

    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + DELETION_WINDOW_DAYS);

    const result = await pool.query<{
      id: string; created_at: Date;
    }>(
      `INSERT INTO gdpr_requests (user_id, requested_by, type, status, reason, scheduled_for)
       VALUES ($1, $2, 'deletion', 'pending', $3, $4)
       RETURNING id, created_at`,
      [userId, requestedBy, reason ?? null, scheduledFor],
    );

    const { id, created_at } = result.rows[0];

    Logger.info('GDPR deletion request created', {
      requestId: id,
      userId: '[REDACTED]',
      scheduledFor: scheduledFor.toISOString(),
    });

    return {
      id,
      userId,
      requestedBy,
      reason:       reason ?? null,
      status:       'pending',
      scheduledFor,
      createdAt:    created_at,
      completedAt:  null,
    };
  }

  // ---- Process Deletion ----------------------------------------------------

  async processDeletion(requestId: string): Promise<DeletionResult> {
    await this.init();

    const client = await pool.connect();
    try {
      // Fetch the request
      const reqResult = await client.query<{
        user_id: string; status: GDPRRequestStatus; scheduled_for: Date;
      }>(
        `SELECT user_id, status, scheduled_for FROM gdpr_requests WHERE id = $1`,
        [requestId],
      );

      if (reqResult.rowCount === 0) {
        throw new Error(`GDPR request ${requestId} not found`);
      }

      const { user_id: userId, status, scheduled_for: scheduledFor } = reqResult.rows[0];

      if (status !== 'pending') {
        throw new Error(`GDPR deletion request ${requestId} is not in pending state (current: ${status})`);
      }

      if (new Date() < scheduledFor) {
        throw new Error(`GDPR deletion request ${requestId} is not yet due (scheduled: ${scheduledFor.toISOString()})`);
      }

      await client.query('BEGIN');
      await client.query(
        `UPDATE gdpr_requests SET status = 'processing' WHERE id = $1`,
        [requestId],
      );

      const actions: DeletionAction[] = [];

      // 1. Delete messages
      const msgDel = await client.query(
        `DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_id = $1)`,
        [userId],
      );
      actions.push({ resource: 'messages', count: msgDel.rowCount ?? 0, action: 'deleted' });

      // 2. Delete chats
      const chatDel = await client.query(
        `DELETE FROM chats WHERE user_id = $1`,
        [userId],
      );
      actions.push({ resource: 'chats', count: chatDel.rowCount ?? 0, action: 'deleted' });

      // 3. Delete agents
      const agentDel = await client.query(
        `DELETE FROM agents WHERE user_id = $1`,
        [userId],
      );
      actions.push({ resource: 'agents', count: agentDel.rowCount ?? 0, action: 'deleted' });

      // 4. Delete documents
      const docDel = await client.query(
        `DELETE FROM documents WHERE user_id = $1`,
        [userId],
      );
      actions.push({ resource: 'documents', count: docDel.rowCount ?? 0, action: 'deleted' });

      // 5. Revoke API keys
      const keyDel = await client.query(
        `DELETE FROM api_keys WHERE user_id = $1`,
        [userId],
      );
      actions.push({ resource: 'api_keys', count: keyDel.rowCount ?? 0, action: 'deleted' });

      // 6. Anonymise audit log (retain for compliance, strip PII)
      const auditAnon = await client.query(
        `UPDATE audit_log
         SET ip_address = NULL,
             metadata   = jsonb_strip_nulls(metadata - 'email' - 'name' - 'ip')
         WHERE user_id = $1`,
        [userId],
      );
      actions.push({ resource: 'audit_log', count: auditAnon.rowCount ?? 0, action: 'anonymised' });

      // 7. Anonymise user record (right to erasure; keep row for FK integrity)
      const anonEmail = anonymiseEmail(userId);
      const anonName  = 'Deleted User';
      await client.query(
        `UPDATE users
         SET email         = $2,
             name          = $3,
             password_hash = NULL,
             avatar_url    = NULL,
             deleted_at    = NOW()
         WHERE id = $1`,
        [userId, anonEmail, anonName],
      );
      actions.push({ resource: 'users', count: 1, action: 'anonymised' });

      // Mark complete
      await client.query(
        `UPDATE gdpr_requests SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [requestId],
      );

      await client.query('COMMIT');

      const retainedRecords: RetainedRecord[] = [
        {
          resource:        'audit_log',
          reason:          'Legal requirement for security audit trail',
          retentionPeriod: '7 years',
        },
        {
          resource:        'billing_records',
          reason:          'Tax and financial regulation compliance',
          retentionPeriod: '7 years',
        },
        {
          resource:        'gdpr_requests',
          reason:          'GDPR accountability obligation',
          retentionPeriod: '7 years',
        },
      ];

      Logger.info('GDPR deletion processed', {
        requestId,
        userId: '[REDACTED]',
        actionsCount: actions.length,
      });

      return {
        requestId,
        userId,
        deletedAt:       new Date(),
        actions,
        retainedRecords,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      await client.query(
        `UPDATE gdpr_requests SET status = 'failed', completed_at = NOW() WHERE id = $1`,
        [requestId],
      ).catch(() => {});
      Logger.error('GDPR deletion failed', err);
      throw err;
    } finally {
      client.release();
    }
  }

  // ---- Consent Management --------------------------------------------------

  async recordConsent(userId: string, consent: Omit<ConsentRecord, 'id' | 'userId'>): Promise<void> {
    await this.init();

    await pool.query(
      `INSERT INTO consent_records
         (user_id, consent_type, granted, ip_address, user_agent, privacy_policy_version, granted_at, withdrawn_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        consent.consentType,
        consent.granted,
        consent.ipAddress  ?? null,
        consent.userAgent  ?? null,
        consent.privacyPolicyVersion,
        consent.grantedAt,
        consent.withdrawnAt ?? null,
      ],
    );

    Logger.info('Consent recorded', { userId: '[REDACTED]', consentType: consent.consentType, granted: consent.granted });
  }

  async getConsent(userId: string): Promise<ConsentRecord[]> {
    await this.init();

    const result = await pool.query<{
      id: string; consent_type: ConsentType; granted: boolean;
      ip_address: string | null; user_agent: string | null;
      privacy_policy_version: string; granted_at: Date; withdrawn_at: Date | null;
    }>(
      `SELECT id, consent_type, granted, ip_address, user_agent,
              privacy_policy_version, granted_at, withdrawn_at
       FROM consent_records
       WHERE user_id = $1
       ORDER BY granted_at DESC`,
      [userId],
    );

    return result.rows.map(r => ({
      id:                   r.id,
      userId,
      consentType:          r.consent_type,
      granted:              r.granted,
      ipAddress:            r.ip_address,
      userAgent:            r.user_agent,
      privacyPolicyVersion: r.privacy_policy_version,
      grantedAt:            r.granted_at,
      withdrawnAt:          r.withdrawn_at,
    }));
  }

  async withdrawConsent(userId: string, consentType: string): Promise<void> {
    await this.init();

    const updated = await pool.query(
      `UPDATE consent_records
       SET withdrawn_at = NOW(), granted = FALSE
       WHERE user_id = $1
         AND consent_type = $2
         AND withdrawn_at IS NULL
         AND granted = TRUE`,
      [userId, consentType],
    );

    if ((updated.rowCount ?? 0) === 0) {
      Logger.warn('withdrawConsent: no active consent found', {
        userId: '[REDACTED]',
        consentType,
      });
    } else {
      Logger.info('Consent withdrawn', { userId: '[REDACTED]', consentType });
    }
  }

  // ---- Retention Policies --------------------------------------------------

  async checkRetentionPolicies(): Promise<RetentionReport> {
    await this.init();

    const client = await pool.connect();
    const overdueRecords: OverdueRecord[] = [];
    const summary: Record<string, number> = {};

    try {
      // Messages
      const msgOverdue = await client.query<{
        id: string; user_id: string; created_at: Date; retention_days: number; days_overdue: number;
      }>(
        `SELECT m.id, c.user_id, m.created_at,
                drp.retention_days,
                EXTRACT(DAY FROM NOW() - m.created_at)::INTEGER - drp.retention_days AS days_overdue
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
         JOIN data_retention_policies drp ON drp.data_type = 'messages'
         WHERE m.created_at < NOW() - (drp.retention_days || ' days')::INTERVAL
         LIMIT 1000`,
      );
      for (const r of msgOverdue.rows) {
        overdueRecords.push({
          table:         'messages',
          id:            r.id,
          userId:        r.user_id,
          createdAt:     r.created_at,
          retentionDays: r.retention_days,
          daysOverdue:   r.days_overdue,
        });
      }
      summary['messages'] = msgOverdue.rowCount ?? 0;

      // Documents
      const docOverdue = await client.query<{
        id: string; user_id: string; created_at: Date; retention_days: number; days_overdue: number;
      }>(
        `SELECT d.id, d.user_id, d.created_at,
                drp.retention_days,
                EXTRACT(DAY FROM NOW() - d.created_at)::INTEGER - drp.retention_days AS days_overdue
         FROM documents d
         JOIN data_retention_policies drp ON drp.data_type = 'documents'
         WHERE d.created_at < NOW() - (drp.retention_days || ' days')::INTERVAL
           AND d.deleted_at IS NULL
         LIMIT 1000`,
      );
      for (const r of docOverdue.rows) {
        overdueRecords.push({
          table:         'documents',
          id:            r.id,
          userId:        r.user_id,
          createdAt:     r.created_at,
          retentionDays: r.retention_days,
          daysOverdue:   r.days_overdue,
        });
      }
      summary['documents'] = docOverdue.rowCount ?? 0;

      Logger.info('Retention policy check complete', {
        overdueCount: overdueRecords.length,
        tables: Object.keys(summary),
      });

      return { generatedAt: new Date(), overdueRecords, summary };
    } finally {
      client.release();
    }
  }

  // ---- Privacy Report ------------------------------------------------------

  async getPrivacyReport(userId: string): Promise<PrivacyReport> {
    await this.init();

    const client = await pool.connect();
    try {
      // Count records per category
      const counts = await Promise.all([
        client.query<{ count: string }>(
          `SELECT COUNT(*)::TEXT AS count FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_id = $1)`,
          [userId],
        ),
        client.query<{ count: string }>(
          `SELECT COUNT(*)::TEXT AS count FROM chats WHERE user_id = $1`,
          [userId],
        ),
        client.query<{ count: string }>(
          `SELECT COUNT(*)::TEXT AS count FROM agents WHERE user_id = $1`,
          [userId],
        ),
        client.query<{ count: string }>(
          `SELECT COUNT(*)::TEXT AS count FROM documents WHERE user_id = $1`,
          [userId],
        ),
        client.query<{ count: string }>(
          `SELECT COUNT(*)::TEXT AS count FROM audit_log WHERE user_id = $1`,
          [userId],
        ),
      ]);

      const [msgCount, chatCount, agentCount, docCount, auditCount] = counts.map(r =>
        parseInt(r.rows[0]?.count ?? '0', 10),
      );

      // Open GDPR requests
      const openReqResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count FROM gdpr_requests WHERE user_id = $1 AND status IN ('pending','processing')`,
        [userId],
      );
      const openRequests = parseInt(openReqResult.rows[0]?.count ?? '0', 10);

      const dataCategories: DataCategory[] = [
        {
          name:        'Account Information',
          description: 'Basic profile data required to provide the service',
          examples:    ['email address', 'display name', 'account creation date'],
          recordCount: 1,
        },
        {
          name:        'Conversation Data',
          description: 'Chat sessions and messages you have sent',
          examples:    ['chat titles', 'message content', 'timestamps'],
          recordCount: msgCount + chatCount,
        },
        {
          name:        'Agent Configurations',
          description: 'Custom AI agents you have created',
          examples:    ['agent names', 'system prompts', 'tool configurations'],
          recordCount: agentCount,
        },
        {
          name:        'Uploaded Documents',
          description: 'Files you have uploaded for analysis',
          examples:    ['filenames', 'document content', 'file metadata'],
          recordCount: docCount,
        },
        {
          name:        'Activity Logs',
          description: 'Security and audit trail of actions performed on your account',
          examples:    ['login events', 'API calls', 'resource access'],
          recordCount: auditCount,
        },
      ];

      const legalBases: LegalBasis[] = [
        {
          category:    'Account Information',
          basis:       'Contract',
          description: 'Necessary to provide the service you have subscribed to',
        },
        {
          category:    'Conversation Data',
          basis:       'Contract',
          description: 'Required to deliver AI assistance features',
        },
        {
          category:    'Activity Logs',
          basis:       'Legitimate Interest',
          description: 'Security monitoring and fraud prevention',
        },
        {
          category:    'Analytics',
          basis:       'Consent',
          description: 'Service improvement analytics (opt-in)',
        },
        {
          category:    'Marketing',
          basis:       'Consent',
          description: 'Product updates and promotional communications (opt-in)',
        },
      ];

      Logger.info('Privacy report generated', { userId: '[REDACTED]' });

      return {
        userId,
        generatedAt:      new Date(),
        dataCategories,
        legalBases,
        thirdParties:     ['OpenAI (inference)', 'Anthropic (inference)', 'Stripe (billing)'],
        retentionPolicies: RETENTION_POLICIES,
        openRequests,
      };
    } finally {
      client.release();
    }
  }

  // ---- Express Route Handlers ----------------------------------------------

  /**
   * POST /gdpr/access
   * Body: { userId: string }
   * Headers: x-requested-by (requester identity, e.g. admin user ID or 'self')
   */
  handleAccessRequest(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { userId } = req.body as { userId?: string };
        const requestedBy = (req.headers['x-requested-by'] as string)
          ?? (req as any).user?.id
          ?? 'unknown';

        if (!userId) {
          res.status(400).json({ error: 'userId is required' });
          return;
        }

        const accessRequest = await this.requestAccess(userId, requestedBy);

        // Encrypt the export payload
        const plaintext = JSON.stringify(accessRequest.dataExport ?? {});
        const encrypted = encryptPayload(plaintext, userId);

        res.status(200).json({
          requestId:   accessRequest.id,
          status:      accessRequest.status,
          createdAt:   accessRequest.createdAt,
          completedAt: accessRequest.completedAt,
          exportToken: encrypted,  // client decrypts with their key
          message:     'Data export ready. Decrypt the exportToken with your account key.',
        });
      } catch (err) {
        next(err);
      }
    };
  }

  /**
   * POST /gdpr/deletion
   * Body: { userId: string, reason?: string }
   */
  handleDeletionRequest(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { userId, reason } = req.body as { userId?: string; reason?: string };
        const requestedBy = (req.headers['x-requested-by'] as string)
          ?? (req as any).user?.id
          ?? 'unknown';

        if (!userId) {
          res.status(400).json({ error: 'userId is required' });
          return;
        }

        const deletionRequest = await this.requestDeletion(userId, requestedBy, reason);

        res.status(202).json({
          requestId:    deletionRequest.id,
          status:       deletionRequest.status,
          scheduledFor: deletionRequest.scheduledFor,
          message:      `Your deletion request has been received and will be processed on ${deletionRequest.scheduledFor.toISOString()}. You may withdraw this request before that date.`,
        });
      } catch (err) {
        next(err);
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const gdprHandler = GDPRHandler.getInstance();
export default gdprHandler;
