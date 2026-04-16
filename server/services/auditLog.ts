/**
 * Audit Logging Service
 * 
 * Features:
 * - Immutable append-only action logs
 * - User activity tracking
 * - Export for compliance systems
 * - Configurable retention policies
 */

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

export interface AuditEntry {
    id: string;
    timestamp: string;
    userId?: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
    action: AuditAction;
    resource: string;
    resourceId?: string;
    details?: Record<string, any>;
    result: "success" | "failure" | "pending";
    errorMessage?: string;
    durationMs?: number;
    previousHash?: string;
    hash: string;
}

export type AuditAction =
    | "login"
    | "logout"
    | "chat_message"
    | "search_academic"
    | "search_web"
    | "generate_document"
    | "download_artifact"
    | "upload_file"
    | "delete_conversation"
    | "export_data"
    | "settings_change"
    | "api_key_access"
    | "admin_action"
    | "rate_limit_exceeded"
    | "error";

export interface AuditConfig {
    enabled: boolean;
    logDirectory: string;
    maxFileSize: number;      // bytes
    retentionDays: number;
    sensitiveFields: string[];
    hashAlgorithm: string;
}

const DEFAULT_CONFIG: AuditConfig = {
    enabled: true,
    logDirectory: "./logs/audit",
    maxFileSize: 10 * 1024 * 1024, // 10MB
    retentionDays: 90,
    sensitiveFields: ["password", "apiKey", "token", "secret"],
    hashAlgorithm: "sha256",
};

// State
let config = { ...DEFAULT_CONFIG };
let currentLogFile: string | null = null;
let lastHash: string = "GENESIS";
let entryBuffer: AuditEntry[] = [];
const BUFFER_FLUSH_SIZE = 10;
const BUFFER_FLUSH_INTERVAL = 5000; // 5 seconds

// Initialize the audit log system
export async function initAuditLog(customConfig: Partial<AuditConfig> = {}): Promise<void> {
    config = { ...DEFAULT_CONFIG, ...customConfig };

    if (!config.enabled) {
        console.log("[AuditLog] Disabled");
        return;
    }

    // Create log directory
    await fs.mkdir(config.logDirectory, { recursive: true });

    // Initialize log file
    await rotateLogFile();

    // Set up periodic flush
    setInterval(flushBuffer, BUFFER_FLUSH_INTERVAL);

    // Load last hash for chain integrity
    await loadLastHash();

    console.log("[AuditLog] Initialized");
}

// Generate entry hash for chain integrity
function generateHash(entry: Omit<AuditEntry, "hash">): string {
    const data = JSON.stringify({
        ...entry,
        previousHash: lastHash,
    });

    return crypto
        .createHash(config.hashAlgorithm)
        .update(data)
        .digest("hex");
}

// Mask sensitive fields
function maskSensitiveData(details: Record<string, any>): Record<string, any> {
    const masked = { ...details };

    for (const field of config.sensitiveFields) {
        if (masked[field]) {
            masked[field] = "***REDACTED***";
        }
    }

    return masked;
}

// Create audit entry
export function createAuditEntry(
    action: AuditAction,
    resource: string,
    options: {
        userId?: string;
        sessionId?: string;
        ipAddress?: string;
        userAgent?: string;
        resourceId?: string;
        details?: Record<string, any>;
        result?: "success" | "failure" | "pending";
        errorMessage?: string;
        durationMs?: number;
    } = {}
): AuditEntry {
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();

    const entry: Omit<AuditEntry, "hash"> = {
        id,
        timestamp,
        userId: options.userId,
        sessionId: options.sessionId,
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        action,
        resource,
        resourceId: options.resourceId,
        details: options.details ? maskSensitiveData(options.details) : undefined,
        result: options.result || "success",
        errorMessage: options.errorMessage,
        durationMs: options.durationMs,
        previousHash: lastHash,
    };

    const hash = generateHash(entry);
    lastHash = hash;

    return { ...entry, hash };
}

// Log an audit entry
export async function logAudit(
    action: AuditAction,
    resource: string,
    options: Parameters<typeof createAuditEntry>[2] = {}
): Promise<AuditEntry> {
    if (!config.enabled) {
        return createAuditEntry(action, resource, options);
    }

    const entry = createAuditEntry(action, resource, options);
    entryBuffer.push(entry);

    // Flush if buffer is full
    if (entryBuffer.length >= BUFFER_FLUSH_SIZE) {
        await flushBuffer();
    }

    return entry;
}

// Flush buffer to disk
async function flushBuffer(): Promise<void> {
    if (entryBuffer.length === 0 || !currentLogFile) return;

    const entries = [...entryBuffer];
    entryBuffer = [];

    try {
        const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
        await fs.appendFile(currentLogFile, lines, "utf-8");

        // Check file size for rotation
        const stats = await fs.stat(currentLogFile);
        if (stats.size >= config.maxFileSize) {
            await rotateLogFile();
        }
    } catch (error) {
        console.error("[AuditLog] Flush error:", error);
        // Re-add entries to buffer
        entryBuffer = [...entries, ...entryBuffer];
    }
}

// Rotate log file
async function rotateLogFile(): Promise<void> {
    const date = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    currentLogFile = path.join(config.logDirectory, `audit-${date}.jsonl`);

    // Create empty file
    await fs.writeFile(currentLogFile, "", "utf-8");

    console.log(`[AuditLog] Rotated to: ${currentLogFile}`);

    // Clean old logs
    await cleanOldLogs();
}

