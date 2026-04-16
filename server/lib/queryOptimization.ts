/**
 * Database Indexes and Query Optimization
 * Task 8: Partial indexes for frequent queries
 * Task 9: Read replica routing
 */

import { sql } from 'drizzle-orm';
import { db, dbRead } from '../db';
import { Logger } from '../lib/logger';

// ============================================================================
// Task 8: Partial Index Definitions
// ============================================================================

/**
 * Partial indexes optimize queries that filter on specific conditions.
 * These indexes are smaller and more efficient than full indexes.
 */
export const partialIndexMigrations = [
    // Index only active chats (not deleted) - most common query pattern
    {
        name: 'idx_chats_active_user',
        definition: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chats_active_user 
      ON chats (user_id, updated_at DESC) 
      WHERE deleted_at IS NULL
    `,
        description: 'Optimizes listing active chats for a user',
    },

    // Index only recent messages (last 30 days) for search
    {
        name: 'idx_messages_recent_search',
        definition: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_recent_search 
      ON messages USING GIN (to_tsvector('spanish', content)) 
      WHERE created_at > NOW() - INTERVAL '30 days'
    `,
        description: 'Full-text search on recent messages only',
    },

    // Index unread notifications
    {
        name: 'idx_notifications_unread',
        definition: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_unread 
      ON notifications (user_id, created_at DESC) 
      WHERE read_at IS NULL
    `,
        description: 'Fast lookup of unread notifications',
    },

    // Index pending jobs in queue
    {
        name: 'idx_jobs_pending',
        definition: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_pending 
      ON background_jobs (priority DESC, created_at ASC) 
      WHERE status = 'pending'
    `,
        description: 'Optimizes job queue polling',
    },

    // Index active user sessions
    {
        name: 'idx_sessions_active',
        definition: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_active 
      ON sessions (user_id, last_activity DESC) 
      WHERE expires_at > NOW()
    `,
        description: 'Fast lookup of active sessions',
    },

    // Index high-priority support tickets
    {
        name: 'idx_tickets_open_priority',
        definition: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_open_priority 
      ON support_tickets (priority DESC, created_at ASC) 
      WHERE status IN ('open', 'in_progress')
    `,
        description: 'Optimizes support ticket dashboard',
    },

    // Composite index for chat message listing
    {
        name: 'idx_messages_chat_order',
        definition: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_chat_order 
      ON messages (chat_id, created_at DESC) 
      INCLUDE (role, content)
    `,
        description: 'Covering index for message listing',
    },

    // Index for user lookup by email (case-insensitive)
    {
        name: 'idx_users_email_lower',
        definition: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_lower 
      ON users (LOWER(email))
    `,
        description: 'Case-insensitive email lookup',
    },
];

/**
 * Apply all partial indexes (run during migration)
 * Uses CONCURRENTLY to avoid table locks
 */
export async function applyPartialIndexes(): Promise<{ applied: string[]; failed: string[] }> {
    const applied: string[] = [];
    const failed: string[] = [];

    for (const index of partialIndexMigrations) {
        try {
            // Check if index exists
            const exists = await db.execute(sql`
        SELECT 1 FROM pg_indexes 
        WHERE indexname = ${index.name}
      `);

            if (exists.rows.length > 0) {
                Logger.debug(`[DB] Index ${index.name} already exists`);
                continue;
            }

            await db.execute(sql.raw(index.definition));
            applied.push(index.name);
            Logger.info(`[DB] Created index: ${index.name} - ${index.description}`);
        } catch (error: any) {
            failed.push(index.name);
            Logger.error(`[DB] Failed to create index ${index.name}: ${error.message}`);
        }
    }

    return { applied, failed };
}

// ============================================================================
// Task 9: Read Replica Routing
// ============================================================================

type QueryType = 'READ' | 'WRITE';

interface QueryRouter {
    route<T>(queryFn: (database: typeof db) => Promise<T>, type?: QueryType): Promise<T>;
}

/**
 * Intelligent query routing to read replicas
 * - Writes always go to primary
 * - Reads go to replica when available
 * - Fallback to primary if replica is unhealthy
 */
export const queryRouter: QueryRouter = {
    async route<T>(queryFn: (database: typeof db) => Promise<T>, type: QueryType = 'READ'): Promise<T> {
        if (type === 'WRITE') {
            return queryFn(db);
        }

        // For reads, try replica first
        try {
            return await queryFn(dbRead);
        } catch (error: any) {
            // If replica fails, fallback to primary
            if (dbRead !== db) {
                Logger.warn(`[DB] Read replica failed, falling back to primary: ${error.message}`);
                return queryFn(db);
            }
            throw error;
        }
    },
};

// Convenience functions
export async function readQuery<T>(queryFn: (database: typeof db) => Promise<T>): Promise<T> {
    return queryRouter.route(queryFn, 'READ');
}

export async function writeQuery<T>(queryFn: (database: typeof db) => Promise<T>): Promise<T> {
    return queryRouter.route(queryFn, 'WRITE');
}

// ============================================================================
// Query Analysis Helpers
// ============================================================================

interface QueryExplain {
    plan: string;
    estimatedRows: number;
    estimatedCost: number;
    indexesUsed: string[];
}

export async function analyzeQuery(query: string): Promise<QueryExplain> {
    const result = await db.execute(sql.raw(`EXPLAIN (FORMAT JSON) ${query}`));
    const plan = (result.rows[0] as any)?.['QUERY PLAN'][0];

    const extractIndexes = (node: any): string[] => {
        const indexes: string[] = [];
        if (node['Index Name']) indexes.push(node['Index Name']);
        if (node['Plans']) {
            for (const child of node['Plans']) {
                indexes.push(...extractIndexes(child));
            }
        }
        return indexes;
    };

    return {
        plan: JSON.stringify(plan, null, 2),
        estimatedRows: plan?.['Plan Rows'] ?? 0,
        estimatedCost: plan?.['Total Cost'] ?? 0,
        indexesUsed: plan ? extractIndexes(plan['Plan']) : [],
    };
}

// ============================================================================
// Connection Stats Endpoint Data
// ============================================================================

export async function getDatabaseStats() {
    const stats = await db.execute(sql`
    SELECT 
      (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) as active_connections,
      (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections,
      (SELECT pg_database_size(current_database())) as database_size_bytes,
      (SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND datname = current_database()) as active_queries,
      (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle' AND datname = current_database()) as idle_connections,
      (SELECT COALESCE(sum(calls), 0) FROM pg_stat_statements LIMIT 1) as total_queries
  `);

    return stats.rows[0];
}

export async function getSlowQueries(limit: number = 10) {
    try {
        const result = await db.execute(sql`
      SELECT 
        query,
        calls,
        mean_exec_time as avg_time_ms,
        total_exec_time as total_time_ms,
        rows
      FROM pg_stat_statements 
      ORDER BY mean_exec_time DESC 
      LIMIT ${limit}
    `);
        return result.rows;
    } catch {
        // pg_stat_statements extension might not be enabled
        return [];
    }
}
