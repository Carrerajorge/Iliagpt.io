import { Logger } from '../logger';
import * as crypto from 'crypto';
import { db } from '../../db';
import { authTokens } from '../../../shared/schema/auth';
import { eq, and, sql } from 'drizzle-orm';

type TokenProvider = 'google' | 'microsoft' | 'auth0';

interface ProviderRefreshResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
}

interface ProviderRefreshConfig {
    tokenUrl: string;
    clientId?: string;
    clientSecret?: string;
    scope?: string;
}

interface TokenRecord {
    userId: string;
    provider: TokenProvider;
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // Timestamp
    scope: string;
}

export class TokenManager {
    private encryptionKey: Buffer;

    constructor() {
        const keyString = process.env.TOKEN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
        this.encryptionKey = crypto.scryptSync(keyString, 'salt', 32);
    }

    /**
     * Store tokens securely in Postgres
     */
    async saveTokens(userId: string, provider: TokenProvider, tokens: any) {
        try {
            const accessToken = this.encrypt(tokens.access_token);
            const refreshToken = tokens.refresh_token ? this.encrypt(tokens.refresh_token) : undefined;
            const expiresAt = tokens.expiry_date || (Date.now() + (tokens.expires_in || 3600) * 1000); // Normalize expiry
            const scope = tokens.scope || '';

            // Upsert mechanism
            await db.insert(authTokens).values({
                userId,
                provider,
                accessToken,
                refreshToken,
                expiresAt,
                scope
            }).onConflictDoUpdate({
                target: [authTokens.userId, authTokens.provider],
                set: {
                    accessToken,
                    refreshToken: refreshToken || sql`auth_tokens.refresh_token`, // Keep old refresh token if not provided
                    expiresAt,
                    scope,
                    updatedAt: new Date()
                }
            });

            Logger.info(`[TokenMgr] Saved ${provider} tokens for user ${userId}`);
        } catch (error) {
            Logger.error(`[TokenMgr] Failed to save tokens: ${error}`);
            throw error;
        }
    }

    /**
     * Get valid access token (auto-refresh if needed)
     */
    async getAccessToken(userId: string, provider: TokenProvider): Promise<string | null> {
        try {
            const [record] = await db
                .select()
                .from(authTokens)
                .where(and(eq(authTokens.userId, userId), eq(authTokens.provider, provider)));

            if (!record) return null;

            // Check expiration (with 5 minute buffer)
            const expiresAt = Number(record.expiresAt);
            if (Date.now() > expiresAt - 5 * 60 * 1000) {
                Logger.info(`[TokenMgr] Token expired for ${userId}, refreshing...`);
                return this.refreshTokens(userId, provider, record);
            }

            return this.decrypt(record.accessToken);
        } catch (error) {
            Logger.error(`[TokenMgr] Failed to get access token: ${error}`);
            return null;
        }
    }

    private async refreshTokens(userId: string, provider: TokenProvider, record: TokenRecord): Promise<string | null> {
        if (!record.refreshToken) {
            Logger.warn(`[TokenMgr] No refresh token available for ${userId} ${provider}`);
            return null;
        }

        const refreshToken = this.decrypt(record.refreshToken);
        if (!refreshToken) return null;

        try {
            const refreshResult = await this.exchangeRefreshToken(provider, refreshToken);

            if (!refreshResult?.access_token) {
                Logger.warn(`[TokenMgr] Refresh response missing access token for ${provider}`);
                const expiresAt = Number(record.expiresAt);
                return expiresAt > Date.now() ? this.decrypt(record.accessToken) : null;
            }

            const accessToken = this.encrypt(refreshResult.access_token);
            const nextRefreshToken = refreshResult.refresh_token
                ? this.encrypt(refreshResult.refresh_token)
                : sql`auth_tokens.refresh_token`;

            const expiresAt = Date.now() + (((refreshResult.expires_in || 3600) * 1000));

            await db
                .update(authTokens)
                .set({
                    accessToken,
                    refreshToken: nextRefreshToken,
                    expiresAt,
                    scope: refreshResult.scope || record.scope || null,
                    updatedAt: new Date(),
                })
                .where(and(eq(authTokens.userId, userId), eq(authTokens.provider, provider)));

            Logger.info(`[TokenMgr] Refreshed token for ${userId} ${provider}`);
            return refreshResult.access_token;
        } catch (e) {
            Logger.error(`[TokenMgr] Refresh failed: ${e}`);
            const expiresAt = Number(record.expiresAt);
            return expiresAt > Date.now() ? this.decrypt(record.accessToken) : null;
        }
    }

