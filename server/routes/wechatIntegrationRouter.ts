import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { getUserId } from "../types/express";
import { integrationAccounts } from "@shared/schema";
import { createChannelPairingCode } from "../channels/channelStore";
import { ensureIntegrationCatalogSeeded } from "../services/integrationCatalog";
import { extractRuntimeSettings, runtimeSettingsUpdateSchema, withRuntimeSettingsMetadata } from "../channels/runtimeConfigHttp";

const configSchema = z
  .object({
    appId: z.string().min(1),
    appSecret: z.string().min(1),
  })
  .strict();

const pairingRequestSchema = z
  .object({
    ttlMinutes: z.number().int().min(1).max(60).optional(),
    appId: z.string().min(1).optional(),
  })
  .strict();

function wechatPairingPayload(code: string, appId?: string) {
  const payload = `Asocia este chat de WeChat con el código: ${code}`;
  const deeplink = appId
    ? `weixin://dl/business/?appid=${encodeURIComponent(appId)}&text=${encodeURIComponent(code)}`
    : null;

  return {
    code,
    deeplink,
    qrPayload: payload,
    qrHint: "Abre el canal oficial de WeChat y envía el texto para completar la vinculación",
  };
}

export function createWeChatIntegrationRouter(): Router {
  const router = Router();

  router.post("/config", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    await ensureIntegrationCatalogSeeded().catch(() => null);

    const { appId, appSecret } = parsed.data;
    const now = new Date();

    const [existing] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, "wechat"),
          sql`${integrationAccounts.metadata} ->> 'appId' = ${appId}`,
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(integrationAccounts)
        .set({
          accessToken: appSecret,
          status: "active",
          metadata: {
            ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
            appId,
          },
          updatedAt: now,
        })
        .where(eq(integrationAccounts.id, existing.id));

      return res.json({ success: true, updated: true });
    }

    await db.insert(integrationAccounts).values({
      userId,
      providerId: "wechat",
      displayName: "WeChat Official Account",
      accessToken: appSecret,
      status: "active",
      metadata: { appId },
      updatedAt: now,
    });

    return res.json({ success: true, created: true });
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
      channel: "wechat",
      ttlMinutes: parsed.data.ttlMinutes,
    });
    const payload = wechatPairingPayload(code, parsed.data.appId);

    return res.json({
      success: true,
      channel: "wechat",
      code: payload.code,
      expiresAt: expiresAt.toISOString(),
      deeplink: payload.deeplink,
      qrPayload: payload.qrPayload,
      qrHint: payload.qrHint,
    });
  });

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
      .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.providerId, "wechat")));

    return res.json({ success: true, accounts });
  });

  router.get("/settings", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const appId = typeof req.query.appId === "string" ? req.query.appId : "";
    if (!appId) return res.status(400).json({ error: "appId is required" });

    const [account] = await db
      .select({ metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(and(
        eq(integrationAccounts.userId, userId),
        eq(integrationAccounts.providerId, "wechat"),
        sql`${integrationAccounts.metadata} ->> 'appId' = ${appId}`,
      ))
      .limit(1);

    return res.json({ success: true, settings: extractRuntimeSettings(account?.metadata) });
  });

  router.put("/settings", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const appId = typeof req.body?.appId === "string" ? req.body.appId : "";
    if (!appId) return res.status(400).json({ error: "appId is required" });

    const rawSettings = req.body?.settings ?? (({ appId: _omit, ...rest }: any) => rest)(req.body ?? {});
    const parsed = runtimeSettingsUpdateSchema.safeParse(rawSettings);
    if (!parsed.success) return res.status(400).json({ error: "Invalid settings", details: parsed.error.message });

    const [account] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(and(
        eq(integrationAccounts.userId, userId),
        eq(integrationAccounts.providerId, "wechat"),
        sql`${integrationAccounts.metadata} ->> 'appId' = ${appId}`,
      ))
      .limit(1);

    if (!account) return res.status(404).json({ error: "Integration account not found" });

    const mergedMetadata = withRuntimeSettingsMetadata(account.metadata, parsed.data);
    await db.update(integrationAccounts)
      .set({ metadata: mergedMetadata, updatedAt: new Date() })
      .where(eq(integrationAccounts.id, account.id));

    return res.json({ success: true, settings: extractRuntimeSettings(mergedMetadata) });
  });

  router.post("/disconnect", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = z.object({ appId: z.string().min(1) }).strict().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    const now = new Date();
    await db
      .update(integrationAccounts)
      .set({ status: "inactive", updatedAt: now })
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, "wechat"),
          sql`${integrationAccounts.metadata} ->> 'appId' = ${parsed.data.appId}`,
        ),
      );

    return res.json({ success: true });
  });

  return router;
}
