import "../config/load-env";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { Logger } from "../lib/logger";

export async function applyRobustEnhancements() {
    Logger.info("[DB Enhancements] Starting application of robust database features...");

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // ========================================================================
        // 1. Database-Level Audit Triggers
        // ========================================================================
        Logger.info("[DB Enhancements] Applying Audit Triggers...");

        // Create generic audit function
        await client.query(`
      CREATE OR REPLACE FUNCTION audit_trigger_func() RETURNS TRIGGER AS $$
      DECLARE
        old_val json;
        new_val json;
      BEGIN
        IF (TG_OP = 'DELETE') THEN
          old_val = row_to_json(OLD);
          new_val = null;
        ELSIF (TG_OP = 'UPDATE') THEN
          old_val = row_to_json(OLD);
          new_val = row_to_json(NEW);
        ELSIF (TG_OP = 'INSERT') THEN
          old_val = null;
          new_val = row_to_json(NEW);
        END IF;

        INSERT INTO admin_audit_logs (
          id, admin_id, action, target_type, target_id, details, created_at
        ) VALUES (
          gen_random_uuid(),
          COALESCE(current_setting('app.current_user_id', true), '00000000-0000-0000-0000-000000000000'), -- System or set by app
          'db.' || lower(TG_OP),
          TG_TABLE_NAME,
          COALESCE(NEW.id, OLD.id),
          json_build_object('old', old_val, 'new', new_val),
          NOW()
        );
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

        // Apply to critical tables (idempotent: drop if exists first)
        const tablesToAudit = ['users', 'payments', 'security_policies', 'platform_settings'];
        for (const table of tablesToAudit) {
            await client.query(`DROP TRIGGER IF EXISTS audit_${table}_trigger ON ${table}`);
            await client.query(`
        CREATE TRIGGER audit_${table}_trigger
        AFTER INSERT OR UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
      `);
        }

        // ========================================================================
        // 2. Materialized Views for Analytics
        // ========================================================================
        Logger.info("[DB Enhancements] Creating Materialized Views...");

        // User Activity Stats
        await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_user_activity_stats AS
      SELECT
        u.id as user_id,
        u.username,
        u.email,
        COUNT(cm.id) as total_messages,
        COALESCE(SUM(cr.last_seq), 0) as total_interactions,
        MAX(cm.created_at) as last_active_at
      FROM users u
      LEFT JOIN chats c ON c.user_id = u.id
      LEFT JOIN chat_messages cm ON cm.chat_id = c.id AND cm.role = 'user'
      LEFT JOIN chat_runs cr ON cr.chat_id = c.id
      GROUP BY u.id, u.username, u.email;
    `);

        // Create index on MV
        await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_user_activity_stats_id ON mv_user_activity_stats(user_id);
    `);

        // ========================================================================
        // 3. Specialized Indexes
        // ========================================================================
        Logger.info("[DB Enhancements] Applying Specialized Indexes...");

        // Partial Index for Offline Queue (Hot Pending Items)
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_offline_queue_pending 
      ON offline_message_queue(created_at) 
      WHERE status = 'pending';
    `);

        // BRIN Index for Audit Logs (Time-series optimization)
        // Note: BRIN is effective for very large tables (>100MB) correlating with physical order
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_brin_created_at 
      ON audit_logs USING BRIN(created_at);
    `);

        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_brin_created_at 
      ON chat_messages USING BRIN(created_at);
    `);

        await client.query('COMMIT');
        Logger.info("[DB Enhancements] Successfully applied all enhancements.");
        return true;

    } catch (error: any) {
        await client.query('ROLLBACK');
        Logger.error("[DB Enhancements] Failed to apply enhancements:", error.message);
        throw error;
    } finally {
        client.release();
    }
}

// Allow direct execution if run as script
import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    applyRobustEnhancements()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}
