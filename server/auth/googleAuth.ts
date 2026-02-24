/**
 * Google OAuth Authentication
 * Implements OAuth 2.0 for Google account login
 */
import { Router, Request, Response } from "express";
import { authStorage } from "../replit_integrations/auth/storage";
import { storage } from "../storage";
import { env } from "../config/env";

const router = Router();

// CANONICAL URL for OAuth redirects (avoid www/non-www mismatch)
// This MUST match exactly what's registered in Google Cloud Console
const CANONICAL_DOMAIN = process.env.CANONICAL_DOMAIN || "iliagpt.com";

// Helper to get canonical redirect URI (production uses HTTPS + canonical domain)
const getCanonicalRedirectUri = (req: Request, path: string): string => {
    if (env.NODE_ENV === "production") {
        // Always use canonical domain in production to avoid redirect_uri_mismatch
        return `https://${CANONICAL_DOMAIN}${path}`;
    }
    // Development: use request host
    return `${req.protocol}://${req.get("host")}${path}`;
};

// Google OAuth Configuration
const getGoogleConfig = () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.warn("[Google Auth] Missing credentials:", {
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
        });
        return null;
    }

    return {
        clientId,
        clientSecret,
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    };
};

// Check if Google OAuth is configured
export const isGoogleConfigured = (): boolean => {
    return getGoogleConfig() !== null;
};

// Helper to generate random state for CSRF protection
const generateState = (): string => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

// Store states temporarily (in production, use Redis)
const stateStore = new Map<string, { createdAt: number; returnUrl: string }>();

// Cleanup old states every 5 minutes
setInterval(() => {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes
    for (const [state, data] of stateStore.entries()) {
        if (now - data.createdAt > maxAge) {
            stateStore.delete(state);
        }
    }
}, 5 * 60 * 1000);

/**
 * GET /api/auth/google
 * Initiates Google OAuth login flow
 */
router.get("/google", (req: Request, res: Response) => {
    const config = getGoogleConfig();

    if (!config) {
        console.error("[Google Auth] Google OAuth not configured");
        return res.redirect("/login?error=google_not_configured");
    }

    const state = generateState();
    const returnUrl = (req.query.returnUrl as string) || "/";
    stateStore.set(state, { createdAt: Date.now(), returnUrl });

    // Use canonical redirect URI to match Google Cloud Console configuration
    const redirectUri = getCanonicalRedirectUri(req, "/api/auth/google/callback");

    console.log("[Google Auth] Using redirect_uri:", redirectUri);
    console.log("[Google Auth] Request host:", req.get("host"));
    console.log("[Google Auth] Canonical domain:", CANONICAL_DOMAIN);

    const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "openid email profile",
        state,
        access_type: "offline",
        prompt: "consent",
    });

    const authUrl = `${config.authorizationUrl}?${params.toString()}`;
    console.log("[Google Auth] Redirecting to Google login");
    res.redirect(authUrl);
});

/**
 * GET /api/auth/google/callback
 * Handles the OAuth callback from Google
 */
