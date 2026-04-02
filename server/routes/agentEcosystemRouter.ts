import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  AGENT_ECOSYSTEM_SERVICE_IDS,
  agentEcosystemService,
  type AgentEcosystemServiceId,
} from "../services/agentEcosystemService";

const serviceIdEnum = z.enum(AGENT_ECOSYSTEM_SERVICE_IDS);
const serviceIdSchema = z.preprocess(
  (value) => String(value ?? "").trim().toLowerCase().replace(/-/g, "_"),
  serviceIdEnum,
);

const statusQuerySchema = z.object({
  live: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  deep: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  timeoutMs: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return undefined;
      return Math.max(500, Math.min(30_000, Math.trunc(parsed)));
    }),
  deepMaxRepos: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return undefined;
      return Math.max(1, Math.min(5_000, Math.trunc(parsed)));
    }),
});

const proxySchema = z.object({
  service: serviceIdSchema,
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().default("GET"),
  path: z.string().optional().default("/"),
  query: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  timeoutMs: z.number().int().min(500).max(120000).optional(),
});

const composeSchema = z.object({
  action: z.enum(["up", "down", "ps", "logs", "restart"]),
  profiles: z.array(z.string().trim().min(1)).optional(),
  services: z.array(z.string().trim().min(1)).optional(),
  follow: z.boolean().optional(),
  lines: z.number().int().min(1).max(2000).optional(),
  timeoutMs: z.number().int().min(1000).max(900000).optional(),
});

const repoScriptSchema = z.object({
  timeoutMs: z.number().int().min(1000).max(900000).optional(),
});

const repoExecSchema = z.object({
  repo: z.string().trim().min(1).max(120),
  command: z.string().trim().min(1).max(64),
  args: z.array(z.string().min(1).max(4000)).max(64).optional(),
  timeoutMs: z.number().int().min(1000).max(900000).optional(),
  env: z.record(z.string().max(4000)).optional(),
});

const repoSearchSchema = z.object({
  repo: z.string().trim().min(1).max(120).optional(),
  pattern: z.string().trim().min(1).max(300),
  glob: z.string().trim().min(1).max(256).optional(),
  maxResults: z.number().int().min(1).max(1000).optional(),
  timeoutMs: z.number().int().min(1000).max(600000).optional(),
});

const repoReadSchema = z.object({
  repo: z.string().trim().min(1).max(120),
  filePath: z.string().trim().min(1).max(500),
  maxBytes: z.number().int().min(1000).max(2000000).optional(),
});

const repoProbeSchema = z.object({
  repo: z.string().trim().min(1).max(120).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  maxRepos: z.number().int().min(1).max(5000).optional(),
});

const deepAuditSchema = z.object({
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  maxRepos: z.number().int().min(1).max(5000).optional(),
  includeAdapters: z.boolean().optional(),
  includeRuntime: z.boolean().optional(),
  includeSmoke: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(12).optional(),
});

function getRequester(req: Request): string {
  const authReq = req as any;
  return (
    authReq?.user?.claims?.sub ||
    authReq?.user?.id ||
    authReq?.session?.authUserId ||
    "system"
  );
}

function respondValidationError(res: Response, error: unknown): Response | null {
  if (!(error instanceof z.ZodError)) return null;
  return res.status(400).json({
    ok: false,
    error: "invalid_request",
    details: error.flatten(),
  });
}