    private async exchangeRefreshToken(
        provider: TokenProvider,
        refreshToken: string
    ): Promise<ProviderRefreshResponse | null> {
        const config = this.getRefreshConfig(provider);
        if (!config) {
            return null;
        }

        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: config.clientId || '',
            client_secret: config.clientSecret || '',
        });

        if (config.scope) {
            body.append('scope', config.scope);
        }

        let response: Response;
        try {
            response = await fetch(config.tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: body.toString(),
            });
        } catch (error) {
            Logger.error(`[TokenMgr] Token endpoint request failed for ${provider}: ${error}`);
            return null;
        }

        const rawBody = await response.text();
        let payload: ProviderRefreshResponse;
        try {
            payload = JSON.parse(rawBody) as ProviderRefreshResponse;
        } catch {
            Logger.error(`[TokenMgr] Token endpoint returned non-JSON for ${provider}: ${rawBody.slice(0, 200)}`);
            return null;
        }

        if (!response.ok || payload.error) {
            Logger.warn(`[TokenMgr] Refresh failed for ${provider}: ${payload.error || `HTTP ${response.status}`}`);
            return null;
        }

        return payload;
    }

    private getRefreshConfig(provider: TokenProvider): ProviderRefreshConfig | null {
        switch (provider) {
            case 'google': {
                const clientId = process.env.GOOGLE_CLIENT_ID;
                const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
                if (!clientId || !clientSecret) {
                    Logger.warn(`[TokenMgr] Missing GOOGLE_CLIENT_ID/SECRET for ${provider}`);
                    return null;
                }
                return {
                    tokenUrl: 'https://oauth2.googleapis.com/token',
                    clientId,
                    clientSecret,
                };
            }
            case 'microsoft': {
                const clientId = process.env.MICROSOFT_CLIENT_ID;
                const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
                if (!clientId || !clientSecret) {
                    Logger.warn(`[TokenMgr] Missing MICROSOFT_CLIENT_ID/SECRET for ${provider}`);
                    return null;
                }
                const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
                return {
                    tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
                    clientId,
                    clientSecret,
                    scope: 'https://graph.microsoft.com/.default',
                };
            }
            case 'auth0': {
                const clientId = process.env.AUTH0_CLIENT_ID;
                const clientSecret = process.env.AUTH0_CLIENT_SECRET;
                const domain = process.env.AUTH0_DOMAIN;
                if (!clientId || !clientSecret || !domain) {
                    Logger.warn(`[TokenMgr] Missing AUTH0 env vars for ${provider}`);
                    return null;
                }
                return {
                    tokenUrl: `https://${domain}/oauth/token`,
                    clientId,
                    clientSecret,
                };
            }
            default:
                return null;
        }
    }

    // AES-256-GCM Encryption
    private encrypt(text: string): string {
        if (!text) return '';
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    }

    private decrypt(ciphertext: string): string {
        if (!ciphertext) return '';
        const parts = ciphertext.split(':');
        if (parts.length !== 3) return '';

        try {
            const iv = Buffer.from(parts[0], 'hex');
            const authTag = Buffer.from(parts[1], 'hex');
            const encryptedText = parts[2];

            const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (e) {
            Logger.error(`[TokenMgr] Decryption error: ${e}`);
            return '';
        }
    }
}

export const tokenManager = new TokenManager();
