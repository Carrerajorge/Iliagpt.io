import crypto from "crypto";

// NOTE: API keys are stored in-memory for now. In production, this should be
// persisted to the database (e.g. an `api_keys` table) to survive restarts
// and work across multiple server instances.

interface StoredApiKey {
  id: string;
  hashedKey: string;
  prefix: string;
  userId: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

interface CreateKeyResult {
  key: string;
  id: string;
}

interface ValidateKeyResult {
  valid: boolean;
  userId?: string;
  keyId?: string;
}

interface ListKeyEntry {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

// Sliding window rate limit entry
interface RateLimitWindow {
  timestamps: number[];
}

class ApiKeyManager {
  private keys = new Map<string, StoredApiKey>(); // hashedKey -> StoredApiKey
  private keysByUser = new Map<string, Set<string>>(); // userId -> Set<hashedKey>
  private rateLimits = new Map<string, RateLimitWindow>(); // keyId -> timestamps

  private static readonly RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
  private static readonly RATE_LIMIT_MAX_REQUESTS = 60;

  /**
   * Create a new API key for a user.
   * Returns the raw key (only shown once) and the key ID.
   */
  async createKey(userId: string, name: string): Promise<CreateKeyResult> {
    const rawKey = `sk-iliagpt-${crypto.randomBytes(32).toString("hex")}`;
    const hashedKey = this.hashKey(rawKey);
    const id = crypto.randomUUID();
    const prefix = rawKey.slice(0, 12);

    const entry: StoredApiKey = {
      id,
      hashedKey,
      prefix,
      userId,
      name,
      createdAt: new Date(),
      lastUsedAt: null,
    };

    this.keys.set(hashedKey, entry);

    let userKeys = this.keysByUser.get(userId);
    if (!userKeys) {
      userKeys = new Set();
      this.keysByUser.set(userId, userKeys);
    }
    userKeys.add(hashedKey);

    return { key: rawKey, id };
  }

  /**
   * Validate a raw API key.
   * Returns the userId and keyId if valid.
   */
  async validateKey(rawKey: string): Promise<ValidateKeyResult> {
    const hashedKey = this.hashKey(rawKey);
    const entry = this.keys.get(hashedKey);

    if (!entry) {
      return { valid: false };
    }

    return {
      valid: true,
      userId: entry.userId,
      keyId: entry.id,
    };
  }

  /**
   * List API keys for a user, showing only the prefix (first 12 chars).
   */
  async listKeys(userId: string): Promise<ListKeyEntry[]> {
    const userKeyHashes = this.keysByUser.get(userId);
    if (!userKeyHashes) {
      return [];
    }

    const result: ListKeyEntry[] = [];
    for (const hash of userKeyHashes) {
      const entry = this.keys.get(hash);
      if (entry) {
        result.push({
          id: entry.id,
          name: entry.name,
          prefix: entry.prefix,
          createdAt: entry.createdAt,
          lastUsedAt: entry.lastUsedAt,
        });
      }
    }
    return result;
  }

  /**
   * Revoke (delete) an API key.
   */
  async revokeKey(userId: string, keyId: string): Promise<boolean> {
    const userKeyHashes = this.keysByUser.get(userId);
    if (!userKeyHashes) {
      return false;
    }

    for (const hash of userKeyHashes) {
      const entry = this.keys.get(hash);
      if (entry && entry.id === keyId) {
        this.keys.delete(hash);
        userKeyHashes.delete(hash);
        this.rateLimits.delete(keyId);
        if (userKeyHashes.size === 0) {
          this.keysByUser.delete(userId);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Record that a key was used (updates lastUsedAt).
   */
  async recordUsage(keyId: string): Promise<void> {
    for (const entry of this.keys.values()) {
      if (entry.id === keyId) {
        entry.lastUsedAt = new Date();
        return;
      }
    }
  }

  /**
   * Check rate limit for a key using sliding window.
   * Returns true if the request is allowed, false if rate limited.
   */
  checkRateLimit(keyId: string): boolean {
    const now = Date.now();
    const windowStart = now - ApiKeyManager.RATE_LIMIT_WINDOW_MS;

    let window = this.rateLimits.get(keyId);
    if (!window) {
      window = { timestamps: [] };
      this.rateLimits.set(keyId, window);
    }

    // Remove timestamps outside the window
    window.timestamps = window.timestamps.filter((t) => t > windowStart);

    if (window.timestamps.length >= ApiKeyManager.RATE_LIMIT_MAX_REQUESTS) {
      return false;
    }

    window.timestamps.push(now);
    return true;
  }

  private hashKey(rawKey: string): string {
    return crypto.createHash("sha256").update(rawKey).digest("hex");
  }
}

export type { StoredApiKey, CreateKeyResult, ValidateKeyResult, ListKeyEntry };
export const apiKeyManager = new ApiKeyManager();
