import { pool } from "../db";
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
    // Use explicit SQL here instead of the Drizzle `users` table object because the
    // runtime database may lag the latest TS schema during local/dev migrations.
    const columns = ["id", "username", "auth_provider", "role", "plan", "status"];
    const values: string[] = [
      id,
      `User-${id.slice(0, 8)}`,
      authProvider,
      "user",
      "free",
      "active",
    ];

    if (ip) {
      columns.push("last_ip");
      values.push(ip);
    }
    if (ua) {
      columns.push("user_agent");
      values.push(ua);
    }

    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    await pool.query(
      `INSERT INTO users (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
      values,
    );
  } catch (e: any) {
    console.warn("[ensureUserRowExists] Failed to ensure user row:", e?.message || e);
  }
}
