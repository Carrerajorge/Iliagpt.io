import crypto from "crypto";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.REMOTE_SHELL_SECRET;
  if (!secret) {
    throw new Error("REMOTE_SHELL_SECRET is not configured");
  }
  cachedKey = crypto.createHash("sha256").update(secret).digest();
  return cachedKey;
}

export function isRemoteSecretConfigured(): boolean {
  return Boolean(process.env.REMOTE_SHELL_SECRET);
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plain, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid encrypted payload format");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let decrypted = decipher.update(dataHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
