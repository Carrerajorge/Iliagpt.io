import { Router } from "express";
import { z } from "zod";
import { validateBody, validateParams } from "../middleware/validateRequest";
import { getUserId } from "../types/express";
import { storage } from "../storage";
import { authStorage } from "../replit_integrations/auth/storage";
import { verify2FALogin } from "../services/twoFactorAuth";
import { expireLoginApproval, getLoginApproval, respondLoginApproval } from "../services/loginApprovals";
import { buildSessionUserFromDbUser } from "../lib/sessionUser";

type PendingMfaSession = {
  userId: string;
  methods?: { totp?: boolean; push?: boolean };
  approvalId?: string | null;
  createdAt?: number;
  expiresAt?: number;
  sessionUser?: unknown;
};

function saveSession(session: any): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!session?.save) return resolve();
    session.save((err: any) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export function createMfaRouter() {
  const router = Router();

  router.get("/status", async (req, res) => {
    const session = req.session as any;
    const pending = (session?.pendingMfa || null) as PendingMfaSession | null;
    if (!pending?.userId) {
      return res.json({ active: false });
    }

    const now = Date.now();
    const expiresAt = typeof pending.expiresAt === "number" ? pending.expiresAt : null;
    if (expiresAt && now >= expiresAt) {
      if (pending.approvalId) {
        await expireLoginApproval(String(pending.approvalId)).catch(() => {});
      }
      delete session.pendingMfa;
      await saveSession(session).catch(() => {});
      return res.json({ active: false, status: "expired", methods: pending.methods ?? { totp: false, push: false } });
    }

    let status: "pending" | "approved" | "denied" | "expired" = "pending";
    const approvalId = typeof pending.approvalId === "string" ? pending.approvalId : null;

    if (approvalId) {
      const approval = await getLoginApproval(approvalId);
      if (!approval || approval.userId !== pending.userId) {
        status = "expired";
      } else {
        if (approval.status === "pending" && approval.expiresAt.getTime() <= now) {
          await expireLoginApproval(approvalId).catch(() => {});
          const refreshed = await getLoginApproval(approvalId);
          status = (refreshed?.status as any) || "expired";
        } else {
          status = approval.status;
        }
      }
    }

    // If it was denied/expired, stop the flow and clear pending state.
    if (status === "denied" || status === "expired") {
      delete session.pendingMfa;
      await saveSession(session).catch(() => {});
      return res.json({ active: false, status, methods: pending.methods ?? { totp: false, push: false } });
    }

    return res.json({
      active: true,
      status,
      methods: pending.methods ?? { totp: false, push: false },
      approvalId,
      expiresAt,
    });
  });

  router.post(
    "/cancel",
    async (req, res) => {
      const session = req.session as any;
      if (session?.pendingMfa) {
        delete session.pendingMfa;
        await saveSession(session).catch(() => {});
      }
      return res.json({ success: true });
    }
  );

  router.post(
    "/verify",
    validateBody(z.object({
      code: z.string().trim().min(6).optional(),
    })),
    async (req: any, res) => {
      const session = req.session as any;
      const pending = (session?.pendingMfa || null) as PendingMfaSession | null;
      if (!pending?.userId) {
        return res.status(400).json({ success: false, message: "No hay un inicio de sesión para verificar." });
      }

      const now = Date.now();
      if (typeof pending.expiresAt === "number" && now >= pending.expiresAt) {
        if (pending.approvalId) {
          await expireLoginApproval(String(pending.approvalId)).catch(() => {});
        }
        delete session.pendingMfa;
        await saveSession(session).catch(() => {});
        return res.status(401).json({ success: false, message: "La solicitud MFA expiró. Intenta de nuevo." });
      }

      const userId = pending.userId;
      const methods = pending.methods ?? {};

      const code = (req.body?.code as string | undefined) || undefined;
      if (code) {
        if (!methods.totp) {
          return res.status(400).json({ success: false, message: "Este inicio de sesión no acepta código 2FA." });
        }
        const ok = await verify2FALogin(userId, code).catch(() => false);
        if (!ok) {
          return res.status(401).json({ success: false, message: "Código 2FA inválido." });
        }
      } else {
        const approvalId = typeof pending.approvalId === "string" ? pending.approvalId : null;
        if (!approvalId || !methods.push) {
          return res.status(400).json({ success: false, message: "Falta verificación MFA." });
        }

        const approval = await getLoginApproval(approvalId);
        if (!approval || approval.userId !== userId) {
          delete session.pendingMfa;
          await saveSession(session).catch(() => {});
          return res.status(401).json({ success: false, message: "Solicitud de aprobación inválida." });
        }

        if (approval.status === "pending" && approval.expiresAt.getTime() <= now) {
          await expireLoginApproval(approvalId).catch(() => {});
          delete session.pendingMfa;
          await saveSession(session).catch(() => {});
          return res.status(401).json({ success: false, message: "La solicitud expiró. Intenta de nuevo." });
        }

        if (approval.status !== "approved") {
          if (approval.status === "denied") {
            delete session.pendingMfa;
            await saveSession(session).catch(() => {});
            return res.status(403).json({ success: false, message: "La solicitud fue rechazada." });
          }
          return res.status(401).json({ success: false, message: "Aún no se ha aprobado el inicio de sesión." });
        }
      }

      const dbUser = await storage.getUser(userId).catch(() => undefined);
      const preservedUser = pending.sessionUser && typeof pending.sessionUser === "object"
        ? (pending.sessionUser as any)
        : null;
      const sessionUser = preservedUser || (dbUser ? buildSessionUserFromDbUser(dbUser) : null);
      if (!sessionUser) {
        delete session.pendingMfa;
        await saveSession(session).catch(() => {});
        return res.status(401).json({ success: false, message: "Usuario no encontrado." });
      }

      return req.login(sessionUser, async (err: any) => {
        if (err) {
          return res.status(500).json({ success: false, message: "Error al iniciar sesión." });
        }

        session.authUserId = userId;
        session.passport = session.passport || {};
        if (typeof session.passport.user !== "string") {
          session.passport.user = String(userId);
        }
        delete session.pendingMfa;

        try {
          await authStorage.updateUserLogin(userId, {
            ipAddress: req.ip || req.socket?.remoteAddress || null,
            userAgent: req.headers["user-agent"] || null,
          });
          await storage.createAuditLog({
            userId,
            action: "user_login",
            resource: "auth",
            details: { email: dbUser?.email ?? null, via: "mfa" },
            ipAddress: req.ip || req.socket?.remoteAddress || null,
            userAgent: req.headers["user-agent"] || null,
          } as any);
        } catch {
          // Ignore audit failures
        }

        await saveSession(session).catch(() => {});
        return res.json({ success: true });
      });
    }
  );

  router.get(
    "/approval/:id",
    validateParams(z.object({ id: z.string().uuid() })),
    async (req, res) => {
      const userId = getUserId(req);
      if (!userId || userId.startsWith("anon_")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const approval = await getLoginApproval(req.params.id);
      if (!approval) {
        return res.status(404).json({ error: "Not found" });
      }
      if (approval.userId !== userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // Best-effort: update expired approvals.
      if (approval.status === "pending" && approval.expiresAt.getTime() <= Date.now()) {
        await expireLoginApproval(approval.id).catch(() => {});
      }

      return res.json({
        id: approval.id,
        status: approval.status,
        createdAt: approval.createdAt.toISOString(),
        expiresAt: approval.expiresAt.toISOString(),
        decidedAt: approval.decidedAt ? approval.decidedAt.toISOString() : null,
        metadata: approval.metadata || {},
      });
    }
  );

  router.post(
    "/approval/:id/respond",
    validateParams(z.object({ id: z.string().uuid() })),
    validateBody(z.object({ decision: z.enum(["approved", "denied"]) })),
    async (req, res) => {
      const userId = getUserId(req);
      if (!userId || userId.startsWith("anon_")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const id = req.params.id;
      const decision = req.body.decision as "approved" | "denied";
      const decidedBySid = req.sessionID || null;

      const result = await respondLoginApproval({ id, userId, decision, decidedBySid });
      if (!result.updated) {
        return res.status(409).json({ success: false, message: "La solicitud ya fue decidida o expiró." });
      }

      return res.json({ success: true, decision });
    }
  );

  return router;
}
