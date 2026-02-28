import type { Express, Request, Response } from "express";
import { type AuthenticatedRequest, getUserId } from "./types/express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { ObjectStorageService } from "./objectStorage";
import { processDocument } from "./services/documentProcessing";
import { env } from "./config/env";
import { chunkText, generateEmbeddingsBatch } from "./embeddingService";
import { StepUpdate } from "./agent";
import { browserSessionManager, SessionEvent } from "./agent/browser";
import { fileProcessingQueue, FileStatusUpdate } from "./lib/fileProcessingQueue";
import { globalAuditMiddleware } from "./middleware/audit";
import { pptExportRouter } from "./routes/pptExport";
import swaggerUi from 'swagger-ui-express';
import { passport } from "./lib/auth/passport";
import { swaggerSpec } from "./lib/swagger";
import { createChatsRouter } from "./routes/chatsRouter";
import { createFilesRouter } from "./routes/filesRouter";
import { createLocalStorageRouter } from "./routes/localStorageRouter";
import { createGptRouter } from "./routes/gptRouter";
import { createDocumentsRouter } from "./routes/documentsRouter";
import { createAdminRouter } from "./routes/admin";
import { createRetrievalAdminRouter } from "./routes/retrievalAdminRouter";
import { createAgentRouter } from "./routes/agentRouter";
import { createFigmaRouter } from "./routes/figmaRouter";
import { createLibraryRouter } from "./routes/libraryRouter";
import { createWorkspaceRouter } from "./routes/workspaceRouter";
import { createCodeRouter } from "./routes/codeRouter";
import { createUserRouter } from "./routes/userRouter";
import { createChatAiRouter } from "./routes/chatAiRouter";
import { createGoogleFormsRouter } from "./routes/googleFormsRouter";
import { createGmailRouter } from "./routes/gmailRouter";
import { createAppsIntegrationRouter } from "./routes/appsIntegrationRouter";
import { createConnectorOAuthRouter } from "./routes/connectorOAuthRouter";
import gmailOAuthRouter from "./routes/gmailOAuthRouter";
import calendarOAuthRouter from "./routes/calendarOAuthRouter";
import outlookOAuthRouter from "./routes/outlookOAuthRouter";
import { createGmailMcpRouter } from "./mcp/gmailMcpServer";
import healthRouter from "./routes/healthRouter";
import aiExcelRouter from "./routes/aiExcelRouter";
import powerRouter from "./routes/powerRouter";
import multiAgentRouter from "./routes/multiAgentRouter";
import { metricsHandler, getMetricsJson } from "./lib/parePrometheusMetrics";
import { createHealthRouter as createPareHealthRouter, getHealthSummary as getPareHealthSummary } from "./lib/pareHealthChecks";
import { getMetricsSummary as getPareMetricsSummary } from "./lib/pareMetrics";
import errorRouter from "./routes/errorRouter";
import { createSpreadsheetRouter } from "./routes/spreadsheetRoutes";
import { createChatRoutes } from "./routes/chatRoutes";
import { createAgentModeRouter } from "./routes/agentRoutes";
import { createOrchestratorRouter } from "./routes/orchestratorRoutes";
import { registerAgenticTools } from "./agent/orchestrator/agenticToolRegistrations";
import { createSandboxAgentRouter } from "./routes/sandboxAgentRouter";
import { createLangGraphRouter } from "./routes/langGraphRouter";
import { createRegistryRouter } from "./routes/registryRouter";
import wordPipelineRoutes from "./routes/wordPipelineRoutes";
import redisSSERouter from "./routes/redisSSERouter";
import streamingResumeRouter from "./routes/streamingResumeRouter";
import superAgentRouter from "./routes/superAgentRoutes";
import conversationMemoryRoutes from "./routes/conversationMemoryRoutes";
import { contextRoutes, semanticRoutes } from "./memory";
import { createPythonToolsRouter } from "./routes/pythonToolsRouter";
import { createLocalControlRouter } from "./routes/localControlRouter";
import { createMacOSControlRouter } from "./routes/macosControlRouter";
import { systemControlRouter } from "./routes/systemControlRouter";
import { createAutomationTriggersRouter } from "./routes/automationTriggersRouter";
import { createVoiceRouter } from "./routes/voiceRouter";
import { createAnalyticsRouter } from "./routes/analyticsRouter";
import { createToolExecutionRouter } from "./routes/toolExecutionRouter";
import agentPlanRouter from "./routes/agentPlanRouter";
import scientificSearchRouter from "./routes/scientificSearchRouter";
import documentAnalysisRouter from "./routes/documentAnalysisRouter";
import ragRouter from "./routes/ragRouter";
import ragMemoryRouter from "./routes/ragMemoryRouter";
import feedbackRouter from "./routes/feedbackRouter";
import { createChannelWebhooksRouter } from "./routes/channelWebhooksRouter";
import { createTelegramIntegrationRouter } from "./routes/telegramIntegrationRouter";
import { createWhatsAppCloudIntegrationRouter } from "./routes/whatsappCloudIntegrationRouter";
import { createMessengerIntegrationRouter } from "./routes/messengerIntegrationRouter";
import { createWeChatIntegrationRouter } from "./routes/wechatIntegrationRouter";
import { createStripeRouter } from "./routes/stripeRouter";
import { createSettingsRouter } from "./routes/settingsRouter";
import { superintelligenceRouter } from "./routes/superintelligence";
import { hasLogoutMarker, clearLogoutMarker } from "./lib/logoutMarker";
import requestUnderstandingRoutes from "./routes/requestUnderstandingRoutes";
import { createRunController } from "./agent/superAgent/tracing/RunController";
import { createAuditDashboardRouter } from "./routes/auditDashboardRouter";
import { createSuperIntelligenceRouter } from "./routes/superIntelligenceRouter";
import { initializeAuditSystem, auditMiddleware } from "./services/superIntelligence/audit";
import { initializeSuperIntelligence } from "./services/superIntelligence";
import { initializeEventStore, getEventStore } from "./agent/superAgent/tracing/EventStore";
import type { ExecutionEvent, ExecutionEventType } from "@shared/executionProtocol";
import type { TraceEvent } from "./agent/superAgent/tracing/types";
import { getStreamGateway } from "./agent/superAgent/tracing/StreamGateway";
import type { TraceEmitter } from "./agent/superAgent/tracing/TraceEmitter";
import { initializeRedisSSE } from "./lib/redisSSE";
import { initializeAgentSystem } from "./agent/registry";
import { ALL_TOOLS, SAFE_TOOLS, SYSTEM_TOOLS } from "./agent/langgraph/tools";
import { getAllAgents, getAgentSummary, SPECIALIZED_AGENTS } from "./agent/langgraph/agents";
import { getSuperAgentCoverageReport, type SuperAgentCoverageSource } from "./services/superAgentCoverage";
import { listOpenClaw1000Capabilities, getOpenClaw1000QuickStats } from "./services/openClaw1000Service";
import { buildOpenClaw1000CapabilityProfile } from "./services/openClaw1000CapabilityProfiler";
import { createAuthenticatedWebSocketHandler, AuthenticatedWebSocket } from "./lib/wsAuth";
import { llmGateway } from "./lib/llmGateway";
import { generateAnonToken } from "./lib/anonToken";
import { getUserConfig, setUserConfig, getDefaultConfig, validatePatterns, getFilterStats } from "./services/contentFilter";
import { isModelEligibleForPublic } from "./services/modelIntegration";
import { GEMINI_MODELS_REGISTRY, XAI_MODELS } from "./lib/modelRegistry";
import { getLogs, getLogStats, type LogFilters } from "./lib/structuredLogger";
import { getActiveRequests, getRequestStats } from "./lib/requestTracer";
import { getAllServicesHealth, getOverallStatus, initializeHealthMonitoring } from "./lib/healthMonitor";
import { getHealthStatus as getDbHealthStatus } from "./db";
import { getRateLimiterStatus } from "./middleware/rateLimiter";
import { templatesRouter } from "./routes/templatesRouter";
import { webhooksRouter } from "./routes/webhooksRouter";
import { twoFactorRouter } from "./routes/twoFactorRouter";
import { apiKeysRouter } from "./routes/apiKeysRouter";
import { memoryRouter } from "./routes/memoryRouter";
import { advancedAnalyticsRouter } from "./routes/admin/advancedAnalytics";
import { requireAdmin as requireAdminMiddleware } from "./routes/admin/utils";
import { automationsRouter } from "./routes/admin/automations";
import { academicSearchRouter } from "./routes/academicSearchRouter";
import { createSecurityRouter } from "./routes/securityRouter";
import { createMfaRouter } from "./routes/mfaRouter";
import { createPackagesRouter } from "./routes/packagesRouter";
import { computeMfaForUser, startMfaLoginChallenge } from "./services/mfaLogin";
import { getActiveAlerts, getAlertHistory, getAlertStats, resolveAlert } from "./lib/alertManager";
import { recordConnectorUsage, getConnectorStats, getAllConnectorStats, resetConnectorStats, isValidConnector, type ConnectorName } from "./lib/connectorMetrics";
import { checkConnectorHealth, checkAllConnectorsHealth, getHealthSummary, startPeriodicHealthCheck } from "./lib/connectorAlerting";
import { getExecutionIntentGuardStatus, preExecutionIntentGuard } from "./middleware/preExecutionIntentGuard";
import { require2FA } from "./middleware/auth";
import {
  runAgent, getTools, healthCheck as pythonAgentHealthCheck, isServiceAvailable, PythonAgentClientError,
  browse as pythonAgentBrowse, search as pythonAgentSearch, createDocument as pythonAgentCreateDocument,
  executeTool as pythonAgentExecuteTool, listFiles as pythonAgentListFiles, getStatus as pythonAgentGetStatus
} from "./services/pythonAgentClient";
import express from "express";
import path from "path";
import fs from "fs";

