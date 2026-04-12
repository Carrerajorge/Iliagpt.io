#!/usr/bin/env tsx
/**
 * Master capability test runner
 *
 * Executes all 18 capability test categories using Vitest, collects results
 * from each category's JSON output, builds a provider × capability coverage
 * matrix, and writes HTML + JSON reports to tests/capabilities/reports/.
 *
 * Usage:
 *   npx tsx tests/capabilities/runAll.ts [--ci] [--category 13-sub-agents]
 *
 * Options:
 *   --ci          Use minimal output suitable for CI logs
 *   --category    Run only the specified category directory name
 *   --no-report   Skip writing HTML/JSON reports
 *   --timeout     Per-category timeout in seconds (default: 120)
 */

import { execSync, spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(process.argv[1]), "../..");
const TESTS_DIR = path.join(ROOT, "tests", "capabilities");
const REPORTS_DIR = path.join(TESTS_DIR, "reports");

const CAPABILITY_DIRS = [
  "01-file-generation",
  "02-file-management",
  "03-data-analysis",
  "04-research-synthesis",
  "05-format-conversion",
  "06-browser-automation",
  "07-computer-use",
  "08-scheduled-tasks",
  "09-dispatch-mobile",
  "10-mcp-connectors",
  "11-plugins",
  "12-code-execution",
  "13-sub-agents",
  "14-cowork-projects",
  "15-security",
  "16-enterprise",
  "17-use-cases",
  "18-availability",
];

const PROVIDERS = ["anthropic", "openai", "gemini", "grok", "mistral", "mock"] as const;
type Provider = (typeof PROVIDERS)[number];

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const isCI = args.includes("--ci");
const noReport = args.includes("--no-report");
const categoryFilter = (() => {
  const idx = args.indexOf("--category");
  return idx >= 0 ? args[idx + 1] : null;
})();
const timeoutSeconds = (() => {
  const idx = args.indexOf("--timeout");
  return idx >= 0 ? parseInt(args[idx + 1] ?? "120", 10) : 120;
})();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestRecord {
  testName: string;
  capability: string;
  provider: string;
  status: "pass" | "fail" | "skip";
  duration: number;
  error?: string;
}

interface CategoryResult {
  category: string;
  dirName: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  durationMs: number;
  error?: string;
  tests: TestRecord[];
}

interface RunSummary {
  startedAt: number;
  completedAt: number;
  totalDurationMs: number;
  categories: CategoryResult[];
  totals: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
    categoriesRun: number;
    categoriesFailed: number;
  };
  matrix: Record<string, Record<Provider, "pass" | "fail" | "skip" | "-">>;
}

// ---------------------------------------------------------------------------
// Vitest JSON reporter parser
// ---------------------------------------------------------------------------

interface VitestJsonTestResult {
  testFilePath?: string;
  numPassingTests: number;
  numFailingTests: number;
  numPendingTests: number;
  testResults?: Array<{
    ancestorTitles: string[];
    title: string;
    status: "passed" | "failed" | "pending" | "todo" | "skipped";
    duration?: number;
    failureMessages?: string[];
  }>;
}

interface VitestJsonOutput {
  numTotalTestSuites?: number;
  numPassedTestSuites?: number;
  numFailedTestSuites?: number;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  testResults?: VitestJsonTestResult[];
}

function parseVitestOutput(jsonStr: string): { passed: number; failed: number; skipped: number; tests: TestRecord[] } {
  let parsed: VitestJsonOutput;

  try {
    parsed = JSON.parse(jsonStr) as VitestJsonOutput;
  } catch {
    return { passed: 0, failed: 0, skipped: 0, tests: [] };
  }

  const tests: TestRecord[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const suite of parsed.testResults ?? []) {
    for (const test of suite.testResults ?? []) {
      const status: "pass" | "fail" | "skip" =
        test.status === "passed" ? "pass" :
        test.status === "failed" ? "fail" : "skip";

      if (status === "pass") passed++;
      else if (status === "fail") failed++;
      else skipped++;

      // Extract provider from test title: "[anthropic]", "[mock]", etc.
      const providerMatch = test.title.match(/\[(\w+)\]/);
      const provider = providerMatch ? providerMatch[1] : "unknown";

      // Build capability label from ancestor titles
      const capability = test.ancestorTitles.join(" > ") || "unknown";
      const testName = test.title.replace(/\s*\[\w+\]\s*$/, "").trim();

      tests.push({
        testName,
        capability,
        provider,
        status,
        duration: test.duration ?? 0,
        error: test.failureMessages?.[0],
      });
    }
  }

  // Fallback to top-level counts if no test results were parsed
  if (tests.length === 0) {
    passed = parsed.numPassedTests ?? 0;
    failed = parsed.numFailedTests ?? 0;
    skipped = parsed.numPendingTests ?? 0;
  }

  return { passed, failed, skipped, tests };
}

