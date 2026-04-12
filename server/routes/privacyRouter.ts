import { Router } from "express";
import { z } from "zod";
import JSZip from "jszip";
import { storage } from "../storage";
import { db } from "../db";
import { getUserId } from "../types/express";
import { validateBody } from "../middleware/validateRequest";
import { invalidateUserPrivacySettingsCache } from "../services/privacyService";
import {
  chats,
  chatMessages,
  conversationDocuments,
  agentMemoryStore,
  consentLogs,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

const updatePrivacySchema = z.object({
  trainingOptIn: z.boolean().optional(),
  remoteBrowserDataAccess: z.boolean().optional(),
  analyticsTracking: z.boolean().optional(),
  chatHistoryEnabled: z.boolean().optional(),
});

export function createPrivacyRouter() {
  const router = Router();

  /**
   * GET /api/settings/privacy — current privacy preferences
   */
  router.get("/api/settings/privacy", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId || userId.startsWith("anon_"))
        return res.status(401).json({ error: "Unauthorized" });

      const settings = await storage.getUserSettings(userId);
      const logs = await db
        .select()
        .from(consentLogs)
        .where(eq(consentLogs.userId, userId))
        .orderBy(desc(consentLogs.createdAt))
        .limit(10);

      const defaults = {
        trainingOptIn: false,
        remoteBrowserDataAccess: false,
        analyticsTracking: true,
        chatHistoryEnabled: true,
      };

      res.json({
        privacySettings: { ...defaults, ...(settings?.privacySettings || {}) },
        consentHistory: logs,
      });
    } catch (error) {
      console.error("[Privacy] Error getting settings:", error);
      res.status(500).json({ error: "Failed to get privacy settings" });
    }
  });

  /**
   * PUT /api/settings/privacy — update privacy preferences
   */
  router.put(
    "/api/settings/privacy",
    validateBody(updatePrivacySchema),
    async (req, res) => {
      try {
        const userId = getUserId(req);
        if (!userId || userId.startsWith("anon_"))
          return res.status(401).json({ error: "Unauthorized" });

        const { trainingOptIn, remoteBrowserDataAccess, analyticsTracking, chatHistoryEnabled } =
          req.body;

        if (
          trainingOptIn === undefined &&
          remoteBrowserDataAccess === undefined &&
          analyticsTracking === undefined &&
          chatHistoryEnabled === undefined
        ) {
          return res.status(400).json({ error: "No valid privacy fields provided" });
        }

        const existing = await storage.getUserSettings(userId);
        const currentPrivacy = {
          trainingOptIn: false,
          remoteBrowserDataAccess: false,
          analyticsTracking: true,
          chatHistoryEnabled: true,
          ...(existing?.privacySettings || {}),
        };

        const ipAddress = req.ip || (req.headers["x-forwarded-for"] as string)?.split(",")[0] || undefined;
        const userAgent = req.headers["user-agent"] || undefined;

        // Log consent changes
        const consentEntries: Array<{ type: string; value: string }> = [];
        if (trainingOptIn !== undefined && trainingOptIn !== currentPrivacy.trainingOptIn) {
          consentEntries.push({ type: "training_opt_in", value: String(trainingOptIn) });
        }
        if (remoteBrowserDataAccess !== undefined && remoteBrowserDataAccess !== currentPrivacy.remoteBrowserDataAccess) {
          consentEntries.push({ type: "remote_browser_access", value: String(remoteBrowserDataAccess) });
        }
        if (analyticsTracking !== undefined && analyticsTracking !== currentPrivacy.analyticsTracking) {
          consentEntries.push({ type: "analytics_tracking", value: String(analyticsTracking) });
        }
        if (chatHistoryEnabled !== undefined && chatHistoryEnabled !== currentPrivacy.chatHistoryEnabled) {
          consentEntries.push({ type: "chat_history_enabled", value: String(chatHistoryEnabled) });
        }

        for (const entry of consentEntries) {
          await storage.logConsent(userId, entry.type, entry.value, ipAddress, userAgent);
        }

        const updates: Partial<{
          trainingOptIn: boolean;
          remoteBrowserDataAccess: boolean;
          analyticsTracking: boolean;
          chatHistoryEnabled: boolean;
        }> = {};
        if (trainingOptIn !== undefined) updates.trainingOptIn = trainingOptIn;
        if (remoteBrowserDataAccess !== undefined) updates.remoteBrowserDataAccess = remoteBrowserDataAccess;
        if (analyticsTracking !== undefined) updates.analyticsTracking = analyticsTracking;
        if (chatHistoryEnabled !== undefined) updates.chatHistoryEnabled = chatHistoryEnabled;

        const settings = await storage.upsertUserSettings(userId, {
          privacySettings: updates as any,
        });

        invalidateUserPrivacySettingsCache(userId);

        res.json({
          success: true,
          privacySettings: {
            ...currentPrivacy,
            ...updates,
          },
        });
      } catch (error) {
        console.error("[Privacy] Error updating settings:", error);
        res.status(500).json({ error: "Failed to update privacy settings" });
      }
    }
  );

  /**
   * POST /api/settings/clear-history — delete all chats & messages
   */
  router.post("/api/settings/clear-history", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId || userId.startsWith("anon_"))
        return res.status(401).json({ error: "Unauthorized" });

      const count = await storage.softDeleteAllChats(userId);

      // Revoke shared links for chats
      const links = await storage.getSharedLinks(userId);
      for (const link of links) {
        if (link.resourceType === "chat") {
          await storage.revokeSharedLink(link.id);
        }
      }

      // Audit log
      await storage.createAuditLog({
        action: "clear_chat_history",
        resource: "chats",
        resourceId: userId,
        details: { count, clearedAt: new Date().toISOString() },
      });

      res.json({ success: true, count });
    } catch (error) {
      console.error("[Privacy] Error clearing history:", error);
      res.status(500).json({ error: "Failed to clear history" });
    }
  });

  /**
   * GET /api/settings/export-data — GDPR data export as ZIP
   *
   * Generates a ZIP archive containing:
   *   profile.json, chats.json, messages.json, documents.json,
   *   memories.json, usage.json, settings.json
   */
  router.get("/api/settings/export-data", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId)
        return res.status(401).json({ error: "Authentication required" });

      const user = await storage.getUser(userId);
      if (!user)
        return res.status(404).json({ error: "User not found" });

      const userSettings = await storage.getUserSettings(userId);

      // ── Collect data in parallel ──
      const userChats = await storage.getChats(userId);

      const allMessages: any[] = [];
      // Limit to 500 chats to avoid memory issues on very large accounts
      for (const chat of userChats.slice(0, 500)) {
        const msgs = await storage.getChatMessages(chat.id, { orderBy: "asc" });
        allMessages.push(
          ...msgs.map((m) => ({
            id: m.id,
            chatId: m.chatId,
            role: m.role,
            content: m.content,
            model: (m as any).model || null,
            createdAt: m.createdAt,
          }))
        );
      }

      // Documents attached to user's chats
      const chatIds = userChats.map((c) => c.id);
      let docs: any[] = [];
      if (chatIds.length > 0) {
        // Batch fetch in chunks of 100
        for (let i = 0; i < chatIds.length; i += 100) {
          const batch = chatIds.slice(i, i + 100);
          for (const cid of batch) {
            const chatDocs = await storage.getConversationDocuments(cid);
            docs.push(
              ...chatDocs.map((d) => ({
                id: d.id,
                chatId: d.chatId,
                fileName: d.fileName,
                mimeType: d.mimeType,
                fileSize: d.fileSize,
                createdAt: d.createdAt,
              }))
            );
          }
        }
      }

      // Agent memory store entries for this user
      let memories: any[] = [];
      try {
        const memRows = await db
          .select()
          .from(agentMemoryStore)
          .where(eq(agentMemoryStore.userId, userId))
          .limit(5000);
        memories = memRows.map((m) => ({
          id: m.id,
          key: m.memoryKey,
          value: m.memoryValue,
          type: m.memoryType,
          createdAt: m.createdAt,
        }));
      } catch {
        // Table might not exist in all environments
      }

      // Remove sensitive fields from profile
      const { password, totpSecret, ...safeUser } = user as any;

      // ── Build ZIP ──
      const zip = new JSZip();
      const exportMeta = {
        exportedAt: new Date().toISOString(),
        format: "IliaGPT Data Export v2.0",
        gdprCompliant: true,
        userId: userId.slice(0, 8) + "...",
        totalFiles: 7,
      };

      zip.file("README.txt", [
        "IliaGPT - Exportación de datos personales",
        "==========================================",
        "",
        `Fecha de exportación: ${exportMeta.exportedAt}`,
        `Formato: ${exportMeta.format}`,
        "",
        "Archivos incluidos:",
        "  - profile.json     → Datos de tu cuenta y perfil",
        "  - chats.json       → Lista de todas tus conversaciones",
        "  - messages.json    → Todos los mensajes de tus conversaciones",
        "  - documents.json   → Documentos adjuntos y generados",
        "  - memories.json    → Memorias y contexto del agente",
        "  - usage.json       → Estadísticas de uso",
        "  - settings.json    → Configuración y preferencias",
        "",
        "Este archivo cumple con el Reglamento General de Protección de Datos (GDPR/RGPD).",
        "Para más información, contacta a privacy@iliagpt.io",
      ].join("\n"));

      zip.file("profile.json", JSON.stringify({
        id: safeUser.id,
        email: safeUser.email,
        fullName: safeUser.fullName,
        username: safeUser.username,
        profileImageUrl: safeUser.profileImageUrl,
        role: safeUser.role,
        tier: safeUser.tier,
        status: safeUser.status,
        locale: safeUser.locale,
        timezone: safeUser.timezone,
        createdAt: safeUser.createdAt,
        lastLoginAt: safeUser.lastLoginAt,
      }, null, 2));

      zip.file("chats.json", JSON.stringify(
        userChats.map((c) => ({
          id: c.id,
          title: c.title,
          model: (c as any).model || null,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
        null,
        2
      ));

      zip.file("messages.json", JSON.stringify(allMessages, null, 2));

      zip.file("documents.json", JSON.stringify(docs, null, 2));

      zip.file("memories.json", JSON.stringify(memories, null, 2));

      zip.file("usage.json", JSON.stringify({
        totalChats: userChats.length,
        totalMessages: allMessages.length,
        totalDocuments: docs.length,
        totalMemories: memories.length,
        tokensConsumed: (user as any).tokensConsumed || 0,
        queryCount: (user as any).queryCount || 0,
        accountCreated: safeUser.createdAt,
        lastActive: safeUser.lastLoginAt,
      }, null, 2));

      zip.file("settings.json", JSON.stringify({
        preferences: (user as any).preferences || {},
        privacySettings: userSettings?.privacySettings || {},
        responsePreferences: userSettings?.responsePreferences || {},
        featureFlags: userSettings?.featureFlags || {},
      }, null, 2));

      // Generate ZIP buffer
      const zipBuffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `iliagpt-export-${timestamp}.zip`;

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(zipBuffer.length));
      res.send(zipBuffer);

      // Audit
      await storage.createAuditLog({
        action: "data_export",
        resource: "users",
        resourceId: userId,
        details: {
          format: "zip",
          exportedAt: exportMeta.exportedAt,
          totalChats: userChats.length,
          totalMessages: allMessages.length,
        },
      });
    } catch (error) {
      console.error("[Privacy] Export error:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  /**
   * DELETE /api/settings/delete-account — soft-delete account (GDPR right to erasure)
   */
  router.delete("/api/settings/delete-account", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId)
        return res.status(401).json({ error: "Authentication required" });

      const { confirmation } = req.body;
      if (confirmation !== "DELETE_MY_ACCOUNT") {
        return res.status(400).json({
          error: 'Confirm deletion by sending: { confirmation: "DELETE_MY_ACCOUNT" }',
        });
      }

      // Soft delete user
      await storage.updateUser(userId, {
        status: "deleted",
        email: `deleted-${userId}@deleted.local`,
        phone: null,
        fullName: "Deleted User",
      });

      // Soft delete all chats
      await storage.softDeleteAllChats(userId);

      // Audit log
      await storage.createAuditLog({
        action: "account_deletion",
        resource: "users",
        resourceId: userId,
        details: {
          deletedAt: new Date().toISOString(),
          method: "user_request",
        },
      });

      res.json({
        success: true,
        message: "Account deleted. Data will be permanently removed within 30 days.",
      });
    } catch (error) {
      console.error("[Privacy] Delete account error:", error);
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  return router;
}
