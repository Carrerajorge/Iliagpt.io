
import "./otel";

import "./config/load-env";
import "./lib/expressAsyncPatch";
import { env } from "./config/env"; // Validates env vars immediately on import

import compression from "compression";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer } from "http";
import hpp from "hpp";

import { registerRoutes } from "./routes";
import { serveStatic } from "./static";

import { apiErrorHandler } from "./middleware/apiErrorHandler";
import { canonicalUrlMiddleware } from "./middleware/canonicalUrl";
import { corsMiddleware } from "./middleware/cors";
import { csrfProtection, csrfTokenMiddleware } from "./middleware/csrf";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { idempotency } from "./middleware/idempotency";
import { requestLoggerMiddleware } from "./middleware/requestLogger";
import { apiSecurityHeaders } from "./middleware/securityHeaders";
import { sessionDeviceInfoMiddleware } from "./middleware/sessionDeviceInfo";
import { setupSecurity } from "./middleware/security";
import { requestBoundaryGuard } from "./middleware/requestBoundary";
import { correlationIdMiddleware } from "./middleware/correlationId";

import { authLimiter, billingLimiter, globalLimiter } from "./middleware/rateLimiter";
import { responseBudget } from "./middleware/responseBudget";
import { abuseDetection, stopAbuseDetectionCleanup } from "./middleware/abuseDetection";
import { requestIntegrity, stopIntegrityCleanup } from "./middleware/requestIntegrity";
import { hostValidation } from "./middleware/hostValidation";
import { hardenServer } from "./middleware/socketHardening";

import { runCleanup } from "./lib/cleanup";
import { db, drainConnections, startHealthChecks, stopHealthChecks, verifyDatabaseConnection } from "./db";
import { setupGracefulShutdown, registerCleanup } from "./lib/gracefulShutdown";
import { Logger } from "./lib/logger";
import { pythonServiceManager } from "./lib/pythonServiceManager";
import { requestTracerMiddleware } from "./lib/requestTracer";
import { getTracingMetrics, initTracing, shutdownTracing } from "./lib/tracing";

import { seedProductionData } from "./seed-production";
import { startAggregator } from "./services/analyticsAggregator";
import { startChatScheduleRunner } from "./services/chatScheduleRunner";
import { optimizeOpenClawSkills } from "./services/openclawSkillOptimizer";
import { startTelemetryPipeline } from "./telemetry/pipeline";

import { registerAuthRoutes, setupAuth } from "./replit_integrations/auth";
import { getUserId } from "./types/express";
import { updateContext } from "./middleware/correlationContext";
import { validateApiKey } from "./routes/apiKeysRouter";
import { AppError } from "./utils/errors";
import { checkMigrationDrift } from "./lib/migrationDriftCheck";
import { startMemoryPurgeJob } from "./services/memoryPurgeService";
initTracing();

const app = express();
app.set("trust proxy", 1); // Trust first proxy (critical for rate limiting behind load balancers)
const httpServer = createServer(app);

function clampConfigNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

const BODY_LIMIT_RE = /^\s*(\d+)\s*(b|kb|mb|gb)?\s*$/i;
const BODY_LIMIT_MULTIPLIERS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

function normalizeBodyLimit(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const match = value.match(BODY_LIMIT_RE);
  if (!match) {
    Logger.warn(`[config] Invalid body limit "${value}", using fallback ${fallback}`);
    return fallback;
  }

  const [, amount, rawUnit] = match;
  const unit = (rawUnit || "b").toLowerCase();
  return `${amount}${unit}`;
}

function parseBodyLimitBytes(value: string): number | null {
  const match = value.match(BODY_LIMIT_RE);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = (match[2] || "b").toLowerCase();
  const multiplier = BODY_LIMIT_MULTIPLIERS[unit];

  if (!Number.isFinite(amount) || amount <= 0 || !multiplier) {
    return null;
  }

  return amount * multiplier;
}

