import { db, dbRead } from "../db";
import { sql } from "drizzle-orm";
import { createLogger } from "../utils/logger";
import { generateEmbedding } from "../embeddingService";

const log = createLogger("unified-search");

export type SearchResultType = "message" | "chat" | "document";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  content: string;
  highlight: string;
  score: number;
  chatId?: string;
  userId?: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  query: string;
  userId: string;
  types?: SearchResultType[];
  dateFrom?: Date;
  dateTo?: Date;
  model?: string;
  limit?: number;
  offset?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
  took: number;
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion
// ---------------------------------------------------------------------------

export function reciprocalRankFusion(
  rankings: SearchResult[][],
  k: number = 60,
): SearchResult[] {
  const scores = new Map<string, { score: number; result: SearchResult }>();

  for (const ranking of rankings) {
    for (let i = 0; i < ranking.length; i++) {
      const key = `${ranking[i].type}:${ranking[i].id}`;
      const rrf = 1 / (k + i + 1);
      const existing = scores.get(key);
      if (existing) {
        existing.score += rrf;
      } else {
        scores.set(key, { score: rrf, result: ranking[i] });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ score, result }) => ({ ...result, score }));
}

// ---------------------------------------------------------------------------
// Full-text search (tsvector)
// ---------------------------------------------------------------------------

