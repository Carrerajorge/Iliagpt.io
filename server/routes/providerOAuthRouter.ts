/**
 * providerOAuthRouter — Multi-provider OAuth routes.
 *
 * OpenAI: PKCE OAuth flow
 * Gemini: Google OAuth2 flow
 * Anthropic: Manual API key submission
 *
 * Query param `?scope=global` stores token as global (admin only).
 */

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { getUserId } from "../types/express";
import { providersService } from "../services/providersService";
import type { OAuthProvider } from "../services/providerAdapters";
import {
  getOpenAIWebOAuthAvailability,
  isGoogleGeminiDirectOAuthAvailable,
} from "../services/providerOAuthAvailability";

const router = Router();

// ─── In-memory PKCE store (short-lived) ──────────────────────────────────────

interface PkceFlowRecord {
  userId: string;
  codeVerifier: string;
  oauthState: string;
  provider: OAuthProvider;
  isGlobal: boolean;
  createdAt: number;
}

const pkceFlowStore = new Map<string, PkceFlowRecord>();
const FLOW_TTL_MS = 30 * 60 * 1000;

// Clean expired flows periodically
setInterval(() => {
  const now = Date.now();
  for (const [state, flow] of pkceFlowStore) {
    if (now - flow.createdAt > FLOW_TTL_MS) {
      pkceFlowStore.delete(state);
    }
  }
}, 5 * 60 * 1000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function getCallbackUrl(req: Request, provider: string): string {
  const canonicalDomain = process.env.CANONICAL_DOMAIN || "iliagpt.com";
  if (process.env.NODE_ENV === "production") {
    return `https://${canonicalDomain}/api/oauth/providers/${provider}/callback`;
  }
  return `${req.protocol}://${req.get("host")}/api/oauth/providers/${provider}/callback`;
}

function isGlobalScope(req: Request): boolean {
  return req.query.scope === "global";
}

// ─── OpenAI OAuth (PKCE) ─────────────────────────────────────────────────────

const OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";

router.post("/openai/start", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const isGlobal = isGlobalScope(req);
    if (isGlobal) {
      // Verify admin role
      const user = (req as any).user;
      if (!user || user.role !== "ADMIN") {
        return res.status(403).json({ error: "Admin role required for global tokens" });
      }
    }

    const openAIWebOAuth = getOpenAIWebOAuthAvailability();
    if (!openAIWebOAuth.available || !openAIWebOAuth.clientId) {
      return res.status(400).json({
        error:
          openAIWebOAuth.reason ||
          "OpenAI OAuth directo no está disponible en este despliegue.",
      });
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const oauthState = crypto.randomBytes(16).toString("hex");
    const redirectUri = getCallbackUrl(req, "openai");

    pkceFlowStore.set(oauthState, {
      userId,
      codeVerifier,
      oauthState,
      provider: "openai",
      isGlobal,
      createdAt: Date.now(),
    });

    const params = new URLSearchParams({
      client_id: openAIWebOAuth.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openai.model.read openai.chat.completions.create",
      state: oauthState,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authUrl = `${OPENAI_AUTHORIZE_URL}?${params.toString()}`;

    res.json({ authUrl, state: oauthState });
  } catch (error: any) {
    console.error("[ProviderOAuth] OpenAI start error:", error);
    res.status(500).json({ error: "Failed to start OAuth flow" });
  }
});

router.get("/openai/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError || !code || !state) {
      return res.status(400).send(renderCallbackPage("error", oauthError as string || "Missing parameters"));
    }

    const flow = pkceFlowStore.get(state as string);
    if (!flow) {
      return res.status(400).send(renderCallbackPage("error", "Invalid or expired state"));
    }

    const openAIWebOAuth = getOpenAIWebOAuthAvailability();
    if (!openAIWebOAuth.available || !openAIWebOAuth.clientId) {
      pkceFlowStore.delete(state as string);
      return res
        .status(400)
        .send(
          renderCallbackPage(
            "error",
            openAIWebOAuth.reason ||
              "OpenAI OAuth directo no está disponible en este despliegue.",
          ),
        );
    }

    pkceFlowStore.delete(state as string);

    const redirectUri = getCallbackUrl(req, "openai");

    // Exchange code for tokens
    const tokenResponse = await fetch(OPENAI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: redirectUri,
        client_id: openAIWebOAuth.clientId,
        code_verifier: flow.codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.error("[ProviderOAuth] OpenAI token exchange failed:", errorBody);
      return res.status(400).send(renderCallbackPage("error", "Token exchange failed"));
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
    };

    const expiresAt = tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : null;

    if (flow.isGlobal) {
      await providersService.saveGlobalToken(
        "openai",
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt,
        "openai.model.read openai.chat.completions.create",
        "OpenAI Global",
        flow.userId,
      );
    } else {
      await providersService.saveUserToken(
        flow.userId,
        "openai",
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt,
        "openai.model.read openai.chat.completions.create",
      );
    }

    res.send(renderCallbackPage("success", "OpenAI conectado exitosamente"));
  } catch (error: any) {
    console.error("[ProviderOAuth] OpenAI callback error:", error);
    res.status(500).send(renderCallbackPage("error", error.message));
  }
});

