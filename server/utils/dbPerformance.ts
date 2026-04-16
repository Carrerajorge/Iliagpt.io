/**
 * Database Performance Utilities
 * Query optimization and connection management
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * Cursor-based pagination for large datasets
 */
export interface CursorPaginationOptions {
  cursor?: string;
  limit: number;
  direction?: 'forward' | 'backward';
}

export interface CursorPaginationResult<T> {
  data: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
}

/**
 * Execute with timeout
 */
export async function executeWithTimeout<T>(
  query: Promise<T>,
  timeoutMs: number = 30000
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Query timeout')), timeoutMs);
  });

  return Promise.race([query, timeoutPromise]);
}

/**
 * Batch insert with chunking
 */
export async function batchInsert<T>(
  table: any,
  records: T[],
  chunkSize: number = 100
): Promise<void> {
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    await db.insert(table).values(chunk as any);
  }
}

/** Allowed table names for batch updates (whitelist to prevent SQL injection) */
const ALLOWED_TABLES = new Set([
  "users", "chats", "chat_messages", "files", "payments", "invoices",
  "api_logs", "billing_credit_grants", "spreadsheet_uploads",
  "knowledge_documents", "gpt_configs", "audit_logs",
]);

/** Allowed column name pattern: only alphanumeric + underscore */
const SAFE_COLUMN_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

/**
 * Batch update with chunking — uses parameterized queries to prevent SQL injection.
 * Table names and column names are validated against whitelists.
 * Values are passed as parameterized bindings via Drizzle's sql`` template.
 */
export async function batchUpdate(
  tableName: string,
  updates: Array<{ id: string; data: Record<string, any> }>,
  chunkSize: number = 100
): Promise<void> {
  if (!ALLOWED_TABLES.has(tableName)) {
    throw new Error(`[batchUpdate] Table "${tableName}" is not in the whitelist`);
  }
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);

    await db.transaction(async (tx) => {
      for (const update of chunk) {
        const entries = Object.entries(update.data);
        if (entries.length === 0) continue;

        // Validate column names against strict pattern
        for (const [key] of entries) {
          if (!SAFE_COLUMN_RE.test(key)) {
            throw new Error(`[batchUpdate] Invalid column name: "${key}"`);
          }
        }

        // Build parameterized query using Drizzle sql template.
        // Column names are validated above (safe identifiers only).
        // Values + id are bound as parameters (never interpolated).
        const setFragments = entries.map(
          ([key, value]) => sql.join([sql.raw(key), sql` = ${value}`])
        );
        const setClause = sql.join(setFragments, sql`, `);

        await tx.execute(
          sql`UPDATE ${sql.raw(tableName)} SET ${setClause} WHERE id = ${update.id}`
        );
      }
    });
  }
}

/**
 * Query analyzer - log slow queries
 */
export async function analyzeQuery<T>(
  name: string,
  query: Promise<T>,
  slowThresholdMs: number = 1000
): Promise<T> {
  const start = Date.now();
  
  try {
    const result = await query;
    const duration = Date.now() - start;
    
    if (duration > slowThresholdMs) {
      console.warn(`[SLOW QUERY] ${name}: ${duration}ms`);
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`[QUERY ERROR] ${name}: ${duration}ms`, error);
    throw error;
  }
}

/**
 * Connection health check
 */
export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  latencyMs: number;
  poolInfo?: any;
}> {
  const start = Date.now();
  
  try {
    await db.execute(sql`SELECT 1`);
    return {
      connected: true,
      latencyMs: Date.now() - start
    };
  } catch (error) {
    return {
      connected: false,
      latencyMs: Date.now() - start
    };
  }
}

/**
 * Get table statistics
 */
export async function getTableStats(tableName: string): Promise<{
  rowCount: number;
  sizeBytes: number;
  indexCount: number;
}> {
  if (!SAFE_COLUMN_RE.test(tableName)) {
    throw new Error(`[getTableStats] Invalid table name: "${tableName}"`);
  }
  try {
    const [countResult] = await db.execute(
      sql`SELECT COUNT(*) as count FROM ${sql.raw(tableName)}`
    ) as any;

    const [sizeResult] = await db.execute(sql`
      SELECT pg_total_relation_size(${tableName}) as size
    `) as any;

    const [indexResult] = await db.execute(sql`
      SELECT COUNT(*) as count FROM pg_indexes WHERE tablename = ${tableName}
    `) as any;

    return {
      rowCount: parseInt(countResult?.count || '0'),
      sizeBytes: parseInt(sizeResult?.size || '0'),
      indexCount: parseInt(indexResult?.count || '0')
    };
  } catch {
    return { rowCount: 0, sizeBytes: 0, indexCount: 0 };
  }
}

/**
 * Vacuum table (PostgreSQL maintenance)
 */
export async function vacuumTable(tableName: string): Promise<void> {
  if (!SAFE_COLUMN_RE.test(tableName)) {
    throw new Error(`[vacuumTable] Invalid table name: "${tableName}"`);
  }
  await db.execute(sql`VACUUM ANALYZE ${sql.raw(tableName)}`);
}

/**
 * Get slow query log from PostgreSQL
 */
export async function getSlowQueries(limit: number = 10): Promise<any[]> {
  try {
    const result = await db.execute(sql`
      SELECT query, calls, mean_time, total_time
      FROM pg_stat_statements
      ORDER BY mean_time DESC
      LIMIT ${limit}
    `);
    return result.rows || [];
  } catch {
    // pg_stat_statements might not be enabled
    return [];
  }
}

/**
 * Create a read replica connection (for future scaling)
 */
export function createReadReplicaConnection(replicaUrl: string) {
  // Placeholder for read replica support
  // In production, this would create a separate connection pool
  console.log(`[DB] Read replica configured: ${replicaUrl}`);
  return db; // For now, return main connection
}

/**
 * Query result streaming for large datasets
 */
export async function* streamQuery<T>(
  query: () => Promise<T[]>,
  batchSize: number = 1000
): AsyncGenerator<T> {
  let offset = 0;
  let hasMore = true;
  
  while (hasMore) {
    const batch = await query();
    
    for (const item of batch) {
      yield item;
    }
    
    hasMore = batch.length === batchSize;
    offset += batchSize;
  }
}

/**
 * Deferred query execution (for batching)
 */
class QueryBatcher {
  private pending: Map<string, { resolve: Function; reject: Function; keys: string[] }[]> = new Map();
  private timeout: NodeJS.Timeout | null = null;
  private readonly batchDelayMs: number = 10;

  async batch<T>(
    queryId: string,
    key: string,
    loader: (keys: string[]) => Promise<Map<string, T>>
  ): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.pending.has(queryId)) {
        this.pending.set(queryId, []);
      }
      
      this.pending.get(queryId)!.push({ resolve, reject, keys: [key] });
      
      if (!this.timeout) {
        this.timeout = setTimeout(() => this.flush(queryId, loader), this.batchDelayMs);
      }
    });
  }

  private async flush<T>(
    queryId: string,
    loader: (keys: string[]) => Promise<Map<string, T>>
  ): Promise<void> {
    this.timeout = null;
    
    const pending = this.pending.get(queryId) || [];
    this.pending.delete(queryId);
    
    const allKeys = pending.flatMap(p => p.keys);
    const uniqueKeys = [...new Set(allKeys)];
    
    try {
      const results = await loader(uniqueKeys);
      
      for (const { resolve, keys } of pending) {
        resolve(results.get(keys[0]));
      }
    } catch (error) {
      for (const { reject } of pending) {
        reject(error);
      }
    }
  }
}

export const queryBatcher = new QueryBatcher();
