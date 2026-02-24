/**
 * Privacy & Security Service
 *
 * - PII detection & redaction
 * - Encryption at rest helpers
 * - Audit logging
 * - Opt-in consent tracking
 */

import crypto from "crypto";
import { db } from "../../db";
import { ragAuditLog, ragKvStore, type InsertRagAuditLog } from "@shared/schema/rag";
import { eq, and, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// PII Detection Patterns
// ---------------------------------------------------------------------------

interface PIIMatch {
    type: string;
    value: string;
    start: number;
    end: number;
}

const PII_PATTERNS: Array<{ type: string; pattern: RegExp; replacement: string }> = [
    // Email
    { type: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: "[EMAIL_REDACTED]" },
    // Phone numbers (international)
    { type: "phone", pattern: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g, replacement: "[PHONE_REDACTED]" },
    // Credit card numbers
    { type: "credit_card", pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: "[CC_REDACTED]" },
    // SSN / DNI / CUIT (Argentina)
    { type: "national_id", pattern: /\b\d{2}[-.]?\d{6,8}[-.]?\d{1,2}\b/g, replacement: "[ID_REDACTED]" },
    // IP addresses
    { type: "ip_address", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "[IP_REDACTED]" },
    // Dates of birth patterns
    { type: "dob", pattern: /\b(?:nacido|born|fecha de nacimiento|dob|date of birth)\s*:?\s*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/gi, replacement: "[DOB_REDACTED]" },
    // Passport numbers
    { type: "passport", pattern: /\b(?:pasaporte|passport)\s*:?\s*[A-Z0-9]{6,9}\b/gi, replacement: "[PASSPORT_REDACTED]" },
    // Bank account patterns (IBAN-like)
    { type: "bank_account", pattern: /\b[A-Z]{2}\d{2}\s?(?:\d{4}\s?){4,7}\d{1,4}\b/g, replacement: "[BANK_REDACTED]" },
];

// ---------------------------------------------------------------------------
// PII Detection
// ---------------------------------------------------------------------------

export function detectPII(text: string): PIIMatch[] {
    const matches: PIIMatch[] = [];

    for (const { type, pattern } of PII_PATTERNS) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = regex.exec(text)) !== null) {
            matches.push({
                type,
                value: match[0],
                start: match.index,
                end: match.index + match[0].length,
            });
        }
    }

    return matches;
}

// ---------------------------------------------------------------------------
// PII Redaction
// ---------------------------------------------------------------------------

export function redactPII(text: string): { redacted: string; piiTypes: string[]; piiCount: number } {
    let redacted = text;
    const piiTypes = new Set<string>();
    let piiCount = 0;

    for (const { type, pattern, replacement } of PII_PATTERNS) {
        const regex = new RegExp(pattern.source, pattern.flags);
        const matchCount = (text.match(regex) || []).length;
        if (matchCount > 0) {
            piiTypes.add(type);
            piiCount += matchCount;
            redacted = redacted.replace(regex, replacement);
        }
    }

    return { redacted, piiTypes: Array.from(piiTypes), piiCount };
}

// ---------------------------------------------------------------------------
// Encryption at rest (AES-256-GCM)
// ---------------------------------------------------------------------------

const ENCRYPTION_KEY = process.env.RAG_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY;
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export function encrypt(plaintext: string): string {
    if (!ENCRYPTION_KEY) return plaintext;

    const key = crypto.scryptSync(ENCRYPTION_KEY, "rag-salt", 32);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();

    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
    if (!ENCRYPTION_KEY) return ciphertext;
    if (!ciphertext.includes(":")) return ciphertext; // not encrypted

    const parts = ciphertext.split(":");
    if (parts.length !== 3) return ciphertext;

    const [ivHex, tagHex, encrypted] = parts;
    const key = crypto.scryptSync(ENCRYPTION_KEY, "rag-salt", 32);
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
}

// ---------------------------------------------------------------------------
// Audit Logging
// ---------------------------------------------------------------------------

