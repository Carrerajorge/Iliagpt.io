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
    pageId: z.string().min(1),
    accessToken: z.string().min(1),
  })
  .strict();

const pairingRequestSchema = z
  .object({
    ttlMinutes: z.number().int().min(1).max(60).optional(),
    pageId: z.string().min(1).optional(),
  })
  .strict();

function messengerPairingPayload(code: string, pageId?: string) {
  const payload = `Mi canal de Messenger está listo para vincularte. Código: ${code}`;
  const deeplink = pageId
    ? `https://m.me/${encodeURIComponent(pageId)}?ref=${encodeURIComponent(code)}`
    : null;

  return {
    code,
    deeplink,
    qrPayload: payload,
    qrHint: "Comparte este texto en Messenger y escribe el código de vinculación",
  };
}

export function createMessengerIntegrationRouter(): Router {
  const router = Router();

  router.post("/config", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    await ensureIntegrationCatalogSeeded().catch(() => null);

    const { pageId, accessToken } = parsed.data;
    const now = new Date();

    const [existing] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, "messenger"),
          sql`${integrationAccounts.metadata} ->> 'pageId' = ${pageId}`,
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(integrationAccounts)
        .set({
          accessToken,
          status: "active",
          metadata: {
            ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
            pageId,
          },
          updatedAt: now,
        })
        .where(eq(integrationAccounts.id, existing.id));

      return res.json({ success: true, updated: true });
    }

    await db.insert(integrationAccounts).values({
      userId,
      providerId: "messenger",
      displayName: "Messenger",
      accessToken,
      status: "active",
      metadata: { pageId },
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
      channel: "messenger",
      ttlMinutes: parsed.data.ttlMinutes,
    });
    const payload = messengerPairingPayload(code, parsed.data.pageId);

    return res.json({
      success: true,
      channel: "messenger",
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
      .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.providerId, "messenger")));

    return res.json({ success: true, accounts });
  });

  router.get("/settings", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const pageId = typeof req.query.pageId === "string" ? req.query.pageId : "";
    if (!pageId) return res.status(400).json({ error: "pageId is required" });

    const [account] = await db
      .select({ metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(and(
        eq(integrationAccounts.userId, userId),
        eq(integrationAccounts.providerId, "messenger"),
        sql`${integrationAccounts.metadata} ->> 'pageId' = ${pageId}`,
      ))
      .limit(1);

    return res.json({ success: true, settings: extractRuntimeSettings(account?.metadata) });
  });

  router.put("/settings", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const pageId = typeof req.body?.pageId === "string" ? req.body.pageId : "";
    if (!pageId) return res.status(400).json({ error: "pageId is required" });

    const rawSettings = req.body?.settings ?? (({ pageId: _omit, ...rest }: any) => rest)(req.body ?? {});
    const parsed = runtimeSettingsUpdateSchema.safeParse(rawSettings);
    if (!parsed.success) return res.status(400).json({ error: "Invalid settings", details: parsed.error.message });

    const [account] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(and(
        eq(integrationAccounts.userId, userId),
        eq(integrationAccounts.providerId, "messenger"),
        sql`${integrationAccounts.metadata} ->> 'pageId' = ${pageId}`,
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

    const parsed = z.object({ pageId: z.string().min(1) }).strict().safeParse(req.body);
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
          eq(integrationAccounts.providerId, "messenger"),
          sql`${integrationAccounts.metadata} ->> 'pageId' = ${parsed.data.pageId}`,
        ),
      );

    return res.json({ success: true });
  });

  return router;
}