import { createRunRouter } from "./routes/runRouter";
import { createBrowserControlRouter } from "./routes/browserControlRouter";
import { createTerminalControlRouter, terminalClients } from "./routes/terminalControlRouter";
import { createWorkflowRouter } from "./routes/workflowRouter";
import { createDeviceControlRouter } from "./routes/deviceControlRouter";
import openClawRouter from "./routes/openClawRouter";
import { createOpenClawRouter } from "./routes/openclawRouter";
import { createSkillPlatformRouter } from "./routes/skillPlatformRouter";
import { CSRF_COOKIE_NAME, CSRF_TOKEN_PATTERN, issueCsrfCookie } from "./middleware/csrf";
import { finopsRouter } from "./routes/finopsRouter";

const agentClients: Map<string, Set<WebSocket>> = new Map();
const browserClients: Map<string, Set<WebSocket>> = new Map();
const fileStatusClients: Map<string, Set<WebSocket>> = new Map();

type PublicModelSummary = {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  description: string | null;
  isEnabled: string;
  enabledAt: Date | string | null;
  displayOrder: number;
  icon: string | null;
  modelType: string;
  contextWindow: number | null;
};

const PUBLIC_MODEL_FALLBACKS: ReadonlyArray<PublicModelSummary> = Object.freeze([
  {
    id: "fallback-gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "gemini",
    modelId: GEMINI_MODELS_REGISTRY.FLASH_25,
    description: "Modelo rapido y estable",
    isEnabled: "true",
    enabledAt: null,
    displayOrder: 0,
    icon: null,
    modelType: "TEXT",
    contextWindow: 1000000,
  },
  {
    id: "fallback-grok-4.1-fast",
    name: "Grok 4.1 Fast",
    provider: "xai",
    modelId: XAI_MODELS.GROK_4_1_FAST,
    description: "Modelo rapido con contexto amplio",
    isEnabled: "true",
    enabledAt: null,
    displayOrder: 1,
    icon: null,
    modelType: "TEXT",
    contextWindow: 2000000,
  },
]);

