import { sql } from "drizzle-orm";
import { db, dbRead } from "../db";
import { isOwnedByUser } from "../lib/sessionIdentity";
import { is2FAEnabled } from "./twoFactorAuth";
import { createLoginApproval, expireLoginApproval } from "./loginApprovals";
import { sendWebPush } from "./webPush";

export type PushTarget = {
  sid: string;
  subscription: unknown;
};

export type MfaMethods = {
  totp: boolean;
  push: boolean;
};

export async function getPushTargetsForUser(params: {
  userId: string;
  excludeSid?: string | null;
}): Promise<PushTarget[]> {
  const userId = params.userId;
  const excludeSid = params.excludeSid ?? null;

  // Query sessions that *might* belong to the user, then filter defensively in code.
  const result = await dbRead.execute(sql`
    SELECT sid, sess
    FROM sessions
    WHERE expire > NOW()
      AND (
        sess #>> '{passport,user,claims,sub}' = ${userId}
        OR sess #>> '{passport,user,id}' = ${userId}
        OR sess ->> 'authUserId' = ${userId}
        OR sess #>> '{passport,user}' = ${userId}
      )
  `);

  const rows = (result as any)?.rows ?? (result as any);
  const targets: PushTarget[] = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (excludeSid && String(row?.sid) === excludeSid) continue;
    const sess = row?.sess;
    if (!isOwnedByUser(sess, userId)) continue;
    if (!sess?.security?.pushApprovalsEnabled) continue;
    const subscription = sess?.push?.subscription;
    if (!subscription) continue;
    targets.push({ sid: String(row.sid), subscription });
  }

  return targets;
}

export async function computeMfaForUser(params: {
  userId: string;
  excludeSid?: string | null;
}): Promise<{
  totpEnabled: boolean;
  pushTargets: PushTarget[];
  methods: MfaMethods;
  requiresMfa: boolean;
}> {
  const [totpEnabled, pushTargets] = await Promise.all([
    is2FAEnabled(params.userId),
    getPushTargetsForUser({ userId: params.userId, excludeSid: params.excludeSid }),
  ]);

  const methods: MfaMethods = { totp: totpEnabled, push: pushTargets.length > 0 };
  const requiresMfa = methods.totp || methods.push;

  return { totpEnabled, pushTargets, methods, requiresMfa };
}

async function saveSession(session: any): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!session?.save) return resolve();
    session.save((err: any) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function clearInvalidWebPushSubscriptions(invalidSids: string[]): Promise<void> {
  if (invalidSids.length === 0) return;
  try {
    await Promise.all(
      invalidSids.map((sid) =>
        db.execute(sql`
          UPDATE sessions
          SET sess = sess #- '{push,subscription}'
          WHERE sid = ${sid}
        `)
      )
    );
  } catch {
    // Best-effort cleanup.
  }
}

export async function startMfaLoginChallenge(params: {
  req: any;
  userId: string;
  email?: string | null;
  totpEnabled: boolean;
  pushTargets: PushTarget[];
  ttlMs?: number;
  sessionUser?: unknown; // provider-specific session payload to preserve (OIDC tokens, etc.)
}): Promise<{
  methods: MfaMethods;
  approvalId: string | null;
  expiresAt: number;
  pushSent: number;
}> {
  const ttlMs = params.ttlMs ?? 5 * 60 * 1000;
  const session = params.req?.session as any;
  if (!session) {
    throw Object.assign(new Error("No active session"), { code: "NO_SESSION" });
  }

  const methods: MfaMethods = { totp: !!params.totpEnabled, push: params.pushTargets.length > 0 };
  if (!methods.totp && !methods.push) {
    throw Object.assign(new Error("MFA not required"), { code: "MFA_NOT_REQUIRED" });
  }

  const ip = params.req?.ip || params.req?.socket?.remoteAddress || null;
  const userAgent = params.req?.headers?.["user-agent"] || null;

  let approvalId: string | null = null;
  let pushSent = 0;

  if (methods.push) {
    try {
      const approval = await createLoginApproval({
        userId: params.userId,
        ttlMs,
        metadata: {
          email: params.email || null,
          ip,
          userAgent,
          requestedAt: new Date().toISOString(),
        },
      });

      approvalId = approval.id;

      const ua = userAgent || "Navegador";
      const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
      const deviceLabel = `${isMobile ? "Móvil" : "Desktop"}`;

      const payload = {
        title: "Aprobar inicio de sesión",
        body: `Nuevo intento desde ${deviceLabel} (${ip || "IP desconocida"})`,
        requireInteraction: true,
        actions: [
          { action: "approve", title: "Aprobar" },
          { action: "deny", title: "Rechazar" },
        ],
        data: {
          url: `/login/approve?approvalId=${approvalId}`,
          actionUrls: {
            approve: `/login/approve?approvalId=${approvalId}&action=approve`,
            deny: `/login/approve?approvalId=${approvalId}&action=deny`,
          },
          approvalId,
        },
      };

      const results = await Promise.all(
        params.pushTargets.map((t) => sendWebPush(t.subscription, payload))
      );
      pushSent = results.filter((r) => r.ok).length;

      const invalidSids = params.pushTargets
        .filter((t, idx) => {
          const sc = results[idx]?.statusCode;
          return sc === 404 || sc === 410;
        })
        .map((t) => t.sid);
      await clearInvalidWebPushSubscriptions(invalidSids);
    } catch (e: any) {
      // Continue: if TOTP is enabled, the user can still proceed with code.
      // If push is the only method, we fail closed below.
      // eslint-disable-next-line no-console
      console.warn("[MFA] Failed to create/send push approval:", e?.message || e);
    }
  }

  // If push was the only method and we couldn't deliver any notification, fail closed.
  if (!methods.totp && methods.push && pushSent === 0) {
    if (approvalId) {
      await expireLoginApproval(approvalId).catch(() => {});
    }
    throw Object.assign(new Error("PUSH_DELIVERY_FAILED"), { code: "PUSH_DELIVERY_FAILED" });
  }

  const normalizeSessionUser = (user: unknown): unknown => {
    if (!user || typeof user !== "object") return undefined;
    const u: any = { ...(user as any) };
    u.claims = (u.claims && typeof u.claims === "object") ? { ...(u.claims as any) } : {};
    if (!u.claims.sub) u.claims.sub = params.userId;
    if (params.email && !u.claims.email) u.claims.email = params.email;
    if (!u.expires_at) {
      u.expires_at = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
    }
    return u;
  };

  session.pendingMfa = {
    userId: params.userId,
    methods,
    approvalId,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    sessionUser: normalizeSessionUser(params.sessionUser),
  };

  await saveSession(session);

  return { methods, approvalId, expiresAt: Date.now() + ttlMs, pushSent };
}
