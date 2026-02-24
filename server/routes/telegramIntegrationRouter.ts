import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { getUserId } from "../types/express";
import { integrationAccounts } from "@shared/schema";
import { createChannelPairingCode } from "../channels/channelStore";
import { telegramSetWebhook } from "../channels/telegram/telegramApi";
import { ensureIntegrationCatalogSeeded } from "../services/integrationCatalog";
import { Logger } from "../lib/logger";
import { extractRuntimeSettings, runtimeSettingsUpdateSchema, withRuntimeSettingsMetadata } from "../channels/runtimeConfigHttp";

const pairingRequestSchema = z
  .object({
    ttlMinutes: z.number().int().min(1).max(60).optional(),
  })
  .strict();

const configSchema = z
  .object({
    botToken: z.string().min(1),
    webhookUrl: z.string().optional(),
  })
  .strict();

export function createTelegramIntegrationRouter(): Router {
  const router = Router();

  router.get("/status", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const accounts = await db
      .select({
        id: integrationAccounts.id,
        providerId: integrationAccounts.providerId,
        displayName: integrationAccounts.displayName,
        status: integrationAccounts.status,
        metadata: integrationAccounts.metadata,
        createdAt: integrationAccounts.createdAt,
        updatedAt: integrationAccounts.updatedAt,
      })
      .from(integrationAccounts)
      .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.providerId, "telegram")));

    return res.json({ success: true, accounts });
  });

  router.post("/pairing-code", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = pairingRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    const { code, expiresAt } = await createChannelPairingCode({
      userId,
      channel: "telegram",
      ttlMinutes: parsed.data.ttlMinutes,
    });

    const qrPayload = `Usa el código: ${code}`;
    return res.json({
      success: true,
      code,
      expiresAt: expiresAt.toISOString(),
      channel: "telegram",
      deeplink: `https://t.me/share/url?text=${encodeURIComponent(qrPayload)}`,
      qrPayload,
      qrHint: "Comparte este mensaje al bot para iniciar la verificación",
    });
  });

  router.post("/config", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    await ensureIntegrationCatalogSeeded().catch(() => null);

    const { botToken, webhookUrl } = parsed.data;
    const now = new Date();

    const [existing] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, "telegram"),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(integrationAccounts)
        .set({
          accessToken: botToken,
          status: "active",
          metadata: {
            ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
            webhookUrl: webhookUrl || null,
          },
          updatedAt: now,
        })
        .where(eq(integrationAccounts.id, existing.id));
    } else {
      await db.insert(integrationAccounts).values({
        userId,
        providerId: "telegram",
        displayName: "Telegram Bot",
        accessToken: botToken,
        status: "active",
        metadata: { webhookUrl: webhookUrl || null },
        updatedAt: now,
      });
    }

    if (webhookUrl) {
      try {
        await telegramSetWebhook({ webhookUrl, botToken });
      } catch (err) {
        Logger.error("[Telegram] Failed to set webhook", err);
        return res.json({ success: true, webhookSet: false, webhookError: String(err) });
      }
    }

    return res.json({ success: true, webhookSet: !!webhookUrl });
  });

  router.get("/settings", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const [account] = await db
      .select({ metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.providerId, "telegram")))
      .limit(1);

    return res.json({ success: true, settings: extractRuntimeSettings(account?.metadata) });
  });

  router.put("/settings", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = runtimeSettingsUpdateSchema.safeParse(req.body?.settings ?? req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid settings", details: parsed.error.message });

    const [account] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.providerId, "telegram")))
      .limit(1);

    if (!account) return res.status(404).json({ error: "Integration account not found" });

    const mergedMetadata = withRuntimeSettingsMetadata(account.metadata, parsed.data);
    await db.update(integrationAccounts)
      .set({ metadata: mergedMetadata, updatedAt: new Date() })
      .where(eq(integrationAccounts.id, account.id));

    return res.json({ success: true, settings: extractRuntimeSettings(mergedMetadata) });
  });

  return router;
}
