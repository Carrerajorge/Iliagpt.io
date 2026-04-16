/**
 * OAuth Token Refresh Cron Job
 *
 * Runs every 30 minutes to refresh tokens expiring within the next 10 minutes.
 * Supports OpenAI and Google (Gemini) token refresh.
 * Anthropic API keys don't expire.
 */

import { decrypt } from "../services/encryption";
import { providersService } from "../services/providersService";
import { getOpenAIWebOAuthAvailability } from "../services/providerOAuthAvailability";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const EXPIRY_BUFFER_MS = 10 * 60 * 1000; // 10 minutes

// ─── Provider-Specific Refresh Logic ─────────────────────────────────────────

const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

async function refreshOpenAIToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
} | null> {
  try {
    const openAIWebOAuth = getOpenAIWebOAuthAvailability();
    if (!openAIWebOAuth.available || !openAIWebOAuth.clientId) {
      console.warn(
        "[TokenRefresh] OpenAI direct OAuth is not configured for web refresh, skipping token refresh",
      );
      return null;
    }

    const response = await fetch(OPENAI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: openAIWebOAuth.clientId,
      }),
    });

    if (!response.ok) {
      console.error("[TokenRefresh] OpenAI refresh failed:", response.status);
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || null,
    };
  } catch (error: any) {
    console.error("[TokenRefresh] OpenAI refresh error:", error.message);
    return null;
  }
}

async function refreshGeminiToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
} | null> {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.warn("[TokenRefresh] Google OAuth not configured, skipping Gemini refresh");
      return null;
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      console.error("[TokenRefresh] Gemini refresh failed:", response.status);
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || null,
    };
  } catch (error: any) {
    console.error("[TokenRefresh] Gemini refresh error:", error.message);
    return null;
  }
}

// ─── Main Refresh Logic ─────────────────────────────────────────────────────

async function refreshExpiringTokens(): Promise<void> {
  try {
    const { globalTokens, userTokens } = await providersService.getExpiringTokens(EXPIRY_BUFFER_MS);

    let refreshed = 0;
    let failed = 0;

    // Process global tokens
    for (const token of globalTokens) {
      if (token.provider === "anthropic") continue; // API keys don't expire
      if (!token.refreshToken) continue;

      try {
        const decryptedRefresh = decrypt(token.refreshToken);
        const refreshFn = token.provider === "openai" ? refreshOpenAIToken : refreshGeminiToken;
        const result = await refreshFn(decryptedRefresh);

        if (result) {
          const newExpiresAt = result.expiresIn ? Date.now() + result.expiresIn * 1000 : null;
          await providersService.updateGlobalTokenAfterRefresh(
            token.id,
            result.accessToken,
            result.refreshToken || decryptedRefresh, // Keep old refresh token if none returned
            newExpiresAt,
          );
          refreshed++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error(`[TokenRefresh] Failed to refresh global ${token.provider} token:`, (err as Error).message);
        failed++;
      }
    }

    // Process user tokens
    for (const token of userTokens) {
      if (token.provider === "anthropic") continue;
      if (!token.refreshToken) continue;

      try {
        const decryptedRefresh = decrypt(token.refreshToken);
        const refreshFn = token.provider === "openai" ? refreshOpenAIToken : refreshGeminiToken;
        const result = await refreshFn(decryptedRefresh);

        if (result) {
          const newExpiresAt = result.expiresIn ? Date.now() + result.expiresIn * 1000 : null;
          await providersService.updateUserTokenAfterRefresh(
            token.id,
            result.accessToken,
            result.refreshToken || decryptedRefresh,
            newExpiresAt,
          );
          refreshed++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error(`[TokenRefresh] Failed to refresh user ${token.provider} token:`, (err as Error).message);
        failed++;
      }
    }

    if (refreshed > 0 || failed > 0) {
      console.log(`[TokenRefresh] Completed: ${refreshed} refreshed, ${failed} failed`);
    }
  } catch (error: any) {
    console.error("[TokenRefresh] Job error:", error.message);
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

let refreshInterval: ReturnType<typeof setInterval> | null = null;

export function startOAuthTokenRefreshJob(): void {
  if (refreshInterval) return;

  console.log("[TokenRefresh] Starting OAuth token refresh job (every 30min)");
  refreshInterval = setInterval(refreshExpiringTokens, REFRESH_INTERVAL_MS);

  // Run once on startup after a short delay
  setTimeout(refreshExpiringTokens, 10_000);
}

export function stopOAuthTokenRefreshJob(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}
