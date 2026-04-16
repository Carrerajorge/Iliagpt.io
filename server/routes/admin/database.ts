import { Router } from "express";
import { storage } from "../../storage";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { asyncHandler } from "../../middleware/errorHandler";
import { auditLog, AuditActions } from "../../services/auditLogger";

export const databaseRouter = Router();

// ============================================
// SECURITY HELPERS
// ============================================

/** Maximum SQL query length */
const MAX_QUERY_LENGTH = 10_000;

/** SQL query execution timeout (30 seconds) */
const QUERY_TIMEOUT_MS = 30_000;

/** Tables allowed in backup operations */
const BACKUP_ALLOWED_TABLES = new Set([
    "users", "chats", "ai_models", "payments", "invoices", "settings_config",
    "security_policies", "audit_logs", "sessions",
]);

/** Security: sanitize error message for client response */
function safeDbError(error: unknown): string {
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("not found") || msg.includes("does not exist")) return "Resource not found";
        if (msg.includes("timeout") || msg.includes("timed out")) return "Query timed out";
        if (msg.includes("permission") || msg.includes("denied")) return "Permission denied";
        if (msg.includes("syntax")) return "SQL syntax error";
        if (msg.includes("relation")) return "Table not found";
    }
    return "Database operation failed";
}

/** Security: validate table name - only alphanumeric and underscore, max 64 chars */
function isValidTableName(name: string): boolean {
    if (!name || typeof name !== "string") return false;
    return /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name);
}

