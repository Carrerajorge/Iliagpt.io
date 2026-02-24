import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { db, dbRead } from "../db";
import { knowledgeNodes, knowledgeEdges, chats, chatMessages, conversationDocuments } from "@shared/schema";
import type { InsertKnowledgeNode, KnowledgeNode, InsertKnowledgeEdge, KnowledgeEdge } from "@shared/schema/knowledge";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { generateEmbedding } from "../embeddingService";
import { resolveSafePath } from "../utils/pathSecurity";
import { setupKnowledgeBase } from "../lib/knowledgeSetup";

interface KnowledgeSearchResult {
    node: KnowledgeNode;
    score: number;
    matchType: "vector" | "keyword" | "hybrid";
}

interface KnowledgeSearchOptions {
    limit?: number;
    nodeTypes?: string[];
    tags?: string[];
    keywordWeight?: number;
    vectorWeight?: number;
}

interface KnowledgeExportOptions {
    outputDir: string;
    nodeIds?: string[];
    tags?: string[];
}

class KnowledgeBaseService {
    private initialized = false;
    private meiliConfigured = false;
    private meiliUrl = "";
    private meiliKey = "";
    private meiliIndex = "knowledge_nodes";
    private meiliSettingsApplied = false;
    private ingestEnabled = process.env.KNOWLEDGE_INGEST_ENABLED !== "false";
    private ingestWebEnabled = process.env.KNOWLEDGE_INGEST_WEB !== "false";

    async initialize(): Promise<void> {
        if (this.initialized) return;
        await setupKnowledgeBase();
        this.meiliUrl = process.env.MEILI_URL || process.env.MEILISEARCH_URL || "";
        this.meiliKey = process.env.MEILI_API_KEY || "";
        this.meiliConfigured = Boolean(this.meiliUrl);
        this.ingestEnabled = process.env.KNOWLEDGE_INGEST_ENABLED !== "false";
        this.ingestWebEnabled = process.env.KNOWLEDGE_INGEST_WEB !== "false";
        this.initialized = true;
    }

    private buildContentHash(content: string): string {
        return crypto.createHash("sha256").update(content).digest("hex");
    }

    private buildZettelId(now = new Date()): string {
        const pad = (n: number) => n.toString().padStart(2, "0");
        const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
        const rand = crypto.randomBytes(3).toString("hex");
        return `${stamp}-${rand}`;
    }

    private normalizeSourceId(value?: string | null): string | null {
        if (!value) return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        return trimmed.length > 255 ? trimmed.slice(0, 255) : trimmed;
    }

