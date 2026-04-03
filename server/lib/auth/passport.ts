
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as MicrosoftStrategy } from "passport-microsoft";
import { Strategy as Auth0Strategy } from "passport-auth0";
import { db } from "../../db";
import { users } from "../../../shared/schema/auth";
import { eq } from "drizzle-orm";
import { tokenManager } from "./tokenManager";
import { authStorage } from "../../replit_integrations/auth/storage";
import { Logger } from "../logger";
import { env } from "../../config/env";

// Serialize user for the session
passport.serializeUser((user: any, done) => {
    try {
        // Some flows (e.g. MFA-preserved sessionUser) keep the identifier in claims.sub.
        const id = user?.id || user?.claims?.sub || user?.sub;
        if (!id) {
            return done(new Error("Cannot serialize user: missing id/claims.sub"));
        }
        done(null, String(id));
    } catch (error) {
        done(error as any);
    }
});

// Deserialize user from the session
passport.deserializeUser(async (id: string, done) => {
    try {
        const user = await authStorage.getUser(id);
        if (!user) {
            return done(null, false);
        }
        const hydratedUser = { ...user } as any;
        if (!hydratedUser.claims) {
            hydratedUser.claims = {
                sub: hydratedUser.id,
                email: hydratedUser.email,
                name: hydratedUser.fullName || hydratedUser.username,
                picture: hydratedUser.profileImageUrl,
            };
        } else if (!hydratedUser.claims.sub) {
            hydratedUser.claims.sub = hydratedUser.id;
        }
        done(null, hydratedUser);
    } catch (error) {
        done(error);
    }
});

// --- Google Strategy ---
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    const googleCallbackURL = `${env.BASE_URL}/api/auth/google/callback`;
    Logger.info(`[Passport] Google OAuth callbackURL: ${googleCallbackURL}`);
    passport.use(
        new GoogleStrategy(
            {
                clientID: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET,
                callbackURL: googleCallbackURL,
                scope: ["openid", "email", "profile"],
                accessType: "offline",
                prompt: "consent",
                state: false,
                passReqToCallback: true,
            },
            async (req, accessToken, refreshToken, profile, done) => {
                try {
                    Logger.info(`[Passport] Google callback received profile: ${profile?.id}, email: ${profile?.emails?.[0]?.value}`);
                    const email = profile.emails?.[0]?.value;
                    if (!email) {
                        return done(new Error("No email found in Google profile"));
                    }

                    const googleId = profile.id;
                    if (!googleId) {
                        return done(new Error("No Google ID found in profile"));
                    }
                    const displayName = profile.displayName || email.split("@")[0];
                    const givenName = profile.name?.givenName || null;
                    const familyName = profile.name?.familyName || null;
                    const photoUrl = profile.photos?.[0]?.value || null;
                    const verified = profile._json?.email_verified ? "true" : "false";

                    let user = await authStorage.getUserByEmail(email);
                    const userData = {
                        id: `google_${googleId}`,
                        email,
                        username: email.split("@")[0],
                        fullName: displayName,
                        firstName: givenName,
                        lastName: familyName,
                        profileImageUrl: photoUrl,
                        authProvider: "google" as const,
                        emailVerified: verified,
                    };

                    if (!user) {
                        user = await authStorage.upsertUser(userData);
                        
                        // Notify admin about new user registration
                        try {
                            const { storage } = await import("../../storage");
                            await storage.createAuditLog({
                                action: "user_registered",
                                resource: "users",
                                resourceId: user.id,
                                details: {
                                    email,
                                    provider: "google",
                                    fullName: profile.displayName,
                                    timestamp: new Date().toISOString()
                                }
                            });
                            Logger.info(`[Passport] New user registered via Google: ${email}`);
                        } catch (auditError) {
                            Logger.error(`[Passport] Failed to create audit log: ${auditError}`);
                        }
                    } else {
                        // Refresh profile info
                        user = await authStorage.upsertUser({ ...userData, id: user.id });
                    }

                    // Persist tokens (best-effort: never block login on token storage issues).
                    try {
                        await tokenManager.saveTokens(user.id, "google", {
                            access_token: accessToken,
                            refresh_token: refreshToken,
                            // Google typically expires in 1 hour (3599 seconds)
                            expiry_date: Date.now() + 3600 * 1000,
                            scope: "openid email profile"
                        });
                    } catch (tokenError) {
                        Logger.warn("[Passport] Google token persistence failed; continuing without stored tokens", {
                            userId: user.id,
                            error: (tokenError as any)?.message || tokenError,
                        });
                    }

                    return done(null, user);
                } catch (error) {
                    Logger.error(`[Passport] Google Auth Error: ${error}`);
                    return done(error as Error);
                }
            }
        )
    );
}

