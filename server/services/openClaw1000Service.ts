/**
 * OpenClaw 1000 Service
 * Runtime access + verification/reporting for the generated 1000-capability suite.
 */

import {
  OPENCLAW_1000,
  getOpenClaw1000CapabilityById,
  type OpenClaw1000Capability,
  type OpenClaw1000Category,
  type CapabilityStatus,
} from "../capabilities/generated/openClaw1000Capabilities.generated";
import {
  OPENCLAW_1000_EMAITI_MATRIX,
  getOpenClaw1000EmaitiEntry,
} from "../capabilities/generated/openClaw1000EmaitiMatrix.generated";
import {
  getOpenClaw1000RuntimeGaps,
  getOpenClaw1000RuntimeStats,
  toOpenClaw1000RuntimeCapabilities,
  toOpenClaw1000RuntimeCapability,
} from "./openClaw1000RuntimeStatus";

export type OpenClaw1000VerifyStatus = "PASS" | "FAIL" | "SKIP" | "STUB" | "ERROR";

export interface OpenClaw1000VerificationResult {
  id: number;
  capability: string;
  category: OpenClaw1000Category;
  toolName: string;
  implementationStatus: CapabilityStatus;
  verifyStatus: OpenClaw1000VerifyStatus;
  durationMs: number;
  checks: {
    total: number;
    passed: number;
    failed: number;
  };
  evidence: {
    output?: unknown;
    error?: string;
  };
  message: string;
}

export interface OpenClaw1000CategorySummary {
  category: OpenClaw1000Category;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  stubs: number;
  errors: number;
  results: OpenClaw1000VerificationResult[];
}

export interface OpenClaw1000Report {
  timestamp: string;
  version: string;
  durationMs: number;
  summary: {
    total: number;
    implemented: number;
    partial: number;
    stub: number;
    missing: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
    coveragePercent: number;
    emaitiChecksTotal: number;
    overallStatus: "PASS" | "PARTIAL" | "FAIL";
  };
  categories: OpenClaw1000CategorySummary[];
  gaps: OpenClaw1000Capability[];
  recommendations: string[];
}

export interface OpenClaw1000RoadmapItem {
  sequence: number;
  id: number;
  code: string;
  capability: string;
  category: OpenClaw1000Category;
  toolName: string;
  status: CapabilityStatus;
  track: "hardening" | "implementation" | "net_new";
  featureFlag: string;
}

export interface OpenClaw1000ExecutionRoadmap {
  startId: number;
  limit: number;
  totalBacklog: number;
  summary: {
    partial: number;
    stub: number;
    missing: number;
  };
  items: OpenClaw1000RoadmapItem[];
}

export function listOpenClaw1000Capabilities(options?: {
  category?: string;
  status?: string;
}): OpenClaw1000Capability[] {
  const { category, status } = options || {};

  let caps = toOpenClaw1000RuntimeCapabilities(OPENCLAW_1000);

  if (category) {
    caps = caps.filter((c) => c.category === (category as OpenClaw1000Category));
  }

  if (status) {
    caps = caps.filter((c) => c.status === (status as CapabilityStatus));
  }

  return caps;
}

export function getOpenClaw1000Capability(id: number): OpenClaw1000Capability | undefined {
  const capability = getOpenClaw1000CapabilityById(id);
  if (!capability) return undefined;
  return toOpenClaw1000RuntimeCapability(capability);
}

export function getOpenClaw1000QuickStats() {
  const stats = getOpenClaw1000RuntimeStats();
  const gaps = getOpenClaw1000RuntimeGaps();

  return {
    ...stats,
    coveragePercent: Math.round(((stats.implemented + stats.partial) / stats.total) * 1000) / 10,
    gapCount: gaps.length,
    emaitiEntries: OPENCLAW_1000_EMAITI_MATRIX.length,
    emaitiChecksTotal: OPENCLAW_1000_EMAITI_MATRIX.reduce((acc, e) => acc + e.checks.length, 0),
  };
}

export async function verifyOpenClaw1000Capability(id: number): Promise<OpenClaw1000VerificationResult> {
  const start = Date.now();
  const cap = getOpenClaw1000Capability(id);

  if (!cap) {
    return {
      id,
      capability: "Unknown",
      category: "academic_research",
      toolName: "unknown",
      implementationStatus: "missing",
      verifyStatus: "ERROR",
      durationMs: Date.now() - start,
      checks: { total: 0, passed: 0, failed: 0 },
      evidence: { error: `Capability ${id} not found` },
      message: `Capability ${id} does not exist`,
    };
  }

  const matrix = getOpenClaw1000EmaitiEntry(id);
  const totalChecks = matrix?.checks.length ?? 0;
  const passedChecks = matrix?.checks.filter((c) => c.required && c.implemented).length ?? 0;
  const failedChecks = totalChecks - passedChecks;

  let verifyStatus: OpenClaw1000VerifyStatus = "PASS";
  let message = `Capability ${id} verified`;

  if (cap.status === "stub") {
    verifyStatus = "STUB";
    message = `Capability ${id} is a stub`;
  } else if (cap.status === "missing") {
    verifyStatus = "SKIP";
    message = `Capability ${id} is missing`;
  } else if (failedChecks > 0) {
    verifyStatus = "FAIL";
    message = `Capability ${id} has ${failedChecks} failed EMAITI checks`;
  }

  return {
    id: cap.id,
    capability: cap.capability,
    category: cap.category,
    toolName: cap.toolName,
    implementationStatus: cap.status,
    verifyStatus,
    durationMs: Date.now() - start,
    checks: {
      total: totalChecks,
      passed: passedChecks,
      failed: failedChecks,
    },
    evidence: {
      output: {
        featureFlag: cap.featureFlag,
        permissionProfiles: cap.permissionProfiles,
        emAitiTraceKeys: matrix?.checks.map((c) => c.traceKey) ?? [],
      },
    },
    message,
  };
}