    private async ensureMeiliIndex(): Promise<boolean> {
        if (!this.meiliConfigured) return false;
        try {
            const res = await fetch(`${this.meiliUrl}/indexes/${this.meiliIndex}`, {
                headers: this.meiliKey ? { "Authorization": `Bearer ${this.meiliKey}` } : undefined,
            });
            if (res.ok) {
                await this.configureMeiliIndex();
                return true;
            }
            if (res.status !== 404) return false;

            const createRes = await fetch(`${this.meiliUrl}/indexes`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(this.meiliKey ? { "Authorization": `Bearer ${this.meiliKey}` } : {}),
                },
                body: JSON.stringify({ uid: this.meiliIndex, primaryKey: "id" }),
            });
            if (!createRes.ok) return false;
            await this.configureMeiliIndex();
            return true;
        } catch {
            return false;
        }
    }

    private async configureMeiliIndex(): Promise<void> {
        if (!this.meiliConfigured || this.meiliSettingsApplied) return;
        try {
            await fetch(`${this.meiliUrl}/indexes/${this.meiliIndex}/settings`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    ...(this.meiliKey ? { "Authorization": `Bearer ${this.meiliKey}` } : {}),
                },
                body: JSON.stringify({
                    filterableAttributes: ["userId", "nodeType", "tags", "sourceType", "sourceId"],
                    searchableAttributes: ["title", "content", "tags"],
                    sortableAttributes: ["createdAt", "updatedAt"],
                }),
            });
            this.meiliSettingsApplied = true;
        } catch {
            // Ignore Meili settings errors (non-blocking)
        }
    }

    private async indexInMeili(node: KnowledgeNode): Promise<void> {
        if (!this.meiliConfigured) return;
        const ready = await this.ensureMeiliIndex();
        if (!ready) return;

        const payload = {
            id: node.id,
            userId: node.userId,
            title: node.title,
            content: node.content,
            nodeType: node.nodeType,
            sourceType: node.sourceType,
            sourceId: node.sourceId,
            tags: node.tags,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
        };

        try {
            await fetch(`${this.meiliUrl}/indexes/${this.meiliIndex}/documents`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(this.meiliKey ? { "Authorization": `Bearer ${this.meiliKey}` } : {}),
                },
                body: JSON.stringify([payload]),
            });
        } catch {
            // Ignore Meili errors (non-blocking)
        }
    }

    private async searchInMeili(userId: string, query: string, limit: number): Promise<KnowledgeNode[]> {
        if (!this.meiliConfigured) return [];
        const ready = await this.ensureMeiliIndex();
        if (!ready) return [];

        try {
            const res = await fetch(`${this.meiliUrl}/indexes/${this.meiliIndex}/search`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(this.meiliKey ? { "Authorization": `Bearer ${this.meiliKey}` } : {}),
                },
                body: JSON.stringify({ q: query, limit, filter: `userId = "${userId}"` }),
            });
            if (!res.ok) return [];
            const data = await res.json();
            const ids = (data.hits || []).map((hit: any) => hit.id).filter(Boolean);
            if (!ids.length) return [];
            return dbRead.select().from(knowledgeNodes).where(inArray(knowledgeNodes.id, ids));
        } catch {
            return [];
        }
    }

    private async linkReferencesFromContent(userId: string, nodeId: string, content: string): Promise<void> {
        const refs = new Set<string>();
        const pattern = /\[\[([^\]]+)\]\]/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
            const label = match[1]?.trim();
            if (label) refs.add(label);
        }
        if (refs.size === 0) return;

        for (const label of refs) {
            const [target] = await dbRead.select()
                .from(knowledgeNodes)
                .where(and(
                    eq(knowledgeNodes.userId, userId),
                    or(
                        eq(knowledgeNodes.zettelId, label),
                        sql`lower(${knowledgeNodes.title}) = lower(${label})`
                    )
                ))
                .limit(1);

            if (target) {
                await db.insert(knowledgeEdges).values({
                    userId,
                    sourceNodeId: nodeId,
                    targetNodeId: target.id,
                    relationType: "menciona",
                    weight: 1,
                    metadata: { via: "inline_link" },
                }).onConflictDoNothing();
            }
        }
    }

    private async linkSimilarNodes(userId: string, nodeId: string, embedding?: number[]): Promise<void> {
        if (!embedding || embedding.length === 0) return;
        const embeddingStr = `[${embedding.join(",")}]`;
        const result = await dbRead.execute(sql`
      SELECT id, embedding <=> ${embeddingStr}::vector AS distance
      FROM knowledge_nodes
      WHERE user_id = ${userId}
        AND id <> ${nodeId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT 5
    `);

        const rows = result.rows as Array<{ id: string; distance: number }>;
        for (const row of rows) {
            if (row.distance > 0.3) continue; // similarity ~0.7+
            await db.insert(knowledgeEdges).values({
                userId,
                sourceNodeId: nodeId,
                targetNodeId: row.id,
                relationType: "relacionado",
                weight: 1,
                metadata: { distance: row.distance },
            }).onConflictDoNothing();
        }
    }

    async createNode(userId: string, payload: InsertKnowledgeNode): Promise<KnowledgeNode> {
        await this.initialize();
        const now = new Date();
        const normalizedSourceId = this.normalizeSourceId(payload.sourceId);
        const contentHash = this.buildContentHash(`${payload.title}\n${payload.content}`);

        if (normalizedSourceId) {
            const existingBySource = await dbRead.select()
                .from(knowledgeNodes)
                .where(and(
                    eq(knowledgeNodes.userId, userId),
                    eq(knowledgeNodes.sourceType, payload.sourceType || "manual"),
                    eq(knowledgeNodes.sourceId, normalizedSourceId)
                ))
                .limit(1);

            if (existingBySource.length > 0) {
                const node = existingBySource[0];
                await db.update(knowledgeNodes)
                    .set({ updatedAt: now })
                    .where(eq(knowledgeNodes.id, node.id));
                return node;
            }
        }

        const existing = await dbRead.select()
            .from(knowledgeNodes)
            .where(and(eq(knowledgeNodes.userId, userId), eq(knowledgeNodes.contentHash, contentHash)))
            .limit(1);

        if (existing.length > 0) {
            const node = existing[0];
            await db.update(knowledgeNodes)
                .set({ updatedAt: now })
                .where(eq(knowledgeNodes.id, node.id));
            return node;
        }

        const embedding = await generateEmbedding(`${payload.title}\n${payload.content}`);
        const zettelId = payload.zettelId || this.buildZettelId(now);

        const [node] = await db.insert(knowledgeNodes).values({
            userId,
            title: payload.title,
            content: payload.content,
            nodeType: payload.nodeType || "note",
            sourceType: payload.sourceType || "manual",
            sourceId: normalizedSourceId,
            tags: payload.tags || [],
            embedding,
            contentHash,
            metadata: payload.metadata || {},
            importance: payload.importance ?? 0.5,
            zettelId,
        }).onConflictDoNothing().returning();

        if (!node) {
            const fallback = normalizedSourceId
                ? await dbRead.select()
                    .from(knowledgeNodes)
                    .where(and(
                        eq(knowledgeNodes.userId, userId),
                        eq(knowledgeNodes.sourceType, payload.sourceType || "manual"),
                        eq(knowledgeNodes.sourceId, normalizedSourceId)
                    ))
                    .limit(1)
                : await dbRead.select()
                    .from(knowledgeNodes)
                    .where(and(eq(knowledgeNodes.userId, userId), eq(knowledgeNodes.contentHash, contentHash)))
                    .limit(1);

            if (!fallback[0]) {
                throw new Error("Failed to create knowledge node");
            }
            return fallback[0];
        }

        await this.indexInMeili(node);
        await this.linkReferencesFromContent(userId, node.id, node.content);
        await this.linkSimilarNodes(userId, node.id, embedding);

        return node;
    }

    async addEdge(userId: string, payload: InsertKnowledgeEdge): Promise<KnowledgeEdge | null> {
        await this.initialize();
        const [edge] = await db.insert(knowledgeEdges)
            .values({
                userId,
                sourceNodeId: payload.sourceNodeId,
                targetNodeId: payload.targetNodeId,
                relationType: payload.relationType,
                weight: payload.weight ?? 1,
                metadata: payload.metadata || {},
            })
            .onConflictDoNothing()
            .returning();
        return edge || null;
    }

    async getNode(userId: string, nodeId: string): Promise<KnowledgeNode | undefined> {
        await this.initialize();
        const [node] = await dbRead.select()
            .from(knowledgeNodes)
            .where(and(eq(knowledgeNodes.id, nodeId), eq(knowledgeNodes.userId, userId)))
            .limit(1);

        if (node) {
            await db.update(knowledgeNodes)
                .set({ accessCount: sql`${knowledgeNodes.accessCount} + 1`, lastAccessedAt: new Date() })
                .where(eq(knowledgeNodes.id, nodeId));
        }

        return node;
    }

    async listNodes(userId: string, options: { limit?: number; nodeTypes?: string[]; tags?: string[] } = {}): Promise<KnowledgeNode[]> {
        await this.initialize();
        const { limit = 50, nodeTypes, tags } = options;
        const conditions: any[] = [eq(knowledgeNodes.userId, userId)];
        if (nodeTypes && nodeTypes.length > 0) {
            conditions.push(inArray(knowledgeNodes.nodeType, nodeTypes));
        }
        if (tags && tags.length > 0) {
            conditions.push(sql`${knowledgeNodes.tags} && ${tags}`);
        }

        return dbRead.select()
            .from(knowledgeNodes)
            .where(and(...conditions))
            .orderBy(desc(knowledgeNodes.updatedAt))
            .limit(limit);
    }

    async search(userId: string, query: string, options: KnowledgeSearchOptions = {}): Promise<KnowledgeSearchResult[]> {
        await this.initialize();
        const { limit = 10, nodeTypes, tags, keywordWeight = 0.4, vectorWeight = 0.6 } = options;
        if (!query) return [];

        const sanitizedQuery = query.replace(/[^\w\sñáéíóúü]/gi, " ").trim();
        const results: KnowledgeSearchResult[] = [];

        if (sanitizedQuery) {
            const tsQuery = sql`websearch_to_tsquery('spanish', ${sanitizedQuery})`;
            const keywordRows = await dbRead
                .select({
                    node: knowledgeNodes,
                    rank: sql<number>`ts_rank(${knowledgeNodes.searchVector}, ${tsQuery})`.as("rank"),
                })
                .from(knowledgeNodes)
                .where(and(eq(knowledgeNodes.userId, userId), sql`${knowledgeNodes.searchVector} @@ ${tsQuery}`))
                .orderBy(sql`rank DESC`)
                .limit(limit);

            for (const row of keywordRows) {
                results.push({
                    node: row.node,
                    score: Number(row.rank) || 0,
                    matchType: "keyword",
                });
            }
        }

        const embedding = await generateEmbedding(query);
        const embeddingStr = `[${embedding.join(",")}]`;
        const vectorRows = await dbRead
            .select({
                node: knowledgeNodes,
                similarity: sql<number>`(1 / (1 + (${knowledgeNodes.embedding} <=> ${embeddingStr}::vector)))`.as("similarity"),
            })
            .from(knowledgeNodes)
            .where(and(eq(knowledgeNodes.userId, userId), sql`${knowledgeNodes.embedding} IS NOT NULL`))
            .orderBy(sql`${knowledgeNodes.embedding} <=> ${embeddingStr}::vector`)
            .limit(limit);

        for (const row of vectorRows) {
            results.push({
                node: row.node,
                score: Number(row.similarity) || 0,
                matchType: "vector",
            });
        }

        // Optional MeiliSearch enrichment (full-text)
        const meiliNodes = await this.searchInMeili(userId, query, limit);
        for (const node of meiliNodes) {
            results.push({ node, score: 0.3, matchType: "keyword" });
        }

        const filtered = results.filter(r => {
            if (nodeTypes && nodeTypes.length > 0 && !nodeTypes.includes(r.node.nodeType)) return false;
            if (tags && tags.length > 0 && !r.node.tags?.some(t => tags.includes(t))) return false;
            return true;
        });

        const aggregated = new Map<string, KnowledgeSearchResult>();
        for (const result of filtered) {
            const existing = aggregated.get(result.node.id);
            if (!existing) {
                aggregated.set(result.node.id, result);
            } else {
                const mergedScore = (existing.score * (existing.matchType === "vector" ? vectorWeight : keywordWeight)) +
                    (result.score * (result.matchType === "vector" ? vectorWeight : keywordWeight));
                aggregated.set(result.node.id, {
                    node: result.node,
                    score: mergedScore,
                    matchType: "hybrid",
                });
            }
        }

        return Array.from(aggregated.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    async getRelated(userId: string, nodeId: string): Promise<KnowledgeNode[]> {
        await this.initialize();
        const edges = await dbRead.select().from(knowledgeEdges)
            .where(and(eq(knowledgeEdges.userId, userId), or(eq(knowledgeEdges.sourceNodeId, nodeId), eq(knowledgeEdges.targetNodeId, nodeId))))
            .orderBy(desc(knowledgeEdges.createdAt));

        const relatedIds = new Set<string>();
        for (const edge of edges) {
            if (edge.sourceNodeId === nodeId) relatedIds.add(edge.targetNodeId);
            if (edge.targetNodeId === nodeId) relatedIds.add(edge.sourceNodeId);
        }

        if (relatedIds.size === 0) return [];
        return dbRead.select().from(knowledgeNodes)
            .where(and(eq(knowledgeNodes.userId, userId), inArray(knowledgeNodes.id, Array.from(relatedIds))));
    }

    async ingestChatMessage(params: {
        chatId: string;
        messageId: string;
        role: string;
        content: string;
    }): Promise<void> {
        await this.initialize();
        if (!this.ingestEnabled) return;
        const { chatId, messageId, role, content } = params;
        const [chat] = await dbRead.select({ userId: chats.userId })
            .from(chats)
            .where(eq(chats.id, chatId))
            .limit(1);

        if (!chat?.userId) return;

        const title = role === "user" ? "Mensaje del usuario" : "Respuesta del asistente";
        await this.createNode(chat.userId, {
            title,
            content,
            nodeType: "conversation",
            sourceType: "conversation",
            sourceId: messageId,
            metadata: { chatId, role },
        });
    }

    async ingestConversationDocument(params: {
        chatId: string;
        documentId: string;
        fileName: string;
        content: string;
    }): Promise<void> {
        await this.initialize();
        if (!this.ingestEnabled) return;
        const { chatId, documentId, fileName, content } = params;
        const [chat] = await dbRead.select({ userId: chats.userId })
            .from(chats)
            .where(eq(chats.id, chatId))
            .limit(1);

        if (!chat?.userId) return;

        await this.createNode(chat.userId, {
            title: fileName,
            content,
            nodeType: "document",
            sourceType: "document",
            sourceId: documentId,
            metadata: { chatId, fileName },
        });
    }

    async ingestWebSources(
        userId: string,
        query: string,
        sources: Array<{
            title?: string;
            url?: string;
            content?: string;
            snippet?: string;
            siteName?: string;
            publishedDate?: string;
        }>,
        options: { maxItems?: number; nodeType?: string; sourceType?: string } = {}
    ): Promise<void> {
        await this.initialize();
        if (!this.ingestEnabled || !this.ingestWebEnabled) return;
        if (!sources || sources.length === 0) return;

        const { maxItems = 3, nodeType = "web", sourceType = "web" } = options;
        const trimmedSources = sources.slice(0, maxItems);

        for (const source of trimmedSources) {
            const title = source.title || source.siteName || source.url || "Fuente web";
            const rawContent = source.content || source.snippet || "";
            const content = rawContent.length > 2000 ? rawContent.slice(0, 2000) : rawContent;
            if (!content.trim()) continue;

            await this.createNode(userId, {
                title,
                content,
                nodeType,
                sourceType,
                sourceId: this.normalizeSourceId(source.url || source.title || ""),
                tags: [sourceType],
                metadata: {
                    query,
                    url: source.url,
                    siteName: source.siteName,
                    publishedDate: source.publishedDate,
                },
            });
        }
    }

    async backfillUser(
        userId: string,
        options: { limit?: number; since?: string; includeDocuments?: boolean } = {}
    ): Promise<{ messages: number; documents: number }> {
        await this.initialize();
        if (!this.ingestEnabled) return { messages: 0, documents: 0 };

        const { limit = 200, since, includeDocuments = true } = options;
        const sinceDate = since ? new Date(since) : undefined;

        const messageConditions: any[] = [eq(chats.userId, userId)];
        if (sinceDate) {
            messageConditions.push(sql`${chatMessages.createdAt} >= ${sinceDate}`);
        }

        const messageRows = await dbRead
            .select({
                id: chatMessages.id,
                chatId: chatMessages.chatId,
                role: chatMessages.role,
                content: chatMessages.content,
            })
            .from(chatMessages)
            .innerJoin(chats, eq(chatMessages.chatId, chats.id))
            .where(and(...messageConditions))
            .orderBy(desc(chatMessages.createdAt))
            .limit(limit);

        let messagesIngested = 0;
        for (const row of messageRows) {
            const title = row.role === "user" ? "Mensaje del usuario" : "Respuesta del asistente";
            await this.createNode(userId, {
                title,
                content: row.content,
                nodeType: "conversation",
                sourceType: "conversation",
                sourceId: row.id,
                metadata: { chatId: row.chatId, role: row.role },
            });
            messagesIngested += 1;
        }

        let documentsIngested = 0;
        if (includeDocuments) {
            const docConditions: any[] = [eq(chats.userId, userId)];
            if (sinceDate) {
                docConditions.push(sql`${conversationDocuments.createdAt} >= ${sinceDate}`);
            }
            const documentRows = await dbRead
                .select({
                    id: conversationDocuments.id,
                    chatId: conversationDocuments.chatId,
                    fileName: conversationDocuments.fileName,
                    extractedText: conversationDocuments.extractedText,
                })
                .from(conversationDocuments)
                .innerJoin(chats, eq(conversationDocuments.chatId, chats.id))
                .where(and(...docConditions))
                .orderBy(desc(conversationDocuments.createdAt))
                .limit(limit);

            for (const doc of documentRows) {
                if (!doc.extractedText) continue;
                await this.createNode(userId, {
                    title: doc.fileName,
                    content: doc.extractedText,
                    nodeType: "document",
                    sourceType: "document",
                    sourceId: doc.id,
                    metadata: { chatId: doc.chatId, fileName: doc.fileName },
                });
                documentsIngested += 1;
            }
        }

        return { messages: messagesIngested, documents: documentsIngested };
    }

    async exportToObsidian(userId: string, options: KnowledgeExportOptions): Promise<{ exported: number; outputDir: string }> {
        await this.initialize();
        const safeOutput = resolveSafePath(options.outputDir, process.cwd());
        await fs.mkdir(safeOutput, { recursive: true });

        let nodes: KnowledgeNode[] = [];
        if (options.nodeIds && options.nodeIds.length > 0) {
            nodes = await dbRead.select().from(knowledgeNodes)
                .where(and(eq(knowledgeNodes.userId, userId), inArray(knowledgeNodes.id, options.nodeIds)));
        } else if (options.tags && options.tags.length > 0) {
            nodes = await dbRead.select().from(knowledgeNodes)
                .where(and(eq(knowledgeNodes.userId, userId), sql`${knowledgeNodes.tags} && ${options.tags}`));
        } else {
            nodes = await dbRead.select().from(knowledgeNodes)
                .where(eq(knowledgeNodes.userId, userId))
                .orderBy(desc(knowledgeNodes.updatedAt));
        }

        if (nodes.length === 0) return { exported: 0, outputDir: safeOutput };

        const missingZettel = nodes.filter(n => !n.zettelId);
        for (const node of missingZettel) {
            const zettelId = this.buildZettelId();
            await db.update(knowledgeNodes)
                .set({ zettelId })
                .where(eq(knowledgeNodes.id, node.id));
            node.zettelId = zettelId;
        }

        const nodeIds = nodes.map(n => n.id);
        const edges = await dbRead.select().from(knowledgeEdges)
            .where(and(eq(knowledgeEdges.userId, userId), or(inArray(knowledgeEdges.sourceNodeId, nodeIds), inArray(knowledgeEdges.targetNodeId, nodeIds))));

        const byId = new Map(nodes.map(n => [n.id, n]));
        const linksByNode = new Map<string, string[]>();

        for (const edge of edges) {
            const source = byId.get(edge.sourceNodeId);
            const target = byId.get(edge.targetNodeId);
            if (!source || !target) continue;
            const sourceLinks = linksByNode.get(source.id) || [];
            sourceLinks.push(`[[${target.zettelId}]]`);
            linksByNode.set(source.id, sourceLinks);
        }

        for (const node of nodes) {
            const fileName = `${node.zettelId}.md`;
            const filePath = path.join(safeOutput, fileName);
            const tags = node.tags && node.tags.length > 0 ? `[${node.tags.join(", ")}]` : "[]";
            const frontMatter = [
                "---",
                `id: ${node.zettelId}`,
                `title: ${node.title}`,
                `type: ${node.nodeType}`,
                `source_type: ${node.sourceType}`,
                node.sourceId ? `source_id: ${node.sourceId}` : "source_id:",
                `tags: ${tags}`,
                `created_at: ${node.createdAt.toISOString()}`,
                `updated_at: ${node.updatedAt.toISOString()}`,
                "---",
                ""
            ].join("\n");

            const links = linksByNode.get(node.id) || [];
            const linksSection = links.length > 0 ? `\n\n## Links\n${links.join("\n")}` : "";
            const body = `# ${node.title}\n\n${node.content}${linksSection}\n`;

            await fs.writeFile(filePath, `${frontMatter}${body}`, "utf8");
        }

        return { exported: nodes.length, outputDir: safeOutput };
    }

    async buildContext(userId: string, query: string, limit = 5): Promise<string> {
        const results = await this.search(userId, query, { limit });
        if (results.length === 0) return "";
        const lines = results.map((r, idx) => {
            const excerpt = r.node.content.length > 200 ? `${r.node.content.slice(0, 200)}...` : r.node.content;
            return `${idx + 1}. ${r.node.title} (${r.node.zettelId || r.node.id}): ${excerpt}`;
        });
        return `\n\n[Knowledge Base]\n${lines.join("\n")}\n`;
    }
}

export const knowledgeBaseService = new KnowledgeBaseService();
