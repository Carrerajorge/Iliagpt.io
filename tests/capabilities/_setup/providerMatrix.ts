/**
 * Provider Matrix - Multi-provider test harness
 * Runs each capability test against multiple LLM providers.
 * Skips providers with missing API keys, falls back to mock mode for CI.
 */

import { it, describe } from "vitest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LLMProvider =
  | "anthropic"
  | "openai"
  | "gemini"
  | "grok"
  | "mistral";

export interface ProviderConfig {
  name: LLMProvider;
  envKey: string;
  modelId: string;
  available: boolean;
  isMock: boolean;
}

export interface TestResult {
  provider: LLMProvider | "mock";
  testName: string;
  capability: string;
  status: "pass" | "fail" | "skip";
  error?: string;
  duration: number;
  timestamp: number;
}

export interface MatrixSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  byProvider: Record<string, { pass: number; fail: number; skip: number }>;
  byCapability: Record<string, { pass: number; fail: number; skip: number }>;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Provider configurations
// ---------------------------------------------------------------------------

const PROVIDER_CONFIGS_RAW: Omit<ProviderConfig, "available" | "isMock">[] = [
  {
    name: "anthropic",
    envKey: "ANTHROPIC_API_KEY",
    modelId: "claude-3-5-sonnet-20241022",
  },
  {
    name: "openai",
    envKey: "OPENAI_API_KEY",
    modelId: "gpt-4o",
  },
  {
    name: "gemini",
    envKey: "GEMINI_API_KEY",
    modelId: "gemini-1.5-pro",
  },
  {
    name: "grok",
    envKey: "XAI_API_KEY",
    modelId: "grok-2",
  },
  {
    name: "mistral",
    envKey: "MISTRAL_API_KEY",
    modelId: "mistral-large-latest",
  },
];

export const MOCK_PROVIDER: ProviderConfig = {
  name: "anthropic",
  envKey: "",
  modelId: "mock-model",
  available: true,
  isMock: true,
};

// ---------------------------------------------------------------------------
// Provider availability helpers
// ---------------------------------------------------------------------------

/**
 * Returns the list of providers that have API keys set in process.env.
 * The `available` flag is set accordingly; `isMock` is always false for real providers.
 */
export function getAvailableProviders(): ProviderConfig[] {
  return PROVIDER_CONFIGS_RAW.map((raw) => {
    // Gemini also accepts GOOGLE_AI_STUDIO_KEY as a fallback
    let key = process.env[raw.envKey];
    if (!key && raw.name === "gemini") {
      key = process.env["GOOGLE_AI_STUDIO_KEY"];
    }
    return {
      ...raw,
      available: Boolean(key && key.trim().length > 0),
      isMock: false,
    };
  });
}

/**
 * Returns only the providers that are currently available (have API keys).
 */
export function getEnabledProviders(): ProviderConfig[] {
  return getAvailableProviders().filter((p) => p.available);
}

/**
 * Returns true if any real provider is available.
 */
export function hasAnyRealProvider(): boolean {
  return getEnabledProviders().length > 0;
}

/**
 * Returns the API key for a given provider config, or undefined if not set.
 */
export function getProviderApiKey(provider: ProviderConfig): string | undefined {
  if (provider.isMock) return "mock-key";
  const key = process.env[provider.envKey];
  if (!key && provider.name === "gemini") {
    return process.env["GOOGLE_AI_STUDIO_KEY"];
  }
  return key;
}

// ---------------------------------------------------------------------------
// runWithEachProvider
// ---------------------------------------------------------------------------

/**
 * Registers a Vitest `it()` case for each available provider.
 * If no providers have API keys, falls back to a single mock test.
 *
 * @param testName   Human-readable test name (provider name will be appended)
 * @param capability Capability being tested (e.g. "excel", "browser")
 * @param fn         Async test body that receives the provider config
 */
