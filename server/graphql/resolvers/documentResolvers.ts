/**
 * Document GraphQL Resolvers
 * Handles: file/document management, search, AI analysis
 */

import { GraphQLError } from "graphql";
import { eq, and, desc, like, sql, inArray } from "drizzle-orm";
import { db, db as dbRead } from "../../db.js";
import { Logger } from "../../lib/logger.js";
import { files } from "../../../shared/schema.js";
import type { GraphQLContext } from "../middleware/auth.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function assertAuth(ctx: GraphQLContext): asserts ctx is GraphQLContext & { user: NonNullable<GraphQLContext["user"]> } {
  if (!ctx.user?.id) {
    throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHENTICATED" } });
  }
}

function encodeCursor(val: string): string {
  return Buffer.from(val).toString("base64");
}

function mapFileToDocument(f: typeof files.$inferSelect) {
  return {
    id: f.id,
    userId: f.userId ?? "",
    name: f.name ?? "unknown",
    mimeType: f.type ?? "application/octet-stream",
    size: f.size ?? 0,
    status: (f.status ?? "pending").toUpperCase(),
    path: f.storagePath ?? null,
    extractedText: null,                        // Not in files table; stored in fileChunks.content
    chunkCount: f.totalChunks ?? 0,
    embeddingCount: 0,                          // Would query fileChunks WHERE embedding IS NOT NULL
    metadata: null,
    tags: [] as string[],
    createdAt: f.createdAt,
    updatedAt: f.createdAt,                     // files table has no updatedAt
  };
}

// ─── Analysis results cache (in production: stored in DB) ────────────────────
const analysisCache = new Map<string, {
  documentId: string;
  summary: string | null;
  keyTopics: string[];
  language: string | null;
  wordCount: number | null;
  sentiment: string | null;
  entities: unknown;
  analyzedAt: Date;
}>();

