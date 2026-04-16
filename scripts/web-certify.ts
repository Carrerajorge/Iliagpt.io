#!/usr/bin/env npx tsx

import * as fs from "fs";
import * as path from "path";
import { spawn, type ChildProcess } from "child_process";
import { GoldenFixturesValidator, V2MetricsCollector } from "../server/agent/webtool/v2/index";
import { RelevanceFilter } from "../server/agent/webtool/relevanceFilter";
import { RetrievalPlanner } from "../server/agent/webtool/retrievalPlanner";
import { ResponseCache } from "../server/agent/webtool/responseCache";

interface CertifyConfig {
  quick: boolean;
  outputDir: string;
  soakDurationSeconds: number;
  soakConcurrency: number;
}

interface PhaseResult {
  name: string;
  passed: boolean;
  durationMs: number;
  details: Record<string, unknown>;
  output?: string;
  error?: string;
}

interface CertificationSummary {
  timestamp: string;
  config: CertifyConfig;
  phases: PhaseResult[];
  overallPassed: boolean;
  totalDurationMs: number;
  sloCompliance: {
    passed: boolean;
    details: Record<string, unknown>;
  };
}

const DEFAULT_CONFIG: CertifyConfig = {
  quick: false,
  outputDir: "test_results",
  soakDurationSeconds: 300,
  soakConcurrency: 10,
};

const SLO_THRESHOLDS = {
  unitTestPassRate: 100,
  benchmarkPassRate: 100,
  goldenFixturesPassRate: 95,
  soakSuccessRate: 95,
  fetchP95Ms: 3000,
  browserP95Ms: 8000,
};

function parseArgs(): Partial<CertifyConfig> & { help?: boolean } {
  const args: Partial<CertifyConfig> & { help?: boolean } = {};

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === "--quick" || arg === "-q") {
      args.quick = true;
    } else if (arg === "--output-dir" && process.argv[i + 1]) {
      args.outputDir = process.argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
Web Retrieval V2 Certification Script

Usage: npm run web:certify [options]
       npx tsx scripts/web-certify.ts [options]

Options:
  --quick, -q            Skip soak test for faster local runs
  --output-dir <path>    Directory for output files (default: test_results)
  --help, -h             Show this help message

Phases:
  1. Unit Tests     - Run vitest for webtool*.test.ts files
  2. Benchmarks     - Run web-bench.ts performance benchmarks
  3. Golden Fixtures- Validate relevance filter against golden fixtures
  4. Soak Test      - 5-minute stability test (skipped with --quick)
  5. SLO Compliance - Verify all metrics meet thresholds

Output:
  test_results/web_v2_certify_<timestamp>/
    ├── summary.json       - Pass/fail for each phase
    └── full_report.txt    - Complete test output

Exit Codes:
  0 - All certification phases passed
  1 - One or more phases failed

Examples:
  npm run web:certify                    # Full certification
  npm run web:certify -- --quick         # Skip soak test
  npx tsx scripts/web-certify.ts --quick # Direct invocation
`);
}

function log(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] ${message}`);
}

function logPhase(phase: string): void {
  console.log();
  console.log("─".repeat(70));
  log(`PHASE: ${phase}`);
  console.log("─".repeat(70));
}

// Security: Command execution helper with hardcoded executable
function spawnNpx(
  args: string[],
  timeoutMs: number = 300000
): Promise<{ success: boolean; output: string; exitCode: number }> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;

    const proc: ChildProcess = spawn("npx", args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);

    if (proc.stdout) {
      proc.stdout.on("data", (data) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);
      });
    }

    if (proc.stderr) {
      proc.stderr.on("data", (data) => {
        const text = data.toString();
        output += text;
        process.stderr.write(text);
      });
    }

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        output += "\n[TIMEOUT] Command exceeded time limit\n";
      }
      resolve({
        success: code === 0 && !timedOut,
        output,
        exitCode: code ?? 1,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      output += `\n[ERROR] ${err.message}\n`;
      resolve({
        success: false,
        output,
        exitCode: 1,
      });
    });
  });
}

