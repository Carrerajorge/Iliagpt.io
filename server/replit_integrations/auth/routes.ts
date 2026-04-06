import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated, getSessionStats } from "./replitAuth";
import { storage } from "../../storage";
import { hashPassword, verifyPassword, isHashed } from "../../utils/password";
import { loginSchema, registerSchema, validate } from "../../validation/schemas";
import { rateLimiter as authRateLimiter, getRateLimitStats } from "../../middleware/userRateLimiter";
import { sendMagicLinkEmail } from "../../services/genericEmailService";
import { getSecureUserId } from "../../lib/anonUserHelper";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { buildSessionUserFromDbUser } from "../../lib/sessionUser";
import { computeMfaForUser, startMfaLoginChallenge } from "../../services/mfaLogin";
import { createLogger } from "../../lib/structuredLogger";
import { getSettingValue } from "../../services/settingsConfigService";
import { setLogoutMarker, clearLogoutMarker } from "../../lib/logoutMarker";
import { randomUUID } from "crypto";

const authLoginLogger = createLogger("auth-login");

// Admin credentials from environment variables - REQUIRED, no fallback for security
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const ALLOW_LEGACY_ENV_ADMIN_LOGIN = process.env.ALLOW_LEGACY_ENV_ADMIN_LOGIN === "true";
const ALLOW_LEGACY_PLAINTEXT_PASSWORD_LOGIN = process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORD_LOGIN === "true";

if (ADMIN_EMAIL && ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH && !ALLOW_LEGACY_ENV_ADMIN_LOGIN) {
  console.warn("[Auth] ADMIN_PASSWORD is set but ADMIN_PASSWORD_HASH is missing; env-admin login is disabled.");
}

function isAdminConfigured(): boolean {
  return !!(ADMIN_EMAIL && (ADMIN_PASSWORD_HASH || (ALLOW_LEGACY_ENV_ADMIN_LOGIN && ADMIN_PASSWORD)));
}

async function verifyEnvAdminPassword(password: string): Promise<boolean> {
  if (ADMIN_PASSWORD_HASH) {
    return verifyPassword(password, ADMIN_PASSWORD_HASH);
  }

  if (ALLOW_LEGACY_ENV_ADMIN_LOGIN && ADMIN_PASSWORD) {
    return password === ADMIN_PASSWORD;
  }

  return false;
}

// Sanitize user object to remove sensitive fields
function sanitizeUser(user: any): any {
  if (!user) return user;
  const { password, ...safeUser } = user;
  return safeUser;
}

const selfServiceRegisterSchema = registerSchema.pick({
  email: true,
  password: true,
});

