/**
 * Microsoft OAuth Authentication
 * Implements OAuth 2.0 with Azure AD for Microsoft account login
 */
import { Router, Request, Response } from "express";
import { authStorage } from "../replit_integrations/auth/storage";
import { storage } from "../storage";
import { env } from "../config/env";

const router = Router();

// Microsoft OAuth Configuration
const getMicrosoftConfig = () => {
    const clientId = env.MICROSOFT_CLIENT_ID;
    const clientSecret = env.MICROSOFT_CLIENT_SECRET;
    const tenantId = env.MICROSOFT_TENANT_ID;

    // Check if all required credentials are present
    if (!clientId || !clientSecret || !tenantId) {
        return null;
    }

    return {
        clientId,
        clientSecret,
        tenantId,
        authorizationUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        userInfoUrl: "https://graph.microsoft.com/v1.0/me",
    };
};

// Check if Microsoft OAuth is configured
export const isMicrosoftConfigured = (): boolean => {
    return getMicrosoftConfig() !== null;
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
 * GET /api/auth/microsoft
 * Initiates Microsoft OAuth login flow
 */
router.get("/microsoft", (req: Request, res: Response) => {
    const config = getMicrosoftConfig();

    if (!config) {
        console.error("[Microsoft Auth] Microsoft OAuth not configured");
        return res.redirect("/login?error=microsoft_not_configured");
    }

    const state = generateState();
    const returnUrl = (req.query.returnUrl as string) || "/";
    stateStore.set(state, { createdAt: Date.now(), returnUrl });

    const protocol = env.NODE_ENV === "production" ? "https" : req.protocol;
    const redirectUri = `${protocol}://${req.get("host")}/api/auth/microsoft/callback`;

    const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "openid profile email User.Read",
        state,
        response_mode: "query",
    });

    const authUrl = `${config.authorizationUrl}?${params.toString()}`;
    console.log("[Microsoft Auth] Redirecting to Microsoft login");
    res.redirect(authUrl);
});

/**
 * GET /api/auth/microsoft/callback
 * Handles the OAuth callback from Microsoft
 */
router.get("/microsoft/callback", async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
        console.error("[Microsoft Auth] OAuth error:", error, error_description);
        return res.redirect(`/login?error=microsoft_auth_failed&message=${encodeURIComponent(error_description as string || "")}`);
    }

    if (!code || !state) {
        console.error("[Microsoft Auth] Missing code or state");
        return res.redirect("/login?error=microsoft_invalid_response");
    }

    // Verify state
    const stateData = stateStore.get(state as string);
    if (!stateData) {
        console.error("[Microsoft Auth] Invalid or expired state");
        return res.redirect("/login?error=microsoft_invalid_state");
    }
    stateStore.delete(state as string);

    const config = getMicrosoftConfig();
    if (!config) {
        return res.redirect("/login?error=microsoft_not_configured");
    }

    try {
        const protocol = env.NODE_ENV === "production" ? "https" : req.protocol;
        const redirectUri = `${protocol}://${req.get("host")}/api/auth/microsoft/callback`;

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
            console.error("[Microsoft Auth] Token exchange failed:", errorData);
            return res.redirect("/login?error=microsoft_token_failed");
        }

        const tokens = await tokenResponse.json();

        // Get user info from Microsoft Graph
        const userResponse = await fetch(config.userInfoUrl, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        });

        if (!userResponse.ok) {
            console.error("[Microsoft Auth] Failed to get user info");
            return res.redirect("/login?error=microsoft_userinfo_failed");
        }

        const msUser = await userResponse.json();
        console.log("[Microsoft Auth] User info received:", {
            id: msUser.id,
            email: msUser.mail || msUser.userPrincipalName,
            displayName: msUser.displayName,
        });

        // Upsert user in database
        const email = msUser.mail || msUser.userPrincipalName;
        const nameParts = (msUser.displayName || "").split(" ");
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";

        await authStorage.upsertUser({
            id: `ms_${msUser.id}`,
            email,
            firstName,
            lastName,
            profileImageUrl: null, // Microsoft Graph requires separate call for photo
        });

        // Create session
        const sessionUser = {
            claims: {
                sub: `ms_${msUser.id}`,
                email,
                first_name: firstName,
                last_name: lastName,
                name: msUser.displayName,
            },
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600),
        };

        req.login(sessionUser, async (loginErr) => {
            if (loginErr) {
                console.error("[Microsoft Auth] Session creation failed:", loginErr);
                return res.redirect("/login?error=session_error");
            }

            console.log("[Microsoft Auth] req.login() successful, sessionID:", req.sessionID);

            // Update last login
            try {
                await authStorage.updateUserLogin(`ms_${msUser.id}`, {
                    ipAddress: req.ip || req.socket.remoteAddress || null,
                    userAgent: req.headers["user-agent"] || null,
                });

                await storage.createAuditLog({
                    userId: `ms_${msUser.id}`,
                    action: "user_login",
                    resource: "auth",
                    details: {
                        email,
                        provider: "microsoft_oauth",
                    },
                    ipAddress: req.ip || req.socket.remoteAddress || null,
                    userAgent: req.headers["user-agent"] || null,
                });
            } catch (auditError) {
                console.warn("[Microsoft Auth] Failed to create audit log:", auditError);
            }

            // Force session save before redirect (critical for OAuth flow)
            console.log("[Microsoft Auth] Saving session before redirect...");
            req.session.save((saveErr: any) => {
                if (saveErr) {
                    console.error("[Microsoft Auth] Session save failed:", saveErr);
                    return res.redirect("/login?error=session_save_error");
                }
                console.log("[Microsoft Auth] Session saved successfully for:", email);
                console.log("[Microsoft Auth] Redirecting to:", stateData.returnUrl || "/?auth=success");
                res.redirect(stateData.returnUrl || "/?auth=success");
            });
        });

    } catch (error: any) {
        console.error("[Microsoft Auth] Callback error:", error);
        return res.redirect("/login?error=microsoft_error");
    }
});

/**
 * GET /api/auth/microsoft/status
 * Returns whether Microsoft OAuth is configured
 */
router.get("/microsoft/status", (_req: Request, res: Response) => {
    res.json({ configured: isMicrosoftConfigured() });
});

export default router;