const isProdEnv = process.env.NODE_ENV === 'production';
const apiJsonBodyLimit = normalizeBodyLimit(
  env.API_JSON_BODY_LIMIT,
  isProdEnv ? "5mb" : "10mb",
);
const configuredChatStreamJsonBodyLimit = normalizeBodyLimit(
  env.CHAT_STREAM_JSON_BODY_LIMIT,
  isProdEnv ? "32mb" : "64mb",
);
const urlencodedBodyLimit = normalizeBodyLimit(
  env.URLENCODED_BODY_LIMIT,
  isProdEnv ? "2mb" : "5mb",
);
const chatStreamJsonBodyLimit =
  (parseBodyLimitBytes(configuredChatStreamJsonBodyLimit) || 0) >= (parseBodyLimitBytes(apiJsonBodyLimit) || 0)
    ? configuredChatStreamJsonBodyLimit
    : apiJsonBodyLimit;

const stopSocketHardening = hardenServer(httpServer, {
  headersTimeout: Number(process.env.SOCKET_HEADERS_TIMEOUT_MS) || (isProdEnv ? 15_000 : 60_000),
  keepAliveTimeout: Number(process.env.SOCKET_KEEP_ALIVE_TIMEOUT_MS) || (isProdEnv ? 65_000 : 605_000),
  requestTimeout: Number(process.env.SOCKET_REQUEST_TIMEOUT_MS) || (isProdEnv ? 300_000 : 600_000),
  maxConnectionsPerIP: Number(process.env.SOCKET_MAX_CONNECTIONS_PER_IP) || (isProdEnv ? 500 : 300),
  minBytesPerSecond: Number(process.env.SOCKET_MIN_BYTES_PER_SEC) || 50,
  cleanupIntervalMs: Number(process.env.SOCKET_CLEANUP_INTERVAL_MS) || 30_000,
});