databaseRouter.get("/info", async (req, res) => {
    try {
        const userStats = await storage.getUserStats();
        const models = await storage.getAiModels();
        const payments = await storage.getPayments();
        const invoices = await storage.getInvoices();

        res.json({
            tables: {
                users: { count: userStats.total },
                ai_models: { count: models.length },
                payments: { count: payments.length },
                invoices: { count: invoices.length }
            },
            status: "healthy",
            lastBackup: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({ error: safeDbError(error) });
    }
});

databaseRouter.get("/health", async (req, res) => {
    try {
        const startTime = Date.now();
        const result = await db.execute(sql`SELECT 1 as ping, current_timestamp as server_time, pg_database_size(current_database()) as db_size`);
        const latency = Date.now() - startTime;

        const poolStats = await db.execute(sql`
        SELECT 
          numbackends as active_connections,
          xact_commit as transactions_committed,
          xact_rollback as transactions_rolled_back,
          blks_read as blocks_read,
          blks_hit as blocks_hit,
          tup_returned as rows_returned,
          tup_fetched as rows_fetched,
          tup_inserted as rows_inserted,
          tup_updated as rows_updated,
          tup_deleted as rows_deleted,
          pg_size_pretty(pg_database_size(current_database())) as database_size
        FROM pg_stat_database 
        WHERE datname = current_database()
      `);

        const tableStats = await db.execute(sql`
        SELECT 
          schemaname,
          relname as table_name,
          n_live_tup as row_count,
          n_dead_tup as dead_tuples,
          last_vacuum,
          last_autovacuum,
          last_analyze,
          pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))) as table_size
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
        LIMIT 20
      `);

        res.json({
            status: "healthy",
            latencyMs: latency,
            serverTime: result.rows[0]?.server_time,
            pool: poolStats.rows[0] || {},
            tables: tableStats.rows,
            version: await db.execute(sql`SELECT version()`).then(r => r.rows[0]?.version)
        });
    } catch (error: any) {
        res.status(500).json({
            status: "unhealthy",
            error: safeDbError(error),
            latencyMs: null
        });
    }
});

// Minimal, practical attribution/traceability coverage for admin diagnostics.
databaseRouter.get("/coverage", async (req, res) => {
    try {
        const startTime = Date.now();

        const existence = await db.execute(sql`
          SELECT
            to_regclass('public.sessions') IS NOT NULL AS has_sessions,
            EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='sessions' AND column_name='user_id'
            ) AS has_sessions_user_id,

            to_regclass('public.conversation_states') IS NOT NULL AS has_conversation_states,
            to_regclass('public.chats') IS NOT NULL AS has_chats,

            to_regclass('public.login_attempts') IS NOT NULL AS has_login_attempts,
            to_regclass('public.audit_logs') IS NOT NULL AS has_audit_logs,
            to_regclass('public.agent_gap_logs') IS NOT NULL AS has_agent_gap_logs,
            to_regclass('public.tool_call_logs') IS NOT NULL AS has_tool_call_logs
        `);

        const has = (existence.rows?.[0] || {}) as any;
        const toBool = (v: any) => v === true || v === "t" || v === "true" || v === 1 || v === "1";
        const hasSessions = toBool(has.has_sessions);
        const hasSessionsUserId = toBool(has.has_sessions_user_id);
        const hasConversationStates = toBool(has.has_conversation_states);
        const hasChats = toBool(has.has_chats);
        const hasLoginAttempts = toBool(has.has_login_attempts);
        const hasAuditLogs = toBool(has.has_audit_logs);
        const hasAgentGapLogs = toBool(has.has_agent_gap_logs);
        const hasToolCallLogs = toBool(has.has_tool_call_logs);

        const toInt = (value: any) => {
            const n = typeof value === "number" ? value : parseInt(String(value || "0"), 10);
            return Number.isFinite(n) ? n : 0;
        };

        const sessions = {
            active: 0,
            attributed: 0,
            anonymous: 0,
            missingUserId: 0,
            attributionRate: null as number | null,
            ready: hasSessions && hasSessionsUserId,
        };

        if (hasSessions) {
            if (hasSessionsUserId) {
                const s = await db.execute(sql`
                  SELECT
                    COUNT(*) FILTER (WHERE expire > NOW()) AS active,
                    COUNT(*) FILTER (WHERE expire > NOW() AND user_id IS NOT NULL) AS attributed,
                    COUNT(*) FILTER (WHERE expire > NOW() AND user_id LIKE 'anon_%') AS anonymous,
                    COUNT(*) FILTER (WHERE expire > NOW() AND user_id IS NULL) AS missing_user_id
                  FROM sessions
                `);
                const row = (s.rows?.[0] || {}) as any;
                sessions.active = toInt(row.active);
                sessions.attributed = toInt(row.attributed);
                sessions.anonymous = toInt(row.anonymous);
                sessions.missingUserId = toInt(row.missing_user_id);
                sessions.attributionRate = sessions.active > 0 ? sessions.attributed / sessions.active : 1;
            } else {
                const s = await db.execute(sql`
                  SELECT COUNT(*) AS active
                  FROM sessions
                  WHERE expire > NOW()
                `);
                sessions.active = toInt((s.rows?.[0] as any)?.active);
            }
        }

        const conversationStates = {
            missingUserId: 0,
            ready: hasConversationStates && hasChats,
        };

        if (hasConversationStates && hasChats) {
            const q = await db.execute(sql`
              SELECT COUNT(*) AS missing
              FROM conversation_states cs
              JOIN chats c ON c.id = cs.chat_id
              WHERE cs.user_id IS NULL AND c.user_id IS NOT NULL
            `);
            conversationStates.missingUserId = toInt((q.rows?.[0] as any)?.missing);
        }

        const loginAttempts = {
            last24hTotal: 0,
            last24hSuccess: 0,
            last24hFailure: 0,
            ready: hasLoginAttempts,
        };

        if (hasLoginAttempts) {
            const q = await db.execute(sql`
              SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE success = true) AS success,
                COUNT(*) FILTER (WHERE success = false) AS failure
              FROM login_attempts
              WHERE created_at > NOW() - INTERVAL '24 hours'
            `);
            const row = (q.rows?.[0] || {}) as any;
            loginAttempts.last24hTotal = toInt(row.total);
            loginAttempts.last24hSuccess = toInt(row.success);
            loginAttempts.last24hFailure = toInt(row.failure);
        }

        const auditLogs = {
            last24hTotal: 0,
            last24hMissingUserId: 0,
            ready: hasAuditLogs,
        };

        if (hasAuditLogs) {
            const q = await db.execute(sql`
              SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE user_id IS NULL) AS missing_user_id
              FROM audit_logs
              WHERE created_at > NOW() - INTERVAL '24 hours'
            `);
            const row = (q.rows?.[0] || {}) as any;
            auditLogs.last24hTotal = toInt(row.total);
            auditLogs.last24hMissingUserId = toInt(row.missing_user_id);
        }

        const agentGaps = {
            open: 0,
            resolved: 0,
            missingUserId: 0,
            ready: hasAgentGapLogs,
        };

        if (hasAgentGapLogs) {
            const q = await db.execute(sql`
              SELECT
                COUNT(*) FILTER (WHERE status = 'open') AS open,
                COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
                COUNT(*) FILTER (WHERE user_id IS NULL) AS missing_user_id
              FROM agent_gap_logs
            `);
            const row = (q.rows?.[0] || {}) as any;
            agentGaps.open = toInt(row.open);
            agentGaps.resolved = toInt(row.resolved);
            agentGaps.missingUserId = toInt(row.missing_user_id);
        }

        const toolCalls = {
            last24hTotal: 0,
            last24hMissingUserId: 0,
            ready: hasToolCallLogs,
        };

        if (hasToolCallLogs) {
            const q = await db.execute(sql`
              SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE user_id IS NULL) AS missing_user_id
              FROM tool_call_logs
              WHERE created_at > NOW() - INTERVAL '24 hours'
            `);
            const row = (q.rows?.[0] || {}) as any;
            toolCalls.last24hTotal = toInt(row.total);
            toolCalls.last24hMissingUserId = toInt(row.missing_user_id);
        }

        const executionTimeMs = Date.now() - startTime;

        res.json({
            status: "ok",
            executionTimeMs,
            timestamp: new Date().toISOString(),
            sessions,
            conversationStates,
            loginAttempts,
            auditLogs,
            agentGaps,
            toolCalls,
        });
    } catch (error: any) {
        res.status(500).json({ status: "error", error: safeDbError(error) });
    }
});

// Database status endpoint for production monitoring
// Merged logic from multiple checkpoints
databaseRouter.get("/status", async (req, res) => {
    try {
        // Get database connection info
        const dbInfoResult = await db.execute(sql`
        SELECT 
          current_database() as database_name,
          inet_server_addr() as host,
          inet_server_port() as port,
          current_user as db_user,
          version() as pg_version,
          current_timestamp as server_time
      `);

        const dbInfo = dbInfoResult.rows[0] as Record<string, any>;

        // Get user count and latest user created
        const userStats = await db.execute(sql`
        SELECT 
          COUNT(*) as total_users,
          MAX(created_at) as latest_user_created
        FROM users
      `);

        // Get enabled AI models count
        const modelStats = await db.execute(sql`
        SELECT COUNT(*) as enabled_models
        FROM ai_models
        WHERE is_enabled = 'true'
      `);

        // Get sessions count (if needed for diagnostics)
        const sessionStatsResult = await db.execute(sql`
        SELECT COUNT(*) as session_count
        FROM sessions
        WHERE expire > NOW()
      `);

        res.json({
            status: "connected",
            database: {
                name: dbInfo?.database_name || "unknown",
                host: dbInfo?.host || process.env.PGHOST || "unknown",
                port: dbInfo?.port,
                user: dbInfo?.db_user,
                version: dbInfo?.pg_version?.split(" ")[0] + " " + (dbInfo?.pg_version?.split(" ")[1] || ""),
            },
            serverTime: dbInfo?.server_time,
            users: {
                total: parseInt((userStats.rows[0] as any)?.total_users || "0"),
                latestCreatedAt: (userStats.rows[0] as any)?.latest_user_created
            },
            models: {
                enabled: parseInt((modelStats.rows[0] as any)?.enabled_models || "0")
            },
            sessions: {
                activeCount: parseInt((sessionStatsResult.rows[0] as any)?.session_count || "0")
            },
            environment: process.env.NODE_ENV || "development"
        });
    } catch (error: any) {
        console.error("[AdminRouter] db-status error:", error.message);
        res.status(500).json({
            status: "error",
            error: safeDbError(error),
            database: null,
            host: null
        });
    }
});


databaseRouter.get("/tables", async (req, res) => {
    try {
        const tables = await db.execute(sql`
        SELECT 
          t.table_name,
          t.table_type,
          pg_size_pretty(pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))) as size,
          (SELECT count(*) FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.table_schema = t.table_schema) as column_count,
          COALESCE(s.n_live_tup, 0) as row_count
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s ON t.table_name = s.relname
        WHERE t.table_schema = 'public'
        ORDER BY t.table_name
      `);

        res.json({ tables: tables.rows });
    } catch (error: any) {
        res.status(500).json({ error: safeDbError(error) });
    }
});

databaseRouter.get("/tables/:tableName", async (req, res) => {
    try {
        const { tableName } = req.params;
        const { page = "1", limit = "50" } = req.query;

        // Fix: Validate parseInt results to prevent NaN issues
        const pageNum = Math.max(1, parseInt(page as string) || 1);
        const limitNum = Math.max(1, Math.min(parseInt(limit as string) || 50, 100));
        const offset = (pageNum - 1) * limitNum;

        // Sanitize table name first - only allow alphanumeric and underscore
        const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        if (safeTableName !== tableName || !safeTableName) {
            return res.status(400).json({ error: "Invalid table name" });
        }

        // Validate table exists in public schema using parameterized query
        const tableCheck = await db.execute(sql`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = ${safeTableName}
      `);
        if (tableCheck.rows.length === 0) {
            return res.status(404).json({ error: "Table not found" });
        }

        // Get columns info using parameterized query
        const columns = await db.execute(sql`
        SELECT 
          column_name, 
          data_type, 
          is_nullable, 
          column_default,
          character_maximum_length
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = ${safeTableName}
        ORDER BY ordinal_position
      `);

        // Get row count using sanitized table name
        const countResult = await db.execute(sql`SELECT COUNT(*) as total FROM ${sql.raw(safeTableName)}`);
        const total = parseInt((countResult.rows[0] as any)?.total || "0");

        // Get data with pagination using parameterized queries for LIMIT and OFFSET
        const data = await db.execute(sql`SELECT * FROM ${sql.raw(safeTableName)} LIMIT ${limitNum} OFFSET ${offset}`);

        res.json({
            table: tableName,
            columns: columns.rows,
            data: data.rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: safeDbError(error) });
    }
});

databaseRouter.post("/query", async (req, res) => {
    try {
        const { query } = req.body;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: "Query is required" });
        }

        // Security: Limit query length to prevent DoS
        if (query.length > MAX_QUERY_LENGTH) {
            return res.status(400).json({ error: `Query too long. Maximum ${MAX_QUERY_LENGTH} characters allowed.` });
        }

        // Security: Only allow SELECT statements (including CTEs with WITH...SELECT)
        const trimmedQuery = query.trim().toUpperCase();
        const isSelect = trimmedQuery.startsWith('SELECT');
        const isCteSelect = trimmedQuery.startsWith('WITH') && /\bSELECT\b/.test(trimmedQuery) && !/\b(INSERT|UPDATE|DELETE)\b/.test(trimmedQuery);
        if (!isSelect && !isCteSelect) {
            return res.status(403).json({
                error: "Only SELECT queries are allowed for security reasons",
                hint: "Use the Replit Database panel for write operations"
            });
        }

        // SECURITY FIX #36: Enhanced dangerous patterns list for SQL injection prevention
        const dangerousPatterns = [
            /--/,  // Block SQL single-line comments (check early - bypass vector)
            /\/\*/,  // Block block comments (check early - bypass vector)
            /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)/i,
            /^\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/im,  // Block DML/DDL at start of any line
            /INTO\s+OUTFILE/i,
            /LOAD_FILE/i,
            /pg_sleep/i,
            /pg_terminate/i,
            /pg_cancel_backend/i,
            /COPY\s+(TO|FROM)/i,
            /pg_read_file/i,
            /pg_read_binary_file/i,
            /pg_ls_dir/i,
            /lo_import/i,
            /lo_export/i,
            /lo_get/i,
            /UNION\s+(ALL\s+)?SELECT/i,  // Block UNION injections
            /;.*SELECT/i,  // Block statement chaining
            /\bEXEC(UTE)?\b/i,  // Block EXECUTE
            /\bxp_/i,  // Block extended procedures
            /\bSET\s+(ROLE|SESSION)/i,  // Block role escalation
            /\bpg_shadow\b/i,  // Block access to password hashes
            /\bpg_authid\b/i,  // Block access to auth data
            /pg_stat_file/i,
            /current_setting\s*\(/i,
            /set_config\s*\(/i,
            /dblink/i,
            /pg_execute_server_program/i,
            // Block comment-based bypass attempts
            /\/\*[\s\S]*?(DROP|DELETE|UPDATE|INSERT)/i,
            /--.*?(DROP|DELETE|UPDATE|INSERT)/i,
        ];
        for (const pattern of dangerousPatterns) {
            if (pattern.test(query)) {
                return res.status(403).json({ error: "Query contains forbidden patterns" });
            }
        }

        // Whitelist: Only allow queries against specific tables
        // Note: Admin-only route, but still validate to reduce blast-radius of mistakes.
        const allowedTables = [
            // Core identity
            "users",
            "sessions",
            "auth_tokens",
            "login_attempts",

            // Chat + memory
            "chats",
            "chat_messages",
            "chat_runs",
            "chat_shares",
            "chat_participants",
            "conversation_states",
            "conversation_state_versions",
            "conversation_messages",
            "conversation_contexts",
            "conversation_images",
            "conversation_artifacts",
            "processed_requests",

            // Library + files
            "library_storage",
            "library_items",
            "library_files",
            "library_folders",
            "library_collections",
            "library_file_collections",

            // Spreadsheet analyzer
            "spreadsheet_uploads",
            "spreadsheet_sheets",
            "spreadsheet_analysis_sessions",
            "spreadsheet_analysis_jobs",
            "spreadsheet_analysis_outputs",
            "chat_message_analysis",

            // Sharing
            "shared_links",

            // Admin / security / observability
            "audit_logs",
            "provider_metrics",
            "kpi_snapshots",
            "security_policies",
            "platform_settings",
            "analytics_snapshots",
            "api_logs",
            "tool_call_logs",

            // Billing (if enabled)
            "payments",
            "invoices",

            // Workspace / org
            "workspaces",
            "workspace_invitations",
            "org_settings",
        ];

        // Extract table names from FROM/JOIN clauses (basic safeguard; not a full SQL parser).
        // Supports: table, schema.table, "table", "schema"."table"
        const tablePattern = /\b(?:FROM|JOIN)\s+(?:\"?(\w+)\"?\.)?\"?(\w+)\"?/gi;
        const matches = [...query.matchAll(tablePattern)];
        for (const match of matches) {
            const schemaName = (match[1] || "").toLowerCase();
            const tableName = (match[2] || "").toLowerCase();

            const isSystemSchema = schemaName === "pg_catalog" || schemaName === "information_schema";
            const isSystemTable = isSystemSchema || tableName.startsWith("pg_");

            if (!allowedTables.includes(tableName) && !isSystemTable) {
                // Allow system views for introspection (even when schema is omitted)
                if (!["pg_stat_database", "pg_stat_user_tables", "pg_indexes", "pg_stat_statements"].includes(tableName)) {
                    return res.status(403).json({
                        error: `Table '${tableName}' is not in the allowed list`,
                        allowedTables: allowedTables
                    });
                }
            }
        }

        const startTime = Date.now();
        // SECURITY: Use prepared statement wrapper with query sanitization
        // Note: For admin query explorer, we use sql.raw() but with extensive validation above
        // Security: add query timeout to prevent long-running queries
        const queryPromise = db.execute(sql`${sql.raw(query)}`);
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Query timed out")), QUERY_TIMEOUT_MS);
        });
        const result = await Promise.race([queryPromise, timeoutPromise]);
        const executionTime = Date.now() - startTime;

        await auditLog(req, {
            action: AuditActions.DB_QUERY_EXECUTED,
            resource: "database",
            details: {
                query: query.substring(0, 500),
                rowsReturned: result.rows.length,
                executionTimeMs: executionTime,
                executedBy: (req as any).user?.email
            },
            category: "data",
            severity: "warning"
        });

        res.json({
            success: true,
            data: result.rows.slice(0, 1000), // Limit results
            rowCount: result.rows.length,
            executionTimeMs: executionTime,
            columns: result.rows.length > 0 ? Object.keys(result.rows[0]) : []
        });
    } catch (error: any) {
        // Security: never expose internal error details
        res.status(500).json({
            success: false,
            error: safeDbError(error),
            hint: "Check your SQL syntax"
        });
    }
});

