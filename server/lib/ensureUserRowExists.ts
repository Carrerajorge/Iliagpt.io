import { db } from "../db";
import { users } from "@shared/schema";
import type { Request } from "express";

/**
 * Some tables (e.g. user_settings, semantic_memory_chunks) FK to users.id.
 * Only creates rows for AUTHENTICATED users. Anonymous users are blocked
 * from persisting to the users table to prevent untraceable account creation.
 */
export async function ensureUserRowExists(userId: string, req?: Request): Promise<void> {
  const id = String(userId || "").trim();
  if (!id || id === "anonymous") return;

  const isAnon = id.startsWith("anon_");
  const authProvider = isAnon ? "anonymous" : "unknown";

  const rawIp = req ? (req.headers["x-forwarded-for"] as string || req.ip || "") : "";
  const rawUa = req ? (req.headers["user-agent"] as string || "") : "";
  // Sanitize: remove control characters, cap to column limits (last_ip varchar(64), user_agent varchar(512))
  const sanitize = (s: string, maxLen: number) =>
    s.replace(/[\x00-\x1f\x7f]/g, "").slice(0, maxLen).trim();
  const ip = rawIp ? sanitize(rawIp.split(",")[0].trim(), 64) : undefined;
  const ua = rawUa ? sanitize(rawUa, 512) : undefined;

  try {
    await db
      .insert(users)
      .values({
        id,
        username: `User-${id.slice(0, 8)}`,
        authProvider,
        role: "user",
        plan: "free",
        status: "active",
        ...(ip ? { lastIp: ip } : {}),
        ...(ua ? { userAgent: ua } : {}),
      })
      .onConflictDoNothing();
  } catch (e: any) {
    console.warn("[ensureUserRowExists] Failed to ensure user row:", e?.message || e);
  }
}