router.get("/google/callback", async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
        console.error("[Google Auth] OAuth error:", error, error_description);
        return res.redirect(`/login?error=google_auth_failed&message=${encodeURIComponent(error_description as string || "")}`);
    }

    if (!code || !state) {
        console.error("[Google Auth] Missing code or state");
        return res.redirect("/login?error=google_invalid_response");
    }

    // Verify state
    const stateData = stateStore.get(state as string);
    if (!stateData) {
        console.error("[Google Auth] Invalid or expired state");
        return res.redirect("/login?error=google_invalid_state");
    }
    stateStore.delete(state as string);

    const config = getGoogleConfig();
    if (!config) {
        return res.redirect("/login?error=google_not_configured");
    }

    try {
        // Use same canonical redirect URI as in /google route
        const redirectUri = getCanonicalRedirectUri(req, "/api/auth/google/callback");
        console.log("[Google Auth] Callback - Using redirect_uri:", redirectUri);

        // Exchange code for tokens
        const tokenResponse = await fetch(config.tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                client_id: config.clientId,
                client_secret: config.clientSecret,
                code: code as string,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
            }),
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error("[Google Auth] Token exchange failed:", errorData);
            return res.redirect("/login?error=google_token_failed");
        }

        const tokens = await tokenResponse.json();

        // Get user info from Google
        const userResponse = await fetch(config.userInfoUrl, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        });

        if (!userResponse.ok) {
            console.error("[Google Auth] Failed to get user info");
            return res.redirect("/login?error=google_userinfo_failed");
        }

        const googleUser = await userResponse.json();
        console.log("[Google Auth] User info received:", {
            id: googleUser.id,
            email: googleUser.email,
            name: googleUser.name,
        });

        // Upsert user in database
        const email = googleUser.email;
        const firstName = googleUser.given_name || googleUser.name?.split(" ")[0] || "";
        const lastName = googleUser.family_name || googleUser.name?.split(" ").slice(1).join(" ") || "";

        await authStorage.upsertUser({
            id: `google_${googleUser.id}`,
            email,
            firstName,
            lastName,
            profileImageUrl: googleUser.picture || null,
        });

        // Create session
        const sessionUser = {
            claims: {
                sub: `google_${googleUser.id}`,
                email,
                first_name: firstName,
                last_name: lastName,
                name: googleUser.name,
                picture: googleUser.picture,
            },
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600),
        };

        req.login(sessionUser, async (loginErr) => {
            if (loginErr) {
                console.error("[Google Auth] Session creation failed:", loginErr);
                return res.redirect("/login?error=session_error");
            }

            console.log("[Google Auth] req.login() successful, sessionID:", req.sessionID);

            // Update last login
            try {
                await authStorage.updateUserLogin(`google_${googleUser.id}`, {
                    ipAddress: req.ip || req.socket.remoteAddress || null,
                    userAgent: req.headers["user-agent"] || null,
                });

                await storage.createAuditLog({
                    userId: `google_${googleUser.id}`,
                    action: "user_login",
                    resource: "auth",
                    details: {
                        email,
                        provider: "google_oauth",
                    },
                    ipAddress: req.ip || req.socket.remoteAddress || null,
                    userAgent: req.headers["user-agent"] || null,
                });
            } catch (auditError) {
                console.warn("[Google Auth] Failed to create audit log:", auditError);
            }

            // Force session save before redirect (critical for OAuth flow)
            console.log("[Google Auth] Saving session before redirect...");
            console.log("[Google Auth] DEBUG - Session cookie settings:", {
                sessionID: req.sessionID,
                sessionExists: !!req.session,
                isSecure: req.secure,
                protocol: req.protocol,
                xForwardedProto: req.get('x-forwarded-proto'),
                host: req.get('host'),
            });

            req.session.save((saveErr: any) => {
                if (saveErr) {
                    console.error("[Google Auth] Session save failed:", saveErr);
                    return res.redirect("/login?error=session_save_error");
                }

                // DEBUG: Log response headers to verify Set-Cookie is being sent
                console.log("[Google Auth] Session saved successfully for:", email);
                console.log("[Google Auth] DEBUG - Response headers after save:", {
                    setCookie: res.getHeader('Set-Cookie'),
                    sessionID: req.sessionID,
                });
                console.log("[Google Auth] Redirecting to:", stateData.returnUrl || "/?auth=success");

                res.redirect(stateData.returnUrl || "/?auth=success");
            });
        });

    } catch (error: any) {
        console.error("[Google Auth] Callback error:", error);
        return res.redirect("/login?error=google_error");
    }
});

/**
 * GET /api/auth/google/status
 * Returns whether Google OAuth is configured
 */
router.get("/google/status", (_req: Request, res: Response) => {
    const config = getGoogleConfig();
    res.json({
        configured: config !== null,
        hasClientId: !!process.env.GOOGLE_CLIENT_ID,
        hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    });
});

/**
 * GET /api/auth/google/debug
 * DEBUG endpoint to check session/cookie status (temporary - remove in production)
 */
router.get("/google/debug", (req: Request, res: Response) => {
    const sessionCookie = req.cookies?.["siragpt.sid"];
    const hasSession = !!req.session;
    const hasUser = !!(req as any).user;

    console.log("[Google Auth] DEBUG endpoint called:", {
        cookies: Object.keys(req.cookies || {}),
        hasSessionCookie: !!sessionCookie,
        hasSession,
        hasUser,
        sessionID: req.sessionID,
        isSecure: req.secure,
        protocol: req.protocol,
        xForwardedProto: req.get("x-forwarded-proto"),
        host: req.get("host"),
        origin: req.get("origin"),
    });

    res.json({
        auth: {
            hasSession,
            hasUser,
            sessionID: req.sessionID,
            userEmail: hasUser ? (req as any).user?.claims?.email : null,
        },
        cookies: {
            hasSessionCookie: !!sessionCookie,
            receivedCookies: Object.keys(req.cookies || {}),
        },
        request: {
            isSecure: req.secure,
            protocol: req.protocol,
            xForwardedProto: req.get("x-forwarded-proto"),
            host: req.get("host"),
            origin: req.get("origin"),
        },
        config: {
            canonicalDomain: CANONICAL_DOMAIN,
            nodeEnv: env.NODE_ENV,
        },
    });
});

export default router;
