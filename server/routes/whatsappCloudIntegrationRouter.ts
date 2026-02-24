import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { getUserId } from "../types/express";
import { integrationAccounts } from "@shared/schema";
import { createChannelPairingCode } from "../channels/channelStore";
import { ensureIntegrationCatalogSeeded } from "../services/integrationCatalog";
import { extractRuntimeSettings, runtimeSettingsUpdateSchema, withRuntimeSettingsMetadata } from "../channels/runtimeConfigHttp";

const connectSchema = z
  .object({
    phoneNumberId: z.string().min(1),
    wabaId: z.string().optional(),
    accessToken: z.string().min(1),
    displayName: z.string().optional(),
  })
  .strict();

const pairingRequestSchema = z
  .object({
    ttlMinutes: z.number().int().min(1).max(60).optional(),
    phoneNumberId: z.string().min(1).optional(),
  })
  .strict();

function whatsappPairingPayload(code: string, phoneNumberId?: string) {
  const deepLinkPayload = `Hola, activa este canal con este código: ${code}`;
  const sanitizedPhone = phoneNumberId ? phoneNumberId.replace(/[^0-9]/g, "") : "";
  const deeplink = sanitizedPhone
    ? `https://wa.me/${sanitizedPhone}?text=${encodeURIComponent(deepLinkPayload)}`
    : null;

  return {
    code,
    deeplink,
    qrPayload: deepLinkPayload,
    qrHint: "Escanea este QR y envía el código al chat con tu cuenta de negocio",
  };
}

export function createWhatsAppCloudIntegrationRouter(): Router {
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
      .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.providerId, "whatsapp_cloud")));

    return res.json({ success: true, accounts });
  });

  router.post("/connect", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    await ensureIntegrationCatalogSeeded().catch(() => null);

    const { phoneNumberId, wabaId, accessToken, displayName } = parsed.data;
    const now = new Date();

    const [existing] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, "whatsapp_cloud"),
          sql`${integrationAccounts.metadata} ->> 'phoneNumberId' = ${phoneNumberId}`,
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(integrationAccounts)
        .set({
          accessToken,
          displayName: displayName ?? integrationAccounts.displayName,
          status: "active",
          metadata: {
            ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
            phoneNumberId,
            wabaId: wabaId ?? null,
          },
          updatedAt: now,
        })
        .where(eq(integrationAccounts.id, existing.id));

      return res.json({ success: true, updated: true });
    }

    await db.insert(integrationAccounts).values({
      userId,
      providerId: "whatsapp_cloud",
      displayName: displayName ?? "WhatsApp Cloud",
      accessToken,
      status: "active",
      metadata: {
        phoneNumberId,
        wabaId: wabaId ?? null,
      },
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
      channel: "whatsapp_cloud",
      ttlMinutes: parsed.data.ttlMinutes,
    });
    const payload = whatsappPairingPayload(code, parsed.data.phoneNumberId);

    return res.json({
      success: true,
      channel: "whatsapp_cloud",
      code: payload.code,
      expiresAt: expiresAt.toISOString(),
      deeplink: payload.deeplink,
      qrPayload: payload.qrPayload,
      qrHint: payload.qrHint,
    });
  });

  router.get("/settings", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const phoneNumberId = typeof req.query.phoneNumberId === "string" ? req.query.phoneNumberId : "";
    if (!phoneNumberId) return res.status(400).json({ error: "phoneNumberId is required" });

    const [account] = await db
      .select({ metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(and(
        eq(integrationAccounts.userId, userId),
        eq(integrationAccounts.providerId, "whatsapp_cloud"),
        sql`${integrationAccounts.metadata} ->> 'phoneNumberId' = ${phoneNumberId}`,
      ))
      .limit(1);

    return res.json({ success: true, settings: extractRuntimeSettings(account?.metadata) });
  });

  router.put("/settings", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const phoneNumberId = typeof req.body?.phoneNumberId === "string" ? req.body.phoneNumberId : "";
    if (!phoneNumberId) return res.status(400).json({ error: "phoneNumberId is required" });

    const rawSettings = req.body?.settings ?? (({ phoneNumberId: _omit, ...rest }: any) => rest)(req.body ?? {});
    const parsed = runtimeSettingsUpdateSchema.safeParse(rawSettings);
    if (!parsed.success) return res.status(400).json({ error: "Invalid settings", details: parsed.error.message });

    const [account] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(and(
        eq(integrationAccounts.userId, userId),
        eq(integrationAccounts.providerId, "whatsapp_cloud"),
        sql`${integrationAccounts.metadata} ->> 'phoneNumberId' = ${phoneNumberId}`,
      ))
      .limit(1);

    if (!account) return res.status(404).json({ error: "Integration account not found" });

    await db.update(integrationAccounts)
      .set({ metadata: withRuntimeSettingsMetadata(account.metadata, parsed.data), updatedAt: new Date() })
      .where(eq(integrationAccounts.id, account.id));

    return res.json({ success: true, settings: extractRuntimeSettings(withRuntimeSettingsMetadata(account.metadata, parsed.data)) });
  });

  router.post("/disconnect", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = z
      .object({ phoneNumberId: z.string().min(1) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    const { phoneNumberId } = parsed.data;
    const now = new Date();

    await db
      .update(integrationAccounts)
      .set({ status: "inactive", updatedAt: now })
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, "whatsapp_cloud"),
          sql`${integrationAccounts.metadata} ->> 'phoneNumberId' = ${phoneNumberId}`,
        ),
      );

    return res.json({ success: true });
  });

  return router;
}
