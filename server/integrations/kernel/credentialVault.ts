/**
 * CredentialVault — Secure credential storage with auto-refresh.
 *
 * Wraps the existing `integrationAccounts` table with:
 *  - AES-256-GCM encryption for tokens at rest
 *  - Automatic OAuth token refresh when near expiry
 *  - Provider-level credential resolution (Gmail+Drive share "google")
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "crypto";
import type { ResolvedCredential, OAuthConfig } from "./types";
import { connectorRegistry } from "./connectorRegistry";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;  // 128 bits
const TAG_LENGTH = 16; // 128 bits
const REFRESH_BUFFER_MS = 60_000; // Refresh 60s before expiry

/** Get encryption key from env (32 bytes hex = 64 chars) */
function getVaultKey(): Buffer {
  const keyHex = process.env.CREDENTIAL_VAULT_KEY || process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length < 32) {
    // In dev, use a deterministic fallback — NOT safe for production
    if (process.env.NODE_ENV === "production") {
      throw new Error("CREDENTIAL_VAULT_KEY must be set in production (32+ hex chars)");
    }
    return Buffer.from("0".repeat(64), "hex");
  }
  // Accept both raw 32-byte strings and 64-char hex
  if (keyHex.length === 64 && /^[0-9a-fA-F]+$/.test(keyHex)) {
    return Buffer.from(keyHex, "hex");
  }
  // Use first 32 bytes of whatever string is provided
  return Buffer.from(keyHex.padEnd(32, "0").slice(0, 32), "utf-8");
}

export class CredentialVault {
  // ─── Encryption ─────────────────────────────────────────────────

  /** Encrypt a plaintext string → "iv:tag:ciphertext" (all hex) */
  encrypt(plaintext: string): string {
    const key = getVaultKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();

    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
  }