export function runWithEachProvider(
  testName: string,
  capability: string,
  fn: (provider: ProviderConfig) => Promise<void>,
): void {
  const enabled = getEnabledProviders();

  if (enabled.length === 0) {
    // CI fallback: run once with mock provider
    it(`${testName} [mock]`, async () => {
      const start = Date.now();
      try {
        await fn(MOCK_PROVIDER);
        globalMatrix.record({
          provider: "mock",
          testName,
          capability,
          status: "pass",
          duration: Date.now() - start,
          timestamp: Date.now(),
        });
      } catch (err) {
        globalMatrix.record({
          provider: "mock",
          testName,
          capability,
          status: "fail",
          error: err instanceof Error ? err.message : String(err),
          duration: Date.now() - start,
          timestamp: Date.now(),
        });
        throw err;
      }
    });
    return;
  }

  for (const provider of enabled) {
    it(`${testName} [${provider.name}]`, async () => {
      const start = Date.now();
      try {
        await fn(provider);
        globalMatrix.record({
          provider: provider.name,
          testName,
          capability,
          status: "pass",
          duration: Date.now() - start,
          timestamp: Date.now(),
        });
      } catch (err) {
        globalMatrix.record({
          provider: provider.name,
          testName,
          capability,
          status: "fail",
          error: err instanceof Error ? err.message : String(err),
          duration: Date.now() - start,
          timestamp: Date.now(),
        });
        throw err;
      }
    });
  }

  // Register skip entries for unavailable providers so the matrix is complete
  const unavailable = getAvailableProviders().filter((p) => !p.available);
  for (const provider of unavailable) {
    it.skip(`${testName} [${provider.name}] (no API key)`, async () => {
      globalMatrix.record({
        provider: provider.name,
        testName,
        capability,
        status: "skip",
        duration: 0,
        timestamp: Date.now(),
      });
    });
  }
}

// ---------------------------------------------------------------------------
// CapabilityMatrix
// ---------------------------------------------------------------------------

export class CapabilityMatrix {
  private results: TestResult[] = [];
  private startTime = Date.now();

  /**
   * Record a test result.
   */
  record(result: TestResult): void {
    this.results.push(result);
  }

  /**
   * Return all recorded results.
   */
  getResults(): TestResult[] {
    return [...this.results];
  }

  /**
   * Clear all results (useful between test runs in the same process).
   */
  clear(): void {
    this.results = [];
    this.startTime = Date.now();
  }

  /**
   * Aggregate summary of all recorded results.
   */
  getSummary(): MatrixSummary {
    const byProvider: MatrixSummary["byProvider"] = {};
    const byCapability: MatrixSummary["byCapability"] = {};

    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const r of this.results) {
      const pKey = r.provider;
      const cKey = r.capability;

      // provider bucket
      if (!byProvider[pKey]) byProvider[pKey] = { pass: 0, fail: 0, skip: 0 };
      // capability bucket
      if (!byCapability[cKey])
        byCapability[cKey] = { pass: 0, fail: 0, skip: 0 };

      if (r.status === "pass") {
        passed++;
        byProvider[pKey].pass++;
        byCapability[cKey].pass++;
      } else if (r.status === "fail") {
        failed++;
        byProvider[pKey].fail++;
        byCapability[cKey].fail++;
      } else {
        skipped++;
        byProvider[pKey].skip++;
        byCapability[cKey].skip++;
      }
    }

