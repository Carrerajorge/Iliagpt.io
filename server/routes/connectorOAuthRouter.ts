/**
 * Connector OAuth Router Factory
 *
 * Creates Express routers for OAuth2 connector flows.
 * Reuses the existing oauthStates DB table for state management
 * (multi-replica safe, unlike in-memory Maps).
 */

import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { connectorRegistry } from "../integrations/kernel/connectorRegistry";
import { credentialVault } from "../integrations/kernel/credentialVault";
import type { OAuthConfig } from "../integrations/kernel/types";
import { getUserId } from "../types/express";
import { storage } from "../storage";
import { invalidateIntegrationPolicyCache } from "../services/integrationPolicyCache";

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/** Get the base URL for OAuth redirects */
function getBaseUrl(): string {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 5000}`;
}

function sanitizeReturnUrl(input: unknown): string {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return "/";
  // Only allow same-origin relative paths to avoid open redirects.
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}

function buildReturnRedirect(
  returnUrl: string,
  query: Record<string, string | undefined>
): string {
  const safe = sanitizeReturnUrl(returnUrl);
  const url = new URL(safe, getBaseUrl());
  for (const [k, v] of Object.entries(query)) {
    if (!v) continue;
    url.searchParams.set(k, v);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Create an OAuth2 router for a specific connector */
export function createConnectorOAuthRouter(connectorId: string): Router {
  const router = Router();

  // GET /start — Initiate OAuth flow
  router.get("/start", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const manifest = connectorRegistry.get(connectorId);
      if (!manifest) {
        return res.status(404).json({ error: `Connector "${connectorId}" not found` });
      }

      if (!manifest.authConfig || !("authorizationUrl" in manifest.authConfig)) {
        return res.status(400).json({ error: `Connector "${connectorId}" does not use OAuth` });
      }

      const oauthConfig = manifest.authConfig as OAuthConfig;
      const providerId = manifest.providerId || connectorId;
      const returnUrl = sanitizeReturnUrl(req.query.returnUrl as string | undefined);

      const clientId = getClientId(connectorId, providerId);
      const clientSecret = getClientSecret(connectorId, providerId);
      if (!clientId || !clientSecret) {
        return res.redirect(buildReturnRedirect(returnUrl, { error: "not_configured", connector: connectorId }));
      }

      const state = randomBytes(32).toString("hex");
      const redirectUri = `${getBaseUrl()}/api/connectors/oauth/${connectorId}/callback`;

      // Always store state in the session as a fallback (sessions are persisted in DB in this app).
      if ((req as any).session) {
        (req as any).session.oauthState = { state, userId, connectorId, returnUrl };
      }

      // Store state in DB (oauthStates table)
      try {
        const { db } = await import("../db");
        const { oauthStates } = await import("../../shared/schema/auth");

        await db.insert(oauthStates).values({
          state,
          returnUrl,
          provider: connectorId,
          expiresAt: new Date(Date.now() + STATE_EXPIRY_MS),
        } as any);
      } catch {
        // oauth_states table might not exist yet — session fallback above is enough.
      }

      // Merge scopes from all connectors sharing the same providerId (e.g. Google).
      // This ensures a single OAuth token covers Gmail + Drive + Calendar.
      let mergedScopes = new Set(oauthConfig.scopes);
      if (providerId !== connectorId) {
        for (const m of connectorRegistry.listEnabled()) {
          if (m.providerId === providerId && m.connectorId !== connectorId && m.authConfig && "scopes" in m.authConfig) {
            for (const s of (m.authConfig as OAuthConfig).scopes) mergedScopes.add(s);
          }
        }
      }

      // Build authorization URL
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: Array.from(mergedScopes).join(" "),
        state,
        ...(oauthConfig.offlineAccess ? { access_type: "offline", prompt: "consent" } : {}),
        ...(oauthConfig.extraAuthParams || {}),
      });

      const authUrl = `${oauthConfig.authorizationUrl}?${params.toString()}`;
      return res.redirect(authUrl);
    } catch (err: any) {
      console.error(`[ConnectorOAuth] Error starting OAuth for ${connectorId}:`, err?.message);
      return res.status(500).json({ error: "Failed to start OAuth flow" });
    }
  });

  // GET /callback — Handle OAuth callback
  router.get("/callback", async (req: Request, res: Response) => {
    let returnUrl: string = "/";
    try {
      const { code, state, error: oauthError } = req.query;

      let userId: string | undefined;

      if (!code || !state) {
        return res.redirect(buildReturnRedirect(returnUrl, { error: "missing_params", connector: connectorId }));
      }

      // Validate state (and recover returnUrl)
      let stateValid = false;
      try {
        const { db } = await import("../db");
        const { oauthStates } = await import("../../shared/schema/auth");
        const { eq } = await import("drizzle-orm");

        const [stateRecord] = await db
          .select()
          .from(oauthStates)
          .where(eq(oauthStates.state, String(state)))
          .limit(1);

        if (stateRecord && new Date() <= new Date(stateRecord.expiresAt)) {
          stateValid = true;
          returnUrl = sanitizeReturnUrl((stateRecord as any).returnUrl);
          // Delete used state
          await db.delete(oauthStates).where(eq(oauthStates.state, String(state)));
        }
      } catch {
        // ignore and fall back to session below
      }

      // Fallback: check session if DB state is missing/expired or table doesn't exist.
      if (!stateValid) {
        const sessionState = (req as any).session?.oauthState;
        if (sessionState?.state === String(state)) {
          stateValid = true;
          userId = sessionState.userId;
          returnUrl = sanitizeReturnUrl(sessionState.returnUrl);
          delete (req as any).session.oauthState;
        }
      } else {
        // Best-effort: clear matching session state to avoid stale replays.
        const sessionState = (req as any).session?.oauthState;
        if (sessionState?.state === String(state)) {
          delete (req as any).session.oauthState;
        }
      }

      if (!stateValid) {
        return res.redirect(buildReturnRedirect(returnUrl, { error: "invalid_state", connector: connectorId }));
      }

      if (oauthError) {
        return res.redirect(buildReturnRedirect(returnUrl, { error: String(oauthError), connector: connectorId }));
      }

      if (!userId) {
        userId = getUserId(req) || undefined;
      }
      if (!userId) {
        return res.redirect(buildReturnRedirect(returnUrl, { error: "auth_required", connector: connectorId }));
      }

      const manifest = connectorRegistry.get(connectorId);
      if (!manifest || !("tokenUrl" in (manifest.authConfig || {}))) {
        return res.redirect(buildReturnRedirect(returnUrl, { error: "connector_not_found", connector: connectorId }));
      }

      const oauthConfig = manifest.authConfig as OAuthConfig;
      const providerId = manifest.providerId || connectorId;
      const redirectUri = `${getBaseUrl()}/api/connectors/oauth/${connectorId}/callback`;

      const clientId = getClientId(connectorId, providerId);
      const clientSecret = getClientSecret(connectorId, providerId);
      if (!clientId || !clientSecret) {
        return res.redirect(buildReturnRedirect(returnUrl, { error: "not_configured", connector: connectorId }));
      }

      // Exchange code for tokens
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const tokenResponse = await fetch(oauthConfig.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: tokenBody,
        signal: AbortSignal.timeout(15_000),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text().catch(() => "");
        console.error(`[ConnectorOAuth] Token exchange failed for ${connectorId}: ${tokenResponse.status} ${errorText}`);
        return res.redirect(buildReturnRedirect(returnUrl, { error: "token_exchange_failed", connector: connectorId }));
      }

      const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
      const accessToken = String(tokenData.access_token || "");
      const refreshToken = tokenData.refresh_token ? String(tokenData.refresh_token) : undefined;
      const expiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600;
      const expiresAt = new Date(Date.now() + expiresIn * 1000);
      const scopes = typeof tokenData.scope === "string"
        ? tokenData.scope.split(/[\s,]+/)
        : oauthConfig.scopes;

      if (!accessToken) {
        return res.redirect(buildReturnRedirect(returnUrl, { error: "no_access_token", connector: connectorId }));
      }

      // Store credential
      await credentialVault.store(userId, providerId, {
        accessToken,
        refreshToken,
        expiresAt,
        scopes,
      });

      // Also ensure the provider exists in integrationProviders
      try {
        const { db } = await import("../db");
        const { integrationProviders } = await import("../../shared/schema/integration");
        await db
          .insert(integrationProviders)
          .values({
            id: providerId,
            name: manifest.displayName,
            description: manifest.description,
            iconUrl: manifest.iconUrl,
            authType: manifest.authType,
            category: manifest.category,
            isActive: "true",
          })
          .onConflictDoNothing();
      } catch {
        // Provider may already exist — that's OK
      }

      // Auto-enable the connector/provider in user policy so the agent can use its tools.
      try {
        const policy = await storage.getIntegrationPolicy(userId);
        const enabledApps = Array.from(new Set([...(policy?.enabledApps || []), connectorId, providerId]));
        await storage.upsertIntegrationPolicy(userId, { enabledApps });
        invalidateIntegrationPolicyCache(userId);
      } catch {
        // ignore
      }

      return res.redirect(buildReturnRedirect(returnUrl, { connected: connectorId }));
    } catch (err: any) {
      console.error(`[ConnectorOAuth] Callback error for ${connectorId}:`, err?.message);
      return res.redirect(buildReturnRedirect(returnUrl, { error: "callback_failed", connector: connectorId }));
    }
  });

  async function handleDisconnect(req: Request, res: Response) {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const manifest = connectorRegistry.get(connectorId);
      const providerId = manifest?.providerId || connectorId;
      await credentialVault.revoke(userId, providerId);

      try {
        const policy = await storage.getIntegrationPolicy(userId);
        if (policy?.enabledApps?.length) {
          const enabledApps = (policy.enabledApps || []).filter((id) => id !== connectorId && id !== providerId);
          await storage.upsertIntegrationPolicy(userId, { enabledApps });
          invalidateIntegrationPolicyCache(userId);
        }
      } catch {
        // ignore
      }

      return res.json({ success: true, disconnected: connectorId });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to disconnect" });
    }
  }

  // DELETE/POST /disconnect — Revoke credentials
  router.delete("/disconnect", handleDisconnect);
  router.post("/disconnect", handleDisconnect);

  // GET /status — Check connection status
  router.get("/status", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ connected: false });
      }

      const manifest = connectorRegistry.get(connectorId);
      const providerId = manifest?.providerId || connectorId;
      const credential = await credentialVault.resolve(userId, providerId);

      return res.json({
        connected: credential !== null,
        connectorId,
        providerId,
        scopes: credential?.scopes || [],
        expiresAt: credential?.expiresAt?.toISOString() || null,
      });
    } catch {
      return res.json({ connected: false, connectorId });
    }
  });

  return router;
}

// ─── Env var helpers ────────────────────────────────────────────────

function normalizeEnvPrefix(value: string): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getClientId(connectorId: string): string;
function getClientId(connectorId: string, providerId?: string): string {
  const connectorPrefix = normalizeEnvPrefix(connectorId);
  const providerPrefix = providerId ? normalizeEnvPrefix(providerId) : "";

  return (
    process.env[`${connectorPrefix}_CLIENT_ID`] ||
    (providerPrefix ? process.env[`${providerPrefix}_CLIENT_ID`] : "") ||
    // Allow the legacy GOOGLE_CLIENT_ID/SECRET env vars for Google-family connectors.
    (providerId === "google" ? process.env.GOOGLE_CLIENT_ID : "") ||
    ""
  );
}

function getClientSecret(connectorId: string): string;
function getClientSecret(connectorId: string, providerId?: string): string {
  const connectorPrefix = normalizeEnvPrefix(connectorId);
  const providerPrefix = providerId ? normalizeEnvPrefix(providerId) : "";

  return (
    process.env[`${connectorPrefix}_CLIENT_SECRET`] ||
    (providerPrefix ? process.env[`${providerPrefix}_CLIENT_SECRET`] : "") ||
    (providerId === "google" ? process.env.GOOGLE_CLIENT_SECRET : "") ||
    ""
  );
}