// --- Microsoft Strategy ---
if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    passport.use(
        new MicrosoftStrategy(
            {
                clientID: env.MICROSOFT_CLIENT_ID,
                clientSecret: env.MICROSOFT_CLIENT_SECRET,
                callbackURL: `${env.BASE_URL}/api/auth/microsoft/callback`,
                scope: ["openid", "profile", "email", "User.Read", "offline_access"],
                authorizationURL: `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`,
                tokenURL: `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
                state: true,
            },
            async (accessToken: string, refreshToken: string, profile: any, done: any) => {
                try {
                    const email = profile.emails?.[0]?.value || profile._json.mail || profile._json.userPrincipalName;
                    if (!email) {
                        return done(new Error("No email found in Microsoft profile"));
                    }

                    let user = await authStorage.getUserByEmail(email);
                    const userData = {
                        id: `ms_${profile.id}`,
                        email,
                        username: email.split("@")[0],
                        fullName: profile.displayName,
                        firstName: profile.name?.givenName,
                        lastName: profile.name?.familyName,
                        // Microsoft doesn't always return photo in profile, requires separate graph call
                        authProvider: "microsoft",
                        emailVerified: "true",
                    };

                    if (!user) {
                        user = await authStorage.upsertUser(userData);
                    } else {
                        user = await authStorage.upsertUser({ ...userData, id: user.id });
                    }

                    // Persist tokens (best-effort: never block login on token storage issues).
                    try {
                        await tokenManager.saveTokens(user.id, "microsoft", {
                            access_token: accessToken,
                            refresh_token: refreshToken,
                            expiry_date: Date.now() + 3600 * 1000,
                            scope: "openid profile email User.Read offline_access"
                        });
                    } catch (tokenError) {
                        Logger.warn("[Passport] Microsoft token persistence failed; continuing without stored tokens", {
                            userId: user.id,
                            error: (tokenError as any)?.message || tokenError,
                        });
                    }

                    return done(null, user);

                } catch (error) {
                    Logger.error(`[Passport] Microsoft Auth Error: ${error}`);
                    return done(error);
                }
            }
        )
    );
}

// --- Auth0 Strategy ---
if (env.AUTH0_DOMAIN && env.AUTH0_CLIENT_ID && env.AUTH0_CLIENT_SECRET) {
    passport.use(
        new Auth0Strategy(
            {
                domain: env.AUTH0_DOMAIN,
                clientID: env.AUTH0_CLIENT_ID,
                clientSecret: env.AUTH0_CLIENT_SECRET,
                callbackURL: `${env.BASE_URL}/api/auth/auth0/callback`,
                state: true,
                // scope is not part of the options interface, pass it as extra param if needed or rely on default
            },
            async (accessToken: string, refreshToken: string, extraParams: any, profile: any, done: any) => {
                try {
                    const email = profile.emails?.[0]?.value;
                    if (!email) return done(new Error("No email found in Auth0 profile"));

                    let user = await authStorage.getUserByEmail(email);
                    const userData = {
                        id: `auth0_${profile.id}`,
                        email,
                        username: profile.nickname || email.split("@")[0],
                        fullName: profile.displayName,
                        firstName: profile.name?.givenName,
                        lastName: profile.name?.familyName,
                        profileImageUrl: profile.picture,
                        authProvider: "auth0",
                        emailVerified: profile._json.email_verified ? "true" : "false",
                    };

                    if (!user) {
                        user = await authStorage.upsertUser(userData);
                    } else {
                        user = await authStorage.upsertUser({ ...userData, id: user.id });
                    }

                    // Persist tokens (best-effort: never block login on token storage issues).
                    try {
                        await tokenManager.saveTokens(user.id, "auth0", {
                            access_token: accessToken,
                            refresh_token: refreshToken,
                            expiry_date: Date.now() + (extraParams.expires_in || 3600) * 1000,
                            scope: "openid email profile offline_access"
                        });
                    } catch (tokenError) {
                        Logger.warn("[Passport] Auth0 token persistence failed; continuing without stored tokens", {
                            userId: user.id,
                            error: (tokenError as any)?.message || tokenError,
                        });
                    }

                    return done(null, user);

                } catch (error) {
                    Logger.error(`[Passport] Auth0 Auth Error: ${error}`);
                    return done(error);
                }
            }
        )
    );
}

// Log registered strategies at startup to aid debugging
try {
    const strategyNames = Object.keys((passport as any)._strategies || {});
    Logger.info(`[Passport] Registered strategies: ${strategyNames.join(", ") || "(none)"}`);
} catch (error) {
    Logger.warn(`[Passport] Failed to list strategies: ${error}`);
}

export { passport };
