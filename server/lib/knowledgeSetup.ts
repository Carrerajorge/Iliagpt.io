import { pool } from "../db";
import { Logger } from "./logger";

export async function setupKnowledgeBase(): Promise<void> {
    const client = await pool.connect();
    try {
        Logger.info("[Knowledge] Starting Knowledge Base setup...");

        await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
        await client.query("CREATE EXTENSION IF NOT EXISTS vector");

        await client.query(`
      CREATE TABLE IF NOT EXISTS knowledge_nodes (
        id varchar(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        zettel_id varchar(64),
        title text NOT NULL,
        content text NOT NULL,
        node_type text NOT NULL DEFAULT 'note',
        source_type text NOT NULL DEFAULT 'manual',
        source_id varchar(255),
        tags text[] DEFAULT ARRAY[]::text[],
        embedding vector(1536),
        search_vector tsvector,
        content_hash text,
        metadata jsonb DEFAULT '{}'::jsonb,
        importance real DEFAULT 0.5,
        access_count integer DEFAULT 0,
        last_accessed_at timestamptz DEFAULT now(),
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        is_active boolean DEFAULT true
      );
    `);

        await client.query(`
      CREATE TABLE IF NOT EXISTS knowledge_edges (
        id varchar(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_node_id varchar(255) NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
        target_node_id varchar(255) NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
        relation_type text NOT NULL,
        weight real DEFAULT 1.0,
        metadata jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now(),
        UNIQUE (user_id, source_node_id, target_node_id, relation_type)
      );
    `);

        await client.query(`DROP INDEX IF EXISTS knowledge_nodes_zettel_idx;`);
        await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_nodes_user_zettel_idx ON knowledge_nodes(user_id, zettel_id);`);
        await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_nodes_user_hash_idx ON knowledge_nodes(user_id, content_hash);`);
        await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_nodes_user_source_idx ON knowledge_nodes(user_id, source_type, source_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS knowledge_nodes_user_idx ON knowledge_nodes(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS knowledge_nodes_type_idx ON knowledge_nodes(node_type);`);
        await client.query(`CREATE INDEX IF NOT EXISTS knowledge_nodes_source_idx ON knowledge_nodes(source_type, source_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS knowledge_nodes_created_idx ON knowledge_nodes(created_at);`);
        await client.query(`CREATE INDEX IF NOT EXISTS knowledge_nodes_tags_idx ON knowledge_nodes USING GIN (tags);`);
        await client.query(`CREATE INDEX IF NOT EXISTS knowledge_nodes_embedding_idx ON knowledge_nodes USING hnsw (embedding vector_cosine_ops);`);
        await client.query(`CREATE INDEX IF NOT EXISTS knowledge_nodes_search_idx ON knowledge_nodes USING GIN (search_vector);`);
        await client.query(`CREATE INDEX IF NOT EXISTS knowledge_edges_user_idx ON knowledge_edges(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS knowledge_edges_source_idx ON knowledge_edges(source_node_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS knowledge_edges_target_idx ON knowledge_edges(target_node_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS knowledge_edges_relation_idx ON knowledge_edges(relation_type);`);

        await client.query(`
      CREATE OR REPLACE FUNCTION knowledge_nodes_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector := to_tsvector('spanish', coalesce(NEW.title, '') || ' ' || coalesce(NEW.content, ''));
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
    `);

        await client.query(`
      DROP TRIGGER IF EXISTS knowledge_nodes_search_vector_update ON knowledge_nodes;
      CREATE TRIGGER knowledge_nodes_search_vector_update
      BEFORE INSERT OR UPDATE ON knowledge_nodes
      FOR EACH ROW
      EXECUTE PROCEDURE knowledge_nodes_search_vector_update();
    `);

        const { rows } = await client.query("SELECT COUNT(*) as count FROM knowledge_nodes WHERE search_vector IS NULL");
        const count = parseInt(rows[0]?.count || "0", 10);
        if (count > 0) {
            Logger.info(`[Knowledge] Backfilling ${count} nodes with null search_vector...`);
            await client.query(`
        UPDATE knowledge_nodes
        SET search_vector = to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(content, ''))
        WHERE search_vector IS NULL;
      `);
        }

        Logger.info("[Knowledge] Setup complete.");
    } catch (error: any) {
        Logger.error("[Knowledge] Setup failed:", error.message || error);
    } finally {
        client.release();
    }
}