// ─── Resolvers ────────────────────────────────────────────────────────────────
export const documentResolvers = {
  Query: {
    async documents(
      _: unknown,
      args: {
        filter?: {
          status?: string;
          mimeType?: string;
          tags?: string[];
          search?: string;
          from?: string;
          to?: string;
        };
        limit?: number;
        offset?: number;
      },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);
      const limit = Math.min(args.limit ?? 20, 100);
      const offset = args.offset ?? 0;

      try {
        Logger.info("[GraphQL] documents query", { userId: ctx.user.id, limit, offset });

        const conditions: ReturnType<typeof eq>[] = [eq(files.userId, ctx.user.id)];

        if (args.filter?.status) {
          conditions.push(eq(files.status, args.filter.status.toLowerCase() as any));
        }

        if (args.filter?.mimeType) {
          conditions.push(eq(files.type, args.filter.mimeType));
        }

        if (args.filter?.search) {
          conditions.push(like(files.name, `%${args.filter.search}%`));
        }

        if (args.filter?.from) {
          conditions.push(sql`${files.createdAt} >= ${new Date(args.filter.from)}`);
        }

        if (args.filter?.to) {
          conditions.push(sql`${files.createdAt} <= ${new Date(args.filter.to)}`);
        }

        const rows = await dbRead
          .select()
          .from(files)
          .where(and(...conditions))
          .orderBy(desc(files.createdAt))
          .limit(limit + 1)
          .offset(offset);

        const hasNextPage = rows.length > limit;
        const items = hasNextPage ? rows.slice(0, limit) : rows;

        // Filter by tags (array overlap — done in app layer for portability)
        const filtered = args.filter?.tags?.length
          ? items.filter((f) => {
              const docTags: string[] = (f.tags as any) ?? [];
              return args.filter!.tags!.every((t) => docTags.includes(t));
            })
          : items;

        return {
          edges: filtered.map((f) => ({ node: mapFileToDocument(f), cursor: encodeCursor(f.id) })),
          pageInfo: {
            hasNextPage,
            hasPreviousPage: offset > 0,
            startCursor: filtered.length > 0 ? encodeCursor(filtered[0].id) : null,
            endCursor: filtered.length > 0 ? encodeCursor(filtered[filtered.length - 1].id) : null,
            totalCount: filtered.length,
          },
        };
      } catch (err) {
        Logger.error("[GraphQL] documents query failed", err);
        throw new GraphQLError("Failed to fetch documents");
      }
    },

    async document(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      assertAuth(ctx);

      try {
        Logger.info("[GraphQL] document query", { documentId: args.id, userId: ctx.user.id });

        const [row] = await dbRead
          .select()
          .from(files)
          .where(and(eq(files.id, args.id), eq(files.userId, ctx.user.id)))
          .limit(1);

        if (!row) return null;
        return mapFileToDocument(row);
      } catch (err) {
        Logger.error("[GraphQL] document query failed", err);
        throw new GraphQLError("Failed to fetch document");
      }
    },

    async searchDocuments(
      _: unknown,
      args: { query: string; limit?: number },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);
      const limit = Math.min(args.limit ?? 10, 50);

      try {
        Logger.info("[GraphQL] searchDocuments", { userId: ctx.user.id, query: args.query });

        // Basic full-text search — in production: use pg_trgm or dedicated FTS table
        const searchTerm = `%${args.query}%`;
        const rows = await dbRead
          .select()
          .from(files)
          .where(
            and(
              eq(files.userId, ctx.user.id),
              sql`${files.name} ILIKE ${searchTerm}`
            )
          )
          .orderBy(desc(files.createdAt))
          .limit(limit);

        return rows.map((f) => {
          const text = f.name ?? "";
          const queryLower = args.query.toLowerCase();
          const idx = text.toLowerCase().indexOf(queryLower);
          const matchedChunk =
            idx >= 0
              ? text.substring(Math.max(0, idx - 60), Math.min(text.length, idx + 120))
              : text.substring(0, 120);

          return {
            document: mapFileToDocument(f),
            score: 1.0, // In production: BM25 or cosine similarity score
            matchedChunks: matchedChunk ? [matchedChunk] : [],
          };
        });
      } catch (err) {
        Logger.error("[GraphQL] searchDocuments failed", err);
        throw new GraphQLError("Document search failed");
      }
    },
  },

  Mutation: {
    async createDocument(
      _: unknown,
      args: {
        input: {
          name: string;
          mimeType: string;
          content?: string;
          tags?: string[];
          metadata?: unknown;
        };
      },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);

      try {
        Logger.info("[GraphQL] createDocument", { userId: ctx.user.id, name: args.input.name });

        const [doc] = await db
          .insert(files)
          .values({
            userId: ctx.user.id,
            name: args.input.name,
            type: args.input.mimeType,
            size: args.input.content ? Buffer.byteLength(args.input.content, "utf8") : 0,
            storagePath: "",   // Placeholder — real upload sets this via object storage
            status: "pending",
          })
          .returning();

        return mapFileToDocument(doc);
      } catch (err) {
        Logger.error("[GraphQL] createDocument failed", err);
        throw new GraphQLError("Failed to create document");
      }
    },

    async updateDocument(
      _: unknown,
      args: {
        id: string;
        input: {
          name?: string;
          tags?: string[];
          metadata?: unknown;
        };
      },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);

      try {
        Logger.info("[GraphQL] updateDocument", { documentId: args.id, userId: ctx.user.id });

        const updateData: Record<string, unknown> = {};
        if (args.input.name !== undefined) updateData.name = args.input.name;
        // tags and metadata not in files table schema — would need extension or separate table

        const [updated] = await db
          .update(files)
          .set(updateData as any)
          .where(and(eq(files.id, args.id), eq(files.userId, ctx.user.id)))
          .returning();

        if (!updated) {
          throw new GraphQLError("Document not found or access denied", { extensions: { code: "NOT_FOUND" } });
        }

        return mapFileToDocument(updated);
      } catch (err) {
        Logger.error("[GraphQL] updateDocument failed", err);
        throw err instanceof GraphQLError ? err : new GraphQLError("Failed to update document");
      }
    },

    async analyzeDocument(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      assertAuth(ctx);

      try {
        Logger.info("[GraphQL] analyzeDocument", { documentId: args.id, userId: ctx.user.id });

        const [doc] = await dbRead
          .select()
          .from(files)
          .where(and(eq(files.id, args.id), eq(files.userId, ctx.user.id)))
          .limit(1);

        if (!doc) {
          throw new GraphQLError("Document not found", { extensions: { code: "NOT_FOUND" } });
        }

        // Check cache first
        const cached = analysisCache.get(args.id);
        if (cached) {
          Logger.info("[GraphQL] analyzeDocument: returning cached analysis", { documentId: args.id });
          return cached;
        }

        // In production: retrieve extracted text from fileChunks, then call LLM / NLP service
        const wordCount = doc.name ? doc.name.split(/\s+/).filter(Boolean).length : 0;

        // Stub analysis — replace with real LLM call
        const analysis = {
          documentId: args.id,
          summary: `Document "${doc.name ?? "unknown"}" contains ${wordCount} words.`,
          keyTopics: ["document", "analysis"], // Would be extracted by LLM
          language: "en",                       // Would be detected by langdetect
          wordCount,
          sentiment: "neutral",                  // Would be from sentiment analysis
          entities: null,                        // Would be from NER
          analyzedAt: new Date(),
        };

        analysisCache.set(args.id, analysis);

        // Mark document as processed
        await db.update(files).set({ status: "ready", updatedAt: new Date() }).where(eq(files.id, args.id));

        return analysis;
      } catch (err) {
        Logger.error("[GraphQL] analyzeDocument failed", err);
        throw err instanceof GraphQLError ? err : new GraphQLError("Analysis failed");
      }
    },

    async deleteDocument(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      assertAuth(ctx);

      try {
        Logger.info("[GraphQL] deleteDocument", { documentId: args.id, userId: ctx.user.id });

        // Soft delete by setting status
        const [deleted] = await db
          .update(files)
          .set({ status: "deleted" as any, updatedAt: new Date() })
          .where(and(eq(files.id, args.id), eq(files.userId, ctx.user.id)))
          .returning();

        if (!deleted) {
          throw new GraphQLError("Document not found or access denied", { extensions: { code: "NOT_FOUND" } });
        }

        analysisCache.delete(args.id);
        return true;
      } catch (err) {
        Logger.error("[GraphQL] deleteDocument failed", err);
        throw err instanceof GraphQLError ? err : new GraphQLError("Failed to delete document");
      }
    },
  },

  // Field resolvers
  Document: {
    analysisResult(parent: { id: string }) {
      return analysisCache.get(parent.id) ?? null;
    },

    async user(parent: { userId: string }, _: unknown, ctx: GraphQLContext) {
      if (!ctx.user?.id || parent.userId !== ctx.user.id) return null;
      // Would load user from DB; returning minimal stub to avoid extra query
      return { id: parent.userId };
    },
  },
};