export async function fullTextSearch(options: SearchOptions): Promise<SearchResult[]> {
  const { query, userId, types, dateFrom, dateTo, limit = 20 } = options;

  if (!query.trim()) return [];

  const results: SearchResult[] = [];
  const includeAll = !types || types.length === 0;

  try {
    // Search messages via chat_messages table (has search_vector + GIN index)
    if (includeAll || types!.includes("message")) {
      const messageRows = await dbRead.execute<{
        id: string;
        type: string;
        title: string;
        content: string;
        highlight: string;
        score: number;
        chat_id: string;
        created_at: Date;
      }>(sql`
        SELECT
          m.id,
          'message' as type,
          LEFT(m.content, 200) as title,
          m.content,
          ts_headline(
            'english', m.content,
            plainto_tsquery('english', ${query}),
            'MaxWords=50, MinWords=20, StartSel=<mark>, StopSel=</mark>'
          ) as highlight,
          ts_rank(to_tsvector('english', m.content), plainto_tsquery('english', ${query})) as score,
          m.chat_id,
          m.created_at
        FROM chat_messages m
        JOIN chats c ON c.id = m.chat_id
        WHERE c.user_id = ${userId}
          AND to_tsvector('english', m.content) @@ plainto_tsquery('english', ${query})
          ${dateFrom ? sql`AND m.created_at >= ${dateFrom}` : sql``}
          ${dateTo ? sql`AND m.created_at <= ${dateTo}` : sql``}
        ORDER BY score DESC
        LIMIT ${limit}
      `);

      for (const row of messageRows.rows) {
        results.push({
          id: row.id,
          type: "message",
          title: String(row.title),
          content: String(row.content),
          highlight: String(row.highlight),
          score: Number(row.score),
          chatId: row.chat_id,
          userId,
          createdAt: new Date(row.created_at),
        });
      }
    }

    // Search chats by title
    if (includeAll || types!.includes("chat")) {
      const chatRows = await dbRead.execute<{
        id: string;
        type: string;
        title: string;
        highlight: string;
        score: number;
        created_at: Date;
      }>(sql`
        SELECT
          c.id,
          'chat' as type,
          c.title,
          ts_headline(
            'english', c.title,
            plainto_tsquery('english', ${query}),
            'MaxWords=30, MinWords=10, StartSel=<mark>, StopSel=</mark>'
          ) as highlight,
          ts_rank(to_tsvector('english', c.title), plainto_tsquery('english', ${query})) as score,
          c.created_at
        FROM chats c
        WHERE c.user_id = ${userId}
          AND c.deleted_at IS NULL
          AND to_tsvector('english', c.title) @@ plainto_tsquery('english', ${query})
          ${dateFrom ? sql`AND c.created_at >= ${dateFrom}` : sql``}
          ${dateTo ? sql`AND c.created_at <= ${dateTo}` : sql``}
        ORDER BY score DESC
        LIMIT ${limit}
      `);

      for (const row of chatRows.rows) {
        results.push({
          id: row.id,
          type: "chat",
          title: String(row.title),
          content: String(row.title),
          highlight: String(row.highlight),
          score: Number(row.score),
          userId,
          createdAt: new Date(row.created_at),
        });
      }
    }

    // Search documents via rag_chunks table
    if (includeAll || types!.includes("document")) {
      const docRows = await dbRead.execute<{
        id: string;
        type: string;
        title: string;
        content: string;
        highlight: string;
        score: number;
        conversation_id: string | null;
        created_at: Date;
      }>(sql`
        SELECT
          rc.id,
          'document' as type,
          COALESCE(rc.title, LEFT(rc.content, 200)) as title,
          rc.content,
          ts_headline(
            'english', rc.content,
            plainto_tsquery('english', ${query}),
            'MaxWords=50, MinWords=20, StartSel=<mark>, StopSel=</mark>'
          ) as highlight,
          ts_rank(
            COALESCE(rc.search_vector, to_tsvector('english', rc.content)),
            plainto_tsquery('english', ${query})
          ) as score,
          rc.conversation_id,
          rc.created_at
        FROM rag_chunks rc
        WHERE rc.user_id = ${userId}
          AND rc.is_active = true
          AND (
            rc.search_vector @@ plainto_tsquery('english', ${query})
            OR to_tsvector('english', rc.content) @@ plainto_tsquery('english', ${query})
          )
          ${dateFrom ? sql`AND rc.created_at >= ${dateFrom}` : sql``}
          ${dateTo ? sql`AND rc.created_at <= ${dateTo}` : sql``}
        ORDER BY score DESC
        LIMIT ${limit}
      `);

      for (const row of docRows.rows) {
        results.push({
          id: row.id,
          type: "document",
          title: String(row.title),
          content: String(row.content),
          highlight: String(row.highlight),
          score: Number(row.score),
          chatId: row.conversation_id ?? undefined,
          userId,
          createdAt: new Date(row.created_at),
        });
      }
    }
  } catch (err) {
    log.error("Full-text search error", { error: err });
  }

  return results.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Semantic search (pgvector cosine similarity)
// ---------------------------------------------------------------------------

export async function semanticSearch(options: SearchOptions): Promise<SearchResult[]> {
  const { query, userId, types, dateFrom, dateTo, limit = 20 } = options;

  if (!query.trim()) return [];

  const results: SearchResult[] = [];

  try {
    const queryEmbedding = await generateEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(",")}]`;
    const includeAll = !types || types.length === 0;

    // Semantic search on rag_chunks (has embedding column)
    if (includeAll || types!.includes("document")) {
      const docRows = await dbRead.execute<{
        id: string;
        title: string;
        content: string;
        score: number;
        conversation_id: string | null;
        created_at: Date;
      }>(sql`
        SELECT
          rc.id,
          COALESCE(rc.title, LEFT(rc.content, 200)) as title,
          rc.content,
          1 - (rc.embedding <=> ${embeddingStr}::vector) as score,
          rc.conversation_id,
          rc.created_at
        FROM rag_chunks rc
        WHERE rc.user_id = ${userId}
          AND rc.is_active = true
          AND rc.embedding IS NOT NULL
          ${dateFrom ? sql`AND rc.created_at >= ${dateFrom}` : sql``}
          ${dateTo ? sql`AND rc.created_at <= ${dateTo}` : sql``}
        ORDER BY rc.embedding <=> ${embeddingStr}::vector
        LIMIT ${limit}
      `);

      for (const row of docRows.rows) {
        results.push({
          id: row.id,
          type: "document",
          title: String(row.title),
          content: String(row.content),
          highlight: String(row.content).slice(0, 200),
          score: Number(row.score),
          chatId: row.conversation_id ?? undefined,
          userId,
          createdAt: new Date(row.created_at),
        });
      }
    }

    // Semantic search on semantic_memory_chunks
    if (includeAll || types!.includes("message")) {
      const memRows = await dbRead.execute<{
        id: string;
        content: string;
        score: number;
        type: string;
        created_at: Date;
      }>(sql`
        SELECT
          smc.id,
          smc.content,
          1 - (smc.embedding <=> ${embeddingStr}::vector) as score,
          smc.type,
          smc.created_at
        FROM semantic_memory_chunks smc
        WHERE smc.user_id = ${userId}
          AND smc.embedding IS NOT NULL
          ${dateFrom ? sql`AND smc.created_at >= ${dateFrom}` : sql``}
          ${dateTo ? sql`AND smc.created_at <= ${dateTo}` : sql``}
        ORDER BY smc.embedding <=> ${embeddingStr}::vector
        LIMIT ${limit}
      `);

      for (const row of memRows.rows) {
        results.push({
          id: row.id,
          type: "message",
          title: String(row.content).slice(0, 200),
          content: String(row.content),
          highlight: String(row.content).slice(0, 200),
          score: Number(row.score),
          userId,
          createdAt: new Date(row.created_at),
          metadata: { memoryType: row.type },
        });
      }
    }

    // Semantic search on file_chunks
    if (includeAll || types!.includes("document")) {
      const fileRows = await dbRead.execute<{
        id: string;
        content: string;
        score: number;
        file_id: string;
        created_at: Date;
      }>(sql`
        SELECT
          fc.id,
          fc.content,
          1 - (fc.embedding <=> ${embeddingStr}::vector) as score,
          fc.file_id,
          f.created_at
        FROM file_chunks fc
        JOIN files f ON f.id = fc.file_id
        WHERE f.user_id = ${userId}
          AND fc.embedding IS NOT NULL
          ${dateFrom ? sql`AND f.created_at >= ${dateFrom}` : sql``}
          ${dateTo ? sql`AND f.created_at <= ${dateTo}` : sql``}
        ORDER BY fc.embedding <=> ${embeddingStr}::vector
        LIMIT ${limit}
      `);

      for (const row of fileRows.rows) {
        results.push({
          id: row.id,
          type: "document",
          title: String(row.content).slice(0, 200),
          content: String(row.content),
          highlight: String(row.content).slice(0, 200),
          score: Number(row.score),
          userId,
          createdAt: new Date(row.created_at),
          metadata: { fileId: row.file_id },
        });
      }
    }
  } catch (err) {
    log.error("Semantic search error", { error: err });
  }

  return results.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Hybrid search — combines full-text + semantic with RRF
// ---------------------------------------------------------------------------

export async function hybridSearch(options: SearchOptions): Promise<SearchResponse> {
  const start = Date.now();
  const { query, limit = 20, offset = 0 } = options;

  if (!query.trim()) {
    return { results: [], total: 0, query, took: Date.now() - start };
  }

  // Run both searches in parallel
  const [ftResults, semResults] = await Promise.all([
    fullTextSearch(options).catch((err) => {
      log.error("Full-text search failed, continuing with semantic only", { error: err });
      return [] as SearchResult[];
    }),
    semanticSearch(options).catch((err) => {
      log.error("Semantic search failed, continuing with full-text only", { error: err });
      return [] as SearchResult[];
    }),
  ]);

  // Combine with Reciprocal Rank Fusion
  const fused = reciprocalRankFusion([ftResults, semResults]);

  // Apply type filter if specified (post-fusion safety check)
  let filtered = fused;
  if (options.types && options.types.length > 0) {
    filtered = fused.filter((r) => options.types!.includes(r.type));
  }

  const total = filtered.length;
  const paged = filtered.slice(offset, offset + limit);

  const took = Date.now() - start;
  log.info("Hybrid search completed", {
    query,
    userId: options.userId,
    ftCount: ftResults.length,
    semCount: semResults.length,
    fusedCount: total,
    took,
  });

  return { results: paged, total, query, took };
}