databaseRouter.get("/slow-queries", async (req, res) => {
    try {
        const slowQueries = await db.execute(sql`
        SELECT 
          query,
          calls,
          mean_exec_time as avg_time_ms,
          total_exec_time as total_time_ms,
          rows,
          shared_blks_hit,
          shared_blks_read
        FROM pg_stat_statements
        ORDER BY mean_exec_time DESC
        LIMIT 20
      `);
        res.json({ queries: slowQueries.rows });
    } catch (error: any) {
        // pg_stat_statements might not be enabled
        res.json({
            queries: [],
            note: "pg_stat_statements extension may not be enabled"
        });
    }
});

databaseRouter.get("/indexes", async (req, res) => {
    try {
        const indexes = await db.execute(sql`
        SELECT 
          schemaname,
          tablename,
          indexname,
          indexdef,
          pg_size_pretty(pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(indexname))) as index_size
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname
      `);
        res.json({ indexes: indexes.rows });
    } catch (error: any) {
        res.status(500).json({ error: safeDbError(error) });
    }
});

// POST /api/admin/database/backup - Initiate a database backup
databaseRouter.post("/backup", asyncHandler(async (req, res) => {
    const { type = "full", tables } = req.body;

    // For now, we'll export data as JSON since pg_dump requires shell access
    const backupData: Record<string, any[]> = {};
    const defaultTables = ["users", "chats", "ai_models", "payments", "invoices", "settings_config"];

    // Security: validate requested tables against allowlist
    let tablesToBackup: string[];
    if (Array.isArray(tables)) {
        tablesToBackup = tables
            .filter((t: unknown) => typeof t === "string" && isValidTableName(t) && BACKUP_ALLOWED_TABLES.has(t))
            .slice(0, 20); // Cap number of tables
        if (tablesToBackup.length === 0) {
            tablesToBackup = defaultTables;
        }
    } else {
        tablesToBackup = defaultTables;
    }

    for (const tableName of tablesToBackup) {
        try {
            const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
            if (!safeTableName || safeTableName !== tableName) continue;
            const result = await db.execute(sql`SELECT * FROM ${sql.raw(safeTableName)}`);
            backupData[tableName] = result.rows as any[];
        } catch (err: any) {
            backupData[tableName] = [];
        }
    }

    const backupMeta = {
        timestamp: new Date().toISOString(),
        type,
        tables: Object.keys(backupData),
        rowCounts: Object.fromEntries(
            Object.entries(backupData).map(([k, v]) => [k, v.length])
        ),
        version: "1.0"
    };

    await storage.createAuditLog({
        action: "database_backup",
        resource: "database",
        details: { type, tables: tablesToBackup, rowCounts: backupMeta.rowCounts }
    });

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=backup_${Date.now()}.json`);
    res.json({ meta: backupMeta, data: backupData });
}));

// GET /api/admin/database/backups - List available backups (if stored)
databaseRouter.get("/backups", async (req, res) => {
    try {
        // Check generated_reports folder for backup files
        const fs = require("fs").promises;
        const path = require("path");
        const backupsDir = path.join(process.cwd(), "backups");
        
        try {
            const files = await fs.readdir(backupsDir);
            const backups = files
                .filter((f: string) => f.endsWith(".json") && f.startsWith("backup_"))
                .map((f: string) => ({
                    filename: f,
                    timestamp: parseInt(f.replace("backup_", "").replace(".json", "")),
                    path: `/api/admin/database/backups/${f}`
                }))
                .sort((a: any, b: any) => b.timestamp - a.timestamp);
            
            res.json({ backups });
        } catch (err) {
            // Directory doesn't exist
            res.json({ backups: [], note: "No backups found" });
        }
    } catch (error: any) {
        res.status(500).json({ error: safeDbError(error) });
    }
});

// POST /api/admin/database/vacuum - Run VACUUM ANALYZE
databaseRouter.post("/vacuum", asyncHandler(async (req, res) => {
    const { table } = req.body;

    if (table) {
        // Security: validate table name format
        if (typeof table !== "string" || !isValidTableName(table)) {
            return res.status(400).json({ error: "Invalid table name" });
        }
        const safeTableName = table.replace(/[^a-zA-Z0-9_]/g, '');
        if (safeTableName !== table) {
            return res.status(400).json({ error: "Invalid table name" });
        }
        await db.execute(sql`VACUUM ANALYZE ${sql.raw(safeTableName)}`);
    } else {
        await db.execute(sql`VACUUM ANALYZE`);
    }

    await storage.createAuditLog({
        action: "database_vacuum",
        resource: "database",
        details: { table: table || "all" }
    });

    res.json({ success: true, message: table ? `VACUUM ANALYZE completed for ${table}` : "VACUUM ANALYZE completed for all tables" });
}));

// GET /api/admin/database/connections - Get active database connections
databaseRouter.get("/connections", async (req, res) => {
    try {
        const connections = await db.execute(sql`
            SELECT 
                pid,
                usename as username,
                application_name,
                client_addr as client_ip,
                state,
                query_start,
                state_change,
                wait_event_type,
                wait_event,
                LEFT(query, 100) as current_query
            FROM pg_stat_activity
            WHERE datname = current_database()
            ORDER BY query_start DESC NULLS LAST
            LIMIT 50
        `);

        const summary = await db.execute(sql`
            SELECT 
                state,
                COUNT(*) as count
            FROM pg_stat_activity
            WHERE datname = current_database()
            GROUP BY state
        `);

        res.json({
            connections: connections.rows,
            summary: summary.rows,
            maxConnections: await db.execute(sql`SHOW max_connections`).then(r => r.rows[0])
        });
    } catch (error: any) {
        res.status(500).json({ error: safeDbError(error) });
    }
});