// ---------------------------------------------------------------------------
// Run a single category
// ---------------------------------------------------------------------------

function runCategory(dirName: string): CategoryResult {
  const category = dirName.replace(/^\d+-/, "").replace(/-/g, " ");
  const testGlob = `tests/capabilities/${dirName}/**/*.test.ts`;

  if (!isCI) {
    process.stdout.write(`  Running ${dirName}... `);
  }

  const startMs = Date.now();
  const tmpJson = path.join(REPORTS_DIR, `.tmp-${dirName}.json`);

  const result = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      "--reporter=json",
      `--outputFile=${tmpJson}`,
      testGlob,
    ],
    {
      cwd: ROOT,
      stdio: isCI ? "inherit" : "pipe",
      timeout: timeoutSeconds * 1000,
      env: { ...process.env, FORCE_COLOR: "0" },
    },
  );

  const durationMs = Date.now() - startMs;

  if (result.error) {
    if (!isCI) process.stdout.write(`ERROR\n`);
    return {
      category,
      dirName,
      passed: 0,
      failed: 1,
      skipped: 0,
      total: 1,
      durationMs,
      error: result.error.message,
      tests: [],
    };
  }

  // Read JSON output
  let parsedResults = { passed: 0, failed: 0, skipped: 0, tests: [] as TestRecord[] };
  if (fs.existsSync(tmpJson)) {
    try {
      const raw = fs.readFileSync(tmpJson, "utf-8");
      parsedResults = parseVitestOutput(raw);
    } catch (err) {
      // If file can't be parsed, rely on exit code
    }
    fs.unlinkSync(tmpJson); // clean up temp file
  } else {
    // No JSON output, but might have stdout
    const stdout = result.stdout?.toString() ?? "";
    parsedResults = parseVitestOutput(stdout);
  }

  const exitOk = result.status === 0;

  if (!isCI) {
    const icon = exitOk ? "PASS" : "FAIL";
    const counts = `${parsedResults.passed}P/${parsedResults.failed}F/${parsedResults.skipped}S`;
    process.stdout.write(`${icon} (${counts}, ${durationMs}ms)\n`);
  }

  return {
    category,
    dirName,
    passed: parsedResults.passed,
    failed: parsedResults.failed,
    skipped: parsedResults.skipped,
    total: parsedResults.passed + parsedResults.failed + parsedResults.skipped,
    durationMs,
    error: exitOk ? undefined : (result.stderr?.toString().slice(0, 500) ?? "Non-zero exit"),
    tests: parsedResults.tests,
  };
}

// ---------------------------------------------------------------------------
// Build provider × capability matrix
// ---------------------------------------------------------------------------

function buildMatrix(
  categories: CategoryResult[],
): Record<string, Record<Provider, "pass" | "fail" | "skip" | "-">> {
  const matrix: Record<string, Record<Provider, "pass" | "fail" | "skip" | "-">> = {};

  for (const cat of categories) {
    matrix[cat.dirName] = {} as Record<Provider, "pass" | "fail" | "skip" | "-">;

    for (const provider of PROVIDERS) {
      matrix[cat.dirName][provider] = "-";
    }

    for (const test of cat.tests) {
      const p = test.provider as Provider;
      if (!PROVIDERS.includes(p)) continue;

      const existing = matrix[cat.dirName][p];
      // Worst-case wins: fail > skip > pass
      if (existing === "-") {
        matrix[cat.dirName][p] = test.status;
      } else if (test.status === "fail") {
        matrix[cat.dirName][p] = "fail";
      } else if (test.status === "skip" && existing === "pass") {
        matrix[cat.dirName][p] = "skip";
      }
    }
  }

  return matrix;
}

// ---------------------------------------------------------------------------
// Console output
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function colour(text: string, ansi: string): string {
  if (isCI) return text;
  return `${ansi}${text}${RESET}`;
}

function printSeparator(char = "─", width = 80): void {
  console.log(colour(char.repeat(width), DIM));
}

function printHeader(): void {
  printSeparator("═");
  console.log(colour(`${BOLD}  IliaGPT Capability Test Suite${RESET}`, BOLD));
  console.log(colour(`  Running ${categoryFilter ? `category: ${categoryFilter}` : "all 18 capability categories"}`, DIM));
  console.log(`  Date: ${new Date().toISOString()}`);
  printSeparator("═");
}

