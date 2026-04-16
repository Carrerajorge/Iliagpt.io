/**
 * Two-Factor Authentication Service
 * TOTP-based 2FA with backup codes
 */

import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";

// TOTP Configuration
const TOTP_CONFIG = {
  digits: 6,
  period: 30, // seconds
  algorithm: "SHA1"
};

// Ensure tables exist
const ensureTables = async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_2fa (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) UNIQUE NOT NULL,
        secret VARCHAR(255) NOT NULL,
        is_enabled BOOLEAN DEFAULT false,
        backup_codes JSONB DEFAULT '[]',
        verified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255),
        email VARCHAR(255),
        ip_address VARCHAR(45),
        user_agent TEXT,
        success BOOLEAN,
        failure_reason VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_2fa_user ON user_2fa(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address)`);
  } catch (e) {
    // Tables might exist
  }
};

ensureTables();

/**
 * Generate a random base32 secret
 */
export function generateSecret(): string {
  const buffer = crypto.randomBytes(20);
  return base32Encode(buffer);
}

/**
 * Base32 encoding
 */
function base32Encode(buffer: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let result = "";
  let bits = 0;
  let value = 0;

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }

  return result;
}

/**
 * Base32 decoding
 */
function base32Decode(encoded: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleanedInput = encoded.toUpperCase().replace(/=+$/, "");
  
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleanedInput) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

/**
 * Generate TOTP code
 */
export function generateTOTP(secret: string, timestamp?: number): string {
  const time = Math.floor((timestamp || Date.now()) / 1000 / TOTP_CONFIG.period);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigInt64BE(BigInt(time));

  const key = base32Decode(secret);
  const hmac = crypto.createHmac("sha1", key);
  hmac.update(timeBuffer);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, TOTP_CONFIG.digits);
  return otp.toString().padStart(TOTP_CONFIG.digits, "0");
}

/**
 * TOTP replay protection: track recently used codes per user to prevent reuse.
 * Codes expire after 2 TOTP periods (60s) to cover the full tolerance window.
 */
const USED_TOTP_CODES = new Map<string, number>();
const TOTP_REPLAY_TTL_MS = 2 * TOTP_CONFIG.period * 1000;
const TOTP_REPLAY_MAX_ENTRIES = 10_000;

function pruneUsedTotpCodes(): void {
  if (USED_TOTP_CODES.size <= TOTP_REPLAY_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, expiry] of USED_TOTP_CODES.entries()) {
    if (now > expiry) USED_TOTP_CODES.delete(key);
  }
}

/**
 * Verify TOTP code (with 1 period tolerance + replay protection)
 */
export function verifyTOTP(secret: string, code: string, userId?: string): boolean {
  // Replay protection: reject recently used codes
  if (userId) {
    const replayKey = `${userId}:${code}`;
    const expiry = USED_TOTP_CODES.get(replayKey);
    if (expiry && Date.now() <= expiry) return false;
  }

  const now = Date.now();

  // Check current, previous, and next period
  for (const offset of [-1, 0, 1]) {
    const timestamp = now + offset * TOTP_CONFIG.period * 1000;
    if (generateTOTP(secret, timestamp) === code) {
      // Mark code as used to prevent replay
      if (userId) {
        pruneUsedTotpCodes();
        USED_TOTP_CODES.set(`${userId}:${code}`, Date.now() + TOTP_REPLAY_TTL_MS);
      }
      return true;
    }
  }

  return false;
}

/**
 * Generate backup codes
 */
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

/**
 * Generate QR code URL for authenticator apps
 */
export function generateQRCodeURL(
  secret: string,
  email: string,
  issuer = "IliaGPT"
): string {
  const encoded = encodeURIComponent(email);
  const issuerEncoded = encodeURIComponent(issuer);
  return `otpauth://totp/${issuerEncoded}:${encoded}?secret=${secret}&issuer=${issuerEncoded}&algorithm=${TOTP_CONFIG.algorithm}&digits=${TOTP_CONFIG.digits}&period=${TOTP_CONFIG.period}`;
}

// ============= DATABASE OPERATIONS =============

