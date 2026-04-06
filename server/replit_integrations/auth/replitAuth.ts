import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, Request, RequestHandler, Response } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";
import { storage } from "../../storage";
import { withRetry } from "../../utils/retry";
import { rateLimiter as authRateLimiter } from "../../middleware/userRateLimiter";
import { recordLoginAttempt } from "../../services/twoFactorAuth";
import { getSettingValue } from "../../services/settingsConfigService";
import { setLogoutMarker } from "../../lib/logoutMarker";

const PRE_EMPTIVE_REFRESH_THRESHOLD_SECONDS = 300;
const AUTH_METRICS = {
  loginAttempts: 0,
  loginSuccess: 0,
  loginFailures: 0,
  tokenRefreshAttempts: 0,
  tokenRefreshSuccess: 0,
  tokenRefreshFailures: 0,
  sessionCreations: 0,
};

export function getAuthMetrics() {
  return { ...AUTH_METRICS };
}

function isReplitOidcEnabled(): boolean {
  return String(process.env.REPLIT_OIDC_ENABLED || "").toLowerCase() === "true";
}

function resolveSessionUserId(req: any): string | null {
  const direct = req?.user?.claims?.sub || req?.user?.id;
  if (direct) {
    return String(direct);
  }

  const session = req?.session;
  if (typeof session?.authUserId === "string" && session.authUserId) {
    return session.authUserId;
  }

  const passportUser = session?.passport?.user;
  if (typeof passportUser === "string" && passportUser) {
    return passportUser;
  }

  const passportId = passportUser?.claims?.sub || passportUser?.id || passportUser?.sub;
  if (typeof passportId === "string" && passportId) {
    return passportId;
  }

  return null;
}

function createResilientPgSessionStore(sessionTtl: number) {
  const pgStore = connectPg(session);
  const store: any = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  // Guard against malformed/corrupted rows in the sessions table.
  // Instead of failing the whole request with 500, drop the bad session
  // and continue as anonymous.
  const originalGet = typeof store.get === "function" ? store.get.bind(store) : null;
  if (originalGet) {
    store.get = (sid: string, cb: (err: any, sessionData?: any) => void) => {
      originalGet(sid, (err: any, sessionData: any) => {
        if (!err) {
          cb(null, sessionData);
          return;
        }

        console.error("[Auth] Session store get failed, clearing corrupt session:", {
          sid,
          error: err?.message || err,
        });

        const finish = () => cb(null, null);
        if (typeof store.destroy === "function") {
          store.destroy(sid, (destroyErr: any) => {
            if (destroyErr) {
              console.error("[Auth] Failed to destroy corrupt session row:", {
                sid,
                error: destroyErr?.message || destroyErr,
              });
            }
            finish();
          });
          return;
        }

        finish();
      });
    };
  }

  return store;
}

