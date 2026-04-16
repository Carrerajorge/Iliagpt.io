/**
 * Break-Glass Authentication Service
 *
 * Provides hardened emergency admin access with:
 *  - CIDR allowlist enforcement
 *  - Password expiry checks
 *  - Usage tracking
 *  - Auto-seeding from ADMIN_PASSWORD_HASH env var
 */

import { db } from "../db";
import { breakGlassAccounts, users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import { Logger } from "../lib/logger";
import net from "net";

/**
 * Check if an IP address falls within a CIDR range.
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split("/");
  const mask = bits ? parseInt(bits, 10) : 32;

  if (!net.isIPv4(ip) || !net.isIPv4(range)) return false;

  const ipNum = ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
  const rangeNum = range.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
  const maskBits = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;

  return (ipNum & maskBits) === (rangeNum & maskBits);
}

export interface BreakGlassResult {
  success: boolean;
  userId?: string;
  maxSessionDurationMin?: number;
  reason?: string;
}

/**
 * Authenticate a break-glass (emergency admin) login attempt.
 */
export async function authenticateBreakGlass(
  email: string,
  password: string,
  ip: string,
): Promise<BreakGlassResult> {
  try {
    // Find the break-glass account by joining with users on email
    const result = await db.execute(sql`
      SELECT bg.id, bg.user_id, bg.password_hash, bg.password_expires_at,
             bg.allowed_cidrs, bg.max_session_duration_min, bg.mfa_required,
             bg.usage_count
      FROM break_glass_accounts bg
      JOIN users u ON bg.user_id = u.id
      WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(${email}))
      LIMIT 1
    `);

    const account = (result as any)?.rows?.[0];
    if (!account) {
      return { success: false, reason: "no_break_glass_account" };
    }

    // Check CIDR allowlist
    const cidrs: string[] | null = account.allowed_cidrs;
    if (cidrs && cidrs.length > 0) {
      const allowed = cidrs.some((cidr: string) => ipInCidr(ip, cidr));
      if (!allowed) {
        Logger.warn(`[BreakGlass] CIDR denied for IP=${ip}, allowed=${cidrs.join(",")}`);
        return { success: false, reason: "cidr_denied" };
      }
    }

    // Check password expiry
    if (account.password_expires_at && new Date(account.password_expires_at) < new Date()) {
      return { success: false, reason: "password_expired" };
    }

    // Verify password
    const valid = await bcrypt.compare(password, account.password_hash);
    if (!valid) {
      return { success: false, reason: "invalid_password" };
    }

    // Record usage
    await db.execute(sql`
      UPDATE break_glass_accounts
      SET last_used_at = NOW(),
          usage_count = COALESCE(usage_count, 0) + 1
      WHERE id = ${account.id}
    `);

    return {
      success: true,
      userId: account.user_id,
      maxSessionDurationMin: account.max_session_duration_min || 60,
    };
  } catch (error: any) {
    // If break_glass_accounts table doesn't exist, return gracefully
    const code = error?.cause?.code || error?.code;
    if (code === "42P01") {
      return { success: false, reason: "table_not_found" };
    }
    Logger.error(`[BreakGlass] Auth error: ${error?.message}`);
    return { success: false, reason: "internal_error" };
  }
}

/**
 * Seed the break-glass account from env vars if it doesn't exist yet.
 * Called once at startup. Uses ADMIN_PASSWORD_HASH or ADMIN_EMAIL + a generated hash.
 */
export async function seedBreakGlassAccount(): Promise<void> {
  try {
    const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const adminPasswordHash = (process.env.ADMIN_PASSWORD_HASH || "").trim();

    if (!adminEmail) return; // No admin email configured — skip

    // Check if break_glass_accounts table exists
    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'break_glass_accounts'
      ) as exists
    `);
    if (!(tableCheck as any)?.rows?.[0]?.exists) return;

    // Check if there's already a break-glass account
    const existing = await db.execute(sql`
      SELECT bg.id FROM break_glass_accounts bg
      JOIN users u ON bg.user_id = u.id
      WHERE LOWER(TRIM(u.email)) = ${adminEmail}
      LIMIT 1
    `);
    if ((existing as any)?.rows?.length > 0) return; // Already seeded

    // Find the admin user
    const userResult = await db.execute(sql`
      SELECT id FROM users
      WHERE LOWER(TRIM(email)) = ${adminEmail} AND role = 'admin'
      LIMIT 1
    `);
    const adminUser = (userResult as any)?.rows?.[0];
    if (!adminUser) return; // Admin user doesn't exist yet

    // Use ADMIN_PASSWORD_HASH if provided, otherwise skip (requires manual setup)
    if (!adminPasswordHash) {
      Logger.info("[BreakGlass] No ADMIN_PASSWORD_HASH env var — break-glass account not seeded");
      return;
    }

    await db.insert(breakGlassAccounts).values({
      userId: adminUser.id,
      passwordHash: adminPasswordHash,
      passwordRotatedAt: new Date(),
      passwordExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      mfaRequired: true,
      maxSessionDurationMin: 60,
    }).onConflictDoNothing();

    Logger.info(`[BreakGlass] Seeded break-glass account for ${adminEmail}`);
  } catch (error: any) {
    Logger.warn(`[BreakGlass] Seed failed (non-fatal): ${error?.message}`);
  }
}

/**
 * Rotate the break-glass password for a user.
 */
export async function rotateBreakGlassPassword(
  userId: string,
  newPasswordPlain: string,
): Promise<void> {
  const hash = await bcrypt.hash(newPasswordPlain, 12);
  await db.execute(sql`
    UPDATE break_glass_accounts
    SET password_hash = ${hash},
        password_rotated_at = NOW(),
        password_expires_at = NOW() + INTERVAL '90 days'
    WHERE user_id = ${userId}
  `);
}
