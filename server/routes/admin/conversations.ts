import { Router } from "express";
import { storage } from "../../storage";
import { db } from "../../db";
import { users, chats, chatMessages } from "@shared/schema";
import { eq, desc, and, gte, lte, ilike, sql, inArray } from "drizzle-orm";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { getAdminUserAggregateSnapshot } from "../../services/adminProjection";

export const conversationsRouter = Router();

conversationsRouter.get("/", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "20",
            userId,
            status,
            flagStatus,
            aiModel,
            dateFrom,
            dateTo,
            minTokens,
            maxTokens,
            sortBy = "createdAt",
            sortOrder = "desc"
        } = req.query;

        const pageNum = parseInt(page as string);
        const limitNum = Math.min(parseInt(limit as string), 100);
        const offset = (pageNum - 1) * limitNum;

        const conditions: any[] = [];

        if (userId) conditions.push(eq(chats.userId, userId as string));
        if (status) conditions.push(eq(chats.conversationStatus, status as string));
        if (flagStatus) conditions.push(eq(chats.flagStatus, flagStatus as string));
        if (aiModel) conditions.push(eq(chats.aiModelUsed, aiModel as string));
        if (dateFrom) conditions.push(gte(chats.createdAt, new Date(dateFrom as string)));
        if (dateTo) conditions.push(lte(chats.createdAt, new Date(dateTo as string)));
        if (minTokens) conditions.push(gte(chats.tokensUsed, parseInt(minTokens as string)));
        if (maxTokens) conditions.push(lte(chats.tokensUsed, parseInt(maxTokens as string)));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const sortColumnMap: Record<string, any> = {
            createdAt: chats.createdAt,
            messageCount: chats.messageCount,
            tokensUsed: chats.tokensUsed,
            aiModelUsed: chats.aiModelUsed,
            conversationStatus: chats.conversationStatus,
            lastMessageAt: chats.lastMessageAt
        };
        const sortColumn = sortColumnMap[sortBy as string] || chats.createdAt;
        const orderClause = sortOrder === "asc" ? sortColumn : desc(sortColumn);

        const [conversationsResult, totalResult] = await Promise.all([
            db.select({
                id: chats.id,
                userId: chats.userId,
                title: chats.title,
                messageCount: chats.messageCount,
                tokensUsed: chats.tokensUsed,
                aiModelUsed: chats.aiModelUsed,
                conversationStatus: chats.conversationStatus,
                flagStatus: chats.flagStatus,
                createdAt: chats.createdAt,
                lastMessageAt: chats.lastMessageAt,
                endedAt: chats.endedAt
            })
                .from(chats)
                .where(whereClause)
                .orderBy(orderClause)
                .limit(limitNum)
                .offset(offset),
            db.select({ count: sql<number>`count(*)` }).from(chats).where(whereClause)
        ]);

        const userIds = [...new Set(conversationsResult.map(c => c.userId).filter(Boolean))];
        const usersMap: Record<string, any> = {};
        if (userIds.length > 0) {
            const usersData = await db.select({ id: users.id, email: users.email, fullName: users.fullName, firstName: users.firstName, lastName: users.lastName })
                .from(users)
                .where(inArray(users.id, userIds as string[]));
            usersData.forEach(u => { usersMap[u.id] = u; });
        }

        const conversationsWithUsers = conversationsResult.map(c => ({
            ...c,
            user: c.userId ? usersMap[c.userId] : null
        }));

        res.json({
            data: conversationsWithUsers,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: Number(totalResult[0]?.count || 0),
                totalPages: Math.ceil(Number(totalResult[0]?.count || 0) / limitNum)
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

conversationsRouter.get("/stats/summary", async (req, res) => {
    try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const [
            totalConversations,
            activeToday,
            flaggedConversations,
            tokensToday,
            allConversations
        ] = await Promise.all([
            db.select({ count: sql<number>`count(*)` }).from(chats),
            db.select({ count: sql<number>`count(*)` })
                .from(chats)
                .where(gte(chats.lastMessageAt, todayStart)),
            db.select({ count: sql<number>`count(*)` })
                .from(chats)
                .where(eq(chats.conversationStatus, "flagged")),
            db.select({ sum: sql<number>`coalesce(sum(tokens_used), 0)` })
                .from(chats)
                .where(gte(chats.createdAt, todayStart)),
            db.select({
                messageCount: chats.messageCount
            }).from(chats)
        ]);

        const userAggregate = await getAdminUserAggregateSnapshot();
        const totalMessages = allConversations.reduce((sum, c) => sum + (c.messageCount || 0), 0);
        const avgMessagesPerUser = userAggregate.totalUsers > 0 ? Math.round(totalMessages / userAggregate.totalUsers) : 0;
        const totalConvCount = Number(totalConversations[0]?.count || 0);
        const avgMessagesPerConversation = totalConvCount > 0 ? Math.round(totalMessages / totalConvCount) : 0;

        res.json({
            activeToday: Number(activeToday[0]?.count || 0),
            avgMessagesPerUser,
            avgMessagesPerConversation,
            tokensConsumedToday: Number(tokensToday[0]?.sum || 0),
            flaggedConversations: Number(flaggedConversations[0]?.count || 0),
            totalConversations: totalConvCount
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Export endpoint - Must be defined BEFORE /:id to avoid collision
conversationsRouter.get("/export", async (req, res) => {
    try {
        const { format = "json", includeMessages = "false" } = req.query;

        const allConversations = await db.select().from(chats).orderBy(desc(chats.createdAt)).limit(1000);

        let result: any[] = allConversations;

        if (includeMessages === "true") {
            const conversationsWithMessages = await Promise.all(
                allConversations.map(async (conv) => {
                    const messages = await db.select({
                        role: chatMessages.role,
                        content: chatMessages.content,
                        createdAt: chatMessages.createdAt
                    })
                        .from(chatMessages)
                        .where(eq(chatMessages.chatId, conv.id))
                        .orderBy(chatMessages.createdAt);
                    return { ...conv, messages };
                })
            );
            result = conversationsWithMessages;
        }

        if (format === "csv") {
            const headers = ["id", "userId", "title", "messageCount", "tokensUsed", "aiModelUsed", "conversationStatus", "flagStatus", "createdAt"];
            const csvRows = [headers.join(",")];
            result.forEach(c => {
                csvRows.push([
                    c.id,
                    c.userId || "",
                    c.title || "",
                    c.messageCount || 0,
                    c.tokensUsed || 0,
                    c.aiModelUsed || "",
                    c.conversationStatus || "",
                    c.flagStatus || "",
                    c.createdAt?.toISOString() || ""
                ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
            });
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", `attachment; filename=conversations_${Date.now()}.csv`);
            res.send(csvRows.join("\n"));
        } else {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=conversations_${Date.now()}.json`);
            res.json(result);
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

conversationsRouter.get("/:id", async (req, res) => {
    try {
        const [conversation] = await db.select().from(chats).where(eq(chats.id, req.params.id));
        if (!conversation) {
            return res.status(404).json({ error: "Conversation not found" });
        }

        const messages = await db.select({
            id: chatMessages.id,
            role: chatMessages.role,
            content: chatMessages.content,
            createdAt: chatMessages.createdAt,
            metadata: chatMessages.metadata
        })
            .from(chatMessages)
            .where(eq(chatMessages.chatId, req.params.id))
            .orderBy(chatMessages.createdAt);

        let user = null;
        if (conversation.userId) {
            const [userData] = await db.select().from(users).where(eq(users.id, conversation.userId));
            user = userData;
        }

        res.json({
            ...conversation,
            user,
            messages
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

conversationsRouter.patch("/:id/flag", async (req, res) => {
    try {
        const { flagStatus } = req.body;
        const validFlags = ["reviewed", "needs_attention", "spam", "vip_support", null];
        if (!validFlags.includes(flagStatus)) {
            return res.status(400).json({ error: "Invalid flag status" });
        }

        const [updated] = await db.update(chats)
            .set({
                flagStatus,
                conversationStatus: flagStatus ? "flagged" : "active",
                updatedAt: new Date()
            })
            .where(eq(chats.id, req.params.id))
            .returning();

        if (!updated) {
            return res.status(404).json({ error: "Conversation not found" });
        }

        await auditLog(req, {
            action: "chat.flagged",
            resource: "chats",
            resourceId: req.params.id,
            details: { flagStatus, flaggedBy: (req as any).user?.email },
            category: "admin",
            severity: "warning"
        });

        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

conversationsRouter.post("/search", async (req, res) => { // Updated path to be relative to mounted path
    try {
        const { query, limit = 50 } = req.body;
        if (!query || query.length < 2) {
            return res.json({ results: [] });
        }

        const matchingMessages = await db.select({
            chatId: chatMessages.chatId,
            content: chatMessages.content,
            role: chatMessages.role,
            createdAt: chatMessages.createdAt
        })
            .from(chatMessages)
            .where(ilike(chatMessages.content, `%${query}%`))
            .limit(parseInt(limit as string));

        const chatIds = [...new Set(matchingMessages.map(m => m.chatId))];
        if (chatIds.length === 0) {
            return res.json({ results: [] });
        }

        const conversations = await db.select().from(chats).where(inArray(chats.id, chatIds));

        res.json({
            results: conversations.map(c => ({
                ...c,
                matchingMessages: matchingMessages.filter(m => m.chatId === c.id)
            }))
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

conversationsRouter.post("/:id/notes", async (req, res) => {
    try {
        // Feature disabled pending schema migration for internalNotes column
        // const { note } = req.body;
        // ... implementation commented out ...
        res.status(501).json({ error: "Internal notes feature pending schema update" });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/conversations/:id/archive - Archive a conversation
conversationsRouter.post("/:id/archive", async (req, res) => {
    try {
        const [updated] = await db.update(chats)
            .set({
                conversationStatus: "archived",
                endedAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(chats.id, req.params.id))
            .returning();

        if (!updated) {
            return res.status(404).json({ error: "Conversation not found" });
        }

        await auditLog(req, {
            action: "chat.archived",
            resource: "chats",
            resourceId: req.params.id,
            details: { archivedBy: (req as any).user?.email },
            category: "admin",
            severity: "info"
        });

        res.json({ success: true, conversation: updated });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/conversations/:id/unarchive - Unarchive a conversation
conversationsRouter.post("/:id/unarchive", async (req, res) => {
    try {
        const [updated] = await db.update(chats)
            .set({
                conversationStatus: "active",
                endedAt: null,
                updatedAt: new Date()
            })
            .where(eq(chats.id, req.params.id))
            .returning();

        if (!updated) {
            return res.status(404).json({ error: "Conversation not found" });
        }

        await storage.createAuditLog({
            action: "conversation_unarchive",
            resource: "chats",
            resourceId: req.params.id
        });

        res.json({ success: true, conversation: updated });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/admin/conversations/:id - Delete a conversation
conversationsRouter.delete("/:id", async (req, res) => {
    try {
        // Get conversation info before deletion for audit
        const [existing] = await db.select()
            .from(chats)
            .where(eq(chats.id, req.params.id))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ error: "Conversation not found" });
        }

        // First delete all messages
        const deletedMessages = await db.delete(chatMessages).where(eq(chatMessages.chatId, req.params.id));
        
        // Then delete the chat
        const [deleted] = await db.delete(chats)
            .where(eq(chats.id, req.params.id))
            .returning();

        await auditLog(req, {
            action: AuditActions.CONVERSATION_DELETED,
            resource: "chats",
            resourceId: req.params.id,
            details: {
                title: existing.title,
                userId: existing.userId,
                messageCount: existing.messageCount,
                deletedBy: (req as any).user?.email
            },
            category: "admin",
            severity: "warning"
        });

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
