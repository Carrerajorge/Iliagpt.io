import { Router, Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { responseCache } from "../agent/webtool/responseCache";
import { retrievalMetrics } from "../agent/webtool/retrievalMetrics";
import { isAuthenticated } from "../replit_integrations/auth/replitAuth";
import { authStorage } from "../replit_integrations/auth/storage";
import { storage } from "../storage";
import { createCustomRateLimiter } from "../middleware/userRateLimiter";
import {
  v2MetricsCollector,
  domainCircuitBreaker,
  type Percentiles,
  type ErrorTaxonomy,
  type ResourceSample,
} from "../agent/webtool/v2";

const MIN_WINDOW_MS = 60000;
const MAX_WINDOW_MS = 86400000;
const DEFAULT_WINDOW_MS = 3600000;

function redactDomain(domain: string): string {
  if (!domain) return "";
  const parts = domain.split(".");
  if (parts.length <= 2) {
    return createHash("sha256").update(domain).digest("hex").slice(0, 8);
  }
  const tld = parts.slice(-2).join(".");
  const subdomain = parts.slice(0, -2).join(".");
  const hashedSubdomain = createHash("sha256").update(subdomain).digest("hex").slice(0, 6);
  return `${hashedSubdomain}...${tld}`;
}

function validateWindowMs(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_WINDOW_MS;
  const parsed = parseInt(String(value), 10);
  if (isNaN(parsed) || parsed < 0) return DEFAULT_WINDOW_MS;
  return Math.max(MIN_WINDOW_MS, Math.min(MAX_WINDOW_MS, parsed));
}

interface ErrorTrackingEntry {
  domain: string;
  errorType: "blocked" | "rate_limited" | "timeout" | "fetch_error" | "browser_error";
  count: number;
  lastOccurred: number;
}

class RetrievalErrorTracker {
  private errors: Map<string, ErrorTrackingEntry> = new Map();
  private maxEntries = 500;

  recordError(domain: string, errorType: ErrorTrackingEntry["errorType"]): void {
    const key = `${domain}:${errorType}`;
    const existing = this.errors.get(key);

    if (existing) {
      existing.count++;
      existing.lastOccurred = Date.now();
    } else {
      if (this.errors.size >= this.maxEntries) {
        const oldestKey = this.findOldestEntry();
        if (oldestKey) this.errors.delete(oldestKey);
      }

      this.errors.set(key, {
        domain,
        errorType,
        count: 1,
        lastOccurred: Date.now(),
      });
    }
  }

  private findOldestEntry(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.errors.entries()) {
      if (entry.lastOccurred < oldestTime) {
        oldestTime = entry.lastOccurred;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  getSummary(windowMs: number = 3600000): {
    domainsBlocked: number;
    rateLimitErrors: number;
    timeoutErrors: number;
    fetchErrors: number;
    browserErrors: number;
    topErrorDomains: Array<{ domain: string; errorType: string; count: number }>;
  } {
    const cutoff = Date.now() - windowMs;
    let domainsBlocked = 0;
    let rateLimitErrors = 0;
    let timeoutErrors = 0;
    let fetchErrors = 0;
    let browserErrors = 0;
    const recentErrors: Array<{ domain: string; errorType: string; count: number }> = [];

    for (const entry of this.errors.values()) {
      if (entry.lastOccurred >= cutoff) {
        recentErrors.push({
          domain: entry.domain,
          errorType: entry.errorType,
          count: entry.count,
        });

        switch (entry.errorType) {
          case "blocked":
            domainsBlocked += entry.count;
            break;
          case "rate_limited":
            rateLimitErrors += entry.count;
            break;
          case "timeout":
            timeoutErrors += entry.count;
            break;
          case "fetch_error":
            fetchErrors += entry.count;
            break;
          case "browser_error":
            browserErrors += entry.count;
            break;
        }
      }
    }

    const topErrorDomains = recentErrors
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      domainsBlocked,
      rateLimitErrors,
      timeoutErrors,
      fetchErrors,
      browserErrors,
      topErrorDomains,
    };
  }

  clear(): void {
    this.errors.clear();
  }
}

export const retrievalErrorTracker = new RetrievalErrorTracker();

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const userReq = req as any;
    if (!userReq.user?.claims?.sub) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const user = await authStorage.getUser(userReq.user.claims.sub);
    if (!user || user.role !== "admin") {
      await storage.createAuditLog({
        action: "admin_access_denied",
        resource: "retrieval_admin",
        details: { userId: userReq.user.claims.sub, path: req.path }
      });
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  } catch (error) {
    return res.status(500).json({ error: "Authorization check failed" });
  }
}

export function createRetrievalAdminRouter(): Router {
  const router = Router();

  const v2StatusRateLimiter = createCustomRateLimiter({
    windowMs: 60000,
    maxRequests: 10,
    keyPrefix: "retrieval-v2-status",
    message: "Rate limit exceeded for retrieval status endpoint. Max 10 requests/minute.",
  });

  function hashDomain(domain: string): string {
    if (!domain) return "";
    return createHash("sha256").update(domain.toLowerCase()).digest("hex").slice(0, 12);
  }

  router.get(
    "/retrieval-v2-status",
    isAuthenticated,
    requireAdmin,
    v2StatusRateLimiter,
    async (req: Request, res: Response) => {
      try {
        const windowMs = validateWindowMs(req.query.window);

        const phasePercentiles = v2MetricsCollector.getAllPhasePercentiles(windowMs);
        const browserRatio = v2MetricsCollector.getBrowserRatio(windowMs);
        const cacheHitRate = v2MetricsCollector.getCacheHitRate(windowMs);
        const errorTaxonomy = v2MetricsCollector.getErrorTaxonomy();
        const resourceReport = v2MetricsCollector.getResourceReport(windowMs);
        const successRate = v2MetricsCollector.getSuccessRate(windowMs);
        const totalSamples = v2MetricsCollector.getSampleCount();

        const allPhasesCounts = Object.values(phasePercentiles).reduce(
          (sum, p) => sum + p.count,
          0
        );
        const avgLatencyMs =
          allPhasesCounts > 0
            ? Object.values(phasePercentiles).reduce(
              (sum, p) => sum + p.avg * p.count,
              0
            ) / allPhasesCounts
            : 0;

        const openCircuits = domainCircuitBreaker.getAllOpenCircuits();
        const circuitBreakerStatus = openCircuits.map((c) => ({
          domainHash: hashDomain(c.domain),
          state: c.status.state,
          failures: c.status.failures,
          lastErrorType: c.status.lastErrorType,
          openedAt: c.status.openedAt,
        }));

        const slaReport = retrievalMetrics.getSLAReport(windowMs);

        const resourceGauges: {
          heapUsedMb: number;
          heapTotalMb: number;
          rssMb: number;
          fdCount: number;
          contextCount: number;
        } = {
          heapUsedMb: resourceReport.current.heapUsedMb,
          heapTotalMb: resourceReport.current.heapTotalMb,
          rssMb: resourceReport.current.rssMb,
          fdCount: resourceReport.current.fdCount,
          contextCount: openCircuits.length,
        };

        const response = {
          timestamp: new Date().toISOString(),
          windowMs,
          overall: {
            totalRequests: totalSamples,
            successRate,
            avgLatencyMs,
          },
          phasePercentiles: phasePercentiles as Record<
            string,
            {
              p50: number;
              p95: number;
              p99: number;
              avg: number;
              count: number;
            }
          >,
          browserRatio,
          cacheHitRate,
          errorTaxonomy: errorTaxonomy as Record<string, number>,
          resourceGauges,
          circuitBreaker: {
            openCount: circuitBreakerStatus.filter((c) => c.state === "open").length,
            halfOpenCount: circuitBreakerStatus.filter((c) => c.state === "half-open").length,
            domains: circuitBreakerStatus,
          },
          slaCompliance: {
            fetchP95Ms: slaReport.fetchP95Ms,
            browserP95Ms: slaReport.browserP95Ms,
            overallP95Ms: slaReport.overallP95Ms,
            cacheHitRate: slaReport.cacheHitRate,
            avgRelevanceScore: slaReport.avgRelevanceScore,
            avgSourcesCount: slaReport.avgSourcesCount,
            successRate: slaReport.successRate,
            totalRequests: slaReport.totalRequests,
            compliance: slaReport.slaCompliance,
          },
          resourceReport: {
            growthRates: resourceReport.growthRates,
            limits: resourceReport.limits,
            warnings: resourceReport.warnings,
            leakDetected: resourceReport.leakDetected,
          },
        };

        res.json(response);
      } catch (error) {
        console.error("[RetrievalAdmin] Error fetching V2 retrieval status:", {
          errorType: error instanceof Error ? error.constructor.name : "Unknown",
          message: error instanceof Error ? error.message : "Unknown error",
        });
        res.status(500).json({
          error: "Failed to fetch V2 retrieval status",
        });
      }
    }
  );

  router.get("/retrieval-status", isAuthenticated, requireAdmin, async (req: Request, res: Response) => {
    try {
      const windowMs = validateWindowMs(req.query.window);

      const cacheStats = responseCache.getStats();
      const slaReport = retrievalMetrics.getSLAReport(windowMs);
      const methodBreakdown = retrievalMetrics.getMethodBreakdown();
      const rawErrorSummary = retrievalErrorTracker.getSummary(windowMs);
      const latencyHistogram = retrievalMetrics.getLatencyHistogram();

      const errorSummary = {
        ...rawErrorSummary,
        topErrorDomains: rawErrorSummary.topErrorDomains.map(e => ({
          domain: redactDomain(e.domain),
          errorType: e.errorType,
          count: e.count,
        })),
      };

      const response = {
        timestamp: new Date().toISOString(),
        windowMs,
        cache: {
          entries: cacheStats.entries,
          hits: cacheStats.hits,
          misses: cacheStats.misses,
          hitRate: cacheStats.hitRate,
          memoryUsageMb: cacheStats.memoryUsageMb,
          oldestEntryAgeMs: cacheStats.oldestEntryAge,
        },
        sla: {
          fetchP95Ms: slaReport.fetchP95Ms,
          browserP95Ms: slaReport.browserP95Ms,
          overallP95Ms: slaReport.overallP95Ms,
          cacheHitRate: slaReport.cacheHitRate,
          avgRelevanceScore: slaReport.avgRelevanceScore,
          avgSourcesCount: slaReport.avgSourcesCount,
          successRate: slaReport.successRate,
          totalRequests: slaReport.totalRequests,
          compliance: slaReport.slaCompliance,
        },
        methodBreakdown,
        errors: errorSummary,
        latencyHistogram,
        health: {
          status: slaReport.slaCompliance.overall ? "healthy" : "degraded",
          issues: getHealthIssues(slaReport, cacheStats),
        },
      };

      res.json(response);
    } catch (error) {
      console.error("[RetrievalAdmin] Error fetching retrieval status:", {
        errorType: error instanceof Error ? error.constructor.name : "Unknown",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      res.status(500).json({
        error: "Failed to fetch retrieval status",
      });
    }
  });

  return router;
}

function getHealthIssues(slaReport: any, cacheStats: any): string[] {
  const issues: string[] = [];

  if (!slaReport.slaCompliance.fetchP95) {
    issues.push(`Fetch P95 latency (${slaReport.fetchP95Ms}ms) exceeds SLA threshold`);
  }
  if (!slaReport.slaCompliance.browserP95) {
    issues.push(`Browser P95 latency (${slaReport.browserP95Ms}ms) exceeds SLA threshold`);
  }
  if (!slaReport.slaCompliance.cacheHitRate) {
    issues.push(`Cache hit rate (${(slaReport.cacheHitRate * 100).toFixed(1)}%) below minimum`);
  }
  if (!slaReport.slaCompliance.relevanceScore) {
    issues.push(`Average relevance score (${slaReport.avgRelevanceScore.toFixed(2)}) below minimum`);
  }
  if (!slaReport.slaCompliance.sourcesCount) {
    issues.push(`Average sources count (${slaReport.avgSourcesCount.toFixed(1)}) below minimum`);
  }
  if (cacheStats.memoryUsageMb > 40) {
    issues.push(`Cache memory usage (${cacheStats.memoryUsageMb.toFixed(1)}MB) approaching limit`);
  }

  return issues;
}