// MFA + WebPush helpers live in ../../services/mfaLogin

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Legacy routes removed in favor of Passport.js in server/routes.ts

  // Auth metrics endpoint (admin only)


  app.get("/api/auth/metrics", isAuthenticated, async (req: any, res) => {
    try {
      const user = await authStorage.getUser(req.user?.claims?.sub);
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      res.json({
        auth: getSessionStats(),
        rateLimit: getRateLimitStats(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Auth] Failed to get metrics:", error);
      res.status(500).json({ message: "Failed to retrieve metrics" });
    }
  });

  // User login with email/password (for users created by admin)
  app.post("/api/auth/login", authRateLimiter, async (req: any, res) => {
    try {
      // Validate input
      const validation = loginSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Datos inválidos",
          errors: validation.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      
      const { email, password } = validation.data;

      // Optional env-admin emergency path (hash-based by default).
      const isEnvAdminLogin =
        isAdminConfigured() &&
        email.toLowerCase() === ADMIN_EMAIL!.toLowerCase() &&
        (await verifyEnvAdminPassword(password));
      if (isEnvAdminLogin) {
        const adminId = "admin-user-id";
        await authStorage.upsertUser({
          id: adminId,
          email: ADMIN_EMAIL,
          firstName: "Admin",
          lastName: "User",
          profileImageUrl: null,
          role: "admin",
        });

        const adminUser = {
          id: adminId,
          claims: {
            sub: adminId,
            email: ADMIN_EMAIL,
            first_name: "Admin",
            last_name: "User",
          },
          expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
        };

        // MFA gate: require TOTP and/or push approval if enabled (admin too).
        const mfa = await computeMfaForUser({ userId: adminId, excludeSid: req.sessionID || null });
        if (mfa.requiresMfa) {
          try {
            const challenge = await startMfaLoginChallenge({
              req,
              userId: adminId,
              email: ADMIN_EMAIL,
              totpEnabled: mfa.totpEnabled,
              pushTargets: mfa.pushTargets,
              ttlMs: 5 * 60 * 1000,
              sessionUser: adminUser,
            });

            const message = challenge.methods.push && challenge.methods.totp
              ? "Aprueba el inicio de sesión en tu dispositivo de confianza o ingresa tu código 2FA."
              : challenge.methods.push
                ? "Aprueba el inicio de sesión en tu dispositivo de confianza."
                : "Ingresa tu código 2FA.";

            return res.json({
              success: false,
              mfaRequired: true,
              methods: challenge.methods,
              approvalId: challenge.approvalId,
              message,
            });
          } catch (e: any) {
            if (e?.code === "PUSH_DELIVERY_FAILED") {
              return res.status(503).json({
                message: "No se pudo enviar la notificación push. Intenta de nuevo.",
                code: "PUSH_DELIVERY_FAILED",
              });
            }
            console.error("[Auth] Failed to start MFA challenge (admin):", e?.message || e);
            return res.status(500).json({ message: "No se pudo iniciar el flujo MFA." });
          }
        }

        return req.login(adminUser, async (err: any) => {
          if (err) {
            return res.status(500).json({ message: "Error al iniciar sesión" });
          }

          if (req.session) {
            req.session.authUserId = adminId;
            req.session.passport = req.session.passport || {};
            if (typeof req.session.passport.user !== "string") {
              req.session.passport.user = adminId;
            }
          }

          // Force session save before responding
          req.session.save(async (saveErr: any) => {
            if (saveErr) {
              console.error("Session save error:", saveErr);
              return res.status(500).json({ message: "Error al guardar sesión" });
            }
            try {
              await authStorage.updateUserLogin(adminId, {
                ipAddress: req.ip || req.socket.remoteAddress || null,
                userAgent: req.headers["user-agent"] || null
              });

              await auditLog(req, {
                action: AuditActions.AUTH_LOGIN,
                resource: "auth",
                details: { email: ADMIN_EMAIL, via: "auth_login", role: "admin" },
                category: "auth",
                severity: "info",
              });
            } catch (auditError) {
              console.error("Failed to create audit log:", auditError);
            }
            const user = await authStorage.getUser(adminId);
            res.json({ success: true, user: sanitizeUser(user) });
          });
        });
      }

      // Read through authStorage (primary DB connection) to avoid replica-read drift
      // on the authentication critical path.
      const dbUser = await authStorage.getUserByEmail(email);

      if (!dbUser) {
        try {
          await auditLog(req, {
            action: AuditActions.AUTH_LOGIN_FAILED,
            resource: "auth",
            details: { email, reason: "user_not_found" },
            category: "auth",
            severity: "warning",
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
        return res.status(401).json({ message: "Usuario no encontrado" });
      }

      // Verify password - handle both hashed and legacy plain text passwords
      let passwordValid = false;
      let needsPasswordMigration = false;

      if (dbUser.password) {
        if (isHashed(dbUser.password)) {
          passwordValid = await verifyPassword(password, dbUser.password);
        } else if (ALLOW_LEGACY_PLAINTEXT_PASSWORD_LOGIN) {
          passwordValid = dbUser.password === password;
          needsPasswordMigration = passwordValid;
        } else {
          try {
            await auditLog(req, {
              action: AuditActions.AUTH_LOGIN_FAILED,
              resource: "auth",
              details: { email: dbUser.email, reason: "legacy_plaintext_password_blocked", targetUserId: dbUser.id },
              category: "auth",
              severity: "warning",
            });
          } catch (auditError) {
            console.error("Failed to create audit log:", auditError);
          }
          return res.status(403).json({
            message: "Esta cuenta requiere restablecer contraseña antes de iniciar sesión.",
            code: "PASSWORD_RESET_REQUIRED",
          });
        }
      }

      if (!passwordValid) {
        try {
          await auditLog(req, {
            action: AuditActions.AUTH_LOGIN_FAILED,
            resource: "auth",
            details: { email: dbUser.email, reason: "invalid_password", targetUserId: dbUser.id },
            category: "auth",
            severity: "warning",
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
        return res.status(401).json({ message: "Contraseña incorrecta" });
      }

      // Migrate legacy plain text password to hashed version
      if (needsPasswordMigration) {
        try {
          const hashedPassword = await hashPassword(password);
          await storage.updateUser(dbUser.id, { password: hashedPassword });
          console.log(`[Auth] Legacy plaintext password migrated to hash for user: ${dbUser.email}`);
        } catch (migrationError) {
          console.error("Failed to migrate password to hash:", migrationError);
        }
      }

      // Check if user is active
      if (dbUser.status !== "active") {
        try {
          await auditLog(req, {
            action: AuditActions.AUTH_LOGIN_FAILED,
            resource: "auth",
            details: { email: dbUser.email, reason: "inactive_user", targetUserId: dbUser.id },
            category: "auth",
            severity: "warning",
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
        return res.status(401).json({ message: "Usuario inactivo" });
      }

      // MFA gate: require TOTP and/or push approval if enabled.
      const mfa = await computeMfaForUser({ userId: dbUser.id, excludeSid: req.sessionID || null });
      if (mfa.requiresMfa) {
        try {
          const challenge = await startMfaLoginChallenge({
            req,
            userId: dbUser.id,
            email: dbUser.email,
            totpEnabled: mfa.totpEnabled,
            pushTargets: mfa.pushTargets,
            ttlMs: 5 * 60 * 1000,
          });

          const message = challenge.methods.push && challenge.methods.totp
            ? "Aprueba el inicio de sesión en tu dispositivo de confianza o ingresa tu código 2FA."
            : challenge.methods.push
              ? "Aprueba el inicio de sesión en tu dispositivo de confianza."
              : "Ingresa tu código 2FA.";

          return res.json({
            success: false,
            mfaRequired: true,
            methods: challenge.methods,
            approvalId: challenge.approvalId,
            message,
          });
        } catch (e: any) {
          if (e?.code === "PUSH_DELIVERY_FAILED") {
            return res.status(503).json({
              message: "No se pudo enviar la notificación push. Intenta de nuevo.",
              code: "PUSH_DELIVERY_FAILED",
            });
          }
          console.error("[Auth] Failed to start MFA challenge:", e?.message || e);
          return res.status(500).json({ message: "No se pudo iniciar el flujo MFA." });
        }
      }

      // Set up session
      const sessionUser = buildSessionUserFromDbUser(dbUser);

      req.login(sessionUser, async (err: any) => {
        if (err) {
          return res.status(500).json({ message: "Error al iniciar sesión" });
        }

        if (req.session) {
          req.session.authUserId = dbUser.id;
          req.session.passport = req.session.passport || {};
          if (typeof req.session.passport.user !== "string") {
            req.session.passport.user = String(dbUser.id);
          }
        }

        // Track login and update last login
        try {
          await authStorage.updateUserLogin(dbUser.id, {
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.headers["user-agent"] || null
          });

          await auditLog(req, {
            action: AuditActions.AUTH_LOGIN,
            resource: "auth",
            details: { email: dbUser.email, role: dbUser.role || "user" },
            category: "auth",
            severity: "info",
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }

        // Force session save before responding
        req.session.save((saveErr: any) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.status(500).json({ message: "Error al guardar sesión" });
          }
          res.json({ success: true, user: sanitizeUser(dbUser) });
        });
      });
    } catch (error: any) {
      const requestId = (res as any)?.locals?.requestId as string | undefined;
      const cause = error?.cause as any;
      const errorProps = Object.fromEntries(
        Object.getOwnPropertyNames(error || {}).map((key) => [key, (error as any)[key]])
      );
      authLoginLogger
        .withRequest(requestId, req?.session?.authUserId || req?.user?.claims?.sub)
        .error("Login handler exception", {
          message: error?.message || String(error),
          stack: error?.stack,
          name: error?.name,
          causeMessage: cause?.message,
          causeCode: cause?.code,
          causeDetail: cause?.detail,
          causeHint: cause?.hint,
          errorProps,
          route: "/api/auth/login",
        });
      console.error("Login error:", {
        message: error?.message || String(error),
        stack: error?.stack,
      });
      res.status(500).json({ message: "Error al iniciar sesión" });
    }
  });

  // Self-service registration with email/password.
  // Keeps compatibility with legacy schemas by using minimal SQL columns plus fallback.
  app.post("/api/auth/register", authRateLimiter, async (req: any, res) => {
    try {
      const validation = selfServiceRegisterSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          message: "Datos inválidos",
          errors: validation.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
        });
      }

      const email = validation.data.email.toLowerCase().trim();
      const password = validation.data.password;

      const allowRegistration = await getSettingValue<boolean>("allow_registration", true);
      if (!allowRegistration) {
        return res.status(403).json({ message: "El registro está deshabilitado" });
      }

      const existing = await authStorage.getUserByEmail(email);
      const hashedPassword = await hashPassword(password);
      if (existing?.password) {
        return res.status(409).json({ message: "El usuario ya existe" });
      }

      const seedSource = existing?.id || email;
      const normalizedUsername =
        existing?.username?.trim() ||
        email.split("@")[0]?.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80) ||
        `user_${seedSource.slice(0, 8)}`;

      await authStorage.upsertUser({
        id: existing?.id || randomUUID(),
        email,
        username: normalizedUsername,
        fullName: existing?.fullName || normalizedUsername,
        firstName: existing?.firstName || normalizedUsername,
        lastName: existing?.lastName || "",
        role: existing?.role || "user",
        plan: existing?.plan || "free",
        status: "active",
        password: hashedPassword,
        authProvider: "email",
        emailVerified: "true",
        providerSubject: existing?.id || email,
      });

      try {
        await auditLog(req, {
          action: existing ? AuditActions.USER_UPDATED : AuditActions.USER_CREATED,
          resource: "auth",
          details: {
            email,
            via: existing ? "self_register_activate" : "self_register",
            role: existing?.role || "user",
            plan: existing?.plan || "free",
          },
          category: "auth",
          severity: "info",
        });
      } catch (auditError) {
        console.error("Failed to create audit log:", auditError);
      }

      res.json({
        success: true,
        message: existing ? "Cuenta activada correctamente" : "Cuenta creada correctamente",
      });
    } catch (error) {
      console.error("[Auth] Register error:", error);
      res.status(500).json({ message: "Error al registrar usuario" });
    }
  });

  // Admin login with email/password
  app.post("/api/auth/admin-login", authRateLimiter, async (req: any, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password required" });
      }

      // Verify admin is configured and credentials match
	      if (!isAdminConfigured() || email.toLowerCase() !== ADMIN_EMAIL!.toLowerCase() || !(await verifyEnvAdminPassword(password))) {
	        try {
	          await auditLog(req, {
	            action: AuditActions.AUTH_LOGIN_FAILED,
	            resource: "auth",
	            details: { email, reason: "invalid_admin_credentials" },
	            category: "auth",
	            severity: "warning",
	          });
	        } catch (auditError) {
	          console.error("Failed to create audit log:", auditError);
	        }
	        return res.status(401).json({ message: "Invalid credentials" });
	      }

      // Create or get admin user
      const adminId = "admin-user-id";
      await authStorage.upsertUser({
        id: adminId,
        email: ADMIN_EMAIL,
        firstName: "Admin",
        lastName: "User",
        profileImageUrl: null,
        role: "admin",
      });

	      // Set up session for admin
	      const adminUser = {
	        id: adminId,
	        claims: {
	          sub: adminId,
	          email: ADMIN_EMAIL,
	          first_name: "Admin",
	          last_name: "User",
	        },
	        expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 1 week
	      };

      // MFA gate: require TOTP and/or push approval if enabled (admin too).
      const mfa = await computeMfaForUser({ userId: adminId, excludeSid: req.sessionID || null });
      if (mfa.requiresMfa) {
        try {
          const challenge = await startMfaLoginChallenge({
            req,
            userId: adminId,
            email: ADMIN_EMAIL,
            totpEnabled: mfa.totpEnabled,
            pushTargets: mfa.pushTargets,
            ttlMs: 5 * 60 * 1000,
            sessionUser: adminUser,
          });

          const message = challenge.methods.push && challenge.methods.totp
            ? "Aprueba el inicio de sesión en tu dispositivo de confianza o ingresa tu código 2FA."
            : challenge.methods.push
              ? "Aprueba el inicio de sesión en tu dispositivo de confianza."
              : "Ingresa tu código 2FA.";

          return res.json({
            success: false,
            mfaRequired: true,
            methods: challenge.methods,
            approvalId: challenge.approvalId,
            message,
          });
        } catch (e: any) {
          if (e?.code === "PUSH_DELIVERY_FAILED") {
            return res.status(503).json({
              message: "No se pudo enviar la notificación push. Intenta de nuevo.",
              code: "PUSH_DELIVERY_FAILED",
            });
          }
          console.error("[Auth] Failed to start MFA challenge (admin-login):", e?.message || e);
          return res.status(500).json({ message: "No se pudo iniciar el flujo MFA." });
        }
      }

      req.login(adminUser, async (err: any) => {
        if (err) {
          console.error("Admin login error:", err);
          return res.status(500).json({ message: "Login failed" });
        }

        if (req.session) {
          req.session.authUserId = adminId;
          req.session.passport = req.session.passport || {};
          if (typeof req.session.passport.user !== "string") {
            req.session.passport.user = adminId;
          }
        }

        // Track admin login and update last login
	        try {
	          await authStorage.updateUserLogin(adminId, {
	            ipAddress: req.ip || req.socket.remoteAddress || null,
	            userAgent: req.headers["user-agent"] || null
	          });

	          await auditLog(req, {
	            action: AuditActions.AUTH_LOGIN,
	            resource: "auth",
	            details: { email: ADMIN_EMAIL, role: "admin", via: "admin-login" },
	            category: "auth",
	            severity: "info",
	          });
	        } catch (auditError) {
	          console.error("Failed to create audit log:", auditError);
	        }

        // Force session save before responding
        req.session.save((saveErr: any) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.status(500).json({ message: "Error saving session" });
          }
          res.json({ success: true, user: { id: adminId, email: ADMIN_EMAIL, firstName: "Admin", lastName: "User", role: "admin" } });
        });
      });
    } catch (error) {
      console.error("Admin login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Logout via POST (for SPA - clears session without redirect)
  app.post("/api/auth/logout", async (req: any, res) => {
	    try {
	      const userId = getSecureUserId(req);
	      if (userId && !userId.startsWith("anon_")) {
	        await auditLog(req, {
	          action: AuditActions.AUTH_LOGOUT,
	          resource: "auth",
	          details: { email: req.user?.claims?.email || req.user?.email || null },
	          category: "auth",
	          severity: "info",
	        });
	      }
      req.logout((err: any) => {
        if (err) {
          console.error("Logout error:", err);
        }
        if (req.session) {
          req.session.destroy((destroyErr: any) => {
            if (destroyErr) {
              console.error("Session destroy error:", destroyErr);
            }
            res.clearCookie("siragpt.sid");
            setLogoutMarker(res);
            res.json({ success: true });
          });
          return;
        }
        res.clearCookie("siragpt.sid");
        setLogoutMarker(res);
        res.json({ success: true });
      });
    } catch (error) {
      console.error("Logout error:", error);
      setLogoutMarker(res);
      res.json({ success: true });
    }
  });

  // Get current authenticated user
  app.get("/api/auth/user", async (req: any, res) => {
    try {
      // Passport should populate req.user, but in some environments we observed
      // sessions persisted with `req.session.passport.user` while `req.user` is missing.
      // Fallback to the session payload so login persists.
      const sessionUser = req.session?.passport?.user;
      const effectiveUser = req.user || sessionUser;
      const userId =
        effectiveUser?.claims?.sub ||
        effectiveUser?.id ||
        req.session?.authUserId;

      if (!userId) {
        console.warn("[Auth] /api/auth/user unauthorized", {
          hasCookieHeader: !!req.headers.cookie,
          sessionID: req.sessionID,
          hasSession: !!req.session,
          sessionPassportKeys: req.session?.passport ? Object.keys(req.session.passport) : null,
          authUserId: req.session?.authUserId,
        });
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await authStorage.getUser(userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      clearLogoutMarker(res);
      res.json(sanitizeUser(user));
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Magic Link - Request a magic link (passwordless login)
  app.post("/api/auth/magic-link/send", authRateLimiter, async (req: any, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email es requerido" });
      }

      // Dynamic import to avoid circular dependencies
      const { createMagicLink, getMagicLinkUrl } = await import("../../services/magicLink");

      const result = await createMagicLink(email);

      if (!result.success) {
        return res.status(500).json({ message: result.error });
      }

      // In production, send email. For development, return the URL directly
      const magicLinkUrl = getMagicLinkUrl(result.token!);

      if (process.env.NODE_ENV === "production") {
        // Send email with magic link
        const emailResult = await sendMagicLinkEmail(email, magicLinkUrl);
        if (!emailResult.success) {
          console.error(`[MagicLink] Failed to send email to ${email}:`, emailResult.error);
          // Still return success but log the error
        }
        console.log(`[MagicLink] Sent email to ${email}`);
        res.json({
          success: true,
          message: "Hemos enviado un enlace mágico a tu correo electrónico."
        });
      } else {
        // Development mode - return the URL for testing
        console.log(`[MagicLink] Development mode - returning link directly`);
        res.json({
          success: true,
          message: "Enlace mágico generado (modo desarrollo)",
          magicLinkUrl // Only in development!
        });
      }
    } catch (error) {
      console.error("[MagicLink] Send error:", error);
      res.status(500).json({ message: "Error al enviar el enlace mágico" });
    }
  });

  // Magic Link - Verify token and login
  app.get("/api/auth/magic-link/verify", async (req: any, res) => {
    try {
      const { token } = req.query;

      if (!token || typeof token !== "string") {
        return res.redirect("/login?error=invalid_token");
      }

      const { verifyMagicLink } = await import("../../services/magicLink");
      const result = await verifyMagicLink(token);

      if (!result.success) {
        return res.redirect(`/login?error=magic_link_expired`);
      }

      const sessionUser = buildSessionUserFromDbUser(result.user);

      // MFA gate (push approval and/or TOTP) before we create an authenticated session.
      const mfa = await computeMfaForUser({ userId: result.user.id, excludeSid: req.sessionID || null });
      if (mfa.requiresMfa) {
        try {
          await startMfaLoginChallenge({
            req,
            userId: result.user.id,
            email: result.user.email,
            totpEnabled: mfa.totpEnabled,
            pushTargets: mfa.pushTargets,
            ttlMs: 5 * 60 * 1000,
            sessionUser,
          });
          return res.redirect("/login?mfa=1");
        } catch (e: any) {
          console.warn("[MagicLink] Failed to start MFA challenge:", e?.message || e);
          return res.redirect("/login?error=login_failed");
        }
      }

      req.login(sessionUser, async (err: any) => {
        if (err) {
          console.error("[MagicLink] Login error:", err);
          return res.redirect("/login?error=login_failed");
        }

        if (req.session) {
          req.session.authUserId = result.user.id;
          req.session.passport = req.session.passport || {};
          if (typeof req.session.passport.user !== "string") {
            req.session.passport.user = String(result.user.id);
          }
        }

	        try {
	          await authStorage.updateUserLogin(result.user.id, {
	            ipAddress: req.ip || req.socket.remoteAddress || null,
	            userAgent: req.headers["user-agent"] || null
	          });

	          await auditLog(req, {
	            action: AuditActions.AUTH_LOGIN,
	            resource: "auth",
	            details: { email: result.user.email, role: result.user.role || "user", provider: "magic_link" },
	            category: "auth",
	            severity: "info",
	          });
	        } catch (auditError) {
	          console.warn("[MagicLink] Failed to create audit log:", auditError);
	        }

        req.session.save((saveErr: any) => {
          if (saveErr) {
            console.error("[MagicLink] Session save error:", saveErr);
            return res.redirect("/login?error=session_error");
          }
          // Redirect to home on success
          res.redirect("/");
        });
      });
    } catch (error) {
      console.error("[MagicLink] Verify error:", error);
      res.redirect("/login?error=verification_failed");
    }
  });
}