async function runUnitTests(): Promise<PhaseResult> {
  logPhase("Unit Tests (vitest)");
  const startTime = performance.now();

  const result = await spawnNpx([
    "vitest",
    "run",
    "--reporter=verbose",
    "server/agent/__tests__/webtool.test.ts",
    "server/agent/__tests__/webtool-chaos.test.ts",
    "server/agent/__tests__/webtool-cache-isolation.test.ts",
    "server/agent/__tests__/webtool-retrieval.test.ts",
  ], 180000);

  const testsMatch = result.output.match(/(\d+)\s+passed/);
  const failedMatch = result.output.match(/(\d+)\s+failed/);

  const passed = testsMatch ? parseInt(testsMatch[1], 10) : 0;
  const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;

  return {
    name: "unit_tests",
    passed: result.success,
    durationMs: performance.now() - startTime,
    details: {
      testsPassed: passed,
      testsFailed: failed,
      exitCode: result.exitCode,
    },
    output: result.output,
  };
}

async function runBenchmarks(): Promise<PhaseResult> {
  logPhase("Benchmarks (web-bench.ts)");
  const startTime = performance.now();

  const result = await spawnNpx([
    "tsx",
    "scripts/web-bench.ts",
  ], 120000);

  const passedMatch = result.output.match(/Passed:\s*(\d+)/);
  const failedMatch = result.output.match(/Failed:\s*(\d+)/);

  const benchmarksPassed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
  const benchmarksFailed = failedMatch ? parseInt(failedMatch[1], 10) : 0;

  return {
    name: "benchmarks",
    passed: result.success,
    durationMs: performance.now() - startTime,
    details: {
      benchmarksPassed,
      benchmarksFailed,
      exitCode: result.exitCode,
    },
    output: result.output,
  };
}