router.get("/openai/status", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const globalStatus = await providersService.getGlobalTokenStatus("openai");
    const userStatus = userId
      ? await providersService.getUserTokenStatus(userId, "openai")
      : { connected: false };
    const openAIWebOAuth = getOpenAIWebOAuthAvailability();

    res.json({
      provider: "openai",
      globalConnected: globalStatus.connected,
      globalLabel: globalStatus.label,
      userConnected: userStatus.connected,
      connected: userStatus.connected || globalStatus.connected,
      available: openAIWebOAuth.available,
      availabilityReason: openAIWebOAuth.reason,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/openai/disconnect", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const isGlobal = isGlobalScope(req);
    if (isGlobal) {
      await providersService.deleteGlobalToken("openai");
    } else {
      await providersService.deleteUserToken(userId, "openai");
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Gemini OAuth (Google OAuth2) ────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GEMINI_SCOPE = "https://www.googleapis.com/auth/generative-language";

router.post("/gemini/start", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({ error: "Google OAuth not configured" });
    }

    const isGlobal = isGlobalScope(req);
    if (isGlobal) {
      const user = (req as any).user;
      if (!user || user.role !== "ADMIN") {
        return res.status(403).json({ error: "Admin role required for global tokens" });
      }
    }

    const oauthState = crypto.randomBytes(16).toString("hex");
    const codeVerifier = generateCodeVerifier();
    const redirectUri = getCallbackUrl(req, "gemini");

    pkceFlowStore.set(oauthState, {
      userId,
      codeVerifier,
      oauthState,
      provider: "gemini",
      isGlobal,
      createdAt: Date.now(),
    });

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GEMINI_SCOPE,
      state: oauthState,
      access_type: "offline",
      prompt: "consent",
    });

    const authUrl = `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;

    res.json({ authUrl, state: oauthState });
  } catch (error: any) {
    console.error("[ProviderOAuth] Gemini start error:", error);
    res.status(500).json({ error: "Failed to start OAuth flow" });
  }
});

router.get("/gemini/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError || !code || !state) {
      return res.status(400).send(renderCallbackPage("error", oauthError as string || "Missing parameters"));
    }

    const flow = pkceFlowStore.get(state as string);
    if (!flow || flow.provider !== "gemini") {
      return res.status(400).send(renderCallbackPage("error", "Invalid or expired state"));
    }

    pkceFlowStore.delete(state as string);

    const redirectUri = getCallbackUrl(req, "gemini");

    // Exchange code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: redirectUri,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.error("[ProviderOAuth] Gemini token exchange failed:", errorBody);
      return res.status(400).send(renderCallbackPage("error", "Token exchange failed"));
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const expiresAt = tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : null;

    if (flow.isGlobal) {
      await providersService.saveGlobalToken(
        "gemini",
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt,
        GEMINI_SCOPE,
        "Gemini Global",
        flow.userId,
      );
    } else {
      await providersService.saveUserToken(
        flow.userId,
        "gemini",
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt,
        GEMINI_SCOPE,
      );
    }

    res.send(renderCallbackPage("success", "Google Gemini conectado exitosamente"));
  } catch (error: any) {
    console.error("[ProviderOAuth] Gemini callback error:", error);
    res.status(500).send(renderCallbackPage("error", error.message));
  }
});

router.get("/gemini/status", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const globalStatus = await providersService.getGlobalTokenStatus("gemini");
    const userStatus = userId
      ? await providersService.getUserTokenStatus(userId, "gemini")
      : { connected: false };

    res.json({
      provider: "gemini",
      globalConnected: globalStatus.connected,
      globalLabel: globalStatus.label,
      userConnected: userStatus.connected,
      connected: userStatus.connected || globalStatus.connected,
      available: isGoogleGeminiDirectOAuthAvailable(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/gemini/disconnect", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const isGlobal = isGlobalScope(req);
    if (isGlobal) {
      await providersService.deleteGlobalToken("gemini");
    } else {
      await providersService.deleteUserToken(userId, "gemini");
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Anthropic (Manual API Key) ──────────────────────────────────────────────

router.post("/anthropic/key", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { apiKey, label } = req.body;
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
      return res.status(400).json({ error: "Invalid API key" });
    }

    const isGlobal = isGlobalScope(req);
    if (isGlobal) {
      const user = (req as any).user;
      if (!user || user.role !== "ADMIN") {
        return res.status(403).json({ error: "Admin role required for global tokens" });
      }
    }

    // Validate the key by making a test call
    try {
      const testResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      if (!testResponse.ok) {
        const errorBody = await testResponse.text();
        console.error("[ProviderOAuth] Anthropic key validation failed:", errorBody);
        return res.status(400).json({ error: "API key validation failed. Please check the key." });
      }
    } catch (err: any) {
      return res.status(400).json({ error: `API key validation failed: ${err.message}` });
    }

    if (isGlobal) {
      await providersService.saveGlobalToken(
        "anthropic",
        apiKey.trim(),
        null,
        null, // API keys don't expire
        null,
        label || "Anthropic Global",
        userId,
      );
    } else {
      await providersService.saveUserToken(
        userId,
        "anthropic",
        apiKey.trim(),
        null,
        null,
        null,
      );
    }

    res.json({ success: true, provider: "anthropic" });
  } catch (error: any) {
    console.error("[ProviderOAuth] Anthropic key error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/anthropic/status", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const globalStatus = await providersService.getGlobalTokenStatus("anthropic");
    const userStatus = userId
      ? await providersService.getUserTokenStatus(userId, "anthropic")
      : { connected: false };

    res.json({
      provider: "anthropic",
      globalConnected: globalStatus.connected,
      globalLabel: globalStatus.label,
      userConnected: userStatus.connected,
      connected: userStatus.connected || globalStatus.connected,
      available: true,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/anthropic/disconnect", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const isGlobal = isGlobalScope(req);
    if (isGlobal) {
      await providersService.deleteGlobalToken("anthropic");
    } else {
      await providersService.deleteUserToken(userId, "anthropic");
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Combined Status ─────────────────────────────────────────────────────────

router.get("/status", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const providers: OAuthProvider[] = ["openai", "gemini", "anthropic"];
    const statuses: Record<string, any> = {};

    for (const provider of providers) {
      const globalStatus = await providersService.getGlobalTokenStatus(provider);
      const userStatus = userId
        ? await providersService.getUserTokenStatus(userId, provider)
        : { connected: false };
      const openAIWebOAuth =
        provider === "openai" ? getOpenAIWebOAuthAvailability() : null;

      statuses[provider] = {
        globalConnected: globalStatus.connected,
        globalLabel: globalStatus.label,
        userConnected: userStatus.connected,
        connected: userStatus.connected || globalStatus.connected,
        available:
          provider === "openai"
            ? openAIWebOAuth?.available ?? false
            : provider === "gemini"
              ? isGoogleGeminiDirectOAuthAvailable()
              : true,
        availabilityReason:
          provider === "openai" ? openAIWebOAuth?.reason ?? null : null,
      };
    }

    res.json({ providers: statuses });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Callback Page Renderer ──────────────────────────────────────────────────

function renderCallbackPage(status: "success" | "error", message: string): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const isSuccess = status === "success";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OAuth ${isSuccess ? "Completado" : "Error"}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #07131f; color: #f8fafc; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; }
    .card { max-width: 440px; background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 20px; padding: 32px; text-align: center; }
    h1 { font-size: 22px; margin: 0 0 12px; color: ${isSuccess ? "#22c55e" : "#ef4444"}; }
    p { color: #94a3b8; margin: 8px 0; }
    .icon { font-size: 48px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isSuccess ? "✅" : "❌"}</div>
    <h1>${isSuccess ? "Conexión exitosa" : "Error de conexión"}</h1>
    <p>${message}</p>
    <p style="margin-top: 20px; font-size: 14px;">Puedes cerrar esta ventana.</p>
  </div>
  <script nonce="${nonce}">
    try {
      window.opener && window.opener.postMessage({
        type: "provider-oauth-result",
        status: "${status}",
        message: ${JSON.stringify(message)}
      }, window.location.origin);
      setTimeout(() => window.close(), 2000);
    } catch(e) {}
  </script>
</body>
</html>`;
}

export default router;