// Load last hash from most recent log file
async function loadLastHash(): Promise<void> {
    try {
        const files = await fs.readdir(config.logDirectory);
        const logFiles = files
            .filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"))
            .sort()
            .reverse();

        if (logFiles.length === 0) {
            lastHash = "GENESIS";
            return;
        }

        const lastFile = path.join(config.logDirectory, logFiles[0]);
        const content = await fs.readFile(lastFile, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);

        if (lines.length > 0) {
            const lastEntry = JSON.parse(lines[lines.length - 1]) as AuditEntry;
            lastHash = lastEntry.hash;
        }
    } catch (error) {
        console.warn("[AuditLog] Could not load last hash:", error);
        lastHash = "GENESIS";
    }
}

// Clean logs older than retention period
async function cleanOldLogs(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.retentionDays);

    try {
        const files = await fs.readdir(config.logDirectory);

        for (const file of files) {
            if (!file.startsWith("audit-") || !file.endsWith(".jsonl")) continue;

            // Parse date from filename
            const dateStr = file.replace("audit-", "").replace(".jsonl", "");
            const fileDate = new Date(dateStr.replace(/-/g, ":").substring(0, 19));

            if (fileDate < cutoffDate) {
                await fs.unlink(path.join(config.logDirectory, file));
                console.log(`[AuditLog] Deleted old log: ${file}`);
            }
        }
    } catch (error) {
        console.error("[AuditLog] Clean error:", error);
    }
}

// Query audit logs
export async function queryAuditLogs(
    filter: {
        startDate?: Date;
        endDate?: Date;
        userId?: string;
        action?: AuditAction;
        resource?: string;
        result?: "success" | "failure";
    } = {},
    options: {
        limit?: number;
        offset?: number;
    } = {}
): Promise<{ entries: AuditEntry[]; total: number }> {
    const { limit = 100, offset = 0 } = options;
    const entries: AuditEntry[] = [];

    try {
        const files = await fs.readdir(config.logDirectory);
        const logFiles = files
            .filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"))
            .sort()
            .reverse();

        for (const file of logFiles) {
            const content = await fs.readFile(
                path.join(config.logDirectory, file),
                "utf-8"
            );

            for (const line of content.trim().split("\n")) {
                if (!line) continue;

                const entry = JSON.parse(line) as AuditEntry;

                // Apply filters
                if (filter.startDate && new Date(entry.timestamp) < filter.startDate) continue;
                if (filter.endDate && new Date(entry.timestamp) > filter.endDate) continue;
                if (filter.userId && entry.userId !== filter.userId) continue;
                if (filter.action && entry.action !== filter.action) continue;
                if (filter.resource && entry.resource !== filter.resource) continue;
                if (filter.result && entry.result !== filter.result) continue;

                entries.push(entry);
            }
        }
    } catch (error) {
        console.error("[AuditLog] Query error:", error);
    }

    // Sort by timestamp descending
    entries.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return {
        entries: entries.slice(offset, offset + limit),
        total: entries.length,
    };
}

// Verify chain integrity
export async function verifyChainIntegrity(): Promise<{
    valid: boolean;
    lastValidEntry?: string;
    brokenAt?: string;
    message: string;
}> {
    try {
        const files = await fs.readdir(config.logDirectory);
        const logFiles = files
            .filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"))
            .sort();

        let previousHash = "GENESIS";

        for (const file of logFiles) {
            const content = await fs.readFile(
                path.join(config.logDirectory, file),
                "utf-8"
            );

            for (const line of content.trim().split("\n")) {
                if (!line) continue;

                const entry = JSON.parse(line) as AuditEntry;

                // Verify previous hash
                if (entry.previousHash !== previousHash) {
                    return {
                        valid: false,
                        brokenAt: entry.id,
                        message: `Chain broken at entry ${entry.id}: expected ${previousHash}, got ${entry.previousHash}`,
                    };
                }

                // Verify entry hash
                const { hash, ...rest } = entry;
                const computed = generateHash({ ...rest, previousHash });

                if (computed !== hash) {
                    return {
                        valid: false,
                        brokenAt: entry.id,
                        message: `Hash mismatch at entry ${entry.id}`,
                    };
                }

                previousHash = hash;
            }
        }

        return {
            valid: true,
            message: "Audit chain is valid",
        };
    } catch (error) {
        return {
            valid: false,
            message: `Verification error: ${(error as Error).message}`,
        };
    }
}

// Export logs for compliance
export async function exportAuditLogs(
    filter: Parameters<typeof queryAuditLogs>[0] = {},
    format: "json" | "csv" = "json"
): Promise<string> {
    const { entries } = await queryAuditLogs(filter, { limit: 10000 });

    if (format === "json") {
        return JSON.stringify(entries, null, 2);
    }

    // CSV format
    const headers = [
        "id",
        "timestamp",
        "userId",
        "action",
        "resource",
        "result",
        "durationMs",
        "ipAddress",
    ];

    const rows = entries.map((e) =>
        headers.map((h) => {
            const val = (e as any)[h];
            if (val === undefined || val === null) return "";
            if (typeof val === "string" && val.includes(",")) return `"${val}"`;
            return String(val);
        }).join(",")
    );

    return [headers.join(","), ...rows].join("\n");
}

// Shutdown - flush remaining entries
export async function shutdownAuditLog(): Promise<void> {
    await flushBuffer();
    console.log("[AuditLog] Shutdown complete");
}

export default {
    initAuditLog,
    logAudit,
    queryAuditLogs,
    verifyChainIntegrity,
    exportAuditLogs,
    shutdownAuditLog,
};
