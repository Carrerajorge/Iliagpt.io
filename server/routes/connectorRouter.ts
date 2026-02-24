import { Router, Request, Response } from "express";

/**
 * ConnectorRouter — REST API for connector management.
 *
 * Provides endpoints for listing connectors, checking status,
 * inspecting capabilities, health checks, policy management,
 * and usage statistics.
 */

function getUserId(req: Request): string | null {
  return (req as any).user?.id || (req as any).userId || null;
}

export function createConnectorRouter(): Router {
  const router = Router();

  /* ------------------------------------------------------------------ */
  /*  GET /  — List all connectors with connection status               */
  /* ------------------------------------------------------------------ */
  router.get("/", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { connectorRegistry } = await import(
        "../integrations/kernel/connectorRegistry"
      );
      const { credentialVault } = await import(
        "../integrations/kernel/credentialVault"
      );

      const enabled = connectorRegistry.listEnabled();
      const connectors = await Promise.all(
        enabled.map(async (entry: any) => {
          let connected = false;
          try {
            const cred = await credentialVault.get(userId, entry.connectorId);
            connected = !!cred && !cred.revoked;
          } catch {
            connected = false;
          }

          const capCount =
            entry.handler?.capabilities?.length ??
            entry.capabilities?.length ??
            0;

          return {
            connectorId: entry.connectorId,
            displayName: entry.displayName ?? entry.connectorId,
            category: entry.category ?? "general",
            authType: entry.authType ?? "oauth2",
            connected,
            capabilities: capCount,
          };
        })
      );

      return res.json({ connectors });
    } catch (err: any) {
      console.error("[connectorRouter] GET / error:", err?.message);
      return res.status(500).json({ error: "Failed to list connectors" });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  GET /:id/status — Single connector status + token info            */
  /* ------------------------------------------------------------------ */
  router.get("/:id/status", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const connectorId = req.params.id;
      const { credentialVault } = await import(
        "../integrations/kernel/credentialVault"
      );

      let connected = false;
      let scopes: string[] = [];
      let expiresAt: string | null = null;

      try {
        const cred = await credentialVault.get(userId, connectorId);
        if (cred && !cred.revoked) {
          connected = true;
          scopes = cred.scopes ?? [];
          expiresAt = cred.expiresAt ?? null;
        }
      } catch {
        // credential not found — not connected
      }

      return res.json({ connected, connectorId, scopes, expiresAt });
    } catch (err: any) {
      console.error("[connectorRouter] GET /:id/status error:", err?.message);
      return res.status(500).json({ error: "Failed to get connector status" });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  GET /:id/capabilities — Capability list with metadata             */
  /* ------------------------------------------------------------------ */
  router.get("/:id/capabilities", async (req: Request, res: Response) => {
    try {
      const connectorId = req.params.id;
      const { connectorRegistry } = await import(
        "../integrations/kernel/connectorRegistry"
      );

      const entry = connectorRegistry.get(connectorId);
      if (!entry) {
        return res.status(404).json({ error: "Connector not found" });
      }

      const capabilities = (
        entry.handler?.capabilities ??
        entry.capabilities ??
        []
      ).map((cap: any) => ({
        name: cap.name ?? cap.id ?? "unknown",
        description: cap.description ?? "",
        confirmationRequired: cap.confirmationRequired ?? false,
        category: cap.category ?? "general",
      }));

      return res.json({ connectorId, capabilities });
    } catch (err: any) {
      console.error(
        "[connectorRouter] GET /:id/capabilities error:",
        err?.message
      );
      return res
        .status(500)
        .json({ error: "Failed to get connector capabilities" });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  GET /:id/health — Run handler healthCheck if available            */
  /* ------------------------------------------------------------------ */
  router.get("/:id/health", async (req: Request, res: Response) => {
    try {
      const connectorId = req.params.id;
      const { connectorRegistry } = await import(
        "../integrations/kernel/connectorRegistry"
      );

      const entry = connectorRegistry.get(connectorId);
      if (!entry) {
        return res.status(404).json({ error: "Connector not found" });
      }

      const handler = entry.handler;
      if (!handler || typeof handler.healthCheck !== "function") {
        return res.json({
          healthy: true,
          latencyMs: 0,
          note: "No healthCheck implemented — assumed healthy",
        });
      }

      const start = performance.now();
      const healthy = await handler.healthCheck();
      const latencyMs = Math.round(performance.now() - start);

      return res.json({ healthy, latencyMs });
    } catch (err: any) {
      console.error("[connectorRouter] GET /:id/health error:", err?.message);
      return res.json({ healthy: false, latencyMs: -1, error: err?.message });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  PATCH /policy — Update user's enabled/disabled tools              */
  /* ------------------------------------------------------------------ */
  router.patch("/policy", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { enabledTools, disabledTools } = req.body ?? {};

      if (!enabledTools && !disabledTools) {
        return res
          .status(400)
          .json({ error: "Provide enabledTools or disabledTools" });
      }

      // Validate arrays
      if (enabledTools && !Array.isArray(enabledTools)) {
        return res
          .status(400)
          .json({ error: "enabledTools must be an array of strings" });
      }
      if (disabledTools && !Array.isArray(disabledTools)) {
        return res
          .status(400)
          .json({ error: "disabledTools must be an array of strings" });
      }

      const { db } = await import("../db");
      const { integrationPolicies } = await import(
        "../db/schema/integrationPolicies"
      );
      const { eq } = await import("drizzle-orm");

      // Check if a row already exists for this user
      const existing = await db
        .select()
        .from(integrationPolicies)
        .where(eq(integrationPolicies.userId, userId))
        .limit(1);

      const policyData: Record<string, any> = {
        userId,
        updatedAt: new Date(),
      };

      if (enabledTools) policyData.enabledTools = enabledTools;
      if (disabledTools) policyData.disabledTools = disabledTools;

      if (existing.length > 0) {
        await db
          .update(integrationPolicies)
          .set(policyData)
          .where(eq(integrationPolicies.userId, userId));
      } else {
        policyData.createdAt = new Date();
        await db.insert(integrationPolicies).values(policyData);
      }

      return res.json({ ok: true, enabledTools, disabledTools });
    } catch (err: any) {
      console.error("[connectorRouter] PATCH /policy error:", err?.message);
      return res.status(500).json({ error: "Failed to update policy" });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  GET /usage/stats — Hourly usage breakdown for last 24h            */
  /* ------------------------------------------------------------------ */
  router.get("/usage/stats", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { db } = await import("../db");
      const { connectorUsageHourly } = await import(
        "../db/schema/connectorUsageHourly"
      );
      const { eq, gte, and } = await import("drizzle-orm");

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const rows = await db
        .select()
        .from(connectorUsageHourly)
        .where(
          and(
            eq(connectorUsageHourly.userId, userId),
            gte(connectorUsageHourly.hourBucket, since)
          )
        )
        .orderBy(connectorUsageHourly.hourBucket);

      const stats = rows.map((r: any) => ({
        connectorId: r.connectorId,
        hour: r.hourBucket,
        invocations: r.invocations ?? 0,
        errors: r.errors ?? 0,
        avgLatencyMs: r.avgLatencyMs ?? 0,
      }));

      return res.json({ stats, periodHours: 24 });
    } catch (err: any) {
      console.error("[connectorRouter] GET /usage/stats error:", err?.message);
      return res.status(500).json({ error: "Failed to fetch usage stats" });
    }
  });

  return router;
}
