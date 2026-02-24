/**
 * Encryption Service
 * Data encryption at rest using AES-256-GCM
 */

import crypto from "crypto";

// Configuration
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

// Get encryption key from environment or generate
const getEncryptionKey = (): Buffer => {
  // Preferred: ENCRYPTION_KEY (32 bytes / 64 hex chars) for encryption-at-rest.
  // Back-compat: TOKEN_ENCRYPTION_KEY is already required in production when OAuth is enabled.
  // If ENCRYPTION_KEY is not set, derive a stable 32-byte key from TOKEN_ENCRYPTION_KEY.
  const envKey = process.env.ENCRYPTION_KEY;
  const tokenKey = process.env.TOKEN_ENCRYPTION_KEY;

  if (envKey) {
    // If hex string, convert to buffer
    if (envKey.length === 64) {
      return Buffer.from(envKey, "hex");
    }
    // Hash the key to ensure correct length
    return crypto.createHash("sha256").update(envKey).digest();
  }

  if (tokenKey) {
    // Derive 32-byte key deterministically from TOKEN_ENCRYPTION_KEY
    return crypto.createHash("sha256").update(tokenKey).digest();
  }

  // In production we should never run with an ephemeral/default key.
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Missing ENCRYPTION_KEY (or TOKEN_ENCRYPTION_KEY) in production. Refusing to start.');
    process.exit(1);
  }

  // Dev/test fallback
  console.warn("[Encryption] No ENCRYPTION_KEY/TOKEN_ENCRYPTION_KEY set, using derived dev key");
  return crypto.createHash("sha256").update("iliagpt-default-key-change-me").digest();
};

const MASTER_KEY = getEncryptionKey();

/**
 * Encrypt data
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
  
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const tag = cipher.getAuthTag();
  
  // Return: iv (hex) + tag (hex) + encrypted (hex)
  return iv.toString("hex") + tag.toString("hex") + encrypted;
}

/**
 * Decrypt data
 */
export function decrypt(encryptedData: string): string {
  const iv = Buffer.from(encryptedData.slice(0, IV_LENGTH * 2), "hex");
  const tag = Buffer.from(encryptedData.slice(IV_LENGTH * 2, IV_LENGTH * 2 + TAG_LENGTH * 2), "hex");
  const encrypted = encryptedData.slice(IV_LENGTH * 2 + TAG_LENGTH * 2);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

/**
 * Encrypt object
 */
export function encryptObject(obj: object): string {
  return encrypt(JSON.stringify(obj));
}

/**
 * Decrypt object
 */
export function decryptObject<T>(encryptedData: string): T {
  return JSON.parse(decrypt(encryptedData));
}

/**
 * Hash password with salt
 */
export function hashWithSalt(password: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt || crypto.randomBytes(SALT_LENGTH).toString("hex");
  const hash = crypto.pbkdf2Sync(password, useSalt, ITERATIONS, KEY_LENGTH, "sha256").toString("hex");
  return { hash, salt: useSalt };
}

/**
 * Verify password against hash
 */
export function verifyHash(password: string, hash: string, salt: string): boolean {
  const result = hashWithSalt(password, salt);
  // Use constant-time comparison to prevent timing attacks
  return secureCompare(result.hash, hash);
}

/**
 * Generate secure random token
 */
export function generateSecureToken(length = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Generate API key
 */
export function generateApiKey(): string {
  const prefix = "ilgpt_";
  const key = crypto.randomBytes(24).toString("base64url");
  return prefix + key;
}

/**
 * Hash API key for storage
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Mask sensitive data
 */
export function maskSensitive(data: string, visibleStart = 4, visibleEnd = 4): string {
  if (data.length <= visibleStart + visibleEnd) {
    return "*".repeat(data.length);
  }
  
  const start = data.slice(0, visibleStart);
  const end = data.slice(-visibleEnd);
  const middle = "*".repeat(Math.min(data.length - visibleStart - visibleEnd, 8));
  
  return start + middle + end;
}

/**
 * Encrypt file content
 */
export function encryptBuffer(buffer: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
  
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  
  // Return: iv + tag + encrypted
  return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Decrypt file content
 */
export function decryptBuffer(encryptedBuffer: Buffer): Buffer {
  const iv = encryptedBuffer.slice(0, IV_LENGTH);
  const tag = encryptedBuffer.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = encryptedBuffer.slice(IV_LENGTH + TAG_LENGTH);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
  decipher.setAuthTag(tag);
  
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Rotate encryption key (re-encrypt data with new key)
 */
export async function rotateEncryptionKey(
  oldKey: Buffer,
  newKey: Buffer,
  data: string
): Promise<string> {
  // Decrypt with old key
  const iv = Buffer.from(data.slice(0, IV_LENGTH * 2), "hex");
  const tag = Buffer.from(data.slice(IV_LENGTH * 2, IV_LENGTH * 2 + TAG_LENGTH * 2), "hex");
  const encrypted = data.slice(IV_LENGTH * 2 + TAG_LENGTH * 2);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, oldKey, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  // Re-encrypt with new key
  const newIv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, newKey, newIv);
  
  let newEncrypted = cipher.update(decrypted, "utf8", "hex");
  newEncrypted += cipher.final("hex");
  
  const newTag = cipher.getAuthTag();
  
  return newIv.toString("hex") + newTag.toString("hex") + newEncrypted;
}

/**
 * Secure comparison (constant time)
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Generate session fingerprint
 */
export function generateFingerprint(userAgent: string, ip: string): string {
  const data = `${userAgent}|${ip}`;
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}