const telemetryPipelineController = startTelemetryPipeline({
  db,
  batchSize: clampConfigNumber(process.env.TELEMETRY_BATCH_SIZE, 100, 5, 5_000),
  flushIntervalMs: clampConfigNumber(process.env.TELEMETRY_FLUSH_INTERVAL_MS, 2_000, 200, 60_000),
  maxQueueSize: clampConfigNumber(process.env.TELEMETRY_MAX_QUEUE_SIZE, 5_000, 200, 200_000),
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// DNS rebinding protection — must be very early, before any routing
app.use(hostValidation());

// Request logger middleware with correlation context - must go first
app.use(correlationIdMiddleware);
app.use(requestLoggerMiddleware);

// Canonical URL redirect (www -> non-www) - must be before CORS and sessions
app.use(canonicalUrlMiddleware);

app.use(
  compression({
    level: 6,
    threshold: 512,
    memLevel: 8,
    filter: (req, res) => {
      if (
        req.url?.includes("/chat/stream") ||
        req.url?.includes("/super/stream") ||
        req.headers.accept === "text/event-stream" ||
        req.headers['x-no-compression'] ||
        res.getHeader("Content-Type")?.toString().includes("text/event-stream") ||
        res.getHeader("Content-Type")?.toString().includes("application/octet-stream")
      ) {
        return false;
      }
      return compression.filter(req, res);
    },
  }),
);

// CORS configuration - must be before other middleware
app.use(corsMiddleware);

// Security Middleware (Helmet + HPP)
app.use(hpp()); // Prevent HTTP Parameter Pollution
setupSecurity(app); // Enhanced Helmet Config

// CSRF Token Generation (sets cookie)
app.use(csrfTokenMiddleware);

// API-specific security headers for /api routes
app.use("/api", apiSecurityHeaders());

// Defense in Depth
app.disable("x-powered-by");

// Route-specific body limits (MUST come before global parser)
// /api/chat/stream needs a higher limit to support inline image base64 for vision,
// but it should still be capped independently from the rest of the API surface.
app.use("/api/chat/stream", express.json({
  limit: chatStreamJsonBodyLimit,
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  },
  strict: true,
}));

// Global body parsing should stay significantly tighter than chat streaming.
// Large uploads should go through dedicated upload routes instead of generic JSON.
app.use(
  express.json({
    limit: apiJsonBodyLimit,
    verify: (req: any, res: any, buf: Buffer) => {
      req.rawBody = buf.toString();
    },
    strict: true,
  }),
);

app.use(express.urlencoded({ extended: false, limit: urlencodedBodyLimit, parameterLimit: 1000 }));

// API hardening boundary: path/query/payload validation and canonicalization
app.use("/api", requestBoundaryGuard);
app.use("/api", requestIntegrity());

// Response time budget: tracks latency and logs overruns (observability layer)
app.use("/api", responseBudget());

// Legacy request tracer middleware for stats
app.use(requestTracerMiddleware);

export function log(message: string, source = "express") {
  Logger.info(`[${source}] ${message}`);
}

(async () => {
  const isProduction = process.env.NODE_ENV === "production";
  const isTest = process.env.NODE_ENV === "test";
  const startPythonService = process.env.START_PYTHON_SERVICE === "true";
  const autoOptimizeOpenClawSkills = process.env.OPENCLAW_AUTO_OPTIMIZE !== "false";

  // Start Python Agent Tools service if enabled
  if (startPythonService) {
    log("Starting Python Agent Tools service...");
    const pythonStarted = await pythonServiceManager.start();
    if (pythonStarted) {
      log(`Python service running on port ${pythonServiceManager.getPort()}`);
    } else {
      log("[WARNING] Python service failed to start - some features may not work");
    }
  }

  // Verify database connection before starting (critical in production)
  log("Verifying database connection...");
  const dbConnected = await verifyDatabaseConnection();

  if (!dbConnected && isProduction) {
    log("[FATAL] Cannot start production server without database connection");
    process.exit(1);
  }

  if (dbConnected) {
    log("Database connection verified successfully");
    startHealthChecks();
    log("Database health checks started");

    // Setup Full-Text Search
    const { setupFts } = await import("./lib/fts");
    await setupFts();

    // Initialize CQRS admin projection (subscribes to auth events, refreshes materialized view)
    const { initAdminProjection } = await import("./services/adminProjection");
    initAdminProjection();

    // Start background ActionTriggerDaemon
    const { actionTriggerDaemon } = await import("./services/actionTriggerDaemon");
    await actionTriggerDaemon.start();
  } else {
    log("[WARNING] Database connection failed - some features may not work");
  }

  // Initialize connector manifests + mount connector tools/policies.
  // This enables "Apps" (Slack/Notion/GitHub/etc) tool wiring via the Integration Kernel.
  try {
    const { initializeConnectorManifests, mountConnectorTools } = await import("./integrations/kernel");
    await initializeConnectorManifests();
    await mountConnectorTools();
    log("Connector manifests initialized and tools mounted", "integrations");
  } catch (err: any) {
    log(`[WARNING] Connector initialization failed: ${err?.message || err}`, "integrations");
  }

  // Verify LLM connectivity in production
  if (isProduction) {
    try {
      const { llmGateway } = await import("./lib/llmGateway");
      const llmHealth = await llmGateway.healthCheck();
      if (llmHealth.xai?.available) {
        log("✅ xAI LLM connected");
      }
      if (llmHealth.gemini?.available) {
        log("✅ Gemini LLM connected");
      }
      if (!llmHealth.xai?.available && !llmHealth.gemini?.available) {
        log("[WARNING] No LLM providers available - chat will not work");
      }
    } catch (error) {
      log("[WARNING] LLM health check failed:", error);
    }
  }

  // Session + Passport (must be before csrfProtection/rateLimiter/idempotency)
  await setupAuth(app);
  // Ensure CorrelationContext has the authenticated userId (req.user can be populated by Passport/session).
  // Also bind the session to the authenticated userId for simpler secure queries later.
  app.use((req, _res, next) => {
    const userId = getUserId(req);
    if (userId && !userId.startsWith("anon_")) {
      updateContext({ userId });

      const session = (req as any).session as any | undefined;
      if (session && !session.authUserId) {
        session.authUserId = userId;
      }
    }
    next();
  });

  registerAuthRoutes(app);

  // Capture best-effort device metadata for session management UI.
  app.use("/api", sessionDeviceInfoMiddleware);

  // CSRF Protection for API (validates header)
  // NOTE: /api/packages is an API endpoint; protect it via auth/feature-flags/policy (not CSRF),
  // and allow local/automation calls without Secure-cookie issues.
  if (!isTest) {
    app.use("/api", validateApiKey);
    app.use("/api", (req, res, next) => {
      if (req.path.startsWith("/packages")) return next(); // /api/packages/*
      return csrfProtection(req, res, next);
    });
  } else {
    log("CSRF protection disabled in test environment", "security");
  }

  // Rate Limiting (User-based) - Applied AFTER auth to use req.user
  app.use("/api", globalLimiter);
  // Legacy/public routes outside /api should still be rate-limited.
  app.use(["/tools", "/agents", "/metrics", "/mcp"], globalLimiter);
  app.use("/api/auth", authLimiter);
  app.use("/api/checkout", billingLimiter);
  app.use("/api/billing", billingLimiter);
  app.use("/api/stripe", billingLimiter);

  // Behavioral abuse detection (anomaly scoring, complementary to rate limiter)
  app.use("/api", abuseDetection());

  // Idempotency for mutations
  app.use("/api", idempotency);

  // Attach OpenClaw WebSocket gateway for the control UI (must be before route registration
  // which creates other WebSocket servers that may reject unmatched upgrades)
  const { attachOpenClawGateway } = await import("./services/openclawGateway");
  attachOpenClawGateway(httpServer);

  await registerRoutes(httpServer, app);

  // Initialize OpenClaw agentic integration layer (feature-flagged)
  const { initializeOpenClaw } = await import("./openclaw/index");
  await initializeOpenClaw(httpServer);

  // Initialize the agentic capability layer (AgenticLoop, tools, terminal, tasks)
  try {
    const { integrateAgenticSystem } = await import("./integration/index");
    await integrateAgenticSystem(app);
  } catch (err) {
    log(`[WARNING] Agentic system integration failed: ${(err as Error).message}`);
  }

  // Ensure unmatched API routes return consistent JSON (instead of Express' default HTML 404).
  // This MUST be registered after all routes, but before the API error handler.
  app.use("/api", (req, _res, next) => {
    next(
      new AppError(
        `Route ${req.method} ${req.originalUrl || req.path} not found`,
        404,
        "NOT_FOUND",
        true,
      ),
    );
  });

  // API Error Handler (Centralized)
  app.use("/api", apiErrorHandler);

  // App-level error handler (catch-all)
  app.use(errorHandler);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (isProduction) {
    serveStatic(app);
  } else {
    app.use((req, res, next) => {
      if (req.path.startsWith('/src/') || req.path.startsWith('/@') || req.path.startsWith('/node_modules/')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      }
      next();
    });
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  const port = env.PORT;

  const listenOptions = isProduction
    ? ({ port, host: "0.0.0.0", reusePort: true } as const)
    : port;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server = (httpServer.listen as any)(listenOptions, async () => {
    log(`serving on port ${port}`);
    log(`Environment: ${isProduction ? "PRODUCTION" : "development"}`);
    log(`Database: ${dbConnected ? "connected" : "NOT CONNECTED"}`);
    startAggregator();
    await seedProductionData();

    // Check for SQL migration files on disk not registered in the Drizzle journal
    await checkMigrationDrift();

    if (dbConnected) {
      startChatScheduleRunner();
      startMemoryPurgeJob();
    } else {
      log("[Schedules] Skipping schedule runner start because DB is not connected");
    }

    if (!isTest && autoOptimizeOpenClawSkills) {
      void optimizeOpenClawSkills({ mode: "all-installable", timeoutMs: 300_000 })
        .then((result) => {
          log(
            `[OpenClawSkills] Optimized ${result.summaryAfter.ready}/${result.summaryAfter.total} skills ready; installed=${result.installed.length}; failed=${result.failed.length}; skipped=${result.skipped.length}`,
          );
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          log(`[OpenClawSkills] Automatic optimization failed: ${message}`);
        });
    }

    if (isProdEnv) {
      server.keepAliveTimeout = 65000;
      server.headersTimeout = 66000;
    } else {
      server.keepAliveTimeout = 360000;
      server.headersTimeout = 361000;
    }

    // Setup graceful shutdown with connection draining
    setupGracefulShutdown(httpServer, {
      timeout: 10000,
      onShutdown: async () => {
        log("Running application cleanup...");
      },
    });

    // Register database cleanup
    registerCleanup(async () => {
      log("Stopping database health checks...");
      stopHealthChecks();
      log("Draining database connections...");
      await drainConnections();
      log("Database cleanup complete");
    });

    // Register Python service cleanup
    if (startPythonService && pythonServiceManager.isRunning()) {
      registerCleanup(async () => {
        log("Stopping Python service...");
        pythonServiceManager.stop();
      });
    }

    // Register WhatsApp Web cleanup
    registerCleanup(async () => {
      log("Shutting down WhatsApp Web sessions...");
      const { whatsappWebManager } = await import('./integrations/whatsappWeb');
      await whatsappWebManager.shutdownAll();
      log("WhatsApp Web cleanup complete");
    });

    // Register OpenTelemetry tracing cleanup
    registerCleanup(async () => {
      log("Shutting down OpenTelemetry tracing...");
      await shutdownTracing();
      log("OpenTelemetry tracing shutdown complete");
    });

    // Register security middleware cleanup
    registerCleanup(async () => {
      stopAbuseDetectionCleanup();
      stopIntegrityCleanup();
      log("Security middleware cleanup complete");
    });

    registerCleanup(async () => {
      await telemetryPipelineController.stop();
      log("Telemetry pipeline cleanup complete");
    });

    registerCleanup(async () => {
      stopSocketHardening();
      log("Socket hardening cleanup complete");
    });

    // Schedule Daily Cleanup (24h)
    setInterval(() => {
      runCleanup().catch(err => log(`[Cleanup Error] ${err.message}`));
    }, 24 * 60 * 60 * 1000);
    // Run once on startup after delay
    setTimeout(() => {
      runCleanup().catch(err => log(`[Cleanup Error] ${err.message}`));
    }, 60 * 1000);

    const tracingStatus = getTracingMetrics();
    log(
      `OpenTelemetry: initialized=${tracingStatus.isInitialized}, sampleRate=${tracingStatus.sampleRate * 100}%`,
    );

    log("Graceful shutdown handler configured");

    // Optional: auto-register Telegram webhook after the server is reachable.
    if (env.TELEGRAM_AUTO_SET_WEBHOOK && env.TELEGRAM_WEBHOOK_URL && env.TELEGRAM_BOT_TOKEN) {
      setTimeout(() => {
        import("./channels/telegram/telegramApi")
          .then(({ telegramSetWebhook }) =>
            telegramSetWebhook({
              webhookUrl: env.TELEGRAM_WEBHOOK_URL as string,
              secretToken: env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
            }),
          )
          .then(() => log(`[Telegram] Webhook configured: ${env.TELEGRAM_WEBHOOK_URL}`))
          .catch((e) => log(`[Telegram] Webhook auto-config failed: ${e?.message || e}`));
      }, 1500);
    }
  });
})();
