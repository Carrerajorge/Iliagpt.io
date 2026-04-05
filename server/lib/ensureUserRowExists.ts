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
  if (isAnon) {
    console.warn(`[ensureUserRowExists] Blocked anonymous user creation: ${id.slice(0, 12)}...`);
    return;
  }

  const ip = req ? (req.headers["x-forwarded-for"] as string || req.ip || "unknown") : undefined;
  const ua = req ? (req.headers["user-agent"] as string || undefined) : undefined;

  try {
    await db
      .insert(users)
      .values({
        id,
        username: `User-${id.slice(0, 8)}`,
        authProvider: "unknown",
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