export function createAgentEcosystemRouter(): Router {
  const router = Router();

  router.get("/services", (_req, res) => {
    const services = agentEcosystemService.getConfiguredServices();
    return res.json({
      ok: true,
      count: services.length,
      enabledCount: services.filter((service) => service.enabled).length,
      services,
    });
  });

  router.get("/status", async (req, res) => {
    try {
      const parsed = statusQuerySchema.parse(req.query ?? {});
      const status = await agentEcosystemService.getFusionStatus({
        live: parsed.live,
        timeoutMs: parsed.timeoutMs,
        deep: parsed.deep,
        deepMaxRepos: parsed.deepMaxRepos,
      });
      return res.json({ ok: true, requester: getRequester(req), ...status });
    } catch (error) {
      const handled = respondValidationError(res, error);
      if (handled) return handled;
      return res.status(500).json({
        ok: false,
        error: (error as Error)?.message || "status_failed",
      });
    }
  });

  router.get("/health/:serviceId", async (req, res) => {
    const serviceId = String(req.params.serviceId ?? "")
      .trim()
      .toLowerCase()
      .replace(/-/g, "_") as AgentEcosystemServiceId;
    if (!AGENT_ECOSYSTEM_SERVICE_IDS.includes(serviceId)) {
      return res.status(404).json({ ok: false, error: "unknown_service" });
    }
    try {
      const timeoutMs = req.query.timeoutMs ? Number(req.query.timeoutMs) : undefined;
      const health = await agentEcosystemService.probeService(serviceId, timeoutMs);
      return res.status(health.ok ? 200 : 503).json({
        ok: health.ok,
        service: serviceId,
        health,
      });
    } catch (error: any) {
      return res.status(500).json({
        ok: false,
        service: serviceId,
        error: error?.message || "probe_failed",
      });
    }
  });

  router.post("/proxy", async (req, res) => {
    if (!agentEcosystemService.isProxyEnabled()) {
      return res.status(403).json({
        ok: false,
        error: "service_proxy_disabled",
        message:
          "Proxy is disabled in local-only fusion mode. Use repo adapters (repos/search, repos/read, repos/exec, repos/probe).",
      });
    }
    try {
      const parsed = proxySchema.parse(req.body || {});
      const result = await agentEcosystemService.proxyRequest(parsed);
      return res.status(result.ok ? 200 : 502).json({
        ok: result.ok,
        requester: getRequester(req),
        result,
      });
    } catch (error) {
      const handled = respondValidationError(res, error);
      if (handled) return handled;
      return res.status(500).json({
        ok: false,
        error: (error as Error)?.message || "proxy_failed",
      });
    }
  });

  router.post("/compose", async (req, res) => {
    try {
      const parsed = composeSchema.parse(req.body || {});
      const result = await agentEcosystemService.runCompose(parsed);
      return res.status(result.ok ? 200 : 500).json({
        ok: result.ok,
        requester: getRequester(req),
        result,
      });
    } catch (error) {
      const handled = respondValidationError(res, error);
      if (handled) return handled;
      return res.status(500).json({
        ok: false,
        error: (error as Error)?.message || "compose_failed",
      });
    }
  });

  router.post("/repos/sync", async (req, res) => {
    try {
      const parsed = repoScriptSchema.parse(req.body || {});
      const result = await agentEcosystemService.syncRepos(parsed.timeoutMs);
      return res.status(result.ok ? 200 : 500).json({
        ok: result.ok,
        requester: getRequester(req),
        result,
      });
    } catch (error) {
      const handled = respondValidationError(res, error);
      if (handled) return handled;
      return res.status(500).json({
        ok: false,
        error: (error as Error)?.message || "sync_failed",
      });
    }
  });

  router.post("/repos/refresh", async (req, res) => {
    try {
      const parsed = repoScriptSchema.parse(req.body || {});
      const result = await agentEcosystemService.refreshRepoManifest(parsed.timeoutMs);
      return res.status(result.ok ? 200 : 500).json({
        ok: result.ok,
        requester: getRequester(req),
        result,
      });
    } catch (error) {
      const handled = respondValidationError(res, error);
      if (handled) return handled;
      return res.status(500).json({
        ok: false,
        error: (error as Error)?.message || "refresh_failed",
      });
    }
  });

  router.post("/repos/exec", async (req, res) => {
    try {
      const parsed = repoExecSchema.parse(req.body || {});
      const result = await agentEcosystemService.execRepoCommand(parsed);
      return res.status(result.ok ? 200 : 500).json({
        ok: result.ok,
        requester: getRequester(req),
        result,
      });
    } catch (error) {
      const handled = respondValidationError(res, error);
      if (handled) return handled;
      return res.status(500).json({
        ok: false,
        error: (error as Error)?.message || "repo_exec_failed",
      });
    }
  });

  router.post("/repos/search", async (req, res) => {
    try {
      const parsed = repoSearchSchema.parse(req.body || {});
      const result = await agentEcosystemService.searchRepoCode(parsed);
      return res.status(result.ok ? 200 : 500).json({
        ok: result.ok,
        requester: getRequester(req),
        result,
      });
    } catch (error) {
      const handled = respondValidationError(res, error);
      if (handled) return handled;
      return res.status(500).json({
        ok: false,
        error: (error as Error)?.message || "repo_search_failed",
      });
    }
  });

  router.post("/repos/read", async (req, res) => {
    try {
      const parsed = repoReadSchema.parse(req.body || {});
      const result = await agentEcosystemService.readRepoFile(parsed);
      return res.status(200).json({
        ok: true,
        requester: getRequester(req),
        result,
      });
    } catch (error) {
      const handled = respondValidationError(res, error);
      if (handled) return handled;
      return res.status(500).json({
        ok: false,
        error: (error as Error)?.message || "repo_read_failed",
      });
    }
  });

  router.post("/repos/probe", async (req, res) => {
    try {
      const parsed = repoProbeSchema.parse(req.body || {});
      if (parsed.repo) {
        const result = await agentEcosystemService.probeRepoAdapter({
          repo: parsed.repo,
          timeoutMs: parsed.timeoutMs,
        });
        return res.status(result.ok ? 200 : 500).json({
          ok: result.ok,
          requester: getRequester(req),
          result,
        });
      }
      const result = await agentEcosystemService.probeAllRepoAdapters({
        timeoutMs: parsed.timeoutMs,
        maxRepos: parsed.maxRepos,
      });
      return res.status(result.ok ? 200 : 500).json({
        ok: result.ok,
        requester: getRequester(req),
        result,
      });
    } catch (error) {
      const handled = respondValidationError(res, error);
      if (handled) return handled;
      return res.status(500).json({
        ok: false,
        error: (error as Error)?.message || "repo_probe_failed",
      });
    }
  });

  router.post("/deep-audit", async (req, res) => {
    try {
      const parsed = deepAuditSchema.parse(req.body || {});
      const result = await agentEcosystemService.deepAuditFusion(parsed);
      return res.status(200).json({
        ok: true,
        requester: getRequester(req),
        result,
      });
    } catch (error) {
      const handled = respondValidationError(res, error);
      if (handled) return handled;
      return res.status(500).json({
        ok: false,
        error: (error as Error)?.message || "deep_audit_failed",
      });
    }
  });

  return router;
}
