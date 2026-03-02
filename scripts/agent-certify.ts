#!/usr/bin/env npx tsx
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

type TestSuiteId = 'all_agent' | 'benchmarks' | 'chaos' | 'cache_isolation';

interface TestSuiteConfig {
  name: string;
  args: readonly string[];
}

const TEST_SUITES: Readonly<Record<TestSuiteId, TestSuiteConfig>> = {
  all_agent: {
    name: 'All Agent Tests',
    args: ['vitest', 'run', 'server/agent/__tests__'] as const,
  },
  benchmarks: {
    name: 'Benchmark Tests',
    args: ['vitest', 'run', 'server/agent/__tests__/benchmarks.test.ts'] as const,
  },
  chaos: {
    name: 'Chaos Tests',
    args: ['vitest', 'run', 'server/agent/__tests__/chaos.test.ts'] as const,
  },
  cache_isolation: {
    name: 'Cache Isolation Tests',
    args: ['vitest', 'run', 'server/agent/__tests__/webtool-cache-isolation.test.ts'] as const,
  },
} as const;

interface CertificationResult {
  name: string;
  command: string;
  passed: boolean;
  duration: number;
  output: string;
  testsPassed: number;
  testsFailed: number;
}

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof COLORS = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function runTest(suiteId: TestSuiteId): CertificationResult {
  const suite = TEST_SUITES[suiteId];
  const commandDisplay = `npx ${suite.args.join(' ')}`;
  
  const startTime = Date.now();
  let output = '';
  let passed = false;
  let testsPassed = 0;
  let testsFailed = 0;

  log(`\nRunning: ${suite.name}`, 'cyan');
  log(`Command: ${commandDisplay}`, 'blue');

  const result = spawnSync('npx', [...suite.args], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
    timeout: 300000,
    shell: false,
  });

  output = (result.stdout || '') + (result.stderr || '');

  const passMatch = output.match(/(\d+)\s+passed/);
  const failMatch = output.match(/(\d+)\s+failed/);
  
  if (passMatch) testsPassed = parseInt(passMatch[1], 10);
  if (failMatch) testsFailed = parseInt(failMatch[1], 10);

  passed = result.status === 0 && testsFailed === 0;

  const duration = Date.now() - startTime;
  const statusIcon = passed ? '✅' : '❌';
  log(`${statusIcon} ${suite.name}: ${passed ? 'PASSED' : 'FAILED'} (${(duration / 1000).toFixed(2)}s)`, passed ? 'green' : 'red');
  
  if (testsPassed > 0 || testsFailed > 0) {
    log(`   Tests: ${testsPassed} passed, ${testsFailed} failed`, testsFailed > 0 ? 'yellow' : 'green');
  }

  return {
    name: suite.name,
    command: commandDisplay,
    passed,
    duration,
    output,
    testsPassed,
    testsFailed,
  };
}

async function runCertification() {
  log('\n╔══════════════════════════════════════════════╗', 'cyan');
  log('║     AGENT CERTIFICATION PIPELINE             ║', 'cyan');
  log('╚══════════════════════════════════════════════╝', 'cyan');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const results: CertificationResult[] = [];

  const suiteIds: TestSuiteId[] = ['all_agent', 'benchmarks', 'chaos', 'cache_isolation'];

  for (const suiteId of suiteIds) {
    const result = runTest(suiteId);
    results.push(result);
  }

  const totalPassed = results.filter(r => r.passed).length;
  const totalFailed = results.filter(r => !r.passed).length;
  const totalTestsPassed = results.reduce((sum, r) => sum + r.testsPassed, 0);
  const totalTestsFailed = results.reduce((sum, r) => sum + r.testsFailed, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const allPassed = totalFailed === 0 && totalTestsFailed === 0;

  let report = `# Agent Certification Report\n\n`;
  report += `**Generated**: ${new Date().toISOString()}\n`;
  report += `**Status**: ${allPassed ? '✅ PASSED' : '❌ FAILED'}\n\n`;
  report += `## Summary\n\n`;
  report += `- **Test Suites**: ${totalPassed}/${results.length} passed\n`;
  report += `- **Total Tests**: ${totalTestsPassed} passed, ${totalTestsFailed} failed\n`;
  report += `- **Total Duration**: ${(totalDuration / 1000).toFixed(2)}s\n\n`;
  report += `## Results\n\n`;
  report += `| Suite | Status | Duration | Tests Passed | Tests Failed |\n`;
  report += `|-------|--------|----------|--------------|-------------|\n`;

  for (const result of results) {
    const statusIcon = result.passed ? '✅' : '❌';
    report += `| ${result.name} | ${statusIcon} | ${(result.duration / 1000).toFixed(2)}s | ${result.testsPassed} | ${result.testsFailed} |\n`;
  }

  report += `\n## Detailed Output\n\n`;

  for (const result of results) {
    report += `### ${result.name}\n\n`;
    report += `**Command**: \`${result.command}\`\n\n`;
    report += `**Status**: ${result.passed ? 'PASSED' : 'FAILED'}\n\n`;
    report += `<details>\n<summary>Output (click to expand)</summary>\n\n`;
    report += '```\n';
    report += result.output.slice(-5000);
    report += '\n```\n\n';
    report += `</details>\n\n`;
  }

  report += `---\n*Report generated by agent:certify*\n`;

  fs.mkdirSync('test_results', { recursive: true });
  const reportPath = `test_results/agent_certification_${timestamp}.txt`;
  fs.writeFileSync(reportPath, report);

  const latestReportPath = 'test_results/agent_certification_report.md';
  fs.writeFileSync(latestReportPath, report);

  log('\n╔══════════════════════════════════════════════╗', allPassed ? 'green' : 'red');
  log(`║  CERTIFICATION: ${allPassed ? 'PASSED'.padEnd(27) : 'FAILED'.padEnd(27)}  ║`, allPassed ? 'green' : 'red');
  log('╚══════════════════════════════════════════════╝', allPassed ? 'green' : 'red');
  log(`\nTest Suites: ${totalPassed}/${results.length} passed`, allPassed ? 'green' : 'red');
  log(`Total Tests: ${totalTestsPassed} passed, ${totalTestsFailed} failed`, totalTestsFailed === 0 ? 'green' : 'yellow');
  log(`Duration: ${(totalDuration / 1000).toFixed(2)}s`, 'blue');
  log(`\nReport saved to: ${reportPath}`, 'blue');
  log(`Latest report: ${latestReportPath}`, 'blue');

  process.exit(allPassed ? 0 : 1);
}

runCertification().catch(err => {
  console.error('Certification failed with error:', err);
  process.exit(1);
});
