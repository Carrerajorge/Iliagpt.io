import { Router } from "express";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { sessions } from "@shared/schema";
import { db, dbRead } from "../db";
import { validateBody } from "../middleware/validateRequest";
import { getUserId } from "../types/express";
import { getVapidPublicKey, sendWebPush } from "../services/webPush";
import { isOwnedByUser } from "../lib/sessionIdentity";

type SessionDeviceMeta = {
  createdAt?: number;
  lastSeenAt?: number;
  userAgent?: string | null;
  ip?: string | null;
};

type SessionSecurityMeta = {
  pushApprovalsEnabled?: boolean;
  pushApprovalsEnabledAt?: number;
};

type SessionPushMeta = {
  subscription?: unknown;
  createdAt?: number;
};

// (extractUserIdFromSession, isOwnedByUser) live in ../lib/sessionIdentity

export function createSecurityRouter() {
  const router = Router();

  // List active device sessions for the current user.
  router.get("/trusted-devices", async (req, res) => {
    const userId = getUserId(req);
    if (!userId || userId.startsWith("anon_")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const currentSid = req.sessionID || null;

      const result = await dbRead.execute(sql`
        SELECT sid, sess, expire
        FROM sessions
        WHERE
          sess #>> '{passport,user,claims,sub}' = ${userId}
          OR sess #>> '{passport,user,id}' = ${userId}
          OR sess ->> 'authUserId' = ${userId}
          OR sess #>> '{passport,user}' = ${userId}
      `);

      const rows = (result as any)?.rows ?? (result as any);

      const devices = (Array.isArray(rows) ? rows : []).flatMap((row: any) => {
        const sess = row?.sess;
        if (!isOwnedByUser(sess, userId)) return [];

        const device: SessionDeviceMeta | undefined = sess?.device;
        const security: SessionSecurityMeta | undefined = sess?.security;
        const push: SessionPushMeta | undefined = sess?.push;

        return [{
          sid: row?.sid as string,
          isCurrent: !!currentSid && row?.sid === currentSid,
          createdAt: typeof device?.createdAt === "number" ? device.createdAt : null,
          lastSeenAt: typeof device?.lastSeenAt === "number" ? device.lastSeenAt : null,
          ip: typeof device?.ip === "string" ? device.ip : null,
          userAgent: typeof device?.userAgent === "string" ? device.userAgent : null,
          expiresAt: row?.expire ? new Date(row.expire).toISOString() : null,
          pushApprovalsEnabled: !!security?.pushApprovalsEnabled,
          hasPushSubscription: !!push?.subscription,
        }];
      });

      // Newest-first (by lastSeenAt, then createdAt, then sid)
      devices.sort((a, b) => {
        const aSeen = a.lastSeenAt ?? 0;
        const bSeen = b.lastSeenAt ?? 0;
        if (bSeen !== aSeen) return bSeen - aSeen;
        const aCreated = a.createdAt ?? 0;
        const bCreated = b.createdAt ?? 0;
        if (bCreated !== aCreated) return bCreated - aCreated;
        return String(a.sid).localeCompare(String(b.sid));
      });

      return res.json({ currentSid, devices });
    } catch (error: any) {
      console.error("[Security] Failed to list trusted devices:", error?.message || error);
      return res.status(500).json({ error: "Failed to list trusted devices" });
    }
  });

  // Web Push: VAPID public key
  router.get("/push/vapid-public-key", async (_req, res) => {
    const key = getVapidPublicKey();
    if (!key?.publicKey) {
      return res.json({ configured: false, publicKey: "" });
    }
    return res.json({ configured: true, publicKey: key.publicKey, isEphemeral: key.isEphemeral });
  });

  // Web Push: subscribe this session/device
  router.post(
    "/push/subscribe",
    validateBody(z.object({
      subscription: z.object({
        endpoint: z.string().min(1),
        keys: z.object({
          p256dh: z.string().min(1),
          auth: z.string().min(1),
        }),
      }).passthrough(),
    })),
    async (req, res) => {
      const userId = getUserId(req);
      if (!userId || userId.startsWith("anon_")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const session = req.session as any;
      if (!session) {
        return res.status(400).json({ error: "No active session" });
      }

      session.push = session.push || {};
      session.push.subscription = req.body.subscription;
      session.push.createdAt = Date.now();

      // Bind session to user for secure queries.
      if (!session.authUserId) session.authUserId = userId;

      return res.json({ success: true });
    }
  );

  // Web Push: unsubscribe this session/device
  router.post("/push/unsubscribe", async (req, res) => {
    const userId = getUserId(req);
    if (!userId || userId.startsWith("anon_")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const session = req.session as any;
    if (!session) {
      return res.status(400).json({ error: "No active session" });
    }

    if (session.push) {
      delete session.push.subscription;
    }

    return res.json({ success: true });
  });

  // Web Push: test this device (development only)
  if (process.env.NODE_ENV === "development") {
    router.post("/push/test", async (req, res) => {
      const userId = getUserId(req);
      if (!userId || userId.startsWith("anon_")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const session = req.session as any;
      const subscription = session?.push?.subscription;
      if (!subscription) {
        return res.status(400).json({ error: "No subscription for this device" });
      }

      const result = await sendWebPush(subscription, {
        title: "ILIAGPT",
        body: "Notificación push de prueba",
        data: { url: "/" },
      });

      return res.json({ success: result.ok, error: result.error });
    });
  }

  // Toggle push-based approvals for the current device (session).
  router.post(
    "/push-approvals",
    validateBody(z.object({ enabled: z.boolean() })),
    async (req, res) => {
      const userId = getUserId(req);
      if (!userId || userId.startsWith("anon_")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const session = req.session as any;
      if (!session) {
        return res.status(400).json({ error: "No active session" });
      }

      const enabled = !!req.body.enabled;
      session.security = session.security || {};
      session.security.pushApprovalsEnabled = enabled;
      session.security.pushApprovalsEnabledAt = enabled ? Date.now() : undefined;

      // Best-effort: bind session to user for simpler device queries.
      if (!session.authUserId) session.authUserId = userId;

      return res.json({ success: true, enabled });
    }
  );

  // Revoke a specific device session (sign out that device).
  router.post(
    "/sessions/revoke",
    validateBody(z.object({ sid: z.string().min(1) })),
    async (req, res) => {
      const userId = getUserId(req);
      if (!userId || userId.startsWith("anon_")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const targetSid = req.body.sid;

      try {
        const [row] = await dbRead.select().from(sessions).where(eq(sessions.sid, targetSid));
        if (!row) {
          return res.status(404).json({ error: "Session not found" });
        }

        if (!isOwnedByUser((row as any).sess, userId)) {
          return res.status(403).json({ error: "Forbidden" });
        }

        // If it's the current session, destroy it and clear the cookie.
        if (req.sessionID && targetSid === req.sessionID && req.session) {
          await new Promise<void>((resolve) => {
            req.session.destroy(() => resolve());
          });
          res.clearCookie("siragpt.sid");
          return res.json({ success: true, revoked: 1, current: true });
        }

        const result = await db.delete(sessions).where(eq(sessions.sid, targetSid));
        return res.json({ success: true, revoked: result.rowCount ?? 0, current: false });
      } catch (error: any) {
        console.error("[Security] Failed to revoke session:", error?.message || error);
        return res.status(500).json({ error: "Failed to revoke session" });
      }
    }
  );

  // Revoke all sessions for the current user (including current).
  router.post("/sessions/revoke-all", async (req, res) => {
    const userId = getUserId(req);
    if (!userId || userId.startsWith("anon_")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const currentSid = req.sessionID || null;

    try {
      // Revoke other devices first, then destroy current session to clear cookie cleanly.
      const deleteResult = currentSid
        ? await db.execute(sql`
            DELETE FROM sessions
            WHERE sid <> ${currentSid}
              AND (
                sess #>> '{passport,user,claims,sub}' = ${userId}
                OR sess #>> '{passport,user,id}' = ${userId}
                OR sess ->> 'authUserId' = ${userId}
                OR sess #>> '{passport,user}' = ${userId}
              )
          `)
        : await db.execute(sql`
            DELETE FROM sessions
            WHERE
              sess #>> '{passport,user,claims,sub}' = ${userId}
              OR sess #>> '{passport,user,id}' = ${userId}
              OR sess ->> 'authUserId' = ${userId}
              OR sess #>> '{passport,user}' = ${userId}
          `);

      const revokedOthers = (deleteResult as any)?.rowCount ?? 0;

      if (req.session) {
        await new Promise<void>((resolve) => {
          req.session.destroy(() => resolve());
        });
        res.clearCookie("siragpt.sid");
      }

      const revoked = revokedOthers + (currentSid ? 1 : 0);
      return res.json({ success: true, revoked });
    } catch (error: any) {
      console.error("[Security] Failed to revoke all sessions:", error?.message || error);
      return res.status(500).json({ error: "Failed to revoke all sessions" });
    }
  });

  return router;
}