export async function verifyOpenClaw1000Batch(options?: {
  ids?: number[];
  category?: string;
  concurrency?: number;
}): Promise<OpenClaw1000VerificationResult[]> {
  const { ids, category, concurrency = 40 } = options || {};

  let caps: OpenClaw1000Capability[];
  if (ids && ids.length > 0) {
    caps = ids
      .map((id) => getOpenClaw1000Capability(id))
      .filter((c): c is OpenClaw1000Capability => Boolean(c));
  } else if (category) {
    caps = listOpenClaw1000Capabilities({ category });
  } else {
    caps = listOpenClaw1000Capabilities();
  }

  const out: OpenClaw1000VerificationResult[] = [];
  for (let i = 0; i < caps.length; i += concurrency) {
    const batch = caps.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((c) => verifyOpenClaw1000Capability(c.id)));
    out.push(...batchResults);
  }

  return out;
}

export async function generateOpenClaw1000Report(): Promise<OpenClaw1000Report> {
  const start = Date.now();
  const stats = getOpenClaw1000RuntimeStats();
  const gaps = getOpenClaw1000RuntimeGaps();

  const all = await verifyOpenClaw1000Batch();

  const grouped = new Map<OpenClaw1000Category, OpenClaw1000VerificationResult[]>();
  for (const r of all) {
    const arr = grouped.get(r.category) || [];
    arr.push(r);
    grouped.set(r.category, arr);
  }

  const categories: OpenClaw1000CategorySummary[] = [];
  for (const [category, results] of grouped.entries()) {
    categories.push({
      category,
      total: results.length,
      passed: results.filter((r) => r.verifyStatus === "PASS").length,
      failed: results.filter((r) => r.verifyStatus === "FAIL").length,
      skipped: results.filter((r) => r.verifyStatus === "SKIP").length,
      stubs: results.filter((r) => r.verifyStatus === "STUB").length,
      errors: results.filter((r) => r.verifyStatus === "ERROR").length,
      results,
    });
  }

  const passed = all.filter((r) => r.verifyStatus === "PASS").length;
  const failed = all.filter((r) => r.verifyStatus === "FAIL").length;
  const skipped = all.filter((r) => r.verifyStatus === "SKIP").length;
  const errors = all.filter((r) => r.verifyStatus === "ERROR").length;

  const emaitiChecksTotal = OPENCLAW_1000_EMAITI_MATRIX.reduce((acc, e) => acc + e.checks.length, 0);
  const coveragePercent = ((stats.implemented + stats.partial) / stats.total) * 100;

  const overallStatus: "PASS" | "PARTIAL" | "FAIL" =
    failed === 0 && errors === 0 && skipped === 0 ? "PASS" : (coveragePercent >= 70 ? "PARTIAL" : "FAIL");

  const recommendations: string[] = [];
  if (gaps.length > 0) {
    recommendations.push(`${gaps.length} capabilities still in stub/missing; prioritize closures by business impact.`);
  }

  const categoriesSorted = categories
    .slice()
    .sort((a, b) => (b.failed + b.errors + b.skipped + b.stubs) - (a.failed + a.errors + a.skipped + a.stubs));

  for (const cat of categoriesSorted.slice(0, 5)) {
    if (cat.failed + cat.errors + cat.skipped + cat.stubs > 0) {
      recommendations.push(`[${cat.category}] reduce non-pass results (${cat.failed + cat.errors + cat.skipped + cat.stubs}) via focused sprint.`);
    }
  }

  if (recommendations.length === 0) {
    recommendations.push("Maintain regression checks and keep feature flags in staged rollout mode.");
  }

  return {
    timestamp: new Date().toISOString(),
    version: "2.0.0-openclaw1000",
    durationMs: Date.now() - start,
    summary: {
      total: stats.total,
      implemented: stats.implemented,
      partial: stats.partial,
      stub: stats.stub,
      missing: stats.missing,
      passed,
      failed,
      skipped,
      errors,
      coveragePercent: Math.round(coveragePercent * 10) / 10,
      emaitiChecksTotal,
      overallStatus,
    },
    categories,
    gaps,
    recommendations,
  };
}

export function getOpenClaw1000ExecutionRoadmap(options?: {
  startId?: number;
  limit?: number;
}): OpenClaw1000ExecutionRoadmap {
  const startIdRaw = options?.startId ?? 1;
  const startId = Number.isFinite(startIdRaw) ? Math.max(1, Math.floor(startIdRaw)) : 1;
  const limitRaw = options?.limit ?? 50;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 50;

  const orderedBacklog = listOpenClaw1000Capabilities()
    .filter((capability) => capability.id >= startId && capability.status !== "implemented")
    .sort((a, b) => a.id - b.id);

  const summary = orderedBacklog.reduce(
    (acc, capability) => {
      if (capability.status === "partial") acc.partial += 1;
      else if (capability.status === "stub") acc.stub += 1;
      else acc.missing += 1;
      return acc;
    },
    { partial: 0, stub: 0, missing: 0 }
  );

  const items = orderedBacklog.slice(0, limit).map((capability, index) => ({
    sequence: index + 1,
    id: capability.id,
    code: capability.code,
    capability: capability.capability,
    category: capability.category,
    toolName: capability.toolName,
    status: capability.status,
    track:
      capability.status === "partial"
        ? "hardening"
        : capability.status === "stub"
          ? "implementation"
          : "net_new",
    featureFlag: capability.featureFlag,
  }));

  return {
    startId,
    limit,
    totalBacklog: orderedBacklog.length,
    summary,
    items,
  };
}
