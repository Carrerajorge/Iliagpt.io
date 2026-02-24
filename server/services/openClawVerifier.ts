/**
 * OpenClaw 500 Verification Engine
 * Verifies capabilities against the OpenClaw 500 spec.
 * Provides single, batch, and full report verification.
 */

import {
  OPENCLAW_500,
  getOpenClawStats,
  getCapabilityById,
  getCapabilitiesByCategory,
  getGaps,
  type OpenClawCapability,
  type OpenClawCategory,
  type CapabilityStatus,
} from "../data/openClaw500Mapping";

export type VerifyStatus = "PASS" | "FAIL" | "SKIP" | "STUB" | "ERROR";

export interface VerificationResult {
  id: number;
  capability: string;
  category: OpenClawCategory;
  toolName: string;
  implementationStatus: CapabilityStatus;
  verifyStatus: VerifyStatus;
  durationMs: number;
  evidence: {
    input?: any;
    output?: any;
    error?: string;
  };
  message: string;
}

export interface CategoryVerificationSummary {
  category: OpenClawCategory;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  stubs: number;
  errors: number;
  results: VerificationResult[];
}

export interface OpenClawReport {
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
    overallStatus: "PASS" | "PARTIAL" | "FAIL";
  };
  categories: CategoryVerificationSummary[];
  gaps: OpenClawCapability[];
  recommendations: string[];
}

/**
 * Verify a single capability by ID.
 * For implemented/partial: returns PASS (capability exists and tool is mapped).
 * For stub/missing: returns STUB/SKIP.
 */
export async function verifyCapability(id: number): Promise<VerificationResult> {
  const start = Date.now();
  const cap = getCapabilityById(id);

  if (!cap) {
    return {
      id,
      capability: "Unknown",
      category: "academic_research",
      toolName: "unknown",
      implementationStatus: "missing",
      verifyStatus: "ERROR",
      durationMs: Date.now() - start,
      evidence: { error: `Capability ID ${id} not found in OpenClaw 500 mapping` },
      message: `Capability ${id} does not exist`,
    };
  }

  // Determine verify status based on implementation status
  let verifyStatus: VerifyStatus;
  let message: string;

  switch (cap.status) {
    case "implemented":
      verifyStatus = "PASS";
      message = `Fully implemented: ${cap.capability}`;
      break;
    case "partial":
      verifyStatus = "PASS";
      message = `Partially implemented: ${cap.capability} — some features may be limited`;
      break;
    case "stub":
      verifyStatus = "STUB";
      message = `Stub only: ${cap.capability} — needs implementation`;
      break;
    case "missing":
      verifyStatus = "SKIP";
      message = `Not implemented: ${cap.capability}`;
      break;
    default:
      verifyStatus = "ERROR";
      message = `Unknown status for ${cap.capability}`;
  }

  return {
    id: cap.id,
    capability: cap.capability,
    category: cap.category,
    toolName: cap.toolName,
    implementationStatus: cap.status,
    verifyStatus,
    durationMs: Date.now() - start,
    evidence: {
      output: {
        toolName: cap.toolName,
        permissionProfiles: cap.permissionProfiles,
        status: cap.status,
      },
    },
    message,
  };
}

/**
 * Verify a batch of capabilities by IDs or by category.
 * Runs with concurrency limit to avoid overwhelming the system.
 */
export async function verifyBatch(
  options: { ids?: number[]; category?: OpenClawCategory; concurrency?: number }
): Promise<VerificationResult[]> {
  const { ids, category, concurrency = 20 } = options;

  let capsToVerify: OpenClawCapability[];

  if (ids && ids.length > 0) {
    capsToVerify = ids
      .map((id) => getCapabilityById(id))
      .filter((c): c is OpenClawCapability => c !== undefined);
  } else if (category) {
    capsToVerify = getCapabilitiesByCategory(category);
  } else {
    capsToVerify = OPENCLAW_500;
  }

  const results: VerificationResult[] = [];

  // Process in batches for concurrency control
  for (let i = 0; i < capsToVerify.length; i += concurrency) {
    const batch = capsToVerify.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((cap) => verifyCapability(cap.id))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Generate a full 500-capability report with pass/fail/skip/stub counts.
 */
export async function generateReport(): Promise<OpenClawReport> {
  const start = Date.now();
  const stats = getOpenClawStats();

  // Verify all capabilities
  const allResults = await verifyBatch({});

  // Group by category
  const categoryMap = new Map<OpenClawCategory, VerificationResult[]>();
  for (const result of allResults) {
    const existing = categoryMap.get(result.category) || [];
    existing.push(result);
    categoryMap.set(result.category, existing);
  }

  const categories: CategoryVerificationSummary[] = [];
  for (const [category, results] of categoryMap.entries()) {
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

  const totalPassed = allResults.filter((r) => r.verifyStatus === "PASS").length;
  const totalFailed = allResults.filter((r) => r.verifyStatus === "FAIL").length;
  const totalSkipped = allResults.filter((r) => r.verifyStatus === "SKIP").length;
  const totalErrors = allResults.filter((r) => r.verifyStatus === "ERROR").length;

  const coveragePercent = ((stats.implemented + stats.partial) / stats.total) * 100;

  const overallStatus: "PASS" | "PARTIAL" | "FAIL" =
    coveragePercent >= 90 ? "PASS" : coveragePercent >= 50 ? "PARTIAL" : "FAIL";

  // Generate recommendations
  const recommendations: string[] = [];
  const gaps = getGaps();

  const stubsByCategory = new Map<string, number>();
  for (const gap of gaps) {
    const count = stubsByCategory.get(gap.category) || 0;
    stubsByCategory.set(gap.category, count + 1);
  }

  for (const [cat, count] of stubsByCategory.entries()) {
    if (count > 5) {
      recommendations.push(
        `[${cat}] ${count} capabilities need implementation — prioritize high-impact items`
      );
    }
  }

  if (stats.stub > 30) {
    recommendations.push(
      `${stats.stub} capabilities are stubs — consider batch implementation sprints`
    );
  }

  if (stats.missing > 0) {
    recommendations.push(
      `${stats.missing} capabilities have no mapping — review and add tool mappings`
    );
  }

  return {
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    durationMs: Date.now() - start,
    summary: {
      total: stats.total,
      implemented: stats.implemented,
      partial: stats.partial,
      stub: stats.stub,
      missing: stats.missing,
      passed: totalPassed,
      failed: totalFailed,
      skipped: totalSkipped,
      errors: totalErrors,
      coveragePercent: Math.round(coveragePercent * 10) / 10,
      overallStatus,
    },
    categories,
    gaps,
    recommendations,
  };
}

/**
 * Get quick stats without running full verification.
 */
export function getQuickStats() {
  const stats = getOpenClawStats();
  const gaps = getGaps();

  return {
    ...stats,
    coveragePercent: Math.round(((stats.implemented + stats.partial) / stats.total) * 1000) / 10,
    gapCount: gaps.length,
    gapsByCategory: gaps.reduce((acc, g) => {
      acc[g.category] = (acc[g.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };
}