const getOidcConfig = memoize(
  async () => {
    // Mock OIDC config for local development to prevent startup hang.
    // Must be explicitly enabled to avoid accidental insecure local-dev drift.
    if (
      process.env.REPL_ID === 'local-dev'
      && process.env.NODE_ENV !== 'production'
      && process.env.LOCAL_OIDC_MOCK === 'true'
    ) {
      console.log('[Auth] Using mock OIDC config for local-dev (development only)');
      // openid-client v6 Strategy expects a Configuration object with serverMetadata and clientMetadata
      return {
        serverMetadata: {
          issuer: 'https://replit.com/oidc',
          authorization_endpoint: 'https://replit.com/oidc/auth',
          token_endpoint: 'https://replit.com/oidc/token',
          userinfo_endpoint: 'https://replit.com/oidc/userinfo',
          jwks_uri: 'https://replit.com/oidc/jwks',
        },
        clientMetadata: {
          client_id: 'local-dev',
          client_secret: 'local-secret',
          redirect_uris: ['http://localhost:5050/api/callback'],
        }
      } as any;
    }

    if (process.env.REPL_ID === 'local-dev' && process.env.NODE_ENV !== 'production') {
      throw new Error(
        "[Auth] LOCAL_OIDC_MOCK must be true when REPL_ID=local-dev."
      );
    }

    const maxRetries = 5;
    const baseDelay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Auth] OIDC discovery attempt ${attempt}/${maxRetries}...`);
        const config = await client.discovery(
          new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
          process.env.REPL_ID!
        );
        console.log(`[Auth] OIDC discovery successful on attempt ${attempt}`);
        return config;
      } catch (error: any) {
        const isRetryable =
          error.code === 'OAUTH_TIMEOUT' ||
          error.code === 'OAUTH_RESPONSE_IS_NOT_CONFORM' ||
          error.message?.includes('503') ||
          error.message?.includes('timeout');

        if (attempt === maxRetries || !isRetryable) {
          console.error(`[Auth] OIDC discovery failed after ${attempt} attempts:`, error.message);
          throw error;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.warn(`[Auth] OIDC discovery attempt ${attempt} failed (${error.code || error.message}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('OIDC discovery failed after all retries');
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const isTest = process.env.NODE_ENV === "test";

  const sessionStore = isTest
    ? undefined
    : createResilientPgSessionStore(sessionTtl);
  return session({
    name: "siragpt.sid",
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "none" as const,
      maxAge: sessionTtl,
      path: "/",
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  try {
    if (tokens.id_token) {
      user.claims = tokens.claims();
    }
  } catch (error) {
    console.warn("[Auth] Could not extract claims from token:", error);
  }

  user.access_token = tokens.access_token;

  if (tokens.refresh_token) {
    user.refresh_token = tokens.refresh_token;
  }

  if (tokens.expires_in) {
    user.expires_at = Math.floor(Date.now() / 1000) + tokens.expires_in;
  } else if (user.claims?.exp) {
    user.expires_at = user.claims.exp;
  } else {
    user.expires_at = Math.floor(Date.now() / 1000) + 3600;
  }

  user.last_refresh = Date.now();
}

async function upsertUser(claims: any) {
  const providerSub = claims["sub"];
  const email = claims["email"];

  // Block new registrations if disabled (existing users can still log in).
  try {
    const allowRegistration = await getSettingValue<boolean>("allow_registration", true);
    if (!allowRegistration) {
      const existing =
        (providerSub ? await authStorage.getUser(providerSub) : undefined) ||
        (email ? await authStorage.getUserByEmail(email) : undefined);
      if (!existing) {
        throw new Error("Registration is disabled");
      }
    }
  } catch {
    // If settings are unavailable, default to allowing login.
  }

  const firstName = claims["first_name"];
  const lastName = claims["last_name"];
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || claims["full_name"] || null;

  const dbUser = await authStorage.upsertUser({
    id: providerSub,
    email,
    fullName,
    firstName,
    lastName,
    profileImageUrl: claims["profile_image_url"],
    authProvider: "replit",
    emailVerified: "true",
  });

  // Bind the session identity to the DB primary key (stable across the app).
  // If a user already exists with the same unique email, `upsertUser()` will merge by email
  // without changing users.id; in that case we must override the session's sub to match DB id.
  if (claims && dbUser?.id && providerSub && providerSub !== dbUser.id) {
    claims["provider_sub"] = providerSub;
    claims["sub"] = dbUser.id;
  }
}

const LEGACY_LOGOUT_FALLBACK_REDIRECT = "/";

function resolvePostLogoutRedirectUri(req: Request): string {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host") || req.hostname;
  if (!host) {
    return LEGACY_LOGOUT_FALLBACK_REDIRECT;
  }

  const protocol = forwardedProto || req.protocol || "https";
  return `${protocol}://${host}`;
}

function redirectAfterLegacyLogout(req: Request, res: Response, oidcConfig: any): void {
  if (res.headersSent) {
    return;
  }

  // Always clear local session cookie.
  res.clearCookie("siragpt.sid");
  setLogoutMarker(res);

  try {
    const replId = process.env.REPL_ID;
    if (!replId || !oidcConfig) {
      res.redirect(LEGACY_LOGOUT_FALLBACK_REDIRECT);
      return;
    }

    const endSessionUrl = client.buildEndSessionUrl(oidcConfig, {
      client_id: replId,
      post_logout_redirect_uri: resolvePostLogoutRedirectUri(req),
    });

    res.redirect(endSessionUrl.href);
  } catch (error) {
    console.error("[Auth] Failed to build end-session URL, falling back to local redirect:", error);
    res.redirect(LEGACY_LOGOUT_FALLBACK_REDIRECT);
  }
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const replitOidcEnabled = isReplitOidcEnabled();
  let oidcConfig: any = null;

  // Legacy logout route kept for backward compatibility with older frontend builds.
  // This must stay available even when Replit OIDC is not configured.
  app.get("/api/logout", (req, res) => {
    const destroySessionAndRedirect = (): void => {
      if (!req.session) {
        redirectAfterLegacyLogout(req, res, oidcConfig);
        return;
      }
      req.session.destroy((sessionError: any) => {
        if (sessionError) {
          console.error("[Auth] Failed to destroy session during /api/logout:", sessionError);
        }
        redirectAfterLegacyLogout(req, res, oidcConfig);
      });
    };

    try {
      req.logout((logoutError: any) => {
        if (logoutError) {
          console.error("[Auth] req.logout failed during /api/logout:", logoutError);
        }
        destroySessionAndRedirect();
      });
    } catch (error) {
      console.error("[Auth] Unexpected /api/logout error:", error);
      destroySessionAndRedirect();
    }
  });

  // Replit OIDC is explicitly disabled by default in this deployment.
  // Keep routes for backward compatibility but route users to first-party login.
  app.get("/api/login", authRateLimiter, (req, res) => {
    return res.redirect("/login");
  });

  // Legacy callback endpoint from old Replit OIDC integrations.
  // It is intentionally disabled now; users should authenticate via first-party providers.
  app.get("/api/callback", authRateLimiter, (_req, res) => {
    return res.redirect("/login?error=replit_disabled");
  });

  if (!replitOidcEnabled) {
    console.log("[Auth] Replit OIDC disabled (REPLIT_OIDC_ENABLED != true).");
    return;
  }

  // Safety: even if toggled on by env accidentally, we keep it disabled in code
  // to avoid reintroducing external-provider lockups in production.
  console.warn("[Auth] REPLIT_OIDC_ENABLED=true is ignored; Replit OIDC is permanently disabled.");
  return;

}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const fallbackUserId = resolveSessionUserId(req as any);
  const user = req.user as any;
  const requestId = `auth-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

  if (!req.isAuthenticated?.() && !fallbackUserId) {
    return res.status(401).json({
      message: "Unauthorized",
      code: "SESSION_INVALID",
    });
  }

  // Non-OIDC sessions (email/password, phone, Google/Microsoft/Auth0 passport profiles)
  // should pass through without any refresh-token requirement.
  if (!user?.expires_at || !user?.refresh_token) {
    return next();
  }

  const now = Math.floor(Date.now() / 1000);
  const timeUntilExpiry = user.expires_at - now;

  if (timeUntilExpiry > PRE_EMPTIVE_REFRESH_THRESHOLD_SECONDS) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    return next();
  }

  if (!isReplitOidcEnabled() || !process.env.REPL_ID) {
    return next();
  }

  if (timeUntilExpiry > 0) {
    console.log(`[Auth] [${requestId}] Pre-emptive token refresh triggered, expires in ${timeUntilExpiry}s`);
  } else {
    console.log(`[Auth] [${requestId}] Token expired ${-timeUntilExpiry}s ago, attempting refresh`);
  }

  AUTH_METRICS.tokenRefreshAttempts++;

  try {
    const config = await getOidcConfig();

    const tokenResponse = await withRetry(
      () => client.refreshTokenGrant(config, refreshToken),
      {
        maxRetries: 2,
        baseDelay: 500,
        maxDelay: 2000,
        shouldRetry: (error) => {
          const errorMsg = error.message.toLowerCase();
          return errorMsg.includes('network') ||
            errorMsg.includes('timeout') ||
            errorMsg.includes('econnreset') ||
            errorMsg.includes('502') ||
            errorMsg.includes('503') ||
            errorMsg.includes('504');
        },
        onRetry: (error, attempt, delay) => {
          console.warn(`[Auth] [${requestId}] Token refresh retry ${attempt}: ${error.message}, waiting ${delay}ms`);
        },
      }
    );

    updateUserSession(user, tokenResponse);
    AUTH_METRICS.tokenRefreshSuccess++;
    console.log(`[Auth] [${requestId}] Token refresh successful for user:`, user.claims?.sub);

    return next();
  } catch (error: any) {
    AUTH_METRICS.tokenRefreshFailures++;
    console.error(`[Auth] [${requestId}] Token refresh failed:`, {
      userId: user.claims?.sub,
      error: error.message,
    });

    return res.status(401).json({
      message: "Session expired, please login again",
      code: "TOKEN_REFRESH_FAILED",
    });
  }
};

export function getSessionStats() {
  return {
    metrics: getAuthMetrics(),
    timestamp: new Date().toISOString(),
  };
}