  /** Decrypt an "iv:tag:ciphertext" string → plaintext */
  decrypt(ciphertext: string): string {
    // If it doesn't look encrypted (no colons), return as-is (legacy/dev tokens)
    if (!ciphertext.includes(":")) return ciphertext;

    const parts = ciphertext.split(":");
    if (parts.length !== 3) return ciphertext;

    try {
      const key = getVaultKey();
      const iv = Buffer.from(parts[0], "hex");
      const tag = Buffer.from(parts[1], "hex");
      const encrypted = parts[2];

      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch {
      // If decryption fails, return as-is (probably not encrypted)
      return ciphertext;
    }
  }

  // ─── Credential Resolution ──────────────────────────────────────

  /** Resolve a credential for a user+provider, auto-refreshing OAuth if near expiry.
   *  The providerId is the provider-level ID (e.g. "google" for Gmail+Drive).
   *  If connectorId is passed instead, it resolves the providerId from the manifest. */
  async resolve(userId: string, providerOrConnectorId: string): Promise<ResolvedCredential | null> {
    const { db } = await import("../../db");
    const { integrationAccounts } = await import("../../../shared/schema/integration");
    const { eq, and } = await import("drizzle-orm");

    // Resolve the actual providerId
    const manifest = connectorRegistry.get(providerOrConnectorId);
    const providerId = manifest?.providerId || providerOrConnectorId;

    // Find active account for this user+provider
    const accounts = await db
      .select()
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, providerId),
          eq(integrationAccounts.status, "active")
        )
      )
      .limit(1);

    if (accounts.length === 0) return null;

    const account = accounts[0];

    // Check if token needs refresh
    const accessToken = this.decrypt(account.accessToken || "");
    const refreshToken = account.refreshToken ? this.decrypt(account.refreshToken) : undefined;
    const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;

    if (expiresAt && refreshToken && Date.now() > expiresAt.getTime() - REFRESH_BUFFER_MS) {
      // Token is expired or about to expire — refresh
      const refreshed = await this.refreshOAuthToken(providerId, refreshToken, manifest);
      if (refreshed) {
        // Update DB with new tokens
        await db
          .update(integrationAccounts)
          .set({
            accessToken: this.encrypt(refreshed.accessToken),
            refreshToken: refreshed.refreshToken
              ? this.encrypt(refreshed.refreshToken)
              : account.refreshToken,
            tokenExpiresAt: refreshed.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(integrationAccounts.id, account.id));

        return {
          accountId: account.id,
          providerId,
          userId,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || refreshToken,
          scopes: account.scopes ? account.scopes.split(",").map((s) => s.trim()) : [],
          metadata: (account.metadata as Record<string, unknown>) || {},
          expiresAt: refreshed.expiresAt,
        };
      }
      // Refresh failed — return existing token (might still work briefly)
    }

    return {
      accountId: account.id,
      providerId,
      userId,
      accessToken,
      refreshToken,
      scopes: account.scopes ? account.scopes.split(",").map((s) => s.trim()) : [],
      metadata: (account.metadata as Record<string, unknown>) || {},
      expiresAt: expiresAt || undefined,
    };
  }

  // ─── Token Storage ──────────────────────────────────────────────

  /** Store a credential after OAuth callback or API key entry */
  async store(
    userId: string,
    providerId: string,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: Date;
      scopes?: string[];
      externalUserId?: string;
      displayName?: string;
      email?: string;
    }
  ): Promise<string> {
    const { db } = await import("../../db");
    const { integrationAccounts } = await import("../../../shared/schema/integration");
    const { eq, and } = await import("drizzle-orm");
    const { randomUUID } = await import("crypto");

    const id = randomUUID();
    const now = new Date();

    // Check for existing account
    const existing = await db
      .select()
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, providerId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update existing
      await db
        .update(integrationAccounts)
        .set({
          accessToken: this.encrypt(tokens.accessToken),
          refreshToken: tokens.refreshToken ? this.encrypt(tokens.refreshToken) : existing[0].refreshToken,
          tokenExpiresAt: tokens.expiresAt || null,
          scopes: tokens.scopes?.join(",") || existing[0].scopes,
          externalUserId: tokens.externalUserId || existing[0].externalUserId,
          displayName: tokens.displayName || existing[0].displayName,
          email: tokens.email || existing[0].email,
          status: "active",
          updatedAt: now,
        })
        .where(eq(integrationAccounts.id, existing[0].id));

      return existing[0].id;
    }

    // Insert new
    await db.insert(integrationAccounts).values({
      id,
      userId,
      providerId,
      accessToken: this.encrypt(tokens.accessToken),
      refreshToken: tokens.refreshToken ? this.encrypt(tokens.refreshToken) : null,
      tokenExpiresAt: tokens.expiresAt || null,
      scopes: tokens.scopes?.join(",") || null,
      externalUserId: tokens.externalUserId || null,
      displayName: tokens.displayName || null,
      email: tokens.email || null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    return id;
  }

  /** Revoke a credential — marks the account as inactive */
  async revoke(userId: string, accountIdOrProviderId: string): Promise<void> {
    const { db } = await import("../../db");
    const { integrationAccounts } = await import("../../../shared/schema/integration");
    const { eq, and, or } = await import("drizzle-orm");

    await db
      .update(integrationAccounts)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          or(
            eq(integrationAccounts.id, accountIdOrProviderId),
            eq(integrationAccounts.providerId, accountIdOrProviderId)
          )
        )
      );
  }

  /** Check if a user has an active credential for a provider */
  async hasCredential(userId: string, providerOrConnectorId: string): Promise<boolean> {
    const cred = await this.resolve(userId, providerOrConnectorId);
    return cred !== null;
  }

  // ─── OAuth Token Refresh ────────────────────────────────────────

  private async refreshOAuthToken(
    providerId: string,
    refreshToken: string,
    manifest?: import("./types").ConnectorManifest | null
  ): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date } | null> {
    // Find the OAuth config — either from manifest or hardcoded known providers
    let tokenUrl: string | undefined;
    let clientId: string | undefined;
    let clientSecret: string | undefined;

    if (manifest?.authConfig && "tokenUrl" in manifest.authConfig) {
      const oauthConfig = manifest.authConfig as import("./types").OAuthConfig;
      tokenUrl = oauthConfig.tokenUrl;
    }

    // Hardcoded known providers for backward compatibility
    switch (providerId) {
      case "google":
        tokenUrl = tokenUrl || "https://oauth2.googleapis.com/token";
        clientId = process.env.GOOGLE_CLIENT_ID;
        clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        break;
      case "microsoft":
        tokenUrl = tokenUrl || `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || "common"}/oauth2/v2.0/token`;
        clientId = process.env.MICROSOFT_CLIENT_ID;
        clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
        break;
      case "slack":
        tokenUrl = tokenUrl || "https://slack.com/api/oauth.v2.access";
        clientId = process.env.SLACK_CLIENT_ID;
        clientSecret = process.env.SLACK_CLIENT_SECRET;
        break;
      case "notion":
        tokenUrl = tokenUrl || "https://api.notion.com/v1/oauth/token";
        clientId = process.env.NOTION_CLIENT_ID;
        clientSecret = process.env.NOTION_CLIENT_SECRET;
        break;
      case "hubspot":
        tokenUrl = tokenUrl || "https://api.hubapi.com/oauth/v1/token";
        clientId = process.env.HUBSPOT_CLIENT_ID;
        clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
        break;
      case "github":
        tokenUrl = tokenUrl || "https://github.com/login/oauth/access_token";
        clientId = process.env.GITHUB_CLIENT_ID;
        clientSecret = process.env.GITHUB_CLIENT_SECRET;
        break;
      default:
        // Try env vars by convention: {PROVIDER}_CLIENT_ID, {PROVIDER}_CLIENT_SECRET
        const envPrefix = providerId.toUpperCase().replace(/-/g, "_");
        clientId = process.env[`${envPrefix}_CLIENT_ID`];
        clientSecret = process.env[`${envPrefix}_CLIENT_SECRET`];
        break;
    }

    if (!tokenUrl || !clientId || !clientSecret) {
      console.warn(`[CredentialVault] Cannot refresh token for provider "${providerId}" — missing config`);
      return null;
    }

    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.warn(`[CredentialVault] Token refresh failed for "${providerId}": ${response.status} ${text}`);
        return null;
      }

      const data = (await response.json()) as Record<string, unknown>;
      const accessToken = String(data.access_token || "");
      const newRefreshToken = data.refresh_token ? String(data.refresh_token) : undefined;
      const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      if (!accessToken) {
        console.warn(`[CredentialVault] Token refresh returned empty access_token for "${providerId}"`);
        return null;
      }

      return { accessToken, refreshToken: newRefreshToken, expiresAt };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[CredentialVault] Token refresh error for "${providerId}": ${msg}`);
      return null;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────

export const credentialVault = new CredentialVault();