export async function audit(entry: {
    tenantId: string;
    userId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    piiDetected?: boolean;
    piiTypes?: string[];
    ipAddress?: string;
    userAgent?: string;
    durationMs?: number;
    success?: boolean;
    errorMessage?: string;
}): Promise<void> {
    try {
        await db.insert(ragAuditLog).values({
            tenantId: entry.tenantId,
            userId: entry.userId,
            action: entry.action,
            resourceType: entry.resourceType,
            resourceId: entry.resourceId,
            details: entry.details ?? {},
            piiDetected: entry.piiDetected ?? false,
            piiTypes: entry.piiTypes ?? [],
            ipAddress: entry.ipAddress,
            userAgent: entry.userAgent,
            durationMs: entry.durationMs,
            success: entry.success ?? true,
            errorMessage: entry.errorMessage,
        });
    } catch (error) {
        console.error("[PrivacyService] Audit log error:", error);
    }
}

// ---------------------------------------------------------------------------
// Consent / Opt-in tracking (via KV store)
// ---------------------------------------------------------------------------

const CONSENT_NAMESPACE = "privacy_consent";

export async function hasConsent(
    tenantId: string,
    userId: string,
    feature: string,
): Promise<boolean> {
    const rows = await db
        .select({ value: ragKvStore.value })
        .from(ragKvStore)
        .where(
            and(
                eq(ragKvStore.tenantId, tenantId),
                eq(ragKvStore.userId, userId),
                eq(ragKvStore.namespace, CONSENT_NAMESPACE),
                eq(ragKvStore.key, feature),
            ),
        )
        .limit(1);

    if (rows.length === 0) return false;
    return (rows[0].value as any)?.granted === true;
}

export async function grantConsent(
    tenantId: string,
    userId: string,
    feature: string,
): Promise<void> {
    const existing = await db
        .select({ id: ragKvStore.id })
        .from(ragKvStore)
        .where(
            and(
                eq(ragKvStore.tenantId, tenantId),
                eq(ragKvStore.userId, userId),
                eq(ragKvStore.namespace, CONSENT_NAMESPACE),
                eq(ragKvStore.key, feature),
            ),
        )
        .limit(1);

    const value = { granted: true, grantedAt: new Date().toISOString() };

    if (existing.length > 0) {
        await db
            .update(ragKvStore)
            .set({ value, updatedAt: new Date() })
            .where(eq(ragKvStore.id, existing[0].id));
    } else {
        await db.insert(ragKvStore).values({
            tenantId,
            userId,
            namespace: CONSENT_NAMESPACE,
            key: feature,
            value,
            version: 1,
        });
    }

    await audit({
        tenantId,
        userId,
        action: "consent_grant",
        resourceType: "consent",
        resourceId: feature,
        details: { feature },
    });
}

export async function revokeConsent(
    tenantId: string,
    userId: string,
    feature: string,
): Promise<void> {
    await db
        .delete(ragKvStore)
        .where(
            and(
                eq(ragKvStore.tenantId, tenantId),
                eq(ragKvStore.userId, userId),
                eq(ragKvStore.namespace, CONSENT_NAMESPACE),
                eq(ragKvStore.key, feature),
            ),
        );

    await audit({
        tenantId,
        userId,
        action: "consent_revoke",
        resourceType: "consent",
        resourceId: feature,
        details: { feature },
    });
}

// ---------------------------------------------------------------------------
// Data deletion (right to be forgotten)
// ---------------------------------------------------------------------------

export async function deleteUserData(
    tenantId: string,
    userId: string,
): Promise<{ chunksDeleted: number; memoriesDeleted: number; kvDeleted: number }> {
    const [chunks, memories, kv] = await Promise.all([
        db.execute(sql`DELETE FROM rag_chunks WHERE tenant_id = ${tenantId} AND user_id = ${userId}`),
        db.execute(sql`DELETE FROM user_memories WHERE tenant_id = ${tenantId} AND user_id = ${userId}`),
        db.execute(sql`DELETE FROM rag_kv_store WHERE tenant_id = ${tenantId} AND user_id = ${userId}`),
    ]);

    await audit({
        tenantId,
        userId,
        action: "data_deletion",
        resourceType: "user_data",
        details: { reason: "right_to_be_forgotten" },
    });

    return {
        chunksDeleted: (chunks as any).rowCount ?? 0,
        memoriesDeleted: (memories as any).rowCount ?? 0,
        kvDeleted: (kv as any).rowCount ?? 0,
    };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const privacyService = {
    detectPII,
    redactPII,
    encrypt,
    decrypt,
    audit,
    hasConsent,
    grantConsent,
    revokeConsent,
    deleteUserData,
};
