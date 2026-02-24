import { pool } from "../db";
import { Logger } from "./logger";

export async function setupFts() {
    const client = await pool.connect();
    try {
        Logger.info("[FTS] Starting Full-Text Search setup...");

        // 1. Add column if not exists (Drizzle might have added it via push, but ensure it)
        await client.query(`
      ALTER TABLE chat_messages 
      ADD COLUMN IF NOT EXISTS search_vector tsvector;
    `);

        // 2. Create GIN index if not exists
        await client.query(`
      CREATE INDEX IF NOT EXISTS chat_messages_search_idx 
      ON chat_messages 
      USING GIN (search_vector);
    `);

        // 3. Create function to update vector
        await client.query(`
      CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector := to_tsvector('spanish', coalesce(NEW.content, ''));
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
    `);

        // 4. Create Trigger
        // Drop first to ensure we don't duplicate or fail if exists with different def
        await client.query(`
      DROP TRIGGER IF EXISTS messages_search_vector_update ON chat_messages;
      CREATE TRIGGER messages_search_vector_update
      BEFORE INSERT OR UPDATE ON chat_messages
      FOR EACH ROW
      EXECUTE PROCEDURE messages_search_vector_update();
    `);

        // 5. Backfill (Only where null)
        // We check if there are any nulls first to avoid unnecessary updates/logs
        const { rows } = await client.query('SELECT COUNT(*) as count FROM chat_messages WHERE search_vector IS NULL');
        const count = parseInt(rows[0].count, 10);

        if (count > 0) {
            Logger.info(`[FTS] Backfilling ${count} messages with null search_vector...`);
            await client.query(`
        UPDATE chat_messages 
        SET search_vector = to_tsvector('spanish', coalesce(content, ''))
        WHERE search_vector IS NULL;
      `);
            Logger.info("[FTS] Backfill complete.");
        } else {
            Logger.info("[FTS] No backfill needed.");
        }

        Logger.info("[FTS] Setup complete.");
    } catch (error: any) {
        Logger.error("[FTS] Setup failed:", error.message);
        // We don't exit here, just log, so server can still start if FTS fails (though search might be broken)
    } finally {
        client.release();
    }
}