async function validateGoldenFixtures(): Promise<PhaseResult> {
  logPhase("Golden Fixtures Validation");
  const startTime = performance.now();

  try {
    const relevanceFilter = new RelevanceFilter();
    const validator = new GoldenFixturesValidator(relevanceFilter);
    
    const fixtures = validator.loadFixtures();
    log(`Loaded ${fixtures.length} golden fixtures`);

    const validationResult = validator.validateAgainstGolden();
    
    log(`Validation complete: ${validationResult.passedCount}/${validationResult.totalFixtures} passed`);
    
    if (validationResult.failures.length > 0) {
      log("Failures:");
      for (const failure of validationResult.failures.slice(0, 5)) {
        log(`  - Query: "${failure.fixture.query.substring(0, 50)}..."`);
        log(`    Expected: ${failure.fixture.expectedScore.toFixed(3)}, Got: ${failure.actualScore.toFixed(3)}`);
      }
      if (validationResult.failures.length > 5) {
        log(`  ... and ${validationResult.failures.length - 5} more`);
      }
    }

    const passRate = (validationResult.passedCount / validationResult.totalFixtures) * 100;

    return {
      name: "golden_fixtures",
      passed: validationResult.passed,
      durationMs: performance.now() - startTime,
      details: {
        totalFixtures: validationResult.totalFixtures,
        passedCount: validationResult.passedCount,
        failedCount: validationResult.failedCount,
        passRate: passRate.toFixed(2) + "%",
        failures: validationResult.failures.map(f => ({
          query: f.fixture.query,
          expected: f.fixture.expectedScore,
          actual: f.actualScore,
          difference: f.difference,
        })),
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error: ${errorMessage}`);
    
    return {
      name: "golden_fixtures",
      passed: false,
      durationMs: performance.now() - startTime,
      details: {},
      error: errorMessage,
    };
  }
}

async function runSoakTest(config: CertifyConfig): Promise<PhaseResult> {
  logPhase(`Soak Test (${config.soakDurationSeconds}s, ${config.soakConcurrency} concurrent)`);
  const startTime = performance.now();

  const result = await spawnNpx([
    "tsx",
    "scripts/web-soak-v2.ts",
    "--duration",
    config.soakDurationSeconds.toString(),
    "--concurrency",
    config.soakConcurrency.toString(),
  ], (config.soakDurationSeconds + 60) * 1000);

  const successRateMatch = result.output.match(/Success Rate:\s*([\d.]+)%/);
  const requestsMatch = result.output.match(/Total Requests:\s*(\d+)/);
  const fetchP95Match = result.output.match(/Fetch P95:\s*(\d+)ms/i);
  const browserP95Match = result.output.match(/Browser P95:\s*(\d+)ms/i);

  const successRate = successRateMatch ? parseFloat(successRateMatch[1]) : 0;
  const totalRequests = requestsMatch ? parseInt(requestsMatch[1], 10) : 0;
  const fetchP95 = fetchP95Match ? parseInt(fetchP95Match[1], 10) : 0;
  const browserP95 = browserP95Match ? parseInt(browserP95Match[1], 10) : 0;

  return {
    name: "soak_test",
    passed: result.success,
    durationMs: performance.now() - startTime,
    details: {
      successRate: successRate.toFixed(2) + "%",
      totalRequests,
      fetchP95Ms: fetchP95,
      browserP95Ms: browserP95,
      exitCode: result.exitCode,
    },
    output: result.output,
  };
}

function checkSLOCompliance(phases: PhaseResult[]): { passed: boolean; details: Record<string, unknown> } {
  logPhase("SLO Compliance Check");
  
  const details: Record<string, unknown> = {
    thresholds: SLO_THRESHOLDS,
    checks: [],
  };
  
  const checks: { name: string; passed: boolean; value: unknown; threshold: unknown }[] = [];

  const unitTestPhase = phases.find(p => p.name === "unit_tests");
  if (unitTestPhase) {
    const testsFailed = (unitTestPhase.details.testsFailed as number) || 0;
    const passed = testsFailed === 0;
    checks.push({
      name: "unit_test_pass_rate",
      passed,
      value: passed ? "100%" : `${testsFailed} tests failed`,
      threshold: "100% pass rate",
    });
  }

  const benchmarkPhase = phases.find(p => p.name === "benchmarks");
  if (benchmarkPhase) {
    const benchFailed = (benchmarkPhase.details.benchmarksFailed as number) || 0;
    const passed = benchFailed === 0;
    checks.push({
      name: "benchmark_pass_rate",
      passed,
      value: passed ? "100%" : `${benchFailed} benchmarks failed`,
      threshold: "100% pass rate",
    });
  }

  const goldenPhase = phases.find(p => p.name === "golden_fixtures");
  if (goldenPhase) {
    const passRate = goldenPhase.details.passRate as string;
    const passRateValue = parseFloat(passRate) || 0;
    const passed = passRateValue >= SLO_THRESHOLDS.goldenFixturesPassRate;
    checks.push({
      name: "golden_fixtures_pass_rate",
      passed,
      value: passRate,
      threshold: `≥${SLO_THRESHOLDS.goldenFixturesPassRate}%`,
    });
  }

  const soakPhase = phases.find(p => p.name === "soak_test");
  if (soakPhase && !soakPhase.output?.includes("skipped")) {
    const successRate = parseFloat(soakPhase.details.successRate as string) || 0;
    const fetchP95 = (soakPhase.details.fetchP95Ms as number) || 0;
    const browserP95 = (soakPhase.details.browserP95Ms as number) || 0;

    checks.push({
      name: "soak_success_rate",
      passed: successRate >= SLO_THRESHOLDS.soakSuccessRate,
      value: `${successRate.toFixed(2)}%`,
      threshold: `≥${SLO_THRESHOLDS.soakSuccessRate}%`,
    });

    if (fetchP95 > 0) {
      checks.push({
        name: "soak_fetch_p95",
        passed: fetchP95 <= SLO_THRESHOLDS.fetchP95Ms,
        value: `${fetchP95}ms`,
        threshold: `≤${SLO_THRESHOLDS.fetchP95Ms}ms`,
      });
    }

    if (browserP95 > 0) {
      checks.push({
        name: "soak_browser_p95",
        passed: browserP95 <= SLO_THRESHOLDS.browserP95Ms,
        value: `${browserP95}ms`,
        threshold: `≤${SLO_THRESHOLDS.browserP95Ms}ms`,
      });
    }
  }

  details.checks = checks;

  for (const check of checks) {
    const icon = check.passed ? "✓" : "✗";
    log(`${icon} ${check.name}: ${check.value} (threshold: ${check.threshold})`);
  }

  const allPassed = checks.every(c => c.passed);
  details.allPassed = allPassed;

  return { passed: allPassed, details };
}

function saveResults(
  summary: CertificationSummary,
  phases: PhaseResult[],
  outputDir: string
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const certifyDir = path.join(outputDir, `web_v2_certify_${timestamp}`);
  
  if (!fs.existsSync(certifyDir)) {
    fs.mkdirSync(certifyDir, { recursive: true });
  }

  const summaryPath = path.join(certifyDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  log(`Summary saved to: ${summaryPath}`);

  const reportPath = path.join(certifyDir, "full_report.txt");
  let report = "";
  report += "=".repeat(80) + "\n";
  report += "WEB RETRIEVAL V2 CERTIFICATION REPORT\n";
  report += "=".repeat(80) + "\n";
  report += `Generated: ${summary.timestamp}\n`;
  report += `Total Duration: ${(summary.totalDurationMs / 1000).toFixed(2)}s\n`;
  report += `Overall Result: ${summary.overallPassed ? "PASSED" : "FAILED"}\n`;
  report += "\n";

  for (const phase of phases) {
    report += "─".repeat(80) + "\n";
    report += `PHASE: ${phase.name.toUpperCase()}\n`;
    report += `Result: ${phase.passed ? "PASSED" : "FAILED"}\n`;
    report += `Duration: ${(phase.durationMs / 1000).toFixed(2)}s\n`;
    report += `Details: ${JSON.stringify(phase.details, null, 2)}\n`;
    if (phase.output) {
      report += "\nOutput:\n";
      report += phase.output;
    }
    if (phase.error) {
      report += `\nError: ${phase.error}\n`;
    }
    report += "\n";
  }

  report += "=".repeat(80) + "\n";
  report += "SLO COMPLIANCE\n";
  report += "=".repeat(80) + "\n";
  report += JSON.stringify(summary.sloCompliance, null, 2);
  report += "\n";

  fs.writeFileSync(reportPath, report);
  log(`Full report saved to: ${reportPath}`);

  return certifyDir;
}

function printFinalResult(summary: CertificationSummary): void {
  console.log();
  console.log("═".repeat(70));
  console.log("CERTIFICATION RESULT");
  console.log("═".repeat(70));
  console.log();

  for (const phase of summary.phases) {
    const icon = phase.passed ? "✓" : "✗";
    const status = phase.passed ? "PASS" : "FAIL";
    const duration = (phase.durationMs / 1000).toFixed(2);
    console.log(`${icon} ${phase.name.padEnd(20)} ${status.padEnd(6)} (${duration}s)`);
  }

  console.log();
  console.log("─".repeat(70));
  console.log(`SLO Compliance: ${summary.sloCompliance.passed ? "PASSED" : "FAILED"}`);
  console.log("─".repeat(70));
  console.log();

  const overallIcon = summary.overallPassed ? "✓" : "✗";
  const overallStatus = summary.overallPassed ? "CERTIFICATION PASSED" : "CERTIFICATION FAILED";
  console.log(`${overallIcon} ${overallStatus}`);
  console.log();
  console.log(`Total Duration: ${(summary.totalDurationMs / 1000).toFixed(2)}s`);
  console.log("═".repeat(70));
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const config: CertifyConfig = {
    ...DEFAULT_CONFIG,
    ...args,
  };

  console.log();
  console.log("═".repeat(70));
  console.log("WEB RETRIEVAL V2 CERTIFICATION");
  console.log("═".repeat(70));
  console.log();
  log(`Mode: ${config.quick ? "QUICK (skip soak test)" : "FULL"}`);
  log(`Output Directory: ${config.outputDir}`);
  console.log();

  const phases: PhaseResult[] = [];
  const startTime = performance.now();

  try {
    phases.push(await runUnitTests());
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    phases.push({
      name: "unit_tests",
      passed: false,
      durationMs: 0,
      details: {},
      error: errorMessage,
    });
  }

  try {
    phases.push(await runBenchmarks());
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    phases.push({
      name: "benchmarks",
      passed: false,
      durationMs: 0,
      details: {},
      error: errorMessage,
    });
  }

  try {
    phases.push(await validateGoldenFixtures());
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    phases.push({
      name: "golden_fixtures",
      passed: false,
      durationMs: 0,
      details: {},
      error: errorMessage,
    });
  }

  if (!config.quick) {
    try {
      phases.push(await runSoakTest(config));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      phases.push({
        name: "soak_test",
        passed: false,
        durationMs: 0,
        details: {},
        error: errorMessage,
      });
    }
  } else {
    log("Skipping soak test (--quick mode)");
    phases.push({
      name: "soak_test",
      passed: true,
      durationMs: 0,
      details: { skipped: true, reason: "--quick mode" },
      output: "(skipped)",
    });
  }

  const sloCompliance = checkSLOCompliance(phases);
  const totalDurationMs = performance.now() - startTime;
  const overallPassed = phases.every(p => p.passed) && sloCompliance.passed;

  const summary: CertificationSummary = {
    timestamp: new Date().toISOString(),
    config,
    phases: phases.map(p => ({
      ...p,
      output: undefined,
    })),
    overallPassed,
    totalDurationMs,
    sloCompliance,
  };

  const outputPath = saveResults(summary, phases, config.outputDir);
  printFinalResult(summary);

  log(`Results saved to: ${outputPath}`);
  process.exit(overallPassed ? 0 : 1);
}

main().catch((error) => {
  console.error("Certification failed with error:", error);
  process.exit(1);
});