export async function setup2FA(userId: string): Promise<{
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}> {
  const secret = generateSecret();
  const backupCodes = generateBackupCodes();
  
  // Get user email
  const userResult = await db.execute(sql`SELECT email FROM users WHERE id = ${userId}`);
  const email = String(userResult.rows?.[0]?.email || "user@iliagpt.com");
  
  // Store secret (not enabled yet)
  await db.execute(sql`
    INSERT INTO user_2fa (user_id, secret, backup_codes)
    VALUES (${userId}, ${secret}, ${JSON.stringify(backupCodes)})
    ON CONFLICT (user_id) DO UPDATE SET
      secret = ${secret},
      backup_codes = ${JSON.stringify(backupCodes)},
      is_enabled = false,
      updated_at = NOW()
  `);
  
  const qrCodeUrl = generateQRCodeURL(secret, email);
  
  return { secret, qrCodeUrl, backupCodes };
}

export async function verify2FASetup(userId: string, code: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT secret FROM user_2fa WHERE user_id = ${userId} AND is_enabled = false
  `);
  
  if (!result.rows?.length) return false;
  
  const secret = String((result.rows[0] as any).secret || "");
  
  if (verifyTOTP(secret, code, userId)) {
    await db.execute(sql`
      UPDATE user_2fa SET is_enabled = true, verified_at = NOW() WHERE user_id = ${userId}
    `);
    return true;
  }

  return false;
}

export async function verify2FALogin(userId: string, code: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT secret, backup_codes FROM user_2fa WHERE user_id = ${userId} AND is_enabled = true
  `);

  if (!result.rows?.length) return false;

  const secret = String((result.rows[0] as any).secret || "");
  const backup_codes = (result.rows[0] as any).backup_codes;

  // Check TOTP first (with replay protection)
  if (verifyTOTP(secret, code, userId)) {
    return true;
  }
  
  // Check backup codes
  const codes = backup_codes as string[];
  const codeIndex = codes.indexOf(code);
  if (codeIndex !== -1) {
    // Remove used backup code
    codes.splice(codeIndex, 1);
    await db.execute(sql`
      UPDATE user_2fa SET backup_codes = ${JSON.stringify(codes)} WHERE user_id = ${userId}
    `);
    return true;
  }
  
  return false;
}

export async function is2FAEnabled(userId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT is_enabled FROM user_2fa WHERE user_id = ${userId}
  `);
  const raw = (result.rows?.[0] as any)?.is_enabled;
  return raw === true || raw === "true" || raw === 1 || raw === "1" || raw === "t";
}

export async function disable2FA(userId: string): Promise<boolean> {
  await db.execute(sql`DELETE FROM user_2fa WHERE user_id = ${userId}`);
  return true;
}

export async function regenerateBackupCodes(userId: string): Promise<string[]> {
  const backupCodes = generateBackupCodes();
  
  await db.execute(sql`
    UPDATE user_2fa SET backup_codes = ${JSON.stringify(backupCodes)}, updated_at = NOW()
    WHERE user_id = ${userId}
  `);
  
  return backupCodes;
}

// ============= LOGIN ATTEMPTS TRACKING =============

export async function recordLoginAttempt(
  email: string,
  userId: string | null,
  ip: string,
  userAgent: string,
  success: boolean,
  failureReason?: string
): Promise<void> {
  await db.execute(sql`
    INSERT INTO login_attempts (user_id, email, ip_address, user_agent, success, failure_reason)
    VALUES (${userId}, ${email}, ${ip}, ${userAgent}, ${success}, ${failureReason || null})
  `);
}

export async function getRecentFailedAttempts(
  identifier: string,
  minutes = 15
): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM login_attempts
    WHERE (email = ${identifier} OR ip_address = ${identifier})
    AND success = false
    AND created_at > NOW() - INTERVAL '${minutes} minutes'
  `);
  
  return parseInt(String((result.rows?.[0] as any)?.count || "0"));
}

export async function isAccountLocked(email: string, ip: string): Promise<boolean> {
  const emailAttempts = await getRecentFailedAttempts(email);
  const ipAttempts = await getRecentFailedAttempts(ip);
  
  return emailAttempts >= 5 || ipAttempts >= 10;
}