function toPublicModelSummary(model: any): PublicModelSummary {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    modelId: model.modelId,
    description: model.description,
    isEnabled: model.isEnabled,
    enabledAt: model.enabledAt,
    displayOrder: model.displayOrder || 0,
    icon: model.icon,
    modelType: model.modelType,
    contextWindow: model.contextWindow,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Session + Passport are initialized in server/index.ts (before csrf/rateLimiter).

  // Passport Auth Routes
  // Google (only register if credentials are configured)
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    app.get("/api/auth/google", passport.authenticate("google", {
      scope: ["openid", "email", "profile"],
      // Ensure Google issues a refresh_token (needed for long-lived access).
      // Note: Google may still only return refresh_token on first consent unless prompt includes "consent".
      accessType: "offline",
      prompt: "consent select_account",
    }));
    app.get("/api/auth/google/callback",
      (req, res, next) => {
        passport.authenticate("google", { failureRedirect: "/login?error=google_failed" }, (err: any, user: any) => {
          (async () => {
            if (err || !user) {
              return res.redirect("/login?error=google_failed");
            }

            const userId = user?.claims?.sub || user?.id;
            const email = user?.claims?.email || user?.email || null;
            if (!userId) {
              return res.redirect("/login?error=login_failed");
            }

            const mfa = await computeMfaForUser({ userId, excludeSid: req.sessionID || null });
            if (mfa.requiresMfa) {
              try {
                await startMfaLoginChallenge({
                  req,
                  userId,
                  email,
                  totpEnabled: mfa.totpEnabled,
                  pushTargets: mfa.pushTargets,
                  ttlMs: 5 * 60 * 1000,
                  sessionUser: user,
                });
                return res.redirect("/login?mfa=1");
              } catch (e: any) {
                console.warn("[Auth] Google callback MFA failed:", e?.message || e);
                return res.redirect("/login?error=login_failed");
              }
            }

            return (req as any).logIn(user, (loginErr: any) => {
              if (loginErr) {
                console.error("[Auth] Google login error:", loginErr);
                return res.redirect("/login?error=login_failed");
              }

              // Persist userId explicitly for robust auth across deployments.
              // Keep Passport's `session.passport.user` as a string id to ensure deserializeUser works.
              const session = (req as any).session as any | undefined;
              if (session) {
                session.authUserId = String(userId);
                session.passport = session.passport || {};
                if (typeof session.passport.user !== "string") {
                  session.passport.user = String(userId);
                }
              }

              const sess = (req as any).session;
              if (sess?.save) {
                sess.save((saveErr: any) => {
                  if (saveErr) {
                    console.error("[Auth] Google session save error:", saveErr);
                    return res.redirect("/login?error=session_error");
                  }
                  res.redirect("/?auth=success");
                });
                return;
              }

              res.redirect("/?auth=success");
            });
          })().catch(next);
        })(req, res, next);
      }
    );
  } else {
    // Return a helpful error when Google auth is not configured
    app.get("/api/auth/google", (req, res) => {
      res.status(503).json({ error: "Google authentication is not configured on this server" });
    });
  }

  // Microsoft (only register if credentials are configured)
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    app.get("/api/auth/microsoft", passport.authenticate("microsoft"));
    app.get("/api/auth/microsoft/callback",
      (req, res, next) => {
        passport.authenticate("microsoft", { failureRedirect: "/login?error=microsoft_failed" }, (err: any, user: any) => {
          (async () => {
            if (err || !user) {
              return res.redirect("/login?error=microsoft_failed");
            }

            const userId = user?.claims?.sub || user?.id;
            const email = user?.claims?.email || user?.email || null;
            if (!userId) {
              return res.redirect("/login?error=login_failed");
            }

            const mfa = await computeMfaForUser({ userId, excludeSid: req.sessionID || null });
            if (mfa.requiresMfa) {
              try {
                await startMfaLoginChallenge({
                  req,
                  userId,
                  email,
                  totpEnabled: mfa.totpEnabled,
                  pushTargets: mfa.pushTargets,
                  ttlMs: 5 * 60 * 1000,
                  sessionUser: user,
                });
                return res.redirect("/login?mfa=1");
              } catch (e: any) {
                console.warn("[Auth] Microsoft callback MFA failed:", e?.message || e);
                return res.redirect("/login?error=login_failed");
              }
            }

            return (req as any).logIn(user, (loginErr: any) => {
              if (loginErr) {
                console.error("[Auth] Microsoft login error:", loginErr);
                return res.redirect("/login?error=login_failed");
              }

              // Persist userId explicitly for robust auth across deployments.
              // Keep Passport's `session.passport.user` as a string id to ensure deserializeUser works.
              const session = (req as any).session as any | undefined;
              if (session) {
                session.authUserId = String(userId);
                session.passport = session.passport || {};
                if (typeof session.passport.user !== "string") {
                  session.passport.user = String(userId);
                }
              }

              const sess = (req as any).session;
              if (sess?.save) {
                sess.save((saveErr: any) => {
                  if (saveErr) {
                    console.error("[Auth] Microsoft session save error:", saveErr);
                    return res.redirect("/login?error=session_error");
                  }
                  res.redirect("/?auth=success");
                });
                return;
              }

              res.redirect("/?auth=success");
            });
          })().catch(next);
        })(req, res, next);
      }
    );
  } else {
    app.get("/api/auth/microsoft", (req, res) => {
      res.status(503).json({ error: "Microsoft authentication is not configured on this server" });
    });
  }

  // Auth0 (only register if credentials are configured)
  if (env.AUTH0_DOMAIN && env.AUTH0_CLIENT_ID && env.AUTH0_CLIENT_SECRET) {
    app.get("/api/auth/auth0", passport.authenticate("auth0", { scope: "openid email profile offline_access" }));
    app.get("/api/auth/auth0/callback",
      (req, res, next) => {
        passport.authenticate("auth0", { failureRedirect: "/login?error=auth0_failed" }, (err: any, user: any) => {
          (async () => {
            if (err || !user) {
              return res.redirect("/login?error=auth0_failed");
            }

            const userId = user?.claims?.sub || user?.id;
            const email = user?.claims?.email || user?.email || null;
            if (!userId) {
              return res.redirect("/login?error=login_failed");
            }

            const mfa = await computeMfaForUser({ userId, excludeSid: req.sessionID || null });
            if (mfa.requiresMfa) {
              try {
                await startMfaLoginChallenge({
                  req,
                  userId,
                  email,
                  totpEnabled: mfa.totpEnabled,
                  pushTargets: mfa.pushTargets,
                  ttlMs: 5 * 60 * 1000,
                  sessionUser: user,
                });
                return res.redirect("/login?mfa=1");
              } catch (e: any) {
                console.warn("[Auth] Auth0 callback MFA failed:", e?.message || e);
                return res.redirect("/login?error=login_failed");
              }
            }

            return (req as any).logIn(user, (loginErr: any) => {
              if (loginErr) {
                console.error("[Auth] Auth0 login error:", loginErr);
                return res.redirect("/login?error=login_failed");
              }

              // Persist userId explicitly for robust auth across deployments.
              // Keep Passport's `session.passport.user` as a string id to ensure deserializeUser works.
              const session = (req as any).session as any | undefined;
              if (session) {
                session.authUserId = String(userId);
                session.passport = session.passport || {};
                if (typeof session.passport.user !== "string") {
                  session.passport.user = String(userId);
                }
              }

              const sess = (req as any).session;
              if (sess?.save) {
                sess.save((saveErr: any) => {
                  if (saveErr) {
                    console.error("[Auth] Auth0 session save error:", saveErr);
                    return res.redirect("/login?error=session_error");
                  }
                  res.redirect("/?auth=success");
                });
                return;
              }

              res.redirect("/?auth=success");
            });
          })().catch(next);
        })(req, res, next);
      }
    );
  } else {
    app.get("/api/auth/auth0", (req, res) => {
      res.status(503).json({ error: "Auth0 authentication is not configured on this server" });
    });
  }

  // Phone Authentication (OTP)
  const { phoneAuthRouter } = await import("./routes/phoneAuthRouter");
  app.use("/api/auth/phone", phoneAuthRouter);

  // Global Audit Middleware (Logs mutations)
  if (process.env.NODE_ENV !== "test" || process.env.ENABLE_AUDIT_IN_TEST === "true") {
    app.use(globalAuditMiddleware);
    // Capture additional audit signals as early as possible.
    app.use(auditMiddleware);
  }

  // Session identity endpoint for consistent user ID across frontend/backend

  // Session identity endpoint for consistent user ID across frontend/backend
  // SECURITY: Anonymous user IDs are now bound to the session to prevent impersonation
  app.get("/api/session/identity", async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    const session = req.session as any;

    // First try req.user (Passport authenticated)
    let authUserId = user?.claims?.sub || user?.id;
    let authEmail = user?.claims?.email || (user as any)?.email;

    // If not found in req.user, try session.authUserId (email login)
    if (!authUserId && session?.authUserId) {
      authUserId = session.authUserId;
      // Try to get email from session passport user
      const passportUser = session.passport?.user;
      if (passportUser) {
        authEmail = passportUser.claims?.email || passportUser.email;
      }
    }

    if (authUserId) {
      clearLogoutMarker(res);
      // Get fresh role from database
      try {
        const dbUser = await storage.getUser(authUserId);
        const role = dbUser?.role || 'user';
        return res.json({
          userId: authUserId,
          email: authEmail || dbUser?.email,
          role: role,
          isAnonymous: false
        });
      } catch (e) {
        // Fallback if DB lookup fails
        return res.json({
          userId: authUserId,
          email: authEmail,
          role: 'user',
          isAnonymous: false
        });
      }
    }

    // If user explicitly logged out, do NOT auto-create/return anonymous identity.
    // This prevents old frontend bundles from auto-reauthing as anon right after logout.
    if (hasLogoutMarker(req)) {
      return res.status(401).json({ message: "Logged out" });
    }

    // For anonymous users, bind ID to session (not header) to prevent impersonation
    if (session) {
      if (!session.anonUserId) {
        const sessionId = req.sessionID;
        session.anonUserId = sessionId ? `anon_${sessionId}` : null;
      }
    }

    const anonUserId = session?.anonUserId ?? null;
    res.json({
      userId: anonUserId,
      token: anonUserId ? generateAnonToken(anonUserId) : null,
      email: null,
      isAnonymous: true
    });
  });

  app.get("/api/csrf/token", (req: Request, res: Response) => {
    const wantRotate = String(req.query.rotate || req.query.force || "").toLowerCase() === "1"
      || String(req.query.refresh || "").toLowerCase() === "1"
      || String(req.query.rotate || req.query.force || "").toLowerCase() === "true";

    const isReplitDeployment = !!process.env.REPL_SLUG;
    const isProduction = process.env.NODE_ENV === "production" || isReplitDeployment;
    const existing = req.cookies?.[CSRF_COOKIE_NAME];

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");

    if (!wantRotate && existing && CSRF_TOKEN_PATTERN.test(existing)) {
      return res.json({ ok: true, csrfToken: existing, rotated: false });
    }

    const token = issueCsrfCookie(req, res, isReplitDeployment, isProduction);
    return res.json({ ok: true, csrfToken: token, rotated: true });
  });

  const artifactsDir = path.join(process.cwd(), "artifacts");
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }
  app.use(
    "/api/artifacts",
    (req: Request, res: Response, next) => {
      const userId = getUserId(req);
      if (!userId || String(userId).startsWith("anon_")) {
        return res.status(401).json({ error: "Authentication required" });
      }
      return next();
    },
    express.static(artifactsDir, {
      setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        const stats = fs.statSync(filePath);
        if (ext === ".pptx") {
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        } else if (ext === ".docx") {
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        } else if (ext === ".xlsx") {
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        } else if (ext === ".pdf") {
          res.setHeader("Content-Type", "application/pdf");
        } else if (ext === ".png") {
          res.setHeader("Content-Type", "image/png");
        }
        res.setHeader("Content-Length", stats.size);
        res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    }),
  );

  
    app.use("/api/ppt", pptExportRouter);

    // Get platform setting by key
    app.get("/api/admin/settings/:key", async (req, res) => {
      try {
        const { key } = req.params;
        const setting = await storage.getSetting(key);
        if (!setting) {
          return res.status(404).json({ message: "Setting not found" });
        }
        res.json(setting);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    });

    // Create or update platform setting
    app.post("/api/admin/settings", async (req, res) => {
      try {
        const { key, value, description, category } = req.body;
        const setting = await storage.upsertSetting(key, value, description, category);
        res.json(setting);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    });
  

  // Get platform setting by key
  app.get("/api/admin/settings/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const setting = await storage.getSetting(key);
      if (!setting) {
        return res.status(404).json({ message: "Setting not found" });
      }
      res.json(setting);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create or update platform setting
  app.post("/api/admin/settings", async (req, res) => {
    try {
      const { key, value, description, category } = req.body;
      const setting = await storage.upsertSetting(key, value, description, category);
      res.json(setting);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.use("/api", createChatsRouter());
  app.use(createFilesRouter());
  app.use(createLocalStorageRouter());
  app.use("/api", createGptRouter());
  app.use("/api/documents", createDocumentsRouter());
  app.use("/api/admin", createAdminRouter());
  app.use("/api/finops", finopsRouter);
  app.use("/api/admin", createRetrievalAdminRouter());
  app.use("/api", createAgentRouter(broadcastBrowserEvent));

  // Telemetry Dashboard
  const { createTelemetryRouter } = await import('./telemetry/telemetryRouter');
  app.use("/api/telemetry", createTelemetryRouter());

  const { createPublicReleasesRouter } = await import("./routes/releasesRouter");
  app.use("/api/public/releases", createPublicReleasesRouter());

  app.use(createFigmaRouter());
  app.use(createLibraryRouter());
  app.use(createWorkspaceRouter());
  app.use(createCodeRouter());
  app.use(createUserRouter());
  app.use("/api", createChatAiRouter(broadcastAgentUpdate));
  app.use("/api/apps", createAppsIntegrationRouter());

  // Integration Kernel OAuth routes (generic connector flow).
  // Mount one router per connectorId loaded into the ConnectorRegistry.
  try {
    const { connectorRegistry } = await import("./integrations/kernel/connectorRegistry");
    for (const connectorId of connectorRegistry.listIds()) {
      app.use(`/api/connectors/oauth/${connectorId}`, createConnectorOAuthRouter(connectorId));
    }
  } catch (err: any) {
    console.warn("[Routes] Failed to mount connector OAuth routers:", err?.message || err);
  }

  app.use("/api/integrations/google/forms", createGoogleFormsRouter());
  app.use("/api/integrations/google/gmail", createGmailRouter());
  const { createWhatsAppWebRouter } = await import('./routes/whatsappWebRouter');
  app.use('/api/integrations/whatsapp/web', createWhatsAppWebRouter());
  app.use("/api/integrations/whatsapp/cloud", createWhatsAppCloudIntegrationRouter());
  app.use("/api/integrations/telegram", createTelegramIntegrationRouter());
  app.use("/api/integrations/messenger", createMessengerIntegrationRouter());
  app.use("/api/integrations/wechat", createWeChatIntegrationRouter());
  app.use("/api/oauth/google/gmail", gmailOAuthRouter);
  app.use("/api/oauth/google/calendar", calendarOAuthRouter);
  app.use("/api/oauth/microsoft", outlookOAuthRouter);
  app.use("/api/mcp/gmail", createGmailMcpRouter());
  app.use("/mcp/gmail", createGmailMcpRouter()); // Backward compatibility

  // External inbound webhooks must live outside /api to bypass CSRF middleware.
  app.use("/webhooks", createChannelWebhooksRouter());

  // Pre-execution intent guard for high-impact mutation endpoints.
  // Mode is controlled by EXECUTION_INTENT_GUARD_MODE=off|monitor|enforce
  // and defaults to enforce when SYSTEM_AUDIT_MODE is enabled.
  const guardedExecutionPrefixes = [
    "/api/agent",
    "/api/orchestrator",
    "/api/execution",
    "/api/planning",
    "/api/python-agent",
    "/api/browser-control",
    "/api/terminal",
    "/api/workflows",
    "/api/document-analysis",
    "/api/word-pipeline",
    "/api/openclaw",
  ];
  for (const prefix of guardedExecutionPrefixes) {
    app.use(prefix, preExecutionIntentGuard);
  }


  // ... existing imports ...

  app.use("/health", healthRouter);
  app.use("/health/pare", createPareHealthRouter());

  // Simple API health check (used by clients and local smoke checks)
  app.get("/api/health", (req, res) => {
    const mem = process.memoryUsage();
    const appVersion = process.env.APP_VERSION || process.env.npm_package_version || "unknown";
    const packageVersion = process.env.npm_package_version || "unknown";
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: appVersion,
      app_version: appVersion,
      package_version: packageVersion,
      app_sha: process.env.APP_SHA || appVersion,
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
      uptime: process.uptime(),
      rateLimiter: getRateLimiterStatus(),
    });
  });

  // Liveness probe (must be fast and never depend on downstreams)
  app.get("/api/health/live", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Readiness probe (best-effort dependency summary, no hard DB query on each call)
  app.get("/api/health/ready", (_req: Request, res: Response) => {
    const db = getDbHealthStatus();
    const mem = process.memoryUsage();
    const rlStatus = getRateLimiterStatus();

    const dbReady = db.status === "HEALTHY";
    const status = dbReady ? "ready" : "degraded";
    const httpStatus = dbReady ? 200 : 503;

    res.status(httpStatus).json({
      status,
      checks: {
        database: {
          status: db.status,
          latencyMs: db.latencyMs,
          lastCheck: db.lastCheck ? db.lastCheck.toISOString() : null,
          consecutiveFailures: db.consecutiveFailures,
        },
        memory: {
          status: "ok",
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
        },
        uptime: {
          status: "ok",
          seconds: process.uptime(),
        },
        rateLimiter: {
          status: rlStatus.backend === "redis" ? "ok" : "degraded",
          backend: rlStatus.backend,
          initialized: rlStatus.initialized,
        },
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/audit/execution-guard/status", (_req: Request, res: Response) => {
    res.json(getExecutionIntentGuardStatus());
  });

  // API Documentation
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  const metricsPublic = process.env.METRICS_PUBLIC === "true";
  if (metricsPublic) {
    app.get("/metrics", metricsHandler);
  } else {
    app.get("/metrics", requireAdminMiddleware, metricsHandler);
  }
  app.get("/api/pare/metrics", (_req: Request, res: Response) => {
    res.json({
      prometheus: getMetricsJson(),
      internal: getPareMetricsSummary(),
      health: getPareHealthSummary()
    });
  });
  app.use("/api/ai", aiExcelRouter);
  app.use("/api/power", powerRouter);
  app.use("/api/agents", multiAgentRouter);
  app.use("/api/errors", errorRouter);
  app.use("/api/spreadsheet", createSpreadsheetRouter());
  app.use("/api/skill-platform", createSkillPlatformRouter());
  app.use("/api/chat", createChatRoutes());
  app.use("/api/agent", createAgentModeRouter());
  app.use("/api/orchestrator", createOrchestratorRouter());

  // Register agentic tools (browser, research, documents, terminal)
  registerAgenticTools();
  app.use("/api", createSandboxAgentRouter());
  app.use("/api", createLangGraphRouter());

  // New routes from 8H plan
  app.use("/api/templates", templatesRouter);
  app.use("/api/webhooks", webhooksRouter);
  app.use("/api/auth/mfa", createMfaRouter());
  app.use("/api/2fa", twoFactorRouter);
  app.use("/api/security", createSecurityRouter());
  app.use("/api/api-keys", apiKeysRouter);
  app.use("/api/memory", memoryRouter);
  app.use("/api/packages", createPackagesRouter());
  app.use("/api/admin/analytics/advanced", advancedAnalyticsRouter);
  app.use("/api/admin/automations", automationsRouter);
  app.use("/api/academic", academicSearchRouter); // Scopus + Scholar academic search
  app.use("/api", createRegistryRouter());
  app.use("/api/word-pipeline", wordPipelineRoutes);
  app.use("/api/sse", redisSSERouter);
  app.use("/api/streaming", streamingResumeRouter);
  app.use("/api/memory", conversationMemoryRoutes);
  app.use("/api/memory/semantic", semanticRoutes); // Semantic memory search API
  app.use("/api/context", contextRoutes); // Enterprise context validation API
  app.use("/api", superAgentRouter);
  app.use("/api", createPythonToolsRouter());
  app.use("/api", createLocalControlRouter());
  app.use("/api/system", systemControlRouter);
  app.use("/api/execution", createToolExecutionRouter());
  app.use("/api/scientific", scientificSearchRouter);
  app.use("/api/planning", agentPlanRouter);
  app.use("/api/document-analysis", documentAnalysisRouter);
  app.use("/api/rag", ragRouter);
  app.use("/api/rag/memory", ragMemoryRouter);
  app.use("/api/feedback", feedbackRouter);
  app.use(createStripeRouter());
  app.use(createSettingsRouter());
  app.use("/api", createRunController());
  app.use("/api/superintelligence", superintelligenceRouter);
  app.use("/api/understanding", requestUnderstandingRoutes); // Request Understanding Pipeline (gating agent, RAG, verification)

  // SuperIntelligence System
  app.use("/api/audit", createAuditDashboardRouter());
  app.use("/api/super-intelligence", createSuperIntelligenceRouter());

  // ===== Device Control (autonomy primitives: local/remote terminal + browser) =====
  app.use("/api/device-control", createDeviceControlRouter());

  // ===== Browser & Terminal Control =====
  app.use("/api/browser-control", createBrowserControlRouter());
  app.use("/api/terminal", requireAdminMiddleware, require2FA, createTerminalControlRouter());

  // ===== macOS Native Control (AppleScript, System, Apps, Calendar, etc.) =====
  app.use("/api/macos", requireAdminMiddleware, createMacOSControlRouter());

  // ===== Automation Triggers (Cron, File Watch, Webhooks, System Events) =====
  app.use("/api/triggers", requireAdminMiddleware, createAutomationTriggersRouter());

  // ===== Voice & Audio (TTS, STT, Recording) =====
  app.use("/api/voice", requireAdminMiddleware, createVoiceRouter());

  // ===== Analytics & Cost Tracking =====
  app.use("/api/analytics", requireAdminMiddleware, createAnalyticsRouter());

  app.use("/api/workflows", createWorkflowRouter());

  // OpenClaw runtime capabilities are fused directly into the native agent pipeline.
  app.use("/api/openclaw", openClawRouter);
  app.use("/api/openclaw", createOpenClawRouter());

  // ===== Run Detail Endpoints =====
  app.use("/api/runs", createRunRouter());

  initializeEventStore().catch(console.error);

  // ===== Start Persistent Trigger Engine =====
  import("./services/persistentTriggerEngine").then(({ triggerEngine }) => {
    triggerEngine.start().then(() => {
      console.log("[TriggerEngine] Started");
    }).catch(err => {
      console.warn("[TriggerEngine] Start failed:", err.message);
    });
  }).catch(() => { });

  // ===== Start Analytics Service =====
  import("./services/advancedAnalytics").then(({ analyticsService }) => {
    analyticsService.start();
    console.log("[Analytics] Cost tracking started");
  }).catch(() => { });

  initializeRedisSSE().then(() => {
    console.log("[RedisSSE] Initialized");
  }).catch(err => {
    console.warn("[RedisSSE] Not available (Redis may not be configured):", err.message);
  });

  initializeAgentSystem({ runSmokeTest: false }).then(result => {
    console.log(`[AgentSystem] Initialized: ${result.toolCount} tools, ${result.agentCount} agents`);
  }).catch(err => {
    console.error("[AgentSystem] Initialization failed:", err.message);
  });

  // Initialize SuperIntelligence System (includes all phases)
  initializeSuperIntelligence().then((status) => {
    console.log(`[SuperIntelligence] System initialized - Health: ${status.stats.healthScore.toFixed(1)}%`);
  }).catch(err => {
    console.error("[SuperIntelligence] System initialization failed:", err.message);
    // Fall back to just audit system
    initializeAuditSystem().then(() => {
      console.log("[SuperIntelligence] Audit System initialized (fallback)");
    }).catch(e => {
      console.error("[SuperIntelligence] Audit System fallback failed:", e.message);
    });
  });

  // ===== Simple Tools & Agents Endpoints =====

  // GET /tools - Return all 100 tools
  app.get("/tools", requireAdminMiddleware, (_req: Request, res: Response) => {
    try {
      const tools = ALL_TOOLS.map(tool => ({
        name: tool.name,
        description: tool.description,
      }));

      res.json({
        success: true,
        count: tools.length,
        tools,
        categories: {
          safe: SAFE_TOOLS.map(t => t.name),
          system: SYSTEM_TOOLS.map(t => t.name),
        },
      });
    } catch (error: any) {
      console.error("[Tools] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to load tools",
      });
    }
  });

  // GET /agents - Return all 10 agents
  app.get("/agents", requireAdminMiddleware, (_req: Request, res: Response) => {
    try {
      const agents = SPECIALIZED_AGENTS.map(agent => ({
        name: agent.name,
        description: agent.description,
        capabilities: agent.capabilities,
        tools: agent.tools,
      }));

      res.json({
        success: true,
        count: agents.length,
        agents,
      });
    } catch (error: any) {
      console.error("[Agents] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to load agents",
      });
    }
  });

  // GET /api/super-agent/capabilities - Coverage mapping for Super Agente Digital 100
  // Query: ?source=combined|runtime|langgraph
  app.get("/api/super-agent/capabilities", requireAdminMiddleware, async (req: Request, res: Response) => {
    try {
      const rawSource = typeof req.query.source === "string" ? req.query.source : "combined";
      const source: SuperAgentCoverageSource =
        rawSource === "langgraph" || rawSource === "runtime" || rawSource === "combined"
          ? rawSource
          : "combined";

      const report = await getSuperAgentCoverageReport(source);

      // Optional filters for quickly spotting gaps:
      // - ?status=missing|partial|covered
      // - ?ready=true|false
      const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
      const readyFilter = typeof req.query.ready === "string" ? req.query.ready : undefined;

      let capabilities = report.capabilities;
      if (statusFilter === "missing" || statusFilter === "partial" || statusFilter === "covered") {
        capabilities = capabilities.filter((c) => c.status === statusFilter);
      }
      if (readyFilter === "true" || readyFilter === "false") {
        const wantReady = readyFilter === "true";
        capabilities = capabilities.filter((c) => c.availability.ready === wantReady);
      }

      const summary = {
        total: capabilities.length,
        covered: capabilities.filter((c) => c.status === "covered").length,
        partial: capabilities.filter((c) => c.status === "partial").length,
        missing: capabilities.filter((c) => c.status === "missing").length,
        ready: capabilities.filter((c) => c.availability.ready).length,
        blocked: capabilities.filter((c) => !c.availability.ready).length,
      };
      res.json({
        success: true,
        ...report,
        summary,
        capabilities,
      });
    } catch (error: any) {
      console.error("[SuperAgentCapabilities] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to compute super agent coverage",
      });
    }
  });

  // GET /api/super-agent/capabilities-1000 - Runtime catalog for OpenClaw1000
  // Query:
  // - ?category=<category>
  // - ?status=implemented|partial|stub|missing
  // - ?q=<prompt-like text> (returns capability profile + filtered matches)
  // - ?limit=1..1000
  app.get("/api/super-agent/capabilities-1000", requireAdminMiddleware, (req: Request, res: Response) => {
    try {
      const category = typeof req.query.category === "string" ? req.query.category : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const limitRaw = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : NaN;
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 200;

      let capabilities = listOpenClaw1000Capabilities({ category, status });
      let profileSummary: any = null;

      if (query.length > 0) {
        const profile = buildOpenClaw1000CapabilityProfile(query, {
          limit: 80,
          minScore: 0.08,
          includeStatuses: status
            ? [status as "implemented" | "partial" | "stub" | "missing"]
            : ["implemented", "partial"],
        });
        const matchedIds = new Set(profile.matches.map((match) => match.capability.id));
        capabilities = capabilities.filter((capability) => matchedIds.has(capability.id));
        profileSummary = {
          query: profile.query,
          matched: profile.matches.length,
          categories: profile.categories,
          recommendedTools: profile.recommendedTools,
          top: profile.matches.slice(0, 15).map((match) => ({
            id: match.capability.id,
            code: match.capability.code,
            capability: match.capability.capability,
            tool: match.capability.toolName,
            category: match.capability.category,
            score: match.score,
          })),
        };
      }

      res.json({
        success: true,
        catalog: "openclaw1000",
        stats: getOpenClaw1000QuickStats(),
        total: capabilities.length,
        profile: profileSummary,
        capabilities: capabilities.slice(0, limit),
      });
    } catch (error: any) {
      console.error("[SuperAgentCapabilities1000] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to load OpenClaw1000 capabilities",
      });
    }
  });

  // GET /api/tools - Enhanced tool catalog with category metadata
  app.get("/api/tools", requireAdminMiddleware, (_req: Request, res: Response) => {
    try {
      const categoryMap: Record<string, string[]> = {
        "Core": SAFE_TOOLS.map(t => t.name),
        "System": SYSTEM_TOOLS.map(t => t.name),
        "Web": ["browserNavigate", "browserClick", "browserType", "browserExtract", "browserScreenshot", "browserScroll", "browserClose", "webSearch", "webFetch", "webCrawl"],
        "Generation": ["imageGenerate", "codeGenerate", "textGenerate", "dataGenerate", "templateGenerate"],
        "Processing": ["textProcess", "dataTransform", "fileConvert", "imageProcess", "batchProcess"],
        "Data": ["dataAnalyze", "dataVisualize", "dataExport", "dataImport", "dataValidate"],
        "Document": ["documentCreate", "documentEdit", "documentParse", "documentMerge", "documentTemplate"],
        "Development": ["codeAnalyze", "codeFormat", "codeLint", "codeTest", "codeDebug"],
        "Diagram": ["diagramCreate", "flowchartGenerate", "mindmapCreate", "orgchartCreate"],
        "API": ["apiCall", "apiMock", "apiTest", "apiDocument"],
        "Productivity": ["taskCreate", "reminderSet", "noteCreate", "calendarEvent"],
        "Security": ["secretsManage", "accessControl", "auditLog", "encryptData"],
        "Automation": ["workflowCreate", "triggerSet", "scheduleTask", "batchRun"],
        "Database": ["queryExecute", "schemaManage", "dataBackup", "dataMigrate"],
        "Monitoring": ["metricsCollect", "alertCreate", "logAnalyze", "healthCheck"],
        "Memory": ["memoryStore", "memoryRetrieve", "contextManage", "sessionState"],
        "Reasoning": ["reason", "reflect", "verify"],
        "Orchestration": ["orchestrate", "workflow", "strategicPlan"],
        "Communication": ["decide", "clarify", "summarize", "explain"],
      };

      const categoryIcons: Record<string, string> = {
        "Core": "zap",
        "System": "terminal",
        "Web": "globe",
        "Generation": "sparkles",
        "Processing": "cog",
        "Data": "database",
        "Document": "file-text",
        "Development": "code",
        "Diagram": "git-branch",
        "API": "plug",
        "Productivity": "calendar",
        "Security": "shield",
        "Automation": "repeat",
        "Database": "hard-drive",
        "Monitoring": "activity",
        "Memory": "brain",
        "Reasoning": "lightbulb",
        "Orchestration": "layers",
        "Communication": "message-circle",
      };

      const tools = ALL_TOOLS.map(tool => {
        let category = "Utility";
        for (const [cat, toolNames] of Object.entries(categoryMap)) {
          if (toolNames.includes(tool.name)) {
            category = cat;
            break;
          }
        }
        return {
          name: tool.name,
          description: tool.description,
          category,
          icon: categoryIcons[category] || "wrench",
        };
      });

      const categories = Object.entries(categoryMap)
        .filter(([_, toolNames]) => toolNames.some(name => ALL_TOOLS.find(t => t.name === name)))
        .map(([name, _]) => ({
          name,
          icon: categoryIcons[name] || "folder",
          count: tools.filter(t => t.category === name).length,
        }));

      res.json({
        success: true,
        count: tools.length,
        tools,
        categories,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/agents - Alias for /agents
  app.get("/api/agents", (_req: Request, res: Response) => {
    try {
      const agents = SPECIALIZED_AGENTS;
      res.json({
        success: true,
        count: agents.length,
        agents,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== Python Agent v5.0 Endpoints =====

  // POST /api/python-agent/run - Execute the Python agent
  app.post("/api/python-agent/run", async (req: Request, res: Response) => {
    try {
      const { input, verbose = false, timeout = 60 } = req.body;

      if (!input || typeof input !== "string") {
        return res.status(400).json({
          success: false,
          error: "Missing or invalid 'input' field",
        });
      }

      const result = await runAgent(input, { verbose, timeout });
      res.json(result);
    } catch (error: any) {
      console.error("[PythonAgent] Run error:", error);

      if (error instanceof PythonAgentClientError) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
          success: false,
          error: error.message,
          details: error.details,
        });
      }

      res.status(500).json({
        success: false,
        error: error.message || "Failed to execute Python agent",
      });
    }
  });

  // GET /api/python-agent/tools - List available tools
  app.get("/api/python-agent/tools", async (_req: Request, res: Response) => {
    try {
      const tools = await getTools();
      res.json({
        success: true,
        data: tools,
      });
    } catch (error: any) {
      console.error("[PythonAgent] Tools error:", error);

      if (error instanceof PythonAgentClientError) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: error.message || "Failed to get Python agent tools",
      });
    }
  });

  // GET /api/python-agent/health - Check Python agent service health
  app.get("/api/python-agent/health", async (_req: Request, res: Response) => {
    try {
      const health = await pythonAgentHealthCheck();
      res.json({
        success: true,
        data: health,
      });
    } catch (error: any) {
      console.error("[PythonAgent] Health check error:", error);

      res.status(503).json({
        success: false,
        error: error.message || "Python agent service unavailable",
        status: "unhealthy",
      });
    }
  });

  // GET /api/python-agent/status - Quick availability check
  app.get("/api/python-agent/status", async (_req: Request, res: Response) => {
    const available = await isServiceAvailable();
    res.json({
      success: true,
      available,
      service: "python-agent-v5",
    });
  });

  // POST /api/python-agent/browse - Browse URL with Python agent
  app.post("/api/python-agent/browse", async (req: Request, res: Response) => {
    try {
      const result = await pythonAgentBrowse(req.body);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PythonAgentClientError) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/python-agent/search - Web search with Python agent
  app.post("/api/python-agent/search", async (req: Request, res: Response) => {
    try {
      const result = await pythonAgentSearch(req.body);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PythonAgentClientError) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/python-agent/document - Create document with Python agent
  app.post("/api/python-agent/document", async (req: Request, res: Response) => {
    try {
      const result = await pythonAgentCreateDocument(req.body);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PythonAgentClientError) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/python-agent/execute - Execute specific tool
  app.post("/api/python-agent/execute", async (req: Request, res: Response) => {
    try {
      const result = await pythonAgentExecuteTool(req.body);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PythonAgentClientError) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/python-agent/files - List files created by Python agent
  app.get("/api/python-agent/files", async (_req: Request, res: Response) => {
    try {
      const result = await pythonAgentListFiles();
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PythonAgentClientError) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/python-agent/agent-status - Detailed agent status
  app.get("/api/python-agent/agent-status", async (_req: Request, res: Response) => {
    try {
      const result = await pythonAgentGetStatus();
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PythonAgentClientError) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== Public Models Endpoint (for user-facing selector) =====
  app.get("/api/models/available", async (req: Request, res: Response) => {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    try {
      const allModels = await storage.getAiModels();
      const models = allModels
        .map((m: any) => ({ ...m, isEnabled: "true", status: "active" }))
        .sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0))
        .map((m: any) => toPublicModelSummary(m));
      res.json({ models });
    } catch (error: any) {
      console.error("[Models] Error fetching available models:", error);
      // Defensive fallback for production when DB schema is temporarily behind code.
      // Keep app shell functional (especially after logout) instead of surfacing 500.
      res.json({ models: PUBLIC_MODEL_FALLBACKS });
    }
  });

  // ===== AI Quality Stats & Content Filter Endpoints =====

  // GET /api/ai/quality-stats - Return quality statistics
  app.get("/api/ai/quality-stats", (req: Request, res: Response) => {
    try {
      const sinceParam = req.query.since as string | undefined;
      const since = sinceParam ? new Date(sinceParam) : undefined;

      const stats = llmGateway.getQualityStats(since);
      const filterStats = getFilterStats();

      res.json({
        success: true,
        data: {
          qualityStats: stats,
          filterStats,
        },
      });
    } catch (error: any) {
      console.error("[QualityStats] Error getting stats:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get quality stats"
      });
    }
  });

  // GET /api/ai/content-filter - Get current filter config
  app.get("/api/ai/content-filter", (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).user?.id || "anonymous";
      const config = getUserConfig(userId);

      res.json({
        success: true,
        data: config,
      });
    } catch (error: any) {
      console.error("[ContentFilter] Error getting config:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get filter config"
      });
    }
  });

  // PUT /api/ai/content-filter - Update filter config
  app.put("/api/ai/content-filter", (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).user?.id || "anonymous";
      const { enabled, sensitivityLevel, customPatterns } = req.body;

      // Validate sensitivity level
      if (sensitivityLevel && !["low", "medium", "high"].includes(sensitivityLevel)) {
        return res.status(400).json({
          success: false,
          error: "Invalid sensitivity level. Must be 'low', 'medium', or 'high'",
        });
      }

      // Validate custom patterns if provided
      if (customPatterns && Array.isArray(customPatterns)) {
        const validation = validatePatterns(customPatterns);
        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            error: `Invalid regex patterns: ${validation.invalidPatterns.join(", ")}`,
          });
        }
      }

      const newConfig = setUserConfig(userId, {
        enabled: enabled !== undefined ? Boolean(enabled) : undefined,
        sensitivityLevel,
        customPatterns,
      });

      res.json({
        success: true,
        data: newConfig,
      });
    } catch (error: any) {
      console.error("[ContentFilter] Error updating config:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to update filter config"
      });
    }
  });

  // GET /api/ai/content-filter/default - Get default filter config
  app.get("/api/ai/content-filter/default", (_req: Request, res: Response) => {
    try {
      const defaultConfig = getDefaultConfig();
      res.json({
        success: true,
        data: defaultConfig,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get default config"
      });
    }
  });

  // ===== Observability Endpoints =====

  // Initialize health monitoring
  initializeHealthMonitoring();

  // Start periodic connector health checks
  startPeriodicHealthCheck(60000);

  // GET /api/observability/logs - Query logs with filters
  app.get("/api/observability/logs", (req: Request, res: Response) => {
    try {
      const filters: LogFilters = {};

      if (req.query.level) {
        filters.level = req.query.level as "debug" | "info" | "warn" | "error";
      }
      if (req.query.component) {
        filters.component = req.query.component as string;
      }
      if (req.query.since) {
        filters.since = new Date(req.query.since as string);
      }
      if (req.query.requestId) {
        filters.requestId = req.query.requestId as string;
      }
      if (req.query.userId) {
        filters.userId = req.query.userId as string;
      }
      if (req.query.limit) {
        filters.limit = parseInt(req.query.limit as string, 10);
      }

      const logs = getLogs(filters);

      res.json({
        success: true,
        data: {
          logs,
          count: logs.length,
        },
      });
    } catch (error: any) {
      console.error("[Observability] Error getting logs:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get logs",
      });
    }
  });

  // GET /api/observability/health - Get all services health status
  app.get("/api/observability/health", (_req: Request, res: Response) => {
    try {
      const services = getAllServicesHealth();
      const overallStatus = getOverallStatus();

      res.json({
        success: true,
        data: {
          overall: overallStatus,
          services,
        },
      });
    } catch (error: any) {
      console.error("[Observability] Error getting health:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get health status",
      });
    }
  });

  // GET /api/observability/alerts - Get active alerts
  app.get("/api/observability/alerts", (req: Request, res: Response) => {
    try {
      const includeHistory = req.query.history === "true";
      const sinceParam = req.query.since as string | undefined;

      const activeAlerts = getActiveAlerts();
      const alertStats = getAlertStats();

      const response: any = {
        success: true,
        data: {
          active: activeAlerts,
          stats: alertStats,
        },
      };

      if (includeHistory) {
        const since = sinceParam ? new Date(sinceParam) : undefined;
        response.data.history = getAlertHistory(since);
      }

      res.json(response);
    } catch (error: any) {
      console.error("[Observability] Error getting alerts:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get alerts",
      });
    }
  });

  // POST /api/observability/alerts/:id/resolve - Resolve an alert
  app.post("/api/observability/alerts/:id/resolve", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const alert = resolveAlert(id);

      if (!alert) {
        return res.status(404).json({
          success: false,
          error: "Alert not found",
        });
      }

      res.json({
        success: true,
        data: alert,
      });
    } catch (error: any) {
      console.error("[Observability] Error resolving alert:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to resolve alert",
      });
    }
  });

  // GET /api/observability/stats - Get request and log stats
  app.get("/api/observability/stats", (_req: Request, res: Response) => {
    try {
      const logStats = getLogStats();
      const requestStats = getRequestStats();
      const activeReqs = getActiveRequests();

      res.json({
        success: true,
        data: {
          logs: logStats,
          requests: {
            ...requestStats,
            activeDetails: activeReqs,
          },
        },
      });
    } catch (error: any) {
      console.error("[Observability] Error getting stats:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get stats",
      });
    }
  });

  // ===== Connector Stats Endpoints =====

  // GET /api/connectors/stats - Get all connector statistics
  app.get("/api/connectors/stats", (_req: Request, res: Response) => {
    try {
      const stats = getAllConnectorStats();
      const healthSummary = getHealthSummary();

      res.json({
        success: true,
        data: {
          connectors: stats,
          health: healthSummary,
        },
      });
    } catch (error: any) {
      console.error("[Connectors] Error getting stats:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get connector stats",
      });
    }
  });

  // GET /api/connectors/:name/stats - Get single connector statistics
  app.get("/api/connectors/:name/stats", (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      if (!isValidConnector(name)) {
        return res.status(400).json({
          success: false,
          error: `Invalid connector name: ${name}. Valid connectors: gmail, gemini, xai, database, forms`,
        });
      }

      const stats = getConnectorStats(name as ConnectorName);
      const health = checkConnectorHealth(name as ConnectorName);

      res.json({
        success: true,
        data: {
          stats,
          health,
        },
      });
    } catch (error: any) {
      console.error("[Connectors] Error getting connector stats:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get connector stats",
      });
    }
  });

  // POST /api/connectors/:name/reset - Reset stats for connector (admin only)
  app.post("/api/connectors/:name/reset", (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const user = (req as AuthenticatedRequest).user;

      // Check admin role
      if (!user?.roles?.includes("admin")) {
        return res.status(403).json({
          success: false,
          error: "Admin access required",
        });
      }

      if (!isValidConnector(name)) {
        return res.status(400).json({
          success: false,
          error: `Invalid connector name: ${name}. Valid connectors: gmail, gemini, xai, database, forms`,
        });
      }

      resetConnectorStats(name as ConnectorName);

      res.json({
        success: true,
        message: `Stats reset for connector: ${name}`,
      });
    } catch (error: any) {
      console.error("[Connectors] Error resetting stats:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to reset connector stats",
      });
    }
  });

  const objectStorageService = new ObjectStorageService();

  browserSessionManager.addGlobalEventListener((event: SessionEvent) => {
    broadcastBrowserEvent(event.sessionId, event);
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws/agent" });

  createAuthenticatedWebSocketHandler(wss, true, (ws: AuthenticatedWebSocket) => {
    let subscribedRunId: string | null = null;

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "subscribe" && data.runId) {
          subscribedRunId = data.runId;
          if (!agentClients.has(data.runId)) {
            agentClients.set(data.runId, new Set());
          }
          agentClients.get(data.runId)!.add(ws);
        }
      } catch (e) {
        console.error("WS message parse error:", e);
      }
    });

    ws.on("close", () => {
      if (subscribedRunId) {
        const clients = agentClients.get(subscribedRunId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            agentClients.delete(subscribedRunId);
          }
        }
      }
    });
  });

  const browserWss = new WebSocketServer({ server: httpServer, path: "/ws/browser" });

  const fileStatusWss = new WebSocketServer({ server: httpServer, path: "/ws/file-status" });

  createAuthenticatedWebSocketHandler(fileStatusWss, true, (ws: AuthenticatedWebSocket) => {
    let subscribedFileIds: Set<string> = new Set();

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "subscribe" && data.fileId) {
          subscribedFileIds.add(data.fileId);
          if (!fileStatusClients.has(data.fileId)) {
            fileStatusClients.set(data.fileId, new Set());
          }
          fileStatusClients.get(data.fileId)!.add(ws);

          ws.send(JSON.stringify({ type: "subscribed", fileId: data.fileId }));

          const job = fileProcessingQueue.getJob(data.fileId);
          if (job && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'file_status',
              fileId: job.fileId,
              status: job.status,
              progress: job.progress,
              error: job.error,
            }));
          }
        } else if (data.type === "unsubscribe" && data.fileId) {
          subscribedFileIds.delete(data.fileId);
          const clients = fileStatusClients.get(data.fileId);
          if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
              fileStatusClients.delete(data.fileId);
            }
          }
        }
      } catch (e) {
        console.error("File status WS message parse error:", e);
      }
    });

    ws.on("close", () => {
      const fileIds = Array.from(subscribedFileIds);
      for (const fileId of fileIds) {
        const clients = fileStatusClients.get(fileId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            fileStatusClients.delete(fileId);
          }
        }
      }
    });
  });

  fileProcessingQueue.setStatusChangeHandler((update: FileStatusUpdate) => {
    broadcastFileStatus(update);
  });

  fileProcessingQueue.setProcessCallback(async (job) => {
    try {
      await storage.updateFileJobStatus(job.fileId, "processing");
      await storage.updateFileProgress(job.fileId, 10);
      fileProcessingQueue.updateProgress(job.fileId, 10);

      const objectFile = await objectStorageService.getObjectEntityFile(job.storagePath);
      const content = await objectStorageService.getFileContent(objectFile);
      await storage.updateFileProgress(job.fileId, 30);
      fileProcessingQueue.updateProgress(job.fileId, 30);

      const result = await processDocument(content, job.mimeType, job.fileName);
      await storage.updateFileProgress(job.fileId, 50);
      fileProcessingQueue.updateProgress(job.fileId, 50);

      const chunks = chunkText(result.text, 1500, 150);
      await storage.updateFileProgress(job.fileId, 60);
      fileProcessingQueue.updateProgress(job.fileId, 60);

      const texts = chunks.map(c => c.content);
      const embeddings = await generateEmbeddingsBatch(texts);
      await storage.updateFileProgress(job.fileId, 80);
      fileProcessingQueue.updateProgress(job.fileId, 80);

      const chunksWithEmbeddings = chunks.map((chunk, i) => ({
        fileId: job.fileId,
        content: chunk.content,
        embedding: embeddings[i],
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber || null,
        metadata: null,
      }));

      await storage.createFileChunks(chunksWithEmbeddings);
      await storage.updateFileProgress(job.fileId, 95);
      fileProcessingQueue.updateProgress(job.fileId, 95);

      await storage.updateFileCompleted(job.fileId);
      await storage.updateFileJobStatus(job.fileId, "completed");

      console.log(`[FileQueue] File ${job.fileId} processed: ${chunks.length} chunks created`);
    } catch (error: any) {
      console.error(`[FileQueue] Error processing file ${job.fileId}:`, error);
      await storage.updateFileError(job.fileId, error.message || "Unknown error");
      await storage.updateFileJobStatus(job.fileId, "failed", error.message);
      throw error;
    }
  });

  createAuthenticatedWebSocketHandler(browserWss, true, (ws: AuthenticatedWebSocket) => {
    let subscribedSessionId: string | null = null;

    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "subscribe" && data.sessionId) {
          subscribedSessionId = data.sessionId;
          if (!browserClients.has(data.sessionId)) {
            browserClients.set(data.sessionId, new Set());
          }
          browserClients.get(data.sessionId)!.add(ws);

          ws.send(JSON.stringify({ type: "subscribed", sessionId: data.sessionId }));

          try {
            const screenshot = await browserSessionManager.getScreenshot(data.sessionId);
            if (screenshot && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                messageType: "browser_event",
                eventType: "observation",
                sessionId: data.sessionId,
                timestamp: new Date(),
                data: { type: "screenshot", screenshot }
              }));
            }
          } catch (e) {
          }
        }
      } catch (e) {
        console.error("Browser WS message parse error:", e);
      }
    });

    ws.on("close", () => {
      if (subscribedSessionId) {
        const clients = browserClients.get(subscribedSessionId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            browserClients.delete(subscribedSessionId);
          }
        }
      }
    });
  });

  // ===== Terminal WebSocket =====
  const terminalWss = new WebSocketServer({ server: httpServer, path: "/ws/terminal" });

  createAuthenticatedWebSocketHandler(terminalWss, true, (ws: AuthenticatedWebSocket) => {
    let subscribedSessionId: string | null = null;

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === "subscribe" && data.sessionId) {
          subscribedSessionId = data.sessionId;
          if (!terminalClients.has(data.sessionId)) {
            terminalClients.set(data.sessionId, new Set());
          }
          terminalClients.get(data.sessionId)!.add(ws);
          ws.send(JSON.stringify({ type: "subscribed", sessionId: data.sessionId }));
        } else if (data.type === "input" && subscribedSessionId) {
          // Forward input to terminal session (for interactive commands)
          ws.send(JSON.stringify({
            type: "ack",
            sessionId: subscribedSessionId,
            timestamp: Date.now(),
          }));
        }
      } catch (e) {
        console.error("Terminal WS message parse error:", e);
      }
    });

    ws.on("close", () => {
      if (subscribedSessionId) {
        const clients = terminalClients.get(subscribedSessionId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            terminalClients.delete(subscribedSessionId);
          }
        }
      }
    });
  });

  return httpServer;
}

function broadcastBrowserEvent(sessionId: string, event: SessionEvent) {
  const clients = browserClients.get(sessionId);
  if (!clients) return;

  const message = JSON.stringify({
    messageType: "browser_event",
    eventType: event.type,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    data: event.data
  });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastAgentUpdate(runId: string, update: StepUpdate) {
  const clients = agentClients.get(runId);
  if (!clients) return;

  const message = JSON.stringify({ type: "step_update", ...update });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastFileStatus(update: FileStatusUpdate) {
  const clients = fileStatusClients.get(update.fileId);
  if (!clients) return;

  const message = JSON.stringify(update);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
