import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { db } from "../db";
import { nodes } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

export type AuthenticatedNode = {
  id: string;
  orgId: string;
  ownerUserId: string;
  name: string;
};

function sha256Base64Url(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("base64url");
}

function getBearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  if (!m) return null;
  return m[1]?.trim() || null;
}

export async function requireNodeAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ success: false, error: "Missing Bearer token" });

    const tokenHash = sha256Base64Url(token);
    const [row] = await db
      .select({ id: nodes.id, orgId: nodes.orgId, ownerUserId: nodes.ownerUserId, name: nodes.name, revokedAt: nodes.revokedAt })
      .from(nodes)
      .where(and(eq(nodes.tokenHash, tokenHash), isNull(nodes.revokedAt)))
      .limit(1);

    if (!row) return res.status(401).json({ success: false, error: "Invalid token" });

    (req as any).node = {
      id: String(row.id),
      orgId: String(row.orgId),
      ownerUserId: String(row.ownerUserId),
      name: String(row.name),
    } satisfies AuthenticatedNode;

    return next();
  } catch (e: any) {
    console.error("[NodeAuth] error:", e?.message || e);
    return res.status(500).json({ success: false, error: "Node auth failed" });
  }
}

export function getNode(req: Request): AuthenticatedNode | null {
  return ((req as any).node as AuthenticatedNode | undefined) || null;
}