function printMatrixTable(
  matrix: Record<string, Record<Provider, "pass" | "fail" | "skip" | "-">>,
): void {
  const providerLabels = PROVIDERS.map((p) => p.slice(0, 6).padEnd(6));
  const colWidth = 22;

  console.log(`\n${colour("  CAPABILITY × PROVIDER MATRIX", BOLD)}`);
  printSeparator();
  console.log(`  ${"Capability".padEnd(colWidth)} ${providerLabels.join("  ")}`);
  printSeparator();

  for (const [dir, providerMap] of Object.entries(matrix)) {
    const label = dir.padEnd(colWidth);
    const cells = PROVIDERS.map((p) => {
      const val = providerMap[p] ?? "-";
      const cell = val.slice(0, 6).padEnd(6);
      if (val === "pass") return colour(cell, GREEN);
      if (val === "fail") return colour(cell, RED);
      if (val === "skip") return colour(cell, YELLOW);
      return colour(cell, DIM);
    });
    console.log(`  ${label} ${cells.join("  ")}`);
  }

  printSeparator();
}

function printSummary(summary: RunSummary): void {
  const { totals } = summary;
  const passRate = totals.total > 0 ? Math.round((totals.passed / totals.total) * 100) : 0;

  console.log(`\n${colour("  EXECUTIVE SUMMARY", BOLD)}`);
  printSeparator();
  console.log(`  Categories run : ${totals.categoriesRun}`);
  console.log(`  Categories OK  : ${colour(String(totals.categoriesRun - totals.categoriesFailed), GREEN)}`);
  console.log(`  Categories fail: ${colour(String(totals.categoriesFailed), totals.categoriesFailed > 0 ? RED : GREEN)}`);
  console.log(`  Total tests    : ${totals.total}`);
  console.log(`  Passed         : ${colour(String(totals.passed), GREEN)}`);
  console.log(`  Failed         : ${colour(String(totals.failed), totals.failed > 0 ? RED : GREEN)}`);
  console.log(`  Skipped        : ${colour(String(totals.skipped), YELLOW)}`);
  console.log(`  Pass rate      : ${colour(`${passRate}%`, passRate >= 90 ? GREEN : passRate >= 70 ? YELLOW : RED)}`);
  console.log(`  Duration       : ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
  printSeparator();

  // List failures
  const failures = summary.categories.filter((c) => c.failed > 0 || c.error);
  if (failures.length > 0) {
    console.log(`\n${colour("  FAILURES", RED + BOLD)}`);
    printSeparator();
    for (const cat of failures) {
      console.log(`  ${colour(cat.dirName, RED)}: ${cat.failed} test(s) failed`);
      if (cat.error) {
        console.log(colour(`    ${cat.error.split("\n")[0]}`, DIM));
      }
      for (const test of cat.tests.filter((t) => t.status === "fail")) {
        console.log(colour(`    [${test.provider}] ${test.capability} > ${test.testName}`, DIM));
        if (test.error) {
          console.log(colour(`      ${test.error.split("\n")[0]}`, DIM));
        }
      }
    }
    printSeparator();
  }
}

// ---------------------------------------------------------------------------
// Report writers
// ---------------------------------------------------------------------------

function writeJSONReport(summary: RunSummary): string {
  const filePath = path.join(REPORTS_DIR, `capability-report-${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), "utf-8");
  return filePath;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function writeHTMLReport(summary: RunSummary): string {
  const { totals, categories, matrix } = summary;
  const filePath = path.join(REPORTS_DIR, `capability-report-${Date.now()}.html`);

  const matrixRows = Object.entries(matrix).map(([dir, providerMap]) => {
    const cells = PROVIDERS.map((p) => {
      const val = providerMap[p] ?? "-";
      const cls = val === "pass" ? "pass" : val === "fail" ? "fail" : val === "skip" ? "skip" : "na";
      return `<td class="${cls}">${val.toUpperCase()}</td>`;
    }).join("");
    return `<tr><td class="cap-name">${escapeHtml(dir)}</td>${cells}</tr>`;
  }).join("\n");

  const categoryRows = categories.map((cat) => {
    const cls = cat.failed > 0 ? "fail" : "pass";
    return `<tr class="${cls}">
      <td>${escapeHtml(cat.dirName)}</td>
      <td>${cat.passed}</td>
      <td>${cat.failed}</td>
      <td>${cat.skipped}</td>
      <td>${cat.total}</td>
      <td>${cat.durationMs}ms</td>
      <td>${cat.error ? escapeHtml(cat.error.slice(0, 100)) : ""}</td>
    </tr>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>IliaGPT Capability Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; padding: 24px; background: #f9fafb; color: #111; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .meta { color: #6b7280; font-size: 0.875rem; margin-bottom: 24px; }
    .stats { display: flex; gap: 16px; margin-bottom: 32px; flex-wrap: wrap; }
    .stat { padding: 12px 20px; border-radius: 8px; font-weight: 600; font-size: 1rem; }
    .stat.pass { background: #d1fae5; color: #065f46; }
    .stat.fail { background: #fee2e2; color: #991b1b; }
    .stat.skip { background: #fef9c3; color: #92400e; }
    .stat.info { background: #dbeafe; color: #1e40af; }
    h2 { font-size: 1.1rem; margin: 24px 0 12px; }
    table { border-collapse: collapse; width: 100%; font-size: 0.85rem; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
    th { background: #f3f4f6; font-weight: 600; }
    td.pass { background: #f0fdf4; color: #166534; font-weight: 600; }
    td.fail { background: #fef2f2; color: #991b1b; font-weight: 600; }
    td.skip { background: #fefce8; color: #92400e; }
    td.na { color: #9ca3af; }
    td.cap-name { font-family: monospace; font-size: 0.8rem; }
    tr.pass td:first-child { border-left: 4px solid #22c55e; }
    tr.fail td:first-child { border-left: 4px solid #ef4444; }
  </style>
</head>
<body>
  <h1>IliaGPT Capability Report</h1>
  <p class="meta">Generated: ${new Date(summary.startedAt).toISOString()} &bull; Duration: ${(summary.totalDurationMs / 1000).toFixed(1)}s</p>

  <div class="stats">
    <div class="stat pass">Passed: ${totals.passed}</div>
    <div class="stat fail">Failed: ${totals.failed}</div>
    <div class="stat skip">Skipped: ${totals.skipped}</div>
    <div class="stat info">Total: ${totals.total}</div>
    <div class="stat info">Categories: ${totals.categoriesRun}</div>
  </div>

  <h2>Capability × Provider Matrix</h2>
  <table>
    <thead>
      <tr>
        <th>Capability</th>
        ${PROVIDERS.map((p) => `<th>${p}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${matrixRows}
    </tbody>
  </table>

  <h2>Category Results</h2>
  <table>
    <thead>
      <tr><th>Category</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Total</th><th>Duration</th><th>Error</th></tr>
    </thead>
    <tbody>
      ${categoryRows}
    </tbody>
  </table>
</body>
</html>`;

  fs.writeFileSync(filePath, html, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startedAt = Date.now();

  // Ensure reports directory exists
  if (!noReport) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  printHeader();

  const categoriesToRun = categoryFilter
    ? CAPABILITY_DIRS.filter((d) => d === categoryFilter)
    : CAPABILITY_DIRS;

  if (categoryFilter && categoriesToRun.length === 0) {
    console.error(`\nERROR: Category "${categoryFilter}" not found.`);
    console.error(`Available categories:\n  ${CAPABILITY_DIRS.join("\n  ")}`);
    process.exit(1);
  }

  console.log("\n  Running categories:\n");

  const categories: CategoryResult[] = [];

  for (const dirName of categoriesToRun) {
    const testDir = path.join(TESTS_DIR, dirName);
    if (!fs.existsSync(testDir)) {
      categories.push({
        category: dirName.replace(/^\d+-/, "").replace(/-/g, " "),
        dirName,
        passed: 0,
        failed: 0,
        skipped: 1,
        total: 1,
        durationMs: 0,
        error: "Directory not found",
        tests: [],
      });
      if (!isCI) console.log(`  ${dirName}: SKIP (directory not found)`);
      continue;
    }

    const result = runCategory(dirName);
    categories.push(result);
  }

  const completedAt = Date.now();
  const totalDurationMs = completedAt - startedAt;

  const totals = categories.reduce(
    (acc, cat) => ({
      passed: acc.passed + cat.passed,
      failed: acc.failed + cat.failed,
      skipped: acc.skipped + cat.skipped,
      total: acc.total + cat.total,
      categoriesRun: acc.categoriesRun + 1,
      categoriesFailed: acc.categoriesFailed + (cat.failed > 0 || cat.error ? 1 : 0),
    }),
    { passed: 0, failed: 0, skipped: 0, total: 0, categoriesRun: 0, categoriesFailed: 0 },
  );

  const matrix = buildMatrix(categories);

  const summary: RunSummary = {
    startedAt,
    completedAt,
    totalDurationMs,
    categories,
    totals,
    matrix,
  };

  printMatrixTable(matrix);
  printSummary(summary);

  if (!noReport) {
    const jsonPath = writeJSONReport(summary);
    const htmlPath = writeHTMLReport(summary);
    console.log(`\n  Reports written to:`);
    console.log(`    JSON: ${jsonPath}`);
    console.log(`    HTML: ${htmlPath}\n`);
  }

  process.exit(totals.failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