    return {
      total: this.results.length,
      passed,
      failed,
      skipped,
      byProvider,
      byCapability,
      durationMs: Date.now() - this.startTime,
    };
  }

  /**
   * Serialize to JSON (safe for file output).
   */
  toJSON(): string {
    return JSON.stringify(
      {
        summary: this.getSummary(),
        results: this.results,
      },
      null,
      2,
    );
  }

  /**
   * Generate a simple HTML report suitable for CI artifact upload.
   */
  toHTML(): string {
    const summary = this.getSummary();
    const rows = this.results
      .map(
        (r) => `
      <tr class="${r.status}">
        <td>${r.capability}</td>
        <td>${r.provider}</td>
        <td>${r.testName}</td>
        <td>${r.status.toUpperCase()}</td>
        <td>${r.duration}ms</td>
        <td>${r.error ? escapeHtml(r.error) : ""}</td>
      </tr>`,
      )
      .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Capability Matrix Report</title>
  <style>
    body { font-family: sans-serif; padding: 24px; }
    h1 { font-size: 1.4rem; }
    .summary { display: flex; gap: 24px; margin-bottom: 24px; }
    .stat { padding: 12px 20px; border-radius: 8px; font-weight: bold; }
    .stat.pass { background: #d1fae5; color: #065f46; }
    .stat.fail { background: #fee2e2; color: #991b1b; }
    .stat.skip { background: #fef9c3; color: #92400e; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
    th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
    th { background: #f9fafb; }
    tr.pass td { background: #f0fdf4; }
    tr.fail td { background: #fef2f2; }
    tr.skip td { background: #fefce8; }
  </style>
</head>
<body>
  <h1>Capability Matrix Report</h1>
  <div class="summary">
    <div class="stat pass">Passed: ${summary.passed}</div>
    <div class="stat fail">Failed: ${summary.failed}</div>
    <div class="stat skip">Skipped: ${summary.skipped}</div>
    <div class="stat">Total: ${summary.total}</div>
    <div class="stat">Duration: ${summary.durationMs}ms</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Capability</th>
        <th>Provider</th>
        <th>Test</th>
        <th>Status</th>
        <th>Duration</th>
        <th>Error</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// MatrixReporter
// ---------------------------------------------------------------------------

export class MatrixReporter {
  constructor(private matrix: CapabilityMatrix) {}

  printSummary(): void {
    const summary = this.matrix.getSummary();
    const hr = "─".repeat(60);

    console.log("\n" + hr);
    console.log("  CAPABILITY MATRIX SUMMARY");
    console.log(hr);
    console.log(
      `  Total: ${summary.total}  |  Passed: ${summary.passed}  |  Failed: ${summary.failed}  |  Skipped: ${summary.skipped}`,
    );
    console.log(`  Duration: ${summary.durationMs}ms`);

    if (Object.keys(summary.byProvider).length > 0) {
      console.log("\n  By Provider:");
      for (const [provider, counts] of Object.entries(summary.byProvider)) {
        console.log(
          `    ${provider.padEnd(12)} pass=${counts.pass}  fail=${counts.fail}  skip=${counts.skip}`,
        );
      }
    }

    if (Object.keys(summary.byCapability).length > 0) {
      console.log("\n  By Capability:");
      for (const [cap, counts] of Object.entries(summary.byCapability)) {
        console.log(
          `    ${cap.padEnd(20)} pass=${counts.pass}  fail=${counts.fail}  skip=${counts.skip}`,
        );
      }
    }

    const failures = this.matrix
      .getResults()
      .filter((r) => r.status === "fail");
    if (failures.length > 0) {
      console.log("\n  Failures:");
      for (const f of failures) {
        console.log(`    [${f.provider}] ${f.testName}: ${f.error ?? "unknown error"}`);
      }
    }

    console.log(hr + "\n");
  }
}

// ---------------------------------------------------------------------------
// Global instances
// ---------------------------------------------------------------------------

export const globalMatrix = new CapabilityMatrix();
export const globalReporter = new MatrixReporter(globalMatrix);

// ---------------------------------------------------------------------------
// assertProviderResponse
// ---------------------------------------------------------------------------

/**
 * Validates that `response` has the expected top-level shape for the given
 * provider format. Throws an assertion error if validation fails.
 */
export function assertProviderResponse(
  response: unknown,
  provider: ProviderConfig,
): void {
  if (response === null || response === undefined) {
    throw new Error(
      `[${provider.name}] Response is ${response}; expected a non-null object`,
    );
  }

  if (typeof response !== "object") {
    throw new Error(
      `[${provider.name}] Response is ${typeof response}; expected object`,
    );
  }

  const r = response as Record<string, unknown>;

  if (provider.isMock) {
    // Mock responses just need to be objects
    return;
  }

  switch (provider.name) {
    case "anthropic": {
      if (!("role" in r) || r["role"] !== "assistant") {
        throw new Error(
          `[anthropic] Expected response.role === "assistant", got ${JSON.stringify(r["role"])}`,
        );
      }
      if (!Array.isArray(r["content"])) {
        throw new Error(`[anthropic] Expected response.content to be an array`);
      }
      break;
    }

    case "openai":
    case "grok":
    case "mistral": {
      if (!Array.isArray(r["choices"])) {
        throw new Error(
          `[${provider.name}] Expected response.choices to be an array`,
        );
      }
      const choices = r["choices"] as unknown[];
      if (choices.length === 0) {
        throw new Error(`[${provider.name}] response.choices is empty`);
      }
      const first = choices[0] as Record<string, unknown>;
      if (!first["message"] || typeof first["message"] !== "object") {
        throw new Error(
          `[${provider.name}] Expected choices[0].message to be an object`,
        );
      }
      break;
    }

    case "gemini": {
      if (!Array.isArray(r["candidates"])) {
        throw new Error(`[gemini] Expected response.candidates to be an array`);
      }
      const candidates = r["candidates"] as unknown[];
      if (candidates.length === 0) {
        throw new Error(`[gemini] response.candidates is empty`);
      }
      break;
    }

    default: {
      // Unknown provider – just ensure it's a non-empty object
      if (Object.keys(r).length === 0) {
        throw new Error(`[${provider.name}] Response object is empty`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// withProviderTimeout
// ---------------------------------------------------------------------------

/**
 * Wraps an async function with a timeout. Throws if the function does not
 * resolve within `ms` milliseconds.
 */
export async function withProviderTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(`Provider request timed out after ${ms}ms`),
      );
    }, ms);
  });

  try {
    const result = await Promise.race([fn(), timeout]);
    clearTimeout(timeoutHandle!);
    return result;
  } catch (err) {
    clearTimeout(timeoutHandle!);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isProviderConfig(value: unknown): value is ProviderConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["name"] === "string" &&
    typeof v["envKey"] === "string" &&
    typeof v["modelId"] === "string" &&
    typeof v["available"] === "boolean" &&
    typeof v["isMock"] === "boolean"
  );
}

export function isTestResult(value: unknown): value is TestResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["provider"] === "string" &&
    typeof v["testName"] === "string" &&
    typeof v["capability"] === "string" &&
    (v["status"] === "pass" || v["status"] === "fail" || v["status"] === "skip") &&
    typeof v["duration"] === "number" &&
    typeof v["timestamp"] === "number"
  );
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable label for a provider, with model ID appended.
 */
export function providerLabel(provider: ProviderConfig): string {
  if (provider.isMock) return "mock";
  return `${provider.name}/${provider.modelId}`;
}

/**
 * Returns true if the current test environment is CI (based on the CI env var).
 */
export function isCI(): boolean {
  return Boolean(process.env["CI"]);
}

/**
 * Escape HTML characters to prevent XSS in the HTML report.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Convenience wrapper: `describeForEachProvider` creates a `describe` block per
 * available provider and exposes the config via a callback.
 *
 * @example
 * describeForEachProvider("excel capability", (provider) => {
 *   it("creates a spreadsheet", async () => { ... });
 * });
 */
export function describeForEachProvider(
  suiteName: string,
  fn: (provider: ProviderConfig) => void,
): void {
  const enabled = getEnabledProviders();

  if (enabled.length === 0) {
    describe(`${suiteName} [mock]`, () => fn(MOCK_PROVIDER));
    return;
  }

  for (const provider of enabled) {
    describe(`${suiteName} [${provider.name}]`, () => fn(provider));
  }
}

/**
 * Returns the default timeout (ms) to use when calling a real LLM provider.
 * Longer in CI to account for slower machines; shorter locally.
 */
export function getProviderTimeout(provider: ProviderConfig): number {
  if (provider.isMock) return 1_000;
  if (isCI()) return 60_000;
  return 30_000;
}
